import { describe, expect, it } from 'vitest';

import { sortTasks } from './tasks';
import type { Task } from './types';

function task(partial: Partial<Task> & Pick<Task, 'id'>): Task {
  return { projectId: 'p', title: partial.id, completed: false, ...partial };
}

describe('sortTasks', () => {
  it('preserves order for providerOrder', () => {
    const tasks = [task({ id: 'b' }), task({ id: 'a' })];
    const out = sortTasks(tasks, 'providerOrder');
    expect(out.map((t) => t.id)).toEqual(['b', 'a']);
    expect(out).toBe(tasks); // same reference — no copy
  });

  it('sorts by due date ascending, undated last', () => {
    const tasks = [
      task({ id: 'late', dueDate: '2026-05-30T10:00:00+0000' }),
      task({ id: 'none' }),
      task({ id: 'early', dueDate: '2026-05-28T10:00:00+0000' }),
    ];
    expect(sortTasks(tasks, 'dueDate').map((t) => t.id)).toEqual(['early', 'late', 'none']);
  });

  it('breaks undated ties by title', () => {
    const tasks = [task({ id: 'zebra' }), task({ id: 'apple' })];
    expect(sortTasks(tasks, 'dueDate').map((t) => t.id)).toEqual(['apple', 'zebra']);
  });

  it('sorts by priority high-to-low, missing priority treated as none', () => {
    const tasks = [
      task({ id: 'mid', priority: 3 }),
      task({ id: 'none' }),
      task({ id: 'high', priority: 5 }),
    ];
    expect(sortTasks(tasks, 'priority').map((t) => t.id)).toEqual(['high', 'mid', 'none']);
  });

  it('does not mutate the input array when sorting', () => {
    const tasks = [task({ id: 'b', priority: 1 }), task({ id: 'a', priority: 5 })];
    sortTasks(tasks, 'priority');
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});
