// Content script entrypoint. Loads on every YouTube page (not just
// /watch) because YouTube's SPA navigates between pages without a full
// reload — if we matched only /watch, the script wouldn't be present
// when the user navigates *into* a watch page from the home feed.
//
// All real work happens in `core/lifecycle.start(ctx)`. This file is
// pure glue.

import { start } from '@/core/lifecycle';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    start(ctx);
  },
});
