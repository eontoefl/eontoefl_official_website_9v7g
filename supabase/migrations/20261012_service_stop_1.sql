-- =====================================================================
-- 환불처리 1단계 — 서버: 환불 기록 칸 + 판정(정지∪환불) + 회차 규칙 + 기존 가드 교체 + 환불 RPC 3개 (2026-10-12)
--   ⚠️ 이 파일은 supabase/tests/gen_service_stop_1.mjs 가 레포 원문에서 생성한다. 직접 고치지 말 것.
--   계획: C:\기능구현\환불처리\IMPLEMENTATION_PLAN.md (3-1절, 7장 S1~S16·D1~D3)
--
-- 설계 요점
--   - applications.service_stops (jsonb 배열). 항목:
--       { id, kind 'refund'|'dropped', target 'challenge'|'correction'|'both', amount, reason,
--         requested_on 'YYYY-MM-DD', created_at, created_by, paid_at, status 'active'|'withdrawn',
--         withdrawn_at, withdrawn_by, notify, notice_at }
--   - 환불 기준시각 service_stop_at(app, kind) = 그 상품을 덮는 active 항목 중 가장 이른 요청일 00:00 KST (D1).
--       이력이 비어 있고 옛 칸 app_status 가 refunded|dropped 이면(이 기능 전 기록) 둘 다 중단으로 본다.
--   - is_service_stopped(app, kind, date) = 환불 OR is_paused. 자동작업 가드 5곳은 이것만 본다(S3).
--   - 재개 안내·정지 RPC·시험 당일은 환불만 본다(service_stop_at) — 정지까지 보면 정지 기능이 멈춘다(S3).
--   - 회차 규칙(S2): 막힘 = (정지 중 AND (1차 미제출 OR 1차 ≥ 정지 기준)) OR (환불 AND (1차 미제출 OR 1차 ≥ 환불 기준)).
--   - 환불은 열린 정지를 건드리지 않는다(D2). 호환 칸(app_status·refund_*·correction_status)은 같이 갱신(S5).
--   - 알림톡 refund_notice 는 템플릿 번호가 나올 때까지 엣지함수가 거절(발송 없음).
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션). "Run without RLS".
-- 되돌리기: 맨 아래 ROLLBACK 주석.
-- =====================================================================

BEGIN;

-- ---------- 0) 사전 검사: 2026-10-12 라이브 본문 그대로일 때만 진행 ----------
DO $chk$
DECLARE v text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='applications' AND column_name='service_stops') THEN
    RAISE EXCEPTION 'ABORT applications.service_stops 칸이 이미 있음 — 이미 적용된 파일';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('service_stop_set','service_stop_at','is_service_stopped')) THEN
    RAISE EXCEPTION 'ABORT 환불 함수가 이미 있음 — 이미 적용된 파일';
  END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_set';
  IF v IS DISTINCT FROM 'af77e7a8dfcfcf5a54dac0a1c975b58b' THEN RAISE EXCEPTION 'ABORT schedule_pause_set 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_resume';
  IF v IS DISTINCT FROM 'e903db656b4ce56fe88112a8b8277117' THEN RAISE EXCEPTION 'ABORT schedule_pause_resume 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_cancel';
  IF v IS DISTINCT FROM '374c981ffed445ef527a3148c0f8c542' THEN RAISE EXCEPTION 'ABORT schedule_pause_cancel 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_undo';
  IF v IS DISTINCT FROM 'aa8f06cf722f109c22a2aae251034da2' THEN RAISE EXCEPTION 'ABORT schedule_pause_undo 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='schedule_pause_reschedule';
  IF v IS DISTINCT FROM 'bfec3c55ba1d257402a6993ebffc8955' THEN RAISE EXCEPTION 'ABORT schedule_pause_reschedule 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='correction_application_id';
  IF v IS DISTINCT FROM 'd7c881eb0213fa2929516092c4db5427' THEN RAISE EXCEPTION 'ABORT correction_application_id 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='correction_release_blocked';
  IF v IS DISTINCT FROM '742a4e28a346c5a41dbdf3edb0c348c5' THEN RAISE EXCEPTION 'ABORT correction_release_blocked 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_resume_notices';
  IF v IS DISTINCT FROM 'fb7a8ff85a2f2036c7e86d972a1306fe' THEN RAISE EXCEPTION 'ABORT process_resume_notices 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='preview_correction_session_reminders';
  IF v IS DISTINCT FROM 'ae989a91d94526e87b421718b3ddd47e' THEN RAISE EXCEPTION 'ABORT preview_correction_session_reminders 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='process_start_notices';
  IF v IS DISTINCT FROM '20b43537cc72e77cf957a93fa46ab391' THEN RAISE EXCEPTION 'ABORT process_start_notices 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='auto_enable_practice_mode';
  IF v IS DISTINCT FROM '582aa7bb83095371796e4cb06cb217d4' THEN RAISE EXCEPTION 'ABORT auto_enable_practice_mode 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='send_practice_open_alimtalk';
  IF v IS DISTINCT FROM '8a3cb4c50270c551df10151d2c34c753' THEN RAISE EXCEPTION 'ABORT send_practice_open_alimtalk 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='send_toefl_exam_day_alimtalk';
  IF v IS DISTINCT FROM '62197f67622269bde801096affb4eca6' THEN RAISE EXCEPTION 'ABORT send_toefl_exam_day_alimtalk 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;
END $chk$;

-- ---------- 1) 환불 기록 칸 ----------
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS service_stops jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.applications.service_stops IS '환불·중도포기 기록(배열). 항목: kind refund|dropped, target challenge|correction|both, amount, reason, requested_on, status active|withdrawn, paid_at 등. 판정은 service_stop_at/is_service_stopped. 호환 칸(app_status·refund_*·correction_status)은 _service_stop_sync_compat 가 같이 갱신.';

