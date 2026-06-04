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
// Each evaluation recomputes earned from that list, so externally-completed
// tasks (closed in the TickTick app) are reflected on the next tick with no
// polling or dedup. The only persisted state is a cache of today's
// last-known-good earned total: TickTick's completed-tasks endpoint is
// UNDOCUMENTED (see providers/ticktick/api.ts), so when it's unreachable the
// gate falls back to that cached total instead of dropping earned to zero —
// and only when there's no cached total yet does it apply the configured fail
// mode. That default is fail-OPEN: an unreachable CLOUD task API isn't
// something the user can fix (unlike a not-running local Anki/bridge), so we
// don't hard-lock browsing on it.
//
// (The id constant is still TASK_COMPLETE_GATE_ID for storage/settings
// continuity — it predates the budget model.)

import { MINUTE_MS, ledgerDecision, toMin } from '@/gates/_shared/ledger';
import { parseBudgetAnnotation } from '@/shared/budget-annotation';
import { localDayKey } from '@/shared/day';
import {
  TASK_COMPLETE_GATE_ID,
  type GateConfig,
  type GateDecision,
  type GateState,
  type Task,
} from '@/shared/types';

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
    // Default fail-OPEN: see the file header. Only an explicit 'closed' blocks.
    failMode: config.failMode === 'closed' ? 'closed' : 'open',
  };
}

// Total earned minutes for a completed-tasks list: each task's "(+N min y)"
// annotation, or the per-task default when it has none.
function totalEarnedMin(tasks: readonly Task[], minutesPerTask: number): number {
  return tasks.reduce((sum, task) => {
    const { minutes } = parseBudgetAnnotation(task.title);
    return sum + (minutes ?? minutesPerTask);
  }, 0);
}

// Today's persisted last-known-good earned, or null when the stored state is
// for a different day / missing / malformed.
function cachedEarnedToday(state: GateState, today: string): number | null {
  if (state.day !== today) return null;
  const ms = state.earnedMs;
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
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
      help: "Used only if your task list can't be reached AND there's no earlier total from today to fall back on.",
      default: 'open',
      options: [
        ['open', 'Allow the sites'],
        ['closed', 'Block the sites'],
      ],
    },
  ],

  async evaluate(ctx: GateContext): Promise<GateDecision> {
    const cfg = readConfig(ctx.config);
    const today = localDayKey(ctx.now);
    const spentMs = ctx.spentTodayMs;

    const completed = await ctx.readCompletedTasksToday();

    if (completed.ok) {
      const earnedMin = totalEarnedMin(completed.value, cfg.minutesPerTask);
      const earnedMs = earnedMin * MINUTE_MS;
      const taskWord = completed.value.length === 1 ? 'task' : 'tasks';

      const decision = ledgerDecision(earnedMs, spentMs, {
        blockedTitle: 'Complete a task to unlock access',
        blockedDetail:
          `${completed.value.length} ${taskWord} done today = ${earnedMin} min earned · ` +
          `used ${toMin(spentMs)} min. Finish another task (${cfg.minutesPerTask} min each, ` +
          `or "+N min y" in the title) to keep browsing.`,
      });

      // Cache the fresh total so a later read failure (or an MV3 service-worker
      // restart mid-day) can fall back to it. Only write when it changed, to
      // avoid a storage write on every evaluation.
      const cached = cachedEarnedToday(ctx.state, today);
      return cached === earnedMs ? decision : { ...decision, nextState: { day: today, earnedMs } };
    }

    // Endpoint unreachable. Prefer today's last-known-good earned so a transient
    // outage doesn't suddenly drop earned to zero and re-lock a busy user.
    const cachedEarnedMs = cachedEarnedToday(ctx.state, today);
    if (cachedEarnedMs !== null) {
      return ledgerDecision(cachedEarnedMs, spentMs, {
        blockedTitle: 'Complete a task to unlock access',
        blockedDetail:
          `${toMin(cachedEarnedMs)} min earned today · used ${toMin(spentMs)} min. ` +
          `Couldn't refresh your task list right now (${completed.error}); using the last known total.`,
      });
    }

    // No good read yet today: fall back to the configured policy (default open).
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
  },
};
