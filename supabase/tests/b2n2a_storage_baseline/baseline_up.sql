-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2a: 파일 기준선 올리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서와 기대 결과는 같은 폴더의 절차.md 를 따른다.
-- 운영에는 절대 실행하지 않는다(운영에는 이 규칙들이 이미 있다 — 여기 적힌 것은 그 정의를 옮겨 적은 것이다).
--
-- 하는 일: storage.objects 에 운영과 같은 규칙 26개를 만든다(이름·동작·역할·USING·WITH CHECK 그대로).
--          근거: C:\기능구현\보안작업\묶음2\계약2나2a_파일기준선_사실.json 의 production.policies
-- 하지 않는 일
--   * 버킷을 만들지 않는다. 버킷 10개는 measure.mjs 의 baseline-buckets 단계가 Storage 버킷 관리 API 로
--     먼저 만든다(이 파일은 맨 앞에서 10개가 있는지 확인하고, 없으면 멈춘다).
--   * storage.objects 에 행을 넣지 않는다. 표의 권한·RLS 설정·소유자를 바꾸지 않는다.
--   * 규칙이 기대는 함수(public.private_book_is_admin, auth.role)가 없으면 멈춘다. 임의로 참으로 바꾸지 않는다.
--
-- 권한: storage.objects 의 소유자는 supabase_storage_admin 이고 postgres 는 그 역할의 구성원이 아니다.
--       규칙 만들기가 권한 오류로 실패하면 이 파일은 우회하지 않는다 — 그 오류 문구 그대로 멈추고
--       한 트랜잭션이므로 아무것도 남지 않는다. 그 경우 이 조각의 결과는 "기준선 구성 불가 — 뒤 단계 미실행"이다.
--
-- 실행 방법: 같은 접속에서 먼저  set b2n2a.test_project_ref = 'hmncdheiwqwekdbtijar';
-- 내리기: baseline_down.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 전제 확인 (읽기만. 어긋나면 멈춘다)
-- ---------------------------------------------------------------------
do $b2n2a_pre$
declare
  v_missing text;
  v_count   bigint;
