-- =====================================================================
-- 과정 트랙 구분 컬럼 추가 (호주 과정 / 일반 정규과정)
--
-- 배경:
--   호주/뉴질랜드 기관에 직접 제출하는 학생은 '호주 과정'으로 진행.
--   나머지 학생은 기존 '일반 정규과정'으로 진행.
--   구조는 동일하나 컨텐츠(스케줄, 이용방법 등)가 다름.
--
-- 값:
--   'regular'   = 일반 정규과정 (기본값)
--   'australia'  = 호주 과정
--
-- is_au_nz_direct_submit 와의 관계:
--   is_au_nz_direct_submit = 학생의 신청 의사 (원본 데이터, 불변)
--   course_track = 관리자가 확정한 실제 배정 과정 (오버라이드 가능)
--
-- 2026-05-17
-- =====================================================================

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS course_track TEXT DEFAULT 'regular';

COMMENT ON COLUMN applications.course_track IS '과정 트랙: regular(일반 정규과정) 또는 australia(호주 과정). 관리자 개별분석 시 확정.';

-- 기존 데이터 백필: is_au_nz_direct_submit = 'yes'인 학생은 australia로 세팅
-- (is_au_nz_direct_submit 컬럼이 아직 없을 수 있으므로 안전하게 체크)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'applications' AND column_name = 'is_au_nz_direct_submit'
    ) THEN
        UPDATE applications
        SET course_track = 'australia'
        WHERE is_au_nz_direct_submit = 'yes'
          AND (course_track IS NULL OR course_track = 'regular');
    END IF;
END $$;
