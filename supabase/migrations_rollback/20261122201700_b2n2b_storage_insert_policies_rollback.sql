-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2b 되돌리기
-- 대상: supabase/migrations/20261122201700_b2n2b_storage_insert_policies.sql 이 만든 규칙 4개만 이름으로 지운다.
--   * if exists 를 쓰지 않는다. 하나라도 없으면 그 자리에서 실패하고, 한 트랜잭션이므로 아무것도 지워지지 않는다.
--   * 기존 규칙(옛 비로그인 규칙 포함)·버킷 설정·표 권한·RLS 설정·객체 행은 건드리지 않는다.
--   * 지운 뒤 로그인 역할(authenticated)은 toefl-score-images·board-files 에서 다시
--     "적용되는 올리기 규칙 0개" 상태가 된다. 이미 올라간 파일은 지워지지 않는다.
--   * 이 파일은 작업방이 실행해 보지 않았다.
-- =====================================================================

begin;

drop policy b2n2b_score_member_insert on storage.objects;
drop policy b2n2b_score_admin_insert on storage.objects;
drop policy b2n2b_board_member_insert on storage.objects;
drop policy b2n2b_board_admin_insert on storage.objects;

-- 남은 것이 없는지(있으면 전체가 되돌아간다)
do $b2n2b_rb$
declare
  v_left bigint;
begin
  select pg_catalog.count(*)
    into v_left
    from pg_catalog.pg_policy pol
   where pol.polname::pg_catalog.text like 'b2n2b\_%';
  if v_left <> 0 then
    raise exception 'b2n2b 되돌리기 실패: b2n2b_ 규칙이 % 개 남아 있음', v_left;
  end if;
end;
$b2n2b_rb$;

commit;
