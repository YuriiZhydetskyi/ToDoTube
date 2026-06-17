// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { readPlayingMedia } from './media';

// jsdom has no playback engine, so define the media properties directly on each
// element to make the selection logic deterministic.
interface MediaProps {
  muted?: boolean;
  volume?: number;
  ended?: boolean;
  duration?: number;
  currentTime?: number;
  playbackRate?: number;
}

function makeMedia(tag: 'video' | 'audio', props: MediaProps = {}): HTMLMediaElement {
  const el = document.createElement(tag);
  const all = {
    muted: false,
    volume: 1,
    ended: false,
    duration: NaN,
    currentTime: 0,
    playbackRate: 1,
    ...props,
  };
  for (const [key, value] of Object.entries(all)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('readPlayingMedia', () => {
  it('returns null when there is no media element', () => {
    expect(readPlayingMedia()).toBeNull();
  });

  it('ignores muted, zero-volume, and ended elements', () => {
    makeMedia('video', { muted: true });
    makeMedia('video', { volume: 0 });
    makeMedia('audio', { ended: true });
    expect(readPlayingMedia()).toBeNull();
  });

  it('returns the audible element with its currentTime and playbackRate', () => {
    const el = makeMedia('video', { duration: 600, currentTime: 123, playbackRate: 2 });
    expect(readPlayingMedia()).toEqual({ el, currentTime: 123, playbackRate: 2 });
  });

  it('prefers the longest finite duration (main video over a short ad)', () => {
    makeMedia('video', { duration: 15, currentTime: 3 }); // ad
    const main = makeMedia('video', { duration: 3600, currentTime: 42 });
    expect(readPlayingMedia()?.el).toBe(main);
  });

  it('coerces a live/unknown duration below a finite one', () => {
    makeMedia('video', { duration: Infinity, currentTime: 10 }); // live
    const vod = makeMedia('video', { duration: 120, currentTime: 1 });
    expect(readPlayingMedia()?.el).toBe(vod);
  });

  it('falls back to furthest currentTime when durations tie', () => {
    makeMedia('audio', { duration: NaN, currentTime: 5 });
    const further = makeMedia('audio', { duration: NaN, currentTime: 50 });
    expect(readPlayingMedia()?.el).toBe(further);
  });
});
