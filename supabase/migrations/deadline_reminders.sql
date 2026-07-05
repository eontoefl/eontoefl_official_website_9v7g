-- =====================================================================
-- 마감 리마인드 알림톡 자동 발송 (일반 학생)
--   50228 개별분석 동의 마감 안내
--   50229 계약서 동의 마감 안내
--   50230 입금 마감 안내
--
-- 규칙:
--   - 각 단계 마감 "2시간 전"에 발송.
--   - 마감 = 각 단계 시작 시각 + 24시간.
--       개별분석 동의: analysis_first_saved_at(ms) + 24h
--       계약서 동의  : contract_sent_at(ms) + 24h
--       입금        : deposit_deadline_override(있으면) 또는 contract_agreed_at(ms) + 24h
--   - 방해금지 시간(KST 자정~오전 7시)에는 발송하지 않고, 발송 시점을
--     아침 7시 또는 전날 밤 23시로 보정 (reminder_effective_send_at 참고).
--   - 이미 액션을 완료했거나(동의/서명/입금버튼) 관리자 확인 완료 시 제외.
--   - 프로모션 학생 제외(별도 알림 50215가 담당), 계약서 유예 학생 제외(50222가 담당).
--   - 한 건당 1회만 발송 (*_reminder_sent_at NULL 체크).
--   - pg_cron 5분 주기 실행.
--
-- 컬럼 타입:
--   analysis_first_saved_at / contract_sent_at / contract_agreed_at : bigint (ms)
--   deposit_deadline_override                                       : timestamptz
--   student_agreed_at                                               : text (ISO)
--   contract_agreed / deposit_confirmed_by_student / deposit_confirmed_by_admin : boolean
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor에서 본 파일 전체를 실행.
--   (계좌 정보는 kakaotalk-notify Edge Function에 하드코딩되어 있으므로
--    이 SQL에서는 전달하지 않는다.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 중복 발송 방지 컬럼
-- ---------------------------------------------------------------------
ALTER TABLE applications ADD COLUMN IF NOT EXISTS analysis_agree_reminder_sent_at timestamptz DEFAULT NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contract_agree_reminder_sent_at timestamptz DEFAULT NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS deposit_reminder_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN applications.analysis_agree_reminder_sent_at IS '개별분석 동의 마감 2시간 전 리마인드(50228) 발송 시각. NULL이면 미발송.';
COMMENT ON COLUMN applications.contract_agree_reminder_sent_at IS '계약서 동의 마감 2시간 전 리마인드(50229) 발송 시각. NULL이면 미발송.';
COMMENT ON COLUMN applications.deposit_reminder_sent_at IS '입금 마감 2시간 전 리마인드(50230) 발송 시각. NULL이면 미발송.';

-- ---------------------------------------------------------------------
-- 2) 발송 시각 계산 헬퍼: "마감 2시간 전" + 방해금지(자정~오전7시) 보정
--    - 2시간 전이 낮 시간대(07~24시)  → 정확히 2시간 전
--    - 2시간 전이 새벽이지만 마감이 오전 7시 이후 → 오전 7시에 발송
--    - 마감 자체가 새벽(00~07시)      → 전날 밤 23시에 미리 발송
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reminder_effective_send_at(p_deadline timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ideal        timestamptz := p_deadline - interval '2 hours';
    v_ideal_hour   int := extract(hour from (v_ideal AT TIME ZONE 'Asia/Seoul'))::int;
    v_deadline_hour int := extract(hour from (p_deadline AT TIME ZONE 'Asia/Seoul'))::int;
    v_deadline_date date := (p_deadline AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
    IF v_ideal_hour >= 7 THEN
        RETURN v_ideal;
    ELSIF v_deadline_hour >= 7 THEN
        RETURN (v_deadline_date::text || ' 07:00')::timestamp AT TIME ZONE 'Asia/Seoul';
    ELSE
        RETURN ((v_deadline_date - 1)::text || ' 23:00')::timestamp AT TIME ZONE 'Asia/Seoul';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) 리마인드 발송 함수 (3종 한 번에 처리)
-- ---------------------------------------------------------------------
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
    -- Vault에서 service_role_key 조회
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN;
    END IF;

    -- 방해금지(KST 자정~오전7시)에는 발송하지 않음 (cron 누락 대비 안전장치)
    v_now_hour := extract(hour from (now() AT TIME ZONE 'Asia/Seoul'))::int;
    IF v_now_hour < 7 THEN
        RETURN;
    END IF;

    -- =================================================================
    -- (1) 개별분석 동의 마감 리마인드 (50228)
    -- =================================================================
    FOR rec IN
        SELECT a.id, a.name, a.phone,
               (to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours') AS deadline
        FROM applications a
        WHERE a.analysis_status = '승인'
          AND (a.student_agreed_at IS NULL OR a.student_agreed_at = '')
          AND a.analysis_first_saved_at IS NOT NULL
          AND COALESCE(a.is_incentive_applicant, false) = false
          AND a.analysis_agree_reminder_sent_at IS NULL
          AND a.phone IS NOT NULL AND a.phone <> ''
          AND now() >= reminder_effective_send_at(to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours')
          AND now() <  (to_timestamp(a.analysis_first_saved_at / 1000.0) + interval '24 hours')
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
    --     - 학생이 "입금했어요" 버튼을 눌렀으면 제외 (deposit_confirmed_by_student)
    --     - 입금 기한 수동 연장(deposit_deadline_override) 시 그 기준으로 계산
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

-- ---------------------------------------------------------------------
-- 4) pg_cron 등록 (매 5분 실행)
-- ---------------------------------------------------------------------
SELECT cron.schedule(
    'process-deadline-reminders',
    '*/5 * * * *',
    'SELECT process_deadline_reminders()'
);
