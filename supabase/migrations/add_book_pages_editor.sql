-- =====================================================================
-- 입문서 자체 에디터(BlockNote) 지원용 스키마
--
-- 추가:
--   - tr_book_pages          : 페이지 단위 콘텐츠 (편집본 blocks + 렌더본 html)
--   - tr_book_page_versions  : 페이지별 버전 백업(되돌리기)
-- 보강(회의에서 정한 손질):
--   - tr_book_documents : PDF 전용 제약 해제(storage_path/total_pages) + kind 구분
--   - tr_book_memos     : 안정적 페이지 앵커(page_uid) 추가
--
-- 안전성:
--   - 전부 "추가/제약 완화"라 기존 PDF 책·학생 기록은 영향 없음(기본값 호환).
--   - 새 'pages' 책은 이 마이그레이션이 만들지 않음(스키마만). 데이터는 이후 단계에서.
--   - 새 책은 활성화 전까지 is_active=false로 둬서 기존 book.html(PDF 뷰어)이
--     절대 집어가지 않게 한다(기존 뷰어는 건드리지 않음).
--
-- 2026-06
-- =====================================================================

-- ---------------------------------------------------------------------
-- 손질 1) 책 테이블: 새 책은 PDF가 없으므로 제약 완화 + 종류 구분
-- ---------------------------------------------------------------------
ALTER TABLE tr_book_documents ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE tr_book_documents ALTER COLUMN total_pages  DROP NOT NULL;
ALTER TABLE tr_book_documents ALTER COLUMN total_pages  SET DEFAULT 0;

ALTER TABLE tr_book_documents
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'pdf';

COMMENT ON COLUMN tr_book_documents.kind IS
  '책 종류: pdf(기존 PDF 뷰어) 또는 pages(새 에디터 페이지 방식). 기존 행은 기본값 pdf로 자동 호환.';


-- ---------------------------------------------------------------------
-- 추가 1) 페이지 콘텐츠 테이블
--   id          = 페이지의 "숨은 고유번호"(불변) → 순서 바꿔도 메모/북마크 안 깨짐
--   sort_order  = 화면상 페이지 순서(1,2,3...) → 재정렬은 이 값만 바꿈
--   blocks      = 편집본(BlockNote JSON)
--   html        = 렌더본(학생 화면용 스냅샷, 저장 시 자동 생성)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tr_book_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES tr_book_documents(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  html TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_pages_book_order
  ON tr_book_pages (book_id, sort_order);

COMMENT ON TABLE  tr_book_pages         IS '입문서 페이지 콘텐츠(에디터 방식). id=불변 앵커, sort_order=표시 순서';
COMMENT ON COLUMN tr_book_pages.blocks  IS 'BlockNote 편집본(JSON)';
COMMENT ON COLUMN tr_book_pages.html    IS '학생 화면 렌더용 HTML 스냅샷(저장 시 편집본에서 자동 생성)';


-- ---------------------------------------------------------------------
-- 추가 2) 페이지 버전 백업(되돌리기) — 저장할 때마다 직전 모습 1건 보관
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tr_book_page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES tr_book_pages(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES tr_book_documents(id) ON DELETE CASCADE,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  html TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_book_page_versions_page
  ON tr_book_page_versions (page_id, created_at DESC);

COMMENT ON TABLE tr_book_page_versions IS '페이지 저장 시마다 직전 버전 백업(되돌리기용)';


-- ---------------------------------------------------------------------
-- 손질 2) 메모: 새 책은 페이지 "위치(page_number)" 대신 불변 앵커(page_uid) 사용
--   - 기존 PDF 책 메모는 page_number 그대로(page_uid=NULL) → 영향 없음
--   - 새 책 메모는 page_uid 사용(page_number=NULL 허용)
-- ---------------------------------------------------------------------
ALTER TABLE tr_book_memos ALTER COLUMN page_number DROP NOT NULL;

ALTER TABLE tr_book_memos
  ADD COLUMN IF NOT EXISTS page_uid UUID REFERENCES tr_book_pages(id) ON DELETE CASCADE;

-- 새 책(page_uid 방식)에서 "한 페이지에 메모 1개" 보장(부분 유니크)
CREATE UNIQUE INDEX IF NOT EXISTS uq_book_memos_uid
  ON tr_book_memos (user_id, book_id, page_uid)
  WHERE page_uid IS NOT NULL;

COMMENT ON COLUMN tr_book_memos.page_uid IS
  '에디터 방식 책의 안정적 페이지 앵커(tr_book_pages.id). 순서 바꿔도 유지. 기존 PDF 책은 NULL.';

-- 참고: 북마크는 tr_book_progress.bookmarks(JSONB 배열)에 그대로 저장하되,
--       새 책에서는 페이지 번호 대신 page_uid 문자열 배열을 담는다(스키마 변경 불필요).
