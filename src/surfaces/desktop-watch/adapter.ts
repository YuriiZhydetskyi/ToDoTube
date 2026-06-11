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
import { RIGHT_COLUMN_SELECTOR, selectors, type AnchorName } from './selectors';

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
  /** Temporarily restore the hidden native slot (the host stays mounted,
   * so whatever is rendered into `root` sits directly above the slot). */
  reveal: () => void;
  /** Re-hide the native slot after a reveal(). */
  conceal: () => void;
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
  //
  // CASCADE TRAP: these inline declarations beat every normal `:host`
  // declaration in the shadow stylesheet (outer tree wins), and
  // `all: initial` covers every property except custom properties. So
  // `:host { ... }` rules in panel.css are dead for anything but `--tt-*`
  // variables — all real visuals (font, layout, the endscreen scrim) must
  // live on the `.tt-shell` element INSIDE the shadow root, where nothing
  // from the page can reach them.
  host.style.all = 'initial';
  host.style.display = 'block';
  host.style.boxSizing = 'border-box';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const shell = document.createElement('div');
  shell.className = 'tt-shell';
  shadow.appendChild(shell);

  const root = document.createElement('div');
  shell.appendChild(root);
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
  // host alone fails — YouTube's right column is shorter than the
  // comments column on the left. Apply sticky to the column itself
  // instead: its parent (the watch-page wrapper) spans the full page
  // height, so the whole right column (and our panel inside it) stays
  // pinned as the user scrolls. 72px = masthead (~56px) + gap.
  const secondary = host.closest<HTMLElement>(RIGHT_COLUMN_SELECTOR);
  const stickyCleanup = secondary ? applySticky(secondary) : null;

  return {
    root,
    strategyIndex: result.strategyIndex,
    unmount: () => {
      stickyCleanup?.();
      host.remove();
      slot.style.display = originalDisplay;
    },
    reveal: () => {
      slot.style.display = originalDisplay;
    },
    conceal: () => {
      slot.style.display = 'none';
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
  // element so the shadow root content can flow normally inside. High
  // z-index: the overlay must sit above every endscreen layer of the
  // player (incl. the newer grid UI); covering the player controls while
  // the overlay is up is intended — the X button is the way out.
  host.style.position = 'absolute';
  host.style.inset = '0';
  host.style.zIndex = '9999';
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
    // Implemented for interface symmetry; the lifecycle only peeks the rail.
    reveal: () => {
      slot.style.visibility = originalVisibility;
      host.style.display = 'none';
    },
    conceal: () => {
      slot.style.visibility = 'hidden';
      host.style.display = 'block';
    },
  };
}
