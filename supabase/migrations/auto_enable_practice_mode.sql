-- =====================================================================
-- 연습코스(Practice Mode) 자동 활성화
--
-- 배경:
--   2026-03-28 커밋(3ef9cc8)에서 관리자 UI(수동 ON/OFF 토글)만 배포되고
--   "정규과정 종료 시 자동 활성화" 크론잡은 끝내 만들어지지 않았다.
--   컬럼(practice_enabled, practice_disabled_manually)만 존재하고
--   값을 자동으로 켜주는 주체가 없어서, 종료된 학생들이 방치돼 있었다.
--
-- 활성화 조건 (모두 만족):
--   1) 입금 확인됨 (deposit_confirmed_by_admin = true)
--   2) 아직 꺼져 있음 (practice_enabled != true)
--   3) 관리자가 수동 OFF 한 적 없음 (practice_disabled_manually != true)
--   4) 환불완료/중도포기 아님 (app_status NOT IN ('refunded','dropped'))
--   5) 정규과정 종료일 도래  OR  커리큘럼 최종 과제 완료  (둘 중 먼저 오는 쪽)
--
-- 최종 과제 판정:
--   커리큘럼 마지막 수업일은 Fast = 4주차 금요일, Standard = 8주차 금요일.
--   (tr_schedule_assignment 상 토요일은 과제가 비어 있다)
--   그 날의 실전 과제(리딩/리스닝/라이팅/스피킹)를 "전부" 완료해야 인정한다.
--
--   보카·입문서는 판정에서 제외한다. 페이지 기반이라 학생들이 몇 주씩
--   미리 몰아서 하기 때문이다. (실제로 김민정 학생은 8주차 금요일 보카를
--   종료 한 달 전인 6/18에 끝냈다.) 이걸 인정하면 아직 진행 중인 학생의
--   연습코스가 열려버린다.
--
--   중간에 빠뜨린 과제가 있어도 상관없다. "마지막까지 갔는가"만 본다.
--
-- 주의:
--   schedule_end 는 DATE 가 아니라 TEXT 컬럼이고 빈 문자열('')이 섞여 있다.
--   그대로 ::date 캐스팅하면 invalid input syntax 로 잡 전체가 죽으므로
--   반드시 형식 검증 후 캐스팅한다.
--
-- 2026-07-14
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 컬럼 보강 (이미 있으면 무시)
-- ---------------------------------------------------------------------
ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS practice_enabled           BOOLEAN     DEFAULT false,
    ADD COLUMN IF NOT EXISTS practice_disabled_manually BOOLEAN     DEFAULT false,
    ADD COLUMN IF NOT EXISTS practice_enabled_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS practice_enabled_source    TEXT;   -- 'auto' | 'manual'

COMMENT ON COLUMN applications.practice_enabled_at     IS '연습코스가 켜진 시각';
COMMENT ON COLUMN applications.practice_enabled_source IS '연습코스를 켠 주체: auto(크론) | manual(관리자)';

