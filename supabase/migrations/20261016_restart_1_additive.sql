-- =====================================================================
-- 재시작(수강 2) 1단계 — 추가만 하는 DB 변경 (2026-10-16)
--   계획: C:\기능구현\재시작\IMPLEMENTATION_PLAN.md (v3, 10~12장)
--
-- 이 파일이 하는 일 (지금 사이트 동작은 바뀌지 않음 — 기존 코드는 새 칸을 모르고 지나간다)
--   1) applications: 수강 번호·재시작 요청/허용·교재 체크·첨삭 선택 칸
--   2) 학습 기록 표 4개: 수강 꼬리표(enrollment_id) 칸 + 기존 줄 채움
--        study_results_v3 / aus_study_results / tr_deadline_extensions / tr_weekly_check_drafts
--        채울 신청서가 없는 줄(옛 테스트 기록)은 고정값 00000000-0000-0000-0000-000000000000 로 둔다(NULL 금지).
--   3) 첨삭 '다시'용 보관 표 5개 + 보관 이동 함수 restart_correction_archive + 되돌림 함수 restart_correction_restore
--   4) contracts.contract_type 에 'restart','restart_correction' 허용(CHECK 제약이 있을 때만 교체)
--
-- 하지 않는 일 (배포일 파일 20261016_restart_2_deploy.sql 로 미룸)
--   - 학습 기록 고유 제약 교체 (테스트룸 코드 배포와 같은 날)
--   - 기존 함수 3개(schedule_pause_set·schedule_pause_undo_check·auto_enable_practice_mode)에 수강 조건 추가
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션). "Run without RLS".
-- 되돌리기: 맨 아래 ROLLBACK 주석.
-- =====================================================================

BEGIN;

-- ---------- 0) 사전 검사 ----------
DO $chk$
DECLARE v_dup int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='applications' AND column_name='enrollment_no') THEN
    RAISE EXCEPTION 'ABORT applications.enrollment_no 칸이 이미 있음 — 이미 적용된 파일';
  END IF;
  -- 꼬리표 채움은 "회원당 살아 있는 챌린지 신청서 1장"을 전제로 한다. 2장 이상인 회원이 있으면 멈춘다.
  SELECT count(*) INTO v_dup FROM (
    SELECT a.user_id FROM public.applications a
     WHERE COALESCE(a.application_type, 'challenge') <> 'book_only'
       AND a.deleted IS NOT TRUE AND a.withdrawn_at IS NULL AND a.user_id IS NOT NULL
     GROUP BY a.user_id HAVING count(*) > 1) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'ABORT 살아 있는 챌린지 신청서가 2장 이상인 회원 %명 — 먼저 정리 필요', v_dup;
  END IF;
END $chk$;

-- ---------- 1) applications 칸 ----------
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS enrollment_no        int         NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS restart_of           uuid,
    ADD COLUMN IF NOT EXISTS superseded_by        uuid,
    ADD COLUMN IF NOT EXISTS restart_requested_at timestamptz,
    ADD COLUMN IF NOT EXISTS restart_allowed_at   timestamptz,
    ADD COLUMN IF NOT EXISTS restart_allowed_by   text,
    ADD COLUMN IF NOT EXISTS restart_materials    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS correction_mode      text;

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_correction_mode_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_correction_mode_check
    CHECK (correction_mode IS NULL OR correction_mode IN ('none', 'new', 'again'));

COMMENT ON COLUMN public.applications.enrollment_no        IS '수강 번호. 1=첫 수강, 2=재시작(수강 2). 같은 사람의 신청서가 2장일 때 구분.';
COMMENT ON COLUMN public.applications.restart_of           IS '수강 2 신청서에만: 재시작 전 신청서(수강 1) id';
COMMENT ON COLUMN public.applications.superseded_by        IS '수강 1 신청서에만: 이 수강을 이어받은 수강 2 신청서 id. 있으면 재시작 카드·허용 모두 끝.';
COMMENT ON COLUMN public.applications.restart_requested_at IS '수강 1 신청서에만: 학생이 대시보드 카드에서 재시작을 요청한 시각';
COMMENT ON COLUMN public.applications.restart_allowed_at   IS '수강 1 신청서에만: 대표가 관리창에서 수강 2를 허용한 시각. 있으면 신청서 작성 화면이 열림.';
COMMENT ON COLUMN public.applications.restart_allowed_by   IS '허용한 관리자';
COMMENT ON COLUMN public.applications.restart_materials    IS '학생이 카드에서 체크한 실물 교재 목록(문자 배열). 수강 1에 기록되고 수강 2 신청서로 복사.';
COMMENT ON COLUMN public.applications.correction_mode      IS '수강 2 신청서에만: 첨삭 선택. none=없음(0원) / new=새로(+20만) / again=다시(0원, 수강 1 첨삭 기록 보관 이동). 수강 1에서는 NULL.';

