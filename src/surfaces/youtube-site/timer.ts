// Floating budget-timer surface. Like the block overlay (overlay.ts) it needs
// no YouTube DOM knowledge — it attaches its own shadow-root host to <html>.
// The host is a full-viewport, click-through layer (pointer-events: none) so it
// never steals interaction from the page; the pill inside re-enables pointer
// events. The caller owns the rendered content via the returned `root`.

const TIMER_ATTR = 'data-todotube-timer';
// One below the block overlay's z-index: the two are mutually exclusive, but if
// they ever coincide the full-page block should win.
const TIMER_Z_INDEX = '2147483646';

export interface TimerHandle {
  readonly root: HTMLElement;
  unmount: () => void;
}

export function mountBudgetTimer(opts: { cssText: string }): TimerHandle {
  const host = document.createElement('div');
  host.setAttribute(TIMER_ATTR, '');
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = TIMER_Z_INDEX;
  // Transparent passthrough layer — only the pill (pointer-events: auto in CSS)
  // is interactive, so the rest of the page stays clickable.
  host.style.pointerEvents = 'none';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = opts.cssText;
  shadow.appendChild(style);
  const root = document.createElement('div');
  shadow.appendChild(root);

  document.documentElement.appendChild(host);

  return {
    root,
    unmount: () => host.remove(),
  };
}
