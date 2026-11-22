-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-가: 회원·권한 판정 기반 (2026-11-23)
--
-- 만드는 것(전부 새 객체. 기존 표·열·정책·함수·권한은 하나도 바꾸지 않는다)
--   * 비공개 스키마 security_private (PostgREST 노출 스키마에 넣지 않는다)
--   * 표 5개: member_identity, admin_principal, access_grant, site_state, maintenance_exception
--   * 비공개 함수 8개: current_session(로그인 상태 판정 도우미 — 어떤 역할에도 실행 권한 없음),
--     current_member_id, current_member_id_text, current_member_email,
--     is_current_admin, request_allowed, check_api_request, resolve_grant
--   * 공개 함수 2개: public.site_status, public.my_site_access
--   * 파일 끝의 자기 점검(DO 블록). 어긋나면 예외로 전체가 되돌아간다.
--
-- 이 파일에 넣지 않은 것
--   * pgrst.db_pre_request 설정(alter role authenticator …). 운영에 넣는 시점이 다르다.
--     적용·원복 명령은 supabase/tests/b2a_identity_gate/절차.md 에 있다.
--   * 대리·책 자격의 발급과 중계, 가입·비밀번호 기능, 변경 기록 표.
--
-- 알아 둘 것
--   * check_api_request()는 PostgREST를 거치는 요청에만 걸린다(설정을 적용했을 때).
--     DB 안에서 도는 예약(pg_cron)·트리거·직접 SQL은 이 확인을 거치지 않는다.
--     파일(Storage)·Edge 함수도 거치지 않으므로 같은 판정 함수를 각자 불러야 한다.
--   * 점검 중에는 service_role도 통과하지 않는다. 서비스 열쇠로 해야 하는 일을 어떻게 허용할지는
--     뒤 계약에서 따로 설계한다.
--   * 외래키 때문에 적용하는 순간 auth.users 와 public.users 에 잠깐 잠금이 걸린다
--     (그 표의 열·정책·권한은 바뀌지 않는다).
--   * 새 표가 기존 삭제 동작을 막지 않는다. 새 표의 외래키는 전부 on delete cascade 다:
--     회원 행(public.users)이 지워지면 그 회원의 연결(member_identity)과 그 회원을 대상으로 한
--     사용 자격(access_grant)이 함께 지워지고, 로그인 계정(auth.users)이 지워지면 그 계정의 연결·
--     명부·예외 명단과 그 계정이 행위자인 대리 자격이 함께 지워진다.
--   * "지금 살아 있는 로그인 상태"는 current_session() 한 곳에서만 정한다
--     (auth.sessions 에 행이 있고 not_after 가 NULL 이거나 지금보다 뒤).
--   * 되돌리기: supabase/migrations_rollback/20261122164348_b2a_identity_gate_rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 스키마 (이미 있으면 실패한다 — if not exists 를 쓰지 않는다)
-- ---------------------------------------------------------------------
create schema security_private;

-- ---------------------------------------------------------------------
-- 2. 표 5개
-- ---------------------------------------------------------------------

-- 로그인 계정 ↔ 회원번호 1:1. 이메일은 복사하지 않는다.
-- 회원 행이 지워지면 연결도 함께 지워진다(남은 로그인 계정은 "대응 없는 계정"이 된다).
create table security_private.member_identity (
  auth_user_id        uuid        not null,
  member_id           uuid        not null,
  password_migrated   boolean     not null default false,
  password_changed_at timestamptz,
  renotify_on         date,
  created_at          timestamptz not null default pg_catalog.now(),
  constraint member_identity_pkey primary key (auth_user_id),
  constraint member_identity_member_id_key unique (member_id),
  constraint member_identity_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete cascade,
  constraint member_identity_member_id_fkey
    foreign key (member_id) references public.users (id) on delete cascade
);

