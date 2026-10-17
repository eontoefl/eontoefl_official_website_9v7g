-- 재시작 3단계 함수 검증(2026-10-17): 라이브 DB에서 BEGIN … RAISE EXCEPTION … ROLLBACK 으로 실행 → 전부 취소됨. 결과: B1 has_rows=true sessions=3 / B2 sub=3 sch=1 / B3 has_rows=false / B4 has_rows=false busy=0 / B5 sub=0 sch=0 수강 2 제출물 1 유지 / B6 기준 없이 has_rows=true / A1·A2 has_rows=false / E1 없는 id 오류
BEGIN;

DROP FUNCTION IF EXISTS public.restart_correction_summary(uuid);
DROP FUNCTION IF EXISTS public.restart_correction_archive(uuid, uuid, text);

-- 기준 시각: 수강 2 신청서 제출 시각. p_app_id 가 NULL 이면 NULL(=기준 없음, 전부 수강 1 기록으로 봄).
CREATE OR REPLACE FUNCTION public.restart_correction_cutoff(p_app_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE v_ms bigint;
BEGIN
    IF p_app_id IS NULL THEN RETURN NULL; END IF;
    SELECT a.created_at INTO v_ms FROM public.applications a WHERE a.id = p_app_id;
    IF v_ms IS NULL THEN RAISE EXCEPTION '수강 2 신청서(%)를 찾지 못했습니다.', p_app_id; END IF;
    RETURN to_timestamp(v_ms / 1000.0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.restart_correction_cutoff(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restart_correction_summary(p_user_id uuid, p_app_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE v_cut timestamptz := public.restart_correction_cutoff(p_app_id);
BEGIN
    RETURN jsonb_build_object(
        'cutoff', v_cut,
        'sessions_1_12', (SELECT count(DISTINCT session_number) FROM public.correction_submissions
                           WHERE user_id = p_user_id AND session_number BETWEEN 1 AND 12 AND draft_1_submitted_at IS NOT NULL
                             AND (v_cut IS NULL OR created_at < v_cut)),
        'sessions_13_24', (SELECT count(DISTINCT session_number) FROM public.correction_submissions
                           WHERE user_id = p_user_id AND session_number BETWEEN 13 AND 24 AND draft_1_submitted_at IS NOT NULL
                             AND (v_cut IS NULL OR created_at < v_cut)),
        'busy', (SELECT count(*) FROM public.correction_submissions
                  WHERE user_id = p_user_id AND status IN ('draft1_submitted','feedback1_processing','draft2_submitted','feedback2_processing')
                    AND (v_cut IS NULL OR created_at < v_cut)),
        'has_rows', EXISTS (SELECT 1 FROM public.correction_submissions WHERE user_id = p_user_id AND (v_cut IS NULL OR created_at < v_cut))
                 OR EXISTS (SELECT 1 FROM public.correction_schedules c WHERE c.user_id = p_user_id
                             AND (v_cut IS NULL OR c.start_date < v_cut::date)),
        'archived_batches', (SELECT count(DISTINCT archive_batch) FROM public.correction_submissions_archive WHERE user_id = p_user_id)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.restart_correction_archive(p_user_id uuid, p_from_app uuid, p_by text DEFAULT NULL, p_app_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch uuid := gen_random_uuid();
    v_cut   timestamptz := public.restart_correction_cutoff(p_app_id);
    v_busy  int;
    n_sub int := 0; n_ext int := 0; n_req int := 0; n_rem int := 0; n_sch int := 0;
BEGIN
    IF p_user_id IS NULL THEN RAISE EXCEPTION '회원 id가 없습니다.'; END IF;
    IF p_from_app IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.applications a WHERE a.id = p_from_app AND a.user_id = p_user_id::text) THEN
        RAISE EXCEPTION '수강 1 신청서가 이 회원의 것이 아닙니다.';
    END IF;
    SELECT count(*) INTO v_busy FROM public.correction_submissions s
     WHERE s.user_id = p_user_id
       AND s.status IN ('draft1_submitted', 'feedback1_processing', 'draft2_submitted', 'feedback2_processing')
       AND (v_cut IS NULL OR s.created_at < v_cut);
    IF v_busy > 0 THEN
        RAISE EXCEPTION '첨삭 피드백이 처리 중인 제출 %건이 있습니다. 끝난 뒤 다시 하세요.', v_busy;
    END IF;

    -- 제출물·연장·연장 요청·회차 알림: 기준 시각보다 먼저 생긴 줄만 보관함으로
    INSERT INTO public.correction_submissions_archive
        SELECT s.*, now(), p_from_app, p_by, v_batch FROM public.correction_submissions s
         WHERE s.user_id = p_user_id AND (v_cut IS NULL OR s.created_at < v_cut);
    GET DIAGNOSTICS n_sub = ROW_COUNT;
    DELETE FROM public.correction_submissions WHERE user_id = p_user_id AND (v_cut IS NULL OR created_at < v_cut);

    INSERT INTO public.correction_deadline_extensions_archive
        SELECT e.*, now(), p_from_app, p_by, v_batch FROM public.correction_deadline_extensions e
         WHERE e.user_id = p_user_id AND (v_cut IS NULL OR e.created_at < v_cut);
    GET DIAGNOSTICS n_ext = ROW_COUNT;
    DELETE FROM public.correction_deadline_extensions WHERE user_id = p_user_id AND (v_cut IS NULL OR created_at < v_cut);

    INSERT INTO public.correction_extension_requests_archive
        SELECT q.*, now(), p_from_app, p_by, v_batch FROM public.correction_extension_requests q
         WHERE q.user_id = p_user_id AND (v_cut IS NULL OR q.created_at < v_cut);
    GET DIAGNOSTICS n_req = ROW_COUNT;
    DELETE FROM public.correction_extension_requests WHERE user_id = p_user_id AND (v_cut IS NULL OR created_at < v_cut);

    INSERT INTO public.correction_session_reminders_archive
        SELECT r.*, now(), p_from_app, p_by, v_batch FROM public.correction_session_reminders r
         WHERE r.user_id = p_user_id AND (v_cut IS NULL OR r.sent_at < v_cut);
    GET DIAGNOSTICS n_rem = ROW_COUNT;
    DELETE FROM public.correction_session_reminders WHERE user_id = p_user_id AND (v_cut IS NULL OR sent_at < v_cut);

    -- 일정표(회원당 한 줄 재사용): 시작일이 기준일보다 앞일 때만 = 수강 1 일정표. 복사본을 남기고 연장·날짜표·알림 플래그 초기화(시작일은 관리창 저장이 새로 넣는다)
    INSERT INTO public.correction_schedules_archive
        SELECT c.*, now(), p_from_app, p_by, v_batch FROM public.correction_schedules c
         WHERE c.user_id = p_user_id AND (v_cut IS NULL OR c.start_date < v_cut::date);
    GET DIAGNOSTICS n_sch = ROW_COUNT;
    UPDATE public.correction_schedules
       SET extension_enabled = false, extension_start_date = NULL, extension_end_date = NULL, extension_session_dates = NULL,
           session_dates = NULL, end_date = NULL,
           kakaotalk_d1_sent = false, kakaotalk_d1_sent_at = NULL,
           extension_notify_sent = false, extension_notify_sent_at = NULL,
           start_notice_sent_for = NULL
     WHERE user_id = p_user_id AND (v_cut IS NULL OR start_date < v_cut::date);

    RETURN jsonb_build_object('batch', v_batch, 'cutoff', v_cut, 'submissions', n_sub, 'deadline_extensions', n_ext,
                              'extension_requests', n_req, 'session_reminders', n_rem, 'schedules', n_sch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.restart_correction_summary(uuid, uuid)             TO anon, authenticated;   -- 관리자 화면이 anon 키(기존 관행)
GRANT EXECUTE ON FUNCTION public.restart_correction_archive(uuid, uuid, text, uuid)  TO anon, authenticated;


DO $t$
DECLARE
  uid uuid := gen_random_uuid(); app1 uuid := gen_random_uuid(); app2 uuid := gen_random_uuid();
  uid2 uuid := gen_random_uuid(); app3 uuid := gen_random_uuid(); app4 uuid := gen_random_uuid();
  ms_now bigint := (extract(epoch from now())*1000)::bigint;
  s jsonb; r jsonb; out text := '';
  n int;
BEGIN
  -- 수강 1(200일 전) / 수강 2(1시간 전 제출)
  INSERT INTO public.applications (id, user_id, email, name, phone, program, application_type, created_at, status, current_step, deleted, enrollment_no, correction_enabled, service_stops, challenge_pauses)
  VALUES (app1, uid::text, 'cut.test@eontoefl.local', '컷테스트', '010-0000-9998', '내벨업챌린지', 'challenge', ms_now - 200::bigint*86400000, '개별분석완료', 2, false, 1, true, '[]'::jsonb, '[]'::jsonb),
         (app2, uid::text, 'cut.test@eontoefl.local', '컷테스트', '010-0000-9998', '내벨업챌린지', 'challenge', ms_now - 3600000, '개별분석완료', 2, false, 2, true, '[]'::jsonb, '[]'::jsonb),
         (app3, uid2::text, 'cut2.test@eontoefl.local', '컷테스트2', '010-0000-9997', '내벨업챌린지', 'challenge', ms_now - 200::bigint*86400000, '개별분석완료', 2, false, 1, false, '[]'::jsonb, '[]'::jsonb),
         (app4, uid2::text, 'cut2.test@eontoefl.local', '컷테스트2', '010-0000-9997', '내벨업챌린지', 'challenge', ms_now - 3600000, '개별분석완료', 2, false, 2, true, '[]'::jsonb, '[]'::jsonb);
  UPDATE public.applications SET restart_of = app1 WHERE id = app2;
  UPDATE public.applications SET restart_of = app3 WHERE id = app4;

  -- [B] 수강 1 첨삭 있음: 일정표(150일 전 시작) + 제출 3회(140일 전)
  INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, end_date, created_at) VALUES (uid, (now() - interval '150 days')::date, 4, (now() - interval '122 days')::date, now() - interval '150 days');
  INSERT INTO public.correction_submissions (user_id, session_number, task_type, task_number, status, draft_1_submitted_at, created_at)
  SELECT uid, g, 'writing', 1, 'completed', now() - interval '140 days', now() - interval '140 days' FROM generate_series(1,3) g;

  s := public.restart_correction_summary(uid, app2);
  out := out || format('B1 첫 저장 전 summary: has_rows=%s sessions=%s busy=%s | ', s->>'has_rows', s->>'sessions_1_12', s->>'busy');
  r := public.restart_correction_archive(uid, app1, 'test', app2);
  out := out || format('B2 archive: sub=%s sch=%s | ', r->>'submissions', r->>'schedules');
  -- 수강 2 저장이 하는 일정표 upsert(내일 시작)
  UPDATE public.correction_schedules SET start_date = (now() + interval '1 day')::date, duration_weeks = 4, end_date = (now() + interval '27 days')::date WHERE user_id = uid;
  s := public.restart_correction_summary(uid, app2);
  out := out || format('B3 수정 저장 때 summary: has_rows=%s sessions=%s | ', s->>'has_rows', s->>'sessions_1_12');
  -- 학생이 수강 2 첨삭 1회 제출(피드백 처리 중) 뒤 또 수정 저장
  INSERT INTO public.correction_submissions (user_id, session_number, task_type, task_number, status, draft_1_submitted_at) VALUES (uid, 1, 'writing', 1, 'draft1_submitted', now());
  s := public.restart_correction_summary(uid, app2);
  out := out || format('B4 수강 2 제출 뒤 summary: has_rows=%s sessions=%s busy=%s | ', s->>'has_rows', s->>'sessions_1_12', s->>'busy');
  r := public.restart_correction_archive(uid, app1, 'test', app2);
  SELECT count(*) INTO n FROM public.correction_submissions WHERE user_id = uid;
  out := out || format('B5 archive 다시: sub=%s sch=%s, 수강 2 제출물 남은 수=%s | ', r->>'submissions', r->>'schedules', n);
  -- 옛 방식(기준 없음)으로 부르면: 전부 센다(허용 창 용도)
  s := public.restart_correction_summary(uid);
  out := out || format('B6 기준 없이: has_rows=%s sessions=%s | ', s->>'has_rows', s->>'sessions_1_12');

  -- [A] 수강 1 첨삭 없음(신유진 사례): 첫 저장 → 일정표만 생김 → 수정 저장
  s := public.restart_correction_summary(uid2, app4);
  out := out || format('A1 첫 저장 전: has_rows=%s | ', s->>'has_rows');
  INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, end_date) VALUES (uid2, (now() + interval '1 day')::date, 4, (now() + interval '27 days')::date);
  s := public.restart_correction_summary(uid2, app4);
  out := out || format('A2 수정 저장 때: has_rows=%s | ', s->>'has_rows');

  -- 없는 신청서 id → 오류
  BEGIN
    s := public.restart_correction_summary(uid2, gen_random_uuid());
    out := out || 'E1 없는 id인데 통과(문제) | ';
  EXCEPTION WHEN OTHERS THEN out := out || 'E1 없는 id 오류 OK: ' || SQLERRM || ' | ';
  END;
  RAISE EXCEPTION 'TEST_RESULT %', out;
END $t$;

ROLLBACK;