// Structural fallbacks used when the named selectors in selectors.ts all
// miss. These describe *what an element looks like* (its role in the
// page structure) rather than *what it's called* (tag name / id).
//
// This is the ONLY other file allowed to contain YouTube-specific
// identifiers (alongside selectors.ts). CI enforces this with a grep.
// See docs/SELECTORS.md.

export function findRecommendationsRail(doc: Document): Element | null {
  // Strategy: the rail lives inside the watch-page wrapper and contains
  // many compact video tiles. Pick the candidate with the highest
  // (tile-count * height) score so we ignore tiny "Up next" headers
  // and prefer the actual list container.
  const player = doc.querySelector('#movie_player') ?? doc.querySelector('.html5-video-player');
  if (!player) return null;

  const wrapper =
    player.closest('ytd-watch-flexy') ??
    player.closest('ytd-page-manager') ??
    doc.querySelector('ytd-app');
  if (!wrapper) return null;

  let best: { el: Element; score: number } | null = null;
  for (const el of wrapper.querySelectorAll<HTMLElement>('*')) {
    const tiles = el.querySelectorAll(
      'ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-playlist-renderer',
    ).length;
    if (tiles < 3) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    const score = tiles * rect.height;
    if (!best || score > best.score) best = { el, score };
  }
  return best?.el ?? null;
}

// The player element wrapping a given <video>. Walks up to the stable
// player containers, falling back to the parent so callers always get a
// usable element. Kept here (not in triggers.ts) so the YouTube ids stay
// in the one file allowed to name them.
export function findPlayerForVideo(video: Element): HTMLElement | null {
  return (video.closest('#movie_player') ??
    video.closest('.html5-video-player') ??
    video.parentElement) as HTMLElement | null;
}

// True once the player has transitioned into its end-of-video state.
// YouTube toggles this class on the player element when playback ends
// (in both autoplay-on and autoplay-off flows); it is the reliable
// "the endscreen is now showing" signal, unlike the endscreen element's
// geometry, which is nonzero during normal playback too.
export function isPlayerEnded(player: Element): boolean {
  return player.classList.contains('ended-mode');
}

export function findEndscreenContainer(doc: Document): Element | null {
  // The endscreen is always inside the player.
  const player = doc.querySelector('#movie_player') ?? doc.querySelector('.html5-video-player');
  if (!player) return null;
  return (
    player.querySelector('.html5-endscreen') ??
    player.querySelector('.ytp-endscreen-content') ??
    player.querySelector('.ytp-ce-element')?.parentElement ??
    null
  );
}
