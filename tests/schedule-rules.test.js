#!/usr/bin/env node
// ---------------------------------------------------------------
// js/supabase-config.js 일정 계산 단일 출처 검증 (2026-10-06, 일시정지 1단계)
//   통합 전 각 화면이 쓰던 "옛 식"을 그대로 옮겨 적고, 새 함수와 결과가 같은지 확인한다.
//   동작 변경 0 원칙: 한국 시간(Asia/Seoul) 브라우저에서 옛 식 == 새 함수.
// 실행: node tests/schedule-rules.test.js
// ---------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), "utf8");
const ctx = { console, fetch: () => {}, window: {}, document: {}, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: "supabase-config.js" });

const {
  ymdToUtcDate, utcDateToYmd, ymdAddDays,
  getChallengeTaskDate, getChallengeTaskYmd, getChallengeDayDiff, getChallengeWeekRaw,
  getChallengeEndYmd, getChallengeEndDate, getCorrSession12Ymd, getCorrectionWindow, getDueTaskList
} = ctx;

const DAY = 24 * 60 * 60 * 1000;
const tzOffsetMin = new Date().getTimezoneOffset();
const isKST = tzOffsetMin === -540;
console.log(`(실행 환경 시간대 offset ${-tzOffsetMin}분 → ${isKST ? "Asia/Seoul" : "비-KST — 옛 식 일부는 시간대 의존이라 차이가 날 수 있음"})`);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n   " + (e && e.message)); }
}

// ───── 옛 식 (통합 전 코드 그대로) ─────
// admin-study-v3.js loadStudyData: new Date(ymd) + setDate(로컬)
function oldTaskDate_studyV3(startYmd, week, dayIndex) {
  const startDate = new Date(startYmd);
  const taskDate = new Date(startDate);
  taskDate.setDate(taskDate.getDate() + (week - 1) * 7 + dayIndex);
  return taskDate;
}
function oldWeek_studyV3(startYmd, today) {
  const startDate = new Date(startYmd);
  const diffDays = Math.floor((today - startDate) / DAY);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}
