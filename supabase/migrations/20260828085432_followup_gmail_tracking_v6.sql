-- Follow-up Gmail delivery and outcome tracking v6.
-- This migration connects the existing ledger to a subscription-based
-- ChatGPT/Codex scheduled worker. It does not unlock sending.

create table if not exists public.followup_tracking_state (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  last_student_scan_at timestamptz not null default now(),
  last_gmail_scan_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.followup_tracking_state(singleton_id)
values (1)
on conflict (singleton_id) do nothing;

alter table public.followup_tracking_state enable row level security;
revoke all on table public.followup_tracking_state from public, anon, authenticated;
grant select, insert, update, delete on table public.followup_tracking_state to service_role;

create index if not exists followup_activity_outcome_recent_idx
  on public.followup_activity_logs (occurred_at desc, event)
  where event in ('reply','application','analysis_consent','contract_consent','payment');

create index if not exists followup_jobs_gmail_thread_idx
  on public.followup_jobs (gmail_thread_id)
  where gmail_thread_id is not null;

-- Return only the bounded data the scheduled worker needs.
create or replace function public.followup_get_worker_batch(
  p_at timestamptz default now(),
  p_limit integer default 20
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
  v_tracking public.followup_tracking_state%rowtype;
  v_due jsonb;
  v_expired jsonb;
  v_threads jsonb;
begin
  if p_at is null or p_limit < 1 or p_limit > 50 then
    raise exception 'time and a limit between 1 and 50 are required';
  end if;

  select * into v_runtime from public.followup_runtime where singleton_id = 1;
  select * into v_tracking from public.followup_tracking_state where singleton_id = 1;
  if not found then raise exception 'followup tracking state is missing'; end if;

  select coalesce(jsonb_agg(x.item order by x.sort_at, x.job_id), '[]'::jsonb)
  into v_due
  from (
    select j.id as job_id, coalesce(j.next_action_at,j.next_retry_at,j.review_deadline_at) sort_at,
      jsonb_build_object(
        'job_id',j.id,'application_id',j.application_id,'email',j.email,
        'name',a.name,'stage',j.stage,'status',j.status,
        'scheduled_at',j.scheduled_at,'review_deadline_at',j.review_deadline_at,
        'next_action_at',j.next_action_at,'send_requested_at',j.send_requested_at,
        'next_retry_at',j.next_retry_at,'fresh_until_at',j.fresh_until_at,
        'send_attempt_count',j.send_attempt_count,
        'subject',m.subject,'body',m.body,'message_updated_at',m.updated_at,
        'validation_passed_at',m.validation_passed_at,'validation_evidence',m.validation_evidence,
        'attachment_asset_id',coalesce(j.attachment_asset_id,m.attachment_asset_id),
        'attachment',case when aa.asset_id is null then null else jsonb_build_object(
          'asset_id',aa.asset_id,'file_name',aa.file_name,
          'plugin_relative_path',aa.plugin_relative_path,'content_type',aa.content_type,
          'byte_size',aa.byte_size,'sha256',aa.sha256) end
      ) item
    from public.followup_jobs j
    join public.followup_messages m on m.job_id=j.id
    join public.applications a on a.id=j.application_id
    left join public.followup_attachment_assets aa
      on aa.asset_id=coalesce(j.attachment_asset_id,m.attachment_asset_id) and aa.is_active
    where j.candidate_first_seen_at is not null
      and (
        (j.status='awaiting_review' and j.next_action_at is not null and j.next_action_at<=p_at)
        or (j.status='sending' and j.lock_token is null and j.next_retry_at is not null and j.next_retry_at<=p_at)
      )
    order by coalesce(j.next_action_at,j.next_retry_at,j.review_deadline_at),j.id
    limit p_limit
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'job_id',j.id,'application_id',j.application_id,'email',j.email,'stage',j.stage,
      'gmail_draft_id',j.gmail_draft_id,'send_idempotency_key',j.send_idempotency_key,
      'lock_token',j.lock_token,'lock_expires_at',j.lock_expires_at,
      'subject',m.subject,'sent_at',j.sent_at
    ) order by j.lock_expires_at,j.id), '[]'::jsonb)
  into v_expired
  from public.followup_jobs j
  join public.followup_messages m on m.job_id=j.id
  where j.candidate_first_seen_at is not null
    and j.status='sending' and j.lock_token is not null and j.lock_expires_at<=p_at;

  select coalesce(jsonb_agg(jsonb_build_object(
      'job_id',j.id,'application_id',j.application_id,'email',j.email,
      'stage',j.stage,'gmail_thread_id',j.gmail_thread_id,'sent_at',j.sent_at
    ) order by j.sent_at desc), '[]'::jsonb)
  into v_threads
  from public.followup_jobs j
  where j.candidate_first_seen_at is not null and j.status='sent'
    and j.gmail_thread_id is not null and j.sent_at>=p_at-interval '30 days';

  return jsonb_build_object(
    'server_now',p_at,
    'runtime',jsonb_build_object(
      'operation_mode',v_runtime.operation_mode,'send_locked',v_runtime.send_locked,
      'monitor_enabled',v_runtime.missed_run_monitor_enabled,
      'last_success_at',v_runtime.last_success_at),
    'tracking',jsonb_build_object(
      'last_student_scan_at',v_tracking.last_student_scan_at,
      'last_gmail_scan_at',v_tracking.last_gmail_scan_at),
    'due',v_due,'expired_locks',v_expired,'reply_threads',v_threads
  );
