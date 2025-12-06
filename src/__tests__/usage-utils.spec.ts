import { describe, expect, it } from 'vitest';

import type { SessionEntry } from '~/types';
import { calculateCost, getEntryTokens, getModelFamily, getWeekBoundaries } from '~/usage-utils';

describe('getModelFamily', () => {
  it('returns opus for opus models', () => {
    expect(getModelFamily('claude-opus-4-5-20251101')).toBe('opus');
    expect(getModelFamily('claude-3-opus-20240229')).toBe('opus');
    expect(getModelFamily('OPUS')).toBe('opus');
  });

  it('returns sonnet for sonnet models', () => {
    expect(getModelFamily('claude-sonnet-4-20250514')).toBe('sonnet');
    expect(getModelFamily('claude-3-5-sonnet-20241022')).toBe('sonnet');
    expect(getModelFamily('SONNET')).toBe('sonnet');
  });

  it('returns haiku for haiku models', () => {
    expect(getModelFamily('claude-3-haiku-20240307')).toBe('haiku');
    expect(getModelFamily('HAIKU')).toBe('haiku');
  });

  it('returns unknown for unrecognized models', () => {
    expect(getModelFamily('gpt-4')).toBe('unknown');
    expect(getModelFamily('claude-unknown')).toBe('unknown');
    expect(getModelFamily('')).toBe('unknown');
  });

  it('returns unknown for undefined', () => {
    expect(getModelFamily(undefined)).toBe('unknown');
  });
});

describe('getEntryTokens', () => {
  it('returns sum of input and output tokens', () => {
    const entry: SessionEntry = {
      timestamp: '2024-01-01T10:00:00Z',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 200,
        },
      },
    };
    expect(getEntryTokens(entry)).toBe(300);
  });

  it('returns 0 when no usage data', () => {
    const entry: SessionEntry = {
      timestamp: '2024-01-01T10:00:00Z',
    };
    expect(getEntryTokens(entry)).toBe(0);
  });

  it('returns 0 when message is undefined', () => {
    const entry: SessionEntry = {
      timestamp: '2024-01-01T10:00:00Z',
      message: undefined,
    };
    expect(getEntryTokens(entry)).toBe(0);
  });

  it('handles missing token fields', () => {
    const entry: SessionEntry = {
      timestamp: '2024-01-01T10:00:00Z',
      message: {
        usage: {
          input_tokens: 100,
        } as SessionEntry['message'] extends { usage?: infer U } ? U : never,
      },
    };
    expect(getEntryTokens(entry)).toBe(100);
  });
});

describe('getWeekBoundaries', () => {
  it('returns Sunday 00:00 UTC as week start', () => {
    const wednesday = new Date('2024-01-10T14:30:00Z');
    const { weekStart } = getWeekBoundaries(wednesday);

    expect(weekStart.getUTCDay()).toBe(0);
    expect(weekStart.getUTCHours()).toBe(0);
    expect(weekStart.getUTCMinutes()).toBe(0);
    expect(weekStart.getUTCSeconds()).toBe(0);
  });

  it('returns correct week end (7 days after start)', () => {
    const wednesday = new Date('2024-01-10T14:30:00Z');
    const { weekStart, weekEnd } = getWeekBoundaries(wednesday);

    const diff = weekEnd.getTime() - weekStart.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(diff).toBe(sevenDaysMs);
  });

  it('handles Sunday correctly', () => {
    const sunday = new Date('2024-01-07T10:00:00Z');
    const { weekStart } = getWeekBoundaries(sunday);

    expect(weekStart.getUTCFullYear()).toBe(2024);
    expect(weekStart.getUTCMonth()).toBe(0);
    expect(weekStart.getUTCDate()).toBe(7);
  });

  it('handles Saturday correctly', () => {
    const saturday = new Date('2024-01-13T23:59:59Z');
    const { weekStart } = getWeekBoundaries(saturday);

    expect(weekStart.getUTCDate()).toBe(7);
  });
});

describe('calculateCost', () => {
  it('calculates cost for opus pricing', () => {
    const cost = calculateCost(1_000_000, 1_000_000, 15, 75);
    expect(cost).toBe(90);
  });

  it('calculates cost for sonnet pricing', () => {
    const cost = calculateCost(1_000_000, 1_000_000, 3, 15);
    expect(cost).toBe(18);
  });

  it('calculates cost for haiku pricing', () => {
    const cost = calculateCost(1_000_000, 1_000_000, 1, 5);
    expect(cost).toBe(6);
  });

  it('handles zero tokens', () => {
    const cost = calculateCost(0, 0, 15, 75);
    expect(cost).toBe(0);
  });

  it('calculates fractional costs', () => {
    const cost = calculateCost(500_000, 250_000, 3, 15);
    expect(cost).toBeCloseTo(5.25, 2);
  });
});
