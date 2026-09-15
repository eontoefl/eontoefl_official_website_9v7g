-- =====================================================================
-- 스라첨삭 세션 당일 리마인드 알림톡 (50244) 자동 발송
--
-- ⚠️ 이 파일은 DB에 직접 등록할 함수의 "레포 사본"입니다.
--    실제 적용(표·함수 생성, 크론 등록)은 대표가 Supabase SQL Editor에서 수행합니다.
--    이 저장소에는 사본만 보관하며, DB를 고치면 이 파일도 함께 고쳐야 합니다.
--
-- 기능 개요:
--   학생 현지시간으로 "오늘 세션이 배정된" 첨삭 학생에게
--   "오늘 N회차 / 과제 ○○ / 1차 마감 ○○" 알림톡(50244)을 하루 한 세션당 한 번 보낸다.
--
-- 발송 창:
--   학생 현지시간 09:00~20:59 안에서만 보낸다.
--   (정상은 아침 9시대 1회. 크론이 밀렸거나 낮에 일정이 등록된 학생을 그날 안에 따라잡기 위한 창.
--    21:00~익일 08:59에는 절대 보내지 않는다.)
--
-- ─────────────────────────────────────────────────────────────────────
-- 규칙 원본 (바뀌면 이 파일도 같이 고쳐야 한다)
--   · 세션 배정일 : 테스트룸 js/correction/correction-session.js  getCorrSessionDate()
--                   + js/correction-schedule-data.js / js/correction-schedule-data-aus.js (dayOffset)
--   · 과제 라벨   : 테스트룸 js/correction/correction-track.js  _GENERAL_CORR_META (일반)
--                   + js/correction-schedule-data-aus.js  AUS_CORR_TYPES.label (호주)
--   · 1차 마감    : 테스트룸 js/timezone-utils.js getTaskDeadline() (= 배정일 다음날 04:00, 학생 시간대)
--                   + correction-session.js _applyCorrExt() (연장 = max(기본마감, 연장 건 시각) + N시간)
--   · 트랙 판정   : 테스트룸 js/correction/correction-track.js getCorrectionTrack()
--                   (program에 'Australia' 포함 → 호주, 아니면 일반)
-- ─────────────────────────────────────────────────────────────────────
--
-- 적용 순서 (대표가 단계별로 진행. 각 단계 사이에 확인을 끼운다)
--   1) 이 파일의 ①표 + ②미리보기 함수 + ③발송 함수까지 실행 (크론은 아직 등록 안 함)
--   2) SELECT * FROM preview_correction_session_reminders(now());           ← 지금 보낼 대상 눈으로 확인
--      SELECT * FROM preview_correction_session_reminders('2026-09-17 09:30+09');  ← 특정 시각 가정 확인
--      (미리보기는 읽기 전용 — 아무것도 보내지 않고 아무것도 기록하지 않는다)
--   3) 테스트 계정 1건 실발송 확인 (대표 승인 후)
--   4) 파일 맨 아래 크론 등록문의 주석을 풀어 실행
--
-- 사전 조건:
--   - pg_net 확장 활성화 (net.http_post)
--   - public.get_supabase_url() / public.get_service_role_key() 헬퍼가 DB에 존재
--     (기존 트리거들이 이미 쓰고 있는 헬퍼. URL 하드코딩 대신 이걸 쓴다)
--   - 엣지 함수 kakaotalk-notify 에 type 'correction_session_reminder' (템플릿 50244) 배포 완료
--
-- 관련 표:
--   correction_schedules / applications / users /
--   correction_submissions / correction_deadline_extensions /
--   correction_session_reminders (이 파일에서 새로 만듦)
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- ① 발송 기록 표 — (학생, 세션) 당 1행. 같은 세션 재발송 방지의 유일한 근거.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.correction_session_reminders (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL,
    session_number int         NOT NULL,
    sent_at        timestamptz NOT NULL DEFAULT now(),
    payload        jsonb,      -- 실제로 보낸 알림톡 변수 4개 (name / session / tasks / deadline)
    CONSTRAINT correction_session_reminders_uniq UNIQUE (user_id, session_number)
);

COMMENT ON TABLE public.correction_session_reminders
    IS '스라첨삭 세션 당일 안내(50244) 발송 기록. (user_id, session_number) 유니크 = 같은 세션 재발송 차단.';
