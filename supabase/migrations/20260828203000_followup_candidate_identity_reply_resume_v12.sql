-- Close three candidate-selection gaps found by the independent stage-8 audit:
-- cross-type applications sharing one email but different real members,
-- safely linked legacy replies, and durable stage-specific resume approval.

alter table public.applications
  add column if not exists resume_approved_at timestamptz,
  add column if not exists resume_approved_stage text;

alter table public.applications
  drop constraint if exists applications_resume_approval_pair_check;
alter table public.applications
  add constraint applications_resume_approval_pair_check check (
    (resume_approved_at is null and resume_approved_stage is null)
    or (
      resume_approved_at is not null
      and resume_approved_stage in ('동의', '계약')
    )
  );

comment on column public.applications.resume_approved_at is
  '관리자가 가장 최근 진행 재개 요청을 승인한 시각. 후속메일의 현재 단계 중단신호로 사용.';
comment on column public.applications.resume_approved_stage is
  '가장 최근 재개 승인 단계. 동의=stage2, 계약=stage3a에만 적용.';

-- applications is a legacy table whose broad grants and disabled RLS are out
-- of scope for this feature. Protect only the two new approval columns so an
-- applicant cannot create, alter, or erase an administrator approval.
create or replace function public.followup_protect_resume_approval_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') and (
    (tg_op = 'INSERT' and (
      new.resume_approved_at is not null
      or new.resume_approved_stage is not null
    ))
    or (tg_op = 'UPDATE' and (
      new.resume_approved_at is distinct from old.resume_approved_at
      or new.resume_approved_stage is distinct from old.resume_approved_stage
    ))
  ) then
    raise exception 'resume approval fields are administrator-only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists applications_protect_resume_approval_fields
  on public.applications;
create trigger applications_protect_resume_approval_fields
before insert or update of resume_approved_at, resume_approved_stage
on public.applications
for each row execute function public.followup_protect_resume_approval_fields();

revoke all on function public.followup_protect_resume_approval_fields()
  from public, anon, authenticated;

create or replace function public.followup_candidate_email_has_multiple_members(
  p_email text
) returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when public.followup_normalize_email(p_email) is null then false
    else (
      select count(distinct u.id) > 1
      from public.applications a
      join public.users u
        on u.id::text = lower(btrim(a.user_id))
       and public.followup_normalize_email(u.email)
           = public.followup_normalize_email(a.email)
      where a.deleted is false
        and public.followup_normalize_email(a.email)
            = public.followup_normalize_email(p_email)
    )
  end;
$$;

