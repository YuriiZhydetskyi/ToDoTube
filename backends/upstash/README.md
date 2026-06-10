# ToDoTube sync — Upstash Redis backend

Store your Focus-mode budget in your own Upstash Redis database so it syncs
across all your devices, **including Firefox Android** (which `storage.sync`
can't reach). No server code and **nothing to deploy** — the extension talks
straight to Upstash's Redis REST API. Unlike the Supabase free tier, it **never
idle-pauses**.

It's **single-tenant**: your database, your data. The REST URL + token are your
credential.

## Setup (~2 minutes)

1. Create a free database at [console.upstash.com](https://console.upstash.com)
   (any region; "Global" is fine).
2. On the database page, open **REST API** and copy:
   - **`UPSTASH_REDIS_REST_URL`** (e.g. `https://eu1-xxxx-12345.upstash.io`)
   - **`UPSTASH_REDIS_REST_TOKEN`** (the read-write token)

## Configure the extension (on every device)

Options → **Blocking** tab → **Sync**:

1. **Sync via** → `Upstash Redis`
2. **REST URL** → from step 2
3. **REST token** → from step 2
4. **Sync code** → click **Generate** on your first device, then paste the
   **same** code on every other device
5. **Allow access**, then **Test sync** — it should report the device count.

## How the data looks

One Redis **hash** per `(sync code, day)`, keyed `todotube:usage:{syncId}:{day}`,
with one field per device:

| field (device id)    | value (JSON)                             |
| -------------------- | ---------------------------------------- |
| random per-device id | `[{ "start": 1719..., "end": 1719... }]` |

The extension reads every device's field for today (`HGETALL`) and counts the
**union** of the intervals, so watching on two devices at once is counted once.
Each key carries a TTL, so old days expire on their own — no housekeeping to run.
See [docs/SYNC.md](../../docs/SYNC.md).
