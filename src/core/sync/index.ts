// Multi-device sync orchestration — the bridge between the gating "spent"
// ledger and the pluggable transports. See docs/SYNC.md for the full design.
//
// Model:
//   - This device's freshest record always lives in LOCAL storage, updated
//     every usage tick (cheap, unmetered, survives service-worker death).
//   - A remote transport (browser sync / HTTP backend) replicates it out on a
//     THROTTLED push and reads other devices back.
//   - spentTodayMs = UNION length of (local own + every remote record). The
//     union dedupes our own record (fresh local vs last-pushed remote copy) and
//     counts simultaneous watching on two devices only once.

import { localDayKey, shiftDay } from '@/shared/day';
import { capIntervals, coalesce, type DeviceDayUsage, unionLengthMs } from '@/shared/intervals';
import { log } from '@/shared/logger';
import {
  clearUsageRecord,
  getDeviceId,
  getSettings,
  getSyncMeta,
  getUsageRecord,
  listDeviceDayUsage,
  pruneOwnUsage,
  putDeviceDayUsage,
  setSyncMeta,
} from '@/shared/storage';
import type { SyncTransport } from '@/shared/sync-transport';

import { REMOTE_PUSH_THROTTLE_MS, USAGE_KEEP_DAYS } from './constants';
import { createRemoteTransport } from './registry';

async function readOwnLocal(day: string, deviceId: string): Promise<DeviceDayUsage> {
  const records = await listDeviceDayUsage('local', day);
  return records.find((r) => r.deviceId === deviceId) ?? { deviceId, day, intervals: [] };
}

// Total time spent on blocked sites today across ALL of the user's devices, as
// the union of every device's intervals. Falls back to local-only if the remote
// read fails (offline / misconfigured), so blocking never breaks on a bad sync.
export async function getSpentTodayMs(now: number): Promise<number> {
  const day = localDayKey(now);
  const local = await listDeviceDayUsage('local', day);

  let remote: DeviceDayUsage[] = [];
  const transport = createRemoteTransport((await getSettings()).sync);
  if (transport) {
    try {
      remote = await transport.listForDay(day);
    } catch (e) {
      log.warn('sync read failed; using local usage only:', e);
    }
  }

  return unionLengthMs([...local, ...remote].flatMap((r) => r.intervals));
}

// Record a tick of real elapsed time: append [now-deltaMs, now] to this device's
// LOCAL record, normalize, cap, prune old days, then push to the remote
// (throttled). Mirrors the old addSpentMs entry point.
export async function recordUsage(now: number, deltaMs: number): Promise<void> {
  if (deltaMs <= 0) return;
  const deviceId = await getDeviceId();
  const day = localDayKey(now);

  const own = await readOwnLocal(day, deviceId);
  const intervals = capIntervals(coalesce([...own.intervals, { start: now - deltaMs, end: now }]));
  await putDeviceDayUsage('local', { deviceId, day, intervals });
  await pruneOwnUsage('local', deviceId, shiftDay(day, -USAGE_KEEP_DAYS));

  await pushRemote(now, false);
}

// Push this device's local record to the remote transport. Throttled to
// REMOTE_PUSH_THROTTLE_MS unless `force` (the gate alarm forces a backstop
// push). No-op when sync is off or the transport read of own record is empty.
export async function pushRemote(now: number, force: boolean): Promise<void> {
  const transport = createRemoteTransport((await getSettings()).sync);
  if (!transport) return;

  const meta = await getSyncMeta();
  if (!force && now - meta.lastPushAt < REMOTE_PUSH_THROTTLE_MS) return;

  const deviceId = await getDeviceId();
  const own = await readOwnLocal(localDayKey(now), deviceId);
  await transport.putOwn(own);
  await setSyncMeta({ lastPushAt: now });
}

// The active remote transport, for the background to subscribe to remote
// changes (browser sync fires events; HTTP relies on the gate alarm instead).
export async function getRemoteTransport(): Promise<SyncTransport | null> {
  return createRemoteTransport((await getSettings()).sync);
}

// One-time migration from the legacy scalar UsageRecord {day, ms} to the
// interval model: seed today's own-device LOCAL record with a single interval of
// the old length (union of one interval = its length = old ms), then clear the
// legacy key. Idempotent via the syncMeta flag.
export async function migrateLegacyUsage(now: number): Promise<void> {
  const meta = await getSyncMeta();
  if (meta.migratedUsage) return;

  const legacy = await getUsageRecord();
  const today = localDayKey(now);
  if (legacy.day === today && legacy.ms > 0) {
    const deviceId = await getDeviceId();
    const own = await readOwnLocal(today, deviceId);
    const intervals = capIntervals(
      coalesce([...own.intervals, { start: now - legacy.ms, end: now }]),
    );
    await putDeviceDayUsage('local', { deviceId, day: today, intervals });
  }

  await clearUsageRecord();
  await setSyncMeta({ migratedUsage: true });
}
