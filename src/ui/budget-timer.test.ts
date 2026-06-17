// @vitest-environment jsdom
//
// Budget-timer rendering + gesture contract: corner class, formatted value,
// surgical updates, and the single-tap-vs-double-tap discrimination (the
// trickiest bit). No browser APIs — pure DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { otherCorner, renderBudgetTimer, setTimerCorner, setTimerValue } from './budget-timer';

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

describe('otherCorner', () => {
  it('flips between the two corners', () => {
    expect(otherCorner('right')).toBe('left');
    expect(otherCorner('left')).toBe('right');
  });
});

describe('renderBudgetTimer', () => {
  it('renders the corner class and the value as a clock', () => {
    const root = mount();
    renderBudgetTimer(
      root,
      { msLeft: 5 * 60_000 + 7_000, corner: 'right' },
      { onToggleCorner: () => {}, onDismiss: () => {} },
    );
    const pill = root.querySelector('.tt-timer');
    expect(pill?.classList.contains('tt-timer--right')).toBe(true);
    expect(root.querySelector('.tt-timer__value')?.textContent).toBe('5:07');
    // Brand dot is present.
    expect(root.querySelector('.tt-timer__dot')).not.toBeNull();
  });

  it('updates value and corner surgically without dropping the node', () => {
    const root = mount();
    renderBudgetTimer(
      root,
      { msLeft: 60_000, corner: 'right' },
      { onToggleCorner: () => {}, onDismiss: () => {} },
    );
    const pill = root.querySelector('.tt-timer');

    setTimerValue(root, 9_000);
    setTimerCorner(root, 'left');

    // Same DOM node, just mutated.
    expect(root.querySelector('.tt-timer')).toBe(pill);
    expect(root.querySelector('.tt-timer__value')?.textContent).toBe('0:09');
    expect(pill?.classList.contains('tt-timer--left')).toBe(true);
    expect(pill?.classList.contains('tt-timer--right')).toBe(false);
  });
});

describe('tap gestures', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const root = mount();
    const onToggleCorner = vi.fn();
    const onDismiss = vi.fn();
    renderBudgetTimer(root, { msLeft: 60_000, corner: 'right' }, { onToggleCorner, onDismiss });
    const pill = root.querySelector<HTMLElement>('.tt-timer')!;
    return { pill, onToggleCorner, onDismiss };
  }

  it('a single tap moves corners after the double-tap window', () => {
    const { pill, onToggleCorner, onDismiss } = setup();
    pill.click();
    expect(onToggleCorner).not.toHaveBeenCalled(); // deferred
    vi.advanceTimersByTime(250);
    expect(onToggleCorner).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a double tap dismisses and never fires the move', () => {
    const { pill, onToggleCorner, onDismiss } = setup();
    pill.click();
    pill.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(onToggleCorner).not.toHaveBeenCalled();
  });
});