-- 관리자 명부. 회원 대응표와 별개.
create table security_private.admin_principal (
  auth_user_id uuid        not null,
  enabled      boolean     not null default true,
  created_at   timestamptz not null default pg_catalog.now(),
  constraint admin_principal_pkey primary key (auth_user_id),
  constraint admin_principal_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete cascade
);

-- 대리·책 공통 장부(서버 중계 전용). 자격 원문은 저장하지 않고 지문(sha-256 16진수)만 둔다.
-- 발급·중계 자체는 이 계약 범위 밖이다.
-- 이 표는 "지금 쓸 수 있는 자격" 장부이지 감사 기록이 아니다. 대상 회원이나 행위자 계정이 지워지면
-- 그 자격도 함께 지워진다. 감사 기록은 뒤 계약의 별도 표에 두며, 이 삭제에 딸려 지워지면 안 된다.
create table security_private.access_grant (
  id                 uuid        not null default pg_catalog.gen_random_uuid(),
  credential_digest  text        not null,
  purpose            text        not null,
  actor_auth_user_id uuid,
  target_member_id   uuid        not null,
  issued_at          timestamptz not null default pg_catalog.now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  constraint access_grant_pkey primary key (id),
  constraint access_grant_credential_digest_key unique (credential_digest),
  constraint access_grant_credential_digest_check
    check (credential_digest ~ '^[0-9a-f]{64}$'),
  constraint access_grant_purpose_check
    check (purpose in ('proxy', 'book')),
  constraint access_grant_expires_after_issued_check
    check (expires_at > issued_at),
  -- 대리(proxy)는 행위자가 반드시 있고, 길어도 30분이다.
  constraint access_grant_proxy_check
    check (
      purpose <> 'proxy'
      or (
        actor_auth_user_id is not null
        and expires_at <= issued_at + interval '30 minutes'
      )
    ),
  constraint access_grant_actor_auth_user_id_fkey
    foreign key (actor_auth_user_id) references auth.users (id) on delete cascade,
  constraint access_grant_target_member_id_fkey
    foreign key (target_member_id) references public.users (id) on delete cascade
);

comment on table security_private.access_grant is
  '지금 쓸 수 있는 자격 장부(감사 기록 아님). 대상 회원·행위자 계정이 지워지면 함께 지워진다. 감사 기록은 별도 표에 두며 이 삭제에 딸려 지워지면 안 된다.';

-- 점검 스위치 한 줄. 시각이 지났다고 스스로 phase가 바뀌지 않는다.
-- "그 번호의 점검이 끝났다"는 last_ended_maintenance_id 로 명시한다.
create table security_private.site_state (
  id                        integer     not null,
  maintenance_id            integer     not null default 0,
  phase                     text        not null default 'normal',
  starts_at                 timestamptz,
  message                   text,
  last_ended_maintenance_id integer,
  last_ended_at             timestamptz,
  updated_at                timestamptz not null default pg_catalog.now(),
  constraint site_state_pkey primary key (id),
  constraint site_state_single_row_check check (id = 1),
  constraint site_state_phase_check check (phase in ('normal', 'notice', 'maintenance'))
);

insert into security_private.site_state (id) values (1);

-- 그 점검 번호에서만 통과시킬 시험용 회원.
create table security_private.maintenance_exception (
  maintenance_id integer not null,
  auth_user_id   uuid    not null,
  expires_at     timestamptz,
  constraint maintenance_exception_pkey primary key (maintenance_id, auth_user_id),
  constraint maintenance_exception_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete cascade
);

-- RLS 켬, 정책 없음(소유자가 아닌 역할은 권한이 있어도 한 줄도 못 본다).
alter table security_private.member_identity       enable row level security;
alter table security_private.admin_principal       enable row level security;
alter table security_private.access_grant          enable row level security;
alter table security_private.site_state            enable row level security;
alter table security_private.maintenance_exception enable row level security;

