-- =====================================================================
-- 인증률 통일 (2026-10-18) — 계산을 디비 한 곳으로
--   계획: C:\기능구현\인증률통일\IMPLEMENTATION_PLAN.md (v2, 12장 downstream 추적)
--
-- 왜: "전체 인증률 = 과제 점수 합 ÷ 과제 수"에서 과제 수(분모)를 화면마다 따로 셌다.
--     관리자 목록·상세는 자기주도도 Fast 달력·연장 무시·한국 시간, 학생 마이페이지는 자기주도 전체 74개.
--     → 같은 학생 인증률이 화면마다 달랐다. 이제 이 파일의 _auth_core 하나만 센다.
--
-- 규칙 (대표 확정 2026-10-18)
--   기록      : 그 수강 꼬리표(enrollment_id = 신청서) 기록만. 총주차 넘는 주차 기록은 뺀다.
--   점수      : 고정 점수(locked_auth_rate), 없으면 냈으면 50 / 오답노트까지 100 / 안 냈으면 0.
--   오늘      : 학생 시간대(users.timezone, 없거나 잘못되면 Asia/Seoul) 기준 새벽 4시 전이면 어제.
--   과제 날짜 : 정규 = 시작일 + (주−1)×7 + 요일, 정지 보정(pause_adjusted_date, 무기한 정지 구간은 미정).
--               자기주도(종료일 있음) = 저장 일정표 24세트의 세트 날짜(슬롯 = 주1~4 × 일~금).
--                 일정표가 없거나 깨졌으면 테스트룸과 같은 균등 분배로 만든다.
--                 무기한 정지 중이면 정지 시작일 이후 세트는 미정(저장 일정표는 재개일이 정해질 때만 밀림).
--               자기주도(종료일 없음, 옛 방식) = 시작일부터 전부 해당.
--   분모(지금): 과제 날짜 ≤ 오늘. 단 연장받은 과제는 연장 마감(다음날 04:00 + 연장일수, 학생 시간)이 지나야.
--   분모(최종): 과정 전체 과제 수(끝난 수강·중도포기 판단용). 끝난 수강은 지금 = 최종.
--   인증률    : 지금 = 분모 0이면 없음(화면 "-"), 아니면 반올림. 100% 넘어도 그대로.
--   연속 미제출: 어제부터 14일, 시작일 이후 과제 있는 날, 연장 마감 전 과제는 제외, 그날 하나라도 냈으면 멈춤.
--
-- 이 파일이 하는 일
--   추가: _grade_rule(int), _self_paced_dates(text,date,date), _auth_core(uuid[],timestamptz), enrollment_auth(uuid[],timestamptz)
--   추가: admin_study_list_next(timestamptz) — 새 목록(계산은 _auth_core). 이 파일만으로는 라이브 화면이 바뀌지 않는다.
--   라이브 반영 때 20261018_enrollment_auth_release.sql이 옛 admin_study_list(date)를 지우고 이 함수 이름을 admin_study_list로 바꾼다.
--   기존 표·데이터·다른 함수는 바꾸지 않는다. (schedule_task_type, pause_days_until, pause_adjusted_date 재사용)
--
-- 되돌리기(반영 전):
--   DROP FUNCTION IF EXISTS public.admin_study_list_next(timestamptz);
--   DROP FUNCTION IF EXISTS public.enrollment_auth(uuid[], timestamptz);
--   DROP FUNCTION IF EXISTS public._auth_core(uuid[], timestamptz);
--   DROP FUNCTION IF EXISTS public._self_paced_dates(text, date, date);
--   DROP FUNCTION IF EXISTS public._grade_rule(int);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) 등급 기준: 높은 기준부터 첫 번째로 넘는 줄. 표가 비면 loadGradeRules 기본값. 못 넘으면 F·0.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._grade_rule(p_rate int)
RETURNS TABLE(grade text, refund_rate numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH r AS (
        SELECT g.grade, g.min_rate, g.refund_rate FROM tr_grade_rules g
        UNION ALL
        SELECT d.grade, d.min_rate, d.refund_rate
          FROM (VALUES ('A', 95::numeric, 1.0::numeric), ('B', 90, 0.9), ('C', 80, 0.8), ('D', 70, 0.7), ('F', 0, 0)) d(grade, min_rate, refund_rate)
         WHERE NOT EXISTS (SELECT 1 FROM tr_grade_rules)
    )
    SELECT x.grade, x.refund_rate FROM (
        SELECT r.grade, COALESCE(r.refund_rate, 0) AS refund_rate, r.min_rate FROM r WHERE p_rate >= r.min_rate
        UNION ALL SELECT 'F', 0, -1
    ) x
    ORDER BY x.min_rate DESC
    LIMIT 1
$$;

-- ---------------------------------------------------------------------
-- 2) 자기주도 일정표 → 세트 1~24의 날짜.
--    저장 일정표({"end":..,"dates":[24개 'YYYY-MM-DD']}, 글자 칸)가 온전하면 그대로.
--    아니면 테스트룸 _distributeSetCounts/_datesFromCounts와 같은 균등 분배(시작~종료 양끝 포함).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._self_paced_dates(p_schedule text, p_start date, p_end date)
RETURNS TABLE(slot int, set_date date)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    j jsonb;
    n int := 24;
    d int;
    base int;
    extra int;
    span int;
    counts int[];
    k int;
    idx int;
    i int;
    c int := 0;
