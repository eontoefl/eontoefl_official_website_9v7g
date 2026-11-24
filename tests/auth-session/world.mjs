// 회귀시험의 공통 준비: 파일 고르기(기준·작업본·내줄 사본), 가짜 세계 만들기, 저장소 상태 다섯, 기록 비교.
// 전부 가짜다 — 실제 네트워크 요청은 없다(run.mjs 가 연결 경로를 막아 둔다).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { FakeBrowser } from './browser.mjs';
import { FakeSupabase, fakeJwt } from './fake-supabase.mjs';
import { TEST_URL, CONFIG_FILE, AUTH_FILE, readProdConfig, rewriteConfig, rewriteSwitch, rewritePageSwitch, rewriteMemberTask } from './rewrite.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = '14455ae';       // 업무 동작의 기준(계약 3C-1: 3A 의 기준 d39c0ee 뒤에 main 이 움직였다)
export const FAKE_ANON = 'zz-fake-anon-key-b3a';                  // 가짜 공개 키(실제 키가 아니다)
export const SINK = 'http://127.0.0.1:8787/__b3a/sink/testroom';   // 로컬 시험 목적지(가짜 세계에서는 글자일 뿐)
export const SDK_FILE = 'vendor/supabase-2.116.0.js';

const lf = (t) => t.replace(/\r\n/g, '\n');
const cache = new Map();

