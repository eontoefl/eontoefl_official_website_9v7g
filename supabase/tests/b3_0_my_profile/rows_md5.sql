-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 합성 행의 md5 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 쓰는 곳: 함수 호출(대조표·만료·로그아웃) 앞과 뒤에 한 번씩 실행해 두 결과를 견준다
--          (node profile_matrix.mjs --phase rows-compare --before <앞> --after <뒤>).
--          함수가 아무것도 고치지 않았으면 read_at 말고는 전부 같다.
-- 행의 내용은 내보내지 않는다. 행 전체를 글자로 바꾼 것의 md5 만 내보낸다(비밀번호 열의 값은 결과에 없다).
--
-- 결과의 키
--   users              이 시험의 합성 회원 행(이메일이 zzb3p0_ 로 시작): id · email · row_md5
--   member_identity    그 회원들의 대응 행: member_id · row_md5
--   admin_principal    합성 로그인 계정(이메일이 zzb3p0_ 로 시작)의 관리자 명부 행: auth_user_id · row_md5
--   all_users          회원 표 전체: n · md5(행 md5 를 id 순으로 이은 것) — 합성 행 말고도 바뀐 것이 없는가
--   all_member_identity  대응표 전체: n · md5
-- =====================================================================
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'users', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', u.id, 'email', u.email, 'row_md5', pg_catalog.md5(pg_catalog.to_jsonb(u)::pg_catalog.text))
             order by u.email), '[]'::pg_catalog.jsonb)
      from public.users u
     where u.email like 'zzb3p0\_%'
  ),
  'member_identity', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'member_id', mi.member_id, 'row_md5', pg_catalog.md5(pg_catalog.to_jsonb(mi)::pg_catalog.text))
             order by mi.member_id), '[]'::pg_catalog.jsonb)
      from security_private.member_identity mi
     where mi.member_id in (select u.id from public.users u where u.email like 'zzb3p0\_%')
  ),
  'admin_principal', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'auth_user_id', ap.auth_user_id, 'row_md5', pg_catalog.md5(pg_catalog.to_jsonb(ap)::pg_catalog.text))
             order by ap.auth_user_id), '[]'::pg_catalog.jsonb)
      from security_private.admin_principal ap
     where ap.auth_user_id in (select au.id from auth.users au where au.email like 'zzb3p0\_%')
  ),
  'all_users', (
    select pg_catalog.jsonb_build_object(
             'n', pg_catalog.count(*),
             'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(u)::pg_catalog.text), ',' order by u.id), '')))
      from public.users u
  ),
  'all_member_identity', (
    select pg_catalog.jsonb_build_object(
             'n', pg_catalog.count(*),
             'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(mi)::pg_catalog.text), ',' order by mi.auth_user_id), '')))
      from security_private.member_identity mi
  )
) as result;
