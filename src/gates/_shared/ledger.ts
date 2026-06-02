// The continuous-credit ledger shared by budget-style gates: the blocked
// sites are allowed while time EARNED (from some activity) exceeds time SPENT
// today. Both Anki minutes and Garmin activity reduce to this same decision,
// so the math + block-screen shape lives here once. Each gate computes its
// own `earnedMs` (the interesting, gate-specific part) and supplies its own
// copy; this helper owns only the comparison and the RequirementView.

import type { GateDecision, RequirementView } from '@/shared/types';

export const MINUTE_MS = 60_000;

export const toMin = (ms: number): number => Math.round(ms / MINUTE_MS);

export interface LedgerCopy {
  // Block-screen title + detail shown when spent has caught up to earned.
  blockedTitle: string;
  blockedDetail: string;
  // Optional call-to-action on the block screen (e.g. a setup link).
  action?: RequirementView['action'];
  // Defaults to "Access unlocked" — the overlay doesn't render it.
  allowedTitle?: string;
}

// Decide access from an earned/spent budget (both in ms). Surfaces the
// budget so the overlay can show it, and a minutes-based progress meter once
// the user has spent anything.
export function ledgerDecision(earnedMs: number, spentMs: number, copy: LedgerCopy): GateDecision {
  if (earnedMs - spentMs > 0) {
    return {
      allowed: true,
      earnedMs,
      spentMs,
      requirement: { title: copy.allowedTitle ?? 'Access unlocked' },
    };
  }
  return {
    allowed: false,
    earnedMs,
    spentMs,
    requirement: {
      title: copy.blockedTitle,
      detail: copy.blockedDetail,
      progress:
        spentMs > 0 ? { current: toMin(earnedMs), target: toMin(spentMs), unit: 'min' } : undefined,
      action: copy.action,
    },
  };
}
