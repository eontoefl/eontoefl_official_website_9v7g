-- =====================================================================
-- 일시정지 2단계 — 2부: 기존 자동작업 7개에 정지 가드 + 새 cron + 날 작업(jobid 1) 삭제 (2026-10-06)
--   ⚠️ 이 파일은 supabase/tests/gen_schedule_pause_guards.mjs 가 레포 원문에서 생성한다. 직접 고치지 말 것.
--   선행: 20261006_schedule_pause_1_core.sql (is_paused·pause_adjusted_date·correction_release_blocked)
--   동작 변경: 정지 이력이 있는 학생만 건너뛴다. 정지 이력이 없는 학생에게는 결과가 같다.
--   사전 검사: 2026-10-06 라이브 본문(prosrc) md5 와 같을 때만 진행 — 다르면 그 사이 라이브가 바뀐 것이므로 중단.
--   실행: Supabase SQL Editor 전체 실행(한 트랜잭션), "Run without RLS".
-- =====================================================================

BEGIN;

DO $chk$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_paused') THEN
    RAISE EXCEPTION 'ABORT 1부(…_1_core.sql)가 먼저 적용돼야 함';
  END IF;

  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='preview_correction_session_reminders';
  IF v IS DISTINCT FROM 'de1ce8ea674e63c5ada893d81f3382d5' THEN RAISE EXCEPTION 'ABORT preview_correction_session_reminders 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_start_notices';
  IF v IS DISTINCT FROM '893549fb6707c74e15f598ad9b1f9867' THEN RAISE EXCEPTION 'ABORT process_start_notices 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_auto_approve_corrections';
  IF v IS DISTINCT FROM '127f062d0d90c9bc46f0409f9bb2ec5a' THEN RAISE EXCEPTION 'ABORT process_auto_approve_corrections 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_scheduled_releases';
  IF v IS DISTINCT FROM '04a9a1891cf72bd8d4ac6d7fff0f87c4' THEN RAISE EXCEPTION 'ABORT process_scheduled_releases 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_auto_retry_corrections';
  IF v IS DISTINCT FROM 'ebef8f015823b48c5de874412e8a05bc' THEN RAISE EXCEPTION 'ABORT process_auto_retry_corrections 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='auto_enable_practice_mode';
  IF v IS DISTINCT FROM '28934107d9e2aa04f4b5262144ed500f' THEN RAISE EXCEPTION 'ABORT auto_enable_practice_mode 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='send_practice_open_alimtalk';
  IF v IS DISTINCT FROM '47a4eace5631d99c3a7ff2e073a8d714' THEN RAISE EXCEPTION 'ABORT send_practice_open_alimtalk 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;
END $chk$;

