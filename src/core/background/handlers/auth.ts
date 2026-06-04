// Provider authentication handlers: connect, disconnect, and status.

import { getProviderOrNull } from '@/providers/registry';
import { err, ok } from '@/shared/messaging';
import { getSettings, setSettings } from '@/shared/storage';

import { broadcastToBlockedTabs } from '../broadcast';
import { invalidateTaskCache } from '../task-cache';
import type { HandlerMap } from './shared';

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
