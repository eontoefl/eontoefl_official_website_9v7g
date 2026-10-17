-- =====================================================================
-- 재시작(수강 2) 로컬 검증용 테스트 학생 (2026-10-16)
--   선행: 20261016_restart_1_additive.sql 적용
--   만드는 것: 회원 1명 + 끝난 수강 1 신청서(Fast, 2026-07-05~08-01, 입금 확인, 첨삭 없음) + 학습 기록 4줄(1주차, 인증률 낮음 → 환급 0원 구간)
--   로그인: 공홈·테스트룸 모두 이메일 restart.test@eontoefl.local / 마스터 비밀번호(999999)
--   실제 학생 데이터는 건드리지 않는다. 다 끝나면 맨 아래 CLEANUP 블록으로 지운다.
-- =====================================================================

BEGIN;

DO $fx$
DECLARE
    v_uid  uuid := gen_random_uuid();
    v_app  uuid := gen_random_uuid();
    v_ms   bigint := (extract(epoch from timestamptz '2026-06-20 10:00+09') * 1000)::bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.users WHERE email = 'restart.test@eontoefl.local') THEN
        RAISE EXCEPTION 'ABORT 테스트 학생이 이미 있음 — 먼저 CLEANUP 실행';
    END IF;

    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'restart.test@eontoefl.local', 'restart-test-9999', '재시작테스트', '재시작테스트', '010-0000-9999', 'student', v_ms, v_ms, false, 1, 'Asia/Seoul', false, 'general');

    INSERT INTO public.applications (
        id, user_id, email, name, phone, program, application_type, created_at, submitted_date, status, current_step,
        analysis_status, analysis_content, assigned_program, course_track, schedule_start, schedule_end, self_paced,
        deposit_confirmed_by_admin, deposit_confirmed_by_admin_at, correction_enabled,
        program_price, discount_amount, correction_fee, additional_discount, final_price,
        practice_enabled, deleted, service_stops, challenge_pauses,
        analysis_saved_at, analysis_first_saved_at, student_agreed_at, contract_sent_at, contract_agreed_at,
        address, bank_name, account_number, account_holder, preferred_program, preferred_correction,
        book_access_enabled, is_incentive_applicant, enrollment_no,
        contract_sent, contract_agreed, guide_sent, guide_sent_at, shipping_completed, shipping_completed_at, challenge_access_granted)
    VALUES (
        v_app, v_uid::text, 'restart.test@eontoefl.local', '재시작테스트', '010-0000-9999', '내벨업챌린지', 'challenge', v_ms, '2026-06-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(수강 1)', '내벨업챌린지 - Fast', 'regular', '2026-07-05', '2026-08-01', false,
        true, v_ms + 3 * 86400000, false,
        1000000, 210000, 0, 0, 890000,
        true, false, '[]'::jsonb, '[]'::jsonb,
        v_ms + 3600000, v_ms + 3600000, '2026-06-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        '서울특별시 테스트구 테스트로 1, 101호', '국민은행', '000000000000', '재시작테스트', '내벨업챌린지', '미신청',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true);

    -- 1주차 기록 4줄: 실전만 제출(50%) 2개 + 미제출 확정 0% 2개 → Fast 전체 과제 기준 인증률 한 자리 수(환급 0원)
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, error_note_submitted, locked_auth_rate, completed_at, created_at)
    VALUES
        (v_uid::text, v_app, 'reading',   1, '1', '일', '{"fixture": true, "score": 5, "total": 10}'::jsonb, false, 50, timestamptz '2026-07-05 21:00+09', timestamptz '2026-07-05 21:00+09'),
        (v_uid::text, v_app, 'listening', 1, '1', '월', '{"fixture": true, "score": 4, "total": 10}'::jsonb, false, 50, timestamptz '2026-07-06 21:00+09', timestamptz '2026-07-06 21:00+09'),
        (v_uid::text, v_app, 'reading',   2, '1', '화', NULL, false, 0, NULL, timestamptz '2026-07-08 04:10+09'),
        (v_uid::text, v_app, 'writing',   1, '1', '수', NULL, false, 0, NULL, timestamptz '2026-07-09 04:10+09');

    RAISE NOTICE '[재시작 픽스처] 회원 % · 수강 1 신청서 % 생성. 로그인: restart.test@eontoefl.local / 999999', v_uid, v_app;
