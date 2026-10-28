-- =====================================================================
-- 단어장 디지털 전달 (2026-10-28)
--   - 책마다 "처음 열 때 확인" 켜고 끄기        : tr_book_documents.view_confirm
--   - 책마다 "PDF 저장·인쇄" 허용 켜고 끄기     : tr_book_documents.allow_print
--   - 학생이 그 책을 처음 열어본 시각          : tr_book_progress.view_confirmed_at
--
-- 안전성: 칸 추가만. 기본값이 false / 비어 있음이라 기존 책·학생 기록·화면 동작은 그대로.
-- 계획서: C:\기능구현\단어장디지털전달\IMPLEMENTATION_PLAN.md (v2, 13장)
-- =====================================================================

ALTER TABLE tr_book_documents
  ADD COLUMN IF NOT EXISTS view_confirm boolean NOT NULL DEFAULT false;

ALTER TABLE tr_book_documents
  ADD COLUMN IF NOT EXISTS allow_print boolean NOT NULL DEFAULT false;

ALTER TABLE tr_book_progress
  ADD COLUMN IF NOT EXISTS view_confirmed_at timestamptz;

COMMENT ON COLUMN tr_book_documents.view_confirm IS
  '처음 열 때 확인: true면 학생이 처음 열 때 확인 창을 띄우고, 처음 연 시각을 tr_book_progress.view_confirmed_at에 남긴다.';
COMMENT ON COLUMN tr_book_documents.allow_print IS
  'PDF 저장·인쇄 허용: true면 책 화면에 PDF 저장·인쇄 버튼을 보여준다.';
COMMENT ON COLUMN tr_book_progress.view_confirmed_at IS
  '학생이 이 책을 처음 열어본 시각 (처음 열 때 확인이 켜진 책에서 [열어보기]를 누른 시각).';

-- API가 새 칸을 바로 알도록 스키마 캐시 새로고침
NOTIFY pgrst, 'reload schema';
