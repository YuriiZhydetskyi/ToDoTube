// Typed message bus between content scripts / popup / options and the
// background service worker. Background is the single source of truth for
// active provider, tokens, and the task cache.
//
// Each message type has a corresponding response shape via the Schema map.
// `sendToBackground({ type: 'GET_STATE' })` is inferred to return
// `Promise<Result<Schema['GET_STATE']['res'], string>>` automatically.

import { browser } from 'wxt/browser';
import { err, ok, type Result } from './result';
import type { GateEvalResult, ListId, Project, ProviderId, Settings, Task } from './types';

export interface GlobalState {
  settings: Settings;
  // Whether the active provider has valid (non-expired) tokens.
  authenticated: boolean;
  // The currently-displayed list for the active provider. Lives in
  // provider state, not settings, so we surface it here too — the
  // lifecycle needs both pieces to decide what to fetch.
  activeListId: ListId | null;
}

// Used in Schema entries that have no payload beyond the `type` tag.
// `Record<never, never>` is the proper "no required keys" empty-object
// type — intersecting it with `{ type: '…' }` leaves `{ type: '…' }`
// intact, unlike `Record<string, never>` (which forbids `type`).
type Empty = Record<never, never>;

// One source of truth for every (request shape, response shape) pair.
// Adding a new message means adding one entry here and handling it in
// `src/core/background/handlers.ts`.
export interface Schema {
  GET_STATE: { req: Empty; res: GlobalState };
  LIST_PROJECTS: { req: { providerId: ProviderId }; res: Project[] };
  LIST_TASKS: { req: { providerId: ProviderId; listId: ListId }; res: Task[] };
  AUTH_STATUS: { req: { providerId: ProviderId }; res: { authenticated: boolean } };
  COMPLETE_TASK: {
    req: { providerId: ProviderId; projectId: string; taskId: string };
    res: null;
  };
  AUTH_START: { req: { providerId: ProviderId }; res: { authenticated: boolean } };
  AUTH_DISCONNECT: { req: { providerId: ProviderId }; res: null };
  REFRESH_NOW: { req: { providerId: ProviderId; listId: ListId }; res: Task[] };
  SET_ENABLED: { req: { enabled: boolean }; res: null };
  SET_ACTIVE_LIST: { req: { providerId: ProviderId; listId: ListId }; res: null };

  // Gating. GATE_EVAL is what the site-wide content script polls to learn
  // whether to show the block overlay. Gating config is mutated by writing
  // Settings.gating directly (the options page) — the background's settings
  // watcher then broadcasts GATE_CHANGED — so there's no GATE_SET_* message.
  GATE_EVAL: { req: Empty; res: GateEvalResult };

  // Content scripts report active YouTube watch time (the "spent" side of
  // budget gates). The background accrues it against the local-day total.
  YOUTUBE_TICK: { req: { deltaMs: number }; res: null };
  // Options page "Test Anki connection" — reads the Anki study signal once.
  ANKI_TEST: { req: Empty; res: { studyMinutesToday: number } };
  // Options page "Test bridge connection" — reads the activity bridge once
  // for the chosen metric. The background resolves `metric` against the gate's
  // catalogue (the ui layer can't import gates/), so the request stays to two
  // plain strings. `value`/`unit` are in the metric's display unit.
  HTTP_SIGNAL_TEST: { req: { url: string; metric: string }; res: { value: number; unit: string } };
}

export type MessageType = keyof Schema;

export type Request<T extends MessageType = MessageType> = {
  [K in T]: { type: K } & Schema[K]['req'];
}[T];

export type Response<T extends MessageType> = Schema[T]['res'];

// Broadcasts emitted from the background to all listening tabs.
export type Broadcast =
  | { type: 'TASKS_UPDATED'; providerId: ProviderId; listId: ListId; tasks: Task[] }
  | { type: 'AUTH_REQUIRED'; providerId: ProviderId }
  | { type: 'SETTINGS_CHANGED'; settings: Settings }
  | { type: 'LIST_CHANGED'; providerId: ProviderId; listId: ListId }
  | { type: 'GATE_CHANGED'; result: GateEvalResult };

export async function sendToBackground<T extends MessageType>(
  req: Request<T>,
): Promise<Result<Response<T>, string>> {
  try {
    const reply: unknown = await browser.runtime.sendMessage(req);
    if (isWireResult(reply)) {
      return reply as Result<Response<T>, string>;
    }
    return err(`Background returned a non-Result reply: ${JSON.stringify(reply)}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function onBroadcast(cb: (msg: Broadcast) => void): () => void {
  const listener = (msg: unknown) => {
    if (isBroadcast(msg)) cb(msg);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

// Re-exported so background handlers can build replies symmetrically.
export { ok, err };

function isWireResult(v: unknown): v is Result<unknown, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'ok' in v &&
    typeof (v as { ok: unknown }).ok === 'boolean'
  );
}

function isBroadcast(v: unknown): v is Broadcast {
  if (typeof v !== 'object' || v === null || !('type' in v)) return false;
  const t = (v as { type: unknown }).type;
  return (
    t === 'TASKS_UPDATED' ||
    t === 'AUTH_REQUIRED' ||
    t === 'SETTINGS_CHANGED' ||
    t === 'LIST_CHANGED' ||
    t === 'GATE_CHANGED'
  );
}
