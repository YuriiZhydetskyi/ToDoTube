// YouTube usage tracker — the "spent" side of ledger-style gates (e.g. the
// Anki budget gate). Tracks wall-clock time attributed to YouTube for the
// current local day; a new day resets the tally implicitly (readers treat a
// stale stored `day` as zero).
//
// The task-complete gate doesn't consume this yet, but the interface is
// stable so the Anki gate can plug in without reshaping storage. Wiring the
// actual accrual (active-tab timing) lands with that gate.

import { getUsageRecord, setUsageRecord } from '@/shared/storage';

// Local-day key "YYYY-MM-DD". Pure (no storage) so it's trivially testable
// and so every reader/writer agrees on the day boundary.
export function localDayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export async function getYoutubeUsageTodayMs(now: number): Promise<number> {
  const rec = await getUsageRecord();
  return rec.day === localDayKey(now) ? rec.ms : 0;
}

export async function addYoutubeUsageMs(now: number, deltaMs: number): Promise<void> {
  if (deltaMs <= 0) return;
  const today = localDayKey(now);
  const rec = await getUsageRecord();
  const base = rec.day === today ? rec.ms : 0;
  await setUsageRecord({ day: today, ms: base + deltaMs });
}
