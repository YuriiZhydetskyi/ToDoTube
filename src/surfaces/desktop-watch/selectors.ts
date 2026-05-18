// Single source of truth for every YouTube identifier we depend on.
// YouTube reshuffles its DOM regularly — when it breaks us, this is the
// file (along with heuristics.ts) to update. See docs/SELECTORS.md.
//
// Each anchor declares an ordered list of strategies (most-specific
// first) and a `validate` self-test. The resolver in resolver.ts walks
// the list and returns the first strategy whose result passes validate.

import { findEndscreenContainer, findRecommendationsRail } from './heuristics';

export interface Anchor {
  readonly description: string;
  readonly strategies: ReadonlyArray<() => Element | null>;
  readonly validate: (el: Element) => boolean;
}

export const selectors = {
  rightRail: {
    description: 'The right-hand "Up next + recommendations" rail on the watch page.',
    strategies: [
      () => document.querySelector('ytd-watch-next-secondary-results-renderer'),
      () => document.querySelector('#secondary-inner #related'),
      () => document.querySelector('#secondary #related'),
      () => findRecommendationsRail(document),
    ],
    validate: (el): boolean => {
      // (1) Tag / role — either a known ytd-* renderer or one of the
      // stable ids that have wrapped the rail for years.
      const tag = el.tagName.toLowerCase();
      const looksLikeRenderer = tag.startsWith('ytd-');
      const looksLikeKnownId = el.id === 'related' || el.id === 'secondary';
      if (!looksLikeRenderer && !looksLikeKnownId) return false;

      // (2) Geometry — the rail is tall and column-shaped. Be generous;
      // the goal is to reject obviously-wrong elements, not to validate
      // pixel-perfect layout.
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.height < 100) return false;
      if (rect.width < 150 || rect.width > 800) return false;

      // (3) Parent shape — must be inside the watch-page wrapper.
      const wrapper = el.closest('ytd-watch-flexy, ytd-page-manager, #columns');
      return wrapper !== null;
    },
  },
  endscreenContainer: {
    description: 'The end-of-video recommendation grid (overlays the player).',
    strategies: [
      () => document.querySelector('.html5-endscreen.ytp-endscreen-content'),
      () => document.querySelector('#movie_player .html5-endscreen'),
      () => findEndscreenContainer(document),
    ],
    validate: (el): boolean => {
      // (1) Must live inside the player.
      const player = el.closest('#movie_player, .html5-video-player');
      if (!player) return false;

      // (2) Geometry — endscreen overlays the player, so at minimum it
      // has nonzero size when visible. We allow zero size (hidden state)
      // because we want to mount the overlay before the endscreen
      // becomes visible.
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width >= 0 && rect.height >= 0;
    },
  },
  videoPlayer: {
    description: 'The HTML5 video element. Used to listen for `ended`.',
    strategies: [
      () => document.querySelector('video.html5-main-video'),
      () => document.querySelector('#movie_player video'),
      () => document.querySelector('video'),
    ],
    validate: (el): boolean => el instanceof HTMLVideoElement,
  },
  pageRoot: {
    description: 'The watch-page top-level renderer (used to detect SPA-route changes).',
    strategies: [
      () => document.querySelector('ytd-watch-flexy'),
      () => document.querySelector('ytd-page-manager'),
    ],
    validate: (el): boolean => el.tagName.toLowerCase().startsWith('ytd-'),
  },
} as const satisfies Record<string, Anchor>;

export type AnchorName = keyof typeof selectors;
