-- 계약서 기한 유예(관리자 덮어쓰기) 기능
-- 관리자가 특정 학생의 계약서 동의 기한을 원하는 날짜로 지정할 수 있도록 함
-- NULL이면 기존 contract_sent_at + 24시간 로직 적용, 값이 있으면 해당 날짜를 기한으로 사용

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS contract_deadline_override timestamptz DEFAULT NULL;

COMMENT ON COLUMN applications.contract_deadline_override
IS '관리자가 지정한 계약서 동의 기한(유예). NULL이면 기존 contract_sent_at + 24시간 로직 적용.';

-- 유예 리마인더 발송 여부 (중복 발송 방지용)
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS contract_deferral_reminder_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN applications.contract_deferral_reminder_sent_at
IS '계약서 유예 만료 24시간 전 리마인더 알림톡 발송 시각. NULL이면 미발송.';