-- ---------- 2) 읽기 함수: 이력 / 환불 기준시각 / 정지∪환불 판정 ----------
CREATE OR REPLACE FUNCTION public.service_stop_entries(p_app_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(a.service_stops, '[]'::jsonb) FROM public.applications a WHERE a.id = p_app_id
$$;

-- 환불 기준시각: 그 상품(challenge|correction)을 덮는 active 항목 중 가장 이른 요청일의 00:00 KST. 없으면 NULL.
-- 이력이 비어 있고 옛 칸 app_status 가 refunded|dropped 이면(이 기능 전 기록, 상품 구분 없음) 둘 다 중단으로 본다(기준 = refund_at, 없으면 아주 이른 시각).
CREATE OR REPLACE FUNCTION public.service_stop_at(p_app_id uuid, p_kind text)
RETURNS timestamptz
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    a      record;
    v_min  timestamptz;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT id, app_status, refund_at, COALESCE(service_stops, '[]'::jsonb) AS stops INTO a FROM public.applications WHERE id = p_app_id;
    IF a.id IS NULL THEN RETURN NULL; END IF;
    SELECT MIN(((e->>'requested_on')::date)::timestamp AT TIME ZONE 'Asia/Seoul')
      INTO v_min
      FROM jsonb_array_elements(a.stops) e
     WHERE e->>'status' = 'active'
       AND (e->>'target' = 'both' OR e->>'target' = p_kind);
    IF v_min IS NOT NULL THEN RETURN v_min; END IF;
    IF jsonb_array_length(a.stops) = 0 AND COALESCE(a.app_status, '') IN ('refunded', 'dropped') THEN
        RETURN COALESCE(to_timestamp(a.refund_at / 1000.0), '-infinity'::timestamptz);
    END IF;
    RETURN NULL;
END;
$$;

-- "이 학생의 내챌/첨삭이 멈춰 있나" = 환불·중도포기 OR 일시정지. 자동작업 가드는 이것만 본다.
CREATE OR REPLACE FUNCTION public.is_service_stopped(p_app_id uuid, p_kind text, p_at date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'))::date)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT public.service_stop_at(p_app_id, p_kind) IS NOT NULL OR public.is_paused(p_app_id, p_kind, p_at)
$$;

-- ---------- 3) 보조: 항목 병합 / 호환 칸 동기화 ----------
CREATE OR REPLACE FUNCTION public._stop_entry_merge(p_app_id uuid, p_entry_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new jsonb := '[]'::jsonb;
    e     jsonb;
    v_hit jsonb;
BEGIN
    FOR e IN SELECT x FROM jsonb_array_elements(public.service_stop_entries(p_app_id)) x LOOP
        IF e->>'id' = p_entry_id THEN
            e := e || p_patch;
            v_hit := e;
        END IF;
        v_new := v_new || e;
    END LOOP;
    IF v_hit IS NULL THEN RAISE EXCEPTION '환불 항목 없음: %', p_entry_id; END IF;
    UPDATE public.applications SET service_stops = v_new WHERE id = p_app_id;
    RETURN v_hit;
END;
$$;

-- 호환 칸: 내챌을 덮는 active 항목이 있으면 app_status/refund_* , 첨삭을 덮는 active 항목이 있으면 correction_status. 없으면 NULL.
-- (옛 화면·n8n·탈퇴 판정이 이 칸을 읽는다. 새 코드는 service_stops 를 본다.)
CREATE OR REPLACE FUNCTION public._service_stop_sync_compat(p_app_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    ch jsonb;
    co jsonb;
BEGIN
    SELECT e INTO ch FROM jsonb_array_elements(public.service_stop_entries(p_app_id)) e
     WHERE e->>'status' = 'active' AND e->>'target' IN ('both', 'challenge')
     ORDER BY e->>'created_at' DESC LIMIT 1;
    SELECT e INTO co FROM jsonb_array_elements(public.service_stop_entries(p_app_id)) e
     WHERE e->>'status' = 'active' AND e->>'target' IN ('both', 'correction')
     ORDER BY e->>'created_at' DESC LIMIT 1;
    UPDATE public.applications
       SET app_status        = CASE WHEN ch IS NULL THEN NULL WHEN ch->>'kind' = 'dropped' THEN 'dropped' ELSE 'refunded' END,
           refund_reason     = CASE WHEN ch IS NULL THEN NULL ELSE COALESCE(ch->>'reason', '') END,
           refund_amount     = CASE WHEN ch IS NULL THEN NULL ELSE COALESCE((ch->>'amount')::bigint, 0) END,
           refund_at         = CASE WHEN ch IS NULL THEN NULL ELSE (extract(epoch FROM (ch->>'created_at')::timestamptz) * 1000)::bigint END,
           correction_status = CASE WHEN co IS NULL THEN NULL WHEN co->>'kind' = 'dropped' THEN 'dropped' ELSE 'refunded' END
     WHERE id = p_app_id;
END;
$$;

-- ---------- 4) 환불 RPC: 등록 / 철회 / 입금 완료 ----------
-- 등록 = 즉시 중단. 한 번 누름(대상 세 조합 중 하나, 금액·사유 한 번). 열린 정지는 건드리지 않는다(D2).
CREATE OR REPLACE FUNCTION public.service_stop_set(
    p_app_id uuid, p_kind text, p_target text,
    p_amount bigint DEFAULT 0, p_reason text DEFAULT NULL,
    p_requested_on date DEFAULT NULL, p_notify boolean DEFAULT true, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a          public.applications%ROWTYPE;
    v_today    date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_req      date := COALESCE(p_requested_on, (now() AT TIME ZONE 'Asia/Seoul')::date);
    v_id       text := gen_random_uuid()::text;
    v_entry    jsonb;
    v_uid      uuid;
    v_product  text;
    v_canceled int := 0;
BEGIN
    IF p_kind NOT IN ('refund', 'dropped') THEN RAISE EXCEPTION '종류는 refund 또는 dropped'; END IF;
    IF p_target NOT IN ('challenge', 'correction', 'both') THEN RAISE EXCEPTION '대상은 challenge, correction, both 중 하나'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF a.deposit_confirmed_by_admin IS NOT TRUE OR a.deleted IS TRUE THEN RAISE EXCEPTION '입금 확인된 신청서만 환불 처리할 수 있습니다.'; END IF;
    IF a.application_type IS DISTINCT FROM 'challenge' THEN RAISE EXCEPTION '챌린지 신청서만 환불 처리할 수 있습니다.'; END IF;
    IF p_target IN ('correction', 'both') AND a.correction_enabled IS NOT TRUE THEN RAISE EXCEPTION '첨삭이 켜져 있지 않은 신청서입니다. 첨삭 없이 내챌만 환불하세요.'; END IF;
    IF v_req > v_today THEN RAISE EXCEPTION '요청일은 오늘 이전이어야 합니다.'; END IF;
    IF COALESCE(p_amount, 0) < 0 THEN RAISE EXCEPTION '금액은 0 이상이어야 합니다.'; END IF;
    IF p_target IN ('challenge', 'both') AND public.service_stop_at(p_app_id, 'challenge') IS NOT NULL THEN RAISE EXCEPTION '내챌은 이미 환불·중도포기 처리돼 있습니다.'; END IF;
    IF p_target IN ('correction', 'both') AND public.service_stop_at(p_app_id, 'correction') IS NOT NULL THEN RAISE EXCEPTION '첨삭은 이미 환불·중도포기 처리돼 있습니다.'; END IF;

    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;
    v_product := CASE p_target WHEN 'challenge' THEN '내벨업챌린지' WHEN 'correction' THEN '스라첨삭' ELSE '내벨업챌린지+스라첨삭' END;

    v_entry := jsonb_build_object(
        'id', v_id,
        'kind', p_kind,
        'target', p_target,
        'amount', COALESCE(p_amount, 0),
        'reason', COALESCE(p_reason, ''),
        'requested_on', to_char(v_req, 'YYYY-MM-DD'),
        'status', 'active',
        'created_at', now(),
        'created_by', p_by,
        'paid_at', NULL,
        'notify', COALESCE(p_notify, true));
    UPDATE public.applications SET service_stops = service_stops || v_entry WHERE id = p_app_id;
    PERFORM public._service_stop_sync_compat(p_app_id);

    -- 첨삭 중단이면 미입금 연장 신청을 정리(남겨 두면 탈퇴 판정 (c)에 영구히 걸린다, S10)
    IF p_target IN ('correction', 'both') THEN
        UPDATE public.correction_extension_requests r
           SET status = 'canceled'
         WHERE r.status = 'pending'
           AND (r.application_id = p_app_id OR (v_uid IS NOT NULL AND r.user_id = v_uid));
        GET DIAGNOSTICS v_canceled = ROW_COUNT;
        IF v_canceled > 0 THEN
            v_entry := public._stop_entry_merge(p_app_id, v_id, jsonb_build_object('canceled_extension_requests', v_canceled));
        END IF;
    END IF;

    -- 환불 안내 알림톡(등록 즉시 1회). 템플릿 번호가 아직 0이면 엣지함수가 거절(발송 없음). 소급 입력은 p_notify=false.
    IF COALESCE(p_notify, true) THEN
        PERFORM public._pause_notify('refund_notice', jsonb_build_object(
            'name', COALESCE(a.name, ''), 'phone', a.phone, 'app_id', a.id::text,
            'product', v_product,
            'kind', CASE WHEN p_kind = 'dropped' THEN '중도포기' ELSE '환불' END,
            'amount', to_char(COALESCE(p_amount, 0), 'FM999,999,999'),
            'requested_on', public._kr_date_label(v_req)));
        v_entry := public._stop_entry_merge(p_app_id, v_id, jsonb_build_object('notice_at', now()));
    END IF;
    RETURN v_entry;
END;
$$;

-- 철회 = 진행중 복귀. 기록은 withdrawn 으로 남기고 날짜는 밀지 않는다. 알림톡 없음.
CREATE OR REPLACE FUNCTION public.service_stop_withdraw(p_app_id uuid, p_entry_id text, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    e       jsonb;
    v_entry jsonb;
BEGIN
    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;
    SELECT x INTO e FROM jsonb_array_elements(public.service_stop_entries(p_app_id)) x WHERE x->>'id' = p_entry_id;
    IF e IS NULL THEN RAISE EXCEPTION '환불 항목을 찾을 수 없습니다.'; END IF;
    IF e->>'status' <> 'active' THEN RAISE EXCEPTION '이미 철회된 항목입니다.'; END IF;
    v_entry := public._stop_entry_merge(p_app_id, p_entry_id, jsonb_build_object(
        'status', 'withdrawn', 'withdrawn_at', now(), 'withdrawn_by', p_by));
    PERFORM public._service_stop_sync_compat(p_app_id);
    RETURN v_entry;
END;
$$;

-- 입금 완료 체크(켜기/끄기). 학생 쪽 영향 없음.
CREATE OR REPLACE FUNCTION public.service_stop_mark_paid(p_app_id uuid, p_entry_id text, p_paid boolean DEFAULT true, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    e jsonb;
BEGIN
    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;
    SELECT x INTO e FROM jsonb_array_elements(public.service_stop_entries(p_app_id)) x WHERE x->>'id' = p_entry_id;
    IF e IS NULL THEN RAISE EXCEPTION '환불 항목을 찾을 수 없습니다.'; END IF;
    RETURN public._stop_entry_merge(p_app_id, p_entry_id, jsonb_build_object(
        'paid_at', CASE WHEN COALESCE(p_paid, true) THEN to_jsonb(now()) ELSE 'null'::jsonb END,
        'paid_by', CASE WHEN COALESCE(p_paid, true) THEN to_jsonb(p_by) ELSE 'null'::jsonb END));
END;
$$;

-- ---------- 5) 학생→신청서: 환불 신청서도 고른다(회차 규칙 판정에 필요, S5) ----------
CREATE OR REPLACE FUNCTION public.correction_application_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
AS $$
    SELECT a.id
      FROM public.applications a
     WHERE a.user_id = p_user_id::text
       AND a.application_type = 'challenge'
       AND a.correction_enabled IS TRUE
       AND a.deposit_confirmed_by_admin IS TRUE
       AND a.deleted IS NOT TRUE
     ORDER BY a.created_at DESC NULLS LAST, a.id
     LIMIT 1
$$;

-- 회차 규칙(S2): 막힘 = (정지 중 AND (1차 미제출 OR 1차 ≥ 정지 기준)) OR (환불 AND (1차 미제출 OR 1차 ≥ 환불 기준)).
-- 두 기준이 다 있으면 이른 쪽(D1). 신청서를 못 찾으면 안 막음(기존).
CREATE OR REPLACE FUNCTION public.correction_release_blocked(p_user_id uuid, p_draft1_at timestamp with time zone)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_app   uuid;
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e       jsonb;
    v_cut_p timestamptz;
    v_cut_s timestamptz;
    v_cut   timestamptz;
BEGIN
    v_app := public.correction_application_id(p_user_id);
    IF v_app IS NULL THEN RETURN false; END IF;
    SELECT x INTO e
      FROM jsonb_array_elements(public.schedule_pause_entries(v_app, 'correction')) x
     WHERE x->>'status' = 'open'
       AND v_today >= (x->>'paused_from')::date
       AND (NULLIF(x->>'resume_on', '') IS NULL OR v_today < (x->>'resume_on')::date)
     LIMIT 1;
    IF e IS NOT NULL THEN
        v_cut_p := GREATEST(
            ((e->>'paused_from')::date)::timestamp AT TIME ZONE 'Asia/Seoul',
            COALESCE((e->>'created_at')::timestamptz, '-infinity'::timestamptz));
    END IF;
    v_cut_s := public.service_stop_at(v_app, 'correction');
    IF v_cut_p IS NULL AND v_cut_s IS NULL THEN RETURN false; END IF;
    v_cut := LEAST(COALESCE(v_cut_p, 'infinity'::timestamptz), COALESCE(v_cut_s, 'infinity'::timestamptz));
    RETURN p_draft1_at IS NULL OR p_draft1_at >= v_cut;
END;
$$;

-- ---------- 6-1) 첨삭 회차 당일 알림(50244): 정지∪환불 건너뜀 ----------
CREATE OR REPLACE FUNCTION public.preview_correction_session_reminders(
    p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
    user_id        uuid,
    student_name   text,
    phone          text,
    timezone       text,
    local_now      timestamp,
    session_number int,
    tasks          text,
    deadline_text  text,
    deadline_at    timestamptz,
    track          text,
    reason         text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    -- 세션 1~12 의 시작일 기준 오프셋(일). 연장 13~24 도 extension_start_date 기준으로 같은 표를 쓴다.
    -- 원본: 테스트룸 js/correction-schedule-data.js (dayOffset). 바뀌면 여기도 같이 고친다.
    c_offset  CONSTANT int[]  := ARRAY[0,2,4,7,9,11,14,16,18,21,23,25];

    -- extract(dow) 0=일요일
    c_dow_kr  CONSTANT text[] := ARRAY['일','월','화','수','목','금','토'];

    -- 호주첨삭 1~12 과제 라벨 (스피킹이 앞). 원본: 테스트룸 js/correction-schedule-data-aus.js
    -- AUS_CORR_TYPES.label + js/correction/correction-main.js 카드 순서. 바뀌면 여기도 같이 고친다.
    c_aus     CONSTANT text[] := ARRAY[
        'IND SPK + DISCUSSION',   -- 1
        'INT SPK 2 + INT WRT',    -- 2
        'INT SPK 3 + DISCUSSION', -- 3
        'INT SPK 4 + INT WRT',    -- 4
        'IND SPK + DISCUSSION',   -- 5
        'INT SPK 2 + INT WRT',    -- 6
        'INT SPK 3 + DISCUSSION', -- 7
        'INT SPK 4 + INT WRT',    -- 8
        'IND SPK + DISCUSSION',   -- 9
        'INT SPK 2 + INT WRT',    -- 10
        'INT SPK 3 + DISCUSSION', -- 11
        'INT SPK 4 + INT WRT'     -- 12
    ];

    r           record;
    v_tz        text;
    v_local     timestamp;
    v_today     date;
    v_dates     date[];
    v_ext_dates date[];
    v_n         int;
    v_idx       int;
    v_date      date;
    v_reason    text;
    v_tasks     text;
    v_base      timestamptz;
    v_deadline  timestamptz;
    v_task_dl   timestamptz;
    v_cat       text;
    v_ext_hours numeric;
    v_ext_at    timestamptz;
    v_local_dl  timestamp;
BEGIN
    FOR r IN
        SELECT
            cs.user_id                            AS uid,
            COALESCE(u.name, '')                  AS student_name,
            u.phone                               AS phone,
            -- pg_timezone_names 에 없는 문자열(오타 등)이면 NULL → 아래에서 'Asia/Seoul' 로 대체.
            -- 이렇게 걸러야 잘못된 타임존 한 명 때문에 함수 전체가 죽지 않는다.
            tzn.name                              AS valid_tz,
            ap.app_id                             AS app_id,
            CASE WHEN COALESCE(ap.assigned_program, ap.preferred_program, '') LIKE '%Australia%'
                 THEN 'aus' ELSE 'general' END    AS track,
            cs.start_date                         AS start_date,
            cs.end_date                           AS end_date,
            cs.session_dates                      AS session_dates,
            COALESCE(cs.extension_enabled, false) AS extension_enabled,
            cs.extension_start_date               AS extension_start_date,
            cs.extension_end_date                 AS extension_end_date,
            cs.extension_session_dates            AS extension_session_dates
        FROM public.correction_schedules cs
        JOIN public.users u
          ON u.id = cs.user_id
        LEFT JOIN pg_catalog.pg_timezone_names tzn
          ON tzn.name = u.timezone
        -- 첨삭이 켜져 있고 입금 확인된, 삭제되지 않은 신청서가 "있는" 학생만 (INNER JOIN).
        -- 여러 건이면 가장 최근 신청서 하나로 트랙을 판정한다.
        -- ⚠️ applications.user_id 는 text, correction_schedules.user_id 는 uuid 다(라이브 확인 2026-09-16).
        --    ::text 캐스팅을 빼면 "operator does not exist: text = uuid" 로 함수 전체가 죽는다.
        JOIN LATERAL (
            SELECT a.id AS app_id, a.assigned_program, a.preferred_program
            FROM public.applications a
            WHERE a.user_id = cs.user_id::text
              AND a.correction_enabled = true
              AND a.deposit_confirmed_by_admin = true
              AND a.deleted IS NOT TRUE
            ORDER BY a.created_at DESC NULLS LAST, a.id
            LIMIT 1
        ) ap ON true
        WHERE u.phone IS NOT NULL
          AND btrim(u.phone) <> ''
    LOOP
        v_tz    := COALESCE(r.valid_tz, 'Asia/Seoul');
        v_local := p_at AT TIME ZONE v_tz;

        -- 발송 창 밖(현지 21:00~08:59)이면 이 학생은 통째로 건너뛴다.
        IF extract(hour FROM v_local) < 9 OR extract(hour FROM v_local) > 20 THEN
            CONTINUE;
        END IF;

        v_today := v_local::date;

        -- [일시정지] 첨삭 정지 중인 학생은 통째로 건너뛴다(정지 전 1차를 낸 회차는 알림 대상이 아니므로 여기서 가드해도 R3와 충돌 없음)
        IF public.is_service_stopped(r.app_id, 'correction', v_today) THEN   -- [정지∪환불]
            CONTINUE;
        END IF;

        -- 자기주도 확정 일정표(JSON 텍스트) 파싱. 깨져 있거나 12개가 아니면 NULL 로 두고
        -- 그 학생의 1~12 는 이번 실행에서 건너뛴다. (서버가 날짜를 계산·생성·저장하지 않는다.)
        v_dates := NULL;
        BEGIN
            SELECT array_agg(d.v::date ORDER BY d.ord)
              INTO v_dates
              FROM jsonb_array_elements_text((r.session_dates)::jsonb -> 'dates')
                   WITH ORDINALITY AS d(v, ord);
        EXCEPTION WHEN others THEN
            v_dates := NULL;
        END;
        IF COALESCE(array_length(v_dates, 1), 0) <> 12 THEN
            v_dates := NULL;
        END IF;

        v_ext_dates := NULL;
        BEGIN
            SELECT array_agg(d.v::date ORDER BY d.ord)
              INTO v_ext_dates
              FROM jsonb_array_elements_text((r.extension_session_dates)::jsonb -> 'dates')
                   WITH ORDINALITY AS d(v, ord);
        EXCEPTION WHEN others THEN
            v_ext_dates := NULL;
        END;
        IF COALESCE(array_length(v_ext_dates, 1), 0) <> 12 THEN
            v_ext_dates := NULL;
        END IF;

        FOR v_n IN 1..24 LOOP
            v_date   := NULL;
            v_reason := NULL;

            IF v_n <= 12 THEN
                v_idx := v_n;
                IF r.track = 'general' AND r.end_date IS NOT NULL THEN
                    -- 자기주도(종료일 지정형). 호주는 종료일이 있어도 자기주도가 아니다.
                    IF v_dates IS NOT NULL THEN
                        v_date   := v_dates[v_idx];
                        v_reason := 'selfpaced dates[' || (v_n - 1) || ']';
                    END IF;
                ELSIF r.start_date IS NOT NULL THEN
                    -- 정규·호주: 시작일 + 오프셋
                    v_date   := public.pause_adjusted_date(r.app_id, 'correction', r.start_date + c_offset[v_idx]);   -- [일시정지] 정지 기간 건너뛰기
                    v_reason := 'regular offset ' || c_offset[v_idx];
                END IF;
            ELSE
                -- 연장 13~24 는 일반 트랙만. 호주첨삭은 연장 자체가 없다.
                IF r.track = 'general' AND r.extension_enabled THEN
                    v_idx := v_n - 12;
                    IF r.extension_end_date IS NOT NULL THEN
                        IF v_ext_dates IS NOT NULL THEN
                            v_date   := v_ext_dates[v_idx];
                            v_reason := 'ext dates[' || (v_n - 13) || ']';
                        END IF;
                    ELSIF r.extension_start_date IS NOT NULL THEN
                        v_date   := public.pause_adjusted_date(r.app_id, 'correction', r.extension_start_date + c_offset[v_idx]);   -- [일시정지]
                        v_reason := 'ext offset ' || c_offset[v_idx];
                    END IF;
                END IF;
            END IF;

            -- 오늘(학생 현지 날짜)에 배정된 세션만
            IF v_date IS NULL OR v_date <> v_today THEN
                CONTINUE;
            END IF;

            -- 이미 보낸 (학생, 세션) 은 건너뛴다
            IF EXISTS (
                SELECT 1 FROM public.correction_session_reminders cr
                 WHERE cr.user_id = r.uid
                   AND cr.session_number = v_n
            ) THEN
                CONTINUE;
            END IF;

            -- 기본 1차 마감 = 배정일 다음날 04:00 (학생 시간대)
            v_base     := (v_date + 1 + time '04:00') AT TIME ZONE v_tz;
            v_deadline := NULL;

            -- 아직 1차를 안 낸 과제들의 실제 마감 중 가장 이른 것을 알림톡에 넣는다.
            FOREACH v_cat IN ARRAY ARRAY['writing','speaking'] LOOP
                IF EXISTS (
                    SELECT 1 FROM public.correction_submissions s
                     WHERE s.user_id = r.uid
                       AND s.session_number = v_n
                       AND s.task_type LIKE v_cat || '%'
                       AND s.draft_1_submitted_at IS NOT NULL
                ) THEN
                    CONTINUE;   -- 이 과제는 이미 제출 완료 → 마감 후보 아님
                END IF;

                -- 1차에 걸린 연장 중 가장 늦게 등록된 행 하나
                -- (draft_round = 1 → 1차만, NULL → 1·2차 둘 다인 옛 행)
                v_ext_hours := NULL;
                v_ext_at    := NULL;
                SELECT e.extended_hours::numeric, e.created_at
                  INTO v_ext_hours, v_ext_at
                  FROM public.correction_deadline_extensions e
                 WHERE e.user_id = r.uid
                   AND e.session_number = v_n
                   AND e.task_type LIKE v_cat || '%'
                   AND (e.draft_round = 1 OR e.draft_round IS NULL)
                 ORDER BY e.created_at DESC NULLS LAST
                 LIMIT 1;

                v_task_dl := v_base;
                IF v_ext_hours IS NOT NULL AND v_ext_hours > 0 THEN
                    -- 마감 전 연장 → 기본마감 + N시간 / 마감 후 연장 → 연장 건 시각 + N시간
                    v_task_dl := greatest(v_base, COALESCE(v_ext_at, v_base))
                                 + (v_ext_hours * interval '1 hour');
                END IF;

                IF v_deadline IS NULL OR v_task_dl < v_deadline THEN
                    v_deadline := v_task_dl;
                END IF;
            END LOOP;

            -- writing·speaking 둘 다 1차 제출 완료 → 안내할 마감이 없다 → 보내지 않는다
            IF v_deadline IS NULL THEN
                CONTINUE;
            END IF;

            -- 과제 라벨
            IF r.track = 'aus' THEN
                v_tasks := c_aus[v_n];                    -- 호주는 위에서 1~12 로만 걸러진다
            ELSIF v_n % 2 = 1 THEN
                v_tasks := 'Email + Interview';           -- 홀수 세션
            ELSE
                v_tasks := 'Discussion + Interview';      -- 짝수 세션
            END IF;

            v_local_dl := v_deadline AT TIME ZONE v_tz;

            RETURN QUERY SELECT
                r.uid,
                r.student_name,
                r.phone,
                v_tz,
                v_local,
                v_n,
                v_tasks,
                to_char(v_local_dl, 'FMMM/FMDD')
                    || '(' || c_dow_kr[extract(dow FROM v_local_dl)::int + 1] || ') '
                    || to_char(v_local_dl, 'HH24:MI'),
                v_deadline,
                r.track,
                v_reason;
        END LOOP;
    END LOOP;
END;
$$;

-- ---------- 6-2) 시작 안내(50208·50213): 정지∪환불 제외. 첨삭 쪽은 내챌 환불 표시가 아니라 첨삭 판정을 본다 ----------
CREATE OR REPLACE FUNCTION public.process_start_notices(
    p_kind    text DEFAULT NULL,
    p_app_id  uuid DEFAULT NULL,
    p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
    v_today   date      := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_url     text;
    v_key     text;
    r         record;
    v_n       integer := 0;
BEGIN
    -- 밤 0~7시에는 보내지 않는다(매일 10시 확인이 이어받음)
    IF extract(hour from v_now_kst) < 7 THEN
        RETURN 0;
    END IF;

    v_url := get_supabase_url();
    v_key := get_service_role_key();

    -- 내챌 시작 안내 (50208)
    IF p_kind IS NULL OR p_kind = 'challenge' THEN
        FOR r IN
            SELECT a.id, a.name, a.phone, a.assigned_program, a.schedule_start, x.sd
            FROM applications a
            -- 날짜 모양이 아닌 시작일은 NULL로(형변환 오류로 전체가 멈추지 않게)
            CROSS JOIN LATERAL (
                SELECT CASE WHEN a.schedule_start ~ '^\d{4}-\d{2}-\d{2}$'
                            THEN a.schedule_start::date END AS sd
            ) x
            WHERE (p_app_id IS NULL OR a.id = p_app_id)
              AND a.application_type = 'challenge'
              AND a.deposit_confirmed_by_admin IS TRUE
              AND a.deleted IS NOT TRUE
              AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
              AND NOT public.is_service_stopped(a.id, 'challenge', v_today)   -- [정지∪환불]
              AND x.sd IN (v_today, v_today + 1)
              AND v_now_kst >= (x.sd - 1) + time '10:00'
              AND a.start_notice_sent_for IS DISTINCT FROM x.sd
            FOR UPDATE OF a SKIP LOCKED
        LOOP
            UPDATE applications
               SET start_notice_sent_for = r.sd,
                   kakaotalk_d1_sent = true,
                   kakaotalk_d1_sent_at = now()
             WHERE id = r.id;
            IF COALESCE(r.phone, '') <> '' THEN
                PERFORM net.http_post(
                    url := v_url || '/functions/v1/kakaotalk-notify',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_key),
                    body := jsonb_build_object(
                        'type', 'challenge_reminder',
                        'data', jsonb_build_object(
                            'name', r.name,
                            'phone', r.phone,
                            'program', COALESCE(r.assigned_program, ''),
                            'start_date', COALESCE(r.schedule_start, ''),
                            'app_id', r.id::text)));
            END IF;
            v_n := v_n + 1;
        END LOOP;
    END IF;

    -- 첨삭 시작 안내 (50213): 기준 = 첨삭 일정표 시작일, 수신 조건 = 회차 당일 알림과 같은 신청서 조건
    IF p_kind IS NULL OR p_kind = 'correction' THEN
        FOR r IN
            SELECT cs.id AS schedule_id, cs.start_date, u.name, u.phone,
                   COALESCE(ap.assigned_program, ap.preferred_program, '') AS program
            FROM correction_schedules cs
            JOIN users u ON u.id = cs.user_id
            JOIN LATERAL (
                SELECT a.assigned_program, a.preferred_program
                FROM applications a
                WHERE a.user_id = cs.user_id::text
                  AND (p_app_id IS NULL OR a.id = p_app_id)
                  AND a.application_type = 'challenge'
                  AND a.correction_enabled IS TRUE
                  AND a.deposit_confirmed_by_admin IS TRUE
                  AND a.deleted IS NOT TRUE
                  AND NOT public.is_service_stopped(a.id, 'correction', v_today)   -- [정지∪환불] (app_status 조건은 첨삭 판정으로 대체, S5)
                ORDER BY a.created_at DESC NULLS LAST
                LIMIT 1
            ) ap ON true
            WHERE (p_user_id IS NULL OR cs.user_id = p_user_id)
              AND cs.start_date IN (v_today, v_today + 1)
              AND v_now_kst >= (cs.start_date - 1) + time '10:00'
              AND cs.start_notice_sent_for IS DISTINCT FROM cs.start_date
            FOR UPDATE OF cs SKIP LOCKED
        LOOP
            UPDATE correction_schedules
               SET start_notice_sent_for = r.start_date,
                   kakaotalk_d1_sent = true,
                   kakaotalk_d1_sent_at = now()
             WHERE id = r.schedule_id;
            IF COALESCE(r.phone, '') <> '' THEN
                PERFORM net.http_post(
                    url := v_url || '/functions/v1/kakaotalk-notify',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_key),
                    body := jsonb_build_object(
                        'type', 'correction_start_reminder',
                        'data', jsonb_build_object(
                            'name', COALESCE(r.name, ''),
                            'phone', r.phone,
                            'program', r.program,
                            'start_date', r.start_date::text)));
            END IF;
            v_n := v_n + 1;
        END LOOP;
    END IF;

    RETURN v_n;
END;
$$;

-- ---------- 6-3) 연습코스 자동 오픈: 정지∪환불 제외 ----------
CREATE OR REPLACE FUNCTION auto_enable_practice_mode()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_count INTEGER := 0;
BEGIN
    WITH candidate AS (
        SELECT
            a.id,
            a.email,
            GREATEST(safe_to_date(a.schedule_end), a.self_paced_end_date) AS end_date,
            CASE
                WHEN COALESCE(a.assigned_program, a.preferred_program, '') ILIKE '%fast%'
                    THEN 'fast'
                ELSE 'standard'
            END AS program
        FROM applications a
        WHERE a.deposit_confirmed_by_admin = true
          AND COALESCE(a.practice_enabled, false) = false
          AND COALESCE(a.practice_disabled_manually, false) = false
          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
          AND NOT public.is_service_stopped(a.id, 'challenge', v_today)   -- [정지∪환불]
          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.
          AND COALESCE(a.course_track, 'regular') <> 'australia'
    ),
    scored AS (
        SELECT
            c.id,
            c.end_date,
            (SELECT count(*) FROM practice_final_tasks f
              WHERE f.program = c.program) AS required_cnt,
            (SELECT count(*)
               FROM practice_final_tasks f
               JOIN users u             ON u.email = c.email
               JOIN study_results_v3 r  ON r.user_id = u.id::text
              WHERE f.program        = c.program
                AND r.week           = f.week_text
                AND r.day            = '금'
                AND r.section_type   = f.section_type
                AND r.module_number  = f.module_number
                AND r.completed_at IS NOT NULL) AS done_cnt
        FROM candidate c
    )
    UPDATE applications
    SET practice_enabled        = true,
        practice_enabled_at     = now(),
        practice_enabled_source = 'auto'
    WHERE id IN (
        SELECT s.id
        FROM scored s
        WHERE s.end_date <= v_today
           OR (s.required_cnt > 0 AND s.done_cnt >= s.required_cnt)
    );

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        RAISE NOTICE '[practice] 연습코스 자동 활성화: %건', v_count;
    END IF;

    RETURN v_count;
END;
$$;

-- ---------- 6-4) 연습코스 오픈 알림톡(50231): 정지∪환불 제외 ----------
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
          AND NOT public.is_service_stopped(a.id, 'challenge')   -- [정지∪환불]
          AND COALESCE(a.phone, '') <> ''
          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.
          AND COALESCE(a.course_track, 'regular') <> 'australia'
        FOR UPDATE OF a SKIP LOCKED
    LOOP
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

