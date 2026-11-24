-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 합성 회원 자료 올리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
-- (3-0 의 fixtures_up.sql 2차 판을 본떴다. 다른 것: 표식 zzb3c, 설정 열 넷의 합성 값)
--
-- ★★★ 운영 경고 ★★★
--   운영(qpqjevecjejvbeuogtbx)에서 실행하지 않는다(회원 표에 합성 회원 행이 생긴다).
--   실행 직전에 절차.md 의 대상 확인을 한다: SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 여야 한다.
--   아래의 대상 확인 값(set b3c.test_project_ref)은 그 확인을 대신하지 않는다 — DB 는 자기 ref 를 스스로 알지 못한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서와 기대 결과는 절차.md 를 따른다.
--
-- 받는 값(같은 요청의 맨 앞에서 정한다). 브레인방이 로그인 서버로 만든 합성 로그인 계정 8개의
-- **정확한 계정 번호와, 만들 때 받은 로그인 이메일(auth.users.email)을 함께** 넘긴다(2차).
-- (node settings_matrix.mjs --phase set-lines --for fixtures-up --accounts accounts.json 이 그 17줄을 만들어 준다)
--     set b3c.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3c.acct_a   = '<계정 번호>';     set b3c.acct_a_email   = '<로그인 이메일>';
--     … b · n · g · gm · blk · wd · bw 도 같은 두 줄씩
-- "이번에 만든 합성 계정인가"의 확인(하나라도 다르면 아무것도 쓰기 전에 전체를 멈춘다):
--   * 여덟 계정 번호가 서로 다르고 로그인 계정에 있다
--   * auth.users 에서 그 계정 번호의 이메일이 넘겨받은 이메일과 같다(대소문자만 무시)
--   * 그 이메일에 합성 표식 zzb3c 가 들어 있다(이름 부분이든 도메인이든 — 예: zzb3c_a_<무작위>@…)
--   * 여덟 이메일이 서로 다르다
-- 관리자 명부에 넣는 g · gm 도 이 확인을 지난 계정 번호다.
--
-- 만드는 것
--   public.users 7행(전체 이메일이 zzb3c_<이름>@member.zzb3c.invalid. 회원번호는 새로 만든 값 — 함정 행만 예외)
--     이름   상태                      intro_book_track    marketing_consent(·_at)   pending_book_request
--     a      정상                      regular             true (시각 있음)          지금 형식(열두 항목 + answered_at)
--     b      정상                      australia           false (시각 NULL)         SQL NULL — 보관 없음
--     gm     정상(nickname·phone NULL)  zzb3c_old_track     NULL (시각 NULL)          옛 형식(열두 항목 + 그 밖의 키 둘, answered_at 없음)
--            ↑ 지원하지 않는 종류 값 — my_settings 의 intro_book_track_supported 가 false 여야 한다
--     blk    차단                      australia           true                      지금 형식
--     wd     탈퇴 처리 중              regular             true                      지금 형식
--     bw     차단 + 탈퇴 처리 중       australia           false                     지금 형식
--     trap   함정 행: 회원번호가 계정 n 의 "로그인 계정 번호"와 같다(대응표에는 넣지 않는다).  australia · true · 지금 형식
--            함수가 로그인 계정 번호를 회원번호로 쓰면 n 에게 이 행의 값이 나가거나 이 행이 고쳐진다 — n 의 기대값은 no_member
--     password 열에는 합성 표식 zzb3c-pwcol-<이름>-<무작위 10자>(로그인 비밀번호가 아니다 — 응답에 실리지 않는지 찾는 데 쓴다)
--     보관 답변의 글자 값에는 회원마다 다른 표식(zzb3c-…-<이름>)이 들어 있다 — 남의 답변이 응답에 실리지 않는지 찾는 데 쓴다
--   security_private.member_identity 6행    a · b · gm · blk · wd · bw 의 계정 번호 ↔ 위 회원번호
--   security_private.admin_principal 2행    g · gm 의 계정 번호(넘겨받은 정확한 번호)
-- 덮어쓰지 않는다: 위 일곱 이메일의 회원 행, 넘겨받은 여덟 계정의 대응·명부 행이 하나라도 있으면 멈춘다.
--
-- 마지막 결과(한 칸 jsonb): 만든 것의 정확한 값. expect.json 으로 저장한다.
--   accounts · trap   도구(settings_matrix.mjs --expect)가 쓴다. 계정마다 auth_email(로그인 이메일), 회원마다 member(여섯 값 —
--                     이 함수들의 응답에 나오면 안 되는 값)와 settings(설정 열 넷의 처음 값)
--                     **회원 표 비밀번호 열의 원문은 내보내지 않는다**(합성 값이라도 옛 길의 비밀번호 열 원문이다).
--                     password_column = { prefix(고정 접두사 zzb3c-pwcol-) · has_prefix · sha256(그 값의 sha256 16진 글자) } 만 싣는다.
--                     도구는 응답 글자에서 접두사를 찾고, 응답의 글자 값 하나하나의 sha256 을 이 값과 견준다
--   created           만든 행의 정확한 값: users[{id,email}] 7 · mappings[{auth_user_id,member_id}] 6 · admins[auth_user_id] 2
--                     · accounts[{label,auth_user_id,email}] 8(넘겨받은 로그인 계정 — 내릴 때 같은 대조를 한다)
--   down_input        created 를 한 줄 글자로 쓴 것 — fixtures_down.sql · fixtures_reset.sql · answers_variant.sql 에 그대로 넘긴다
-- 설정 열을 처음 값으로 되돌리기: fixtures_reset.sql (이 파일과 같은 값을 쓴다 — 한쪽을 고치면 다른 쪽도 고친다)
-- 내리기: fixtures_down.sql
-- =====================================================================

