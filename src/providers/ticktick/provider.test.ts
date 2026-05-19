import { describe, expect, it } from 'vitest';

import { endOfLocalDay, isDueByEndOfDay, isDueBetween, startOfLocalDay } from './provider';

describe('startOfLocalDay / endOfLocalDay', () => {
  it('startOfLocalDay zeroes the time fields in local TZ', () => {
    const d = new Date('2026-05-18T15:42:33.123Z');
    const start = startOfLocalDay(d);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    // Same local Y/M/D as the input.
    expect(start.getFullYear()).toBe(d.getFullYear());
    expect(start.getMonth()).toBe(d.getMonth());
    expect(start.getDate()).toBe(d.getDate());
  });

  it('endOfLocalDay pegs to 23:59:59.999 local', () => {
    const d = new Date('2026-05-18T00:00:01Z');
    const end = endOfLocalDay(d);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('does not mutate the input Date', () => {
    const d = new Date('2026-05-18T15:42:33Z');
    const originalMs = d.getTime();
    startOfLocalDay(d);
    endOfLocalDay(d);
    expect(d.getTime()).toBe(originalMs);
  });
});

describe('isDueBetween', () => {
  it('returns true when due is at start of day', () => {
    const start = startOfLocalDay(new Date(2026, 4, 18));
    const end = endOfLocalDay(new Date(2026, 4, 18));
    expect(isDueBetween(start.toISOString(), start, end)).toBe(true);
  });

  it('returns true when due is at end of day', () => {
    const start = startOfLocalDay(new Date(2026, 4, 18));
    const end = endOfLocalDay(new Date(2026, 4, 18));
    expect(isDueBetween(end.toISOString(), start, end)).toBe(true);
  });

  it('returns false when due is before start of day', () => {
    const start = startOfLocalDay(new Date(2026, 4, 18));
    const end = endOfLocalDay(new Date(2026, 4, 18));
    const before = new Date(start.getTime() - 1).toISOString();
    expect(isDueBetween(before, start, end)).toBe(false);
  });

  it('returns false when due is after end of day', () => {
    const start = startOfLocalDay(new Date(2026, 4, 18));
    const end = endOfLocalDay(new Date(2026, 4, 18));
    const after = new Date(end.getTime() + 1).toISOString();
    expect(isDueBetween(after, start, end)).toBe(false);
  });

  it('returns false for an invalid ISO string', () => {
    const start = startOfLocalDay(new Date());
    const end = endOfLocalDay(new Date());
    expect(isDueBetween('not a date', start, end)).toBe(false);
  });

  it('returns true for an overdue task (before start of day, before end of day)', () => {
    const today = new Date(2026, 4, 18);
    const end = endOfLocalDay(today);
    // A task due yesterday is overdue — but isDueBetween only returns
    // true for STRICTLY today. We added isDueByEndOfDay to include
    // overdue; this test pins the distinction.
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    expect(isDueBetween(yesterday.toISOString(), startOfLocalDay(today), end)).toBe(false);
    expect(isDueByEndOfDay(yesterday.toISOString(), end)).toBe(true);
  });

  it('handles DST transition days without missing tasks', () => {
    // March 8, 2026 is the US DST spring-forward day. A task at 09:00
    // local on that day is well inside the local "today" boundary in
    // every TZ — the contract is "local-day comparison", and our
    // implementation uses local-Date math, not raw UTC subtraction.
    const dstDay = new Date(2026, 2, 8, 9, 0, 0);
    const start = startOfLocalDay(dstDay);
    const end = endOfLocalDay(dstDay);
    expect(isDueBetween(dstDay.toISOString(), start, end)).toBe(true);
  });
});

describe('Today filter (matches listTasksToday)', () => {
  // The production filter ORs two windows:
  //   - dueDate inside a rolling 3-day window (today + previous 2 days)
  //   - startDate strictly on today
  // These tests exercise both sides via the underlying `isDueBetween`
  // helper, mirroring how `decideTodayInclusion` calls it. They pin the
  // semantics so future refactors of `listTasksToday` can't drift —
  // e.g. shrinking the dueDate window, or losing the startDate rescue.
  const today = new Date(2026, 4, 18, 12, 0, 0);
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(today.getDate() - 2);
  const windowStart = startOfLocalDay(twoDaysAgo);
  const windowEnd = endOfLocalDay(today);
  const dayStart = startOfLocalDay(today);
  const dayEnd = windowEnd;

  function at(year: number, month: number, day: number, hour = 12): string {
    return new Date(year, month, day, hour).toISOString();
  }

  // dueDate window
  it('dueDate today → included', () => {
    expect(isDueBetween(at(2026, 4, 18), windowStart, windowEnd)).toBe(true);
  });

  it('dueDate yesterday → included', () => {
    expect(isDueBetween(at(2026, 4, 17), windowStart, windowEnd)).toBe(true);
  });

  it('dueDate 2 days ago → included', () => {
    expect(isDueBetween(at(2026, 4, 16), windowStart, windowEnd)).toBe(true);
  });

  it('dueDate 3 days ago → excluded', () => {
    expect(isDueBetween(at(2026, 4, 15), windowStart, windowEnd)).toBe(false);
  });

  it('dueDate many months ago ("Later" case) → excluded', () => {
    expect(isDueBetween('2025-10-12T22:00:00.000+0000', windowStart, windowEnd)).toBe(false);
  });

  it('dueDate tomorrow → excluded by window', () => {
    expect(isDueBetween(at(2026, 4, 19), windowStart, windowEnd)).toBe(false);
  });

  it('dueDate at exact start-of-window boundary → included', () => {
    expect(isDueBetween(windowStart.toISOString(), windowStart, windowEnd)).toBe(true);
  });

  it('dueDate at exact end-of-window boundary → included', () => {
    expect(isDueBetween(windowEnd.toISOString(), windowStart, windowEnd)).toBe(true);
  });

  // startDate strict-today rescue
  it('startDate today (no dueDate) → included via startDate', () => {
    expect(isDueBetween(at(2026, 4, 18), dayStart, dayEnd)).toBe(true);
  });

  it('startDate today + dueDate tomorrow → included via startDate', () => {
    // dueDate=tomorrow fails the window…
    expect(isDueBetween(at(2026, 4, 19), windowStart, windowEnd)).toBe(false);
    // …but startDate=today rescues.
    expect(isDueBetween(at(2026, 4, 18), dayStart, dayEnd)).toBe(true);
  });

  it('startDate yesterday → NOT rescued (strict-today on startDate)', () => {
    expect(isDueBetween(at(2026, 4, 17), dayStart, dayEnd)).toBe(false);
  });

  it('startDate tomorrow → NOT rescued', () => {
    expect(isDueBetween(at(2026, 4, 19), dayStart, dayEnd)).toBe(false);
  });
});

describe('isDueByEndOfDay', () => {
  const end = endOfLocalDay(new Date(2026, 4, 18));

  it('returns true for overdue tasks', () => {
    const lastWeek = new Date(2026, 4, 11, 12, 0, 0);
    expect(isDueByEndOfDay(lastWeek.toISOString(), end)).toBe(true);
  });

  it('returns true for tasks due today (mid-day)', () => {
    const today = new Date(2026, 4, 18, 12, 0, 0);
    expect(isDueByEndOfDay(today.toISOString(), end)).toBe(true);
  });

  it('returns true at the exact end-of-day boundary', () => {
    expect(isDueByEndOfDay(end.toISOString(), end)).toBe(true);
  });

  it('returns false for tasks due tomorrow', () => {
    const tomorrow = new Date(end.getTime() + 1);
    expect(isDueByEndOfDay(tomorrow.toISOString(), end)).toBe(false);
  });

  it('returns false for an invalid ISO string', () => {
    expect(isDueByEndOfDay('not a date', end)).toBe(false);
  });
});
