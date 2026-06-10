import { describe, expect, it } from 'vitest';

import { COALESCE_GAP_MS, capIntervals, coalesce, type Interval, unionLengthMs } from './intervals';

// Readable clock helpers (seconds → epoch ms), as in accrual.test.ts.
const SECOND = 1_000;
const at = (s: number): number => s * SECOND;
const iv = (startS: number, endS: number): Interval => ({ start: at(startS), end: at(endS) });

describe('coalesce', () => {
  it('returns an empty list unchanged', () => {
    expect(coalesce([])).toEqual([]);
  });

  it('sorts out-of-order input', () => {
    expect(coalesce([iv(100, 110), iv(0, 10)])).toEqual([iv(0, 10), iv(100, 110)]);
  });

  it('merges sessions within the coalesce gap into one interval', () => {
    // Two ticks one cadence apart during continuous watching.
    const gap = COALESCE_GAP_MS / SECOND;
    expect(coalesce([iv(0, 20), iv(20 + gap - 1, 40)])).toEqual([iv(0, 40)]);
  });

  it('keeps genuinely separated sessions apart', () => {
    // A real "left and came back" gap, well beyond one tick.
    expect(coalesce([iv(0, 20), iv(300, 320)])).toEqual([iv(0, 20), iv(300, 320)]);
  });

  it('absorbs overlapping and fully-contained intervals', () => {
    expect(coalesce([iv(0, 100), iv(20, 50), iv(40, 130)])).toEqual([iv(0, 130)]);
  });

  it('clamps end < start (backwards clock) to a zero-length interval', () => {
    expect(coalesce([{ start: at(50), end: at(10) }])).toEqual([{ start: at(50), end: at(50) }]);
  });

  it('is idempotent', () => {
    const once = coalesce([iv(0, 20), iv(10, 40), iv(300, 320)]);
    expect(coalesce(once)).toEqual(once);
  });
});

describe('unionLengthMs', () => {
  it('is zero for an empty list', () => {
    expect(unionLengthMs([])).toBe(0);
  });

  it('sums disjoint intervals', () => {
    expect(unionLengthMs([iv(0, 10), iv(100, 130)])).toBe(at(40));
  });

  it('counts two fully-overlapping device intervals only once', () => {
    // The headline anti-double-count case: same 10 minutes watched on two
    // devices at the same time = 10 minutes spent, not 20.
    const deviceA = iv(0, 600);
    const deviceB = iv(0, 600);
    expect(unionLengthMs([deviceA, deviceB])).toBe(at(600));
  });

  it('counts partial cross-device overlap as the wall-clock union', () => {
    // A: 0–10min, B: 5–15min → union is 0–15min = 15min, not 20.
    expect(unionLengthMs([iv(0, 600), iv(300, 900)])).toBe(at(900));
  });

  it('treats touching intervals as contiguous (no gap, no double count)', () => {
    expect(unionLengthMs([iv(0, 10), iv(10, 20)])).toBe(at(20));
  });

  it('does not merge across a genuine gap (gap is real not-watched time)', () => {
    expect(unionLengthMs([iv(0, 20), iv(300, 320)])).toBe(at(40));
  });
});

describe('capIntervals', () => {
  it('reduces a pathological day below the cap by merging closest gaps', () => {
    // 500 separated 1s sessions, 5s apart — more than MAX_INTERVALS_PER_DAY.
    const many: Interval[] = Array.from({ length: 500 }, (_, i) => iv(i * 5, i * 5 + 1));
    const capped = capIntervals(many, 200);
    expect(capped.length).toBeLessThanOrEqual(200);
    // Total covered time only grows (merging fills the small gaps), never shrinks.
    expect(unionLengthMs(capped)).toBeGreaterThanOrEqual(unionLengthMs(many));
  });

  it('leaves an already-small day untouched in length', () => {
    const day = [iv(0, 20), iv(300, 320)];
    expect(capIntervals(day)).toEqual(coalesce(day));
  });
});
