-- =====================================================================
-- 첨삭 AI 채점 자동 재실행 기능
--
-- 기능 개요:
--   AI 채점이 "실패로 끝난 건(feedbackN_failed)" 또는 "멈춘 건
--   (draftN_submitted인데 오래 피드백이 없는 것)"을 서버가 스스로 감지해
--   n8n 채점 워크플로우를 다시 호출한다. 최대 2번까지 시도하고,
--   그래도 안 되면 선생님께 텔레그램으로 알린다.
--
-- 회의 확정 스펙 (2026-08-03):
--   - 최대 자동 재시도: 2번
--   - 타이밍: 실패 건 = 3분 뒤 / 멈춤 건 = 15분 뒤 (느린 원작업과 겹침 방지)
--   - 2번 소진 후에도 미복구면 텔레그램 알림 1회 (telegram-notify Edge Function)
--
-- 동작 방식:
--   pg_cron이 매 2분마다 process_auto_retry_corrections() 실행.
--   재실행: net.http_post로 n8n 웹훅 직접 호출 (학생 제출과 동일 payload).
--   실패 알림: net.http_post로 telegram-notify 호출 (type=correction_retry_failed).
--
-- 사전 조건:
--   - Vault에 'supabase_service_role_key' 등록되어 있어야 함 (telegram-notify 인증용)
--   - pg_net / pg_cron 확장 활성화 (기존 cron 함수들과 동일)
--   - telegram-notify Edge Function에 correction_retry_failed 케이스 배포되어 있어야 함
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체 실행.
-- =====================================================================

-- 0. 재시도 추적용 컬럼
ALTER TABLE correction_submissions
    ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_auto_retry_at timestamptz,
    ADD COLUMN IF NOT EXISTS retry_failed_notified boolean NOT NULL DEFAULT false;

