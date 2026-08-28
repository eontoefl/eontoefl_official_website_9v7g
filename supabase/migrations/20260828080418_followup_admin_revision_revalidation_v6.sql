-- 대표가 수정한 메일은 반드시 다시 검사한 뒤 새 1시간 검토를 시작한다.

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
  v_revision integer;
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

  select * into v_job
    from public.followup_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception 'job not found';
  end if;

  if exists (
    select 1
      from public.followup_activity_logs
     where event_key = v_key
       and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;

  if v_job.status not in ('awaiting_review', 'held') then
    raise exception 'revision can only be saved during review or a safe hold';
  end if;
  if v_job.held_kind in ('send_uncertain', 'activity_during_sending') then
    raise exception 'Gmail reconciliation is required before this hold can be edited';
  end if;

  update public.followup_messages
     set subject = p_subject,
         body = p_body,
         review_status = 'pending',
         attachment_asset_id = nullif(btrim(p_attachment_asset_id), ''),
         rule_version = btrim(p_rule_version),
         edited_by = btrim(p_editor),
         revision = greatest(revision, 0) + 1,
         validation_evidence = null,
         validation_passed_at = null,
         updated_at = now()
   where job_id = p_job_id
   returning revision into v_revision;
  if not found then
    raise exception 'message slot is missing';
  end if;

  update public.followup_jobs
     set status = 'held',
         review_started_at = null,
         review_deadline_at = null,
         next_action_at = now(),
         send_requested_at = null,
         next_retry_at = null,
         active_run_id = null,
         locked_at = null,
         lock_owner = null,
         lock_token = null,
         lock_expires_at = null,
         attachment_asset_id = nullif(btrim(p_attachment_asset_id), ''),
         rule_version = btrim(p_rule_version),
         held_at = now(),
         held_kind = 'validation',
         held_reason = '대표 수정본 재검사 대기',
         updated_at = now()
   where id = p_job_id
   returning * into v_job;

  perform public.followup_log_event(
    p_job_id,
    'revision_saved_pending_validation',
    v_key,
    jsonb_build_object(
      'revision', v_revision,
      'automatic_send_allowed', false,
      'held_reason', v_job.held_reason
    )
  );

  return to_jsonb(v_job);
end;
$$;

revoke all on function public.followup_save_revision(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.followup_save_revision(uuid, uuid, text, text, text, text, text)
  to service_role;
