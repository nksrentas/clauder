import * as vscode from 'vscode';

import { SyncApiClient } from './api';
import { SyncConfig, SyncPayload, SyncResult } from './types';

/**
 * Manages periodic syncing of usage data to the Clauder backend
 */
export class SyncManager {
  private apiClient: SyncApiClient;
  private syncInterval: NodeJS.Timeout | undefined;
  private lastSyncAt: Date | null = null;
  private lastInteractionAt: Date = new Date();
  private lastUtilization: { session: number; weekly: number } = { session: 0, weekly: 0 };
  private config: SyncConfig;

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
    };

    console.log('[Clauder Sync] Syncing to backend...');
    const result = await this.apiClient.sync(payload);

    if (result.status === 'success') {
      this.lastSyncAt = new Date();
      console.log(
        `[Clauder Sync] Sync successful: ${result.data.synced} records, velocity_updated: ${result.data.velocity_updated}`
      );
    } else if (result.status === 'error') {
      console.log(`[Clauder Sync] Sync failed: ${result.error}`);
    }

    return result;
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
}
