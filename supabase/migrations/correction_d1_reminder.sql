-- =====================================================================
-- 스라첨삭 시작 D-1 리마인더 알림톡 (50200) 자동 발송
--
-- ⚠️ 이 파일은 DB에 직접 등록된 함수의 레포 사본입니다.
--    실제 함수는 Supabase DB에 이미 배포되어 운영 중입니다.
--    수정이 필요하면 DB의 함수도 함께 업데이트해야 합니다.
--
-- 기능 개요:
--   매일 KST 10:00에 실행되어, correction_schedules 테이블에서
--   start_date가 내일(D-1)인 학생을 찾아 correction_start_reminder
--   알림톡을 발송한다.
--
-- 동작 조건:
--   (1) correction_schedules.start_date = 내일 (D-1 시점)
--   (2) kakaotalk_d1_sent = false (미발송 건만)
--   (3) 학생 전화번호 존재
--
-- 발송 후:
--   kakaotalk_d1_sent = true, kakaotalk_d1_sent_at = now() 로 마킹
--
-- 알림톡 템플릿:
--   correction_start_reminder (50200) — Edge Function kakaotalk-notify 호출
--
-- 주기: pg_cron 매일 KST 10:00 (= UTC 01:00)
--
-- 관련 테이블:
--   correction_schedules (user_id, start_date, duration_weeks, kakaotalk_d1_sent, kakaotalk_d1_sent_at)
--
-- 사전 조건:
--   - Vault에 'supabase_service_role_key' 등록
--   - pg_net 확장 활성화
-- =====================================================================

CREATE OR REPLACE FUNCTION send_correction_d1_alimtalk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_tomorrow date;
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

    -- KST 기준 내일 날짜
    v_tomorrow := (now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day';

    -- D-1 대상자 조회 (내일 시작하는 학생 중 미발송 건)
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.phone AS student_phone,
               a.id AS app_id, a.assigned_program
        FROM correction_schedules cs
        LEFT JOIN users u ON u.id = cs.user_id
        LEFT JOIN applications a ON a.user_id = cs.user_id AND a.correction_enabled = true
        WHERE cs.start_date = v_tomorrow
          AND (cs.kakaotalk_d1_sent = false OR cs.kakaotalk_d1_sent IS NULL)
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        -- 발송 마킹 (중복 방지)
        UPDATE correction_schedules
        SET kakaotalk_d1_sent = true,
            kakaotalk_d1_sent_at = now()
        WHERE user_id = rec.user_id;

        -- 알림톡 발송
        IF rec.student_phone IS NOT NULL AND rec.student_phone != '' THEN
            PERFORM net.http_post(
                url := v_edge_url,
                body := jsonb_build_object(
                    'type', 'correction_start_reminder',
                    'data', jsonb_build_object(
                        'name', COALESCE(rec.student_name, ''),
                        'phone', rec.student_phone,
                        'start_date', to_char(rec.start_date, 'MM월 DD일'),
                        'program', COALESCE(rec.assigned_program, '스라첨삭')
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

-- pg_cron 등록 (매일 UTC 01:00 = KST 10:00)
SELECT cron.schedule(
    'send-correction-d1-alimtalk',
    '0 1 * * *',
    'SELECT send_correction_d1_alimtalk()'
);
