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
import { remainingBudgetMs } from '@/shared/budget';
import { log, setVerbose } from '@/shared/logger';
import { readPlayingMedia } from '@/shared/media';
import { onBroadcast, sendToBackground } from '@/shared/messaging';
import { getSettings, onSettingsChange, setSettings } from '@/shared/storage';
import {
  DEFAULT_GATING,
  type GateEvalResult,
  normalizeBlockedSiteIds,
  type RequirementView,
  type Settings,
  type TimerCorner,
} from '@/shared/types';
import { mountBlockOverlay, type OverlayHandle } from '@/surfaces/youtube-site/overlay';
import { mountBudgetTimer, type TimerHandle } from '@/surfaces/youtube-site/timer';
import {
  budgetTimerCss,
  otherCorner,
  renderBudgetTimer,
  setTimerCorner,
  setTimerValue,
} from '@/ui/budget-timer';
import { blockScreenCss, renderBlockScreen, type BlockScreenCallbacks } from '@/ui/block-screen';

import { type MediaAccrualState, stepAccrual, stepMediaAccrual, USAGE_TICK_MS } from './accrual';

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
  // Open wall-clock accrual window (the active-tab stopwatch): the timestamp
  // screen time has been reported up to, or null when no window is open (tab
  // hidden/unfocused/blocked). Driven by stepAccrual in accrual.ts.
  lastAt: number | null;
  // Open media-playback accrual window (the inactive-tab stopwatch): tracks how
  // far an audible media element has played while the tab is backgrounded. Driven
  // by stepMediaAccrual; closed = { lastCt: null, lastWall: null }.
  media: MediaAccrualState;
  // The media element the media window is measuring, so a swapped element (SPA
  // navigation / new video) resets the baseline instead of being read as a jump.
  mediaEl: HTMLMediaElement | null;
  // Signature of the last-rendered requirement. The 1-minute gate alarm
  // re-broadcasts an unchanged decision; skipping the re-render preserves
  // any in-flight task-button state (e.g. a row mid-completion).
  lastSig: string | null;
  // --- Floating budget timer (the allowed-state counterpart of the overlay) ---
  // The mounted widget, or null when it isn't shown.
  timer: TimerHandle | null;
  // Last known remaining budget (ms), or null when the active gate carries no
  // budget figures. Ticked down locally each second between reconciliations.
  budgetMsLeft: number | null;
  // Corner the timer floats in (from settings; flipped by a tap).
  timerCorner: TimerCorner;
  // Whether the user double-tapped to hide it this visit. In-memory only, so it
  // resets on the next page load = "until the next visit".
  timerDismissed: boolean;
  // Whether the timer is enabled in settings.
  showBudgetTimer: boolean;
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
    media: { lastCt: null, lastWall: null },
    mediaEl: null,
    lastSig: null,
    timer: null,
    budgetMsLeft: null,
    timerCorner: 'right',
    timerDismissed: false,
    showBudgetTimer: true,
  };

  void start(state);

  const offBroadcast = onBroadcast((msg) => {
    if (msg.type === 'GATE_CHANGED' && state.participating) apply(state, msg.result);
  });
  // Toggling this site on/off in settings takes effect live.
  const offSettings = onSettingsChange((next) => {
    setVerbose(next.verboseLogging);
    // Timer enable/corner changes (incl. a corner flip echoed from another tab)
    // apply live without a fresh GATE_EVAL.
    applyTimerSettings(state, next);
    syncTimer(state);
    void refreshParticipation(state);
  });

  // Report budget time: active-tab wall-clock plus inactive-tab media playback
  // (see pump()). The interval is just the reporting cadence; pump() emits the
  // real elapsed time. Flushing on visibility/focus/pagehide changes (below)
  // ensures a partial interval before a reload or tab-switch isn't lost AND is the
  // reconcile-on-resume for mobile: while backgrounded the interval is throttled
  // or frozen, so the visibility/focus/pageshow pump on return flushes the media
  // time that played in between. pageshow also reopens after a bfcache restore.
  ctx.setInterval(() => pump(state), USAGE_TICK_MS);
  ctx.addEventListener(document, 'visibilitychange', () => pump(state));
  ctx.addEventListener(window, 'blur', () => pump(state));
  ctx.addEventListener(window, 'focus', () => pump(state));
  ctx.addEventListener(window, 'pagehide', () => pump(state));
  ctx.addEventListener(window, 'pageshow', () => pump(state));

  // Smooth per-second countdown for the floating timer between the background's
  // ~1-minute GATE_CHANGED reconciliations (mirrors lifecycle's tickBudget).
  ctx.setInterval(() => tickTimer(state), 1000);

  ctx.onInvalidated(() => {
    offBroadcast();
    offSettings();
    state.relockToken++;
    removeOverlay(state);
    removeTimer(state);
  });
}

// Whether the user currently has this tab's site enabled for blocking.
async function isParticipating(site: BlockedSiteDef): Promise<boolean> {
  const settings = await getSettings();
  return normalizeBlockedSiteIds(settings.gating).includes(site.id);
}