begin
  if coalesce(pg_catalog.current_setting('b2n2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'b2n2a 기준선 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2n2a.test_project_ref 를 먼저 실행할 것';
  end if;

  -- 버킷 10개가 먼저 있어야 한다(이름과 공개 여부). 크기·형식 제한까지의 대조는 fingerprint.sql 이 한다.
  select pg_catalog.string_agg(w.id, ', ' order by w.id)
    into v_missing
    from (
      values
        ('board-files'::pg_catalog.text, true),
        ('board-images', true),
        ('book-private', false),
        ('books', false),
        ('correction-audio', true),
        ('guide-images', true),
        ('materials', true),
        ('review-images', true),
        ('speaking-files', true),
        ('toefl-score-images', true)
    ) as w(id, is_public)
   where not exists (
           select 1 from storage.buckets b
            where b.id = w.id and b.public is not distinct from w.is_public
         );
  if v_missing is not null then
    raise exception 'b2n2a 기준선 중단: 버킷이 없거나 공개 여부가 다르다: % (먼저 measure.mjs --phase baseline-buckets)', v_missing;
  end if;

  -- 규칙이 기대는 함수
  if pg_catalog.to_regprocedure('public.private_book_is_admin()') is null then
    raise exception 'b2n2a 기준선 중단: public.private_book_is_admin() 이 없다(book-private 규칙 4개가 기댄다). 임의로 바꾸지 않는다';
  end if;
  if pg_catalog.to_regprocedure('auth.role()') is null then
    raise exception 'b2n2a 기준선 중단: auth.role() 이 없다(books 읽기 규칙이 기댄다)';
  end if;

  -- 같은 이름의 규칙이 이미 있으면 멈춘다(먼저 baseline_down.sql)
  select pg_catalog.count(*)
    into v_count
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass
     and pol.polname::pg_catalog.text in (
       'Allow Upload b9j0vg_0', 'Allow authenticated read on books', 'Allow public read', 'Allow public upload',
       'Allow read from correction-audio', 'Allow update in correction-audio', 'Allow upload to correction-audio',
       'Public Read b9j0vg_0', 'allow public read iqdobt_0',
       'allow public upload og9vps_0', 'allow public upload og9vps_1', 'allow public upload og9vps_2', 'allow public upload og9vps_3',
       'allow upload iqdobt_0', 'allow_public_select', 'allow_public_upload',
       'board-images public insert', 'board-images public read', 'board-images public update',
       'pb_book_private_delete', 'pb_book_private_insert', 'pb_book_private_select', 'pb_book_private_update',
       'toefl_scores_delete', 'toefl_scores_read', 'toefl_scores_upload'
     );
  if v_count <> 0 then
    raise exception 'b2n2a 기준선 중단: 기준선 규칙이 이미 % 개 있다(먼저 baseline_down.sql)', v_count;
  end if;
end;
$b2n2a_pre$;

-- ---------------------------------------------------------------------
-- 1. 규칙 26개 (운영 원자료의 순서 = 이름순)
--    권한 오류가 나면 여기서 그 문구 그대로 멈춘다.
-- ---------------------------------------------------------------------

-- materials (공개 버킷): 비로그인 올리기·읽기
create policy "Allow Upload b9j0vg_0" on storage.objects
  as permissive for insert to anon
  with check (bucket_id = 'materials');

-- books (비공개 버킷): 모든 역할 대상이지만 조건이 "역할이 anon" 이다
create policy "Allow authenticated read on books" on storage.objects
  as permissive for select to public
  using (bucket_id = 'books' and auth.role() = 'anon');

-- speaking-files: 모든 역할 읽기·올리기
create policy "Allow public read" on storage.objects
  as permissive for select to public
  using (bucket_id = 'speaking-files');

create policy "Allow public upload" on storage.objects
  as permissive for insert to public
  with check (bucket_id = 'speaking-files');

-- correction-audio: 로그인·비로그인 읽기·수정·올리기
create policy "Allow read from correction-audio" on storage.objects
  as permissive for select to authenticated, anon
  using (bucket_id = 'correction-audio');

create policy "Allow update in correction-audio" on storage.objects
  as permissive for update to authenticated, anon
  using (bucket_id = 'correction-audio');

create policy "Allow upload to correction-audio" on storage.objects
  as permissive for insert to authenticated, anon
  with check (bucket_id = 'correction-audio');

create policy "Public Read b9j0vg_0" on storage.objects
  as permissive for select to anon
  using (bucket_id = 'materials');

-- guide-images: 읽기는 비로그인만, 올리기는 모든 역할
create policy "allow public read iqdobt_0" on storage.objects
  as permissive for select to anon
  using (bucket_id = 'guide-images');

-- board-files: 비로그인 올리기·수정·읽기·삭제
create policy "allow public upload og9vps_0" on storage.objects
  as permissive for insert to anon
  with check (bucket_id = 'board-files');

create policy "allow public upload og9vps_1" on storage.objects
  as permissive for update to anon
  using (bucket_id = 'board-files');

create policy "allow public upload og9vps_2" on storage.objects
  as permissive for select to anon
  using (bucket_id = 'board-files');

create policy "allow public upload og9vps_3" on storage.objects
  as permissive for delete to anon
  using (bucket_id = 'board-files');

create policy "allow upload iqdobt_0" on storage.objects
  as permissive for insert to public
  with check (bucket_id = 'guide-images');

-- review-images: 모든 역할 읽기·올리기
create policy "allow_public_select" on storage.objects
  as permissive for select to public
  using (bucket_id = 'review-images');

create policy "allow_public_upload" on storage.objects
  as permissive for insert to public
  with check (bucket_id = 'review-images');

-- board-images: 모든 역할 올리기·읽기·수정
create policy "board-images public insert" on storage.objects
  as permissive for insert to public
  with check (bucket_id = 'board-images');

create policy "board-images public read" on storage.objects
  as permissive for select to public
  using (bucket_id = 'board-images');

create policy "board-images public update" on storage.objects
  as permissive for update to public
  using (bucket_id = 'board-images');

-- book-private (비공개 버킷): 로그인 역할 + public.private_book_is_admin()
create policy "pb_book_private_delete" on storage.objects
  as permissive for delete to authenticated
  using (bucket_id = 'book-private' and public.private_book_is_admin());

create policy "pb_book_private_insert" on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'book-private' and public.private_book_is_admin());

create policy "pb_book_private_select" on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'book-private' and public.private_book_is_admin());

