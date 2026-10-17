-- =====================================================================
-- 리셋 3단계(v3 보강) — 주간체크 초안 고유 인덱스에 꼬리표 포함 + 리셋/되돌리기가 초안 꼬리표를 함께 다룸 (2026-10-18)
--   계획: C:\기능구현\리셋\IMPLEMENTATION_PLAN.md 7-8
--   선행: 20261018_reset_2_mode.sql 적용본(라이브 2026-10-17 22시)
--
-- 발견(드라이런 v3): tr_weekly_check_drafts 에 라이브 전용 고유 인덱스 idx_drafts_user_week_unique (user_id, week) WHERE status<>'sent' 가 있어,
--   리셋(또는 재시작 수강 2) 뒤 n8n이 새 판의 같은 주차 초안을 넣으면 옛 초안(dismissed 포함)과 충돌해 조용히 실패한다(n8n은 오류를 삼킴).
--   박문수(2·3주차 옛 초안 dismissed)도 해당. 재시작 학생도 잠재적으로 해당.
-- 수정: 인덱스를 (user_id, week, enrollment_id) WHERE status<>'sent' 로 교체. 리셋은 이 수강 초안(꼬리표=신청서 id 또는 0000)의 꼬리표를 묶음 번호로 바꾸고,
--   되돌리기는 상태·꼬리표를 복원한다. n8n은 단순 INSERT(on_conflict 없음)라 인덱스 변경에 영향 없음.
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션). "Run without RLS".
-- 되돌리기: 맨 아래 ROLLBACK 주석.
-- =====================================================================

BEGIN;

-- ---------- 0) 사전 검사 ----------
DO $chk$
DECLARE v text;
BEGIN
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enrollment_reset';
  IF v IS DISTINCT FROM '640564c34530641bd633ce8bb521e024' THEN RAISE EXCEPTION 'ABORT enrollment_reset 라이브 본문이 v3(2026-10-17 22시) 적용본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enrollment_reset_undo';
  IF v IS DISTINCT FROM 'ce893a5499ce6b0a8bcfac08b8fc830f' THEN RAISE EXCEPTION 'ABORT enrollment_reset_undo 라이브 본문이 v3 적용본과 다름: %', v; END IF;
  SELECT indexdef INTO v FROM pg_indexes WHERE schemaname='public' AND tablename='tr_weekly_check_drafts' AND indexname='idx_drafts_user_week_unique';
  IF v IS NULL OR v NOT LIKE '%(user_id, week) WHERE%' THEN RAISE EXCEPTION 'ABORT idx_drafts_user_week_unique 정의가 예상(user_id, week WHERE status<>sent)과 다름: %', v; END IF;
END $chk$;

-- ---------- 1) 초안 고유 인덱스에 꼬리표 포함 ----------
DROP INDEX public.idx_drafts_user_week_unique;
CREATE UNIQUE INDEX idx_drafts_user_week_unique ON public.tr_weekly_check_drafts USING btree (user_id, week, enrollment_id) WHERE (status <> 'sent'::text);