COMMENT ON COLUMN public.correction_session_reminders.payload
    IS '보낸 알림톡 변수 4개 스냅샷: name / session / tasks / deadline.';

-- RLS 켜고 정책 없음 = anon·authenticated 전부 차단. service_role(과 테이블 소유자)만 접근한다.
ALTER TABLE public.correction_session_reminders ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────
-- ② 미리보기 함수 — 읽기 전용. 발송도 기록도 하지 않는다.
--    p_at 을 "지금"이라고 가정했을 때 보낼 대상을 그대로 돌려준다.
-- ─────────────────────────────────────────────────────────────────────
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
        JOIN LATERAL (
            SELECT a.assigned_program, a.preferred_program
            FROM public.applications a
            WHERE a.user_id = cs.user_id
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
                    v_date   := r.start_date + c_offset[v_idx];
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
                        v_date   := r.extension_start_date + c_offset[v_idx];
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

COMMENT ON FUNCTION public.preview_correction_session_reminders(timestamptz)
    IS '스라첨삭 세션 당일 안내(50244) 발송 대상 미리보기. 읽기 전용 — 발송·기록 없음. p_at 을 "지금"으로 가정한다.';


-- ─────────────────────────────────────────────────────────────────────
-- ③ 발송 함수 — 미리보기 결과를 돌면서 기록 선점 후 엣지 함수 호출.
--    기록표에 "실제로 1행 들어간 경우에만" 보낸다 (중복·동시실행 방지).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_correction_session_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_url  text;
    v_key  text;
    r      record;
    v_ins  int;
BEGIN
    -- URL 하드코딩 금지 — 기존 트리거 trg_correction_schedule_late_notify() 가 쓰는 헬퍼와 같은 것을 쓴다.
    -- ※ 위 SET search_path = public, pg_temp 는 이 두 헬퍼가 public 스키마에 있다는 전제다.
    --    다른 스키마에 있으면 그 스키마를 search_path 에 추가하거나 스키마명을 붙여야 한다.
    v_url := get_supabase_url();
    v_key := get_service_role_key();

    IF v_url IS NULL OR v_key IS NULL THEN
        RAISE WARNING 'send_correction_session_reminders: supabase url 또는 service_role key 없음 — 발송 중단';
        RETURN;
    END IF;

    FOR r IN SELECT * FROM public.preview_correction_session_reminders(now())
    LOOP
        -- ① 기록 선점. 이미 있으면 아무 행도 들어가지 않는다.
        INSERT INTO public.correction_session_reminders (user_id, session_number, payload)
        VALUES (
            r.user_id,
            r.session_number,
            jsonb_build_object(
                'name',     r.student_name,
                'session',  r.session_number::text,
                'tasks',    r.tasks,
                'deadline', r.deadline_text
            )
        )
        ON CONFLICT (user_id, session_number) DO NOTHING;

        GET DIAGNOSTICS v_ins = ROW_COUNT;
        IF v_ins = 0 THEN
            CONTINUE;   -- 이미 보낸 건 → 호출하지 않는다
        END IF;

        -- ② 실제 발송 요청 (엣지 함수 kakaotalk-notify → 루나소프트)
        PERFORM net.http_post(
            url := v_url || '/functions/v1/kakaotalk-notify',
            body := jsonb_build_object(
                'type', 'correction_session_reminder',
                'data', jsonb_build_object(
                    'name',     r.student_name,
                    'phone',    r.phone,
                    'session',  r.session_number::text,
                    'tasks',    r.tasks,
                    'deadline', r.deadline_text
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_key
            )
        );
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.send_correction_session_reminders()
    IS '스라첨삭 세션 당일 안내(50244) 발송. preview_correction_session_reminders(now()) 대상 중 기록 선점에 성공한 건만 알림톡을 보낸다.';


-- ─────────────────────────────────────────────────────────────────────
-- ④ 크론 등록 — 아직 등록하지 않는다.
--    미리보기 확인 + 테스트 1건 실발송까지 끝난 뒤, 대표가 마지막 단계에서 직접 아래 한 줄을 실행한다.
--    매시 5분에 돌면서, 각 학생의 현지 09:00~20:59 창에 들어온 세션만 보낸다.
-- ─────────────────────────────────────────────────────────────────────
-- SELECT cron.schedule('send-correction-session-reminders', '5 * * * *', 'SELECT send_correction_session_reminders()');
