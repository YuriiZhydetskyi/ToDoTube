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

import { formatBudgetClock } from '@/shared/budget';
import { sendToBackground } from '@/shared/messaging';
import { getProviderDescriptor } from '@/shared/providers';
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

  // Budget: "screen time left today" per the active budget gate — the
  // universal countdown for sites without an in-page timer of their own.
  // Static while the popup is open: opening the popup blurs the page, so
  // accrual pauses and the figure stays accurate without ticking.
  const budgetValue = el('strong', { class: 'tt-popup__budget-value' });
  const budgetBlock = el(
    'div',
    { class: 'tt-popup__budget' },
    budgetValue,
    el('span', { class: 'tt-popup__budget-label', text: 'screen time left today' }),
  );
  budgetBlock.hidden = true;

  const settingsBtn = el('button', {
    class: 'tt-popup__btn',
    text: 'Open settings',
  });
  settingsBtn.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  wrap.append(title, toggleRow, budgetBlock, statusBlock, settingsBtn);
  root.append(wrap);

  async function refresh(): Promise<void> {
    const r = await sendToBackground({ type: 'GET_STATE' });
    if (!r.ok) {
      statusPrimary.textContent = 'Could not load state';
      statusSecondary.textContent = r.error;
      return;
    }
    const { settings, authenticated, budgetMsLeft, activeListId } = r.value;
    toggle.checked = settings.enabled;
    // Budget is independent of the provider connection (e.g. the Anki/activity
    // gates need no provider), so render it before the not-connected return.
    budgetBlock.hidden = budgetMsLeft == null;
    if (budgetMsLeft != null) budgetValue.textContent = formatBudgetClock(budgetMsLeft);
    if (!settings.activeProviderId || !authenticated) {
      statusPrimary.textContent = 'Not connected';
      statusSecondary.textContent = 'Open settings to connect.';
      return;
    }
    // activeListId comes from the GET_STATE snapshot — background stays the one
    // source of truth; the popup never reads provider state from storage itself.
    const provider = getProviderDescriptor(settings.activeProviderId);
    const list = activeListId ?? provider.defaultListId;
    const listLabel = list === provider.defaultListId ? 'Today' : list;
    statusPrimary.textContent = provider.displayName;
    statusSecondary.textContent = `List: ${listLabel}`;
  }

  toggle.addEventListener('change', () => {
    void sendToBackground({ type: 'SET_ENABLED', enabled: toggle.checked });
  });

  // Initial render + react to changes while the popup is open. We can't use
  // shared/storage's onSettingsChange across the popup boundary the same way as
  // content scripts, but storage events fire here too — listen directly.
  void refresh();
  browser.storage.onChanged.addListener(() => {
    void refresh();
  });
}
