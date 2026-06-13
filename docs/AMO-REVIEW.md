# AMO Reviewer Notes

This document is a friendly cheat-sheet for whoever is reviewing
ToDoTube on addons.mozilla.org. It explains how to reproduce the build,
maps every requested permission to the exact file that uses it, and
points at the (very short) network audit.

## Source

- Repository: `<github-url>` (public, MIT).
- Submitted version is tagged in git as `v<version>` and the
  `package.json` `version` field matches the manifest version.
- Three-layer architecture (see [`SELECTORS.md`](SELECTORS.md) for the
  DOM resolver design): `surfaces/` knows the YouTube DOM, `providers/`
  knows the TickTick API, `core/` is the only layer that knows both
  exist. ESLint enforces the boundaries.

## Toolchain

- Node 20 LTS or newer (no native deps).
- pnpm 10.11.1 (pinned in `package.json` via `packageManager`).
- No global tooling required.
- `playwright-core` and `tsx` are **dev-only** dependencies used solely by
  `scripts/capture-fixtures.ts` to record DOM regression fixtures (see
  `docs/SELECTORS.md`). They are never imported by `src/`, never part of the
  build, and ship nothing into the bundle. `playwright-core` downloads no
  browser; the script drives the developer's own local Chrome.

## Build steps

The build is fully reproducible from a clean clone:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# AMO reviewer note: real OAuth values are not required for code review.
# These placeholders allow the build to complete; OAuth flow is not
# exercised by the build itself.
printf 'WXT_TT_CLIENT_ID=review-placeholder\nWXT_TT_CLIENT_SECRET=review-placeholder\n' >> .env

pnpm build:firefox
```

Output: `.output/firefox-mv3/` (unpacked extension).

To produce the same zip artifact as the one submitted to AMO:

```bash
pnpm exec wxt zip -b firefox
# → .output/todotube-<version>-firefox.zip
```

## What is deliberately not byte-reproducible

The shipped bundle embeds public-client OAuth values
(`WXT_TT_CLIENT_ID`, `WXT_TT_CLIENT_SECRET`). Per `REQUIREMENTS.md §13`
and the README's _"Public-client note"_, these are not real secrets:
TickTick does not document PKCE support, so the classic
`client_secret` OAuth flow is required and the value must ship inside
the extension to work. Extracting these values from the submitted zip
is expected and harmless — anyone holding them still needs the
end user's own TickTick consent before any request will succeed.

## Permission map

Every manifest permission has exactly one runtime call site:

| Permission | Used by                                                                                      | Purpose                                                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`  | `src/shared/storage.ts` (entire file is the storage wrapper)                                 | Persist OAuth tokens, active list ID, UI preferences, and per-device usage intervals. Everything is `browser.storage.local` **except** the synced budget when the user turns on multi-device sync in `browser` mode, which uses `browser.storage.sync` (see `docs/SYNC.md`). |
| `alarms`   | `src/core/background/refresh.ts:13-21` (`browser.alarms.{clear,create,onAlarm.addListener}`) | Periodic task refresh on the user-configured interval.                                                                                                                                                                                                                       |

There is **no `identity` permission** (Firefox for Android doesn't implement
the API). TickTick OAuth instead opens the consent page in a regular tab
(`tabs.create`) and a background `tabs.onUpdated` listener reads **only the
tab's URL** to capture the `?code=` redirect — never page content. The
**`tabs` permission is not requested either**: URL visibility in
`tabs.onUpdated` comes from the existing `https://ticktick.com/*` host
permission, so the extension can see navigation URLs solely on ticktick.com.
The redirect target (`https://ticktick.com/todotube-oauth-callback`, a
first-party 404 page) means the single-use authorization code briefly
transits a normal tab URL (and thus browser history); it is exchanged
immediately and the tab is auto-closed. See `src/providers/ticktick/oauth.ts`.

Host permissions:

The blockable-site hosts are single-sourced in `src/shared/blocklist.ts`
(the build reads them into both the content-script `matches` and these
`host_permissions`). They are used **only** to inject a full-page block
overlay (DOM manipulation) when the user has enabled blocking for that site
in Focus mode — **no site API is called and nothing is read off the page**.
The gating content script (`entrypoints/blocked-sites.content.ts`) does not
`fetch` anything (see the network audit below).

