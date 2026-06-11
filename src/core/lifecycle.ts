// Content-script lifecycle. Orchestrates one tab's worth of activity:
//   - watches URL changes (YouTube SPA navigation) and mounts/unmounts
//     panels in the right rail and (when the video ends) the endscreen
//   - hydrates state from the background on start and reacts to its
//     broadcasts (SETTINGS_CHANGED, TASKS_UPDATED, AUTH_REQUIRED)
//   - drives the panel state machine (loading → disconnected | list |
//     empty | error) via `updatePanel(root, state)` calls
//
// Optimistic UI for completion: clicking a task removes it from the
// local list immediately, then sends COMPLETE_TASK. On failure the
// task is restored and a brief error state is shown.

import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { isActiveTab } from '@/shared/active-tab';
import { formatBudgetClock, remainingBudgetMs } from '@/shared/budget';
import { log, setVerbose } from '@/shared/logger';
import { onBroadcast, sendToBackground, type Broadcast } from '@/shared/messaging';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import type {
  ClickBehavior,
  GateEvalResult,
  ListId,
  Project,
  ProviderId,
  Task,
} from '@/shared/types';
import {
  mountEndscreen,
  mountRightRail,
  SelectorMissError,
  type MountHandle,
} from '@/surfaces/desktop-watch/adapter';
import {
  onEndscreenReady,
  onNavigate,
  type EndscreenTrigger,
} from '@/surfaces/desktop-watch/triggers';
import {
  panelCss,
  renderPanel,
  renderPeekChip,
  type PanelHeader,
  type PanelState,
} from '@/ui/panel';

const WATCH_PATH = '/watch';
// Trailing throttle for the DOM watcher's mount attempts. YouTube's DOM is
// chatty (progress bar, chat), so the MutationObserver coalesces bursts into
// at most one cheap resolve pass per interval.
const DOM_WATCH_THROTTLE_MS = 250;
// A cold MV3 service worker can miss the very first message after browser
// or extension startup, so we retry the initial GET_STATE a few times.
const GET_STATE_RETRY_INTERVAL_MS = 300;
const GET_STATE_RETRY_ATTEMPTS = 6;
const DEFAULT_PROVIDER: ProviderId = DEFAULT_PROVIDER_ID;

