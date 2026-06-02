// Background entrypoint. MV3 service workers can be killed and restarted
// by the browser at any time — anything we do here must be idempotent
// and pick up its state from persistent storage on every wake.

import {
  broadcastToBlockedTabs,
  enrichWithTasks,
  registerHandlers,
  runRefresh,
} from '@/core/background/handlers';
import { onRefreshAlarm, scheduleRefresh } from '@/core/background/refresh';
import { evaluateGate, onGateAlarm, scheduleGateAlarm } from '@/core/gatekeeper/gatekeeper';
import { getRemoteTransport, migrateLegacyUsage, pushRemote } from '@/core/sync';
import { log, setVerbose } from '@/shared/logger';
import { PROVIDER_IDS } from '@/shared/providers';
import { getSettings, onProviderStateChange, onSettingsChange } from '@/shared/storage';
import type { SyncSettings } from '@/shared/types';

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

  // One-time migration of the legacy scalar usage record into the per-device
  // interval model used by the sync layer.
  await migrateLegacyUsage(Date.now());

  // Gating: a 1-minute backstop that re-evaluates the active gate and
  // pushes the decision to all blocked-site tabs, so an expired session
  // eventually re-blocks even without a tab-local timer. It also force-pushes
  // this device's usage to the sync backend (covering the push throttle).
  await scheduleGateAlarm();
  onGateAlarm(() => {
    void pushRemote(Date.now(), true);
    void broadcastGateState();
  });

  // Re-evaluate promptly when ANOTHER device updates the shared budget. Browser
  // sync fires storage change events; an HTTP backend has no push, so it relies
  // on the gate alarm above to re-read. Re-subscribed when the sync mode changes.
  await resubscribeRemote();

  onSettingsChange((next, prev) => {
    setVerbose(next.verboseLogging);

    if (prev && next.refreshIntervalMin !== prev.refreshIntervalMin) {
      void scheduleRefresh(next);
    }

    if (syncChanged(prev?.sync, next.sync)) void resubscribeRemote();

    // Always broadcast — content scripts re-render off this signal.
    void broadcastToBlockedTabs({ type: 'SETTINGS_CHANGED', settings: next });
    // Gating config lives in settings too; refresh gate decisions.
    void broadcastGateState();
  });

  // Provider-state changes (especially activeListId set from the
  // options page) need their own signal — they don't live in `settings`.
  for (const providerId of PROVIDER_IDS) {
    onProviderStateChange(providerId, (next, prev) => {
      const nextList = next.activeListId;
      if (!nextList) return;
      if (prev && prev.activeListId === nextList) return;
      void broadcastToBlockedTabs({
        type: 'LIST_CHANGED',
        providerId,
        listId: nextList,
      });
    });
  }
}

async function broadcastGateState(): Promise<void> {
  await broadcastToBlockedTabs({
    type: 'GATE_CHANGED',
    result: await enrichWithTasks(await evaluateGate()),
  });
}

// Subscription to remote sync changes, rebuilt whenever the sync mode changes.
let unsubscribeRemote: (() => void) | null = null;

async function resubscribeRemote(): Promise<void> {
  unsubscribeRemote?.();
  unsubscribeRemote = null;
  const transport = await getRemoteTransport();
  if (transport?.onRemoteChange) {
    unsubscribeRemote = transport.onRemoteChange(() => void broadcastGateState());
  }
}

function syncChanged(prev: SyncSettings | undefined, next: SyncSettings): boolean {
  return !prev || JSON.stringify(prev) !== JSON.stringify(next);
}
