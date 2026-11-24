-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 끝 확인: 이번 시험이 만든 것이 남아 있는가 (읽기만, 결과 한 칸 jsonb) — 2차에서 더함
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 쓰는 곳: 절차.md 14단계의 맨 끝(합성 자료를 내리고 합성 로그인 계정을 지운 뒤). 전부 0 이어야 한다.
--
-- 받는 값(같은 요청의 맨 앞. node settings_matrix.mjs --phase set-lines --for leftover-check --expect expect.json 이 만들어 준다)
--     set b3c.created = '<expect.json 의 down_input 글자 그대로>';
--   그 값의 정확한 번호·이메일로 센다(exact). 그리고 그와 따로, 합성 표식 zzb3c 를 가진 것이 어디에든 남았는지도 센다(marker) —
--   넘겨받은 목록 밖에 이 시험의 흔적이 있으면 그쪽에서 드러난다. 읽기뿐이므로 표식으로 찾아도 무엇이 지워지지 않는다.
--
-- 결과의 키(전부 0 이어야 한다. new_functions 는 이 계약의 함수 다섯 가운데 남은 수)
--   exact.public_users(7 가운데) · exact.member_identity(6) · exact.admin_principal(2) · exact.auth_users(8)
--   exact.sessions(그 여덟 계정의 로그인 기록) · exact.maintenance_exception(그 여덟 계정의 점검 예외) · exact.mfa_factors(그 계정의 인증 앱 등록)
--   marker.public_users_email(회원 표에서 이메일에 zzb3c) · marker.auth_users_email(로그인 계정에서 이메일에 zzb3c)
--   marker.maintenance_exception_311(점검 번호 311 의 예외 행)
--   new_functions
--   all_zero            위가 전부 0 인가
-- =====================================================================
with c as (
  select pg_catalog.current_setting('b3c.created')::pg_catalog.jsonb as j
),
acct as (
  select (e.x ->> 'auth_user_id')::pg_catalog.uuid as id
    from c cross join lateral pg_catalog.jsonb_array_elements(c.j -> 'accounts') as e(x)
),
n as (
  select
    (select pg_catalog.count(*) from public.users u
       join (select e.x from c cross join lateral pg_catalog.jsonb_array_elements(c.j -> 'users') as e(x)) t
         on u.id = (t.x ->> 'id')::pg_catalog.uuid) as public_users,
    (select pg_catalog.count(*) from security_private.member_identity mi
       join (select e.x from c cross join lateral pg_catalog.jsonb_array_elements(c.j -> 'mappings') as e(x)) t
         on mi.auth_user_id = (t.x ->> 'auth_user_id')::pg_catalog.uuid) as member_identity,
    (select pg_catalog.count(*) from security_private.admin_principal ap
       join (select e.x from c cross join lateral pg_catalog.jsonb_array_elements_text(c.j -> 'admins') as e(x)) t
         on ap.auth_user_id = t.x::pg_catalog.uuid) as admin_principal,
    (select pg_catalog.count(*) from auth.users au where au.id in (select a.id from acct a)) as auth_users,
    (select pg_catalog.count(*) from auth.sessions s where s.user_id in (select a.id from acct a)) as sessions,
    (select pg_catalog.count(*) from security_private.maintenance_exception me where me.auth_user_id in (select a.id from acct a)) as maintenance_exception,
    (select pg_catalog.count(*) from auth.mfa_factors f where f.user_id in (select a.id from acct a)) as mfa_factors,
    (select pg_catalog.count(*) from public.users u where pg_catalog.strpos(pg_catalog.lower(u.email), 'zzb3c') > 0) as m_public_users,
    (select pg_catalog.count(*) from auth.users au where pg_catalog.strpos(pg_catalog.lower(coalesce(au.email, '')), 'zzb3c') > 0) as m_auth_users,
    (select pg_catalog.count(*) from security_private.maintenance_exception me where me.maintenance_id = 311) as m_exception_311,
    (select pg_catalog.count(*) from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public'
        and p.proname in ('my_settings', 'my_book_answers', 'my_intro_track_set', 'my_marketing_consent_set', 'my_book_answers_hold')) as new_functions
)
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'exact', pg_catalog.jsonb_build_object(
    'public_users', n.public_users, 'member_identity', n.member_identity, 'admin_principal', n.admin_principal,
    'auth_users', n.auth_users, 'sessions', n.sessions, 'maintenance_exception', n.maintenance_exception, 'mfa_factors', n.mfa_factors),
  'marker', pg_catalog.jsonb_build_object(
    'public_users_email', n.m_public_users, 'auth_users_email', n.m_auth_users, 'maintenance_exception_311', n.m_exception_311),
  'new_functions', n.new_functions,
  'all_zero', (n.public_users + n.member_identity + n.admin_principal + n.auth_users + n.sessions + n.maintenance_exception + n.mfa_factors
               + n.m_public_users + n.m_auth_users + n.m_exception_311 + n.new_functions) = 0
) as result
  from n;
