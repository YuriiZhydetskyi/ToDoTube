import { describe, expect, it } from 'vitest';

import { err, ok } from '@/shared/result';
import { HTTP_SIGNAL_ID, type GateConfig, type SignalKind, type SignalValue } from '@/shared/types';

import type { GateContext } from '../types';
import { activityBudgetGate } from './gate';

const MIN = 60_000;

// `value` is the CANONICAL signal value the gate consumes: ms for durationMs
// metrics, a plain count for count metrics (the real HTTP signal applies the
// catalogue's scale; here we hand the gate the post-scale value directly).
function ctx(opts: {
  value?: number;
  error?: string;
  spentMs?: number;
  config?: GateConfig;
}): GateContext {
  return {
    now: 1_700_000_000_000,
    youtubeUsageTodayMs: opts.spentMs ?? 0,
    readSignal: async (id, config) => {
      expect(id).toBe(HTTP_SIGNAL_ID);
      if (opts.error) return err(opts.error);
      const kind = (config as { kind: SignalKind }).kind;
      const value: SignalValue = { kind, value: opts.value ?? 0, asOf: 0 };
      return ok(value);
    },
    readCompletedTasksToday: async () => err('not used by this gate'),
    state: {},
    config: opts.config ?? {},
  };
}

describe('activityBudgetGate.evaluate', () => {
  it('count metric: 200 reps = 30 min earns 30 min of viewing', async () => {
    const d = await activityBudgetGate.evaluate(
      ctx({ value: 200, config: { metric: 'reps', effortAmount: 200, rewardMinutes: 30 } }),
    );
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(30 * MIN);
  });

  it('durationMs metric: 30 min in HR zone = 60 min earns 60 min of viewing', async () => {
    const d = await activityBudgetGate.evaluate(
      ctx({
        value: 30 * MIN, // canonical ms
        config: { metric: 'hrZoneMinutes', effortAmount: 30, rewardMinutes: 60 },
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(60 * MIN);
  });

  it('blocks when spent has caught up, hinting the remaining effort in the metric unit', async () => {
    const d = await activityBudgetGate.evaluate(
      ctx({
        value: 100,
        spentMs: 20 * MIN,
        config: { metric: 'reps', effortAmount: 200, rewardMinutes: 30 },
      }),
    );
    // 100 reps → 15 min earned, 20 spent → blocked.
    expect(d.allowed).toBe(false);
    expect(d.earnedMs).toBe(15 * MIN);
    expect(d.requirement.detail).toContain('more reps');
    expect(d.requirement.progress).toEqual({ current: 15, target: 20, unit: 'min' });
  });

  it('fails closed by default when the bridge is unreachable', async () => {
    const d = await activityBudgetGate.evaluate(ctx({ error: 'Failed to fetch' }));
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Start the activity bridge');
    expect(d.requirement.detail).toContain('Failed to fetch');
  });

  it('fails open when configured to', async () => {
    const d = await activityBudgetGate.evaluate(
      ctx({ error: 'nope', config: { failMode: 'open' } }),
    );
    expect(d.allowed).toBe(true);
  });

  it('falls back to defaults for an unknown metric', async () => {
    // Unknown metric → default (reps, count); 200 value at default 200/30.
    const d = await activityBudgetGate.evaluate(ctx({ value: 200, config: { metric: 'bogus' } }));
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(30 * MIN);
  });
});