-- ---------- 1. 첨삭 회차 당일 알림(50244) 미리보기: 정지 중 건너뜀 + 오프셋 날짜 보정 ----------
CREATE OR REPLACE FUNCTION public.preview_correction_session_reminders(
    p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
    user_id        uuid,
    student_name   text,
    phone          text,
    timezone       text,
    local_now      timestamp,
    session_number int,
    tasks          text,
    deadline_text  text,
    deadline_at    timestamptz,
    track          text,
    reason         text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    -- 세션 1~12 의 시작일 기준 오프셋(일). 연장 13~24 도 extension_start_date 기준으로 같은 표를 쓴다.
    -- 원본: 테스트룸 js/correction-schedule-data.js (dayOffset). 바뀌면 여기도 같이 고친다.
    c_offset  CONSTANT int[]  := ARRAY[0,2,4,7,9,11,14,16,18,21,23,25];

    -- extract(dow) 0=일요일
    c_dow_kr  CONSTANT text[] := ARRAY['일','월','화','수','목','금','토'];

    -- 호주첨삭 1~12 과제 라벨 (스피킹이 앞). 원본: 테스트룸 js/correction-schedule-data-aus.js
    -- AUS_CORR_TYPES.label + js/correction/correction-main.js 카드 순서. 바뀌면 여기도 같이 고친다.
    c_aus     CONSTANT text[] := ARRAY[
        'IND SPK + DISCUSSION',   -- 1
        'INT SPK 2 + INT WRT',    -- 2
        'INT SPK 3 + DISCUSSION', -- 3
        'INT SPK 4 + INT WRT',    -- 4
        'IND SPK + DISCUSSION',   -- 5
        'INT SPK 2 + INT WRT',    -- 6
        'INT SPK 3 + DISCUSSION', -- 7
        'INT SPK 4 + INT WRT',    -- 8
        'IND SPK + DISCUSSION',   -- 9
        'INT SPK 2 + INT WRT',    -- 10
        'INT SPK 3 + DISCUSSION', -- 11
        'INT SPK 4 + INT WRT'     -- 12
    ];

    r           record;
    v_tz        text;
    v_local     timestamp;
    v_today     date;
    v_dates     date[];
    v_ext_dates date[];
    v_n         int;
    v_idx       int;
    v_date      date;
    v_reason    text;
    v_tasks     text;
    v_base      timestamptz;
    v_deadline  timestamptz;
    v_task_dl   timestamptz;
    v_cat       text;
    v_ext_hours numeric;
    v_ext_at    timestamptz;
    v_local_dl  timestamp;
BEGIN
    FOR r IN
        SELECT
            cs.user_id                            AS uid,
            COALESCE(u.name, '')                  AS student_name,
            u.phone                               AS phone,
            -- pg_timezone_names 에 없는 문자열(오타 등)이면 NULL → 아래에서 'Asia/Seoul' 로 대체.
            -- 이렇게 걸러야 잘못된 타임존 한 명 때문에 함수 전체가 죽지 않는다.
            tzn.name                              AS valid_tz,
            ap.app_id                             AS app_id,
            CASE WHEN COALESCE(ap.assigned_program, ap.preferred_program, '') LIKE '%Australia%'
                 THEN 'aus' ELSE 'general' END    AS track,
            cs.start_date                         AS start_date,
            cs.end_date                           AS end_date,
            cs.session_dates                      AS session_dates,
            COALESCE(cs.extension_enabled, false) AS extension_enabled,
            cs.extension_start_date               AS extension_start_date,
            cs.extension_end_date                 AS extension_end_date,
            cs.extension_session_dates            AS extension_session_dates
        FROM public.correction_schedules cs
        JOIN public.users u
          ON u.id = cs.user_id
        LEFT JOIN pg_catalog.pg_timezone_names tzn
          ON tzn.name = u.timezone
        -- 첨삭이 켜져 있고 입금 확인된, 삭제되지 않은 신청서가 "있는" 학생만 (INNER JOIN).
        -- 여러 건이면 가장 최근 신청서 하나로 트랙을 판정한다.
        -- ⚠️ applications.user_id 는 text, correction_schedules.user_id 는 uuid 다(라이브 확인 2026-09-16).
        --    ::text 캐스팅을 빼면 "operator does not exist: text = uuid" 로 함수 전체가 죽는다.
        JOIN LATERAL (
            SELECT a.id AS app_id, a.assigned_program, a.preferred_program
            FROM public.applications a
            WHERE a.user_id = cs.user_id::text
              AND a.correction_enabled = true
              AND a.deposit_confirmed_by_admin = true
              AND a.deleted IS NOT TRUE
            ORDER BY a.created_at DESC NULLS LAST, a.id
            LIMIT 1
        ) ap ON true
        WHERE u.phone IS NOT NULL
          AND btrim(u.phone) <> ''
    LOOP
        v_tz    := COALESCE(r.valid_tz, 'Asia/Seoul');
        v_local := p_at AT TIME ZONE v_tz;

        -- 발송 창 밖(현지 21:00~08:59)이면 이 학생은 통째로 건너뛴다.
        IF extract(hour FROM v_local) < 9 OR extract(hour FROM v_local) > 20 THEN
            CONTINUE;
        END IF;

        v_today := v_local::date;

        -- [일시정지] 첨삭 정지 중인 학생은 통째로 건너뛴다(정지 전 1차를 낸 회차는 알림 대상이 아니므로 여기서 가드해도 R3와 충돌 없음)
        IF public.is_paused(r.app_id, 'correction', v_today) THEN
            CONTINUE;
        END IF;

        -- 자기주도 확정 일정표(JSON 텍스트) 파싱. 깨져 있거나 12개가 아니면 NULL 로 두고
        -- 그 학생의 1~12 는 이번 실행에서 건너뛴다. (서버가 날짜를 계산·생성·저장하지 않는다.)
        v_dates := NULL;
        BEGIN
            SELECT array_agg(d.v::date ORDER BY d.ord)
              INTO v_dates
              FROM jsonb_array_elements_text((r.session_dates)::jsonb -> 'dates')
                   WITH ORDINALITY AS d(v, ord);
        EXCEPTION WHEN others THEN
            v_dates := NULL;
        END;
        IF COALESCE(array_length(v_dates, 1), 0) <> 12 THEN
            v_dates := NULL;
        END IF;

        v_ext_dates := NULL;
        BEGIN
            SELECT array_agg(d.v::date ORDER BY d.ord)
              INTO v_ext_dates
              FROM jsonb_array_elements_text((r.extension_session_dates)::jsonb -> 'dates')
                   WITH ORDINALITY AS d(v, ord);
        EXCEPTION WHEN others THEN
            v_ext_dates := NULL;
        END;
        IF COALESCE(array_length(v_ext_dates, 1), 0) <> 12 THEN
            v_ext_dates := NULL;
        END IF;

        FOR v_n IN 1..24 LOOP
            v_date   := NULL;
            v_reason := NULL;

            IF v_n <= 12 THEN
                v_idx := v_n;
                IF r.track = 'general' AND r.end_date IS NOT NULL THEN
                    -- 자기주도(종료일 지정형). 호주는 종료일이 있어도 자기주도가 아니다.
                    IF v_dates IS NOT NULL THEN
                        v_date   := v_dates[v_idx];
                        v_reason := 'selfpaced dates[' || (v_n - 1) || ']';
                    END IF;
                ELSIF r.start_date IS NOT NULL THEN
                    -- 정규·호주: 시작일 + 오프셋
                    v_date   := public.pause_adjusted_date(r.app_id, 'correction', r.start_date + c_offset[v_idx]);   -- [일시정지] 정지 기간 건너뛰기
                    v_reason := 'regular offset ' || c_offset[v_idx];
                END IF;
            ELSE
                -- 연장 13~24 는 일반 트랙만. 호주첨삭은 연장 자체가 없다.
                IF r.track = 'general' AND r.extension_enabled THEN
                    v_idx := v_n - 12;
                    IF r.extension_end_date IS NOT NULL THEN
                        IF v_ext_dates IS NOT NULL THEN
                            v_date   := v_ext_dates[v_idx];
                            v_reason := 'ext dates[' || (v_n - 13) || ']';
                        END IF;
                    ELSIF r.extension_start_date IS NOT NULL THEN
                        v_date   := public.pause_adjusted_date(r.app_id, 'correction', r.extension_start_date + c_offset[v_idx]);   -- [일시정지]
                        v_reason := 'ext offset ' || c_offset[v_idx];
                    END IF;
                END IF;
            END IF;

            -- 오늘(학생 현지 날짜)에 배정된 세션만
            IF v_date IS NULL OR v_date <> v_today THEN
                CONTINUE;
            END IF;

            -- 이미 보낸 (학생, 세션) 은 건너뛴다
            IF EXISTS (
                SELECT 1 FROM public.correction_session_reminders cr
                 WHERE cr.user_id = r.uid
                   AND cr.session_number = v_n
            ) THEN
                CONTINUE;
            END IF;

            -- 기본 1차 마감 = 배정일 다음날 04:00 (학생 시간대)
            v_base     := (v_date + 1 + time '04:00') AT TIME ZONE v_tz;
            v_deadline := NULL;

            -- 아직 1차를 안 낸 과제들의 실제 마감 중 가장 이른 것을 알림톡에 넣는다.
            FOREACH v_cat IN ARRAY ARRAY['writing','speaking'] LOOP
                IF EXISTS (
                    SELECT 1 FROM public.correction_submissions s
                     WHERE s.user_id = r.uid
                       AND s.session_number = v_n
                       AND s.task_type LIKE v_cat || '%'
                       AND s.draft_1_submitted_at IS NOT NULL
                ) THEN
                    CONTINUE;   -- 이 과제는 이미 제출 완료 → 마감 후보 아님
                END IF;

                -- 1차에 걸린 연장 중 가장 늦게 등록된 행 하나
                -- (draft_round = 1 → 1차만, NULL → 1·2차 둘 다인 옛 행)
                v_ext_hours := NULL;
                v_ext_at    := NULL;
                SELECT e.extended_hours::numeric, e.created_at
                  INTO v_ext_hours, v_ext_at
                  FROM public.correction_deadline_extensions e
                 WHERE e.user_id = r.uid
                   AND e.session_number = v_n
                   AND e.task_type LIKE v_cat || '%'
                   AND (e.draft_round = 1 OR e.draft_round IS NULL)
                 ORDER BY e.created_at DESC NULLS LAST
                 LIMIT 1;

                v_task_dl := v_base;
                IF v_ext_hours IS NOT NULL AND v_ext_hours > 0 THEN
                    -- 마감 전 연장 → 기본마감 + N시간 / 마감 후 연장 → 연장 건 시각 + N시간
                    v_task_dl := greatest(v_base, COALESCE(v_ext_at, v_base))
                                 + (v_ext_hours * interval '1 hour');
                END IF;

                IF v_deadline IS NULL OR v_task_dl < v_deadline THEN
                    v_deadline := v_task_dl;
                END IF;
            END LOOP;

            -- writing·speaking 둘 다 1차 제출 완료 → 안내할 마감이 없다 → 보내지 않는다
            IF v_deadline IS NULL THEN
                CONTINUE;
            END IF;

            -- 과제 라벨
            IF r.track = 'aus' THEN
                v_tasks := c_aus[v_n];                    -- 호주는 위에서 1~12 로만 걸러진다
            ELSIF v_n % 2 = 1 THEN
                v_tasks := 'Email + Interview';           -- 홀수 세션
            ELSE
                v_tasks := 'Discussion + Interview';      -- 짝수 세션
            END IF;

            v_local_dl := v_deadline AT TIME ZONE v_tz;

            RETURN QUERY SELECT
                r.uid,
                r.student_name,
                r.phone,
                v_tz,
                v_local,
                v_n,
                v_tasks,
                to_char(v_local_dl, 'FMMM/FMDD')
                    || '(' || c_dow_kr[extract(dow FROM v_local_dl)::int + 1] || ') '
                    || to_char(v_local_dl, 'HH24:MI'),
                v_deadline,
                r.track,
                v_reason;
        END LOOP;
    END LOOP;
END;
$$;

-- ---------- 2. 시작 안내(50208·50213): 정지 중 제외 ----------
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
              AND NOT public.is_paused(a.id, 'challenge', v_today)   -- [일시정지]
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
                  AND NOT public.is_paused(a.id, 'correction', v_today)   -- [일시정지]
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

-- ---------- 3. 첨삭 자동 공개(5시간): 정지 중 보류(진행 중 회차 예외) ----------
CREATE OR REPLACE FUNCTION process_auto_approve_corrections()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_alim_type text;
    v_task_label text;
    v_round_str text;
BEGIN
    -- Vault에서 service_role_key 조회
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- 5시간 경과 + 미승인 + 수동 예약 없는 건 조회
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.phone AS student_phone
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.scheduled_release_at IS NULL
          AND NOT public.correction_release_blocked(cs.user_id, cs.draft_1_submitted_at)   -- [일시정지] 정지 전 1차 제출 회차는 통과(R3)
          AND (
              -- 케이스 A: 1차 피드백 존재 + 미승인 + 5시간 경과
              (
                  cs.feedback_1 IS NOT NULL
                  AND cs.released_1 = false
                  AND cs.feedback_1_at IS NOT NULL
                  AND cs.feedback_1_at <= (now() - interval '5 hours')
              )
              OR
              -- 케이스 B: 2차 피드백 존재 + 1차는 이미 승인 + 2차 미승인 + 5시간 경과
              (
                  cs.feedback_2 IS NOT NULL
                  AND cs.released_1 = true
                  AND cs.released_2 = false
                  AND cs.feedback_2_at IS NOT NULL
                  AND cs.feedback_2_at <= (now() - interval '5 hours')
              )
          )
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        -- 알림톡 유형 결정 + released 플래그 업데이트
        IF rec.feedback_1 IS NOT NULL AND rec.released_1 = false THEN
            v_alim_type := 'correction_feedback_1';
            UPDATE correction_submissions
            SET released_1 = true,
                released_1_at = now()
            WHERE id = rec.id;
        ELSIF rec.feedback_2 IS NOT NULL AND rec.released_1 = true AND rec.released_2 = false THEN
            v_alim_type := 'correction_feedback_2';
            UPDATE correction_submissions
            SET released_2 = true,
                released_2_at = now()
            WHERE id = rec.id;
        ELSE
            CONTINUE;
        END IF;

        -- task_type → 라벨
        --   일반첨삭 3종 + 호주첨삭 6종. 학원에서 쓰는 용어 그대로 학생에게 보낸다.
        CASE rec.task_type
            WHEN 'writing_email'            THEN v_task_label := 'Email';
            WHEN 'writing_discussion'       THEN v_task_label := 'Discussion';
            WHEN 'speaking_interview'       THEN v_task_label := 'Interview';
            -- 호주첨삭
            WHEN 'writing_aus_discussion'   THEN v_task_label := '토라';
            WHEN 'writing_aus_integrated'   THEN v_task_label := '통라';
            WHEN 'speaking_aus_independent' THEN v_task_label := '독스';
            WHEN 'speaking_aus_int2'        THEN v_task_label := '통스2';
            WHEN 'speaking_aus_int3'        THEN v_task_label := '통스3';
            WHEN 'speaking_aus_int4'        THEN v_task_label := '통스4';
            ELSE v_task_label := rec.task_type;
        END CASE;

        v_round_str := COALESCE(rec.session_number::text, '') || '회 ' || v_task_label;

        -- 알림톡 발송 (전화번호가 있는 경우만)
        IF rec.student_phone IS NOT NULL AND rec.student_phone != '' THEN
            PERFORM net.http_post(
                url := v_edge_url,
                body := jsonb_build_object(
                    'type', v_alim_type,
                    'data', jsonb_build_object(
                        'name', COALESCE(rec.student_name, ''),
                        'phone', rec.student_phone,
                        'round', v_round_str
                    )
                ),
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_service_key
                )
            );
        END IF;
    END LOOP;
