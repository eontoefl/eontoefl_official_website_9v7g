-- =====================================================================
-- 리셋 검증용 가짜 학생 4명 (2026-10-18)
--   선행: 20261018_reset_1.sql 적용
--   실제 학생 데이터는 건드리지 않는다. 다 끝나면 맨 아래 CLEANUP 으로 지운다.
--   로그인(공홈·테스트룸): 이메일 reset.*@eontoefl.local / 마스터 비밀번호(999999)
--
--   reset.a  정규 Fast 진행 중(2026-10-04~10-31) · 첨삭 포함(10-18 시작, 3회차 제출 = 처음부터 대상) · 챌린지 정지 1건 열림 · 주간체크 초안 pending 1 · 기록 5줄
--   reset.b  정규 Standard 진행 중 · 첨삭 7회차 제출(= 그대로 대상) · 첨삭 정지 열림(밀어 둔 날짜 유지돼야 함)
--   reset.c  자기주도(종료일 11-13) · 첨삭 자기주도(종료일 지정) 0회 제출
--   reset.d  호주 Standard · 호주 기록 2줄 · 첨삭 없음 · 연습코스 꺼짐
-- =====================================================================

BEGIN;

DO $fx$
DECLARE
    v_ms bigint := (extract(epoch from timestamptz '2026-09-20 10:00+09') * 1000)::bigint;
    r record;
    v_uid uuid; v_app uuid;
    v_users text[] := ARRAY['reset.a@eontoefl.local','reset.b@eontoefl.local','reset.c@eontoefl.local','reset.d@eontoefl.local'];
