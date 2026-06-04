import { describe, expect, it } from 'vitest';

import { localDayKey } from '@/shared/day';
import { err, ok } from '@/shared/result';
import type { GateConfig, GateState, Task } from '@/shared/types';

import type { GateContext } from '../types';
import { taskCompleteGate } from './gate';

const NOW = 1_700_000_000_000;
const TODAY = localDayKey(NOW);
const MIN = 60_000;

function task(id: string, title: string): Task {
  return { id, projectId: 'p1', title, completed: true };
}

function ctx(opts: {
  completed?: Task[];
  completedErr?: string;
  spentMs?: number;
  config?: GateConfig;
  state?: GateState;
}): GateContext {
  return {
    now: NOW,
    spentTodayMs: opts.spentMs ?? 0,
    readSignal: async () => err('no signals in this test'),
    readCompletedTasksToday: async () =>
      opts.completedErr ? err(opts.completedErr) : ok(opts.completed ?? []),
    state: opts.state ?? {},
    config: opts.config ?? {},
  };
}

describe('taskCompleteGate.evaluate', () => {
  it('blocks when no tasks have been completed today', async () => {
    const d = await taskCompleteGate.evaluate(ctx({}));
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Complete a task');
  });

  it('grants the per-task default (10 min) for one completed task', async () => {
    const d = await taskCompleteGate.evaluate(ctx({ completed: [task('t1', 'Buy milk')] }));
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(10 * MIN);
  });

  it('honours a "(+N min y)" override instead of the default', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completed: [task('t1', 'Write report (+30 min y)')] }),
    );
    expect(d.earnedMs).toBe(30 * MIN);
  });

  it('sums default and annotated tasks', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completed: [task('t1', 'Plain'), task('t2', 'Big (+30 min y)')] }),
    );
    // 10 (default) + 30 (override) = 40
    expect(d.earnedMs).toBe(40 * MIN);
  });

  it('respects a configured per-task default', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completed: [task('t1', 'A')], config: { minutesPerTask: 25 } }),
    );
    expect(d.earnedMs).toBe(25 * MIN);
  });

  it('blocks once watched time has caught up to earned time', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completed: [task('t1', 'A')], spentMs: 10 * MIN }),
    );
    expect(d.allowed).toBe(false);
    expect(d.requirement.progress).toEqual({ current: 10, target: 10, unit: 'min' });
  });

  it('treats an explicit "(+0 min y)" as zero, not the default', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completed: [task('t1', 'Trivial (+0 min y)')] }),
    );
    expect(d.allowed).toBe(false);
    expect(d.earnedMs).toBe(0);
  });

  // --- last-known-good caching + fail mode --------------------------------

  it("caches today's earned total as nextState on a successful read", async () => {
    const d = await taskCompleteGate.evaluate(ctx({ completed: [task('t1', 'A')] }));
    expect(d.nextState).toEqual({ day: TODAY, earnedMs: 10 * MIN });
  });

  it('skips the state write when the cached total is unchanged', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completed: [task('t1', 'A')], state: { day: TODAY, earnedMs: 10 * MIN } }),
    );
    expect(d.nextState).toBeUndefined();
  });

  it("falls back to today's cached earned total when the list is unreachable", async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({
        completedErr: 'network down',
        spentMs: 5 * MIN,
        state: { day: TODAY, earnedMs: 30 * MIN },
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(30 * MIN);
    expect(d.spentMs).toBe(5 * MIN);
    // A failed read must never overwrite the cached total.
    expect(d.nextState).toBeUndefined();
  });

  it('stays blocked on the cached total when it is exhausted', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({
        completedErr: 'down',
        spentMs: 40 * MIN,
        state: { day: TODAY, earnedMs: 30 * MIN },
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.requirement.detail).toContain('last known total');
  });

  it('ignores a stale cache from a previous day and applies the fail mode', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({
        completedErr: 'down',
        state: { day: '2000-01-01', earnedMs: 99 * MIN },
        config: { failMode: 'closed' },
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Connect');
  });

  it('defaults to fail-open when the list is unreachable and nothing is cached', async () => {
    const d = await taskCompleteGate.evaluate(ctx({ completedErr: 'network down' }));
    expect(d.allowed).toBe(true);
  });

  it('fails closed (blocks) when configured to and nothing is cached', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completedErr: 'network down', config: { failMode: 'closed' } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Connect');
  });
});
