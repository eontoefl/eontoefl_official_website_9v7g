-- 공지 켜짐 여부 칸 삭제 (active_until 전환 완료 후 적용)
-- 적용 전 확인: 테스트룸·공홈 관리자가 active_until 기준으로 배포되어 있고,
--               배포 후 캐시 시간(약 10분)이 지났을 것.
-- 2026-11-02 조회 기준 이 칸을 쓰는 정책·뷰·함수·트리거·예약 작업 없음.

ALTER TABLE tr_notices
DROP COLUMN IF EXISTS is_active;