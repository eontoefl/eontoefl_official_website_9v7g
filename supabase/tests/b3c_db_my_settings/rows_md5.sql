-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 합성 행의 열별 md5 와 설정 값 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 쓰는 곳: 쓰기를 하는 단계(대조표 · 효과 재기)의 **앞과 뒤**에 한 번씩 실행해 두 결과를 도구에 넘긴다
--          (node settings_matrix.mjs --phase rows-effect --before <앞> --after <뒤> --result <그 단계의 결과>).
--   도구는 "바뀐 열이 정확히 기대한 열뿐인가"를 열별 md5 로 본다. 이것은 **그 단계 전체를 사이에 둔 앞뒤**의 대조다
--   (사이에 고쳐졌다가 되돌려진 것은 이 비교로 보이지 않는다). 요청 하나의 효과를 보려면 그 요청 하나만 사이에 둔다(효과 재기 단계).
--
-- 내보내는 것
--   * 합성 회원 일곱 행: 모든 열의 **열별 md5**(값은 내보내지 않는다 — 비밀번호 열의 값은 결과에 없다)와,
--     이 계약의 함수가 다루는 **설정 열 넷의 값**(합성 값이다: 종류 · 동의 · 동의 시각 · 보관 답변).
--   * 그 밖의 회원 행 전체의 수와 md5 하나(다른 회원의 행이 바뀌지 않았는가), 대응표 · 관리자 명부 전체의 수와 md5.
--
-- 결과의 키
--   read_at               DB 의 지금 시각(clock_timestamp) — 동의 시각이 "요청 전후의 DB 시각 사이"인지 보는 데 쓴다
--   users                 합성 회원 행 7개(정확한 이메일로 고른다):
--                           label · id · email · cols{열 이름: md5(그 열의 JSON 표현)} · settings{설정 열 넷의 값}
--   other_users           합성 일곱 행을 뺀 회원 표 전체: n · md5(행 md5 를 id 순으로 이은 것)
--   all_users_n           회원 표 전체의 행 수
--   all_member_identity   대응표 전체: n · md5
--   all_admin_principal   관리자 명부 전체: n · md5
-- =====================================================================
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.clock_timestamp(),
  'users', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'label', pg_catalog.replace(pg_catalog.split_part(u.email, '@', 1), 'zzb3c_', ''),
             'id', u.id,
             'email', u.email,
             'cols', (select pg_catalog.jsonb_object_agg(c.key, pg_catalog.md5(c.value::pg_catalog.text))
                        from pg_catalog.jsonb_each(pg_catalog.to_jsonb(u)) as c(key, value)),
             'settings', pg_catalog.jsonb_build_object(
               'intro_book_track', u.intro_book_track,
               'marketing_consent', u.marketing_consent,
               'marketing_consent_at', u.marketing_consent_at,
               'pending_book_request', u.pending_book_request,
               'pending_is_sql_null', u.pending_book_request is null))
             order by u.email), '[]'::pg_catalog.jsonb)
      from public.users u
     where u.email in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                       'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                       'zzb3c_trap@member.zzb3c.invalid')
  ),
  'other_users', (
    select pg_catalog.jsonb_build_object(
             'n', pg_catalog.count(*),
             'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(u)::pg_catalog.text), ',' order by u.id), '')))
      from public.users u
     where u.email not in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                           'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                           'zzb3c_trap@member.zzb3c.invalid')
  ),
  'all_users_n', (select pg_catalog.count(*) from public.users),
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
