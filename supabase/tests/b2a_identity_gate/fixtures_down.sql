-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-가 시험 전용 객체 내리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서는 같은 폴더의 절차.md 를 따른다.
--   * fixtures_up.sql 이 만든 zz_b2a_ 객체만 지운다. cascade 를 쓰지 않는다.
--   * 표의 정책은 표와 함께 지워진다.
--   * 공통 확인 설정(pgrst.db_pre_request)의 원복은 이 파일보다 먼저 한다(절차.md 6단계).
--   * 시험 중에 넣은 합성 자료(security_private 표의 행, public.users 의 합성 회원, 합성 로그인 계정)는
--     이 파일이 지우지 않는다. 절차.md 7단계의 순서대로 지운다.
-- =====================================================================

begin;

drop function public.zz_b2a_private_table_probe() restrict;
drop function public.zz_b2a_resolve_grant_invoker(text, text) restrict;
drop function public.zz_b2a_call_invoker(text) restrict;
drop function public.zz_b2a_probe() restrict;

drop table public.zz_b2a_member_row_text restrict;
drop table public.zz_b2a_member_row restrict;
drop table public.zz_b2a_admin_flag restrict;
drop table public.zz_b2a_open_row restrict;

-- 남은 것이 없는지 확인(있으면 전체가 되돌아간다)
do $zz_b2a$
declare
  v_left bigint;
begin
  select pg_catalog.count(*)
    into v_left
    from pg_catalog.pg_class c
   where c.relname like 'zz\_b2a\_%';
  if v_left <> 0 then
    raise exception 'zz_b2a 내리기 실패: 표·색인 등 % 개가 남아 있음', v_left;
  end if;

  select pg_catalog.count(*)
    into v_left
    from pg_catalog.pg_proc p
   where p.proname like 'zz\_b2a\_%';
  if v_left <> 0 then
    raise exception 'zz_b2a 내리기 실패: 함수 % 개가 남아 있음', v_left;
  end if;

  select pg_catalog.count(*)
    into v_left
    from pg_catalog.pg_policy p
   where p.polname like 'zz\_b2a\_%';
  if v_left <> 0 then
    raise exception 'zz_b2a 내리기 실패: 정책 % 개가 남아 있음', v_left;
  end if;
end;
$zz_b2a$;

commit;
