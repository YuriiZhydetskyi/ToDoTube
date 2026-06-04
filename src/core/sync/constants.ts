// Tunables for the multi-device sync orchestration. Internal policy numbers
// (not external-system identifiers), kept in one place so the local-store and
// the transports agree.

// Days of usage records to retain per device: today plus a margin so a record
// pushed by another device near midnight still lands in a day we keep. Older
// days are pruned on write.
export const USAGE_KEEP_DAYS = 2;

// Minimum spacing between remote pushes of this device's record. The own record
// is written to LOCAL storage every tick (durable, unmetered); pushing it to
// the remote transport (browser sync / HTTP backend) is throttled to limit
// network chatter. The 1-minute gate alarm forces a push as a backstop.
export const REMOTE_PUSH_THROTTLE_MS = 60_000;

// Time-to-live set on each per-day Redis key by the Upstash transport. Generous
// margin past the few days we ever read (USAGE_KEEP_DAYS) so the remote store
// auto-prunes stale days instead of growing forever — the Redis equivalent of
// the Supabase/Cloudflare backends' housekeeping. Refreshed on every push.
export const UPSTASH_KEY_TTL_SECONDS = 7 * 24 * 60 * 60;
