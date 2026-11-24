// 계약 3C-2a 의 회귀시험: 회원 자격으로 읽는 구조 + 성적 이력 읽기 하나(my-scores).
// run.mjs 가 이어서 돌린다(따로 돌릴 때: node tests/auth-session/run-member.mjs).
//
// 전부 가짜다: 화면의 HTML 로 만든 가짜 DOM·가짜 저장소·가짜 시계·가짜 서버(성적 표의 "규칙"도 흉내다). 실제 네트워크 요청은 0건이고,
// 여기서 통과한 것은 "실제 브라우저·실제 서버에서 된다"의 증거가 아니다. **이 조각은 보호가 아니다** — 성적 표에는 익명 역할의
// 전체 허용 규칙이 남아 있다(가짜 세계도 그렇게 답한다).
//
// 시험이 기대하는 "나가야 하는 요청"의 글자는 여기(member-world.mjs)에 따로 적어 둔 것이다 — 제품의 규약표를 읽지 않는다.

import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installNetworkGuard, realNetworkAttempts } from '../supabase-config-headers/harness.mjs';
import { TEST_URL, AUTH_FILE, switchValue, memberTaskValue } from './rewrite.mjs';
import { V, ACCOUNTS, FAKE_ANON, snapshot, diffSnapshot, checker, workFile } from './world.mjs';
import { openPage, fire } from './pages-dom.mjs';
import { memberWorld, memberOf, memberScoresUrl, wrapperScoresPath, scoreRequests, credOf, SCORE_COLUMNS, SCORE_TABLE } from './member-world.mjs';
import { fakeJwt } from './fake-supabase.mjs';
import { makePeople } from './business-fake.mjs';
import os from 'node:os';
import path from 'node:path';

const A = ACCOUNTS.A;
const B = ACCOUNTS.B;
const FORM = 'application-form.html';
const FORM_FILE = 'js/application-form.js';
const REF = '5528bea';                                        // 3C-1 이 인수된 커밋(이 조각의 기준)
const REF_OFF = { base: true, rev: REF, test: true };
const REF_ON = { base: true, rev: REF, test: true, on: true };
const PAGE_ON_MODULE_OFF = { test: true, pageSwitch: 'on' };
const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token';
const PROFILE = 'POST /rest/v1/rpc/my_profile';
const ACCESS = 'POST /rest/v1/rpc/my_site_access';
const json = (status, body) => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- 화면에서 꺼내 보는 것 ----
const UI = `JSON.stringify({
    btn: !!document.getElementById('restartLoadHistoryBtn'),
    yes: !!(document.querySelector('input[name="has_toefl_score"][value="yes"]') || {}).checked,
    total: String((document.querySelector('input[name="score_total_new"]') || {}).value),
    reading: String((document.querySelector('input[name="score_reading_new"]') || {}).value),
    listening: String((document.querySelector('input[name="score_listening_new"]') || {}).value),
    speaking: String((document.querySelector('input[name="score_speaking_new"]') || {}).value),
    writing: String((document.querySelector('input[name="score_writing_new"]') || {}).value),
    hist: String((document.querySelector('textarea[name="score_history"]') || {}).value),
    notice: !!document.getElementById('eonLoginNotice')
})`;
const ui = (page) => JSON.parse(page.evaluate(UI));
const statusOf = (page) => page.evaluate("typeof EonAuth === 'object' && typeof EonAuth.memberReadStatus === 'function' ? EonAuth.memberReadStatus('my-scores') : null");
const stateOf = (page) => page.evaluate("typeof EonAuth === 'object' ? EonAuth.state() : 'none'");
const alertsOf = (page) => page.trace.filter((e) => e.t === 'alert').length;
const navsOf = (page) => page.trace.filter((e) => e.t === 'nav' || e.t === 'reload').map((e) => (e.t === 'reload' ? '[새로 고침]' : e.to));
const pathOf = (r) => r.url.replace(/^https:\/\/[^/]+/, '');
const isAuthUrl = (url) => url.startsWith(TEST_URL + '/auth/v1/') || url === TEST_URL + '/rest/v1/rpc/my_profile' || url === TEST_URL + '/rest/v1/rpc/my_site_access';
const kinds = (w, page) => scoreRequests(w, page).map((r) => credOf(w, r));
// 불러오기 버튼을 누른 뒤의 글(성적 이력이 그 글에 들어간다)
async function historyText(w, page) {
    if (!page.byId.restartLoadHistoryBtn) return null;
    const before = ui(page).hist;
    await fire(w, page, page.byId.restartLoadHistoryBtn, 'click');
    const after = ui(page).hist;
    page.evaluate(`(document.querySelector('textarea[name="score_history"]') || {}).value = ${JSON.stringify(before)}`);
    return after;
}
// 화면 안에서 약속을 돌리고 그 결과(글자)를 꺼낸다
async function evalAsync(w, page, expr) {
    page.evaluate(`window.__zzOut = undefined; (${expr}).then(function (r) { window.__zzOut = 'OK:' + JSON.stringify(r === undefined ? null : r); }, function (e) { window.__zzOut = 'ERR:' + String(e && e.code); })`);
    await w.browser.idle();
    return page.evaluate('window.__zzOut');
}
// 확인된 회원으로 재시작 신청 화면을 연다(성적 이력 읽기까지 끝낸다)
async function openAs(key, variant, opt = {}, more = {}) {
    const w = memberWorld(variant, Object.assign({ mutate: opt.mutate }, more.world || {}));
    if (more.prepare) more.prepare(w);
    const sess = key ? w.seed(key, more.seed) : null;
    const page = await openPage(w, 't1', FORM, {});
    await w.browser.advance(2500);
    return { w, page, sess };
}
// 성적 응답을 붙잡은 채로 연다. release(응답 또는 null) 로 푼다
async function openHeld(key, opt = {}, more = {}) {
    const w = memberWorld(V.ON_OPEN, Object.assign({ mutate: opt.mutate }, more.world || {}));
    const sess = w.seed(key);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let n = 0;
    w.scoreFault = (req) => (++n === 1 ? gate : (more.later ? more.later(req, n) : null));
    const page = await openPage(w, 't1', FORM, { noIdle: true });
    await w.browser.spin(300);
    return { w, page, sess, release: async (answer) => { release(answer === undefined ? null : answer); await w.browser.idle(); await w.browser.advance(1500); } };
}
const TYPED = { hist: 'zz 학생이 적던 값', total: '5.5' };
function typeValues(page) {
    page.evaluate(`document.querySelector('textarea[name="score_history"]').value = ${JSON.stringify(TYPED.hist)}; document.querySelector('input[name="score_total_new"]').value = ${JSON.stringify(TYPED.total)};`);
}
const typedKept = (u) => u.hist === TYPED.hist && u.total === TYPED.total && u.reading === '' && u.listening === '' && u.speaking === '' && u.writing === '' && u.yes === false;

// 꺼진 화면의 결과(같은 합성 자료) — 판정 (ii)의 견줄 대상
async function offResult(key, opt = {}, more = {}) {
    const w = memberWorld(V.OFF_T, Object.assign({ old: key }, more.world || {}));
    if (more.prepare) more.prepare(w);
    const page = await openPage(w, 't1', FORM, {});
    await w.browser.advance(2500);
    return { w, page, ui: ui(page), history: await historyText(w, page) };
}

