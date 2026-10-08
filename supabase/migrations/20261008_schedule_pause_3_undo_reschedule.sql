-- =====================================================================
-- 일시정지 4단계 — 3부: 정지 "되돌리기" + "기간 수정" (2026-10-08)
--   계획: C:\기능구현\일시정지\작업지시_4단계_되돌리기_기간수정.md
--
-- 바뀌는 것
--   1) schedule_pause_set: 등록할 때 항목에 undo 스냅샷을 남긴다.
--        undo.before / undo.after = 밀기 전·후의 저장 날짜들(_pause_snapshot)
--        undo.reverted = R6로 미확정으로 돌린 과제 행 [{id, locked_auth_rate}]
--        undo.reminders = Q2로 지운 회차 알림 기록 [{session_number, sent_at, payload}]
--      그 외 동작·검증·알림톡은 2단계(…_1_core.sql)와 글자 단위로 같다.
--   2) schedule_pause_undo_check(app, kind): 되돌릴 수 있는지 판정 {ok, reasons[], entry_id} — 관리창이 버튼 노출에 씀.
--        조건 ① 등록 뒤 새 제출 없음 ② 재개일 아직 안 지남(무기한 통과) ③ 재개 안내 아직 안 나감 ④ 등록 때 밀어 둔 값 그대로
--   3) schedule_pause_undo(app, kind, by): ①~④ 통과하면 undo.before로 복원 + 과제 행·알림 기록 복원 + 항목 canceled. 발송 없음.
--   4) schedule_pause_reschedule(app, kind, resume_on|NULL, by): 진행 중 정지의 재개일 변경.
--        재개일→재개일(차이만큼 밀기), 재개일→무기한(밀어 둔 만큼 되돌림), 무기한→재개일(기존 schedule_pause_resume 위임).
--        정지 시작일은 불변. 재개 안내는 새 재개일 기준 전날 10시 규칙(process_resume_notices) 그대로.
--   5) 권한: undo_check·undo·reschedule만 anon 허용, 보조 함수는 내부 전용.
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션). "Run without RLS".
-- 되돌리기: 맨 아래 ROLLBACK 주석.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) 사전 검사: 2단계 함수가 2026-10-08 확인본 그대로여야 하고, 새 함수는 아직 없어야 한다
-- ---------------------------------------------------------------------
DO $chk$
DECLARE v text;
BEGIN
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_set';
  IF v IS DISTINCT FROM '33c1224c62062c3fb511e222ab3e2432' THEN RAISE EXCEPTION 'ABORT schedule_pause_set 라이브 본문이 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_resume';
  IF v IS DISTINCT FROM 'e903db656b4ce56fe88112a8b8277117' THEN RAISE EXCEPTION 'ABORT schedule_pause_resume 라이브 본문이 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_cancel';
  IF v IS DISTINCT FROM '374c981ffed445ef527a3148c0f8c542' THEN RAISE EXCEPTION 'ABORT schedule_pause_cancel 라이브 본문이 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_apply_shift';
  IF v IS DISTINCT FROM '3b4cb80a93ab9f28d7135e00aafad338' THEN RAISE EXCEPTION 'ABORT schedule_pause_apply_shift 라이브 본문이 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_pause_entry_merge';
  IF v IS DISTINCT FROM '2eceb8a679e5e3a7a82f0a2c42c82e08' THEN RAISE EXCEPTION 'ABORT _pause_entry_merge 라이브 본문이 확인본과 다름: %', v; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('schedule_pause_undo','schedule_pause_reschedule','_pause_snapshot')) THEN
    RAISE EXCEPTION 'ABORT 되돌리기 함수가 이미 있음 — 이미 적용된 파일';
  END IF;
END $chk$;

