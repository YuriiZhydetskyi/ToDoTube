// SyncTransport over a browser storage AREA. Used for `mode: 'browser'`
// (area `'sync'`): the browser's own account sync replicates the records
// between same-browser DESKTOP installs. NOTE: storage.sync does not sync on
// Firefox Android (it is local-only there) — see docs/SYNC.md — so this reaches
// other desktops only; the phone needs an HTTP transport.
//
// Each device writes only its own (deviceId, day) slot, so there are no write
// conflicts even though storage.sync is last-write-wins per key.

import { browser } from 'wxt/browser';

import { shiftDay } from '@/shared/day';
import type { DeviceDayUsage } from '@/shared/intervals';
import {
  listDeviceDayUsage,
  pruneOwnUsage,
  putDeviceDayUsage,
  type UsageArea,
} from '@/shared/storage';
import type { SyncTransport } from '@/shared/sync-transport';

import { USAGE_KEEP_DAYS } from './constants';

export function createBrowserStorageTransport(area: UsageArea): SyncTransport {
  return {
    async putOwn(rec: DeviceDayUsage): Promise<void> {
      await putDeviceDayUsage(area, rec);
      await pruneOwnUsage(area, rec.deviceId, shiftDay(rec.day, -USAGE_KEEP_DAYS));
    },

    listForDay(day: string): Promise<DeviceDayUsage[]> {
      return listDeviceDayUsage(area, day);
    },

    onRemoteChange(cb: () => void): () => void {
      const listener = (_changes: unknown, areaName: string): void => {
        if (areaName === area) cb();
      };
      browser.storage.onChanged.addListener(listener);
      return () => browser.storage.onChanged.removeListener(listener);
    },
  };
}