function oldThisWeekStart_studyV3(startYmd, currentWeek) {
  const thisWeekStart = new Date(new Date(startYmd));
  thisWeekStart.setDate(thisWeekStart.getDate() + (currentWeek - 1) * 7);
  return thisWeekStart;
}
// admin-study-detail-v3.js: setUTCDate 식
function oldTaskDate_detailV3(startDate, week, dayIndex) {
  const taskDate = new Date(startDate);
  taskDate.setUTCDate(taskDate.getUTCDate() + (week - 1) * 7 + dayIndex);
  return taskDate;
}
function oldWeekNum_detailV3(startDate, effectiveToday) {
  const diffDays = Math.floor((effectiveToday - startDate) / DAY);
  return Math.floor(diffDays / 7) + 1;
}
function oldDplus_detailV3(startDate, effectiveToday) {
  return Math.floor((effectiveToday - startDate) / DAY) + 1;
}
function oldPracticeEnd_detailV3(app) {
  const dates = [app.schedule_end, app.self_paced_end_date].filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates));
}
// dashboard.js _corrExtDeadline의 세션12 날짜(로컬 자정) 부분
function oldS12_dashboard(app) {
  return app.correction_end_date
    ? new Date(app.correction_end_date + "T00:00:00")
    : new Date(new Date(app.correction_start_date + "T00:00:00").getTime() + 25 * DAY);
}
// supabase-config.js getCorrectionWindow 옛 endYmd(종료일 칸 없을 때): 로컬 getFullYear/getMonth/getDate
function oldEndYmd_noEndCol(startYmd) {
  const start = new Date(startYmd);
  const e2 = new Date(start);
  e2.setDate(e2.getDate() + 27);
  return e2.getFullYear() + "-" + String(e2.getMonth() + 1).padStart(2, "0") + "-" + String(e2.getDate()).padStart(2, "0");
}
// admin-manage-modal.js 옛 _shiftYmd
function oldShiftYmd(ymd, days) {
  const t = new Date(ymd + "T00:00:00Z").getTime() + days * DAY;
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

// ───── 입력 조합 ─────
const starts = [
  "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", // 요일 7종
  "2026-02-28", "2026-12-28", "2027-01-01", "2026-10-25", "2026-03-29"                               // 월말·연말·DST 전환일(해외)
];
const todays = [];
for (let i = -10; i <= 70; i++) todays.push(new Date(Date.UTC(2026, 8, 6) + i * DAY));

test("1. ymd 변환: ymdToUtcDate == new Date(ymd), utcDateToYmd 왕복, ymdAddDays == 옛 _shiftYmd", () => {
  for (const s of starts) {
    assert.strictEqual(ymdToUtcDate(s).getTime(), new Date(s).getTime(), s);
    assert.strictEqual(utcDateToYmd(ymdToUtcDate(s)), s, s);
    for (const n of [-7, -1, 0, 1, 6, 7, 25, 27, 28, 55, 56, 365]) {
      assert.strictEqual(ymdAddDays(s, n), oldShiftYmd(s, n), `${s}+${n}`);
    }
  }
  assert.strictEqual(ymdToUtcDate(""), null);
  assert.strictEqual(ymdToUtcDate(null), null);
  assert.strictEqual(ymdAddDays("", 3), null);
});

test("2. 내챌 과제 날짜: 학습관리 v3 식(setDate) == 학습상세 v3 식(setUTCDate) == 새 함수 (주1~8 × 요일0~6)", () => {
  for (const s of starts) {
    const app = { schedule_start: s };
    for (let w = 1; w <= 8; w++) for (let d = 0; d <= 6; d++) {
      const nu = getChallengeTaskDate(app, w, d).getTime();
      assert.strictEqual(nu, oldTaskDate_detailV3(new Date(s), w, d).getTime(), `detail ${s} w${w} d${d}`);
      if (isKST) assert.strictEqual(nu, oldTaskDate_studyV3(s, w, d).getTime(), `studyV3 ${s} w${w} d${d}`);
      assert.strictEqual(getChallengeTaskYmd(app, w, d), utcDateToYmd(oldTaskDate_detailV3(new Date(s), w, d)));
    }
  }
});

test("3. 주차·경과일·D+: 학습관리 v3(하한 1) / 학습상세 v3(보정 없음) / D+ == 새 함수", () => {
  for (const s of starts) {
    const app = { schedule_start: s };
    for (const t of todays) {
      assert.strictEqual(Math.max(1, getChallengeWeekRaw(app, t)), oldWeek_studyV3(s, t), `studyV3 week ${s} ${t.toISOString()}`);
      assert.strictEqual(getChallengeWeekRaw(app, t), oldWeekNum_detailV3(new Date(s), t), `detail week ${s}`);
      assert.strictEqual(getChallengeDayDiff(app, t) + 1, oldDplus_detailV3(new Date(s), t), `dplus ${s}`);
      const cw = oldWeek_studyV3(s, t);
      if (isKST) assert.strictEqual(getChallengeTaskDate(app, cw, 0).getTime(), oldThisWeekStart_studyV3(s, cw).getTime(), `thisWeekStart ${s}`);
    }
  }
  assert.strictEqual(getChallengeWeekRaw({ schedule_start: "" }, todays[0]), null);
});

test("4. 내챌 종료일 3모드: status=schedule_end / display=자기주도 분기 / practice=둘 중 늦은 날(옛 getPracticeEndDate)", () => {
  const cases = [
    { schedule_end: "2026-10-03", self_paced: false, self_paced_end_date: null },
    { schedule_end: "2026-10-03", self_paced: true,  self_paced_end_date: "2026-11-15" },
    { schedule_end: "",           self_paced: true,  self_paced_end_date: "2026-11-15" },
    { schedule_end: "2026-12-01", self_paced: true,  self_paced_end_date: "2026-11-15" },
    { schedule_end: null,         self_paced: false, self_paced_end_date: null },
  ];
  for (const app of cases) {
    assert.strictEqual(getChallengeEndYmd(app, "status"), app.schedule_end);
    assert.strictEqual(getChallengeEndYmd(app, "display"), app.self_paced ? app.self_paced_end_date : app.schedule_end);
    const oldP = oldPracticeEnd_detailV3(app);
    const nuP = getChallengeEndDate(app, "practice");
    assert.strictEqual(nuP ? nuP.getTime() : null, oldP ? oldP.getTime() : null, JSON.stringify(app));
    // status 모드 Date == 옛 getAppLiveStatus의 new Date(schedule_end)
    const oldEnd = app.schedule_end ? new Date(app.schedule_end) : null;
    const nuEnd = getChallengeEndDate(app, "status");
    assert.strictEqual(nuEnd ? nuEnd.getTime() : null, oldEnd ? oldEnd.getTime() : null);
  }
});

test("5. 첨삭 12회차 날짜(대시보드 연장 마감 출처): 종료일 칸 우선, 없으면 시작+25 == 옛 식(로컬 ms 산술, KST)", () => {
  for (const s of starts) {
    for (const endCol of [null, "2026-10-20"]) {
      const app = { correction_start_date: s, correction_end_date: endCol };
      const nu = new Date(getCorrSession12Ymd(app) + "T00:00:00").getTime();
      if (isKST) assert.strictEqual(nu, oldS12_dashboard(app).getTime(), `${s} end=${endCol}`);
    }
  }
  assert.strictEqual(getCorrSession12Ymd({ correction_start_date: "" }), null);
});

test("6. getCorrectionWindow.endYmd(종료일 칸 없음) == 옛 로컬 식(KST), 종료일 칸 있으면 그 값", () => {
  for (const s of starts) {
    const w = getCorrectionWindow({ correction_start_date: s }, 1);
    if (isKST) assert.strictEqual(w.endYmd, oldEndYmd_noEndCol(s), s);
    assert.strictEqual(w.endYmd, ymdAddDays(s, 27));
    const w2 = getCorrectionWindow({ correction_start_date: s, correction_end_date: "2026-10-31" }, 1);
    assert.strictEqual(w2.endYmd, "2026-10-31");
  }
  assert.strictEqual(getCorrectionWindow({ correction_start_date: null }, 1), null);
});

test("7. getDueTaskList(옛 화면 공용): 통합 후에도 같은 과제 날짜·건수", () => {
  const sched = [
    { program: "Fast", week: 1, day: "sunday", section1: "리딩 Module 1", section2: "내벨업보카", section3: "", section4: "" },
    { program: "Fast", week: 2, day: "friday", section1: "라이팅 1", section2: "", section3: "", section4: "" },
    { program: "Fast", week: 5, day: "monday", section1: "스피킹 1", section2: "", section3: "", section4: "" },
    { program: "Standard", week: 1, day: "monday", section1: "리스닝 Module 1", section2: "", section3: "", section4: "" },
  ];
  const start = new Date("2026-09-06");
  const today = new Date(Date.UTC(2026, 8, 20));
  const list = getDueTaskList(sched, "Fast", start, today, 4);
  assert.strictEqual(list.length, 3);                       // w1 sun: 2건, w2 fri(9/18): 1건, w5 제외
  assert.strictEqual(utcDateToYmd(list[0].taskDate), "2026-09-06");
  assert.strictEqual(utcDateToYmd(list[2].taskDate), "2026-09-18");
});

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
