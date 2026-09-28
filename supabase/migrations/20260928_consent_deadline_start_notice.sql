-- =====================================================================
-- 동의 기한·시작 안내 정리 (2026-09-28)
--   계획: C:\기능구현\프로모션 일반 직접 전환\IMPLEMENTATION_PLAN.md 2차 (E1·E5·E9)
--
-- 1) 리마인드 발송 시각 계산을 "몇 시간 전"을 받는 함수 하나로(밤 0~7시 회피 규칙은 그대로).
--    일반(2시간 전)은 결과 동일, 프로모션 동의 마감 리마인드만 6시간 전.
-- 2) 신청서의 첨삭 날짜가 바뀌면 테스트룸 첨삭 일정표(correction_schedules)의 같은 칸도 바뀜(바뀐 칸만).
-- 3) 시작 안내(내챌 50208 / 첨삭 50213)를 규칙 하나로:
--    입금 확인 + 삭제·환불·중단 아님 + 시작일이 오늘 또는 내일 + 시작 전날 10시 지남 + 그 시작일로 아직 안 보냄.
--    확인하는 때: 매일 10시(기존 cron 그대로) / 입금 확인될 때 / 시작일이 등록·바뀔 때.
--    "보냈음" 대신 "어느 시작일로 보냈는지"(start_notice_sent_for)를 기억 → 시작일이 바뀌면 자동으로 다시 대상.
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션).
--   ⚠️ 편집기가 "RLS" 경고를 띄우면 "Run without RLS"(쿼리 그대로 실행)를 고른다. "enable RLS"는 고르지 않는다.
-- 되돌리기: verification/2차/rollback.sql (C:\기능구현\프로모션 일반 직접 전환)
-- =====================================================================

BEGIN;

-- 0) 사전 검사: 바꿀 함수가 2026-09-28에 확인한 운영 정의 그대로일 때만 진행
DO $chk$
DECLARE v text;
BEGIN
  SELECT md5(pg_get_functiondef('public.reminder_effective_send_at(timestamptz)'::regprocedure)) INTO v;
  IF v <> '4d31ba48e7d7fdccddbb1071d9f788f3' THEN RAISE EXCEPTION 'ABORT reminder_effective_send_at 정의가 다름 %', v; END IF;
  SELECT md5(pg_get_functiondef('public.process_incentive_deadline_warnings()'::regprocedure)) INTO v;
  IF v <> 'd020f84cd27e44fc2e3a9ecc0869f99e' THEN RAISE EXCEPTION 'ABORT process_incentive_deadline_warnings 정의가 다름 %', v; END IF;
  SELECT md5(pg_get_functiondef('public.send_challenge_d1_alimtalk()'::regprocedure)) INTO v;
  IF v <> '5d94aa26d0bee82eec68ee0a4acb5cd2' THEN RAISE EXCEPTION 'ABORT send_challenge_d1_alimtalk 정의가 다름 %', v; END IF;
  SELECT md5(pg_get_functiondef('public.send_correction_d1_alimtalk()'::regprocedure)) INTO v;
  IF v <> 'cb42259e38af8a8f7f30858db1dc22f1' THEN RAISE EXCEPTION 'ABORT send_correction_d1_alimtalk 정의가 다름 %', v; END IF;
  SELECT md5(pg_get_functiondef('public.trg_correction_schedule_late_notify()'::regprocedure)) INTO v;
  IF v <> '0eada74cb9c97f2e6df7e6c5ea035c2d' THEN RAISE EXCEPTION 'ABORT trg_correction_schedule_late_notify 정의가 다름 %', v; END IF;
END $chk$;

