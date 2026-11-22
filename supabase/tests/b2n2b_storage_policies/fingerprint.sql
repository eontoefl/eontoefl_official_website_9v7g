-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2b 지문 질의 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 쓰는 곳과 견주는 법은 절차.md 를 따른다. 아무것도 바꾸지 않는다.
-- 2a 의 fingerprint.sql 과 같은 계산식을 쓴 키(아래 ★)는 2a 의 F9 와 글자로 견줄 수 있다.
--
-- 결과의 키
--   storage_policies   storage.objects 의 규칙 전부: n, fp, list(name·cmd·permissive·roles·to_public·using·check)
--                      cmd 는 r 읽기·a 올리기·w 수정·d 삭제. using·check 는 이 접속의 search_path 로 풀어 쓴 글자다.
--   old26              옛 규칙 26개(이름으로 고른다): n, fp, missing(없는 이름)
--                      ★ 26개가 다 있으면 fp 는 2a F9 의 baseline_policies.fp 와 같은 계산식이다.
--   old10              그중 전환 예행에서 지우는 "비로그인 역할만 지정한" 10개: n, fp, present(있는 이름), missing(없는 이름)
--   old16              옛 26개 중 나머지 16개: n, fp
--   new_policies       새 규칙(b2n2b_): n, fp, list — 적용 뒤 4, 적용 전·되돌린 뒤 0
--   other_policies     storage.objects 의 규칙 중 위 어디에도 들지 않는 것의 이름(있으면 안 된다)
--   b2n2b_elsewhere    storage.objects 가 아닌 표에 있는 b2n2b_ 규칙 수(0이어야 한다)
--   baseline_buckets   ★ 기준선 버킷 10개: n, fp, list — 버킷 설정(공개 여부·크기 제한·형식 제한)
--   other_buckets      그 밖의 버킷 이름(있으면 안 된다)
--   object_counts      버킷별 객체 수(객체가 없는 버킷도 0으로)
--   untouched_objects  이 조각의 도구가 건드리지 않는 기준선 버킷 6개의 객체 수 합(시험 프로젝트에서는 0이어야 한다.
--                      운영에는 수천 개가 있다 — 예행 SQL 이 "운영이 아님"을 스스로 확인하는 근거와 같은 값이다)
--   objects            객체 행 전부: bucket_id·name·id·owner·owner_id·size·mimetype·etag·created_at·updated_at
--                      — Storage API 로는 볼 수 없는 "소유자"를 여기서 본다(storage_matrix.mjs 의 owners 단계가 견준다)
--   objects_table      storage.objects 의 소유자·RLS 켜짐
--   tables_side        ★ 이 조각이 건드리지 않았음을 보이는 표 쪽 지문:
--                      public_policies(n·fp), b2n1_policies(n), security_private_functions(n·fp),
--                      security_private_tables, pre_request_set
-- =====================================================================
with baseline_ids(id) as (
  values
    ('board-files'), ('board-images'), ('book-private'), ('books'), ('correction-audio'),
    ('guide-images'), ('materials'), ('review-images'), ('speaking-files'), ('toefl-score-images')
),
untouched_ids(id) as (
  values ('board-images'), ('book-private'), ('books'), ('correction-audio'), ('review-images'), ('speaking-files')
),
old26(name, in_old10) as (
  values
    ('Allow Upload b9j0vg_0', true),
    ('Allow authenticated read on books', false),
    ('Allow public read', false),
    ('Allow public upload', false),
    ('Allow read from correction-audio', false),
    ('Allow update in correction-audio', false),
    ('Allow upload to correction-audio', false),
    ('Public Read b9j0vg_0', true),
    ('allow public read iqdobt_0', true),
    ('allow public upload og9vps_0', true),
    ('allow public upload og9vps_1', true),
    ('allow public upload og9vps_2', true),
    ('allow public upload og9vps_3', true),
    ('allow upload iqdobt_0', false),
    ('allow_public_select', false),
    ('allow_public_upload', false),
    ('board-images public insert', false),
    ('board-images public read', false),
    ('board-images public update', false),
    ('pb_book_private_delete', false),
    ('pb_book_private_insert', false),
    ('pb_book_private_select', false),
    ('pb_book_private_update', false),
    ('toefl_scores_delete', true),
    ('toefl_scores_read', true),
    ('toefl_scores_upload', true)
),
bk as (
  select b.id::text as id,
         b.name::text as name,
         b.public,
         b.file_size_limit,
         b.allowed_mime_types,
         b.avif_autodetection
    from storage.buckets b
),
pol as (
  select p.polname::text as name,
         p.polcmd::text as cmd,
         p.polpermissive as permissive,
         coalesce((select array_agg(r.rolname::text order by r.rolname::text)
                     from pg_catalog.pg_roles r
                    where r.oid = any (p.polroles)), '{}'::text[]) as roles,
         (0::oid = any (p.polroles)) as to_public,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_text,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_text
    from pg_catalog.pg_policy p
   where p.polrelid = 'storage.objects'::regclass
),
polline as (
  select name,
         name || '|' || cmd || '|' || permissive::text || '|' || roles::text || '|' || to_public::text || '|'
         || coalesce(using_text, 'null') || '|' || coalesce(check_text, 'null') as line
    from pol
),
obj as (
  select o.bucket_id::text as bucket_id,
         o.name::text as name,
         o.id::text as id,
         o.owner::text as owner,
         o.owner_id::text as owner_id,
         o.metadata ->> 'size' as size,
         o.metadata ->> 'mimetype' as mimetype,
         o.metadata ->> 'eTag' as etag,
         o.created_at,
         o.updated_at
    from storage.objects o
),
pubpol as (
  select p.schemaname::text as sch, p.tablename::text as tbl, p.policyname::text as name,
         p.permissive::text as permissive, p.roles::text as roles, p.cmd::text as cmd, p.qual, p.with_check
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
),
spfn as (
  select p.proname::text as name,
         pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,
         coalesce(p.proconfig::text, '') as config,
         coalesce(p.proacl::text, '') as acl,
         md5(coalesce(p.prosrc, '')) as src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'security_private'
),
sptb as (
  select c.relname::text as name,
         c.relrowsecurity as rls,
         (select count(*) from pg_catalog.pg_policy pp where pp.polrelid = c.oid) as policies
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'security_private' and c.relkind = 'r'
)
select jsonb_build_object(
  'read_at', now(),
  'storage_policies', jsonb_build_object(
    'n',  (select count(*) from pol),
    'fp', (select md5(coalesce(string_agg(line, E'\n' order by name), '')) from polline),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'cmd', cmd, 'permissive', permissive, 'roles', to_jsonb(roles), 'to_public', to_public,
               'using', using_text, 'check', check_text) order by name), '[]'::jsonb) from pol)
  ),
  'old26', jsonb_build_object(
    'n',  (select count(*) from polline where name in (select name from old26)),
    'fp', (select md5(coalesce(string_agg(line, E'\n' order by name), '')) from polline where name in (select name from old26)),
    'missing', (select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb)
                  from old26 o where o.name not in (select name from pol))
  ),
  'old10', jsonb_build_object(
    'n',  (select count(*) from polline where name in (select name from old26 where in_old10)),
    'fp', (select md5(coalesce(string_agg(line, E'\n' order by name), '')) from polline where name in (select name from old26 where in_old10)),
    'present', (select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb)
                  from old26 o where o.in_old10 and o.name in (select name from pol)),
    'missing', (select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb)
                  from old26 o where o.in_old10 and o.name not in (select name from pol))
  ),
  'old16', jsonb_build_object(
    'n',  (select count(*) from polline where name in (select name from old26 where not in_old10)),
    'fp', (select md5(coalesce(string_agg(line, E'\n' order by name), '')) from polline where name in (select name from old26 where not in_old10))
  ),
  'new_policies', jsonb_build_object(
    'n',  (select count(*) from polline where name like 'b2n2b\_%'),
    'fp', (select md5(coalesce(string_agg(line, E'\n' order by name), '')) from polline where name like 'b2n2b\_%'),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'cmd', cmd, 'permissive', permissive, 'roles', to_jsonb(roles), 'to_public', to_public,
               'using', using_text, 'check', check_text) order by name), '[]'::jsonb) from pol where name like 'b2n2b\_%')
  ),
  'other_policies', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
                       from pol where name not in (select name from old26) and name not like 'b2n2b\_%'),
  'b2n2b_elsewhere', (select count(*) from pg_catalog.pg_policy p
                       where p.polname::text like 'b2n2b\_%' and p.polrelid <> 'storage.objects'::regclass),
  'baseline_buckets', jsonb_build_object(
    'n',  (select count(*) from bk where id in (select id from baseline_ids)),
    'fp', (select md5(coalesce(string_agg(
             id || '|' || name || '|' || public::text || '|' || coalesce(file_size_limit::text, 'null') || '|'
             || coalesce(allowed_mime_types::text, 'null') || '|' || coalesce(avif_autodetection::text, 'null'),
             E'\n' order by id), '')) from bk where id in (select id from baseline_ids)),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'name', name, 'public', public, 'file_size_limit', file_size_limit,
               'allowed_mime_types', to_jsonb(allowed_mime_types), 'avif_autodetection', avif_autodetection) order by id), '[]'::jsonb)
               from bk where id in (select id from baseline_ids))
  ),
  'other_buckets', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                      from bk where id not in (select id from baseline_ids)),
  'object_counts', (select coalesce(jsonb_object_agg(bk.id, (select count(*) from obj where obj.bucket_id = bk.id)), '{}'::jsonb) from bk),
  'untouched_objects', (select count(*) from obj where bucket_id in (select id from untouched_ids)),
  'objects', (select coalesce(jsonb_agg(jsonb_build_object(
                'bucket_id', bucket_id, 'name', name, 'id', id, 'owner', owner, 'owner_id', owner_id,
                'size', size, 'mimetype', mimetype, 'etag', etag, 'created_at', created_at, 'updated_at', updated_at)
                order by bucket_id, name), '[]'::jsonb) from obj),
  'objects_table', (select jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner)::text, 'rls', c.relrowsecurity)
                      from pg_catalog.pg_class c where c.oid = 'storage.objects'::regclass),
  'tables_side', jsonb_build_object(
    'public_policies', jsonb_build_object(
      'n',  (select count(*) from pubpol),
      'fp', (select md5(coalesce(string_agg(
               tbl || '|' || name || '|' || permissive || '|' || roles || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
               E'\n' order by tbl, name), '')) from pubpol)
    ),
    'b2n1_policies', jsonb_build_object('n', (select count(*) from pubpol where name like 'b2n1\_%')),
    'security_private_functions', jsonb_build_object(
      'n',  (select count(*) from spfn),
      'fp', (select md5(coalesce(string_agg(
               name || '(' || args || ')|' || prosecdef::text || '|' || config || '|' || acl || '|' || src,
               E'\n' order by name, args), '')) from spfn)
    ),
    'security_private_tables', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'rls', rls, 'policies', policies) order by name), '[]'::jsonb) from sptb),
    'pre_request_set', exists (
      select 1
        from pg_catalog.pg_db_role_setting s
       where exists (select 1 from unnest(s.setconfig) as cfg(item) where strpos(cfg.item, 'pgrst.db_pre_request=') = 1)
    )
  )
) as result;