// =====================================================================
// 1. 열림: 확인 뒤에만, 회원 자격으로, 규약의 모양 그대로 — 그 밖의 요청은 3C-1 의 켜짐과 같다. 화면 결과는 꺼짐과 같다
// =====================================================================
async function testOpenRead(opt) {
    const c = checker();
    {   // 확인 전: 성적 요청 0 → 확인 뒤: A 의 JWT 로 한 번
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate });
        const sess = w.seed('A');
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        w.server.faults.my_site_access = () => gate.then(() => null);
        const page = await openPage(w, 't1', FORM, { noIdle: true });
        await w.browser.spin(200);
        c.ok(stateOf(page) === 'restoring' && scoreRequests(w).length === 0, `열림(A): 확인 전에 성적 요청이 나감(${scoreRequests(w).length}건, ${stateOf(page)})`);
        release();
        delete w.server.faults.my_site_access;
        await w.browser.idle();
        await w.browser.advance(2500);
        const reqs = scoreRequests(w, page);
        const member = reqs.filter((r) => credOf(w, r).kind === 'member');
        c.ok(reqs.filter((r) => credOf(w, r).kind !== 'member').length === 0, `열림(A): 공개 키(또는 다른 자격)로 성적 요청이 나감(${reqs.filter((r) => credOf(w, r).kind !== 'member').length}건)`);
        c.ok(member.length === 1, `열림(A): 회원 자격의 성적 요청이 1건이 아님(${member.length}건)`);
        if (member.length === 1) {
            const r = member[0];
            const cr = credOf(w, r);
            c.ok(r.url === memberScoresUrl('m-A'), `열림(A): 요청의 글자가 시험이 따로 적어 둔 모양과 다름(${pathOf(r).slice(0, 160)})`);
            c.ok(r.method === 'GET' && r.bodyText === null, '열림(A): 메서드가 GET 이 아니거나 본문이 있음');
            c.ok(cr.authId === A.authId && cr.sid === sess.sid, '열림(A): 실린 JWT 가 A 의 그 로그인 기록의 것이 아님');
            const names = r.headers.map(([n]) => n.toLowerCase()).sort().join(',');
            const apikey = r.headers.find(([n]) => n.toLowerCase() === 'apikey');
            c.ok(names === 'apikey,authorization,content-type' && apikey && apikey[1] === FAKE_ANON, `열림(A): 머리글이 apikey·Authorization·Content-Type 셋이 아님(${names})`);
            c.ok(r.redirect === 'error' && r.credentials === 'omit', '열림(A): 리디렉션을 따라가거나 쿠키를 싣는 설정');
            const order = w.browser.requests.filter((x) => x.page === 't1').map((x) => x.url);
            c.ok(order.indexOf(r.url) > order.lastIndexOf(TEST_URL + '/rest/v1/rpc/my_site_access'), '열림(A): 성적 요청이 확인(my_profile·my_site_access)보다 먼저 나감');
        }
        c.ok(statusOf(page) === 'ok', `열림(A): 결과의 상태가 ok 가 아님(${statusOf(page)})`);
        // 회원 JWT 는 인증 모듈의 다섯 요청과 그 성적 요청 하나에만 실린다
        for (const r of w.browser.requests) {
            if (credOf(w, r).kind === 'member') c.ok(isAuthUrl(r.url) || r.url === memberScoresUrl('m-A'), `열림(A): 회원 자격이 허용 밖의 요청에 실림(${pathOf(r).slice(0, 60)})`);
        }
        c.ok(w.outside.length === 0 && w.server.foreign.length === 0, '열림(A): 시험 출처 밖으로 나간 요청이 있음');
        // 판정 (ii): 화면 결과가 같은 합성 자료의 꺼짐 결과와 같다
        const off = await offResult('A');
        const on = { ui: ui(page), history: await historyText(w, page) };
        c.ok(JSON.stringify(on.ui) === JSON.stringify(off.ui), `열림(A): 미리 채움·버튼이 꺼짐의 결과와 다름(${JSON.stringify(on.ui)} ↔ ${JSON.stringify(off.ui)})`);
        c.ok(on.history !== null && on.history === off.history, '열림(A): 불러오기 글이 꺼짐의 결과와 다름');
        c.ok(off.ui.total === '4' && off.ui.reading === '4.5' && /2031-03-13/.test(String(off.history)) && /2031-01-11/.test(String(off.history)), `열림(A): 시험의 대조 — 꺼짐의 결과에 A 의 합성 성적이 없음(${JSON.stringify(off.ui)})`);
        c.ok(!/2031-02-12/.test(String(on.history)), '열림(A): A 의 화면에 B 의 성적이 들어감');
        // 돌려주는 것: 상태와 행(규약의 열)만. 머리글·JWT 없음
        const direct = await evalAsync(w, page, "EonAuth.memberRead('my-scores')");
        let got = null;
        try { got = JSON.parse(String(direct).replace(/^OK:/, '')); } catch (e) { got = null; }
        c.ok(!!got && got.status === 'ok' && Array.isArray(got.rows) && got.rows.length === 2 && JSON.stringify(Object.keys(got).sort()) === '["rows","status"]', `전송 담당 함수: 돌려준 것이 { status, rows } 가 아님(${String(direct).slice(0, 80)})`);
        if (got && Array.isArray(got.rows) && got.rows[0]) c.ok(JSON.stringify(Object.keys(got.rows[0])) === JSON.stringify(SCORE_COLUMNS), `전송 담당 함수: 행에 규약의 열이 아닌 것이 있음(${Object.keys(got.rows[0]).join(',')})`);
        c.ok(!/Bearer|eyJ|apikey|authorization/i.test(String(direct)), '전송 담당 함수: 돌려준 것에 자격이 들어 있음');
    }
    {   // 서버가 규약 밖의 열을 더 줘도 넘기지 않는다
        const x = await openAs('A', V.ON_OPEN, opt, { prepare: (w) => { w.scoreFault = () => json(200, [{ test_date: '2031-03-13', reading: 4.5, listening: 3.5, speaking: 2.5, writing: 5.5, overall: 4, legacy_total: 81, memo: 'zz-extra', user_id: 'm-A' }]); } });
        const direct = await evalAsync(x.w, x.page, "EonAuth.memberRead('my-scores')");
        c.ok(/^OK:/.test(String(direct)) && !/zz-extra|user_id/.test(String(direct)), '전송 담당 함수: 서버가 더 준 열(규약 밖)을 호출자에게 넘김');
    }
    {   // 그 밖의 요청은 3C-1 의 켜짐(닫힘)과 같다: 성적 요청 말고는 자격·차례·횟수 불변
        const rest = (x) => x.w.browser.requests.filter((r) => !r.url.includes('/rest/v1/' + SCORE_TABLE)).map((r) => `${r.method} ${pathOf(r)} ${credOf(x.w, r).kind}`);
        const closed = await openAs('A', V.ON, opt);
        const open = await openAs('A', V.ON_OPEN, opt);
        c.ok(JSON.stringify(rest(closed)) === JSON.stringify(rest(open)), '열림(A): 성적 요청 말고 다른 요청이 닫힘(3C-1 의 켜짐)과 다름');
    }
    {   // B: 조건의 값이 B 의 회원번호, A 의 행 0
        const x = await openAs('B', V.ON_OPEN, opt);
        const reqs = scoreRequests(x.w, x.page);
        c.ok(reqs.length === 1 && reqs[0].url === memberScoresUrl('m-B') && credOf(x.w, reqs[0]).authId === B.authId, `열림(B): B 의 회원번호·B 의 JWT 로 한 번이 아님(${reqs.length}건)`);
        const off = await offResult('B');
        const hist = await historyText(x.w, x.page);
        c.ok(statusOf(x.page) === 'ok' && JSON.stringify(ui(x.page)) === JSON.stringify(off.ui) && hist === off.history, '열림(B): 화면 결과가 꺼짐의 결과와 다름');
        c.ok(ui(x.page).total === '2' && /2031-02-12/.test(String(hist)) && !/2031-03-13|2031-01-11/.test(String(hist)), '열림(B): B 의 화면에 B 의 성적이 없거나 A 의 성적이 들어감');
    }
    {   // 성적 0건 회원(GM — 6자리 전): ok·0건, 미리 채움 없음, 꺼짐과 같음
        const x = await openAs('GM', V.ON_OPEN, opt);
        const reqs = scoreRequests(x.w, x.page);
        const off = await offResult('GM');
        const u = ui(x.page);
        c.ok(reqs.length === 1 && reqs[0].url === memberScoresUrl('m-GM') && statusOf(x.page) === 'ok', `열림(0건 회원): 한 번 읽어 ok 가 아님(${reqs.length}건, ${statusOf(x.page)})`);
        c.ok(u.btn === true && u.yes === false && u.total === '' && u.reading === '', `열림(0건 회원): 미리 채움이 있음(${JSON.stringify(u)})`);
        c.ok(JSON.stringify(u) === JSON.stringify(off.ui) && (await historyText(x.w, x.page)) === off.history, '열림(0건 회원): 화면 결과가 꺼짐의 결과와 다름');
    }
    return c.problems;
}

// =====================================================================
// 2. 스위치의 조합 넷 + 저장소의 값
// =====================================================================
async function testSwitchMatrix(opt) {
    const c = checker();
    {   // 저장소의 값: 새 로그인 꺼짐, my-scores 닫힘
        const text = opt.mutate ? opt.mutate(AUTH_FILE, workFile(AUTH_FILE)) : workFile(AUTH_FILE);
        c.ok(switchValue(text) === 'off', '저장소의 값: 새 로그인 스위치가 꺼짐이 아님');
        c.ok(memberTaskValue(text) === 'false', `저장소의 값: 업무 규약의 my-scores 가 닫힘이 아님(${memberTaskValue(text)})`);
        const code = text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        c.ok((code.match(/open: (true|false)/g) || []).length === 1, '저장소의 값: 열림 칸이 규약의 그 업무 한 곳이 아님');
        if (c.problems.length) return c.problems;
    }
    const even = (s) => Object.assign({}, s, { storageLog: s.storageLog.map((e) => (/^lswt-/.test(e.key) ? Object.assign({}, e, { key: 'lswt-*' }) : e)) });
    const snap = async (variant, how, key, mutate) => {
        const w = memberWorld(variant, { mutate, old: how === 'old' ? key : null });
        if (how === 'seed' && key) w.seed(key);
        const page = await openPage(w, 't1', FORM, {});
        await w.browser.advance(2500);
        return { w, page, snap: even(snapshot(w, page)) };
    };
    // (1) 꺼짐: 요청·저장소·이동·안내가 기준(14455ae)·3C-1 의 꺼짐(5528bea)과 같다 — 성적 요청은 공개 키, 글자까지 같다
    for (const key of ['A', 'GM']) {
        const base = await snap(V.BASE_T, 'old', key);
        const ref = await snap(REF_OFF, 'old', key);
        const now = await snap(V.OFF_T, 'old', key, opt.mutate);
        for (const d of diffSnapshot(base.snap, now.snap)) c.problems.push(`꺼짐(${key}): 기준(14455ae)과 다름 — ${d}`);
        for (const d of diffSnapshot(ref.snap, now.snap)) c.problems.push(`꺼짐(${key}): 3C-1 의 꺼짐(${REF})과 다름 — ${d}`);
        const reqs = scoreRequests(now.w, now.page);
        c.ok(reqs.length === 1 && credOf(now.w, reqs[0]).kind === 'anon' && pathOf(reqs[0]) === wrapperScoresPath(memberOf(key).id), `꺼짐(${key}): 성적 요청이 "공개 키로, 지금과 글자까지 같은 요청 한 번"이 아님(${reqs.length}건)`);
        c.ok(scoreRequests(base.w, base.page).length === 1, `꺼짐(${key}): 시험의 대조 — 기준이 성적 요청을 보내지 않음`);
    }
    // (2) 3C-1 켜짐 + 2a 닫힘 = 3C-1 의 켜짐 그대로: 확인 뒤 공개 키로 지금과 같은 조회, 회원 자격의 성적 요청 0
    for (const key of ['A', 'B', null]) {
        const ref = await snap(REF_ON, 'seed', key);
        const now = await snap(V.ON, 'seed', key, opt.mutate);
        for (const d of diffSnapshot(ref.snap, now.snap)) c.problems.push(`켜짐 + 닫힘(${key || '방문자'}): 3C-1 의 켜짐(${REF})과 다름 — ${d}`);
        const ks = kinds(now.w, now.page);
        c.ok(ks.filter((k) => k.kind === 'member').length === 0, `켜짐 + 닫힘(${key || '방문자'}): 회원 자격의 성적 요청이 나감`);
        if (key) {
            const reqs = scoreRequests(now.w, now.page);
            c.ok(reqs.length === 1 && ks[0].kind === 'anon' && pathOf(reqs[0]) === wrapperScoresPath(memberOf(key).id), `켜짐 + 닫힘(${key}): 확인 뒤 공개 키로 한 번이 아님(${reqs.length}건)`);
            c.ok(statusOf(now.page) === null, `켜짐 + 닫힘(${key}): 전송 담당 함수가 불림(${statusOf(now.page)})`);
        }
    }
    {   // 닫힌 업무·규약에 없는 업무는 전송 담당 함수가 받지 않는다(요청 0)
        const x = await openAs('A', V.ON, opt);
        const before = x.w.browser.requests.length;
        const closed = await evalAsync(x.w, x.page, "EonAuth.memberRead('my-scores')");
        c.ok(closed === 'ERR:task_not_allowed' && x.w.browser.requests.length === before, `켜짐 + 닫힘: 닫힌 업무를 전송 담당 함수가 받아 줌(${closed})`);
        c.ok(x.page.evaluate("EonAuth.memberTaskOpen('my-scores')") === false, '켜짐 + 닫힘: 업무가 열린 것으로 보임');
        const y = await openAs('A', V.ON_OPEN, opt);
        const n0 = y.w.browser.requests.length;
        for (const name of ['my-score', 'toefl_actual_scores', 'users', '', '__proto__', 'constructor']) {
            const r = await evalAsync(y.w, y.page, `EonAuth.memberRead(${JSON.stringify(name)})`);
            c.ok(r === 'ERR:task_not_allowed', `열림: 규약에 없는 업무 이름(${name || '빈 글자'})을 받아 줌(${String(r).slice(0, 40)})`);
        }
        const r2 = await evalAsync(y.w, y.page, "EonAuth.memberRead('my-scores', { user_id: 'm-B', select: '*' })");
        c.ok(y.w.browser.requests.length === n0 + 1 && scoreRequests(y.w, y.page).every((r) => r.url === memberScoresUrl('m-A')) && /^OK:/.test(String(r2)), '열림: 호출이 넘긴 값이 요청에 들어감(또는 규약에 없는 이름이 요청을 냄)');
        c.ok(y.page.evaluate("EonAuth.memberTaskOpen('my-scores')") === true && y.page.evaluate("EonAuth.memberTaskOpen('users')") === false, '열림: 열린 업무의 판정이 기대와 다름');
    }
    // (3) 켜짐인데 확인할 수 없음 + 열림: 성적 요청 0(공개 키로도 보내지 않는다)
    const none = async (label, make) => {
        const { w, page } = await make();
        c.ok(scoreRequests(w).length === 0, `확인할 수 없음(${label}): 성적 요청이 나감(${kinds(w).map((k) => k.kind).join(',')})`);
        return { w, page };
    };
    await none('방문자', async () => openAs(null, V.ON_OPEN, opt));
    for (const key of ['BLK', 'WD', 'N']) await none(key, async () => openAs(key, V.ON_OPEN, opt));
    await none('끝난 로그인 기록', async () => {
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate });
        w.server.endSession(w.seed('A', { expiresIn: -10 }), 'session_not_found');
        const page = await openPage(w, 't1', FORM, {});
        await w.browser.advance(2500);
        return { w, page };
    });
    await none('옛 값만 있음', async () => {
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate, old: 'A' });
        const page = await openPage(w, 't1', FORM, {});
        await w.browser.advance(2500);
        return { w, page };
    });
    await none('모듈을 받지 못한 켜진 화면', async () => {
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate, old: 'A' });
        w.seed('A');
        const page = await openPage(w, 't1', FORM, { dropScript: AUTH_FILE });
        await w.browser.advance(2500);
        return { w, page };
    });
    {   // 모듈을 받지 못한 켜진 화면에서 성적 이력의 코드가 불려도(그 화면은 방문자 화면이라 스스로는 부르지 않는다) 성적 요청은 나가지 않는다
        for (const [label, variant, drop] of [['모듈 없음', V.ON_OPEN, AUTH_FILE], ['화면 켜짐 + 모듈 꺼짐', PAGE_ON_MODULE_OFF, null]]) {
            const w = memberWorld(variant, { mutate: opt.mutate, old: 'A' });
            const page = await openPage(w, 't1', FORM, drop ? { dropScript: drop } : {});
            await w.browser.advance(1500);
            page.evaluate("applicationState.user = { id: 'm-A', email: 'x' }; setupRestartHistory({});");
            await w.browser.idle();
            await w.browser.advance(1500);
            c.ok(page.evaluate('EonLogin.on() && EonLogin.missing()') === true, `확인할 수 없음(${label}): 시험이 그 화면을 만들지 못함`);
            c.ok(scoreRequests(w).length === 0, `확인할 수 없음(${label} — 성적 이력의 코드를 직접 부름): 성적 요청이 나감(${kinds(w).map((k) => k.kind).join(',')})`);
        }
    }
    {   // 시험의 대조(양성): 같은 화면·같은 가짜 세계에서 확인된 A 는 성적 요청을 낸다
        const x = await openAs('A', V.ON_OPEN, opt);
        c.ok(scoreRequests(x.w, x.page).length >= 1, '확인할 수 없음: 시험의 대조 — 확인된 A 도 성적 요청을 내지 않음(위의 "0건"이 화면이 돌지 않아서일 수 있다)');
    }
    return c.problems;
}

