// @vitest-environment jsdom
//
// Regression suite for the content-script lifecycle's SPA behavior:
//   - the rail mounts whenever YouTube hydrates it, no matter how late
//     (the old 5-second give-up was the "works only after reload" bug)
//   - watch→watch navigation unmounts the stale endscreen and re-arms
//     its single-shot trigger
//   - the two navigation sources (YouTube's navigate event + the WXT
//     locationchange poll) are deduped by href
//   - peek: reveal/restore of the native rail, per-navigation reset
//
// No YouTube literals (CI selector guard): the DOM comes from the
// baseline fixture and the navigation event name is imported.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ContentScriptContext } from 'wxt/utils/content-script-context';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { start } from '@/core/lifecycle';
import { onBroadcast, sendToBackground, type Broadcast } from '@/shared/messaging';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import { err, ok } from '@/shared/result';
import { DEFAULT_SETTINGS, type Settings, type Task } from '@/shared/types';
import { NAVIGATE_FINISH_EVENT } from '@/surfaces/desktop-watch/selectors';

vi.mock('@/shared/messaging', () => ({
  sendToBackground: vi.fn(),
  onBroadcast: vi.fn(),
}));

const fixture = readFileSync(
  join(
    process.cwd(),
    'src',
    'surfaces',
    'desktop-watch',
    '__fixtures__',
    'watch-desktop-baseline.html',
  ),
  'utf-8',
);

// jsdom does no layout — stub a generous column rect so the rail's
// geometry self-test passes (same approach as dom-fixtures.test.ts).
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const COLUMN_RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 402,
  bottom: 1200,
  width: 402,
  height: 1200,
  toJSON: () => '',
} as DOMRect;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => COLUMN_RECT;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

// ── Fake ContentScriptContext ────────────────────────────────────────
// Mimics the WXT behavior the lifecycle relies on: context-owned timers
// and listeners that stop working once the context is invalidated.

interface FakeCtx {
  isValid: boolean;
  setTimeout: (fn: () => void, ms?: number) => number;
  setInterval: (fn: () => void, ms?: number) => number;
  addEventListener: (target: EventTarget, type: string, cb: EventListener) => void;
  onInvalidated: (cb: () => void) => () => void;
  invalidate: () => void;
}

function makeCtx(): FakeCtx {
  const listeners: Array<{ target: EventTarget; type: string; cb: EventListener }> = [];
  const intervals: number[] = [];
  const invalidatedCbs: Array<() => void> = [];
  const ctx: FakeCtx = {
    isValid: true,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    setInterval: (fn, ms) => {
      const id = window.setInterval(fn, ms);
      intervals.push(id);
      return id;
    },
    addEventListener: (target, type, cb) => {
      target.addEventListener(type, cb);
      listeners.push({ target, type, cb });
    },
    onInvalidated: (cb) => {
      invalidatedCbs.push(cb);
      return () => {};
    },
    invalidate: () => {
      ctx.isValid = false;
      for (const cb of invalidatedCbs) cb();
      for (const l of listeners) l.target.removeEventListener(l.type, l.cb);
      for (const id of intervals) window.clearInterval(id);
    },
  };
  return ctx;
}

// ── Background mock ──────────────────────────────────────────────────

const settings: Settings = { ...DEFAULT_SETTINGS, activeProviderId: DEFAULT_PROVIDER_ID };
const listId = getProviderDescriptor(DEFAULT_PROVIDER_ID).defaultListId;

let tasksResponse: Task[] = [];
// GET_STATE's authenticated field — flipped to false by the disconnected
// AUTH_CHANGED recovery test.
let authedResponse = true;
let broadcastHandler: ((msg: Broadcast) => void) | null = null;

function task(id: string, title: string): Task {
  return { id, projectId: 'p1', title, completed: false };
}

