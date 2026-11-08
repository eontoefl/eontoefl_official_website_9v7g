-- 2026-11-08 인증률 분자·분모 일치 (계획: C:\기능구현\인증률_분자분모일치\IMPLEMENTATION_PLAN.md)
-- 바뀌는 규칙
--   분모 = 배정 날짜가 온 과제 전부(연장 여부와 상관없음).
--   분자 = 분모에 들어간 과제의 점수만(기록을 같은 과제 목록 tasks_x에 유형·주·요일로 붙여서 셈).
--   연장은 마감만 늦춘다: 인증률 계산에서는 빠지고, 연속 미제출 판정과 테스트룸 마감·동결에만 쓰인다.
--   최종(rate_final) = 과정 전체 과제에 붙은 기록 점수 ÷ 전체 과제 수.
-- 대체되는 규칙(20261018_enrollment_auth.sql)
--   "연장받은 과제는 연장된 마감이 지나야 계산에 넣는다", "100% 초과는 그대로 둔다", 기록 점수 전부를 분자로 더하던 방식.
-- 형태(인자·반환 칸 13개)는 그대로라 enrollment_auth·admin_study_list와 화면 코드는 바뀌지 않는다.
-- 되돌리기: 20261018_enrollment_auth.sql의 _auth_core 정의를 다시 적용.

CREATE OR REPLACE FUNCTION public._auth_core(p_app_ids uuid[], p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(app_id uuid, local_today date, mode text, total_weeks integer, due_count integer, total_count integer, score_sum integer, record_count integer, rate_now integer, rate_final integer, last_at timestamp with time zone, miss_n integer, miss_names text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
           END AS ext_deadline,
           -- 도래: 배정일이 오늘(학생 시간대, 04:00 기준) 이하. 연장은 마감만 늦추고 도래에는 영향 없음.
           (t.td IS NOT NULL AND t.td <= t.today) AS is_due
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
rec_act AS (
    SELECT app_id, count(*)::int AS rec_count, max(completed_at) AS last_at
      FROM recs GROUP BY app_id
),
-- 과제별 점수: 분모와 같은 과제 목록(tasks_x)에 기록을 붙여서 센다 → 분자와 분모가 항상 같은 과제 범위.
rec_sum AS (
    SELECT t.app_id,
           SUM(sc.v) FILTER (WHERE t.is_due)::int AS score_due,
           SUM(sc.v)::int AS score_all
      FROM tasks_x t
      JOIN recs r ON r.app_id = t.app_id AND r.section_type = t.ty
                 AND r.week = t.wk::text AND r.day = t.kr
     CROSS JOIN LATERAL (SELECT CASE WHEN r.locked_auth_rate IS NOT NULL THEN r.locked_auth_rate
                                     WHEN r.submitted THEN CASE WHEN r.error_note_submitted THEN 100 ELSE 50 END
                                     ELSE 0 END AS v) sc
     GROUP BY t.app_id
),
cnt AS (
    SELECT t.app_id,
           count(*) FILTER (WHERE t.is_due)::int AS due_n,
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
       COALESCE(rs.score_due, 0), COALESCE(ra.rec_count, 0),
       CASE WHEN COALESCE(c.due_n, 0) > 0 THEN round(COALESCE(rs.score_due, 0)::numeric / c.due_n)::int END,
       CASE WHEN COALESCE(c.total_n, 0) > 0 THEN round(COALESCE(rs.score_all, 0)::numeric / c.total_n)::int END,
       ra.last_at,
       COALESCE(ms.n, 0), COALESCE(ms.names, ARRAY[]::text[])
  FROM b2 b
  LEFT JOIN cnt c ON c.app_id = b.id
  LEFT JOIN rec_sum rs ON rs.app_id = b.id
  LEFT JOIN rec_act ra ON ra.app_id = b.id
  LEFT JOIN miss ms ON ms.app_id = b.id
$function$;
