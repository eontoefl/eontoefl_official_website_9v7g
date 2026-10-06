-- =====================================================================
-- 일시정지 2단계 — 1부: 정지 이력 칸 + 판정·보정·정지/재개 함수 (2026-10-06)
--   계획: C:\기능구현\일시정지\IMPLEMENTATION_PLAN.md (v2 4장, R1~R7, D1~D20, V1~V19)
--
-- 이 파일은 **동작을 바꾸지 않는다**: 칸 2개를 비어 있는 배열로 추가하고 새 함수만 만든다.
-- 기존 자동작업(회차 알림·시작 안내·자동 공개·연습코스)에 정지 가드를 넣는 것은 2부(…_2_guards.sql).
--
-- 설계 요점
--   - applications.challenge_pauses / correction_pauses (jsonb 배열). 항목:
--       { id, paused_from 'YYYY-MM-DD', resume_on 'YYYY-MM-DD'|null, shift_days int|null,
--         status 'open'|'resumed'|'canceled', created_at, created_by, note,
--         resumed_at, resumed_by, canceled_at, pause_notice_at, resume_notice_sent_for, reverted_rows, deleted_reminders }
--   - 정지 중 = status='open' AND 오늘 ≥ paused_from AND (resume_on IS NULL OR 오늘 < resume_on)
--   - 날짜 보정(pause_adjusted_date) = "시작일+오프셋"으로 계산한 날짜에만 적용. 저장된 날짜(내챌 종료일,
--     자기주도 종료일·확정표, 자기주도 첨삭 종료일·회차표, 과제 연장 기록, 연장 신청 마감)는 재개일이 확정되는
--     순간 한 번 밀고(schedule_pause_apply_shift) 다시 보정하지 않는다.
--   - 일반 첨삭 종료일(correction_end_date)은 쓰지 않는다 — 값이 들어가면 자기주도로 오판된다(V4).
--   - 재개일 = 정지 시작일 + 7×N (같은 요일, V1). 소급 정지는 최근 일요일까지(R6).
--   - "오늘"은 KST 날짜(V14).
--
-- 실행: Supabase SQL Editor에서 파일 전체 실행(한 트랜잭션). "Run without RLS".
-- 되돌리기: 아래 ROLLBACK 주석 참고(함수 DROP + 칸 DROP).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) 사전 검사: 같은 이름의 함수·칸이 아직 없어야 한다(이중 적용 방지)
-- ---------------------------------------------------------------------
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='applications' AND column_name='challenge_pauses') THEN
    RAISE EXCEPTION 'ABORT applications.challenge_pauses 칸이 이미 있음 — 이미 적용된 파일';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('is_paused','pause_adjusted_date','schedule_pause_set')) THEN
    RAISE EXCEPTION 'ABORT 정지 함수가 이미 있음 — 이미 적용된 파일';
  END IF;
END $chk$;

-- ---------------------------------------------------------------------
-- 1) 칸 2개
-- ---------------------------------------------------------------------
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS challenge_pauses  jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS correction_pauses jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.applications.challenge_pauses  IS '내챌 일시정지 이력(배열). 항목: paused_from, resume_on(무기한 null), shift_days(7의 배수), status open|resumed|canceled 등. 정지 중 판정·날짜 보정은 is_paused/pause_adjusted_date.';
COMMENT ON COLUMN public.applications.correction_pauses IS '첨삭 일시정지 이력(배열). 구조는 challenge_pauses와 동일.';

-- ---------------------------------------------------------------------
-- 2) 읽기 함수: 이력 꺼내기 / 정지 중 판정 / 날짜 보정 / 학생→신청서
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_pause_entries(p_app_id uuid, p_kind text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(CASE WHEN p_kind = 'challenge' THEN a.challenge_pauses ELSE a.correction_pauses END, '[]'::jsonb)
      FROM public.applications a
     WHERE a.id = p_app_id
$$;

-- 정지 중인가 (p_at 기준. 기본 = KST 오늘)
CREATE OR REPLACE FUNCTION public.is_paused(
    p_app_id uuid,
    p_kind   text,
    p_at     date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) e
         WHERE e->>'status' = 'open'
           AND p_at >= (e->>'paused_from')::date
           AND (NULLIF(e->>'resume_on', '') IS NULL OR p_at < (e->>'resume_on')::date)
    )
$$;

