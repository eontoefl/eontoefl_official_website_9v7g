-- =====================================================================
-- 재시작(수강 2) 2단계 — 배포일에 실행 (테스트룸 코드 배포 직후, 같은 날)
--   계획: C:\기능구현\재시작\IMPLEMENTATION_PLAN.md (v3, 7·12장)
--   선행: 20261016_restart_1_additive.sql 적용 + 테스트룸 `재시작` 브랜치 배포(기록 저장 때 enrollment_id를 보냄)
--
-- 하는 일 (여기부터 동작이 바뀜)
--   1) 1단계 뒤~배포 사이에 옛 코드가 저장한 기록(꼬리표 0000…)을 다시 채움
--   2) 학습 기록 고유 제약 교체: (user_id, section_type, module_number, week, day) → + enrollment_id
--        study_results_v3 / aus_study_results.  옛 제약 이름을 모르므로 열 구성으로 찾아 지운다.
--   3) 기존 함수 3개에 "그 수강의 기록만" 조건
--        schedule_pause_set(R6 되돌리기) · schedule_pause_undo_check(정지 뒤 새 제출 검사) · auto_enable_practice_mode(실전 과제 완료 수)
--      본문은 2026-10-12/10-08 라이브 정의(레포 service_stop_1.sql · pause_3_undo_reschedule.sql)에서 그 조건 한 줄씩만 더한 것.
--      실행 전 md5 사전검사로 라이브가 그 정의와 같을 때만 진행.
--
-- 하지 않는 일
--   - send_correction_d1_alimtalk(첨삭 D-1): 라이브 본문이 레포 사본과 다르다고 기록돼 있어(환불처리 PROJECT_MEMORY)
--     여기서 덮어쓰지 않는다. 배포일에 `SELECT prosrc FROM pg_proc WHERE proname='send_correction_d1_alimtalk'` 결과를 받아
--     LEFT JOIN applications 부분을 "created_at DESC LIMIT 1 LATERAL"로 바꾼 뒤 별도 실행.
--
-- 실행: Supabase SQL Editor, 파일 전체(한 트랜잭션), "Run without RLS".
-- 되돌리기: 맨 아래 ROLLBACK 주석.
-- =====================================================================

BEGIN;

-- ---------- 0) 사전 검사 ----------
DO $chk$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='study_results_v3' AND column_name='enrollment_id') THEN
    RAISE EXCEPTION 'ABORT 1단계(20261016_restart_1_additive.sql)가 먼저 적용돼야 함';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'study_results_v3_enrollment_uniq') THEN
    RAISE EXCEPTION 'ABORT 이미 적용된 파일(study_results_v3_enrollment_uniq 있음)';
  END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_set';
  IF v IS DISTINCT FROM '7c1bea7f058c75065b9f5d9f5cbeb592' THEN RAISE EXCEPTION 'ABORT schedule_pause_set 라이브 본문이 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_undo_check';
  IF v IS DISTINCT FROM '6efc0f46f82f2ed0c04473b0bd3ea5db' THEN RAISE EXCEPTION 'ABORT schedule_pause_undo_check 라이브 본문이 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='auto_enable_practice_mode';
  IF v IS DISTINCT FROM '9ddfa6b0d8607ca4faa76fa39ca3bb5a' THEN RAISE EXCEPTION 'ABORT auto_enable_practice_mode 라이브 본문이 확인본과 다름: %', v; END IF;
END $chk$;
-- ※ 위 __MD5_*__ 세 값은 배포일 직전에 아래 한 줄로 받아서 채운다(대표가 SQL 편집기에서 실행 → 결과를 Claude에게):
--    SELECT proname, md5(prosrc) FROM pg_proc WHERE proname IN ('schedule_pause_set','schedule_pause_undo_check','auto_enable_practice_mode');

