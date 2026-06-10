// Site-wide gating content script. Separate from youtube-watch.content.ts:
// that one drives the watch-page recommendation panel; this one enforces
// the "block until …" gate across every blockable site (see
// shared/blocklist.ts). The set of sites is single-sourced there, so the
// `matches` patterns and the manifest host_permissions can't drift.
//
// `excludeMatches` carves out hosts that must stay usable (e.g.
// music.youtube.com). runAt 'document_start' so we can mount the block
// overlay before any media starts playing. All real work lives in
// core/gatekeeper/overlay-controller; a tab whose site the user hasn't
// enabled simply idles there.

import { startGateOverlay } from '@/core/gatekeeper/overlay-controller';
import { BLOCKED_SITE_EXCLUDE_MATCHES, BLOCKED_SITE_MATCHES } from '@/shared/blocklist';

export default defineContentScript({
  matches: BLOCKED_SITE_MATCHES,
  excludeMatches: BLOCKED_SITE_EXCLUDE_MATCHES,
  runAt: 'document_start',
  main(ctx) {
    startGateOverlay(ctx);
  },
});
