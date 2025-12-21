import { describe, expect, it, vi } from 'vitest';

import {
  computeResumeDelay,
  DEFAULT_WEEKLY_ALERT_THRESHOLD,
  getLimitReset,
  shouldHighlightWeekly,
  shouldRemainPaused,
} from '~/limit';
import { StatusBarManager } from '~/status-bar';
import type { UsageSummary } from '~/types';

vi.mock('vscode', () => {
  const items: any[] = [];

  class MarkdownString {
    value = '';
    appendMarkdown(text: string) {
      this.value += text;
    }
  }

  class ThemeColor {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  }

  return {
    StatusBarAlignment: { Right: 1 },
    ThemeColor,
    MarkdownString,
    window: {
      createStatusBarItem: vi.fn(() => {
        const item = {
          text: '',
          tooltip: '',
          color: undefined as any,
          command: undefined as any,
          show: vi.fn(),
          dispose: vi.fn(),
        };
        items.push(item);
        return item;
      }),
      createTerminal: vi.fn(() => ({
        show: vi.fn(),
        sendText: vi.fn(),
      })),
      showInformationMessage: vi.fn(),
    },
    __items: items,
  };
});

describe('limit helpers', () => {
  it('returns reset time when utilization is at or above limit', () => {
    const resetAt = new Date();
    const usage = {
      session: { utilization: 100, resetsAt: resetAt },
      weeklyAll: { utilization: 10, resetsAt: null },
      weeklySonnet: null,
    };

    expect(getLimitReset(usage)).toEqual({ kind: 'session', resetAt });
  });

  it('returns null when below limit or missing reset time', () => {
    const usage = {
      session: { utilization: 80, resetsAt: null },
      weeklyAll: { utilization: 10, resetsAt: null },
      weeklySonnet: null,
    };

    expect(getLimitReset(usage)).toBeNull();
    expect(getLimitReset(null)).toBeNull();
  });

  it('detects paused state based on reset window', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 1_000);

    expect(shouldRemainPaused({ kind: 'session', resetAt: future }, new Date())).toBe(true);
    expect(shouldRemainPaused({ kind: 'session', resetAt: past }, new Date())).toBe(false);
    expect(shouldRemainPaused(null, new Date())).toBe(false);
  });

  it('computes resume delay and clamps past times to zero', () => {
    const nowMs = Date.now();
    const future = new Date(nowMs + 5_000);
    const past = new Date(nowMs - 1_000);

    expect(computeResumeDelay({ kind: 'session', resetAt: future }, nowMs)).toBe(5_000);
    expect(computeResumeDelay({ kind: 'session', resetAt: past }, nowMs)).toBe(0);
  });

  it('flags weekly highlight when utilization crosses threshold', () => {
    const resetAt = new Date();
    const usage = {
      session: { utilization: 10, resetsAt: null },
      weeklyAll: { utilization: 91, resetsAt: resetAt },
      weeklySonnet: null,
    };

    expect(shouldHighlightWeekly(usage, DEFAULT_WEEKLY_ALERT_THRESHOLD)).toBe(true);
    expect(shouldHighlightWeekly(usage, 95)).toBe(false);
    expect(shouldHighlightWeekly(null, DEFAULT_WEEKLY_ALERT_THRESHOLD)).toBe(false);
  });
});

describe('StatusBarManager limit display', () => {
  it('shows limit reached message with reset timing', async () => {
    const manager = new StatusBarManager();
    const resetAt = new Date(Date.now() + 60 * 60 * 1000);

    manager.showLimitReached({ kind: 'session', resetAt });

    const bar = (manager as any).statusBarItem;
    expect(bar.text.toLowerCase()).toContain('limit reached');
    expect(bar.text).toMatch(/\d+m/);
    expect(bar.tooltip).toContain('You hit 100% of your 5-hour window');
    expect(bar.color).toBeInstanceOf((await import('vscode')).ThemeColor);
    manager.dispose();
  });

  it('shows weekly limit reached message', async () => {
    const manager = new StatusBarManager();
    const resetAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    manager.showLimitReached({ kind: 'weeklyAll', resetAt });

    const bar = (manager as any).statusBarItem;
    expect(bar.text.toLowerCase()).toContain('weekly limit reached');
    expect(bar.tooltip).toContain('You hit 100% of your weekly limit');
    expect(bar.color).toBeInstanceOf((await import('vscode')).ThemeColor);
    manager.dispose();
  });

  it('shows weekly Sonnet limit reached message', async () => {
    const manager = new StatusBarManager();
    const resetAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    manager.showLimitReached({ kind: 'weeklySonnet', resetAt });

    const bar = (manager as any).statusBarItem;
    expect(bar.text.toLowerCase()).toContain('weekly sonnet limit reached');
    expect(bar.tooltip).toContain('You hit 100% of your weekly Sonnet limit');
    expect(bar.color).toBeInstanceOf((await import('vscode')).ThemeColor);
    manager.dispose();
  });
});

describe('StatusBarManager error states', () => {
  it('shows error message with custom tooltip', async () => {
    const manager = new StatusBarManager();

    manager.showError('API request failed');

    const bar = (manager as any).statusBarItem;
    expect(bar.text).toContain('Error');
    expect(bar.tooltip).toBe('API request failed');
    expect(bar.color).toBeInstanceOf((await import('vscode')).ThemeColor);
    manager.dispose();
  });

  it('shows not authenticated message', () => {
    const manager = new StatusBarManager();

    manager.showNotAuthenticated();

    const bar = (manager as any).statusBarItem;
    expect(bar.text).toContain('Not authenticated');
    expect(bar.tooltip).toBe('Click to authenticate with Claude Code');
    expect(bar.color).toBeUndefined();
    manager.dispose();
  });
});

describe('StatusBarManager local usage display', () => {
  it('renders local usage when API is unavailable', () => {
    const manager = new StatusBarManager();
    const localUsage = {
      windowPercentage: 45,
      weeklyPercentage: 30,
      windowEndTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      totalCost: 5.25,
      modelBreakdown: {
        opus: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        sonnet: { requests: 10, inputTokens: 50000, outputTokens: 25000, cost: 5.25 },
        haiku: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      },
    } as UsageSummary;

    manager.update({ api: null, local: localUsage });

    const bar = (manager as any).statusBarItem;
    expect(bar.text).toContain('~45%');
    expect(bar.tooltip.value).toContain('Claude Code Usage (Estimate)');
    expect(bar.tooltip.value).toContain('~45% used');
    expect(bar.tooltip.value).toContain('~30% used');
    manager.dispose();
  });

  it('renders local usage without cost when zero', () => {
    const manager = new StatusBarManager();
    const localUsage = {
      windowPercentage: 20,
      weeklyPercentage: 10,
      windowEndTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
      totalCost: 0,
      modelBreakdown: {
        opus: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        sonnet: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        haiku: { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      },
    } as UsageSummary;

    manager.update({ api: null, local: localUsage });

    const bar = (manager as any).statusBarItem;
    expect(bar.tooltip.value).not.toContain('Est. Cost');
    manager.dispose();
  });
});

describe('getLimitReset weeklySonnet edge case', () => {
  it('returns weeklySonnet limit when at 100%', () => {
    const resetAt = new Date();
    const usage = {
      session: { utilization: 50, resetsAt: null },
      weeklyAll: { utilization: 80, resetsAt: null },
      weeklySonnet: { utilization: 100, resetsAt: resetAt },
    };

    expect(getLimitReset(usage)).toEqual({ kind: 'weeklySonnet', resetAt });
  });
});

