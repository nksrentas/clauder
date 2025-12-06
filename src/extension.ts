import * as vscode from 'vscode';

import type { CombinedUsage } from '~/status-bar';
import { StatusBarManager } from '~/status-bar';
import type { PlanType } from '~/types';
import { UsageApiClient } from '~/usage-api';
import { UsageTracker } from '~/usage-tracker';

let statusBarManager: StatusBarManager;
let usageApiClient: UsageApiClient;
let usageTracker: UsageTracker;
let refreshInterval: NodeJS.Timeout | undefined;

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
      localData = await usageTracker.calculateUsage(plan);
    } catch {
      console.log('[Clauder] Local data fetch failed, continuing with API only');
    }

    const combined: CombinedUsage = {
      api: result.data,
      local: localData,
    };

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
  stopRefreshInterval();
}
