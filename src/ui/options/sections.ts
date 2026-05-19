// Each section renders into its own container and persists changes
// directly via shared/storage. The orchestrator (`core/options.ts`)
// builds the page and re-renders the Account section after async
// operations (Connect / Disconnect, project list fetch).
//
// We don't reactively re-render on every settings change — that would
// blow away focus and cursor state on text inputs. Inputs are
// uncontrolled and write back to storage on `change`.

import { sendToBackground } from '@/shared/messaging';
import { getProviderState, setProviderState, setSettings } from '@/shared/storage';
import type { ProviderId, Settings } from '@/shared/types';

import { el, pill, row } from './dom';

const PROVIDER_ID: ProviderId = 'ticktick';

export async function renderAccountSection(
  container: HTMLElement,
  settings: Settings,
): Promise<void> {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Account' }));

  const state = await sendToBackground({ type: 'GET_STATE' });
  const authenticated = state.ok && state.value.authenticated;

  // ----- TickTick row -----
  const tickRow = el('div', { class: 'tt-provider' });
  tickRow.append(
    el('div', { class: 'tt-provider__name' }, 'TickTick'),
    authenticated ? pill('Connected', 'ok') : pill('Not connected', 'muted'),
  );

  const button = el('button', {
    text: authenticated ? 'Disconnect' : 'Connect TickTick',
    class: authenticated ? 'tt-btn tt-btn--secondary' : 'tt-btn tt-btn--primary',
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    if (authenticated) {
      await sendToBackground({ type: 'AUTH_DISCONNECT', providerId: PROVIDER_ID });
    } else {
      const r = await sendToBackground({ type: 'AUTH_START', providerId: PROVIDER_ID });
      if (!r.ok) {
        container.append(el('div', { class: 'tt-error', text: `Could not connect: ${r.error}` }));
      }
    }
    void renderAccountSection(container, settings);
  });
  tickRow.append(button);
  container.append(tickRow);

  if (!authenticated) return;

  // ----- Active list dropdown (only meaningful when connected) -----
  const projectsRes = await sendToBackground({
    type: 'LIST_PROJECTS',
    providerId: PROVIDER_ID,
  });
  if (!projectsRes.ok) {
    container.append(el('div', { class: 'tt-error', text: projectsRes.error }));
    return;
  }
  const projects = projectsRes.value;

  const providerState = await getProviderState(PROVIDER_ID);
  const activeListId = providerState.activeListId ?? 'smart:today';

  const select = el('select', { class: 'tt-select' }) as HTMLSelectElement;
  for (const p of projects) {
    const opt = el('option', { value: p.id, text: p.synthetic ? `${p.name} (smart)` : p.name });
    opt.selected = p.id === activeListId;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    void setProviderState(PROVIDER_ID, { activeListId: select.value });
  });
  container.append(row('Active list', select, 'What appears in the right rail.'));
}

export function renderDisplaySection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Display' }));

  container.append(
    row(
      'Replace right rail',
      checkbox(settings.replaceRightRail, (v) => void setSettings({ replaceRightRail: v })),
    ),
    row(
      'Replace end-of-video grid',
      checkbox(settings.replaceEndscreen, (v) => void setSettings({ replaceEndscreen: v })),
    ),
    row(
      'Show completed tasks',
      checkbox(settings.showCompleted, (v) => void setSettings({ showCompleted: v })),
    ),
    row(
      'Max items shown',
      numberInput(settings.maxItems, 1, 200, (v) => void setSettings({ maxItems: v })),
    ),
    row(
      'Sort',
      enumSelect(
        settings.sortBy,
        [
          ['providerOrder', 'Provider order'],
          ['dueDate', 'Due date'],
          ['priority', 'Priority'],
        ],
        (v) => void setSettings({ sortBy: v as Settings['sortBy'] }),
      ),
    ),
    row(
      'Theme',
      enumSelect(
        settings.theme,
        [
          ['auto', 'Auto (match YouTube)'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        (v) => void setSettings({ theme: v as Settings['theme'] }),
      ),
    ),
  );
}

export function renderBehaviorSection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Behavior' }));

  container.append(
    row(
      'Refresh interval',
      enumSelect(
        String(settings.refreshIntervalMin),
        [
          ['1', 'Every minute'],
          ['5', 'Every 5 minutes'],
          ['15', 'Every 15 minutes'],
        ],
        (v) =>
          void setSettings({ refreshIntervalMin: Number(v) as Settings['refreshIntervalMin'] }),
      ),
    ),
    row(
      'Click behavior',
      enumSelect(
        settings.clickBehavior,
        [
          ['complete', 'Mark complete'],
          ['open', 'Open in TickTick'],
        ],
        (v) => void setSettings({ clickBehavior: v as Settings['clickBehavior'] }),
      ),
    ),
  );
}

