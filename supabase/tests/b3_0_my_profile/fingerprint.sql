-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 지문 질의 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 기존 지문(표 규칙 27·파일 규칙 30·2-가 객체)은 2-나-2b 의 supabase/tests/b2n2b_storage_policies/fingerprint.sql
-- 을 그대로 쓴다. 이 파일은 거기에 없는 것만 더한다. 쓰는 곳과 견주는 법은 절차.md.
--
-- 결과의 키
--   my_profile           public.my_profile 이라는 이름의 함수
--       named_count      그 이름의 함수 수(인자가 다른 것 포함). 적용 전·되돌린 뒤 0, 적용 뒤 1
--       exists           인자 없는 public.my_profile() 이 있는가
--       oid · def_md5    함수 번호 · md5(pg_get_functiondef)
--       body_md5         본문(prosrc)에서 줄 끝의 CR 을 뺀 글자의 md5 — 되돌리기 SQL 이 견주는 값과 같은 계산
--       language · returns · volatility(v = volatile) · security_definer · config · owner · acl
--       execute          실행 권한(역할 넷): public · anon · authenticated · service_role
--   public_functions     public 의 함수 전체에서 my_profile 을 뺀 것: n, fp(이름·인자·정의 md5·권한 목록의 지문)
--                        — 이 계약이 다른 공개 함수를 건드리지 않았음을 본다
--   private_functions    security_private 의 함수: n, fp(같은 계산)
--   check_api_request    공통 확인 함수: body_md5, mentions_my_profile(false 여야 한다 — 예외에 추가하지 않는다)
--   pre_request          authenticator 역할의 설정 중 pgrst.db_pre_request 로 시작하는 항목(없으면 [])
--   site_state           점검 스위치 한 줄(phase · maintenance_id · starts_at · message · last_ended_maintenance_id)
--   maintenance_exception  예외 명단: n, rows
--   users_table          public.users: rls · force_rls · policies(수) · grants_fp(표 권한 목록의 지문)
--   counts               auth_users · sessions · public_users · member_identity · admin_principal
--   synthetic            이 시험의 합성 행 수: public_users(이메일이 zzb3p0_ 로 시작) · auth_users(같은 표식)
-- =====================================================================
with fn as (
  select p.oid, p.prosrc, p.proconfig, p.proacl, p.prosecdef, p.provolatile, p.prorettype, p.prolang, p.proowner
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_profile' and p.pronargs = 0
),
routines as (
  select n.nspname as schema_name,
         p.proname as fn_name,
         n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig,
         pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as def_md5,
         coalesce(p.proacl::pg_catalog.text, '') as acl
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'security_private')
     and p.prokind = 'f'
)
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'my_profile', pg_catalog.jsonb_build_object(
    'named_count', (select pg_catalog.count(*)
                      from pg_catalog.pg_proc p
                      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'my_profile'),
    'exists', exists (select 1 from fn),
    'oid', (select fn.oid::pg_catalog.text from fn),
    'def_md5', (select pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)) from fn),
    'body_md5', (select pg_catalog.md5(pg_catalog.replace(fn.prosrc, pg_catalog.chr(13), '')) from fn),
    'language', (select l.lanname::pg_catalog.text from fn join pg_catalog.pg_language l on l.oid = fn.prolang),
    'returns', (select pg_catalog.format_type(fn.prorettype, null) from fn),
    'volatility', (select fn.provolatile::pg_catalog.text from fn),
    'security_definer', (select fn.prosecdef from fn),
    'config', (select pg_catalog.to_jsonb(fn.proconfig) from fn),
    'owner', (select pg_catalog.pg_get_userbyid(fn.proowner)::pg_catalog.text from fn),
    'acl', (select fn.proacl::pg_catalog.text from fn),
    'execute', (select pg_catalog.jsonb_build_object(
                         'public', pg_catalog.has_function_privilege('public'::pg_catalog.name, fn.oid, 'EXECUTE'),
                         'anon', pg_catalog.has_function_privilege('anon'::pg_catalog.name, fn.oid, 'EXECUTE'),
                         'authenticated', pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, fn.oid, 'EXECUTE'),
                         'service_role', pg_catalog.has_function_privilege('service_role'::pg_catalog.name, fn.oid, 'EXECUTE'))
                  from fn)
  ),
  'public_functions', pg_catalog.jsonb_build_object(
    'n', (select pg_catalog.count(*) from routines r where r.schema_name = 'public' and r.fn_name <> 'my_profile'),
    'fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(r.sig || '|' || r.def_md5 || '|' || r.acl, E'\n' order by r.sig), ''))
             from routines r where r.schema_name = 'public' and r.fn_name <> 'my_profile')
  ),
  'private_functions', pg_catalog.jsonb_build_object(
    'n', (select pg_catalog.count(*) from routines r where r.schema_name = 'security_private'),
    'fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(r.sig || '|' || r.def_md5 || '|' || r.acl, E'\n' order by r.sig), ''))
             from routines r where r.schema_name = 'security_private')
  ),
  'check_api_request', (
    select pg_catalog.jsonb_build_object(
             'body_md5', pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')),
             'mentions_my_profile', pg_catalog.strpos(p.prosrc, 'my_profile') > 0)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'security_private' and p.proname = 'check_api_request' and p.pronargs = 0
  ),
  'pre_request', (
    select coalesce(pg_catalog.jsonb_agg(cfg.item order by cfg.item), '[]'::pg_catalog.jsonb)
      from pg_catalog.pg_db_role_setting s
      join pg_catalog.pg_roles r on r.oid = s.setrole
      cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
     where r.rolname = 'authenticator'
       and pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1
  ),
  'site_state', (
    select pg_catalog.jsonb_build_object(
             'phase', ss.phase, 'maintenance_id', ss.maintenance_id, 'starts_at', ss.starts_at,
             'message', ss.message, 'last_ended_maintenance_id', ss.last_ended_maintenance_id)
      from security_private.site_state ss
     where ss.id = 1
  ),
  'maintenance_exception', pg_catalog.jsonb_build_object(
    'n', (select pg_catalog.count(*) from security_private.maintenance_exception),
    'rows', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'maintenance_id', me.maintenance_id, 'auth_user_id', me.auth_user_id, 'expires_at', me.expires_at)
                      order by me.maintenance_id, me.auth_user_id), '[]'::pg_catalog.jsonb)
               from security_private.maintenance_exception me)
  ),
  'users_table', (
    select pg_catalog.jsonb_build_object(
             'rls', c.relrowsecurity,
             'force_rls', c.relforcerowsecurity,
             'policies', (select pg_catalog.count(*) from pg_catalog.pg_policy pol where pol.polrelid = c.oid),
             'grants_fp', pg_catalog.md5(coalesce(c.relacl::pg_catalog.text, '')))
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'users'
  ),
  'counts', pg_catalog.jsonb_build_object(
    'auth_users', (select pg_catalog.count(*) from auth.users),
    'sessions', (select pg_catalog.count(*) from auth.sessions),
    'public_users', (select pg_catalog.count(*) from public.users),
    'member_identity', (select pg_catalog.count(*) from security_private.member_identity),
    'admin_principal', (select pg_catalog.count(*) from security_private.admin_principal)
  ),
  'synthetic', pg_catalog.jsonb_build_object(
    'public_users', (select pg_catalog.count(*) from public.users u where u.email like 'zzb3p0\_%'),
    'auth_users', (select pg_catalog.count(*) from auth.users au where au.email like 'zzb3p0\_%')
  )
) as result;
