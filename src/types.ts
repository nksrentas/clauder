export type PlanType = 'pro' | 'max5' | 'max20';

export type StatusDisplayType = 'both' | 'vscode' | 'shell';

// Platform identifiers
export const PLATFORM = {
  DARWIN: 'darwin',
  WIN32: 'win32',
  LINUX: 'linux',
} as const;

// Model families
export const MODEL_FAMILY = {
  OPUS: 'opus',
  SONNET: 'sonnet',
  HAIKU: 'haiku',
  UNKNOWN: 'unknown',
} as const;

// Sound notification types
export const SOUND_TYPE = {
  COMPLETE: 'complete',
  WARNING: 'warning',
  LIMIT: 'limit',
} as const;

// API fetch result status
export const FETCH_STATUS = {
  SUCCESS: 'success',
  NO_TOKEN: 'no_token',
  ERROR: 'error',
} as const;

// Sound player executables
export const SOUND_EXECUTABLE = {
  AFPLAY: 'afplay',
  POWERSHELL: 'powershell',
  BASH: 'bash',
} as const;

// Keychain service name
export const KEYCHAIN_SERVICE = 'Claude Code-credentials';

export interface TokenUsageData {
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
    usage?: TokenUsageData;
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
  modelBreakdown: Record<ModelFamily, ModelUsage>;
  totalCost: number;
  projectBreakdown?: ProjectBreakdown;
  usageRate?: UsageRate;
  prediction?: LimitPrediction;
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

export type SessionEntryWithCwd = SessionEntry & {
  cwd?: string;
};

export type ProjectUsage = {
  projectPath: string;
  projectName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  cost: number;
  percentage: number;
};

export type ProjectBreakdown = {
  projects: ProjectUsage[];
  totalTokens: number;
  totalCost: number;
};

export type UsageRate = {
  tokensPerHour: number;
  sampleWindowMs: number;
  sampleTokens: number;
};

export type LimitPrediction = {
  sessionLimitAt: Date | null;
  weeklyLimitAt: Date | null;
  timeToSessionLimit: number | null;
  timeToWeeklyLimit: number | null;
  canPredict: boolean;
  reason?: 'no_recent_usage' | 'already_at_limit';
};

// Billing mode - subscription (rate limits) vs API key (pay-per-token)
export type BillingMode = 'subscription' | 'api_key' | 'unknown';

// Cost summary for API key users
export interface CostSummary {
  dailyCost: number;
  weeklyCost: number;
  monthlyCost: number;
  modelBreakdown: {
    opus?: { cost: number; inputTokens: number; outputTokens: number };
    sonnet?: { cost: number; inputTokens: number; outputTokens: number };
    haiku?: { cost: number; inputTokens: number; outputTokens: number };
  };
}

// Limit status returned from backend
export interface LimitStatus {
  isBlocked: boolean;
  blockReason: string | null;
  warnings: string[];
  dailyUsedUsd: number;
  dailyLimitUsd: number | null;
  weeklyUsedUsd: number;
  weeklyLimitUsd: number | null;
  monthlyUsedUsd: number;
  monthlyLimitUsd: number | null;
}
