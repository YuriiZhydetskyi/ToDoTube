import { describe, expect, it } from 'vitest';

import { err, ok } from '@/shared/result';
import type { GateConfig, Task } from '@/shared/types';

import type { GateContext } from '../types';
import { taskCompleteGate } from './gate';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function task(id: string, title: string): Task {
  return { id, projectId: 'p1', title, completed: true };
}

function ctx(opts: {
  completed?: Task[];
  completedErr?: string;
  spentMs?: number;
  config?: GateConfig;
}): GateContext {
  return {
    now: NOW,
    youtubeUsageTodayMs: opts.spentMs ?? 0,
    readSignal: async () => err('no signals in this test'),
    readCompletedTasksToday: async () =>
      opts.completedErr ? err(opts.completedErr) : ok(opts.completed ?? []),
    state: {},
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

  it('fails closed (blocks) when the task list is unreachable', async () => {
    const d = await taskCompleteGate.evaluate(ctx({ completedErr: 'network down' }));
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Connect');
  });

  it('fails open (allows) when configured to', async () => {
    const d = await taskCompleteGate.evaluate(
      ctx({ completedErr: 'network down', config: { failMode: 'open' } }),
    );
    expect(d.allowed).toBe(true);
  });
});
