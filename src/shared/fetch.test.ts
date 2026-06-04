import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from './fetch';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes through a response when fetch resolves before the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    const res = await fetchWithTimeout('https://example.test', {}, 1000);
    expect(await res.text()).toBe('ok');
  });

  it('forwards an AbortSignal on the request init', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', spy);
    await fetchWithTimeout('https://example.test', { method: 'POST' }, 1000);
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects when the request outlives the timeout', async () => {
    // A server that accepts the socket but never replies: resolve only if the
    // request is aborted, so the only way out is the timeout firing.
    vi.stubGlobal(
      'fetch',
      (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject((init.signal as AbortSignal).reason ?? new Error('aborted')),
          );
        }),
    );
    await expect(fetchWithTimeout('https://example.test', {}, 20)).rejects.toThrow();
  });
});
