-- =====================================================================
-- 다음 목표(2차 목표) 섹션별 값
--
-- 목표 = Overall(항상) + 섹션 0~4개.
-- 커트라인은 신청서에 섹션 필드(target_reading_new 등)가 이미 있고,
-- 다음 목표도 같은 구조로 맞추기 위해 섹션 4칸을 추가한다.
--   - Overall 다음목표 = target_wish_new (기존)
--   - 섹션 다음목표    = target_wish_reading / listening / writing / speaking (신규)
-- 학생이 마이페이지에서 직접 입력(anon PATCH). 신규 척도(1.0~6.0).
-- =====================================================================

ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS target_wish_reading   numeric,
    ADD COLUMN IF NOT EXISTS target_wish_listening numeric,
    ADD COLUMN IF NOT EXISTS target_wish_writing   numeric,
    ADD COLUMN IF NOT EXISTS target_wish_speaking  numeric;
