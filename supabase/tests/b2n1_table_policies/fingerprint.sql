-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-1 지문 질의 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 쓰는 곳과 견주는 법은 절차.md 를 따른다.
-- 아무것도 바꾸지 않는다. 시험 프로젝트에서 아래 시점마다 실행해 결과를 그대로 저장한다:
--   F0 적용 전 / F1 적용 뒤 / F2 REST 대조표 실행 뒤 / F3 전환 예행 뒤 / F4 되돌리기 뒤 / F5 다시 적용 뒤
--
-- 결과의 키
--   policies_14      대상 표 14개의 규칙 전부: 개수 n, 지문 fp, 목록 list(표·이름·동작·permissive·역할·USING·WITH CHECK)
--   policies_14_old  그중 이름이 b2n1_ 로 시작하지 않는 것(기존 규칙): n, fp — 어느 시점에서든 같아야 한다(n = 50)
--   policies_b2n1    b2n1_ 규칙: n, 목록(표.이름) — 적용 전·되돌리기 뒤 0, 적용 뒤 27
--   grants_14        대상 표 14개의 권한·RLS 설정·소유자: fp, list — 어느 시점에서든 같아야 한다
--   cells            표 15개(대상 14 + reviews) × 동작 4 = 60칸의 "비로그인에 열림 / 로그인 역할에 열림"
--                    (규칙의 역할과 동작만 본 것이다. 조건식의 참·거짓은 보지 않는다)
--   anon_only_cells  비로그인에는 열려 있고 로그인 역할에는 규칙이 없는 칸
--                    — 적용 전 34칸, 적용 뒤 7칸(일부러 주지 않은 5칸 + reviews 2칸)이어야 한다
--   rows             합성 행의 지금 저장값(표식이 있는 행만): 표마다 {id: 값}
-- =====================================================================
with t14(tbl) as (
  values
    ('tr_listening_announcement'), ('tr_listening_conversation'), ('tr_listening_lecture'),
    ('tr_listening_response'), ('tr_reading_academic'), ('tr_speaking_interview'),
    ('tr_speaking_repeat'), ('tr_writing_arrange'), ('tr_writing_discussion'),
    ('tr_writing_email'), ('tr_writing_ko_data'),
    ('aus_intspk'), ('toefl_actual_scores'), ('note3_store')
),
t15(tbl) as (
  select tbl from t14
  union all
  select 'reviews'
),
pol as (
  select p.tablename::text  as tbl,
         p.policyname::text as name,
         p.cmd::text        as cmd,
         p.permissive::text as permissive,
         p.roles::text      as roles,
         p.roles            as roles_arr,
         p.qual,
         p.with_check
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename::text in (select tbl from t15)
),
pol14 as (
  select * from pol where tbl in (select tbl from t14)
),
cmds(cmd) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
),
cells as (
  select t.tbl,
         c.cmd,
         exists (
           select 1 from pol p
            where p.tbl = t.tbl
              and p.cmd in (c.cmd, 'ALL')
              and p.roles_arr && array['anon', 'public']::name[]
         ) as anon_open,
         exists (
           select 1 from pol p
            where p.tbl = t.tbl
              and p.cmd in (c.cmd, 'ALL')
              and p.roles_arr && array['authenticated', 'public']::name[]
         ) as auth_open
    from t15 t
   cross join cmds c
),
grants as (
  select c.relname::text as tbl,
         coalesce(c.relacl::text, '') as acl,
         c.relrowsecurity as rls,
         c.relforcerowsecurity as rls_force,
         pg_catalog.pg_get_userbyid(c.relowner)::text as owner
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname::text in (select tbl from t14)
)
select jsonb_build_object(
  'read_at', now(),
  'policies_14', jsonb_build_object(
    'n',  (select count(*) from pol14),
    'fp', (select md5(coalesce(string_agg(
             tbl || '|' || name || '|' || permissive || '|' || roles || '|' || cmd || '|'
             || coalesce(qual, '') || '|' || coalesce(with_check, ''),
             E'\n' order by tbl, name), '')) from pol14),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'tbl', tbl, 'name', name, 'cmd', cmd, 'permissive', permissive, 'roles', roles,
               'using', qual, 'check', with_check) order by tbl, name), '[]'::jsonb) from pol14)
  ),
  'policies_14_old', jsonb_build_object(
    'n',  (select count(*) from pol14 where name not like 'b2n1\_%'),
    'fp', (select md5(coalesce(string_agg(
             tbl || '|' || name || '|' || permissive || '|' || roles || '|' || cmd || '|'
             || coalesce(qual, '') || '|' || coalesce(with_check, ''),
             E'\n' order by tbl, name), '')) from pol14 where name not like 'b2n1\_%')
  ),
  'policies_b2n1', jsonb_build_object(
    'n',    (select count(*) from pg_catalog.pg_policies p where p.policyname like 'b2n1\_%'),
    'list', (select coalesce(jsonb_agg((p.schemaname::text || '.' || p.tablename::text || '.' || p.policyname::text)
               order by p.schemaname::text, p.tablename::text, p.policyname::text), '[]'::jsonb)
               from pg_catalog.pg_policies p where p.policyname like 'b2n1\_%')
  ),
  'grants_14', jsonb_build_object(
    'fp',   (select md5(coalesce(string_agg(
               tbl || '|' || acl || '|' || rls::text || '|' || rls_force::text || '|' || owner,
               E'\n' order by tbl), '')) from grants),
    'list', (select coalesce(jsonb_agg(jsonb_build_object(
               'tbl', tbl, 'acl', acl, 'rls', rls, 'rls_force', rls_force, 'owner', owner) order by tbl), '[]'::jsonb) from grants)
  ),
  'cells', (select jsonb_agg(jsonb_build_object(
              'tbl', tbl, 'cmd', cmd, 'anon_open', anon_open, 'auth_open', auth_open) order by tbl, cmd) from cells),
  'anon_only_cells', jsonb_build_object(
    'n',    (select count(*) from cells where anon_open and not auth_open),
    'list', (select coalesce(jsonb_agg((tbl || ' ' || cmd) order by tbl, cmd), '[]'::jsonb)
               from cells where anon_open and not auth_open)
  ),
  'rows', jsonb_build_object(
    'tr_listening_announcement', (select coalesce(jsonb_object_agg(id, script),       '{}'::jsonb) from public.tr_listening_announcement where id like 'zz-b2n1-%'),
    'tr_listening_conversation', (select coalesce(jsonb_object_agg(id, script),       '{}'::jsonb) from public.tr_listening_conversation where id like 'zz-b2n1-%'),
    'tr_listening_lecture',      (select coalesce(jsonb_object_agg(id, script),       '{}'::jsonb) from public.tr_listening_lecture      where id like 'zz-b2n1-%'),
    'tr_listening_response',     (select coalesce(jsonb_object_agg(id, script),       '{}'::jsonb) from public.tr_listening_response     where id like 'zz-b2n1-%'),
    'tr_reading_academic',       (select coalesce(jsonb_object_agg(id, main_title),   '{}'::jsonb) from public.tr_reading_academic       where id like 'zz-b2n1-%'),
    'tr_speaking_interview',     (select coalesce(jsonb_object_agg(id, context_text), '{}'::jsonb) from public.tr_speaking_interview     where id like 'zz-b2n1-%'),
    'tr_speaking_repeat',        (select coalesce(jsonb_object_agg(id, context_text), '{}'::jsonb) from public.tr_speaking_repeat        where id like 'zz-b2n1-%'),
    'tr_writing_arrange',        (select coalesce(jsonb_object_agg(id, explanation),  '{}'::jsonb) from public.tr_writing_arrange        where id like 'zz-b2n1-%'),
    'tr_writing_discussion',     (select coalesce(jsonb_object_agg(id, topic),        '{}'::jsonb) from public.tr_writing_discussion     where id like 'zz-b2n1-%'),
    'tr_writing_email',          (select coalesce(jsonb_object_agg(id, subject),      '{}'::jsonb) from public.tr_writing_email          where id like 'zz-b2n1-%'),
    'tr_writing_ko_data',        (select coalesce(jsonb_object_agg(id, ko_text),      '{}'::jsonb) from public.tr_writing_ko_data        where id like 'zz-b2n1-%'),
    'note3_store',               (select coalesce(jsonb_object_agg(id, data),         '{}'::jsonb) from public.note3_store               where id like 'zz-b2n1-%'),
    'aus_intspk',                (select coalesce(jsonb_object_agg(id::text, passage), '{}'::jsonb) from public.aus_intspk
                                   where id in (990000001, 990000002, 990000009) or title like 'zz-b2n1-%'),
    'toefl_actual_scores',       (select coalesce(jsonb_object_agg(id::text, jsonb_build_object('memo', memo, 'user_id', user_id)), '{}'::jsonb)
                                    from public.toefl_actual_scores
                                   where id::text like 'b2b2b2b2-0000-4000-8000-%' or user_name like 'zz-b2n1-%')
  )
) as result;
