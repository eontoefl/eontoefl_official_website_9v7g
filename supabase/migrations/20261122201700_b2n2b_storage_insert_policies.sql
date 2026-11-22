-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2b: 일반 파일의 로그인 역할용 올리기 규칙 (2026-11-23)
--
-- 왜: 새 로그인으로 들어온 요청(authenticated)은 지금 업무 버킷에 파일을 올릴 수 없다
--     (2a 실측: 화면이 쓰는 x-upsert: true 올리기 8건이 전부 거절). 실측으로는 x-upsert: true 가
--     읽기 규칙까지 요구했고, 읽기 규칙은 목록·정보 조회를 함께 열었다. 그래서 로그인 역할에는
--     "새 파일 만들기(올리기)" 규칙만 준다. 로그인 상태의 올리기를 옵션 없이 보내도록 화면을
--     바꾸는 것은 계약 3이다 — 이 파일은 화면을 바꾸지 않는다.
--
-- 하는 것
--   * storage.objects 에 새 규칙 4개. 전부 permissive, for insert, to authenticated, 이름은 b2n2b_ 로 시작.
--     판정은 2-가(20261122164348_b2a_identity_gate.sql)의 함수를 (select security_private.…()) 꼴로 쓴다.
--     조건마다 그 bucket_id 와 일치함을 함께 적는다. 경로는 저장소에 도착한 name 을 '/' 로 나눈 구간으로 본다.
--
--       b2n2b_score_member_insert   toefl-score-images  회원
--           구간이 정확히 3개, 첫 구간 'exam-reg', 둘째 구간이 current_member_id_text() 와 글자 그대로 같음
--           (그 값이 NULL 이 아님), 셋째 구간(파일 이름)이 비어 있지 않음
--       b2n2b_score_admin_insert    toefl-score-images  관리자(is_current_admin())
--           구간이 정확히 2개, 첫 구간 전체가 uuid 모양(16진수 8-4-4-4-12, 대소문자 모두, 처음부터 끝까지),
--           파일 이름이 비어 있지 않음
--       b2n2b_board_member_insert   board-files         회원(current_member_id() 가 NULL 이 아님)
--           구간이 정확히 2개, 첫 구간이 reviews·reviews_book·study_certify 중 하나, 파일 이름이 비어 있지 않음
--       b2n2b_board_admin_insert    board-files         관리자(is_current_admin())
--           구간이 정확히 2개, 첫 구간이 notice·materials·application_notice 중 하나, 파일 이름이 비어 있지 않음
--
--     회원 조건과 관리자 조건은 서로 독립이다. 회원 대응이 있는 관리자 계정은 6자리 전에도 "회원으로서"
--     자기 성적표 경로·학생 게시판에 올릴 수 있고, 관리자 경로·관리자 게시판은 6자리 후에만 된다.
--     회원 대응이 없는 관리자 계정은 6자리 후에 관리자 경로·관리자 게시판만 된다.
--     학생 게시판 셋은 관리자 명부로 열지 않는다(근거 없음) — 학생 게시판은 회원 대응으로만.
--
-- 하지 않는 것
--   * 기존 규칙(옛 비로그인 규칙 포함)·버킷 설정·표 권한(GRANT)·RLS 설정은 하나도 바꾸지 않는다.
--   * 로그인 역할의 읽기·수정·삭제 규칙(네 버킷 모두), guide-images·materials 의 새 규칙,
--     회원 표를 읽는 조건, 새 함수는 만들지 않는다.
--   * 파일 이름의 한글·확장자는 막지 않는다. 버킷의 크기·형식 제한은 그대로다.
--
-- 알아 둘 것
--   * 이 규칙만으로는 화면이 지금 쓰는 x-upsert: true 올리기가 되지 않는다(읽기 규칙을 주지 않았다).
--     되는 것은 옵션 없는 새 이름 올리기다.
--   * 관리자 성적표 경로는 첫 구간의 "모양"만 본다. 그 회원번호의 회원이 실제로 있는지는 보지 않는다
--     (없는 회원번호 폴더에도 올릴 수 있다 — 남은 허용).
--   * guide-images 의 올리기 규칙은 기존에 모든 역할에 열려 있다. 이 파일은 그것을 줄이지 않는다.
--   * 되돌리기: supabase/migrations_rollback/20261122201700_b2n2b_storage_insert_policies_rollback.sql
--   * 이 파일은 작업방이 실행해 보지 않았다.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 전제 확인 (하나라도 어긋나면 예외로 멈춘다 — 아무것도 만들어지지 않는다)
--    끝의 자기 점검과 견주려고 기존 규칙의 수와 지문을 이 트랜잭션 안에만 적어 둔다.
-- ---------------------------------------------------------------------
do $b2n2b_pre$
declare
  v_missing text;
  v_rls     boolean;
  v_count   bigint;
  v_fp      text;
