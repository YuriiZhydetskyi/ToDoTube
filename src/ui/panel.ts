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

import { iconCheck, iconExternal, iconRefresh } from '@/ui/icons';
import { isSynthetic, type ListId, type Project, type Task } from '@/shared/types';

export const panelCss: string = panelCssText;

// Optional header rendered above the task body — list picker on the
// left, refresh button on the right. The lifecycle passes this only
// when authenticated; states with no header (placeholder, disconnected)
// render without one.
export interface PanelHeader {
  projects: Project[];
  currentListId: ListId;
  providerName: string;
  /** External URL opened by the header's "Open <provider>" button. */
  webAppUrl: string;
  smartListCaption?: string;
  onListChange: (listId: ListId) => void;
  onRefresh: () => void;
}

export type PanelState =
  | { kind: 'placeholder' }
  | { kind: 'loading'; header?: PanelHeader }
  | { kind: 'disconnected'; providerName: string; onConnect: () => void }
  | { kind: 'empty'; header?: PanelHeader }
  | {
      kind: 'list';
      tasks: Task[];
      onComplete: (task: Task) => void;
      // Present only when clickBehavior = "open": makes each task title a
      // button that opens the task in the provider's web app. Absent =>
      // the title is plain text and only the checkbox is interactive.
      onOpenTask?: (task: Task) => void;
      header?: PanelHeader;
    }
  | { kind: 'error'; message: string; onRetry: () => void; header?: PanelHeader };

// Milliseconds the row stays visible after a checkbox click before the
// onComplete callback fires — long enough for the fade-out animation
// to play, short enough not to feel laggy.
const COMPLETION_ANIMATION_MS = 220;

export function renderPanel(root: HTMLElement, state: PanelState): void {
  root.className = 'tt-panel';
  root.replaceChildren();

  if ('header' in state && state.header) {
    const caption = isSynthetic(state.header.currentListId)
      ? state.header.smartListCaption
      : undefined;
    root.appendChild(renderHeader(state.header, caption));
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
      root.appendChild(
        line(`Connect your ${state.providerName} account to see your tasks here.`, 'muted'),
      );
      root.appendChild(button(`Connect ${state.providerName}`, () => state.onConnect()));
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
      const onOpenTask = state.onOpenTask;
      state.tasks.forEach((task, idx) => {
        ul.appendChild(
          taskRow(
            task,
            idx,
            () => state.onComplete(task),
            onOpenTask ? () => onOpenTask(task) : undefined,
          ),
        );
      });
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

function renderHeader(header: PanelHeader, caption: string | undefined): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'tt-panel__header';

  // List picker — hidden until we know what lists exist. While projects
  // are still loading we just show the refresh button, which gives the
  // user something to click if the initial fetch is slow.
  if (header.projects.length > 0) {
    const select = document.createElement('select');
    select.className = 'tt-panel__select';
    select.setAttribute('aria-label', 'Task list');
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
    const spacer = document.createElement('div');
    spacer.className = 'flex-1';
    bar.appendChild(spacer);
  }

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'tt-panel__open';
  open.setAttribute('aria-label', `Open ${header.providerName}`);
  open.title = `Open ${header.providerName}`;
  open.appendChild(iconExternal());
  open.addEventListener('click', () => {
    window.open(header.webAppUrl, '_blank', 'noopener,noreferrer');
  });
  bar.appendChild(open);

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'tt-panel__refresh';
  refresh.setAttribute('aria-label', 'Refresh tasks');
  refresh.title = 'Refresh';
  refresh.appendChild(iconRefresh());
  refresh.addEventListener('click', () => header.onRefresh());
  bar.appendChild(refresh);

  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'tt-panel__caption';
    cap.textContent = caption;
    bar.appendChild(cap);
  }

  return bar;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'tt-panel__heading';
  h.textContent = text;
  return h;
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

function taskRow(
  task: Task,
  index: number,
  onComplete: () => void,
  onOpen?: () => void,
): HTMLElement {
  const li = document.createElement('li');
  li.className = 'tt-panel__task';
  li.style.setProperty('--i', String(index));

  const priorityTone = priorityToTone(task.priority);
  if (priorityTone) li.setAttribute('data-priority', priorityTone);

  const checkbox = document.createElement('button');
  checkbox.type = 'button';
  checkbox.className = 'tt-panel__checkbox';
  checkbox.setAttribute('aria-label', `Complete: ${task.title}`);
  checkbox.title = 'Mark complete';
  checkbox.addEventListener('click', () => completeWithAnimation(li, checkbox, onComplete));
  li.appendChild(checkbox);

  // Title is a button (opens the task) when onOpen is supplied, else a
  // plain span. Same class drives layout/typography in both cases.
  const label = document.createElement(onOpen ? 'button' : 'span');
  label.className = 'tt-panel__task-title';
  label.textContent = task.title;
  if (onOpen) {
    (label as HTMLButtonElement).type = 'button';
    label.setAttribute('aria-label', `Open: ${task.title}`);
    label.title = 'Open task';
    label.addEventListener('click', onOpen);
  }
  li.appendChild(label);

  const due = task.dueDate ? formatDue(task.dueDate) : null;
  if (due) {
    const badge = document.createElement('span');
    badge.className = 'tt-panel__due';
    badge.setAttribute('data-tone', due.tone);
    badge.textContent = due.text;
    li.appendChild(badge);
  }

  return li;
}

function completeWithAnimation(
  row: HTMLElement,
  checkbox: HTMLElement,
  onComplete: () => void,
): void {
  // Fill the checkbox with the brand color + check mark, then fade the
  // row out and hand off to the lifecycle. Reduced-motion users get the
  // callback immediately without the transition.
  checkbox.classList.add('tt-panel__checkbox--done');
  checkbox.appendChild(iconCheck({ size: 14 }));

  if (prefersReducedMotion()) {
    onComplete();
    return;
  }

  row.classList.add('tt-panel__task--done');
  window.setTimeout(onComplete, COMPLETION_ANIMATION_MS);
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

type DueTone = 'today' | 'today-noTime' | 'overdue' | 'upcoming';

function formatDue(iso: string): { text: string; tone: DueTone } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  // Some providers emit 00:00:00 for "all-day" tasks. Show a locale-aware
  // "today"/"сьогодні" marker instead of a literal "00:00" pill.
  const hasNoTime = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;

  if (sameDay && hasNoTime) {
    return { text: todayLabel(), tone: 'today-noTime' };
  }
  if (sameDay) {
    const tone: DueTone = d.getTime() < now.getTime() ? 'overdue' : 'today';
    return {
      text: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      tone,
    };
  }

  const text = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const tone: DueTone = d.getTime() < now.getTime() ? 'overdue' : 'upcoming';
  return { text, tone };
}

// Label shown on the "no specific time today" pill. Kept in English
// for consistency with the rest of the UI strings (`Retry`,
// `You're done`, ...) - the panel is not yet localized.
function todayLabel(): string {
  return 'Today';
}

// Providers normalize priority into this visual scale before handing
// tasks to the UI: 5 = high, 1..4 = medium/low, 0 = none.
function priorityToTone(priority: number | undefined): 'high' | 'med' | undefined {
  if (priority === undefined) return undefined;
  if (priority >= 5) return 'high';
  if (priority >= 1) return 'med';
  return undefined;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
