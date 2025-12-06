export type PlanType = 'pro' | 'max5' | 'max20';

export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface SessionEntry {
  timestamp: string;
  sessionId?: string;
  message?: {
    model?: string;
    usage?: UsageData;
  };
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'unknown';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
  cost: number;
}

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<ModelFamily, ModelPricing> = {
  opus: { inputPerMTok: 15, outputPerMTok: 75 },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  haiku: { inputPerMTok: 1, outputPerMTok: 5 },
  unknown: { inputPerMTok: 3, outputPerMTok: 15 },
};

export interface UsageSummary {
  windowTokens: number;
  weeklyTokens: number;
  windowPercentage: number;
  weeklyPercentage: number;
  estimatedHoursUsed: number;
  windowStartTime: Date;
  windowEndTime: Date;
  weekStartTime: Date;
  weekEndTime: Date;
  plan: PlanType;
  modelBreakdown: Record<ModelFamily, ModelUsage>;
  totalCost: number;
}

export interface PlanLimits {
  windowTokens: number;
  weeklyHours: number;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  pro: {
    windowTokens: 500000,
    weeklyHours: 60,
  },
  max5: {
    windowTokens: 2500000,
    weeklyHours: 210,
  },
  max20: {
    windowTokens: 10000000,
    weeklyHours: 360,
  },
};

export const WINDOW_DURATION_MS = 5 * 60 * 60 * 1000;
export const TOKENS_PER_HOUR_ESTIMATE = 50000;