begin;

do $zz_b3c$
declare
  v_labels constant text[] := array['a', 'b', 'n', 'g', 'gm', 'blk', 'wd', 'bw'];
  v_label  text;
  v_raw    text;
  v_email  text;
  v_ids    pg_catalog.uuid[] := '{}';
  v_emails text[] := '{}';
  v_n      bigint;
begin
  if coalesce(pg_catalog.current_setting('b3c.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3c 합성 자료 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, 같은 요청의 맨 앞에 set b3c.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 둘 것. 아무것도 바꾸지 않았다';
  end if;

  -- 이 DB 가 운영이 아니라는 DB 안의 증거: 파일 객체가 하나도 없다(시험 프로젝트의 지금 상태. 운영에는 수천 개가 있다)
  select pg_catalog.count(*) into v_n from storage.objects;
  if v_n <> 0 then
    raise exception 'zzb3c 합성 자료 중단: storage.objects 에 객체가 %개 있다 — 시험 프로젝트의 시작 상태가 아니다(운영일 수 있다). 아무것도 바꾸지 않았다', v_n;
  end if;

  if pg_catalog.to_regclass('security_private.member_identity') is null
     or pg_catalog.to_regclass('security_private.admin_principal') is null then
    raise exception 'zzb3c 합성 자료 중단: 2-가(b2a_identity_gate)가 적용돼 있지 않다';
  end if;

  -- 넘겨받은 계정 번호 여덟 개: 모양, 서로 다름, 로그인 계정으로 있음.
  -- 그리고 "이번에 만든 합성 계정인가": 그 계정 번호의 로그인 이메일이 넘겨받은 이메일과 같고 합성 표식 zzb3c 를 가졌다.
  -- (이 블록이 끝날 때까지 아무것도 쓰지 않는다 — 하나라도 다르면 여기서 전체가 멈춘다)
  foreach v_label in array v_labels loop
    v_raw := coalesce(pg_catalog.current_setting('b3c.acct_' || v_label, true), '');
    if v_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_% 에 계정 번호가 없다(같은 요청에서 정확한 계정 번호를 정할 것). 아무것도 바꾸지 않았다', v_label;
    end if;
    if v_raw::pg_catalog.uuid = any (v_ids) then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_% 의 계정 번호가 다른 계정과 같다. 아무것도 바꾸지 않았다', v_label;
    end if;
    select pg_catalog.count(*) into v_n from auth.users au where au.id = v_raw::pg_catalog.uuid;
    if v_n <> 1 then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_% 의 계정 번호가 로그인 계정에 없다. 아무것도 바꾸지 않았다', v_label;
    end if;
    v_email := pg_catalog.lower(coalesce(pg_catalog.current_setting('b3c.acct_' || v_label || '_email', true), ''));
    if v_email = '' or pg_catalog.strpos(v_email, '@') < 2 or pg_catalog.char_length(v_email) > 320 then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_%_email 에 로그인 이메일이 없다(계정을 만들 때 받은 이메일을 함께 넘길 것). 아무것도 바꾸지 않았다', v_label;
    end if;
    if pg_catalog.strpos(v_email, 'zzb3c') = 0 then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_%_email 에 합성 표식 zzb3c 가 없다 — 이 시험이 만든 합성 계정이 아닐 수 있다. 아무것도 바꾸지 않았다', v_label;
    end if;
    if v_email = any (v_emails) then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_%_email 이 다른 계정의 이메일과 같다. 아무것도 바꾸지 않았다', v_label;
    end if;
    select pg_catalog.count(*) into v_n
      from auth.users au
     where au.id = v_raw::pg_catalog.uuid
       and pg_catalog.lower(au.email) = v_email;
    if v_n <> 1 then
      raise exception 'zzb3c 합성 자료 중단: b3c.acct_% 의 계정 번호의 로그인 이메일이 넘겨받은 이메일과 다르다 — 이번에 만든 계정이 아니다. 아무것도 바꾸지 않았다', v_label;
    end if;
    v_ids := pg_catalog.array_append(v_ids, v_raw::pg_catalog.uuid);
    v_emails := pg_catalog.array_append(v_emails, v_email);
  end loop;

  -- 덮어쓰지 않는다
  select pg_catalog.count(*) into v_n
    from public.users u
   where u.email in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                     'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                     'zzb3c_trap@member.zzb3c.invalid');
  if v_n <> 0 then
    raise exception 'zzb3c 합성 자료 중단: 합성 회원의 이메일을 가진 회원 행이 이미 %개 있다. 덮어쓰지 않는다(fixtures_down.sql 을 먼저)', v_n;
  end if;
  select pg_catalog.count(*) into v_n from public.users u where u.id = any (v_ids);
  if v_n <> 0 then
    raise exception 'zzb3c 합성 자료 중단: 넘겨받은 계정 번호와 같은 회원번호의 회원 행이 이미 %개 있다. 덮어쓰지 않는다', v_n;
  end if;
  select pg_catalog.count(*) into v_n from security_private.member_identity mi where mi.auth_user_id = any (v_ids);
  if v_n <> 0 then
    raise exception 'zzb3c 합성 자료 중단: 넘겨받은 계정의 대응 행이 이미 %개 있다. 덮어쓰지 않는다', v_n;
  end if;
  select pg_catalog.count(*) into v_n from security_private.admin_principal ap where ap.auth_user_id = any (v_ids);
  if v_n <> 0 then
    raise exception 'zzb3c 합성 자료 중단: 넘겨받은 계정의 관리자 명부 행이 이미 %개 있다. 덮어쓰지 않는다', v_n;
  end if;
end;
$zz_b3c$;

-- 1. 회원 행 7개(회원번호는 새로 만든 값 — 함정 행만 계정 n 의 번호). 설정 열 넷의 값은 fixtures_reset.sql 과 같다.
insert into public.users
  (id, email, password, name, nickname, phone, timezone, blocked, withdrawal_requested_at, withdrawal_reason, withdrawal_reason_detail,
   intro_book_track, marketing_consent, marketing_consent_at, pending_book_request)
select case when t.label = 'trap' then pg_catalog.current_setting('b3c.acct_n')::pg_catalog.uuid else pg_catalog.gen_random_uuid() end,
       'zzb3c_' || t.label || '@member.zzb3c.invalid',
       'zzb3c-pwcol-' || t.label || '-' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::pg_catalog.text), 1, 10),
       t.member_name,
       t.nickname,
       t.phone,
       t.tz,
       t.is_blocked,
       case when t.is_withdrawing then pg_catalog.now() end,
       case when t.is_withdrawing then 'zzb3c-reason-' || t.label end,
       case when t.is_withdrawing then 'zzb3c-reason-detail-' || t.label end,
       t.track,
       t.consent,
       case when t.consent is true then '2026-01-02 03:04:05.678+00'::pg_catalog.timestamptz end,
       case t.answers
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
      ('a'::pg_catalog.text, 'zzb3c 회원 에이'::pg_catalog.text,        'zzb3c_nick_a'::pg_catalog.text, '01000003101'::pg_catalog.text, 'Asia/Seoul'::pg_catalog.text, false, false, 'regular'::pg_catalog.text, true,                      'now'::pg_catalog.text),
      ('b',                  'zzb3c 회원 비',                           'zzb3c_nick_b',                  '01000003102',                  'Australia/Sydney',            false, false, 'australia',              false,                     'none'),
      ('gm',                 'zzb3c 관리자겸회원 지엠',                  null,                            null,                           'Asia/Seoul',                  false, false, 'zzb3c_old_track',        null::pg_catalog.bool,     'old'),
      ('blk',                'zzb3c 차단회원',                          'zzb3c_nick_blk',                '01000003104',                  'Asia/Seoul',                  true,  false, 'australia',              true,                      'now'),
      ('wd',                 'zzb3c 탈퇴처리중회원',                     'zzb3c_nick_wd',                 '01000003105',                  'Asia/Seoul',                  false, true,  'regular',                true,                      'now'),
      ('bw',                 'zzb3c 차단이고탈퇴처리중',                 'zzb3c_nick_bw',                 '01000003106',                  'Asia/Seoul',                  true,  true,  'australia',              false,                     'now'),
      ('trap',               'zzb3c 함정행 계정번호와같은회원번호',       'zzb3c_nick_trap',               '01000003109',                  'Asia/Seoul',                  false, false, 'australia',              true,                      'now')
  ) as t(label, member_name, nickname, phone, tz, is_blocked, is_withdrawing, track, consent, answers);

