-- =====================================================================
-- 첨삭 자동 승인 — 호주첨삭 유형 라벨 추가
--
-- 문제:
--   process_auto_approve_corrections()가 task_type → 라벨 변환을 자체적으로
--   갖고 있는데 옛 3개 유형(Email/Discussion/Interview)만 안다.
--   호주첨삭은 ELSE로 빠져서 알림톡에 영문 코드가 그대로 나갔다.
--     "제출하신 4회 writing_aus_integrated 과제의 1차 첨삭이 완료되었습니다"
--
--   공홈 관리자(admin-correction.js)의 라벨은 이미 고쳤지만, 이 DB 함수는
--   완전히 별개의 발송 경로라 따로 고쳐야 한다.
--
-- 변경:
--   CASE 문에 호주 6유형 추가. 그 외 로직(5시간 경과·미승인·예약 제외)은 그대로.
--   자동 승인은 호주도 일반과 동일하게 동작시킨다.
--
-- 실행:
--   Supabase 대시보드 → SQL Editor에서 본 파일 전체 실행.
--   pg_cron 등록은 기존 것이 그대로 유지되므로 다시 등록하지 않는다.
-- =====================================================================

CREATE OR REPLACE FUNCTION process_auto_approve_corrections()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_service_key text;
    v_edge_url text := 'https://qpqjevecjejvbeuogtbx.supabase.co/functions/v1/kakaotalk-notify';
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

    -- 5시간 경과 + 미승인 + 수동 예약 없는 건 조회
    FOR rec IN
        SELECT cs.*, u.name AS student_name, u.phone AS student_phone
        FROM correction_submissions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.scheduled_release_at IS NULL
          AND (
              -- 케이스 A: 1차 피드백 존재 + 미승인 + 5시간 경과
              (
                  cs.feedback_1 IS NOT NULL
                  AND cs.released_1 = false
                  AND cs.feedback_1_at IS NOT NULL
                  AND cs.feedback_1_at <= (now() - interval '5 hours')
              )
              OR
              -- 케이스 B: 2차 피드백 존재 + 1차는 이미 승인 + 2차 미승인 + 5시간 경과
              (
                  cs.feedback_2 IS NOT NULL
                  AND cs.released_1 = true
                  AND cs.released_2 = false
                  AND cs.feedback_2_at IS NOT NULL
                  AND cs.feedback_2_at <= (now() - interval '5 hours')
              )
          )
        FOR UPDATE OF cs SKIP LOCKED
    LOOP
        -- 알림톡 유형 결정 + released 플래그 업데이트
        IF rec.feedback_1 IS NOT NULL AND rec.released_1 = false THEN
            v_alim_type := 'correction_feedback_1';
            UPDATE correction_submissions
            SET released_1 = true,
                released_1_at = now()
            WHERE id = rec.id;
        ELSIF rec.feedback_2 IS NOT NULL AND rec.released_1 = true AND rec.released_2 = false THEN
            v_alim_type := 'correction_feedback_2';
            UPDATE correction_submissions
            SET released_2 = true,
                released_2_at = now()
            WHERE id = rec.id;
        ELSE
            CONTINUE;
        END IF;

        -- task_type → 라벨
        --   일반첨삭 3종 + 호주첨삭 6종. 학원에서 쓰는 용어 그대로 학생에게 보낸다.
        CASE rec.task_type
            WHEN 'writing_email'            THEN v_task_label := 'Email';
            WHEN 'writing_discussion'       THEN v_task_label := 'Discussion';
            WHEN 'speaking_interview'       THEN v_task_label := 'Interview';
            -- 호주첨삭
            WHEN 'writing_aus_discussion'   THEN v_task_label := '토라';
            WHEN 'writing_aus_integrated'   THEN v_task_label := '통라';
            WHEN 'speaking_aus_independent' THEN v_task_label := '독스';
            WHEN 'speaking_aus_int2'        THEN v_task_label := '통스2';
            WHEN 'speaking_aus_int3'        THEN v_task_label := '통스3';
            WHEN 'speaking_aus_int4'        THEN v_task_label := '통스4';
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

-- 확인용:
--   SELECT * FROM cron.job WHERE jobname = 'process-auto-approve-corrections';
--   (크론은 기존 등록이 그대로 유지된다. 다시 등록하지 않는다.)
