// Unit suite for the tab-based OAuth flow (no `identity` API — Firefox
// Android lacks it). Covers the full capture state machine: happy path,
// duplicate onUpdated events, consent denial, CSRF nonce mismatch, tab
// closed mid-flow, worker-restart resilience (pending record persisted in
// session storage, no in-memory resolver), superseded double-connect,
// stale-pending rejection, and the unconfigured / permission-revoked
// pre-flights.

import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';
import { storage } from 'wxt/utils/storage';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProviderState } from '@/shared/storage';

// config.ts captures import.meta.env at module load, so credentials are
// forced by mocking the module (everything else passes through).
const mocks = vi.hoisted(() => ({ configured: true }));
vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    isConfigured: () => mocks.configured,
  };
});

import { AUTHORIZE_URL, OAUTH_FLOW_TIMEOUT_MS, OAUTH_REDIRECT_URI } from './config';
import { authorize, wireOAuthCapture } from './oauth';

// Mirrors the (module-private) pending-flow session item in oauth.ts —
// needed to simulate a flow whose worker died (seed the record directly)
// and to assert cleanup.
const PENDING_KEY = 'session:todotube:oauth:ticktick:pending';

interface SeededPending {
  state: string;
  tabId: number;
  createdAt: number;
}

const fetchMock = vi.fn();

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
}

function stubPermissions(granted: boolean): void {
  fakeBrowser.permissions = {
    contains: async () => granted,
  } as unknown as typeof fakeBrowser.permissions;
}

