-- 호주/뉴질랜드 기관 직접 제출 여부 컬럼 추가
-- 값: 'yes' (호주/NZ 소재 기관에 직접 제출) 또는 'no' (해당하지 않음)
-- 2026-05-16

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS is_au_nz_direct_submit TEXT DEFAULT NULL;

COMMENT ON COLUMN applications.is_au_nz_direct_submit IS '호주/뉴질랜드 소재 기관에 토플 점수를 직접 제출하는지 여부 (yes/no)';
