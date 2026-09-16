"use strict";

// js/deadline-rules.js 검증 — 첨삭 1차/2차 새 마감, 내챌 새 마감, 알림톡 표기·과제 라벨.
// 브라우저 전역 함수 파일이라 module.exports 가 없으므로 vm 컨텍스트에 통째로 실행해 전역 함수를 꺼내 쓴다.
// 실행: node tests/deadline-rules.test.js
// (세션 배정일은 로컬 Date 의 연·월·일만 쓰므로 실행 PC 의 시간대와 무관하다.)

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; process.stdout.write("PASS " + name + "\n"); }
    catch (error) { process.stderr.write("FAIL " + name + "\n" + error.stack + "\n"); process.exitCode = 1; }
}

const src = fs.readFileSync(path.join(__dirname, "..", "js", "deadline-rules.js"), "utf8");
const ctx = vm.createContext({});
vm.runInContext(src, ctx, { filename: "deadline-rules.js" });
const R = ctx;   // 전역 함수들

const KST = "Asia/Seoul";
// 'YYYY-MM-DD HH:MM' KST → Date
function kst(y, mo, d, h, mi) { return new Date(Date.UTC(y, mo - 1, d, h - 9, mi)); }

// ---------- 첨삭 1차 ----------
const schedGeneral = { start_date: "2026-09-06" };   // 일요일

test("1. 일반 S3: 배정일 9/10 → 원래 마감 KST 9/11 04:00 → +24h → '9/12(토) 04:00'", () => {
    const meta = R.getCorrSessionMeta(3);
    assert.equal(meta.session, 3); assert.equal(meta.phase, 1); assert.equal(meta.dayOffset, 4);
    const sd = R.getCorrSessionDate(schedGeneral, meta);
    assert.equal(sd.getMonth() + 1, 9); assert.equal(sd.getDate(), 10);

    const base = R.getCorrDraft1Deadline(sd, null, KST);
    assert.equal(base.getTime(), kst(2026, 9, 11, 4, 0).getTime(), "원래 마감 = 9/11 04:00 KST");

    // 연장 행: 마감 전(9/10 12:00 KST)에 +24h
    const row = { extended_hours: 24, created_at: kst(2026, 9, 10, 12, 0).toISOString() };
    const dl = R.getCorrDraft1Deadline(sd, R.corrExtFromRow(row), KST);
    assert.equal(dl.getTime(), kst(2026, 9, 12, 4, 0).getTime());
    assert.equal(R.formatDeadlineForAlimtalk(dl, KST), "9/12(토) 04:00");
});

test("2. 같은 사례, 연장 행 created_at 이 9/11 10:00 KST(마감 지난 뒤) → '9/12(토) 10:00'", () => {
    const sd = R.getCorrSessionDate(schedGeneral, R.getCorrSessionMeta(3));
    const row = { extended_hours: 24, created_at: kst(2026, 9, 11, 10, 0).toISOString() };
    const dl = R.getCorrDraft1Deadline(sd, R.corrExtFromRow(row), KST);
    assert.equal(dl.getTime(), kst(2026, 9, 12, 10, 0).getTime());
    assert.equal(R.formatDeadlineForAlimtalk(dl, KST), "9/12(토) 10:00");
});

// ---------- 첨삭 2차 ----------
test("3. 2차: released_1_at 2026-09-11T02:00:00Z → +24h → KST 9/12 11:00 → +12h → '9/12(토) 23:00'", () => {
    const row = { extended_hours: 12, created_at: "2026-09-11T03:00:00Z" };   // 마감(9/12 02:00Z) 전
    const dl = R.getCorrDraft2DeadlineFromRelease("2026-09-11T02:00:00Z", null, R.corrExtFromRow(row));
    assert.equal(dl.getTime(), kst(2026, 9, 12, 23, 0).getTime());
    assert.equal(R.formatDeadlineForAlimtalk(dl, KST), "9/12(토) 23:00");
});

test("3b. 2차: released_1_at 없고 feedback_1_at 만 있으면 그걸 쓰고, 둘 다 없으면 null", () => {
    const dl = R.getCorrDraft2DeadlineFromRelease(null, "2026-09-11T02:00:00Z", null);
    assert.equal(dl.getTime(), Date.UTC(2026, 8, 12, 2, 0));
    assert.equal(R.getCorrDraft2DeadlineFromRelease(null, null, { hours: 12, at: null }), null);
});

// ---------- 자기주도 ----------
test("4. 자기주도: session_dates dates[2]='2026-09-13' → S3 1차 +0h '9/14(월) 04:00', +24h '9/15(화) 04:00'", () => {
    const dates = ["2026-09-06", "2026-09-09", "2026-09-13", "2026-09-16", "2026-09-19", "2026-09-22",
                   "2026-09-25", "2026-09-28", "2026-10-01", "2026-10-04", "2026-10-07", "2026-10-10"];
    const sched = { start_date: "2026-09-06", end_date: "2026-10-10", session_dates: JSON.stringify({ start: "2026-09-06", end: "2026-10-10", dates }) };
    const sd = R.getCorrSessionDate(sched, R.getCorrSessionMeta(3));
    assert.equal(sd.getMonth() + 1, 9); assert.equal(sd.getDate(), 13, "확정 일정표의 날짜를 써야 함(start+dayOffset 아님)");

    const dl0 = R.getCorrDraft1Deadline(sd, null, KST);
    assert.equal(R.formatDeadlineForAlimtalk(dl0, KST), "9/14(월) 04:00");

    const row = { extended_hours: 24, created_at: kst(2026, 9, 13, 20, 0).toISOString() };
    const dl = R.getCorrDraft1Deadline(sd, R.corrExtFromRow(row), KST);
    assert.equal(R.formatDeadlineForAlimtalk(dl, KST), "9/15(화) 04:00");
});

