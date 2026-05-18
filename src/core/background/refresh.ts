// browser.alarms-based refresh scheduler. The real task-fetch work lands
// when the provider is wired up; for Step 5 we just create the alarm
// and reconfigure it when the user changes the refresh interval.

import { browser } from 'wxt/browser';

import { log } from '@/shared/logger';
import type { Settings } from '@/shared/types';

const ALARM_NAME = 'todotube:refresh';

export async function scheduleRefresh(settings: Settings): Promise<void> {
  await browser.alarms.clear(ALARM_NAME);
  // `periodInMinutes` must be >= 1 in Chrome MV3.
  const periodInMinutes = Math.max(1, settings.refreshIntervalMin);
  await browser.alarms.create(ALARM_NAME, { periodInMinutes });
  log.info(`Refresh alarm scheduled every ${periodInMinutes} min`);
}

export function onRefreshAlarm(handler: () => void | Promise<void>): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void handler();
  });
}
