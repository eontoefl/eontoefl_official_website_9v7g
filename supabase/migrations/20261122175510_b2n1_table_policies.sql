-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-1: 표 14개에 로그인 역할용 최종 규칙 (2026-11-23)
--
-- 왜: 대상 표 14개의 32칸(표·동작)은 지금 "비로그인 역할"에만 열려 있어, 새 로그인으로 들어온
--     요청(authenticated)에는 그 칸에 적용되는 허용 규칙이 0개다(읽기·수정·삭제가 오류 없이 0행).
--     이 파일은 로그인 역할 전용의 최종 규칙 27개를 더한다.
--
-- 하는 것
--   * 새 규칙 27개. 전부 permissive, to authenticated, 이름은 b2n1_ 로 시작.
--     판정은 2-가(20261122164348_b2a_identity_gate.sql)의 함수를 (select security_private.…()) 꼴로 쓴다.
--       문제 표 8개   UPDATE  관리자(USING·WITH CHECK)                  8개
--       문제 표 10개  DELETE  관리자                                    10개
--       aus_intspk          SELECT  로그인한 회원 또는 관리자           1개
--       toefl_actual_scores SELECT  본인 행 또는 관리자                 1개
--       toefl_actual_scores INSERT·UPDATE·DELETE  관리자                3개
--       note3_store         SELECT·INSERT·UPDATE·DELETE  관리자         4개
--
-- 하지 않는 것
--   * 기존 규칙(옛 비로그인 규칙 포함)·표 권한(GRANT)·RLS 설정은 하나도 바꾸지 않는다.
--     옛 규칙을 지우는 것은 전환 때의 일이다.
--   * 일부러 규칙을 주지 않는 5칸(두 사이트 코드에서 그 동작을 부르는 곳을 찾지 못함):
--       tr_listening_response UPDATE, tr_writing_arrange UPDATE,
--       tr_writing_ko_data UPDATE·DELETE, aus_intspk UPDATE
--   * reviews(2칸)는 이 계약에서 제외. aus_intspk DELETE(지금도 규칙 없음)와
--     이미 모든 역할에 열려 있는 칸(문제 자료 SELECT·INSERT, aus_intspk INSERT)도 건드리지 않는다.
--
-- 알아 둘 것
--   * "관리자" = security_private.is_current_admin() (명부 + 6자리 완료 + 살아 있는 로그인 상태).
--     "회원"   = security_private.current_member_id() 가 NULL 이 아님(대응표에 있는 로그인 계정).
--   * 수정·삭제는 그 행이 읽기 규칙으로도 보여야 된다. 문제 표는 읽기가 모든 역할에 열려 있고,
--     성적·노트는 관리자 읽기 규칙을 함께 넣었다.
--   * 되돌리기: supabase/migrations_rollback/20261122175510_b2n1_table_policies_rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. 전제 확인 (하나라도 어긋나면 예외로 멈춘다 — 아무것도 만들어지지 않는다)
--    끝의 자기 점검과 견주려고 기존 규칙의 수와 지문을 이 트랜잭션 안에만 적어 둔다.
-- ---------------------------------------------------------------------
do $b2n1_pre$
declare
  v_tables constant text[] := array[
    'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
    'tr_listening_response', 'tr_reading_academic', 'tr_speaking_interview',
    'tr_speaking_repeat', 'tr_writing_arrange', 'tr_writing_discussion',
    'tr_writing_email', 'tr_writing_ko_data',
    'aus_intspk', 'toefl_actual_scores', 'note3_store'
  ];
  v_table text;
  v_rls   boolean;
  v_count bigint;
  v_fp    text;
