// Task-budget gate — the discrete-task case of the ledger model.
//
// earned = Σ over tasks completed TODAY of their screen-time minutes:
//          a "(+N min y)" annotation in the title, else the per-task default
// spent  = screen-time minutes used today (ctx.spentTodayMs)
// allowed while earned − spent > 0
//
// Unlike Anki/Garmin (which read a sensor via ctx.readSignal), this gate's
// credit comes from the active provider's completed-tasks list, injected as
// ctx.readCompletedTasksToday — gates may not import providers/ directly.
//
// This is a pure `evaluate` gate: each evaluation recomputes earned from
// scratch, so externally-completed tasks (closed in the TickTick app) are
// reflected on the next tick with no polling, dedup, or persisted state.
//
// (The id constant is still TASK_COMPLETE_GATE_ID for storage/settings
// continuity — it predates the budget model.)

import { MINUTE_MS, ledgerDecision, toMin } from '@/gates/_shared/ledger';
import { parseBudgetAnnotation } from '@/shared/budget-annotation';
import { TASK_COMPLETE_GATE_ID, type GateConfig, type GateDecision } from '@/shared/types';

import type { Gate, GateContext } from '../types';

const DEFAULT_MINUTES_PER_TASK = 10;
type FailMode = 'open' | 'closed';

interface TaskBudgetConfig {
  minutesPerTask: number;
  failMode: FailMode;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readConfig(config: GateConfig): TaskBudgetConfig {
  return {
    minutesPerTask: Math.max(0, numberOr(config.minutesPerTask, DEFAULT_MINUTES_PER_TASK)),
    failMode: config.failMode === 'open' ? 'open' : 'closed',
  };
}

export const taskCompleteGate: Gate = {
  id: TASK_COMPLETE_GATE_ID,
  displayName: 'Earn time by completing tasks',

  configSchema: [
    {
      kind: 'number',
      key: 'minutesPerTask',
      label: 'Minutes earned per task',
      help: 'Each task you finish today earns this much viewing time. Override per task by adding "(+N min y)" to its title.',
      default: DEFAULT_MINUTES_PER_TASK,
      min: 1,
      max: 600,
      step: 1,
    },
    {
      kind: 'select',
      key: 'failMode',
      label: "When tasks can't be reached",
      help: 'Applied if your task provider is disconnected or unreachable.',
      default: 'closed',
      options: [
        ['closed', 'Block the sites'],
        ['open', 'Allow the sites'],
      ],
    },
  ],

  async evaluate(ctx: GateContext): Promise<GateDecision> {
    const cfg = readConfig(ctx.config);

    const completed = await ctx.readCompletedTasksToday();
    if (!completed.ok) {
      if (cfg.failMode === 'open') {
        return { allowed: true, requirement: { title: 'Access unlocked' } };
      }
      return {
        allowed: false,
        requirement: {
          title: 'Connect your tasks to unlock access',
          detail: `Couldn't reach your task list (${completed.error}).`,
        },
      };
    }

    const earnedMin = completed.value.reduce((sum, task) => {
      const { minutes } = parseBudgetAnnotation(task.title);
      return sum + (minutes ?? cfg.minutesPerTask);
    }, 0);
    const earnedMs = earnedMin * MINUTE_MS;
    const spentMs = ctx.spentTodayMs;
    const taskWord = completed.value.length === 1 ? 'task' : 'tasks';

    return ledgerDecision(earnedMs, spentMs, {
      blockedTitle: 'Complete a task to unlock access',
      blockedDetail:
        `${completed.value.length} ${taskWord} done today = ${earnedMin} min earned · ` +
        `used ${toMin(spentMs)} min. Finish another task (${cfg.minutesPerTask} min each, ` +
        `or "+N min y" in the title) to keep browsing.`,
    });
  },
};
