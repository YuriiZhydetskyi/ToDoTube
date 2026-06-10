-- ToDoTube sync backend — Supabase schema.
--
-- One table holding each device's daily interval record. The extension talks to
-- it directly over PostgREST (no Edge Function needed). See docs/SYNC.md.
--
-- Run this once in your project's SQL Editor (Dashboard → SQL Editor → New query
-- → paste → Run).
--
-- SECURITY MODEL: this is YOUR private, single-tenant project. The project URL +
-- anon key are your credential — treat the anon key like a password and don't
-- publish it. The `sync_id` column groups your devices (and is the secret you
-- paste into the extension). Because only your own data lives here, the policy
-- below simply allows the anon role full access to this one table.

create table if not exists public.usage (
  sync_id    text        not null,
  device_id  text        not null,
  day        text        not null,            -- "YYYY-MM-DD" (local day)
  intervals  jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (sync_id, device_id, day)
);

alter table public.usage enable row level security;

-- Full access for the anon role, scoped to this table only. (Your project is
-- private to you; the anon key is the gate.) Drop-and-recreate so re-running the
-- script is idempotent.
drop policy if exists "todotube usage anon access" on public.usage;
create policy "todotube usage anon access"
  on public.usage
  for all
  to anon
  using (true)
  with check (true);

-- Optional housekeeping: forget records older than 30 days. Either run this by
-- hand occasionally, or schedule it with pg_cron if you have it enabled.
-- delete from public.usage where day < to_char(now() - interval '30 days', 'YYYY-MM-DD');
