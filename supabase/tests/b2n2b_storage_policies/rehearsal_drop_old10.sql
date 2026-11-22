-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2b 전환 예행: 옛 비로그인 규칙 10개 지우기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   이 파일을 운영(qpqjevecjejvbeuogtbx)에서 실행하면 실제 파일 규칙이 바뀐다(지우기 파일은 실제 규칙 10개가
--   지워져 지금 화면의 첨부·성적표 올리기와 읽기가 막힌다). 시험 프로젝트 hmncdheiwqwekdbtijar 전용이다.
--   실행 직전에 절차.md 의 "예행 직전 대상 확인"을 다시 한다: SQL 통로의 ref 와 Storage 주소의 ref 가
--   둘 다 hmncdheiwqwekdbtijar 여야 한다.
--   파일 안의 확인(대상 확인 값 + 운영이 아님의 DB 안 증거)은 그 확인을 대신하지 않는다 —
--   DB 는 자기 프로젝트 ref 를 스스로 알지 못한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서와 기대 결과는 같은 폴더의 절차.md 를 따른다.
-- 이 예행은 "성공·실패와 관계없이 바로 복원"한다 — 복원은 rehearsal_restore_old10.sql.
--
-- 하는 일: storage.objects 에서 "비로그인 역할(anon)만 지정한" 옛 규칙 10개를 이름으로 지운다(한 트랜잭션).
--     버킷                동작   이름
--     materials           insert "Allow Upload b9j0vg_0"
--     materials           select "Public Read b9j0vg_0"
--     guide-images        select "allow public read iqdobt_0"
--     board-files         insert "allow public upload og9vps_0"
--     board-files         update "allow public upload og9vps_1"
--     board-files         select "allow public upload og9vps_2"
--     board-files         delete "allow public upload og9vps_3"
--     toefl-score-images  delete "toefl_scores_delete"
--     toefl-score-images  select "toefl_scores_read"
--     toefl-score-images  insert "toefl_scores_upload"
--   그 밖의 옛 규칙 16개, 새 규칙(b2n2b_), 버킷 설정, 객체 행, 표 권한, RLS 설정은 건드리지 않는다.
--
-- 지우기 직전에 스스로 확인하는 것(하나라도 다르면 아무것도 지우지 않고 멈춘다)
--   0. 대상 확인: 같은 요청에서 정한 확인 값 + 이 DB 가 운영이 아니라는 DB 안의 증거
--      (도구가 건드리지 않는 버킷 6개의 객체 0개, 업무 버킷 4개에 이 조각의 표식이 없는 객체 0개)
--   1. 옛 26개 전체가 있고, 그 정의(이름·동작·permissive·역할·모든 역할 대상·USING·WITH CHECK)가
--      아래에 적어 둔 기준선 정의와 글자로 같다(대상 10개 포함).
--      기준선 정의의 근거: C:\기능구현\보안작업\묶음2\계약2나2a_파일기준선_사실.json 의 production.policies
--   조건식 글자는 search_path 에 따라 달라지므로 이 트랜잭션 안에서만 search_path 를 public 으로 둔다
--   (사실 자료의 글자가 그 모양이다: private_book_is_admin() 은 스키마 없이, auth.role() 은 스키마와 함께).
--
-- 실행 방법: 같은 요청(같은 접속)의 맨 앞에  set b2n2b.test_project_ref = 'hmncdheiwqwekdbtijar';  를 두고 이 파일 전체.
-- =====================================================================

begin;

set local search_path = public;