-- ---------- 7-1) 재개 안내(50249/50250): 환불된 상품 제외(정지 자체는 봐야 하므로 환불만) ----------
CREATE OR REPLACE FUNCTION public.process_resume_notices(p_app_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
    v_today   date      := (now() AT TIME ZONE 'Asia/Seoul')::date;
    r         record;
    v_n       int := 0;
    v_resume  date;
    v_end     date;
    v_next    text;
    v_uid     uuid;
    v_s       int;
    v_d       date;
BEGIN
    IF extract(hour FROM v_now_kst) < 7 THEN RETURN 0; END IF;   -- 밤 0~7시 미발송(시작 안내와 같은 규칙)
    FOR r IN
        SELECT a.id AS app_id, a.name, a.phone, a.user_id, a.schedule_end, a.self_paced_end_date,
               a.correction_start_date, a.correction_end_date, a.extension_start_date, a.extension_end_date,
               k.kind, e AS entry
          FROM public.applications a
          CROSS JOIN LATERAL (VALUES ('challenge', a.challenge_pauses), ('correction', a.correction_pauses)) AS k(kind, arr)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(k.arr, '[]'::jsonb)) e
         WHERE (p_app_id IS NULL OR a.id = p_app_id)
           AND e->>'status' IN ('open', 'resumed')
           AND NULLIF(e->>'resume_on', '') IS NOT NULL
           AND (e->>'resume_on')::date IN (v_today, v_today + 1)
           AND v_now_kst >= ((e->>'resume_on')::date - 1) + time '10:00'
           AND e->>'resume_notice_sent_for' IS DISTINCT FROM e->>'resume_on'
           AND public.service_stop_at(a.id, k.kind) IS NULL   -- [환불] 환불된 상품의 재개 안내는 보내지 않는다
    LOOP
        v_resume := (r.entry->>'resume_on')::date;
        PERFORM public._pause_entry_merge(r.app_id, r.kind, r.entry->>'id',
                    jsonb_build_object('resume_notice_sent_for', r.entry->>'resume_on', 'resume_notice_at', now()));
        v_next := NULL;
        IF r.kind = 'challenge' THEN
            v_end := GREATEST(safe_to_date(r.schedule_end), r.self_paced_end_date);
        ELSE
            IF r.extension_start_date IS NOT NULL THEN
                v_end := COALESCE(r.extension_end_date, public.pause_adjusted_date(r.app_id, 'correction', r.extension_start_date + 27));
            ELSE
                v_end := COALESCE(r.correction_end_date,
                                  CASE WHEN r.correction_start_date ~ '^\d{4}-\d{2}-\d{2}$'
                                       THEN public.pause_adjusted_date(r.app_id, 'correction', r.correction_start_date::date + 27) END);
            END IF;
            IF r.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                v_uid := r.user_id::uuid;
                FOR v_s IN 1..24 LOOP
                    v_d := public.pause_adjusted_date(r.app_id, 'correction', public.correction_session_nominal_date(v_uid, v_s));
                    IF v_d IS NOT NULL AND v_d >= v_resume THEN
                        v_next := v_s || '회차 ' || public._kr_date_label(v_d);
                        EXIT;
                    END IF;
                END LOOP;
            END IF;
        END IF;
        PERFORM public._pause_notify('schedule_resumed', jsonb_build_object(
            'name', COALESCE(r.name, ''), 'phone', r.phone, 'app_id', r.app_id::text,
            'target', CASE WHEN r.kind = 'challenge' THEN '내벨업챌린지' ELSE '스라첨삭' END,
            'resume_on', public._kr_date_label(v_resume),
            'end_date', public._kr_date_label(v_end),
            'next_session', COALESCE(v_next, '')));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

