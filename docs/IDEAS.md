# Improvement ideas (backlog)

Exploratory ideas for where ToDoTube could go next. This is **not** committed
scope — [`REQUIREMENTS.md` §12](../REQUIREMENTS.md) is the authoritative release
plan. Think of this as a parking lot so nothing gets lost between sessions.

Grouped by theme; the rough ranking is "value × fit with the project's
quality/zero-telemetry/single-source values".

---

## 1. Quality & resilience

### ✅ Selector regression harness — **done**

Pin the DOM resolver against captured real watch-page DOM so a refactor that
breaks resolution goes red at dev time, not in a user's browser. Shipped as
`src/surfaces/desktop-watch/__fixtures__/` + `dom-fixtures.test.ts` +
`fixture-sanitizer.ts` + `scripts/capture-fixtures.ts` (`pnpm fixtures:capture`).
See [`SELECTORS.md` → Regression fixtures](SELECTORS.md).

### Accessibility (a11y) pass on injected surfaces

The panel ([`ui/panel.ts`](../src/ui/panel.ts)) and block screen
([`ui/block-screen.ts`](../src/ui/block-screen.ts)) are injected into someone
else's page. Audit ARIA roles, focus management (especially when the block
overlay traps the page), keyboard navigation, and contrast. Both a real
accessibility win and a code-quality win.

---

## 2. Internationalization (i18n) + Ukrainian locale

All UI strings are hard-coded English (`Connect TickTick`,
`You're done for today 🎉`, etc.). Move them behind `browser.i18n` /
`messages.json` and make Ukrainian the first additional locale. Fits the
project's "one source of truth" instinct — the strings get one home — and is a
clean architectural exercise. Personally relevant to the maintainer.

---

## 3. Focus mode — product depth

### Local-only stats dashboard (zero-telemetry friendly)

The ledger already records earned/spent per day as interval sets
([`shared/intervals.ts`](../src/shared/intervals.ts)). Surface a local
"this week: earned vs spent" history + streak counter — all on-device, fully in
line with [`PRIVACY.md`](../PRIVACY.md). Makes Focus mode sticky without a single
telemetry call.

### Schedule & exceptions gates

A time-of-day / day-of-week gate (block only during work hours), or an allowlist
of specific YouTube channels/playlists (let educational content through). Fits
the existing gate architecture: a new gate = one folder + one line in
[`gates/registry.ts`](../src/gates/registry.ts).

### Custom blocked domains

Already designed in [`CUSTOM-SITES.md`](CUSTOM-SITES.md) but deferred. The most
common request for this kind of blocker.

---

## 4. Reach (v2 roadmap)

### Todoist provider

Research is already done in
[`TODOIST-INTEGRATION-NOTES.md`](TODOIST-INTEGRATION-NOTES.md). A second provider
is the best proof that the provider abstraction actually holds.

### Firefox for Android (`m.youtube.com`)

A mobile surface adapter. Mobile is where the time-sink is worst, and sync was
already built with the phone in mind ([`SYNC.md`](SYNC.md)).

---

## 5. Release

- **Icon design** — the one open pre-publish item ([`REQUIREMENTS.md` §14](../REQUIREMENTS.md)).
- **Release automation** — a GitHub Action: build → zip → draft release, optionally
  a `web-ext` submit.
- **First-run onboarding** flow.

---

## Top picks (when picking the next one)

1. **a11y pass** — removes a real gap, pure quality, no new surface area.
2. **i18n + Ukrainian** — close to home, good architectural exercise.
3. **Local stats dashboard** — product value with zero betrayal of the
   zero-telemetry stance.
