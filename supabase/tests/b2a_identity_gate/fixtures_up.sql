-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-가 시험 전용 객체 올리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서와 기대 결과는 같은 폴더의 절차.md 를 따른다.
-- (1차 판 fa172b2 의 이 파일은 브레인방이 시험 프로젝트에서 실행했다. 2차에서 바뀐 곳은
--  zz_b2a_call_invoker 의 'current_session' 갈래 하나이고, 그 갈래는 아직 실행된 적이 없다.)
-- 운영에는 절대 실행하지 않는다(비로그인도 고칠 수 있는 표와 판정 값을 돌려주는 함수가 생긴다).
--
-- 전제: 20261122164348_b2a_identity_gate.sql 이 먼저 적용돼 있어야 한다.
-- 실행 방법: 이 파일을 실행하는 같은 접속에서, 아래처럼 대상 확인 값을 먼저 정한다
--            (값이 없거나 다르면 첫 블록에서 멈춘다. 운영에 잘못 실행하는 일을 막는 확인이다).
--
--   set b2a.test_project_ref = 'hmncdheiwqwekdbtijar';
--
-- 만드는 것(전부 public, 이름은 zz_b2a_ 로 시작)
--   표   zz_b2a_open_row        누구나(비로그인 포함) 읽고 고칠 수 있는 한 줄. 점검 중 거절이 "권한"이 아니라
--                               "공통 확인" 때문임을 가리는 기준.
--   표   zz_b2a_admin_flag      관리자만 바꿀 수 있는 표식(정책: is_current_admin()).
--   표   zz_b2a_member_row      본인 행만 보이는 표(정책: current_member_id()). 회원번호 열 uuid.
--   표   zz_b2a_member_row_text 본인 행만 보이는 표(정책: current_member_id_text()). 회원번호 열 글자형.
--   함수 zz_b2a_probe()                 판정 값 5개를 그대로 돌려준다(security definer — 어느 자격으로든 값이 나온다).
--   함수 zz_b2a_call_invoker(text)      부르는 역할의 권한 그대로 비공개 함수 하나를 불러 본다(security invoker).
--                                       'current_session' 은 어느 역할로 불러도 42501 이어야 한다(도우미는 실행 권한 없음).
--   함수 zz_b2a_resolve_grant_invoker(text, text)  부르는 역할의 권한 그대로 resolve_grant 를 부른다.
--   함수 zz_b2a_private_table_probe()   부르는 역할의 권한 그대로 비공개 표 5개에 읽기·넣기·고치기·지우기를 시도한다
--                                       (성공해도 실제 변화가 생기지 않는 문장만 쓴다).
-- 내리기: fixtures_down.sql
-- =====================================================================

begin;

