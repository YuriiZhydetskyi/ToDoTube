// Provider authentication handlers: connect, disconnect, and status —
// plus the background-wake wiring for provider auth (OAuth redirect
// capture and the tokens-appeared broadcast).

import { getProviderOrNull } from '@/providers/registry';
import { err, ok } from '@/shared/messaging';
import { PROVIDER_IDS } from '@/shared/providers';
import { getSettings, onProviderStateChange, setSettings } from '@/shared/storage';

import { broadcastToBlockedTabs } from '../broadcast';
import { invalidateTaskCache } from '../task-cache';
import type { HandlerMap } from './shared';

/**
 * Let each provider register its background-lifetime listeners (e.g. the
 * OAuth redirect capture). MUST run synchronously on worker wake, before
 * any await — a listener registered after an await can miss the very
 * event that woke a dead worker.
 */
export function wireProviderAuth(): void {
  for (const id of PROVIDER_IDS) {
    getProviderOrNull(id)?.wireBackground?.();
  }
}

/**
 * Broadcast AUTH_CHANGED when a provider's tokens go absent→present.
 * Watching storage (rather than hooking the AUTH_START handler) also
 * covers OAuth flows whose worker died mid-login: the capture listener
 * persists tokens on a fresh worker, where the original AUTH_START
 * response channel no longer exists. Token refreshes (present→present)
 * and other provider-state writes (activeListId, lastSyncAt) don't fire.
 * Disconnects are NOT mirrored here — AUTH_DISCONNECT already broadcasts
 * AUTH_REQUIRED.
 */
export function wireAuthBroadcasts(): void {
  for (const id of PROVIDER_IDS) {
    onProviderStateChange(id, (next, prev) => {
      if (prev?.tokens || !next.tokens) return;
      void (async () => {
        // Same "first connection becomes the active provider" rule as the
        // AUTH_START handler — needed here too because that handler may
        // have died with its worker. Both sites check-then-set, so the
        // duplicate write is idempotent.
        const settings = await getSettings();
        if (!settings.activeProviderId) {
          await setSettings({ activeProviderId: id });
        }
        await broadcastToBlockedTabs({ type: 'AUTH_CHANGED', providerId: id, authenticated: true });
      })();
    });
  }
}

export const authHandlers = {
  AUTH_STATUS: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    return ok({ authenticated: await provider.isAuthenticated() });
  },

  AUTH_START: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    const r = await provider.authenticate();
    if (!r.ok) return err(r.error);
    // Make this the active provider if no other was set.
    const settings = await getSettings();
    if (!settings.activeProviderId) {
      await setSettings({ activeProviderId: req.providerId });
    }
    return ok(r.value);
  },

  AUTH_DISCONNECT: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    await provider.disconnect();
    // Drop the disconnected account's cached tasks so a quick reconnect
    // can't serve pre-disconnect data.
    invalidateTaskCache();
    const settings = await getSettings();
    if (settings.activeProviderId === req.providerId) {
      await setSettings({ activeProviderId: null });
    }
    void broadcastToBlockedTabs({ type: 'AUTH_REQUIRED', providerId: req.providerId });
    return ok(null);
  },
} satisfies Pick<HandlerMap, 'AUTH_STATUS' | 'AUTH_START' | 'AUTH_DISCONNECT'>;
