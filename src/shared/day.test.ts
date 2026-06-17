import { describe, expect, it } from 'vitest';

import { localDayKey, splitByLocalDay } from './day';

describe('splitByLocalDay', () => {
  it('returns a single segment for a within-day interval', () => {
    const start = new Date(2026, 4, 29, 10, 0, 0).getTime();
    const end = new Date(2026, 4, 29, 10, 5, 0).getTime();
    expect(splitByLocalDay(start, end)).toEqual([{ start, end }]);
  });

  it('cuts at local midnight when the interval straddles a day', () => {
    const start = new Date(2026, 4, 28, 23, 55, 0).getTime();
    const midnight = new Date(2026, 4, 29, 0, 0, 0).getTime();
    const end = new Date(2026, 4, 29, 0, 5, 0).getTime();
    expect(splitByLocalDay(start, end)).toEqual([
      { start, end: midnight },
      { start: midnight, end },
    ]);
    expect(localDayKey(start)).toBe('2026-05-28');
    expect(localDayKey(midnight)).toBe('2026-05-29');
  });

  it('spans multiple whole days contiguously, preserving total length', () => {
    const start = new Date(2026, 4, 28, 12, 0, 0).getTime();
    const end = new Date(2026, 4, 30, 6, 0, 0).getTime();
    const segs = splitByLocalDay(start, end);

    expect(segs.map((s) => localDayKey(s.start))).toEqual([
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
    ]);
    // First segment starts at `start`, segments are contiguous, last ends at `end`.
    const lastEnd = segs.reduce((prevEnd, iv) => {
      expect(iv.start).toBe(prevEnd);
      return iv.end;
    }, start);
    expect(lastEnd).toBe(end);
    const total = segs.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
    expect(total).toBe(end - start);
  });

  it('returns [] for a non-positive interval', () => {
    const t = new Date(2026, 4, 29, 10, 0, 0).getTime();
    expect(splitByLocalDay(t, t)).toEqual([]);
    expect(splitByLocalDay(t + 1000, t)).toEqual([]);
  });
});
