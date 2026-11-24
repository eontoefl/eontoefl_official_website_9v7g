-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-3 (나) 임시 함수 지우기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   시험 프로젝트 전용이다. 실행 직전에 절차.md 의 "임시 SQL 직전 대상 확인"을 다시 한다: SQL 통로가 가리키는
--   프로젝트의 ref 가 hmncdheiwqwekdbtijar 여야 한다. 아래의 대상 확인 값은 그 확인을 대신하지 않는다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 하는 일(한 트랜잭션): public.zz_b2n3_whoami() 한 개만 지운다. 그 밖의 것은 건드리지 않는다(cascade 를 쓰지 않는다 —
--   이 함수에 기대는 것이 있으면 지우지 못하고 멈춘다).
-- 지우기 전에 스스로 확인하는 것(다르면 아무것도 지우지 않고 멈춘다)
--   0. 대상 확인 값: 같은 요청에서 정한 b2n3.test_project_ref 가 'hmncdheiwqwekdbtijar'
--   1. public.zz_b2n3_whoami 라는 이름의 함수가 정확히 하나이고, 인자가 없으며, 설명에 이 실측의 표식(b2n3 임시)이 있다
--      (함수가 하나도 없으면 "지울 것이 없다"고 적고 끝낸다 — 오류가 아니다)
--
-- 실행 방법: 같은 요청(같은 접속)의 맨 앞에  set b2n3.test_project_ref = 'hmncdheiwqwekdbtijar';  를 두고 이 파일 전체.
-- 마지막 결과(한 행): zz_b2n3_functions_left(0 이어야 한다)
-- =====================================================================

begin;

do $b2n3_down$
declare
  v_n bigint;
  v_args integer;
  v_comment text;
begin
  if coalesce(pg_catalog.current_setting('b2n3.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'b2n3 임시 함수 지우기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b2n3.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zz_b2n3_whoami';

  if v_n = 0 then
    raise notice 'b2n3 임시 함수 지우기: public.zz_b2n3_whoami 가 없다. 지울 것이 없다';
    return;
  end if;
  if v_n <> 1 then
    raise exception 'b2n3 임시 함수 지우기 중단: public.zz_b2n3_whoami 라는 이름의 함수가 %개다(하나여야 한다). 아무것도 지우지 않았다', v_n;
  end if;

  select p.pronargs, pg_catalog.obj_description(p.oid, 'pg_proc')
    into v_args, v_comment
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zz_b2n3_whoami';
  if v_args <> 0 or coalesce(v_comment, '') not like 'b2n3 임시%' then
    raise exception 'b2n3 임시 함수 지우기 중단: 그 함수가 이 실측이 만든 것이 아니다(인자 %개, 설명 %). 아무것도 지우지 않았다', v_args, coalesce(v_comment, '(없음)');
  end if;

  drop function public.zz_b2n3_whoami();
end;
$b2n3_down$;

commit;

reset b2n3.test_project_ref;

notify pgrst, 'reload schema';

select pg_catalog.count(*) as zz_b2n3_functions_left
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'zz\_b2n3\_%';
