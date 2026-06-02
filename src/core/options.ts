// Orchestrator for the settings page. The entrypoint (`entrypoints/
// options/main.ts`) calls `startOptions(document.body)` and we own the
// rest — initial fetch, layout, and section wiring.
//
// The page is split into two tabs: "To-Do" (account + the recommendation-
// panel preferences) and "Blocking" (which sites to block + the unlock
// condition). They're orthogonal features, so separating them keeps each
// tab focused.

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
  renderBlockingSection,
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

  // ----- To-Do tab -----
  const accountSection = el('section', { class: 'tt-card' });
  const displaySection = el('section', { class: 'tt-card' });
  const behaviorSection = el('section', { class: 'tt-card' });
  const advancedSection = el('section', { class: 'tt-card' });
  const aboutSection = el('section', { class: 'tt-card' });
  const todoPanel = el(
    'div',
    { class: 'tt-tabpanel' },
    accountSection,
    displaySection,
    behaviorSection,
    advancedSection,
    aboutSection,
  );

  // ----- Blocking tab -----
  const blockingSection = el('section', { class: 'tt-card' });
  const focusSection = el('section', { class: 'tt-card' });
  const blockingPanel = el('div', { class: 'tt-tabpanel' }, blockingSection, focusSection);

  // Tab bar: two buttons that swap which panel is visible.
  const tabs: { id: 'todo' | 'blocking'; label: string; panel: HTMLElement }[] = [
    { id: 'todo', label: 'To-Do', panel: todoPanel },
    { id: 'blocking', label: 'Blocking', panel: blockingPanel },
  ];
  const tabBar = el('nav', { class: 'tt-tabs' });
  const buttons = new Map<string, HTMLButtonElement>();
  const selectTab = (id: 'todo' | 'blocking'): void => {
    for (const tab of tabs) {
      const active = tab.id === id;
      tab.panel.hidden = !active;
      buttons.get(tab.id)?.classList.toggle('tt-tab--active', active);
    }
  };
  for (const tab of tabs) {
    const btn = el('button', { class: 'tt-tab', text: tab.label, type: 'button' });
    btn.addEventListener('click', () => selectTab(tab.id));
    buttons.set(tab.id, btn);
    tabBar.append(btn);
  }

  main.append(
    el(
      'header',
      {},
      el('h1', { class: 'tt-page__title', text: 'ToDoTube' }),
      el('p', {
        class: 'tt-page__lede',
        text: 'Replace YouTube recommendations with your to-do list, and block time-sinks until you earn them.',
      }),
    ),
    tabBar,
    todoPanel,
    blockingPanel,
  );
  root.append(main);

  await renderAccountSection(accountSection, settings);
  renderDisplaySection(displaySection, settings);
  renderBehaviorSection(behaviorSection, settings);
  renderAdvancedSection(advancedSection, settings);
  renderAboutSection(aboutSection);
  renderBlockingSection(blockingSection, settings);
  renderFocusSection(focusSection, settings, AVAILABLE_GATES, focusDeps);

  selectTab('todo');

  // External settings changes (e.g. popup toggle, another open tab)
  // refresh only the Account section so we don't blow away focus in
  // mid-edit text inputs in Display/Behavior/Advanced.
  onSettingsChange((next) => {
    settings = next;
    void renderAccountSection(accountSection, settings);
  });
}
