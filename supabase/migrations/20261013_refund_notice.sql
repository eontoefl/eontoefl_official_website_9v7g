-- =====================================================================
-- 환불 안내 알림톡 연결 (2026-10-13)
--   service_stop_set 의 알림톡 부분만 바꾼다:
--     - 환불(refund)일 때만 보낸다. 중도포기(dropped)는 안내 템플릿이 없어(별도 작업) 보내지 않는다.
--     - target(challenge|correction|both)과 계좌 3칸(bank·account·holder)을 넘긴다. 'product'·'kind'는 뺀다.
--     - 엣지함수 kakaotalk-notify 가 target 으로 50252/50253/50254 중 하나를 고른다.
--   나머지 본문은 라이브(md5 1e047fbc20a32f4d537a22a59b1676a7)와 같다.
--   계획: C:\기능구현\환불처리\IMPLEMENTATION_PLAN.md
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션).
-- 되돌리기: 엣지배포_2026-10-13\live_fn_before.json 의 service_stop_set 정의를 다시 실행.
-- =====================================================================

BEGIN;

DO $chk$
DECLARE v text;
BEGIN
  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='service_stop_set';
  IF v IS DISTINCT FROM '1e047fbc20a32f4d537a22a59b1676a7' THEN RAISE EXCEPTION 'ABORT service_stop_set 라이브 본문이 2026-10-13 확인본과 다름: %', v; END IF;
END $chk$;

CREATE OR REPLACE FUNCTION public.service_stop_set(p_app_id uuid, p_kind text, p_target text, p_amount bigint DEFAULT 0, p_reason text DEFAULT NULL::text, p_requested_on date DEFAULT NULL::date, p_notify boolean DEFAULT true, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    a          public.applications%ROWTYPE;
    v_today    date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    v_req      date := COALESCE(p_requested_on, (now() AT TIME ZONE 'Asia/Seoul')::date);
    v_id       text := gen_random_uuid()::text;
    v_entry    jsonb;
    v_uid      uuid;
    v_product  text;
    v_canceled int := 0;
    v_bank     text;
    v_account  text;
    v_holder   text;
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

    -- 환불 안내 알림톡(등록 즉시 1회, 2026-10-13 승인 50252·50253·50254). 환불일 때만 — 중도포기 안내는 별도 작업이라 보내지 않는다.
    --   엣지함수가 target(challenge|correction|both)으로 셋 중 하나를 고른다. 소급 입력은 p_notify=false.
    --   계좌: 최근 신청서는 칸별(bank_name·account_number·account_holder), 예전 신청서는 한 칸(bank_account)을 계좌번호 줄에 통째로.
    IF p_kind = 'refund' AND COALESCE(p_notify, true) THEN
        IF COALESCE(NULLIF(btrim(a.bank_name), ''), NULLIF(btrim(a.account_number::text), ''), NULLIF(btrim(a.account_holder), '')) IS NOT NULL THEN
            v_bank    := COALESCE(NULLIF(btrim(a.bank_name), ''), '신청서에 적어주신 대로');
            v_account := COALESCE(NULLIF(btrim(a.account_number::text), ''), '신청서에 적어주신 대로');
            v_holder  := COALESCE(NULLIF(btrim(a.account_holder), ''), '신청서에 적어주신 대로');
        ELSIF NULLIF(btrim(a.bank_account), '') IS NOT NULL THEN
            v_bank    := '신청서에 적어주신 대로';
            v_account := btrim(a.bank_account);
            v_holder  := '신청서에 적어주신 대로';
        ELSE
            v_bank    := '신청서에 계좌 정보가 없어요';
            v_account := '신청서에 계좌 정보가 없어요';
            v_holder  := '신청서에 계좌 정보가 없어요';
        END IF;
        PERFORM public._pause_notify('refund_notice', jsonb_build_object(
            'name', COALESCE(a.name, ''), 'phone', a.phone, 'app_id', a.id::text,
            'target', p_target,
            'amount', to_char(COALESCE(p_amount, 0), 'FM999,999,999'),
            'requested_on', public._kr_date_label(v_req),
            'bank', v_bank, 'account', v_account, 'holder', v_holder));
        v_entry := public._stop_entry_merge(p_app_id, v_id, jsonb_build_object('notice_at', now()));
    END IF;
    RETURN v_entry;
END;
$function$;

COMMIT;
