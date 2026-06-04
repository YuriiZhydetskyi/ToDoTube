// One-stop lookup from a SyncMode to its remote transport + the metadata the
// options page renders. Mirrors gates/registry.ts: adding a backend is one
// entry here plus its transport — either a new flavor of the shared `/usage`
// protocol in http-transport.ts (Supabase, Cloudflare) or a dedicated adapter
// when the backend speaks something else (Upstash speaks the Redis REST API).

import type { SyncProviderDescriptor, SyncTransport } from '@/shared/sync-transport';
import type { SyncSettings } from '@/shared/types';

import { createBrowserStorageTransport } from './browser-storage-transport';
import { createHttpTransport } from './http-transport';
import { createUpstashTransport } from './upstash-transport';

// Display metadata + config schema for each selectable mode. Passed to the
// (ui-layer) options page; the page renders `configSchema` with the same
// generic field renderer it uses for gate config.
export const SYNC_PROVIDERS: readonly SyncProviderDescriptor[] = [
  {
    id: 'off',
    displayName: 'Off',
    description: 'Budget is tracked only on this device.',
    reachesOtherDevices: false,
    configSchema: [],
  },
  {
    id: 'browser',
    displayName: 'Browser sync',
    description:
      'Sync via your browser account. Works between same-browser desktops; ' +
      'does NOT reach Firefox Android (use an HTTP backend for the phone).',
    reachesOtherDevices: true,
    configSchema: [],
  },
  {
    id: 'supabase',
    displayName: 'Supabase',
    description: 'Your own Supabase project. Reaches every device, including Android.',
    reachesOtherDevices: true,
    configSchema: [
      {
        kind: 'text',
        key: 'url',
        label: 'Project URL',
        help: 'Settings → API → Project URL.',
        default: '',
        placeholder: 'https://xxxxxxxx.supabase.co',
      },
      {
        kind: 'text',
        key: 'apiKey',
        label: 'Anon public key',
        help: 'Settings → API → Project API keys → anon public.',
        default: '',
        placeholder: 'eyJhbGciOi…',
      },
    ],
  },
  {
    id: 'cloudflare',
    displayName: 'Cloudflare Worker',
    description: 'Your own Worker (no idle pause). Reaches every device, including Android.',
    reachesOtherDevices: true,
    configSchema: [
      {
        kind: 'text',
        key: 'url',
        label: 'Worker URL',
        help: 'The deployed Worker’s URL.',
        default: '',
        placeholder: 'https://todotube-sync.you.workers.dev',
      },
      {
        kind: 'text',
        key: 'secret',
        label: 'Shared secret',
        help: 'The SYNC_SECRET you set on the Worker.',
        default: '',
        placeholder: '••••••••',
      },
    ],
  },
  {
    id: 'upstash',
    displayName: 'Upstash Redis',
    description:
      'Your own Upstash Redis (no idle pause, no server code). Reaches every device, including Android.',
    reachesOtherDevices: true,
    configSchema: [
      {
        kind: 'text',
        key: 'url',
        label: 'REST URL',
        help: 'Upstash console → your database → REST API → UPSTASH_REDIS_REST_URL.',
        default: '',
        placeholder: 'https://xxxx.upstash.io',
      },
      {
        kind: 'text',
        key: 'token',
        label: 'REST token',
        help: 'REST API → UPSTASH_REDIS_REST_TOKEN (read-write).',
        default: '',
        placeholder: '••••••••',
      },
    ],
  },
];

// Build the remote transport for the active mode, or null when sync is off (the
// own record then lives only in local storage). The own record is always kept
// in local storage regardless; this is the replication channel on top.
export function createRemoteTransport(sync: SyncSettings): SyncTransport | null {
  switch (sync.mode) {
    case 'off':
      return null;
    case 'browser':
      return createBrowserStorageTransport('sync');
    case 'supabase':
      return createHttpTransport('supabase', sync);
    case 'cloudflare':
      return createHttpTransport('cloudflare', sync);
    case 'upstash':
      return createUpstashTransport(sync);
    default:
      return null;
  }
}
