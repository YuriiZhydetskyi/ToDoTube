// Surface-specific event triggers. Wraps DOM observation so `core/`
// stays free of YouTube-specific selectors.
//
// `onNavigate(cb)` fires on YouTube's own SPA navigation-complete event —
// faster and more deterministic than polling the URL.
//
// `onEndscreenReady(cb)` fires when the current video reaches its end.
// Two transition signals cover the common YouTube modes:
//   - the HTML5 video `ended` event (normal end-of-video)
//   - a MutationObserver on the player's `class` attribute that fires
//     only on the false→true TRANSITION of the player's ended state
//     (covers autoplay flows where the class flips before the media
//     `ended` event)
// The class path latches the previous state because YouTube churns the
// player's class list constantly (e.g. autohide toggles on every cursor
// enter/leave) — checking *current* state on each mutation would re-fire
// while the player merely stays ended. Re-arming while already ended is
// therefore safe (the latch starts true; no churn can fire it). It fires
// at most once per instance; the lifecycle re-arms a fresh trigger on
// every navigation and when the endscreen overlay is closed. Returns null
// when the video element isn't in the DOM yet so the caller can retry.

import { findPlayerForVideo, isPlayerEnded } from './heuristics';
import { resolve } from './resolver';
import { NAVIGATE_FINISH_EVENT, selectors } from './selectors';

export interface NavigationTrigger {
  /** Tear down the listener. Safe to call multiple times. */
  dispose(): void;
}

export function onNavigate(cb: () => void): NavigationTrigger {
  window.addEventListener(NAVIGATE_FINISH_EVENT, cb);
  return { dispose: () => window.removeEventListener(NAVIGATE_FINISH_EVENT, cb) };
}

export interface EndscreenTrigger {
  /** Tear down all listeners. Safe to call multiple times. */
  dispose(): void;
}

export function onEndscreenReady(cb: () => void): EndscreenTrigger | null {
  const playerRes = resolve(selectors.videoPlayer);
  if (!playerRes) return null;
  const video = playerRes.element as HTMLVideoElement;

  let fired = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    cb();
  };

  const onEnded = (): void => fire();
  video.addEventListener('ended', onEnded);

  // Watch the player's class for the TRANSITION into ended state. The
  // latch is essential: YouTube mutates the class list for unrelated
  // reasons (autohide on cursor leave, mode toggles), and the player can
  // already be ended when we arm (close → re-arm) — in both cases the
  // current-state check alone would fire spuriously.
  const player = findPlayerForVideo(video);

  let observer: MutationObserver | undefined;
  if (player) {
    let wasEnded = isPlayerEnded(player);
    observer = new MutationObserver(() => {
      const ended = isPlayerEnded(player);
      if (ended && !wasEnded) fire();
      wasEnded = ended;
    });
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  return {
    dispose() {
      video.removeEventListener('ended', onEnded);
      observer?.disconnect();
    },
  };
}