-- ---------------------------------------------------------------------
-- 1) 리마인드 발송 시각
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reminder_send_at(p_deadline timestamptz, p_lead interval)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ideal         timestamptz := p_deadline - p_lead;
    v_ideal_hour    int  := extract(hour from (v_ideal AT TIME ZONE 'Asia/Seoul'))::int;
    v_deadline_hour int  := extract(hour from (p_deadline AT TIME ZONE 'Asia/Seoul'))::int;
    v_deadline_date date := (p_deadline AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
    -- 이상 발송 시각이 밤(0~7시)이면: 마감이 7시 이후면 그날 07:00, 아니면 전날 23:00
    IF v_ideal_hour >= 7 THEN
        RETURN v_ideal;
    ELSIF v_deadline_hour >= 7 THEN
        RETURN (v_deadline_date::text || ' 07:00')::timestamp AT TIME ZONE 'Asia/Seoul';
    ELSE
        RETURN ((v_deadline_date - 1)::text || ' 23:00')::timestamp AT TIME ZONE 'Asia/Seoul';
    END IF;
END;
$$;

-- 일반 리마인드(개별분석·계약·입금)가 쓰는 2시간 전 — 결과는 이전과 동일
CREATE OR REPLACE FUNCTION public.reminder_effective_send_at(p_deadline timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$ SELECT public.reminder_send_at(p_deadline, interval '2 hours') $$;

-- 프로모션 동의 마감 리마인드(50215): 마감 6시간 전. 나머지는 2026-09-15 정의 그대로.
CREATE OR REPLACE FUNCTION public.process_incentive_deadline_warnings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key    text;
    v_edge_url       text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    v_now_hour       int;
    rec              record;
    v_deadline       timestamptz;
    v_time           text;
    v_deadline_label text;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- 일반용과 같은 방해금지 안전장치 (KST 00~07시 미발송)
    v_now_hour := extract(hour from (now() AT TIME ZONE 'Asia/Seoul'))::int;
    IF v_now_hour < 7 THEN
        RETURN;
    END IF;

    FOR rec IN
        SELECT a.id, a.name, a.phone,
               COALESCE(a.analysis_deadline_override,
                        to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '120 hours') AS deadline
        FROM applications a
        WHERE a.is_incentive_applicant = true
          AND a.analysis_status = '승인'
          AND (a.student_agreed_at IS NULL OR a.student_agreed_at = '')
          AND a.analysis_first_saved_at IS NOT NULL
          AND a.phone IS NOT NULL AND a.phone <> ''
          AND now() >= reminder_send_at(
                          COALESCE(a.analysis_deadline_override,
                                   to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '120 hours'),
                          interval '6 hours')
          AND now() <  COALESCE(a.analysis_deadline_override,
                                to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '120 hours')
          AND (a.incentive_warning_sent_at IS NULL
               OR (a.analysis_deadline_override IS NOT NULL
                   AND a.incentive_warning_sent_at < a.analysis_deadline_override - interval '24 hours'))
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        UPDATE applications SET incentive_warning_sent_at = now() WHERE id = rec.id;

        v_deadline       := rec.deadline;
        v_time           := ceil(extract(epoch from (v_deadline - now())) / 3600.0)::int::text;
        v_deadline_label := to_char(v_deadline AT TIME ZONE 'Asia/Seoul', 'MM월 DD일 HH24:MI');

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'incentive_deadline_warning',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'time', v_time,
                    'deadline', v_deadline_label
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 2) 신청서 첨삭 날짜 → 첨삭 일정표 동기화 (바뀐 칸만)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_applications_sync_correction_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid        uuid;
    v_start_chg  boolean;
    v_end_chg    boolean;
    v_xstart_chg boolean;
    v_xend_chg   boolean;
BEGIN
    IF NEW.application_type IS DISTINCT FROM 'challenge'
       OR NEW.correction_enabled IS NOT TRUE
       OR NEW.deleted IS TRUE
       OR NEW.user_id IS NULL
       OR NEW.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN NULL;
    END IF;
    v_uid := NEW.user_id::uuid;

    -- 시작일은 NOT NULL 칸이라 올바른 날짜로 바뀐 경우만 복사
    v_start_chg  := NEW.correction_start_date IS DISTINCT FROM OLD.correction_start_date
                    AND NEW.correction_start_date ~ '^\d{4}-\d{2}-\d{2}$';
    v_end_chg    := NEW.correction_end_date IS DISTINCT FROM OLD.correction_end_date;
    v_xstart_chg := NEW.extension_start_date IS DISTINCT FROM OLD.extension_start_date;
    v_xend_chg   := NEW.extension_end_date IS DISTINCT FROM OLD.extension_end_date;

    IF NOT (v_start_chg OR v_end_chg OR v_xstart_chg OR v_xend_chg) THEN
        RETURN NULL;
    END IF;

    UPDATE correction_schedules cs
    SET start_date           = CASE WHEN v_start_chg  THEN NEW.correction_start_date::date ELSE cs.start_date END,
        end_date             = CASE WHEN v_end_chg    THEN NEW.correction_end_date        ELSE cs.end_date END,
        extension_start_date = CASE WHEN v_xstart_chg THEN NEW.extension_start_date       ELSE cs.extension_start_date END,
        extension_end_date   = CASE WHEN v_xend_chg   THEN NEW.extension_end_date         ELSE cs.extension_end_date END
    WHERE cs.user_id = v_uid
      AND (cs.start_date, cs.end_date, cs.extension_start_date, cs.extension_end_date) IS DISTINCT FROM
          (CASE WHEN v_start_chg  THEN NEW.correction_start_date::date ELSE cs.start_date END,
           CASE WHEN v_end_chg    THEN NEW.correction_end_date        ELSE cs.end_date END,
           CASE WHEN v_xstart_chg THEN NEW.extension_start_date       ELSE cs.extension_start_date END,
           CASE WHEN v_xend_chg   THEN NEW.extension_end_date         ELSE cs.extension_end_date END);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS applications_sync_correction_schedule ON public.applications;
CREATE TRIGGER applications_sync_correction_schedule
    AFTER UPDATE OF correction_start_date, correction_end_date, extension_start_date, extension_end_date
    ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.trg_applications_sync_correction_schedule();

-- ---------------------------------------------------------------------
-- 3) 시작 안내 규칙 하나
-- ---------------------------------------------------------------------
ALTER TABLE public.applications         ADD COLUMN IF NOT EXISTS start_notice_sent_for date;
ALTER TABLE public.correction_schedules ADD COLUMN IF NOT EXISTS start_notice_sent_for date;
COMMENT ON COLUMN public.applications.start_notice_sent_for IS '내챌 시작 안내(50208)를 보낸 시작일. 현재 schedule_start와 다르면 다시 보낼 대상.';
COMMENT ON COLUMN public.correction_schedules.start_notice_sent_for IS '첨삭 시작 안내(50213)를 보낸 시작일. 현재 start_date와 다르면 다시 보낼 대상.';

