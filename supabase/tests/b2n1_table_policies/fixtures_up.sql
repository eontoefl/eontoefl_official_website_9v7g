-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-1 시험용 합성 행 올리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서와 기대 결과는 같은 폴더의 절차.md 를 따른다.
-- 운영에는 절대 실행하지 않는다.
--
-- 하는 일: 대상 표 14개에 합성 행을 2개씩 넣는다(대상 행 1 + 대조군 행 1). 성적 표는 회원 A·B 각각 1행.
--          표·규칙·권한은 만들지도 바꾸지도 않는다(행만 넣는다).
-- 합성 행의 표식
--   * id 가 글자형인 표 12개: id 가 'zz-b2n1-' 로 시작한다.
--   * aus_intspk(id 가 정수): id 990000001·990000002, title 이 'zz-b2n1-' 로 시작한다.
--   * toefl_actual_scores(id 가 uuid): id 가 'b2b2b2b2-0000-4000-8000-' 로 시작하고 user_name 이 'zz-b2n1-' 로 시작한다.
--   * "넣기" 시험이 쓰는 키(…-new, 990000009, …0c9)는 여기서 넣지 않는다(비어 있어야 한다).
--
-- 실행 방법: 이 파일을 실행하는 같은 접속에서 아래 세 값을 먼저 정한다(없거나 다르면 첫 블록에서 멈춘다).
--   set b2n1.test_project_ref = 'hmncdheiwqwekdbtijar';
--   set b2n1.member_a = '<A_회원번호>';      -- public.users.id (로그인 계정 번호가 아니다)
--   set b2n1.member_b = '<B_회원번호>';
-- 내리기: fixtures_down.sql
-- =====================================================================

begin;

do $zz_b2n1$
declare
  v_a text := pg_catalog.current_setting('b2n1.member_a', true);
  v_b text := pg_catalog.current_setting('b2n1.member_b', true);
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_left bigint;
begin
  if coalesce(pg_catalog.current_setting('b2n1.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b2n1 합성 행 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2n1.test_project_ref 를 먼저 실행할 것';
  end if;
  if v_a is null or v_b is null or v_a !~ v_uuid_re or v_b !~ v_uuid_re then
    raise exception 'zz_b2n1 합성 행 중단: b2n1.member_a / b2n1.member_b 가 없거나 uuid 모양이 아니다';
  end if;
  if pg_catalog.lower(v_a) = pg_catalog.lower(v_b) then
    raise exception 'zz_b2n1 합성 행 중단: 회원 A 와 B 의 회원번호가 같다';
  end if;

  -- 이미 합성 행이 있으면 멈춘다(먼저 fixtures_down.sql)
  select (select pg_catalog.count(*) from public.tr_listening_announcement where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_listening_conversation where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_listening_lecture      where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_listening_response     where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_reading_academic       where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_speaking_interview     where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_speaking_repeat        where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_writing_arrange        where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_writing_discussion     where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_writing_email          where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.tr_writing_ko_data        where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.note3_store               where id like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.aus_intspk                where id in (990000001, 990000002, 990000009))
       + (select pg_catalog.count(*) from public.toefl_actual_scores       where id::pg_catalog.text like 'b2b2b2b2-0000-4000-8000-%')
    into v_left;
  if v_left <> 0 then
    raise exception 'zz_b2n1 합성 행 중단: 합성 행이 이미 % 개 있다(먼저 fixtures_down.sql)', v_left;
  end if;
end;
$zz_b2n1$;

-- 문제 표 11개 (값이 꼭 필요한 열: id. response·arrange 는 set_id·question_num, ko_data 는 type·set_id 도)
insert into public.tr_listening_announcement (id, script) values
  ('zz-b2n1-la-1', 'init'), ('zz-b2n1-la-2', 'init');
insert into public.tr_listening_conversation (id, script) values
  ('zz-b2n1-lc-1', 'init'), ('zz-b2n1-lc-2', 'init');
insert into public.tr_listening_lecture (id, script) values
  ('zz-b2n1-ll-1', 'init'), ('zz-b2n1-ll-2', 'init');
insert into public.tr_listening_response (id, set_id, question_num, script) values
  ('zz-b2n1-lr-1', 'zz-b2n1-set', 1, 'init'), ('zz-b2n1-lr-2', 'zz-b2n1-set', 2, 'init');
insert into public.tr_reading_academic (id, main_title) values
  ('zz-b2n1-ra-1', 'init'), ('zz-b2n1-ra-2', 'init');
insert into public.tr_speaking_interview (id, context_text) values
  ('zz-b2n1-si-1', 'init'), ('zz-b2n1-si-2', 'init');
insert into public.tr_speaking_repeat (id, context_text) values
  ('zz-b2n1-sr-1', 'init'), ('zz-b2n1-sr-2', 'init');
insert into public.tr_writing_arrange (id, set_id, question_num, explanation) values
  ('zz-b2n1-wa-1', 'zz-b2n1-set', 1, 'init'), ('zz-b2n1-wa-2', 'zz-b2n1-set', 2, 'init');
insert into public.tr_writing_discussion (id, topic) values
  ('zz-b2n1-wd-1', 'init'), ('zz-b2n1-wd-2', 'init');
insert into public.tr_writing_email (id, subject) values
  ('zz-b2n1-we-1', 'init'), ('zz-b2n1-we-2', 'init');
insert into public.tr_writing_ko_data (id, type, set_id, ko_text) values
  ('zz-b2n1-wk-1', 'zz-b2n1', 'zz-b2n1-set', 'init'), ('zz-b2n1-wk-2', 'zz-b2n1', 'zz-b2n1-set', 'init');

-- aus_intspk (id 는 정수 — 순번을 쓰지 않고 직접 적는다. type 은 2·3·4 중 하나여야 한다)
insert into public.aus_intspk (id, type, title, passage) values
  (990000001, 2, 'zz-b2n1-int-1', 'init'), (990000002, 2, 'zz-b2n1-int-2', 'init');

-- toefl_actual_scores (회원 A 1행, 회원 B 1행. 점수는 1.0~6.0, test_date 필수)
insert into public.toefl_actual_scores
  (id, user_id, user_name, reading, listening, speaking, writing, overall, test_date, memo)
values
  ('b2b2b2b2-0000-4000-8000-0000000000a1', pg_catalog.current_setting('b2n1.member_a')::pg_catalog.uuid,
   'zz-b2n1-A', 3.0, 3.0, 3.0, 3.0, 3.0, date '2026-01-01', 'init'),
  ('b2b2b2b2-0000-4000-8000-0000000000b1', pg_catalog.current_setting('b2n1.member_b')::pg_catalog.uuid,
   'zz-b2n1-B', 3.0, 3.0, 3.0, 3.0, 3.0, date '2026-01-01', 'init');

-- note3_store
insert into public.note3_store (id, data) values
  ('zz-b2n1-note-1', 'init'), ('zz-b2n1-note-2', 'init');

commit;
