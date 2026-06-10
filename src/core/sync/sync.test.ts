import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { storage } from 'wxt/utils/storage';

import { localDayKey } from '@/shared/day';
import { putDeviceDayUsage, setSettings } from '@/shared/storage';
import type { SyncSettings } from '@/shared/types';

import { getSpentTodayMs, migrateLegacyUsage, recordUsage } from './index';

const NOW = new Date(2026, 4, 29, 20, 0, 0).getTime();
const DAY = localDayKey(NOW);
const MIN = 60_000;

const browserSync: SyncSettings = { mode: 'browser', syncId: '', config: {} };

beforeEach(() => {
  fakeBrowser.reset();
});

describe('cross-device union (browser sync)', () => {
  it('counts simultaneous watching on two devices only once', async () => {
    await setSettings({ sync: browserSync });
    // Another device watched 10–5 min ago; we watch the last 10 min — overlap.
    await putDeviceDayUsage('sync', {
      deviceId: 'other',
      day: DAY,
      intervals: [{ start: NOW - 10 * MIN, end: NOW - 5 * MIN }],
    });
    await recordUsage(NOW, 10 * MIN);
    // local own [NOW-10m, NOW] fully contains other's [NOW-10m, NOW-5m] → 10 min.
    expect(await getSpentTodayMs(NOW)).toBe(10 * MIN);
  });

  it('sums non-overlapping device intervals', async () => {
    await setSettings({ sync: browserSync });
    await putDeviceDayUsage('sync', {
      deviceId: 'other',
      day: DAY,
      intervals: [{ start: NOW - 100 * MIN, end: NOW - 99 * MIN }], // 1 min, long ago
    });
    await recordUsage(NOW, 1 * MIN);
    expect(await getSpentTodayMs(NOW)).toBe(2 * MIN);
  });

  it('falls back to local-only when the remote read throws', async () => {
    // supabase mode with no config → http transport read rejects; getSpentTodayMs
    // must still return this device's local total rather than throwing.
    await setSettings({ sync: { mode: 'supabase', syncId: 's', config: {} } });
    await recordUsage(NOW, 3 * MIN);
    expect(await getSpentTodayMs(NOW)).toBe(3 * MIN);
  });
});

describe('migrateLegacyUsage', () => {
  it('seeds today as one interval of the old length, then clears the legacy key', async () => {
    await storage.setItem('local:todotube:usage', { day: DAY, ms: 90_000 });
    await migrateLegacyUsage(NOW);
    expect(await getSpentTodayMs(NOW)).toBe(90_000);
    expect(await storage.getItem('local:todotube:usage')).toBeNull();
  });

  it('is idempotent and ignores a stale legacy day', async () => {
    await storage.setItem('local:todotube:usage', { day: '2020-01-01', ms: 90_000 });
    await migrateLegacyUsage(NOW);
    expect(await getSpentTodayMs(NOW)).toBe(0); // stale day not carried over
    // Running again does nothing even if a new legacy record appears.
    await storage.setItem('local:todotube:usage', { day: DAY, ms: 50_000 });
    await migrateLegacyUsage(NOW);
    expect(await getSpentTodayMs(NOW)).toBe(0);
  });
});
