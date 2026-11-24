-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0: 본인 회원 정보 함수 public.my_profile() (2026-11-24)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 시험 순서는
-- supabase/tests/b3_0_my_profile/절차.md 를 따른다.
--
-- 만드는 것: 공개 함수 하나. 기존 표·열·정책·함수·권한·설정은 하나도 바꾸지 않는다.
--   public.my_profile() returns jsonb        인자 없음. PostgREST 의 POST /rpc/my_profile 로 부른다.
--
-- 누구의 행인가
--   입력을 받지 않는다. 2-가의 비공개 판정 security_private.current_member_id()
--   (살아 있는 로그인 기록 + 회원 대응)가 돌려준 회원번호의 한 행만 읽는다.
--   로그인 계정 번호를 회원번호로 쓰지 않는다. 책 연결·대리 자격은 이 함수의 입력이 아니다.
--
-- 돌려주는 값(한 개의 JSON)
--   {"state":"ok","profile":{"id","name","nickname","email","phone","timezone"}}   정상 회원 — 이 여섯 열만
--   {"state":"blocked"}              차단된 회원(차단을 먼저 본다 — 탈퇴 처리 중과 겹쳐도 blocked)
--   {"state":"withdrawal_pending"}   탈퇴 처리 중(withdrawal_requested_at 이 있음). 이 함수는 탈퇴를 취소하지 않는다
--   {"state":"no_member"}            회원 대응이 없거나, 로그인 기록이 끝났거나 만료됨(둘을 구분하지 않는다)
--   돌려주지 않는 것: 비밀번호, role·level, 탈퇴 사유, 대응표의 값, 수강·신청 정보, 그 밖의 모든 열.
--   이 함수는 아무것도 고치지 않는다(읽기만 한다).
--
-- 응답 머리글
--   함수가 값을 돌려주는 모든 상태(ok·blocked·withdrawal_pending·no_member)에 Cache-Control: private, no-store.
--   함수에 들어오기 전에 거절된 요청(만료된 JWT, 실행 권한 없음)과 아래의 거절(점검·메서드)에는 이 머리글을 기대하지 않는다.
--
-- GET·HEAD
--   my_site_access 와 같이 VOLATILE 로 둔다. 그리고 함수 안에서도 한 번 더 본다: PostgREST 가 알려 주는
--   요청 메서드(request.method)가 POST 가 아니면 회원 정보를 읽기 전에 405 로 끝낸다(SQLSTATE PT405).
--   (이 함수는 쓰기가 없어서, PostgREST 가 GET 을 읽기 전용 트랜잭션으로 실행해 주는 경우에도 막히도록 한 것이다.)
--
-- 점검
--   공통 확인(security_private.check_api_request)의 예외에 이 함수를 추가하지 않는다 — 그 함수는 건드리지 않는다.
--   공통 확인이 걸려 있지 않은 상태에서도 막히도록, 회원 행을 읽기 전에 기존 security_private.request_allowed()
--   를 부른다(새 판정을 만들지 않는다). 참이 아니면 2-가의 점검 거절과 같은 방식(SQLSTATE PT503, message
--   'maintenance' → HTTP 503)으로 끝낸다.
--
-- 소유자 권한으로 읽는 조건(회원 표가 뒤에 잠겨도 돌도록 security definer — 그래서 아래를 고정한다)
--   * search_path 를 비운다. 모든 객체에 스키마를 적는다. 동적 SQL(execute)을 쓰지 않는다.
--   * 서버가 구한 회원번호의 한 행만 읽는다(where u.id = <current_member_id() 의 값>).
--   * 이름을 적은 열만 읽는다(select *·행 전체를 JSON 으로 바꾸기·호출자가 대상을 지정하는 인자 없음).
--   * 기존 표의 권한을 넓히지 않는다(이 파일에 표에 대한 grant 가 없다).
--   주의: 회원 표에 FORCE ROW LEVEL SECURITY 를 걸면 소유자도 정책을 따르게 된다. 그때는 이 함수가 읽을 수 있는
--         정책이 함께 있어야 한다(묶음 5 에서 확인할 것).
--
-- 실행 권한: authenticated 만. PUBLIC·anon·service_role 은 같은 트랜잭션에서 회수한다.
--
-- 전제: 20261122164348_b2a_identity_gate.sql(2-가)이 적용돼 있어야 한다. 아니면 첫 블록에서 멈춘다.
-- 되돌리기: supabase/migrations_rollback/20261124033800_b3_0_my_profile_rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 전제 확인 (하나라도 다르면 아무것도 만들지 않고 멈춘다)
-- ---------------------------------------------------------------------
do $b3_0_pre$
declare
  v_col  record;
  v_type text;
  v_n    bigint;
