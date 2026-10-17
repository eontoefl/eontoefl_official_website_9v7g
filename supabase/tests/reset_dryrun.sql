-- =====================================================================
-- 리셋 드라이런 (2026-10-18) — 픽스처 4명에게 리셋·되돌리기를 걸어 결과를 검사하고 전부 ROLLBACK 한다.
--   선행: 20261018_reset_1.sql + reset_fixture.sql 적용(라이브, 가짜 학생 범위)
--   실행: SQL Editor 전체 실행. 마지막이 ROLLBACK 이라 아무것도 남지 않는다. Messages 탭의 NOTICE/ASSERT 확인.
--   날짜는 실행일(KST 오늘) 기준으로 "다음 일요일 + 7"을 새 시작일로 잡는다.
-- =====================================================================
BEGIN;

DO $t$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_sun   date;
    a record; r jsonb; u jsonb; cnt int; cs record; ap record;
BEGIN
    v_sun := v_today + ((7 - extract(dow FROM v_today)::int) % 7) + 7;   -- 다음 일요일 + 7일(≥ 내일 보장)
    RAISE NOTICE '[드라이런] 오늘 % · 새 시작일(일요일) %', v_today, v_sun;

    -- ===== A: 정규 Fast · 첨삭 3회(처음부터) · 정지 열림 · 초안 pending =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.a@eontoefl.local';
    -- 거부 검사
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun + 1, '사유', v_sun, NULL, NULL, false, '테스트'); RAISE EXCEPTION 'A1 실패: 월요일 시작이 통과됨';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A1%' THEN RAISE; END IF; RAISE NOTICE 'A1 OK 일요일 검사: %', SQLERRM; END;
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun, '', v_sun, NULL, NULL, false, '테스트'); RAISE EXCEPTION 'A2 실패: 빈 사유 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A2%' THEN RAISE; END IF; RAISE NOTICE 'A2 OK 사유 검사: %', SQLERRM; END;
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun, '사유', NULL, NULL, NULL, false, '테스트'); RAISE EXCEPTION 'A3 실패: 첨삭 시작일 없이 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A3%' THEN RAISE; END IF; RAISE NOTICE 'A3 OK 첨삭 시작일 검사: %', SQLERRM; END;
    -- 실행
    r := public.enrollment_reset(a.id, v_sun, '[드라이런] 유학 연기', v_sun, NULL, NULL, true, '테스트');
    RAISE NOTICE 'A 리셋 결과: %', r;
    ASSERT (r->>'corr_action') = 'restart', 'A corr_action';
    ASSERT (r->'hidden'->>'study_results_v3')::int = 5, 'A 숨긴 기록 5';
    ASSERT (r->'hidden'->>'tr_deadline_extensions')::int = 1, 'A 연장 1';
    ASSERT (r->'hidden'->>'weekly_drafts')::int = 1, 'A 초안 1';
    ASSERT (r->'hidden'->>'pauses_canceled')::int = 1, 'A 정지 취소 1';
    ASSERT (r->'corr_archived'->>'submissions')::int = 6, 'A 첨삭 보관 6줄';
    SELECT count(*) INTO cnt FROM public.study_results_v3 WHERE user_id = a.user_id AND enrollment_id = a.id; ASSERT cnt = 0, 'A 테스트룸 기록 0';
    SELECT count(*) INTO cnt FROM public.correction_submissions WHERE user_id = a.user_id::uuid; ASSERT cnt = 0, 'A 첨삭 제출 0';
    SELECT count(*) INTO cnt FROM public.correction_session_reminders WHERE user_id = a.user_id::uuid; ASSERT cnt = 0, 'A 알림 기록 0';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.schedule_start = to_char(v_sun, 'YYYY-MM-DD'), 'A 시작일';
    ASSERT ap.schedule_end = to_char(v_sun + 27, 'YYYY-MM-DD'), 'A 종료일(Fast 4주)';
    ASSERT ap.correction_start_date = to_char(v_sun, 'YYYY-MM-DD'), 'A 첨삭 시작일';
    ASSERT (SELECT count(*) FROM jsonb_array_elements(ap.challenge_pauses) e WHERE e->>'status' = 'canceled') = 1, 'A 정지 canceled';
    ASSERT ap.practice_enabled IS TRUE AND ap.practice_alimtalk_sent IS TRUE AND ap.practice_enabled_source = 'manual', 'A 연습코스';
    ASSERT jsonb_array_length(ap.reset_history) = 1, 'A 이력 1';
    ASSERT public.is_paused(a.id, 'challenge', v_today) IS NOT TRUE, 'A 정지 해제';
    SELECT * INTO cs FROM public.correction_schedules WHERE user_id = a.user_id::uuid;
    ASSERT cs.start_date = v_sun AND cs.end_date IS NULL AND cs.kakaotalk_d1_sent IS NOT TRUE AND cs.start_notice_sent_for IS NULL, 'A 첨삭 일정표';
    SELECT status INTO cs FROM public.tr_weekly_check_drafts WHERE user_id = a.user_id::uuid; ASSERT cs.status = 'dismissed', 'A 초안 숨김';
    -- 되돌리기
    u := public.enrollment_reset_undo(a.id, '테스트');
    RAISE NOTICE 'A 되돌리기: %', u;
    SELECT count(*) INTO cnt FROM public.study_results_v3 WHERE user_id = a.user_id AND enrollment_id = a.id; ASSERT cnt = 5, 'A 복원 5';
    SELECT count(*) INTO cnt FROM public.correction_submissions WHERE user_id = a.user_id::uuid; ASSERT cnt = 6, 'A 첨삭 복원 6';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.correction_start_date = '2026-10-18', 'A 첨삭 시작일 복원';
    ASSERT ap.schedule_start = to_char(v_sun, 'YYYY-MM-DD'), 'A 챌린지 일정은 복원 안 함';
    SELECT * INTO cs FROM public.correction_schedules WHERE user_id = a.user_id::uuid; ASSERT cs.start_date = '2026-10-18', 'A 일정표 복원';
    ASSERT (ap.reset_history->0->>'undone_at') IS NOT NULL, 'A undone';
    BEGIN PERFORM public.enrollment_reset_undo(a.id, '테스트'); RAISE EXCEPTION 'A4 실패: 두 번째 되돌리기 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A4%' THEN RAISE; END IF; RAISE NOTICE 'A4 OK 되돌릴 것 없음: %', SQLERRM; END;

    -- ===== B: 첨삭 7회(그대로) · 첨삭 정지 유지 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.b@eontoefl.local';
    r := public.enrollment_reset(a.id, v_sun, '[드라이런] B', NULL, NULL, NULL, false, '테스트');
    RAISE NOTICE 'B 리셋 결과: %', r;
    ASSERT (r->>'corr_action') = 'keep' AND (r->>'corr_sessions_used')::int = 7, 'B keep';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.schedule_end = to_char(v_sun + 55, 'YYYY-MM-DD'), 'B 종료일(Standard 8주)';
    ASSERT (SELECT count(*) FROM jsonb_array_elements(ap.correction_pauses) e WHERE e->>'status' = 'open') = 1, 'B 첨삭 정지 유지';
    ASSERT ap.correction_start_date = '2026-09-20', 'B 첨삭 날짜 무변경';
    SELECT count(*) INTO cnt FROM public.correction_submissions WHERE user_id = a.user_id::uuid; ASSERT cnt = 7, 'B 첨삭 제출 유지';
    u := public.enrollment_reset_undo(a.id, '테스트');
    ASSERT (u->'restored'->>'study_results_v3')::int = 2, 'B 복원 2';

    -- ===== C: 자기주도 + 첨삭 자기주도(종료일) 0회(처음부터) =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.c@eontoefl.local';
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun + 1, 'C', v_sun + 1, NULL, v_sun + 30, false, '테스트'); RAISE EXCEPTION 'C1 실패: 첨삭 종료일 없이 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'C1%' THEN RAISE; END IF; RAISE NOTICE 'C1 OK: %', SQLERRM; END;
    r := public.enrollment_reset(a.id, v_sun + 1, '[드라이런] C', v_sun + 1, v_sun + 30, v_sun + 30, false, '테스트');   -- 자기주도는 요일 자유
    RAISE NOTICE 'C 리셋 결과: %', r;
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.self_paced_end_date = v_sun + 30 AND ap.self_paced_schedule IS NULL AND ap.schedule_end = '', 'C 자기주도 일정';
    ASSERT ap.correction_end_date = v_sun + 30, 'C 첨삭 종료일';
    SELECT * INTO cs FROM public.correction_schedules WHERE user_id = a.user_id::uuid;
    ASSERT cs.start_date = v_sun + 1 AND cs.end_date = v_sun + 30, 'C 일정표 종료일 유지(NULL 아님)';

    -- ===== D: 호주 Standard · 연습코스 체크 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.d@eontoefl.local';
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun + 1, 'D', NULL, NULL, NULL, false, '테스트'); RAISE EXCEPTION 'D1 실패: 호주 비일요일 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'D1%' THEN RAISE; END IF; RAISE NOTICE 'D1 OK: %', SQLERRM; END;
    r := public.enrollment_reset(a.id, v_sun, '[드라이런] D', NULL, NULL, NULL, true, '테스트');
    ASSERT (r->'hidden'->>'aus_study_results')::int = 2, 'D 호주 기록 2';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.australia_schedule_start = v_sun, 'D 호주 시작일';
    ASSERT ap.practice_enabled IS TRUE, 'D 연습코스';
    u := public.enrollment_reset_undo(a.id, '테스트');
    ASSERT (u->'restored'->>'aus_study_results')::int = 2, 'D 복원';

    -- ===== 되돌리기 거부: 새 기록이 생긴 뒤 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.b@eontoefl.local';
    r := public.enrollment_reset(a.id, v_sun, '[드라이런] B2', NULL, NULL, NULL, false, '테스트');
    INSERT INTO public.study_results_v3 (user_id, enrollment_id, section_type, module_number, week, day, initial_record, completed_at)
    VALUES (a.user_id, a.id, 'reading', 1, '1', '일', '{"fixture": true}'::jsonb, now());
    BEGIN PERFORM public.enrollment_reset_undo(a.id, '테스트'); RAISE EXCEPTION 'E1 실패: 새 기록 있는데 되돌리기 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'E1%' THEN RAISE; END IF; RAISE NOTICE 'E1 OK: %', SQLERRM; END;
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT (SELECT count(*) FROM jsonb_array_elements(ap.reset_history) e WHERE e->>'undone_at' IS NULL) = 1, 'B 리셋 횟수(undone 제외) 1';

    -- ===== 재시작 함수 회귀: 기존 4인자 호출(이름 인자)과 거부 동작 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.a@eontoefl.local';
    UPDATE public.correction_submissions SET status = 'draft1_submitted' WHERE user_id = a.user_id::uuid AND session_number = 3;
    BEGIN PERFORM public.restart_correction_archive(p_user_id => a.user_id::uuid, p_from_app => a.id, p_by => '테스트', p_app_id => NULL); RAISE EXCEPTION 'F1 실패: strict 거부 안 됨';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'F1%' THEN RAISE; END IF; RAISE NOTICE 'F1 OK 재시작 strict 거부: %', SQLERRM; END;
    r := public.restart_correction_archive(a.user_id::uuid, a.id, '테스트', NULL, false);
    ASSERT (r->>'submissions')::int = 6, 'F2 리셋 모드는 제출 대기도 보관';
    UPDATE public.correction_submissions_archive SET status = 'feedback1_processing' WHERE archive_batch = (r->>'batch')::uuid AND session_number = 3;
    PERFORM public.restart_correction_restore((r->>'batch')::uuid);
    BEGIN PERFORM public.restart_correction_archive(a.user_id::uuid, a.id, '테스트', NULL, false); RAISE EXCEPTION 'F3 실패: processing 거부 안 됨';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'F3%' THEN RAISE; END IF; RAISE NOTICE 'F3 OK 생성 중 거부: %', SQLERRM; END;

    RAISE NOTICE '[드라이런] 전부 통과. ROLLBACK 합니다.';
END $t$;

ROLLBACK;
