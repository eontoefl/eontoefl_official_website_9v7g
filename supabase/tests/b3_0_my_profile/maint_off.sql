-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 점검 원복 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★  시험 프로젝트 전용이다. 실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 를 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 7단계.
--
-- 받는 값(같은 요청의 맨 앞)
--     set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3_0.acct_a = '<회원 A 의 정확한 계정 번호>';
--     set b3_0.saved_site_state = '<켜기 전에 뜬 state_snapshot.sql 의 site_state_row 를 글자 그대로>';
--       (JSON 한 줄. 값 안에 작은따옴표가 있으면 두 번 쓴다)
-- 하는 일(한 트랜잭션): maint_on.sql 이 한 것만 되돌린다.
--   security_private.maintenance_exception   (301, <A 의 계정 번호>) **그 한 행만** 지운다
--   security_private.site_state (id = 1)     모든 열을 **저장해 둔 원래 값으로**(updated_at 도 지금 시각이 아니라 저장한 값으로)
-- 되돌리기 전에 확인하는 것(다르면 아무것도 바꾸지 않고 멈춘다 — 사람에게 넘긴다)
--   0. 대상 확인 값, 계정 번호의 모양
--   1. 넘겨받은 행이 JSON 이고, 그 키가 지금 site_state 의 열과 정확히 같으며, id 가 1 이고 phase 가 'normal' 이다
--   2. 지금의 site_state 가 **이 시험이 쓴 값**이다: phase 'maintenance' · maintenance_id 301 · message 'zzb3p0 시험 점검'
--   3. 점검 번호 301 의 예외 행이 정확히 하나이고 그 계정이 A 다
-- 되돌린 뒤 확인: 지운 예외 행 1, 바뀐 site_state 행 1, 지금의 행이 넘겨받은 값과 열마다 같다. 아니면 전체가 되돌아간다.
-- 마지막 결과(한 칸 jsonb): 지금의 site_state 행·그 md5(켜기 전의 site_state_row_md5 와 같아야 한다)·남은 301 예외 수(0)
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_cols     constant text[] := array['id', 'last_ended_at', 'last_ended_maintenance_id', 'maintenance_id', 'message', 'phase', 'starts_at', 'updated_at'];
  v_acct_raw text := coalesce(pg_catalog.current_setting('b3_0.acct_a', true), '');
  v_raw      text := coalesce(pg_catalog.current_setting('b3_0.saved_site_state', true), '');
  v_acct     pg_catalog.uuid;
  v_j        pg_catalog.jsonb;
  v_now      record;
  v_keys     text[];
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

  -- 1. 넘겨받은 원래 행
  if v_raw = '' then
    raise exception 'zzb3p0 점검 원복 중단: b3_0.saved_site_state 가 없다(켜기 전에 저장한 site_state_row 를 넘길 것). 아무것도 바꾸지 않았다';
  end if;
  begin
    v_j := v_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3p0 점검 원복 중단: b3_0.saved_site_state 의 값이 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j) is distinct from 'object' then
    raise exception 'zzb3p0 점검 원복 중단: b3_0.saved_site_state 가 행 하나의 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.array_agg(k) into v_keys from pg_catalog.jsonb_object_keys(v_j) as t(k);
  select pg_catalog.array_agg(a.attname::pg_catalog.text) into v_live
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('security_private.site_state') and a.attnum > 0 and not a.attisdropped;
  -- 순서와 무관하게 "정확히 같은 여덟 개"인가
  if v_keys is null or v_live is null
     or pg_catalog.array_length(v_keys, 1) <> 8 or pg_catalog.array_length(v_live, 1) <> 8
     or not (v_keys @> v_cols and v_cols @> v_keys)
     or not (v_live @> v_cols and v_cols @> v_live) then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 행의 키나 지금 site_state 의 열이 이 파일이 아는 여덟 열과 다르다. 아무것도 바꾸지 않았다 — 사람이 확인할 것';
  end if;
  if (v_j ->> 'id') is distinct from '1' or (v_j ->> 'phase') is distinct from 'normal' then
    raise exception 'zzb3p0 점검 원복 중단: 넘겨받은 행이 id 1 · phase normal 이 아니다(이 시험은 normal 에서 시작했어야 한다). 아무것도 바꾸지 않았다';
  end if;

  -- 2. 지금 값이 이 시험이 쓴 값인가
  select ss.phase, ss.maintenance_id, ss.message into v_now from security_private.site_state ss where ss.id = 1;
  if not found
     or v_now.phase is distinct from 'maintenance'
     or v_now.maintenance_id is distinct from 301
     or v_now.message is distinct from 'zzb3p0 시험 점검' then
    raise exception 'zzb3p0 점검 원복 중단: 지금의 site_state 가 이 시험이 쓴 값(maintenance · 301 · zzb3p0 시험 점검)이 아니다. 아무것도 바꾸지 않았다 — 사람이 확인할 것';
  end if;

  -- 3. 301 의 예외 행이 정확히 A 하나인가
  select pg_catalog.count(*) into v_n from security_private.maintenance_exception me where me.maintenance_id = 301;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 중단: 점검 번호 301 의 예외 행이 %개다(이 시험이 넣은 한 행이어야 한다). 아무것도 바꾸지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n
    from security_private.maintenance_exception me where me.maintenance_id = 301 and me.auth_user_id = v_acct;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 중단: 점검 번호 301 의 예외 행이 회원 A 의 것이 아니다. 아무것도 바꾸지 않았다';
  end if;

  -- 되돌리기
  delete from security_private.maintenance_exception me where me.maintenance_id = 301 and me.auth_user_id = v_acct;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 실패: 예외 행이 %행 지워졌다(1이어야 한다). 전부 되돌린다', v_n;
  end if;

  update security_private.site_state
     set maintenance_id            = (v_j ->> 'maintenance_id')::pg_catalog.int4,
         phase                     = v_j ->> 'phase',
         starts_at                 = (v_j ->> 'starts_at')::pg_catalog.timestamptz,
         message                   = v_j ->> 'message',
         last_ended_maintenance_id = (v_j ->> 'last_ended_maintenance_id')::pg_catalog.int4,
         last_ended_at             = (v_j ->> 'last_ended_at')::pg_catalog.timestamptz,
         updated_at                = (v_j ->> 'updated_at')::pg_catalog.timestamptz
   where id = 1;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 원복 실패: site_state 가 %행 바뀌었다(1이어야 한다). 전부 되돌린다', v_n;
  end if;

  -- 지금의 행이 넘겨받은 값과 열마다 같은가(시각은 형을 맞춰 견준다)
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
    raise exception 'zzb3p0 점검 원복 실패: 되돌린 행이 넘겨받은 값과 같지 않다. 전부 되돌린다';
  end if;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'maintenance restored to the saved row',
  'site_state_row', (select pg_catalog.to_jsonb(ss) from security_private.site_state ss where ss.id = 1),
  'site_state_row_md5', (select pg_catalog.md5(pg_catalog.to_jsonb(ss)::pg_catalog.text) from security_private.site_state ss where ss.id = 1),
  'exception_rows_301_left', (select pg_catalog.count(*) from security_private.maintenance_exception me where me.maintenance_id = 301)
) as result;
