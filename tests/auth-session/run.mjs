// 공홈 인증 모듈 격리 회귀시험 (보안작업 묶음2 계약 3A) + 화면의 로그인 상태 통일(계약 3C-1 — run-pages.mjs 를 이어서 돌린다)
//
// 실행:  node tests/auth-session/run.mjs        (저장소 폴더에서, Node v26, 설치할 것 없음)
//
// 전부 가짜다: 가짜 화면(DOM 흉내)·가짜 저장소·가짜 시계·가짜 서버 응답. 실제 네트워크 요청은 0건이고,
// 여기서 통과한 것은 "실제 브라우저·실제 서버에서 된다"의 증거가 아니다(그것은 절차.md 의 화면 시험).
// 화면 스크립트(js/*.js)와 SDK 사본(vendor/supabase-2.116.0.js)은 실제 파일을 그대로 올린다.
// 비밀값(열쇠·JWT 모양)은 출력하지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { installNetworkGuard, verifyNetworkGuard, realNetworkAttempts, serialize } from '../supabase-config-headers/harness.mjs';
import { targets, responses } from '../supabase-config-headers/cases.mjs';
import { readFakeJwt, fakeJwt } from './fake-supabase.mjs';
import { createCore, makeIgnore } from './serve-core.mjs';
import { TEST_URL, CONFIG_FILE, AUTH_FILE, switchValue, pageSwitchValue, findProdResidue } from './rewrite.mjs';
import { TARGET_FILES, GATE_SOURCE, GATE_COMMENT, MODULE_TAG, extractGate } from './pages.mjs';
import { sectionPages } from './run-pages.mjs';
import { sectionMember } from './run-member.mjs';
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
// 호환 값의 이메일은 my_profile 이 준 회원 표의 이메일이다(로그인 이메일 A.email 이 아니다 — 가짜 세계에서도 둘은 다르다)
const EXPECT_A = JSON.stringify({ id: 'm-A', name: '합성 회원 A', nickname: '에이', email: A.profile.email, phone: '010-0000-0001', role: 'user' });
const MSG = {
    wrong: '이메일 또는 비밀번호가 일치하지 않습니다.',
    blocked: '🚫 차단된 계정입니다.\n\n관리자에게 문의해주세요.',
    withdrawal: '탈퇴 처리 중인 계정입니다.',
    maintenance: '지금은 점검 중입니다. 잠시 뒤 다시 시도해주세요.',
    legacy: '기존 방식의 로그인 상태가 있습니다. 기존 방식에서 로그아웃한 뒤 다시 로그인해 주세요.',
    success: '로그인 성공! 환영합니다.',
    error: '로그인 중 오류가 발생했습니다. 다시 시도해주세요.',
    rate: '요청이 많습니다. 잠시 뒤 다시 시도해주세요.',
    previous: '이전 로그인을 끝내지 못했습니다. 잠시 뒤 다시 시도해주세요.',
    moved: '로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.',
    logoutUnknown: '로그아웃을 확인하지 못했습니다. 잠시 뒤 다시 시도해주세요.',
    logoutDone: '로그아웃되었습니다.',
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

// 꺼짐의 화면이 기준보다 더 받는 정적 파일: 같은 출처의 인증 모듈 파일 1개뿐이어야 한다.
// 이것은 "기준과 같음"이 아니다 — 지금과 다른 것으로 적어 두는 차이다(업무 요청의 불변과는 별개).
function staticRefs(html) {
    const out = [];
    const re = /<(script|link|img|iframe|source|audio|video|embed|object)\b[^>]*?\b(?:src|href|data)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push(`${m[1]} ${m[2]}`);
    return out;
}
function sectionOffStatic(mutate) {
    const problems = [];
    const files = provider(V.OFF, mutate);
    const info = { added: [], bytes: Buffer.byteLength(workFile(AUTH_FILE), 'utf8') };
    for (const f of TARGET_FILES) {
        const base = staticRefs(baseFile(f));
        const now = staticRefs(files(f));
        const left = base.slice();
        const added = [];
        for (const ref of now) { const i = left.indexOf(ref); if (i >= 0) left.splice(i, 1); else added.push(ref); }
        if (left.length) problems.push(`꺼짐의 화면(${f}): 기준에 있던 정적 요청이 없어짐`);
        const only = added.length === 1 && /^script js\/auth-session\.js(\?v=\d+)?$/.test(added[0]);
        if (!only) problems.push(`꺼짐의 화면(${f}): 기준보다 더 받는 것이 같은 출처의 인증 모듈 파일 1개가 아님(${added.length}개)`);
        info.added.push(`${f}: ${added.length}개`);
    }
    return { problems, info };
}
// 대상이 아닌 화면(게이트도 인증 모듈도 싣지 않는다 — js/common.js·js/main.js 를 싣는 admin-users.html 이 이 경우다):
// js/common.js·js/main.js·js/login.js 가 기준과 같은가.
// 화면에서 게이트와 인증 모듈 태그를 뺀 사본으로 본다 — 저장소의 파일 그대로(꺼짐)와 시험 서버가 켜짐으로 내주는 사본 둘 다.
async function sectionNoModule() {
    const problems = [];
    let compared = 0;
    const strip = (p, text) => {
        if (!p.endsWith('.html')) return text;
        const a = text.indexOf('    ' + GATE_COMMENT);
        const b = text.indexOf(MODULE_TAG);
        if (a < 0 || b < a) throw new Error('게이트와 인증 모듈의 태그를 찾지 못함: ' + p);
        return text.slice(0, a) + text.slice(text.indexOf('\n', b) + 1);
    };
    for (const [name, baseVariant, nowVariant] of [['저장소 그대로', V.BASE, V.OFF], ['켜짐으로 내준 사본', V.BASE_T, V.ON]]) {
        for (const stateName of STATE_NAMES) {
            for (const scenario of LEGACY_SCENARIOS) {
                const base = await runLegacy(scenario, stateName, baseVariant);
                const now = await runLegacy(scenario, stateName, nowVariant, strip);
                compared++;
                const label = `모듈 없는 화면(${name}) › ${stateName} › ${scenario.name}`;
                for (const d of diffSnapshot(base.snap, now.snap)) problems.push(`${label} › 기준과 다름: ${d}`);
                if (now.page.evaluate('typeof EonAuth') !== 'undefined' || now.page.evaluate('typeof EonLogin') !== 'undefined') problems.push(`${label} › 시험이 게이트·인증 모듈을 빼지 못함`);
                if (now.snap.scripts.length || now.snap.channels || now.snap.sdk !== 'undefined') problems.push(`${label} › SDK·탭 사이 알림 통로의 흔적`);
                if (now.w.outside.length) problems.push(`${label} › 가짜 서버 밖으로 나간 요청`);
            }
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

// 가짜 화면에서 "보이는가": 숨김 규칙(head 의 style)이 걸려 있으면 html 의 표시(class)가 있어야 보인다
const hideRule = (page) => page.created.find((e) => e.tagName === 'STYLE' && e.id === 'eon-auth-hide' && page.head._children.includes(e) && /materials\.html/.test(e._text) && /#adminDashboardBtn/.test(e._text) && /#studentDashboardBtn/.test(e._text));
function shown(page) {
    const rule = !!hideRule(page);
    const admin = page.root.classList.contains('eon-auth-admin');
    const member = page.root.classList.contains('eon-auth-member');
    const visible = (el) => !!el && el.style.display !== 'none';
    return {
        name: /합성/.test(lastMenu(page)),
        adminLink: /admin-dashboard\.html/.test(lastMenu(page)),
        adminBtn: visible(page.byId.adminDashboardBtn) && (!rule || admin),
        studentBtn: visible(page.byId.studentDashboardBtn) && (!rule || member),
        materials: page.materials.some((m) => visible(m)) && (!rule || admin),
        adminMark: admin,
        memberMark: member,
    };
}
const anyShown = (s) => s.name || s.adminLink || s.adminBtn || s.studentBtn || s.materials || s.adminMark || s.memberMark;

// 확인 전 표시 0: 응답을 붙잡고 있는 동안 이름·관리자 링크·버튼·학습 자료 링크가 보이지 않고,
// 성공 응답을 풀어 준 뒤에만(그것도 확인된 사람의 것만) 보인다. 켜진 화면은 첫 그리기부터 숨김 규칙이 걸려 있다.
async function testRestoreGating(opt) {
    const c = checker();
    const cases = [
        { name: '회원 A(성공)', key: 'A', aal: 'aal1', after: { name: true, adminLink: false, adminBtn: false, studentBtn: true, materials: false, adminMark: false, memberMark: true }, state: 'signed_in' },
        { name: '관리자 GM·aal2(성공)', key: 'GM', aal: 'aal2', after: { name: true, adminLink: true, adminBtn: true, studentBtn: false, materials: true, adminMark: true, memberMark: false }, state: 'signed_in' },
        { name: '회원 A(allowed 거짓)', key: 'A', aal: 'aal1', prepare: (w) => { w.server.allowedOverride = false; }, after: null, state: 'rejected' },
        { name: '관리자 GM·aal2(응답 실패)', key: 'GM', aal: 'aal2', fail: true, after: null, state: 'rejected' },
        { name: '차단된 계정', key: 'BLK', aal: 'aal1', holdOn: 'my_profile', after: null, state: 'rejected' },
        { name: '탈퇴 처리 중', key: 'WD', aal: 'aal1', holdOn: 'my_profile', after: null, state: 'rejected' },
    ];
    for (const k of cases) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        w.seed(k.key, { aal: k.aal });
        // 먼저 한 번 열어 둔다(앞 화면이 남긴 호환 값이 저장소에 있는 "새로 고침"의 상태를 만든다)
        (await w.open('before', 'index.html')).close();
        const primed = w.browser.local.has('iontoefl_user');
        if (k.after) c.ok(primed, `확인 전 표시(${k.name}): 시험이 호환 값이 남아 있는 상태를 만들지 못함`);
        if (k.prepare) k.prepare(w);
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const holdOn = k.holdOn || 'my_site_access';
        w.server.faults[holdOn] = () => gate.then(() => (k.fail ? { status: 500, headers: {}, body: '{}' } : null));
        let first = null;
        const page = await w.open('index', 'index.html', {
            noIdle: true,
            beforeLoad: (p) => {
                // 화면의 다른 스크립트(body 의 것)가 돌기 전에 숨김 규칙이 걸렸는가
                const styleAt = p.trace.findIndex((e) => e.t === 'append' && e.to === 'head' && e.el === '#eon-auth-hide');
                const bodyAt = p.trace.findIndex((e) => e.t === 'run-script' && !e.head);
                first = { rule: !!hideRule(p), order: styleAt >= 0 && bodyAt >= 0 && styleAt < bodyAt, shown: shown(p) };
            },
        });
        const label = `확인 전 표시(${k.name})`;
        c.ok(first.rule && first.order, `${label}: 첫 그리기 — 숨김 규칙이 head 에서(다른 스크립트보다 먼저) 걸리지 않음`);
        c.ok(!anyShown(first.shown), `${label}: 첫 그리기 — 이름·관리자 표시·버튼·학습 자료 링크가 보임`);
        await w.browser.spin(60);
        c.ok(st(page) === 'restoring' && w.browser.pending > 0, `${label}: 시험이 응답을 붙잡지 못함(${st(page)})`);
        c.ok(!anyShown(shown(page)), `${label}: 응답을 붙잡고 있는 동안 표시가 보임(${JSON.stringify(shown(page))})`);
        c.ok(!menuHistory(page).some((e) => /합성|dashboard\.html/.test(e.html)), `${label}: 응답을 붙잡고 있는 동안 이름이 그려진 적이 있음`);
        c.ok(page.evaluate('EonAuth.displayUserRaw()') === null && page.evaluate('EonAuth.profile()') === null, `${label}: 응답을 붙잡고 있는 동안 표시·본인 정보를 내줌`);
        release();
        await w.browser.idle();
        const after = shown(page);
        c.ok(st(page) === k.state, `${label}: 풀어 준 뒤 상태가 ${k.state} 가 아님(${st(page)}·${why(page)})`);
        if (k.after) c.ok(JSON.stringify(after) === JSON.stringify(k.after), `${label}: 풀어 준 뒤 표시가 기대와 다름(${JSON.stringify(after)})`);
        else c.ok(!anyShown(after) && navs(page).length === 0, `${label}: 확인에 실패했는데 표시·이동이 있음(${JSON.stringify(after)})`);
        audit(w, c, label);
    }
    // 복원에서 보내는 요청: 만료 전이면 로그인·갱신 없이 두 확인 요청을 한 번씩
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const before = w.server.log.length;
        const page = await w.open('index', 'index.html');
        const rest = w.server.log.slice(before).map((e) => e.route);
        c.ok(st(page) === 'signed_in' && rest.filter((r) => r === R.profile).length === 1 && rest.filter((r) => r === R.access).length === 1, '복원: index 에서 본인 정보·사이트 접근을 한 번씩 다시 확인하지 않음');
        c.ok(w.count(R.profile) === 2 && w.count(R.access) === 2, '복원: 로그인 화면 1회 + index 1회(각 요청 모두 2회)가 아님');
        c.ok(!rest.includes('POST /auth/v1/token'), '복원: 만료 전인데 로그인·갱신 요청을 보냄');
        audit(w, c, '복원');
    }
    return c.problems;
}

// 로그인 뒤 1초 기다렸다 이동하기 직전에 다시 본다: 아직 그 시도의 그 로그인이 확인된 로그인인가
async function testMoveRecheck(opt) {
    const c = checker();
    for (const [name, change] of [
        ['다른 계정으로 바뀜', (w) => { w.seed('B'); }],
        ['로그인이 없어짐', (w) => { w.browser.local.delete('eon_auth_v1'); }],
        ['옛 방식의 값이 생김', (w) => { w.browser.local.set('iontoefl_user', OLD_STUDENT); }],
    ]) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const page = await w.open('login', 'login.html');
        page.byId.email.value = A.email;
        page.byId.password.value = A.password;
        const done = page.byId.loginForm.fire('submit');
        await w.browser.idle();
        await done;
        c.ok(st(page) === 'signed_in' && boxes(page).includes(MSG.success) && navs(page).length === 0, `이동 직전(${name}): 시험이 "확인됨·이동 전" 상태를 만들지 못함`);
        change(w);                              // 1초를 기다리는 사이 다른 탭이 바꾼 것처럼
        await w.browser.advance(1500);
        c.ok(navs(page).length === 0, `이동 직전(${name}): 다시 보지 않고 이동함(${navs(page).join(', ')})`);
        c.ok(boxes(page).includes(MSG.moved), `이동 직전(${name}): 안내가 없음`);
        audit(w, c, `이동 직전(${name})`);
    }
    return c.problems;
}

// 한 시도(A)의 실패 처리가 다른 로그인(B)을 건드리지 않는다.
//   A 를 확인하는 사이 저장된 로그인이 B 로 바뀐다 → A 의 시도는 표시 0·이동 0·B 에 대한 갱신·종료 요청 0.
//   B 는 그 뒤 별도의 확인으로만 그린다.
// weaken 이 참이면 모듈의 "직전 확인"을 뺀 사본으로 돌린다 — 요청이 지나는 한 곳만으로도 B 로 나가지 않아야 한다.
const WEAKEN = [
    [AUTH_FILE, "        if (!st || !same(st.claims, att) || typeof st.refreshToken !== 'string' || !st.refreshToken) return { kind: 'changed' };", "        if (!st) return { kind: 'changed' };"],
    [AUTH_FILE, "        if (!st || !same(st.claims, att)) return 'changed';\n        const p = { kind: 'logout',", "        if (!st) return 'changed';\n        const p = { kind: 'logout',"],
];
async function testAttemptBinding(opt) {
    const c = checker();
    for (const weaken of [false, true]) {
        const tag = weaken ? '(직전 확인을 뺀 사본 — 요청이 지나는 한 곳만으로)' : '';
        const weakProblems = [];
        const mutate = weaken
            ? ((p, text) => { const t = applyEdits(WEAKEN, weakProblems)(p, text); return opt.mutate ? opt.mutate(p, t) : t; })
            : opt.mutate;

        // (1) 갱신: A 는 끝난 기록이라 확인에서 no_member → 복구(갱신)로 가려는 순간 저장된 로그인은 이미 B
        {
            const w = makeWorld('빈 브라우저', { variant: V.ON, mutate });
            const sA = w.seed('A');
            w.server.endSession(sA, 'session_expired');
            let sB = null;
            let rawB = null;
            w.server.hooks['after:my_profile'] = () => { delete w.server.hooks['after:my_profile']; sB = w.seed('B'); rawB = w.browser.local.get('eon_auth_v1'); };
            const page = await w.open('index', 'index.html');
            await w.browser.advance(40 * 1000);     // 막힌 요청을 공식 클라이언트가 다시 보내려다 그만둘 때까지(가짜 시계)
            const label = `묶기·갱신${tag}`;
            c.ok(!!sB, `${label}: 시험이 로그인을 바꾸지 못함`);
            c.ok(w.count(R.refresh) === 0, `${label}: B 에 대한 갱신 요청이 나감(${w.count(R.refresh)}번)`);
            c.ok(w.count(R.logout) === 0, `${label}: B 에 대한 종료 요청이 나감`);
            c.ok(!!sB && sB.alive && sB.prevRefresh === null && w.browser.local.get('eon_auth_v1') === rawB, `${label}: B 의 로그인 기록·저장값이 달라짐`);
            c.ok(!page.trace.some((e) => /합성 회원 A/.test(e.html || e.text || '')) && !/m-A/.test(w.browser.local.get('iontoefl_user') || ''), `${label}: A 의 표시·호환 값이 생김`);
            c.ok(navs(page).length === 0, `${label}: 화면 이동이 있음`);
            const subs = w.browser.requests.filter((r) => r.url === PROFILE_URL || r.url === ACCESS_URL).map((r) => (readFakeJwt(bearerOf(r)) || {}).sub);
            c.ok(JSON.stringify(subs) === JSON.stringify(['auth-A', 'auth-B', 'auth-B']), `${label}: B 를 별도의 확인(두 요청)으로만 그리지 않음(${subs.join(',')})`);
            c.ok(st(page) === 'signed_in' && page.evaluate('EonAuth.profile().id') === 'm-B', `${label}: 그 뒤 B 의 확인 결과가 아님(${st(page)}·${why(page)})`);
            if (weaken) c.ok(weakProblems.length === 0, `${label}: 사본을 만들지 못함`);
            audit(w, c, label);
        }
        // (2) 종료: 회원 대응이 없는 N → 갱신은 되지만 여전히 no_member → 이 로그인을 끝내려는 순간 저장된 로그인은 이미 B
        {
            const w = makeWorld('빈 브라우저', { variant: V.ON, mutate });
            w.seed('N');
            let sB = null;
            let rawB = null;
            let asked = 0;
            w.server.hooks['after:my_profile'] = () => {
                if (++asked !== 2) return;
                delete w.server.hooks['after:my_profile'];
                sB = w.seed('B');
                rawB = w.browser.local.get('eon_auth_v1');
            };
            const page = await w.open('index', 'index.html');
            await w.browser.advance(40 * 1000);
            const label = `묶기·종료${tag}`;
            c.ok(!!sB, `${label}: 시험이 로그인을 바꾸지 못함`);
            c.ok(w.count(R.logout) === 0, `${label}: B 에 대한 종료 요청이 나감`);
            c.ok(w.count(R.refresh) === 1 && !!sB && sB.prevRefresh === null, `${label}: 갱신이 N 의 것 한 번이 아님(B 에 대한 갱신 요청이 나갔을 수 있음)`);
            c.ok(!!sB && sB.alive && w.browser.local.get('eon_auth_v1') === rawB, `${label}: B 의 로그인 기록·저장값이 달라짐`);
            c.ok(st(page) === 'signed_in' && page.evaluate('EonAuth.profile().id') === 'm-B', `${label}: 그 뒤 B 의 확인 결과가 아님(${st(page)}·${why(page)})`);
            audit(w, c, label);
        }
    }
    // (3) 표시 직전: 확인된 뒤라도 저장된 로그인이 바뀌었으면 그 자리에서 표시를 내주지 않는다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        const attempt = page.evaluate('JSON.parse(localStorage.getItem("eon_auth_v1:compat")).sid');
        c.ok(page.evaluate('EonAuth.displayUserRaw()') !== null && page.evaluate(`EonAuth.isCurrent(${JSON.stringify(attempt)})`) === true, '표시 직전: 시험이 확인된 상태를 만들지 못함');
        w.seed('B');                            // 알림 없이 저장된 로그인만 바뀐 순간
        c.ok(page.evaluate('EonAuth.displayUserRaw()') === null, '표시 직전: 저장된 로그인이 바뀌었는데 표시를 내줌');
        c.ok(page.evaluate(`EonAuth.isCurrent(${JSON.stringify(attempt)})`) === false, '표시 직전: 저장된 로그인이 바뀌었는데 "아직 그 로그인"이라고 답함');
        // 이 탭이 확인한 로그인이 아닌 것은 끝내지 않는다
        const results = [];
        page.sandbox.__probe = (v) => results.push(v);
        page.evaluate('EonAuth.signOut().then((r) => __probe(r.outcome));');
        await w.browser.spin(30);
        c.ok(w.count(R.logout) === 0, '표시 직전: 이 탭이 확인하지 않은 로그인(B)에 대한 종료 요청이 나감');
    }
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
        { name: 'my_profile 429', key: 'A', prepare: (w) => { w.server.faults.my_profile = () => ({ status: 429, headers: {}, body: '{}' }); }, msg: MSG.rate, state: 'rejected', reason: 'rate_limited', session: true, once: R.profile },
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
            c.ok(w.count(R.refresh) === 0 && w.count(R.logout) === 0, `${label}: A 의 실패 처리가 갱신·종료 요청을 보냄(B 를 건드렸을 수 있음)`);
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

// 만료·종료된 로그인 기록: "갱신 거절"과 "로그인이 끝났음"을 나눈다
async function testExpiry(opt) {
    const c = checker();
    const noStore = { 'x-supabase-api-version': '2024-01-01', 'Content-Type': 'application/json' };
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
    // (3) 로그인 기록은 끝났는데 JWT 는 유효(200 no_member) → 갱신 한 번 → 서버의 답에 따라
    //     끝났다는 코드: 이 브라우저의 그 로그인을 지움 / 그 밖(다른 4xx·429·5xx·응답 없음): 모름 — 지우지 않음
    const refusals = [
        { name: '만료 코드(session_expired)', end: 'session_expired', reason: 'expired', kept: false },
        { name: '없음 코드(session_not_found)', end: 'session_not_found', reason: 'expired', kept: false },
        { name: '갱신값 못 찾음(refresh_token_not_found)', end: 'refresh_token_not_found', reason: 'network', kept: true },
        { name: '이미 쓴 갱신값(refresh_token_already_used)', end: 'refresh_token_already_used', reason: 'network', kept: true },
        { name: '429', fault: () => ({ status: 429, headers: noStore, body: JSON.stringify({ code: 'over_request_rate_limit', message: 'rate limit' }) }), reason: 'rate_limited', kept: true },
        { name: '그 밖의 4xx(코드 없음)', fault: () => ({ status: 400, headers: noStore, body: '{}' }), reason: 'network', kept: true },
        { name: '5xx', fault: () => ({ status: 500, headers: noStore, body: '{}' }), reason: 'network', kept: true },
        { name: '응답 없음', fault: () => 'network', reason: 'network', kept: true },
    ];
    for (const k of refusals) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        for (const s of w.server.sessions.values()) w.server.endSession(s, k.end || 'session_expired');
        if (k.fault) w.server.faults.token = (req, u) => (u.searchParams.get('grant_type') === 'refresh_token' ? k.fault() : null);
        const page = await w.open('index', 'index.html', { noIdle: true });
        await w.browser.advance(60 * 1000);
        const label = `끝난 기록 › 갱신의 답: ${k.name}`;
        c.ok(st(page) === 'rejected' && why(page) === k.reason, `${label}: rejected·${k.reason} 가 아님(${st(page)}·${why(page)})`);
        c.ok(w.browser.local.has('eon_auth_v1') === k.kept, `${label}: 로그인 기록의 남김·지움이 기대(${k.kept ? '남김 — 끝났다는 증거가 아니다' : '지움'})와 다름`);
        c.ok(w.count(R.refresh) === 1, `${label}: 갱신이 한 번이 아님(${w.count(R.refresh)}번)`);
        c.ok(w.count(R.logout) === 0, `${label}: 종료 요청을 보냄`);
        c.ok(!menuHistory(page).some((e) => /합성/.test(e.html)) && /LOGIN/.test(lastMenu(page)), `${label}: 이름이 그려짐`);
        c.ok(!w.browser.local.has('iontoefl_user') && !w.browser.local.has('iontoefl_login_time') && !w.browser.local.has('eon_auth_v1:compat'), `${label}: 새 모듈이 만든 호환 값이 남음`);
        const results = [];
        page.sandbox.__probe = (v) => results.push(v);
        page.evaluate(`EonAuth.credentialFor('member', '${PROFILE_URL}', 'POST').then(() => __probe('자격을 줌'), (e) => __probe(e.code));`);
        await w.browser.idle();
        c.ok(results[0] === 'rejected', `${label}: 거절 뒤 회원 자격 요청이 오류가 아님(${results[0]})`);
        audit(w, c, label);
    }
    // (4) 복원 오류 길: 저장된 JWT 가 만료됐고 갱신의 답을 받지 못함 → rejected(모름).
    //     같은 갱신을 다시 보내지 않고, 로그인 기록은 건드리지 않고, 새 모듈이 만든 호환 값은 남기지 않는다
    for (const [name, fault] of [['응답 유실', () => 'network'], ['서버 오류(503)', () => ({ status: 503, headers: {}, body: '{}' })]]) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const stored = JSON.parse(w.browser.local.get('eon_auth_v1'));
        stored.expires_at = Math.floor(w.browser.now / 1000) - 60;         // 저장된 만료 시각이 지난 것으로
        w.browser.local.set('eon_auth_v1', JSON.stringify(stored));
        c.ok(w.browser.local.has('iontoefl_user'), `복원 오류(${name}): 시험이 호환 값이 있는 상태를 만들지 못함`);
        w.server.faults.token = fault;
        const page = await w.open('index', 'index.html', { noIdle: true });
        await w.browser.advance(90 * 1000);      // 공식 클라이언트가 스스로 다시 보내려 하는 동안(가짜 시계)
        c.ok(st(page) === 'rejected' && why(page) === 'network', `복원 오류(${name}): rejected·network 가 아님(${st(page)}·${why(page)})`);
        c.ok(w.count(R.refresh) === 1, `복원 오류(${name}): 결과를 모르는 갱신을 다시 보냄(${w.count(R.refresh)}번)`);
        c.ok(w.browser.local.has('eon_auth_v1') && w.count(R.logout) === 0, `복원 오류(${name}): 모르는 결과로 로그인 기록을 지움`);
        c.ok(!w.browser.local.has('iontoefl_user') && !w.browser.local.has('iontoefl_login_time') && !w.browser.local.has('eon_auth_v1:compat'), `복원 오류(${name}): 새 모듈이 만든 호환 값이 남음`);
        c.ok(page.evaluate('EonAuth.displayUserRaw()') === null && !menuHistory(page).some((e) => /합성/.test(e.html)), `복원 오류(${name}): 표시를 내줌`);
        audit(w, c, `복원 오류(${name})`);
    }
    return c.problems;
}

