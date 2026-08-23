-- 목요일 마감을 넘긴 '이번주 시작' 학생의 시작 선택 저장
-- 목요일 23:59(KST) 컷오프 이후 입금하는 학생이 화면에서 고른 값.
-- '이번주' | '다음주' | NULL(미선택=이번주 기본). Step5 관리자 흐름이 이 값을 소비한다.

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS late_start_choice text DEFAULT NULL;

COMMENT ON COLUMN applications.late_start_choice
IS '목요일 마감 넘긴 이번주-시작 학생의 시작 선택. 이번주/다음주/NULL(미선택=이번주 기본). Step5 관리자 흐름이 소비.';
