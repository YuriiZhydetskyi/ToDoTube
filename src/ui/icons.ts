// Inline SVG icon helpers for the panel UI. Single source for icon
// glyphs — keeps `panel.ts` free of magic-string path data and gives
// future surfaces a consistent visual vocabulary.
//
// All icons inherit `currentColor` so they tint with their button's
// text color, and use a 24-unit viewBox with stroke-width 1.75 (the
// Lucide-style proportions that read cleanly at 16–20px).

const SVG_NS = 'http://www.w3.org/2000/svg';

interface IconOptions {
  size?: number;
  strokeWidth?: number;
}

function svg(
  paths: readonly string[],
  { size = 18, strokeWidth = 1.75 }: IconOptions = {},
): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 24 24');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', String(strokeWidth));
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    root.appendChild(p);
  }
  return root;
}

export function iconExternal(opts?: IconOptions): SVGSVGElement {
  return svg(['M7 7h10v10', 'm7 17 10-10'], opts);
}

export function iconRefresh(opts?: IconOptions): SVGSVGElement {
  return svg(
    [
      'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
      'M21 3v5h-5',
      'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
      'M3 21v-5h5',
    ],
    opts,
  );
}

export function iconCheck(opts?: IconOptions): SVGSVGElement {
  return svg(['M20 6 9 17l-5-5'], { strokeWidth: 2.25, ...opts });
}

export function iconChevronDown(opts?: IconOptions): SVGSVGElement {
  return svg(['m6 9 6 6 6-6'], opts);
}
