// Typed wrapper over `browser.storage.local` using WXT's storage helper.
//
// Public API:
//   getSettings()                        -> Settings
//   setSettings(partial)                 -> void   (merges into current)
//   getProviderState(id)                 -> ProviderState | undefined
//   setProviderState(id, state)          -> void
//   onSettingsChange(cb)                 -> unsubscribe
//   onProviderStateChange(id, cb)        -> unsubscribe
//
// Why a wrapper instead of using `storage.defineItem` directly at call
// sites: callers shouldn't know about the storage key namespace, the
// fallback values, or the migration shape. Centralizing makes it trivial
// to evolve the schema later without grepping the codebase.

import { storage, type StorageItemKey, type WxtStorageItem } from 'wxt/utils/storage';
import type { DeviceDayUsage } from './intervals';
import {
  DEFAULT_SETTINGS,
  type GateId,
  type GateState,
  type ProviderId,
  type ProviderState,
  type Settings,
} from './types';

const settingsItem: WxtStorageItem<
  Settings,
  Record<string, unknown>
> = storage.defineItem<Settings>('local:todotube:settings', { fallback: DEFAULT_SETTINGS });

// One storage item per provider so changes to one provider don't trigger
// watchers on others.
const providerItems = new Map<ProviderId, WxtStorageItem<ProviderState, Record<string, unknown>>>();

function providerItem(id: ProviderId) {
  let item = providerItems.get(id);
  if (!item) {
    item = storage.defineItem<ProviderState>(`local:todotube:provider:${id}`, { fallback: {} });
    providerItems.set(id, item);
  }
  return item;
}

export async function getSettings(): Promise<Settings> {
  return settingsItem.getValue();
}

export async function setSettings(partial: Partial<Settings>): Promise<void> {
  const current = await settingsItem.getValue();
  await settingsItem.setValue({ ...current, ...partial });
}

export async function getProviderState(id: ProviderId): Promise<ProviderState> {
  return providerItem(id).getValue();
}

export async function setProviderState(
  id: ProviderId,
  state: Partial<ProviderState>,
): Promise<void> {
  const item = providerItem(id);
  const current = await item.getValue();
  await item.setValue({ ...current, ...state });
}

export async function clearProviderState(id: ProviderId): Promise<void> {
  await providerItem(id).removeValue();
}

export function onSettingsChange(cb: (next: Settings, prev: Settings | null) => void): () => void {
  return settingsItem.watch((next, prev) => cb(next, prev));
}

export function onProviderStateChange(
  id: ProviderId,
  cb: (next: ProviderState, prev: ProviderState | null) => void,
): () => void {
  return providerItem(id).watch((next, prev) => cb(next, prev));
}

// --- Gating runtime state -------------------------------------------------
//
// Per-gate persisted state (e.g. an unlock expiry). One storage item per
// gate, mirroring providerItem, so a change to one gate doesn't wake
// watchers on others.

const gateItems = new Map<GateId, WxtStorageItem<GateState, Record<string, unknown>>>();

function gateItem(id: GateId) {
  let item = gateItems.get(id);
  if (!item) {
    item = storage.defineItem<GateState>(`local:todotube:gate:${id}`, { fallback: {} });
    gateItems.set(id, item);
  }
  return item;
}

export async function getGateState(id: GateId): Promise<GateState> {
  return gateItem(id).getValue();
}

// Replaces the gate's state wholesale — gate state is small and the gate
// always computes its complete next state, so a merge would only risk
// leaving stale keys behind.
export async function setGateState(id: GateId, state: GateState): Promise<void> {
  await gateItem(id).setValue(state);
}

export async function clearGateState(id: GateId): Promise<void> {
  await gateItem(id).removeValue();
}

// --- Legacy usage record (migration only) ---------------------------------
//
// The pre-sync debit side: a single scalar { day, ms } of time spent today.
// Superseded by the per-device interval records below; kept only so
// `migrateLegacyUsage` (core/sync) can read and clear it once on upgrade.

export interface UsageRecord {
  // Local-day key, "YYYY-MM-DD". Empty string = never recorded.
  day: string;
  ms: number;
}

const usageItem: WxtStorageItem<
  UsageRecord,
  Record<string, unknown>
> = storage.defineItem<UsageRecord>('local:todotube:usage', { fallback: { day: '', ms: 0 } });

