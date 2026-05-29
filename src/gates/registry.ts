// One-stop lookup from a GateId to its implementation, mirroring
// providers/registry.ts. Adding a gate is: drop a folder under
// `src/gates/<name>/`, export a `Gate`, add one case here, and one entry
// to AVAILABLE_GATES so the options page can offer it.

import { ANKI_BUDGET_GATE_ID, TASK_COMPLETE_GATE_ID, type GateId } from '@/shared/types';

import { ankiBudgetGate } from './anki-budget/gate';
import { taskCompleteGate } from './task-complete/gate';
import type { Gate } from './types';

export function getGateOrNull(id: GateId | null): Gate | null {
  switch (id) {
    case TASK_COMPLETE_GATE_ID:
      return taskCompleteGate;
    case ANKI_BUDGET_GATE_ID:
      return ankiBudgetGate;
    default:
      return null;
  }
}

// Metadata for the settings UI (gate picker). Kept here next to the
// registry so a new gate is registered in exactly one file.
export interface GateDescriptor {
  id: GateId;
  displayName: string;
}

export const AVAILABLE_GATES: readonly GateDescriptor[] = [
  { id: taskCompleteGate.id, displayName: taskCompleteGate.displayName },
  { id: ankiBudgetGate.id, displayName: ankiBudgetGate.displayName },
];