begin
  -- (가) 2-가의 객체
  if pg_catalog.to_regprocedure('security_private.current_member_id()') is null then
    raise exception 'b3_0 전제 확인 실패: security_private.current_member_id() 가 없음(2-가가 적용돼 있지 않다)';
  end if;
  if pg_catalog.to_regprocedure('security_private.request_allowed()') is null then
    raise exception 'b3_0 전제 확인 실패: security_private.request_allowed() 가 없음(2-가가 적용돼 있지 않다)';
  end if;
  if pg_catalog.to_regprocedure('security_private.check_api_request()') is null then
    raise exception 'b3_0 전제 확인 실패: security_private.check_api_request() 가 없음(2-가가 적용돼 있지 않다)';
  end if;
  if pg_catalog.to_regclass('security_private.member_identity') is null then
    raise exception 'b3_0 전제 확인 실패: security_private.member_identity 가 없음(2-가가 적용돼 있지 않다)';
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('security_private.current_member_id()')
     and p.prorettype = 'pg_catalog.uuid'::pg_catalog.regtype;
  if v_n <> 1 then
    raise exception 'b3_0 전제 확인 실패: security_private.current_member_id() 의 반환형이 uuid 가 아님';
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('security_private.request_allowed()')
     and p.prorettype = 'pg_catalog.bool'::pg_catalog.regtype;
  if v_n <> 1 then
    raise exception 'b3_0 전제 확인 실패: security_private.request_allowed() 의 반환형이 boolean 이 아님';
  end if;

  -- (나) 회원 표와 이 함수가 읽는 열(이름·형)
  if pg_catalog.to_regclass('public.users') is null then
    raise exception 'b3_0 전제 확인 실패: public.users 가 없음';
  end if;
  for v_col in
    select t.col, t.want
      from (
        values
          ('id'::pg_catalog.text,        'uuid'::pg_catalog.text),
          ('name',                       'text'),
          ('nickname',                   'text'),
          ('email',                      'text'),
          ('phone',                      'text'),
          ('timezone',                   'text'),
          ('blocked',                    'boolean'),
          ('withdrawal_requested_at',    'timestamp with time zone')
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
      raise exception 'b3_0 전제 확인 실패: public.users 에 열 % 이 없음', v_col.col;
    end if;
    if v_type is distinct from v_col.want then
      raise exception 'b3_0 전제 확인 실패: public.users.% 의 형이 % (기대 %)', v_col.col, v_type, v_col.want;
    end if;
  end loop;

  -- (다) 같은 이름의 함수가 아직 없다(인자가 다른 것도). 있으면 덮어쓰지 않는다.
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_profile';
  if v_n <> 0 then
    raise exception 'b3_0 전제 확인 실패: public.my_profile 이라는 이름의 함수가 이미 %개 있음. 덮어쓰지 않는다', v_n;
  end if;
end;
$b3_0_pre$;

-- ---------------------------------------------------------------------
-- 1. 공개 함수 (public — PostgREST 로 부른다)
--    set_config 를 쓰므로 volatile 이다(POST 로 부른다). my_site_access 와 같은 방식.
-- ---------------------------------------------------------------------
create function public.my_profile()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b3_0$
declare
  v_method     text;
  v_member     uuid;
  v_id         uuid;
  v_name       text;
  v_nickname   text;
  v_email      text;
  v_phone      text;
  v_timezone   text;
  v_blocked    boolean;
  v_withdrawal timestamptz;
begin
  -- 0. POST 로만. PostgREST 가 알려 주는 요청 메서드가 POST 가 아니면 아무것도 읽지 않고 끝낸다.
  --    (PostgREST 를 거치지 않는 호출에는 이 값이 없다 — 그때는 아래로 간다.)
  v_method := pg_catalog.current_setting('request.method', true);
  if v_method is not null and v_method <> '' and v_method <> 'POST' then
    raise exception using errcode = 'PT405', message = 'method not allowed';
  end if;

  -- 1. 점검: 회원 행을 읽기 전에 기존 판정으로 확인한다(참이 아니면 2-가의 점검 거절과 같은 방식).
  if security_private.request_allowed() is not true then
    raise exception using errcode = 'PT503', message = 'maintenance';
  end if;

  -- 2. 이 함수가 돌려주는 모든 상태에: 중간 저장소에 남지 않도록.
  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  -- 3. 누구인가: 살아 있는 로그인 기록의 회원 대응(2-가의 판정)만.
  v_member := security_private.current_member_id();
  if v_member is null then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  -- 4. 그 회원번호의 한 행, 이름을 적은 열만.
  select u.id, u.name, u.nickname, u.email, u.phone, u.timezone, u.blocked, u.withdrawal_requested_at
    into v_id, v_name, v_nickname, v_email, v_phone, v_timezone, v_blocked, v_withdrawal
    from public.users u
   where u.id = v_member;
  if not found then
    return pg_catalog.jsonb_build_object('state', 'no_member');
  end if;

  -- 5. 차단을 먼저 본다. 그다음 탈퇴 처리 중. 둘 다 회원 정보를 주지 않는다.
  if v_blocked is true then
    return pg_catalog.jsonb_build_object('state', 'blocked');
  end if;
  if v_withdrawal is not null then
    return pg_catalog.jsonb_build_object('state', 'withdrawal_pending');
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'ok',
    'profile', pg_catalog.jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'nickname', v_nickname,
      'email', v_email,
      'phone', v_phone,
      'timezone', v_timezone
    )
  );