-- ---------- 7-2) 정지 등록: 환불 검사를 상품별로(내챌만 환불한 학생의 첨삭 정지는 허용, 첨삭만 환불한 학생의 첨삭 정지는 금지) ----------
CREATE OR REPLACE FUNCTION public.schedule_pause_set(
    p_app_id      uuid,
    p_kind        text,
    p_paused_from date,
    p_resume_on   date DEFAULT NULL,
    p_note        text DEFAULT NULL,
    p_by          text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a          public.applications%ROWTYPE;
    v_today    date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_last_sun date := (now() AT TIME ZONE 'Asia/Seoul')::date - extract(dow FROM (now() AT TIME ZONE 'Asia/Seoul')::date)::int;
    v_start    date;
    v_end      date;
    v_entry    jsonb;
    v_id       text := gen_random_uuid()::text;
    v_shift    int;
    v_uid      uuid;
    v_reverted int := 0;
    v_deleted  int := 0;
    v_target   text;
    v_label_from text;
    v_before   jsonb;
    v_rev_rows jsonb := '[]'::jsonb;
    v_rem_rows jsonb := '[]'::jsonb;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF a.deposit_confirmed_by_admin IS NOT TRUE OR a.deleted IS TRUE THEN RAISE EXCEPTION '입금 확인된 신청서만 정지할 수 있습니다.'; END IF;
    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정은 정지할 수 없습니다.'; END IF;   -- [환불] 상품별(S5·S6)
    IF public.is_paused(p_app_id, p_kind, v_today)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
                   WHERE x->>'status' = 'open' AND (x->>'paused_from')::date > v_today) THEN
        RAISE EXCEPTION '이미 정지 중이거나 정지가 예약돼 있습니다. 먼저 재개·취소하세요.';
    END IF;

    IF p_kind = 'challenge' THEN
        IF a.schedule_start !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '내챌 시작일이 없습니다.'; END IF;
        v_start := a.schedule_start::date;
        IF a.self_paced IS TRUE AND a.self_paced_end_date IS NULL THEN
            RAISE EXCEPTION '종료일이 없는 옛 자기주도 과정은 일시정지를 지원하지 않습니다.';
        END IF;
        v_end := GREATEST(safe_to_date(a.schedule_end), a.self_paced_end_date);
        v_target := '내벨업챌린지';
    ELSE
        IF a.correction_enabled IS NOT TRUE OR a.correction_start_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
            RAISE EXCEPTION '첨삭이 켜져 있고 시작일이 있어야 합니다.';
        END IF;
        v_start := a.correction_start_date::date;
        v_end := COALESCE(a.extension_end_date,
                          CASE WHEN a.extension_start_date IS NOT NULL THEN public.pause_adjusted_date(p_app_id, 'correction', a.extension_start_date + 27) END,
                          a.correction_end_date,
                          public.pause_adjusted_date(p_app_id, 'correction', v_start + 27));
        v_target := '스라첨삭';
    END IF;

    -- D15: 진행 중일 때만
    IF v_start > v_today THEN RAISE EXCEPTION '아직 시작 전입니다. 시작 전 조정은 시작일 변경으로 하세요.'; END IF;
    IF v_end IS NOT NULL AND v_end < v_today THEN RAISE EXCEPTION '이미 종료된 과정입니다.'; END IF;
    -- R6: 소급은 최근 일요일까지, 시작일 이전 불가. 예약은 180일 이내.
    IF p_paused_from IS NULL THEN RAISE EXCEPTION '정지 시작일을 입력하세요.'; END IF;
    IF p_paused_from < v_last_sun THEN RAISE EXCEPTION '소급 정지는 최근 일요일(%)까지만 가능합니다.', v_last_sun; END IF;
    IF p_paused_from < v_start THEN RAISE EXCEPTION '정지 시작일이 과정 시작일보다 앞설 수 없습니다.'; END IF;
    IF p_paused_from > v_today + 180 THEN RAISE EXCEPTION '정지 시작일은 180일 이내여야 합니다.'; END IF;
    -- V1: 재개일 = 정지 시작일 + 7×N
    IF p_resume_on IS NOT NULL THEN
        IF p_resume_on <= p_paused_from THEN RAISE EXCEPTION '재개일은 정지 시작일 뒤여야 합니다.'; END IF;
        IF (p_resume_on - p_paused_from) % 7 <> 0 THEN RAISE EXCEPTION '재개일은 정지 시작일과 같은 요일(7일 단위)이어야 합니다.'; END IF;
        v_shift := p_resume_on - p_paused_from;
    END IF;

    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    -- (4단계) 되돌리기용: 밀기 전 저장 날짜
    v_before := public._pause_snapshot(p_app_id, p_kind);

    -- R6: 소급 구간에서 미제출로 0%/실전만으로 50% 굳은 과제를 미확정으로 되돌린다(내챌). 정당한 점수(보카·100)는 제외.
    IF p_kind = 'challenge' AND p_paused_from <= v_today AND a.self_paced IS NOT TRUE THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'locked_auth_rate', r.locked_auth_rate)), '[]'::jsonb)
          INTO v_rev_rows
          FROM public.study_results_v3 r
         WHERE r.user_id = a.user_id
           AND r.week ~ '^\d+$'
           AND r.day IN ('일','월','화','수','목','금')
           AND (v_start + (r.week::int - 1) * 7 + (array_position(ARRAY['일','월','화','수','목','금'], r.day) - 1))
               BETWEEN p_paused_from AND v_today
           AND (
                (r.locked_auth_rate = 0  AND r.initial_record IS NULL)
             OR (r.locked_auth_rate = 50 AND r.initial_record IS NOT NULL AND r.error_note_submitted IS NOT TRUE
                 AND r.section_type IN ('reading','listening','writing','speaking'))
           );
        UPDATE public.study_results_v3 r
           SET locked_auth_rate = NULL
         WHERE r.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_rev_rows) x);
        GET DIAGNOSTICS v_reverted = ROW_COUNT;
    END IF;

    -- Q2: 소급 구간에 이미 나간 회차 알림 기록(1차 미제출 회차)을 지워 재개 후 새 날짜에 다시 안내되게 한다.
    IF p_kind = 'correction' AND p_paused_from <= v_today AND v_uid IS NOT NULL THEN
        WITH d AS (
            DELETE FROM public.correction_session_reminders cr
             WHERE cr.user_id = v_uid
               AND COALESCE(public.correction_session_nominal_date(v_uid, cr.session_number), '1900-01-01') >= p_paused_from
               AND NOT EXISTS (SELECT 1 FROM public.correction_submissions s
                                WHERE s.user_id = v_uid AND s.session_number = cr.session_number
                                  AND s.draft_1_submitted_at IS NOT NULL)
            RETURNING cr.session_number, cr.sent_at, cr.payload)
        SELECT COALESCE(jsonb_agg(jsonb_build_object('session_number', d.session_number, 'sent_at', d.sent_at, 'payload', d.payload)), '[]'::jsonb)
          INTO v_rem_rows FROM d;
        v_deleted := jsonb_array_length(v_rem_rows);
    END IF;

    v_entry := jsonb_build_object(
        'id', v_id,
        'paused_from', to_char(p_paused_from, 'YYYY-MM-DD'),
        'resume_on', CASE WHEN p_resume_on IS NULL THEN NULL ELSE to_char(p_resume_on, 'YYYY-MM-DD') END,
        'shift_days', v_shift,
        'status', 'open',
        'created_at', now(),
        'created_by', p_by,
        'note', p_note,
        'reverted_rows', v_reverted,
        'deleted_reminders', v_deleted);

    IF p_kind = 'challenge' THEN
        UPDATE public.applications SET challenge_pauses = challenge_pauses || v_entry WHERE id = p_app_id;
    ELSE
        UPDATE public.applications SET correction_pauses = correction_pauses || v_entry WHERE id = p_app_id;
    END IF;

    -- 기간형: 재개일을 아니까 저장된 날짜를 지금 민다(D5·4-1③)
    IF v_shift IS NOT NULL THEN
        PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, p_paused_from, v_shift);
        v_entry := public._pause_entry_merge(p_app_id, p_kind, v_id, jsonb_build_object('shift_applied_at', now()));
    END IF;

    -- (4단계) 되돌리기용 스냅샷 저장: 밀기 전/후 + 되돌린 과제 행 + 지운 알림 기록
    v_entry := public._pause_entry_merge(p_app_id, p_kind, v_id, jsonb_build_object('undo', jsonb_build_object(
        'before', v_before,
        'after', public._pause_snapshot(p_app_id, p_kind),
        'reverted', v_rev_rows,
        'reminders', v_rem_rows)));

    -- D16: 정지 안내 알림톡(등록 즉시). 템플릿 미등록이면 엣지함수가 거절(발송 없음).
    PERFORM public._pause_notify('schedule_paused', jsonb_build_object(
        'name', COALESCE(a.name, ''), 'phone', a.phone, 'app_id', a.id::text,
        'target', v_target,
        'paused_from', public._kr_date_label(p_paused_from),
        'resume_on', public._kr_date_label(p_resume_on)));
    v_entry := public._pause_entry_merge(p_app_id, p_kind, v_id, jsonb_build_object('pause_notice_at', now()));

    RETURN v_entry;