-- 2. 로그인 계정 ↔ 회원 대응 6개(넘겨받은 정확한 계정 번호 ↔ 방금 만든 정확한 이메일의 회원). 함정 행은 넣지 않는다.
insert into security_private.member_identity (auth_user_id, member_id)
select t.auth_id, u.id
  from (
    values
      (pg_catalog.current_setting('b3c.acct_a')::pg_catalog.uuid,   'zzb3c_a@member.zzb3c.invalid'::pg_catalog.text),
      (pg_catalog.current_setting('b3c.acct_b')::pg_catalog.uuid,   'zzb3c_b@member.zzb3c.invalid'),
      (pg_catalog.current_setting('b3c.acct_gm')::pg_catalog.uuid,  'zzb3c_gm@member.zzb3c.invalid'),
      (pg_catalog.current_setting('b3c.acct_blk')::pg_catalog.uuid, 'zzb3c_blk@member.zzb3c.invalid'),
      (pg_catalog.current_setting('b3c.acct_wd')::pg_catalog.uuid,  'zzb3c_wd@member.zzb3c.invalid'),
      (pg_catalog.current_setting('b3c.acct_bw')::pg_catalog.uuid,  'zzb3c_bw@member.zzb3c.invalid')
  ) as t(auth_id, member_email)
  join public.users u on u.email = t.member_email;

