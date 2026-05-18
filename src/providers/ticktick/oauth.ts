// TickTick OAuth2 (authorization_code flow).
//
// Flow:
//   1. authorize() generates a CSRF nonce, stores it in session storage,
//      and opens TickTick's consent screen via launchWebAuthFlow.
//   2. TickTick redirects to `browser.identity.getRedirectURL()` with
//      ?code=… &state=… in the query string.
//   3. We verify the state matches our nonce, exchange `code` for an
//      access+refresh token pair, and persist the tokens.
//
// All token reads/writes go through `@/shared/storage` so settings and
// tokens share one schema (and one place to evolve).

import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';

import { err, ok, type Result } from '@/shared/result';
import { clearProviderState, getProviderState, setProviderState } from '@/shared/storage';
import type { OAuthTokens } from '@/shared/types';

import { AUTHORIZE_URL, CLIENT_ID, CLIENT_SECRET, isConfigured, SCOPES, TOKEN_URL } from './config';

// Session storage clears when the browser session ends — exactly the
// lifetime we want for a single-use OAuth state nonce.
const nonceItem = storage.defineItem<string | null>('session:todotube:oauth:ticktick:nonce', {
  fallback: null,
});

export async function authorize(): Promise<Result<OAuthTokens, string>> {
  if (!isConfigured()) {
    return err('TickTick CLIENT_ID/SECRET are not set. See README → TickTick OAuth setup.');
  }

  const redirectUri = browser.identity.getRedirectURL();
  const state = generateNonce();
  await nonceItem.setValue(state);

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');

  let redirectedTo: string | undefined;
  try {
    redirectedTo = await browser.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
  } catch (e) {
    await nonceItem.removeValue();
    return err(`OAuth flow failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Always clear the nonce — single-use, regardless of outcome.
  const expectedState = await nonceItem.getValue();
  await nonceItem.removeValue();

  if (!redirectedTo) return err('OAuth flow did not return a redirect URL');

  const parsed = new URL(redirectedTo);
  const errorParam = parsed.searchParams.get('error');
  if (errorParam) {
    return err(
      `OAuth error: ${errorParam} (${parsed.searchParams.get('error_description') ?? ''})`,
    );
  }

  const code = parsed.searchParams.get('code');
  const returnedState = parsed.searchParams.get('state');
  if (!code) return err('OAuth callback missing `code` parameter');
  if (!expectedState || returnedState !== expectedState) {
    return err('OAuth state nonce mismatch — possible CSRF');
  }

  const tokens = await exchangeCodeForTokens(code, redirectUri);
  if (!tokens.ok) return tokens;

  await setProviderState('ticktick', { tokens: tokens.value });
  return tokens;
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
