// Single source of truth for the set of sites the gating subsystem can block.
// This is the ONLY place blocked-site domain literals may appear — a CI guard
// forbids them elsewhere (mirrors the selectors.ts "no magic constants"
// convention). Pure data + pure helpers, so it lives in `shared` (a leaf
// importable by every layer, including wxt.config.ts at build time).
//
// A site is declared by its registrable `domains` (host suffixes) only. The
// WebExtension match patterns consumed at build time — by both the
// content-script entrypoint (its `matches`/`excludeMatches`) and the manifest's
// `host_permissions` (wxt.config.ts) — are DERIVED from those suffixes via
// `matchPatternFor` below, so each domain is written exactly once. The same
// suffixes drive the runtime hostname → site resolution the overlay controller
// uses to learn which site (if any) the current tab belongs to.

export interface BlockedSiteDef {
  // Stable kebab id; persisted in Settings.gating.blockedSiteIds.
  id: string;
  // Human label for the settings checkbox list.
  label: string;
  // Registrable domains (host suffixes) that ARE this site. A host matches a
  // suffix when it equals it or ends with "." + suffix (so www./m. subdomains
  // match). May span domains (e.g. Threads on .net and .com). Excludes below
  // are honoured first. Build-time match patterns are derived from these.
  domains: string[];
  // Host suffixes that look like this site but must NOT be blocked — they stay
  // usable (e.g. music.youtube.com, business.facebook.com). Carved out of both
  // the build-time match patterns and the runtime resolution.
  excludeDomains?: string[];
}

export const BLOCKED_SITES: readonly BlockedSiteDef[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    domains: ['youtube.com'],
    excludeDomains: ['music.youtube.com'],
  },
  { id: 'tiktok', label: 'TikTok', domains: ['tiktok.com'] },
  {
    id: 'facebook',
    label: 'Facebook',
    domains: ['facebook.com'],
    excludeDomains: ['business.facebook.com', 'eventsmanager.facebook.com'],
  },
  { id: 'threads', label: 'Threads', domains: ['threads.net', 'threads.com'] },
  { id: 'x', label: 'X (Twitter)', domains: ['x.com'] },
  { id: 'instagram', label: 'Instagram', domains: ['instagram.com'] },
];

// Derive a content-script/host-permission match pattern from a host suffix.
// `*.` matches the apex AND every subdomain, mirroring `hostMatches` below, so
// build-time and runtime agree on what a suffix covers.
const matchPatternFor = (suffix: string): string => `*://*.${suffix}/*`;

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

// All blocked-site ids, in declaration order. The default for
// Settings.gating.blockedSiteIds — every known site starts blockable.
export const BLOCKED_SITE_IDS: string[] = BLOCKED_SITES.map((s) => s.id);

// Union of every site's match patterns, for the content-script `matches`
// array and the manifest host_permissions. Derived from `domains`.
export const BLOCKED_SITE_MATCHES: string[] = dedupe(
  BLOCKED_SITES.flatMap((s) => s.domains.map(matchPatternFor)),
);

// Union of every site's carve-outs, for the content-script `excludeMatches`.
// Derived from `excludeDomains`.
export const BLOCKED_SITE_EXCLUDE_MATCHES: string[] = dedupe(
  BLOCKED_SITES.flatMap((s) => (s.excludeDomains ?? []).map(matchPatternFor)),
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
    if (site.excludeDomains?.some((d) => hostMatches(host, d))) continue;
    if (site.domains.some((d) => hostMatches(host, d))) return site;
  }
  return null;
}
