-- =====================================================================
-- 승인 예약 기능: Supabase DB + pg_cron 마이그레이션
-- Supabase SQL Editor에서 실행하세요
-- =====================================================================

-- 1. correction_submissions 테이블에 scheduled_release_at 컬럼 추가
ALTER TABLE correction_submissions
ADD COLUMN IF NOT EXISTS scheduled_release_at timestamptz DEFAULT NULL;

-- 2. Vault에 service_role_key 저장 (최초 1회)
-- ⚠️ 실제 키 값을 Supabase Dashboard > Settings > API에서 확인하여 교체하세요
-- SELECT vault.create_secret(
--     'YOUR_SERVICE_ROLE_KEY_HERE',
--     'supabase_service_role_key'
-- );

-- 3. process_scheduled_releases 함수 생성
CREATE OR REPLACE FUNCTION process_scheduled_releases()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://gfbliyfizwkfbpfanjat.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_alim_type text;
    v_task_label text;
    v_round_str text;
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

    -- 예약 시각이 도래한 건 조회
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.phone AS student_phone
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.scheduled_release_at IS NOT NULL
          AND cs.scheduled_release_at <= now()
          AND (
              (cs.feedback_1 IS NOT NULL AND cs.released_1 = false)
              OR (cs.feedback_2 IS NOT NULL AND cs.released_2 = false)
          )
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        -- 알림톡 유형 결정 + released 플래그 업데이트
        IF rec.feedback_1 IS NOT NULL AND rec.released_1 = false THEN
            v_alim_type := 'correction_feedback_1';
            UPDATE correction_submissions
            SET released_1 = true,
                released_1_at = now(),
                scheduled_release_at = NULL
            WHERE id = rec.id;
        ELSIF rec.feedback_2 IS NOT NULL AND rec.released_2 = false THEN
            v_alim_type := 'correction_feedback_2';
            UPDATE correction_submissions
            SET released_2 = true,
                released_2_at = now(),
                scheduled_release_at = NULL
            WHERE id = rec.id;
        ELSE
            CONTINUE;
        END IF;

        -- task_type → 사람이 읽을 수 있는 라벨
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

-- 4. pg_cron 등록 (매분 실행)
SELECT cron.schedule(
    'process-scheduled-releases',
    '* * * * *',
    'SELECT process_scheduled_releases()'
);
