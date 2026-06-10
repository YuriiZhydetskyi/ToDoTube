// Display + Behavior sections: the recommendation-panel preferences. Inputs are
// uncontrolled and write straight back to storage on `change`.

import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import { setSettings } from '@/shared/storage';
import type { ProviderId, Settings } from '@/shared/types';

import { checkbox, enumSelect, numberInput } from '../controls';
import { el, row } from '../dom';

const PROVIDER_ID: ProviderId = DEFAULT_PROVIDER_ID;

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
  const activeProvider = getProviderDescriptor(settings.activeProviderId ?? PROVIDER_ID);

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
          ['open', `Open in ${activeProvider.displayName}`],
        ],
        (v) => void setSettings({ clickBehavior: v as Settings['clickBehavior'] }),
      ),
    ),
  );
}
