-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 공통 확인 설정 걸기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★  운영에서 실행하지 않는다(모든 API 요청이 공통 확인을 거치게 된다).
--   실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 7단계.
--
-- 하는 일: authenticator 역할에 pgrst.db_pre_request = 'security_private.check_api_request' 를 건다(2-가 절차 5-0 과 같은 명령).
-- 걸기 전에 확인하는 것(다르면 아무것도 바꾸지 않고 멈춘다)
--   0. 대상 확인 값(같은 요청의 맨 앞: set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';)
--   1. 2-가의 security_private.check_api_request() 가 있다
--   2. pgrst.db_pre_request 설정이 **어디에도 아직 없다**(어떤 역할·어떤 값이든 이미 있으면 건드리지 않고 멈춘다)
-- 먼저 state_snapshot.sql 을 떠서 저장해 둔다(S0). 풀기: hook_off.sql
-- 마지막 결과(한 칸 jsonb): 지금의 pre_request 항목
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_n bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 공통 확인 걸기 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;
  if pg_catalog.to_regprocedure('security_private.check_api_request()') is null then
    raise exception 'zzb3p0 공통 확인 걸기 중단: security_private.check_api_request() 가 없다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_db_role_setting s
    cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
   where pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1;
  if v_n <> 0 then
    raise exception 'zzb3p0 공통 확인 걸기 중단: pgrst.db_pre_request 설정이 이미 %건 있다. 건드리지 않는다 — 무엇이 걸려 있는지 확인할 것', v_n;
  end if;
end;
$zz_b3p0$;

alter role authenticator set pgrst.db_pre_request = 'security_private.check_api_request';

commit;

reset b3_0.test_project_ref;
notify pgrst, 'reload config';

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'set pgrst.db_pre_request on authenticator',
  'pre_request_items', (
    select coalesce(pg_catalog.jsonb_agg(cfg.item order by cfg.item), '[]'::pg_catalog.jsonb)
      from pg_catalog.pg_db_role_setting s
      join pg_catalog.pg_roles r on r.oid = s.setrole
      cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
     where r.rolname = 'authenticator'
       and pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1
  )
) as result;
