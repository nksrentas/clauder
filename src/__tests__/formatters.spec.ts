import { describe, expect, it } from 'vitest';

import {
  capitalize,
  formatResetDay,
  formatTimeRemaining,
  formatTokens,
  getUsageColor,
} from '~/formatters';

describe('formatTimeRemaining', () => {
  it('returns "now" when time has passed', () => {
    const past = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T12:00:00Z');
    expect(formatTimeRemaining(past, now)).toBe('now');
  });

  it('formats minutes only when less than an hour', () => {
    const end = new Date('2024-01-01T10:30:00Z');
    const now = new Date('2024-01-01T10:00:00Z');
    expect(formatTimeRemaining(end, now)).toBe('30m');
  });

  it('formats hours and minutes', () => {
    const end = new Date('2024-01-01T12:30:00Z');
    const now = new Date('2024-01-01T10:00:00Z');
    expect(formatTimeRemaining(end, now)).toBe('2h 30m');
  });

  it('formats days and hours when over 24 hours', () => {
    const end = new Date('2024-01-03T14:00:00Z');
    const now = new Date('2024-01-01T10:00:00Z');
    expect(formatTimeRemaining(end, now)).toBe('2d 4h');
  });
});

describe('formatResetDay', () => {
  it('formats date with day name and 12-hour time', () => {
    const date = new Date('2024-01-15T14:30:00');
    const result = formatResetDay(date);
    expect(result).toBe('Mon 15 2:30 PM');
  });

  it('handles midnight correctly', () => {
    const date = new Date('2024-01-15T00:00:00');
    const result = formatResetDay(date);
    expect(result).toBe('Mon 15 12:00 AM');
  });

  it('handles noon correctly', () => {
    const date = new Date('2024-01-15T12:00:00');
    const result = formatResetDay(date);
    expect(result).toBe('Mon 15 12:00 PM');
  });
});

describe('formatTokens', () => {
  it('formats small numbers as-is', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands as K', () => {
    expect(formatTokens(1000)).toBe('1K');
    expect(formatTokens(5500)).toBe('6K');
    expect(formatTokens(999999)).toBe('1000K');
  });

  it('formats millions as M', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(1500000)).toBe('1.5M');
    expect(formatTokens(10000000)).toBe('10.0M');
  });
});

describe('getUsageColor', () => {
  it('returns deep terracotta for 90%+', () => {
    expect(getUsageColor(90)).toBe('#D4634B');
    expect(getUsageColor(100)).toBe('#D4634B');
  });

  it('returns classic terracotta for 80-89%', () => {
    expect(getUsageColor(80)).toBe('#E07B53');
    expect(getUsageColor(89)).toBe('#E07B53');
  });

  it('returns warm orange for 60-79%', () => {
    expect(getUsageColor(60)).toBe('#E8956A');
    expect(getUsageColor(79)).toBe('#E8956A');
  });

  it('returns light peachy for 40-59%', () => {
    expect(getUsageColor(40)).toBe('#F0B090');
    expect(getUsageColor(59)).toBe('#F0B090');
  });

  it('returns warm beige for under 40%', () => {
    expect(getUsageColor(0)).toBe('#D4A27C');
    expect(getUsageColor(39)).toBe('#D4A27C');
  });
});

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('opus')).toBe('Opus');
    expect(capitalize('sonnet')).toBe('Sonnet');
    expect(capitalize('haiku')).toBe('Haiku');
  });

  it('handles empty string', () => {
    expect(capitalize('')).toBe('');
  });

  it('handles already capitalized', () => {
    expect(capitalize('Opus')).toBe('Opus');
  });
});
