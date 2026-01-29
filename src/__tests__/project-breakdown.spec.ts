import { describe, expect, it } from 'vitest';

import type { SessionEntryWithCwd } from '~/types';
import { calculateProjectBreakdown } from '~/usage-tracker';

describe('calculateProjectBreakdown', () => {
  const weekStart = new Date('2024-01-07T00:00:00Z');
  const now = new Date('2024-01-10T12:00:00Z');

  it('groups entries by cwd', () => {
    const entries: SessionEntryWithCwd[] = [
      {
        cwd: '/project-a',
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 100, output_tokens: 50 } },
      },
      {
        cwd: '/project-b',
        timestamp: '2024-01-08T11:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 200, output_tokens: 100 } },
      },
      {
        cwd: '/project-a',
        timestamp: '2024-01-08T12:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 150, output_tokens: 75 } },
      },
    ];

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].projectName).toBe('project-a');
    expect(result.projects[0].totalTokens).toBe(375);
    expect(result.projects[1].projectName).toBe('project-b');
    expect(result.projects[1].totalTokens).toBe(300);
  });

  it('calculates percentage of total correctly', () => {
    const entries: SessionEntryWithCwd[] = [
      {
        cwd: '/project-a',
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 750, output_tokens: 0 } },
      },
      {
        cwd: '/project-b',
        timestamp: '2024-01-08T11:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 250, output_tokens: 0 } },
      },
    ];

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.projects[0].percentage).toBe(75);
    expect(result.projects[1].percentage).toBe(25);
    expect(result.totalTokens).toBe(1000);
  });

  it('sorts by token count descending', () => {
    const entries: SessionEntryWithCwd[] = [
      {
        cwd: '/small',
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 100, output_tokens: 0 } },
      },
      {
        cwd: '/large',
        timestamp: '2024-01-08T11:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 1000, output_tokens: 0 } },
      },
      {
        cwd: '/medium',
        timestamp: '2024-01-08T12:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 500, output_tokens: 0 } },
      },
    ];

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.projects[0].projectName).toBe('large');
    expect(result.projects[1].projectName).toBe('medium');
    expect(result.projects[2].projectName).toBe('small');
  });

  it('handles entries without cwd field', () => {
    const entries: SessionEntryWithCwd[] = [
      {
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 100, output_tokens: 50 } },
      },
      {
        cwd: '/project-a',
        timestamp: '2024-01-08T11:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 200, output_tokens: 100 } },
      },
    ];

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.projects).toHaveLength(2);
    const unknownProject = result.projects.find((p) => p.projectName === 'Unknown');
    expect(unknownProject).toBeDefined();
    expect(unknownProject?.totalTokens).toBe(150);
  });

  it('filters to weekly entries only', () => {
    const entries: SessionEntryWithCwd[] = [
      {
        cwd: '/project-a',
        timestamp: '2024-01-06T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 1000, output_tokens: 0 } },
      },
      {
        cwd: '/project-a',
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 100, output_tokens: 0 } },
      },
    ];

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.totalTokens).toBe(100);
  });

  it('returns empty breakdown when no entries', () => {
    const result = calculateProjectBreakdown([], weekStart, now);

    expect(result.projects).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it('calculates cost correctly', () => {
    const entries: SessionEntryWithCwd[] = [
      {
        cwd: '/project-a',
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 1_000_000, output_tokens: 0 } },
      },
    ];

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.projects[0].cost).toBeCloseTo(3, 1);
    expect(result.totalCost).toBeCloseTo(3, 1);
  });

  it('limits to top 10 projects', () => {
    const entries: SessionEntryWithCwd[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push({
        cwd: `/project-${i}`,
        timestamp: '2024-01-08T10:00:00Z',
        message: { model: 'sonnet', usage: { input_tokens: 100 * (15 - i), output_tokens: 0 } },
      });
    }

    const result = calculateProjectBreakdown(entries, weekStart, now);

    expect(result.projects).toHaveLength(10);
    expect(result.projects[0].projectName).toBe('project-0');
  });
});
