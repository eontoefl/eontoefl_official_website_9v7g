-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-1 화면 시험의 합성 업무 자료 지우기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- 이 파일은 작업방이 실행해 보지 않았다. 운영에는 절대 실행하지 않는다.
-- b3c1_fixtures_up.sql 이 넣은 한 줄만 지운다 — 번호·이메일·이름·종류가 전부 기대 값과 맞을 때만.
-- 맞는 줄이 정확히 한 줄이 아니면(0줄 포함) 아무것도 지우지 않고 멈춘다.
-- (실행기는 업무 쓰기를 전송 전에 막으므로 화면 시험이 이 줄을 고치지 않는다. 그래도 값이 달라져 있으면 지우지 않고 멈춘다 — 그때는 사람이 본다.)
--
-- 실행 방법: 같은 접속에서 먼저
--   set b3c1.test_project_ref = 'hmncdheiwqwekdbtijar';
--   set b3c1.email_a = '<합성 회원 A 의 이메일 — 넣을 때와 같은 값>';
-- =====================================================================

begin;

do $zz_b3c1$
declare
  v_ref   text := coalesce(pg_catalog.current_setting('b3c1.test_project_ref', true), '');
  v_email text := coalesce(pg_catalog.current_setting('b3c1.email_a', true), '');
  v_id    constant text := '00000000-0000-4000-8000-0000b3c1a001';
  v_name  constant text := 'zz_b3c1 합성 신청서 A';
  v_type  constant text := 'challenge';
  v_n     bigint;
begin
  if v_ref <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zz_b3c1 합성 자료 지우기 중단: 대상 확인 값이 없다. 시험 프로젝트에서만, set b3c1.test_project_ref = ''hmncdheiwqwekdbtijar''; 를 먼저 실행할 것';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'zz_b3c1 합성 자료 지우기 중단: 합성 회원 A 의 이메일(b3c1.email_a)이 없거나 모양이 맞지 않다';
  end if;

  -- 1. 지울 줄: 번호·이메일·이름·종류가 전부 맞는 줄이 정확히 한 줄인가
  execute pg_catalog.format(
    'select pg_catalog.count(*) from public.applications a where a.id::text = %L and a.email = %L and a.name = %L and a.application_type = %L',
    v_id, v_email, v_name, v_type) into v_n;
  if v_n <> 1 then
    raise exception 'zz_b3c1 합성 자료 지우기 중단: 넣은 줄(번호·이메일·이름·종류가 전부 맞는 줄)이 정확히 한 줄이 아니다(%줄) — 아무것도 지우지 않는다', v_n;
  end if;

  -- 2. 그 한 줄만 지운다
  execute pg_catalog.format(
    'delete from public.applications a where a.id::text = %L and a.email = %L and a.name = %L and a.application_type = %L',
    v_id, v_email, v_name, v_type);
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zz_b3c1 합성 자료 지우기 중단: 지운 줄이 한 줄이 아니다(%줄) — 되돌린다', v_n;
  end if;

  -- 3. 다시 조회: 그 번호의 줄도, 그 이메일의 신청서도 남지 않았는가
  execute pg_catalog.format('select pg_catalog.count(*) from public.applications a where a.id::text = %L', v_id) into v_n;
  if v_n <> 0 then
    raise exception 'zz_b3c1 합성 자료 지우기 중단: 지운 뒤에도 그 번호의 줄이 남아 있다';
  end if;
  select pg_catalog.count(*) into v_n from public.applications a where a.email = v_email;
  if v_n <> 0 then
    raise exception 'zz_b3c1 합성 자료 지우기 중단: 합성 회원 A 의 이메일로 된 신청서가 남아 있다(%줄) — 이 파일이 넣은 것이 아니다. 되돌린다', v_n;
  end if;
  raise notice 'zz_b3c1 합성 자료: 합성 신청서 한 줄을 지움';
end;
$zz_b3c1$;

commit;
