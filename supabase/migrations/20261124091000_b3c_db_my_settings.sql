-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB: "본인 설정" 함수 다섯 (2026-11-24)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 시험 순서는
-- supabase/tests/b3c_db_my_settings/절차.md 를 따른다.
--
-- 만드는 것: 공개 함수 다섯. 기존 표·열·정책·함수·권한·설정은 하나도 바꾸지 않는다
-- (회원 표 public.users 의 권한·행 보안·규칙·제약, public.my_profile(), 2-가의 함수·표 전부 그대로).
--   public.my_settings()                          returns jsonb   읽기: 입문서 종류 · 마케팅 동의
--   public.my_book_answers()                      returns jsonb   읽기: 보관해 둔 입문서 신청 답변
--   public.my_intro_track_set(p_track text)       returns jsonb   쓰기: intro_book_track 한 열
--   public.my_marketing_consent_set(p_consent boolean) returns jsonb   쓰기: marketing_consent · marketing_consent_at 두 열
--   public.my_book_answers_hold(p_answers jsonb)  returns jsonb   쓰기: pending_book_request 한 열
-- 만들지 않는 것(빈 함수·권한도 두지 않는다): 내 정보 네 열 고치기, 별명 중복 확인, 보관 답변 지우기.
--
-- 누구의 행인가(다섯 함수 공통 — 3-0 의 public.my_profile() 과 같다)
--   회원번호·이메일·표 이름·열 이름을 인자로 받지 않는다. 2-가의 비공개 판정 security_private.current_member_id()
--   (살아 있는 로그인 기록 + 회원 대응)가 돌려준 회원번호의 한 행만 읽고 고친다.
--   로그인 계정 번호를 회원번호로 쓰지 않는다.
--
-- 공통 순서
--   0. 요청 메서드가 POST 가 아니면 아무것도 읽지 않고 405 (SQLSTATE PT405)
--   1. security_private.request_allowed() 가 참이 아니면 503 (SQLSTATE PT503, message 'maintenance')
--      — 공통 확인(pgrst.db_pre_request) 설정이 걸려 있든 아니든 함수가 스스로 확인한다
--   2. Cache-Control: private, no-store (함수가 값을 돌려주는 모든 상태에)
--   3. 회원 대응이 없거나 로그인 기록이 끝났으면 {"state":"no_member"}
--   4. 그 회원번호의 한 행, 이름을 적은 열만. 쓰기 함수는 그 행을 잠근다(for update)
--   5. 차단이면 {"state":"blocked"} (차단을 먼저 본다) → 탈퇴 처리 중이면 {"state":"withdrawal_pending"}
--      이 셋(no_member · blocked · withdrawal_pending)에는 값을 주지도 고치지도 않는다 — state 하나뿐
--   6. (쓰기) 받은 값을 검사한다. 맞지 않으면 400 (SQLSTATE PT400, message 는 아래의 고정 글자, 값은 싣지 않는다)
--   7. (쓰기) 그 한 행의 그 열만 고친다. 4~7 은 한 트랜잭션이다(잠금은 트랜잭션이 끝날 때 풀린다)
--
-- 돌려주는 값
--   my_settings()                 {"state":"ok","settings":{"intro_book_track","intro_book_track_supported",
--                                                         "marketing_consent","marketing_consent_at"}}
--       저장된 값을 그대로 돌려준다(널을 동의로 바꾸지 않는다). intro_book_track_supported 는 저장된 값이
--       regular · australia 가운데 하나일 때만 true. 이 함수는 아무것도 고치지 않는다.
--   my_book_answers()             {"state":"ok","answers":null}              열의 값이 SQL NULL — 보관 없음
--                                 {"state":"ok","answers":{열두 항목 + answered_at}}   정상
--                                 {"state":"answers_corrupt"}                 객체가 아니거나, 열두 항목 가운데 빠진 것이 있거나,
--                                                                             형식이 틀림 — 값을 주지 않는다
--       읽을 때의 규칙: 열두 항목이 전부 있고 형이 맞는가(지금 화면 js/dashboard.js loadPendingBookAnswers 의 것) + 아래 둘.
--       저장된 값에 그 밖의 키가 있어도 돌려주지 않는다.
--       utm_data 의 안쪽도 좁힌다: 쓰기에서 정한 다섯 키(utm_source · utm_medium · utm_campaign · utm_content · utm_term)
--         가운데 있는 것만 돌려준다. utm_data 안의 값이 하나라도 글자가 아니면(숫자 · 참거짓 · null · 배열 · 겹친 객체 —
--         어느 키든) 파손이다. 다섯 밖의 키(값이 글자)는 돌려주지 않는다.
--       answered_at: 없거나 JSON null 이면 null. 글자면 **시각으로 읽히는 글자일 때만** 그 글자를 그대로 돌려준다 —
--         모양이 YYYY-MM-DDTHH:MM:SS[.소수 1~6자리](Z 또는 ±HH:MM) 이고 timestamptz 로 바뀌는 값. 그 밖의 글자 · 글자가 아닌 값은 파손.
--       이 함수는 아무것도 고치지 않는다.
--   my_intro_track_set(p_track)   {"state":"ok","intro_book_track":<저장된 값>}
--       p_track 은 'regular' 또는 'australia'. 널·그 밖의 값은 400 · message 'invalid_track'.
--   my_marketing_consent_set(p_consent)   {"state":"ok","marketing_consent":true,"marketing_consent_at":<DB 의 시각>}
--       p_consent 는 참만. 거짓·널은 400 · message 'invalid_consent'. 시각은 인자로 받지 않는다 —
--       행을 잠근 뒤의 DB 시각(clock_timestamp)을 쓴다. 부를 때마다 시각을 새로 쓴다(지금 화면의 동작과 같다).
--   my_book_answers_hold(p_answers)   {"state":"ok","answers":<저장된 것: 열두 항목 + answered_at>}
--       p_answers 는 정확히 열두 항목의 객체. 맞지 않으면 400 · message 'invalid_answers' · details 에 고정된 사유 이름
--       (not_object · too_large · unknown_key · missing_key · 항목 이름). 받은 값·키 이름은 오류에 싣지 않는다.
--       answered_at 은 서버가 붙인다(인자에 answered_at 이 있으면 "항목 밖의 키"로 거절한다).
--       있던 값을 통째로 덮어쓴다(항목별로 합치지 않는다).
--   어떤 응답에도 없는 것: 비밀번호, role · level, blocked, 탈퇴 열, 대응표의 값, 로그인 계정 번호, 회원번호,
--   이름 · 별명 · 이메일 · 전화 · 시간대.
--
-- 보관 답변의 모양(my_book_answers_hold 가 받는 것 — 근거는 계약3C_DB_작업보고.md 의 표)
--   current_score           숫자 또는 null. 0 이상 120 이하, 0.5 단위
--   target_score            숫자. 0 초과 120 이하, 0.5 단위
--   no_target_score         false 만
--   stuck_area              '리딩' · '리스닝' · '라이팅' · '스피킹'
--   goal_timeframe          '한 달 안에' · '3개월 안에' · '6개월 안에'
--   referral_source         '블로그' · '인스타그램' · '지인추천' · '기타'
--   referral_source_detail  referral_source 가 '기타'면 글자(1~200자. 공백 글자만으로 된 값은 안 됨 — 공백 글자는
--                           화면의 trim() 이 지우는 것과 같은 목록: 탭 · 줄바꿈 · 빈칸 · U+00A0 · U+3000(전각 빈칸) 등),
--                           아니면 null. 글자 수는 코드 포인트로 센다(char_length)
--   is_au_nz_direct_submit  'yes' · 'no'
--   referrer_url            글자(1~2048자) 또는 null — 주소를 열어 보거나 풀어 보지 않는다
--   landing_url             글자(1~2048자) 또는 null — 주소를 열어 보거나 풀어 보지 않는다
--   utm_data                null 또는 객체: 키는 utm_source · utm_medium · utm_campaign · utm_content · utm_term 가운데
--                           1~5개, 값은 글자(1~200자). 깊이 1(값이 객체·배열이면 거절)
--   user_agent              글자(1~512자) 또는 null
--   전체 크기               p_answers 를 글자로 바꾼 것이 16384 바이트 이하
--
-- 소유자 권한으로 읽고 쓰는 조건(회원 표가 뒤에 잠겨도 돌도록 security definer — 그래서 아래를 고정한다)
--   * search_path 를 비운다. 모든 객체에 스키마를 적는다. 동적 SQL(execute)을 쓰지 않는다.
--   * 서버가 구한 회원번호의 한 행만(where u.id = <current_member_id() 의 값>).
--   * 이름을 적은 열만 읽고 쓴다(select * · 행 전체를 JSON 으로 바꾸기 · 호출자가 대상을 지정하는 인자 없음).
--   * 기존 표의 권한을 넓히지 않는다(이 파일에 표에 대한 grant 가 없다).
--   주의: 회원 표에 FORCE ROW LEVEL SECURITY 를 걸면 소유자도 정책을 따른다(묶음 5 에서 확인할 것).
--
-- 실행 권한: authenticated 만. PUBLIC · anon · service_role 은 같은 트랜잭션에서 회수한다.
-- 공통 확인(security_private.check_api_request)의 예외에 이 함수들을 추가하지 않는다 — 그 함수는 건드리지 않는다.
--
-- 전제: 20261122164348_b2a_identity_gate.sql(2-가)이 적용돼 있어야 한다. 아니면 첫 블록에서 멈춘다.
-- 되돌리기: supabase/migrations_rollback/20261124091000_b3c_db_my_settings_rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 전제 확인 (하나라도 다르면 아무것도 만들지 않고 멈춘다)
-- ---------------------------------------------------------------------
do $b3c_pre$
declare
  v_col  record;
  v_type text;
  v_n    bigint;
