// Orchestrator for the settings page. The entrypoint (`entrypoints/
// options/main.ts`) calls `startOptions(document.body)` and we own the
// rest — initial fetch, layout, and section wiring.

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

  const main = el('main', { class: 'options-main' });
  const accountSection = el('section', { class: 'section' });
  const displaySection = el('section', { class: 'section' });
  const behaviorSection = el('section', { class: 'section' });
  const advancedSection = el('section', { class: 'section' });
  const aboutSection = el('section', { class: 'section' });

  main.append(
    el(
      'header',
      { class: 'options-header' },
      el('h1', { text: 'ToDoTube' }),
      el('p', {
        class: 'options-sub',
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
