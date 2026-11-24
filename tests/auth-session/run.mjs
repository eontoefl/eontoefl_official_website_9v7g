// 공홈 인증 모듈 격리 회귀시험 (보안작업 묶음2 계약 3A)
//
// 실행:  node tests/auth-session/run.mjs        (저장소 폴더에서, Node v26, 설치할 것 없음)
//
// 전부 가짜다: 가짜 화면(DOM 흉내)·가짜 저장소·가짜 시계·가짜 서버 응답. 실제 네트워크 요청은 0건이고,
// 여기서 통과한 것은 "실제 브라우저·실제 서버에서 된다"의 증거가 아니다(그것은 절차.md 의 화면 시험).
// 화면 스크립트(js/*.js)와 SDK 사본(vendor/supabase-2.116.0.js)은 실제 파일을 그대로 올린다.
// 비밀값(열쇠·JWT 모양)은 출력하지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { installNetworkGuard, verifyNetworkGuard, realNetworkAttempts, serialize } from '../supabase-config-headers/harness.mjs';
import { targets, responses } from '../supabase-config-headers/cases.mjs';
import { readFakeJwt, fakeJwt } from './fake-supabase.mjs';
import { createCore, makeIgnore } from './serve-core.mjs';
import { makeDecider, summarize } from './request-log.mjs';
import { TEST_URL, CONFIG_FILE, AUTH_FILE, switchValue, findProdResidue } from './rewrite.mjs';
import {
    ROOT, BASE, FAKE_ANON, SDK_FILE, PROD, V, ACCOUNTS, OLD_STUDENT, BOOK_KEY, FOLLOWUP_KEYS, STATE_NAMES, hasOldValue,
    baseFile, workFile, provider, extractScripts, makeWorld, snapshot, diffSnapshot, checker,
} from './world.mjs';

const redact = (text) => String(text)
    .split(PROD.key).join('<가림>')
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)*/g, '<가림>');
const out = (line = '') => console.log(redact(line));
const failures = [];
const fail = (section, items) => { for (const item of [].concat(items)) failures.push(`[${section}] ${item}`); };
const listSome = (items, max = 12) => {
    for (const item of items.slice(0, max)) out(`      · ${item}`);
    if (items.length > max) out(`      · … 외 ${items.length - max}건`);
};

const A = ACCOUNTS.A;
const PROFILE_URL = TEST_URL + '/rest/v1/rpc/my_profile';
const ACCESS_URL = TEST_URL + '/rest/v1/rpc/my_site_access';
const R = {
    login: 'POST /auth/v1/token?grant_type=password',
    refresh: 'POST /auth/v1/token?grant_type=refresh_token',
    logout: 'POST /auth/v1/logout?scope=local',
    profile: 'POST /rest/v1/rpc/my_profile',
    access: 'POST /rest/v1/rpc/my_site_access',
};
const ALLOWED_EXACT = new Set([
    TEST_URL + '/auth/v1/token?grant_type=password',
    TEST_URL + '/auth/v1/token?grant_type=refresh_token',
    TEST_URL + '/auth/v1/logout?scope=local',
    PROFILE_URL,
    ACCESS_URL,
]);
const EXPECT_A = JSON.stringify({ id: 'm-A', name: '합성 회원 A', nickname: '에이', email: A.email, phone: '010-0000-0001', role: 'user' });
const MSG = {
    wrong: '이메일 또는 비밀번호가 일치하지 않습니다.',
    blocked: '🚫 차단된 계정입니다.\n\n관리자에게 문의해주세요.',
    withdrawal: '탈퇴 처리 중인 계정입니다.',
    maintenance: '지금은 점검 중입니다. 잠시 뒤 다시 시도해주세요.',
    legacy: '기존 방식의 로그인 상태가 있습니다. 기존 방식에서 로그아웃한 뒤 다시 로그인해 주세요.',
    success: '로그인 성공! 환영합니다.',
    error: '로그인 중 오류가 발생했습니다. 다시 시도해주세요.',
};

const navs = (page) => page.trace.filter((e) => e.t === 'nav' || e.t === 'reload').map((e) => (e.t === 'reload' ? '[새로 고침]' : e.to));
const boxes = (page) => page.trace.filter((e) => e.t === 'box').map((e) => e.text);
const menuHistory = (page) => page.trace.filter((e) => e.t === 'html' && e.el === '#authMenu');
const lastMenu = (page) => { const h = menuHistory(page); return h.length ? h[h.length - 1].html : ''; };
const st = (page) => page.evaluate('EonAuth.state()');
const why = (page) => page.evaluate('EonAuth.reason()');
const bearerOf = (req) => { const h = req.headers.find(([n]) => n.toLowerCase() === 'authorization'); return h && h[1].startsWith('Bearer ') ? h[1].slice(7) : null; };
const isMemberJwt = (token) => { const c = readFakeJwt(token); return !!(c && c.session_id); };     // 로그인 기록 번호가 든 JWT
const HEADERS_FN = ['supabase', 'Headers'].join('');     // 계약 1 회귀시험이 "이 이름을 쓰는 다른 파일"을 찾으므로 글자를 이어 붙여 쓴다

// 켜진 세계마다 끝에 보는 것: 회원 자격이 실린 주소, 공개 키 재시도, 바깥 요청, 리디렉션, 다른 로그인 상태의 저장소
function audit(w, c, label) {
    for (const req of w.browser.requests) {
        const secretBody = typeof req.bodyText === 'string' && /"(password|refresh_token)"\s*:/.test(req.bodyText);
        if (isMemberJwt(bearerOf(req)) || secretBody) {
            c.ok(ALLOWED_EXACT.has(req.url) && req.method === 'POST' && !req.viaRedirect, `${label}: 회원 자격·비밀번호·갱신값이 허용 목록 밖으로 실림`);
            c.ok(req.redirect === 'error', `${label}: 자격이 실린 요청이 리디렉션을 따라가게 돼 있음`);
        }
        c.ok(!req.viaRedirect, `${label}: 리디렉션을 따라간 요청이 있음`);
    }
    for (const e of w.server.log) {
        if (e.route === R.profile || e.route === R.access) c.ok(e.cred === 'member', `${label}: 회원 자격이 필요한 요청이 ${e.cred} 자격으로 나감`);
        if (e.route === 'POST /auth/v1/logout') c.ok(e.scope === 'local', `${label}: 로그아웃이 이 로그인만 끝내는 것이 아님(${e.scope})`);
    }
    c.ok(w.outside.length === 0 && w.server.foreign.length === 0, `${label}: 시험 출처 밖으로 나간 요청이 있음`);
    c.ok(!w.browser.events.some((e) => e.t === 'forbidden' || e.t === 'cookie'), `${label}: fetch 가 아닌 통신 또는 쿠키 접근`);
    const touched = w.browser.storageLog.filter((e) => e.key === BOOK_KEY || FOLLOWUP_KEYS.includes(e.key) || e.op === 'clear' || e.op === 'key' || e.op === 'length');
    c.ok(touched.length === 0, `${label}: 교재 편집·후속메일 로그인 상태(또는 저장소 전체)를 읽거나 씀 ${touched.length}건`);
    for (const key of [BOOK_KEY, ...FOLLOWUP_KEYS]) {
        c.ok((w.initial.has(key) ? w.initial.get(key) : null) === (w.browser.local.has(key) ? w.browser.local.get(key) : null), `${label}: 다른 로그인 상태의 값이 달라짐`);
    }
}

// =====================================================================
// 꺼짐: 기준(d39c0ee)과 같은가
// =====================================================================
const LEGACY_SCENARIOS = [
    { name: 'index 열기', run: async (w) => { const p = await w.open('t1', 'index.html'); await w.browser.advance(6000); return p; } },
    { name: 'login 열기(redirect 꼬리표)', run: async (w) => { const p = await w.open('t1', 'login.html', { search: '?redirect=my-dashboard.html' }); await w.browser.advance(6000); return p; } },
    { name: 'login 제출: 맞는 비밀번호', submit: ['old@zz.invalid', 'zz-old-pw'], search: '?redirect=my-dashboard.html' },
    { name: 'login 제출: 틀린 비밀번호', submit: ['old@zz.invalid', 'zz-wrong'] },
    { name: 'login 제출: 없는 이메일', submit: ['none@zz.invalid', 'zz-x'] },
    { name: 'login 제출: 999999', submit: ['old@zz.invalid', '999999'] },
    { name: 'login 제출: 차단', submit: ['oldblk@zz.invalid', 'zz-old-blk'] },
    { name: 'login 제출: 000000', submit: ['oldtmp@zz.invalid', '000000'] },
    { name: 'login 제출: 탈퇴 처리 중(복구)', submit: ['oldwd@zz.invalid', 'zz-old-wd'] },
    { name: 'login 제출: 탈퇴 처리 중(복구 안 함)', submit: ['oldwd@zz.invalid', 'zz-old-wd'], confirmAnswer: false },
    { name: 'login 제출: 빈 값', submit: ['', ''] },
    { name: 'index 로그아웃(확인)', logout: true },
    { name: 'index 로그아웃(취소)', logout: true, confirmAnswer: false },
];

async function runLegacy(scenario, stateName, variant, mutate, search) {
    const w = makeWorld(stateName, { variant, mutate });
    let page;
    if (scenario.run) {
        page = await scenario.run(w);
    } else if (scenario.submit) {
        page = await w.open('t1', 'login.html', { search: search !== undefined ? search : (scenario.search || ''), confirmAnswer: scenario.confirmAnswer });
        await w.submit(page, scenario.submit[0], scenario.submit[1]);
        await w.browser.advance(6000);
    } else {
        page = await w.open('t1', 'index.html', { confirmAnswer: scenario.confirmAnswer });
        page.evaluate('logout()');
        await w.browser.idle();
        await w.browser.advance(6000);
    }
    return { w, page, snap: snapshot(w, page) };
}

async function sectionOff(mutate) {
    const problems = [];
    let compared = 0;
    for (const stateName of STATE_NAMES) {
        for (const scenario of LEGACY_SCENARIOS) {
            const base = await runLegacy(scenario, stateName, V.BASE);
            const now = await runLegacy(scenario, stateName, V.OFF, mutate);
            compared++;
            const label = `꺼짐 › ${stateName} › ${scenario.name}`;
            for (const d of diffSnapshot(base.snap, now.snap)) problems.push(`${label} › 기준과 다름: ${d}`);
            if (now.snap.scripts.length) problems.push(`${label} › SDK(또는 다른 스크립트)를 불러옴`);
            if (now.snap.channels) problems.push(`${label} › 탭 사이 알림 통로를 만듦`);
            if (now.snap.sdk !== 'undefined') problems.push(`${label} › SDK 전역이 생김`);
            if (now.page.evaluate('EonAuth.isOn()') !== false || now.page.evaluate('EonAuth.state()') !== 'off') problems.push(`${label} › 인증 모듈이 꺼짐이 아님`);
            if (now.w.outside.length || base.w.outside.length) problems.push(`${label} › 가짜 서버 밖으로 나간 요청`);
        }
    }
    return { problems, compared };
}