-- 0. 대상 확인(실행하는 사람이 시험 프로젝트임을 직접 적었는지)
do $zz_b2a$
begin
  if coalesce(pg_catalog.current_setting('b2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b2a 시험 객체 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2a.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 먼저 실행할 것';
  end if;
  if pg_catalog.to_regprocedure('security_private.request_allowed()') is null then
    raise exception 'zz_b2a 시험 객체 중단: b2a_identity_gate 마이그레이션이 적용돼 있지 않다';
  end if;
end;
$zz_b2a$;

-- ---------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------

-- 1-1. 누구나 읽고 고칠 수 있는 한 줄
create table public.zz_b2a_open_row (
  id         integer     not null,
  note       text        not null default '',
  updated_at timestamptz not null default pg_catalog.now(),
  constraint zz_b2a_open_row_pkey primary key (id)
);
insert into public.zz_b2a_open_row (id, note) values (1, 'init');
alter table public.zz_b2a_open_row enable row level security;
create policy zz_b2a_open_row_select on public.zz_b2a_open_row
  for select to anon, authenticated
  using (true);
create policy zz_b2a_open_row_update on public.zz_b2a_open_row
  for update to anon, authenticated
  using (true)
  with check (true);
revoke all on table public.zz_b2a_open_row from public, anon, authenticated, service_role;
grant select, update on table public.zz_b2a_open_row to anon, authenticated, service_role;

-- 1-2. 관리자만 바꿀 수 있는 표식 (정책에서 함수를 직접 부르는 형태)
create table public.zz_b2a_admin_flag (
  id         integer     not null,
  flag       text        not null default 'off',
  updated_at timestamptz not null default pg_catalog.now(),
  constraint zz_b2a_admin_flag_pkey primary key (id)
);
insert into public.zz_b2a_admin_flag (id, flag) values (1, 'off');
alter table public.zz_b2a_admin_flag enable row level security;
create policy zz_b2a_admin_flag_select on public.zz_b2a_admin_flag
  for select to authenticated
  using (true);
create policy zz_b2a_admin_flag_update on public.zz_b2a_admin_flag
  for update to authenticated
  using (security_private.is_current_admin())
  with check (security_private.is_current_admin());
revoke all on table public.zz_b2a_admin_flag from public, anon, authenticated, service_role;
grant select, update on table public.zz_b2a_admin_flag to authenticated;

-- 1-3. 본인 행만 보이는 표 — 회원번호 열 uuid (정책에서 (select …) 로 감싸 부르는 형태)
--      service_role 에는 점검 중 서비스 열쇠 쓰기 거절을 확인하려고 읽기·쓰기를 준다.
create table public.zz_b2a_member_row (
  id         uuid        not null default pg_catalog.gen_random_uuid(),
  member_id  uuid        not null,
  note       text        not null default '',
  updated_at timestamptz not null default pg_catalog.now(),
  constraint zz_b2a_member_row_pkey primary key (id)
);
alter table public.zz_b2a_member_row enable row level security;
create policy zz_b2a_member_row_select on public.zz_b2a_member_row
  for select to authenticated
  using (member_id = (select security_private.current_member_id()));
create policy zz_b2a_member_row_update on public.zz_b2a_member_row
  for update to authenticated
  using (member_id = (select security_private.current_member_id()))
  with check (member_id = (select security_private.current_member_id()));
revoke all on table public.zz_b2a_member_row from public, anon, authenticated, service_role;
grant select, update on table public.zz_b2a_member_row to authenticated;
grant select, insert, update, delete on table public.zz_b2a_member_row to service_role;

-- 1-4. 본인 행만 보이는 표 — 회원번호 열 글자형
create table public.zz_b2a_member_row_text (
  id         uuid        not null default pg_catalog.gen_random_uuid(),
  member_id  text        not null,
  note       text        not null default '',
  updated_at timestamptz not null default pg_catalog.now(),
  constraint zz_b2a_member_row_text_pkey primary key (id)
);
alter table public.zz_b2a_member_row_text enable row level security;
create policy zz_b2a_member_row_text_select on public.zz_b2a_member_row_text
  for select to authenticated
  using (member_id = (select security_private.current_member_id_text()));
create policy zz_b2a_member_row_text_update on public.zz_b2a_member_row_text
  for update to authenticated
  using (member_id = (select security_private.current_member_id_text()))
  with check (member_id = (select security_private.current_member_id_text()));
revoke all on table public.zz_b2a_member_row_text from public, anon, authenticated, service_role;
grant select, update on table public.zz_b2a_member_row_text to authenticated;

-- ---------------------------------------------------------------------
-- 2. 함수
-- ---------------------------------------------------------------------

-- 2-1. 판정 값을 그대로 돌려준다. security definer 이므로 비로그인·서비스 열쇠로 불러도 값이 나온다
--      (자격 값 request.jwt.claims 는 실행 역할이 바뀌어도 그대로다).
create function public.zz_b2a_probe()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $zz_b2a$
  select pg_catalog.jsonb_build_object(
           'member_id',       security_private.current_member_id(),
           'member_id_text',  security_private.current_member_id_text(),
           'member_email',    security_private.current_member_email(),
           'is_admin',        security_private.is_current_admin(),
           'request_allowed', security_private.request_allowed()
         );
$zz_b2a$;
revoke all on function public.zz_b2a_probe() from public, anon, authenticated, service_role;
grant execute on function public.zz_b2a_probe() to anon, authenticated, service_role;

-- 2-2. 부르는 역할의 권한 그대로 비공개 함수 하나를 불러 본다.
--      실행 권한이 없으면 예외를 잡아 {"ok": false, "sqlstate": "42501", …} 로 돌려준다.
create function public.zz_b2a_call_invoker(p_fn text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $zz_b2a$
declare
  v_value jsonb;
begin
  if p_fn = 'current_member_id' then
    v_value := pg_catalog.to_jsonb(security_private.current_member_id());
  elsif p_fn = 'current_member_id_text' then
    v_value := pg_catalog.to_jsonb(security_private.current_member_id_text());
  elsif p_fn = 'current_member_email' then
    v_value := pg_catalog.to_jsonb(security_private.current_member_email());
  elsif p_fn = 'is_current_admin' then
    v_value := pg_catalog.to_jsonb(security_private.is_current_admin());
  elsif p_fn = 'request_allowed' then
    v_value := pg_catalog.to_jsonb(security_private.request_allowed());
  elsif p_fn = 'check_api_request' then
    perform security_private.check_api_request();
    v_value := null;
  elsif p_fn = 'current_session' then
    -- 도우미는 어떤 역할에도 실행 권한이 없다. 여기까지 와서 값이 나오면 권한이 열려 있다는 뜻이다.
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cs)), '[]'::pg_catalog.jsonb)
      into v_value
      from security_private.current_session() as cs;
  else
    return pg_catalog.jsonb_build_object('fn', p_fn, 'ok', false, 'error', 'unknown_fn');
  end if;

  return pg_catalog.jsonb_build_object('fn', p_fn, 'ok', true, 'value', v_value);
