// Minimal AnkiConnect transport. POSTs {action, version, params} to the
// local AnkiConnect server and unwraps its {result, error} envelope into a
// Result. Any failure — Anki not running, CORS origin not allowlisted,
// network error, a timeout, or an AnkiConnect-reported error — comes back as
// `err`, which the gate turns into its fail-open / fail-closed behavior.

import { fetchWithTimeout } from '@/shared/fetch';
import { err, ok, type Result } from '@/shared/result';

import { ANKI_CONNECT_URL, ANKI_CONNECT_VERSION, ANKI_INVOKE_TIMEOUT_MS } from './constants';

interface AnkiEnvelope<T> {
  result: T;
  error: string | null;
}

export async function ankiInvoke<T>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<Result<T, string>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      ANKI_CONNECT_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params }),
      },
      ANKI_INVOKE_TIMEOUT_MS,
    );
  } catch (e) {
    // Thrown on connection refused (Anki closed), a CORS rejection, or the
    // timeout firing on a hung instance (a TimeoutError DOMException).
    return err(e instanceof Error ? e.message : String(e));
  }

  if (!response.ok) return err(`AnkiConnect HTTP ${response.status}`);

  let envelope: AnkiEnvelope<T>;
  try {
    envelope = (await response.json()) as AnkiEnvelope<T>;
  } catch (e) {
    return err(`AnkiConnect returned non-JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (envelope.error) return err(envelope.error);
  return ok(envelope.result);
}
