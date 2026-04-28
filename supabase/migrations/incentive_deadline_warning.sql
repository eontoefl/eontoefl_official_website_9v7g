-- =====================================================================
-- 프로모션 학생 동의 마감 6시간 전 알림톡 (50215) 자동 발송
-- - 분석 저장 시점(analysis_saved_at, bigint = ms)으로부터
--   114~120시간 사이에 1회 발송
-- - 동의(student_agreed_at)한 학생은 자동 제외
-- - 한 학생당 1회만 발송 (incentive_warning_sent_at NULL 체크)
-- - pg_cron 5분 주기로 실행
--
-- 컬럼 타입 (확인 완료):
--   analysis_saved_at : bigint  (Date.now() 밀리초 정수)
--   student_agreed_at : text    (ISO 문자열)
--   incentive_warning_sent_at (신규) : timestamptz
--
-- Supabase SQL Editor에서 실행하세요
-- =====================================================================

-- 1. applications 테이블에 incentive_warning_sent_at 컬럼 추가
--    (D-6h 알림톡 발송 시각 기록 — 중복 발송 방지용)
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS incentive_warning_sent_at timestamptz DEFAULT NULL;

-- 2. process_incentive_deadline_warnings 함수 생성
CREATE OR REPLACE FUNCTION process_incentive_deadline_warnings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://gfbliyfizwkfbpfanjat.supabase.co/functions/v1/kakaotalk-notify';
    v_now_ms bigint;
    rec record;
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

    -- 현재 시각을 밀리초로 (analysis_saved_at과 같은 단위로 비교)
    v_now_ms := (extract(epoch from now()) * 1000)::bigint;

    -- 발송 대상 학생 조회
    -- 조건:
    --   (1) 프로모션 학생 (is_incentive_applicant = true)
    --   (2) 아직 동의하지 않음 (student_agreed_at IS NULL or '')
    --   (3) 분석 저장 시각 존재 (analysis_saved_at IS NOT NULL)
    --   (4) 분석 저장 후 114시간 이상, 120시간 미만 경과
    --       (114h = 410,400,000 ms / 120h = 432,000,000 ms)
    --   (5) 아직 6시간 전 알림톡을 보낸 적 없음 (incentive_warning_sent_at IS NULL)
    --   (6) 전화번호 존재
    FOR rec IN
        SELECT a.id, a.name, a.phone
        FROM applications a
        WHERE a.is_incentive_applicant = true
          AND (a.student_agreed_at IS NULL OR a.student_agreed_at = '')
          AND a.analysis_saved_at IS NOT NULL
          AND a.incentive_warning_sent_at IS NULL
          AND a.phone IS NOT NULL
          AND a.phone <> ''
          AND (v_now_ms - a.analysis_saved_at) >= (114 * 3600 * 1000)::bigint
          AND (v_now_ms - a.analysis_saved_at) <  (120 * 3600 * 1000)::bigint
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        -- 발송 시각 먼저 기록 (중복 발송 방지 — race condition 방지)
        UPDATE applications
        SET incentive_warning_sent_at = now()
        WHERE id = rec.id;

        -- 알림톡 발송 (Edge Function 호출)
        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'incentive_deadline_warning',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'time', '6'
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

-- 3. pg_cron 등록 (매 5분 실행)
SELECT cron.schedule(
    'process-incentive-deadline-warnings',
    '*/5 * * * *',
    'SELECT process_incentive_deadline_warnings()'
);
