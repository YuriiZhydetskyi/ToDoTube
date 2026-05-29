// Cross-layer types. May not import from any other layer (shared is a leaf).

export type ProviderId = 'ticktick';

export type SyntheticListId = 'smart:today';

// A list id is either a synthetic id ("smart:today") or the provider's
// own opaque project id string.
export type ListId = string;

export function isSynthetic(id: ListId): id is SyntheticListId {
  return id.startsWith('smart:');
}

export interface Project {
  id: ListId;
  name: string;
  color?: string;
  synthetic?: boolean;
}

export interface Task {
  id: string;
  // Real project id from the provider, even for tasks shown in a synthetic
  // list. Required to round-trip a `completeTask` call back to the API.
  projectId: string;
  title: string;
  // ISO 8601 with offset, e.g. "2026-05-18T17:00:00+0000". Optional.
  dueDate?: string;
  // Provider-specific priority bucket. 0..5 for TickTick (0 = none).
  priority?: number;
  completed: boolean;
}

export interface OAuthTokens {
  accessToken: string;
  // Optional — some providers (notably TickTick) don't issue a refresh
  // token at all and instead grant long-lived access tokens. When
  // missing, an expired access token forces full re-authentication.
  refreshToken?: string;
  // Epoch ms. We refresh when (expiresAt - now) < 60_000.
  expiresAt: number;
  scope?: string;
}

export type Theme = 'auto' | 'light' | 'dark';
export type ClickBehavior = 'complete' | 'open';
export type SortBy = 'dueDate' | 'priority' | 'providerOrder';
export type RefreshInterval = 1 | 5 | 15;

// ---------------------------------------------------------------------------
// Gating subsystem DTOs
//
// These cross the message bus (background → content script), so they live
// here in `shared` alongside Task/Project rather than in the gates/ layer —
// the same rule the rest of the wire types follow. The behavioral
// interfaces (`Gate`, `GateContext`) stay in `gates/types.ts`; only the
// data that travels between layers lives here.
// ---------------------------------------------------------------------------

// A read-only sensor's value. `durationMs` for time-based signals (Anki
// minutes today, YouTube usage today); `count` for tallies (tasks done).
export type SignalKind = 'durationMs' | 'count';

export interface SignalValue {
  kind: SignalKind;
  value: number;
  // Epoch ms when the value was sampled.
  asOf: number;
}

// A gate id is an opaque kebab string so the registry can grow without
// widening a union at every call site (unlike ProviderId, which is small
// and closed). Bundled gates use stable ids exported as constants.
export type GateId = string;

export const TASK_COMPLETE_GATE_ID = 'task-complete';
export const ANKI_BUDGET_GATE_ID = 'anki-budget';

// Signal ids that gates reference live here (shared) so a gate can name a
// signal without importing the signals/ layer — the core bridges the two.
export const ANKI_STUDY_SIGNAL_ID = 'anki-study-today';

// Docs URL for allowlisting this extension's origin in AnkiConnect's
// `webCorsOriginList`. UI copy referenced by both the Anki gate (block
// screen) and the options page, so it lives in shared. (The AnkiConnect
// *protocol* strings — endpoint, port, action names — stay single-sourced
// in signals/anki/constants.ts.)
export const ANKI_SETUP_URL = 'https://foosoft.net/projects/anki-connect/#configuration';

// Per-gate user configuration and per-gate persisted runtime state. Both
// are opaque to the core — each gate reads/validates its own shape. Config
// lives in Settings; state lives in its own storage item per gate,
// mirroring ProviderState.
export type GateConfig = Record<string, unknown>;
export type GateState = Record<string, unknown>;

// A gate declares its user-configurable fields as a small schema so the
// options page can render them generically (no per-gate special-casing).
// `key` is the GateConfig property the field reads/writes.
export type GateConfigField =
  | {
      kind: 'number';
      key: string;
      label: string;
      help?: string;
      default: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      kind: 'select';
      key: string;
      label: string;
      help?: string;
      default: string;
      options: ReadonlyArray<readonly [value: string, label: string]>;
    };

// What to render on the block screen when access is denied.
export interface RequirementView {
  title: string;
  detail?: string;
  // Optional progress meter (e.g. "1 / 3 tasks", "8 / 15 min").
  progress?: { current: number; target: number; unit: string };
  // Optional call-to-action (e.g. "Open TickTick").
  action?: { label: string; url?: string };
}

export interface GateDecision {
  allowed: boolean;
  // Epoch ms when an active allowance expires. The overlay uses this to
  // re-lock precisely client-side without waiting for the next alarm.
  allowedUntil?: number;
  // Budget view (earned vs spent), surfaced by ledger-style gates.
  earnedMs?: number;
  spentMs?: number;
  requirement: RequirementView;
  // State the gate wants persisted after this evaluation. The core writes
  // it back; it never travels to content scripts.
  nextState?: GateState;
}

// Wire result for GATE_EVAL / GATE_CHANGED. `gating: false` means the
// feature is off or no gate is active — content scripts then ensure no
// overlay is shown.
export type GateEvalResult =
  | { gating: false }
  | { gating: true; gateId: GateId; decision: GateDecision };

export type GatingScope = 'site' | 'watch';

export interface GatingSettings {
  enabled: boolean;
  // Decision 2026-05-29: default to blocking the whole site. `watch` is
  // kept as an option so the scope can narrow without a schema change.
  scope: GatingScope;
  activeGateId: GateId | null;
  gateConfigs: Record<GateId, GateConfig>;
}

export const DEFAULT_GATING: GatingSettings = {
  enabled: false,
  scope: 'site',
  activeGateId: null,
  gateConfigs: {},
};

export interface Settings {
  // Master on/off (popup toggle). When false, content scripts no-op.
  enabled: boolean;

  activeProviderId: ProviderId | null;

  // Display
  replaceRightRail: boolean;
  replaceEndscreen: boolean;
  showCompleted: boolean;
  maxItems: number;
  sortBy: SortBy;
  theme: Theme;

  // Behavior
  refreshIntervalMin: RefreshInterval;
  clickBehavior: ClickBehavior;

  // Advanced
  verboseLogging: boolean;
  debugOverlay: boolean;
  // JSON string in the same shape as the bundled selectors registry.
  // null = use bundled selectors. See docs/SELECTORS.md.
  selectorsOverride: string | null;

  // Gating ("block YouTube until …") subsystem. Orthogonal to the
  // recommendation-replacement feature above — a user may run either,
  // both, or neither. See [[project-todotube-gating]].
  gating: GatingSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  activeProviderId: null,
  replaceRightRail: true,
  replaceEndscreen: true,
  showCompleted: false,
  maxItems: 25,
  sortBy: 'providerOrder',
  theme: 'auto',
  refreshIntervalMin: 5,
  clickBehavior: 'complete',
  verboseLogging: false,
  debugOverlay: false,
  selectorsOverride: null,
  gating: DEFAULT_GATING,
};

export interface ProviderState {
  tokens?: OAuthTokens;
  // Epoch ms of the last successful refresh.
  lastSyncAt?: number;
  // Per-provider memory of which list the user was viewing.
  activeListId?: ListId;
}
