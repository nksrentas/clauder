import * as vscode from 'vscode';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConfigCache } from '~/config';
import { computeResumeDelay, getLimitReset, shouldRemainPaused } from '~/limit';
import type { LimitReset } from '~/limit';
import { SoundPlayer } from '~/sound';
import { SyncManager } from '~/sync';
import type { StatusDisplayType } from '~/types';
import type { CombinedUsage } from '~/ui';
import { StatusBarManager } from '~/ui';
import { UsageApiClient, UsageTracker } from '~/usage';

const SHELL_INTEGRATION_PROMPTED_KEY = 'shellIntegrationPrompted';
const SCRIPT_UPDATE_PROMPTED_KEY = 'scriptUpdatePrompted_v1';
const INSTALL_URL = 'https://hellobussin.com/clauder/install.sh';

let statusBarManager: StatusBarManager;
let usageApiClient: UsageApiClient;
let usageTracker: UsageTracker;
let soundPlayer: SoundPlayer;
let syncManager: SyncManager;
let refreshInterval: NodeJS.Timeout | undefined;
let limitReset: LimitReset | null = null;
let limitResumeTimeout: NodeJS.Timeout | undefined;
let countdownInterval: NodeJS.Timeout | undefined;
let authPromptedThisSession = false;

interface ClauderConfig {
  weeklyThreshold: number;
  refreshInterval: number;
  statusDisplay: StatusDisplayType;
  showProgress: boolean;
}

let configCache: ConfigCache<ClauderConfig> | null = null;

function getClauderConfig(): ClauderConfig {
  if (!configCache) {
    configCache = new ConfigCache(() => {
      const config = vscode.workspace.getConfiguration('clauder');
      return {
        weeklyThreshold: config.get<number>('weeklyHighlightThreshold', 90),
        refreshInterval: config.get<number>('refreshInterval', 30),
        statusDisplay: config.get<StatusDisplayType>('statusDisplay', 'both'),
        showProgress: config.get<boolean>('showProgress', true),
      };
    }, 10_000);
  }
  return configCache.get();
}

function invalidateConfigCache(): void {
  configCache?.invalidate();
  soundPlayer?.invalidateConfigCache();
}

