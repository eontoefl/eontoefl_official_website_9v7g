// 화면 시험 실행기(screen.mjs)의 경우들 — 계약 3C-1(대상 화면의 로그인 상태 통일).
// 이 파일은 경우의 차례표에 경우를 더할 뿐이다. 브라우저·차단기·제어 포트·비밀 보관함은 전부 screen.mjs 의 것을 쓴다
// (예행 P 가 전부 참이어야 시작, 전송 전 차단, 경우마다 새 브라우저 상태, 결과에는 정해 둔 값만).
//
// 업무 요청은 --fake 든 --real 이든 하나도 내보내지 않는다(나가는 것은 3A 에서 승인된 인증 요청 다섯뿐).
// 막은 업무 요청에는 실행기가 가짜 응답을 준다 — 그 응답으로 그려진 화면은 실제 업무 성공이 아니다.
// 판정은 "시도"로 한다: 닫힌 갈래·확인 전·확인되지 않음에서의 업무 요청은, 가짜 응답을 받았더라도 시도한 것 자체가 실패다.

import { TARGET_PAGES } from './pages.mjs';

export const PAGE_CASE_IDS = ['C1', 'C2', 'C3', 'C3b', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'CO'];

// 실행기가 돌리지 않는 조합(통과로 세지 않는다 — 결과의 notRunMatrix 와 절차.md 의 표에 그대로 적는다)
export const NOT_RUN_MATRIX = [
    '공개 화면 11개 × (B·차단·탈퇴 처리 중·대응 없음): 공개 화면은 로그인 전(C9)·A(C15)·GM(C16)·끝난 기록(C5)·옛 값(C8)·점검 중(C17)으로만 본다',
    '갈래 화면 4개의 회원 갈래 × (B·GM): A 로만 본다(C13). 신청서 화면은 사람이 달라지는 경우에 B 로도 열린다(C7)',
    '회원 화면 7개 × 관리자(G·GM): 관리자로는 공개 화면의 표시(C16)만 본다',
    '회원 화면 7개 × 점검 중: 점검 중에는 대시보드만 본다(C17)',
    '새로 고침 × 대시보드 밖의 회원 화면 6개, 뒤로 가기 × 대시보드·글쓰기·내 정보 밖의 회원 화면 4개',
    '두 탭에서 사람이 달라짐 × 대시보드·신청서 화면 밖의 화면',
    '같은 사람의 재확인 × 글쓰기 화면 밖의 화면',
    '제출(신청·설문·글쓰기·책 신청·가입)과 그 뒤의 화면: 어디서도 제출하지 않는다',
];

const CLOSED_TEXT = '새 로그인 시험판';
const MISSING_TEXT = '로그인 상태를 확인할 수 없습니다. 잠시 뒤 새로 고침해 주세요.';
const NOT_RESTORED = ['unload-listener', 'response-cache-control-no-store', 'broadcastchannel', 'websocket', 'fetch', 'outstanding-network-request', 'related-active-contents',
    'navigation-failure', 'masked', 'lock', 'idbversionchangeevent', 'serviceworker', 'webrtc', 'websocket-sticky', 'response-method-not-get', 'http-auth-required', 'cookie-disabled'];

