// Pure interval algebra for the synced "spent" side of budget gates.
//
// A device records the time it spent on blocked sites as a set of [start, end]
// wall-clock intervals. The daily total spent across ALL of the user's devices
// is the LENGTH OF THE UNION of every device's intervals — so watching on two
// devices at the same moment counts once, not twice (the overlap requirement).
//
// Kept free of storage/DOM/messaging (mirrors `stepAccrual` in
// core/gatekeeper/accrual.ts) so it's trivially testable, and it lives in
// `shared` so both the sync transports (core) and the gatekeeper can use it
// without crossing a layer boundary.

// A half-open-ish wall-clock interval in epoch ms. Normalised intervals satisfy
// `end >= start`; a zero-length interval contributes nothing and merges away.
export interface Interval {
  start: number;
  end: number;
}

// One device's coalesced intervals for one local day. This is the unit that
// travels to and from a sync transport. Partitioned by `deviceId` so each
// device only ever writes its own record — conflict-free even on a
// last-write-wins transport (browser storage.sync).
export interface DeviceDayUsage {
  deviceId: string;
  // Local-day key "YYYY-MM-DD" (see `localDayKey` in core/gatekeeper/usage.ts).
  day: string;
  intervals: Interval[];
}

// Defensively coerce an untrusted `intervals` value (a row fetched from a
// user-controlled sync backend) into normalised Interval[], dropping any entry
// that isn't a {start:number,end:number} pair. A non-array yields []. Shared by
// the HTTP and Upstash transports so backend parsing stays in one place.
export function coerceIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const iv of raw) {
    if (!iv || typeof iv !== 'object') continue;
    const { start, end } = iv as Record<string, unknown>;
    if (typeof start === 'number' && typeof end === 'number') out.push({ start, end });
  }
  return out;
}

// Two same-device intervals no more than this apart are merged into one. Set to
// the usage-tick cadence (~20s): consecutive ticks during continuous watching
// land about one tick apart and must merge into a single session, while a real
// "left and came back" gap exceeds a tick and stays a separate interval.
//
// Declared here rather than imported from accrual.ts's `USAGE_TICK_MS` because
// `shared` may not import `core` (enforced by eslint-plugin-boundaries). It only
// needs to be at least one tick; coupling them exactly is unnecessary.
export const COALESCE_GAP_MS = 20_000;

// Upper bound on stored intervals per device-day. Coalescing keeps a normal day
// to a handful of intervals; this caps a pathological day (hundreds of tiny
// separated sessions) so the serialised record can't approach storage.sync's
// 8 KB/item limit. On overflow `capIntervals` merges the closest gaps first.
export const MAX_INTERVALS_PER_DAY = 200;

// Merge a list of intervals into sorted, non-overlapping runs. Two intervals
// merge when the later one starts within `gapMs` of the running end. Clamps
// `end >= start` (defends against clock skew between devices).
function merge(intervals: readonly Interval[], gapMs: number): Interval[] {
  const sorted = intervals
    .map((iv) => ({ start: iv.start, end: Math.max(iv.start, iv.end) }))
    .sort((a, b) => a.start - b.start);

  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end + gapMs) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

// Coalesce one device's intervals for storage: sort, clamp, and merge sessions
// that are within `gapMs` of each other. Idempotent.
export function coalesce(
  intervals: readonly Interval[],
  gapMs: number = COALESCE_GAP_MS,
): Interval[] {
  return merge(intervals, gapMs);
}

// Total covered time across the (possibly multi-device) interval list. Overlaps
// are counted once; genuine gaps between sessions are excluded. This is the
// daily `spentTodayMs`.
export function unionLengthMs(intervals: readonly Interval[]): number {
  return merge(intervals, 0).reduce((sum, iv) => sum + (iv.end - iv.start), 0);
}

// Keep a device-day record under `max` intervals by progressively merging the
// closest sessions (widening the gap) until it fits. Used only as a safety cap;
// a normal day never hits it.
export function capIntervals(
  intervals: readonly Interval[],
  max: number = MAX_INTERVALS_PER_DAY,
): Interval[] {
  let result = coalesce(intervals);
  let gap = COALESCE_GAP_MS;
  while (result.length > max) {
    gap *= 4;
    result = merge(result, gap);
  }
  return result;
}
