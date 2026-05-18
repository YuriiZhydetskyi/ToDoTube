// Vanilla-DOM panel. Provider-agnostic. The lifecycle layer owns the
// canonical task list; this file is a render-only function over a typed
// state value, plus `updatePanel(root, state)` for in-place re-renders.

import type { Task } from '@/shared/types';

export type PanelState =
  | { kind: 'placeholder' }
  | { kind: 'loading' }
  | { kind: 'disconnected'; onConnect: () => void }
  | { kind: 'empty' }
  | { kind: 'list'; tasks: Task[]; onComplete: (task: Task) => void }
  | { kind: 'error'; message: string; onRetry: () => void };

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
  switch (state.kind) {
    case 'placeholder':
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Placeholder panel — connect a provider to see your tasks.'));
      return;

    case 'loading':
      root.appendChild(heading('ToDoTube'));
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
      root.appendChild(heading('You’re done for today 🎉'));
      root.appendChild(line('Nothing left on your list.'));
      return;

    case 'list': {
      root.appendChild(heading('Today'));
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