END;
$$;

-- ---------- 7-3) 정지 재개: 환불된 상품은 거절 ----------
CREATE OR REPLACE FUNCTION public.schedule_pause_resume(
    p_app_id    uuid,
    p_kind      text,
    p_resume_on date,
    p_by        text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e       jsonb;
    v_from  date;
    v_shift int;
    v_entry jsonb;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정입니다. 먼저 환불을 철회하세요.'; END IF;   -- [환불]
    SELECT x INTO e
      FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
     WHERE x->>'status' = 'open' AND NULLIF(x->>'resume_on', '') IS NULL
     LIMIT 1;
    IF e IS NULL THEN RAISE EXCEPTION '재개할 무기한 정지가 없습니다.'; END IF;
    v_from := (e->>'paused_from')::date;
    IF p_resume_on IS NULL THEN RAISE EXCEPTION '재개일을 입력하세요.'; END IF;
    IF p_resume_on <= v_from THEN RAISE EXCEPTION '재개일은 정지 시작일 뒤여야 합니다.'; END IF;
    IF p_resume_on < v_today THEN RAISE EXCEPTION '재개일은 오늘 이후여야 합니다.'; END IF;
    IF (p_resume_on - v_from) % 7 <> 0 THEN RAISE EXCEPTION '재개일은 정지 시작일과 같은 요일(7일 단위)이어야 합니다.'; END IF;
    v_shift := p_resume_on - v_from;

    v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
        'resume_on', to_char(p_resume_on, 'YYYY-MM-DD'),
        'shift_days', v_shift,
        'resumed_by', p_by,
        'resumed_at', now(),
        'status', CASE WHEN p_resume_on <= v_today THEN 'resumed' ELSE 'open' END));
    PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, v_from, v_shift);
    v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object('shift_applied_at', now()));

    -- R7: 재개 안내는 재개 전날 10시 규칙(process_resume_notices). 그 시각이 지났으면 지금 바로.
    PERFORM public.process_resume_notices(p_app_id);
    RETURN public._pause_entry_merge(p_app_id, p_kind, e->>'id', '{}'::jsonb);
