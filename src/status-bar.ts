import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  formatResetDay,
  formatTimeRemaining,
  formatTokens,
  getUsageColor,
} from '~/formatters';
import { DEFAULT_WEEKLY_ALERT_THRESHOLD, shouldHighlightWeekly } from '~/limit';
import type { LimitReset } from '~/limit';
import type { UsageSummary } from '~/types';
import type { UsageData } from '~/usage-api';

const CLAUDE_ORANGE = '#E8956A';

function styledHeading(text: string): string {
  return `<strong><span style="color:${CLAUDE_ORANGE};">${text}</span></strong>`;
}

export type CombinedUsage = {
  api: UsageData | null;
  local: UsageSummary | null;
};

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private cachedUsage: CombinedUsage | null = null;
  private weeklyThreshold = DEFAULT_WEEKLY_ALERT_THRESHOLD;
  private lastStatusText: string | null = null;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'clauder.refresh';
    this.statusBarItem.show();
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
    const resetDisplay =
      limit.kind === 'session' ? timeRemaining : formatResetDay(limit.resetAt);

    const label =
      limit.kind === 'session'
        ? '5h limit reached'
        : limit.kind === 'weeklyAll'
          ? 'Weekly limit reached'
          : 'Weekly Sonnet limit reached';

    const tooltipText =
      limit.kind === 'session'
        ? `You hit 100% of your 5-hour window. Resets in ${timeRemaining}.`
        : limit.kind === 'weeklyAll'
          ? `You hit 100% of your weekly limit. Resets ${resetDisplay}.`
          : `You hit 100% of your weekly Sonnet limit. Resets ${resetDisplay}.`;

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

      if (inlineWeekly) {
        const weeklyPercent = Math.round(usage.api.weeklyAll.utilization);
        const weeklyTime = usage.api.weeklyAll.resetsAt
          ? formatResetDay(usage.api.weeklyAll.resetsAt)
          : 'N/A';
        this.setStatusText(
          `$(sparkle) ${sessionPercent}% | ${sessionTime} · W ${weeklyPercent}% | ${weeklyTime}`
        );
        this.statusBarItem.color = getUsageColor(sessionPercent);
        this.statusBarItem.tooltip = this.buildTooltip(usage);
        return;
      }

      this.setStatusText(`$(sparkle) ${sessionPercent}% | ${sessionTime}`);
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

  private buildTooltip(usage: CombinedUsage): vscode.MarkdownString {
    const api = usage.api!;
    const local = usage.local;

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

    // Weekly (All Models) - compact format
    appendSeparator();
    const weeklyReset = api.weeklyAll.resetsAt
      ? ` · ${formatResetDay(api.weeklyAll.resetsAt)}`
      : '';
    md.appendMarkdown(`**Weekly:** ${Math.round(api.weeklyAll.utilization)}%${weeklyReset}\n\n`);

    // Weekly (Sonnet) - compact format
    if (api.weeklySonnet) {
      const sonnetReset = api.weeklySonnet.resetsAt
        ? ` · ${formatResetDay(api.weeklySonnet.resetsAt)}`
        : '';
      md.appendMarkdown(`**Sonnet:** ${Math.round(api.weeklySonnet.utilization)}%${sonnetReset}\n\n`);
    }

    if (local?.projectBreakdown && local.projectBreakdown.projects.length > 0) {
      appendSeparator();
      md.appendMarkdown(`${styledHeading('Usage by Project (Week)')}\n\n`);
      const maxDisplay = 5;
      const projects = local.projectBreakdown.projects;
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

  private buildLocalTooltip(usage: UsageSummary): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.supportThemeIcons = true;
    md.isTrusted = true;
    md.appendMarkdown('<div style="min-width:280px">\n\n');
    md.appendMarkdown(`${styledHeading('Claude Code Usage (Estimate)')}\n\n`);
    md.appendMarkdown('_API unavailable, showing local data_\n\n');

    md.appendMarkdown('---\n\n');

    // Current Session - compact format
    const sessionReset = ` · ${formatTimeRemaining(usage.windowEndTime)}`;
    md.appendMarkdown(`**Session:** ~${Math.round(usage.windowPercentage)}%${sessionReset}\n\n`);

    // Weekly (CLI only) - compact format
    md.appendMarkdown(`**Weekly:** ~${Math.round(usage.weeklyPercentage)}%\n\n`);

    if (usage.projectBreakdown && usage.projectBreakdown.projects.length > 0) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown(`${styledHeading('Usage by Project (Week)')}\n\n`);
      const maxDisplay = 5;
      const projects = usage.projectBreakdown.projects;
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

    this.appendQuickSettings(md);

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('_Click to refresh_');
    md.appendMarkdown('\n\n</div>');

    return md;
  }

  private appendQuickSettings(md: vscode.MarkdownString): void {
    let shellEnabled = false;
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      shellEnabled = !!settings.statusLine;
    } catch {
      // Settings file doesn't exist or can't be read
    }
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
