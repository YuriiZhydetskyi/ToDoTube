# ToDoTube sync — Supabase backend

Store your Focus-mode budget in your own Supabase project so it syncs across all
your devices, **including Firefox Android** (which `storage.sync` can't reach).
No server code — just one table the extension reads/writes over PostgREST.

It's **single-tenant**: your project, your data. The project URL + anon key are
your credential.

## Setup (~5 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste [`schema.sql`](./schema.sql) → **Run**.
3. **Project Settings → API**, copy:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **Project API keys → `anon` `public`**

> Heads-up: the free tier **pauses a project after ~7 days of inactivity** and
> takes ~30 s to wake. If that's annoying, use the Cloudflare Worker backend
> instead (no pause) — see [`../cloudflare`](../cloudflare).

## Configure the extension (on every device)

Options → **Blocking** tab → **Sync**:

1. **Sync via** → `Supabase`
2. **Project URL** → from step 3
3. **Anon public key** → from step 3
4. **Sync code** → click **Generate** on your first device, then paste the
   **same** code on every other device
5. **Allow access**, then **Test sync** — it should report the device count.

## How the data looks

One row per `(sync_id, device_id, day)`:

| column      | example                                  |
| ----------- | ---------------------------------------- |
| `sync_id`   | your sync code                           |
| `device_id` | random per-device id                     |
| `day`       | `2026-06-02`                             |
| `intervals` | `[{ "start": 1719..., "end": 1719... }]` |

The extension reads every device's row for today and counts the **union** of the
intervals, so watching on two devices at once is counted once. See
[docs/SYNC.md](../../docs/SYNC.md).
