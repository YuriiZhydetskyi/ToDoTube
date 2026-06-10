# Activity-budget gate — earn YouTube with physical activity

Status: **v1 implemented** (extension side fully built & tested; the Garmin
bridge is a reference scaffold pending live validation).

## What this is

A Focus-mode gate that keeps YouTube blocked until you've done enough
physical activity today, expressed in your own terms:

- `200 reps = 30 min of YouTube`
- `30 min in an HR zone = 60 min of YouTube`
- `8000 steps = 45 min`, etc.

It rides the same **continuous-credit ledger** as the Anki gate:

```
earned = (today's activity value / effort) × reward
spent  = YouTube minutes watched today
allowed while earned − spent > 0
```

## Why this architecture (the part that drove every decision)

We researched how to get Garmin data and the result shaped the whole design:

1. **Garmin's official API is business-only.** The Garmin Connect Developer
   Program requires a legal entity + approval and explicitly excludes personal
   use — unusable for a personal extension.
2. **The extension can't read Garmin directly.** Garmin uses a mobile-SSO
   login; doing it from a browser extension would mean storing Garmin
   credentials and hitting undocumented, non-CORS endpoints — fragile and a
   store/ToS liability.
3. **The working unofficial libraries are server-side.** `garmin-connect`
   (Node) and `python-garminconnect` are alive and maintained, but run as a
   separate process, not in a browser.

So the data flows through a small **self-hosted bridge**, and the extension
only ever talks to localhost JSON — Garmin credentials never touch it:

```
[Garmin Connect cloud]
   ↓  unofficial API (login/tokens live in the bridge only)
[bridge/garmin]  →  GET http://127.0.0.1:8930/today
   ↓  → { steps, intensityMinutes, hrZoneMinutes, reps }
[signals/http]   →  generic JSON-over-HTTP signal (source-agnostic)
   ↓  ctx.readSignal(HTTP_SIGNAL_ID, {url, jsonPath, kind, scale})
[gates/activity-budget]  →  GateDecision
```

We deliberately chose this **passive** path (the watch tracks on its own, no
camera) over lighter browser-local alternatives (webcam pose-counting, Web
Bluetooth HR) because automatic/historical tracking was the priority.
**Realtime "hold your HR above X" is out of scope** — it's impossible from
cloud data (it would need a live BLE connection to the watch).

## How it's wired (files)

**Extension (all built, type-checked, linted, unit-tested):**

| Area            | File                                                                                                                     | Role                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signal          | [`signals/http/signal.ts`](../src/signals/http/signal.ts), [`client.ts`](../src/signals/http/client.ts)                  | New **source-agnostic** JSON-over-HTTP signal: GET a URL, read a dot-path number, scale it, tag a `SignalKind`, 20 s cache.                                 |
| Signal registry | [`signals/registry.ts`](../src/signals/registry.ts)                                                                      | Registers `HTTP_SIGNAL_ID`.                                                                                                                                 |
| Ledger helper   | [`gates/_shared/ledger.ts`](../src/gates/_shared/ledger.ts)                                                              | `earned/spent → GateDecision`, extracted from anki-budget and shared by both gates.                                                                         |
| Gate            | [`gates/activity-budget/gate.ts`](../src/gates/activity-budget/gate.ts)                                                  | New gate; config = metric · effort · reward · failMode. Handles both `count` and `durationMs` metrics.                                                      |
| Bridge contract | [`gates/activity-budget/constants.ts`](../src/gates/activity-budget/constants.ts)                                        | **Single source** of the bridge URL/port + the metric catalogue (jsonPath/kind/scale). Lives with the gate because boundaries forbid `gates → signals`.     |
| Gate registry   | [`gates/registry.ts`](../src/gates/registry.ts)                                                                          | Registers `ACTIVITY_BUDGET_GATE_ID` + `AVAILABLE_GATES`.                                                                                                    |
| Shared types    | [`shared/types.ts`](../src/shared/types.ts)                                                                              | New ids/URLs + a generic `text` `GateConfigField` kind.                                                                                                     |
| Options UI      | [`ui/options/sections.ts`](../src/ui/options/sections.ts), [`core/options.ts`](../src/core/options.ts)                   | Generic `text` field rendering; generalised `FocusSectionDeps` (host-permission by origin); "Activity bridge" setup block (Allow access + Test connection). |
| Message bus     | [`shared/messaging.ts`](../src/shared/messaging.ts), [`core/background/handlers.ts`](../src/core/background/handlers.ts) | New `HTTP_SIGNAL_TEST` (background resolves the metric so the ui layer needn't import gates/).                                                              |
| Manifest        | [`wxt.config.ts`](../wxt.config.ts)                                                                                      | Optional host permission `http://127.0.0.1:8930/*`.                                                                                                         |
| CI              | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)                                                                | New magic-constant guard pinning the bridge endpoint to its constants file.                                                                                 |