-- ---------- 2) 학습 기록 표 꼬리표 ----------
ALTER TABLE public.study_results_v3      ADD COLUMN IF NOT EXISTS enrollment_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.aus_study_results     ADD COLUMN IF NOT EXISTS enrollment_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.tr_deadline_extensions ADD COLUMN IF NOT EXISTS enrollment_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.tr_weekly_check_drafts ADD COLUMN IF NOT EXISTS enrollment_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

COMMENT ON COLUMN public.study_results_v3.enrollment_id IS '이 기록이 속한 수강(applications.id). 0000…0000 = 채울 신청서가 없는 옛 기록. 재시작(수강 2) 구분용.';
COMMENT ON COLUMN public.aus_study_results.enrollment_id IS '이 기록이 속한 수강(applications.id). 0000…0000 = 채울 신청서가 없는 옛 기록.';
COMMENT ON COLUMN public.tr_deadline_extensions.enrollment_id IS '이 마감 연장이 속한 수강(applications.id).';
COMMENT ON COLUMN public.tr_weekly_check_drafts.enrollment_id IS '이 주간체크 초안이 속한 수강(applications.id). n8n이 채우기 전 줄은 0000…0000.';

CREATE INDEX IF NOT EXISTS study_results_v3_enrollment_idx  ON public.study_results_v3 (enrollment_id);
CREATE INDEX IF NOT EXISTS aus_study_results_enrollment_idx ON public.aus_study_results (enrollment_id);

-- 채움: 회원 → 살아 있는 챌린지 신청서 1장. (user_id 일치 → 없으면 users.email 일치)
CREATE TEMP TABLE _enroll_map ON COMMIT DROP AS
WITH ch AS (
    SELECT a.id, a.user_id, lower(a.email) AS email
      FROM public.applications a
     WHERE COALESCE(a.application_type, 'challenge') <> 'book_only'
       AND a.deleted IS NOT TRUE AND a.withdrawn_at IS NULL
),
by_uid AS (
    SELECT ch.user_id::text AS uid, ch.id FROM ch WHERE ch.user_id IS NOT NULL
),
by_email AS (
    SELECT u.id::text AS uid, ch.id
      FROM public.users u
      JOIN ch ON ch.email = lower(u.email)
     WHERE NOT EXISTS (SELECT 1 FROM by_uid b WHERE b.uid = u.id::text)
)
SELECT uid, min(id::text)::uuid AS id, count(*) AS c
  FROM (SELECT * FROM by_uid UNION ALL SELECT * FROM by_email) x
 GROUP BY uid;

DO $m$
DECLARE v_dup int;
BEGIN
  SELECT count(*) INTO v_dup FROM _enroll_map WHERE c > 1;
  IF v_dup > 0 THEN RAISE EXCEPTION 'ABORT 꼬리표 채움 대상이 2장인 회원 %명', v_dup; END IF;
END $m$;

UPDATE public.study_results_v3 r      SET enrollment_id = m.id FROM _enroll_map m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';
UPDATE public.aus_study_results r     SET enrollment_id = m.id FROM _enroll_map m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';
UPDATE public.tr_deadline_extensions r SET enrollment_id = m.id FROM _enroll_map m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';
UPDATE public.tr_weekly_check_drafts r SET enrollment_id = m.id FROM _enroll_map m WHERE r.user_id::text = m.uid AND r.enrollment_id = '00000000-0000-0000-0000-000000000000';

-- 채움 결과 보고(실행 창 Messages 탭에 표시)
DO $r$
DECLARE v1 int; v2 int; v3 int; v4 int; n1 int; n2 int;
BEGIN
  SELECT count(*) INTO v1 FROM public.study_results_v3      WHERE enrollment_id = '00000000-0000-0000-0000-000000000000';
  SELECT count(*) INTO v2 FROM public.aus_study_results     WHERE enrollment_id = '00000000-0000-0000-0000-000000000000';
  SELECT count(*) INTO v3 FROM public.tr_deadline_extensions WHERE enrollment_id = '00000000-0000-0000-0000-000000000000';
  SELECT count(*) INTO v4 FROM public.tr_weekly_check_drafts WHERE enrollment_id = '00000000-0000-0000-0000-000000000000';
  SELECT count(*) INTO n1 FROM public.study_results_v3; SELECT count(*) INTO n2 FROM public.aus_study_results;
  RAISE NOTICE '[재시작 1단계] 꼬리표 못 채운 줄: study_results_v3 %/% · aus %/% · 마감연장 % · 주간체크초안 %  (예상: v3 약 64줄, aus 0)', v1, n1, v2, n2, v3, v4;
