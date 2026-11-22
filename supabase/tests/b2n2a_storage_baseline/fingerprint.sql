-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2a 지문 질의 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 쓰는 곳과 견주는 법은 절차.md 를 따른다. 아무것도 바꾸지 않는다.
--
-- 결과의 키
--   buckets            버킷 전부: n, list(id·name·public·file_size_limit·allowed_mime_types·avif_autodetection)
--                      — 사실 자료(계약2나2a_파일기준선_사실.json)의 production.buckets 와 같은 모양
--   baseline_buckets   그중 기준선 10개: n, fp, list — 운영과 같아야 하는 것(①)
--   probe_buckets      임시 버킷(zz-b2n2a-…): n, list
--   other_buckets      그 밖의 버킷 이름(있으면 안 된다)
--   storage_policies   storage.objects 의 규칙 전부: n, list(name·cmd·permissive·roles·to_public·using·check)
--                      — 사실 자료의 production.policies 와 같은 모양. cmd 는 r 읽기·a 올리기·w 수정·d 삭제.
--                        roles 는 이름순으로 정렬해 낸다(사실 자료와는 순서가 아니라 집합으로 견준다).
--                        using·check 는 이 접속의 search_path 로 풀어 쓴 글자다.
--   baseline_policies  그중 이름이 zz_b2n2a_ 로 시작하지 않는 것: n, fp — 운영과 같아야 하는 것(①, n = 26)
--   probe_policies     임시 규칙(zz_b2n2a_): n, list(이름) — 실측 중 12, 그 밖에는 0
--   object_counts      버킷별 객체 수(객체가 없는 버킷도 0으로) — 기준은 "운영과 같음"이 아니라 시험 쪽 0
--   objects            객체 행 전부: bucket_id·name·id·owner·owner_id·size·mimetype·created_at·updated_at
--                      — Storage API 로는 볼 수 없는 "소유자"를 여기서 본다(measure.mjs 결과의 경로와 맞춰 읽는다)
--   objects_table      storage.objects 의 소유자·RLS 켜짐
--   tables_side        이 조각이 건드리지 않았음을 보이는 표 쪽 지문:
--                      public_policies(public 스키마의 규칙 전부 n·fp — 2-나-1 의 27개 포함),
--                      b2n1_policies(n), security_private_functions(n·fp — 2-가의 함수),
--                      security_private_tables(표·RLS·규칙 수), pre_request_set(공통 확인 설정이 걸려 있는가)
-- =====================================================================
with baseline_ids(id) as (
  values
    ('board-files'), ('board-images'), ('book-private'), ('books'), ('correction-audio'),
    ('guide-images'), ('materials'), ('review-images'), ('speaking-files'), ('toefl-score-images')
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
obj as (
  select o.bucket_id::text as bucket_id,
         o.name::text as name,
         o.id::text as id,
         o.owner::text as owner,
         o.owner_id::text as owner_id,
         o.metadata ->> 'size' as size,
         o.metadata ->> 'mimetype' as mimetype,
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
  'buckets', jsonb_build_object(
    'n', (select count(*) from bk),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'name', name, 'public', public, 'file_size_limit', file_size_limit,
               'allowed_mime_types', to_jsonb(allowed_mime_types), 'avif_autodetection', avif_autodetection) order by id), '[]'::jsonb) from bk)
  ),
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
  'probe_buckets', jsonb_build_object(
    'n', (select count(*) from bk where id like 'zz-b2n2a-%'),
    'list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit,
               'allowed_mime_types', to_jsonb(allowed_mime_types)) order by id), '[]'::jsonb) from bk where id like 'zz-b2n2a-%')
  ),
  'other_buckets', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                      from bk where id not in (select id from baseline_ids) and id not like 'zz-b2n2a-%'),
  'storage_policies', jsonb_build_object(
    'n', (select count(*) from pol),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'cmd', cmd, 'permissive', permissive, 'roles', to_jsonb(roles), 'to_public', to_public,
               'using', using_text, 'check', check_text) order by name), '[]'::jsonb) from pol)
  ),
  'baseline_policies', jsonb_build_object(
    'n',  (select count(*) from pol where name not like 'zz\_b2n2a\_%'),
    'fp', (select md5(coalesce(string_agg(
             name || '|' || cmd || '|' || permissive::text || '|' || roles::text || '|' || to_public::text || '|'
             || coalesce(using_text, 'null') || '|' || coalesce(check_text, 'null'),
             E'\n' order by name), '')) from pol where name not like 'zz\_b2n2a\_%')
  ),
  'probe_policies', jsonb_build_object(
    'n', (select count(*) from pg_catalog.pg_policy p where p.polname::text like 'zz\_b2n2a\_%'),
    'list', (select coalesce(jsonb_agg(p.polname::text order by p.polname::text), '[]'::jsonb)
               from pg_catalog.pg_policy p where p.polname::text like 'zz\_b2n2a\_%')
  ),
  'object_counts', (select coalesce(jsonb_object_agg(bk.id, (select count(*) from obj where obj.bucket_id = bk.id)), '{}'::jsonb) from bk),
  'objects', (select coalesce(jsonb_agg(jsonb_build_object(
                'bucket_id', bucket_id, 'name', name, 'id', id, 'owner', owner, 'owner_id', owner_id,
                'size', size, 'mimetype', mimetype, 'created_at', created_at, 'updated_at', updated_at)
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
