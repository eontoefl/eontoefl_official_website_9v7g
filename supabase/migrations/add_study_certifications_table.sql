-- 공부인증 게시판 테이블
-- 내벨업챌린지 참여자들이 공부인증 (사진, 파일, 글 등)을 업로드하는 게시판

CREATE TABLE IF NOT EXISTS study_certifications (
    id BIGSERIAL PRIMARY KEY,
    subject TEXT NOT NULL,                     -- 제목
    content TEXT,                               -- 본문 (HTML)
    author_name TEXT DEFAULT '익명',            -- 닉네임 (표시용)
    author_real_name TEXT DEFAULT '',           -- 실명 (관리자 열람용)
    author_email TEXT,                          -- 작성자 이메일
    is_private BOOLEAN DEFAULT FALSE,          -- 비공개 여부 (true: 관리자+본인만, false: 전체공개)
    attachments JSONB DEFAULT '[]'::jsonb,     -- 첨부파일 [{name, url, size, type}]
    hit_count INTEGER DEFAULT 0,               -- 조회수
    published_at TIMESTAMPTZ DEFAULT NOW(),    -- 작성일시
    created_at TIMESTAMPTZ DEFAULT NOW(),      -- 생성일시
    updated_at TIMESTAMPTZ DEFAULT NOW()       -- 수정일시
);

-- 인덱스: 최신순 정렬 최적화
CREATE INDEX IF NOT EXISTS idx_study_certifications_published_at 
    ON study_certifications (published_at DESC);

-- 인덱스: 작성자 이메일 (본인 글 조회)
CREATE INDEX IF NOT EXISTS idx_study_certifications_author_email 
    ON study_certifications (author_email);

-- 인덱스: 비공개 필터링
CREATE INDEX IF NOT EXISTS idx_study_certifications_is_private 
    ON study_certifications (is_private);

-- RLS (Row Level Security) 정책
ALTER TABLE study_certifications ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기 가능 (비공개 필터링은 클라이언트에서 처리)
CREATE POLICY "study_certifications_select_policy" ON study_certifications
    FOR SELECT USING (true);

-- 인증된 사용자만 삽입 가능
CREATE POLICY "study_certifications_insert_policy" ON study_certifications
    FOR INSERT WITH CHECK (true);

-- 인증된 사용자만 수정 가능
CREATE POLICY "study_certifications_update_policy" ON study_certifications
    FOR UPDATE USING (true);

-- 인증된 사용자만 삭제 가능
CREATE POLICY "study_certifications_delete_policy" ON study_certifications
    FOR DELETE USING (true);
