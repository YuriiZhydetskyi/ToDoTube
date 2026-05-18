// Surface-specific event triggers. Wraps DOM observation so `core/`
// stays free of YouTube-specific selectors.
//
// `onEndscreenReady(cb)` fires when the player approaches the end of
// the current video. Two triggers cover the common YouTube modes:
//   - the HTML5 video `ended` event (normal end-of-video)
//   - a MutationObserver on the player; YouTube sometimes inserts the
//     endscreen DOM *before* the `ended` event fires for autoplay flows

import { resolve } from './resolver';
import { selectors } from './selectors';

export interface EndscreenTrigger {
  /** Tear down all listeners. Safe to call multiple times. */
  dispose(): void;
}

export function onEndscreenReady(cb: () => void): EndscreenTrigger {
  const playerRes = resolve(selectors.videoPlayer);
  if (!playerRes) return { dispose: () => {} };
  const video = playerRes.element as HTMLVideoElement;

  let fired = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    cb();
  };

  const onEnded = (): void => fire();
  video.addEventListener('ended', onEnded);

  // YouTube re-inserts the endscreen overlay rather than toggling
  // visibility, so a MutationObserver is the more reliable trigger.
  const player = (video.closest('#movie_player') ??
    video.closest('.html5-video-player') ??
    video.parentElement) as HTMLElement | null;

  let observer: MutationObserver | undefined;
  if (player) {
    observer = new MutationObserver(() => {
      const endscreen = resolve(selectors.endscreenContainer);
      if (!endscreen) return;
      const rect = (endscreen.element as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) fire();
    });
    observer.observe(player, { childList: true, subtree: true });
  }

  return {
    dispose() {
      video.removeEventListener('ended', onEnded);
      observer?.disconnect();
    },
  };
}