// =====================================================================
// 3. 기존의 두 함수(headersForGrade·credentialFor)로는 성적 표에 쓸 회원 머리글을 얻을 수 없다
// =====================================================================
async function testTwoFunctions(opt) {
    const c = checker();
    const x = await openAs('A', V.ON_OPEN, opt);
    const p = x.page;
    c.ok(stateOf(p) === 'signed_in' && statusOf(p) === 'ok', `두 함수: 시험이 확인된 A 의 화면을 만들지 못함(${stateOf(p)}·${statusOf(p)})`);
    const thrown = (expr) => p.evaluate(`(function () { try { var r = ${expr}; return 'RETURNED:' + JSON.stringify(Object.keys(r || {})); } catch (e) { return 'THROWN:' + String(e && e.code); } })()`);
    for (const grade of ['member', 'admin']) {
        c.ok(thrown(`EonAuth.headersForGrade(${JSON.stringify(grade)})`) === 'THROWN:grade_closed', `두 함수: headersForGrade 의 ${grade} 등급이 머리글을 내줌(${thrown(`EonAuth.headersForGrade(${JSON.stringify(grade)})`)})`);
        c.ok(thrown(`EonAuth.headersForGrade(${JSON.stringify(grade)}, { Prefer: 'count=exact' })`) === 'THROWN:grade_closed', `두 함수: headersForGrade 의 ${grade} 등급이 머리글을 내줌(추가 머리글과 함께)`);
    }
    const urls = [memberScoresUrl('m-A'), TEST_URL + wrapperScoresPath('m-A'), TEST_URL + '/rest/v1/' + SCORE_TABLE, TEST_URL + '/rest/v1/' + SCORE_TABLE + '?select=*', TEST_URL + '/rest/v1/'];
    for (const url of urls) {
        for (const method of ['GET', 'POST']) {
            const r = await evalAsync(x.w, p, `EonAuth.credentialFor('member', ${JSON.stringify(url)}, ${JSON.stringify(method)})`);
            c.ok(r === 'ERR:target_not_allowed', `두 함수: credentialFor 가 성적 표의 주소(${url.replace(TEST_URL, '').slice(0, 50)} · ${method})에 회원 자격을 내줌(${String(r).slice(0, 30)})`);
        }
    }
    const admin = await evalAsync(x.w, p, `EonAuth.credentialFor('admin', ${JSON.stringify(memberScoresUrl('m-A'))}, 'GET')`);
    c.ok(admin === 'ERR:grade_closed', '두 함수: credentialFor 의 관리자 등급이 열림');
    // 3A 의 인수 범위는 그대로: 두 확인 요청의 주소에는 지금처럼 내준다(값은 찍지 않는다)
    const own = await evalAsync(x.w, p, `EonAuth.credentialFor('member', ${JSON.stringify(TEST_URL + '/rest/v1/rpc/my_profile')}, 'POST').then(function (r) { return Object.keys(r).sort(); })`);
    c.ok(own === 'OK:["apikey","authorization"]', `두 함수: 3A 의 대상(my_profile)에 대한 credentialFor 가 달라짐(${String(own).slice(0, 40)})`);
    // 내보내는 이름: 3C-1 의 것에 셋(업무가 열렸는가·전송 담당 함수·마지막 상태)만 더해졌다 — 머리글·JWT 를 내주는 새 이름 없음
    const names = JSON.parse(p.evaluate('JSON.stringify(Object.keys(EonAuth).sort())'));
    const ref = memberWorld(REF_ON, {});
    ref.seed('A');
    const refPage = await openPage(ref, 't1', FORM, {});
    await ref.browser.advance(1500);
    const before = JSON.parse(refPage.evaluate('JSON.stringify(Object.keys(EonAuth).sort())'));
    const added = names.filter((n) => !before.includes(n)).sort();
    c.ok(JSON.stringify(added) === '["memberRead","memberReadStatus","memberTaskOpen"]' && before.every((n) => names.includes(n)), `두 함수: 인증 모듈이 내보내는 이름이 "3C-1 의 것 + 셋"이 아님(더해진 것: ${added.join(',')})`);
    c.ok(typeof p.evaluate("EonAuth.memberReadStatus('my-scores')") === 'string' && p.evaluate("EonAuth.memberReadStatus('toString')") === null, '두 함수: 마지막 상태가 상태 이름(글자)이 아님');
    c.ok(p.evaluate("EonAuth.memberTaskOpen('my-scores')") === true, '두 함수: 열림의 판정이 참·거짓이 아님');
    // 꺼진 모듈은 지금 그대로다(더해진 이름 없음)
    const off = memberWorld(V.OFF_T, { mutate: opt.mutate, old: 'A' });
    const offPage = await openPage(off, 't1', FORM, {});
    const offRef = memberWorld(REF_OFF, { old: 'A' });
    const offRefPage = await openPage(offRef, 't1', FORM, {});
    c.ok(offPage.evaluate('JSON.stringify(Object.keys(EonAuth).sort())') === offRefPage.evaluate('JSON.stringify(Object.keys(EonAuth).sort())'), '두 함수: 꺼진 모듈이 내보내는 이름이 3C-1 과 다름');
    return c.problems;
}

// =====================================================================
// 4. 실패·거절·점검: 상태가 맞고, 다시 보내지 않고, 공개 키로 떨어지지 않고, 화면은 지금 실패했을 때와 같고, 적던 값은 그대로
// =====================================================================
async function testFailures(opt) {
    const c = checker();
    // 견줄 대상: 꺼진 화면에서 성적 조회가 실패했을 때의 화면(지금의 동작)
    const failedOff = await offResult('A', {}, { prepare: (w) => { w.scoreFault = () => json(500, { code: 'XX000', message: 'fake' }); } });
    c.ok(failedOff.ui.btn === true && failedOff.ui.total === '' && failedOff.ui.yes === false && !/2031-/.test(String(failedOff.history)), `실패: 시험의 대조 — 꺼진 화면의 "실패했을 때"가 기대와 다름(${JSON.stringify(failedOff.ui)})`);
    const cases = [
        ['401(만료가 아닌 코드 PGRST301)', json(401, { code: 'PGRST301', message: 'fake' }), 'rejected'],
        ['401(코드 없음)', json(401, { message: 'fake' }), 'rejected'],
        ['403(42501)', json(403, { code: '42501', message: 'fake' }), 'rejected'],
        ['503(PT503 — 점검 중)', json(503, { code: 'PT503', message: 'fake' }), 'maintenance'],
        ['503(다른 코드)', json(503, { code: 'PGRST000', message: 'fake' }), 'unknown'],
        ['500', json(500, { code: 'XX000', message: 'fake' }), 'unknown'],
        ['429', json(429, { code: 'over_request_rate_limit', message: 'fake' }), 'unknown'],
        ['200 인데 목록이 아님', json(200, { rows: [] }), 'unknown'],
        ['통신 실패', 'network', 'unknown'],
    ];
    for (const [name, answer, want] of cases) {
        const label = `실패(${name})`;
        const h = await openHeld('A', opt);
        c.ok(scoreRequests(h.w, h.page).length === 1 && stateOf(h.page) === 'signed_in', `${label}: 시험이 성적 응답을 붙잡지 못함(${scoreRequests(h.w, h.page).length}건)`);
        typeValues(h.page);
        const refresh0 = h.w.count(REFRESH);
        await h.release(answer);
        const st = statusOf(h.page);
        c.ok(st === want, `${label}: 결과의 상태가 ${want} 가 아님(${st})`);
        c.ok(st !== 'ok', `${label}: 실패가 ok 로 바뀜`);
        const ks = kinds(h.w);
        c.ok(ks.length === 1, `${label}: 성적 요청을 다시 보냄(모두 ${ks.length}건)`);
        c.ok(ks.every((k) => k.kind === 'member'), `${label}: 공개 키(옛 읽기)로 다시 보냄`);
        c.ok(h.w.count(REFRESH) === refresh0, `${label}: 갱신을 일으킴(${h.w.count(REFRESH) - refresh0}번)`);
        const u = ui(h.page);
        c.ok(typedKept(u), `${label}: 학생이 적던 값이 달라지거나 점수 칸을 미리 채움(${JSON.stringify(u)})`);
        c.ok(u.btn === failedOff.ui.btn && u.notice === false && alertsOf(h.page) === 0, `${label}: 화면이 "지금 실패했을 때"와 다름(새 안내·버튼)`);
        const hist = await historyText(h.w, h.page);
        c.ok(!/2031-/.test(String(hist).replace(TYPED.hist, '')), `${label}: 불러오기 글에 성적이 들어감`);
        c.ok(navsOf(h.page).length === 0, `${label}: 화면을 옮기거나 다시 받음(${navsOf(h.page).join(', ')})`);
    }
    {   // 시간 초과: 기다림의 상한을 넘기면 unknown. 다시 보내지 않고, 뒤늦게 온 응답을 반영하지 않는다
        const h = await openHeld('A', opt);
        typeValues(h.page);
        h.w.browser.now += 16000;
        await h.w.browser.spin(300);
        c.ok(statusOf(h.page) === 'unknown', `실패(시간 초과): 결과의 상태가 unknown 이 아님(${statusOf(h.page)})`);
        const u1 = ui(h.page);
        await h.release(null);            // 뒤늦게 서버의 정상 응답이 도착한다
        c.ok(statusOf(h.page) === 'unknown' && typedKept(ui(h.page)) && typedKept(u1), `실패(시간 초과): 뒤늦은 응답이 반영되거나 적던 값이 달라짐(${statusOf(h.page)})`);
        c.ok(kinds(h.w).length === 1 && kinds(h.w)[0].kind === 'member' && h.w.count(REFRESH) === 0, `실패(시간 초과): 다시 보내거나 갱신함(성적 ${kinds(h.w).length}건·갱신 ${h.w.count(REFRESH)}번)`);
    }
    {   // 점검 중(가짜 서버의 점검을 켠다): 이미 확인된 B 의 화면이 성적을 읽을 때 서버가 PT503 을 준다
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate });
        w.seed('B');
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        w.applicationsGate = () => gate;
        const page = await openPage(w, 't1', FORM, { noIdle: true });
        await w.browser.spin(300);
        c.ok(stateOf(page) === 'signed_in' && scoreRequests(w).length === 0, `실패(점검 중): 시험이 "확인된 뒤·성적 읽기 전"을 만들지 못함(${stateOf(page)})`);
        w.server.maintenance = true;
        release();
        await w.browser.idle();
        await w.browser.advance(1500);
        c.ok(statusOf(page) === 'maintenance' && kinds(w).length === 1 && kinds(w)[0].kind === 'member', `실패(점검 중): 상태가 maintenance 가 아니거나 다시 보냄(${statusOf(page)}·${kinds(w).length}건)`);
        c.ok(ui(page).total === '' && ui(page).btn === true, '실패(점검 중): 화면이 "이력 없음"의 모양이 아님');
    }
    return c.problems;
}

