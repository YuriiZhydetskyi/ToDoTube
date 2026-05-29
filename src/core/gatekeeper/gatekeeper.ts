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
import { getSignalOrNull } from '@/signals/registry';
import { log } from '@/shared/logger';
import { err } from '@/shared/result';
import { getGateState, getSettings, setGateState } from '@/shared/storage';
import {
  DEFAULT_GATING,
  type GateConfig,
  type GateEvalResult,
  type GateId,
  type ProviderId,
} from '@/shared/types';

import { getYoutubeUsageTodayMs } from './usage';

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
      return signal ? signal.read(signalConfig) : err(`Unknown signal: ${id}`);
    },
    state: await getGateState(gateId),
    config,
  };
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

/**
 * Forward a "task completed" event to the active gate (if it handles
 * events), persist any state change, then re-evaluate so the returned
 * decision reflects the new state. Safe to call regardless of which gate
 * is active.
 */
export async function notifyTaskCompleted(
  providerId: ProviderId,
  taskId: string,
  now: number = Date.now(),
): Promise<GateEvalResult> {
  const active = await loadActive();
  const gate = active && getGateOrNull(active.gateId);
  if (active && gate?.onEvent) {
    try {
      const ctx = await buildContext(active.gateId, active.config, now);
      const partial = await gate.onEvent({ type: 'task-completed', providerId, taskId }, ctx);
      if (partial?.nextState) await setGateState(active.gateId, partial.nextState);
    } catch (e) {
      log.warn('gate onEvent failed:', e);
    }
  }
  return evaluateGate(now);
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