-- 1. 자동 재실행 함수
CREATE OR REPLACE FUNCTION process_auto_retry_corrections()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_tg_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/telegram-notify';
    v_n8n_base text := 'https://eontoefl.app.n8n.cloud/webhook';
    v_max_retries int := 2;
    v_failed_delay interval := interval '3 minutes';
    v_stuck_delay  interval := interval '15 minutes';
    rec record;
    v_is_draft1 boolean;
    v_is_failed boolean;
    v_feedback_present boolean;
    v_submitted_at timestamptz;
    v_base_at timestamptz;
    v_needed interval;
    v_webhook text;
    v_event text;
    v_draft_round int;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- ===== 1) 자동 재실행 =====
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.email AS student_email
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.auto_retry_count < v_max_retries
          AND cs.status IN ('feedback1_failed','feedback2_failed','draft1_submitted','draft2_submitted')
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        v_is_draft1 := rec.status IN ('feedback1_failed','draft1_submitted');
        v_is_failed := rec.status IN ('feedback1_failed','feedback2_failed');

        IF v_is_draft1 THEN
            v_submitted_at := rec.draft_1_submitted_at;
            v_feedback_present := rec.feedback_1 IS NOT NULL;
        ELSE
            v_submitted_at := rec.draft_2_submitted_at;
            v_feedback_present := rec.feedback_2 IS NOT NULL;
        END IF;

        -- draftN_submitted인데 피드백이 이미 있으면 = 승인 대기(정상). 건너뜀.
        IF (NOT v_is_failed) AND v_feedback_present THEN
            CONTINUE;
        END IF;

        -- 대기시간 판정: 실패=3분 / 멈춤=15분. 기준은 마지막 재실행 시각 또는 최초 제출 시각.
        v_needed := CASE WHEN v_is_failed THEN v_failed_delay ELSE v_stuck_delay END;
        v_base_at := COALESCE(rec.last_auto_retry_at, v_submitted_at);
        IF v_base_at IS NULL OR (now() - v_base_at) < v_needed THEN
            CONTINUE;
        END IF;

        -- 과제 유형 + 차수 → n8n 웹훅 (admin-correction.js 매핑과 동일). 미준비 유형은 건너뜀.
        v_webhook := NULL;
        IF rec.task_type IN ('writing_email','writing_discussion') THEN
            v_webhook := v_n8n_base || CASE WHEN v_is_draft1 THEN '/correction-writing-draft1' ELSE '/correction-writing-draft2' END;
        ELSIF rec.task_type = 'speaking_interview' THEN
            v_webhook := v_n8n_base || CASE WHEN v_is_draft1 THEN '/correction-speaking-draft1' ELSE '/correction-speaking-draft2' END;
        ELSIF rec.task_type = 'writing_aus_discussion' AND v_is_draft1 THEN
            v_webhook := v_n8n_base || '/correction-aus-writing-draft1';
        END IF;

        IF v_webhook IS NULL THEN
            CONTINUE;  -- 워크플로우 미준비 유형
        END IF;

        v_event := CASE WHEN v_is_draft1 THEN 'draft1_submitted' ELSE 'draft2_submitted' END;

        -- 실패 건은 상태를 제출 직후로 되돌린다. 공통으로 카운트/시각 갱신.
        UPDATE correction_submissions
        SET status = CASE WHEN v_is_failed THEN v_event ELSE status END,
            auto_retry_count = auto_retry_count + 1,
            last_auto_retry_at = now()
        WHERE id = rec.id;

        -- n8n 재실행 호출 (학생 제출과 동일 payload)
        PERFORM net.http_post(
            url := v_webhook,
            body := jsonb_build_object(
                'event', v_event,
                'user_id', rec.user_id,
                'user_name', COALESCE(rec.student_name, ''),
                'user_email', COALESCE(rec.student_email, ''),
                'session_number', rec.session_number,
                'task_type', rec.task_type,
                'task_number', rec.task_number
            ),
            headers := jsonb_build_object('Content-Type', 'application/json')
        );
    END LOOP;

    -- ===== 2) 자동 재실행 2번 소진 후에도 미복구 → 선생님께 텔레그램 알림 (1회) =====
    FOR rec IN
        SELECT cs.*, u.name AS student_name
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.retry_failed_notified = false
          AND cs.auto_retry_count >= v_max_retries
          AND cs.status IN ('feedback1_failed','feedback2_failed','draft1_submitted','draft2_submitted')
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        v_is_draft1 := rec.status IN ('feedback1_failed','draft1_submitted');
        v_is_failed := rec.status IN ('feedback1_failed','feedback2_failed');

        IF v_is_draft1 THEN
            v_feedback_present := rec.feedback_1 IS NOT NULL;
        ELSE
            v_feedback_present := rec.feedback_2 IS NOT NULL;
        END IF;

        -- 미복구 판정:
        --   실패 상태면 무조건 알림 대상.
        --   멈춤 상태면 마지막 재실행 후 15분 지나도록 피드백이 없을 때만(여전히 멈춤).
        IF v_is_failed THEN
            NULL;
        ELSIF (NOT v_feedback_present)
              AND rec.last_auto_retry_at IS NOT NULL
              AND (now() - rec.last_auto_retry_at) >= v_stuck_delay THEN
            NULL;
        ELSE
            CONTINUE;  -- 복구됐거나 아직 처리 중
        END IF;

        v_draft_round := CASE WHEN v_is_draft1 THEN 1 ELSE 2 END;

        PERFORM net.http_post(
            url := v_tg_url,
            body := jsonb_build_object(
                'type', 'correction_retry_failed',
                'data', jsonb_build_object(
                    'submission_id', rec.id,
                    'name', COALESCE(rec.student_name, ''),
                    'session_number', rec.session_number,
                    'task_type', rec.task_type,
                    'draft_round', v_draft_round
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );

        UPDATE correction_submissions
        SET retry_failed_notified = true
        WHERE id = rec.id;
    END LOOP;
END;
$$;

-- 2. pg_cron 등록 (매 2분 실행)
SELECT cron.schedule(
    'process-auto-retry-corrections',
    '*/2 * * * *',
    'SELECT process_auto_retry_corrections()'
);

-- 등록 확인용 쿼리 (실행 후):
-- SELECT * FROM cron.job WHERE jobname = 'process-auto-retry-corrections';
