// Adapter — knows how to mount our panel into specific spots on the
// YouTube watch page. The only API the rest of the codebase uses:
//
//   mountRightRail(panel)   -> MountHandle
//   mountEndscreen(panel)   -> MountHandle
//
// Each returns an `unmount()` for cleanup. Mount fails by throwing a
// typed SelectorMissError that core/lifecycle.ts catches and treats as
// "leave YouTube alone."

import { resolve } from './resolver';
import { selectors, type AnchorName } from './selectors';

export class SelectorMissError extends Error {
  constructor(public readonly anchor: AnchorName) {
    super(`ToDoTube: no working strategy for anchor "${anchor}"`);
    this.name = 'SelectorMissError';
  }
}

export interface MountHandle {
  unmount: () => void;
  readonly strategyIndex: number;
}

const PANEL_ATTR = 'data-todotube-panel';

export function mountRightRail(panel: HTMLElement): MountHandle {
  const result = resolve(selectors.rightRail);
  if (!result) throw new SelectorMissError('rightRail');

  const slot = result.element as HTMLElement;
  panel.setAttribute(PANEL_ATTR, 'rightRail');

  const originalDisplay = slot.style.display;
  slot.style.display = 'none';
  const parent = slot.parentElement;
  if (!parent) {
    slot.style.display = originalDisplay;
    throw new SelectorMissError('rightRail');
  }
  parent.insertBefore(panel, slot);

  return {
    strategyIndex: result.strategyIndex,
    unmount: () => {
      panel.remove();
      slot.style.display = originalDisplay;
    },
  };
}

export function mountEndscreen(panel: HTMLElement): MountHandle {
  const result = resolve(selectors.endscreenContainer);
  if (!result) throw new SelectorMissError('endscreenContainer');

  const slot = result.element as HTMLElement;
  panel.setAttribute(PANEL_ATTR, 'endscreen');

  // Cover the player area entirely with our panel.
  panel.style.position = 'absolute';
  panel.style.inset = '0';
  panel.style.zIndex = '60';
  panel.style.pointerEvents = 'auto';

  const originalVisibility = slot.style.visibility;
  slot.style.visibility = 'hidden';

  const player = slot.closest<HTMLElement>('#movie_player, .html5-video-player');
  const host = player ?? slot.parentElement;
  if (!host) {
    slot.style.visibility = originalVisibility;
    throw new SelectorMissError('endscreenContainer');
  }
  host.appendChild(panel);

  return {
    strategyIndex: result.strategyIndex,
    unmount: () => {
      panel.remove();
      slot.style.visibility = originalVisibility;
    },
  };
}
