// Background entrypoint. MV3 service workers can be killed and restarted
// by the browser at any time — anything we do here must be idempotent
// and pick up its state from persistent storage on every wake.

import { broadcastToYouTubeTabs, registerHandlers, runRefresh } from '@/core/background/handlers';
import { onRefreshAlarm, scheduleRefresh } from '@/core/background/refresh';
import { log, setVerbose } from '@/shared/logger';
import { PROVIDER_IDS } from '@/shared/providers';
import { getSettings, onProviderStateChange, onSettingsChange } from '@/shared/storage';

export default defineBackground(() => {
  void init();
});

async function init(): Promise<void> {
  const settings = await getSettings();
  setVerbose(settings.verboseLogging);
  log.info('Background woke');

  registerHandlers();

  await scheduleRefresh(settings);
  onRefreshAlarm(() => runRefresh());

  onSettingsChange((next, prev) => {
    setVerbose(next.verboseLogging);

    if (prev && next.refreshIntervalMin !== prev.refreshIntervalMin) {
      void scheduleRefresh(next);
    }

    // Always broadcast — content scripts re-render off this signal.
    void broadcastToYouTubeTabs({ type: 'SETTINGS_CHANGED', settings: next });
  });

  // Provider-state changes (especially activeListId set from the
  // options page) need their own signal — they don't live in `settings`.
  for (const providerId of PROVIDER_IDS) {
    onProviderStateChange(providerId, (next, prev) => {
      const nextList = next.activeListId;
      if (!nextList) return;
      if (prev && prev.activeListId === nextList) return;
      void broadcastToYouTubeTabs({
        type: 'LIST_CHANGED',
        providerId,
        listId: nextList,
      });
    });
  }
}
