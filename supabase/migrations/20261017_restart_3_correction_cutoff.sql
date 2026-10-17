-- =====================================================================
-- 재시작(수강 2) 3단계 — 첨삭 보관 이동 "수강 1 기록" 판정 기준 수정 (2026-10-17, 대표 O)
--
-- 문제: restart_correction_summary / restart_correction_archive 가 "이 회원 이름의 첨삭 기록 전부"를 수강 1 기록으로 봤다.
--       수강 2를 첨삭 포함으로 한 번 저장하면 수강 2용 일정표(correction_schedules 한 줄, user_id당 1줄 재사용)가 생기고,
--       그 뒤 수정 저장마다 "수강 1 첨삭 기록을 보관함으로…" 확인창이 다시 떴다(2026-10-17 신유진님 사례, 0개 제출).
--       학생이 수강 2 첨삭을 제출한 뒤 같은 창에서 [확인]을 누르면 수강 2 제출물이 보관함으로 옮겨져 테스트룸에서 사라진다.
-- 수정: 수강 2 신청서(p_app_id)의 제출 시각(applications.created_at, ms) 을 기준(cutoff)으로,
--       그보다 먼저 생긴 기록만 수강 1 기록으로 본다. 일정표는 한 줄을 재사용하므로 "시작일이 기준일보다 앞이면" 수강 1 일정표.
--       p_app_id 를 안 넘기면(허용 창: 아직 수강 2 없음) 예전처럼 전부 센다.
-- 호출부: js/admin-manage-modal.js _loadRestartCorrSummary / _restartArchiveIfNeeded 가 p_app_id = 수강 2 신청서 id 를 넘긴다.
-- 되돌리기: 아래 ROLLBACK 절.
-- =====================================================================
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

COMMIT;

-- =====================================================================
-- ROLLBACK (되돌리기 — 1단계 SQL의 두 함수 정의로 복귀. 20261016_restart_1_additive.sql 3) 절을 다시 실행한 뒤:)
-- DROP FUNCTION IF EXISTS public.restart_correction_summary(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.restart_correction_archive(uuid, uuid, text, uuid);
-- DROP FUNCTION IF EXISTS public.restart_correction_cutoff(uuid);
-- =====================================================================
