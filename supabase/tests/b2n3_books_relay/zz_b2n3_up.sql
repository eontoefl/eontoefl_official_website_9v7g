-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-3 (나) 임시 함수 만들기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   이 파일은 시험 프로젝트에만 두는 임시 함수를 만든다. 운영(qpqjevecjejvbeuogtbx)에서 실행하지 않는다.
--   실행 직전에 절차.md 의 "임시 SQL 직전 대상 확인"을 한다: SQL 통로가 가리키는 프로젝트의 ref 가
--   hmncdheiwqwekdbtijar 여야 한다. 아래의 대상 확인 값(set b2n3.test_project_ref)은 그 확인을 대신하지 않는다 —
--   DB 는 자기 프로젝트 ref 를 스스로 알지 못한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서와 기대 결과는 같은 폴더의 절차.md 를 따른다.
--
-- 하는 일(한 트랜잭션): 함수 하나를 만든다.
--   public.zz_b2n3_whoami() returns text
--     = security_private.current_member_id_text()  (2-가의 판정 함수. 지금 로그인 기록이 살아 있고 회원 대응이 있으면
--       그 회원번호의 글자, 그 밖에는 NULL)
--     security invoker — 부르는 역할의 권한으로 2-가의 함수를 부른다(2-가가 로그인 역할에 실행 권한을 줬다).
--     실행 권한: authenticated 만. PUBLIC·anon·service_role 은 회수한다.
--   그 밖의 함수·표·규칙·권한은 건드리지 않는다. 임시 Edge 함수(zz-b2n3-relay)가 받은 회원 자격 그대로 이 함수를 부른다.
--
-- 만들기 전에 스스로 확인하는 것(하나라도 다르면 아무것도 만들지 않고 멈춘다)
--   0. 대상 확인 값: 같은 요청에서 정한 b2n3.test_project_ref 가 'hmncdheiwqwekdbtijar'
--   1. 이 DB 가 운영이 아니라는 DB 안의 증거: storage.objects 에 이 실측의 표식(zzb2n3_)이 없는 객체가 0개
--      (시험 프로젝트는 객체 0에서 시작해 합성 PDF 만 올린 상태다. 운영에는 수천 개가 있다)
--   2. 2-가의 security_private.current_member_id_text() 가 있다
--   3. public.zz_b2n3_whoami 라는 이름의 함수가 아직 없다(있으면 덮어쓰지 않는다)
--
-- 실행 방법: 같은 요청(같은 접속)의 맨 앞에  set b2n3.test_project_ref = 'hmncdheiwqwekdbtijar';  를 두고 이 파일 전체.
-- 마지막 결과(한 행): done, anon_can_execute(false), authenticated_can_execute(true), service_role_can_execute(false),
--                     public_can_execute(false)
-- =====================================================================

begin;

do $b2n3_up$
declare
  v_n bigint;
begin
  if coalesce(pg_catalog.current_setting('b2n3.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'b2n3 임시 함수 만들기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b2n3.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  select pg_catalog.count(*) into v_n
    from storage.objects o
   where o.name not like 'zzb2n3\_%';
  if v_n <> 0 then
    raise exception 'b2n3 임시 함수 만들기 중단: 이 실측의 표식(zzb2n3_)이 없는 객체가 %개 있다 — 시험 프로젝트의 시작 상태가 아니다(운영일 수 있다). 아무것도 바꾸지 않았다', v_n;
  end if;

  if pg_catalog.to_regprocedure('security_private.current_member_id_text()') is null then
    raise exception 'b2n3 임시 함수 만들기 중단: security_private.current_member_id_text() 가 없다(2-가가 적용된 DB 가 아니다). 아무것도 바꾸지 않았다';
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zz_b2n3_whoami';
  if v_n <> 0 then
    raise exception 'b2n3 임시 함수 만들기 중단: public.zz_b2n3_whoami 가 이미 있다(%개). 덮어쓰지 않는다 — zz_b2n3_down.sql 로 먼저 지울지 브레인방이 정할 것', v_n;
  end if;
end;
$b2n3_up$;

create function public.zz_b2n3_whoami()
returns text
language sql
stable
security invoker
set search_path = ''
as $b2n3$
  select security_private.current_member_id_text();
$b2n3$;

comment on function public.zz_b2n3_whoami() is 'b2n3 임시(시험 프로젝트 전용): 계약 2-나-3 (나) 실측이 끝나면 zz_b2n3_down.sql 로 지운다';

revoke all on function public.zz_b2n3_whoami() from public, anon, authenticated, service_role;
grant execute on function public.zz_b2n3_whoami() to authenticated;

-- 스스로 점검: 실행 권한이 authenticated 에만 있는가(아니면 전부 되돌린다)
do $b2n3_check$
declare
  v_fn constant pg_catalog.regprocedure := 'public.zz_b2n3_whoami()'::pg_catalog.regprocedure;
  v_public boolean;
begin
  select exists (
    select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(p.proacl) a
     where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_public;
  if v_public
     or pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'b2n3 임시 함수 만들기 중단: 실행 권한이 authenticated 에만 있지 않다. 전부 되돌린다';
  end if;
end;
$b2n3_check$;

commit;

reset b2n3.test_project_ref;

-- REST 통로가 새 함수를 알도록(보통은 DDL 뒤에 스스로 다시 읽는다 — 그래도 한 번 알린다. 아무 자료도 바꾸지 않는다)
notify pgrst, 'reload schema';

select
  'created public.zz_b2n3_whoami()' as done,
  pg_catalog.has_function_privilege('anon', 'public.zz_b2n3_whoami()', 'EXECUTE') as anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', 'public.zz_b2n3_whoami()', 'EXECUTE') as authenticated_can_execute,
  pg_catalog.has_function_privilege('service_role', 'public.zz_b2n3_whoami()', 'EXECUTE') as service_role_can_execute,
  exists (
    select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.zz_b2n3_whoami()'::pg_catalog.regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) as public_can_execute;
