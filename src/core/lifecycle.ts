// Content-script lifecycle. The orchestrator for one tab's worth of
// activity. Watches URL changes (YouTube is an SPA), reacts to settings
// changes broadcast from the background, mounts/unmounts the panel via
// the surface adapter, and cleans up on script invalidation.
//
// Provider/state rendering lands in Step 8 — the panel stays a static
// placeholder until then. What's live in Step 5: the master on/off
// toggle from settings (popup-driven in Step 10) takes effect instantly
// via the SETTINGS_CHANGED broadcast.

import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { log, setVerbose } from '@/shared/logger';
import { onBroadcast, sendToBackground } from '@/shared/messaging';
import {
  mountRightRail,
  SelectorMissError,
  type MountHandle,
} from '@/surfaces/desktop-watch/adapter';
import { createPanel } from '@/ui/panel';

const WATCH_PATH = '/watch';
const REMOUNT_RETRY_INTERVAL_MS = 250;
const REMOUNT_RETRY_DEADLINE_MS = 5_000;

interface State {
  mount: MountHandle | null;
  retryScheduled: boolean;
  enabled: boolean;
}

export function start(ctx: ContentScriptContext): void {
  log.info('Lifecycle started');

  const state: State = { mount: null, retryScheduled: false, enabled: false };

  // Pull initial state from the background (the single source of truth
  // for active provider/settings — see core/background/handlers.ts).
  void initState(ctx, state);

  ctx.addEventListener(window, 'wxt:locationchange', () => {
    log.debug('locationchange:', window.location.href);
    evaluate(ctx, state);
  });

  const offBroadcast = onBroadcast((msg) => {
    if (msg.type === 'SETTINGS_CHANGED') {
      setVerbose(msg.settings.verboseLogging);
      state.enabled = msg.settings.enabled;
      evaluate(ctx, state);
    }
  });

  ctx.onInvalidated(() => {
    log.debug('script invalidated; tearing down');
    offBroadcast();
    cleanup(state);
  });
}

async function initState(ctx: ContentScriptContext, state: State): Promise<void> {
  const r = await sendToBackground({ type: 'GET_STATE' });
  if (!ctx.isValid) return;
  if (!r.ok) {
    log.warn('GET_STATE failed:', r.error);
    return;
  }
  setVerbose(r.value.settings.verboseLogging);
  state.enabled = r.value.settings.enabled;
  evaluate(ctx, state);
}

function evaluate(ctx: ContentScriptContext, state: State): void {
  if (!state.enabled) {
    cleanup(state);
    return;
  }
  if (!isWatchPage()) {
    cleanup(state);
    return;
  }
  if (state.mount) {
    // Navigation between watch pages still re-runs the mount path so we
    // land in the freshly-rendered right rail.
    cleanup(state);
  }
  scheduleMount(ctx, state, performance.now());
}

function scheduleMount(ctx: ContentScriptContext, state: State, startTime: number): void {
  if (state.retryScheduled) return;
  state.retryScheduled = true;

  const tick = (): void => {
    state.retryScheduled = false;
    if (!ctx.isValid) return;
    if (!state.enabled || !isWatchPage()) {
      cleanup(state);
      return;
    }
    if (state.mount) return;

    try {
      const panel = createPanel({ kind: 'placeholder' });
      state.mount = mountRightRail(panel);
      log.info('Panel mounted in right rail (strategy', state.mount.strategyIndex, ')');
      return;
    } catch (err) {
      if (!(err instanceof SelectorMissError)) {
        log.warn('Unexpected mount error:', err);
        return;
      }
      const elapsed = performance.now() - startTime;
      if (elapsed > REMOUNT_RETRY_DEADLINE_MS) {
        log.warn('Right rail did not appear within', REMOUNT_RETRY_DEADLINE_MS, 'ms; giving up');
        return;
      }
      state.retryScheduled = true;
      ctx.setTimeout(tick, REMOUNT_RETRY_INTERVAL_MS);
    }
  };

  ctx.setTimeout(tick, 0);
}

function cleanup(state: State): void {
  if (!state.mount) return;
  try {
    state.mount.unmount();
  } catch (err) {
    log.warn('cleanup error:', err);
  }
  state.mount = null;
}

function isWatchPage(): boolean {
  return window.location.pathname === WATCH_PATH;
}
