// Background entrypoint. MV3 service workers can be killed and restarted
// by the browser at any time — anything we do here must be idempotent
// and pick up its state from persistent storage on every wake.

import { broadcastToYouTubeTabs, registerHandlers } from '@/core/background/handlers';
import { onRefreshAlarm, scheduleRefresh } from '@/core/background/refresh';
import { log, setVerbose } from '@/shared/logger';
import { getSettings, onSettingsChange } from '@/shared/storage';

export default defineBackground(() => {
  void init();
});

async function init(): Promise<void> {
  const settings = await getSettings();
  setVerbose(settings.verboseLogging);
  log.info('Background woke');

  registerHandlers();

  await scheduleRefresh(settings);
  onRefreshAlarm(() => {
    // Provider-driven refresh lands in Step 7.
    log.debug('Refresh tick (provider not wired yet)');
  });

  onSettingsChange((next, prev) => {
    setVerbose(next.verboseLogging);

    if (prev && next.refreshIntervalMin !== prev.refreshIntervalMin) {
      void scheduleRefresh(next);
    }

    // Always broadcast — content scripts re-render off this signal.
    void broadcastToYouTubeTabs({ type: 'SETTINGS_CHANGED', settings: next });
  });
}