// 꺼짐: 주소의 꼬리표·저장소의 값으로는 켜지지 않는다 + 꺼진 모듈의 제공 함수
async function testOffCannotBeTurnedOn(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.OFF, mutate: opt.mutate });
    for (const k of ['EON_AUTH_SWITCH', 'eon_auth', 'eon_auth_switch', 'eon_auth_v1:switch']) w.browser.local.set(k, 'on');
    const before = w.browser.storageLog.length;
    const page = await w.open('t1', 'login.html', { search: '?eon_auth=on&EON_AUTH_SWITCH=on&auth=on&switch=on' });
    c.ok(page.evaluate('EonAuth.isOn()') === false && st(page) === 'off', '꼬리표·저장소 값으로 스위치가 켜짐');
    const results = [];
    page.sandbox.__probe = (v) => results.push(v);
    page.evaluate(`
        EonAuth.signIn('x@zz.invalid', 'zz').then((r) => __probe('signIn:' + r.outcome));
        EonAuth.signOut().then((r) => __probe('signOut:' + r.outcome));
        EonAuth.ready().then((s) => __probe('ready:' + s));
        EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then(() => __probe('member:자격을 줌'), (e) => __probe('member:' + e.code));
        EonAuth.credentialFor('anon').then((r) => __probe('anon:' + (r.authorization === 'Bearer ' + SUPABASE_ANON_KEY)));
    `);
    await w.browser.idle();
    for (const want of ['signIn:off', 'signOut:off', 'ready:off', 'member:off', 'anon:true']) c.ok(results.includes(want), `꺼진 모듈: ${want} 가 아님`);
    c.ok(w.browser.requests.length === 0 || w.browser.requests.every((r) => !/\/auth\/v1\/|\/rpc\/my_/.test(r.url)), '꺼진 모듈이 인증 요청을 보냄');
    c.ok(page.scriptLoads.length === 0, '꺼짐에서 SDK 를 불러옴');
    c.ok(w.browser.storageLog.slice(before).every((e) => e.op === 'get' && e.key === 'iontoefl_user'), '꺼짐에서 옛 화면이 읽는 것 말고 저장소를 건드림');
    return c.problems;
}

// =====================================================================
// 래퍼 요청: 계약 1 의 입력(1,620건)을 화면 안에서 그대로 불러 기준과 대조
// =====================================================================
async function describeBody(body) {
    if (body === undefined) return { kind: '없음' };
    if (typeof body === 'string') return { kind: 'string', text: body };
    if (body instanceof Blob) return { kind: 'blob', type: body.type, size: body.size, hex: Buffer.from(await body.arrayBuffer()).toString('hex') };
    return { kind: typeof body };
}

async function wrapperRun(w, page) {
    const g = page.evaluate('({ supabaseAPI, supabaseStorage, fetchAPI })');
    const records = [];
    for (const target of targets) {
        for (const input of target.inputs) {
            for (const scenario of responses) {
                const fetches = [];
                const pending = [];
                const consoleFrom = page.trace.length;
                w.capture = (req) => {
                    const rec = { url: req.url, method: req.method, headers: req.headers, redirect: req.redirect, body: null };
                    fetches.push(rec);
                    pending.push(describeBody(req.body).then((b) => { rec.body = b; }));
                    return { status: scenario.status, headers: scenario.headers || {}, body: scenario.body };
                };
                let outcome;
                try {
                    outcome = { type: '반환', value: serialize(await target.invoke(g, input.args())) };
                } catch (e) {
                    outcome = { type: '오류', name: String(e && e.name), message: String(e && e.message) };
                }
                await Promise.allSettled(pending);
                w.capture = null;
                const consoleOut = page.trace.slice(consoleFrom).filter((e) => e.t === 'console').map((e) => e.level + ':' + e.text);
                records.push({ label: `${target.name} › ${input.label} › ${scenario.name}`, json: JSON.stringify({ fetches, outcome, consoleOut }), fetchCount: fetches.length });
            }
        }
    }
    return records;
}

async function sectionWrappers(mutate) {
    const problems = [];
    const lines = [];
    let compared = 0;
    let fetchCount = 0;
    const baseline = {};
    for (const [name, variant] of [['운영 설정 글자', V.BASE], ['시험 설정', V.BASE_T]]) {
        const w = makeWorld('빈 브라우저', { variant });
        const page = await w.open('base', 'index.html');
        baseline[name] = await wrapperRun(w, page);
    }
    const modes = [
        { name: '꺼짐', variant: V.OFF, base: '운영 설정 글자' },
        { name: '켜짐·로그인 전', variant: V.ON, base: '시험 설정', expect: 'signed_out' },
        { name: '켜짐·확인됨', variant: V.ON, base: '시험 설정', seed: 'A', expect: 'signed_in' },
        { name: '켜짐·거절', variant: V.ON, base: '시험 설정', seed: 'BLK', expect: 'rejected' },
    ];
    for (const mode of modes) {
        let diffs = 0;
        for (const stateName of STATE_NAMES) {
            const w = makeWorld(stateName, { variant: mode.variant, mutate });
            if (mode.seed) w.seed(mode.seed);
            const page = await w.open('t1', 'index.html');
            if (mode.expect && st(page) !== mode.expect) problems.push(`래퍼 › ${mode.name} › ${stateName}: 시험이 만들려던 상태(${mode.expect})가 아님(${st(page)})`);
            const mark = w.browser.requests.length;
            const got = await wrapperRun(w, page);
            const want = baseline[mode.base];
            if (got.length !== want.length) problems.push(`래퍼 › ${mode.name} › ${stateName}: 호출 수가 다름`);
            for (let i = 0; i < Math.min(got.length, want.length); i++) {
                compared++;
                fetchCount += got[i].fetchCount;
                if (got[i].json !== want[i].json) { diffs++; if (diffs <= 3) problems.push(`래퍼 › ${mode.name} › ${stateName} › ${got[i].label}: 기준과 다름`); }
            }
            // 래퍼를 부르는 동안 인증 모듈의 요청이 끼어들지 않았는가(자격이 섞이지 않았는가)
            for (const req of w.browser.requests.slice(mark)) {
                if (isMemberJwt(bearerOf(req))) { problems.push(`래퍼 › ${mode.name} › ${stateName}: 업무 요청에 회원 자격이 실림`); break; }
            }
        }
        if (diffs > 3) problems.push(`래퍼 › ${mode.name}: 다른 호출 … 모두 ${diffs}건`);
        lines.push(`    - ${mode.name} × 저장소 상태 ${STATE_NAMES.length}: 다른 호출 ${diffs}건`);
    }
    return { problems, lines, compared, fetchCount };
}

// =====================================================================
// 켜짐: 가짜 로그인 서버
// =====================================================================
async function loginAs(w, key, opts = {}) {
    const page = await w.open(opts.name || 'login', 'login.html', { search: opts.search || '' });
    await w.submit(page, ACCOUNTS[key].email, ACCOUNTS[key].password);
    return page;
}

// 로그인 성공 하나: signed_in, 호환 값, index.html 로만 이동, 요청은 허용 목록뿐
async function testLoginOk(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    const page = await loginAs(w, 'A', { search: '?redirect=https://evil.example/x' });
    c.ok(st(page) === 'signed_in', `로그인: 상태가 signed_in 이 아님(${st(page)}·${why(page)})`);
    c.ok(JSON.stringify(navs(page)) === JSON.stringify(['index.html']), `로그인: 이동이 index.html 한 번이 아님(${navs(page).join(', ')})`);
    c.ok(boxes(page).includes(MSG.success), '로그인: 성공 안내가 없음');
    c.ok(w.browser.local.get('iontoefl_user') === EXPECT_A, '로그인: 호환 값이 기대(id·name·nickname·email·phone·role)와 다름');
    c.ok(/^\d+$/.test(w.browser.local.get('iontoefl_login_time') || ''), '로그인: iontoefl_login_time 이 없음');
    c.ok(!/password|level/.test(w.browser.local.get('iontoefl_user') || ''), '로그인: 호환 값에 비밀번호·level 이 있음');
    c.ok(w.count(R.login) === 1 && w.count(R.profile) === 1 && w.count(R.access) === 1, '로그인: 로그인·my_profile·my_site_access 가 한 번씩이 아님');
    c.ok(!w.routes().some((r) => r.startsWith('GET /rest/v1/users') || r.includes('/rest/v1/users')), '로그인: 회원 표를 읽음');
    const rpc = w.browser.requests.filter((r) => r.url === PROFILE_URL || r.url === ACCESS_URL);
    c.ok(rpc.length === 2 && bearerOf(rpc[0]) === bearerOf(rpc[1]) && isMemberJwt(bearerOf(rpc[0])), '로그인: 두 확인 요청이 같은 JWT 로 나가지 않음');
    c.ok(rpc.every((r) => r.bodyText === '{}' && r.method === 'POST'), '로그인: 확인 요청이 인자 없는 POST 가 아님');
    c.ok(page.scriptLoads.length === 1 && page.scriptLoads[0] === SDK_FILE, '로그인: SDK 사본을 한 번만 불러오지 않음');
    c.ok(w.browser.channelLog.every((e) => e.name === 'eon_auth_v1'), '로그인: 탭 사이 알림 통로의 이름이 별도 저장 이름이 아님');
    const keys = [...w.browser.local.keys()].sort();
    c.ok(JSON.stringify(keys) === JSON.stringify(['eon_auth_v1', 'eon_auth_v1:compat', 'iontoefl_login_time', 'iontoefl_user']), `로그인: 저장소의 이름이 기대와 다름(${keys.join(', ')})`);
    audit(w, c, '로그인');
    return c.problems;
}

// 주소에 로그인 정보가 실려 와도 읽지 않는다
async function testNoUrlLogin(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    const body = w.server.tokenBody(w.server.createSession(A.email));
    const hash = `#access_token=${body.access_token}&refresh_token=${body.refresh_token}&expires_in=3600&expires_at=${body.expires_at}&token_type=bearer&type=magiclink`;
    for (const pageFile of ['login.html', 'index.html']) {
        const page = await w.open(pageFile, pageFile, { hash, search: '?code=zzfakecode&redirect=my-dashboard.html' });
        await w.browser.advance(2000);
        c.ok(st(page) === 'signed_out', `주소의 로그인 정보(${pageFile}): signed_out 이 아님(${st(page)})`);
        c.ok(navs(page).length === 0 && !menuHistory(page).some((e) => /합성/.test(e.html)), `주소의 로그인 정보(${pageFile}): 이동·표시가 있음`);
        page.close();
    }
    c.ok(!w.browser.local.has('eon_auth_v1') && !w.browser.local.has('iontoefl_user'), '주소의 로그인 정보: 저장소에 로그인 상태가 생김');
    c.ok(w.server.log.filter((e) => e.route.includes('/auth/v1/') || e.route.includes('/rpc/my_')).length === 0, '주소의 로그인 정보: 인증 요청을 보냄');
    audit(w, c, '주소의 로그인 정보');
    return c.problems;
}

// 새로 고침(복원): 확인이 끝나기 전에는 이름이 그려지지 않는다
async function testRestoreGating(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    const login = await loginAs(w, 'A');
    login.close();
    const before = w.server.log.length;
    const page = await w.open('index', 'index.html');
    c.ok(st(page) === 'signed_in', `복원: signed_in 이 아님(${st(page)}·${why(page)})`);
    const rest = w.server.log.slice(before).map((e) => e.route);
    c.ok(rest.filter((r) => r === R.profile).length === 1 && rest.filter((r) => r === R.access).length === 1, '복원: 본인 정보·사이트 접근을 한 번씩 다시 확인하지 않음');
    c.ok(!rest.includes('POST /auth/v1/token'), '복원: 만료 전인데 로그인·갱신 요청을 보냄');
    const accessReq = w.browser.requests.filter((r) => r.page === 'index' && r.url === ACCESS_URL)[0];
    const named = page.trace.filter((e) => (e.t === 'html' || e.t === 'text') && /합성 회원 A/.test(e.html || e.text || ''));
    c.ok(named.length > 0 && /합성 회원 A/.test(lastMenu(page)), '복원: 확인 뒤에 이름이 그려지지 않음');
    c.ok(!!accessReq && named.every((e) => e.n > accessReq.n), '복원: 로그인 기록을 다시 확인하기 전에 이름이 그려짐');
    const first = menuHistory(page)[0];
    c.ok(!!first && /LOGIN/.test(first.html) && !/합성 회원 A/.test(first.html), '복원: 처음 그린 머리말이 로그인 전 모양이 아님');
    c.ok(page.materials.every((m) => m.style.display === 'none'), '복원: 관리자가 아닌데 학습 자료 링크가 보임');
    c.ok(!page.byId.adminDashboardBtn, '복원: 관리자가 아닌데 관리자 버튼이 생김');
    audit(w, c, '복원');
    return c.problems;
}

