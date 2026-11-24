// 계약 3C-1 의 회귀시험: 대상 화면 26개의 로그인 상태 통일(요청의 자격은 바꾸지 않는다).
// run.mjs 가 이어서 돌린다(따로 돌릴 때: node tests/auth-session/run-pages.mjs).
//
// 전부 가짜다: 화면의 HTML 로 만든 가짜 DOM(pages-dom.mjs)·가짜 저장소·가짜 시계·가짜 서버. 실제 네트워크 요청은 0건이고,
// 여기서 통과한 것은 "실제 브라우저·실제 서버에서 된다"의 증거가 아니다(그것은 실행기 screen.mjs --real, 브레인방).
// 가짜 DOM 은 그리기·이벤트 전파를 흉내 내지 않는다 — 기준과 작업본을 같은 가짜 DOM 에서 돌려 견준다.

import { pathToFileURL } from 'node:url';
import { installNetworkGuard, realNetworkAttempts } from '../supabase-config-headers/harness.mjs';
import { TEST_URL, AUTH_FILE } from './rewrite.mjs';
import { V, STATE_NAMES, ACCOUNTS, OLD_STUDENT, BOOK_KEY, FOLLOWUP_KEYS, makeWorld, snapshot, diffSnapshot, checker, workFile } from './world.mjs';
import { openPage, fire } from './pages-dom.mjs';
import { TARGET_PAGES } from './pages.mjs';

const A = ACCOUNTS.A;
const B = ACCOUNTS.B;
const GM = ACCOUNTS.GM;
const OLD_ADMIN = JSON.stringify({ id: 'm-old-adm', name: '옛관리자', nickname: '', email: 'oldadm@zz.invalid', phone: '010-0000-0099', level: 2, role: 'admin' });
const OLD_NAMES = /옛학생|옛관리자|old@zz\.invalid|oldadm@zz\.invalid|m-old-1/;
const idOf = (acc) => new RegExp([acc.profile.name, acc.email.replace(/[.]/g, '\\.'), acc.profile.id].join('|'));
const TEXT = {
    missing: '로그인 상태를 확인할 수 없습니다. 잠시 뒤 새로 고침해 주세요.',
    closed: /새 로그인 시험판/,
};

// ---- 화면과 진입 주소(화면이 실제로 쓰는 인자) ----
const SCENARIOS = [];
for (const p of TARGET_PAGES) {
    const add = (name, extra = {}) => SCENARIOS.push({ file: p.file, category: p.category, name: `${p.file}${name ? ' ' + name : ''}`, search: '', hash: '', ...extra });
    if (p.file === 'application-detail.html') add('?id#step2', { search: '?id=app-1', hash: '#step2' });
    else if (p.file === 'analysis.html') add('?id', { search: '?id=app-1' });
    else if (p.file === 'write.html') add('?board=reviews', { search: '?board=reviews' });
    else if (p.file === 'application-form.html') { add('', { branch: 'visitor-closed' }); add('?edit', { search: '?edit=app-1', memberOnly: true }); }
    else if (p.file === 'book-request.html') add('', { branch: 'visitor-closed' });
    else if (p.file === 'materials.html') { add('?id', { search: '?id=row-9' }); add('(목록)', { adminOnly: true }); }
    else if (['notice.html', 'reviews.html', 'reviews-book.html', 'study-certify.html'].includes(p.file)) { add('(목록)'); add('?id', { search: '?id=row-9' }); }
    else if (p.file === 'application.html') { add('(목록)'); add('?notice_id', { search: '?notice_id=row-9' }); }
    else add('');
}
// 회원 전용 갈래(확인되지 않으면 로그인 화면으로 가는 진입)
const isMemberEntry = (s) => s.category === 'member' || s.memberOnly;
// 닫아 둔 기능의 화면(확인돼도 업무 요청이 없다)
const CLOSED_MEMBER = new Set(['my-profile.html', 'change-password.html', 'withdraw.html']);

