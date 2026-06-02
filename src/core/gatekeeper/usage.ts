// Screen-time usage tracker — the "spent" side of ledger-style gates (e.g.
// the Anki budget gate). Tracks wall-clock time attributed to ALL enabled
// blocked sites for the current local day (they share one budget); a new day
// resets the tally implicitly (readers treat a stale stored `day` as zero).
//
// The accrual itself is site-agnostic: any blocked site's content script
// reports its elapsed time here, so the single tally naturally covers the
// shared budget. The day-rollover logic lives here; storage is the plain
// { day, ms } record in shared/storage.ts.

import { getUsageRecord, setUsageRecord } from '@/shared/storage';

// Local-day key "YYYY-MM-DD". Pure (no storage) so it's trivially testable
// and so every reader/writer agrees on the day boundary.
export function localDayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export async function getSpentTodayMs(now: number): Promise<number> {
  const rec = await getUsageRecord();
  return rec.day === localDayKey(now) ? rec.ms : 0;
}

export async function addSpentMs(now: number, deltaMs: number): Promise<void> {
  if (deltaMs <= 0) return;
  const today = localDayKey(now);
  const rec = await getUsageRecord();
  const base = rec.day === today ? rec.ms : 0;
  await setUsageRecord({ day: today, ms: base + deltaMs });
}
