import * as vscode from 'vscode';

import { SyncApiClient } from './api';
import { PredictionResponse, SyncConfig, SyncPayload, SyncResult, UsageSession } from './types';

/**
 * Manages periodic syncing of usage data to the Clauder backend
 */
export class SyncManager {
  private apiClient: SyncApiClient;
  private syncInterval: NodeJS.Timeout | undefined;
  private lastSyncAt: Date | null = null;
  private lastSyncedSessionTimestamp: Date | null = null;
  private lastInteractionAt: Date = new Date();
  private lastUtilization: { session: number; weekly: number } = { session: 0, weekly: 0 };
  private lastPrediction: PredictionResponse | null = null;
  private config: SyncConfig;
  private pendingSessions: UsageSession[] = [];
  private onPredictionUpdateCallback: ((prediction: PredictionResponse | null) => void) | null =
    null;

  constructor() {
    this.config = this.getConfig();
    this.apiClient = new SyncApiClient(this.config.backendUrl);
  }

  /**
   * Get sync configuration from VS Code settings
   */
  private getConfig(): SyncConfig {
    const config = vscode.workspace.getConfiguration('clauder.sync');
    return {
      enabled: config.get<boolean>('enabled', false),
      licenseKey: config.get<string>('licenseKey', ''),
      backendUrl: config.get<string>('backendUrl', 'https://clauder.app'),
      interval: config.get<number>('interval', 30),
    };
  }

  /**
   * Reload configuration from VS Code settings
   */
  reloadConfig(): void {
    this.config = this.getConfig();
    this.apiClient.setBackendUrl(this.config.backendUrl);
  }

  /**
   * Check if sync is properly configured and enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && !!this.config.licenseKey;
  }

  /**
   * Start the sync timer
   */
  start(): void {
    if (!this.isEnabled()) {
      console.log('[Clauder Sync] Sync disabled or no license key');
      return;
    }

    this.stop(); // Clear any existing interval

    console.log(`[Clauder Sync] Starting sync every ${this.config.interval}s`);
    this.syncInterval = setInterval(() => {
      this.syncIfNeeded();
    }, this.config.interval * 1000);
  }

  /**
   * Stop the sync timer
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
      console.log('[Clauder Sync] Sync stopped');
    }
  }

  /**
   * Restart sync with potentially new configuration
   */
  restart(): void {
    this.reloadConfig();
    this.stop();
    this.start();
  }

  /**
   * Called when new utilization data is received from the API
   * Updates interaction timestamp if utilization increased
   */
  onUtilizationUpdate(sessionUtil: number, weeklyUtil: number): void {
    // Detect if utilization increased (user is actively using Claude)
    if (sessionUtil > this.lastUtilization.session || weeklyUtil > this.lastUtilization.weekly) {
      this.lastInteractionAt = new Date();
      console.log('[Clauder Sync] Interaction detected, updating timestamp');
    }

    this.lastUtilization = { session: sessionUtil, weekly: weeklyUtil };
  }

  /**
   * Set sessions to be synced on next sync cycle
   */
  setSessions(sessions: UsageSession[]): void {
    this.pendingSessions = sessions;
  }

  /**
   * Get the timestamp of the last successfully synced session
   * Used for incremental syncing (only sync sessions newer than this)
   */
  getLastSyncedSessionTimestamp(): Date | null {
    return this.lastSyncedSessionTimestamp;
  }

  /**
   * Perform sync if enough time has passed since last sync
   */
  private async syncIfNeeded(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    // Don't sync if we just synced recently (within half the interval)
    if (this.lastSyncAt) {
      const timeSinceLastSync = Date.now() - this.lastSyncAt.getTime();
      const minInterval = (this.config.interval * 1000) / 2;
      if (timeSinceLastSync < minInterval) {
        return;
      }
    }

    await this.sync();
  }

  /**
   * Perform sync to backend
   */
  async sync(): Promise<SyncResult> {
    if (!this.isEnabled()) {
      return { status: 'disabled' };
    }

    const payload: SyncPayload = {
      license_key: this.config.licenseKey,
      timestamp: new Date().toISOString(),
      current_5h_utilization_pct: this.lastUtilization.session,
      current_weekly_utilization_pct: this.lastUtilization.weekly,
      last_interaction_at: this.lastInteractionAt.toISOString(),
      sessions: this.pendingSessions.length > 0 ? this.pendingSessions : undefined,
    };

    console.log(
      `[Clauder Sync] Syncing to backend... (${this.pendingSessions.length} sessions queued)`
    );
    const result = await this.apiClient.sync(payload);

    if (result.status === 'success') {
      this.lastSyncAt = new Date();
      console.log(
        `[Clauder Sync] Sync successful: ${result.data.synced} records, velocity_updated: ${result.data.velocity_updated}`
      );

      // Track the most recent session timestamp for incremental sync
      if (this.pendingSessions.length > 0) {
        const mostRecentSession = this.pendingSessions.reduce((latest, session) => {
          const sessionTime = new Date(session.timestamp).getTime();
          const latestTime = new Date(latest.timestamp).getTime();
          return sessionTime > latestTime ? session : latest;
        });
        this.lastSyncedSessionTimestamp = new Date(mostRecentSession.timestamp);
      }

      // Clear pending sessions after successful sync
      this.pendingSessions = [];

      // Fetch predictions after successful sync
      await this.fetchPrediction();
    } else if (result.status === 'error') {
      console.log(`[Clauder Sync] Sync failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Fetch prediction data from backend
   */
  private async fetchPrediction(): Promise<void> {
    const result = await this.apiClient.fetchPrediction(this.config.licenseKey);

    if (result.status === 'success') {
      this.lastPrediction = result.data;
      console.log('[Clauder Sync] Prediction fetched:', {
        eta: result.data.five_hour.eta_human,
        weekly: result.data.weekly.projected_pct_human,
      });
      this.onPredictionUpdateCallback?.(result.data);
    } else if (result.status === 'error') {
      console.log(`[Clauder Sync] Prediction fetch failed: ${result.error}`);
      // Keep last prediction on error (don't clear it)
    }
  }

  /**
   * Get the last sync timestamp
   */
  getLastSyncAt(): Date | null {
    return this.lastSyncAt;
  }

  /**
   * Get the last interaction timestamp
   */
  getLastInteractionAt(): Date {
    return this.lastInteractionAt;
  }

  /**
   * Get the last prediction data
   */
  getPrediction(): PredictionResponse | null {
    return this.lastPrediction;
  }

  /**
   * Set callback for prediction updates
   */
  onPredictionUpdate(callback: (prediction: PredictionResponse | null) => void): void {
    this.onPredictionUpdateCallback = callback;
  }
}
