-- =====================================================================
-- 첨삭(스라첨삭) 종료일 컬럼 추가 — 자기주도(시작·종료 지정형) ①단계
--
-- 목적:
--   지금까지 "첨삭 종료 = 시작일 + 27일(4주 고정)"로 여러 곳에서 각자 계산하던 것을,
--   관리자가 지정한 "첨삭 종료일" 하나로 합친다. 종료일이 비어 있는 학생은
--   기존과 완전히 동일하게 동작한다(4주 고정 폴백).
--
-- 안전성:
--   전부 nullable 컬럼 추가(ADD COLUMN IF NOT EXISTS)라 기존 동작 무변경.
--   컬럼이 없어도 공홈/테스트룸 코드는 "종료일 없음 = 기존 동작"으로 깨지지 않는다.
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체를 실행.
--   (라이브 DB 변경이므로 대표 별도 승인 후 운영자가 실행. 이 저장소는 레포 사본만 보관.)
-- =====================================================================

ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS correction_end_date DATE,
    ADD COLUMN IF NOT EXISTS extension_end_date  DATE;

ALTER TABLE correction_schedules
    ADD COLUMN IF NOT EXISTS end_date                DATE,
    ADD COLUMN IF NOT EXISTS session_dates           TEXT,
    ADD COLUMN IF NOT EXISTS extension_end_date      DATE,
    ADD COLUMN IF NOT EXISTS extension_session_dates TEXT;

COMMENT ON COLUMN applications.correction_end_date IS '첨삭(1~12세션) 종료일 = 마지막 1차 제출 가능일. 비어 있으면 4주 고정(시작일+27일).';
COMMENT ON COLUMN applications.extension_end_date  IS '첨삭 연장(13~24세션) 종료일. ③단계용 예비. 비어 있으면 4주 고정(연장 시작일+27일).';

COMMENT ON COLUMN correction_schedules.end_date                IS '첨삭(1~12세션) 종료일 = 마지막 1차 제출 가능일. 비어 있으면 4주 고정(시작일+27일).';
COMMENT ON COLUMN correction_schedules.session_dates           IS '테스트룸이 쓰는 확정 일정표 JSON {"start":"YYYY-MM-DD","end":"YYYY-MM-DD","dates":[12개]}.';
COMMENT ON COLUMN correction_schedules.extension_end_date      IS '첨삭 연장(13~24세션) 종료일. ③단계용 예비. 비어 있으면 4주 고정(연장 시작일+27일).';
COMMENT ON COLUMN correction_schedules.extension_session_dates IS '연장(13~24세션) 확정 일정표 JSON. ③단계용 예비.';
