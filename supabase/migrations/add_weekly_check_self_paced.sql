-- =====================================================================
-- 주간체크 초안에 자기주도(Self-Paced) 표식 추가
--
-- 배경:
--   자기주도 학생의 주간체크는 별도 워크플로(자기주도 전용)에서 생성한다.
--   일반 내챌 초안과 구분해서 ① 관리자 검토화면 뱃지 ② 중복 생성 방지
--   두 가지에 쓰기 위한 플래그가 필요하다.
--
--   기존 초안(일반 내챌)은 모두 false 로 남는다 (DEFAULT false).
--   컬럼 부재 시 프론트/워크플로가 undefined 로 안전 폴백하므로
--   이 마이그레이션 전에도 기존 기능은 정상 동작한다.
--
-- 컬럼:
--   self_paced  BOOLEAN  = 이 초안이 자기주도 주간체크인지 여부 (기본 false)
--
-- 2026-07-15
-- =====================================================================

ALTER TABLE tr_weekly_check_drafts
ADD COLUMN IF NOT EXISTS self_paced BOOLEAN DEFAULT false;

COMMENT ON COLUMN tr_weekly_check_drafts.self_paced IS '자기주도 주간체크 여부. 자기주도 전용 워크플로가 true 로 저장. 관리자 뱃지 + 중복 생성 방지용.';