create policy "pb_book_private_update" on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'book-private' and public.private_book_is_admin())
  with check (bucket_id = 'book-private' and public.private_book_is_admin());

-- toefl-score-images: 비로그인 삭제·읽기·올리기
create policy "toefl_scores_delete" on storage.objects
  as permissive for delete to anon
  using (bucket_id = 'toefl-score-images');

create policy "toefl_scores_read" on storage.objects
  as permissive for select to anon
  using (bucket_id = 'toefl-score-images');

create policy "toefl_scores_upload" on storage.objects
  as permissive for insert to anon
  with check (bucket_id = 'toefl-score-images');

-- ---------------------------------------------------------------------
-- 2. 자기 점검 (같은 트랜잭션. 어긋나면 예외 → 전체 되돌아감)
--    만든 규칙을 카탈로그에서 다시 읽어 운영 원자료의 글자와 견준다:
--    이름, 동작(r 읽기·a 올리기·w 수정·d 삭제), 역할(이름순), 모든 역할 대상인지, USING, WITH CHECK.
--    조건식 글자는 지금 접속의 search_path 로 풀어 쓴 것이다(public 이 들어 있어야 원자료와 같은 글자가 된다).
--    이 점검의 통과는 fingerprint.sql 로 운영 원자료와 대조하는 일을 대신하지 않는다.
-- ---------------------------------------------------------------------
do $b2n2a_check$
declare
  v_want  record;
  v_got   record;
  v_seen  integer := 0;
  v_count bigint;
