/**
 * Sync module types for backend communication
 */

import type { BillingMode } from '~/types';

/**
 * Individual usage session data for detailed tracking
 */
export interface UsageSession {
  timestamp: string;
  tokens_input: number;
  tokens_output: number;
  model: string;
  project_hash: string;
}

/**
 * Cost data for API key users
 */
export interface CostData {
  daily_cost_usd: number;
  weekly_cost_usd: number;
  monthly_cost_usd: number;
  model_breakdown?: {
    opus?: { cost: number; input_tokens: number; output_tokens: number };
    sonnet?: { cost: number; input_tokens: number; output_tokens: number };
    haiku?: { cost: number; input_tokens: number; output_tokens: number };
  };
}

/**
 * Limit status returned from backend
 */
export interface LimitStatusResponse {
  is_blocked: boolean;
  block_reason: string | null;
  warnings: string[];
  daily_used_usd: number;
  daily_limit_usd: number | null;
  weekly_used_usd: number;
  weekly_limit_usd: number | null;
  monthly_used_usd: number;
  monthly_limit_usd: number | null;
}

/**
 * Payload sent to the backend sync endpoint
 */
export interface SyncPayload {
  license_key: string;
  timestamp: string;
  current_5h_utilization_pct: number;
  current_weekly_utilization_pct: number;
  last_interaction_at: string;
  sessions?: UsageSession[];

  // Cost tracking fields (API key mode)
  billing_mode?: BillingMode;
  api_key_prefix?: string;
  cost_data?: CostData;
}

/**
 * Response from the backend sync endpoint
 */
export interface SyncResponse {
  synced: number;
  velocity_updated: boolean;
  limit_status?: LimitStatusResponse | null;
}

/**
 * Result wrapper for sync operations
 */
export type SyncResult =
  | { status: 'success'; data: SyncResponse }
  | { status: 'error'; error: string }
  | { status: 'disabled' };

/**
 * Configuration for sync functionality
 */
export interface SyncConfig {
  enabled: boolean;
  licenseKey: string;
  backendUrl: string;
  interval: number;
}

/**
 * Confidence information for predictions
 */
export interface PredictionConfidence {
  score: number;
  tier: 'high' | 'medium' | 'low' | 'insufficient';
}

/**
 * 5-hour prediction data
 */
export interface FiveHourPrediction {
  current_pct: number;
  eta_human: string | null;
  mode: 'velocity' | 'pattern';
  confidence: PredictionConfidence;
  burn_rate_pct_per_min: number | null;
}

/**
 * Weekly prediction data
 */
export interface WeeklyPrediction {
  current_pct: number;
  projected_pct: number;
  projected_pct_human: string;
  breach_day: string | null;
  confidence: PredictionConfidence;
}

/**
 * Session state information
 */
export interface SessionState {
  state: 'active' | 'idle';
  last_interaction_at: string;
}

/**
 * Full prediction response from backend
 */
export interface PredictionResponse {
  five_hour: FiveHourPrediction;
  weekly: WeeklyPrediction;
  session: SessionState;
  cached_at: string;
}

/**
 * Result wrapper for prediction operations
 */
export type PredictionResult =
  | { status: 'success'; data: PredictionResponse }
  | { status: 'error'; error: string }
  | { status: 'disabled' };
