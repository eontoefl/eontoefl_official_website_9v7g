-- =====================================================================
-- 개별분석 예약 발송 기능
--
-- 기능 개요:
--   관리자가 개별분석 저장 시, 즉시 발송 대신 특정 시각에 예약 발송 가능.
--   예약 시각이 도래하면:
--     (1) 임시 보관된 분석 데이터를 정식 컬럼으로 이전 (학생에게 공개)
--     (2) 알림톡 발송 (analysis_complete / incentive_analysis_complete / analysis_updated)
--     (3) analysis_first_saved_at, analysis_saved_at = 발송 시각으로 세팅
--         (= 동의 데드라인 카운트다운이 발송 시점부터 시작)
--
-- 핵심 설계:
--   - 즉시 발송: 기존 로직 그대로 (analysis_status / analysis_content 등을
--     applications 테이블에 직접 저장 + 클라이언트에서 알림톡 발송)
--   - 예약 발송: 정식 컬럼은 비워두고 *_pending 컬럼에 보관.
--     analysis_alimtalk_scheduled_at 시각이 되면 pg_cron이 처리.
--   - 학생은 *_pending 컬럼 존재만으로는 분석을 볼 수 없음.
--     analysis_status / analysis_content / analysis_saved_at 등이 채워질 때만
--     공개됨 (analysis-view.js, application-detail.js, dashboard.js의 기존 로직).
--
-- 컬럼 타입:
--   analysis_alimtalk_scheduled_at : timestamptz (예약 발송 시각, NULL이면 예약 없음)
--   analysis_status_pending        : text       (예약 중 임시 보관)
--   analysis_content_pending       : text
--   analysis_pending_payload       : jsonb      (나머지 필드 일괄 보관)
--                                                (assigned_program, schedule_start,
--                                                 schedule_end, program_price,
--                                                 discount_amount, additional_discount,
--                                                 discount_reason, final_price,
--                                                 correction_enabled, correction_start_date,
--                                                 correction_fee, is_incentive_applicant,
--                                                 is_analysis_update)
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체를 실행.
-- =====================================================================

-- 1. applications 테이블에 예약 관련 컬럼 추가
ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS analysis_alimtalk_scheduled_at timestamptz DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS analysis_status_pending text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS analysis_content_pending text DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS analysis_pending_payload jsonb DEFAULT NULL;