begin
  for v_want in
    select t.name, t.cmd, t.roles, t.to_public, t.using_text, t.check_text
      from (
        values
          ('Allow Upload b9j0vg_0'::pg_catalog.text, 'a'::pg_catalog.text, '{anon}'::pg_catalog.text, false, null::pg_catalog.text, '(bucket_id = ''materials''::text)'::pg_catalog.text),
          ('Allow authenticated read on books', 'r', '{}', true,  '((bucket_id = ''books''::text) AND (auth.role() = ''anon''::text))', null),
          ('Allow public read',                 'r', '{}', true,  '(bucket_id = ''speaking-files''::text)', null),
          ('Allow public upload',               'a', '{}', true,  null, '(bucket_id = ''speaking-files''::text)'),
          ('Allow read from correction-audio',  'r', '{anon,authenticated}', false, '(bucket_id = ''correction-audio''::text)', null),
          ('Allow update in correction-audio',  'w', '{anon,authenticated}', false, '(bucket_id = ''correction-audio''::text)', null),
          ('Allow upload to correction-audio',  'a', '{anon,authenticated}', false, null, '(bucket_id = ''correction-audio''::text)'),
          ('Public Read b9j0vg_0',              'r', '{anon}', false, '(bucket_id = ''materials''::text)', null),
          ('allow public read iqdobt_0',        'r', '{anon}', false, '(bucket_id = ''guide-images''::text)', null),
          ('allow public upload og9vps_0',      'a', '{anon}', false, null, '(bucket_id = ''board-files''::text)'),
          ('allow public upload og9vps_1',      'w', '{anon}', false, '(bucket_id = ''board-files''::text)', null),
          ('allow public upload og9vps_2',      'r', '{anon}', false, '(bucket_id = ''board-files''::text)', null),
          ('allow public upload og9vps_3',      'd', '{anon}', false, '(bucket_id = ''board-files''::text)', null),
          ('allow upload iqdobt_0',             'a', '{}', true,  null, '(bucket_id = ''guide-images''::text)'),
          ('allow_public_select',               'r', '{}', true,  '(bucket_id = ''review-images''::text)', null),
          ('allow_public_upload',               'a', '{}', true,  null, '(bucket_id = ''review-images''::text)'),
          ('board-images public insert',        'a', '{}', true,  null, '(bucket_id = ''board-images''::text)'),
          ('board-images public read',          'r', '{}', true,  '(bucket_id = ''board-images''::text)', null),
          ('board-images public update',        'w', '{}', true,  '(bucket_id = ''board-images''::text)', null),
          ('pb_book_private_delete',            'd', '{authenticated}', false, '((bucket_id = ''book-private''::text) AND private_book_is_admin())', null),
          ('pb_book_private_insert',            'a', '{authenticated}', false, null, '((bucket_id = ''book-private''::text) AND private_book_is_admin())'),
          ('pb_book_private_select',            'r', '{authenticated}', false, '((bucket_id = ''book-private''::text) AND private_book_is_admin())', null),
          ('pb_book_private_update',            'w', '{authenticated}', false, '((bucket_id = ''book-private''::text) AND private_book_is_admin())', '((bucket_id = ''book-private''::text) AND private_book_is_admin())'),
          ('toefl_scores_delete',               'd', '{anon}', false, '(bucket_id = ''toefl-score-images''::text)', null),
          ('toefl_scores_read',                 'r', '{anon}', false, '(bucket_id = ''toefl-score-images''::text)', null),
          ('toefl_scores_upload',               'a', '{anon}', false, null, '(bucket_id = ''toefl-score-images''::text)')
      ) as t(name, cmd, roles, to_public, using_text, check_text)
  loop
    v_seen := v_seen + 1;

    select pol.polcmd::pg_catalog.text as cmd,
           pol.polpermissive as permissive,
           coalesce((select pg_catalog.array_agg(r.rolname::pg_catalog.text order by r.rolname::pg_catalog.text)
                       from pg_catalog.pg_roles r
                      where r.oid = any (pol.polroles)), '{}'::pg_catalog.text[])::pg_catalog.text as roles,
           (0::pg_catalog.oid = any (pol.polroles)) as to_public,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_text,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as check_text
      into v_got
      from pg_catalog.pg_policy pol
     where pol.polrelid = 'storage.objects'::pg_catalog.regclass
       and pol.polname::pg_catalog.text = v_want.name;
    if not found then
      raise exception 'b2n2a 기준선 자기 점검 실패: 규칙 "%" 가 없음', v_want.name;
    end if;

    if v_got.permissive is not true
       or v_got.cmd is distinct from v_want.cmd
       or v_got.roles is distinct from v_want.roles
       or v_got.to_public is distinct from v_want.to_public
       or v_got.using_text is distinct from v_want.using_text
       or v_got.check_text is distinct from v_want.check_text then
      raise exception 'b2n2a 기준선 자기 점검 실패: 규칙 "%" 이 운영 원자료와 다름 — 동작 %/% 역할 %/% 모든역할 %/% USING [%]/[%] CHECK [%]/[%] (실제/기대)',
        v_want.name, v_got.cmd, v_want.cmd, v_got.roles, v_want.roles, v_got.to_public, v_want.to_public,
        v_got.using_text, v_want.using_text, v_got.check_text, v_want.check_text;
    end if;
  end loop;

  if v_seen <> 26 then
    raise exception 'b2n2a 기준선 자기 점검 실패: 규칙 표의 줄 수가 % (26이어야 함)', v_seen;
  end if;

  -- storage.objects 의 규칙은 (임시 규칙 zz_b2n2a_ 를 빼면) 정확히 이 26개여야 한다
  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass
     and pol.polname::pg_catalog.text not like 'zz\_b2n2a\_%';
  if v_count <> 26 then
    raise exception 'b2n2a 기준선 자기 점검 실패: storage.objects 의 규칙(임시 규칙 제외)이 % 개(26이어야 함 — 다른 규칙이 섞여 있다)', v_count;
  end if;
end;
$b2n2a_check$;

commit;
