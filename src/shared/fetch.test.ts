import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from './fetch';

// Timing approach: stub global `fetch` rather than driving `AbortSignal.timeout`
// with Vitest fake timers.
//
// Why not fake timers: in this Node (v22, libuv) environment `AbortSignal.timeout`
// is backed by a native timer, not the JS timer queue Vitest patches, so
// `vi.advanceTimersByTimeAsync()` never fires its abort. (Verified: under
// `vi.useFakeTimers()` the signal stays unaborted after advancing past the
// timeout.) Fake timers would therefore silently no-op the contract under test.
//
// Why this stays deterministic: the stub mirrors what a real `fetch` does on
// abort — it rejects with `init.signal.reason` the moment the signal fires — and
// we use `AbortSignal.timeout(0)`, whose abort is scheduled on the very next
// timer tick. There is no chosen wall-clock duration to race against; awaiting
// the rejection just drains a single native tick. No real `setTimeout` sleeps.

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes through a response when fetch resolves before the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    const res = await fetchWithTimeout('https://example.test', {}, 1000);
    expect(await res.text()).toBe('ok');
  });

  it('forwards the init and an AbortSignal on the request', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', spy);

    await fetchWithTimeout('https://example.test', { method: 'POST' }, 1000);

    expect(spy).toHaveBeenCalledTimes(1);
    const [input, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(input).toBe('https://example.test');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects with the signal reason — a TimeoutError DOMException — on timeout', async () => {
    // Mirror real fetch: reject with the signal's own `reason` once it aborts.
    // The only error path out is the timeout signal firing, so whatever the
    // production code put on `init.signal` is exactly what surfaces — this pins
    // the documented contract (a `TimeoutError` DOMException), not just "any
    // rejection" (a connection-refused Error would have passed the old test).
    vi.stubGlobal(
      'fetch',
      (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );

    // timeoutMs = 0 → abort fires on the next native timer tick, deterministically.
    const rejection = await fetchWithTimeout('https://example.test', {}, 0).then(
      () => {
        throw new Error('expected fetchWithTimeout to reject');
      },
      (err: unknown) => err,
    );

    expect(rejection).toBeInstanceOf(DOMException);
    expect((rejection as DOMException).name).toBe('TimeoutError');
  });
});
