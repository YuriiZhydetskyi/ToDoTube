import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Single-sourced from the gating blocklist so the manifest host permissions
// and the content-script `matches` can never drift (see src/shared/blocklist).
import { BLOCKED_SITE_MATCHES } from './src/shared/blocklist';

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
    // Blockable sites (YouTube, TikTok, Facebook, Threads, X, Instagram) come
    // from the single-sourced blocklist; TickTick's API hosts are appended.
    host_permissions: [
      ...BLOCKED_SITE_MATCHES,
      'https://api.ticktick.com/*',
      'https://ticktick.com/*',
    ],
    // Local HTTP servers reached only when the matching Focus-mode gate is
    // enabled, so these are OPTIONAL host permissions requested from the
    // options page (a user gesture) when the gate is turned on. The literals
    // mirror ANKI_HOST_PERMISSION (signals/anki/constants.ts) and
    // BRIDGE_HOST_PERMISSION (gates/activity-budget/constants.ts). See
    // docs/GATING.md.
    //   8765 = AnkiConnect · 8930 = activity bridge (e.g. Garmin)
    optional_host_permissions: ['http://127.0.0.1:8765/*', 'http://127.0.0.1:8930/*'],
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
