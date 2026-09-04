"use strict";

// 첨삭 종료일 출처 통합(getCorrectionWindow) + 입금확인 시작일 밀기 종료일 동반이동 검증.
// 브라우저 전역 함수라 module.exports가 없으므로, 소스에서 함수 텍스트만 추출해 격리 실행한다.

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; process.stdout.write("PASS " + name + "\n"); }
    catch (error) { process.stderr.write("FAIL " + name + "\n" + error.stack + "\n"); process.exitCode = 1; }
}

// function <name>(...) { ... } 를 중괄호 짝을 세어 통째로 추출
function extractFn(name, text) {
    const start = text.indexOf("function " + name);
    if (start < 0) throw new Error("함수를 찾지 못함: " + name);
    const open = text.indexOf("{", start);
    let depth = 0;
    for (let j = open; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") { depth--; if (depth === 0) return text.slice(start, j + 1); }
    }
    throw new Error("닫는 중괄호를 찾지 못함: " + name);
}

const cfgSrc = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), "utf8");
const winCode = extractFn("_correctionEndKST", cfgSrc) + "\n" + extractFn("getCorrectionWindow", cfgSrc);
const winFactory = new Function(winCode + "\nreturn { getCorrectionWindow, _correctionEndKST };");
const { getCorrectionWindow, _correctionEndKST } = winFactory();

function ymdOf(d) {
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
}

// (a) 종료일 없음 → endYmd = 시작+27, endMoment = 기존 _correctionEndKST와 동일
test("a. 종료일 없음: endMoment = _correctionEndKST(시작), endYmd = 시작+27", () => {
    const app = { correction_start_date: "2026-09-13" };
    const win = getCorrectionWindow(app, 1);
    assert.ok(win, "win이 null이면 안 됨");
    const ref = _correctionEndKST(new Date("2026-09-13"));
    assert.equal(win.endMoment.getTime(), ref.getTime(), "endMoment가 기존 계산과 동일해야 함");
    // endYmd는 endMoment(=시작+27일)의 날짜와 같아야 하고, 실제로 27일 뒤여야 함
    assert.equal(win.endYmd, ymdOf(win.endMoment));
    const back = new Date(win.endYmd + "T00:00:00");
    const startMid = new Date("2026-09-13T00:00:00");
    const days = Math.round((back - startMid) / (24 * 60 * 60 * 1000));
    assert.equal(days, 27, "종료일은 시작일 + 27일이어야 함");
});

// (b) 종료일 있음 → endYmd = 종료일, endMoment = 종료일 다음날 01:00
test("b. 종료일 있음: endYmd = 종료일, endMoment = 종료일+1일 01:00", () => {
    const app = { correction_start_date: "2026-09-13", correction_end_date: "2026-09-24" };
    const win = getCorrectionWindow(app, 1);
    assert.equal(win.endYmd, "2026-09-24");
    const e = new Date("2026-09-24");
    const expected = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1, 1, 0, 0);
    assert.equal(win.endMoment.getTime(), expected.getTime());
});

// (b-2) phase 2(연장) 종료일 있음도 같은 규칙
test("b2. phase 2: 연장 종료일 사용", () => {
    const app = { extension_start_date: "2026-11-01", extension_end_date: "2026-11-20" };
    const win = getCorrectionWindow(app, 2);
    assert.equal(win.endYmd, "2026-11-20");
    const e = new Date("2026-11-20");
    const expected = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1, 1, 0, 0);
    assert.equal(win.endMoment.getTime(), expected.getTime());
});

// (c) 시작일 없음 → null
test("c. 시작일 없음: null", () => {
    assert.equal(getCorrectionWindow({}, 1), null);
    assert.equal(getCorrectionWindow({ correction_end_date: "2026-09-24" }, 1), null);
    assert.equal(getCorrectionWindow({}, 2), null);
    assert.equal(getCorrectionWindow(null, 1), null);
});

// (d) 입금확인 시작일 밀기: correction_end_date도 같은 deltaDays로 이동
const modalSrc = fs.readFileSync(path.join(__dirname, "..", "js", "admin-manage-modal.js"), "utf8");
const shiftCode = extractFn("_kstTodayYmd", modalSrc) + "\n" +
    extractFn("_shiftYmd", modalSrc) + "\n" +
    extractFn("_computeDepositStartShift", modalSrc);
// 외부 의존(요일 계산)은 결정적 스텁으로 주입
const shiftFactory = new Function("getUpcomingSundayStr", "getThursdayCutoffMs",
    shiftCode + "\nreturn { _computeDepositStartShift, _shiftYmd };");
const { _computeDepositStartShift, _shiftYmd } = shiftFactory(
    () => "2026-09-27",              // 다가오는 일요일(고정)
    () => Number.MAX_SAFE_INTEGER    // 목요일 컷 이전 → newStart = 그 일요일
);

test("d. 입금확인 시작일 밀기: 첨삭 종료일도 동반 이동", () => {
    const app = {
        schedule_start: "2026-09-01",       // 과거 → 이동 대상
        late_start_choice: "다음주",         // 이동 보장
        correction_start_date: "2026-09-13",
        correction_end_date: "2026-09-24"
    };
    const res = _computeDepositStartShift(app);
    assert.equal(res.moved, true, "이동해야 함");
    assert.equal(res.newStart, "2026-09-27");
    const delta = Math.round(
        (new Date("2026-09-27T00:00:00Z") - new Date("2026-09-01T00:00:00Z")) / (24 * 60 * 60 * 1000)
    );
    assert.equal(res.updates.correction_start_date, _shiftYmd("2026-09-13", delta));
    assert.equal(res.updates.correction_end_date, _shiftYmd("2026-09-24", delta), "종료일이 시작일과 같은 날수만큼 이동해야 함");
    // 구체값: 26일 이동 → 9/24 → 10/20, 9/13 → 10/9
    assert.equal(res.updates.correction_end_date, "2026-10-20");
    assert.equal(res.updates.correction_start_date, "2026-10-09");
});

// (d-2) 첨삭 종료일이 없으면 종료일 이동 키가 없어야 함(무회귀)
test("d2. 종료일 없는 학생: correction_end_date 키 미생성", () => {
    const app = {
        schedule_start: "2026-09-01",
        late_start_choice: "다음주",
        correction_start_date: "2026-09-13"
    };
    const res = _computeDepositStartShift(app);
    assert.equal(res.moved, true);
    assert.equal("correction_end_date" in res.updates, false, "종료일 없으면 키 자체가 없어야 함");
});

process.stdout.write("\n" + passed + " passed\n");
