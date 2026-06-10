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
