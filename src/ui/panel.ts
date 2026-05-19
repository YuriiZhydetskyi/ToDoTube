// Vanilla-DOM panel. Provider-agnostic. The lifecycle layer owns the
// canonical task list; this file is a render-only function over a typed
// state value, plus `updatePanel(root, state)` as an alias for the
// initial-mount + re-render path.
//
// Styling lives in `src/ui/styles/panel.css`. We import the compiled
// CSS as a string via Vite's `?inline` and re-export it here so callers
// (the lifecycle layer) can hand it to the surface adapter for shadow
// root injection — keeping the surfaces layer free of UI dependencies.

import panelCssText from '@/ui/styles/panel.css?inline';

import { isSynthetic, type ListId, type Project, type Task } from '@/shared/types';

export const panelCss: string = panelCssText;

// Optional header rendered above the task body — list picker on the
// left, refresh button on the right. The lifecycle passes this only
// when authenticated; states with no header (placeholder, disconnected)
// render without one.
export interface PanelHeader {
  projects: Project[];
  currentListId: ListId;
  onListChange: (listId: ListId) => void;
  onRefresh: () => void;
}

export type PanelState =
  | { kind: 'placeholder' }
  | { kind: 'loading'; header?: PanelHeader }
  | { kind: 'disconnected'; onConnect: () => void }
  | { kind: 'empty'; header?: PanelHeader }
  | { kind: 'list'; tasks: Task[]; onComplete: (task: Task) => void; header?: PanelHeader }
  | { kind: 'error'; message: string; onRetry: () => void; header?: PanelHeader };

export function renderPanel(root: HTMLElement, state: PanelState): void {
  root.className = 'tt-panel';
  root.replaceChildren();

  if ('header' in state && state.header) {
    root.appendChild(renderHeader(state.header));
    if (isSynthetic(state.header.currentListId)) {
      root.appendChild(caption('Due (≤ 2 days overdue) or starting today'));
    }
  }

  switch (state.kind) {
    case 'placeholder':
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Placeholder panel — connect a provider to see your tasks.', 'muted'));
      return;

    case 'loading':
      if (!state.header) root.appendChild(heading('ToDoTube'));
      root.appendChild(skeletonRows(3));
      return;

    case 'disconnected': {
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Connect your TickTick account to see today’s tasks here.', 'muted'));
      root.appendChild(button('Connect TickTick', () => state.onConnect()));
      return;
    }

    case 'empty':
      root.appendChild(heading('You’re done 🎉'));
      root.appendChild(line('Nothing left on your list.', 'muted'));
      return;

    case 'list': {
      if (state.tasks.length === 0) {
        root.appendChild(line('No matching tasks.', 'muted'));
        return;
      }
      const ul = document.createElement('ul');
      ul.className = 'tt-panel__list';
      for (const task of state.tasks) {
        ul.appendChild(taskRow(task, () => state.onComplete(task)));
      }
      root.appendChild(ul);
      return;
    }

    case 'error': {
      root.appendChild(heading('Something went wrong'));
      const err = document.createElement('div');
      err.className = 'tt-panel__error';
      err.textContent = state.message;
      root.appendChild(err);
      root.appendChild(button('Retry', () => state.onRetry()));
      return;
    }
  }
}

// Backwards-compatible alias — callers that previously used either name
// can keep using either; both render the full panel into `root`.
export const updatePanel = renderPanel;

function renderHeader(header: PanelHeader): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'tt-panel__header';

  // List picker — hidden until we know what lists exist. While projects
  // are still loading we just show the refresh button, which gives the
  // user something to click if the initial fetch is slow.
  if (header.projects.length > 0) {
    const select = document.createElement('select');
    select.className = 'tt-panel__select';
    for (const p of header.projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.synthetic ? `${p.name} (smart)` : p.name;
      if (p.id === header.currentListId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => header.onListChange(select.value));
    bar.appendChild(select);
  } else {
    // Spacer so the refresh button stays on the right while loading.
    const spacer = document.createElement('div');
    spacer.className = 'flex-1';
    bar.appendChild(spacer);
  }

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'tt-panel__refresh';
  refresh.setAttribute('aria-label', 'Refresh tasks');
  refresh.title = 'Refresh';
  // U+21BB CLOCKWISE OPEN CIRCLE ARROW — universally rendered, no need
  // to bundle an SVG sprite for one glyph.
  refresh.textContent = '↻';
  refresh.addEventListener('click', () => header.onRefresh());
  bar.appendChild(refresh);

  return bar;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'tt-panel__heading';
  h.textContent = text;
  return h;
}

function caption(text: string): HTMLElement {
  const c = document.createElement('div');
  c.className = 'tt-panel__caption';
  c.textContent = text;
  return c;
}

function line(text: string, tone: 'default' | 'muted' = 'default'): HTMLElement {
  const p = document.createElement('div');
  p.className = tone === 'muted' ? 'tt-panel__line-muted' : 'tt-panel__line';
  p.textContent = text;
  return p;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tt-panel__btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function taskRow(task: Task, onComplete: () => void): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tt-panel__task';
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `Complete: ${task.title}`);
  li.addEventListener('click', () => onComplete());
  li.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onComplete();
    }
  });

  const checkbox = document.createElement('span');
  checkbox.className = 'tt-panel__checkbox';
  checkbox.setAttribute('aria-hidden', 'true');
  li.appendChild(checkbox);

  const label = document.createElement('span');
  label.className = 'tt-panel__task-title';
  label.textContent = task.title;
  li.appendChild(label);

  if (task.dueDate) {
    const due = document.createElement('span');
    due.className = 'tt-panel__due';
    due.textContent = formatDueTime(task.dueDate);
    li.appendChild(due);
  }

  return li;
}

function skeletonRows(count: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-label', 'Loading tasks');
  wrap.setAttribute('role', 'status');
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'tt-panel__skeleton';
    const dot = document.createElement('span');
    dot.className = 'tt-panel__skeleton-dot';
    const bar = document.createElement('span');
    bar.className = 'tt-panel__skeleton-bar';
    row.appendChild(dot);
    row.appendChild(bar);
    wrap.appendChild(row);
  }
  return wrap;
}

function formatDueTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // If due is today (same local Y-M-D), show HH:mm. Otherwise show
  // a short date.
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