-- 이미 보낸 학생은 지금 시작일로 보낸 것으로 기록(적용 직후 중복 발송 방지)
UPDATE public.applications
   SET start_notice_sent_for = schedule_start::date
 WHERE kakaotalk_d1_sent IS TRUE
   AND start_notice_sent_for IS NULL
   AND schedule_start ~ '^\d{4}-\d{2}-\d{2}$';
UPDATE public.correction_schedules
   SET start_notice_sent_for = start_date
 WHERE kakaotalk_d1_sent IS TRUE
   AND start_notice_sent_for IS NULL;

-- p_kind: 'challenge' | 'correction' | NULL(둘 다). p_app_id·p_user_id로 한 학생만 볼 수 있음.
CREATE OR REPLACE FUNCTION public.process_start_notices(
    p_kind    text DEFAULT NULL,
    p_app_id  uuid DEFAULT NULL,
    p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
    v_today   date      := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_url     text;
    v_key     text;
    r         record;
    v_n       integer := 0;
BEGIN
    -- 밤 0~7시에는 보내지 않는다(매일 10시 확인이 이어받음)
    IF extract(hour from v_now_kst) < 7 THEN
        RETURN 0;
    END IF;

    v_url := get_supabase_url();
    v_key := get_service_role_key();

    -- 내챌 시작 안내 (50208)
    IF p_kind IS NULL OR p_kind = 'challenge' THEN
        FOR r IN
            SELECT a.id, a.name, a.phone, a.assigned_program, a.schedule_start, x.sd
            FROM applications a
            -- 날짜 모양이 아닌 시작일은 NULL로(형변환 오류로 전체가 멈추지 않게)
            CROSS JOIN LATERAL (
                SELECT CASE WHEN a.schedule_start ~ '^\d{4}-\d{2}-\d{2}$'
                            THEN a.schedule_start::date END AS sd
            ) x
            WHERE (p_app_id IS NULL OR a.id = p_app_id)
              AND a.application_type = 'challenge'
              AND a.deposit_confirmed_by_admin IS TRUE
              AND a.deleted IS NOT TRUE
              AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
              AND x.sd IN (v_today, v_today + 1)
              AND v_now_kst >= (x.sd - 1) + time '10:00'
              AND a.start_notice_sent_for IS DISTINCT FROM x.sd
            FOR UPDATE OF a SKIP LOCKED
        LOOP
            UPDATE applications
               SET start_notice_sent_for = r.sd,
                   kakaotalk_d1_sent = true,
                   kakaotalk_d1_sent_at = now()
             WHERE id = r.id;
            IF COALESCE(r.phone, '') <> '' THEN
                PERFORM net.http_post(
                    url := v_url || '/functions/v1/kakaotalk-notify',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_key),
                    body := jsonb_build_object(
                        'type', 'challenge_reminder',
                        'data', jsonb_build_object(
                            'name', r.name,
                            'phone', r.phone,
                            'program', COALESCE(r.assigned_program, ''),
                            'start_date', COALESCE(r.schedule_start, ''),
                            'app_id', r.id::text)));
            END IF;
            v_n := v_n + 1;
        END LOOP;
    END IF;

    -- 첨삭 시작 안내 (50213): 기준 = 첨삭 일정표 시작일, 수신 조건 = 회차 당일 알림과 같은 신청서 조건
    IF p_kind IS NULL OR p_kind = 'correction' THEN
        FOR r IN
            SELECT cs.id AS schedule_id, cs.start_date, u.name, u.phone,
                   COALESCE(ap.assigned_program, ap.preferred_program, '') AS program
            FROM correction_schedules cs
            JOIN users u ON u.id = cs.user_id
            JOIN LATERAL (
                SELECT a.assigned_program, a.preferred_program
                FROM applications a
                WHERE a.user_id = cs.user_id::text
                  AND (p_app_id IS NULL OR a.id = p_app_id)
                  AND a.application_type = 'challenge'
                  AND a.correction_enabled IS TRUE
                  AND a.deposit_confirmed_by_admin IS TRUE
                  AND a.deleted IS NOT TRUE
                  AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
                ORDER BY a.created_at DESC NULLS LAST
                LIMIT 1
            ) ap ON true
            WHERE (p_user_id IS NULL OR cs.user_id = p_user_id)
              AND cs.start_date IN (v_today, v_today + 1)
              AND v_now_kst >= (cs.start_date - 1) + time '10:00'
              AND cs.start_notice_sent_for IS DISTINCT FROM cs.start_date
            FOR UPDATE OF cs SKIP LOCKED
        LOOP
            UPDATE correction_schedules
               SET start_notice_sent_for = r.start_date,
                   kakaotalk_d1_sent = true,
                   kakaotalk_d1_sent_at = now()
             WHERE id = r.schedule_id;
            IF COALESCE(r.phone, '') <> '' THEN
                PERFORM net.http_post(
                    url := v_url || '/functions/v1/kakaotalk-notify',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_key),
                    body := jsonb_build_object(
                        'type', 'correction_start_reminder',
                        'data', jsonb_build_object(
                            'name', COALESCE(r.name, ''),
                            'phone', r.phone,
                            'program', r.program,
                            'start_date', r.start_date::text)));
            END IF;
            v_n := v_n + 1;
        END LOOP;
    END IF;

    RETURN v_n;
