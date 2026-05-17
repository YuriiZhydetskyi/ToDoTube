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
