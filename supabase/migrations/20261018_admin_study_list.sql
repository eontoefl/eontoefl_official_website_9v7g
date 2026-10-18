-- =====================================================================
-- 학습관리 목록 계산을 디비로 (2026-10-18)
--   계획: C:\기능구현\학습관리속도\IMPLEMENTATION_PLAN.md (v2, 12장 downstream 추적)
--
-- 왜: 관리자 학습관리 목록(admin-study-v3.js)이 원본 기록 8종을 통째로 받아 브라우저에서 계산했다.
--     문제 풀이 기록을 지문·해설째(약 45MB) 받느라 공개 열쇠 시간 제한(anon statement_timeout 3s)에 걸려
--     "데이터 로드에 실패"가 났고, 서버 1,000줄 제한 때문에 기록 일부만 계산돼 숫자가 틀렸다.
--     이제 디비가 수강마다 결과를 계산하고, 목록은 결과 한 덩어리(jsonb 배열)만 받는다.
--
-- 이 파일은 **추가만** 한다: 함수 3개. 기존 표·데이터·함수는 바꾸지 않는다.
--   1) schedule_task_type(text)            — 일정표 칸 글자 → 과제 종류. 브라우저 parseScheduleSection과 같은 규칙.
--   2) pause_days_until(jsonb, date)        — 정지로 멈춘 날수(주차 계산용). 브라우저 getPausedDaysUntil과 같은 규칙.
--   3) admin_study_list(date DEFAULT NULL)  — 목록 결과. 계산 규칙은 2026-10-18 이전 admin-study-v3.js loadStudyData 그대로.
--      과제 날짜 정지 보정은 기존 pause_adjusted_date 재사용. p_today 비우면 "효력 오늘"(한국시간 새벽 4시 기준).
--
-- 결과를 "여러 줄"이 아니라 jsonb 배열 하나로 돌려준다 — 서버 1,000줄 제한(max-rows)을 받지 않게.
-- 부른 사람 권한으로 실행(SECURITY INVOKER). 지금 목록이 공개 열쇠로 읽던 표만 읽는다.
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션).
-- 되돌리기:
--   DROP FUNCTION IF EXISTS public.admin_study_list(date);
--   DROP FUNCTION IF EXISTS public.pause_days_until(jsonb, date);
--   DROP FUNCTION IF EXISTS public.schedule_task_type(text);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) 일정표 칸 → 과제 종류 (parseScheduleSection과 같은 순서·규칙)
--    빈칸 → NULL, 읽을 수 없는 글자 → 'unknown'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_task_type(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN t IS NULL OR t = ''                                      THEN NULL
        WHEN starts_with(t, '내벨업보카')                             THEN 'vocab'
        WHEN t ~ '입문서 정독\s*\d' OR starts_with(t, '입문서 정독')   THEN 'intro-book'
        WHEN t ~ '리딩 Module\s*\d'                                   THEN 'reading'
        WHEN t ~ '리스닝 Module\s*\d'                                 THEN 'listening'
        WHEN t ~ '라이팅\s*\d'                                        THEN 'writing'
        WHEN t ~ '스피킹\s*\d'                                        THEN 'speaking'
        ELSE 'unknown'
    END
    FROM (SELECT btrim(p_text, E' \t\r\n\f\v') AS t) x
$$;

-- ---------------------------------------------------------------------
-- 2) 정지로 멈춘 날수 (getPausedDaysUntil과 같음)
--    취소 안 된 항목 중 정지 시작일 ≤ 오늘인 것: 기간 있으면 min(기간, 경과일), 무기한이면 경과일.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pause_days_until(p_pauses jsonb, p_today date)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(SUM(
               CASE WHEN NULLIF(e->>'shift_days', '') IS NULL
                    THEN (p_today - (e->>'paused_from')::date)
                    ELSE LEAST((e->>'shift_days')::numeric, (p_today - (e->>'paused_from')::date))
               END), 0)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_pauses) = 'array' THEN p_pauses ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object'
       AND NULLIF(e->>'paused_from', '') IS NOT NULL
       AND COALESCE(e->>'status', '') <> 'canceled'
       AND p_today >= (e->>'paused_from')::date
$$;

