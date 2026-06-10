import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import { listDeviceDayUsage, putDeviceDayUsage } from '@/shared/storage';

import { createBrowserStorageTransport } from './browser-storage-transport';

const DAY = '2026-05-29';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('browser storage transport (sync area)', () => {
  it("lists every device's record for a day", async () => {
    const t = createBrowserStorageTransport('sync');
    await t.putOwn({ deviceId: 'A', day: DAY, intervals: [{ start: 0, end: 10 }] });
    // Another device's record arriving via browser sync.
    await putDeviceDayUsage('sync', {
      deviceId: 'B',
      day: DAY,
      intervals: [{ start: 5, end: 20 }],
    });

    const recs = await t.listForDay(DAY);
    expect(recs.map((r) => r.deviceId).sort()).toEqual(['A', 'B']);
  });

  it('does not return records from other days', async () => {
    const t = createBrowserStorageTransport('sync');
    await t.putOwn({ deviceId: 'A', day: '2026-05-28', intervals: [{ start: 0, end: 10 }] });
    expect(await t.listForDay(DAY)).toEqual([]);
  });

  it("prunes the own device's stale days on write", async () => {
    const t = createBrowserStorageTransport('sync');
    await putDeviceDayUsage('sync', {
      deviceId: 'A',
      day: '2026-05-01',
      intervals: [{ start: 0, end: 1 }],
    });
    await t.putOwn({ deviceId: 'A', day: DAY, intervals: [{ start: 0, end: 10 }] });

    expect(await listDeviceDayUsage('sync', '2026-05-01')).toEqual([]);
    expect((await t.listForDay(DAY)).length).toBe(1);
  });

  it('only prunes its OWN device, never another device', async () => {
    const t = createBrowserStorageTransport('sync');
    await putDeviceDayUsage('sync', {
      deviceId: 'B',
      day: '2026-05-01',
      intervals: [{ start: 0, end: 1 }],
    });
    await t.putOwn({ deviceId: 'A', day: DAY, intervals: [{ start: 0, end: 10 }] });
    // B's old record is untouched (each device owns its own pruning).
    expect((await listDeviceDayUsage('sync', '2026-05-01')).map((r) => r.deviceId)).toEqual(['B']);
  });

  it('fires onRemoteChange when the sync area changes', async () => {
    const t = createBrowserStorageTransport('sync');
    let fired = 0;
    const unsub = t.onRemoteChange!(() => {
      fired += 1;
    });
    await putDeviceDayUsage('sync', { deviceId: 'B', day: DAY, intervals: [{ start: 0, end: 1 }] });
    unsub();
    expect(fired).toBeGreaterThan(0);
  });
});
