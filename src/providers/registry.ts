// One-stop lookup from a ProviderId to its implementation. Adding a new
// provider is: drop a new folder under `src/providers/<name>/`, export
// a `Provider` value from it, then add one switch case here.

import type { ProviderId } from '@/shared/types';

import { tickTickProvider } from './ticktick/provider';
import type { Provider } from './types';

export function getProvider(id: ProviderId): Provider {
  switch (id) {
    case 'ticktick':
      return tickTickProvider;
  }
}

export function getProviderOrNull(id: ProviderId | null): Provider | null {
  return id === null ? null : getProvider(id);
}