-- 3. 관리자 명부 2개(넘겨받은 정확한 계정 번호)
insert into security_private.admin_principal (auth_user_id)
values (pg_catalog.current_setting('b3c.acct_g')::pg_catalog.uuid),
       (pg_catalog.current_setting('b3c.acct_gm')::pg_catalog.uuid);

-- 4. 만든 수 확인(다르면 전체가 되돌아간다)
do $zz_b3c$
declare
  v_emails constant text[] := array['zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                                    'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                                    'zzb3c_trap@member.zzb3c.invalid'];
  v_users bigint;
  v_maps  bigint;
  v_admin bigint;
  v_same  bigint;
  v_trap  bigint;
  v_sets  bigint;
begin
  select pg_catalog.count(*) into v_users from public.users u where u.email = any (v_emails);
  select pg_catalog.count(*) into v_maps
    from security_private.member_identity mi
    join public.users u on u.id = mi.member_id
   where u.email = any (v_emails);
  select pg_catalog.count(*) into v_admin
    from security_private.admin_principal ap
   where ap.auth_user_id in (pg_catalog.current_setting('b3c.acct_g')::pg_catalog.uuid, pg_catalog.current_setting('b3c.acct_gm')::pg_catalog.uuid);
  -- 대응표에서 회원번호가 로그인 계정 번호와 같아서는 안 된다(무엇으로 견주는지 가려지지 않는다)
  select pg_catalog.count(*) into v_same
    from security_private.member_identity mi
    join public.users u on u.id = mi.member_id
   where u.email = any (v_emails) and mi.auth_user_id = mi.member_id;
  -- 함정 행: 회원번호가 계정 n 의 번호이고, 그 계정에도 그 회원번호에도 대응이 없다
  select pg_catalog.count(*) into v_trap
    from public.users u
   where u.email = 'zzb3c_trap@member.zzb3c.invalid'
     and u.id = pg_catalog.current_setting('b3c.acct_n')::pg_catalog.uuid
     and not exists (select 1 from security_private.member_identity mi where mi.auth_user_id = u.id or mi.member_id = u.id);
  -- 설정 열의 처음 값: 보관 답변이 있는 행 6(b 만 SQL NULL), 지원하지 않는 종류 1(gm), 동의 NULL 1(gm)
  select pg_catalog.count(*) into v_sets
    from public.users u
   where u.email = any (v_emails)
     and ((u.email = 'zzb3c_b@member.zzb3c.invalid' and u.pending_book_request is null and u.marketing_consent is false and u.intro_book_track = 'australia')
       or (u.email = 'zzb3c_gm@member.zzb3c.invalid' and pg_catalog.jsonb_typeof(u.pending_book_request) = 'object'
           and u.marketing_consent is null and u.intro_book_track = 'zzb3c_old_track')
       or (u.email not in ('zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid')
           and pg_catalog.jsonb_typeof(u.pending_book_request) = 'object' and u.marketing_consent is not null));
  if v_users <> 7 or v_maps <> 6 or v_admin <> 2 or v_same <> 0 or v_trap <> 1 or v_sets <> 7 then
    raise exception 'zzb3c 합성 자료 실패: 회원 행 % (7) · 대응 % (6) · 명부 % (2) · 대응표에서 회원번호=계정번호 % (0) · 함정 행 % (1) · 설정 열이 기대와 같은 행 % (7). 전부 되돌린다',
      v_users, v_maps, v_admin, v_same, v_trap, v_sets;
  end if;