do $b2n2b_drop$
declare
  v_defs constant pg_catalog.jsonb := $b2n2b_defs$[
    {"name":"Allow Upload b9j0vg_0","cmd":"a","permissive":true,"roles":["anon"],"to_public":false,"using":null,"check":"(bucket_id = 'materials'::text)","old10":true},
    {"name":"Allow authenticated read on books","cmd":"r","permissive":true,"roles":[],"to_public":true,"using":"((bucket_id = 'books'::text) AND (auth.role() = 'anon'::text))","check":null,"old10":false},
    {"name":"Allow public read","cmd":"r","permissive":true,"roles":[],"to_public":true,"using":"(bucket_id = 'speaking-files'::text)","check":null,"old10":false},
    {"name":"Allow public upload","cmd":"a","permissive":true,"roles":[],"to_public":true,"using":null,"check":"(bucket_id = 'speaking-files'::text)","old10":false},
    {"name":"Allow read from correction-audio","cmd":"r","permissive":true,"roles":["anon","authenticated"],"to_public":false,"using":"(bucket_id = 'correction-audio'::text)","check":null,"old10":false},
    {"name":"Allow update in correction-audio","cmd":"w","permissive":true,"roles":["anon","authenticated"],"to_public":false,"using":"(bucket_id = 'correction-audio'::text)","check":null,"old10":false},
    {"name":"Allow upload to correction-audio","cmd":"a","permissive":true,"roles":["anon","authenticated"],"to_public":false,"using":null,"check":"(bucket_id = 'correction-audio'::text)","old10":false},
    {"name":"Public Read b9j0vg_0","cmd":"r","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'materials'::text)","check":null,"old10":true},
    {"name":"allow public read iqdobt_0","cmd":"r","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'guide-images'::text)","check":null,"old10":true},
    {"name":"allow public upload og9vps_0","cmd":"a","permissive":true,"roles":["anon"],"to_public":false,"using":null,"check":"(bucket_id = 'board-files'::text)","old10":true},
    {"name":"allow public upload og9vps_1","cmd":"w","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'board-files'::text)","check":null,"old10":true},
    {"name":"allow public upload og9vps_2","cmd":"r","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'board-files'::text)","check":null,"old10":true},
    {"name":"allow public upload og9vps_3","cmd":"d","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'board-files'::text)","check":null,"old10":true},
    {"name":"allow upload iqdobt_0","cmd":"a","permissive":true,"roles":[],"to_public":true,"using":null,"check":"(bucket_id = 'guide-images'::text)","old10":false},
    {"name":"allow_public_select","cmd":"r","permissive":true,"roles":[],"to_public":true,"using":"(bucket_id = 'review-images'::text)","check":null,"old10":false},
    {"name":"allow_public_upload","cmd":"a","permissive":true,"roles":[],"to_public":true,"using":null,"check":"(bucket_id = 'review-images'::text)","old10":false},
    {"name":"board-images public insert","cmd":"a","permissive":true,"roles":[],"to_public":true,"using":null,"check":"(bucket_id = 'board-images'::text)","old10":false},
    {"name":"board-images public read","cmd":"r","permissive":true,"roles":[],"to_public":true,"using":"(bucket_id = 'board-images'::text)","check":null,"old10":false},
    {"name":"board-images public update","cmd":"w","permissive":true,"roles":[],"to_public":true,"using":"(bucket_id = 'board-images'::text)","check":null,"old10":false},
    {"name":"pb_book_private_delete","cmd":"d","permissive":true,"roles":["authenticated"],"to_public":false,"using":"((bucket_id = 'book-private'::text) AND private_book_is_admin())","check":null,"old10":false},
    {"name":"pb_book_private_insert","cmd":"a","permissive":true,"roles":["authenticated"],"to_public":false,"using":null,"check":"((bucket_id = 'book-private'::text) AND private_book_is_admin())","old10":false},
    {"name":"pb_book_private_select","cmd":"r","permissive":true,"roles":["authenticated"],"to_public":false,"using":"((bucket_id = 'book-private'::text) AND private_book_is_admin())","check":null,"old10":false},
    {"name":"pb_book_private_update","cmd":"w","permissive":true,"roles":["authenticated"],"to_public":false,"using":"((bucket_id = 'book-private'::text) AND private_book_is_admin())","check":"((bucket_id = 'book-private'::text) AND private_book_is_admin())","old10":false},
    {"name":"toefl_scores_delete","cmd":"d","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'toefl-score-images'::text)","check":null,"old10":true},
    {"name":"toefl_scores_read","cmd":"r","permissive":true,"roles":["anon"],"to_public":false,"using":"(bucket_id = 'toefl-score-images'::text)","check":null,"old10":true},
    {"name":"toefl_scores_upload","cmd":"a","permissive":true,"roles":["anon"],"to_public":false,"using":null,"check":"(bucket_id = 'toefl-score-images'::text)","old10":true}
  ]$b2n2b_defs$::pg_catalog.jsonb;
  v_def      pg_catalog.jsonb;
  v_got      record;
  v_missing  text;
  v_count    bigint;
  v_seen     integer := 0;
  v_targets  integer := 0;
  v_pre_total bigint;
  v_pre_rest_n bigint;
  v_pre_rest_fp text;
  v_post_rest_n bigint;
  v_post_rest_fp text;
  v_dropped  text[] := '{}';
