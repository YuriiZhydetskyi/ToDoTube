# Gating — "Focus mode" (block time-sink sites until a condition is met)

> Status: **task-complete, Anki, and activity gates shipped** (incl.
> screen-time accrual); **multi-site blocking shipped** (YouTube, TikTok,
> Facebook, Threads, X, Instagram, sharing one budget). The generic HTTP
> gate config UI is still on the roadmap. See the bottom.

## What this feature is

A second, optional feature of ToDoTube, orthogonal to the recommendation
replacement. When enabled, a **user-chosen set of time-sink sites is fully
blocked** behind an overlay until the user satisfies a configurable
**condition**, after which the sites open **only for a set amount of time**,
then block again. All enabled sites draw from **one shared daily budget** —
time spent on any of them counts against the same allowance (see
[Multi-site blocking](#shipped-multi-site-blocking)).

The original request (paraphrased):

1. Block YouTube until the user "does something". That "something" must be
   **pluggable**, so users/contributors can add their own conditions. First
   example: complete one task from the to-do list — until a task is marked
   done, YouTube won't open; when it opens, only for a set time.
2. A concrete plugin to build: integration with the local **Anki** app (via
   **AnkiConnect**). The plugin reads how much time was spent studying in
   Anki today; ToDoTube counts how much time was spent on YouTube; then it
   grants YouTube time equal to study time (want 15 min of YouTube → study
   15 min in Anki). Everything user-configurable, and the system must make
   it easy to add **more integrations** later.

The point of the design work was to make this an extensible subsystem, not a
one-off feature.

## Core idea: the "time ledger" (earned − spent)

Both motivating examples reduce to one model: **credit** (earned) vs
**debit** (YouTube time spent today). Access is allowed while there's
unspent credit.

| Gate              | Credit (earned)                  | Debit (spent)         | Allowed when       |
| ----------------- | -------------------------------- | --------------------- | ------------------ |
| **task-complete** | each completed task = +N minutes | one viewing session   | inside the window  |
| **anki-budget**   | Anki minutes studied today       | YouTube minutes today | earned − spent > 0 |

"Complete 1 task → 30 min of YouTube" is the discrete-credit case; "15 min
Anki = 15 min YouTube" is the continuous-credit case. Same mechanism,
different crediting function.

## Two pluggable layers (parallel to `providers/`)

A gate is **not** a provider. Providers are _data sources_ ("what tasks does
the user have"); gates are _access policies_ ("may YouTube be used now, and
what unlocks it"). The feature adds two new layers next to `providers/`:

- **`src/signals/`** — read-only **sensors**. A `Signal` produces a single
  measured value (`durationMs` or `count`). Members will be `anki-study-today`
  (AnkiConnect) and a generic HTTP sensor. Knows its data source, nothing
  about gates/DOM. The YouTube-usage and tasks-completed signals are
  synthesized by the core (it owns that data) and are not registered here.
- **`src/gates/`** — **access policies**. A `Gate` consumes a `GateContext`
  (signals + usage + its own config/state) and returns a `GateDecision`.
  Pure policy: never touches the DOM, never persists state itself (the core
  writes back any `nextState`). Some gates react to events (`onEvent`), some
  only poll (`evaluate`).

### How the layers connect

```
                 ┌─────────────────────────────────────────┐
   blocked tab   │ entrypoints/blocked-sites.content.ts      │  (document_start,
   (any blocked  │   → core/gatekeeper/overlay-controller    │   blocklist matches,
    site)        │       → surfaces/youtube-site/overlay      │   excl. music.youtube)
                 │       → ui/block-screen                    │
                 └───────────────▲───────────────────────────┘
                                 │ GATE_EVAL / GATE_CHANGED (messaging)
                 ┌───────────────┴───────────────────────────┐
   background    │ core/gatekeeper/gatekeeper.ts              │
   service       │   loadActive → buildContext → gate.evaluate│
   worker        │   ├─ gates/registry  (which gate)          │
                 │   ├─ signals/registry (external sensors)   │
                 │   ├─ core/gatekeeper/usage (screen time)   │
                 │   └─ shared/storage (gate state, settings) │
                 └────────────────────────────────────────────┘
```

The background is the single source of truth for the decision. Content
scripts only reflect it and re-lock themselves precisely at `allowedUntil`.
Gating config is mutated by writing `Settings.gating` directly (the options
page); the background's settings watcher then broadcasts `GATE_CHANGED`.

> **This is friction, not a hard lock.** The overlay is ordinary DOM: a
> determined user can remove it via DevTools, disable the extension, or
> exploit the brief `document_start`→`GATE_EVAL` window before it mounts.
> Gating is a self-discipline aid, not a security boundary — set
> expectations accordingly.

### Files

| File                                             | Role                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                                | DTOs: `SignalValue`, `GateDecision`, `RequirementView`, `GateEvalResult`, `GatingSettings` (+ `Settings.gating`, `blockedSiteIds`) |
| `shared/blocklist.ts`                            | single source of truth for blockable sites (match patterns, exclude, hostname resolution)                                          |
| `shared/budget.ts`                               | `remainingBudgetMs` + `formatBudgetClock` (shared by panel, popup, lifecycle)                                                      |
| `shared/storage.ts`                              | per-gate state items + screen-time usage record                                                                                    |
| `shared/messaging.ts`                            | `GATE_EVAL`, `USAGE_TICK`, `ANKI_TEST`, `GET_STATE` (+ `budgetMsLeft`), broadcast `GATE_CHANGED`                                   |
| `signals/types.ts`, `signals/registry.ts`        | `Signal` interface + external-sensor registry                                                                                      |
| `gates/types.ts`                                 | `Gate`, `GateContext`, `GateEvent`                                                                                                 |
| `gates/task-complete/gate.ts`                    | the first gate (+ `gate.test.ts`)                                                                                                  |
| `gates/registry.ts`                              | `getGateOrNull` + `AVAILABLE_GATES`                                                                                                |
| `core/gatekeeper/gatekeeper.ts`                  | decision orchestration + 1-min backstop alarm                                                                                      |
| `core/gatekeeper/usage.ts`                       | local-day screen-time tracker, shared across sites (+ test)                                                                        |
| `core/gatekeeper/overlay-controller.ts`          | content-side overlay show/hide + re-lock; per-site enable check                                                                    |
| `surfaces/youtube-site/overlay.ts`               | full-page overlay (no YouTube selectors; pauses video)                                                                             |
| `ui/block-screen.ts` + `styles/block-screen.css` | renders a `RequirementView`                                                                                                        |
| `entrypoints/blocked-sites.content.ts`           | site-wide content script for every blockable site (`document_start`)                                                               |
| `core/options.ts` + `ui/options/sections.ts`     | "Blocking" tab: `renderBlockingSection` (site checkboxes) + "Focus mode" (unlock condition)                                        |

### Layer rules (enforced by ESLint `boundaries`)

- `signals/**` → `signals`, `shared` only.
- `gates/**` → `gates`, `shared` only. Gates receive signal **values** via
  `GateContext` (a `shared` DTO), so they need no edge to `signals`.
- `core/**` may import `gates`, `signals`, `surfaces`, `ui`, `shared`.
- `ui/**` stays gate-agnostic: the options section receives the gate list as
  props from `core`, never importing `gates/`.

## The task-complete gate

- **Config** (`gateConfigs['task-complete']`): `tasksRequired` (default 1),
  `grantMinutes` (default 30).
- **State**: `{ unlockedUntil?: epochMs, progressCount?: number }`.
- **Block**: until `tasksRequired` tasks are completed via the ToDoTube
  panel. The block screen shows a progress meter when more than one is
  required.
- **Unlock**: completing the Nth task sets `unlockedUntil = now +
grantMinutes` and resets progress. `COMPLETE_TASK` in the background
  forwards the event to the gate (`notifyTaskCompleted`) and broadcasts the
  new decision.
- **Re-lock**: when `now ≥ unlockedUntil`, the gate blocks again. The overlay
  re-locks itself at `allowedUntil` client-side; a 1-minute background alarm
  is the backstop.
- Completing tasks **during** an active session does not consume credit (you
  aren't punished for staying productive).

## Locked decisions

| #   | Decision                | Choice (date)                                                                                                                                                          |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocking scope          | **Whole site, multiple sites** (one site-wide content script over a configurable blocklist) — 2026-05-29; extended to TikTok/Facebook/Threads/X/Instagram — 2026-06-02 |
| 2   | Extensibility           | **Registry (dev plugins) + a generic config gate**; no runtime user code (MV3 forbids remote code) — 2026-05-29                                                        |
| 3   | First gate              | **task-complete** — 2026-05-29                                                                                                                                         |
| 4   | Anki source unreachable | **Fail-closed** (block; clear "open Anki" message + easy off switch) — 2026-05-29                                                                                      |
| 5   | "Time spent"            | **Active blocked tab** (focused + not idle); one shared tally across all enabled sites — 2026-05-29                                                                    |

## Extending: adding a new gate

Mirrors adding a provider:

1. Create `src/gates/<name>/gate.ts` exporting a `Gate`.
2. Add one `case` to `gates/registry.ts` and one entry to `AVAILABLE_GATES`.
3. If the gate has user-configurable fields, surface them in the Focus-mode
   options section (today this is special-cased per gate; the planned
   generalization is a per-gate config schema carried on the descriptor).

For **non-coders**, decision #2 also calls for a bundled **generic HTTP
gate**: read a number from a user-configured local HTTP endpoint via a JSON
path, no code/rebuild — the gating analogue of the user-pasteable selectors
override.

## Shipped: screen-time accrual

The site-wide gate content script (`overlay-controller.ts`) reports a
`USAGE_TICK` every 20 s **only while** access is allowed and the tab is
visible + focused (decision #5); the background accrues it. Backgrounded
tabs fail the visibility/focus check (and are timer-throttled), so they
don't accrue. Budget re-evaluation rides the existing 1-minute gate alarm.
The tally is a single daily total, so every enabled site contributes to it
(see below).

`core/gatekeeper/usage.ts` is now a thin facade over `core/sync`: a tick
becomes a wall-clock **interval** in this device's daily record, and
`spentTodayMs` is the **union** of all the user's devices' intervals — the
same single-device behavior when sync is off, plus correct overlap handling
when it's on. **Multi-device sync is its own subsystem — see `docs/SYNC.md`.**

## Shipped: multi-site blocking

`shared/blocklist.ts` is the single source of truth for the blockable sites
(YouTube, TikTok, Facebook, Threads, X, Instagram) — the **only** place
their domain literals may appear (a CI guard enforces this, mirroring the
selector guard). It exports the match patterns consumed at build time by both
the content-script `matches` and the manifest `host_permissions`
(`wxt.config.ts`), plus `siteForHostname` for runtime resolution.

- **One content script** (`blocked-sites.content.ts`) matches every site,
  with `excludeMatches` carving out `music.youtube.com` so YouTube Music
  stays usable.
- **Per-site enable**: `gating.blockedSiteIds` picks which sites actually
  block. The overlay controller resolves its host via `siteForHostname`, and
  a tab whose site isn't enabled stays inert (no overlay, no accrual). It
  re-checks on `SETTINGS_CHANGED`, so toggling a site takes effect live.
- **Shared budget**: the spent tally is global, so 10 min on Instagram leaves
  10 min less for YouTube; once earned − spent hits zero, every enabled site
  blocks.
- **Where the timer shows**: YouTube has an in-page panel countdown
  (`core/lifecycle`); other sites have none, so the **popup** shows the
  universal `budgetMsLeft` countdown (`GET_STATE`).
- **Custom user-added domains** are deferred — see `docs/CUSTOM-SITES.md`.

## Shipped: Anki gate (`anki-budget`)

- **`signals/anki/constants.ts`** — single source of truth for AnkiConnect
  magic strings: endpoint `http://127.0.0.1:8765`, `version: 6`, action
  names, and the revlog tuple indices. (Same single-source rule as
  `surfaces/**/selectors.ts`.)
- **`signals/anki/client.ts`** — `POST {action, version, params}` →
  `{result, error}`; any failure (Anki closed, CORS, network) → `err`.
- **`signals/anki/reviews.ts`** — pure, unit-tested helpers
  (`startOfLocalDayMs`, `sumReviewDurationMs`).
- **`signals/anki/signal.ts`** — "minutes studied today": `deckNames` →
  `cardReviews(deck, startID = local-midnight)` per deck → sum the
  review-duration column. (No single AnkiConnect action gives time;
  `getNumCardsReviewedToday` is only a count.) 20 s in-memory cache.
- **`gates/anki-budget/gate.ts`** — `earnedMs = ankiMs × ratio`,
  `spentMs = spentTodayMs`, allowed while `earned > spent`; the block
  screen shows an earned/used meter and a "study ~N more min" target.
  Config: `ratio` (default 1), `failMode` (default `closed`, decision #4).
- **Onboarding** (options → Focus mode → Anki): an **optional** host
  permission (`optional_host_permissions: http://127.0.0.1:8765/*`) requested
  via an "Allow access to Anki" button (user gesture), a "Test Anki
  connection" button (`ANKI_TEST` → minutes studied today), and a link to
  the CORS `webCorsOriginList` setup guide.
- **Notes still to validate on a live Anki**: the exact revlog tuple index
  for review duration (currently `7`; the single place to fix is
  `signals/anki/constants.ts`), and Chrome Private Network Access for
  localhost calls from the worker.

## Roadmap: generic HTTP gate

The no-code escape hatch from decision #2 (configurable URL + JSON path +
count/duration + threshold/multiplier).

---

See also: `REQUIREMENTS.md` (overall spec) and `docs/SELECTORS.md` (the DOM
single-source-of-truth pattern this feature mirrors for Anki strings).
