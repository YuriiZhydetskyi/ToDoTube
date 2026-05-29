// Pure helpers for the Anki study-time calculation, split out so they're
// unit-testable without a live AnkiConnect or any browser API.

import { ANKI_REVIEW_TIME_INDEX } from './constants';

// Epoch ms of the most recent local midnight at or before `now`. Used as
// the `startID` passed to AnkiConnect's cardReviews (review ids are epoch
// ms), so we only sum today's reviews.
export function startOfLocalDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Sum the review-duration column across a deck's cardReviews rows. Tolerant
// of malformed rows (skips any whose time cell isn't a finite number).
export function sumReviewDurationMs(reviews: unknown): number {
  if (!Array.isArray(reviews)) return 0;
  let total = 0;
  for (const row of reviews) {
    if (!Array.isArray(row)) continue;
    const t = row[ANKI_REVIEW_TIME_INDEX];
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) total += t;
  }
  return total;
}
