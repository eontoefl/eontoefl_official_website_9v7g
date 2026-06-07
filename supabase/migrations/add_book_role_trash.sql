-- 입문서 관리 페이지용: 역할 라벨 + 휴지통(소프트 삭제)
-- (추가만 — 기존 데이터 영향 없음)

-- 책 역할: regular(일반) / australia(호주) / etc(기타). 학생 화면 연결은 출시 때.
ALTER TABLE tr_book_documents ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'etc';

-- 휴지통: 삭제 시각. NULL=정상, 값 있으면 휴지통(30일 후 영구삭제 대상).
ALTER TABLE tr_book_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN tr_book_documents.role IS '책 역할: regular/australia/etc. 학생 화면이 어떤 책을 보여줄지 결정용.';
COMMENT ON COLUMN tr_book_documents.deleted_at IS '휴지통 이동 시각(소프트삭제). NULL=정상. 30일 경과 시 영구삭제 대상.';