-- ---------------------------------------------------------------------
-- 1) 보조: 항목에서 키 제거 (_pause_entry_merge는 병합만 하므로)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pause_entry_unset(p_app_id uuid, p_kind text, p_entry_id text, p_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_arr jsonb;
    v_new jsonb := '[]'::jsonb;
    e     jsonb;
    v_hit jsonb;
BEGIN
    v_arr := public.schedule_pause_entries(p_app_id, p_kind);
    FOR e IN SELECT x FROM jsonb_array_elements(v_arr) x LOOP
        IF e->>'id' = p_entry_id THEN
            e := e - p_keys;
            v_hit := e;
        END IF;
        v_new := v_new || e;
    END LOOP;
    IF v_hit IS NULL THEN RAISE EXCEPTION '정지 항목 없음: %', p_entry_id; END IF;
    IF p_kind = 'challenge' THEN
        UPDATE public.applications SET challenge_pauses = v_new WHERE id = p_app_id;
    ELSE
        UPDATE public.applications SET correction_pauses = v_new WHERE id = p_app_id;
    END IF;
    RETURN v_hit;
END;
$$;

-- ---------------------------------------------------------------------
-- 2) 스냅샷: schedule_pause_apply_shift 가 건드리는 저장 날짜 전부 (같은 범위, 같은 필터)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pause_snapshot(p_app_id uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
AS $$
DECLARE
    a     public.applications%ROWTYPE;
    v_uid uuid;
    v_out jsonb;
BEGIN
    SELECT * INTO a FROM public.applications WHERE id = p_app_id;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서 없음: %', p_app_id; END IF;
    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    IF p_kind = 'challenge' THEN
        v_out := jsonb_build_object(
            'schedule_end',        a.schedule_end,
            'self_paced_end_date', CASE WHEN a.self_paced_end_date IS NULL THEN NULL ELSE to_char(a.self_paced_end_date, 'YYYY-MM-DD') END,
            'self_paced_schedule', a.self_paced_schedule,
            'deadline_ext', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'original_date', t.original_date) ORDER BY t.id)
                                        FROM public.tr_deadline_extensions t WHERE t.user_id = a.user_id), '[]'::jsonb));
    ELSIF p_kind = 'correction' THEN
        v_out := jsonb_build_object(
            'correction_end_date',  CASE WHEN a.correction_end_date  IS NULL THEN NULL ELSE to_char(a.correction_end_date,  'YYYY-MM-DD') END,
            'extension_start_date', CASE WHEN a.extension_start_date IS NULL THEN NULL ELSE to_char(a.extension_start_date, 'YYYY-MM-DD') END,
            'extension_end_date',   CASE WHEN a.extension_end_date   IS NULL THEN NULL ELSE to_char(a.extension_end_date,   'YYYY-MM-DD') END,
            'cs', CASE WHEN v_uid IS NULL THEN NULL ELSE
                    (SELECT jsonb_build_object('session_dates', cs.session_dates, 'extension_session_dates', cs.extension_session_dates)
                       FROM public.correction_schedules cs WHERE cs.user_id = v_uid LIMIT 1) END,
            'ext_req', CASE WHEN v_uid IS NULL THEN '[]'::jsonb ELSE
                    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'deadline_date', to_char(r.deadline_date, 'YYYY-MM-DD')) ORDER BY r.id)
                                FROM public.correction_extension_requests r
                               WHERE r.user_id = v_uid AND r.status = 'pending' AND r.deadline_date IS NOT NULL), '[]'::jsonb) END);
    ELSE
        RAISE EXCEPTION '알 수 없는 종류: %', p_kind;
    END IF;
    RETURN v_out;
END;
$$;

