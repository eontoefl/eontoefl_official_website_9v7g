-- ============================================================
-- 첨삭 연장(13~24세션) — applications 미러 컬럼 추가
-- 대상 테이블: applications
-- 작성: 2026-06
--
-- 배경:
--   테스트룸은 correction_schedules.extension_enabled / extension_start_date 를 읽어
--   13~24세션(연장)을 노출함 (이미 적용 완료).
--   공홈 대시보드/신청상세는 applications 를 읽으므로, 같은 정보를 여기에도 미러링한다.
--   관리 모달의 [연장 적용] 버튼이 applications + correction_schedules 양쪽에 기록함.
--
-- 운영 흐름:
--   관리자 → 신청 관리 모달 → "첨삭 연장(13~24세션)" 에 시작일 입력 후 [연장 적용]
--   ⇒ extension_enabled = true, extension_start_date = 입력값 으로 양쪽 테이블 갱신
--   첨삭을 끄면(correction_enabled=false) 연장도 자동 해제됨.
-- ============================================================

ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS extension_enabled    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS extension_start_date DATE;

COMMENT ON COLUMN applications.extension_enabled
    IS '첨삭 연장(13~24세션) 활성화 여부. correction_schedules 미러.';
COMMENT ON COLUMN applications.extension_start_date
    IS '첨삭 연장(13~24세션) 시작일. 종료 = 시작일+27일. correction_schedules 미러.';
