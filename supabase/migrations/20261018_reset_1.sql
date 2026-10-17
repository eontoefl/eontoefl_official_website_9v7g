-- =====================================================================
-- 리셋 1단계 — 서버: 이력 칸 + 리셋/되돌리기 함수 + 첨삭 보관 함수 인자 추가 (2026-10-18)
--   계획: C:\기능구현\리셋\IMPLEMENTATION_PLAN.md 7장(v2) · 6-6/6-7(대조)
--   라이브 원문: C:\기능구현\리셋\라이브함수원문_2026-10-17\
--
-- 리셋 = 같은 신청서 안에서 학습 기록을 "안 보이게"(꼬리표 enrollment_id → 묶음 번호) 하고
--        정지 이력을 취소하고 새 시작일을 넣는다. 수강 2(재시작)·일시정지와 다른 기능.
--   · 첨삭: 1차 제출한 회차(1~12, distinct)가 0~5회면 처음부터(보관함 이동 + 새 첨삭 시작일), 6회 이상이면 그대로.
--   · 되돌리기: 기록 꼬리표 복원 + 첨삭 보관분 복원(처음부터였을 때) + 신청서 첨삭 날짜 복원. 정지 이력·챌린지 일정·연습코스·초안은 복원 안 함.
--   · 처리 순서(트리거 때문에 고정): 정지 취소 → 기록 재태깅 → 초안 숨김 → 첨삭 → 일정(시작 안내 트리거) → 연습코스 → 이력
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션). "Run without RLS".
-- 되돌리기: 맨 아래 ROLLBACK 주석.
-- =====================================================================

BEGIN;

-- ---------- 0) 사전 검사: 2026-10-17 라이브 본문 그대로일 때만 진행 ----------
DO $chk$
DECLARE v text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='applications' AND column_name='reset_history') THEN
    RAISE EXCEPTION 'ABORT applications.reset_history 칸이 이미 있음 — 이미 적용된 파일';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('enrollment_reset','enrollment_reset_undo')) THEN
    RAISE EXCEPTION 'ABORT 리셋 함수가 이미 있음 — 이미 적용된 파일';
  END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='restart_correction_archive';
  IF v IS DISTINCT FROM '60be1479c50f66f2bba39cae8532c411' THEN RAISE EXCEPTION 'ABORT restart_correction_archive 라이브 본문이 2026-10-17 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='restart_correction_restore';
  IF v IS DISTINCT FROM '034255bc2136e6005126367bd82d6e96' THEN RAISE EXCEPTION 'ABORT restart_correction_restore 라이브 본문이 2026-10-17 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stop_at';
  IF v IS DISTINCT FROM 'e22f8675bf5a87c1c6aa4263ec072d2d' THEN RAISE EXCEPTION 'ABORT service_stop_at 라이브 본문이 2026-10-17 확인본과 다름: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_deadline_user_date') THEN
    RAISE EXCEPTION 'ABORT tr_deadline_extensions 고유 제약(uq_deadline_user_date)이 없음 — 라이브 확인 필요';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='restart_correction_archive') <> 1 THEN
    RAISE EXCEPTION 'ABORT restart_correction_archive 가 1개가 아님(오버로드 잔존)';
  END IF;
END $chk$;

-- ---------- 1) 이력 칸 ----------
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS reset_history jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.applications.reset_history IS '리셋 이력(배열). 항목: {id, at, by, reason, batch(숨긴 기록 묶음), corr_action restart|keep|null, corr_sessions_used, corr_batch(첨삭 보관 묶음), corr_archived, practice_opened, new_start, new_end, prev{...}, undone_at, undone_by}. 횟수 = undone_at 없는 항목 수.';

-- ---------- 2) 과제 연장 표 고유 제약: 꼬리표 포함 (재태깅 뒤 같은 날짜 연장을 새 수강에서 다시 넣을 수 있게) ----------
ALTER TABLE public.tr_deadline_extensions DROP CONSTRAINT uq_deadline_user_date;
ALTER TABLE public.tr_deadline_extensions ADD CONSTRAINT uq_deadline_user_date_enrollment UNIQUE (user_id, original_date, enrollment_id);

