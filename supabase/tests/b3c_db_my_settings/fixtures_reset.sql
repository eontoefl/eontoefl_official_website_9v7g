-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 합성 회원의 설정 열 넷을 처음 값으로 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 다시 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다).
--
-- 왜: 이 계약의 함수 셋은 회원 행을 고친다. 대조표를 한 번 재면 합성 회원의 설정 열이 바뀐다
--     (동의 시각이 새로 쓰이고, 보관 답변이 덮어써지고, gm 의 "지원하지 않는 종류"가 사라진다).
--     다음 재기를 같은 시작 상태에서 하려고, **이 시험의 합성 회원 일곱 행의 설정 열 넷만** fixtures_up.sql 의 처음 값으로 되돌린다.
--
-- 받는 값(같은 요청의 맨 앞. node settings_matrix.mjs --phase set-lines --for fixtures-reset --expect expect.json 이 만들어 준다)
--     set b3c.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3c.created = '<expect.json 의 down_input 글자 그대로>';
--
-- 고치는 것: public.users 의 **회원번호와 전체 이메일이 둘 다 넘겨받은 값과 같은 일곱 행**의
--     intro_book_track · marketing_consent · marketing_consent_at · pending_book_request — 이 네 열만.
--   이름의 앞부분(접두어)으로 찾지 않는다. 다른 열 · 다른 행 · 다른 표는 건드리지 않는다.
--   고쳐진 행이 정확히 7 이 아니면 예외로 끝나 전체가 되돌아간다.
--
-- 마지막 결과(한 칸 jsonb): 되돌린 뒤의 일곱 행의 설정 값(이름별)
-- =====================================================================

begin;

do $zz_b3c$
declare
  v_emails constant text[] := array['zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                                    'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                                    'zzb3c_trap@member.zzb3c.invalid'];
  v_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_raw    text := coalesce(pg_catalog.current_setting('b3c.created', true), '');
  v_j      pg_catalog.jsonb;
  v_n      bigint;
