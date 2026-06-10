// The pluggable-sync contract. Implementations (browser storage / HTTP backend)
// live in core/sync; the interface lives here in `shared` (a leaf) so the core
// adapters AND the gatekeeper can depend on the contract without crossing a
// layer boundary. See docs/SYNC.md for the data model and the wire protocol.

import type { DeviceDayUsage } from './intervals';
import type { GateConfigField, SyncMode } from './types';

// A remote replication channel for this device's interval records. The own
// device's freshest record always lives in LOCAL storage (durable every tick);
// a transport is the channel that pushes it out and reads other devices back.
//
//  - putOwn(rec):     upsert THIS device's record for rec.day (full replace of
//                     its own slot). Implementations prune their own stale days.
//  - listForDay(day): every device's record for `day` in this channel
//                     (including this device's last-pushed copy).
//  - onRemoteChange:  subscribe to remote updates (another device wrote);
//                     returns an unsubscribe fn. Optional — browser storage
//                     fires change events, a poll-only HTTP backend relies on
//                     the 1-minute gate alarm to re-read instead.
export interface SyncTransport {
  putOwn(rec: DeviceDayUsage): Promise<void>;
  listForDay(day: string): Promise<DeviceDayUsage[]>;
  onRemoteChange?(cb: () => void): () => void;
}

// Metadata for the options page (mode picker + config fields), mirroring the
// gate registry's GateDescriptor. Pure data so the (ui-layer) options page can
// render it without importing core/sync. `configSchema` reuses GateConfigField
// and is rendered by the same generic field renderer as gate config.
export interface SyncProviderDescriptor {
  id: SyncMode;
  displayName: string;
  // One-line description shown under the mode selector.
  description: string;
  // Whether this mode actually reaches OTHER devices. `off` never does;
  // `browser` does between same-browser desktops but NOT Firefox Android.
  reachesOtherDevices: boolean;
  configSchema: readonly GateConfigField[];
}