-- ---------- 1) 사이 기간 기록 다시 채움 ----------
CREATE TEMP TABLE _enroll_map2 ON COMMIT DROP AS
WITH ch AS (
    SELECT a.id, a.user_id, lower(a.email) AS email, a.enrollment_no, a.created_at
      FROM public.applications a
     WHERE COALESCE(a.application_type, 'challenge') <> 'book_only'
       AND a.deleted IS NOT TRUE AND a.withdrawn_at IS NULL
),
-- 회원당 "입금 확인된 가장 최근" 신청서(테스트룸이 고르는 기준과 동일). 없으면 가장 최근.
ranked AS (
    SELECT ch.*, u.id::text AS uid,
           row_number() OVER (PARTITION BY COALESCE(ch.user_id::text, u.id::text)
                              ORDER BY (SELECT a2.deposit_confirmed_by_admin FROM public.applications a2 WHERE a2.id = ch.id) DESC NULLS LAST,
                                       ch.created_at DESC NULLS LAST) AS rn
      FROM ch LEFT JOIN public.users u ON lower(u.email) = ch.email
)
SELECT COALESCE(user_id::text, uid) AS uid, id FROM ranked WHERE rn = 1 AND COALESCE(user_id::text, uid) IS NOT NULL;

UPDATE public.study_results_v3 r      SET enrollment_id = m.id FROM _enroll_map2 m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';
UPDATE public.aus_study_results r     SET enrollment_id = m.id FROM _enroll_map2 m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';
UPDATE public.tr_deadline_extensions r SET enrollment_id = m.id FROM _enroll_map2 m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';

-- ---------- 2) 고유 제약 교체 ----------
DO $uq$
DECLARE r record;
BEGIN
  -- study_results_v3: (user_id, section_type, module_number, week, day) 5열 유니크 제약/인덱스를 찾아 지운다
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
      FROM pg_constraint c
     WHERE c.contype = 'u'
       AND c.conrelid IN ('public.study_results_v3'::regclass, 'public.aus_study_results'::regclass)
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
           = ARRAY['day','module_number','section_type','user_id','week']
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    RAISE NOTICE '[재시작 2단계] 옛 고유 제약 지움: %.%', r.tbl, r.conname;
  END LOOP;
  -- 제약이 아니라 유니크 인덱스로만 있던 경우
  FOR r IN
    SELECT i.indexrelid::regclass AS idx, i.indrelid::regclass AS tbl
      FROM pg_index i
     WHERE i.indisunique AND NOT i.indisprimary
       AND i.indrelid IN ('public.study_results_v3'::regclass, 'public.aus_study_results'::regclass)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
           = ARRAY['day','module_number','section_type','user_id','week']
  LOOP
    EXECUTE format('DROP INDEX %s', r.idx);
    RAISE NOTICE '[재시작 2단계] 옛 유니크 인덱스 지움: %', r.idx;
  END LOOP;
END $uq$;

ALTER TABLE public.study_results_v3  ADD CONSTRAINT study_results_v3_enrollment_uniq  UNIQUE (user_id, section_type, module_number, week, day, enrollment_id);
ALTER TABLE public.aus_study_results ADD CONSTRAINT aus_study_results_enrollment_uniq UNIQUE (user_id, section_type, module_number, week, day, enrollment_id);

-- ---------- 3) 함수 3개: 그 수강의 기록만 ----------
-- 3-1) schedule_pause_set — 2026-10-12 라이브 정의(service_stop_1.sql 934행) + R6 되돌리기에 `AND r.enrollment_id = a.id`
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
    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정은 정지할 수 없습니다.'; END IF;   -- [환불] 상품별(S5·S6)
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
    -- [재시작] 그 수강(신청서)의 기록만 — 수강 1 기록이 수강 2 정지에 섞이지 않게
    IF p_kind = 'challenge' AND p_paused_from <= v_today AND a.self_paced IS NOT TRUE THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'locked_auth_rate', r.locked_auth_rate)), '[]'::jsonb)
          INTO v_rev_rows
          FROM public.study_results_v3 r
         WHERE r.user_id = a.user_id
           AND r.enrollment_id = a.id
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

