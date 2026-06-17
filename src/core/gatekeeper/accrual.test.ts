import { describe, expect, it } from 'vitest';

import { MAX_ACCRUAL_MS, stepAccrual, stepMediaAccrual } from './accrual';

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

describe('stepMediaAccrual', () => {
  // currentTime is in SECONDS; wall timestamps use at() (ms). A fresh closed
  // window is { lastCt: null, lastWall: null }.
  const closed = { lastCt: null, lastWall: null };

  it('opens a window without accruing when first eligible', () => {
    expect(stepMediaAccrual(closed, true, 100, 1, at(0))).toEqual({
      deltaMs: 0,
      lastCt: 100,
      lastWall: at(0),
    });
  });

  it('is a no-op when closed and still ineligible', () => {
    expect(stepMediaAccrual(closed, false, 0, 1, at(99))).toEqual({
      deltaMs: 0,
      lastCt: null,
      lastWall: null,
    });
  });

  it('accrues real elapsed at 1x and advances both baselines', () => {
    // Played 20s of content in 20s of wall time at 1x.
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, true, 120, 1, at(20))).toEqual({
      deltaMs: at(20),
      lastCt: 120,
      lastWall: at(20),
    });
  });

  it('counts real time, not content time, at 2x (frozen then resumed)', () => {
    // JS was frozen 600s; at 2x, currentTime advanced 1200s of content. Real
    // elapsed time is 600s, not 1200s.
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, true, 1300, 2, at(600))).toEqual({
      deltaMs: at(600),
      lastCt: 1300,
      lastWall: at(600),
    });
  });

  it('accrues nothing while paused (currentTime frozen) but keeps the window open', () => {
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, true, 100, 1, at(20))).toEqual({
      deltaMs: 0,
      lastCt: 100,
      lastWall: at(20),
    });
  });

  it('a backward seek (or element swap) counts 0 but still advances the baseline', () => {
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, true, 50, 1, at(20))).toEqual({
      deltaMs: 0,
      lastCt: 50,
      lastWall: at(20),
    });
  });

  it('clamps a forward seek to the real wall time elapsed', () => {
    // Seeked +900s of content instantly; only 2s of real time passed.
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, true, 1000, 1, at(2))).toEqual({
      deltaMs: at(2),
      lastCt: 1000,
      lastWall: at(2),
    });
  });

  it('guards against a non-positive playbackRate', () => {
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, true, 120, 0, at(20)).deltaMs).toBe(
      0,
    );
  });

  it('flushes the tail and closes the window when it becomes ineligible (refocus)', () => {
    // Listened 5s in the background, then refocused the tab.
    expect(stepMediaAccrual({ lastCt: 100, lastWall: at(0) }, false, 105, 1, at(5))).toEqual({
      deltaMs: at(5),
      lastCt: null,
      lastWall: null,
    });
  });
});
