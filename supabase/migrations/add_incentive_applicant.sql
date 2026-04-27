-- =====================================================================
-- 프로모션 유도 학생 (incentive applicant) 지원
-- applications 테이블에 is_incentive_applicant 컬럼 추가
-- Supabase SQL Editor에서 실행하세요
-- =====================================================================

-- is_incentive_applicant: 무료 입문서 + 무료 개별분석 제공으로 유도된 학생 여부
-- true인 경우: 개별분석 동의 데드라인이 24시간 → 5일(120시간)로 변경
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS is_incentive_applicant boolean DEFAULT false;

-- 인덱스 추가 (필터링 성능 향상)
CREATE INDEX IF NOT EXISTS idx_applications_incentive
ON applications (is_incentive_applicant)
WHERE is_incentive_applicant = true;
