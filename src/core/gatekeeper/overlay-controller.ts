// Content-script side of gating. Runs site-wide (every youtube.com page),
// asks the background whether YouTube is allowed, and shows/hides the
// full-page block overlay accordingly. The background is the source of
// truth; this controller only reflects its decisions and re-locks itself
// precisely when a timed session expires.
//
// This is the gating counterpart to core/lifecycle.ts (which drives the
// watch-page recommendation panel). The two run as separate content
// scripts and never interact.

import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { log } from '@/shared/logger';
import { onBroadcast, sendToBackground } from '@/shared/messaging';
import type { GateEvalResult, RequirementView } from '@/shared/types';
import { mountBlockOverlay, type OverlayHandle } from '@/surfaces/youtube-site/overlay';
import { blockScreenCss, renderBlockScreen, type BlockScreenCallbacks } from '@/ui/block-screen';

// A cold MV3 service worker can miss the very first message after startup,
// so we retry the initial GATE_EVAL a few times (same pattern as lifecycle).
const EVAL_RETRY_INTERVAL_MS = 300;
const EVAL_RETRY_ATTEMPTS = 6;
// Re-check slightly AFTER the reported expiry so the background's clock has
// definitely crossed `allowedUntil`.
const RELOCK_CUSHION_MS = 500;
// How often an active, allowed YouTube tab reports watch time to the
// background (the "spent" side of budget gates).
const USAGE_TICK_MS = 20_000;

interface State {
  ctx: ContentScriptContext;
  overlay: OverlayHandle | null;
  // Bumped on every apply() so a stale scheduled re-lock no-ops.
  relockToken: number;
  // True only when gating is on AND access is currently allowed — gates
  // it whether we accrue watch time.
  allowed: boolean;
  // Signature of the last-rendered requirement. The 1-minute gate alarm
  // re-broadcasts an unchanged decision; skipping the re-render preserves
  // any in-flight task-button state (e.g. a row mid-completion).
  lastSig: string | null;
}

export function startGateOverlay(ctx: ContentScriptContext): void {
  log.info('Gate overlay controller started');
  const state: State = { ctx, overlay: null, relockToken: 0, allowed: false, lastSig: null };

  void init(state);

  const offBroadcast = onBroadcast((msg) => {
    if (msg.type === 'GATE_CHANGED') apply(state, msg.result);
  });

  // Report watch time while this tab is the active, focused YouTube tab and
  // access is allowed. Backgrounded tabs are throttled by the browser and
  // fail the visibility/focus check, so they don't accrue.
  ctx.setInterval(() => {
    if (!ctx.isValid || !state.allowed) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    void sendToBackground({ type: 'YOUTUBE_TICK', deltaMs: USAGE_TICK_MS });
  }, USAGE_TICK_MS);

  ctx.onInvalidated(() => {
    offBroadcast();
    state.relockToken++;
    removeOverlay(state);
  });
}

async function init(state: State): Promise<void> {
  let r = await sendToBackground({ type: 'GATE_EVAL' });
  for (let attempt = 1; attempt < EVAL_RETRY_ATTEMPTS && !r.ok; attempt++) {
    if (!state.ctx.isValid) return;
    await delay(EVAL_RETRY_INTERVAL_MS);
    r = await sendToBackground({ type: 'GATE_EVAL' });
  }
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    log.warn('GATE_EVAL failed after retries; leaving YouTube unblocked:', r.error);
    return;
  }
  apply(state, r.value);
}

function apply(state: State, result: GateEvalResult): void {
  // Invalidate any pending re-lock from a previous decision.
  state.relockToken++;
  state.allowed = result.gating && result.decision.allowed;

  if (!result.gating || result.decision.allowed) {
    removeOverlay(state);
    if (result.gating && result.decision.allowedUntil) {
      scheduleRelock(state, result.decision.allowedUntil);
    }
    return;
  }

  showOverlay(state, result.decision.requirement);
}

const blockScreenCallbacks: BlockScreenCallbacks = {
  onCompleteTask: async (projectId, taskId) => {
    const r = await sendToBackground({ type: 'COMPLETE_GATE_TASK', projectId, taskId });
    return r.ok;
  },
};

function showOverlay(state: State, requirement: RequirementView): void {
  const sig = JSON.stringify(requirement);
  // Already showing this exact requirement → leave the DOM (and any
  // mid-completion button state) untouched.
  if (state.overlay && state.lastSig === sig) return;
  if (!state.overlay) {
    state.overlay = mountBlockOverlay({ cssText: blockScreenCss });
  }
  state.lastSig = sig;
  renderBlockScreen(state.overlay.root, requirement, blockScreenCallbacks);
}

function removeOverlay(state: State): void {
  state.lastSig = null;
  if (state.overlay) {
    try {
      state.overlay.unmount();
    } catch (err) {
      log.warn('block overlay cleanup:', err);
    }
    state.overlay = null;
  }
}

// When a session is granted, re-evaluate right after it expires so the
// overlay reappears without waiting for the background's 1-minute alarm.
function scheduleRelock(state: State, allowedUntil: number): void {
  const token = state.relockToken;
  const wait = Math.max(0, allowedUntil - Date.now()) + RELOCK_CUSHION_MS;
  state.ctx.setTimeout(() => {
    if (!state.ctx.isValid || token !== state.relockToken) return;
    void recheck(state);
  }, wait);
}

async function recheck(state: State): Promise<void> {
  const r = await sendToBackground({ type: 'GATE_EVAL' });
  if (!state.ctx.isValid || !r.ok) return;
  apply(state, r.value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
