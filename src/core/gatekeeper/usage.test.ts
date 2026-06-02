import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import { addSpentMs, getSpentTodayMs, localDayKey } from './usage';

const MORNING = new Date(2026, 4, 29, 8, 0, 0).getTime();
const EVENING = new Date(2026, 4, 29, 22, 0, 0).getTime();
const NEXT_DAY = new Date(2026, 4, 30, 9, 0, 0).getTime();

beforeEach(() => {
  fakeBrowser.reset();
});

describe('localDayKey', () => {
  it('is stable across times within the same local day', () => {
    expect(localDayKey(MORNING)).toBe(localDayKey(EVENING));
    expect(localDayKey(MORNING)).toBe('2026-05-29');
  });

  it('rolls over at the local day boundary', () => {
    expect(localDayKey(NEXT_DAY)).toBe('2026-05-30');
  });
});

describe('screen-time accrual', () => {
  it('accumulates within a day', async () => {
    await addSpentMs(MORNING, 5_000);
    await addSpentMs(EVENING, 7_000);
    expect(await getSpentTodayMs(EVENING)).toBe(12_000);
  });

  it('resets when the day changes', async () => {
    await addSpentMs(EVENING, 9_000);
    expect(await getSpentTodayMs(NEXT_DAY)).toBe(0);
    await addSpentMs(NEXT_DAY, 1_000);
    expect(await getSpentTodayMs(NEXT_DAY)).toBe(1_000);
  });

  it('ignores non-positive deltas', async () => {
    await addSpentMs(MORNING, 0);
    await addSpentMs(MORNING, -500);
    expect(await getSpentTodayMs(MORNING)).toBe(0);
  });
});