export async function buildPageCases(api) {
    const { runCase, pause, doLogin, until, settled, stateOf, sleep, pathOf, count, vault, seedStore, SEEDS, synth, sites, authModuleCount, newCx, hidden, checkProvidedSession } = api;
    const ON = () => sites().on;
    const OFF = () => sites().off;

    // 회원 화면과 그 진입 주소(신청서 번호는 가짜 응답에만 있는 번호다)
    const MEMBER = () => [
        { file: 'my-dashboard.html', q: '', reads: true },
        { file: 'my-profile.html', q: '', closed: true },
        { file: 'change-password.html', q: '', closed: true },
        { file: 'withdraw.html', q: '', closed: true },
        { file: 'application-detail.html', q: '?id=' + synth().appA + '#step2', reads: true },
        { file: 'analysis.html', q: '?id=' + synth().appA, reads: true },
        { file: 'write.html', q: '?board=reviews' },
    ];
    const AUTH = ['login', 'refresh', 'logout', 'my_profile', 'my_site_access'];
    // 업무 요청의 "시도"(전부 전송 전에 막힌다 — 보낸 것이 아니다)
    const attempts = (cx, from = 0) => cx.records.slice(from).filter((r) => r.business);
    const attemptsOf = (cx, from, account) => attempts(cx, from).filter((r) => r.account === account);
    const onPage = (page, file) => pathOf(page).endsWith('/' + file);
    // 화면에 보이는 글자에 그 값들이 있는가(값은 돌려주지 않는다)
    const bodyHas = (page, texts) => page.evaluate((list) => {
        const t = document.body ? document.body.innerText : '';
        return list.filter((x) => typeof x === 'string' && x.length > 0).some((x) => t.includes(x));
    }, texts).catch(() => null);
    // 입력 칸들의 값에 그 글자가 있는가
    const fieldsHave = (page, texts) => page.evaluate((list) => {
        const vals = [...document.querySelectorAll('input, textarea')].map((el) => String(el.value || ''));
        return list.filter((x) => typeof x === 'string' && x.length > 0).some((x) => vals.some((v) => v.includes(x)));
    }, texts).catch(() => null);
    const noticeHas = (page, text) => page.evaluate((x) => { const el = document.getElementById('eonLoginNotice'); return !!el && el.textContent.includes(x); }, text).catch(() => null);
    const shownAs = (page, id, want) => page.evaluate(([i, w]) => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display === w; }, [id, want]).catch(() => null);
    const valueOf = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return el ? String(el.value || '') : null; }, id).catch(() => null);
    const textOf = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return el ? String(el.textContent || '') : null; }, id).catch(() => null);
    // 칸에 값을 적는다(사람이 적은 것처럼 input 알림도 낸다). 돌려주는 값: 적었는가
    const typeInto = (page, id, value) => page.evaluate(([i, v]) => {
        const el = document.getElementById(i);
        if (!el) return false;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value === v;
    }, [id, value]).catch(() => false);
    const alive = (page) => page.evaluate(() => window.__zzAlive === 1).catch(() => false);
    const markAlive = (page) => page.evaluate(() => { window.__zzAlive = 1; }).catch(() => {});
    const nameOf = (cx, acct) => cx.seen.names[acct] || api.seenNames()[acct] || '';
    const identity = (cx, acct) => [nameOf(cx, acct), vault.get('EMAIL_' + acct)];
    const goto = (page, url) => page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

    // 인증 응답(target — 기본 my_site_access)을 붙잡은 채로 go() 를 하고, 그동안의 화면을 본다. 풀 때는 release()
    async function held(cx, page, go, acct, target = 'my_site_access') {
        let reached;
        let release;
        const reachedP = new Promise((r) => { reached = r; });
        const releasedP = new Promise((r) => { release = r; });
        cx.hooks[target] = { after: async () => { reached(true); await releasedP; return null; } };
        const from = cx.records.length;
        const nav = Promise.resolve().then(go).catch(() => null);
        const got = await Promise.race([reachedP, sleep(15000).then(() => false)]);
        await sleep(1300);
        const during = {
            reached: !!got,
            from,
            state: (await stateOf(page)).state,
            shown: await bodyHas(page, identity(cx, acct)),
            inFields: await fieldsHave(page, identity(cx, acct)),
            business: attempts(cx, from).length,
            businessOfAcct: attemptsOf(cx, from, acct).length,
            path: pathOf(page),
            hidden: await hidden(page),
        };
        during.release = async () => {
            release();
            delete cx.hooks[target];
            await nav;
            await settled(page, 30000);
            await sleep(900);
        };
        return during;
    }
    const heldDone = async (cx, page, go, acct, target) => { const d = await held(cx, page, go, acct, target); await d.release(); return d; };

    // 저장된 로그인(브라우저의 eon_auth_v1)을 메모리에 들고 있다가 화면마다 다시 넣는다(디스크·결과에 쓰지 않는다)
    const grabStored = (page) => page.evaluate(() => window.__b3a.rawGet.call(localStorage, 'eon_auth_v1')).catch(() => null);
    const putStored = async (page, raw) => {
        await page.goto(ON() + '/__b3a/blank');
        await page.evaluate((v) => {
            for (const k of Object.keys(localStorage)) if (k.indexOf('eon_auth_v1') === 0 || k.indexOf('iontoefl_') === 0) localStorage.removeItem(k);
            if (v) localStorage.setItem('eon_auth_v1', v);
        }, raw);
    };

    // ---- C1. 로그인 전: 회원 화면은 지금처럼 로그인 화면으로, 업무 요청 0 ----
    await runCase('C1', '로그인 전: 회원 화면 7개 직접 진입 → 로그인 화면으로, 업무 요청의 시도 0', async (cx, ck) => {
        const page = await cx.page();
        for (const m of MEMBER()) {
            await goto(page, ON() + '/' + m.file + m.q);
            ck(`${m.file}: 로그인 화면으로 감`, await until(page, "location.pathname.endsWith('/login.html')", 8000));
        }
        ck('업무 요청을 시도한 것 0', attempts(cx).length === 0);
        ck('인증 요청 0(저장된 로그인이 없다)', AUTH.every((t) => count(cx, t) === 0));
    });

    // ---- C2. A: 회원 화면마다 직접 진입 — 확인 전 표시 0·업무 요청의 시도 0, 확인 뒤에만 ----
    await runCase('C2', 'A 로그인: 회원 화면 7개 직접 진입 — 확인 전 회원 정보 0·업무 요청의 시도 0, 확인 뒤에만', async (cx, ck) => {
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A');
        ck('A 로 로그인됨', r.message === 'success' && r.moved);
        for (const m of MEMBER()) {
            const d = await heldDone(cx, page, () => page.goto(ON() + '/' + m.file + m.q, { waitUntil: 'domcontentloaded' }), 'A');
            ck(`${m.file}: 확인 응답을 붙잡음(상태 restoring)`, d.reached && d.state === 'restoring' ? true : (d.reached ? false : null));
            ck(`${m.file}: 확인 전에 회원 정보가 보이지 않음(글자·입력 칸)`, d.shown === null ? null : (d.shown === false && d.inFields === false));
            ck(`${m.file}: 확인 전에 업무 요청을 시도하지 않음`, d.business === 0);
            ck(`${m.file}: 확인 전에 다른 화면으로 가지 않음`, d.path.endsWith('/' + m.file));
            ck(`${m.file}: 확인된 뒤 그 화면에 남음(로그인 화면으로 가지 않음)`, onPage(page, m.file) && (await stateOf(page)).state === 'signed_in');
            if (m.reads) ck(`${m.file}: 확인된 뒤에 그 화면의 조회를 시도함`, attempts(cx, d.from).length >= 1);
            if (m.closed) {
                ck(`${m.file}: 닫아 둔 기능의 임시 안내`, await noticeHas(page, CLOSED_TEXT));
                ck(`${m.file}: 닫아 둔 기능의 화면이 업무 요청을 시도하지 않음`, attempts(cx, d.from).length === 0);
            }
        }
        ck('업무 요청(시도)의 자격은 전부 공개 키(회원 자격은 인증 모듈의 요청에만)', attempts(cx).every((x) => x.credential === 'anon'));
        ck('B 의 값을 조건으로 한 시도 0', attemptsOf(cx, 0, 'B').length === 0);
    });

    // ---- C3. 새로 고침·뒤로 가기 ----
    await runCase('C3', 'A: 대시보드 새로 고침·뒤로 가기 — 다시 확인하기 전 회원 정보 0·업무 요청의 시도 0', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        await goto(page, ON() + '/my-dashboard.html');
        await settled(page, 30000);
        await sleep(900);
        ck('대시보드에 A 의 정보가 보임', await bodyHas(page, identity(cx, 'A')));
        const d1 = await heldDone(cx, page, () => page.reload({ waitUntil: 'domcontentloaded' }), 'A');
        ck('새로 고침: 확인 응답을 붙잡음', d1.reached ? true : null);
        ck('새로 고침: 확인 전에 회원 정보가 보이지 않음·업무 요청의 시도 0', d1.shown === false && d1.business === 0);
        ck('새로 고침: 확인된 뒤 A 의 정보가 보임', await bodyHas(page, identity(cx, 'A')));
        await goto(page, ON() + '/about.html');
        await settled(page, 30000);
        const shows0 = cx.events.length;
        const d2 = await heldDone(cx, page, () => page.goBack({ waitUntil: 'commit' }), 'A');
        cx.notes = { backRevived: cx.events.slice(shows0).includes('pageshow-persisted') };      // 보관된 화면이 되살아났는가(참고 — 되살아난 화면의 판정은 C3b)
        ck('뒤로 가기: 다시 확인하는 요청이 나감(응답을 붙잡음)', d2.reached ? true : null);
        ck('뒤로 가기: 확인 전에 회원 정보가 보이지 않음·업무 요청의 시도 0', d2.shown === false && d2.business === 0);
        ck('뒤로 가기: 확인된 뒤 대시보드에 A 의 정보가 보임', onPage(page, 'my-dashboard.html') && (await bodyHas(page, identity(cx, 'A'))));
    });

    // ---- C3b. 뒤로 가기로 되살아난(보관된) 화면 — 브라우저가 되살리지 않으면 재지 못한다(필수 아님, 3A 의 9b 와 같다) ----
    await runCase('C3b', 'A: 뒤로 가기로 되살아난 회원 화면 — 다시 확인하는 동안 가려 두고, 같은 사람이면 다시 받지 않고 그대로', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        // 두 화면(대시보드·글쓰기) × 떠나는 길(빈 화면·다른 화면)로 해 본다 — 브라우저가 화면을 되살리는지는 화면과 길에 따라 다르다
        const tries = [];
        for (const [file, q, away] of [['my-dashboard.html', '', '/__b3a/blank'], ['my-dashboard.html', '', '/about.html'], ['write.html', '?board=reviews', '/__b3a/blank'], ['my-profile.html', '', '/__b3a/blank']]) {
            await goto(page, ON() + '/' + file + q);
            await settled(page, 30000);
            await sleep(700);
            await markAlive(page);
            await goto(page, ON() + away);
            await sleep(500);
            const shows0 = cx.events.length;
            const d = await held(cx, page, () => page.goBack({ waitUntil: 'commit' }), 'A');
            const revived = cx.events.slice(shows0).includes('pageshow-persisted');
            await d.release();
            const reasons = revived ? [] : await page.evaluate(() => { try { const n = performance.getEntriesByType('navigation')[0]; const r = n && n.notRestoredReasons; return r && r.reasons ? r.reasons.map((x) => String(x.reason || x)) : []; } catch (e) { return []; } }).catch(() => []);
            tries.push({ file, away: away === '/about.html' ? 'other-page' : 'blank', revived, reasons: [...new Set(reasons.map((x) => (NOT_RESTORED.includes(x) ? x : 'other')))] });
            if (revived) {
                ck(`${file}: 되살아난 화면이 다시 확인하는 요청을 보냄(응답을 붙잡음)`, d.reached ? true : null);
                ck(`${file}: 되살아난 뒤 다시 확인하는 동안 가려져 있고 회원 정보가 보이지 않음·업무 요청의 시도 0`, d.reached ? (d.hidden === true && d.shown === false && d.business === 0) : null);
                ck(`${file}: 같은 사람으로 확인된 뒤 다시 받지 않고 그대로 보임`, (await alive(page)) && (await hidden(page)) === false && onPage(page, file) && (await stateOf(page)).state === 'signed_in');
            }
        }
        cx.notes = { backTries: tries };       // 화면의 파일 이름·떠난 길·되살아났는가·브라우저가 준 "되살리지 않은 이유"(정해 둔 이름만)
        ck('브라우저가 회원 화면을 한 번이라도 되살림(아니면 다시 불러온 것 — 재지 못함)', tries.some((x) => x.revived) ? true : null);
    }, { required: false });

    // ---- C4. 회원 화면 7개 × (B·차단·탈퇴 처리 중·대응 없음) ----
    await runCase('C4', '회원 화면 7개 × 계정 상태: B 는 B 로 확인, 차단·탈퇴 처리 중·대응 없음은 화면마다 로그인 화면으로·업무 요청의 시도 0', async (cx, ck) => {
        const page = await cx.page();
        const rb = await doLogin(cx, page, 'B');
        ck('B: 로그인됨', rb.message === 'success' && rb.moved);
        for (const m of MEMBER()) {
            const from = cx.records.length;
            await goto(page, ON() + '/' + m.file + m.q);
            await settled(page, 30000);
            await sleep(900);
            // B 가 A 의 신청서 번호로 연 신청서 상세는 지금처럼 "본인 것이 아님"으로 내 신청서 화면으로 보낸다
            const stayed = onPage(page, m.file) || (m.file === 'application-detail.html' && onPage(page, 'my-application.html'));
            ck(`B · ${m.file}: 로그인 화면으로 가지 않고 B 로 확인됨`, stayed && (await stateOf(page)).state === 'signed_in');
            ck(`B · ${m.file}: A 의 이메일이 보이지 않음`, (await bodyHas(page, [vault.get('EMAIL_A')])) === false);
            ck(`B · ${m.file}: A 의 값을 조건으로 한 시도 0`, attemptsOf(cx, from, 'A').length === 0);
        }
        for (const acct of ['BLK', 'WD', 'N']) {
            const cx2 = await newCx('C4-' + acct);
            try {
                const p = await cx2.page();
                const r = await doLogin(cx2, p, acct);
                ck(`${acct}: 로그인되지 않음`, r.message !== 'success' && !r.moved);
                const from = cx2.records.length;
                for (const m of MEMBER()) {
                    await goto(p, ON() + '/' + m.file + m.q);
                    ck(`${acct} · ${m.file}: 로그인 화면으로 감`, await until(p, "location.pathname.endsWith('/login.html')", 25000));
                }
                ck(`${acct}: 회원 화면 7개에서 업무 요청을 시도하지 않음`, attempts(cx2, from).length === 0);
            } finally {
                cx.records.push(...cx2.records);
                await cx2.context.close().catch(() => {});
            }
        }
    });

    // ---- C5. 끝난 로그인 기록(서버에서 끝냄): 회원 화면 7개, 그리고 만료된 값이 남은 방문자 ----
    await runCase('C5', '끝난 로그인 기록(서버에서 끝냄): 회원 화면 7개는 로그인 화면으로 / 공개·갈래 화면은 그 확인을 기다리지 않고 방문자 그대로', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        const sid = cx.seen.lastLoginSid;
        const stored = await grabStored(page);
        ck('저장된 로그인을 메모리에 잡아 둠(화면마다 다시 넣으려고 — 결과·디스크에 쓰지 않는다)', typeof stored === 'string' && stored.length > 0 ? true : null);
        await pause('expire-session', { sid }, { needsRevert: true });
        try {
            // 회원 화면 7개: 화면마다 끝난 로그인이 저장된 상태에서 연다
            for (const m of MEMBER()) {
                await putStored(page, stored);
                const from = cx.records.length;
                await goto(page, ON() + '/' + m.file + m.q);
                ck(`${m.file}: 로그인 화면으로 감`, await until(page, "location.pathname.endsWith('/login.html')", 40000));
                ck(`${m.file}: 업무 요청을 시도하지 않음·회원 정보가 보이지 않음`, attempts(cx, from).length === 0 && (await bodyHas(page, identity(cx, 'A'))) === false);
            }
            // 만료된 값이 남은 방문자: 공개·갈래 화면. 확인 응답(my_profile)을 붙잡아 둔 동안 공개 부분이 열리는가
            const publics = [
                { file: 'notice.html', body: true }, { file: 'reviews.html', body: true }, { file: 'application.html', body: true },
                { file: 'survey.html', body: true, field: 'svName' }, { file: 'application-form.html', body: true, closed: true }, { file: 'book-request.html', body: false, closed: true },
                { file: 'index.html', body: false },        // index.html 에는 화면을 열 때 나가는 공개 조회가 없다
            ];
            for (const p of publics) {
                await putStored(page, stored);
                const d = await held(cx, page, () => page.goto(ON() + '/' + p.file, { waitUntil: 'domcontentloaded' }), 'A', 'my_profile');
                ck(`방문자(끝난 값) · ${p.file}: 확인 응답을 붙잡음`, d.reached && d.state === 'restoring' ? true : (d.reached ? false : null));
                if (p.body) ck(`방문자(끝난 값) · ${p.file}: 붙잡은 동안 공개 부분의 조회를 시도함(확인을 기다리지 않음)`, d.reached ? d.business >= 1 : null);
                if (p.field) ck(`방문자(끝난 값) · ${p.file}: 붙잡은 동안 입력 칸이 열려 있음`, d.reached ? (await valueOf(page, p.field)) !== null : null);
                ck(`방문자(끝난 값) · ${p.file}: 붙잡은 동안 그 화면에 있고 회원 정보·A 의 값이 조건인 시도 0`, d.path.endsWith('/' + p.file) && d.shown === false && d.inFields === false && d.businessOfAcct === 0);
                await d.release();
                const st = await stateOf(page);
                ck(`방문자(끝난 값) · ${p.file}: 끝난 뒤에도 그 화면(로그인 화면으로 가지 않음)·signed_in 아님`, onPage(page, p.file) && st.state !== 'signed_in');
                if (p.closed) ck(`방문자(끝난 값) · ${p.file}: 닫아 둔 갈래의 임시 안내`, await noticeHas(page, CLOSED_TEXT));
                ck(`방문자(끝난 값) · ${p.file}: 쓰기·부분 검색(계정 조회)의 시도 0`, attempts(cx, d.from).filter((x) => x.business === 'write' || x.business === 'partial-search').length === 0);
            }
        } finally {
            const back = await pause('restore-session', { sid }, { revertOf: 'expire-session' });
            ck('원복 확인: 로그인 기록을 되돌렸다는 답', !!back && back.reverted === true ? true : null);
        }
    });

    // ---- C6. 로그인 뒤 돌아갈 주소 ----
    await runCase('C6', '로그인 뒤 돌아갈 주소: 허용 목록이면 그 주소로, 아니면 index.html', async (cx, ck) => {
        const go = async (label, redirect, wantFile, wantSearchHash) => {
            const cx2 = await newCx('C6-' + label);
            try {
                const p = await cx2.page();
                cx2.account = 'A';
                await p.goto(ON() + '/login.html?redirect=' + encodeURIComponent(redirect), { waitUntil: 'domcontentloaded' });
                await settled(p);
                await p.fill('#email', vault.get('EMAIL_A'));
                await p.fill('#password', vault.get('PW'));
                await p.click('#loginBtn');
                const moved = await until(p, "!location.pathname.endsWith('/login.html')", 25000);
                await sleep(700);
                const where = await p.evaluate(() => location.pathname.split('/').pop() + location.search + location.hash).catch(() => '');
                ck(`${label}: ${wantFile} 로 감`, moved && where === wantFile + wantSearchHash);
            } finally {
                cx.records.push(...cx2.records);
                await cx2.context.close().catch(() => {});
            }
        };
        await go('신청서 상세', '/application-detail.html?id=' + synth().appA + '#step2', 'application-detail.html', '?id=' + synth().appA + '#step2');
        await go('내 정보', 'my-profile.html', 'my-profile.html', '');
        await go('목록 밖(대시보드)', 'my-dashboard.html', 'index.html', '');
        await go('목록 밖(탈퇴)', 'withdraw.html', 'index.html', '');
        await go('목록 밖(관리자 화면)', 'admin-dashboard.html', 'index.html', '');
        await go('다른 출처', 'https://example.invalid/my-profile.html', 'index.html', '');
    });

    // ---- C7. 두 탭: 확인된 사람이 달라짐 — 적던 값과 늦게 도착한 응답 ----
    await runCase('C7', '두 탭: A 의 화면을 둔 채 다른 탭이 B 로 로그인 — A 의 화면·A 가 적던 값이 B 에게 넘어가지 않고, 붙잡아 둔 A 의 늦은 응답이 B 의 화면·적던 값을 덮지 않음', async (cx, ck) => {
        const p0 = await cx.page();
        await doLogin(cx, p0, 'A');
        // (1) 대시보드: A 의 화면
        await goto(p0, ON() + '/my-dashboard.html');
        await settled(p0, 30000);
        await sleep(900);
        ck('대시보드: A 의 화면', await bodyHas(p0, identity(cx, 'A')));
        // (2) 신청서 화면(회원 갈래): A 의 값이 조건인 업무 응답 하나를 붙잡아 둔다
        let reachedA;
        let releaseA;
        const reachedP = new Promise((r) => { reachedA = r; });
        const releasedP = new Promise((r) => { releaseA = r; });
        let heldOnce = false;
        cx.hooks.business = { before: async (rec) => { if (rec.account === 'A' && !heldOnce) { heldOnce = true; reachedA(true); await releasedP; } } };
        const p1 = await cx.page();
        await goto(p1, ON() + '/application-form.html');
        const got = await Promise.race([reachedP, sleep(20000).then(() => false)]);
        await sleep(1500);
        ck('신청서 화면: A 의 업무 응답 하나를 붙잡음', got ? true : null);
        const draftA = 'zzA 가 적던 값';
        const draftB = 'zzB 가 적는 값';
        ck('신청서 화면: A 가 값을 적어 둠', (await typeInto(p1, 'accountHolderInput', draftA)) ? true : null);
        // 다른 탭이 B 로 로그인한다(앞의 A 로그인은 이 로그인만 끝난다)
        const p2 = await cx.page();
        const rb = await doLogin(cx, p2, 'B');
        ck('다른 탭: B 로 로그인됨', rb.message === 'success' && rb.moved);
        const mark = cx.records.length;          // 여기부터는 B 다(그 앞의 로그인 화면은 아직 A 로 확인된 채 열렸다)
        await sleep(2500);
        await settled(p0, 30000);
        await settled(p1, 30000);
        await until(p1, "!!document.getElementById('applicantName') && document.getElementById('applicantName').value.length > 0", 15000);
        await sleep(900);
        const a = identity(cx, 'A');
        ck('대시보드: A 의 정보가 보이지 않음', (await bodyHas(p0, a)) === false);
        ck('대시보드: 다시 받아 B 의 화면이 됨(또는 가려짐)', (await bodyHas(p0, identity(cx, 'B'))) === true || (await hidden(p0)) === true);
        // (나) A 가 쓰던 값이 B 에게 넘어가지 않는가
        ck('신청서 화면: 다시 받아 B 의 화면이 됨(계정 칸이 B 의 이름)', (await valueOf(p1, 'applicantName')) === nameOf(cx, 'B'));
        ck('(나) 신청서 화면: A 가 적던 값·A 의 정보가 B 의 화면에 없음(입력 칸·글자)', (await fieldsHave(p1, [draftA].concat(a))) === false && (await bodyHas(p1, a)) === false);
        // A 의 초안은 그 탭에서 사라졌다 — 이것은 "적던 값이 그대로"가 아니다. 따로 적는다(판정에 넣지 않는다)
        cx.notes = { draftOfAGoneFromThatTab: (await valueOf(p1, 'accountHolderInput')) !== draftA };
        // (가) B 가 적는 중에, 붙잡아 둔 A 의 응답이 늦게 도착한다
        ck('신청서 화면: B 가 값을 적어 둠', (await typeInto(p1, 'accountHolderInput', draftB)) ? true : null);
        await markAlive(p1);
        releaseA();
        delete cx.hooks.business;
        await sleep(2500);
        ck('(가) 늦은 응답 뒤: B 가 적던 값이 그대로', (await valueOf(p1, 'accountHolderInput')) === draftB);
        ck('(가) 늦은 응답 뒤: B 의 화면 그대로(계정 칸이 B 의 이름, 다시 받지 않음, 가려지지 않음)', (await valueOf(p1, 'applicantName')) === nameOf(cx, 'B') && (await alive(p1)) && (await hidden(p1)) === false);
        ck('(가) 늦은 응답 뒤: A 의 정보·A 가 적던 값이 B 의 화면에 없음(글자·입력 칸)', (await bodyHas(p1, a)) === false && (await fieldsHave(p1, a.concat([draftA]))) === false);
        ck('B 로 바뀐 뒤 A 의 값을 조건으로 한 시도 0(어느 탭에서도)', attemptsOf(cx, mark, 'A').length === 0);
        ck('다른 탭: B 의 표시 그대로', (await stateOf(p2)).state === 'signed_in');
    });

    // ---- C8. 옛 값이 있는 브라우저 ----
    await runCase('C8', '옛 값이 있는 브라우저: 회원 화면이 옛 값을 믿지 않음(로그인 화면으로·업무 요청의 시도 0)', async (cx, ck) => {
        const page = await cx.page();
        await seedStore(cx, page, ON(), SEEDS.old);
        const from = cx.records.length;
        for (const m of MEMBER()) {
            await goto(page, ON() + '/' + m.file + m.q);
            ck(`${m.file}: 로그인 화면으로 감`, await until(page, "location.pathname.endsWith('/login.html')", 8000));
        }
        ck('업무 요청을 시도하지 않음(옛 값이 조건인 조회 0)', attempts(cx, from).length === 0);
        await goto(page, ON() + '/notice.html');
        await settled(page);
        await sleep(700);
        ck('공개 화면에 옛 값의 이름이 보이지 않음', (await bodyHas(page, ['옛학생'])) === false);
        ck('옛 값이 글자 그대로 남음(지우지 않는다)', await page.evaluate((s) => Object.entries(s).every(([k, v]) => window.__b3a.rawGet.call(localStorage, k) === v), SEEDS.old));
    });

    // ---- C9. 방문자 갈래가 그대로 도는가(제출은 하지 않는다) ----
    await runCase('C9', '방문자(저장된 로그인 없음): 공지·후기·공부인증·신청 게시판·비회원 설문이 로그인을 요구하지 않음(제출 없음)', async (cx, ck) => {
        const page = await cx.page();
        for (const file of ['notice.html', 'reviews.html', 'reviews-book.html', 'study-certify.html', 'application.html', 'survey.html', 'my-application.html', 'about.html', 'faq.html', 'pricing.html', 'programs.html']) {
            const from = cx.records.length;
            await goto(page, ON() + '/' + file);
            await settled(page);
            await sleep(900);
            ck(`${file}: 그 화면에 남음(로그인 화면으로 가지 않음)`, onPage(page, file));
            if (['notice.html', 'reviews.html', 'reviews-book.html', 'study-certify.html', 'application.html', 'survey.html'].includes(file)) {
                ck(`${file}: 공개 본문의 조회를 시도함`, attempts(cx, from).length >= 1);
            }
            if (file === 'survey.html') ck('survey.html: 비회원 설문의 입력 칸이 열림(이름 칸은 비어 있음)', (await valueOf(page, 'svName')) === '');
        }
        ck('업무 쓰기를 시도한 것 0(제출하지 않았다)', attempts(cx).filter((x) => x.business === 'write').length === 0);
        ck('합성 계정의 값을 조건으로 한 시도 0', attempts(cx).every((x) => x.account === 'none'));
    });

    // ---- C10. 닫아 둔 기능 ----
    await runCase('C10', '닫아 둔 기능: 가입·아이디 찾기·비밀번호 찾기·가입을 겸한 신청·책 신청 — 임시 안내, 계정 요청의 시도 0', async (cx, ck) => {
        const page = await cx.page();
        for (const file of ['register.html', 'find-id.html', 'find-password.html', 'application-form.html', 'book-request.html']) {
            const from = cx.records.length;
            await goto(page, ON() + '/' + file);
            await settled(page);
            await sleep(900);
            ck(`${file}: 그 화면에 남음`, onPage(page, file));
            ck(`${file}: 임시 안내가 보임`, await noticeHas(page, CLOSED_TEXT));
            if (file === 'find-id.html') {
                await typeInto(page, 'name', '합성');
                await typeInto(page, 'phone', '010-0000-0000');
                await page.click('#findBtn').catch(() => {});
                await sleep(700);
            }
            if (file === 'register.html') {
                await typeInto(page, 'nickname', '합성닉');
                await sleep(1200);
            }
            if (file === 'application-form.html') {
                // 신청 화면은 공개 안내(약관 등)를 읽는다 — 닫힌 갈래의 요청(계정 조회의 부분 검색·저장)은 시도 자체가 없어야 한다
                ck(`${file}: 계정 조회(부분 검색)·저장을 시도하지 않음`, attempts(cx, from).filter((x) => x.business === 'write' || x.business === 'partial-search').length === 0);
            } else {
                ck(`${file}: 업무 요청을 시도하지 않음(회원 조회·계정 요청 0 — 가짜 응답을 받았더라도 시도 자체가 실패다)`, attempts(cx, from).length === 0);
            }
        }
        ck('업무 쓰기를 시도한 것 0', attempts(cx).filter((x) => x.business === 'write').length === 0);
        ck('로그인 값을 쓰거나 지운 것 0', ['iontoefl_user', 'iontoefl_login_time'].every((b) => ['setItem', 'removeItem'].every((op) => !((cx.store[b] || {})[op]))));
    });

    // ---- C11. 켜진 화면인데 인증 모듈 파일을 받지 못함 ----
    await runCase('C11', '인증 모듈 파일을 받지 못한 켜진 화면: 꺼짐이 아니라 닫음(옛 값을 믿지 않음)', async (cx, ck) => {
        const page = await cx.page();
        await seedStore(cx, page, ON(), SEEDS.old);
        cx.dropAuthModule = true;
        const from = cx.records.length;
        await goto(page, ON() + '/my-dashboard.html');
        await sleep(1500);
        ck('인증 모듈이 없음(시험이 그 파일을 막음)', await page.evaluate(() => typeof window.EonAuth === 'undefined' && window.EonLogin.on() === true && window.EonLogin.missing() === true).catch(() => null));
        ck('회원 화면: 그 화면에 남고 임시 안내', onPage(page, 'my-dashboard.html') && (await noticeHas(page, MISSING_TEXT)));
        ck('회원 화면: 옛 값의 이름이 보이지 않음·업무 요청의 시도 0', (await bodyHas(page, ['옛학생', 'old@zz.invalid'])) === false && attempts(cx, from).length === 0);
        await goto(page, ON() + '/notice.html');
        await sleep(1500);
        ck('공개 화면: 본문은 그대로(조회를 시도함), 옛 값의 이름은 보이지 않음', onPage(page, 'notice.html') && attempts(cx, from).length >= 1 && (await bodyHas(page, ['옛학생'])) === false);
        ck('인증 요청 0', AUTH.every((t) => count(cx, t) === 0));
    });

    // ---- C12. 3A 의 제약(로그아웃 "모름")의 지금 동작 — 다시 잰다 ----
    await runCase('C12', '제약 다시 재기: 대시보드에서 로그아웃의 답을 받지 못함 → 끝낸 것으로 하지 않고, 다시 받으면 로그인된 채', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        await goto(page, ON() + '/my-dashboard.html');
        await settled(page, 30000);
        await sleep(900);
        cx.hooks.logout = { before: async () => 'abort' };
        const dialogs0 = cx.dialogs.length;
        await page.click('#logoutBtn').catch(() => {});
        await sleep(3000);
        delete cx.hooks.logout;
        await settled(page, 30000);
        await sleep(900);
        const st = await stateOf(page);
        ck('안내: 로그아웃을 확인하지 못했습니다', cx.dialogs.slice(dialogs0).includes('logoutUnknown'));
        ck('로그아웃됐다고 안내하지 않음·index.html 로 가지 않음', !cx.dialogs.slice(dialogs0).includes('logoutDone') && onPage(page, 'my-dashboard.html'));
        ck('저장된 로그인은 남음(끝났다는 증거가 없다)', await page.evaluate(() => window.__b3a.rawGet.call(localStorage, 'eon_auth_v1') !== null).catch(() => null));
        cx.notes = { stateAfterReload: st.state, reasonAfterReload: st.reason };       // 제약 3: 다시 받으면 다시 확인돼 로그인된 채다(풀리지 않았다)
        ck('다시 받은 뒤의 상태가 signed_in(제약 그대로 — 화면이 스스로 풀 길이 없다)', st.state === 'signed_in');
    });

    // ---- C13. 갈래 화면의 회원 갈래(A): 공개 부분은 확인을 기다리지 않고, 회원에게만 붙는 것은 확인 뒤에 ----
    await runCase('C13', '갈래 화면 4개의 회원 갈래(A): 인증 응답을 붙잡은 동안 공개 부분이 열리고, 회원에게만 붙는 것은 확인 뒤에(적은 칸은 덮지 않음)', async (cx, ck) => {
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A');
        ck('A 로 로그인됨', r.message === 'success' && r.moved);
        const nameA = nameOf(cx, 'A');
        {   // 비회원 설문
            const d = await held(cx, page, () => page.goto(ON() + '/survey.html', { waitUntil: 'domcontentloaded' }), 'A');
            ck('survey: 붙잡은 동안 공개 부분의 조회를 시도하고 입력 칸이 열림', d.reached ? (d.business >= 1 && (await valueOf(page, 'svName')) === '') : null);
            ck('survey: 붙잡은 동안 회원 정보·A 의 값이 조건인 시도 0', d.shown === false && d.inFields === false && d.businessOfAcct === 0);
            const typedPhone = '01099990000';
            ck('survey: 붙잡은 동안 방문자가 번호 칸에 적음', (await typeInto(page, 'svPhone', typedPhone)) ? true : null);
            await d.release();
            await sleep(600);
            ck('survey: 확인된 뒤 비어 있던 이름 칸이 A 의 이름으로 채워짐', (await valueOf(page, 'svName')) === nameA);
            ck('survey: 확인 전에 이미 적은 칸은 덮지 않음', (await valueOf(page, 'svPhone')) === typedPhone);
            ck('survey: 설문 화면 그대로(로그인 화면·다른 화면으로 가지 않음)', onPage(page, 'survey.html'));
        }
        {   // 신청서
            const d = await held(cx, page, () => page.goto(ON() + '/application-form.html', { waitUntil: 'domcontentloaded' }), 'A');
            ck('application-form: 붙잡은 동안 공개 부분의 조회(약관 등)를 시도함', d.reached ? d.business >= 1 : null);
            ck('application-form: 붙잡은 동안 회원 정보·A 의 값이 조건인 시도 0', d.shown === false && d.inFields === false && d.businessOfAcct === 0);
            await d.release();
            await until(page, "!!document.getElementById('applicantName') && document.getElementById('applicantName').value.length > 0", 10000);
            ck('application-form: 확인된 뒤 계정 칸이 A 의 이름·닫힘 안내 없음', (await valueOf(page, 'applicantName')) === nameA && (await noticeHas(page, CLOSED_TEXT)) === false);
            ck('application-form: 확인된 뒤 기존 신청 확인(A 의 값이 조건)을 시도함', attemptsOf(cx, d.from, 'A').length >= 1);
        }
        {   // 책 신청
            const d = await held(cx, page, () => page.goto(ON() + '/book-request.html', { waitUntil: 'domcontentloaded' }), 'A');
            ck('book-request: 붙잡은 동안 화면의 공개 부분(안내 글)이 보이고 신청 폼은 아직 열리지 않음', d.reached ? ((await page.evaluate(() => (document.body.innerText || '').trim().length > 80).catch(() => null)) === true && (await shownAs(page, 'formWrap', 'block')) === false) : null);
            ck('book-request: 붙잡은 동안 회원 정보·A 의 값이 조건인 시도 0', d.shown === false && d.businessOfAcct === 0);
            await d.release();
            await until(page, "!!document.getElementById('summaryName') && document.getElementById('summaryName').textContent.trim().length > 1", 10000);
            ck('book-request: 확인된 뒤 회원의 신청 폼(요약에 A 의 이름)·닫힘 안내 없음', (await textOf(page, 'summaryName')) === nameA && (await shownAs(page, 'formWrap', 'block')) === true && (await noticeHas(page, CLOSED_TEXT)) === false);
            ck('book-request: 확인된 뒤 기존 신청 확인(A 의 값이 조건)을 시도함', attemptsOf(cx, d.from, 'A').length >= 1);
        }
        {   // 신청 게시판
            const badge = () => page.evaluate((id) => !!document.getElementById('menu-' + id), synth().appA).catch(() => null);
            const d = await held(cx, page, () => page.goto(ON() + '/application.html', { waitUntil: 'domcontentloaded' }), 'A');
            ck('application: 붙잡은 동안 목록(공개 부분)의 조회를 시도함', d.reached ? d.business >= 1 : null);
            ck('application: 붙잡은 동안 "내 신청서" 표시가 없음', d.reached ? (await badge()) === false : null);
            const listTries = attempts(cx, d.from).filter((x) => x.business === 'unconditioned').length;
            await d.release();
            ck('application: 확인된 뒤 "내 신청서" 표시가 붙음', (await badge()) === true);
            ck('application: 표시를 붙이려고 목록을 다시 조회하지 않음(이미 받은 것을 다시 그림)', attempts(cx, d.from).filter((x) => x.business === 'unconditioned').length === listTries);
        }
        ck('업무 쓰기를 시도한 것 0(제출하지 않았다)', attempts(cx).filter((x) => x.business === 'write').length === 0);
    });

    // ---- C14. 같은 사람을 다시 확인: 적던 값이 그대로 ----
    await runCase('C14', '같은 사람의 재확인: 글쓰기 화면에서 적던 값이 그대로이고 다시 받지 않음(다시 확인하는 동안은 가려 둠)', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        await goto(page, ON() + '/write.html?board=reviews');
        await settled(page, 30000);
        await sleep(900);
        const typed = 'zzA 가 적던 제목';
        ck('A 가 제목 칸에 적음', (await typeInto(page, 'writeSubject', typed)) ? true : null);
        await markAlive(page);
        const d = await held(cx, page, () => page.evaluate(() => { window.EonAuth.recheck(); }), 'A');
        ck('다시 확인하는 요청을 붙잡음', d.reached && d.state === 'restoring' ? true : (d.reached ? false : null));
        ck('다시 확인하는 동안 화면을 가려 둠', d.reached ? d.hidden === true : null);
        await d.release();
        ck('확인된 뒤: 같은 사람 — 다시 받지 않음·가려지지 않음', (await alive(page)) && (await hidden(page)) === false && (await stateOf(page)).state === 'signed_in');
        ck('확인된 뒤: 적던 값이 그대로', (await valueOf(page, 'writeSubject')) === typed);
    });

    // ---- C15. 공개 화면의 회원 표시(A) ----
    await runCase('C15', '공개 화면의 회원 표시(A): 글쓰기·본인 글의 수정/삭제 버튼은 확인 뒤에만, 관리자 버튼은 A 에게 보이지 않음', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        const post = '?id=' + synth().post;
        for (const [file, q, id, want] of [['reviews.html', '', 'writeBtn', 'block'], ['reviews.html', post, 'postActions', 'flex'], ['reviews-book.html', post, 'postActions', 'flex'], ['study-certify.html', post, 'postActions', 'flex']]) {
            const d = await held(cx, page, () => page.goto(ON() + '/' + file + q, { waitUntil: 'domcontentloaded' }), 'A');
            await sleep(600);
            ck(`${file}${q ? '(글 한 편)' : ''}: 붙잡은 동안 본문의 조회를 시도하고(기다리지 않음) 회원 버튼은 보이지 않음`, d.reached ? (d.business >= 1 && (await shownAs(page, id, want)) === false) : null);
            await d.release();
            ck(`${file}${q ? '(글 한 편)' : ''}: 확인된 뒤 회원 버튼(${id})이 보임`, (await shownAs(page, id, want)) === true);
        }
        for (const [file, q, id, want] of [['notice.html', '', 'writeBtn', 'block'], ['notice.html', post, 'adminActions', 'flex'], ['materials.html', post, 'adminActions', 'flex']]) {
            await goto(page, ON() + '/' + file + q);
            await settled(page, 30000);
            await sleep(900);
            ck(`${file}${q ? '(글 한 편)' : ''}: 관리자 버튼(${id})은 A 에게 보이지 않음`, onPage(page, file) && (await shownAs(page, id, want)) === false);
        }
    });

    // ---- C16. 공개 화면의 관리자 표시(GM·aal2 — 저장된 로그인) ----
    await runCase('C16', '공개 화면의 관리자 표시(GM·aal2): 공지·후기·학습 자료의 관리자 버튼은 확인 뒤에만', async (cx, ck) => {
        const got = await pause('provide-session', { account: 'GM', aal: 'aal2' }, { leaves: 'GM' });
        const session = got && got.session;
        const origin = checkProvidedSession(session, { email: vault.get('EMAIL_GM'), aal: 'aal2' }, Date.now());
        if (!origin.ok) { cx.notes = { sessionRefused: origin.why }; ck('받은 로그인 상태의 출처 확인(어긋나서 넣지 않음)', null); return; }
        ck('받은 로그인 상태의 출처 확인: 발급자·합성 계정·aal·로그인 기록 번호·만료·키', true);
        cx.account = 'GM';
        const page = await cx.page();
        await page.goto(ON() + '/__b3a/blank');
        await page.evaluate((s) => { localStorage.setItem('eon_auth_v1', JSON.stringify(s)); }, session);     // 메모리에서 브라우저로만
        const post = '?id=' + synth().post;
        for (const [file, q, id, want] of [['notice.html', '', 'writeBtn', 'block'], ['notice.html', post, 'adminActions', 'flex'], ['reviews.html', post, 'postActions', 'flex'], ['materials.html', post, 'adminActions', 'flex'], ['materials.html', '', 'writeBtn', 'block']]) {
            const d = await held(cx, page, () => page.goto(ON() + '/' + file + q, { waitUntil: 'domcontentloaded' }), 'GM');
            await sleep(600);
            ck(`${file}${q ? '(글 한 편)' : '(목록)'}: 붙잡은 동안 관리자 버튼(${id})이 보이지 않음`, d.reached ? (await shownAs(page, id, want)) === false : null);
            if (file === 'materials.html' && !q) ck('materials(목록 — 관리자 갈래): 붙잡은 동안 업무 요청의 시도 0·다른 화면으로 가지 않음', d.reached ? (d.business === 0 && d.path.endsWith('/materials.html')) : null);
            else ck(`${file}${q ? '(글 한 편)' : '(목록)'}: 붙잡은 동안 본문의 조회를 시도함(기다리지 않음)`, d.reached ? d.business >= 1 : null);
            await d.release();
            ck(`${file}${q ? '(글 한 편)' : '(목록)'}: 확인된 뒤 그 화면에서 관리자 버튼(${id})이 보임`, onPage(page, file) && (await shownAs(page, id, want)) === true);
        }
        ck('업무 요청(시도)의 자격은 전부 공개 키', attempts(cx).every((x) => x.credential === 'anon'));
    });

    // ---- C17. 점검 중의 거절 ----
    await runCase('C17', '점검 중: 이미 로그인해 둔 B 의 회원 화면은 로그인 화면으로·업무 요청의 시도 0, 공개·갈래 화면은 방문자 그대로', async (cx, ck) => {
        const page = await cx.page();
        const rb = await doLogin(cx, page, 'B');
        ck('B: (점검 전) 로그인됨', rb.message === 'success' && rb.moved);
        const b = identity(cx, 'B');
        await pause('maintenance-on', { exception: 'A' }, { needsRevert: true });
        try {
            const from = cx.records.length;
            await goto(page, ON() + '/my-dashboard.html');
            ck('B · 대시보드: 로그인 화면으로 감', await until(page, "location.pathname.endsWith('/login.html')", 40000));
            ck('B · 대시보드: 업무 요청을 시도하지 않음', attempts(cx, from).length === 0);
            ck('B: 점검의 거절(503)을 받음', cx.records.slice(from).some((x) => (x.target === 'my_profile' || x.target === 'my_site_access') && x.status === 503));
            for (const file of ['notice.html', 'survey.html', 'application.html']) {
                const f2 = cx.records.length;
                await goto(page, ON() + '/' + file);
                await settled(page, 40000);
                await sleep(900);
                const st = await stateOf(page);
                ck(`B · ${file}: 그 화면에 남고(로그인 화면으로 가지 않음) signed_in 아님`, onPage(page, file) && st.state !== 'signed_in');
                ck(`B · ${file}: B 의 정보가 보이지 않고(글자·입력 칸) B 의 값이 조건인 시도 0`, (await bodyHas(page, b)) === false && (await fieldsHave(page, b)) === false && attemptsOf(cx, f2, 'B').length === 0);
                ck(`B · ${file}: 공개 부분의 조회는 시도함`, attempts(cx, f2).length >= 1);
            }
        } finally {
            const back = await pause('maintenance-off', {}, { revertOf: 'maintenance-on' });
            ck('원복 확인: 점검을 껐다는 답', !!back && back.reverted === true ? true : null);
        }
    });

    // ---- CO. 꺼짐: 대상 화면 26개 ----
    await runCase('CO', '꺼짐 대조: 대상 화면 26개가 인증 모듈 파일을 화면마다 1번 받고, 인증 요청 0·옛 값 그대로', async (cx, ck) => {
        const page = await cx.page();
        await seedStore(cx, page, OFF(), SEEDS.old);
        const q = { 'application-detail.html': '?id=' + synth().appA, 'analysis.html': '?id=' + synth().appA, 'write.html': '?board=reviews', 'materials.html': '?id=' + synth().post };
        let ok = true;
        const odd = [];
        for (const p of TARGET_PAGES) {
            const before = authModuleCount();
            await goto(page, OFF() + '/' + p.file + (q[p.file] || ''));
            await sleep(700);
            const got = authModuleCount() - before;
            // 옛 값이 있으면 login.html 은 지금처럼 index.html 로 넘어간다(화면 둘). application-detail.html 은 가짜 응답의 신청서(A 의 것)를
            // "남의 신청서"로 보아 지금처럼 my-application.html 로 넘어간다(화면 둘)
            const want = (p.file === 'login.html' || p.file === 'application-detail.html') ? 2 : 1;
            if (got !== want) { ok = false; odd.push(p.file + ':' + got); }
        }
        cx.notes = { pagesWithUnexpectedCount: odd };       // 대상 화면의 파일 이름(정해 둔 목록의 이름)과 받은 횟수
        ck('대상 화면마다 인증 모듈 파일 1번(지금처럼 다른 화면으로 넘어가는 login.html·application-detail.html 은 넘어간 화면까지 2번)', ok);
        ck('EonAuth 는 꺼짐, EonLogin.on() 은 거짓', await page.evaluate(() => window.EonAuth.state() === 'off' && window.EonLogin.on() === false).catch(() => null));
        ck('인증 모듈의 요청 0', cx.records.filter((x) => AUTH.concat(['auth-other']).includes(x.target)).length === 0);
        ck('SDK 파일을 받는 요청 0', api.sdkCountOff() === 0);
        ck('넣어 둔 옛 값이 글자 그대로', await page.evaluate((s) => Object.entries(s).every(([k, v]) => window.__b3a.rawGet.call(localStorage, k) === v), SEEDS.old));
        ck('새 모듈의 저장소 키 0', await page.evaluate(() => Object.keys(localStorage).every((k) => !k.startsWith('eon_auth'))).catch(() => null));
    });
}
