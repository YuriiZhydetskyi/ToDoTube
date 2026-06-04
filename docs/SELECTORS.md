# Selectors

YouTube changes its DOM regularly. ToDoTube is built so a change can be fixed in **one file**, or — if you don't want to wait for an update — patched live from the extension's settings page.

## One source of truth

All YouTube-specific identifiers (`ytd-…` custom-element tags, `#secondary`, `#related`, `yt-navigate-finish`, etc.) live in:

- `src/surfaces/desktop-watch/selectors.ts` — the named anchors.
- `src/surfaces/desktop-watch/heuristics.ts` — pure structural fallbacks.

Nothing else in the codebase contains a YouTube identifier. CI greps for `ytd-` in `src/` and fails if anything outside those two files matches.

## Multi-strategy resolution

Each anchor (e.g. `rightRail`, `endscreenGrid`) declares an ordered list of strategies. The resolver tries them in order and returns the first that finds an element AND passes the anchor's `validate(el)` check.

Strategies move from **most specific** to **most resilient**:

1. **Custom-element tag** (e.g. `ytd-watch-next-secondary-results-renderer`). Stable parts of YouTube's Polymer component contract — they survive longer than CSS classes.
2. **Stable id** (e.g. `#secondary #related`).
3. **Structural heuristic** (e.g. "the largest sibling of the player whose children are predominantly `ytd-…` custom elements").

## Self-test

Before mounting the panel, the resolver runs three sanity checks per anchor:

1. **Tag / role** — element type and child shape look right.
2. **Geometry** — `getBoundingClientRect()` matches expected size range.
3. **Parent shape** — has the expected ancestor.

A failed check moves the resolver to the next strategy. When all strategies are exhausted, ToDoTube logs the failure and **leaves YouTube untouched** — we never break the page.

## Debug overlay

In settings → Advanced, toggle **"Show selector debug overlay"**. ToDoTube will draw a colored outline around each matched anchor and print which strategy fired, in a small fixed-position panel. Turns a "your extension broke" report into a 30-second diagnosis.

## User-pasteable override

If YouTube ships a redesign and the published extension breaks, you don't have to wait for a release. In settings → Advanced → **"Override selectors"**, paste a JSON snippet in the same shape as the bundled selectors. The resolver reads overrides first.

## Reporting a breakage

Settings → About → **"Report DOM breakage"** opens a pre-filled GitHub issue with your user agent and which strategies tried and failed.

## Regression fixtures

The runtime self-test only fires when a user is on a watch page. To catch
breakage at **dev time**, the resolver is also pinned against captured real
watch-page DOM in `src/surfaces/desktop-watch/dom-fixtures.test.ts`.

Each fixture in `src/surfaces/desktop-watch/__fixtures__/*.html` is a sanitized
`ytd-watch-flexy` subtree whose anchor elements are tagged with
`data-tt-anchor` / `data-tt-strategy`. The test runs the real `resolve()` for
each marked anchor and asserts it lands on exactly that element, at no worse a
strategy than recorded. Geometry is stubbed (jsdom has no layout), so only the
geometry sub-check is neutralized — the structural checks (tag, `closest`, tile
counts) run for real.

**What it catches:** a change to `selectors.ts` / `heuristics.ts` /
`resolver.ts` that stops resolving against known-good DOM, and a primary
strategy silently degrading to a fallback. **What it does not catch:** live
YouTube changes — those surface only when you re-capture (below).

### Capturing / refreshing fixtures

```bash
pnpm fixtures:capture                  # capture the configured pages, headful
pnpm fixtures:capture <url> [name]     # capture one ad-hoc watch URL
FIXTURES_HEADLESS=1 pnpm fixtures:capture   # unattended / remote
```

`scripts/capture-fixtures.ts` drives your locally installed Google Chrome via
`playwright-core` (no browser download), reuses the extension's **own** resolver
to mark ground truth (so no YouTube identifier is duplicated outside
`selectors.ts` / `heuristics.ts`), sanitizes the subtree, and writes the
fixture. If the resolver can't find a required anchor in a fresh page, it logs
loudly — that's the signal YouTube changed its DOM and `selectors.ts` needs an
update. It's a dev tool only: never part of the build, the test run, or CI.

> The endscreen container only exists once a video ends, so a normal capture
> leaves `endscreenContainer` unmarked. The hand-authored
> `watch-desktop-baseline.html` covers all four anchors, including the endscreen.
