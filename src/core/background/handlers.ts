// Dispatcher for the typed message bus. Every Schema entry from
// shared/messaging.ts is handled here.
//
// Background is the single source of truth for the active provider and
// any per-provider state (tokens, last sync, active list). Popup and
// options never read provider state from storage directly — they query
// here so we have one place to evolve the schema.

import { browser } from 'wxt/browser';

import { evaluateGate } from '@/core/gatekeeper/gatekeeper';
import { recordUsage } from '@/core/gatekeeper/usage';
import { getRemoteTransport } from '@/core/sync';
import { localDayKey } from '@/shared/day';
import { METRIC_CATALOG, type MetricId } from '@/gates/activity-budget/constants';
import { getProviderOrNull } from '@/providers/registry';
import type { Provider } from '@/providers/types';
import { getSignalOrNull } from '@/signals/registry';
import { remainingBudgetMs } from '@/shared/budget';
import { log } from '@/shared/logger';
import { err, ok, type Broadcast, type MessageType, type Request } from '@/shared/messaging';
import { getProviderDescriptor } from '@/shared/providers';
import type { Result } from '@/shared/result';
import { getProviderState, getSettings, setProviderState, setSettings } from '@/shared/storage';
import { sortTasks } from '@/shared/tasks';
import {
  ANKI_STUDY_SIGNAL_ID,
  HTTP_SIGNAL_ID,
  TASK_COMPLETE_GATE_ID,
  type GateEvalResult,
  type ListId,
  type ProviderId,
  type Task,
} from '@/shared/types';

import { broadcastToBlockedTabs } from './broadcast';
import { cachedRead, invalidateTaskCache } from './task-cache';

type HandlerResult = unknown;

// Provider list reads are cached this long to stay under TickTick's
// 100-req/min limit. The block screen and the watch panel share the same
// "open tasks" key, so they cost one fan-out between them, not two.
const LIST_TTL_MS = 60_000;

function cachedListTasks(
  provider: Provider,
  listId: ListId,
  includeCompleted: boolean,
): Promise<Result<Task[], string>> {
  const key = `list:${provider.id}:${listId}:${includeCompleted ? 'all' : 'open'}`;
  return cachedRead(key, LIST_TTL_MS, () => provider.listTasks(listId, { includeCompleted }));
}

/**
 * Attaches the active provider's incomplete task list to a blocked
 * task-complete gate result so the block screen can render them inline.
 * No-ops for any other gate or when the decision is already allowed.
 * Swallows errors so a provider failure never breaks the gate overlay.
 */