// ---- 가짜 업무 응답(전부 지어낸 값). 조건의 이메일을 그대로 돌려주거나, 그 세계의 주인(ownerEmail)의 것으로 돌려준다 ----
const json = (rows) => ({ status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` }, body: JSON.stringify(rows) });
function pagesRest(w) {
    return (req, u) => {
        const table = u.pathname.replace('/rest/v1/', '');
        const q = u.searchParams;
        const eq = (k) => (q.get(k) || '').replace(/^(eq|ilike)\./, '');
        if (req.method !== 'GET') return json([{ id: 'written-1' }]);
        if (table === 'users') {
            if (q.has('nickname')) return json([]);
            return json([{ id: 'm-old-1', name: '옛학생', nickname: '합성닉', email: 'old@zz.invalid', password: 'zz-old-pw', phone: '010-0000-0000', role: 'user', blocked: false, withdrawal_requested_at: null, intro_book_track: 'regular' }]);
        }
        if (['withdrawal_records', 'correction_extension_requests', 'toefl_exam_schedules', 'tr_weekly_check_drafts'].includes(table)) return json([]);
        if (table === 'applications' && w.ownerEmail === NOBODY) return json([]);       // 신청서가 없는 회원
        const email = eq('email') || w.ownerEmail || 'owner@zz.invalid';
        return json([{
            id: eq('id') || 'row-1', email, user_email: email, author_email: email, user_id: 'm-owner', name: '합성 신청자', phone: '010-0000-0000',
            subject: '합성 글', title: '합성 글', content: '<p>합성 본문</p>', author: '합성 글쓴이', author_name: '합성 글쓴이', author_real_name: '합성 실명',
            published_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', application_type: 'challenge', deleted: false, withdrawn_at: null,
            status: 'active', hit: 1, is_private: false, analysis_status: '승인', analysis_content: '합성 분석', setting_key: 'default', question_type: 'text', sort_order: 1,
        }]);
    };
}

const NOBODY = 'nobody@zz.invalid';
const PAGE_STATES = [...STATE_NAMES, '옛 관리자'];
function world(stateName, variant, mutate, ownerEmail) {
    const w = makeWorld(stateName === '옛 관리자' ? '빈 브라우저' : stateName, { variant, mutate });
    if (stateName === '옛 관리자') {
        w.browser.local.set('iontoefl_user', OLD_ADMIN);
        w.browser.local.set('iontoefl_login_time', String(w.browser.now - 3600000));
        w.initial = new Map(w.browser.local);
    }
    w.ownerEmail = ownerEmail !== undefined ? ownerEmail : (stateName === '옛 관리자' ? 'someone@zz.invalid' : 'old@zz.invalid');
    w.rest = pagesRest(w);
    return w;
}

// ---- 기록에서 꺼내 보는 것 ----
const isAuthUrl = (url) => url.startsWith(TEST_URL + '/auth/v1/') || url === TEST_URL + '/rest/v1/rpc/my_profile' || url === TEST_URL + '/rest/v1/rpc/my_site_access';
const business = (w, page) => w.browser.requests.filter((r) => (!page || r.page === page.name) && !isAuthUrl(r.url));
const reqKey = (r) => `${r.method} ${r.url.replace(/^https:\/\/[^/]+/, '')}`;
const navsOf = (page) => page.trace.filter((e) => e.t === 'nav' || e.t === 'reload').map((e) => (e.t === 'reload' ? '[새로 고침]' : e.to));
const alertsOf = (page) => page.trace.filter((e) => e.t === 'alert').map((e) => e.text);
const drawn = (page) => page.trace.filter((e) => ['html', 'text', 'attr', 'alert', 'nav', 'box'].includes(e.t)).map((e) => String(e.html || e.text || e.value || e.to || ''));
const drawnMatch = (page, re) => drawn(page).some((s) => re.test(s));
const noticeShown = (page, re) => page.trace.some((e) => e.t === 'text' && (typeof re === 'string' ? e.text === re : re.test(e.text)));
const toLogin = (page) => navsOf(page).some((n) => /(^|\/)login\.html/.test(n));
const hidden = (page) => page.root.classList.contains('eon-auth-away');
const state = (page) => page.evaluate('typeof EonAuth === "object" ? EonAuth.state() : "none"');

function auditOn(w, c, label) {
    for (const r of w.browser.requests) {
        const auth = r.headers.find(([n]) => n.toLowerCase() === 'authorization');
        const token = auth && auth[1].startsWith('Bearer ') ? auth[1].slice(7) : '';
        const member = token.split('.').length === 3;       // 가짜 서버의 회원 JWT 모양(공개 키는 점이 없는 가짜 글자다)
        if (member) c.ok(isAuthUrl(r.url), `${label}: 회원 자격이 인증 모듈의 요청 밖(업무 요청)에 실림`);
    }
    c.ok(w.outside.length === 0 && w.server.foreign.length === 0, `${label}: 시험 출처 밖으로 나간 요청이 있음`);
    const touched = w.browser.storageLog.filter((e) => e.key === BOOK_KEY || FOLLOWUP_KEYS.includes(e.key) || e.op === 'clear' || e.op === 'key' || e.op === 'length');
    c.ok(touched.length === 0, `${label}: 교재 편집·후속메일 로그인 상태(또는 저장소 전체)를 읽거나 씀 ${touched.length}건`);
}

const open = (w, s, name, opts = {}) => openPage(w, name || 't1', s.file, { search: s.search, hash: s.hash, ...opts });

// =====================================================================
// 1. 꺼짐: 대상 화면 26개 × 저장소 상태 6 — 기준(14455ae)과 같은가. 인증 모듈 파일을 받지 못한 꺼진 화면도 같은가.
// =====================================================================
async function sectionOffPages(mutate) {
    const problems = [];
    let compared = 0;
    for (const s of SCENARIOS) {
        for (const stateName of PAGE_STATES) {
            const run = async (variant, m, opts) => {
                const w = world(stateName, variant, m);
                const page = await open(w, s, 't1', opts);
                await w.browser.advance(6000);
                return { w, page, snap: snapshot(w, page) };
            };
            const base = await run(V.BASE);
            const now = await run(V.OFF, mutate);
            compared++;
            const label = `꺼짐 › ${s.name} › ${stateName}`;
            for (const d of diffSnapshot(base.snap, now.snap)) problems.push(`${label} › 기준과 다름: ${d}`);
            if (now.snap.scripts.length || now.snap.channels || now.snap.sdk !== 'undefined') problems.push(`${label} › SDK·탭 사이 알림 통로의 흔적`);
            if (now.page.evaluate('EonAuth.isOn()') !== false || now.page.evaluate('EonLogin.on()') !== false) problems.push(`${label} › 꺼짐이 아님`);
            if (now.w.outside.length || base.w.outside.length) problems.push(`${label} › 가짜 서버 밖으로 나간 요청`);
            // 꺼진 화면이 인증 모듈 파일을 받지 못해도(게이트만 있음) 지금의 화면 그대로 돈다
            if (stateName === '옛 학생' || stateName === '빈 브라우저') {
                const lost = await run(V.OFF, mutate, { dropScript: AUTH_FILE });
                compared++;
                for (const d of diffSnapshot(base.snap, lost.snap)) problems.push(`${label} › 모듈 파일을 받지 못한 꺼진 화면이 기준과 다름: ${d}`);
            }
        }
    }
    return { problems, compared };
}

// 꺼짐에서 사람이 누르는 동작(로그아웃·제출): 기준과 같은가
const OFF_ACTIONS = [
    { name: 'my-dashboard 로그아웃', file: 'my-dashboard.html', state: '옛 학생', act: (w, p) => fire(w, p, p.byId.logoutBtn, 'click') },
    { name: 'my-profile 로그아웃', file: 'my-profile.html', state: '옛 학생', act: (w, p) => fire(w, p, p.byId.logoutBtn, 'click') },
    { name: 'my-profile 비밀번호 확인 제출', file: 'my-profile.html', state: '옛 학생', act: (w, p) => { p.byId.verifyPassword.value = 'zz-old-pw'; return fire(w, p, p.byId.verifyForm, 'submit'); } },
    { name: 'change-password 제출', file: 'change-password.html', state: '옛 학생', act: (w, p) => { p.byId.currentPassword.value = 'zz-old-pw'; p.byId.newPassword.value = 'zz-new-pw1'; p.byId.confirmPassword.value = 'zz-new-pw1'; return fire(w, p, p.byId.changePasswordForm, 'submit'); } },
    { name: 'find-id 제출', file: 'find-id.html', state: '빈 브라우저', act: (w, p) => { p.byId.name.value = '옛학생'; p.byId.phone.value = '010-0000-0000'; return fire(w, p, p.byId.findIdForm, 'submit'); } },
    { name: 'find-password 제출', file: 'find-password.html', state: '빈 브라우저', act: (w, p) => { p.byId.email.value = 'old@zz.invalid'; p.byId.name.value = '옛학생'; p.byId.phone.value = '010-0000-0000'; return fire(w, p, p.byId.findPasswordForm, 'submit'); } },
    { name: 'register 닉네임 입력', file: 'register.html', state: '빈 브라우저', act: async (w, p) => { p.byId.nickname.value = '합성닉'; await fire(w, p, p.byId.nickname, 'input'); await w.browser.advance(1500); } },
    { name: 'register 제출', file: 'register.html', state: '빈 브라우저', act: (w, p) => fire(w, p, p.byId.registerForm, 'submit') },
    { name: 'application-form 제출(비회원)', file: 'application-form.html', state: '빈 브라우저', act: (w, p) => fire(w, p, p.byId.applicationForm, 'submit') },
    { name: 'book-request "다른 계정으로"', file: 'book-request.html', state: '옛 학생', owner: NOBODY, act: (w, p) => fire(w, p, p.byId.logoutLink, 'click') },
    { name: 'index 로그아웃', file: 'index.html', state: '옛 학생', act: async (w, p) => { p.evaluate('logout()'); await w.browser.idle(); } },
];
async function sectionOffActions(mutate) {
    const problems = [];
    for (const a of OFF_ACTIONS) {
        const run = async (variant, m) => {
            const w = world(a.state, variant, m, a.owner);
            const page = await openPage(w, 't1', a.file, {});
            await w.browser.advance(1000);
            try { await a.act(w, page); } catch (e) { page.rec({ t: 'act-error', text: String(e && e.message) }); }
            await w.browser.advance(3000);
            return { w, page, snap: snapshot(w, page) };
        };
        const base = await run(V.BASE);
        const now = await run(V.OFF, mutate);
        for (const d of diffSnapshot(base.snap, now.snap)) problems.push(`꺼짐의 동작 › ${a.name} › 기준과 다름: ${d}`);
        if (base.page.trace.some((e) => e.t === 'act-error')) problems.push(`꺼짐의 동작 › ${a.name} › 시험이 그 동작을 일으키지 못함`);
    }
    return { problems, compared: OFF_ACTIONS.length };
}

// =====================================================================
// 2. 켜짐
// =====================================================================

// 새 방식의 로그인이 저장돼 있고(호환 값도 앞 화면이 남겨 둔 상태), 확인 응답을 붙잡은 채로 화면을 연다
async function heldOpen(s, key, mutate, ownerEmail) {
    const acc = ACCOUNTS[key];
    const w = world('빈 브라우저', V.ON, mutate, ownerEmail !== undefined ? ownerEmail : acc.email);
    w.seed(key, { aal: key === 'GM' ? 'aal2' : 'aal1' });
    (await w.open('before', 'index.html')).close();       // 앞 화면(3A 의 가짜 화면)이 호환 값을 남긴다
    const primed = w.browser.local.has('iontoefl_user');
    const mark = w.browser.requests.length;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    w.server.faults.my_site_access = () => gate.then(() => null);
    const page = await open(w, s, 't1', { noIdle: true });
    await w.browser.spin(80);
    const during = { business: w.browser.requests.slice(mark).filter((r) => r.page === 't1' && !isAuthUrl(r.url)), navs: navsOf(page), state: state(page), pending: w.browser.pending };
    return { w, page, acc, primed, release, during };
}

// 방문자 기준: 기준 파일(시험 설정)로 빈 브라우저에서 연 화면의 업무 요청·이동
async function visitorBaseline(s) {
    const w = world('빈 브라우저', V.BASE_T, null, 'owner@zz.invalid');
    const page = await open(w, s);
    await w.browser.advance(6000);
    return { requests: business(w, page).map(reqKey), navs: navsOf(page), alerts: alertsOf(page) };
}

// 확인 전: 보호 표시 0·자동 보호 요청 0. 공개 본문은 기다리지 않는다. 확인 뒤에만 회원 표시·회원 요청.
async function testBeforeConfirm(opt) {
    const c = checker();
    for (const s of SCENARIOS) {
        const key = s.adminOnly ? 'GM' : 'A';
        const h = await heldOpen(s, key, opt.mutate);
        const label = `확인 전(${s.name})`;
        const who = idOf(h.acc);
        c.ok(h.primed, `${label}: 시험이 호환 값이 남아 있는 상태를 만들지 못함`);
        c.ok(h.during.state === 'restoring' && h.during.pending > 0, `${label}: 시험이 확인 응답을 붙잡지 못함(${h.during.state})`);
        c.ok(!drawnMatch(h.page, who), `${label}: 확인 전에 회원 정보가 그려짐`);
        c.ok(h.during.navs.length === 0, `${label}: 확인 전에 화면 이동이 있음(${h.during.navs.join(', ')})`);
        c.ok(!h.during.business.some((r) => who.test(decodeURIComponent(r.url)) || who.test(String(r.bodyText || ''))), `${label}: 확인 전에 회원의 값을 조건으로 한 요청이 나감`);
        const base = await visitorBaseline(s);
        const sent = h.during.business.map(reqKey);
        if (isMemberEntry(s) || s.adminOnly || s.category === 'branch') {
            // 회원 화면·회원 갈래: 확인이 끝나기 전에는 자동으로 나가는 업무 요청이 없다
            // (갈래 화면은 저장된 새 로그인이 있으므로 갈래를 고르기 전이다 — 방문자 갈래의 요청도 아직 없다)
            if (s.category === 'branch' && s.file === 'application.html') {
                c.ok(sent.every((k) => base.requests.includes(k)), `${label}: 확인 전에 방문자 기준에 없는 요청이 나감`);
            } else {
                c.ok(sent.length === 0, `${label}: 확인 전에 업무 요청이 나감(${sent.length}건)`);
            }
        } else {
            // 공개 화면: 본문의 요청은 확인을 기다리지 않고, 방문자 기준에 없는 요청은 없다
            c.ok(sent.every((k) => base.requests.includes(k)), `${label}: 확인 전에 방문자 기준에 없는 요청이 나감`);
            const bodyOnly = base.requests.filter((k) => !/\/applications\?/.test(k));       // 머리말·퍼널의 조회(로그인 값이 조건)는 빼고 본다
            if (bodyOnly.length) c.ok(sent.length > 0, `${label}: 공개 본문이 로그인 확인을 기다림(확인 전 요청 0)`);
        }
        h.release();
        await h.w.browser.idle();
        await h.w.browser.advance(1500);
        c.ok(state(h.page) === 'signed_in', `${label}: 풀어 준 뒤 signed_in 이 아님(${state(h.page)})`);
        c.ok(!toLogin(h.page), `${label}: 확인된 회원인데 로그인 화면으로 감`);
        if (isMemberEntry(s) && !CLOSED_MEMBER.has(s.file) && s.file !== 'write.html') {
            c.ok(business(h.w, h.page).length > 0, `${label}: 확인된 뒤에도 회원 화면의 조회가 나가지 않음`);
        }
        if (CLOSED_MEMBER.has(s.file)) {
            c.ok(business(h.w, h.page).length === 0, `${label}: 닫아 둔 기능의 화면이 업무 요청을 보냄`);
            c.ok(noticeShown(h.page, TEXT.closed), `${label}: 닫아 둔 기능의 임시 안내가 없음`);
        }
        if (s.file === 'my-dashboard.html' || s.file === 'my-profile.html') c.ok(drawnMatch(h.page, who), `${label}: 확인된 뒤 회원 정보가 그려지지 않음`);
        auditOn(h.w, c, label);
    }
    return c.problems;
}

// 확인되지 않음: 회원 전용 갈래는 지금처럼 로그인 화면으로, 그 뒤 보호 업무 요청 0. 옛 값은 그려지지 않는다.
// 공개 본문·방문자 갈래는 로그인 화면으로 보내지 않는다.
async function testNotConfirmed(opt) {
    const c = checker();
    const cases = [
        { name: '옛 값만 있음', state: '옛 학생', seed: null },
        { name: '옛 관리자 값만 있음', state: '옛 관리자', seed: null },
        { name: '차단된 계정의 로그인', state: '빈 브라우저', seed: 'BLK' },
        { name: '빈 브라우저', state: '빈 브라우저', seed: null },
    ];
    for (const s of SCENARIOS) {
        const base = await visitorBaseline(s);
        for (const k of cases) {
            const w = world(k.state, V.ON, opt.mutate, 'old@zz.invalid');
            if (k.seed) w.seed(k.seed);
            const page = await open(w, s);
            await w.browser.advance(6000);
            const label = `확인되지 않음(${s.name} · ${k.name})`;
            const sent = business(w, page).map(reqKey);
            c.ok(state(page) !== 'signed_in', `${label}: signed_in 이 됨`);
            c.ok(!drawnMatch(page, OLD_NAMES), `${label}: 저장된 옛 값이 그려짐`);
            c.ok(!sent.some((x) => /old%40zz|old@zz|oldadm|m-old-1|undefined/.test(x)), `${label}: 옛 값(또는 빈 값)을 조건으로 한 요청이 나감`);
            if (isMemberEntry(s)) {
                c.ok(toLogin(page), `${label}: 로그인 화면으로 가지 않음(${navsOf(page).join(', ') || '이동 없음'})`);
                c.ok(JSON.stringify(navsOf(page)) === JSON.stringify(base.navs) && JSON.stringify(alertsOf(page)) === JSON.stringify(base.alerts), `${label}: 로그인 화면으로 보내는 안내·주소가 지금(방문자 기준)과 다름`);
                c.ok(sent.length === 0, `${label}: 로그인 화면으로 보낸 뒤(또는 앞)에 보호 업무 요청이 나감(${sent.length}건)`);
            } else if (s.adminOnly) {
                c.ok(JSON.stringify(navsOf(page)) === JSON.stringify(base.navs), `${label}: 관리자 갈래의 이동이 방문자 기준과 다름`);
                c.ok(sent.length === 0, `${label}: 관리자 갈래가 확인 없이 업무 요청을 보냄`);
            } else if (s.branch === 'visitor-closed') {
                c.ok(!toLogin(page), `${label}: 방문자 갈래가 로그인 화면으로 감`);
                c.ok(noticeShown(page, TEXT.closed), `${label}: 닫아 둔 갈래의 임시 안내가 없음`);
                c.ok(!sent.some((x) => /\/users|withdrawal_records|verify|email/i.test(x)), `${label}: 닫아 둔 갈래에서 계정 조회·인증 요청이 나감`);
            } else {
                // 공개 화면·방문자 갈래: 방문자 기준과 같은 요청·이동
                c.ok(!toLogin(page), `${label}: 공개 본문·방문자 갈래가 로그인 화면으로 감`);
                c.ok(JSON.stringify(sent) === JSON.stringify(base.requests), `${label}: 업무 요청이 방문자 기준과 다름(${sent.length} ↔ ${base.requests.length})`);
                c.ok(JSON.stringify(navsOf(page)) === JSON.stringify(base.navs), `${label}: 화면 이동이 방문자 기준과 다름`);
            }
            auditOn(w, c, label);
        }
    }
    return c.problems;
}

// 켜진 화면인데 인증 모듈 파일을 받지 못함: "꺼짐"이 아니라 "닫음" — 옛 값을 믿지 않는다. 공개 본문은 그대로.
async function testModuleMissing(opt) {
    const c = checker();
    for (const s of SCENARIOS) {
        const base = await visitorBaseline(s);
        for (const stateName of ['옛 학생', '옛 관리자']) {
            const w = world(stateName, V.ON, opt.mutate, 'old@zz.invalid');
            const page = await open(w, s, 't1', { dropScript: AUTH_FILE });
            await w.browser.advance(6000);
            const label = `모듈 없는 켜진 화면(${s.name} · ${stateName})`;
            const sent = business(w, page).map(reqKey);
            c.ok(page.evaluate('typeof EonAuth') === 'undefined' && page.evaluate('EonLogin.on()') === true && page.evaluate('EonLogin.missing()') === true, `${label}: 시험이 "켜진 화면 + 모듈 없음"을 만들지 못함`);
            c.ok(!drawnMatch(page, OLD_NAMES), `${label}: 저장된 옛 값이 그려짐`);
            c.ok(!sent.some((x) => /old%40zz|old@zz|oldadm|m-old-1|undefined/.test(x)), `${label}: 옛 값을 조건으로 한 요청이 나감`);
            if (s.memberOnly) {
                // 갈래 화면의 회원 전용 진입(신청서 수정): 지금처럼 로그인 화면으로 보낸다(요청 0)
                c.ok(sent.length === 0 && JSON.stringify(navsOf(page)) === JSON.stringify(base.navs), `${label}: 닫지 않음(요청 ${sent.length}건, 이동 ${navsOf(page).join(', ')})`);
            } else if (isMemberEntry(s) || s.adminOnly) {
                c.ok(sent.length === 0 && navsOf(page).length === 0, `${label}: 닫지 않음(요청 ${sent.length}건, 이동 ${navsOf(page).length}건)`);
                c.ok(noticeShown(page, TEXT.missing), `${label}: 닫았다는 임시 안내가 없음`);
            } else if (s.branch === 'visitor-closed') {
                c.ok(!sent.some((x) => /\/users|withdrawal_records/i.test(x)) && !toLogin(page), `${label}: 닫지 않음`);
            } else {
                c.ok(JSON.stringify(sent) === JSON.stringify(base.requests) && !toLogin(page), `${label}: 공개 본문·방문자 갈래가 방문자 기준과 다름`);
            }
            c.ok(w.browser.requests.every((r) => !isAuthUrl(r.url)), `${label}: 인증 요청이 나감`);
        }
    }
    return c.problems;
}

// 닫아 둔 기능: 켜진 길에서 요청 0·로그인 값 쓰기 0·임시 안내
async function testClosedFeatures(opt) {
    const c = checker();
    const visitor = async (file) => { const w = world('빈 브라우저', V.ON, opt.mutate, 'owner@zz.invalid'); const page = await openPage(w, 't1', file, {}); await w.browser.advance(1000); return { w, page }; };
    const member = async (file) => {
        const w = world('빈 브라우저', V.ON, opt.mutate, NOBODY);
        w.seed('A');
        (await w.open('before', 'index.html')).close();
        const page = await openPage(w, 't1', file, {});
        await w.browser.advance(1500);
        return { w, page };
    };
    // 화면 코드가 로그인 값을 직접 쓰거나 지웠는가: 그 자리의 값이 인증 모듈이 쓴 값(표식의 사본) 그대로여야 한다(로그인 전이면 비어 있어야 한다)
    const wrote = (w) => {
        const user = w.browser.local.has('iontoefl_user') ? w.browser.local.get('iontoefl_user') : null;
        const time = w.browser.local.has('iontoefl_login_time') ? w.browser.local.get('iontoefl_login_time') : null;
        let mark = null;
        try { mark = JSON.parse(w.browser.local.get('eon_auth_v1:compat')); } catch (e) { mark = null; }
        if (!w.browser.local.has('eon_auth_v1')) return user !== null || time !== null;
        return !mark || user !== mark.user || time !== mark.time;
    };
    const closedOk = (label, x, extra = true) => {
        c.ok(business(x.w, x.page).length === 0, `${label}: 닫아 둔 기능에서 업무 요청이 나감(${business(x.w, x.page).map(reqKey).join(' | ')})`);
        c.ok(!wrote(x.w), `${label}: 화면이 로그인 값을 직접 쓰거나 지움`);
        c.ok(noticeShown(x.page, TEXT.closed) || alertsOf(x.page).some((t) => TEXT.closed.test(t)) || drawnMatch(x.page, TEXT.closed), `${label}: 임시 안내가 없음`);
        c.ok(extra, `${label}: 그 밖의 기대와 다름`);
    };
    {   // 가입
        const x = await visitor('register.html');
        x.page.byId.nickname.value = '합성닉';
        await fire(x.w, x.page, x.page.byId.nickname, 'input');
        await x.w.browser.advance(1500);
        await fire(x.w, x.page, x.page.byId.registerForm, 'submit');
        await x.w.browser.advance(2000);
        closedOk('닫음(가입)', x, navsOf(x.page).length === 0);
    }
    {   // 아이디 찾기
        const x = await visitor('find-id.html');
        x.page.byId.name.value = '옛학생'; x.page.byId.phone.value = '010-0000-0000';
        await fire(x.w, x.page, x.page.byId.findIdForm, 'submit');
        closedOk('닫음(아이디 찾기)', x);
    }
    {   // 비밀번호 찾기
        const x = await visitor('find-password.html');
        x.page.byId.email.value = 'old@zz.invalid'; x.page.byId.name.value = '옛학생'; x.page.byId.phone.value = '010-0000-0000';
        await fire(x.w, x.page, x.page.byId.findPasswordForm, 'submit');
        closedOk('닫음(비밀번호 찾기)', x);
    }
    {   // 가입을 겸한 신청
        const x = await visitor('application-form.html');
        await fire(x.w, x.page, x.page.byId.applicationForm, 'submit');
        await x.w.browser.advance(2000);
        const sent = business(x.w, x.page).map(reqKey);
        c.ok(!sent.some((k) => /\/users|withdrawal_records/.test(k)) && !sent.some((k) => !k.startsWith('GET ')), `닫음(가입을 겸한 신청): 계정 조회·저장이 나감`);
        c.ok(!wrote(x.w), '닫음(가입을 겸한 신청): 화면이 로그인 값을 직접 씀');
        c.ok(alertsOf(x.page).some((t) => TEXT.closed.test(t)) && noticeShown(x.page, TEXT.closed), '닫음(가입을 겸한 신청): 임시 안내가 없음');
        // 화면 코드가 로그인 값을 직접 쓰는 함수: 켜진 화면에서는 쓰지 않는다
        let threw = false;
        try { x.page.evaluate(`saveUserSession({ id: 'zz-x', name: '합성', email: 'zz-x@zz.invalid', phone: '010', role: 'user' })`); } catch (e) { threw = true; }
        c.ok(threw && !x.w.browser.local.has('iontoefl_user'), '켜진 화면의 화면 코드가 로그인 값(iontoefl_user)을 직접 씀(application-form 의 saveUserSession)');
    }
    {   // 가입을 겸한 책 신청
        const x = await visitor('book-request.html');
        const sent = business(x.w, x.page).map(reqKey);
        c.ok(sent.length === 0 && !wrote(x.w), `닫음(가입을 겸한 책 신청): 요청·쓰기가 있음(${sent.length}건)`);
        c.ok(noticeShown(x.page, TEXT.closed), '닫음(가입을 겸한 책 신청): 임시 안내가 없음');
        c.ok(x.page.byId.formWrap && x.page.byId.formWrap.style.display !== 'block', '닫음(가입을 겸한 책 신청): 가입 폼이 열림');
    }
    {   // 비밀번호 변경
        const x = await member('change-password.html');
        x.page.byId.currentPassword.value = 'zz-pw-A'; x.page.byId.newPassword.value = 'zz-new-pw1'; x.page.byId.confirmPassword.value = 'zz-new-pw1';
        await fire(x.w, x.page, x.page.byId.changePasswordForm, 'submit');
        closedOk('닫음(비밀번호 변경)', x, !toLogin(x.page) && x.w.browser.local.has('iontoefl_user'));
    }
    {   // 탈퇴 신청
        const x = await member('withdraw.html');
        closedOk('닫음(탈퇴 신청)', x, !toLogin(x.page) && x.page.byId.withdrawMain.style.display !== 'block');
    }
    {   // 내 정보 고치기
        const x = await member('my-profile.html');
        x.page.byId.verifyPassword.value = 'zz-pw-A';
        await fire(x.w, x.page, x.page.byId.verifyForm, 'submit');
        closedOk('닫음(내 정보 고치기)', x, !toLogin(x.page));
    }
    {   // 이미 로그인한 회원의 신청·책 신청은 그대로(닫지 않는다)
        for (const file of ['application-form.html', 'book-request.html']) {
            const x = await member(file);
            c.ok(!noticeShown(x.page, TEXT.closed), `열림(${file}): 로그인한 회원에게 닫힘 안내가 뜸`);
            c.ok(business(x.w, x.page).some((r) => decodeURIComponent(r.url).includes(A.email)), `열림(${file}): 로그인한 회원의 신청 조회가 나가지 않음`);
            c.ok(!toLogin(x.page), `열림(${file}): 로그인한 회원을 로그인 화면으로 보냄`);
        }
    }
    return c.problems;
}

// 로그아웃(켜짐): 화면이 로그인 값을 직접 지우지 않고 인증 모듈이 이 로그인만 끝낸다
async function testLogoutOn(opt) {
    const c = checker();
    const cases = [
        { file: 'my-dashboard.html', el: 'logoutBtn', to: 'index.html', owner: A.email },
        { file: 'my-profile.html', el: 'logoutBtn', to: 'index.html', owner: A.email },
        { file: 'book-request.html', el: 'logoutLink', to: 'login.html?redirect=book-request.html', owner: NOBODY },
    ];
    for (const k of cases) {
        for (const fault of [null, 'network']) {
            const w = world('빈 브라우저', V.ON, opt.mutate, k.owner);
            const sess = w.seed('A');
            (await w.open('before', 'index.html')).close();
            const page = await openPage(w, 't1', k.file, {});
            await w.browser.advance(1500);
            const label = `로그아웃(${k.file}${fault ? ' · 응답 없음' : ''})`;
            c.ok(state(page) === 'signed_in' && !!page.byId[k.el], `${label}: 시험이 로그인된 화면을 만들지 못함`);
            if (!page.byId[k.el]) continue;
            if (fault) w.server.faults.logout = () => 'network';
            const before = w.server.log.length;
            await fire(w, page, page.byId[k.el], 'click');
            await w.browser.advance(1000);
            const routes = w.server.log.slice(before).map((e) => e.route + e.search);
            c.ok(routes.filter((r) => r === 'POST /auth/v1/logout?scope=local').length === 1, `${label}: 인증 모듈의 로그아웃(이 로그인만)이 한 번 나가지 않음`);
            if (!fault) {
                c.ok(!sess.alive && !w.browser.local.has('eon_auth_v1') && !w.browser.local.has('iontoefl_user'), `${label}: 로그인이 끝나지 않음`);
                c.ok(navsOf(page).includes(k.to) && !navsOf(page).includes('[새로 고침]'), `${label}: 끝난 뒤 이동이 기대와 다름(${navsOf(page).join(', ')})`);
            } else {
                c.ok(sess.alive && w.browser.local.has('eon_auth_v1'), `${label}: 끝났는지 모르는데 저장된 로그인을 지움`);
                c.ok(!navsOf(page).includes(k.to), `${label}: 끝났는지 모르는데 로그아웃된 것처럼 이동함`);
                c.ok(alertsOf(page).includes('로그아웃을 확인하지 못했습니다. 잠시 뒤 다시 시도해주세요.'), `${label}: 확인하지 못했다는 안내가 없음`);
                c.ok(hidden(page) && navsOf(page).includes('[새로 고침]'), `${label}: 확인 상태를 거둔 뒤 화면을 가리고 다시 받지 않음`);
            }
            auditOn(w, c, label);
        }
    }
    return c.problems;
}

// 로그인 뒤 돌아갈 주소: 해석한 뒤의 출처·경로·인자·# 이 허용 목록과 정확히 맞을 때만
const RETURN_OK = [
    ['application-detail.html?id=app-1#step2', 'application-detail.html?id=app-1#step2'],
    ['/application-detail.html?id=app-1#step2', 'application-detail.html?id=app-1#step2'],
    ['application-detail.html?id=3f2a-9b', 'application-detail.html?id=3f2a-9b'],
    ['application-form.html', 'application-form.html'],
    ['application-form.html?edit=app-1', 'application-form.html?edit=app-1'],
    ['http://127.0.0.1:8787/analysis.html?id=app-1', 'analysis.html?id=app-1'],
    ['my-profile.html', 'my-profile.html'],
    ['book-request.html', 'book-request.html'],
];
const RETURN_NO = [
    'my-dashboard.html', 'write.html?board=reviews', 'withdraw.html', 'change-password.html', 'login.html', 'login.html?redirect=my-profile.html', 'index.html',
    'admin-dashboard.html', 'admin-users.html', 'register.html', 'find-id.html',
    'https://evil.zz.invalid/my-profile.html', '//evil.zz.invalid/my-profile.html', 'http://127.0.0.1:8788/my-profile.html', 'https://127.0.0.1:8787/my-profile.html',
    'http://127.0.0.1:8787.evil.zz.invalid/my-profile.html', 'http://user@127.0.0.1:8787/my-profile.html',
    'javascript:alert(1)', 'data:text/html,x', 'my-profile.html?redirect=https://evil.zz.invalid', 'my-profile.html?x=1', 'my-profile.html#x',
    'application-detail.html', 'application-detail.html?id=', 'application-detail.html?id=a&id=b', 'application-detail.html?id=app-1&redirect=x', 'application-detail.html?id=app-1#step9',
    'application-detail.html?id=a%2F..%2Fb', 'application-form.html?edit=app-1&id=2', 'analysis.html', 'analysis.html?id=app-1#step2',
    'sub/my-profile.html', '../my-profile.html/x', 'my-profile.html/..%2Fadmin-dashboard.html', 'my-profile.htmlx', 'xmy-profile.html', ' my-profile.html', 'my-profile.html\\x', '',
];
async function testReturnTarget(opt) {
    const c = checker();
    {
        const w = world('빈 브라우저', V.ON, opt.mutate);
        const page = await openPage(w, 't1', 'login.html', {});
        await w.browser.advance(500);
        const ask = (v) => page.evaluate(`EonLogin.returnTarget(${JSON.stringify(v)})`);
        for (const [v, want] of RETURN_OK) c.ok(ask(v) === want, `돌아갈 주소: 허용 목록의 주소를 받아 주지 않음(${v} → ${ask(v)})`);
        for (const v of RETURN_NO) c.ok(ask(v) === null, `돌아갈 주소: 목록 밖의 주소를 받아 줌(${JSON.stringify(v)} → ${ask(v)})`);
        c.ok(page.evaluate('EonLogin.returnTarget(null)') === null && page.evaluate('EonLogin.returnTarget(undefined)') === null, '돌아갈 주소: 값이 없는데 주소를 돌려줌');
    }
    // 로그인 화면에서 실제로: 허용 목록이면 그 주소로, 아니면 index.html 로
    const flows = [
        ['?redirect=' + encodeURIComponent('/application-detail.html?id=app-1#step2'), 'application-detail.html?id=app-1#step2'],
        ['?redirect=' + encodeURIComponent('application-form.html?edit=app-1'), 'application-form.html?edit=app-1'],
        ['?redirect=my-profile.html', 'my-profile.html'],
        ['?redirect=my-dashboard.html', 'index.html'],
        ['?redirect=withdraw.html', 'index.html'],
        ['?redirect=' + encodeURIComponent('https://evil.zz.invalid/my-profile.html'), 'index.html'],
        ['?redirect=admin-dashboard.html', 'index.html'],
        ['?redirect=' + encodeURIComponent('login.html?redirect=my-profile.html'), 'index.html'],
        ['', 'index.html'],
    ];
    for (const [search, want] of flows) {
        const w = world('빈 브라우저', V.ON, opt.mutate);
        const page = await openPage(w, 't1', 'login.html', { search });
        await w.browser.advance(500);
        page.byId.email.value = A.email;
        page.byId.password.value = A.password;
        await fire(w, page, page.byId.loginForm, 'submit');
        await w.browser.advance(1500);
        c.ok(state(page) === 'signed_in' && JSON.stringify(navsOf(page)) === JSON.stringify([want]), `돌아갈 주소(로그인 ${search || '(없음)'}): 이동이 ${want} 한 번이 아님(${navsOf(page).join(', ') || '이동 없음'})`);
        auditOn(w, c, `돌아갈 주소(${search})`);
    }
    return c.problems;
}

// 확인된 계정이 달라짐(다른 탭이 B 로 바꿈)·뒤로 가기로 되살아난 화면: 화면을 가리고 다시 받는다.
// 늦게 도착한 A 의 응답이 B 의 화면을 덮지 않는다(가린 채로 다시 받으므로 A 의 화면은 이어지지 않는다).
async function testAccountChange(opt) {
    const c = checker();
    const pages = [
        { file: 'my-dashboard.html', search: '' },
        { file: 'application-detail.html', search: '?id=app-1' },
        { file: 'analysis.html', search: '?id=app-1' },
        { file: 'write.html', search: '?board=reviews' },
        { file: 'my-profile.html', search: '' },
        { file: 'application-form.html', search: '', owner: NOBODY },
        { file: 'survey.html', search: '' },
    ];
    for (const k of pages) {
        const w = world('빈 브라우저', V.ON, opt.mutate, k.owner || A.email);
        w.seed('A');
        (await w.open('before', 'index.html')).close();
        const page = await openPage(w, 't1', k.file, { search: k.search });
        await w.browser.advance(1500);
        const label = `계정이 달라짐(${k.file})`;
        c.ok(state(page) === 'signed_in' && !hidden(page) && navsOf(page).length === 0, `${label}: 시험이 A 로 열린 화면을 만들지 못함(${state(page)}, ${navsOf(page).join(', ')})`);
        // 다른 탭: A 를 끝내고 B 로 로그인한다(3A 의 가짜 로그인 화면)
        const other = await w.open('t2', 'login.html');
        await w.submit(other, B.email, B.password);
        await w.browser.advance(1500);
        c.ok(other.evaluate('EonAuth.state()') === 'signed_in', `${label}: 시험이 다른 탭에서 B 로 바꾸지 못함`);
        c.ok(hidden(page), `${label}: 계정이 달라졌는데 A 의 화면을 가리지 않음`);
        c.ok(navsOf(page).includes('[새로 고침]'), `${label}: 계정이 달라졌는데 화면을 다시 받지 않음`);
        c.ok(!drawnMatch(page, idOf(B)) || hidden(page), `${label}: A 의 화면에 B 의 값이 가려지지 않은 채 그려짐`);
        auditOn(w, c, label);
    }
    {   // 늦게 도착한 A 의 응답
        const w = world('빈 브라우저', V.ON, opt.mutate, A.email);
        w.seed('A');
        (await w.open('before', 'index.html')).close();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const inner = w.rest;
        w.rest = (req, u) => (u.pathname.endsWith('/applications') ? gate.then(() => inner(req, u)) : inner(req, u));
        const page = await openPage(w, 't1', 'my-dashboard.html', { noIdle: true });
        await w.browser.spin(200);
        c.ok(state(page) === 'signed_in' && w.browser.pending > 0, `늦은 응답: 시험이 A 의 조회를 붙잡지 못함(${state(page)})`);
        const other = await w.open('t2', 'login.html', { noIdle: true });
        other.byId.email.value = B.email;
        other.byId.password.value = B.password;
        other.byId.loginForm.fire('submit');
        await w.browser.spin(400);
        c.ok(hidden(page) && navsOf(page).includes('[새로 고침]'), '늦은 응답: B 로 바뀌었는데 A 의 화면을 가리고 다시 받지 않음');
        const mark = page.trace.length;
        release();
        await w.browser.idle();
        c.ok(hidden(page), '늦은 응답: A 의 응답이 도착한 뒤 화면이 다시 보임');
        c.ok(!page.trace.slice(mark).some((e) => e.t === 'fetch' && !isAuthUrl(e.url) && decodeURIComponent(e.url).includes(B.email)), '늦은 응답: A 의 화면이 B 의 값으로 조회를 이어 감');
    }
    {   // 뒤로 가기로 되살아난 화면
        const w = world('빈 브라우저', V.ON, opt.mutate, A.email);
        w.seed('A');
        (await w.open('before', 'index.html')).close();
        const page = await openPage(w, 't1', 'my-dashboard.html', {});
        await w.browser.advance(1500);
        page.dispatchWindow('pagehide', { persisted: true });
        c.ok(hidden(page), '되살아난 화면: 화면을 떠날 때 가리지 않음(보관된 화면이 A 의 내용을 보인 채로 남는다)');
        page.dispatchWindow('pageshow', { persisted: true });
        await w.browser.spin(20);
        c.ok(hidden(page) && navsOf(page).includes('[새로 고침]'), '되살아난 화면: 가린 채로 다시 받지 않음');
    }
    return c.problems;
}

// 공개 화면의 회원·관리자 표시: 확인된 값으로만(본문은 그대로)
async function testPublicButtons(opt) {
    const c = checker();
    const shown = (page, id, want) => { const el = page.byId[id]; return !!el && el.style.display === want; };
    const cases = [
        { file: 'notice.html', search: '', key: 'GM', id: 'writeBtn', on: 'block' },
        { file: 'notice.html', search: '?id=row-9', key: 'GM', id: 'adminActions', on: 'flex' },
        { file: 'materials.html', search: '?id=row-9', key: 'GM', id: 'adminActions', on: 'flex' },
        { file: 'reviews.html', search: '', key: 'A', id: 'writeBtn', on: 'block' },
        { file: 'reviews.html', search: '?id=row-9', key: 'A', id: 'postActions', on: 'flex' },
        { file: 'reviews-book.html', search: '?id=row-9', key: 'A', id: 'postActions', on: 'flex' },
        { file: 'study-certify.html', search: '?id=row-9', key: 'A', id: 'postActions', on: 'flex' },
        { file: 'application.html', search: '', key: 'GM', id: 'adminNoticeBtn', on: 'inline-flex' },
    ];
    for (const k of cases) {
        const s = { file: k.file, search: k.search, hash: '' };
        const label = `공개 화면의 표시(${k.file}${k.search} · ${k.id})`;
        const h = await heldOpen(s, k.key, opt.mutate);
        await h.w.browser.spin(200);
        c.ok(!shown(h.page, k.id, k.on), `${label}: 확인 전에 회원·관리자 버튼이 보임`);
        h.release();
        await h.w.browser.idle();
        await h.w.browser.advance(1000);
        c.ok(shown(h.page, k.id, k.on), `${label}: 확인된 뒤에도 버튼이 보이지 않음`);
        // 옛 값만 있는 브라우저(확인되지 않음): 보이지 않는다
        const w = world(k.key === 'GM' ? '옛 관리자' : '옛 학생', V.ON, opt.mutate, 'old@zz.invalid');
        const page = await open(w, s);
        await w.browser.advance(3000);
        c.ok(!shown(page, k.id, k.on), `${label}: 저장된 옛 값만으로 버튼이 보임`);
    }
    return c.problems;
}

const ON_PAGE_TESTS = [
    ['확인 전 보호 표시 0·자동 보호 요청 0, 공개 본문은 기다리지 않음, 확인 뒤에만 회원 표시·조회', testBeforeConfirm],
    ['확인되지 않으면 회원 전용 갈래만 로그인 화면으로·그 뒤 보호 업무 요청 0, 공개 본문·방문자 갈래는 방문자 기준과 같음', testNotConfirmed],
    ['켜진 화면인데 인증 모듈이 없음: 꺼짐이 아니라 닫음', testModuleMissing],
    ['닫아 둔 기능(가입·찾기·가입을 겸한 신청·비밀번호 변경·탈퇴·내 정보 고치기): 요청 0·로그인 값 쓰기 0·임시 안내', testClosedFeatures],
    ['회원 화면의 로그아웃: 인증 모듈이 이 로그인만 끝냄(모름이면 끝낸 것으로 하지 않음)', testLogoutOn],
    ['로그인 뒤 돌아갈 주소의 허용 목록', testReturnTarget],
    ['확인된 계정이 달라짐·늦게 도착한 응답·되살아난 화면', testAccountChange],
    ['공개 화면의 회원·관리자 버튼은 확인된 값으로만', testPublicButtons],
];

// =====================================================================
// 3. 감도(일부러 바꾼 사본)
// =====================================================================
const GATE = '*.html';       // 게이트는 대상 화면 전부의 head 에 있다
const PAGE_MUTANTS = [
    {
        name: '확인 전에 저장된 값으로 그리는 사본(한 길이 저장된 값을 그대로 내줌)', tests: [testBeforeConfirm, testNotConfirmed], expect: /확인 전에 회원 정보가 그려짐|저장된 옛 값이 그려짐|확인 전에 화면 이동|옛 값\(또는 빈 값\)을 조건으로/,
        edits: [[GATE, '            return m ? m.displayUserRaw() : null;', '            return window.localStorage.getItem(KEY);']],
    },
    {
        name: '확인 전에 조회를 내보내는 사본(대시보드가 확인을 기다리지 않음)', tests: [testBeforeConfirm], expect: /확인 전에 업무 요청이 나감|확인 전에 화면 이동/,
        edits: [['js/dashboard.js', '    if (EonLogin.on()) {\n        EonLogin.member(eonDashboardStart);\n        return;\n    }\n', '']],
    },
    {
        name: '확인 전에 조회를 내보내는 사본(신청서 상세가 확인보다 먼저 조회)', tests: [testBeforeConfirm, testNotConfirmed], expect: /확인 전에 업무 요청이 나감|보호 업무 요청이 나감/,
        edits: [
            ['js/application-detail.js', '    if (EonLogin.on()) {\n        EonLogin.member(function () {\n            loadApplicationDetail();\n            window.addEventListener(\'hashchange\', handleHashChange);\n        });\n        return;\n    }\n', ''],
            ['js/application-detail.js', '    if (EonLogin.on() && !EonLogin.raw()) {', '    if (false) {'],
        ],
    },
    {
        name: '보낸 뒤 실행이 이어지는 사본(대시보드가 로그인 화면으로 보낸 뒤 조회)', tests: [testNotConfirmed], expect: /보호 업무 요청이 나감|빈 값\)을 조건으로/,
        edits: [['js/dashboard.js', '    if (!(await checkLogin())) return;\n    updateSidebarUserInfo();', '    await checkLogin();\n    updateSidebarUserInfo();']],
    },
    {
        name: '켜진 길에서 호환 값을 직접 쓰는 사본(신청 화면의 saveUserSession)', tests: [testClosedFeatures], expect: /로그인 값\(iontoefl_user\)을 직접 씀/,
        edits: [['js/application-form.js', "    if (EonLogin.on()) throw new Error('켜진 화면에서는 로그인 값을 직접 쓰지 않습니다.');\n    const session = sessionFromUser(user);", '    const session = sessionFromUser(user);']],
    },
    {
        name: '켜진 길에서 로그인 값을 직접 지우는 사본(대시보드의 로그아웃이 옛 방식)', tests: [testLogoutOn], expect: /인증 모듈의 로그아웃\(이 로그인만\)이 한 번 나가지 않음/,
        edits: [['js/dashboard.js', '                if (EonLogin.on()) {\n                    // 켜진 화면: 인증 모듈이 이 로그인만 끝낸다. 화면은 로그인 값을 직접 지우지 않는다\n                    EonLogin.signOutThen(function () {', '                if (false) {\n                    EonLogin.signOutThen(function () {']],
    },
    {
        name: '목록 밖 주소로 돌아가는 사본(출처를 보지 않음)', tests: [testReturnTarget], expect: /목록 밖의 주소를 받아 줌/,
        edits: [[AUTH_FILE, '        if (u.origin !== here.origin || u.username || u.password) return null;\n', '']],
    },
    {
        name: '목록 밖 주소로 돌아가는 사본(로그인 화면이 redirect 값을 그대로 씀)', tests: [testReturnTarget], expect: /이동이 index\.html 한 번이 아님/,
        edits: [['js/login.js', "window.EonLogin.returnTarget(new URLSearchParams(window.location.search).get('redirect')) || 'index.html';", "new URLSearchParams(window.location.search).get('redirect') || 'index.html';"]],
    },
    {
        name: '목록 밖 주소로 돌아가는 사본(인자의 값을 보지 않음)', tests: [testReturnTarget], expect: /목록 밖의 주소를 받아 줌/,
        edits: [[AUTH_FILE, '                if (!Object.prototype.hasOwnProperty.call(t.params, k) || seen[k] || !t.params[k].test(v)) { bad = true; return; }', '                if (seen[k]) { bad = true; return; }']],
    },
    {
        name: '방문자 갈래가 로그인을 요구하게 된 사본(비회원 설문)', tests: [testNotConfirmed], expect: /공개 본문·방문자 갈래가 로그인 화면으로 감|업무 요청이 방문자 기준과 다름/,
        edits: [['js/survey.js', '    if (EonLogin.on() && svUser) EonLogin.watch();', "    if (EonLogin.on() && !svUser) { window.location.href = 'login.html?redirect=survey.html'; return; }"]],
    },
    {
        name: '공개 본문이 로그인 확인을 기다리게 된 사본(공지)', tests: [testBeforeConfirm], expect: /공개 본문이 로그인 확인을 기다림/,
        edits: [['notice.html', '            if (noticeId) {\n                currentPostId = noticeId;\n                showDetailView(noticeId);\n            } else {\n                loadNotices();\n            }', '            EonLogin.settle().then(function () { if (noticeId) { currentPostId = noticeId; showDetailView(noticeId); } else { loadNotices(); } });']],
    },
    {
        name: '모듈이 없는 켜진 화면을 "꺼짐"으로 처리하는 사본', tests: [testModuleMissing], expect: /"켜진 화면 \+ 모듈 없음"을 만들지 못함|저장된 옛 값이 그려짐|닫지 않음/,
        edits: [[GATE, '    function on() { return PAGE_ON || !!mod(); }', '    function on() { return !!mod(); }']],
    },
    {
        name: '닫아 둔 기능을 연 사본(아이디 찾기)', tests: [testClosedFeatures], expect: /닫음\(아이디 찾기\)/,
        edits: [[AUTH_FILE, "        find_id: { closed: true,", "        find_id: { closed: false,"]],
    },
    {
        name: '닫아 둔 기능이 닉네임 조회를 보내는 사본(가입)', tests: [testClosedFeatures], expect: /닫음\(가입\): 닫아 둔 기능에서 업무 요청이 나감/,
        edits: [['js/register.js', '    if (eonRegisterClosedText) return;       // 닫힌 길: 닉네임 조회를 보내지 않는다\n', '']],
    },
    {
        name: '확인된 계정이 달라져도 화면을 그대로 두는 사본', tests: [testAccountChange], expect: /가리지 않음|다시 받지 않음/,
        edits: [[AUTH_FILE, '        if (displayUserRaw() === guardFor) { showPage(); return; }', '        if (true) { showPage(); return; }']],
    },
    {
        name: '공개 화면이 저장된 값으로 관리자 버튼을 보이는 사본(공지)', tests: [testPublicButtons], expect: /저장된 옛 값만으로 버튼이 보임|확인 전에 회원·관리자 버튼이 보임/,
        edits: [['notice.html', "            const userData = JSON.parse(EonLogin.raw() || 'null');\n            if (userData && userData.role === 'admin') {\n                document.getElementById('writeBtn').style.display = 'block';\n            }\n            // 새 로그인", "            const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');\n            if (userData && userData.role === 'admin') {\n                document.getElementById('writeBtn').style.display = 'block';\n            }\n            if (false) // 새 로그인"]],
    },
    {
        // (한 번의 마이크로태스크만 늦추는 사본 — 예: 꺼짐에서도 `await EonLogin.settle()` — 은 다른 처리기와 차례가 바뀌지 않는 화면에서는
        //  가짜 화면의 기록으로 구별되지 않는다. 그 사본은 잡지 못함을 확인했고, 여기에는 넣지 않았다. 작업보고의 "틀릴 수 있는 것" 참고)
        name: '꺼짐인데 켜진 길(확인을 기다리는 길)을 타는 사본(대시보드)', section: 'off', tests: [], expect: /기준과 다름/,
        edits: [['js/dashboard.js', '    if (EonLogin.on()) {\n        EonLogin.member(eonDashboardStart);\n        return;\n    }\n    await checkLogin();', '    if (true) {\n        EonLogin.member(eonDashboardStart);\n        return;\n    }\n    await checkLogin();']],
    },
    {
        name: '꺼짐인데 저장된 값을 읽지 않는 사본(한 길이 꺼짐에서 null)', section: 'off', tests: [], expect: /기준과 다름/,
        edits: [[GATE, '            if (!on()) return window.localStorage.getItem(KEY);', '            if (!on()) return null;']],
    },
];

function applyPageEdits(edits, problems) {
    return (p, text) => {
        let outText = text;
        for (const [file, from, to] of edits) {
            if (file === GATE) { if (!p.endsWith('.html') || !outText.includes('eon-login-gate:begin')) continue; } else if (file !== p) continue;
            if (outText.split(from).length !== 2) { problems.push(`바꿀 자리를 정확히 1곳 찾지 못함(${p})`); continue; }
            outText = outText.replace(from, () => to);
        }
        return outText;
    };
}

async function sectionPageMutants() {
    const problems = [];
    const lines = [];
    for (const m of PAGE_MUTANTS) {
        const editProblems = [];
        const check = applyPageEdits(m.edits, editProblems);
        for (const file of new Set(m.edits.map((e) => (e[0] === GATE ? 'index.html' : e[0])))) check(file, workFile(file));
        if (editProblems.length) { problems.push(`감도 "${m.name}": ${editProblems[0]}`); continue; }
        const found = [];
        const crashes = [];
        const run = async (fn) => { try { found.push(...(await fn())); } catch (e) { crashes.push(String(e && e.message)); } };
        if (m.section === 'off') {
            await run(async () => (await sectionOffPages(applyPageEdits(m.edits, []))).problems);
        }
        for (const test of m.tests) await run(() => test({ mutate: applyPageEdits(m.edits, []) }));
        const hit = found.filter((p) => m.expect.test(p));
        if (hit.length === 0) {
            problems.push(`감도 "${m.name}": 겨냥한 판정이 깨지지 않음(다른 어긋남 ${found.length}건, 예외 ${crashes.length}건${crashes.length ? ' — ' + crashes[0] : ''})`);
            lines.push(`    - ${m.name}: 잡지 못함`);
        } else {
            lines.push(`    - ${m.name}: 겨냥한 판정 ${hit.length}건이 깨짐${crashes.length ? ` (그 밖에 예외 ${crashes.length}건 — 검출로 세지 않음)` : ''}`);
        }
    }
    return { problems, lines };
}

// =====================================================================
// run.mjs 가 부르는 한 구획. 돌려주는 값: { problems, lines }
// =====================================================================
export async function sectionPages() {
    const problems = [];
    const lines = [];
    const add = (name, list) => { for (const p of list) problems.push(`${name} › ${p}`); };

    const off = await sectionOffPages();
    add('꺼짐', off.problems);
    lines.push(`    - 꺼짐: 대상 화면 ${TARGET_PAGES.length}개(진입 ${SCENARIOS.length}가지) × 저장소 상태 ${PAGE_STATES.length} + 인증 모듈 파일을 받지 못한 꺼진 화면 = ${off.compared}건을 기준과 대조(요청·저장소·화면 이동·안내·콘솔): 어긋남 ${off.problems.length}`);
    const act = await sectionOffActions();
    add('꺼짐의 동작', act.problems);
    lines.push(`    - 꺼짐의 동작(로그아웃·제출 ${act.compared}가지)을 기준과 대조: 어긋남 ${act.problems.length}`);
    for (const [name, test] of ON_PAGE_TESTS) {
        let list;
        try { list = await test({}); } catch (e) { list = [`시험 도중 예외: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e}`]; }
        add(name, list);
        lines.push(`    - 켜짐 — ${name}: ${list.length === 0 ? '통과' : `어긋남 ${list.length}`}`);
    }
    const mut = await sectionPageMutants();
    add('감도', mut.problems);
    lines.push(`    - 감도(일부러 바꾼 사본 ${PAGE_MUTANTS.length}개 — 변조마다 겨냥한 판정이 깨져야 검출): ${mut.problems.length === 0 ? '모두 검출' : `실패 ${mut.problems.length}`}`);
    for (const l of mut.lines) lines.push('  ' + l);
    return { problems, lines, info: { scenarios: SCENARIOS.length, pages: TARGET_PAGES.length, mutants: PAGE_MUTANTS.length } };
}

// 따로 돌릴 때
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    installNetworkGuard();
    const only = process.argv[2];
    (async () => {
        if (only === 'off') {
            const off = await sectionOffPages();
            console.log(`꺼짐 ${off.compared}건: 어긋남 ${off.problems.length}`);
            off.problems.slice(0, 40).forEach((p) => console.log('  · ' + p));
            return;
        }
        if (only === 'on') {
            for (const [name, test] of ON_PAGE_TESTS) {
                if (process.argv[3] && !name.includes(process.argv[3])) continue;
                let list;
                try { list = await test({}); } catch (e) { list = [`시험 도중 예외: ${e && e.stack}`]; }
                console.log(`${name}: ${list.length === 0 ? '통과' : `어긋남 ${list.length}`}`);
                list.slice(0, 30).forEach((p) => console.log('  · ' + p));
            }
            return;
        }
        const r = await sectionPages();
        console.log('화면의 로그인 상태 통일(계약 3C-1) — 전부 가짜 화면·가짜 서버');
        r.lines.forEach((l) => console.log(l));
        r.problems.slice(0, 60).forEach((p) => console.log('  · ' + p));
        console.log(`실제 네트워크 요청 ${realNetworkAttempts.length}건`);
        console.log(r.problems.length === 0 && realNetworkAttempts.length === 0 ? '결과: 통과' : `결과: 실패 (${r.problems.length}건)`);
        process.exitCode = r.problems.length === 0 && realNetworkAttempts.length === 0 ? 0 : 1;
    })().catch((e) => { console.log('결과: 실패 — 시험 도구 오류: ' + (e && e.stack)); process.exitCode = 1; });
}