-- "시작일+오프셋"으로 계산한 날짜에 정지 기간을 더한다. 무기한 정지 구간에 걸리면 NULL(미정).
CREATE OR REPLACE FUNCTION public.pause_adjusted_date(p_app_id uuid, p_kind text, p_nominal date)
RETURNS date
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v date := p_nominal;
    e jsonb;
BEGIN
    IF p_nominal IS NULL OR p_app_id IS NULL THEN RETURN p_nominal; END IF;
    FOR e IN
        SELECT x FROM jsonb_array_elements(public.schedule_pause_entries(p_app_id, p_kind)) x
         WHERE x->>'status' <> 'canceled'
         ORDER BY (x->>'paused_from')::date
    LOOP
        IF v >= (e->>'paused_from')::date THEN
            IF NULLIF(e->>'shift_days', '') IS NULL THEN
                RETURN NULL;                       -- 무기한 정지 진행 중 → 날짜 미정
            END IF;
            v := v + (e->>'shift_days')::int;
        END IF;
    END LOOP;
    RETURN v;
END;
$$;

-- 첨삭 자동작업(제출 테이블은 학생 uuid 기준)에서 쓰는 "학생 → 첨삭 신청서" 선택.
-- 규칙은 process_start_notices의 첨삭 LATERAL과 같다.
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
       AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')
     ORDER BY a.created_at DESC NULLS LAST, a.id
     LIMIT 1
$$;

-- R3·V6: 첨삭 정지 중에도 "정지 전에 1차를 낸 회차"는 끝까지 진행한다.
--   막힘 = 지금 첨삭 정지 중 AND (1차 미제출 OR 1차 제출 시각 ≥ 기준시각)
--   기준시각 = 정지 시작일 00:00 KST 와 정지 등록 시각 중 늦은 쪽(소급 정지 때 그 사이 실제 제출한 회차는 진행)
CREATE OR REPLACE FUNCTION public.correction_release_blocked(p_user_id uuid, p_draft1_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_app   uuid;
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    e       jsonb;
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
    IF e IS NULL THEN RETURN false; END IF;
    v_cut := GREATEST(
        ((e->>'paused_from')::date)::timestamp AT TIME ZONE 'Asia/Seoul',
        COALESCE((e->>'created_at')::timestamptz, '-infinity'::timestamptz));
    RETURN p_draft1_at IS NULL OR p_draft1_at >= v_cut;
END;
$$;

-- 첨삭 회차의 "이름값" 날짜(보정 전). preview_correction_session_reminders와 같은 규칙:
--   일반 트랙 + 종료일 지정(자기주도) → 회차표(session_dates), 그 외 → 시작일 + 오프셋. 13~24는 연장 기준.
CREATE OR REPLACE FUNCTION public.correction_session_nominal_date(p_user_id uuid, p_session int)
RETURNS date
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    c_offset CONSTANT int[] := ARRAY[0,2,4,7,9,11,14,16,18,21,23,25];
    cs      record;
    v_track text;
    v_dates date[];
    v_idx   int;
BEGIN
    SELECT * INTO cs FROM public.correction_schedules s WHERE s.user_id = p_user_id LIMIT 1;
    IF cs IS NULL OR p_session IS NULL OR p_session < 1 OR p_session > 24 THEN RETURN NULL; END IF;
    SELECT CASE WHEN COALESCE(a.assigned_program, a.preferred_program, '') LIKE '%Australia%' THEN 'aus' ELSE 'general' END
      INTO v_track
      FROM public.applications a WHERE a.id = public.correction_application_id(p_user_id);
    v_track := COALESCE(v_track, 'general');

    IF p_session <= 12 THEN
        v_idx := p_session;
        IF v_track = 'general' AND cs.end_date IS NOT NULL THEN
            BEGIN
                SELECT array_agg(d.v::date ORDER BY d.ord) INTO v_dates
                  FROM jsonb_array_elements_text((cs.session_dates)::jsonb -> 'dates') WITH ORDINALITY AS d(v, ord);
            EXCEPTION WHEN others THEN v_dates := NULL; END;
            IF COALESCE(array_length(v_dates, 1), 0) = 12 THEN RETURN v_dates[v_idx]; END IF;
            RETURN NULL;
        END IF;
        RETURN cs.start_date + c_offset[v_idx];
    END IF;

    IF v_track <> 'general' OR NOT COALESCE(cs.extension_enabled, false) THEN RETURN NULL; END IF;
    v_idx := p_session - 12;
    IF cs.extension_end_date IS NOT NULL THEN
        BEGIN
            SELECT array_agg(d.v::date ORDER BY d.ord) INTO v_dates
              FROM jsonb_array_elements_text((cs.extension_session_dates)::jsonb -> 'dates') WITH ORDINALITY AS d(v, ord);
        EXCEPTION WHEN others THEN v_dates := NULL; END;
        IF COALESCE(array_length(v_dates, 1), 0) = 12 THEN RETURN v_dates[v_idx]; END IF;
        RETURN NULL;
    END IF;
    IF cs.extension_start_date IS NULL THEN RETURN NULL; END IF;
    RETURN cs.extension_start_date + c_offset[v_idx];
END;
$$;

-- ---------------------------------------------------------------------
-- 3) 날짜 밀기 (저장된 날짜만, paused_from 이후 것만, 한 트랜잭션)
--    p_days > 0 = 재개일 확정, p_days < 0 = 예약 취소 되돌리기
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ymd_shift_text(p_ymd text, p_from date, p_days int)
RETURNS text
LANGUAGE sql STABLE
AS $$
    SELECT CASE
             WHEN p_ymd ~ '^\d{4}-\d{2}-\d{2}$' AND p_ymd::date >= p_from
             THEN to_char(p_ymd::date + p_days, 'YYYY-MM-DD')
             ELSE p_ymd
           END
