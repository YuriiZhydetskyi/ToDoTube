// Adapter — knows how to mount our panel into specific spots on the
// YouTube watch page. The only API the rest of the codebase uses:
//
//   mountRightRail(opts)   -> MountHandle
//   mountEndscreen(opts)   -> MountHandle
//
// Each returns an `unmount()` for cleanup plus `root`, the render-target
// element (inside a shadow root) the lifecycle hands to renderPanel.
// `opts.cssText` is the compiled stylesheet to inject into the shadow
// root — the caller (lifecycle, in `core/`) owns this string, which
// keeps the surfaces layer free of UI dependencies.
// Mount fails by throwing a typed SelectorMissError that
// core/lifecycle.ts catches and treats as "leave YouTube alone."

import { resolve } from './resolver';
import { selectors, type AnchorName } from './selectors';

export class SelectorMissError extends Error {
  constructor(public readonly anchor: AnchorName) {
    super(`ToDoTube: no working strategy for anchor "${anchor}"`);
    this.name = 'SelectorMissError';
  }
}

export interface MountHandle {
  readonly root: HTMLElement;
  readonly strategyIndex: number;
  unmount: () => void;
}

export interface MountOptions {
  /** Compiled stylesheet to inject into the panel's shadow root. */
  cssText: string;
}

const PANEL_ATTR = 'data-todotube-panel';

function createHost(
  kind: 'rightRail' | 'endscreen',
  cssText: string,
): { host: HTMLElement; root: HTMLElement } {
  const host = document.createElement('div');
  host.setAttribute(PANEL_ATTR, kind);
  // Reset the host's own box so YouTube's stylesheets (which target
  // ancestors) leak in as little as possible. The shadow root underneath
  // is fully isolated; this just keeps the host's outer layout sane.
  host.style.all = 'initial';
  host.style.display = 'block';
  host.style.boxSizing = 'border-box';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const root = document.createElement('div');
  shadow.appendChild(root);
  return { host, root };
}

export function mountRightRail(opts: MountOptions): MountHandle {
  const result = resolve(selectors.rightRail);
  if (!result) throw new SelectorMissError('rightRail');

  const slot = result.element as HTMLElement;
  const { host, root } = createHost('rightRail', opts.cssText);

  const originalDisplay = slot.style.display;
  slot.style.display = 'none';
  const parent = slot.parentElement;
  if (!parent) {
    slot.style.display = originalDisplay;
    throw new SelectorMissError('rightRail');
  }
  parent.insertBefore(host, slot);

  // Keep the panel visible while scrolling through comments. `position:
  // sticky` only sticks within its parent's box, so applying it to our
  // host alone fails — YouTube's right column (#secondary) is shorter
  // than the comments column on the left. Apply sticky to #secondary
  // itself instead: its parent is ytd-watch-flexy, which spans the full
  // page height, so the whole right column (and our panel inside it)
  // stays pinned as the user scrolls. 72px = masthead (~56px) + gap.
  const secondary = host.closest<HTMLElement>('#secondary');
  const stickyCleanup = secondary ? applySticky(secondary) : null;

  return {
    root,
    strategyIndex: result.strategyIndex,
    unmount: () => {
      stickyCleanup?.();
      host.remove();
      slot.style.display = originalDisplay;
    },
  };
}

interface StickyCleanup {
  (): void;
}

function applySticky(el: HTMLElement): StickyCleanup {
  const prev = {
    position: el.style.position,
    top: el.style.top,
    alignSelf: el.style.alignSelf,
  };
  el.style.position = 'sticky';
  el.style.top = '72px';
  el.style.alignSelf = 'flex-start';
  return () => {
    el.style.position = prev.position;
    el.style.top = prev.top;
    el.style.alignSelf = prev.alignSelf;
  };
}

export function mountEndscreen(opts: MountOptions): MountHandle {
  const result = resolve(selectors.endscreenContainer);
  if (!result) throw new SelectorMissError('endscreenContainer');

  const slot = result.element as HTMLElement;
  const { host, root } = createHost('endscreen', opts.cssText);

  // Cover the player area entirely — positioning lives on the host
  // element so the shadow root content can flow normally inside.
  host.style.position = 'absolute';
  host.style.inset = '0';
  host.style.zIndex = '60';
  host.style.pointerEvents = 'auto';

  const originalVisibility = slot.style.visibility;
  slot.style.visibility = 'hidden';

  const player = slot.closest<HTMLElement>('#movie_player, .html5-video-player');
  const hostParent = player ?? slot.parentElement;
  if (!hostParent) {
    slot.style.visibility = originalVisibility;
    throw new SelectorMissError('endscreenContainer');
  }
  hostParent.appendChild(host);

  return {
    root,
    strategyIndex: result.strategyIndex,
    unmount: () => {
      host.remove();
      slot.style.visibility = originalVisibility;
    },
  };
}
