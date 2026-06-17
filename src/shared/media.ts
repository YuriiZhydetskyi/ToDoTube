// DOM sensor for the gatekeeper's media-playback accrual path (the second
// "stopwatch"). Reports the dominant audible media element's playback position so
// the gatekeeper can accrue real listening time while the tab is INACTIVE — e.g. a
// YouTube video played as a podcast with the screen off. Pure read; never mutates
// the page. Sibling of active-tab.ts (the other DOM sensor) so the gatekeeper's two
// eligibility inputs live side by side in `shared`.
//
// Generic <video>/<audio> tags only — not YouTube-specific selectors — so it works
// on every blocked site and never trips the CI selector grep-guard.

export interface PlayingMedia {
  el: HTMLMediaElement;
  // Playback position in seconds (advances at playbackRate × real-time).
  currentTime: number;
  playbackRate: number;
}

// The audible media element to accrue against, or null if none. "Audible" means
// not muted and non-zero volume; a PAUSED element is still returned (its
// currentTime simply doesn't advance, so it accrues nothing) — this avoids having
// to track play/pause transitions. When several elements qualify (ads, multiple
// players, autoplay previews), the dominant one wins: longest finite duration,
// then furthest currentTime. So the main video beats a short ad/preview, while a
// lone live stream (Infinity/NaN duration) still resolves.
export function readPlayingMedia(): PlayingMedia | null {
  const audible = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].filter(
    (el) => !el.muted && el.volume > 0 && !el.ended,
  );
  if (audible.length === 0) return null;

  const rank = (el: HTMLMediaElement): number => (Number.isFinite(el.duration) ? el.duration : -1);
  const best = audible.reduce((a, b) => {
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
    return b.currentTime > a.currentTime ? b : a;
  });

  return { el: best, currentTime: best.currentTime, playbackRate: best.playbackRate };
}