END;
$$;

-- ---------- 7-4) 예약 정지 취소: 환불된 상품은 거절 ----------
CREATE OR REPLACE FUNCTION public.schedule_pause_cancel(
    p_app_id uuid,
    p_kind   text,
    p_by     text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e       jsonb;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정입니다. 먼저 환불을 철회하세요.'; END IF;   -- [환불]
    SELECT x INTO e
      FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
     WHERE x->>'status' = 'open' AND (x->>'paused_from')::date > v_today
     LIMIT 1;
    IF e IS NULL THEN RAISE EXCEPTION '취소할 예약 정지가 없습니다(이미 시작된 정지는 재개로 처리).'; END IF;
    IF NULLIF(e->>'shift_days', '') IS NOT NULL AND e ? 'shift_applied_at' THEN
        PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, (e->>'paused_from')::date, -((e->>'shift_days')::int));
    END IF;
    RETURN public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
        'status', 'canceled', 'canceled_at', now(), 'canceled_by', p_by));
END;
$$;

-- ---------- 7-5) 정지 되돌리기: 환불된 상품은 거절 ----------
CREATE OR REPLACE FUNCTION public.schedule_pause_undo(p_app_id uuid, p_kind text, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a      public.applications%ROWTYPE;
    v_chk  jsonb;
    e      jsonb;
    x      jsonb;
    v_uid  uuid;
    v_restored_rows int := 0;
    v_restored_rem  int := 0;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정입니다. 먼저 환불을 철회하세요.'; END IF;   -- [환불]
    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_uid := a.user_id::uuid; END IF;

    v_chk := public.schedule_pause_undo_check(p_app_id, p_kind);
    IF (v_chk->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION '되돌릴 수 없습니다: %', (SELECT string_agg(r, ' / ') FROM jsonb_array_elements_text(v_chk->'reasons') r);
    END IF;
    SELECT y INTO e FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) y WHERE y->>'id' = v_chk->>'entry_id';

    -- 1) 저장 날짜 복원(밀기 전 값 그대로)
    PERFORM public._pause_snapshot_restore(p_app_id, p_kind, e->'undo'->'before');

    -- 2) R6로 미확정으로 돌렸던 과제 행 → 이전 값으로
    FOR x IN SELECT y FROM jsonb_array_elements(COALESCE(e->'undo'->'reverted', '[]'::jsonb)) y LOOP
        UPDATE public.study_results_v3 r SET locked_auth_rate = (x->>'locked_auth_rate')::int
         WHERE r.id = (x->>'id')::uuid AND r.user_id = a.user_id;
        IF FOUND THEN v_restored_rows := v_restored_rows + 1; END IF;
    END LOOP;

    -- 3) Q2로 지운 회차 알림 기록 → 다시 넣기(같은 회차 중복 발송 방지)
    IF v_uid IS NOT NULL THEN
        FOR x IN SELECT y FROM jsonb_array_elements(COALESCE(e->'undo'->'reminders', '[]'::jsonb)) y LOOP
            INSERT INTO public.correction_session_reminders (user_id, session_number, sent_at, payload)
            VALUES (v_uid, (x->>'session_number')::int, COALESCE((x->>'sent_at')::timestamptz, now()), x->'payload')
            ON CONFLICT (user_id, session_number) DO NOTHING;
            IF FOUND THEN v_restored_rem := v_restored_rem + 1; END IF;
        END LOOP;
    END IF;

    -- 4) 항목은 취소 이력으로(status canceled → 정지 판정·시작일 검사·종료일 계산에서 모두 제외)
    RETURN public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
        'status', 'canceled', 'canceled_at', now(), 'canceled_by', p_by,
        'undone_at', now(), 'undone_by', p_by,
        'undo_restored_rows', v_restored_rows, 'undo_restored_reminders', v_restored_rem,
        'note', NULLIF(concat_ws(' · ', NULLIF(e->>'note', ''), '되돌림(정지 전 상태로 복원)'), '')));
