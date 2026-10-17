-- =====================================================================
-- 리셋 v3 드라이런 (2026-10-18) — 픽스처 A~F에 리셋·되돌리기를 걸어 검사하고 전부 ROLLBACK
--   선행: 20261018_reset_2_mode.sql + reset_fixture.sql(A~D) + reset_fixture_v3.sql(E·F)
--   실행: SQL Editor 전체 실행. 마지막 ROLLBACK. Messages 탭의 NOTICE/ASSERT 확인.
-- =====================================================================
BEGIN;

DO $t$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_sun   date;
    a record; r jsonb; u jsonb; cnt int; cs record; ap record; v_price int;
BEGIN
    v_sun := v_today + ((7 - extract(dow FROM v_today)::int) % 7) + 7;
    RAISE NOTICE '[v3 드라이런] 오늘 % · 새 시작일(일요일) %', v_today, v_sun;

    -- ===== A: Fast → Standard(p_mode), 첨삭 3회(처음부터), 정지 열림, 초안 pending, 연습코스 켬 → 완전 되돌리기 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.a@eontoefl.local';
    v_price := a.final_price;
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun, '사유', v_sun, NULL, NULL, false, '테스트', 'weird'); RAISE EXCEPTION 'A0 실패: 잘못된 mode 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A0%' THEN RAISE; END IF; RAISE NOTICE 'A0 OK mode 검사: %', SQLERRM; END;
    -- 8인자 위치 호출(기본값 p_mode) → Fast 유지로 통과해야 함 → 바로 되돌림
    r := public.enrollment_reset(a.id, v_sun, '[v3] A 8인자', v_sun, NULL, NULL, false, '테스트');
    ASSERT (r->>'mode') = 'fast', 'A 8인자 기본 mode=fast';
    u := public.enrollment_reset_undo(a.id, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.schedule_start = '2026-10-04' AND ap.schedule_end = '2026-10-31', 'A 되돌리기: 일정 복원';
    -- 본 시나리오: Standard로
    r := public.enrollment_reset(a.id, v_sun, '[v3] A Fast→Standard', v_sun, NULL, NULL, true, '테스트', 'standard');
    RAISE NOTICE 'A 리셋: %', r;
    ASSERT (r->>'mode') = 'standard' AND (r->>'corr_action') = 'restart', 'A mode/corr';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.assigned_program = '내벨업챌린지 - Standard' AND ap.self_paced IS FALSE AND ap.schedule_end = to_char(v_sun + 55, 'YYYY-MM-DD'), 'A Standard 8주';
    ASSERT ap.final_price = v_price, 'A 가격 불변';
    ASSERT (ap.reset_history->-1->>'mode') = 'standard' AND jsonb_array_length(ap.reset_history->-1->'dismissed_drafts') = 1, 'A 이력 mode·초안';
    -- 되돌리기(완전): 일정·과정·정지·연습코스·초안·첨삭
    u := public.enrollment_reset_undo(a.id, '테스트');
    RAISE NOTICE 'A 되돌리기: %', u;
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.schedule_start = '2026-10-04' AND ap.schedule_end = '2026-10-31' AND ap.assigned_program = '내벨업챌린지 - Fast', 'A 일정·과정 복원';
    ASSERT (SELECT count(*) FROM jsonb_array_elements(ap.challenge_pauses) e WHERE e->>'status' = 'open') = 1, 'A 정지 open 복원';
    ASSERT ap.practice_enabled IS FALSE AND ap.practice_alimtalk_sent IS NOT TRUE, 'A 연습코스 복원';
    ASSERT ap.correction_start_date = '2026-10-18', 'A 첨삭 시작일 복원';
    SELECT * INTO cs FROM public.correction_schedules WHERE user_id = a.user_id::uuid; ASSERT cs.start_date = '2026-10-18', 'A 일정표 복원';
    SELECT count(*) INTO cnt FROM public.tr_weekly_check_drafts WHERE user_id = a.user_id::uuid AND status = 'pending'; ASSERT cnt = 1, 'A 초안 pending 복원';
    SELECT count(*) INTO cnt FROM public.study_results_v3 WHERE user_id = a.user_id AND enrollment_id = a.id; ASSERT cnt = 5, 'A 기록 복원';
    ASSERT (u->'restored'->>'weekly_drafts')::int = 1, 'A 복원 카운트';

    -- ===== A2: 거부 — 리셋 뒤 정지 추가 / 첨삭 off 변경 / 리셋 뒤 초안은 숨김 =====
    r := public.enrollment_reset(a.id, v_sun, '[v3] A2', v_sun, NULL, NULL, false, '테스트', 'fast');
    UPDATE public.applications SET challenge_pauses = challenge_pauses || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'status', 'open', 'paused_from', to_char(v_sun + 7, 'YYYY-MM-DD'), 'resume_on', NULL, 'created_at', now() + interval '1 second', 'created_by', '테스트', 'note', '리셋 뒤 정지')) WHERE id = a.id;
    BEGIN PERFORM public.enrollment_reset_undo(a.id, '테스트'); RAISE EXCEPTION 'A2-1 실패: 리셋 뒤 정지 있는데 되돌리기 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A2-1%' THEN RAISE; END IF; RAISE NOTICE 'A2-1 OK: %', SQLERRM; END;
    UPDATE public.applications SET challenge_pauses = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(challenge_pauses) e WHERE e->>'note' <> '리셋 뒤 정지') WHERE id = a.id;
    UPDATE public.applications SET correction_enabled = false WHERE id = a.id;
    BEGIN PERFORM public.enrollment_reset_undo(a.id, '테스트'); RAISE EXCEPTION 'A2-2 실패: 첨삭 off 변경인데 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'A2-2%' THEN RAISE; END IF; RAISE NOTICE 'A2-2 OK: %', SQLERRM; END;
    UPDATE public.applications SET correction_enabled = true WHERE id = a.id;
    INSERT INTO public.tr_weekly_check_drafts (user_id, student_name, week, title, message, auth_rate, status, program_type, created_at) VALUES (a.user_id::uuid, '리셋테스트A', 1, '[v3] 리셋 뒤 초안', 'x', 0, 'skipped', 'fast', now() + interval '2 seconds');
    u := public.enrollment_reset_undo(a.id, '테스트');
    ASSERT (u->'restored'->>'late_drafts_dismissed')::int = 1, 'A2 리셋 뒤 초안 숨김';
    SELECT count(*) INTO cnt FROM public.tr_weekly_check_drafts WHERE user_id = a.user_id::uuid AND status = 'pending'; ASSERT cnt = 1, 'A2 옛 초안 복원';

    -- ===== A3: v2 형식 이력(추가 키 없음) 되돌리기 — 현재 값 유지로 동작해야 함 =====
    r := public.enrollment_reset(a.id, v_sun, '[v3] A3', v_sun, NULL, NULL, true, '테스트', 'fast');
    UPDATE public.applications SET reset_history = jsonb_set(reset_history, ARRAY[(jsonb_array_length(reset_history) - 1)::text, 'prev'],
        (reset_history->-1->'prev') - 'course_track' - 'correction_enabled' - 'practice_alimtalk_sent' - 'practice_alimtalk_sent_at' - 'practice_enabled_at') WHERE id = a.id;
    UPDATE public.applications SET reset_history = jsonb_set(reset_history, ARRAY[(jsonb_array_length(reset_history) - 1)::text], (reset_history->-1) - 'dismissed_drafts') WHERE id = a.id;
    u := public.enrollment_reset_undo(a.id, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.course_track = 'regular' AND ap.practice_alimtalk_sent IS TRUE AND ap.practice_enabled IS FALSE, 'A3 v2 이력: 없는 키는 현재 값 유지(알림 플래그 true 유지, 연습코스는 prev false)';
    ASSERT ap.schedule_start = '2026-10-04', 'A3 일정 복원';
    SELECT count(*) INTO cnt FROM public.tr_weekly_check_drafts WHERE user_id = a.user_id::uuid AND status = 'dismissed'; ASSERT cnt >= 1, 'A3 초안은 dismissed_drafts 없어 그대로';
    UPDATE public.tr_weekly_check_drafts SET status = 'pending' WHERE user_id = a.user_id::uuid AND title LIKE '%1주차%';

    -- ===== B: Standard·첨삭 7회(keep)·첨삭 정지 → 자기주도로 전환 → 되돌리기 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.b@eontoefl.local';
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun + 1, 'B', NULL, NULL, NULL, false, '테스트', 'selfpaced'); RAISE EXCEPTION 'B0 실패: 자기주도 종료일 없이 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'B0%' THEN RAISE; END IF; RAISE NOTICE 'B0 OK: %', SQLERRM; END;
    r := public.enrollment_reset(a.id, v_sun + 1, '[v3] B→자기주도', NULL, NULL, v_sun + 30, false, '테스트', 'selfpaced');   -- 월요일 허용
    ASSERT (r->>'mode') = 'selfpaced' AND (r->>'corr_action') = 'keep', 'B mode/keep';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.self_paced IS TRUE AND ap.assigned_program = '내벨업챌린지 - Fast' AND ap.schedule_end = '' AND ap.self_paced_end_date = v_sun + 30 AND ap.self_paced_schedule IS NULL, 'B 자기주도 칸';
    ASSERT (SELECT count(*) FROM jsonb_array_elements(ap.correction_pauses) e WHERE e->>'status' = 'open') = 1 AND ap.correction_start_date = '2026-09-20', 'B 첨삭 정지·날짜 유지';
    u := public.enrollment_reset_undo(a.id, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.self_paced IS FALSE AND ap.assigned_program = '내벨업챌린지 - Standard' AND ap.schedule_end = '2026-10-31' AND ap.self_paced_end_date IS NULL, 'B 되돌리기: Standard 복원';

    -- ===== C: 자기주도 → 자기주도(p_mode NULL) · 첨삭 자기주도 처음부터 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.c@eontoefl.local';
    r := public.enrollment_reset(a.id, v_sun + 1, '[v3] C', v_sun + 1, v_sun + 30, v_sun + 30, false, '테스트');
    ASSERT (r->>'mode') = 'selfpaced', 'C 현행 유지 selfpaced';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.schedule_end = '' AND ap.self_paced_end_date = v_sun + 30 AND ap.correction_end_date = v_sun + 30, 'C 칸';
    SELECT * INTO cs FROM public.correction_schedules WHERE user_id = a.user_id::uuid; ASSERT cs.end_date = v_sun + 30, 'C 일정표 종료일';

    -- ===== E: 자기주도 + 옛 정규 종료일(김관우형) → p_mode NULL이면 '' / Standard 전환 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.e@eontoefl.local';
    r := public.enrollment_reset(a.id, v_sun + 2, '[v3] E 자기주도 유지', NULL, NULL, v_sun + 40, false, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.schedule_end = '' AND ap.self_paced IS TRUE, 'E 옛 정규 종료일 비움(C-1 수정)';
    u := public.enrollment_reset_undo(a.id, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id; ASSERT ap.schedule_end = '2026-10-31', 'E 되돌리기: 옛 값 복원';
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun + 1, 'E', NULL, NULL, NULL, false, '테스트', 'standard'); RAISE EXCEPTION 'E1 실패: Standard 월요일 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'E1%' THEN RAISE; END IF; RAISE NOTICE 'E1 OK: %', SQLERRM; END;
    r := public.enrollment_reset(a.id, v_sun, '[v3] E→Standard', NULL, NULL, NULL, false, '테스트', 'standard');
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.self_paced IS FALSE AND ap.self_paced_end_date IS NULL AND ap.schedule_end = to_char(v_sun + 55, 'YYYY-MM-DD') AND ap.assigned_program = '내벨업챌린지 - Standard', 'E Standard 전환';
    u := public.enrollment_reset_undo(a.id, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.self_paced IS TRUE AND ap.self_paced_end_date = '2026-10-31' AND ap.schedule_end = '2026-10-31', 'E 되돌리기 자기주도 복원';

    -- ===== D: 호주 — p_mode 거부 / NULL 정상 =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.d@eontoefl.local';
    BEGIN PERFORM public.enrollment_reset(a.id, v_sun, 'D', NULL, NULL, NULL, false, '테스트', 'fast'); RAISE EXCEPTION 'D0 실패: 호주 mode 통과';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'D0%' THEN RAISE; END IF; RAISE NOTICE 'D0 OK: %', SQLERRM; END;
    r := public.enrollment_reset(a.id, v_sun, '[v3] D', NULL, NULL, NULL, false, '테스트');
    ASSERT (r->>'mode') = 'australia' AND (r->'hidden'->>'aus_study_results')::int = 2, 'D 호주';
    SELECT * INTO ap FROM public.applications WHERE id = a.id;
    ASSERT ap.australia_schedule_start = v_sun AND ap.schedule_end = to_char(v_sun + 55, 'YYYY-MM-DD'), 'D 호주 Standard 8주';
    u := public.enrollment_reset_undo(a.id, '테스트');
    SELECT * INTO ap FROM public.applications WHERE id = a.id; ASSERT ap.australia_schedule_start IS NULL AND ap.schedule_start = '2026-09-27', 'D 되돌리기';

    -- ===== F: 첨삭 켜짐 + 일정표 줄 없음 → 처음부터(줄 생성) → 되돌리기(줄 삭제) =====
    SELECT * INTO a FROM public.applications WHERE email = 'reset.f@eontoefl.local';
    SELECT count(*) INTO cnt FROM public.correction_schedules WHERE user_id = a.user_id::uuid; ASSERT cnt = 0, 'F 사전: 일정표 없음';
    r := public.enrollment_reset(a.id, v_sun, '[v3] F', v_sun, NULL, NULL, false, '테스트', 'fast');
    ASSERT (r->'corr_archived'->>'schedules')::int = 0, 'F 보관 0';
    SELECT count(*) INTO cnt FROM public.correction_schedules WHERE user_id = a.user_id::uuid; ASSERT cnt = 1, 'F 일정표 생성';
    u := public.enrollment_reset_undo(a.id, '테스트');
    ASSERT (u->'restored'->>'correction_schedule_deleted')::int = 1, 'F 되돌리기: 만든 줄 삭제';
    SELECT count(*) INTO cnt FROM public.correction_schedules WHERE user_id = a.user_id::uuid; ASSERT cnt = 0, 'F 일정표 없음 복원';
    SELECT * INTO ap FROM public.applications WHERE id = a.id; ASSERT ap.correction_start_date = '2026-10-25', 'F 첨삭 시작일 복원';

    RAISE NOTICE '[v3 드라이런] 전부 통과. ROLLBACK 합니다.';
END $t$;

ROLLBACK;
