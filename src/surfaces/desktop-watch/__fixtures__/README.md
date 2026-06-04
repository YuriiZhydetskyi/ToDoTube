# Watch-page DOM fixtures

Captured-or-faithful YouTube watch-page DOM used by
[`../dom-fixtures.test.ts`](../dom-fixtures.test.ts) to pin the resolver
(`selectors.ts` + `heuristics.ts` + `resolver.ts`) against real structure.

See [`docs/SELECTORS.md`](../../../../docs/SELECTORS.md) → **Regression
fixtures** for the full picture.

## What's in here

- `watch-desktop-baseline.html` — hand-authored, mirrors the real nesting and
  marks **all four** anchors (including `endscreenContainer`, which a live
  capture can't produce mid-video). Do not delete; it's the floor of coverage.
- `watch-<name>.html` — produced by `pnpm fixtures:capture`. Real, sanitized
  watch-page DOM.

## Format

Each file is a single sanitized `ytd-watch-flexy` subtree. Ground truth is
authored on the anchor elements:

- `data-tt-anchor="rightRail | endscreenContainer | videoPlayer | pageRoot"` —
  the element the resolver must land on.
- `data-tt-strategy="<index>"` — the strategy index that matched at capture
  time. The test fails if resolution degrades past this (e.g. primary → fallback).

A fixture only asserts the anchors it marks, so a capture missing the endscreen
is fine.

## These are sanitized, not raw

The capture script strips scripts, styles, media, comments, all text, and
personal/volatile attributes, keeping only the structural attributes the
resolver keys on (`tag`, `id`, `class`) plus the `data-tt-*` markers. There is
**no personal data and no executable content** here — and that's enforced by
[`../fixture-sanitizer.ts`](../fixture-sanitizer.ts). This directory is
`.prettierignore`d: the files are machine-shaped, not code to style.

## Refreshing

```bash
pnpm fixtures:capture                  # configured pages
pnpm fixtures:capture <url> [name]     # one ad-hoc page
```

Run it when a fixture goes stale or you want to confirm the resolver still
handles live YouTube. If it reports an unresolved required anchor, YouTube
changed its DOM — update `selectors.ts`.
