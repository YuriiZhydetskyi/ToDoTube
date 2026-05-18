// Generic anchor resolver. Walks the strategies of an anchor, runs the
// self-test on the first match, returns the winner or null.
//
// All YouTube knowledge stays in selectors.ts / heuristics.ts. This file
// is provider-shaped: it knows what an Anchor is, not what a YouTube DOM
// looks like.

import type { Anchor } from './selectors';

export interface ResolveResult {
  readonly element: Element;
  // Which strategy index won (0 = primary, 1 = first fallback, etc.).
  readonly strategyIndex: number;
}

export function resolve(anchor: Anchor): ResolveResult | null {
  for (let i = 0; i < anchor.strategies.length; i++) {
    const strategy = anchor.strategies[i];
    if (!strategy) continue;

    let el: Element | null;
    try {
      el = strategy();
    } catch {
      // Strategies that throw are skipped — defensive against jsdom or
      // page states where querySelector arguments aren't yet valid.
      continue;
    }
    if (!el) continue;

    let valid: boolean;
    try {
      valid = anchor.validate(el);
    } catch {
      continue;
    }
    if (!valid) continue;

    return { element: el, strategyIndex: i };
  }
  return null;
}
