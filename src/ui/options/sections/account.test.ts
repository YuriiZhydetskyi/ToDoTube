// @vitest-environment jsdom

// Regression tests for the Account section render race: two concurrent
// renders (button handler + onSettingsChange watcher) used to interleave
// their appends and duplicate every row. The section now builds detached
// and commits once, with only the newest render allowed to write.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Result } from '@/shared/result';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';

const sendToBackground = vi.fn();

// account.ts only pulls `sendToBackground` from the messaging module, so the
// mock provides just that (and keeps wxt/browser out of the test entirely).
vi.mock('@/shared/messaging', () => ({
  sendToBackground: (req: unknown) => sendToBackground(req) as Promise<Result<unknown, string>>,
}));

// Import after the mock so account.ts binds to the mocked sendToBackground.
const { renderAccountSection } = await import('./account');

const settings: Settings = DEFAULT_SETTINGS;

const ok = <T>(value: T): Result<T, string> => ({ ok: true, value });

const PROJECTS = [
  { id: 'smart:today', name: 'Today', synthetic: true },
  { id: 'p1', name: 'Work' },
];

function respondConnected(req: { type: string }): Promise<Result<unknown, string>> {
  switch (req.type) {
    case 'AUTH_STATUS':
      return Promise.resolve(ok({ authenticated: true }));
    case 'LIST_PROJECTS':
      return Promise.resolve(ok(PROJECTS));
    case 'GET_STATE':
      return Promise.resolve(ok({ activeListId: 'p1' }));
    default:
      throw new Error(`Unexpected message: ${req.type}`);
  }
}

function root(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// A few microtask turns so a resolved response lets the render run up to
// its next await (or to completion).
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  sendToBackground.mockReset();
  document.body.replaceChildren();
});

describe('renderAccountSection', () => {
  it('renders the disconnected state: connect button, no list dropdown', async () => {
    sendToBackground.mockResolvedValue(ok({ authenticated: false }));
    const el = root();
    await renderAccountSection(el, settings);

    expect(el.querySelectorAll('.tt-provider')).toHaveLength(1);
    expect(el.querySelector('button')?.textContent).toBe('Connect TickTick');
    expect(el.querySelector('.tt-pill')?.textContent).toBe('Not connected');
    expect(el.querySelector('select')).toBeNull();
  });

  it('renders the connected state with the active list pre-selected', async () => {
    sendToBackground.mockImplementation(respondConnected);
    const el = root();
    await renderAccountSection(el, settings);

    expect(el.querySelector('.tt-pill')?.textContent).toBe('Connected');
    expect(el.querySelector('button')?.textContent).toBe('Disconnect');
    const select = el.querySelector('select');
    expect(select?.value).toBe('p1');
    expect(select?.options).toHaveLength(2);
    expect(select?.options[0]?.textContent).toBe('Today (smart)');
  });

  it('does not duplicate rows when two renders overlap (the newest wins)', async () => {
    // Park each AUTH_STATUS on a manually-resolved promise so the test
    // controls the interleaving; everything downstream answers instantly.
    const authResolvers: ((r: Result<unknown, string>) => void)[] = [];
    sendToBackground.mockImplementation((req: { type: string }) => {
      if (req.type === 'AUTH_STATUS') {
        return new Promise((resolve) => authResolvers.push(resolve));
      }
      return respondConnected(req);
    });

    const el = root();
    const renderA = renderAccountSection(el, settings);
    const renderB = renderAccountSection(el, settings);
    expect(authResolvers).toHaveLength(2);

    // B (the newest render) completes first, then the stale A finishes —
    // the interleaving that used to duplicate every row.
    authResolvers[1]?.(ok({ authenticated: true }));
    await flush();
    await renderB;
    authResolvers[0]?.(ok({ authenticated: true }));
    await flush();
    await renderA;

    expect(el.querySelectorAll('.tt-provider')).toHaveLength(1);
    expect(el.querySelectorAll('select')).toHaveLength(1);
    expect(el.querySelectorAll('.tt-card__title')).toHaveLength(1);
  });
});
