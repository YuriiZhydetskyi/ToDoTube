// Thin fetch wrapper for TickTick's open API. The provider in
// provider.ts is the only consumer.
//
// `any` lives at exactly the JSON-parse boundary and is immediately
// narrowed by a small set of type guards. The rest of the file is
// strictly typed.

import { log } from '@/shared/logger';
import { err, ok, type Result } from '@/shared/result';

import { API_BASE } from './config';
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
}

export interface ProjectData {
  project: TickTickProject;
  tasks: TickTickTask[];
}

export async function listProjects(): Promise<Result<TickTickProject[], string>> {
  const r = await authedFetch('/open/v1/project');
  if (!r.ok) return err(r.error);
  const json = await safeJson(r.value);
  if (!Array.isArray(json)) return err('Expected an array from /open/v1/project');
  return ok(json.filter(isTickTickProject));
}

export async function getProjectData(projectId: string): Promise<Result<ProjectData, string>> {
  const r = await authedFetch(`/open/v1/project/${encodeURIComponent(projectId)}/data`);
  if (!r.ok) return err(r.error);
  const json = await safeJson(r.value);
  if (!isProjectData(json)) return err('Malformed project data response');
  return ok(json);
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
    resp = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    return err(`Network error: ${e instanceof Error ? e.message : String(e)}`);
  }

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
  if (!o.project || !isTickTickProject(o.project)) return false;
  if (!Array.isArray(o.tasks)) return false;
  return o.tasks.every(isTickTickTask);
}
