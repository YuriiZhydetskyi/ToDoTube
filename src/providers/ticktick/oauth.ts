// TickTick OAuth2 (authorization_code flow), implemented WITHOUT the
// `identity` API — Firefox for Android doesn't support it, and TickTick's
// developer console only accepts ONE redirect URL per app, so the
// platform-specific launchWebAuthFlow redirect URIs (chromiumapp /
// allizom) couldn't all be registered anyway. One manual flow runs on
// every platform instead:
//
//   1. authorize() generates a CSRF nonce, persists a pending-flow record
//      in session storage, and opens TickTick's consent screen in a tab.
//   2. TickTick redirects the tab to OAUTH_REDIRECT_URI with ?code=&state=.
//      The path 404s on ticktick.com — irrelevant; only the URL matters.
//   3. The top-level tabs.onUpdated listener (wireOAuthCapture, registered
//      synchronously on every background wake) sees the redirect URL —
//      visible thanks to the ticktick.com host permission — closes the
//      tab, verifies the state nonce, exchanges `code` for tokens, and
//      persists them.
//
// MV3 reality check: the background can be killed while the user types
// their TickTick password (Chrome reaps idle workers after ~30s). That's
// why the pending flow lives in storage.session, not module state — the
// redirect's onUpdated event wakes a fresh worker, which completes the
// exchange from the persisted record. The original authorize() promise
// dies with the old worker; UI recovery rides the provider-state watcher
// (core broadcasts AUTH_CHANGED when tokens appear).
//
// All token reads/writes go through `@/shared/storage` so settings and
// tokens share one schema (and one place to evolve).

import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';

import { err, ok, type Result } from '@/shared/result';
import { clearProviderState, getProviderState, setProviderState } from '@/shared/storage';
import type { OAuthTokens } from '@/shared/types';

import {
  AUTHORIZE_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  isConfigured,
  OAUTH_FLOW_TIMEOUT_MS,
  OAUTH_REDIRECT_URI,
  SCOPES,
  TICKTICK_ORIGIN_PERMISSION,
  TOKEN_URL,
} from './config';

// One in-flight OAuth attempt. Session storage clears when the browser
// session ends — exactly the lifetime we want — and survives MV3
// service-worker restarts, which module state does not.
interface PendingFlow {
  // CSRF nonce; must round-trip through TickTick as `state`.
  state: string;
  // The consent tab we opened; closing it cancels the flow.
  tabId: number;
  createdAt: number;
}

const pendingFlowItem = storage.defineItem<PendingFlow | null>(
  'session:todotube:oauth:ticktick:pending',
  { fallback: null },
);

// Worker-local link from the capture listener back to the awaiting
// authorize() caller. Null when the flow outlived its worker — then the
// capture still persists tokens, and the UI catches up via watchers.
let flowResolver: ((r: Result<OAuthTokens, string>) => void) | null = null;

// Chrome fires tabs.onUpdated twice per navigation (url@loading +
// status@complete). Tracking the tabs currently being completed dedupes
// same-worker repeats synchronously (keyed per tab so an unrelated tab's
// event never blocks the real one); the read-then-clear of pendingFlowItem
// covers cross-restart repeats.
const completingTabs = new Set<number>();

