#!/usr/bin/env node
// 일시정지 2단계 — 2부(가드) 마이그레이션 생성기 (2026-10-06)
//   레포에 있는 라이브 함수 7개의 CREATE OR REPLACE 블록을 그대로 꺼내, 정지 가드 줄만 끼워 넣어
//   supabase/migrations/20261006_schedule_pause_2_guards.sql 을 만든다.
//   (손으로 옮겨 적다 생기는 오타를 막기 위해 자동 생성. 레포 본문 = 라이브 본문임은 2026-10-06 md5(prosrc)로 확인:
//    process_start_notices·process_scheduled_releases 는 주석만 다르고 로직 동일.)
// 실행: node supabase/tests/gen_schedule_pause_guards.mjs
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
  const rest = after.slice(endIdx, endIdx + 2);
  return after.slice(0, endIdx) + (rest.startsWith(';') ? ';' : ';');
}

function replaceOnce(text, from, to, label) {
  const i = text.indexOf(from);
  if (i < 0) throw new Error('앵커 못 찾음: ' + label);
  if (text.indexOf(from, i + 1) >= 0) throw new Error('앵커가 둘 이상: ' + label);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

const out = [];
out.push(`-- =====================================================================
-- 일시정지 2단계 — 2부: 기존 자동작업 7개에 정지 가드 + 새 cron + 날 작업(jobid 1) 삭제 (2026-10-06)
--   ⚠️ 이 파일은 supabase/tests/gen_schedule_pause_guards.mjs 가 레포 원문에서 생성한다. 직접 고치지 말 것.
--   선행: 20261006_schedule_pause_1_core.sql (is_paused·pause_adjusted_date·correction_release_blocked)
--   동작 변경: 정지 이력이 있는 학생만 건너뛴다. 정지 이력이 없는 학생에게는 결과가 같다.
--   사전 검사: 2026-10-06 라이브 본문(prosrc) md5 와 같을 때만 진행 — 다르면 그 사이 라이브가 바뀐 것이므로 중단.
--   실행: Supabase SQL Editor 전체 실행(한 트랜잭션), "Run without RLS".
-- =====================================================================

BEGIN;

DO $chk$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='is_paused') THEN
    RAISE EXCEPTION 'ABORT 1부(…_1_core.sql)가 먼저 적용돼야 함';
  END IF;
`);

// 2026-10-06 라이브 md5(prosrc) — DB대조·v2조사_3 기준
const liveMd5 = {
  preview_correction_session_reminders: 'de1ce8ea674e63c5ada893d81f3382d5',
  process_start_notices:                '893549fb6707c74e15f598ad9b1f9867',
  process_auto_approve_corrections:     '127f062d0d90c9bc46f0409f9bb2ec5a',
  process_scheduled_releases:           '04a9a1891cf72bd8d4ac6d7fff0f87c4',
  process_auto_retry_corrections:       'ebef8f015823b48c5de874412e8a05bc',
  auto_enable_practice_mode:            '28934107d9e2aa04f4b5262144ed500f',
  send_practice_open_alimtalk:          '47a4eace5631d99c3a7ff2e073a8d714',
};
for (const [fn, md5] of Object.entries(liveMd5)) {
  out.push(`  SELECT md5(p.prosrc) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${fn}';
  IF v IS DISTINCT FROM '${md5}' THEN RAISE EXCEPTION 'ABORT ${fn} 라이브 본문이 2026-10-06 확인본과 다름: %', v; END IF;`);
}
out.push(`END $chk$;\n`);

// ---------- 1. preview_correction_session_reminders ----------
let f = extractFunction('20260915_correction_session_reminder.sql', 'preview_correction_session_reminders');
f = replaceOnce(f,
  `            SELECT a.assigned_program, a.preferred_program\n            FROM public.applications a\n            WHERE a.user_id = cs.user_id::text`,
  `            SELECT a.id AS app_id, a.assigned_program, a.preferred_program\n            FROM public.applications a\n            WHERE a.user_id = cs.user_id::text`,
  'preview LATERAL a.id');
f = replaceOnce(f,
  `            CASE WHEN COALESCE(ap.assigned_program, ap.preferred_program, '') LIKE '%Australia%'\n                 THEN 'aus' ELSE 'general' END    AS track,`,
  `            ap.app_id                             AS app_id,\n            CASE WHEN COALESCE(ap.assigned_program, ap.preferred_program, '') LIKE '%Australia%'\n                 THEN 'aus' ELSE 'general' END    AS track,`,
  'preview select app_id');
f = replaceOnce(f,
  `        v_today := v_local::date;\n`,
  `        v_today := v_local::date;\n\n        -- [일시정지] 첨삭 정지 중인 학생은 통째로 건너뛴다(정지 전 1차를 낸 회차는 알림 대상이 아니므로 여기서 가드해도 R3와 충돌 없음)\n        IF public.is_paused(r.app_id, 'correction', v_today) THEN\n            CONTINUE;\n        END IF;\n`,
  'preview is_paused');
f = replaceOnce(f,
  `                    v_date   := r.start_date + c_offset[v_idx];\n                    v_reason := 'regular offset ' || c_offset[v_idx];`,
  `                    v_date   := public.pause_adjusted_date(r.app_id, 'correction', r.start_date + c_offset[v_idx]);   -- [일시정지] 정지 기간 건너뛰기\n                    v_reason := 'regular offset ' || c_offset[v_idx];`,
  'preview regular offset');
f = replaceOnce(f,
  `                        v_date   := r.extension_start_date + c_offset[v_idx];\n                        v_reason := 'ext offset ' || c_offset[v_idx];`,
  `                        v_date   := public.pause_adjusted_date(r.app_id, 'correction', r.extension_start_date + c_offset[v_idx]);   -- [일시정지]\n                        v_reason := 'ext offset ' || c_offset[v_idx];`,
  'preview ext offset');
out.push('-- ---------- 1. 첨삭 회차 당일 알림(50244) 미리보기: 정지 중 건너뜀 + 오프셋 날짜 보정 ----------\n' + f + '\n');

// ---------- 2. process_start_notices ----------
f = extractFunction('20260928_consent_deadline_start_notice.sql', 'process_start_notices');
f = replaceOnce(f,
  `              AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n              AND x.sd IN (v_today, v_today + 1)`,
  `              AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n              AND NOT public.is_paused(a.id, 'challenge', v_today)   -- [일시정지]\n              AND x.sd IN (v_today, v_today + 1)`,
  'start_notices challenge');
f = replaceOnce(f,
  `                  AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n                ORDER BY a.created_at DESC NULLS LAST\n                LIMIT 1\n            ) ap ON true`,
  `                  AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n                  AND NOT public.is_paused(a.id, 'correction', v_today)   -- [일시정지]\n                ORDER BY a.created_at DESC NULLS LAST\n                LIMIT 1\n            ) ap ON true`,
  'start_notices correction');
out.push('-- ---------- 2. 시작 안내(50208·50213): 정지 중 제외 ----------\n' + f + '\n');

// ---------- 3. process_auto_approve_corrections ----------
f = extractFunction('auto_approve_correction_aus_labels.sql', 'process_auto_approve_corrections');
f = replaceOnce(f,
  `        WHERE cs.scheduled_release_at IS NULL\n          AND (`,
  `        WHERE cs.scheduled_release_at IS NULL\n          AND NOT public.correction_release_blocked(cs.user_id, cs.draft_1_submitted_at)   -- [일시정지] 정지 전 1차 제출 회차는 통과(R3)\n          AND (`,
  'auto_approve');
out.push('-- ---------- 3. 첨삭 자동 공개(5시간): 정지 중 보류(진행 중 회차 예외) ----------\n' + f + '\n');

// ---------- 4. process_scheduled_releases ----------
f = extractFunction('scheduled_release.sql', 'process_scheduled_releases');
f = replaceOnce(f,
  `        WHERE cs.scheduled_release_at IS NOT NULL\n          AND cs.scheduled_release_at <= now()`,
  `        WHERE cs.scheduled_release_at IS NOT NULL\n          AND NOT public.correction_release_blocked(cs.user_id, cs.draft_1_submitted_at)   -- [일시정지]\n          AND cs.scheduled_release_at <= now()`,
  'scheduled_releases');
out.push('-- ---------- 4. 첨삭 예약 공개: 정지 중 보류(진행 중 회차 예외) ----------\n' + f + '\n');

// ---------- 5. process_auto_retry_corrections ----------
f = extractFunction('auto_retry_corrections.sql', 'process_auto_retry_corrections');
f = replaceOnce(f,
  `        WHERE cs.auto_retry_count < v_max_retries\n          AND cs.status IN ('feedback1_failed','feedback2_failed','draft1_submitted','draft2_submitted')\n        FOR UPDATE OF cs SKIP LOCKED\n    LOOP\n        v_is_draft1 := rec.status IN ('feedback1_failed','draft1_submitted');\n        v_is_failed := rec.status IN ('feedback1_failed','feedback2_failed');\n\n        IF v_is_draft1 THEN\n            v_submitted_at := rec.draft_1_submitted_at;`,
  `        WHERE cs.auto_retry_count < v_max_retries\n          AND cs.status IN ('feedback1_failed','feedback2_failed','draft1_submitted','draft2_submitted')\n          AND NOT public.correction_release_blocked(cs.user_id, cs.draft_1_submitted_at)   -- [일시정지] 재채점도 정지 중 보류\n        FOR UPDATE OF cs SKIP LOCKED\n    LOOP\n        v_is_draft1 := rec.status IN ('feedback1_failed','draft1_submitted');\n        v_is_failed := rec.status IN ('feedback1_failed','feedback2_failed');\n\n        IF v_is_draft1 THEN\n            v_submitted_at := rec.draft_1_submitted_at;`,
  'auto_retry');
out.push('-- ---------- 5. 첨삭 자동 재실행: 정지 중 보류(진행 중 회차 예외) ----------\n' + f + '\n');

// ---------- 6. auto_enable_practice_mode ----------
f = extractFunction('fix_practice_regular_only.sql', 'auto_enable_practice_mode');
f = replaceOnce(f,
  `          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.\n          AND COALESCE(a.course_track, 'regular') <> 'australia'\n    ),`,
  `          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n          AND NOT public.is_paused(a.id, 'challenge', v_today)   -- [일시정지]\n          -- 연습코스는 일반 정규과정 전용. 호주 과정 제외.\n          AND COALESCE(a.course_track, 'regular') <> 'australia'\n    ),`,
  'auto_enable');
out.push('-- ---------- 6. 연습코스 자동 오픈: 정지 중 제외 ----------\n' + f + '\n');

// ---------- 7. send_practice_open_alimtalk ----------
f = extractFunction('fix_practice_regular_only.sql', 'send_practice_open_alimtalk');
f = replaceOnce(f,
  `          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n          AND COALESCE(a.phone, '') <> ''`,
  `          AND COALESCE(a.app_status, '') NOT IN ('refunded', 'dropped')\n          AND NOT public.is_paused(a.id, 'challenge')   -- [일시정지]\n          AND COALESCE(a.phone, '') <> ''`,
  'send_practice_open');
out.push('-- ---------- 7. 연습코스 오픈 알림톡(50231): 정지 중 제외 ----------\n' + f + '\n');

out.push(`-- ---------- 8. cron: 매일 정리(KST 00:01, 연습코스 자동 오픈 00:05보다 먼저) + 재개 안내(KST 10:00) ----------
SELECT cron.unschedule('process-schedule-pauses') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-schedule-pauses');
SELECT cron.schedule('process-schedule-pauses', '1 15 * * *', 'SELECT process_schedule_pauses()');
SELECT cron.unschedule('process-resume-notices') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-resume-notices');
SELECT cron.schedule('process-resume-notices', '0 1 * * *', 'SELECT process_resume_notices()');

-- ---------- 9. Q3: 레포에 없는 날 작업(jobid 1 practice-auto-enable, 환불·정지 확인 없는 UPDATE문) 삭제 — auto-enable-practice-mode(jobid 18)가 같은 일을 한다 ----------
SELECT cron.unschedule('practice-auto-enable') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'practice-auto-enable');

-- 적용 후 확인
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname IN ('process-schedule-pauses','process-resume-notices','practice-auto-enable','auto-enable-practice-mode') ORDER BY jobid;
SELECT p.proname, md5(p.prosrc) AS md5_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('preview_correction_session_reminders','process_start_notices','process_auto_approve_corrections',
                     'process_scheduled_releases','process_auto_retry_corrections','auto_enable_practice_mode','send_practice_open_alimtalk')
 ORDER BY 1;

COMMIT;
`);

const target = path.join(mig, '20261006_schedule_pause_2_guards.sql');
fs.writeFileSync(target, out.join('\n'), 'utf8');
console.log('generated', target, fs.statSync(target).size, 'bytes');
