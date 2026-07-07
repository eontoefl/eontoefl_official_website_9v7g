-- =====================================================================
-- 자기주도(Self-Paced) 컬럼 추가
--
-- 배경:
--   테스트룸(nevelup-testroom)에 자기주도 v2가 이미 구현돼 있음.
--   시작일(schedule_start)~완료 종료일(self_paced_end_date) 사이에 24세트를
--   자동 배분(압축)하고 세트별 매일 마감으로 진행하는 모드.
--   공홈 관리자(개별분석 관리모달)에서 이 두 컬럼을 세팅해주면 테스트룸이 읽어서 동작.
--
-- 컬럼:
--   self_paced          BOOLEAN  = 자기주도 모드 ON/OFF (기본 false)
--   self_paced_end_date DATE     = v2 완료 종료일. 있으면 압축+매일마감 모드로 gate.
--                                   (schedule_start 은 기존 컬럼 재사용)
--
-- 참고:
--   self_paced_weeks (구 v1 무마감 방식)는 신규에서 사용하지 않으므로 추가하지 않음.
--   테스트룸은 컬럼 부재 시 try/catch 로 안전 폴백하므로 이 마이그레이션 전에도 로그인은 정상.
--
-- 2026-07-07
-- =====================================================================

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS self_paced BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS self_paced_end_date DATE;

COMMENT ON COLUMN applications.self_paced IS '자기주도(Self-Paced) 모드 여부. 관리자 개별분석 시 확정.';
COMMENT ON COLUMN applications.self_paced_end_date IS '자기주도 v2 완료 종료일(YYYY-MM-DD). 시작일~이 날짜 사이에 24세트 자동 배분. 있으면 압축+매일마감 모드.';
