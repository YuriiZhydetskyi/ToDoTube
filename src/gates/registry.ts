// One-stop lookup from a GateId to its implementation, mirroring
// providers/registry.ts. Adding a gate is: drop a folder under
// `src/gates/<name>/`, export a `Gate`, add one case here, and one entry
// to AVAILABLE_GATES so the options page can offer it.

import {
  ACTIVITY_BUDGET_GATE_ID,
  ANKI_BUDGET_GATE_ID,
  TASK_COMPLETE_GATE_ID,
  type GateConfigField,
  type GateId,
} from '@/shared/types';

import { activityBudgetGate } from './activity-budget/gate';
import { ankiBudgetGate } from './anki-budget/gate';
import { taskCompleteGate } from './task-complete/gate';
import type { Gate } from './types';

export function getGateOrNull(id: GateId | null): Gate | null {
  switch (id) {
    case TASK_COMPLETE_GATE_ID:
      return taskCompleteGate;
    case ANKI_BUDGET_GATE_ID:
      return ankiBudgetGate;
    case ACTIVITY_BUDGET_GATE_ID:
      return activityBudgetGate;
    default:
      return null;
  }
}

// Metadata for the settings UI (gate picker + config fields). Kept here
// next to the registry so a new gate is registered in exactly one file.
// Carries the gate's configSchema so the (ui-layer) options page can render
// config fields generically without importing the gates/ layer.
export interface GateDescriptor {
  id: GateId;
  displayName: string;
  configSchema?: readonly GateConfigField[];
}

function describe(gate: Gate): GateDescriptor {
  return { id: gate.id, displayName: gate.displayName, configSchema: gate.configSchema };
}

export const AVAILABLE_GATES: readonly GateDescriptor[] = [
  describe(taskCompleteGate),
  describe(ankiBudgetGate),
  describe(activityBudgetGate),
];