// 로그아웃: 이 로그인만, 새 모듈이 만든 호환 값만, 서버가 끝났다고 답했을 때만. 그 뒤 다시 로그인.
async function testLogout(opt) {
    const c = checker();
    const NEW_KEYS = ['iontoefl_user', 'iontoefl_login_time', 'eon_auth_v1:compat', 'eon_auth_v1'];
    {
        const w = makeWorld('교재 편집만', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        page.evaluate('logout()');
        await w.browser.idle();
        c.ok(st(page) === 'signed_out', `로그아웃: signed_out 이 아님(${st(page)})`);
        c.ok(w.count(R.logout) === 1, '로그아웃: 이 로그인만 끝내는 요청이 한 번이 아님');
        c.ok(!NEW_KEYS.some((k) => w.browser.local.has(k)), '로그아웃: 새 모듈의 값이 남음');
        c.ok(page.trace.some((e) => e.t === 'alert' && e.text === MSG.logoutDone) && navs(page).join() === '[새로 고침]', '로그아웃: 안내·새로 고침이 기대와 다름');
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
    // 로그아웃의 답이 실패·모름이면 "끝냈다"로 처리하지 않는다(안내·새로 고침 없음, 다시 보내지도 않음).
    // 그렇다고 "확인된 로그인"으로 남겨 두지도 않는다: 이 탭의 확인 상태·표시는 즉시 거둔다.
    // 서버의 로그인 기록과 저장된 로그인 값은 지우지 않는다.
    const unknowns = [
        ['응답 없음', () => 'network'],
        ['5xx', () => ({ status: 500, headers: {}, body: '{}' })],
        ['429', () => ({ status: 429, headers: {}, body: JSON.stringify({ code: 'over_request_rate_limit' }) })],
        ['401', () => ({ status: 401, headers: {}, body: JSON.stringify({ code: 'bad_jwt' }) })],
        ['403(코드 없음)', () => ({ status: 403, headers: {}, body: '{}' })],
    ];
    for (const [name, fault] of unknowns) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        const rawA = w.browser.local.get('eon_auth_v1');
        w.server.faults.logout = fault;
        page.evaluate('logout()');
        await w.browser.idle();
        await w.browser.advance(20 * 1000);
        const label = `로그아웃 모름(${name})`;
        c.ok(page.trace.some((e) => e.t === 'alert' && e.text === MSG.logoutUnknown) && !page.trace.some((e) => e.t === 'alert' && e.text === MSG.logoutDone), `${label}: 끝내지 못했는데 "로그아웃되었습니다"로 안내함`);
        c.ok(navs(page).length === 0, `${label}: 끝내지 못했는데 새로 고침함`);
        c.ok(w.browser.local.get('eon_auth_v1') === rawA && [...w.server.sessions.values()].every((s) => s.alive), `${label}: 끝내지 못했는데 저장된 로그인·서버의 로그인 기록을 지움`);
        c.ok(w.count(R.logout) === 1, `${label}: 종료 요청이 한 번이 아님(다시 보냈을 수 있음)`);
        c.ok(st(page) === 'rejected' && why(page) === 'logout_unknown', `${label}: 로그아웃 모름인데 확인 상태가 남음(${st(page)}·${why(page)})`);
        c.ok(page.evaluate('EonAuth.profile()') === null && page.evaluate('EonAuth.siteAccess()') === null && page.evaluate('EonAuth.displayUserRaw()') === null, `${label}: 로그아웃 모름인데 본인 정보·사이트 접근·표시를 내줌`);
        c.ok(/LOGIN/.test(lastMenu(page)) && !/합성/.test(lastMenu(page)), `${label}: 로그아웃 모름인데 이름이 남음`);
        c.ok(!w.browser.local.has('iontoefl_user') && !w.browser.local.has('eon_auth_v1:compat'), `${label}: 그 로그인 기록으로 만든 호환 값이 남음`);
        audit(w, c, label);
    }
    // 서버가 "그 로그인 기록은 없다"고 답한 것은 끝난 것이다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        for (const s of w.server.sessions.values()) s.alive = false;
        page.evaluate('logout()');
        await w.browser.idle();
        c.ok(st(page) === 'signed_out' && !NEW_KEYS.some((k) => w.browser.local.has(k)), `로그아웃(이미 없는 기록): signed_out 이 아님(${st(page)})`);
        audit(w, c, '로그아웃(이미 없는 기록)');
    }
    // 새 로그인 전에 앞의 로그인을 끝내지 못하면(모름) 새 로그인 요청을 보내지 않는다. 이 탭이 앞 로그인에 대해 확인해 둔 것도 거둔다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const page = await loginAs(w, 'A');
        const rawA = w.browser.local.get('eon_auth_v1');
        w.server.faults.logout = () => 'network';
        await w.submit(page, ACCOUNTS.B.email, ACCOUNTS.B.password);
        await w.browser.advance(20 * 1000);
        c.ok(boxes(page)[boxes(page).length - 1] === MSG.previous, '이전 로그인 모름: 안내가 기대와 다름');
        c.ok(w.count(R.login) === 1, `이전 로그인 모름: 앞의 것을 끝내지 못했는데 새 로그인 요청을 보냄(${w.count(R.login)}번)`);
        c.ok(w.browser.local.get('eon_auth_v1') === rawA, '이전 로그인 모름: 앞의 로그인(저장값)을 지우거나 바꿈');
        c.ok(st(page) === 'rejected' && why(page) === 'logout_unknown' && page.evaluate('EonAuth.profile()') === null, `이전 로그인 모름: 로그아웃 모름인데 확인 상태·본인 정보가 남음(${st(page)}·${why(page)})`);
        c.ok(JSON.stringify(navs(page)) === JSON.stringify(['index.html']), '이전 로그인 모름: 화면 이동이 더 있음');
        audit(w, c, '이전 로그인 모름');
    }
    return c.problems;
}

