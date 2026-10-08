#!/usr/bin/env node
// ---------------------------------------------------------------
// 관리창 일시정지 4단계(2026-10-08) — 기간 수정·되돌리기 순수 함수
//   _pauseRescheduleDelta / _pauseKnownEndYmd / _pauseRescheduleConfirmMsg / _pauseIndefiniteConfirmMsg
//   _pauseUndoConfirmMsg / _pauseUndoBlockedHtml
// 실행: node tests/manage-modal-pause-undo.test.js
// ---------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const cfg = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), "utf8");
const modal = fs.readFileSync(path.join(__dirname, "..", "js", "admin-manage-modal.js"), "utf8").replace(/\r\n/g, "\n");
const ctx = { console, fetch: () => {}, window: {}, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem: () => {} },
  escapeHtml: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) };
vm.createContext(ctx);
vm.runInContext(cfg, ctx, { filename: "supabase-config.js" });

function extract(name) {
  const m = modal.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n}\\n"));
  if (!m) throw new Error("not found: " + name);
  return m[0];
}
const names = ["_pauseKrDate", "_pauseRescheduleDelta", "_pauseKnownEndYmd", "_pauseRescheduleConfirmMsg", "_pauseIndefiniteConfirmMsg", "_pauseUndoConfirmMsg", "_pauseUndoBlockedHtml"];
vm.runInContext(names.map(extract).join("\n"), ctx, { filename: "admin-manage-modal(extract).js" });
const C = ctx;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n   " + (e && e.message)); }
}

// 김명희 꼴: 첨삭 10/6(화) 정지, 재개 11/3(화), 28일 밀림(적용됨)
const ACTIVE = { id: "a", paused_from: "2026-10-06", resume_on: "2026-11-03", shift_days: 28, shift_applied_at: "2026-10-08T00:00:00Z", status: "open", reverted_rows: 0, deleted_reminders: 1,
  undo: { before: { correction_end_date: null, extension_end_date: null }, after: { correction_end_date: null, extension_end_date: null } } };
// 자기주도 첨삭 꼴: 종료일 저장됨
const APP_SELF = { self_paced_end_date: "2026-11-21", schedule_end: "2026-10-10", correction_end_date: "2026-11-21", extension_end_date: null };
const ACTIVE_SELF = { ...ACTIVE, reverted_rows: 2, undo: { before: { correction_end_date: "2026-10-24" }, after: { correction_end_date: "2026-11-21" } } };
// 무기한(밀기 미적용)
const INDEF = { id: "b", paused_from: "2026-10-06", resume_on: null, shift_days: null, status: "open" };

test("delta: 11/3→11/10 = +7, 11/3→10/27 = −7, 무기한(미적용)→10/20 = 14 전부", () => {
  assert.deepEqual(C._pauseRescheduleDelta(ACTIVE, "2026-11-10"), { diff: 35, delta: 7, applied: 28 });
  assert.deepEqual(C._pauseRescheduleDelta(ACTIVE, "2026-10-27"), { diff: 21, delta: -7, applied: 28 });
  assert.deepEqual(C._pauseRescheduleDelta(INDEF, "2026-10-20"), { diff: 14, delta: 14, applied: 0 });
});
test("저장된 종료일: 내챌=자기주도 종료일>종료일, 첨삭=연장 종료일>지정 종료일, 없으면 null", () => {
  assert.equal(C._pauseKnownEndYmd(APP_SELF, "challenge"), "2026-11-21");
  assert.equal(C._pauseKnownEndYmd({ schedule_end: "2026-10-10" }, "challenge"), "2026-10-10");
  assert.equal(C._pauseKnownEndYmd(APP_SELF, "correction"), "2026-11-21");
  assert.equal(C._pauseKnownEndYmd({ correction_end_date: "2026-11-21", extension_end_date: "2026-12-19" }, "correction"), "2026-12-19");
  assert.equal(C._pauseKnownEndYmd({}, "correction"), null);
  assert.equal(C._pauseKnownEndYmd(null, "correction"), null);
});
test("재개일 변경 문구: 더 밀림/앞당김/종료일 표시, 일반 첨삭(종료일 없음)은 종료일 줄 없음", () => {
  const m1 = C._pauseRescheduleConfirmMsg(APP_SELF, "correction", ACTIVE, "2026-11-10");
  assert.ok(m1.includes("11/3(화) → 11/10(화)") && m1.includes("7일 더 밀립니다") && m1.includes("11/21(토) → 11/28(토)"), m1);
  const m2 = C._pauseRescheduleConfirmMsg(APP_SELF, "correction", ACTIVE, "2026-10-27");
  assert.ok(m2.includes("7일 앞당겨집니다") && m2.includes("11/21(토) → 11/14(토)"), m2);
  const m3 = C._pauseRescheduleConfirmMsg({}, "correction", ACTIVE, "2026-11-10");
  assert.ok(m3.includes("7일 더 밀립니다") && !m3.includes("종료일") && m3.includes("전날 10시"), m3);
});
test("무기한 전환 문구: 밀어 둔 일수 되돌림 + 종료일 복귀, 알림톡 없음", () => {
  const m = C._pauseIndefiniteConfirmMsg(APP_SELF, "correction", ACTIVE);
  assert.ok(m.includes("11/3(화)") && m.includes("28일을 되돌립니다") && m.includes("11/21(토) → 10/24(토)") && m.includes("알림톡은 발송되지 않습니다"), m);
  const m0 = C._pauseIndefiniteConfirmMsg({}, "correction", { ...ACTIVE, shift_applied_at: undefined });
  assert.ok(!m0.includes("되돌립니다") && m0.includes("무기한 정지로"), m0);
});
test("되돌리기 문구: 종료일 전/후, 과제·알림 복구 건수, 직접 안내 문구", () => {
  const m = C._pauseUndoConfirmMsg(APP_SELF, "correction", ACTIVE_SELF);
  assert.ok(m.includes("스라첨삭 정지(10/6(화)부터)") && m.includes("11/21(토) → 10/24(토)") && m.includes("과제 2개") && m.includes("알림 기록 1건") && m.includes("직접 안내"), m);
  const m2 = C._pauseUndoConfirmMsg({}, "correction", ACTIVE);
  assert.ok(m2.includes("밀어 둔 날짜가 있으면") && !m2.includes("과제") && m2.includes("알림 기록 1건"), m2);
});
test("불가 사유 HTML: 사유 나열 + HTML 이스케이프", () => {
  const h = C._pauseUndoBlockedHtml(["재개 안내 알림톡이 이미 나갔습니다(2026-11-03 기준).", "<b>x</b>"]);
  assert.ok(h.includes("되돌리기 불가") && h.includes("수동 처리") && h.includes("2026-11-03") && h.includes("&lt;b&gt;x&lt;/b&gt;"), h);
  assert.ok(C._pauseUndoBlockedHtml(null).includes("되돌리기 불가"));
});

console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
