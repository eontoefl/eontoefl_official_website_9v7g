-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 합성 회원 자료 내리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 다시 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 지우는 것: fixtures_up.sql 이 만든 것만.
--   * public.users 의 표식 있는 합성 회원 행(email 이 zzb3p0_…@member.zzb3p0.invalid) — 많아야 6행
--   * 그 회원들의 security_private.member_identity 행
--   * 합성 로그인 계정 zzb3p0_g · zzb3p0_gm 의 security_private.admin_principal 행 — 많아야 2행
--   * 절차의 점검 단계가 넣은, 합성 로그인 계정의 security_private.maintenance_exception 행(남아 있으면)
--   합성 로그인 계정(auth.users) 자체는 이 파일이 지우지 않는다 — 브레인방이 로그인 서버로 지운다(절차.md).
--   이 파일을 먼저 실행하고 그다음에 계정을 지운다.
-- 멈추는 조건(아무것도 지우지 않는다)
--   * 대상 확인 값이 없다
--   * 점검 상태가 normal 이 아니거나, 공통 확인 설정(pgrst.db_pre_request)이 걸려 있다(절차의 원복을 먼저 한다)
--   * 지워질 행이 위의 수보다 많다(표식이 붙은 다른 행이 있다는 뜻이다)
--
-- 실행 방법: 같은 요청(같은 접속)의 맨 앞에  set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';  를 두고 이 파일 전체.
-- 마지막 결과(한 행): 남은 합성 회원 행·대응·명부·예외 수(전부 0 이어야 한다)
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_phase text;
  v_n     bigint;
  v_users bigint;
  v_maps  bigint;
  v_admin bigint;
  v_exc   bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 내리기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b3_0.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  select ss.phase into v_phase from security_private.site_state ss where ss.id = 1;
  if v_phase is distinct from 'normal' then
    raise exception 'zzb3p0 내리기 중단: 점검 상태가 normal 이 아니다(%). 절차의 원복을 먼저 할 것. 아무것도 바꾸지 않았다', coalesce(v_phase, '(행 없음)');
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_db_role_setting s
    cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
   where pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1;
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: 공통 확인 설정(pgrst.db_pre_request)이 걸려 있다. 절차의 원복을 먼저 할 것. 아무것도 바꾸지 않았다';
  end if;

  delete from security_private.maintenance_exception me
   where me.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%');
  get diagnostics v_exc = row_count;

  delete from security_private.admin_principal ap
   where ap.auth_user_id in (select au.id from auth.users au
                              where pg_catalog.split_part(au.email, '@', 1) in ('zzb3p0_g', 'zzb3p0_gm'));
  get diagnostics v_admin = row_count;

  delete from security_private.member_identity mi
   where mi.member_id in (select u.id from public.users u where u.email like 'zzb3p0\_%@member.zzb3p0.invalid');
  get diagnostics v_maps = row_count;

  delete from public.users u
   where u.email like 'zzb3p0\_%@member.zzb3p0.invalid';
  get diagnostics v_users = row_count;

  if v_users > 6 or v_maps > 6 or v_admin > 2 then
    raise exception 'zzb3p0 내리기 중단: 지워질 행이 만든 수보다 많다(회원 % · 대응 % · 명부 %). 전부 되돌린다', v_users, v_maps, v_admin;
  end if;
  raise notice 'zzb3p0 내리기: 회원 % · 대응 % · 명부 % · 예외 % 행을 지웠다', v_users, v_maps, v_admin, v_exc;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

select
  (select pg_catalog.count(*) from public.users u where u.email like 'zzb3p0\_%') as synthetic_users_left,
  (select pg_catalog.count(*) from security_private.member_identity mi
    where mi.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%')) as synthetic_mappings_left,
  (select pg_catalog.count(*) from security_private.admin_principal ap
    where ap.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%')) as synthetic_admin_rows_left,
  (select pg_catalog.count(*) from security_private.maintenance_exception me
    where me.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%')) as synthetic_exceptions_left;
