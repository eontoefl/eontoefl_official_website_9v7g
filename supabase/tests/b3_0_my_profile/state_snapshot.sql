-- =====================================================================
-- 보안작업 묶음 2 — 계약 3-0 점검 상태·공통 확인 설정의 현재 값 전체 (읽기만, 한 문장, 결과 한 칸 jsonb)
--
-- 이 파일은 작업방이 실행해 보지 않았다(문법 확인도 하지 못했다). 아무것도 바꾸지 않는다.
-- 쓰는 곳(절차.md 7단계): 점검·공통 확인 설정을 켜기 **전에** 떠서 저장하고(S0), 원복한 **뒤에** 다시 떠서
--   node profile_matrix.mjs --phase compare --a S0.json --b S9.json  으로 견준다(read_at 말고 전부 같아야 한다).
--   지문(fingerprint.sql)은 site_state 의 updated_at 을 보지 않는다 — 원복의 확인은 이 파일의 "행 전체"로 한다.
--
-- 결과의 키
--   site_state_rows            security_private.site_state 의 행 수(1 이어야 한다)
--   site_state_columns         그 표의 열 이름(순서대로)
--   site_state_row             id = 1 인 행 전체(모든 열, updated_at 포함) — 시작 행. maint_on.sql 과 maint_off.sql 에 그대로 넘긴다
--                              (maint_on: 지금 행이 이 값일 때만 켠다 / maint_off: 이 값으로 되돌린다)
--   site_state_row_md5         그 행을 글자로 바꾼 것의 md5(참고용 — 접속의 시간대 설정에 따라 달라질 수 있어 SQL 의 비교에는 쓰지 않는다)
--   authenticator_rolconfig    authenticator 역할의 설정 전체(pg_roles.rolconfig)
--   authenticator_settings     authenticator 역할의 설정 행 전체(pg_db_role_setting: database 0 = 모든 DB)
--   pre_request_items          그중 pgrst.db_pre_request 로 시작하는 항목(없으면 [])
--   maintenance_exception      예외 명단의 행 전체
-- =====================================================================
select pg_catalog.jsonb_build_object(
  'read_at', pg_catalog.now(),
  'site_state_rows', (select pg_catalog.count(*) from security_private.site_state),
  'site_state_columns', (
    select pg_catalog.jsonb_agg(a.attname order by a.attnum)
      from pg_catalog.pg_attribute a
     where a.attrelid = pg_catalog.to_regclass('security_private.site_state')
       and a.attnum > 0 and not a.attisdropped
  ),
  'site_state_row', (select pg_catalog.to_jsonb(ss) from security_private.site_state ss where ss.id = 1),
  'site_state_row_md5', (select pg_catalog.md5(pg_catalog.to_jsonb(ss)::pg_catalog.text) from security_private.site_state ss where ss.id = 1),
  'authenticator_rolconfig', (select pg_catalog.to_jsonb(r.rolconfig) from pg_catalog.pg_roles r where r.rolname = 'authenticator'),
  'authenticator_settings', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'database', s.setdatabase::pg_catalog.text, 'config', pg_catalog.to_jsonb(s.setconfig)) order by s.setdatabase), '[]'::pg_catalog.jsonb)
      from pg_catalog.pg_db_role_setting s
      join pg_catalog.pg_roles r on r.oid = s.setrole
     where r.rolname = 'authenticator'
  ),
  'pre_request_items', (
    select coalesce(pg_catalog.jsonb_agg(cfg.item order by cfg.item), '[]'::pg_catalog.jsonb)
      from pg_catalog.pg_db_role_setting s
      join pg_catalog.pg_roles r on r.oid = s.setrole
      cross join lateral pg_catalog.unnest(s.setconfig) as cfg(item)
     where r.rolname = 'authenticator'
       and pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1
  ),
  'maintenance_exception', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(me) order by me.maintenance_id, me.auth_user_id), '[]'::pg_catalog.jsonb)
      from security_private.maintenance_exception me
  )
) as result;