end;
$$;

-- Store the independent content and Gmail-reply check performed immediately
-- before a send claim. Edited content cannot inherit an older validation.
create or replace function public.followup_record_send_validation(
  p_job_id uuid,
  p_request_id uuid,
  p_evidence jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_msg public.followup_messages%rowtype;
  v_checked_at timestamptz;
  v_reply_checked_at timestamptz;
  v_hash text;
  v_key text := 'job:'||p_job_id::text||':send-validation:'||p_request_id::text;
  v_machine_names text[] := array['길이',':) 필수','이온드림','제목형식','후기id↔숫자','CTA정합','링크형식','점수병기','환산표첨부','본문날짜','금지어·부호·담화예고'];
  v_human_names text[] := array['tone','story','duplicate','date_stage','one_to_one'];
begin
  if p_job_id is null or p_request_id is null or p_evidence is null
     or jsonb_typeof(p_evidence)<>'object' then
    raise exception 'job, request and validation evidence are required';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  select * into v_msg from public.followup_messages where job_id=p_job_id for update;
  if not found then raise exception 'message slot is missing'; end if;
  if exists(select 1 from public.followup_activity_logs where event_key=v_key) then
    return jsonb_build_object('outcome','already_recorded','job',to_jsonb(v_job));
  end if;
  if v_job.status not in ('awaiting_review','sending') then
    raise exception 'send validation is not allowed from status %',v_job.status;
  end if;

  begin
    v_checked_at := (p_evidence->>'checked_at')::timestamptz;
    v_reply_checked_at := (p_evidence->>'gmail_reply_checked_at')::timestamptz;
  exception when others then
    raise exception 'validation times must be timestamps';
  end;
  v_hash:=md5(coalesce(v_msg.subject,'')||E'\n'||coalesce(v_msg.body,''));

  if v_checked_at<now()-interval '10 minutes' or v_checked_at>now()+interval '1 minute'
     or v_reply_checked_at<now()-interval '10 minutes' or v_reply_checked_at>now()+interval '1 minute'
     or p_evidence->>'content_hash'<>v_hash
     or coalesce((p_evidence->>'passed')::boolean,false) is not true
     or coalesce((p_evidence->'machine'->>'pass')::boolean,false) is not true
     or coalesce((p_evidence->'human'->>'measured')::boolean,false) is not true
     or coalesce((p_evidence->'human'->>'pass')::boolean,false) is not true
     or jsonb_typeof(p_evidence->'machine'->'results')<>'array'
     or jsonb_typeof(p_evidence->'human'->'checks')<>'array'
     or jsonb_array_length(p_evidence->'machine'->'results')<>11
     or jsonb_array_length(p_evidence->'human'->'checks')<>5
     or (select array_agg(distinct e->>'check' order by e->>'check')
         from jsonb_array_elements(p_evidence->'machine'->'results') e)
        is distinct from (select array_agg(x order by x) from unnest(v_machine_names) x)
     or (select array_agg(distinct e->>'check' order by e->>'check')
         from jsonb_array_elements(p_evidence->'human'->'checks') e)
        is distinct from (select array_agg(x order by x) from unnest(v_human_names) x)
     or exists(select 1 from jsonb_array_elements(p_evidence->'machine'->'results') e
       where coalesce((e->>'pass')::boolean,false)=false
          or nullif(btrim(e->>'reason'),'') is null or nullif(btrim(e->>'evidence'),'') is null)
     or exists(select 1 from jsonb_array_elements(p_evidence->'human'->'checks') e
       where coalesce((e->>'pass')::boolean,false)=false
          or nullif(btrim(e->>'reason'),'') is null or nullif(btrim(e->>'evidence'),'') is null) then
    update public.followup_jobs set status='held',held_at=now(),held_kind='validation',
      held_reason='발송 직전 내용 또는 답장 검사 실패',next_action_at=null,next_retry_at=null,
      updated_at=now() where id=p_job_id returning * into v_job;
    perform public.followup_log_event(p_job_id,'send_validation_failed',v_key,p_evidence);
    return jsonb_build_object('outcome','held','job',to_jsonb(v_job));
  end if;

  update public.followup_messages
  set validation_evidence=coalesce(validation_evidence,'{}'::jsonb)
        || jsonb_build_object('send_preflight',p_evidence),
      validation_passed_at=v_checked_at
  where job_id=p_job_id returning * into v_msg;
  perform public.followup_log_event(p_job_id,'send_validation_passed',v_key,
    jsonb_build_object('checked_at',v_checked_at,'content_hash',v_hash));
  return jsonb_build_object('outcome','passed','job',to_jsonb(v_job));
end;
$$;

-- Atomically re-check Supabase facts and claim one due message.
create or replace function public.followup_claim_send_v6(
  p_job_id uuid,
  p_run_id uuid,
  p_lock_owner text,
  p_lease_seconds integer default 600
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_claim jsonb;
  v_preview record;
  v_msg public.followup_messages%rowtype;
  v_preflight jsonb;
  v_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended('followup_candidate_record_v4',0));
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;

  if v_job.status='sending' and v_job.lock_token is null then
    -- A confirmed temporary failure may be claimed again by the base function.
    null;
  elsif v_job.status<>'awaiting_review' then
    return jsonb_build_object('outcome','not_claimed','reason','status:'||v_job.status,'job',to_jsonb(v_job));
  end if;

  if v_job.cancel_requested_at is not null then
    update public.followup_jobs set status='canceled',canceled_at=now(),
      cancel_reason=coalesce(cancel_reason,'cancel_requested_before_send'),
      next_action_at=null,next_retry_at=null,updated_at=now()
    where id=p_job_id returning * into v_job;
    return jsonb_build_object('outcome','canceled','reason','cancel_requested','job',to_jsonb(v_job));
  end if;

  if v_job.candidate_first_seen_at is null then
    raise exception 'legacy jobs are not eligible for automated sending';
  end if;
  select * into v_preview
  from public.followup_candidate_preview(now(),p_job_id) p
  where p.application_id=v_job.application_id and p.stage=v_job.stage;
  if not found then
    update public.followup_jobs set status='held',held_at=now(),held_kind='candidate_data',
      held_reason='발송 직전 대상 상태를 확인할 수 없음',next_action_at=null,updated_at=now()
    where id=p_job_id returning * into v_job;
    return jsonb_build_object('outcome','held','reason','candidate_missing','job',to_jsonb(v_job));
  end if;
  if v_preview.decision<>'normal' then
    v_key:='job:'||p_job_id::text||':preflight-stop:'||p_run_id::text;
    if v_preview.decision='stale' then
      update public.followup_jobs set status='skipped',skipped_at=now(),
        skip_reason='outside_freshness_before_send',next_action_at=null,updated_at=now()
      where id=p_job_id returning * into v_job;
    elsif v_preview.decision='excluded' then
      update public.followup_jobs set status='canceled',canceled_at=now(),
        cancel_reason='preflight:'||v_preview.reason,next_action_at=null,next_retry_at=null,updated_at=now()
      where id=p_job_id returning * into v_job;
    else
      update public.followup_jobs set status='held',held_at=now(),held_kind='candidate_data',
        held_reason='preflight:'||v_preview.reason,next_action_at=null,next_retry_at=null,updated_at=now()
      where id=p_job_id returning * into v_job;
    end if;
    perform public.followup_log_event(p_job_id,'send_preflight_stopped',v_key,
      jsonb_build_object('decision',v_preview.decision,'reason',v_preview.reason),p_run_id);
    return jsonb_build_object('outcome',v_job.status,'reason',v_preview.reason,'job',to_jsonb(v_job));
  end if;

  select * into v_msg from public.followup_messages where job_id=p_job_id for update;
  if not found or nullif(btrim(v_msg.subject),'') is null or nullif(btrim(v_msg.body),'') is null then
    raise exception 'validated message content is required';
  end if;
  v_preflight:=v_msg.validation_evidence->'send_preflight';
  if v_preflight is null
     or coalesce((v_preflight->>'passed')::boolean,false) is not true
     or v_preflight->>'content_hash'<>md5(v_msg.subject||E'\n'||v_msg.body)
     or nullif(v_preflight->>'checked_at','') is null
     or nullif(v_preflight->>'gmail_reply_checked_at','') is null
     or (v_preflight->>'checked_at')::timestamptz<now()-interval '10 minutes'
     or (v_preflight->>'gmail_reply_checked_at')::timestamptz<now()-interval '10 minutes' then
    update public.followup_jobs set status='held',held_at=now(),held_kind='validation',
      held_reason='발송 직전 재검사가 없거나 오래됨',next_action_at=null,next_retry_at=null,updated_at=now()
    where id=p_job_id returning * into v_job;
    return jsonb_build_object('outcome','held','reason','send_validation_missing_or_stale','job',to_jsonb(v_job));
  end if;

  v_claim:=public.followup_claim_send(p_job_id,p_run_id,p_lock_owner,p_lease_seconds);
  return jsonb_build_object(
    'outcome','claimed','job',v_claim,
    'message',jsonb_build_object('subject',v_msg.subject,'body',v_msg.body,
      'attachment_asset_id',coalesce(v_job.attachment_asset_id,v_msg.attachment_asset_id))
  );
end;
$$;

-- Fix the idempotency key before creating a Gmail draft, then attach the
-- returned Gmail draft id in a separate step.
create or replace function public.followup_reserve_gmail_send(
  p_job_id uuid,
  p_lock_token uuid,
  p_send_idempotency_key text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_job public.followup_jobs%rowtype;
begin
  if p_job_id is null or p_lock_token is null or nullif(btrim(p_send_idempotency_key),'') is null then
    raise exception 'job, lock and idempotency key are required';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status<>'sending' or v_job.lock_token is distinct from p_lock_token
     or v_job.lock_expires_at<=now() then raise exception 'active send lock does not match'; end if;
  if v_job.send_idempotency_key is not null
     and v_job.send_idempotency_key<>btrim(p_send_idempotency_key) then
    raise exception 'send idempotency key is already fixed';
  end if;
  update public.followup_jobs set send_idempotency_key=btrim(p_send_idempotency_key),updated_at=now()
  where id=p_job_id returning * into v_job;
  perform public.followup_log_event(p_job_id,'gmail_send_reserved',
    'job:'||p_job_id::text||':gmail-reserved:'||btrim(p_send_idempotency_key),
    jsonb_build_object('reserved',true),v_job.active_run_id);
  return to_jsonb(v_job);
end;
$$;

create or replace function public.followup_attach_gmail_draft(
  p_job_id uuid,
  p_lock_token uuid,
  p_send_idempotency_key text,
  p_gmail_draft_id text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_job public.followup_jobs%rowtype;
begin
  if p_job_id is null or p_lock_token is null
     or nullif(btrim(p_send_idempotency_key),'') is null
     or nullif(btrim(p_gmail_draft_id),'') is null then
    raise exception 'job, lock, idempotency key and Gmail draft are required';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status<>'sending' or v_job.lock_token is distinct from p_lock_token
     or v_job.lock_expires_at<=now() then raise exception 'active send lock does not match'; end if;
  if v_job.send_idempotency_key is distinct from btrim(p_send_idempotency_key) then
    raise exception 'send was not reserved with this idempotency key';
  end if;
  if v_job.gmail_draft_id is not null and v_job.gmail_draft_id<>btrim(p_gmail_draft_id) then
    raise exception 'Gmail draft id is already fixed';
  end if;
  update public.followup_jobs set gmail_draft_id=btrim(p_gmail_draft_id),updated_at=now()
  where id=p_job_id returning * into v_job;
  perform public.followup_log_event(p_job_id,'gmail_draft_attached',
    'job:'||p_job_id::text||':gmail-draft:'||btrim(p_gmail_draft_id),
    jsonb_build_object('gmail_draft_id',btrim(p_gmail_draft_id)),v_job.active_run_id);
  return to_jsonb(v_job);
end;
$$;

-- Final database-side check after the draft exists and immediately before
-- the Gmail send action.
create or replace function public.followup_final_send_check(
  p_job_id uuid,
  p_lock_token uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_runtime public.followup_runtime%rowtype;
  v_preview record;
  v_msg public.followup_messages%rowtype;
begin
  select * into v_runtime from public.followup_runtime where singleton_id=1 for update;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_job.status<>'sending' or v_job.lock_token is distinct from p_lock_token
     or v_job.lock_expires_at<=now() then
    return jsonb_build_object('ready',false,'reason','send_lock_missing_or_expired','job',to_jsonb(v_job));
  end if;
  if v_runtime.send_locked or v_runtime.operation_mode in ('observe','draft_only') then
    return jsonb_build_object('ready',false,'reason','runtime_locked','job',to_jsonb(v_job));
  end if;
  if v_runtime.operation_mode='test_one'
     and public.followup_normalize_email(v_job.email)<>public.followup_normalize_email(v_runtime.test_email) then
    return jsonb_build_object('ready',false,'reason','test_email_mismatch','job',to_jsonb(v_job));
  end if;
  if not public.followup_is_operating_time(now()) then
    return jsonb_build_object('ready',false,'reason','outside_operating_hours','job',to_jsonb(v_job));
  end if;
  if v_job.cancel_requested_at is not null then
    update public.followup_jobs set status='canceled',canceled_at=now(),
      cancel_reason=coalesce(cancel_reason,'cancel_requested_during_send'),next_action_at=null,next_retry_at=null,
      active_run_id=null,locked_at=null,lock_owner=null,lock_token=null,lock_expires_at=null,updated_at=now()
    where id=p_job_id returning * into v_job;
    return jsonb_build_object('ready',false,'reason','cancel_requested','job',to_jsonb(v_job));
  end if;
  select * into v_preview from public.followup_candidate_preview(now(),p_job_id) p
  where p.application_id=v_job.application_id and p.stage=v_job.stage;
  if not found or v_preview.decision<>'normal' then
    update public.followup_jobs set status='held',held_at=now(),held_kind='activity_during_sending',
      held_reason='발송 직전 학생 상태 변경 또는 확인 불가',next_action_at=null,next_retry_at=null,
      active_run_id=null,locked_at=null,lock_owner=null,lock_token=null,lock_expires_at=null,updated_at=now()
    where id=p_job_id returning * into v_job;
    return jsonb_build_object('ready',false,'reason',coalesce(v_preview.reason,'candidate_missing'),'job',to_jsonb(v_job));
  end if;
  select * into v_msg from public.followup_messages where job_id=p_job_id;
  if not found or v_job.gmail_draft_id is null or v_job.send_idempotency_key is null
     or v_msg.validation_evidence->'send_preflight' is null
     or nullif(v_msg.validation_evidence->'send_preflight'->>'checked_at','') is null
     or nullif(v_msg.validation_evidence->'send_preflight'->>'gmail_reply_checked_at','') is null
     or (v_msg.validation_evidence->'send_preflight'->>'checked_at')::timestamptz<now()-interval '15 minutes'
     or (v_msg.validation_evidence->'send_preflight'->>'gmail_reply_checked_at')::timestamptz<now()-interval '15 minutes' then
    return jsonb_build_object('ready',false,'reason','prepared_send_or_validation_missing','job',to_jsonb(v_job));
  end if;
  return jsonb_build_object('ready',true,'reason','ready','job',to_jsonb(v_job));
end;
$$;

-- Attach a detected student action to the most recent earlier sent message.
-- Actions after seven days remain history but are not counted as outcomes.
create or replace function public.followup_record_student_outcome(
  p_source_application_id uuid,
  p_event text,
  p_source_event_id text,
  p_occurred_at timestamptz,
  p_detail jsonb default '{}'::jsonb,
  p_run_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
  v_member uuid;
  v_job public.followup_jobs%rowtype;
  v_inserted boolean;
  v_attributed boolean;
  v_stage text;
begin
  if p_source_application_id is null or p_event not in ('application','analysis_consent','contract_consent','payment')
     or nullif(btrim(p_source_event_id),'') is null or p_occurred_at is null then
    raise exception 'application, supported event, source event and occurrence time are required';
  end if;
  select * into v_app from public.applications where id=p_source_application_id;
  if not found then raise exception 'source application not found'; end if;
  v_member:=public.followup_candidate_member_id(v_app.user_id,v_app.email);

  select j.* into v_job
  from public.followup_jobs j
  where j.candidate_first_seen_at is not null and j.status='sent' and j.sent_at<=p_occurred_at
    and (
      (v_member is not null and j.user_id=v_member)
      or public.followup_normalize_email(j.email)=public.followup_normalize_email(v_app.email)
    )
  order by j.sent_at desc,j.id desc limit 1;
  if not found then return jsonb_build_object('recorded',false,'reason','no_prior_sent_message'); end if;

  v_attributed:=p_occurred_at<=v_job.sent_at+interval '7 days';
  v_inserted:=public.followup_log_event(
    v_job.id,p_event,'source:supabase:'||btrim(p_source_event_id),
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'source_application_id',p_source_application_id,'attributed',v_attributed,
      'attribution_window_days',7,'linked_sent_at',v_job.sent_at),
    p_run_id,'supabase',btrim(p_source_event_id),p_occurred_at
  );
  if not v_inserted then
    return jsonb_build_object('recorded',false,'reason','duplicate','job_id',v_job.id,'attributed',v_attributed);
  end if;

  v_stage:=case p_event when 'application' then 'stage1' when 'analysis_consent' then 'stage2'
    when 'contract_consent' then 'stage3a' when 'payment' then 'stage3b' end;
  if p_event='application' then
    update public.followup_jobs j set status='canceled',canceled_at=now(),cancel_requested_at=now(),
      cancel_reason='activity:application',next_action_at=null,next_retry_at=null,updated_at=now()
    where j.stage='stage1' and j.status in ('scheduled','awaiting_review')
      and ((v_member is not null and j.user_id=v_member)
        or public.followup_normalize_email(j.email)=public.followup_normalize_email(v_app.email));
    update public.followup_jobs j set status='held',held_at=now(),held_kind='activity_during_sending',
      held_reason='activity:application',next_action_at=null,next_retry_at=null,updated_at=now()
    where j.stage='stage1' and j.status='sending'
      and ((v_member is not null and j.user_id=v_member)
        or public.followup_normalize_email(j.email)=public.followup_normalize_email(v_app.email));
  else
    update public.followup_jobs set status='canceled',canceled_at=now(),cancel_requested_at=now(),
      cancel_reason='activity:'||p_event,next_action_at=null,next_retry_at=null,updated_at=now()
    where application_id=p_source_application_id and stage=v_stage and status in ('scheduled','awaiting_review');
    update public.followup_jobs set status='held',held_at=now(),held_kind='activity_during_sending',
      held_reason='activity:'||p_event,next_action_at=null,next_retry_at=null,updated_at=now()
    where application_id=p_source_application_id and stage=v_stage and status='sending';
  end if;
  return jsonb_build_object('recorded',true,'job_id',v_job.id,'attributed',v_attributed);
end;
$$;

create or replace function public.followup_sync_student_outcomes(
  p_run_id uuid,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_state public.followup_tracking_state%rowtype;
  v record;
  v_result jsonb;
  v_recorded integer:=0;
  v_duplicates integer:=0;
  v_from timestamptz;
begin
  if p_run_id is null or p_at is null then raise exception 'run and time are required'; end if;
  select * into v_state from public.followup_tracking_state where singleton_id=1 for update;
  if not found then raise exception 'tracking state is missing'; end if;
  v_from:=v_state.last_student_scan_at-interval '2 hours';

  for v in
    with source_events as (
      select a.id application_id,'application'::text event,
        'application:'||a.id::text source_event_id,
        coalesce(case when coalesce(a.created_at,0)>0 then to_timestamp(a.created_at/1000.0) end,
          public.followup_try_timestamptz(a.submitted_date)) occurred_at,
        jsonb_build_object('application_type',a.application_type) detail
      from public.applications a where a.application_type='challenge' and a.deleted is false
      union all
      select a.id,'analysis_consent','analysis_consent:'||a.id::text||':'||coalesce(nullif(a.student_agreed_at,''),a.updated_at::text),
        coalesce(public.followup_try_timestamptz(a.student_agreed_at),
          case when coalesce(a.updated_at,0)>0 then to_timestamp(a.updated_at/1000.0) end),
        jsonb_build_object('timestamp_source',case when nullif(a.student_agreed_at,'') is null then 'updated_at_fallback' else 'student_agreed_at' end)
      from public.applications a where a.application_type='challenge' and a.deleted is false
        and (a.student_program_agreed is true or nullif(a.student_agreed_at,'') is not null)
      union all
      select a.id,'contract_consent','contract_consent:'||a.id::text||':'||a.contract_agreed_at::text,
        to_timestamp(a.contract_agreed_at/1000.0),'{}'::jsonb
      from public.applications a where a.application_type='challenge' and a.deleted is false
        and a.contract_agreed is true and coalesce(a.contract_agreed_at,0)>0
      union all
      select a.id,'payment','payment:'||a.id::text||':'||coalesce(
          nullif(least(coalesce(a.deposit_confirmed_by_student_at,9223372036854775807),
            coalesce(a.deposit_confirmed_by_admin_at,9223372036854775807)),9223372036854775807),
          nullif(a.deposit_date,0),a.updated_at)::text,
        to_timestamp(coalesce(
          nullif(least(coalesce(a.deposit_confirmed_by_student_at,9223372036854775807),
            coalesce(a.deposit_confirmed_by_admin_at,9223372036854775807)),9223372036854775807),
          nullif(a.deposit_date,0),a.updated_at)/1000.0),
        jsonb_build_object('student_confirmed',coalesce(a.deposit_confirmed_by_student,false),
          'admin_confirmed',coalesce(a.deposit_confirmed_by_admin,false))
      from public.applications a where a.application_type='challenge' and a.deleted is false
        and (a.deposit_confirmed_by_student is true or a.deposit_confirmed_by_admin is true or a.deposit_confirmed is true)
    )
    select * from source_events
    where occurred_at is not null and occurred_at>v_from and occurred_at<=p_at
    order by occurred_at,source_event_id
  loop
    v_result:=public.followup_record_student_outcome(v.application_id,v.event,v.source_event_id,
      v.occurred_at,v.detail,p_run_id);
    if coalesce((v_result->>'recorded')::boolean,false) then v_recorded:=v_recorded+1;
    elsif v_result->>'reason'='duplicate' then v_duplicates:=v_duplicates+1; end if;
  end loop;

  update public.followup_tracking_state set last_student_scan_at=greatest(last_student_scan_at,p_at),
    updated_at=now() where singleton_id=1;
  return jsonb_build_object('from',v_from,'through',p_at,'recorded',v_recorded,'duplicates',v_duplicates);
end;
$$;

-- Record a Gmail message once, classify it, stop the current flow for human
-- replies, and add a permanent suppression for an explicit stop request.
create or replace function public.followup_record_gmail_reply(
  p_gmail_thread_id text,
  p_gmail_message_id text,
  p_from_email text,
  p_occurred_at timestamptz,
  p_classification text,
  p_detail jsonb default '{}'::jsonb,
  p_run_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_count integer;
  v_inserted boolean;
  v_attributed boolean;
  v_event text;
begin
  if nullif(btrim(p_gmail_thread_id),'') is null or nullif(btrim(p_gmail_message_id),'') is null
     or p_occurred_at is null or p_classification not in ('auto_reply','human','do_not_contact','ambiguous') then
    raise exception 'thread, message, time and supported classification are required';
  end if;
  select count(*),min(j.id::text)::uuid into v_count,v_job.id
  from public.followup_jobs j where j.gmail_thread_id=btrim(p_gmail_thread_id) and j.status='sent';
  if v_count<>1 then
    insert into public.followup_candidate_issues(issue_key,application_id,stage,normalized_email,
      issue_type,status,reason,detail,first_detected_at,last_detected_at)
    values('gmail:unlinked_reply:'||btrim(p_gmail_message_id),null,null,
      public.followup_normalize_email(p_from_email),'unlinked_reply','held','gmail_thread_not_unique',
      coalesce(p_detail,'{}'::jsonb)||jsonb_build_object('gmail_thread_id',btrim(p_gmail_thread_id)),
      now(),now())
    on conflict(issue_key) do update set last_detected_at=excluded.last_detected_at,
      detail=excluded.detail,updated_at=now();
    return jsonb_build_object('recorded',false,'reason','gmail_thread_not_unique','matches',v_count);
  end if;
  select * into v_job from public.followup_jobs where id=v_job.id for update;
  if public.followup_normalize_email(p_from_email) is distinct from public.followup_normalize_email(v_job.email) then
    return jsonb_build_object('recorded',false,'reason','sender_does_not_match_job');
  end if;

  v_event:=case p_classification when 'auto_reply' then 'reply_auto_ignored'
    when 'ambiguous' then 'reply_needs_review' else 'reply' end;
  v_attributed:=p_occurred_at>=v_job.sent_at and p_occurred_at<=v_job.sent_at+interval '7 days';
  v_inserted:=public.followup_log_event(v_job.id,v_event,
    'source:gmail:'||btrim(p_gmail_message_id),
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'classification',p_classification,'attributed',case when v_event='reply' then v_attributed else false end,
      'attribution_window_days',7,'linked_sent_at',v_job.sent_at,
      'gmail_thread_id',btrim(p_gmail_thread_id)),
    p_run_id,'gmail',btrim(p_gmail_message_id),p_occurred_at);
  if not v_inserted then return jsonb_build_object('recorded',false,'reason','duplicate','job_id',v_job.id); end if;

  if p_classification='auto_reply' then
    return jsonb_build_object('recorded',true,'classification',p_classification,'canceled',false);
  elsif p_classification='ambiguous' then
    update public.followup_jobs set status='held',held_at=now(),held_kind='candidate_data',
      held_reason='답장 뜻 확인 필요',next_action_at=null,next_retry_at=null,updated_at=now()
    where application_id=v_job.application_id and status in ('scheduled','awaiting_review');
    update public.followup_jobs set status='held',held_at=now(),held_kind='activity_during_sending',
      held_reason='답장 뜻 확인 필요',next_action_at=null,next_retry_at=null,updated_at=now()
    where application_id=v_job.application_id and status='sending';
    return jsonb_build_object('recorded',true,'classification',p_classification,'held',true);
  end if;

  update public.followup_jobs set status='canceled',cancel_requested_at=now(),canceled_at=now(),
    cancel_reason='activity:reply',next_action_at=null,next_retry_at=null,updated_at=now()
  where application_id=v_job.application_id and status in ('scheduled','awaiting_review');
  update public.followup_jobs set status='held',held_at=now(),held_kind='activity_during_sending',
    held_reason='activity:reply',next_action_at=null,next_retry_at=null,updated_at=now()
  where application_id=v_job.application_id and status='sending';

  if p_classification='do_not_contact' then
    perform pg_advisory_xact_lock(hashtextextended('followup_suppression_write',0));
    update public.followup_suppressions set active=true,reason='do_not_contact',
      label=coalesce(label,'학생 연락 중단 요청'),note='Gmail 답장으로 연락 중단 요청',updated_at=now()
    where active and ((v_job.user_id is not null and user_id=v_job.user_id)
      or public.followup_normalize_email(email)=public.followup_normalize_email(v_job.email));
    if not found then
      insert into public.followup_suppressions(user_id,email,label,reason,note)
      values(v_job.user_id,v_job.email,'학생 연락 중단 요청','do_not_contact','Gmail 답장으로 연락 중단 요청');
    end if;
  end if;
  return jsonb_build_object('recorded',true,'classification',p_classification,
    'job_id',v_job.id,'attributed',v_attributed,'canceled',true);
end;
$$;

create or replace function public.followup_advance_gmail_scan(
  p_scanned_from timestamptz,
  p_scanned_through timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare v_state public.followup_tracking_state%rowtype;
begin
  if p_scanned_from is null or p_scanned_through is null or p_scanned_through<p_scanned_from
     or p_scanned_through>now()+interval '1 minute' then
    raise exception 'valid Gmail scan bounds are required';
  end if;
  select * into v_state from public.followup_tracking_state where singleton_id=1 for update;
  if p_scanned_from>v_state.last_gmail_scan_at+interval '5 minutes' then
    raise exception 'Gmail scan would leave a gap';
  end if;
  update public.followup_tracking_state set last_gmail_scan_at=greatest(last_gmail_scan_at,p_scanned_through),
    updated_at=now() where singleton_id=1 returning * into v_state;
  return to_jsonb(v_state);
end;
$$;

revoke all on function public.followup_get_worker_batch(timestamptz,integer) from public,anon,authenticated;
revoke all on function public.followup_record_send_validation(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.followup_claim_send_v6(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.followup_reserve_gmail_send(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.followup_attach_gmail_draft(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.followup_final_send_check(uuid,uuid) from public,anon,authenticated;
revoke all on function public.followup_record_student_outcome(uuid,text,text,timestamptz,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.followup_sync_student_outcomes(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.followup_record_gmail_reply(text,text,text,timestamptz,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.followup_advance_gmail_scan(timestamptz,timestamptz) from public,anon,authenticated;

grant execute on function public.followup_get_worker_batch(timestamptz,integer) to service_role;
grant execute on function public.followup_record_send_validation(uuid,uuid,jsonb) to service_role;
grant execute on function public.followup_claim_send_v6(uuid,uuid,text,integer) to service_role;
grant execute on function public.followup_reserve_gmail_send(uuid,uuid,text) to service_role;
grant execute on function public.followup_attach_gmail_draft(uuid,uuid,text,text) to service_role;
grant execute on function public.followup_final_send_check(uuid,uuid) to service_role;
grant execute on function public.followup_record_student_outcome(uuid,text,text,timestamptz,jsonb,uuid) to service_role;
grant execute on function public.followup_sync_student_outcomes(uuid,timestamptz) to service_role;
grant execute on function public.followup_record_gmail_reply(text,text,text,timestamptz,text,jsonb,uuid) to service_role;
grant execute on function public.followup_advance_gmail_scan(timestamptz,timestamptz) to service_role;
