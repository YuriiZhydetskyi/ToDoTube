// Dispatcher for the typed message bus. Every Schema entry from
// shared/messaging.ts is handled here.
//
// Background is the single source of truth for the active provider and
// any per-provider state (tokens, last sync, active list). Popup and
// options never read provider state from storage directly — they query
// here so we have one place to evolve the schema.

import { browser } from 'wxt/browser';

import { evaluateGate, notifyTaskCompleted } from '@/core/gatekeeper/gatekeeper';
import { addYoutubeUsageMs } from '@/core/gatekeeper/usage';
import { METRIC_CATALOG, type MetricId } from '@/gates/activity-budget/constants';
import { getProviderOrNull } from '@/providers/registry';
import type { Provider } from '@/providers/types';
import { getSignalOrNull } from '@/signals/registry';
import { log } from '@/shared/logger';
import { err, ok, type Broadcast, type MessageType, type Request } from '@/shared/messaging';
import { getProviderDescriptor } from '@/shared/providers';
import type { Result } from '@/shared/result';
import { getProviderState, getSettings, setProviderState, setSettings } from '@/shared/storage';
import { sortTasks } from '@/shared/tasks';
import {
  ANKI_STUDY_SIGNAL_ID,
  HTTP_SIGNAL_ID,
  type ListId,
  type ProviderId,
  type Task,
} from '@/shared/types';

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
      return listTasksForUi(provider, req.listId);
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
      // Completing a task may satisfy the active gate — forward the event
      // and broadcast the (possibly unlocked) decision to all YouTube tabs.
      const gate = await notifyTaskCompleted(req.providerId, req.taskId);
      void broadcastToYouTubeTabs({ type: 'GATE_CHANGED', result: gate });
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
      const r = await listTasksForUi(provider, req.listId);
      if (!r.ok) return err(r.error);
      void broadcastToYouTubeTabs({
        type: 'TASKS_UPDATED',
        providerId: req.providerId,
        listId: req.listId,
        tasks: r.value,
      });
      return ok(r.value);
    }

    case 'GATE_EVAL':
      return ok(await evaluateGate());

    case 'YOUTUBE_TICK': {
      // Accrue watch time; re-blocking on budget exhaustion is handled by
      // the 1-minute gate alarm, so we don't re-evaluate on every tick.
      await addYoutubeUsageMs(Date.now(), req.deltaMs);
      return ok(null);
    }

    case 'ANKI_TEST': {
      const signal = getSignalOrNull(ANKI_STUDY_SIGNAL_ID);
      if (!signal) return err('Anki signal unavailable');
      const r = await signal.read();
      if (!r.ok) return err(r.error);
      return ok({ studyMinutesToday: Math.round(r.value.value / 60_000) });
    }

    case 'HTTP_SIGNAL_TEST': {
      const metric = METRIC_CATALOG[req.metric as MetricId];
      if (!metric) return err(`Unknown metric: ${req.metric}`);
      const signal = getSignalOrNull(HTTP_SIGNAL_ID);
      if (!signal) return err('HTTP signal unavailable');
      const r = await signal.read({
        url: req.url,
        jsonPath: metric.jsonPath,
        kind: metric.kind,
        scale: metric.scale,
      });
      if (!r.ok) return err(r.error);
      // SignalValue is canonical (ms for durationMs); show it in the metric's
      // display unit (minutes / plain count).
      const display = metric.kind === 'durationMs' ? r.value.value / 60_000 : r.value.value;
      return ok({ value: Math.round(display), unit: metric.effortUnit });
    }

    default:
      return err(`Unhandled message: ${(req as { type: string }).type}`);
  }
}

/**
 * Fetch a list and apply the user's display preferences in one place, so
 * the on-demand fetch (LIST_TASKS), the manual refresh (REFRESH_NOW), and
 * the alarm tick (runRefresh) all return identically shaped data. The
 * provider returns the raw list; we sort by `sortBy` then cap to
 * `maxItems`. Sorting happens before the cap so the user's chosen order
 * decides which items survive the cut.
 */
export async function listTasksForUi(
  provider: Provider,
  listId: ListId,
): Promise<Result<Task[], string>> {
  const settings = await getSettings();
  const r = await provider.listTasks(listId, { includeCompleted: settings.showCompleted });
  if (!r.ok) return err(r.error);
  const sorted = sortTasks(r.value, settings.sortBy);
  return ok(settings.maxItems > 0 ? sorted.slice(0, settings.maxItems) : sorted);
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

  const r = await listTasksForUi(provider, listId);
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
  'GATE_EVAL',
  'YOUTUBE_TICK',
  'ANKI_TEST',
  'HTTP_SIGNAL_TEST',
];

function isRequest(v: unknown): v is Request {
  if (typeof v !== 'object' || v === null || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return typeof t === 'string' && (KNOWN_TYPES as readonly string[]).includes(t);
}