-- ---------- 2) 리셋·되돌리기 함수 교체(초안 꼬리표 처리 추가, 그 외 v3와 동일) ----------
CREATE OR REPLACE FUNCTION public.enrollment_reset(
    p_app_id        uuid,
    p_new_start     date,
    p_reason        text,
    p_corr_start    date    DEFAULT NULL,
    p_corr_end      date    DEFAULT NULL,
    p_sp_end        date    DEFAULT NULL,
    p_open_practice boolean DEFAULT false,
    p_by            text    DEFAULT NULL,
    p_mode          text    DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a            record;
    v_today      date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_batch      uuid := gen_random_uuid();
    v_uid        uuid;
    v_is_aus     boolean;
    v_mode       text;
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
    v_dismissed  jsonb := '[]'::jsonb;
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
    v_is_aus := a.course_track = 'australia' OR COALESCE(a.assigned_program, '') ILIKE '%Australia%';

    -- 과정 결정 (검사보다 먼저). 호주는 과정 변경 불가(현행 유지).
    IF v_is_aus THEN
        IF p_mode IS NOT NULL THEN RAISE EXCEPTION '호주 과정은 리셋 창에서 과정을 바꿀 수 없습니다.'; END IF;
        v_mode := 'australia';
    ELSE
        v_mode := COALESCE(p_mode, CASE WHEN a.self_paced IS TRUE THEN 'selfpaced'
                                        WHEN COALESCE(a.assigned_program, '') ILIKE '%Standard%' THEN 'standard'
                                        ELSE 'fast' END);
        IF v_mode NOT IN ('fast', 'standard', 'selfpaced') THEN RAISE EXCEPTION '과정은 fast·standard·selfpaced 중 하나여야 합니다.'; END IF;
    END IF;

    -- 새 시작일: 내일 이후 · 자기주도가 아니면(정규·호주) 일요일. 주수·종료일은 고른 과정 기준.
    IF p_new_start IS NULL OR p_new_start < v_today + 1 THEN RAISE EXCEPTION '새 시작일은 내일 이후여야 합니다.'; END IF;
    IF v_mode <> 'selfpaced' AND extract(dow FROM p_new_start) <> 0 THEN RAISE EXCEPTION '정규·호주 과정 시작일은 일요일이어야 합니다.'; END IF;
    IF v_mode = 'selfpaced' THEN
        IF p_sp_end IS NULL THEN RAISE EXCEPTION '자기주도는 종료일이 필요합니다.'; END IF;
        IF p_sp_end <= p_new_start THEN RAISE EXCEPTION '자기주도 종료일은 시작일 뒤여야 합니다.'; END IF;
    ELSE
        v_weeks := CASE WHEN v_mode = 'standard' THEN 8
                        WHEN v_mode = 'fast' THEN 4
                        WHEN COALESCE(a.assigned_program, '') ILIKE '%Standard%' THEN 8 ELSE 4 END;   -- australia: 이름 기준
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

    -- 3) 리셋 전 값 스냅샷(완전 원상복구용)
    v_prev := jsonb_build_object(
        'schedule_start', a.schedule_start, 'schedule_end', a.schedule_end, 'assigned_program', a.assigned_program, 'course_track', a.course_track,
        'self_paced', a.self_paced, 'self_paced_end_date', a.self_paced_end_date, 'self_paced_schedule', a.self_paced_schedule,
        'australia_schedule_start', a.australia_schedule_start,
        'correction_enabled', a.correction_enabled, 'correction_start_date', a.correction_start_date, 'correction_end_date', a.correction_end_date,
        'challenge_pauses', COALESCE(a.challenge_pauses, '[]'::jsonb), 'correction_pauses', COALESCE(a.correction_pauses, '[]'::jsonb),
        'practice_enabled', a.practice_enabled, 'practice_enabled_source', a.practice_enabled_source, 'practice_disabled_manually', a.practice_disabled_manually,
        'practice_alimtalk_sent', a.practice_alimtalk_sent, 'practice_alimtalk_sent_at', a.practice_alimtalk_sent_at, 'practice_enabled_at', a.practice_enabled_at);

    -- 4) 정지 이력 취소 (시작일 변경보다 먼저). 챌린지 정지는 항상, 첨삭 정지는 첨삭을 처음부터 할 때만
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

    -- 5) 학습 기록 재태깅(숨김)
    UPDATE public.study_results_v3      SET enrollment_id = v_batch WHERE user_id = a.user_id AND enrollment_id = a.id;
    GET DIAGNOSTICS n_v3 = ROW_COUNT;
    UPDATE public.aus_study_results     SET enrollment_id = v_batch WHERE user_id = a.user_id AND enrollment_id = a.id;
    GET DIAGNOSTICS n_aus = ROW_COUNT;
    UPDATE public.tr_deadline_extensions SET enrollment_id = v_batch WHERE user_id = a.user_id AND enrollment_id = a.id;
    GET DIAGNOSTICS n_ext = ROW_COUNT;

    -- 6) 주간체크 옛 초안: 대기·건너뜀은 숨기고, 이 수강 초안 전부의 꼬리표를 묶음 번호로 바꾼다.
    --    (고유 인덱스 idx_drafts_user_week_unique = (회원, 주차, 꼬리표) WHERE status<>'sent' — 새 판 초안(꼬리표 0000)과 충돌하지 않게)
    --    되돌리기용으로 id·이전 상태·이전 꼬리표를 기억한다.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status, 'enrollment_id', d.enrollment_id)), '[]'::jsonb)
      INTO v_dismissed
      FROM public.tr_weekly_check_drafts d
     WHERE d.user_id = v_uid AND d.enrollment_id IN (a.id, '00000000-0000-0000-0000-000000000000'::uuid);
    UPDATE public.tr_weekly_check_drafts
       SET status = CASE WHEN status IN ('pending', 'skipped') THEN 'dismissed' ELSE status END,
           enrollment_id = v_batch
     WHERE user_id = v_uid AND enrollment_id IN (a.id, '00000000-0000-0000-0000-000000000000'::uuid);
    GET DIAGNOSTICS n_drafts = ROW_COUNT;

    -- 7) 첨삭 처음부터: 보관 이동(기준 시각 없음 = 전부, AI 생성 중만 거부) → 신청서·일정표 날짜
    IF v_corr_action = 'restart' THEN
        v_corr := public.restart_correction_archive(v_uid, a.id, p_by, NULL, false);
        UPDATE public.applications
           SET correction_start_date = to_char(p_corr_start, 'YYYY-MM-DD'),
               correction_end_date   = CASE WHEN v_corr_sp THEN p_corr_end ELSE NULL END
         WHERE id = a.id;
        INSERT INTO public.correction_schedules (user_id, start_date, duration_weeks, end_date)
        VALUES (v_uid, p_corr_start, 4, CASE WHEN v_corr_sp THEN p_corr_end ELSE NULL END)
        ON CONFLICT (user_id) DO UPDATE
           SET start_date = EXCLUDED.start_date,
               end_date   = EXCLUDED.end_date,
               duration_weeks = COALESCE(public.correction_schedules.duration_weeks, 4);
    END IF;

    -- 8) 챌린지 일정 — 고른 과정 기준 (schedule_start 변경 → 시작 안내 트리거: 새 날짜 전날 10시 대상)
    IF v_mode = 'selfpaced' THEN
        UPDATE public.applications
           SET schedule_start = to_char(p_new_start, 'YYYY-MM-DD'),
               schedule_end   = '',                           -- 자기주도는 빈 문자열(옛 정규 종료일이 남으면 "종료" 오판)
               assigned_program = '내벨업챌린지 - Fast',       -- 관리창 저장 규칙: 자기주도는 Fast·일반 트랙 고정
               course_track = 'regular',
               self_paced = true,
               self_paced_end_date = p_sp_end,
               self_paced_schedule = NULL                      -- 테스트룸이 로그인 때 새 시작·종료일로 다시 만든다
         WHERE id = a.id;
    ELSIF v_mode = 'australia' THEN
        UPDATE public.applications
           SET schedule_start = to_char(p_new_start, 'YYYY-MM-DD'),
               schedule_end   = to_char(v_new_end, 'YYYY-MM-DD'),
               australia_schedule_start = p_new_start,
               self_paced = false, self_paced_end_date = NULL, self_paced_schedule = NULL
         WHERE id = a.id;
    ELSE
        UPDATE public.applications
           SET schedule_start = to_char(p_new_start, 'YYYY-MM-DD'),
               schedule_end   = to_char(v_new_end, 'YYYY-MM-DD'),
               assigned_program = '내벨업챌린지 - ' || CASE WHEN v_mode = 'standard' THEN 'Standard' ELSE 'Fast' END,
               course_track = 'regular',
               self_paced = false, self_paced_end_date = NULL, self_paced_schedule = NULL
         WHERE id = a.id;
    END IF;

    -- 9) 연습코스 열어두기(학생 상세 토글과 같은 저장). 50231은 보내지 않음(리셋 연습코스 안내 알림톡이 대신)
    IF p_open_practice AND a.practice_enabled IS NOT TRUE AND NOT v_is_aus THEN
        UPDATE public.applications
           SET practice_enabled = true, practice_enabled_source = 'manual', practice_disabled_manually = false,
               practice_enabled_at = now(), practice_alimtalk_sent = true, practice_alimtalk_sent_at = COALESCE(practice_alimtalk_sent_at, now())
         WHERE id = a.id;
        v_practice_opened := true;
    END IF;

    -- 10) 이력
    v_entry := jsonb_build_object(
        'id', gen_random_uuid(), 'at', now(), 'by', p_by, 'reason', btrim(p_reason), 'batch', v_batch, 'mode', v_mode,
        'corr_action', v_corr_action, 'corr_sessions_used', v_used, 'corr_batch', v_corr->>'batch', 'corr_archived', v_corr,
        'corr_start', p_corr_start, 'corr_end', CASE WHEN v_corr_sp THEN p_corr_end ELSE NULL END,
        'practice_opened', v_practice_opened, 'dismissed_drafts', v_dismissed,
        'new_start', p_new_start, 'new_end', CASE WHEN v_mode = 'selfpaced' THEN p_sp_end ELSE v_new_end END,
        'hidden', jsonb_build_object('study_results_v3', n_v3, 'aus_study_results', n_aus, 'tr_deadline_extensions', n_ext, 'weekly_drafts', n_drafts, 'pauses_canceled', n_pauses),
        'prev', v_prev);
    UPDATE public.applications SET reset_history = COALESCE(reset_history, '[]'::jsonb) || jsonb_build_array(v_entry) WHERE id = a.id;

    RETURN jsonb_build_object(
        'ok', true, 'batch', v_batch, 'mode', v_mode, 'corr_action', v_corr_action, 'corr_sessions_used', v_used, 'corr_archived', v_corr,
        'practice_opened', v_practice_opened, 'new_start', p_new_start, 'new_end', CASE WHEN v_mode = 'selfpaced' THEN p_sp_end ELSE v_new_end END,
        'hidden', jsonb_build_object('study_results_v3', n_v3, 'aus_study_results', n_aus, 'tr_deadline_extensions', n_ext, 'weekly_drafts', n_drafts, 'pauses_canceled', n_pauses));
