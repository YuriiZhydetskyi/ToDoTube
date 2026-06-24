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

  it('resolves the bare apex of every non-YouTube blocked site', () => {
    // Pins `host === suffix` matching: a refactor to `host.endsWith(suffix)`
    // would happen to keep these passing, but the near-miss cases below pin
    // the dot boundary that such a refactor would break.
    expect(siteForHostname('tiktok.com')?.id).toBe('tiktok');
    expect(siteForHostname('tiktok.com')?.label).toBe('TikTok');
    expect(siteForHostname('facebook.com')?.id).toBe('facebook');
    expect(siteForHostname('facebook.com')?.label).toBe('Facebook');
    expect(siteForHostname('instagram.com')?.id).toBe('instagram');
    expect(siteForHostname('instagram.com')?.label).toBe('Instagram');
    expect(siteForHostname('threads.net')?.id).toBe('threads');
    expect(siteForHostname('threads.com')?.id).toBe('threads');
    expect(siteForHostname('x.com')?.id).toBe('x');
  });

  it('excludes music.youtube.com so YouTube Music stays usable', () => {
    expect(siteForHostname('music.youtube.com')).toBeNull();
    // The exclude is honoured before the suffix match, and it is case-folded.
    expect(siteForHostname('MUSIC.YouTube.com')).toBeNull();
    // A deeper subdomain under the excluded host stays excluded.
    expect(siteForHostname('foo.music.youtube.com')).toBeNull();
    // But other YouTube subdomains still resolve to YouTube.
    expect(siteForHostname('studio.youtube.com')?.id).toBe('youtube');
  });

  it('excludes business.facebook.com so Meta Business Suite stays usable', () => {
    expect(siteForHostname('business.facebook.com')).toBeNull();
    // Same exclude-before-match + case-folding contract as YouTube Music.
    expect(siteForHostname('Business.Facebook.COM')).toBeNull();
    // A deeper subdomain under the excluded host stays excluded.
    expect(siteForHostname('foo.business.facebook.com')).toBeNull();
    // But plain Facebook (apex + other subdomains) is still blocked.
    expect(siteForHostname('facebook.com')?.id).toBe('facebook');
    expect(siteForHostname('web.facebook.com')?.id).toBe('facebook');
  });

  it('excludes eventsmanager.facebook.com so Meta Events Manager stays usable', () => {
    expect(siteForHostname('eventsmanager.facebook.com')).toBeNull();
    // Same exclude-before-match + case-folding contract as the others.
    expect(siteForHostname('EventsManager.Facebook.COM')).toBeNull();
    // A deeper subdomain under the excluded host stays excluded.
    expect(siteForHostname('foo.eventsmanager.facebook.com')).toBeNull();
    // But plain Facebook (apex + other subdomains) is still blocked.
    expect(siteForHostname('facebook.com')?.id).toBe('facebook');
  });

  it('returns null for hosts that only look like a blocked site', () => {
    expect(siteForHostname('notyoutube.com')).toBeNull();
    expect(siteForHostname('max.com')).toBeNull(); // must not match the bare "x.com" rule
    expect(siteForHostname('example.com')).toBeNull();
  });

  it('matches only on a dot boundary, never on a bare suffix substring', () => {
    // The contract is `host === suffix || host.endsWith('.' + suffix)`.
    // A naive `host.endsWith(suffix)` would WRONGLY match all of these.
    expect(siteForHostname('eviltiktok.com')).toBeNull();
    expect(siteForHostname('nottiktok.com')).toBeNull();
    expect(siteForHostname('myfacebook.com')).toBeNull();
    expect(siteForHostname('notinstagram.com')).toBeNull();
    expect(siteForHostname('fakethreads.net')).toBeNull();
    expect(siteForHostname('xx.com')).toBeNull(); // not "x.com"
  });

  it('returns null when a blocked suffix sits in the middle of the host', () => {
    // The blocked domain is a registrable apex only at the END of the host;
    // an attacker-controlled parent domain must not be treated as the site.
    expect(siteForHostname('tiktok.com.evil.com')).toBeNull();
    expect(siteForHostname('facebook.com.attacker.test')).toBeNull();
    expect(siteForHostname('x.com.evil.net')).toBeNull();
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

  it('carves out the per-site exclusions in the exclude patterns', () => {
    expect(BLOCKED_SITE_EXCLUDE_MATCHES).toEqual([
      '*://*.music.youtube.com/*',
      '*://*.business.facebook.com/*',
      '*://*.eventsmanager.facebook.com/*',
    ]);
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
