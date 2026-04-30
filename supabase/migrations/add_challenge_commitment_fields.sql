-- =====================================================
-- 챌린지 완주 약속 필드 추가
-- =====================================================
-- 신청서 10번 섹션(프로그램 및 일정)의 서술형 항목 확장
--   give_up_plan : 챌린지 완주를 위해 포기/조절할 것 (필수)
--   tell_plan    : 챌린지 참여 사실을 알릴 사람/계획 (필수, Ulysses Pact 효과)
--
-- 기존 program_note 컬럼은 그대로 재활용:
--   program_note : 노트북/데스크탑 보유 여부 (필수)
-- =====================================================

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS give_up_plan TEXT,
  ADD COLUMN IF NOT EXISTS tell_plan    TEXT;

COMMENT ON COLUMN applications.give_up_plan IS '챌린지 완주를 위해 포기 또는 조절할 것 (10번 섹션 서술형 1)';
COMMENT ON COLUMN applications.tell_plan    IS '챌린지 참여 사실을 알린/알릴 사람 (10번 섹션 서술형 2 - Ulysses Pact)';
COMMENT ON COLUMN applications.program_note IS '노트북/데스크탑 보유 여부 (10번 섹션 서술형 3)';
