-- 입문서 접근 권한을 프로모션 여부와 독립적으로 제어하기 위한 컬럼
-- is_incentive_applicant와 별개로, 이 플래그만으로 입문서 미니카드가 대시보드에 표시됨
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS book_access_enabled boolean DEFAULT false;
