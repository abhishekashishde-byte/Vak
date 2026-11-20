-- One Wani connection per Ana account. The key is a revocable Wani "connection key";
-- the Ana server reads it with the user's own session to send meeting transcripts to Wani.
create table if not exists public.ana_wani_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wani_key text not null check (wani_key like 'wani_ak_%'),
  key_hint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ana_wani_connections enable row level security;
drop policy if exists "wani_connection_own" on public.ana_wani_connections;
create policy "wani_connection_own" on public.ana_wani_connections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.ana_wani_connections to authenticated;

-- Receipts for meetings sent to Wani (which workshop, which Wani transcript).
create table if not exists public.ana_wani_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_client_id text not null,
  workshop_id text not null,
  workshop_label text not null default '',
  wani_transcript_id text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, meeting_client_id, workshop_id)
);
alter table public.ana_wani_sends enable row level security;
drop policy if exists "wani_sends_own" on public.ana_wani_sends;
create policy "wani_sends_own" on public.ana_wani_sends for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.ana_wani_sends to authenticated;
