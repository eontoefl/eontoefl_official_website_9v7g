-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-2a 성적 표의 상태 읽기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용 — **읽기만 한다**)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 쓰는 문장이 없다(select 하나).
--
-- 언제: 합성 행을 넣기 전(처음 지문), 넣은 뒤, 실행기가 끝난 뒤, 지운 뒤(끝 지문).
-- 받는 값(넣기 전에는 주지 않아도 된다 — 그러면 합성 행 없이 표 전체의 지문만 낸다):
--     set b3c2a.created = '<scores-up.json 의 down_input 글자 그대로>';
--
-- 결과(한 칸 jsonb)
--   synthetic    넘겨받은 3행마다: 지금 있는가(present), 번호·주인·지문이 넣을 때 그대로인가(same)
--                — 실행기는 성적 표에 쓰지 않는다. 끝난 뒤에도 전부 present·same 이어야 한다
--   marked_rows  합성 표식(zzb3c2a)이 붙은 행의 수(넣기 전 0 · 넣은 뒤 3 · 지운 뒤 0)
--   outside      넘겨받은 3행이 아닌 행의 수와 md5 집계(처음부터 끝까지 같아야 한다)
-- =====================================================================

with given as (
  select coalesce(nullif(pg_catalog.current_setting('b3c2a.created', true), ''), '{"rows":[]}')::pg_catalog.jsonb as j
), listed as (
  select (e.x ->> 'tag') as tag, (e.x ->> 'id')::pg_catalog.uuid as id, (e.x ->> 'user_id')::pg_catalog.uuid as user_id, (e.x ->> 'print') as print
    from given g, pg_catalog.jsonb_array_elements(g.j -> 'rows') as e(x)
)
select pg_catalog.jsonb_build_object(
  'marker', 'zzb3c2a',
  'read_at', pg_catalog.now(),
  'synthetic', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'tag', l.tag,
             'present', s.id is not null,
             'same', s.id is not null and s.user_id = l.user_id
                     and pg_catalog.md5(pg_catalog.concat_ws('|', s.id::text, s.user_id::text, s.test_date::text, s.reading::text, s.listening::text, s.speaking::text,
                         s.writing::text, s.overall::text, coalesce(s.legacy_total::text, ''), coalesce(s.user_email, ''), coalesce(s.user_name, ''), coalesce(s.memo, ''))) = l.print
           ) order by l.tag), '[]'::pg_catalog.jsonb)
      from listed l
      left join public.toefl_actual_scores s on s.id = l.id
  ),
  'marked_rows', (select pg_catalog.count(*) from public.toefl_actual_scores s where s.memo like 'zzb3c2a%' or s.user_name like 'zzb3c2a%'),
  'outside', (
    select pg_catalog.jsonb_build_object(
             'count', pg_catalog.count(*),
             'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(s)::text), ',' order by s.id), '')))
      from public.toefl_actual_scores s
     where not exists (select 1 from listed l where l.id = s.id)
  )
) as result;
