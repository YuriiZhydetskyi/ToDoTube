// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { resolve } from './resolver';
import type { Anchor } from './selectors';

describe('resolve', () => {
  it('returns the first strategy that returns a non-null element', () => {
    document.body.innerHTML = '<div id="target">x</div>';
    const anchor: Anchor = {
      description: 'test',
      strategies: [
        () => null,
        () => document.querySelector('#target'),
        () => document.body, // would also match, but earlier wins
      ],
      validate: () => true,
    };
    const result = resolve(anchor);
    expect(result?.strategyIndex).toBe(1);
    expect(result?.element.id).toBe('target');
  });

  it('skips strategies that throw', () => {
    document.body.innerHTML = '<span id="x"></span>';
    const anchor: Anchor = {
      description: 'test',
      strategies: [
        () => {
          throw new Error('strategy boom');
        },
        () => document.querySelector('#x'),
      ],
      validate: () => true,
    };
    const result = resolve(anchor);
    expect(result?.strategyIndex).toBe(1);
  });

  it('skips strategies whose result fails validate', () => {
    document.body.innerHTML = '<span class="too-small"></span><div class="ok">ok</div>';
    const anchor: Anchor = {
      description: 'test',
      strategies: [() => document.querySelector('.too-small'), () => document.querySelector('.ok')],
      validate: (el) => el.tagName.toLowerCase() === 'div',
    };
    const result = resolve(anchor);
    expect(result?.strategyIndex).toBe(1);
    expect(result?.element.className).toBe('ok');
  });

  it('returns null when every strategy fails', () => {
    document.body.innerHTML = '';
    const anchor: Anchor = {
      description: 'test',
      strategies: [() => null, () => null],
      validate: () => true,
    };
    expect(resolve(anchor)).toBeNull();
  });

  it('skips strategies whose validate throws', () => {
    document.body.innerHTML = '<div class="a"></div><div class="b"></div>';
    const anchor: Anchor = {
      description: 'test',
      strategies: [() => document.querySelector('.a'), () => document.querySelector('.b')],
      validate: (el) => {
        if (el.className === 'a') throw new Error('validate boom');
        return true;
      },
    };
    const result = resolve(anchor);
    expect(result?.strategyIndex).toBe(1);
  });
});
