-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 지문 질의 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 기존 지문(표 규칙 27 · 파일 규칙 30 · 2-가 객체)은 2-나-2b 의 supabase/tests/b2n2b_storage_policies/fingerprint.sql
-- 을 그대로 쓴다. 이 파일은 거기에 없는 것만 더한다. 쓰는 곳과 견주는 법은 절차.md.
-- (3-0 의 fingerprint.sql 을 본떴다. 다른 것: 함수가 다섯, my_profile 을 "그대로여야 하는 것"으로 따로 본다,
--  회원 표의 열 · 열 권한 · 규칙 · 트리거 · 제약 · 색인의 지문을 더했다.)
--
-- 결과의 키
--   functions            이 계약의 함수 다섯. 이름마다:
--       named_count      그 이름의 함수 수(인자가 다른 것 포함). 적용 전·되돌린 뒤 0, 적용 뒤 1
--       exists           마이그레이션이 만든 인자 형 그대로의 함수가 있는가
--       args             인자의 형(pg_get_function_identity_arguments)
--       oid · def_md5    함수 번호 · md5(pg_get_functiondef) — **적용 직후에 적어 둔다. 되돌리기 SQL 이 이 두 값을 받는다**
--       body_md5         본문(prosrc)에서 줄 끝의 CR 을 뺀 글자의 md5 — 되돌리기 SQL 이 견주는 값과 같은 계산
--       language · returns · volatility(v = volatile) · security_definer · config · owner · acl
--       execute          실행 권한(역할 넷): public · anon · authenticated · service_role
--   my_profile           3-0 의 public.my_profile(): named_count · exists · def_md5 · acl · execute — 이 계약 앞뒤로 같아야 한다
--   public_functions     public 의 함수 전체에서 위 다섯을 뺀 것(my_profile 포함): n, fp(이름·인자·정의 md5·권한 목록의 지문)
--   private_functions    security_private 의 함수: n, fp(같은 계산)
--   check_api_request    공통 확인 함수: body_md5, mentions(다섯 이름 가운데 본문에 나오는 것 — [] 여야 한다)
--   pre_request          역할 설정 가운데 pgrst.db_pre_request 로 시작하는 항목(authenticator 의 것. 없으면 [])
--   site_state           점검 스위치 한 줄(phase · maintenance_id · starts_at · message · last_ended_maintenance_id)
--   maintenance_exception  예외 명단: n, rows
--   users_table          public.users:
--       rls · force_rls · policies(수) · policies_fp(규칙의 이름·명령·역할·식의 지문)
--       grants_fp(표 권한 목록의 지문) · column_grants_fp(열 권한 목록의 지문) · column_grants_n
--       columns_n · columns_fp(열의 이름·형·널 허용·기본값의 지문)
--       triggers_n · triggers_fp · constraints_fp · indexes_fp
--   counts               auth_users · sessions · public_users · member_identity · admin_principal
--   synthetic            이 시험의 합성 회원 행 수: public_users(정확한 일곱 이메일 중 있는 것)
-- =====================================================================
with want(fn_name, fn_args) as (
  values
    ('my_settings'::pg_catalog.text, ''::pg_catalog.text),
    ('my_book_answers', ''),
    ('my_intro_track_set', 'text'),
    ('my_marketing_consent_set', 'boolean'),
    ('my_book_answers_hold', 'jsonb')
),
fn as (
  select w.fn_name, p.oid, p.prosrc, p.proconfig, p.proacl, p.prosecdef, p.provolatile, p.prorettype, p.prolang, p.proowner
    from want w
    join pg_catalog.pg_proc p on p.proname = w.fn_name and pg_catalog.oidvectortypes(p.proargtypes) = w.fn_args
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
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
),
prof as (
  select p.oid, p.proacl
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_profile' and p.pronargs = 0
),
ut as (
  select c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'users'
)
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'functions', (
    select pg_catalog.jsonb_object_agg(
             w.fn_name,
             pg_catalog.jsonb_build_object(
               'named_count', (select pg_catalog.count(*)
                                 from pg_catalog.pg_proc p
                                 join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'public' and p.proname = w.fn_name),
               'exists', (f.oid is not null),
               'args', w.fn_args,
               'oid', f.oid::pg_catalog.text,
               'def_md5', case when f.oid is not null then pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid)) end,
               'body_md5', pg_catalog.md5(pg_catalog.replace(f.prosrc, pg_catalog.chr(13), '')),
               'language', (select l.lanname::pg_catalog.text from pg_catalog.pg_language l where l.oid = f.prolang),
               'returns', case when f.oid is not null then pg_catalog.format_type(f.prorettype, null) end,
               'volatility', f.provolatile::pg_catalog.text,
               'security_definer', f.prosecdef,
               'config', pg_catalog.to_jsonb(f.proconfig),
               'owner', case when f.oid is not null then pg_catalog.pg_get_userbyid(f.proowner)::pg_catalog.text end,
               'acl', f.proacl::pg_catalog.text,
               'execute', case when f.oid is not null then pg_catalog.jsonb_build_object(
                            'public', pg_catalog.has_function_privilege('public'::pg_catalog.name, f.oid, 'EXECUTE'),
                            'anon', pg_catalog.has_function_privilege('anon'::pg_catalog.name, f.oid, 'EXECUTE'),
                            'authenticated', pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, f.oid, 'EXECUTE'),
                            'service_role', pg_catalog.has_function_privilege('service_role'::pg_catalog.name, f.oid, 'EXECUTE')) end
             ))
      from want w
      left join fn f on f.fn_name = w.fn_name
  ),
  'my_profile', pg_catalog.jsonb_build_object(
    'named_count', (select pg_catalog.count(*)
                      from pg_catalog.pg_proc p
                      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'my_profile'),
    'exists', exists (select 1 from prof),
    'def_md5', (select pg_catalog.md5(pg_catalog.pg_get_functiondef(prof.oid)) from prof),
    'acl', (select prof.proacl::pg_catalog.text from prof),
    'execute', (select pg_catalog.jsonb_build_object(
                         'public', pg_catalog.has_function_privilege('public'::pg_catalog.name, prof.oid, 'EXECUTE'),
                         'anon', pg_catalog.has_function_privilege('anon'::pg_catalog.name, prof.oid, 'EXECUTE'),
                         'authenticated', pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, prof.oid, 'EXECUTE'),
                         'service_role', pg_catalog.has_function_privilege('service_role'::pg_catalog.name, prof.oid, 'EXECUTE'))
                  from prof)
  ),
  'public_functions', pg_catalog.jsonb_build_object(
    'n', (select pg_catalog.count(*) from routines r
           where r.schema_name = 'public' and r.fn_name not in (select w.fn_name from want w)),
    'fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(r.sig || '|' || r.def_md5 || '|' || r.acl, E'\n' order by r.sig), ''))
             from routines r
            where r.schema_name = 'public' and r.fn_name not in (select w.fn_name from want w))
  ),
  'private_functions', pg_catalog.jsonb_build_object(
    'n', (select pg_catalog.count(*) from routines r where r.schema_name = 'security_private'),
    'fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(r.sig || '|' || r.def_md5 || '|' || r.acl, E'\n' order by r.sig), ''))
             from routines r where r.schema_name = 'security_private')
  ),
  'check_api_request', (
    select pg_catalog.jsonb_build_object(
             'body_md5', pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')),
             'mentions', (select coalesce(pg_catalog.jsonb_agg(w.fn_name order by w.fn_name), '[]'::pg_catalog.jsonb)
                            from want w where pg_catalog.strpos(p.prosrc, w.fn_name) > 0))
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
             'rls', ut.relrowsecurity,
             'force_rls', ut.relforcerowsecurity,
             'policies', (select pg_catalog.count(*) from pg_catalog.pg_policy pol where pol.polrelid = ut.oid),
             'policies_fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
                                      pol.polname || '|' || pol.polcmd::pg_catalog.text || '|' || pol.polpermissive::pg_catalog.text || '|' || pol.polroles::pg_catalog.text
                                      || '|' || coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '')
                                      || '|' || coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
                                      E'\n' order by pol.polname), ''))
                               from pg_catalog.pg_policy pol where pol.polrelid = ut.oid),
             'grants_fp', pg_catalog.md5(coalesce(ut.relacl::pg_catalog.text, '')),
             'column_grants_n', (select pg_catalog.count(*) from pg_catalog.pg_attribute a
                                  where a.attrelid = ut.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null),
             'column_grants_fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
                                           a.attname || '|' || coalesce(a.attacl::pg_catalog.text, ''), E'\n' order by a.attnum), ''))
                                    from pg_catalog.pg_attribute a
                                   where a.attrelid = ut.oid and a.attnum > 0 and not a.attisdropped),
             'columns_n', (select pg_catalog.count(*) from pg_catalog.pg_attribute a
                            where a.attrelid = ut.oid and a.attnum > 0 and not a.attisdropped),
             'columns_fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
                                     a.attnum::pg_catalog.text || '|' || a.attname || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod)
                                     || '|' || a.attnotnull::pg_catalog.text
                                     || '|' || coalesce((select pg_catalog.pg_get_expr(d.adbin, d.adrelid)
                                                           from pg_catalog.pg_attrdef d
                                                          where d.adrelid = a.attrelid and d.adnum = a.attnum), ''),
                                     E'\n' order by a.attnum), ''))
                              from pg_catalog.pg_attribute a
                             where a.attrelid = ut.oid and a.attnum > 0 and not a.attisdropped),
             'triggers_n', (select pg_catalog.count(*) from pg_catalog.pg_trigger tg where tg.tgrelid = ut.oid and not tg.tgisinternal),
             'triggers_fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.pg_get_triggerdef(tg.oid), E'\n' order by tg.tgname), ''))
                               from pg_catalog.pg_trigger tg where tg.tgrelid = ut.oid and not tg.tgisinternal),
             'constraints_fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
                                         con.conname || '|' || con.contype::pg_catalog.text || '|' || pg_catalog.pg_get_constraintdef(con.oid),
                                         E'\n' order by con.conname), ''))
                                  from pg_catalog.pg_constraint con where con.conrelid = ut.oid),
             'indexes_fp', (select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.pg_get_indexdef(ix.indexrelid), E'\n' order by ix.indexrelid::pg_catalog.regclass::pg_catalog.text), ''))
                              from pg_catalog.pg_index ix where ix.indrelid = ut.oid))
      from ut
  ),
  'counts', pg_catalog.jsonb_build_object(
    'auth_users', (select pg_catalog.count(*) from auth.users),
    'sessions', (select pg_catalog.count(*) from auth.sessions),
    'public_users', (select pg_catalog.count(*) from public.users),
    'member_identity', (select pg_catalog.count(*) from security_private.member_identity),
    'admin_principal', (select pg_catalog.count(*) from security_private.admin_principal)
  ),
  'synthetic', pg_catalog.jsonb_build_object(
    'public_users', (select pg_catalog.count(*) from public.users u
                      where u.email in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                                        'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                                        'zzb3c_trap@member.zzb3c.invalid'))
  )
) as result;