begin
  if pg_catalog.to_regprocedure('security_private.current_member_id()') is null
     or pg_catalog.to_regprocedure('security_private.is_current_admin()') is null
     or pg_catalog.to_regprocedure('security_private.current_session()') is null then
    raise exception 'b2n1 전제 실패: 2-가의 판정 함수(current_member_id·is_current_admin·current_session)가 없다';
  end if;

  if not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.current_member_id()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated'::pg_catalog.name, 'security_private.is_current_admin()', 'EXECUTE') then
    raise exception 'b2n1 전제 실패: authenticated 에 판정 함수 실행 권한이 없다';
  end if;

  foreach v_table in array v_tables loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception 'b2n1 전제 실패: 표 public.% 가 없다', v_table;
    end if;
    select c.relrowsecurity
      into v_rls
      from pg_catalog.pg_class c
     where c.oid = pg_catalog.to_regclass('public.' || v_table);
    if v_rls is not true then
      raise exception 'b2n1 전제 실패: 표 public.% 의 RLS가 꺼져 있다', v_table;
    end if;
  end loop;

  select pg_catalog.count(*)
    into v_count
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename::pg_catalog.text = any (v_tables)
     and p.policyname like 'b2n1\_%';
  if v_count <> 0 then
    raise exception 'b2n1 전제 실패: b2n1_ 로 시작하는 규칙이 이미 % 개 있다(먼저 되돌리기 SQL)', v_count;
  end if;

  select pg_catalog.count(*),
         pg_catalog.md5(coalesce(pg_catalog.string_agg(
           p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::pg_catalog.text || '|'
           || p.cmd || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''),
           E'\n' order by p.tablename, p.policyname), ''))
    into v_count, v_fp
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename::pg_catalog.text = any (v_tables);

  perform pg_catalog.set_config('b2n1.pre_policy_count', v_count::pg_catalog.text, true);
  perform pg_catalog.set_config('b2n1.pre_policy_fp', v_fp, true);
end;
$b2n1_pre$;

-- ---------------------------------------------------------------------
-- 1. 문제 표 8개 — UPDATE: 관리자 (바꾸기 전 행과 바꾼 뒤 행 둘 다 검사)
--    근거: 관리자 화면 admin-questions.html 이 수정을 부른다.
-- ---------------------------------------------------------------------
create policy b2n1_admin_update on public.tr_listening_announcement
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_listening_conversation
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_listening_lecture
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_reading_academic
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_speaking_interview
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_speaking_repeat
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_writing_discussion
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.tr_writing_email
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

-- ---------------------------------------------------------------------
-- 2. 문제 표 10개 — DELETE: 관리자
--    근거: 관리자 화면이 삭제를 부른다. tr_listening_response·tr_writing_arrange 는
--          "삭제 뒤 다시 넣기" 방식이다(넣기는 이미 모든 역할에 열려 있다).
-- ---------------------------------------------------------------------
create policy b2n1_admin_delete on public.tr_listening_announcement
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_listening_conversation
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_listening_lecture
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_reading_academic
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_speaking_interview
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_speaking_repeat
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_writing_discussion
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_writing_email
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_listening_response
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.tr_writing_arrange
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

-- ---------------------------------------------------------------------
-- 3. aus_intspk — SELECT: 로그인한 회원 또는 관리자
--    근거: 학생이 첨삭 문제를 읽고(전체 행), 관리자가 읽는다.
-- ---------------------------------------------------------------------
create policy b2n1_member_or_admin_select on public.aus_intspk
  as permissive for select to authenticated
  using (
    (select security_private.current_member_id()) is not null
    or (select security_private.is_current_admin())
  );

-- ---------------------------------------------------------------------
-- 4. toefl_actual_scores — SELECT: 본인 행 또는 관리자 / INSERT·UPDATE·DELETE: 관리자
--    근거: 학생은 자기 성적만 읽는다. 등록·수정·삭제는 관리자 화면만 한다.
-- ---------------------------------------------------------------------
create policy b2n1_own_or_admin_select on public.toefl_actual_scores
  as permissive for select to authenticated
  using (
    user_id = (select security_private.current_member_id())
    or (select security_private.is_current_admin())
  );

create policy b2n1_admin_insert on public.toefl_actual_scores
  as permissive for insert to authenticated
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.toefl_actual_scores
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.toefl_actual_scores
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

-- ---------------------------------------------------------------------
-- 5. note3_store — SELECT·INSERT·UPDATE·DELETE: 관리자 (대표 개인 도구)
-- ---------------------------------------------------------------------
create policy b2n1_admin_select on public.note3_store
  as permissive for select to authenticated
  using ((select security_private.is_current_admin()));

