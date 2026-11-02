-- =====================================================================
-- 입문서 버전 협업 (2026-11-02, 계획서 v4)
--
-- 이 파일만 적용해도 어떤 책도 바로 바뀌지 않는다.
--   * 새 이력 테이블·RPC·보호 트리거를 만든다.
--   * 책별 head 행이 없거나 enabled=false인 책은 기존 편집기 동작이 그대로다.
--   * 대상 책의 전환은 운영자가 쓰기 정지 구간에 book_collab_activate()를 따로 실행한다.
--
-- 규칙 요약
--   * 저장 1번 = 저장 버전 1개(seq). 책 전체 manifest(쪽 순서·삭제 상태·내용 참조)를 남긴다.
--   * 수정안(proposal)·교체 전 백업(backup)은 head와 현재 본문을 바꾸지 않는 불변 변경분이다.
--   * 저장은 expected head가 맞을 때만, 한 트랜잭션으로 반영한다. 범위 밖 쪽은 head에서 승계한다.
--   * 페이지 삭제는 deleted_at 논리삭제. 협업 책의 직접 REST 쓰기·삭제는 트리거가 막는다.
--   * 이력은 수정·삭제하지 않는다(트리거로 차단).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 전용 실행 역할 (로그인 불가). anon/authenticated는 이 역할이 될 수 없다.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'book_collab_writer') then
    create role book_collab_writer nologin noinherit;
  end if;
end $$;
grant book_collab_writer to current_user;   -- 함수 소유자 지정용(현재 마이그레이션 실행 역할만)

create schema if not exists book_collab_private;
revoke all on schema book_collab_private from public;
grant usage on schema book_collab_private to public;   -- 보호 트리거가 모든 쓰기 역할에서 동작해야 함
grant usage on schema public to book_collab_writer;