-- ---------------------------------------------------------------------
-- 3) 학습관리 목록 결과
--    대상: 입금 확인 + 탈퇴 아님 + 시작일 있음, 회원과 이메일로 연결되는 수강.
--    기록 범위: 그 수강 꼬리표 기록 + 꼬리표 없는 옛 기록(0000…, 같은 회원).
--    돌려주는 칸 이름은 목록 화면이 쓰는 이름 그대로(camelCase).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_study_list(p_today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
WITH
p AS (
    SELECT COALESCE(p_today, ((now() AT TIME ZONE 'Asia/Seoul') - interval '4 hours')::date) AS today
),
-- 등급 기준: 높은 기준부터. 표가 비면 loadGradeRules 기본값.
rules AS (
    SELECT grade, min_rate FROM (SELECT grade, min_rate FROM tr_grade_rules ORDER BY min_rate DESC LIMIT 20) r
    UNION ALL
    SELECT d.grade, d.min_rate FROM (VALUES ('A', 95::numeric), ('B', 90), ('C', 80), ('D', 70), ('F', 0)) d(grade, min_rate)
     WHERE NOT EXISTS (SELECT 1 FROM tr_grade_rules)
),
dow(day, idx, kr) AS (
    VALUES ('sunday', 0, '일'), ('monday', 1, '월'), ('tuesday', 2, '화'), ('wednesday', 3, '수'),
           ('thursday', 4, '목'), ('friday', 5, '금'), ('saturday', 6, '토')
),
-- 일정표 과제(종류를 읽은 칸만). 주차는 숫자. 한 번만 읽어 두고 모든 수강이 같이 쓴다(MATERIALIZED — 수강마다 다시 읽으면 느림).
sched AS MATERIALIZED (
    SELECT lower(COALESCE(sa.program, '')) AS prog, sa.week AS wk, d.idx, d.kr, x.ty
      FROM tr_schedule_assignment sa
      JOIN dow d ON d.day = sa.day
     CROSS JOIN LATERAL (VALUES (sa.section1), (sa.section2), (sa.section3), (sa.section4)) t(sec)
     CROSS JOIN LATERAL (SELECT public.schedule_task_type(t.sec) AS ty) x
     WHERE x.ty IS NOT NULL AND x.ty <> 'unknown'
),
base AS (
    SELECT a.id, a.name AS app_name, a.schedule_start, a.schedule_end, a.app_status, a.challenge_pauses,
           a.self_paced, a.enrollment_no, a.restart_of, a.superseded_by,
           u.id::text AS uid, u.name AS user_name, u.email AS user_email,
           pr.prog_str,
           (pr.prog_str LIKE '%Fast%')                          AS is_fast,
           CASE WHEN pr.prog_str LIKE '%Fast%' THEN 4 ELSE 8 END AS total_weeks,
           left(a.schedule_start, 10)::date                     AS start_d,
           (jsonb_typeof(a.challenge_pauses) = 'array' AND jsonb_array_length(a.challenge_pauses) > 0) AS has_pause,
           (SELECT today FROM p)                                AS today
      FROM applications a
      JOIN users u ON u.email = a.email
     CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(a.assigned_program, ''), NULLIF(a.preferred_program, ''), '') AS prog_str) pr
     WHERE a.deposit_confirmed_by_admin IS TRUE
       AND a.withdrawn_at IS NULL
       AND COALESCE(a.schedule_start, '') <> ''
),
-- 수강별 과제 날짜(정지 보정). 정지 이력이 없으면 원래 날짜 그대로(pause_adjusted_date 결과와 같음).
tasks AS (
    SELECT b.id AS app_id, s.wk, s.kr, s.ty,
           CASE WHEN b.has_pause
                THEN public.pause_adjusted_date(b.id, 'challenge', b.start_d + (s.wk - 1) * 7 + s.idx)
                ELSE b.start_d + (s.wk - 1) * 7 + s.idx
           END AS td
      FROM base b
      JOIN sched s ON s.prog = CASE WHEN b.is_fast THEN 'fast' ELSE 'standard' END
                  AND s.wk <= b.total_weeks
),
-- 수강별 기록(그 수강 꼬리표 + 같은 회원의 꼬리표 없는 옛 기록). 지문·해설은 꺼내지 않고 있는지만 본다.
recs AS (
    SELECT b.id AS app_id, r.locked_auth_rate, r.error_note_submitted, r.section_type, r.week, r.day, r.completed_at,
           (r.initial_record IS NOT NULL) AS submitted
      FROM base b
      JOIN study_results_v3 r ON r.enrollment_id = b.id
    UNION ALL
    SELECT b.id, r.locked_auth_rate, r.error_note_submitted, r.section_type, r.week, r.day, r.completed_at,
           (r.initial_record IS NOT NULL)
      FROM base b
      JOIN study_results_v3 r ON r.enrollment_id = '00000000-0000-0000-0000-000000000000'::uuid AND r.user_id = b.uid
),
rec_sum AS (
    SELECT app_id,
           count(*) AS rec_count,
           SUM(CASE WHEN locked_auth_rate IS NOT NULL THEN locked_auth_rate
                    WHEN submitted THEN CASE WHEN error_note_submitted THEN 100 ELSE 50 END
                    ELSE 0 END) AS auth_sum,
           max(completed_at) AS last_at
      FROM recs
     GROUP BY app_id
),
deadlined AS (
    SELECT b.id AS app_id, count(t.td) AS n
      FROM base b
      LEFT JOIN tasks t ON t.app_id = b.id AND t.td IS NOT NULL AND t.td <= b.today
     GROUP BY b.id
),
-- 수강별 "낸 과제" 열쇠(과제 종류·주차·요일). 연속 미제출 판정에 쓴다.
sub_keys AS (
    SELECT DISTINCT app_id, section_type, week, day FROM recs WHERE submitted
),
-- 연속 미제출: 어제부터 14일, 시작일 이후, 과제가 있는 날만. 가장 최근 "하나라도 낸 날" 이후의 안 낸 날들.
mday AS (
    SELECT t.app_id, t.td,
           bool_or(sk.app_id IS NOT NULL) AS any_sub
      FROM tasks t
      JOIN base b ON b.id = t.app_id
      LEFT JOIN sub_keys sk ON sk.app_id = t.app_id AND sk.section_type = t.ty
                           AND sk.week = t.wk::text AND sk.day = t.kr
     WHERE t.td IS NOT NULL
       AND t.td <  b.today
       AND t.td >= b.today - 14
       AND t.td >= b.start_d
     GROUP BY t.app_id, t.td
),
miss AS (
    SELECT m.app_id,
           count(*) AS n,
           array_agg((ARRAY['일','월','화','수','목','금','토'])[extract(dow FROM m.td)::int + 1] ORDER BY m.td) AS names
      FROM mday m
     WHERE NOT m.any_sub
       AND m.td > COALESCE((SELECT max(m2.td) FROM mday m2 WHERE m2.app_id = m.app_id AND m2.any_sub), '-infinity'::date)
     GROUP BY m.app_id
),
calc AS (
    SELECT b.*,
           COALESCE(rs.rec_count, 0)                     AS rec_count,
           rs.last_at,
           dl.n                                          AS deadlined_n,
           CASE WHEN dl.n > 0 THEN round(COALESCE(rs.auth_sum, 0)::numeric / dl.n)::int ELSE 0 END AS avg_rate,
           floor(((b.today - b.start_d) - public.pause_days_until(b.challenge_pauses, b.today)) / 7.0)::int + 1 AS week_raw,
           COALESCE(ms.n, 0)                             AS miss_n,
           COALESCE(ms.names, ARRAY[]::text[])           AS miss_names
      FROM base b
      LEFT JOIN rec_sum rs ON rs.app_id = b.id
      LEFT JOIN deadlined dl ON dl.app_id = b.id
      LEFT JOIN miss ms ON ms.app_id = b.id
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'appId',                c.id,
    'userId',               c.uid,
    'enrollmentNo',         COALESCE(NULLIF(c.enrollment_no, 0), 1),
    'restartOf',            c.restart_of,
    'supersededBy',         c.superseded_by,
    'name',                 COALESCE(NULLIF(c.user_name, ''), NULLIF(c.app_name, ''), '-'),
    'email',                c.user_email,
    'programType',          CASE WHEN c.is_fast THEN 'Fast' ELSE 'Standard' END,
    'selfPaced',            COALESCE(c.self_paced, false),
    'isAustralia',          (c.prog_str LIKE '%Australia%'),
    'currentWeek',          LEAST(GREATEST(1, c.week_raw), c.total_weeks),
    'totalWeeks',           c.total_weeks,
    'recordCount',          c.rec_count,
    'totalDeadlinedTasks',  c.deadlined_n,
    'avgAuthRate',          c.avg_rate,
    'grade',                CASE WHEN c.deadlined_n > 0
                                 THEN COALESCE((SELECT r.grade FROM rules r WHERE c.avg_rate >= r.min_rate ORDER BY r.min_rate DESC LIMIT 1), 'F')
                                 ELSE '-' END,
    'lastActivity',         c.last_at,
    'daysSinceActivity',    CASE WHEN c.last_at IS NULL THEN 999
                                 ELSE floor(extract(epoch FROM ((c.today::timestamp AT TIME ZONE 'UTC') - c.last_at)) / 86400)::int END,
    'consecutiveMissing',   c.miss_n,
    'missedDays',           to_jsonb(c.miss_names),
    'hasFraud',             EXISTS (SELECT 1 FROM tr_auth_records ar
                                     WHERE ar.user_id::text = c.uid
                                       AND (ar.no_selection_flag IS TRUE OR ar.no_text_flag IS TRUE OR ar.focus_lost_count > 3)),
    'toeflCount',           (SELECT count(*) FROM toefl_actual_scores ts WHERE ts.user_id::text = c.uid),
    'scheduleStart',        c.schedule_start,
    'scheduleEnd',          c.schedule_end,
    'appStatus',            c.app_status,
    'challengePauses',      COALESCE(c.challenge_pauses, '[]'::jsonb),
    'today',                c.today
)), '[]'::jsonb)
FROM calc c
$fn$;

COMMENT ON FUNCTION public.admin_study_list(date) IS
  '관리자 학습관리 목록 결과(수강마다 1개, jsonb 배열). 규칙 = 2026-10-18 이전 admin-study-v3.js loadStudyData. p_today 비우면 KST 새벽 4시 기준 오늘. 계획: C:\기능구현\학습관리속도';

GRANT EXECUTE ON FUNCTION public.schedule_task_type(text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pause_days_until(jsonb, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_study_list(date)        TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
