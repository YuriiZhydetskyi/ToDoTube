# ToDoTube — Requirements & Project Description

## 1. Vision

ToDoTube is a browser extension that turns YouTube from a distraction engine into
a focus tool. Instead of seeing a wall of recommended videos pulling you down a
rabbit hole, you see **your own to‑do list for today**. The goal is two-fold:

1. **Reduce distractions** — strip out the recommendation surfaces that drive
   unplanned watch sessions.
2. **Increase awareness** — keep your real priorities in your field of view
   while you watch the video you came for.

## 2. Core Behavior

The extension modifies two regions of the YouTube watch page:

| YouTube region | Today | After ToDoTube |
| --- | --- | --- |
| Right-hand "Up next / recommendations" rail | Algorithmic video suggestions | The user's to‑do list for the chosen list/project |
| End-of-video recommendation grid (the tiles overlaid when a video finishes) | Algorithmic video suggestions | The same to‑do list |

Non-goals (initially): do **not** modify the YouTube home feed, the search
results page, the subscriptions feed, Shorts, or comments. The scope is the
**watch page only** (`/watch?v=…`).

The extension must not break video playback, captions, theater/full-screen
mode, miniplayer, or keyboard shortcuts.

## 3. Target Platforms

### 3.1 Browsers

- **Firefox** (desktop) — primary target.
- **Chrome** (desktop) — primary target. Edge and other Chromium browsers
  should work for free since they consume the same MV3 bundle.
- **Firefox for Android** — secondary target (v2). Firefox Android supports a
  curated set of WebExtensions, so this is feasible but needs a separate
  test pass.
- **Chrome for Android** — not supported (Chrome on Android does not run
  extensions). Out of scope.

### 3.2 YouTube surfaces

YouTube ships meaningfully different DOMs on each surface, and the extension
needs a content-script strategy per surface:

- **Desktop watch page** — `https://www.youtube.com/watch?v=…` — v1.
- **Mobile watch page** — `https://m.youtube.com/watch?v=…` — v2. The
  architecture isolates each surface behind a **surface adapter** module
  (see §5) so adding mobile is purely additive — no rewrites in v1 code.

## 4. To-Do Service Integrations

The extension is built around a **provider abstraction** so additional task
services can be added without rewriting the UI layer.

### 4.1 v1: TickTick

- Authentication via TickTick's OAuth2 flow (TickTick Open API).
- Read the user's lists/projects.
- Read tasks within a chosen list, or a smart list such as **Today**
  (this is the default).
- Display task title, due time (if any), and completion state.
- Click a task to mark complete (round-trip to TickTick, optimistic UI — see §13).
- Refresh on a sensible interval and when the user opens a new watch page.

### 4.2 v2+: Other providers

