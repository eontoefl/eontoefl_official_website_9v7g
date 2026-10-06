#!/usr/bin/env node
// ---------------------------------------------------------------
// 일정 계산 통합 전수 비교 (2026-10-06, 일시정지 1단계) — 라이브 데이터 **읽기만**(REST GET, anon 키)
//   전체 신청서(시작일 있는 것)에 대해, 통합 전 각 화면의 옛 식과 새 함수(supabase-config.js)를
//   모든 과제(주1~8×요일0~6)·모든 날짜(최소 시작일−7 ~ 최대 종료일+14, 하루 단위)로 비교한다.
//   기대: 다른 결과 0건. (한국 시간 PC에서 실행해야 옛 식과 조건이 같다.)
// 실행: node tests/schedule-rules.live-compare.mjs
// ---------------------------------------------------------------
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), "utf8");
const ctx = { console, fetch: () => {}, window: {}, document: {}, localStorage: { getItem: () => null, setItem: () => {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: "supabase-config.js" });
const C = ctx;
const DAY = 24 * 60 * 60 * 1000;
// const 선언은 vm 컨텍스트 객체에 붙지 않으므로 소스에서 직접 읽는다.
const SUPABASE_URL = /const SUPABASE_URL = '([^']+)'/.exec(src)[1];
const SUPABASE_ANON_KEY = /const SUPABASE_ANON_KEY = '([^']+)'/.exec(src)[1];

if (new Date().getTimezoneOffset() !== -540) {
  console.error("이 비교는 한국 시간(Asia/Seoul) PC에서 실행해야 합니다. 현재 offset:", -new Date().getTimezoneOffset());
  process.exit(2);
}

async function get(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
  return r.json();
}

const apps = await get("applications",
  "select=id,name,schedule_start,schedule_end,self_paced,self_paced_end_date,correction_enabled,correction_start_date,correction_end_date,extension_start_date,extension_end_date,app_status,deposit_confirmed_by_admin,deleted" +
  "&schedule_start=not.is.null&limit=2000");
const targets = apps.filter(a => a.schedule_start && String(a.schedule_start).trim() !== "");
console.log(`신청서 ${apps.length}건 중 시작일 있는 ${targets.length}건 비교`);

// ───── 옛 식 (통합 전 코드 그대로) ─────
const oldStudyV3Task = (s, w, d) => { const t = new Date(new Date(s)); t.setDate(t.getDate() + (w - 1) * 7 + d); return t; };
const oldStudyV3Week = (s, today) => Math.max(1, Math.floor(Math.floor((today - new Date(s)) / DAY) / 7) + 1);
const oldStudyV3WeekStart = (s, cw) => { const t = new Date(new Date(s)); t.setDate(t.getDate() + (cw - 1) * 7); return t; };
const oldDetailTask = (s, w, d) => { const t = new Date(new Date(s)); t.setUTCDate(t.getUTCDate() + (w - 1) * 7 + d); return t; };
const oldDetailWeek = (s, today) => Math.floor(Math.floor((today - new Date(s)) / DAY) / 7) + 1;
const oldDetailDplus = (s, today) => Math.floor((today - new Date(s)) / DAY) + 1;
const oldPracticeEnd = (a) => { const ds = [a.schedule_end, a.self_paced_end_date].filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d)); return ds.length ? new Date(Math.max(...ds)) : null; };
const oldDisplayEnd = (a) => a.self_paced ? a.self_paced_end_date : a.schedule_end;
const oldLiveStatus = (a, today) => {
  if (a.app_status === "refunded") return "refunded";
  if (a.app_status === "dropped") return "dropped";
  if (!a.deposit_confirmed_by_admin) return null;
  const start = a.schedule_start ? new Date(a.schedule_start) : null;
  const end = a.schedule_end ? new Date(a.schedule_end) : null;
  if (!start) return null;
  if (today < start) return "ready";
  if (end && today >= end) return "completed";
  return "active";
};
const oldS12 = (a) => a.correction_end_date ? new Date(a.correction_end_date + "T00:00:00") : new Date(new Date(a.correction_start_date + "T00:00:00").getTime() + 25 * DAY);
const oldEndYmdNoCol = (s) => { const e2 = new Date(new Date(s)); e2.setDate(e2.getDate() + 27); return e2.getFullYear() + "-" + String(e2.getMonth() + 1).padStart(2, "0") + "-" + String(e2.getDate()).padStart(2, "0"); };

