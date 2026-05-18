// TickTick implementation of the Provider interface. The synthetic
// `smart:today` list lives here because it's TickTick-specific —
// TickTick's open API has no first-party Today endpoint, so we fan out
// across projects and filter by `dueDate` in the user's LOCAL timezone.
// (Future providers like Todoist have a real Today filter; they'd skip
// the fan-out and call it directly.)

import { err, ok, type Result } from '@/shared/result';
import { isSynthetic, type ListId, type Project, type Task } from '@/shared/types';

import type { ListTasksOpts, Provider } from '../types';
import * as api from './api';
import { authorize, disconnect as oauthDisconnect, getValidTokens } from './oauth';

export const tickTickProvider: Provider = {
  id: 'ticktick',
  displayName: 'TickTick',

  async authenticate() {
    const r = await authorize();
    if (!r.ok) return err(r.error);
    return ok({ authenticated: true });
  },

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
};

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
  const projects = await api.listProjects();
  if (!projects.ok) return err(projects.error);

  // "Today" includes anything due BY end-of-day today — i.e. today's
  // tasks AND any overdue ones. This matches the behavior of TickTick's
  // own Today view and is what users actually expect ("show me what
  // needs doing today, including the things I missed").
  const end = endOfLocalDay(new Date());

  const matches: Task[] = [];
  for (const project of projects.value) {
    if (project.closed) continue;
    const data = await api.getProjectData(project.id);
    if (!data.ok) continue; // tolerate partial fan-out failures
    for (const t of data.value.tasks) {
      if (!opts.includeCompleted && t.status !== 0) continue;
      if (!t.dueDate) continue;
      if (!isDueByEndOfDay(t.dueDate, end)) continue;
      matches.push(mapTask(t));
    }
  }

  matches.sort(compareTasksByDue);
  return ok(opts.max ? matches.slice(0, opts.max) : matches);
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

function compareTasksByDue(a: Task, b: Task): number {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.title.localeCompare(b.title);
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
