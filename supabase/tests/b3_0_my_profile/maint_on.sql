-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 점검 켜기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용) — 3차 판
--
-- ★★★ 운영 경고 ★★★  운영에서 실행하지 않는다(사이트가 점검 상태가 된다).
--   실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 7단계.
--
-- 받는 값(같은 요청의 맨 앞. node profile_matrix.mjs --phase set-lines --for maint-on 이 만들어 준다)
--     set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3_0.acct_a = '<회원 A 의 정확한 계정 번호>';
--     set b3_0.saved_site_state = '<켜기 전에 뜬 state_snapshot.sql 의 site_state_row 를 글자 그대로>';   -- 시작 행 전체
-- 하는 일(한 트랜잭션)
--   security_private.site_state (id = 1)        phase 'maintenance' · maintenance_id 301 · message 'zzb3p0 시험 점검' · updated_at 지금
--                                               (starts_at · last_ended_* 는 건드리지 않는다)
--   security_private.maintenance_exception      (301, <A 의 계정 번호>) 한 행
-- 비교와 쓰기를 하나로 묶는다
--   * 먼저 그 행을 잠근다(select … for update). 예외 명단도 잠근다. 이 트랜잭션이 끝날 때까지 다른 작업이 그 행을 바꾸지 못한다.
--   * 갱신문의 조건에 "지금 행의 **모든 열**이 저장해 둔 시작 행과 같음"을 넣는다. 바뀐 행이 정확히 1이 아니면
--     (= 저장한 뒤 누가 그 행의 어느 열이든 바꿨으면) 예외로 끝나 전체가 되돌아간다.
-- 그 밖에 확인하는 것(다르면 아무것도 바꾸지 않고 멈춘다)
--   0. 대상 확인 값, 계정 번호의 모양
--   1. 넘겨받은 시작 행이 JSON 이고, 그 키가 지금 site_state 의 열 여덟 개와 정확히 같으며, id 가 1 이고 phase 가 'normal' 이다
--   2. 점검 번호 301 의 예외 행이 하나도 없다
--   3. A 의 계정 번호가 로그인 계정에 있다
-- 원복: maint_off.sql — **이 파일의 마지막 결과(켠 직후의 행 전체)를 저장해 그대로 넘긴다.**
-- 마지막 결과(한 칸 jsonb): site_state_row = 켠 직후의 행 전체(maint-on.json 으로 저장한다), 301 의 예외 행
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_cols     constant text[] := array['id', 'last_ended_at', 'last_ended_maintenance_id', 'maintenance_id', 'message', 'phase', 'starts_at', 'updated_at'];
  v_acct_raw text := coalesce(pg_catalog.current_setting('b3_0.acct_a', true), '');
  v_raw      text := coalesce(pg_catalog.current_setting('b3_0.saved_site_state', true), '');
  v_acct     pg_catalog.uuid;
  v_j        pg_catalog.jsonb;
  v_keys     text[];
  v_live     text[];
  v_on       pg_catalog.jsonb;
  v_n        bigint;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 점검 켜기 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_acct_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.acct_a 에 회원 A 의 계정 번호가 없다. 아무것도 바꾸지 않았다';
  end if;
  v_acct := v_acct_raw::pg_catalog.uuid;

  -- 1. 넘겨받은 시작 행
  if v_raw = '' then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.saved_site_state 가 없다. 먼저 state_snapshot.sql 을 떠서 저장하고 그 site_state_row 를 넘길 것. 아무것도 바꾸지 않았다';
  end if;
  begin
    v_j := v_raw::pg_catalog.jsonb;
  exception when others then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.saved_site_state 의 값이 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end;
  if pg_catalog.jsonb_typeof(v_j) is distinct from 'object' then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.saved_site_state 가 행 하나의 JSON 이 아니다. 아무것도 바꾸지 않았다';
  end if;
  select pg_catalog.array_agg(k) into v_keys from pg_catalog.jsonb_object_keys(v_j) as t(k);
  select pg_catalog.array_agg(a.attname::pg_catalog.text) into v_live
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass('security_private.site_state') and a.attnum > 0 and not a.attisdropped;
  if v_keys is null or v_live is null
     or pg_catalog.array_length(v_keys, 1) <> 8 or pg_catalog.array_length(v_live, 1) <> 8
     or not (v_keys @> v_cols and v_cols @> v_keys)
     or not (v_live @> v_cols and v_cols @> v_live) then
    raise exception 'zzb3p0 점검 켜기 중단: 넘겨받은 행의 키나 지금 site_state 의 열이 이 파일이 아는 여덟 열과 다르다. 아무것도 바꾸지 않았다 — 사람이 확인할 것';
  end if;
  if (v_j ->> 'id') is distinct from '1' or (v_j ->> 'phase') is distinct from 'normal' then
    raise exception 'zzb3p0 점검 켜기 중단: 넘겨받은 시작 행이 id 1 · phase normal 이 아니다(이 시험은 normal 에서만 시작한다). 아무것도 바꾸지 않았다';
  end if;

  -- 잠금: 이 트랜잭션이 끝날 때까지 그 행과 예외 명단을 다른 작업이 바꾸지 못한다
  perform 1 from security_private.site_state ss where ss.id = 1 for update;
  if not found then
    raise exception 'zzb3p0 점검 켜기 중단: site_state 에 id = 1 인 행이 없다. 아무것도 바꾸지 않았다';
  end if;
  lock table security_private.maintenance_exception in share row exclusive mode;

  -- 2·3
  select pg_catalog.count(*) into v_n from security_private.maintenance_exception me where me.maintenance_id = 301;
  if v_n <> 0 then
    raise exception 'zzb3p0 점검 켜기 중단: 점검 번호 301 의 예외 행이 이미 %개 있다. 아무것도 바꾸지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n from auth.users au where au.id = v_acct;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.acct_a 의 계정 번호가 로그인 계정에 없다. 아무것도 바꾸지 않았다';
  end if;

  -- 비교와 쓰기를 한 문장으로: 지금 행의 모든 열이 저장해 둔 시작 행과 같을 때만 바꾼다
  update security_private.site_state ss
     set phase = 'maintenance', maintenance_id = 301, message = 'zzb3p0 시험 점검', updated_at = pg_catalog.now()
   where ss.id = 1
     and ss.maintenance_id            is not distinct from (v_j ->> 'maintenance_id')::pg_catalog.int4
     and ss.phase                     is not distinct from (v_j ->> 'phase')
     and ss.starts_at                 is not distinct from (v_j ->> 'starts_at')::pg_catalog.timestamptz
     and ss.message                   is not distinct from (v_j ->> 'message')
     and ss.last_ended_maintenance_id is not distinct from (v_j ->> 'last_ended_maintenance_id')::pg_catalog.int4
     and ss.last_ended_at             is not distinct from (v_j ->> 'last_ended_at')::pg_catalog.timestamptz
     and ss.updated_at                is not distinct from (v_j ->> 'updated_at')::pg_catalog.timestamptz
  returning pg_catalog.to_jsonb(ss) into v_on;
  get diagnostics v_n = row_count;
  if v_n <> 1 or v_on is null then
    raise exception 'zzb3p0 점검 켜기 중단: 지금의 site_state 행이 저장해 둔 시작 행과 다르다(바뀐 행 %). state_snapshot.sql 을 다시 떠서 저장할 것. 아무것도 바꾸지 않았다', v_n;
  end if;
  -- 이 트랜잭션이 쓴 행 전체를 이 접속에 적어 둔다(마지막 결과가 "커밋 뒤에 다시 읽은 행"이 아니라 "켠 직후의 행"이도록)
  perform pg_catalog.set_config('b3_0.on_site_state', v_on::pg_catalog.text, false);

  insert into security_private.maintenance_exception (maintenance_id, auth_user_id) values (301, v_acct);
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 켜기 실패: 예외 행이 %행 들어갔다(1이어야 한다). 전부 되돌린다', v_n;
  end if;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

-- 켠 직후의 행 전체(위 트랜잭션이 쓴 그 행). 이 결과를 maint-on.json 으로 저장해 maint_off.sql 에 그대로 넘긴다.
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'maintenance on (maintenance_id 301)',
  'site_state_row', pg_catalog.current_setting('b3_0.on_site_state')::pg_catalog.jsonb,
  'row_now_is_the_same', (select pg_catalog.to_jsonb(ss) = pg_catalog.current_setting('b3_0.on_site_state')::pg_catalog.jsonb
                            from security_private.site_state ss where ss.id = 1),
  'exception_rows_301', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(me)), '[]'::pg_catalog.jsonb)
                           from security_private.maintenance_exception me where me.maintenance_id = 301)
) as result;
