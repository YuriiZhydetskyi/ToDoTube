// Result<T, E> — small Either-like type used to avoid throwing across the
// message bus (where stack traces don't survive structured cloning anyway).

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) {
    throw new Error(`unwrap on Err: ${String(r.error)}`);
  }
  return r.value;
}