create or replace function public.followup_candidate_resume_approved_for_stage(
  p_stage text,
  p_approved_at timestamptz,
  p_approved_stage text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_approved_at is not null and case btrim(coalesce(p_approved_stage, ''))
    when '동의' then p_stage = 'stage2'
    when '계약' then p_stage = 'stage3a'
    else false
  end;
$$;

revoke all on function public.followup_candidate_email_has_multiple_members(text)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_resume_approved_for_stage(text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.followup_candidate_email_has_multiple_members(text)
  to service_role;
grant execute on function public.followup_candidate_resume_approved_for_stage(text,timestamptz,text)
  to service_role;

create or replace function public.followup_candidate_reply_application(
  p_email text,
  p_reply_at timestamptz
) returns uuid
language sql
stable
set search_path = ''
as $$
  with candidates as (
    select
      a.id,
      coalesce(
        case when coalesce(a.created_at, 0) > 0
          then to_timestamp(a.created_at / 1000.0)
        end,
        public.followup_try_timestamptz(a.submitted_date)
      ) as application_created_at
    from public.applications a
    where p_reply_at is not null
      and a.deleted is false
      and public.followup_normalize_email(a.email)
          = public.followup_normalize_email(p_email)
  ), latest as (
    select max(application_created_at) as application_created_at
    from candidates
    where application_created_at < p_reply_at
  )
  select min(c.id::text)::uuid
  from candidates c
  join latest l using (application_created_at)
  having count(*) = 1;
$$;

revoke all on function public.followup_candidate_reply_application(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.followup_candidate_reply_application(text,timestamptz)
  to service_role;

-- Keep the established candidate function as the single decision point. Patch
-- only the exact decision fragments and fail closed if the expected v4
-- shape is not present. Sequential migrations make this reproducible on reset.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_before text;
begin
  select p.oid, pg_get_functiondef(p.oid)
  into v_oid, v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'followup_candidate_preview'
    and pg_get_function_identity_arguments(p.oid)
        = 'p_at timestamp with time zone, p_ignore_job_id uuid, p_ignore_candidate_jobs boolean';

  if v_oid is null then
    raise exception 'followup_candidate_preview(timestamptz,uuid,boolean) is missing';
  end if;
  if position('as email_multiple_member_ids' in v_definition) > 0
     and position('prior_reply_for_current_flow' in v_definition) > 0
     and position('resume_approved' in v_definition) > 0 then
    return;
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$), identity_flags as ($old$,
    $new$), email_member_conflicts as (
  select i.normalized_email
  from app_identity i
  where i.deleted is false
    and i.raw_member_id is not null
    and i.raw_member_email = i.normalized_email
  group by i.normalized_email
  having count(distinct i.raw_member_id) > 1
), identity_flags as ($new$
  );
  if v_definition = v_before then
    raise exception 'candidate email-member conflict CTE patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$  select
    i.*,
    (
      select count(*) > 0$old$,
    $new$  select
    i.*,
    exists (
      select 1
      from email_member_conflicts emc
      where emc.normalized_email = i.normalized_email
    ) as email_multiple_member_ids,
    (
      select count(*) > 0$new$
  );
  if v_definition = v_before then
    raise exception 'candidate email-member conflict flag patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$      when f.same_type_duplicate then 'held'
      when f.unlinked_reply_email_match then 'held'$old$,
    $new$      when f.same_type_duplicate then 'held'
      when f.email_multiple_member_ids then 'held'
      when f.unlinked_reply_email_match then 'excluded'$new$
  );
  if v_definition = v_before then
    raise exception 'candidate decision identity/reply patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$      when f.resume_requested_at is not null then 'excluded'
      when f.existing_job then 'excluded'$old$,
    $new$      when f.resume_requested_at is not null then 'excluded'
      when public.followup_candidate_resume_approved_for_stage(
        f.stage, f.resume_approved_at, f.resume_approved_stage
      ) then 'excluded'
      when f.existing_job then 'excluded'$new$
  );
  if v_definition = v_before then
    raise exception 'candidate decision resume-approval patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$      when f.same_type_duplicate then 'same_type_duplicate'
      when f.unlinked_reply_email_match then 'unlinked_reply_email_match'$old$,
    $new$      when f.same_type_duplicate then 'same_type_duplicate'
      when f.email_multiple_member_ids
        then 'member_email_conflict'
      when f.unlinked_reply_email_match then 'prior_reply_for_current_flow'$new$
  );
  if v_definition = v_before then
    raise exception 'candidate reason identity/reply patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$      when f.resume_requested_at is not null then 'resume_requested'
      when f.existing_job then 'existing_job'$old$,
    $new$      when f.resume_requested_at is not null then 'resume_requested'
      when public.followup_candidate_resume_approved_for_stage(
        f.stage, f.resume_approved_at, f.resume_approved_stage
      ) then 'resume_approved'
      when f.existing_job then 'existing_job'$new$
  );
  if v_definition = v_before then
    raise exception 'candidate reason resume-approval patch point not found';
  end if;

  execute v_definition;
end;
$migration$;