-- ---------- 3) 첨삭 보관 함수: p_strict 인자 추가 (본문 동일, 거부 범위만 선택) ----------
--   기존 4인자 서명은 지운다(같은 이름 두 벌이면 PostgREST 호출이 모호해짐, PGRST203).
--   관리창 재시작 호출부(이름 인자 p_user_id·p_from_app·p_by·p_app_id)는 기본값 true라 동작 불변.
DROP FUNCTION IF EXISTS public.restart_correction_archive(uuid, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.restart_correction_archive(p_user_id uuid, p_from_app uuid, p_by text DEFAULT NULL::text, p_app_id uuid DEFAULT NULL::uuid, p_strict boolean DEFAULT true)
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
    -- 재시작(p_strict=true): 제출 대기·처리 중 전부 거부(기존 동작). 리셋(p_strict=false): AI 생성 중만 거부.
    IF p_strict THEN
        SELECT count(*) INTO v_busy FROM public.correction_submissions s
         WHERE s.user_id = p_user_id
           AND s.status IN ('draft1_submitted', 'feedback1_processing', 'draft2_submitted', 'feedback2_processing')
           AND (v_cut IS NULL OR s.created_at < v_cut);
        IF v_busy > 0 THEN
            RAISE EXCEPTION '첨삭 피드백이 처리 중인 제출 %건이 있습니다. 끝난 뒤 다시 하세요.', v_busy;
        END IF;
    ELSE
        SELECT count(*) INTO v_busy FROM public.correction_submissions s
         WHERE s.user_id = p_user_id
           AND s.status IN ('feedback1_processing', 'feedback2_processing')
           AND (v_cut IS NULL OR s.created_at < v_cut);
        IF v_busy > 0 THEN
            RAISE EXCEPTION 'AI가 첨삭 피드백을 만드는 중인 제출 %건이 있습니다. 몇 분 뒤 다시 하세요.', v_busy;
        END IF;
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
GRANT EXECUTE ON FUNCTION public.restart_correction_archive(uuid, uuid, text, uuid, boolean) TO anon, authenticated;   -- 관리자 화면이 anon 키(기존 관행)

-- ---------- 4) 리셋 ----------
CREATE OR REPLACE FUNCTION public.enrollment_reset(
    p_app_id        uuid,
    p_new_start     date,
    p_reason        text,
    p_corr_start    date    DEFAULT NULL,
    p_corr_end      date    DEFAULT NULL,
    p_sp_end        date    DEFAULT NULL,
    p_open_practice boolean DEFAULT false,
    p_by            text    DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a            record;
    v_today      date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_batch      uuid := gen_random_uuid();
    v_uid        uuid;
    v_is_sp      boolean;
    v_is_aus     boolean;
    v_weeks      int;
    v_new_end    date;
    v_used       int := NULL;
    v_corr_action text := NULL;
    v_corr_sp    boolean := false;
    v_busy       int;
    v_ext_end    date;
    v_corr       jsonb := NULL;
    v_prev       jsonb;
    v_ch_pauses  jsonb;
    v_co_pauses  jsonb;
    n_v3 int := 0; n_aus int := 0; n_ext int := 0; n_drafts int := 0; n_pauses int := 0;
    v_practice_opened boolean := false;
    v_entry      jsonb;
BEGIN
    -- 1) 잠금 + 자격 검사
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾지 못했습니다.'; END IF;
    IF COALESCE(a.application_type, 'challenge') <> 'challenge' THEN RAISE EXCEPTION '챌린지 신청서만 리셋할 수 있습니다.'; END IF;
    IF a.deposit_confirmed_by_admin IS NOT TRUE THEN RAISE EXCEPTION '입금 확인된 신청서만 리셋할 수 있습니다.'; END IF;
    IF a.deleted IS TRUE THEN RAISE EXCEPTION '삭제된 신청서는 리셋할 수 없습니다.'; END IF;
    IF a.superseded_by IS NOT NULL THEN RAISE EXCEPTION '수강 2로 넘어간 신청서는 리셋할 수 없습니다.'; END IF;
    IF public.service_stop_at(a.id, 'challenge') IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 수강은 리셋할 수 없습니다. 먼저 철회하세요.'; END IF;
    IF a.correction_enabled IS TRUE AND public.service_stop_at(a.id, 'correction') IS NOT NULL THEN RAISE EXCEPTION '첨삭이 환불된 학생은 리셋할 수 없습니다. 먼저 철회하세요.'; END IF;
    IF a.analysis_alimtalk_scheduled_at IS NOT NULL THEN RAISE EXCEPTION '개별분석 예약 발송이 걸려 있습니다. 예약을 먼저 취소하세요.'; END IF;
    IF a.extension_enabled IS TRUE AND a.extension_start_date IS NOT NULL THEN
        v_ext_end := COALESCE(a.extension_end_date, public.pause_adjusted_date(a.id, 'correction', a.extension_start_date + 27));
        IF v_ext_end IS NULL OR v_today <= v_ext_end THEN
            RAISE EXCEPTION '첨삭 연장(13~24회차)이 진행 중이거나 시작 전입니다. 연장이 끝난 뒤 리셋하세요.';
        END IF;
    END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION '리셋 사유를 입력하세요.'; END IF;
    IF a.user_id IS NULL OR a.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION '회원 번호가 없는 신청서는 리셋할 수 없습니다.';
    END IF;
    v_uid    := a.user_id::uuid;
    v_is_sp  := a.self_paced IS TRUE;
    v_is_aus := a.course_track = 'australia' OR COALESCE(a.assigned_program, '') ILIKE '%Australia%';

    -- 새 시작일: 내일 이후 · 자기주도가 아니면(정규·호주) 일요일
    IF p_new_start IS NULL OR p_new_start < v_today + 1 THEN RAISE EXCEPTION '새 시작일은 내일 이후여야 합니다.'; END IF;
    IF NOT v_is_sp AND extract(dow FROM p_new_start) <> 0 THEN RAISE EXCEPTION '정규·호주 과정 시작일은 일요일이어야 합니다.'; END IF;
    IF v_is_sp THEN
        IF p_sp_end IS NULL THEN RAISE EXCEPTION '자기주도는 종료일이 필요합니다.'; END IF;
        IF p_sp_end <= p_new_start THEN RAISE EXCEPTION '자기주도 종료일은 시작일 뒤여야 합니다.'; END IF;
    ELSE
        v_weeks := CASE WHEN COALESCE(a.assigned_program, '') ILIKE '%Standard%' THEN 8 ELSE 4 END;
        v_new_end := p_new_start + v_weeks * 7 - 1;
    END IF;

    -- 2) 첨삭 판정: 1차 제출한 회차 수(1~12, distinct). 0~5 → 처음부터 / 6 이상 → 그대로
    IF a.correction_enabled IS TRUE THEN
        SELECT count(DISTINCT s.session_number) INTO v_used
          FROM public.correction_submissions s
         WHERE s.user_id = v_uid AND s.session_number BETWEEN 1 AND 12 AND s.draft_1_submitted_at IS NOT NULL;
        v_corr_action := CASE WHEN v_used <= 5 THEN 'restart' ELSE 'keep' END;
        IF v_corr_action = 'restart' THEN
            SELECT count(*) INTO v_busy FROM public.correction_submissions s
             WHERE s.user_id = v_uid AND s.status IN ('feedback1_processing', 'feedback2_processing');
            IF v_busy > 0 THEN RAISE EXCEPTION 'AI가 첨삭 피드백을 만드는 중인 제출 %건이 있습니다. 몇 분 뒤 다시 하세요.', v_busy; END IF;
            IF p_corr_start IS NULL THEN RAISE EXCEPTION '첨삭 시작일을 입력하세요.'; END IF;
            IF p_corr_start < v_today + 1 THEN RAISE EXCEPTION '첨삭 시작일은 내일 이후여야 합니다.'; END IF;
            v_corr_sp := a.correction_end_date IS NOT NULL;   -- 첨삭 자기주도(종료일 지정) = 플래그가 아니라 종료일 유무
            IF v_corr_sp THEN
                IF p_corr_end IS NULL THEN RAISE EXCEPTION '첨삭 종료일을 입력하세요(첨삭 자기주도).'; END IF;
                IF p_corr_end < p_corr_start + 12 THEN RAISE EXCEPTION '첨삭 종료일은 시작일 12일 뒤 이후여야 합니다.'; END IF;
            END IF;
        END IF;
    END IF;

    -- 3) 리셋 전 값 스냅샷(되돌리기·이력 표시용)
    v_prev := jsonb_build_object(
        'schedule_start', a.schedule_start, 'schedule_end', a.schedule_end, 'assigned_program', a.assigned_program,
        'self_paced', a.self_paced, 'self_paced_end_date', a.self_paced_end_date, 'self_paced_schedule', a.self_paced_schedule,
        'australia_schedule_start', a.australia_schedule_start,
        'correction_start_date', a.correction_start_date, 'correction_end_date', a.correction_end_date,
        'challenge_pauses', COALESCE(a.challenge_pauses, '[]'::jsonb), 'correction_pauses', COALESCE(a.correction_pauses, '[]'::jsonb),
        'practice_enabled', a.practice_enabled, 'practice_enabled_source', a.practice_enabled_source, 'practice_disabled_manually', a.practice_disabled_manually);

    -- 4) 정지 이력 취소 (시작일 변경보다 먼저 — 시작 안내 트리거가 "정지 중"으로 건너뛰지 않게)
    --    챌린지 정지는 항상, 첨삭 정지는 첨삭을 처음부터 할 때만(그대로 두는 첨삭의 밀어 둔 날짜를 지키려고)
    SELECT COALESCE(jsonb_agg(CASE WHEN e->>'status' <> 'canceled'
                                   THEN e || jsonb_build_object('status', 'canceled', 'canceled_at', now(), 'canceled_by', p_by, 'canceled_by_reset', v_batch)
                                   ELSE e END ORDER BY ord), '[]'::jsonb),
           count(*) FILTER (WHERE e->>'status' <> 'canceled')
      INTO v_ch_pauses, n_pauses
      FROM jsonb_array_elements(COALESCE(a.challenge_pauses, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord);
    IF v_corr_action = 'restart' THEN
        SELECT COALESCE(jsonb_agg(CASE WHEN e->>'status' <> 'canceled'
                                       THEN e || jsonb_build_object('status', 'canceled', 'canceled_at', now(), 'canceled_by', p_by, 'canceled_by_reset', v_batch)
                                       ELSE e END ORDER BY ord), '[]'::jsonb)
          INTO v_co_pauses
          FROM jsonb_array_elements(COALESCE(a.correction_pauses, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord);
        n_pauses := n_pauses + (SELECT count(*) FROM jsonb_array_elements(COALESCE(a.correction_pauses, '[]'::jsonb)) e WHERE e->>'status' <> 'canceled');
    ELSE
        v_co_pauses := COALESCE(a.correction_pauses, '[]'::jsonb);
    END IF;
    UPDATE public.applications SET challenge_pauses = v_ch_pauses, correction_pauses = v_co_pauses WHERE id = a.id;

    -- 5) 학습 기록 재태깅(숨김): 이 수강 꼬리표 → 묶음 번호
    UPDATE public.study_results_v3      SET enrollment_id = v_batch WHERE user_id = a.user_id AND enrollment_id = a.id;
    GET DIAGNOSTICS n_v3 = ROW_COUNT;
    UPDATE public.aus_study_results     SET enrollment_id = v_batch WHERE user_id = a.user_id AND enrollment_id = a.id;
    GET DIAGNOSTICS n_aus = ROW_COUNT;
    UPDATE public.tr_deadline_extensions SET enrollment_id = v_batch WHERE user_id = a.user_id AND enrollment_id = a.id;
    GET DIAGNOSTICS n_ext = ROW_COUNT;

    -- 6) 주간체크 옛 초안: 관리자 대기 목록·알림판은 status만 보므로 숨김 처리(n8n 조회는 created_at≥시작일이라 무관)
    UPDATE public.tr_weekly_check_drafts SET status = 'dismissed'
     WHERE user_id = v_uid AND status IN ('pending', 'skipped');
    GET DIAGNOSTICS n_drafts = ROW_COUNT;

    -- 7) 첨삭 처음부터: 보관 이동(기준 시각 없음 = 전부, AI 생성 중만 거부) → 신청서·일정표 날짜
    IF v_corr_action = 'restart' THEN
        v_corr := public.restart_correction_archive(v_uid, a.id, p_by, NULL, false);
        UPDATE public.applications
           SET correction_start_date = to_char(p_corr_start, 'YYYY-MM-DD'),
               correction_end_date   = CASE WHEN v_corr_sp THEN p_corr_end ELSE NULL END
         WHERE id = a.id;                                   -- 동기화 트리거: 바뀐 칸만 일정표로
        -- 일정표를 직접 쓴다: 종료일이 같은 값이면 트리거가 건너뛰어 보관 함수가 비운 end_date가 NULL로 남는다(3차 대조 N2)
        INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, end_date)
        VALUES (v_uid, p_corr_start, 4, CASE WHEN v_corr_sp THEN p_corr_end ELSE NULL END)
        ON CONFLICT (user_id) DO UPDATE
           SET start_date = EXCLUDED.start_date,
               end_date   = EXCLUDED.end_date,
               duration_weeks = COALESCE(public.correction_schedules.duration_weeks, 4);
    END IF;

    -- 8) 챌린지 일정 (schedule_start 변경 → 시작 안내 트리거: 새 날짜 전날 10시 대상)
    IF v_is_sp THEN
        UPDATE public.applications
           SET schedule_start = to_char(p_new_start, 'YYYY-MM-DD'),
               self_paced_end_date = p_sp_end,
               self_paced_schedule = NULL            -- 테스트룸이 새 시작·종료일로 다시 만든다(로그인 때)
         WHERE id = a.id;
    ELSE
        UPDATE public.applications
           SET schedule_start = to_char(p_new_start, 'YYYY-MM-DD'),
               schedule_end   = to_char(v_new_end, 'YYYY-MM-DD'),
               australia_schedule_start = CASE WHEN v_is_aus THEN p_new_start ELSE australia_schedule_start END
         WHERE id = a.id;
    END IF;

    -- 9) 연습코스 열어두기(학생 상세 토글과 같은 저장). 오픈 알림톡(50231)은 보내지 않음(리셋 알림톡이 대신)
    IF p_open_practice AND a.practice_enabled IS NOT TRUE THEN
        UPDATE public.applications
           SET practice_enabled = true, practice_enabled_source = 'manual', practice_disabled_manually = false,
               practice_enabled_at = now(), practice_alimtalk_sent = true, practice_alimtalk_sent_at = COALESCE(practice_alimtalk_sent_at, now())
         WHERE id = a.id;
        v_practice_opened := true;
    END IF;

    -- 10) 이력
    v_entry := jsonb_build_object(
        'id', gen_random_uuid(), 'at', now(), 'by', p_by, 'reason', btrim(p_reason), 'batch', v_batch,
        'corr_action', v_corr_action, 'corr_sessions_used', v_used, 'corr_batch', v_corr->>'batch', 'corr_archived', v_corr,
        'corr_start', p_corr_start, 'corr_end', CASE WHEN v_corr_sp THEN p_corr_end ELSE NULL END,
        'practice_opened', v_practice_opened,
        'new_start', p_new_start, 'new_end', CASE WHEN v_is_sp THEN p_sp_end ELSE v_new_end END,
        'hidden', jsonb_build_object('study_results_v3', n_v3, 'aus_study_results', n_aus, 'tr_deadline_extensions', n_ext, 'weekly_drafts', n_drafts, 'pauses_canceled', n_pauses),
        'prev', v_prev);
    UPDATE public.applications SET reset_history = COALESCE(reset_history, '[]'::jsonb) || jsonb_build_array(v_entry) WHERE id = a.id;

    RETURN jsonb_build_object(
        'ok', true, 'batch', v_batch, 'corr_action', v_corr_action, 'corr_sessions_used', v_used, 'corr_archived', v_corr,
        'practice_opened', v_practice_opened, 'new_start', p_new_start, 'new_end', CASE WHEN v_is_sp THEN p_sp_end ELSE v_new_end END,
        'hidden', jsonb_build_object('study_results_v3', n_v3, 'aus_study_results', n_aus, 'tr_deadline_extensions', n_ext, 'weekly_drafts', n_drafts, 'pauses_canceled', n_pauses));