begin
  -- -------------------------------------------------------------------
  -- 0. 대상 확인 (맨 앞. 하나라도 다르거나 확인할 수 없으면 아무것도 쓰지 않고 멈춘다)
  --    DB 는 자기 프로젝트 ref 를 알지 못한다. 그래서 둘을 다 요구한다.
  --    (1) 같은 요청에서 정한 대상 확인 값  (2) 이 DB 가 운영이 아니라는 DB 안의 증거
  -- -------------------------------------------------------------------
  if coalesce(pg_catalog.current_setting('b2n2b.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'b2n2b 예행(지우기) 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b2n2b.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  -- 기준선 버킷 10개가 있어야 한다(없으면 이 DB 가 기준선을 올려 둔 시험 프로젝트인지 확인할 수 없다)
  select pg_catalog.string_agg(w.id, ', ' order by w.id)
    into v_missing
    from (
      values ('board-files'::pg_catalog.text), ('board-images'), ('book-private'), ('books'), ('correction-audio'),
             ('guide-images'), ('materials'), ('review-images'), ('speaking-files'), ('toefl-score-images')
    ) as w(id)
   where not exists (select 1 from storage.buckets b where b.id = w.id);
  if v_missing is not null then
    raise exception 'b2n2b 예행(지우기) 중단: 기준선 버킷이 없다: %. 대상을 확인할 수 없다. 아무것도 바꾸지 않았다', v_missing;
  end if;

  -- 운영이 아님: 이 조각의 도구가 건드리지 않는 기준선 버킷 6개에는 시험 프로젝트에서 객체가 0개다.
  -- 운영에는 이 6개 버킷에 실제 파일이 수천 개 있다(사실 자료 기준 7,629개).
  select pg_catalog.count(*)
    into v_count
    from storage.objects o
   where o.bucket_id in ('board-images', 'book-private', 'books', 'correction-audio', 'review-images', 'speaking-files');
  if v_count <> 0 then
    raise exception 'b2n2b 예행(지우기) 중단: 도구가 건드리지 않는 버킷 6개에 객체가 % 개 있다. 이 DB 는 시험 프로젝트(hmncdheiwqwekdbtijar)로 확인되지 않는다(운영일 수 있다). 아무것도 바꾸지 않았다', v_count;
  end if;

  -- 운영이 아님(지우기 전용의 추가 확인): 업무 버킷 4개의 객체는 전부 이 조각의 합성 객체(이름에 zzb2n2b)여야 한다.
  select pg_catalog.count(*)
    into v_count
    from storage.objects o
   where o.bucket_id in ('materials', 'guide-images', 'board-files', 'toefl-score-images')
     and pg_catalog.strpos(o.name, 'zzb2n2b') = 0;
  if v_count <> 0 then
    raise exception 'b2n2b 예행(지우기) 중단: 업무 버킷 4개에 이 조각의 표식(zzb2n2b)이 없는 객체가 % 개 있다. 실제 파일일 수 있다. 아무것도 바꾸지 않았다', v_count;
  end if;

  -- -------------------------------------------------------------------
  -- 1. 옛 26개 전체가 기준선 정의와 글자로 같은가(대상 10개 포함)
  -- -------------------------------------------------------------------
  if pg_catalog.jsonb_array_length(v_defs) <> 26 then
    raise exception 'b2n2b 예행(지우기) 중단: 파일 안의 기준선 정의가 26개가 아니다';
  end if;
  for v_def in select e.value from pg_catalog.jsonb_array_elements(v_defs) as e(value)
  loop
    v_seen := v_seen + 1;
    if (v_def ->> 'old10')::pg_catalog.bool then
      v_targets := v_targets + 1;
    end if;
    select pol.polcmd::pg_catalog.text as cmd,
           pol.polpermissive as permissive,
           pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(r.rolname::pg_catalog.text order by r.rolname::pg_catalog.text)
                       from pg_catalog.pg_roles r
                      where r.oid = any (pol.polroles)), '{}'::pg_catalog.text[])) as roles,
           (0::pg_catalog.oid = any (pol.polroles)) as to_public,
           pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_text,
           pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as check_text
      into v_got
      from pg_catalog.pg_policy pol
     where pol.polrelid = 'storage.objects'::pg_catalog.regclass
       and pol.polname::pg_catalog.text = (v_def ->> 'name');
    if not found then
      raise exception 'b2n2b 예행(지우기) 중단: 옛 규칙 "%" 가 없다(이미 지워졌으면 rehearsal_restore_old10.sql 로 복원한 뒤 다시). 아무것도 바꾸지 않았다', v_def ->> 'name';
    end if;
    if not (v_got.permissive is not distinct from (v_def ->> 'permissive')::pg_catalog.bool
        and v_got.cmd is not distinct from (v_def ->> 'cmd')
        and v_got.roles = (v_def -> 'roles')
        and v_got.to_public is not distinct from (v_def ->> 'to_public')::pg_catalog.bool
        and v_got.using_text is not distinct from (v_def ->> 'using')
        and v_got.check_text is not distinct from (v_def ->> 'check')) then
      raise exception 'b2n2b 예행(지우기) 중단: 옛 규칙 "%" 의 정의가 기준선과 다르다 — 동작 %/% 역할 %/% 모든역할 %/% USING [%]/[%] CHECK [%]/[%] (실제/기준선). 아무것도 바꾸지 않았다',
        v_def ->> 'name', v_got.cmd, v_def ->> 'cmd', v_got.roles, v_def -> 'roles', v_got.to_public, v_def ->> 'to_public',
        v_got.using_text, v_def ->> 'using', v_got.check_text, v_def ->> 'check';
    end if;
  end loop;
  if v_seen <> 26 or v_targets <> 10 then
    raise exception 'b2n2b 예행(지우기) 중단: 파일 안의 정의 수가 다르다(전체 %, 대상 %)', v_seen, v_targets;
  end if;

  -- 지우기 전의 수와, 대상이 아닌 규칙 전부(옛 16개·새 규칙·그 밖)의 지문
  select pg_catalog.count(*) into v_pre_total
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass;
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
    into v_pre_rest_n, v_pre_rest_fp
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass
     and not exists (select 1 from pg_catalog.jsonb_array_elements(v_defs) as e(value)
                      where (e.value ->> 'old10')::pg_catalog.bool and (e.value ->> 'name') = pol.polname::pg_catalog.text);

  -- -------------------------------------------------------------------
  -- 2. 대상 10개를 이름으로 지운다(if exists 없음 — 없으면 그 자리에서 실패하고 전체가 되돌아간다)
  -- -------------------------------------------------------------------
  for v_def in select e.value from pg_catalog.jsonb_array_elements(v_defs) as e(value)
                where (e.value ->> 'old10')::pg_catalog.bool
                order by e.value ->> 'name'
  loop
    execute pg_catalog.format('drop policy %I on storage.objects', v_def ->> 'name');
    v_dropped := pg_catalog.array_append(v_dropped, v_def ->> 'name');
  end loop;

  -- -------------------------------------------------------------------
  -- 3. 지운 뒤 확인(어긋나면 예외 → 전체가 되돌아간다)
  -- -------------------------------------------------------------------
  select pg_catalog.count(*) into v_count
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass
     and exists (select 1 from pg_catalog.jsonb_array_elements(v_defs) as e(value)
                  where (e.value ->> 'old10')::pg_catalog.bool and (e.value ->> 'name') = pol.polname::pg_catalog.text);
  if v_count <> 0 then
    raise exception 'b2n2b 예행(지우기) 실패: 대상 규칙이 % 개 남아 있다', v_count;
  end if;
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
    into v_post_rest_n, v_post_rest_fp
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'storage.objects'::pg_catalog.regclass;
  if v_post_rest_n <> v_pre_total - 10 or v_post_rest_n <> v_pre_rest_n or v_post_rest_fp is distinct from v_pre_rest_fp then
    raise exception 'b2n2b 예행(지우기) 실패: 대상이 아닌 규칙이 바뀌었다(수 전 % → 후 %, 전체 전 %)', v_pre_rest_n, v_post_rest_n, v_pre_total;
  end if;

  perform pg_catalog.set_config('b2n2b.last_action',
    'dropped ' || pg_catalog.array_length(v_dropped, 1)::pg_catalog.text || ': ' || pg_catalog.array_to_string(v_dropped, ', '), false);
