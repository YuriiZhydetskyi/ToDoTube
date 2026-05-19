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
  // We collect zero data (see REQUIREMENTS.md §8). The Firefox-MV3
  // `data_collection_permissions` manifest declaration lands in Step 12
  // alongside the rest of the release-prep metadata.
  suppressWarnings: {
    firefoxDataCollection: true,
  },
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
