-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 공통 확인 설정 풀기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★  시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 를 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 7단계.
--
-- 하는 일: hook_on.sql 이 건 설정을 푼다(alter role authenticator reset pgrst.db_pre_request).
-- 풀기 전에 확인하는 것(다르면 아무것도 바꾸지 않고 멈춘다)
--   0. 대상 확인 값
--   1. 지금 걸려 있는 pgrst.db_pre_request 설정이 **이 시험이 건 값 하나뿐**이다:
--      authenticator 역할의 "모든 DB" 설정에 pgrst.db_pre_request=security_private.check_api_request 한 항목.
--      다른 값이거나, 다른 역할·다른 DB 에 걸려 있거나, 둘 이상이면 멈추고 사람에게 넘긴다.
--      (하나도 없으면 "이미 없다"고 적고 끝낸다 — 오류가 아니다)
-- 마지막 결과(한 칸 jsonb): 지금의 pre_request 항목([] 이어야 한다)
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_all  bigint;
  v_ours bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 공통 확인 풀기 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;

  select pg_catalog.count(*) into v_all
    from pg_catalog.pg_db_role_setting s
    cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
   where pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1;
  if v_all = 0 then
    raise notice 'zzb3p0 공통 확인 풀기: pgrst.db_pre_request 설정이 없다. 풀 것이 없다';
    return;
  end if;

  select pg_catalog.count(*) into v_ours
    from pg_catalog.pg_db_role_setting s
    join pg_catalog.pg_roles r on r.oid = s.setrole
    cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
   where r.rolname = 'authenticator'
     and s.setdatabase = 0
     and cfg.item = 'pgrst.db_pre_request=security_private.check_api_request';
  if v_all <> 1 or v_ours <> 1 then
    raise exception 'zzb3p0 공통 확인 풀기 중단: 지금 걸린 설정이 이 시험이 건 값 하나가 아니다(전체 %건, 이 시험의 값 %건). 아무것도 바꾸지 않았다 — 무엇이 걸려 있는지 확인할 것', v_all, v_ours;
  end if;
end;
$zz_b3p0$;

-- 위 확인을 지났을 때만 여기에 온다(설정이 하나도 없으면 아래는 아무것도 바꾸지 않는다)
alter role authenticator reset pgrst.db_pre_request;

commit;

reset b3_0.test_project_ref;
notify pgrst, 'reload config';

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'reset pgrst.db_pre_request on authenticator',
  'pre_request_items', (
    select coalesce(pg_catalog.jsonb_agg(cfg.item order by cfg.item), '[]'::pg_catalog.jsonb)
      from pg_catalog.pg_db_role_setting s
      cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
     where pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1
  )
) as result;
