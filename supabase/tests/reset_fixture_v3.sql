-- =====================================================================
-- 리셋 v3 검증용 가짜 학생 2명 추가 (2026-10-18) — reset_fixture.sql(A~D)과 함께 쓴다
--   선행: 20261018_reset_2_mode.sql
--   reset.e  자기주도(시작 10-06, 자기주도 종료 10-31) + **옛 정규 종료일 schedule_end='2026-10-31' 저장**(라이브 김관우·홍현도형) · 첨삭 없음 · 기록 2줄
--   reset.f  정규 Fast 진행 중 · 첨삭 켜짐(시작 10-25)인데 **첨삭 일정표 줄 없음**(correction_schedules 없음) · 제출 0 · 기록 1줄
--   전화번호는 처음부터 빈 값(알림톡 발송 불가).
-- =====================================================================

BEGIN;

DO $fx$
DECLARE
    v_ms bigint := (extract(epoch from timestamptz '2026-09-20 10:00+09') * 1000)::bigint;
    v_uid uuid; v_app uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM public.users WHERE email IN ('reset.e@eontoefl.local','reset.f@eontoefl.local')) THEN
        RAISE EXCEPTION 'ABORT 테스트 학생 E/F가 이미 있음 — 먼저 CLEANUP 실행';
    END IF;

    -- ---------- E ----------
    v_uid := gen_random_uuid(); v_app := gen_random_uuid();
    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'reset.e@eontoefl.local', 'reset-test-9999', '리셋테스트E', '리셋테스트E', '', 'student', v_ms, v_ms, false, 1, 'Asia/Seoul', false, 'general');
    INSERT INTO public.applications (
        id, user_id, email, name, phone, program, application_type, created_at, submitted_date, status, current_step,
        analysis_status, analysis_content, assigned_program, course_track, schedule_start, schedule_end, self_paced, self_paced_end_date,
        deposit_confirmed_by_admin, deposit_confirmed_by_admin_at, correction_enabled,
        program_price, discount_amount, correction_fee, additional_discount, final_price,
        practice_enabled, deleted, service_stops, challenge_pauses, correction_pauses,
        analysis_saved_at, analysis_first_saved_at, student_agreed_at, contract_sent_at, contract_agreed_at,
        address, bank_name, account_number, account_holder, preferred_program, preferred_correction,
        book_access_enabled, is_incentive_applicant, enrollment_no,
        contract_sent, contract_agreed, guide_sent, guide_sent_at, shipping_completed, shipping_completed_at, challenge_access_granted, start_notice_sent_for)
    VALUES (
        v_app, v_uid::text, 'reset.e@eontoefl.local', '리셋테스트E', '', '내벨업챌린지', 'challenge', v_ms, '2026-09-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(E)', '내벨업챌린지 - Fast', 'regular', '2026-10-06', '2026-10-31', true, '2026-10-31',
        true, v_ms + 3 * 86400000, false,
        1000000, 210000, 0, 0, 890000,
        false, false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        v_ms + 3600000, v_ms + 3600000, '2026-09-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        '서울특별시 테스트구 테스트로 5', '국민은행', '000000000005', '리셋테스트E', '내벨업챌린지', '미신청',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true, '2026-10-06');
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, error_note_submitted, locked_auth_rate, completed_at, created_at) VALUES
        (v_uid::text, v_app, 'reading',   1, '1', '화', '{"fixture": true, "score": 6, "total": 10}'::jsonb, true, 100, timestamptz '2026-10-06 21:00+09', timestamptz '2026-10-06 21:00+09'),
        (v_uid::text, v_app, 'listening', 1, '1', '수', '{"fixture": true, "score": 5, "total": 10}'::jsonb, false, 50, timestamptz '2026-10-07 21:00+09', timestamptz '2026-10-07 21:00+09');
    RAISE NOTICE '[리셋 픽스처 v3] E 회원 % 신청서 %', v_uid, v_app;

    -- ---------- F ----------
    v_uid := gen_random_uuid(); v_app := gen_random_uuid();
    INSERT INTO public.users (id, email, password, name, nickname, phone, role, created_at, updated_at, blocked, level, timezone, marketing_consent, intro_book_track)
    VALUES (v_uid, 'reset.f@eontoefl.local', 'reset-test-9999', '리셋테스트F', '리셋테스트F', '', 'student', v_ms, v_ms, false, 1, 'Asia/Seoul', false, 'general');
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
        v_app, v_uid::text, 'reset.f@eontoefl.local', '리셋테스트F', '', '내벨업챌린지', 'challenge', v_ms, '2026-09-20', '계약서발송완료', 5,
        '승인', '[테스트 픽스처] 개별분석 본문(F)', '내벨업챌린지 - Fast', 'regular', '2026-10-11', '2026-11-07', false,
        true, v_ms + 3 * 86400000, true, '2026-10-25',
        1000000, 210000, 200000, 0, 1090000,
        false, false, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        v_ms + 3600000, v_ms + 3600000, '2026-09-21', v_ms + 2 * 86400000, v_ms + 2 * 86400000 + 3600000,
        '서울특별시 테스트구 테스트로 6', '국민은행', '000000000006', '리셋테스트F', '내벨업챌린지', '신청함',
        true, false, 1,
        true, true, true, v_ms + 3 * 86400000 + 3600000, true, v_ms + 4 * 86400000, true, '2026-10-11');
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, error_note_submitted, locked_auth_rate, completed_at, created_at) VALUES
        (v_uid::text, v_app, 'vocab', 1, '1', '일', '{"fixture": true, "score": 20, "total": 30}'::jsonb, false, 100, timestamptz '2026-10-11 21:00+09', timestamptz '2026-10-11 21:00+09');
    -- 첨삭 일정표 줄은 일부러 안 만든다(correction_schedules 없음)
    RAISE NOTICE '[리셋 픽스처 v3] F 회원 % 신청서 %', v_uid, v_app;
END $fx$;

COMMIT;

-- CLEANUP: reset_fixture.sql 의 CLEANUP 블록이 email LIKE 'reset.%@eontoefl.local' 로 E·F까지 함께 지운다.