-- ---------------------------------------------------------------------
-- 3. 판정 함수 (전부 security definer, search_path 비움, 이름마다 스키마)
--    자격(request.jwt.claims)과 auth.sessions 는 도우미 current_session() 한 곳에서만 읽는다.
--    회원 판정·관리자 판정·점검 예외 판정은 그 도우미의 결과만 쓰고 자격을 직접 읽지 않는다.
--    auth.sessions 에 대한 권한을 다른 역할에 주지 않는다.
-- ---------------------------------------------------------------------

-- 지금 살아 있는 로그인 상태(비공개 도우미). 0행 또는 1행.
--   * 자격 값 request.jwt.claims 를 jsonb로 읽는다. 값이 없거나 비었거나 jsonb가 아니면 0행,
--     sub·session_id가 빠졌거나 uuid 모양이 아니면 0행(예외를 내지 않는다).
--   * auth.sessions 에 id = session_id·user_id = sub 인 행이 있고,
--     not_after 가 NULL 이거나 지금보다 뒤일 때만 1행(not_after = 지금 은 만료다).
--   * 돌려주는 값: 계정 번호, 로그인 상태 번호, 자격에 적힌 aal, 로그인 상태 행의 aal.
--     aal 열의 형(열거형·글자형)에 기대지 않도록 글자로 바꿔 돌려준다.
--   * 실행 권한은 PUBLIC·anon·authenticated·service_role 어디에도 주지 않는다.
--     아래 판정 함수(소유자 권한으로 실행) 안에서만 불린다.
create function security_private.current_session()
returns table (auth_user_id uuid, session_id uuid, claim_aal text, session_aal text)
language plpgsql
stable
security definer
set search_path = ''
as $b2a$
declare
  v_raw      text;
  v_claims   jsonb;
  v_sub_text text;
  v_sid_text text;
  v_sub      uuid;
  v_sid      uuid;
begin
  v_raw := pg_catalog.current_setting('request.jwt.claims', true);
  if v_raw is null or v_raw = '' then
    return;
  end if;

  begin
    v_claims := v_raw::pg_catalog.jsonb;
  exception when others then
    return;
  end;

  v_sub_text := v_claims ->> 'sub';
  v_sid_text := v_claims ->> 'session_id';
  if v_sub_text is null or v_sid_text is null then
    return;
  end if;
  if v_sub_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or v_sid_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return;
  end if;
  v_sub := v_sub_text::pg_catalog.uuid;
  v_sid := v_sid_text::pg_catalog.uuid;

  return query
    select s.user_id,
           s.id,
           v_claims ->> 'aal',
           s.aal::pg_catalog.text
      from auth.sessions s
     where s.id = v_sid
       and s.user_id = v_sub
       and (s.not_after is null or s.not_after > pg_catalog.now());
end;
$b2a$;

revoke all on function security_private.current_session() from public, anon, authenticated, service_role;

-- 현재 회원번호. 살아 있는 로그인 상태가 있고 그 계정이 대응표에 있으면 그 member_id.
-- 그 밖(비로그인, 대응 없음, 로그아웃한 자격, 만료된 로그인 상태)은 NULL.
create function security_private.current_member_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $b2a$
declare
  v_user   uuid;
  v_member uuid;
begin
  select cs.auth_user_id
    into v_user
    from security_private.current_session() cs;
  if v_user is null then
    return null;
  end if;

  select mi.member_id
    into v_member
    from security_private.member_identity mi
   where mi.auth_user_id = v_user;

  return v_member;
end;
$b2a$;

revoke all on function security_private.current_member_id() from public, anon, authenticated, service_role;
grant execute on function security_private.current_member_id() to authenticated;

-- 위 값의 글자형(회원번호 열이 글자형인 표용).
create function security_private.current_member_id_text()
returns text
language sql
stable
security definer
set search_path = ''
as $b2a$
  select security_private.current_member_id()::pg_catalog.text;