END $fx$;

COMMIT;

-- =====================================================================
-- CLEANUP (검증 끝난 뒤) — 이 학생의 흔적 전부 삭제(수강 2 신청서·기록·첨삭 보관분 포함)
-- BEGIN;
-- DELETE FROM public.study_results_v3 WHERE user_id IN (SELECT id::text FROM public.users WHERE email = 'restart.test@eontoefl.local');
-- DELETE FROM public.tr_deadline_extensions WHERE user_id IN (SELECT id::text FROM public.users WHERE email = 'restart.test@eontoefl.local');
-- DELETE FROM public.tr_weekly_check_drafts WHERE user_id::text IN (SELECT id::text FROM public.users WHERE email = 'restart.test@eontoefl.local');   -- user_id가 uuid라 ::text 비교
-- DELETE FROM public.kakaotalk_logs WHERE application_id IN (SELECT id FROM public.applications WHERE email = 'restart.test@eontoefl.local');   -- 알림톡 로그(2026-10-17 정리 때 1줄 있었음)
-- DELETE FROM public.correction_submissions_archive WHERE user_id IN (SELECT id FROM public.users WHERE email = 'restart.test@eontoefl.local');
-- DELETE FROM public.correction_schedules_archive WHERE user_id IN (SELECT id FROM public.users WHERE email = 'restart.test@eontoefl.local');
-- DELETE FROM public.correction_schedules WHERE user_id IN (SELECT id FROM public.users WHERE email = 'restart.test@eontoefl.local');
-- DELETE FROM public.applications WHERE email = 'restart.test@eontoefl.local';
-- DELETE FROM public.contracts WHERE title LIKE '[테스트-삭제예정]%';   -- 눌러보기용 재시작 계약서 템플릿
-- DELETE FROM public.tr_user_map WHERE email = 'restart.test@eontoefl.local';
-- DELETE FROM public.users WHERE email = 'restart.test@eontoefl.local';
-- COMMIT;
-- =====================================================================
-- =====================================================================
-- 눌러보기 중 추가로 만든 것(2026-10-16) — CLEANUP 때 같이 지운다
--   · 회귀 확인용 학생 regression.test@eontoefl.local (수강 1만, 2026-10-11 시작 진행 중, 기록 3줄)
--   · 재시작테스트 학생의 수강 1 첨삭 기록(일정표 1·제출 3세션·알림 1) → '다시' 보관 이동 검증용
-- BEGIN;
-- DELETE FROM public.correction_submissions_archive WHERE user_id IN (SELECT id FROM public.users WHERE email IN ('restart.test@eontoefl.local','regression.test@eontoefl.local'));
-- DELETE FROM public.correction_session_reminders_archive WHERE user_id IN (SELECT id FROM public.users WHERE email IN ('restart.test@eontoefl.local','regression.test@eontoefl.local'));
-- DELETE FROM public.correction_schedules_archive WHERE user_id IN (SELECT id FROM public.users WHERE email IN ('restart.test@eontoefl.local','regression.test@eontoefl.local'));
-- DELETE FROM public.correction_submissions WHERE user_id IN (SELECT id FROM public.users WHERE email IN ('restart.test@eontoefl.local','regression.test@eontoefl.local'));
-- DELETE FROM public.correction_session_reminders WHERE user_id IN (SELECT id FROM public.users WHERE email IN ('restart.test@eontoefl.local','regression.test@eontoefl.local'));
-- DELETE FROM public.correction_schedules WHERE user_id IN (SELECT id FROM public.users WHERE email IN ('restart.test@eontoefl.local','regression.test@eontoefl.local'));
-- DELETE FROM public.study_results_v3 WHERE user_id IN (SELECT id::text FROM public.users WHERE email = 'regression.test@eontoefl.local');
-- DELETE FROM public.applications WHERE email = 'regression.test@eontoefl.local';
-- DELETE FROM public.users WHERE email = 'regression.test@eontoefl.local';
-- COMMIT;
-- =====================================================================
