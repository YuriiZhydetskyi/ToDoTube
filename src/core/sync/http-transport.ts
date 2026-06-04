// SyncTransport over a user-supplied HTTP backend. This is the ONLY transport
// that reaches Firefox Android (browser sync does not — see docs/SYNC.md).
//
// One small wire protocol, two flavors that map onto it:
//   - 'supabase'  : PostgREST on a table `usage(sync_id, device_id, day,
//                   intervals jsonb)`; read via filters, write via upsert.
//   - 'cloudflare': the template Worker in backends/cloudflare/.
//
// Rows are scoped by a shared-secret `syncId` (groups a user's devices, isolates
// them from others) and partitioned by `deviceId`. Auth is the project anon key
// (Supabase) or a bearer secret (Cloudflare). No onRemoteChange — the 1-minute
// gate alarm re-reads, which is how other devices' updates surface.

import { log } from '@/shared/logger';
import type { DeviceDayUsage, Interval } from '@/shared/intervals';
import type { SyncTransport } from '@/shared/sync-transport';
import type { SyncSettings } from '@/shared/types';

export type HttpFlavor = 'supabase' | 'cloudflare';

interface HttpConfig {
  url: string;
  key: string;
  syncId: string;
}

function readConfig(flavor: HttpFlavor, sync: SyncSettings): HttpConfig {
  const cfg = (sync.config[flavor] ?? {}) as Record<string, unknown>;
  return {
    url: String(cfg.url ?? '').replace(/\/+$/, ''),
    key: String((flavor === 'supabase' ? cfg.apiKey : cfg.secret) ?? ''),
    syncId: sync.syncId,
  };
}

// Coerce a raw `intervals` field into normalised Interval[], dropping any entry
// that isn't a {start:number,end:number} pair. A non-array yields [] (callers
// guard the row-level Array.isArray separately, see toRecord).
function toIntervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const iv of raw) {
    if (!iv || typeof iv !== 'object') continue;
    const { start, end } = iv as Record<string, unknown>;
    if (typeof start === 'number' && typeof end === 'number') out.push({ start, end });
  }
  return out;
}

// Defensively coerce a backend row into a DeviceDayUsage. Tolerates either the
// camelCase wire shape (Cloudflare) or the snake_case column shape (Supabase).
// A row whose `intervals` isn't an array is rejected wholesale (not coerced to
// an empty list), preserving the original drop-the-row semantics.
function toRecord(row: unknown): DeviceDayUsage | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const deviceId = r.deviceId ?? r.device_id;
  const day = r.day;
  if (typeof deviceId !== 'string' || typeof day !== 'string' || !Array.isArray(r.intervals)) {
    return null;
  }
  return { deviceId, day, intervals: toIntervals(r.intervals) };
}

export function createHttpTransport(flavor: HttpFlavor, sync: SyncSettings): SyncTransport {
  const { url, key, syncId } = readConfig(flavor, sync);
  const configured = Boolean(url && key && syncId);

  async function listForDay(day: string): Promise<DeviceDayUsage[]> {
    if (!configured) return [];
    const res =
      flavor === 'supabase'
        ? await fetch(
            `${url}/rest/v1/usage?select=device_id,day,intervals` +
              `&sync_id=eq.${encodeURIComponent(syncId)}&day=eq.${encodeURIComponent(day)}`,
            {
              headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
            },
          )
        : await fetch(
            `${url}/usage?sync_id=${encodeURIComponent(syncId)}&day=${encodeURIComponent(day)}`,
            { headers: { Authorization: `Bearer ${key}` } },
          );
    if (!res.ok) throw new Error(`sync read failed: ${res.status}`);
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(toRecord).filter((r): r is DeviceDayUsage => r !== null);
  }

  async function putOwn(rec: DeviceDayUsage): Promise<void> {
    if (!configured) return;
    if (flavor === 'supabase') {
      const res = await fetch(`${url}/rest/v1/usage`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          sync_id: syncId,
          device_id: rec.deviceId,
          day: rec.day,
          intervals: rec.intervals,
        }),
      });
      if (!res.ok) throw new Error(`sync write failed: ${res.status}`);
      return;
    }
    const res = await fetch(`${url}/usage`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncId,
        deviceId: rec.deviceId,
        day: rec.day,
        intervals: rec.intervals,
      }),
    });
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
