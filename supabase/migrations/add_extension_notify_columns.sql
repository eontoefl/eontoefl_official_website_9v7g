-- =====================================================================
-- 연장 알림톡(50246 스라첨삭 마감 연장 / 50247 내벨업챌린지 마감 연장) 발송 결과 기록 컬럼
--
-- 관리자가 첨삭 마감 연장(시간) 또는 내챌 과제 연장(일)을 저장하면
-- 관리자 화면이 그 자리에서 알림톡을 보내고, 결과를 연장 행에 기록한다.
-- 값: NULL(미발송) / 'sent' / 'failed'
--
-- 두 표 모두 기존 컬럼·제약은 그대로 둔다. (draft_round NULL 행 = 옛 행·둘 다 → 보존)
-- 적용: 대표가 Supabase SQL Editor에서 직접 실행. 코드 배포와 별개.
-- =====================================================================

ALTER TABLE correction_deadline_extensions
    ADD COLUMN IF NOT EXISTS notify_status text,
    ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN correction_deadline_extensions.notify_status IS
    '연장 알림톡(50246/50247) 발송 결과. 관리자 화면이 발송 직후 기록. NULL=미발송 / sent / failed';
COMMENT ON COLUMN correction_deadline_extensions.notified_at IS
    '연장 알림톡(50246/50247) 발송 결과. 관리자 화면이 발송 직후 기록한 발송 시각';

ALTER TABLE tr_deadline_extensions
    ADD COLUMN IF NOT EXISTS notify_status text,
    ADD COLUMN IF NOT EXISTS notified_at timestamptz;

COMMENT ON COLUMN tr_deadline_extensions.notify_status IS
    '연장 알림톡(50246/50247) 발송 결과. 관리자 화면이 발송 직후 기록. NULL=미발송 / sent / failed';
COMMENT ON COLUMN tr_deadline_extensions.notified_at IS
    '연장 알림톡(50246/50247) 발송 결과. 관리자 화면이 발송 직후 기록한 발송 시각';
