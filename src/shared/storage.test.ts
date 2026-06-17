import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import {
  clearProviderState,
  getProviderState,
  getSettings,
  onProviderStateChange,
  onSettingsChange,
  setProviderState,
  setSettings,
} from './storage';
import { DEFAULT_SETTINGS, DEFAULT_SYNC } from './types';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getSettings', () => {
  it('returns DEFAULT_SETTINGS when nothing is stored yet', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('setSettings', () => {
  it('merges a partial update onto the current value', async () => {
    await setSettings({ refreshIntervalMin: 15, verboseLogging: true });
    const result = await getSettings();
    expect(result.refreshIntervalMin).toBe(15);
    expect(result.verboseLogging).toBe(true);
    // Untouched fields retain their defaults.
    expect(result.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('two partial updates compose without clobbering earlier fields', async () => {
    await setSettings({ refreshIntervalMin: 1 });
    await setSettings({ debugOverlay: true });
    const result = await getSettings();
    expect(result.refreshIntervalMin).toBe(1);
    expect(result.debugOverlay).toBe(true);
  });

  it('concurrent partial updates do not clobber each other (lost-update guard)', async () => {
    // Fire both WITHOUT awaiting the first — the options Sync section does
    // exactly this (Generate + a field blur). A naive read-modify-write loses
    // one update; the serialized writer must keep both.
    const a = setSettings({ refreshIntervalMin: 15 });
    const b = setSettings({ sync: { ...DEFAULT_SYNC, mode: 'supabase', syncId: 'abc' } });
    await Promise.all([a, b]);
    const result = await getSettings();
    expect(result.refreshIntervalMin).toBe(15);
    expect(result.sync.syncId).toBe('abc');
    expect(result.sync.mode).toBe('supabase');
  });
});

describe('provider state', () => {
  it('returns the empty fallback before anything is stored', async () => {
    expect(await getProviderState('ticktick')).toEqual({});
  });

  it('round-trips tokens and a last-sync timestamp', async () => {
    await setProviderState('ticktick', {
      tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1000 },
      lastSyncAt: 999,
    });
    const state = await getProviderState('ticktick');
    expect(state.tokens?.accessToken).toBe('a');
    expect(state.lastSyncAt).toBe(999);
  });

  it('clearProviderState removes the stored value', async () => {
    await setProviderState('ticktick', {
      tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1000 },
    });
    await clearProviderState('ticktick');
    expect(await getProviderState('ticktick')).toEqual({});
  });

  it('concurrent partial updates to the same provider do not clobber (lost-update guard)', async () => {
    const a = setProviderState('ticktick', { lastSyncAt: 123 });
    const b = setProviderState('ticktick', { activeListId: 'list-1' });
    await Promise.all([a, b]);
    const state = await getProviderState('ticktick');
    expect(state.lastSyncAt).toBe(123);
    expect(state.activeListId).toBe('list-1');
  });
});

describe('watchers', () => {
  it('onSettingsChange fires with new + previous values', async () => {
    const fired: Array<{ next: unknown; prev: unknown }> = [];
    const unsubscribe = onSettingsChange((next, prev) => fired.push({ next, prev }));
    await setSettings({ refreshIntervalMin: 15 });
    unsubscribe();
    expect(fired).toHaveLength(1);
    expect((fired[0]!.next as { refreshIntervalMin: number }).refreshIntervalMin).toBe(15);
  });

  it('onProviderStateChange fires only for the matching provider', async () => {
    let calls = 0;
    const unsubscribe = onProviderStateChange('ticktick', () => calls++);
    await setProviderState('ticktick', { lastSyncAt: 42 });
    unsubscribe();
    expect(calls).toBe(1);
  });
});
