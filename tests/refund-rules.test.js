#!/usr/bin/env node
// ---------------------------------------------------------------
// 환불·중도포기 판정 검증 (2026-10-12, 환불처리 1단계) — js/supabase-config.js
//   서버 service_stop_at / is_service_stopped 와 같은 규칙인지, 기록이 없으면 기존 결과 그대로인지,
//   옛 방식 표시(app_status 만 있는 기록)가 둘 다 중단으로 읽히는지, 첨삭만 환불이 내챌 판정에 번지지 않는지.
// 실행: node tests/refund-rules.test.js
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
const U = (ymd) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n   " + (e && e.message)); }
}

// 2026-09-06(일) 시작 Fast, 첨삭 9/06 시작. 오늘 = 9/20(진행 중)
const base = () => ({ schedule_start: "2026-09-06", schedule_end: "2026-10-03", correction_start_date: "2026-09-06",
  deposit_confirmed_by_admin: true, correction_enabled: true, challenge_pauses: [], correction_pauses: [], service_stops: [] });
const E = (target, extra) => Object.assign({ id: "s1", kind: "refund", target, amount: 200000, reason: "t", requested_on: "2026-09-16", status: "active", created_at: "2026-09-16T02:00:00Z" }, extra || {});

const real = C.getEffectiveToday;
C.getEffectiveToday = () => U("2026-09-20");
try {
  test("1. 기록 없음/빈 배열/문자열 '[]': 기존 결과 그대로(진행중)", () => {
    for (const v of [undefined, [], "[]"]) {
      const app = Object.assign(base(), { service_stops: v });
      assert.strictEqual(C.getActiveStop(app, "challenge"), null);
      assert.strictEqual(C.getActiveStop(app, "correction"), null);
      assert.strictEqual(C.isStoppedNow(app, "challenge"), false);
      assert.strictEqual(C.getAppLiveStatus(app).key, "active");
      assert.strictEqual(C.getCorrectionStatus(app).key, "active");
    }
  });

  test("2. 첨삭만 환불: 첨삭은 refunded, 내챌은 그대로 진행중 (내챌 판정에 번지지 않음)", () => {
    const app = Object.assign(base(), { service_stops: [E("correction")] });
    assert.strictEqual(C.getActiveStop(app, "challenge"), null);
    assert.ok(C.getActiveStop(app, "correction"));
    assert.strictEqual(C.getAppLiveStatus(app).key, "active");
    assert.strictEqual(C.getCorrectionStatus(app).key, "refunded");
    assert.strictEqual(C.getCorrectionStatus(app).adminLabel, "첨삭 환불");
    assert.strictEqual(C.isStoppedNow(app, "challenge"), false);
    assert.strictEqual(C.isStoppedNow(app, "correction"), true);
  });

  test("3. 내챌만 환불(첨삭 유지): 내챌 refunded, 첨삭은 진행중", () => {
    const app = Object.assign(base(), { service_stops: [E("challenge")] });
    assert.strictEqual(C.getAppLiveStatus(app).key, "refunded");
    assert.strictEqual(C.getCorrectionStatus(app).key, "active");
  });

  test("4. 둘 다 중도포기: 내챌 dropped, 첨삭 refunded(라벨 중도포기)", () => {
    const app = Object.assign(base(), { service_stops: [E("both", { kind: "dropped", amount: 0 })] });
    assert.strictEqual(C.getAppLiveStatus(app).key, "dropped");
    assert.strictEqual(C.getCorrectionStatus(app).key, "refunded");
    assert.strictEqual(C.getCorrectionStatus(app).label, "중도포기");
    assert.strictEqual(C.getCorrectionStatus(app).adminLabel, "첨삭 중도포기");
  });

  test("5. 철회된 항목(withdrawn)은 무시 → 진행중", () => {
    const app = Object.assign(base(), { service_stops: [E("both", { status: "withdrawn" })] });
    assert.strictEqual(C.getActiveStop(app, "challenge"), null);
    assert.strictEqual(C.getAppLiveStatus(app).key, "active");
    assert.strictEqual(C.getCorrectionStatus(app).key, "active");
  });

  test("6. 환불이 정지보다 앞: 정지 중 + 환불 → refunded. 환불 뒤 첨삭 스위치를 꺼도 '첨삭 환불' 유지", () => {
    const paused = [{ id: "p", paused_from: "2026-09-16", resume_on: null, shift_days: null, status: "open" }];
    const app = Object.assign(base(), { challenge_pauses: paused, correction_pauses: paused, service_stops: [E("both")] });
    assert.strictEqual(C.getAppLiveStatus(app).key, "refunded");
    assert.strictEqual(C.getCorrectionStatus(app).key, "refunded");
    const off = Object.assign(base(), { correction_enabled: false, service_stops: [E("correction")] });
    assert.strictEqual(C.getCorrectionStatus(off).key, "refunded", "스위치를 꺼도 환불 표시 유지(S7)");
    assert.strictEqual(C.getCorrectionStatus(Object.assign(base(), { correction_enabled: false })), null, "환불 없이 스위치만 꺼지면 기존대로 null");
  });

  test("7. 옛 방식 기록(app_status 만, service_stops 비어 있음): 둘 다 중단. 첨삭이 없던 학생은 내챌만", () => {
    const legacy = Object.assign(base(), { app_status: "refunded", refund_amount: 890000, refund_reason: "옛", refund_at: 1774161553433, service_stops: [] });
    assert.ok(C.getActiveStop(legacy, "challenge").legacy);
    assert.ok(C.getActiveStop(legacy, "correction").legacy);
    assert.strictEqual(C.getAppLiveStatus(legacy).key, "refunded");
    assert.strictEqual(C.getCorrectionStatus(legacy).key, "refunded");
    const noCorr = Object.assign(base(), { app_status: "dropped", correction_enabled: false, correction_start_date: null, service_stops: [] });
    assert.strictEqual(C.getAppLiveStatus(noCorr).key, "dropped");
    assert.strictEqual(C.getActiveStop(noCorr, "correction"), null);
    assert.strictEqual(C.getCorrectionStatus(noCorr), null);
    // 작은 객체(학습관리 v3 식)로도 판정된다 — service_stops 칸이 아예 없어도 app_status fallback
    assert.strictEqual(C.getAppLiveStatus({ schedule_start: "2026-09-06", schedule_end: "2026-10-03", app_status: "refunded", challenge_pauses: [] }).key, "refunded");
  });

  test("8. 새 기록이 있으면 옛 칸은 무시(호환 칸은 서버가 함께 갱신하므로 보통 일치)", () => {
    const app = Object.assign(base(), { app_status: "refunded", service_stops: [E("correction")] });
    assert.strictEqual(C.getAppLiveStatus(app).key, "active", "첨삭만 환불인데 옛 칸이 남아 있어도 새 기록이 우선");
  });
} finally { C.getEffectiveToday = real; }

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