END;
$$;

-- ---------- 7-6) 정지 기간 수정: 환불된 상품은 거절 ----------
CREATE OR REPLACE FUNCTION public.schedule_pause_reschedule(
    p_app_id    uuid,
    p_kind      text,
    p_resume_on date,
    p_by        text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today   date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e         jsonb;
    v_from    date;
    v_old     date;
    v_old_sh  int;
    v_new_sh  int;
    v_delta   int;
    v_entry   jsonb;
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정입니다. 먼저 환불을 철회하세요.'; END IF;   -- [환불]
    SELECT x INTO e
      FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
     WHERE x->>'status' = 'open'
       AND (NULLIF(x->>'resume_on', '') IS NULL OR (x->>'resume_on')::date > v_today)
     ORDER BY x->>'created_at' DESC
     LIMIT 1;
    IF e IS NULL THEN RAISE EXCEPTION '수정할 진행 중 정지가 없습니다(재개일이 지난 정지는 수정할 수 없음).'; END IF;
    v_from   := (e->>'paused_from')::date;
    v_old    := NULLIF(e->>'resume_on', '')::date;
    v_old_sh := NULLIF(e->>'shift_days', '')::int;

    IF p_resume_on IS NULL THEN
        -- 재개일 → 무기한: 밀어 둔 만큼 되돌리고 재개일을 비운다
        IF v_old IS NULL THEN RAISE EXCEPTION '이미 무기한 정지입니다.'; END IF;
        IF v_old_sh IS NOT NULL AND e ? 'shift_applied_at' THEN
            PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, v_from, -v_old_sh);
        END IF;
        PERFORM public._pause_entry_unset(p_app_id, p_kind, e->>'id', ARRAY['shift_applied_at']);
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'resume_on', NULL, 'shift_days', NULL,
            'prev_resume_on', to_char(v_old, 'YYYY-MM-DD'), 'rescheduled_at', now(), 'rescheduled_by', p_by));

    ELSIF v_old IS NULL THEN
        -- 무기한 → 재개일: 기존 재개 함수 그대로(검증·밀기·재개 안내 포함)
        PERFORM public.schedule_pause_resume(p_app_id, p_kind, p_resume_on, p_by);
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'prev_resume_on', NULL, 'rescheduled_at', now(), 'rescheduled_by', p_by));

    ELSE
        -- 재개일 → 다른 재개일: 차이만큼만 밀기(음수 가능)
        IF p_resume_on <= v_from THEN RAISE EXCEPTION '재개일은 정지 시작일 뒤여야 합니다.'; END IF;
        IF p_resume_on < v_today THEN RAISE EXCEPTION '재개일은 오늘 이후여야 합니다.'; END IF;
        IF (p_resume_on - v_from) % 7 <> 0 THEN RAISE EXCEPTION '재개일은 정지 시작일과 같은 요일(7일 단위)이어야 합니다.'; END IF;
        IF p_resume_on = v_old THEN RAISE EXCEPTION '재개일이 지금과 같습니다.'; END IF;
        v_new_sh := p_resume_on - v_from;
        v_delta  := v_new_sh - CASE WHEN e ? 'shift_applied_at' THEN COALESCE(v_old_sh, 0) ELSE 0 END;
        IF v_delta <> 0 THEN
            PERFORM public.schedule_pause_apply_shift(p_app_id, p_kind, v_from, v_delta);
        END IF;
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'resume_on', to_char(p_resume_on, 'YYYY-MM-DD'),
            'shift_days', v_new_sh,
            'shift_applied_at', now(),
            'prev_resume_on', to_char(v_old, 'YYYY-MM-DD'), 'rescheduled_at', now(), 'rescheduled_by', p_by,
            'status', CASE WHEN p_resume_on <= v_today THEN 'resumed' ELSE 'open' END));
        -- R7: 새 재개일 기준 전날 10시가 지났으면 지금 바로 재개 안내(이미 그 날짜로 보냈으면 안 보냄)
        PERFORM public.process_resume_notices(p_app_id);
    END IF;

    -- 되돌리기 비교 기준(undo.after)을 지금 값으로 갱신(스냅샷 있는 항목만)
    IF e ? 'undo' THEN
        v_entry := public._pause_entry_merge(p_app_id, p_kind, e->>'id', jsonb_build_object(
            'undo', (e->'undo') || jsonb_build_object('after', public._pause_snapshot(p_app_id, p_kind))));
    END IF;
    RETURN public._pause_entry_merge(p_app_id, p_kind, e->>'id', '{}'::jsonb);