begin
  if coalesce(pg_catalog.current_setting('b3c.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3c 설정 되돌리기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b3c.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;
  if v_raw = '' then
    raise exception 'zzb3c 설정 되돌리기 중단: 대상의 정확한 값을 받지 못했다. 같은 요청에서 set b3c.created = ''<fixtures_up.sql 결과의 down_input>''; 을 둘 것. 아무것도 바꾸지 않았다';
  end if;
  begin
    v_j := v_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3c 설정 되돌리기 중단: b3c.created 의 값이 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j -> 'users') is distinct from 'array' or pg_catalog.jsonb_array_length(v_j -> 'users') <> 7 then
    raise exception 'zzb3c 설정 되돌리기 중단: b3c.created 의 users 가 7행이 아니다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
   where coalesce(e.x ->> 'id', '') !~ v_uuid or not (coalesce(e.x ->> 'email', '') = any (v_emails));
  if v_n <> 0 then
    raise exception 'zzb3c 설정 되돌리기 중단: b3c.created 의 users 에 회원번호 모양이 아니거나 이 시험의 이메일이 아닌 것이 %개 있다. 아무것도 바꾸지 않았다', v_n;
  end if;
  select pg_catalog.count(distinct e.x ->> 'email') into v_n from pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x);
  if v_n <> 7 then
    raise exception 'zzb3c 설정 되돌리기 중단: b3c.created 의 users 의 이메일이 서로 다른 일곱 개가 아니다. 아무것도 바꾸지 않았다';
  end if;
  -- 넘겨받은 일곱 행이 지금 그 회원번호 · 그 이메일 그대로 전부 있는가
  select pg_catalog.count(*) into v_n
    from public.users u
    join pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
      on u.id = (e.x ->> 'id')::pg_catalog.uuid and u.email = e.x ->> 'email';
  if v_n <> 7 then
    raise exception 'zzb3c 설정 되돌리기 중단: 넘겨받은 일곱 행이 지금 그대로 있지 않다(%/7). 아무것도 바꾸지 않았다', v_n;
  end if;

  -- 설정 열 넷만. 값은 fixtures_up.sql 과 같다(한쪽을 고치면 다른 쪽도 고친다)
  update public.users u
     set intro_book_track = t.track,
         marketing_consent = t.consent,
         marketing_consent_at = case when t.consent is true then '2026-01-02 03:04:05.678+00'::pg_catalog.timestamptz end,
         pending_book_request = case t.answers
           when 'now' then pg_catalog.jsonb_build_object(
             'current_score', 75,
             'target_score', 100.5,
             'no_target_score', false,
             'stuck_area', '리딩',
             'goal_timeframe', '3개월 안에',
             'referral_source', '기타',
             'referral_source_detail', 'zzb3c-detail-' || t.label,
             'is_au_nz_direct_submit', 'no',
             'referrer_url', 'https://ref.zzb3c.invalid/from-' || t.label,
             'landing_url', 'https://land.zzb3c.invalid/book-request.html?utm_source=zzb3c-utm-' || t.label,
             'utm_data', pg_catalog.jsonb_build_object('utm_source', 'zzb3c-utm-' || t.label),
             'user_agent', 'zzb3c-agent-' || t.label,
             'answered_at', '2026-01-02T03:04:05.678Z')
           when 'old' then pg_catalog.jsonb_build_object(
             'current_score', null::pg_catalog.jsonb,
             'target_score', 90,
             'no_target_score', false,
             'stuck_area', '스피킹',
             'goal_timeframe', '한 달 안에',
             'referral_source', '블로그',
             'referral_source_detail', null::pg_catalog.jsonb,
             'is_au_nz_direct_submit', 'yes',
             'referrer_url', null::pg_catalog.jsonb,
             'landing_url', 'https://land.zzb3c.invalid/old-' || t.label,
             'utm_data', null::pg_catalog.jsonb,
             'user_agent', 'zzb3c-agent-' || t.label,
             'zz_legacy_note', 'zzb3c-legacy-' || t.label,
             'privacy_agreement', true)
         end
    from (
      values
        ('a'::pg_catalog.text, 'regular'::pg_catalog.text, true,                  'now'::pg_catalog.text),
        ('b',                  'australia',                false,                 'none'),
        ('gm',                 'zzb3c_old_track',          null::pg_catalog.bool, 'old'),
        ('blk',                'australia',                true,                  'now'),
        ('wd',                 'regular',                  true,                  'now'),
        ('bw',                 'australia',                false,                 'now'),
        ('trap',               'australia',                true,                  'now')
    ) as t(label, track, consent, answers)
    join pg_catalog.jsonb_array_elements(v_j -> 'users') as e(x)
      on e.x ->> 'email' = 'zzb3c_' || t.label || '@member.zzb3c.invalid'
   where u.id = (e.x ->> 'id')::pg_catalog.uuid
     and u.email = e.x ->> 'email';
  get diagnostics v_n = row_count;
  if v_n <> 7 then
    raise exception 'zzb3c 설정 되돌리기 실패: 고쳐진 행이 %개다(7이어야 한다). 전부 되돌린다', v_n;
  end if;
end;
$zz_b3c$;

commit;

reset b3c.test_project_ref;

-- 되돌린 뒤의 값(이름별)
select pg_catalog.jsonb_build_object(
  'done', 'settings columns reset to fixture values (7 rows, 4 columns)',
  'read_at', pg_catalog.clock_timestamp(),
  'settings', (
    select pg_catalog.jsonb_object_agg(
             pg_catalog.replace(pg_catalog.split_part(u.email, '@', 1), 'zzb3c_', ''),
             pg_catalog.jsonb_build_object(
               'intro_book_track', u.intro_book_track, 'marketing_consent', u.marketing_consent,
               'marketing_consent_at', u.marketing_consent_at, 'pending_book_request', u.pending_book_request))
      from public.users u
      join pg_catalog.jsonb_array_elements(pg_catalog.current_setting('b3c.created')::pg_catalog.jsonb -> 'users') as e(x)
        on u.id = (e.x ->> 'id')::pg_catalog.uuid and u.email = e.x ->> 'email'
  )
) as result;
