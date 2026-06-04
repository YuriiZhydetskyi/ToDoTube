// Account section: connect/disconnect the provider and pick the active list.
// Re-rendered in place after async auth/project operations.

import { sendToBackground } from '@/shared/messaging';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import { getProviderState, setProviderState } from '@/shared/storage';
import type { ProviderId, Settings } from '@/shared/types';

import { el, pill, row } from '../dom';

const PROVIDER_ID: ProviderId = DEFAULT_PROVIDER_ID;

export async function renderAccountSection(
  container: HTMLElement,
  settings: Settings,
): Promise<void> {
  container.replaceChildren();
  container.append(el('h2', { class: 'tt-card__title', text: 'Account' }));

  const provider = getProviderDescriptor(PROVIDER_ID);
  const auth = await sendToBackground({ type: 'AUTH_STATUS', providerId: PROVIDER_ID });
  const authenticated = auth.ok && auth.value.authenticated;

  // ----- Provider row -----
  const tickRow = el('div', { class: 'tt-provider' });
  tickRow.append(
    el('div', { class: 'tt-provider__name' }, provider.displayName),
    authenticated ? pill('Connected', 'ok') : pill('Not connected', 'muted'),
  );

  const button = el('button', {
    text: authenticated ? 'Disconnect' : `Connect ${provider.displayName}`,
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
  const activeListId = providerState.activeListId ?? provider.defaultListId;

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