-- 비교용 정규화: 확정표(JSON 문자열)는 파싱해서 비교(형식만 다른 저장은 "같음"으로)
CREATE OR REPLACE FUNCTION public._pause_snapshot_norm(p_snap jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v  jsonb := COALESCE(p_snap, '{}'::jsonb);
    k  text;
    j  jsonb;
BEGIN
    FOREACH k IN ARRAY ARRAY['self_paced_schedule'] LOOP
        IF jsonb_typeof(v->k) = 'string' THEN
            BEGIN j := (v->>k)::jsonb; v := jsonb_set(v, ARRAY[k], j); EXCEPTION WHEN others THEN NULL; END;
        END IF;
    END LOOP;
    IF jsonb_typeof(v->'cs') = 'object' THEN
        FOREACH k IN ARRAY ARRAY['session_dates', 'extension_session_dates'] LOOP
            IF jsonb_typeof(v->'cs'->k) = 'string' THEN
                BEGIN j := (v->'cs'->>k)::jsonb; v := jsonb_set(v, ARRAY['cs', k], j); EXCEPTION WHEN others THEN NULL; END;
            END IF;
        END LOOP;
    END IF;
    RETURN v;
END;
$$;

-- 복원: 스냅샷 값을 그대로 다시 쓴다(원문 텍스트 그대로). applications 변경은 기존 트리거가 correction_schedules 종료일로 복사한다.
CREATE OR REPLACE FUNCTION public._pause_snapshot_restore(p_app_id uuid, p_kind text, p_snap jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a     public.applications%ROWTYPE;
    v_uid uuid;
    x     jsonb;
BEGIN
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서 없음: %', p_app_id; END IF;
    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    IF p_kind = 'challenge' THEN
        UPDATE public.applications
           SET schedule_end        = p_snap->>'schedule_end',
               self_paced_end_date = (p_snap->>'self_paced_end_date')::date,
               self_paced_schedule = p_snap->>'self_paced_schedule'
         WHERE id = p_app_id;
        FOR x IN SELECT y FROM jsonb_array_elements(COALESCE(p_snap->'deadline_ext', '[]'::jsonb)) y LOOP
            UPDATE public.tr_deadline_extensions SET original_date = x->>'original_date'
             WHERE id = x->>'id' AND user_id = a.user_id;
        END LOOP;
    ELSIF p_kind = 'correction' THEN
        UPDATE public.applications
           SET correction_end_date  = (p_snap->>'correction_end_date')::date,
               extension_start_date = (p_snap->>'extension_start_date')::date,
               extension_end_date   = (p_snap->>'extension_end_date')::date
         WHERE id = p_app_id;
        IF v_uid IS NOT NULL THEN
            IF jsonb_typeof(p_snap->'cs') = 'object' THEN
                UPDATE public.correction_schedules
                   SET session_dates           = p_snap->'cs'->>'session_dates',
                       extension_session_dates = p_snap->'cs'->>'extension_session_dates'
                 WHERE user_id = v_uid;
            END IF;
            FOR x IN SELECT y FROM jsonb_array_elements(COALESCE(p_snap->'ext_req', '[]'::jsonb)) y LOOP
                UPDATE public.correction_extension_requests SET deadline_date = (x->>'deadline_date')::date
                 WHERE id = (x->>'id')::uuid AND user_id = v_uid;
            END LOOP;
        END IF;
    ELSE
        RAISE EXCEPTION '알 수 없는 종류: %', p_kind;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) 정지 등록 — 2단계 본문 + undo 스냅샷(before/after/reverted/reminders)만 추가
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_pause_set(
    p_app_id      uuid,
    p_kind        text,
    p_paused_from date,
    p_resume_on   date DEFAULT NULL,
    p_note        text DEFAULT NULL,
    p_by          text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a          public.applications%ROWTYPE;
    v_today    date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_last_sun date := (now() AT TIME ZONE 'Asia/Seoul')::date - extract(dow FROM (now() AT TIME ZONE 'Asia/Seoul')::date)::int;
    v_start    date;
    v_end      date;
    v_entry    jsonb;
    v_id       text := gen_random_uuid()::text;
    v_shift    int;
    v_uid      uuid;
    v_reverted int := 0;
    v_deleted  int := 0;
    v_target   text;
    v_label_from text;
    v_before   jsonb;
    v_rev_rows jsonb := '[]'::jsonb;
    v_rem_rows jsonb := '[]'::jsonb;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF a.deposit_confirmed_by_admin IS NOT TRUE OR a.deleted IS TRUE THEN RAISE EXCEPTION '입금 확인된 신청서만 정지할 수 있습니다.'; END IF;
    IF COALESCE(a.app_status, '') IN ('refunded', 'dropped') THEN RAISE EXCEPTION '환불·중도포기 학생은 정지할 수 없습니다.'; END IF;
    IF public.is_paused(p_app_id, p_kind, v_today)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
                   WHERE x->>'status' = 'open' AND (x->>'paused_from')::date > v_today) THEN
        RAISE EXCEPTION '이미 정지 중이거나 정지가 예약돼 있습니다. 먼저 재개·취소하세요.';
    END IF;

    IF p_kind = 'challenge' THEN
        IF a.schedule_start !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '내챌 시작일이 없습니다.'; END IF;
        v_start := a.schedule_start::date;
        IF a.self_paced IS TRUE AND a.self_paced_end_date IS NULL THEN
            RAISE EXCEPTION '종료일이 없는 옛 자기주도 과정은 일시정지를 지원하지 않습니다.';
        END IF;
        v_end := GREATEST(safe_to_date(a.schedule_end), a.self_paced_end_date);
        v_target := '내벨업챌린지';
    ELSE
        IF a.correction_enabled IS NOT TRUE OR a.correction_start_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
            RAISE EXCEPTION '첨삭이 켜져 있고 시작일이 있어야 합니다.';
        END IF;
        v_start := a.correction_start_date::date;
        v_end := COALESCE(a.extension_end_date,
                          CASE WHEN a.extension_start_date IS NOT NULL THEN public.pause_adjusted_date(p_app_id, 'correction', a.extension_start_date + 27) END,
                          a.correction_end_date,
                          public.pause_adjusted_date(p_app_id, 'correction', v_start + 27));
        v_target := '스라첨삭';
    END IF;

    -- D15: 진행 중일 때만
    IF v_start > v_today THEN RAISE EXCEPTION '아직 시작 전입니다. 시작 전 조정은 시작일 변경으로 하세요.'; END IF;
    IF v_end IS NOT NULL AND v_end < v_today THEN RAISE EXCEPTION '이미 종료된 과정입니다.'; END IF;
    -- R6: 소급은 최근 일요일까지, 시작일 이전 불가. 예약은 180일 이내.
    IF p_paused_from IS NULL THEN RAISE EXCEPTION '정지 시작일을 입력하세요.'; END IF;
    IF p_paused_from < v_last_sun THEN RAISE EXCEPTION '소급 정지는 최근 일요일(%)까지만 가능합니다.', v_last_sun; END IF;
    IF p_paused_from < v_start THEN RAISE EXCEPTION '정지 시작일이 과정 시작일보다 앞설 수 없습니다.'; END IF;
    IF p_paused_from > v_today + 180 THEN RAISE EXCEPTION '정지 시작일은 180일 이내여야 합니다.'; END IF;
    -- V1: 재개일 = 정지 시작일 + 7×N
    IF p_resume_on IS NOT NULL THEN
        IF p_resume_on <= p_paused_from THEN RAISE EXCEPTION '재개일은 정지 시작일 뒤여야 합니다.'; END IF;
        IF (p_resume_on - p_paused_from) % 7 <> 0 THEN RAISE EXCEPTION '재개일은 정지 시작일과 같은 요일(7일 단위)이어야 합니다.'; END IF;
        v_shift := p_resume_on - p_paused_from;
    END IF;

    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    -- (4단계) 되돌리기용: 밀기 전 저장 날짜
    v_before := public._pause_snapshot(p_app_id, p_kind);

    -- R6: 소급 구간에서 미제출로 0%/실전만으로 50% 굳은 과제를 미확정으로 되돌린다(내챌). 정당한 점수(보카·100)는 제외.
    IF p_kind = 'challenge' AND p_paused_from <= v_today AND a.self_paced IS NOT TRUE THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'locked_auth_rate', r.locked_auth_rate)), '[]'::jsonb)
          INTO v_rev_rows
          FROM public.study_results_v3 r
         WHERE r.user_id = a.user_id
           AND r.week ~ '^\d+$'
           AND r.day IN ('일','월','화','수','목','금')
           AND (v_start + (r.week::int - 1) * 7 + (array_position(ARRAY['일','월','화','수','목','금'], r.day) - 1))
               BETWEEN p_paused_from AND v_today
           AND (
                (r.locked_auth_rate = 0  AND r.initial_record IS NULL)
             OR (r.locked_auth_rate = 50 AND r.initial_record IS NOT NULL AND r.error_note_submitted IS NOT TRUE
                 AND r.section_type IN ('reading','listening','writing','speaking'))
           );
        UPDATE public.study_results_v3 r
           SET locked_auth_rate = NULL
         WHERE r.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_rev_rows) x);
        GET DIAGNOSTICS v_reverted = ROW_COUNT;
    END IF;

    -- Q2: 소급 구간에 이미 나간 회차 알림 기록(1차 미제출 회차)을 지워 재개 후 새 날짜에 다시 안내되게 한다.
    IF p_kind = 'correction' AND p_paused_from <= v_today AND v_uid IS NOT NULL THEN
        WITH d AS (
            DELETE FROM public.correction_session_reminders cr
             WHERE cr.user_id = v_uid
               AND COALESCE(public.correction_session_nominal_date(v_uid, cr.session_number), '1900-01-01') >= p_paused_from
               AND NOT EXISTS (SELECT 1 FROM public.correction_submissions s
                                WHERE s.user_id = v_uid AND s.session_number = cr.session_number
                                  AND s.draft_1_submitted_at IS NOT NULL)
            RETURNING cr.session_number, cr.sent_at, cr.payload)
        SELECT COALESCE(jsonb_agg(jsonb_build_object('session_number', d.session_number, 'sent_at', d.sent_at, 'payload', d.payload)), '[]'::jsonb)
          INTO v_rem_rows FROM d;
        v_deleted := jsonb_array_length(v_rem_rows);
    END IF;

    v_entry := jsonb_build_object(
        'id', v_id,
        'paused_from', to_char(p_paused_from, 'YYYY-MM-DD'),
        'resume_on', CASE WHEN p_resume_on IS NULL THEN NULL ELSE to_char(p_resume_on, 'YYYY-MM-DD') END,
        'shift_days', v_shift,
        'status', 'open',
        'created_at', now(),
        'created_by', p_by,
        'note', p_note,
        'reverted_rows', v_reverted,
        'deleted_reminders', v_deleted);

    IF p_kind = 'challenge' THEN
        UPDATE public.applications SET challenge_pauses = challenge_pauses || v_entry WHERE id = p_app_id;
    ELSE
        UPDATE public.applications SET correction_pauses = correction_pauses || v_entry WHERE id = p_app_id;
    END IF;

    -- 기간형: 재개일을 아니까 저장된 날짜를 지금 민다(D5·4-1③)
    IF v_shift IS NOT NULL THEN
        PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, p_paused_from, v_shift);
        v_entry := public._pause_entry_merge(p_app_id, p_kind, v_id, jsonb_build_object('shift_applied_at', now()));
    END IF;

    -- (4단계) 되돌리기용 스냅샷 저장: 밀기 전/후 + 되돌린 과제 행 + 지운 알림 기록
    v_entry := public._pause_entry_merge(p_app_id, p_kind, v_id, jsonb_build_object('undo', jsonb_build_object(
        'before', v_before,
        'after', public._pause_snapshot(p_app_id, p_kind),
        'reverted', v_rev_rows,
        'reminders', v_rem_rows)));

    -- D16: 정지 안내 알림톡(등록 즉시). 템플릿 미등록이면 엣지함수가 거절(발송 없음).
    PERFORM public._pause_notify('schedule_paused', jsonb_build_object(
        'name', COALESCE(a.name, ''), 'phone', a.phone, 'app_id', a.id::text,
        'target', v_target,
        'paused_from', public._kr_date_label(p_paused_from),
        'resume_on', public._kr_date_label(p_resume_on)));
    v_entry := public._pause_entry_merge(p_app_id, p_kind, v_id, jsonb_build_object('pause_notice_at', now()));

    RETURN v_entry;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) 되돌리기 가능 판정 (관리창 버튼 노출용, 읽기 전용)
