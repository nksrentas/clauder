/**
 * Sync module types for backend communication
 */

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
 * Payload sent to the backend sync endpoint
 */
export interface SyncPayload {
  license_key: string;
  timestamp: string;
  current_5h_utilization_pct: number;
  current_weekly_utilization_pct: number;
  last_interaction_at: string;
  sessions?: UsageSession[];
}

/**
 * Response from the backend sync endpoint
 */
export interface SyncResponse {
  synced: number;
  velocity_updated: boolean;
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
