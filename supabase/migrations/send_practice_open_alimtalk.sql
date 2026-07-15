-- =====================================================================
-- 연습코스 오픈 알림톡 자동 발송 (practice_open, 템플릿 50231)
--
-- 배경:
--   auto_enable_practice_mode() 크론이 정규과정 종료/완주 학생의
--   연습코스를 자동으로 켠다. 그때 학생에게 "연습코스 열렸다"고
--   알림톡을 보내 테스트룸으로 유도한다.
--
-- 동작:
--   practice_enabled = true 인데 아직 알림톡을 안 보낸(practice_alimtalk_sent=false)
--   학생을 골라 practice_open 알림톡을 발송한다.
--   활성화(auto_enable_practice_mode)와 발송을 분리했기 때문에,
--   크론이 켜는 순간과 무관하게 발송 가능 시간대에 자연히 나간다.
--
-- 안전장치:
--   설치 시점에 "이미 켜져 있던" 학생(수동 ON + 어제 소급 25명)은
--   전원 practice_alimtalk_sent=true 로 마킹한다 → 설치만으로는 한 건도
--   나가지 않는다. 소급 발송은 이 파일 실행 후 별도 UPDATE 로 대상만
--   골라서 연다(4월 종료자·테스트 계정 제외 등 사람이 판단).
--
-- 발송 시간대:
--   KST 08:30 ~ 22:00 에만 발송 (toefl_exam_day 와 동일 정책).
--   auto_enable 은 00:05 에 켜므로, 켜진 학생은 그날 아침 첫 발송에 나간다.
--
-- 사전 조건:
--   - Vault에 'supabase_service_role_key' 등록
--   - pg_net, pg_cron 확장 활성화
--   - Edge Function kakaotalk-notify 에 practice_open 타입 배포 (템플릿 50231)
--
-- 2026-07-15
-- =====================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. 발송 여부 플래그
-- ─────────────────────────────────────────────────────────────
ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS practice_alimtalk_sent    BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS practice_alimtalk_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN applications.practice_alimtalk_sent IS '연습코스 오픈 알림톡 발송 완료 여부 (중복 발송 방지)';

-- 설치 시점에 이미 켜져 있던 학생은 전원 "발송함"으로 마킹 → 설치만으로 발송 0건.
-- (소급 발송은 이 파일 실행 후 아래 4번 안내에 따라 대상만 다시 false 로 연다)
UPDATE applications
SET practice_alimtalk_sent = true,
    practice_alimtalk_sent_at = COALESCE(practice_alimtalk_sent_at, now())
WHERE practice_enabled = true
  AND COALESCE(practice_alimtalk_sent, false) = false;

-- ─────────────────────────────────────────────────────────────
-- 2. 발송 함수
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION send_practice_open_alimtalk()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
    v_count integer := 0;
    rec record;
BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    IF v_service_key IS NULL THEN
        RAISE WARNING 'service_role_key not found in vault';
        RETURN 0;
    END IF;

    -- 발송 가능 시간대(KST 08:30~22:00)가 아니면 다음 주기로 미룬다.
    IF (now() AT TIME ZONE 'Asia/Seoul')::time NOT BETWEEN '08:30' AND '22:00' THEN
        RETURN 0;
    END IF;

    FOR rec IN
        SELECT a.id, a.name, a.phone
        FROM applications a
        WHERE a.practice_enabled = true
          AND COALESCE(a.practice_alimtalk_sent, false) = false
          AND a.deposit_confirmed_by_admin = true
          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
          AND COALESCE(a.phone, '') <> ''
        FOR UPDATE OF a SKIP LOCKED
    LOOP
        -- 중복 발송 방지를 위해 먼저 마킹한다 (미발송 < 중복발송)
        UPDATE applications
        SET practice_alimtalk_sent = true,
            practice_alimtalk_sent_at = now()
        WHERE id = rec.id;

        PERFORM net.http_post(
            url := v_edge_url,
            body := jsonb_build_object(
                'type', 'practice_open',
                'data', jsonb_build_object(
                    'name',   COALESCE(rec.name, ''),
                    'phone',  rec.phone,
                    'app_id', rec.id
                )
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
            )
        );

        v_count := v_count + 1;
    END LOOP;

    IF v_count > 0 THEN
        RAISE NOTICE '[practice] 연습코스 오픈 알림톡 발송: %건', v_count;
    END IF;

    RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. pg_cron 등록 (10분마다)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('send-practice-open-alimtalk')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-practice-open-alimtalk');

SELECT cron.schedule(
    'send-practice-open-alimtalk',
    '*/10 * * * *',
    'SELECT send_practice_open_alimtalk()'
);

-- ─────────────────────────────────────────────────────────────
-- 4. 소급 발송 (별도 실행 — 이 파일과 같이 자동 실행하지 말 것)
--
--   위 1번에서 소급 25명은 전부 practice_alimtalk_sent=true 로 잠겨 있다.
--   아래 순서로 "5월 이후 종료자"만 다시 열어 발송한다.
--   4월 종료자 9명은 계속 잠긴 상태로 두어 발송에서 제외한다.
--
--   [STEP A] 테스트 발송 — 관리자 본인/1명만 먼저 열어 실제 도착 확인
--     UPDATE applications SET practice_alimtalk_sent = false
--     WHERE email = '<테스트로 받을 학생 이메일>';
--     -- 다음 10분 크론에 1건 발송됨. 카톡 도착/본문/버튼 확인.
--     -- (급하면 즉시:  SELECT send_practice_open_alimtalk();  단 발송 시간대여야 함)
--
--   [STEP B] 이상 없으면 5월 이후 종료 소급자 일괄 오픈 (4월 종료자 제외)
--     UPDATE applications SET practice_alimtalk_sent = false
--     WHERE practice_enabled = true
--       AND practice_enabled_source = 'auto'
--       AND safe_to_date(schedule_end) >= DATE '2026-05-01'
--       AND COALESCE(app_status,'') NOT IN ('refunded','dropped');
--     -- 대상 미리보기(발송 없이 명단만):
--     --   SELECT name, schedule_end FROM applications
--     --   WHERE practice_enabled AND practice_enabled_source='auto'
--     --     AND safe_to_date(schedule_end) >= DATE '2026-05-01'
--     --   ORDER BY schedule_end DESC;
-- ─────────────────────────────────────────────────────────────

-- 확인용:
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'send-practice-open-alimtalk';
-- SELECT student_name, template_id, status, sent_at
--   FROM kakaotalk_logs WHERE template_id = 50231 ORDER BY created_at DESC;
