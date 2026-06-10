import { describe, expect, it } from 'vitest';

import { ledgerDecision } from './ledger';

const MIN = 60_000;
const copy = { blockedTitle: 'Move to unlock access', blockedDetail: 'Do ~5 more reps.' };

describe('ledgerDecision', () => {
  it('allows while earned exceeds spent, surfacing the budget', () => {
    const d = ledgerDecision(20 * MIN, 5 * MIN, copy);
    expect(d.allowed).toBe(true);
    expect(d.earnedMs).toBe(20 * MIN);
    expect(d.spentMs).toBe(5 * MIN);
  });

  it('blocks once spent catches up, with a minutes progress meter', () => {
    const d = ledgerDecision(10 * MIN, 10 * MIN, copy);
    expect(d.allowed).toBe(false);
    expect(d.requirement.title).toBe(copy.blockedTitle);
    expect(d.requirement.detail).toBe(copy.blockedDetail);
    expect(d.requirement.progress).toEqual({ current: 10, target: 10, unit: 'min' });
  });

  it('omits the progress meter when nothing has been spent yet', () => {
    const d = ledgerDecision(0, 0, copy);
    expect(d.allowed).toBe(false);
    expect(d.requirement.progress).toBeUndefined();
  });
});