begin
  -- 2-가의 판정 함수와 실행 권한
  if pg_catalog.to_regprocedure('security_private.current_member_id()') is null
     or pg_catalog.to_regprocedure('security_private.current_member_id_text()') is null
     or pg_catalog.to_regprocedure('security_private.is_current_admin()') is null then
    raise exception 'b2n2b 전제 실패: 2-가의 판정 함수(current_member_id·current_member_id_text·is_current_admin)가 없다';
  end if;
  if not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.current_member_id()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.current_member_id_text()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.is_current_admin()', 'EXECUTE') then
    raise exception 'b2n2b 전제 실패: authenticated 에 판정 함수 실행 권한이 없다';
  end if;

  -- 두 버킷
  select pg_catalog.string_agg(w.id, ', ' order by w.id)
    into v_missing
    from (values ('toefl-score-images'::pg_catalog.text), ('board-files')) as w(id)
   where not exists (select 1 from storage.buckets b where b.id = w.id);
  if v_missing is not null then
    raise exception 'b2n2b 전제 실패: 버킷이 없다: %', v_missing;
  end if;

  -- storage.objects 의 RLS
  select c.relrowsecurity
    into v_rls
    from pg_catalog.pg_class c
   where c.oid = 'storage.objects'::pg_catalog.regclass;
  if v_rls is not true then
    raise exception 'b2n2b 전제 실패: storage.objects 의 RLS가 꺼져 있다';
  end if;

  -- 같은 이름의 규칙이 이미 있으면 멈춘다(먼저 되돌리기 SQL)
  select pg_catalog.count(*)
    into v_count
    from pg_catalog.pg_policy pol
   where pol.polname::pg_catalog.text like 'b2n2b\_%';
  if v_count <> 0 then
    raise exception 'b2n2b 전제 실패: b2n2b_ 로 시작하는 규칙이 이미 % 개 있다(먼저 되돌리기 SQL)', v_count;
  end if;

  -- 기존 storage.objects 규칙 전체의 수와 지문(이름·동작·permissive·역할·모든 역할 대상·USING·WITH CHECK)
  select pg_catalog.count(*),
         pg_catalog.md5(coalesce(pg_catalog.string_agg(
           pol.polname::pg_catalog.text || '|' || pol.polcmd::pg_catalog.text || '|' || pol.polpermissive::pg_catalog.text || '|'
           || coalesce((select pg_catalog.array_agg(r.rolname::pg_catalog.text order by r.rolname::pg_catalog.text)
                          from pg_catalog.pg_roles r
                         where r.oid = any (pol.polroles)), '{}'::pg_catalog.text[])::pg_catalog.text || '|'
           || (0::pg_catalog.oid = any (pol.polroles))::pg_catalog.text || '|'
           || coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'null') || '|'
           || coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), 'null'),
           E'\n' order by pol.polname::pg_catalog.text), ''))
    into v_count, v_fp
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass;

  perform pg_catalog.set_config('b2n2b.pre_policy_count', v_count::pg_catalog.text, true);
  perform pg_catalog.set_config('b2n2b.pre_policy_fp', v_fp, true);
end;
$b2n2b_pre$;