BEGIN
    IF p_schedule IS NOT NULL AND pg_input_is_valid(p_schedule, 'jsonb') THEN
        j := p_schedule::jsonb;
        IF jsonb_typeof(j) = 'string' AND pg_input_is_valid(j #>> '{}', 'jsonb') THEN j := (j #>> '{}')::jsonb; END IF;
        IF jsonb_typeof(j) = 'object' AND jsonb_typeof(j->'dates') = 'array' AND jsonb_array_length(j->'dates') = n
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(j->'dates') x WHERE NOT pg_input_is_valid(left(x, 10), 'date')) THEN
            RETURN QUERY SELECT o::int, left(x, 10)::date FROM jsonb_array_elements_text(j->'dates') WITH ORDINALITY t(x, o);
            RETURN;
        END IF;
    END IF;
    IF p_start IS NULL OR p_end IS NULL THEN RETURN; END IF;
    d := (p_end - p_start) + 1;
    IF d < 1 THEN RETURN; END IF;
    base := n / d;
    extra := n - base * d;
    counts := array_fill(base, ARRAY[d]);
    IF extra > 0 THEN
        span := CASE WHEN extra <= d - 1 THEN d - 1 ELSE d END;
        FOR k IN 0..extra - 1 LOOP
            idx := floor((k + 0.5) * span / extra)::int;
            IF idx > d - 1 THEN idx := d - 1; END IF;
            counts[idx + 1] := counts[idx + 1] + 1;
        END LOOP;
    END IF;
    FOR i IN 1..d LOOP
        FOR k IN 1..counts[i] LOOP
            EXIT WHEN c >= n;
            c := c + 1;
            slot := c; set_date := p_start + (i - 1);
            RETURN NEXT;
        END LOOP;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) 핵심 계산: 수강(신청서)마다 분모·점수·인증률·연속 미제출. 모든 화면이 이것만 쓴다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._auth_core(p_app_ids uuid[], p_now timestamptz DEFAULT now())
