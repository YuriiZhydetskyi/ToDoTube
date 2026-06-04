// Dev-only tool: capture real YouTube watch-page DOM into sanitized regression
// fixtures for src/surfaces/desktop-watch/dom-fixtures.test.ts.
//
//   pnpm fixtures:capture                 # capture the configured WATCH_PAGES
//   pnpm fixtures:capture <url> [name]    # capture one ad-hoc page
//
// It is NOT part of the build, the test suite, or CI. It uses `playwright-core`
// driving your locally installed Google Chrome (channel: 'chrome') — no browser
// download — and reuses the extension's OWN resolver to mark ground truth, so no
// YouTube identifier is ever duplicated outside selectors.ts / heuristics.ts.
//
// Flow per page: open Chrome → dismiss consent (best effort) → poll until the
// resolver can find the rail in the live DOM → grab documentElement.outerHTML →
// in jsdom: mark each resolvable anchor with data-tt-anchor/data-tt-strategy →
// sanitize the ytd-watch-flexy subtree → write __fixtures__/watch-<name>.html.
//
// If the resolver can't find a required anchor in a fresh page, that is logged
// loudly: it's the live-breakage signal that YouTube changed its DOM.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { JSDOM } from 'jsdom';
import { chromium, type Browser, type Page } from 'playwright-core';

import { sanitizeFixtureRoot } from '../src/surfaces/desktop-watch/fixture-sanitizer';
import { resolve } from '../src/surfaces/desktop-watch/resolver';
import { selectors, type AnchorName } from '../src/surfaces/desktop-watch/selectors';

interface WatchPage {
  name: string;
  url: string;
}

// Stable, SFW pages. Edit freely — the video ids are not personal data.
const WATCH_PAGES: WatchPage[] = [
  { name: 'me-at-the-zoo', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
];

const FIXTURES_DIR = join(process.cwd(), 'src', 'surfaces', 'desktop-watch', '__fixtures__');

// Anchors that MUST be present for a capture to count as a valid watch page.
// (endscreenContainer only exists once a video ends, so it's optional here.)
const REQUIRED_ANCHORS: AnchorName[] = ['pageRoot', 'rightRail', 'videoPlayer'];

// jsdom does no layout; give the resolver's geometry self-test a plausible
// column rect so structural resolution isn't blocked by zero-size elements.
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
};

interface MarkResult {
  fixture: string | null;
  found: { name: AnchorName; strategyIndex: number }[];
  missing: AnchorName[];
}

/**
 * Run `fn` with a jsdom document parsed from `html`, wired up the way the
 * resolver expects: the global `document` / `HTMLVideoElement` point at this
 * window, and a plausible geometry rect stands in for jsdom's missing layout.
 */
function runInResolverContext<T>(html: string, fn: (document: Document) => T): T {
  const dom = new JSDOM(html);
  const { document, HTMLVideoElement, Element } = dom.window;

  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () => COLUMN_RECT as DOMRect;
  const g = globalThis as unknown as { document: unknown; HTMLVideoElement: unknown };
  const prevDocument = g.document;
  const prevVideo = g.HTMLVideoElement;
  g.document = document;
  g.HTMLVideoElement = HTMLVideoElement;

  try {
    return fn(document as unknown as Document);
  } finally {
    Element.prototype.getBoundingClientRect = realRect;
    g.document = prevDocument;
    g.HTMLVideoElement = prevVideo;
  }
}

/**
 * Find the page-root element via the resolver and return a CSS selector for it,
 * derived from its own tag/id (no hard-coded YouTube identifier). Used to grab
 * the watch-flexy SUBTREE in-page, which round-trips through an HTML parser
 * cleanly — unlike the whole document, whose deep nesting gets foster-parented.
 */
function derivePageRootSelector(html: string): string | null {
  return runInResolverContext(html, () => {
    const result = resolve(selectors.pageRoot);
    if (!result) return null;
    const el = result.element;
    return el.id ? `#${el.id}` : el.tagName.toLowerCase();
  });
}

/**
 * Parse the page-root subtree, tag the winning element of each anchor, sanitize
 * it, and return the serialized HTML (or null if the page root is missing).
 */
function markAndExtract(html: string): MarkResult {
  return runInResolverContext(html, (document) => {
    const found: { name: AnchorName; strategyIndex: number }[] = [];
    const missing: AnchorName[] = [];

    for (const name of Object.keys(selectors) as AnchorName[]) {
      const result = resolve(selectors[name]);
      if (result) {
        result.element.setAttribute('data-tt-anchor', name);
        result.element.setAttribute('data-tt-strategy', String(result.strategyIndex));
        found.push({ name, strategyIndex: result.strategyIndex });
      } else {
        missing.push(name);
      }
    }

    const wrapper = document.querySelector('[data-tt-anchor="pageRoot"]');
    if (!wrapper) return { fixture: null, found, missing };

    sanitizeFixtureRoot(wrapper);
    return { fixture: wrapper.outerHTML, found, missing };
  });
}

