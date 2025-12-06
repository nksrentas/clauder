import * as vscode from 'vscode';

import {
  capitalize,
  formatResetDay,
  formatTimeRemaining,
  formatTokens,
  getUsageColor,
} from '~/formatters';
import type { ModelFamily, UsageSummary } from '~/types';
import type { UsageData } from '~/usage-api';

export type CombinedUsage = {
  api: UsageData | null;
  local: UsageSummary | null;
};

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'clauder.refresh';
    this.statusBarItem.show();
  }

  update(usage: CombinedUsage): void {
    if (usage.api) {
      const percent = Math.round(usage.api.session.utilization);
      const timeRemaining = usage.api.session.resetsAt
        ? formatTimeRemaining(usage.api.session.resetsAt)
        : 'N/A';

      this.statusBarItem.text = `$(sparkle) Claude: ${percent}% | ${timeRemaining}`;
      this.statusBarItem.color = getUsageColor(percent);
      this.statusBarItem.tooltip = this.buildTooltip(usage);
    } else if (usage.local) {
      const percent = Math.round(usage.local.windowPercentage);
      const timeRemaining = formatTimeRemaining(usage.local.windowEndTime);

      this.statusBarItem.text = `$(sparkle) Claude (est): ~${percent}% | ${timeRemaining}`;
      this.statusBarItem.color = getUsageColor(percent);
      this.statusBarItem.tooltip = this.buildLocalTooltip(usage.local);
    } else {
      this.statusBarItem.text = '$(sparkle) Claude: N/A';
      this.statusBarItem.tooltip = 'Unable to fetch usage data';
    }
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
    this.statusBarItem.dispose();
  }
}
