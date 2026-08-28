-- Follow-up ledger v3: additive schema and server-only state transitions.
-- Existing follow-up rows and public.reviews are intentionally untouched.

alter table public.followup_jobs
  add column if not exists review_started_at timestamptz,
  add column if not exists review_deadline_at timestamptz,
  add column if not exists next_action_at timestamptz,
  add column if not exists send_requested_at timestamptz,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists active_run_id uuid,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_owner text,
  add column if not exists lock_token uuid,
  add column if not exists lock_expires_at timestamptz,
  add column if not exists first_send_attempt_at timestamptz,
  add column if not exists send_attempt_count integer not null default 0,
  add column if not exists send_retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_failed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists held_at timestamptz,
  add column if not exists held_reason text,
  add column if not exists skipped_at timestamptz,
  add column if not exists skip_reason text,
  add column if not exists sent_at timestamptz,
  add column if not exists gmail_draft_id text,
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists send_idempotency_key text,
  add column if not exists attachment_asset_id text,
  add column if not exists rule_version text;

alter table public.followup_messages
  add column if not exists revision integer not null default 0,
  add column if not exists attachment_asset_id text,
  add column if not exists rule_version text;

alter table public.followup_activity_logs
  add column if not exists event_key text,
  add column if not exists source text,
  add column if not exists source_event_id text,
  add column if not exists occurred_at timestamptz,
  add column if not exists run_id uuid;

alter table public.followup_jobs drop constraint if exists followup_jobs_status_check;
alter table public.followup_jobs
  add constraint followup_jobs_status_check
  check (status in (
    'scheduled', 'awaiting_review', 'held', 'sending',
    'sent', 'canceled', 'skipped', 'failed',
    'draft_ready', 'approved'
  ));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'followup_jobs_send_counts_nonnegative'
      and conrelid = 'public.followup_jobs'::regclass
  ) then
    alter table public.followup_jobs
      add constraint followup_jobs_send_counts_nonnegative
      check (send_attempt_count >= 0 and send_retry_count >= 0);
  end if;
end $$;

create table if not exists public.followup_runtime (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  operation_mode text not null default 'observe'
    check (operation_mode in ('observe', 'draft_only', 'test_one', 'live')),
  send_locked boolean not null default true,
  missed_run_monitor_enabled boolean not null default false,
  test_email text,
  monitor_enabled_at timestamptz,
  expected_interval_minutes integer not null default 60
    check (expected_interval_minutes > 0),
  missed_after_minutes integer not null default 90
    check (missed_after_minutes > 0),
  current_run_id uuid,
  current_run_owner text,
  current_run_status text check (current_run_status in ('running', 'succeeded', 'failed')),
  last_run_started_at timestamptz,
  last_heartbeat_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  check (operation_mode <> 'test_one' or nullif(btrim(test_email), '') is not null)
);

insert into public.followup_runtime (singleton_id)
values (1)
on conflict (singleton_id) do nothing;

alter table public.followup_runtime enable row level security;
revoke all on table public.followup_runtime from public, anon, authenticated;
grant select, insert, update on table public.followup_runtime to service_role;

create unique index if not exists followup_messages_one_per_job_uidx
  on public.followup_messages (job_id);
create unique index if not exists followup_activity_event_key_uidx
  on public.followup_activity_logs (event_key)
  where event_key is not null;
create unique index if not exists followup_jobs_gmail_message_uidx
  on public.followup_jobs (gmail_message_id)
  where gmail_message_id is not null;
create unique index if not exists followup_jobs_send_idempotency_uidx
  on public.followup_jobs (send_idempotency_key)
  where send_idempotency_key is not null;
create index if not exists followup_jobs_due_idx
  on public.followup_jobs (status, next_action_at)
  where status in ('awaiting_review', 'sending');
create index if not exists followup_jobs_expired_lock_idx
  on public.followup_jobs (lock_expires_at)
  where status = 'sending' and lock_token is not null;
create index if not exists followup_activity_source_event_idx
  on public.followup_activity_logs (source, source_event_id)
  where source_event_id is not null;

