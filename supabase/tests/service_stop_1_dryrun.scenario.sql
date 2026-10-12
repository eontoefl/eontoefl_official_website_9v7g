-- ===== 드라이런 시나리오 (gen_service_stop_1.mjs 가 마이그레이션 본문 뒤에 붙인다) =====
-- 같은 트랜잭션 안에서 test@me.com 신청서로 환불 등록·철회·둘 다 중도포기를 돌려 보고,
-- 마지막에 RAISE EXCEPTION 으로 결과를 출력하면서 전체를 롤백한다(알림톡 요청 큐도 함께 롤백).
DO $run$
DECLARE
    v_log  text := E'\n===== 환불처리 1단계 드라이런 결과 =====\n';
    t_app  uuid := '1e33d04e-c617-4564-8e5b-6469337bc65e';   -- test@me.com 홍길동 (내챌 9/13~10/10, 첨삭 9/13~)
    t_uid  uuid;
    k_app  uuid := 'd4c30764-f6ae-4c7a-8c53-f381e2e0c828';   -- 김시영 (옛 방식 app_status=refunded, service_stops 없음)
    b_app  uuid;                                             -- test@me.com 의 입금 미확인 신청서(있으면)
    v_at   timestamptz := '2026-10-06 01:30+00';             -- 10/6 10:30 KST = test@me 11회차(9/13+23) 배정일
    e      jsonb;
    e2     jsonb;
    n0 int; n1 int; n2 int; n3 int;
    b1 boolean; b2 boolean; b3 boolean;
    s1 text; s2 text;
    v_err text;
