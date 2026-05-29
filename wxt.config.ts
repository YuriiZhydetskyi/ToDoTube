import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
//
// Layout note: with `srcDir: 'src'`, WXT looks for entrypoints in
// `src/entrypoints/` and hardcodes the `@` alias to point to `src/`,
// which is exactly what we want for `@/core/...`, `@/shared/...` etc.
// The layered architecture (surfaces / core / providers / ui / shared)
// lives at `src/<layer>/`.
export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // Firefox MV3 is opt-in in WXT 0.20 — explicit so both builds match.
  manifestVersion: 3,
  manifest: {
    name: 'ToDoTube',
    description: 'Replace YouTube recommendations with your to-do list.',
    permissions: ['storage', 'identity', 'alarms'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://api.ticktick.com/*',
      'https://ticktick.com/*',
    ],
    // AnkiConnect runs a local HTTP server. The Anki budget gate needs to
    // reach it, but only if the user enables that gate — so it's an
    // OPTIONAL host permission, requested from the options page (a user
    // gesture) when the gate is turned on. See docs/GATING.md.
    optional_host_permissions: ['http://127.0.0.1:8765/*'],
    // Stable Firefox add-on ID so `browser.identity.getRedirectURL()`
    // returns a stable URI we can register with TickTick.
    browser_specific_settings: {
      gecko: {
        id: 'todotube@todotube.app',
        // Firefox MV3 requires extensions to declare what data leaves the
        // user's device. ToDoTube transmits nothing — see PRIVACY.md.
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
    // NOTE: For a stable Chrome extension ID (and therefore a stable OAuth
    // redirect URI), set `key` here once you have a packed extension's
    // public key. See README → "TickTick OAuth setup" for the procedure.
    // key: '<base64-encoded public key>',
  },
});