END;
$$;

-- ---------- 4. 첨삭 예약 공개: 정지 중 보류(진행 중 회차 예외) ----------
CREATE OR REPLACE FUNCTION process_scheduled_releases()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_alim_type text;
    v_task_label text;
    v_round_str text;
BEGIN
    -- Vault에서 service_role_key 조회
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- 예약 시각이 도래한 건 조회
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.phone AS student_phone
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.scheduled_release_at IS NOT NULL
          AND NOT public.correction_release_blocked(cs.user_id, cs.draft_1_submitted_at)   -- [일시정지]
          AND cs.scheduled_release_at <= now()
          AND (
              (cs.feedback_1 IS NOT NULL AND cs.released_1 = false)
              OR (cs.feedback_2 IS NOT NULL AND cs.released_2 = false)
          )
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        -- 알림톡 유형 결정 + released 플래그 업데이트
        IF rec.feedback_1 IS NOT NULL AND rec.released_1 = false THEN
            v_alim_type := 'correction_feedback_1';
            UPDATE correction_submissions
            SET released_1 = true,
                released_1_at = now(),
                scheduled_release_at = NULL
            WHERE id = rec.id;
        ELSIF rec.feedback_2 IS NOT NULL AND rec.released_2 = false THEN
            v_alim_type := 'correction_feedback_2';
            UPDATE correction_submissions
            SET released_2 = true,
                released_2_at = now(),
                scheduled_release_at = NULL
            WHERE id = rec.id;
        ELSE
            CONTINUE;
        END IF;

        -- task_type → 사람이 읽을 수 있는 라벨
        CASE rec.task_type
            WHEN 'writing_email' THEN v_task_label := 'Email';
            WHEN 'writing_discussion' THEN v_task_label := 'Discussion';
            WHEN 'speaking_interview' THEN v_task_label := 'Interview';
            ELSE v_task_label := rec.task_type;
        END CASE;

        v_round_str := COALESCE(rec.session_number::text, '') || '회 ' || v_task_label;

        -- 알림톡 발송 (전화번호가 있는 경우만)
        IF rec.student_phone IS NOT NULL AND rec.student_phone != '' THEN
            PERFORM net.http_post(
                url := v_edge_url,
                body := jsonb_build_object(
                    'type', v_alim_type,
                    'data', jsonb_build_object(
                        'name', COALESCE(rec.student_name, ''),
                        'phone', rec.student_phone,
                        'round', v_round_str
                    )
                ),
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_service_key
                )
            );
        END IF;
    END LOOP;