end;
$zz_b3c$;

commit;

reset b3c.test_project_ref;

-- 만든 것의 정확한 값(expect.json). 회원 표 비밀번호 열의 원문은 싣지 않는다 — 접두사가 있다는 사실과 sha256 만(password_column).
with acct(label, auth_id) as (
  values
    ('a'::pg_catalog.text, pg_catalog.current_setting('b3c.acct_a')::pg_catalog.uuid),
    ('b',   pg_catalog.current_setting('b3c.acct_b')::pg_catalog.uuid),
    ('n',   pg_catalog.current_setting('b3c.acct_n')::pg_catalog.uuid),
    ('g',   pg_catalog.current_setting('b3c.acct_g')::pg_catalog.uuid),
    ('gm',  pg_catalog.current_setting('b3c.acct_gm')::pg_catalog.uuid),
    ('blk', pg_catalog.current_setting('b3c.acct_blk')::pg_catalog.uuid),
    ('wd',  pg_catalog.current_setting('b3c.acct_wd')::pg_catalog.uuid),
    ('bw',  pg_catalog.current_setting('b3c.acct_bw')::pg_catalog.uuid)
),
made as (
  select pg_catalog.jsonb_build_object(
    'users', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', u.id, 'email', u.email) order by u.email)
        from public.users u
       where u.email in ('zzb3c_a@member.zzb3c.invalid', 'zzb3c_b@member.zzb3c.invalid', 'zzb3c_gm@member.zzb3c.invalid',
                         'zzb3c_blk@member.zzb3c.invalid', 'zzb3c_wd@member.zzb3c.invalid', 'zzb3c_bw@member.zzb3c.invalid',
                         'zzb3c_trap@member.zzb3c.invalid')
    ),
    'mappings', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('auth_user_id', mi.auth_user_id, 'member_id', mi.member_id) order by mi.auth_user_id)
        from security_private.member_identity mi
       where mi.auth_user_id in (select a.auth_id from acct a where a.label in ('a', 'b', 'gm', 'blk', 'wd', 'bw'))
    ),
    'admins', (
      select pg_catalog.jsonb_agg(ap.auth_user_id order by ap.auth_user_id)
        from security_private.admin_principal ap
       where ap.auth_user_id in (select a.auth_id from acct a where a.label in ('g', 'gm'))
    ),
    'accounts', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label', a.label, 'auth_user_id', a.auth_id, 'email', au.email) order by a.label)
        from acct a
        join auth.users au on au.id = a.auth_id
    )
  ) as j
)
select pg_catalog.jsonb_build_object(
  'marker', 'zzb3c',
  'read_at', pg_catalog.now(),
  'trap', (
    select pg_catalog.jsonb_build_object(
             'meaning', '회원번호가 계정 n 의 로그인 계정 번호와 같은 회원 행(대응 없음). 어느 응답에도 나오면 안 되고, 어느 요청으로도 고쳐지면 안 된다',
             'id', u.id, 'name', u.name, 'nickname', u.nickname, 'email', u.email, 'phone', u.phone,
             'password_column', pg_catalog.jsonb_build_object(
               'prefix', 'zzb3c-pwcol-',
               'has_prefix', pg_catalog.strpos(u.password, 'zzb3c-pwcol-') = 1,
               'sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(u.password, 'UTF8')), 'hex')),
             'settings', pg_catalog.jsonb_build_object(
               'intro_book_track', u.intro_book_track, 'marketing_consent', u.marketing_consent,
               'marketing_consent_at', u.marketing_consent_at, 'pending_book_request', u.pending_book_request))
      from public.users u
     where u.email = 'zzb3c_trap@member.zzb3c.invalid'
  ),
  'accounts', (
    select pg_catalog.jsonb_object_agg(
             a.label,
             pg_catalog.jsonb_build_object(
               'auth_user_id', a.auth_id,
               'auth_email', (select au.email from auth.users au where au.id = a.auth_id),
               'listed_admin', exists (select 1 from security_private.admin_principal ap where ap.auth_user_id = a.auth_id and ap.enabled),
               'member', case when u.id is null then null else pg_catalog.jsonb_build_object(
                           'id', u.id, 'name', u.name, 'nickname', u.nickname,
                           'email', u.email, 'phone', u.phone, 'timezone', u.timezone) end,
               'settings', case when u.id is null then null else pg_catalog.jsonb_build_object(
                           'intro_book_track', u.intro_book_track, 'marketing_consent', u.marketing_consent,
                           'marketing_consent_at', u.marketing_consent_at, 'pending_book_request', u.pending_book_request) end,
               'expected_state', case
                                   when u.id is null then 'no_member'
                                   when u.blocked is true then 'blocked'
                                   when u.withdrawal_requested_at is not null then 'withdrawal_pending'
                                   else 'ok' end,
               'password_column', case when u.id is null then null else pg_catalog.jsonb_build_object(
                           'prefix', 'zzb3c-pwcol-',
                           'has_prefix', pg_catalog.strpos(u.password, 'zzb3c-pwcol-') = 1,
                           'sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(u.password, 'UTF8')), 'hex')) end,
               'withdrawal_markers', case when u.id is null then null
                                          else pg_catalog.jsonb_build_array(u.withdrawal_reason, u.withdrawal_reason_detail) end
             ))
      from acct a
      left join security_private.member_identity mi on mi.auth_user_id = a.auth_id
      left join public.users u on u.id = mi.member_id
  ),
  'created', (select m.j from made m),
  'down_input', (select m.j::pg_catalog.text from made m)
) as result;
