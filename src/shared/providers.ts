import type { ListId, ProviderId } from './types';

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  webAppUrl: string;
  defaultListId: ListId;
  smartListCaption?: string;
}

const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  ticktick: {
    id: 'ticktick',
    displayName: 'TickTick',
    webAppUrl: 'https://ticktick.com/webapp/',
    defaultListId: 'smart:today',
    smartListCaption: 'Due (<= 2 days overdue) or starting today',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const DEFAULT_PROVIDER_ID: ProviderId = 'ticktick';

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDERS[id];
}
