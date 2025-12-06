import type { ModelFamily, SessionEntry } from '~/types';

export function getModelFamily(model?: string): ModelFamily {
  if (!model) return 'unknown';
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function getEntryTokens(entry: SessionEntry): number {
  const usage = entry.message?.usage;
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0);
}

export function getWeekBoundaries(now: Date): { weekStart: Date; weekEnd: Date } {
  const weekStart = new Date(now);
  const dayOfWeek = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  return { weekStart, weekEnd };
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPerMTok: number,
  outputPerMTok: number
): number {
  return (inputTokens / 1_000_000) * inputPerMTok + (outputTokens / 1_000_000) * outputPerMTok;
}