RETURNS TABLE(
    app_id uuid, local_today date, mode text, total_weeks int,
    due_count int, total_count int, score_sum int, record_count int,
    rate_now int, rate_final int, last_at timestamptz,
    miss_n int, miss_names text[])
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
WITH
dow(day, idx, kr) AS (
    VALUES ('sunday', 0, '일'), ('monday', 1, '월'), ('tuesday', 2, '화'), ('wednesday', 3, '수'),
           ('thursday', 4, '목'), ('friday', 5, '금'), ('saturday', 6, '토')
),
-- 일정표 과제(종류를 읽은 칸만). 한 번만 읽어 모든 수강이 같이 쓴다.
sched AS MATERIALIZED (
    SELECT lower(COALESCE(sa.program, '')) AS prog, sa.week AS wk, d.idx, d.kr, x.ty
      FROM tr_schedule_assignment sa
      JOIN dow d ON d.day = sa.day
     CROSS JOIN LATERAL (VALUES (sa.section1), (sa.section2), (sa.section3), (sa.section4)) t(sec)
     CROSS JOIN LATERAL (SELECT public.schedule_task_type(t.sec) AS ty) x
     WHERE x.ty IS NOT NULL AND x.ty <> 'unknown'
),
base AS MATERIALIZED (
    SELECT a.id, a.challenge_pauses, a.self_paced_schedule,
           left(a.schedule_start, 10)::date AS start_d,
           a.self_paced_end_date AS sp_end,
           CASE WHEN a.self_paced IS TRUE AND a.self_paced_end_date IS NOT NULL THEN 'sp2'
                WHEN a.self_paced IS TRUE THEN 'sp1'
                ELSE 'regular' END AS mode,
           (a.self_paced IS TRUE OR COALESCE(NULLIF(a.assigned_program, ''), NULLIF(a.preferred_program, ''), '') LIKE '%Fast%') AS is_fast,
           (jsonb_typeof(a.challenge_pauses) = 'array' AND jsonb_array_length(a.challenge_pauses) > 0) AS has_pause,
           tz.tz
      FROM applications a
      LEFT JOIN users u ON u.id::text = a.user_id
     CROSS JOIN LATERAL (
        SELECT CASE WHEN NULLIF(u.timezone, '') IS NOT NULL
                     AND EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = u.timezone)
                    THEN u.timezone ELSE 'Asia/Seoul' END AS tz) tz
     WHERE a.id = ANY(p_app_ids)
       AND COALESCE(a.schedule_start, '') ~ '^\d{4}-\d{2}-\d{2}'
),
b2 AS (
    SELECT b.*, CASE WHEN b.is_fast THEN 4 ELSE 8 END AS tw,
           ((p_now AT TIME ZONE b.tz) - interval '4 hours')::date AS today
      FROM base b
),
-- 자기주도 무기한 정지 시작일(가장 이른 것). 기간 있는 정지는 저장 일정표가 이미 밀려 있으므로 보지 않는다.
sp_open AS (
    SELECT b.id, min((e->>'paused_from')::date) AS from_d
      FROM b2 b
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN b.has_pause THEN b.challenge_pauses ELSE '[]'::jsonb END) e
     WHERE b.mode = 'sp2' AND jsonb_typeof(e) = 'object'
       AND COALESCE(e->>'status', '') <> 'canceled'
       AND NULLIF(e->>'shift_days', '') IS NULL
       AND NULLIF(e->>'paused_from', '') IS NOT NULL
     GROUP BY b.id
),
sp_dates AS (
    SELECT b.id, s.slot, s.set_date
      FROM b2 b
     CROSS JOIN LATERAL public._self_paced_dates(b.self_paced_schedule, b.start_d, b.sp_end) s
     WHERE b.mode = 'sp2'
),
-- 과제마다 날짜(td). NULL = 아직 미정(무기한 정지).
tasks AS MATERIALIZED (
    SELECT b.id AS app_id, b.tz, b.today, b.start_d, b.mode, s.wk, s.kr, s.ty,
           CASE
             WHEN b.mode = 'sp1' THEN b.start_d
             WHEN b.mode = 'sp2' THEN
                  CASE WHEN o.from_d IS NOT NULL AND sd.set_date >= o.from_d THEN NULL ELSE sd.set_date END
             WHEN b.has_pause THEN public.pause_adjusted_date(b.id, 'challenge', b.start_d + (s.wk - 1) * 7 + s.idx)
             ELSE b.start_d + (s.wk - 1) * 7 + s.idx
           END AS td
      FROM b2 b
      JOIN sched s ON s.prog = CASE WHEN b.is_fast THEN 'fast' ELSE 'standard' END
                  AND s.wk <= b.tw
                  AND (b.mode <> 'sp2' OR s.idx <= 5)
      LEFT JOIN sp_dates sd ON b.mode = 'sp2' AND sd.id = b.id AND sd.slot = (s.wk - 1) * 6 + s.idx + 1
      LEFT JOIN sp_open o ON o.id = b.id
),
-- 연장: 그 수강의 연장 기록 중 과제 날짜와 같은 날(original_date). 같은 날 여러 줄이면 가장 긴 연장.
tasks_x AS MATERIALIZED (
    SELECT t.*,
           ext.extra_days,
           CASE WHEN ext.extra_days IS NOT NULL
                THEN (((t.td + 1)::timestamp + interval '4 hours') AT TIME ZONE t.tz) + (ext.extra_days * interval '24 hours')
           END AS ext_deadline
      FROM tasks t
      LEFT JOIN LATERAL (
          SELECT max(COALESCE(NULLIF(x.extra_days, 0), 1)) AS extra_days
            FROM tr_deadline_extensions x
           WHERE x.enrollment_id = t.app_id AND t.td IS NOT NULL AND x.original_date = to_char(t.td, 'YYYY-MM-DD')
      ) ext ON true
),
recs AS MATERIALIZED (
    SELECT b.id AS app_id, r.locked_auth_rate, r.error_note_submitted, r.section_type, r.week, r.day, r.completed_at,
           (r.initial_record IS NOT NULL) AS submitted
      FROM b2 b
      JOIN study_results_v3 r ON r.enrollment_id = b.id
     WHERE r.week ~ '^\d+$' AND r.week::int <= b.tw
),
rec_sum AS (
    SELECT app_id, count(*)::int AS rec_count,
           SUM(CASE WHEN locked_auth_rate IS NOT NULL THEN locked_auth_rate
                    WHEN submitted THEN CASE WHEN error_note_submitted THEN 100 ELSE 50 END
                    ELSE 0 END)::int AS score_sum,
           max(completed_at) AS last_at
      FROM recs GROUP BY app_id
),
cnt AS (
    SELECT t.app_id,
           count(*) FILTER (WHERE t.td IS NOT NULL AND
                CASE WHEN t.ext_deadline IS NOT NULL THEN p_now >= t.ext_deadline ELSE t.td <= t.today END)::int AS due_n,
           count(*)::int AS total_n
      FROM tasks_x t GROUP BY t.app_id
),
sub_keys AS (
    SELECT DISTINCT app_id, section_type, week, day FROM recs WHERE submitted
),
mday AS (
    SELECT t.app_id, t.td, bool_or(sk.app_id IS NOT NULL) AS any_sub
      FROM tasks_x t
      LEFT JOIN sub_keys sk ON sk.app_id = t.app_id AND sk.section_type = t.ty
                           AND sk.week = t.wk::text AND sk.day = t.kr
     WHERE t.mode <> 'sp1'
       AND t.td IS NOT NULL
       AND t.td <  t.today
       AND t.td >= t.today - 14
       AND t.td >= t.start_d
       AND (t.ext_deadline IS NULL OR p_now >= t.ext_deadline)
     GROUP BY t.app_id, t.td
),
miss AS (
    SELECT m.app_id, count(*)::int AS n,
           array_agg((ARRAY['일','월','화','수','목','금','토'])[extract(dow FROM m.td)::int + 1] ORDER BY m.td) AS names
      FROM mday m
     WHERE NOT m.any_sub
       AND m.td > COALESCE((SELECT max(m2.td) FROM mday m2 WHERE m2.app_id = m.app_id AND m2.any_sub), '-infinity'::date)
     GROUP BY m.app_id
)
SELECT b.id, b.today, b.mode, b.tw,
       COALESCE(c.due_n, 0), COALESCE(c.total_n, 0),
       COALESCE(rs.score_sum, 0), COALESCE(rs.rec_count, 0),
       CASE WHEN COALESCE(c.due_n, 0) > 0 THEN round(COALESCE(rs.score_sum, 0)::numeric / c.due_n)::int END,
       CASE WHEN COALESCE(c.total_n, 0) > 0 THEN round(COALESCE(rs.score_sum, 0)::numeric / c.total_n)::int END,
       rs.last_at,
       COALESCE(ms.n, 0), COALESCE(ms.names, ARRAY[]::text[])
  FROM b2 b
  LEFT JOIN cnt c ON c.app_id = b.id
  LEFT JOIN rec_sum rs ON rs.app_id = b.id
  LEFT JOIN miss ms ON ms.app_id = b.id
