// The single definition of "screen-time left today" derived from a gate
// decision, shared by the background (GET_STATE → popup countdown) and the
// watch-page panel countdown (core/lifecycle) so the two can't drift. Pure;
// depends only on the wire DTO, so it lives in `shared`.

import type { GateEvalResult } from './types';

// Milliseconds earned-but-unspent today, or null when there's no budget to
// show: gating off, or a gate whose decision carries no earned/spent figures
// (e.g. a non-budget gate, or a fail-open allow).
export function remainingBudgetMs(result: GateEvalResult): number | null {
  if (!result.gating) return null;
  const { earnedMs, spentMs } = result.decision;
  if (earnedMs === undefined || spentMs === undefined) return null;
  return Math.max(0, earnedMs - spentMs);
}

// Format a remaining-budget duration as a clock: "M:SS", or "H:MM:SS" once
// there's an hour or more. Clamps at 0. Shared by the panel banner, the
// lifecycle's per-second tick, and the popup countdown so they format alike.
export function formatBudgetClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
