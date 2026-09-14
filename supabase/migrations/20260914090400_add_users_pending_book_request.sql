-- =====================================================================
-- users.pending_book_request 열 추가 — 운영 적용 이력의 복사본
--
-- 이 파일은 2026-09-14 운영 DB(프로젝트 qpqjevecjejvbeuogtbx)에
-- Supabase MCP apply_migration으로 이미 적용된 migration
-- version 20260914090400 / name add_users_pending_book_request 의
-- SQL을 그대로 옮긴 것이다(새 버전명을 임의로 만든 것이 아님).
--
-- 배경:
--   book-request.html에서 마케팅 수신에 동의하지 않고 제출하면 회원만
--   생성되고 학습 답변(점수·목표·고민·기간·유입경로·호주/뉴질랜드 답변·
--   유입 추적값)은 어디에도 저장되지 않아, 나중에 내 대시보드에서
--   동의하면 빈 신청서가 만들어졌다. 이 열은 미동의 제출 시 그 답변을
--   회원 행에 보관했다가 대시보드 동의 시 같은 답변으로 입문서 신청서를
--   만들고 NULL로 정리한다.
--   (js/book-request.js savePendingBookAnswers →
--    js/dashboard.js loadPendingBookAnswers / handleUnlockGuide)
--
-- 값(JSONB): current_score, target_score, no_target_score, stuck_area,
--   goal_timeframe, referral_source, referral_source_detail,
--   is_au_nz_direct_submit, referrer_url, landing_url, utm_data,
--   user_agent, answered_at(기록용, 신청 일자로 쓰지 않음)
--
-- 비고:
--   - 열 추가 외 변경 없음. 기존 행은 전부 NULL. 권한/정책 변경 없음.
--   - 신청서(applications) 존재로 판단하는 입문서 열람·후속메일 대상·
--     재신청 차단은 이 열과 무관하다.
-- =====================================================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS pending_book_request JSONB DEFAULT NULL;

COMMENT ON COLUMN public.users.pending_book_request IS '입문서 신청서를 마케팅 미동의로 제출했을 때 보관하는 학습 답변(JSON). 대시보드에서 동의하면 applications로 옮기고 NULL 처리.';