$fn$;

-- ---------------------------------------------------------------------
-- 4) 화면용 입구: 수강 여러 개의 인증률(jsonb 배열 — 서버 1,000줄 제한 무관)
--    관리자 상세·학생 대시보드 재시작 자격·테스트룸 마이페이지·지난 수강 카드가 부른다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enrollment_auth(p_app_ids uuid[], p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'appId',              c.app_id,
        'today',              c.local_today,
        'mode',               c.mode,
        'totalWeeks',         c.total_weeks,
        'dueCount',           c.due_count,
        'totalCount',         c.total_count,
        'scoreSum',           c.score_sum,
        'recordCount',        c.record_count,
        'rate',               c.rate_now,
        'grade',              CASE WHEN c.rate_now IS NULL THEN NULL ELSE gn.grade END,
        'refundRate',         CASE WHEN c.rate_now IS NULL THEN NULL ELSE gn.refund_rate END,
        'rateFinal',          c.rate_final,
        'gradeFinal',         CASE WHEN c.rate_final IS NULL THEN NULL ELSE gf.grade END,
        'refundRateFinal',    CASE WHEN c.rate_final IS NULL THEN NULL ELSE gf.refund_rate END,
        'lastActivity',       c.last_at,
        'consecutiveMissing', c.miss_n,
        'missedDays',         to_jsonb(c.miss_names)
    )), '[]'::jsonb)
    FROM public._auth_core(p_app_ids, p_now) c
    LEFT JOIN LATERAL public._grade_rule(c.rate_now) gn ON true
    LEFT JOIN LATERAL public._grade_rule(c.rate_final) gf ON true
$$;

