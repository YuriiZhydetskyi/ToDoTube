// Orchestrator for the settings page. The entrypoint (`entrypoints/
// options/main.ts`) calls `startOptions(document.body)` and we own the
// rest — initial fetch, layout, and section wiring.

// Side-effect import so the bundler emits the Settings stylesheet into
// the options page chunk. Lives here (in core) so the entry stays
// agnostic and the boundaries/dependencies rule (entry → ui is denied)
// is respected.
import '@/ui/styles/options.css';

import { browser } from 'wxt/browser';

import { AVAILABLE_GATES } from '@/gates/registry';
import { ANKI_HOST_PERMISSION } from '@/signals/anki/constants';
import { getSettings, onSettingsChange } from '@/shared/storage';
import { ACTIVITY_BRIDGE_SETUP_URL, ANKI_SETUP_URL } from '@/shared/types';
import { el } from '@/ui/options/dom';
import {
  renderAboutSection,
  renderAccountSection,
  renderAdvancedSection,
  renderBehaviorSection,
  renderDisplaySection,
  renderFocusSection,
  type FocusSectionDeps,
} from '@/ui/options/sections';

// Gate-setup capabilities handed to the (ui-layer) Focus section, so it needs
// neither wxt/browser nor the signals/gates layers. The permission calls run
// inside the section's click handler to preserve the user gesture. Host
// origins are passed as opaque strings (Anki's is fixed; the bridge's is
// derived from its user-configured URL by the section itself).
const focusDeps: FocusSectionDeps = {
  ankiSetupUrl: ANKI_SETUP_URL,
  bridgeSetupUrl: ACTIVITY_BRIDGE_SETUP_URL,
  ankiOrigin: ANKI_HOST_PERMISSION,
  hasHostPermission: (origin) => browser.permissions.contains({ origins: [origin] }),
  requestHostPermission: (origin) => browser.permissions.request({ origins: [origin] }),
};

export async function startOptions(root: HTMLElement): Promise<void> {
  let settings = await getSettings();

  root.replaceChildren();

  const main = el('main', { class: 'tt-page' });
  const accountSection = el('section', { class: 'tt-card' });
  const displaySection = el('section', { class: 'tt-card' });
  const behaviorSection = el('section', { class: 'tt-card' });
  const focusSection = el('section', { class: 'tt-card' });
  const advancedSection = el('section', { class: 'tt-card' });
  const aboutSection = el('section', { class: 'tt-card' });

  main.append(
    el(
      'header',
      {},
      el('h1', { class: 'tt-page__title', text: 'ToDoTube' }),
      el('p', {
        class: 'tt-page__lede',
        text: 'Replace YouTube recommendations with your to-do list.',
      }),
    ),
    accountSection,
    displaySection,
    behaviorSection,
    focusSection,
    advancedSection,
    aboutSection,
  );
  root.append(main);

  await renderAccountSection(accountSection, settings);
  renderDisplaySection(displaySection, settings);
  renderBehaviorSection(behaviorSection, settings);
  renderFocusSection(focusSection, settings, AVAILABLE_GATES, focusDeps);
  renderAdvancedSection(advancedSection, settings);
  renderAboutSection(aboutSection);

  // External settings changes (e.g. popup toggle, another open tab)
  // refresh only the Account section so we don't blow away focus in
  // mid-edit text inputs in Display/Behavior/Advanced.
  onSettingsChange((next) => {
    settings = next;
    void renderAccountSection(accountSection, settings);
  });
}