// =====================================================================
// 5. 만료(401·PGRST303)의 다섯 갈래: 갱신 한 번 뒤 한 번만 — 갈래마다 정해진 횟수에서 끝난다
// =====================================================================
async function testExpiry(opt) {
    const c = checker();
    const EXPIRED = json(401, { code: 'PGRST303', message: 'JWT expired' });
    const counts = (w) => ({ scores: kinds(w).length, member: kinds(w).filter((k) => k.kind === 'member').length, refresh: w.count(REFRESH), profile: w.count(PROFILE), access: w.count(ACCESS) });
    const refreshFault = (answer) => (req, u) => (u.searchParams.get('grant_type') === 'refresh_token' ? answer : null);
    {   // (1) 갱신 성공 → 다시 확인 한 번 → 같은 읽기를 한 번만 다시 → ok
        const h = await openHeld('A', opt);
        const before = counts(h.w);
        const first = scoreRequests(h.w)[0];
        page1(h.page);
        await h.release(EXPIRED);
        const after = counts(h.w);
        const reqs = scoreRequests(h.w);
        c.ok(statusOf(h.page) === 'ok', `만료(갱신 성공): 다시 보낸 뒤 ok 가 아님(${statusOf(h.page)})`);
        c.ok(after.scores === 2 && after.member === 2, `만료(갱신 성공): 성적 요청이 "처음 1 + 다시 1"이 아님(${after.scores}건, 회원 자격 ${after.member}건)`);
        c.ok(after.refresh - before.refresh === 1, `만료(갱신 성공): 갱신이 한 번이 아님(${after.refresh - before.refresh}번)`);
        c.ok(after.profile - before.profile === 1 && after.access - before.access === 1, `만료(갱신 성공): 다시 확인(my_profile·my_site_access)이 한 번씩이 아님(${after.profile - before.profile}·${after.access - before.access})`);
        if (reqs.length === 2) {
            const [a, b] = reqs.map((r) => credOf(h.w, r));
            const token = (r) => r.headers.find(([n]) => n.toLowerCase() === 'authorization')[1];
            c.ok(reqs[1].url === first.url && a.sid === b.sid && a.authId === b.authId && token(reqs[0]) !== token(reqs[1]), '만료(갱신 성공): 다시 보낸 요청이 "같은 읽기·같은 로그인 기록·갱신된 JWT"가 아님');
        }
        const u = ui(h.page);
        c.ok(u.hist === TYPED.hist && u.total === '4' && u.reading === '4.5', `만료(갱신 성공): 적던 값이 달라지거나 미리 채움이 꺼짐의 결과와 다름(${JSON.stringify(u)})`);
        c.ok(stateOf(h.page) === 'signed_in' && navsOf(h.page).length === 0, `만료(갱신 성공): 확인 상태가 풀리거나 화면을 다시 받음(${stateOf(h.page)})`);
    }
    // (2) 갱신 실패: 거기서 끝낸다
    // ended: 서버가 "그 로그인 기록은 끝났다"고 답한 갈래 — 확인 상태를 거두고, 화면은 3C-1 의 규칙대로 다시 받아진다(적던 값은 그때 비워진다)
    for (const [name, answer, ended] of [['갱신값 없음(400)', json(400, { code: 'refresh_token_not_found', message: 'fake' }), false], ['로그인 기록이 끝남(400·session_not_found)', json(400, { code: 'session_not_found', message: 'fake' }), true], ['갱신의 통신 실패', 'network', false], ['갱신에 429', json(429, { code: 'over_request_rate_limit', message: 'fake' }), false]]) {
        const h = await openHeld('A', opt);
        typeValues(h.page);
        const before = counts(h.w);
        h.w.server.faults.token = refreshFault(answer);
        await h.release(EXPIRED);
        await h.w.browser.advance(30000);          // 공식 클라이언트가 통신 실패한 갱신을 그만둘 때까지
        const after = counts(h.w);
        c.ok(statusOf(h.page) === 'rejected', `만료(갱신 실패 — ${name}): 상태가 rejected 가 아님(${statusOf(h.page)})`);
        c.ok(after.scores === 1 && after.member === 1, `만료(갱신 실패 — ${name}): 성적 요청을 다시 보냄(${after.scores}건) 또는 공개 키로 보냄`);
        c.ok(after.refresh - before.refresh <= 1, `만료(갱신 실패 — ${name}): 갱신을 되풀이함(${after.refresh - before.refresh}번)`);
        const u = ui(h.page);
        if (ended) {
            c.ok(stateOf(h.page) === 'rejected' && navsOf(h.page).includes('[새로 고침]'), `만료(갱신 실패 — ${name}): 끝난 로그인 기록인데 확인 상태를 거두지 않음(${stateOf(h.page)})`);
            c.ok(u.reading === '' && u.total !== '4' && u.yes === false, `만료(갱신 실패 — ${name}): 성적으로 점수 칸을 채움`);
        } else {
            c.ok(stateOf(h.page) === 'signed_in' && navsOf(h.page).length === 0, `만료(갱신 실패 — ${name}): 결과를 모르는데 확인 상태를 거두거나 화면을 다시 받음(${stateOf(h.page)})`);
            c.ok(typedKept(u), `만료(갱신 실패 — ${name}): 적던 값이 달라지거나 미리 채움`);
        }
    }
    {   // 갱신은 됐는데 다시 확인이 "모름"(통신 실패)·"확인되지 않음"(차단)인 갈래
        for (const [name, fault, wantState] of [['다시 확인의 통신 실패', () => 'network', 'signed_in'], ['다시 확인에서 차단됨', () => json(200, { state: 'blocked' }), 'rejected']]) {
            const h = await openHeld('A', opt);
            typeValues(h.page);
            h.w.server.faults.my_profile = fault;
            await h.release(EXPIRED);
            await h.w.browser.advance(20000);
            c.ok(statusOf(h.page) === 'rejected' && kinds(h.w).length === 1 && stateOf(h.page) === wantState, `만료(${name}): rejected·성적 요청 1건·확인 상태 ${wantState} 가 아님(${statusOf(h.page)}·${kinds(h.w).length}·${stateOf(h.page)})`);
            c.ok(ui(h.page).reading === '' && ui(h.page).total !== '4', `만료(${name}): 성적으로 점수 칸을 채움`);
        }
    }
    {   // (3) 갱신하는 사이 다른 계정으로 바뀜: 다시 보내지 않고, B 의 JWT 로 이어 보내지 않는다
        const h = await openHeld('A', opt);
        typeValues(h.page);
        let releaseRefresh;
        const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
        h.w.server.faults.token = (req, u) => (u.searchParams.get('grant_type') === 'refresh_token' ? refreshGate.then(() => null) : null);
        // 성적 응답(만료)을 풀어 갱신이 나가게 한 뒤, 그 갱신을 붙잡아 둔다
        const releasing = h.release(EXPIRED).catch(() => {});
        await h.w.browser.spin(300);
        c.ok(h.w.count(REFRESH) === 1, `만료(사이에 계정이 바뀜): 시험이 갱신을 붙잡지 못함(${h.w.count(REFRESH)}번)`);
        // 다른 탭이 B 로 로그인한다(앞의 A 로그인을 끝내고)
        await loginOther(h.w, B);
        releaseRefresh();
        await h.w.browser.idle().catch(() => {});
        await releasing;
        await h.w.browser.advance(2000);
        const st = statusOf(h.page);
        const mine = scoreRequests(h.w, h.page).map((r) => ({ url: r.url, c: credOf(h.w, r) }));
        c.ok(st === 'discarded' || st === 'rejected', `만료(사이에 계정이 바뀜): 상태가 discarded·rejected 가 아님(${st})`);
        c.ok(mine.length === 1, `만료(사이에 계정이 바뀜): 성적 요청을 다시 보냄(${mine.length}건)`);
        c.ok(mine.every((x) => x.c.kind === 'member' && x.c.authId === A.authId && x.url === memberScoresUrl('m-A')), '만료(사이에 계정이 바뀜): A 가 시작한 흐름이 B 의 JWT·B 의 값 또는 공개 키로 성적 요청을 보냄');
        const u = ui(h.page);       // (사람이 달라져 다시 받기를 불렀다 — 게이트가 칸을 처음 값으로 돌린다. 여기서는 성적이 들어가지 않았는지만 본다)
        c.ok(u.total !== '4' && u.reading === '' && u.yes === false && !/2031-/.test(u.hist), '만료(사이에 계정이 바뀜): 성적이 화면에 반영됨');
    }
    {   // (4) 다시 보낸 것도 만료: 거기서 끝낸다(갱신 한 번, 성적 요청 둘)
        const h = await openHeld('A', opt, { later: () => EXPIRED });
        typeValues(h.page);
        const before = counts(h.w);
        await h.release(EXPIRED);
        const after = counts(h.w);
        c.ok(statusOf(h.page) === 'rejected', `만료(다시 보낸 것도 만료): 상태가 rejected 가 아님(${statusOf(h.page)})`);
        c.ok(after.scores === 2 && after.member === 2, `만료(다시 보낸 것도 만료): 성적 요청이 둘에서 끝나지 않음(${after.scores}건) 또는 공개 키로 보냄`);
        c.ok(after.refresh - before.refresh === 1, `만료(다시 보낸 것도 만료): 갱신이 한 번에서 끝나지 않음(${after.refresh - before.refresh}번)`);
        c.ok(typedKept(ui(h.page)), '만료(다시 보낸 것도 만료): 적던 값이 달라지거나 미리 채움');
    }
    {   // (5) 통신 시간 초과: 갱신하지 않고 끝낸다(다시 보낸 것이 시간 초과여도 거기서 끝)
        const h = await openHeld('A', opt);
        typeValues(h.page);
        h.w.browser.now += 16000;
        await h.w.browser.spin(300);
        c.ok(statusOf(h.page) === 'unknown' && h.w.count(REFRESH) === 0 && kinds(h.w).length === 1, `만료(시간 초과): unknown 에서 끝나지 않음(${statusOf(h.page)}·갱신 ${h.w.count(REFRESH)}·성적 ${kinds(h.w).length})`);
        c.ok(typedKept(ui(h.page)), '만료(시간 초과): 적던 값이 달라지거나 미리 채움');
        await h.release(EXPIRED);         // 뒤늦게 "만료"가 도착해도 갱신하지 않는다
        c.ok(statusOf(h.page) === 'unknown' && h.w.count(REFRESH) === 0 && kinds(h.w).length === 1, '만료(시간 초과): 뒤늦은 응답에 갱신·재전송을 함');
    }
    return c.problems;
    function page1(page) { page.evaluate(`document.querySelector('textarea[name="score_history"]').value = ${JSON.stringify(TYPED.hist)};`); }
}