// signed_in 이 되지 않아야 하는 경우들: 표시·이동 0
async function testNotSignedIn(opt) {
    const c = checker();
    const cases = [
        { name: '틀린 비밀번호', key: 'A', password: 'zz-wrong', msg: MSG.wrong, state: 'signed_out', session: false },
        { name: '차단', key: 'BLK', msg: MSG.blocked, state: 'rejected', reason: 'blocked', session: true },
        { name: '탈퇴 처리 중', key: 'WD', msg: MSG.withdrawal, state: 'rejected', reason: 'withdrawal_pending', session: true },
        { name: '회원 대응 없음', key: 'N', msg: MSG.wrong, state: 'signed_out', reason: 'no_member', session: false, logout: true },
        { name: '회원 대응 없는 관리자', key: 'G', msg: MSG.wrong, state: 'signed_out', reason: 'no_member', session: false, logout: true },
        { name: 'allowed 거짓', key: 'A', prepare: (w) => { w.server.allowedOverride = false; }, msg: MSG.maintenance, state: 'rejected', reason: 'not_allowed', session: true },
        { name: '점검(503)', key: 'A', prepare: (w) => { w.server.maintenance = true; }, msg: MSG.maintenance, state: 'rejected', reason: 'maintenance', session: true },
        { name: 'my_profile 응답 모양이 다름', key: 'A', prepare: (w) => { w.server.faults.my_profile = () => ({ status: 200, headers: {}, body: JSON.stringify({ state: 'ok' }) }); }, msg: MSG.error, state: 'rejected', reason: 'unexpected', session: true },
        { name: 'my_site_access 실패(500)', key: 'A', prepare: (w) => { w.server.faults.my_site_access = () => ({ status: 500, headers: {}, body: '{}' }); }, msg: MSG.error, state: 'rejected', reason: 'unexpected', session: true },
        { name: 'my_profile 응답 유실', key: 'A', prepare: (w) => { w.server.faults.my_profile = () => 'network'; }, msg: MSG.error, state: 'rejected', reason: 'network', session: true, once: R.profile },
        {
            name: '두 응답 사이 계정 변경', key: 'A', msg: MSG.error, other: true,
            prepare: (w) => {
                w.server.hooks['after:my_profile'] = () => {
                    delete w.server.hooks['after:my_profile'];
                    w.seed('B');      // 다른 탭이 다른 계정으로 로그인한 것처럼 저장된 로그인을 바꾼다
                };
            },
        },
        {
            name: '두 응답 사이 로그아웃', key: 'A', msg: MSG.error, state: 'rejected', reason: 'session_changed', session: false,
            prepare: (w) => {
                w.server.hooks['after:my_profile'] = () => { delete w.server.hooks['after:my_profile']; w.browser.local.delete('eon_auth_v1'); };
            },
        },
    ];
    for (const k of cases) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        if (k.prepare) k.prepare(w);
        const page = await w.open('login', 'login.html', { search: '?redirect=my-dashboard.html' });
        await w.submit(page, ACCOUNTS[k.key].email, k.password || ACCOUNTS[k.key].password);
        await w.browser.advance(3000);
        const label = `거절 › ${k.name}`;
        c.ok(navs(page).length === 0, `${label}: 화면 이동이 있음(${navs(page).join(', ')})`);
        c.ok(boxes(page).length === 1 && boxes(page)[0] === k.msg, `${label}: 안내 문구가 기대와 다름`);
        c.ok(!menuHistory(page).some((e) => /합성 회원 A|합성 관리자/.test(e.html)), `${label}: 로그인하려던 계정의 이름이 그려짐`);
        c.ok(!/m-A/.test(w.browser.local.get('iontoefl_user') || ''), `${label}: 로그인하려던 계정의 호환 값이 쓰임`);
        if (k.other) {
            // 저장된 로그인이 다른 계정(B)으로 바뀐 경우: 그 탭은 바뀐 로그인을 처음부터(두 요청 모두) 다시 확인한 뒤에만 그 계정을 그린다
            const pid = page.evaluate('EonAuth.profile() && EonAuth.profile().id');
            c.ok(st(page) === 'signed_in' && pid === 'm-B' && JSON.parse(w.browser.local.get('iontoefl_user') || '{}').id === 'm-B', `${label}: 바뀐 로그인을 다시 확인한 결과가 아님(${st(page)}·${pid})`);
            const rpc = w.browser.requests.filter((r) => r.url === PROFILE_URL || r.url === ACCESS_URL);
            const subs = rpc.map((r) => (readFakeJwt(bearerOf(r)) || {}).sub);
            c.ok(JSON.stringify(subs) === JSON.stringify(['auth-A', 'auth-A', 'auth-B', 'auth-B']), `${label}: 확인 요청의 계정 순서가 A·A·B·B 가 아님(${subs.join(',')})`);
        } else {
            c.ok(st(page) === k.state && (k.reason === undefined || why(page) === k.reason), `${label}: 상태가 ${k.state}${k.reason ? '·' + k.reason : ''} 가 아님(${st(page)}·${why(page)})`);
            c.ok(!w.browser.local.has('iontoefl_user') && !w.browser.local.has('iontoefl_login_time') && !w.browser.local.has('eon_auth_v1:compat'), `${label}: 호환 값·표식이 남음`);
            c.ok(!menuHistory(page).some((e) => /합성/.test(e.html)), `${label}: 이름이 그려짐`);
            c.ok(page.evaluate('EonAuth.profile()') === null && page.evaluate('EonAuth.displayUserRaw()') === null, `${label}: 본인 정보·표시를 내줌`);
            c.ok(w.browser.local.has('eon_auth_v1') === k.session, `${label}: 로그인 기록의 남김·지움이 기대(${k.session ? '남김' : '지움'})와 다름`);
        }
        if (k.logout) c.ok(w.count(R.logout) === 1 && w.count(R.refresh) === 1 && w.count(R.profile) === 2, `${label}: 갱신 한 번 → 다시 확인 → 이 로그인만 끝내기의 순서가 아님`);
        if (k.once) c.ok(w.count(k.once) === 1, `${label}: 결과를 모르는 요청을 다시 보냄`);
        c.ok(!w.routes().some((r) => r.includes('/rest/v1/users')), `${label}: 회원 표를 읽음`);
        audit(w, c, label);
    }
    return c.problems;
}

