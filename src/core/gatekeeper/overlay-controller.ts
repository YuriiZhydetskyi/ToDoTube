// Content-script side of gating. Runs on every blocked site (see
// shared/blocklist.ts), asks the background whether access is allowed, and
// shows/hides the full-page block overlay accordingly. The background is the
// source of truth for the (global, shared) budget decision; this controller
// only reflects its decisions and re-locks itself precisely when a timed
// session expires.
//
// One content script matches every blockable site, but a site only
// participates when the user has it checked in settings (gating.blockedSiteIds).
// A non-participating tab shows no overlay and reports no screen time, so only
// enabled sites feed the shared daily budget. Participation is re-checked live
// when settings change.
//
// This is the gating counterpart to core/lifecycle.ts (which drives the
// watch-page recommendation panel). The two run as separate content
// scripts and never interact.

import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { isActiveTab } from '@/shared/active-tab';
import { type BlockedSiteDef, siteForHostname } from '@/shared/blocklist';
import { log } from '@/shared/logger';
import { onBroadcast, sendToBackground } from '@/shared/messaging';
import { getSettings, onSettingsChange } from '@/shared/storage';
import { type GateEvalResult, normalizeBlockedSiteIds, type RequirementView } from '@/shared/types';
import { mountBlockOverlay, type OverlayHandle } from '@/surfaces/youtube-site/overlay';
import { blockScreenCss, renderBlockScreen, type BlockScreenCallbacks } from '@/ui/block-screen';

import { stepAccrual, USAGE_TICK_MS } from './accrual';

// A cold MV3 service worker can miss the very first message after startup,
// so we retry the initial GATE_EVAL a few times (same pattern as lifecycle).
const EVAL_RETRY_INTERVAL_MS = 300;
const EVAL_RETRY_ATTEMPTS = 6;
// Re-check slightly AFTER the reported expiry so the background's clock has
// definitely crossed `allowedUntil`.
const RELOCK_CUSHION_MS = 500;

interface State {
  ctx: ContentScriptContext;
  // Which blocked site this tab belongs to (resolved from the hostname).
  site: BlockedSiteDef;
  // True when the user has this site checked in gating.blockedSiteIds. A
  // non-participating tab is inert: no overlay, no accrual.
  participating: boolean;
  overlay: OverlayHandle | null;
  // Bumped on every apply() so a stale scheduled re-lock no-ops.
  relockToken: number;
  // True only when gating is on AND access is currently allowed — gates
  // it whether we accrue screen time.
  allowed: boolean;
  // Open accrual window: the timestamp screen time has been reported up to,
  // or null when no window is open (tab hidden/unfocused/blocked). Driven
  // by the pure reducer in accrual.ts.
  lastAt: number | null;
  // Signature of the last-rendered requirement. The 1-minute gate alarm
  // re-broadcasts an unchanged decision; skipping the re-render preserves
  // any in-flight task-button state (e.g. a row mid-completion).
  lastSig: string | null;
}

export function startGateOverlay(ctx: ContentScriptContext): void {
  const site = siteForHostname(location.hostname);
  // The content script matches every blockable site, but excludeMatches
  // (e.g. music.youtube.com) and odd subdomains can still land here — idle
  // when the host resolves to no blockable site.
  if (!site) {
    log.info('Gate overlay: host not blockable, idling:', location.hostname);
    return;
  }
  log.info('Gate overlay controller started for', site.id);
  const state: State = {
    ctx,
    site,
    participating: false,
    overlay: null,
    relockToken: 0,
    allowed: false,
    lastAt: null,
    lastSig: null,
  };

  void start(state);

  const offBroadcast = onBroadcast((msg) => {
    if (msg.type === 'GATE_CHANGED' && state.participating) apply(state, msg.result);
  });
  // Toggling this site on/off in settings takes effect live.
  const offSettings = onSettingsChange(() => void refreshParticipation(state));

  // Report screen time while this tab is the active, focused, allowed blocked
  // tab. The interval is just the reporting cadence; pump() emits the real
  // elapsed time. Flushing on visibility/focus/pagehide changes (below) makes
  // sure a partial interval before a reload or tab-switch isn't lost; pageshow
  // reopens the window when the tab is restored from the bfcache.
  ctx.setInterval(() => pump(state), USAGE_TICK_MS);
  ctx.addEventListener(document, 'visibilitychange', () => pump(state));
  ctx.addEventListener(window, 'blur', () => pump(state));
  ctx.addEventListener(window, 'focus', () => pump(state));
  ctx.addEventListener(window, 'pagehide', () => pump(state));
  ctx.addEventListener(window, 'pageshow', () => pump(state));

  ctx.onInvalidated(() => {
    offBroadcast();
    offSettings();
    state.relockToken++;
    removeOverlay(state);
  });
}

// Whether the user currently has this tab's site enabled for blocking.
async function isParticipating(site: BlockedSiteDef): Promise<boolean> {
  const settings = await getSettings();
  return normalizeBlockedSiteIds(settings.gating).includes(site.id);
}

async function start(state: State): Promise<void> {
  state.participating = await isParticipating(state.site);
  if (state.participating) await init(state);
}

// Re-evaluate participation after a settings change: start enforcing if the
// site was just enabled, or tear down (flush accrual + drop overlay) if it
// was just disabled.
async function refreshParticipation(state: State): Promise<void> {
  if (!state.ctx.isValid) return;
  const next = await isParticipating(state.site);
  if (next === state.participating) return;
  state.participating = next;
  if (next) {
    void init(state);
    return;
  }
  // No longer a blocked site: flush any open accrual window and unblock.
  state.allowed = false;
  pump(state);
  state.relockToken++;
  removeOverlay(state);
}

async function init(state: State): Promise<void> {
  let r = await sendToBackground({ type: 'GATE_EVAL' });
  for (let attempt = 1; attempt < EVAL_RETRY_ATTEMPTS && !r.ok; attempt++) {
    if (!state.ctx.isValid || !state.participating) return;
    await delay(EVAL_RETRY_INTERVAL_MS);
    r = await sendToBackground({ type: 'GATE_EVAL' });
  }
  if (!state.ctx.isValid || !state.participating) return;
  if (!r.ok) {
    log.warn('GATE_EVAL failed after retries; leaving the site unblocked:', r.error);
    return;
  }
  apply(state, r.value);
}

// Reconcile the accrual window with the current eligibility (allowed +
// active tab) and report any elapsed screen time. Called from the periodic
// interval, from visibility/focus/pagehide events, and from apply() when the
// gate decision flips. Idempotent: each call measures elapsed from the stored
// timestamp and resets it, so overlapping triggers never double-count.
function pump(state: State): void {
  if (!state.ctx.isValid) return;
  const eligible = state.allowed && isActiveTab();
  const { deltaMs, lastAt } = stepAccrual(state.lastAt, eligible, Date.now());
  state.lastAt = lastAt;
  if (deltaMs > 0) void sendToBackground({ type: 'USAGE_TICK', deltaMs });
}

function apply(state: State, result: GateEvalResult): void {
  // Invalidate any pending re-lock from a previous decision.
  state.relockToken++;
  state.allowed = result.gating && result.decision.allowed;
  // Flush the tail if access just ended; open a window if it just began.
  pump(state);

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
  if (!state.participating) return;
  const r = await sendToBackground({ type: 'GATE_EVAL' });
  if (!state.ctx.isValid || !r.ok) return;
  apply(state, r.value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
