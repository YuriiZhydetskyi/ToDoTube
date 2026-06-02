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
import type {
  GateConfig,
  GateConfigField,
  GateDecision,
  GateState,
  SignalValue,
  Task,
} from '@/shared/types';

// Everything a gate needs to make a decision, injected by the core so the
// gate stays decoupled from storage, the signals registry, and providers.
export interface GateContext {
  now: number;
  // The debit side of ledger-style gates: time spent on YouTube today.
  youtubeUsageTodayMs: number;
  // Pull an external sensor by id (the core bridges to the signals
  // registry). Returns err for unknown/unreachable signals.
  readSignal: (id: string, config?: unknown) => Promise<Result<SignalValue, string>>;
  // Tasks the user COMPLETED in the current local day, from the active
  // provider (the core bridges to providers/, which gates may not import).
  // The credit side of the task-budget gate. Returns err when no provider
  // is connected or its API can't surface completed tasks.
  readCompletedTasksToday: () => Promise<Result<Task[], string>>;
  state: GateState;
  config: GateConfig;
}

export interface Gate {
  readonly id: string;
  readonly displayName: string;

  /** User-configurable fields, rendered generically by the options page.
   * Omit for gates with no settings. */
  readonly configSchema?: readonly GateConfigField[];

  /** Compute the current decision. Must be side-effect free besides
   * returning `nextState` for the core to persist. */
  evaluate(ctx: GateContext): Promise<GateDecision>;
}
