-- Stage 7 correction: candidate discovery writes jobs in draft_only/test_one/live,
-- so the writer must accept those modes and reject observe. Keep the full prior
-- function body intact and fail the migration if the expected v5 guard changed.
do $migration$
declare
  v_definition text;
  v_before text := $old$  if not found or v_runtime.operation_mode <> 'observe' or v_runtime.send_locked is distinct from true then
    raise exception 'writing requires operation_mode=observe and send_locked=true';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;$old$;
  v_after text := $new$  if not found then
    raise exception 'followup runtime is missing';
  end if;
  if v_runtime.operation_mode = 'observe' then
    raise exception 'writing is disabled in observe mode';
  end if;
  select * into v_job from public.followup_jobs where id=p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if v_runtime.operation_mode = 'test_one'
     and public.followup_normalize_email(v_job.email)
         is distinct from public.followup_normalize_email(v_runtime.test_email) then
    raise exception 'test_one mode only permits the configured test email';
  end if;$new$;
begin
  select pg_get_functiondef('public.followup_get_writing_context(uuid)'::regprocedure)
    into v_definition;

  if strpos(v_definition, v_before) = 0 then
    raise exception 'followup_get_writing_context v5 guard was not found';
  end if;

  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$migration$;
