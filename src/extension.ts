import * as vscode from 'vscode';

import * as chokidar from 'chokidar';

import type { CombinedUsage } from '~/status-bar';
import { StatusBarManager } from '~/status-bar';
import type { PlanType } from '~/types';
import { UsageApiClient } from '~/usage-api';
import { UsageTracker } from '~/usage-tracker';

let statusBarManager: StatusBarManager;
let usageApiClient: UsageApiClient;
let usageTracker: UsageTracker;
let fileWatcher: chokidar.FSWatcher | undefined;
let refreshInterval: NodeJS.Timeout | undefined;
let debounceTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  statusBarManager = new StatusBarManager();
  usageApiClient = new UsageApiClient();
  usageTracker = new UsageTracker();

  const refreshCommand = vscode.commands.registerCommand('clauder.refresh', () =>
    updateStatusBar()
  );

  context.subscriptions.push(refreshCommand, {
    dispose: () => {
      statusBarManager.dispose();
      stopFileWatcher();
      stopRefreshInterval();
    },
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('clauder')) {
      setupRefreshInterval();
      updateStatusBar();
    }
  });
  context.subscriptions.push(configListener);

  setupFileWatcher();
  setupRefreshInterval();
  updateStatusBar();
}

async function updateStatusBar(): Promise<void> {
  try {
    statusBarManager.showLoading();

    const apiData = await usageApiClient.fetchUsage();

    let localData = null;
    try {
      const config = vscode.workspace.getConfiguration('clauder');
      const plan = config.get<PlanType>('plan', 'max5');
      localData = await usageTracker.calculateUsage(plan);
    } catch {
      console.log('[Clauder] Local data fetch failed, continuing with API only');
    }

    const combined: CombinedUsage = {
      api: apiData,
      local: localData,
    };

    statusBarManager.update(combined);

    if (apiData) {
      console.log('[Clauder] API data:', JSON.stringify(apiData, null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    statusBarManager.showError(message);
  }
}

function setupFileWatcher(): void {
  stopFileWatcher();

  const claudePath = usageTracker.getClaudeDataPath();

  try {
    fileWatcher = chokidar.watch(`${claudePath}/**/*.jsonl`, {
      ignoreInitial: true,
      persistent: true,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    fileWatcher.on('change', () => debouncedUpdate());
    fileWatcher.on('add', () => debouncedUpdate());
  } catch {
    // File watcher setup failed - rely on interval refresh
  }
}

function debouncedUpdate(): void {
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }
  debounceTimeout = setTimeout(() => updateStatusBar(), 500);
}

function stopFileWatcher(): void {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = undefined;
  }
}

function setupRefreshInterval(): void {
  stopRefreshInterval();

  const config = vscode.workspace.getConfiguration('clauder');
  const intervalSeconds = config.get<number>('refreshInterval', 30);

  refreshInterval = setInterval(() => updateStatusBar(), intervalSeconds * 1000);
}

function stopRefreshInterval(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
    debounceTimeout = undefined;
  }
}

export function deactivate() {
  stopFileWatcher();
  stopRefreshInterval();
}
