// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { renderPanel, renderPeekChip, type PanelHeader } from './panel';

function makeHeader(overrides: Partial<PanelHeader> = {}): PanelHeader {
  return {
    projects: [],
    currentListId: 'inbox',
    providerName: 'TestProvider',
    webAppUrl: 'https://example.com',
    onListChange: () => {},
    onRefresh: () => {},
    ...overrides,
  };
}

function root(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('peek header button', () => {
  it('renders only when onPeek is supplied and fires the callback on click', () => {
    const onPeek = vi.fn();
    const el = root();
    renderPanel(el, { kind: 'empty', header: makeHeader({ onPeek }) });

    const btn = el.querySelector<HTMLButtonElement>('.tt-panel__peek');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(onPeek).toHaveBeenCalledTimes(1);
  });

  it('is absent when the header has no onPeek (endscreen surface)', () => {
    const el = root();
    renderPanel(el, { kind: 'empty', header: makeHeader() });
    expect(el.querySelector('.tt-panel__peek')).toBeNull();
  });
});

describe('close header button', () => {
  it('renders only when onClose is supplied and fires the callback on click', () => {
    const onClose = vi.fn();
    const el = root();
    renderPanel(el, { kind: 'empty', header: makeHeader({ onClose }) });

    const btn = el.querySelector<HTMLButtonElement>('.tt-panel__close');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is absent when the header has no onClose (rail surface)', () => {
    const el = root();
    renderPanel(el, { kind: 'empty', header: makeHeader() });
    expect(el.querySelector('.tt-panel__close')).toBeNull();
  });

  it('close and peek are independent per surface', () => {
    const railEl = root();
    renderPanel(railEl, { kind: 'empty', header: makeHeader({ onPeek: () => {} }) });
    expect(railEl.querySelector('.tt-panel__peek')).not.toBeNull();
    expect(railEl.querySelector('.tt-panel__close')).toBeNull();

    const endEl = root();
    renderPanel(endEl, { kind: 'empty', header: makeHeader({ onClose: () => {} }) });
    expect(endEl.querySelector('.tt-panel__close')).not.toBeNull();
    expect(endEl.querySelector('.tt-panel__peek')).toBeNull();
  });
});

describe('renderPeekChip', () => {
  it('renders the chip and fires onBack on click', () => {
    const onBack = vi.fn();
    const el = root();
    renderPeekChip(el, { onBack });

    expect(el.className).toBe('tt-peek');
    expect(el.querySelector('.tt-peek__label')?.textContent).toBe('Tasks hidden');

    const back = el.querySelector<HTMLButtonElement>('.tt-peek__btn');
    expect(back?.textContent).toBe('Back to tasks');
    back?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a subsequent renderPanel fully replaces the chip', () => {
    const el = root();
    renderPeekChip(el, { onBack: () => {} });
    renderPanel(el, { kind: 'empty', header: makeHeader() });

    expect(el.className).toBe('tt-panel');
    expect(el.querySelector('.tt-peek__btn')).toBeNull();
  });
});
