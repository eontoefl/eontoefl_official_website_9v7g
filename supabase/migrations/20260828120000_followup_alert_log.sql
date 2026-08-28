-- 후속메일 텔레그램 알림 중복 방지 장부.
-- 알림을 보내기 전에 한 작업자만 권한을 선점한다.

create table if not exists public.followup_alert_log (
  alert_key text primary key,
  alert_type text not null,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'claimed'
    check (status in ('claimed', 'retryable', 'sent')),
  claim_token uuid not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.followup_alert_log enable row level security;

revoke all on table public.followup_alert_log from anon, authenticated;
grant select, insert, update on table public.followup_alert_log to service_role;

create or replace function public.followup_claim_alert(
  p_alert_key text,
  p_alert_type text,
  p_detail jsonb,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
  v_status text;
begin
  insert into public.followup_alert_log (
    alert_key,
    alert_type,
    detail,
    status,
    claim_token,
    attempt_count,
    claimed_at,
    sent_at,
    last_error,
    updated_at
  ) values (
    p_alert_key,
    p_alert_type,
    coalesce(p_detail, '{}'::jsonb),
    'claimed',
    p_claim_token,
    1,
    now(),
    null,
    null,
    now()
  )
  on conflict (alert_key) do update
  set alert_type = excluded.alert_type,
      detail = excluded.detail,
      status = 'claimed',
      claim_token = excluded.claim_token,
      attempt_count = public.followup_alert_log.attempt_count + 1,
      claimed_at = now(),
      sent_at = null,
      last_error = null,
      updated_at = now()
  where public.followup_alert_log.status = 'retryable'
  returning true, status into v_claimed, v_status;

  if not found then
    select status
      into v_status
      from public.followup_alert_log
     where alert_key = p_alert_key;
  end if;

  return jsonb_build_object(
    'claimed', v_claimed,
    'status', coalesce(v_status, 'unknown')
  );
end;
$$;

create or replace function public.followup_finish_alert(
  p_alert_key text,
  p_claim_token uuid,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.followup_alert_log
     set status = case when p_success then 'sent' else 'retryable' end,
         sent_at = case when p_success then now() else null end,
         last_error = case when p_success then null else left(coalesce(p_error, 'unknown error'), 1000) end,
         updated_at = now()
   where alert_key = p_alert_key
     and claim_token = p_claim_token
     and status = 'claimed';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.followup_claim_alert(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.followup_claim_alert(text, text, jsonb, uuid) to service_role;

revoke all on function public.followup_finish_alert(text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.followup_finish_alert(text, uuid, boolean, text) to service_role;
