// User-preference sorting for the task list. Provider-agnostic: operates
// on the normalized `Task` shape, so it sits in `shared` (a leaf) and is
// applied once in the background handler — see `core/background/handlers`.
//
// `providerOrder` preserves whatever order the provider returned (for
// TickTick that's API order for projects, due-sorted for the synthetic
// Today list). The other modes re-sort a copy.

import type { SortBy, Task } from './types';

export function sortTasks(tasks: Task[], sortBy: SortBy): Task[] {
  if (sortBy === 'providerOrder') return tasks;
  const sorted = [...tasks];
  sorted.sort(sortBy === 'priority' ? compareByPriority : compareByDue);
  return sorted;
}

// Due first (ascending ISO), then undated tasks by title. ISO 8601 strings
// with a consistent offset sort lexicographically, so localeCompare is safe.
// Exported so providers can reuse it as their natural-order comparator.
export function compareByDue(a: Task, b: Task): number {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.title.localeCompare(b.title);
}

// Higher priority bucket first (5 = high … 0 = none); ties fall back to due.
function compareByPriority(a: Task, b: Task): number {
  const pa = a.priority ?? 0;
  const pb = b.priority ?? 0;
  if (pa !== pb) return pb - pa;
  return compareByDue(a, b);
}
