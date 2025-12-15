import type { UsageData } from '~/usage-api';

export function getLimitReset(data: UsageData | null): Date | null {
  if (!data) {
    return null;
  }

  if (data.session.utilization >= 100 && data.session.resetsAt) {
    return data.session.resetsAt;
  }

  return null;
}

export function shouldRemainPaused(limitResetAt: Date | null, now: Date = new Date()): boolean {
  return !!limitResetAt && limitResetAt > now;
}

export function computeResumeDelay(resetAt: Date, nowMs: number = Date.now()): number {
  return Math.max(0, resetAt.getTime() - nowMs);
}