Candidates, in rough priority order:
- **Todoist** (well-documented REST API, OAuth2)
- **Google Tasks** (already in many users' Google accounts)
- **Microsoft To Do** (Graph API)
- **Notion** (databases-as-tasks)
- **Local / in-extension list** (offline fallback, no account needed)

### 4.3 Provider interface

Every provider implements the same TypeScript interface:

```ts
interface Provider {
  id: string;                     // "ticktick", "todoist", ...
  displayName: string;            // "TickTick"
  authenticate(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  disconnect(): Promise<void>;
  listProjects(): Promise<Project[]>;
  listTasks(projectId: string, opts?: ListTasksOpts): Promise<Task[]>;
  completeTask(taskId: string): Promise<void>;
}
```

The core (§5) talks only to this interface — it never imports a specific
provider directly.

## 5. Architecture

ToDoTube is built as **three independent layers that never reach across each
other**, plus shared utilities. This shape is the single most important
quality decision in the project: it makes adding a provider, fixing a
YouTube DOM change, or porting to mobile a *localized* change instead of a
sweeping refactor.

### 5.1 Three-layer model

```
┌─ surfaces/ ───────────────────┐    "where do I inject, on this page?"
│   desktop-watch, mobile-watch │    Knows YouTube. Knows nothing about tasks.
└───────────────────────────────┘
              ↑
┌─ core/ ───────────────────────┐    "when YouTube navigates, render this"
│   lifecycle, SPA observer     │    The orchestrator. The only layer that
│   message bus                 │    knows both surfaces AND providers exist.
└───────────────────────────────┘
              ↓
┌─ providers/ ──────────────────┐    "give me tasks, mark this one done"
│   ticktick, (todoist later)   │    Knows the task API. Knows nothing
│   common Provider interface   │    about YouTube or DOM.
└───────────────────────────────┘
```

**Hard rules** (enforced by lint config in `eslint.config.js`):
- `providers/**` must not import from `surfaces/**` or `ui/**`.
- `surfaces/**` must not import from `providers/**`.
- `ui/**` is provider-agnostic — it receives tasks via props/state.

### 5.2 Folder layout

WXT (see §10) uses file-based entrypoints under `entrypoints/`. Cross-browser
manifests are generated from `wxt.config.ts`, not committed as separate files.

```
entrypoints/
  background.ts                  MV3 service worker / event page
  youtube-watch.content.ts       content script — thin: hands off to core/
  popup/                         toolbar popup (HTML + TS)
  options/                       settings page (HTML + TS)
src/
  core/                  orchestrator, lifecycle, SPA navigation handling,
                         message bus between content script and background
  surfaces/
    desktop-watch/
      selectors.ts       SINGLE source of truth for every YouTube selector
      adapter.ts         knows how to inject into this surface
      heuristics.ts      structural fallbacks when selectors miss
    (mobile-watch/       added in v2 — same shape)
  providers/
    types.ts             Provider interface
    registry.ts          provider lookup by id
    ticktick/
      oauth.ts
      api.ts
      provider.ts        implements Provider
  ui/                    panel, task row, undo toast — vanilla DOM,
                         provider-agnostic
  shared/                storage wrapper, messaging types, common types
wxt.config.ts            single source for both Chrome and Firefox manifests
```

Entrypoint files (`entrypoints/*`) are thin glue — they call into `core/`,
which is the only layer aware of both `surfaces/` and `providers/`.

### 5.3 Why this passes a code review

- **Adding Todoist** = one new folder in `providers/`, one line in
  `providers/registry.ts`, zero changes anywhere else.
- **A YouTube redesign** = edits to one file in `surfaces/desktop-watch/`,
  zero changes to providers, core, or UI.
- **Each layer is independently unit-testable** by mocking the others at
  the interface boundary.
- **No cross-layer imports** means no accidental coupling that bites later.

## 6. Surviving YouTube DOM Changes

YouTube reshuffles its DOM regularly. The extension must (a) be robust to
small changes without code edits, and (b) be trivially fixable when a real
breakage happens. **No CSS selector or YouTube-specific identifier appears
anywhere in the codebase except inside `surfaces/<surface>/selectors.ts`.**

### 6.1 Single source of truth

`surfaces/desktop-watch/selectors.ts` exports one typed object. Every
selector is named, documented, and grouped:

```ts
export const selectors = {
  rightRail: {
    description: "The sidebar containing Up Next + recommendations.",
    strategies: [
      () => document.querySelector("ytd-watch-next-secondary-results-renderer"),
      () => document.querySelector("#secondary #related"),
      () => heuristics.findRecommendationsRail(),
    ],
  },
  endscreenGrid: { … },
  videoPlayer: { … },
};
```

Running `grep -r "ytd-" src/` should return matches **only** in
`surfaces/*/selectors.ts`. This is checked in CI.

### 6.2 Multi-strategy resolution

Each anchor has an ordered list of strategies. The resolver tries them in
order and returns the first match. Strategies move from most-specific
(custom-element tag names like `ytd-watch-next-secondary-results-renderer`,
which are stable parts of YouTube's Polymer contract) to least-specific
(structural heuristics, see §6.3).

### 6.3 Structural heuristics as last resort

When no selector matches, fall back to *what the element is*, not *what
it's called*. Example heuristic for the right rail: "find the largest
sibling of the video player whose children are predominantly `ytd-…`
custom elements." Heuristics live in `surfaces/<surface>/heuristics.ts`.

### 6.4 Self-test on injection

Before replacing a node, the resolver validates it: expected size range,
expected child count, expected parent shape. If validation fails, we **log
loudly in dev mode** and **leave YouTube untouched in prod**. We never
break the page silently.

### 6.5 Debug overlay (Advanced setting)

Togglable from settings → Advanced → "Show selector debug overlay". When
on, the extension draws a colored outline around each matched anchor and
prints which strategy fired, in a small fixed-position panel. Turns a
"YouTube broke us" report from a debugging session into a 30-second
diagnosis.

### 6.6 User-pasteable selector override (Advanced setting)

Settings → Advanced → "Override selectors" accepts a JSON snippet in the
same shape as the bundled `selectors.ts`. If we ship a broken extension
and store review takes a week, an affected user can paste a fix from a
GitHub issue and keep working. This also enables a community-driven
recovery path.

### 6.7 Reporting workflow

Settings → About → "Report DOM breakage" opens a pre-filled GitHub issue
with the user agent, the YouTube experiment flags (if exposed), and which
strategies tried and failed.

## 7. Settings / Options UI

### 7.1 Toolbar popup

Tiny — not a control panel. Contents:
- On/off switch (extension globally enabled).
- Current provider + current list (read-only label).
- "Open settings" button.

### 7.2 Options page — Simple

Three sections visible by default:

**Account**
- List of connected providers with status pill
  (`Connected · last synced 2m ago`), connect / disconnect buttons.
- **Active provider** dropdown (defaults to TickTick in v1).
- **Active list** dropdown (defaults to "Today" for TickTick).

**Display**
- What to replace: **Right rail** (on), **End-of-video grid** (on).
- Show completed tasks (off).
- Max items shown (default 25).
- Sort: by due date / by priority / by provider order (default: provider order).
- Theme: auto / light / dark (default: auto, matches YouTube).

**Behavior**
- Refresh interval: 1 / 5 / 15 min (default 5).
- Click behavior: complete (default) / open in app.

### 7.3 Options page — Advanced (collapsed by default)

- Debug overlay toggle (§6.5).
- Selector override editor (§6.6).
- Force re-authentication (per provider).
- Force re-sync now.
- Export settings as JSON / Import settings from JSON.
- Verbose logging toggle.

### 7.4 About

Version, link to repo, "Report DOM breakage" link (§6.7), license.

## 8. Privacy & Data Handling

- No analytics, no third-party telemetry. Ever.
- OAuth tokens stored in `browser.storage.local` only; never synced unless
  the user opts in.
- The extension talks **only** to YouTube (for DOM injection) and the
  configured provider's API. No other network requests.
- A clear "Disconnect / forget my tokens" button per provider in settings.

## 9. Non-Functional Requirements

- **Performance:** injection must not noticeably delay first frame of video
  playback. Lazy-render the to‑do list after the player is ready.
- **SPA-aware:** YouTube is a single-page app — the extension must re-run on
  client-side navigations (`yt-navigate-finish` event with a
  URL/MutationObserver fallback), not only on full page loads.
- **Fail-safe:** any failure inside our code must leave YouTube intact.
  Wrap injection in a top-level try/catch; on error, log and bail.
- **Cross-browser:** Manifest V3 for Chrome and Firefox. WXT generates both
  manifests from one `wxt.config.ts` and includes `webextension-polyfill`
  automatically — we never import or manage either by hand.
- **DOM robustness:** see §6.

## 10. Build Stack & Code Quality (the "Codex-review" bar)

### 10.1 Stack

- **[WXT](https://wxt.dev)** — the framework. Vite-based, purpose-built for
  browser extensions. Provides file-based entrypoints, cross-browser MV3
  manifest generation, content-script lifecycle context, bundled
  `webextension-polyfill`, HMR during development, and per-browser
  filtering (`include: ['firefox']`) for the v2 mobile adapter.
- **TypeScript**, `"strict": true`. `any` only at explicit boundary points
  (e.g. just-deserialized JSON from a provider API), immediately narrowed.
- **Vanilla DOM** for UI — no React, Preact, Vue, or Svelte. The panel,
  task row, undo toast, options page, and popup are all small enough that
  vanilla `document.createElement` + a few helpers is cleaner and produces
  ~zero UI runtime overhead. This is a deliberate choice for minimal bundle
  size and minimal review surface.
- **Vitest** for unit tests; tests live next to the file
  (`foo.ts` + `foo.test.ts`). Providers and surface adapters have
  **interface-level tests**: call the public API of the module, mock the
  network or DOM.

### 10.2 Quality gates

- **ESLint flat config + Prettier**, both enforced in a pre-commit hook
  (`husky` + `lint-staged`) so style is never a review comment.
- **Lint rule for layer boundaries** (§5.1) — via `eslint-plugin-import` /
  `eslint-plugin-boundaries` — so a `providers/` file importing from
  `surfaces/` fails CI.
- **CI grep guard** — any `ytd-` or YouTube-specific identifier outside
  `src/surfaces/**/selectors.ts` fails CI (§6.1).
- **No utility-belt dependencies** (lodash, moment, etc.) for things modern
  JS does fine on its own.
- **Comments only where the WHY isn't obvious** — invariants, workarounds,
  hidden constraints. No paragraph-length docstrings describing obvious code.

### 10.3 Docs

- README with the architecture diagram from §5.1.
- `CONTRIBUTING.md`.
- `docs/SELECTORS.md` — explains the strategy in §6 in depth. This is the
  file community contributors will read most when YouTube changes things.

### 10.4 CI

GitHub Actions on every PR:
- Typecheck (`wxt prepare && tsc --noEmit`)
- Lint (`eslint`, `prettier --check`)
- Test (`vitest run`)
- Build for both Chrome and Firefox targets (`wxt build -b chrome`,
  `wxt build -b firefox`)
- Selector guard grep (§6.1)

## 11. Out of Scope (for v1)

- Creating / editing tasks from inside YouTube (read + complete only).
- Replacing the YouTube home feed, search, Shorts, or subscriptions.
- A web dashboard outside the browser.
- Mobile Safari / iOS (no extension model that fits).
- Sync of extension settings across machines (Phase 3 if requested).

## 12. Release Plan

- **v1 — All-in-one release.** Chrome + Firefox desktop. TickTick provider
  end-to-end (OAuth, list/task fetch, click-to-complete with undo).
  Settings page (Simple + Advanced). Debug overlay. Selector override.
  Sideload-only; published to stores once stable.
- **v2 — Reach.** Firefox for Android (`m.youtube.com` surface adapter).
  Second provider (Todoist most likely). Both stores.
- **v3 — Polish.** Themes refined, animations, more provider integrations
  driven by user demand, settings sync (opt-in).

## 13. Decisions (locked)

Locked 2026-05-17 (first round):
- **All-in-one v1.** TickTick + good settings + the robust architecture
  ship together. No "skeleton-only" intermediate release.
- **TickTick OAuth model.** The developer registers a single TickTick
  developer app once and ships the `client_id` (and `client_secret`,
  treated as a public-client value) inside the extension. Each end user
  signs into their own TickTick account through TickTick's OAuth consent
  screen and sees their own lists. The extension never sees or stores user
  passwords.
- **Task completion.** Click-to-complete with **optimistic UI** (no undo
  toast — dropped during build planning for simplicity): tapping a task
  hides it immediately and fires the `completeTask` API call. On failure,
  the task is restored and a small error pill is shown.
- **Empty states.** Strict focus mode:
  - Not connected → "Connect TickTick" CTA in the rail.
  - Connected, list is empty → celebrate ("You're done for today 🎉").
  - Never silently fall back to YouTube recommendations.
- **Distribution.** Sideload during development; submit to Chrome Web
  Store and addons.mozilla.org once v1 is stable.
- **Settings depth.** Simple sections visible by default; power-user
  features behind a collapsed Advanced section (§7.3).
- **DOM robustness posture.** Full belt-and-suspenders: selector registry
  (§6.1) + multi-strategy resolution (§6.2) + structural heuristics (§6.3)
  + self-test (§6.4) + debug overlay (§6.5) + user-pasteable override (§6.6).

Locked 2026-05-17 (second round):
- **Endscreen behavior.** Replace the YouTube endscreen entirely. The task
  list covers the endscreen overlay rather than coexisting with "Up next".
- **Telemetry.** Zero. No analytics, no error reporting that leaves the
  user's machine, no opt-in pings. Errors are surfaced only in the user's
  own browser console (verbose mode) and via the "Report DOM breakage"
  link (§6.7), which is user-initiated.
- **License.** **MIT.** Maximally permissive; copyright notice must be
  preserved in derivatives.
- **Repo visibility.** Public OSS.
- **Build stack (see §10.1).** WXT + TypeScript strict + vanilla DOM (no UI
  framework) + Vitest. No `webextension-polyfill` import — WXT bundles it.
- **Icon design.** Postponed; must be settled before submitting to the
  Chrome Web Store / AMO.

## 14. Pending pre-publish

Only one item remains, and it does not block any code:

- **Icon design** — proposed: a checkmark over a play-button silhouette.
  Settle before store submission.

---

### Implementation-time task: collecting ground-truth selectors

When we start writing the first surface adapter, the very first input we
need is real DOM from your YouTube (which can differ from mine due to A/B
experiments). I'll walk through this with you visually when we get there.
The short version:

1. Open `youtube.com/watch?v=…` on desktop Chrome and desktop Firefox in
   normal layout (not theater mode). Right-click the right-side rail →
   **Inspect**. In DevTools, find the outermost `ytd-…` element wrapping
   the entire rail, right-click → **Copy → Copy outerHTML**, paste it.
2. Same for the endscreen — pause a video as it ends so the recommendation
   grid is visible, inspect a tile, walk up until you find the wrapper
   containing all of them. Copy outerHTML.
3. A screenshot of each surface helps too.

These become the starting `selectors.ts`. This is a coding-time
collaboration step, not a design decision — it's listed here so it isn't
forgotten when we start v1.