export async function enrichWithTasks(result: GateEvalResult): Promise<GateEvalResult> {
  if (!result.gating || result.decision.allowed) return result;
  if (result.gateId !== TASK_COMPLETE_GATE_ID) return result;
  try {
    const settings = await getSettings();
    if (!settings.activeProviderId) return result;
    const provider = getProviderOrNull(settings.activeProviderId);
    if (!provider) return result;
    const state = await getProviderState(settings.activeProviderId);
    const listId: ListId =
      state.activeListId ?? getProviderDescriptor(settings.activeProviderId).defaultListId;
    // Shares the cached "open tasks" read with the watch panel; we only show
    // the first few on the block screen.
    const r = await cachedListTasks(provider, listId, false);
    if (!r.ok) return result;
    return {
      ...result,
      decision: {
        ...result.decision,
        requirement: { ...result.decision.requirement, tasks: r.value.slice(0, 10) },
      },
    };
  } catch (e) {
    // Fail soft — a provider hiccup must never break the gate overlay — but
    // don't swallow silently; surface it for debugging.
    log.warn('enrichWithTasks failed; returning un-enriched result:', e);
    return result;
  }
}

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
      // The popup's universal countdown: screen-time left today per the active
      // budget gate (null when gating is off or the gate isn't budget-style).
      const budgetMsLeft = remainingBudgetMs(await evaluateGate());
      return ok({ settings, authenticated, activeListId, budgetMsLeft });
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
      // The cached task lists are now stale — drop them so the re-evaluation
      // and block-screen list reflect the completion immediately.
      invalidateTaskCache();
      // Completing a task changes today's earned budget — re-evaluate and
      // broadcast the (possibly unlocked) decision to all blocked tabs.
      const gate = await evaluateGate();
      void broadcastToBlockedTabs({ type: 'GATE_CHANGED', result: await enrichWithTasks(gate) });
      return ok(null);
    }

    case 'COMPLETE_GATE_TASK': {
      const settings = await getSettings();
      if (!settings.activeProviderId) return err('No active provider');
      const provider = getProviderOrNull(settings.activeProviderId);
      if (!provider) return err(`Unknown provider: ${settings.activeProviderId}`);
      const r = await provider.completeTask(req.projectId, req.taskId);
      if (!r.ok) return err(r.error);
      invalidateTaskCache();
      const gate = await evaluateGate();
      void broadcastToBlockedTabs({ type: 'GATE_CHANGED', result: await enrichWithTasks(gate) });
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
      // Drop the disconnected account's cached tasks so a quick reconnect
      // can't serve pre-disconnect data.
      invalidateTaskCache();
      const settings = await getSettings();
      if (settings.activeProviderId === req.providerId) {
        await setSettings({ activeProviderId: null });
      }
      void broadcastToBlockedTabs({ type: 'AUTH_REQUIRED', providerId: req.providerId });
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
      // Manual refresh should bypass the cache and pull fresh data.
      invalidateTaskCache();
      const r = await listTasksForUi(provider, req.listId);
      if (!r.ok) return err(r.error);
      void broadcastToBlockedTabs({
        type: 'TASKS_UPDATED',
        providerId: req.providerId,
        listId: req.listId,
        tasks: r.value,
      });
      return ok(r.value);
    }

    case 'GATE_EVAL':
      return ok(await enrichWithTasks(await evaluateGate()));

    case 'USAGE_TICK': {
      // Accrue screen time into this device's interval record (and a throttled
      // push to the sync transport). Re-blocking on budget exhaustion is handled
      // by the 1-minute gate alarm, so we don't re-evaluate on every tick.
      await recordUsage(Date.now(), req.deltaMs);
      return ok(null);
    }

    case 'ANKI_TEST': {
      const signal = getSignalOrNull(ANKI_STUDY_SIGNAL_ID);
      if (!signal) return err('Anki signal unavailable');
      const r = await signal.read();
      if (!r.ok) return err(r.error);
      return ok({ studyMinutesToday: Math.round(r.value.value / 60_000) });
    }

    case 'SYNC_TEST': {
      const transport = await getRemoteTransport();
      if (!transport) return err('Sync is off');
      try {
        const records = await transport.listForDay(localDayKey(Date.now()));
        return ok({ devices: records.length });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
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
  const r = await cachedListTasks(provider, listId, settings.showCompleted);
  if (!r.ok) return err(r.error);
  const sorted = sortTasks(r.value, settings.sortBy);
  return ok(settings.maxItems > 0 ? sorted.slice(0, settings.maxItems) : sorted);
}

/**
 * Called from the alarm tick in `entrypoints/background.ts`. Refreshes
 * the active provider's active list and broadcasts to blocked-site tabs.
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
  void broadcastToBlockedTabs({
    type: 'TASKS_UPDATED',
    providerId: settings.activeProviderId as ProviderId,
    listId,
    tasks: r.value,
  });
}

export { broadcastToBlockedTabs };
export type { Broadcast };

const KNOWN_TYPES: readonly MessageType[] = [
  'GET_STATE',
  'LIST_PROJECTS',
  'LIST_TASKS',
  'AUTH_STATUS',
  'COMPLETE_TASK',
  'COMPLETE_GATE_TASK',
  'AUTH_START',
  'AUTH_DISCONNECT',
  'REFRESH_NOW',
  'SET_ENABLED',
  'SET_ACTIVE_LIST',
  'GATE_EVAL',
  'USAGE_TICK',
  'ANKI_TEST',
  'HTTP_SIGNAL_TEST',
  'SYNC_TEST',
];

function isRequest(v: unknown): v is Request {
  if (typeof v !== 'object' || v === null || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return typeof t === 'string' && (KNOWN_TYPES as readonly string[]).includes(t);
}
