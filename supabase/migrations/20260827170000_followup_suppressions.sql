-- 004_followup_suppressions.sql
-- 후속메일 영구 발송 제외 목록.
-- 대표/직원/시험용 계정 및 명시적으로 연락 중단을 요청한 학생을 모든 단계에서 제외한다.

begin;

create table if not exists public.followup_suppressions (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  email       text,
  label       text,
  reason      text not null,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint followup_suppressions_identity_required
    check (user_id is not null or nullif(btrim(email), '') is not null),
  constraint followup_suppressions_reason_check
    check (reason in ('internal', 'test', 'do_not_contact', 'manual'))
);

comment on table public.followup_suppressions is
  '후속메일 전 단계 영구 발송 제외 목록. 활성 user_id 또는 정규화 이메일이 일치하면 후보에서 제외한다.';

create unique index if not exists followup_suppressions_active_user_uidx
  on public.followup_suppressions (user_id)
  where active = true and user_id is not null;

create unique index if not exists followup_suppressions_active_email_uidx
  on public.followup_suppressions (lower(btrim(email)))
  where active = true and nullif(btrim(email), '') is not null;

create index if not exists followup_suppressions_active_created_idx
  on public.followup_suppressions (created_at desc)
  where active = true;

alter table public.followup_suppressions enable row level security;

revoke all on table public.followup_suppressions from anon, authenticated;
grant select, insert, update, delete on table public.followup_suppressions to service_role;
grant usage, select on sequence public.followup_suppressions_id_seq to service_role;

commit;