--    {ok, entry_id, reasons[]} — reasons 비어 있으면 ok
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_pause_undo_check(p_app_id uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
AS $$
DECLARE
    a         public.applications%ROWTYPE;
    v_today   date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e         jsonb;
    v_created timestamptz;
    v_uid     uuid;
    v_reasons text[] := ARRAY[]::text[];
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    SELECT x INTO e
      FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
     WHERE x->>'status' = 'open'
     ORDER BY x->>'created_at' DESC
     LIMIT 1;
    IF e IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'entry_id', NULL, 'reasons', jsonb_build_array('되돌릴 정지가 없습니다.'));
    END IF;
    v_created := (e->>'created_at')::timestamptz;

    -- ② 재개일이 지났으면 불가
    IF NULLIF(e->>'resume_on', '') IS NOT NULL AND (e->>'resume_on')::date <= v_today THEN
        v_reasons := array_append(v_reasons, '재개일이 이미 지났습니다.');
    END IF;
    -- ③ 재개 안내가 이미 나갔으면 불가
    IF NULLIF(e->>'resume_notice_sent_for', '') IS NOT NULL THEN
        v_reasons := array_append(v_reasons, '재개 안내 알림톡이 이미 나갔습니다(' || (e->>'resume_notice_sent_for') || ' 기준).');
    END IF;
    -- ① 등록 뒤 새 제출
    IF p_kind = 'challenge' THEN
        IF EXISTS (SELECT 1 FROM public.study_results_v3 r
                    WHERE r.user_id = a.user_id AND r.initial_record IS NOT NULL
                      AND (r.completed_at > v_created OR r.created_at > v_created)) THEN
            v_reasons := array_append(v_reasons, '정지 등록 뒤 학생이 과제를 제출했습니다.');
        END IF;
    ELSE
        IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.correction_submissions s
                    WHERE s.user_id = v_uid
                      AND (s.draft_1_submitted_at > v_created OR s.draft_2_submitted_at > v_created)) THEN
            v_reasons := array_append(v_reasons, '정지 등록 뒤 학생이 첨삭 원고를 제출했습니다.');
        END IF;
    END IF;
    -- ④ 등록 시점 스냅샷이 있고, 밀고 난 뒤 값이 지금 값과 같아야
    IF e->'undo' IS NULL OR e->'undo'->'before' IS NULL THEN
        v_reasons := array_append(v_reasons, '등록 시점 정보(스냅샷)가 없는 옛 항목입니다. 수동 처리를 요청하세요.');
    ELSIF public._pause_snapshot_norm(e->'undo'->'after') <> public._pause_snapshot_norm(public._pause_snapshot(p_app_id, p_kind)) THEN
        v_reasons := array_append(v_reasons, '정지 등록 뒤 일정(종료일·확정표·연장 기록)이 바뀌었습니다.');
    END IF;

    RETURN jsonb_build_object('ok', cardinality(v_reasons) = 0, 'entry_id', e->>'id', 'reasons', to_jsonb(v_reasons));
