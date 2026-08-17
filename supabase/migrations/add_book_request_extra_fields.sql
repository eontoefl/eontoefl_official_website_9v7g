-- 입문서 신청서 추가 문항 2개 (book-request)
--   stuck_area     : 지금 제일 막히거나 답답한 점 (주관식)
--   goal_timeframe : 목표 점수 필요 시점 (한 달 안에 / 3개월 안에 / 6개월 안에 / 아직 미정)
-- 둘 다 nullable → 기존 신청서/코드에 영향 없음 (추가만 하는 안전한 변경)

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS stuck_area     TEXT,
  ADD COLUMN IF NOT EXISTS goal_timeframe TEXT;