// =====================================================================
// 6. 시작할 때의 사람을 붙든다: 사람이 달라지면 보내지 않거나 응답을 버린다. A 가 시작한 흐름은 B 의 JWT 로 이어 보내지 않는다
// =====================================================================
async function loginOther(w, acc) {
    const other = await w.open('t2', 'login.html', { noIdle: true });
    other.byId.email.value = acc.email;
    other.byId.password.value = acc.password;
    other.byId.loginForm.fire('submit');
    await w.browser.spin(800);
    return other;
}
async function testPersonChange(opt) {
    const c = checker();
    {   // (가) A 의 성적 응답을 붙잡아 둔 채 다른 탭에서 B 로 바뀜 → 응답을 풀어도 반영하지 않는다(discarded)
        const h = await openHeld('A', opt);
        typeValues(h.page);
        const other = await loginOther(h.w, B);
        c.ok(other.evaluate('EonAuth.state()') === 'signed_in' && h.page.root.classList.contains('eon-auth-away'), `사람이 달라짐(붙잡은 응답): 시험이 다른 탭에서 B 로 바꾸지 못함(${other.evaluate('EonAuth.state()')})`);
        await h.release(null);            // 서버는 A 의 성적을 정상으로 준다
        c.ok(statusOf(h.page) === 'discarded', `사람이 달라짐(붙잡은 응답): 상태가 discarded 가 아님(${statusOf(h.page)})`);
        const u = ui(h.page);       // (다시 받기를 불렀다 — 게이트가 칸을 처음 값으로 돌린다. 여기서는 A 의 성적이 들어가지 않았는지만 본다)
        c.ok(u.total !== '4' && u.reading === '' && u.yes === false && !/2031-/.test(u.hist), `사람이 달라짐(붙잡은 응답): A 의 성적이 화면에 반영됨(${JSON.stringify(u)})`);
        const hist = await historyText(h.w, h.page);
        c.ok(!/2031-/.test(String(hist).replace(TYPED.hist, '')), '사람이 달라짐(붙잡은 응답): 불러오기 글에 A 의 성적이 들어감');
        const all = scoreRequests(h.w).map((r) => ({ url: r.url, page: r.page, c: credOf(h.w, r) }));
        c.ok(all.filter((x) => x.page === 't1').length === 1, `사람이 달라짐(붙잡은 응답): A 의 화면이 성적 요청을 다시 보냄(${all.filter((x) => x.page === 't1').length}건)`);
        // 회원 자격의 성적 요청 가운데 "조건의 사람 ≠ JWT 의 사람"인 것 0
        c.ok(all.every((x) => x.c.kind !== 'member' || (x.c.authId === A.authId) === (x.url === memberScoresUrl('m-A'))), '사람이 달라짐(붙잡은 응답): "시작한 사람 ≠ JWT 의 사람"인 회원 자격의 성적 요청이 있음');
        c.ok(all.every((x) => x.c.kind === 'member'), '사람이 달라짐(붙잡은 응답): 공개 키로 성적 요청이 나감');
    }
    {   // (나) 가려진 옛 화면이 계속 돈다: A 가 시작한 흐름이, 지금 확인된 사람이 B 가 된 뒤에 성적 읽기에 이른다 → 보내지 않는다
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate });
        w.seed('A');
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        let held = 0;
        w.applicationsGate = (req) => (req.page === 't1' ? (++held, gate) : null);
        const page = await openPage(w, 't1', FORM, { noIdle: true });
        await w.browser.spin(300);
        c.ok(!!page.byId.restartLoadHistoryBtn === false, '사람이 달라짐(옛 화면): 시험의 대조 — 붙잡기 전에 성적 이력이 이미 붙음');
        c.ok(stateOf(page) === 'signed_in' && held >= 1 && scoreRequests(w).length === 0, `사람이 달라짐(옛 화면): 시험이 A 의 흐름을 성적 읽기 앞에서 붙잡지 못함(${stateOf(page)}·${held})`);
        const other = await loginOther(w, B);
        c.ok(other.evaluate('EonAuth.state()') === 'signed_in' && stateOf(page) === 'signed_in', `사람이 달라짐(옛 화면): 시험이 B 로 바꾸지 못함(${other.evaluate('EonAuth.state()')}·${stateOf(page)})`);
        c.ok(page.evaluate('EonAuth.profile() && EonAuth.profile().id') === 'm-B', '사람이 달라짐(옛 화면): 시험의 대조 — 옛 화면의 모듈이 지금 확인한 사람이 B 가 아님');
        release();
        await w.browser.idle();
        await w.browser.advance(2000);
        const mine = scoreRequests(w, page).map((r) => ({ url: r.url, c: credOf(w, r) }));
        c.ok(mine.length === 0, `사람이 달라짐(옛 화면): A 가 시작한 흐름이 성적 요청을 보냄(${mine.map((x) => x.c.kind + ':' + (x.c.authId || '')).join(',')})`);
        c.ok(statusOf(page) === 'discarded', `사람이 달라짐(옛 화면): 상태가 discarded 가 아님(${statusOf(page)})`);
        c.ok(ui(page).total === '' && ui(page).reading === '', '사람이 달라짐(옛 화면): 성적이 화면에 반영됨');
    }
    {   // (다) 같은 사람의 새 로그인 기록(다른 탭에서 로그아웃했다 다시 로그인): 흐름이 붙든 로그인 기록이 아니다 → 보내지 않는다
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate });
        w.seed('A');
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        let held = 0;
        w.applicationsGate = (req) => (req.page === 't1' ? (++held, gate) : null);
        const page = await openPage(w, 't1', FORM, { noIdle: true });
        await w.browser.spin(300);
        const again = await loginOther(w, A);
        c.ok(held >= 1 && scoreRequests(w).length === 0 && again.evaluate('EonAuth.state()') === 'signed_in', `같은 사람의 새 로그인 기록: 시험이 그 경우를 만들지 못함(${held}·${again.evaluate('EonAuth.state()')})`);
        release();
        await w.browser.idle();
        await w.browser.advance(2000);
        c.ok(scoreRequests(w, page).length === 0 && ['discarded', 'not_signed_in'].includes(statusOf(page)), `같은 사람의 새 로그인 기록: 흐름이 붙든 로그인 기록이 아닌데 성적 요청을 보냄(${scoreRequests(w, page).length}건·${statusOf(page)})`);
    }
    {   // (라) 흐름을 시작하지 않은 화면(붙든 사람이 없음)에서는 보내지 않는다
        const w = memberWorld(V.ON_OPEN, { mutate: opt.mutate });
        w.seed('A');
        const page = await openPage(w, 't1', 'notice.html', {});
        await w.browser.advance(1500);
        const r = await evalAsync(w, page, "EonAuth.memberRead('my-scores')");
        c.ok(stateOf(page) === 'signed_in' && r === 'OK:{"status":"not_signed_in"}' && scoreRequests(w).length === 0, `붙든 사람이 없는 화면: 성적 요청을 보냄(${String(r).slice(0, 50)}·${scoreRequests(w).length}건)`);
    }
    return c.problems;
}

