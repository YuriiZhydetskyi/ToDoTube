// Popup orchestrator. The popup is intentionally minimal — it shows
// status and toggles master on/off. Real configuration lives in the
// options page; this is an awareness affordance.
//
// Popup never reads provider state from storage directly. It asks
// background via GET_STATE so there's one source of truth (background)
// and the popup stays consistent if active provider/list changes via
// some other route.

import { browser } from 'wxt/browser';

import { sendToBackground } from '@/shared/messaging';
import { getProviderState, getSettings } from '@/shared/storage';
import { el } from '@/ui/options/dom';

export async function startPopup(root: HTMLElement): Promise<void> {
  root.replaceChildren();

  const wrap = el('div', { class: 'popup' });
  const title = el('div', { class: 'popup-title', text: 'ToDoTube' });

  const enabledRow = el('div', { class: 'popup-row' });
  const toggle = el('input', { type: 'checkbox' }) as HTMLInputElement;
  const toggleLabel = el(
    'label',
    { class: 'popup-toggle' },
    toggle,
    el('span', { text: 'Enabled' }),
  );
  enabledRow.append(toggleLabel);

  const statusLine = el('div', { class: 'popup-status' });

  const settingsBtn = el('button', { class: 'btn btn-secondary', text: 'Open settings' });
  settingsBtn.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  wrap.append(title, enabledRow, statusLine, settingsBtn);
  root.append(wrap);

  async function refresh(): Promise<void> {
    const r = await sendToBackground({ type: 'GET_STATE' });
    if (!r.ok) {
      statusLine.textContent = `Could not load state: ${r.error}`;
      return;
    }
    const { settings, authenticated } = r.value;
    toggle.checked = settings.enabled;
    if (!settings.activeProviderId || !authenticated) {
      statusLine.textContent = 'Not connected. Open settings to connect.';
      return;
    }
    const providerState = await getProviderState(settings.activeProviderId);
    const list = providerState.activeListId ?? 'smart:today';
    const listLabel = list === 'smart:today' ? 'Today' : list;
    statusLine.textContent = `TickTick · ${listLabel}`;
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
