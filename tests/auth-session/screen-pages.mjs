// 화면 시험 실행기(screen.mjs)의 경우들 — 계약 3C-1(대상 화면의 로그인 상태 통일).
// 이 파일은 경우의 차례표에 경우를 더할 뿐이다. 브라우저·차단기·제어 포트·비밀 보관함은 전부 screen.mjs 의 것을 쓴다
// (예행 P 가 전부 참이어야 시작, 전송 전 차단, 경우마다 새 브라우저 상태, 결과에는 정해 둔 값만).
//
// 이 조각의 화면은 시험 프로젝트의 업무 표를 읽는다. 차단기가 내보내는 것은 3A 에서 승인된 인증 요청과
// "합성 자료가 조건인 정확한 업무 조회"뿐이고, 그 밖의 업무 요청(쓰기·부분 검색·전체 목록·조건 없는 조회)은
// 전송 전에 막고 가짜 응답을 준다 — 막은 요청으로 본 화면의 동작은 실제 업무 성공으로 세지 않는다.

import { TARGET_PAGES } from './pages.mjs';

export const PAGE_CASE_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'CO'];

const CLOSED_TEXT = '새 로그인 시험판';
const MISSING_TEXT = '로그인 상태를 확인할 수 없습니다. 잠시 뒤 새로 고침해 주세요.';

