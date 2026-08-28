-- Follow-up candidate discovery v4.
-- One deterministic candidate rule for preview and recording.  This migration
-- never calls Gmail, Telegram, Alimtalk, or any public-site application code.

begin;

alter table public.followup_jobs
  add column if not exists eligible_at timestamptz,
  add column if not exists draft_due_at timestamptz,
  add column if not exists fresh_until_at timestamptz,
  add column if not exists candidate_first_seen_at timestamptz,
  add column if not exists candidate_missed_at timestamptz,
  add column if not exists candidate_basis jsonb;

alter table public.followup_jobs
  drop constraint if exists followup_jobs_held_kind_check;
alter table public.followup_jobs
  add constraint followup_jobs_held_kind_check
  check (
    held_kind is null
    or held_kind in (
      'validation',
      'send_uncertain',
      'activity_during_sending',
      'candidate_data'
    )
  );

create table if not exists public.followup_candidate_state (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  production_baseline_at timestamptz,
  last_production_scan_at timestamptz,
  last_production_request_id uuid,
  updated_at timestamptz not null default now()
);

insert into public.followup_candidate_state (singleton_id)
values (1)
on conflict (singleton_id) do nothing;

create table if not exists public.followup_candidate_issues (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null unique,
  application_id uuid references public.applications(id) on delete cascade,
  stage text check (stage is null or stage in ('stage1','stage2','stage3a','stage3b')),
  normalized_email text,
  member_user_id uuid references public.users(id) on delete set null,
  issue_type text not null check (
    issue_type in (
      'same_type_duplicate',
      'invalid_application_type',
      'member_email_conflict',
      'suppression_identity_conflict',
      'contract_not_sent',
      'missing_time_anchor',
      'book_configuration_conflict',
      'unlinked_reply'
    )
  ),
  status text not null default 'held' check (status in ('held','resolved')),
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null,
  last_detected_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.followup_candidate_requests (
  request_id uuid primary key,
  scan_at timestamptz not null,
  operation_mode text not null check (operation_mode in ('observe','draft_only','test_one','live')),
  test_email text,
  baseline_was_set boolean not null default false,
  preview_counts jsonb not null default '{}'::jsonb,
  write_counts jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists followup_jobs_draft_due_idx
  on public.followup_jobs (status, draft_due_at)
  where status = 'scheduled';
create index if not exists followup_jobs_candidate_fresh_idx
  on public.followup_jobs (status, fresh_until_at)
  where candidate_first_seen_at is not null;
create index if not exists followup_candidate_issues_status_idx
  on public.followup_candidate_issues (status, first_detected_at);
create index if not exists followup_candidate_issues_application_idx
  on public.followup_candidate_issues (application_id, status);
create index if not exists followup_candidate_requests_completed_idx
  on public.followup_candidate_requests (completed_at desc);

alter table public.followup_candidate_state enable row level security;
alter table public.followup_candidate_issues enable row level security;
alter table public.followup_candidate_requests enable row level security;

revoke all on table public.followup_candidate_state from public, anon, authenticated;
revoke all on table public.followup_candidate_issues from public, anon, authenticated;
revoke all on table public.followup_candidate_requests from public, anon, authenticated;
revoke all on table public.followup_candidate_state from service_role;
revoke all on table public.followup_candidate_issues from service_role;
revoke all on table public.followup_candidate_requests from service_role;

grant select, insert, update on table public.followup_candidate_state to service_role;
grant select, insert, update on table public.followup_candidate_issues to service_role;
grant select, insert on table public.followup_candidate_requests to service_role;

create or replace function public.followup_guard_candidate_data_hold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'held'
     and old.held_kind = 'candidate_data'
     and new.status in ('canceled', 'skipped') then
    new.held_kind := null;
    new.held_at := null;
    new.held_reason := null;
  end if;
  if old.status = 'held'
     and old.held_kind = 'candidate_data'
     and (
       new.status is distinct from 'held'
       or new.held_kind is distinct from 'candidate_data'
     )
     and new.status not in ('canceled', 'skipped')
     and coalesce(
       current_setting('followup.candidate_data_resolution', true),
       ''
     ) <> 'allowed' then
    raise exception 'candidate data hold requires a dedicated data-resolution path';
  end if;
  return new;
end;
$$;

drop trigger if exists followup_jobs_guard_candidate_data_hold on public.followup_jobs;
create trigger followup_jobs_guard_candidate_data_hold
before update of status, held_kind on public.followup_jobs
for each row execute function public.followup_guard_candidate_data_hold();

create or replace function public.followup_normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(p_email)), '');
$$;

create or replace function public.followup_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if nullif(btrim(p_value), '') is null then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.followup_candidate_reply_time(
  p_detail jsonb,
  p_occurred_at timestamptz
) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_received text := nullif(btrim(p_detail ->> 'received'), '');
  v_received_at timestamptz;
begin
  if v_received is not null then
    if v_received ~* '(z|[+-][0-9]{2}(:[0-9]{2})?)$' then
      v_received_at := public.followup_try_timestamptz(v_received);
    else
      v_received_at := public.followup_try_timestamptz(
        v_received || ' Asia/Seoul'
      );
    end if;
  end if;
  return coalesce(v_received_at, p_occurred_at);
end;
$$;

create or replace function public.followup_candidate_reply_application(
  p_email text,
  p_reply_at timestamptz
) returns uuid
language sql
stable
set search_path = ''
as $$
  select a.id
  from public.applications a
  where p_reply_at is not null
    and a.deleted is false
    and public.followup_normalize_email(a.email)
        = public.followup_normalize_email(p_email)
    and coalesce(
      case when coalesce(a.created_at, 0) > 0
        then to_timestamp(a.created_at / 1000.0)
      end,
      public.followup_try_timestamptz(a.submitted_date)
    ) <= p_reply_at
  order by coalesce(
    case when coalesce(a.created_at, 0) > 0
      then to_timestamp(a.created_at / 1000.0)
    end,
    public.followup_try_timestamptz(a.submitted_date)
  ) desc, a.id desc
  limit 1;
$$;

create or replace function public.followup_candidate_member_id(
  p_application_user_id text,
  p_email text
) returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select u.id
      from public.users u
      where u.id::text = lower(btrim(p_application_user_id))
        and public.followup_normalize_email(u.email)
            = public.followup_normalize_email(p_email)
      limit 1
    ),
    (
      select min(u.id::text)::uuid
      from public.users u
      where public.followup_normalize_email(u.email)
            = public.followup_normalize_email(p_email)
      having count(*) = 1
    )
  );
