-- 개별분석 AI 피드백 재생성(다시 제작) 결과 임시 저장 컬럼
-- 관리자 모달에서 [피드백 반영해 다시 제작] 클릭 시:
--   n8n 워크플로우가 재생성 결과를 이 컬럼에 쓰고(analysis_content는 안 건드림),
--   프론트가 폴링해서 값이 채워지면 분석칸에 넣고 다시 비운다.
-- 비동기 전달용 "서랍" — 영구 데이터가 아니라 사용 후 NULL로 정리됨.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS analysis_regen_result TEXT DEFAULT NULL;

COMMENT ON COLUMN applications.analysis_regen_result
  IS 'AI 피드백 재생성 결과 임시 전달용(서랍). 관리자 폴링 후 NULL로 정리.';