// getAppLiveStatus 새 함수는 getEffectiveToday()를 내부에서 부르므로, today를 바꿔 가며 비교하기 위해 잠시 바꿔친다.
const realGetEffectiveToday = C.getEffectiveToday;

const diffs = [];
// vm 컨텍스트의 Date는 다른 realm이라 instanceof가 false → getTime 유무로 판정
const t = (s) => (s && typeof s.getTime === "function" ? s.getTime() : s);
function cmp(label, app, oldV, newV) {
  if (t(oldV) !== t(newV) && !(oldV == null && newV == null)) diffs.push({ label, app: app.id, name: app.name, old: oldV, new: newV });
}

let minStart = Infinity, maxEnd = -Infinity;
for (const a of targets) {
  const s = C.ymdToUtcDate(a.schedule_start); if (!s) continue;
  minStart = Math.min(minStart, s.getTime());
  const e = C.getChallengeEndDate(a, "practice") || s;
  maxEnd = Math.max(maxEnd, e.getTime() + 56 * DAY);
}
const days = [];
for (let x = minStart - 7 * DAY; x <= maxEnd + 14 * DAY; x += DAY) days.push(new Date(x));
console.log(`날짜 범위 ${new Date(minStart - 7 * DAY).toISOString().slice(0, 10)} ~ ${new Date(maxEnd + 14 * DAY).toISOString().slice(0, 10)} (${days.length}일)`);

let checks = 0;
for (const a of targets) {
  // 과제 날짜 (오늘 무관)
  for (let w = 1; w <= 8; w++) for (let d = 0; d <= 6; d++) {
    const nu = C.getChallengeTaskDate(a, w, d);
    cmp(`task(studyV3) w${w}d${d}`, a, oldStudyV3Task(a.schedule_start, w, d), nu);
    cmp(`task(detailV3) w${w}d${d}`, a, oldDetailTask(a.schedule_start, w, d), nu);
    checks += 2;
  }
  // 종료일
  cmp("practiceEnd", a, oldPracticeEnd(a), C.getChallengeEndDate(a, "practice"));
  cmp("displayEnd", a, oldDisplayEnd(a), C.getChallengeEndYmd(a, "display"));
  cmp("statusEnd", a, a.schedule_end ? new Date(a.schedule_end) : null, C.getChallengeEndDate(a, "status"));
  checks += 3;
  // 첨삭
  if (a.correction_start_date) {
    cmp("corrS12", a, oldS12(a), new Date(C.getCorrSession12Ymd(a) + "T00:00:00"));
    const w1 = C.getCorrectionWindow(a, 1);
    cmp("corrEndYmd1", a, a.correction_end_date ? a.correction_end_date : oldEndYmdNoCol(a.correction_start_date), w1 && w1.endYmd);
    checks += 2;
    if (a.extension_start_date) {
      const w2 = C.getCorrectionWindow(a, 2);
      cmp("corrEndYmd2", a, a.extension_end_date ? a.extension_end_date : oldEndYmdNoCol(a.extension_start_date), w2 && w2.endYmd);
      checks++;
    }
  }
  // 오늘 의존
  for (const today of days) {
    cmp("week(studyV3)", a, oldStudyV3Week(a.schedule_start, today), Math.max(1, C.getChallengeWeekRaw(a, today)));
    cmp("week(detailV3)", a, oldDetailWeek(a.schedule_start, today), C.getChallengeWeekRaw(a, today));
    cmp("dplus", a, oldDetailDplus(a.schedule_start, today), C.getChallengeDayDiff(a, today) + 1);
    const cw = oldStudyV3Week(a.schedule_start, today);
    cmp("thisWeekStart", a, oldStudyV3WeekStart(a.schedule_start, cw), C.getChallengeTaskDate(a, cw, 0));
    C.getEffectiveToday = () => today;
    const ls = C.getAppLiveStatus(a);
    cmp("liveStatus", a, oldLiveStatus(a, today), ls ? ls.key : null);
    C.getEffectiveToday = realGetEffectiveToday;
    checks += 5;
  }
}

console.log(`비교 ${checks.toLocaleString()}건, 다른 결과 ${diffs.length}건`);
if (diffs.length) {
  console.table(diffs.slice(0, 50));
  process.exit(1);
}
console.log("PASS — 통합 전후 전체 학생 날짜 동일");