type UIState =
  | { kind: 'loading' }
  | { kind: 'disconnected' }
  | { kind: 'list'; tasks: Task[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

interface State {
  ctx: ContentScriptContext;

  enabled: boolean;
  replaceRightRail: boolean;
  replaceEndscreen: boolean;
  authenticated: boolean;
  clickBehavior: ClickBehavior;
  providerId: ProviderId;
  listId: ListId;
  tasks: Task[];
  // Projects available to the in-panel list picker. Empty until the
  // first successful LIST_PROJECTS call after authentication.
  projects: Project[];
  // YouTube milliseconds left today per the active budget gate; null when
  // gating is off or the gate isn't budget-style (then no banner is shown).
  // Decremented locally each second and re-synced on GATE_CHANGED.
  budgetMsLeft: number | null;
  ui: UIState;

  rightRailMount: MountHandle | null;
  endscreenMount: MountHandle | null;
  endscreenTrigger: EndscreenTrigger | null;
  // Last href seen by handleNavigation — dedupes the two navigation
  // sources (YouTube's navigate event + the wxt:locationchange poll).
  lastHref: string;
  // Watches the page DOM for the anchors we still need (rail, player).
  // Non-null only while something is pending; disposed once all work is
  // done or the user leaves the watch page.
  domWatcher: { dispose: () => void } | null;
  // True while the user "peeks" at the native recommendations: the rail
  // slot is revealed and the panel shows only the back-to-tasks chip.
  // Per-video — reset on every navigation.
  peeking: boolean;
}

export function start(ctx: ContentScriptContext): void {
  log.info('Lifecycle started');

  const state: State = {
    ctx,
    enabled: false,
    replaceRightRail: true,
    replaceEndscreen: true,
    authenticated: false,
    clickBehavior: 'complete',
    providerId: DEFAULT_PROVIDER,
    listId: getProviderDescriptor(DEFAULT_PROVIDER).defaultListId,
    tasks: [],
    projects: [],
    budgetMsLeft: null,
    ui: { kind: 'loading' },
    rightRailMount: null,
    endscreenMount: null,
    endscreenTrigger: null,
    lastHref: window.location.href,
    domWatcher: null,
    peeking: false,
  };

  void initState(state);

  // Live budget countdown: tick the on-screen clock down each second while
  // the tab is actually consuming budget. Cheap — updates one text node.
  ctx.setInterval(() => {
    if (state.ctx.isValid) tickBudget(state);
  }, 1000);

  // Two navigation sources funneled through one href-deduped handler:
  // YouTube's own navigate-finish event (fast, fires when the new page
  // is ready; see NAVIGATE_FINISH_EVENT) and WXT's 1-second URL poll as
  // a safety net.
  const navTrigger = onNavigate(() => handleNavigation(state));
  ctx.addEventListener(window, 'wxt:locationchange', () => handleNavigation(state));

  const offBroadcast = onBroadcast((msg) => broadcastHandlers[msg.type](state, msg as never));

  ctx.onInvalidated(() => {
    log.debug('script invalidated; tearing down');
    navTrigger.dispose();
    offBroadcast();
    teardown(state);
  });
}

function handleNavigation(state: State): void {
  const href = window.location.href;
  if (href === state.lastHref) return;
  log.debug('navigation:', href);
  state.lastHref = href;
  perNavigationReset(state);
  evaluate(state);
}

// Cleanup that must happen once per navigation, before re-evaluating:
// the endscreen trigger is single-shot (and its mount belongs to the
// previous video), and peek is a per-video escape hatch.
function perNavigationReset(state: State): void {
  unmountEndscreen(state);
  if (state.peeking) onPeekBack(state);
  disposeDomWatcher(state);
}

async function initState(state: State): Promise<void> {
  // Without this retry, a single failed GET_STATE leaves `state.enabled`
  // at its `false` default forever: every later `evaluate()` (incl. SPA
  // locationchange) short-circuits to teardown, so panels never mount
  // until a manual reload warms the worker. That is the "doesn't work
  // until I refresh" symptom.
  let r = await sendToBackground({ type: 'GET_STATE' });
  for (let attempt = 1; attempt < GET_STATE_RETRY_ATTEMPTS && !r.ok; attempt++) {
    if (!state.ctx.isValid) return;
    log.debug('GET_STATE attempt', attempt, 'failed; retrying:', r.error);
    await delay(GET_STATE_RETRY_INTERVAL_MS);
    r = await sendToBackground({ type: 'GET_STATE' });
  }
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    log.warn('GET_STATE failed after', GET_STATE_RETRY_ATTEMPTS, 'attempts:', r.error);
    return;
  }
  const { settings, authenticated, activeListId } = r.value;
  setVerbose(settings.verboseLogging);
  state.enabled = settings.enabled;
  state.replaceRightRail = settings.replaceRightRail;
  state.replaceEndscreen = settings.replaceEndscreen;
  state.clickBehavior = settings.clickBehavior;
  state.authenticated = authenticated;
  if (settings.activeProviderId) state.providerId = settings.activeProviderId;
  if (activeListId) state.listId = activeListId;
  evaluate(state);
  void fetchGate(state);
  if (authenticated) void loadProjects(state);
}

// Pull the current gate decision so the panel can show the remaining
// YouTube budget. Cheap (the background already has the decision); the
// 1-minute GATE_CHANGED broadcast keeps it fresh thereafter.
async function fetchGate(state: State): Promise<void> {
  const r = await sendToBackground({ type: 'GATE_EVAL' });
  if (!state.ctx.isValid || !r.ok) return;
  applyGate(state, r.value);
}

// One handler per broadcast type, dispatched by `broadcastHandlers` below.
// Each mutates `state` for its message and re-renders/fetches as needed; the
// per-type guards (provider/list match) live inside the relevant handler.
function applySettingsChanged(
  state: State,
  msg: Extract<Broadcast, { type: 'SETTINGS_CHANGED' }>,
): void {
  setVerbose(msg.settings.verboseLogging);
  state.enabled = msg.settings.enabled;
  state.replaceRightRail = msg.settings.replaceRightRail;
  state.replaceEndscreen = msg.settings.replaceEndscreen;
  state.clickBehavior = msg.settings.clickBehavior;
  if (msg.settings.activeProviderId) state.providerId = msg.settings.activeProviderId;
  evaluate(state);
}

function applyListChanged(state: State, msg: Extract<Broadcast, { type: 'LIST_CHANGED' }>): void {
  if (msg.providerId === state.providerId && msg.listId !== state.listId) {
    state.listId = msg.listId;
    void fetchTasks(state);
  }
}

function applyTasksUpdated(state: State, msg: Extract<Broadcast, { type: 'TASKS_UPDATED' }>): void {
  if (msg.providerId === state.providerId && msg.listId === state.listId) {
    state.tasks = msg.tasks;
    setUi(state, msg.tasks.length === 0 ? { kind: 'empty' } : { kind: 'list', tasks: msg.tasks });
  }
}

function applyAuthRequired(state: State, msg: Extract<Broadcast, { type: 'AUTH_REQUIRED' }>): void {
  if (msg.providerId === state.providerId) {
    state.authenticated = false;
    setUi(state, { kind: 'disconnected' });
  }
}

// Dispatch table for background broadcasts. The mapped type makes a missing or
// extra key a compile error, so a new Broadcast variant must be handled here.
const broadcastHandlers: {
  [T in Broadcast['type']]: (state: State, msg: Extract<Broadcast, { type: T }>) => void;
} = {
  SETTINGS_CHANGED: applySettingsChanged,
  LIST_CHANGED: applyListChanged,
  TASKS_UPDATED: applyTasksUpdated,
  AUTH_REQUIRED: applyAuthRequired,
  GATE_CHANGED: (state, msg) => applyGate(state, msg.result),
};

function applyGate(state: State, result: GateEvalResult): void {
  const next = remainingBudgetMs(result);
  // Re-sync to the authoritative figure and re-render the banner. A full
  // re-render here is fine — GATE_CHANGED fires ~once a minute, not per second.
  if (next === state.budgetMsLeft) return;
  state.budgetMsLeft = next;
  setUi(state, state.ui);
}

// Per-second countdown. Gated on the same `isActiveTab()` condition as the
// background's watch-time accrual so the on-screen clock matches the budget
// actually being spent; updates only the value node so task rows aren't rebuilt
// every second.
function tickBudget(state: State): void {
  // No panel mounted (e.g. off the watch page) → nothing to display, so don't
  // mutate the countdown; GATE_CHANGED will resync it when a panel returns.
  if (!state.rightRailMount && !state.endscreenMount) return;
  if (state.budgetMsLeft === null || state.budgetMsLeft <= 0) return;
  if (!isActiveTab()) return;
  state.budgetMsLeft = Math.max(0, state.budgetMsLeft - 1000);
  const text = formatBudgetClock(state.budgetMsLeft);
  for (const mount of [state.rightRailMount, state.endscreenMount]) {
    const node = mount?.root.querySelector('.tt-panel__budget-value');
    if (node) node.textContent = text;
  }
}

async function loadProjects(state: State): Promise<void> {
  const r = await sendToBackground({ type: 'LIST_PROJECTS', providerId: state.providerId });
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    log.debug('LIST_PROJECTS failed:', r.error);
    return;
  }
  state.projects = r.value;
  // Re-render so the new project list reaches the in-panel picker.
  setUi(state, state.ui);
}

