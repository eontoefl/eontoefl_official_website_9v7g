-- =====================================================================
-- 보안작업 묶음 2 — 계약 3C-DB 시험: 로그인 기록 한 행의 not_after 를 원래 값으로 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
-- (3-0 의 같은 이름 파일(6dad1f1)을 옮긴 것이다. 바꾼 것: 표식 zzb3p0 → zzb3c, 설정 이름 b3_0.* → b3c.*, 점검 번호 301 → 311, 도구 이름. 로직은 그대로다)
--
-- ★★★ 운영 경고 ★★★  시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 를 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 8단계.
--
-- 받는 값(같은 요청의 맨 앞. 뒤의 둘은 session_expire.sql 의 마지막 결과에서 글자 그대로)
--     set b3c.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3c.session_id = '<만료용 로그인 기록 번호>';
--     set b3c.account_id = '<회원 A 의 계정 번호>';
--     set b3c.not_after_expired = '<session_expire.sql 이 바꾼 값(not_after_expired)>';
--     set b3c.not_after_before = '<기록해 둔 원래 값(not_after_before). NULL 이었으면 null>';
-- 하는 일: auth.sessions 에서 **로그인 기록 번호 + 계정 번호 + 지금 값(= 이 시험이 바꾼 값)**이 전부 같은 한 행의
--          not_after 를 **기록해 둔 원래 값으로** 되돌린다(NULL 로 고정해 쓰지 않는다).
--          바뀐 행이 정확히 1이 아니면 전체가 되돌아간다.
-- 마지막 결과(한 칸 jsonb): 지금의 not_after(원래 값과 같아야 한다)
-- =====================================================================

begin;

do $zz_b3c$
declare
  v_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_sid     text := coalesce(pg_catalog.current_setting('b3c.session_id', true), '');
  v_acct    text := coalesce(pg_catalog.current_setting('b3c.account_id', true), '');
  v_exp_raw text := coalesce(pg_catalog.current_setting('b3c.not_after_expired', true), '');
  v_raw     text := coalesce(pg_catalog.current_setting('b3c.not_after_before', true), '');
  v_before  pg_catalog.timestamptz;
  v_n       bigint;
begin
  if coalesce(pg_catalog.current_setting('b3c.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3c 로그인 기록 되돌리기 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_sid !~ v_uuid or v_acct !~ v_uuid then
    raise exception 'zzb3c 로그인 기록 되돌리기 중단: b3c.session_id 또는 b3c.account_id 가 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_exp_raw = '' or pg_catalog.lower(v_exp_raw) = 'null' or v_raw = '' then
    raise exception 'zzb3c 로그인 기록 되돌리기 중단: b3c.not_after_expired(이 시험이 바꾼 값)와 b3c.not_after_before(원래 값)가 둘 다 있어야 한다. 아무것도 바꾸지 않았다';
  end if;
  v_before := case when pg_catalog.lower(v_raw) = 'null' then null else v_raw::pg_catalog.timestamptz end;

  update auth.sessions s
     set not_after = v_before
   where s.id = v_sid::pg_catalog.uuid
     and s.user_id = v_acct::pg_catalog.uuid
     and s.not_after = v_exp_raw::pg_catalog.timestamptz;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3c 로그인 기록 되돌리기 중단: 조건(기록 번호 + 계정 번호 + 이 시험이 바꾼 값)에 맞는 행이 %개다(1이어야 한다). 아무것도 바꾸지 않았다 — 사람이 확인할 것', v_n;
  end if;
end;
$zz_b3c$;

commit;

reset b3c.test_project_ref;

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'not_after restored to the recorded value',
  'session_id', s.id,
  'user_id', s.user_id,
  'not_after_now', s.not_after,
  'same_as_recorded', s.not_after is not distinct from
     (case when pg_catalog.lower(pg_catalog.current_setting('b3c.not_after_before')) = 'null' then null
           else pg_catalog.current_setting('b3c.not_after_before')::pg_catalog.timestamptz end)
) as result
  from auth.sessions s
 where s.id = pg_catalog.current_setting('b3c.session_id')::pg_catalog.uuid
   and s.user_id = pg_catalog.current_setting('b3c.account_id')::pg_catalog.uuid;
