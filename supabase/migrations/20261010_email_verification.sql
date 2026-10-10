-- =====================================================================
-- 가입 이메일 인증 — 2026-10-10 (C:\기능구현\가입인증)
--
-- 목적: 회원가입·입문서 신청·챌린지 신청서에서 새 계정을 만들 때
--       진짜 받아볼 수 있는 이메일인지 6자리 인증번호로 확인한다.
--
-- 이 파일이 만드는 것
--   1. public.email_verifications      인증번호 발급·대조 기록 (번호 원문은 저장하지 않음)
--   2. public.email_verification_state 장애 알림 시각 등 상태 1행 (싱글톤)
--   3. public.send_problem_bot_alert() 텔레그램 "이온토플 문제봇"으로 보내는 서버 전용 함수
--        - Vault의 TELEGRAM_BOT_TOKEN_V2 / TELEGRAM_CHAT_ID_V2 를 읽음 (테스트룸의
--          send_telegram_alert 와 같은 열쇠). 기존 함수는 손대지 않는다.
--        - service_role 만 실행 가능 (브라우저의 anon/authenticated 는 실행 불가)
--   4. pg_cron: 7일 지난 인증 기록 매일 삭제
--
-- 권한: 두 표 모두 RLS 켬 + anon/authenticated 권한 전부 회수. Edge Function
--       (email-verify, service_role) 만 읽고 쓴다. 2026-10-30부터 새 public 표에
--       자동 권한이 없어지는 변경과도 맞춘다.
--
-- 적용: Supabase SQL Editor 에서 실행 (대표 승인 후). 되돌리기는 파일 끝 주석 참고.
-- =====================================================================

-- ---------- 1. 인증 기록 ----------
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,                       -- 소문자·공백 제거본
  code_hash     text        NOT NULL,                       -- sha256(email + ':' + code) 16진수
  expires_at    timestamptz NOT NULL,                       -- 발급 + 3분
  attempts      integer     NOT NULL DEFAULT 0,             -- 틀린 입력 횟수 (5회면 폐기)
  verified_at   timestamptz,                                -- 대조 성공 시각
  send_status   text        NOT NULL DEFAULT 'pending'
                            CHECK (send_status IN ('pending', 'sent', 'failed')),
  send_error    text,                                       -- 발송 실패 사유 (n8n/Gmail 응답)
  client_ip     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verifications_email_created_idx
  ON public.email_verifications (email, created_at DESC);
CREATE INDEX IF NOT EXISTS email_verifications_created_idx
  ON public.email_verifications (created_at);

COMMENT ON TABLE public.email_verifications IS
  '가입 이메일 인증번호 발급·대조 기록. 번호 원문은 저장하지 않음(해시만). 7일 뒤 자동 삭제. Edge Function email-verify 전용.';

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_verifications TO service_role;

-- ---------- 2. 상태 1행 ----------
CREATE TABLE IF NOT EXISTS public.email_verification_state (
  singleton_id          integer     PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  last_failure_alert_at timestamptz,                        -- 마지막 장애 알림(즉시/요약) 시각
  daily_limit_alert_date date,                              -- 하루 상한 알림을 보낸 날짜(KST)
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_verification_state (singleton_id)
VALUES (1) ON CONFLICT (singleton_id) DO NOTHING;

COMMENT ON TABLE public.email_verification_state IS
  '가입 이메일 인증 장애 알림 상태(싱글톤). 첫 실패 즉시 1통 + 이후 10분에 1통 요약을 위해 마지막 알림 시각을 기록.';

ALTER TABLE public.email_verification_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_verification_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_verification_state TO service_role;

-- ---------- 3. 문제봇 알림 함수 (서버 전용) ----------
-- 테스트룸의 send_telegram_alert 와 같은 Vault 열쇠(V2)를 쓰지만, 고정 비밀값 검사 대신
-- "service_role 만 실행 가능" 으로 막는다. 기존 함수는 변경하지 않는다.
CREATE OR REPLACE FUNCTION public.send_problem_bot_alert(message_text text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bot_token text;
  chat_id   text;
  req_id    bigint;
BEGIN
  SELECT decrypted_secret INTO bot_token
    FROM vault.decrypted_secrets WHERE name = 'TELEGRAM_BOT_TOKEN_V2' LIMIT 1;
  SELECT decrypted_secret INTO chat_id
    FROM vault.decrypted_secrets WHERE name = 'TELEGRAM_CHAT_ID_V2' LIMIT 1;

  IF bot_token IS NULL OR chat_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'TELEGRAM_*_V2 secret not found');
  END IF;

  SELECT net.http_post(
    url     := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := json_build_object('chat_id', chat_id, 'text', message_text)::jsonb
  ) INTO req_id;

  RETURN json_build_object('ok', true, 'request_id', req_id);
END;
$$;

REVOKE ALL ON FUNCTION public.send_problem_bot_alert(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_problem_bot_alert(text) TO service_role;

COMMENT ON FUNCTION public.send_problem_bot_alert(text) IS
  '텔레그램 "이온토플 문제봇"으로 운영 장애 알림 전송(Vault V2 열쇠). service_role 전용. 가입 이메일 인증 장애 알림에 사용.';

-- ---------- 4. 7일 지난 기록 정리 (매일 04:10 UTC = 13:10 KST) ----------
SELECT cron.unschedule('email-verifications-cleanup')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-verifications-cleanup');
SELECT cron.schedule(
  'email-verifications-cleanup',
  '10 4 * * *',
  $cron$ DELETE FROM public.email_verifications WHERE created_at < now() - interval '7 days' $cron$
);

-- =====================================================================
-- 되돌리기 (필요 시 수동 실행)
--   SELECT cron.unschedule('email-verifications-cleanup');
--   DROP FUNCTION IF EXISTS public.send_problem_bot_alert(text);
--   DROP TABLE IF EXISTS public.email_verification_state;
--   DROP TABLE IF EXISTS public.email_verifications;
-- =====================================================================
