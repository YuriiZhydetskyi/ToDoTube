// Options-page "Test connection" handlers: read each external source once and
// report a human-readable summary. None of these mutate state.

import { getRemoteTransport } from '@/core/sync';
import { METRIC_CATALOG, type MetricId } from '@/gates/activity-budget/constants';
import { getSignalOrNull } from '@/signals/registry';
import { localDayKey } from '@/shared/day';
import { err, ok } from '@/shared/messaging';
import { ANKI_STUDY_SIGNAL_ID, HTTP_SIGNAL_ID } from '@/shared/types';

import type { HandlerMap } from './shared';

export const diagnosticsHandlers = {
  ANKI_TEST: async () => {
    const signal = getSignalOrNull(ANKI_STUDY_SIGNAL_ID);
    if (!signal) return err('Anki signal unavailable');
    const r = await signal.read();
    if (!r.ok) return err(r.error);
    return ok({ studyMinutesToday: Math.round(r.value.value / 60_000) });
  },

  HTTP_SIGNAL_TEST: async (req) => {
    const metric = METRIC_CATALOG[req.metric as MetricId];
    if (!metric) return err(`Unknown metric: ${req.metric}`);
    const signal = getSignalOrNull(HTTP_SIGNAL_ID);
    if (!signal) return err('HTTP signal unavailable');
    const r = await signal.read({
      url: req.url,
      jsonPath: metric.jsonPath,
      kind: metric.kind,
      scale: metric.scale,
    });
    if (!r.ok) return err(r.error);
    // SignalValue is canonical (ms for durationMs); show it in the metric's
    // display unit (minutes / plain count).
    const display = metric.kind === 'durationMs' ? r.value.value / 60_000 : r.value.value;
    return ok({ value: Math.round(display), unit: metric.effortUnit });
  },

  SYNC_TEST: async () => {
    const transport = await getRemoteTransport();
    if (!transport) return err('Sync is off');
    try {
      const records = await transport.listForDay(localDayKey(Date.now()));
      return ok({ devices: records.length });
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  },
} satisfies Pick<HandlerMap, 'ANKI_TEST' | 'HTTP_SIGNAL_TEST' | 'SYNC_TEST'>;
