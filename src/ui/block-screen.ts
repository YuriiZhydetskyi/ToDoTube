// Vanilla-DOM block screen. Gate-agnostic: it renders a RequirementView
// (title, optional detail, optional progress meter, optional CTA). The CSS
// is imported as a string via Vite's `?inline` and re-exported so the
// surface layer can inject it into the overlay's shadow root — mirroring
// how panel.ts hands `panelCss` to the watch adapter.

import blockScreenCssText from '@/ui/styles/block-screen.css?inline';

import type { RequirementView } from '@/shared/types';

export const blockScreenCss: string = blockScreenCssText;

export function renderBlockScreen(root: HTMLElement, requirement: RequirementView): void {
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

  if (requirement.progress) {
    card.appendChild(renderProgress(requirement.progress));
  }

  if (requirement.action) {
    card.appendChild(renderAction(requirement.action));
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

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
