import { describe, expect, it } from 'vitest';

import type { SessionEntryWithCwd } from '~/types';
import { calculatePredictions, calculateUsageRate } from '~/usage-tracker';

describe('calculateUsageRate', () => {
  it('calculates tokens per hour from 1-hour window', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const entries: SessionEntryWithCwd[] = [
      {
        timestamp: '2024-01-10T11:00:00Z',
        message: { usage: { input_tokens: 25_000, output_tokens: 0 } },
      },
      {
        timestamp: '2024-01-10T11:30:00Z',
        message: { usage: { input_tokens: 25_000, output_tokens: 0 } },
      },
    ];

    const result = calculateUsageRate(entries, now);

    expect(result.tokensPerHour).toBe(50_000);
    expect(result.sampleTokens).toBe(50_000);
  });

  it('returns zero rate when no entries in window', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const entries: SessionEntryWithCwd[] = [
      {
        timestamp: '2024-01-10T10:00:00Z',
        message: { usage: { input_tokens: 50_000, output_tokens: 0 } },
      },
    ];

    const result = calculateUsageRate(entries, now);

    expect(result.tokensPerHour).toBe(0);
    expect(result.sampleTokens).toBe(0);
  });

  it('handles partial hour correctly', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const entries: SessionEntryWithCwd[] = [
      {
        timestamp: '2024-01-10T11:30:00Z',
        message: { usage: { input_tokens: 25_000, output_tokens: 0 } },
      },
    ];

    const result = calculateUsageRate(entries, now);

    expect(result.tokensPerHour).toBe(50_000);
  });

  it('uses configurable sample window', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const entries: SessionEntryWithCwd[] = [
      {
        timestamp: '2024-01-10T10:30:00Z',
        message: { usage: { input_tokens: 50_000, output_tokens: 0 } },
      },
    ];

    const twoHoursMs = 2 * 60 * 60 * 1000;
    const result = calculateUsageRate(entries, now, twoHoursMs);

    expect(result.sampleTokens).toBe(50_000);
    expect(result.sampleWindowMs).toBe(twoHoursMs);
  });

  it('returns empty result for empty entries', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const result = calculateUsageRate([], now);

    expect(result.tokensPerHour).toBe(0);
    expect(result.sampleTokens).toBe(0);
  });
});

describe('calculatePredictions', () => {
  it('predicts session limit time correctly', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 50_000, sampleWindowMs: 3600000, sampleTokens: 50_000 };

    const result = calculatePredictions(rate, 50, 20, 'pro', now);

    expect(result.canPredict).toBe(true);
    expect(result.timeToSessionLimit).toBe(5 * 60 * 60 * 1000);
  });

  it('returns canPredict: false when no recent usage', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 0, sampleWindowMs: 3600000, sampleTokens: 0 };

    const result = calculatePredictions(rate, 50, 20, 'pro', now);

    expect(result.canPredict).toBe(false);
    expect(result.reason).toBe('no_recent_usage');
  });

  it('returns canPredict: false when session already at limit', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 50_000, sampleWindowMs: 3600000, sampleTokens: 50_000 };

    const result = calculatePredictions(rate, 100, 20, 'pro', now);

    expect(result.canPredict).toBe(false);
    expect(result.reason).toBe('already_at_limit');
  });

  it('returns canPredict: false when weekly already at limit', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 50_000, sampleWindowMs: 3600000, sampleTokens: 50_000 };

    const result = calculatePredictions(rate, 50, 100, 'pro', now);

    expect(result.canPredict).toBe(false);
    expect(result.reason).toBe('already_at_limit');
  });

  it('predicts weekly limit time correctly', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 50_000, sampleWindowMs: 3600000, sampleTokens: 50_000 };

    const result = calculatePredictions(rate, 10, 50, 'pro', now);

    expect(result.canPredict).toBe(true);
    expect(result.timeToWeeklyLimit).toBeGreaterThan(0);
    expect(result.weeklyLimitAt).toBeInstanceOf(Date);
  });

  it('calculates session limit date', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 50_000, sampleWindowMs: 3600000, sampleTokens: 50_000 };

    const result = calculatePredictions(rate, 50, 20, 'pro', now);

    expect(result.sessionLimitAt).toBeInstanceOf(Date);
    expect(result.sessionLimitAt!.getTime()).toBe(now.getTime() + 5 * 60 * 60 * 1000);
  });

  it('uses correct plan limits for max5', () => {
    const now = new Date('2024-01-10T12:00:00Z');
    const rate = { tokensPerHour: 100_000, sampleWindowMs: 3600000, sampleTokens: 100_000 };

    const result = calculatePredictions(rate, 50, 20, 'max5', now);

    expect(result.canPredict).toBe(true);
    expect(result.timeToSessionLimit).toBe(12.5 * 60 * 60 * 1000);
  });
});