**Bridge (reference scaffold, separate package, excluded from the build):**

- [`bridge/garmin/`](../bridge/garmin/) — Node service (`server.js` generic
  cache + HTTP; `garmin.js` the only Garmin-specific module). See its
  [README](../bridge/garmin/README.md).

## Verification status

- ✅ `pnpm test` — 104 passing (16 new: ledger, both metric kinds, fail-modes, HTTP signal).
- ✅ `pnpm compile` (tsc), `pnpm lint` (eslint + prettier).
- ✅ `pnpm build` + `pnpm build:firefox`.
- ⚠️ The bridge was **not** run against a live Garmin account (needs the
  user's credentials + MFA, and the unofficial API is undocumented).

## TODO / follow-ups

1. **Validate `bridge/garmin/garmin.js` against a live account.** The
   library method names / Garmin endpoint paths there are marked and may need
   correcting per the installed `garmin-connect` version (or switch to the
   `@flow-js/garmin-connect` fork). First login may prompt for MFA.
2. **Precise HR-zone time.** v1 returns Garmin "intensity minutes" for
   `hrZoneMinutes` (vigorous counts double). A true "minutes above HR X" needs
   per-activity HR time-series → compute time-in-zone in the bridge.
3. **Squat-specific reps (optional).** `reps` is the sum of _all_ strength
   reps today. Filtering by exercise category ("squat") is a bridge
   enhancement and inherently fuzzy (depends on the watch's detection).
4. **Publish the bridge setup URL.** `ACTIVITY_BRIDGE_SETUP_URL` in
   `shared/types.ts` is a placeholder GitHub link — point it at the real docs
   once the repo is public.
5. **Persist the chosen bridge origin for permission UX.** The host permission
   is derived from the configured URL at click time; if a user edits the URL
   after granting access, they re-grant. Fine for v1; revisit if it confuses.
6. **Bridge packaging.** Consider shipping the bridge as a small downloadable
   (or documenting `npx`) so non-developers can run it without a Node setup.
7. **Docs cross-link.** Fold a short pointer to this gate into
   [`GATING.md`](./GATING.md) once the bridge path is validated.

## Suggested commit message

```
feat: add activity-budget Focus gate (earn YouTube with Garmin activity)

Unlock YouTube in proportion to physical activity ("200 reps = 30 min",
"30 min in HR zone = 60 min"), on the same continuous-credit ledger as the
Anki gate.

Garmin has no official personal API and can't be reached from the extension
directly, so activity flows through a self-hosted bridge:
  Garmin Connect -> bridge/garmin (local Node) -> GET /today JSON
                 -> generic HTTP signal (signals/http) -> activity-budget gate

- signals/http: new source-agnostic JSON-over-HTTP signal (url/path/kind/scale)
- gates/_shared/ledger: ledger decision extracted from anki-budget and shared
- gates/activity-budget: new gate + single-sourced bridge metric catalogue
- options: generic 'text' config field, bridge setup block, HTTP_SIGNAL_TEST
- bridge/garmin: reference Node bridge (excluded from the extension build)
- ci: guard the bridge endpoint to its constants file; ignore bridge/ in lint

Realtime HR is out of scope; reps = all strength reps today, hrZoneMinutes
approximates Garmin intensity minutes in v1. Bridge not yet validated against
a live Garmin account. See docs/ACTIVITY_GATE.md.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