function installMessagingMocks(): void {
  vi.mocked(sendToBackground).mockImplementation((async (req: { type: string }) => {
    switch (req.type) {
      case 'GET_STATE':
        return ok({
          settings,
          authenticated: authedResponse,
          activeListId: null,
          budgetMsLeft: null,
        });
      case 'LIST_TASKS':
      case 'REFRESH_NOW':
        return ok(tasksResponse);
      case 'LIST_PROJECTS':
        return err('projects not loaded in test');
      case 'GATE_EVAL':
        return err('gating off in test');
      default:
        return ok(null);
    }
  }) as typeof sendToBackground);
  vi.mocked(onBroadcast).mockImplementation((cb) => {
    broadcastHandler = cb;
    return () => {
      broadcastHandler = null;
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

let ctx: FakeCtx;

// Flushes microtasks (mock responses, MutationObserver callbacks) plus
// any short timers.
const flush = () => vi.advanceTimersByTimeAsync(5);
// Long enough for the DOM watcher's trailing throttle to fire.
const watcherTick = () => vi.advanceTimersByTimeAsync(400);

function goTo(path: string): void {
  history.pushState({}, '', path);
}

function navigateTo(path: string): void {
  goTo(path);
  window.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
}

async function boot(path: string, body: string): Promise<void> {
  goTo(path);
  document.body.innerHTML = body;
  start(ctx as unknown as ContentScriptContext);
  await flush();
  await flush();
}

function railHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-todotube-panel="rightRail"]');
}

function endscreenHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-todotube-panel="endscreen"]');
}

function railSlot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-tt-anchor="rightRail"]');
  if (!el) throw new Error('fixture has no rail marker');
  return el;
}

function video(): HTMLVideoElement {
  const el = document.querySelector('video');
  if (!el) throw new Error('fixture has no video');
  return el;
}

function moviePlayer(): HTMLElement {
  const el = document.querySelector<HTMLElement>('#movie_player');
  if (!el) throw new Error('fixture has no player');
  return el;
}

function endscreenSlot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-tt-anchor="endscreenContainer"]');
  if (!el) throw new Error('fixture has no endscreen marker');
  return el;
}

// The class the production predicate (isPlayerEnded) keys on. Confined to
// this test; constructing YouTube-shaped DOM mirrors heuristics.test.ts.
const ENDED_CLASS = 'ended-mode';

beforeEach(() => {
  vi.useFakeTimers();
  ctx = makeCtx();
  tasksResponse = [task('t1', 'Task one')];
  authedResponse = true;
  installMessagingMocks();
});

afterEach(() => {
  ctx.invalidate();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.clearAllMocks();
  broadcastHandler = null;
});

// ── Tests ────────────────────────────────────────────────────────────

