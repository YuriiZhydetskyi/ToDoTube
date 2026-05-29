// A Gate is an access policy: it decides whether YouTube may be used right
// now and, if not, what the user must do to unlock it. Gates are the
// second pluggable axis of ToDoTube (the first is providers). A gate is
// pure policy — it reads signals + its own config/state and returns a
// decision; it never touches the DOM and never persists anything itself
// (the core writes back any `nextState`).
//
// The data DTOs (`GateDecision`, `RequirementView`, `SignalValue`, …) live
// in `shared/types` because they cross the message bus. This file owns the
// behavioral interfaces only.

import type { Result } from '@/shared/result';
import type { GateConfig, GateDecision, GateState, ProviderId, SignalValue } from '@/shared/types';

// Everything a gate needs to make a decision, injected by the core so the
// gate stays decoupled from storage and from the signals registry.
export interface GateContext {
  now: number;
  // The debit side of ledger-style gates: time spent on YouTube today.
  youtubeUsageTodayMs: number;
  // Pull an external sensor by id (the core bridges to the signals
  // registry). Returns err for unknown/unreachable signals.
  readSignal: (id: string, config?: unknown) => Promise<Result<SignalValue, string>>;
  state: GateState;
  config: GateConfig;
}

// Domain events the core forwards to the active gate so event-driven gates
// (e.g. "completing a task grants a session") can react. Poll-driven gates
// (e.g. an Anki budget) ignore these and rely on `evaluate` alone.
export type GateEvent = { type: 'task-completed'; providerId: ProviderId; taskId: string };

export interface Gate {
  readonly id: string;
  readonly displayName: string;

  /** Compute the current decision. Must be side-effect free besides
   * returning `nextState` for the core to persist. */
  evaluate(ctx: GateContext): Promise<GateDecision>;

  /** React to a domain event. Returns a partial decision whose
   * `nextState` (if any) the core persists before re-evaluating. */
  onEvent?(event: GateEvent, ctx: GateContext): Promise<Partial<GateDecision> | void>;
}