function evaluate(state: State): void {
  if (!state.enabled || !isWatchPage()) {
    teardown(state);
    return;
  }

  // Self-heal: YouTube occasionally rebuilds the rail subtree in place
  // (watch→watch navigation, layout experiments), orphaning our host.
  // `isConnected` on the shadow-tree root reflects host connectivity.
  if (state.rightRailMount && !state.rightRailMount.root.isConnected) {
    unmountRightRail(state);
  }

  if (!state.replaceRightRail && state.rightRailMount) {
    unmountRightRail(state);
  }
  if (!state.replaceEndscreen) {
    unmountEndscreen(state);
  }

  // Mount whatever is mountable right now; keep a DOM watcher alive while
  // anything is still pending (YouTube hydrates the watch page lazily, so
  // anchors can appear many seconds after navigation — never give up).
  if (attemptPendingWork(state)) {
    disposeDomWatcher(state);
  } else {
    ensureDomWatcher(state);
  }

  // Re-render mounted panels and kick off a fetch if we have a panel
  // to show data in.
  refreshUi(state);
}

// One pass over the work that may be blocked on YouTube's lazy DOM.
// Returns true when nothing is left to wait for.
function attemptPendingWork(state: State): boolean {
  let done = true;
  if (state.replaceRightRail && !state.rightRailMount) {
    done = tryMountRightRail(state) && done;
  }
  if (state.replaceEndscreen && !state.endscreenTrigger) {
    done = tryArmEndscreenTrigger(state) && done;
  }
  return done;
}

// Returns false only when waiting longer could help (anchor not in the
// DOM yet). Unexpected errors are terminal for the watcher — observing
// more mutations won't fix a bug.
function tryMountRightRail(state: State): boolean {
  try {
    state.rightRailMount = mountRightRail({ cssText: panelCss });
  } catch (err) {
    if (err instanceof SelectorMissError) return false;
    log.warn('Unexpected right-rail mount error:', err);
    return true;
  }
  renderPanel(state.rightRailMount.root, toPanelState(state, 'rail'));
  log.info('Right rail mounted (strategy', state.rightRailMount.strategyIndex, ')');
  refreshUi(state);
  return true;
}

