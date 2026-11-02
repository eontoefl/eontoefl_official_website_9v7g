-- 공지 게시 종료 시각 (tr_notices.active_until)
-- 규칙(테스트룸 js/notice-board.js): 종료 시각이 지금보다 뒤인 공지만 테스트룸에 보인다.
--   게시를 켜면 지금 + 7일, 끄면 지금으로 기록한다. 내용만 수정하면 그대로 둔다.
-- 기존 is_active(켜짐 여부)를 대체한다. is_active 삭제는 전환 확인 뒤 별도 파일로 적용한다.

ALTER TABLE tr_notices
ADD COLUMN IF NOT EXISTS active_until timestamptz;

-- 지금 켜진 공지: 등록 시각 + 7일 (꺼진 공지는 NULL = 비게시)
UPDATE tr_notices
SET active_until = created_at + interval '7 days'
WHERE is_active = true
  AND active_until IS NULL;