// @vitest-environment jsdom
//
// Mount/reveal/conceal/unmount contract of the right-rail adapter, run
// against the baseline fixture. No YouTube literals (CI selector guard):
// the slot is located via the fixture's data-tt-anchor marker and the
// host via its own data-todotube-panel attribute.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mountRightRail } from './adapter';

const fixture = readFileSync(
  join(
    process.cwd(),
    'src',
    'surfaces',
    'desktop-watch',
    '__fixtures__',
    'watch-desktop-baseline.html',
  ),
  'utf-8',
);

// jsdom does no layout — stub a generous column rect so the rail's
// geometry self-test passes (same approach as dom-fixtures.test.ts).
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const COLUMN_RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 402,
  bottom: 1200,
  width: 402,
  height: 1200,
  toJSON: () => '',
} as DOMRect;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = () => COLUMN_RECT;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

beforeEach(() => {
  document.body.innerHTML = fixture;
});

function slot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-tt-anchor="rightRail"]');
  if (!el) throw new Error('fixture has no rail marker');
  return el;
}

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-todotube-panel="rightRail"]');
}

describe('mountRightRail', () => {
  it('hides the native slot and inserts the panel host directly before it', () => {
    const handle = mountRightRail({ cssText: '' });

    expect(slot().style.display).toBe('none');
    expect(host()).not.toBeNull();
    expect(host()?.nextElementSibling).toBe(slot());
    expect(handle.root.isConnected).toBe(true);
  });

  it('reveal() restores the slot and conceal() re-hides it, host staying mounted', () => {
    const handle = mountRightRail({ cssText: '' });

    handle.reveal();
    expect(slot().style.display).toBe('');
    expect(host()).not.toBeNull();
    expect(handle.root.isConnected).toBe(true);

    handle.conceal();
    expect(slot().style.display).toBe('none');
  });

  it('unmount() while revealed removes the host and leaves the slot visible', () => {
    const handle = mountRightRail({ cssText: '' });
    handle.reveal();
    handle.unmount();

    expect(host()).toBeNull();
    expect(slot().style.display).toBe('');
  });

  it('unmount() restores the slot after a normal (concealed) lifetime', () => {
    const handle = mountRightRail({ cssText: '' });
    handle.unmount();

    expect(host()).toBeNull();
    expect(slot().style.display).toBe('');
  });

  it('wraps the render target in the .tt-shell visual wrapper', () => {
    // All host-level visuals hang off .tt-shell (the host's inline
    // `all:initial` kills normal :host declarations) — losing the shell
    // silently breaks the endscreen scrim and the panel font.
    const handle = mountRightRail({ cssText: '' });

    const shell = host()?.shadowRoot?.querySelector('.tt-shell');
    expect(shell).not.toBeNull();
    expect(handle.root.parentElement).toBe(shell);
  });
});
