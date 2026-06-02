// Anki budget gate — the continuous-credit case of the ledger model.
//
// earned = (Anki minutes studied today) × ratio
// spent  = (screen-time minutes used today)
// allowed while earned − spent > 0.
//
// When Anki is unreachable the gate applies the user's fail mode (default
// fail-closed: block, since "just close Anki" would otherwise be a trivial
// bypass). The Anki value arrives via ctx.readSignal — the gate never talks
// to AnkiConnect directly (that's the signals/ layer).

import {
  ANKI_BUDGET_GATE_ID,
  ANKI_SETUP_URL,
  ANKI_STUDY_SIGNAL_ID,
  type GateConfig,
  type GateDecision,
} from '@/shared/types';

import { MINUTE_MS, ledgerDecision, toMin } from '../_shared/ledger';
import type { Gate, GateContext } from '../types';

const DEFAULT_RATIO = 1;
type FailMode = 'open' | 'closed';

interface AnkiGateConfig {
  // Screen-time minutes earned per Anki minute studied. 1 = parity.
  ratio: number;
  // What to do when AnkiConnect can't be reached.
  failMode: FailMode;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readConfig(config: GateConfig): AnkiGateConfig {
  const ratio = numberOr(config.ratio, DEFAULT_RATIO);
  return {
    ratio: ratio > 0 ? ratio : DEFAULT_RATIO,
    failMode: config.failMode === 'open' ? 'open' : 'closed',
  };
}

const ankiSetupAction = { label: 'AnkiConnect setup', url: ANKI_SETUP_URL };

export const ankiBudgetGate: Gate = {
  id: ANKI_BUDGET_GATE_ID,
  displayName: 'Earn time with Anki',

  configSchema: [
    {
      kind: 'number',
      key: 'ratio',
      label: 'Minutes earned per Anki minute',
      help: 'Earned viewing time per minute studied. 1 = parity; 0.5 = study twice as long as you watch.',
      default: DEFAULT_RATIO,
      min: 0.25,
      max: 10,
      step: 0.25,
    },
    {
      kind: 'select',
      key: 'failMode',
      label: 'When Anki is closed',
      help: 'Anki must be running for its study time to count.',
      default: 'closed',
      options: [
        ['closed', 'Block the sites'],
        ['open', 'Allow the sites'],
      ],
    },
  ],

  async evaluate(ctx: GateContext): Promise<GateDecision> {
    const cfg = readConfig(ctx.config);

    const signal = await ctx.readSignal(ANKI_STUDY_SIGNAL_ID);
    if (!signal.ok) {
      if (cfg.failMode === 'open') {
        return { allowed: true, requirement: { title: 'Access unlocked' } };
      }
      return {
        allowed: false,
        requirement: {
          title: 'Open Anki to unlock access',
          detail: `Couldn't reach Anki (${signal.error}). Start Anki, install AnkiConnect, and allow this extension in its CORS list.`,
          action: ankiSetupAction,
        },
      };
    }

    const earnedMs = signal.value.value * cfg.ratio;
    const spentMs = ctx.spentTodayMs;
    const remainingStudyMin = Math.max(1, Math.ceil((spentMs - earnedMs) / cfg.ratio / MINUTE_MS));

    return ledgerDecision(earnedMs, spentMs, {
      blockedTitle: 'Study in Anki to unlock access',
      blockedDetail: `Earned ${toMin(earnedMs)} min · used ${toMin(spentMs)} min today. Study ~${remainingStudyMin} more min to keep browsing.`,
      action: ankiSetupAction,
    });
  },
};