async function dismissConsent(page: Page): Promise<void> {
  // YouTube's consent gate varies by region; try the common buttons in both the
  // main frame and any consent iframe. Best effort — headful means you can also
  // click it yourself and the poll loop will pick up the loaded page.
  const labels = [/^accept all$/i, /^reject all$/i, /^i agree$/i, /^accept$/i, /^agree$/i];
  for (const frame of [page, ...page.frames()]) {
    for (const name of labels) {
      try {
        await frame.getByRole('button', { name }).first().click({ timeout: 1500 });
        return;
      } catch {
        // try the next label / frame
      }
    }
  }
}

async function capturePage(browser: Browser, watch: WatchPage): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
  });
  // Pre-seed the consent cookie so we land on the watch page instead of the
  // region consent interstitial (which has no watch DOM to capture).
  await context.addCookies([
    { name: 'CONSENT', value: 'YES+', domain: '.youtube.com', path: '/' },
    { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' },
  ]);
  const page = await context.newPage();
  try {
    console.log(`\n→ ${watch.name}: ${watch.url}`);
    await page.goto(watch.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissConsent(page);

    // Let the rail hydrate BEFORE we strip scripts (stripping freezes the page).
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // Strip parser-hostile nodes on the LIVE (correctly-nested) DOM. Huge inline
    // <script>/<template> payloads make a serialized string re-parse with
    // mangled nesting (foster-parenting), which breaks closest()-based
    // resolution. Generic HTML tags, not site selectors — clear of single-source.
    const wholeDoc = await page.evaluate(() => {
      const hostile = 'script,style,template,noscript,link,iframe,svg,img,picture,source,canvas';
      for (const el of Array.from(document.querySelectorAll(hostile))) el.remove();
      return document.documentElement.outerHTML;
    });

    // The whole document still re-parses with mangled nesting, but the page-root
    // SUBTREE alone round-trips cleanly. Locate the root via the resolver (no
    // hard-coded selector), then re-serialize just that subtree from the page.
    const pageRootSelector = derivePageRootSelector(wholeDoc);
    if (!pageRootSelector) {
      console.warn(
        '  ⚠ resolver found no page root. The watch page may not have loaded, ' +
          'or YouTube changed its DOM — inspect the page and update selectors.ts.',
      );
      return;
    }
    const subtree = await page.evaluate(
      (sel) => document.querySelector(sel)?.outerHTML ?? '',
      pageRootSelector,
    );

    const result = markAndExtract(subtree);
    const requiredMissing = REQUIRED_ANCHORS.filter((a) => result.missing.includes(a));
    if (!result.fixture || requiredMissing.length > 0) {
      const missingLabel = result.fixture ? requiredMissing.join(', ') : 'pageRoot';
      console.warn(
        `  ⚠ unresolved required anchor(s) [${missingLabel}]. The rail may not have ` +
          `rendered, or YouTube changed its DOM — inspect the page and update selectors.ts.`,
      );
      return;
    }

    if (result.missing.length > 0) {
      console.warn(`  ⚠ unresolved anchors (left unmarked): ${result.missing.join(', ')}`);
    }

    const anchors = result.found.map((f) => `${f.name}@${f.strategyIndex}`).join(', ');
    const header =
      `<!--\n  Auto-captured & sanitized by scripts/capture-fixtures.ts. Do not edit by hand.\n` +
      `  Source: ${watch.url}\n  Anchors: ${anchors}\n-->\n`;
    const outPath = join(FIXTURES_DIR, `watch-${watch.name}.html`);
    writeFileSync(outPath, header + result.fixture + '\n', 'utf-8');
    console.log(`  ✓ wrote ${outPath}\n    anchors: ${anchors}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const [, , urlArg, nameArg] = process.argv;
  const pages: WatchPage[] = urlArg ? [{ name: nameArg ?? 'adhoc', url: urlArg }] : WATCH_PAGES;

  // Headful by default so you can watch the page and clear any consent gate
  // yourself; set FIXTURES_HEADLESS=1 for unattended/remote runs.
  const headless = process.env.FIXTURES_HEADLESS === '1';
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless, channel: 'chrome' });
  } catch (err) {
    console.error(
      'Could not launch Google Chrome via playwright-core.\n' +
        'Install Google Chrome (stable), or run `npx playwright install chromium`.\n',
      err,
    );
    process.exitCode = 1;
    return;
  }

  try {
    for (const watch of pages) {
      await capturePage(browser, watch);
    }
  } finally {
    await browser.close();
  }
}

void main();
