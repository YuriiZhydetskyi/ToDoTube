// Local-day helpers for the gating subsystem. Pure (no storage/DOM) so they're
// trivially testable and every reader/writer agrees on the day boundary.
//
// `localDayKey` previously lived in core/gatekeeper/usage.ts; it moved here so
// core/sync can key interval records by day without importing the gatekeeper
// (which would create an import cycle). Signature and semantics are unchanged —
// it still uses the device's LOCAL timezone. usage.ts re-exports it, so the
// gatekeeper's task-cache key keeps the same value.

import type { Interval } from './intervals';

export function localDayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Shift a "YYYY-MM-DD" key by whole days, returning a new key. Computed in local
// time to match localDayKey. Used to derive the prune cutoff for old records.
export function shiftDay(day: string, deltaDays: number): string {
  const parts = day.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const date = Number(parts[2]);
  return localDayKey(new Date(year, month - 1, date + deltaDays).getTime());
}

// Split a wall-clock interval [start, end) into sub-intervals that each lie within
// a single LOCAL day, cutting at local midnight. Pure. recordUsage uses this so a
// large catch-up flush that straddles midnight (now possible when a long
// background-audio session is reconciled on return) is attributed to the correct
// day(s) instead of landing wholly under the flush moment's day. A normal
// within-day delta returns a single segment, so the common path is unchanged.
export function splitByLocalDay(start: number, end: number): Interval[] {
  if (end <= start) return [];
  const out: Interval[] = [];
  let cur = start;
  while (cur < end) {
    const d = new Date(cur);
    // Local wall-clock next midnight (DST-consistent with localDayKey).
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const segEnd = Math.min(nextMidnight, end);
    out.push({ start: cur, end: segEnd });
    cur = segEnd;
  }
  return out;
}
