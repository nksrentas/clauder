import * as vscode from 'vscode';

import type { CombinedUsage } from '~/status-bar';
import { StatusBarManager } from '~/status-bar';
import { computeResumeDelay, getLimitReset, shouldRemainPaused } from '~/limit';
import type { LimitReset } from '~/limit';
import type { PlanType } from '~/types';
import { UsageApiClient } from '~/usage-api';
import { UsageTracker } from '~/usage-tracker';

let statusBarManager: StatusBarManager;
let usageApiClient: UsageApiClient;
let usageTracker: UsageTracker;
let refreshInterval: NodeJS.Timeout | undefined;
let limitReset: LimitReset | null = null;
let limitResumeTimeout: NodeJS.Timeout | undefined;

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

  setupRefreshInterval();
  updateStatusBar();
}

async function updateStatusBar(): Promise<void> {
  if (limitReset && !shouldRemainPaused(limitReset)) {
    clearLimitPause();
    setupRefreshInterval();
  }

  if (shouldRemainPaused(limitReset)) {
    statusBarManager.showLimitReached(limitReset!);
    return;
  }

  try {
    statusBarManager.showLoading();

    const result = await usageApiClient.fetchUsage();

    if (result.status === 'no_token') {
      statusBarManager.showNotAuthenticated();
      promptForAuthentication();
      return;
    }

    if (result.status === 'error') {
      statusBarManager.showError(result.message);
      return;
    }

    let localData = null;
    try {
      const config = vscode.workspace.getConfiguration('clauder');
      const plan = config.get<PlanType>('plan', 'max5');
      const rotationInterval = config.get<number>('weeklyHighlightInterval', 30) * 1000;
      statusBarManager.setWeeklyRotationInterval(rotationInterval);
      localData = await usageTracker.calculateUsage(plan);
    } catch {
      console.log('[Clauder] Local data fetch failed, continuing with API only');
    }

    const combined: CombinedUsage = {
      api: result.data,
      local: localData,
    };

    const resetTime = getLimitReset(result.data);
    if (resetTime) {
      limitReset = resetTime;
      statusBarManager.showLimitReached(resetTime);
      stopRefreshInterval();
      scheduleLimitResume(resetTime);
      return;
    }

    statusBarManager.update(combined);
    console.log('[Clauder] API data:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    statusBarManager.showError(message);
  }
}

async function promptForAuthentication(): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    'Claude Code credentials not found. Please authenticate to see usage data.',
    'Authenticate'
  );

  if (action === 'Authenticate') {
    const terminal = vscode.window.createTerminal('Claude Auth');
    terminal.show();
    terminal.sendText('claude');
  }
}

function setupRefreshInterval(): void {
  stopRefreshInterval();

  if (shouldRemainPaused(limitReset)) {
    return;
  }

  const config = vscode.workspace.getConfiguration('clauder');
  const intervalSeconds = config.get<number>('refreshInterval', 30);

  refreshInterval = setInterval(() => updateStatusBar(), intervalSeconds * 1000);
}

function stopRefreshInterval(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
}

export function deactivate() {
  clearLimitPause();
  stopRefreshInterval();
  clearLimitResumeTimeout();
}

function scheduleLimitResume(limit: LimitReset): void {
  clearLimitResumeTimeout();

  const delay = computeResumeDelay(limit);
  if (delay <= 0) {
    clearLimitPause();
    setupRefreshInterval();
    updateStatusBar();
    return;
  }

  limitResumeTimeout = setTimeout(() => {
    clearLimitPause();
    setupRefreshInterval();
    updateStatusBar();
  }, delay + 1000);
}

function clearLimitResumeTimeout(): void {
  if (limitResumeTimeout) {
    clearTimeout(limitResumeTimeout);
    limitResumeTimeout = undefined;
  }
}

function clearLimitPause(): void {
  limitReset = null;
  clearLimitResumeTimeout();
}
