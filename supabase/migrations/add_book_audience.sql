-- =====================================================================
-- "내 서재" — 책별 공개 대상(audience) 지원
--
-- 목적:
--   책마다 "누가 볼 수 있나"를 정한다.
--   - is_active (기존) : 공개/숨김 마스터 스위치
--   - audience_mode    : 'all'(전체공개=결제자 전원) | 'selected'(특정 학생만)
--   - tr_book_access    : audience_mode='selected'일 때 볼 수 있는 학생 목록
--
-- 안전성: 전부 추가/기본값이라 기존 책·학생 기록에 영향 없음.
--   기존 책은 audience_mode 기본값 'all' → 지금 동작(전원 공개)과 동일.
--
-- 2026-07
-- =====================================================================

-- 책 공개 대상 방식
ALTER TABLE tr_book_documents
  ADD COLUMN IF NOT EXISTS audience_mode TEXT NOT NULL DEFAULT 'all';

COMMENT ON COLUMN tr_book_documents.audience_mode IS
  '공개 대상: all(공개 시 결제자 전원) | selected(tr_book_access에 등록된 학생만). is_active=false면 무관(아무도 못 봄).';

-- 특정 학생 접근 목록 (audience_mode='selected'용)
--   user_id = users.id (테스트룸 로그인 사용자 식별자). FK는 걸지 않음(다른 앱과의 결합 최소화).
CREATE TABLE IF NOT EXISTS tr_book_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES tr_book_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  student_name TEXT,          -- 관리 화면 표시용(스냅샷). 판정엔 user_id만 사용.
  student_email TEXT,         -- 관리 화면 표시용(스냅샷)
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_book_access ON tr_book_access (book_id, user_id);
CREATE INDEX IF NOT EXISTS idx_book_access_user ON tr_book_access (user_id);
CREATE INDEX IF NOT EXISTS idx_book_access_book ON tr_book_access (book_id);

COMMENT ON TABLE tr_book_access IS '책별 "특정 학생에게만 공개" 접근 목록. audience_mode=selected일 때 사용.';
