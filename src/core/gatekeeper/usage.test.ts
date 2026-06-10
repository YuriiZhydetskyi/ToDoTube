import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

import { getSpentTodayMs, localDayKey, recordUsage } from './usage';

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

// Sync defaults to off, so recordUsage/getSpentTodayMs round-trip through the
// local interval store only — the same single-device behavior as before, now
// backed by intervals + union instead of a scalar counter.
describe('screen-time accrual (sync off)', () => {
  it('accumulates separate sessions within a day', async () => {
    await recordUsage(MORNING, 5_000);
    await recordUsage(EVENING, 7_000);
    expect(await getSpentTodayMs(EVENING)).toBe(12_000);
  });

  it('resets when the day changes', async () => {
    await recordUsage(EVENING, 9_000);
    expect(await getSpentTodayMs(NEXT_DAY)).toBe(0);
    await recordUsage(NEXT_DAY, 1_000);
    expect(await getSpentTodayMs(NEXT_DAY)).toBe(1_000);
  });

  it('ignores non-positive deltas', async () => {
    await recordUsage(MORNING, 0);
    await recordUsage(MORNING, -500);
    expect(await getSpentTodayMs(MORNING)).toBe(0);
  });

  it('coalesces contiguous ticks into one session (no gaps inflate the total)', async () => {
    // Three back-to-back 20s ticks during continuous watching.
    await recordUsage(MORNING + 20_000, 20_000);
    await recordUsage(MORNING + 40_000, 20_000);
    await recordUsage(MORNING + 60_000, 20_000);
    expect(await getSpentTodayMs(MORNING + 60_000)).toBe(60_000);
  });
});