$$;

-- JSON {start,end,dates:[...]} 형태의 확정표에서 p_from 이후 날짜와 end를 밀어 같은 형태로 돌려준다.
CREATE OR REPLACE FUNCTION public._schedule_json_shift(p_raw text, p_from date, p_days int)
RETURNS text
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    j     jsonb;
    arr   jsonb := '[]'::jsonb;
    x     text;
BEGIN
    IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN p_raw; END IF;
    BEGIN
        j := p_raw::jsonb;
    EXCEPTION WHEN others THEN
        RETURN p_raw;                                  -- 깨진 JSON은 건드리지 않음
    END;
    IF jsonb_typeof(j->'dates') <> 'array' THEN RETURN p_raw; END IF;
    FOR x IN SELECT jsonb_array_elements_text(j->'dates') LOOP
        arr := arr || to_jsonb(public._ymd_shift_text(x, p_from, p_days));
    END LOOP;
    j := jsonb_set(j, '{dates}', arr);
    IF j ? 'end' THEN
        j := jsonb_set(j, '{end}', to_jsonb(public._ymd_shift_text(j->>'end', p_from, p_days)));
    END IF;
    RETURN j::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_pause_apply_shift(p_app_id uuid, p_kind text, p_from date, p_days int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    a      public.applications%ROWTYPE;
    v_uid  uuid;
BEGIN
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서 없음: %', p_app_id; END IF;
    IF a.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_uid := a.user_id::uuid;
    END IF;

    IF p_kind = 'challenge' THEN
        -- ⚠️ schedule_start 는 절대 건드리지 않는다(시작 안내 재발송·트리거 연쇄). 종료일·자기주도 종료일·확정표만.
        UPDATE public.applications
           SET schedule_end        = public._ymd_shift_text(schedule_end, p_from, p_days),
               self_paced_end_date = CASE WHEN self_paced_end_date IS NOT NULL AND self_paced_end_date >= p_from
                                          THEN self_paced_end_date + p_days ELSE self_paced_end_date END,
               self_paced_schedule = public._schedule_json_shift(self_paced_schedule, p_from, p_days)
         WHERE id = p_app_id;
        -- 과제별 마감 연장 기록은 달력 날짜가 키라서 같이 민다.
        UPDATE public.tr_deadline_extensions t
           SET original_date = public._ymd_shift_text(t.original_date, p_from, p_days)
         WHERE t.user_id = a.user_id
           AND t.original_date ~ '^\d{4}-\d{2}-\d{2}$'
           AND t.original_date::date >= p_from;

    ELSIF p_kind = 'correction' THEN
        -- 자기주도 첨삭(종료일 지정형)만 종료일 칸을 민다. 일반 첨삭은 종료일 칸이 비어 있어야 한다(V4).
        -- correction_start_date 는 건드리지 않는다. 종료일·연장 시작/종료 변경은 트리거가 correction_schedules로 복사한다.
        UPDATE public.applications
           SET correction_end_date  = CASE WHEN correction_end_date  IS NOT NULL AND correction_end_date  >= p_from
                                           THEN correction_end_date  + p_days ELSE correction_end_date END,
               extension_start_date = CASE WHEN extension_start_date IS NOT NULL AND extension_start_date >= p_from
                                           THEN extension_start_date + p_days ELSE extension_start_date END,
               extension_end_date   = CASE WHEN extension_end_date   IS NOT NULL AND extension_end_date   >= p_from
                                           THEN extension_end_date   + p_days ELSE extension_end_date END
         WHERE id = p_app_id;
        IF v_uid IS NOT NULL THEN
            -- 회차표(자기주도·연장 자기주도)의 날짜만 민다. 트리거는 회차표를 건드리지 않으므로 여기서 직접.
            UPDATE public.correction_schedules cs
               SET session_dates           = public._schedule_json_shift(cs.session_dates, p_from, p_days),
                   extension_session_dates = public._schedule_json_shift(cs.extension_session_dates, p_from, p_days)
             WHERE cs.user_id = v_uid;
            -- 연장 신청 마감(토요일)도 같이.
            UPDATE public.correction_extension_requests r
               SET deadline_date = r.deadline_date + p_days
             WHERE r.user_id = v_uid
               AND r.status = 'pending'
               AND r.deadline_date IS NOT NULL
               AND r.deadline_date >= p_from;
        END IF;
    ELSE
        RAISE EXCEPTION '알 수 없는 종류: %', p_kind;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) 이력 항목 갱신 보조 (id로 찾은 항목에 jsonb 병합)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pause_entry_merge(p_app_id uuid, p_kind text, p_entry_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_arr jsonb;
    v_new jsonb := '[]'::jsonb;
    e     jsonb;
    v_hit jsonb;
BEGIN
    v_arr := public.schedule_pause_entries(p_app_id, p_kind);
    FOR e IN SELECT x FROM jsonb_array_elements(v_arr) x LOOP
        IF e->>'id' = p_entry_id THEN
            e := e || p_patch;
            v_hit := e;
        END IF;
        v_new := v_new || e;
    END LOOP;
    IF v_hit IS NULL THEN RAISE EXCEPTION '정지 항목 없음: %', p_entry_id; END IF;
    IF p_kind = 'challenge' THEN
        UPDATE public.applications SET challenge_pauses = v_new WHERE id = p_app_id;
    ELSE
        UPDATE public.applications SET correction_pauses = v_new WHERE id = p_app_id;
    END IF;
    RETURN v_hit;
END;
$$;

-- 알림톡 호출 보조 (엣지함수 kakaotalk-notify). 템플릿 번호가 아직 0이면 엣지함수가 400으로 거절한다 — 발송 없음.
CREATE OR REPLACE FUNCTION public._pause_notify(p_type text, p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_url text := get_supabase_url();
    v_key text := get_service_role_key();
BEGIN
    IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;
    IF COALESCE(p_data->>'phone', '') = '' THEN RETURN; END IF;
    PERFORM net.http_post(
        url := v_url || '/functions/v1/kakaotalk-notify',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('type', p_type, 'data', p_data));
END;
$$;

-- 'M월 D일(요일)' 표기
CREATE OR REPLACE FUNCTION public._kr_date_label(p_d date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE WHEN p_d IS NULL THEN '추후 안내'
           ELSE extract(month FROM p_d)::int || '월 ' || extract(day FROM p_d)::int || '일('
                || (ARRAY['일','월','화','수','목','금','토'])[extract(dow FROM p_d)::int + 1] || ')' END
$$;

-- ---------------------------------------------------------------------
-- 5) 정지 등록 (관리자 화면 RPC)
--    p_kind 'challenge'|'correction', p_paused_from(아무 날, 소급은 최근 일요일까지), p_resume_on(null=무기한)
-- ---------------------------------------------------------------------
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
BEGIN
    IF p_kind NOT IN ('challenge', 'correction') THEN RAISE EXCEPTION '종류는 challenge 또는 correction'; END IF;
    SELECT * INTO a FROM public.applications WHERE id = p_app_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION '신청서를 찾을 수 없습니다.'; END IF;
    IF a.deposit_confirmed_by_admin IS NOT TRUE OR a.deleted IS TRUE THEN RAISE EXCEPTION '입금 확인된 신청서만 정지할 수 있습니다.'; END IF;
    IF COALESCE(a.app_status, '') IN ('refunded', 'dropped') THEN RAISE EXCEPTION '환불·중도포기 학생은 정지할 수 없습니다.'; END IF;
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

    -- R6: 소급 구간에서 미제출로 0%/실전만으로 50% 굳은 과제를 미확정으로 되돌린다(내챌). 정당한 점수(보카·100)는 제외.
    IF p_kind = 'challenge' AND p_paused_from <= v_today AND a.self_paced IS NOT TRUE THEN
        UPDATE public.study_results_v3 r
           SET locked_auth_rate = NULL
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
        GET DIAGNOSTICS v_reverted = ROW_COUNT;
    END IF;

    -- Q2: 소급 구간에 이미 나간 회차 알림 기록(1차 미제출 회차)을 지워 재개 후 새 날짜에 다시 안내되게 한다.
    IF p_kind = 'correction' AND p_paused_from <= v_today AND v_uid IS NOT NULL THEN
        DELETE FROM public.correction_session_reminders cr
         WHERE cr.user_id = v_uid
           AND COALESCE(public.correction_session_nominal_date(v_uid, cr.session_number), '1900-01-01') >= p_paused_from
           AND NOT EXISTS (SELECT 1 FROM public.correction_submissions s
                            WHERE s.user_id = v_uid AND s.session_number = cr.session_number
                              AND s.draft_1_submitted_at IS NOT NULL);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
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

-- ---------------------------------------------------------------------
-- 6) 재개 (무기한 정지에 재개일 지정) — 재개일 = 정지 시작일 + 7×N, 오늘 이후(오늘 포함)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 7) 예약 정지 취소 (정지 시작 전만). 밀어 둔 날짜가 있으면 되돌린다.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 8) 매일 정리: 재개일이 지난 항목을 resumed 로 표시 (판정 자체는 날짜로 하므로 실패해도 동작은 맞다)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_schedule_pauses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
    r       record;
    v_n     int := 0;