BEGIN
    SELECT user_id::uuid INTO t_uid FROM public.applications WHERE id = t_app;
    IF t_uid IS NULL THEN RAISE EXCEPTION 'test@me 신청서 없음'; END IF;

    -- 0) 기준: 발송 기록을 비워(롤백됨) 10/6 회차 알림 대상에 test@me 가 잡히게 한 뒤 전체 스냅샷
    DELETE FROM public.correction_session_reminders WHERE user_id = t_uid;
    CREATE TEMP TABLE _before ON COMMIT DROP AS
        SELECT user_id, session_number FROM public.preview_correction_session_reminders(v_at);
    SELECT count(*) INTO n0 FROM _before WHERE user_id = t_uid;
    SELECT count(*) INTO n1 FROM _before;
    v_log := v_log || format('[0] 환불 전 10/6 회차 알림 대상: 전체 %s행, test@me %s행 (test@me 1 기대. 11회차 1차를 이미 냈으면 0)', n1, n0) || E'\n';

    -- 1) 첨삭만 환불 (알림톡 끔)
    e := public.service_stop_set(t_app, 'refund', 'correction', 200000, '드라이런', current_date, false, 'dryrun');
    v_log := v_log || format('[1] 첨삭만 환불 등록: id=%s status=%s target=%s requested_on=%s', e->>'id', e->>'status', e->>'target', e->>'requested_on') || E'\n';
    SELECT app_status, correction_status INTO s1, s2 FROM public.applications WHERE id = t_app;
    v_log := v_log || format('    호환 칸: app_status=%s (NULL 기대) correction_status=%s (refunded 기대)', COALESCE(s1,'NULL'), COALESCE(s2,'NULL')) || E'\n';
    b1 := public.is_service_stopped(t_app, 'challenge'); b2 := public.is_service_stopped(t_app, 'correction');
    v_log := v_log || format('    판정: 내챌 멈춤=%s (false 기대) 첨삭 멈춤=%s (true 기대)', b1, b2) || E'\n';
    SELECT count(*) INTO n2 FROM public.preview_correction_session_reminders(v_at) WHERE user_id = t_uid;
    v_log := v_log || format('    10/6 회차 알림 대상 test@me: %s행 (0 기대)', n2) || E'\n';
    b1 := public.correction_release_blocked(t_uid, now() - interval '2 days');
    b2 := public.correction_release_blocked(t_uid, now());
    b3 := public.correction_release_blocked(t_uid, NULL);
    v_log := v_log || format('    회차 규칙: 요청일 전 1차 제출→막힘=%s (false 기대) / 요청일 후 제출→%s (true 기대) / 미제출→%s (true 기대)', b1, b2, b3) || E'\n';
    -- 다른 학생 불변
    SELECT count(*) INTO n2 FROM (
        SELECT user_id, session_number FROM _before WHERE user_id <> t_uid
        EXCEPT SELECT user_id, session_number FROM public.preview_correction_session_reminders(v_at) WHERE user_id <> t_uid) x;
    SELECT count(*) INTO n3 FROM (
        SELECT user_id, session_number FROM public.preview_correction_session_reminders(v_at) WHERE user_id <> t_uid
        EXCEPT SELECT user_id, session_number FROM _before WHERE user_id <> t_uid) x;
    v_log := v_log || format('    다른 학생 회차 알림 대상 변화: 사라짐 %s, 새로 생김 %s (둘 다 0 기대)', n2, n3) || E'\n';
    -- 첨삭 정지 등록 → 거절 기대
    BEGIN
        PERFORM public.schedule_pause_set(t_app, 'correction', current_date, NULL, '드라이런', 'dryrun');
        v_log := v_log || '    첨삭 정지 등록: 통과됨 (거절 기대 — 문제!)' || E'\n';
    EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || '    첨삭 정지 등록 거절: ' || v_err || E'\n';
    END;
    -- 같은 상품 중복 등록 → 거절 기대
    BEGIN
        PERFORM public.service_stop_set(t_app, 'refund', 'both', 0, '중복', current_date, false, 'dryrun');
        v_log := v_log || '    중복 등록(both): 통과됨 (거절 기대 — 문제!)' || E'\n';
    EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || '    중복 등록(both) 거절: ' || v_err || E'\n';
    END;
    -- 내챌만 환불은 가능해야(첨삭 환불 상태에서 내챌 추가) → 통과 기대, 바로 철회
    BEGIN
        e2 := public.service_stop_set(t_app, 'refund', 'challenge', 0, '내챌 추가', current_date, false, 'dryrun');
        SELECT app_status, correction_status INTO s1, s2 FROM public.applications WHERE id = t_app;
        v_log := v_log || format('    내챌 추가 환불 통과: app_status=%s (refunded 기대) correction_status=%s (refunded 기대)', COALESCE(s1,'NULL'), COALESCE(s2,'NULL')) || E'\n';
        PERFORM public.service_stop_withdraw(t_app, e2->>'id', 'dryrun');
    EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || '    내챌 추가 환불 거절(문제!): ' || v_err || E'\n';
    END;
    -- 입금 체크
    e2 := public.service_stop_mark_paid(t_app, e->>'id', true, 'dryrun');
    v_log := v_log || format('    입금 체크: paid_at=%s (값 기대)', COALESCE(e2->>'paid_at','NULL')) || E'\n';
    e2 := public.service_stop_mark_paid(t_app, e->>'id', false, 'dryrun');
    v_log := v_log || format('    입금 체크 해제: paid_at=%s (NULL 기대)', COALESCE(e2->>'paid_at','NULL')) || E'\n';

    -- 2) 철회
    e2 := public.service_stop_withdraw(t_app, e->>'id', 'dryrun');
    SELECT app_status, correction_status INTO s1, s2 FROM public.applications WHERE id = t_app;
    SELECT count(*) INTO n2 FROM public.preview_correction_session_reminders(v_at) WHERE user_id = t_uid;
    b1 := public.correction_release_blocked(t_uid, now());
    v_log := v_log || format('[2] 철회: status=%s (withdrawn 기대) app_status=%s correction_status=%s (둘 다 NULL 기대) 회차 알림 대상 %s행 (%s 기대) 회차 막힘=%s (false 기대)',
                             e2->>'status', COALESCE(s1,'NULL'), COALESCE(s2,'NULL'), n2, n0, b1) || E'\n';
    BEGIN
        PERFORM public.service_stop_withdraw(t_app, e->>'id', 'dryrun');
        v_log := v_log || '    이중 철회: 통과됨 (거절 기대 — 문제!)' || E'\n';
    EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || '    이중 철회 거절: ' || v_err || E'\n';
    END;

    -- 3) 둘 다 중도포기 (알림톡 켬 — 요청 큐는 롤백됨)
    e := public.service_stop_set(t_app, 'dropped', 'both', 0, '드라이런', current_date - 3, true, 'dryrun');
    SELECT app_status, correction_status INTO s1, s2 FROM public.applications WHERE id = t_app;
    b1 := public.is_service_stopped(t_app, 'challenge'); b2 := public.is_service_stopped(t_app, 'correction');
    v_log := v_log || format('[3] 둘 다 중도포기(요청일 3일 전): app_status=%s correction_status=%s (둘 다 dropped 기대) 내챌 멈춤=%s 첨삭 멈춤=%s (둘 다 true) notice_at=%s (값 기대)',
                             COALESCE(s1,'NULL'), COALESCE(s2,'NULL'), b1, b2, COALESCE(e->>'notice_at','NULL')) || E'\n';
    v_log := v_log || format('    환불 기준시각(첨삭)=%s (3일 전 00:00 KST 기대)', public.service_stop_at(t_app, 'correction')) || E'\n';
    b1 := public.correction_release_blocked(t_uid, now() - interval '4 days');
    b2 := public.correction_release_blocked(t_uid, now() - interval '2 days');
    v_log := v_log || format('    회차 규칙: 4일 전 제출→막힘=%s (false) / 2일 전 제출→%s (true)', b1, b2) || E'\n';
    -- 시험 당일 가드 식(최신 챌린지 신청서 기준)
    SELECT COALESCE((SELECT public.service_stop_at(a.id, 'challenge') IS NOT NULL FROM public.applications a
                      WHERE a.user_id = t_uid::text AND a.application_type = 'challenge' AND a.deleted IS NOT TRUE
                      ORDER BY a.created_at DESC NULLS LAST, a.id LIMIT 1), false) INTO b1;
    v_log := v_log || format('    시험 당일 제외 판정=%s (true 기대)', b1) || E'\n';
    -- 정지 RPC 거절
    BEGIN
        PERFORM public.schedule_pause_resume(t_app, 'challenge', current_date + 7, 'dryrun');
        v_log := v_log || '    정지 재개: 통과됨 (거절 기대 — 문제!)' || E'\n';
    EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || '    정지 재개 거절: ' || v_err || E'\n';
    END;
    PERFORM public.service_stop_withdraw(t_app, e->>'id', 'dryrun');

    -- 4) 입력 검증
    BEGIN
        PERFORM public.service_stop_set(t_app, 'refund', 'correction', 0, NULL, current_date + 1, false, 'dryrun');
        v_log := v_log || '[4] 미래 요청일: 통과됨 (거절 기대 — 문제!)' || E'\n';
    EXCEPTION WHEN others THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || '[4] 미래 요청일 거절: ' || v_err || E'\n';
    END;
    SELECT id INTO b_app FROM public.applications WHERE email = 'test@me.com' AND deposit_confirmed_by_admin IS NOT TRUE AND deleted IS NOT TRUE LIMIT 1;
    IF b_app IS NOT NULL THEN
        BEGIN
            PERFORM public.service_stop_set(b_app, 'refund', 'challenge', 0, NULL, NULL, false, 'dryrun');
            v_log := v_log || '    입금 미확인 신청서: 통과됨 (거절 기대 — 문제!)' || E'\n';
        EXCEPTION WHEN others THEN
            GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
            v_log := v_log || '    입금 미확인 신청서 거절: ' || v_err || E'\n';
        END;
    END IF;

    -- 5) 옛 방식 기록(김시영: app_status=refunded, service_stops 비어 있음) → 둘 다 멈춤으로 판정
    b1 := public.is_service_stopped(k_app, 'challenge'); b2 := public.is_service_stopped(k_app, 'correction');
    v_log := v_log || format('[5] 옛 방식 환불 표시(김시영): 내챌 멈춤=%s 첨삭 멈춤=%s (둘 다 true 기대) 기준시각=%s', b1, b2, public.service_stop_at(k_app, 'correction')) || E'\n';

    -- 6) 끝: test@me 상태 원복 확인
    SELECT app_status, correction_status INTO s1, s2 FROM public.applications WHERE id = t_app;
    SELECT count(*) INTO n2 FROM jsonb_array_elements(public.service_stop_entries(t_app)) x WHERE x->>'status' = 'active';
    v_log := v_log || format('[6] 끝: test@me app_status=%s correction_status=%s (NULL) active 항목 %s개 (0 기대) — 아래 예외로 전체 롤백', COALESCE(s1,'NULL'), COALESCE(s2,'NULL'), n2) || E'\n';

    RAISE EXCEPTION '%', v_log;
END $run$;
