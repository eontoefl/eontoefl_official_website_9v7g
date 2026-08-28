-- Follow-up ledger v3 completion 4: close the remaining operating-window,
-- expired-lock, activity-routing, and legacy-status gaps found by cold eyes.

alter table public.followup_jobs
  add column if not exists held_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'followup_jobs_held_kind_check'
      and conrelid = 'public.followup_jobs'::regclass
  ) then
    alter table public.followup_jobs
      add constraint followup_jobs_held_kind_check
      check (held_kind is null or held_kind in ('validation','send_uncertain','activity_during_sending'));
  end if;
end $$;

create or replace function public.followup_is_operating_time(
  p_at timestamptz
) returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_at is null then false
    else (p_at at time zone 'Asia/Seoul')::time >= time '07:00'
     and (p_at at time zone 'Asia/Seoul')::time <= time '23:00'
  end;
$$;

create or replace function public.followup_block_new_legacy_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('draft_ready','approved')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'legacy status % is read-only; use one of the eight current statuses', new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists followup_jobs_block_new_legacy_status on public.followup_jobs;
create trigger followup_jobs_block_new_legacy_status
before insert or update of status on public.followup_jobs
for each row execute function public.followup_block_new_legacy_status();

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
  if not public.followup_is_operating_time(now()) then
    raise exception 'sending is closed outside 07:00-23:00 Asia/Seoul';
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
      held_kind = null, held_at = null, held_reason = null,
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
  if exists (select 1 from public.followup_activity_logs where event_key=v_key and job_id=p_job_id) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'sending' or v_job.lock_token is distinct from p_lock_token then
    raise exception 'send lock does not match';
  end if;
  if v_job.lock_expires_at is null or v_job.lock_expires_at <= now() then
    raise exception 'send lock expired; Gmail reconciliation is required';
  end if;

  v_final := p_permanent or v_job.send_attempt_count >= 4;
  if not v_final and (p_next_retry_at is null or p_next_retry_at <= now()) then
    raise exception 'temporary failure requires a future retry time';
  end if;

  update public.followup_jobs
  set status = case when v_final then 'failed' else 'sending' end,
      failed_at = case when v_final then now() else failed_at end,
      last_error = btrim(p_error), last_failed_at = now(),
      next_retry_at = case when v_final then null else p_next_retry_at end,
      next_action_at = case when v_final then null else p_next_retry_at end,
      active_run_id = null, locked_at = null, lock_owner = null,
      lock_token = null, lock_expires_at = null, updated_at = now()
  where id = p_job_id returning * into v_job;

  perform public.followup_log_event(
    p_job_id, case when v_final then 'send_failed_final' else 'send_failed_temporary' end,
    v_key, jsonb_build_object('error',btrim(p_error),'attempt',v_job.send_attempt_count,
                              'next_retry_at',v_job.next_retry_at)
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
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (select 1 from public.followup_activity_logs where event_key=v_key and job_id=p_job_id) then
    return to_jsonb(v_job);
  end if;
  if v_job.status not in ('scheduled','awaiting_review') then
    raise exception 'job cannot be held from status %', v_job.status;
  end if;
  update public.followup_jobs
  set status='held', held_at=now(), held_kind='validation', held_reason=btrim(p_reason),
      next_action_at=null, active_run_id=p_run_id, updated_at=now()
  where id=p_job_id returning * into v_job;
  perform public.followup_log_event(p_job_id,'job_held',v_key,
    jsonb_build_object('reason',btrim(p_reason),'held_kind','validation'),p_run_id);
  return to_jsonb(v_job);
end;
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
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (select 1 from public.followup_activity_logs where event_key=v_key and job_id=p_job_id) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'sending' then raise exception 'only sending jobs can be held as uncertain'; end if;
  if p_expected_lock_token is not null and v_job.lock_token is distinct from p_expected_lock_token then
    raise exception 'send lock does not match';
  end if;
  update public.followup_jobs
  set status='held', held_at=now(), held_kind='send_uncertain', held_reason=btrim(p_reason),
      next_action_at=null, next_retry_at=null, active_run_id=null, locked_at=null,
      lock_owner=null, lock_token=null, lock_expires_at=null, updated_at=now()
  where id=p_job_id returning * into v_job;
  perform public.followup_log_event(p_job_id,'send_held_uncertain',v_key,
    jsonb_build_object('reason',btrim(p_reason),'automatic_resend_allowed',false));
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
  v_content_hash text := md5(p_subject || E'\n' || p_body);
begin
  if p_job_id is null or p_request_id is null
     or nullif(btrim(p_subject),'') is null or nullif(btrim(p_body),'') is null
     or nullif(btrim(p_rule_version),'') is null or nullif(btrim(p_editor),'') is null then
    raise exception 'job, request, content, rule version and editor are required';
  end if;
  if p_validation_evidence is null
     or jsonb_typeof(p_validation_evidence)<>'object'
     or not (p_validation_evidence @> '{"passed":true}'::jsonb)
     or nullif(p_validation_evidence->>'checked_at','') is null
     or p_validation_evidence->>'rule_version'<>btrim(p_rule_version)
     or p_validation_evidence->>'content_hash'<>v_content_hash then
    raise exception 'matching passed validation evidence is required';
  end if;
  begin v_checked_at:=(p_validation_evidence->>'checked_at')::timestamptz;
  exception when others then raise exception 'validation checked_at must be a timestamp'; end;
  if v_checked_at<now()-interval '15 minutes' or v_checked_at>now()+interval '1 minute' then
    raise exception 'validation evidence must be checked within the last 15 minutes';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (select 1 from public.followup_activity_logs where event_key=v_key and job_id=p_job_id) then
    return to_jsonb(v_job);
  end if;
  if v_job.status<>'held' then raise exception 'only held jobs can use this path'; end if;
  if v_job.held_kind in ('send_uncertain','activity_during_sending') then
    raise exception 'Gmail reconciliation is required before this hold can be released';
  end if;

  insert into public.followup_messages(job_id,subject,body,review_status,edited_by,
    attachment_asset_id,rule_version,revision,validation_evidence,validation_passed_at)
  values(p_job_id,p_subject,p_body,'edited',btrim(p_editor),nullif(btrim(p_attachment_asset_id),''),
    btrim(p_rule_version),1,p_validation_evidence,v_checked_at)
  on conflict(job_id) do update set subject=excluded.subject,body=excluded.body,
    review_status='edited',edited_by=excluded.edited_by,
    attachment_asset_id=excluded.attachment_asset_id,rule_version=excluded.rule_version,
    revision=greatest(public.followup_messages.revision,0)+1,
    validation_evidence=excluded.validation_evidence,
    validation_passed_at=excluded.validation_passed_at,updated_at=now();

  update public.followup_jobs
  set status='awaiting_review',review_started_at=now(),review_deadline_at=now()+interval '1 hour',
      next_action_at=now()+interval '1 hour',send_requested_at=null,
      attachment_asset_id=nullif(btrim(p_attachment_asset_id),''),rule_version=btrim(p_rule_version),
      held_kind=null,held_at=null,held_reason=null,updated_at=now()
  where id=p_job_id returning * into v_job;
  perform public.followup_log_event(p_job_id,'held_revision_released',v_key,
    jsonb_build_object('validation',p_validation_evidence,'review_deadline_at',v_job.review_deadline_at));
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_resolve_uncertain_send(
  p_job_id uuid,
  p_request_id uuid,
  p_result text,
  p_checked_at timestamptz,
  p_evidence jsonb,
  p_gmail_message_id text default null,
  p_gmail_thread_id text default null,
  p_next_retry_at timestamptz default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_key text := 'job:'||p_job_id::text||':gmail-reconciled:'||p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or p_result is null
     or p_result not in ('sent','not_sent') then
    raise exception 'job, request and sent/not_sent result are required';
  end if;
  if p_checked_at is null or p_evidence is null
     or p_checked_at<now()-interval '15 minutes' or p_checked_at>now()+interval '1 minute'
     or jsonb_typeof(p_evidence)<>'object'
     or p_evidence->>'source'<>'gmail'
     or p_evidence->>'result'<>p_result then
    raise exception 'recent matching Gmail reconciliation evidence is required';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if exists (select 1 from public.followup_activity_logs where event_key=v_key and job_id=p_job_id) then
    return to_jsonb(v_job);
  end if;
  if v_job.status<>'held' or v_job.held_kind not in ('send_uncertain','activity_during_sending') then
    raise exception 'job is not waiting for Gmail reconciliation';
  end if;

  if p_result='sent' then
    if nullif(btrim(p_gmail_message_id),'') is null or nullif(btrim(p_gmail_thread_id),'') is null then
      raise exception 'sent reconciliation requires Gmail message and thread ids';
    end if;
    update public.followup_jobs set status='sent',sent_at=p_checked_at,
      gmail_message_id=btrim(p_gmail_message_id),gmail_thread_id=btrim(p_gmail_thread_id),
      held_kind=null,held_at=null,held_reason=null,next_action_at=null,next_retry_at=null,
      last_error=null,updated_at=now() where id=p_job_id returning * into v_job;
  else
    if v_job.send_attempt_count>=4 then
      update public.followup_jobs set status='failed',failed_at=now(),
        last_error='retry limit reached after Gmail reconciliation',last_failed_at=now(),
        held_kind=null,held_at=null,held_reason=null,next_action_at=null,next_retry_at=null,
        updated_at=now() where id=p_job_id returning * into v_job;
    else
      if p_next_retry_at is null or p_next_retry_at<=now() then
        raise exception 'not_sent reconciliation requires a future retry time';
      end if;
      update public.followup_jobs set status='sending',next_retry_at=p_next_retry_at,
        next_action_at=p_next_retry_at,held_kind=null,held_at=null,held_reason=null,
        updated_at=now() where id=p_job_id returning * into v_job;
    end if;
  end if;
  perform public.followup_log_event(p_job_id,'gmail_reconciled',v_key,
    jsonb_build_object('result',p_result,'checked_at',p_checked_at,'evidence',p_evidence,
                       'gmail_message_id',p_gmail_message_id,'gmail_thread_id',p_gmail_thread_id));
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
  v_stage text;
  v_expected_stage text;
  v_stop_event boolean;
begin
  if nullif(btrim(p_event),'') is null or nullif(btrim(p_source),'') is null
     or nullif(btrim(p_source_event_id),'') is null then
    raise exception 'event, source and source event id are required';
  end if;
  v_stop_event:=btrim(p_event) in ('reply','application','analysis_consent','contract_consent','payment');
  if v_stop_event and p_job_id is null then
    raise exception 'stop activity requires a job id';
  end if;
  if p_job_id is not null then
    select application_id,stage into v_application_id,v_stage
    from public.followup_jobs where id=p_job_id for update;
    if not found then raise exception 'job not found'; end if;
  end if;
  v_expected_stage:=case btrim(p_event)
    when 'application' then 'stage1'
    when 'analysis_consent' then 'stage2'
    when 'contract_consent' then 'stage3a'
    when 'payment' then 'stage3b'
    else null end;
  if v_expected_stage is not null and v_stage<>v_expected_stage then
    raise exception 'activity % belongs to %, not %',btrim(p_event),v_expected_stage,v_stage;
  end if;

  v_key:='source:'||btrim(p_source)||':'||btrim(p_source_event_id);
  v_inserted:=public.followup_log_event(p_job_id,btrim(p_event),v_key,
    coalesce(p_detail,'{}'::jsonb),p_run_id,btrim(p_source),btrim(p_source_event_id),
    coalesce(p_occurred_at,now()));
  if not v_inserted or not v_stop_event then return v_inserted; end if;

  if btrim(p_event)='reply' then
    update public.followup_jobs set status='canceled',cancel_requested_at=now(),canceled_at=now(),
      cancel_reason='activity:reply',next_action_at=null,next_retry_at=null,
      active_run_id=null,locked_at=null,lock_owner=null,lock_token=null,lock_expires_at=null,
      updated_at=now()
    where application_id=v_application_id
      and (status in ('scheduled','awaiting_review')
           or (status='held' and held_kind is distinct from 'send_uncertain'
                             and held_kind is distinct from 'activity_during_sending'));
    update public.followup_jobs set status='held',held_at=now(),
      held_kind='activity_during_sending',held_reason='activity:reply',
      next_action_at=null,next_retry_at=null,active_run_id=null,locked_at=null,
      lock_owner=null,lock_token=null,lock_expires_at=null,updated_at=now()
    where application_id=v_application_id and status='sending';
  else
    update public.followup_jobs set status='canceled',cancel_requested_at=now(),canceled_at=now(),
      cancel_reason='activity:'||btrim(p_event),next_action_at=null,next_retry_at=null,
      active_run_id=null,locked_at=null,lock_owner=null,lock_token=null,lock_expires_at=null,
      updated_at=now()
    where id=p_job_id
      and (status in ('scheduled','awaiting_review')
           or (status='held' and held_kind is distinct from 'send_uncertain'
                             and held_kind is distinct from 'activity_during_sending'));
    update public.followup_jobs set status='held',held_at=now(),
      held_kind='activity_during_sending',held_reason='activity:'||btrim(p_event),
      next_action_at=null,next_retry_at=null,active_run_id=null,locked_at=null,
      lock_owner=null,lock_token=null,lock_expires_at=null,updated_at=now()
    where id=p_job_id and status='sending';
  end if;
  return true;
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
  v_runtime public.followup_runtime%rowtype;
begin
  if p_job_id is null or p_lock_token is null
     or nullif(btrim(p_gmail_draft_id),'') is null
     or nullif(btrim(p_send_idempotency_key),'') is null then
    raise exception 'job, lock, Gmail draft and idempotency key are required';
  end if;
  if not public.followup_is_operating_time(now()) then
    raise exception 'sending is closed outside 07:00-23:00 Asia/Seoul';
  end if;
  select * into v_runtime from public.followup_runtime where singleton_id=1;
  if v_runtime.send_locked or v_runtime.operation_mode in ('observe','draft_only') then
    raise exception 'followup sending is currently locked';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_runtime.operation_mode='test_one'
     and lower(btrim(v_job.email))<>lower(btrim(v_runtime.test_email)) then
    raise exception 'job email is not the configured test email';
  end if;
  if v_job.status<>'sending' or v_job.lock_token is distinct from p_lock_token then
    raise exception 'send lock does not match';
  end if;
  if v_job.lock_expires_at is null or v_job.lock_expires_at<=now() then
    raise exception 'send lock has expired';
  end if;
  if v_job.gmail_draft_id is not null and v_job.gmail_draft_id<>btrim(p_gmail_draft_id) then
    raise exception 'Gmail draft id is already fixed';
  end if;
  if v_job.send_idempotency_key is not null
     and v_job.send_idempotency_key<>btrim(p_send_idempotency_key) then
    raise exception 'send idempotency key is already fixed';
  end if;
  update public.followup_jobs set gmail_draft_id=btrim(p_gmail_draft_id),
    send_idempotency_key=btrim(p_send_idempotency_key),updated_at=now()
  where id=p_job_id returning * into v_job;
  perform public.followup_log_event(p_job_id,'gmail_send_prepared',
    'job:'||p_job_id::text||':gmail-prepared:'||btrim(p_send_idempotency_key),
    jsonb_build_object('gmail_draft_id',btrim(p_gmail_draft_id)),v_job.active_run_id);
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.followup_is_operating_time(timestamptz) from public,anon,authenticated;
revoke all on function public.followup_block_new_legacy_status() from public,anon,authenticated;
revoke all on function public.followup_claim_send(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.followup_mark_send_failure(uuid,uuid,uuid,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.followup_hold_job(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.followup_hold_uncertain_send(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.followup_release_held_revision(uuid,uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.followup_resolve_uncertain_send(uuid,uuid,text,timestamptz,jsonb,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.followup_record_activity(uuid,text,text,text,timestamptz,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.followup_prepare_gmail_send(uuid,uuid,text,text) from public,anon,authenticated;

grant execute on function public.followup_is_operating_time(timestamptz) to service_role;
grant execute on function public.followup_block_new_legacy_status() to service_role;
grant execute on function public.followup_claim_send(uuid,uuid,text,integer) to service_role;
grant execute on function public.followup_mark_send_failure(uuid,uuid,uuid,text,boolean,timestamptz) to service_role;
grant execute on function public.followup_hold_job(uuid,uuid,text,uuid) to service_role;
grant execute on function public.followup_hold_uncertain_send(uuid,uuid,text,uuid) to service_role;
grant execute on function public.followup_release_held_revision(uuid,uuid,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.followup_resolve_uncertain_send(uuid,uuid,text,timestamptz,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.followup_record_activity(uuid,text,text,text,timestamptz,jsonb,uuid) to service_role;
grant execute on function public.followup_prepare_gmail_send(uuid,uuid,text,text) to service_role;