test("4b. 자기주도인데 일정표(session_dates)가 없고 start_date 도 없으면 배정일 null → 1차 마감 null", () => {
    const sd = R.getCorrSessionDate({ start_date: null, end_date: "2026-10-10", session_dates: null }, R.getCorrSessionMeta(3));
    assert.equal(sd, null);
    assert.equal(R.getCorrDraft1Deadline(sd, { hours: 24, at: null }, KST), null);
});

test("4c. 연장(13~24세션): extension_start_date 기준 + dayOffset 반복(S15 → offset 4)", () => {
    const meta = R.getCorrSessionMeta(15);
    assert.equal(meta.session, 15); assert.equal(meta.phase, 2); assert.equal(meta.dayOffset, 4);
    const sd = R.getCorrSessionDate({ start_date: "2026-08-02", extension_start_date: "2026-09-06" }, meta);
    assert.equal(sd.getMonth() + 1, 9); assert.equal(sd.getDate(), 10);
});

// ---------- 호주 ----------
test("5. 호주 Australia/Sydney, S2(dayOffset 2) → 현지 다음날 04:00 → '9/9(수) 04:00 (현지 시간)'", () => {
    const tz = "Australia/Sydney";
    const sd = R.getCorrSessionDate(schedGeneral, R.getCorrSessionMeta(2));
    assert.equal(sd.getDate(), 8);
    const dl = R.getCorrDraft1Deadline(sd, null, tz);
    // 2026-09 시드니는 AEST(UTC+10) → 9/9 04:00 = 9/8 18:00Z
    // (원본 dateInTimezone 은 분 단위로만 맞추므로 초는 0이 아닐 수 있다 — 테스트룸과 동일한 동작. 분 단위로 비교)
    assert.equal(Math.floor(dl.getTime() / 60000), Math.floor(Date.UTC(2026, 8, 8, 18, 0) / 60000));
    assert.equal(R.formatDeadlineForAlimtalk(dl, tz), "9/9(수) 04:00 (현지 시간)");
});

// ---------- 내챌 ----------
test("6. 내챌: original_date 2026-09-10, Asia/Seoul, +3일 → '9/14(월) 04:00'", () => {
    const base = R.getTaskDeadline("2026-09-10", KST);
    assert.equal(base.getTime(), kst(2026, 9, 11, 4, 0).getTime());
    const dl = new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
    assert.equal(R.formatDeadlineForAlimtalk(dl, KST), "9/14(월) 04:00");
    assert.equal(R.formatTaskDateForAlimtalk("2026-09-10"), "9/10(목)");
});

test("6b. getTaskDeadline 시간대 생략 → Asia/Seoul", () => {
    assert.equal(R.getTaskDeadline("2026-09-10").getTime(), R.getTaskDeadline("2026-09-10", KST).getTime());
});

// ---------- 라벨 ----------
test("7. 라벨: 일반 S3 'Email + Interview', S4 'Discussion + Interview', 호주 S2 'INT SPK 2 + INT WRT'", () => {
    assert.equal(R.getCorrSessionTasksLabel(3, false), "Email + Interview");
    assert.equal(R.getCorrSessionTasksLabel(4, false), "Discussion + Interview");
    assert.equal(R.getCorrSessionTasksLabel(2, true), "INT SPK 2 + INT WRT");
    assert.equal(R.getCorrSessionTasksLabel(1, true), "IND SPK + DISCUSSION");
    assert.equal(R.getCorrSessionTasksLabel(5, true), "IND SPK + DISCUSSION");   // (5-1)%4 = 0
    assert.equal(R.getCorrSessionTasksLabel(4, true), "INT SPK 4 + INT WRT");
});

test("7b. 과제 목록을 거꾸로 줘도 세션 순서로 정렬, 하나만 주면 그것만", () => {
    assert.equal(R.formatCorrTasksForAlimtalk(["speaking_interview", "writing_email"], 3, false), "Email + Interview");
    assert.equal(R.formatCorrTasksForAlimtalk(["writing_aus_integrated", "speaking_aus_int2"], 2, true), "INT SPK 2 + INT WRT");
    assert.equal(R.formatCorrTasksForAlimtalk(["speaking_interview"], 3, false), "Interview");
    assert.equal(R.getCorrAlimtalkTaskLabel("writing_aus_discussion"), "DISCUSSION", "관리자 줄임말(토라)이 아니라 테스트룸 카드 글자");
});

// ---------- 표기 ----------
test("8. 표기: 자정 → '00:00', 한 자리 월/일은 0 없이", () => {
    assert.equal(R.formatDeadlineForAlimtalk(kst(2026, 1, 5, 0, 0), KST), "1/5(월) 00:00");
    assert.equal(R.formatDeadlineForAlimtalk(kst(2026, 12, 31, 23, 59), KST), "12/31(목) 23:59");
});

process.stdout.write("\n" + passed + " passed\n");
