# Multi-device sync (Focus-mode budget)

Optional. Shares the gating **"spent"** budget across a user's devices so the
daily YouTube/time-sink allowance is enforced everywhere, not per-device. Off by
default; the user opts in per the [data model](#data-model) and a chosen
[transport](#transports).

> **Why a backend at all?** `storage.sync` (the browser's own account sync) is
> the obvious zero-backend choice, but it **does not synchronise on Firefox for
> Android** — it is local-only there ([Firefox bug
> 1625257](https://bugzilla.mozilla.org/show_bug.cgi?id=1625257)). So browser
> sync only ever reaches same-browser **desktops**; reaching the phone requires a
> user-supplied **HTTP backend**. Both are offered.

## Data model

The unit is a **per-device, per-day set of wall-clock intervals**:

```ts
interface Interval {
  start: number;
  end: number;
} // epoch ms, end >= start
interface DeviceDayUsage {
  deviceId: string; // stable per device, generated once, never synced
  day: string; // local "YYYY-MM-DD"
  intervals: Interval[]; // coalesced, sorted, non-overlapping within a device
}
```

- **`spentTodayMs` = length of the UNION** of every device's intervals for today
  (`unionLengthMs` in [`src/shared/intervals.ts`](../src/shared/intervals.ts)).
  Watching on two devices at the same moment is counted **once**; genuine gaps
  between sessions are excluded.
- **Partition by `deviceId`:** each device writes **only its own** record, so
  there are no write conflicts even on a last-write-wins transport (browser
  sync). No locking, no merge of concurrent writers — it's a grow-only set
  partitioned by device.
- **Day boundary** is the device's **local** `localDayKey`
  ([`src/shared/day.ts`](../src/shared/day.ts)); intervals are filed under the
  day of their `end`. Known caveats (accepted, not engineered around): devices in
  different timezones can disagree on "today" at the margins, and an interval
  straddling local midnight lands wholesale in one day (≤ one ~20 s tick).

## How a tick becomes an interval

The content script is unchanged — it still sends `USAGE_TICK { deltaMs }` (real
elapsed time, see [GATING.md](./GATING.md)). The background turns it into an
interval and persists it:

1. `recordUsage(now, deltaMs)` ([`src/core/sync/index.ts`](../src/core/sync/index.ts))
   appends `[now - deltaMs, now]` to **this device's LOCAL record**, then
   `coalesce` + `capIntervals` (append-then-normalize — idempotent, absorbs
   replays / overlap / out-of-order ticks). The local write happens **every
   tick**: cheap, unmetered, and it survives MV3 service-worker death.
2. A **throttled** push (`REMOTE_PUSH_THROTTLE_MS`, ~60 s) replicates the local
   record to the remote transport. The 1-minute gate alarm force-pushes as a
   backstop. So the remote sees at most ~1 write/min/device regardless of tick
   rate.
3. `getSpentTodayMs(now)` reads the **local own** record plus **all remote**
   records and returns the union length. The union dedupes our own record (fresh
   local vs last-pushed remote copy), so reading both is safe. A failed remote
   read falls back to local-only — blocking never breaks on a bad/offline sync.

When another device updates the shared budget, the local device re-evaluates and
re-blocks promptly: browser-sync transports fire `onRemoteChange`
(`storage.onChanged`); HTTP backends have no push, so the 1-minute gate alarm
re-reads instead.

## Transports

Pluggable behind the `SyncTransport` port
([`src/shared/sync-transport.ts`](../src/shared/sync-transport.ts)); the registry
([`src/core/sync/registry.ts`](../src/core/sync/registry.ts)) maps the chosen
`Settings.sync.mode` to an adapter and supplies the options-page metadata.

| mode         | reaches                        | backend        | notes                                     |
| ------------ | ------------------------------ | -------------- | ----------------------------------------- |
| `off`        | this device only               | local storage  | default                                   |
| `browser`    | same-browser **desktops** only | `storage.sync` | zero config; **not** Firefox Android      |
| `supabase`   | every device, incl. Android    | your Supabase  | free tier pauses after ~7 days idle       |
| `cloudflare` | every device, incl. Android    | your Worker    | no idle pause                             |
| `upstash`    | every device, incl. Android    | your Redis     | no idle pause; no server code; TTL-pruned |

The HTTP backends are **self-hosted** (the user runs their own — see
[`backends/`](../backends)), which keeps ToDoTube's zero-telemetry stance: no
data leaves the device unless the user configures their own endpoint.

### HTTP wire protocol

One protocol, two flavors ([`src/core/sync/http-transport.ts`](../src/core/sync/http-transport.ts)):

- **Read:** `GET {endpoint}/usage?sync_id={syncId}&day=YYYY-MM-DD` →
  `[{ deviceId, day, intervals }, …]` for all devices.
- **Upsert own:** `PUT/POST {endpoint}/usage` with `{ syncId, deviceId, day, intervals }`.
- **Auth:** Supabase = `apikey` + `Authorization: Bearer <anon key>` over
  PostgREST; Cloudflare = `Authorization: Bearer <secret>`.
- **`syncId`** is a shared secret the user copies to each device — it groups
  their devices (and, in a multi-tenant store, isolates them from others).
  **`deviceId`** partitions writes.

### Upstash Redis (a separate adapter)

Upstash doesn't expose the `/usage` protocol — it's the Redis REST API — so it
gets its own adapter
([`src/core/sync/upstash-transport.ts`](../src/core/sync/upstash-transport.ts))
rather than a third http-transport flavor:

- **Data model:** one Redis **hash** per `(syncId, day)`, keyed
  `todotube:usage:{syncId}:{day}`, field = `deviceId` →
  `JSON.stringify(intervals)`. Per-field `HSET` keeps the partition-by-device
  invariant (no read-modify-write, no write conflicts).
- **Read:** `POST {url}` body `["HGETALL", key]` → a flat `[field, value, …]`
  array, paired back into records.
- **Upsert own:** `POST {url}/pipeline` body
  `[["HSET", key, deviceId, json], ["EXPIRE", key, ttl]]`.
- **Auth:** `Authorization: Bearer <REST token>`.
- **TTL** (`UPSTASH_KEY_TTL_SECONDS`) on each day-key auto-prunes stale days, so
  there's no server-side housekeeping (unlike the SQL/Worker backends).

## What is NOT synced

Only **`spent`**. `earned` is computed locally per device from its signals (Anki
via AnkiConnect, the activity bridge, task completions) — those don't exist on a
phone, so two devices can legitimately compute different `earned` / `budgetMsLeft`.
That's fine: the thing that must not be cheatable across devices is the **debit**
(time burned), and that's exactly what syncing `spent` fixes.

## Storage & limits

- Each device keeps `USAGE_KEEP_DAYS` (2) days; older own-records are pruned on
  write. `MAX_INTERVALS_PER_DAY` (200) caps a pathological day so a record stays
  well under `storage.sync`'s 8 KB/item limit (a normal day is a few intervals).
- Keys are single-sourced in [`src/shared/storage.ts`](../src/shared/storage.ts)
  (`todotube:usage:{deviceId}:{day}`), per the "no magic constants" rule.
- The Upstash backend additionally sets a TTL (`UPSTASH_KEY_TTL_SECONDS`) on each
  remote day-key, so stale days expire server-side without a housekeeping job.

## Migration

`migrateLegacyUsage` (run once at background start, guarded by a flag) seeds
today's own-device record with a single interval of the old scalar
`UsageRecord { day, ms }` length, then clears the legacy key. Toggling sync
on/off never destructively moves data; the displayed total may change at the
toggle (it now includes/excludes other devices).

## Firefox Android

The blocking feature runs on Firefox for Android: the build is MV3 with an event
page (`background: { scripts: [...] }`, not a Chrome service worker), and the
blocked-site content scripts + popup work on Fenix.

Run it on a connected device (USB debugging on, device visible in
`about:debugging`):

```bash
pnpm dev:firefox-android        # builds firefox-mv3 + web-ext run -t firefox-android
# or target a specific device:
#   pnpm build:firefox && npx web-ext run -t firefox-android \
#     --android-device <serial> --source-dir .output/firefox-mv3
```

Manual verification checklist:

- Block overlay mounts on a gated site (e.g. youtube.com) at `document_start`.
- The popup shows the `budgetMsLeft` countdown.
- Accrual fires on tab switch / app background — rely on `visibilitychange`
  (mobile has no real `window.blur/focus` model).
- **Sync to the phone:** set sync to `supabase`/`cloudflare` (NOT `browser` —
  `storage.sync` is local-only on Android, so the `browser` mode silently won't
  cross to the phone). With an HTTP backend configured + the same sync code,
  watching on desktop should debit the phone's budget and vice-versa.
