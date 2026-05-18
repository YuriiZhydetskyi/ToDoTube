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
  refreshToken: string;
  // Epoch ms. We refresh when (expiresAt - now) < 60_000.
  expiresAt: number;
  scope?: string;
}

export type Theme = 'auto' | 'light' | 'dark';
export type ClickBehavior = 'complete' | 'open';
export type SortBy = 'dueDate' | 'priority' | 'providerOrder';
export type RefreshInterval = 1 | 5 | 15;

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
};

export interface ProviderState {
  tokens?: OAuthTokens;
  // Epoch ms of the last successful refresh.
  lastSyncAt?: number;
  // Per-provider memory of which list the user was viewing.
  activeListId?: ListId;
}
