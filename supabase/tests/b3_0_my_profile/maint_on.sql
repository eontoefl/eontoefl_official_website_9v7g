-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 시험: 점검 켜기 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
--
-- ★★★ 운영 경고 ★★★  운영에서 실행하지 않는다(사이트가 점검 상태가 된다).
--   실행 직전에 SQL 통로가 가리키는 프로젝트의 ref 가 hmncdheiwqwekdbtijar 인지 직접 확인한다.
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 순서는 절차.md 7단계.
--
-- 받는 값(같은 요청의 맨 앞)
--     set b3_0.test_project_ref = 'hmncdheiwqwekdbtijar';
--     set b3_0.acct_a = '<회원 A 의 정확한 계정 번호>';
--     set b3_0.saved_row_md5 = '<켜기 전에 뜬 state_snapshot.sql 의 site_state_row_md5>';
-- 하는 일(한 트랜잭션)
--   security_private.site_state (id = 1)        phase 'maintenance' · maintenance_id 301 · message 'zzb3p0 시험 점검' · updated_at 지금
--                                               (starts_at · last_ended_* 는 건드리지 않는다)
--   security_private.maintenance_exception      (301, <A 의 계정 번호>) 한 행
-- 켜기 전에 확인하는 것(다르면 아무것도 바꾸지 않고 멈춘다)
--   0. 대상 확인 값, 계정 번호의 모양
--   1. 지금의 site_state 행이 **저장해 둔 것과 같다**(md5) — 저장하지 않았거나 저장한 뒤 바뀌었으면 켜지 않는다
--   2. 지금 phase 가 'normal' 이다(이 시험은 normal 에서만 시작한다)
--   3. 점검 번호 301 의 예외 행이 하나도 없다
--   4. A 의 계정 번호가 로그인 계정에 있다
-- 원복: maint_off.sql (저장해 둔 site_state_row 전체를 넘긴다)
-- 마지막 결과(한 칸 jsonb): 지금의 site_state 행과 301 의 예외 행
-- =====================================================================

begin;

do $zz_b3p0$
declare
  v_acct_raw text := coalesce(pg_catalog.current_setting('b3_0.acct_a', true), '');
  v_saved    text := coalesce(pg_catalog.current_setting('b3_0.saved_row_md5', true), '');
  v_acct     pg_catalog.uuid;
  v_n        bigint;
  v_phase    text;
  v_md5      text;
begin
  if coalesce(pg_catalog.current_setting('b3_0.test_project_ref', true), '') <> 'hmncdheiwqwekdbtijar' then
    raise exception 'zzb3p0 점검 켜기 중단: 대상 확인 값이 없다. 아무것도 바꾸지 않았다';
  end if;
  if v_acct_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.acct_a 에 회원 A 의 계정 번호가 없다. 아무것도 바꾸지 않았다';
  end if;
  v_acct := v_acct_raw::pg_catalog.uuid;
  if v_saved !~ '^[0-9a-f]{32}$' then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.saved_row_md5 가 없다. 먼저 state_snapshot.sql 을 떠서 저장하고 그 site_state_row_md5 를 넘길 것. 아무것도 바꾸지 않았다';
  end if;

  select pg_catalog.count(*) into v_n from security_private.site_state;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 켜기 중단: site_state 의 행이 %개다(1이어야 한다). 아무것도 바꾸지 않았다', v_n;
  end if;
  select ss.phase, pg_catalog.md5(pg_catalog.to_jsonb(ss)::pg_catalog.text)
    into v_phase, v_md5
    from security_private.site_state ss
   where ss.id = 1;
  if v_md5 is distinct from v_saved then
    raise exception 'zzb3p0 점검 켜기 중단: 지금의 site_state 행이 저장해 둔 것과 다르다(지금 md5 %). state_snapshot.sql 을 다시 떠서 저장할 것. 아무것도 바꾸지 않았다', v_md5;
  end if;
  if v_phase is distinct from 'normal' then
    raise exception 'zzb3p0 점검 켜기 중단: 지금 phase 가 normal 이 아니다(%). 아무것도 바꾸지 않았다', v_phase;
  end if;

  select pg_catalog.count(*) into v_n from security_private.maintenance_exception me where me.maintenance_id = 301;
  if v_n <> 0 then
    raise exception 'zzb3p0 점검 켜기 중단: 점검 번호 301 의 예외 행이 이미 %개 있다. 아무것도 바꾸지 않았다', v_n;
  end if;
  select pg_catalog.count(*) into v_n from auth.users au where au.id = v_acct;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 켜기 중단: b3_0.acct_a 의 계정 번호가 로그인 계정에 없다. 아무것도 바꾸지 않았다';
  end if;

  update security_private.site_state
     set phase = 'maintenance', maintenance_id = 301, message = 'zzb3p0 시험 점검', updated_at = pg_catalog.now()
   where id = 1;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 켜기 실패: site_state 가 %행 바뀌었다(1이어야 한다). 전부 되돌린다', v_n;
  end if;

  insert into security_private.maintenance_exception (maintenance_id, auth_user_id) values (301, v_acct);
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'zzb3p0 점검 켜기 실패: 예외 행이 %행 들어갔다(1이어야 한다). 전부 되돌린다', v_n;
  end if;
end;
$zz_b3p0$;

commit;

reset b3_0.test_project_ref;

select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'done', 'maintenance on (maintenance_id 301)',
  'site_state_row', (select pg_catalog.to_jsonb(ss) from security_private.site_state ss where ss.id = 1),
  'exception_rows_301', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(me)), '[]'::pg_catalog.jsonb)
                           from security_private.maintenance_exception me where me.maintenance_id = 301)
) as result;
