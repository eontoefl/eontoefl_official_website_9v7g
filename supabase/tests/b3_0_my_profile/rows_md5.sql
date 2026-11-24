-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 합성 행의 md5 (읽기만, 한 문장, 결과 한 칸 jsonb) — 2차 판
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 쓰는 곳: **대조표 전체의 앞과 뒤**에 한 번씩 실행해 두 결과를 견준다
--          (node profile_matrix.mjs --phase rows-compare --before <앞> --after <뒤>). read_at 말고는 전부 같아야 한다.
--   이것은 "대조표 전체를 사이에 둔 앞뒤 불변"이다. 호출 하나하나가 아무것도 고치지 않았다는 증거는 아니다
--   (사이에 고쳐졌다가 되돌려진 것은 이 비교로 보이지 않는다).
-- 행의 내용은 내보내지 않는다. 행 전체를 글자로 바꾼 것의 md5 만 내보낸다(비밀번호 열의 값은 결과에 없다).
--
-- 결과의 키
--   users                 이 시험의 합성 회원 행 7개(정확한 이메일로 고른다): id · email · row_md5
--   member_identity       그 회원들의 대응 행: auth_user_id · member_id · row_md5
--   all_users             회원 표 전체: n · md5(행 md5 를 id 순으로 이은 것) — 합성 행 말고도 바뀐 것이 없는가
--   all_member_identity   대응표 전체: n · md5
--   all_admin_principal   관리자 명부 전체: n · md5
-- =====================================================================
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'users', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', u.id, 'email', u.email, 'row_md5', pg_catalog.md5(pg_catalog.to_jsonb(u)::pg_catalog.text))
             order by u.email), '[]'::pg_catalog.jsonb)
      from public.users u
     where u.email in ('zzb3p0_a@member.zzb3p0.invalid', 'zzb3p0_b@member.zzb3p0.invalid', 'zzb3p0_gm@member.zzb3p0.invalid',
                       'zzb3p0_blk@member.zzb3p0.invalid', 'zzb3p0_wd@member.zzb3p0.invalid', 'zzb3p0_bw@member.zzb3p0.invalid',
                       'zzb3p0_trap@member.zzb3p0.invalid')
  ),
  'member_identity', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'auth_user_id', mi.auth_user_id, 'member_id', mi.member_id, 'row_md5', pg_catalog.md5(pg_catalog.to_jsonb(mi)::pg_catalog.text))
             order by mi.member_id), '[]'::pg_catalog.jsonb)
      from security_private.member_identity mi
      join public.users u on u.id = mi.member_id
     where u.email in ('zzb3p0_a@member.zzb3p0.invalid', 'zzb3p0_b@member.zzb3p0.invalid', 'zzb3p0_gm@member.zzb3p0.invalid',
                       'zzb3p0_blk@member.zzb3p0.invalid', 'zzb3p0_wd@member.zzb3p0.invalid', 'zzb3p0_bw@member.zzb3p0.invalid',
                       'zzb3p0_trap@member.zzb3p0.invalid')
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
  ),
  'all_admin_principal', (
    select pg_catalog.jsonb_build_object(
             'n', pg_catalog.count(*),
             'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(ap)::pg_catalog.text), ',' order by ap.auth_user_id), '')))
      from security_private.admin_principal ap
  )
) as result;
