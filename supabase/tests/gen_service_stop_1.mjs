#!/usr/bin/env node
// 환불처리 1단계 — 서버 마이그레이션 생성기 (2026-10-12)
//   계획: C:\기능구현\환불처리\IMPLEMENTATION_PLAN.md (v2 3-1절 + 7장 S1~S16, D1~D3)
//   레포에 있는 라이브 함수(일시정지 1·2·3부, 시험 당일)의 CREATE OR REPLACE 블록을 그대로 꺼내
//   환불 판정 줄만 끼워 넣고, 새 칸·새 함수(환불 기록·판정·RPC 3개)를 붙여
//   supabase/migrations/20261012_service_stop_1.sql 과 드라이런 supabase/tests/service_stop_1_dryrun.sql 을 만든다.
//   레포 본문 = 라이브 본문임은 2026-10-12 md5(prosrc)로 확인(C:\기능구현\환불처리\라이브함수원문_2026-10-12\).
//   ⚠️ 일시정지 생성기(gen_schedule_pause_guards.mjs)는 다시 돌리지 않는다(이미 적용된 파일을 덮어쓰고 사전 검사가 적용 전 값).
// 실행: node supabase/tests/gen_service_stop_1.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mig = path.join(__dirname, '..', 'migrations');

function extractFunction(file, fnName) {
  const src = fs.readFileSync(path.join(mig, file), 'utf8').replace(/\r\n/g, '\n');
  const re = new RegExp('CREATE OR REPLACE FUNCTION (?:public\\.)?' + fnName + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error(fnName + ' not found in ' + file);
  const after = src.slice(m.index);
  const tagM = /AS\s+(\$[A-Za-z_]*\$)/.exec(after);
  const tag = tagM[1];
  const bodyStart = after.indexOf(tag, tagM.index) + tag.length;
  const bodyEnd = after.indexOf(tag, bodyStart);
  const endIdx = bodyEnd + tag.length;
  return after.slice(0, endIdx) + ';';
}

function replaceOnce(text, from, to, label) {
  const i = text.indexOf(from);
  if (i < 0) throw new Error('앵커 못 찾음: ' + label);
  if (text.indexOf(from, i + 1) >= 0) throw new Error('앵커가 둘 이상: ' + label);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

const P1 = '20261006_schedule_pause_1_core.sql';
const P2 = '20261006_schedule_pause_2_guards.sql';
const P3 = '20261008_schedule_pause_3_undo_reschedule.sql';

// 2026-10-12 라이브 md5(prosrc) — 라이브함수원문_2026-10-12/live_dump_2026-10-12.json 기준
const liveMd5 = {
  schedule_pause_set:                   'af77e7a8dfcfcf5a54dac0a1c975b58b',
  schedule_pause_resume:                'e903db656b4ce56fe88112a8b8277117',
  schedule_pause_cancel:                '374c981ffed445ef527a3148c0f8c542',
  schedule_pause_undo:                  'aa8f06cf722f109c22a2aae251034da2',
  schedule_pause_reschedule:            'bfec3c55ba1d257402a6993ebffc8955',
  correction_application_id:            'd7c881eb0213fa2929516092c4db5427',
  correction_release_blocked:           '742a4e28a346c5a41dbdf3edb0c348c5',
  process_resume_notices:               'fb7a8ff85a2f2036c7e86d972a1306fe',
  preview_correction_session_reminders: 'ae989a91d94526e87b421718b3ddd47e',
  process_start_notices:                '20b43537cc72e77cf957a93fa46ab391',
  auto_enable_practice_mode:            '582aa7bb83095371796e4cb06cb217d4',
  send_practice_open_alimtalk:          '8a3cb4c50270c551df10151d2c34c753',
  send_toefl_exam_day_alimtalk:         '62197f67622269bde801096affb4eca6',
};

const REFUND_GUARD_RPC = `    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정입니다. 먼저 환불을 철회하세요.'; END IF;   -- [환불]`;

const body = [];
body.push(`-- =====================================================================
-- 환불처리 1단계 — 서버: 환불 기록 칸 + 판정(정지∪환불) + 회차 규칙 + 기존 가드 교체 + 환불 RPC 3개 (2026-10-12)
--   ⚠️ 이 파일은 supabase/tests/gen_service_stop_1.mjs 가 레포 원문에서 생성한다. 직접 고치지 말 것.
--   계획: C:\\기능구현\\환불처리\\IMPLEMENTATION_PLAN.md (3-1절, 7장 S1~S16·D1~D3)
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
`);

// ---------- 0) 사전 검사 ----------
const chk = [];
chk.push(`DO $chk$
DECLARE v text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='applications' AND column_name='service_stops') THEN
    RAISE EXCEPTION 'ABORT applications.service_stops 칸이 이미 있음 — 이미 적용된 파일';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('service_stop_set','service_stop_at','is_service_stopped')) THEN
    RAISE EXCEPTION 'ABORT 환불 함수가 이미 있음 — 이미 적용된 파일';
  END IF;`);
for (const [fn, md5] of Object.entries(liveMd5)) {
  chk.push(`  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}';
  IF v IS DISTINCT FROM '${md5}' THEN RAISE EXCEPTION 'ABORT ${fn} 라이브 본문이 2026-10-12 확인본과 다름: %', v; END IF;`);
}
chk.push(`END $chk$;
`);
body.push('-- ---------- 0) 사전 검사: 2026-10-12 라이브 본문 그대로일 때만 진행 ----------\n' + chk.join('\n'));

// ---------- 1) 칸 ----------
body.push(`-- ---------- 1) 환불 기록 칸 ----------
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS service_stops jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.applications.service_stops IS '환불·중도포기 기록(배열). 항목: kind refund|dropped, target challenge|correction|both, amount, reason, requested_on, status active|withdrawn, paid_at 등. 판정은 service_stop_at/is_service_stopped. 호환 칸(app_status·refund_*·correction_status)은 _service_stop_sync_compat 가 같이 갱신.';
`);

// ---------- 2) 읽기 함수 ----------
body.push(`-- ---------- 2) 읽기 함수: 이력 / 환불 기준시각 / 정지∪환불 판정 ----------
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
`);

// ---------- 3) 보조 ----------
body.push(`-- ---------- 3) 보조: 항목 병합 / 호환 칸 동기화 ----------
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
`);

// ---------- 4) RPC ----------
body.push(`-- ---------- 4) 환불 RPC: 등록 / 철회 / 입금 완료 ----------
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
`);

// ---------- 5) 회차 규칙: correction_application_id / correction_release_blocked ----------
let f = extractFunction(P1, 'correction_application_id');
f = replaceOnce(f,
  `       AND a.deleted IS NOT TRUE\n       AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n`,
  `       AND a.deleted IS NOT TRUE\n`,
  'correction_application_id app_status 제거');
body.push('-- ---------- 5) 학생→신청서: 환불 신청서도 고른다(회차 규칙 판정에 필요, S5) ----------\n' + f + '\n');

body.push(`-- 회차 규칙(S2): 막힘 = (정지 중 AND (1차 미제출 OR 1차 ≥ 정지 기준)) OR (환불 AND (1차 미제출 OR 1차 ≥ 환불 기준)).
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
`);

// ---------- 6) P2 가드 5곳: is_paused → is_service_stopped ----------
f = extractFunction(P2, 'preview_correction_session_reminders');
f = replaceOnce(f,
  `        IF public.is_paused(r.app_id, 'correction', v_today) THEN`,
  `        IF public.is_service_stopped(r.app_id, 'correction', v_today) THEN   -- [정지∪환불]`,
  'preview 가드');
body.push('-- ---------- 6-1) 첨삭 회차 당일 알림(50244): 정지∪환불 건너뜀 ----------\n' + f + '\n');

f = extractFunction(P2, 'process_start_notices');
f = replaceOnce(f,
  `              AND NOT public.is_paused(a.id, 'challenge', v_today)   -- [일시정지]`,
  `              AND NOT public.is_service_stopped(a.id, 'challenge', v_today)   -- [정지∪환불]`,
  'start_notices 내챌 가드');
f = replaceOnce(f,
  `                  AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n                  AND NOT public.is_paused(a.id, 'correction', v_today)   -- [일시정지]`,
  `                  AND NOT public.is_service_stopped(a.id, 'correction', v_today)   -- [정지∪환불] (app_status 조건은 첨삭 판정으로 대체, S5)`,
  'start_notices 첨삭 가드');
body.push('-- ---------- 6-2) 시작 안내(50208·50213): 정지∪환불 제외. 첨삭 쪽은 내챌 환불 표시가 아니라 첨삭 판정을 본다 ----------\n' + f + '\n');

f = extractFunction(P2, 'auto_enable_practice_mode');
f = replaceOnce(f,
  `          AND NOT public.is_paused(a.id, 'challenge', v_today)   -- [일시정지]`,
  `          AND NOT public.is_service_stopped(a.id, 'challenge', v_today)   -- [정지∪환불]`,
  'auto_enable 가드');
body.push('-- ---------- 6-3) 연습코스 자동 오픈: 정지∪환불 제외 ----------\n' + f + '\n');

f = extractFunction(P2, 'send_practice_open_alimtalk');
f = replaceOnce(f,
  `          AND NOT public.is_paused(a.id, 'challenge')   -- [일시정지]`,
  `          AND NOT public.is_service_stopped(a.id, 'challenge')   -- [정지∪환불]`,
  'send_practice 가드');
body.push('-- ---------- 6-4) 연습코스 오픈 알림톡(50231): 정지∪환불 제외 ----------\n' + f + '\n');

// ---------- 7) 재개 안내·정지 RPC: 환불만 본다 ----------
f = extractFunction(P1, 'process_resume_notices');
f = replaceOnce(f,
  `           AND e->>'resume_notice_sent_for' IS DISTINCT FROM e->>'resume_on'`,
  `           AND e->>'resume_notice_sent_for' IS DISTINCT FROM e->>'resume_on'\n           AND public.service_stop_at(a.id, k.kind) IS NULL   -- [환불] 환불된 상품의 재개 안내는 보내지 않는다`,
  'resume_notices 가드');
body.push('-- ---------- 7-1) 재개 안내(50249/50250): 환불된 상품 제외(정지 자체는 봐야 하므로 환불만) ----------\n' + f + '\n');

f = extractFunction(P3, 'schedule_pause_set');
f = replaceOnce(f,
  `    IF COALESCE(a.app_status, '') IN ('refunded', 'dropped') THEN RAISE EXCEPTION '환불·중도포기 학생은 정지할 수 없습니다.'; END IF;`,
  `    IF public.service_stop_at(p_app_id, p_kind) IS NOT NULL THEN RAISE EXCEPTION '환불·중도포기 처리된 과정은 정지할 수 없습니다.'; END IF;   -- [환불] 상품별(S5·S6)`,
  'pause_set 환불 검사');
body.push('-- ---------- 7-2) 정지 등록: 환불 검사를 상품별로(내챌만 환불한 학생의 첨삭 정지는 허용, 첨삭만 환불한 학생의 첨삭 정지는 금지) ----------\n' + f + '\n');

f = extractFunction(P1, 'schedule_pause_resume');
f = replaceOnce(f, `    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;`,
  `    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;\n` + REFUND_GUARD_RPC, 'pause_resume 환불 검사');
body.push('-- ---------- 7-3) 정지 재개: 환불된 상품은 거절 ----------\n' + f + '\n');

f = extractFunction(P1, 'schedule_pause_cancel');
f = replaceOnce(f, `    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;`,
  `    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;\n` + REFUND_GUARD_RPC, 'pause_cancel 환불 검사');
body.push('-- ---------- 7-4) 예약 정지 취소: 환불된 상품은 거절 ----------\n' + f + '\n');

f = extractFunction(P3, 'schedule_pause_undo');
f = replaceOnce(f, `    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;`,
  `    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;\n` + REFUND_GUARD_RPC, 'pause_undo 환불 검사');
body.push('-- ---------- 7-5) 정지 되돌리기: 환불된 상품은 거절 ----------\n' + f + '\n');

f = extractFunction(P3, 'schedule_pause_reschedule');
f = replaceOnce(f, `    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;`,
  `    PERFORM 1 FROM public.applications WHERE id = p_app_id FOR UPDATE;\n` + REFUND_GUARD_RPC, 'pause_reschedule 환불 검사');
body.push('-- ---------- 7-6) 정지 기간 수정: 환불된 상품은 거절 ----------\n' + f + '\n');

// ---------- 8) 시험 당일(50233): 내챌 기준, 최신 챌린지 신청서가 환불이면 제외 ----------
f = extractFunction('toefl_exam_schedules.sql', 'send_toefl_exam_day_alimtalk');
f = replaceOnce(f,
  `          AND es.exam_datetime > now() - interval '24 hours'`,
  `          AND es.exam_datetime > now() - interval '24 hours'
          -- [환불] 내챌 기준(S12): 가장 최근 챌린지 신청서가 환불·중도포기면 보내지 않는다. 정지 중·첨삭만 환불은 그대로 발송.
          --   applications.user_id 는 text, es.user_id 는 uuid → ::text 필수. 신청서 없는 회원은 그대로 발송.
          AND COALESCE((SELECT public.service_stop_at(a.id, 'challenge') IS NOT NULL
                          FROM applications a
                         WHERE a.user_id = es.user_id::text
                           AND a.application_type = 'challenge'
                           AND a.deleted IS NOT TRUE
                         ORDER BY a.created_at DESC NULLS LAST, a.id
                         LIMIT 1), false) IS NOT TRUE`,
  'toefl 환불 가드');
body.push('-- ---------- 8) 시험 당일 안내(50233): 내챌 환불 제외 ----------\n' + f + '\n');

// ---------- 9) 권한 ----------
body.push(`-- ---------- 9) 권한: 관리창(anon 키)이 부르는 RPC 3개와 읽기 함수만 허용, 보조는 내부 전용 ----------
REVOKE EXECUTE ON FUNCTION public._stop_entry_merge(uuid, text, jsonb)                                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._service_stop_sync_compat(uuid)                                        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_entries(uuid)                                             TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_at(uuid, text)                                            TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.is_service_stopped(uuid, text, date)                                   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_set(uuid, text, text, bigint, text, date, boolean, text)  TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_withdraw(uuid, text, text)                                TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.service_stop_mark_paid(uuid, text, boolean, text)                      TO anon, authenticated;
`);

const verifySql = `SELECT p.proname, md5(p.prosrc) AS md5_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('service_stop_entries','service_stop_at','is_service_stopped','_stop_entry_merge','_service_stop_sync_compat',
                     'service_stop_set','service_stop_withdraw','service_stop_mark_paid',
                     'correction_application_id','correction_release_blocked','process_resume_notices',
                     'schedule_pause_set','schedule_pause_resume','schedule_pause_cancel','schedule_pause_undo','schedule_pause_reschedule',
                     'preview_correction_session_reminders','process_start_notices','auto_enable_practice_mode','send_practice_open_alimtalk',
                     'send_toefl_exam_day_alimtalk')
 ORDER BY 1;`;

// ===== 마이그레이션 파일 =====
const migration = body.join('\n') + `
-- 적용 후 확인
${verifySql}

COMMIT;

-- ROLLBACK(수동): BEGIN;
--   DROP FUNCTION public.service_stop_set(uuid,text,text,bigint,text,date,boolean,text), public.service_stop_withdraw(uuid,text,text),
--                 public.service_stop_mark_paid(uuid,text,boolean,text), public._service_stop_sync_compat(uuid), public._stop_entry_merge(uuid,text,jsonb),
--                 public.is_service_stopped(uuid,text,date), public.service_stop_at(uuid,text), public.service_stop_entries(uuid);
--   ALTER TABLE public.applications DROP COLUMN service_stops;
--   그리고 교체한 13개 함수는 라이브함수원문_2026-10-12\\*.sql 로 다시 CREATE OR REPLACE (사전 검사 md5 와 같아져야 함).
-- COMMIT;
`;
// BEGIN 은 헤더 뒤, 사전 검사 앞에
const migrationText = migration.replace('-- ---------- 0) 사전 검사', 'BEGIN;\n\n-- ---------- 0) 사전 검사');
const target = path.join(mig, '20261012_service_stop_1.sql');
fs.writeFileSync(target, migrationText, 'utf8');
console.log('generated', target, fs.statSync(target).size, 'bytes');

// ===== 드라이런 파일: 마이그레이션 본문 + 시나리오 + 마지막 RAISE EXCEPTION 으로 결과 출력·전체 롤백 =====
const dryrun = fs.readFileSync(path.join(__dirname, 'service_stop_1_dryrun.scenario.sql'), 'utf8').replace(/\r\n/g, '\n');
const dryText = `-- 환불처리 1단계 드라이런 (생성: gen_service_stop_1.mjs). SQL Editor 에서 전체 실행 → 마지막 DO 블록이 결과를 예외로 출력하고 전체 롤백된다. 라이브에 남는 것 0.
` + migrationText.replace(/\nCOMMIT;\n[\s\S]*$/, '\n') + '\n' + dryrun;
const dryTarget = path.join(__dirname, 'service_stop_1_dryrun.sql');
fs.writeFileSync(dryTarget, dryText, 'utf8');
console.log('generated', dryTarget, fs.statSync(dryTarget).size, 'bytes');
