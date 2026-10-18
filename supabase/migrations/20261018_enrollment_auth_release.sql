-- =====================================================================
-- 인증률 통일 — 라이브 반영 (대표 "라이브 반영" 지시 후에만 실행)
--   선행: 20261018_enrollment_auth.sql (admin_study_list_next 등 추가)
--   하는 일: 옛 목록 계산 admin_study_list(date)를 지우고, admin_study_list_next 이름을 admin_study_list로 바꾼다.
--            공홈 관리자 학습관리는 이름 그대로 admin_study_list를 부르므로 코드 변경 없이 새 계산으로 넘어간다.
--   되돌리기: ALTER FUNCTION public.admin_study_list(timestamptz) RENAME TO admin_study_list_next;
--             그리고 20261018_admin_study_list.sql 다시 실행(옛 admin_study_list(date) 복원).
-- =====================================================================
BEGIN;
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'admin_study_list_next') THEN
    RAISE EXCEPTION 'ABORT admin_study_list_next 없음 — 20261018_enrollment_auth.sql 먼저';
  END IF;
END $chk$;
DROP FUNCTION IF EXISTS public.admin_study_list(date);
ALTER FUNCTION public.admin_study_list_next(timestamptz) RENAME TO admin_study_list;
COMMENT ON FUNCTION public.admin_study_list(timestamptz) IS
  '관리자 학습관리 목록(수강마다 1개, jsonb 배열). 인증률은 _auth_core. 계획: C:\기능구현\인증률통일';
COMMIT;
NOTIFY pgrst, 'reload schema';
