// Dispatcher for the typed message bus. Every Schema entry from
// shared/messaging.ts is handled here (or returns err('not-implemented')
// while the provider layer is still being built).
//
// Background is the single source of truth for the active provider and
// any per-provider state (tokens, last sync, active list). Popup and
// options never read provider state from storage directly — they query
// here so we have one place to evolve the schema.

import { browser } from 'wxt/browser';

import { err, ok, type Broadcast, type MessageType, type Request } from '@/shared/messaging';
import { getSettings, setSettings } from '@/shared/storage';

import { broadcastToYouTubeTabs } from './broadcast';

type HandlerResult = unknown;

export function registerHandlers(): void {
  browser.runtime.onMessage.addListener((raw, _sender) => {
    if (!isRequest(raw)) return undefined;
    return handle(raw);
  });
}

async function handle(req: Request): Promise<HandlerResult> {
  switch (req.type) {
    case 'GET_STATE': {
      const settings = await getSettings();
      // Real `authenticated` check lands when the provider is wired up
      // in Step 6/7. Until then we are always disconnected.
      return ok({ settings, authenticated: false });
    }

    case 'SET_ENABLED': {
      await setSettings({ enabled: req.enabled });
      return ok(null);
    }

    case 'LIST_PROJECTS':
    case 'LIST_TASKS':
    case 'COMPLETE_TASK':
    case 'AUTH_START':
    case 'AUTH_DISCONNECT':
    case 'REFRESH_NOW':
      return err(`${req.type}: not implemented yet (provider lands in Step 6/7)`);

    default:
      return err(`Unhandled message: ${(req as { type: string }).type}`);
  }
}

// Re-export for the background entrypoint to wire from storage watchers.
export { broadcastToYouTubeTabs };
export type { Broadcast };

const KNOWN_TYPES: readonly MessageType[] = [
  'GET_STATE',
  'LIST_PROJECTS',
  'LIST_TASKS',
  'COMPLETE_TASK',
  'AUTH_START',
  'AUTH_DISCONNECT',
  'REFRESH_NOW',
  'SET_ENABLED',
];

function isRequest(v: unknown): v is Request {
  if (typeof v !== 'object' || v === null || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return typeof t === 'string' && (KNOWN_TYPES as readonly string[]).includes(t);
}
