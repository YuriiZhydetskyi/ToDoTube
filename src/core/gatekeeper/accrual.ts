// Pure accrual state machine for the "spent" side of budget gates: turns a
// stream of eligibility checks into screen-time deltas. Kept free of DOM,
// storage, and messaging so it's trivially testable (mirrors `localDayKey`
// in ./usage.ts); the content script in ./overlay-controller.ts owns the
// side-effects (reading focus/visibility, sending USAGE_TICK).
//
// Model: a single "accrual window" that is open while the tab is eligible
// (allowed + visible + focused). `lastAt` is the timestamp the open window has
// already accrued up to, or null when no window is open. Every reconciliation
// emits the real elapsed time since `lastAt` — so the periodic tick and the
// flush-on-hide path share one code path and partial time is never lost.

// How often an active, allowed blocked-site tab reports screen time to the
// background. Only the reporting cadence — the amount reported is the real
// elapsed time since the last report, so a partial interval before a reload
// isn't lost. The content script drives its setInterval off this.
export const USAGE_TICK_MS = 20_000;

// Sleep-guard: never accrue more than this in one step. Bounds the worst case
// when a step spans a long gap (system sleep/suspend with the tab still
// focused). Normal steps are ~one tick interval; the flush tail is < one tick.
// Derived from the cadence in code so it can never silently desync from it.
export const MAX_ACCRUAL_MS = USAGE_TICK_MS * 2;

const clamp = (ms: number): number => Math.min(Math.max(0, ms), MAX_ACCRUAL_MS);

export interface AccrualStep {
  // Real elapsed screen time to add to today's total (always >= 0).
  deltaMs: number;
  // The next window timestamp: `now` while a window stays open, null once closed.
  lastAt: number | null;
}

// Reconcile the accrual window against current eligibility at time `now`.
// Returns how much to accrue and the next `lastAt` to store.
export function stepAccrual(lastAt: number | null, eligible: boolean, now: number): AccrualStep {
  if (eligible) {
    // Opening a fresh window: nothing has elapsed yet, just mark the start.
    if (lastAt === null) return { deltaMs: 0, lastAt: now };
    // Window already open: accrue real elapsed, keep it open.
    return { deltaMs: clamp(now - lastAt), lastAt: now };
  }
  // No longer eligible. If a window was open, flush its tail and close it.
  if (lastAt === null) return { deltaMs: 0, lastAt: null };
  return { deltaMs: clamp(now - lastAt), lastAt: null };
}

// The second "stopwatch": accrual driven by a media element's playback position
// instead of wall time. Used when the tab is INACTIVE but a media element is
// playing audibly (a YouTube video listened to as a podcast with the screen off /
// browser minimised / another tab focused). On mobile the content-script JS is
// throttled or frozen while backgrounded, so we can't trust wall-clock ticks;
// instead we read how far `currentTime` advanced whenever the JS next runs and
// convert media time to real time via `playbackRate` (so 2x playback counts real
// seconds, not content seconds). See docs/GATING.md and the gatekeeper's pump().

// An open media window tracks the playback position (`lastCt`, in SECONDS) and the
// wall timestamp (`lastWall`, in epoch ms) it has accrued up to; both null when
// the window is closed. Carried in the content-script controller's State.
export interface MediaAccrualState {
  lastCt: number | null;
  lastWall: number | null;
}

export interface MediaAccrualStep extends MediaAccrualState {
  // Real elapsed listening time to add to today's total (always >= 0).
  deltaMs: number;
}

// Reconcile the media window against current eligibility at time `now`. `eligible`
// is true when the tab is inactive AND an audible media element is present (see
// readPlayingMedia). `currentTime`/`playbackRate` are that element's values now.
//
// The accrued amount is how far playback advanced (`currentTime - lastCt`),
// converted from media seconds to wall milliseconds by dividing by playbackRate,
// then clamped to [0, real wall time elapsed]. That wall clamp is also the guard:
// a forward seek or a frozen-then-resumed gap can never count more than the real
// time that passed, a backward seek (or paused element) yields 0, and a true
// system sleep counts ~0 because the media froze too. So no fixed sleep cap is
// needed on this path — unlike stepAccrual, a legitimately long background session
// must be allowed to flush in one large delta.
export function stepMediaAccrual(
  prev: MediaAccrualState,
  eligible: boolean,
  currentTime: number,
  playbackRate: number,
  now: number,
): MediaAccrualStep {
  const { lastCt, lastWall } = prev;
  // Window closed: open a fresh one (baselines only, no accrual) or stay closed.
  if (lastCt === null) {
    return eligible
      ? { deltaMs: 0, lastCt: currentTime, lastWall: now }
      : { deltaMs: 0, lastCt: null, lastWall: null };
  }

  // Window open: measure the advance since the baseline.
  const ctDeltaSec = currentTime - lastCt;
  const wallMs = now - (lastWall ?? now);
  const mediaMs = playbackRate > 0 ? (ctDeltaSec / playbackRate) * 1000 : 0;
  const deltaMs = Math.min(Math.max(0, mediaMs), Math.max(0, wallMs));

  // Eligible → keep the window open, advancing both baselines (even when the
  // delta clamped to 0, e.g. a backward seek, so the next step measures forward).
  // Not eligible → flush this tail (e.g. on refocus) and close.
  return eligible
    ? { deltaMs, lastCt: currentTime, lastWall: now }
    : { deltaMs, lastCt: null, lastWall: null };
}
