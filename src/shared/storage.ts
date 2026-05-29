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

import { storage, type WxtStorageItem } from 'wxt/utils/storage';
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

// --- YouTube usage tracking ----------------------------------------------
//
// Time spent on YouTube "today" (local day), the debit side of ledger-style
// gates. Stored as { day, ms }; readers treat a stale `day` as zero. The
// day-rollover logic lives in core/gatekeeper/usage.ts — this is just the
// typed key.

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

export async function setUsageRecord(record: UsageRecord): Promise<void> {
  await usageItem.setValue(record);
}
