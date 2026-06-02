// In-memory, short-TTL cache for provider reads, living in the background
// service worker.
//
// Why this exists: TickTick rate-limits to 100 requests/minute per token. A
// single `smart:today` fetch already fans out to one HTTP call PER project
// plus the inbox (see providers/ticktick listTasksToday). Combine that with
// the per-minute gate alarm, a GATE_EVAL from every content script on each
// page load, the block-screen task enrichment, and the watch panel's own
// list fetch, and a few quick navigations blow past 100/min — the API then
// returns `exceed_query_limit` and the gate fails closed.
//
// This collapses repeated reads within a TTL window into one fetch,
// de-duplicates concurrent reads (single-flight), and backs off when the API
// errors so a rate-limit storm drains instead of being fed. State is module
// scoped, so it lives and dies with the service worker — a cold start just
// means a cache miss, which is fine.

import type { Result } from '@/shared/result';

interface Entry {
  value: Result<unknown, string>;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Result<unknown, string>>>();

// Bumped by invalidateTaskCache(). A fetch captures the generation it started
// in; if it changed by the time the fetch resolves, an invalidation happened
// mid-flight and the (now pre-invalidation) result must NOT repopulate the
// cache the invalidation just cleared.
let generation = 0;

// After an error we serve the cached fallback for this long before hitting
// the API again — long enough to let a rate-limit window drain.
const ERROR_BACKOFF_MS = 30_000;

/**
 * Read `key` through the cache. Returns a fresh cached value, joins an
 * in-flight fetch, or runs `fetcher`. On success caches for `ttlMs`. On error
 * serves the last good value if we have one (stale-while-error) and backs off
 * for ERROR_BACKOFF_MS either way, so a failing endpoint isn't hammered.
 */
export async function cachedRead<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<Result<T, string>>,
): Promise<Result<T, string>> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Result<T, string>;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<Result<T, string>>;

  const gen = generation;
  const run = (async (): Promise<Result<unknown, string>> => {
    try {
      const r = await fetcher();
      // An invalidation landed while we were fetching: our result predates it,
      // so return it to our own caller but don't touch the (cleared) cache.
      if (gen !== generation) return r;
      if (r.ok) {
        cache.set(key, { value: r, expiresAt: Date.now() + ttlMs });
        return r;
      }
      // Error: keep serving the last good value if we have one, and back off
      // regardless so we stop adding to a rate-limit storm.
      const fallback = hit ? hit.value : r;
      cache.set(key, { value: fallback, expiresAt: Date.now() + ERROR_BACKOFF_MS });
      return fallback;
    } finally {
      // Only clean up our own inflight entry — never a newer one a post-
      // invalidation read may have registered under the same key.
      if (gen === generation) inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run as Promise<Result<T, string>>;
}

/**
 * Drop all cached reads. Call after a write (e.g. completing a task) so the
 * next read reflects it immediately instead of waiting out the TTL.
 */
export function invalidateTaskCache(): void {
  cache.clear();
  inflight.clear();
  // Disown any in-flight fetches so they can't repopulate what we just cleared.
  generation++;
}
