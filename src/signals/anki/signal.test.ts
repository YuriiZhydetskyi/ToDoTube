import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStudyTodayMs } from './signal';
import { startOfLocalDayMs } from './reviews';

// Stub global fetch with an AnkiConnect-shaped responder keyed on the
// requested action (and params, so cardReviews can vary per deck).
type AnkiReply = { result?: unknown; error?: string | null };
function stubAnki(handler: (action: string, params: Record<string, unknown>) => AnkiReply): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      const { result = null, error = null } = handler(body.action, body.params);
      return { ok: true, json: async () => ({ result, error }) } as unknown as Response;
    }),
  );
}

// Raw revlog row: [id, cid, usn, ease, ivl, lastIvl, factor, time, type]
const review = (timeMs: number): number[] => [1_700_000_000_000, 1, 0, 3, 10, 5, 2500, timeMs, 1];

afterEach(() => vi.unstubAllGlobals());

describe('readStudyTodayMs', () => {
  it('sums review durations across all decks', async () => {
    stubAnki((action, params) => {
      if (action === 'deckNames') return { result: ['A', 'B'] };
      if (action === 'cardReviews') {
        return { result: params.deck === 'A' ? [review(8000), review(12000)] : [review(5000)] };
      }
      return { result: null };
    });
    const r = await readStudyTodayMs(Date.now());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(25000);
  });

  it('returns 0 when no reviews happened today', async () => {
    stubAnki((action) => (action === 'deckNames' ? { result: ['A'] } : { result: [] }));
    const r = await readStudyTodayMs(Date.now());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('propagates a deckNames error', async () => {
    stubAnki((action) => (action === 'deckNames' ? { error: 'collection is not open' } : {}));
    const r = await readStudyTodayMs(Date.now());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('collection');
  });

  it('propagates a cardReviews error', async () => {
    stubAnki((action) =>
      action === 'deckNames' ? { result: ['A'] } : { error: 'deck not found' },
    );
    const r = await readStudyTodayMs(Date.now());
    expect(r.ok).toBe(false);
  });
});

// The cached `ankiStudyTodaySignal.read()` (not the uncached `readStudyTodayMs`
// helper) memoizes its SignalValue for CACHE_MS (~20s) keyed ONLY on elapsed
// time. But the value it caches — "study time today" — is bounded by the LOCAL
// day, computed from `startOfLocalDayMs(now)`. So a cache populated just before
// local midnight is logically stale just after midnight, even inside the TTL.
//
// Intended behavior: crossing local midnight must yield the NEW day's value
// (a fresh recompute for the new day boundary), not yesterday's carried-over
// total. A stale carry-over would let a user keep yesterday's earned Anki time
// for up to CACHE_MS into the new day.
describe('ankiStudyTodaySignal.read() — cache across local midnight', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  // Pick a deterministic local midnight by running `setHours(0,0,0,0)` (exactly
  // what startOfLocalDayMs does) so the test is timezone-robust: we never
  // hardcode an epoch, we derive the boundary the same way production does.
  function nextLocalMidnightMs(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() + 24 * 60 * 60 * 1000;
  }

  it('does not return yesterday total after crossing midnight within the TTL', async () => {
    const midnight = nextLocalMidnightMs();
    const yesterdayStartID = startOfLocalDayMs(midnight - 1); // start of the day that ENDS at `midnight`
    const todayStartID = startOfLocalDayMs(midnight + 1); // start of the NEW day

    // Sanity: the two days really do have distinct local-day boundaries, so the
    // signal's startID changes across midnight (otherwise the test is moot).
    expect(todayStartID).not.toBe(yesterdayStartID);

    const YESTERDAY_TOTAL = 25_000;
    // AnkiConnect responder keyed on the startID the signal passes: yesterday's
    // boundary yields a study total; today's boundary yields a fresh zero.
    stubAnki((action, params) => {
      if (action === 'deckNames') return { result: ['A'] };
      if (action === 'cardReviews') {
        if (params.startID === yesterdayStartID) return { result: [review(YESTERDAY_TOTAL)] };
        return { result: [] };
      }
      return { result: null };
    });

    // Import the signal fresh so its module-level cache starts empty.
    vi.useFakeTimers();
    const { ankiStudyTodaySignal } = await import('./signal');

    // Populate the cache at 23:59:50 local (10s before midnight) → yesterday.
    vi.setSystemTime(midnight - 10_000);
    const before = await ankiStudyTodaySignal.read();
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.value.kind).toBe('durationMs');
      expect(before.value.value).toBe(YESTERDAY_TOTAL);
    }

    // Re-read at 00:00:05 local the next day (15s later, still inside the 20s
    // TTL). The intended result is the NEW day's value (0), not the stale total.
    vi.setSystemTime(midnight + 5_000);
    const after = await ankiStudyTodaySignal.read();
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.value).toBe(0);
    }
  });
});
