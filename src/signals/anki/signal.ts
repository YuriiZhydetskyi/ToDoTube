// "Anki study time today" signal. AnkiConnect has no single action for time
// studied, so we fan out: list decks, fetch each deck's reviews since local
// midnight, and sum the review-duration column.
//
// A short module-level cache keeps the gate's periodic re-evaluation from
// hammering AnkiConnect (the 1-minute gate alarm + any on-demand evals).

import { err, ok, type Result } from '@/shared/result';
import { ANKI_STUDY_SIGNAL_ID, type SignalValue } from '@/shared/types';

import type { Signal } from '../types';
import { ankiInvoke } from './client';
import { ANKI_ACTIONS } from './constants';
import { startOfLocalDayMs, sumReviewDurationMs } from './reviews';

const CACHE_MS = 20_000;
let cache: { value: SignalValue; at: number } | null = null;

async function readStudyTodayMs(now: number): Promise<Result<number, string>> {
  const startID = startOfLocalDayMs(now);

  const decks = await ankiInvoke<string[]>(ANKI_ACTIONS.deckNames);
  if (!decks.ok) return err(decks.error);

  let totalMs = 0;
  for (const deck of decks.value) {
    const reviews = await ankiInvoke<unknown>(ANKI_ACTIONS.cardReviews, { deck, startID });
    if (!reviews.ok) return err(reviews.error);
    totalMs += sumReviewDurationMs(reviews.value);
  }
  return ok(totalMs);
}

export const ankiStudyTodaySignal: Signal = {
  id: ANKI_STUDY_SIGNAL_ID,
  displayName: 'Anki study time today',

  async read(): Promise<Result<SignalValue, string>> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_MS) return ok(cache.value);

    const studied = await readStudyTodayMs(now);
    if (!studied.ok) return err(studied.error);

    const value: SignalValue = { kind: 'durationMs', value: studied.value, asOf: now };
    cache = { value, at: now };
    return ok(value);
  },

  // Cheap reachability check — a single deckNames call. Distinguishes
  // "Anki unreachable" from a genuine zero so the gate can fail-closed.
  async probe(): Promise<Result<void, string>> {
    const r = await ankiInvoke<string[]>(ANKI_ACTIONS.deckNames);
    return r.ok ? ok(undefined) : err(r.error);
  },
};
