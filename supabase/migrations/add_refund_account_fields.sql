-- 환불 계좌 정보를 은행명 / 계좌번호 / 예금주 3개 필드로 분리 저장
-- 기존 bank_account(합친 문자열)는 관리자 표시·구버전 호환을 위해 그대로 유지하고 계속 채운다.
-- 2026-08-13

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS bank_name TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS account_number TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS account_holder TEXT DEFAULT NULL;

COMMENT ON COLUMN applications.bank_name IS '환불 계좌 은행명(드롭다운 선택값)';
COMMENT ON COLUMN applications.account_number IS '환불 계좌번호(하이픈 없이 숫자만)';
COMMENT ON COLUMN applications.account_holder IS '환불 계좌 예금주명';
