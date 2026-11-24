-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 합성 회원 자료 내리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용) — 2차 판
--
-- ★★★ 운영 경고 ★★★
--   시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 다시 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 지우는 것: fixtures_up.sql 이 만든 것만 — **이름의 앞부분(접두어)으로 찾지 않는다.**
--   같은 요청에서 넘겨받은 정확한 값(fixtures_up.sql 의 마지막 결과 down_input)과 일치하는 행만 지운다.
--     set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3_0.created = '<expect.json 의 down_input 글자 그대로>';
--   그 값의 모양: {"users":[{"id":…,"email":…} ×7], "mappings":[{"auth_user_id":…,"member_id":…} ×6], "admins":[계정 번호 ×2]}
--   * public.users                      회원번호와 전체 이메일이 둘 다 같은 행 — 정확히 7행
--   * security_private.member_identity  계정 번호와 회원번호가 둘 다 같은 행 — 정확히 6행
--   * security_private.admin_principal  계정 번호가 같은 행 — 정확히 2행
--   합성 로그인 계정(auth.users)은 이 파일이 지우지 않는다(브레인방이 로그인 서버에서 정확한 계정 번호로 지운다).
--   점검 예외(security_private.maintenance_exception)도 이 파일이 지우지 않는다(maint_off.sql 이 그 한 행을 지운다).
--
-- 지우기 전에 확인하는 것(하나라도 다르면 **아무것도 지우기 전에** 멈춘다)
--   0. 대상 확인 값
--   1. 점검 상태가 normal 이고 공통 확인 설정(pgrst.db_pre_request)이 걸려 있지 않다(원복을 먼저 한다)
--   2. 넘겨받은 값의 모양: 수가 정확히 7·6·2, 번호가 uuid 모양, 이메일이 이 시험의 일곱 이메일 중 하나이고 서로 다름,
--      대응의 회원번호가 전부 넘겨받은 회원 행의 번호
--   3. 넘겨받은 목록의 행이 **지금 그 값 그대로 전부 있다**(회원 행 7 · 대응 6 · 명부 2)
--   4. 넘겨받은 계정·회원에 이 목록 밖의 대응 행이 없다, 그 계정의 점검 예외 행이 남아 있지 않다
-- 지운 뒤: 지워진 수가 정확히 7·6·2 가 아니면 전체가 되돌아간다.
--
-- 마지막 결과(한 행): 넘겨받은 값과 일치하는 남은 행의 수(전부 0 이어야 한다)
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_emails constant text[] := array['zzb3p0_a@member.zzb3p0.invalid', 'zzb3p0_b@member.zzb3p0.invalid', 'zzb3p0_gm@member.zzb3p0.invalid',
                                    'zzb3p0_blk@member.zzb3p0.invalid', 'zzb3p0_wd@member.zzb3p0.invalid', 'zzb3p0_bw@member.zzb3p0.invalid',
                                    'zzb3p0_trap@member.zzb3p0.invalid'];
  v_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_raw    text := coalesce(pg_catalog.current_setting('b3_0.created', true), '');
  v_j      pg_catalog.jsonb;
  v_phase  text;
  v_n      bigint;
  v_users  bigint;
  v_maps   bigint;
  v_admin  bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 내리기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b3_0.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  -- 1. 점검·공통 확인 설정이 시작 상태인가
  select ss.phase into v_phase from security_private.site_state ss where ss.id = 1;
  if v_phase is distinct from 'normal' then
    raise exception 'zzb3p0 내리기 중단: 점검 상태가 normal 이 아니다(%). maint_off.sql 로 원복을 먼저 할 것. 아무것도 바꾸지 않았다', coalesce(v_phase, '(행 없음)');
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_db_role_setting s
    cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
   where pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1;
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: 공통 확인 설정(pgrst.db_pre_request)이 걸려 있다. hook_off.sql 로 원복을 먼저 할 것. 아무것도 바꾸지 않았다';
  end if;

  -- 2. 넘겨받은 값의 모양
  if v_raw = '' then
    raise exception 'zzb3p0 내리기 중단: 지울 대상의 정확한 값을 받지 못했다. 같은 요청에서 set b3_0.created = ''<fixtures_up.sql 결과의 down_input>''; 을 둘 것. 아무것도 바꾸지 않았다';
  end if;
  begin
    v_j := v_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3p0 내리기 중단: b3_0.created 의 값이 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j -> 'users') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_j -> 'mappings') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_j -> 'admins') is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_j -> 'users') <> 7
     or pg_catalog.jsonb_array_length(v_j -> 'mappings') <> 6
     or pg_catalog.jsonb_array_length(v_j -> 'admins') <> 2 then
    raise exception 'zzb3p0 내리기 중단: b3_0.created 의 모양이 users 7 · mappings 6 · admins 2 가 아니다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
   where coalesce(e.x ->> 'id', '') !~ v_uuid or not (coalesce(e.x ->> 'email', '') = any (v_emails));
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: b3_0.created 의 users 에 회원번호 모양이 아니거나 이 시험의 이메일이 아닌 것이 %개 있다. 아무것도 바꾸지 않았다', v_n;
  end if;
  select pg_catalog.count(distinct e.x ->> 'email') into v_n from pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x);
  if v_n <> 7 then
    raise exception 'zzb3p0 내리기 중단: b3_0.created 의 users 의 이메일이 서로 다른 일곱 개가 아니다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.jsonb_array_elements(v_j -> 'mappings') as e(x)
   where coalesce(e.x ->> 'auth_user_id', '') !~ v_uuid
      or coalesce(e.x ->> 'member_id', '') !~ v_uuid
      or not exists (select 1 from pg_catalog.jsonb_array_elements(v_j -> 'users') as u(x) where u.x ->> 'id' = e.x ->> 'member_id');
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: b3_0.created 의 mappings 에 번호 모양이 아니거나 넘겨받은 회원 행이 아닌 것을 가리키는 것이 %개 있다. 아무것도 바꾸지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.jsonb_array_elements_text(v_j -> 'admins') as e(x)
   where e.x !~ v_uuid;
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: b3_0.created 의 admins 에 계정 번호 모양이 아닌 것이 있다. 아무것도 바꾸지 않았다';
  end if;

  -- 3. 넘겨받은 목록의 행이 지금 그 값 그대로 전부 있는가
  select pg_catalog.count(*) into v_users
    from public.users u
    join pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
      on u.id = (e.x ->> 'id')::pg_catalog.uuid and u.email = e.x ->> 'email';
  select pg_catalog.count(*) into v_maps
    from security_private.member_identity mi
    join pg_catalog.jsonb_array_elements(v_j -> 'mappings') as e(x)
      on mi.auth_user_id = (e.x ->> 'auth_user_id')::pg_catalog.uuid and mi.member_id = (e.x ->> 'member_id')::pg_catalog.uuid;
  select pg_catalog.count(*) into v_admin
    from security_private.admin_principal ap
    join pg_catalog.jsonb_array_elements_text(v_j -> 'admins') as e(x)
      on ap.auth_user_id = e.x::pg_catalog.uuid;
  if v_users <> 7 or v_maps <> 6 or v_admin <> 2 then
    raise exception 'zzb3p0 내리기 중단: 넘겨받은 목록의 행이 지금 그 값 그대로 있지 않다(회원 행 %/7 · 대응 %/6 · 명부 %/2). 아무것도 지우지 않았다 — 무엇이 달라졌는지 확인할 것', v_users, v_maps, v_admin;
  end if;

  -- 4. 목록 밖의 것이 걸려 있지 않은가
  select pg_catalog.count(*) into v_n
    from security_private.member_identity mi
   where (mi.member_id in (select (e.x ->> 'id')::pg_catalog.uuid from pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x))
          or mi.auth_user_id in (select (e.x ->> 'auth_user_id')::pg_catalog.uuid from pg_catalog.jsonb_array_elements(v_j -> 'mappings') as e(x)))
     and not exists (
           select 1 from pg_catalog.jsonb_array_elements(v_j -> 'mappings') as e(x)
            where mi.auth_user_id = (e.x ->> 'auth_user_id')::pg_catalog.uuid and mi.member_id = (e.x ->> 'member_id')::pg_catalog.uuid);
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: 넘겨받은 계정·회원에 목록에 없는 대응 행이 %개 있다. 아무것도 지우지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n
    from security_private.maintenance_exception me
   where me.auth_user_id in (select (e.x ->> 'auth_user_id')::pg_catalog.uuid from pg_catalog.jsonb_array_elements(v_j -> 'mappings') as e(x))
      or me.auth_user_id in (select e.x::pg_catalog.uuid from pg_catalog.jsonb_array_elements_text(v_j -> 'admins') as e(x));
  if v_n <> 0 then
    raise exception 'zzb3p0 내리기 중단: 넘겨받은 계정의 점검 예외 행이 %개 남아 있다. maint_off.sql 로 원복을 먼저 할 것. 아무것도 지우지 않았다', v_n;
  end if;

  -- 지우기: 정확한 값이 둘 다 같은 행만. 지워진 수가 정확히 6·2·7 이 아니면 전체가 되돌아간다.
  delete from security_private.member_identity mi
   using pg_catalog.jsonb_array_elements(v_j -> 'mappings') as e(x)
   where mi.auth_user_id = (e.x ->> 'auth_user_id')::pg_catalog.uuid and mi.member_id = (e.x ->> 'member_id')::pg_catalog.uuid;
  get diagnostics v_maps = row_count;

  delete from security_private.admin_principal ap
   using pg_catalog.jsonb_array_elements_text(v_j -> 'admins') as e(x)
   where ap.auth_user_id = e.x::pg_catalog.uuid;
  get diagnostics v_admin = row_count;

  delete from public.users u
   using pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
   where u.id = (e.x ->> 'id')::pg_catalog.uuid and u.email = e.x ->> 'email';
  get diagnostics v_users = row_count;

  if v_users <> 7 or v_maps <> 6 or v_admin <> 2 then
    raise exception 'zzb3p0 내리기 실패: 지워진 수가 정확하지 않다(회원 행 %/7 · 대응 %/6 · 명부 %/2). 전부 되돌린다', v_users, v_maps, v_admin;
  end if;
  raise notice 'zzb3p0 내리기: 회원 행 7 · 대응 6 · 명부 2 를 지웠다';
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

-- 넘겨받은 값과 일치하는 남은 행(전부 0 이어야 한다)
select
  (select pg_catalog.count(*) from public.users u
     join pg_catalog.jsonb_array_elements(pg_catalog.current_setting('b3_0.created')::pg_catalog.jsonb -> 'users') as e(x)
       on u.id = (e.x ->> 'id')::pg_catalog.uuid) as users_left,
  (select pg_catalog.count(*) from security_private.member_identity mi
     join pg_catalog.jsonb_array_elements(pg_catalog.current_setting('b3_0.created')::pg_catalog.jsonb -> 'mappings') as e(x)
       on mi.auth_user_id = (e.x ->> 'auth_user_id')::pg_catalog.uuid) as mappings_left,
  (select pg_catalog.count(*) from security_private.admin_principal ap
     join pg_catalog.jsonb_array_elements_text(pg_catalog.current_setting('b3_0.created')::pg_catalog.jsonb -> 'admins') as e(x)
       on ap.auth_user_id = e.x::pg_catalog.uuid) as admin_rows_left;
