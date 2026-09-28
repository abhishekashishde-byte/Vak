-- Ana controlled-beta release hardening.
-- Adds minimal consent receipts, privacy-safe feedback, per-identity API throttling,
-- self-service account deletion, least-privilege grants and retention housekeeping.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.ana_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('meeting_recording','meeting_audio_retention','talk_ai','beta_18_plus')),
  notice_version text not null default '',
  outcome text not null check (outcome in ('confirmed','accepted','declined','withdrawn')),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.ana_consent_events enable row level security;
drop policy if exists "consent_select_own" on public.ana_consent_events;
create policy "consent_select_own" on public.ana_consent_events for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "consent_insert_own" on public.ana_consent_events;
create policy "consent_insert_own" on public.ana_consent_events for insert to authenticated with check ((select auth.uid()) = user_id);

create table if not exists public.ana_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug','slow','wrong_translation','ui','feature')),
  message text not null check (char_length(btrim(message)) between 3 and 3000),
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.ana_feedback enable row level security;
drop policy if exists "feedback_select_own" on public.ana_feedback;
create policy "feedback_select_own" on public.ana_feedback for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "feedback_insert_own" on public.ana_feedback;
create policy "feedback_insert_own" on public.ana_feedback for insert to authenticated with check ((select auth.uid()) = user_id);

create table if not exists private.ana_api_rate_limits (
  bucket text not null,
  identity_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket, identity_hash, window_start)
);
create index if not exists ana_api_rate_limits_updated_idx on private.ana_api_rate_limits(updated_at);

create or replace function public.ana_consume_api_rate_limit(
  p_bucket text,
  p_identity_hash text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text := left(regexp_replace(coalesce(p_bucket,''), '[^a-zA-Z0-9_.:-]', '', 'g'), 80);
  v_hash text := lower(coalesce(p_identity_hash,''));
  v_limit integer := greatest(1, least(coalesce(p_limit,1), 10000));
  v_window integer := greatest(10, least(coalesce(p_window_seconds,60), 86400));
  v_start timestamptz;
  v_count integer;
begin
  if v_bucket = '' or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ANA_RATE_LIMIT_INVALID';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);
  insert into private.ana_api_rate_limits(bucket, identity_hash, window_start, request_count, updated_at)
  values(v_bucket, v_hash, v_start, 1, now())
  on conflict(bucket, identity_hash, window_start)
  do update set request_count = private.ana_api_rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_count;
  return jsonb_build_object(
    'allowed', v_count <= v_limit,
    'remaining', greatest(0, v_limit - v_count),
    'resetAt', v_start + make_interval(secs => v_window)
  );
end;
$$;

create or replace function public.ana_delete_my_account(p_confirmation text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'ANA_AUTH_REQUIRED'; end if;
  if coalesce(p_confirmation,'') <> 'DELETE' then raise exception 'ANA_DELETE_CONFIRMATION_REQUIRED'; end if;
  delete from storage.objects
  where bucket_id = 'ana-meeting-audio'
    and (storage.foldername(name))[1] = v_uid::text;
  delete from auth.users where id = v_uid;
  return true;
end;
$$;

revoke all on table
  public.glossary_entries,
  public.meeting_records,
  public.meeting_actions,
  public.keyboard_learning_entries,
  public.meeting_action_routes,
  public.ana_timed_usage_sessions,
  public.ana_document_usage,
  public.ana_ai_usage_events,
  public.ana_consent_events,
  public.ana_feedback
from anon, authenticated;

grant select, insert, update, delete on
  public.glossary_entries,
  public.meeting_records,
  public.meeting_actions,
  public.keyboard_learning_entries,
  public.meeting_action_routes
to authenticated;
grant select on public.ana_timed_usage_sessions, public.ana_document_usage to authenticated;
grant select, insert on public.ana_ai_usage_events, public.ana_consent_events, public.ana_feedback to authenticated;

alter policy "users can insert own ai usage" on public.ana_ai_usage_events to authenticated;
alter policy "users can read own ai usage" on public.ana_ai_usage_events to authenticated;
alter policy "users can read own document usage" on public.ana_document_usage to authenticated;
alter policy "users can read own timed usage" on public.ana_timed_usage_sessions to authenticated;
alter policy "glossary_delete_own" on public.glossary_entries to authenticated;
alter policy "glossary_insert_own" on public.glossary_entries to authenticated;
alter policy "glossary_select_own" on public.glossary_entries to authenticated;
alter policy "glossary_update_own" on public.glossary_entries to authenticated;
alter policy "meeting_action_routes_delete_own" on public.meeting_action_routes to authenticated;
alter policy "meeting_action_routes_insert_own" on public.meeting_action_routes to authenticated;
alter policy "meeting_action_routes_select_own" on public.meeting_action_routes to authenticated;
alter policy "meeting_action_routes_update_own" on public.meeting_action_routes to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'ana_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
  end loop;
end $$;

grant execute on function public.ana_consume_api_rate_limit(text,text,integer,integer) to anon, authenticated;
grant execute on function public.ana_admin_cost_report() to authenticated;
grant execute on function public.ana_admin_user_usage() to authenticated;
grant execute on function public.ana_end_timed_usage(uuid) to authenticated;
grant execute on function public.ana_finish_document_usage(uuid,boolean) to authenticated;
grant execute on function public.ana_heartbeat_timed_usage(uuid) to authenticated;
grant execute on function public.ana_label_timed_usage(uuid,text) to authenticated;
grant execute on function public.ana_quota_status() to authenticated;
grant execute on function public.ana_refund_fixed_timed_usage(uuid) to authenticated;
grant execute on function public.ana_reserve_fixed_timed_usage(text,integer,text) to authenticated;
grant execute on function public.ana_start_document_usage(integer,text) to authenticated;
grant execute on function public.ana_start_timed_usage(text) to authenticated;
grant execute on function public.ana_validate_document_usage(uuid) to authenticated;
grant execute on function public.ana_validate_usage_session(uuid,text) to authenticated;
grant execute on function public.ana_delete_my_account(text) to authenticated;

create or replace function public.cleanup_ana_meeting_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.meeting_actions ma
  where exists (
    select 1 from public.meeting_records mr
    where mr.user_id = ma.user_id
      and mr.client_id = ma.meeting_client_id
      and coalesce(mr.ended_at, mr.started_at, mr.created_at) < now() - interval '60 days'
  );

  delete from public.meeting_records
  where coalesce(ended_at, started_at, created_at) < now() - interval '60 days';

  delete from public.meeting_actions ma
  where ma.created_at < now() - interval '60 days'
    and not exists (
      select 1 from public.meeting_records mr
      where mr.user_id = ma.user_id and mr.client_id = ma.meeting_client_id
    );

  delete from private.ana_api_rate_limits where updated_at < now() - interval '2 days';
end;
$$;
revoke execute on function public.cleanup_ana_meeting_retention() from public, anon, authenticated;
