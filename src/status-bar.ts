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

    this.setStatusText(`$(error) ${label} | ${timeRemaining}`);
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
    md.appendMarkdown('**Claude Code Usage**\n\n');

    let hasContent = false;
    const appendSeparator = () => {
      if (hasContent) {
        md.appendMarkdown('---\n\n');
      }
      hasContent = true;
    };

    appendSeparator();
    md.appendMarkdown('**Weekly (All Models)**\n\n');
    md.appendMarkdown(`${Math.round(api.weeklyAll.utilization)}% used\n\n`);
    if (api.weeklyAll.resetsAt) {
      md.appendMarkdown(`Resets: ${formatResetDay(api.weeklyAll.resetsAt)}\n\n`);
    }

    if (api.weeklySonnet) {
      appendSeparator();
      md.appendMarkdown('**Weekly (Sonnet only)**\n\n');
      md.appendMarkdown(`${Math.round(api.weeklySonnet.utilization)}% used\n\n`);
      if (api.weeklySonnet.resetsAt) {
        md.appendMarkdown(`Resets: ${formatResetDay(api.weeklySonnet.resetsAt)}\n\n`);
      }
    }

    if (local && local.totalCost > 0) {
      appendSeparator();
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

    if (!hasContent) {
      appendSeparator();
      md.appendMarkdown('_No detailed usage available_\n\n');
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