$$;

create or replace function public.followup_candidate_is_operating_time(
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

create or replace function public.followup_candidate_schedule(
  p_eligible_at timestamptz,
  p_low_engagement boolean
) returns table (
  draft_due_at timestamptz,
  scheduled_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_eligible_local timestamp;
  v_earliest_send_local timestamp;
  v_draft_local timestamp;
  v_send_local timestamp;
  v_date date;
  v_i integer;
begin
  if p_eligible_at is null then
    return query select null::timestamptz, null::timestamptz;
    return;
  end if;

  v_eligible_local := p_eligible_at at time zone 'Asia/Seoul';

  if p_low_engagement then
    v_earliest_send_local := v_eligible_local + interval '1 hour';
    for v_i in 0..7 loop
      v_date := v_earliest_send_local::date + v_i;
      if extract(isodow from v_date) between 2 and 4 then
        if v_i = 0 then
          if v_earliest_send_local::time > time '17:00' then
            continue;
          end if;
          v_send_local := greatest(
            v_earliest_send_local,
            v_date + time '14:00'
          );
        else
          v_send_local := v_date + time '14:00';
        end if;
        exit;
      end if;
    end loop;
    v_draft_local := v_send_local - interval '1 hour';
  else
    v_draft_local := v_eligible_local;
    if v_draft_local::time < time '07:00' then
      v_draft_local := v_draft_local::date + time '07:00';
    elsif v_draft_local::time > time '22:00' then
      v_draft_local := (v_draft_local::date + 1) + time '07:00';
    end if;
    v_send_local := v_draft_local + interval '1 hour';
  end if;

  return query
  select
    v_draft_local at time zone 'Asia/Seoul',
    v_send_local at time zone 'Asia/Seoul';
end;
$$;

create or replace function public.followup_candidate_preview(
  p_at timestamptz default now(),
  p_ignore_job_id uuid default null,
  p_ignore_candidate_jobs boolean default false
) returns table (
  application_id uuid,
  stage text,
  normalized_email text,
  member_user_id uuid,
  application_type text,
  progress_percent integer,
  deadline_at timestamptz,
  eligible_at timestamptz,
  draft_due_at timestamptz,
  scheduled_at timestamptz,
  fresh_until_at timestamptz,
  decision text,
  reason text,
  detail jsonb
)
language sql
stable
set search_path = ''
as $$
with app_identity as (
  select
    a.*,
    public.followup_normalize_email(a.email) as normalized_email,
    raw_user.id as raw_member_id,
    public.followup_normalize_email(raw_user.email) as raw_member_email,
    email_user.id as email_member_id,
    coalesce(
      case
        when raw_user.id is not null
         and public.followup_normalize_email(raw_user.email)
             = public.followup_normalize_email(a.email)
          then raw_user.id
      end,
      email_user.id
    ) as member_user_id,
    raw_user.id is not null
      and public.followup_normalize_email(raw_user.email)
          is distinct from public.followup_normalize_email(a.email)
      as member_email_conflict,
    case
      when coalesce(a.created_at, 0) > 0
        then to_timestamp(a.created_at / 1000.0)
      else public.followup_try_timestamptz(a.submitted_date)
    end as application_created_at
  from public.applications a
  left join public.users raw_user
    on raw_user.id::text = lower(btrim(a.user_id))
  left join lateral (
    select min(u.id::text)::uuid as id
    from public.users u
    where public.followup_normalize_email(u.email)
          = public.followup_normalize_email(a.email)
    having count(*) = 1
  ) email_user on true
), identity_flags as (
  select
    i.*,
    (
      select count(*) > 0
      from app_identity d
      where d.deleted is false
        and d.application_type = i.application_type
        and d.id <> i.id
        and (
          (i.normalized_email is not null and d.normalized_email = i.normalized_email)
          or (i.member_user_id is not null and d.member_user_id = i.member_user_id)
        )
    ) as same_type_duplicate,
    (
      i.raw_member_id is not null
      and exists (
        select 1
        from app_identity d
        where d.deleted is false
          and d.application_type = i.application_type
          and d.id <> i.id
          and d.raw_member_id = i.raw_member_id
          and d.normalized_email is distinct from i.normalized_email
      )
    ) as raw_member_shared_across_emails,
    exists (
      select 1
      from app_identity conflict_app
      where conflict_app.deleted is false
        and conflict_app.raw_member_id is not null
        and conflict_app.raw_member_email
            is distinct from conflict_app.normalized_email
        and (
          conflict_app.id = i.id
          or conflict_app.raw_member_id = i.raw_member_id
          or conflict_app.raw_member_id = i.member_user_id
          or conflict_app.normalized_email = i.normalized_email
          or conflict_app.raw_member_email = i.normalized_email
        )
    ) as member_conflict_group,
    coalesce(u.intro_book_track, 'regular') as intro_book_track,
    coalesce(
      a.analysis_deadline_override,
      case
        when coalesce(a.analysis_first_saved_at, 0) > 0
          then to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours'
        when coalesce(a.analysis_saved_at, 0) > 0
          then to_timestamp(a.analysis_saved_at / 1000.0) + interval '24 hours'
        else public.followup_try_timestamptz(a.submitted_date) + interval '24 hours'
      end
    ) as analysis_deadline_at,
    coalesce(
      a.contract_deadline_override,
      case when coalesce(a.contract_sent_at, 0) > 0
        then to_timestamp(a.contract_sent_at / 1000.0) + interval '24 hours'
      end
    ) as contract_deadline_at,
    coalesce(
      a.deposit_deadline_override,
      case when coalesce(a.contract_agreed_at, 0) > 0
        then to_timestamp(a.contract_agreed_at / 1000.0) + interval '24 hours'
      end
    ) as deposit_deadline_at
  from app_identity i
  left join public.users u on u.id = i.member_user_id
  cross join lateral (select i.*) a
), book_choice as (
  select
    f.*,
    case
      when f.intro_book_track = 'australia'
        then '4b1536a9-816c-4047-94d3-9348e5087e7b'::uuid
      else '6c5c2d71-1958-4e86-a04e-3040bc271b7e'::uuid
    end as intro_book_id,
    case
      when f.intro_book_track <> 'australia' then true
      else (
        select count(*) = 1
          and min(d.id::text) = '4b1536a9-816c-4047-94d3-9348e5087e7b'
        from public.tr_book_documents d
        where d.sort_order = 1 and d.deleted_at is null
      )
    end as book_configuration_valid
  from identity_flags f
), progress_data as (
  select
    b.*,
    doc.total_pages,
    progress.max_page_reached,
    progress.progress_updated_at,
    case
      when coalesce(doc.total_pages, 0) <= 0
        or coalesce(progress.max_page_reached, 0) <= 0 then 0
      else floor(
        least(
          greatest(progress.max_page_reached, 0)::numeric
            / doc.total_pages::numeric * 100,
          100
        )
      )::integer
    end as progress_percent
  from book_choice b
  left join public.tr_book_documents doc on doc.id = b.intro_book_id
  left join lateral (
    select
      max(p.max_page_reached) as max_page_reached,
      max(p.updated_at) as progress_updated_at
    from public.tr_book_progress p
    where b.member_user_id is not null
      and p.user_id = b.member_user_id::text
      and p.book_id = b.intro_book_id
  ) progress on true
), expanded as (
  select p.*, stages.stage
  from progress_data p
  cross join lateral (
    select 'stage1'::text as stage where p.application_type = 'book_only'
    union all select 'stage2' where p.application_type = 'challenge'
    union all select 'stage3a' where p.application_type = 'challenge'
    union all select 'stage3b' where p.application_type = 'challenge'
    union all select null::text where p.application_type is null
      or p.application_type not in ('book_only','challenge')
  ) stages
), clocks as (
  select
    e.*,
    case e.stage
      when 'stage2' then e.analysis_deadline_at
      when 'stage3a' then e.contract_deadline_at
      when 'stage3b' then e.deposit_deadline_at
      else null
    end as deadline_at,
    case
      when e.stage = 'stage1' and e.progress_percent between 1 and 14
        then e.application_created_at + interval '6 days'
      when e.stage = 'stage1' and e.progress_percent between 15 and 49
        then e.progress_updated_at + interval '24 hours'
      when e.stage = 'stage1' and e.progress_percent between 50 and 79
        then e.progress_updated_at + interval '12 hours'
      when e.stage = 'stage1' and e.progress_percent between 80 and 100
        then e.progress_updated_at + interval '6 hours'
      when e.stage = 'stage2'
        then e.analysis_deadline_at + interval '36 hours'
      when e.stage = 'stage3a'
        then e.contract_deadline_at + interval '24 hours'
      when e.stage = 'stage3b'
        then e.deposit_deadline_at + interval '24 hours'
    end as eligible_at,
    case
      when e.stage = 'stage1' and e.progress_percent between 1 and 14
        then e.application_created_at + interval '7 days'
      when e.stage = 'stage1' and e.progress_percent between 15 and 100
        then e.progress_updated_at + interval '7 days'
      when e.stage = 'stage2'
        then e.analysis_deadline_at + interval '48 hours'
      when e.stage in ('stage3a','stage3b')
        then case e.stage
          when 'stage3a' then e.contract_deadline_at + interval '72 hours'
          else e.deposit_deadline_at + interval '72 hours'
        end
    end as fresh_until_at
  from expanded e
), timed as (
  select c.*, schedule.draft_due_at, schedule.scheduled_at
  from clocks c
  left join lateral public.followup_candidate_schedule(
    greatest(c.eligible_at, p_at),
    c.stage = 'stage1' and c.progress_percent between 1 and 49
  ) schedule on true
), flags as (
  select
    t.*,
    exists (
      select 1 from public.followup_jobs j
      where j.application_id = t.id and j.stage = t.stage
        and (p_ignore_job_id is null or j.id <> p_ignore_job_id)
        and not (
          p_ignore_candidate_jobs
          and j.candidate_first_seen_at is not null
        )
    ) as existing_job,
    exists (
      select 1
      from public.followup_suppressions s
      join public.users su on su.id = s.user_id
      where s.active
        and s.user_id is not null
        and public.followup_normalize_email(s.email) is not null
        and public.followup_normalize_email(su.email)
            is distinct from public.followup_normalize_email(s.email)
        and (
          s.user_id = t.member_user_id
          or public.followup_normalize_email(s.email) = t.normalized_email
        )
    ) as bad_suppression_match,
    exists (
      select 1 from public.followup_suppressions s
      where s.active and (
        (t.member_user_id is not null and s.user_id = t.member_user_id)
        or (
          t.normalized_email is not null
          and public.followup_normalize_email(s.email) = t.normalized_email
        )
      )
    ) as suppressed,
    exists (
      select 1
      from public.followup_activity_logs l
      join public.followup_jobs j on j.id = l.job_id
      where j.application_id = t.id
        and l.event in ('reply','reply_detected')
    ) as current_flow_reply,
    exists (
      select 1
      from public.followup_activity_logs l
      where l.job_id is null
        and l.event in ('reply','reply_detected')
        and public.followup_candidate_reply_application(
          l.detail ->> 'email',
          public.followup_candidate_reply_time(l.detail, l.occurred_at)
        ) = t.id
    ) as unlinked_reply_email_match,
    exists (
      select 1
      from identity_flags ch
      where ch.id <> t.id
        and ch.deleted is false
        and ch.application_type = 'challenge'
        and (
          (t.normalized_email is not null and ch.normalized_email = t.normalized_email)
          or (t.member_user_id is not null and ch.member_user_id = t.member_user_id)
        )
    ) as challenge_exists
  from timed t
), decided as (
  select
    f.*,
    case
      when f.application_type is null
        or f.application_type not in ('book_only','challenge') then 'held'
      when f.deleted is distinct from false then 'excluded'
      when f.normalized_email is null then 'excluded'
      when f.member_email_conflict
        or f.raw_member_shared_across_emails
        or f.member_conflict_group then 'held'
      when f.same_type_duplicate then 'held'
      when f.unlinked_reply_email_match then 'held'
      when f.stage = 'stage1' and not f.book_configuration_valid then 'held'
      when f.bad_suppression_match then 'held'
      when f.suppressed then 'excluded'
      when f.current_flow_reply then 'excluded'
      when f.resume_requested_at is not null then 'excluded'
      when f.existing_job then 'excluded'
      when f.stage = 'stage1' and f.challenge_exists then 'excluded'
      when f.stage = 'stage1' and coalesce(f.progress_percent, 0) = 0 then 'excluded'
      when f.stage = 'stage2' and (
        f.student_program_agreed is true
        or nullif(f.student_agreed_at, '') is not null
      ) then 'excluded'
      when f.stage = 'stage2' and (
        f.analysis_status is distinct from '승인'
        or nullif(f.analysis_content, '') is null
      ) then 'not_ready'
      when f.stage = 'stage3a' and f.contract_agreed is true then 'excluded'
      when f.stage = 'stage3a'
        and nullif(f.student_agreed_at, '') is null then 'not_ready'
      when f.stage = 'stage3a' and f.contract_sent is not true then 'held'
      when f.stage = 'stage3b' and f.contract_agreed is not true then 'not_ready'
      when f.stage = 'stage3b' and (
        f.deposit_confirmed_by_student is true
        or f.deposit_confirmed_by_admin is true
      ) then 'excluded'
      when f.eligible_at is null or f.fresh_until_at is null
        or f.draft_due_at is null or f.scheduled_at is null then 'held'
      when p_at < f.eligible_at then 'not_ready'
      when f.scheduled_at > f.fresh_until_at or p_at > f.fresh_until_at then 'stale'
      else 'normal'
    end as decision,
    case
      when f.application_type is null
        or f.application_type not in ('book_only','challenge') then 'invalid_application_type'
      when f.deleted is distinct from false then 'deleted'
      when f.normalized_email is null then 'missing_email'
      when f.member_email_conflict
        or f.raw_member_shared_across_emails
        or f.member_conflict_group
        then 'member_email_conflict'
      when f.same_type_duplicate then 'same_type_duplicate'
      when f.unlinked_reply_email_match then 'unlinked_reply_email_match'
      when f.stage = 'stage1' and not f.book_configuration_valid
        then 'book_configuration_conflict'
      when f.bad_suppression_match then 'suppression_identity_conflict'
      when f.suppressed then 'suppressed'
      when f.current_flow_reply then 'current_flow_reply'
      when f.resume_requested_at is not null then 'resume_requested'
      when f.existing_job then 'existing_job'
      when f.stage = 'stage1' and f.challenge_exists then 'challenge_exists'
      when f.stage = 'stage1' and coalesce(f.progress_percent, 0) = 0 then 'no_progress'
      when f.stage = 'stage2' and (
        f.student_program_agreed is true
        or nullif(f.student_agreed_at, '') is not null
      ) then 'analysis_consent_completed'
      when f.stage = 'stage2' and (
        f.analysis_status is distinct from '승인'
        or nullif(f.analysis_content, '') is null
      ) then 'analysis_not_ready'
      when f.stage = 'stage3a' and f.contract_agreed is true then 'contract_completed'
      when f.stage = 'stage3a'
        and nullif(f.student_agreed_at, '') is null then 'student_not_agreed'
      when f.stage = 'stage3a' and f.contract_sent is not true then 'contract_not_sent'
      when f.stage = 'stage3b' and f.contract_agreed is not true then 'contract_not_agreed'
      when f.stage = 'stage3b' and (
        f.deposit_confirmed_by_student is true
        or f.deposit_confirmed_by_admin is true
      ) then 'payment_completed'
      when f.eligible_at is null or f.fresh_until_at is null
        or f.draft_due_at is null or f.scheduled_at is null then 'missing_time_anchor'
      when p_at < f.eligible_at then 'before_eligible'
      when f.scheduled_at > f.fresh_until_at or p_at > f.fresh_until_at
        then 'outside_freshness'
      else 'candidate'
    end as reason
  from flags f
)
select
  d.id,
  d.stage,
  d.normalized_email,
  d.member_user_id,
  d.application_type,
  d.progress_percent,
  d.deadline_at,
  d.eligible_at,
  d.draft_due_at,
  d.scheduled_at,
  d.fresh_until_at,
  d.decision,
  d.reason,
  jsonb_build_object(
    'application_type', d.application_type,
    'progress_percent', d.progress_percent,
    'intro_book_track', d.intro_book_track,
    'member_user_id', d.member_user_id,
    'deadline_at', d.deadline_at,
    'eligible_at', d.eligible_at,
    'draft_due_at', d.draft_due_at,
    'scheduled_at', d.scheduled_at,
    'fresh_until_at', d.fresh_until_at,
    'decision', d.decision,
    'reason', d.reason
  )
from decided d;
$$;

create or replace function public.followup_record_candidates(
  p_request_id uuid,
  p_scan_at timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
  v_state public.followup_candidate_state%rowtype;
  v_existing public.followup_candidate_requests%rowtype;
  v_row record;
  v_open_job public.followup_jobs%rowtype;
  v_current_preview record;
  v_job_id uuid;
  v_issue_key text;
  v_issue_type text;
  v_preview_counts jsonb;
  v_write_counts jsonb;
  v_result jsonb;
  v_test_email text;
  v_is_production boolean;
  v_baseline_was_set boolean := false;
  v_incident_eligible boolean := false;
  v_scheduled integer := 0;
  v_skipped integer := 0;
  v_missed integer := 0;
  v_issues integer := 0;
  v_held_jobs integer := 0;
  v_canceled integer := 0;
  v_rescheduled integer := 0;
  v_affected integer;
begin
  if p_request_id is null or p_scan_at is null then
    raise exception 'request id and scan time are required';
  end if;

  -- One transaction owns candidate recording.  Unique constraints remain the
  -- second line of defence for retries and callers that share a request id.
  perform pg_advisory_xact_lock(hashtextextended('followup_candidate_record_v4', 0));

  select * into v_runtime
  from public.followup_runtime
  where singleton_id = 1
  for update;
  if not found then
    raise exception 'followup runtime is missing';
  end if;

  select * into v_existing
  from public.followup_candidate_requests
  where request_id = p_request_id;
  v_test_email := public.followup_normalize_email(v_runtime.test_email);
  if found then
    if v_existing.scan_at is distinct from p_scan_at
       or v_existing.operation_mode is distinct from v_runtime.operation_mode
       or v_existing.test_email is distinct from (case
         when v_runtime.operation_mode = 'test_one' then v_test_email
         else null
       end) then
      raise exception 'request id was already used with different scan inputs';
    end if;
    return v_existing.result;
  end if;

  if v_runtime.operation_mode = 'test_one' and v_test_email is null then
    raise exception 'test_one mode requires a configured test email';
  end if;
  if v_runtime.operation_mode <> 'observe'
     and abs(extract(epoch from (p_scan_at - clock_timestamp()))) > 300 then
    raise exception 'write-mode scan time must be within five minutes of current time';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'normal', count(*) filter (where decision = 'normal'),
    'stale', count(*) filter (where decision = 'stale'),
    'held', count(*) filter (where decision = 'held'),
    'excluded', count(*) filter (where decision = 'excluded'),
    'not_ready', count(*) filter (where decision = 'not_ready')
  )
  into v_preview_counts
  from public.followup_candidate_preview(p_scan_at) p
  where v_runtime.operation_mode <> 'test_one'
     or p.normalized_email = v_test_email;

  if v_runtime.operation_mode = 'observe' then
    v_write_counts := jsonb_build_object(
      'scheduled', 0, 'skipped', 0, 'candidate_missed', 0,
      'issues', 0, 'held_jobs', 0, 'canceled', 0, 'rescheduled', 0
    );
    v_result := jsonb_build_object(
      'request_id', p_request_id,
      'scan_at', p_scan_at,
      'operation_mode', v_runtime.operation_mode,
      'preview', v_preview_counts,
      'written', v_write_counts,
      'external_calls', 0
    );
    insert into public.followup_candidate_requests(
      request_id, scan_at, operation_mode, test_email,
      baseline_was_set, preview_counts, write_counts, result
    ) values (
      p_request_id, p_scan_at, v_runtime.operation_mode, null,
      false, v_preview_counts, v_write_counts, v_result
    );
    return v_result;
  end if;

  v_is_production := v_runtime.operation_mode in ('draft_only','live');
  if v_is_production then
    select * into v_state
    from public.followup_candidate_state
    where singleton_id = 1
    for update;
    if not found then
      raise exception 'candidate state is missing';
    end if;
    if v_state.last_production_scan_at is not null
       and p_scan_at <= v_state.last_production_scan_at then
      raise exception 'production scan time must be later than the previous scan';
    end if;
    v_baseline_was_set := v_state.production_baseline_at is not null;
    v_incident_eligible := v_baseline_was_set;
  end if;

  -- Re-evaluate only jobs created by this candidate recorder.  Legacy rows
  -- deliberately have candidate_first_seen_at = null and remain untouched.
  for v_open_job in
    select j.*
    from public.followup_jobs j
    where j.candidate_first_seen_at is not null
      and j.status in ('scheduled','awaiting_review')
      and (
        v_runtime.operation_mode <> 'test_one'
        or public.followup_normalize_email(j.email) = v_test_email
      )
    order by j.id
    for update
  loop
    select * into v_current_preview
    from public.followup_candidate_preview(p_scan_at, v_open_job.id) p
    where p.application_id = v_open_job.application_id
      and p.stage = v_open_job.stage;
    if not found then
      continue;
    end if;

    if (
      v_open_job.status = 'scheduled'
      and v_current_preview.decision = 'stale'
    ) or (
      v_open_job.status = 'awaiting_review'
      and v_current_preview.fresh_until_at is not null
      and (
        p_scan_at > v_current_preview.fresh_until_at
        or v_open_job.scheduled_at > v_current_preview.fresh_until_at
      )
    ) then
      update public.followup_jobs
      set status = 'skipped',
          skipped_at = p_scan_at,
          skip_reason = 'outside_freshness_after_scheduling',
          next_action_at = null,
          candidate_missed_at = case
            when v_incident_eligible and candidate_missed_at is null
              then p_scan_at
            else candidate_missed_at
          end,
          active_run_id = p_request_id,
          updated_at = now()
      where id = v_open_job.id;
      v_skipped := v_skipped + 1;
      perform public.followup_log_event(
        v_open_job.id,
        'job_skipped',
        'candidate:' || v_open_job.application_id::text || ':' ||
          v_open_job.stage || ':expired-after-scheduling',
        coalesce(v_current_preview.detail, '{}'::jsonb) ||
          jsonb_build_object('reason','outside_freshness_after_scheduling'),
        p_request_id
      );
      if v_incident_eligible and v_open_job.candidate_missed_at is null then
        v_missed := v_missed + 1;
        perform public.followup_log_event(
          v_open_job.id,
          'candidate_missed',
          'candidate_missed:' || v_open_job.application_id::text || ':' ||
            v_open_job.stage,
          coalesce(v_current_preview.detail, '{}'::jsonb) ||
            jsonb_build_object(
              'previous_successful_scan_at', v_state.last_production_scan_at,
              'detected_at', p_scan_at
            ),
          p_request_id
        );
      end if;
    elsif v_current_preview.decision = 'not_ready'
      and v_current_preview.reason = 'before_eligible' then
      update public.followup_jobs
      set status = 'scheduled',
          reason = 'candidate:before_eligible_recheck',
          progress_percent = v_current_preview.progress_percent,
          deadline_snapshot = v_current_preview.deadline_at,
          eligible_at = v_current_preview.eligible_at,
          draft_due_at = v_current_preview.draft_due_at,
          scheduled_at = v_current_preview.scheduled_at,
          fresh_until_at = v_current_preview.fresh_until_at,
          next_action_at = v_current_preview.draft_due_at,
          review_started_at = null,
          review_deadline_at = null,
          send_requested_at = null,
          candidate_basis = v_current_preview.detail,
          active_run_id = p_request_id,
          updated_at = now()
      where id = v_open_job.id;
      v_rescheduled := v_rescheduled + 1;
      perform public.followup_log_event(
        v_open_job.id,
        'candidate_rescheduled',
        'candidate:' || v_open_job.application_id::text || ':' ||
          v_open_job.stage || ':before-eligible:' || p_request_id::text,
        coalesce(v_current_preview.detail, '{}'::jsonb),
        p_request_id
      );
    elsif v_current_preview.decision = 'excluded'
      or (
        v_current_preview.decision = 'not_ready'
        and v_current_preview.reason <> 'before_eligible'
      ) then
      update public.followup_jobs
      set status = 'canceled',
          cancel_requested_at = p_scan_at,
          canceled_at = p_scan_at,
          cancel_reason = 'candidate_recheck:' || v_current_preview.reason,
          next_action_at = null,
          next_retry_at = null,
          active_run_id = p_request_id,
          updated_at = now()
      where id = v_open_job.id;
      v_canceled := v_canceled + 1;
      perform public.followup_log_event(
        v_open_job.id,
        'job_canceled',
        'candidate:' || v_open_job.application_id::text || ':' ||
          v_open_job.stage || ':recheck-canceled',
        coalesce(v_current_preview.detail, '{}'::jsonb),
        p_request_id
      );
    elsif v_current_preview.decision = 'held' then
      update public.followup_jobs
      set status = 'held',
          held_at = p_scan_at,
          held_kind = 'candidate_data',
          held_reason = v_current_preview.reason,
          next_action_at = null,
          active_run_id = p_request_id,
          updated_at = now()
      where id = v_open_job.id;
      v_held_jobs := v_held_jobs + 1;

      v_issue_type := case v_current_preview.reason
        when 'invalid_application_type' then 'invalid_application_type'
        when 'same_type_duplicate' then 'same_type_duplicate'
        when 'member_email_conflict' then 'member_email_conflict'
        when 'suppression_identity_conflict' then 'suppression_identity_conflict'
        when 'contract_not_sent' then 'contract_not_sent'
        when 'book_configuration_conflict' then 'book_configuration_conflict'
        when 'unlinked_reply_email_match' then 'unlinked_reply'
        else 'missing_time_anchor'
      end;
      v_issue_key := case v_issue_type
        when 'same_type_duplicate' then
          'candidate:same_type_duplicate:' || md5(
            coalesce(v_current_preview.application_type, '') || ':' ||
            coalesce(v_current_preview.normalized_email,
                     v_current_preview.member_user_id::text, '')
          )
        when 'suppression_identity_conflict' then
          'candidate:suppression_identity_conflict:application:' ||
            v_current_preview.application_id::text
        when 'contract_not_sent' then
          'candidate:contract_not_sent:' ||
            v_current_preview.application_id::text || ':' ||
            v_current_preview.stage
        when 'book_configuration_conflict' then
          'candidate:book_configuration_conflict:' ||
            v_current_preview.application_id::text
        when 'unlinked_reply' then
          'candidate:unlinked_reply:application:' ||
            v_current_preview.application_id::text
        when 'missing_time_anchor' then
          'candidate:missing_time_anchor:' ||
            v_current_preview.application_id::text || ':' ||
            coalesce(v_current_preview.stage, 'none')
        else
          'candidate:' || v_issue_type || ':' ||
            v_current_preview.application_id::text
      end;
      insert into public.followup_candidate_issues(
        issue_key, application_id, stage, normalized_email, member_user_id,
        issue_type, status, reason, detail,
        first_detected_at, last_detected_at
      ) values (
        v_issue_key,
        v_current_preview.application_id,
        case when v_issue_type in
          ('contract_not_sent','missing_time_anchor','book_configuration_conflict')
          then v_current_preview.stage else null end,
        v_current_preview.normalized_email,
        v_current_preview.member_user_id,
        v_issue_type,
        'held',
        v_current_preview.reason,
        v_current_preview.detail,
        p_scan_at,
        p_scan_at
      )
      on conflict (issue_key) do update
      set last_detected_at = excluded.last_detected_at,
          status = 'held',
          resolved_at = null,
          detail = excluded.detail,
          updated_at = now();
    elsif v_open_job.status = 'awaiting_review'
      and v_current_preview.decision in ('normal','stale') then
      update public.followup_jobs
      set progress_percent = v_current_preview.progress_percent,
          deadline_snapshot = v_current_preview.deadline_at,
          eligible_at = v_current_preview.eligible_at,
          fresh_until_at = v_current_preview.fresh_until_at,
          candidate_basis = v_current_preview.detail,
          active_run_id = p_request_id,
          updated_at = now()
      where id = v_open_job.id;
    end if;
  end loop;

  -- Global confirmation records do not suppress an email by themselves.
  -- They record source rows that cannot be tied safely to one application.
  if v_is_production then
    for v_row in
      select l.id, l.event, l.source, l.source_event_id,
             public.followup_normalize_email(l.detail ->> 'email') as normalized_email,
             reply.reply_at,
             public.followup_candidate_reply_application(
               l.detail ->> 'email', reply.reply_at
             ) as target_application_id
      from public.followup_activity_logs l
      cross join lateral (
        select public.followup_candidate_reply_time(
          l.detail, l.occurred_at
        ) as reply_at
      ) reply
      where l.job_id is null and l.event in ('reply','reply_detected')
      order by l.id
    loop
      insert into public.followup_candidate_issues(
        issue_key, application_id, normalized_email,
        issue_type, status, reason, detail,
        first_detected_at, last_detected_at
      ) values (
        'candidate:unlinked_reply:' || v_row.id::text,
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
          status = 'held',
          resolved_at = null,
          detail = excluded.detail,
          updated_at = now();
    end loop;

    for v_row in
      select s.id, s.user_id, public.followup_normalize_email(s.email) as normalized_email
      from public.followup_suppressions s
      join public.users u on u.id = s.user_id
      where s.active
        and s.user_id is not null
        and public.followup_normalize_email(s.email) is not null
        and public.followup_normalize_email(u.email)
            is distinct from public.followup_normalize_email(s.email)
      order by s.id
    loop
      insert into public.followup_candidate_issues(
        issue_key, normalized_email, member_user_id,
        issue_type, status, reason, detail,
        first_detected_at, last_detected_at
      ) values (
        'candidate:suppression_identity_conflict:' || v_row.id::text,
        v_row.normalized_email, v_row.user_id,
        'suppression_identity_conflict', 'held',
        'suppression_identity_conflict',
        jsonb_build_object('suppression_id', v_row.id),
        p_scan_at, p_scan_at
      )
      on conflict (issue_key) do update
      set last_detected_at = excluded.last_detected_at,
          status = 'held',
          resolved_at = null,
          detail = excluded.detail,
          updated_at = now();
    end loop;
  end if;

  -- Confirmation endpoints are durable and idempotent.  Cross-stage identity
  -- problems have one group key; stage-specific data faults keep the stage.
  for v_row in
    select *
    from public.followup_candidate_preview(p_scan_at) p
    where p.decision = 'held'
      and (
        v_runtime.operation_mode <> 'test_one'
        or p.normalized_email = v_test_email
      )
    order by p.application_id, p.stage nulls first
  loop
    v_issue_type := case v_row.reason
      when 'invalid_application_type' then 'invalid_application_type'
      when 'same_type_duplicate' then 'same_type_duplicate'
      when 'member_email_conflict' then 'member_email_conflict'
      when 'unlinked_reply_email_match' then 'unlinked_reply'
      when 'suppression_identity_conflict' then 'suppression_identity_conflict'
      when 'contract_not_sent' then 'contract_not_sent'
      when 'book_configuration_conflict' then 'book_configuration_conflict'
      else 'missing_time_anchor'
    end;

    v_issue_key := case v_issue_type
      when 'same_type_duplicate' then
        'candidate:same_type_duplicate:' || md5(
          coalesce(v_row.application_type, '') || ':' ||
          coalesce(v_row.normalized_email, v_row.member_user_id::text, '')
        )
      when 'suppression_identity_conflict' then
        'candidate:suppression_identity_conflict:application:' || v_row.application_id::text
      when 'contract_not_sent' then
        'candidate:contract_not_sent:' || v_row.application_id::text || ':' || v_row.stage
      when 'book_configuration_conflict' then
        'candidate:book_configuration_conflict:' || v_row.application_id::text
      when 'unlinked_reply' then
        'candidate:unlinked_reply:application:' || v_row.application_id::text
      when 'missing_time_anchor' then
        'candidate:missing_time_anchor:' || v_row.application_id::text || ':' || coalesce(v_row.stage, 'none')
      else
        'candidate:' || v_issue_type || ':' || v_row.application_id::text
    end;

    insert into public.followup_candidate_issues(
      issue_key, application_id, stage, normalized_email, member_user_id,
      issue_type, status, reason, detail,
      first_detected_at, last_detected_at
    ) values (
      v_issue_key,
      v_row.application_id,
      case when v_issue_type in ('contract_not_sent','missing_time_anchor','book_configuration_conflict')
        then v_row.stage else null end,
      v_row.normalized_email,
      v_row.member_user_id,
      v_issue_type,
      'held',
      v_row.reason,
      v_row.detail,
      p_scan_at,
      p_scan_at
    )
    on conflict (issue_key) do update
    set last_detected_at = excluded.last_detected_at,
        status = 'held',
        resolved_at = null,
        detail = excluded.detail,
        updated_at = now();

    update public.followup_jobs j
    set status = 'held',
        held_at = p_scan_at,
        held_kind = 'candidate_data',
        held_reason = v_row.reason,
        next_action_at = null,
        active_run_id = p_request_id,
        updated_at = now()
    where j.application_id = v_row.application_id
      and j.candidate_first_seen_at is not null
      and j.status in ('scheduled','awaiting_review');
    get diagnostics v_affected = row_count;
    v_held_jobs := v_held_jobs + v_affected;
  end loop;

  -- Normal and stale candidates become exactly one terminally classified job.
  for v_row in
    select *
    from public.followup_candidate_preview(p_scan_at) p
    where p.decision in ('normal','stale')
      and (
        v_runtime.operation_mode <> 'test_one'
        or p.normalized_email = v_test_email
      )
    order by p.application_id, p.stage
  loop
    v_job_id := null;
    insert into public.followup_jobs(
      application_id, user_id, email, stage, reason, progress_percent,
      scheduled_at, deadline_snapshot, status, next_action_at,
      skipped_at, skip_reason, active_run_id,
      eligible_at, draft_due_at, fresh_until_at,
      candidate_first_seen_at, candidate_missed_at, candidate_basis
    ) values (
      v_row.application_id,
      v_row.member_user_id,
      v_row.normalized_email,
      v_row.stage,
      'candidate:' || v_row.reason,
      v_row.progress_percent,
      v_row.scheduled_at,
      v_row.deadline_at,
      case when v_row.decision = 'stale' then 'skipped' else 'scheduled' end,
      case when v_row.decision = 'normal' then v_row.draft_due_at else null end,
      case when v_row.decision = 'stale' then p_scan_at else null end,
      case when v_row.decision = 'stale' then 'outside_freshness' else null end,
      p_request_id,
      v_row.eligible_at,
      v_row.draft_due_at,
      v_row.fresh_until_at,
      p_scan_at,
      case when v_row.decision = 'stale' and v_incident_eligible
        then p_scan_at else null end,
      v_row.detail
    )
    on conflict (application_id, stage) do nothing
    returning id into v_job_id;

    if v_job_id is not null then
      if v_row.decision = 'normal' then
        v_scheduled := v_scheduled + 1;
        perform public.followup_log_event(
          v_job_id,
          'candidate_scheduled',
          'candidate:' || v_row.application_id::text || ':' || v_row.stage || ':recorded',
          v_row.detail,
          p_request_id
        );
      else
        v_skipped := v_skipped + 1;
        perform public.followup_log_event(
          v_job_id,
          'job_skipped',
          'candidate:' || v_row.application_id::text || ':' || v_row.stage || ':recorded',
          v_row.detail || jsonb_build_object('reason', 'outside_freshness'),
          p_request_id
        );
        if v_incident_eligible then
          v_missed := v_missed + 1;
          perform public.followup_log_event(
            v_job_id,
            'candidate_missed',
            'candidate_missed:' || v_row.application_id::text || ':' || v_row.stage,
            v_row.detail || jsonb_build_object(
              'previous_successful_scan_at', v_state.last_production_scan_at,
              'detected_at', p_scan_at
            ),
            p_request_id
          );
        end if;
      end if;
    end if;
  end loop;

  if v_is_production then
    update public.followup_candidate_issues issue
    set status = 'resolved',
        resolved_at = p_scan_at,
        updated_at = now()
    where issue.status = 'held'
      and issue.application_id is not null
      and not exists (
        select 1
        from public.followup_candidate_preview(
          p_scan_at, null, true
        ) current_preview
        where current_preview.application_id = issue.application_id
          and current_preview.decision = 'held'
          and (
            issue.stage is null
            or current_preview.stage = issue.stage
          )
      );

    update public.followup_candidate_state
    set production_baseline_at = coalesce(production_baseline_at, p_scan_at),
        last_production_scan_at = case
          when last_production_scan_at is null then p_scan_at
          else greatest(last_production_scan_at, p_scan_at)
        end,
        last_production_request_id = case
          when last_production_scan_at is null or p_scan_at >= last_production_scan_at
            then p_request_id
          else last_production_request_id
        end,
        updated_at = now()
    where singleton_id = 1;
  end if;

  select count(*) into v_issues
  from public.followup_candidate_issues
  where last_detected_at = p_scan_at;

  v_write_counts := jsonb_build_object(
    'scheduled', v_scheduled,
    'skipped', v_skipped,
    'candidate_missed', v_missed,
    'issues', v_issues,
    'held_jobs', v_held_jobs,
    'canceled', v_canceled,
    'rescheduled', v_rescheduled
  );
  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'scan_at', p_scan_at,
    'operation_mode', v_runtime.operation_mode,
    'preview', v_preview_counts,
    'written', v_write_counts,
    'baseline_was_set', v_baseline_was_set,
    'external_calls', 0
  );

  insert into public.followup_candidate_requests(
    request_id, scan_at, operation_mode, test_email,
    baseline_was_set, preview_counts, write_counts, result
  ) values (
    p_request_id,
    p_scan_at,
    v_runtime.operation_mode,
    case when v_runtime.operation_mode = 'test_one' then v_test_email end,
    v_baseline_was_set,
    v_preview_counts,
    v_write_counts,
    v_result
  );
  return v_result;
end;
$$;

create or replace function public.followup_resolve_candidate_data_hold(
  p_job_id uuid,
  p_request_id uuid,
  p_checked_at timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.followup_jobs%rowtype;
  v_preview record;
  v_key text := 'job:' || p_job_id::text || ':candidate-data-resolved:' || p_request_id::text;
begin
  if p_job_id is null or p_request_id is null or p_checked_at is null then
    raise exception 'job, request and checked time are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('followup_candidate_record_v4', 0));
  select * into v_job
  from public.followup_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'job not found';
  end if;

  if exists (
    select 1 from public.followup_activity_logs
    where event_key = v_key and job_id = p_job_id
  ) then
    return to_jsonb(v_job);
  end if;
  if v_job.status <> 'held' or v_job.held_kind <> 'candidate_data' then
    raise exception 'job is not on a candidate data hold';
  end if;
  if v_job.candidate_first_seen_at is null then
    raise exception 'legacy jobs cannot use candidate data resolution';
  end if;

  select * into v_preview
  from public.followup_candidate_preview(p_checked_at, p_job_id) p
  where p.application_id = v_job.application_id
    and p.stage = v_job.stage;
  if not found then
    raise exception 'candidate cannot be re-evaluated for its stored stage';
  end if;
  if v_preview.decision = 'held' then
    raise exception 'candidate data conflict still exists: %', v_preview.reason;
  end if;
  if v_preview.decision = 'not_ready' then
    raise exception 'candidate is not ready after data correction: %', v_preview.reason;
  end if;

  perform set_config('followup.candidate_data_resolution', 'allowed', true);
  if v_preview.decision = 'normal' then
    update public.followup_jobs
    set status = 'scheduled',
        held_at = null,
        held_kind = null,
        held_reason = null,
        reason = 'candidate:resolved',
        progress_percent = v_preview.progress_percent,
        deadline_snapshot = v_preview.deadline_at,
        eligible_at = v_preview.eligible_at,
        draft_due_at = v_preview.draft_due_at,
        scheduled_at = v_preview.scheduled_at,
        fresh_until_at = v_preview.fresh_until_at,
        next_action_at = v_preview.draft_due_at,
        candidate_basis = v_preview.detail,
        active_run_id = p_request_id,
        updated_at = now()
    where id = p_job_id
    returning * into v_job;
  elsif v_preview.decision = 'stale' then
    update public.followup_jobs
    set status = 'skipped',
        held_at = null,
        held_kind = null,
        held_reason = null,
        skipped_at = p_checked_at,
        skip_reason = 'outside_freshness_after_candidate_data_resolution',
        progress_percent = v_preview.progress_percent,
        deadline_snapshot = v_preview.deadline_at,
        eligible_at = v_preview.eligible_at,
        draft_due_at = v_preview.draft_due_at,
        scheduled_at = v_preview.scheduled_at,
        fresh_until_at = v_preview.fresh_until_at,
        next_action_at = null,
        candidate_basis = v_preview.detail,
        active_run_id = p_request_id,
        updated_at = now()
    where id = p_job_id
    returning * into v_job;
  else
    update public.followup_jobs
    set status = 'canceled',
        held_at = null,
        held_kind = null,
        held_reason = null,
        cancel_requested_at = p_checked_at,
        canceled_at = p_checked_at,
        cancel_reason = 'candidate_resolution:' || v_preview.reason,
        next_action_at = null,
        active_run_id = p_request_id,
        candidate_basis = v_preview.detail,
        updated_at = now()
    where id = p_job_id
    returning * into v_job;
  end if;
  perform set_config('followup.candidate_data_resolution', '', true);

  update public.followup_candidate_issues
  set status = 'resolved',
      resolved_at = p_checked_at,
      updated_at = now()
  where application_id = v_job.application_id
    and status = 'held'
    and not exists (
      select 1
      from public.followup_candidate_preview(
        p_checked_at, p_job_id, true
      ) current_check
      where current_check.application_id = v_job.application_id
        and current_check.decision = 'held'
    );

  perform public.followup_log_event(
    p_job_id,
    'candidate_data_resolved',
    v_key,
    jsonb_build_object(
      'decision', v_preview.decision,
      'reason', v_preview.reason,
      'checked_at', p_checked_at
    ),
    p_request_id
  );
  return to_jsonb(v_job);
exception when others then
  perform set_config('followup.candidate_data_resolution', '', true);
  raise;
end;
$$;

revoke all on function public.followup_guard_candidate_data_hold()
  from public, anon, authenticated;
grant execute on function public.followup_guard_candidate_data_hold()
  to service_role;

revoke all on function public.followup_normalize_email(text)
  from public, anon, authenticated;
revoke all on function public.followup_try_timestamptz(text)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_reply_time(jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_reply_application(text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_member_id(text,text)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_is_operating_time(timestamptz)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_schedule(timestamptz,boolean)
  from public, anon, authenticated;
revoke all on function public.followup_candidate_preview(timestamptz,uuid,boolean)
  from public, anon, authenticated;
revoke all on function public.followup_record_candidates(uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.followup_resolve_candidate_data_hold(uuid,uuid,timestamptz)
  from public, anon, authenticated;

grant execute on function public.followup_normalize_email(text) to service_role;
grant execute on function public.followup_try_timestamptz(text) to service_role;
grant execute on function public.followup_candidate_reply_time(jsonb,timestamptz) to service_role;
grant execute on function public.followup_candidate_reply_application(text,timestamptz) to service_role;
grant execute on function public.followup_candidate_member_id(text,text) to service_role;
grant execute on function public.followup_candidate_is_operating_time(timestamptz) to service_role;
grant execute on function public.followup_candidate_schedule(timestamptz,boolean) to service_role;
grant execute on function public.followup_candidate_preview(timestamptz,uuid,boolean) to service_role;
grant execute on function public.followup_record_candidates(uuid,timestamptz) to service_role;
grant execute on function public.followup_resolve_candidate_data_hold(uuid,uuid,timestamptz) to service_role;

commit;
