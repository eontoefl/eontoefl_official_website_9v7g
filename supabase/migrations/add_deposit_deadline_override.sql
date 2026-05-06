-- 입금 기한 관리자 덮어쓰기 기능
-- 관리자가 특정 학생의 입금 기한을 원하는 날짜로 지정할 수 있도록 함
-- NULL이면 기존 24시간 로직 적용, 값이 있으면 해당 날짜를 기한으로 사용

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS deposit_deadline_override timestamptz DEFAULT NULL;

COMMENT ON COLUMN applications.deposit_deadline_override
IS '관리자가 지정한 입금 기한. NULL이면 기존 contract_agreed_at + 24시간 로직 적용.';
