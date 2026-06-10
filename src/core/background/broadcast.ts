// Background → content-script broadcast. Only blocked-site tabs receive these;
// the alternative (`browser.runtime.sendMessage`) would also wake popup
// and options, which would log spurious "no listener" errors.

import { browser } from 'wxt/browser';

import { BLOCKED_SITE_MATCHES } from '@/shared/blocklist';
import { log } from '@/shared/logger';
import type { Broadcast } from '@/shared/messaging';

export async function broadcastToBlockedTabs(msg: Broadcast): Promise<void> {
  try {
    // `tabs.query` accepts an array of URL patterns — the union of every
    // blockable site. A YouTube-only message (e.g. TASKS_UPDATED) reaching a
    // social tab is harmlessly ignored by its controller.
    const tabs = await browser.tabs.query({ url: BLOCKED_SITE_MATCHES });
    await Promise.all(
      tabs.map((tab) =>
        tab.id == null
          ? undefined
          : browser.tabs.sendMessage(tab.id, msg).catch(() => {
              // Content script may not be ready yet (e.g. fresh tab). Drop
              // silently — the script will pull current state via GET_STATE
              // when it loads.
            }),
      ),
    );
  } catch (err) {
    log.warn('broadcast: tabs.query failed:', err);
  }
}
