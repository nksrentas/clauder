import { describe, expect, it } from 'vitest';

import type { FetchResult, OAuthUsageResponse, UsageData } from '~/usage';
import { parseOAuthResponse } from '~/usage';

describe('FetchResult type', () => {
  it('success result contains UsageData', () => {
    const data: UsageData = {
      session: { utilization: 50, resetsAt: new Date() },
      weeklyAll: { utilization: 30, resetsAt: new Date() },
      weeklySonnet: null,
    };

    const result: FetchResult = { status: 'success', data };

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.data.session.utilization).toBe(50);
    }
  });

  it('no_token result has no data', () => {
    const result: FetchResult = { status: 'no_token' };

    expect(result.status).toBe('no_token');
    expect('data' in result).toBe(false);
  });

  it('error result contains message', () => {
    const result: FetchResult = { status: 'error', message: 'API failed' };

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe('API failed');
    }
  });
});

describe('OAuthUsageResponse parsing', () => {
  it('parses full response correctly', () => {
    const response: OAuthUsageResponse = {
      five_hour: { utilization: 61, resets_at: '2025-12-06T21:00:00+00:00' },
      seven_day: { utilization: 81, resets_at: '2025-12-08T20:00:00+00:00' },
      seven_day_sonnet: { utilization: 6, resets_at: '2025-12-08T22:00:00+00:00' },
    };

    expect(response.five_hour?.utilization).toBe(61);
    expect(response.seven_day?.utilization).toBe(81);
    expect(response.seven_day_sonnet?.utilization).toBe(6);
  });

  it('handles null fields', () => {
    const response: OAuthUsageResponse = {
      five_hour: null,
      seven_day: null,
      seven_day_sonnet: null,
    };

    expect(response.five_hour).toBeNull();
    expect(response.seven_day).toBeNull();
  });
});

describe('UsageData structure', () => {
  it('session has utilization and resetsAt', () => {
    const resetDate = new Date('2025-12-06T21:00:00Z');
    const data: UsageData = {
      session: { utilization: 75, resetsAt: resetDate },
      weeklyAll: { utilization: 50, resetsAt: null },
      weeklySonnet: null,
    };

    expect(data.session.utilization).toBe(75);
    expect(data.session.resetsAt).toEqual(resetDate);
    expect(data.weeklyAll.resetsAt).toBeNull();
  });

  it('optional weekly breakdowns can be null', () => {
    const data: UsageData = {
      session: { utilization: 0, resetsAt: null },
      weeklyAll: { utilization: 0, resetsAt: null },
      weeklySonnet: { utilization: 10, resetsAt: new Date() },
    };

    expect(data.weeklySonnet).not.toBeNull();
  });
});

describe('parseOAuthResponse', () => {
  it('parses complete response with all fields', () => {
    const response: OAuthUsageResponse = {
      five_hour: { utilization: 61, resets_at: '2025-12-06T21:00:00Z' },
      seven_day: { utilization: 81, resets_at: '2025-12-08T20:00:00Z' },
      seven_day_sonnet: { utilization: 6, resets_at: '2025-12-08T22:00:00Z' },
    };

    const result = parseOAuthResponse(response);

    expect(result.session.utilization).toBe(61);
    expect(result.session.resetsAt).toEqual(new Date('2025-12-06T21:00:00Z'));
    expect(result.weeklyAll.utilization).toBe(81);
    expect(result.weeklyAll.resetsAt).toEqual(new Date('2025-12-08T20:00:00Z'));
    expect(result.weeklySonnet).not.toBeNull();
    expect(result.weeklySonnet?.utilization).toBe(6);
    expect(result.weeklySonnet?.resetsAt).toEqual(new Date('2025-12-08T22:00:00Z'));
  });

  it('handles null five_hour and seven_day fields', () => {
    const response: OAuthUsageResponse = {
      five_hour: null,
      seven_day: null,
      seven_day_sonnet: null,
    };

    const result = parseOAuthResponse(response);

    expect(result.session.utilization).toBe(0);
    expect(result.session.resetsAt).toBeNull();
    expect(result.weeklyAll.utilization).toBe(0);
    expect(result.weeklyAll.resetsAt).toBeNull();
    expect(result.weeklySonnet).toBeNull();
  });

  it('handles missing resets_at in limits', () => {
    const response: OAuthUsageResponse = {
      five_hour: { utilization: 50, resets_at: null },
      seven_day: { utilization: 30, resets_at: null },
      seven_day_sonnet: { utilization: 10, resets_at: null },
    };

    const result = parseOAuthResponse(response);

    expect(result.session.utilization).toBe(50);
    expect(result.session.resetsAt).toBeNull();
    expect(result.weeklyAll.utilization).toBe(30);
    expect(result.weeklyAll.resetsAt).toBeNull();
    expect(result.weeklySonnet?.utilization).toBe(10);
    expect(result.weeklySonnet?.resetsAt).toBeNull();
  });

  it('handles response without seven_day_sonnet', () => {
    const response: OAuthUsageResponse = {
      five_hour: { utilization: 75, resets_at: '2025-12-06T21:00:00Z' },
      seven_day: { utilization: 40, resets_at: '2025-12-08T20:00:00Z' },
      seven_day_sonnet: null,
    };

    const result = parseOAuthResponse(response);

    expect(result.session.utilization).toBe(75);
    expect(result.weeklyAll.utilization).toBe(40);
    expect(result.weeklySonnet).toBeNull();
  });
});