-- 2. process_scheduled_analysis_releases 함수 생성
CREATE OR REPLACE FUNCTION process_scheduled_analysis_releases()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    rec record;
    v_alim_type text;
    v_now_ms bigint;
    v_payload jsonb;
    v_is_incentive boolean;
    v_is_update boolean;
    v_correction_enabled boolean;
    v_correction_start_date date;
    v_user_id uuid;
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

    -- 현재 시각을 밀리초로 (analysis_first_saved_at과 같은 단위)
    v_now_ms := (extract(epoch from now()) * 1000)::bigint;

    -- 예약 시각이 도래한 신청서 조회
    FOR rec IN
        SELECT a.*
        FROM applications a
        WHERE a.analysis_alimtalk_scheduled_at IS NOT NULL
          AND a.analysis_alimtalk_scheduled_at <= now()
          AND a.analysis_status_pending IS NOT NULL
          AND a.analysis_content_pending IS NOT NULL
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        v_payload := COALESCE(rec.analysis_pending_payload, '{}'::jsonb);
        v_is_incentive := COALESCE((v_payload->>'is_incentive_applicant')::boolean, false);
        v_is_update := COALESCE((v_payload->>'is_analysis_update')::boolean, false);

        -- 임시 보관 데이터를 정식 컬럼으로 이전 + 공개 트리거 컬럼 세팅
        -- payload는 폼에서 완전히 새로 만든 값이므로 키가 있으면 무조건 적용
        -- (NULL 의도를 보존하기 위해 COALESCE 미사용)
        UPDATE applications
        SET
            -- 공개 트리거 컬럼들
            analysis_status   = rec.analysis_status_pending,
            analysis_content  = rec.analysis_content_pending,
            analysis_saved_at = v_now_ms,
            -- analysis_first_saved_at: 최초 저장 시점 = 발송 시점으로 통일
            -- (이미 값이 있으면 그대로 유지: 예약 → 발송 후 다시 수정 케이스 방지)
            analysis_first_saved_at = COALESCE(applications.analysis_first_saved_at, v_now_ms),

            -- 부가 필드들 (payload에서 복원). 키가 존재하지 않으면 기존 값 유지.
            assigned_program       = CASE WHEN v_payload ? 'assigned_program'       THEN v_payload->>'assigned_program'                       ELSE applications.assigned_program END,
            schedule_start         = CASE WHEN v_payload ? 'schedule_start'         THEN v_payload->>'schedule_start'                         ELSE applications.schedule_start END,
            schedule_end           = CASE WHEN v_payload ? 'schedule_end'           THEN v_payload->>'schedule_end'                           ELSE applications.schedule_end END,
            program_price          = CASE WHEN v_payload ? 'program_price'          THEN (v_payload->>'program_price')::bigint                ELSE applications.program_price END,
            discount_amount        = CASE WHEN v_payload ? 'discount_amount'        THEN (v_payload->>'discount_amount')::bigint              ELSE applications.discount_amount END,
            additional_discount    = CASE WHEN v_payload ? 'additional_discount'    THEN (v_payload->>'additional_discount')::bigint          ELSE applications.additional_discount END,
            discount_reason        = CASE WHEN v_payload ? 'discount_reason'        THEN v_payload->>'discount_reason'                        ELSE applications.discount_reason END,
            final_price            = CASE WHEN v_payload ? 'final_price'            THEN (v_payload->>'final_price')::bigint                  ELSE applications.final_price END,
            correction_enabled     = CASE WHEN v_payload ? 'correction_enabled'     THEN (v_payload->>'correction_enabled')::boolean          ELSE applications.correction_enabled END,
            correction_start_date  = CASE WHEN v_payload ? 'correction_start_date'  THEN v_payload->>'correction_start_date'                  ELSE applications.correction_start_date END,
            correction_fee         = CASE WHEN v_payload ? 'correction_fee'         THEN (v_payload->>'correction_fee')::bigint               ELSE applications.correction_fee END,
            is_incentive_applicant = CASE WHEN v_payload ? 'is_incentive_applicant' THEN (v_payload->>'is_incentive_applicant')::boolean      ELSE applications.is_incentive_applicant END,

            -- 단계 진행
            current_step = GREATEST(COALESCE(applications.current_step, 0), 2),
            status = '개별분석완료',

            -- 예약 데이터 정리 (재발송 방지)
            analysis_alimtalk_scheduled_at = NULL,
            analysis_status_pending = NULL,
            analysis_content_pending = NULL,
            analysis_pending_payload = NULL
        WHERE applications.id = rec.id;

        -- 첨삭 포함 시 correction_schedules UPSERT (즉시 발송 흐름과 동등하게 처리)
        v_correction_enabled := COALESCE((v_payload->>'correction_enabled')::boolean, false);
        v_correction_start_date := NULLIF(v_payload->>'correction_start_date', '')::date;
        v_user_id := rec.user_id;
        IF v_correction_enabled AND v_correction_start_date IS NOT NULL AND v_user_id IS NOT NULL THEN
            INSERT INTO correction_schedules (user_id, start_date, duration_weeks)
            VALUES (v_user_id, v_correction_start_date, 4)
            ON CONFLICT (user_id) DO UPDATE
                SET start_date = EXCLUDED.start_date,
                    duration_weeks = EXCLUDED.duration_weeks;
        END IF;

        -- 알림톡 유형 결정 (수정이면 analysis_updated, 최초면 기존 분기)
        v_alim_type := CASE
            WHEN v_is_update THEN 'analysis_updated'
            WHEN v_is_incentive THEN 'incentive_analysis_complete'
            ELSE 'analysis_complete'
        END;

        -- 알림톡 발송 (전화번호가 있는 경우만)
        IF rec.phone IS NOT NULL AND rec.phone <> '' THEN
            PERFORM net.http_post(
                url := v_edge_url,
                body := jsonb_build_object(
                    'type', v_alim_type,
                    'data', jsonb_build_object(
                        'name', COALESCE(rec.name, ''),
                        'phone', rec.phone,
                        'app_id', rec.id
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

-- 3. pg_cron 등록 (매분 실행)
--    이미 등록된 경우 cron.unschedule 후 재등록해도 됨.
SELECT cron.schedule(
    'process-scheduled-analysis-releases',
    '* * * * *',
    'SELECT process_scheduled_analysis_releases()'
);

-- 등록 확인용 쿼리 (실행 후 결과 확인):
-- SELECT * FROM cron.job WHERE jobname = 'process-scheduled-analysis-releases';
