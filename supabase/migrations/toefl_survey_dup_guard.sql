-- =====================================================================
-- 실전 리포트: 중복 제출 원천 봉쇄 (번호 + 시험 날짜)
--
-- 비로그인 제출은 user_id가 없어 기존 UNIQUE(question_id, user_id, exam_date)를
-- 우회할 수 있으므로, 번호 기준의 유니크 제약을 추가한다.
-- 화면 검사(제출 전 조회)를 뚫어도 DB가 막는다.
-- 번호가 없는 옛 응답(user_phone IS NULL)은 제외.
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_toefl_survey_phone_exam
    ON toefl_survey_responses (question_id, user_phone, exam_date)
    WHERE user_phone IS NOT NULL;
