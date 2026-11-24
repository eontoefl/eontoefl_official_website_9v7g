-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 시험: 보관 답변의 모양 바꾸기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 다시 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 왜: public.my_book_answers() 가 "보관 없음"(SQL NULL) · 파손 · 옛 형식을 섞지 않는지 보려면 그런 값이 저장돼 있어야 한다.
--     함수(my_book_answers_hold)로는 그런 값을 넣을 수 없다(넣을 수 있으면 그것이 결함이다). 그래서 SQL 로 직접 넣는다.
--
-- 받는 값(같은 요청의 맨 앞. node settings_matrix.mjs --phase set-lines --for answers-variant --expect expect.json --round <1~4> 가 만들어 준다)
--     set b3c.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3c.created = '<expect.json 의 down_input 글자 그대로>';
--     set b3c.variant_round = '1';      -- 1 · 2 · 3 · 4
--
-- 고치는 것: 합성 회원 a · b · gm 세 행(회원번호와 전체 이메일이 둘 다 넘겨받은 값과 같은 행)의 pending_book_request **한 열만**.
--   차수(round)마다 세 회원에게 넣는 모양(도구의 variants 단계가 같은 표로 기대값을 정한다 — 한쪽을 고치면 다른 쪽도 고친다):
--     차수   a                     b                      gm
--     1      json_null             array                  string            → 셋 다 answers_corrupt
--     2      number                missing_key            wrong_type        → 셋 다 answers_corrupt
--     3      required_null         answered_at_number     sql_null          → corrupt · corrupt · ok(answers null)
--     4      extra_keys            no_answered_at         nullable_all_null → 셋 다 ok(열두 항목 + answered_at 만)
--   모양의 뜻
--     json_null            열의 값이 JSON null(SQL NULL 이 아니다)     array   '[]'     string  글자 하나     number  숫자 하나
--     missing_key          열두 항목 가운데 user_agent 가 없다
--     wrong_type           target_score 가 글자다
--     required_null        stuck_area 가 null 이다(널을 허용하지 않는 항목)
--     answered_at_number   answered_at 이 숫자다
--     sql_null             SQL NULL — 보관 없음
--     extra_keys           열두 항목 + answered_at + 그 밖의 키 둘(옛 형식) — 그 밖의 키는 응답에 없어야 한다
--     no_answered_at       열두 항목만(answered_at 없음) — 응답의 answered_at 은 null
--     nullable_all_null    널을 허용하는 항목 다섯이 전부 null
--   고쳐진 행이 정확히 3 이 아니면 예외로 끝나 전체가 되돌아간다. 끝나면 fixtures_reset.sql 로 처음 값으로 되돌린다.
--
-- 마지막 결과(한 칸 jsonb): 차수와, 세 회원에게 넣은 모양의 이름
-- =====================================================================

begin;

do $zz_b3c$
declare
  v_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_raw    text := coalesce(pg_catalog.current_setting('b3c.created', true), '');
  v_round  text := coalesce(pg_catalog.current_setting('b3c.variant_round', true), '');
  v_j      pg_catalog.jsonb;
  v_base   pg_catalog.jsonb;
  v_n      bigint;
