-- Follow-up ledger v3 completion: confirmed operating-window, held-release,
-- activity cancellation, and server-only table grants.

alter table public.followup_messages
  add column if not exists validation_evidence jsonb,
  add column if not exists validation_passed_at timestamptz;

create or replace function public.followup_next_allowed_at(
  p_at timestamptz
) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp;
  v_date date;
  v_time time;
begin
  if p_at is null then return null; end if;
  v_local := p_at at time zone 'Asia/Seoul';
  v_date := v_local::date;
  v_time := v_local::time;

  if v_time < time '07:00' then
    return (v_date + time '07:00') at time zone 'Asia/Seoul';
  elsif v_time > time '23:00' then
    return ((v_date + 1) + time '07:00') at time zone 'Asia/Seoul';
  end if;
  return p_at;
end;
$$;

create or replace function public.followup_normalize_action_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.review_deadline_at := public.followup_next_allowed_at(new.review_deadline_at);
  new.next_action_at := public.followup_next_allowed_at(new.next_action_at);
  new.next_retry_at := public.followup_next_allowed_at(new.next_retry_at);
  return new;
end;
$$;

drop trigger if exists followup_jobs_normalize_action_times on public.followup_jobs;
create trigger followup_jobs_normalize_action_times
before insert or update of review_deadline_at, next_action_at, next_retry_at
on public.followup_jobs
for each row execute function public.followup_normalize_action_times();

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

  select * into v_runtime from public.followup_runtime
  where singleton_id = 1 for update;
  if v_runtime.send_locked then raise exception 'followup sending is globally locked'; end if;
  if v_runtime.operation_mode in ('observe', 'draft_only') then
    raise exception 'operation mode does not allow sending';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
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
    if v_job.next_action_at is null or v_job.next_action_at > now() then
      raise exception 'send is not due in the allowed operating window';
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

  if v_job.send_attempt_count >= 4 then raise exception 'maximum send attempts reached'; end if;
  if not exists (select 1 from public.followup_messages where job_id = p_job_id) then
    raise exception 'message slot is missing';
  end if;

  v_token := gen_random_uuid();
  update public.followup_jobs
  set status = 'sending', active_run_id = p_run_id, locked_at = now(),
      lock_owner = btrim(p_lock_owner), lock_token = v_token,
      lock_expires_at = now() + make_interval(secs => p_lease_seconds),
      first_send_attempt_at = coalesce(first_send_attempt_at, now()),
      send_retry_count = case when send_attempt_count = 0 then send_retry_count else send_retry_count + 1 end,
      send_attempt_count = send_attempt_count + 1,
      next_retry_at = null, next_action_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_job_id returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'send_claimed', 'job:' || p_job_id::text || ':claim:' || v_token::text,
    jsonb_build_object('attempt', v_job.send_attempt_count, 'lock_expires_at', v_job.lock_expires_at),
    p_run_id
  );
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_release_held_revision(
  p_job_id uuid,
  p_request_id uuid,
  p_subject text,
  p_body text,
  p_attachment_asset_id text,
  p_rule_version text,
  p_validation_evidence jsonb,
  p_editor text default 'representative'
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:' || p_job_id::text || ':held-release:' || p_request_id::text;
  v_checked_at timestamptz;
begin
  if p_job_id is null or p_request_id is null
     or nullif(btrim(p_subject), '') is null or nullif(btrim(p_body), '') is null
     or nullif(btrim(p_rule_version), '') is null or nullif(btrim(p_editor), '') is null then
    raise exception 'job, request, content, rule version and editor are required';
  end if;
  if jsonb_typeof(p_validation_evidence) <> 'object'
     or not (p_validation_evidence @> '{"passed":true}'::jsonb)
     or nullif(p_validation_evidence->>'checked_at', '') is null
     or p_validation_evidence->>'rule_version' <> btrim(p_rule_version) then
    raise exception 'matching passed validation evidence is required';
  end if;
  begin
    v_checked_at := (p_validation_evidence->>'checked_at')::timestamptz;
  exception when others then
    raise exception 'validation checked_at must be a timestamp';
  end;
  if v_checked_at > now() + interval '5 minutes' then
    raise exception 'validation checked_at cannot be in the future';
  end if;

  select * into v_job from public.followup_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (select 1 from public.followup_activity_logs where event_key=v_key and job_id=p_job_id) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'held' then raise exception 'only held jobs can use this path'; end if;

  insert into public.followup_messages (
    job_id, subject, body, review_status, edited_by, attachment_asset_id,
    rule_version, revision, validation_evidence, validation_passed_at
  ) values (
    p_job_id, p_subject, p_body, 'edited', btrim(p_editor),
    nullif(btrim(p_attachment_asset_id), ''), btrim(p_rule_version), 1,
    p_validation_evidence, v_checked_at
  )
  on conflict (job_id) do update
  set subject=excluded.subject, body=excluded.body, review_status='edited',
      edited_by=excluded.edited_by, attachment_asset_id=excluded.attachment_asset_id,
      rule_version=excluded.rule_version,
      revision=greatest(public.followup_messages.revision,0)+1,
      validation_evidence=excluded.validation_evidence,
      validation_passed_at=excluded.validation_passed_at,
      updated_at=now();

  update public.followup_jobs
  set status='awaiting_review', review_started_at=now(),
      review_deadline_at=now()+interval '1 hour', next_action_at=now()+interval '1 hour',
      send_requested_at=null, attachment_asset_id=nullif(btrim(p_attachment_asset_id),''),
      rule_version=btrim(p_rule_version), updated_at=now()
  where id=p_job_id returning * into v_job;

  perform public.followup_log_event(
    p_job_id, 'held_revision_released', v_key,
    jsonb_build_object('validation',p_validation_evidence,'review_deadline_at',v_job.review_deadline_at)
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
  v_inserted boolean;
  v_application_id uuid;
begin
  if nullif(btrim(p_event), '') is null or nullif(btrim(p_source), '') is null
     or nullif(btrim(p_source_event_id), '') is null then
    raise exception 'event, source and source event id are required';
  end if;
  if p_job_id is not null then
    select application_id into v_application_id
    from public.followup_jobs where id=p_job_id for update;
    if not found then raise exception 'job not found'; end if;
  end if;

  v_key := 'source:' || btrim(p_source) || ':' || btrim(p_source_event_id);
  v_inserted := public.followup_log_event(
    p_job_id,btrim(p_event),v_key,coalesce(p_detail,'{}'::jsonb),p_run_id,
    btrim(p_source),btrim(p_source_event_id),coalesce(p_occurred_at,now())
  );
  if not v_inserted or p_job_id is null
     or btrim(p_event) not in ('reply','application','analysis_consent','contract_consent','payment') then
    return v_inserted;
  end if;

  if btrim(p_event)='reply' then
    update public.followup_jobs
    set status='canceled', cancel_requested_at=now(), canceled_at=now(),
        cancel_reason='activity:reply', next_action_at=null, next_retry_at=null,
        active_run_id=null, locked_at=null, lock_owner=null, lock_token=null,
        lock_expires_at=null, updated_at=now()
    where application_id=v_application_id and status in ('scheduled','awaiting_review','held');
  else
    update public.followup_jobs
    set status='canceled', cancel_requested_at=now(), canceled_at=now(),
        cancel_reason='activity:'||btrim(p_event), next_action_at=null, next_retry_at=null,
        active_run_id=null, locked_at=null, lock_owner=null, lock_token=null,
        lock_expires_at=null, updated_at=now()
    where id=p_job_id and status in ('scheduled','awaiting_review','held');
  end if;
  return true;
end;
$$;

revoke all on table public.followup_jobs from public, anon, authenticated;
revoke all on table public.followup_messages from public, anon, authenticated;
revoke all on table public.followup_activity_logs from public, anon, authenticated;
revoke all on table public.followup_suppressions from public, anon, authenticated;

grant select, insert, update on table public.followup_jobs to service_role;
grant select, insert, update on table public.followup_messages to service_role;
grant select, insert on table public.followup_activity_logs to service_role;
grant select, insert, update on table public.followup_suppressions to service_role;

revoke all on function public.followup_next_allowed_at(timestamptz) from public, anon, authenticated;
revoke all on function public.followup_normalize_action_times() from public, anon, authenticated;
revoke all on function public.followup_release_held_revision(uuid,uuid,text,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.followup_record_activity(uuid,text,text,text,timestamptz,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.followup_claim_send(uuid,uuid,text,integer) from public, anon, authenticated;

grant execute on function public.followup_next_allowed_at(timestamptz) to service_role;
grant execute on function public.followup_normalize_action_times() to service_role;
grant execute on function public.followup_release_held_revision(uuid,uuid,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.followup_record_activity(uuid,text,text,text,timestamptz,jsonb,uuid) to service_role;
grant execute on function public.followup_claim_send(uuid,uuid,text,integer) to service_role;