function tryArmEndscreenTrigger(state: State): boolean {
  const trigger = onEndscreenReady(() => {
    if (state.endscreenMount) return;
    try {
      state.endscreenMount = mountEndscreen({ cssText: panelCss });
      renderPanel(state.endscreenMount.root, toPanelState(state, 'endscreen'));
      log.info('Endscreen mounted (strategy', state.endscreenMount.strategyIndex, ')');
    } catch (err) {
      if (!(err instanceof SelectorMissError)) {
        log.warn('Unexpected endscreen mount error:', err);
      }
    }
  });
  // null = the video element isn't in the DOM yet; the watcher re-arms.
  if (!trigger) return false;
  state.endscreenTrigger = trigger;
  return true;
}

function ensureDomWatcher(state: State): void {
  if (state.domWatcher) return;

  let lastAttempt = performance.now();
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    const wait = Math.max(0, DOM_WATCH_THROTTLE_MS - (performance.now() - lastAttempt));
    state.ctx.setTimeout(() => {
      pending = false;
      lastAttempt = performance.now();
      if (!state.ctx.isValid || !state.domWatcher) return;
      if (!state.enabled || !isWatchPage()) {
        disposeDomWatcher(state);
        return;
      }
      if (attemptPendingWork(state)) disposeDomWatcher(state);
    }, wait);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  state.domWatcher = { dispose: () => observer.disconnect() };
}

function disposeDomWatcher(state: State): void {
  state.domWatcher?.dispose();
  state.domWatcher = null;
}

function unmountRightRail(state: State): void {
  if (state.rightRailMount) {
    try {
      state.rightRailMount.unmount();
    } catch (err) {
      log.warn('right rail cleanup:', err);
    }
  }
  state.rightRailMount = null;
  state.peeking = false;
}

function unmountEndscreen(state: State): void {
  state.endscreenTrigger?.dispose();
  state.endscreenTrigger = null;
  if (state.endscreenMount) {
    try {
      state.endscreenMount.unmount();
    } catch (err) {
      log.warn('endscreen cleanup:', err);
    }
  }
  state.endscreenMount = null;
}

function teardown(state: State): void {
  disposeDomWatcher(state);
  unmountRightRail(state);
  unmountEndscreen(state);
}

function refreshUi(state: State): void {
  if (!state.authenticated) {
    setUi(state, { kind: 'disconnected' });
    return;
  }
  if (state.tasks.length > 0) {
    setUi(state, { kind: 'list', tasks: state.tasks });
  } else if (state.ui.kind === 'loading') {
    // First mount after auth — actually fetch tasks.
    void fetchTasks(state);
  }
  // else keep current UI (empty / error) until a refresh delivers data
}

async function fetchTasks(state: State): Promise<void> {
  setUi(state, { kind: 'loading' });
  const r = await sendToBackground({
    type: 'LIST_TASKS',
    providerId: state.providerId,
    listId: state.listId,
  });
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    setUi(state, { kind: 'error', message: r.error });
    return;
  }
  state.tasks = r.value;
  setUi(state, r.value.length === 0 ? { kind: 'empty' } : { kind: 'list', tasks: r.value });
}

function setUi(state: State, ui: UIState): void {
  state.ui = ui;
  // While peeking the rail shows only the back-to-tasks chip — don't let
  // broadcast-driven re-renders clobber it. The fresh state is picked up
  // when the user returns (onPeekBack re-renders from state).
  if (state.rightRailMount && !state.peeking) {
    renderPanel(state.rightRailMount.root, toPanelState(state, 'rail'));
  }
  if (state.endscreenMount) {
    renderPanel(state.endscreenMount.root, toPanelState(state, 'endscreen'));
  }
}

// Which mount the panel state is being built for. The peek affordance
// only makes sense where the panel replaced the native content in-place
// (the rail) — the endscreen header never gets it.
type PanelSurface = 'rail' | 'endscreen';