exception when others then
  return pg_catalog.jsonb_build_object('fn', p_fn, 'ok', false, 'sqlstate', sqlstate, 'message', sqlerrm);
end;
$zz_b2a$;
revoke all on function public.zz_b2a_call_invoker(text) from public, anon, authenticated, service_role;
grant execute on function public.zz_b2a_call_invoker(text) to anon, authenticated, service_role;

-- 2-3. 부르는 역할의 권한 그대로 resolve_grant 를 부른다(service_role 만 값이 나와야 한다).
create function public.zz_b2a_resolve_grant_invoker(p_credential_digest text, p_action text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $zz_b2a$
declare
  v_rows jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::pg_catalog.jsonb)
    into v_rows
    from security_private.resolve_grant(p_credential_digest, p_action) as r;

  return pg_catalog.jsonb_build_object('ok', true, 'rows', v_rows);
exception when others then
  return pg_catalog.jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm);
end;
$zz_b2a$;
revoke all on function public.zz_b2a_resolve_grant_invoker(text, text) from public, anon, authenticated, service_role;
grant execute on function public.zz_b2a_resolve_grant_invoker(text, text) to anon, authenticated, service_role;

-- 2-4. 부르는 역할의 권한 그대로 비공개 표 5개에 읽기·넣기·고치기·지우기를 시도한다.
--      권한이 (잘못) 있어도 실제 변화가 생기지 않는 문장만 쓴다:
--        넣기 = default values (모든 표에 기본값 없는 NOT NULL 열이 있어 권한이 있어도 실패한다)
--        고치기·지우기 = where false
--      결과는 표마다 {"select": "…", "insert": "…", "update": "…", "delete": "…"}.
--      기대: 전부 "42501: permission denied for table …". "ok" 나 다른 번호가 나오면 권한이 열려 있다는 뜻이다.
create function public.zz_b2a_private_table_probe()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $zz_b2a$
declare
  v_tables  constant text[] := array['member_identity', 'admin_principal', 'access_grant', 'site_state', 'maintenance_exception'];
  v_columns constant text[] := array['created_at', 'created_at', 'issued_at', 'updated_at', 'expires_at'];
  v_idx     integer;
  v_table   text;
  v_column  text;
  v_state   text;
  v_one     jsonb;
  v_result  jsonb := '{}'::pg_catalog.jsonb;
begin
  for v_idx in 1 .. 5 loop
    v_table  := v_tables[v_idx];
    v_column := v_columns[v_idx];
    v_one    := '{}'::pg_catalog.jsonb;

    begin
      execute pg_catalog.format('select pg_catalog.count(*) from security_private.%I', v_table);
      v_state := 'ok';
    exception when others then
      v_state := sqlstate || ': ' || sqlerrm;
    end;
    v_one := v_one || pg_catalog.jsonb_build_object('select', v_state);

    begin
      execute pg_catalog.format('insert into security_private.%I default values', v_table);
      v_state := 'ok';
    exception when others then
      v_state := sqlstate || ': ' || sqlerrm;
    end;
    v_one := v_one || pg_catalog.jsonb_build_object('insert', v_state);

    begin
      execute pg_catalog.format('update security_private.%I set %I = default where false', v_table, v_column);
      v_state := 'ok';
    exception when others then
      v_state := sqlstate || ': ' || sqlerrm;
    end;
    v_one := v_one || pg_catalog.jsonb_build_object('update', v_state);

    begin
      execute pg_catalog.format('delete from security_private.%I where false', v_table);
      v_state := 'ok';
    exception when others then
      v_state := sqlstate || ': ' || sqlerrm;
    end;
    v_one := v_one || pg_catalog.jsonb_build_object('delete', v_state);

    v_result := v_result || pg_catalog.jsonb_build_object(v_table, v_one);
  end loop;

  return v_result;
end;
$zz_b2a$;
revoke all on function public.zz_b2a_private_table_probe() from public, anon, authenticated, service_role;
grant execute on function public.zz_b2a_private_table_probe() to anon, authenticated, service_role;

commit;
