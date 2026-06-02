import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncSettings } from '@/shared/types';

import { createHttpTransport } from './http-transport';

const DAY = '2026-05-29';

const supabase: SyncSettings = {
  mode: 'supabase',
  syncId: 'sync-code',
  config: { supabase: { url: 'https://proj.supabase.co', apiKey: 'ANON' } },
};
const cloudflare: SyncSettings = {
  mode: 'cloudflare',
  syncId: 'sync-code',
  config: { cloudflare: { url: 'https://w.workers.dev', secret: 'SEKRET' } },
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockJson(body: unknown, ok = true, status = 200): void {
  fetchMock.mockResolvedValueOnce({ ok, status, json: async () => body } as Response);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http transport — Supabase flavor', () => {
  it('reads with PostgREST filters + anon key headers, mapping snake_case rows', async () => {
    mockJson([{ device_id: 'A', day: DAY, intervals: [{ start: 1, end: 2 }] }]);
    const recs = await createHttpTransport('supabase', supabase).listForDay(DAY);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('https://proj.supabase.co/rest/v1/usage');
    expect(url).toContain('sync_id=eq.sync-code');
    expect(url).toContain(`day=eq.${DAY}`);
    expect((init as RequestInit).headers).toMatchObject({
      apikey: 'ANON',
      Authorization: 'Bearer ANON',
    });
    expect(recs).toEqual([{ deviceId: 'A', day: DAY, intervals: [{ start: 1, end: 2 }] }]);
  });

  it('upserts via POST with merge-duplicates and a snake_case body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201 } as Response);
    await createHttpTransport('supabase', supabase).putOwn({
      deviceId: 'A',
      day: DAY,
      intervals: [{ start: 1, end: 2 }],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://proj.supabase.co/rest/v1/usage');
    const ri = init as RequestInit;
    expect(ri.method).toBe('POST');
    expect((ri.headers as Record<string, string>).Prefer).toContain('merge-duplicates');
    expect(JSON.parse(ri.body as string)).toEqual({
      sync_id: 'sync-code',
      device_id: 'A',
      day: DAY,
      intervals: [{ start: 1, end: 2 }],
    });
  });
});

describe('http transport — Cloudflare flavor', () => {
  it('reads with a bearer secret and maps camelCase rows', async () => {
    mockJson([{ deviceId: 'B', day: DAY, intervals: [{ start: 3, end: 4 }] }]);
    const recs = await createHttpTransport('cloudflare', cloudflare).listForDay(DAY);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://w.workers.dev/usage?sync_id=sync-code&day=${DAY}`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SEKRET' });
    expect(recs).toEqual([{ deviceId: 'B', day: DAY, intervals: [{ start: 3, end: 4 }] }]);
  });

  it('upserts via PUT with a camelCase body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    await createHttpTransport('cloudflare', cloudflare).putOwn({
      deviceId: 'B',
      day: DAY,
      intervals: [],
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const ri = init as RequestInit;
    expect(ri.method).toBe('PUT');
    expect(JSON.parse(ri.body as string)).toEqual({
      syncId: 'sync-code',
      deviceId: 'B',
      day: DAY,
      intervals: [],
    });
  });
});

describe('http transport — robustness', () => {
  it('does not call fetch when unconfigured', async () => {
    const t = createHttpTransport('supabase', { mode: 'supabase', syncId: '', config: {} });
    expect(await t.listForDay(DAY)).toEqual([]);
    await t.putOwn({ deviceId: 'A', day: DAY, intervals: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-ok read (so callers can fall back to local)', async () => {
    mockJson(null, false, 500);
    await expect(createHttpTransport('cloudflare', cloudflare).listForDay(DAY)).rejects.toThrow();
  });

  it('swallows a failed push (local mirror stays authoritative)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    // Should not throw.
    await createHttpTransport('cloudflare', cloudflare).putOwn({
      deviceId: 'B',
      day: DAY,
      intervals: [],
    });
  });

  it('drops malformed intervals from a row', async () => {
    mockJson([
      { deviceId: 'B', day: DAY, intervals: [{ start: 1, end: 2 }, { start: 'x', end: 2 }, null] },
    ]);
    const recs = await createHttpTransport('cloudflare', cloudflare).listForDay(DAY);
    expect(recs[0]!.intervals).toEqual([{ start: 1, end: 2 }]);
  });
});
