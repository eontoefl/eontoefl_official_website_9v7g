-- 공지사항(tr_notices) 공개 대상 컬럼
-- admin-settings.html#notices 에서 공지 등록 시 일반내챌/호주내챌 중 공개 범위를 선택할 수 있게 함
--   'all'       : 전체 공개 (일반내챌 + 호주내챌)  ← 기본값, 기존 공지도 이 값으로 간주
--   'regular'   : 일반내챌 학생에게만 표시
--   'australia' : 호주내챌 학생에게만 표시
-- 테스트룸 index.html loadNotices()가 currentUser.program 의 'Australia' 포함 여부로 필터링함
ALTER TABLE tr_notices
ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';