-- ---------------------------------------------------------------------
-- 5) 새 관리자 학습관리 목록: 결과 칸은 그대로, 인증률·과제 수·연속 미제출은 _auth_core에서.
--    p_today date 대신 p_now timestamptz (학생마다 시간대가 달라서). 반영 때 이름이 admin_study_list가 된다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_study_list_next(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
WITH
apps AS MATERIALIZED (
    SELECT a.id, a.name AS app_name, a.schedule_start, a.schedule_end, a.app_status, a.challenge_pauses,
           a.self_paced, a.enrollment_no, a.restart_of, a.superseded_by,
           u.id::text AS uid, u.name AS user_name, u.email AS user_email,
           pr.prog_str
      FROM applications a
      JOIN users u ON u.email = a.email
     CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(a.assigned_program, ''), NULLIF(a.preferred_program, ''), '') AS prog_str) pr
     WHERE a.deposit_confirmed_by_admin IS TRUE
       AND a.withdrawn_at IS NULL
       AND COALESCE(a.schedule_start, '') <> ''
),
core AS MATERIALIZED (
    SELECT * FROM public._auth_core((SELECT array_agg(id) FROM apps), p_now)
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'appId',                a.id,
    'userId',               a.uid,
    'enrollmentNo',         COALESCE(NULLIF(a.enrollment_no, 0), 1),
    'restartOf',            a.restart_of,
    'supersededBy',         a.superseded_by,
    'name',                 COALESCE(NULLIF(a.user_name, ''), NULLIF(a.app_name, ''), '-'),
    'email',                a.user_email,
    'programType',          CASE WHEN a.prog_str LIKE '%Fast%' THEN 'Fast' ELSE 'Standard' END,
    'selfPaced',            COALESCE(a.self_paced, false),
    'isAustralia',          (a.prog_str LIKE '%Australia%'),
    'currentWeek',          LEAST(GREATEST(1,
                                floor(((c.local_today - left(a.schedule_start, 10)::date)
                                       - public.pause_days_until(a.challenge_pauses, c.local_today)) / 7.0)::int + 1),
                                CASE WHEN a.prog_str LIKE '%Fast%' THEN 4 ELSE 8 END),
    'totalWeeks',           CASE WHEN a.prog_str LIKE '%Fast%' THEN 4 ELSE 8 END,
    'recordCount',          c.record_count,
    'totalDeadlinedTasks',  c.due_count,
    'avgAuthRate',          COALESCE(c.rate_now, 0),
    'authRate',             c.rate_now,
    'rateFinal',            c.rate_final,
    'grade',                CASE WHEN c.rate_now IS NULL THEN '-' ELSE g.grade END,
    'lastActivity',         c.last_at,
    'daysSinceActivity',    CASE WHEN c.last_at IS NULL THEN 999
                                 ELSE floor(extract(epoch FROM ((c.local_today::timestamp AT TIME ZONE 'UTC') - c.last_at)) / 86400)::int END,
    'consecutiveMissing',   c.miss_n,
    'missedDays',           to_jsonb(c.miss_names),
    'hasFraud',             EXISTS (SELECT 1 FROM tr_auth_records ar
                                     WHERE ar.user_id::text = a.uid
                                       AND (ar.no_selection_flag IS TRUE OR ar.no_text_flag IS TRUE OR ar.focus_lost_count > 3)),
    'toeflCount',           (SELECT count(*) FROM toefl_actual_scores ts WHERE ts.user_id::text = a.uid),
    'scheduleStart',        a.schedule_start,
    'scheduleEnd',          a.schedule_end,
    'appStatus',            a.app_status,
    'challengePauses',      COALESCE(a.challenge_pauses, '[]'::jsonb),
    'today',                c.local_today
)), '[]'::jsonb)
FROM apps a
JOIN core c ON c.app_id = a.id
LEFT JOIN LATERAL public._grade_rule(c.rate_now) g ON true
$fn$;

COMMENT ON FUNCTION public._auth_core(uuid[], timestamptz) IS
  '인증률 계산 단일 출처(2026-10-18 인증률통일). 분모 규칙·연속 미제출. 계획: C:\기능구현\인증률통일';
COMMENT ON FUNCTION public.enrollment_auth(uuid[], timestamptz) IS
  '수강별 인증률·등급(지금/최종) jsonb 배열. 관리자 상세·재시작 자격·테스트룸 마이페이지가 사용.';
COMMENT ON FUNCTION public.admin_study_list_next(timestamptz) IS
  '관리자 학습관리 목록(수강마다 1개, jsonb 배열). 인증률은 _auth_core. 계획: C:\기능구현\인증률통일';

GRANT EXECUTE ON FUNCTION public._grade_rule(int)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._self_paced_dates(text, date, date)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auth_core(uuid[], timestamptz)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enrollment_auth(uuid[], timestamptz)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_study_list_next(timestamptz)       TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
