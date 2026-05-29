// Site-wide gating content script. Separate from youtube-watch.content.ts:
// that one drives the watch-page recommendation panel; this one enforces
// the "block YouTube until …" gate across the whole site.
//
// runAt 'document_start' so we can mount the block overlay before any video
// starts playing. All real work lives in core/gatekeeper/overlay-controller.

import { startGateOverlay } from '@/core/gatekeeper/overlay-controller';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_start',
  main(ctx) {
    startGateOverlay(ctx);
  },
});
