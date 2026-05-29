import { describe, expect, it } from 'vitest';

import { startOfLocalDayMs, sumReviewDurationMs } from './reviews';

describe('startOfLocalDayMs', () => {
  it('returns local midnight for a mid-day timestamp', () => {
    const noon = new Date(2026, 4, 29, 12, 34, 56, 789).getTime();
    const start = new Date(startOfLocalDayMs(noon));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(start.getDate()).toBe(29);
  });

  it('is idempotent at midnight', () => {
    const midnight = new Date(2026, 4, 29, 0, 0, 0, 0).getTime();
    expect(startOfLocalDayMs(midnight)).toBe(midnight);
  });
});

describe('sumReviewDurationMs', () => {
  // Raw revlog rows: [id, cid, usn, ease, ivl, lastIvl, factor, time, type]
  const row = (timeMs: number): unknown[] => [1_700_000_000_000, 1, 0, 3, 10, 5, 2500, timeMs, 1];

  it('sums the review-duration column (index 7)', () => {
    expect(sumReviewDurationMs([row(8000), row(12000), row(5000)])).toBe(25000);
  });

  it('returns 0 for an empty list', () => {
    expect(sumReviewDurationMs([])).toBe(0);
  });

  it('skips malformed rows and non-array input', () => {
    expect(sumReviewDurationMs([row(8000), 'nope', [1, 2], null])).toBe(8000);
    expect(sumReviewDurationMs(undefined)).toBe(0);
    expect(sumReviewDurationMs({ not: 'an array' })).toBe(0);
  });

  it('ignores non-positive or non-numeric durations', () => {
    expect(sumReviewDurationMs([row(0), row(-50)])).toBe(0);
    const bad = [1_700_000_000_000, 1, 0, 3, 10, 5, 2500, 'x', 1];
    expect(sumReviewDurationMs([bad])).toBe(0);
  });
});
