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

import { log, setVerbose } from '@/shared/logger';
import { onBroadcast, sendToBackground } from '@/shared/messaging';
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
import { onEndscreenReady, type EndscreenTrigger } from '@/surfaces/desktop-watch/triggers';
import {
  formatBudgetClock,
  panelCss,
  renderPanel,
  type PanelHeader,
  type PanelState,
} from '@/ui/panel';

const WATCH_PATH = '/watch';
const REMOUNT_RETRY_INTERVAL_MS = 250;
const REMOUNT_RETRY_DEADLINE_MS = 5_000;
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
  retryScheduled: boolean;
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
    retryScheduled: false,
  };

  void initState(state);

  // Live budget countdown: tick the on-screen clock down each second while
  // the tab is actually consuming budget. Cheap — updates one text node.
  ctx.setInterval(() => {
    if (state.ctx.isValid) tickBudget(state);
  }, 1000);

  ctx.addEventListener(window, 'wxt:locationchange', () => {
    log.debug('locationchange:', window.location.href);
    evaluate(state);
  });

  const offBroadcast = onBroadcast((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      setVerbose(msg.settings.verboseLogging);
      state.enabled = msg.settings.enabled;
      state.replaceRightRail = msg.settings.replaceRightRail;
      state.replaceEndscreen = msg.settings.replaceEndscreen;
      state.clickBehavior = msg.settings.clickBehavior;
      if (msg.settings.activeProviderId) state.providerId = msg.settings.activeProviderId;
      evaluate(state);
    } else if (msg.type === 'LIST_CHANGED') {
      if (msg.providerId === state.providerId && msg.listId !== state.listId) {
        state.listId = msg.listId;
        void fetchTasks(state);
      }
    } else if (msg.type === 'TASKS_UPDATED') {
      if (msg.providerId === state.providerId && msg.listId === state.listId) {
        state.tasks = msg.tasks;
        setUi(
          state,
          msg.tasks.length === 0 ? { kind: 'empty' } : { kind: 'list', tasks: msg.tasks },
        );
      }
    } else if (msg.type === 'AUTH_REQUIRED') {
      if (msg.providerId === state.providerId) {
        state.authenticated = false;
        setUi(state, { kind: 'disconnected' });
      }
    } else if (msg.type === 'GATE_CHANGED') {
      applyGate(state, msg.result);
    }
  });

  ctx.onInvalidated(() => {
    log.debug('script invalidated; tearing down');
    offBroadcast();
    teardown(state);
  });
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

function applyGate(state: State, result: GateEvalResult): void {
  const next = remainingBudgetMs(result);
  // Re-sync to the authoritative figure and re-render the banner. A full
  // re-render here is fine — GATE_CHANGED fires ~once a minute, not per second.
  if (next === state.budgetMsLeft) return;
  state.budgetMsLeft = next;
  setUi(state, state.ui);
}

// Milliseconds earned-but-unspent today, or null when there's no budget to
// show (gating off, or a gate whose decision carries no earned/spent figures).
function remainingBudgetMs(result: GateEvalResult): number | null {
  if (!result.gating) return null;
  const { earnedMs, spentMs } = result.decision;
  if (earnedMs === undefined || spentMs === undefined) return null;
  return Math.max(0, earnedMs - spentMs);
}

// Per-second countdown. Mirrors the background's accrual condition (visible +
// focused) so the on-screen clock matches the budget actually being spent;
// updates only the value node so task rows aren't rebuilt every second.
function tickBudget(state: State): void {
  // No panel mounted (e.g. off the watch page) → nothing to display, so don't
  // mutate the countdown; GATE_CHANGED will resync it when a panel returns.
  if (!state.rightRailMount && !state.endscreenMount) return;
  if (state.budgetMsLeft === null || state.budgetMsLeft <= 0) return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
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

  if (state.replaceRightRail && !state.rightRailMount) {
    scheduleMountRightRail(state, performance.now());
  } else if (!state.replaceRightRail && state.rightRailMount) {
    unmountRightRail(state);
  }

  if (state.replaceEndscreen && !state.endscreenTrigger) {
    armEndscreenTrigger(state);
  } else if (!state.replaceEndscreen) {
    unmountEndscreen(state);
  }

  // Re-render mounted panels and kick off a fetch if we have a panel
  // to show data in.
  refreshUi(state);
}

function scheduleMountRightRail(state: State, startTime: number): void {
  if (state.retryScheduled) return;
  state.retryScheduled = true;

  const tick = (): void => {
    state.retryScheduled = false;
    if (!state.ctx.isValid) return;
    if (!state.enabled || !isWatchPage() || !state.replaceRightRail) return;
    if (state.rightRailMount) return;

    try {
      state.rightRailMount = mountRightRail({ cssText: panelCss });
      renderPanel(state.rightRailMount.root, toPanelState(state));
      log.info('Right rail mounted (strategy', state.rightRailMount.strategyIndex, ')');
      refreshUi(state);
    } catch (err) {
      if (!(err instanceof SelectorMissError)) {
        log.warn('Unexpected right-rail mount error:', err);
        return;
      }
      const elapsed = performance.now() - startTime;
      if (elapsed > REMOUNT_RETRY_DEADLINE_MS) {
        log.warn('Right rail did not appear within', REMOUNT_RETRY_DEADLINE_MS, 'ms; giving up');
        return;
      }
      state.retryScheduled = true;
      state.ctx.setTimeout(tick, REMOUNT_RETRY_INTERVAL_MS);
    }
  };

  state.ctx.setTimeout(tick, 0);
}

function armEndscreenTrigger(state: State): void {
  state.endscreenTrigger = onEndscreenReady(() => {
    if (state.endscreenMount) return;
    try {
      state.endscreenMount = mountEndscreen({ cssText: panelCss });
      renderPanel(state.endscreenMount.root, toPanelState(state));
      log.info('Endscreen mounted (strategy', state.endscreenMount.strategyIndex, ')');
    } catch (err) {
      if (!(err instanceof SelectorMissError)) {
        log.warn('Unexpected endscreen mount error:', err);
      }
    }
  });
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
  const panelState = toPanelState(state);
  if (state.rightRailMount) renderPanel(state.rightRailMount.root, panelState);
  if (state.endscreenMount) renderPanel(state.endscreenMount.root, panelState);
}

function toPanelState(state: State): PanelState {
  switch (state.ui.kind) {
    case 'loading':
      return { kind: 'loading', header: buildHeader(state) };
    case 'disconnected':
      return {
        kind: 'disconnected',
        providerName: getProviderDescriptor(state.providerId).displayName,
        onConnect: () => void onConnectClick(state),
      };
    case 'empty':
      return { kind: 'empty', header: buildHeader(state) };
    case 'list':
      return {
        kind: 'list',
        tasks: state.ui.tasks,
        onComplete: (t) => void onCompleteClick(state, t),
        onOpenTask: state.clickBehavior === 'open' ? (t) => openTask(state, t) : undefined,
        header: buildHeader(state),
      };
    case 'error':
      return {
        kind: 'error',
        message: state.ui.message,
        onRetry: () => void fetchTasks(state),
        header: buildHeader(state),
      };
  }
}

function buildHeader(state: State): PanelHeader | undefined {
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
  };
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
