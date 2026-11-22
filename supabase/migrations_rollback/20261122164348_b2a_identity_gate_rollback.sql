-- =====================================================================
-- 보안작업 묶음 2 — 계약 2-가 되돌리기
-- 대상: supabase/migrations/20261122164348_b2a_identity_gate.sql 이 만든 것만 지운다.
--   * 공개 함수 2개, security_private 의 함수 8개(도우미 current_session 포함)·표 5개, security_private 스키마.
--   * 이 파일은 2차 판(도우미가 있는 판)의 짝이다. 1차 판(fa172b2)이 적용된 곳에는 쓰지 않는다
--     (없는 도우미를 지우려다 실패한다). 1차 판은 fa172b2 의 되돌리기 SQL 로만 걷어낸다 —
--     두 판의 되돌리기를 섞지 않는다.
--   * cascade 를 쓰지 않는다(전부 restrict). 다른 객체(정책·뷰·외래키 등)가 기대고 있으면
--     그 자리에서 실패하고, 한 트랜잭션이므로 아무것도 지워지지 않는다.
--   * security_private 안에 이 마이그레이션이 만들지 않은 객체가 있으면 마지막 drop schema 가 실패한다.
--
-- 실행 전에 반드시 확인할 것
--   * 공통 확인 설정(pgrst.db_pre_request)이 security_private.check_api_request 를 가리키는 채로
--     함수를 지우면 PostgREST의 모든 요청이 실패한다. 설정은 "의존"으로 잡히지 않아 drop 이 막아 주지
--     않으므로, 아래 첫 블록이 설정을 읽어서 남아 있으면 멈춘다(읽기만 한다. 설정을 바꾸지 않는다).
--     설정 원복 명령은 supabase/tests/b2a_identity_gate/절차.md 6단계에 있다.
--   * 표 5개의 내용(대응표·관리자 명부·장부·점검 상태·예외 명단)은 함께 사라진다.
--   * 시험 전용 객체(zz_b2a_*)가 남아 있으면 그 정책이 판정 함수에 기대고 있어 실패한다.
--     먼저 supabase/tests/b2a_identity_gate/fixtures_down.sql 을 실행한다.
-- =====================================================================

begin;

-- 0. 안전 확인(읽기만): 공통 확인 설정이 이 스키마의 함수를 가리키고 있으면 중단.
do $b2a_rb$
begin
  if exists (
       select 1
         from pg_catalog.pg_db_role_setting s
        where exists (
                select 1
                  from pg_catalog.unnest(s.setconfig) as cfg(item)
                 where pg_catalog.strpos(cfg.item, 'pgrst.db_pre_request=') = 1
                   and pg_catalog.strpos(cfg.item, 'security_private.') > 0
              )
     ) then
    raise exception 'b2a 되돌리기 중단: pgrst.db_pre_request 설정이 아직 security_private 의 함수를 가리킨다. 설정을 먼저 원복할 것';
  end if;
end;
$b2a_rb$;

-- 1. 공개 함수
drop function public.my_site_access() restrict;
drop function public.site_status() restrict;

-- 2. 비공개 함수
drop function security_private.check_api_request() restrict;
drop function security_private.request_allowed() restrict;
drop function security_private.resolve_grant(text, text) restrict;
drop function security_private.is_current_admin() restrict;
drop function security_private.current_member_email() restrict;
drop function security_private.current_member_id_text() restrict;
drop function security_private.current_member_id() restrict;
drop function security_private.current_session() restrict;

-- 3. 표
drop table security_private.maintenance_exception restrict;
drop table security_private.site_state restrict;
drop table security_private.access_grant restrict;
drop table security_private.admin_principal restrict;
drop table security_private.member_identity restrict;

-- 4. 스키마(비어 있어야 지워진다)
drop schema security_private restrict;

commit;
