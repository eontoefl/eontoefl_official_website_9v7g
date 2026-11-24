-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 점검 원복 (시험 프로젝트 hmncdheiwqwekdbtijar 전용) — 3차 판
--
-- ★★★ 운영 경고 ★★★  시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 를 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 7단계.
--
-- 받는 값(같은 요청의 맨 앞. node profile_matrix.mjs --phase set-lines --for maint-off 가 만들어 준다)
--     set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3_0.acct_a = '<회원 A 의 정확한 계정 번호>';
--     set b3_0.saved_site_state = '<켜기 전에 뜬 state_snapshot.sql 의 site_state_row>';   -- 시작 행 전체(되돌릴 값)
--     set b3_0.on_site_state = '<maint_on.sql 의 마지막 결과의 site_state_row>';          -- 켠 직후의 행 전체(지금 이 값이어야 한다)
--       (둘 다 JSON 한 줄. 값 안에 작은따옴표가 있으면 두 번 쓴다)
-- 하는 일(한 트랜잭션): maint_on.sql 이 한 것만 되돌린다.
--   security_private.maintenance_exception   (301, <A 의 계정 번호>) **그 한 행만** 지운다
--   security_private.site_state (id = 1)     모든 열을 **저장해 둔 시작 값으로**(updated_at 도 지금 시각이 아니라 저장한 값으로)
-- 비교와 쓰기를 하나로 묶는다
--   * 먼저 그 행과 예외 명단을 잠근다(select … for update, lock table). 이 트랜잭션이 끝날 때까지 다른 작업이 바꾸지 못한다.
--   * 복원하는 갱신문의 조건에 "지금 행의 **모든 열**이 켠 직후의 행과 같음"을 넣는다. 바뀐 행이 정확히 1이 아니면
--     (= 켠 뒤에 누가 그 행의 어느 열이든 — starts_at·updated_at 만이라도 — 바꿨으면) 예외로 끝나 **전체가 되돌아간다**
--     (예외 행도 지워지지 않는다). 그때는 더 손대지 않고 사람에게 넘긴다.
-- 그 밖에 확인하는 것(다르면 아무것도 바꾸지 않고 멈춘다)
--   0. 대상 확인 값, 계정 번호의 모양
--   1. 넘겨받은 두 행이 JSON 이고, 키가 지금 site_state 의 열 여덟 개와 정확히 같다
--      시작 행: id 1 · phase 'normal' / 켠 직후의 행: id 1 · phase 'maintenance' · maintenance_id 301 · message 'zzb3p0 시험 점검'
--   2. 점검 번호 301 의 예외 행이 **정확히 하나이고 켤 때 넣은 값 그대로**다: 계정이 A, expires_at 이 NULL
--      (켠 뒤 누가 그 행의 expires_at 만 바꿨어도 지우지 않고 멈춘다. 지우는 문장의 조건에도 같은 세 값을 넣는다)
-- 되돌린 뒤 확인: 지운 예외 행 1, 바뀐 site_state 행 1, 지금의 행이 시작 행과 열마다 같다. 아니면 전체가 되돌아간다.
-- 마지막 결과(한 칸 jsonb): 지금의 site_state 행·남은 301 예외 수(0)
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_cols     constant text[] := array['id', 'last_ended_at', 'last_ended_maintenance_id', 'maintenance_id', 'message', 'phase', 'starts_at', 'updated_at'];
  v_acct_raw text := coalesce(pg_catalog.current_setting('b3_0.acct_a', true), '');
  v_raw      text := coalesce(pg_catalog.current_setting('b3_0.saved_site_state', true), '');
  v_on_raw   text := coalesce(pg_catalog.current_setting('b3_0.on_site_state', true), '');
  v_acct     pg_catalog.uuid;
  v_j        pg_catalog.jsonb;   -- 시작 행(되돌릴 값)
  v_on       pg_catalog.jsonb;   -- 켠 직후의 행(지금 이 값이어야 한다)
  v_keys     text[];
  v_on_keys  text[];
  v_live     text[];
  v_n        bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 점검 원복 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_acct_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'zzb3p0 점검 원복 중단: b3_0.acct_a 에 회원 A 의 계정 번호가 없다. 아무것도 바꾸지 않았다';
  end if;
  v_acct := v_acct_raw::pg_catalog.uuid;

  -- 1. 넘겨받은 두 행
  if v_raw = '' or v_on_raw = '' then
    raise exception 'zzb3p0 점검 원복 중단: b3_0.saved_site_state(시작 행)와 b3_0.on_site_state(켠 직후의 행)가 둘 다 있어야 한다. 아무것도 바꾸지 않았다';
  end if;
  begin
    v_j := v_raw::pg_catalog.jsonb;
    v_on := v_on_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 행의 값이 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j) is distinct from 'object' or pg_catalog.jsonb_typeof(v_on) is distinct from 'object' then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 값이 행 하나의 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.array_agg(k) into v_keys from pg_catalog.jsonb_object_keys(v_j) as t(k);
  select pg_catalog.array_agg(k) into v_on_keys from pg_catalog.jsonb_object_keys(v_on) as t(k);
  select pg_catalog.array_agg(a.attname::pg_catalog.text) into v_live
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('security_private.site_state') and a.attnum > 0 and not a.attisdropped;
  -- 순서와 무관하게 "정확히 같은 여덟 개"인가
  if v_keys is null or v_on_keys is null or v_live is null
     or pg_catalog.array_length(v_keys, 1) <> 8 or pg_catalog.array_length(v_on_keys, 1) <> 8 or pg_catalog.array_length(v_live, 1) <> 8
     or not (v_keys @> v_cols and v_cols @> v_keys)
     or not (v_on_keys @> v_cols and v_cols @> v_on_keys)
     or not (v_live @> v_cols and v_cols @> v_live) then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 행의 키나 지금 site_state 의 열이 이 파일이 아는 여덟 열과 다르다. 아무것도 바꾸지 않았다 — 사람이 확인할 것';
  end if;
  if (v_j ->> 'id') is distinct from '1' or (v_j ->> 'phase') is distinct from 'normal' then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 시작 행이 id 1 · phase normal 이 아니다. 아무것도 바꾸지 않았다';
  end if;
  if (v_on ->> 'id') is distinct from '1'
     or (v_on ->> 'phase') is distinct from 'maintenance'
     or (v_on ->> 'maintenance_id') is distinct from '301'
     or (v_on ->> 'message') is distinct from 'zzb3p0 시험 점검' then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 "켠 직후의 행"이 이 시험이 쓴 값(maintenance · 301 · zzb3p0 시험 점검)이 아니다(maint_on.sql 의 결과여야 한다). 아무것도 바꾸지 않았다';
  end if;

  -- 잠금: 이 트랜잭션이 끝날 때까지 그 행과 예외 명단을 다른 작업이 바꾸지 못한다
  perform 1 from security_private.site_state ss where ss.id = 1 for update;
  if not found then
    raise exception 'zzb3p0 점검 원복 중단: site_state 에 id = 1 인 행이 없다. 아무것도 바꾸지 않았다 — 사람이 확인할 것';
  end if;
  lock table security_private.maintenance_exception in share row exclusive mode;

  -- 2. 301 의 예외 행이 정확히 A 하나, 그대로인가
  select pg_catalog.count(*) into v_n from security_private.maintenance_exception me where me.maintenance_id = 301;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 중단: 점검 번호 301 의 예외 행이 %개다(이 시험이 넣은 한 행이어야 한다). 아무것도 바꾸지 않았다 — 사람이 확인할 것', v_n;
  end if;
  -- 켤 때 넣은 값 그대로인가: (301, A 의 계정 번호, expires_at NULL). 이 표의 열은 이 셋뿐이다(2-가 마이그레이션 131~138줄)
  select pg_catalog.count(*) into v_n
    from security_private.maintenance_exception me
   where me.maintenance_id = 301 and me.auth_user_id = v_acct and me.expires_at is null;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 중단: 점검 번호 301 의 예외 행이 켤 때 넣은 값(회원 A · expires_at NULL) 그대로가 아니다. 아무것도 바꾸지 않았다 — 사람이 확인할 것';
  end if;

  -- 비교와 쓰기를 한 문장으로: 지금 행의 모든 열이 "켠 직후의 행"과 같을 때만 시작 값으로 되돌린다
  update security_private.site_state ss
     set maintenance_id            = (v_j ->> 'maintenance_id')::pg_catalog.int4,
         phase                     = v_j ->> 'phase',
         starts_at                 = (v_j ->> 'starts_at')::pg_catalog.timestamptz,
         message                   = v_j ->> 'message',
         last_ended_maintenance_id = (v_j ->> 'last_ended_maintenance_id')::pg_catalog.int4,
         last_ended_at             = (v_j ->> 'last_ended_at')::pg_catalog.timestamptz,
         updated_at                = (v_j ->> 'updated_at')::pg_catalog.timestamptz
   where ss.id = 1
     and ss.maintenance_id            is not distinct from (v_on ->> 'maintenance_id')::pg_catalog.int4
     and ss.phase                     is not distinct from (v_on ->> 'phase')
     and ss.starts_at                 is not distinct from (v_on ->> 'starts_at')::pg_catalog.timestamptz
     and ss.message                   is not distinct from (v_on ->> 'message')
     and ss.last_ended_maintenance_id is not distinct from (v_on ->> 'last_ended_maintenance_id')::pg_catalog.int4
     and ss.last_ended_at             is not distinct from (v_on ->> 'last_ended_at')::pg_catalog.timestamptz
     and ss.updated_at                is not distinct from (v_on ->> 'updated_at')::pg_catalog.timestamptz;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 중단: 지금의 site_state 행이 켠 직후의 행과 다르다(바뀐 행 %) — 켠 뒤에 누가 그 행을 바꿨다. 아무것도 바꾸지 않았다 — 사람이 확인할 것', v_n;
  end if;

  delete from security_private.maintenance_exception me
   where me.maintenance_id = 301 and me.auth_user_id = v_acct and me.expires_at is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 실패: 예외 행이 %행 지워졌다(1이어야 한다). 전부 되돌린다', v_n;
  end if;

  -- 지금의 행이 시작 행과 열마다 같은가(시각은 형을 맞춰 견준다)
  select pg_catalog.count(*) into v_n
    from security_private.site_state ss
   where ss.id = 1
     and ss.maintenance_id            is not distinct from (v_j ->> 'maintenance_id')::pg_catalog.int4
     and ss.phase                     is not distinct from (v_j ->> 'phase')
     and ss.starts_at                 is not distinct from (v_j ->> 'starts_at')::pg_catalog.timestamptz
     and ss.message                   is not distinct from (v_j ->> 'message')
     and ss.last_ended_maintenance_id is not distinct from (v_j ->> 'last_ended_maintenance_id')::pg_catalog.int4
     and ss.last_ended_at             is not distinct from (v_j ->> 'last_ended_at')::pg_catalog.timestamptz
     and ss.updated_at                is not distinct from (v_j ->> 'updated_at')::pg_catalog.timestamptz;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 실패: 되돌린 행이 시작 행과 같지 않다. 전부 되돌린다';
  end if;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'maintenance restored to the saved start row',
  'site_state_row', (select pg_catalog.to_jsonb(ss) from security_private.site_state ss where ss.id = 1),
  'site_state_row_md5', (select pg_catalog.md5(pg_catalog.to_jsonb(ss)::pg_catalog.text) from security_private.site_state ss where ss.id = 1),
  'exception_rows_301_left', (select pg_catalog.count(*) from security_private.maintenance_exception me where me.maintenance_id = 301)
) as result;
