// Single source of truth for the activity bridge's magic strings — the
// analogue of signals/anki/constants.ts, but living with the gate because
// the bridge (a fitness data source) is the GATE's domain knowledge, not the
// generic HTTP signal's (which stays source-agnostic and gets url/path/kind
// per read). The bridge endpoint, its port, and the JSON field names it
// serves must not appear anywhere else.
//
// "Bridge" = any small local HTTP server exposing today's fitness metrics as
// flat JSON. The bundled reference bridge (bridge/garmin/) talks to Garmin
// Connect, but the gate is source-agnostic.

import type { SignalKind } from '@/shared/types';

const MINUTE_MS = 60_000;

// Default bridge endpoint. Deliberately NOT Anki's 8765 — a user may run
// both. Localhost only; the user can override the URL in the gate config.
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8930/today';

// Optional host permission requested before the background fetches the
// bridge (mirrors ANKI_HOST_PERMISSION). Keep in sync with the literal in
// wxt.config.ts's optional_host_permissions.
export const BRIDGE_HOST_PERMISSION = 'http://127.0.0.1:8930/*';

// One metric the bridge may expose. This object IS the wire contract with
// the bridge: `jsonPath` names the JSON field, `kind` is the SignalValue
// kind, and `scale` lifts the bridge's human unit to the canonical unit for
// that kind (ms for durationMs, raw count for count). If a bridge field name
// or unit changes, change it HERE and nowhere else.
export interface MetricDescriptor {
  readonly id: string;
  // Options-page dropdown label.
  readonly label: string;
  // Dot path into the bridge's JSON response.
  readonly jsonPath: string;
  readonly kind: SignalKind;
  readonly scale: number;
  // Unit shown beside the "effort amount" config field (e.g. "reps", "min").
  readonly effortUnit: string;
}

// The bridge serves counts as plain integers and durations as whole MINUTES;
// `scale` lifts minutes to ms so every durationMs SignalValue is honestly in
// ms (the same convention the Anki signal follows).
export const METRIC_CATALOG = {
  steps: {
    id: 'steps',
    label: 'Steps',
    jsonPath: 'steps',
    kind: 'count',
    scale: 1,
    effortUnit: 'steps',
  },
  reps: {
    id: 'reps',
    label: 'Strength reps',
    jsonPath: 'reps',
    kind: 'count',
    scale: 1,
    effortUnit: 'reps',
  },
  intensityMinutes: {
    id: 'intensityMinutes',
    label: 'Intensity minutes',
    jsonPath: 'intensityMinutes',
    kind: 'durationMs',
    scale: MINUTE_MS,
    effortUnit: 'min',
  },
  hrZoneMinutes: {
    id: 'hrZoneMinutes',
    label: 'Minutes in HR zone',
    jsonPath: 'hrZoneMinutes',
    kind: 'durationMs',
    scale: MINUTE_MS,
    effortUnit: 'min',
  },
} as const satisfies Record<string, MetricDescriptor>;

export type MetricId = keyof typeof METRIC_CATALOG;

export const DEFAULT_METRIC_ID: MetricId = 'reps';
