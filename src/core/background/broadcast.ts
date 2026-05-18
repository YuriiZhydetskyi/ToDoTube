// Background → content-script broadcast. Only YouTube tabs receive these;
// the alternative (`browser.runtime.sendMessage`) would also wake popup
// and options, which would log spurious "no listener" errors.

import { browser } from 'wxt/browser';

import { log } from '@/shared/logger';
import type { Broadcast } from '@/shared/messaging';

export async function broadcastToYouTubeTabs(msg: Broadcast): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
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
