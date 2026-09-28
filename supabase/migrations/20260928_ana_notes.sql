create table if not exists public.ana_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled note',
  note_type text not null default 'quick' check (note_type in ('quick','meeting')),
  typed_text text not null default '',
  recognized_text text not null default '',
  ink jsonb not null default '[]'::jsonb,
  ai_note jsonb not null default '{}'::jsonb,
  language text not null default 'English',
  meeting_transcript text not null default '',
  meeting_started_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ana_notes_user_updated_idx on public.ana_notes(user_id, updated_at desc);
alter table public.ana_notes enable row level security;
drop policy if exists "ana_notes_select_own" on public.ana_notes;
create policy "ana_notes_select_own" on public.ana_notes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "ana_notes_insert_own" on public.ana_notes;
create policy "ana_notes_insert_own" on public.ana_notes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "ana_notes_update_own" on public.ana_notes;
create policy "ana_notes_update_own" on public.ana_notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "ana_notes_delete_own" on public.ana_notes;
create policy "ana_notes_delete_own" on public.ana_notes for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.ana_notes from anon, authenticated;
grant select, insert, update, delete on public.ana_notes to authenticated;
