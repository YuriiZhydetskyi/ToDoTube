# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ToDoTube is a Firefox + Chrome **Manifest V3 browser extension** (TypeScript + [WXT](https://wxt.dev), vanilla DOM, no UI framework) with two orthogonal features: (1) replace YouTube's recommendation rail / end-screen with your TickTick to-do list, and (2) optional **Focus mode** — block a configurable set of time-sink sites until you earn time back.

## Commands

```bash
pnpm dev                 # run in a fresh Chrome window (WXT) with the unpacked extension
pnpm dev:firefox         # same, Firefox
pnpm build               # production Chrome MV3 -> .output/chrome-mv3
pnpm build:firefox       # production Firefox MV3 -> .output/firefox-mv3
pnpm compile             # wxt prepare && tsc --noEmit  (this is the type-check)
pnpm test                # vitest run (whole suite)
pnpm exec vitest run src/shared/blocklist.test.ts   # run ONE test file
pnpm exec vitest run -t 'siteForHostname'           # run tests matching a name
pnpm test:watch          # vitest watch mode
pnpm lint                # eslint . && prettier --check .   (CI runs this)
pnpm format              # prettier --write .
```

CI (`.github/workflows/ci.yml`) runs, in order: `compile`, `lint`, `test`, the **grep guards** (see below), then both browser builds. A change that passes locally but adds a magic constant will fail the guards — run them mentally before pushing.

Tests use Vitest with `WxtVitest()` (gives `@/*` alias + `fakeBrowser` so `browser.storage.local` etc. work). Default environment is **node**; a test that needs the DOM opts in with a `// @vitest-environment jsdom` directive at the top of the file (surface/resolver tests do this).

## Architecture: layers + enforced import boundaries

The codebase is organized into layers under `src/`, and the allowed import edges are **hard-enforced by `eslint-plugin-boundaries`** (`eslint.config.js`, `default: 'disallow'` — every cross-layer edge must be explicitly allowed). Violations fail `pnpm lint`. The rules:

| Layer (`src/…`) | May import from             | Role                                                                                                       |
| --------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `shared/`       | `shared` only (it's a leaf) | Cross-layer DTOs, the typed message bus, the storage wrapper, pure helpers                                 |
| `providers/`    | `providers`, `shared`       | Task data sources (TickTick). Knows the task API, never the DOM                                            |
| `signals/`      | `signals`, `shared`         | Read-only sensors for Focus mode (Anki, generic HTTP)                                                      |
| `gates/`        | `gates`, `shared`           | Focus-mode access policies. Pure; gets signal **values** via a `shared` DTO, so no edge to `signals`       |
| `surfaces/`     | `surfaces`, `shared`        | Knows the YouTube DOM. No task logic                                                                       |
| `ui/`           | `ui`, `shared`              | Vanilla-DOM rendering. **Stays gate/provider-agnostic** — receives gate/provider lists as args from `core` |
| `core/`         | everything above            | The only orchestrator layer that knows the others exist                                                    |
| `entrypoints/`  | `entry`, `shared`, `core`   | WXT entry files; delegate immediately into `core/`                                                         |

Practical consequence: when you need data to cross layers (e.g. a gate decision reaching a content script), put the DTO in `src/shared/types.ts` and route it through `core/`. Don't reach sideways. `ui/` and `entrypoints/` must never import `gates/`, `signals/`, or `providers/` directly.

**Background is the single source of truth.** Popup, options, and content scripts never read provider/gate state from storage to make decisions — they ask the background via the typed message bus (`src/shared/messaging.ts`; `sendToBackground`/`onBroadcast`). Every message has one `(req, res)` entry in the `Schema` map and one `case` in `src/core/background/handlers.ts`. Storage access goes through the typed wrapper `src/shared/storage.ts` (so call sites never touch raw keys/fallbacks). MV3 service workers are killed/restarted at will, so background code must be idempotent and rehydrate from storage on wake.

## The "no magic constants" rule (CI-enforced)

External-system identifiers live in **exactly one file each**, and CI grep guards fail the build if they leak elsewhere. When adding/using one of these, import from its single source — never inline the literal:

- **YouTube DOM selectors** (`ytd-*`, `yt-navigate-finish`, `#secondary`, `#related`) → `src/surfaces/desktop-watch/selectors.ts` (+ `heuristics.ts`). See `docs/SELECTORS.md` for the multi-strategy resolver and user override mechanism.
- **Blocked-site domains** (tiktok/facebook/instagram/threads/x .com, etc.) → `src/shared/blocklist.ts`. `wxt.config.ts` host*permissions and the content-script `matches` both import from here (WXT's vite-node loader allows imported constants in `matches`). `youtube.com` is intentionally \_not* guarded — it predates the list and is also used by the recommendation surface.
- **AnkiConnect endpoint** (`127.0.0.1:8765`, actions, version) → `src/signals/anki/constants.ts`.
- **Activity-bridge endpoint** (`127.0.0.1:8930`, JSON field names) → `src/gates/activity-budget/constants.ts`.

## Focus mode (gating) — the second feature

Optional; orthogonal to the recommendation panel. Full design in `docs/GATING.md`. Mental model — a **time ledger**: access is allowed while `earned − spent > 0`.

- `signals/` produce a measured value (`durationMs` | `count`). `gates/` are access policies that consume a `GateContext` (signal values + config/state + `spentTodayMs`) and return a `GateDecision`. Add a gate the same way you add a provider: a folder + one line in `gates/registry.ts`. Gate config fields are declared as a schema and rendered generically by the options page.
- `core/gatekeeper/` orchestrates the decision; `surfaces/youtube-site/overlay.ts` is the full-page block overlay; `ui/block-screen.ts` renders the `RequirementView`.
- **Multi-site, one shared budget:** a single content script (`entrypoints/blocked-sites.content.ts`) runs on every site in `blocklist.ts` (excluding `music.youtube.com`). A tab only blocks/accrues when its site is in `gating.blockedSiteIds`; the spent-time tally is one global counter, so time on any enabled site debits the same daily budget. Screen-time accrues via the `USAGE_TICK` message only while the tab is active+focused+allowed (`accrual.ts` is the pure reducer). The remaining budget shows in YouTube's panel and, universally, in the popup (`GET_STATE.budgetMsLeft`).
- **Multi-device sync (optional, off by default):** the `spent` budget can sync across the user's devices. It's stored as per-device, per-day **interval sets**, and `spentTodayMs` is the **union** length across all devices (so simultaneous watching on two devices counts once). The transport is pluggable behind `SyncTransport` (`src/shared/sync-transport.ts` port; adapters + orchestration in `src/core/sync/`): `off` / `browser` (`storage.sync` — same-browser **desktop only**, NOT Firefox Android) / self-hosted `supabase` | `cloudflare` | `upstash` (the only transports that reach the phone). Supabase/Cloudflare share one `/usage` HTTP protocol (`http-transport.ts`); Upstash speaks the Redis REST API and so has its own adapter (`upstash-transport.ts`). The content script is unchanged (still sends `USAGE_TICK`); the background turns ticks into intervals, writes them locally every tick, and pushes to the remote on a throttle. `earned` stays computed locally per device. Backend templates live in `backends/`. **Full design in `docs/SYNC.md`.**
- User-added custom domains are **deferred** — the MV3 plan is in `docs/CUSTOM-SITES.md`.

## Project-specific conventions

- **Identity:** this repo uses the maintainer's personal identity (Yurii-Stefan Zhydetskyi, `zhidetskij@gmail.com`). Never introduce `devrain.com` / `mg@devrain.com` in code, docs, commits, or URLs.
- **Commits:** Conventional-Commit subjects (`feat:`, `fix:`, `refactor:`, `ci:`), imperative and specific (e.g. "feat: turn the task gate into a daily YouTube-minute budget").
- **OAuth secret is public:** TickTick has no documented PKCE, so the client secret ships in the bundle and is a public value by design (`REQUIREMENTS.md §13`, `docs/AMO-REVIEW.md`). Don't treat it as a leak.
- **Zero telemetry / minimal network:** the extension only `fetch`es TickTick (the local Anki/bridge endpoints when those gates are on, and a **user-configured** sync backend when multi-device sync is on — never a maintainer-run server). The site host-permissions are used to inject DOM only — never to read pages or call site APIs. `docs/AMO-REVIEW.md` keeps a per-permission audit; update it when permissions change.

## Where to read more

`REQUIREMENTS.md` (overall spec + the §5 architecture rules), `CONTRIBUTING.md` (human-readable architecture rules), `docs/SELECTORS.md` (DOM resolver + overrides), `docs/GATING.md` (Focus mode), `docs/SYNC.md` (multi-device budget sync), `docs/CUSTOM-SITES.md` (deferred custom-domain plan), `docs/AMO-REVIEW.md` (store-review notes + permission/network audit), `PRIVACY.md`.
