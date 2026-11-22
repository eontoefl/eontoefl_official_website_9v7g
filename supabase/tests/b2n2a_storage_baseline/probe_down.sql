-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-나-2a: 실측 전용 임시 규칙 내리기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 순서는 같은 폴더의 절차.md 를 따른다.
--   * probe_up.sql 이 만든 임시 규칙 12개만 이름으로 지운다. if exists 를 쓰지 않는다(하나라도 없으면 실패,
--     한 트랜잭션이므로 아무것도 지워지지 않는다).
--   * 임시 버킷과 합성 객체는 지우지 않는다. 객체는 measure.mjs --phase cleanup, 버킷은 --phase probe-buckets-remove.
--     순서: cleanup(객체) → probe_down.sql(규칙) → probe-buckets-remove(버킷).
--   * 기준선 규칙 26개는 건드리지 않는다.
--
-- 실행 방법: 같은 접속에서 먼저  set b2n2a.test_project_ref = 'hmncdheiwqwekdbtijar';
-- =====================================================================

begin;

do $zz_b2n2a_pre$
begin
  if coalesce(pg_catalog.current_setting('b2n2a.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b2n2a 임시 규칙 내리기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b2n2a.test_project_ref 를 먼저 실행할 것';
  end if;
end;
$zz_b2n2a_pre$;

drop policy zz_b2n2a_i_insert on storage.objects;
drop policy zz_b2n2a_is_insert on storage.objects;
drop policy zz_b2n2a_is_select on storage.objects;
drop policy zz_b2n2a_iu_insert on storage.objects;
drop policy zz_b2n2a_iu_update on storage.objects;
drop policy zz_b2n2a_isu_insert on storage.objects;
drop policy zz_b2n2a_isu_select on storage.objects;
drop policy zz_b2n2a_isu_update on storage.objects;
drop policy zz_b2n2a_fn_insert on storage.objects;
drop policy zz_b2n2a_fn_select on storage.objects;
drop policy zz_b2n2a_fn_update on storage.objects;
drop policy zz_b2n2a_fn_delete on storage.objects;

-- 남은 임시 규칙이 없는지(있으면 전체가 되돌아간다)
do $zz_b2n2a_check$
declare
  v_left bigint;
begin
  select pg_catalog.count(*) into v_left
    from pg_catalog.pg_policy pol
   where pol.polname::pg_catalog.text like 'zz\_b2n2a\_%';
  if v_left <> 0 then
    raise exception 'zz_b2n2a 임시 규칙 내리기 실패: zz_b2n2a_ 규칙이 % 개 남아 있음', v_left;
  end if;
end;
$zz_b2n2a_check$;

commit;
