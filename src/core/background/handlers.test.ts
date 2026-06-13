import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';

import type { ListTasksOpts, Provider } from '@/providers/types';
import { getSpentTodayMs } from '@/core/gatekeeper/usage';
import { localDayKey } from '@/shared/day';
import { sendToBackground } from '@/shared/messaging';
import { ok } from '@/shared/result';
import { listDeviceDayUsage, setSettings } from '@/shared/storage';
import { DEFAULT_GATING, TASK_COMPLETE_GATE_ID, type GateConfig, type Task } from '@/shared/types';

// The provider registry is mocked so the dispatch-path tests can swap in a
// stub provider per case (the real registry only knows TickTick, which would
// hit the network). `currentProvider` defaults to null so any case that
// doesn't set one behaves like "no provider connected" — exactly what the
// fakeBrowser default storage yields (activeProviderId === null) — and the
// gatekeeper's task gate then exercises its fail-open / fail-closed paths.
let currentProvider: Provider | null = null;
vi.mock('@/providers/registry', () => ({
  getProviderOrNull: (id: unknown) => (id == null ? null : currentProvider),
  getProvider: () => currentProvider,
}));

import { getSettings, setProviderState } from '@/shared/storage';
import type { OAuthTokens } from '@/shared/types';

import { listTasksForUi, registerHandlers, wireAuthBroadcasts } from './handlers';
import { invalidateTaskCache } from './task-cache';

function tokens(accessToken: string): OAuthTokens {
  return { accessToken, expiresAt: Date.now() + 1_000_000 };
}

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, projectId: 'p', title: id, completed: false, ...extra };
}