async function start(state: State): Promise<void> {
  const settings = await getSettings();
  setVerbose(settings.verboseLogging);
  applyTimerSettings(state, settings);
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
  removeTimer(state);
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

// Reconcile both accrual windows with the current eligibility and report any
// elapsed time. Called from the periodic interval, from visibility/focus/pagehide
// events, and from apply() when the gate decision flips. Idempotent: each call
// measures elapsed from the stored baselines and resets them, so overlapping
// triggers never double-count.
//
// Two mutually-exclusive stopwatches share one budget: while the tab is the active
// (visible+focused) tab we count wall-clock time (covers scrolling / paused-but-
// watching); while it's inactive but an audible media element is playing we count
// the media's playback progress instead (so a backgrounded podcast still debits).
// Because the two are gated on `active` vs `!active`, at most one delta is > 0 per
// step — the budget is never charged twice for the same moment.
function pump(state: State): void {
  if (!state.ctx.isValid) return;
  const now = Date.now();
  const active = isActiveTab();
  const m = readPlayingMedia();
  // A swapped media element (SPA navigation / next video) resets the media
  // baseline, so a currentTime discontinuity isn't mistaken for elapsed playback.
  if (m && m.el !== state.mediaEl) state.media = { lastCt: null, lastWall: null };
  if (m) state.mediaEl = m.el;

  const wall = stepAccrual(state.lastAt, state.allowed && active, now);
  state.lastAt = wall.lastAt;

  const media = stepMediaAccrual(
    state.media,
    state.allowed && !active && m !== null,
    m?.currentTime ?? 0,
    m?.playbackRate ?? 1,
    now,
  );
  state.media = { lastCt: media.lastCt, lastWall: media.lastWall };

  const deltaMs = wall.deltaMs + media.deltaMs;
  if (m || deltaMs > 0) {
    // Verbose-only: lets the user verify background accrual on a real device.
    log.debug('gate pump', {
      active,
      ct: m?.currentTime,
      rate: m?.playbackRate,
      wallMs: wall.deltaMs,
      mediaMs: media.deltaMs,
    });
  }
  if (deltaMs > 0) void sendToBackground({ type: 'USAGE_TICK', deltaMs });
}

function apply(state: State, result: GateEvalResult): void {
  // Invalidate any pending re-lock from a previous decision.
  state.relockToken++;
  state.allowed = result.gating && result.decision.allowed;
  // Flush the tail if access just ended; open a window if it just began.
  pump(state);

  // Re-sync the budget timer against the authoritative figures (resets any
  // local per-second drift accumulated since the last reconciliation).
  state.budgetMsLeft = remainingBudgetMs(result);
  syncTimer(state);

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

// --- Floating budget timer ------------------------------------------------
//
// The timer is the allowed-state counterpart of the block overlay: shown while
// access is still allowed and there's budget left to count down, hidden once
// the site is blocked (the overlay takes over) or the user dismisses it. So the
// two are mutually exclusive.

// Read the user's timer preferences off a Settings snapshot. Merged onto
// DEFAULT_GATING so installs that stored `gating` before these fields existed
// fall back cleanly (same defensiveness as normalizeBlockedSiteIds).
function applyTimerSettings(state: State, settings: Settings): void {
  const gating = { ...DEFAULT_GATING, ...settings.gating };
  state.showBudgetTimer = gating.showBudgetTimer;
  state.timerCorner = gating.budgetTimerCorner;
}

function timerVisible(state: State): boolean {
  return (
    state.showBudgetTimer &&
    state.participating &&
    state.allowed &&
    !state.timerDismissed &&
    state.budgetMsLeft !== null &&
    state.budgetMsLeft > 0
  );
}

// Mount / update / unmount the timer to match the current state.
function syncTimer(state: State): void {
  if (!timerVisible(state)) {
    removeTimer(state);
    return;
  }
  const view = { msLeft: state.budgetMsLeft ?? 0, corner: state.timerCorner };
  if (!state.timer) {
    state.timer = mountBudgetTimer({ cssText: budgetTimerCss });
    renderBudgetTimer(state.timer.root, view, {
      onToggleCorner: () => toggleTimerCorner(state),
      onDismiss: () => dismissTimer(state),
    });
    return;
  }
  // Already mounted — surgically refresh value + corner so the tap handler
  // stays attached (no full re-render).
  setTimerValue(state.timer.root, view.msLeft);
  setTimerCorner(state.timer.root, view.corner);
}

function removeTimer(state: State): void {
  if (state.timer) {
    try {
      state.timer.unmount();
    } catch (err) {
      log.warn('budget timer cleanup:', err);
    }
    state.timer = null;
  }
}

// Local 1-second countdown. Only ticks while actively accruing (allowed +
// active tab), matching the wall-clock side of pump(); the authoritative value
// reconciles on the next GATE_CHANGED.
function tickTimer(state: State): void {
  if (!state.timer || state.budgetMsLeft === null) return;
  if (!state.allowed || !isActiveTab()) return;
  state.budgetMsLeft = Math.max(0, state.budgetMsLeft - 1000);
  if (state.budgetMsLeft <= 0) {
    // Out of budget — hide; the background's re-lock raises the overlay shortly.
    syncTimer(state);
    return;
  }
  setTimerValue(state.timer.root, state.budgetMsLeft);
}

// Single tap: move to the other corner and remember it (across visits + tabs).
function toggleTimerCorner(state: State): void {
  state.timerCorner = otherCorner(state.timerCorner);
  if (state.timer) setTimerCorner(state.timer.root, state.timerCorner);
  void persistTimerCorner(state.timerCorner);
}

// Double tap: hide until the next visit (in-memory, so a reload brings it back).
function dismissTimer(state: State): void {
  state.timerDismissed = true;
  removeTimer(state);
}

async function persistTimerCorner(corner: TimerCorner): Promise<void> {
  const current = await getSettings();
  const gating = { ...DEFAULT_GATING, ...current.gating };
  await setSettings({ gating: { ...gating, budgetTimerCorner: corner } });
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
