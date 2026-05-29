// Task-complete gate — the first bundled gate.
//
// Policy: YouTube stays blocked until the user completes N tasks (default
// 1) via the ToDoTube panel; completing them grants a timed session
// (default 30 min). When the session expires, YouTube blocks again.
//
// In the ledger model this is the discrete-credit case: each completed
// task is a credit; reaching the threshold "spends" the credits to open a
// fixed-length window. (The continuous-credit case — Anki minutes — is a
// separate gate that uses `evaluate` + signals instead of `onEvent`.)
//
// State shape:  { unlockedUntil?: epochMs; progressCount?: number }
//   - unlockedUntil: when the current session ends (absent/past = blocked)
//   - progressCount: completions accumulated toward the threshold, reset
//     to 0 once a session is granted.

import { TASK_COMPLETE_GATE_ID, type GateConfig, type GateDecision } from '@/shared/types';

import type { Gate, GateContext, GateEvent } from '../types';

const MINUTE_MS = 60_000;
const DEFAULT_GRANT_MINUTES = 30;
const DEFAULT_TASKS_REQUIRED = 1;

interface TaskGateConfig {
  grantMinutes: number;
  tasksRequired: number;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readConfig(config: GateConfig): TaskGateConfig {
  return {
    grantMinutes: Math.max(1, numberOr(config.grantMinutes, DEFAULT_GRANT_MINUTES)),
    tasksRequired: Math.max(1, Math.floor(numberOr(config.tasksRequired, DEFAULT_TASKS_REQUIRED))),
  };
}

// Decision shown while a session is active. The overlay never renders the
// requirement in this case, but the contract requires one.
function allowedDecision(unlockedUntil: number): GateDecision {
  return {
    allowed: true,
    allowedUntil: unlockedUntil,
    requirement: { title: 'YouTube unlocked' },
  };
}

function blockedDecision(cfg: TaskGateConfig, progress: number): GateDecision {
  const noun = cfg.tasksRequired === 1 ? 'task' : 'tasks';
  return {
    allowed: false,
    requirement: {
      title: `Complete ${cfg.tasksRequired} ${noun} to unlock YouTube`,
      detail: `Unlocks ${cfg.grantMinutes} min of viewing.`,
      progress:
        cfg.tasksRequired > 1
          ? { current: progress, target: cfg.tasksRequired, unit: 'tasks' }
          : undefined,
    },
  };
}

export const taskCompleteGate: Gate = {
  id: TASK_COMPLETE_GATE_ID,
  displayName: 'Complete a task',

  // Defaults here mirror DEFAULT_* above so the UI and runtime agree.
  configSchema: [
    {
      kind: 'number',
      key: 'tasksRequired',
      label: 'Tasks to complete',
      help: 'How many tasks you must finish to unlock a viewing session.',
      default: DEFAULT_TASKS_REQUIRED,
      min: 1,
      max: 50,
      step: 1,
    },
    {
      kind: 'number',
      key: 'grantMinutes',
      label: 'Minutes unlocked',
      help: 'How long YouTube stays open once the condition is met.',
      default: DEFAULT_GRANT_MINUTES,
      min: 1,
      max: 600,
      step: 1,
    },
  ],

  async evaluate(ctx: GateContext): Promise<GateDecision> {
    const cfg = readConfig(ctx.config);
    const unlockedUntil = numberOr(ctx.state.unlockedUntil, 0);
    if (ctx.now < unlockedUntil) {
      return allowedDecision(unlockedUntil);
    }
    return blockedDecision(cfg, numberOr(ctx.state.progressCount, 0));
  },

  async onEvent(event: GateEvent, ctx: GateContext): Promise<Partial<GateDecision> | void> {
    if (event.type !== 'task-completed') return;

    const cfg = readConfig(ctx.config);

    // Completing a task during an active session shouldn't burn credit —
    // ignore it so the user isn't punished for staying productive.
    if (ctx.now < numberOr(ctx.state.unlockedUntil, 0)) return;

    const progress = numberOr(ctx.state.progressCount, 0) + 1;
    if (progress < cfg.tasksRequired) {
      return { nextState: { ...ctx.state, progressCount: progress } };
    }

    const unlockedUntil = ctx.now + cfg.grantMinutes * MINUTE_MS;
    return {
      ...allowedDecision(unlockedUntil),
      nextState: { unlockedUntil, progressCount: 0 },
    };
  },
};
