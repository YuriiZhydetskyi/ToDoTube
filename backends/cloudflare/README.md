# ToDoTube sync — Cloudflare Worker backend

A ~70-line Worker that stores your Focus-mode budget so it syncs across all your
devices, **including Firefox Android** (which `storage.sync` can't reach). It has
no idle pause and runs comfortably in Cloudflare's free tier.

It's **single-tenant**: deploy your own, and only your devices use it. The
`SYNC_SECRET` is your password; the `sync code` you set in the extension groups
your devices.

## Setup (~5 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
Node installed.

```bash
cd backends/cloudflare

# 1. Log in to Cloudflare
npx wrangler login

# 2. Create the KV namespace and paste the printed id into wrangler.toml
npx wrangler kv namespace create USAGE

# 3. Pick a long random secret and store it (used as the bearer token)
npx wrangler secret put SYNC_SECRET      # paste e.g. the output of: openssl rand -hex 32

# 4. Deploy
npx wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g.
`https://todotube-sync.<you>.workers.dev`.

## Configure the extension (on every device)

Options → **Blocking** tab → **Sync**:

1. **Sync via** → `Cloudflare Worker`
2. **Worker URL** → the URL from `wrangler deploy`
3. **Shared secret** → the `SYNC_SECRET` you set
4. **Sync code** → click **Generate** on your first device, then paste the
   **same** code on every other device
5. **Allow access**, then **Test sync** — it should report the device count.

## Protocol

See [docs/SYNC.md](../../docs/SYNC.md). The extension only ever calls:

- `GET  /usage?sync_id=<code>&day=YYYY-MM-DD`
- `PUT  /usage` with `{ syncId, deviceId, day, intervals }`

both with `Authorization: Bearer <SYNC_SECRET>`.
