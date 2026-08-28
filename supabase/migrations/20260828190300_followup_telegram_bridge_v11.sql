-- Let the Work runner request the existing Telegram Edge Function through
-- one service-role-only database call. The Edge Function keeps the durable
-- alert claim/finalize ledger and remains the only Telegram sender.

create or replace function public.followup_enqueue_telegram_alert(
  p_body jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_alert_key text;
  v_request_id bigint;
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception 'Telegram alert body must be a JSON object';
  end if;

  v_type := p_body ->> 'type';
  v_alert_key := p_body -> 'data' ->> 'alert_key';
  if v_type not in ('followup_new_drafts','followup_alert')
     or nullif(btrim(v_alert_key),'') is null then
    raise exception 'supported follow-up alert type and alert_key are required';
  end if;

  select net.http_post(
    url := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/telegram-notify',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := p_body,
    timeout_milliseconds := 10000
  ) into v_request_id;

  return jsonb_build_object(
    'queued', true,
    'request_id', v_request_id,
    'alert_key', v_alert_key
  );
end;
$$;

revoke all on function public.followup_enqueue_telegram_alert(jsonb)
  from public, anon, authenticated;
grant execute on function public.followup_enqueue_telegram_alert(jsonb)
  to service_role;
