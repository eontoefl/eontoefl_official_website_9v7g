-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 로그인 기록 한 행의 not_after 를 과거로 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★  시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 를 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 8단계.
--
-- 받는 값(같은 요청의 맨 앞)
--     set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3_0.session_id = '<만료용 로그인 기록 번호>';
--     set b3_0.account_id = '<회원 A 의 계정 번호>';
--     set b3_0.not_after_before = '<바꾸기 전 값: 직전에 읽은 not_after 글자 그대로, NULL 이었으면 null>';
-- 하는 일: auth.sessions 에서 **로그인 기록 번호 + 계정 번호 + 바꾸기 전 값**이 전부 같은 한 행의 not_after 만
--          지금보다 1분 전으로 바꾼다. 바뀐 행이 정확히 1이 아니면 전체가 되돌아간다.
--          조건 없는 update 는 쓰지 않는다.
-- 마지막 결과(한 칸 jsonb): not_after_before(바꾸기 전) · not_after_expired(바꾼 값) — 둘 다 적어 둔다.
--   되돌리기(session_restore.sql)에 그대로 넘긴다.
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_sid    text := coalesce(pg_catalog.current_setting('b3_0.session_id', true), '');
  v_acct   text := coalesce(pg_catalog.current_setting('b3_0.account_id', true), '');
  v_raw    text := coalesce(pg_catalog.current_setting('b3_0.not_after_before', true), '');
  v_before pg_catalog.timestamptz;
  v_n      bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 로그인 기록 만료 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_sid !~ v_uuid or v_acct !~ v_uuid then
    raise exception 'zzb3p0 로그인 기록 만료 중단: b3_0.session_id 또는 b3_0.account_id 가 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_raw = '' then
    raise exception 'zzb3p0 로그인 기록 만료 중단: b3_0.not_after_before 가 없다(직전에 읽은 값을 넘길 것 — NULL 이었으면 null). 아무것도 바꾸지 않았다';
  end if;
  v_before := case when pg_catalog.lower(v_raw) = 'null' then null else v_raw::pg_catalog.timestamptz end;

  update auth.sessions s
     set not_after = pg_catalog.now() - interval '1 minute'
   where s.id = v_sid::pg_catalog.uuid
     and s.user_id = v_acct::pg_catalog.uuid
     and s.not_after is not distinct from v_before;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 로그인 기록 만료 중단: 조건(기록 번호 + 계정 번호 + 바꾸기 전 값)에 맞는 행이 %개다(1이어야 한다). 아무것도 바꾸지 않았다', v_n;
  end if;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'not_after set to the past for one session',
  'session_id', s.id,
  'user_id', s.user_id,
  'aal', s.aal,
  'not_after_before', case when pg_catalog.lower(pg_catalog.current_setting('b3_0.not_after_before')) = 'null' then null
                           else pg_catalog.to_jsonb(pg_catalog.current_setting('b3_0.not_after_before')::pg_catalog.timestamptz) end,
  'not_after_expired', s.not_after
) as result
  from auth.sessions s
 where s.id = pg_catalog.current_setting('b3_0.session_id')::pg_catalog.uuid
   and s.user_id = pg_catalog.current_setting('b3_0.account_id')::pg_catalog.uuid;
