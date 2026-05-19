// Orchestrator for the settings page. The entrypoint (`entrypoints/
// options/main.ts`) calls `startOptions(document.body)` and we own the
// rest — initial fetch, layout, and section wiring.

// Side-effect import so the bundler emits the Settings stylesheet into
// the options page chunk. Lives here (in core) so the entry stays
// agnostic and the boundaries/dependencies rule (entry → ui is denied)
// is respected.
import '@/ui/styles/options.css';

import { getSettings, onSettingsChange } from '@/shared/storage';
import { el } from '@/ui/options/dom';
import {
  renderAboutSection,
  renderAccountSection,
  renderAdvancedSection,
  renderBehaviorSection,
  renderDisplaySection,
} from '@/ui/options/sections';

export async function startOptions(root: HTMLElement): Promise<void> {
  let settings = await getSettings();

  root.replaceChildren();

  const main = el('main', { class: 'tt-page' });
  const accountSection = el('section', { class: 'tt-card' });
  const displaySection = el('section', { class: 'tt-card' });
  const behaviorSection = el('section', { class: 'tt-card' });
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
    advancedSection,
    aboutSection,
  );
  root.append(main);

  await renderAccountSection(accountSection, settings);
  renderDisplaySection(displaySection, settings);
  renderBehaviorSection(behaviorSection, settings);
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