// Minimal Provider stub. `listTasks` records the opts it was handed (so we
// can assert the settings→opts wiring) and returns a fixed list unchanged.
function stubProvider(tasks: Task[], onListTasks?: (opts: ListTasksOpts) => void): Provider {
  return {
    id: 'ticktick',
    displayName: 'TickTick',
    authenticate: async () => ok({ authenticated: true }),
    isAuthenticated: async () => true,
    disconnect: async () => {},
    listProjects: async () => ok([]),
    listTasks: async (_listId, opts = {}) => {
      onListTasks?.(opts);
      return ok(tasks);
    },
    completeTask: async () => ok(undefined),
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  currentProvider = null;
  // The list cache is module-scoped; clear it so each case sees its own
  // stub provider's data rather than a prior case's cached read.
  invalidateTaskCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Lets the detached, fire-and-forget post-completion re-evaluation +
// GATE_CHANGED broadcast run: the COMPLETE_* handlers return ok(null) WITHOUT
// awaiting it, so any assertion about that broadcast must wait a macrotask.
function flushMacrotask(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function enableTaskGate(config: GateConfig = {}): Promise<void> {
  await setSettings({
    gating: {
      ...DEFAULT_GATING,
      enabled: true,
      activeGateId: TASK_COMPLETE_GATE_ID,
      gateConfigs: { [TASK_COMPLETE_GATE_ID]: config },
    },
  });
}

describe('listTasksForUi', () => {
  it('passes showCompleted through to the provider as includeCompleted', async () => {
    let seen: ListTasksOpts | undefined;
    const provider = stubProvider([], (opts) => {
      seen = opts;
    });

    await setSettings({ showCompleted: true });
    await listTasksForUi(provider, 'list-a');
    expect(seen?.includeCompleted).toBe(true);

    await setSettings({ showCompleted: false });
    await listTasksForUi(provider, 'list-a');
    expect(seen?.includeCompleted).toBe(false);
  });

  it('sorts by the configured sortBy BEFORE capping to maxItems', async () => {
    // Provider returns low-priority first. With slice-before-sort this would
    // wrongly keep [low, high]; sort-before-slice keeps the real top two.
    const provider = stubProvider([
      task('low', { priority: 1 }),
      task('high', { priority: 5 }),
      task('mid', { priority: 3 }),
    ]);

    await setSettings({ sortBy: 'priority', maxItems: 2 });
    const r = await listTasksForUi(provider, 'list-a');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((t) => t.id)).toEqual(['high', 'mid']);
  });

  it('preserves provider order for providerOrder, then caps', async () => {
    const provider = stubProvider([task('b'), task('a'), task('c')]);

    await setSettings({ sortBy: 'providerOrder', maxItems: 2 });
    const r = await listTasksForUi(provider, 'list-a');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('returns the provider error verbatim', async () => {
    const provider: Provider = {
      ...stubProvider([]),
      listTasks: async () => ({ ok: false, error: 'boom' }),
    };

    const r = await listTasksForUi(provider, 'list-a');
    expect(r).toEqual({ ok: false, error: 'boom' });
  });
});

// Exercises the REAL dispatch path: registerHandlers() wires the typed bus, and
// sendToBackground round-trips through fakeBrowser's runtime.onMessage to the
// handler map, so these cover handlers.ts's dispatch + the per-domain handlers
// exactly as production does (no calling helpers directly).
describe('message dispatch', () => {
  beforeEach(() => {
    registerHandlers();
  });

  describe('GET_STATE', () => {
    it('returns ok with a GlobalState; budgetMsLeft is null when gating is off', async () => {
      const r = await sendToBackground({ type: 'GET_STATE' });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Gating defaults to off → no budget to surface.
      expect(r.value.budgetMsLeft).toBeNull();
      // No provider connected by default.
      expect(r.value.authenticated).toBe(false);
      expect(r.value.activeListId).toBeNull();
      expect(r.value.settings).toBeDefined();
      expect(r.value.settings.gating.enabled).toBe(false);
    });

    it('reflects the active provider auth + active list', async () => {
      currentProvider = stubProvider([]);
      await setSettings({ activeProviderId: 'ticktick' });

      const r = await sendToBackground({ type: 'GET_STATE' });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.authenticated).toBe(true);
    });
  });

  describe('GATE_EVAL', () => {
    it('reports gating: false when gating is disabled', async () => {
      const r = await sendToBackground({ type: 'GATE_EVAL' });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toEqual({ gating: false });
    });

    it('returns { gating, gateId, decision } when an active gate is configured', async () => {
      // Enable the task gate with fail-CLOSED and no provider connected: the
      // gate's completed-tasks read errs, there's no cached total, so it blocks
      // deterministically — a stable, network-free way to assert the shape.
      await enableTaskGate({ failMode: 'closed' });

      const r = await sendToBackground({ type: 'GATE_EVAL' });

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.gating).toBe(true);
      if (!r.value.gating) return;
      expect(r.value.gateId).toBe(TASK_COMPLETE_GATE_ID);
      expect(r.value.decision.allowed).toBe(false);
    });
  });

  describe('USAGE_TICK', () => {
    it('accrues a positive delta into today’s usage ledger', async () => {
      const before = await getSpentTodayMs(Date.now());
      expect(before).toBe(0);

      const r = await sendToBackground({ type: 'USAGE_TICK', deltaMs: 60_000 });
      expect(r).toEqual(ok(null));

      // A single tick of 60s is one interval whose union length is 60s.
      const after = await getSpentTodayMs(Date.now());
      expect(after).toBe(60_000);

      // And it landed as this device's local interval record for today.
      const records = await listDeviceDayUsage('local', localDayKey(Date.now()));
      expect(records).toHaveLength(1);
      expect(records[0]!.intervals).toHaveLength(1);
    });

    it('does not accrue a non-positive delta', async () => {
      const r = await sendToBackground({ type: 'USAGE_TICK', deltaMs: 0 });
      expect(r).toEqual(ok(null));

      expect(await getSpentTodayMs(Date.now())).toBe(0);
      const records = await listDeviceDayUsage('local', localDayKey(Date.now()));
      expect(records).toHaveLength(0);
    });
  });

  describe('COMPLETE_TASK', () => {
    it('returns ok(null) and invalidates the task cache on success', async () => {
      let listCalls = 0;
      const provider = stubProvider([task('t1')], () => {
        listCalls++;
      });
      currentProvider = provider;

      // Prime the list cache through the real dispatch path.
      await sendToBackground({ type: 'LIST_TASKS', providerId: 'ticktick', listId: 'list-a' });
      expect(listCalls).toBe(1);
      // A second identical read is served from cache (no extra provider call).
      await sendToBackground({ type: 'LIST_TASKS', providerId: 'ticktick', listId: 'list-a' });
      expect(listCalls).toBe(1);

      const r = await sendToBackground({
        type: 'COMPLETE_TASK',
        providerId: 'ticktick',
        projectId: 'p',
        taskId: 't1',
      });
      expect(r).toEqual(ok(null));

      // The cache was dropped, so the next read re-fetches from the provider.
      await sendToBackground({ type: 'LIST_TASKS', providerId: 'ticktick', listId: 'list-a' });
      expect(listCalls).toBe(2);
    });

    it('returns err when the provider completeTask fails', async () => {
      currentProvider = {
        ...stubProvider([]),
        completeTask: async () => ({ ok: false, error: 'nope' }),
      };

      const r = await sendToBackground({
        type: 'COMPLETE_TASK',
        providerId: 'ticktick',
        projectId: 'p',
        taskId: 't1',
      });
      expect(r).toEqual({ ok: false, error: 'nope' });
    });

    it('fires the post-completion GATE_CHANGED broadcast detached (after the handler returns)', async () => {
      // broadcastToBlockedTabs (the sink of the detached re-eval) calls
      // tabs.query; the detached IIFE runs after the handler resolves, so the
      // spy must not yet have been hit when ok(null) returns. fakeBrowser's
      // query resolves to [] by default (no tabs seeded), so we only observe.
      const querySpy = vi.spyOn(browser.tabs, 'query');
      currentProvider = stubProvider([task('t1')]);

      const r = await sendToBackground({
        type: 'COMPLETE_TASK',
        providerId: 'ticktick',
        projectId: 'p',
        taskId: 't1',
      });
      expect(r).toEqual(ok(null));
      // Handler did NOT await the re-eval/broadcast.
      expect(querySpy).not.toHaveBeenCalled();

      // ...it completes on a later macrotask.
      await flushMacrotask();
      expect(querySpy).toHaveBeenCalled();
    });
  });

  describe('COMPLETE_GATE_TASK', () => {
    it('returns ok(null) and invalidates the task cache on success', async () => {
      let listCalls = 0;
      currentProvider = stubProvider([task('t1')], () => {
        listCalls++;
      });
      await setSettings({ activeProviderId: 'ticktick' });

      await sendToBackground({ type: 'LIST_TASKS', providerId: 'ticktick', listId: 'list-a' });
      expect(listCalls).toBe(1);

      const r = await sendToBackground({
        type: 'COMPLETE_GATE_TASK',
        projectId: 'p',
        taskId: 't1',
      });
      expect(r).toEqual(ok(null));

      await sendToBackground({ type: 'LIST_TASKS', providerId: 'ticktick', listId: 'list-a' });
      expect(listCalls).toBe(2);
    });

    it('returns err when the provider completeTask fails', async () => {
      currentProvider = {
        ...stubProvider([]),
        completeTask: async () => ({ ok: false, error: 'gate-nope' }),
      };
      await setSettings({ activeProviderId: 'ticktick' });

      const r = await sendToBackground({
        type: 'COMPLETE_GATE_TASK',
        projectId: 'p',
        taskId: 't1',
      });
      expect(r).toEqual({ ok: false, error: 'gate-nope' });
    });

    it('returns err when there is no active provider', async () => {
      // No activeProviderId set (fakeBrowser default).
      const r = await sendToBackground({
        type: 'COMPLETE_GATE_TASK',
        projectId: 'p',
        taskId: 't1',
      });
      expect(r.ok).toBe(false);
    });
  });
});

// The tokens-appeared watcher. broadcastToBlockedTabs (its sink) calls
// tabs.query, so an AUTH_CHANGED broadcast is observable as a tabs.query
// hit (fakeBrowser returns [] with no tabs seeded — we only observe). This
// path is what recovers the UI when an OAuth flow outlived its worker and
// no AUTH_START response ever came back.
describe('wireAuthBroadcasts', () => {
  it('broadcasts and adopts the provider when tokens first appear', async () => {
    const querySpy = vi.spyOn(browser.tabs, 'query');
    wireAuthBroadcasts();

    await setProviderState('ticktick', { tokens: tokens('tok') });

    await flushMacrotask();
    expect(querySpy).toHaveBeenCalled();
    // First connection becomes the active provider (same rule as AUTH_START).
    expect((await getSettings()).activeProviderId).toBe('ticktick');
  });

  it('does not broadcast on a token refresh (tokens already present)', async () => {
    // Seed tokens BEFORE wiring so the later write is present→present.
    await setProviderState('ticktick', { tokens: tokens('old') });
    const querySpy = vi.spyOn(browser.tabs, 'query');
    wireAuthBroadcasts();

    await setProviderState('ticktick', { tokens: tokens('new') });

    await flushMacrotask();
    expect(querySpy).not.toHaveBeenCalled();
  });
});
