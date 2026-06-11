// Full-page block overlay surface. Unlike the watch-page panel adapters,
// this surface needs NO YouTube DOM knowledge — it attaches its own host
// to <html> and covers everything, so no YouTube selectors appear here.
//
// It also pauses any playing <video> while mounted (a standard HTML tag,
// not a YouTube-specific identifier) so audio doesn't keep going behind the
// overlay. The caller owns the rendered content via the returned `root`.

const OVERLAY_ATTR = 'data-todotube-block';
const MAX_Z_INDEX = '2147483647';

export interface OverlayHandle {
  readonly root: HTMLElement;
  unmount: () => void;
}

export function mountBlockOverlay(opts: { cssText: string }): OverlayHandle {
  const host = document.createElement('div');
  host.setAttribute(OVERLAY_ATTR, '');
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = MAX_Z_INDEX;

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = opts.cssText;
  shadow.appendChild(style);
  const root = document.createElement('div');
  shadow.appendChild(root);

  document.documentElement.appendChild(host);

  // Freeze background scroll while blocked.
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const stopPausing = enforceVideoPaused();

  return {
    root,
    unmount: () => {
      stopPausing();
      document.documentElement.style.overflow = prevOverflow;
      host.remove();
    },
  };
}

// Pause every <video> now and keep pausing any that tries to resume while
// the overlay is up. Returns a cleanup that stops enforcing (it does not
// auto-resume — the user's own interaction decides playback afterwards).
function enforceVideoPaused(): () => void {
  const pauseAll = (): void => {
    for (const video of document.querySelectorAll('video')) {
      if (!video.paused) video.pause();
    }
  };
  pauseAll();
  document.addEventListener('play', pauseAll, { capture: true });
  return () => document.removeEventListener('play', pauseAll, { capture: true });
}