END;
$$;

-- ---------------------------------------------------------------------
-- 5) 되돌리기: 조건 통과 → before 복원 + 과제 행·알림 기록 복원 + 항목 canceled. 발송 없음.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_pause_undo(p_app_id uuid, p_kind text, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a      public.applications%ROWTYPE;
    v_chk  jsonb;
    e      jsonb;
    x      jsonb;
    v_uid  uuid;
    v_restored_rows int := 0;
    v_restored_rem  int := 0;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    v_chk := public.schedule_pause_undo_check(p_app_id, p_kind);
    IF (v_chk->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION '되돌릴 수 없습니다: %', (SELECT string_agg(r, ' / ') FROM jsonb_array_elements_text(v_chk->'reasons') r);
    END IF;
    SELECT y INTO e FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) y WHERE y->>'id' = v_chk->>'entry_id';

    -- 1) 저장 날짜 복원(밀기 전 값 그대로)
    PERFORM public._pause_snapshot_restore(p_app_id, p_kind, e->'undo'->'before');

    -- 2) R6로 미확정으로 돌렸던 과제 행 → 이전 값으로
    FOR x IN SELECT y FROM jsonb_array_elements(COALESCE(e->'undo'->'reverted', '[]'::jsonb)) y LOOP
        UPDATE public.study_results_v3 r SET locked_auth_rate = (x->>'locked_auth_rate')::int
         WHERE r.id = (x->>'id')::uuid AND r.user_id = a.user_id;
        IF FOUND THEN v_restored_rows := v_restored_rows + 1; END IF;
    END LOOP;

    -- 3) Q2로 지운 회차 알림 기록 → 다시 넣기(같은 회차 중복 발송 방지)
    IF v_uid IS NOT NULL THEN
        FOR x IN SELECT y FROM jsonb_array_elements(COALESCE(e->'undo'->'reminders', '[]'::jsonb)) y LOOP
            INSERT INTO public.correction_session_reminders (user_id, session_number, sent_at, payload)
            VALUES (v_uid, (x->>'session_number')::int, COALESCE((x->>'sent_at')::timestamptz, now()), x->'payload')
            ON CONFLICT (user_id, session_number) DO NOTHING;
            IF FOUND THEN v_restored_rem := v_restored_rem + 1; END IF;
        END LOOP;
    END IF;

    -- 4) 항목은 취소 이력으로(status canceled → 정지 판정·시작일 검사·종료일 계산에서 모두 제외)
    RETURN public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
        'status', 'canceled', 'canceled_at', now(), 'canceled_by', p_by,
        'undone_at', now(), 'undone_by', p_by,
        'undo_restored_rows', v_restored_rows, 'undo_restored_reminders', v_restored_rem,
        'note', NULLIF(concat_ws(' · ', NULLIF(e->>'note', ''), '되돌림(정지 전 상태로 복원)'), '')));