END;
$$;

-- 매일 10시 cron(기존 잡 이름·일정 그대로): 같은 규칙 호출
CREATE OR REPLACE FUNCTION public.send_challenge_d1_alimtalk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN PERFORM process_start_notices('challenge'); END; $$;

CREATE OR REPLACE FUNCTION public.send_correction_d1_alimtalk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN PERFORM process_start_notices('correction'); END; $$;

-- 첨삭 일정표가 등록되거나 시작일이 바뀔 때(기존 트리거 correction_schedule_late_notify 그대로 사용)
CREATE OR REPLACE FUNCTION public.trg_correction_schedule_late_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ BEGIN PERFORM process_start_notices('correction', NULL, NEW.user_id); RETURN NULL; END; $$;

-- 입금 확인되거나 내챌 시작일이 바뀔 때
CREATE OR REPLACE FUNCTION public.trg_applications_start_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM process_start_notices(NULL, NEW.id, NULL);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS applications_start_notice ON public.applications;
CREATE TRIGGER applications_start_notice
    AFTER UPDATE OF deposit_confirmed_by_admin, schedule_start
    ON public.applications
    FOR EACH ROW
    WHEN (NEW.deposit_confirmed_by_admin IS TRUE)
    EXECUTE FUNCTION public.trg_applications_start_notice();

-- 브라우저(anon)에서 직접 부르지 못하게(트리거·cron은 소유자 권한으로 실행)
REVOKE EXECUTE ON FUNCTION public.process_start_notices(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 적용 후 확인
SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS md5
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('reminder_send_at','reminder_effective_send_at','process_incentive_deadline_warnings',
                    'trg_applications_sync_correction_schedule','process_start_notices','send_challenge_d1_alimtalk',
                    'send_correction_d1_alimtalk','trg_correction_schedule_late_notify','trg_applications_start_notice')
ORDER BY 1;

COMMIT;