-- ---------------------------------------------------------------------
-- 1. 안전한 날짜 캐스팅 헬퍼
--    'YYYY-MM-DD' 형식일 때만 date 로, 그 외(''/NULL/쓰레기값)는 NULL
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION safe_to_date(p_text TEXT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_text ~ '^\d{4}-\d{2}-\d{2}$' THEN p_text::date
        ELSE NULL
    END;
$$;

-- ---------------------------------------------------------------------
-- 2. 커리큘럼 최종일의 "실전 과제" 목록 뷰
--    tr_schedule_assignment 의 section1~4 텍스트를 파싱한다.
--    (프론트 parseScheduleSection() 과 동일한 규칙)
--    커리큘럼이 DB에서 바뀌면 이 뷰도 따라 바뀐다 — 하드코딩하지 않는다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW practice_final_tasks AS
SELECT
    s.program,
    s.week::text AS week_text,
    CASE
        WHEN t.section ~ '리딩 Module'   THEN 'reading'
        WHEN t.section ~ '리스닝 Module' THEN 'listening'
        WHEN t.section ~ '라이팅\s*\d+'  THEN 'writing'
        WHEN t.section ~ '스피킹\s*\d+'  THEN 'speaking'
    END AS section_type,
    COALESCE(
        NULLIF(substring(t.section from '(?:리딩|리스닝) Module\s*(\d+)'), '')::int,
        NULLIF(substring(t.section from '(?:라이팅|스피킹)\s*(\d+)'), '')::int
    ) AS module_number
FROM tr_schedule_assignment s
CROSS JOIN LATERAL (VALUES (s.section1), (s.section2), (s.section3), (s.section4)) AS t(section)
WHERE s.day = 'friday'
  AND (
        (s.program = 'fast'     AND s.week = 4)
     OR (s.program = 'standard' AND s.week = 8)
  )
  AND COALESCE(t.section, '') <> ''
  -- 보카·입문서 제외 (미리 몰아서 하는 과제라 완주 신호로 쓸 수 없음)
  AND t.section !~ '^내벨업보카'
  AND t.section !~ '입문서 정독'
  AND t.section ~ '(리딩 Module|리스닝 Module|라이팅\s*\d+|스피킹\s*\d+)';

-- ---------------------------------------------------------------------
-- 3. 자동 활성화 함수
--    켜진 건수를 반환한다. 크론과 소급(백필) 모두 이 함수 하나를 쓴다.
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
            -- 자기주도 완료 종료일이 따로 있으면 늦은 쪽을 실제 종료일로 본다
            -- (GREATEST 는 NULL 을 무시하므로 한쪽만 있어도 동작)
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
    ),
    scored AS (
        SELECT
            c.id,
            c.end_date,
            -- 최종일 실전 과제 수
            (SELECT count(*) FROM practice_final_tasks f
              WHERE f.program = c.program) AS required_cnt,
            -- 그중 이 학생이 완료한 수
            -- study_results_v3.user_id 는 TEXT, users.id 는 UUID 라 캐스팅이 필요하다
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
        WHERE
            -- (a) 정규과정 종료일 도래
            s.end_date <= v_today
            -- (b) 또는 최종일 실전 과제 전부 완료 (조기 완주자)
            --     required_cnt = 0 이면 스케줄이 비어 있다는 뜻이므로 켜지 않는다
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
-- 4. pg_cron 등록 — 매일 00:05 KST (= 15:05 UTC)
-- ---------------------------------------------------------------------
SELECT cron.unschedule('auto-enable-practice-mode')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-enable-practice-mode');

SELECT cron.schedule(
    'auto-enable-practice-mode',
    '5 15 * * *',
    'SELECT auto_enable_practice_mode()'
);

-- ---------------------------------------------------------------------
-- 5. 소급 활성화 (1회성)
--    이미 종료됐는데 그동안 안 켜진 학생들을 지금 한 번에 열어준다.
--    환불완료/중도포기 학생은 위 조건에서 자동으로 빠진다.
-- ---------------------------------------------------------------------
SELECT auto_enable_practice_mode() AS backfilled_count;

-- ---------------------------------------------------------------------
-- 확인용 쿼리
-- ---------------------------------------------------------------------
-- 크론 등록 확인
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'auto-enable-practice-mode';
--
-- 최종일 실전 과제 목록 확인 (fast 2건 / standard 1건이 정상)
-- SELECT * FROM practice_final_tasks ORDER BY program, section_type;
--
-- 활성화 결과 확인
-- SELECT name, schedule_end, app_status, practice_enabled,
--        practice_enabled_source, practice_enabled_at
-- FROM applications
-- WHERE deposit_confirmed_by_admin = true AND practice_enabled = true
-- ORDER BY practice_enabled_at DESC NULLS LAST;
