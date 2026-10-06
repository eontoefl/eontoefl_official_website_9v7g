#!/usr/bin/env node
// ---------------------------------------------------------------
// 일시정지 판정·보정 검증 (2026-10-06, 2단계) — js/supabase-config.js
//   서버 is_paused / pause_adjusted_date / 경과일 계산과 같은 규칙인지, 정지 이력이 없으면 1단계 결과 그대로인지.
// 실행: node tests/pause-rules.test.js
// ---------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), "utf8");
const ctx = { console, fetch: () => {}, window: {}, document: {}, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: "supabase-config.js" });
const C = ctx;
const DAY = 86400000;
const U = (ymd) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n   " + (e && e.message)); }
}

// 2026-09-06(일) 시작 Fast. 9/23(수)부터 정지, 10/14(수) 재개 (3주 = 21일)
const P_FIXED = [{ id: "a", paused_from: "2026-09-23", resume_on: "2026-10-14", shift_days: 21, status: "open" }];
const P_OPEN  = [{ id: "b", paused_from: "2026-09-23", resume_on: null, shift_days: null, status: "open" }];
const P_CANCEL = [{ id: "c", paused_from: "2026-09-23", resume_on: "2026-10-14", shift_days: 21, status: "canceled" }];
const appOf = (pauses, extra) => Object.assign({ schedule_start: "2026-09-06", schedule_end: "2026-10-03", correction_start_date: "2026-09-06" }, extra || {}, { challenge_pauses: pauses, correction_pauses: pauses });

test("1. 이력 없음/빈 배열/취소만: 1단계 결과 그대로", () => {
  for (const p of [undefined, [], P_CANCEL, "[]"]) {
    const app = appOf(p);
    assert.strictEqual(C.getChallengeTaskYmd(app, 3, 3), "2026-09-23");
    assert.strictEqual(C.getChallengeDayDiff(app, U("2026-10-20")), 44);
    assert.strictEqual(C.getCorrectionWindow(app, 1).endYmd, "2026-10-03");
    assert.strictEqual(C.getCorrSession12Ymd(app), "2026-10-01");
    assert.strictEqual(C.isPausedNow(app, "challenge"), false);
    assert.strictEqual(C.getActivePause(app, "challenge", "2026-09-30"), null);
  }
});

test("2. 정지 중 판정(getActivePause): 시작일 당일부터, 재개일 전날까지, 재개일부터 아님", () => {
  const app = appOf(P_FIXED);
  assert.strictEqual(C.getActivePause(app, "challenge", "2026-09-22"), null);
  assert.ok(C.getActivePause(app, "challenge", "2026-09-23"));
  assert.ok(C.getActivePause(app, "challenge", "2026-10-13"));
  assert.strictEqual(C.getActivePause(app, "challenge", "2026-10-14"), null);
  const open = appOf(P_OPEN);
  assert.ok(C.getActivePause(open, "challenge", "2026-12-31"), "무기한은 계속 정지 중");
  assert.strictEqual(C.getScheduledPause(appOf(P_FIXED), "challenge", "2026-09-20") && C.getScheduledPause(appOf(P_FIXED), "challenge", "2026-09-20").paused_from, "2026-09-23");
  assert.strictEqual(C.getScheduledPause(appOf(P_FIXED), "challenge", "2026-09-23"), null);
});

test("3. 과제 날짜 보정: 정지 전 과제 불변, 정지 시작일 이후 과제 +21일, 요일 보존", () => {
  const app = appOf(P_FIXED);
  assert.strictEqual(C.getChallengeTaskYmd(app, 3, 2), "2026-09-22", "정지 전날(화) 그대로");
  assert.strictEqual(C.getChallengeTaskYmd(app, 3, 3), "2026-10-14", "정지 당일(수) 과제 → 재개 주 수요일");
  assert.strictEqual(C.getChallengeTaskYmd(app, 3, 5), "2026-10-16");
  assert.strictEqual(C.getChallengeTaskYmd(app, 4, 0), "2026-10-18");
  assert.strictEqual(U(C.getChallengeTaskYmd(app, 4, 0)).getUTCDay(), 0, "일요일 유지");
});

test("4. 무기한 정지: 정지 이후 과제는 null(미정), 정지 전 과제는 그대로", () => {
  const app = appOf(P_OPEN);
  assert.strictEqual(C.getChallengeTaskYmd(app, 3, 2), "2026-09-22");
  assert.strictEqual(C.getChallengeTaskDate(app, 3, 3), null);
  assert.strictEqual(C.getChallengeTaskDate(app, 4, 0), null);
  assert.strictEqual(C.getCorrectionWindow(app, 1).endYmd, null);
  assert.strictEqual(C.getCorrectionWindow(app, 1).endMoment, null);
  assert.strictEqual(C.getCorrSession12Ymd(app), null);
});