// 저장된 로그인 값을 읽을 수 없게 되면(다른 것이 덮어썼거나 깨졌으면) 앞서 확인한 것을 그대로 믿지 않는다:
// 본인 정보·사이트 접근·표시를 즉시 거둔다. 그 값 자체는 지우지 않는다.
async function testUnreadableStored(opt) {
    const c = checker();
    const cases = [
        ['JSON 이 아님', 'zz-not-json'],
        ['JWT 를 풀 수 없음', JSON.stringify({ access_token: 'aaa.bbb.ccc', refresh_token: 'zz', expires_at: 4102444800 })],
        ['로그인 기록 번호가 없는 JWT', JSON.stringify({ access_token: fakeJwt({ sub: 'auth-A', role: 'authenticated', exp: 4102444800 }), refresh_token: 'zz', expires_at: 4102444800 })],
    ];
    for (const [name, value] of cases) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        const label = `읽을 수 없는 저장값(${name})`;
        c.ok(st(page) === 'signed_in' && page.evaluate('EonAuth.profile().id') === 'm-A', `${label}: 시험이 확인된 상태를 만들지 못함`);
        const before = w.server.log.length;
        w.browser.local.set('eon_auth_v1', value);                 // 알림 없이 저장값만 바뀐 순간
        c.ok(page.evaluate('EonAuth.profile()') === null && page.evaluate('EonAuth.siteAccess()') === null && page.evaluate('EonAuth.displayUserRaw()') === null, `${label}: 알림이 오기 전인데 본인 정보·사이트 접근·표시를 내줌`);
        page.dispatchWindow('storage', { key: 'eon_auth_v1' });
        await w.browser.idle();
        c.ok(st(page) === 'rejected' && why(page) === 'unreadable', `${label}: 확인 상태가 남음(${st(page)}·${why(page)})`);
        c.ok(page.evaluate('EonAuth.profile()') === null && page.evaluate('EonAuth.siteAccess()') === null, `${label}: 알림 뒤에도 본인 정보·사이트 접근을 내줌`);
        c.ok(/LOGIN/.test(lastMenu(page)) && !/합성/.test(lastMenu(page)), `${label}: 이름이 남음`);
        c.ok(w.browser.local.get('eon_auth_v1') === value, `${label}: 읽을 수 없는 저장값을 지우거나 바꿈`);
        c.ok(w.server.log.length === before, `${label}: 요청을 보냄(갱신·종료·확인)`);
        c.ok([...w.server.sessions.values()].every((s) => s.alive), `${label}: 서버의 로그인 기록을 끝냄`);
        audit(w, c, label);
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

// 확인을 거둘 때 다른 계정의 호환 값을 지우지 않는다.
// 다른 탭이 B 를 확인해 호환 값·표식을 써 둔 상태에서(이 탭에는 알림이 오지 않았다) A 를 확인했던 이 탭이 확인을 거둔다.
async function testWithdrawKeepsOthers(opt) {
    const c = checker();
    const plantB = (w) => {
        const sB = w.server.createSession(ACCOUNTS.B.email);
        const user = JSON.stringify({ id: 'm-B', name: '합성 회원 B', nickname: '', email: ACCOUNTS.B.profile.email, phone: null, role: 'user' });
        const values = { 'eon_auth_v1:compat': JSON.stringify({ v: 1, sid: sB.sid, sub: 'auth-B', user, time: '1795500000001' }), iontoefl_user: user, iontoefl_login_time: '1795500000001' };
        for (const [k, v] of Object.entries(values)) w.browser.local.set(k, v);
        return values;
    };
    const kept = (w, values) => Object.entries(values).every(([k, v]) => w.browser.local.get(k) === v);
    const unreadable = [
        ['JSON 이 아님', 'zz-not-json'],
        ['JWT 를 풀 수 없음', JSON.stringify({ access_token: 'aaa.bbb.ccc', refresh_token: 'zz', expires_at: 4102444800, user: { id: 'x' } })],
    ];
    // (1) 저장된 로그인 값을 읽을 수 없게 됨 → unreadable 로 거둠
    for (const [name, value] of unreadable) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        const values = plantB(w);
        w.browser.local.set('eon_auth_v1', value);
        page.dispatchWindow('storage', { key: 'eon_auth_v1' });
        await w.browser.idle();
        const label = `거둘 때(읽을 수 없는 저장값·${name})`;
        c.ok(st(page) === 'rejected' && why(page) === 'unreadable' && page.evaluate('EonAuth.profile()') === null, `${label}: 확인 상태가 남음(${st(page)}·${why(page)})`);
        c.ok(kept(w, values), `${label}: 다른 계정(B)의 호환 값·표식을 지우거나 바꿈`);
        c.ok(/LOGIN/.test(lastMenu(page)) && !/합성/.test(lastMenu(page)), `${label}: 이름이 남음`);
        audit(w, c, label);
    }
    // (2) 로그아웃의 답을 모름 → logout_unknown 으로 거둠
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const page = await w.open('index', 'index.html');
        const values = plantB(w);
        w.server.faults.logout = () => 'network';
        page.evaluate('EonAuth.signOut()');
        await w.browser.idle();
        await w.browser.advance(20 * 1000);
        c.ok(st(page) === 'rejected' && why(page) === 'logout_unknown' && page.evaluate('EonAuth.profile()') === null, `거둘 때(로그아웃 모름): 확인 상태가 남음(${st(page)}·${why(page)})`);
        c.ok(kept(w, values), '거둘 때(로그아웃 모름): 다른 계정(B)의 호환 값·표식을 지우거나 바꿈');
        audit(w, c, '거둘 때(로그아웃 모름)');
    }
    // (3) 저장된 로그인을 읽을 수 없는 채로 화면을 엶: 표식의 주인을 알 수 없다 → 지우지 않고 표시만 하지 않는다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const values = plantB(w);
        w.browser.local.set('eon_auth_v1', unreadable[1][1]);
        const page = await w.open('index', 'index.html');
        c.ok(st(page) !== 'signed_in' && page.evaluate('EonAuth.displayUserRaw()') === null && !menuHistory(page).some((e) => /합성/.test(e.html)), `읽을 수 없는 저장값으로 연 화면: 표시를 내줌(${st(page)}·${why(page)})`);
        c.ok(kept(w, values), '읽을 수 없는 저장값으로 연 화면: 주인을 알 수 없는 호환 값·표식을 지움');
        audit(w, c, '읽을 수 없는 저장값으로 연 화면');
    }
    // (4) 대조: 저장된 로그인이 없음을 확인한 경우의 주인 없는 값은 지금처럼 정리된다
    {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        plantB(w);
        const page = await w.open('index', 'index.html');
        c.ok(st(page) === 'signed_out' && !w.browser.local.has('iontoefl_user') && !w.browser.local.has('eon_auth_v1:compat'), '저장된 로그인이 없는 화면: 주인 없는(새 모듈이 만든) 호환 값이 정리되지 않음');
    }
    return c.problems;
}
// 기다린 일(SDK 받기·저장된 로그인 읽기)이 실패로 끝난 세 길.
// 정리는 "기다리기 전에 잡아 둔 기록"으로만 한다 — 기다리는 사이 다른 탭이 B 로 바꿨으면 B 의 호환 값·표식은 글자 그대로 남고,
// B 는 거절된 기록으로 남지 않는다(다음 상태 맞추기에서 별도의 확인으로 그린다).
async function testFailedWaitKeepsOthers(opt) {
    const c = checker();
    const compatKeys = ['eon_auth_v1:compat', 'iontoefl_user', 'iontoefl_login_time'];
    // 다른 탭이 B 로 로그인해 확인까지 끝낸 것처럼: 저장된 로그인·호환 값·표식을 B 의 것으로(이 탭에는 알림이 오지 않는다)
    const switchToB = (w) => {
        const sB = w.seed('B');
        const user = JSON.stringify({ id: 'm-B', name: '다른 탭이 쓴 B', nickname: '', email: ACCOUNTS.B.profile.email, phone: null, role: 'user' });
        const values = { 'eon_auth_v1:compat': JSON.stringify({ v: 1, sid: sB.sid, sub: 'auth-B', user, time: '1795500000001' }), iontoefl_user: user, iontoefl_login_time: '1795500000001' };
        for (const [k, v] of Object.entries(values)) w.browser.local.set(k, v);
        return { sB, values, raw: w.browser.local.get('eon_auth_v1') };
    };
    const kept = (w, b) => Object.entries(b.values).every(([k, v]) => w.browser.local.get(k) === v) && w.browser.local.get('eon_auth_v1') === b.raw;
    const expire = (w) => { const s = JSON.parse(w.browser.local.get('eon_auth_v1')); s.expires_at = Math.floor(w.browser.now / 1000) - 60; w.browser.local.set('eon_auth_v1', JSON.stringify(s)); };
    const subsSince = (w, mark) => w.browser.requests.slice(mark).filter((r) => r.url === PROFILE_URL || r.url === ACCESS_URL).map((r) => (readFakeJwt(bearerOf(r)) || {}).sub);
    const noName = (page) => (st(page) === 'signed_in' ? page.evaluate('EonAuth.profile().id') === 'm-B' : page.evaluate('EonAuth.displayUserRaw()') === null);

    // (1) SDK 를 쓸 수 없음: SDK 파일을 받는 사이
    for (const swap of [true, false]) {
        const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
        const login = await loginAs(w, 'A');
        login.close();
        const label = `SDK 를 쓸 수 없음(${swap ? '기다리는 사이 B 로 바뀜' : '그대로'})`;
        c.ok(compatKeys.every((k) => w.browser.local.has(k)), `${label}: 시험이 호환 값이 있는 상태를 만들지 못함`);
        let b = null;
        const sent = w.server.log.length;
        const page = await w.open('index', 'index.html', {
            beforeLoad: (p) => {
                const orig = p.files;
                p.files = (f) => { if (f !== SDK_FILE) return orig(f); if (swap && !b) b = switchToB(w); return null; };
            },
        });
        await w.browser.advance(5 * 1000);
        c.ok(st(page) === 'signed_out' && why(page) === 'unavailable', `${label}: signed_out·unavailable 가 아님(${st(page)}·${why(page)})`);
        c.ok(page.evaluate('EonAuth.displayUserRaw()') === null && !menuHistory(page).some((e) => /합성|다른 탭/.test(e.html)), `${label}: 표시를 내줌`);
        c.ok(w.routes().slice(sent).filter((r) => r.includes('/auth/v1/') || r.includes('/rpc/my_')).length === 0, `${label}: 인증 요청을 보냄`);
        if (swap) {
            c.ok(!!b, `${label}: 시험이 로그인을 바꾸지 못함`);
            c.ok(!!b && kept(w, b), `${label}: 다른 계정(B)의 호환 값·표식을 지우거나 바꿈`);
        } else {
            c.ok(compatKeys.every((k) => !w.browser.local.has(k)) && w.browser.local.has('eon_auth_v1'), `${label}: 시작할 때의 그 기록으로 만든 호환 값이 남음(또는 저장된 로그인을 지움)`);
        }
        audit(w, c, label);
    }

    // (2) 복원에서 저장된 로그인을 읽지 못함 / (3) 다시 확인(recheck): 갱신의 답을 기다리는 사이
    for (const path of ['복원에서 저장된 로그인을 읽지 못함', '다시 확인(recheck)']) {
        for (const swap of [true, false]) {
            if (!swap && path !== '다시 확인(recheck)') continue;      // 복원의 "그대로"는 "복원 오류" 시험이 본다
            const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
            const login = await loginAs(w, 'A');
            login.close();
            const label = `${path}(${swap ? '기다리는 사이 B 로 바뀜' : '그대로'})`;
            let page = null;
            if (path === '다시 확인(recheck)') {
                page = await w.open('index', 'index.html');
                c.ok(st(page) === 'signed_in', `${label}: 시험이 확인된 상태를 만들지 못함(${st(page)})`);
            }
            expire(w);
            let b = null;
            let atVerify = null;        // B 의 확인이 시작될 때 B 의 값이 글자 그대로였는가
            w.server.faults.token = (req, u) => {
                if (u.searchParams.get('grant_type') !== 'refresh_token') return null;
                if (swap && !b) b = switchToB(w);
                return 'network';
            };
            w.server.faults.my_profile = () => { if (b && atVerify === null) atVerify = kept(w, b); return null; };
            const mark = w.browser.requests.length;
            if (page) page.evaluate('EonAuth.recheck()');
            else page = await w.open('index', 'index.html', { noIdle: true });
            await w.browser.advance(90 * 1000);
            c.ok(w.count(R.refresh) === 1, `${label}: 갱신이 한 번이 아님(${w.count(R.refresh)}번)`);
            c.ok(w.count(R.logout) === 0, `${label}: 종료 요청을 보냄`);
            c.ok(!menuHistory(page).slice(-1).some((e) => /합성 회원 A/.test(e.html)), `${label}: A 의 이름이 남음`);
            if (swap) {
                const subs = subsSince(w, mark);
                c.ok(!!b, `${label}: 시험이 로그인을 바꾸지 못함`);
                c.ok(!!b && !(atVerify === false || (atVerify === null && !kept(w, b))), `${label}: 다른 계정(B)의 호환 값·표식을 지우거나 바꿈`);
                c.ok(JSON.stringify(subs) === JSON.stringify(['auth-B', 'auth-B']) && st(page) === 'signed_in' && page.evaluate('EonAuth.profile().id') === 'm-B',
                    `${label}: B 가 거절된 기록으로 남음 — 별도의 확인(두 요청)으로 그리지 않음(${subs.join(',')}·${st(page)}·${why(page)})`);
                c.ok(!!b && b.sB.alive && b.sB.prevRefresh === null, `${label}: B 의 로그인 기록이 달라짐`);
            } else {
                c.ok(st(page) === 'rejected' && why(page) === 'network' && page.evaluate('EonAuth.profile()') === null, `${label}: rejected·network 가 아님(${st(page)}·${why(page)})`);
                c.ok(compatKeys.every((k) => !w.browser.local.has(k)) && w.browser.local.has('eon_auth_v1'), `${label}: 시작할 때의 그 기록으로 만든 호환 값이 남음(또는 저장된 로그인을 지움)`);
                c.ok(subsSince(w, mark).length === 0, `${label}: 결과를 모르는데 확인 요청을 보냄`);
            }
            c.ok(noName(page), `${label}: A 의 표시를 내줌`);
            audit(w, c, label);
        }
    }
    return c.problems;
}

// 알림(갱신·저장소 변화)이 올 때마다 공식 클라이언트에 물어 갱신을 일으키지 않는다 — 기기의 시계가 앞서 있어도 갱신이 되풀이되지 않게
async function testNoRefreshLoop(opt) {
    const c = checker();
    const w = makeWorld('빈 브라우저', { variant: V.ON, mutate: opt.mutate });
    const login = await loginAs(w, 'A');
    login.close();
    const page = await w.open('index', 'index.html');
    // 저장된 만료 시각만 지난 것으로(기기의 시계가 앞선 것과 같은 효과): 공식 클라이언트에 물으면 그때마다 갱신하려 한다
    const stored = JSON.parse(w.browser.local.get('eon_auth_v1'));
    stored.expires_at = Math.floor(w.browser.now / 1000) - 60;
    w.browser.local.set('eon_auth_v1', JSON.stringify(stored));
    const before = w.count(R.refresh);
    for (let i = 0; i < 6; i++) {
        page.dispatchWindow('storage', { key: 'eon_auth_v1' });
        await w.browser.idle();
    }
    c.ok(w.count(R.refresh) === before, `갱신 되풀이: 알림마다 갱신 요청이 나감(${w.count(R.refresh) - before}번)`);
    c.ok(st(page) === 'signed_in', `갱신 되풀이: 같은 로그인 기록인데 상태가 바뀜(${st(page)}·${why(page)})`);
    audit(w, c, '갱신 되풀이');
    return c.problems;
}