-- 3-2) schedule_pause_undo_check — 2026-10-08 라이브 정의(pause_3_undo_reschedule.sql) + "정지 뒤 새 제출" 검사에 `AND r.enrollment_id = a.id`
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
    -- ① 등록 뒤 새 제출 — [재시작] 그 수강의 기록만
    IF p_kind = 'challenge' THEN
        IF EXISTS (SELECT 1 FROM public.study_results_v3 r
                    WHERE r.user_id = a.user_id AND r.enrollment_id = a.id AND r.initial_record IS NOT NULL
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

-- 3-3) auto_enable_practice_mode — 2026-10-12 라이브 정의(service_stop_1.sql) + 실전 과제 완료 수에 `AND r.enrollment_id = c.id`
CREATE OR REPLACE FUNCTION auto_enable_practice_mode()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_count INTEGER := 0;
BEGIN
    WITH candidate AS (
        SELECT
            a.id,
            a.email,
            GREATEST(safe_to_date(a.schedule_end), a.self_paced_end_date) AS end_date,
            CASE
                WHEN COALESCE(a.assigned_program, a.preferred_program, '') ILIKE '%fast%'
                    THEN 'fast'
                ELSE 'standard'
            END AS program
        FROM applications a
        WHERE a.deposit_confirmed_by_admin = true
          AND COALESCE(a.practice_enabled, false) = false
          AND COALESCE(a.practice_disabled_manually, false) = false
          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
          AND NOT public.is_service_stopped(a.id, 'challenge', v_today)   -- [정지∪환불]
          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.
          AND COALESCE(a.course_track, 'regular') <> 'australia'
    ),
    scored AS (
        SELECT
            c.id,
            c.end_date,
            (SELECT count(*) FROM practice_final_tasks f
              WHERE f.program = c.program) AS required_cnt,
            -- [재시작] 그 수강(신청서)의 기록만 — 수강 1 실전 기록으로 수강 2 연습코스가 열리지 않게
            (SELECT count(*)
               FROM practice_final_tasks f
               JOIN users u             ON u.email = c.email
               JOIN study_results_v3 r  ON r.user_id = u.id::text AND r.enrollment_id = c.id
              WHERE f.program        = c.program
                AND r.week           = f.week_text
                AND r.day            = '금'
                AND r.section_type   = f.section_type
                AND r.module_number  = f.module_number
                AND r.completed_at IS NOT NULL) AS done_cnt
        FROM candidate c
    )
    UPDATE applications
    SET practice_enabled        = true,
        practice_enabled_at     = now(),
        practice_enabled_source = 'auto'
    WHERE id IN (
        SELECT s.id
        FROM scored s
        WHERE s.end_date <= v_today
           OR (s.required_cnt > 0 AND s.done_cnt >= s.required_cnt)
    );

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        RAISE NOTICE '[practice] 연습코스 자동 활성화: %건', v_count;
    END IF;

    RETURN v_count;
END;
$$;

COMMIT;

-- =====================================================================
-- ROLLBACK (되돌리기)
--   함수 3개: 레포의 20261012_service_stop_1.sql(schedule_pause_set 934행·auto_enable_practice_mode 727행)과
--            20261008_schedule_pause_3_undo_reschedule.sql(schedule_pause_undo_check) 정의를 그대로 다시 실행.
--   제약: BEGIN;
--         ALTER TABLE public.study_results_v3  DROP CONSTRAINT study_results_v3_enrollment_uniq;
--         ALTER TABLE public.aus_study_results DROP CONSTRAINT aus_study_results_enrollment_uniq;
--         ALTER TABLE public.study_results_v3  ADD CONSTRAINT study_results_v3_user_task_uniq  UNIQUE (user_id, section_type, module_number, week, day);
--         ALTER TABLE public.aus_study_results ADD CONSTRAINT aus_study_results_user_task_uniq UNIQUE (user_id, section_type, module_number, week, day);
--         COMMIT;
--   ※ 되돌릴 때 같은 사람의 수강 1·2 기록이 둘 다 있으면 옛 5열 제약이 걸린다 → 수강 2 기록을 먼저 다른 곳으로 옮겨야 함.
-- =====================================================================