test("5. 경과일·주차: 정지 중엔 멈춤, 재개 후 이어짐 (3주차 수요일 정지 → 재개일에 3주차 수요일)", () => {
  const app = appOf(P_FIXED);
  assert.strictEqual(C.getChallengeDayDiff(app, U("2026-09-22")), 16);   // 정지 전날: 3주차 화요일(0-based 16)
  assert.strictEqual(C.getChallengeDayDiff(app, U("2026-09-23")), 17);   // 정지 당일: 경과일은 17로 멈춤
  assert.strictEqual(C.getChallengeDayDiff(app, U("2026-10-05")), 17);   // 정지 중 변함없음
  assert.strictEqual(C.getChallengeDayDiff(app, U("2026-10-14")), 17);   // 재개일 = 3주차 수요일
  assert.strictEqual(C.getChallengeWeekRaw(app, U("2026-10-14")), 3);
  assert.strictEqual(C.getChallengeDayDiff(app, U("2026-10-18")), 21);   // 재개 후 일요일 = 4주차
  assert.strictEqual(C.getChallengeWeekRaw(app, U("2026-10-18")), 4);
  const open = appOf(P_OPEN);
  assert.strictEqual(C.getChallengeDayDiff(open, U("2026-11-30")), 17, "무기한: 계속 멈춤");
});

test("6. 첨삭: 일반 첨삭 종료일(시작+27)과 12회차(시작+25)에 보정, 저장된 종료일은 그대로", () => {
  const app = appOf(P_FIXED);
  assert.strictEqual(C.getCorrectionWindow(app, 1).endYmd, "2026-10-24");     // 10/03 + 21
  assert.strictEqual(C.getCorrSession12Ymd(app), "2026-10-22");                // 10/01 + 21
  const sp = appOf(P_FIXED, { correction_end_date: "2026-11-30" });            // 자기주도(저장값, 재개 때 이미 밀림)
  assert.strictEqual(C.getCorrectionWindow(sp, 1).endYmd, "2026-11-30");
  assert.strictEqual(C.getCorrSession12Ymd(sp), "2026-11-30");
});

test("7. 정지 두 번 누적: 순서대로 더해진다", () => {
  const two = [
    { id: "1", paused_from: "2026-09-13", resume_on: "2026-09-20", shift_days: 7, status: "resumed" },
    { id: "2", paused_from: "2026-10-04", resume_on: "2026-10-18", shift_days: 14, status: "open" },
  ];
  const app = appOf(two);
  assert.strictEqual(C.getChallengeTaskYmd(app, 1, 0), "2026-09-06");   // 정지 전
  assert.strictEqual(C.getChallengeTaskYmd(app, 2, 0), "2026-09-20");   // 9/13 → +7 (두 번째 정지 전)
  assert.strictEqual(C.getChallengeTaskYmd(app, 4, 0), "2026-10-18");   // 9/27 → +7 = 10/04 ≥ 두 번째 정지 → +14
  assert.strictEqual(C.getPausedDaysUntil(app, "challenge", "2026-10-10"), 7 + 6);
  assert.strictEqual(C.getPausedDaysUntil(app, "challenge", "2026-11-01"), 21);
});

test("8. 상태 판정: getAppLiveStatus / getCorrectionStatus 에 'paused' (환불 우선, 종료 판정보다 앞)", () => {
  const real = C.getEffectiveToday;
  C.getEffectiveToday = () => U("2026-10-05");   // 정지 기간 안, 내챌 종료일(10/03) 지난 날
  try {
    const app = appOf(P_FIXED, { deposit_confirmed_by_admin: true, correction_enabled: true });
    assert.strictEqual(C.getAppLiveStatus(app).key, "paused", "종료일이 지나도 정지 중이면 paused");
    assert.strictEqual(C.getCorrectionStatus(app).key, "paused");
    assert.strictEqual(C.getCorrectionStatus(app).adminLabel, "첨삭 정지중");
    assert.strictEqual(C.getAppLiveStatus(Object.assign({}, app, { app_status: "refunded" })).key, "refunded", "환불 우선");
    C.getEffectiveToday = () => U("2026-10-14");
    // 재개일: 서버가 재개일 확정 때 저장된 종료일(schedule_end)을 10/03 → 10/24로 밀어 두므로 진행중
    const resumed = Object.assign({}, app, { schedule_end: "2026-10-24" });
    assert.strictEqual(C.getAppLiveStatus(resumed).key, "active");
    assert.strictEqual(C.getAppLiveStatus(app).key, "completed", "(저장 종료일을 안 밀었다면 종료로 보임 — 서버 밀기가 필수인 이유)");
  } finally { C.getEffectiveToday = real; }
});

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
