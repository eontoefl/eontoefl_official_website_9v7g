-- =====================================================================
-- 회원탈퇴 기능 (2026-08 회의 확정 스펙)
--   - users에 탈퇴 신청 컬럼 3개 (7일 유예용 soft 표시)
--   - applications에 withdrawn_at (탈퇴자 기록 표시; deleted와 별개)
--   - withdrawal_records: 재가입 30일 제한 + 탈퇴 사유 통계
--   - process_member_withdrawals(): 7일 경과 건 실제 파기 (pg_cron 매시)
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor에서 본 파일 전체를 "한 번에" 실행.
--   재실행해도 안전(IF NOT EXISTS / OR REPLACE / cron 재등록 가드).
--   프론트 배포 전에 이 SQL을 먼저 실행해야 한다(프론트가 withdrawn_at 필터 사용).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 컬럼 추가
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_requested_at timestamptz DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_reason text DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_reason_detail text DEFAULT NULL;
COMMENT ON COLUMN users.withdrawal_requested_at IS '탈퇴 신청 시각. NULL이 아니면 이용 정지 상태. 7일 후 pg_cron이 실제 파기.';

ALTER TABLE applications ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz DEFAULT NULL;
COMMENT ON COLUMN applications.withdrawn_at IS '작성자 탈퇴 확정 시각. 학생 화면 조회에서 제외용. deleted(관리자 삭제)와 별개.';

-- ---------------------------------------------------------------------
-- 2) 재가입 제한 + 사유 통계
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawal_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid,                       -- 삭제된 users.id (30일 후 NULL)
    email text,                         -- 30일 후 NULL
    phone text,                         -- 하이픈 포함 원형 저장, 30일 후 NULL
    name text,                          -- 30일 후 NULL
    reason text,
    reason_detail text,
    had_paid boolean NOT NULL DEFAULT false,
    requested_at timestamptz,
    purged_at timestamptz NOT NULL DEFAULT now(),
    identity_purge_after timestamptz NOT NULL   -- purged_at + 30일
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_records_email
    ON withdrawal_records (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_withdrawal_records_phone
    ON withdrawal_records (phone) WHERE phone IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3) 파기 함수
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_member_withdrawals()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
    v_had_paid boolean;
    v_phone_digits text;
    v_col text;
