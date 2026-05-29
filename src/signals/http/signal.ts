// Generic JSON-over-HTTP signal. Reads a single number from a configured
// endpoint + dot path, scales it, and tags it with the requested SignalKind.
// Deliberately source-agnostic: it knows nothing about fitness, Garmin, or
// any metric catalogue — the consuming gate supplies url/jsonPath/kind/scale
// per read (that domain knowledge lives in the gate's own constants).
//
// Unlike the Anki signal, the endpoint is per-read config (not a constant),
// so there's no static `probe()` — the gate relies on `read` returning `err`
// to apply its fail-open/closed policy.

import { err, ok, type Result } from '@/shared/result';
import { HTTP_SIGNAL_ID, type SignalKind, type SignalValue } from '@/shared/types';

import type { Signal } from '../types';
import { fetchJsonNumber } from './client';

// The shape a gate hands to ctx.readSignal(HTTP_SIGNAL_ID, …).
interface HttpSignalConfig {
  url: string;
  jsonPath: string;
  kind: SignalKind;
  // Multiplier to reach the canonical unit (ms for durationMs, raw for count).
  scale: number;
}

// Short per-endpoint cache so the gate's 1-minute re-evaluation (+ any
// on-demand evals) doesn't hammer the bridge. Keyed by url+path because the
// same signal serves multiple metrics.
const CACHE_MS = 20_000;
const cache = new Map<string, { value: SignalValue; at: number }>();

function parseConfig(config: unknown): Result<HttpSignalConfig, string> {
  if (typeof config !== 'object' || config === null) {
    return err('HTTP signal requires { url, jsonPath, kind, scale } config');
  }
  const c = config as Record<string, unknown>;
  if (typeof c.url !== 'string' || typeof c.jsonPath !== 'string') {
    return err('HTTP signal config needs string url and jsonPath');
  }
  const kind: SignalKind = c.kind === 'durationMs' ? 'durationMs' : 'count';
  const scale =
    typeof c.scale === 'number' && Number.isFinite(c.scale) && c.scale > 0 ? c.scale : 1;
  return ok({ url: c.url, jsonPath: c.jsonPath, kind, scale });
}

export const httpSignal: Signal = {
  id: HTTP_SIGNAL_ID,
  displayName: 'HTTP JSON value',

  async read(config?: unknown): Promise<Result<SignalValue, string>> {
    const parsed = parseConfig(config);
    if (!parsed.ok) return err(parsed.error);
    const { url, jsonPath, kind, scale } = parsed.value;

    const key = `${url}|${jsonPath}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return ok(hit.value);

    const raw = await fetchJsonNumber(url, jsonPath);
    if (!raw.ok) return err(raw.error);

    const value: SignalValue = { kind, value: raw.value * scale, asOf: now };
    cache.set(key, { value, at: now });
    return ok(value);
  },
};
