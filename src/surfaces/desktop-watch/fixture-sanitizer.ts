// Pure DOM scrubber for captured YouTube regression fixtures.
//
// A captured watch page carries the maintainer's personalized recommendations
// (video titles, thumbnail URLs, channel names) and a lot of bulk. We never
// want that committed: it's mildly private, noisy, and changes constantly.
//
// `sanitizeFixtureRoot` strips everything the resolver does NOT key on (text,
// links, images, scripts, styling) while preserving the structural signal it
// DOES key on — tag names, ids, classes — plus our own `data-tt-*` ground-truth
// markers. The result is small, stable, and content-free.
//
// It is deliberately tag-agnostic: it must not name YouTube identifiers (this
// file lives under the CI selector guard). Repeated lists are pruned by
// collapsing runs of identical tag names, so rec tiles shrink without this file
// ever spelling out a single site-specific tag.
//
// Operates on any DOM `Element`, so it runs both under vitest's jsdom and in
// the Node capture script (see scripts/capture-fixtures.ts).

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

// Whole subtrees we drop — they carry no structural value for resolution and
// only add weight / executable content.
const DROP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'LINK',
  'IFRAME',
  'SVG',
  'PATH',
  'IMG',
  'PICTURE',
  'SOURCE',
  'CANVAS',
]);

// Attributes we keep verbatim — the resolver and its heuristics select on
// these (tag/id/class) and we author ground truth via `data-tt-*`.
const KEEP_ATTRS = new Set(['id', 'class', 'role']);
const MARKER_PREFIX = 'data-tt-';

// Keep enough repeats for the rail heuristic (needs >= 3 tiles) without
// committing dozens of identical nodes.
const MAX_REPEATED_CHILDREN = 6;

// Visible text is replaced with a single neutral glyph so the node still
// exists (some layouts collapse when empty) but carries no information.
const TEXT_PLACEHOLDER = '·';

/**
 * Scrubs a captured fixture subtree in place: removes scripts/media, neutralizes
 * personal text and links, prunes repeated lists, and keeps only the structural
 * attributes (plus `data-tt-*` markers) the resolver depends on.
 */
export function sanitizeFixtureRoot(root: Element): void {
  scrubAttributes(root);
  scrubChildren(root);
}

function scrubChildren(parent: Element): void {
  // Snapshot first: we mutate the live child list as we go.
  for (const node of Array.from(parent.childNodes)) {
    const type = node.nodeType;

    if (type === COMMENT_NODE) {
      node.parentNode?.removeChild(node);
      continue;
    }

    if (type === TEXT_NODE) {
      if (node.textContent && node.textContent.trim().length > 0) {
        node.textContent = TEXT_PLACEHOLDER;
      }
      continue;
    }

    if (type !== ELEMENT_NODE) {
      // Processing instructions, CDATA, etc. — drop.
      node.parentNode?.removeChild(node);
      continue;
    }

    const el = node as Element;
    if (DROP_TAGS.has(el.tagName.toUpperCase())) {
      el.remove();
      continue;
    }

    scrubAttributes(el);
    scrubChildren(el);
  }

  pruneRepeatedChildren(parent);
}

function scrubAttributes(el: Element): void {
  for (const name of Array.from(el.getAttributeNames())) {
    const lower = name.toLowerCase();
    if (lower.startsWith(MARKER_PREFIX)) continue; // our ground-truth markers
    if (KEEP_ATTRS.has(lower)) continue;

    if (lower.startsWith('data-')) {
      // Keep the hook's presence (some structures branch on it) but discard
      // any personal/volatile value.
      el.setAttribute(name, '');
      continue;
    }

    // Everything else — href/src/srcset/alt/title/style/aria-*/on*/etc. — is
    // either personal, volatile, or executable. Drop it.
    el.removeAttribute(name);
  }
}

/**
 * Collapses long runs of same-tag children to at most MAX_REPEATED_CHILDREN.
 * Tag-agnostic on purpose: a list of N identical custom elements (rec tiles,
 * comments, chips) shrinks to a representative few without this file naming any
 * site-specific selector.
 */
function pruneRepeatedChildren(parent: Element): void {
  const seenByTag = new Map<string, number>();
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName.toUpperCase();
    const count = (seenByTag.get(tag) ?? 0) + 1;
    seenByTag.set(tag, count);
    // Never prune a ground-truth anchor, even if it shares a tag with a list.
    if (count > MAX_REPEATED_CHILDREN && !hasMarker(child)) child.remove();
  }
}

function hasMarker(el: Element): boolean {
  return el.getAttributeNames().some((n) => n.toLowerCase().startsWith(MARKER_PREFIX));
}
