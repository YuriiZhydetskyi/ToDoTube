// Activity budget gate — earn screen time with physical activity.
//
// The continuous-credit ledger (the same model as the Anki gate), but the
// "earned" side comes from a fitness signal read over HTTP from a local
// bridge (see bridge/garmin/). The user expresses the deal in their own
// terms — "200 reps = 30 min", "30 min in HR zone = 60 min" — via an effort
// amount + a reward:
//
//   earned = (todayValue / effort) × reward
//   spent  = (screen-time minutes used today)
//   allowed while earned − spent > 0.
//
// `todayValue` arrives via ctx.readSignal in the metric's CANONICAL unit (ms
// for durationMs metrics, raw count for count metrics — the HTTP signal
// applies the catalog's scale), so the one place that needs care is matching
// the effort's unit to it. When the bridge is unreachable the gate applies
// the user's fail mode (default fail-closed), exactly like the Anki gate.

import {
  ACTIVITY_BRIDGE_SETUP_URL,
  ACTIVITY_BUDGET_GATE_ID,
  HTTP_SIGNAL_ID,
  type GateConfig,
  type GateDecision,
} from '@/shared/types';

import { MINUTE_MS, ledgerDecision, toMin } from '../_shared/ledger';
import type { Gate, GateContext } from '../types';
import { DEFAULT_BRIDGE_URL, DEFAULT_METRIC_ID, METRIC_CATALOG, type MetricId } from './constants';

const DEFAULT_EFFORT = 200; // 200 reps …
const DEFAULT_REWARD_MIN = 30; // … = 30 min, matching the default `reps` metric.

type FailMode = 'open' | 'closed';

interface ActivityGateConfig {
  metric: MetricId;
  bridgeUrl: string;
  effortAmount: number;
  rewardMinutes: number;
  failMode: FailMode;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isMetricId(value: unknown): value is MetricId {
  return typeof value === 'string' && value in METRIC_CATALOG;
}

function readConfig(config: GateConfig): ActivityGateConfig {
  const effort = numberOr(config.effortAmount, DEFAULT_EFFORT);
  const reward = numberOr(config.rewardMinutes, DEFAULT_REWARD_MIN);
  return {
    metric: isMetricId(config.metric) ? config.metric : DEFAULT_METRIC_ID,
    bridgeUrl:
      typeof config.bridgeUrl === 'string' && config.bridgeUrl
        ? config.bridgeUrl
        : DEFAULT_BRIDGE_URL,
    effortAmount: effort > 0 ? effort : DEFAULT_EFFORT,
    rewardMinutes: reward > 0 ? reward : DEFAULT_REWARD_MIN,
    failMode: config.failMode === 'open' ? 'open' : 'closed',
  };
}

const METRIC_OPTIONS = Object.values(METRIC_CATALOG).map((m) => [m.id, m.label] as const);

const bridgeSetupAction = { label: 'Activity bridge setup', url: ACTIVITY_BRIDGE_SETUP_URL };

export const activityBudgetGate: Gate = {
  id: ACTIVITY_BUDGET_GATE_ID,
  displayName: 'Earn time with activity',

  configSchema: [
    {
      kind: 'select',
      key: 'metric',
      label: 'Activity metric',
      help: 'Which value from your fitness bridge counts toward viewing time.',
      default: DEFAULT_METRIC_ID,
      options: METRIC_OPTIONS,
    },
    {
      kind: 'number',
      key: 'effortAmount',
      label: 'Effort required',
      help: 'How much of the metric (reps/steps, or minutes for HR-based metrics) earns one reward.',
      default: DEFAULT_EFFORT,
      min: 1,
      max: 100_000,
      step: 1,
    },
    {
      kind: 'number',
      key: 'rewardMinutes',
      label: 'Minutes earned per reward',
      help: 'Viewing minutes unlocked for each "effort required" you complete.',
      default: DEFAULT_REWARD_MIN,
      min: 1,
      max: 600,
      step: 1,
    },
    {
      kind: 'text',
      key: 'bridgeUrl',
      label: 'Bridge URL',
      help: 'Local endpoint serving today’s metrics as JSON. See the setup guide.',
      default: DEFAULT_BRIDGE_URL,
      placeholder: DEFAULT_BRIDGE_URL,
    },
    {
      kind: 'select',
      key: 'failMode',
      label: 'When the bridge is unreachable',
      help: 'The bridge must be running for your activity to count.',
      default: 'closed',
      options: [
        ['closed', 'Block the sites'],
        ['open', 'Allow the sites'],
      ],
    },
  ],

  async evaluate(ctx: GateContext): Promise<GateDecision> {
    const cfg = readConfig(ctx.config);
    const metric = METRIC_CATALOG[cfg.metric];

    const signal = await ctx.readSignal(HTTP_SIGNAL_ID, {
      url: cfg.bridgeUrl,
      jsonPath: metric.jsonPath,
      kind: metric.kind,
      scale: metric.scale,
    });

    if (!signal.ok) {
      if (cfg.failMode === 'open') {
        return { allowed: true, requirement: { title: 'Access unlocked' } };
      }
      return {
        allowed: false,
        requirement: {
          title: 'Start the activity bridge to unlock access',
          detail: `Couldn't reach the bridge (${signal.error}). Start your fitness bridge and confirm its URL in settings.`,
          action: bridgeSetupAction,
        },
      };
    }

    // Match the effort's unit to the signal's canonical unit: durationMs
    // values are in ms, so the effort (entered in minutes) is lifted to ms;
    // count values share the effort's plain unit directly.
    const canonicalEffort =
      metric.kind === 'durationMs' ? cfg.effortAmount * MINUTE_MS : cfg.effortAmount;
    const earnedMs = (signal.value.value / canonicalEffort) * cfg.rewardMinutes * MINUTE_MS;
    const spentMs = ctx.spentTodayMs;

    return ledgerDecision(earnedMs, spentMs, {
      blockedTitle: 'Move to unlock access',
      blockedDetail: `Earned ${toMin(earnedMs)} min · used ${toMin(spentMs)} min today. ${remainingHint(cfg, metric, earnedMs, spentMs)}`,
      action: bridgeSetupAction,
    });
  },
};

// "Do ~N more reps/min to keep watching." Derives the extra activity needed
// to cover the current deficit, expressed in the metric's display unit.
function remainingHint(
  cfg: ActivityGateConfig,
  metric: (typeof METRIC_CATALOG)[MetricId],
  earnedMs: number,
  spentMs: number,
): string {
  const deficitMs = Math.max(0, spentMs - earnedMs);
  // Extra canonical value Δ such that (Δ / canonicalEffort) × reward = deficit.
  const canonicalEffort =
    metric.kind === 'durationMs' ? cfg.effortAmount * MINUTE_MS : cfg.effortAmount;
  const deltaCanonical = (deficitMs * canonicalEffort) / (cfg.rewardMinutes * MINUTE_MS);
  if (metric.kind === 'durationMs') {
    return `Do ~${Math.max(1, Math.ceil(deltaCanonical / MINUTE_MS))} more min to keep watching.`;
  }
  return `Do ~${Math.max(1, Math.ceil(deltaCanonical))} more ${metric.effortUnit} to keep watching.`;
}