-- ---------------------------------------------------------------------
-- 1. 기존 테이블 보강: 페이지 논리삭제
-- ---------------------------------------------------------------------
alter table public.tr_book_pages add column if not exists deleted_at timestamptz;
create index if not exists tr_book_pages_book_live_idx
  on public.tr_book_pages (book_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 2. 새 이력 테이블
-- ---------------------------------------------------------------------
create table public.tr_book_revision_heads (
  book_id          uuid primary key references public.tr_book_documents(id) on delete restrict,
  head_revision_id uuid,
  head_seq         integer not null default 0,
  enabled          boolean not null default false,
  updated_at       timestamptz not null default now()
);

create table public.tr_book_revisions (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.tr_book_documents(id) on delete restrict,
  kind              text not null check (kind in ('baseline', 'save', 'proposal', 'backup')),
  seq               integer,
  base_revision_id  uuid references public.tr_book_revisions(id) on delete restrict,
  author_source     text not null default 'admin' check (author_source in ('admin', 'aside', 'system')),
  submitted_by      uuid references auth.users(id) on delete set null,
  submitted_label   text not null default '',
  title             text not null default '',
  summary           text not null default '',
  scope             jsonb not null default '{}'::jsonb,
  source_links      jsonb not null default '[]'::jsonb,
  manifest_complete boolean not null,
  created_at        timestamptz not null default now(),
  constraint tr_book_revisions_seq_kind check ((kind in ('baseline', 'save')) = (seq is not null)),
  constraint tr_book_revisions_manifest_kind check ((kind in ('baseline', 'save')) = manifest_complete),
  constraint tr_book_revisions_book_seq unique (book_id, seq),
  constraint tr_book_revisions_id_book unique (id, book_id)
);
create index tr_book_revisions_book_created_idx on public.tr_book_revisions (book_id, created_at desc);

alter table public.tr_book_revision_heads
  add constraint tr_book_revision_heads_head_fk
  foreign key (head_revision_id, book_id) references public.tr_book_revisions(id, book_id) on delete restrict;

create table public.tr_book_revision_payloads (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references public.tr_book_documents(id) on delete restrict,
  page_uid         uuid not null,
  blocks           jsonb not null,
  html             text not null,
  renderer_version text not null default '',
  content_hash     text not null,
  created_at       timestamptz not null default now(),
  constraint tr_book_revision_payloads_dedupe unique (book_id, page_uid, content_hash, renderer_version),
  constraint tr_book_revision_payloads_id_book unique (id, book_id)
);

create table public.tr_book_revision_entries (
  revision_id uuid not null,
  book_id     uuid not null,
  page_uid    uuid not null,
  payload_id  uuid not null,
  sort_order  integer,
  is_deleted  boolean not null default false,
  primary key (revision_id, page_uid),
  constraint tr_book_revision_entries_rev_fk foreign key (revision_id, book_id)
    references public.tr_book_revisions(id, book_id) on delete restrict,
  constraint tr_book_revision_entries_payload_fk foreign key (payload_id, book_id)
    references public.tr_book_revision_payloads(id, book_id) on delete restrict,
  constraint tr_book_revision_entries_order unique (revision_id, sort_order),
  constraint tr_book_revision_entries_deleted_order check (not is_deleted or sort_order is null),
  constraint tr_book_revision_entries_positive check (sort_order is null or sort_order > 0)
);

create table public.tr_book_revision_receipts (
  user_id     uuid not null,
  revision_id uuid not null references public.tr_book_revisions(id) on delete restrict,
  seen_at     timestamptz not null default now(),
  primary key (user_id, revision_id)
);

create table public.tr_book_revision_load_events (
  id                 uuid primary key,
  book_id            uuid not null references public.tr_book_documents(id) on delete restrict,
  user_id            uuid not null,
  revision_id        uuid not null references public.tr_book_revisions(id) on delete restrict,
  backup_revision_id uuid references public.tr_book_revisions(id) on delete restrict,
  working_copy_id    text not null default '',
  device_id          text not null default '',
  tab_id             text not null default '',
  loaded_at          timestamptz not null default now()
);

create table public.tr_book_revision_requests (
  book_id      uuid not null references public.tr_book_documents(id) on delete restrict,
  request_id   uuid not null,
  operation    text not null,
  actor_id     uuid not null,
  request_hash text not null,
  result       jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (book_id, request_id)
);

create table public.tr_book_revision_admins (
  book_id      uuid not null references public.tr_book_documents(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'editor' check (role in ('owner', 'editor')),
  created_at   timestamptz not null default now(),
  primary key (book_id, auth_user_id)
);

-- 새 테이블: 브라우저 역할은 직접 접근 불가. 전용 실행 역할만 정책으로 허용.
do $$
declare t text;
begin
  foreach t in array array['tr_book_revision_heads','tr_book_revisions','tr_book_revision_payloads',
                           'tr_book_revision_entries','tr_book_revision_receipts','tr_book_revision_load_events',
                           'tr_book_revision_requests','tr_book_revision_admins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on table public.%I from service_role', t);
      execute format('grant select on table public.%I to service_role', t);
      execute format('create policy %I on public.%I for select to service_role using (true)', t || '_service_read', t);
    end if;
    execute format('create policy %I on public.%I for all to book_collab_writer using (true) with check (true)', t || '_writer', t);
  end loop;
end $$;

grant select, update on public.tr_book_revision_heads to book_collab_writer;
grant select, insert on public.tr_book_revisions, public.tr_book_revision_payloads, public.tr_book_revision_entries,
                       public.tr_book_revision_receipts, public.tr_book_revision_load_events,
                       public.tr_book_revision_requests to book_collab_writer;
grant select on public.tr_book_revision_admins to book_collab_writer;
grant select, insert, update on public.tr_book_pages, public.tr_book_documents to book_collab_writer;
grant select on public.tr_book_page_versions, public.tr_book_memos, public.tr_book_progress, public.tr_book_access
  to book_collab_writer;

-- 이력 불변: 누구든 UPDATE/DELETE/TRUNCATE 금지 (운영자가 트리거를 일부러 끄지 않는 한)
create or replace function book_collab_private.immutable_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'BOOK_COLLAB_IMMUTABLE: 버전 이력은 고치거나 지울 수 없어요' using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['tr_book_revisions','tr_book_revision_payloads','tr_book_revision_entries',
                           'tr_book_revision_load_events','tr_book_revision_requests'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function book_collab_private.immutable_history()', t || '_immutable', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function book_collab_private.immutable_history()', t || '_no_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. 내부 도우미 (API로 노출되지 않는 스키마)
-- ---------------------------------------------------------------------
create or replace function book_collab_private.lock_book(p_book uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('book_collab:' || p_book::text, 0));
$$;

-- 보호 여부: 책 잠금을 먼저 얻은 뒤 최신 enabled를 읽는다(대기하던 옛 요청도 활성화 후엔 거부됨).
create or replace function book_collab_private.is_protected(p_book uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_book is null then return false; end if;
  perform book_collab_private.lock_book(p_book);
  return coalesce((select h.enabled from public.tr_book_revision_heads h where h.book_id = p_book), false);
end $$;

create or replace function book_collab_private.guard_legacy_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  b_old uuid;
  b_new uuid;
begin
  if current_user = 'book_collab_writer' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'tr_book_documents' then
    if tg_op <> 'INSERT' then b_old := old.id; end if;
    if tg_op <> 'DELETE' then b_new := new.id; end if;
  else
    if tg_op <> 'INSERT' then b_old := old.book_id; end if;
    if tg_op <> 'DELETE' then b_new := new.book_id; end if;
  end if;
  if book_collab_private.is_protected(b_old)
     or (b_new is distinct from b_old and book_collab_private.is_protected(b_new)) then
    raise exception 'BOOK_COLLAB_PROTECTED: 이 책은 버전 협업 저장으로만 바꿀 수 있어요. 편집기를 새로고침해 주세요.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function book_collab_private.guard_legacy_truncate() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'book_collab_writer'
     and exists (select 1 from public.tr_book_revision_heads h where h.enabled) then
    raise exception 'BOOK_COLLAB_PROTECTED: 협업 책이 있어 전체 비우기를 할 수 없어요' using errcode = '42501';
  end if;
  return null;
end $$;

create trigger tr_book_documents_collab_guard before insert or update or delete on public.tr_book_documents
  for each row execute function book_collab_private.guard_legacy_write();
create trigger tr_book_pages_collab_guard before insert or update or delete on public.tr_book_pages
  for each row execute function book_collab_private.guard_legacy_write();
create trigger tr_book_page_versions_collab_guard before insert or update or delete on public.tr_book_page_versions
  for each row execute function book_collab_private.guard_legacy_write();
create trigger tr_book_documents_collab_truncate before truncate on public.tr_book_documents
  for each statement execute function book_collab_private.guard_legacy_truncate();
create trigger tr_book_pages_collab_truncate before truncate on public.tr_book_pages
  for each statement execute function book_collab_private.guard_legacy_truncate();
create trigger tr_book_page_versions_collab_truncate before truncate on public.tr_book_page_versions
  for each statement execute function book_collab_private.guard_legacy_truncate();

-- RLS는 TRUNCATE를 막지 못하므로 브라우저 역할의 불필요 고권한만 회수(정상 읽기·쓰기는 유지).
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke truncate, trigger, references on public.tr_book_documents, public.tr_book_pages, public.tr_book_page_versions from %I', r);
    end if;
  end loop;
end $$;

-- 검증된 요청자: PostgREST가 확인한 JWT(sub, role=authenticated)
create or replace function book_collab_private.actor() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  c jsonb;
  v uuid;
begin
  begin
    c := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then c := null;
  end;
  if c is null or coalesce(c->>'role', '') <> 'authenticated'
     or coalesce(pg_catalog.current_setting('role', true), '') <> 'authenticated' then
    raise exception 'BOOK_COLLAB_AUTH_REQUIRED: 관리자 확인이 필요해요' using errcode = '28000';
  end if;
  begin
    v := (c->>'sub')::uuid;
  exception when others then v := null;
  end;
  if v is null then
    raise exception 'BOOK_COLLAB_AUTH_REQUIRED: 관리자 확인이 필요해요' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function book_collab_private.actor_label() returns text
language plpgsql stable set search_path = '' as $$
declare c jsonb;
begin
  begin
    c := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then c := null;
  end;
  return left(coalesce(c->>'email', ''), 200);
end $$;

create or replace function book_collab_private.require_admin(p_book uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid;
begin
  v := book_collab_private.actor();
  if p_book is null or not exists (
    select 1 from public.tr_book_revision_admins a where a.book_id = p_book and a.auth_user_id = v) then
    raise exception 'BOOK_COLLAB_FORBIDDEN: 이 책의 협업 권한이 없어요' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function book_collab_private.locked_head(p_book uuid) returns public.tr_book_revision_heads
language plpgsql volatile set search_path = '' as $$
declare h public.tr_book_revision_heads;
begin
  perform book_collab_private.lock_book(p_book);
  select * into h from public.tr_book_revision_heads where book_id = p_book for update;
  if not found or not h.enabled then
    raise exception 'BOOK_COLLAB_NOT_ENABLED: 이 책은 버전 협업이 켜져 있지 않아요' using errcode = '55000';
  end if;
  return h;
end $$;

create or replace function book_collab_private.request_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p::text, 'UTF8')), 'hex');
$$;

-- 같은 request_id: 같은 요청이면 이전 결과, 다른 요청이면 거부, 처음이면 null
create or replace function book_collab_private.replay(p_book uuid, p_request uuid, p_op text, p_actor uuid, p_hash text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare r public.tr_book_revision_requests;
begin
  if p_request is null then
    raise exception 'BOOK_COLLAB_INVALID: request_id가 필요해요' using errcode = '22023';
  end if;
  select * into r from public.tr_book_revision_requests where book_id = p_book and request_id = p_request;
  if not found then return null; end if;
  if r.operation <> p_op or r.actor_id <> p_actor or r.request_hash <> p_hash then
    raise exception 'BOOK_COLLAB_REQUEST_REUSED: 같은 요청 번호로 다른 내용을 보낼 수 없어요' using errcode = '22023';
  end if;
  return r.result || jsonb_build_object('replayed', true);
end $$;

create or replace function book_collab_private.remember(p_book uuid, p_request uuid, p_op text, p_actor uuid, p_hash text, p_result jsonb)
returns jsonb language sql volatile set search_path = '' as $$
  insert into public.tr_book_revision_requests (book_id, request_id, operation, actor_id, request_hash, result)
  values (p_book, p_request, p_op, p_actor, p_hash, p_result)
  returning result;
$$;

-- 서버 HTML 검사: 실행 가능한 요소·속성·외부 이미지 거부
create or replace function book_collab_private.html_problem(p_html text, p_book uuid) returns text
language plpgsql immutable set search_path = '' as $$
declare
  m text;
  img_total int;
  img_ok int := 0;
  prefix_book constant text := 'https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/book/';
  prefix_mig text := 'https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/book-migrations/' || p_book::text || '/';
begin
  if p_html is null then return 'EMPTY'; end if;
  if length(p_html) > 1000000 then return 'TOO_LARGE'; end if;
  if p_html ~* '<\s*/?\s*(script|iframe|frame|frameset|object|embed|form|meta|link|base|style|svg|math|template|noscript|applet)\M' then
    return 'FORBIDDEN_TAG';
  end if;
  if p_html ~* '<[^>]*[\s"''/]on[a-z]+\s*=' then return 'EVENT_ATTRIBUTE'; end if;
  if p_html ~* '(javascript|vbscript|livescript)\s*:' then return 'SCRIPT_URL'; end if;
  if p_html ~* 'data\s*:\s*text/html' then return 'SCRIPT_URL'; end if;
  if p_html ~* 'srcdoc\s*=' then return 'SRCDOC'; end if;
  if p_html ~* 'expression\s*\(' then return 'STYLE_EXPRESSION'; end if;
  img_total := (select count(*) from regexp_matches(p_html, '<img\M', 'gi'));
  for m in select (regexp_matches(p_html, '<img\M[^>]*?\ssrc\s*=\s*"([^"]*)"', 'gi'))[1] loop
    if not (starts_with(m, prefix_book) or starts_with(m, prefix_mig)) or m ~ '[?#]' then
      return 'IMAGE_SOURCE';
    end if;
    img_ok := img_ok + 1;
  end loop;
  if img_ok <> img_total then return 'IMAGE_SOURCE'; end if;
  return null;
end $$;

create or replace function book_collab_private.insert_after(p_arr uuid[], p_uid uuid, p_after uuid) returns uuid[]
language plpgsql immutable set search_path = '' as $$
declare pos int;
begin
  if p_after is null then return array[p_uid] || p_arr; end if;
  pos := array_position(p_arr, p_after);
  if pos is null then
    raise exception 'BOOK_COLLAB_CONFLICT_ANCHOR: 기준 위치 쪽을 찾을 수 없어요 (%)', p_after using errcode = '40001';
  end if;
  return p_arr[1:pos] || p_uid || p_arr[pos + 1:];
end $$;

-- 변경 명세를 기준 manifest에 적용해 본다(쓰기 없음). 구조 동작은 배열 순서대로 적용.
create or replace function book_collab_private.plan_changes(p_book uuid, p_base uuid, p_changes jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_struct jsonb;
  v_pages jsonb;
  v_base_order uuid[];
  v_order uuid[];
  v_deleted uuid[];
  v_known uuid[];
  v_added uuid[] := '{}';
  v_restored uuid[] := '{}';
  v_del uuid[] := '{}';
  v_moved uuid[] := '{}';
  v_content uuid[] := '{}';
  op jsonb;
  pg jsonb;
  v_uid uuid;
  v_after uuid;
  prob text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'BOOK_COLLAB_INVALID: 변경 내용 형식' using errcode = '22023';
  end if;
  v_struct := coalesce(p_changes->'structure', '[]'::jsonb);
  v_pages := coalesce(p_changes->'pages', '[]'::jsonb);
  if jsonb_typeof(v_struct) <> 'array' or jsonb_typeof(v_pages) <> 'array' then
    raise exception 'BOOK_COLLAB_INVALID: 변경 내용 형식' using errcode = '22023';
  end if;
  if jsonb_array_length(v_struct) > 1000 or jsonb_array_length(v_pages) > 2000 then
    raise exception 'BOOK_COLLAB_INVALID: 변경이 너무 많아요' using errcode = '22023';
  end if;

  select coalesce(array_agg(e.page_uid order by e.sort_order) filter (where not e.is_deleted), '{}'),
         coalesce(array_agg(e.page_uid) filter (where e.is_deleted), '{}'),
         coalesce(array_agg(e.page_uid), '{}')
    into v_base_order, v_deleted, v_known
    from public.tr_book_revision_entries e
    join public.tr_book_revisions r on r.id = e.revision_id
   where e.revision_id = p_base and r.book_id = p_book and r.manifest_complete;
  if cardinality(v_known) = 0 then
    raise exception 'BOOK_COLLAB_INVALID: 기준 버전을 찾을 수 없어요' using errcode = '22023';
  end if;
  v_order := v_base_order;

  for op in select value from jsonb_array_elements(v_struct) loop
    begin
      v_uid := (op->>'page_uid')::uuid;
      v_after := nullif(op->>'after', '')::uuid;
    exception when others then
      raise exception 'BOOK_COLLAB_INVALID: 쪽 ID 형식' using errcode = '22023';
    end;
    if v_uid is null then
      raise exception 'BOOK_COLLAB_INVALID: 쪽 ID 누락' using errcode = '22023';
    end if;
    case op->>'op'
      when 'add' then
        if v_uid = any(v_known) or v_uid = any(v_added)
           or exists (select 1 from public.tr_book_pages p where p.id = v_uid) then
          raise exception 'BOOK_COLLAB_CONFLICT_UUID: 이미 있는 쪽 ID예요 (%)', v_uid using errcode = '40001';
        end if;
        v_order := book_collab_private.insert_after(v_order, v_uid, v_after);
        v_added := v_added || v_uid;
      when 'delete' then
        if v_uid = any(v_added) then
          raise exception 'BOOK_COLLAB_INVALID: 같은 요청에서 추가 후 삭제할 수 없어요' using errcode = '22023';
        end if;
        if not (v_uid = any(v_order)) then
          raise exception 'BOOK_COLLAB_CONFLICT_MISSING: 지울 쪽이 이미 없어요 (%)', v_uid using errcode = '40001';
        end if;
        v_order := array_remove(v_order, v_uid);
        v_deleted := v_deleted || v_uid;
        v_del := v_del || v_uid;
      when 'restore' then
        if not (v_uid = any(v_deleted)) then
          raise exception 'BOOK_COLLAB_CONFLICT_RESTORE: 되살릴 수 있는 삭제 쪽이 아니에요 (%)', v_uid using errcode = '40001';
        end if;
        v_deleted := array_remove(v_deleted, v_uid);
        v_order := book_collab_private.insert_after(v_order, v_uid, v_after);
        v_restored := v_restored || v_uid;
      when 'move' then
        if not (v_uid = any(v_order)) or v_uid = v_after then
          raise exception 'BOOK_COLLAB_CONFLICT_MISSING: 옮길 쪽을 찾을 수 없어요 (%)', v_uid using errcode = '40001';
        end if;
        v_order := array_remove(v_order, v_uid);
        v_order := book_collab_private.insert_after(v_order, v_uid, v_after);
        if not (v_uid = any(v_moved)) then v_moved := v_moved || v_uid; end if;
      else
        raise exception 'BOOK_COLLAB_INVALID: 알 수 없는 구조 동작' using errcode = '22023';
    end case;
  end loop;

  if cardinality(v_order) < 1 then
    raise exception 'BOOK_COLLAB_INVALID: 최소 한 쪽은 있어야 해요' using errcode = '22023';
  end if;

  for pg in select value from jsonb_array_elements(v_pages) loop
    begin
      v_uid := (pg->>'page_uid')::uuid;
    exception when others then
      raise exception 'BOOK_COLLAB_INVALID: 쪽 ID 형식' using errcode = '22023';
    end;
    if v_uid is null or v_uid = any(v_content) then
      raise exception 'BOOK_COLLAB_INVALID: 쪽 ID 누락 또는 중복' using errcode = '22023';
    end if;
    if not (v_uid = any(v_order)) then
      raise exception 'BOOK_COLLAB_PAGE_NOT_LIVE: 삭제됐거나 없는 쪽은 내용만 바꿀 수 없어요 (%)', v_uid using errcode = '40001';
    end if;
    if jsonb_typeof(pg->'blocks') is distinct from 'array' or jsonb_typeof(pg->'html') is distinct from 'string' then
      raise exception 'BOOK_COLLAB_INVALID: 쪽 내용 형식 (%)', v_uid using errcode = '22023';
    end if;
    prob := book_collab_private.html_problem(pg->>'html', p_book);
    if prob is not null then
      raise exception 'BOOK_COLLAB_UNSAFE_HTML: % (%)', prob, v_uid using errcode = '22023';
    end if;
    if (pg->'blocks')::text ~* '(javascript|vbscript|livescript)\s*:' then
      raise exception 'BOOK_COLLAB_UNSAFE_HTML: SCRIPT_URL (%)', v_uid using errcode = '22023';
    end if;
    v_content := v_content || v_uid;
  end loop;

  return jsonb_build_object(
    'base_order', to_jsonb(v_base_order),
    'order', to_jsonb(v_order),
    'deleted', to_jsonb(v_deleted),
    'added', to_jsonb(v_added),
    'restored', to_jsonb(v_restored),
    'deleted_ops', to_jsonb(v_del),
    'moved', to_jsonb(v_moved),
    'content', to_jsonb(v_content),
    'has_structure', (v_order is distinct from v_base_order) or cardinality(v_added) > 0
                     or cardinality(v_restored) > 0 or cardinality(v_del) > 0);
end $$;

create or replace function book_collab_private.payload_for(p_book uuid, p_uid uuid, p_blocks jsonb, p_html text, p_rv text)
returns uuid language plpgsql volatile set search_path = '' as $$
declare
  h text;
  v uuid;
begin
  h := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_blocks::text || chr(31) || p_html, 'UTF8')), 'hex');
  select id into v from public.tr_book_revision_payloads
   where book_id = p_book and page_uid = p_uid and content_hash = h and renderer_version = coalesce(p_rv, '');
  if v is null then
    insert into public.tr_book_revision_payloads (book_id, page_uid, blocks, html, renderer_version, content_hash)
    values (p_book, p_uid, p_blocks, p_html, coalesce(p_rv, ''), h)
    returning id into v;
  end if;
  return v;
end $$;

create or replace function book_collab_private.assert_structure_allowed(p_book uuid) returns void
language plpgsql stable set search_path = '' as $$
declare d public.tr_book_documents;
begin
  select * into d from public.tr_book_documents where id = p_book;
  if not found or d.is_active or d.deleted_at is not null
     or exists (select 1 from public.tr_book_memos m where m.book_id = p_book)
     or exists (select 1 from public.tr_book_progress g where g.book_id = p_book)
     or exists (select 1 from public.tr_book_access a where a.book_id = p_book) then
    raise exception 'BOOK_COLLAB_STRUCTURE_BLOCKED: 공개 중이거나 학생 기록이 있는 책은 쪽 추가·삭제·순서 변경을 저장할 수 없어요'
      using errcode = '55000';
  end if;
end $$;

create or replace function book_collab_private.validate_links(p_book uuid, p_links jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare l jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 200 then
    raise exception 'BOOK_COLLAB_INVALID: 출처 형식' using errcode = '22023';
  end if;
  for l in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(l) <> 'object' or not exists (
         select 1 from public.tr_book_revisions r
          where r.book_id = p_book and r.id = (l->>'revision_id')::uuid) then
      raise exception 'BOOK_COLLAB_INVALID: 출처 버전을 찾을 수 없어요' using errcode = '22023';
    end if;
  end loop;
end $$;

create or replace function book_collab_private.label_text(p text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(coalesce(p, '')), p_max);
$$;

-- ---------------------------------------------------------------------
-- 4. 공개 API (PostgREST RPC)
-- ---------------------------------------------------------------------

-- 4-1. 협업 여부만 (익명 가능, 행을 만들지 않음)
create or replace function public.book_collab_status(p_book_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb := '{}'::jsonb;
begin
  if p_book_ids is null or cardinality(p_book_ids) > 200 then
    raise exception 'BOOK_COLLAB_INVALID: 책 목록' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(b::text, coalesce(h.enabled, false)), '{}'::jsonb) into res
    from unnest(p_book_ids) as b
    left join public.tr_book_revision_heads h on h.book_id = b;
  return res;
end $$;

-- 4-2. 현재 기준본 (head revision의 불변 manifest로 구성 → head와 본문이 항상 같은 시점)
create or replace function public.book_collab_get_state(p_book uuid, p_include_pages boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  h public.tr_book_revision_heads;
  v_pages jsonb := null;
  v_deleted jsonb := null;
  v_unread int;
  d public.tr_book_documents;
begin
  v_actor := book_collab_private.require_admin(p_book);
  select * into h from public.tr_book_revision_heads where book_id = p_book;
  if not found or not h.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  select * into d from public.tr_book_documents where id = p_book;
  if p_include_pages then
    select coalesce(jsonb_agg(jsonb_build_object('id', e.page_uid, 'sort_order', e.sort_order,
                    'blocks', pl.blocks, 'html', pl.html, 'content_hash', pl.content_hash) order by e.sort_order), '[]'::jsonb)
      into v_pages
      from public.tr_book_revision_entries e
      join public.tr_book_revision_payloads pl on pl.id = e.payload_id
     where e.revision_id = h.head_revision_id and not e.is_deleted;
    select coalesce(jsonb_agg(jsonb_build_object('id', e.page_uid, 'blocks', pl.blocks, 'html', pl.html)), '[]'::jsonb)
      into v_deleted
      from public.tr_book_revision_entries e
      join public.tr_book_revision_payloads pl on pl.id = e.payload_id
     where e.revision_id = h.head_revision_id and e.is_deleted;
  end if;
  select count(*) into v_unread
    from public.tr_book_revisions r
   where r.book_id = p_book and r.kind = 'proposal'
     and not exists (select 1 from public.tr_book_revision_receipts c where c.revision_id = r.id and c.user_id = v_actor);
  return jsonb_build_object(
    'enabled', true,
    'head_revision_id', h.head_revision_id,
    'head_seq', h.head_seq,
    'unread_proposals', v_unread,
    'book', jsonb_build_object('id', d.id, 'title', d.title, 'is_active', d.is_active, 'updated_at', d.updated_at),
    'structure_allowed', not (d.is_active or d.deleted_at is not null
        or exists (select 1 from public.tr_book_memos m where m.book_id = p_book)
        or exists (select 1 from public.tr_book_progress g where g.book_id = p_book)
        or exists (select 1 from public.tr_book_access a where a.book_id = p_book)),
    'actor', jsonb_build_object('id', v_actor, 'label', book_collab_private.actor_label()),
    'pages', v_pages,
    'deleted_pages', v_deleted);
end $$;

-- 4-3. 이력 목록 (본문 제외)
create or replace function public.book_collab_list_revisions(p_book uuid, p_limit int default 80) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  res jsonb;
begin
  v_actor := book_collab_private.require_admin(p_book);
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into res from (
    select r.created_at, jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'seq', r.seq,
      'base_revision_id', r.base_revision_id, 'base_seq', b.seq,
      'author_source', r.author_source, 'submitted_label', r.submitted_label,
      'title', r.title, 'summary', r.summary, 'created_at', r.created_at,
      'scope_pages', coalesce(r.scope->'pages', '[]'::jsonb),
      'structure_count', coalesce(jsonb_array_length(r.scope->'structure'), 0),
      'source_links', r.source_links,
      'seen', exists (select 1 from public.tr_book_revision_receipts c where c.revision_id = r.id and c.user_id = v_actor),
      'used_in', (select coalesce(jsonb_agg(jsonb_build_object('seq', s.seq, 'links', (
                      select coalesce(jsonb_agg(l), '[]'::jsonb) from jsonb_array_elements(s.source_links) l
                       where l->>'revision_id' = r.id::text)) order by s.seq), '[]'::jsonb)
                    from public.tr_book_revisions s
                   where s.book_id = p_book and s.kind = 'save'
                     and s.source_links @> jsonb_build_array(jsonb_build_object('revision_id', r.id::text))),
      'loaded_by_me', (select count(*) from public.tr_book_revision_load_events le where le.revision_id = r.id and le.user_id = v_actor)
    ) as j
    from public.tr_book_revisions r
    left join public.tr_book_revisions b on b.id = r.base_revision_id
    where r.book_id = p_book
    order by r.created_at desc
    limit greatest(1, least(coalesce(p_limit, 80), 300))
  ) x;
  return res;
end $$;

-- 4-4. 한 버전 상세 (범위 쪽 본문 포함, 전체 본문은 요청 시)
create or replace function public.book_collab_get_revision(p_revision uuid, p_include_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.tr_book_revisions;
  h public.tr_book_revision_heads;
  v_actor uuid;
  v_pages jsonb;
  v_manifest jsonb := null;
  v_changed_since jsonb;
begin
  select * into r from public.tr_book_revisions where id = p_revision;
  if not found then
    raise exception 'BOOK_COLLAB_FORBIDDEN: 이 책의 협업 권한이 없어요' using errcode = '42501';
  end if;
  v_actor := book_collab_private.require_admin(r.book_id);
  select * into h from public.tr_book_revision_heads where book_id = r.book_id;

  select coalesce(jsonb_agg(jsonb_build_object('page_uid', e.page_uid, 'blocks', pl.blocks, 'html', pl.html,
            'renderer_version', pl.renderer_version, 'content_hash', pl.content_hash)), '[]'::jsonb)
    into v_pages
    from public.tr_book_revision_entries e
    join public.tr_book_revision_payloads pl on pl.id = e.payload_id
   where e.revision_id = r.id
     and (p_include_all or not r.manifest_complete
          or e.page_uid::text in (select jsonb_array_elements_text(coalesce(r.scope->'pages', '[]'::jsonb))));

  if r.manifest_complete then
    select coalesce(jsonb_agg(jsonb_build_object('page_uid', e.page_uid, 'sort_order', e.sort_order,
              'is_deleted', e.is_deleted, 'content_hash', pl.content_hash) order by e.sort_order nulls last), '[]'::jsonb)
      into v_manifest
      from public.tr_book_revision_entries e
      join public.tr_book_revision_payloads pl on pl.id = e.payload_id
     where e.revision_id = r.id;
  end if;

  -- 기준 이후 대상 쪽이 바뀐 것(현재 head 기준)
  select coalesce(jsonb_agg(u), '[]'::jsonb) into v_changed_since
    from (
      select s.u
        from jsonb_array_elements_text(coalesce(r.scope->'pages', '[]'::jsonb)) as s(u)
        left join public.tr_book_revision_entries eb on eb.revision_id = r.base_revision_id and eb.page_uid = s.u::uuid
        left join public.tr_book_revision_entries eh on eh.revision_id = h.head_revision_id and eh.page_uid = s.u::uuid
       where r.base_revision_id is not null and h.head_revision_id is not null
         and r.base_revision_id <> h.head_revision_id
         and (eb.payload_id is distinct from eh.payload_id or eb.is_deleted is distinct from eh.is_deleted)
    ) z(u);

  return jsonb_build_object(
    'id', r.id, 'book_id', r.book_id, 'kind', r.kind, 'seq', r.seq,
    'base_revision_id', r.base_revision_id,
    'base_seq', (select b.seq from public.tr_book_revisions b where b.id = r.base_revision_id),
    'author_source', r.author_source, 'submitted_label', r.submitted_label,
    'title', r.title, 'summary', r.summary, 'created_at', r.created_at,
    'scope', r.scope, 'source_links', r.source_links,
    'manifest_complete', r.manifest_complete,
    'pages', v_pages, 'manifest', v_manifest,
    'head_revision_id', h.head_revision_id, 'head_seq', h.head_seq,
    'changed_since_base', v_changed_since,
    'seen', exists (select 1 from public.tr_book_revision_receipts c where c.revision_id = r.id and c.user_id = v_actor));
end $$;

-- 4-5. 저장(commit): expected head 일치 시 한 트랜잭션으로 저장 버전 생성 + 현재 본문 반영
create or replace function public.book_collab_commit(
  p_book uuid, p_expected_head uuid, p_request_id uuid, p_changes jsonb,
  p_title text default '', p_summary text default '', p_source_links jsonb default '[]'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid;
  h public.tr_book_revision_heads;
  v_hash text;
  v_prev jsonb;
  v_plan jsonb;
  v_order uuid[];
  v_deleted uuid[];
  v_added uuid[];
  v_restored uuid[];
  v_del uuid[];
  v_moved uuid[];
  v_new_payload jsonb := '{}'::jsonb;   -- uid -> payload id (내용 바뀐 쪽만)
  v_changed uuid[] := '{}';
  pg jsonb;
  v_uid uuid;
  v_pid uuid;
  v_old_pid uuid;
  v_rev uuid;
  v_seq int;
  v_result jsonb;
  v_stable_base uuid[];
  v_stable_new uuid[];
  v_live_count int;
  v_empty uuid;
begin
  v_actor := book_collab_private.require_admin(p_book);
  h := book_collab_private.locked_head(p_book);
  v_hash := book_collab_private.request_hash(jsonb_build_object('op', 'commit', 'book', p_book, 'expected', p_expected_head,
              'changes', p_changes, 'title', p_title, 'summary', p_summary, 'links', p_source_links));
  v_prev := book_collab_private.replay(p_book, p_request_id, 'commit', v_actor, v_hash);
  if v_prev is not null then
    return v_prev || jsonb_build_object('current_head_revision_id', h.head_revision_id, 'current_head_seq', h.head_seq);
  end if;

  if p_expected_head is distinct from h.head_revision_id then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'current_head_revision_id', h.head_revision_id, 'current_head_seq', h.head_seq);
  end if;

  perform book_collab_private.validate_links(p_book, coalesce(p_source_links, '[]'::jsonb));
  v_plan := book_collab_private.plan_changes(p_book, h.head_revision_id, p_changes);
  if (v_plan->>'has_structure')::boolean then
    perform book_collab_private.assert_structure_allowed(p_book);
  end if;

  select array(select jsonb_array_elements_text(v_plan->'order')::uuid) into v_order;
  select array(select jsonb_array_elements_text(v_plan->'deleted')::uuid) into v_deleted;
  select array(select jsonb_array_elements_text(v_plan->'added')::uuid) into v_added;
  select array(select jsonb_array_elements_text(v_plan->'restored')::uuid) into v_restored;
  select array(select jsonb_array_elements_text(v_plan->'deleted_ops')::uuid) into v_del;
  select array(select jsonb_array_elements_text(v_plan->'moved')::uuid) into v_moved;

  -- 내용 payload 준비 (같은 내용이면 재사용)
  for pg in select value from jsonb_array_elements(coalesce(p_changes->'pages', '[]'::jsonb)) loop
    v_uid := (pg->>'page_uid')::uuid;
    v_pid := book_collab_private.payload_for(p_book, v_uid, pg->'blocks', pg->>'html', pg->>'renderer_version');
    select e.payload_id into v_old_pid from public.tr_book_revision_entries e
     where e.revision_id = h.head_revision_id and e.page_uid = v_uid;
    if v_old_pid is distinct from v_pid then
      v_new_payload := v_new_payload || jsonb_build_object(v_uid::text, v_pid);
      v_changed := v_changed || v_uid;
    end if;
  end loop;
  -- 내용 없이 추가된 쪽은 빈 쪽
  foreach v_uid in array v_added loop
    if not (v_new_payload ? v_uid::text) then
      v_empty := book_collab_private.payload_for(p_book, v_uid, '[]'::jsonb, '', '');
      v_new_payload := v_new_payload || jsonb_build_object(v_uid::text, v_empty);
      v_changed := v_changed || v_uid;
    end if;
  end loop;

  if not (v_plan->>'has_structure')::boolean and cardinality(v_changed) = 0 then
    v_result := jsonb_build_object('ok', true, 'no_change', true,
      'head_revision_id', h.head_revision_id, 'head_seq', h.head_seq);
    return book_collab_private.remember(p_book, p_request_id, 'commit', v_actor, v_hash, v_result)
           || jsonb_build_object('current_head_revision_id', h.head_revision_id, 'current_head_seq', h.head_seq);
  end if;

  -- 범위 밖 쪽의 상대 순서 불변 검사
  select array(select x from unnest(array(select jsonb_array_elements_text(v_plan->'base_order')::uuid)) with ordinality t(x, n)
                where not (x = any(v_moved || v_del || v_restored || v_added)) order by n) into v_stable_base;
  select array(select x from unnest(v_order) with ordinality t(x, n)
                where not (x = any(v_moved || v_del || v_restored || v_added)) order by n) into v_stable_new;
  if v_stable_base is distinct from v_stable_new then
    raise exception 'BOOK_COLLAB_INTERNAL: 범위 밖 쪽 순서가 달라졌어요' using errcode = 'XX000';
  end if;

  v_seq := h.head_seq + 1;
  insert into public.tr_book_revisions (book_id, kind, seq, base_revision_id, author_source, submitted_by, submitted_label,
                                        title, summary, scope, source_links, manifest_complete)
  values (p_book, 'save', v_seq, h.head_revision_id, 'admin', v_actor, book_collab_private.actor_label(),
          book_collab_private.label_text(p_title, 200), book_collab_private.label_text(p_summary, 2000),
          jsonb_build_object('pages', to_jsonb(v_changed), 'structure', coalesce(p_changes->'structure', '[]'::jsonb),
                             'added', to_jsonb(v_added), 'deleted', to_jsonb(v_del),
                             'restored', to_jsonb(v_restored), 'moved', to_jsonb(v_moved)),
          coalesce(p_source_links, '[]'::jsonb), true)
  returning id into v_rev;

  -- 새 manifest: 살아 있는 쪽은 순서대로, 삭제 쪽은 마지막 내용을 보존
  insert into public.tr_book_revision_entries (revision_id, book_id, page_uid, payload_id, sort_order, is_deleted)
  select v_rev, p_book, o.uid,
         coalesce((v_new_payload->>o.uid::text)::uuid,
                  (select e.payload_id from public.tr_book_revision_entries e
                    where e.revision_id = h.head_revision_id and e.page_uid = o.uid)),
         o.pos::int, false
    from unnest(v_order) with ordinality as o(uid, pos);
  insert into public.tr_book_revision_entries (revision_id, book_id, page_uid, payload_id, sort_order, is_deleted)
  select v_rev, p_book, d.uid,
         (select e.payload_id from public.tr_book_revision_entries e
           where e.revision_id = h.head_revision_id and e.page_uid = d.uid),
         null, true
    from unnest(v_deleted) as d(uid);

  -- 현재 본문(호환 읽기 자료) 반영
  insert into public.tr_book_pages (id, book_id, sort_order, blocks, html, created_at, updated_at)
  select a.uid, p_book, array_position(v_order, a.uid), pl.blocks, pl.html, now(), now()
    from unnest(v_added) as a(uid)
    join public.tr_book_revision_payloads pl on pl.id = (v_new_payload->>a.uid::text)::uuid;

  update public.tr_book_pages p
     set blocks = pl.blocks, html = pl.html, updated_at = now()
    from unnest(v_changed) as c(uid)
    join public.tr_book_revision_payloads pl on pl.id = (v_new_payload->>c.uid::text)::uuid
   where p.id = c.uid and p.book_id = p_book and not (c.uid = any(v_added));

  update public.tr_book_pages set deleted_at = null, updated_at = now()
   where book_id = p_book and id = any(v_restored);
  update public.tr_book_pages set deleted_at = now()
   where book_id = p_book and id = any(v_del);
  update public.tr_book_pages p set sort_order = o.pos
    from unnest(v_order) with ordinality as o(uid, pos)
   where p.id = o.uid and p.book_id = p_book and p.sort_order is distinct from o.pos::int;

  -- 현재 본문과 manifest 일치 검사
  select count(*) into v_live_count from public.tr_book_pages where book_id = p_book and deleted_at is null;
  if v_live_count <> cardinality(v_order) or exists (
       select 1 from unnest(v_order) with ordinality as o(uid, pos)
        left join public.tr_book_pages p on p.id = o.uid and p.book_id = p_book
        where p.id is null or p.deleted_at is not null or p.sort_order <> o.pos::int) then
    raise exception 'BOOK_COLLAB_DRIFT: 현재 본문이 기준 버전과 달라 저장을 멈췄어요' using errcode = 'XX000';
  end if;

  update public.tr_book_documents set total_pages = cardinality(v_order), updated_at = now() where id = p_book;
  update public.tr_book_revision_heads
     set head_revision_id = v_rev, head_seq = v_seq, updated_at = now()
   where book_id = p_book;

  v_result := jsonb_build_object('ok', true, 'no_change', false, 'revision_id', v_rev, 'seq', v_seq,
    'head_revision_id', v_rev, 'head_seq', v_seq, 'changed_pages', to_jsonb(v_changed),
    'structure_changed', (v_plan->>'has_structure')::boolean, 'total_pages', cardinality(v_order));
  return book_collab_private.remember(p_book, p_request_id, 'commit', v_actor, v_hash, v_result)
         || jsonb_build_object('current_head_revision_id', v_rev, 'current_head_seq', v_seq);
end $$;

-- 4-6. 수정안·교체 전 백업: head/현재 본문을 바꾸지 않는 불변 변경분
create or replace function book_collab_private.submit_delta(
  p_kind text, p_book uuid, p_base uuid, p_request_id uuid, p_title text, p_summary text,
  p_changes jsonb, p_author_source text, p_meta jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor uuid;
  h public.tr_book_revision_heads;
  v_hash text;
  v_prev jsonb;
  v_plan jsonb;
  v_rev uuid;
  pg jsonb;
  v_uid uuid;
  v_result jsonb;
  v_src text;
begin
  v_actor := book_collab_private.require_admin(p_book);
  h := book_collab_private.locked_head(p_book);
  v_src := coalesce(nullif(p_author_source, ''), 'admin');
  if v_src not in ('admin', 'aside') then
    raise exception 'BOOK_COLLAB_INVALID: 작성 출처' using errcode = '22023';
  end if;
  if p_meta is not null and (jsonb_typeof(p_meta) <> 'object' or length(p_meta::text) > 20000) then
    raise exception 'BOOK_COLLAB_INVALID: 부가 정보' using errcode = '22023';
  end if;
  v_hash := book_collab_private.request_hash(jsonb_build_object('op', p_kind, 'book', p_book, 'base', p_base,
              'changes', p_changes, 'title', p_title, 'summary', p_summary, 'src', v_src, 'meta', p_meta));
  v_prev := book_collab_private.replay(p_book, p_request_id, p_kind, v_actor, v_hash);
  if v_prev is not null then return v_prev; end if;

  if not exists (select 1 from public.tr_book_revisions r where r.id = p_base and r.book_id = p_book and r.manifest_complete) then
    raise exception 'BOOK_COLLAB_INVALID: 기준 버전을 찾을 수 없어요' using errcode = '22023';
  end if;
  v_plan := book_collab_private.plan_changes(p_book, p_base, p_changes);
  if jsonb_array_length(coalesce(p_changes->'pages', '[]'::jsonb)) = 0 and not (v_plan->>'has_structure')::boolean then
    raise exception 'BOOK_COLLAB_INVALID: 보낼 변경이 없어요' using errcode = '22023';
  end if;

  insert into public.tr_book_revisions (book_id, kind, seq, base_revision_id, author_source, submitted_by, submitted_label,
                                        title, summary, scope, source_links, manifest_complete)
  values (p_book, p_kind, null, p_base, case when p_kind = 'backup' then 'system' else v_src end,
          v_actor, book_collab_private.actor_label(),
          book_collab_private.label_text(p_title, 200), book_collab_private.label_text(p_summary, 2000),
          jsonb_build_object('pages', v_plan->'content', 'structure', coalesce(p_changes->'structure', '[]'::jsonb),
                             'added', v_plan->'added', 'deleted', v_plan->'deleted_ops',
                             'restored', v_plan->'restored', 'moved', v_plan->'moved',
                             'meta', coalesce(p_meta, '{}'::jsonb)),
          '[]'::jsonb, false)
  returning id into v_rev;

  for pg in select value from jsonb_array_elements(coalesce(p_changes->'pages', '[]'::jsonb)) loop
    v_uid := (pg->>'page_uid')::uuid;
    insert into public.tr_book_revision_entries (revision_id, book_id, page_uid, payload_id, sort_order, is_deleted)
    values (v_rev, p_book, v_uid,
            book_collab_private.payload_for(p_book, v_uid, pg->'blocks', pg->>'html', pg->>'renderer_version'), null, false);
  end loop;

  v_result := jsonb_build_object('ok', true, 'revision_id', v_rev, 'kind', p_kind, 'base_revision_id', p_base,
    'pages', v_plan->'content', 'structure_count', jsonb_array_length(coalesce(p_changes->'structure', '[]'::jsonb)));
  return book_collab_private.remember(p_book, p_request_id, p_kind, v_actor, v_hash, v_result);
end $$;

create or replace function public.book_collab_submit_proposal(
  p_book uuid, p_base_revision uuid, p_request_id uuid, p_title text, p_summary text, p_changes jsonb,
  p_author_source text default 'aside', p_meta jsonb default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select book_collab_private.submit_delta('proposal', p_book, p_base_revision, p_request_id, p_title, p_summary,
                                          p_changes, p_author_source, p_meta);
$$;

create or replace function public.book_collab_create_backup(
  p_book uuid, p_base_revision uuid, p_request_id uuid, p_title text, p_changes jsonb, p_meta jsonb default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select book_collab_private.submit_delta('backup', p_book, p_base_revision, p_request_id, p_title, '',
                                          p_changes, 'admin', p_meta);
$$;

-- 4-7. 응답을 못 받은 요청 결과 확인
create or replace function public.book_collab_get_request_result(p_book uuid, p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  r public.tr_book_revision_requests;
  h public.tr_book_revision_heads;
begin
  v_actor := book_collab_private.require_admin(p_book);
  select * into h from public.tr_book_revision_heads where book_id = p_book;
  select * into r from public.tr_book_revision_requests where book_id = p_book and request_id = p_request_id and actor_id = v_actor;
  if not found then
    return jsonb_build_object('found', false, 'current_head_revision_id', h.head_revision_id, 'current_head_seq', h.head_seq);
  end if;
  return jsonb_build_object('found', true, 'operation', r.operation, 'result', r.result,
    'current_head_revision_id', h.head_revision_id, 'current_head_seq', h.head_seq);
end $$;

-- 4-8. 읽음 (실제 상세를 연 항목만, 멱등)
create or replace function public.book_collab_mark_seen(p_revision uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.tr_book_revisions;
  v_actor uuid;
begin
  select * into r from public.tr_book_revisions where id = p_revision;
  if not found then
    raise exception 'BOOK_COLLAB_FORBIDDEN: 이 책의 협업 권한이 없어요' using errcode = '42501';
  end if;
  v_actor := book_collab_private.require_admin(r.book_id);
  perform book_collab_private.locked_head(r.book_id);
  insert into public.tr_book_revision_receipts (user_id, revision_id) values (v_actor, p_revision)
  on conflict (user_id, revision_id) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- 4-9. 불러오기 완료 기록 (고정 event id로 중복 방지)
create or replace function public.book_collab_record_load(
  p_book uuid, p_event_id uuid, p_revision uuid, p_backup_revision uuid,
  p_working_copy_id text, p_device_id text, p_tab_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid;
  e public.tr_book_revision_load_events;
begin
  v_actor := book_collab_private.require_admin(p_book);
  perform book_collab_private.locked_head(p_book);
  if p_event_id is null or not exists (select 1 from public.tr_book_revisions r where r.id = p_revision and r.book_id = p_book)
     or (p_backup_revision is not null and not exists (
           select 1 from public.tr_book_revisions r where r.id = p_backup_revision and r.book_id = p_book and r.kind = 'backup')) then
    raise exception 'BOOK_COLLAB_INVALID: 불러오기 기록' using errcode = '22023';
  end if;
  select * into e from public.tr_book_revision_load_events where id = p_event_id;
  if found then
    if e.user_id <> v_actor or e.book_id <> p_book or e.revision_id <> p_revision
       or e.backup_revision_id is distinct from p_backup_revision then
      raise exception 'BOOK_COLLAB_REQUEST_REUSED: 같은 기록 번호로 다른 내용을 보낼 수 없어요' using errcode = '22023';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  insert into public.tr_book_revision_load_events (id, book_id, user_id, revision_id, backup_revision_id,
                                                   working_copy_id, device_id, tab_id)
  values (p_event_id, p_book, v_actor, p_revision, p_backup_revision,
          left(coalesce(p_working_copy_id, ''), 100), left(coalesce(p_device_id, ''), 100), left(coalesce(p_tab_id, ''), 100));
  return jsonb_build_object('ok', true, 'replayed', false);
end $$;

-- 4-10. 협업 책의 이름·공개·대상·설정·휴지통 (본문 버전과 별개)
create or replace function public.book_collab_update_metadata(p_book uuid, p_request_id uuid, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid;
  h public.tr_book_revision_heads;
  v_hash text;
  v_prev jsonb;
  k text;
  d public.tr_book_documents;
  v_result jsonb;
begin
  v_actor := book_collab_private.require_admin(p_book);
  h := book_collab_private.locked_head(p_book);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'BOOK_COLLAB_INVALID: 변경 형식' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'is_active', 'audience_mode', 'allow_print', 'view_confirm', 'description', 'role', 'sort_order', 'trash') then
      raise exception 'BOOK_COLLAB_INVALID: 바꿀 수 없는 항목 (%)', k using errcode = '22023';
    end if;
  end loop;
  v_hash := book_collab_private.request_hash(jsonb_build_object('op', 'metadata', 'book', p_book, 'patch', p_patch));
  v_prev := book_collab_private.replay(p_book, p_request_id, 'metadata', v_actor, v_hash);
  if v_prev is not null then return v_prev; end if;

  if p_patch ? 'title' and (jsonb_typeof(p_patch->'title') <> 'string' or btrim(p_patch->>'title') = '' or length(p_patch->>'title') > 200) then
    raise exception 'BOOK_COLLAB_INVALID: 책 이름' using errcode = '22023';
  end if;
  if p_patch ? 'audience_mode' and coalesce(p_patch->>'audience_mode', '') not in ('all', 'selected') then
    raise exception 'BOOK_COLLAB_INVALID: 공개 대상' using errcode = '22023';
  end if;
  if p_patch ? 'role' and coalesce(p_patch->>'role', '') not in ('regular', 'australia', 'etc') then
    raise exception 'BOOK_COLLAB_INVALID: 역할' using errcode = '22023';
  end if;
  if (p_patch ? 'is_active' and jsonb_typeof(p_patch->'is_active') <> 'boolean')
     or (p_patch ? 'allow_print' and jsonb_typeof(p_patch->'allow_print') <> 'boolean')
     or (p_patch ? 'view_confirm' and jsonb_typeof(p_patch->'view_confirm') <> 'boolean')
     or (p_patch ? 'trash' and jsonb_typeof(p_patch->'trash') <> 'boolean')
     or (p_patch ? 'sort_order' and jsonb_typeof(p_patch->'sort_order') <> 'number')
     or (p_patch ? 'description' and jsonb_typeof(p_patch->'description') not in ('string', 'null')) then
    raise exception 'BOOK_COLLAB_INVALID: 값 형식' using errcode = '22023';
  end if;

  update public.tr_book_documents set
    title         = case when p_patch ? 'title' then btrim(p_patch->>'title') else title end,
    is_active     = case when p_patch ? 'trash' and (p_patch->>'trash')::boolean then false
                         when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    audience_mode = case when p_patch ? 'audience_mode' then p_patch->>'audience_mode' else audience_mode end,
    allow_print   = case when p_patch ? 'allow_print' then (p_patch->>'allow_print')::boolean else allow_print end,
    view_confirm  = case when p_patch ? 'view_confirm' then (p_patch->>'view_confirm')::boolean else view_confirm end,
    description   = case when p_patch ? 'description' then p_patch->>'description' else description end,
    role          = case when p_patch ? 'role' then p_patch->>'role' else role end,
    sort_order    = case when p_patch ? 'sort_order' then (p_patch->>'sort_order')::numeric::int else sort_order end,
    deleted_at    = case when p_patch ? 'trash' then (case when (p_patch->>'trash')::boolean then now() else null end) else deleted_at end
  where id = p_book
  returning * into d;

  v_result := jsonb_build_object('ok', true, 'book', jsonb_build_object('id', d.id, 'title', d.title, 'is_active', d.is_active,
    'audience_mode', d.audience_mode, 'allow_print', d.allow_print, 'view_confirm', d.view_confirm,
    'description', d.description, 'role', d.role, 'sort_order', d.sort_order, 'deleted_at', d.deleted_at));
  return book_collab_private.remember(p_book, p_request_id, 'metadata', v_actor, v_hash, v_result);
end $$;

-- ---------------------------------------------------------------------
-- 5. 운영자 전용 (SQL 편집기에서만, 브라우저 역할 실행 불가)
-- ---------------------------------------------------------------------
-- 한 트랜잭션: 기존 쓰기와 충돌하는 짧은 잠금 → 조건 확인 → 그 시점 본문으로 baseline → 보호/활성화
create or replace function public.book_collab_activate(p_book uuid, p_admin_ids uuid[]) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  d public.tr_book_documents;
  h public.tr_book_revision_heads;
  v_rev uuid;
  v_seq int;
  v_live int;
  v_deleted int;
  v_versions int;
  v_normalized int := 0;
  pg record;
  v_admin uuid;
  v_has_head boolean;
begin
  perform pg_catalog.set_config('lock_timeout', '10s', true);
  lock table public.tr_book_documents, public.tr_book_pages, public.tr_book_page_versions in share row exclusive mode;
  perform book_collab_private.lock_book(p_book);

  select * into d from public.tr_book_documents where id = p_book for update;
  if not found or d.kind <> 'pages' or d.deleted_at is not null then
    raise exception 'BOOK_COLLAB_ACTIVATE: 페이지형 책이 아니거나 휴지통에 있어요';
  end if;
  if d.is_active
     or exists (select 1 from public.tr_book_memos m where m.book_id = p_book)
     or exists (select 1 from public.tr_book_progress g where g.book_id = p_book)
     or exists (select 1 from public.tr_book_access a where a.book_id = p_book) then
    raise exception 'BOOK_COLLAB_ACTIVATE: 공개 중이거나 학생 기록이 있는 책은 초기 전환 대상이 아니에요';
  end if;
  if p_admin_ids is null or cardinality(p_admin_ids) = 0 then
    raise exception 'BOOK_COLLAB_ACTIVATE: 관리자 Auth 계정이 필요해요';
  end if;
  foreach v_admin in array p_admin_ids loop
    if not exists (select 1 from auth.users u where u.id = v_admin) then
      raise exception 'BOOK_COLLAB_ACTIVATE: Auth 계정을 찾을 수 없어요 (%)', v_admin;
    end if;
  end loop;

  select * into h from public.tr_book_revision_heads where book_id = p_book for update;
  v_has_head := found;
  if v_has_head and h.enabled then
    raise exception 'BOOK_COLLAB_ACTIVATE: 이미 켜져 있어요';
  end if;
  if not exists (select 1 from public.tr_book_pages where book_id = p_book and deleted_at is null) then
    raise exception 'BOOK_COLLAB_ACTIVATE: 쪽이 없어요';
  end if;

  -- 살아 있는 쪽 순서를 1..N으로 정규화 (순서 자체는 유지)
  with ranked as (
    select id, row_number() over (order by sort_order, created_at, id) as rn
      from public.tr_book_pages where book_id = p_book and deleted_at is null)
  update public.tr_book_pages p set sort_order = r.rn from ranked r
   where p.id = r.id and p.sort_order is distinct from r.rn::int;
  get diagnostics v_normalized = row_count;

  if not v_has_head then
    insert into public.tr_book_revision_heads (book_id, head_revision_id, head_seq, enabled)
    values (p_book, null, 0, false);
    select * into h from public.tr_book_revision_heads where book_id = p_book for update;
  end if;
  v_seq := h.head_seq + 1;

  insert into public.tr_book_revisions (book_id, kind, seq, base_revision_id, author_source, submitted_label,
                                        title, summary, scope, source_links, manifest_complete)
  values (p_book, 'baseline', v_seq, h.head_revision_id, 'system', 'system',
          case when h.head_revision_id is null then '기존 저장본 가져옴' else '협업 재활성화 기준본' end,
          '', jsonb_build_object('pages', '[]'::jsonb, 'structure', '[]'::jsonb), '[]'::jsonb, true)
  returning id into v_rev;

  for pg in select id, sort_order, blocks, html, deleted_at from public.tr_book_pages where book_id = p_book loop
    insert into public.tr_book_revision_entries (revision_id, book_id, page_uid, payload_id, sort_order, is_deleted)
    values (v_rev, p_book, pg.id,
            book_collab_private.payload_for(p_book, pg.id, coalesce(pg.blocks, '[]'::jsonb), coalesce(pg.html, ''), ''),
            case when pg.deleted_at is null then pg.sort_order else null end,
            pg.deleted_at is not null);
  end loop;

  foreach v_admin in array p_admin_ids loop
    insert into public.tr_book_revision_admins (book_id, auth_user_id, role) values (p_book, v_admin, 'owner')
    on conflict (book_id, auth_user_id) do nothing;
  end loop;

  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    into v_live, v_deleted from public.tr_book_pages where book_id = p_book;
  select count(*) into v_versions from public.tr_book_page_versions where book_id = p_book;
  if (select count(*) from public.tr_book_revision_entries where revision_id = v_rev) <> v_live + v_deleted then
    raise exception 'BOOK_COLLAB_ACTIVATE: 기준본 검증 실패';
  end if;

  update public.tr_book_documents set total_pages = v_live where id = p_book and total_pages is distinct from v_live;
  update public.tr_book_revision_heads
     set head_revision_id = v_rev, head_seq = v_seq, enabled = true, updated_at = now()
   where book_id = p_book;

  return jsonb_build_object('ok', true, 'baseline_revision_id', v_rev, 'seq', v_seq,
    'pages_live', v_live, 'pages_deleted', v_deleted, 'legacy_versions_kept', v_versions,
    'sort_order_normalized', v_normalized, 'admins', to_jsonb(p_admin_ids));
end $$;

-- 비상 정지: 협업 저장을 멈추고 옛 편집기 쓰기를 다시 허용 (이력은 그대로). 다시 켜면 새 기준본을 만든다.
create or replace function public.book_collab_deactivate(p_book uuid) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform book_collab_private.lock_book(p_book);
  update public.tr_book_revision_heads set enabled = false, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------------
-- 6. 소유자·실행 권한
-- ---------------------------------------------------------------------
-- 소유자 변경에는 새 소유자의 스키마 CREATE 권한이 필요하다. 지정 후 바로 회수한다.
grant create on schema public, book_collab_private to book_collab_writer;

do $$
declare f text;
begin
  -- 내부 도우미: 전용 실행 역할 소유
  foreach f in array array[
    'book_collab_private.lock_book(uuid)', 'book_collab_private.is_protected(uuid)',
    'book_collab_private.actor()', 'book_collab_private.actor_label()', 'book_collab_private.require_admin(uuid)',
    'book_collab_private.locked_head(uuid)', 'book_collab_private.request_hash(jsonb)',
    'book_collab_private.replay(uuid,uuid,text,uuid,text)', 'book_collab_private.remember(uuid,uuid,text,uuid,text,jsonb)',
    'book_collab_private.html_problem(text,uuid)', 'book_collab_private.insert_after(uuid[],uuid,uuid)',
    'book_collab_private.plan_changes(uuid,uuid,jsonb)', 'book_collab_private.payload_for(uuid,uuid,jsonb,text,text)',
    'book_collab_private.assert_structure_allowed(uuid)', 'book_collab_private.validate_links(uuid,jsonb)',
    'book_collab_private.label_text(text,integer)',
    'book_collab_private.submit_delta(text,uuid,uuid,uuid,text,text,jsonb,text,jsonb)',
    'public.book_collab_status(uuid[])', 'public.book_collab_get_state(uuid,boolean)',
    'public.book_collab_list_revisions(uuid,integer)', 'public.book_collab_get_revision(uuid,boolean)',
    'public.book_collab_commit(uuid,uuid,uuid,jsonb,text,text,jsonb)',
    'public.book_collab_submit_proposal(uuid,uuid,uuid,text,text,jsonb,text,jsonb)',
    'public.book_collab_create_backup(uuid,uuid,uuid,text,jsonb,jsonb)',
    'public.book_collab_get_request_result(uuid,uuid)', 'public.book_collab_mark_seen(uuid)',
    'public.book_collab_record_load(uuid,uuid,uuid,uuid,text,text,text)',
    'public.book_collab_update_metadata(uuid,uuid,jsonb)'] loop
    execute format('alter function %s owner to book_collab_writer', f);
  end loop;
  -- Supabase는 새 함수에 anon/authenticated/service_role 실행 권한을 기본 부여하므로 전부 먼저 회수
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'book_collab_private')
        or (n.nspname = 'public' and p.proname like 'book\_collab\_%')
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on function %s from service_role', f);
    end if;
  end loop;
  -- 보호 트리거는 쓰는 역할 권한으로 실행되므로 보호 판정만 모두에게 허용
  execute 'grant execute on function book_collab_private.is_protected(uuid) to public';
  execute 'grant execute on function book_collab_private.lock_book(uuid) to public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.book_collab_status(uuid[]) to anon';
    foreach f in array array['public.book_collab_activate(uuid,uuid[])', 'public.book_collab_deactivate(uuid)'] loop
      execute format('revoke all on function %s from anon', f);
    end loop;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach f in array array[
      'public.book_collab_status(uuid[])', 'public.book_collab_get_state(uuid,boolean)',
      'public.book_collab_list_revisions(uuid,integer)', 'public.book_collab_get_revision(uuid,boolean)',
      'public.book_collab_commit(uuid,uuid,uuid,jsonb,text,text,jsonb)',
      'public.book_collab_submit_proposal(uuid,uuid,uuid,text,text,jsonb,text,jsonb)',
      'public.book_collab_create_backup(uuid,uuid,uuid,text,jsonb,jsonb)',
      'public.book_collab_get_request_result(uuid,uuid)', 'public.book_collab_mark_seen(uuid)',
      'public.book_collab_record_load(uuid,uuid,uuid,uuid,text,text,text)',
      'public.book_collab_update_metadata(uuid,uuid,jsonb)'] loop
      execute format('grant execute on function %s to authenticated', f);
    end loop;
    foreach f in array array['public.book_collab_activate(uuid,uuid[])', 'public.book_collab_deactivate(uuid)'] loop
      execute format('revoke all on function %s from authenticated', f);
    end loop;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array array['public.book_collab_activate(uuid,uuid[])', 'public.book_collab_deactivate(uuid)'] loop
      execute format('revoke all on function %s from service_role', f);
    end loop;
  end if;
end $$;

revoke create on schema public, book_collab_private from book_collab_writer;

commit;
