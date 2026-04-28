-- =====================================================================
-- 개별분석 "최초 저장 시각" 별도 컬럼 신설
--
-- 배경:
--   기존 analysis_saved_at은 관리자가 분석을 저장할 때마다 매번 갱신됨.
--   이로 인해 관리자가 분석을 수정 저장하면 학생/관리자 화면의
--   동의 데드라인 카운트다운이 함께 리셋되는 문제가 있었음.
--
-- 사용자 결정사항:
--   "프로모션 학생의 5일 데드라인 / 일반 학생의 24시간 데드라인은
--    관리자가 개별분석을 '최초로' 저장한 시점부터 흘러간다.
--    중간에 수정 저장해도 시간은 계속 흘러가야 한다."
--
-- 해결:
--   analysis_first_saved_at 컬럼을 신설.
--   이 컬럼은 첫 분석 저장 시에만 기록되고, 이후 수정 저장 시에는
--   덮어쓰지 않는다 (JS 레벨에서 제어).
--   기존 analysis_saved_at은 그대로 두어 다른 용도(분석 갱신 시각 표시,
--   알림 시각, 마지막 활동 시각 등)는 영향 없도록 유지한다.
--
-- 컬럼 타입:
--   analysis_first_saved_at : bigint  (Date.now() 밀리초 정수)
--   - analysis_saved_at과 동일한 타입/단위 사용
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체를 실행
-- =====================================================================

-- 1. analysis_first_saved_at 컬럼 추가
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS analysis_first_saved_at bigint DEFAULT NULL;

COMMENT ON COLUMN applications.analysis_first_saved_at IS
'개별분석 최초 저장 시각 (밀리초). 동의 데드라인 계산 기준. 첫 저장 시에만 기록되며 수정 저장 시 변경되지 않음.';

-- 2. 기존 데이터 백필
--    이미 분석이 저장된 학생들은 analysis_saved_at 값을 그대로 복사한다.
--    (이전에는 첫 저장 시각이 따로 보존되지 않았으므로,
--     현재 남아 있는 analysis_saved_at을 최초 시각으로 간주)
UPDATE applications
SET analysis_first_saved_at = analysis_saved_at
WHERE analysis_first_saved_at IS NULL
  AND analysis_saved_at IS NOT NULL;

-- 3. 부분 인덱스 (cron 조회 성능 + NULL 제외)
--    process_incentive_deadline_warnings()가 이 컬럼 기준으로
--    프로모션 학생 중 동의 안 한 학생을 찾을 때 사용된다.
CREATE INDEX IF NOT EXISTS idx_applications_analysis_first_saved_at
ON applications (analysis_first_saved_at)
WHERE analysis_first_saved_at IS NOT NULL;

-- 4. 검증 쿼리 (실행 후 확인용 — 주석 해제하여 결과 확인 가능)
-- SELECT
--   COUNT(*) AS total,
--   COUNT(analysis_saved_at) AS has_saved_at,
--   COUNT(analysis_first_saved_at) AS has_first_saved_at,
--   COUNT(*) FILTER (
--     WHERE analysis_saved_at IS NOT NULL
--       AND analysis_first_saved_at IS NULL
--   ) AS backfill_missing
-- FROM applications;
-- → backfill_missing 이 0이어야 정상.