end;
$b2n2b_drop$;

commit;

-- ---------------------------------------------------------------------
-- 끝난 뒤의 상태(읽기만). SQL 통로가 마지막 문장의 결과를 돌려준다.
-- ---------------------------------------------------------------------
select pg_catalog.jsonb_build_object(
  'file', 'rehearsal_drop_old10.sql',
  'done', pg_catalog.current_setting('b2n2b.last_action', true),
  'old10_present', (select coalesce(pg_catalog.jsonb_agg(t.name order by t.name), '[]'::pg_catalog.jsonb)
                      from (values ('Allow Upload b9j0vg_0'::pg_catalog.text), ('Public Read b9j0vg_0'), ('allow public read iqdobt_0'), ('allow public upload og9vps_0'), ('allow public upload og9vps_1'), ('allow public upload og9vps_2'), ('allow public upload og9vps_3'), ('toefl_scores_delete'), ('toefl_scores_read'), ('toefl_scores_upload')) as t(name)
                     where exists (select 1 from pg_catalog.pg_policy p
                                    where p.polrelid = 'storage.objects'::pg_catalog.regclass and p.polname::pg_catalog.text = t.name)),
  'old10_missing', (select coalesce(pg_catalog.jsonb_agg(t.name order by t.name), '[]'::pg_catalog.jsonb)
                      from (values ('Allow Upload b9j0vg_0'::pg_catalog.text), ('Public Read b9j0vg_0'), ('allow public read iqdobt_0'), ('allow public upload og9vps_0'), ('allow public upload og9vps_1'), ('allow public upload og9vps_2'), ('allow public upload og9vps_3'), ('toefl_scores_delete'), ('toefl_scores_read'), ('toefl_scores_upload')) as t(name)
                     where not exists (select 1 from pg_catalog.pg_policy p
                                        where p.polrelid = 'storage.objects'::pg_catalog.regclass and p.polname::pg_catalog.text = t.name)),
  'storage_policies_n', (select pg_catalog.count(*) from pg_catalog.pg_policy p where p.polrelid = 'storage.objects'::pg_catalog.regclass),
  'b2n2b_policies_n', (select pg_catalog.count(*) from pg_catalog.pg_policy p
                        where p.polrelid = 'storage.objects'::pg_catalog.regclass and p.polname::pg_catalog.text like 'b2n2b\_%')
) as result;