END $r$;

-- ---------- 3) 첨삭 '다시' 보관 표 + 함수 ----------
CREATE TABLE IF NOT EXISTS public.correction_submissions_archive        (LIKE public.correction_submissions        INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS public.correction_deadline_extensions_archive (LIKE public.correction_deadline_extensions INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS public.correction_extension_requests_archive  (LIKE public.correction_extension_requests  INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS public.correction_session_reminders_archive   (LIKE public.correction_session_reminders   INCLUDING DEFAULTS);
CREATE TABLE IF NOT EXISTS public.correction_schedules_archive           (LIKE public.correction_schedules           INCLUDING DEFAULTS);

DO $arc$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['correction_submissions_archive','correction_deadline_extensions_archive',
                           'correction_extension_requests_archive','correction_session_reminders_archive','correction_schedules_archive'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_from_app uuid', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archived_by text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archive_batch uuid NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (user_id)', t || '_user_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (archive_batch)', t || '_batch_idx', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);   -- 정책 없음 = anon 직접 접근 불가(함수로만)
  END LOOP;
END $arc$;

COMMENT ON TABLE public.correction_submissions_archive IS '재시작(수강 2) 첨삭 "다시" 때 보관 이동된 수강 1 첨삭 제출·피드백. archived_from_app = 수강 1 신청서. 되돌림: restart_correction_restore(archive_batch).';

-- 보관 이동: 그 회원의 첨삭 줄 전부를 보관 표로 옮기고 일정표 줄은 초기화. 처리 중(피드백 대기) 줄이 있으면 거부.
CREATE OR REPLACE FUNCTION public.restart_correction_archive(p_user_id uuid, p_from_app uuid, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch uuid := gen_random_uuid();
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
       AND s.status IN ('draft1_submitted', 'feedback1_processing', 'draft2_submitted', 'feedback2_processing');
    IF v_busy > 0 THEN
        RAISE EXCEPTION '첨삭 피드백이 처리 중인 제출 %건이 있습니다. 끝난 뒤 다시 하세요.', v_busy;
    END IF;

    INSERT INTO public.correction_submissions_archive
        SELECT s.*, now(), p_from_app, p_by, v_batch FROM public.correction_submissions s WHERE s.user_id = p_user_id;
    GET DIAGNOSTICS n_sub = ROW_COUNT;
    DELETE FROM public.correction_submissions WHERE user_id = p_user_id;

    INSERT INTO public.correction_deadline_extensions_archive
        SELECT e.*, now(), p_from_app, p_by, v_batch FROM public.correction_deadline_extensions e WHERE e.user_id = p_user_id;
    GET DIAGNOSTICS n_ext = ROW_COUNT;
    DELETE FROM public.correction_deadline_extensions WHERE user_id = p_user_id;

    INSERT INTO public.correction_extension_requests_archive
        SELECT q.*, now(), p_from_app, p_by, v_batch FROM public.correction_extension_requests q WHERE q.user_id = p_user_id;
    GET DIAGNOSTICS n_req = ROW_COUNT;
    DELETE FROM public.correction_extension_requests WHERE user_id = p_user_id;

    INSERT INTO public.correction_session_reminders_archive
        SELECT r.*, now(), p_from_app, p_by, v_batch FROM public.correction_session_reminders r WHERE r.user_id = p_user_id;
    GET DIAGNOSTICS n_rem = ROW_COUNT;
    DELETE FROM public.correction_session_reminders WHERE user_id = p_user_id;

    -- 일정표: 복사본을 남기고 연장·날짜표·알림 플래그를 초기화(시작일은 관리창 저장이 새로 넣는다)
    INSERT INTO public.correction_schedules_archive
        SELECT c.*, now(), p_from_app, p_by, v_batch FROM public.correction_schedules c WHERE c.user_id = p_user_id;
    GET DIAGNOSTICS n_sch = ROW_COUNT;
    UPDATE public.correction_schedules
       SET extension_enabled = false, extension_start_date = NULL, extension_end_date = NULL, extension_session_dates = NULL,
           session_dates = NULL, end_date = NULL,
           kakaotalk_d1_sent = false, kakaotalk_d1_sent_at = NULL,
           extension_notify_sent = false, extension_notify_sent_at = NULL,
           start_notice_sent_for = NULL
     WHERE user_id = p_user_id;

    RETURN jsonb_build_object('batch', v_batch, 'submissions', n_sub, 'deadline_extensions', n_ext,
                              'extension_requests', n_req, 'session_reminders', n_rem, 'schedules', n_sch);
END;
$$;

-- 되돌림(대표가 SQL 편집기에서만): 보관분을 제자리로. 그 사이 새 첨삭 줄이 생겼으면 거부.
CREATE OR REPLACE FUNCTION public.restart_correction_restore(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid uuid;
    n_sub int := 0; n_ext int := 0; n_req int := 0; n_rem int := 0; n_sch int := 0;
BEGIN
    SELECT user_id INTO v_uid FROM public.correction_submissions_archive WHERE archive_batch = p_batch LIMIT 1;
    IF v_uid IS NULL THEN SELECT user_id INTO v_uid FROM public.correction_schedules_archive WHERE archive_batch = p_batch LIMIT 1; END IF;
    IF v_uid IS NULL THEN RAISE EXCEPTION '그 보관 묶음이 없습니다.'; END IF;
    IF EXISTS (SELECT 1 FROM public.correction_submissions WHERE user_id = v_uid) THEN
        RAISE EXCEPTION '그 사이 새 첨삭 제출이 생겼습니다. 수동으로 정리하세요.';
    END IF;

    INSERT INTO public.correction_submissions
        SELECT (jsonb_populate_record(NULL::public.correction_submissions,
                to_jsonb(a) - 'archived_at' - 'archived_from_app' - 'archived_by' - 'archive_batch')).*
          FROM public.correction_submissions_archive a WHERE a.archive_batch = p_batch;
    GET DIAGNOSTICS n_sub = ROW_COUNT;
    DELETE FROM public.correction_submissions_archive WHERE archive_batch = p_batch;

    INSERT INTO public.correction_deadline_extensions
        SELECT (jsonb_populate_record(NULL::public.correction_deadline_extensions,
                to_jsonb(a) - 'archived_at' - 'archived_from_app' - 'archived_by' - 'archive_batch')).*
          FROM public.correction_deadline_extensions_archive a WHERE a.archive_batch = p_batch;
    GET DIAGNOSTICS n_ext = ROW_COUNT;
    DELETE FROM public.correction_deadline_extensions_archive WHERE archive_batch = p_batch;

    INSERT INTO public.correction_extension_requests
        SELECT (jsonb_populate_record(NULL::public.correction_extension_requests,
                to_jsonb(a) - 'archived_at' - 'archived_from_app' - 'archived_by' - 'archive_batch')).*
          FROM public.correction_extension_requests_archive a WHERE a.archive_batch = p_batch;
    GET DIAGNOSTICS n_req = ROW_COUNT;
    DELETE FROM public.correction_extension_requests_archive WHERE archive_batch = p_batch;

    INSERT INTO public.correction_session_reminders
        SELECT (jsonb_populate_record(NULL::public.correction_session_reminders,
                to_jsonb(a) - 'archived_at' - 'archived_from_app' - 'archived_by' - 'archive_batch')).*
          FROM public.correction_session_reminders_archive a WHERE a.archive_batch = p_batch
    ON CONFLICT (user_id, session_number) DO NOTHING;
    GET DIAGNOSTICS n_rem = ROW_COUNT;
    DELETE FROM public.correction_session_reminders_archive WHERE archive_batch = p_batch;

    DELETE FROM public.correction_schedules WHERE user_id = v_uid;
    INSERT INTO public.correction_schedules
        SELECT (jsonb_populate_record(NULL::public.correction_schedules,
                to_jsonb(a) - 'archived_at' - 'archived_from_app' - 'archived_by' - 'archive_batch')).*
          FROM public.correction_schedules_archive a WHERE a.archive_batch = p_batch;
    GET DIAGNOSTICS n_sch = ROW_COUNT;
    DELETE FROM public.correction_schedules_archive WHERE archive_batch = p_batch;

    RETURN jsonb_build_object('user_id', v_uid, 'submissions', n_sub, 'deadline_extensions', n_ext,
                              'extension_requests', n_req, 'session_reminders', n_rem, 'schedules', n_sch);
END;
$$;

-- 수강 1 첨삭 제출 현황(관리창 표시용): 12세션 중 1차 제출이 있는 세션 수 등
CREATE OR REPLACE FUNCTION public.restart_correction_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT jsonb_build_object(
        'sessions_1_12', (SELECT count(DISTINCT session_number) FROM public.correction_submissions
                           WHERE user_id = p_user_id AND session_number BETWEEN 1 AND 12 AND draft_1_submitted_at IS NOT NULL),
        'sessions_13_24', (SELECT count(DISTINCT session_number) FROM public.correction_submissions
                           WHERE user_id = p_user_id AND session_number BETWEEN 13 AND 24 AND draft_1_submitted_at IS NOT NULL),
        'busy', (SELECT count(*) FROM public.correction_submissions
                  WHERE user_id = p_user_id AND status IN ('draft1_submitted','feedback1_processing','draft2_submitted','feedback2_processing')),
        'has_rows', EXISTS (SELECT 1 FROM public.correction_submissions WHERE user_id = p_user_id)
                 OR EXISTS (SELECT 1 FROM public.correction_schedules WHERE user_id = p_user_id),
        'archived_batches', (SELECT count(DISTINCT archive_batch) FROM public.correction_submissions_archive WHERE user_id = p_user_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.restart_correction_restore(uuid)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restart_correction_archive(uuid, uuid, text) TO anon, authenticated;   -- 관리자 화면이 anon 키(기존 관행)
GRANT  EXECUTE ON FUNCTION public.restart_correction_summary(uuid)            TO anon, authenticated;

-- ---------- 4) 계약서 종류 허용값 ----------
DO $ct$
DECLARE v_name text;
BEGIN
  SELECT c.conname INTO v_name
    FROM pg_constraint c
   WHERE c.conrelid = 'public.contracts'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%contract_type%'
   LIMIT 1;
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contracts DROP CONSTRAINT %I', v_name);
    EXECUTE format('ALTER TABLE public.contracts ADD CONSTRAINT %I CHECK (contract_type IN (''nevelup'',''correction'',''restart'',''restart_correction''))', v_name);
    RAISE NOTICE '[재시작 1단계] contracts.contract_type 제약 % 교체(restart 2종 허용)', v_name;
  ELSE
    RAISE NOTICE '[재시작 1단계] contracts.contract_type 에 CHECK 제약 없음 — 변경 없음';
  END IF;
END $ct$;

COMMIT;

-- =====================================================================
-- ROLLBACK (되돌리기 — 필요할 때만, 한 트랜잭션으로)
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.restart_correction_summary(uuid);
-- DROP FUNCTION IF EXISTS public.restart_correction_restore(uuid);
-- DROP FUNCTION IF EXISTS public.restart_correction_archive(uuid, uuid, text);
-- -- 보관 표에 줄이 있으면 먼저 restart_correction_restore 로 되돌린 뒤 지울 것
-- DROP TABLE IF EXISTS public.correction_schedules_archive, public.correction_session_reminders_archive,
--                      public.correction_extension_requests_archive, public.correction_deadline_extensions_archive,
--                      public.correction_submissions_archive;
-- ALTER TABLE public.tr_weekly_check_drafts DROP COLUMN IF EXISTS enrollment_id;
-- ALTER TABLE public.tr_deadline_extensions DROP COLUMN IF EXISTS enrollment_id;
-- ALTER TABLE public.aus_study_results     DROP COLUMN IF EXISTS enrollment_id;
-- ALTER TABLE public.study_results_v3      DROP COLUMN IF EXISTS enrollment_id;
-- ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_correction_mode_check;
-- ALTER TABLE public.applications
--   DROP COLUMN IF EXISTS enrollment_no, DROP COLUMN IF EXISTS restart_of, DROP COLUMN IF EXISTS superseded_by,
--   DROP COLUMN IF EXISTS restart_requested_at, DROP COLUMN IF EXISTS restart_allowed_at, DROP COLUMN IF EXISTS restart_allowed_by,
--   DROP COLUMN IF EXISTS restart_materials, DROP COLUMN IF EXISTS correction_mode;
-- -- contracts CHECK 제약은 원래 값 2개로 되돌리려면 같은 이름으로 재생성(원래 없었으면 생략)
-- COMMIT;
-- =====================================================================
