// Advanced + About sections: debug toggles, selector-override editor, force
// actions, settings export/import, and the about links.

import { sendToBackground } from '@/shared/messaging';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import { getProviderState, setSettings } from '@/shared/storage';
import type { ProviderId, Settings } from '@/shared/types';

import { checkbox, link } from '../controls';
import { el, row } from '../dom';

const PROVIDER_ID: ProviderId = DEFAULT_PROVIDER_ID;

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
      listId: ps.activeListId ?? getProviderDescriptor(PROVIDER_ID).defaultListId,
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
