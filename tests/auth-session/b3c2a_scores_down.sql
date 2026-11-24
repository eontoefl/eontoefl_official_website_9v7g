-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-2a 합성 성적 행 지우기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 다시 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 지우는 것: b3c2a_scores_up.sql 이 넣은 3행만 — **표식(zzb3c2a)이나 날짜로 찾지 않는다.**
--   같은 접속에서 넘겨받은 정확한 값(b3c2a_scores_up.sql 의 마지막 결과 down_input)과 **번호·주인·지문이 전부 같은** 행만 지운다.
--     set b3c2a.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3c2a.created = '<scores-up.json 의 down_input 글자 그대로>';
--   그 값의 모양: {"rows":[{"tag":…,"id":…,"user_id":…,"print":…} ×3], "members":{"a":…,"b":…,"gm":…}}
--
-- 지우기 전에 확인하는 것(하나라도 다르면 **아무것도 지우기 전에** 멈춘다)
--   0. 대상 확인 값
--   1. 넘겨받은 값의 모양: 행이 정확히 3, 표식이 A1·A2·B1, 번호·주인이 uuid 모양, 번호가 서로 다름,
--      주인이 넘겨받은 회원 a(A1·A2)·b(B1)의 회원번호
--   2. 넘겨받은 3행이 **지금 그 번호·그 주인·그 지문 그대로 전부 있다**(누가 고쳤으면 지문이 다르다 — 지우지 않고 멈춘다)
--   3. 넘겨받은 목록 밖에 합성 표식(zzb3c2a)이 붙은 성적 행이 없다, 성적 0건 회원(gm)의 성적 행이 0건이다
-- 지운 뒤: 지워진 수가 정확히 3 이 아니면 전체가 되돌아간다.
--
-- 마지막 결과(한 행): 넘겨받은 값과 번호가 같은 남은 행의 수(0 이어야 한다), 세 회원의 남은 성적 행(0),
--                    합성 표식이 붙은 남은 행(0), 표에 남은 행의 수와 md5 집계(넣을 때의 outside 와 같아야 한다)
-- =====================================================================

begin;

do $zz_b3c2a$
declare
  v_uuid  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_raw   text := coalesce(pg_catalog.current_setting('b3c2a.created', true), '');
  v_j     pg_catalog.jsonb;
  v_n     bigint;
  v_del   bigint;
