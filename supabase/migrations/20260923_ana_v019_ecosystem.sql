-- Ana v0.19: scoped glossary + approval-first external action receipts.

alter table public.glossary_entries
  add column if not exists scope text not null default 'personal',
  add column if not exists context text not null default '',
  add column if not exists rule text not null default 'preferred';

alter table public.glossary_entries
  drop constraint if exists glossary_entries_scope_check;
alter table public.glossary_entries
  add constraint glossary_entries_scope_check
  check (scope = any (array['personal'::text,'project'::text,'company'::text]));

alter table public.glossary_entries
  drop constraint if exists glossary_entries_rule_check;
alter table public.glossary_entries
  add constraint glossary_entries_rule_check
  check (rule = any (array['preferred'::text,'locked'::text]));

create unique index if not exists glossary_entries_user_client_unique
  on public.glossary_entries(user_id, client_id);

drop policy if exists glossary_select_own on public.glossary_entries;
create policy glossary_select_own on public.glossary_entries
  for select using ((select auth.uid()) = user_id);

drop policy if exists glossary_insert_own on public.glossary_entries;
create policy glossary_insert_own on public.glossary_entries
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists glossary_update_own on public.glossary_entries;
create policy glossary_update_own on public.glossary_entries
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists glossary_delete_own on public.glossary_entries;
create policy glossary_delete_own on public.glossary_entries
  for delete using ((select auth.uid()) = user_id);

create table if not exists public.meeting_action_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null references public.meeting_actions(id) on delete cascade,
  provider text not null,
  status text not null default 'sent',
  external_id text not null default '',
  external_url text not null default '',
  response_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, action_id, provider),
  constraint meeting_action_routes_provider_check
    check (provider = any (array['jira'::text,'planner'::text])),
  constraint meeting_action_routes_status_check
    check (status = any (array['sent'::text,'failed'::text]))
);

alter table public.meeting_action_routes enable row level security;

drop policy if exists meeting_action_routes_select_own on public.meeting_action_routes;
create policy meeting_action_routes_select_own on public.meeting_action_routes
  for select using ((select auth.uid()) = user_id);

drop policy if exists meeting_action_routes_insert_own on public.meeting_action_routes;
create policy meeting_action_routes_insert_own on public.meeting_action_routes
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists meeting_action_routes_update_own on public.meeting_action_routes;
create policy meeting_action_routes_update_own on public.meeting_action_routes
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists meeting_action_routes_delete_own on public.meeting_action_routes;
create policy meeting_action_routes_delete_own on public.meeting_action_routes
  for delete using ((select auth.uid()) = user_id);

create index if not exists meeting_action_routes_user_action_idx
  on public.meeting_action_routes(user_id, action_id);
create index if not exists meeting_action_routes_action_id_idx
  on public.meeting_action_routes(action_id);
