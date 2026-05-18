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
import type { ListId, ProviderId, Task } from '@/shared/types';
import {
  mountEndscreen,
  mountRightRail,
  SelectorMissError,
  type MountHandle,
} from '@/surfaces/desktop-watch/adapter';
import { onEndscreenReady, type EndscreenTrigger } from '@/surfaces/desktop-watch/triggers';
import { createPanel, updatePanel, type PanelState } from '@/ui/panel';

const WATCH_PATH = '/watch';
const REMOUNT_RETRY_INTERVAL_MS = 250;
const REMOUNT_RETRY_DEADLINE_MS = 5_000;
const DEFAULT_PROVIDER: ProviderId = 'ticktick';
const DEFAULT_LIST: ListId = 'smart:today';

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
  providerId: ProviderId;
  listId: ListId;
  tasks: Task[];
  ui: UIState;

  rightRailPanel: HTMLElement | null;
  rightRailMount: MountHandle | null;
  endscreenPanel: HTMLElement | null;
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
    providerId: DEFAULT_PROVIDER,
    listId: DEFAULT_LIST,
    tasks: [],
    ui: { kind: 'loading' },
    rightRailPanel: null,
    rightRailMount: null,
    endscreenPanel: null,
    endscreenMount: null,
    endscreenTrigger: null,
    retryScheduled: false,
  };

  void initState(state);

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
      if (msg.settings.activeProviderId) state.providerId = msg.settings.activeProviderId;
      evaluate(state);
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
    }
  });

  ctx.onInvalidated(() => {
    log.debug('script invalidated; tearing down');
    offBroadcast();
    teardown(state);
  });
}

async function initState(state: State): Promise<void> {
  const r = await sendToBackground({ type: 'GET_STATE' });
  if (!state.ctx.isValid) return;
  if (!r.ok) {
    log.warn('GET_STATE failed:', r.error);
    return;
  }
  const { settings, authenticated } = r.value;
  setVerbose(settings.verboseLogging);
  state.enabled = settings.enabled;
  state.replaceRightRail = settings.replaceRightRail;
  state.replaceEndscreen = settings.replaceEndscreen;
  state.authenticated = authenticated;
  if (settings.activeProviderId) state.providerId = settings.activeProviderId;
  evaluate(state);
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
      const panel = createPanel(toPanelState(state));
      state.rightRailMount = mountRightRail(panel);
      state.rightRailPanel = panel;
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
      const panel = createPanel(toPanelState(state));
      state.endscreenMount = mountEndscreen(panel);
      state.endscreenPanel = panel;
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
  state.rightRailPanel = null;
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
  state.endscreenPanel = null;
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
  if (state.rightRailPanel) updatePanel(state.rightRailPanel, panelState);
  if (state.endscreenPanel) updatePanel(state.endscreenPanel, panelState);
}

function toPanelState(state: State): PanelState {
  switch (state.ui.kind) {
    case 'loading':
      return { kind: 'loading' };
    case 'disconnected':
      return { kind: 'disconnected', onConnect: () => void onConnectClick(state) };
    case 'empty':
      return { kind: 'empty' };
    case 'list':
      return {
        kind: 'list',
        tasks: state.ui.tasks,
        onComplete: (t) => void onCompleteClick(state, t),
      };
    case 'error':
      return {
        kind: 'error',
        message: state.ui.message,
        onRetry: () => void fetchTasks(state),
      };
  }
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
    await fetchTasks(state);
  } else {
    setUi(state, { kind: 'disconnected' });
  }
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