// =====================================================================
// 7. 실행기: 실제로 내보내는 업무 요청은 "그 경우의 합성 회원 한 명의 성적 읽기"뿐 — 차단기와 전송 지점이 따로 본다
//    (둘 다 제품의 규약표를 읽지 않는다. 여기서는 그 둘이 제품이 실제로 만드는 요청과 같은 글자를 기대하는지도 본다)
// =====================================================================
const LOG_FILE = 'tests/auth-session/request-log.mjs';
const CORE_FILE = 'tests/auth-session/screen-core.mjs';
async function loadModule(FILE, mutate) {
    if (!mutate) return import('./' + path.basename(FILE));
    const here = path.dirname(fileURLToPath(import.meta.url));
    let text = mutate(FILE, workFile(FILE));
    text = text.replace(/from '\.\/([a-z-]+\.mjs)'/g, (m, name) => `from ${JSON.stringify(pathToFileURL(path.join(here, name)).href)}`);
    const file = path.join(os.tmpdir(), `b3c2a-${path.basename(FILE, '.mjs')}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
    fs.writeFileSync(file, text);
    try { return await import(pathToFileURL(file).href); } finally { fs.unlinkSync(file); }
}
async function testRunnerGate(opt) {
    const c = checker();
    const log = await loadModule(LOG_FILE, opt.mutate);
    const core = await loadModule(CORE_FILE, opt.mutate);
    const anon = 'zz-fake-anon';
    const ISS = TEST_URL + '/auth/v1';
    const logins = { A: A.email, B: B.email, GM: ACCOUNTS.GM.email };
    const people = makePeople({ loginEmails: () => logins });
    people.note('A', A.profile);
    people.note('B', B.profile);
    const labels = people.labels();
    const jwt = (acc, iss = ISS) => fakeJwt({ iss, role: 'authenticated', sub: acc.authId, email: acc.email, session_id: 'sess-x' });
    const decide = log.makeDecider({ selfOrigins: ['http://127.0.0.1:8787'], anonKey: anon, issuer: ISS, memberEmails: () => Object.values(logins), accountLabels: () => labels });
    const member = (acc) => ({ apikey: anon, authorization: 'Bearer ' + jwt(acc), 'content-type': 'application/json' });
    const pub = { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' };
    const mUrl = (id) => memberScoresUrl(id);
    const wUrl = (id) => TEST_URL + wrapperScoresPath(id);
    const P = (credential, accounts) => ({ credential, accounts });
    // 세 곳이 따로 적어 둔 글자가 서로 같은가(같아야 제품이 실제로 만드는 요청 — 위 1번 시험이 본 것 — 과 맞는다)
    c.ok(new URL(mUrl('m-A')).search === log.scoresSearch('m-A', 'member') && new URL(wUrl('m-A')).search === log.scoresSearch('m-A', 'wrapper'), '실행기: 차단기가 따로 적어 둔 모양이 회귀시험이 따로 적어 둔 모양(제품이 실제로 보낸 것)과 다름');
    const rows = [
        // [이름, 메서드, 주소, 머리글, 허락, 기대 결정, 기대 까닭, 전송 지점의 기대]
        ['회원 자격·A 의 것·허락(회원, A)', 'GET', mUrl('m-A'), member(A), P('member', ['A']), 'continue', 'none', true],
        ['회원 자격·B 의 것·허락(회원, A·B)', 'GET', mUrl('m-B'), member(B), P('member', ['A', 'B']), 'continue', 'none', true],
        ['공개 키·래퍼의 모양·허락(공개 키, A)', 'GET', wUrl('m-A'), pub, P('anon', ['A']), 'continue', 'none', true],
        ['허락이 없음(회원 자격)', 'GET', mUrl('m-A'), member(A), null, 'abort', 'no-permit', false],
        ['허락이 없음(공개 키)', 'GET', wUrl('m-A'), pub, null, 'fake', 'no-permit', false],
        ['조건의 사람이 허락 밖(B 의 회원번호, 허락은 A)', 'GET', mUrl('m-B'), member(B), P('member', ['A']), 'abort', 'owner', false],
        ['A 의 JWT 로 B 의 회원번호를 조건으로(허락은 A·B)', 'GET', mUrl('m-B'), member(A), P('member', ['A', 'B']), 'abort', 'jwt-owner-mismatch', false],
        ['B 의 JWT 로 A 의 회원번호를 조건으로(허락은 A·B)', 'GET', mUrl('m-A'), member(B), P('member', ['A', 'B']), 'abort', 'jwt-owner-mismatch', false],
        ['허락은 회원 자격인데 공개 키로', 'GET', wUrl('m-A'), pub, P('member', ['A']), 'fake', 'credential', false],
        ['허락은 공개 키인데 회원 자격으로', 'GET', mUrl('m-A'), member(A), P('anon', ['A']), 'abort', 'credential', false],
        ['회원 자격인데 래퍼의 모양(끝에 &)', 'GET', wUrl('m-A'), member(A), P('member', ['A']), 'abort', 'shape', false],
        ['공개 키인데 전송 담당 함수의 모양', 'GET', mUrl('m-A'), pub, P('anon', ['A']), 'fake', 'shape', false],
        ['조건을 더함', 'GET', mUrl('m-A') + '&memo=not.is.null', member(A), P('member', ['A']), 'abort', 'shape', false],
        ['열을 더함(select=*)', 'GET', `${TEST_URL}/rest/v1/${SCORE_TABLE}?user_id=eq.m-A&select=*&order=test_date.asc&limit=50`, member(A), P('member', ['A']), 'abort', 'shape', false],
        ['개수를 바꿈', 'GET', mUrl('m-A').replace('limit=50', 'limit=500'), member(A), P('member', ['A']), 'abort', 'shape', false],
        ['조건 없는 조회', 'GET', `${TEST_URL}/rest/v1/${SCORE_TABLE}?select=*`, member(A), P('member', ['A']), 'abort', 'owner', false],
        ['조건 없는 조회(공개 키)', 'GET', `${TEST_URL}/rest/v1/${SCORE_TABLE}?select=*`, pub, P('anon', ['A']), 'fake', 'owner', false],
        ['번호 목록으로 묶은 조회(in)', 'GET', `${TEST_URL}/rest/v1/${SCORE_TABLE}?id=in.(x,y)&select=id`, member(A), P('member', ['A']), 'abort', 'owner', false],
        ['로그인 계정 번호가 조건', 'GET', mUrl(A.authId), member(A), P('member', ['A']), 'abort', 'owner', false],
        ['쓰기(POST)', 'POST', mUrl('m-A'), member(A), P('member', ['A']), 'abort', 'method', false],
        ['다른 발급자의 JWT', 'GET', mUrl('m-A'), { apikey: anon, authorization: 'Bearer ' + jwt(A, 'https://qpqjevecjejvbeuogtbx.supabase.co/auth/v1') }, P('member', ['A']), 'abort', 'jwt-owner-mismatch', false],
    ];
    const recs = [];
    for (const [name, method, url, headers, permit, want, why, wire] of rows) {
        const d = decide({ url, method, headers, postData: method === 'POST' ? '{}' : null, resourceType: 'fetch', isNavigation: false, scoresPermit: permit });
        recs.push(d.record);
        c.ok(d.action === want, `실행기의 차단기(${name}): 결정이 ${want} 가 아님(${d.action})`);
        c.ok(d.record.target === 'scores' && d.record.scores === (want === 'continue' ? 'permitted' : 'refused') && d.record.scoresWhy === why, `실행기의 차단기(${name}): 기록이 기대와 다름(${d.record.scores}·${d.record.scoresWhy})`);
        c.ok(d.record.aborted === (want !== 'continue') && (want !== 'continue' || d.record.leak === false), `실행기의 차단기(${name}): "보내지 않음"·자격의 용도 판정이 결정과 다름`);
        const sent = core.wireScoresOk({ method, rawUrl: url, headers, permit, anonKey: anon, testUrl: TEST_URL, issuer: ISS, memberIdOf: (k) => people.memberIdOf(k), accountOfJwt: (auth) => people.accountOfJwt(auth) });
        c.ok(sent === wire, `실행기의 전송 지점(${name}): 내보내는가가 기대(${wire})와 다름(${sent})`);
    }
    // 회원번호를 아직 모르는 계정(my_profile 을 보지 못함)의 성적 읽기는 허락이 있어도 내보내지 않는다
    {
        const d = decide({ url: mUrl('m-GM'), method: 'GET', headers: member(ACCOUNTS.GM), postData: null, resourceType: 'fetch', isNavigation: false, scoresPermit: P('member', ['GM']) });
        const sent = core.wireScoresOk({ method: 'GET', rawUrl: mUrl('m-GM'), headers: member(ACCOUNTS.GM), permit: P('member', ['GM']), anonKey: anon, testUrl: TEST_URL, issuer: ISS, memberIdOf: (k) => people.memberIdOf(k), accountOfJwt: (auth) => people.accountOfJwt(auth) });
        c.ok(d.action !== 'continue' && sent === false, '실행기(회원번호를 모르는 계정): 성적 읽기를 내보냄');
    }
    // 성적 표가 아닌 업무 요청은 허락이 있어도 그대로 막는다. 인증 모듈의 요청은 그대로 나간다
    {
        const other = decide({ url: `${TEST_URL}/rest/v1/applications?user_id=eq.m-A`, method: 'GET', headers: pub, postData: null, resourceType: 'fetch', isNavigation: false, scoresPermit: P('anon', ['A']) });
        const otherMember = decide({ url: `${TEST_URL}/rest/v1/users?id=eq.m-A`, method: 'GET', headers: member(A), postData: null, resourceType: 'fetch', isNavigation: false, scoresPermit: P('member', ['A']) });
        const profile = decide({ url: `${TEST_URL}/rest/v1/rpc/my_profile`, method: 'POST', headers: member(A), postData: '{}', resourceType: 'fetch', isNavigation: false, scoresPermit: P('member', ['A']) });
        c.ok(other.action === 'fake' && otherMember.action === 'abort' && otherMember.record.leak === true && profile.action === 'continue' && !('scores' in profile.record), '실행기의 차단기: 성적 표가 아닌 업무 요청을 내보내거나(허락이 다른 표로 번짐) 인증 모듈의 요청을 막음');
    }
    // 셈과 기록
    const sum = log.summarize(recs);
    c.ok(sum.scoresPermitted === 3 && sum.scoresRefused === rows.length - 3 && sum.scoresAttempts === rows.length && sum.businessSent === 0, `실행기의 차단기: 성적 요청의 셈이 기대와 다름(${sum.scoresPermitted}·${sum.scoresRefused}·${sum.businessSent})`);
    c.ok(sum.scoresJwtOwnerMismatch >= 3, '실행기의 차단기: "JWT 의 사람 ≠ 조건의 사람"을 세지 않음');
    c.ok(recs.every((r) => !/zz\.invalid|eyJ|\/rest\/|m-A|m-B/.test(JSON.stringify(r))), '실행기의 차단기: 기록에 주소·값이 남음');
    c.ok(recs.every((r) => log.SCORES_WHY.includes(r.scoresWhy) && ['A', 'B', 'GM', 'none'].includes(r.scoresOwner) && ['A', 'B', 'GM', 'none'].includes(r.scoresJwt)), '실행기의 차단기: 기록의 이름이 정해 둔 것이 아님');
    return c.problems;
}

const TESTS = [
    ['열림: 확인 뒤에만·회원 자격으로·규약의 모양 그대로, 그 밖의 요청은 3C-1 의 켜짐과 같음, 화면 결과는 같은 합성 자료의 꺼짐과 같음(A·B·성적 0건 회원)', testOpenRead],
    ['스위치의 조합 넷(꺼짐 = 기준·3C-1 의 꺼짐 / 켜짐 + 닫힘 = 3C-1 의 켜짐 / 켜짐 + 열림 / 확인할 수 없음 + 열림 = 성적 요청 0)과 저장소의 값(닫힘)', testSwitchMatrix],
    ['기존의 두 함수(headersForGrade·credentialFor)로는 성적 표에 쓸 회원 머리글을 얻을 수 없음, 내보내는 이름은 셋만 더해짐', testTwoFunctions],
    ['실패·거절·점검·시간 초과: 상태가 맞음, 다시 보내지 않음, 공개 키 재시도 0, 화면은 지금 실패했을 때와 같음, 적던 값 불변', testFailures],
    ['만료(401·PGRST303)의 다섯 갈래: 갱신 한 번 뒤 한 번만 — 갈래마다 정해진 횟수에서 끝남', testExpiry],
    ['시작할 때의 사람을 붙든다: 사람이 달라지면 보내지 않거나 응답을 버림, A 가 시작한 흐름은 B 의 JWT 로 이어 보내지 않음', testPersonChange],
    ['실행기: 내보내는 업무 요청은 "그 경우의 합성 회원 한 명의 성적 읽기"뿐 — 차단기와 전송 지점이 따로 본다(제품의 규약표를 읽지 않음)', testRunnerGate],
];

// =====================================================================
// 감도(일부러 바꾼 사본) — 계약서 4번의 목록 전부와 그 밖
// =====================================================================
const N1 = /성적 요청이 1건이 아님\(0건\)/;
const MUTANTS = [
    { name: '회원 업무로 적힌 호출이 업무 이름 없이 공개 래퍼로 나가는 사본', tests: [testOpenRead], expect: /공개 키\(또는 다른 자격\)로 성적 요청이 나감|회원 자격의 성적 요청이 1건이 아님/,
        edits: [[FORM_FILE, "} else if (eonReads && eonAuth.memberTaskOpen('my-scores')) {", '} else if (false) {']] },
    { name: '엉뚱한 업무 이름을 넘기는 사본', tests: [testOpenRead], expect: N1,
        edits: [[FORM_FILE, "await eonAuth.memberRead('my-scores');", "await eonAuth.memberRead('my-score');"]] },
    { name: '규약과 다른 요청을 만드는 사본(조건 추가) — 전송 직전의 검사가 막는다', tests: [testOpenRead], expect: N1,
        edits: [[AUTH_FILE, "                '&limit=' + encodeURIComponent(task.limit),", "                '&limit=' + encodeURIComponent(task.limit) + '&memo=not.is.null',"]] },
    { name: '규약과 다른 요청을 만드는 사본(열 추가) — 전송 직전의 검사가 막는다', tests: [testOpenRead], expect: N1,
        edits: [[AUTH_FILE, "                '&select=' + encodeURIComponent(task.columns.join(',')) +", "                '&select=' + encodeURIComponent(task.columns.concat(['memo']).join(',')) +"]] },
    { name: '규약과 다른 요청을 만드는 사본(다른 표) — 전송 직전의 검사가 막는다', tests: [testOpenRead], expect: N1,
        edits: [[AUTH_FILE, "            url: ORIGIN + '/rest/v1/' + task.table + '?' + task.owner + '='", "            url: ORIGIN + '/rest/v1/users?' + task.owner + '='"]] },
    { name: '규약과 다른 요청을 만드는 사본(관계 확장) — 전송 직전의 검사가 막는다', tests: [testOpenRead], expect: N1,
        edits: [[AUTH_FILE, "                '&select=' + encodeURIComponent(task.columns.join(',')) +", "                '&select=' + encodeURIComponent(task.columns.join(',') + ',users(*)') +"]] },
    { name: '규약과 다른 요청을 만드는 사본(개수 변경) — 전송 직전의 검사가 막는다', tests: [testOpenRead], expect: N1,
        edits: [[AUTH_FILE, "                '&limit=' + encodeURIComponent(task.limit),", "                '&limit=500',"]] },
    { name: '규약과 다른 요청을 만드는 사본(머리글을 더함) — 전송 직전의 검사가 막는다', tests: [testOpenRead], expect: N1,
        edits: [[AUTH_FILE, "            headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }\n        };\n    }\n\n    // 보내기 직전에", "            headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Prefer': 'count=exact' }\n        };\n    }\n\n    // 보내기 직전에"]] },
    { name: '규약과 다른 요청을 만들고 전송 직전의 검사도 하지 않는 사본(조건 추가) — 시험이 따로 적어 둔 모양이 잡는다', tests: [testOpenRead], expect: /요청의 글자가 시험이 따로 적어 둔 모양과 다름/,
        edits: [[AUTH_FILE, "                '&limit=' + encodeURIComponent(task.limit),", "                '&limit=' + encodeURIComponent(task.limit) + '&memo=not.is.null',"], [AUTH_FILE, "        if (!memberRequestOk(req, task, owner)) return { kind: 'unknown' };", '']] },
    { name: '규약표 자체가 다른 사본(개수 500) — 시험이 따로 적어 둔 모양이 잡는다', tests: [testOpenRead], expect: /요청의 글자가 시험이 따로 적어 둔 모양과 다름/,
        edits: [[AUTH_FILE, "            limit: '50'", "            limit: '500'"]] },
    { name: '규약표 자체가 다른 사본(열에 메모를 더함) — 시험이 따로 적어 둔 모양이 잡는다', tests: [testOpenRead], expect: /요청의 글자가 시험이 따로 적어 둔 모양과 다름|행에 규약의 열이 아닌 것이 있음/,
        edits: [[AUTH_FILE, "'overall', 'legacy_total']),", "'overall', 'legacy_total', 'memo']),"]] },
    { name: '서버가 더 준 열을 그대로 넘기는 사본', tests: [testOpenRead], expect: /서버가 더 준 열\(규약 밖\)을 호출자에게 넘김/,
        edits: [[AUTH_FILE, '            rows.push(o);', '            rows.push(r);']] },
    { name: '실패를 0건(ok)으로 돌려주는 사본', tests: [testFailures, testExpiry], expect: /실패가 ok 로 바뀜|상태가 rejected 가 아님\(ok\)/,
        edits: [[AUTH_FILE, '        return memberResult(name, a.kind, a.rows);', "        return memberResult(name, 'ok', a.rows || []);"]] },
    { name: '거절 뒤 공개 키로 다시 보내는 사본', tests: [testFailures], expect: /공개 키\(옛 읽기\)로 다시 보냄/,
        edits: [[FORM_FILE, "actual = read && read.status === 'ok' && Array.isArray(read.rows) ? read.rows : [];", "actual = read && read.status === 'ok' && Array.isArray(read.rows) ? read.rows : (await supabaseAPI.query('toefl_actual_scores', { 'user_id': `eq.${uid}`, 'select': 'test_date,reading,listening,speaking,writing,overall,legacy_total', 'order': 'test_date.asc', 'limit': '50' }) || []);"]] },
    { name: '사람이 달라졌는데 응답을 넘기는 사본', tests: [testPersonChange], expect: /상태가 discarded 가 아님\(ok\)|A 의 성적이 화면에 반영됨/,
        edits: [[AUTH_FILE, "        await ready();\n        if (!sameOwner(ownerNow(), owner)) return { kind: 'discarded' };\n        if (r.status === 200) {", '        if (r.status === 200) {']] },
    { name: '만료가 아닌 401 에 다시 보내는 사본', tests: [testFailures], expect: /실패\(401\(만료가 아닌 코드 PGRST301\)\): (성적 요청을 다시 보냄|갱신을 일으킴)/,
        edits: [[AUTH_FILE, "        if (r.status === 401) return { kind: code === EXPIRED_CODE ? 'expired' : 'rejected' };", "        if (r.status === 401) return { kind: 'expired' };"]] },
    { name: '로그인 계정 번호를 주인 값으로 쓰는 사본(만들기와 검사 둘 다)', tests: [testOpenRead], expect: /요청의 글자가 시험이 따로 적어 둔 모양과 다름/,
        edits: [[AUTH_FILE, "task.owner + '=' + encodeURIComponent('eq.' + owner.memberId) +", "task.owner + '=' + encodeURIComponent('eq.' + owner.sub) +"], [AUTH_FILE, "        const want = [[task.owner, 'eq.' + owner.memberId],", "        const want = [[task.owner, 'eq.' + owner.sub],"]] },
    { name: '로그인 이메일을 주인 값으로 쓰는 사본(검사 없이)', tests: [testOpenRead], expect: /요청의 글자가 시험이 따로 적어 둔 모양과 다름/,
        edits: [[AUTH_FILE, "task.owner + '=' + encodeURIComponent('eq.' + owner.memberId) +", "'user_email=' + encodeURIComponent('eq.' + JSON.parse(atob(token.split('.')[1])).email) +"], [AUTH_FILE, "        if (!memberRequestOk(req, task, owner)) return { kind: 'unknown' };", '']] },
    { name: '시작할 때의 사람을 붙들지 않는 사본(부를 때 확인된 사람으로 보냄 — B 의 JWT 로 이어 보낸다)', tests: [testPersonChange], expect: /A 가 시작한 흐름이 성적 요청을 보냄|붙든 사람이 없는 화면: 성적 요청을 보냄/,
        edits: [[AUTH_FILE, '        const owner = flowOwner;\n        if (!owner) return memberResult', '        const owner = ownerNow();\n        if (!owner) return memberResult']] },
    { name: '붙든 로그인 기록을 견주지 않는 사본(회원번호만 견줌)', tests: [testPersonChange], expect: /같은 사람의 새 로그인 기록/,
        edits: [[AUTH_FILE, '        return !!a && !!b && a.memberId === b.memberId && a.sub === b.sub && a.sid === b.sid;', '        return !!a && !!b && a.memberId === b.memberId;'], [AUTH_FILE, "        if (!st || !same(st.claims, owner) || typeof st.accessToken !== 'string') return { kind: 'discarded' };", "        if (!st || typeof st.accessToken !== 'string') return { kind: 'discarded' };"], [AUTH_FILE, '        return !!c && c.sub === owner.sub && c.sid === owner.sid;\n    }\n\n    // 보낸다.', '        return !!c;\n    }\n\n    // 보낸다.']] },
    { name: '갱신을 되풀이하는 사본(만료가 이어지면 계속 갱신·재전송)', tests: [testExpiry], expect: /성적 요청이 둘에서 끝나지 않음|갱신이 한 번에서 끝나지 않음/,
        edits: [[AUTH_FILE, "        if (a.kind === 'expired') {\n            const again", "        for (let turn = 0; turn < 3 && a.kind === 'expired'; turn++) {\n            const again"], [AUTH_FILE, "                if (a.kind === 'expired') a = { kind: 'rejected' };      // 다시 보낸 것도 만료: 거기서 끝낸다", '']] },
    { name: '갱신 뒤 다시 확인하지 않고 다시 보내는 사본', tests: [testExpiry], expect: /다시 확인\(my_profile·my_site_access\)이 한 번씩이 아님/,
        edits: [[AUTH_FILE, '        const v = await verifyOnce(att, rf.session.access_token);', '        const v = { ok: true, profile: { id: owner.memberId } };']] },
    { name: '통신 실패에 다시 보내는 사본', tests: [testFailures], expect: /실패\(통신 실패\): 성적 요청을 다시 보냄/,
        edits: [[AUTH_FILE, '        const r = await sendMemberRequest(req);', '        let r = await sendMemberRequest(req);\n        if (r.status === 0) r = await sendMemberRequest(req);']] },
    { name: '점검(PT503)을 가르지 않는 사본', tests: [testFailures], expect: /결과의 상태가 maintenance 가 아님|상태가 maintenance 가 아니거나/,
        edits: [[AUTH_FILE, "        if (r.status === 503 && code === MAINTENANCE_CODE) return { kind: 'maintenance' };\n", '']] },
    { name: 'headersForGrade 의 회원 등급을 여는 사본', tests: [testTwoFunctions], expect: /headersForGrade 의 member 등급이 머리글을 내줌/,
        edits: [[AUTH_FILE, "        throw EonAuthError(g === GRADES.LEGACY_OWN ? 'legacy_own' : 'grade_closed');\n    }\n\n    // -----------------------------------------------------------------\n    // 꺼짐", "        if (g === GRADES.MEMBER) { try { return Object.assign({ 'apikey': anonKey(), 'Authorization': 'Bearer ' + JSON.parse(window.localStorage.getItem(STORAGE_KEY)).access_token, 'Content-Type': 'application/json' }, extra); } catch (e) { /* 아래로 */ } }\n        throw EonAuthError(g === GRADES.LEGACY_OWN ? 'legacy_own' : 'grade_closed');\n    }\n\n    // -----------------------------------------------------------------\n    // 꺼짐"]] },
    { name: 'credentialFor 가 내주는 대상에 성적 표를 더하는 사본', tests: [testTwoFunctions], expect: /credentialFor 가 성적 표의 주소/,
        edits: [[AUTH_FILE, "        { key: 'my_site_access', method: 'POST', path: '/rest/v1/rpc/my_site_access', search: '', member: true }", "        { key: 'my_site_access', method: 'POST', path: '/rest/v1/rpc/my_site_access', search: '', member: true },\n        { key: 'scores', method: 'GET', path: '/rest/v1/toefl_actual_scores', search: '', member: true }"]] },
    { name: '닫힌 업무인데 회원 자격으로 보내는 사본(열림을 보지 않음)', tests: [testSwitchMatrix], expect: /켜짐 \+ 닫힘\(A\): 3C-1 의 켜짐\(5528bea\)과 다름|켜짐 \+ 닫힘\(A\): 회원 자격의 성적 요청이 나감|닫힌 업무를 전송 담당 함수가 받아 줌/,
        edits: [[AUTH_FILE, '        return !!task && task.open === true;', '        return !!task;'], [AUTH_FILE, "        if (!task || task.open !== true) throw EonAuthError('task_not_allowed');", "        if (!task) throw EonAuthError('task_not_allowed');"]] },
    { name: '저장소의 값이 열림인 사본', tests: [testSwitchMatrix], expect: /저장소의 값: 업무 규약의 my-scores 가 닫힘이 아님/, staticOnly: true,
        edits: [[AUTH_FILE, "        'my-scores': Object.freeze({ open: false,", "        'my-scores': Object.freeze({ open: true,"]] },
    { name: '모듈을 받지 못한 켜진 화면에서 공개 키로 읽는 사본', tests: [testSwitchMatrix], expect: /성적 이력의 코드를 직접 부름\): 성적 요청이 나감/,
        edits: [[FORM_FILE, '        if (EonLogin.on() && (EonLogin.missing() || !eonReads)) {', '        if (false) {']] },
    { name: '실행기의 차단기가 허락 없이도 성적 요청을 내보내는 사본', tests: [testRunnerGate], expect: /실행기의 차단기\(허락이 없음/,
        edits: [[LOG_FILE, "    else if (!permit || !Array.isArray(permit.accounts)) why = 'no-permit';\n", "    else if (!permit || !Array.isArray(permit.accounts)) permit = { credential: cred === 'member' ? 'member' : 'anon', accounts: [owner] };\n"]] },
    { name: '실행기의 차단기가 JWT 의 사람과 조건의 사람을 견주지 않는 사본', tests: [testRunnerGate], expect: /실행기의 차단기\([AB] 의 JWT 로/,
        edits: [[LOG_FILE, "    else if (permit.credential === 'member' && jwt !== owner) why = 'jwt-owner-mismatch';\n", '']] },
    { name: '실행기의 차단기가 요청의 모양을 보지 않는 사본', tests: [testRunnerGate], expect: /실행기의 차단기\((조건을 더함|개수를 바꿈|열을 더함)/,
        edits: [[LOG_FILE, "    else if (shape !== (permit.credential === 'member' ? 'member' : 'wrapper')) why = 'shape';\n", ''], [LOG_FILE, "            else if (owner === 'none' && u.searchParams.get('user_id') === 'eq.' + id) owner = label;", "            else if (owner === 'none' && u.searchParams.get('user_id') === 'eq.' + id) { owner = label; shape = 'member'; }"]] },
    { name: '실행기의 차단기가 허락의 계정을 보지 않는 사본', tests: [testRunnerGate], expect: /실행기의 차단기\(조건의 사람이 허락 밖/,
        edits: [[LOG_FILE, "    else if (owner === 'none' || !permit.accounts.includes(owner)) why = 'owner';", "    else if (owner === 'none') why = 'owner';"]] },
    { name: '실행기의 차단기가 허락한 자격의 종류를 보지 않는 사본', tests: [testRunnerGate], expect: /실행기의 차단기\(허락은 (회원 자격인데 공개 키로|공개 키인데 회원 자격으로)/,
        edits: [[LOG_FILE, "    else if (permit.credential === 'member' ? cred !== 'member' : !(permit.credential === 'anon' && exactAnon)) why = 'credential';\n", '']] },
    { name: '실행기의 전송 지점이 허락의 계정을 보지 않는 사본(아는 회원번호면 내보냄)', tests: [testRunnerGate], expect: /실행기의 전송 지점\((조건의 사람이 허락 밖|허락이 없음)/,
        edits: [[CORE_FILE, '    for (const k of permit.accounts) {\n        const id = memberIdOf(k);', "    for (const k of ['A', 'B', 'GM']) {\n        const id = memberIdOf(k);"], [CORE_FILE, "    if (!permit || !Array.isArray(permit.accounts) || !anonKey || method !== 'GET') return false;", "    if (!anonKey || method !== 'GET') return false;\n    if (!permit) permit = { credential: 'member', accounts: [] };"]] },
    { name: '실행기의 전송 지점이 JWT 의 사람을 보지 않는 사본', tests: [testRunnerGate], expect: /실행기의 전송 지점\([AB] 의 JWT 로/,
        edits: [[CORE_FILE, "auth !== 'Bearer ' + anonKey && ours && accountOfJwt(auth) === k) return true;", "auth !== 'Bearer ' + anonKey && ours) return true;"]] },
    { name: '실행기의 전송 지점이 JWT 의 발급자를 보지 않는 사본', tests: [testRunnerGate], expect: /실행기의 전송 지점\(다른 발급자의 JWT/,
        edits: [[CORE_FILE, "        const ours = !!c && c.role === 'authenticated' && c.iss === issuer;", "        const ours = !!c && c.role === 'authenticated';"]] },
    { name: '실행기의 전송 지점이 요청의 글자를 보지 않는 사본(시작만 같으면 내보냄)', tests: [testRunnerGate], expect: /실행기의 전송 지점\((조건을 더함|회원 자격인데 래퍼의 모양)/,
        edits: [[CORE_FILE, "        if (permit.credential === 'member' && u.search === search && auth", "        if (permit.credential === 'member' && u.search.startsWith(search) && auth"]] },
    { name: '실행기의 전송 지점이 허락한 자격의 종류를 보지 않는 사본(공개 키 허락에 회원 자격을 내보냄)', tests: [testRunnerGate], expect: /실행기의 전송 지점\(허락은 공개 키인데 회원 자격으로/,
        edits: [[CORE_FILE, "        if (permit.credential === 'member' && u.search === search && auth", "        if (u.search === search && auth"], [CORE_FILE, "        const c = permit.credential === 'member' ? jwtClaims(auth) : null;", '        const c = jwtClaims(auth);']] },
    { name: '꺼진 화면의 성적 요청이 달라진 사본(열을 줄임)', tests: [testSwitchMatrix], expect: /꺼짐\(A\): 기준\(14455ae\)과 다름|꺼짐\(A\): 성적 요청이/,
        edits: [[FORM_FILE, "                'select': 'test_date,reading,listening,speaking,writing,overall,legacy_total',", "                'select': 'test_date,overall',"]] },
    { name: '꺼진 화면이 전송 담당 함수를 타는 사본(꺼짐인데 켜진 길)', tests: [testSwitchMatrix], expect: /꺼짐\(A\): 기준\(14455ae\)과 다름|꺼짐\(A\): 성적 요청이/,
        edits: [[FORM_FILE, '        const eonAuth = EonLogin.on() ? window.EonAuth : null;', '        const eonAuth = window.EonAuth;'], [FORM_FILE, '        if (EonLogin.on() && (EonLogin.missing() || !eonReads)) {', '        if (!eonReads) {']] },
];

function applyEdits(edits, problems) {
    return (p, text) => {
        let out = text;
        for (const [file, from, to] of edits) {
            if (file !== p) continue;
            if (out.split(from).length !== 2) { problems.push(`바꿀 자리를 정확히 1곳 찾지 못함(${p})`); continue; }
            out = out.replace(from, () => to);
        }
        return out;
    };
}

async function sectionMutants() {
    const problems = [];
    const lines = [];
    for (const m of MUTANTS) {
        const editProblems = [];
        const check = applyEdits(m.edits, editProblems);
        for (const file of new Set(m.edits.map((e) => e[0]))) check(file, workFile(file));
        if (editProblems.length) { problems.push(`감도 "${m.name}": ${editProblems[0]}`); continue; }
        const found = [];
        const crashes = [];
        for (const test of m.tests) {
            try { found.push(...(await test({ mutate: applyEdits(m.edits, []) }))); } catch (e) { crashes.push(String(e && e.message)); }
        }
        const hit = found.filter((p) => m.expect.test(p));
        if (hit.length === 0) {
            problems.push(`감도 "${m.name}": 겨냥한 판정이 깨지지 않음(다른 어긋남 ${found.length}건${found.length ? ' — ' + found[0].slice(0, 90) : ''}, 예외 ${crashes.length}건${crashes.length ? ' — ' + crashes[0].slice(0, 90) : ''})`);
            lines.push(`      - ${m.name}: 잡지 못함`);
        } else {
            lines.push(`      - ${m.name}: 겨냥한 판정 ${hit.length}건이 깨짐${crashes.length ? ` (그 밖에 예외 ${crashes.length}건 — 검출로 세지 않음)` : ''}`);
        }
    }
    return { problems, lines };
}

// run.mjs 가 부르는 한 구획. 돌려주는 값: { problems, lines, info }
export async function sectionMember() {
    const problems = [];
    const lines = [];
    for (const [name, test] of TESTS) {
        let list;
        try { list = await test({}); } catch (e) { list = [`시험 도중 예외: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e}`]; }
        for (const p of list) problems.push(`${name.slice(0, 24)}… › ${p}`);
        lines.push(`    - ${name}: ${list.length === 0 ? '통과' : `어긋남 ${list.length}`}`);
    }
    const mut = await sectionMutants();
    for (const p of mut.problems) problems.push(p);
    lines.push(`    - 감도(일부러 바꾼 사본 ${MUTANTS.length}개 — 변조마다 겨냥한 판정이 깨져야 검출): ${mut.problems.length === 0 ? '모두 검출' : `실패 ${mut.problems.length}`}`);
    for (const l of mut.lines) lines.push(l);
    return { problems, lines, info: { tests: TESTS.length, mutants: MUTANTS.length } };
}

// 따로 돌릴 때
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    installNetworkGuard();
    void fs;
    (async () => {
        const r = await sectionMember();
        for (const l of r.lines) console.log(l);
        for (const p of r.problems) console.log('  · ' + p);
        console.log(`실제 네트워크 요청 ${realNetworkAttempts.length}건`);
        console.log(r.problems.length === 0 && realNetworkAttempts.length === 0 ? '결과: 통과' : `결과: 실패 (${r.problems.length}건)`);
        process.exitCode = r.problems.length === 0 && realNetworkAttempts.length === 0 ? 0 : 1;
    })();
}