END;
$$;

-- ---------------------------------------------------------------------
-- 6) 기간 수정: 진행 중(또는 예약) 정지의 재개일 변경. 정지 시작일은 불변.
--    p_resume_on NULL = 무기한으로 전환. 재개 안내는 새 재개일 기준 전날 10시 규칙 그대로(process_resume_notices).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_pause_reschedule(
    p_app_id    uuid,
    p_kind      text,
    p_resume_on date,
    p_by        text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today   date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e         jsonb;
    v_from    date;
    v_old     date;
    v_old_sh  int;
    v_new_sh  int;
    v_delta   int;
    v_entry   jsonb;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;
    SELECT x INTO e
      FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
     WHERE x->>'status' = 'open'
       AND (NULLIF(x->>'resume_on', '') IS NULL OR (x->>'resume_on')::date > v_today)
     ORDER BY x->>'created_at' DESC
     LIMIT 1;
    IF e IS NULL THEN RAISE EXCEPTION '수정할 진행 중 정지가 없습니다(재개일이 지난 정지는 수정할 수 없음).'; END IF;
    v_from   := (e->>'paused_from')::date;
    v_old    := NULLIF(e->>'resume_on', '')::date;
    v_old_sh := NULLIF(e->>'shift_days', '')::int;

    IF p_resume_on IS NULL THEN
        -- 재개일 → 무기한: 밀어 둔 만큼 되돌리고 재개일을 비운다
        IF v_old IS NULL THEN RAISE EXCEPTION '이미 무기한 정지입니다.'; END IF;
        IF v_old_sh IS NOT NULL AND e ? 'shift_applied_at' THEN
            PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, v_from, -v_old_sh);
        END IF;
        PERFORM public._pause_entry_unset(p_app_id, p_kind, e->>'id', ARRAY['shift_applied_at']);
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'resume_on', NULL, 'shift_days', NULL,
            'prev_resume_on', to_char(v_old, 'YYYY-MM-DD'), 'rescheduled_at', now(), 'rescheduled_by', p_by));

    ELSIF v_old IS NULL THEN
        -- 무기한 → 재개일: 기존 재개 함수 그대로(검증·밀기·재개 안내 포함)
        PERFORM public.schedule_pause_resume(p_app_id, p_kind, p_resume_on, p_by);
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'prev_resume_on', NULL, 'rescheduled_at', now(), 'rescheduled_by', p_by));

    ELSE
        -- 재개일 → 다른 재개일: 차이만큼만 밀기(음수 가능)
        IF p_resume_on <= v_from THEN RAISE EXCEPTION '재개일은 정지 시작일 뒤여야 합니다.'; END IF;
        IF p_resume_on < v_today THEN RAISE EXCEPTION '재개일은 오늘 이후여야 합니다.'; END IF;
        IF (p_resume_on - v_from) % 7 <> 0 THEN RAISE EXCEPTION '재개일은 정지 시작일과 같은 요일(7일 단위)이어야 합니다.'; END IF;
        IF p_resume_on = v_old THEN RAISE EXCEPTION '재개일이 지금과 같습니다.'; END IF;
        v_new_sh := p_resume_on - v_from;
        v_delta  := v_new_sh - CASE WHEN e ? 'shift_applied_at' THEN COALESCE(v_old_sh, 0) ELSE 0 END;
        IF v_delta <> 0 THEN
            PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, v_from, v_delta);
        END IF;
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'resume_on', to_char(p_resume_on, 'YYYY-MM-DD'),
            'shift_days', v_new_sh,
            'shift_applied_at', now(),
            'prev_resume_on', to_char(v_old, 'YYYY-MM-DD'), 'rescheduled_at', now(), 'rescheduled_by', p_by,
            'status', CASE WHEN p_resume_on <= v_today THEN 'resumed' ELSE 'open' END));
        -- R7: 새 재개일 기준 전날 10시가 지났으면 지금 바로 재개 안내(이미 그 날짜로 보냈으면 안 보냄)
        PERFORM public.process_resume_notices(p_app_id);
    END IF;

    -- 되돌리기 비교 기준(undo.after)을 지금 값으로 갱신(스냅샷 있는 항목만)
    IF e ? 'undo' THEN
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'undo', (e->'undo') || jsonb_build_object('after', public._pause_snapshot(p_app_id, p_kind))));
    END IF;
    RETURN public._pause_entry_merge(p_app_id, p_kind, e->>'id', '{}'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------
-- 7) 권한
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._pause_entry_unset(uuid, text, text, text[])           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pause_snapshot(uuid, text)                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pause_snapshot_norm(jsonb)                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pause_snapshot_restore(uuid, text, jsonb)              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_set(uuid, text, date, date, text, text)  TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_undo_check(uuid, text)                   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_undo(uuid, text, text)                   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_reschedule(uuid, text, date, text)       TO anon, authenticated;

-- 적용 후 확인
SELECT p.proname, md5(p.prosrc) AS md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('schedule_pause_set','schedule_pause_undo_check','schedule_pause_undo','schedule_pause_reschedule',
                     '_pause_snapshot','_pause_snapshot_norm','_pause_snapshot_restore','_pause_entry_unset')
 ORDER BY 1;

COMMIT;

-- ROLLBACK(수동): BEGIN;
--   DROP FUNCTION public.schedule_pause_undo(uuid,text,text), public.schedule_pause_undo_check(uuid,text),
--                 public.schedule_pause_reschedule(uuid,text,date,text), public._pause_snapshot_restore(uuid,text,jsonb),
--                 public._pause_snapshot_norm(jsonb), public._pause_snapshot(uuid,text), public._pause_entry_unset(uuid,text,text,text[]);
--   그리고 schedule_pause_set 은 …_1_core.sql 의 5) 본문으로 다시 CREATE OR REPLACE (md5 33c1224c62062c3fb511e222ab3e2432).
-- COMMIT;
