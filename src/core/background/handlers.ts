// Dispatcher for the typed message bus. Every Schema entry from
// shared/messaging.ts is handled by exactly one entry in the HANDLERS map,
// grouped by domain in ./handlers/*. This file only assembles the map, derives
// the known-types guard from it, and dispatches.
//
// Background is the single source of truth for the active provider and any
// per-provider state (tokens, last sync, active list). Popup and options never
// read provider state from storage directly — they query here so we have one
// place to evolve the schema.

import { browser } from 'wxt/browser';

import type { MessageType, Request } from '@/shared/messaging';

import { broadcastToBlockedTabs } from './broadcast';
import { authHandlers } from './handlers/auth';
import { diagnosticsHandlers } from './handlers/diagnostics';
import { gateHandlers } from './handlers/gate';
import {
  enrichWithTasks,
  listTasksForUi,
  runRefresh,
  type Handler,
  type HandlerResult,
} from './handlers/shared';
import { taskHandlers } from './handlers/tasks';

// One handler per message type. The `satisfies` makes a missing handler a
// compile error, so adding a Schema entry forces adding a handler here.
const HANDLERS = {
  ...authHandlers,
  ...taskHandlers,
  ...gateHandlers,
  ...diagnosticsHandlers,
} satisfies { [T in MessageType]: Handler<T> };

// Single-sourced from the map (no parallel array to drift out of sync).
const KNOWN_TYPES = Object.keys(HANDLERS) as MessageType[];

export function registerHandlers(): void {
  browser.runtime.onMessage.addListener((raw, _sender) => {
    if (!isRequest(raw)) return undefined;
    return handle(raw);
  });
}

async function handle(req: Request): Promise<HandlerResult> {
  return (HANDLERS[req.type] as Handler<typeof req.type>)(req);
}

function isRequest(v: unknown): v is Request {
  if (typeof v !== 'object' || v === null || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return typeof t === 'string' && (KNOWN_TYPES as readonly string[]).includes(t);
}

// Re-exported for the background entrypoint (alarm tick + gate broadcasts) and
// the handlers unit test, which import these from this module.
export { wireAuthBroadcasts, wireProviderAuth } from './handlers/auth';
export { broadcastToBlockedTabs, enrichWithTasks, listTasksForUi, runRefresh };
export type { Broadcast } from '@/shared/messaging';
