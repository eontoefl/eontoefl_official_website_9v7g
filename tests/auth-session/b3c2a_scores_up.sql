-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-2a 합성 성적 행 넣기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★
--   운영(qpqjevecjejvbeuogtbx)에서 실행하지 않는다(성적 표에 합성 행이 생긴다).
--   실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 직접 확인한다.
--   아래의 대상 확인 값(set b3c2a.test_project_ref)은 그 확인을 대신하지 않는다 — DB 는 자기 ref 를 스스로 알지 못한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서와 기대 결과는 절차.md 의 3C-2a 부분을 따른다.
-- 표의 모양은 브레인방이 발주 때 읽어 준 것(성적표_구조_시험프로젝트_2026-11-24.json)에 맞췄고, 넣기 전에 그 모양이 지금도 같은지 다시 본다.
--
-- 받는 값(같은 접속의 맨 앞에서 정한다). 합성 회원 셋의 **회원번호**(public.users.id — 로그인 계정 번호가 아니다)는
-- 3-0 의 fixtures_up.sql 이 낸 결과에서 가져온다:
--     set b3c2a.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3c2a.member_a  = '<A 의 회원번호>';
--     set b3c2a.member_b  = '<B 의 회원번호>';
--     set b3c2a.member_gm = '<GM 의 회원번호>';     -- 성적 0건 회원: 행을 넣지 않는다. 0건인지만 확인한다
--
-- 넣기 전에 확인하는 것(하나라도 다르면 **아무것도 넣기 전에** 멈춘다)
--   0. 대상 확인 값
--   1. 표의 모양이 발주 때 읽은 것과 같다: 열 15개의 이름·형·NULL 허용, 트리거 0, 행 수준 보안이 켜져 있음, 규칙의 이름 다섯
--      (Allow all access for anon + b2n1_ 넷). 다르면 이 파일의 값·절차의 기대가 맞지 않을 수 있다 — 멈춘다
--   2. 회원번호 셋: uuid 모양이고 서로 다르며, public.users 에 그 번호의 행이 있고 그 이메일이 합성 회원의 모양
--      (zz…@member.zz….invalid)이며, 로그인 계정과의 대응(security_private.member_identity)이 있다
--   3. 겹침: 그 세 회원의 성적 행이 지금 0건이고, 합성 표식(zzb3c2a)이 붙은 성적 행이 0건이다
--
-- 넣는 것: public.toefl_actual_scores 3행(값은 tests/auth-session/scores-fixture.mjs 와 같다 — 회귀시험이 두 곳의 글자를 견준다)
--     표식  주인  test_date    reading listening speaking writing overall legacy_total
--     A1    A     1999-01-11   3.0     3.0       3.0      3.0     3.0     NULL
--     A2    A     1999-03-13   4.5     3.5       2.5      5.5     4.0     81       ← A 의 가장 최근 성적(화면이 점수 칸에 미리 채운다)
--     B1    B     1999-02-12   2.0     2.5       1.5      2.0     2.0     45
--   user_id = 그 회원의 회원번호, user_email = 그 회원의 회원 표 이메일, user_name·memo = 'zzb3c2a <표식>', score_image = NULL.
--   id·created_at·updated_at 은 표의 기본값. 점수는 제약(1.0~6.0, legacy_total 0~120) 안이다. 날짜는 일부러 1999년이다.
--
-- 마지막 결과(한 칸 jsonb). scores-up.json 으로 저장한다.
--   created      넣은 행의 정확한 값: rows[{tag, id, user_id, print}] 3(print 는 그 행의 지문), members{a,b,gm}
--   down_input   created 를 한 줄 글자로 쓴 것 — b3c2a_scores_down.sql · b3c2a_scores_state.sql 에 그대로 넘긴다
--   ids_filter   서버 경계의 대조(절차의 (iii))에 쓰는 조건의 글자: id=in.(<넣은 행의 번호 셋>) — 모든 대조 요청에 이 조건을 붙인다
--   zero_member_rows  GM 의 성적 행 수(0 이어야 한다)
--   outside      합성 행이 아닌 행의 수와 md5 집계(처음·끝에 같아야 한다 — b3c2a_scores_state.sql 이 같은 값을 다시 낸다)
-- 내리기: b3c2a_scores_down.sql
-- =====================================================================

begin;