end;
$b3_0$;

revoke all on function public.my_profile() from public, anon, authenticated, service_role;
grant execute on function public.my_profile() to authenticated;

-- ---------------------------------------------------------------------
-- 2. 자기 점검 (같은 트랜잭션. 어긋나면 예외 → 전체 되돌아감)
--    이 점검의 통과는 supabase/tests/b3_0_my_profile/절차.md 의 시험을 대신하지 않는다.
-- ---------------------------------------------------------------------
do $b3_0_check$
declare
  v_sig    constant text := 'public.my_profile()';
  v_fn     record;
  v_n      bigint;
  v_cfg    text;
  v_ok     boolean;
begin
  if pg_catalog.to_regprocedure(v_sig) is null then
    raise exception 'b3_0 자기 점검 실패: 함수 % 가 없음', v_sig;
  end if;

  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_profile';
  if v_n <> 1 then
    raise exception 'b3_0 자기 점검 실패: public.my_profile 이라는 이름의 함수가 % 개(1이어야 함)', v_n;
  end if;

  select p.prosecdef, p.provolatile, p.pronargs, p.prorettype, p.proconfig, p.proowner, p.proacl
    into v_fn
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(v_sig);

  if v_fn.prosecdef is not true then
    raise exception 'b3_0 자기 점검 실패: 함수 % 가 security definer 가 아님', v_sig;
  end if;
  if v_fn.provolatile <> 'v' then
    raise exception 'b3_0 자기 점검 실패: 함수 % 가 volatile 이 아님(GET·HEAD 로 불릴 수 있다)', v_sig;
  end if;
  if v_fn.pronargs <> 0 then
    raise exception 'b3_0 자기 점검 실패: 함수 % 에 인자가 있음', v_sig;
  end if;
  if v_fn.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype then
    raise exception 'b3_0 자기 점검 실패: 함수 % 의 반환형이 jsonb 가 아님', v_sig;
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
    raise exception 'b3_0 자기 점검 실패: 함수 % 의 search_path 가 비어 있지 않음', v_sig;
  end if;

  -- 실행 권한: authenticated 만
  if pg_catalog.has_function_privilege('public'::pg_catalog.name, v_sig, 'EXECUTE') then
    raise exception 'b3_0 자기 점검 실패: 함수 % 에 PUBLIC 실행 권한이 남아 있음', v_sig;
  end if;
  if pg_catalog.has_function_privilege('anon'::pg_catalog.name, v_sig, 'EXECUTE') then
    raise exception 'b3_0 자기 점검 실패: 함수 % 에 anon 실행 권한이 있음', v_sig;
  end if;
  if pg_catalog.has_function_privilege('service_role'::pg_catalog.name, v_sig, 'EXECUTE') then
    raise exception 'b3_0 자기 점검 실패: 함수 % 에 service_role 실행 권한이 있음', v_sig;
  end if;
  if not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, v_sig, 'EXECUTE') then
    raise exception 'b3_0 자기 점검 실패: 함수 % 에 authenticated 실행 권한이 없음', v_sig;
  end if;

  -- 권한 목록에 소유자와 authenticated 말고 다른 받는 쪽이 없는가(PUBLIC 은 받는 쪽 번호 0)
  select pg_catalog.count(*) into v_n
    from pg_catalog.aclexplode(v_fn.proacl) a
   where a.grantee <> v_fn.proowner
     and a.grantee <> (select r.oid from pg_catalog.pg_roles r where r.rolname = 'authenticated');
  if v_n <> 0 then
    raise exception 'b3_0 자기 점검 실패: 함수 % 의 권한 목록에 소유자·authenticated 말고 % 건이 더 있음', v_sig, v_n;
  end if;

  -- 공통 확인의 예외에 이 함수가 들어가지 않았는가(그 함수는 이 파일이 건드리지 않는다 — 읽기만)
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('security_private.check_api_request()')
     and pg_catalog.strpos(p.prosrc, 'my_profile') > 0;
  if v_n <> 0 then
    raise exception 'b3_0 자기 점검 실패: security_private.check_api_request() 의 본문에 my_profile 이 있음(예외에 추가하면 안 된다)';
  end if;
end;
$b3_0_check$;

commit;
