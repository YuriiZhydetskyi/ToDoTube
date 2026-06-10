import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpSignal } from './signal';

// Stub global fetch with a JSON responder.
function stubFetch(
  impl: (url: string) => { ok?: boolean; status?: number; json: () => unknown },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const r = impl(String(url));
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        json: async () => r.json(),
      } as unknown as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('httpSignal.read', () => {
  it('reads a count value at a top-level path', async () => {
    stubFetch(() => ({ json: () => ({ steps: 4200 }) }));
    const r = await httpSignal.read({
      url: 'http://x/1',
      jsonPath: 'steps',
      kind: 'count',
      scale: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.value).toBe(4200);
      expect(r.value.kind).toBe('count');
    }
  });

  it('scales duration minutes to milliseconds', async () => {
    stubFetch(() => ({ json: () => ({ m: 30 }) }));
    const r = await httpSignal.read({
      url: 'http://x/2',
      jsonPath: 'm',
      kind: 'durationMs',
      scale: 60_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe(1_800_000);
  });

  it('digs a nested dot path', async () => {
    stubFetch(() => ({ json: () => ({ a: { b: 7 } }) }));
    const r = await httpSignal.read({
      url: 'http://x/3',
      jsonPath: 'a.b',
      kind: 'count',
      scale: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe(7);
  });

  it('errors when the field is missing or not a number', async () => {
    stubFetch(() => ({ json: () => ({ steps: 'lots' }) }));
    const r = await httpSignal.read({
      url: 'http://x/4',
      jsonPath: 'steps',
      kind: 'count',
      scale: 1,
    });
    expect(r.ok).toBe(false);
  });

  it('errors on a non-2xx response', async () => {
    stubFetch(() => ({ ok: false, status: 502, json: () => ({}) }));
    const r = await httpSignal.read({
      url: 'http://x/5',
      jsonPath: 'steps',
      kind: 'count',
      scale: 1,
    });
    expect(r.ok).toBe(false);
  });

  it('caches within the freshness window (one fetch for two reads)', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ steps: 1 }) }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const cfg = { url: 'http://x/cache', jsonPath: 'steps', kind: 'count', scale: 1 };
    await httpSignal.read(cfg);
    await httpSignal.read(cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed config', async () => {
    const r = await httpSignal.read({ jsonPath: 'x' });
    expect(r.ok).toBe(false);
  });
});
