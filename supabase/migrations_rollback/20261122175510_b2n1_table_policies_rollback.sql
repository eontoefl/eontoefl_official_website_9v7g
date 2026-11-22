-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-1 되돌리기
-- 대상: supabase/migrations/20261122175510_b2n1_table_policies.sql 이 만든 규칙 27개만 이름으로 지운다.
--   * if exists 를 쓰지 않는다. 하나라도 없으면 그 자리에서 실패하고, 한 트랜잭션이므로 아무것도 지워지지 않는다.
--   * 기존 규칙(옛 비로그인 규칙 포함)·표 권한·RLS 설정은 건드리지 않는다.
--   * 지운 뒤 로그인 역할(authenticated)은 이 27칸에서 다시 "적용되는 허용 규칙 0개" 상태가 된다.
-- =====================================================================

begin;

-- 1. 문제 표 8개 UPDATE
drop policy b2n1_admin_update on public.tr_listening_announcement;
drop policy b2n1_admin_update on public.tr_listening_conversation;
drop policy b2n1_admin_update on public.tr_listening_lecture;
drop policy b2n1_admin_update on public.tr_reading_academic;
drop policy b2n1_admin_update on public.tr_speaking_interview;
drop policy b2n1_admin_update on public.tr_speaking_repeat;
drop policy b2n1_admin_update on public.tr_writing_discussion;
drop policy b2n1_admin_update on public.tr_writing_email;

-- 2. 문제 표 10개 DELETE
drop policy b2n1_admin_delete on public.tr_listening_announcement;
drop policy b2n1_admin_delete on public.tr_listening_conversation;
drop policy b2n1_admin_delete on public.tr_listening_lecture;
drop policy b2n1_admin_delete on public.tr_reading_academic;
drop policy b2n1_admin_delete on public.tr_speaking_interview;
drop policy b2n1_admin_delete on public.tr_speaking_repeat;
drop policy b2n1_admin_delete on public.tr_writing_discussion;
drop policy b2n1_admin_delete on public.tr_writing_email;
drop policy b2n1_admin_delete on public.tr_listening_response;
drop policy b2n1_admin_delete on public.tr_writing_arrange;

-- 3. aus_intspk SELECT
drop policy b2n1_member_or_admin_select on public.aus_intspk;

-- 4. toefl_actual_scores SELECT·INSERT·UPDATE·DELETE
drop policy b2n1_own_or_admin_select on public.toefl_actual_scores;
drop policy b2n1_admin_insert on public.toefl_actual_scores;
drop policy b2n1_admin_update on public.toefl_actual_scores;
drop policy b2n1_admin_delete on public.toefl_actual_scores;

-- 5. note3_store SELECT·INSERT·UPDATE·DELETE
drop policy b2n1_admin_select on public.note3_store;
drop policy b2n1_admin_insert on public.note3_store;
drop policy b2n1_admin_update on public.note3_store;
drop policy b2n1_admin_delete on public.note3_store;

-- 6. 남은 것이 없는지(있으면 전체가 되돌아간다)
do $b2n1_rb$
declare
  v_left bigint;
begin
  select pg_catalog.count(*)
    into v_left
    from pg_catalog.pg_policies p
   where p.policyname like 'b2n1\_%';
  if v_left <> 0 then
    raise exception 'b2n1 되돌리기 실패: b2n1_ 규칙이 % 개 남아 있음', v_left;
  end if;
end;
$b2n1_rb$;

commit;
