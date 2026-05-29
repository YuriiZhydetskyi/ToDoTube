import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import { getGateState, setSettings } from '@/shared/storage';
import { TASK_COMPLETE_GATE_ID, type GateConfig } from '@/shared/types';

import { evaluateGate, notifyTaskCompleted } from './gatekeeper';

beforeEach(() => {
  fakeBrowser.reset();
});

async function enableTaskGate(config: GateConfig = {}): Promise<void> {
  await setSettings({
    gating: {
      enabled: true,
      scope: 'site',
      activeGateId: TASK_COMPLETE_GATE_ID,
      gateConfigs: { [TASK_COMPLETE_GATE_ID]: config },
    },
  });
}

describe('evaluateGate', () => {
  it('reports gating off when disabled', async () => {
    const r = await evaluateGate();
    expect(r.gating).toBe(false);
  });

  it('blocks via the active task gate when nothing is unlocked', async () => {
    await enableTaskGate();
    const r = await evaluateGate();
    expect(r.gating).toBe(true);
    if (r.gating) {
      expect(r.gateId).toBe(TASK_COMPLETE_GATE_ID);
      expect(r.decision.allowed).toBe(false);
    }
  });
});

describe('notifyTaskCompleted', () => {
  it('unlocks the task gate, persists the session, and stays allowed', async () => {
    await enableTaskGate({ grantMinutes: 10 });

    const unlocked = await notifyTaskCompleted('ticktick', 't1');
    expect(unlocked.gating).toBe(true);
    if (unlocked.gating) expect(unlocked.decision.allowed).toBe(true);

    // The granted session was persisted...
    const state = await getGateState(TASK_COMPLETE_GATE_ID);
    expect(typeof state.unlockedUntil).toBe('number');

    // ...so a fresh evaluation still allows access within the window.
    const again = await evaluateGate();
    if (again.gating) expect(again.decision.allowed).toBe(true);
  });

  it('is a no-op (gating off) when no gate is active', async () => {
    const r = await notifyTaskCompleted('ticktick', 't1');
    expect(r.gating).toBe(false);
  });

  it('accumulates progress without unlocking when more tasks are required', async () => {
    await enableTaskGate({ tasksRequired: 2 });

    const first = await notifyTaskCompleted('ticktick', 't1');
    if (first.gating) expect(first.decision.allowed).toBe(false);
    expect((await getGateState(TASK_COMPLETE_GATE_ID)).progressCount).toBe(1);

    const second = await notifyTaskCompleted('ticktick', 't2');
    if (second.gating) expect(second.decision.allowed).toBe(true);
  });
});
