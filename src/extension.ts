import * as vscode from 'vscode';

import type { CombinedUsage } from '~/status-bar';
import { StatusBarManager } from '~/status-bar';
import { computeResumeDelay, getLimitReset, shouldRemainPaused } from '~/limit';
import type { LimitReset } from '~/limit';
import type { PlanType, StatusDisplayType } from '~/types';
import { UsageApiClient } from '~/usage-api';
import { UsageTracker } from '~/usage-tracker';

const SHELL_INTEGRATION_PROMPTED_KEY = 'shellIntegrationPrompted';
const INSTALL_URL = 'https://hellobussin.com/clauder/install.sh';

let statusBarManager: StatusBarManager;
let usageApiClient: UsageApiClient;
let usageTracker: UsageTracker;
let refreshInterval: NodeJS.Timeout | undefined;
let limitReset: LimitReset | null = null;
let limitResumeTimeout: NodeJS.Timeout | undefined;
let countdownInterval: NodeJS.Timeout | undefined;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  statusBarManager = new StatusBarManager();
  usageApiClient = new UsageApiClient();
  usageTracker = new UsageTracker();

  const refreshCommand = vscode.commands.registerCommand('clauder.refresh', () =>
    updateStatusBar()
  );

  const installShellCommand = vscode.commands.registerCommand(
    'clauder.installShellIntegration',
    () => installShellIntegration()
  );

  context.subscriptions.push(refreshCommand, installShellCommand, {
    dispose: () => {
      statusBarManager.dispose();
      stopRefreshInterval();
    },
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('clauder')) {
      setupRefreshInterval();
      updateStatusDisplay();
      updateStatusBar();
    }
  });
  context.subscriptions.push(configListener);

  updateStatusDisplay();
  setupRefreshInterval();
  updateStatusBar();
  promptShellIntegration(context);
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
      const plan = config.get<PlanType>('plan', 'pro');
      const weeklyThreshold = config.get<number>('weeklyHighlightThreshold', 90);
      statusBarManager.setWeeklyThreshold(weeklyThreshold);
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

function startCountdownInterval(): void {
  stopCountdownInterval();
  countdownInterval = setInterval(() => {
    if (limitReset) {
      statusBarManager.showLimitReached(limitReset);
    }
  }, 60_000);
}

function stopCountdownInterval(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = undefined;
  }
}

function updateStatusDisplay(): void {
  const config = vscode.workspace.getConfiguration('clauder');
  const statusDisplay = config.get<StatusDisplayType>('statusDisplay', 'both');
  statusBarManager.setVisible(statusDisplay !== 'shell');
}

async function installShellIntegration(): Promise<void> {
  const terminal = vscode.window.createTerminal('Claude Shell Integration');
  terminal.show();
  terminal.sendText(`curl -fsSL ${INSTALL_URL} | bash`);

  vscode.window.showInformationMessage(
    'Shell integration installer started. Follow the instructions in the terminal.'
  );
}

async function promptShellIntegration(context: vscode.ExtensionContext): Promise<void> {
  const alreadyPrompted = context.globalState.get<boolean>(SHELL_INTEGRATION_PROMPTED_KEY);
  if (alreadyPrompted) {
    return;
  }

  const action = await vscode.window.showInformationMessage(
    'Enhance your terminal with Claude usage stats.',
    'Install Shell Integration',
    "Don't Show Again"
  );

  await context.globalState.update(SHELL_INTEGRATION_PROMPTED_KEY, true);

  if (action === 'Install Shell Integration') {
    await installShellIntegration();
  }
}

export function deactivate() {
  clearLimitPause();
  stopRefreshInterval();
  stopCountdownInterval();
}

function scheduleLimitResume(limit: LimitReset): void {
  clearLimitResumeTimeout();
  startCountdownInterval();

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
  stopCountdownInterval();
}
