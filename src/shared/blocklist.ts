// Single source of truth for the set of sites the gating subsystem can block.
// This is the ONLY place blocked-site domain literals may appear — a CI guard
// forbids them elsewhere (mirrors the selectors.ts "no magic constants"
// convention). Pure data + pure helpers, so it lives in `shared` (a leaf
// importable by every layer, including wxt.config.ts at build time).
//
// `matches`/`excludeMatches` are WebExtension match patterns, consumed at
// build time by both the content-script entrypoint (its `matches`) and the
// manifest's `host_permissions` (wxt.config.ts). `hostSuffixes` drives the
// runtime hostname → site resolution the overlay controller uses to learn
// which site (if any) the current tab belongs to.

export interface BlockedSiteDef {
  // Stable kebab id; persisted in Settings.gating.blockedSiteIds.
  id: string;
  // Human label for the settings checkbox list.
  label: string;
  // Content-script + host-permission match patterns (a site may span domains,
  // e.g. Threads on .net and .com).
  matches: string[];
  // Patterns carved out of `matches` so they stay usable (e.g. YouTube Music).
  excludeMatches?: string[];
  // Hostname suffixes that belong to this site, for runtime resolution.
  // A host matches a suffix when it equals it or ends with "." + suffix
  // (so www./m. subdomains match). Excludes below are honoured first.
  hostSuffixes: string[];
  // The runtime mirror of excludeMatches: hosts that look like this site but
  // must NOT be blocked (e.g. music.youtube.com).
  excludeHostSuffixes?: string[];
}

export const BLOCKED_SITES: readonly BlockedSiteDef[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    matches: ['*://*.youtube.com/*'],
    excludeMatches: ['*://music.youtube.com/*'],
    hostSuffixes: ['youtube.com'],
    excludeHostSuffixes: ['music.youtube.com'],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    matches: ['*://*.tiktok.com/*'],
    hostSuffixes: ['tiktok.com'],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    matches: ['*://*.facebook.com/*'],
    hostSuffixes: ['facebook.com'],
  },
  {
    id: 'threads',
    label: 'Threads',
    matches: ['*://*.threads.net/*', '*://*.threads.com/*'],
    hostSuffixes: ['threads.net', 'threads.com'],
  },
  {
    id: 'x',
    label: 'X (Twitter)',
    matches: ['*://*.x.com/*'],
    hostSuffixes: ['x.com'],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    matches: ['*://*.instagram.com/*'],
    hostSuffixes: ['instagram.com'],
  },
];

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

// All blocked-site ids, in declaration order. The default for
// Settings.gating.blockedSiteIds — every known site starts blockable.
export const BLOCKED_SITE_IDS: string[] = BLOCKED_SITES.map((s) => s.id);

// Union of every site's match patterns, for the content-script `matches`
// array and the manifest host_permissions.
export const BLOCKED_SITE_MATCHES: string[] = dedupe(BLOCKED_SITES.flatMap((s) => s.matches));

// Union of every site's carve-outs, for the content-script `excludeMatches`.
export const BLOCKED_SITE_EXCLUDE_MATCHES: string[] = dedupe(
  BLOCKED_SITES.flatMap((s) => s.excludeMatches ?? []),
);

// Does `host` equal `suffix` or sit under it as a subdomain?
function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

// Resolve the blocked-site definition for a hostname, or null when the host
// belongs to no blockable site (or is an explicitly excluded host like
// music.youtube.com). Excludes win over matches.
export function siteForHostname(hostname: string): BlockedSiteDef | null {
  const host = hostname.toLowerCase();
  for (const site of BLOCKED_SITES) {
    if (site.excludeHostSuffixes?.some((s) => hostMatches(host, s))) continue;
    if (site.hostSuffixes.some((s) => hostMatches(host, s))) return site;
  }
  return null;
}