END;
$$;

-- ---------- 5) 되돌리기(가장 최근 리셋 1건) ----------
CREATE OR REPLACE FUNCTION public.enrollment_reset_undo(p_app_id uuid, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a          record;
    v_entry    jsonb;
    v_idx      int;
    v_batch    uuid;
    v_uid      uuid;
    v_new_rows int;
    v_corr_batch uuid;
    v_corr_restored jsonb := NULL;
    v_archived int;
    v_hist     jsonb;
    n_v3 int := 0; n_aus int := 0; n_ext int := 0;
BEGIN
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾지 못했습니다.'; END IF;

    -- 마지막 항목(undone_at 없음)
    SELECT e, ord INTO v_entry, v_idx
      FROM jsonb_array_elements(COALESCE(a.reset_history, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
     WHERE e->>'undone_at' IS NULL
     ORDER BY ord DESC LIMIT 1;
    IF v_entry IS NULL THEN RAISE EXCEPTION '되돌릴 리셋이 없습니다.'; END IF;
    v_batch := (v_entry->>'batch')::uuid;
    v_uid   := a.user_id::uuid;

    -- 리셋 뒤 새 기록이 있으면 거부(고유 제약이 꼬리표를 포함하므로 새 줄 0개면 충돌 없음)
    SELECT (SELECT count(*) FROM public.study_results_v3      WHERE user_id = a.user_id AND enrollment_id = a.id)
         + (SELECT count(*) FROM public.aus_study_results     WHERE user_id = a.user_id AND enrollment_id = a.id)
         + (SELECT count(*) FROM public.tr_deadline_extensions WHERE user_id = a.user_id AND enrollment_id = a.id)
      INTO v_new_rows;
    IF v_new_rows > 0 THEN RAISE EXCEPTION '리셋 뒤 새 학습 기록이 %건 있어 되돌릴 수 없습니다.', v_new_rows; END IF;

    -- 기록 꼬리표 복원
    UPDATE public.study_results_v3      SET enrollment_id = a.id WHERE user_id = a.user_id AND enrollment_id = v_batch;
    GET DIAGNOSTICS n_v3 = ROW_COUNT;
    UPDATE public.aus_study_results     SET enrollment_id = a.id WHERE user_id = a.user_id AND enrollment_id = v_batch;
    GET DIAGNOSTICS n_aus = ROW_COUNT;
    UPDATE public.tr_deadline_extensions SET enrollment_id = a.id WHERE user_id = a.user_id AND enrollment_id = v_batch;
    GET DIAGNOSTICS n_ext = ROW_COUNT;

    -- 첨삭 보관분 복원(처음부터였을 때만). 보관된 줄이 0이면 복원 함수가 오류를 내므로 건너뜀.
    IF v_entry->>'corr_batch' IS NOT NULL THEN
        v_corr_batch := (v_entry->>'corr_batch')::uuid;
        v_archived := COALESCE((v_entry->'corr_archived'->>'submissions')::int, 0) + COALESCE((v_entry->'corr_archived'->>'schedules')::int, 0);
        IF v_archived > 0 THEN
            v_corr_restored := public.restart_correction_restore(v_corr_batch);   -- 새 제출이 생겼으면 여기서 거부
        END IF;
        -- 신청서 첨삭 날짜도 리셋 전 값으로(일정표는 복원 함수가 옛 줄을 되살림 → 둘이 어긋나지 않게, 3차 대조 N3)
        UPDATE public.applications
           SET correction_start_date = v_entry->'prev'->>'correction_start_date',
               correction_end_date   = (v_entry->'prev'->>'correction_end_date')::date
         WHERE id = a.id;
    END IF;

    -- 이력 표시(정지 이력·챌린지 일정·연습코스·초안은 복원하지 않는다 — 화면이 prev 값을 보여준다)
    v_hist := jsonb_set(COALESCE(a.reset_history, '[]'::jsonb), ARRAY[(v_idx - 1)::text],
                        v_entry || jsonb_build_object('undone_at', now(), 'undone_by', p_by));
    UPDATE public.applications SET reset_history = v_hist WHERE id = a.id;

    RETURN jsonb_build_object('ok', true, 'batch', v_batch,
        'restored', jsonb_build_object('study_results_v3', n_v3, 'aus_study_results', n_aus, 'tr_deadline_extensions', n_ext),
        'corr_restored', v_corr_restored, 'prev', v_entry->'prev');
END;
$$;

-- ---------- 6) 권한 (관리자 화면이 anon 키로 호출 — 기존 관행. 보안 정비는 별도 작업) ----------
GRANT EXECUTE ON FUNCTION public.enrollment_reset(uuid, date, text, date, date, date, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enrollment_reset_undo(uuid, text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK (되돌리기)
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.enrollment_reset(uuid, date, text, date, date, date, boolean, text);
-- DROP FUNCTION IF EXISTS public.enrollment_reset_undo(uuid, text);
-- DROP FUNCTION IF EXISTS public.restart_correction_archive(uuid, uuid, text, uuid, boolean);
-- -- 4인자 보관 함수 복원: C:\기능구현\리셋\라이브함수원문_2026-10-17\restart_correction_archive.sql 전문을 실행한 뒤
-- -- GRANT EXECUTE ON FUNCTION public.restart_correction_archive(uuid, uuid, text, uuid) TO anon, authenticated;
-- ALTER TABLE public.tr_deadline_extensions DROP CONSTRAINT IF EXISTS uq_deadline_user_date_enrollment;
-- ALTER TABLE public.tr_deadline_extensions ADD CONSTRAINT uq_deadline_user_date UNIQUE (user_id, original_date);   -- 재태깅된 줄이 남아 있으면 중복으로 실패할 수 있음 → 먼저 되돌리기 함수로 꼬리표 복원
-- ALTER TABLE public.applications DROP COLUMN IF EXISTS reset_history;   -- 이력까지 지울 때만
-- COMMIT;
-- =====================================================================