begin
  -- (가) 2-가의 객체
  if pg_catalog.to_regprocedure('security_private.current_member_id()') is null then
    raise exception 'b3c 전제 확인 실패: security_private.current_member_id() 가 없음(2-가가 적용돼 있지 않다)';
  end if;
  if pg_catalog.to_regprocedure('security_private.request_allowed()') is null then
    raise exception 'b3c 전제 확인 실패: security_private.request_allowed() 가 없음(2-가가 적용돼 있지 않다)';
  end if;
  if pg_catalog.to_regprocedure('security_private.check_api_request()') is null then
    raise exception 'b3c 전제 확인 실패: security_private.check_api_request() 가 없음(2-가가 적용돼 있지 않다)';
  end if;
  if pg_catalog.to_regclass('security_private.member_identity') is null then
    raise exception 'b3c 전제 확인 실패: security_private.member_identity 가 없음(2-가가 적용돼 있지 않다)';
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('security_private.current_member_id()')
     and p.prorettype = 'pg_catalog.uuid'::pg_catalog.regtype;
  if v_n <> 1 then
    raise exception 'b3c 전제 확인 실패: security_private.current_member_id() 의 반환형이 uuid 가 아님';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('security_private.request_allowed()')
     and p.prorettype = 'pg_catalog.bool'::pg_catalog.regtype;
  if v_n <> 1 then
    raise exception 'b3c 전제 확인 실패: security_private.request_allowed() 의 반환형이 boolean 이 아님';
  end if;

  -- (나) 회원 표와 이 함수들이 읽고 쓰는 열(이름·형)
  if pg_catalog.to_regclass('public.users') is null then
    raise exception 'b3c 전제 확인 실패: public.users 가 없음';
  end if;
  for v_col in
    select t.col, t.want
      from (
        values
          ('id'::pg_catalog.text,        'uuid'::pg_catalog.text),
          ('blocked',                    'boolean'),
          ('withdrawal_requested_at',    'timestamp with time zone'),
          ('intro_book_track',           'text'),
          ('marketing_consent',          'boolean'),
          ('marketing_consent_at',       'timestamp with time zone'),
          ('pending_book_request',       'jsonb')
      ) as t(col, want)
  loop
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
      into v_type
      from pg_catalog.pg_attribute a
     where a.attrelid = pg_catalog.to_regclass('public.users')
       and a.attname = v_col.col
       and a.attnum > 0
       and not a.attisdropped;
    if not found then
      raise exception 'b3c 전제 확인 실패: public.users 에 열 % 이 없음', v_col.col;
    end if;
    if v_type is distinct from v_col.want then
      raise exception 'b3c 전제 확인 실패: public.users.% 의 형이 % (기대 %)', v_col.col, v_type, v_col.want;
    end if;
  end loop;

  -- (다) 같은 이름의 함수가 아직 없다(인자가 다른 것도). 있으면 덮어쓰지 않는다.
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('my_settings', 'my_book_answers', 'my_intro_track_set', 'my_marketing_consent_set', 'my_book_answers_hold');
  if v_n <> 0 then
    raise exception 'b3c 전제 확인 실패: 이 마이그레이션이 만들 이름의 함수가 public 에 이미 %개 있음. 덮어쓰지 않는다', v_n;
  end if;
