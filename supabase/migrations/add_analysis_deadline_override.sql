-- =====================================================================
-- 개별분석 동의 마감 "수동 리셋(연장)" override 컬럼
--   관리자가 [동의 기한 24시간 리셋] 버튼을 누르면 이 컬럼에
--   '지금 + 24시간'의 절대 시각(timestamptz)이 저장된다.
--   값이 있으면 관리자 목록/학생 화면/리마인드 알림톡 모두
--   analysis_first_saved_at 기준 대신 이 절대 시각을 마감으로 사용한다.
--   (일반/프로모션 상관없이 "무조건 24시간" — 버튼 기획 확정사항)
--
-- 실행: Supabase 대시보드 > SQL Editor에서 본 파일 전체 실행.
--   deadline_reminders.sql 의 개별분석 리마인드 블록만 override를 타도록 갱신한다.
-- =====================================================================

-- 1) override 컬럼
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS analysis_deadline_override timestamptz DEFAULT NULL;

COMMENT ON COLUMN applications.analysis_deadline_override
  IS '개별분석 동의 마감 수동 리셋 시각(절대). 있으면 이 시각이 마감. 관리자 [기한 리셋] 버튼이 지금+24h로 기록.';

-- 2) 리마인드 함수 재정의 — 개별분석 동의 마감(50228) 블록이 override를 우선 사용.
--    (계약서/입금 블록은 기존 그대로. override가 있으면 리셋 시 리마인드도 새 마감 2시간 전에 재발송됨.)
CREATE OR REPLACE FUNCTION process_deadline_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key   text;
    v_edge_url      text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    v_now_hour      int;
    rec             record;
    v_deadline      timestamptz;
    v_time          text;
    v_deadline_label text;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    v_now_hour := extract(hour from (now() AT TIME ZONE 'Asia/Seoul'))::int;
    IF v_now_hour < 7 THEN
        RETURN;
    END IF;

    -- =================================================================
    -- (1) 개별분석 동의 마감 리마인드 (50228)
    --     마감 = analysis_deadline_override(수동 리셋) 있으면 그 값,
    --            없으면 analysis_first_saved_at + 24h
    -- =================================================================
    FOR rec IN
        SELECT a.id, a.name, a.phone,
               COALESCE(a.analysis_deadline_override,
                        to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours') AS deadline
        FROM applications a
        WHERE a.analysis_status = '승인'
          AND (a.student_agreed_at IS NULL OR a.student_agreed_at = '')
          AND (a.analysis_first_saved_at IS NOT NULL OR a.analysis_deadline_override IS NOT NULL)
          AND COALESCE(a.is_incentive_applicant, false) = false
          AND a.analysis_agree_reminder_sent_at IS NULL
          AND a.phone IS NOT NULL AND a.phone <> ''
          AND now() >= reminder_effective_send_at(
                          COALESCE(a.analysis_deadline_override,
                                   to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours'))
          AND now() <  COALESCE(a.analysis_deadline_override,
                                to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours')
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        UPDATE applications SET analysis_agree_reminder_sent_at = now() WHERE id = rec.id;

        v_deadline := rec.deadline;
        v_time := ceil(extract(epoch from (v_deadline - now())) / 3600.0)::int::text;
        v_deadline_label := to_char(v_deadline AT TIME ZONE 'Asia/Seoul', 'MM월 DD일 HH24:MI');

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'analysis_agree_reminder',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'time', v_time,
                    'deadline', v_deadline_label
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );
    END LOOP;

    -- =================================================================
    -- (2) 계약서 동의 마감 리마인드 (50229) — 유예 학생 제외
    -- =================================================================
    FOR rec IN
        SELECT a.id, a.name, a.phone, a.program,
               (to_timestamp(a.contract_sent_at / 1000.0) + interval '24 hours') AS deadline
        FROM applications a
        WHERE a.contract_sent = true
          AND a.contract_sent_at IS NOT NULL
          AND (a.contract_agreed IS NULL OR a.contract_agreed = false)
          AND a.contract_deadline_override IS NULL
          AND a.contract_agree_reminder_sent_at IS NULL
          AND a.phone IS NOT NULL AND a.phone <> ''
          AND now() >= reminder_effective_send_at(to_timestamp(a.contract_sent_at / 1000.0) + interval '24 hours')
          AND now() <  (to_timestamp(a.contract_sent_at / 1000.0) + interval '24 hours')
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        UPDATE applications SET contract_agree_reminder_sent_at = now() WHERE id = rec.id;

        v_deadline := rec.deadline;
        v_time := ceil(extract(epoch from (v_deadline - now())) / 3600.0)::int::text;
        v_deadline_label := to_char(v_deadline AT TIME ZONE 'Asia/Seoul', 'MM월 DD일 HH24:MI');

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'contract_agree_reminder',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'program', COALESCE(rec.program, ''),
                    'time', v_time,
                    'deadline', v_deadline_label
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );
    END LOOP;

    -- =================================================================
    -- (3) 입금 마감 리마인드 (50230)
    -- =================================================================
    FOR rec IN
        SELECT a.id, a.name, a.phone, a.program,
               COALESCE(a.final_price::text, '0') AS price,
               COALESCE(a.deposit_deadline_override,
                        to_timestamp(a.contract_agreed_at / 1000.0) + interval '24 hours') AS deadline
        FROM applications a
        WHERE a.contract_agreed = true
          AND a.contract_agreed_at IS NOT NULL
          AND COALESCE(a.deposit_confirmed_by_student, false) = false
          AND COALESCE(a.deposit_confirmed_by_admin, false) = false
          AND a.deposit_reminder_sent_at IS NULL
          AND a.phone IS NOT NULL AND a.phone <> ''
          AND now() >= reminder_effective_send_at(
                          COALESCE(a.deposit_deadline_override,
                                   to_timestamp(a.contract_agreed_at / 1000.0) + interval '24 hours'))
          AND now() <  COALESCE(a.deposit_deadline_override,
                                to_timestamp(a.contract_agreed_at / 1000.0) + interval '24 hours')
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        UPDATE applications SET deposit_reminder_sent_at = now() WHERE id = rec.id;

        v_deadline := rec.deadline;
        v_time := ceil(extract(epoch from (v_deadline - now())) / 3600.0)::int::text;
        v_deadline_label := to_char(v_deadline AT TIME ZONE 'Asia/Seoul', 'MM월 DD일 HH24:MI');

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'deposit_reminder',
                'data', jsonb_build_object(
                    'name', COALESCE(rec.name, ''),
                    'phone', rec.phone,
                    'app_id', rec.id,
                    'program', COALESCE(rec.program, ''),
                    'price', rec.price,
                    'time', v_time,
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
