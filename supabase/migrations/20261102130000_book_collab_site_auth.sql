-- =====================================================================
-- 입문서 버전 협업 — 기존 관리자 로그인 수준으로 사용 (2026-11-02)
--
-- 대표 결정: 사이트 전체 보안 작업을 따로 하므로, 지금은 버전 협업에 별도 서버 로그인을 요구하지 않는다.
--   * 책별 auth_mode: 'site' = 기존 관리자 화면 수준(브라우저 공용 키로 호출), 'jwt' = 서버 인증 + 책 관리자 목록 필수.
--   * 보안 작업 때 해당 책을 'jwt'로 바꾸면 된다(관리자 Auth 계정을 목록에 넣은 뒤).
--   * 옛 방식 직접 수정·삭제 차단, 원자 저장, 충돌 차단, 이력 불변은 그대로다.
--   * 'site' 모드의 보호 수준은 사이트의 다른 관리자 기능과 같다(공용 키를 가진 사람은 함수를 부를 수 있음).
-- =====================================================================

begin;

alter table public.tr_book_revision_heads
  add column if not exists auth_mode text not null default 'site' check (auth_mode in ('site', 'jwt'));

-- 'site' 모드의 요청자(사람 식별 없음). Auth 계정이 아니므로 작성자 외래키를 풀고 표시 이름으로 남긴다.
alter table public.tr_book_revisions drop constraint if exists tr_book_revisions_submitted_by_fkey;

create or replace function book_collab_private.site_actor() returns uuid
language sql immutable set search_path = '' as $$
  select '00000000-0000-4000-8000-00000000ad01'::uuid;
$$;

create or replace function book_collab_private.actor_label() returns text
language plpgsql stable set search_path = '' as $$
declare c jsonb;
begin
  begin
    c := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then c := null;
  end;
  return left(coalesce(nullif(c->>'email', ''), '관리자'), 200);
end $$;

create or replace function book_collab_private.require_admin(p_book uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid;
  m text;
begin
  if p_book is null then
    raise exception 'BOOK_COLLAB_FORBIDDEN: 이 책의 협업 권한이 없어요' using errcode = '42501';
  end if;
  select h.auth_mode into m from public.tr_book_revision_heads h where h.book_id = p_book;
  if coalesce(m, 'site') = 'site' then
    return book_collab_private.site_actor();
  end if;
  v := book_collab_private.actor();
  if not exists (select 1 from public.tr_book_revision_admins a where a.book_id = p_book and a.auth_user_id = v) then
    raise exception 'BOOK_COLLAB_FORBIDDEN: 이 책의 협업 권한이 없어요' using errcode = '42501';
  end if;
  return v;
end $$;
-- 소유자 변경에는 새 소유자의 스키마 CREATE 권한이 필요하다. 지정 직후 회수한다.
grant create on schema book_collab_private to book_collab_writer;
alter function book_collab_private.site_actor() owner to book_collab_writer;
revoke create on schema book_collab_private from book_collab_writer;
revoke all on function book_collab_private.site_actor() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function book_collab_private.site_actor() from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function book_collab_private.site_actor() from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'revoke all on function book_collab_private.site_actor() from service_role'; end if;
end $$;

-- 활성화: 관리자 목록이 비어 있으면 'site', 있으면 'jwt'
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
  v_mode text := case when p_admin_ids is null or cardinality(p_admin_ids) = 0 then 'site' else 'jwt' end;
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
  if v_mode = 'jwt' then
    foreach v_admin in array p_admin_ids loop
      if not exists (select 1 from auth.users u where u.id = v_admin) then
        raise exception 'BOOK_COLLAB_ACTIVATE: Auth 계정을 찾을 수 없어요 (%)', v_admin;
      end if;
    end loop;
  end if;

  select * into h from public.tr_book_revision_heads where book_id = p_book for update;
  v_has_head := found;
  if v_has_head and h.enabled then
    raise exception 'BOOK_COLLAB_ACTIVATE: 이미 켜져 있어요';
  end if;
  if not exists (select 1 from public.tr_book_pages where book_id = p_book and deleted_at is null) then
    raise exception 'BOOK_COLLAB_ACTIVATE: 쪽이 없어요';
  end if;

  with ranked as (
    select id, row_number() over (order by sort_order, created_at, id) as rn
      from public.tr_book_pages where book_id = p_book and deleted_at is null)
  update public.tr_book_pages p set sort_order = r.rn from ranked r
   where p.id = r.id and p.sort_order is distinct from r.rn::int;
  get diagnostics v_normalized = row_count;

  if not v_has_head then
    insert into public.tr_book_revision_heads (book_id, head_revision_id, head_seq, enabled, auth_mode)
    values (p_book, null, 0, false, v_mode);
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

  if v_mode = 'jwt' then
    foreach v_admin in array p_admin_ids loop
      insert into public.tr_book_revision_admins (book_id, auth_user_id, role) values (p_book, v_admin, 'owner')
      on conflict (book_id, auth_user_id) do nothing;
    end loop;
  end if;

  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    into v_live, v_deleted from public.tr_book_pages where book_id = p_book;
  select count(*) into v_versions from public.tr_book_page_versions where book_id = p_book;
  if (select count(*) from public.tr_book_revision_entries where revision_id = v_rev) <> v_live + v_deleted then
    raise exception 'BOOK_COLLAB_ACTIVATE: 기준본 검증 실패';
  end if;

  update public.tr_book_documents set total_pages = v_live where id = p_book and total_pages is distinct from v_live;
  update public.tr_book_revision_heads
     set head_revision_id = v_rev, head_seq = v_seq, enabled = true, auth_mode = v_mode, updated_at = now()
   where book_id = p_book;

  return jsonb_build_object('ok', true, 'baseline_revision_id', v_rev, 'seq', v_seq, 'auth_mode', v_mode,
    'pages_live', v_live, 'pages_deleted', v_deleted, 'legacy_versions_kept', v_versions,
    'sort_order_normalized', v_normalized, 'admins', to_jsonb(coalesce(p_admin_ids, '{}'::uuid[])));
end $$;
revoke all on function public.book_collab_activate(uuid, uuid[]) from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.book_collab_activate(uuid,uuid[]) from %I', r);
    end if;
  end loop;
end $$;

-- 'site' 모드: 기존 관리자 화면(공용 키)에서 협업 함수를 부를 수 있게 한다. 운영자 함수는 제외.
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach f in array array[
      'public.book_collab_get_state(uuid,boolean)',
      'public.book_collab_list_revisions(uuid,integer)', 'public.book_collab_get_revision(uuid,boolean)',
      'public.book_collab_commit(uuid,uuid,uuid,jsonb,text,text,jsonb)',
      'public.book_collab_submit_proposal(uuid,uuid,uuid,text,text,jsonb,text,jsonb)',
      'public.book_collab_create_backup(uuid,uuid,uuid,text,jsonb,jsonb)',
      'public.book_collab_get_request_result(uuid,uuid)', 'public.book_collab_mark_seen(uuid)',
      'public.book_collab_record_load(uuid,uuid,uuid,uuid,text,text,text)',
      'public.book_collab_update_metadata(uuid,uuid,jsonb)'] loop
      execute format('grant execute on function %s to anon', f);
    end loop;
  end if;
end $$;

commit;