END;
$$;

-- ---------- 8) 시험 당일 안내(50233): 내챌 환불 제외 ----------
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
          -- [환불] 내챌 기준(S12): 가장 최근 챌린지 신청서가 환불·중도포기면 보내지 않는다. 정지 중·첨삭만 환불은 그대로 발송.
          --   applications.user_id 는 text, es.user_id 는 uuid → ::text 필수. 신청서 없는 회원은 그대로 발송.
          AND COALESCE((SELECT public.service_stop_at(a.id, 'challenge') IS NOT NULL
                          FROM applications a
                         WHERE a.user_id = es.user_id::text
                           AND a.application_type = 'challenge'
                           AND a.deleted IS NOT TRUE
                         ORDER BY a.created_at DESC NULLS LAST, a.id
                         LIMIT 1), false) IS NOT TRUE
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

-- ---------- 9) 권한: 관리창(anon 키)이 부르는 RPC 3개와 읽기 함수만 허용, 보조는 내부 전용 ----------
REVOKE EXECUTE ON FUNCTION public._stop_entry_merge(uuid, text, jsonb)                                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._service_stop_sync_compat(uuid)                                        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_entries(uuid)                                             TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_at(uuid, text)                                            TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.is_service_stopped(uuid, text, date)                                   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_set(uuid, text, text, bigint, text, date, boolean, text)  TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_withdraw(uuid, text, text)                                TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_mark_paid(uuid, text, boolean, text)                      TO anon, authenticated;

-- 적용 후 확인
SELECT p.proname, md5(p.prosrc) AS md5_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('service_stop_entries','service_stop_at','is_service_stopped','_stop_entry_merge','_service_stop_sync_compat',
                     'service_stop_set','service_stop_withdraw','service_stop_mark_paid',
                     'correction_application_id','correction_release_blocked','process_resume_notices',
                     'schedule_pause_set','schedule_pause_resume','schedule_pause_cancel','schedule_pause_undo','schedule_pause_reschedule',
                     'preview_correction_session_reminders','process_start_notices','auto_enable_practice_mode','send_practice_open_alimtalk',
                     'send_toefl_exam_day_alimtalk')
 ORDER BY 1;

COMMIT;

-- ROLLBACK(수동): BEGIN;
--   DROP FUNCTION public.service_stop_set(uuid,text,text,bigint,text,date,boolean,text), public.service_stop_withdraw(uuid,text,text),
--                 public.service_stop_mark_paid(uuid,text,boolean,text), public._service_stop_sync_compat(uuid), public._stop_entry_merge(uuid,text,jsonb),
--                 public.is_service_stopped(uuid,text,date), public.service_stop_at(uuid,text), public.service_stop_entries(uuid);
--   ALTER TABLE public.applications DROP COLUMN service_stops;
--   그리고 교체한 13개 함수는 라이브함수원문_2026-10-12\*.sql 로 다시 CREATE OR REPLACE (사전 검사 md5 와 같아져야 함).
-- COMMIT;
