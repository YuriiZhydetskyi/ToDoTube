import type { ListId, ProviderId } from './types';

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  webAppUrl: string;
  defaultListId: ListId;
  smartListCaption?: string;
  /**
   * Deep link to a single task in the provider's web app. Used by the
   * "Open in <provider>" click behavior. `projectId` is the task's real
   * source project (every Task carries it, even synthetic-list tasks).
   */
  taskUrl: (projectId: string, taskId: string) => string;
}

const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  ticktick: {
    id: 'ticktick',
    displayName: 'TickTick',
    webAppUrl: 'https://ticktick.com/webapp/',
    defaultListId: 'smart:today',
    smartListCaption: 'Due (<= 2 days overdue) or starting today',
    taskUrl: (projectId, taskId) => `https://ticktick.com/webapp/#p/${projectId}/tasks/${taskId}`,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const DEFAULT_PROVIDER_ID: ProviderId = 'ticktick';

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDERS[id];
}