-- ---------------------------------------------------------------------
-- 1. toefl-score-images — 회원: exam-reg/<자기 회원번호>/<파일>
--    근거: 테스트룸 js/toefl-exam.js:376~377 (학생, 자기 시험 등록)
--    둘째 구간은 글자 그대로 비교한다(대소문자를 바꾼 것은 다른 글자다).
-- ---------------------------------------------------------------------
create policy b2n2b_score_member_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'toefl-score-images'
    and pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) = 3
    and (pg_catalog.string_to_array(name, '/'))[1] = 'exam-reg'
    and (select security_private.current_member_id_text()) is not null
    and (pg_catalog.string_to_array(name, '/'))[2] = (select security_private.current_member_id_text())
    and (pg_catalog.string_to_array(name, '/'))[3] <> ''
  );

-- ---------------------------------------------------------------------
-- 2. toefl-score-images — 관리자: <회원번호 모양>/<파일>
--    근거: 공홈 js/admin-study-detail-v3.js:3328~3329 (관리자 화면)
--    첫 구간은 길이 36 이고 처음부터 끝까지 uuid 모양(16진수 8-4-4-4-12, 대소문자 모두)이어야 한다.
-- ---------------------------------------------------------------------
create policy b2n2b_score_admin_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'toefl-score-images'
    and (select security_private.is_current_admin())
    and pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) = 2
    and pg_catalog.length((pg_catalog.string_to_array(name, '/'))[1]) = 36
    and (pg_catalog.string_to_array(name, '/'))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and (pg_catalog.string_to_array(name, '/'))[2] <> ''
  );

-- ---------------------------------------------------------------------
-- 3. board-files — 회원: 학생 게시판 키 셋
--    근거: 공홈 write.html:1095~1121, 게시판 설정 write.html:430~500 (requireAdmin: false 인 키)
-- ---------------------------------------------------------------------
create policy b2n2b_board_member_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'board-files'
    and (select security_private.current_member_id()) is not null
    and pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) = 2
    and (pg_catalog.string_to_array(name, '/'))[1] in ('reviews', 'reviews_book', 'study_certify')
    and (pg_catalog.string_to_array(name, '/'))[2] <> ''
  );

-- ---------------------------------------------------------------------
-- 4. board-files — 관리자: 관리자 게시판 키 셋
--    근거: 같은 곳(requireAdmin: true 인 키). 학생 게시판 셋은 여기에 넣지 않는다.
-- ---------------------------------------------------------------------
create policy b2n2b_board_admin_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'board-files'
    and (select security_private.is_current_admin())
    and pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) = 2
    and (pg_catalog.string_to_array(name, '/'))[1] in ('notice', 'materials', 'application_notice')
    and (pg_catalog.string_to_array(name, '/'))[2] <> ''
  );

-- ---------------------------------------------------------------------
-- 5. 자기 점검 (같은 트랜잭션. 어긋나면 예외 → 전체가 되돌아간다)
--    (가) 새 규칙 4개가 규칙 표와 같다: 표·동작·역할·permissive·USING 없음·WITH CHECK 있음,
--         조건식에 그 버킷 이름이 있고, 회원 규칙에는 회원 판정만·관리자 규칙에는 관리자 판정만 있다
--    (나) b2n2b_ 규칙은 DB 전체에서 정확히 4개
--    (다) 기존 storage.objects 규칙의 수와 지문(이름·동작·역할·조건식)이 그대로
-- ---------------------------------------------------------------------
do $b2n2b_check$
declare
  v_want  record;
  v_got   record;
  v_seen  integer := 0;
  v_count bigint;
  v_fp    text;