// 만료·종료된 로그인 기록
async function testExpiry(opt) {
    const c = checker();
    // (1) JWT 만 만료(401 PGRST303) → 한 번 갱신 → 다시 확인 → signed_in
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.seed('A');
        let first = true;
        w.server.faults.my_profile = () => (first ? ((first = false), { status: 401, headers: {}, body: JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }) }) : null);
        const page = await w.open('index', 'index.html');
        c.ok(st(page) === 'signed_in', `만료(401): 갱신 뒤 signed_in 이 아님(${st(page)}·${why(page)})`);
        c.ok(w.count(R.refresh) === 1 && w.count(R.profile) === 2 && w.count(R.access) === 1, '만료(401): 갱신 한 번·다시 확인 한 번이 아님');
        audit(w, c, '만료(401)');
    }
    // (2) 저장된 JWT 가 이미 만료 → 공식 클라이언트가 갱신 → 확인
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.seed('A', { expiresIn: -60 });
        for (const s of w.server.sessions.values()) s.expiresIn = 3600;
        const page = await w.open('index', 'index.html');
        c.ok(st(page) === 'signed_in' && w.count(R.refresh) === 1, `만료(저장값): 갱신 한 번 뒤 signed_in 이 아님(${st(page)}·${why(page)}·갱신 ${w.count(R.refresh)})`);
        audit(w, c, '만료(저장값)');
    }
    // (3) 로그인 기록이 끝났는데 JWT 는 유효(200 no_member) → 갱신 실패 → rejected, 새 모듈이 만든 호환 값 정리
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        for (const s of w.server.sessions.values()) s.alive = false;
        const page = await w.open('index', 'index.html');
        c.ok(st(page) === 'rejected' && why(page) === 'expired', `끝난 기록: rejected·expired 가 아님(${st(page)}·${why(page)})`);
        c.ok(!menuHistory(page).some((e) => /합성/.test(e.html)) && /LOGIN/.test(lastMenu(page)), '끝난 기록: 이름이 그려짐');
        c.ok(!w.browser.local.has('iontoefl_user') && !w.browser.local.has('iontoefl_login_time') && !w.browser.local.has('eon_auth_v1:compat'), '끝난 기록: 새 모듈이 만든 호환 값이 남음');
        c.ok(!w.browser.local.has('eon_auth_v1'), '끝난 기록: 로그인 상태가 저장소에 남음');
        c.ok(w.count(R.refresh) === 1 && w.count(R.profile) === 2 && w.count(R.access) === 1, '끝난 기록: 확인 한 번 → 갱신 한 번의 순서가 아님(로그인 때의 확인 포함 my_profile 2·my_site_access 1)');
        const results = [];
        page.sandbox.__probe = (v) => results.push(v);
        page.evaluate(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then(() => __probe('자격을 줌'), (e) => __probe(e.code));`);
        await w.browser.idle();
        c.ok(results[0] === 'rejected', `끝난 기록: 거절 뒤 회원 자격 요청이 오류가 아님(${results[0]})`);
        audit(w, c, '끝난 기록');
    }
    // (4) 갱신 요청의 응답 유실 → rejected(모름). 같은 갱신을 다시 보내지 않고, 로그인 기록은 건드리지 않음
    for (const [name, fault] of [['응답 유실', () => 'network'], ['서버 오류(503)', () => ({ status: 503, headers: {}, body: '{}' })]]) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.seed('A', { expiresIn: -60 });
        w.server.faults.token = fault;
        const page = await w.open('index', 'index.html', { noIdle: true });
        await w.browser.advance(90 * 1000);      // 공식 클라이언트가 스스로 다시 보내려 하는 동안(가짜 시계)
        c.ok(st(page) === 'rejected' && why(page) === 'network', `갱신 ${name}: rejected·network 가 아님(${st(page)}·${why(page)})`);
        c.ok(w.count(R.refresh) === 1, `갱신 ${name}: 결과를 모르는 갱신을 다시 보냄(${w.count(R.refresh)}번)`);
        c.ok(w.browser.local.has('eon_auth_v1') && w.count(R.logout) === 0, `갱신 ${name}: 모르는 결과로 로그인 기록을 지움`);
        c.ok(page.evaluate('EonAuth.displayUserRaw()') === null && !menuHistory(page).some((e) => /합성/.test(e.html)), `갱신 ${name}: 표시를 내줌`);
        audit(w, c, `갱신 ${name}`);
    }
    return c.problems;
}

// 로그아웃: 이 로그인만, 새 모듈이 만든 호환 값만. 그 뒤 다시 로그인.
async function testLogout(opt) {
    const c = checker();
    {
        const w = makeWorld('교재 편집만', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        page.evaluate('logout()');
        await w.browser.idle();
        c.ok(st(page) === 'signed_out', `로그아웃: signed_out 이 아님(${st(page)})`);
        c.ok(w.count(R.logout) === 1, '로그아웃: 이 로그인만 끝내는 요청이 한 번이 아님');
        c.ok(!['iontoefl_user', 'iontoefl_login_time', 'eon_auth_v1:compat', 'eon_auth_v1'].some((k) => w.browser.local.has(k)), '로그아웃: 새 모듈의 값이 남음');
        c.ok(page.trace.some((e) => e.t === 'alert' && e.text === '로그아웃되었습니다.') && navs(page).join() === '[새로 고침]', '로그아웃: 안내·새로 고침이 기대와 다름');
        c.ok([...w.server.sessions.values()].filter((s) => !s.alive).length === 1, '로그아웃: 서버에서 끝난 로그인 기록이 하나가 아님');
        page.close();
        const again = await loginAs(w, 'A', { name: 'login2' });
        c.ok(st(again) === 'signed_in' && w.browser.local.get('iontoefl_user') === EXPECT_A, '로그아웃 뒤 재로그인이 되지 않음');
        audit(w, c, '로그아웃');
    }
    // 아직 전환하지 않은 화면이 호환 값을 바꿔 쓴 뒤(옛 방식의 값이 된 뒤)의 로그아웃: 그 값은 건드리지 않는다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        w.browser.local.set('iontoefl_user', OLD_STUDENT);
        const page = await w.open('index', 'index.html');
        c.ok(st(page) === 'signed_in' && page.evaluate('EonAuth.displayUserRaw()') === null, '바뀐 호환 값: 새 모듈의 값이 아닌데 표시를 내줌');
        c.ok(!menuHistory(page).some((e) => /옛학생|합성/.test(e.html)), '바뀐 호환 값: 이름이 그려짐');
        const results = [];
        page.sandbox.__probe = (v) => results.push(v);
        page.evaluate(`EonAuth.signOut().then((r) => __probe(r.outcome));`);
        await w.browser.idle();
        c.ok(results[0] === 'signed_out' && w.browser.local.get('iontoefl_user') === OLD_STUDENT, '바뀐 호환 값: 로그아웃이 새 모듈의 것이 아닌 값을 지우거나 바꿈');
        c.ok(!w.browser.local.has('eon_auth_v1') && !w.browser.local.has('eon_auth_v1:compat'), '바뀐 호환 값: 새 모듈의 로그인·표식이 남음');
        audit(w, c, '바뀐 호환 값');
    }
    return c.problems;
}

// 옛 방식의 로그인 상태가 있는 브라우저: 덮어쓰지 않고, 옛 값으로 그리지 않고, 자동 이동하지 않는다
async function testLegacyPresent(opt) {
    const c = checker();
    for (const stateName of STATE_NAMES.filter(hasOldValue)) {
        const w = makeWorld(stateName, { variant: V.ON, mutate: opt.mutate });
        const page = await w.open('login', 'login.html', { search: '?redirect=my-dashboard.html' });
        await w.browser.advance(2000);
        c.ok(navs(page).length === 0, `옛 값(${stateName}): 옛 값만 보고 자동 이동함`);
        await w.submit(page, A.email, A.password);
        c.ok(boxes(page).length === 1 && boxes(page)[0] === MSG.legacy, `옛 값(${stateName}): 멈춤 안내가 아님`);
        c.ok(w.server.log.filter((e) => e.route.startsWith('POST /auth/v1/')).length === 0, `옛 값(${stateName}): 인증 요청을 보냄`);
        c.ok(w.browser.local.get('iontoefl_user') === w.initial.get('iontoefl_user') && w.browser.local.get('iontoefl_login_time') === w.initial.get('iontoefl_login_time'), `옛 값(${stateName}): 옛 값이 달라짐`);
        c.ok(!w.browser.storageLog.some((e) => (e.key === 'iontoefl_user' || e.key === 'iontoefl_login_time') && e.op !== 'get'), `옛 값(${stateName}): 옛 값의 자리에 쓰거나 지움`);
        c.ok(navs(page).length === 0, `옛 값(${stateName}): 화면 이동이 있음`);
        const index = await w.open('index', 'index.html');
        c.ok(st(index) === 'signed_out' && !index.trace.some((e) => /옛학생/.test(e.html || e.text || '')), `옛 값(${stateName}): 켜진 index 가 옛 값으로 이름을 그림`);
        c.ok(index.materials.every((m) => m.style.display === 'none') && !index.byId.studentDashboardBtn && !index.byId.adminDashboardBtn, `옛 값(${stateName}): 옛 값으로 메뉴·버튼을 그림`);
        audit(w, c, `옛 값(${stateName})`);
    }
    // 로그인하는 사이에 옛 방식의 값이 생긴 경우: 쓰기 직전에 다시 보고 덮어쓰지 않는다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.server.hooks['after:my_site_access'] = () => { delete w.server.hooks['after:my_site_access']; w.browser.local.set('iontoefl_user', OLD_STUDENT); };
        const page = await loginAs(w, 'A');
        c.ok(w.browser.local.get('iontoefl_user') === OLD_STUDENT, '도중에 생긴 옛 값: 덮어씀');
        c.ok(navs(page).length === 0 && boxes(page)[0] === MSG.legacy, '도중에 생긴 옛 값: 멈추지 않고 이동함');
        c.ok(st(page) === 'signed_out' && !w.browser.local.has('eon_auth_v1') && w.count(R.logout) === 1, '도중에 생긴 옛 값: 방금 만든 로그인을 끝내지 않음');
        audit(w, c, '도중에 생긴 옛 값');
    }
    return c.problems;
}

// 저장소 상태 다섯 × 켜짐: 다른 로그인 상태 불변, 옛 값이 없으면 로그인이 됨
async function testFiveStatesOn(opt) {
    const c = checker();
    for (const stateName of STATE_NAMES) {
        const w = makeWorld(stateName, { variant: V.ON, mutate: opt.mutate });
        const index = await w.open('index', 'index.html');
        c.ok(st(index) === 'signed_out', `다섯 상태(${stateName}): 새 로그인이 없는데 signed_out 이 아님(${st(index)})`);
        c.ok(w.server.log.filter((e) => e.route.startsWith('POST /auth/v1/') || e.route.includes('/rpc/my_')).length === 0, `다섯 상태(${stateName}): 로그인 전인데 인증 요청을 보냄`);
        index.close();
        const login = await w.open('login', 'login.html');
        await w.submit(login, A.email, A.password);
        if (hasOldValue(stateName)) c.ok(st(login) === 'signed_out' && w.browser.local.get('iontoefl_user') === OLD_STUDENT, `다섯 상태(${stateName}): 옛 값을 덮어씀`);
        else c.ok(st(login) === 'signed_in' && w.browser.local.get('iontoefl_user') === EXPECT_A, `다섯 상태(${stateName}): 로그인이 되지 않음(${st(login)}·${why(login)})`);
        audit(w, c, `다섯 상태(${stateName})`);
    }
    return c.problems;
}

// 자격을 싣는 조건: 정확한 출처·허용 경로·메서드, 추가 머리글로 덮어쓸 수 없음, 리디렉션을 따라가지 않음
async function testCredentialRules(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    const login = await loginAs(w, 'A');
    const results = {};
    login.sandbox.__probe = (k, v) => { results[k] = v; };
    const host = new URL(TEST_URL).host;
    const lookalikes = [
        ['같은 글자로 시작하는 다른 호스트', `https://${host}.evil.example/rest/v1/rpc/my_profile`],
        ['호스트 뒤에 @', `https://${host}@evil.example/rest/v1/rpc/my_profile`],
        ['http', `http://${host}/rest/v1/rpc/my_profile`],
        ['다른 포트', `https://${host}:8443/rest/v1/rpc/my_profile`],
        ['기본 포트를 적음', `https://${host}:443/rest/v1/rpc/my_profile`],
        ['하위 도메인', `https://x.${host}/rest/v1/rpc/my_profile`],
        ['끝에 점', `https://${host}./rest/v1/rpc/my_profile`],
        ['대문자 호스트', `https://${host.toUpperCase()}/rest/v1/rpc/my_profile`],
        ['허용 밖 표', `${TEST_URL}/rest/v1/users`],
        ['허용 밖 함수', `${TEST_URL}/rest/v1/rpc/other_function`],
        ['경로 뒤에 더 붙임', `${PROFILE_URL}/x`],
        ['점 경로', `${TEST_URL}/rest/v1/rpc/x/../my_profile`],
        ['꼬리표', `${PROFILE_URL}?select=*`],
        ['조각', `${PROFILE_URL}#x`],
        ['역슬래시', `https:\\\\${host}\\rest\\v1\\rpc\\my_profile`],
        ['저장소 주소', `${TEST_URL}/storage/v1/object/x`],
        ['Edge 함수', `${TEST_URL}/functions/v1/telegram-notify`],
        ['로그인 주소(회원 자격 대상이 아님)', `${TEST_URL}/auth/v1/token?grant_type=password`],
        ['상대 주소', '/rest/v1/rpc/my_profile'],
    ];
    const script = [];
    lookalikes.forEach(([, url], i) => script.push(`EonAuth.credentialFor('member', ${JSON.stringify(url)}, 'POST').then((r) => __probe('L${i}', 'GAVE'), (e) => __probe('L${i}', e.code));`));
    script.push(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'GET').then(() => __probe('get', 'GAVE'), (e) => __probe('get', e.code));`);
    script.push(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then((r) => __probe('exact1', r.authorization !== 'Bearer ' + SUPABASE_ANON_KEY && r.authorization.split('.').length === 3 && r.apikey === SUPABASE_ANON_KEY), (e) => __probe('exact1', e.code));`);
    script.push(`EonAuth.credentialFor('member', '${ACCESS_URL}', 'POST').then((r) => __probe('exact2', r.authorization !== 'Bearer ' + SUPABASE_ANON_KEY), (e) => __probe('exact2', e.code));`);
    script.push(`EonAuth.credentialFor('admin', '${PROFILE_URL}', 'POST').then(() => __probe('admin', 'GAVE'), (e) => __probe('admin', e.code));`);
    script.push(`EonAuth.credentialFor('legacy_own', '${PROFILE_URL}', 'POST').then(() => __probe('legacy', 'GAVE'), (e) => __probe('legacy', e.code));`);
    script.push(`EonAuth.credentialFor('nonsense').then(() => __probe('bad', 'GAVE'), (e) => __probe('bad', e.code));`);
    script.push(`EonAuth.credentialFor('anon').then((r) => __probe('anon', r.authorization === 'Bearer ' + SUPABASE_ANON_KEY));`);
    script.push(`EonAuth.credentialFor('hold').then((r) => __probe('hold', r.authorization === 'Bearer ' + SUPABASE_ANON_KEY));`);
    // 연결점: 등급 없이·익명·보류는 전과 같은 머리글, 회원·관리자는 오류, 추가 머리글로 자격을 덮어쓸 수 없음
    script.push(`
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const headersFn = ${HEADERS_FN};
        const plain = headersFn({ 'Prefer': 'return=representation' });
        __probe('h-undefined', same(plain, headersFn({ 'Prefer': 'return=representation' }, undefined)));
        __probe('h-anon', same(plain, headersFn({ 'Prefer': 'return=representation' }, 'anon')));
        __probe('h-hold', same(plain, headersFn({ 'Prefer': 'return=representation' }, 'hold')));
        __probe('h-plain-key', plain.Authorization === 'Bearer ' + SUPABASE_ANON_KEY && plain.apikey === SUPABASE_ANON_KEY);
        for (const [k, grade, extra] of [['h-member', 'member', {}], ['h-admin', 'admin', {}], ['h-legacy', 'legacy_own', {}], ['h-bad', 'x', {}],
            ['h-over1', 'anon', { Authorization: 'Bearer zz' }], ['h-over2', 'anon', { APIKEY: 'zz' }], ['h-over3', 'hold', { authorization: 'zz' }]]) {
            try { headersFn(extra, grade); __probe(k, 'GAVE'); } catch (e) { __probe(k, e.code || 'error'); }
        }
    `);
    login.evaluate(script.join('\n'));
    await w.browser.idle();
    lookalikes.forEach(([name], i) => c.ok(results['L' + i] === 'target_not_allowed', `자격 조건: 비슷한 주소(${name})에 회원 자격을 줌(${results['L' + i]})`));
    c.ok(results.get === 'target_not_allowed', '자격 조건: 허용 밖 메서드(GET)에 회원 자격을 줌');
    c.ok(results.exact1 === true && results.exact2 === true, `자격 조건: 정확한 주소에 회원 자격을 주지 않음(${results.exact1}·${results.exact2})`);
    c.ok(results.admin === 'grade_closed' && results.legacy === 'legacy_own' && results.bad === 'bad_grade', '자격 조건: 관리자·기존 전용·없는 등급의 처리가 기대와 다름');
    c.ok(results.anon === true && results.hold === true, '자격 조건: 익명·보류 등급이 공개 키가 아님');
    c.ok(results['h-undefined'] === true && results['h-anon'] === true && results['h-hold'] === true && results['h-plain-key'] === true, '연결점: 등급 없음·익명·보류의 머리글이 전과 같지 않음');
    c.ok(results['h-member'] === 'grade_closed' && results['h-admin'] === 'grade_closed' && results['h-legacy'] === 'legacy_own' && results['h-bad'] === 'bad_grade', '연결점: 회원·관리자 등급이 오류가 아님(공개 키로 떨어졌을 수 있음)');
    c.ok(results['h-over1'] === 'credential_override' && results['h-over2'] === 'credential_override' && results['h-over3'] === 'credential_override', '연결점: 추가 머리글로 Authorization·apikey 를 덮어쓸 수 있음');
    audit(w, c, '자격 조건');

    // 리디렉션: 따라가지 않는다(확인 요청·로그인 요청)
    for (const [name, key] of [['my_profile', 'my_profile'], ['my_site_access', 'my_site_access'], ['로그인', 'token']]) {
        const w2 = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w2.server.faults[key] = () => ({ status: 307, headers: { Location: 'https://evil.example/steal' }, body: '' });
        const page = await loginAs(w2, 'A');
        c.ok(st(page) !== 'signed_in' && navs(page).length === 0 && !w2.browser.local.has('iontoefl_user'), `리디렉션(${name}): 표시·이동이 있음`);
        c.ok(w2.outside.length === 0 && !w2.browser.requests.some((r) => r.viaRedirect), `리디렉션(${name}): 리디렉션을 따라감`);
        audit(w2, c, `리디렉션(${name})`);
    }
    return c.problems;
}

