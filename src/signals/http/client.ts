// Minimal JSON-over-HTTP transport for the generic HTTP signal. GETs a URL,
// extracts a number at a dot path, and unwraps it into a Result. Any failure
// — bridge not running, network error, non-JSON, missing/!number field —
// comes back as `err`, which the gate turns into its fail-open/closed policy.

import { fetchWithTimeout } from '@/shared/fetch';
import { err, ok, type Result } from '@/shared/result';

// Walk a dot path ("a.b.c") into a parsed JSON value. Returns undefined if
// any segment is missing or a non-object is traversed.
function dig(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (typeof acc !== 'object' || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, value);
}

export async function fetchJsonNumber(
  url: string,
  jsonPath: string,
  timeoutMs: number,
): Promise<Result<number, string>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
  } catch (e) {
    // Thrown on connection refused (bridge down), a CORS rejection, or the
    // request outliving `timeoutMs` (a hung bridge).
    return err(e instanceof Error ? e.message : String(e));
  }

  if (!response.ok) return err(`Bridge HTTP ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    return err(`Bridge returned non-JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const raw = dig(body, jsonPath);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return err(`Bridge field "${jsonPath}" is missing or not a number`);
  }
  return ok(raw);
}