export async function authorize(): Promise<Result<OAuthTokens, string>> {
  if (!isConfigured()) {
    return err('TickTick CLIENT_ID/SECRET are not set. See README → TickTick OAuth setup.');
  }

  // Firefox lets users revoke host permissions; without ticktick.com we
  // can't see the redirect URL (or call the token endpoint), so fail
  // loudly up front instead of hanging on a capture that never fires.
  const granted = await browser.permissions.contains({
    origins: [TICKTICK_ORIGIN_PERMISSION],
  });
  if (!granted) {
    return err(
      'ToDoTube needs access to ticktick.com to sign in. ' +
        'Re-enable the permission in your browser’s extension settings and retry.',
    );
  }

  // Supersede any flow already in flight: close its tab, fail its caller.
  const stale = await pendingFlowItem.getValue();
  if (stale) {
    await pendingFlowItem.removeValue();
    settle(err('Superseded by a newer sign-in attempt'));
    void browser.tabs.remove(stale.tabId).catch(() => {});
  }

  const state = generateNonce();

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');

  let tab: { id?: number };
  try {
    tab = await browser.tabs.create({ url: authUrl.toString() });
  } catch (e) {
    return err(`Could not open the sign-in tab: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (tab.id == null) {
    return err('Could not open the sign-in tab (no tab id)');
  }

  await pendingFlowItem.setValue({ state, tabId: tab.id, createdAt: Date.now() });

  return new Promise((resolve) => {
    flowResolver = resolve;
    // Soft timeout for THIS caller only: the pending record and the tab
    // stay alive, so a slow login still completes in the background and
    // the UI updates via the provider-state watcher / AUTH_CHANGED.
    setTimeout(() => {
      if (flowResolver === resolve) {
        settle(
          err(
            'Still waiting for TickTick sign-in — finish in the opened tab; ' +
              'the extension will connect automatically.',
          ),
        );
      }
    }, OAUTH_FLOW_TIMEOUT_MS);
  });
}

/**
 * Register the redirect-capture listeners. MUST be called synchronously on
 * every background wake (before any await) — these listeners are what wake
 * a dead worker when the consent tab finally navigates to the redirect URL.
 */
export function wireOAuthCapture(): void {
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // `changeInfo.url` is only populated for hosts we hold a permission
    // for (ticktick.com). The consent page itself can't false-positive:
    // it embeds the redirect URI URL-encoded, so startsWith won't match.
    if (changeInfo.url?.startsWith(OAUTH_REDIRECT_URI)) {
      void completeFlow(tabId, changeInfo.url);
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void cancelFlowForTab(tabId);
  });
}

async function completeFlow(tabId: number, url: string): Promise<void> {
  if (completingTabs.has(tabId)) return;
  completingTabs.add(tabId);
  try {
    const pending = await pendingFlowItem.getValue();
    if (!pending || pending.tabId !== tabId) return;

    // Clear BEFORE closing the tab — otherwise our own tabs.remove fires
    // the onRemoved cancel path against the still-pending record.
    await pendingFlowItem.removeValue();
    void browser.tabs.remove(tabId).catch(() => {});

    if (Date.now() - pending.createdAt > OAUTH_FLOW_TIMEOUT_MS) {
      settle(err('Sign-in took too long — please try again'));
      return;
    }

    const parsed = new URL(url);
    const errorParam = parsed.searchParams.get('error');
    if (errorParam) {
      settle(
        err(`OAuth error: ${errorParam} (${parsed.searchParams.get('error_description') ?? ''})`),
      );
      return;
    }

    const code = parsed.searchParams.get('code');
    if (!code) {
      settle(err('OAuth callback missing `code` parameter'));
      return;
    }
    if (parsed.searchParams.get('state') !== pending.state) {
      settle(err('OAuth state nonce mismatch — possible CSRF'));
      return;
    }

    const tokens = await exchangeCodeForTokens(code, OAUTH_REDIRECT_URI);
    if (!tokens.ok) {
      settle(tokens);
      return;
    }

    // Persisting tokens is the durable success signal: core's provider-
    // state watcher sees absent→present and broadcasts AUTH_CHANGED, which
    // covers callers whose authorize() promise died with a reaped worker.
    await setProviderState('ticktick', { tokens: tokens.value });
    settle(tokens);
  } finally {
    completingTabs.delete(tabId);
  }
}

async function cancelFlowForTab(tabId: number): Promise<void> {
  const pending = await pendingFlowItem.getValue();
  if (pending?.tabId !== tabId) return;
  await pendingFlowItem.removeValue();
  settle(err('Sign-in tab was closed before completing'));
}

function settle(r: Result<OAuthTokens, string>): void {
  flowResolver?.(r);
  flowResolver = null;
}

export async function refresh(refreshToken: string): Promise<Result<OAuthTokens, string>> {
  if (!isConfigured()) {
    return err('TickTick CLIENT_ID/SECRET are not set');
  }

  const body = new URLSearchParams();
  body.set('client_id', CLIENT_ID);
  body.set('client_secret', CLIENT_SECRET);
  body.set('refresh_token', refreshToken);
  body.set('grant_type', 'refresh_token');

  const parsed = await postForm(TOKEN_URL, body);
  if (!parsed.ok) return parsed;

  // Carry forward the previous refresh_token if the refresh response
  // omits one (some providers expect callers to reuse the old value).
  const tokens = buildTokens({
    ...parsed.value,
    refresh_token: parsed.value.refresh_token ?? refreshToken,
  });
  await setProviderState('ticktick', { tokens });
  return ok(tokens);
}

export async function disconnect(): Promise<void> {
  await clearProviderState('ticktick');
}

// Public helper used by the api layer. Returns valid tokens, refreshing
// transparently if expiry is < 60s away. Returns err when not
// authenticated OR refresh fails (caller should treat both as "prompt
// user to re-authenticate").
export async function getValidTokens(): Promise<Result<OAuthTokens, string>> {
  const state = await getProviderState('ticktick');
  if (!state.tokens) return err('Not authenticated');
  if (state.tokens.expiresAt - Date.now() < 60_000) {
    if (!state.tokens.refreshToken) {
      return err('Access token expired and no refresh token — please re-authenticate.');
    }
    return refresh(state.tokens.refreshToken);
  }
  return ok(state.tokens);
}

/**
 * Force a refresh regardless of expiry. Used by the api layer on a 401
 * response (a token may be invalidated before its `expires_in` ticks
 * down — server-side revocation, password change, etc.). Returns err
 * when the provider doesn't issue refresh tokens (e.g. TickTick) — the
 * caller should prompt re-authentication.
 */
export async function forceRefresh(): Promise<Result<OAuthTokens, string>> {
  const state = await getProviderState('ticktick');
  if (!state.tokens) return err('Not authenticated');
  if (!state.tokens.refreshToken) {
    return err('No refresh token available — please re-authenticate.');
  }
  return refresh(state.tokens.refreshToken);
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<Result<OAuthTokens, string>> {
  const body = new URLSearchParams();
  body.set('client_id', CLIENT_ID);
  body.set('client_secret', CLIENT_SECRET);
  body.set('code', code);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', redirectUri);

  const parsed = await postForm(TOKEN_URL, body);
  if (!parsed.ok) return parsed;

  return ok(buildTokens(parsed.value));
}

// TickTick (and some other OAuth providers) don't issue refresh tokens
// and may omit `expires_in`. We accept any response with at least an
// access_token and fall back to a 180-day lifetime for missing
// `expires_in` — that's TickTick's documented access-token lifetime.
function buildTokens(r: TokenResponse): OAuthTokens {
  const TICKTICK_DEFAULT_LIFETIME_SEC = 180 * 24 * 60 * 60;
  const lifetimeSec =
    typeof r.expires_in === 'number' ? r.expires_in : TICKTICK_DEFAULT_LIFETIME_SEC;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + lifetimeSec * 1000,
    scope: r.scope,
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

async function postForm(
  url: string,
  body: URLSearchParams,
): Promise<Result<TokenResponse, string>> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (e) {
    return err(`Network error: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return err(`Token endpoint returned ${resp.status}: ${text.slice(0, 200)}`);
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch (e) {
    return err(`Could not parse token response as JSON: ${e instanceof Error ? e.message : ''}`);
  }

  if (!isTokenResponse(json)) {
    return err('Token response missing required field `access_token`');
  }
  return ok(json);
}

// We require only `access_token`. `refresh_token` and `expires_in` are
// genuinely optional in the wild — TickTick, for instance, omits the
// former and (in some responses) the latter. Missing values are
// handled with sane defaults in `buildTokens`.
function isTokenResponse(v: unknown): v is TokenResponse {
  if (typeof v !== 'object' || v === null) return false;
  return typeof (v as Record<string, unknown>).access_token === 'string';
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
