// A `fetch` with a hard timeout, so a hung remote can never stall a caller
// indefinitely. Every network read in the extension goes through here.
//
// Why this matters: gate evaluation sits on hot paths (the popup's GET_STATE,
// each navigation's GATE_EVAL, the 1-minute alarm) and awaits remote reads —
// the sync backend, the activity bridge, the TickTick API. A backend that
// accepts the socket but never replies (as opposed to refusing it, which fails
// fast) would otherwise hang the whole decision until the browser's default
// network timeout. With a bound, the read rejects on time and each caller's
// existing catch turns it into a fail-open/closed policy or a local fallback.
//
// Pure + leaf (`shared`), so providers, signals, and core can all use it.

// On timeout the request is aborted; `fetch` rejects with the signal's reason
// (a `TimeoutError` DOMException), which propagates exactly like a network
// error. Any `signal` already on `init` is replaced — no caller passes one.
export function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