BEGIN
    FOR rec IN
        SELECT id, email, phone, name,
               withdrawal_reason, withdrawal_reason_detail, withdrawal_requested_at
        FROM users
        WHERE withdrawal_requested_at IS NOT NULL
          AND withdrawal_requested_at <= now() - interval '7 days'
        FOR UPDATE SKIP LOCKED
    LOOP
        v_phone_digits := replace(COALESCE(rec.phone,''), '-', '');

        -- 유료 흔적 판정
        SELECT EXISTS (
            SELECT 1 FROM applications a
            WHERE (a.user_id = rec.id
                   OR lower(a.email) = lower(rec.email)
                   OR lower(a.user_email) = lower(rec.email))
              AND (COALESCE(a.contract_agreed,false)
                   OR COALESCE(a.deposit_confirmed_by_admin,false)
                   OR a.app_status IN ('refunded','dropped'))
        ) INTO v_had_paid;

        -- 재가입 제한 + 사유 기록
        INSERT INTO withdrawal_records
            (user_id, email, phone, name, reason, reason_detail,
             had_paid, requested_at, purged_at, identity_purge_after)
        VALUES
            (rec.id, rec.email, rec.phone, rec.name,
             rec.withdrawal_reason, rec.withdrawal_reason_detail,
             v_had_paid, rec.withdrawal_requested_at, now(), now() + interval '30 days');

        -- 스토리지: 행 삭제 전에 파일부터 제거
        --   study_results_v3/v2/practice 의 speaking 컬럼은 존재 확인됨(고정 처리).
        DELETE FROM storage.objects
        WHERE bucket_id = 'speaking-files'
          AND name IN (
              SELECT speaking_file_1 FROM study_results_v3
               WHERE user_id = rec.id AND speaking_file_1 IS NOT NULL
              UNION SELECT speaking_file_1 FROM study_results_v2
               WHERE user_id = rec.id AND speaking_file_1 IS NOT NULL
              UNION SELECT speaking_file_2 FROM study_results_v2
               WHERE user_id = rec.id AND speaking_file_2 IS NOT NULL
              UNION SELECT speaking_file_1 FROM study_results_practice
               WHERE user_id = rec.id AND speaking_file_1 IS NOT NULL
          );
        --   tr_study_records 의 speaking 컬럼은 존재 여부가 불확실하므로,
        --   실제 존재하는 컬럼만 동적으로 처리(구현 시 확인 §3-3 자동화).
        FOR v_col IN
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'tr_study_records'
              AND column_name IN ('speaking_file_1','speaking_file_2')
        LOOP
            EXECUTE format(
                'DELETE FROM storage.objects
                  WHERE bucket_id = ''speaking-files''
                    AND name IN (SELECT %I FROM tr_study_records
                                  WHERE user_id = $1 AND %I IS NOT NULL)',
                v_col, v_col
            ) USING rec.id;
        END LOOP;
        --   토플 점수 이미지 폴더 전체
        DELETE FROM storage.objects
        WHERE bucket_id = 'toefl-score-images'
          AND name LIKE rec.id::text || '/%';

        -- 학습·활동 기록 삭제 (user_id 기준)
        DELETE FROM correction_submissions        WHERE user_id = rec.id;
        DELETE FROM correction_feedbacks          WHERE user_id = rec.id;
        DELETE FROM correction_schedules          WHERE user_id = rec.id;
        DELETE FROM correction_deadline_extensions WHERE user_id = rec.id;
        DELETE FROM tr_study_records              WHERE user_id = rec.id;
        DELETE FROM tr_auth_records               WHERE user_id = rec.id;
        DELETE FROM tr_golden_time_logs           WHERE user_id = rec.id;
        DELETE FROM study_results_v3              WHERE user_id = rec.id;
        DELETE FROM study_results_v2              WHERE user_id = rec.id;
        DELETE FROM study_results_practice        WHERE user_id = rec.id;
        DELETE FROM aus_study_results             WHERE user_id = rec.id;
        DELETE FROM tr_student_stats              WHERE user_id = rec.id;
        DELETE FROM tr_progress_save              WHERE user_id = rec.id;
        DELETE FROM tr_deadline_extensions        WHERE user_id = rec.id;
        DELETE FROM tr_notifications              WHERE user_id = rec.id;
        DELETE FROM tr_weekly_check_drafts        WHERE user_id = rec.id;
        DELETE FROM tr_auth_tokens                WHERE user_id = rec.id;
        DELETE FROM tr_book_progress              WHERE user_id = rec.id;
        DELETE FROM tr_book_memos                 WHERE user_id = rec.id;
        DELETE FROM toefl_exam_schedules          WHERE user_id = rec.id;
        DELETE FROM toefl_actual_scores           WHERE user_id = rec.id;
        DELETE FROM tr_book_access
         WHERE user_id = rec.id OR lower(student_email) = lower(rec.email);
        DELETE FROM tr_user_map
         WHERE user_id = rec.id OR lower(email) = lower(rec.email);
        DELETE FROM followup_jobs
         WHERE user_id = rec.id OR lower(email) = lower(rec.email);
        DELETE FROM notifications
         WHERE lower(user_email) = lower(rec.email);

        -- 첨삭 연장 신청: 유료(거래기록)면 보존, 아니면 삭제
        IF NOT v_had_paid THEN
            DELETE FROM correction_extension_requests WHERE user_id = rec.id;
        END IF;

        -- 게시물: 글·닉네임 유지, 식별 연결(실명·이메일)만 파기.
        --   author_name이 실명과 같은 글(닉네임 미설정자)만 '탈퇴회원'으로 교체.
        UPDATE study_certifications
           SET author_name = CASE WHEN author_name = rec.name THEN '탈퇴회원' ELSE author_name END,
               author_real_name = NULL, author_email = NULL
         WHERE lower(author_email) = lower(rec.email);
        UPDATE reviews
           SET author_name = CASE WHEN author_name = rec.name THEN '탈퇴회원' ELSE author_name END,
               author_real_name = NULL, author_email = NULL
         WHERE lower(author_email) = lower(rec.email);
        UPDATE reviews_book
           SET author_name = CASE WHEN author_name = rec.name THEN '탈퇴회원' ELSE author_name END,
               author_real_name = NULL, author_email = NULL
         WHERE lower(author_email) = lower(rec.email);

        -- 설문 응답: 익명화 (응답 통계 유지)
        UPDATE toefl_survey_responses
           SET user_name = '탈퇴회원', user_phone = NULL, user_email = NULL, user_id = NULL
         WHERE user_id = rec.id
            OR lower(user_email) = lower(rec.email)
            OR (v_phone_digits <> '' AND replace(COALESCE(user_phone,''),'-','') = v_phone_digits);

        -- 알림톡 로그: 전화번호 마스킹 (phone은 하이픈 없는 숫자로 저장됨)
        UPDATE kakaotalk_logs
           SET phone = left(phone, 3) || '********', student_name = '탈퇴회원'
         WHERE v_phone_digits <> '' AND phone = v_phone_digits;

        -- applications: (a) 유료 흔적 행 = 보존 + 표시
        UPDATE applications
           SET withdrawn_at = now()
         WHERE (user_id = rec.id
                OR lower(email) = lower(rec.email)
                OR lower(user_email) = lower(rec.email))
           AND (COALESCE(contract_agreed,false)
                OR COALESCE(deposit_confirmed_by_admin,false)
                OR app_status IN ('refunded','dropped'));

        -- applications: (b) 그 외 행 = 익명화(통계 유지)
        --   ▼ (a)가 먼저 실행되는 것에 의존 — 순서 변경 금지
        UPDATE applications
           SET name = '탈퇴회원',
               phone = NULL, email = NULL, user_email = NULL, user_id = NULL,
               give_up_plan = NULL, tell_plan = NULL,
               analysis_content = NULL, analysis_content_pending = NULL,
               analysis_pending_payload = NULL, contract_snapshot = NULL,
               bank_name = NULL, account_number = NULL, account_holder = NULL,
               bank_account = NULL,
               withdrawn_at = now()
         WHERE (user_id = rec.id
                OR lower(email) = lower(rec.email)
                OR lower(user_email) = lower(rec.email))
           AND withdrawn_at IS NULL;   -- (a)에서 방금 표시된 보존 행은 제외됨

        -- 계정 삭제 (마지막)
        DELETE FROM users WHERE id = rec.id;
    END LOOP;

    -- 재가입 제한 만료 건: 개인정보 파기 (사유 통계는 영구 보존)
    UPDATE withdrawal_records
       SET email = NULL, phone = NULL, name = NULL, user_id = NULL
     WHERE identity_purge_after <= now()
       AND (email IS NOT NULL OR phone IS NOT NULL OR name IS NOT NULL OR user_id IS NOT NULL);
END;
$$;

-- ---------------------------------------------------------------------
-- 4) pg_cron 등록 (매시 25분) — 재실행 안전하도록 기존 등록 해제 후 재등록
-- ---------------------------------------------------------------------
DO $$
BEGIN
    PERFORM cron.unschedule('process-member-withdrawals');
EXCEPTION WHEN OTHERS THEN
    NULL;  -- 아직 등록 전이면 무시
END $$;

SELECT cron.schedule(
    'process-member-withdrawals',
    '25 * * * *',
    'SELECT process_member_withdrawals()'
);
