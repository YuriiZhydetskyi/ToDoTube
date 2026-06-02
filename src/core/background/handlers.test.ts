import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import type { ListTasksOpts, Provider } from '@/providers/types';
import { ok } from '@/shared/result';
import { setSettings } from '@/shared/storage';
import type { Task } from '@/shared/types';

import { listTasksForUi } from './handlers';
import { invalidateTaskCache } from './task-cache';

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
  // The list cache is module-scoped; clear it so each case sees its own
  // stub provider's data rather than a prior case's cached read.
  invalidateTaskCache();
});

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
