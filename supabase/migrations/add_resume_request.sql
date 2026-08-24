-- 만료(동의/계약 기한 초과) 후 학생이 남긴 '이어서 진행 요청' 저장
-- 만료 화면의 [이어서 진행 요청하기] 버튼이 이 세 컬럼을 채운다.
-- 5b(사장님 승인 → *_deadline_override 미래로 리셋)와 5c(관리자 입금확인)가 이 값을 소비한다.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS resume_requested_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resume_request_note text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resume_stage text DEFAULT NULL;

COMMENT ON COLUMN applications.resume_requested_at
IS '만료 후 학생이 재개(이어서 진행)를 요청한 시각. NULL이면 미요청. 5b 승인 시 그대로 두거나 소비.';
COMMENT ON COLUMN applications.resume_request_note
IS '재개 요청 시 학생이 남긴 선택 메모(달라진 점 등). 없으면 NULL.';
COMMENT ON COLUMN applications.resume_stage
IS '멈춘 단계. ''동의'' | ''계약'' | NULL. 5b가 어느 기한(analysis_deadline_override/contract_deadline_override)을 리셋할지 판단하는 데 사용.';
