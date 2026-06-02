import { describe, expect, it } from 'vitest';

import { parseBudgetAnnotation } from './budget-annotation';

describe('parseBudgetAnnotation', () => {
  it('returns null minutes and the untouched title when there is no annotation', () => {
    expect(parseBudgetAnnotation('Buy milk')).toEqual({ minutes: null, cleanTitle: 'Buy milk' });
  });

  it('parses the canonical "(+N min y)" form and strips it from the title', () => {
    expect(parseBudgetAnnotation('Write report (+30 min y)')).toEqual({
      minutes: 30,
      cleanTitle: 'Write report',
    });
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(parseBudgetAnnotation('Task ( + 15  MIN  Y )').minutes).toBe(15);
    expect(parseBudgetAnnotation('Task (+5min y)').minutes).toBe(5);
  });

  it('accepts "mins" and "minutes"', () => {
    expect(parseBudgetAnnotation('A (+10 mins y)').minutes).toBe(10);
    expect(parseBudgetAnnotation('B (+10 minutes y)').minutes).toBe(10);
  });

  it('honours an explicit zero (not treated as "use the default")', () => {
    expect(parseBudgetAnnotation('Trivial (+0 min y)').minutes).toBe(0);
  });

  it('ignores parenthetical text without the y marker', () => {
    expect(parseBudgetAnnotation('Errand (takes 15 min)')).toEqual({
      minutes: null,
      cleanTitle: 'Errand (takes 15 min)',
    });
  });

  it('strips a mid-title annotation and collapses the doubled space', () => {
    expect(parseBudgetAnnotation('Call (+20 min y) the bank')).toEqual({
      minutes: 20,
      cleanTitle: 'Call the bank',
    });
  });

  it('falls back to the original title if stripping would leave it empty', () => {
    expect(parseBudgetAnnotation('(+10 min y)')).toEqual({
      minutes: 10,
      cleanTitle: '(+10 min y)',
    });
  });
});