export function renderAdvancedSection(container: HTMLElement, settings: Settings): void {
  container.replaceChildren();
  const summary = el('summary', { text: 'Advanced' });
  const details = el('details', { class: 'tt-advanced' });
  details.append(summary);

  details.append(
    row(
      'Verbose logging',
      checkbox(settings.verboseLogging, (v) => void setSettings({ verboseLogging: v })),
      'Logs strategy hits and broadcast traffic to the browser console.',
    ),
    row(
      'Selector debug overlay',
      checkbox(settings.debugOverlay, (v) => void setSettings({ debugOverlay: v })),
      'Outlines matched DOM anchors on YouTube watch pages.',
    ),
  );

  // Selector override editor
  const overrideArea = el('textarea', { class: 'tt-json' }) as HTMLTextAreaElement;
  overrideArea.value = settings.selectorsOverride ?? '';
  overrideArea.placeholder = '{\n  "rightRail": { "strategies": ["#some-selector"] }\n}';
  overrideArea.rows = 6;

  const overrideStatus = el('div', { class: 'tt-advanced__status' });

  const overrideSave = el('button', {
    text: 'Save override',
    class: 'tt-btn tt-btn--secondary',
  });
  overrideSave.addEventListener('click', () => {
    const raw = overrideArea.value.trim();
    if (raw.length === 0) {
      void setSettings({ selectorsOverride: null });
      overrideStatus.textContent = 'Cleared — using bundled selectors.';
      return;
    }
    try {
      JSON.parse(raw);
    } catch (e) {
      overrideStatus.textContent = `Invalid JSON: ${e instanceof Error ? e.message : ''}`;
      return;
    }
    void setSettings({ selectorsOverride: raw });
    overrideStatus.textContent = 'Saved. (Runtime application of overrides is a v2 feature.)';
  });

  details.append(
    el(
      'label',
      { class: 'tt-row tt-row--vertical' },
      el(
        'span',
        { class: 'tt-row__label' },
        'Override selectors',
        el(
          'span',
          { class: 'tt-row__help' },
          'Paste a JSON object in the same shape as the bundled selectors. ',
          'See docs/SELECTORS.md.',
        ),
      ),
      overrideArea,
    ),
    overrideSave,
    overrideStatus,
  );

  // Force actions
  const forceAuthBtn = el('button', {
    text: 'Force re-authentication',
    class: 'tt-btn tt-btn--secondary',
  });
  forceAuthBtn.addEventListener('click', async () => {
    await sendToBackground({ type: 'AUTH_DISCONNECT', providerId: PROVIDER_ID });
    await sendToBackground({ type: 'AUTH_START', providerId: PROVIDER_ID });
  });

  const forceSyncBtn = el('button', {
    text: 'Refresh now',
    class: 'tt-btn tt-btn--secondary',
  });
  forceSyncBtn.addEventListener('click', async () => {
    const ps = await getProviderState(PROVIDER_ID);
    await sendToBackground({
      type: 'REFRESH_NOW',
      providerId: PROVIDER_ID,
      listId: ps.activeListId ?? 'smart:today',
    });
  });

  details.append(el('div', { class: 'tt-btn-row' }, forceAuthBtn, forceSyncBtn));

  // Export / import
  const exportBtn = el('button', {
    text: 'Export settings JSON',
    class: 'tt-btn tt-btn--secondary',
  });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'todotube-settings.json' });
    a.click();
    URL.revokeObjectURL(url);
  });

  const importInput = el('input', { type: 'file', accept: 'application/json' }) as HTMLInputElement;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Settings file must contain a JSON object');
      }
      await setSettings(parsed as Partial<Settings>);
      window.location.reload();
    } catch (e) {
      alert(`Could not import settings: ${e instanceof Error ? e.message : ''}`);
    }
  });

  details.append(el('div', { class: 'tt-btn-row' }, exportBtn, importInput));

  container.append(details);
}

export function renderAboutSection(container: HTMLElement): void {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'About' }));

  const version = el('div', { class: 'mb-3 text-tt-fg-muted', text: 'ToDoTube — alpha' });
  const links = el(
    'div',
    { class: 'tt-about-links' },
    link('Source & issues', 'https://github.com/'),
    link('Spec (REQUIREMENTS.md)', 'https://github.com/'),
    link('Selector docs', 'https://github.com/'),
    link(
      'Report a DOM breakage',
      `https://github.com/new/issues?` +
        new URLSearchParams({
          title: 'YouTube DOM change',
          body: `User agent: ${navigator.userAgent}\nURL pattern: youtube.com/watch\n\n[Paste outerHTML of the affected element here]`,
        }).toString(),
    ),
  );

  container.append(version, links);
}

function checkbox(initial: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = el('input', {
    type: 'checkbox',
    class: 'h-4 w-4 cursor-pointer accent-tt-accent',
  }) as HTMLInputElement;
  cb.checked = initial;
  cb.addEventListener('change', () => onChange(cb.checked));
  return cb;
}

function numberInput(
  initial: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    class: 'tt-input',
    min: String(min),
    max: String(max),
  }) as HTMLInputElement;
  input.value = String(initial);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
  });
  return input;
}

function enumSelect(
  initial: string,
  options: ReadonlyArray<readonly [value: string, label: string]>,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const select = el('select', { class: 'tt-select' }) as HTMLSelectElement;
  for (const [value, label] of options) {
    const opt = el('option', { value, text: label });
    if (value === initial) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function link(label: string, href: string): HTMLAnchorElement {
  return el('a', { href, target: '_blank', rel: 'noopener', text: label, class: 'tt-link' });
}
