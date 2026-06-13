// TickTick implementation of the Provider interface. The synthetic
// `smart:today` list lives here because it's TickTick-specific —
// TickTick's open API has no first-party Today endpoint, so we fan out
// across projects and filter by `dueDate` in the user's LOCAL timezone.
// (Future providers like Todoist have a real Today filter; they'd skip
// the fan-out and call it directly.)

import { log } from '@/shared/logger';
import { err, ok, type Result } from '@/shared/result';
import { compareByDue } from '@/shared/tasks';
import { isSynthetic, type ListId, type Project, type Task } from '@/shared/types';

import type { ListTasksOpts, Provider } from '../types';
import * as api from './api';
import {
  authorize,
  disconnect as oauthDisconnect,
  getValidTokens,
  wireOAuthCapture,
} from './oauth';

export const tickTickProvider: Provider = {
  id: 'ticktick',
  displayName: 'TickTick',

  async authenticate() {
    const r = await authorize();
    if (!r.ok) return err(r.error);
    return ok({ authenticated: true });
  },

  // OAuth redirect capture — must be wired synchronously on worker wake.
  wireBackground: wireOAuthCapture,

  async isAuthenticated() {
    const r = await getValidTokens();
    return r.ok;
  },

  async disconnect() {
    await oauthDisconnect();
  },

  async listProjects(): Promise<Result<Project[], string>> {
    const r = await api.listProjects();
    if (!r.ok) return err(r.error);
    const real: Project[] = r.value
      .filter((p) => !p.closed)
      .map((p) => ({ id: p.id, name: p.name, color: p.color }));
    // Synthetic Today appears first so the default selection picks it up.
    return ok([{ id: 'smart:today', name: 'Today', synthetic: true }, ...real]);
  },

  async listTasks(listId: ListId, opts: ListTasksOpts = {}): Promise<Result<Task[], string>> {
    if (isSynthetic(listId)) {
      return listTasksToday(opts);
    }
    return listTasksInProject(listId, opts);
  },

  async completeTask(projectId: string, taskId: string): Promise<Result<void, string>> {
    return api.completeTask(projectId, taskId);
  },

  async listCompletedTasks(range: {
    since: number;
    until: number;
  }): Promise<Result<Task[], string>> {
    const r = await api.getCompletedTasks({
      startDate: toTickTickDate(range.since),
      endDate: toTickTickDate(range.until),
    });
    if (!r.ok) return err(r.error);
    return ok(r.value.map(mapTask));
  },
};

// TickTick wants ISO-8601 with a numeric offset ("…+0000"), not the "Z"
// that Date.toISOString() emits. We send UTC instants, so the offset is
// always +0000.
function toTickTickDate(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '+0000');
}

async function listTasksInProject(
  projectId: string,
  opts: ListTasksOpts,
): Promise<Result<Task[], string>> {
  const r = await api.getProjectData(projectId);
  if (!r.ok) return err(r.error);
  const filtered = r.value.tasks
    .filter((t) => (opts.includeCompleted ? true : t.status === 0))
    .map(mapTask);
  return ok(opts.max ? filtered.slice(0, opts.max) : filtered);
}