$b2a$;

revoke all on function security_private.current_member_id_text() from public, anon, authenticated, service_role;
grant execute on function security_private.current_member_id_text() to authenticated;

-- 현재 회원의 이메일(public.users.email). 회원번호가 NULL이면 NULL.
create function security_private.current_member_email()
returns text
language sql
stable
security definer
set search_path = ''
as $b2a$
  select u.email
    from public.users u
   where u.id = security_private.current_member_id();
$b2a$;

revoke all on function security_private.current_member_email() from public, anon, authenticated, service_role;
grant execute on function security_private.current_member_email() to authenticated;

-- 관리자 여부. 명부에 enabled로 있음 AND 자격의 aal = 'aal2'
-- AND 살아 있는 로그인 상태(같은 계정·같은 session_id, 만료 전)의 aal 이 지금 aal2. 항상 참/거짓(NULL 없음).
create function security_private.is_current_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $b2a$
declare
  v_user        uuid;
  v_claim_aal   text;
  v_session_aal text;
begin
  select cs.auth_user_id, cs.claim_aal, cs.session_aal
    into v_user, v_claim_aal, v_session_aal
    from security_private.current_session() cs;
  if v_user is null then
    return false;
  end if;

  -- 이중 확인: 자격에 적힌 aal 과 로그인 상태 행의 aal 이 둘 다 aal2 여야 한다.
  if v_claim_aal is distinct from 'aal2' then
    return false;
  end if;
  if v_session_aal is distinct from 'aal2' then
    return false;
  end if;

  if not exists (
       select 1
         from security_private.admin_principal ap
        where ap.auth_user_id = v_user
          and ap.enabled
     ) then
    return false;
  end if;

  return true;
end;
$b2a$;

revoke all on function security_private.is_current_admin() from public, anon, authenticated, service_role;
grant execute on function security_private.is_current_admin() to authenticated;

-- 지금 이 요청을 통과시켜도 되는가. 항상 참/거짓(NULL 없음).
--   * site_state 행이 없으면 거짓.
--   * phase가 'maintenance'가 아니면 참.
--   * 'maintenance'면: 관리자(6자리 완료) → 참 / 현재 점검 번호의 예외 명단에 있고(만료 전)
--     그 계정의 로그인 상태가 살아 있음(current_session) → 참 / 그 밖은 전부 거짓.
--     service_role도 거짓이다(같은 열쇠를 쓰는 호출자를 가릴 수 없으므로 일괄 통과시키지 않는다).
create function security_private.request_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $b2a$
declare
  v_phase          text;
  v_maintenance_id integer;
  v_user           uuid;
begin
  select ss.phase, ss.maintenance_id
    into v_phase, v_maintenance_id
    from security_private.site_state ss
   where ss.id = 1;
  if not found then
    return false;
  end if;

  -- phase는 NOT NULL이다. 만에 하나 NULL이면 이 조건이 참이 되지 않아 아래 점검 판정으로 간다.
  if v_phase <> 'maintenance' then
    return true;
  end if;

  if security_private.is_current_admin() is true then
    return true;
  end if;

  select cs.auth_user_id
    into v_user
    from security_private.current_session() cs;
  if v_user is null then
    return false;
  end if;

  if not exists (
       select 1
         from security_private.maintenance_exception me
        where me.maintenance_id = v_maintenance_id
          and me.auth_user_id = v_user
          and (me.expires_at is null or me.expires_at > pg_catalog.now())
     ) then
    return false;
  end if;

  return true;
end;
$b2a$;

revoke all on function security_private.request_allowed() from public, anon, authenticated, service_role;
grant execute on function security_private.request_allowed() to anon, authenticated, service_role;

