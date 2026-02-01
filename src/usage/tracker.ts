import { calculateCost, getEntryTokens, getModelFamily, getWeekBoundaries } from './utils';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import type { UsageSession } from '~/sync/types';
import type {
  LimitPrediction,
  ModelFamily,
  ModelUsage,
  PlanType,
  ProjectBreakdown,
  ProjectUsage,
  SessionEntryWithCwd,
  UsageRate,
  UsageSummary,
} from '~/types';
import { MODEL_PRICING, PLAN_LIMITS, TOKENS_PER_HOUR_ESTIMATE, WINDOW_DURATION_MS } from '~/types';

export type EntryWithParsedTime = SessionEntryWithCwd & { _tsMs: number };

export class UsageTracker {
  private claudeDataPath: string;

  constructor() {
    this.claudeDataPath = path.join(os.homedir(), '.claude', 'projects');
  }

  async calculateUsage(plan: PlanType): Promise<UsageSummary> {
    const entries = await this.getAllUsageEntries();
    const now = new Date();
    const nowMs = now.getTime();
    const windowStart = this.getWindowStart(entries, now);
    const windowStartMs = windowStart.getTime();
    const windowEnd = new Date(windowStartMs + WINDOW_DURATION_MS);
    const { weekStart, weekEnd } = getWeekBoundaries(now);
    const weekStartMs = weekStart.getTime();

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
      const tsMs = entry._tsMs;
      const tokens = getEntryTokens(entry);
      const inputTokens = entry.message?.usage?.input_tokens || 0;
      const outputTokens = entry.message?.usage?.output_tokens || 0;
      const family = getModelFamily(entry.message?.model);

      if (tsMs >= windowStartMs && tsMs <= nowMs) {
        windowTokens += tokens;
        windowEntryCount++;
      }

      if (tsMs >= weekStartMs && tsMs <= nowMs) {
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
    const prediction = calculatePredictions(
      usageRate,
      windowPercentage,
      weeklyPercentage,
      plan,
      now
    );

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
      modelBreakdown,
      totalCost,
      projectBreakdown,
      usageRate,
      prediction,
    };

    return result;
  }

  /**
   * Get recent session entries for syncing to backend
   * @param sinceTimestamp Only return sessions after this timestamp (for incremental sync)
   * @param limit Maximum number of sessions to return (default 500)
   */
  async getRecentSessions(sinceTimestamp?: Date, limit: number = 500): Promise<UsageSession[]> {
    const entries = await this.getAllUsageEntries();
    const sinceMs = sinceTimestamp?.getTime() ?? 0;

    const sessions: UsageSession[] = [];

    for (const entry of entries) {
      if (entry._tsMs <= sinceMs) continue;

      sessions.push({
        timestamp: entry.timestamp,
        tokens_input: entry.message?.usage?.input_tokens ?? 0,
        tokens_output: entry.message?.usage?.output_tokens ?? 0,
        model: entry.message?.model ?? 'unknown',
        project_hash: this.hashProjectPath(entry.cwd),
      });

      if (sessions.length >= limit) break;
    }

    // Sort by timestamp descending (most recent first)
    sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return sessions.slice(0, limit);
  }

  /**
   * Hash project path for privacy (only first 16 chars of SHA-256)
   */
  private hashProjectPath(cwd?: string): string {
    if (!cwd) return 'unknown';
    return crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  }

  private getWindowStart(entries: EntryWithParsedTime[], now: Date): Date {
    const windowAgo = new Date(now.getTime() - WINDOW_DURATION_MS);
    const windowAgoMs = windowAgo.getTime();

    // Single-pass: find minimum timestamp >= windowAgoMs
    let minTs = Infinity;
    for (const entry of entries) {
      if (entry._tsMs >= windowAgoMs && entry._tsMs < minTs) {
        minTs = entry._tsMs;
      }
    }

    return minTs !== Infinity ? new Date(minTs) : windowAgo;
  }