END;
$$;

-- ---------- 5. 첨삭 자동 재실행: 정지 중 보류(진행 중 회차 예외) ----------
CREATE OR REPLACE FUNCTION process_auto_retry_corrections()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_tg_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/telegram-notify';
    v_n8n_base text := 'https://eontoefl.app.n8n.cloud/webhook';
    v_max_retries int := 2;
    v_failed_delay interval := interval '3 minutes';
    v_stuck_delay  interval := interval '15 minutes';
    rec record;
    v_is_draft1 boolean;
    v_is_failed boolean;
    v_feedback_present boolean;
    v_submitted_at timestamptz;
    v_base_at timestamptz;
    v_needed interval;
    v_webhook text;
    v_event text;
    v_draft_round int;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- ===== 1) 자동 재실행 =====
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.email AS student_email
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.auto_retry_count < v_max_retries
          AND cs.status IN ('feedback1_failed','feedback2_failed','draft1_submitted','draft2_submitted')
          AND NOT public.correction_release_blocked(cs.user_id, cs.draft_1_submitted_at)   -- [일시정지] 재채점도 정지 중 보류
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        v_is_draft1 := rec.status IN ('feedback1_failed','draft1_submitted');
        v_is_failed := rec.status IN ('feedback1_failed','feedback2_failed');

        IF v_is_draft1 THEN
            v_submitted_at := rec.draft_1_submitted_at;
            v_feedback_present := rec.feedback_1 IS NOT NULL;
        ELSE
            v_submitted_at := rec.draft_2_submitted_at;
            v_feedback_present := rec.feedback_2 IS NOT NULL;
        END IF;

        -- draftN_submitted인데 피드백이 이미 있으면 = 승인 대기(정상). 건너뜀.
        IF (NOT v_is_failed) AND v_feedback_present THEN
            CONTINUE;
        END IF;

        -- 대기시간 판정: 실패=3분 / 멈춤=15분. 기준은 마지막 재실행 시각 또는 최초 제출 시각.
        v_needed := CASE WHEN v_is_failed THEN v_failed_delay ELSE v_stuck_delay END;
        v_base_at := COALESCE(rec.last_auto_retry_at, v_submitted_at);
        IF v_base_at IS NULL OR (now() - v_base_at) < v_needed THEN
            CONTINUE;
        END IF;

        -- 과제 유형 + 차수 → n8n 웹훅 (admin-correction.js 매핑과 동일). 미준비 유형은 건너뜀.
        v_webhook := NULL;
        IF rec.task_type IN ('writing_email','writing_discussion') THEN
            v_webhook := v_n8n_base || CASE WHEN v_is_draft1 THEN '/correction-writing-draft1' ELSE '/correction-writing-draft2' END;
        ELSIF rec.task_type = 'speaking_interview' THEN
            v_webhook := v_n8n_base || CASE WHEN v_is_draft1 THEN '/correction-speaking-draft1' ELSE '/correction-speaking-draft2' END;
        ELSIF rec.task_type = 'writing_aus_discussion' AND v_is_draft1 THEN
            v_webhook := v_n8n_base || '/correction-aus-writing-draft1';
        END IF;

        IF v_webhook IS NULL THEN
            CONTINUE;  -- 워크플로우 미준비 유형
        END IF;

        v_event := CASE WHEN v_is_draft1 THEN 'draft1_submitted' ELSE 'draft2_submitted' END;

        -- 실패 건은 상태를 제출 직후로 되돌린다. 공통으로 카운트/시각 갱신.
        UPDATE correction_submissions
        SET status = CASE WHEN v_is_failed THEN v_event ELSE status END,
            auto_retry_count = auto_retry_count + 1,
            last_auto_retry_at = now()
        WHERE id = rec.id;

        -- n8n 재실행 호출 (학생 제출과 동일 payload)
        PERFORM net.http_post(
            url := v_webhook,
            body := jsonb_build_object(
                'event', v_event,
                'user_id', rec.user_id,
                'user_name', COALESCE(rec.student_name, ''),
                'user_email', COALESCE(rec.student_email, ''),
                'session_number', rec.session_number,
                'task_type', rec.task_type,
                'task_number', rec.task_number
            ),
            headers := jsonb_build_object('Content-Type', 'application/json')
        );
    END LOOP;

    -- ===== 2) 자동 재실행 2번 소진 후에도 미복구 → 선생님께 텔레그램 알림 (1회) =====
    FOR rec IN
        SELECT cs.*, u.name AS student_name
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.retry_failed_notified = false
          AND cs.auto_retry_count >= v_max_retries
          AND cs.status IN ('feedback1_failed','feedback2_failed','draft1_submitted','draft2_submitted')
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        v_is_draft1 := rec.status IN ('feedback1_failed','draft1_submitted');
        v_is_failed := rec.status IN ('feedback1_failed','feedback2_failed');

        IF v_is_draft1 THEN
            v_feedback_present := rec.feedback_1 IS NOT NULL;
        ELSE
            v_feedback_present := rec.feedback_2 IS NOT NULL;
        END IF;

        -- 미복구 판정:
        --   실패 상태면 무조건 알림 대상.
        --   멈춤 상태면 마지막 재실행 후 15분 지나도록 피드백이 없을 때만(여전히 멈춤).
        IF v_is_failed THEN
            NULL;
        ELSIF (NOT v_feedback_present)
              AND rec.last_auto_retry_at IS NOT NULL
              AND (now() - rec.last_auto_retry_at) >= v_stuck_delay THEN
            NULL;
        ELSE
            CONTINUE;  -- 복구됐거나 아직 처리 중
        END IF;

        v_draft_round := CASE WHEN v_is_draft1 THEN 1 ELSE 2 END;

        PERFORM net.http_post(
            url := v_tg_url,
            body := jsonb_build_object(
                'type', 'correction_retry_failed',
                'data', jsonb_build_object(
                    'submission_id', rec.id,
                    'name', COALESCE(rec.student_name, ''),
                    'session_number', rec.session_number,
                    'task_type', rec.task_type,
                    'draft_round', v_draft_round
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );

        UPDATE correction_submissions
        SET retry_failed_notified = true
        WHERE id = rec.id;
    END LOOP;
END;
$$;

-- ---------- 6. 연습코스 자동 오픈: 정지 중 제외 ----------
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
          AND NOT public.is_paused(a.id, 'challenge', v_today)   -- [일시정지]
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

-- ---------- 7. 연습코스 오픈 알림톡(50231): 정지 중 제외 ----------
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
          AND NOT public.is_paused(a.id, 'challenge')   -- [일시정지]
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

-- ---------- 8. cron: 매일 정리(KST 00:01, 연습코스 자동 오픈 00:05보다 먼저) + 재개 안내(KST 10:00) ----------
SELECT cron.unschedule('process-schedule-pauses') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-schedule-pauses');
SELECT cron.schedule('process-schedule-pauses', '1 15 * * *', 'SELECT process_schedule_pauses()');
SELECT cron.unschedule('process-resume-notices') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-resume-notices');
SELECT cron.schedule('process-resume-notices', '0 1 * * *', 'SELECT process_resume_notices()');

-- ---------- 9. Q3: 레포에 없는 날 작업(jobid 1 practice-auto-enable, 환불·정지 확인 없는 UPDATE문) 삭제 — auto-enable-practice-mode(jobid 18)가 같은 일을 한다 ----------
SELECT cron.unschedule('practice-auto-enable') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'practice-auto-enable');

-- 적용 후 확인
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname IN ('process-schedule-pauses','process-resume-notices','practice-auto-enable','auto-enable-practice-mode') ORDER BY jobid;
SELECT p.proname, md5(p.prosrc) AS md5_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('preview_correction_session_reminders','process_start_notices','process_auto_approve_corrections',
                     'process_scheduled_releases','process_auto_retry_corrections','auto_enable_practice_mode','send_practice_open_alimtalk')
 ORDER BY 1;

COMMIT;
