-- 후속메일 매시간 작업이 멈춘 경우에만 텔레그램으로 알린다.
-- 오전 8시 30분 이전에는 야간 휴지 시간으로 보고 경보하지 않는다.

create or replace function public.followup_watchdog_tick(p_at timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_check record;
  v_kst_time time;
  v_last_success_at timestamptz;
  v_alert_key text;
  v_queue jsonb;
begin
  select * into v_check
  from public.followup_detect_missed_run(p_at);

  if not found then
    raise exception 'followup runtime row is missing';
  end if;

  v_kst_time := (p_at at time zone 'Asia/Seoul')::time;

  if not v_check.monitor_enabled then
    return jsonb_build_object(
      'monitor_enabled', false,
      'missed', false,
      'queued', false,
      'reason', 'monitor_disabled'
    );
  end if;

  if v_kst_time < time '08:30:00' then
    return jsonb_build_object(
      'monitor_enabled', true,
      'missed', false,
      'queued', false,
      'reason', 'overnight_quiet_hours',
      'last_signal_at', v_check.last_signal_at
    );
  end if;

  if not v_check.missed then
    return jsonb_build_object(
      'monitor_enabled', true,
      'missed', false,
      'queued', false,
      'reason', 'on_time',
      'last_signal_at', v_check.last_signal_at
    );
  end if;

  select r.last_success_at into v_last_success_at
  from public.followup_runtime r
  where r.singleton_id = 1;

  v_alert_key := 'missed_run:' ||
    coalesce(
      to_char(v_check.last_signal_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'none'
    );

  select public.followup_enqueue_telegram_alert(
    jsonb_build_object(
      'type', 'followup_alert',
      'data', jsonb_build_object(
        'alert_key', v_alert_key,
        'kind', 'missed_run',
        'occurred_at', p_at,
        'last_success_at', v_last_success_at,
        'reason', '매시간 후속메일 점검이 90분 넘게 정상 완료되지 않았습니다.'
      )
    )
  ) into v_queue;

  return jsonb_build_object(
    'monitor_enabled', true,
    'missed', true,
    'queued', true,
    'alert_key', v_alert_key,
    'last_signal_at', v_check.last_signal_at,
    'queue', v_queue
  );
end;
$function$;

revoke all on function public.followup_watchdog_tick(timestamptz) from public, anon, authenticated;

do $block$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'followup-missed-run-watchdog'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$block$;

select cron.schedule(
  'followup-missed-run-watchdog',
  '15,45 * * * *',
  $cron$select public.followup_watchdog_tick();$cron$
);