begin
  -- 0. 대상 확인
  if coalesce(pg_catalog.current_setting('b3c2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3c2a 지우기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b3c2a.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 먼저 실행할 것';
  end if;

  -- 1. 넘겨받은 값의 모양
  begin
    v_j := v_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3c2a 지우기 중단: b3c2a.created 가 JSON 이 아니다. 아무것도 지우지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j -> 'rows') is distinct from 'array' or pg_catalog.jsonb_array_length(v_j -> 'rows') <> 3
     or pg_catalog.jsonb_typeof(v_j -> 'members') is distinct from 'object' then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 값의 모양이 다르다(행 3 · members). 아무것도 지우지 않았다';
  end if;
  if coalesce(v_j -> 'members' ->> 'a', '') !~ v_uuid or coalesce(v_j -> 'members' ->> 'b', '') !~ v_uuid or coalesce(v_j -> 'members' ->> 'gm', '') !~ v_uuid then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 회원번호가 uuid 모양이 아니다. 아무것도 지우지 않았다';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.jsonb_array_elements(v_j -> 'rows') as e(x)
   where coalesce(e.x ->> 'id', '') ~ v_uuid
     and coalesce(e.x ->> 'print', '') ~ '^[0-9a-f]{32}$'
     and (((e.x ->> 'tag') in ('A1', 'A2') and (e.x ->> 'user_id') = (v_j -> 'members' ->> 'a'))
       or ((e.x ->> 'tag') = 'B1' and (e.x ->> 'user_id') = (v_j -> 'members' ->> 'b')));
  if v_n <> 3 then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 행 가운데 모양이 맞는 것이 %건이다(3 이어야 한다 — 번호·지문의 모양, 표식과 주인). 아무것도 지우지 않았다', v_n;
  end if;
  select pg_catalog.count(distinct e.x ->> 'id') into v_n from pg_catalog.jsonb_array_elements(v_j -> 'rows') as e(x);
  if v_n <> 3 then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 행의 번호가 서로 겹친다. 아무것도 지우지 않았다';
  end if;
  select pg_catalog.count(distinct e.x ->> 'tag') into v_n from pg_catalog.jsonb_array_elements(v_j -> 'rows') as e(x);
  if v_n <> 3 then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 행의 표식이 A1·A2·B1 하나씩이 아니다. 아무것도 지우지 않았다';
  end if;

  -- 2. 지금 그 번호·그 주인·그 지문 그대로 전부 있는가
  select pg_catalog.count(*) into v_n
    from public.toefl_actual_scores s
    join pg_catalog.jsonb_array_elements(v_j -> 'rows') as e(x)
      on s.id = (e.x ->> 'id')::pg_catalog.uuid
     and s.user_id = (e.x ->> 'user_id')::pg_catalog.uuid
     and pg_catalog.md5(pg_catalog.concat_ws('|', s.id::text, s.user_id::text, s.test_date::text, s.reading::text, s.listening::text, s.speaking::text,
                        s.writing::text, s.overall::text, coalesce(s.legacy_total::text, ''), coalesce(s.user_email, ''), coalesce(s.user_name, ''), coalesce(s.memo, ''))) = (e.x ->> 'print');
  if v_n <> 3 then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 3행 가운데 지금 번호·주인·지문이 전부 같은 것이 %건뿐이다(이미 지워졌거나 누가 고쳤다). 아무것도 지우지 않았다', v_n;
  end if;

  -- 3. 목록 밖의 합성 행·성적 0건 회원
  select pg_catalog.count(*) into v_n
    from public.toefl_actual_scores s
   where (s.memo like 'zzb3c2a%' or s.user_name like 'zzb3c2a%')
     and not exists (select 1 from pg_catalog.jsonb_array_elements(v_j -> 'rows') as e(x) where (e.x ->> 'id')::pg_catalog.uuid = s.id);
  if v_n <> 0 then
    raise exception 'zzb3c2a 지우기 중단: 넘겨받은 목록 밖에 합성 표식이 붙은 성적 행이 %건 있다. 아무것도 지우지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n from public.toefl_actual_scores s where s.user_id = (v_j -> 'members' ->> 'gm')::pg_catalog.uuid;
  if v_n <> 0 then
    raise exception 'zzb3c2a 지우기 중단: 성적 0건 회원(gm)의 성적 행이 %건 있다(시험 도중 생긴 것이다 — 무엇인지 먼저 볼 것). 아무것도 지우지 않았다', v_n;
  end if;

  -- 지우기: 번호와 주인이 둘 다 같은 행만. 지워진 수가 정확히 3 이 아니면 전체가 되돌아간다
  delete from public.toefl_actual_scores s
   using pg_catalog.jsonb_array_elements(v_j -> 'rows') as e(x)
   where s.id = (e.x ->> 'id')::pg_catalog.uuid and s.user_id = (e.x ->> 'user_id')::pg_catalog.uuid;
  get diagnostics v_del = row_count;
  if v_del <> 3 then
    raise exception 'zzb3c2a 지우기 실패: 지워진 수가 정확하지 않다(%/3). 전부 되돌린다', v_del;
  end if;
  raise notice 'zzb3c2a 지우기: 성적 행 3건을 지웠다';
end;
$zz_b3c2a$;

commit;

reset b3c2a.test_project_ref;

-- 남은 것(앞의 넷은 0 이어야 한다. outside 는 넣을 때의 outside 와 같아야 한다)
select
  (select pg_catalog.count(*) from public.toefl_actual_scores s
     join pg_catalog.jsonb_array_elements(pg_catalog.current_setting('b3c2a.created')::pg_catalog.jsonb -> 'rows') as e(x)
       on s.id = (e.x ->> 'id')::pg_catalog.uuid) as rows_left,
  (select pg_catalog.count(*) from public.toefl_actual_scores s
    where s.user_id in ((pg_catalog.current_setting('b3c2a.created')::pg_catalog.jsonb -> 'members' ->> 'a')::pg_catalog.uuid,
                        (pg_catalog.current_setting('b3c2a.created')::pg_catalog.jsonb -> 'members' ->> 'b')::pg_catalog.uuid,
                        (pg_catalog.current_setting('b3c2a.created')::pg_catalog.jsonb -> 'members' ->> 'gm')::pg_catalog.uuid)) as member_rows_left,
  (select pg_catalog.count(*) from public.toefl_actual_scores s where s.memo like 'zzb3c2a%' or s.user_name like 'zzb3c2a%') as marked_rows_left,
  (select pg_catalog.jsonb_build_object(
            'count', pg_catalog.count(*),
            'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(s)::text), ',' order by s.id), '')))
     from public.toefl_actual_scores s) as outside;
