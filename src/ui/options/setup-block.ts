// One generic "permission + connection test" block, shared by the Anki, the
// activity-bridge, and the sync-backend setups (which were three near-identical
// copies). The block owns the permission/status wiring; each caller supplies a
// spec: where the origin comes from, the status wording, and a `runTest`
// closure that sends its own typed message and formats the result. The block
// stays unaware of the message bus.

import { el, pill } from './dom';

// `${origin}/*` host pattern from a URL; null if the URL is empty/unparseable.
export function originPatternFromUrl(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

export interface SetupBlockSpec {
  // Bold label shown above the buttons (e.g. "Anki connection").
  title: string;
  // Help nodes appended after the title (callers build their own help span so
  // they can embed a "Setup guide" link).
  help: (Node | string)[];
  // Resolves the host pattern to grant/check, read LIVE — at render and again
  // at click time — so editing a URL field without re-rendering (a re-render
  // would steal input focus) still targets the right origin. Returns null when
  // the user hasn't entered a valid URL yet (then the `missingUrl` status is
  // shown and the buttons no-op).
  resolveOrigin: () => string | null;
  labels: {
    granted: string;
    notYet: string;
    denied: string;
    missingUrl?: string;
    allowBtn: string;
    testBtn: string;
  };
  hasHostPermission: (origin: string) => Promise<boolean>;
  requestHostPermission: (origin: string) => Promise<boolean>;
  // Runs the caller's connection test and returns a ready-to-show status line.
  runTest: () => Promise<{ ok: true; status: string } | { ok: false; status: string }>;
}

export function renderSetupBlock(spec: SetupBlockSpec): HTMLElement {
  const { wrap, setStatus, btnRow } = setupBlock();
  const { labels } = spec;

  const initialOrigin = spec.resolveOrigin();
  if (initialOrigin) {
    void spec.hasHostPermission(initialOrigin).then((granted) => {
      setStatus(granted ? labels.granted : labels.notYet, granted ? 'ok' : 'warn');
    });
  } else {
    setStatus(labels.missingUrl ?? 'Enter a valid URL above', 'warn');
  }

  const allowBtn = el('button', { text: labels.allowBtn, class: 'tt-btn tt-btn--secondary' });
  allowBtn.addEventListener('click', () => {
    // Resolve the origin synchronously here so a just-edited URL is honoured —
    // and so no await precedes requestHostPermission, preserving the user gesture.
    const origin = spec.resolveOrigin();
    if (!origin) return;
    void spec.requestHostPermission(origin).then((granted) => {
      setStatus(granted ? labels.granted : labels.denied, granted ? 'ok' : 'warn');
    });
  });

  const testBtn = el('button', { text: labels.testBtn, class: 'tt-btn tt-btn--secondary' });
  testBtn.addEventListener('click', async () => {
    setStatus('Testing…', 'muted');
    const r = await spec.runTest();
    setStatus(r.status, r.ok ? 'ok' : 'warn');
  });

  btnRow.append(allowBtn, testBtn);
  wrap.prepend(el('span', { class: 'tt-row__label' }, spec.title, ...spec.help));
  return wrap;
}

// Scaffold for a setup block: a vertical row with a button row and a status
// pill, plus a setter that swaps the pill.
function setupBlock(): {
  wrap: HTMLElement;
  status: HTMLElement;
  setStatus: (text: string, kind?: 'ok' | 'warn' | 'muted') => void;
  btnRow: HTMLElement;
} {
  const wrap = el('div', { class: 'tt-row tt-row--vertical' });
  const status = el('div', { class: 'tt-advanced__status' });
  const btnRow = el('div', { class: 'tt-btn-row' });
  const setStatus = (text: string, kind: 'ok' | 'warn' | 'muted' = 'muted'): void => {
    status.replaceChildren(pill(text, kind));
  };
  wrap.append(btnRow, status);
  return { wrap, status, setStatus, btnRow };
}