create or replace function public.followup_log_event(
  p_job_id uuid,
  p_event text,
  p_event_key text,
  p_detail jsonb default '{}'::jsonb,
  p_run_id uuid default null,
  p_source text default 'ledger',
  p_source_event_id text default null,
  p_occurred_at timestamptz default now()
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(p_event), '') is null then
    raise exception 'event is required';
  end if;

  insert into public.followup_activity_logs (
    job_id, event, event_key, detail, run_id, source, source_event_id, occurred_at
  ) values (
    p_job_id, p_event, nullif(btrim(p_event_key), ''), coalesce(p_detail, '{}'::jsonb),
    p_run_id, nullif(btrim(p_source), ''), nullif(btrim(p_source_event_id), ''),
    coalesce(p_occurred_at, now())
  )
  on conflict do nothing;

  return found;
end;
$$;

create or replace function public.followup_set_runtime(
  p_operation_mode text,
  p_send_locked boolean,
  p_missed_run_monitor_enabled boolean,
  p_test_email text default null,
  p_expected_interval_minutes integer default 60,
  p_missed_after_minutes integer default 90
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.followup_runtime%rowtype;
begin
  if p_operation_mode not in ('observe', 'draft_only', 'test_one', 'live') then
    raise exception 'invalid operation mode: %', p_operation_mode;
  end if;
  if p_operation_mode = 'test_one' and nullif(btrim(p_test_email), '') is null then
    raise exception 'test_one mode requires a test email';
  end if;
  if p_expected_interval_minutes <= 0 or p_missed_after_minutes <= 0 then
    raise exception 'runtime intervals must be positive';
  end if;

  update public.followup_runtime
  set operation_mode = p_operation_mode,
      send_locked = p_send_locked,
      missed_run_monitor_enabled = p_missed_run_monitor_enabled,
      test_email = case when p_operation_mode = 'test_one' then lower(btrim(p_test_email)) else null end,
      monitor_enabled_at = case
        when p_missed_run_monitor_enabled and not missed_run_monitor_enabled then now()
        when not p_missed_run_monitor_enabled then null
        else monitor_enabled_at
      end,
      expected_interval_minutes = p_expected_interval_minutes,
      missed_after_minutes = p_missed_after_minutes,
      updated_at = now()
  where singleton_id = 1
  returning * into v_row;

  if not found then
    raise exception 'followup runtime row is missing';
  end if;

  perform public.followup_log_event(
    null, 'runtime_configured', null,
    jsonb_build_object(
      'operation_mode', v_row.operation_mode,
      'send_locked', v_row.send_locked,
      'monitor_enabled', v_row.missed_run_monitor_enabled
    )
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.followup_start_run(
  p_run_id uuid,
  p_owner text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
begin
  if p_run_id is null or nullif(btrim(p_owner), '') is null then
    raise exception 'run id and owner are required';
  end if;

  select * into v_runtime
  from public.followup_runtime
  where singleton_id = 1
  for update;

  if v_runtime.current_run_status = 'running'
     and v_runtime.current_run_id is distinct from p_run_id
     and coalesce(v_runtime.last_heartbeat_at, v_runtime.last_run_started_at)
         > now() - make_interval(mins => v_runtime.missed_after_minutes) then
    raise exception 'another followup run is still active';
  end if;

  update public.followup_runtime
  set current_run_id = p_run_id,
      current_run_owner = btrim(p_owner),
      current_run_status = 'running',
      last_run_started_at = case
        when current_run_id = p_run_id and current_run_status = 'running'
          then last_run_started_at
        else now()
      end,
      last_heartbeat_at = now(),
      last_error = null,
      updated_at = now()
  where singleton_id = 1
  returning * into v_runtime;

  perform public.followup_log_event(
    null, 'run_started', 'run:' || p_run_id::text || ':started',
    jsonb_build_object('owner', btrim(p_owner)), p_run_id
  );
  return to_jsonb(v_runtime);
end;
$$;

create or replace function public.followup_heartbeat_run(
  p_run_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
begin
  update public.followup_runtime
  set last_heartbeat_at = now(), updated_at = now()
  where singleton_id = 1
    and current_run_id = p_run_id
    and current_run_status = 'running'
  returning * into v_runtime;

  if not found then
    raise exception 'run is not active';
  end if;
  return to_jsonb(v_runtime);
end;
$$;

create or replace function public.followup_finish_run(
  p_run_id uuid,
  p_success boolean,
  p_error text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
begin
  if not p_success and nullif(btrim(p_error), '') is null then
    raise exception 'failed run requires an error';
  end if;

  update public.followup_runtime
  set current_run_status = case when p_success then 'succeeded' else 'failed' end,
      last_heartbeat_at = now(),
      last_success_at = case when p_success then now() else last_success_at end,
      last_failure_at = case when p_success then last_failure_at else now() end,
      last_error = case when p_success then null else btrim(p_error) end,
      updated_at = now()
  where singleton_id = 1
    and current_run_id = p_run_id
    and current_run_status = 'running'
  returning * into v_runtime;

  if not found then
    raise exception 'run is not active';
  end if;

  perform public.followup_log_event(
    null,
    case when p_success then 'run_succeeded' else 'run_failed' end,
    'run:' || p_run_id::text || ':finished',
    jsonb_build_object('error', case when p_success then null else btrim(p_error) end),
    p_run_id
  );
  return to_jsonb(v_runtime);
end;
$$;

create or replace function public.followup_detect_missed_run(
  p_at timestamptz default now()
) returns table (
  monitor_enabled boolean,
  missed boolean,
  last_signal_at timestamptz,
  late_by interval
)
language sql
stable
set search_path = ''
as $$
  select
    r.missed_run_monitor_enabled,
    case
      when not r.missed_run_monitor_enabled then false
      else coalesce(greatest(r.last_heartbeat_at, r.last_success_at, r.monitor_enabled_at), '-infinity'::timestamptz)
           < p_at - make_interval(mins => r.missed_after_minutes)
    end,
    greatest(r.last_heartbeat_at, r.last_success_at, r.monitor_enabled_at),
    case
      when not r.missed_run_monitor_enabled then interval '0'
      else greatest(
        interval '0',
        p_at - coalesce(greatest(r.last_heartbeat_at, r.last_success_at, r.monitor_enabled_at), p_at)
          - make_interval(mins => r.missed_after_minutes)
      )
    end
  from public.followup_runtime r
  where r.singleton_id = 1;
$$;

drop index if exists public.followup_activity_source_event_idx;
create unique index if not exists followup_activity_source_event_uidx
  on public.followup_activity_logs (source, source_event_id)
  where source is not null and source_event_id is not null;

create or replace function public.followup_save_draft(
  p_job_id uuid,
  p_request_id uuid,
  p_subject text,
  p_body text,
  p_attachment_asset_id text,
  p_rule_version text,
  p_run_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':draft:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null then
    raise exception 'job id and request id are required';
  end if;
  if nullif(btrim(p_subject), '') is null or nullif(btrim(p_body), '') is null then
    raise exception 'subject and body are required';
  end if;
  if nullif(btrim(p_rule_version), '') is null then
    raise exception 'rule version is required';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;

  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'draft can only be saved from scheduled';
  end if;

  insert into public.followup_messages (
    job_id, subject, body, review_status, attachment_asset_id, rule_version, revision
  ) values (
    p_job_id, p_subject, p_body, 'pending', nullif(btrim(p_attachment_asset_id), ''),
    btrim(p_rule_version), 1
  )
  on conflict (job_id) do update
    set subject = excluded.subject,
        body = excluded.body,
        review_status = 'pending',
        attachment_asset_id = excluded.attachment_asset_id,
        rule_version = excluded.rule_version,
        revision = greatest(public.followup_messages.revision, 0) + 1,
        updated_at = now();

  update public.followup_jobs
  set status = 'awaiting_review',
      review_started_at = now(),
      review_deadline_at = now() + interval '1 hour',
      next_action_at = now() + interval '1 hour',
      attachment_asset_id = nullif(btrim(p_attachment_asset_id), ''),
      rule_version = btrim(p_rule_version),
      active_run_id = p_run_id,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'draft_saved', v_key,
    jsonb_build_object('review_deadline_at', v_job.review_deadline_at), p_run_id
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_save_revision(
  p_job_id uuid,
  p_request_id uuid,
  p_subject text,
  p_body text,
  p_attachment_asset_id text,
  p_rule_version text,
  p_editor text default 'representative'
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':revision:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null then
    raise exception 'job id and request id are required';
  end if;
  if nullif(btrim(p_subject), '') is null or nullif(btrim(p_body), '') is null then
    raise exception 'subject and body are required';
  end if;
  if nullif(btrim(p_rule_version), '') is null or nullif(btrim(p_editor), '') is null then
    raise exception 'rule version and editor are required';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'awaiting_review' then
    raise exception 'revision can only be saved during review';
  end if;

  update public.followup_messages
  set subject = p_subject,
      body = p_body,
      review_status = 'edited',
      attachment_asset_id = nullif(btrim(p_attachment_asset_id), ''),
      rule_version = btrim(p_rule_version),
      edited_by = btrim(p_editor),
      revision = greatest(revision, 0) + 1,
      updated_at = now()
  where job_id = p_job_id;
  if not found then raise exception 'message slot is missing'; end if;

  update public.followup_jobs
  set review_started_at = now(),
      review_deadline_at = now() + interval '1 hour',
      next_action_at = now() + interval '1 hour',
      send_requested_at = null,
      attachment_asset_id = nullif(btrim(p_attachment_asset_id), ''),
      rule_version = btrim(p_rule_version),
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'revision_saved', v_key,
    jsonb_build_object('review_deadline_at', v_job.review_deadline_at)
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_cancel_job(
  p_job_id uuid,
  p_request_id uuid,
  p_reason text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':cancel:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'job id, request id and reason are required';
  end if;
  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status not in ('scheduled', 'awaiting_review', 'held') then
    raise exception 'job cannot be canceled from status %', v_job.status;
  end if;

  update public.followup_jobs
  set status = 'canceled',
      cancel_requested_at = now(),
      canceled_at = now(),
      cancel_reason = btrim(p_reason),
      next_action_at = null,
      next_retry_at = null,
      active_run_id = null,
      locked_at = null,
      lock_owner = null,
      lock_token = null,
      lock_expires_at = null,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'job_canceled', v_key,
    jsonb_build_object('reason', btrim(p_reason))
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_request_send_now(
  p_job_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':send-request:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null then
    raise exception 'job id and request id are required';
  end if;
  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'awaiting_review' then
    raise exception 'send can only be requested during review';
  end if;

  update public.followup_jobs
  set send_requested_at = now(), next_action_at = now(), updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(p_job_id, 'send_requested', v_key, '{}'::jsonb);
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_skip_stale_job(
  p_job_id uuid,
  p_request_id uuid,
  p_reason text,
  p_run_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':skip:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'job id, request id and reason are required';
  end if;
  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'only scheduled jobs can be skipped as stale';
  end if;
  if exists (select 1 from public.followup_messages where job_id = p_job_id) then
    raise exception 'stale job already has message content';
  end if;

  update public.followup_jobs
  set status = 'skipped',
      skipped_at = now(),
      skip_reason = btrim(p_reason),
      next_action_at = null,
      attachment_asset_id = null,
      active_run_id = p_run_id,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'job_skipped', v_key,
    jsonb_build_object('reason', btrim(p_reason)), p_run_id
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_record_activity(
  p_job_id uuid,
  p_event text,
  p_source text,
  p_source_event_id text,
  p_occurred_at timestamptz,
  p_detail jsonb default '{}'::jsonb,
  p_run_id uuid default null
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
begin
  if nullif(btrim(p_event), '') is null
     or nullif(btrim(p_source), '') is null
     or nullif(btrim(p_source_event_id), '') is null then
    raise exception 'event, source and source event id are required';
  end if;
  if p_job_id is not null and not exists (
    select 1 from public.followup_jobs where id = p_job_id
  ) then
    raise exception 'job not found';
  end if;

  v_key := 'source:' || btrim(p_source) || ':' || btrim(p_source_event_id);
  return public.followup_log_event(
    p_job_id, btrim(p_event), v_key, coalesce(p_detail, '{}'::jsonb), p_run_id,
    btrim(p_source), btrim(p_source_event_id), coalesce(p_occurred_at, now())
  );
end;
$$;

create or replace function public.followup_claim_send(
  p_job_id uuid,
  p_run_id uuid,
  p_lock_owner text,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
  v_job public.followup_jobs%rowtype;
  v_token uuid;
begin
  if p_job_id is null or p_run_id is null or nullif(btrim(p_lock_owner), '') is null then
    raise exception 'job id, run id and lock owner are required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'lease must be between 30 and 1800 seconds';
  end if;

  select * into v_runtime
  from public.followup_runtime
  where singleton_id = 1
  for update;

  if v_runtime.send_locked then
    raise exception 'followup sending is globally locked';
  end if;
  if v_runtime.operation_mode in ('observe', 'draft_only') then
    raise exception 'operation mode does not allow sending';
  end if;

  select * into v_job
  from public.followup_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'job not found'; end if;

  if v_runtime.operation_mode = 'test_one'
     and lower(btrim(v_job.email)) <> lower(btrim(v_runtime.test_email)) then
    raise exception 'job email is not the configured test email';
  end if;

  if v_job.status = 'sending'
     and v_job.active_run_id = p_run_id
     and v_job.lock_owner = btrim(p_lock_owner)
     and v_job.lock_token is not null
     and v_job.lock_expires_at > now() then
    return to_jsonb(v_job);
  end if;

  if v_job.status = 'awaiting_review' then
    if v_job.send_requested_at is null
       and (v_job.review_deadline_at is null or v_job.review_deadline_at > now()) then
      raise exception 'review period has not ended';
    end if;
  elsif v_job.status = 'sending' then
    if v_job.lock_token is not null then
      raise exception 'sending lock requires Gmail reconciliation before retry';
    end if;
    if v_job.next_retry_at is null or v_job.next_retry_at > now() then
      raise exception 'retry is not due';
    end if;
  else
    raise exception 'job cannot be claimed from status %', v_job.status;
  end if;

  if v_job.send_attempt_count >= 4 then
    raise exception 'maximum send attempts reached';
  end if;
  if not exists (select 1 from public.followup_messages where job_id = p_job_id) then
    raise exception 'message slot is missing';
  end if;

  v_token := gen_random_uuid();
  update public.followup_jobs
  set status = 'sending',
      active_run_id = p_run_id,
      locked_at = now(),
      lock_owner = btrim(p_lock_owner),
      lock_token = v_token,
      lock_expires_at = now() + make_interval(secs => p_lease_seconds),
      first_send_attempt_at = coalesce(first_send_attempt_at, now()),
      send_retry_count = case when send_attempt_count = 0 then send_retry_count else send_retry_count + 1 end,
      send_attempt_count = send_attempt_count + 1,
      next_retry_at = null,
      next_action_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'send_claimed', 'job:' || p_job_id::text || ':claim:' || v_token::text,
    jsonb_build_object('attempt', v_job.send_attempt_count, 'lock_expires_at', v_job.lock_expires_at),
    p_run_id
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_prepare_gmail_send(
  p_job_id uuid,
  p_lock_token uuid,
  p_gmail_draft_id text,
  p_send_idempotency_key text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
begin
  if p_job_id is null or p_lock_token is null
     or nullif(btrim(p_gmail_draft_id), '') is null
     or nullif(btrim(p_send_idempotency_key), '') is null then
    raise exception 'job, lock, Gmail draft and idempotency key are required';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status <> 'sending' or v_job.lock_token is distinct from p_lock_token then
    raise exception 'send lock does not match';
  end if;
  if v_job.lock_expires_at <= now() then
    raise exception 'send lock has expired';
  end if;
  if v_job.gmail_draft_id is not null
     and v_job.gmail_draft_id <> btrim(p_gmail_draft_id) then
    raise exception 'Gmail draft id is already fixed';
  end if;
  if v_job.send_idempotency_key is not null
     and v_job.send_idempotency_key <> btrim(p_send_idempotency_key) then
    raise exception 'send idempotency key is already fixed';
  end if;

  update public.followup_jobs
  set gmail_draft_id = btrim(p_gmail_draft_id),
      send_idempotency_key = btrim(p_send_idempotency_key),
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'gmail_send_prepared',
    'job:' || p_job_id::text || ':gmail-prepared:' || btrim(p_send_idempotency_key),
    jsonb_build_object('gmail_draft_id', btrim(p_gmail_draft_id)), v_job.active_run_id
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_mark_sent(
  p_job_id uuid,
  p_lock_token uuid,
  p_gmail_message_id text,
  p_gmail_thread_id text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
begin
  if p_job_id is null or p_lock_token is null
     or nullif(btrim(p_gmail_message_id), '') is null
     or nullif(btrim(p_gmail_thread_id), '') is null then
    raise exception 'job, lock, Gmail message and thread are required';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status = 'sent' then
    if v_job.gmail_message_id = btrim(p_gmail_message_id)
       and v_job.gmail_thread_id = btrim(p_gmail_thread_id) then
      return to_jsonb(v_job);
    end if;
    raise exception 'job was already sent with different Gmail ids';
  end if;
  if v_job.status <> 'sending' or v_job.lock_token is distinct from p_lock_token then
    raise exception 'send lock does not match';
  end if;
  if v_job.gmail_draft_id is null or v_job.send_idempotency_key is null then
    raise exception 'Gmail send was not prepared';
  end if;

  update public.followup_jobs
  set status = 'sent',
      sent_at = now(),
      gmail_message_id = btrim(p_gmail_message_id),
      gmail_thread_id = btrim(p_gmail_thread_id),
      next_action_at = null,
      next_retry_at = null,
      last_error = null,
      active_run_id = null,
      locked_at = null,
      lock_owner = null,
      lock_token = null,
      lock_expires_at = null,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'send_succeeded',
    'gmail-message:' || btrim(p_gmail_message_id),
    jsonb_build_object('gmail_thread_id', btrim(p_gmail_thread_id))
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_mark_send_failure(
  p_job_id uuid,
  p_request_id uuid,
  p_lock_token uuid,
  p_error text,
  p_permanent boolean,
  p_next_retry_at timestamptz default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_final boolean;
  v_key text := 'job:' || p_job_id::text || ':send-failure:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or p_lock_token is null
     or nullif(btrim(p_error), '') is null then
    raise exception 'job, request, lock and error are required';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'sending' or v_job.lock_token is distinct from p_lock_token then
    raise exception 'send lock does not match';
  end if;

  v_final := p_permanent or v_job.send_attempt_count >= 4;
  if not v_final and (p_next_retry_at is null or p_next_retry_at <= now()) then
    raise exception 'temporary failure requires a future retry time';
  end if;

  update public.followup_jobs
  set status = case when v_final then 'failed' else 'sending' end,
      failed_at = case when v_final then now() else failed_at end,
      last_error = btrim(p_error),
      last_failed_at = now(),
      next_retry_at = case when v_final then null else p_next_retry_at end,
      next_action_at = case when v_final then null else p_next_retry_at end,
      active_run_id = null,
      locked_at = null,
      lock_owner = null,
      lock_token = null,
      lock_expires_at = null,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id,
    case when v_final then 'send_failed_final' else 'send_failed_temporary' end,
    v_key,
    jsonb_build_object(
      'error', btrim(p_error), 'attempt', v_job.send_attempt_count,
      'next_retry_at', v_job.next_retry_at
    )
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_list_expired_locks(
  p_at timestamptz default now()
) returns table (
  job_id uuid,
  lock_token uuid,
  lock_owner text,
  lock_expires_at timestamptz,
  gmail_draft_id text,
  send_idempotency_key text
)
language sql
stable
set search_path = ''
as $$
  select j.id, j.lock_token, j.lock_owner, j.lock_expires_at,
         j.gmail_draft_id, j.send_idempotency_key
  from public.followup_jobs j
  where j.status = 'sending'
    and j.lock_token is not null
    and j.lock_expires_at <= p_at
  order by j.lock_expires_at, j.id;
$$;

create or replace function public.followup_hold_uncertain_send(
  p_job_id uuid,
  p_request_id uuid,
  p_reason text,
  p_expected_lock_token uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':uncertain:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'job, request and reason are required';
  end if;
  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'sending' then
    raise exception 'only sending jobs can be held as uncertain';
  end if;
  if p_expected_lock_token is not null
     and v_job.lock_token is distinct from p_expected_lock_token then
    raise exception 'send lock does not match';
  end if;

  update public.followup_jobs
  set status = 'held',
      held_at = now(),
      held_reason = btrim(p_reason),
      next_action_at = null,
      next_retry_at = null,
      active_run_id = null,
      locked_at = null,
      lock_owner = null,
      lock_token = null,
      lock_expires_at = null,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'send_held_uncertain', v_key,
    jsonb_build_object('reason', btrim(p_reason), 'automatic_resend_allowed', false)
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_hold_job(
  p_job_id uuid,
  p_request_id uuid,
  p_reason text,
  p_run_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':hold:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'job, request and reason are required';
  end if;
  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status not in ('scheduled', 'awaiting_review') then
    raise exception 'job cannot be held from status %', v_job.status;
  end if;

  update public.followup_jobs
  set status = 'held',
      held_at = now(),
      held_reason = btrim(p_reason),
      next_action_at = null,
      active_run_id = p_run_id,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'job_held', v_key,
    jsonb_build_object('reason', btrim(p_reason)), p_run_id
  );
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.followup_log_event(uuid,text,text,jsonb,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.followup_set_runtime(text,boolean,boolean,text,integer,integer) from public, anon, authenticated;
revoke all on function public.followup_start_run(uuid,text) from public, anon, authenticated;
revoke all on function public.followup_heartbeat_run(uuid) from public, anon, authenticated;
revoke all on function public.followup_finish_run(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.followup_detect_missed_run(timestamptz) from public, anon, authenticated;
revoke all on function public.followup_save_draft(uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.followup_save_revision(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.followup_cancel_job(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.followup_request_send_now(uuid,uuid) from public, anon, authenticated;
revoke all on function public.followup_skip_stale_job(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.followup_record_activity(uuid,text,text,text,timestamptz,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.followup_claim_send(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.followup_prepare_gmail_send(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.followup_mark_sent(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.followup_mark_send_failure(uuid,uuid,uuid,text,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.followup_list_expired_locks(timestamptz) from public, anon, authenticated;
revoke all on function public.followup_hold_uncertain_send(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.followup_hold_job(uuid,uuid,text,uuid) from public, anon, authenticated;

grant execute on function public.followup_log_event(uuid,text,text,jsonb,uuid,text,text,timestamptz) to service_role;
grant execute on function public.followup_set_runtime(text,boolean,boolean,text,integer,integer) to service_role;
grant execute on function public.followup_start_run(uuid,text) to service_role;
grant execute on function public.followup_heartbeat_run(uuid) to service_role;
grant execute on function public.followup_finish_run(uuid,boolean,text) to service_role;
grant execute on function public.followup_detect_missed_run(timestamptz) to service_role;
grant execute on function public.followup_save_draft(uuid,uuid,text,text,text,text,uuid) to service_role;
grant execute on function public.followup_save_revision(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.followup_cancel_job(uuid,uuid,text) to service_role;
grant execute on function public.followup_request_send_now(uuid,uuid) to service_role;
grant execute on function public.followup_skip_stale_job(uuid,uuid,text,uuid) to service_role;
grant execute on function public.followup_record_activity(uuid,text,text,text,timestamptz,jsonb,uuid) to service_role;
grant execute on function public.followup_claim_send(uuid,uuid,text,integer) to service_role;
grant execute on function public.followup_prepare_gmail_send(uuid,uuid,text,text) to service_role;
grant execute on function public.followup_mark_sent(uuid,uuid,text,text) to service_role;
grant execute on function public.followup_mark_send_failure(uuid,uuid,uuid,text,boolean,timestamptz) to service_role;
grant execute on function public.followup_list_expired_locks(timestamptz) to service_role;
grant execute on function public.followup_hold_uncertain_send(uuid,uuid,text,uuid) to service_role;
grant execute on function public.followup_hold_job(uuid,uuid,text,uuid) to service_role;
