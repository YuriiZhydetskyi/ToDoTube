import { describe, expect, it } from 'vitest';

import { err, ok } from '@/shared/result';
import { ANKI_STUDY_SIGNAL_ID, type GateConfig, type SignalValue } from '@/shared/types';

import type { GateContext } from '../types';
import { ankiBudgetGate } from './gate';

const MIN = 60_000;

function ctx(opts: {
  ankiMs?: number;
  ankiError?: string;
  spentMs?: number;
  config?: GateConfig;
}): GateContext {
  return {
    now: 1_700_000_000_000,
    youtubeUsageTodayMs: opts.spentMs ?? 0,
    readSignal: async (id) => {
      expect(id).toBe(ANKI_STUDY_SIGNAL_ID);
      if (opts.ankiError) return err(opts.ankiError);
      const value: SignalValue = { kind: 'durationMs', value: opts.ankiMs ?? 0, asOf: 0 };
      return ok(value);
    },
    state: {},
    config: opts.config ?? {},
  };
}

describe('ankiBudgetGate.evaluate', () => {
  it('allows when earned time exceeds spent time', async () => {
    const d = await ankiBudgetGate.evaluate(ctx({ ankiMs: 20 * MIN, spentMs: 5 * MIN }));
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(20 * MIN);
    expect(d.spentMs).toBe(5 * MIN);
  });

  it('blocks when spent has caught up to earned, with a study target', async () => {
    const d = await ankiBudgetGate.evaluate(ctx({ ankiMs: 10 * MIN, spentMs: 10 * MIN }));
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Study in Anki');
    expect(d.requirement.progress).toEqual({ current: 10, target: 10, unit: 'min' });
  });

  it('applies the ratio to earned time', async () => {
    // ratio 2 → 10 Anki min earns 20 YouTube min, so 15 spent is still allowed.
    const d = await ankiBudgetGate.evaluate(
      ctx({ ankiMs: 10 * MIN, spentMs: 15 * MIN, config: { ratio: 2 } }),
    );
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(20 * MIN);
  });

  it('fails closed by default when Anki is unreachable', async () => {
    const d = await ankiBudgetGate.evaluate(ctx({ ankiError: 'Failed to fetch' }));
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toContain('Open Anki');
    expect(d.requirement.detail).toContain('Failed to fetch');
  });

  it('fails open when configured to', async () => {
    const d = await ankiBudgetGate.evaluate(
      ctx({ ankiError: 'nope', config: { failMode: 'open' } }),
    );
    expect(d.allowed).toBe(true);
  });
});
