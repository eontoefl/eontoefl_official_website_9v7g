-- =====================================================================
-- 프로모션 학생 동의 마감 6시간 전 알림톡 (50215) 자동 발송 — v2
--
-- 변경 사항 (v1 대비):
--   기준 컬럼을 analysis_saved_at → analysis_first_saved_at 으로 변경.
--
-- 배경:
--   v1 cron은 analysis_saved_at(매번 갱신되는 컬럼) 기준으로 동작.
--   관리자가 분석을 수정 저장하면 데드라인 윈도우가 새 시점으로 밀려
--   "한 학생당 1회 발송"이 새 사이클로 갱신되는 문제가 있었음.
--
--   사용자 결정사항: "5일 데드라인은 최초 저장 시점부터 흘러간다.
--   중간에 수정해도 시간은 계속 흘러가야 한다."
--
--   이에 따라 applications.analysis_first_saved_at(최초 저장 시각만 기록)
--   컬럼을 신설했고, 본 cron도 그 컬럼 기준으로 변경한다.
--   결과적으로 관리자가 분석을 수정 저장해도 6시간 전 알림 시점은
--   첫 저장 시각 기준으로 고정된다.
--
-- 컬럼 타입 (확인 완료):
--   analysis_first_saved_at : bigint  (Date.now() 밀리초 정수)
--   student_agreed_at       : text    (ISO 문자열)
--   incentive_warning_sent_at : timestamptz
--
-- 사전 조건:
--   add_analysis_first_saved_at.sql 을 먼저 실행하여 컬럼이 존재해야 함.
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체를 실행.
--   기존 process_incentive_deadline_warnings() 함수가 새 정의로 교체된다.
--   pg_cron 스케줄(매 5분)은 기존 등록을 그대로 사용한다.
-- =====================================================================

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

    -- 현재 시각을 밀리초로 (analysis_first_saved_at과 같은 단위로 비교)
    v_now_ms := (extract(epoch from now()) * 1000)::bigint;

    -- 발송 대상 학생 조회
    -- 조건:
    --   (1) 프로모션 학생 (is_incentive_applicant = true)
    --   (2) 아직 동의하지 않음 (student_agreed_at IS NULL or '')
    --   (3) 분석 최초 저장 시각 존재 (analysis_first_saved_at IS NOT NULL)
    --   (4) 최초 저장 후 114시간 이상, 120시간 미만 경과
    --       (114h = 410,400,000 ms / 120h = 432,000,000 ms)
    --   (5) 아직 6시간 전 알림톡을 보낸 적 없음 (incentive_warning_sent_at IS NULL)
    --   (6) 전화번호 존재
    FOR rec IN
        SELECT a.id, a.name, a.phone
        FROM applications a
        WHERE a.is_incentive_applicant = true
          AND (a.student_agreed_at IS NULL OR a.student_agreed_at = '')
          AND a.analysis_first_saved_at IS NOT NULL
          AND a.incentive_warning_sent_at IS NULL
          AND a.phone IS NOT NULL
          AND a.phone <> ''
          AND (v_now_ms - a.analysis_first_saved_at) >= (114 * 3600 * 1000)::bigint
          AND (v_now_ms - a.analysis_first_saved_at) <  (120 * 3600 * 1000)::bigint
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

-- pg_cron 스케줄은 기존 등록을 그대로 사용.
-- (이미 'process-incentive-deadline-warnings' 잡이 5분 주기로 등록되어 있음)
-- 만약 이 함수가 처음 등록되는 환경이라면 아래 주석을 해제하여 등록하세요.
--
-- SELECT cron.schedule(
--     'process-incentive-deadline-warnings',
--     '*/5 * * * *',
--     'SELECT process_incentive_deadline_warnings()'
-- );