-- PostgREST 공통 확인(pgrst.db_pre_request 로 연결했을 때 요청마다 불린다 — 연결은 이 파일에서 하지 않는다).
-- 공개 상태 조회 두 개는 항상 통과. 그 밖에는 request_allowed()가 명확히 참일 때만 통과.
-- DB 안에서 도는 예약·트리거·직접 SQL은 이 함수를 거치지 않는다.
create function security_private.check_api_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $b2a$
declare
  v_path text;
begin
  v_path := pg_catalog.current_setting('request.path', true);
  if v_path is not null and (v_path = '/rpc/site_status' or v_path = '/rpc/my_site_access') then
    return;
  end if;

  if security_private.request_allowed() is true then
    return;
  end if;

  raise exception using errcode = 'PT503', message = 'maintenance';
end;
$b2a$;

revoke all on function security_private.check_api_request() from public, anon, authenticated, service_role;
grant execute on function security_private.check_api_request() to anon, authenticated, service_role;

-- 장부 확인(서버 중계 전용, service_role만 실행).
-- 주의: 이 함수가 돌려주는 1행은 "장부에 살아 있는 기록이 있다"는 확인일 뿐,
--       실제 자료 접근 승인이 아니다. 실제 업무의 분류와 허용은 중계 계약에서 서버가 한다.
--       동작 이름(…_write 등)은 장부 확인용 분류일 뿐 쓰기 허가를 뜻하지 않는다.
create function security_private.resolve_grant(p_credential_digest text, p_action text)
returns table (purpose text, actor_auth_user_id uuid, target_member_id uuid)
language sql
stable
security definer
set search_path = ''
as $b2a$
  -- 이 함수의 1행은 장부 확인일 뿐, 실제 자료 접근 승인이 아니다.
  -- 대상(target_member_id)은 입력으로 받지 않고 장부에서만 돌려준다.
  -- 살아 있는 기록 = 종료 안 됨(revoked_at is null) 그리고 issued_at <= 지금 < expires_at.
  -- p_action이 NULL·빈 값·목록에 없는 값이면 0행.
  select g.purpose, g.actor_auth_user_id, g.target_member_id
    from security_private.access_grant g
   where g.credential_digest = p_credential_digest
     and g.revoked_at is null
     and g.issued_at <= pg_catalog.now()
     and pg_catalog.now() < g.expires_at
     and (
           (
             g.purpose = 'book'
             and p_action in (
               'book_read', 'commentary_read',
               'memo_read', 'memo_write',
               'progress_read', 'progress_write'
             )
           )
           or
           (
             g.purpose = 'proxy'
             and p_action in (
               'student_read', 'student_write',
               'student_file_read', 'student_file_write'
             )
           )
         );
$b2a$;

