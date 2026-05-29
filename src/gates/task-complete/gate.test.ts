import { describe, expect, it } from 'vitest';

import { err } from '@/shared/result';
import type { GateConfig, GateState } from '@/shared/types';

import type { GateContext, GateEvent } from '../types';
import { taskCompleteGate } from './gate';

const NOW = 1_700_000_000_000;
const TASK_COMPLETED: GateEvent = { type: 'task-completed', providerId: 'ticktick', taskId: 't1' };

function ctx(state: GateState = {}, config: GateConfig = {}, now: number = NOW): GateContext {
  return {
    now,
    youtubeUsageTodayMs: 0,
    readSignal: async () => err('no signals in this test'),
    state,
    config,
  };
}

describe('taskCompleteGate.evaluate', () => {
  it('blocks with a requirement when there is no active session', async () => {
    const d = await taskCompleteGate.evaluate(ctx());
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Complete 1 task');
    // Single-task gate omits the progress meter.
    expect(d.requirement.progress).toBeUndefined();
  });

  it('allows while a granted session is still in the future', async () => {
    const d = await taskCompleteGate.evaluate(ctx({ unlockedUntil: NOW + 5 * 60_000 }));
    expect(d.allowed).toBe(true);
    expect(d.allowedUntil).toBe(NOW + 5 * 60_000);
  });

  it('blocks again once the session has expired', async () => {
    const d = await taskCompleteGate.evaluate(ctx({ unlockedUntil: NOW - 1 }));
    expect(d.allowed).toBe(false);
  });

  it('shows a progress meter when more than one task is required', async () => {
    const d = await taskCompleteGate.evaluate(ctx({ progressCount: 1 }, { tasksRequired: 3 }));
    expect(d.requirement.progress).toEqual({ current: 1, target: 3, unit: 'tasks' });
  });
});

describe('taskCompleteGate.onEvent', () => {
  it('grants the default 30-minute session after one completion', async () => {
    const out = await taskCompleteGate.onEvent!(TASK_COMPLETED, ctx());
    expect(out).toBeTruthy();
    expect(out!.allowed).toBe(true);
    expect(out!.allowedUntil).toBe(NOW + 30 * 60_000);
    expect(out!.nextState).toEqual({ unlockedUntil: NOW + 30 * 60_000, progressCount: 0 });
  });

  it('honors a custom grant duration', async () => {
    const out = await taskCompleteGate.onEvent!(TASK_COMPLETED, ctx({}, { grantMinutes: 15 }));
    expect(out!.allowedUntil).toBe(NOW + 15 * 60_000);
  });

  it('accumulates progress until the threshold, then unlocks', async () => {
    const first = await taskCompleteGate.onEvent!(TASK_COMPLETED, ctx({}, { tasksRequired: 2 }));
    expect(first!.allowed).toBeUndefined();
    expect(first!.nextState).toEqual({ progressCount: 1 });

    const second = await taskCompleteGate.onEvent!(
      TASK_COMPLETED,
      ctx({ progressCount: 1 }, { tasksRequired: 2 }),
    );
    expect(second!.allowed).toBe(true);
    expect(second!.nextState).toEqual({ unlockedUntil: NOW + 30 * 60_000, progressCount: 0 });
  });

  it('ignores completions made during an active session', async () => {
    const out = await taskCompleteGate.onEvent!(
      TASK_COMPLETED,
      ctx({ unlockedUntil: NOW + 60_000 }),
    );
    expect(out).toBeUndefined();
  });
});
