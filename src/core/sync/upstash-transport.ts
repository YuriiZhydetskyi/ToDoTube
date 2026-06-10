// SyncTransport over Upstash's Redis REST API. Like the HTTP backends it reaches
// every device including Firefox Android, but it speaks Redis commands over HTTP
// rather than the `/usage` REST protocol — so it gets its own adapter instead of
// being a third flavor of http-transport.ts.
//
// Data model: one Redis HASH per (syncId, day), keyed `todotube:usage:{syncId}:
// {day}`, with one field per device (deviceId -> JSON.stringify(intervals)).
// HSET of one field never clobbers another device's, so the partition-by-device
// invariant holds with no read-modify-write. A read is one HGETALL; a write is
// HSET + EXPIRE (the TTL auto-prunes stale days — the Redis equivalent of the
// other backends' housekeeping). No onRemoteChange — the 1-minute gate alarm
// re-reads, which is how other devices' updates surface (see sync-transport.ts).

import { fetchWithTimeout } from '@/shared/fetch';
import { coerceIntervals, type DeviceDayUsage } from '@/shared/intervals';
import { log } from '@/shared/logger';
import type { SyncTransport } from '@/shared/sync-transport';
import type { SyncSettings } from '@/shared/types';

import { SYNC_FETCH_TIMEOUT_MS, UPSTASH_KEY_TTL_SECONDS } from './constants';

interface UpstashConfig {
  url: string;
  token: string;
  syncId: string;
}

function readConfig(sync: SyncSettings): UpstashConfig {
  const cfg = (sync.config.upstash ?? {}) as Record<string, unknown>;
  return {
    url: String(cfg.url ?? '').replace(/\/+$/, ''),
    token: String(cfg.token ?? ''),
    syncId: sync.syncId,
  };
}

// Unwrap Upstash's `{ result }` / `{ error }` envelope, raising on either a
// transport-level (!ok) or command-level (error) failure.
async function commandResult(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`sync failed: ${body.error}`);
  return body.result;
}

export function createUpstashTransport(sync: SyncSettings): SyncTransport {
  const { url, token, syncId } = readConfig(sync);
  const configured = Boolean(url && token && syncId);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const key = (day: string): string => `todotube:usage:${syncId}:${day}`;

  // HGETALL returns a flat [field, value, field, value, …] array; each value is
  // the JSON we stored. Pair them up, JSON.parsing the intervals and dropping a
  // device whose value is unparseable rather than failing the whole read.
  async function listForDay(day: string): Promise<DeviceDayUsage[]> {
    if (!configured) return [];
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(['HGETALL', key(day)]),
      },
      SYNC_FETCH_TIMEOUT_MS,
    );
    const flat = await commandResult(res);
    if (!Array.isArray(flat)) return [];

    const out: DeviceDayUsage[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const deviceId = flat[i];
      if (typeof deviceId !== 'string' || typeof flat[i + 1] !== 'string') continue;
      try {
        out.push({ deviceId, day, intervals: coerceIntervals(JSON.parse(flat[i + 1] as string)) });
      } catch {
        // Skip a device whose stored value isn't valid JSON.
      }
    }
    return out;
  }

  // Upsert this device's field and refresh the key's TTL in one pipeline.
  async function putOwn(rec: DeviceDayUsage): Promise<void> {
    if (!configured) return;
    const res = await fetchWithTimeout(
      `${url}/pipeline`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify([
          ['HSET', key(rec.day), rec.deviceId, JSON.stringify(rec.intervals)],
          ['EXPIRE', key(rec.day), UPSTASH_KEY_TTL_SECONDS],
        ]),
      },
      SYNC_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`sync write failed: ${res.status}`);
  }

  return {
    putOwn: async (rec) => {
      try {
        await putOwn(rec);
      } catch (e) {
        // A failed push is non-fatal: the local mirror is authoritative for this
        // device, and the next throttled push / gate alarm retries.
        log.warn('sync push failed:', e);
      }
    },
    listForDay,
  };
}