END;
$$;

-- ---------- 2) 되돌리기 — 완전 원상복구 ----------
CREATE OR REPLACE FUNCTION public.enrollment_reset_undo(p_app_id uuid, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a          record;
    v_entry    jsonb;
    v_prev     jsonb;
    v_idx      int;
    v_at       timestamptz;
    v_batch    uuid;
    v_uid      uuid;
    v_new_rows int;
    v_late_pauses int;
    v_corr_batch uuid;
    v_corr_restored jsonb := NULL;
    v_archived int;
    v_sched_deleted int := 0;
    v_hist     jsonb;
    v_late_tag uuid := gen_random_uuid();   -- 리셋 뒤 생긴 초안을 치워 둘 꼬리표(숨긴 옛 초안의 묶음 번호와 달라야 (회원, 주차, 꼬리표) 충돌이 없음)
    n_v3 int := 0; n_aus int := 0; n_ext int := 0; n_drafts int := 0; n_late_drafts int := 0;
    d          record;
BEGIN
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾지 못했습니다.'; END IF;

    SELECT e, ord INTO v_entry, v_idx
      FROM jsonb_array_elements(COALESCE(a.reset_history, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
     WHERE e->>'undone_at' IS NULL
     ORDER BY ord DESC LIMIT 1;
    IF v_entry IS NULL THEN RAISE EXCEPTION '되돌릴 리셋이 없습니다.'; END IF;
    v_batch := (v_entry->>'batch')::uuid;
    v_at    := (v_entry->>'at')::timestamptz;
    v_prev  := COALESCE(v_entry->'prev', '{}'::jsonb);
    v_uid   := a.user_id::uuid;

    -- 거부 1: 리셋 뒤 새 학습 기록
    SELECT (SELECT count(*) FROM public.study_results_v3      WHERE user_id = a.user_id AND enrollment_id = a.id)
         + (SELECT count(*) FROM public.aus_study_results     WHERE user_id = a.user_id AND enrollment_id = a.id)
         + (SELECT count(*) FROM public.tr_deadline_extensions WHERE user_id = a.user_id AND enrollment_id = a.id)
      INTO v_new_rows;
    IF v_new_rows > 0 THEN RAISE EXCEPTION '리셋 뒤 새 학습 기록이 %건 있어 되돌릴 수 없습니다.', v_new_rows; END IF;
    -- 거부 2: 리셋 뒤 정지 이력이 달라짐(새 정지가 살아 있거나, 리셋 전 정지를 리셋 뒤 바꿈). 밀린 날짜·지운 알림은 스냅샷으로 안 돌아오므로 거부.
    --   비교 규칙: 리셋이 붙인 취소 표시(canceled_* / canceled_by_reset=batch)는 지우고 status를 prev 것으로 되돌린 뒤 prev 항목과 같아야 함.
    --   prev에 없는 항목(리셋 뒤 등록)은 status='canceled'(취소·되돌림으로 밀기가 복구된 것)만 허용.
    SELECT count(*) INTO v_late_pauses
      FROM (
        SELECT x.kind, x.e,
               (SELECT p FROM jsonb_array_elements(COALESCE(v_prev->x.kind, '[]'::jsonb)) p WHERE p->>'id' = x.e->>'id' LIMIT 1) AS pe
          FROM (SELECT 'challenge_pauses' AS kind, e FROM jsonb_array_elements(COALESCE(a.challenge_pauses, '[]'::jsonb)) e
                UNION ALL SELECT 'correction_pauses', e FROM jsonb_array_elements(COALESCE(a.correction_pauses, '[]'::jsonb)) e) x
      ) y
     WHERE (y.pe IS NULL AND y.e->>'status' <> 'canceled')
        -- 리셋이 아닌 손으로 취소한 경우(밀기 복구됨)는 허용하지 않음: 날짜·알림 상태가 스냅샷과 어긋날 수 있음
        OR (y.pe IS NOT NULL AND y.e->>'status' = 'canceled' AND y.pe->>'status' <> 'canceled' AND COALESCE(y.e->>'canceled_by_reset', '') <> v_batch::text)
        -- 재개 처리(status resumed·resumed_at·알림 표시)는 크론이 자연히 바꾸는 값이라 비교에서 제외. 재개일·밀린 일수·정지 시작일이 다르면 거부.
        OR (y.pe IS NOT NULL AND
            (y.e - 'canceled_at' - 'canceled_by' - 'canceled_by_reset' - 'status' - 'resumed_at' - 'resumed_by' - 'resume_notice_sent_for' - 'pause_notice_at')
            IS DISTINCT FROM
            (y.pe - 'canceled_at' - 'canceled_by' - 'canceled_by_reset' - 'status' - 'resumed_at' - 'resumed_by' - 'resume_notice_sent_for' - 'pause_notice_at'));
    IF v_late_pauses > 0 THEN RAISE EXCEPTION '리셋 뒤 일시정지가 바뀐 항목이 %건 있어 되돌릴 수 없습니다. 리셋 뒤 건 정지는 "정지 되돌리기"로 먼저 되돌리세요.', v_late_pauses; END IF;
    -- 거부 3: 리셋 뒤 첨삭 켜짐/꺼짐이 바뀜
    IF (v_prev ? 'correction_enabled') AND COALESCE((v_prev->>'correction_enabled')::boolean, false) IS DISTINCT FROM COALESCE(a.correction_enabled, false) THEN
        RAISE EXCEPTION '리셋 뒤 첨삭 설정이 바뀌어 되돌릴 수 없습니다. 첨삭 설정을 리셋 당시(%)로 먼저 맞추세요.', CASE WHEN (v_prev->>'correction_enabled')::boolean THEN '켜짐' ELSE '꺼짐' END;
    END IF;

    -- ① 기록 꼬리표 복원
    UPDATE public.study_results_v3      SET enrollment_id = a.id WHERE user_id = a.user_id AND enrollment_id = v_batch;
    GET DIAGNOSTICS n_v3 = ROW_COUNT;
    UPDATE public.aus_study_results     SET enrollment_id = a.id WHERE user_id = a.user_id AND enrollment_id = v_batch;
    GET DIAGNOSTICS n_aus = ROW_COUNT;
    UPDATE public.tr_deadline_extensions SET enrollment_id = a.id WHERE user_id = a.user_id AND enrollment_id = v_batch;
    GET DIAGNOSTICS n_ext = ROW_COUNT;

    -- ② 신청서 칸 복원 — prev에 있는 키만(v2 이력 호환). 정지 이력과 일정을 한 UPDATE로. (첨삭 복원보다 먼저: 복원된 정지가 시작 안내 트리거 판정에 반영되게)
    UPDATE public.applications SET
        schedule_start           = CASE WHEN v_prev ? 'schedule_start'           THEN v_prev->>'schedule_start'                        ELSE schedule_start END,
        schedule_end             = CASE WHEN v_prev ? 'schedule_end'             THEN v_prev->>'schedule_end'                          ELSE schedule_end END,
        assigned_program         = CASE WHEN v_prev ? 'assigned_program'         THEN v_prev->>'assigned_program'                      ELSE assigned_program END,
        course_track             = CASE WHEN v_prev ? 'course_track'             THEN v_prev->>'course_track'                          ELSE course_track END,
        self_paced               = CASE WHEN v_prev ? 'self_paced'               THEN (v_prev->>'self_paced')::boolean                 ELSE self_paced END,
        self_paced_end_date      = CASE WHEN v_prev ? 'self_paced_end_date'      THEN (v_prev->>'self_paced_end_date')::date           ELSE self_paced_end_date END,
        self_paced_schedule      = CASE WHEN v_prev ? 'self_paced_schedule'      THEN v_prev->>'self_paced_schedule'                   ELSE self_paced_schedule END,
        australia_schedule_start = CASE WHEN v_prev ? 'australia_schedule_start' THEN (v_prev->>'australia_schedule_start')::date      ELSE australia_schedule_start END,
        correction_start_date    = CASE WHEN v_prev ? 'correction_start_date'    THEN v_prev->>'correction_start_date'                 ELSE correction_start_date END,
        correction_end_date      = CASE WHEN v_prev ? 'correction_end_date'      THEN (v_prev->>'correction_end_date')::date           ELSE correction_end_date END,
        challenge_pauses         = CASE WHEN v_prev ? 'challenge_pauses'         THEN COALESCE(v_prev->'challenge_pauses', '[]'::jsonb)  ELSE challenge_pauses END,
        correction_pauses        = CASE WHEN v_prev ? 'correction_pauses'        THEN COALESCE(v_prev->'correction_pauses', '[]'::jsonb) ELSE correction_pauses END,
        practice_enabled         = CASE WHEN v_prev ? 'practice_enabled'         THEN COALESCE((v_prev->>'practice_enabled')::boolean, false) ELSE practice_enabled END,
        practice_enabled_source  = CASE WHEN v_prev ? 'practice_enabled_source'  THEN v_prev->>'practice_enabled_source'               ELSE practice_enabled_source END,
        practice_disabled_manually = CASE WHEN v_prev ? 'practice_disabled_manually' THEN COALESCE((v_prev->>'practice_disabled_manually')::boolean, false) ELSE practice_disabled_manually END,
        practice_alimtalk_sent   = CASE WHEN v_prev ? 'practice_alimtalk_sent'   THEN COALESCE((v_prev->>'practice_alimtalk_sent')::boolean, false) ELSE practice_alimtalk_sent END,
        practice_alimtalk_sent_at = CASE WHEN v_prev ? 'practice_alimtalk_sent_at' THEN (v_prev->>'practice_alimtalk_sent_at')::timestamptz ELSE practice_alimtalk_sent_at END,
        practice_enabled_at      = CASE WHEN v_prev ? 'practice_enabled_at'      THEN (v_prev->>'practice_enabled_at')::timestamptz     ELSE practice_enabled_at END
    WHERE id = a.id;

    -- ③ 첨삭 보관분 복원(처음부터였을 때). 보관 0줄이면 리셋이 새로 만든 일정표 줄을 지운다.
    IF v_entry->>'corr_batch' IS NOT NULL THEN
        v_corr_batch := (v_entry->>'corr_batch')::uuid;
        v_archived := COALESCE((v_entry->'corr_archived'->>'submissions')::int, 0) + COALESCE((v_entry->'corr_archived'->>'schedules')::int, 0);
        IF v_archived > 0 THEN
            v_corr_restored := public.restart_correction_restore(v_corr_batch);   -- 새 제출이 생겼으면 여기서 거부
        ELSE
            DELETE FROM public.correction_schedules WHERE user_id = v_uid;
            GET DIAGNOSTICS v_sched_deleted = ROW_COUNT;
        END IF;
    END IF;

    -- ④ 첨삭 일정표 날짜를 신청서(prev)와 맞춤 — 복원 함수가 되살린 옛 줄과 같아야 하며, 동기화 트리거는 값이 같으면 건너뜀
    IF v_corr_batch IS NOT NULL AND v_archived > 0 AND (v_prev->>'correction_start_date') ~ '^\d{4}-\d{2}-\d{2}$' THEN
        UPDATE public.correction_schedules
           SET start_date = (v_prev->>'correction_start_date')::date,
               end_date   = (v_prev->>'correction_end_date')::date
         WHERE user_id = v_uid;
    END IF;

    -- ⑤ 초안: 리셋 뒤 자동으로 생긴 것(꼬리표 0000)은 먼저 숨기고 묶음 번호로 치운다(옛 초안을 되살릴 때 (회원, 주차) 충돌 방지).
    UPDATE public.tr_weekly_check_drafts
       SET status = CASE WHEN status IN ('pending', 'skipped') THEN 'dismissed' ELSE status END,
           enrollment_id = v_late_tag
     WHERE user_id = v_uid AND created_at > v_at AND enrollment_id = '00000000-0000-0000-0000-000000000000'::uuid;
    GET DIAGNOSTICS n_late_drafts = ROW_COUNT;
    --    리셋이 숨기고 꼬리표를 바꾼 초안은 이전 상태·이전 꼬리표로(v2 이력엔 enrollment_id가 없으므로 그때는 상태만)
    IF v_entry ? 'dismissed_drafts' THEN
        FOR d IN SELECT (x->>'id')::uuid AS id, x->>'status' AS st, (x->>'enrollment_id')::uuid AS eid FROM jsonb_array_elements(COALESCE(v_entry->'dismissed_drafts', '[]'::jsonb)) x LOOP
            UPDATE public.tr_weekly_check_drafts
               SET status = CASE WHEN status = 'dismissed' THEN COALESCE(d.st, status) ELSE status END,
                   enrollment_id = COALESCE(d.eid, enrollment_id)
             WHERE id = d.id;
            n_drafts := n_drafts + 1;
        END LOOP;
    END IF;

    -- ⑥ 이력 표시
    v_hist := jsonb_set(COALESCE(a.reset_history, '[]'::jsonb), ARRAY[(v_idx - 1)::text],
                        v_entry || jsonb_build_object('undone_at', now(), 'undone_by', p_by));
    UPDATE public.applications SET reset_history = v_hist WHERE id = a.id;

    RETURN jsonb_build_object('ok', true, 'batch', v_batch,
        'restored', jsonb_build_object('study_results_v3', n_v3, 'aus_study_results', n_aus, 'tr_deadline_extensions', n_ext, 'weekly_drafts', n_drafts, 'late_drafts_dismissed', n_late_drafts, 'correction_schedule_deleted', v_sched_deleted),
        'corr_restored', v_corr_restored, 'prev', v_prev);
END;
$$;

-- ---------- 3) 권한 ----------
GRANT EXECUTE ON FUNCTION public.enrollment_reset(uuid, date, text, date, date, date, boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enrollment_reset_undo(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =====================================================================
-- ROLLBACK (되돌리기)
-- BEGIN;
-- DROP INDEX public.idx_drafts_user_week_unique;
-- CREATE UNIQUE INDEX idx_drafts_user_week_unique ON public.tr_weekly_check_drafts USING btree (user_id, week) WHERE (status <> 'sent'::text);   -- 리셋으로 묶음 번호가 붙은 초안이 있으면 (회원, 주차) 중복으로 실패할 수 있음 → 먼저 되돌리기
-- -- 함수는 20261018_reset_2_mode.sql 의 1)·2) 본문 재실행 + GRANT + NOTIFY
-- COMMIT;
-- =====================================================================
