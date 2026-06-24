// Cross-handler helpers + the dispatch types shared by every per-domain handler
// module. Kept in its own file (rather than in handlers.ts) so the domain files
// and the assembler both import from here without a cycle.

import { getProviderOrNull } from '@/providers/registry';
import type { Provider } from '@/providers/types';
import { log } from '@/shared/logger';
import { err, ok, type MessageType, type Request, type Response } from '@/shared/messaging';
import { getProviderDescriptor } from '@/shared/providers';
import type { Result } from '@/shared/result';
import { getProviderState, getSettings, setProviderState } from '@/shared/storage';
import { sortTasks } from '@/shared/tasks';
import {
  TASK_COMPLETE_GATE_ID,
  type GateEvalResult,
  type ListId,
  type ProviderId,
  type Task,
} from '@/shared/types';

import { broadcastToBlockedTabs } from '../broadcast';
import { cachedRead } from '../task-cache';

export type HandlerResult = unknown;

// One message handler, typed against the Schema so request payloads and reply
// shapes are checked. The assembler's `satisfies { [T in MessageType]: ... }`
// turns a missing handler into a compile error.
export type Handler<T extends MessageType> = (
  req: Request<T>,
) => Promise<Result<Response<T>, string>>;

export type HandlerMap = { [T in MessageType]: Handler<T> };

// Provider list reads are cached this long to stay under TickTick's
// 100-req/min limit. The block screen and the watch panel share the same
// "open tasks" key, so they cost one fan-out between them, not two.
const LIST_TTL_MS = 60_000;

export function cachedListTasks(
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
    // Shares the cached "open tasks" read with the watch panel. Focus Mode
    // follows the same sorting and item limit configured for the task panel.
    const r = await cachedListTasks(provider, listId, false);
    if (!r.ok) return result;
    const sorted = sortTasks(r.value, settings.sortBy);
    const tasks = settings.maxItems > 0 ? sorted.slice(0, settings.maxItems) : sorted;
    return {
      ...result,
      decision: {
        ...result.decision,
        requirement: { ...result.decision.requirement, tasks },
      },
    };
  } catch (e) {
    // Fail soft — a provider hiccup must never break the gate overlay — but
    // don't swallow silently; surface it for debugging.
    log.warn('enrichWithTasks failed; returning un-enriched result:', e);
    return result;
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
