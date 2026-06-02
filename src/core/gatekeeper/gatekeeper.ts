// The gatekeeper — the single source of truth for the gating decision.
// Background code calls it; it loads the active gate, builds a GateContext
// (injecting signals + usage + persisted state), runs the gate, persists
// any returned state, and hands back a wire-ready GateEvalResult.
//
// It performs no broadcasting itself — callers (handlers / background) own
// that — so the gatekeeper stays a pure orchestration unit.

import { browser } from 'wxt/browser';

import { getGateOrNull } from '@/gates/registry';
import type { GateContext } from '@/gates/types';
import { getProviderOrNull } from '@/providers/registry';
import { getSignalOrNull } from '@/signals/registry';
import { log } from '@/shared/logger';
import { err, type Result } from '@/shared/result';
import { getGateState, getSettings, setGateState } from '@/shared/storage';
import {
  DEFAULT_GATING,
  type GateConfig,
  type GateEvalResult,
  type GateId,
  type Task,
} from '@/shared/types';

import { cachedRead } from '@/core/background/task-cache';

import { getYoutubeUsageTodayMs, localDayKey } from './usage';

// Completed-tasks reads are cached this long to stay well under TickTick's
// 100-req/min limit; completing a task invalidates the cache for immediacy.
const COMPLETED_TTL_MS = 60_000;

async function loadActive(): Promise<{ gateId: GateId; config: GateConfig } | null> {
  const settings = await getSettings();
  // `gating` may be absent on installs that stored Settings before this
  // feature existed — fall back so reads never throw.
  const gating = settings.gating ?? DEFAULT_GATING;
  if (!gating.enabled || !gating.activeGateId) return null;
  if (!getGateOrNull(gating.activeGateId)) return null;
  return { gateId: gating.activeGateId, config: gating.gateConfigs[gating.activeGateId] ?? {} };
}

async function buildContext(gateId: GateId, config: GateConfig, now: number): Promise<GateContext> {
  return {
    now,
    youtubeUsageTodayMs: await getYoutubeUsageTodayMs(now),
    readSignal: async (id, signalConfig) => {
      const signal = getSignalOrNull(id);
      if (!signal) return err(`Unknown signal: ${id}`);
      try {
        return await signal.read(signalConfig);
      } catch (e) {
        // Surface a throwing signal as an error so the gate applies its own
        // fail-open / fail-closed policy, rather than letting it bubble to
        // evaluateGate's catch (which always fails open).
        return err(e instanceof Error ? e.message : String(e));
      }
    },
    readCompletedTasksToday: () => readCompletedTasksToday(now),
    state: await getGateState(gateId),
    config,
  };
}

// Bridge the active provider's "completed today" query into the gate
// context. Lazy (a thunk) so only gates that need it pay the network cost.
// "Today" uses the same local-day boundary as the YouTube-usage tracker.
async function readCompletedTasksToday(now: number): Promise<Result<Task[], string>> {
  const settings = await getSettings();
  if (!settings.activeProviderId) return err('No active provider');
  const provider = getProviderOrNull(settings.activeProviderId);
  if (!provider) return err(`Unknown provider: ${settings.activeProviderId}`);
  if (!provider.listCompletedTasks) return err('Provider cannot list completed tasks');

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const listCompleted = provider.listCompletedTasks;
  return cachedRead(
    `completed:${settings.activeProviderId}:${localDayKey(now)}`,
    COMPLETED_TTL_MS,
    () => listCompleted({ since: dayStart.getTime(), until: dayEnd.getTime() }),
  );
}

/**
 * Evaluate the active gate and return a wire-ready result. Returns
 * `{ gating: false }` when gating is off, no gate is active, or the gate
 * threw — we fail OPEN so a buggy gate can never permanently brick YouTube.
 * (Source-unreachable handling, where fail-closed may be wanted, is the
 * individual gate's concern via its own config.)
 */
export async function evaluateGate(now: number = Date.now()): Promise<GateEvalResult> {
  const active = await loadActive();
  if (!active) return { gating: false };

  const gate = getGateOrNull(active.gateId)!;
  try {
    const ctx = await buildContext(active.gateId, active.config, now);
    const decision = await gate.evaluate(ctx);
    if (decision.nextState) await setGateState(active.gateId, decision.nextState);
    return { gating: true, gateId: active.gateId, decision };
  } catch (e) {
    log.warn('gate evaluate failed; failing open:', e);
    return { gating: false };
  }
}

// --- Periodic re-evaluation alarm ----------------------------------------
//
// A 1-minute backstop so an expired session eventually re-blocks even in
// tabs that aren't running their own countdown (the overlay also re-locks
// itself precisely at `allowedUntil` client-side). 1 min is the Chrome MV3
// minimum alarm period.

const GATE_ALARM = 'todotube:gate';

export async function scheduleGateAlarm(): Promise<void> {
  await browser.alarms.clear(GATE_ALARM);
  await browser.alarms.create(GATE_ALARM, { periodInMinutes: 1 });
}

export function onGateAlarm(handler: () => void | Promise<void>): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== GATE_ALARM) return;
    void handler();
  });
}
