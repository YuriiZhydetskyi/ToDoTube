import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import { setSettings } from '@/shared/storage';
import { DEFAULT_GATING, TASK_COMPLETE_GATE_ID, type GateConfig } from '@/shared/types';

import { evaluateGate } from './gatekeeper';

beforeEach(() => {
  fakeBrowser.reset();
});

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

describe('evaluateGate', () => {
  it('reports gating off when disabled', async () => {
    const r = await evaluateGate();
    expect(r.gating).toBe(false);
  });

  it('blocks via the active task gate when no provider is connected', async () => {
    // With no active provider, readCompletedTasksToday errs and the gate
    // fails closed (its default) → blocked.
    await enableTaskGate();
    const r = await evaluateGate();
    expect(r.gating).toBe(true);
    if (r.gating) {
      expect(r.gateId).toBe(TASK_COMPLETE_GATE_ID);
      expect(r.decision.allowed).toBe(false);
    }
  });
});