begin
  if coalesce(pg_catalog.current_setting('b3c.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3c 답변 모양 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b3c.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;
  if v_round not in ('1', '2', '3', '4') then
    raise exception 'zzb3c 답변 모양 중단: b3c.variant_round 가 1 · 2 · 3 · 4 가운데 하나가 아니다. 아무것도 바꾸지 않았다';
  end if;
  if v_raw = '' then
    raise exception 'zzb3c 답변 모양 중단: 대상의 정확한 값을 받지 못했다(set b3c.created). 아무것도 바꾸지 않았다';
  end if;
  begin
    v_j := v_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3c 답변 모양 중단: b3c.created 의 값이 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j -> 'users') is distinct from 'array' then
    raise exception 'zzb3c 답변 모양 중단: b3c.created 에 users 가 없다. 아무것도 바꾸지 않았다';
  end if;
  -- 세 회원(a · b · gm)의 행이 넘겨받은 회원번호 · 이메일 그대로 있는가
  select pg_catalog.count(*) into v_n
    from public.users u
    join pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
      on u.id = (case when coalesce(e.x ->> 'id', '') ~ v_uuid then (e.x ->> 'id')::pg_catalog.uuid end)
     and u.email = e.x ->> 'email'
   where e.x ->> 'email' in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid');
  if v_n <> 3 then
    raise exception 'zzb3c 답변 모양 중단: 합성 회원 a · b · gm 의 행이 넘겨받은 값 그대로 있지 않다(%/3). 아무것도 바꾸지 않았다', v_n;
  end if;

  -- 바탕: 정상인 열두 항목 + answered_at (표식은 zzb3c-variant)
  v_base := pg_catalog.jsonb_build_object(
    'current_score', 60.5,
    'target_score', 95,
    'no_target_score', false,
    'stuck_area', '라이팅',
    'goal_timeframe', '6개월 안에',
    'referral_source', '인스타그램',
    'referral_source_detail', null::pg_catalog.jsonb,
    'is_au_nz_direct_submit', 'no',
    'referrer_url', 'https://ref.zzb3c.invalid/variant',
    'landing_url', 'https://land.zzb3c.invalid/variant',
    'utm_data', pg_catalog.jsonb_build_object('utm_medium', 'zzb3c-utm-variant'),
    'user_agent', 'zzb3c-agent-variant',
    'answered_at', '2026-02-03T04:05:06.789Z');

  update public.users u
     set pending_book_request = case t.variant
           when 'json_null'          then 'null'::pg_catalog.jsonb
           when 'array'              then '[]'::pg_catalog.jsonb
           when 'string'             then '"zzb3c-variant-not-an-object"'::pg_catalog.jsonb
           when 'number'             then '5'::pg_catalog.jsonb
           when 'missing_key'        then v_base - 'user_agent'
           when 'wrong_type'         then v_base || pg_catalog.jsonb_build_object('target_score', '95')
           when 'required_null'      then v_base || pg_catalog.jsonb_build_object('stuck_area', null::pg_catalog.jsonb)
           when 'answered_at_number' then v_base || pg_catalog.jsonb_build_object('answered_at', 12345)
           when 'extra_keys'         then v_base || pg_catalog.jsonb_build_object('zz_legacy_note', 'zzb3c-variant-extra', 'privacy_agreement', true)
           when 'no_answered_at'     then v_base - 'answered_at'
           when 'nullable_all_null'  then v_base || pg_catalog.jsonb_build_object(
                                            'current_score', null::pg_catalog.jsonb, 'referral_source_detail', null::pg_catalog.jsonb,
                                            'referrer_url', null::pg_catalog.jsonb, 'landing_url', null::pg_catalog.jsonb,
                                            'utm_data', null::pg_catalog.jsonb, 'user_agent', null::pg_catalog.jsonb)
           -- 'sql_null' 과 그 밖: SQL NULL
         end
    from (
      values
        ('1'::pg_catalog.text, 'a'::pg_catalog.text, 'json_null'::pg_catalog.text),
        ('1', 'b',  'array'),
        ('1', 'gm', 'string'),
        ('2', 'a',  'number'),
        ('2', 'b',  'missing_key'),
        ('2', 'gm', 'wrong_type'),
        ('3', 'a',  'required_null'),
        ('3', 'b',  'answered_at_number'),
        ('3', 'gm', 'sql_null'),
        ('4', 'a',  'extra_keys'),
        ('4', 'b',  'no_answered_at'),
        ('4', 'gm', 'nullable_all_null')
    ) as t(round, label, variant)
    join pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
      on e.x ->> 'email' = 'zzb3c_' || t.label || '@member.zzb3c.invalid'
   where t.round = v_round
     and u.id = (e.x ->> 'id')::pg_catalog.uuid
     and u.email = e.x ->> 'email';
  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception 'zzb3c 답변 모양 실패: 고쳐진 행이 %개다(3이어야 한다). 전부 되돌린다', v_n;
  end if;
end;
$zz_b3c$;

commit;

reset b3c.test_project_ref;

select pg_catalog.jsonb_build_object(
  'done', 'answers variants applied',
  'read_at', pg_catalog.clock_timestamp(),
  'round', pg_catalog.current_setting('b3c.variant_round'),
  'variants', case pg_catalog.current_setting('b3c.variant_round')
                when '1' then pg_catalog.jsonb_build_object('a', 'json_null', 'b', 'array', 'gm', 'string')
                when '2' then pg_catalog.jsonb_build_object('a', 'number', 'b', 'missing_key', 'gm', 'wrong_type')
                when '3' then pg_catalog.jsonb_build_object('a', 'required_null', 'b', 'answered_at_number', 'gm', 'sql_null')
                when '4' then pg_catalog.jsonb_build_object('a', 'extra_keys', 'b', 'no_answered_at', 'gm', 'nullable_all_null')
              end,
  'stored_typeof', (
    select pg_catalog.jsonb_object_agg(
             pg_catalog.replace(pg_catalog.split_part(u.email, '@', 1), 'zzb3c_', ''),
             case when u.pending_book_request is null then 'SQL NULL' else pg_catalog.jsonb_typeof(u.pending_book_request) end)
      from public.users u
      join pg_catalog.jsonb_array_elements(pg_catalog.current_setting('b3c.created')::pg_catalog.jsonb -> 'users') as e(x)
        on u.id = (e.x ->> 'id')::pg_catalog.uuid and u.email = e.x ->> 'email'
     where u.email in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid')
  )
) as result;
