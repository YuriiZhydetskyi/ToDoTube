import { beforeEach, describe, expect, it } from 'vitest';

import { ok, type Result } from '@/shared/result';

import { cachedRead, invalidateTaskCache } from './task-cache';

// Module-scoped cache — reset between cases (also bumps the generation).
beforeEach(() => invalidateTaskCache());

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('cachedRead', () => {
  it('serves a second read within TTL from cache (one fetch)', async () => {
    let calls = 0;
    const fetcher = (): Promise<Result<string, string>> => {
      calls++;
      return Promise.resolve(ok('v'));
    };

    expect(await cachedRead('k', 60_000, fetcher)).toEqual(ok('v'));
    expect(await cachedRead('k', 60_000, fetcher)).toEqual(ok('v'));
    expect(calls).toBe(1);
  });

  it('shares one in-flight fetch between concurrent callers (single-flight)', async () => {
    const d = deferred<Result<string, string>>();
    let calls = 0;
    const fetcher = (): Promise<Result<string, string>> => {
      calls++;
      return d.promise;
    };

    const p1 = cachedRead('k', 60_000, fetcher);
    const p2 = cachedRead('k', 60_000, fetcher);
    d.resolve(ok('v'));

    expect(await p1).toEqual(ok('v'));
    expect(await p2).toEqual(ok('v'));
    expect(calls).toBe(1);
  });

  it('does not repopulate the cache from a read in flight during invalidation', async () => {
    const d = deferred<Result<string, string>>();
    let calls = 0;

    // Start a read, then invalidate while it is still fetching.
    const p1 = cachedRead('k', 60_000, () => {
      calls++;
      return d.promise;
    });
    invalidateTaskCache();
    d.resolve(ok('stale'));

    // The original caller still receives its value...
    expect(await p1).toEqual(ok('stale'));

    // ...but it must NOT have been cached: the next read refetches and sees
    // the fresh value rather than the pre-invalidation one.
    const r2 = await cachedRead('k', 60_000, () => {
      calls++;
      return Promise.resolve(ok('fresh'));
    });
    expect(r2).toEqual(ok('fresh'));
    expect(calls).toBe(2);
  });
});
