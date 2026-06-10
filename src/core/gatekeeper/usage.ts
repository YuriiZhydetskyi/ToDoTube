// Screen-time usage — the "spent" side of ledger-style gates (e.g. the Anki
// budget gate). The actual storage and the cross-device UNION of watch-time now
// live in core/sync (see docs/SYNC.md): each device records its time as a set of
// intervals, and "spent today" is the union length across all the user's
// devices, so simultaneous watching on two devices counts once.
//
// This module stays the gatekeeper-facing entry point and re-exports the shared
// local-day helper, so the gatekeeper's task-cache key keeps the same value and
// callers don't need to know about the sync layer.

export { localDayKey } from '@/shared/day';
export { getSpentTodayMs, recordUsage } from '@/core/sync';
