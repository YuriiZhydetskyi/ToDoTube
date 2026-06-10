// ToDoTube sync backend — Cloudflare Worker (KV).
//
// Implements the tiny sync protocol the extension's HTTP transport speaks
// (see docs/SYNC.md):
//
//   GET  /usage?sync_id=<id>&day=YYYY-MM-DD
//        -> 200 [ { deviceId, day, intervals: [{start,end}] }, ... ]   (all devices)
//   PUT  /usage   body { syncId, deviceId, day, intervals }
//        -> 204    (upserts this device's record)
//
// Auth: every request must send `Authorization: Bearer <SYNC_SECRET>`, where
// SYNC_SECRET is a Worker secret you set. Rows are grouped by `sync_id` (the
// "sync code" you paste into the extension on each device) and partitioned by
// `deviceId`, so devices never clobber each other.
//
// Setup: see backends/cloudflare/README.md.

const KV_PREFIX = 'usage';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function unauthorized() {
  return new Response('Unauthorized', { status: 401, headers: CORS });
}

// KV key for one device's day record. Day is "YYYY-MM-DD" so the prefix
// `usage:<sync_id>:<day>:` lists exactly one day across devices.
const recordKey = (syncId, day, deviceId) => `${KV_PREFIX}:${syncId}:${day}:${deviceId}`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Constant-ish bearer check.
    const auth = request.headers.get('Authorization') || '';
    if (!env.SYNC_SECRET || auth !== `Bearer ${env.SYNC_SECRET}`) return unauthorized();

    const url = new URL(request.url);
    if (url.pathname !== '/usage') return new Response('Not found', { status: 404, headers: CORS });

    if (request.method === 'GET') {
      const syncId = url.searchParams.get('sync_id') || '';
      const day = url.searchParams.get('day') || '';
      if (!syncId || !day) return json([], 200);

      const prefix = `${KV_PREFIX}:${syncId}:${day}:`;
      const list = await env.USAGE.list({ prefix });
      const records = await Promise.all(
        list.keys.map((k) => env.USAGE.get(k.name, { type: 'json' })),
      );
      return json(records.filter(Boolean), 200);
    }

    if (request.method === 'PUT') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('Bad JSON', { status: 400, headers: CORS });
      }
      const { syncId, deviceId, day, intervals } = body || {};
      if (!syncId || !deviceId || !day || !Array.isArray(intervals)) {
        return new Response('Bad request', { status: 400, headers: CORS });
      }
      // Store the wire record verbatim (so GET can return it unchanged). A 90-day
      // TTL keeps stale days from accumulating without any cron.
      await env.USAGE.put(
        recordKey(syncId, day, deviceId),
        JSON.stringify({ deviceId, day, intervals }),
        { expirationTtl: 60 * 60 * 24 * 90 },
      );
      return new Response(null, { status: 204, headers: CORS });
    }

    return new Response('Method not allowed', { status: 405, headers: CORS });
  },
};