describe('SPA navigation mounting', () => {
  it('mounts the rail however late YouTube hydrates it (no give-up)', async () => {
    await boot('/', '');
    expect(railHost()).toBeNull();

    navigateTo('/watch?v=1');
    await watcherTick();
    expect(railHost()).toBeNull();

    // Far past the old 5s deadline: unrelated DOM churn, still no rail.
    for (let i = 0; i < 3; i++) {
      document.body.appendChild(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(railHost()).toBeNull();

    // YouTube finally hydrates the page — the watcher must catch it.
    document.body.innerHTML = fixture;
    await watcherTick();
    expect(railHost()).not.toBeNull();
    expect(railSlot().style.display).toBe('none');
  });

  it('coalesces mutation bursts into one throttled mount attempt', async () => {
    await boot('/', '');
    navigateTo('/watch?v=1');
    await watcherTick();

    const spy = vi.spyOn(document, 'querySelector');
    for (let i = 0; i < 50; i++) document.body.appendChild(document.createElement('div'));
    await watcherTick();

    // One attempt resolves a handful of strategies; 50 unthrottled
    // attempts would be hundreds of queries.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBeLessThan(25);
    spy.mockRestore();
  });

  it('dedupes the two navigation sources for the same href', async () => {
    await boot('/', '');
    document.body.innerHTML = fixture;

    navigateTo('/watch?v=1');
    window.dispatchEvent(new Event('wxt:locationchange'));
    window.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
    await watcherTick();

    expect(document.querySelectorAll('[data-todotube-panel="rightRail"]')).toHaveLength(1);
  });

  it('tears down and stops watching when leaving the watch page', async () => {
    await boot('/watch?v=1', fixture);
    expect(railHost()).not.toBeNull();

    navigateTo('/');
    await flush();
    expect(railHost()).toBeNull();
    expect(railSlot().style.display).toBe('');

    // No zombie watcher: later DOM churn must not re-mount.
    document.body.appendChild(document.createElement('div'));
    await watcherTick();
    expect(railHost()).toBeNull();
  });

  it('unmounts the rail when SETTINGS_CHANGED turns the replacement off', async () => {
    await boot('/watch?v=1', fixture);
    expect(railHost()).not.toBeNull();

    broadcastHandler?.({
      type: 'SETTINGS_CHANGED',
      settings: { ...settings, replaceRightRail: false },
    });
    await flush();
    expect(railHost()).toBeNull();
  });
});

describe('manual refresh', () => {
  it('bypasses the task cache through REFRESH_NOW', async () => {
    await boot('/watch?v=1', fixture);
    vi.mocked(sendToBackground).mockClear();

    const host = railHost();
    if (!host?.shadowRoot) throw new Error('rail host or shadow root missing');
    host.shadowRoot.querySelector<HTMLButtonElement>('.tt-panel__refresh')?.click();
    await flush();

    expect(sendToBackground).toHaveBeenCalledWith({
      type: 'REFRESH_NOW',
      providerId: DEFAULT_PROVIDER_ID,
      listId,
    });
  });
});
describe('AUTH_CHANGED recovery', () => {
  function listTasksCalls(): number {
    return vi
      .mocked(sendToBackground)
      .mock.calls.filter(([req]) => (req as { type: string }).type === 'LIST_TASKS').length;
  }

  it('loads tasks when tokens appear after a worker-died login (disconnected → connected)', async () => {
    authedResponse = false;
    await boot('/watch?v=1', fixture);
    // Disconnected: the panel mounts a Connect CTA but never fetched tasks.
    expect(listTasksCalls()).toBe(0);

    broadcastHandler?.({
      type: 'AUTH_CHANGED',
      providerId: DEFAULT_PROVIDER_ID,
      authenticated: true,
    });
    await flush();

    // The broadcast is the only signal that flips a stale disconnected panel.
    expect(listTasksCalls()).toBeGreaterThan(0);
  });

  it('ignores AUTH_CHANGED when already authenticated (no duplicate fetch)', async () => {
    await boot('/watch?v=1', fixture); // authedResponse = true (default)
    const before = listTasksCalls();
    expect(before).toBeGreaterThan(0);

    broadcastHandler?.({
      type: 'AUTH_CHANGED',
      providerId: DEFAULT_PROVIDER_ID,
      authenticated: true,
    });
    await flush();

    expect(listTasksCalls()).toBe(before);
  });
});

describe('endscreen across navigations', () => {
  it('re-arms the single-shot trigger and unmounts the stale overlay on watch→watch', async () => {
    await boot('/watch?v=1', fixture);

    video().dispatchEvent(new Event('ended'));
    await flush();
    expect(endscreenHost()).not.toBeNull();

    navigateTo('/watch?v=2');
    await flush();
    // Stale overlay from the previous video must be gone…
    expect(endscreenHost()).toBeNull();

    // …and the re-armed trigger must fire for the next video.
    video().dispatchEvent(new Event('ended'));
    await flush();
    expect(endscreenHost()).not.toBeNull();
  });

  it('does NOT mount over the still-playing video (Bug 1 regression)', async () => {
    await boot('/watch?v=1', fixture);

    // No `ended` event and no ended-mode class — the player is playing.
    // Unrelated class churn on the player must not trigger a mount.
    moviePlayer().classList.add('ytp-autohide');
    document.body.appendChild(document.createElement('div'));
    await watcherTick();

    expect(endscreenHost()).toBeNull();
  });

  it('mounts when the player transitions into ended-mode', async () => {
    await boot('/watch?v=1', fixture);
    expect(endscreenHost()).toBeNull();

    moviePlayer().classList.add(ENDED_CLASS);
    await flush();
    expect(endscreenHost()).not.toBeNull();
  });

  it('close unmounts, restores the native screen, and re-arms without re-firing', async () => {
    await boot('/watch?v=1', fixture);
    video().dispatchEvent(new Event('ended'));
    await flush();
    const host = endscreenHost();
    if (!host?.shadowRoot) throw new Error('endscreen host missing');
    expect(endscreenSlot().style.visibility).toBe('hidden');

    host.shadowRoot.querySelector<HTMLButtonElement>('.tt-panel__close')?.click();
    await flush();
    // Overlay gone, native ended screen restored.
    expect(endscreenHost()).toBeNull();
    expect(endscreenSlot().style.visibility).toBe('');

    // Re-armed, but the player is still ended — must NOT immediately re-mount.
    await watcherTick();
    expect(endscreenHost()).toBeNull();

    // The user's repro: moving the cursor off the player makes YouTube
    // toggle autohide on the player's class list. That churn (while the
    // player merely STAYS ended) must not bring the overlay back.
    moviePlayer().classList.add('ytp-autohide');
    await flush();
    moviePlayer().classList.remove('ytp-autohide');
    await flush();
    expect(endscreenHost()).toBeNull();

    // A fresh end re-shows the panel.
    video().dispatchEvent(new Event('ended'));
    await flush();
    expect(endscreenHost()).not.toBeNull();
  });
});

describe('peek at recommendations', () => {
  function shadow(): ShadowRoot {
    const host = railHost();
    if (!host?.shadowRoot) throw new Error('rail host or shadow root missing');
    return host.shadowRoot;
  }

  it('reveals the native rail and shows the back-to-tasks chip', async () => {
    await boot('/watch?v=1', fixture);

    const peek = shadow().querySelector<HTMLButtonElement>('.tt-panel__peek');
    expect(peek).not.toBeNull();
    peek?.click();

    expect(railSlot().style.display).toBe('');
    expect(shadow().querySelector('.tt-peek')).not.toBeNull();
  });

  it('survives broadcasts while peeking and shows fresh data on return', async () => {
    await boot('/watch?v=1', fixture);
    shadow().querySelector<HTMLButtonElement>('.tt-panel__peek')?.click();

    broadcastHandler?.({
      type: 'TASKS_UPDATED',
      providerId: DEFAULT_PROVIDER_ID,
      listId,
      tasks: [task('t1', 'Task one'), task('t2', 'Task two')],
    });
    await flush();
    // The broadcast must not clobber the chip…
    expect(shadow().querySelector('.tt-peek')).not.toBeNull();

    shadow().querySelector<HTMLButtonElement>('.tt-peek__btn')?.click();
    // …and returning shows the updated list.
    expect(railSlot().style.display).toBe('none');
    expect(shadow().querySelectorAll('.tt-panel__task')).toHaveLength(2);
  });

  it('resets to tasks on the next navigation', async () => {
    await boot('/watch?v=1', fixture);
    shadow().querySelector<HTMLButtonElement>('.tt-panel__peek')?.click();
    expect(railSlot().style.display).toBe('');

    navigateTo('/watch?v=2');
    await flush();

    expect(railSlot().style.display).toBe('none');
    expect(shadow().querySelector('.tt-peek')).toBeNull();
    expect(shadow().querySelector('.tt-panel')).not.toBeNull();
  });
});
