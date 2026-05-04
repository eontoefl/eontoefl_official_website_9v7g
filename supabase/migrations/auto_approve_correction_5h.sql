-- =====================================================================
-- 첨삭 자동 승인 기능 (5시간 경과 시)
--
-- 기능 개요:
--   AI 피드백 생성 후 5시간이 지났는데 관리자가 승인하지 않은 건을
--   자동으로 승인(released) 처리하고, 학생에게 카카오 알림톡을 발송한다.
--
-- 동작 조건:
--   (1) feedback_1 또는 feedback_2가 존재 (AI 처리 완료)
--   (2) 해당 피드백이 아직 미승인 (released_1=false 또는 released_2=false)
--   (3) 피드백 생성 시각(feedback_1_at / feedback_2_at)으로부터 5시간 경과
--   (4) 수동 예약 승인이 걸려있지 않음 (scheduled_release_at IS NULL)
--       → 관리자가 직접 승인하거나 예약 승인을 건 건은 건드리지 않음
--
-- 알림톡:
--   기존 템플릿 그대로 사용
--   - 1차: correction_feedback_1 (50211)
--   - 2차: correction_feedback_2 (50212)
--
-- 주기: pg_cron 매 5분
--
-- 사전 조건:
--   - Vault에 'supabase_service_role_key' 이미 등록되어 있어야 함
--   - pg_net 확장 활성화 (기존 cron 함수들과 동일)
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체를 실행.
-- =====================================================================

-- 1. 자동 승인 함수 생성
CREATE OR REPLACE FUNCTION process_auto_approve_corrections()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_alim_type text;
    v_task_label text;
    v_round_str text;
    v_feedback_at timestamptz;
BEGIN
    -- Vault에서 service_role_key 조회
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- 5시간 경과 + 미승인 + 수동 예약 없는 건 조회
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.phone AS student_phone
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.scheduled_release_at IS NULL
          AND (
              -- 케이스 A: 1차 피드백 존재 + 미승인 + 5시간 경과
              (
                  cs.feedback_1 IS NOT NULL
                  AND cs.released_1 = false
                  AND cs.feedback_1_at IS NOT NULL
                  AND cs.feedback_1_at <= (now() - interval '5 hours')
              )
              OR
              -- 케이스 B: 2차 피드백 존재 + 1차는 이미 승인 + 2차 미승인 + 5시간 경과
              (
                  cs.feedback_2 IS NOT NULL
                  AND cs.released_1 = true
                  AND cs.released_2 = false
                  AND cs.feedback_2_at IS NOT NULL
                  AND cs.feedback_2_at <= (now() - interval '5 hours')
              )
          )
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        -- 알림톡 유형 결정 + released 플래그 업데이트
        IF rec.feedback_1 IS NOT NULL AND rec.released_1 = false THEN
            v_alim_type := 'correction_feedback_1';
            UPDATE correction_submissions
            SET released_1 = true,
                released_1_at = now()
            WHERE id = rec.id;
        ELSIF rec.feedback_2 IS NOT NULL AND rec.released_1 = true AND rec.released_2 = false THEN
            v_alim_type := 'correction_feedback_2';
            UPDATE correction_submissions
            SET released_2 = true,
                released_2_at = now()
            WHERE id = rec.id;
        ELSE
            CONTINUE;
        END IF;

        -- task_type → 라벨
        CASE rec.task_type
            WHEN 'writing_email' THEN v_task_label := 'Email';
            WHEN 'writing_discussion' THEN v_task_label := 'Discussion';
            WHEN 'speaking_interview' THEN v_task_label := 'Interview';
            ELSE v_task_label := rec.task_type;
        END CASE;

        v_round_str := COALESCE(rec.session_number::text, '') || '회 ' || v_task_label;

        -- 알림톡 발송 (전화번호가 있는 경우만)
        IF rec.student_phone IS NOT NULL AND rec.student_phone != '' THEN
            PERFORM net.http_post(
                url := v_edge_url,
                body := jsonb_build_object(
                    'type', v_alim_type,
                    'data', jsonb_build_object(
                        'name', COALESCE(rec.student_name, ''),
                        'phone', rec.student_phone,
                        'round', v_round_str
                    )
                ),
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_service_key
                )
            );
        END IF;
    END LOOP;
END;
$$;

-- 2. pg_cron 등록 (매 5분 실행)
SELECT cron.schedule(
    'process-auto-approve-corrections',
    '*/5 * * * *',
    'SELECT process_auto_approve_corrections()'
);

-- 등록 확인용 쿼리 (실행 후 결과 확인):
-- SELECT * FROM cron.job WHERE jobname = 'process-auto-approve-corrections';
