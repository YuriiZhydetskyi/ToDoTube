// Vanilla-DOM panel. Provider-agnostic — receives a typed `state` and
// renders accordingly. No layer below ui/ knows this exists.
//
// For Step 4 the only meaningful state is `placeholder`; the full state
// machine lands when the provider is wired up in Step 8.

import type { Task } from '@/shared/types';

export type PanelState =
  | { kind: 'placeholder' }
  | { kind: 'loading' }
  | { kind: 'disconnected'; onConnect: () => void }
  | { kind: 'empty' }
  | { kind: 'list'; tasks: Task[]; onComplete: (task: Task) => void }
  | { kind: 'error'; message: string; onRetry: () => void };

// Inline `all: initial` resets every inherited CSS property so YouTube's
// styles can't leak in. Tiny perf cost; massive predictability win.
const RESET = 'all: initial; display: block; box-sizing: border-box;';

export function createPanel(state: PanelState): HTMLElement {
  const root = document.createElement('div');
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
  root.setAttribute('data-todotube-panel-root', '');
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
      root.appendChild(line('Placeholder panel. Provider not wired yet.'));
      root.appendChild(line('You should see this in place of the right-rail recommendations.'));
      break;

    case 'loading':
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Loading your tasks…'));
      break;

    case 'disconnected': {
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line('Connect your TickTick account to see today’s tasks here.'));
      const btn = document.createElement('button');
      btn.textContent = 'Connect TickTick';
      btn.style.cssText = buttonStyle();
      btn.addEventListener('click', () => state.onConnect());
      root.appendChild(btn);
      break;
    }

    case 'empty':
      root.appendChild(heading('You’re done for today 🎉'));
      root.appendChild(line('Nothing left on your list.'));
      break;

    case 'list': {
      root.appendChild(heading('Today'));
      const ul = document.createElement('ul');
      ul.style.cssText = `${RESET} margin: 0; padding: 0; list-style: none;`;
      for (const task of state.tasks) {
        ul.appendChild(taskRow(task, () => state.onComplete(task)));
      }
      root.appendChild(ul);
      break;
    }

    case 'error': {
      root.appendChild(heading('ToDoTube'));
      root.appendChild(line(state.message));
      const btn = document.createElement('button');
      btn.textContent = 'Retry';
      btn.style.cssText = buttonStyle();
      btn.addEventListener('click', () => state.onRetry());
      root.appendChild(btn);
      break;
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
  p.style.cssText = `${RESET} margin: 0 0 8px 0;`;
  return p;
}

function buttonStyle(): string {
  return `
    ${RESET}
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 8px;
    background: #065fd4;
    color: #fff;
    font-weight: 500;
    font-family: inherit;
  `;
}

function taskRow(task: Task, onComplete: () => void): HTMLElement {
  const li = document.createElement('li');
  li.style.cssText = `
    ${RESET}
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.05));
  `;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.style.cssText = `${RESET} cursor: pointer;`;
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) onComplete();
  });
  li.appendChild(checkbox);

  const label = document.createElement('span');
  label.textContent = task.title;
  label.style.cssText = `${RESET} flex: 1;`;
  li.appendChild(label);

  return li;
}
