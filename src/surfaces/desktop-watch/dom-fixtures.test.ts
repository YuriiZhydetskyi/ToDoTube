// @vitest-environment jsdom
//
// Golden / characterization harness: run the REAL resolver (selectors +
// heuristics) against captured-or-faithful YouTube DOM fixtures and assert it
// still lands on the ground-truth element each fixture records.
//
// What this catches: a refactor of selectors.ts / heuristics.ts / resolver.ts
// that stops resolving correctly against known-good DOM, and a primary strategy
// silently degrading to a fallback (via the recorded data-tt-strategy). What it
// does NOT catch: live YouTube DOM changes — those surface when you re-run
// `pnpm fixtures:capture` and the script can no longer find an anchor.
//
// No YouTube identifiers appear here (CI selector guard): fixtures live in .html
// and ground truth is read from data-tt-* attributes + the `selectors` registry.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolve } from './resolver';
import { selectors, type AnchorName } from './selectors';

// vitest runs with cwd = repo root (that's how `pnpm test` invokes it), so we
// locate fixtures from there rather than import.meta.url, which vite does not
// always expose as a file:// URL.
const fixturesDir = join(process.cwd(), 'src', 'surfaces', 'desktop-watch', '__fixtures__');
const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.html'));

// jsdom does no layout, so getBoundingClientRect is all-zeros and rightRail's
// geometry self-test would spuriously fail. Stub a generous column rect for
// every element: this neutralizes ONLY the geometry sub-check — the structural
// checks (tag, closest, tile counts) still run for real against the fixture.
// Geometry-logic correctness stays covered by heuristics.test.ts.
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const COLUMN_RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 402,
  bottom: 1200,
  width: 402,
  height: 1200,
  toJSON: () => '',
} as DOMRect;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => COLUMN_RECT;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

function isAnchorName(name: string): name is AnchorName {
  return Object.prototype.hasOwnProperty.call(selectors, name);
}

describe('DOM fixtures', () => {
  it('discovers at least one fixture', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    describe(file, () => {
      const html = readFileSync(join(fixturesDir, file), 'utf-8');

      it('resolves every marked anchor to its ground-truth element', () => {
        document.body.innerHTML = html;
        const marked = Array.from(document.querySelectorAll('[data-tt-anchor]'));
        expect(marked.length, 'fixture has no data-tt-anchor markers').toBeGreaterThan(0);

        for (const el of marked) {
          const name = el.getAttribute('data-tt-anchor') ?? '';
          expect(isAnchorName(name), `unknown anchor "${name}"`).toBe(true);
          if (!isAnchorName(name)) continue;

          const result = resolve(selectors[name]);
          expect(result, `anchor "${name}" did not resolve`).not.toBeNull();
          expect(result?.element, `anchor "${name}" resolved to the wrong element`).toBe(el);

          const recordedMax = Number(el.getAttribute('data-tt-strategy') ?? '0');
          expect(
            result?.strategyIndex,
            `anchor "${name}" degraded past its recorded strategy`,
          ).toBeLessThanOrEqual(recordedMax);
        }
      });
    });
  }
});
