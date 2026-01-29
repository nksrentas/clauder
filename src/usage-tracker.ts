import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import type {
  LimitPrediction,
  ModelFamily,
  ModelUsage,
  PlanType,
  ProjectBreakdown,
  ProjectUsage,
  SessionEntry,
  SessionEntryWithCwd,
  UsageRate,
  UsageSummary,
} from '~/types';
import { MODEL_PRICING, PLAN_LIMITS, TOKENS_PER_HOUR_ESTIMATE, WINDOW_DURATION_MS } from '~/types';
import { calculateCost, getEntryTokens, getModelFamily, getWeekBoundaries } from '~/usage-utils';

export class UsageTracker {
  private claudeDataPath: string;

  constructor() {
    this.claudeDataPath = path.join(os.homedir(), '.claude', 'projects');
  }

  async calculateUsage(plan: PlanType): Promise<UsageSummary> {
    const entries = await this.getAllUsageEntries();
    const now = new Date();
    const windowStart = this.getWindowStart(entries, now);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_DURATION_MS);
    const { weekStart, weekEnd } = getWeekBoundaries(now);

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

    const limits = PLAN_LIMITS[plan];
    const weeklyTokenLimit = limits.weeklyHours * TOKENS_PER_HOUR_ESTIMATE;

    const windowPercentage = Math.min((windowTokens / limits.windowTokens) * 100, 100);
    const weeklyPercentage = Math.min((weeklyTokens / weeklyTokenLimit) * 100, 100);

    const projectBreakdown = calculateProjectBreakdown(entries, weekStart, now);
    const usageRate = calculateUsageRate(entries, now);
    const prediction = calculatePredictions(usageRate, windowPercentage, weeklyPercentage, plan, now);

    const result: UsageSummary = {
      windowTokens,
      weeklyTokens,
      windowPercentage,
      weeklyPercentage,
      estimatedHoursUsed: weeklyTokens / TOKENS_PER_HOUR_ESTIMATE,
      windowStartTime: windowStart,
      windowEndTime: windowEnd,
      weekStartTime: weekStart,
      weekEndTime: weekEnd,
      plan,
      modelBreakdown,
      totalCost,
      projectBreakdown,
      usageRate,
      prediction,
    };

    return result;
  }

  private getWindowStart(entries: SessionEntryWithCwd[], now: Date): Date {
    const windowAgo = new Date(now.getTime() - WINDOW_DURATION_MS);

    const recentEntries = entries
      .filter((e) => new Date(e.timestamp) >= windowAgo)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (recentEntries.length > 0) {
      return new Date(recentEntries[0].timestamp);
    }

    return windowAgo;
  }

  private async getAllUsageEntries(): Promise<SessionEntryWithCwd[]> {
    const entries: SessionEntryWithCwd[] = [];

    if (!fs.existsSync(this.claudeDataPath)) {
      return entries;
    }

    const jsonlFiles = this.findJsonlFiles(this.claudeDataPath);

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

  private async parseJsonlFile(filePath: string): Promise<SessionEntryWithCwd[]> {
    const entries: SessionEntryWithCwd[] = [];

    return new Promise((resolve) => {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line) as SessionEntryWithCwd;
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

export function calculateProjectBreakdown(
  entries: SessionEntryWithCwd[],
  weekStart: Date,
  now: Date
): ProjectBreakdown {
  const projectMap = new Map<string, ProjectUsage>();

  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp);
    if (timestamp < weekStart || timestamp > now) continue;

    const projectPath = entry.cwd || 'Unknown';
    const projectName = projectPath === 'Unknown' ? 'Unknown' : path.basename(projectPath) || 'Unknown';
    const inputTokens = entry.message?.usage?.input_tokens || 0;
    const outputTokens = entry.message?.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const family = getModelFamily(entry.message?.model);
    const pricing = MODEL_PRICING[family];
    const cost = calculateCost(inputTokens, outputTokens, pricing.inputPerMTok, pricing.outputPerMTok);

    const existing = projectMap.get(projectPath);
    if (existing) {
      existing.totalTokens += totalTokens;
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.requests += 1;
      existing.cost += cost;
    } else {
      projectMap.set(projectPath, {
        projectPath,
        projectName,
        totalTokens,
        inputTokens,
        outputTokens,
        requests: 1,
        cost,
        percentage: 0,
      });
    }
  }

  const projects = Array.from(projectMap.values());
  const totalTokens = projects.reduce((sum, p) => sum + p.totalTokens, 0);
  const totalCost = projects.reduce((sum, p) => sum + p.cost, 0);

  for (const project of projects) {
    project.percentage = totalTokens > 0 ? (project.totalTokens / totalTokens) * 100 : 0;
  }

  projects.sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    projects: projects.slice(0, 10),
    totalTokens,
    totalCost,
  };
}

const DEFAULT_RATE_WINDOW_MS = 60 * 60 * 1000;

export function calculateUsageRate(
  entries: SessionEntryWithCwd[],
  now: Date,
  sampleWindowMs: number = DEFAULT_RATE_WINDOW_MS
): UsageRate {
  const windowStart = new Date(now.getTime() - sampleWindowMs);
  let sampleTokens = 0;
  let oldestEntryTime = now.getTime();

  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp);
    if (timestamp < windowStart || timestamp > now) continue;

    const tokens = getEntryTokens(entry);
    sampleTokens += tokens;

    if (timestamp.getTime() < oldestEntryTime) {
      oldestEntryTime = timestamp.getTime();
    }
  }

  if (sampleTokens === 0) {
    return { tokensPerHour: 0, sampleWindowMs, sampleTokens: 0 };
  }

  const elapsedMs = now.getTime() - oldestEntryTime;
  const tokensPerHour = elapsedMs > 0 ? (sampleTokens / elapsedMs) * 3600000 : 0;

  return { tokensPerHour, sampleWindowMs, sampleTokens };
}

export function calculatePredictions(
  rate: UsageRate,
  currentSessionPercent: number,
  currentWeeklyPercent: number,
  plan: PlanType,
  now: Date = new Date()
): LimitPrediction {
  if (rate.tokensPerHour <= 0) {
    return {
      sessionLimitAt: null,
      weeklyLimitAt: null,
      timeToSessionLimit: null,
      timeToWeeklyLimit: null,
      canPredict: false,
      reason: 'no_recent_usage',
    };
  }

  if (currentSessionPercent >= 100 || currentWeeklyPercent >= 100) {
    return {
      sessionLimitAt: null,
      weeklyLimitAt: null,
      timeToSessionLimit: null,
      timeToWeeklyLimit: null,
      canPredict: false,
      reason: 'already_at_limit',
    };
  }

  const limits = PLAN_LIMITS[plan];
  const weeklyTokenLimit = limits.weeklyHours * TOKENS_PER_HOUR_ESTIMATE;

  const sessionRemainingTokens = ((100 - currentSessionPercent) / 100) * limits.windowTokens;
  const weeklyRemainingTokens = ((100 - currentWeeklyPercent) / 100) * weeklyTokenLimit;

  const timeToSessionLimit = (sessionRemainingTokens / rate.tokensPerHour) * 3600000;
  const timeToWeeklyLimit = (weeklyRemainingTokens / rate.tokensPerHour) * 3600000;

  const sessionLimitAt = new Date(now.getTime() + timeToSessionLimit);
  const weeklyLimitAt = new Date(now.getTime() + timeToWeeklyLimit);

  return {
    sessionLimitAt,
    weeklyLimitAt,
    timeToSessionLimit,
    timeToWeeklyLimit,
    canPredict: true,
  };
}