  private async getAllUsageEntries(): Promise<EntryWithParsedTime[]> {
    try {
      await fsp.access(this.claudeDataPath);
    } catch {
      return [];
    }

    const jsonlFiles = await this.findJsonlFiles(this.claudeDataPath);
    const oneWeekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let filesProcessed = 0;
    let filesSkipped = 0;

    const fileStats = await Promise.all(
      jsonlFiles.map(async (filePath) => {
        try {
          const stat = await fsp.stat(filePath);
          return { filePath, mtime: stat.mtime.getTime() };
        } catch {
          return null;
        }
      })
    );

    const recentFiles = fileStats.filter(
      (f): f is { filePath: string; mtime: number } => f !== null && f.mtime >= oneWeekAgoMs
    );
    filesSkipped = jsonlFiles.length - recentFiles.length;

    const allEntries = await Promise.all(
      recentFiles.map(({ filePath }) => this.parseJsonlFile(filePath))
    );
    filesProcessed = recentFiles.length;

    const entries = allEntries.flat();
    console.log('[Clauder] Files processed:', filesProcessed, ', skipped (old):', filesSkipped);
    return entries;
  }

  private async findJsonlFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const items = await fsp.readdir(dir, { withFileTypes: true });

      const subDirPromises: Promise<string[]>[] = [];

      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          subDirPromises.push(this.findJsonlFiles(fullPath));
        } else if (item.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }

      const subDirFiles = await Promise.all(subDirPromises);
      for (const subFiles of subDirFiles) {
        files.push(...subFiles);
      }
    } catch {
      return files;
    }

    return files;
  }

  private async parseJsonlFile(filePath: string): Promise<EntryWithParsedTime[]> {
    const entries: EntryWithParsedTime[] = [];

    return new Promise((resolve) => {
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line) as SessionEntryWithCwd;
          if (entry.message?.usage) {
            entries.push({ ...entry, _tsMs: new Date(entry.timestamp).getTime() });
          }
        } catch {}
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', () => resolve(entries));
    });
  }
}

export function calculateProjectBreakdown(
  entries: (SessionEntryWithCwd | EntryWithParsedTime)[],
  weekStart: Date,
  now: Date
): ProjectBreakdown {
  const projectMap = new Map<string, ProjectUsage>();
  const basenameCache = new Map<string, string>();
  const weekStartMs = weekStart.getTime();
  const nowMs = now.getTime();

  for (const entry of entries) {
    const timestamp = '_tsMs' in entry ? entry._tsMs : new Date(entry.timestamp).getTime();
    if (timestamp < weekStartMs || timestamp > nowMs) continue;

    const projectPath = entry.cwd || 'Unknown';

    let projectName = basenameCache.get(projectPath);
    if (projectName === undefined) {
      projectName = projectPath === 'Unknown' ? 'Unknown' : path.basename(projectPath) || 'Unknown';
      basenameCache.set(projectPath, projectName);
    }

    const inputTokens = entry.message?.usage?.input_tokens || 0;
    const outputTokens = entry.message?.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const family = getModelFamily(entry.message?.model);
    const pricing = MODEL_PRICING[family];
    const cost = calculateCost(
      inputTokens,
      outputTokens,
      pricing.inputPerMTok,
      pricing.outputPerMTok
    );

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
  entries: (SessionEntryWithCwd | EntryWithParsedTime)[],
  now: Date,
  sampleWindowMs: number = DEFAULT_RATE_WINDOW_MS
): UsageRate {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - sampleWindowMs;
  let sampleTokens = 0;
  let oldestEntryTime = nowMs;

  for (const entry of entries) {
    const timestamp = '_tsMs' in entry ? entry._tsMs : new Date(entry.timestamp).getTime();
    if (timestamp < windowStartMs || timestamp > nowMs) continue;

    const tokens = getEntryTokens(entry);
    sampleTokens += tokens;

    if (timestamp < oldestEntryTime) {
      oldestEntryTime = timestamp;
    }
  }

  if (sampleTokens === 0) {
    return { tokensPerHour: 0, sampleWindowMs, sampleTokens: 0 };
  }

  const elapsedMs = nowMs - oldestEntryTime;
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