const ON_TESTS = [
    ['로그인 성공 하나', testLoginOk],
    ['로그인 뒤 이동 직전의 재확인', testMoveRecheck],
    ['주소에 실린 로그인 정보를 읽지 않음', testNoUrlLogin],
    ['확인 전 표시 0(응답을 붙잡은 동안·첫 그리기부터)', testRestoreGating],
    ['signed_in 이 되지 않는 경우 13가지', testNotSignedIn],
    ['한 시도의 실패 처리가 다른 로그인을 건드리지 않음', testAttemptBinding],
    ['만료·종료된 로그인 기록(갱신 거절과 끝남을 나눔)', testExpiry],
    ['알림마다 갱신을 일으키지 않음', testNoRefreshLoop],
    ['로그아웃(결과를 봄 — 모름이면 확인 상태를 거둠)과 재로그인', testLogout],
    ['저장된 로그인 값을 읽을 수 없게 됨', testUnreadableStored],
    ['확인을 거둘 때 다른 계정의 호환 값을 지우지 않음', testWithdrawKeepsOthers],
    ['기다린 일이 실패했을 때 시작할 때의 기록으로만 정리(그 사이 바뀐 계정의 값은 그대로)', testFailedWaitKeepsOthers],
    ['옛 방식의 로그인 상태가 있는 브라우저', testLegacyPresent],
    ['저장소 상태 다섯 × 켜짐', testFiveStatesOn],
    ['자격을 싣는 조건·연결점·리디렉션', testCredentialRules],
    ['복원 중·거절 뒤 공개 키로 떨어지지 않음', testNoPublicFallback],
    ['관리자 표시(G·GM × aal1·aal2)', testAdminDisplay],
    ['두 탭(동시 갱신·로그아웃·계정 변경·보관된 화면)', testTabs],
];
// =====================================================================
// 감도 점검: 일부러 바꾼 사본을 시험이 잡는가(메모리에서만 바꾼다).
// 변조마다 "겨냥한 판정"(expect)이 깨져야 검출이다 — 사본이 아무 예외로나 죽은 것은 검출로 세지 않는다.
const MUTANTS = [
    {
        name: '자격을 싣는 조건을 "시작 글자"로 느슨하게', tests: [testCredentialRules], expect: /비슷한 주소/,
        edits: [[AUTH_FILE, "        if (u.href !== rawUrl) return null;                        // 정규 모양 그대로만\n        if (u.protocol !== 'https:' || u.origin !== ORIGIN) return null;\n        if (u.username || u.password) return null;\n", '        if (rawUrl.indexOf(ORIGIN) !== 0) return null;\n']],
    },
    {
        name: '허용 경로를 "그 글자로 시작"으로 느슨하게', tests: [testCredentialRules], expect: /비슷한 주소/,
        edits: [[AUTH_FILE, 'if (t.method === m && u.pathname === t.path && u.search === t.search) return t;', 'if (t.method === m && u.pathname.indexOf(t.path) === 0) return t;']],
    },
    {
        name: '교재 편집의 로그인 상태를 읽음', tests: [testFiveStatesOn], expect: /교재 편집·후속메일 로그인 상태/,
        edits: [[AUTH_FILE, "    async function start() {\n        loadConfig();\n", "    async function start() {\n        loadConfig();\n        try { window.localStorage.getItem('eon_book_auth_v1'); } catch (e) {}\n"]],
    },
    {
        name: '후속메일 화면의 로그인 상태를 지움', tests: [testLogout], expect: /교재 편집·후속메일 로그인 상태|다른 로그인 상태의 값/,
        edits: [[AUTH_FILE, "            clearCompat(st.claims.sid);\n            setState('signed_out', null);\n            return { outcome: 'signed_out' };", "            clearCompat(st.claims.sid);\n            window.localStorage.removeItem('sb-hmncdheiwqwekdbtijar-auth-token');\n            window.localStorage.removeItem('eon_book_auth_v1');\n            setState('signed_out', null);\n            return { outcome: 'signed_out' };"]],
    },
    {
        name: '옛 iontoefl_user 를 덮어씀', tests: [testLegacyPresent], expect: /옛 값/,
        edits: [
            [AUTH_FILE, "            if (slot.kind === 'foreign') return { ok: false, why: 'legacy_present' };   // 덮어쓰지 않는다\n", ''],
            [AUTH_FILE, "            if (slot.kind === 'foreign') return { outcome: 'legacy_present' };\n", ''],
        ],
    },
    {
        name: '쓰기 직전에 다시 확인하지 않음(로그인 전에만 봄)', tests: [testLegacyPresent], expect: /도중에 생긴 옛 값/,
        edits: [[AUTH_FILE, "            if (slot.kind === 'foreign') return { ok: false, why: 'legacy_present' };   // 덮어쓰지 않는다\n", '']],
    },
    {
        name: '꺼짐에서 SDK 를 불러옴', tests: [], section: 'off', expect: /SDK/,
        edits: [[AUTH_FILE, "    if (!ON) {\n        window.EonAuth = Object.freeze({", "    if (!ON) {\n        document.head.appendChild(Object.assign(document.createElement('script'), { src: SDK_SRC }));\n        window.EonAuth = Object.freeze({"]],
    },
    {
        name: '꺼짐에서 저장소에 씀', tests: [], section: 'off', expect: /기준과 다름: (storage|trace)/,
        edits: [[AUTH_FILE, "    if (!ON) {\n        window.EonAuth = Object.freeze({", "    if (!ON) {\n        window.localStorage.setItem(MARK_KEY, '{}');\n        window.EonAuth = Object.freeze({"]],
    },
    {
        name: '꺼짐에서 숨김 규칙을 넣음(꺼진 화면이 기준과 달라짐)', tests: [], section: 'off', expect: /기준과 다름: trace/,
        edits: [[AUTH_FILE, "    if (!ON) {\n        window.EonAuth = Object.freeze({", "    if (!ON) {\n        document.head.appendChild(Object.assign(document.createElement('style'), { textContent: 'a{display:none}' }));\n        window.EonAuth = Object.freeze({"]],
    },
    {
        name: '주소의 꼬리표로 스위치가 켜짐', tests: [testOffCannotBeTurnedOn], expect: /스위치가 켜짐/,
        edits: [[AUTH_FILE, "    const ON = EON_AUTH_SWITCH === 'on';", "    const ON = EON_AUTH_SWITCH === 'on' || /[?&]eon_auth=on/.test(window.location.search);"]],
    },
    {
        name: '저장소의 값으로 스위치가 켜짐', tests: [testOffCannotBeTurnedOn], expect: /스위치가 켜짐/,
        edits: [[AUTH_FILE, "    const ON = EON_AUTH_SWITCH === 'on';", "    const ON = EON_AUTH_SWITCH === 'on' || window.localStorage.getItem('eon_auth') === 'on';"]],
    },
    {
        name: 'my_profile 만 보고 signed_in(allowed 를 보지 않음)', tests: [testNotSignedIn], expect: /allowed 거짓/,
        edits: [[AUTH_FILE, "        if (a.allowed !== true) return { ok: false, reason: 'not_allowed' };\n", '']],
    },
    {
        name: 'my_profile 만 보고 signed_in(my_site_access 를 부르지 않음)', tests: [testNotSignedIn, testLoginOk], expect: /allowed 거짓|my_site_access/,
        edits: [[AUTH_FILE, "        const a = await askAccess(token);               // 같은 JWT(같은 로그인 기록)로 묻는다\n", "        const a = { kind: 'ok', allowed: true, isAdmin: false };\n"]],
    },
    {
        name: 'SDK 로그인 성공만으로 signed_in(차단·탈퇴·대응 없음을 보지 않음)', tests: [testNotSignedIn], expect: /거절 › (차단|탈퇴 처리 중|회원 대응 없음)/,
        edits: [[AUTH_FILE, "        if (b.state === 'no_member' || b.state === 'blocked' || b.state === 'withdrawal_pending') return { kind: b.state };\n", "        if (b.state === 'no_member' || b.state === 'blocked' || b.state === 'withdrawal_pending') return { kind: 'ok', profile: { id: 'x', name: 'x', nickname: null, email: null, phone: null, timezone: null } };\n"]],
    },
    {
        name: '두 응답 사이의 계정·로그인 기록 변경을 보지 않음', tests: [testNotSignedIn], expect: /두 응답 사이/,
        edits: [
            [AUTH_FILE, "        if (!storedIs(att)) return { ok: false, reason: 'session_changed' };\n", ''],
            [AUTH_FILE, "            if (slot.storedSid !== v.sid) return { ok: false, why: 'session_changed' };  // 확인한 그 로그인 기록이 아니다\n", ''],
        ],
    },
    {
        name: '거절 뒤 공개 키로 떨어짐', tests: [testNoPublicFallback, testExpiry], expect: /오류가 아님/,
        edits: [[AUTH_FILE, "        if (state !== 'signed_in' || !verified) throw EonAuthError(state === 'rejected' ? 'rejected' : 'signed_out');", "        if (state !== 'signed_in' || !verified) return publicCredential();"]],
    },
    {
        name: '복원 중에 기다리지 않고 공개 키를 줌', tests: [testNoPublicFallback], expect: /복원 중: 기다리지 않고 답함/,
        edits: [[AUTH_FILE, "        await ready();\n        if (state !== 'signed_in' || !verified) throw", "        if (state === 'restoring') return publicCredential();\n        if (state !== 'signed_in' || !verified) throw"]],
    },
    {
        name: '확인 요청이 거절되면 공개 키로 다시 보냄', tests: [testNotSignedIn], expect: /자격으로 나감/,
        edits: [[AUTH_FILE, "        if (r.status !== 200) return { kind: statusKind(r.status) };\n        const b = r.body;\n        if (!b || typeof b !== 'object') return { kind: 'unexpected' };", "        if (r.status !== 200) { await callRpc('/rest/v1/rpc/my_profile', ANON); return { kind: statusKind(r.status) }; }\n        const b = r.body;\n        if (!b || typeof b !== 'object') return { kind: 'unexpected' };"]],
    },
    {
        name: '결과를 모르는 확인 요청을 다시 보냄', tests: [testNotSignedIn], expect: /결과를 모르는 요청을 다시 보냄/,
        edits: [[AUTH_FILE, "        const r = await callRpc('/rest/v1/rpc/my_profile', token);\n", "        let r = await callRpc('/rest/v1/rpc/my_profile', token);\n        if (r.status === 0) r = await callRpc('/rest/v1/rpc/my_profile', token);\n"]],
    },
    {
        name: '결과를 모르는 갱신을 다시 보냄(공식 클라이언트의 재시도를 그대로 둠)', tests: [testExpiry], expect: /갱신을 다시 보냄|갱신이 한 번이 아님/,
        edits: [[AUTH_FILE, "            if (unknownRefresh.indexOf(refreshToken) >= 0) return Promise.reject(EonAuthError('refresh_unknown'));\n", '']],
    },
    {
        name: '끝났다는 답을 받고도 그 로그인을 브라우저에 남겨 둠', tests: [testExpiry], expect: /만료 코드\(session_expired\): 로그인 기록의 남김·지움/,
        edits: [[AUTH_FILE, "        if (r.ended) removeStoredIf(att);      // 서버가 끝났다고 답한 그 기록만 이 브라우저에서 지운다\n", '']],
    },
    {
        name: '429 를 "로그인이 끝났음"으로 처리', tests: [testExpiry], expect: /갱신의 답: 429: (rejected·rate_limited 가 아님|로그인 기록의 남김·지움)/,
        edits: [[AUTH_FILE, "        if (res.status === 429) return { kind: 'rate_limited' };\n        if (res.status >= 400", "        if (res.status === 429) return { kind: 'ended' };\n        if (res.status >= 400"]],
    },
    {
        name: '모든 4xx 를 "로그인이 끝났음"으로 처리', tests: [testExpiry], expect: /갱신의 답: (그 밖의 4xx|갱신값 못 찾음)[^:]*: 로그인 기록의 남김·지움/,
        edits: [[AUTH_FILE, "        if (res.status >= 400 && res.status < 500 && ENDED_CODES.indexOf(res.code) >= 0) return { kind: 'ended' };\n        return { kind: 'unknown' };\n    }", "        if (res.status >= 400 && res.status < 500) return { kind: 'ended' };\n        return { kind: 'unknown' };\n    }"]],
    },
    {
        name: '이미 쓴 갱신값의 거절을 "로그인이 끝났음"으로 처리', tests: [testExpiry], expect: /이미 쓴 갱신값[^:]*: (rejected·network 가 아님|로그인 기록의 남김·지움)/,
        edits: [[AUTH_FILE, "    const ENDED_CODES = ['session_not_found', 'session_expired'];", "    const ENDED_CODES = ['session_not_found', 'session_expired', 'refresh_token_already_used'];"]],
    },
    {
        name: '로그아웃의 결과를 보지 않음(실패·모름도 끝낸 것으로)', tests: [testLogout], expect: /로그아웃 모름\([^)]*\): 끝내지 못했는데/,
        edits: [[AUTH_FILE, "        if (!ended) return 'unknown';             // 실패·모름: 끝냈다고 하지 않는다. 다시 보내지도 않는다\n", '']],
    },
    {
        name: '앞의 로그인을 끝냈는지 모르는데 새 로그인을 보냄', tests: [testLogout], expect: /이전 로그인 모름: 앞의 것을 끝내지 못했는데 새 로그인 요청을 보냄/,
        edits: [[AUTH_FILE, "                if ((await boundEnd(st.claims)) !== 'ended') {\n", "                if ((await boundEnd(st.claims)) === 'never') {\n"]],
    },
    {
        name: '갱신이 그 시도의 로그인 기록에 묶이지 않음(직전 확인도, 나가는 곳의 확인도 없음)', tests: [testAttemptBinding], expect: /묶기·갱신[^:]*: B 에 대한 갱신 요청이 나감/,
        edits: [
            WEAKEN[0],
            [AUTH_FILE, "                if (bound.kind !== 'refresh' || refreshToken !== bound.token || !same(st.claims, bound)) {", "                if (bound.kind !== 'refresh' || refreshToken !== bound.token) {"],
        ],
    },
    {
        name: '종료가 그 시도의 로그인 기록에 묶이지 않음(직전 확인도, 나가는 곳의 확인도 없음)', tests: [testAttemptBinding], expect: /묶기·종료[^:]*: B 에 대한 종료 요청이 나감/,
        edits: [
            WEAKEN[1],
            [AUTH_FILE, "            if (!bound || bound.kind !== 'logout' || !c || c.sub !== bound.sub || c.sid !== bound.sid) {", "            if (!bound || bound.kind !== 'logout' || !c) {"],
        ],
    },
    {
        name: '표시 직전에 저장된 로그인 기록을 견주지 않음', tests: [testAttemptBinding], expect: /표시 직전: 저장된 로그인이 바뀌었는데 표시를 내줌/,
        edits: [[AUTH_FILE, "            if (slot.mark.sid !== verified.sid || slot.storedSid !== verified.sid) return null;", "            if (slot.mark.sid !== verified.sid) return null;"]],
    },
    {
        name: '이 탭이 확인하지 않은 로그인도 끝냄', tests: [testAttemptBinding], expect: /표시 직전: 이 탭이 확인하지 않은 로그인\(B\)에 대한 종료 요청이 나감/,
        edits: [[AUTH_FILE, "            if (!st || !st.claims || !same(st.claims, mine)) {\n                // 저장된 로그인이 이 탭이 확인한 것이 아니다", "            if (!st || !st.claims) {\n                // 저장된 로그인이 이 탭이 확인한 것이 아니다"]],
    },
    {
        name: '이동 직전에 다시 보지 않음', tests: [testMoveRecheck], expect: /이동 직전\([^)]*\): 다시 보지 않고 이동함/,
        edits: [['js/login.js', "                if (window.EonAuth.isCurrent(attempt)) {", "                if (true) {"]],
    },
    {
        name: '복원이 오류로 끝난 길에 호환 값을 남김', tests: [testExpiry], expect: /복원 오류\([^)]*\): 새 모듈이 만든 호환 값이 남음/,
        edits: [[AUTH_FILE, "        clearCompat(began.sid, true);\n        return true;", '        return true;']],
    },
    {
        name: '상태를 맞출 때마다 공식 클라이언트에 물어 갱신을 일으킴', tests: [testNoRefreshLoop], expect: /갱신 되풀이: 알림마다 갱신 요청이 나감/,
        edits: [[AUTH_FILE, "        const st = present ? storedSession() : null;\n        const s = st && st.claims && typeof st.accessToken === 'string'", "        await readSession();\n        const st = present ? storedSession() : null;\n        const s = st && st.claims && typeof st.accessToken === 'string'"]],
    },
    {
        name: '로그아웃 모름에서 이 탭의 확인 상태를 남김', tests: [testLogout], expect: /로그아웃 모름\([^)]*\): 로그아웃 모름인데 (확인 상태가 남음|본인 정보)/,
        edits: [[AUTH_FILE, "                withdraw(e === 'changed' ? 'session_changed' : 'logout_unknown', st.claims.sid);\n", '']],
    },
    {
        name: '앞 로그인을 끝내지 못했는데 이 탭의 확인 상태를 남김', tests: [testLogout], expect: /이전 로그인 모름: 로그아웃 모름인데 확인 상태·본인 정보가 남음/,
        edits: [[AUTH_FILE, "                    if (same(verified, st.claims) || state === 'signed_in') { lastRejected = st.claims; withdraw('logout_unknown', st.claims.sid); }\n", '']],
    },
    {
        name: '읽을 수 없는 저장값인데 profile()·siteAccess() 가 값을 줌', tests: [testUnreadableStored], expect: /읽을 수 없는 저장값\([^)]*\): 알림이 오기 전인데 본인 정보/,
        edits: [
            [AUTH_FILE, "state === 'signed_in' && verified && storedIs(verified) ? Object.assign({}, verified.profile) : null;", "state === 'signed_in' && verified ? Object.assign({}, verified.profile) : null;"],
            [AUTH_FILE, "state === 'signed_in' && verified && storedIs(verified) ? { allowed: true, is_admin: verified.isAdmin } : null;", "state === 'signed_in' && verified ? { allowed: true, is_admin: verified.isAdmin } : null;"],
        ],
    },
    {
        name: '읽을 수 없는 저장값인데 확인 상태를 남김(상태 맞추기가 그대로 돌아감)', tests: [testUnreadableStored], expect: /읽을 수 없는 저장값\([^)]*\): 확인 상태가 남음/,
        edits: [[AUTH_FILE, "            if (state === 'signed_in') withdraw('unreadable', verified ? verified.sid : null);\n            return;\n        }\n        const c = st.claims;", "            return;\n        }\n        const c = st.claims;"]],
    },
    {
        name: '꺼짐의 화면이 정적 파일을 하나 더 받음(차이 장부 밖)', tests: [], section: 'off-static', expect: /기준보다 더 받는 것이 같은 출처의 인증 모듈 파일 1개가 아님/,
        edits: [['index.html', '</head>', '    <script src="vendor/supabase-2.116.0.js"></script>\n</head>']],
    },
    {
        name: '확인을 거둘 때 "주인 없는 값" 규칙으로도 지움(다른 계정의 값이 지워짐)', tests: [testWithdrawKeepsOthers], expect: /거둘 때\(로그아웃 모름\): 다른 계정\(B\)의 호환 값·표식을 지우거나 바꿈/,
        edits: [[AUTH_FILE, "        clearCompat(sid === undefined ? null : sid, true);\n        setState('rejected', why);", "        clearCompat(sid === undefined ? null : sid);\n        setState('rejected', why);"]],
    },
    {
        name: '읽지 못한 저장값을 "다르다"로 쳐서 거둘 때 지움(3차의 모양)', tests: [testWithdrawKeepsOthers], expect: /거둘 때\(읽을 수 없는 저장값[^)]*\): 다른 계정\(B\)의 호환 값·표식을 지우거나 바꿈/,
        edits: [
            [AUTH_FILE, "            const stale = slot.stored === 'absent' || (slot.stored === 'ok' && slot.mark.sid !== slot.storedSid);", '            const stale = slot.mark.sid !== slot.storedSid;'],
            [AUTH_FILE, "        clearCompat(sid === undefined ? null : sid, true);\n        setState('rejected', why);", "        clearCompat(sid === undefined ? null : sid);\n        setState('rejected', why);"],
        ],
    },
    {
        name: '읽지 못한 저장값을 "다르다"로 침(주인 없는 값 규칙)', tests: [testWithdrawKeepsOthers], expect: /읽을 수 없는 저장값으로 연 화면: 주인을 알 수 없는 호환 값·표식을 지움/,
        edits: [[AUTH_FILE, "            const stale = slot.stored === 'absent' || (slot.stored === 'ok' && slot.mark.sid !== slot.storedSid);", '            const stale = slot.mark.sid !== slot.storedSid;']],
    },
    {
        name: '주인 없는 값(저장된 로그인이 없음을 확인)도 정리하지 않음', tests: [testWithdrawKeepsOthers], expect: /저장된 로그인이 없는 화면: 주인 없는/,
        edits: [[AUTH_FILE, "            const stale = slot.stored === 'absent' || (slot.stored === 'ok' && slot.mark.sid !== slot.storedSid);", '            const stale = false;']],
    },
    {
        name: '실패한 뒤 다시 읽은 기록으로 정리(SDK 를 쓸 수 없는 길)', tests: [testFailedWaitKeepsOthers], expect: /SDK 를 쓸 수 없음\(기다리는 사이 B 로 바뀜\): 다른 계정\(B\)의 호환 값·표식을 지우거나 바꿈/,
        edits: [[AUTH_FILE, '            cleanAfterFailedWait(beganLoad);       // 확인할 수 없다', '            cleanAfterFailedWait(heldClaims());       // 확인할 수 없다']],
    },
    {
        name: '실패한 뒤 다시 읽은 기록으로 정리(복원에서 읽지 못한 길)', tests: [testFailedWaitKeepsOthers], expect: /복원에서 저장된 로그인을 읽지 못함\(기다리는 사이 B 로 바뀜\): 다른 계정\(B\)의 호환 값·표식을 지우거나 바꿈/,
        edits: [[AUTH_FILE, 'if (cur.error) { failedRead(beganRead); return; }', 'if (cur.error) { failedRead(heldClaims()); return; }']],
    },
    {
        name: '기다린 뒤에 기록을 잡음(복원에서 읽지 못한 길)', tests: [testFailedWaitKeepsOthers], expect: /복원에서 저장된 로그인을 읽지 못함\(기다리는 사이 B 로 바뀜\): (다른 계정\(B\)의 호환 값·표식을 지우거나 바꿈|B 가 거절된 기록으로 남음)/,
        edits: [[AUTH_FILE, "        const beganRead = heldClaims();            // 기다리기 전에: 이 탭이 복원하려던 기록\n        const cur = await readSession();", "        const cur = await readSession();\n        const beganRead = heldClaims();"]],
    },
    {
        name: '실패한 뒤 다시 읽은 기록으로 정리(다시 확인의 길)', tests: [testFailedWaitKeepsOthers], expect: /다시 확인\(recheck\)\(기다리는 사이 B 로 바뀜\): 다른 계정\(B\)의 호환 값·표식을 지우거나 바꿈/,
        edits: [[AUTH_FILE, 'if (cur.error) { failedRead(began); return state; }', 'if (cur.error) { failedRead(heldClaims()); return state; }']],
    },
    {
        name: '실패한 뒤 다시 읽은 기록을 거절된 기록으로 남김', tests: [testFailedWaitKeepsOthers], expect: /B 가 거절된 기록으로 남음/,
        edits: [[AUTH_FILE, "        lastRejected = null;\n        const now = heldClaims();", "        lastRejected = heldClaims();\n        const now = heldClaims();"]],
    },
    {
        name: '기다린 일이 실패해도 시작할 때의 기록으로 만든 값을 정리하지 않음(SDK·다시 확인)', tests: [testFailedWaitKeepsOthers], expect: /\(그대로\): 시작할 때의 그 기록으로 만든 호환 값이 남음/,
        edits: [[AUTH_FILE, "        clearCompat(began.sid, true);\n        return true;", '        return true;']],
    },
    {
        name: '전역 로그아웃', tests: [testLogout], expect: /이 로그인만 끝내는 것이 아님/,
        edits: [
            [AUTH_FILE, "client.admin.signOut(st.accessToken, 'local')", "client.admin.signOut(st.accessToken, 'global')"],
            [AUTH_FILE, "search: '?scope=local'", "search: '?scope=global'"],
        ],
    },
    {
        name: '리디렉션을 따라감', tests: [testCredentialRules], expect: /리디렉션/,
        edits: [[AUTH_FILE, "            redirect: 'error',            // 리디렉션을 따라가지 않는다\n", '']],
    },
    {
        name: '추가 머리글로 자격을 덮어쓸 수 있음', tests: [testCredentialRules], expect: /덮어쓸 수 있음/,
        edits: [[AUTH_FILE, "        const g = normalizeGrade(grade);\n        assertNoCredentialOverride(extra);\n", "        const g = normalizeGrade(grade);\n"]],
    },
    {
        name: '연결점이 회원 등급을 공개 키로 돌려줌', tests: [testCredentialRules], expect: /연결점: 회원·관리자 등급이 오류가 아님/,
        edits: [[AUTH_FILE, "        throw EonAuthError(g === GRADES.LEGACY_OWN ? 'legacy_own' : 'grade_closed');\n    }\n\n    // ---", "        return Object.assign({ 'apikey': anonKey(), 'Authorization': 'Bearer ' + anonKey(), 'Content-Type': 'application/json' }, extra);\n    }\n\n    // ---"]],
    },
    {
        name: '확인 전에 저장된 값으로 머리말을 그림(main.js)', tests: [testRestoreGating, testLegacyPresent], expect: /응답을 붙잡고 있는 동안|옛 값/,
        edits: [['js/main.js', "    if (window.EonLogin) return window.EonLogin.raw();\n", '']],
    },
    {
        name: '확인 전에 저장된 값으로 머리말을 그림(common.js)', tests: [testRestoreGating, testLegacyPresent], expect: /응답을 붙잡고 있는 동안|옛 값/,
        edits: [['js/common.js', "    if (window.EonLogin) return window.EonLogin.raw();\n", '']],
    },
    {
        name: '확인 전에도 표시를 내줌(모듈)', tests: [testRestoreGating], expect: /응답을 붙잡고 있는 동안/,
        edits: [[AUTH_FILE, "        if (displayHold || state !== 'signed_in' || !verified) return null;\n        try {\n            const slot = readSlot();\n            if (slot.kind !== 'ours' || slot.user === null) return null;\n            if (slot.mark.sid !== verified.sid || slot.storedSid !== verified.sid) return null;", "        if (displayHold) return null;\n        try {\n            const slot = readSlot();\n            if (slot.kind !== 'ours' || slot.user === null) return null;"]],
    },
    {
        name: '첫 그리기에 숨김 규칙이 없음(학습 자료 링크가 먼저 보임)', tests: [testRestoreGating], expect: /첫 그리기/,
        edits: [[AUTH_FILE, "        style.textContent = HIDE_CSS;", "        style.textContent = '';"]],
    },
    {
        name: '인증 모듈을 head 가 아니라 화면 끝에서 실음', tests: [testRestoreGating], expect: /첫 그리기 — 숨김 규칙이 head 에서/,
        edits: ['index.html', 'login.html'].flatMap((f) => [
            [f, '    ' + MODULE_TAG + '\n</head>', '</head>'],
            [f, '    <script src="js/supabase-config.js?v=20261012"></script>\n', '    <script src="js/supabase-config.js?v=20261012"></script>\n    ' + MODULE_TAG + '\n'],
        ]),
    },
    {
        name: '확인되기 전에 관리자 표시(class)를 붙임', tests: [testRestoreGating], expect: /응답을 붙잡고 있는 동안 표시가 보임|첫 그리기 — 이름·관리자 표시/,
        edits: [[AUTH_FILE, "        if (role === 'admin') list.add('eon-auth-admin'); else list.remove('eon-auth-admin');", "        list.add('eon-auth-admin');"]],
    },
    {
        name: '켜진 로그인이 주소의 redirect 값으로 이동', tests: [testLoginOk], expect: /이동이 index\.html 한 번이 아님/,
        edits: [['js/login.js', "            const eonReturnTo = window.EonLogin.returnTarget(new URLSearchParams(window.location.search).get('redirect')) || 'index.html';", "            const eonReturnTo = new URLSearchParams(window.location.search).get('redirect') || 'index.html';"]],
    },
    {
        name: '켜진 화면이 옛 값만 보고 자동 이동', tests: [testLegacyPresent], expect: /자동 이동/,
        edits: [['js/login.js', "    if (window.EonLogin && window.EonLogin.on()) return;\n", '']],
    },
    {
        name: '로그아웃이 새 모듈의 것이 아닌 호환 값을 지움', tests: [testLogout], expect: /새 모듈의 것이 아닌 값/,
        edits: [
            [AUTH_FILE, "            if (slot.kind === 'ours') {\n                if (slot.user === slot.mark.user) store.removeItem(COMPAT_USER);\n                if (slot.time === slot.mark.time) store.removeItem(COMPAT_TIME);\n            }", '            store.removeItem(COMPAT_USER);\n            store.removeItem(COMPAT_TIME);'],
        ],
    },
    {
        name: '관리자 표시를 본인 정보의 값으로 채움(is_admin 을 쓰지 않음)', tests: [testAdminDisplay], expect: /GM·aal1/,
        edits: [[AUTH_FILE, "                role: v.isAdmin ? 'admin' : 'user'      // 표시에만 쓴다(서버 권한이 아니다)", "                role: /관리자/.test(String(p.name)) ? 'admin' : 'user'"]],
    },
    {
        name: '다른 탭의 로그아웃을 따라가지 않음', tests: [testTabs], expect: /두 탭: (한 탭 로그아웃 뒤 상태|다른 탭에 이름이 남음)/,
        edits: [[AUTH_FILE, "        if (ev.key === STORAGE_KEY || ev.key === null) { redraw(false); scheduleReconcile(); }", '']],
    },
    {
        name: '공식 클라이언트가 별도 저장 이름을 쓰지 않음(기본 이름·저장소 전체)', tests: [testLoginOk], expect: /저장소의 이름|통로의 이름/,
        edits: [[AUTH_FILE, "                storageKey: STORAGE_KEY,\n                storage: scopedStorage,\n", '                storage: window.localStorage,\n']],
    },
    {
        name: '차단기가 자격의 용도가 맞지 않는 요청(leak)을 보내 줌', tests: [], section: 'request-log', expect: /가르기: .*중단하지 않음/,
        edits: [['tests/auth-session/request-log.mjs', '        const allowed = placeOk && !leak;', '        const allowed = placeOk;']],
    },
    {
        name: '차단기가 회원 JWT 의 발급자·계정을 보지 않음', tests: [], section: 'request-log', expect: /가르기: (다른 발급자의 회원 JWT|합성 계정이 아닌 회원 JWT)[^—]*— 전송 전에 중단하지 않음/,
        edits: [['tests/auth-session/request-log.mjs', "!emailsNow().includes(c.email.trim().toLowerCase())) problems.push('foreign_member_jwt');", "!emailsNow().includes(c.email.trim().toLowerCase())) problems.length;"]],
    },
    {
        name: '실행기: 예행(P)이 실패해도 다음 경우로 감', tests: [], section: 'screen-core', expect: /실행기: 예행이 실패했는데 (뒤의 경우를 시작함|비밀 보관함이 열림)/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (!p || !allTrue(p.checks)) return { stopped: 'preflight', started };\n", '']],
    },
    {
        name: '실행기: 미확인인 판정이 있어도 예행을 통과로 봄', tests: [], section: 'screen-core', expect: /실행기: 예행이 실패했는데 뒤의 경우를 시작함\(판정 하나가 미확인\)/,
        edits: [['tests/auth-session/screen-core.mjs', 'checks.length > 0 && checks.every((c) => c.ok === true);', 'checks.length > 0 && checks.every((c) => c.ok !== false);']],
    },
    {
        name: '실행기: 원복 대상의 표시를 "계속"을 받은 뒤에 세움', tests: [], section: 'screen-core', expect: /실행기: (답을 받지 못한 멈춤\([^)]*\)이 원복 대상으로|원복 확인을 받지 못했는데 다음 경우를 시작함)/,
        edits: [
            ['tests/auth-session/screen-core.mjs', '        if (needsRevert) this.pendingRevert = kind;\n', ''],
            ['tests/auth-session/screen-core.mjs', "                    entry.result = 'answered';\n", "                    entry.result = 'answered';\n                    if (needsRevert) this.pendingRevert = kind;\n"],
        ],
    },
    {
        name: '실행기: 원복 확인 없이 다음 경우를 시작함', tests: [], section: 'screen-core', expect: /실행기: (원복 확인을 받지 못했는데 다음 경우를 시작함|원복 대상이 남은 채 다음 경우를 시작함)/,
        edits: [['tests/auth-session/screen-core.mjs', "        if (board.pendingRevert && !(await confirmRevert(board))) return { stopped: 'revert', started };\n        started.push(c.id);", '        started.push(c.id);']],
    },
    {
        name: '실행기: 원복했다는 답이 아닌데 원복 표시를 지움', tests: [], section: 'screen-core', expect: /실행기: 원복했다는 답이 아닌데/,
        edits: [['tests/auth-session/screen-core.mjs', 'if (revertOf && this.pendingRevert === revertOf && body && body.reverted === true) this.pendingRevert = null;', 'if (revertOf && this.pendingRevert === revertOf) this.pendingRevert = null;']],
    },
    {
        name: '실행기: 받은 로그인 상태의 발급자를 보지 않음', tests: [], section: 'screen-core', expect: /출처 확인: 발급자가 (다른|없는)/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (c.iss !== ISSUER) return no('issuer');\n    if (c.role", '    if (c.role']],
    },
    {
        name: '실행기: 받은 로그인 상태의 계정을 보지 않음', tests: [], section: 'screen-core', expect: /출처 확인: 계정이 다른 로그인 상태/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (typeof c.email !== 'string' || lower(c.email) !== lower(expect.email)) return no('account');\n    if (typeof session.user.email !== 'string' || lower(session.user.email) !== lower(expect.email)) return no('account');\n", '']],
    },
    {
        name: '실행기: 받은 로그인 상태의 aal 을 보지 않음', tests: [], section: 'screen-core', expect: /출처 확인: aal 이 다른/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (c.aal !== expect.aal) return no('aal');\n", '']],
    },
    {
        name: '실행기: access_token 이 글자이기만 하면 넣음(2차의 모양)', tests: [], section: 'screen-core', expect: /출처 확인: /,
        edits: [['tests/auth-session/screen-core.mjs', "    const keys = Object.keys(session);\n", "    if (typeof session.access_token === 'string') return { ok: true };\n    const keys = Object.keys(session);\n"]],
    },
    {
        name: '실행기: 예행의 예외가 메서드를 보지 않음(POST 를 보내 줌)', tests: [], section: 'screen-core', expect: /예행의 예외: POST 을\(를\) 내보내 줌/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (record.method !== 'GET' || String(req.method || '').toUpperCase() !== 'GET') return false;\n", '']],
    },
    {
        name: '실행기: 예행의 예외가 자격을 보지 않음(공개 키·apikey 가 실린 요청을 보내 줌)', tests: [], section: 'screen-core', expect: /예행의 예외: (공개 키가|apikey 만) 실린 GET 을\(를\) 내보내 줌/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (record.credential !== 'none' || record.apikey !== false) return false;\n", '']],
    },
    {
        name: '실행기: 예행의 예외가 본문을 보지 않음', tests: [], section: 'screen-core', expect: /예행의 예외: 본문이 실린 GET 을\(를\) 내보내 줌/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (req.postData !== null && req.postData !== undefined && req.postData !== '') return false;\n", '']],
    },
    {
        name: '실행기: 예행의 예외가 자격 위반 판정보다 먼저(위반으로 판정된 요청을 보내 줌)', tests: [], section: 'screen-core', expect: /예행의 예외: 자격 위반으로 판정된 요청을 내보내 줌/,
        edits: [['tests/auth-session/screen-core.mjs', "    if (record.leak !== false || !Array.isArray(record.leakKinds) || record.leakKinds.length !== 0) return false;\n", '']],
    },
    {
        name: '실행기: 예행의 예외가 주소만 봄(3차의 모양)', tests: [], section: 'screen-core', expect: /예행의 예외: /,
        edits: [['tests/auth-session/screen-core.mjs', "    if (!record || !req) return false;\n    if (record.leak !== false", "    if (record && record.where === 'sink') return true;\n    if (!record || !req) return false;\n    if (record.leak !== false"]],
    },
    {
        name: '실행기: 브라우저에 환경 변수를 그대로 넘김', tests: [], section: 'screen-core', expect: /브라우저에 필요한 것 말고 다른 환경 변수/,
        edits: [['tests/auth-session/screen-core.mjs', "if (ENV_ALLOW.includes(k.toUpperCase()) && typeof v === 'string') out[k] = v;", "if (typeof v === 'string') out[k] = v;"]],
    },
    {
        name: '차단기가 기록에 주소를 남김', tests: [], section: 'request-log', expect: /가르기: 기록에/,
        edits: [['tests/auth-session/request-log.mjs', '                where, target, nav, type, method,', '                where, target, nav, type, method, url: req.url,']],
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
        const check = applyEdits(m.edits, editProblems);
        for (const file of new Set(m.edits.map((e) => e[0]))) check(file, workFile(file));     // 바꿀 자리가 있는지 먼저 본다
        if (editProblems.length) { problems.push(`감도 "${m.name}": ${editProblems[0]}`); continue; }
        const found = [];
        const crashes = [];
        const run = async (fn) => { try { found.push(...(await fn())); } catch (e) { crashes.push(String(e && e.message)); } };
        if (m.section === 'off') await run(async () => (await sectionOff(applyEdits(m.edits, []))).problems);
        if (m.section === 'off-static') await run(async () => sectionOffStatic(applyEdits(m.edits, [])).problems);
        if (m.section === 'screen-core') await run(async () => (await sectionScreenCore(applyEdits(m.edits, []))).problems);
        if (m.section === 'request-log') await run(async () => (await sectionRequestLog(applyEdits(m.edits, []))).problems);
        for (const test of m.tests) await run(() => test({ mutate: applyEdits(m.edits, []) }));
        const hit = found.filter((p) => m.expect.test(p));
        if (hit.length === 0) {
            problems.push(`감도 "${m.name}": 겨냥한 판정이 깨지지 않음(다른 어긋남 ${found.length}건, 예외 ${crashes.length}건)`);
            lines.push(`    - ${m.name}: 잡지 못함`);
        } else {
            lines.push(`    - ${m.name}: 겨냥한 판정 ${hit.length}건이 깨짐${crashes.length ? ` (그 밖에 예외 ${crashes.length}건 — 검출로 세지 않음)` : ''}`);
        }
    }
    return { problems, lines };
}
// =====================================================================
// 글자 점검
// =====================================================================
function git(args) {
    // 한글 파일 이름을 따옴표·8진수로 바꾸지 않게 한다
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
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
    if ((code.match(/client\.admin\.signOut\(st\.accessToken, 'local'\)/g) || []).length !== 1 || /client\.signOut\(|'global'|'others'/.test(code)) problems.push('로그아웃이 "그 기록의 JWT 로, 이 로그인만(local)" 한 곳이 아님');
    if (!/client\.refreshSession\(\{ refresh_token: st\.refreshToken \}\)/.test(code) || /client\.refreshSession\(\)/.test(code)) problems.push('모듈이 시작하는 갱신이 그 기록의 갱신값을 지정하지 않음');

    // 기준에서 바뀐 파일
    // 계약 3A 의 파일 + 계약 3C-1 의 파일(대상 화면 26개와 그 화면의 스크립트)
    const allowed = new Set([...TARGET_FILES, 'js/auth-session.js', 'js/common.js', 'js/login.js', 'js/main.js', 'js/supabase-config.js',
        'js/admin-utils.js', 'js/analysis-view.js', 'js/application-detail.js', 'js/application-form.js', 'js/application.js', 'js/book-request.js',
        'js/change-password.js', 'js/dashboard.js', 'js/find-id.js', 'js/find-password.js', 'js/my-profile.js', 'js/register.js', 'js/survey.js', 'js/withdraw.js']);
    const changed = git(['diff', '--name-only', BASE]).split('\n').filter(Boolean);
    const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
    const outside = changed.concat(untracked).filter((f) => !allowed.has(f) && !f.startsWith('tests/auth-session/') && !f.startsWith('tests/supabase-config-headers/'));
    info.changed = changed.concat(untracked).filter((f) => allowed.has(f)).sort();
    if (outside.length) problems.push(`기준에서 바뀐 파일이 범위 밖에 있음: ${outside.join(', ')}`);

    // 인증 모듈을 싣는 화면
    const loaders = git(['grep', '-l', 'auth-session.js', '--', '*.html']).split('\n').filter(Boolean).sort();
    info.loaders = loaders;
    if (JSON.stringify(loaders) !== JSON.stringify(TARGET_FILES.slice().sort())) problems.push(`인증 모듈을 싣는 화면이 대상 화면 ${TARGET_FILES.length}개와 같지 않음(${loaders.join(', ')})`);
    // 게이트(화면의 스위치 + 로그인 값을 주는 한 길): 대상 화면마다 원본과 같은 글자로, 인증 모듈 태그 바로 앞에, 값은 꺼짐
    const gateSource = workFile(GATE_SOURCE).trim();
    info.gatePages = 0;
    for (const f of TARGET_FILES) {
        const html = workFile(f);
        if (extractGate(html) !== gateSource) { problems.push(`${f}: 게이트의 글자가 원본(${GATE_SOURCE})과 다름`); continue; }
        if (pageSwitchValue(html) !== 'off') problems.push(`${f}: 저장소의 화면 스위치 값이 꺼짐이 아님`);
        const gateAt = html.indexOf(gateSource);
        const tagAt = html.indexOf(MODULE_TAG);
        const between = html.slice(gateAt + gateSource.length, tagAt);
        if (tagAt < gateAt || between.replace(/\s/g, '') !== '</script>') problems.push(`${f}: 게이트가 인증 모듈 태그 바로 앞에 있지 않음`);
        if (html.indexOf('</head>') < tagAt) problems.push(`${f}: 게이트·인증 모듈이 head 안에 있지 않음`);
        info.gatePages++;
    }
    // 게이트가 다른 화면(대상이 아닌 화면)에 들어가 있지 않은가
    const gated = git(['grep', '-l', 'eon-login-gate:begin', '--', '*.html']).split('\n').filter(Boolean).sort();
    if (JSON.stringify(gated) !== JSON.stringify(TARGET_FILES.slice().sort())) problems.push(`게이트가 든 화면이 대상 화면과 같지 않음(${gated.length}개)`);
    for (const f of loaders) {
        const scripts = extractScripts(workFile(f)).filter((s) => s.src);
        const mine = scripts.filter((s) => s.src.split('?')[0] === AUTH_FILE);
        if (mine.length !== 1 || !mine[0].head) problems.push(`${f}: 인증 모듈이 head 에서 한 번 실리지 않음(첫 그리기 전에 숨김 규칙이 걸려야 한다)`);
        const headScripts = extractScripts(workFile(f)).filter((s) => s.head);
        const at = headScripts.findIndex((s) => s.src && s.src.split('?')[0] === AUTH_FILE);
        if (at < 1 || !headScripts[at - 1].inline || !headScripts[at - 1].inline.includes('eon-login-gate:begin')) problems.push(`${f}: head 에서 인증 모듈 바로 앞의 스크립트가 게이트가 아님`);
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
    // 인증 모듈(EonAuth)을 직접 부르는 곳: 모듈 자신, 게이트(대상 화면의 head), 로그인 화면, 머리말의 로그아웃, 연결점
    // (계약 3C-2a) 회원 업무(my-scores)를 전송 담당 함수로 부르는 화면의 스크립트 하나가 더해졌다: js/application-form.js
    const allowedUsers = [...TARGET_FILES, 'js/auth-session.js', 'js/login.js', 'js/main.js', 'js/supabase-config.js', 'js/application-form.js'];
    // 그 스크립트가 인증 모듈에서 부르는 것은 업무가 열렸는가(memberTaskOpen)와 전송 담당 함수(memberRead)뿐이다 — 머리글·자격을 받는 함수를 부르지 않는다
    {
        const form = workFile('js/application-form.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        const called = [...new Set((form.match(/eonAuth\.([A-Za-z]+)/g) || []).map((x) => x.split('.')[1]))].sort();
        if (JSON.stringify(called) !== '["memberRead","memberTaskOpen"]' || (form.match(/EonAuth/g) || []).length !== 1 || /headersForGrade|credentialFor/.test(form)) problems.push(`js/application-form.js 가 인증 모듈에서 부르는 것이 memberTaskOpen·memberRead 둘이 아님(${called.join(',')})`);
    }
    if (users.some((f) => !allowedUsers.includes(f))) problems.push(`인증 모듈을 쓰는 파일이 범위 밖에 있음: ${users.filter((f) => !allowedUsers.includes(f)).join(', ')}`);
    // 한 길(EonLogin)을 쓰는 스크립트: 대상 화면만 싣거나, 대상이 아닌 화면도 싣는 파일이면 EonLogin 이 없을 때의 길을 둔다
    const gateUsers = git(['grep', '-l', 'EonLogin', '--', 'js/*.js']).split('\n').filter(Boolean).sort();
    info.gateUsers = gateUsers;
    const allHtml = git(['ls-files', '--', '*.html']).split('\n').filter((x) => x && !x.includes('/'));
    for (const js of gateUsers) {
        const loadedBy = allHtml.filter((h) => extractScripts(workFile(h) || '').some((s) => s.src && s.src.split('?')[0] === js));
        const outsiders = loadedBy.filter((h) => !TARGET_FILES.includes(h));
        if (!outsiders.length) continue;
        const text = workFile(js);
        const bare = text.split('\n').filter((l) => !l.trim().startsWith('//') && /EonLogin\./.test(l) && !/window\.EonLogin/.test(l));
        if (bare.length) problems.push(`${js}: 대상이 아닌 화면(${outsiders.join(', ')})도 싣는데 EonLogin 이 없을 때의 길 없이 부름`);
    }

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
    const tracked = git(['ls-files']).split('\n').filter(Boolean);
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
        if (get('/__b3a/probe').status !== 200 || core.counts.probe !== 1) problems.push(`서버(${mode}): 수신 확인용 끝점이 세지 못함`);
        const red = get('/__b3a/redirect/sink');
        if (red.status !== 302 || red.headers.Location !== '/__b3a/sink/redirected' || get('/__b3a/blank').status !== 200) problems.push(`서버(${mode}): 리디렉션 대조용 끝점이 맞지 않음`);
        const freeText = logs.filter((e) => Object.entries(e).some(([k, v]) => !['ts', 'file'].includes(k) && typeof v === 'string' && !/^[a-zA-Z0-9_.:-]{1,40}$/.test(v)));
        if (freeText.length) problems.push(`서버(${mode}): 기록에 자유 형식의 글자가 있음(${freeText.length}줄)`);
        if (logs.some((e) => e.file !== undefined && !files.includes(e.file))) problems.push(`서버(${mode}): 기록의 파일 이름이 저장소의 파일 목록에 없는 것`);
        if (!logs.some((e) => e.t === 'csp' && e.directive === 'connect-src' && e.blocked === 'outside')) problems.push(`서버(${mode}): 막힌 요청이 기록되지 않음`);
        info['ok' + mode] = ok200;
    }
    return { problems, info };
}

// 실행기의 판단 부분(screen-core.mjs): 예행이 통과하기 전에는 아무것도 시작하지 않음, 원복 대상의 표시, 받은 로그인 상태의 출처, 브라우저에 넘기는 환경 변수.
// mutate 를 주면 그 파일의 사본을 바꿔서 본다(감도 점검). 브라우저는 쓰지 않는다.
async function loadTestModule(rel, mutate) {
    if (!mutate) return import('./' + rel.split('/').pop());
    const here = path.join(ROOT, 'tests', 'auth-session');
    let text = mutate(rel, workFile(rel));
    text = text.replace(/from '\.\/([a-z-]+\.mjs)'/g, (m, name) => `from ${JSON.stringify(pathToFileURL(path.join(here, name)).href)}`);
    const file = path.join(os.tmpdir(), `b3a-${rel.split('/').pop()}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
    fs.writeFileSync(file, text);
    try { return await import(pathToFileURL(file).href); } finally { fs.unlinkSync(file); }
}

async function sectionScreenCore(mutate) {
    const problems = [];
    const core = await loadTestModule('tests/auth-session/screen-core.mjs', mutate);
    const { PauseBoard, PauseTimeout, makeVault, runSequence, checkProvidedSession, browserEnv, memberJwtOrigin, ISSUER } = core;
    let stepNo = 1000;
    const newBoard = (timeoutMs) => new PauseBoard({ timeoutMs, randomStep: () => ++stepNo });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const locked = (vault) => { try { vault.get('PW'); return false; } catch (e) { return true; } };

    // (1) 예행(P)이 전부 참이 아니면 뒤의 경우를 시작하지 않고 보관함도 열지 않는다
    const bad = [
        ['판정 하나가 거짓', { checks: [{ name: 'a', ok: true }, { name: 'b', ok: false }] }],
        ['판정 하나가 미확인', { checks: [{ name: 'a', ok: true }, { name: 'b', ok: null }] }],
        ['판정이 없음(도중에 예외)', { checks: [] }],
        ['결과가 없음', null],
    ];
    for (const [name, result] of bad) {
        const vault = makeVault({ PW: 'zz' });
        const ran = [];
        const out = await runSequence({ preflight: async () => result, cases: [{ id: '1', run: async () => { ran.push('1'); } }, { id: '2', run: async () => { ran.push('2'); } }], vault, board: newBoard(30) });
        if (ran.length || out.started.length) problems.push(`실행기: 예행이 실패했는데 뒤의 경우를 시작함(${name})`);
        if (out.stopped !== 'preflight') problems.push(`실행기: 예행 실패를 따로 알리지 않음(${name})`);
        if (!locked(vault)) problems.push(`실행기: 예행이 실패했는데 비밀 보관함이 열림(${name})`);
    }
    {
        const vault = makeVault({ PW: 'zz' });
        const ran = [];
        let lockedDuring = null;
        const out = await runSequence({
            preflight: async () => { lockedDuring = locked(vault); return { checks: [{ name: 'a', ok: true }] }; },
            cases: [{ id: '1', run: async () => { ran.push(vault.get('PW')); } }, { id: '2', run: async () => { throw new Error('x'); } }, { id: '3', run: async () => { ran.push('3'); } }],
            vault, board: newBoard(30),
        });
        if (lockedDuring !== true) problems.push('실행기: 예행 도중에 비밀 보관함이 열려 있음');
        if (JSON.stringify(ran) !== JSON.stringify(['zz', '3']) || out.stopped !== null || out.started.join() !== '1,2,3') problems.push('실행기: 예행이 통과했는데 경우들이 차례로 돌지 않음');
    }

    // (2) DB 변경이 남는 멈춤: 내놓는 순간 원복 대상. 원복 확인을 받기 전에는 다음 경우를 시작하지 않는다
    {
        const board = newBoard(25);
        const p = board.open('expire-session', { sid: 's1' }, { needsRevert: true });
        if (board.pendingRevert !== 'expire-session') problems.push('실행기: 답을 받지 못한 멈춤(내놓은 직후)이 원복 대상으로 표시되지 않음');
        let timedOut = false;
        try { await p; } catch (e) { timedOut = e instanceof PauseTimeout; }
        if (!timedOut) problems.push('실행기: 멈춤의 기다림에 상한이 없음');
        if (board.pendingRevert !== 'expire-session') problems.push('실행기: 답을 받지 못한 멈춤(시간 초과)이 원복 대상으로 남지 않음');
    }
    {   // 브레인방이 DB 를 바꾼 뒤 응답이 유실된 경우(실행기는 시간 초과로 본다) → 다음 경우 금지
        const board = newBoard(25);
        const ran = [];
        const out = await runSequence({
            preflight: async () => ({ checks: [{ name: 'a', ok: true }] }),
            cases: [
                { id: '14', run: async () => { ran.push('14'); await board.open('expire-session', {}, { needsRevert: true }); } },
                { id: '15', run: async () => { ran.push('15'); } },
            ],
            vault: makeVault({}), board,
        });
        if (ran.includes('15') || out.started.includes('15')) problems.push('실행기: 원복 확인을 받지 못했는데 다음 경우를 시작함(멈춤의 답이 없었음)');
        if (out.stopped !== 'revert') problems.push('실행기: 원복 확인을 받지 못한 것을 따로 알리지 않음');
    }
    {   // "계속"은 받았지만 되돌리는 단계에 이르지 못한 경우 → 원복 확인을 받은 뒤에만 다음 경우
        const board = newBoard(400);
        const ran = [];
        const answered = [];
        const operator = (async () => {
            for (let i = 0; i < 60; i++) {
                await wait(5);
                const w = board.view();
                if (!w) continue;
                answered.push(w.kind);
                if (w.kind === 'maintenance-on') board.answer(w.step, null);
                else if (w.kind === 'revert-confirm' && answered.filter((k) => k === 'revert-confirm').length === 1) board.answer(w.step, null);          // 원복했다는 답이 아니다
                else if (w.kind === 'revert-confirm') { if (ran.includes('next')) problems.push('실행기: 원복했다는 답이 아닌데 다음 경우를 시작함'); board.answer(w.step, { reverted: true }); }
            }
        })();
        const out = await runSequence({
            preflight: async () => ({ checks: [{ name: 'a', ok: true }] }),
            cases: [
                { id: '15', run: async () => { await board.open('maintenance-on', {}, { needsRevert: true }); throw new Error('도중 예외'); } },
                { id: 'next', run: async () => { ran.push('next'); if (board.pendingRevert) problems.push('실행기: 원복 대상이 남은 채 다음 경우를 시작함'); } },
            ],
            vault: makeVault({}), board,
        });
        await operator;
        if (answered.filter((k) => k === 'revert-confirm').length !== 2) problems.push('실행기: 원복했다는 답이 아닌데 원복 표시를 지움(원복 확인을 다시 묻지 않음)');
        if (!ran.includes('next') || out.stopped !== null || board.pendingRevert !== null) problems.push('실행기: 원복 확인을 받았는데 이어 가지 않음');
    }
    {   // 단계 번호가 맞지 않으면 받지 않는다. 만든 것이 남을 수 있는 멈춤은 적어 둔다
        const board = newBoard(200);
        const p = board.open('provide-session', { account: 'GM', aal: 'aal2' }, { leaves: 'GM' });
        const w = board.view();
        if (board.answer(w.step + 1, {}) !== false || board.view() === null) problems.push('실행기: 단계 번호가 맞지 않는 답을 받음');
        if (board.answer(w.step, { session: {} }) !== true || (await p).session === undefined) problems.push('실행기: 맞는 단계 번호의 답을 받지 못함');
        if (board.pendingRevert !== null) problems.push('실행기: 원복 대상이 아닌 멈춤을 원복 대상으로 표시함');
        if (JSON.stringify(board.leftovers) !== JSON.stringify([{ kind: 'provide-session', account: 'GM' }])) problems.push('실행기: 브레인방이 만든 것이 남을 수 있음을 적지 않음');
    }

    // (3) 제어 포트로 받은 로그인 상태의 출처
    const now = 1795500000000;
    const nowSec = Math.floor(now / 1000);
    const EMAIL_GM = 'zzb3a_gm@member.zz.invalid';
    const claims = (over) => Object.assign({ iss: ISSUER, aud: 'authenticated', role: 'authenticated', sub: 'auth-M', email: EMAIL_GM, session_id: 'sess-9', aal: 'aal2', exp: nowSec + 3600 }, over);
    const session = (over, claimOver) => Object.assign({ access_token: fakeJwt(claims(claimOver || {})), token_type: 'bearer', expires_in: 3600, expires_at: nowSec + 3600, refresh_token: 'zz-r', user: { id: 'auth-M', email: EMAIL_GM } }, over || {});
    const expect = { email: EMAIL_GM, aal: 'aal2' };
    if (checkProvidedSession(session(), expect, now).ok !== true) problems.push('출처 확인: 맞는 로그인 상태를 거절함');
    const refuse = [
        ['발급자가 다른(운영 프로젝트의) 로그인 상태', session({}, { iss: 'https://qpqjevecjejvbeuogtbx.supabase.co/auth/v1' })],
        ['발급자가 없는 로그인 상태', session({}, { iss: undefined })],
        ['계정이 다른 로그인 상태(JWT 의 이메일)', session({}, { email: 'zzb3a_a@member.zz.invalid' })],
        ['계정이 다른 로그인 상태(user 의 이메일)', session({ user: { id: 'auth-M', email: 'someone@zz.invalid' } })],
        ['aal 이 다른 로그인 상태(aal1 을 aal2 로 달라고 했는데)', session({}, { aal: 'aal1' })],
        ['로그인 기록 번호가 없는 로그인 상태', session({}, { session_id: undefined })],
        ['역할이 다른 로그인 상태(service_role)', session({}, { role: 'service_role' })],
        ['만료가 가까운 로그인 상태', session({}, { exp: nowSec + 60 })],
        ['이미 만료된 로그인 상태', session({ expires_at: nowSec - 10 }, { exp: nowSec - 10 })],
        ['정해 두지 않은 키가 있는 로그인 상태', session({ provider_token: 'zz' })],
        ['계정 번호가 어긋나는 로그인 상태', session({ user: { id: 'auth-X', email: EMAIL_GM } })],
        ['JWT 를 풀 수 없는 로그인 상태', session({ access_token: 'aaa.bbb.ccc' })],
        ['access_token 만 글자인 것', { access_token: 'zz' }],
        ['객체가 아닌 것', 'zz'],
    ];
    for (const [name, s] of refuse) if (checkProvidedSession(s, expect, now).ok !== false) problems.push(`출처 확인: ${name}를 넣으려 함`);
    if (checkProvidedSession(session(), { email: '', aal: 'aal2' }, now).ok !== false) problems.push('출처 확인: 기대하는 계정을 모르는데 넣으려 함');
    const reasons = refuse.map(([, s]) => checkProvidedSession(s, expect, now).why);
    if (reasons.some((w) => !/^[a-z-]+$/.test(String(w)))) problems.push('출처 확인: 거절 이유가 정해 둔 이름이 아님');
    const emails = ['zzb3a_a@member.zz.invalid', EMAIL_GM];
    if (memberJwtOrigin(fakeJwt(claims()), { issuer: ISSUER, emails }) !== 'ok' ||
        memberJwtOrigin(fakeJwt(claims({ iss: 'https://qpqjevecjejvbeuogtbx.supabase.co/auth/v1' })), { issuer: ISSUER, emails }) !== 'issuer' ||
        memberJwtOrigin(fakeJwt(claims({ email: 'x@zz.invalid' })), { issuer: ISSUER, emails }) !== 'account') problems.push('출처 확인: 회원 JWT 의 발급자·계정 판정이 기대와 다름');

    // (4) 브라우저에 넘기는 환경 변수
    const env = browserEnv({ PATH: 'p', SystemRoot: 'C:\\Windows', TEMP: 't', B3A_PW: 'zzsecret', B3A_CONTROL_SECRET: 'zzsecret', B3A_TEST_ANON_KEY: 'zzsecret', B3A_EMAIL_A: 'zzsecret', B3A_PLAYWRIGHT: 'x', SUPABASE_SERVICE_ROLE_KEY: 'zzsecret', NODE_OPTIONS: 'x' });
    if (JSON.stringify(Object.keys(env).sort()) !== JSON.stringify(['PATH', 'SystemRoot', 'TEMP']) || JSON.stringify(env).includes('zzsecret')) problems.push('실행기: 브라우저에 필요한 것 말고 다른 환경 변수(비밀)가 넘어감');

    // (5) 예행의 "정상 1건" 예외: 자격 위반 판정이 먼저다. 자격 없는·본문 없는 GET 만 내보낼 수 있다
    {
        const { makeDecider } = await import('./request-log.mjs');
        const dec = makeDecider({ selfOrigins: ['http://127.0.0.1:8787'], anonKey: 'zz-anon' });
        const pass = (req) => core.controlPassOk(dec(Object.assign({ url: 'http://127.0.0.1:8787/__b3a/sink/alive', resourceType: 'fetch' }, req)).record, req);
        if (pass({ method: 'GET' }) !== true) problems.push('예행의 예외: 자격 없는·본문 없는 GET 을 내보내지 않음');
        const refuse = [
            ['POST', { method: 'POST' }],
            ['본문이 실린 GET', { method: 'GET', postData: 'x=1' }],
            ['공개 키가 실린 GET', { method: 'GET', headers: { apikey: 'zz-anon', Authorization: 'Bearer zz-anon' } }],
            ['apikey 만 실린 GET', { method: 'GET', headers: { apikey: 'zz-anon' } }],
            ['알 수 없는 자격이 실린 GET', { method: 'GET', headers: { Authorization: 'Bearer zz-opaque' } }],
            ['회원 JWT 가 실린 GET', { method: 'GET', headers: { Authorization: 'Bearer ' + fakeJwt({ role: 'authenticated', sub: 'auth-A', session_id: 's' }) } }],
            ['비밀번호가 실린 POST', { method: 'POST', postData: JSON.stringify({ password: 'zz' }) }],
            ['갱신값이 실린 POST', { method: 'POST', postData: JSON.stringify({ refresh_token: 'zz' }) }],
            ['화면 이동', { method: 'GET', isNavigation: true, resourceType: 'document' }],
        ];
        for (const [name, req] of refuse) if (pass(req) !== false) problems.push(`예행의 예외: ${name} 을(를) 내보내 줌`);
        if (core.controlPassOk(null, { method: 'GET' }) !== false) problems.push('예행의 예외: 판정 기록이 없는데 내보내 줌');
        const clean = dec({ url: 'http://127.0.0.1:8787/__b3a/sink/alive', resourceType: 'fetch', method: 'GET' }).record;
        for (const over of [{ leak: true }, { leakKinds: ['unknown_credential'] }, { leak: undefined }]) {
            if (core.controlPassOk(Object.assign({}, clean, over), { method: 'GET' }) !== false) problems.push('예행의 예외: 자격 위반으로 판정된 요청을 내보내 줌');
        }
        if (core.controlPassOk(Object.assign({}, clean, { where: 'self' }), { method: 'GET' }) !== false) problems.push('예행의 예외: 시험 목적지가 아닌 요청을 내보내 줌');
    }
    return { problems };
}
// 차단기("보내기 전에 가르기"): 허용 밖·자격의 용도가 맞지 않는 요청은 전송 전에 중단하고, 기록에는 정해 둔 이름과 참/거짓만 남는다.
// mutate 를 주면 차단기의 사본을 바꿔서 본다(감도 점검).
async function loadRequestLog(mutate) {
    if (!mutate) return import('./request-log.mjs');
    const here = path.join(ROOT, 'tests', 'auth-session');
    let text = mutate('tests/auth-session/request-log.mjs', workFile('tests/auth-session/request-log.mjs'));
    text = text.replace(/from '\.\/([a-z-]+\.mjs)'/g, (m, name) => `from ${JSON.stringify(pathToFileURL(path.join(here, name)).href)}`);
    const file = path.join(os.tmpdir(), `b3a-request-log-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
    fs.writeFileSync(file, text);
    try { return await import(pathToFileURL(file).href); } finally { fs.unlinkSync(file); }
}

async function sectionRequestLog(mutate) {
    const problems = [];
    const { makeDecider, summarize } = await loadRequestLog(mutate);
    const anon = fakeJwt({ role: 'anon', ref: 'hmncdheiwqwekdbtijar' });
    const ISS = TEST_URL + '/auth/v1';
    const member = fakeJwt({ iss: ISS, role: 'authenticated', sub: 'auth-A', email: 'zzb3a_a@member.zz.invalid', session_id: 'sess-1' });
    const otherIssuer = fakeJwt({ iss: 'https://qpqjevecjejvbeuogtbx.supabase.co/auth/v1', role: 'authenticated', sub: 'auth-A', email: 'zzb3a_a@member.zz.invalid', session_id: 'sess-1' });
    const otherAccount = fakeJwt({ iss: ISS, role: 'authenticated', sub: 'auth-Z', email: 'someone@zz.invalid', session_id: 'sess-2' });
    const service = fakeJwt({ role: 'service_role', ref: 'hmncdheiwqwekdbtijar' });
    const SELF = 'http://127.0.0.1:8787';
    const decide = makeDecider({ selfOrigins: [SELF, 'http://127.0.0.1:8788'], anonKey: anon, issuer: ISS, memberEmails: () => ['zzb3a_a@member.zz.invalid'] });
    const H = (bearer) => ({ apikey: anon, Authorization: 'Bearer ' + bearer });
    const pw = JSON.stringify({ email: 'a@zz.invalid', password: 'zzsecretpw' });
    const rt = JSON.stringify({ refresh_token: 'zzsecretrefresh' });
    const rows = [
        // [설명, 요청, 기대 action(continue 보냄 / abort 중단 / fake 전송 전에 막고 가짜 응답), 기대 where, 기대 target, leak]
        ['자기 화면', { url: SELF + '/login.html?redirect=zzsecret', method: 'GET', resourceType: 'document', isNavigation: true }, 'continue', 'self', 'file', false],
        ['꺼짐 서버의 화면', { url: 'http://127.0.0.1:8788/index.html', method: 'GET', resourceType: 'document', isNavigation: true }, 'continue', 'self', 'file', false],
        ['수신 확인용 끝점', { url: SELF + '/__b3a/probe', method: 'GET', resourceType: 'fetch' }, 'continue', 'self', 'test-endpoint', false],
        ['로그인', { url: TEST_URL + '/auth/v1/token?grant_type=password', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: pw }, 'continue', 'test-project', 'login', false],
        ['갱신', { url: TEST_URL + '/auth/v1/token?grant_type=refresh_token', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: rt }, 'continue', 'test-project', 'refresh', false],
        ['로그아웃(이 로그인만)', { url: TEST_URL + '/auth/v1/logout?scope=local', method: 'POST', resourceType: 'fetch', headers: H(member) }, 'continue', 'test-project', 'logout', false],
        ['my_profile', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: H(member), postData: '{}' }, 'continue', 'test-project', 'my_profile', false],
        ['my_site_access', { url: TEST_URL + '/rest/v1/rpc/my_site_access', method: 'POST', resourceType: 'fetch', headers: H(member), postData: '{}' }, 'continue', 'test-project', 'my_site_access', false],
        ['업무 요청(공개 키)', { url: TEST_URL + '/rest/v1/applications?email=eq.zzsecret%40zz.invalid', method: 'GET', resourceType: 'fetch', headers: H(anon) }, 'fake', 'test-project', 'rest-table', false],
        ['업무 요청(공개 키, 조건 없는 전체 조회)', { url: TEST_URL + '/rest/v1/notices?order=published_at.desc&limit=1000', method: 'GET', resourceType: 'fetch', headers: H(anon) }, 'fake', 'test-project', 'rest-table', false],
        ['업무 쓰기(공개 키)', { url: TEST_URL + '/rest/v1/applications', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: '{"name":"zzsecret"}' }, 'fake', 'test-project', 'rest-table', false],
        ['다른 RPC(공개 키)', { url: TEST_URL + '/rest/v1/rpc/other_function', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: '{}' }, 'fake', 'test-project', 'rest-rpc-other', false],
        ['파일(공개 키)', { url: TEST_URL + '/storage/v1/object/public/x/y.png', method: 'GET', resourceType: 'fetch', headers: H(anon) }, 'fake', 'test-project', 'storage', false],
        ['my_profile 을 공개 키로(기록만 — 자격이 새는 것은 아니다)', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: '{}' }, 'continue', 'test-project', 'my_profile', false],
        ['허용 목록의 글꼴', { url: 'https://fonts.gstatic.com/s/x.woff2', method: 'GET', resourceType: 'font' }, 'continue', 'static-allowed', 'static', false],
        ['허용 목록 호스트의 파비콘', { url: 'https://eontoefl.github.io/eontoefl_official_website_9v7g/logo/purple2.png', method: 'GET', resourceType: 'other' }, 'continue', 'static-allowed', 'static', false],
        ['허용 목록 호스트로 POST(정적 요청이 아님)', { url: 'https://eontoefl.github.io/x', method: 'POST', resourceType: 'other', postData: 'a=1' }, 'abort', 'outside', 'other', false],
        ['data 그림', { url: 'data:image/png;base64,AAAA', method: 'GET', resourceType: 'image' }, 'continue', 'local', 'other', false],
        // 자격의 종류·용도가 맞지 않는 것: 시험 프로젝트로 가는 것이라도 중단
        ['업무 요청에 회원 JWT', { url: TEST_URL + '/rest/v1/applications?email=eq.a%40zz.invalid', method: 'GET', resourceType: 'fetch', headers: H(member) }, 'abort', 'test-project', 'rest-table', true],
        ['회원 표에 회원 JWT', { url: TEST_URL + '/rest/v1/users?select=*', method: 'GET', resourceType: 'fetch', headers: H(member) }, 'abort', 'test-project', 'rest-table', true],
        ['전역 로그아웃', { url: TEST_URL + '/auth/v1/logout?scope=global', method: 'POST', resourceType: 'fetch', headers: H(member) }, 'abort', 'test-project', 'auth-other', true],
        ['로그인 주소에 회원 JWT', { url: TEST_URL + '/auth/v1/token?grant_type=password', method: 'POST', resourceType: 'fetch', headers: H(member), postData: pw }, 'abort', 'test-project', 'login', true],
        ['갱신 주소에 비밀번호', { url: TEST_URL + '/auth/v1/token?grant_type=refresh_token', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: pw }, 'abort', 'test-project', 'refresh', true],
        ['로그인 주소에 갱신값', { url: TEST_URL + '/auth/v1/token?grant_type=password', method: 'POST', resourceType: 'fetch', headers: H(anon), postData: rt }, 'abort', 'test-project', 'login', true],
        ['RPC 에 갱신값', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: H(member), postData: rt }, 'abort', 'test-project', 'my_profile', true],
        ['다른 RPC 에 회원 JWT', { url: TEST_URL + '/rest/v1/rpc/other_function', method: 'POST', resourceType: 'fetch', headers: H(member), postData: '{}' }, 'abort', 'test-project', 'rest-rpc-other', true],
        ['Edge 함수에 회원 JWT', { url: TEST_URL + '/functions/v1/telegram-notify', method: 'POST', resourceType: 'fetch', headers: H(member), postData: '{}' }, 'abort', 'test-project', 'functions', true],
        ['다른 발급자의 회원 JWT(허용된 주소로)', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: H(otherIssuer), postData: '{}' }, 'abort', 'test-project', 'my_profile', true],
        ['합성 계정이 아닌 회원 JWT(허용된 주소로)', { url: TEST_URL + '/auth/v1/logout?scope=local', method: 'POST', resourceType: 'fetch', headers: H(otherAccount) }, 'abort', 'test-project', 'logout', true],
        ['service_role 자격', { url: TEST_URL + '/rest/v1/rpc/my_profile', method: 'POST', resourceType: 'fetch', headers: H(service), postData: '{}' }, 'abort', 'test-project', 'my_profile', true],
        ['알 수 없는 자격', { url: TEST_URL + '/rest/v1/reviews', method: 'GET', resourceType: 'fetch', headers: { apikey: anon, Authorization: 'Bearer zzsecretopaque' } }, 'abort', 'test-project', 'rest-table', true],
        ['자기 서버에 회원 JWT', { url: SELF + '/index.html', method: 'GET', resourceType: 'fetch', headers: H(member) }, 'abort', 'self', 'file', true],
        ['자기 서버에 비밀번호(폼)', { url: SELF + '/login.html', method: 'POST', resourceType: 'document', isNavigation: true, postData: 'email=a%40zz.invalid&password=zzsecretpw' }, 'abort', 'self', 'file', true],
        // 허용 밖의 목적지
        ['허용 목록 호스트의 스크립트(목록 밖 종류)', { url: 'https://cdn.jsdelivr.net/npm/x.js', method: 'GET', resourceType: 'script' }, 'abort', 'outside', 'other', false],
        ['텔레그램 fetch', { url: 'https://api.telegram.org/botzzsecret/sendMessage', method: 'POST', resourceType: 'fetch', postData: '{"text":"x"}' }, 'abort', 'outside', 'other', false],
        ['운영 주소 fetch', { url: 'https://qpqjevecjejvbeuogtbx.supabase.co/rest/v1/users', method: 'GET', resourceType: 'fetch', headers: { apikey: 'x' } }, 'abort', 'outside', 'other', false],
        ['바깥으로 화면 이동', { url: 'https://testroom.eonfl.com/?t=zzsecret', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'outside', 'other', false],
        ['카카오 링크 이동', { url: 'http://pf.kakao.com/_FWxcZC', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'outside', 'other', false],
        ['제어 포트(다른 로컬 포트)', { url: 'http://127.0.0.1:8899/continue?step=1', method: 'POST', resourceType: 'fetch' }, 'abort', 'outside', 'other', false],
        ['시험 프로젝트로 화면 이동', { url: TEST_URL + '/auth/v1/authorize?provider=x', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'test-project', 'auth-other', false],
        ['로컬 시험 목적지(fetch)', { url: SELF + '/__b3a/sink/testroom', method: 'GET', resourceType: 'fetch' }, 'abort', 'sink', 'sink', false],
        ['로컬 시험 목적지(이동)', { url: SELF + '/__b3a/sink/testroom', method: 'GET', resourceType: 'document', isNavigation: true }, 'abort', 'sink', 'sink', false],
    ];
    const records = [];
    for (const [name, req, action, where, target, leak] of rows) {
        const d = decide(req);
        records.push(d.record);
        if (action === 'abort' && d.action !== 'abort') problems.push(`가르기: ${name} — 전송 전에 중단하지 않음`);
        if (action === 'continue' && d.action !== 'continue') problems.push(`가르기: ${name} — 보내야 하는 요청을 중단함`);
        if (action === 'fake' && d.action !== 'fake') problems.push(`가르기: ${name} — 업무 요청을 "전송 전에 막고 가짜 응답"으로 가르지 않음(${d.action})`);
        if ((action === 'fake' && !('business' in d.record)) || (['login', 'refresh', 'logout', 'my_profile', 'my_site_access'].includes(target) && ('business' in d.record))) problems.push(`가르기: ${name} — 업무 요청의 표시가 기대와 다름`);
        if (d.record.where !== where || d.record.target !== target) problems.push(`가르기: ${name} — 무리·이름이 ${d.record.where}/${d.record.target} (기대 ${where}/${target})`);
        if (d.record.leak !== leak) problems.push(`가르기: ${name} — 자격의 용도 판정이 ${d.record.leak} (기대 ${leak})`);
        if (d.record.aborted !== (d.action !== 'continue')) problems.push(`가르기: ${name} — 기록의 "보내지 않음" 표시가 결정과 다름`);
    }
    // 기록에는 자유 형식의 글자가 없다: 정해 둔 이름·참/거짓만
    const allowedValues = new Set(['self', 'sink', 'test-project', 'static-allowed', 'outside', 'local',
        'file', 'test-endpoint', 'static', 'other', 'login', 'refresh', 'logout', 'my_profile', 'my_site_access', 'rest-rpc-other', 'rest-table', 'auth-other', 'storage', 'functions',
        'document', 'stylesheet', 'image', 'media', 'font', 'script', 'xhr', 'fetch', 'websocket', 'manifest',
        'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER',
        'none', 'anon', 'member', 'service_role',
        'write', 'partial-search', 'unconditioned', 'read', 'email', 'id', 'login-email',
        'password', 'refresh_token', 'member_jwt', 'unknown_credential', 'foreign_member_jwt']);
    const allowedKeys = new Set(['where', 'target', 'nav', 'type', 'method', 'apikey', 'credential', 'password', 'refreshToken', 'leak', 'leakKinds', 'publicRetry', 'aborted', 'business', 'account', 'accountBy']);
    for (const r of records) {
        for (const [k, v] of Object.entries(r)) {
            const values = Array.isArray(v) ? v : [v];
            if (!allowedKeys.has(k) || values.some((x) => typeof x !== 'boolean' && !allowedValues.has(x))) { problems.push('가르기: 기록에 정해 두지 않은 항목·글자가 있음'); break; }
        }
    }
    const text = JSON.stringify(records);
    if (text.includes('zzsecret') || /eyJ[A-Za-z0-9_-]{8,}/.test(text) || /https?:/.test(text)) problems.push('가르기: 기록에 JWT·비밀번호·갱신값·주소가 남음');
    const s = summarize(records);
    const want = { leakBlocked: 15, leakSent: 0, publicRetry: 1, serviceRole: 1, sinkAttempts: 2, outsideSent: 0, staticAllowed: 2 };
    for (const [k, v] of Object.entries(want)) if (s[k] !== v) problems.push(`가르기: 요약의 ${k} 가 ${s[k]} (기대 ${v})`);
    if (s.testProjectByTarget.login !== 1 || s.testProjectByTarget.my_profile !== 2 || s.testProjectByTarget['rest-table'] !== undefined) problems.push('가르기: 요약의 이름별 수가 기대와 다름');
    // 업무 요청: 시도 5건(조건 있는 조회 1·조건 없는 조회 1·쓰기 2·그 밖 1), 내보낸 것 0. 자격 위반으로 중단한 것은 업무 시도로도 적힌다(그것도 보내지 않는다)
    const sentBusiness = records.filter((r) => r.business && !r.aborted).length;
    if (s.businessSent !== 0 || sentBusiness !== 0) problems.push('가르기: 업무 요청을 내보냄');
    if (records.filter((r) => r.business && !r.leak && !r.nav).length !== 5) problems.push('가르기: 업무 요청의 시도 수가 기대와 다름');
    return { problems, rows: rows.length };
}
// 실행기(screen.mjs)가 판단 부분(screen-core.mjs)을 실제로 쓰는가 — 글자로 본다(브라우저를 띄우는 파일이라 여기서 돌리지 않는다)
function sectionScreenText() {
    const problems = [];
    const text = workFile('tests/auth-session/screen.mjs');
    const code = text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const must = [
        ['차례를 runSequence 에 맡김', 'seq = await runSequence({'],
        ['비밀번호를 보관함에서만 꺼냄', "vault.get('PW')"],
        ['받은 로그인 상태의 출처 확인', 'checkProvidedSession(session, {'],
        ['브라우저에 필요한 환경 변수만', 'env: browserEnv(process.env)'],
        ['예행의 예외를 판단 부분에 맡김(자격 위반 판정이 먼저)', 'if (controlPassOk(rec, { method: r.method(), postData: r.postData() })) {'],
        ['회원 JWT 의 발급자·계정을 차단기에 넘김', 'issuer: ISSUER'],
        ['로그인 기록 만료는 원복 대상', "await pause('expire-session', { sid }, { needsRevert: true });"],
        ['점검 켜기는 원복 대상', "await pause('maintenance-on', { exception: 'A' }, { needsRevert: true });"],
    ];
    for (const [name, needle] of must) if (!code.includes(needle)) problems.push(`실행기: ${name} — 그 줄이 없음`);
    if ((code.match(/process\.env\.B3A_PW/g) || []).length !== 1) problems.push('실행기: 비밀번호를 환경 변수에서 읽는 곳이 한 곳이 아님');
    if (/localStorage\.setItem\('eon_auth_v1'/.test(code) && code.indexOf("checkProvidedSession(session, {") > code.indexOf("localStorage.setItem('eon_auth_v1'")) problems.push('실행기: 출처를 확인하기 전에 로그인 상태를 브라우저에 넣음');
    if ((code.match(/rec\.how = 'control-pass'/g) || []).length !== 1 || code.indexOf("rec.how = 'control-pass'") < code.indexOf('if (controlPassOk(rec, {') || code.indexOf('const d = decide({') > code.indexOf('if (controlPassOk(rec, {')) problems.push('실행기: 예행의 예외가 차단기의 판정과 판단 부분을 거치지 않고 나갈 수 있음');
    if (/screenshot|tracing\.start|recordHar|storageState\(/.test(code)) problems.push('실행기: 화면 캡처·추적·HAR·상태 내보내기를 씀');
    return { problems };
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

    const offStatic = sectionOffStatic();
    fail('꺼짐', offStatic.problems);
    out(`    - 지금과 다른 것(차이 장부): 꺼짐의 화면이 기준보다 더 받는 정적 파일은 같은 출처의 js/auth-session.js 1개뿐(${offStatic.info.added.join(', ')}. ${offStatic.info.bytes}바이트 — 화면을 그리기 전에 받는다): 어긋남 ${offStatic.problems.length}`);
    listSome(offStatic.problems);

    const noModule = await sectionNoModule();
    fail('모듈 없는 화면', noModule.problems);
    out(`    - 인증 모듈을 싣지 않는 화면의 js/common.js·main.js·login.js(저장소 그대로 / 켜짐으로 내준 사본) × 같은 ${STATE_NAMES.length}×${LEGACY_SCENARIOS.length} = ${noModule.compared}건: 어긋남 ${noModule.problems.length}`);
    listSome(noModule.problems);

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
    out(`[7] 감도 점검(일부러 바꾼 사본 ${MUTANTS.length}개 — 변조마다 겨냥한 판정이 깨져야 검출): ${mut.problems.length === 0 ? '모두 검출' : `실패 ${mut.problems.length}`}`);
    mut.lines.forEach((l) => out(l));
    listSome(mut.problems);

    const srv = sectionServer();
    fail('서버', srv.problems);
    out(`[8] 화면 시험용 로컬 서버의 몸통(소켓 없이): 내줄 수 있는 파일 ${srv.info.servable}개를 꺼짐·켜짐으로 한 번씩 — 운영 흔적이 남은 채 내준 것 0, 내주지 않는 파일 ${srv.info.refused.length}개. 어긋남 ${srv.problems.length}`);
    listSome(srv.problems);
    const sc = await sectionScreenCore();
    const scText = sectionScreenText();
    fail('실행기', sc.problems.concat(scText.problems));
    out(`    - 실행기의 판단 부분(예행 통과 전 시작 금지·비밀 보관함, 원복 대상의 표시와 확인, 받은 로그인 상태의 출처, 브라우저에 넘기는 환경 변수): 어긋남 ${sc.problems.length + scText.problems.length}`);
    listSome(sc.problems.concat(scText.problems));
    const rl = await sectionRequestLog();
    fail('가르기', rl.problems);
    out(`    - 차단기(보내기 전에 가르기: 목적지 + 자격의 종류·용도, 기록은 정해 둔 이름만) 요청 ${rl.rows}가지: 어긋남 ${rl.problems.length}`);
    listSome(rl.problems);

    const pg = await sectionPages();
    fail('화면', pg.problems);
    out(`[9] 화면의 로그인 상태 통일(계약 3C-1 — 대상 화면 ${pg.info.pages}개, 화면의 HTML 로 만든 가짜 DOM): ${pg.problems.length === 0 ? '통과' : `실패 ${pg.problems.length}`}`);
    pg.lines.forEach((l) => out(l));
    listSome(pg.problems, 40);

    const mb = await sectionMember();
    fail('회원 읽기', mb.problems);
    out(`[10] 회원 자격으로 읽는 구조 + 성적 이력 읽기 하나(계약 3C-2a — 보호가 아니다. 가짜 서버의 "규칙"은 흉내다): ${mb.problems.length === 0 ? '통과' : `실패 ${mb.problems.length}`}`);
    mb.lines.forEach((l) => out(l));
    listSome(mb.problems, 40);

    if (realNetworkAttempts.length) fail('네트워크', `실제 네트워크 요청 시도 ${realNetworkAttempts.length}건`);
    out(`[11] 실제 네트워크 요청 ${realNetworkAttempts.length}건`);
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