-- A safely linked legacy reply is no longer a confirmation issue. Keep only
-- replies whose target application cannot be selected safely.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_before text;
begin
  select p.oid, pg_get_functiondef(p.oid)
  into v_oid, v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'followup_record_candidates'
    and pg_get_function_identity_arguments(p.oid)
        = 'p_request_id uuid, p_scan_at timestamp with time zone';

  if v_oid is null then
    raise exception 'followup_record_candidates(uuid,timestamptz) is missing';
  end if;
  if position(
    $new$l.detail ->> 'email', reply.reply_at
        ) is null$new$ in v_definition
  ) > 0 and position(
    $new$application_id = excluded.application_id$new$ in v_definition
  ) > 0 and position(
    $new$safely_linked_reply_excluded$new$ in v_definition
  ) > 0 then
    return;
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$      where l.job_id is null and l.event in ('reply','reply_detected')
      order by l.id$old$,
    $new$      where l.job_id is null and l.event in ('reply','reply_detected')
        and public.followup_candidate_reply_application(
          l.detail ->> 'email', reply.reply_at
        ) is null
      order by l.id$new$
  );
  if v_definition = v_before then
    raise exception 'unlinked reply issue patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$        'candidate:unlinked_reply:' || v_row.id::text,
        v_row.target_application_id, v_row.normalized_email,
        'unlinked_reply', 'held', 'unlinked_reply',
        jsonb_build_object(
          'activity_log_id', v_row.id,
          'event', v_row.event,
          'source', v_row.source,
          'source_event_id', v_row.source_event_id,
          'normalized_email', v_row.normalized_email,
          'reply_at', v_row.reply_at,
          'target_application_id', v_row.target_application_id
        ),
        p_scan_at, p_scan_at
      )
      on conflict (issue_key) do update
      set last_detected_at = excluded.last_detected_at,
          status = 'held',$old$,
    $new$        'candidate:unlinked_reply:' || v_row.id::text,
        v_row.target_application_id, v_row.normalized_email,
        'unlinked_reply', 'held', 'unlinked_reply',
        jsonb_build_object(
          'activity_log_id', v_row.id,
          'event', v_row.event,
          'source', v_row.source,
          'source_event_id', v_row.source_event_id,
          'normalized_email', v_row.normalized_email,
          'reply_at', v_row.reply_at,
          'target_application_id', v_row.target_application_id
        ),
        p_scan_at, p_scan_at
      )
      on conflict (issue_key) do update
      set application_id = excluded.application_id,
          normalized_email = excluded.normalized_email,
          last_detected_at = excluded.last_detected_at,
          status = 'held',$new$
  );
  if v_definition = v_before then
    raise exception 'unlinked reply issue identity refresh patch point not found';
  end if;

  v_before := v_definition;
  v_definition := replace(
    v_definition,
    $old$  if v_is_production then
    update public.followup_candidate_issues issue
    set status = 'resolved',$old$,
    $new$  if v_is_production then
    -- Resolve a legacy-reply issue only from its own source activity. A safe
    -- reply and an ambiguous reply may share an email or application.
    with safely_linked_reply_issues as (
      select
        issue.id as issue_id,
        public.followup_candidate_reply_application(
          activity.detail ->> 'email',
          public.followup_candidate_reply_time(
            activity.detail, activity.occurred_at
          )
        ) as target_application_id
      from public.followup_candidate_issues issue
      join public.followup_activity_logs activity
        on activity.id::text = issue.detail ->> 'activity_log_id'
       and activity.job_id is null
       and activity.event in ('reply','reply_detected')
      where issue.issue_type = 'unlinked_reply'
        and issue.status = 'held'
    )
    update public.followup_candidate_issues issue
    set application_id = safe.target_application_id,
        status = 'resolved',
        reason = 'safely_linked_reply_excluded',
        resolved_at = p_scan_at,
        updated_at = now()
    from safely_linked_reply_issues safe
    where issue.id = safe.issue_id
      and safe.target_application_id is not null;

    update public.followup_candidate_issues issue
    set status = 'resolved',$new$
  );
  if v_definition = v_before then
    raise exception 'precise legacy reply resolution patch point not found';
  end if;

  execute v_definition;
end;
$migration$;

-- Re-evaluate each historical issue from its own source activity row. This
-- prevents one safe reply from resolving a different ambiguous reply that
-- happens to share an application or email.
with classified as (
  select
    i.id as issue_id,
    public.followup_candidate_reply_application(
      l.detail ->> 'email',
      public.followup_candidate_reply_time(l.detail, l.occurred_at)
    ) as target_application_id
  from public.followup_candidate_issues i
  join public.followup_activity_logs l
    on l.id::text = i.detail ->> 'activity_log_id'
   and l.job_id is null
   and l.event in ('reply','reply_detected')
  where i.issue_type = 'unlinked_reply'
    and i.status = 'held'
)
update public.followup_candidate_issues i
set application_id = classified.target_application_id,
    status = 'resolved',
    reason = 'safely_linked_reply_excluded',
    resolved_at = now(),
    updated_at = now()
from classified
where i.id = classified.issue_id
  and classified.target_application_id is not null;

with classified as (
  select
    i.id as issue_id,
    public.followup_candidate_reply_application(
      l.detail ->> 'email',
      public.followup_candidate_reply_time(l.detail, l.occurred_at)
    ) as target_application_id
  from public.followup_candidate_issues i
  join public.followup_activity_logs l
    on l.id::text = i.detail ->> 'activity_log_id'
   and l.job_id is null
   and l.event in ('reply','reply_detected')
  where i.issue_type = 'unlinked_reply'
    and i.status = 'held'
)
update public.followup_candidate_issues i
set application_id = null,
    detail = i.detail || jsonb_build_object('target_application_id', null),
    updated_at = now()
from classified
where i.id = classified.issue_id
  and classified.target_application_id is null;

update public.followup_jobs j
set status = 'canceled',
    cancel_requested_at = coalesce(j.cancel_requested_at, now()),
    canceled_at = coalesce(j.canceled_at, now()),
    cancel_reason = 'candidate_recheck:prior_reply_for_current_flow',
    next_action_at = null,
    next_retry_at = null,
    updated_at = now()
where j.status = 'held'
  and j.held_kind = 'candidate_data'
  and j.held_reason = 'unlinked_reply_email_match'
  and exists (
    select 1
    from public.followup_activity_logs l
    where l.job_id is null
      and l.event in ('reply','reply_detected')
      and public.followup_candidate_reply_application(
        l.detail ->> 'email',
        public.followup_candidate_reply_time(l.detail, l.occurred_at)
      ) = j.application_id
  );
