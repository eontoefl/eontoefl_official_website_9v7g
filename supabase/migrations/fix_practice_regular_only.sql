-- =====================================================================
-- 연습코스는 "일반 정규과정(regular)" 전용 — 호주 과정 제외
--
-- 문제:
--   auto_enable_practice_mode() 와 send_practice_open_alimtalk() 가
--   course_track 을 보지 않아, 호주 과정(course_track='australia') 학생까지
--   연습코스를 켜고 알림톡 대상으로 잡았다.
--   소급 실행에서 호주 3명(호주테스트/김호주/김규림)이 잘못 활성화됨.
--
-- 조치:
--   1) 두 함수에 course_track='australia' 제외 조건 추가
--   2) 잘못 켜진 호주 학생 원복 (알림톡은 아직 안 나갔으므로 조용히 되돌림)
--
-- 판별 기준:
--   course_track = 'australia' (관리자가 확정한 실제 배정 과정, add_course_track.sql)
--   NULL/'regular' 은 일반 과정으로 본다.
--
-- 2026-07-15
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 자동 활성화 함수 재정의 (호주 제외 조건 추가)
-- ---------------------------------------------------------------------
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
          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.
          AND COALESCE(a.course_track, 'regular') <> 'australia'
    ),
    scored AS (
        SELECT
            c.id,
            c.end_date,
            (SELECT count(*) FROM practice_final_tasks f
              WHERE f.program = c.program) AS required_cnt,
            (SELECT count(*)
               FROM practice_final_tasks f
               JOIN users u             ON u.email = c.email
               JOIN study_results_v3 r  ON r.user_id = u.id::text
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

-- ---------------------------------------------------------------------
-- 2. 발송 함수 재정의 (호주 제외 조건 추가 — 이중 안전)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_practice_open_alimtalk()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    v_count integer := 0;
    rec record;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN 0;
    END IF;

    IF (now() AT TIME ZONE 'Asia/Seoul')::time NOT BETWEEN '08:30' AND '22:00' THEN
        RETURN 0;
    END IF;

    FOR rec IN
        SELECT a.id, a.name, a.phone
        FROM applications a
        WHERE a.practice_enabled = true
          AND COALESCE(a.practice_alimtalk_sent, false) = false
          AND a.deposit_confirmed_by_admin = true
          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
          AND COALESCE(a.phone, '') <> ''
          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.
          AND COALESCE(a.course_track, 'regular') <> 'australia'
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        UPDATE applications
        SET practice_alimtalk_sent = true,
            practice_alimtalk_sent_at = now()
        WHERE id = rec.id;

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'practice_open',
                'data', jsonb_build_object(
                    'name',   COALESCE(rec.name, ''),
                    'phone',  rec.phone,
                    'app_id', rec.id
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );

        v_count := v_count + 1;
    END LOOP;

    IF v_count > 0 THEN
        RAISE NOTICE '[practice] 연습코스 오픈 알림톡 발송: %건', v_count;
    END IF;

    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. 잘못 켜진 호주 학생 원복
--    (알림톡은 아직 안 나갔으므로 조용히 되돌린다)
-- ---------------------------------------------------------------------
UPDATE applications
SET practice_enabled        = false,
    practice_enabled_at     = NULL,
    practice_enabled_source = NULL
WHERE COALESCE(course_track, 'regular') = 'australia'
  AND practice_enabled = true;

-- 확인용: 호주 트랙인데 아직 켜져 있는 학생 (0건이어야 정상)
-- SELECT name, course_track, practice_enabled
-- FROM applications
-- WHERE COALESCE(course_track,'regular') = 'australia' AND practice_enabled = true;