end;
$b3c_pre$;

-- ---------------------------------------------------------------------
-- 1. 읽기: 내 설정
-- ---------------------------------------------------------------------
create function public.my_settings()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b3c_settings$
declare
  v_method     text;
  v_member     uuid;
  v_blocked    boolean;
  v_withdrawal timestamptz;
  v_track      text;
  v_consent    boolean;
  v_consent_at timestamptz;
begin
  -- 0. POST 로만(PostgREST 를 거치지 않는 호출에는 이 값이 없다 — 그때는 아래로 간다)
  v_method := pg_catalog.current_setting('request.method', true);
  if v_method is not null and v_method <> '' and v_method <> 'POST' then
    raise exception using errcode = 'PT405', message = 'method not allowed';
  end if;

  -- 1. 점검: 회원 행을 읽기 전에 기존 판정으로 확인한다
  if security_private.request_allowed() is not true then
    raise exception using errcode = 'PT503', message = 'maintenance';
  end if;

  -- 2. 이 함수가 돌려주는 모든 상태에
  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  -- 3. 누구인가
  v_member := security_private.current_member_id();
  if v_member is null then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  -- 4. 그 회원번호의 한 행, 이름을 적은 열만
  select u.blocked, u.withdrawal_requested_at, u.intro_book_track, u.marketing_consent, u.marketing_consent_at
    into v_blocked, v_withdrawal, v_track, v_consent, v_consent_at
    from public.users u
   where u.id = v_member;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  -- 5. 차단 → 탈퇴 처리 중
  if v_blocked is true then
    return pg_catalog.jsonb_build_object('state', 'blocked');
  end if;
  if v_withdrawal is not null then
    return pg_catalog.jsonb_build_object('state', 'withdrawal_pending');
  end if;

  -- 저장된 값을 그대로(널을 다른 값으로 바꾸지 않는다)
  return pg_catalog.jsonb_build_object(
    'state', 'ok',
    'settings', pg_catalog.jsonb_build_object(
      'intro_book_track', v_track,
      'intro_book_track_supported', coalesce(v_track in ('regular', 'australia'), false),
      'marketing_consent', v_consent,
      'marketing_consent_at', v_consent_at
    )
  );
end;
$b3c_settings$;

revoke all on function public.my_settings() from public, anon, authenticated, service_role;
grant execute on function public.my_settings() to authenticated;

