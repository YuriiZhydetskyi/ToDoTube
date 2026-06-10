// Tiny local HTTP server for the ToDoTube activity-budget gate. Serves
// GET /today → { steps, intensityMinutes, hrZoneMinutes, reps, asOf } from a
// short-lived cache so repeated gate evaluations don't hammer Garmin (whose
// data only changes on watch-sync anyway).
//
// Generic by design: all Garmin specifics live in garmin.js. Swap that module
// to back the bridge with a different fitness source — the contract here and
// the extension's gates/activity-budget/constants.ts stay the same.

import { createServer } from 'node:http';

import { fetchToday } from './garmin.js';

const PORT = Number(process.env.PORT) || 8930;
// Garmin syncs in minutes, so caching for a minute is plenty and keeps the
// gate responsive without re-fetching on every 1-minute alarm tick.
const CACHE_MS = Number(process.env.CACHE_MS) || 60_000;

let cache = null; // { body: object, at: number }

async function getToday() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const metrics = await fetchToday();
  const body = { ...metrics, asOf: now };
  cache = { body, at: now };
  return body;
}

const server = createServer((req, res) => {
  // The extension fetches from its background with an explicit host
  // permission (no CORS preflight), but allow any origin so the endpoint is
  // also testable from a browser/curl.
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET' || !req.url?.startsWith('/today')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Try GET /today' }));
    return;
  }

  getToday()
    .then((body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    })
    .catch((e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e?.message ?? String(e) }));
    });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ToDoTube Garmin bridge listening on http://127.0.0.1:${PORT}/today`);
});
