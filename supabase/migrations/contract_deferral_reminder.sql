-- =====================================================================
-- 계약서 유예 만료 24시간 전 리마인더 알림톡 (50222) 자동 발송
--
-- - 관리자가 계약서 기한 유예를 설정한 건(contract_deadline_override IS NOT NULL)
-- - 아직 계약서에 동의하지 않은 건(contract_agreed = false 또는 NULL)
-- - 유예 만료까지 24시간 이내로 남은 건
-- - 한 건당 1회만 발송 (contract_deferral_reminder_sent_at NULL 체크)
-- - pg_cron 5분 주기로 실행
--
-- 컬럼 타입:
--   contract_deadline_override      : timestamptz
--   contract_agreed                 : boolean
--   contract_deferral_reminder_sent_at : timestamptz
--
-- 사전 조건:
--   add_contract_deadline_override.sql 을 먼저 실행하여 컬럼이 존재해야 함.
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor에서 본 파일 전체를 실행.
-- =====================================================================

CREATE OR REPLACE FUNCTION process_contract_deferral_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_deadline_label text;
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

    -- 발송 대상 조회
    -- 조건:
    --   (1) 계약서 유예가 설정됨 (contract_deadline_override IS NOT NULL)
    --   (2) 아직 계약서 동의 안 함 (contract_agreed IS NULL OR contract_agreed = false)
    --   (3) 유예 만료까지 24시간 이내 (now() >= contract_deadline_override - interval '24 hours')
    --   (4) 아직 만료 전 (now() < contract_deadline_override)
    --   (5) 리마인더 미발송 (contract_deferral_reminder_sent_at IS NULL)
    --   (6) 전화번호 존재
    FOR rec IN
        SELECT a.id, a.name, a.phone, a.contract_deadline_override
        FROM applications a
        WHERE a.contract_deadline_override IS NOT NULL
          AND (a.contract_agreed IS NULL OR a.contract_agreed = false)
          AND a.contract_deferral_reminder_sent_at IS NULL
          AND a.phone IS NOT NULL
          AND a.phone <> ''
          AND now() >= (a.contract_deadline_override - interval '24 hours')
          AND now() < a.contract_deadline_override
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        -- 발송 시각 먼저 기록 (중복 발송 방지)
        UPDATE applications
        SET contract_deferral_reminder_sent_at = now()
        WHERE id = rec.id;

        -- 마감일 포맷 (KST 기준, 예: "5월 15일")
        v_deadline_label := to_char(rec.contract_deadline_override AT TIME ZONE 'Asia/Seoul', 'MM월 DD일');

        -- 알림톡 발송 (Edge Function 호출)
        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'contract_deferral_reminder',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'deadline', v_deadline_label
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );
    END LOOP;
END;
$$;

-- pg_cron 등록 (매 5분 실행)
SELECT cron.schedule(
    'process-contract-deferral-reminders',
    '*/5 * * * *',
    'SELECT process_contract_deferral_reminders()'
);
