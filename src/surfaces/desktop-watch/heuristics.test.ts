// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { findEndscreenContainer, findRecommendationsRail } from './heuristics';

describe('findRecommendationsRail', () => {
  it('returns null when no player exists', () => {
    document.body.innerHTML = '<div></div>';
    expect(findRecommendationsRail(document)).toBeNull();
  });

  it('picks the candidate with the highest tile-count * height score', () => {
    document.body.innerHTML = `
      <ytd-watch-flexy>
        <div id="movie_player"></div>
        <div id="contains-3-tiny">
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
        </div>
        <div id="contains-many-large">
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
        </div>
      </ytd-watch-flexy>
    `;
    // Patch getBoundingClientRect so jsdom gives us heights.
    const small = document.getElementById('contains-3-tiny')!;
    const large = document.getElementById('contains-many-large')!;
    small.getBoundingClientRect = () => ({
      height: 100,
      width: 200,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => '',
    });
    large.getBoundingClientRect = () => ({
      height: 800,
      width: 400,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => '',
    });

    const result = findRecommendationsRail(document);
    expect(result?.id).toBe('contains-many-large');
  });

  it('returns null when no candidate has >= 3 tiles', () => {
    document.body.innerHTML = `
      <ytd-watch-flexy>
        <div id="movie_player"></div>
        <div id="only-two">
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
          <ytd-compact-video-renderer></ytd-compact-video-renderer>
        </div>
      </ytd-watch-flexy>
    `;
    expect(findRecommendationsRail(document)).toBeNull();
  });
});

describe('findEndscreenContainer', () => {
  it('returns null when no player exists', () => {
    document.body.innerHTML = '<div></div>';
    expect(findEndscreenContainer(document)).toBeNull();
  });

  it('finds .html5-endscreen inside the player', () => {
    document.body.innerHTML = `
      <div id="movie_player">
        <div class="html5-endscreen"></div>
      </div>
    `;
    const result = findEndscreenContainer(document);
    expect(result?.className).toBe('html5-endscreen');
  });

  it('falls back to .ytp-endscreen-content', () => {
    document.body.innerHTML = `
      <div id="movie_player">
        <div class="ytp-endscreen-content"></div>
      </div>
    `;
    const result = findEndscreenContainer(document);
    expect(result?.className).toBe('ytp-endscreen-content');
  });
});
