import { describe, expect, it } from 'vitest';

import {
  BLOCKED_SITE_EXCLUDE_MATCHES,
  BLOCKED_SITE_IDS,
  BLOCKED_SITE_MATCHES,
  siteForHostname,
} from './blocklist';

describe('siteForHostname', () => {
  it('resolves the apex and common subdomains of each blocked site', () => {
    expect(siteForHostname('youtube.com')?.id).toBe('youtube');
    expect(siteForHostname('www.youtube.com')?.id).toBe('youtube');
    expect(siteForHostname('m.youtube.com')?.id).toBe('youtube');
    expect(siteForHostname('www.tiktok.com')?.id).toBe('tiktok');
    expect(siteForHostname('web.facebook.com')?.id).toBe('facebook');
    expect(siteForHostname('threads.net')?.id).toBe('threads');
    expect(siteForHostname('www.threads.com')?.id).toBe('threads');
    expect(siteForHostname('x.com')?.id).toBe('x');
    expect(siteForHostname('www.instagram.com')?.id).toBe('instagram');
  });

  it('is case-insensitive', () => {
    expect(siteForHostname('WWW.YouTube.COM')?.id).toBe('youtube');
  });

  it('excludes music.youtube.com so YouTube Music stays usable', () => {
    expect(siteForHostname('music.youtube.com')).toBeNull();
  });

  it('returns null for hosts that only look like a blocked site', () => {
    expect(siteForHostname('notyoutube.com')).toBeNull();
    expect(siteForHostname('max.com')).toBeNull(); // must not match the bare "x.com" rule
    expect(siteForHostname('example.com')).toBeNull();
  });
});

describe('match-pattern exports', () => {
  it('includes a pattern for every site and dedupes', () => {
    expect(BLOCKED_SITE_MATCHES).toContain('*://*.youtube.com/*');
    expect(BLOCKED_SITE_MATCHES).toContain('*://*.instagram.com/*');
    // Threads spans two domains.
    expect(BLOCKED_SITE_MATCHES).toContain('*://*.threads.net/*');
    expect(BLOCKED_SITE_MATCHES).toContain('*://*.threads.com/*');
    expect(new Set(BLOCKED_SITE_MATCHES).size).toBe(BLOCKED_SITE_MATCHES.length);
  });

  it('carves out YouTube Music in the exclude patterns', () => {
    expect(BLOCKED_SITE_EXCLUDE_MATCHES).toEqual(['*://music.youtube.com/*']);
  });

  it('exposes one id per known site', () => {
    expect(BLOCKED_SITE_IDS).toEqual([
      'youtube',
      'tiktok',
      'facebook',
      'threads',
      'x',
      'instagram',
    ]);
  });
});
