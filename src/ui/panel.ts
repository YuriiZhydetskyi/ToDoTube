// Vanilla-DOM panel. Provider-agnostic. The lifecycle layer owns the
// canonical task list; this file is a render-only function over a typed
// state value, plus `updatePanel(root, state)` for in-place re-renders.

import type { ListId, Project, Task } from '@/shared/types';

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

// Inline `all: initial` reset on the root keeps YouTube's stylesheets
// from leaking into our panel.
const RESET = 'all: initial; display: block; box-sizing: border-box;';

export function createPanel(state: PanelState): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-todotube-panel-root', '');
  root.style.cssText = `
    ${RESET}
    padding: 16px;
    margin: 0 0 16px 0;
    background: var(--yt-spec-base-background, #ffffff);
    color: var(--yt-spec-text-primary, #0f0f0f);
    font-family: 'Roboto', 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    border-radius: 12px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
  `;
  render(root, state);
  return root;
}

export function updatePanel(root: HTMLElement, state: PanelState): void {
  render(root, state);
}

function render(root: HTMLElement, state: PanelState): void {
  root.replaceChildren();

  if ('header' in state && state.header) {
    root.appendChild(renderHeader(state.header));
  }

  switch (state.kind) {
    case 'placeholder':
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Placeholder panel — connect a provider to see your tasks.'));
      return;

    case 'loading':
      if (!state.header) root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Loading your tasks…'));
      return;

    case 'disconnected': {
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Connect your TickTick account to see today’s tasks here.'));
      const btn = button('Connect TickTick', () => state.onConnect());
      root.appendChild(btn);
      return;
    }

    case 'empty':
      root.appendChild(heading('You’re done 🎉'));
      root.appendChild(line('Nothing left on your list.'));
      return;

    case 'list': {
      if (state.tasks.length === 0) {
        root.appendChild(line('No matching tasks.'));
        return;
      }
      const ul = document.createElement('ul');
      ul.style.cssText = `${RESET} margin: 0; padding: 0; list-style: none;`;
      for (const task of state.tasks) {
        ul.appendChild(taskRow(task, () => state.onComplete(task)));
      }
      root.appendChild(ul);
      return;
    }

    case 'error': {
      root.appendChild(heading('Something went wrong'));
      root.appendChild(line(state.message));
      root.appendChild(button('Retry', () => state.onRetry()));
      return;
    }
  }
}

function renderHeader(header: PanelHeader): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText = `
    ${RESET}
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px 0;
  `;

  // List picker — hidden until we know what lists exist. While projects
  // are still loading we just show the refresh button, which gives the
  // user something to click if the initial fetch is slow.
  if (header.projects.length > 0) {
    const select = document.createElement('select');
    select.style.cssText = `
      ${RESET}
      flex: 1;
      min-width: 0;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
      background: var(--yt-spec-base-background, #ffffff);
      color: var(--yt-spec-text-primary, #0f0f0f);
      font-family: inherit;
      font-size: inherit;
      cursor: pointer;
    `;
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
    spacer.style.cssText = `${RESET} flex: 1;`;
    bar.appendChild(spacer);
  }

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.setAttribute('aria-label', 'Refresh tasks');
  refresh.title = 'Refresh';
  // U+21BB CLOCKWISE OPEN CIRCLE ARROW — universally rendered, no need
  // to bundle an SVG sprite for one glyph.
  refresh.textContent = '↻';
  refresh.style.cssText = `
    ${RESET}
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
    background: var(--yt-spec-base-background, #ffffff);
    color: var(--yt-spec-text-primary, #0f0f0f);
    font-size: 18px;
    line-height: 1;
    flex-shrink: 0;
  `;
  refresh.addEventListener('click', () => header.onRefresh());
  bar.appendChild(refresh);

  return bar;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.textContent = text;
  h.style.cssText = `${RESET} font-weight: 600; font-size: 16px; margin: 0 0 8px 0;`;
  return h;
}

function line(text: string): HTMLElement {
  const p = document.createElement('div');
  p.textContent = text;
  p.style.cssText = `${RESET} display: block; margin: 0 0 8px 0;`;
  return p;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = `
    ${RESET}
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 8px;
    background: #065fd4;
    color: #fff;
    font-weight: 500;
    font-family: inherit;
    font-size: inherit;
    border: 0;
  `;
  btn.addEventListener('click', onClick);
  return btn;
}

function taskRow(task: Task, onComplete: () => void): HTMLElement {
  const li = document.createElement('li');
  li.style.cssText = `
    ${RESET}
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.05));
    cursor: pointer;
  `;
  li.addEventListener('click', () => onComplete());

  const checkbox = document.createElement('span');
  checkbox.style.cssText = `
    ${RESET}
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--yt-spec-text-secondary, #606060);
    border-radius: 50%;
    flex-shrink: 0;
  `;
  li.appendChild(checkbox);

  const label = document.createElement('span');
  label.textContent = task.title;
  label.style.cssText = `${RESET} flex: 1; color: var(--yt-spec-text-primary, #0f0f0f);`;
  li.appendChild(label);

  if (task.dueDate) {
    const due = document.createElement('span');
    due.textContent = formatDueTime(task.dueDate);
    due.style.cssText = `${RESET} font-size: 12px; color: var(--yt-spec-text-secondary, #606060);`;
    li.appendChild(due);
  }

  return li;
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