create policy b2n1_admin_insert on public.note3_store
  as permissive for insert to authenticated
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_update on public.note3_store
  as permissive for update to authenticated
  using ((select security_private.is_current_admin()))
  with check ((select security_private.is_current_admin()));

create policy b2n1_admin_delete on public.note3_store
  as permissive for delete to authenticated
  using ((select security_private.is_current_admin()));

-- ---------------------------------------------------------------------
-- 6. 자기 점검 (같은 트랜잭션. 어긋나면 예외 → 전체 되돌아감)
--    (가) 새 규칙이 아래 "규칙 표"와 정확히 같다: 표·이름·동작·역할(authenticated 하나)·permissive·
--         USING/WITH CHECK 의 있고 없음·조건식에 들어 있는 판정 함수.
--    (나) b2n1_ 규칙이 표에 없는 곳에 생기지 않았다(총 27개, 일부러 주지 않는 5칸과 reviews 에 0개).
--    (다) 기존 규칙(b2n1_ 가 아닌 것)의 수와 지문이 이 파일의 맨 앞에서 적어 둔 것과 같다.
--    이 점검의 통과는 supabase/tests/b2n1_table_policies/절차.md 의 시험을 대신하지 않는다.
-- ---------------------------------------------------------------------
do $b2n1_check$
declare
  v_tables constant text[] := array[
    'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
    'tr_listening_response', 'tr_reading_academic', 'tr_speaking_interview',
    'tr_speaking_repeat', 'tr_writing_arrange', 'tr_writing_discussion',
    'tr_writing_email', 'tr_writing_ko_data',
    'aus_intspk', 'toefl_actual_scores', 'note3_store'
  ];
  v_want  record;
  v_got   record;
  v_count bigint;
  v_fp    text;
  v_seen  integer := 0;
