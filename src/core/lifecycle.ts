// Content-script lifecycle. The orchestrator for one tab's worth of
// activity. Watches URL changes (YouTube is an SPA), mounts/unmounts the
// panel into the surface adapter, and cleans up on script invalidation.
//
// For Step 4 the panel is a static placeholder. The provider/state wiring
// lands in Step 8.

import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { log } from '@/shared/logger';
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
  // Set when a retry loop is currently scheduled, so we don't pile up.
  retryScheduled: boolean;
}

export function start(ctx: ContentScriptContext): void {
  log.info('Lifecycle started');

  const state: State = { mount: null, retryScheduled: false };

  // Initial evaluation on script load.
  evaluate(ctx, state);

  // YouTube fires its own `yt-navigate-finish` and WXT bridges navigation
  // via `wxt:locationchange`. The latter is the one to trust — it fires
  // on every URL change including pushState/replaceState.
  ctx.addEventListener(window, 'wxt:locationchange', () => {
    log.debug('locationchange:', window.location.href);
    evaluate(ctx, state);
  });

  ctx.onInvalidated(() => {
    log.debug('script invalidated; tearing down');
    cleanup(state);
  });
}

function evaluate(ctx: ContentScriptContext, state: State): void {
  if (!isWatchPage()) {
    cleanup(state);
    return;
  }
  if (state.mount) {
    // Already mounted; navigation between watch pages still re-runs the
    // mount path so we land in the freshly-rendered right rail.
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
    if (!isWatchPage()) {
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
      // Selector miss — YouTube hasn't rendered the rail yet. Retry
      // briefly, then give up and leave YouTube alone.
      const elapsed = performance.now() - startTime;
      if (elapsed > REMOUNT_RETRY_DEADLINE_MS) {
        log.warn('Right rail did not appear within', REMOUNT_RETRY_DEADLINE_MS, 'ms; giving up');
        return;
      }
      state.retryScheduled = true;
      ctx.setTimeout(tick, REMOUNT_RETRY_INTERVAL_MS);
    }
  };

  // Fire the first attempt asynchronously so the caller's stack unwinds.
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
