// Vanilla-DOM block screen. Gate-agnostic: it renders a RequirementView
// (title, optional detail, optional progress meter, optional CTA, optional
// task list). The CSS is imported as a string via Vite's `?inline` and
// re-exported so the surface layer can inject it into the overlay's shadow
// root — mirroring how panel.ts hands `panelCss` to the watch adapter.

import { parseBudgetAnnotation } from '@/shared/budget-annotation';
import blockScreenCssText from '@/ui/styles/block-screen.css?inline';

import type { RequirementView } from '@/shared/types';

export const blockScreenCss: string = blockScreenCssText;

export interface BlockScreenCallbacks {
  // Completes a task from the block-screen list. Resolves true on success,
  // false on failure so the row can re-enable itself and signal the error.
  onCompleteTask?: (projectId: string, taskId: string) => Promise<boolean>;
  // Drops the provider cache and asks the background for a fresh task list.
  onRefreshTasks?: () => Promise<boolean>;
}

export function renderBlockScreen(
  root: HTMLElement,
  requirement: RequirementView,
  callbacks?: BlockScreenCallbacks,
): void {
  root.className = 'tt-block';
  root.replaceChildren();

  const card = el('div', 'tt-block__card');

  const brand = el('p', 'tt-block__brand');
  brand.textContent = 'ToDoTube';
  card.appendChild(brand);

  const title = el('h1', 'tt-block__title');
  title.textContent = requirement.title;
  card.appendChild(title);

  if (requirement.detail) {
    const detail = el('p', 'tt-block__detail');
    detail.textContent = requirement.detail;
    card.appendChild(detail);
  }

  // Sections render independently — a task list never suppresses a CTA.
  if (requirement.progress) {
    card.appendChild(renderProgress(requirement.progress));
  }
  if (requirement.action) {
    card.appendChild(renderAction(requirement.action));
  }
  if (requirement.tasks !== undefined) {
    card.appendChild(
      renderTaskList(requirement.tasks, callbacks?.onCompleteTask, callbacks?.onRefreshTasks),
    );
  }

  root.appendChild(card);
}

function renderProgress(progress: NonNullable<RequirementView['progress']>): HTMLElement {
  const wrap = el('div', 'tt-block__progress');

  const track = el('div', 'tt-block__progress-track');
  const fill = el('div', 'tt-block__progress-fill');
  const pct = progress.target > 0 ? Math.min(100, (progress.current / progress.target) * 100) : 0;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  wrap.appendChild(track);

  const label = el('div', 'tt-block__progress-label');
  label.textContent = `${progress.current} / ${progress.target} ${progress.unit}`;
  wrap.appendChild(label);

  return wrap;
}

function renderAction(action: NonNullable<RequirementView['action']>): HTMLElement {
  if (action.url) {
    const link = el('a', 'tt-block__action');
    link.textContent = action.label;
    (link as HTMLAnchorElement).href = action.url;
    (link as HTMLAnchorElement).target = '_blank';
    (link as HTMLAnchorElement).rel = 'noopener noreferrer';
    return link;
  }
  const button = el('button', 'tt-block__action');
  button.textContent = action.label;
  return button;
}

function renderTaskList(
  tasks: NonNullable<RequirementView['tasks']>,
  onComplete?: (projectId: string, taskId: string) => Promise<boolean>,
  onRefresh?: () => Promise<boolean>,
): HTMLElement {
  const wrap = el('div', 'tt-block__tasks');
  const controls = el('div', 'tt-block__tasks-controls');
  const refresh = el('button', 'tt-block__tasks-refresh') as HTMLButtonElement;
  refresh.type = 'button';
  refresh.textContent = 'Refresh tasks';
  refresh.addEventListener('click', () => {
    if (refresh.disabled) return;
    refresh.disabled = true;
    refresh.textContent = 'Refreshing...';
    refresh.classList.remove('tt-block__tasks-refresh--error');
    void Promise.resolve(onRefresh?.()).then((ok) => {
      // A successful refresh normally replaces this DOM through apply(). If the
      // result is unchanged, restore the button in place.
      if (!refresh.isConnected) return;
      refresh.disabled = false;
      refresh.textContent = ok === false ? 'Refresh failed - retry' : 'Refresh tasks';
      refresh.classList.toggle('tt-block__tasks-refresh--error', ok === false);
    });
  });
  controls.appendChild(refresh);
  wrap.appendChild(controls);

  if (tasks.length === 0) {
    const empty = el('p', 'tt-block__tasks-empty');
    empty.textContent = 'No open tasks here — complete a task to earn viewing time.';
    wrap.appendChild(empty);
    return wrap;
  }

  const list = el('ul', 'tt-block__task-list');
  for (const task of tasks) {
    list.appendChild(renderTaskRow(task, onComplete));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderTaskRow(
  task: NonNullable<RequirementView['tasks']>[number],
  onComplete?: (projectId: string, taskId: string) => Promise<boolean>,
): HTMLElement {
  const item = el('li', 'tt-block__task');
  const { minutes, cleanTitle } = parseBudgetAnnotation(task.title);

  const btn = el('button', 'tt-block__task-btn') as HTMLButtonElement;
  btn.type = 'button';
  btn.setAttribute('aria-label', `Complete: ${cleanTitle}`);
  btn.appendChild(el('span', 'tt-block__task-check'));

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('tt-block__task-btn--loading');
    item.classList.remove('tt-block__task--error');
    // On success the GATE_CHANGED broadcast re-renders this list (the task
    // drops off). On failure we re-enable so the user can retry.
    void Promise.resolve(onComplete?.(task.projectId, task.id)).then((ok) => {
      if (ok === false) {
        btn.disabled = false;
        btn.classList.remove('tt-block__task-btn--loading');
        item.classList.add('tt-block__task--error');
      }
    });
  });

  const label = el('span', 'tt-block__task-label');
  label.textContent = cleanTitle;

  item.appendChild(btn);
  item.appendChild(label);
  if (minutes !== null) {
    const badge = el('span', 'tt-block__task-badge');
    badge.textContent = `+${minutes} min`;
    item.appendChild(badge);
  }
  return item;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