function toPanelState(state: State, surface: PanelSurface): PanelState {
  switch (state.ui.kind) {
    case 'loading':
      return { kind: 'loading', header: buildHeader(state, surface) };
    case 'disconnected':
      return {
        kind: 'disconnected',
        providerName: getProviderDescriptor(state.providerId).displayName,
        onConnect: () => void onConnectClick(state),
      };
    case 'empty':
      return { kind: 'empty', header: buildHeader(state, surface) };
    case 'list':
      return {
        kind: 'list',
        tasks: state.ui.tasks,
        onComplete: (t) => void onCompleteClick(state, t),
        onOpenTask: state.clickBehavior === 'open' ? (t) => openTask(state, t) : undefined,
        header: buildHeader(state, surface),
      };
    case 'error':
      return {
        kind: 'error',
        message: state.ui.message,
        onRetry: () => void fetchTasks(state),
        header: buildHeader(state, surface),
      };
  }
}

function buildHeader(state: State, surface: PanelSurface): PanelHeader | undefined {
  if (!state.authenticated) return undefined;
  const provider = getProviderDescriptor(state.providerId);
  return {
    projects: state.projects,
    currentListId: state.listId,
    providerName: provider.displayName,
    webAppUrl: provider.webAppUrl,
    smartListCaption: provider.smartListCaption,
    budgetMsLeft: state.budgetMsLeft ?? undefined,
    onListChange: (listId) => void onListPicked(state, listId),
    onRefresh: () => {
      void loadProjects(state);
      void fetchTasks(state);
    },
    onPeek: surface === 'rail' ? () => onPeekClick(state) : undefined,
    onClose: surface === 'endscreen' ? () => onEndscreenClose(state) : undefined,
  };
}

// "Peek at recommendations": reveal the native rail under our host and
// swap the panel for a slim chip with the way back. Per-video — see
// perNavigationReset.
function onPeekClick(state: State): void {
  const mount = state.rightRailMount;
  if (!mount || state.peeking) return;
  state.peeking = true;
  mount.reveal();
  renderPeekChip(mount.root, { onBack: () => onPeekBack(state) });
}

// Close the endscreen task overlay and hand the player back to the user:
// unmounting restores the native ended screen (slot visibility), so they
// can scrub back and rewatch. Re-arm so the panel returns if the video
// re-enters its ended state later — safe because the trigger fires only on
// a transition, and the player is still ended right after close.
function onEndscreenClose(state: State): void {
  unmountEndscreen(state);
  if (state.replaceEndscreen) tryArmEndscreenTrigger(state);
}

function onPeekBack(state: State): void {
  state.peeking = false;
  const mount = state.rightRailMount;
  if (!mount) return;
  mount.conceal();
  renderPanel(mount.root, toPanelState(state, 'rail'));
}

async function onConnectClick(state: State): Promise<void> {
  setUi(state, { kind: 'loading' });
  const r = await sendToBackground({ type: 'AUTH_START', providerId: state.providerId });
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    setUi(state, { kind: 'error', message: r.error });
    return;
  }
  state.authenticated = r.value.authenticated;
  if (state.authenticated) {
    void loadProjects(state);
    await fetchTasks(state);
  } else {
    setUi(state, { kind: 'disconnected' });
  }
}

async function onListPicked(state: State, listId: ListId): Promise<void> {
  if (listId === state.listId) return;
  // Persist via background; the storage watcher there will broadcast
  // LIST_CHANGED and our own broadcast handler will fetchTasks. Going
  // through this single path keeps every open YouTube tab + Settings in
  // sync without us duplicating the fetch here.
  const r = await sendToBackground({
    type: 'SET_ACTIVE_LIST',
    providerId: state.providerId,
    listId,
  });
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    setUi(state, { kind: 'error', message: r.error });
  }
}

// clickBehavior = "open": open the task in the provider's web app instead
// of completing it. The checkbox still completes — this is the title click.
function openTask(state: State, task: Task): void {
  const url = getProviderDescriptor(state.providerId).taskUrl(task.projectId, task.id);
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function onCompleteClick(state: State, task: Task): Promise<void> {
  // Optimistic: remove from the local list and re-render.
  const previous = state.tasks;
  state.tasks = previous.filter((t) => t.id !== task.id);
  setUi(state, state.tasks.length === 0 ? { kind: 'empty' } : { kind: 'list', tasks: state.tasks });

  const r = await sendToBackground({
    type: 'COMPLETE_TASK',
    providerId: state.providerId,
    projectId: task.projectId,
    taskId: task.id,
  });
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    // Revert and surface the error.
    state.tasks = previous;
    setUi(state, { kind: 'error', message: `Could not complete task: ${r.error}` });
  }
}

function isWatchPage(): boolean {
  return window.location.pathname === WATCH_PATH;
}

// Plain setTimeout (not ctx.setTimeout): the caller re-checks
// `state.ctx.isValid` after awaiting, so a stray timer on teardown is
// harmless and we avoid a promise that never resolves if ctx clears it.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