export async function buildPageCases(api) {
    const { runCase, pause, doLogin, until, settled, stateOf, sleep, pathOf, count, vault, seedStore, SEEDS, synth, sites, authModuleCount } = api;
    const ON = () => sites().on;
    const OFF = () => sites().off;

    // 회원 화면과 그 진입 주소(신청서 번호는 이번 실행의 합성 신청서)
    const MEMBER = () => [
        { file: 'my-dashboard.html', q: '', reads: true },
        { file: 'my-profile.html', q: '', closed: true },
        { file: 'change-password.html', q: '', closed: true },
        { file: 'withdraw.html', q: '', closed: true },
        { file: 'application-detail.html', q: '?id=' + synth().appA + '#step2', reads: true },
        { file: 'analysis.html', q: '?id=' + synth().appA, reads: true },
        { file: 'write.html', q: '?board=reviews' },
    ];
    const businessOf = (cx, from = 0) => cx.records.slice(from).filter((r) => r.business);
    const sentBusiness = (cx, from = 0) => businessOf(cx, from).filter((r) => !r.aborted);
    const onPage = (page, file) => pathOf(page).endsWith('/' + file);
    // 화면에 보이는 글자에 그 값들이 있는가(값은 돌려주지 않는다)
    const bodyHas = (page, texts) => page.evaluate((list) => {
        const t = document.body ? document.body.innerText : '';
        return list.filter((x) => typeof x === 'string' && x.length > 0).some((x) => t.includes(x));
    }, texts).catch(() => null);
    const noticeHas = (page, text) => page.evaluate((x) => { const el = document.getElementById('eonLoginNotice'); return !!el && el.textContent.includes(x); }, text).catch(() => null);
    const identity = (cx, acct) => [cx.seen.names[acct], vault.get('EMAIL_' + acct)];

    // 확인 응답(my_site_access)을 붙잡은 채로 go() 를 하고, 그동안의 화면을 본다
    async function held(cx, page, go, acct) {
        let reached;
        let release;
        const reachedP = new Promise((r) => { reached = r; });
        const releasedP = new Promise((r) => { release = r; });
        cx.hooks.my_site_access = { after: async () => { reached(true); await releasedP; return null; } };
        const from = cx.records.length;
        const nav = Promise.resolve().then(go).catch(() => null);
        const got = await Promise.race([reachedP, sleep(15000).then(() => false)]);
        await sleep(1300);
        const during = {
            reached: !!got,
            state: (await stateOf(page)).state,
            shown: await bodyHas(page, identity(cx, acct)),
            business: businessOf(cx, from).length,
            path: pathOf(page),
        };
        release();
        delete cx.hooks.my_site_access;
        await nav;
        await settled(page, 30000);
        await sleep(900);
        return during;
    }

    // ---- C1. 로그인 전: 회원 화면은 지금처럼 로그인 화면으로, 업무 요청 0 ----
    await runCase('C1', '로그인 전: 회원 화면 7개 직접 진입 → 로그인 화면으로, 업무 요청 0', async (cx, ck) => {
        const page = await cx.page();
        for (const m of MEMBER()) {
            await page.goto(ON() + '/' + m.file + m.q, { waitUntil: 'domcontentloaded' }).catch(() => {});
            const moved = await until(page, "location.pathname.endsWith('/login.html')", 8000);
            ck(`${m.file}: 로그인 화면으로 감`, moved);
        }
        ck('업무 요청을 시도한 것 0(보낸 것도 막은 것도 없음)', businessOf(cx).length === 0);
        ck('인증 요청 0(저장된 로그인이 없다)', ['login', 'refresh', 'logout', 'my_profile', 'my_site_access'].every((t) => count(cx, t) === 0));
    });

    // ---- C2. A: 회원 화면마다 직접 진입 — 확인 전 표시 0·업무 요청 0, 확인 뒤에만 ----
    await runCase('C2', 'A 로그인: 회원 화면 7개 직접 진입 — 확인 전 회원 정보 0·업무 요청 0, 확인 뒤에만', async (cx, ck) => {
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A');
        ck('A 로 로그인됨', r.message === 'success' && r.moved);
        for (const m of MEMBER()) {
            const from = cx.records.length;
            const d = await held(cx, page, () => page.goto(ON() + '/' + m.file + m.q, { waitUntil: 'domcontentloaded' }), 'A');
            ck(`${m.file}: 확인 응답을 붙잡음(상태 restoring)`, d.reached && d.state === 'restoring' ? true : (d.reached ? false : null));
            ck(`${m.file}: 확인 전에 회원 정보가 보이지 않음`, d.shown === null ? null : d.shown === false);
            ck(`${m.file}: 확인 전에 업무 요청을 시도하지 않음`, d.business === 0);
            ck(`${m.file}: 확인 전에 다른 화면으로 가지 않음`, d.path.endsWith('/' + m.file));
            ck(`${m.file}: 확인된 뒤 그 화면에 남음(로그인 화면으로 가지 않음)`, onPage(page, m.file) && (await stateOf(page)).state === 'signed_in');
            if (m.reads) ck(`${m.file}: 확인된 뒤 합성 자료가 조건인 조회가 나감`, sentBusiness(cx, from).length >= 1);
            if (m.closed) {
                ck(`${m.file}: 닫아 둔 기능의 임시 안내`, await noticeHas(page, CLOSED_TEXT));
                ck(`${m.file}: 닫아 둔 기능의 화면이 업무 요청을 시도하지 않음`, businessOf(cx, from).length === 0);
            }
        }
        ck('업무 요청의 자격은 전부 공개 키(회원 자격은 인증 모듈의 요청에만)', businessOf(cx).every((x) => x.credential === 'anon'));
    });

    // ---- C3. 새로 고침·뒤로 가기 ----
    await runCase('C3', 'A: 대시보드 새로 고침·뒤로 가기 — 다시 확인하기 전 회원 정보 0·업무 요청 0', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        await page.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' });
        await settled(page, 30000);
        await sleep(900);
        ck('대시보드에 A 의 정보가 보임', await bodyHas(page, identity(cx, 'A')));
        const d1 = await held(cx, page, () => page.reload({ waitUntil: 'domcontentloaded' }), 'A');
        ck('새로 고침: 확인 응답을 붙잡음', d1.reached ? true : null);
        ck('새로 고침: 확인 전에 회원 정보가 보이지 않음·업무 요청 0', d1.shown === false && d1.business === 0);
        ck('새로 고침: 확인된 뒤 A 의 정보가 보임', await bodyHas(page, identity(cx, 'A')));
        await page.goto(ON() + '/about.html', { waitUntil: 'domcontentloaded' });
        await settled(page, 30000);
        const shows0 = cx.events.length;
        const d2 = await held(cx, page, () => page.goBack({ waitUntil: 'domcontentloaded' }), 'A');
        cx.notes = { backRevived: cx.events.slice(shows0).includes('pageshow-persisted') };      // 보관된 화면이 되살아났는가(참고)
        ck('뒤로 가기: 다시 확인하는 요청이 나감(응답을 붙잡음)', d2.reached ? true : null);
        ck('뒤로 가기: 확인 전에 회원 정보가 보이지 않음·업무 요청 0', d2.shown === false && d2.business === 0);
        ck('뒤로 가기: 확인된 뒤 대시보드에 A 의 정보가 보임', onPage(page, 'my-dashboard.html') && (await bodyHas(page, identity(cx, 'A'))));
    });

    // ---- C4. 계정 상태(B·차단·탈퇴 처리 중·대응 없음) ----
    await runCase('C4', '계정 상태: B 는 B 의 화면, 차단·탈퇴 처리 중·대응 없음은 회원 화면에서 로그인 화면으로·업무 요청 0', async (cx, ck) => {
        const page = await cx.page();
        const rb = await doLogin(cx, page, 'B');
        await page.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' });
        await settled(page, 30000);
        await sleep(900);
        ck('B: 로그인되고 대시보드에 B 의 정보', rb.message === 'success' && (await bodyHas(page, identity(cx, 'B'))));
        ck('B: 업무 조회의 조건은 합성 값(내보낸 것은 합성 자료가 조건인 조회뿐)', sentBusiness(cx).every((x) => x.business === 'synthetic-read'));
        for (const acct of ['BLK', 'WD', 'N']) {
            const cx2 = await api.newCx('C4-' + acct);
            try {
                const p = await cx2.page();
                const r = await doLogin(cx2, p, acct);
                ck(`${acct}: 로그인되지 않음`, r.message !== 'success' && !r.moved);
                const from = cx2.records.length;
                await p.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
                ck(`${acct}: 대시보드가 로그인 화면으로 보냄`, await until(p, "location.pathname.endsWith('/login.html')", 20000));
                ck(`${acct}: 업무 요청을 시도하지 않음`, businessOf(cx2, from).length === 0);
            } finally {
                cx.records.push(...cx2.records);
                await cx2.context.close().catch(() => {});
            }
        }
    });

    // ---- C5. 끝난 로그인 기록(서버에서 끝냄) → 회원 화면 ----
    await runCase('C5', '끝난 로그인 기록(서버에서 끝냄): 회원 화면이 로그인 화면으로·업무 요청 0', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        const sid = cx.seen.lastLoginSid;
        await pause('expire-session', { sid }, { needsRevert: true });
        try {
            const from = cx.records.length;
            await page.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
            ck('대시보드가 로그인 화면으로 보냄', await until(page, "location.pathname.endsWith('/login.html')", 40000));
            ck('업무 요청을 시도하지 않음', businessOf(cx, from).length === 0);
            ck('회원 정보가 보이지 않음', (await bodyHas(page, identity(cx, 'A'))) === false);
        } finally {
            const back = await pause('restore-session', { sid }, { revertOf: 'expire-session' });
            ck('원복 확인: 로그인 기록을 되돌렸다는 답', !!back && back.reverted === true ? true : null);
        }
    });

    // ---- C6. 로그인 뒤 돌아갈 주소 ----
    await runCase('C6', '로그인 뒤 돌아갈 주소: 허용 목록이면 그 주소로, 아니면 index.html', async (cx, ck) => {
        const go = async (label, redirect, wantFile, wantSearchHash) => {
            const cx2 = await api.newCx('C6-' + label);
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

    // ---- C7. 두 탭: 다른 탭이 계정을 바꿈 ----
    await runCase('C7', '두 탭: A 의 대시보드를 둔 채 다른 탭이 B 로 로그인 — A 의 화면이 남지 않음', async (cx, ck) => {
        const p1 = await cx.page();
        await doLogin(cx, p1, 'A');
        await p1.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' });
        await settled(p1, 30000);
        await sleep(900);
        const a = identity(cx, 'A');
        ck('탭 1: A 의 대시보드', await bodyHas(p1, a));
        const p2 = await cx.page();
        const rb = await doLogin(cx, p2, 'B');
        ck('탭 2: B 로 로그인됨', rb.message === 'success' && rb.moved);
        await sleep(2500);
        await settled(p1, 30000);
        await sleep(900);
        ck('탭 1: A 의 정보가 보이지 않음', (await bodyHas(p1, a)) === false);
        ck('탭 1: 다시 받아 B 의 화면이 됨(또는 가려짐)', (await bodyHas(p1, identity(cx, 'B'))) === true || (await p1.evaluate(() => document.documentElement.classList.contains('eon-auth-away')).catch(() => null)) === true);
        ck('탭 2: B 의 표시 그대로', (await stateOf(p2)).state === 'signed_in');
    });

    // ---- C8. 옛 값이 있는 브라우저 ----
    await runCase('C8', '옛 값이 있는 브라우저: 회원 화면이 옛 값을 믿지 않음(로그인 화면으로·업무 요청 0)', async (cx, ck) => {
        const page = await cx.page();
        await seedStore(cx, page, ON(), SEEDS.old);
        const from = cx.records.length;
        for (const m of MEMBER()) {
            await page.goto(ON() + '/' + m.file + m.q, { waitUntil: 'domcontentloaded' }).catch(() => {});
            ck(`${m.file}: 로그인 화면으로 감`, await until(page, "location.pathname.endsWith('/login.html')", 8000));
        }
        ck('업무 요청을 시도하지 않음(옛 값이 조건인 조회 0)', businessOf(cx, from).length === 0);
        await page.goto(ON() + '/notice.html', { waitUntil: 'domcontentloaded' });
        await settled(page);
        await sleep(700);
        ck('공개 화면에 옛 값의 이름이 보이지 않음', (await bodyHas(page, ['옛학생'])) === false);
        ck('옛 값이 글자 그대로 남음(지우지 않는다)', await page.evaluate((s) => Object.entries(s).every(([k, v]) => window.__b3a.rawGet.call(localStorage, k) === v), SEEDS.old));
    });

    // ---- C9. 방문자 갈래가 그대로 도는가(제출은 하지 않는다) ----
    await runCase('C9', '방문자 갈래: 공지·후기·공부인증·신청 게시판·비회원 설문이 로그인을 요구하지 않음(제출 없음)', async (cx, ck) => {
        const page = await cx.page();
        for (const file of ['notice.html', 'reviews.html', 'reviews-book.html', 'study-certify.html', 'application.html', 'survey.html', 'my-application.html', 'about.html', 'faq.html', 'pricing.html', 'programs.html']) {
            const from = cx.records.length;
            await page.goto(ON() + '/' + file, { waitUntil: 'domcontentloaded' });
            await settled(page);
            await sleep(900);
            ck(`${file}: 그 화면에 남음(로그인 화면으로 가지 않음)`, onPage(page, file));
            if (['notice.html', 'reviews.html', 'reviews-book.html', 'study-certify.html', 'application.html', 'survey.html'].includes(file)) {
                ck(`${file}: 공개 본문의 조회를 시도함(기다리지 않음 — 이 조회는 전송 전에 막고 가짜 응답을 줬다)`, businessOf(cx, from).length >= 1);
            }
        }
        ck('업무 쓰기를 시도한 것 0(제출하지 않았다)', businessOf(cx).filter((x) => x.business === 'write').length === 0);
        ck('내보낸 업무 요청 0(전부 전송 전에 막음 — 합성 자료가 조건이 아니다)', sentBusiness(cx).length === 0);
    });

    // ---- C10. 닫아 둔 기능 ----
    await runCase('C10', '닫아 둔 기능: 가입·아이디 찾기·비밀번호 찾기·가입을 겸한 신청·책 신청 — 임시 안내, 업무 요청 0', async (cx, ck) => {
        const page = await cx.page();
        for (const file of ['register.html', 'find-id.html', 'find-password.html', 'application-form.html', 'book-request.html']) {
            const from = cx.records.length;
            await page.goto(ON() + '/' + file, { waitUntil: 'domcontentloaded' });
            await settled(page);
            await sleep(900);
            ck(`${file}: 그 화면에 남음`, onPage(page, file));
            ck(`${file}: 임시 안내가 보임`, await noticeHas(page, CLOSED_TEXT));
            if (file === 'find-id.html') {
                await page.fill('#name', '합성').catch(() => {});
                await page.fill('#phone', '010-0000-0000').catch(() => {});
                await page.click('#findBtn').catch(() => {});
                await sleep(700);
            }
            if (file === 'application-form.html') {
                // 신청 화면은 공개 안내(약관 등)를 읽는다 — 계정 갈래의 요청(쓰기·부분 검색)만 없어야 한다
                ck(`${file}: 계정 조회(부분 검색)·저장을 시도하지 않음`, businessOf(cx, from).filter((x) => x.business === 'write' || x.business === 'partial-search').length === 0);
            } else {
                ck(`${file}: 업무 요청을 시도하지 않음(회원 조회·계정 요청 0)`, businessOf(cx, from).length === 0);
            }
        }
        ck('업무 쓰기를 시도한 것 0', businessOf(cx).filter((x) => x.business === 'write').length === 0);
        ck('로그인 값을 쓰거나 지운 것 0', ['iontoefl_user', 'iontoefl_login_time'].every((b) => ['setItem', 'removeItem'].every((op) => !((cx.store[b] || {})[op]))));
    });

    // ---- C11. 켜진 화면인데 인증 모듈 파일을 받지 못함 ----
    await runCase('C11', '인증 모듈 파일을 받지 못한 켜진 화면: 꺼짐이 아니라 닫음(옛 값을 믿지 않음)', async (cx, ck) => {
        const page = await cx.page();
        await seedStore(cx, page, ON(), SEEDS.old);
        cx.dropAuthModule = true;
        const from = cx.records.length;
        await page.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(1500);
        ck('인증 모듈이 없음(시험이 그 파일을 막음)', await page.evaluate(() => typeof window.EonAuth === 'undefined' && window.EonLogin.on() === true && window.EonLogin.missing() === true).catch(() => null));
        ck('회원 화면: 그 화면에 남고 임시 안내', onPage(page, 'my-dashboard.html') && (await noticeHas(page, MISSING_TEXT)));
        ck('회원 화면: 옛 값의 이름이 보이지 않음·업무 요청 0', (await bodyHas(page, ['옛학생', 'old@zz.invalid'])) === false && businessOf(cx, from).length === 0);
        await page.goto(ON() + '/notice.html', { waitUntil: 'domcontentloaded' });
        await sleep(1500);
        ck('공개 화면: 본문은 그대로(조회를 시도함), 옛 값의 이름은 보이지 않음', onPage(page, 'notice.html') && businessOf(cx, from).length >= 1 && (await bodyHas(page, ['옛학생'])) === false);
        ck('인증 요청 0', ['login', 'refresh', 'logout', 'my_profile', 'my_site_access'].every((t) => count(cx, t) === 0));
    });

    // ---- C12. 3A 의 제약(로그아웃 "모름")의 지금 동작 — 다시 잰다 ----
    await runCase('C12', '제약 다시 재기: 대시보드에서 로그아웃의 답을 받지 못함 → 끝낸 것으로 하지 않고, 다시 받으면 로그인된 채', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        await page.goto(ON() + '/my-dashboard.html', { waitUntil: 'domcontentloaded' });
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

    // ---- CO. 꺼짐: 대상 화면 26개 ----
    await runCase('CO', '꺼짐 대조: 대상 화면 26개가 인증 모듈 파일을 화면마다 1번 받고, 인증 요청 0·옛 값 그대로', async (cx, ck) => {
        const page = await cx.page();
        await seedStore(cx, page, OFF(), SEEDS.old);
        const q = { 'application-detail.html': '?id=' + synth().appA, 'analysis.html': '?id=' + synth().appA, 'write.html': '?board=reviews', 'materials.html': '?id=' + synth().appA };
        let ok = true;
        const odd = [];
        for (const p of TARGET_PAGES) {
            const before = authModuleCount();
            await page.goto(OFF() + '/' + p.file + (q[p.file] || ''), { waitUntil: 'domcontentloaded' }).catch(() => {});
            await sleep(700);
            const got = authModuleCount() - before;
            // 옛 값이 있으면 login.html 은 지금처럼 index.html 로 넘어가고, 남의 신청서를 연 application-detail.html 은 지금처럼 my-application.html 로 넘어간다(화면 둘)
            const want = (p.file === 'login.html' || p.file === 'application-detail.html') ? 2 : 1;
            if (got !== want) { ok = false; odd.push(p.file + ':' + got); }
        }
        cx.notes = { pagesWithUnexpectedCount: odd };       // 대상 화면의 파일 이름(정해 둔 목록의 이름)과 받은 횟수
        ck('대상 화면마다 인증 모듈 파일 1번(지금처럼 다른 화면으로 넘어가는 login.html·application-detail.html 은 넘어간 화면까지 2번)', ok);
        ck('EonAuth 는 꺼짐, EonLogin.on() 은 거짓', await page.evaluate(() => window.EonAuth.state() === 'off' && window.EonLogin.on() === false).catch(() => null));
        ck('인증 모듈의 요청 0', cx.records.filter((x) => ['login', 'refresh', 'logout', 'my_profile', 'my_site_access', 'auth-other'].includes(x.target)).length === 0);
        ck('SDK 파일을 받는 요청 0', api.sdkCountOff() === 0);
        ck('넣어 둔 옛 값이 글자 그대로', await page.evaluate((s) => Object.entries(s).every(([k, v]) => window.__b3a.rawGet.call(localStorage, k) === v), SEEDS.old));
        ck('새 모듈의 저장소 키 0', await page.evaluate(() => Object.keys(localStorage).every((k) => !k.startsWith('eon_auth'))).catch(() => null));
    });
}
