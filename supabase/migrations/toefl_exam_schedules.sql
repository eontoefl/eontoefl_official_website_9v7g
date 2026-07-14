-- =====================================================================
-- 실제 TOEFL 시험 일정 (toefl_exam_schedules) + 시험 당일 알림톡 자동 발송
--
-- 기능 개요:
--   (1) 학생이 마이페이지에서 ETS 시험 등록 후 일정(날짜·시간)과
--       등록 확인 캡처를 올린다. → toefl_exam_schedules 에 저장
--   (2) 시험 시작 + 2시간 30분이 지나면 알림톡을 자동 발송하여,
--       기억이 생생할 때 카톡으로 회신하도록 유도한다.
--
-- 인증 절차 (계약서 기준):
--   1단계 = 시험 등록 인증  → 마이페이지 (이 테이블)
--   2단계 = 점수 인증       → 카카오톡으로 성적표 캡처 전송
--                             → 관리자가 toefl_actual_scores 에 입력
--
-- 발송 시간대:
--   KST 08:30 ~ 22:00 에만 발송. 밤늦게 끝난 시험은 다음 날 아침에 나간다.
--   (별도 지연 로직 없이, 발송 가능 시간대일 때만 쏘면 자연히 미뤄짐)
--
-- 주기: pg_cron 10분마다
--
-- 사전 조건:
--   - Vault에 'supabase_service_role_key' 등록
--   - pg_net, pg_cron 확장 활성화
--   - 알림톡 템플릿 'toefl_exam_day' 승인 + Edge Function에 타입 추가
-- =====================================================================


-- ─────────────────────────────────────────────────────────────
-- 1. 테이블
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS toefl_exam_schedules (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL,
    user_email         text,
    user_name          text,

    exam_datetime      timestamptz NOT NULL,   -- 시험 "시작" 일시 (알림톡 기준점)
    registration_image text,                   -- ETS 등록 확인 캡처 URL

    status             text NOT NULL DEFAULT 'scheduled',
                       -- scheduled : 응시 예정
                       -- done      : 응시 완료 (성적 등록됨)
                       -- cancelled : 학생이 취소
                       -- no_show   : 등록했으나 미응시

    alimtalk_sent      boolean NOT NULL DEFAULT false,
    alimtalk_sent_at   timestamptz,

    score_id           uuid,                   -- toefl_actual_scores.id (성적 등록 시 연결)

    created_at         timestamptz DEFAULT now(),
    updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_toefl_exam_user
    ON toefl_exam_schedules(user_id);

-- 알림톡 발송 대상 조회용 (미발송 예정 건만)
CREATE INDEX IF NOT EXISTS idx_toefl_exam_pending
    ON toefl_exam_schedules(exam_datetime)
    WHERE status = 'scheduled' AND alimtalk_sent = false;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION touch_toefl_exam_schedules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_toefl_exam_schedules ON toefl_exam_schedules;
CREATE TRIGGER trg_touch_toefl_exam_schedules
    BEFORE UPDATE ON toefl_exam_schedules
    FOR EACH ROW EXECUTE FUNCTION touch_toefl_exam_schedules();


-- ─────────────────────────────────────────────────────────────
-- 2. 시험 당일 알림톡 발송 함수
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION send_toefl_exam_day_alimtalk()
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

    -- 발송 가능 시간대(KST 08:30~22:00)가 아니면 다음 주기로 미룬다.
    -- 밤 10시 넘어 끝난 시험은 이 조건 때문에 자연히 다음 날 아침에 발송된다.
    IF (now() AT TIME ZONE 'Asia/Seoul')::time NOT BETWEEN '08:30' AND '22:00' THEN
        RETURN;
    END IF;

    FOR rec IN
        SELECT es.id,
               es.exam_datetime,
               u.name  AS student_name,
               u.phone AS student_phone
        FROM toefl_exam_schedules es
        LEFT JOIN users u ON u.id = es.user_id
        WHERE es.status = 'scheduled'
          AND es.alimtalk_sent = false
          AND es.exam_datetime + interval '2 hours 30 minutes' <= now()
          -- 묵은 건 스킵: cron이 며칠 죽었다 살아나도 지난 시험에 발송하지 않는다
          AND es.exam_datetime > now() - interval '24 hours'
        FOR UPDATE OF es SKIP LOCKED
    LOOP
        -- 중복 발송 방지를 위해 먼저 마킹한다 (미발송 < 중복발송)
        UPDATE toefl_exam_schedules
        SET alimtalk_sent = true,
            alimtalk_sent_at = now()
        WHERE id = rec.id;

        IF rec.student_phone IS NOT NULL AND rec.student_phone != '' THEN
            PERFORM net.http_post(
                url := v_edge_url,
                body := jsonb_build_object(
                    'type', 'toefl_exam_day',
                    'data', jsonb_build_object(
                        'name',  COALESCE(rec.student_name, ''),
                        'phone', rec.student_phone,
                        'exam_datetime', to_char(
                            rec.exam_datetime AT TIME ZONE 'Asia/Seoul',
                            'MM월 DD일 HH24:MI'
                        )
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


-- ─────────────────────────────────────────────────────────────
-- 3. pg_cron 등록 (10분마다)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('send-toefl-exam-day-alimtalk')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'send-toefl-exam-day-alimtalk'
);

SELECT cron.schedule(
    'send-toefl-exam-day-alimtalk',
    '*/10 * * * *',
    'SELECT send_toefl_exam_day_alimtalk()'
);
