import * as vscode from 'vscode';

import { formatResetDay, formatTimeRemaining, formatTokens, getUsageColor } from './formatters';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConfigCache } from '~/config/cache';
import { DEFAULT_WEEKLY_ALERT_THRESHOLD, shouldHighlightWeekly } from '~/limit';
import type { LimitKind, LimitReset } from '~/limit';
import type { PredictionResponse } from '~/sync';
import type { ProjectBreakdown, UsageSummary } from '~/types';
import type { UsageData } from '~/usage';

const SHELL_SETTINGS_CACHE_TTL = 30_000;

const CLAUDE_ORANGE = '#E8956A';

const LIMIT_LABELS: Record<LimitKind, string> = {
  session: '5h limit reached',
  weeklyAll: 'Weekly limit reached',
  weeklySonnet: 'Weekly Sonnet limit reached',
};

const LIMIT_TOOLTIPS: Record<LimitKind, (resetDisplay: string, timeRemaining: string) => string> = {
  session: (_reset, time) => `You hit 100% of your 5-hour window. Resets in ${time}.`,
  weeklyAll: (reset) => `You hit 100% of your weekly limit. Resets ${reset}.`,
  weeklySonnet: (reset) => `You hit 100% of your weekly Sonnet limit. Resets ${reset}.`,
};

function styledHeading(text: string): string {
  return `<strong><span style="color:${CLAUDE_ORANGE};">${text}</span></strong>`;
}

export type CombinedUsage = {
  api: UsageData | null;
  local: UsageSummary | null;
  prediction: PredictionResponse | null;
};

/**
 * Format ETA string for compact display
 * "~28 minutes" -> "~28m", "~2 hours" -> "~2h"
 */
