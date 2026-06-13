// TickTick OAuth + API endpoint config.
//
// CLIENT_ID and CLIENT_SECRET are injected at build time from `.env` via
// Vite's import.meta.env. They ship inside the extension bundle, so we
// treat the secret as a PUBLIC-CLIENT value, not a real cryptographic
// secret (TickTick does not appear to document PKCE support — see
// REQUIREMENTS.md §13 and .env.example).

declare global {
  interface ImportMetaEnv {
    readonly WXT_TT_CLIENT_ID?: string;
    readonly WXT_TT_CLIENT_SECRET?: string;
  }
}

export const CLIENT_ID: string = import.meta.env.WXT_TT_CLIENT_ID ?? '';
export const CLIENT_SECRET: string = import.meta.env.WXT_TT_CLIENT_SECRET ?? '';

export const AUTHORIZE_URL = 'https://ticktick.com/oauth/authorize';
export const TOKEN_URL = 'https://ticktick.com/oauth/token';
export const API_BASE = 'https://api.ticktick.com';
export const WEB_APP_URL = 'https://ticktick.com/webapp/';

// The single OAuth redirect URL registered in the TickTick developer console
// (it has exactly ONE redirect field per app). The path 404s on ticktick.com —
// that's fine and deliberate: OAuth only needs the navigation to HAPPEN; the
// background captures the `?code=` from the tab URL and closes the tab. Using
// a ticktick.com path means the existing `https://ticktick.com/*` host
// permission makes the tab URL visible to us — no `identity` API (which
// Firefox Android lacks), no `tabs` permission, no extra host permission.
export const OAUTH_REDIRECT_URI = 'https://ticktick.com/todotube-oauth-callback';

// Origin pattern backing the redirect capture; must stay in sync with the
// `https://ticktick.com/*` entry in wxt.config.ts host_permissions. Firefox
// lets users revoke host permissions, so authorize() pre-flights this.
export const TICKTICK_ORIGIN_PERMISSION = 'https://ticktick.com/*';

// How long a started OAuth flow stays valid. The authorize() caller gets a
// soft timeout reply after this long; a redirect captured later than this is
// treated as stale and rejected.
export const OAUTH_FLOW_TIMEOUT_MS = 5 * 60_000;

// Hard timeout for a single TickTick API request. These reads sit on the gate
// hot path (the task-budget gate awaits the completed-tasks call), so a hung
// connection would otherwise stall the decision; on timeout the call returns a
// network error and the gate applies its fail mode / last-known total.
export const API_TIMEOUT_MS = 10_000;

// `tasks:write` is required for click-to-complete. Space-separated per
// the OAuth2 spec.
export const SCOPES = 'tasks:read tasks:write';

export function isConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}