export function activate(context: vscode.ExtensionContext) {
  statusBarManager = new StatusBarManager();
  usageApiClient = new UsageApiClient();
  usageTracker = new UsageTracker();
  soundPlayer = new SoundPlayer(context);
  syncManager = new SyncManager();

  // Update status bar when predictions are received
  syncManager.onPredictionUpdate(() => {
    // Trigger a status bar refresh to show new predictions
    updateStatusBar();
  });

  syncManager.start();

  const refreshCommand = vscode.commands.registerCommand('clauder.refresh', () =>
    updateStatusBar()
  );

  const installShellCommand = vscode.commands.registerCommand(
    'clauder.installShellIntegration',
    () => installShellIntegration()
  );

  const toggleProgressCommand = vscode.commands.registerCommand(
    'clauder.toggleProgress',
    async () => {
      const claudeDir = path.join(os.homedir(), '.claude');
      const settingsPath = path.join(claudeDir, 'settings.json');
      try {
        if (!fs.existsSync(claudeDir)) {
          fs.mkdirSync(claudeDir, { recursive: true });
        }

        let settings: Record<string, unknown> = {};
        if (fs.existsSync(settingsPath)) {
          const content = fs.readFileSync(settingsPath, 'utf-8');
          settings = JSON.parse(content);
        }

        if (settings.statusLine) {
          settings._statusLineBackup = settings.statusLine;
          delete settings.statusLine;
        } else if (settings._statusLineBackup) {
          settings.statusLine = settings._statusLineBackup;
          delete settings._statusLineBackup;
        } else {
          settings.statusLine = {
            type: 'command',
            command: 'bash ~/.claude/statusline-command.sh',
          };
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        vscode.window.showInformationMessage(
          settings.statusLine ? 'Shell progress enabled' : 'Shell progress disabled'
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to toggle shell progress: ${err}`);
      }
    }
  );

  const syncSoundsCommand = vscode.commands.registerCommand('clauder.syncSoundSettings', () =>
    syncSoundSettings()
  );

  const toggleSoundsCommand = vscode.commands.registerCommand('clauder.toggleSounds', async () => {
    const config = vscode.workspace.getConfiguration('clauder.sounds');
    const currentEnabled = config.get<boolean>('enabled', true);
    await config.update('enabled', !currentEnabled, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `Sound notifications ${!currentEnabled ? 'enabled' : 'disabled'}`
    );
  });

  context.subscriptions.push(
    refreshCommand,
    installShellCommand,
    toggleProgressCommand,
    syncSoundsCommand,
    toggleSoundsCommand,
    {
      dispose: () => {
        statusBarManager.dispose();
        stopRefreshInterval();
      },
    }
  );

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('clauder')) {
      invalidateConfigCache();
      setupRefreshInterval();
      updateStatusDisplay();
      updateStatusBar();
    }
    if (e.affectsConfiguration('clauder.sounds')) {
      invalidateConfigCache();
      syncSoundSettings();
    }
    if (e.affectsConfiguration('clauder.sync')) {
      syncManager.restart();
    }
  });
  context.subscriptions.push(configListener);

  updateStatusDisplay();
  setupRefreshInterval();
  updateStatusBar();
  promptShellIntegration(context);
  checkScriptVersion(context);
}

async function updateStatusBar(): Promise<void> {
  if (limitReset) {
    if (shouldRemainPaused(limitReset)) {
      statusBarManager.showLimitReached(limitReset);
      return;
    }
    clearLimitPause();
    setupRefreshInterval();
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

    authPromptedThisSession = false;

    let localData = null;
    try {
      const config = getClauderConfig();
      statusBarManager.setWeeklyThreshold(config.weeklyThreshold);
      localData = await usageTracker.calculateUsage('pro');
    } catch {
      console.log('[Clauder] Local data fetch failed, continuing with API only');
    }

    const combined: CombinedUsage = {
      api: result.data,
      local: localData,
      prediction: syncManager?.getPrediction() ?? null,
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

    if (result.data) {
      const maxUtil = Math.max(result.data.session.utilization, result.data.weeklyAll.utilization);
      soundPlayer.checkRateLimitThreshold(maxUtil);

      // Notify sync manager of new utilization data
      syncManager?.onUtilizationUpdate(
        result.data.session.utilization,
        result.data.weeklyAll.utilization
      );

      // Fetch and queue recent sessions for sync (incremental based on last synced timestamp)
      try {
        const recentSessions = await usageTracker.getRecentSessions(
          syncManager?.getLastSyncedSessionTimestamp() ?? undefined
        );
        if (recentSessions.length > 0) {
          syncManager?.setSessions(recentSessions);
          console.log(`[Clauder] Queued ${recentSessions.length} sessions for sync`);
        }
      } catch {
        console.log('[Clauder] Failed to fetch recent sessions for sync');
      }
    }

    console.log('[Clauder] API data:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    statusBarManager.showError(message);
  }
}

async function promptForAuthentication(): Promise<void> {
  if (authPromptedThisSession) {
    return;
  }
  authPromptedThisSession = true;

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

  const config = getClauderConfig();
  refreshInterval = setInterval(() => updateStatusBar(), config.refreshInterval * 1000);
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
  const config = getClauderConfig();
  statusBarManager.setVisible(config.statusDisplay !== 'shell' && config.showProgress);
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

  if (action === 'Install Shell Integration') {
    await installShellIntegration();
    await context.globalState.update(SHELL_INTEGRATION_PROMPTED_KEY, true);
  } else if (action === "Don't Show Again") {
    await context.globalState.update(SHELL_INTEGRATION_PROMPTED_KEY, true);
  }
}

async function checkScriptVersion(context: vscode.ExtensionContext): Promise<void> {
  const alreadyPrompted = context.globalState.get<boolean>(SCRIPT_UPDATE_PROMPTED_KEY);
  if (alreadyPrompted) {
    return;
  }

  const possiblePaths = [
    path.join(os.homedir(), '.claude', 'scripts', 'statusline-command.sh'),
    path.join(os.homedir(), '.claude', 'statusline-command.sh'),
  ];

  const scriptPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!scriptPath) {
    return;
  }

  try {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    if (content.includes('tmp.$$')) {
      return; // Already updated
    }

    const action = await vscode.window.showWarningMessage(
      'Your Claude statusline script is outdated. Update to fix disappearing progress bars.',
      'Update Now',
      'Remind Later',
      "Don't Show Again"
    );

    if (action === 'Update Now') {
      await installShellIntegration();
      await context.globalState.update(SCRIPT_UPDATE_PROMPTED_KEY, true);
    } else if (action === "Don't Show Again") {
      await context.globalState.update(SCRIPT_UPDATE_PROMPTED_KEY, true);
    }
  } catch (err) {
    console.log('[Clauder] Could not check script version:', err);
  }
}

function syncSoundSettings(): void {
  try {
    const config = vscode.workspace.getConfiguration('clauder.sounds');
    const enabled = config.get<boolean>('enabled', true);
    const enabledFile = path.join(os.homedir(), '.claude', 'sounds-enabled');

    const claudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    fs.writeFileSync(enabledFile, enabled ? 'true' : 'false');
    console.log('[Clauder] Sound settings synced:', enabled);
  } catch (err) {
    console.log('[Clauder] Failed to sync sound settings:', err);
  }
}

export function deactivate() {
  clearLimitPause();
  stopRefreshInterval();
  stopCountdownInterval();
  syncManager?.stop();
  authPromptedThisSession = false;
  configCache = null;
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
  soundPlayer?.resetThresholdState();
}
