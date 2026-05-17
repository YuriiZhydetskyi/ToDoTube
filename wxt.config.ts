import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
//
// Layout note: WXT's default `srcDir` is the project root, so it looks
// for entrypoints in `<root>/entrypoints/`. We intentionally keep our
// internal modules under `src/` (separate from the WXT-conventional
// `entrypoints/`). Do not set `srcDir: 'src'` — that would move
// entrypoints to `src/entrypoints/` and break the layered layout.
export default defineConfig({
  manifest: {
    name: 'ToDoTube',
    description: 'Replace YouTube recommendations with your to-do list.',
    permissions: ['storage', 'identity', 'alarms'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://api.ticktick.com/*',
      'https://ticktick.com/*',
    ],
    // Stable Firefox add-on ID so `browser.identity.getRedirectURL()`
    // returns a stable URI we can register with TickTick.
    browser_specific_settings: {
      gecko: {
        id: 'todotube@todotube.app',
      },
    },
    // NOTE: For a stable Chrome extension ID (and therefore a stable OAuth
    // redirect URI), set `key` here once you have a packed extension's
    // public key. See README → "TickTick OAuth setup" for the procedure.
    // key: '<base64-encoded public key>',
  },
});
