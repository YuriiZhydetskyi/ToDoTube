// Single source of truth for every AnkiConnect magic string — the Anki
// analogue of surfaces/**/selectors.ts. Nothing AnkiConnect-specific
// (endpoint, port, version, action names, tuple layout) may appear
// anywhere else in the codebase.

export const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
export const ANKI_CONNECT_VERSION = 6;

// Host match pattern for the optional permission we request before talking
// to AnkiConnect from the background.
export const ANKI_HOST_PERMISSION = 'http://127.0.0.1:8765/*';

export const ANKI_ACTIONS = {
  deckNames: 'deckNames',
  cardReviews: 'cardReviews',
} as const;

// `cardReviews` returns one array per review — a raw Anki `revlog` row
// (9 columns):
//   [id, cid, usn, ease, ivl, lastIvl, factor, time, type]
// `time` (index 7) is the review duration in ms — the only value we read.
// This index is the one fragile part of the Anki integration; if a live
// collection disagrees, fix it HERE and nowhere else.
export const ANKI_REVIEW_TIME_INDEX = 7;