BEGIN
    FOR r IN
        SELECT a.id AS app_id, k.kind, e->>'id' AS entry_id
          FROM public.applications a
          CROSS JOIN LATERAL (VALUES ('challenge', a.challenge_pauses), ('correction', a.correction_pauses)) AS k(kind, arr)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(k.arr, '[]'::jsonb)) e
         WHERE e->>'status' = 'open'
           AND NULLIF(e->>'resume_on', '') IS NOT NULL
           AND (e->>'resume_on')::date <= v_today
    LOOP
        PERFORM public._pause_entry_merge(r.app_id, r.kind, r.entry_id,
                    jsonb_build_object('status', 'resumed', 'resumed_at', now()));
        v_n := v_n + 1;
    END LOOP;
    PERFORM public.process_resume_notices(NULL);
    RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------
-- 9) 재개 안내 (R7): 재개일이 오늘·내일이고 전날 10시가 지났으며 그 재개일로 아직 안 보냈으면 발송
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 10) 권한: 관리자 화면(anon 키)이 부르는 RPC 3개만 허용, 나머지는 내부 전용
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.schedule_pause_apply_shift(uuid, text, date, int)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pause_entry_merge(uuid, text, text, jsonb)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pause_notify(text, jsonb)                               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_schedule_pauses()                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_resume_notices(uuid)                             FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_set(uuid, text, date, date, text, text)   TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_resume(uuid, text, date, text)            TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.schedule_pause_cancel(uuid, text, text)                  TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.is_paused(uuid, text, date)                              TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.pause_adjusted_date(uuid, text, date)                    TO anon, authenticated;

-- 적용 후 확인
SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('schedule_pause_entries','is_paused','pause_adjusted_date','correction_application_id','correction_release_blocked',
                     'correction_session_nominal_date','schedule_pause_apply_shift','schedule_pause_set','schedule_pause_resume',
                     'schedule_pause_cancel','process_schedule_pauses','process_resume_notices')
 ORDER BY 1;

COMMIT;

-- ROLLBACK(수동): BEGIN; DROP FUNCTION 위 12개 + _ymd_shift_text, _schedule_json_shift, _pause_entry_merge, _pause_notify, _kr_date_label;
--   ALTER TABLE applications DROP COLUMN challenge_pauses, DROP COLUMN correction_pauses; COMMIT;
