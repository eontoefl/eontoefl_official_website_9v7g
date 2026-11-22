-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-1 시험용 합성 행 내리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서는 같은 폴더의 절차.md 를 따른다.
--   * fixtures_up.sql 이 넣은 합성 행과, 시험이 넣었을 수 있는 "넣기" 키의 행만 지운다
--     (id 가 'zz-b2n1-' 로 시작 / aus_intspk 의 990000001·990000002·990000009 /
--      toefl_actual_scores 의 id 가 'b2b2b2b2-0000-4000-8000-' 로 시작).
--   * 표·규칙·권한은 건드리지 않는다.
--   * 실행하는 같은 접속에서 먼저:  set b2n1.test_project_ref = 'hmncdheiwqwekdbtijar';
--   * 합성 계정(로그인 계정·회원 행·대응표·명부)은 이 파일이 지우지 않는다(절차.md 8단계).
-- =====================================================================

begin;

do $zz_b2n1$
begin
  if coalesce(pg_catalog.current_setting('b2n1.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b2n1 합성 행 내리기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2n1.test_project_ref 를 먼저 실행할 것';
  end if;
end;
$zz_b2n1$;

delete from public.tr_listening_announcement where id like 'zz-b2n1-%';
delete from public.tr_listening_conversation where id like 'zz-b2n1-%';
delete from public.tr_listening_lecture      where id like 'zz-b2n1-%';
delete from public.tr_listening_response     where id like 'zz-b2n1-%';
delete from public.tr_reading_academic       where id like 'zz-b2n1-%';
delete from public.tr_speaking_interview     where id like 'zz-b2n1-%';
delete from public.tr_speaking_repeat        where id like 'zz-b2n1-%';
delete from public.tr_writing_arrange        where id like 'zz-b2n1-%';
delete from public.tr_writing_discussion     where id like 'zz-b2n1-%';
delete from public.tr_writing_email          where id like 'zz-b2n1-%';
delete from public.tr_writing_ko_data        where id like 'zz-b2n1-%';
delete from public.note3_store               where id like 'zz-b2n1-%';
delete from public.aus_intspk                where id in (990000001, 990000002, 990000009);
delete from public.toefl_actual_scores       where id::pg_catalog.text like 'b2b2b2b2-0000-4000-8000-%';

-- 표식이 남은 행이 없는지(있으면 전체가 되돌아간다)
do $zz_b2n1$
declare
  v_left bigint;
begin
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
       + (select pg_catalog.count(*) from public.aus_intspk                where id in (990000001, 990000002, 990000009) or title like 'zz-b2n1-%')
       + (select pg_catalog.count(*) from public.toefl_actual_scores       where id::pg_catalog.text like 'b2b2b2b2-0000-4000-8000-%' or user_name like 'zz-b2n1-%')
    into v_left;
  if v_left <> 0 then
    raise exception 'zz_b2n1 합성 행 내리기 실패: 표식이 있는 행이 % 개 남아 있음', v_left;
  end if;
end;
$zz_b2n1$;

commit;
