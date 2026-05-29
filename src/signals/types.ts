// A Signal is a read-only sensor: it produces a single measurable value
// (a duration or a count) that gates consume to decide access. Signals
// know their data source (e.g. AnkiConnect) and nothing about gates, DOM,
// or YouTube — the mirror image of how providers know task APIs only.
//
// The value DTO (`SignalValue`) lives in `shared/types` because it crosses
// the layer boundary into gates; this file owns only the behavioral
// interface.

import type { Result } from '@/shared/result';
import type { SignalValue } from '@/shared/types';

export interface Signal {
  readonly id: string;
  readonly displayName: string;

  /**
   * Sample the current value. `config` is the user's per-signal settings
   * (opaque here; each signal validates its own shape) — e.g. the generic
   * HTTP signal's URL + JSON path.
   */
  read(config?: unknown): Promise<Result<SignalValue, string>>;

  /**
   * Optional cheap reachability check, distinct from `read`. Lets a gate
   * tell "source unreachable" (e.g. Anki not running) apart from a real
   * zero value, so it can apply the user's fail-open / fail-closed choice.
   */
  probe?(): Promise<Result<void, string>>;
}
