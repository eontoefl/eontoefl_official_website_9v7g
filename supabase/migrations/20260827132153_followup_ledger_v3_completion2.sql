-- Follow-up ledger v3 completion 2: keep the review deadline exact and bind
-- held-release evidence to the exact subject/body checked within 15 minutes.

create or replace function public.followup_normalize_action_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- review_deadline_at is an exact one-hour promise and must never be shifted.
  new.next_action_at := public.followup_next_allowed_at(new.next_action_at);
  new.next_retry_at := public.followup_next_allowed_at(new.next_retry_at);
  return new;
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
     or nullif(btrim(p_subject), '') is null or nullif(btrim(p_body), '') is null
     or nullif(btrim(p_rule_version), '') is null or nullif(btrim(p_editor), '') is null then
    raise exception 'job, request, content, rule version and editor are required';
  end if;
  if jsonb_typeof(p_validation_evidence) <> 'object'
     or not (p_validation_evidence @> '{"passed":true}'::jsonb)
     or nullif(p_validation_evidence->>'checked_at', '') is null
     or p_validation_evidence->>'rule_version' <> btrim(p_rule_version)
     or p_validation_evidence->>'content_hash' <> v_content_hash then
    raise exception 'matching passed validation evidence is required';
  end if;
  begin
    v_checked_at := (p_validation_evidence->>'checked_at')::timestamptz;
  exception when others then
    raise exception 'validation checked_at must be a timestamp';
  end;
  if v_checked_at < now() - interval '15 minutes'
     or v_checked_at > now() + interval '1 minute' then
    raise exception 'validation evidence must be checked within the last 15 minutes';
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

revoke all on function public.followup_normalize_action_times() from public, anon, authenticated;
revoke all on function public.followup_release_held_revision(uuid,uuid,text,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.followup_normalize_action_times() to service_role;
grant execute on function public.followup_release_held_revision(uuid,uuid,text,text,text,text,jsonb,text) to service_role;
