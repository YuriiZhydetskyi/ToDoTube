import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncSettings } from '@/shared/types';

import { UPSTASH_KEY_TTL_SECONDS } from './constants';
import { createUpstashTransport } from './upstash-transport';

const DAY = '2026-05-29';
const KEY = `todotube:usage:sync-code:${DAY}`;

const upstash: SyncSettings = {
  mode: 'upstash',
  syncId: 'sync-code',
  config: { upstash: { url: 'https://x.upstash.io', token: 'TKN' } },
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

describe('upstash transport — reads', () => {
  it('HGETALLs the per-day hash with a bearer token and pairs the flat result', async () => {
    mockJson({
      result: ['A', '[{"start":1,"end":2}]', 'B', '[{"start":3,"end":4}]'],
    });
    const recs = await createUpstashTransport(upstash).listForDay(DAY);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x.upstash.io');
    const ri = init as RequestInit;
    expect(ri.method).toBe('POST');
    expect((ri.headers as Record<string, string>).Authorization).toBe('Bearer TKN');
    expect(JSON.parse(ri.body as string)).toEqual(['HGETALL', KEY]);
    expect(recs).toEqual([
      { deviceId: 'A', day: DAY, intervals: [{ start: 1, end: 2 }] },
      { deviceId: 'B', day: DAY, intervals: [{ start: 3, end: 4 }] },
    ]);
  });

  it('returns [] for an empty hash', async () => {
    mockJson({ result: [] });
    expect(await createUpstashTransport(upstash).listForDay(DAY)).toEqual([]);
  });

  it('skips a device whose stored value is not valid JSON', async () => {
    mockJson({ result: ['A', 'not-json', 'B', '[{"start":3,"end":4}]'] });
    const recs = await createUpstashTransport(upstash).listForDay(DAY);
    expect(recs).toEqual([{ deviceId: 'B', day: DAY, intervals: [{ start: 3, end: 4 }] }]);
  });

  it('drops malformed intervals within a device', async () => {
    mockJson({ result: ['A', '[{"start":1,"end":2},{"start":"x","end":2},null]'] });
    const recs = await createUpstashTransport(upstash).listForDay(DAY);
    expect(recs[0]!.intervals).toEqual([{ start: 1, end: 2 }]);
  });

  it('throws on a command-level error so callers fall back to local', async () => {
    mockJson({ error: 'WRONGPASS invalid password' });
    await expect(createUpstashTransport(upstash).listForDay(DAY)).rejects.toThrow();
  });

  it('throws on a non-ok read', async () => {
    mockJson(null, false, 401);
    await expect(createUpstashTransport(upstash).listForDay(DAY)).rejects.toThrow();
  });
});

describe('upstash transport — writes', () => {
  it('pipelines HSET + EXPIRE for this device', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await createUpstashTransport(upstash).putOwn({
      deviceId: 'A',
      day: DAY,
      intervals: [{ start: 1, end: 2 }],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x.upstash.io/pipeline');
    const ri = init as RequestInit;
    expect(ri.method).toBe('POST');
    expect((ri.headers as Record<string, string>).Authorization).toBe('Bearer TKN');
    expect(JSON.parse(ri.body as string)).toEqual([
      ['HSET', KEY, 'A', '[{"start":1,"end":2}]'],
      ['EXPIRE', KEY, UPSTASH_KEY_TTL_SECONDS],
    ]);
  });

  it('swallows a failed push (local mirror stays authoritative)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await createUpstashTransport(upstash).putOwn({ deviceId: 'A', day: DAY, intervals: [] });
  });
});

describe('upstash transport — robustness', () => {
  it('does not call fetch when unconfigured', async () => {
    const t = createUpstashTransport({ mode: 'upstash', syncId: '', config: {} });
    expect(await t.listForDay(DAY)).toEqual([]);
    await t.putOwn({ deviceId: 'A', day: DAY, intervals: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
