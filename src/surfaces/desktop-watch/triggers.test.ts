// @vitest-environment jsdom
//
// No YouTube literals here (CI selector guard): the navigation event name
// is imported from selectors.ts and the endscreen tests build their DOM
// from plain <video> elements.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAVIGATE_FINISH_EVENT } from './selectors';
import { onEndscreenReady, onNavigate } from './triggers';

afterEach(() => {
  document.body.replaceChildren();
});

describe('onNavigate', () => {
  it('fires on every navigation event until disposed', () => {
    const cb = vi.fn();
    const trigger = onNavigate(cb);

    window.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
    window.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
    expect(cb).toHaveBeenCalledTimes(2);

    trigger.dispose();
    window.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('onEndscreenReady', () => {
  it('returns null when the video element is not in the DOM yet', () => {
    expect(onEndscreenReady(() => {})).toBeNull();
  });

  it('fires at most once per instance on video `ended`', () => {
    const video = document.createElement('video');
    document.body.appendChild(video);

    const cb = vi.fn();
    const trigger = onEndscreenReady(cb);
    expect(trigger).not.toBeNull();

    video.dispatchEvent(new Event('ended'));
    video.dispatchEvent(new Event('ended'));
    expect(cb).toHaveBeenCalledTimes(1);

    trigger?.dispose();
  });

  it('a freshly armed trigger fires again after the spent one is disposed', () => {
    const video = document.createElement('video');
    document.body.appendChild(video);

    const first = vi.fn();
    const spent = onEndscreenReady(first);
    expect(spent).not.toBeNull();
    video.dispatchEvent(new Event('ended'));
    expect(first).toHaveBeenCalledTimes(1);
    spent?.dispose();

    const second = vi.fn();
    const fresh = onEndscreenReady(second);
    expect(fresh).not.toBeNull();
    video.dispatchEvent(new Event('ended'));
    expect(second).toHaveBeenCalledTimes(1);
    fresh?.dispose();
  });

  it('dispose() detaches the `ended` listener', () => {
    const video = document.createElement('video');
    document.body.appendChild(video);

    const cb = vi.fn();
    const trigger = onEndscreenReady(cb);
    trigger?.dispose();

    video.dispatchEvent(new Event('ended'));
    expect(cb).not.toHaveBeenCalled();
  });
});

// The player-class signal: the trigger must fire when the player
// transitions into its ended state, and must NOT fire on unrelated class
// changes during playback or on the initial (already-ended) state.
describe('onEndscreenReady — player class transition', () => {
  // The class the production predicate (isPlayerEnded) keys on. Kept here
  // in the test only; building YouTube-shaped DOM mirrors heuristics.test.ts.
  const ENDED_CLASS = 'ended-mode';

  function buildPlayer(): { player: HTMLElement; video: HTMLVideoElement } {
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.className = 'html5-video-player';
    const video = document.createElement('video');
    video.className = 'html5-main-video';
    player.appendChild(video);
    document.body.appendChild(player);
    return { player, video };
  }

  it('fires once when the player gains the ended class', async () => {
    const { player } = buildPlayer();
    const cb = vi.fn();
    const trigger = onEndscreenReady(cb);
    expect(trigger).not.toBeNull();

    player.classList.add(ENDED_CLASS);
    await Promise.resolve(); // let the MutationObserver flush
    expect(cb).toHaveBeenCalledTimes(1);

    // A further class churn must not fire again (once-per-instance guard).
    player.classList.add('some-other-mode');
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);

    trigger?.dispose();
  });

  it('does NOT fire on class changes that are not the ended state (playback)', async () => {
    const { player } = buildPlayer();
    const cb = vi.fn();
    const trigger = onEndscreenReady(cb);

    player.classList.add('playing-mode');
    player.classList.add('ytp-autohide');
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    trigger?.dispose();
  });

  it('does NOT fire on arm when the player is already ended', async () => {
    const { player } = buildPlayer();
    player.classList.add(ENDED_CLASS);

    const cb = vi.fn();
    const trigger = onEndscreenReady(cb);
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    trigger?.dispose();
  });

  it('does NOT re-fire on unrelated class churn while the player stays ended', async () => {
    // The close→re-arm scenario: the player is still ended when a fresh
    // trigger is armed, and YouTube then toggles autohide as the cursor
    // enters/leaves the player. Only a false→true transition may fire.
    const { player } = buildPlayer();
    player.classList.add(ENDED_CLASS);

    const cb = vi.fn();
    const trigger = onEndscreenReady(cb);

    player.classList.add('ytp-autohide');
    await Promise.resolve();
    player.classList.remove('ytp-autohide');
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    // Leaving ended (replay) and re-ending IS a transition — fires.
    player.classList.remove(ENDED_CLASS);
    await Promise.resolve();
    player.classList.add(ENDED_CLASS);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);

    trigger?.dispose();
  });
});
