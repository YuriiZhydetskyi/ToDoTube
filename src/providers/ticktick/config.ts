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

// `tasks:write` is required for click-to-complete. Space-separated per
// the OAuth2 spec.
export const SCOPES = 'tasks:read tasks:write';

export function isConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}
