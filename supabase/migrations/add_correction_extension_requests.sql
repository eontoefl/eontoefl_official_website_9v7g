-- ============================================================
-- 첨삭 연장(13~24세션) 업셀 — 학생 신청 기록 테이블
-- 작성: 2026-08-06
-- 설계서: 테스트룸 레포 docs/correction-extension-upsell-spec.md
--
-- 흐름:
--   테스트룸에서 학생이 동의 체크 후 [신청하기]
--     → 이 테이블에 pending 행 INSERT + 텔레그램 알림
--   운영자 입금 확인(텔레그램 원탭 버튼 또는 관리자 모달 [연장 적용])
--     → status = confirmed + confirmed_at 기록
--   신청 마감(12세션이 속한 주 토요일) 경과, 미입금
--     → status = expired (표시만 바꿈, 자동 환불·취소 행동 없음)
--
-- 접근 정책: 기존 테이블들과 동일하게 RLS 미설정(anon 접근) 관행을 따름.
-- ============================================================

CREATE TABLE IF NOT EXISTS correction_extension_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    application_id UUID,                            -- applications.id (관리자 화면·텔레그램 링크용)
    status TEXT NOT NULL DEFAULT 'pending',         -- pending / confirmed / expired / canceled
    agreed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- 동의 체크 시각 (체크 없이는 신청 불가)
    agreement_text TEXT,                            -- 동의 문안 원문 박제 (분쟁 대비)
    deadline_date DATE,                             -- 신청 마감일(토요일) — 만료 판정·표시용
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,   -- +24시간 미입금 리마인드 발송 여부 (학생당 1회)
    reminder_sent_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,                       -- 운영자 입금 확인 시각
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corr_ext_req_user ON correction_extension_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_corr_ext_req_status ON correction_extension_requests(status);

-- 학생 1명당 대기(pending) 신청은 1건만 (중복 신청 방지)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_corr_ext_req_pending
    ON correction_extension_requests(user_id) WHERE status = 'pending';

COMMENT ON TABLE correction_extension_requests
    IS '첨삭 연장(13~24세션) 학생 신청 기록. pending=입금 대기, confirmed=운영자 확인 완료, expired=마감 경과, canceled=취소';
