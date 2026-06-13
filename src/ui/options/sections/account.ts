// Account section: connect/disconnect the provider and pick the active list.
// Re-rendered in place after async auth/project operations.
//
// Render discipline: gather all data first, build the section detached, then
// commit with a single `replaceChildren` guarded by a generation token. Two
// renders can run concurrently (the button handler re-renders, and so does
// the `onSettingsChange` watcher when AUTH_START sets `activeProviderId`);
// without the single-commit guard their appends interleave and every row
// shows up twice.

import { sendToBackground } from '@/shared/messaging';
import { DEFAULT_PROVIDER_ID, getProviderDescriptor } from '@/shared/providers';
import type { ProviderId, Settings } from '@/shared/types';

import { el, pill, row } from '../dom';

const PROVIDER_ID: ProviderId = DEFAULT_PROVIDER_ID;

// Bumped on every render; only the newest render commits to the container.
let renderGen = 0;

export async function renderAccountSection(
  container: HTMLElement,
  settings: Settings,
): Promise<void> {
  const gen = ++renderGen;

  const provider = getProviderDescriptor(PROVIDER_ID);

  // ----- Gather all data up front; no DOM writes between awaits -----
  const auth = await sendToBackground({ type: 'AUTH_STATUS', providerId: PROVIDER_ID });
  const authenticated = auth.ok && auth.value.authenticated;

  // Ask background (the single source of truth) for the projects and the
  // active list rather than reading provider state from storage in this
  // ui-layer file. Both are only meaningful when connected.
  const [projectsRes, stateRes] = authenticated
    ? await Promise.all([
        sendToBackground({ type: 'LIST_PROJECTS', providerId: PROVIDER_ID }),
        sendToBackground({ type: 'GET_STATE' }),
      ])
    : [null, null];

  // ----- Build the section detached from the container -----
  const nodes: Node[] = [el('h2', { class: 'tt-card__title', text: 'Account' })];

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
    let errorText: string | null = null;
    if (authenticated) {
      await sendToBackground({ type: 'AUTH_DISCONNECT', providerId: PROVIDER_ID });
    } else {
      // The background opens TickTick's sign-in in a new tab. On Firefox
      // Android that tab opens BEHIND this full-screen settings page, so it
      // looks like nothing happened — surface a hint pointing the user to
      // it. Sign-in then completes in the background; the provider-state
      // watcher (core/options.ts) flips this section to Connected on its
      // own, even if this page was closed in the meantime.
      container.append(
        el('div', {
          class: 'tt-hint',
          text: 'Opened a TickTick sign-in tab — finish signing in there (on a phone, switch to your browser tabs to find it). This page updates automatically when you’re done.',
        }),
      );
      const r = await sendToBackground({ type: 'AUTH_START', providerId: PROVIDER_ID });
      if (!r.ok) errorText = `Could not connect: ${r.error}`;
    }
    // Re-render first, then surface the error — appending before the
    // re-render would let `replaceChildren` wipe it immediately.
    await renderAccountSection(container, settings);
    if (errorText) container.append(el('div', { class: 'tt-error', text: errorText }));
  });
  tickRow.append(button);
  nodes.push(tickRow);

  if (projectsRes && stateRes) {
    if (!projectsRes.ok) {
      nodes.push(el('div', { class: 'tt-error', text: projectsRes.error }));
    } else {
      // ----- Active list dropdown (only meaningful when connected) -----
      const activeListId =
        (stateRes.ok ? stateRes.value.activeListId : null) ?? provider.defaultListId;

      const select = el('select', { class: 'tt-select' });
      for (const p of projectsRes.value) {
        const opt = el('option', { value: p.id, text: p.synthetic ? `${p.name} (smart)` : p.name });
        opt.selected = p.id === activeListId;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        // Route through the message bus so background owns the write (it
        // persists provider state and broadcasts LIST_CHANGED); ui never
        // writes it directly.
        void sendToBackground({
          type: 'SET_ACTIVE_LIST',
          providerId: PROVIDER_ID,
          listId: select.value,
        });
      });
      nodes.push(row('Active list', select, 'What appears in the right rail.'));
    }
  }

  // ----- Commit once: a superseded render must not touch the DOM -----
  if (gen !== renderGen) return;
  container.replaceChildren(...nodes);
}
