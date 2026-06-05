// Task + project handlers: list, complete (panel + block-screen), manual
// refresh, and active-list selection.

import { evaluateGate } from '@/core/gatekeeper/gatekeeper';
import { getProviderOrNull } from '@/providers/registry';
import { log } from '@/shared/logger';
import { err, ok } from '@/shared/messaging';
import { getSettings, setProviderState } from '@/shared/storage';

import { broadcastToBlockedTabs } from '../broadcast';
import { invalidateTaskCache } from '../task-cache';
import { enrichWithTasks, listTasksForUi, type HandlerMap } from './shared';

// Re-evaluate the gate after a completion and broadcast the (possibly unlocked)
// decision to blocked tabs. Detached on purpose: the caller only needs the
// completion itself to have landed (its own ok/err, decided before this runs),
// and the unlock reaches the tab via the GATE_CHANGED broadcast — so the
// "complete task" click never waits on the re-evaluation's two TickTick reads
// (evaluateGate's completed-tasks read + enrichWithTasks). Errors are logged.
function reevaluateAndBroadcast(): void {
  void (async () => {
    try {
      const gate = await evaluateGate();
      await broadcastToBlockedTabs({ type: 'GATE_CHANGED', result: await enrichWithTasks(gate) });
    } catch (e) {
      log.warn('post-completion re-evaluate/broadcast failed:', e);
    }
  })();
}

export const taskHandlers = {
  LIST_PROJECTS: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    return provider.listProjects();
  },

  LIST_TASKS: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    return listTasksForUi(provider, req.listId);
  },

  COMPLETE_TASK: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    const r = await provider.completeTask(req.projectId, req.taskId);
    if (!r.ok) return err(r.error);
    // The cached task lists are now stale — drop them so the re-evaluation
    // and block-screen list reflect the completion immediately.
    invalidateTaskCache();
    // Completing a task changes today's earned budget — re-evaluate and
    // broadcast the (possibly unlocked) decision to all blocked tabs. Detached
    // so the click doesn't wait on the re-evaluation's network reads.
    reevaluateAndBroadcast();
    return ok(null);
  },

  COMPLETE_GATE_TASK: async (req) => {
    const settings = await getSettings();
    if (!settings.activeProviderId) return err('No active provider');
    const provider = getProviderOrNull(settings.activeProviderId);
    if (!provider) return err(`Unknown provider: ${settings.activeProviderId}`);
    const r = await provider.completeTask(req.projectId, req.taskId);
    if (!r.ok) return err(r.error);
    invalidateTaskCache();
    reevaluateAndBroadcast();
    return ok(null);
  },

  REFRESH_NOW: async (req) => {
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
  },

  SET_ACTIVE_LIST: async (req) => {
    const provider = getProviderOrNull(req.providerId);
    if (!provider) return err(`Unknown provider: ${req.providerId}`);
    await setProviderState(req.providerId, { activeListId: req.listId });
    // The storage watcher in `entrypoints/background.ts` will broadcast
    // LIST_CHANGED — we don't need to do it here.
    return ok(null);
  },
} satisfies Pick<
  HandlerMap,
  | 'LIST_PROJECTS'
  | 'LIST_TASKS'
  | 'COMPLETE_TASK'
  | 'COMPLETE_GATE_TASK'
  | 'REFRESH_NOW'
  | 'SET_ACTIVE_LIST'
>;
