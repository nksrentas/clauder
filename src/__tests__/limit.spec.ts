import { describe, expect, it, vi } from 'vitest';

import { computeResumeDelay, getLimitReset, shouldRemainPaused } from '~/limit';
import { StatusBarManager } from '~/status-bar';

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

    expect(getLimitReset(usage)).toEqual(resetAt);
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

    expect(shouldRemainPaused(future, new Date())).toBe(true);
    expect(shouldRemainPaused(past, new Date())).toBe(false);
    expect(shouldRemainPaused(null, new Date())).toBe(false);
  });

  it('computes resume delay and clamps past times to zero', () => {
    const nowMs = Date.now();
    const future = new Date(nowMs + 5_000);
    const past = new Date(nowMs - 1_000);

    expect(computeResumeDelay(future, nowMs)).toBe(5_000);
    expect(computeResumeDelay(past, nowMs)).toBe(0);
  });
});

describe('StatusBarManager limit display', () => {
  it('shows limit reached message with reset timing', async () => {
    const manager = new StatusBarManager();
    const resetAt = new Date(Date.now() + 60 * 60 * 1000);

    manager.showLimitReached(resetAt);

    const bar = (manager as any).statusBarItem;
    expect(bar.text).toContain('Limit reached');
    expect(bar.text).toContain('1h');
    expect(bar.tooltip).toContain('Polling paused');
    expect(bar.color).toBeInstanceOf((await import('vscode')).ThemeColor);
  });
});
