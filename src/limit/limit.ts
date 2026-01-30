import type { UsageData } from '~/usage';

export type LimitKind = 'session' | 'weeklyAll' | 'weeklySonnet';

export type LimitReset = {
  kind: LimitKind;
  resetAt: Date;
};

export const DEFAULT_WEEKLY_ALERT_THRESHOLD = 90;

export function getLimitReset(data: UsageData | null): LimitReset | null {
  if (!data) {
    return null;
  }

  if (data.session.utilization >= 100 && data.session.resetsAt) {
    return { kind: 'session', resetAt: data.session.resetsAt };
  }

  if (data.weeklyAll.utilization >= 100 && data.weeklyAll.resetsAt) {
    return { kind: 'weeklyAll', resetAt: data.weeklyAll.resetsAt };
  }

  if (data.weeklySonnet && data.weeklySonnet.utilization >= 100 && data.weeklySonnet.resetsAt) {
    return { kind: 'weeklySonnet', resetAt: data.weeklySonnet.resetsAt };
  }

  return null;
}

export function shouldRemainPaused(limit: LimitReset | null, now: Date = new Date()): boolean {
  return !!limit && limit.resetAt > now;
}

export function computeResumeDelay(limit: LimitReset, nowMs: number = Date.now()): number {
  return Math.max(0, limit.resetAt.getTime() - nowMs);
}

export function shouldHighlightWeekly(
  data: UsageData | null,
  threshold: number = DEFAULT_WEEKLY_ALERT_THRESHOLD
): boolean {
  if (!data || !data.weeklyAll.resetsAt) {
    return false;
  }

  return data.weeklyAll.utilization >= threshold;
}
