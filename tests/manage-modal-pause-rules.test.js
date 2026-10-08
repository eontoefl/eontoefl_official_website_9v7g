#!/usr/bin/env node
// ---------------------------------------------------------------
// 관리창 일시정지 날짜 규칙(2026-10-08, 3단계) — js/admin-manage-modal.js의 순수 함수 4개
//   _pauseShiftDaysFrom / _pauseStartGuardMsg / _hasOpenPause / _closedPauseEntries
//   supabase-config.js(getPauseEntries 등)를 vm에 올린 뒤, 관리창 파일에서 함수 본문만 꺼내 같은 샌드박스에서 실행.
// 실행: node tests/manage-modal-pause-rules.test.js
// ---------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const cfg = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), "utf8");
const modal = fs.readFileSync(path.join(__dirname, "..", "js", "admin-manage-modal.js"), "utf8").replace(/\r\n/g, "\n");
const ctx = { console, fetch: () => {}, window: {}, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(ctx);
vm.runInContext(cfg, ctx, { filename: "supabase-config.js" });

// 관리창 파일에서 함수 본문 추출(선언부터 첫 줄 '}'까지)
function extract(name) {
  const m = modal.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n}\\n"));
  if (!m) throw new Error("not found: " + name);
  return m[0];
}
const src = ["_pauseShiftDaysFrom", "_pauseStartGuardMsg", "_hasOpenPause", "_closedPauseEntries", "_pauseKrDate", "_pauseAdminName"].map(extract).join("\n");
vm.runInContext(src, ctx, { filename: "admin-manage-modal(extract).js" });
const C = ctx;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n   " + (e && e.message)); }
}
const app = (cp, kp) => ({ challenge_pauses: cp || [], correction_pauses: kp || [] });
const FIXED = [{ id: "a", paused_from: "2026-10-05", resume_on: "2027-01-04", shift_days: 91, status: "open" }];
const RESUMED = [{ id: "b", paused_from: "2026-09-20", resume_on: "2026-09-27", shift_days: 7, status: "resumed" }];
const CANCELED = [{ id: "c", paused_from: "2026-10-05", resume_on: "2026-10-19", shift_days: 14, status: "canceled" }];
const OPEN = [{ id: "d", paused_from: "2026-10-05", resume_on: null, shift_days: null, status: "open" }];
const TWO = [RESUMED[0], FIXED[0]];

test("밀린 일수: 이력 없음/취소/무기한 → 0, 기간확정 91, 재개됨 7, 둘 다 98", () => {
  assert.equal(C._pauseShiftDaysFrom(app(), "challenge", "2026-09-13"), 0);
  assert.equal(C._pauseShiftDaysFrom(app(CANCELED), "challenge", "2026-09-13"), 0);
  assert.equal(C._pauseShiftDaysFrom(app(OPEN), "challenge", "2026-09-13"), 0);
  assert.equal(C._pauseShiftDaysFrom(app(FIXED), "challenge", "2026-09-13"), 91);
  assert.equal(C._pauseShiftDaysFrom(app(RESUMED), "challenge", "2026-09-13"), 7);
  assert.equal(C._pauseShiftDaysFrom(app(TWO), "challenge", "2026-09-13"), 98);
});
test("밀린 일수: 새 시작일이 정지 시작일 뒤면 그 정지는 제외(규칙 1이 막지만 계산은 안전하게)", () => {
  assert.equal(C._pauseShiftDaysFrom(app(TWO), "challenge", "2026-09-21"), 91);
  assert.equal(C._pauseShiftDaysFrom(app(TWO), "challenge", "2026-10-06"), 0);
});
test("밀린 일수: 종류 분리(첨삭 이력은 내챌 계산에 안 들어감)", () => {
  assert.equal(C._pauseShiftDaysFrom(app([], FIXED), "challenge", "2026-09-13"), 0);
  assert.equal(C._pauseShiftDaysFrom(app([], FIXED), "correction", "2026-09-13"), 91);
});
test("시작일 검사: 이력 없음/취소만 → 통과(null)", () => {
  assert.equal(C._pauseStartGuardMsg(app(), "challenge", "2026-12-01", "시작일"), null);
  assert.equal(C._pauseStartGuardMsg(app(CANCELED), "challenge", "2026-12-01", "시작일"), null);
  assert.equal(C._pauseStartGuardMsg(app(FIXED), "challenge", null, "시작일"), null);
});
test("시작일 검사: 정지 시작일 앞 → 통과, 같음/뒤 → 거절 문구(리셋 안내 포함)", () => {
  assert.equal(C._pauseStartGuardMsg(app(FIXED), "challenge", "2026-10-04", "내벨업챌린지 시작일"), null);
  const same = C._pauseStartGuardMsg(app(FIXED), "challenge", "2026-10-05", "내벨업챌린지 시작일");
  const after = C._pauseStartGuardMsg(app(FIXED), "challenge", "2027-01-03", "내벨업챌린지 시작일");
  assert.ok(same && same.includes("10/5(월)") && same.includes("리셋"), same);
  assert.ok(after && after.includes("리셋"), after);
});
test("시작일 검사: 여러 이력이면 가장 이른 정지 시작일 기준", () => {
  assert.equal(C._pauseStartGuardMsg(app(TWO), "challenge", "2026-09-19", "시작일"), null);
  assert.ok(C._pauseStartGuardMsg(app(TWO), "challenge", "2026-09-20", "시작일"));
});
test("열린 정지 판정: open만 true(resumed·canceled false)", () => {
  assert.equal(C._hasOpenPause(app([], OPEN), "correction"), true);
  assert.equal(C._hasOpenPause(app([], FIXED), "correction"), true);
  assert.equal(C._hasOpenPause(app([], RESUMED), "correction"), false);
  assert.equal(C._hasOpenPause(app([], CANCELED), "correction"), false);
  assert.equal(C._hasOpenPause(app(OPEN, []), "correction"), false);
});
test("종료 처리: open → canceled + 시각·메모, 나머지 그대로, 원본 불변", () => {
  const src = [OPEN[0], RESUMED[0]];
  const out = C._closedPauseEntries(src, "첨삭 해제로 종료");
  assert.equal(out[0].status, "canceled");
  assert.ok(out[0].canceled_at && out[0].note === "첨삭 해제로 종료");
  assert.equal(out[1].status, "resumed");
  assert.equal(src[0].status, "open");
  const withNote = C._closedPauseEntries([{ ...OPEN[0], note: "여행" }], "첨삭 해제로 종료");
  assert.equal(withNote[0].note, "여행 · 첨삭 해제로 종료");
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