begin
  -- (가) 규칙 표: 표, 이름, 동작, USING 있음, WITH CHECK 있음, 회원 판정 함수를 쓰는가
  for v_want in
    select t.tbl, t.pol, t.cmd, t.has_using, t.has_check, t.uses_member
      from (
        values
          ('tr_listening_announcement'::pg_catalog.text, 'b2n1_admin_update'::pg_catalog.text, 'UPDATE'::pg_catalog.text, true, true, false),
          ('tr_listening_conversation', 'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_listening_lecture',      'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_reading_academic',       'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_speaking_interview',     'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_speaking_repeat',        'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_writing_discussion',     'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_writing_email',          'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('tr_listening_announcement', 'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_listening_conversation', 'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_listening_lecture',      'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_reading_academic',       'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_speaking_interview',     'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_speaking_repeat',        'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_writing_discussion',     'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_writing_email',          'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_listening_response',     'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('tr_writing_arrange',        'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('aus_intspk',                'b2n1_member_or_admin_select', 'SELECT', true, false, true),
          ('toefl_actual_scores',       'b2n1_own_or_admin_select',    'SELECT', true, false, true),
          ('toefl_actual_scores',       'b2n1_admin_insert', 'INSERT', false, true,  false),
          ('toefl_actual_scores',       'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('toefl_actual_scores',       'b2n1_admin_delete', 'DELETE', true,  false, false),
          ('note3_store',               'b2n1_admin_select', 'SELECT', true,  false, false),
          ('note3_store',               'b2n1_admin_insert', 'INSERT', false, true,  false),
          ('note3_store',               'b2n1_admin_update', 'UPDATE', true,  true,  false),
          ('note3_store',               'b2n1_admin_delete', 'DELETE', true,  false, false)
      ) as t(tbl, pol, cmd, has_using, has_check, uses_member)
  loop
    v_seen := v_seen + 1;

    select p.permissive, p.roles::pg_catalog.text as roles_text, p.cmd, p.qual, p.with_check
      into v_got
      from pg_catalog.pg_policies p
     where p.schemaname = 'public'
       and p.tablename::pg_catalog.text = v_want.tbl
       and p.policyname::pg_catalog.text = v_want.pol;
    if not found then
      raise exception 'b2n1 자기 점검 실패: 규칙 %.% 가 없음', v_want.tbl, v_want.pol;
    end if;

    if v_got.permissive <> 'PERMISSIVE' then
      raise exception 'b2n1 자기 점검 실패: 규칙 %.% 가 permissive 가 아님', v_want.tbl, v_want.pol;
    end if;
    if v_got.roles_text <> '{authenticated}' then
      raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 역할이 % (authenticated 하나여야 함)', v_want.tbl, v_want.pol, v_got.roles_text;
    end if;
    if v_got.cmd <> v_want.cmd then
      raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 동작이 % (%여야 함)', v_want.tbl, v_want.pol, v_got.cmd, v_want.cmd;
    end if;
    if (v_got.qual is not null) <> v_want.has_using then
      raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 USING 유무가 규칙 표와 다름', v_want.tbl, v_want.pol;
    end if;
    if (v_got.with_check is not null) <> v_want.has_check then
      raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 WITH CHECK 유무가 규칙 표와 다름', v_want.tbl, v_want.pol;
    end if;

    -- 조건식 안의 판정 함수: 관리자 판정은 전부에 있어야 하고, 회원 판정은 읽기 규칙 둘에만 있어야 한다.
    if v_want.has_using then
      if pg_catalog.strpos(v_got.qual, 'is_current_admin') = 0 then
        raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 USING 에 관리자 판정이 없음', v_want.tbl, v_want.pol;
      end if;
      if (pg_catalog.strpos(v_got.qual, 'current_member_id') > 0) <> v_want.uses_member then
        raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 USING 의 회원 판정 유무가 규칙 표와 다름', v_want.tbl, v_want.pol;
      end if;
    end if;
    if v_want.has_check then
      if pg_catalog.strpos(v_got.with_check, 'is_current_admin') = 0 then
        raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 WITH CHECK 에 관리자 판정이 없음', v_want.tbl, v_want.pol;
      end if;
      if pg_catalog.strpos(v_got.with_check, 'current_member_id') > 0 then
        raise exception 'b2n1 자기 점검 실패: 규칙 %.% 의 WITH CHECK 에 회원 판정이 들어 있음(관리자만이어야 함)', v_want.tbl, v_want.pol;
      end if;
    end if;
  end loop;

  if v_seen <> 27 then
    raise exception 'b2n1 자기 점검 실패: 규칙 표의 줄 수가 % (27이어야 함)', v_seen;
  end if;

  -- (나) b2n1_ 규칙은 DB 전체에서 정확히 27개(표에 없는 곳에 생긴 것이 없다)
  select pg_catalog.count(*)
    into v_count
    from pg_catalog.pg_policies p
   where p.policyname like 'b2n1\_%';
  if v_count <> 27 then
    raise exception 'b2n1 자기 점검 실패: b2n1_ 규칙이 % 개(27이어야 함)', v_count;
  end if;

  -- (다) 기존 규칙의 수와 지문이 그대로
  select pg_catalog.count(*),
         pg_catalog.md5(coalesce(pg_catalog.string_agg(
           p.tablename || '|' || p.policyname || '|' || p.permissive || '|' || p.roles::pg_catalog.text || '|'
           || p.cmd || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''),
           E'\n' order by p.tablename, p.policyname), ''))
    into v_count, v_fp
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename::pg_catalog.text = any (v_tables)
     and p.policyname not like 'b2n1\_%';

  if v_count::pg_catalog.text is distinct from pg_catalog.current_setting('b2n1.pre_policy_count', true) then
    raise exception 'b2n1 자기 점검 실패: 기존 규칙 수가 바뀜(전 % → 후 %)', pg_catalog.current_setting('b2n1.pre_policy_count', true), v_count;
  end if;
  if v_fp is distinct from pg_catalog.current_setting('b2n1.pre_policy_fp', true) then
    raise exception 'b2n1 자기 점검 실패: 기존 규칙의 지문이 바뀜';
  end if;
end;
$b2n1_check$;

commit;
