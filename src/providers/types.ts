// The Provider interface — the only contract `core` cares about. Every
// task service we ever support implements this and nothing else.

import type { Result } from '@/shared/result';
import type { ListId, Project, ProviderId, Task } from '@/shared/types';

export interface ListTasksOpts {
  includeCompleted?: boolean;
  /** Cap the number of results returned. */
  max?: number;
}

export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;

  /**
   * Run the OAuth flow. Returns ok({authenticated: true}) on success.
   * Background is responsible for persisting tokens — providers expose
   * `isAuthenticated()` to query state afterwards.
   */
  authenticate(): Promise<Result<{ authenticated: boolean }, string>>;

  /**
   * Register background-lifetime listeners (e.g. the OAuth redirect
   * capture). Called synchronously on every service-worker wake, BEFORE
   * any await — listeners registered later can miss the very event that
   * woke a dead worker. Must not await. Optional: providers without
   * background listeners omit it.
   */
  wireBackground?(): void;

  isAuthenticated(): Promise<boolean>;

  /** Clear any persisted tokens. */
  disconnect(): Promise<void>;

  /**
   * List the user's projects. Implementations should put any
   * synthetic lists (e.g. `smart:today`) FIRST in the returned array
   * so the UI's default-to-first behavior surfaces them.
   */
  listProjects(): Promise<Result<Project[], string>>;

  /**
   * List tasks in a project or synthetic list. `listId === 'smart:today'`
   * fans out across projects and filters by `dueDate` in the user's
   * local timezone.
   */
  listTasks(listId: ListId, opts?: ListTasksOpts): Promise<Result<Task[], string>>;

  /**
   * Mark a task complete. `projectId` is required even for tasks from
   * a synthetic list — every Task carries its source projectId so the
   * UI can hand it back here.
   */
  completeTask(projectId: string, taskId: string): Promise<Result<void, string>>;

  /**
   * List tasks COMPLETED within [since, until] (epoch ms), keyed by the
   * provider's completion timestamp. Used by the task-budget gate to total
   * today's earned minutes. Optional: a provider whose API can't surface
   * completed tasks omits it, and the gate falls back accordingly.
   */
  listCompletedTasks?(range: { since: number; until: number }): Promise<Result<Task[], string>>;
}
