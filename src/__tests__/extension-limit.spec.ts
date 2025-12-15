import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activate, deactivate } from '~/extension';

const fetchUsage = vi.fn();
const calculateUsage = vi.fn().mockResolvedValue(null);

vi.mock('~/usage-api', () => {
  return {
    UsageApiClient: class {
      fetchUsage = fetchUsage;
    },
  };
});

vi.mock('~/usage-tracker', () => {
  return {
    UsageTracker: class {
      calculateUsage = calculateUsage;
    },
  };
});

vi.mock('vscode', () => {
  const items: any[] = [];
  const commands: Record<string, () => void> = {};

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
    commands: {
      registerCommand: vi.fn((name: string, cb: () => void) => {
        commands[name] = cb;
        return { dispose: vi.fn() };
      }),
      __commands: commands,
    },
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
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, fallback: any) => {
          if (key === 'refreshInterval') return 300;
          return fallback;
        }),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    __items: items,
  };
});

describe('extension limit pause/resume integration', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    fetchUsage.mockReset();
    calculateUsage.mockClear();
    const vscode = await import('vscode');
    (vscode as any).__items.length = 0;
    const commands = (vscode as any).commands.__commands;
    Object.keys(commands).forEach((key) => delete commands[key]);
  });

  it('pauses polling when limit hit and resumes after reset time', async () => {
    const resetAt = new Date(Date.now() + 60_000);
    const limitUsage = {
      session: { utilization: 100, resetsAt: resetAt },
      weeklyAll: { utilization: 25, resetsAt: null },
      weeklySonnet: null,
    };
    const normalUsage = {
      session: { utilization: 50, resetsAt: null },
      weeklyAll: { utilization: 25, resetsAt: null },
      weeklySonnet: null,
    };

    fetchUsage
      .mockResolvedValueOnce({ status: 'success', data: limitUsage })
      .mockResolvedValueOnce({ status: 'success', data: normalUsage });

    const context = { subscriptions: [] } as any;
    await activate(context);

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    const vscode = await import('vscode');
    const bar = (vscode as any).__items[0];
    expect(bar.text).toContain('Limit reached');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchUsage).toHaveBeenCalledTimes(1);
    expect(bar.text).toContain('Limit reached');

    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchUsage).toHaveBeenCalledTimes(2);
    expect(bar.text).toContain('50%');

    deactivate();
    vi.useRealTimers();
  });

  it('keeps paused state when manual refresh is invoked during limit window', async () => {
    const resetAt = new Date(Date.now() + 30_000);
    const limitUsage = {
      session: { utilization: 100, resetsAt: resetAt },
      weeklyAll: { utilization: 25, resetsAt: null },
      weeklySonnet: null,
    };

    fetchUsage.mockResolvedValue({ status: 'success', data: limitUsage });

    const context = { subscriptions: [] } as any;
    await activate(context);

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    const vscode = await import('vscode');
    const refresh = (vscode as any).commands.__commands['clauder.refresh'];
    await refresh();

    expect(fetchUsage).toHaveBeenCalledTimes(1);
    const bar = (vscode as any).__items[0];
    expect(bar.text).toContain('Limit reached');

    deactivate();
    vi.useRealTimers();
  });
});
