import { describe, expect, it } from 'vitest';

import { MAX_ACCRUAL_MS, stepAccrual } from './accrual';

// A small clock helper to keep the scenarios readable.
const SECOND = 1_000;
const at = (s: number) => s * SECOND;

describe('stepAccrual', () => {
  it('opens a window without accruing when first eligible', () => {
    expect(stepAccrual(null, true, at(0))).toEqual({ deltaMs: 0, lastAt: at(0) });
  });

  it('accrues real elapsed and keeps the window open on a periodic step', () => {
    expect(stepAccrual(at(0), true, at(20))).toEqual({ deltaMs: at(20), lastAt: at(20) });
  });

  it('flushes the tail and closes the window when eligibility ends', () => {
    expect(stepAccrual(at(20), false, at(25))).toEqual({ deltaMs: at(5), lastAt: null });
  });

  it('is a no-op when already closed and still ineligible', () => {
    expect(stepAccrual(null, false, at(99))).toEqual({ deltaMs: 0, lastAt: null });
  });

  it('counts 25s watched then reloaded as 25s total (open -> tick -> flush)', () => {
    const open = stepAccrual(null, true, at(0)); // page becomes eligible
    const tick = stepAccrual(open.lastAt, true, at(20)); // 20s periodic tick
    const flush = stepAccrual(tick.lastAt, false, at(25)); // reload -> hidden
    expect(tick.deltaMs + flush.deltaMs).toBe(at(25));
    expect(flush.lastAt).toBeNull();
  });

  it('records a sub-20s session that never reached a periodic tick', () => {
    const open = stepAccrual(null, true, at(0));
    const flush = stepAccrual(open.lastAt, false, at(19)); // left after 19s
    expect(flush.deltaMs).toBe(at(19)); // previously this was lost as 0
  });

  it('clamps an oversized gap to the sleep guard', () => {
    // System slept for an hour with the tab still focused.
    expect(stepAccrual(at(0), true, at(3600)).deltaMs).toBe(MAX_ACCRUAL_MS);
    expect(stepAccrual(at(0), false, at(3600)).deltaMs).toBe(MAX_ACCRUAL_MS);
  });

  it('never returns a negative delta if the clock moves backwards', () => {
    expect(stepAccrual(at(20), true, at(10)).deltaMs).toBe(0);
  });
});
