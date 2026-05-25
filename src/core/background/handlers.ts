// Dispatcher for the typed message bus. Every Schema entry from
// shared/messaging.ts is handled here.
//
// Background is the single source of truth for the active provider and
// any per-provider state (tokens, last sync, active list). Popup and
// options never read provider state from storage directly — they query
// here so we have one place to evolve the schema.

import { browser } from 'wxt/browser';

import { getProviderOrNull } from '@/providers/registry';
import { log } from '@/shared/logger';
import { err, ok, type Broadcast, type MessageType, type Request } from '@/shared/messaging';
import { getProviderDescriptor } from '@/shared/providers';
import { getProviderState, getSettings, setProviderState, setSettings } from '@/shared/storage';
import type { ListId, ProviderId } from '@/shared/types';

import { broadcastToYouTubeTabs } from './broadcast';

type HandlerResult = unknown;

export function registerHandlers(): void {
  browser.runtime.onMessage.addListener((raw, _sender) => {
    if (!isRequest(raw)) return undefined;
    return handle(raw);
  });
}

async function handle(req: Request): Promise<HandlerResult> {
  switch (req.type) {
    case 'GET_STATE': {
      const settings = await getSettings();
      const provider = getProviderOrNull(settings.activeProviderId);
      const authenticated = provider ? await provider.isAuthenticated() : false;
      const activeListId = settings.activeProviderId
        ? ((await getProviderState(settings.activeProviderId)).activeListId ?? null)
        : null;
      return ok({ settings, authenticated, activeListId });
    }

    case 'SET_ENABLED': {
      await setSettings({ enabled: req.enabled });
      return ok(null);
    }

    case 'LIST_PROJECTS': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      return provider.listProjects();
    }

    case 'LIST_TASKS': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      return provider.listTasks(req.listId);
    }

    case 'AUTH_STATUS': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      return ok({ authenticated: await provider.isAuthenticated() });
    }

    case 'COMPLETE_TASK': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      const r = await provider.completeTask(req.projectId, req.taskId);
      if (!r.ok) return err(r.error);
      return ok(null);
    }

    case 'AUTH_START': {
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
    }

    case 'AUTH_DISCONNECT': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      await provider.disconnect();
      const settings = await getSettings();
      if (settings.activeProviderId === req.providerId) {
        await setSettings({ activeProviderId: null });
      }
      void broadcastToYouTubeTabs({ type: 'AUTH_REQUIRED', providerId: req.providerId });
      return ok(null);
    }

    case 'SET_ACTIVE_LIST': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      await setProviderState(req.providerId, { activeListId: req.listId });
      // The storage watcher in `entrypoints/background.ts` will broadcast
      // LIST_CHANGED — we don't need to do it here.
      return ok(null);
    }

    case 'REFRESH_NOW': {
      const provider = getProviderOrNull(req.providerId);
      if (!provider) return err(`Unknown provider: ${req.providerId}`);
      const r = await provider.listTasks(req.listId);
      if (!r.ok) return err(r.error);
      void broadcastToYouTubeTabs({
        type: 'TASKS_UPDATED',
        providerId: req.providerId,
        listId: req.listId,
        tasks: r.value,
      });
      return ok(r.value);
    }

    default:
      return err(`Unhandled message: ${(req as { type: string }).type}`);
  }
}

/**
 * Called from the alarm tick in `entrypoints/background.ts`. Refreshes
 * the active provider's active list and broadcasts to YouTube tabs.
 * Silent on errors — the next tick will retry.
 */
export async function runRefresh(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!settings.activeProviderId) return;
  const provider = getProviderOrNull(settings.activeProviderId);
  if (!provider) return;

  const state = await getProviderState(settings.activeProviderId);
  const listId: ListId =
    state.activeListId ?? getProviderDescriptor(settings.activeProviderId).defaultListId;

  const r = await provider.listTasks(listId);
  if (!r.ok) {
    log.debug('Refresh failed:', r.error);
    return;
  }
  await setProviderState(settings.activeProviderId, { lastSyncAt: Date.now() });
  void broadcastToYouTubeTabs({
    type: 'TASKS_UPDATED',
    providerId: settings.activeProviderId as ProviderId,
    listId,
    tasks: r.value,
  });
}

export { broadcastToYouTubeTabs };
export type { Broadcast };

const KNOWN_TYPES: readonly MessageType[] = [
  'GET_STATE',
  'LIST_PROJECTS',
  'LIST_TASKS',
  'AUTH_STATUS',
  'COMPLETE_TASK',
  'AUTH_START',
  'AUTH_DISCONNECT',
  'REFRESH_NOW',
  'SET_ENABLED',
  'SET_ACTIVE_LIST',
];

function isRequest(v: unknown): v is Request {
  if (typeof v !== 'object' || v === null || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return typeof t === 'string' && (KNOWN_TYPES as readonly string[]).includes(t);
}