async function listTasksToday(opts: ListTasksOpts): Promise<Result<Task[], string>> {
  // NOTE: TickTick's open API (/open/v1/project) does NOT expose the
  // Inbox. Tasks in the Inbox are therefore invisible to this fan-out.
  // This is a platform limitation — there is no public endpoint that
  // returns Inbox contents. See https://developer.ticktick.com/api.
  const projects = await api.listProjects();
  if (!projects.ok) return err(projects.error);

  // Two windows, OR'd together to decide if a task lands in Today:
  //   1. dueDate in a rolling 3-day window (today + previous 2 days)
  //      catches today's deadlines plus very-recent overdue items;
  //   2. startDate strictly on today picks up tasks that don't have a
  //      dueDate yet but are SCHEDULED to start today.
  // The 3-day bound on dueDate keeps long-deferred items ("Later"
  // projects with year-old due dates) from drowning out the relevant
  // work — TickTick's own Today view filters those via a per-project
  // "Hide from Smart Lists" flag the open API doesn't expose, so the
  // bound is our substitute.
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(now.getDate() - 2);
  const windowStart = startOfLocalDay(twoDaysAgo);
  const windowEnd = endOfLocalDay(now);
  const dayStart = startOfLocalDay(now);
  const dayEnd = windowEnd;

  const matches: Task[] = [];
  let considered = 0;

  function processTask(t: api.TickTickTask): void {
    considered++;
    const decision = decideTodayInclusion(t, windowStart, windowEnd, dayStart, dayEnd, opts);
    log.debug(
      `Today/task title="${truncate(t.title, 60)}" id=${t.id} projectId=${t.projectId} ` +
        `status=${t.status} dueDate=${t.dueDate ?? 'null'} startDate=${t.startDate ?? 'null'} ` +
        `→ ${decision.include ? 'INCLUDED' : `SKIPPED:${decision.reason}`}`,
    );
    if (decision.include) matches.push(mapTask(t));
  }

  for (const project of projects.value) {
    if (project.closed) {
      log.debug(`Today/scan project "${project.name}" id=${project.id} closed=true tasks=skipped`);
      continue;
    }
    const data = await api.getProjectData(project.id);
    if (!data.ok) {
      log.debug(`Today/scan project "${project.name}" id=${project.id} error=${data.error}`);
      continue; // tolerate partial fan-out failures
    }
    log.debug(
      `Today/scan project "${project.name}" id=${project.id} closed=false tasks=${data.value.tasks.length}`,
    );
    for (const t of data.value.tasks) processTask(t);
  }

  // Inbox is not part of /open/v1/project, so fetch it explicitly. The
  // open API may or may not honor this — Garmin's working integration
  // hits a different base URL, and we don't know yet whether the open
  // endpoint accepts "inbox" as a project id. Best-effort: log + skip
  // on failure.
  const inbox = await api.getProjectData('inbox');
  if (inbox.ok) {
    log.debug(`Today/scan project "Inbox" id=inbox tasks=${inbox.value.tasks.length}`);
    for (const t of inbox.value.tasks) processTask(t);
  } else {
    log.debug(`Today/scan project "Inbox" id=inbox error=${inbox.error}`);
  }

  log.debug(
    `Today/summary considered=${considered} included=${matches.length} ` +
      `dueWindow=[${windowStart.toISOString()} .. ${windowEnd.toISOString()}] ` +
      `startDay=[${dayStart.toISOString()} .. ${dayEnd.toISOString()}]`,
  );

  matches.sort(compareByDue);
  return ok(opts.max ? matches.slice(0, opts.max) : matches);
}

/**
 * Pure decision function — separate so logging can name the reason a
 * task was excluded. A task qualifies for Today iff it is not completed
 * AND either:
 *   - its `dueDate` falls inside `[windowStart, windowEnd]` (the rolling
 *     3-day local window: today + previous 2 days), OR
 *   - its `startDate` falls inside `[dayStart, dayEnd]` (strict today).
 * The dueDate window catches deadlines + recent overdue; the startDate
 * day catches tasks scheduled to start today even without a dueDate.
 */
function decideTodayInclusion(
  t: api.TickTickTask,
  windowStart: Date,
  windowEnd: Date,
  dayStart: Date,
  dayEnd: Date,
  opts: ListTasksOpts,
): { include: true } | { include: false; reason: string } {
  if (!opts.includeCompleted && t.status !== 0) return { include: false, reason: 'completed' };
  if (t.dueDate && isDueBetween(t.dueDate, windowStart, windowEnd)) return { include: true };
  if (t.startDate && isDueBetween(t.startDate, dayStart, dayEnd)) return { include: true };
  return { include: false, reason: 'not-today' };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function mapTask(t: api.TickTickTask): Task {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    dueDate: t.dueDate,
    priority: t.priority,
    completed: t.status !== 0,
  };
}

// --- Exported for unit tests (DST and timezone behavior).

export function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function endOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

export function isDueBetween(iso: string, start: Date, end: Date): boolean {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return false;
  const ms = due.getTime();
  return ms >= start.getTime() && ms <= end.getTime();
}

/**
 * True when `iso` is at or before `end` (i.e. due-or-overdue by `end`).
 * Used by the Today smart list to include overdue tasks.
 */
export function isDueByEndOfDay(iso: string, end: Date): boolean {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() <= end.getTime();
}