| Host                                         | Used by                                                                                                                                                  | Purpose                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*://*.youtube.com/*`                        | `src/surfaces/desktop-watch/` (panel) + `entrypoints/blocked-sites.content.ts` (gate)                                                                    | Inject the task panel onto YouTube watch pages, and the block overlay when YouTube is gated. No YouTube API is called. `music.youtube.com` is excluded from gating. |
| `*://*.tiktok.com/*`                         | `entrypoints/blocked-sites.content.ts` (gate)                                                                                                            | Inject the block overlay when TikTok is gated. No API call, no page reads.                                                                                          |
| `*://*.facebook.com/*`                       | `entrypoints/blocked-sites.content.ts` (gate)                                                                                                            | Inject the block overlay when Facebook is gated. No API call, no page reads.                                                                                        |
| `*://*.threads.net/*`, `*://*.threads.com/*` | `entrypoints/blocked-sites.content.ts` (gate)                                                                                                            | Inject the block overlay when Threads is gated. No API call, no page reads.                                                                                         |
| `*://*.x.com/*`                              | `entrypoints/blocked-sites.content.ts` (gate)                                                                                                            | Inject the block overlay when X is gated. No API call, no page reads.                                                                                               |
| `*://*.instagram.com/*`                      | `entrypoints/blocked-sites.content.ts` (gate)                                                                                                            | Inject the block overlay when Instagram is gated. No API call, no page reads.                                                                                       |
| `https://api.ticktick.com/*`                 | `src/providers/ticktick/api.ts:83` — single `fetch` against `API_BASE + path`                                                                            | Read tasks and mark them complete via TickTick's Open API.                                                                                                          |
| `https://ticktick.com/*`                     | `src/providers/ticktick/oauth.ts` — single `fetch` against `TOKEN_URL`, plus the OAuth redirect capture (tab **URL only**, see the note above the table) | OAuth consent flow (open tab, capture `?code=` from the tab URL, close tab) and token exchange/refresh.                                                             |

### Optional host permissions (requested at runtime, never on install)

Declared as `optional_host_permissions` and requested only from the options page
on a user gesture, when the matching feature is turned on:

| Optional host             | Requested when                                             | Purpose                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://127.0.0.1:8765/*` | Anki budget gate enabled                                   | Read Anki study minutes from a locally-running AnkiConnect. Local only.                                                                                                                                                                             |
| `http://127.0.0.1:8930/*` | Activity budget gate enabled                               | Read a metric from the locally-running activity bridge. Local only.                                                                                                                                                                                 |
| `https://*/*`             | Multi-device sync set to `supabase`/`cloudflare`/`upstash` | Read/write the synced budget against the **user's own** backend. We request only the single origin the user typed in (never the whole pattern), and nothing is sent until the user opts in with their endpoint. See `docs/SYNC.md` and `backends/`. |

## Network audit

Run this from the repo root:

```bash
rg -n 'fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon' src/
```

Expected `fetch(` call sites, and nothing else (zero `XMLHttpRequest`, zero
`WebSocket`, zero `sendBeacon`):

- `src/providers/ticktick/` — the two TickTick hosts above (always).
- `src/signals/anki/`, `src/signals/http/` — the two local `127.0.0.1`
  endpoints, reached only when the matching Focus-mode gate is enabled.
- `src/core/sync/http-transport.ts` and `src/core/sync/upstash-transport.ts` —
  the **user-configured** sync backend, reached only when multi-device sync is
  set to `supabase`/`cloudflare` (http-transport) or `upstash`
  (upstash-transport). The destination is whatever URL the user entered;
  ToDoTube ships no default endpoint and runs no server of its own.

No other network primitives are reachable from the compiled bundle.

## Storage audit

Run this from the repo root:

```bash
rg -n "storage\.(local|sync|session|managed)\." src/
```

You should see `storage.local` and `storage.session` reads/writes, and
`storage.sync` **only** in the sync layer (`src/core/sync/` +
`src/shared/storage.ts`), used solely for the synced budget when the user turns
on multi-device sync in `browser` mode (off by default). No `storage.managed`.
Detailed schema is in `src/shared/types.ts` (search for `Settings`,
`ProviderState`, `OAuthTokens`, `SyncSettings`) and `docs/SYNC.md`.

## Privacy

Full privacy policy: [`PRIVACY.md`](../PRIVACY.md) at the repo root.
Short version: zero telemetry, no analytics, no third-party calls
beyond the two listed above.

## Manifest declaration

`browser_specific_settings.gecko.data_collection_permissions` is set
to `{ required: ['none'] }` in [`wxt.config.ts`](../wxt.config.ts),
correctly declaring zero data collection under the Mozilla
Add-on Policies (effective 2025-11-03).

## Reproducible build verification

Compare the freshly built `.output/firefox-mv3/manifest.json` against
the manifest inside the submitted zip — they should match. The
JavaScript bundles will differ in trivial ways (timestamps, hash
suffixes in chunk file names), but their behavior is identical.

If anything in this document is contradicted by the code, the code is
the source of truth; please open a GitHub issue or email
<zhidetskij@gmail.com>.