function formatEtaCompact(eta: string): string {
  return eta.replace(' minutes', 'm').replace(' minute', 'm').replace(' hours', 'h').replace(' hour', 'h');
}

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private cachedUsage: CombinedUsage | null = null;
  private weeklyThreshold = DEFAULT_WEEKLY_ALERT_THRESHOLD;
  private lastStatusText: string | null = null;
  private shellSettingsCache: ConfigCache<boolean>;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'clauder.refresh';
    this.statusBarItem.show();

    this.shellSettingsCache = new ConfigCache<boolean>(() => {
      try {
        const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        const content = fs.readFileSync(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        return !!settings.statusLine;
      } catch {
        return false;
      }
    }, SHELL_SETTINGS_CACHE_TTL);
  }

  setWeeklyThreshold(threshold: number): void {
    const clamped = Math.max(50, Math.min(100, threshold));
    this.weeklyThreshold = clamped;
    if (this.cachedUsage) {
      const highlight = shouldHighlightWeekly(this.cachedUsage.api, this.weeklyThreshold);
      this.render(this.cachedUsage, highlight);
    }
  }

  setVisible(visible: boolean): void {
    if (visible) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  update(usage: CombinedUsage): void {
    this.cachedUsage = usage;
    const weeklyHighlight = shouldHighlightWeekly(usage.api, this.weeklyThreshold);
    this.render(usage, weeklyHighlight);
  }

  showLoading(): void {
    const existingText = this.lastStatusText || this.statusBarItem.text;
    if (existingText) {
      this.setStatusText(this.withSpinnerIcon(existingText), false);
    } else {
      this.setStatusText('$(sync~spin) Claude: Loading...', false);
    }
    this.statusBarItem.tooltip = 'Fetching usage data...';
  }

  showError(message: string): void {
    this.setStatusText('$(warning) Claude: Error');
    this.statusBarItem.tooltip = message;
    this.statusBarItem.color = new vscode.ThemeColor('errorForeground');
  }

  showNotAuthenticated(): void {
    this.setStatusText('$(sparkle) Claude: Not authenticated');
    this.statusBarItem.tooltip = 'Click to authenticate with Claude Code';
    this.statusBarItem.color = undefined;
  }

  showLimitReached(limit: LimitReset): void {
    const timeRemaining = formatTimeRemaining(limit.resetAt);
    const resetDisplay = limit.kind === 'session' ? timeRemaining : formatResetDay(limit.resetAt);

    const label = LIMIT_LABELS[limit.kind];
    const tooltipText = LIMIT_TOOLTIPS[limit.kind](resetDisplay, timeRemaining);

    this.setStatusText(`$(error) ${label} | resets in ${timeRemaining}`);
    this.statusBarItem.tooltip = tooltipText;
    this.statusBarItem.color = new vscode.ThemeColor('errorForeground');
  }

  private render(usage: CombinedUsage, inlineWeekly: boolean): void {
    if (usage.api) {
      const sessionPercent = Math.round(usage.api.session.utilization);
      const sessionTime = usage.api.session.resetsAt
        ? formatTimeRemaining(usage.api.session.resetsAt)
        : 'N/A';

      // Build prediction suffix
      const predictionSuffix = this.buildPredictionSuffix(usage.prediction);

      if (inlineWeekly) {
        const weeklyPercent = Math.round(usage.api.weeklyAll.utilization);
        const weeklyTime = usage.api.weeklyAll.resetsAt
          ? formatResetDay(usage.api.weeklyAll.resetsAt)
          : 'N/A';
        this.setStatusText(
          `$(sparkle) ${sessionPercent}% | ${sessionTime} · W ${weeklyPercent}% | ${weeklyTime}${predictionSuffix}`
        );
        this.statusBarItem.color = getUsageColor(sessionPercent);
        this.statusBarItem.tooltip = this.buildTooltip(usage);
        return;
      }

      this.setStatusText(`$(sparkle) ${sessionPercent}% | ${sessionTime}${predictionSuffix}`);
      this.statusBarItem.color = getUsageColor(sessionPercent);
      this.statusBarItem.tooltip = this.buildTooltip(usage);
    } else if (usage.local) {
      const percent = Math.round(usage.local.windowPercentage);
      const timeRemaining = formatTimeRemaining(usage.local.windowEndTime);

      this.setStatusText(`$(sparkle) ~${percent}% | ${timeRemaining}`);
      this.statusBarItem.color = getUsageColor(percent);
      this.statusBarItem.tooltip = this.buildLocalTooltip(usage.local);
    } else {
      this.setStatusText('$(sparkle) N/A');
      this.statusBarItem.tooltip = 'Unable to fetch usage data';
    }
  }

  /**
   * Build prediction suffix for status bar
   * Returns empty string if no valid predictions
   */
  private buildPredictionSuffix(prediction: PredictionResponse | null): string {
    if (!prediction) {
      return '';
    }

    const parts: string[] = [];

    // 5-hour ETA
    const fiveHour = prediction.five_hour;
    if (fiveHour.eta_human && fiveHour.confidence.tier !== 'insufficient') {
      parts.push(`>> ${formatEtaCompact(fiveHour.eta_human)}`);
    }

    // Weekly projection
    const weekly = prediction.weekly;
    if (weekly.projected_pct_human && weekly.confidence.tier !== 'insufficient') {
      parts.push(weekly.projected_pct_human);
    }

    if (parts.length === 0) {
      return '';
    }

    return ` | ${parts.join(' | ')}`;
  }

  private buildTooltip(usage: CombinedUsage): vscode.MarkdownString {
    const api = usage.api!;
    const local = usage.local;
    const prediction = usage.prediction;

    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.supportThemeIcons = true;
    md.isTrusted = true;
    md.appendMarkdown('<div style="min-width:280px">\n\n');
    md.appendMarkdown(`${styledHeading('Claude Code Usage')}\n\n`);

    let hasContent = false;
    const appendSeparator = () => {
      if (hasContent) {
        md.appendMarkdown('---\n\n');
      }
      hasContent = true;
    };

    appendSeparator();
    const weeklyReset = api.weeklyAll.resetsAt
      ? ` · ${formatResetDay(api.weeklyAll.resetsAt)}`
      : '';
    md.appendMarkdown(`**Weekly:** ${Math.round(api.weeklyAll.utilization)}%${weeklyReset}\n\n`);

    if (api.weeklySonnet) {
      const sonnetReset = api.weeklySonnet.resetsAt
        ? ` · ${formatResetDay(api.weeklySonnet.resetsAt)}`
        : '';
      md.appendMarkdown(
        `**Sonnet:** ${Math.round(api.weeklySonnet.utilization)}%${sonnetReset}\n\n`
      );
    }

    // Predictions section
    if (prediction) {
      this.appendPredictionSection(md, prediction, appendSeparator);
    }

    if (local?.projectBreakdown && local.projectBreakdown.projects.length > 0) {
      appendSeparator();
      md.appendMarkdown(`${styledHeading('Usage by Project (Week)')}\n\n`);
      this.appendProjectBreakdown(md, local.projectBreakdown);
    }

    if (!hasContent) {
      appendSeparator();
      md.appendMarkdown('_No detailed usage available_\n\n');
    }

    this.appendQuickSettings(md);

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('_Click to refresh_');
    md.appendMarkdown('\n\n</div>');

    return md;
  }

  private appendPredictionSection(
    md: vscode.MarkdownString,
    prediction: PredictionResponse,
    appendSeparator: () => void
  ): void {
    const fiveHour = prediction.five_hour;
    const weekly = prediction.weekly;

    // Only show if we have at least one valid prediction
    const hasFiveHourPrediction =
      fiveHour.eta_human && fiveHour.confidence.tier !== 'insufficient';
    const hasWeeklyPrediction =
      weekly.projected_pct_human && weekly.confidence.tier !== 'insufficient';

    if (!hasFiveHourPrediction && !hasWeeklyPrediction) {
      return;
    }

    appendSeparator();
    md.appendMarkdown(`${styledHeading('Predictions')}\n\n`);

    // 5-hour ETA
    if (hasFiveHourPrediction) {
      const confLabel = fiveHour.confidence.tier;
      md.appendMarkdown(`**5h ETA:** ${fiveHour.eta_human} _(${confLabel})_\n\n`);

      if (fiveHour.burn_rate_pct_per_min !== null) {
        md.appendMarkdown(`_Burn rate: ${fiveHour.burn_rate_pct_per_min.toFixed(2)}%/min_\n\n`);
      }
    }

    // Weekly projection
    if (hasWeeklyPrediction) {
      md.appendMarkdown(`**Weekly:** ${weekly.projected_pct_human} projected\n\n`);

      if (weekly.breach_day) {
        md.appendMarkdown(`$(warning) May exceed limit by ${weekly.breach_day}\n\n`);
      }
    }
  }

  private buildLocalTooltip(usage: UsageSummary): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.supportThemeIcons = true;
    md.isTrusted = true;
    md.appendMarkdown('<div style="min-width:280px">\n\n');
    md.appendMarkdown(`${styledHeading('Claude Code Usage (Estimate)')}\n\n`);
    md.appendMarkdown('_API unavailable, showing local data_\n\n');

    md.appendMarkdown('---\n\n');

    const sessionReset = ` · ${formatTimeRemaining(usage.windowEndTime)}`;
    md.appendMarkdown(`**Session:** ~${Math.round(usage.windowPercentage)}%${sessionReset}\n\n`);

    md.appendMarkdown(`**Weekly:** ~${Math.round(usage.weeklyPercentage)}%\n\n`);

    if (usage.projectBreakdown && usage.projectBreakdown.projects.length > 0) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown(`${styledHeading('Usage by Project (Week)')}\n\n`);
      this.appendProjectBreakdown(md, usage.projectBreakdown);
    }

    this.appendQuickSettings(md);

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('_Click to refresh_');
    md.appendMarkdown('\n\n</div>');

    return md;
  }

  private appendProjectBreakdown(md: vscode.MarkdownString, breakdown: ProjectBreakdown): void {
    const maxDisplay = 5;
    const projects = breakdown.projects;
    for (let i = 0; i < Math.min(maxDisplay, projects.length); i++) {
      const project = projects[i];
      md.appendMarkdown(
        `${project.projectName}: ${formatTokens(project.totalTokens)} (${Math.round(project.percentage)}%)\n\n`
      );
    }
    if (projects.length > maxDisplay) {
      md.appendMarkdown(`_+ ${projects.length - maxDisplay} more projects_\n\n`);
    }
  }

  private appendQuickSettings(md: vscode.MarkdownString): void {
    const shellEnabled = this.shellSettingsCache.get();
    const shellIcon = shellEnabled ? '$(check)' : '$(circle-outline)';

    md.appendMarkdown('---\n\n');
    md.appendMarkdown(`${styledHeading('Quick Settings')}\n\n`);
    md.appendMarkdown(`${shellIcon} [Show shell progress](command:clauder.toggleProgress)\n\n`);
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  private setStatusText(text: string, remember = true): void {
    if (this.statusBarItem.text !== text) {
      this.statusBarItem.text = text;
    }
    if (remember) {
      this.lastStatusText = text;
    }
  }

  private withSpinnerIcon(text: string): string {
    const iconMatch = text.match(/^(\$\([^)]+\))\s*/);
    if (iconMatch) {
      return text.replace(iconMatch[0], '$(sync~spin) ');
    }

    return `$(sync~spin) ${text}`;
  }
}