-- ---------------------------------------------------------------------
-- 2. 읽기: 보관해 둔 입문서 신청 답변
-- ---------------------------------------------------------------------
create function public.my_book_answers()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b3c_answers$
declare
  -- 열두 항목: 이름 · 형(jsonb_typeof 의 값) · 널 허용. 지금 화면의 읽기 규칙과 같다.
  v_keys     constant text[] := array[
    'current_score', 'target_score', 'no_target_score', 'stuck_area', 'goal_timeframe', 'referral_source',
    'referral_source_detail', 'is_au_nz_direct_submit', 'referrer_url', 'landing_url', 'utm_data', 'user_agent'];
  v_types    constant text[] := array[
    'number', 'number', 'boolean', 'string', 'string', 'string',
    'string', 'string', 'string', 'string', 'object', 'string'];
  v_nullable constant boolean[] := array[
    true, false, false, false, false, false,
    true, false, true, true, true, true];
  v_utm_keys constant text[] := array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  v_method     text;
  v_member     uuid;
  v_blocked    boolean;
  v_withdrawal timestamptz;
  v_raw        jsonb;
  v_val        jsonb;
  v_type       text;
  v_key        text;
  v_utm        jsonb;
  v_utm_out    jsonb;
  v_at         jsonb;
  v_at_text    text;
  v_ts         timestamptz;
begin
  v_method := pg_catalog.current_setting('request.method', true);
  if v_method is not null and v_method <> '' and v_method <> 'POST' then
    raise exception using errcode = 'PT405', message = 'method not allowed';
  end if;

  if security_private.request_allowed() is not true then
    raise exception using errcode = 'PT503', message = 'maintenance';
  end if;

  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  v_member := security_private.current_member_id();
  if v_member is null then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  select u.blocked, u.withdrawal_requested_at, u.pending_book_request
    into v_blocked, v_withdrawal, v_raw
    from public.users u
   where u.id = v_member;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  if v_blocked is true then
    return pg_catalog.jsonb_build_object('state', 'blocked');
  end if;
  if v_withdrawal is not null then
    return pg_catalog.jsonb_build_object('state', 'withdrawal_pending');
  end if;

  -- 보관 없음: 열의 값이 SQL NULL 일 때만
  if v_raw is null then
    return pg_catalog.jsonb_build_object('state', 'ok', 'answers', null::pg_catalog.jsonb);
  end if;

  -- 파손: 객체가 아님(배열 · 글자 · 숫자 · 참거짓 · JSON null)
  if pg_catalog.jsonb_typeof(v_raw) is distinct from 'object' then
    return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
  end if;

  -- 파손: 열두 항목 가운데 빠진 것이 있거나 형이 틀림
  for i in 1 .. 12 loop
    v_val := v_raw -> v_keys[i];
    if v_val is null then
      return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
    end if;
    v_type := pg_catalog.jsonb_typeof(v_val);
    if v_type = 'null' then
      if v_nullable[i] is not true then
        return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
      end if;
    elsif v_type <> v_types[i] then
      return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
    end if;
  end loop;

  -- utm_data 의 안쪽: 정해 둔 다섯 키 가운데 있는 것만 돌려준다(여기까지 왔으면 utm_data 는 객체이거나 JSON null 이다).
  --   값이 하나라도 글자가 아니면(어느 키든 — 숫자 · 참거짓 · null · 배열 · 겹친 객체) 파손.
  --   다섯 밖의 키(값이 글자)는 돌려주지 않는다.
  v_utm := v_raw -> 'utm_data';
  if pg_catalog.jsonb_typeof(v_utm) = 'object' then
    v_utm_out := '{}'::pg_catalog.jsonb;
    for v_key, v_type in
      select t.key, pg_catalog.jsonb_typeof(t.value) from pg_catalog.jsonb_each(v_utm) as t(key, value)
    loop
      if v_type <> 'string' then
        return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
      end if;
      if v_key = any (v_utm_keys) then
        v_utm_out := v_utm_out || pg_catalog.jsonb_build_object(v_key, v_utm -> v_key);
      end if;
    end loop;
  else
    v_utm_out := 'null'::pg_catalog.jsonb;
  end if;

  -- answered_at: 없거나 JSON null 이면 null. 글자면 시각으로 읽히는 글자일 때만 그 글자 그대로. 그 밖은 파손.
  --   시각으로 읽히는 글자 = 모양이 YYYY-MM-DDTHH:MM:SS[.소수 1~6자리](Z 또는 ±HH:MM) 이고 timestamptz 로 바뀌는 값
  --   (모양만 맞고 날짜가 없는 값 — 13월 · 99시 — 은 바꾸다 실패한다 → 파손)
  v_at := v_raw -> 'answered_at';
  if v_at is null or pg_catalog.jsonb_typeof(v_at) = 'null' then
    v_at := 'null'::pg_catalog.jsonb;
  elsif pg_catalog.jsonb_typeof(v_at) <> 'string' then
    return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
  else
    v_at_text := v_raw ->> 'answered_at';
    if v_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
    end if;
    begin
      v_ts := v_at_text::pg_catalog.timestamptz;
    exception when others then
      return pg_catalog.jsonb_build_object('state', 'answers_corrupt');
    end;
  end if;

  -- 정해 둔 열두 항목과 answered_at 만(저장된 값에 그 밖의 키가 있어도 돌려주지 않는다)
  return pg_catalog.jsonb_build_object(
    'state', 'ok',
    'answers', pg_catalog.jsonb_build_object(
      'current_score', v_raw -> 'current_score',
      'target_score', v_raw -> 'target_score',
      'no_target_score', v_raw -> 'no_target_score',
      'stuck_area', v_raw -> 'stuck_area',
      'goal_timeframe', v_raw -> 'goal_timeframe',
      'referral_source', v_raw -> 'referral_source',
      'referral_source_detail', v_raw -> 'referral_source_detail',
      'is_au_nz_direct_submit', v_raw -> 'is_au_nz_direct_submit',
      'referrer_url', v_raw -> 'referrer_url',
      'landing_url', v_raw -> 'landing_url',
      'utm_data', v_utm_out,
      'user_agent', v_raw -> 'user_agent',
      'answered_at', v_at
    )
  );