do $zz_b3c2a$
declare
  v_uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_columns  constant text := 'created_at:timestamptz:YES,id:uuid:NO,legacy_total:int4:YES,listening:numeric:YES,memo:text:YES,overall:numeric:YES,reading:numeric:YES,score_image:text:YES,speaking:numeric:YES,test_date:date:NO,updated_at:timestamptz:YES,user_email:text:YES,user_id:uuid:NO,user_name:text:YES,writing:numeric:YES';
  v_policies constant text := 'Allow all access for anon,b2n1_admin_delete,b2n1_admin_insert,b2n1_admin_update,b2n1_own_or_admin_select';
  v_labels   constant text[] := array['a', 'b', 'gm'];
  v_label    text;
  v_raw      text;
  v_ids      pg_catalog.uuid[] := array[]::pg_catalog.uuid[];
  v_text     text;
  v_n        bigint;
begin
  -- 0. 대상 확인
  if coalesce(pg_catalog.current_setting('b3c2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3c2a 넣기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b3c2a.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 먼저 실행할 것';
  end if;

  -- 1. 표의 모양
  if pg_catalog.to_regclass('public.toefl_actual_scores') is null then
    raise exception 'zzb3c2a 넣기 중단: public.toefl_actual_scores 가 없다';
  end if;
  select pg_catalog.string_agg(c.column_name::text || ':' || c.udt_name::text || ':' || c.is_nullable::text, ',' order by c.column_name::text collate "C")
    into v_text
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'toefl_actual_scores';
  if v_text is distinct from v_columns then
    raise exception 'zzb3c2a 넣기 중단: 성적 표의 열이 발주 때 읽은 것과 다르다(%). 아무것도 넣지 않았다', v_text;
  end if;
  select pg_catalog.count(*) into v_n
    from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.toefl_actual_scores'::pg_catalog.regclass and not t.tgisinternal;
  if v_n <> 0 then
    raise exception 'zzb3c2a 넣기 중단: 성적 표에 트리거가 %개 있다(발주 때는 0). 아무것도 넣지 않았다', v_n;
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.toefl_actual_scores'::pg_catalog.regclass) then
    raise exception 'zzb3c2a 넣기 중단: 성적 표의 행 수준 보안이 꺼져 있다. 아무것도 넣지 않았다';
  end if;
  select pg_catalog.string_agg(p.policyname::text, ',' order by p.policyname::text collate "C")
    into v_text
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and p.tablename = 'toefl_actual_scores';
  if v_text is distinct from v_policies then
    raise exception 'zzb3c2a 넣기 중단: 성적 표의 규칙이 발주 때 읽은 다섯과 다르다(%). 아무것도 넣지 않았다', v_text;
  end if;

  -- 2. 회원번호 셋
  foreach v_label in array v_labels loop
    v_raw := coalesce(pg_catalog.current_setting('b3c2a.member_' || v_label, true), '');
    if v_raw !~ v_uuid then
      raise exception 'zzb3c2a 넣기 중단: b3c2a.member_% 가 회원번호(uuid)의 모양이 아니다. 아무것도 넣지 않았다', v_label;
    end if;
    if v_raw::pg_catalog.uuid = any (v_ids) then
      raise exception 'zzb3c2a 넣기 중단: 회원번호가 서로 겹친다(%). 아무것도 넣지 않았다', v_label;
    end if;
    v_ids := v_ids || v_raw::pg_catalog.uuid;
    if not exists (select 1 from public.users u where u.id = v_raw::pg_catalog.uuid and u.email like 'zz%@member.zz%.invalid') then
      raise exception 'zzb3c2a 넣기 중단: b3c2a.member_% 의 회원 행이 없거나 합성 회원의 이메일 모양(zz…@member.zz….invalid)이 아니다. 아무것도 넣지 않았다', v_label;
    end if;
    if not exists (select 1 from security_private.member_identity mi where mi.member_id = v_raw::pg_catalog.uuid) then
      raise exception 'zzb3c2a 넣기 중단: b3c2a.member_% 의 회원에게 로그인 계정과의 대응이 없다(로그인 계정 번호를 넘긴 것은 아닌가). 아무것도 넣지 않았다', v_label;
    end if;
  end loop;

  -- 3. 겹침
  select pg_catalog.count(*) into v_n from public.toefl_actual_scores s where s.user_id = any (v_ids);
  if v_n <> 0 then
    raise exception 'zzb3c2a 넣기 중단: 그 세 회원의 성적 행이 이미 %건 있다. 아무것도 넣지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n from public.toefl_actual_scores s where s.memo like 'zzb3c2a%' or s.user_name like 'zzb3c2a%';
  if v_n <> 0 then
    raise exception 'zzb3c2a 넣기 중단: 합성 표식(zzb3c2a)이 붙은 성적 행이 이미 %건 있다. 아무것도 넣지 않았다', v_n;
  end if;
end;
$zz_b3c2a$;

-- 넣기(값은 scores-fixture.mjs 와 같다)
insert into public.toefl_actual_scores
       (user_id, user_email, user_name, reading, listening, speaking, writing, overall, legacy_total, test_date, score_image, memo)
select u.id, u.email, 'zzb3c2a ' || v.tag, v.reading, v.listening, v.speaking, v.writing, v.overall, v.legacy_total, v.test_date, null, 'zzb3c2a ' || v.tag
  from (values
    ('a', 'A1', date '1999-01-11', 3.0, 3.0, 3.0, 3.0, 3.0, null::integer),
    ('a', 'A2', date '1999-03-13', 4.5, 3.5, 2.5, 5.5, 4.0, 81),
    ('b', 'B1', date '1999-02-12', 2.0, 2.5, 1.5, 2.0, 2.0, 45)
  ) as v(label, tag, test_date, reading, listening, speaking, writing, overall, legacy_total)
  join public.users u on u.id = pg_catalog.current_setting('b3c2a.member_' || v.label)::pg_catalog.uuid;

do $zz_b3c2a$
declare
  v_n bigint;
begin
  select pg_catalog.count(*) into v_n
    from public.toefl_actual_scores s
   where s.memo in ('zzb3c2a A1', 'zzb3c2a A2', 'zzb3c2a B1')
     and s.user_id in (pg_catalog.current_setting('b3c2a.member_a')::pg_catalog.uuid, pg_catalog.current_setting('b3c2a.member_b')::pg_catalog.uuid);
  if v_n <> 3 then
    raise exception 'zzb3c2a 넣기 실패: 넣은 행이 정확히 3건이 아니다(%건). 전부 되돌린다', v_n;
  end if;
  select pg_catalog.count(*) into v_n
    from public.toefl_actual_scores s
   where s.user_id = pg_catalog.current_setting('b3c2a.member_gm')::pg_catalog.uuid;
  if v_n <> 0 then
    raise exception 'zzb3c2a 넣기 실패: 성적 0건 회원(GM)의 성적 행이 %건 있다. 전부 되돌린다', v_n;
  end if;
  raise notice 'zzb3c2a 넣기: 성적 행 3건(A 둘, B 하나)을 넣었다';
end;
$zz_b3c2a$;

commit;

reset b3c2a.test_project_ref;

-- 마지막 결과(한 칸 jsonb)
with made as (
  select s.id, s.user_id, pg_catalog.substr(s.memo, 9) as tag,
         pg_catalog.md5(pg_catalog.concat_ws('|', s.id::text, s.user_id::text, s.test_date::text, s.reading::text, s.listening::text, s.speaking::text,
                        s.writing::text, s.overall::text, coalesce(s.legacy_total::text, ''), coalesce(s.user_email, ''), coalesce(s.user_name, ''), coalesce(s.memo, ''))) as print
    from public.toefl_actual_scores s
   where s.memo in ('zzb3c2a A1', 'zzb3c2a A2', 'zzb3c2a B1')
     and s.user_id in (pg_catalog.current_setting('b3c2a.member_a')::pg_catalog.uuid, pg_catalog.current_setting('b3c2a.member_b')::pg_catalog.uuid)
), packed as (
  select pg_catalog.jsonb_build_object(
    'rows', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tag', m.tag, 'id', m.id, 'user_id', m.user_id, 'print', m.print) order by m.tag) from made m),
    'members', pg_catalog.jsonb_build_object(
      'a', pg_catalog.current_setting('b3c2a.member_a'),
      'b', pg_catalog.current_setting('b3c2a.member_b'),
      'gm', pg_catalog.current_setting('b3c2a.member_gm'))
  ) as j
)
select pg_catalog.jsonb_build_object(
  'marker', 'zzb3c2a',
  'read_at', pg_catalog.now(),
  'created', (select p.j from packed p),
  'down_input', (select p.j::text from packed p),
  'ids_filter', (select 'id=in.(' || pg_catalog.string_agg(m.id::text, ',' order by m.tag) || ')' from made m),
  'zero_member_rows', (select pg_catalog.count(*) from public.toefl_actual_scores s where s.user_id = pg_catalog.current_setting('b3c2a.member_gm')::pg_catalog.uuid),
  'outside', (
    select pg_catalog.jsonb_build_object(
             'count', pg_catalog.count(*),
             'md5', pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(s)::text), ',' order by s.id), '')))
      from public.toefl_actual_scores s
     where not exists (select 1 from made m where m.id = s.id)
  )
) as result;
