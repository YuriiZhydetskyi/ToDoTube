// Vanilla-DOM floating budget timer. Gate-agnostic: it renders the remaining
// daily budget as a small pill in a corner and reports two gestures back to the
// caller — a tap (move to the other corner) and a double-tap (dismiss). The CSS
// is imported as a string via Vite's `?inline` and re-exported so the surface
// layer can inject it into the widget's shadow root — mirroring block-screen.ts.

import { formatBudgetClock } from '@/shared/budget';
import budgetTimerCssText from '@/ui/styles/budget-timer.css?inline';

import type { TimerCorner } from '@/shared/types';

export const budgetTimerCss: string = budgetTimerCssText;

// Window within which a second click counts as a double-tap (dismiss) rather
// than two separate taps. A single tap is therefore deferred by this much so we
// can tell the two apart — imperceptible for a corner move.
const DOUBLE_TAP_MS = 250;

export interface BudgetTimerView {
  msLeft: number;
  corner: TimerCorner;
}

export interface BudgetTimerCallbacks {
  // User tapped once: move the timer to the other corner.
  onToggleCorner: () => void;
  // User double-tapped: hide the timer for this visit.
  onDismiss: () => void;
}

// The opposite corner — single-sourced so the controller and tests agree.
export function otherCorner(corner: TimerCorner): TimerCorner {
  return corner === 'right' ? 'left' : 'right';
}

export function renderBudgetTimer(
  root: HTMLElement,
  view: BudgetTimerView,
  callbacks: BudgetTimerCallbacks,
): void {
  root.replaceChildren();

  const pill = el('div', `tt-timer tt-timer--${view.corner}`);
  pill.title = 'Time left today · tap to move, double-tap to hide';

  pill.appendChild(el('span', 'tt-timer__dot'));

  const value = el('span', 'tt-timer__value');
  value.textContent = formatBudgetClock(view.msLeft);
  pill.appendChild(value);

  attachTapHandler(pill, callbacks);
  root.appendChild(pill);
}

// Surgical text update (no re-render) for the per-second countdown tick, the
// same trick lifecycle's tickBudget uses on the panel banner.
export function setTimerValue(root: HTMLElement, msLeft: number): void {
  const node = root.querySelector('.tt-timer__value');
  if (node) node.textContent = formatBudgetClock(msLeft);
}

export function setTimerCorner(root: HTMLElement, corner: TimerCorner): void {
  const node = root.querySelector('.tt-timer');
  if (!node) return;
  node.classList.remove('tt-timer--left', 'tt-timer--right');
  node.classList.add(`tt-timer--${corner}`);
}

// Distinguish a single tap from a double-tap on one `click` listener (works for
// both mouse and touch — a tap synthesises a click). The first click schedules
// the move; a second click inside the window cancels it and dismisses instead.
function attachTapHandler(node: HTMLElement, callbacks: BudgetTimerCallbacks): void {
  let pendingSingle: ReturnType<typeof setTimeout> | null = null;
  node.addEventListener('click', () => {
    if (pendingSingle !== null) {
      clearTimeout(pendingSingle);
      pendingSingle = null;
      callbacks.onDismiss();
      return;
    }
    pendingSingle = setTimeout(() => {
      pendingSingle = null;
      callbacks.onToggleCorner();
    }, DOUBLE_TAP_MS);
  });
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