export async function getUsageRecord(): Promise<UsageRecord> {
  return usageItem.getValue();
}

export async function clearUsageRecord(): Promise<void> {
  await usageItem.removeValue();
}

// --- Device identity ------------------------------------------------------
//
// A stable per-device id, generated once and never synced (each device keeps
// its own). It partitions the synced usage records below so a device only ever
// writes its own key — see [[project-todotube-gating]] and docs/SYNC.md.

const deviceIdItem: WxtStorageItem<string, Record<string, unknown>> = storage.defineItem<string>(
  'local:todotube:deviceId',
  { fallback: '' },
);

export async function getDeviceId(): Promise<string> {
  const existing = await deviceIdItem.getValue();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await deviceIdItem.setValue(id);
  return id;
}

// --- Synced multi-device usage (interval records) -------------------------
//
// Per-(device, day) interval records — the synced "spent" ledger. Stored in
// the chosen storage AREA: 'sync' (browser sync; same-browser desktop only) or
// 'local' (this device only, when sync is off). Keys are dynamic per device+day
// so listing uses a raw area snapshot + prefix filter rather than defineItem.
//
// Centralised here so the key FORMAT is single-sourced (the "no magic
// constants" rule); the transport adapters in core/sync orchestrate which area
// to use and when to push. Day strings are "YYYY-MM-DD", which sort
// lexicographically = chronologically (used by pruning below).

export type UsageArea = 'local' | 'sync';

const USAGE_KEY_PREFIX = 'todotube:usage:';

function usageKey(area: UsageArea, deviceId: string, day: string): StorageItemKey {
  return `${area}:${USAGE_KEY_PREFIX}${deviceId}:${day}`;
}

// Parse the deviceId/day out of a bare snapshot key (area prefix already
// stripped by `storage.snapshot`). Returns null for non-usage keys.
function parseUsageKey(bareKey: string): { deviceId: string; day: string } | null {
  const m = /^todotube:usage:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(bareKey);
  return m ? { deviceId: m[1]!, day: m[2]! } : null;
}

export async function putDeviceDayUsage(area: UsageArea, rec: DeviceDayUsage): Promise<void> {
  await storage.setItem<DeviceDayUsage>(usageKey(area, rec.deviceId, rec.day), rec);
}

// Every device's record for a given day, across the chosen area.
export async function listDeviceDayUsage(area: UsageArea, day: string): Promise<DeviceDayUsage[]> {
  const snap = await storage.snapshot(area);
  const out: DeviceDayUsage[] = [];
  for (const [key, value] of Object.entries(snap)) {
    const parsed = parseUsageKey(key);
    if (parsed && parsed.day === day && value) out.push(value as DeviceDayUsage);
  }
  return out;
}

// Drop this device's own records whose day is strictly before `oldestDay`,
// keeping the synced area from accumulating stale days. A device only prunes
// its own keys (it never touches another device's record).
export async function pruneOwnUsage(
  area: UsageArea,
  deviceId: string,
  oldestDay: string,
): Promise<void> {
  const snap = await storage.snapshot(area);
  const stale: StorageItemKey[] = [];
  for (const key of Object.keys(snap)) {
    const parsed = parseUsageKey(key);
    if (parsed && parsed.deviceId === deviceId && parsed.day < oldestDay) {
      stale.push(`${area}:${key}`);
    }
  }
  if (stale.length) await storage.removeItems(stale);
}

// --- Sync orchestration meta ----------------------------------------------
//
// Small local-only bookkeeping for core/sync: the throttle watermark for remote
// pushes (so it survives MV3 service-worker restarts) and the one-time
// legacy-usage migration flag. Never synced.

export interface SyncMeta {
  // Epoch ms of the last remote push (push throttle).
  lastPushAt: number;
  // Legacy scalar UsageRecord → interval model migration done.
  migratedUsage: boolean;
}

const syncMetaItem: WxtStorageItem<
  SyncMeta,
  Record<string, unknown>
> = storage.defineItem<SyncMeta>('local:todotube:syncMeta', {
  fallback: { lastPushAt: 0, migratedUsage: false },
});

export async function getSyncMeta(): Promise<SyncMeta> {
  return syncMetaItem.getValue();
}

export async function setSyncMeta(partial: Partial<SyncMeta>): Promise<void> {
  const current = await syncMetaItem.getValue();
  await syncMetaItem.setValue({ ...current, ...partial });
}
