// Popup orchestrator. The popup is intentionally minimal — it shows
// status and toggles master on/off. Real configuration lives in the
// options page; this is an awareness affordance.
//
// Popup never reads provider state from storage directly. It asks
// background via GET_STATE so there's one source of truth (background)
// and the popup stays consistent if active provider/list changes via
// some other route.

// Side-effect import so the bundler emits the popup stylesheet into the
// popup chunk. Lives here (in core) so the entry stays agnostic and
// the boundaries/dependencies rule (entry → ui is denied) is respected.
import '@/ui/styles/popup.css';

import { browser } from 'wxt/browser';

import { sendToBackground } from '@/shared/messaging';
import { getProviderState, getSettings } from '@/shared/storage';
import { el } from '@/ui/options/dom';

export async function startPopup(root: HTMLElement): Promise<void> {
  root.replaceChildren();

  const wrap = el('div', { class: 'tt-popup' });

  // Title with a small brand dot.
  const title = el(
    'div',
    { class: 'tt-popup__title' },
    el('span', { class: 'tt-popup__dot' }),
    el('span', { text: 'ToDoTube' }),
  );

  // Toggle row with iOS-style switch. The whole row is a <label> so
  // clicking anywhere on it toggles the checkbox; the inner styled span
  // composes the track and knob via peer-* utilities on the input.
  const toggle = el('input', {
    type: 'checkbox',
    class: 'tt-toggle__input peer',
  }) as HTMLInputElement;
  const switchControl = el(
    'span',
    { class: 'tt-toggle' },
    toggle,
    el('span', { class: 'tt-toggle__track' }),
    el('span', { class: 'tt-toggle__knob' }),
  );
  const toggleRow = el(
    'label',
    { class: 'tt-popup__row cursor-pointer select-none' },
    el('span', { class: 'tt-popup__row-label', text: 'Enabled' }),
    switchControl,
  );

  // Status: two-line layout (primary + secondary) when connected.
  const statusPrimary = el('div', { class: 'tt-popup__status-primary' });
  const statusSecondary = el('div', { class: 'tt-popup__status-secondary' });
  const statusBlock = el('div', { class: 'tt-popup__status' }, statusPrimary, statusSecondary);

  const settingsBtn = el('button', {
    class: 'tt-popup__btn',
    text: 'Open settings',
  });
  settingsBtn.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  wrap.append(title, toggleRow, statusBlock, settingsBtn);
  root.append(wrap);

  async function refresh(): Promise<void> {
    const r = await sendToBackground({ type: 'GET_STATE' });
    if (!r.ok) {
      statusPrimary.textContent = 'Could not load state';
      statusSecondary.textContent = r.error;
      return;
    }
    const { settings, authenticated } = r.value;
    toggle.checked = settings.enabled;
    if (!settings.activeProviderId || !authenticated) {
      statusPrimary.textContent = 'Not connected';
      statusSecondary.textContent = 'Open settings to connect.';
      return;
    }
    const providerState = await getProviderState(settings.activeProviderId);
    const list = providerState.activeListId ?? 'smart:today';
    const listLabel = list === 'smart:today' ? 'Today' : list;
    statusPrimary.textContent = 'TickTick';
    statusSecondary.textContent = `List: ${listLabel}`;
  }

  toggle.addEventListener('change', () => {
    void sendToBackground({ type: 'SET_ENABLED', enabled: toggle.checked });
  });

  // Initial render + react to changes while the popup is open.
  void refresh();
  const settings = await getSettings();
  // We can't subscribe via shared/storage's onSettingsChange across the
  // popup boundary the same way as content scripts, but storage events
  // fire here too — listen directly.
  browser.storage.onChanged.addListener(() => {
    void refresh();
  });
  // Suppress unused-var warning while keeping the snapshot import.
  void settings;
}