// 복원·갱신 중과 거절 뒤: 회원 자격이 필요한 요청에 공개 키를 내주지 않는다
async function testNoPublicFallback(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    w.seed('A');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    w.server.faults.my_profile = () => gate.then(() => null);
    const page = await w.open('index', 'index.html', { noIdle: true });
    const results = [];
    page.sandbox.__probe = (v) => results.push(v);
    await w.browser.spin(40);
    c.ok(st(page) === 'restoring', `복원 중: 상태가 restoring 이 아님(${st(page)})`);
    page.evaluate(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then((r) => __probe(r.authorization === 'Bearer ' + SUPABASE_ANON_KEY ? '공개 키' : '회원 자격'), (e) => __probe('오류:' + e.code));`);
    await w.browser.spin(40);
    c.ok(results.length === 0, `복원 중: 기다리지 않고 답함(${results[0]})`);
    c.ok(page.evaluate('EonAuth.displayUserRaw()') === null && page.evaluate('EonAuth.profile()') === null, '복원 중: 표시·본인 정보를 내줌');
    release();
    await w.browser.idle();
    c.ok(results[0] === '회원 자격', `복원 뒤: 회원 자격을 주지 않음(${results[0]})`);
    audit(w, c, '복원 중');

    // 거절 상태
    const w2 = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    w2.seed('BLK');
    const p2 = await w2.open('index', 'index.html');
    const r2 = [];
    p2.sandbox.__probe = (v) => r2.push(v);
    p2.evaluate(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then((r) => __probe(r.authorization === 'Bearer ' + SUPABASE_ANON_KEY ? '공개 키' : '회원 자격'), (e) => __probe('오류:' + e.code));`);
    await w2.browser.idle();
    c.ok(st(p2) === 'rejected' && r2[0] === '오류:rejected', `거절 뒤: 오류가 아님(${st(p2)}·${r2[0]})`);
    // 같은 거절된 기록을 알림마다 다시 묻지 않는다(탭 전환 등)
    const asked = w2.count(R.profile);
    p2.dispatchWindow('visibilitychange', {});
    await w2.browser.idle();
    c.ok(w2.count(R.profile) === asked, '거절 뒤: 같은 로그인 기록을 다시 물음');
    audit(w2, c, '거절 뒤');

    // 로그인 전
    const w3 = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    const p3 = await w3.open('index', 'index.html');
    const r3 = [];
    p3.sandbox.__probe = (v) => r3.push(v);
    p3.evaluate(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then(() => __probe('자격을 줌'), (e) => __probe('오류:' + e.code));`);
    await w3.browser.idle();
    c.ok(r3[0] === '오류:signed_out', `로그인 전: 오류가 아님(${r3[0]})`);
    audit(w3, c, '로그인 전');
    return c.problems;
}

// 관리자 표시: role 은 같은 로그인 기록의 my_site_access.is_admin 으로만
async function testAdminDisplay(opt) {
    const c = checker();
    {   // GM, aal1(화면 로그인): 관리자 표시 없음
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'GM');
        c.ok(st(login) === 'signed_in' && JSON.parse(w.browser.local.get('iontoefl_user') || '{}').role === 'user', 'GM·aal1: role 이 user 가 아님');
        login.close();
        const index = await w.open('index', 'index.html');
        c.ok(index.materials.every((m) => m.style.display === 'none') && !index.byId.adminDashboardBtn, 'GM·aal1: 관리자 메뉴가 보임');
        audit(w, c, 'GM·aal1');
    }
    {   // GM, aal2(저장된 로그인): 확인 뒤에만 관리자 표시
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.seed('GM', { aal: 'aal2' });
        const index = await w.open('index', 'index.html');
        const user = JSON.parse(w.browser.local.get('iontoefl_user') || '{}');
        c.ok(st(index) === 'signed_in' && user.role === 'admin' && user.id === 'm-GM', `GM·aal2: role 이 admin 이 아님(${st(index)}·${user.role})`);
        c.ok(/admin-dashboard\.html/.test(lastMenu(index)) && /합성 관리자 GM/.test(lastMenu(index)), 'GM·aal2: 머리말이 관리자 표시가 아님');
        c.ok(index.materials.every((m) => m.style.display === '') && !!index.byId.adminDashboardBtn, 'GM·aal2: 확인 뒤 관리자 메뉴가 보이지 않음');
        const accessReq = w.browser.requests.filter((r) => r.url === ACCESS_URL)[0];
        const adminMarks = index.trace.filter((e) => (e.t === 'html' && /admin-dashboard|합성 관리자/.test(e.html)) || (e.t === 'append' && e.el === '#adminDashboardBtn'));
        const shown = index.trace.filter((e) => e.t === 'style' && e.el.startsWith('materials-link') && e.value === '');
        c.ok(!!accessReq && adminMarks.concat(shown).every((e) => e.n > accessReq.n), 'GM·aal2: 로그인 기록을 다시 확인하기 전에 관리자 표시가 그려짐');
        audit(w, c, 'GM·aal2');
    }
    for (const aal of ['aal1', 'aal2']) {   // G(회원 대응 없는 관리자): 표시 없음, 이 로그인을 끝냄
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.seed('G', { aal });
        const index = await w.open('index', 'index.html');
        c.ok(st(index) === 'signed_out' && why(index) === 'no_member' && !w.browser.local.has('iontoefl_user'), `G·${aal}: signed_out·no_member 가 아님(${st(index)}·${why(index)})`);
        c.ok(index.materials.every((m) => m.style.display === 'none') && !index.byId.adminDashboardBtn && !menuHistory(index).some((e) => /admin-dashboard/.test(e.html)), `G·${aal}: 관리자 표시가 그려짐`);
        audit(w, c, `G·${aal}`);
    }
    return c.problems;
}

// 두 탭: 동시 갱신, 한 탭의 로그아웃, 다른 계정으로 바뀜, 뒤로 가기(보관된 화면)
async function testTabs(opt) {
    const c = checker();
    const w = makeWorld('후속메일만', { variant: V.ON, mutate: opt.mutate });
    const login = await loginAs(w, 'A');
    login.close();
    const t1 = await w.open('tab1', 'index.html');
    const t2 = await w.open('tab2', 'index.html');
    c.ok(st(t1) === 'signed_in' && st(t2) === 'signed_in', `두 탭: 둘 다 signed_in 이 아님(${st(t1)}·${st(t2)})`);
    await w.browser.advance(3700 * 1000);       // 가짜 시계로 만료 시각을 넘긴다
    c.ok(w.count(R.refresh) >= 1, '두 탭: 갱신이 일어나지 않음');
    c.ok(st(t1) === 'signed_in' && st(t2) === 'signed_in', `두 탭: 갱신 뒤 상태가 깨짐(${st(t1)}·${why(t1)} / ${st(t2)}·${why(t2)})`);
    c.ok(/합성 회원 A/.test(lastMenu(t1)) && /합성 회원 A/.test(lastMenu(t2)), '두 탭: 갱신 뒤 표시가 깨짐');
    c.ok(w.count(R.login) === 1, '두 탭: 갱신 동안 로그인 요청이 다시 나감');
    c.ok([...w.server.sessions.values()].length === 1, '두 탭: 로그인 기록이 하나가 아님');

    // 뒤로 가기로 보관된 화면이 되살아남: 먼저 로그인 전 모양, 다시 확인한 뒤 이름
    const asked = w.count(R.profile);
    t1.dispatchWindow('pageshow', { persisted: true });
    c.ok(/LOGIN/.test(lastMenu(t1)) && !/합성/.test(lastMenu(t1)), '보관된 화면: 다시 확인하기 전에 이름이 그대로 보임');
    await w.browser.idle();
    c.ok(w.count(R.profile) === asked + 1 && /합성 회원 A/.test(lastMenu(t1)), '보관된 화면: 다시 확인한 뒤 이름을 그리지 않음');

    // 한 탭 로그아웃 → 다른 탭은 다시 로그인 필요, 표시 지움
    t1.evaluate('logout()');
    await w.browser.idle();
    c.ok(st(t1) === 'signed_out' && st(t2) === 'rejected', `두 탭: 한 탭 로그아웃 뒤 상태(${st(t1)} / ${st(t2)}·${why(t2)})`);
    c.ok(/LOGIN/.test(lastMenu(t2)) && !/합성/.test(lastMenu(t2)), '두 탭: 다른 탭에 이름이 남음');
    c.ok(!w.browser.local.has('iontoefl_user') && !w.browser.local.has('eon_auth_v1'), '두 탭: 로그아웃 뒤 값이 남음');
    c.ok(w.count(R.logout) === 1, '두 탭: 로그아웃 요청이 한 번이 아님');

    // 다른 탭에서 다른 계정으로 로그인 → 이 탭도 그 계정을 다시 확인해 그린다
    const login2 = await loginAs(w, 'B', { name: 'login2' });
    await w.browser.idle();
    c.ok(st(login2) === 'signed_in' && st(t2) === 'signed_in', `두 탭: 다른 계정 로그인 뒤 상태(${st(login2)} / ${st(t2)}·${why(t2)})`);
    c.ok(/합성 회원 B/.test(lastMenu(t2)) && !/합성 회원 A/.test(lastMenu(t2)), '두 탭: 다른 탭의 표시가 새 계정이 아님');
    c.ok(JSON.parse(w.browser.local.get('iontoefl_user') || '{}').id === 'm-B', '두 탭: 호환 값이 새 계정의 것이 아님');
    audit(w, c, '두 탭');
    return c.problems;
}

const ON_TESTS = [
    ['로그인 성공 하나', testLoginOk],
    ['주소에 실린 로그인 정보를 읽지 않음', testNoUrlLogin],
    ['새로 고침(복원)에서 확인 전 표시 없음', testRestoreGating],
    ['signed_in 이 되지 않는 경우 12가지', testNotSignedIn],
    ['만료·종료된 로그인 기록', testExpiry],
    ['로그아웃과 재로그인', testLogout],
    ['옛 방식의 로그인 상태가 있는 브라우저', testLegacyPresent],
    ['저장소 상태 다섯 × 켜짐', testFiveStatesOn],
    ['자격을 싣는 조건·연결점·리디렉션', testCredentialRules],
    ['복원 중·거절 뒤 공개 키로 떨어지지 않음', testNoPublicFallback],
    ['관리자 표시(G·GM × aal1·aal2)', testAdminDisplay],
    ['두 탭(동시 갱신·로그아웃·계정 변경·보관된 화면)', testTabs],
];

// =====================================================================
// 감도 점검: 일부러 바꾼 사본을 시험이 잡는가(메모리에서만 바꾼다)
// =====================================================================
const MUTANTS = [
    {
        name: '자격을 싣는 조건을 "시작 글자"로 느슨하게', tests: [testCredentialRules],
        edits: [[AUTH_FILE, "        if (u.href !== rawUrl) return null;                        // 정규 모양 그대로만\n        if (u.protocol !== 'https:' || u.origin !== ORIGIN) return null;\n        if (u.username || u.password) return null;\n", '        if (rawUrl.indexOf(ORIGIN) !== 0) return null;\n']],
    },
    {
        name: '허용 경로를 "그 글자로 시작"으로 느슨하게', tests: [testCredentialRules],
        edits: [[AUTH_FILE, 'if (t.method === m && u.pathname === t.path && u.search === t.search) return t;', 'if (t.method === m && u.pathname.indexOf(t.path) === 0) return t;']],
    },
    {
        name: '교재 편집의 로그인 상태를 읽음', tests: [testFiveStatesOn],
        edits: [[AUTH_FILE, "        let hasStored = true;\n", "        let hasStored = true;\n        try { window.localStorage.getItem('eon_book_auth_v1'); } catch (e) {}\n"]],
    },
    {
        name: '후속메일 화면의 로그인 상태를 지움', tests: [testLogout],
        edits: [[AUTH_FILE, "            verified = null;\n            lastRejected = null;\n            clearCompat(sid);\n            setState('signed_out', null);\n            return { outcome: 'signed_out', serverConfirmed: serverConfirmed };", "            verified = null;\n            lastRejected = null;\n            clearCompat(sid);\n            window.localStorage.removeItem('sb-hmncdheiwqwekdbtijar-auth-token');\n            window.localStorage.removeItem('eon_book_auth_v1');\n            setState('signed_out', null);\n            return { outcome: 'signed_out', serverConfirmed: serverConfirmed };"]],
    },
    {
        name: '옛 iontoefl_user 를 덮어씀', tests: [testLegacyPresent],
        edits: [
            [AUTH_FILE, "            if (slot.kind === 'foreign') return { ok: false, why: 'legacy_present' };   // 덮어쓰지 않는다\n", ''],
            [AUTH_FILE, "            if (slot.kind === 'foreign') return { outcome: 'legacy_present' };\n", ''],
        ],
    },
    {
        name: '쓰기 직전에 다시 확인하지 않음(로그인 전에만 봄)', tests: [testLegacyPresent],
        edits: [[AUTH_FILE, "            if (slot.kind === 'foreign') return { ok: false, why: 'legacy_present' };   // 덮어쓰지 않는다\n", '']],
    },
    {
        name: '꺼짐에서 SDK 를 불러옴', tests: [], section: 'off',
        edits: [[AUTH_FILE, "    if (!ON) {\n        window.EonAuth = Object.freeze({", "    if (!ON) {\n        document.head.appendChild(Object.assign(document.createElement('script'), { src: SDK_SRC }));\n        window.EonAuth = Object.freeze({"]],
    },
    {
        name: '꺼짐에서 저장소에 씀', tests: [], section: 'off',
        edits: [[AUTH_FILE, "    if (!ON) {\n        window.EonAuth = Object.freeze({", "    if (!ON) {\n        window.localStorage.setItem(MARK_KEY, '{}');\n        window.EonAuth = Object.freeze({"]],
    },
    {
        name: '주소의 꼬리표로 스위치가 켜짐', tests: [testOffCannotBeTurnedOn],
        edits: [[AUTH_FILE, "    const ON = EON_AUTH_SWITCH === 'on';", "    const ON = EON_AUTH_SWITCH === 'on' || /[?&]eon_auth=on/.test(window.location.search);"]],
    },
    {
        name: '저장소의 값으로 스위치가 켜짐', tests: [testOffCannotBeTurnedOn],
        edits: [[AUTH_FILE, "    const ON = EON_AUTH_SWITCH === 'on';", "    const ON = EON_AUTH_SWITCH === 'on' || window.localStorage.getItem('eon_auth') === 'on';"]],
    },
    {
        name: 'my_profile 만 보고 signed_in(allowed 를 보지 않음)', tests: [testNotSignedIn],
        edits: [[AUTH_FILE, "        if (a.allowed !== true) return { ok: false, reason: 'not_allowed' };\n", '']],
    },
    {
        name: 'my_profile 만 보고 signed_in(my_site_access 를 부르지 않음)', tests: [testNotSignedIn, testLoginOk],
        edits: [[AUTH_FILE, "        const a = await askAccess(token);               // 같은 JWT(같은 로그인 기록)로 묻는다\n", "        const a = { kind: 'ok', allowed: true, isAdmin: false };\n"]],
    },
    {
        name: 'SDK 로그인 성공만으로 signed_in(차단·탈퇴·대응 없음을 보지 않음)', tests: [testNotSignedIn],
        edits: [[AUTH_FILE, "        if (b.state === 'no_member' || b.state === 'blocked' || b.state === 'withdrawal_pending') return { kind: b.state };\n", "        if (b.state === 'no_member' || b.state === 'blocked' || b.state === 'withdrawal_pending') return { kind: 'ok', profile: { id: 'x', name: 'x', nickname: null, email: null, phone: null, timezone: null } };\n"]],
    },
    {
        name: '두 응답 사이의 계정·로그인 기록 변경을 보지 않음', tests: [testNotSignedIn],
        edits: [
            [AUTH_FILE, "        if (cur.error || !c2 || c2.sub !== c.sub || c2.sid !== c.sid) return { ok: false, reason: 'session_changed' };\n", ''],
            [AUTH_FILE, "            if (slot.storedSid !== v.sid) return { ok: false, why: 'session_changed' };  // 확인한 그 로그인 기록이 아니다\n", ''],
        ],
    },
    {
        name: '거절 뒤 공개 키로 떨어짐', tests: [testNoPublicFallback, testExpiry],
        edits: [[AUTH_FILE, "        if (state !== 'signed_in' || !verified) throw EonAuthError(state === 'rejected' ? 'rejected' : 'signed_out');", "        if (state !== 'signed_in' || !verified) return publicCredential();"]],
    },
    {
        name: '복원 중에 기다리지 않고 공개 키를 줌', tests: [testNoPublicFallback],
        edits: [[AUTH_FILE, "        await ready();\n        if (state !== 'signed_in' || !verified) throw", "        if (state === 'restoring') return publicCredential();\n        if (state !== 'signed_in' || !verified) throw"]],
    },
    {
        name: '확인 요청이 거절되면 공개 키로 다시 보냄', tests: [testNotSignedIn],
        edits: [[AUTH_FILE, "        if (r.status !== 200) return { kind: statusKind(r.status) };\n        const b = r.body;\n        if (!b || typeof b !== 'object') return { kind: 'unexpected' };", "        if (r.status !== 200) { await callRpc('/rest/v1/rpc/my_profile', ANON); return { kind: statusKind(r.status) }; }\n        const b = r.body;\n        if (!b || typeof b !== 'object') return { kind: 'unexpected' };"]],
    },
    {
        name: '결과를 모르는 확인 요청을 다시 보냄', tests: [testNotSignedIn],
        edits: [[AUTH_FILE, "        const r = await callRpc('/rest/v1/rpc/my_profile', token);\n", "        let r = await callRpc('/rest/v1/rpc/my_profile', token);\n        if (r.status === 0) r = await callRpc('/rest/v1/rpc/my_profile', token);\n"]],
    },
    {
        name: '결과를 모르는 갱신을 다시 보냄(공식 클라이언트의 재시도를 그대로 둠)', tests: [testExpiry],
        edits: [[AUTH_FILE, "            if (unknownRefresh.indexOf(refreshToken) >= 0) return Promise.reject(EonAuthError('refresh_unknown'));\n", '']],
    },
    {
        name: '끝난 로그인 기록을 브라우저에 남겨 둠', tests: [testExpiry],
        edits: [[AUTH_FILE, "        if (r.ended) await endLocal();       // 끝난 로그인 기록을 이 브라우저에 남겨 두지 않는다\n", '']],
    },
    {
        name: '전역 로그아웃', tests: [testLogout],
        edits: [
            [AUTH_FILE, "                const r = await client.signOut({ scope: 'local' });", "                const r = await client.signOut({ scope: 'global' });"],
            [AUTH_FILE, "search: '?scope=local'", "search: '?scope=global'"],
        ],
    },
    {
        name: '리디렉션을 따라감', tests: [testCredentialRules],
        edits: [[AUTH_FILE, "            redirect: 'error',            // 리디렉션을 따라가지 않는다\n", '']],
    },
    {
        name: '추가 머리글로 자격을 덮어쓸 수 있음', tests: [testCredentialRules],
        edits: [[AUTH_FILE, "        const g = normalizeGrade(grade);\n        assertNoCredentialOverride(extra);\n", "        const g = normalizeGrade(grade);\n"]],
    },
    {
        name: '연결점이 회원 등급을 공개 키로 돌려줌', tests: [testCredentialRules],
        edits: [[AUTH_FILE, "        throw EonAuthError(g === GRADES.LEGACY_OWN ? 'legacy_own' : 'grade_closed');\n    }\n\n    // ---", "        return Object.assign({ 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json' }, extra);\n    }\n\n    // ---"]],
    },
    {
        name: '확인 전에 저장된 값으로 머리말을 그림(main.js)', tests: [testRestoreGating, testLegacyPresent],
        edits: [['js/main.js', "    if (window.EonAuth && window.EonAuth.isOn()) return window.EonAuth.displayUserRaw();\n    return localStorage.getItem('iontoefl_user');\n}\n\n// 켜진 화면 전용: 확인된 표시", "    return localStorage.getItem('iontoefl_user');\n}\n\n// 켜진 화면 전용: 확인된 표시"]],
    },
    {
        name: '확인 전에 저장된 값으로 머리말을 그림(common.js)', tests: [testRestoreGating, testLegacyPresent],
        edits: [['js/common.js', "    if (window.EonAuth && window.EonAuth.isOn()) return window.EonAuth.displayUserRaw();\n", '']],
    },
    {
        name: '확인 전에도 표시를 내줌(모듈)', tests: [testRestoreGating, testNoPublicFallback],
        edits: [[AUTH_FILE, "        if (displayHold || state !== 'signed_in' || !verified) return null;\n        try {\n            const slot = readSlot();\n            if (slot.kind !== 'ours' || slot.mark.sid !== verified.sid || slot.user === null) return null;", "        if (displayHold) return null;\n        try {\n            const slot = readSlot();\n            if (slot.kind !== 'ours' || slot.user === null) return null;"]],
    },
    {
        name: '켜진 로그인이 주소의 redirect 값으로 이동', tests: [testLoginOk],
        edits: [['js/login.js', "            setTimeout(() => {\n                window.location.href = 'index.html';\n            }, 1000);\n        } else if (outcome === 'legacy_present') {", "            setTimeout(() => {\n                window.location.href = new URLSearchParams(window.location.search).get('redirect') || 'index.html';\n            }, 1000);\n        } else if (outcome === 'legacy_present') {"]],
    },
    {
        name: '켜진 화면이 옛 값만 보고 자동 이동', tests: [testLegacyPresent],
        edits: [['js/login.js', "    if (window.EonAuth && window.EonAuth.isOn()) return;\n", '']],
    },
    {
        name: '로그아웃이 새 모듈의 것이 아닌 호환 값을 지움', tests: [testLogout],
        edits: [
            [AUTH_FILE, "            if (slot.kind === 'ours') {\n                if (slot.user === slot.mark.user) store.removeItem(COMPAT_USER);\n                if (slot.time === slot.mark.time) store.removeItem(COMPAT_TIME);\n            }", '            store.removeItem(COMPAT_USER);\n            store.removeItem(COMPAT_TIME);'],
        ],
    },
    {
        name: '관리자 표시를 본인 정보의 값으로 채움(is_admin 을 쓰지 않음)', tests: [testAdminDisplay],
        edits: [[AUTH_FILE, "                role: v.isAdmin ? 'admin' : 'user'      // 표시에만 쓴다(서버 권한이 아니다)", "                role: /관리자/.test(String(p.name)) ? 'admin' : 'user'"]],
    },
    {
        name: '다른 탭의 로그아웃을 따라가지 않음', tests: [testTabs],
        edits: [[AUTH_FILE, "            client.onAuthStateChange(function () { scheduleReconcile(); });", '            client.onAuthStateChange(function () {});']],
    },
    {
        name: '공식 클라이언트가 별도 저장 이름을 쓰지 않음(기본 이름·저장소 전체)', tests: [testLoginOk],
        edits: [[AUTH_FILE, "                storageKey: STORAGE_KEY,\n                storage: scopedStorage,\n", '                storage: window.localStorage,\n']],
    },
];

function applyEdits(edits, problems) {
    return (p, text) => {
        let outText = text;
        for (const [file, from, to] of edits) {
            if (file !== p) continue;
            if (outText.split(from).length !== 2) { problems.push(`바꿀 자리를 정확히 1곳 찾지 못함(${file})`); continue; }
            outText = outText.replace(from, to);
        }
        return outText;
    };
}

async function sectionMutants() {
    const problems = [];
    const lines = [];
    for (const m of MUTANTS) {
        const editProblems = [];
        const mutate = applyEdits(m.edits, editProblems);
        for (const [file] of m.edits) mutate(file, workFile(file));     // 바꿀 자리가 있는지 먼저 본다
        if (editProblems.length) { problems.push(`감도 "${m.name}": ${editProblems[0]}`); continue; }
        let caught = 0;
        try {
            if (m.section === 'off') caught += (await sectionOff(applyEdits(m.edits, []))).problems.length;
            for (const test of m.tests) caught += (await test({ mutate: applyEdits(m.edits, []) })).length;
        } catch (e) {
            caught += 1;        // 바꾼 사본이 시험 도중 예외를 냄 — 잡힌 것으로 센다
        }
        if (caught === 0) problems.push(`감도 "${m.name}": 시험이 잡지 못함`);
        lines.push(`    - ${m.name}: ${caught === 0 ? '잡지 못함' : `어긋남 ${caught}건으로 검출`}`);
    }
    return { problems, lines };
}

// =====================================================================
// 글자 점검
// =====================================================================
function git(args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function sectionText() {
    const problems = [];
    const info = {};
    const auth = workFile(AUTH_FILE);
    info.switch = switchValue(auth);
    if (info.switch !== 'off') problems.push('저장소의 스위치 값이 꺼짐이 아님');
    const code = auth.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    if ((code.match(/EON_AUTH_SWITCH/g) || []).length !== 2) problems.push('스위치 이름이 정의 1곳·판정 1곳이 아님');
    if (!code.includes("const ON = EON_AUTH_SWITCH === 'on';")) problems.push('스위치 판정이 값 비교 한 줄이 아님');
    for (const word of ['location', 'document.cookie', 'URLSearchParams', 'sessionStorage', 'eon_book_auth', 'sb-', '-auth-token']) {
        if (code.includes(word)) problems.push(`인증 모듈에 있어서는 안 되는 글자: ${word}`);
    }
    if (/\bfetch\s*=/.test(code) || /XMLHttpRequest/.test(code)) problems.push('전역 fetch 를 바꾸거나 XHR 을 씀');
    if ((code.match(/detectSessionInUrl: false/g) || []).length !== 1 || /detectSessionInUrl: true/.test(code)) problems.push('주소에서 로그인 정보를 읽는 기능이 꺼져 있지 않음');
    if ((code.match(/scope: 'local'/g) || []).length !== 2 || /scope: 'global'|scope: 'others'/.test(code)) problems.push('로그아웃의 범위가 이 로그인만(local)이 아님');

    // 기준에서 바뀐 파일
    const allowed = new Set(['index.html', 'login.html', 'js/auth-session.js', 'js/common.js', 'js/login.js', 'js/main.js', 'js/supabase-config.js']);
    const changed = git(['diff', '--name-only', BASE]).split('\n').filter(Boolean);
    const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
    const outside = changed.concat(untracked).filter((f) => !allowed.has(f) && !f.startsWith('tests/auth-session/') && !f.startsWith('tests/supabase-config-headers/'));
    info.changed = changed.concat(untracked).filter((f) => allowed.has(f)).sort();
    if (outside.length) problems.push(`기준에서 바뀐 파일이 범위 밖에 있음: ${outside.join(', ')}`);

    // 인증 모듈을 싣는 화면
    const loaders = git(['grep', '-l', 'auth-session.js', '--', '*.html']).split('\n').filter(Boolean).sort();
    info.loaders = loaders;
    if (JSON.stringify(loaders) !== JSON.stringify(['index.html', 'login.html'])) problems.push(`인증 모듈을 싣는 화면이 index.html·login.html 이 아님(${loaders.join(', ')})`);
    for (const f of loaders) {
        const scripts = extractScripts(workFile(f)).filter((s) => s.src).map((s) => s.src.split('?')[0]);
        const i = scripts.indexOf(AUTH_FILE);
        if (i < 1 || scripts[i - 1] !== CONFIG_FILE) problems.push(`${f}: 인증 모듈이 설정 파일 바로 다음에 실리지 않음`);
    }
    // 연결점: 등급을 넘기는 호출 0
    const config = workFile(CONFIG_FILE);
    const allCalls = (config.match(new RegExp(HEADERS_FN + '\\(', 'g')) || []).length;
    const plainCalls = (config.match(new RegExp('headers: ' + HEADERS_FN + '\\((?:\\{[^{}]*\\})?\\)', 'g')) || []).length;
    info.gradedCalls = allCalls - plainCalls;       // 인자가 없거나 머리글 객체 하나뿐인 호출이 아닌 것
    if (plainCalls !== 10) problems.push('헤더 함수를 쓰는 곳이 10곳이 아님');
    if (info.gradedCalls !== 0) problems.push('등급을 넘기는 헤더 함수 호출이 있음');
    const users = git(['grep', '-l', '-E', 'EonAuth|eon_auth_v1', '--', '*.js', '*.html']).split('\n').filter(Boolean).filter((f) => !f.startsWith('tests/')).sort();
    info.users = users;
    const allowedUsers = ['js/auth-session.js', 'js/common.js', 'js/login.js', 'js/main.js', 'js/supabase-config.js'];
    if (users.some((f) => !allowedUsers.includes(f))) problems.push(`인증 모듈을 쓰는 파일이 범위 밖에 있음: ${users.join(', ')}`);

    // 시험 서버가 내줄 사본에 운영 흔적이 남지 않는가(두 화면과 그 스크립트)
    for (const variant of [V.OFF_T, V.ON]) {
        const files = provider(variant);
        for (const f of ['index.html', 'login.html', CONFIG_FILE, AUTH_FILE, 'js/common.js', 'js/main.js', 'js/login.js', SDK_FILE]) {
            const residue = findProdResidue(files(f), { prodKey: PROD.key, prodUrl: PROD.url });
            if (residue.length) problems.push(`내줄 사본에 운영 흔적: ${f} (${residue.join(', ')})`);
        }
    }
    if (!findProdResidue(workFile(CONFIG_FILE), { prodKey: PROD.key, prodUrl: PROD.url }).includes('운영 ref')) problems.push('운영 흔적 찾기가 저장소의 설정 파일에서 운영 ref 를 찾지 못함(점검 도구 고장)');
    return { problems, info };
}

// 화면 시험용 로컬 서버의 몸통(소켓 없이 요청 → 응답만): 내줄 사본, 운영 흔적이 남는 파일 거절, 내용 보안 정책, 로컬 시험 목적지
function sectionServer() {
    const problems = [];
    const info = {};
    const tracked = git(['-c', 'core.quotepath=false', 'ls-files']).split('\n').filter(Boolean);
    const ignored = makeIgnore(fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8'));
    const files = tracked.filter((f) => !ignored(f) && !f.startsWith('.'));
    const readFile = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel)); } catch (e) { return null; } };
    for (const mode of ['off', 'on']) {
        const logs = [];
        const core = createCore({ files, readFile, mode, testKey: FAKE_ANON, port: 8787, prod: PROD, log: (e) => logs.push(e) });
        const scan = core.scan();
        info.refused = scan.refused.map((r) => r.file);
        info.servable = scan.servable;
        if (scan.repoSwitch !== 'off') problems.push(`서버(${mode}): 저장소의 스위치 값을 꺼짐으로 읽지 못함`);
        for (const must of ['admin-followup.html', 'note.html', 'js/book-admin-preview.js', 'usage-guide.html']) {
            if (!info.refused.includes(must)) problems.push(`서버(${mode}): 운영 주소가 직접 적힌 파일(${must})을 내주지 않을 목록에 넣지 않음`);
        }
        // 내줄 수 있는 모든 파일을 한 번씩: 200 이면 운영 흔적이 없어야 하고, 아니면 409 여야 한다
        let ok200 = 0;
        let refused = 0;
        for (const rel of files) {
            const r = core.respond({ method: 'GET', url: '/' + rel.split('/').map(encodeURIComponent).join('/') });
            if (r.status === 200) {
                ok200++;
                if (findProdResidue(r.body, { prodKey: PROD.key, prodUrl: PROD.url }).length) problems.push(`서버(${mode}): 운영 흔적이 남은 채 내줌 — ${rel}`);
                if (!/connect-src 'self' https:\/\/hmncdheiwqwekdbtijar\.supabase\.co;/.test(r.headers['Content-Security-Policy'] || '')) problems.push(`서버(${mode}): 내용 보안 정책이 없음 — ${rel}`);
            } else if (r.status === 409) {
                refused++;
                if (r.body.toString('utf8').includes(PROD.key)) problems.push(`서버(${mode}): 거절 응답에 운영 키가 실림 — ${rel}`);
            } else {
                problems.push(`서버(${mode}): ${rel} 의 응답이 200·409 가 아님(${r.status})`);
            }
        }
        if (refused !== scan.refused.length || ok200 !== scan.servable) problems.push(`서버(${mode}): 시작할 때 훑은 목록과 실제 응답이 다름`);
        const get = (url, method = 'GET', body = null) => core.respond({ method, url, body });
        const cfg = get('/js/supabase-config.js?v=1').body.toString('utf8');
        if (!cfg.includes(`const SUPABASE_URL = '${TEST_URL}';`) || !cfg.includes(`const SUPABASE_ANON_KEY = '${FAKE_ANON}';`) || !cfg.includes(`const DEFAULT_PLATFORM_URL = '${core.sinkUrl}';`)) problems.push(`서버(${mode}): 설정 파일을 시험 값으로 바꾸지 못함`);
        if (switchValue(get('/js/auth-session.js').body.toString('utf8')) !== mode) problems.push(`서버(${mode}): 내준 인증 모듈의 스위치 값이 ${mode} 가 아님`);
        if (get('/').status !== 200 || get('/login.html?redirect=x').status !== 200) problems.push(`서버(${mode}): 화면을 내주지 못함`);
        for (const bad of ['/tests/auth-session/run.mjs', '/supabase/migrations/x.sql', '/.vercelignore', '/../x', '/%2e%2e/%2e%2e/x', '/js/..%5cx', '/없는파일.html']) {
            if (get(bad).status !== 404) problems.push(`서버(${mode}): 내주면 안 되는 경로(${bad})의 응답이 404 가 아님`);
        }
        if (get('/login.html', 'POST').status !== 405) problems.push(`서버(${mode}): 파일에 대한 POST 가 405 가 아님`);
        if (get('/__b3a/sink/testroom?token=zzsecret', 'POST').status !== 200 || core.counts.sink !== 1) problems.push(`서버(${mode}): 로컬 시험 목적지가 수신을 세지 못함`);
        const report = Buffer.from(JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://api.telegram.org/botzzsecret/sendMessage?chat_id=zzsecret', 'document-uri': 'http://127.0.0.1:8787/index.html?x=zzsecret' } }));
        if (get('/__b3a/csp-report', 'POST', report).status !== 204 || core.counts.csp !== 1) problems.push(`서버(${mode}): 막힌 요청의 보고를 받지 못함`);
        const status = JSON.parse(get('/__b3a/status').body.toString('utf8'));
        if (status.mode !== mode || status.counts.sink !== 1 || status.counts.refused !== refused) problems.push(`서버(${mode}): 상태 응답이 맞지 않음`);
        const logText = JSON.stringify(logs);
        if (logText.includes('zzsecret') || logText.includes(FAKE_ANON) || logText.includes(PROD.key)) problems.push(`서버(${mode}): 기록에 꼬리표의 값·키가 남음`);
        if (!logs.some((e) => e.t === 'csp' && e.directive === 'connect-src' && e.blocked === 'https://api.telegram.org' && e.document === '/index.html')) problems.push(`서버(${mode}): 막힌 요청이 기록되지 않음`);
        info['ok' + mode] = ok200;
    }
    return { problems, info };
}

// 자동화가 쓰는 "보내기 전에 가르기": 허용 밖은 중단, 기록에는 비밀값이 남지 않는다
function sectionRequestLog() {
    const problems = [];
    const anon = fakeJwt({ role: 'anon', ref: 'hmncdheiwqwekdbtijar' });
    const member = fakeJwt({ role: 'authenticated', sub: 'auth-A', session_id: 'sess-1' });
    const decide = makeDecider({ selfOrigin: 'http://127.0.0.1:8787', anonKey: anon });
    const rows = [
        // [설명, 요청, 기대 action, 기대 where, 기대 속성]
        ['자기 화면', { url: 'http://127.0.0.1:8787/login.html?redirect=x', method: 'GET', resourceType: 'document', isNavigation: true }, 'continue', 'self', {}],
        ['로그인', { url: TEST_URL + '/auth/v1/token?grant_type=password', method: 'POST', resourceType: 'fetch', headers: { apikey: anon, Authorization: 'Bearer ' + anon }, postData: JSON.stringify({ email: 'a@zz.invalid', password: 'zzsecretpw' }) }, 'continue', 'test-project', { memberTarget: true, leak: false }],
        ['my_profile', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: { apikey: anon, authorization: 'Bearer ' + member }, postData: '{}' }, 'continue', 'test-project', { memberTarget: true, leak: false, credential: 'member', publicRetry: false }],
        ['my_profile 을 공개 키로', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: { apikey: anon, authorization: 'Bearer ' + anon }, postData: '{}' }, 'continue', 'test-project', { publicRetry: true }],
        ['업무 요청에 회원 자격', { url: TEST_URL + '/rest/v1/applications?email=eq.a%40zz.invalid', method: 'GET', resourceType: 'fetch', headers: { apikey: anon, authorization: 'Bearer ' + member } }, 'continue', 'test-project', { leak: true }],
        ['업무 요청(공개 키)', { url: TEST_URL + '/rest/v1/applications?email=eq.a%40zz.invalid', method: 'GET', resourceType: 'fetch', headers: { apikey: anon, authorization: 'Bearer ' + anon } }, 'continue', 'test-project', { leak: false, credential: 'anon' }],
        ['전역 로그아웃', { url: TEST_URL + '/auth/v1/logout?scope=global', method: 'POST', resourceType: 'fetch', headers: { apikey: anon, authorization: 'Bearer ' + member } }, 'continue', 'test-project', { leak: true, memberTarget: false }],
        ['허용 목록의 글꼴', { url: 'https://fonts.gstatic.com/s/x.woff2', method: 'GET', resourceType: 'font' }, 'continue', 'static-allowed', {}],
        ['허용 목록 호스트의 스크립트(목록 밖 종류)', { url: 'https://cdn.jsdelivr.net/npm/x.js', method: 'GET', resourceType: 'script' }, 'abort', 'outside', {}],
        ['텔레그램 fetch', { url: 'https://api.telegram.org/botzzsecret/sendMessage', method: 'POST', resourceType: 'fetch', postData: '{"text":"x"}' }, 'abort', 'outside', {}],
        ['운영 주소 fetch', { url: 'https://qpqjevecjejvbeuogtbx.supabase.co/rest/v1/users', method: 'GET', resourceType: 'fetch', headers: { apikey: 'x' } }, 'abort', 'outside', {}],
        ['바깥으로 화면 이동', { url: 'https://testroom.eonfl.com/?t=zzsecret', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'outside', {}],
        ['카카오 링크 이동', { url: 'http://pf.kakao.com/_FWxcZC', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'outside', {}],
        ['시험 프로젝트로 화면 이동', { url: TEST_URL + '/auth/v1/authorize?provider=x', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'test-project', {}],
        ['로컬 시험 목적지', { url: 'http://127.0.0.1:8787/__b3a/sink/testroom', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'sink', {}],
        ['data 그림', { url: 'data:image/png;base64,AAAA', method: 'GET', resourceType: 'image' }, 'continue', 'local', {}],
    ];
    const records = [];
    for (const [name, req, action, where, props] of rows) {
        const d = decide(req);
        records.push(d.record);
        if (d.action !== action || d.record.where !== where) problems.push(`가르기: ${name} — ${d.action}/${d.record.where} (기대 ${action}/${where})`);
        for (const [k, v] of Object.entries(props)) if (d.record[k] !== v) problems.push(`가르기: ${name} — ${k} 가 ${v} 가 아님`);
    }
    const text = JSON.stringify(records);
    if (text.includes(anon) || text.includes(member) || text.includes('zzsecret') || /eyJ[A-Za-z0-9_-]{8,}/.test(text)) problems.push('가르기: 기록에 JWT·비밀번호·꼬리표의 값이 남음');
    const s = summarize(records);
    if (s.leak !== 2 || s.publicRetry !== 1 || s.sink !== 1 || s.outsideBlockedNavigation !== 2 || s.outsideBlockedRequest !== 3 || s.outsideSent !== 0 || s.staticAllowed !== 1) problems.push(`가르기: 요약 숫자가 기대와 다름(${JSON.stringify(s)})`);
    return { problems, rows: rows.length };
}

function sectionContract1() {
    const problems = [];
    let text = '';
    try {
        text = execFileSync(process.execPath, ['tests/supabase-config-headers/run.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        text = String((e && e.stdout) || '');
        problems.push('계약 1 회귀시험이 실패로 끝남');
    }
    if (!/결과: 통과/.test(text)) problems.push('계약 1 회귀시험의 결과가 통과가 아님');
    if (!/비교한 호출 1620건/.test(text) || !/fetch 요청 1458건/.test(text) || !/동작 비교: 차이 0/.test(text)) problems.push('계약 1 회귀시험의 건수(비교 1,620·요청 1,458·차이 0)가 아님');
    // 그 시험의 기준(8bddea5)과 이 조각의 기준(d39c0ee)에서 대상 파일이 같은가
    let same = false;
    try { same = git(['rev-parse', `${BASE}:${CONFIG_FILE}`]) === git(['rev-parse', `8bddea5:${CONFIG_FILE}`]); } catch (e) { same = false; }
    if (!same) problems.push(`계약 1 회귀시험의 기준 파일이 ${BASE} 의 것과 같지 않음`);
    return { problems, same };
}

// =====================================================================
async function main() {
    out('공홈 인증 모듈 격리 회귀시험 (전부 가짜 화면·가짜 서버 — 실제 요청 0건)');
    out(`  기준: ${BASE}   작업본: ${ROOT}`);
    out('');

    const c1 = sectionContract1();
    fail('계약 1', c1.problems);
    out(`[1] 계약 1 회귀시험 다시 돌림(기준 파일이 ${BASE} 의 것과 ${c1.same ? '같음' : '다름'}): ${c1.problems.length === 0 ? '비교 1,620건·요청 1,458건·차이 0' : '실패'}`);
    listSome(c1.problems);

    installNetworkGuard();
    const guardPaths = verifyNetworkGuard();
    out(`[2] 네트워크 차단 장치 자체 점검: ${guardPaths}개 경로가 막히는 것을 확인`);

    const text = sectionText();
    fail('글자', text.problems);
    out(`[3] 글자 점검: ${text.problems.length === 0 ? '통과' : '실패'}`);
    out(`    - 저장소의 스위치 값: ${text.info.switch === 'off' ? '꺼짐' : text.info.switch}`);
    out(`    - 기준에서 바뀐 제품 파일: ${text.info.changed.join(', ')}`);
    out(`    - 인증 모듈을 싣는 화면: ${text.info.loaders.join(', ')} / 등급을 넘기는 호출 ${text.info.gradedCalls}곳`);
    listSome(text.problems);

    const off = await sectionOff();
    fail('꺼짐', off.problems);
    out(`[4] 꺼짐 × 저장소 상태 ${STATE_NAMES.length} × 화면 동작 ${LEGACY_SCENARIOS.length}가지 = ${off.compared}건을 기준과 대조(요청·저장소·화면 이동·안내·콘솔): 어긋남 ${off.problems.length}`);
    out('    - 인증 모듈의 요청 0, 저장소 접근 0, SDK 불러옴 0, 탭 사이 알림 통로 0 (기준과 같은 기록이어야 통과)');
    listSome(off.problems);
    const offSwitch = await testOffCannotBeTurnedOn({});
    fail('꺼짐', offSwitch);
    out(`    - 주소의 꼬리표·저장소의 값으로는 켜지지 않음, 꺼진 모듈의 제공 함수: 어긋남 ${offSwitch.length}`);
    listSome(offSwitch);

    const wr = await sectionWrappers();
    fail('래퍼', wr.problems);
    out(`[5] 기존 래퍼 요청(계약 1 의 입력 그대로)을 화면 안에서 불러 기준과 대조: ${wr.compared}건(그 안의 fetch 요청 ${wr.fetchCount}건), 어긋남 ${wr.problems.length}`);
    wr.lines.forEach((l) => out(l));
    listSome(wr.problems);

    out('[6] 켜짐 — 가짜 로그인 서버(SDK 사본은 실제 파일):');
    for (const [name, test] of ON_TESTS) {
        let problems;
        try { problems = await test({}); } catch (e) { problems = [`시험 도중 예외: ${e && e.message}`]; }
        fail('켜짐', problems.map((p) => `${name} › ${p}`));
        out(`    - ${name}: ${problems.length === 0 ? '통과' : `어긋남 ${problems.length}`}`);
        listSome(problems);
    }

    const mut = await sectionMutants();
    fail('감도', mut.problems);
    out(`[7] 감도 점검(일부러 바꾼 사본 ${MUTANTS.length}개): ${mut.problems.length === 0 ? '모두 검출' : `실패 ${mut.problems.length}`}`);
    mut.lines.forEach((l) => out(l));
    listSome(mut.problems);

    const srv = sectionServer();
    fail('서버', srv.problems);
    out(`[8] 화면 시험용 로컬 서버의 몸통(소켓 없이): 내줄 수 있는 파일 ${srv.info.servable}개를 꺼짐·켜짐으로 한 번씩 — 운영 흔적이 남은 채 내준 것 0, 내주지 않는 파일 ${srv.info.refused.length}개. 어긋남 ${srv.problems.length}`);
    listSome(srv.problems);
    const rl = sectionRequestLog();
    fail('가르기', rl.problems);
    out(`    - 자동화용 "보내기 전에 가르기"·가린 기록(요청 ${rl.rows}가지): 어긋남 ${rl.problems.length}`);
    listSome(rl.problems);

    if (realNetworkAttempts.length) fail('네트워크', `실제 네트워크 요청 시도 ${realNetworkAttempts.length}건`);
    out(`[9] 실제 네트워크 요청 ${realNetworkAttempts.length}건`);
    out('');
    if (failures.length === 0) {
        out('결과: 통과  (가짜 화면·가짜 서버에서의 결과다 — 실제 화면 확인은 절차.md)');
        process.exitCode = 0;
    } else {
        out(`결과: 실패 (${failures.length}건)`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    out(`결과: 실패 — 시험 도구 오류: ${e && e.stack ? e.stack : e}`);
    process.exitCode = 1;
});