BEGIN
    IF EXISTS (SELECT 1 FROM public.users WHERE email = ANY(v_users)) THEN
        RAISE EXCEPTION 'ABORT 테스트 학생이 이미 있음 — 먼저 CLEANUP 실행';
    END IF;

    -- ---------- A ----------
    v_uid := gen_random_uuid(); v_app := gen_random_uuid();
    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'reset.a@eontoefl.local', 'reset-test-9999', '리셋테스트A', '리셋테스트A', '010-0000-9901', 'student', v_ms, v_ms, false, 1, 'Asia/Seoul', false, 'general');
    INSERT INTO public.applications (
        id, user_id, email, name, phone, program, application_type, created_at, submitted_date, status, current_step,
        analysis_status, analysis_content, assigned_program, course_track, schedule_start, schedule_end, self_paced,
        deposit_confirmed_by_admin, deposit_confirmed_by_admin_at, correction_enabled, correction_start_date,
        program_price, discount_amount, correction_fee, additional_discount, final_price,
        practice_enabled, deleted, service_stops, challenge_pauses, correction_pauses,
        analysis_saved_at, analysis_first_saved_at, student_agreed_at, contract_sent_at, contract_agreed_at,
        address, bank_name, account_number, account_holder, preferred_program, preferred_correction,
        book_access_enabled, is_incentive_applicant, enrollment_no,
        contract_sent, contract_agreed, guide_sent, guide_sent_at, shipping_completed, shipping_completed_at, challenge_access_granted, start_notice_sent_for)
    VALUES (
        v_app, v_uid::text, 'reset.a@eontoefl.local', '리셋테스트A', '010-0000-9901', '내벨업챌린지', 'challenge', v_ms, '2026-09-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(A)', '내벨업챌린지 - Fast', 'regular', '2026-10-04', '2026-10-31', false,
        true, v_ms + 3 * 86400000, true, '2026-10-18',
        1000000, 210000, 200000, 0, 1090000,
        false, false, '[]'::jsonb,
        -- 챌린지 정지 1건 열림(10-11부터 무기한)
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'status', 'open', 'paused_from', '2026-10-11', 'resume_on', NULL, 'shift_days', NULL, 'created_at', '2026-10-10T09:00:00+09:00', 'created_by', '픽스처', 'note', '픽스처 정지')),
        '[]'::jsonb,
        v_ms + 3600000, v_ms + 3600000, '2026-09-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        '서울특별시 테스트구 테스트로 1', '국민은행', '000000000001', '리셋테스트A', '내벨업챌린지', '신청함',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true, '2026-10-04');
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, error_note_submitted, locked_auth_rate, completed_at, created_at) VALUES
        (v_uid::text, v_app, 'vocab',     1, '1', '일', '{"fixture": true, "score": 20, "total": 30}'::jsonb, false, 100, timestamptz '2026-10-04 21:00+09', timestamptz '2026-10-04 21:00+09'),
        (v_uid::text, v_app, 'reading',   1, '1', '일', '{"fixture": true, "score": 5, "total": 10}'::jsonb, true, 100, timestamptz '2026-10-04 21:10+09', timestamptz '2026-10-04 21:10+09'),
        (v_uid::text, v_app, 'listening', 1, '1', '월', '{"fixture": true, "score": 4, "total": 10}'::jsonb, false, 50, timestamptz '2026-10-05 21:00+09', timestamptz '2026-10-05 21:00+09'),
        (v_uid::text, v_app, 'reading',   2, '1', '화', NULL, false, 0, NULL, timestamptz '2026-10-07 04:10+09'),
        (v_uid::text, v_app, 'intro-book', 1, '1', '일', '{"fixture": true}'::jsonb, false, 100, timestamptz '2026-10-04 22:00+09', timestamptz '2026-10-04 22:00+09');
    INSERT INTO public.tr_deadline_extensions (id, user_id, enrollment_id, original_date, extra_days, reason, created_at)
    VALUES ('fx-reset-a-' || v_uid::text, v_uid::text, v_app, '2026-10-07', 2, '[픽스처] 연장', timestamptz '2026-10-07 10:00+09');
    INSERT INTO public.tr_weekly_check_drafts (user_id, student_name, week, title, message, auth_rate, status, program_type, created_at)
    VALUES (v_uid, '리셋테스트A', 1, '[픽스처] 1주차', '픽스처 초안', 60, 'pending', 'fast', timestamptz '2026-10-11 06:00+09');
    -- 첨삭: 일정표 + 1~3회차 제출(라이팅·스피킹 각 1줄, 2차 피드백 받음) + 회차 알림 기록 1~3
    INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, kakaotalk_d1_sent, start_notice_sent_for) VALUES (v_uid, '2026-10-18', 4, true, '2026-10-18');
    FOR r IN SELECT n FROM generate_series(1, 3) n LOOP
        INSERT INTO public.correction_submissions (user_id, session_number, task_type, task_number, status, released_1, released_2, draft_1_submitted_at, draft_2_submitted_at, created_at, draft_1_text)
        VALUES (v_uid, r.n, 'writing_email', 1, 'feedback2_ready', true, true, timestamptz '2026-10-18 20:00+09' + (r.n - 1) * interval '2 days', timestamptz '2026-10-19 20:00+09' + (r.n - 1) * interval '2 days', timestamptz '2026-10-18 20:00+09' + (r.n - 1) * interval '2 days', '[픽스처] 라이팅'),
               (v_uid, r.n, 'speaking_interview', 1, 'feedback2_ready', true, true, timestamptz '2026-10-18 20:05+09' + (r.n - 1) * interval '2 days', timestamptz '2026-10-19 20:05+09' + (r.n - 1) * interval '2 days', timestamptz '2026-10-18 20:05+09' + (r.n - 1) * interval '2 days', NULL);
        INSERT INTO public.correction_session_reminders (user_id, session_number, sent_at) VALUES (v_uid, r.n, timestamptz '2026-10-18 09:00+09' + (r.n - 1) * interval '2 days');
    END LOOP;
    RAISE NOTICE '[리셋 픽스처] A 회원 % 신청서 %', v_uid, v_app;

    -- ---------- B ----------
    v_uid := gen_random_uuid(); v_app := gen_random_uuid();
    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'reset.b@eontoefl.local', 'reset-test-9999', '리셋테스트B', '리셋테스트B', '010-0000-9902', 'student', v_ms, v_ms, false, 1, 'Asia/Seoul', false, 'general');
    INSERT INTO public.applications (
        id, user_id, email, name, phone, program, application_type, created_at, submitted_date, status, current_step,
        analysis_status, analysis_content, assigned_program, course_track, schedule_start, schedule_end, self_paced,
        deposit_confirmed_by_admin, deposit_confirmed_by_admin_at, correction_enabled, correction_start_date,
        program_price, discount_amount, correction_fee, additional_discount, final_price,
        practice_enabled, deleted, service_stops, challenge_pauses, correction_pauses,
        analysis_saved_at, analysis_first_saved_at, student_agreed_at, contract_sent_at, contract_agreed_at,
        address, bank_name, account_number, account_holder, preferred_program, preferred_correction,
        book_access_enabled, is_incentive_applicant, enrollment_no,
        contract_sent, contract_agreed, guide_sent, guide_sent_at, shipping_completed, shipping_completed_at, challenge_access_granted, start_notice_sent_for)
    VALUES (
        v_app, v_uid::text, 'reset.b@eontoefl.local', '리셋테스트B', '010-0000-9902', '내벨업챌린지', 'challenge', v_ms, '2026-09-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(B)', '내벨업챌린지 - Standard', 'regular', '2026-09-06', '2026-10-31', false,
        true, v_ms + 3 * 86400000, true, '2026-09-20',
        1000000, 210000, 200000, 0, 1090000,
        false, false, '[]'::jsonb, '[]'::jsonb,
        -- 첨삭 정지 열림: 10-11부터 10-25 재개(14일 밀림) — 리셋 뒤에도 그대로 남아야 함
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'status', 'open', 'paused_from', '2026-10-11', 'resume_on', '2026-10-25', 'shift_days', 14, 'created_at', '2026-10-10T09:00:00+09:00', 'created_by', '픽스처', 'note', '픽스처 첨삭 정지', 'shift_applied_at', '2026-10-10T09:00:00+09:00')),
        v_ms + 3600000, v_ms + 3600000, '2026-09-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        '서울특별시 테스트구 테스트로 2', '국민은행', '000000000002', '리셋테스트B', '내벨업챌린지', '신청함',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true, '2026-09-06');
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, error_note_submitted, locked_auth_rate, completed_at, created_at) VALUES
        (v_uid::text, v_app, 'reading', 1, '1', '일', '{"fixture": true, "score": 7, "total": 10}'::jsonb, true, 100, timestamptz '2026-09-06 21:00+09', timestamptz '2026-09-06 21:00+09'),
        (v_uid::text, v_app, 'reading', 2, '2', '일', '{"fixture": true, "score": 7, "total": 10}'::jsonb, true, 100, timestamptz '2026-09-13 21:00+09', timestamptz '2026-09-13 21:00+09');
    INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, kakaotalk_d1_sent, start_notice_sent_for) VALUES (v_uid, '2026-09-20', 4, true, '2026-09-20');
    FOR r IN SELECT n FROM generate_series(1, 7) n LOOP
        INSERT INTO public.correction_submissions (user_id, session_number, task_type, task_number, status, released_1, released_2, draft_1_submitted_at, draft_2_submitted_at, created_at, draft_1_text)
        VALUES (v_uid, r.n, 'writing_email', 1, 'feedback2_ready', true, true, timestamptz '2026-09-20 20:00+09' + (r.n - 1) * interval '2 days', timestamptz '2026-09-21 20:00+09' + (r.n - 1) * interval '2 days', timestamptz '2026-09-20 20:00+09' + (r.n - 1) * interval '2 days', '[픽스처] 라이팅');
        INSERT INTO public.correction_session_reminders (user_id, session_number, sent_at) VALUES (v_uid, r.n, timestamptz '2026-09-20 09:00+09' + (r.n - 1) * interval '2 days');
    END LOOP;
    RAISE NOTICE '[리셋 픽스처] B 회원 % 신청서 %', v_uid, v_app;

    -- ---------- C (자기주도 + 첨삭 자기주도) ----------
    v_uid := gen_random_uuid(); v_app := gen_random_uuid();
    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'reset.c@eontoefl.local', 'reset-test-9999', '리셋테스트C', '리셋테스트C', '010-0000-9903', 'student', v_ms, v_ms, false, 1, 'Asia/Seoul', false, 'general');
    INSERT INTO public.applications (
        id, user_id, email, name, phone, program, application_type, created_at, submitted_date, status, current_step,
        analysis_status, analysis_content, assigned_program, course_track, schedule_start, schedule_end, self_paced, self_paced_end_date,
        deposit_confirmed_by_admin, deposit_confirmed_by_admin_at, correction_enabled, correction_start_date, correction_end_date,
        program_price, discount_amount, correction_fee, additional_discount, final_price,
        practice_enabled, deleted, service_stops, challenge_pauses, correction_pauses,
        analysis_saved_at, analysis_first_saved_at, student_agreed_at, contract_sent_at, contract_agreed_at,
        address, bank_name, account_number, account_holder, preferred_program, preferred_correction,
        book_access_enabled, is_incentive_applicant, enrollment_no,
        contract_sent, contract_agreed, guide_sent, guide_sent_at, shipping_completed, shipping_completed_at, challenge_access_granted, start_notice_sent_for)
    VALUES (
        v_app, v_uid::text, 'reset.c@eontoefl.local', '리셋테스트C', '010-0000-9903', '내벨업챌린지', 'challenge', v_ms, '2026-09-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(C)', '내벨업챌린지 - Fast', 'regular', '2026-10-08', '', true, '2026-11-13',
        true, v_ms + 3 * 86400000, true, '2026-10-08', '2026-11-13',
        1000000, 210000, 200000, 0, 1090000,
        false, false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        v_ms + 3600000, v_ms + 3600000, '2026-09-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        '서울특별시 테스트구 테스트로 3', '국민은행', '000000000003', '리셋테스트C', '내벨업챌린지', '신청함',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true, '2026-10-08');
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, error_note_submitted, locked_auth_rate, completed_at, created_at) VALUES
        (v_uid::text, v_app, 'reading', 1, '1', '일', '{"fixture": true, "score": 7, "total": 10}'::jsonb, true, 100, timestamptz '2026-10-08 21:00+09', timestamptz '2026-10-08 21:00+09');
    INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, end_date, kakaotalk_d1_sent, start_notice_sent_for) VALUES (v_uid, '2026-10-08', 4, '2026-11-13', true, '2026-10-08');
    RAISE NOTICE '[리셋 픽스처] C 회원 % 신청서 %', v_uid, v_app;

    -- ---------- D (호주) ----------
    v_uid := gen_random_uuid(); v_app := gen_random_uuid();
    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'reset.d@eontoefl.local', 'reset-test-9999', '리셋테스트D', '리셋테스트D', '010-0000-9904', 'student', v_ms, v_ms, false, 1, 'Australia/Sydney', false, 'australia');
    INSERT INTO public.applications (
        id, user_id, email, name, phone, program, application_type, created_at, submitted_date, status, current_step,
        analysis_status, analysis_content, assigned_program, course_track, schedule_start, schedule_end, self_paced,
        deposit_confirmed_by_admin, deposit_confirmed_by_admin_at, correction_enabled,
        program_price, discount_amount, correction_fee, additional_discount, final_price,
        practice_enabled, deleted, service_stops, challenge_pauses, correction_pauses,
        analysis_saved_at, analysis_first_saved_at, student_agreed_at, contract_sent_at, contract_agreed_at,
        address, bank_name, account_number, account_holder, preferred_program, preferred_correction,
        book_access_enabled, is_incentive_applicant, enrollment_no,
        contract_sent, contract_agreed, guide_sent, guide_sent_at, shipping_completed, shipping_completed_at, challenge_access_granted, start_notice_sent_for)
    VALUES (
        v_app, v_uid::text, 'reset.d@eontoefl.local', '리셋테스트D', '010-0000-9904', '내벨업챌린지', 'challenge', v_ms, '2026-09-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(D)', '내벨업챌린지 Australia - Standard', 'australia', '2026-09-27', '2026-11-21', false,
        true, v_ms + 3 * 86400000, false,
        1000000, 210000, 0, 0, 890000,
        false, false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        v_ms + 3600000, v_ms + 3600000, '2026-09-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        'Sydney NSW 2000', '국민은행', '000000000004', '리셋테스트D', '내벨업챌린지', '미신청',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true, '2026-09-27');
    INSERT INTO public.aus_study_results (user_id, enrollment_id, section_type, module_number, week, day, initial_record, locked_auth_rate, completed_at, created_at) VALUES
        (v_uid::text, v_app, 'reading', 1, '1', '일', '{"fixture": true, "score": 7, "total": 10}'::jsonb, 100, timestamptz '2026-09-27 21:00+09', timestamptz '2026-09-27 21:00+09'),
        (v_uid::text, v_app, 'listening', 1, '1', '월', '{"fixture": true, "score": 6, "total": 10}'::jsonb, 50, timestamptz '2026-09-28 21:00+09', timestamptz '2026-09-28 21:00+09');
    RAISE NOTICE '[리셋 픽스처] D 회원 % 신청서 %', v_uid, v_app;
END $fx$;

COMMIT;

-- =====================================================================
-- CLEANUP (검증 끝난 뒤) — 네 학생의 흔적 전부 삭제(보관 표 포함)
-- BEGIN;
-- DELETE FROM public.study_results_v3 WHERE user_id IN (SELECT id::text FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.aus_study_results WHERE user_id IN (SELECT id::text FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.tr_deadline_extensions WHERE user_id IN (SELECT id::text FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.tr_weekly_check_drafts WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_submissions_archive WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_deadline_extensions_archive WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_extension_requests_archive WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_session_reminders_archive WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_schedules_archive WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_submissions WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_session_reminders WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.correction_schedules WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.kakaotalk_logs WHERE application_id IN (SELECT id FROM public.applications WHERE email LIKE 'reset.%@eontoefl.local');
-- DELETE FROM public.applications WHERE email LIKE 'reset.%@eontoefl.local';
-- DELETE FROM public.tr_user_map WHERE email LIKE 'reset.%@eontoefl.local';
-- DELETE FROM public.users WHERE email LIKE 'reset.%@eontoefl.local';
-- COMMIT;
-- =====================================================================
