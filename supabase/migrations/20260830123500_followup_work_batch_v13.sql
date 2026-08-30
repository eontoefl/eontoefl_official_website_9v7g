-- Give the hourly worker one authoritative queue that is independent from
-- newly discovered candidate counts.

create or replace function public.followup_get_work_batch(
  p_at timestamptz default now(),
  p_limit integer default 20
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_runtime public.followup_runtime%rowtype;
  v_limit integer;
  v_items jsonb;
begin
  if p_at is null then
    raise exception 'work batch time is required';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 20);

  select * into v_runtime
  from public.followup_runtime
  where singleton_id = 1;

  if not found then
    raise exception 'followup runtime is missing';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.due_at, q.job_id), '[]'::jsonb)
  into v_items
  from (
    select
      j.id as job_id,
      'write_draft'::text as work_type,
      j.stage,
      j.draft_due_at as due_at,
      j.scheduled_at,
      j.fresh_until_at
    from public.followup_jobs j
    where j.status = 'scheduled'
      and j.candidate_first_seen_at is not null
      and j.draft_due_at <= p_at
      and j.fresh_until_at > p_at

    union all

    select
      j.id as job_id,
      'recheck_validation'::text as work_type,
      j.stage,
      coalesce(j.held_at, j.updated_at) as due_at,
      j.scheduled_at,
      j.fresh_until_at
    from public.followup_jobs j
    join public.followup_messages m on m.job_id = j.id
    where j.status = 'held'
      and j.held_kind = 'validation'
      and j.candidate_first_seen_at is not null
      and j.fresh_until_at > p_at
      and m.review_status = 'pending'

    order by due_at, job_id
    limit v_limit
  ) q;

  return jsonb_build_object(
    'checked_at', p_at,
    'operation_mode', v_runtime.operation_mode,
    'send_locked', v_runtime.send_locked,
    'count', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$$;

revoke all on function public.followup_get_work_batch(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.followup_get_work_batch(timestamptz, integer)
  to service_role;
