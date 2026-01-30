import { MODEL_FAMILY, type ModelFamily, type SessionEntry } from '~/types';

const modelFamilyCache = new Map<string, ModelFamily>();

export function getModelFamily(model?: string): ModelFamily {
  if (!model) return MODEL_FAMILY.UNKNOWN;

  const cached = modelFamilyCache.get(model);
  if (cached !== undefined) return cached;

  const lower = model.toLowerCase();
  let family: ModelFamily;
  if (lower.includes(MODEL_FAMILY.OPUS)) {
    family = MODEL_FAMILY.OPUS;
  } else if (lower.includes(MODEL_FAMILY.SONNET)) {
    family = MODEL_FAMILY.SONNET;
  } else if (lower.includes(MODEL_FAMILY.HAIKU)) {
    family = MODEL_FAMILY.HAIKU;
  } else {
    family = MODEL_FAMILY.UNKNOWN;
  }

  modelFamilyCache.set(model, family);
  return family;
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

export function getRemainingTokens(currentPercent: number, limitTokens: number): number {
  const remainingPercent = Math.max(0, 100 - currentPercent);
  return (remainingPercent / 100) * limitTokens;
}

export function estimateTimeToLimit(remainingTokens: number, tokensPerHour: number): number | null {
  if (tokensPerHour <= 0) return null;
  return (remainingTokens / tokensPerHour) * 60 * 60 * 1000;
}
