-- =====================================================================
-- 전체 유예 (계약서 + 입금) 기능
--
-- 배경:
--   기존 deposit_deadline_override는 "계약 동의 완료" 학생에게만 적용
--   되는 입금 기한 연장 기능이었음.
--
--   본 마이그레이션은 그 이전 단계 — 즉 "개별분석 동의는 했지만 계약서
--   작성/동의 전" 학생에게도 유예를 걸 수 있도록 한다.
--   관리자가 full_deferral_until 을 지정하면:
--     1) 그 시각까지는 계약서 발송이 보류된다.
--     2) 입금 안내도 가지 않는다.
--     3) 학생 화면에서 계약서 / 입금 단계가 "유예 중"으로 표시된다.
--     4) 유예 기한 24시간 전에 알림톡 (full_deferral_reminder) 이 발송된다.
--     5) 기한이 지나면 계약서가 자동 발송되며 정상 흐름이 재개된다
--        (계약서 자동 발송은 학생 페이지 로드 시점에 트리거됨).
-- =====================================================================

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS full_deferral_until timestamptz DEFAULT NULL;

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS full_deferral_reminder_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN applications.full_deferral_until
IS '관리자가 지정한 전체 유예 기한 (계약서 발송 + 입금 모두 유예). NULL이면 유예 없음.';

COMMENT ON COLUMN applications.full_deferral_reminder_sent_at
IS '전체 유예 기한 1일 전 알림톡 발송 시각 (중복 발송 방지). NULL이면 미발송.';

-- =====================================================================
-- cron 함수: 전체 유예 1일 전 리마인더 알림톡 (full_deferral_reminder) 발송
--
-- 실행 주기: 매 5분 (pg_cron)
-- 발송 조건:
--   (1) full_deferral_until 이 설정되어 있음
--   (2) 아직 1일 전 알림을 보낸 적 없음 (full_deferral_reminder_sent_at IS NULL)
--   (3) 유예 기한이 24시간 이내로 임박 (now < full_deferral_until <= now+24h)
--   (4) 전화번호 존재
-- =====================================================================

CREATE OR REPLACE FUNCTION process_full_deferral_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    FOR rec IN
        SELECT a.id, a.name, a.phone, a.full_deferral_until
        FROM applications a
        WHERE a.full_deferral_until IS NOT NULL
          AND a.full_deferral_reminder_sent_at IS NULL
          AND a.full_deferral_until > now()
          AND a.full_deferral_until <= now() + interval '24 hours'
          AND a.phone IS NOT NULL
          AND a.phone <> ''
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        -- 발송 시각 먼저 기록 (race condition 방지)
        UPDATE applications
        SET full_deferral_reminder_sent_at = now()
        WHERE id = rec.id;

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'full_deferral_reminder',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'deadline', to_char(rec.full_deferral_until AT TIME ZONE 'Asia/Seoul', 'MM월 DD일')
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

-- pg_cron 등록 (이미 등록되어 있다면 SELECT 부분은 생략)
--
-- SELECT cron.schedule(
--     'process-full-deferral-reminders',
--     '*/5 * * * *',
--     'SELECT process_full_deferral_reminders()'
-- );
