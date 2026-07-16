-- =====================================================================
-- 실전 리포트 (시험 정보 수집 설문)
--
-- 목적: 실제 시험을 본 학생에게서 시험 구성 정보를 수집해 가설을 검증한다.
--   예) 제보 "학술지문이 4문단 나왔어요" → 검증 질문 등록 → 응답 수집
--       → 목표 인원(기본 5명) 차면 자동으로 학생에게 안 보임(수집 종료)
--       → 관리자가 사실/거짓 판정 후 마감 → 자료 반영
--
-- 규칙:
--   - 모든 질문은 관리자가 직접 생성 (고정 문항 없음)
--   - question_type: 'choice'(객관식, options에 보기 배열) | 'text'(서술형)
--   - target_count: 목표 응답 수. null이면 계속 수집(자동 마감 없음)
--   - 같은 시험(응시일)당 1인 1회 제출 (UNIQUE로 강제)
--   - 응답에는 학생의 최근 응시 시험 날짜가 자동으로 붙는다
--     (등록된 시험이 없으면 학생이 직접 선택)
-- =====================================================================

CREATE TABLE IF NOT EXISTS toefl_survey_questions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_text  text NOT NULL,
    question_type  text NOT NULL DEFAULT 'choice'
                   CHECK (question_type IN ('choice', 'text')),
    options        jsonb,                      -- 객관식 보기 배열 ["2문단","3문단",...]
    target_count   int DEFAULT 5,              -- null = 계속 수집
    hypothesis     text,                       -- 이 질문이 검증하려는 가설/제보 (관리 메모)
    status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'closed')),
    verdict        text,                       -- '사실' | '거짓' (마감 시 관리자 판정)
    verdict_note   text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    closed_at      timestamptz
);

CREATE TABLE IF NOT EXISTS toefl_survey_responses (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id  uuid NOT NULL REFERENCES toefl_survey_questions(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL,
    user_name    text,
    user_email   text,
    exam_date    date NOT NULL,                -- 어느 시험(응시일)에 대한 응답인지
    answer       text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (question_id, user_id, exam_date)   -- 같은 시험당 질문별 1회
);

CREATE INDEX IF NOT EXISTS idx_toefl_survey_resp_user
    ON toefl_survey_responses(user_id, exam_date);
CREATE INDEX IF NOT EXISTS idx_toefl_survey_resp_question
    ON toefl_survey_responses(question_id);