end;
$b3c_answers$;

revoke all on function public.my_book_answers() from public, anon, authenticated, service_role;
grant execute on function public.my_book_answers() to authenticated;

-- ---------------------------------------------------------------------
-- 3. 쓰기: 입문서 종류
-- ---------------------------------------------------------------------
create function public.my_intro_track_set(p_track text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b3c_track$
declare
  v_method     text;
  v_member     uuid;
  v_blocked    boolean;
  v_withdrawal timestamptz;
  v_track      text;
begin
  v_method := pg_catalog.current_setting('request.method', true);
  if v_method is not null and v_method <> '' and v_method <> 'POST' then
    raise exception using errcode = 'PT405', message = 'method not allowed';
  end if;

  if security_private.request_allowed() is not true then
    raise exception using errcode = 'PT503', message = 'maintenance';
  end if;

  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  v_member := security_private.current_member_id();
  if v_member is null then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  -- 본인 행을 잠근 뒤 상태를 본다(상태 확인부터 고치기까지 한 트랜잭션)
  select u.blocked, u.withdrawal_requested_at, u.intro_book_track
    into v_blocked, v_withdrawal, v_track
    from public.users u
   where u.id = v_member
     for update;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  if v_blocked is true then
    return pg_catalog.jsonb_build_object('state', 'blocked');
  end if;
  if v_withdrawal is not null then
    return pg_catalog.jsonb_build_object('state', 'withdrawal_pending');
  end if;

  -- 받은 값: 두 가지뿐(널 · 그 밖의 값은 거절). 받은 값은 오류에 싣지 않는다
  if p_track is null or p_track not in ('regular', 'australia') then
    raise exception using errcode = 'PT400', message = 'invalid_track';
  end if;

  -- 같은 값이면 쓰지 않는다(같은 결과). 다르면 그 한 열만
  if v_track is distinct from p_track then
    update public.users u
       set intro_book_track = p_track
     where u.id = v_member
    returning u.intro_book_track into v_track;
    if not found then
      raise exception 'b3c my_intro_track_set: 잠근 행을 고치지 못했다';
    end if;
  end if;

  return pg_catalog.jsonb_build_object('state', 'ok', 'intro_book_track', v_track);
end;
$b3c_track$;

revoke all on function public.my_intro_track_set(text) from public, anon, authenticated, service_role;
grant execute on function public.my_intro_track_set(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. 쓰기: 마케팅 동의(참만. 철회는 만들지 않는다)
-- ---------------------------------------------------------------------
create function public.my_marketing_consent_set(p_consent boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b3c_consent$
declare
  v_method     text;
  v_member     uuid;
  v_blocked    boolean;
  v_withdrawal timestamptz;
  v_consent    boolean;
  v_consent_at timestamptz;
begin
  v_method := pg_catalog.current_setting('request.method', true);
  if v_method is not null and v_method <> '' and v_method <> 'POST' then
    raise exception using errcode = 'PT405', message = 'method not allowed';
  end if;

  if security_private.request_allowed() is not true then
    raise exception using errcode = 'PT503', message = 'maintenance';
  end if;

  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  v_member := security_private.current_member_id();
  if v_member is null then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  select u.blocked, u.withdrawal_requested_at
    into v_blocked, v_withdrawal
    from public.users u
   where u.id = v_member
     for update;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  if v_blocked is true then
    return pg_catalog.jsonb_build_object('state', 'blocked');
  end if;
  if v_withdrawal is not null then
    return pg_catalog.jsonb_build_object('state', 'withdrawal_pending');
  end if;

  -- 받은 값: 참만(거짓 · 널은 거절 — 철회는 이 함수의 일이 아니다)
  if p_consent is not true then
    raise exception using errcode = 'PT400', message = 'invalid_consent';
  end if;

  -- 시각은 인자로 받지 않는다. 행을 잠근 뒤의 DB 시각. 부를 때마다 새로 쓴다(지금 화면의 동작과 같다)
  update public.users u
     set marketing_consent = true,
         marketing_consent_at = pg_catalog.clock_timestamp()
   where u.id = v_member
  returning u.marketing_consent, u.marketing_consent_at into v_consent, v_consent_at;
  if not found then
    raise exception 'b3c my_marketing_consent_set: 잠근 행을 고치지 못했다';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'ok',
    'marketing_consent', v_consent,
    'marketing_consent_at', v_consent_at
  );
end;
$b3c_consent$;

revoke all on function public.my_marketing_consent_set(boolean) from public, anon, authenticated, service_role;
grant execute on function public.my_marketing_consent_set(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 쓰기: 입문서 신청 답변 보관(통째로 덮어쓴다)
-- ---------------------------------------------------------------------
create function public.my_book_answers_hold(p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b3c_hold$
declare
  c_max_bytes     constant integer := 16384;  -- p_answers 를 글자로 바꾼 것의 바이트 수
  c_max_url       constant integer := 2048;   -- referrer_url · landing_url 의 글자 수
  c_max_agent     constant integer := 512;    -- user_agent 의 글자 수
  c_max_detail    constant integer := 200;    -- referral_source_detail 의 글자 수
  c_max_utm_value constant integer := 200;    -- utm_data 의 값 하나의 글자 수
  -- 화면의 trim() 이 지우는 공백 글자(ECMAScript 의 WhiteSpace + LineTerminator)
  c_space constant text := E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  v_keys     constant text[] := array[
    'current_score', 'target_score', 'no_target_score', 'stuck_area', 'goal_timeframe', 'referral_source',
    'referral_source_detail', 'is_au_nz_direct_submit', 'referrer_url', 'landing_url', 'utm_data', 'user_agent'];
  v_utm_keys constant text[] := array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  v_url_keys constant text[] := array['referrer_url', 'landing_url'];
  v_method     text;
  v_member     uuid;
  v_blocked    boolean;
  v_withdrawal timestamptz;
  v_key        text;
  v_val        jsonb;
  v_type       text;
  v_num        numeric;
  v_text       text;
  v_n          integer;
  v_saved      jsonb;
begin
  v_method := pg_catalog.current_setting('request.method', true);
  if v_method is not null and v_method <> '' and v_method <> 'POST' then
    raise exception using errcode = 'PT405', message = 'method not allowed';
  end if;

  if security_private.request_allowed() is not true then
    raise exception using errcode = 'PT503', message = 'maintenance';
  end if;

  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  v_member := security_private.current_member_id();
  if v_member is null then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  select u.blocked, u.withdrawal_requested_at
    into v_blocked, v_withdrawal
    from public.users u
   where u.id = v_member
     for update;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  if v_blocked is true then
    return pg_catalog.jsonb_build_object('state', 'blocked');
  end if;
  if v_withdrawal is not null then
    return pg_catalog.jsonb_build_object('state', 'withdrawal_pending');
  end if;

  -- ----- 받은 값의 검사. 오류의 details 는 고정된 사유 이름이다(받은 값 · 받은 키 이름을 싣지 않는다) -----

  -- (1) 객체여야 한다(널 · 배열 · 글자 · 숫자 · 참거짓 거절)
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'not_object';
  end if;

  -- (2) 전체 크기
  if pg_catalog.octet_length(p_answers::pg_catalog.text) > c_max_bytes then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'too_large';
  end if;

  -- (3) 키: 정확히 열두 항목(그 밖의 키는 전부 거절 — answered_at 도. 빠진 항목이 있어도 거절)
  v_n := 0;
  for v_key in select t.k from pg_catalog.jsonb_object_keys(p_answers) as t(k) loop
    if not (v_key = any (v_keys)) then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'unknown_key';
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 12 then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'missing_key';
  end if;

  -- (4) current_score: 숫자 또는 null. 0 이상 120 이하, 0.5 단위
  v_val := p_answers -> 'current_score';
  v_type := pg_catalog.jsonb_typeof(v_val);
  if v_type = 'number' then
    v_num := (p_answers ->> 'current_score')::pg_catalog.numeric;
    if v_num < 0 or v_num > 120 or (v_num * 2) <> pg_catalog.trunc(v_num * 2) then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'current_score';
    end if;
  elsif v_type <> 'null' then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'current_score';
  end if;

  -- (5) target_score: 숫자. 0 초과 120 이하, 0.5 단위
  v_val := p_answers -> 'target_score';
  if pg_catalog.jsonb_typeof(v_val) <> 'number' then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'target_score';
  end if;
  v_num := (p_answers ->> 'target_score')::pg_catalog.numeric;
  if v_num <= 0 or v_num > 120 or (v_num * 2) <> pg_catalog.trunc(v_num * 2) then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'target_score';
  end if;

  -- (6) no_target_score: false 만(목표 점수가 있는 답변이다)
  if (p_answers -> 'no_target_score') is distinct from 'false'::pg_catalog.jsonb then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'no_target_score';
  end if;

  -- (7) stuck_area
  v_val := p_answers -> 'stuck_area';
  if pg_catalog.jsonb_typeof(v_val) <> 'string'
     or (p_answers ->> 'stuck_area') not in ('리딩', '리스닝', '라이팅', '스피킹') then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'stuck_area';
  end if;

  -- (8) goal_timeframe
  v_val := p_answers -> 'goal_timeframe';
  if pg_catalog.jsonb_typeof(v_val) <> 'string'
     or (p_answers ->> 'goal_timeframe') not in ('한 달 안에', '3개월 안에', '6개월 안에') then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'goal_timeframe';
  end if;

  -- (9) referral_source
  v_val := p_answers -> 'referral_source';
  if pg_catalog.jsonb_typeof(v_val) <> 'string'
     or (p_answers ->> 'referral_source') not in ('블로그', '인스타그램', '지인추천', '기타') then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'referral_source';
  end if;

  -- (10) referral_source_detail: '기타'면 글자(1~200자, 공백 글자만으로 된 값은 안 됨), 아니면 null
  v_val := p_answers -> 'referral_source_detail';
  v_type := pg_catalog.jsonb_typeof(v_val);
  if (p_answers ->> 'referral_source') = '기타' then
    if v_type <> 'string' then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'referral_source_detail';
    end if;
    v_text := p_answers ->> 'referral_source_detail';
    if pg_catalog.char_length(v_text) < 1 or pg_catalog.char_length(v_text) > c_max_detail
       or pg_catalog.btrim(v_text, c_space) = '' then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'referral_source_detail';
    end if;
  elsif v_type <> 'null' then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'referral_source_detail';
  end if;

  -- (11) is_au_nz_direct_submit
  v_val := p_answers -> 'is_au_nz_direct_submit';
  if pg_catalog.jsonb_typeof(v_val) <> 'string'
     or (p_answers ->> 'is_au_nz_direct_submit') not in ('yes', 'no') then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'is_au_nz_direct_submit';
  end if;

  -- (12) referrer_url · landing_url: 글자(1~2048자) 또는 null. 주소를 열어 보거나 풀어 보지 않는다(길이만 본다)
  foreach v_key in array v_url_keys loop
    v_val := p_answers -> v_key;
    v_type := pg_catalog.jsonb_typeof(v_val);
    if v_type = 'string' then
      v_n := pg_catalog.char_length(p_answers ->> v_key);
      if v_n < 1 or v_n > c_max_url then
        raise exception using errcode = 'PT400', message = 'invalid_answers', detail = v_key;
      end if;
    elsif v_type <> 'null' then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = v_key;
    end if;
  end loop;

  -- (13) user_agent: 글자(1~512자) 또는 null
  v_val := p_answers -> 'user_agent';
  v_type := pg_catalog.jsonb_typeof(v_val);
  if v_type = 'string' then
    v_n := pg_catalog.char_length(p_answers ->> 'user_agent');
    if v_n < 1 or v_n > c_max_agent then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'user_agent';
    end if;
  elsif v_type <> 'null' then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'user_agent';
  end if;

  -- (14) utm_data: null 또는 객체(키는 정해 둔 다섯 가운데 1~5개, 값은 글자 1~200자 — 깊이 1)
  v_val := p_answers -> 'utm_data';
  v_type := pg_catalog.jsonb_typeof(v_val);
  if v_type = 'object' then
    v_n := 0;
    for v_key, v_text in
      select t.key, pg_catalog.jsonb_typeof(t.value) from pg_catalog.jsonb_each(v_val) as t(key, value)
    loop
      if not (v_key = any (v_utm_keys)) or v_text <> 'string' then
        raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'utm_data';
      end if;
      if pg_catalog.char_length(v_val ->> v_key) < 1 or pg_catalog.char_length(v_val ->> v_key) > c_max_utm_value then
        raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'utm_data';
      end if;
      v_n := v_n + 1;
    end loop;
    if v_n < 1 then
      raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'utm_data';
    end if;
  elsif v_type <> 'null' then
    raise exception using errcode = 'PT400', message = 'invalid_answers', detail = 'utm_data';
  end if;

  -- ----- 저장: 검사한 열두 항목 + 서버가 붙이는 answered_at(행을 잠근 뒤의 DB 시각, UTC, 밀리초까지) -----
  --        있던 값을 통째로 덮어쓴다(항목별로 합치지 않는다). 그 한 열만 고친다.
  update public.users u
     set pending_book_request = pg_catalog.jsonb_build_object(
           'current_score', p_answers -> 'current_score',
           'target_score', p_answers -> 'target_score',
           'no_target_score', p_answers -> 'no_target_score',
           'stuck_area', p_answers -> 'stuck_area',
           'goal_timeframe', p_answers -> 'goal_timeframe',
           'referral_source', p_answers -> 'referral_source',
           'referral_source_detail', p_answers -> 'referral_source_detail',
           'is_au_nz_direct_submit', p_answers -> 'is_au_nz_direct_submit',
           'referrer_url', p_answers -> 'referrer_url',
           'landing_url', p_answers -> 'landing_url',
           'utm_data', p_answers -> 'utm_data',
           'user_agent', p_answers -> 'user_agent',
           'answered_at', pg_catalog.to_char(
             pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         )
   where u.id = v_member
  returning u.pending_book_request into v_saved;
  if not found then
    raise exception 'b3c my_book_answers_hold: 잠근 행을 고치지 못했다';
  end if;

  return pg_catalog.jsonb_build_object('state', 'ok', 'answers', v_saved);
end;
$b3c_hold$;

revoke all on function public.my_book_answers_hold(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.my_book_answers_hold(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 자기 점검 (같은 트랜잭션. 어긋나면 예외 → 전체 되돌아감)
--    이 점검의 통과는 supabase/tests/b3c_db_my_settings/절차.md 의 시험을 대신하지 않는다.
-- ---------------------------------------------------------------------
do $b3c_check$
declare
  v_sigs   constant text[] := array[
    'public.my_settings()',
    'public.my_book_answers()',
    'public.my_intro_track_set(text)',
    'public.my_marketing_consent_set(boolean)',
    'public.my_book_answers_hold(jsonb)'];
  v_names  constant text[] := array[
    'my_settings', 'my_book_answers', 'my_intro_track_set', 'my_marketing_consent_set', 'my_book_answers_hold'];
  v_nargs  constant integer[] := array[0, 0, 1, 1, 1];
  v_sig    text;
  v_fn     record;
  v_n      bigint;
  v_cfg    text;
  v_ok     boolean;
begin
  for i in 1 .. 5 loop
    v_sig := v_sigs[i];
    if pg_catalog.to_regprocedure(v_sig) is null then
      raise exception 'b3c 자기 점검 실패: 함수 % 가 없음', v_sig;
    end if;

    select pg_catalog.count(*) into v_n
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_names[i];
    if v_n <> 1 then
      raise exception 'b3c 자기 점검 실패: public.% 이라는 이름의 함수가 % 개(1이어야 함)', v_names[i], v_n;
    end if;

    select p.prosecdef, p.provolatile, p.pronargs, p.prorettype, p.proconfig, p.proowner, p.proacl
      into v_fn
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(v_sig);

    if v_fn.prosecdef is not true then
      raise exception 'b3c 자기 점검 실패: 함수 % 가 security definer 가 아님', v_sig;
    end if;
    if v_fn.provolatile <> 'v' then
      raise exception 'b3c 자기 점검 실패: 함수 % 가 volatile 이 아님', v_sig;
    end if;
    if v_fn.pronargs <> v_nargs[i] then
      raise exception 'b3c 자기 점검 실패: 함수 % 의 인자 수가 % (기대 %)', v_sig, v_fn.pronargs, v_nargs[i];
    end if;
    if v_fn.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype then
      raise exception 'b3c 자기 점검 실패: 함수 % 의 반환형이 jsonb 가 아님', v_sig;
    end if;

    -- search_path 가 비어 있는가(설정 항목이 search_path 하나이고 값이 빈 글자)
    v_ok := false;
    if v_fn.proconfig is not null and pg_catalog.array_length(v_fn.proconfig, 1) = 1 then
      v_cfg := v_fn.proconfig[1];
      if pg_catalog.strpos(v_cfg, 'search_path=') = 1
         and pg_catalog.btrim(pg_catalog.substr(v_cfg, 13), '"''') = '' then
        v_ok := true;
      end if;
    end if;
    if not v_ok then
      raise exception 'b3c 자기 점검 실패: 함수 % 의 search_path 가 비어 있지 않음', v_sig;
    end if;

    -- 실행 권한: authenticated 만
    if pg_catalog.has_function_privilege('public'::pg_catalog.name, v_sig, 'EXECUTE') then
      raise exception 'b3c 자기 점검 실패: 함수 % 에 PUBLIC 실행 권한이 남아 있음', v_sig;
    end if;
    if pg_catalog.has_function_privilege('anon'::pg_catalog.name, v_sig, 'EXECUTE') then
      raise exception 'b3c 자기 점검 실패: 함수 % 에 anon 실행 권한이 있음', v_sig;
    end if;
    if pg_catalog.has_function_privilege('service_role'::pg_catalog.name, v_sig, 'EXECUTE') then
      raise exception 'b3c 자기 점검 실패: 함수 % 에 service_role 실행 권한이 있음', v_sig;
    end if;
    if not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, v_sig, 'EXECUTE') then
      raise exception 'b3c 자기 점검 실패: 함수 % 에 authenticated 실행 권한이 없음', v_sig;
    end if;

    -- 권한 목록에 소유자와 authenticated 말고 다른 받는 쪽이 없는가(PUBLIC 은 받는 쪽 번호 0)
    select pg_catalog.count(*) into v_n
      from pg_catalog.aclexplode(v_fn.proacl) a
     where a.grantee <> v_fn.proowner
       and a.grantee <> (select r.oid from pg_catalog.pg_roles r where r.rolname = 'authenticated');
    if v_n <> 0 then
      raise exception 'b3c 자기 점검 실패: 함수 % 의 권한 목록에 소유자·authenticated 말고 % 건이 더 있음', v_sig, v_n;
    end if;

    -- 공통 확인의 예외에 이 함수가 들어가지 않았는가(그 함수는 이 파일이 건드리지 않는다 — 읽기만)
    select pg_catalog.count(*) into v_n
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('security_private.check_api_request()')
       and pg_catalog.strpos(p.prosrc, v_names[i]) > 0;
    if v_n <> 0 then
      raise exception 'b3c 자기 점검 실패: security_private.check_api_request() 의 본문에 % 이 있음(예외에 추가하면 안 된다)', v_names[i];
    end if;
  end loop;

  -- 이 마이그레이션이 만든 이름의 함수는 정확히 다섯(인자가 다른 것이 섞이지 않았다)
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (v_names);
  if v_n <> 5 then
    raise exception 'b3c 자기 점검 실패: 이 마이그레이션의 이름을 가진 함수가 % 개(5여야 함)', v_n;
  end if;
end;
$b3c_check$;

commit;