// 기준의 파일. rev 를 주면 그 커밋의 것(계약 3C-1 의 둘째 기준 — 3A 를 합친 직후의 커밋 — 과 견줄 때 쓴다)
export function baseFile(p, rev = BASE) {
    const key = 'base:' + rev + ':' + p;
    if (!cache.has(key)) {
        let text = null;
        try { text = lf(execFileSync('git', ['show', `${rev}:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { text = null; }
        cache.set(key, text);
    }
    return cache.get(key);
}

export function workFile(p) {
    const key = 'work:' + p;
    if (!cache.has(key)) {
        let text = null;
        try { text = lf(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { text = null; }
        cache.set(key, text);
    }
    return cache.get(key);
}

export const PROD = readProdConfig(workFile(CONFIG_FILE));   // 운영 주소·키(값은 찍지 않는다)

// 파일 묶음의 종류
//   BASE   기준(d39c0ee) 그대로            OFF   작업본 그대로(스위치 꺼짐, 운영 설정 글자)
//   BASE_T 기준 + 시험 설정으로 바꿔 내줌    OFF_T 작업본 + 시험 설정(시험 서버의 "꺼짐")
//   ON     작업본 + 시험 설정 + 스위치 켜짐(시험 서버의 "켜짐")
export const V = {
    BASE: { base: true },
    OFF: {},
    BASE_T: { base: true, test: true },
    OFF_T: { test: true },
    ON: { test: true, on: true },
    // (계약 3C-2a) 새 로그인 켜짐 + 업무 규약의 my-scores 열림
    ON_OPEN: { test: true, on: true, open: true },
};

export function provider(variant, mutate) {
    return (p) => {
        let text = variant.base ? baseFile(p, variant.rev || BASE) : workFile(p);
        if (text === null) return null;
        // 둘째 기준(3A 를 합친 커밋)의 인증 모듈은 스위치가 있다 — 그 사본도 같은 방법으로 켠다
        if (variant.base && variant.rev && p === AUTH_FILE) text = rewriteSwitch(text, variant.on ? 'on' : 'off');
        // 둘째 기준이 게이트가 든 화면(3C-1 의 커밋)이면 화면의 스위치도 같은 방법으로 맞춘다(게이트가 없는 커밋의 화면은 그대로다)
        if (variant.base && variant.rev && p.endsWith('.html')) text = rewritePageSwitch(text, variant.on ? 'on' : 'off');
        if (variant.test && p === CONFIG_FILE) text = rewriteConfig(text, { testUrl: TEST_URL, testKey: FAKE_ANON, sinkUrl: SINK });
        if (!variant.base && p === AUTH_FILE) text = rewriteMemberTask(rewriteSwitch(text, variant.on ? 'on' : 'off'), variant.open === true);
        // pageSwitch: 화면(게이트)의 스위치만 따로 정한다 — 화면과 모듈이 어긋난 경우를 보는 시험이 쓴다
        if (!variant.base && p.endsWith('.html')) text = rewritePageSwitch(text, variant.pageSwitch || (variant.on ? 'on' : 'off'));
        if (mutate) text = mutate(p, text);
        return text;
    };
}

export function extractScripts(html) {
    const out = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    let m;
    const headEnd = html.indexOf('</head>');
    while ((m = re.exec(html))) {
        const src = /\bsrc="([^"]+)"/.exec(m[1]);
        const head = headEnd >= 0 && m.index < headEnd;       // head 안의 script 인가(화면이 그려지기 전에 돈다)
        out.push(src ? { src: src[1], head } : { inline: m[2], head });
    }
    return out;
}

const DOM = {
    'index.html': {
        ids: ['authMenu', 'hamburger', 'navMenu', 'reviewsContainer'],
        materials: [1, 2],
        appLinks: [
            { where: 'footer', href: 'application.html', text: '수강 신청' },
            { where: 'nav', href: 'application.html', text: '신청하기' },
        ],
    },
    'login.html': {
        ids: ['authMenu', 'hamburger', 'navMenu', 'loginForm', 'loginBtn', 'email', 'password', 'registerLink'],
        formContainer: true,
        loading: true,
        materials: [1],
        appLinks: [{ where: 'footer', href: 'application.html', text: '수강 신청' }],
    },
};

// 옛 방식 화면이 읽는 가짜 회원 표(전부 지어낸 값)
const LEGACY_USERS = [
    { id: 'm-old-1', name: '옛학생', nickname: '', email: 'old@zz.invalid', password: 'zz-old-pw', phone: '010-0000-0000', level: 2, role: 'user', blocked: false, withdrawal_requested_at: null },
    { id: 'm-old-2', name: '옛차단', nickname: '', email: 'oldblk@zz.invalid', password: 'zz-old-blk', phone: null, role: 'user', blocked: true, withdrawal_requested_at: null },
    { id: 'm-old-3', name: '옛임시', nickname: '임시', email: 'oldtmp@zz.invalid', password: '000000', phone: '010-0000-0003', role: 'user', blocked: false, withdrawal_requested_at: null },
    { id: 'm-old-4', name: '옛탈퇴', nickname: '', email: 'oldwd@zz.invalid', password: 'zz-old-wd', phone: '010-0000-0004', role: 'user', blocked: false, withdrawal_requested_at: '2026-11-20T00:00:00Z' },
];

const ok = (rows) => ({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) });

function legacyRest(req, u) {
    const table = u.pathname.replace('/rest/v1/', '');
    if (req.method === 'GET' && table === 'users') return ok(LEGACY_USERS);
    if (req.method === 'GET' && table === 'applications') {
        const email = (u.searchParams.get('email') || '').replace(/^eq\./, '');
        return ok([{ id: 'app-1', email, application_type: 'challenge', deleted: false }]);
    }
    if (req.method === 'GET' && table === 'reviews') {
        return ok([{ student_name: '합성 수강생', program: '합성 과정', rating: 5, review_text: '합성 후기', score_before: 70, score_after: 100 }]);
    }
    return ok([]);
}

// 합성 계정(가짜 서버)
export const ACCOUNTS = {
    A: { email: 'zzb3a_a@member.zz.invalid', password: 'zz-pw-A', authId: 'auth-A', member: 'ok', profile: { id: 'm-A', name: '합성 회원 A', nickname: '에이', email: 'zzb3c1_a@members-table.zz.invalid', phone: '010-0000-0001', timezone: 'Asia/Seoul' } },
    B: { email: 'zzb3a_b@member.zz.invalid', password: 'zz-pw-B', authId: 'auth-B', member: 'ok', profile: { id: 'm-B', name: '합성 회원 B', nickname: null, email: 'zzb3c1_b@members-table.zz.invalid', phone: null, timezone: 'Asia/Seoul' } },
    BLK: { email: 'zzb3a_blk@member.zz.invalid', password: 'zz-pw-K', authId: 'auth-K', member: 'blocked' },
    WD: { email: 'zzb3a_wd@member.zz.invalid', password: 'zz-pw-W', authId: 'auth-W', member: 'withdrawal' },
    N: { email: 'zzb3a_n@member.zz.invalid', password: 'zz-pw-N', authId: 'auth-N', member: 'none' },
    G: { email: 'zzb3a_g@member.zz.invalid', password: 'zz-pw-G', authId: 'auth-G', member: 'none', admin: true },
    GM: { email: 'zzb3a_gm@member.zz.invalid', password: 'zz-pw-M', authId: 'auth-M', member: 'ok', admin: true, profile: { id: 'm-GM', name: '합성 관리자 GM', nickname: '지엠', email: 'zzb3c1_gm@members-table.zz.invalid', phone: '010-0000-0009', timezone: 'Asia/Seoul' } },
};

export const OLD_STUDENT = JSON.stringify({ id: 'm-old-1', name: '옛학생', nickname: '', email: 'old@zz.invalid', phone: '010-0000-0000', level: 2, role: 'user' });
export const BOOK_KEY = 'eon_book_auth_v1';
export const FOLLOWUP_KEYS = ['sb-qpqjevecjejvbeuogtbx-auth-token', 'sb-hmncdheiwqwekdbtijar-auth-token'];

function otherLogin(nowMs, expired, who) {
    const exp = Math.floor(nowMs / 1000) + (expired ? -7200 : 3600);
    return JSON.stringify({
        access_token: fakeJwt({ sub: 'other-' + who, session_id: 'other-sess-' + who, role: 'authenticated', exp }),
        refresh_token: 'other-refresh-' + who,
        expires_at: exp,
        token_type: 'bearer',
        user: { id: 'other-' + who, email: who + '@other.zz.invalid' },
    });
}

// 저장소 상태 다섯
export const STATES = {
    '빈 브라우저': () => ({}),
    '옛 학생': (now) => ({ iontoefl_user: OLD_STUDENT, iontoefl_login_time: String(now - 3600000) }),
    '교재 편집만': (now) => ({ [BOOK_KEY]: otherLogin(now, false, 'book') }),
    '후속메일만': (now) => ({ [FOLLOWUP_KEYS[0]]: otherLogin(now, false, 'followup'), [FOLLOWUP_KEYS[1]]: otherLogin(now, false, 'followup-t') }),
    '섞임+만료': (now) => ({
        iontoefl_user: OLD_STUDENT,
        iontoefl_login_time: String(now - 400 * 24 * 3600000),
        [BOOK_KEY]: otherLogin(now, true, 'book'),
        [FOLLOWUP_KEYS[0]]: otherLogin(now, true, 'followup'),
        [FOLLOWUP_KEYS[1]]: otherLogin(now, true, 'followup-t'),
    }),
};
export const STATE_NAMES = Object.keys(STATES);
export const hasOldValue = (stateName) => stateName === '옛 학생' || stateName === '섞임+만료';

export function makeWorld(stateName, { variant, mutate } = {}) {
    const w = { outside: [], capture: null, stateName };
    const prodOrigin = new URL(PROD.url).origin;
    w.browser = new FakeBrowser({
        net: async (req, page) => {
            if (w.capture) return w.capture(req, page);
            let u;
            try { u = new URL(req.url); } catch (e) { w.outside.push('[주소 아님]'); throw new TypeError('Failed to fetch'); }
            if (u.origin === TEST_URL) return w.server.handle(req);
            if (u.origin === prodOrigin) {
                if (variant.test) { w.outside.push('[운영 주소]'); throw new TypeError('Failed to fetch'); }
                return (w.rest || legacyRest)(req, u);
            }
            w.outside.push(u.origin);
            throw new TypeError('Failed to fetch');
        },
    });
    w.server = new FakeSupabase({ origin: TEST_URL, anonKey: FAKE_ANON, now: () => w.browser.now });
    w.server.business = (req, u) => (w.rest || legacyRest)(req, u);     // w.rest: 시험이 업무 응답을 바꿔 끼우는 자리(계약 3C-1 의 화면 시험)
    for (const a of Object.values(ACCOUNTS)) w.server.addAccount(JSON.parse(JSON.stringify(a)));
    for (const [k, v] of Object.entries(STATES[stateName](w.browser.now))) w.browser.local.set(k, v);
    w.initial = new Map(w.browser.local);
    w.files = provider(variant, mutate);

    // 화면 하나 열기: HTML 의 script 태그를 순서대로 올리고 DOMContentLoaded 까지
    w.open = async (name, pageFile, opts = {}) => {
        const page = w.browser.open(name, { files: w.files, pageFile, search: opts.search, hash: opts.hash, dom: DOM[pageFile], confirmAnswer: opts.confirmAnswer });
        for (const s of extractScripts(w.files(pageFile))) {
            if (s.src) {
                const source = w.files(s.src.split('?')[0]);
                if (source === null) throw new Error('없는 스크립트: ' + s.src);
                page.rec({ t: 'run-script', src: s.src.split('?')[0], head: s.head });
                page.run(source, s.src);
            } else if (s.inline.trim()) {
                page.run(s.inline, pageFile + ':inline');
            }
        }
        if (opts.beforeLoad) await opts.beforeLoad(page);
        if (opts.noIdle) {
            page.document.readyState = 'interactive';
            for (const l of page.docListeners.filter((x) => x.type === 'DOMContentLoaded')) l.fn({});
        } else {
            await page.domContentLoaded();
        }
        return page;
    };

    // 로그인 화면에서 제출
    w.submit = async (page, email, password) => {
        page.byId.email.value = email;
        page.byId.password.value = password;
        const done = page.byId.loginForm.fire('submit');
        await w.browser.idle();
        await done;
        await w.browser.advance(1500);
    };

    // 새 방식의 로그인 상태를 저장소에 직접 넣는다(화면으로 만들 수 없는 aal2 등)
    w.seed = (accountKey, opts) => {
        const s = w.server.createSession(ACCOUNTS[accountKey].email, opts);
        w.browser.local.set('eon_auth_v1', JSON.stringify(w.server.tokenBody(s)));
        return s;
    };

    w.routes = () => w.server.log.map((e) => e.route + e.search);
    w.count = (route) => w.routes().filter((r) => r === route).length;
    return w;
}

export function snapshot(w, page) {
    return {
        trace: w.browser.events.filter((e) => e.t !== 'run-script').map(({ n, ...e }) => e),
        requests: w.browser.requests.map((r) => ({ page: r.page, url: r.url, method: r.method, headers: r.headers, body: r.bodyText, redirect: r.redirect, credentials: r.credentials })),
        storageLog: w.browser.storageLog.map(({ n, ...e }) => e),
        storage: [...w.browser.local.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        scripts: w.browser.pages.flatMap((p) => p.scriptLoads),
        channels: w.browser.channelLog.length,
        sdk: page.evaluate('typeof supabase'),
    };
}

// 두 기록의 다른 곳(값은 찍지 않고 위치와 종류만)
export function diffSnapshot(a, b) {
    const diffs = [];
    for (const key of ['trace', 'requests', 'storageLog', 'storage']) {
        const x = a[key];
        const y = b[key];
        if (x.length !== y.length) diffs.push(`${key}: 개수 ${x.length} ↔ ${y.length}`);
        for (let i = 0; i < Math.min(x.length, y.length); i++) {
            if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) {
                diffs.push(`${key}[${i}] 다름 (${x[i].t || x[i].op || x[i].method || '값'} ↔ ${y[i].t || y[i].op || y[i].method || '값'})`);
                break;
            }
        }
    }
    return diffs;
}

export function checker() {
    const problems = [];
    return { problems, ok: (cond, msg) => { if (!cond) problems.push(msg); } };
}
