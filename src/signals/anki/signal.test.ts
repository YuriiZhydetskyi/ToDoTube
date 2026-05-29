import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStudyTodayMs } from './signal';

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