revoke all on function security_private.resolve_grant(text, text) from public, anon, authenticated, service_role;
grant execute on function security_private.resolve_grant(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 4. 공개 함수 2개 (public — PostgREST로 부른다)
-- ---------------------------------------------------------------------

-- 공개 상태 조회. 부르는 사람과 무관하게 같은 답. 행이 없으면 {"phase": "unknown"}.
create function public.site_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $b2a$
  select coalesce(
    (
      select pg_catalog.jsonb_build_object(
               'maintenance_id', ss.maintenance_id,
               'phase', ss.phase,
               'starts_at', ss.starts_at,
               'message', ss.message,
               'last_ended_maintenance_id', ss.last_ended_maintenance_id
             )
        from security_private.site_state ss
       where ss.id = 1
    ),
    pg_catalog.jsonb_build_object('phase', 'unknown')
  );
$b2a$;

revoke all on function public.site_status() from public, anon, authenticated, service_role;
grant execute on function public.site_status() to anon, authenticated, service_role;

-- 개인별 답(호출자 기준). 중간 저장소에 남지 않도록 응답 머리글을 명시한다.
-- set_config 를 쓰므로 volatile 이다(POST로 부른다).
create function public.my_site_access()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $b2a$
declare
  v_allowed  boolean;
  v_is_admin boolean;
begin
  v_allowed  := coalesce(security_private.request_allowed(), false);
  v_is_admin := coalesce(security_private.is_current_admin(), false);

  perform pg_catalog.set_config(
    'response.headers',
    '[{"Cache-Control": "private, no-store"}]',
    true
  );

  return pg_catalog.jsonb_build_object('allowed', v_allowed, 'is_admin', v_is_admin);
end;
$b2a$;

revoke all on function public.my_site_access() from public, anon, authenticated, service_role;
grant execute on function public.my_site_access() to authenticated;

-- ---------------------------------------------------------------------
-- 5. 스키마·표 권한
--    PUBLIC에서만 회수하면 역할별로 자동 부여된 권한이 남으므로 네 곳 각각에서 회수한다.
-- ---------------------------------------------------------------------
revoke all on schema security_private from public, anon, authenticated, service_role;
grant usage on schema security_private to anon, authenticated, service_role;

revoke all on table security_private.member_identity       from public, anon, authenticated, service_role;
revoke all on table security_private.admin_principal       from public, anon, authenticated, service_role;
revoke all on table security_private.access_grant          from public, anon, authenticated, service_role;
revoke all on table security_private.site_state            from public, anon, authenticated, service_role;
revoke all on table security_private.maintenance_exception from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. 자기 점검 (같은 트랜잭션. 어긋나면 예외 → 전체 되돌아감)
--    이 점검의 통과는 supabase/tests/b2a_identity_gate/절차.md 의 시험을 대신하지 않는다.
-- ---------------------------------------------------------------------
do $b2a_check$
declare
  v_tables  constant text[] := array['member_identity', 'admin_principal', 'access_grant', 'site_state', 'maintenance_exception'];
  v_roles   constant text[] := array['public', 'anon', 'authenticated', 'service_role'];
  v_privs   text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_table   text;
  v_role    text;
  v_priv    text;
  v_relname text;
  v_rls     boolean;
  v_count   bigint;
  v_fn      record;
  v_secdef  boolean;
begin
  -- MAINTAIN 권한은 PostgreSQL 17부터 있다.
  if pg_catalog.current_setting('server_version_num')::pg_catalog.int4 >= 170000 then
    v_privs := pg_catalog.array_append(v_privs, 'MAINTAIN'::pg_catalog.text);
  end if;

  -- (가) 스키마: 세 역할은 USAGE만, CREATE 없음. PUBLIC은 둘 다 없음.
  if pg_catalog.has_schema_privilege('public'::pg_catalog.name, 'security_private', 'USAGE')
     or pg_catalog.has_schema_privilege('public'::pg_catalog.name, 'security_private', 'CREATE') then
    raise exception 'b2a 자기 점검 실패: security_private 스키마에 PUBLIC 권한이 남아 있음';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if not pg_catalog.has_schema_privilege(v_role::pg_catalog.name, 'security_private', 'USAGE') then
      raise exception 'b2a 자기 점검 실패: % 역할에 security_private USAGE가 없음', v_role;
    end if;
    if pg_catalog.has_schema_privilege(v_role::pg_catalog.name, 'security_private', 'CREATE') then
      raise exception 'b2a 자기 점검 실패: % 역할에 security_private CREATE가 있음', v_role;
    end if;
  end loop;

  -- (나) 표 5개: RLS 켜짐, 정책 0, 바깥 역할의 실효 표 권한 0.
  foreach v_table in array v_tables loop
    v_relname := 'security_private.' || v_table;

    if pg_catalog.to_regclass(v_relname) is null then
      raise exception 'b2a 자기 점검 실패: 표 % 가 없음', v_relname;
    end if;

    select c.relrowsecurity
      into v_rls
      from pg_catalog.pg_class c
     where c.oid = pg_catalog.to_regclass(v_relname);
    if v_rls is not true then
      raise exception 'b2a 자기 점검 실패: 표 % 의 RLS가 꺼져 있음', v_relname;
    end if;

    select pg_catalog.count(*)
      into v_count
      from pg_catalog.pg_policy p
     where p.polrelid = pg_catalog.to_regclass(v_relname);
    if v_count <> 0 then
      raise exception 'b2a 자기 점검 실패: 표 % 에 정책이 % 개 있음(0이어야 함)', v_relname, v_count;
    end if;

    foreach v_role in array v_roles loop
      foreach v_priv in array v_privs loop
        if pg_catalog.has_table_privilege(v_role::pg_catalog.name, v_relname, v_priv) then
          raise exception 'b2a 자기 점검 실패: % 역할이 표 % 에 % 권한을 가짐', v_role, v_relname, v_priv;
        end if;
      end loop;
    end loop;
  end loop;

  -- (다) 함수 10개: security definer, PUBLIC 실행 없음, 역할별 실행 권한이 계약서 표와 정확히 같음.
  --      도우미 current_session() 은 세 역할 모두 실행 권한이 없어야 한다.
  for v_fn in
    select t.sig, t.want_anon, t.want_authenticated, t.want_service_role
      from (
        values
          ('security_private.current_member_id()'::pg_catalog.text,      false, true,  false),
          ('security_private.current_session()',                         false, false, false),
          ('security_private.current_member_id_text()',                  false, true,  false),
          ('security_private.current_member_email()',                    false, true,  false),
          ('security_private.is_current_admin()',                        false, true,  false),
          ('security_private.request_allowed()',                         true,  true,  true),
          ('security_private.check_api_request()',                       true,  true,  true),
          ('security_private.resolve_grant(text, text)',                 false, false, true),
          ('public.site_status()',                                       true,  true,  true),
          ('public.my_site_access()',                                    false, true,  false)
      ) as t(sig, want_anon, want_authenticated, want_service_role)
  loop
    if pg_catalog.to_regprocedure(v_fn.sig) is null then
      raise exception 'b2a 자기 점검 실패: 함수 % 가 없음', v_fn.sig;
    end if;

    select p.prosecdef
      into v_secdef
      from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure(v_fn.sig);
    if v_secdef is not true then
      raise exception 'b2a 자기 점검 실패: 함수 % 가 security definer가 아님', v_fn.sig;
    end if;

    if pg_catalog.has_function_privilege('public'::pg_catalog.name, v_fn.sig, 'EXECUTE') then
      raise exception 'b2a 자기 점검 실패: 함수 % 에 PUBLIC 실행 권한이 남아 있음', v_fn.sig;
    end if;
    if pg_catalog.has_function_privilege('anon'::pg_catalog.name, v_fn.sig, 'EXECUTE') is distinct from v_fn.want_anon then
      raise exception 'b2a 자기 점검 실패: 함수 % 의 anon 실행 권한이 기대(%)와 다름', v_fn.sig, v_fn.want_anon;
    end if;
    if pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, v_fn.sig, 'EXECUTE') is distinct from v_fn.want_authenticated then
      raise exception 'b2a 자기 점검 실패: 함수 % 의 authenticated 실행 권한이 기대(%)와 다름', v_fn.sig, v_fn.want_authenticated;
    end if;
    if pg_catalog.has_function_privilege('service_role'::pg_catalog.name, v_fn.sig, 'EXECUTE') is distinct from v_fn.want_service_role then
      raise exception 'b2a 자기 점검 실패: 함수 % 의 service_role 실행 권한이 기대(%)와 다름', v_fn.sig, v_fn.want_service_role;
    end if;
  end loop;

  -- (라) site_state 초기 행 1개.
  select pg_catalog.count(*) into v_count from security_private.site_state;
  if v_count <> 1 then
    raise exception 'b2a 자기 점검 실패: site_state 행이 % 개(1이어야 함)', v_count;
  end if;
end;
$b2a_check$;

commit;
