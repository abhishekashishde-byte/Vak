-- Ana admin AI usage and cost reporting.
-- Pricing snapshot: 2026-09-25. Text-token cost is logged per API response.
-- Streaming translation/transcription and meeting transcription use duration estimates.

create table if not exists public.ana_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null default 'other',
  model text not null default '',
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  audio_input_tokens bigint not null default 0 check (audio_input_tokens >= 0),
  audio_output_tokens bigint not null default 0 check (audio_output_tokens >= 0),
  audio_seconds numeric not null default 0 check (audio_seconds >= 0),
  estimated_cost_usd numeric(16,8) not null default 0 check (estimated_cost_usd >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ana_ai_usage_events enable row level security;

drop policy if exists "users can insert own ai usage" on public.ana_ai_usage_events;
create policy "users can insert own ai usage"
  on public.ana_ai_usage_events for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "users can read own ai usage" on public.ana_ai_usage_events;
create policy "users can read own ai usage"
  on public.ana_ai_usage_events for select
  using ((select auth.uid()) = user_id);

create index if not exists ana_ai_usage_events_created_idx on public.ana_ai_usage_events(created_at);
create index if not exists ana_ai_usage_events_user_created_idx on public.ana_ai_usage_events(user_id, created_at);
create index if not exists ana_ai_usage_events_feature_idx on public.ana_ai_usage_events(feature, created_at);

create or replace function public.ana_label_timed_usage(p_session_id uuid, p_feature text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ana_timed_usage_sessions
     set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('feature', left(coalesce(p_feature,''), 64))
   where id = p_session_id
     and user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.ana_label_timed_usage(uuid,text) from public;
grant execute on function public.ana_label_timed_usage(uuid,text) to authenticated;

create or replace function public.ana_admin_cost_report()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_week_start timestamptz := date_trunc('week', now());
  v_result jsonb;
begin
  select email into v_email from auth.users where id = auth.uid();
  if lower(coalesce(v_email,'')) <> 'abhishekashish15@gmail.com' then
    raise exception 'ANA_ADMIN_REQUIRED';
  end if;

  with
  days as (
    select (v_week_start + (n || ' days')::interval) as day_start
    from generate_series(0,6) as n
  ),
  token_daily as (
    select date_trunc('day', created_at) as day_start,
           sum(estimated_cost_usd)::numeric as cost_usd,
           sum(input_tokens + output_tokens)::bigint as tokens
    from public.ana_ai_usage_events
    where created_at >= v_week_start and created_at < v_week_start + interval '7 days'
    group by 1
  ),
  timed_daily as (
    select date_trunc('day', started_at) as day_start,
           sum(seconds_used)::numeric / 60.0 as audio_minutes,
           sum(case
             when kind = 'meeting_notes' then (seconds_used::numeric / 60.0) * 0.006
             when kind = 'meeting_live' and coalesce(metadata->>'feature','') = 'live_transcript' then (seconds_used::numeric / 60.0) * 0.017
             when kind = 'meeting_live' then (seconds_used::numeric / 60.0) * 0.034
             else 0 end) as cost_usd
    from public.ana_timed_usage_sessions
    where started_at >= v_week_start and started_at < v_week_start + interval '7 days'
    group by 1
  ),
  daily as (
    select d.day_start,
           coalesce(tk.cost_usd,0) + coalesce(tm.cost_usd,0) as cost_usd,
           coalesce(tk.tokens,0) as tokens,
           coalesce(tm.audio_minutes,0) as audio_minutes
    from days d left join token_daily tk using(day_start) left join timed_daily tm using(day_start)
    order by d.day_start
  ),
  token_summary as (
    select coalesce(sum(input_tokens),0)::bigint as input_tokens,
           coalesce(sum(cached_input_tokens),0)::bigint as cached_input_tokens,
           coalesce(sum(output_tokens),0)::bigint as output_tokens,
           coalesce(sum(estimated_cost_usd),0)::numeric as token_cost_usd,
           min(created_at) as tracking_started_at
    from public.ana_ai_usage_events
    where created_at >= v_week_start and created_at < v_week_start + interval '7 days'
  ),
  timed_summary as (
    select coalesce(sum(seconds_used),0)::bigint as seconds,
           coalesce(sum(case
             when kind = 'meeting_notes' then (seconds_used::numeric / 60.0) * 0.006
             when kind = 'meeting_live' and coalesce(metadata->>'feature','') = 'live_transcript' then (seconds_used::numeric / 60.0) * 0.017
             when kind = 'meeting_live' then (seconds_used::numeric / 60.0) * 0.034
             else 0 end),0)::numeric as audio_cost_usd
    from public.ana_timed_usage_sessions
    where started_at >= v_week_start and started_at < v_week_start + interval '7 days'
  ),
  feature_rows as (
    select feature, sum(estimated_cost_usd)::numeric as cost_usd,
           sum(input_tokens + output_tokens)::bigint as tokens, 0::numeric as audio_minutes
    from public.ana_ai_usage_events
    where created_at >= v_week_start and created_at < v_week_start + interval '7 days'
    group by feature
    union all
    select case
      when kind = 'meeting_notes' then 'meeting_notes'
      when kind = 'meeting_live' and coalesce(metadata->>'feature','') = 'live_transcript' then 'live_transcript'
      when kind = 'meeting_live' then 'live_translate'
      else kind end as feature,
      sum(case
        when kind = 'meeting_notes' then (seconds_used::numeric / 60.0) * 0.006
        when kind = 'meeting_live' and coalesce(metadata->>'feature','') = 'live_transcript' then (seconds_used::numeric / 60.0) * 0.017
        when kind = 'meeting_live' then (seconds_used::numeric / 60.0) * 0.034
        else 0 end)::numeric as cost_usd,
      0::bigint as tokens,
      sum(seconds_used)::numeric / 60.0 as audio_minutes
    from public.ana_timed_usage_sessions
    where started_at >= v_week_start and started_at < v_week_start + interval '7 days'
    group by 1
  ),
  features as (
    select feature, sum(cost_usd) as cost_usd, sum(tokens)::bigint as tokens, sum(audio_minutes) as audio_minutes
    from feature_rows group by feature order by sum(cost_usd) desc
  ),
  per_user as (
    select u.id as user_id, u.email,
           coalesce(e.cost_usd,0) + coalesce(s.cost_usd,0) as cost_usd,
           coalesce(e.tokens,0)::bigint as tokens,
           coalesce(s.audio_minutes,0) as audio_minutes
    from auth.users u
    left join (
      select user_id, sum(estimated_cost_usd)::numeric as cost_usd, sum(input_tokens + output_tokens)::bigint as tokens
      from public.ana_ai_usage_events
      where created_at >= v_week_start and created_at < v_week_start + interval '7 days'
      group by user_id
    ) e on e.user_id = u.id
    left join (
      select user_id,
             sum(case
               when kind = 'meeting_notes' then (seconds_used::numeric / 60.0) * 0.006
               when kind = 'meeting_live' and coalesce(metadata->>'feature','') = 'live_transcript' then (seconds_used::numeric / 60.0) * 0.017
               when kind = 'meeting_live' then (seconds_used::numeric / 60.0) * 0.034
               else 0 end)::numeric as cost_usd,
             sum(seconds_used)::numeric / 60.0 as audio_minutes
      from public.ana_timed_usage_sessions
      where started_at >= v_week_start and started_at < v_week_start + interval '7 days'
      group by user_id
    ) s on s.user_id = u.id
  )
  select jsonb_build_object(
    'weekStart', v_week_start,
    'weekEnd', v_week_start + interval '7 days',
    'summary', jsonb_build_object(
      'estimatedCostUsd', round((ts.token_cost_usd + ss.audio_cost_usd)::numeric,4),
      'tokenCostUsd', round(ts.token_cost_usd::numeric,4),
      'audioCostUsd', round(ss.audio_cost_usd::numeric,4),
      'inputTokens', ts.input_tokens,
      'cachedInputTokens', ts.cached_input_tokens,
      'outputTokens', ts.output_tokens,
      'totalTokens', ts.input_tokens + ts.output_tokens,
      'audioMinutes', round((ss.seconds::numeric / 60.0),1),
      'trackingStartedAt', ts.tracking_started_at
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'date', to_char(day_start at time zone 'Europe/Berlin','YYYY-MM-DD'),
      'costUsd', round(cost_usd::numeric,4),
      'tokens', tokens,
      'audioMinutes', round(audio_minutes::numeric,1)
    ) order by day_start) from daily),'[]'::jsonb),
    'features', coalesce((select jsonb_agg(jsonb_build_object(
      'feature',feature,'costUsd',round(cost_usd::numeric,4),'tokens',tokens,'audioMinutes',round(audio_minutes::numeric,1)
    )) from features),'[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
      'userId',user_id,'email',email,'costUsd',round(cost_usd::numeric,4),'tokens',tokens,'audioMinutes',round(audio_minutes::numeric,1)
    ) order by cost_usd desc) from per_user),'[]'::jsonb)
  ) into v_result
  from token_summary ts cross join timed_summary ss;

  return v_result;
end;
$$;

revoke all on function public.ana_admin_cost_report() from public;
grant execute on function public.ana_admin_cost_report() to authenticated;
