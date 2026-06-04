// Global-state + gating handlers: the popup's GET_STATE snapshot, the master
// enable toggle, on-demand gate evaluation, and screen-time accrual ticks.

import { evaluateGate } from '@/core/gatekeeper/gatekeeper';
import { recordUsage } from '@/core/gatekeeper/usage';
import { getProviderOrNull } from '@/providers/registry';
import { remainingBudgetMs } from '@/shared/budget';
import { ok } from '@/shared/messaging';
import { getProviderState, getSettings, setSettings } from '@/shared/storage';

import { enrichWithTasks, type HandlerMap } from './shared';

export const gateHandlers = {
  GET_STATE: async () => {
    const settings = await getSettings();
    const provider = getProviderOrNull(settings.activeProviderId);
    const authenticated = provider ? await provider.isAuthenticated() : false;
    const activeListId = settings.activeProviderId
      ? ((await getProviderState(settings.activeProviderId)).activeListId ?? null)
      : null;
    // The popup's universal countdown: screen-time left today per the active
    // budget gate (null when gating is off or the gate isn't budget-style).
    const budgetMsLeft = remainingBudgetMs(await evaluateGate());
    return ok({ settings, authenticated, activeListId, budgetMsLeft });
  },

  SET_ENABLED: async (req) => {
    await setSettings({ enabled: req.enabled });
    return ok(null);
  },

  GATE_EVAL: async () => ok(await enrichWithTasks(await evaluateGate())),

  USAGE_TICK: async (req) => {
    // Accrue screen time into this device's interval record (and a throttled
    // push to the sync transport). Re-blocking on budget exhaustion is handled
    // by the 1-minute gate alarm, so we don't re-evaluate on every tick.
    await recordUsage(Date.now(), req.deltaMs);
    return ok(null);
  },
} satisfies Pick<HandlerMap, 'GET_STATE' | 'SET_ENABLED' | 'GATE_EVAL' | 'USAGE_TICK'>;
