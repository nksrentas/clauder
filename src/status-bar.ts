import * as vscode from 'vscode';

import {
  capitalize,
  formatResetDay,
  formatTimeRemaining,
  formatTokens,
  getUsageColor,
} from '~/formatters';
import { DEFAULT_WEEKLY_ALERT_THRESHOLD, shouldHighlightWeekly } from '~/limit';
import type { LimitReset } from '~/limit';
import type { ModelFamily, UsageSummary } from '~/types';
import type { UsageData } from '~/usage-api';

export type CombinedUsage = {
  api: UsageData | null;
  local: UsageSummary | null;
};

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private alternateTimer: NodeJS.Timeout | undefined;
  private showWeeklyFocus = false;
  private cachedUsage: CombinedUsage | null = null;
  private rotationIntervalMs = 30000;
  private weeklyThreshold = DEFAULT_WEEKLY_ALERT_THRESHOLD;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'clauder.refresh';
    this.statusBarItem.show();
  }

  setWeeklyRotationInterval(intervalMs: number): void {
    const clamped = Math.max(5000, intervalMs);
    if (this.rotationIntervalMs === clamped) {
      return;
    }

    this.rotationIntervalMs = clamped;
    if (this.alternateTimer && this.cachedUsage) {
      this.toggleWeeklyRotation(false);
      const highlight = shouldHighlightWeekly(this.cachedUsage.api, this.weeklyThreshold);
      this.toggleWeeklyRotation(highlight);
    }
  }

  setWeeklyThreshold(threshold: number): void {
    const clamped = Math.max(50, Math.min(100, threshold));
    this.weeklyThreshold = clamped;
    if (this.cachedUsage) {
      const highlight = shouldHighlightWeekly(this.cachedUsage.api, this.weeklyThreshold);
      this.toggleWeeklyRotation(highlight);
      this.render(this.cachedUsage, highlight && this.showWeeklyFocus);
    }
  }

  update(usage: CombinedUsage): void {
    this.cachedUsage = usage;
    const weeklyHighlight = shouldHighlightWeekly(usage.api, this.weeklyThreshold);
    if (weeklyHighlight) {
      this.toggleWeeklyRotation(false);
      this.render(usage, false, true);
      return;
    }

    this.toggleWeeklyRotation(false);
    this.render(usage, false, false);
  }

  showLoading(): void {
    this.statusBarItem.text = '$(sync~spin) Claude: Loading...';
    this.statusBarItem.tooltip = 'Fetching usage data...';
  }

  showError(message: string): void {
    this.statusBarItem.text = '$(warning) Claude: Error';
    this.statusBarItem.tooltip = message;
    this.statusBarItem.color = new vscode.ThemeColor('errorForeground');
  }

  showNotAuthenticated(): void {
    this.statusBarItem.text = '$(sparkle) Claude: Not authenticated';
    this.statusBarItem.tooltip = 'Click to authenticate with Claude Code';
    this.statusBarItem.color = undefined;
  }

  showLimitReached(limit: LimitReset): void {
    this.toggleWeeklyRotation(false);

    const timeRemaining = formatTimeRemaining(limit.resetAt);
    const label =
      limit.kind === 'session'
        ? '5h limit reached'
        : limit.kind === 'weeklyAll'
          ? 'Weekly limit reached'
          : 'Weekly Sonnet limit reached';

    this.statusBarItem.text = `$(error) ${label} | ${timeRemaining}`;
    this.statusBarItem.tooltip = 'Limit reached. Polling paused until the window resets.';
    this.statusBarItem.color = new vscode.ThemeColor('errorForeground');
  }

  private render(usage: CombinedUsage, showWeekly: boolean, inlineWeekly: boolean): void {
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
        this.statusBarItem.text = `$(sparkle) ${sessionPercent}% | ${sessionTime} · W ${weeklyPercent}% | ${weeklyTime}`;
        this.statusBarItem.color = getUsageColor(sessionPercent);
        this.statusBarItem.tooltip = this.buildTooltip(usage);
        return;
      }

      if (showWeekly) {
        const percent = Math.round(usage.api.weeklyAll.utilization);
        const time = usage.api.weeklyAll.resetsAt
          ? formatResetDay(usage.api.weeklyAll.resetsAt)
          : 'N/A';

        this.statusBarItem.text = `$(sparkle) W ${percent}% | ${time}`;
        this.statusBarItem.color = getUsageColor(percent);
        this.statusBarItem.tooltip = this.buildTooltip(usage);
        return;
      }

      this.statusBarItem.text = `$(sparkle) ${sessionPercent}% | ${sessionTime}`;
      this.statusBarItem.color = getUsageColor(sessionPercent);
      this.statusBarItem.tooltip = this.buildTooltip(usage);
    } else if (usage.local) {
      const percent = Math.round(usage.local.windowPercentage);
      const timeRemaining = formatTimeRemaining(usage.local.windowEndTime);

      this.statusBarItem.text = `$(sparkle) ~${percent}% | ${timeRemaining}`;
      this.statusBarItem.color = getUsageColor(percent);
      this.statusBarItem.tooltip = this.buildLocalTooltip(usage.local);
    } else {
      this.statusBarItem.text = '$(sparkle) N/A';
      this.statusBarItem.tooltip = 'Unable to fetch usage data';
    }
  }

  private toggleWeeklyRotation(enable: boolean): void {
    if (this.alternateTimer) {
      clearInterval(this.alternateTimer);
      this.alternateTimer = undefined;
    }

    if (enable && this.cachedUsage) {
      this.showWeeklyFocus = true;
      this.render(this.cachedUsage, true, false);
      this.alternateTimer = setInterval(() => {
        this.showWeeklyFocus = !this.showWeeklyFocus;
        this.render(this.cachedUsage!, this.showWeeklyFocus, false);
      }, this.rotationIntervalMs);
    } else {
      this.showWeeklyFocus = false;
    }
  }

  private buildTooltip(usage: CombinedUsage): vscode.MarkdownString {
    const api = usage.api!;
    const local = usage.local;

    const md = new vscode.MarkdownString();
    md.appendMarkdown('**Claude Code Usage**\n\n');

    md.appendMarkdown('---\n\n');

    md.appendMarkdown('**Current Session**\n\n');
    md.appendMarkdown(`${Math.round(api.session.utilization)}% used\n\n`);
    if (api.session.resetsAt) {
      md.appendMarkdown(`Resets in: ${formatTimeRemaining(api.session.resetsAt)}\n\n`);
    }

    md.appendMarkdown('---\n\n');

    md.appendMarkdown('**Weekly (all models)**\n\n');
    md.appendMarkdown(`${Math.round(api.weeklyAll.utilization)}% used\n\n`);
    if (api.weeklyAll.resetsAt) {
      md.appendMarkdown(`Resets: ${formatResetDay(api.weeklyAll.resetsAt)}\n\n`);
    }

    if (api.weeklySonnet) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown('**Weekly (Sonnet only)**\n\n');
      md.appendMarkdown(`${Math.round(api.weeklySonnet.utilization)}% used\n\n`);
      if (api.weeklySonnet.resetsAt) {
        md.appendMarkdown(`Resets: ${formatResetDay(api.weeklySonnet.resetsAt)}\n\n`);
      }
    }

    if (local && local.totalCost > 0) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown('**Model Breakdown (Week, CLI)**\n\n');
      const models: ModelFamily[] = ['opus', 'sonnet', 'haiku'];
      for (const model of models) {
        const data = local.modelBreakdown[model];
        if (data.requests > 0) {
          const totalTokens = data.inputTokens + data.outputTokens;
          md.appendMarkdown(
            `${capitalize(model)}: ${formatTokens(totalTokens)} - $${data.cost.toFixed(2)}\n\n`
          );
        }
      }
      md.appendMarkdown(`**Est. Cost:** $${local.totalCost.toFixed(2)}\n\n`);
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('_Click to refresh_');

    return md;
  }

  private buildLocalTooltip(usage: UsageSummary): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown('**Claude Code Usage (Estimate)**\n\n');
    md.appendMarkdown('_API unavailable, showing local data_\n\n');

    md.appendMarkdown('---\n\n');

    md.appendMarkdown('**Current Session**\n\n');
    md.appendMarkdown(`~${Math.round(usage.windowPercentage)}% used\n\n`);
    md.appendMarkdown(`Resets in: ${formatTimeRemaining(usage.windowEndTime)}\n\n`);

    md.appendMarkdown('---\n\n');

    md.appendMarkdown('**Weekly (CLI only)**\n\n');
    md.appendMarkdown(`~${Math.round(usage.weeklyPercentage)}% used\n\n`);

    if (usage.totalCost > 0) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown(`**Est. Cost:** $${usage.totalCost.toFixed(2)}\n\n`);
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('_Click to refresh_');

    return md;
  }

  dispose(): void {
    this.toggleWeeklyRotation(false);
    this.statusBarItem.dispose();
  }
}
