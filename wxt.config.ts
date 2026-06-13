import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Single-sourced from the gating blocklist so the manifest host permissions
// and the content-script `matches` can never drift (see src/shared/blocklist).
import { BLOCKED_SITE_MATCHES } from './src/shared/blocklist';
// Optional-permission patterns, imported from their single source rather than
// inlined (the CI "no magic constants" guard only scans src/**, so a literal
// here would slip through — keep them honest by importing).
import { BRIDGE_HOST_PERMISSION } from './src/gates/activity-budget/constants';
import { ANKI_HOST_PERMISSION } from './src/signals/anki/constants';

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
    // No `identity`: Firefox Android lacks the API entirely, so TickTick
    // OAuth runs as a tab-based flow on every platform — the redirect is
    // captured via tabs.onUpdated, whose URL visibility comes from the
    // ticktick.com host permission below (the `tabs` permission is NOT
    // needed for that). See src/providers/ticktick/oauth.ts.
    permissions: ['storage', 'alarms'],
    // Blockable sites (YouTube, TikTok, Facebook, Threads, X, Instagram) come
    // from the single-sourced blocklist; TickTick's API hosts are appended.
    host_permissions: [
      ...BLOCKED_SITE_MATCHES,
      'https://api.ticktick.com/*',
      'https://ticktick.com/*',
    ],
    // Local HTTP servers reached only when the matching Focus-mode gate is
    // enabled, so these are OPTIONAL host permissions requested from the
    // options page (a user gesture) when the gate is turned on. Imported from
    // their single source (AnkiConnect / activity bridge); see docs/GATING.md.
    // `https://*/*` is requested at runtime (options page, user gesture) ONLY
    // when the user configures a self-hosted sync backend (Supabase / Cloudflare
    // Worker) — we then request the single origin they entered, never the whole
    // pattern. Sync is off by default and nothing is sent anywhere until the user
    // opts in with their own endpoint. See docs/SYNC.md and docs/AMO-REVIEW.md.
    optional_host_permissions: [ANKI_HOST_PERMISSION, BRIDGE_HOST_PERMISSION, 'https://*/*'],
    // Stable Firefox add-on ID — required for AMO signing/updates and for
    // `storage.sync` to address the same data across installs.
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
  },
});
