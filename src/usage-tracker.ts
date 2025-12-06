import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import type { ModelFamily, ModelUsage, PlanType, SessionEntry, UsageSummary } from '~/types';
import { MODEL_PRICING, PLAN_LIMITS, TOKENS_PER_HOUR_ESTIMATE, WINDOW_DURATION_MS } from '~/types';
import { calculateCost, getEntryTokens, getModelFamily, getWeekBoundaries } from '~/usage-utils';

export class UsageTracker {
  private claudeDataPath: string;

  constructor() {
    this.claudeDataPath = path.join(os.homedir(), '.claude', 'projects');
  }

  async calculateUsage(plan: PlanType): Promise<UsageSummary> {
    console.log('[Clauder] Starting calculation...');
    console.log('[Clauder] Data path:', this.claudeDataPath);

    const entries = await this.getAllUsageEntries();
    console.log('[Clauder] Total entries with usage data:', entries.length);

    const now = new Date();
    const windowStart = this.getWindowStart(entries, now);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_DURATION_MS);
    const { weekStart, weekEnd } = getWeekBoundaries(now);

    console.log('[Clauder] Window:', windowStart.toISOString(), 'to', windowEnd.toISOString());
    console.log('[Clauder] Week:', weekStart.toISOString(), 'to', weekEnd.toISOString());

    let windowTokens = 0;
    let weeklyTokens = 0;
    let windowEntryCount = 0;
    let weekEntryCount = 0;

    const modelBreakdown: Record<ModelFamily, ModelUsage> = {
      opus: { inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 },
      sonnet: { inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 },
      haiku: { inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 },
      unknown: { inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 },
    };

    for (const entry of entries) {
      const timestamp = new Date(entry.timestamp);
      const tokens = getEntryTokens(entry);
      const inputTokens = entry.message?.usage?.input_tokens || 0;
      const outputTokens = entry.message?.usage?.output_tokens || 0;
      const family = getModelFamily(entry.message?.model);

      if (timestamp >= windowStart && timestamp <= now) {
        windowTokens += tokens;
        windowEntryCount++;
      }

      if (timestamp >= weekStart && timestamp <= now) {
        weeklyTokens += tokens;
        weekEntryCount++;

        modelBreakdown[family].inputTokens += inputTokens;
        modelBreakdown[family].outputTokens += outputTokens;
        modelBreakdown[family].requests += 1;
      }
    }

    let totalCost = 0;
    for (const family of Object.keys(modelBreakdown) as ModelFamily[]) {
      const usage = modelBreakdown[family];
      const pricing = MODEL_PRICING[family];
      usage.cost = calculateCost(
        usage.inputTokens,
        usage.outputTokens,
        pricing.inputPerMTok,
        pricing.outputPerMTok
      );
      totalCost += usage.cost;
    }

    console.log('[Clauder] Window: entries=' + windowEntryCount + ', tokens=' + windowTokens);
    console.log('[Clauder] Weekly: entries=' + weekEntryCount + ', tokens=' + weeklyTokens);
    console.log('[Clauder] Model breakdown:', JSON.stringify(modelBreakdown, null, 2));
    console.log('[Clauder] Total cost: $' + totalCost.toFixed(2));

    const limits = PLAN_LIMITS[plan];
    const weeklyTokenLimit = limits.weeklyHours * TOKENS_PER_HOUR_ESTIMATE;

    const result: UsageSummary = {
      windowTokens,
      weeklyTokens,
      windowPercentage: Math.min((windowTokens / limits.windowTokens) * 100, 100),
      weeklyPercentage: Math.min((weeklyTokens / weeklyTokenLimit) * 100, 100),
      estimatedHoursUsed: weeklyTokens / TOKENS_PER_HOUR_ESTIMATE,
      windowStartTime: windowStart,
      windowEndTime: windowEnd,
      weekStartTime: weekStart,
      weekEndTime: weekEnd,
      plan,
      modelBreakdown,
      totalCost,
    };

    console.log('[Clauder] Result:', JSON.stringify(result, null, 2));
    return result;
  }

  private getWindowStart(entries: SessionEntry[], now: Date): Date {
    const windowAgo = new Date(now.getTime() - WINDOW_DURATION_MS);

    const recentEntries = entries
      .filter((e) => new Date(e.timestamp) >= windowAgo)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (recentEntries.length > 0) {
      return new Date(recentEntries[0].timestamp);
    }

    return windowAgo;
  }

  private async getAllUsageEntries(): Promise<SessionEntry[]> {
    const entries: SessionEntry[] = [];

    if (!fs.existsSync(this.claudeDataPath)) {
      console.log('[Clauder] Data path does not exist:', this.claudeDataPath);
      return entries;
    }

    const jsonlFiles = this.findJsonlFiles(this.claudeDataPath);
    console.log('[Clauder] Found', jsonlFiles.length, 'total JSONL files');

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let filesProcessed = 0;
    let filesSkipped = 0;

    for (const filePath of jsonlFiles) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtime < oneWeekAgo) {
          filesSkipped++;
          continue;
        }

        const fileEntries = await this.parseJsonlFile(filePath);
        entries.push(...fileEntries);
        filesProcessed++;
      } catch {
        continue;
      }
    }

    console.log('[Clauder] Files processed:', filesProcessed, ', skipped (old):', filesSkipped);
    return entries;
  }

  private findJsonlFiles(dir: string): string[] {
    const files: string[] = [];

    try {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...this.findJsonlFiles(fullPath));
        } else if (item.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    } catch {
      return files;
    }

    return files;
  }

  private async parseJsonlFile(filePath: string): Promise<SessionEntry[]> {
    const entries: SessionEntry[] = [];

    return new Promise((resolve) => {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line) as SessionEntry;
          if (entry.message?.usage) {
            entries.push(entry);
          }
        } catch {
          // Skip invalid JSON lines
        }
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', () => resolve(entries));
    });
  }
}