function redirectUrl(params: Record<string, string>): string {
  const u = new URL(OAUTH_REDIRECT_URI);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function fakeTab(id: number): Browser.tabs.Tab {
  return { id } as Browser.tabs.Tab;
}

async function triggerRedirect(tabId: number, url: string): Promise<void> {
  await fakeBrowser.tabs.onUpdated.trigger(tabId, { url }, fakeTab(tabId));
}

let createSpy: ReturnType<typeof vi.spyOn<typeof fakeBrowser.tabs, 'create'>>;
// fake-browser's tabs.remove throws internally (it looks up a window by the
// TAB id), and production always `.catch()`es it — so stub it to a no-op and
// assert intent via the spy instead of inspecting fake-browser's tab store.
let removeSpy: ReturnType<typeof vi.spyOn<typeof fakeBrowser.tabs, 'remove'>>;

// Kick off authorize() and wait until the consent tab exists AND the
// pending record is persisted (authorize writes it after tabs.create —
// triggering the redirect before that write would race the capture).
async function startFlow(call = 0) {
  const promise = authorize();
  const consentUrl = await vi.waitFor(() => {
    const args = createSpy.mock.calls[call]?.[0];
    expect(args?.url).toBeDefined();
    return args!.url!;
  });
  const tab = await createSpy.mock.results[call]!.value;
  await vi.waitFor(async () => {
    expect(await storage.getItem<SeededPending>(PENDING_KEY)).not.toBeNull();
  });
  const state = new URL(consentUrl).searchParams.get('state')!;
  return { promise, tabId: tab.id as number, consentUrl, state };
}

beforeEach(() => {
  fakeBrowser.reset(); // also drops tab listeners → re-wire per test
  mocks.configured = true;
  stubPermissions(true);
  fetchMock.mockReset().mockResolvedValue(tokenResponse());
  vi.stubGlobal('fetch', fetchMock);
  createSpy = vi.spyOn(fakeBrowser.tabs, 'create');
  removeSpy = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  wireOAuthCapture();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authorize', () => {
  it('completes the happy path: consent tab → redirect → tokens persisted, tab closed', async () => {
    const { promise, tabId, consentUrl, state } = await startFlow();

    expect(consentUrl.startsWith(AUTHORIZE_URL)).toBe(true);
    const params = new URL(consentUrl).searchParams;
    expect(params.get('redirect_uri')).toBe(OAUTH_REDIRECT_URI);
    expect(params.get('response_type')).toBe('code');
    expect(state).toMatch(/^[0-9a-f]{32}$/);

    await triggerRedirect(tabId, redirectUrl({ code: 'the-code', state }));

    const r = await promise;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.accessToken).toBe('tok');

    // Tokens persisted (the durable success signal for watchers).
    expect((await getProviderState('ticktick')).tokens?.accessToken).toBe('tok');

    // Exchange hit the token endpoint once, with the code + redirect URI.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
    expect(body).toContain(encodeURIComponent(OAUTH_REDIRECT_URI));

    // Consent tab closed; pending record cleared.
    expect(removeSpy).toHaveBeenCalledWith(tabId);
    expect(await storage.getItem<SeededPending>(PENDING_KEY)).toBeNull();
  });

  it('dedupes duplicate onUpdated events for one navigation (single token exchange)', async () => {
    const { promise, tabId, state } = await startFlow();
    const url = redirectUrl({ code: 'c', state });

    // Chrome fires url@loading and again at status complete.
    await Promise.all([triggerRedirect(tabId, url), triggerRedirect(tabId, url)]);

    const r = await promise;
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats ?error= callbacks (user clicked Deny) as terminal', async () => {
    const { promise, tabId, state } = await startFlow();

    await triggerRedirect(tabId, redirectUrl({ error: 'access_denied', state }));

    const r = await promise;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('access_denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a state nonce mismatch without exchanging the code', async () => {
    const { promise, tabId } = await startFlow();

    await triggerRedirect(tabId, redirectUrl({ code: 'c', state: 'attacker-guess' }));

    const r = await promise;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('nonce mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels when the consent tab is closed', async () => {
    const { promise, tabId } = await startFlow();

    // Simulate the user closing the tab (drive onRemoved directly rather
    // than tabs.remove, whose fake-browser impl throws — see removeSpy).
    await fakeBrowser.tabs.onRemoved.trigger(tabId, { windowId: 0, isWindowClosing: false });

    const r = await promise;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('closed');
    expect(await storage.getItem<SeededPending>(PENDING_KEY)).toBeNull();
  });

  it('completes a flow whose worker died mid-login (pending record, no resolver)', async () => {
    // Simulate the restart: the pending record survived in session storage,
    // but no authorize() promise exists in this (fresh) worker.
    await storage.setItem<SeededPending>(PENDING_KEY, {
      state: 'persisted-nonce',
      tabId: 123,
      createdAt: Date.now(),
    });

    await triggerRedirect(123, redirectUrl({ code: 'c', state: 'persisted-nonce' }));

    await vi.waitFor(async () => {
      expect((await getProviderState('ticktick')).tokens?.accessToken).toBe('tok');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supersedes an in-flight attempt when Connect is clicked again', async () => {
    const first = await startFlow(0);
    const second = await startFlow(1);

    const r1 = await first.promise;
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error).toContain('Superseded');
    expect(removeSpy).toHaveBeenCalledWith(first.tabId);

    await triggerRedirect(second.tabId, redirectUrl({ code: 'c2', state: second.state }));
    const r2 = await second.promise;
    expect(r2.ok).toBe(true);
  });

  it('rejects a redirect for a pending record older than the flow timeout', async () => {
    await storage.setItem<SeededPending>(PENDING_KEY, {
      state: 'old-nonce',
      tabId: 7,
      createdAt: Date.now() - OAUTH_FLOW_TIMEOUT_MS - 1,
    });

    await triggerRedirect(7, redirectUrl({ code: 'c', state: 'old-nonce' }));

    await vi.waitFor(async () => {
      expect(await storage.getItem<SeededPending>(PENDING_KEY)).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getProviderState('ticktick')).tokens).toBeUndefined();
  });

  it('fails fast when CLIENT_ID/SECRET are not configured', async () => {
    mocks.configured = false;

    const r = await authorize();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('CLIENT_ID');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('fails fast when the ticktick.com host permission was revoked', async () => {
    stubPermissions(false);

    const r = await authorize();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('ticktick.com');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('ignores redirects for tabs it did not open', async () => {
    const { promise, tabId, state } = await startFlow();

    // A random other tab navigating to the callback URL must not consume
    // the pending flow.
    await triggerRedirect(tabId + 999, redirectUrl({ code: 'evil', state }));
    expect(fetchMock).not.toHaveBeenCalled();

    // The real flow still completes.
    await triggerRedirect(tabId, redirectUrl({ code: 'c', state }));
    const r = await promise;
    expect(r.ok).toBe(true);
  });
});