begin
  for v_want in
    select t.pol, t.bucket, t.uses_member, t.uses_admin
      from (
        values
          ('b2n2b_score_member_insert'::pg_catalog.text, 'toefl-score-images'::pg_catalog.text, true,  false),
          ('b2n2b_score_admin_insert',                   'toefl-score-images',                  false, true),
          ('b2n2b_board_member_insert',                  'board-files',                         true,  false),
          ('b2n2b_board_admin_insert',                   'board-files',                         false, true)
      ) as t(pol, bucket, uses_member, uses_admin)
  loop
    v_seen := v_seen + 1;

    select pol.polrelid,
           pol.polcmd::pg_catalog.text as cmd,
           pol.polpermissive as permissive,
           coalesce((select pg_catalog.array_agg(r.rolname::pg_catalog.text order by r.rolname::pg_catalog.text)
                       from pg_catalog.pg_roles r
                      where r.oid = any (pol.polroles)), '{}'::pg_catalog.text[])::pg_catalog.text as roles,
           (0::pg_catalog.oid = any (pol.polroles)) as to_public,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_text,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as check_text
      into v_got
      from pg_catalog.pg_policy pol
     where pol.polname::pg_catalog.text = v_want.pol;
    if not found then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 가 없음', v_want.pol;
    end if;

    if v_got.polrelid <> 'storage.objects'::pg_catalog.regclass then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 가 storage.objects 의 규칙이 아님', v_want.pol;
    end if;
    if v_got.permissive is not true then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 가 permissive 가 아님', v_want.pol;
    end if;
    if v_got.cmd <> 'a' then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 의 동작이 % (올리기 a 여야 함)', v_want.pol, v_got.cmd;
    end if;
    if v_got.roles <> '{authenticated}' or v_got.to_public then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 의 역할이 % (authenticated 하나여야 함)', v_want.pol, v_got.roles;
    end if;
    if v_got.using_text is not null or v_got.check_text is null then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 는 USING 없이 WITH CHECK 만 있어야 함', v_want.pol;
    end if;
    if pg_catalog.strpos(v_got.check_text, 'bucket_id = ''' || v_want.bucket || '''') = 0 then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 의 조건식에 버킷 % 일치가 없음', v_want.pol, v_want.bucket;
    end if;
    if (pg_catalog.strpos(v_got.check_text, 'current_member_id') > 0) <> v_want.uses_member then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 의 회원 판정 유무가 규칙 표와 다름', v_want.pol;
    end if;
    if (pg_catalog.strpos(v_got.check_text, 'is_current_admin') > 0) <> v_want.uses_admin then
      raise exception 'b2n2b 자기 점검 실패: 규칙 % 의 관리자 판정 유무가 규칙 표와 다름', v_want.pol;
    end if;
  end loop;

  if v_seen <> 4 then
    raise exception 'b2n2b 자기 점검 실패: 규칙 표의 줄 수가 % (4여야 함)', v_seen;
  end if;

  -- (나) b2n2b_ 규칙은 DB 전체에서 정확히 4개(표에 없는 곳에 생긴 것이 없다)
  select pg_catalog.count(*)
    into v_count
    from pg_catalog.pg_policy pol
   where pol.polname::pg_catalog.text like 'b2n2b\_%';
  if v_count <> 4 then
    raise exception 'b2n2b 자기 점검 실패: b2n2b_ 규칙이 % 개(4여야 함)', v_count;
  end if;

  -- (다) 기존 storage.objects 규칙의 수와 지문이 그대로
  select pg_catalog.count(*),
         pg_catalog.md5(coalesce(pg_catalog.string_agg(
           pol.polname::pg_catalog.text || '|' || pol.polcmd::pg_catalog.text || '|' || pol.polpermissive::pg_catalog.text || '|'
           || coalesce((select pg_catalog.array_agg(r.rolname::pg_catalog.text order by r.rolname::pg_catalog.text)
                          from pg_catalog.pg_roles r
                         where r.oid = any (pol.polroles)), '{}'::pg_catalog.text[])::pg_catalog.text || '|'
           || (0::pg_catalog.oid = any (pol.polroles))::pg_catalog.text || '|'
           || coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'null') || '|'
           || coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), 'null'),
           E'\n' order by pol.polname::pg_catalog.text), ''))
    into v_count, v_fp
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass
     and pol.polname::pg_catalog.text not like 'b2n2b\_%';

  if v_count::pg_catalog.text is distinct from pg_catalog.current_setting('b2n2b.pre_policy_count', true) then
    raise exception 'b2n2b 자기 점검 실패: 기존 규칙 수가 바뀜(전 % → 후 %)', pg_catalog.current_setting('b2n2b.pre_policy_count', true), v_count;
  end if;
  if v_fp is distinct from pg_catalog.current_setting('b2n2b.pre_policy_fp', true) then
    raise exception 'b2n2b 자기 점검 실패: 기존 규칙의 지문이 바뀜';
  end if;
end;
$b2n2b_check$;

commit;
