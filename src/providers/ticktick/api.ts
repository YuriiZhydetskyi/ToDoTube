// Thin fetch wrapper for TickTick's open API. The provider in
// provider.ts is the only consumer.
//
// `any` lives at exactly the JSON-parse boundary and is immediately
// narrowed by a small set of type guards. The rest of the file is
// strictly typed.

import { fetchWithTimeout } from '@/shared/fetch';
import { log } from '@/shared/logger';
import { err, ok, type Result } from '@/shared/result';

import { API_BASE, API_TIMEOUT_MS } from './config';
import { forceRefresh, getValidTokens } from './oauth';

export interface TickTickProject {
  id: string;
  name: string;
  color?: string;
  closed?: boolean;
}

// TickTick's task status: 0 = open, 2 = completed (1 is internal "doing"
// state in some workflows). Anything non-zero is "done" for our purposes.
export interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  dueDate?: string;
  startDate?: string;
  priority?: number;
  status: number;
  // Present on tasks returned by the completed-tasks endpoint:
  // "yyyy-MM-dd'T'HH:mm:ssZ". Absent on the undone-task /data endpoint.
  completedTime?: string;
}

export interface ProjectData {
  // Optional — TickTick's open API returns regular projects with a
  // `project` wrapper, but `/project/inbox/data` returns just `{ tasks
  // }` without one. We don't read this field anywhere, so we tolerate
  // its absence.
  project?: TickTickProject;
  tasks: TickTickTask[];
}

export async function listProjects(): Promise<Result<TickTickProject[], string>> {
  const r = await authedFetch('/open/v1/project');
  if (!r.ok) return err(r.error);
  const json = await safeJson(r.value);
  logApiResponse('/open/v1/project', json);
  if (!Array.isArray(json)) return err('Expected an array from /open/v1/project');
  return ok(json.filter(isTickTickProject));
}

export async function getProjectData(projectId: string): Promise<Result<ProjectData, string>> {
  const r = await authedFetch(`/open/v1/project/${encodeURIComponent(projectId)}/data`);
  if (!r.ok) return err(r.error);
  const json = await safeJson(r.value);
  logApiResponse(`/open/v1/project/${projectId}/data`, json);
  if (!isProjectData(json)) return err('Malformed project data response');
  return ok(json);
}

/**
 * Retrieve tasks marked completed within [startDate, endDate] (filtered by
 * completedTime). Dates are ISO-8601 with offset, e.g.
 * "2026-03-01T00:58:20.000+0000". `projectIds` is optional — omit to span
 * all projects.
 *
 * NOTE: This endpoint is NOT part of the small documented TickTick open API
 * surface (which only exposes UNDONE tasks via /project/{id}/data). It is
 * verified empirically against api.ticktick.com — if it 404s, the caller
 * must fall back. See docs / the gate's data source.
 */
export async function getCompletedTasks(params: {
  startDate: string;
  endDate: string;
  projectIds?: string[];
}): Promise<Result<TickTickTask[], string>> {
  const r = await authedFetch('/open/v1/task/completed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) return err(r.error);
  const json = await safeJson(r.value);
  logApiResponse('/open/v1/task/completed', json);
  if (!Array.isArray(json)) return err('Expected an array from /open/v1/task/completed');
  return ok(json.filter(isTickTickTask));
}

export async function completeTask(
  projectId: string,
  taskId: string,
): Promise<Result<void, string>> {
  const r = await authedFetch(
    `/open/v1/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
    { method: 'POST' },
  );
  if (!r.ok) return err(r.error);
  return ok(undefined);
}

async function authedFetch(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<Result<Response, string>> {
  const tokens = retried ? await forceRefresh() : await getValidTokens();
  if (!tokens.ok) return err(tokens.error);

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${tokens.value.accessToken}`);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(`${API_BASE}${path}`, { ...init, headers }, API_TIMEOUT_MS);
  } catch (e) {
    // Network error, or the request outliving API_TIMEOUT_MS (a hung socket).
    return err(`Network error: ${e instanceof Error ? e.message : String(e)}`);
  }

  log.debug(`TickTick API ${init?.method ?? 'GET'} ${path} -> ${resp.status} ${resp.statusText}`);

  if (resp.status === 401 && !retried) {
    log.debug('TickTick 401; refreshing and retrying once');
    return authedFetch(path, init, true);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return err(`TickTick ${resp.status}: ${text.slice(0, 200)}`);
  }
  return ok(resp);
}

function logApiResponse(path: string, payload: unknown): void {
  // Keep this as an object so DevTools shows an expandable payload, including
  // every task field returned by TickTick. `log.debug` gates it behind the
  // user's Verbose logging setting.
  log.debug(`TickTick API response ${path}:`, payload);
}
async function safeJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

function isTickTickProject(v: unknown): v is TickTickProject {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string';
}

function isTickTickTask(v: unknown): v is TickTickTask {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.projectId === 'string' &&
    typeof o.title === 'string' &&
    typeof o.status === 'number'
  );
}

function isProjectData(v: unknown): v is ProjectData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  // `project` is optional — see ProjectData. If present, it must match
  // the project shape; if absent, that's fine.
  if (o.project !== undefined && !isTickTickProject(o.project)) return false;
  if (!Array.isArray(o.tasks)) return false;
  return o.tasks.every(isTickTickTask);
}
