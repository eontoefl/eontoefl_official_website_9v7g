// 화면 시험 실행기(screen.mjs)의 경우들 — 계약 3C-2a(회원 자격으로 읽는 구조 + 성적 이력 읽기 하나).
// 이 파일은 경우의 차례표에 경우를 더할 뿐이다. 브라우저·차단기·전송 지점·제어 포트·비밀 보관함은 전부 screen.mjs 의 것을 쓴다.
//
// **이 조각은 보호가 아니다.** 성적 표에는 익명 역할의 전체 허용 규칙이 남아 있다 — 꺼진 화면·닫힌 화면의 공개 키 읽기가 지금도 읽힌다.
// 여기서 보는 것은 "켜지고 열린 화면이 성적을 확인 뒤에만, 그 회원의 JWT 로, 정해 둔 모양으로 읽는가"와 그 실패 처리다.
//
// 실제로 내보내는 것: 3A 의 인증 요청 다섯과, **그 경우의 합성 회원 한 명의 성적 읽기**(경우가 arm 으로 허락을 건 동안만).
// 그 밖의 업무 요청은 3C-1 처럼 전송 전에 막고 가짜 응답을 준다(재시작 신청 화면을 만드는 "지난 신청서"도 가짜 응답이다).
// 사람의 값은 my_profile 에서 본 것만 쓴다(people). 결과에는 이름표·정해 둔 이름·참/거짓·수만 적는다.

import { SCORE_FIXTURE } from './scores-fixture.mjs';

export const MEMBER_CASE_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'];

// 실행기가 돌리지 않는 것(통과로 세지 않는다 — 결과의 notRunMatrix 와 절차.md 의 표에 그대로 적는다)
export const MEMBER_NOT_RUN = [
    '(계약 3C-2a) 실제 60분 만료: 기다리지 않는다. 만료의 다섯 갈래(S6)는 실행기가 첫 성적 응답을 "만료(401·PGRST303)"로 바꿔 줘서 본다 — 서버가 실제로 준 응답과 칸을 나눠 적는다',
    '(계약 3C-2a) 서버가 성적 읽기에 401·403 을 실제로 주는 경우: 실행기가 응답을 바꿔 줘서만 본다(S5). 점검 중의 503 은 실제 점검을 켜서 본다',
    '(계약 3C-2a) 사람이 달라진 순간의 결과 상태(discarded): 실제 브라우저에서는 그 화면이 다시 받아져 상태를 읽을 수 없다 — 요청의 기록(JWT 의 사람 = 조건의 사람)과 화면의 값으로만 본다(S6 의 셋째 갈래·S7). 상태 이름은 회귀시험(가짜 DOM)이 본다',
    '(계약 3C-2a) 서버 경계의 대조(판정 (iii) — 다른 회원의 JWT 로 남의 행을 달라고 하는 요청): 실행기는 보내지 않는다. 브레인방이 화면 밖에서 합성 행의 번호로 범위를 고정해 잰다(절차.md)',
    '(계약 3C-2a) 성적 0건 회원은 GM(6자리 전 — 비밀번호 로그인)으로 본다: 관리자가 아닌 성적 0건 회원은 합성 계정에 없다',
    '(계약 3C-2a) 재시작 신청서의 제출과 그 뒤: 어디서도 제출하지 않는다. 재시작이 허용된 "지난 신청서"는 실행기의 가짜 응답이다(신청서 표는 읽지 않는다)',
];

const CLOSED_TEXT = '새 로그인 시험판';
const MISSING_TEXT = '로그인 상태를 확인할 수 없습니다. 잠시 뒤 새로 고침해 주세요.';
const BTN = "!!document.getElementById('restartLoadHistoryBtn')";
const STATUSES = ['ok', 'not_signed_in', 'rejected', 'maintenance', 'unknown', 'discarded'];
const EXPIRED = { status: 401, code: 'PGRST303' };
const DATES = Object.fromEntries(Object.values(SCORE_FIXTURE).flat().map((r) => [r.tag, r.test_date]));
const LATEST = { A: SCORE_FIXTURE.A[SCORE_FIXTURE.A.length - 1], B: SCORE_FIXTURE.B[SCORE_FIXTURE.B.length - 1] };

export async function buildMemberCases(api) {
    const { runCase, pause, doLogin, until, settled, stateOf, sleep, pathOf, vault, newCx, people, sites, arm, disarm, hidden } = api;
    const ON = () => sites().on;
    const OFF = () => sites().off;
    const OPEN = () => sites().open;
    const FORM = '/application-form.html';

    // 참·거짓·미확인(null)의 "그리고"
    const all = (...xs) => (xs.some((x) => x === false) ? false : (xs.some((x) => x === null || x === undefined) ? null : true));
    const scoresOf = (cx, from = 0) => cx.records.slice(from).filter((r) => r.target === 'scores');
    const wentOut = (r) => r.sent === true || /^fake-server/.test(r.how || '');            // 전송 지점을 지나 서버(--fake 면 가짜 서버)로 갔는가
    const refreshes = (cx, from = 0) => cx.records.slice(from).filter((r) => r.target === 'refresh');
    const onPage = (page, file) => pathOf(page).endsWith('/' + file);
    const noticeHas = (page, text) => page.evaluate((x) => { const el = document.getElementById('eonLoginNotice'); return !!el && el.textContent.includes(x); }, text).catch(() => null);
    const valueOf = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? String(el.value || '') : null; }, sel).catch(() => null);
    const typeInto = (page, sel, value) => page.evaluate(([s, v]) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value === v;
    }, [sel, value]).catch(() => false);
    const HIST = 'textarea[name="score_history"]';
    const TOTAL = 'input[name="score_total_new"]';
    // 화면의 결과: 불러오기 버튼, 점수 칸의 미리 채움(값은 합성 성적이거나 빈 글자다), 임시 안내가 있는가
    const uiOf = (page) => page.evaluate(() => {
        const v = (s) => { const el = document.querySelector(s); return el ? String(el.value) : null; };
        const yes = document.querySelector('input[name="has_toefl_score"][value="yes"]');
        return {
            btn: !!document.getElementById('restartLoadHistoryBtn'), banner: !!document.getElementById('restartFormBanner'), yes: !!(yes && yes.checked),
            total: v('input[name="score_total_new"]'), reading: v('input[name="score_reading_new"]'), listening: v('input[name="score_listening_new"]'),
            speaking: v('input[name="score_speaking_new"]'), writing: v('input[name="score_writing_new"]'), notice: !!document.getElementById('eonLoginNotice'),
        };
    }).catch(() => null);
    // 불러오기 버튼을 눌렀을 때 칸에 들어가는 글(성적 이력이 그 글에 들어간다). 누른 뒤 칸을 누르기 전 값으로 되돌린다
    const historyOf = (page) => page.evaluate(() => {
        const h = document.querySelector('textarea[name="score_history"]');
        const b = document.getElementById('restartLoadHistoryBtn');
        if (!h || !b) return null;
        const before = h.value;
        h.value = '';
        b.click();
        const after = h.value;
        h.value = before;
        return after;
    }).catch(() => null);
    const histHas = (text, tags) => typeof text === 'string' && tags.every((t) => text.includes(DATES[t]));
    const histLacks = (text, tags) => typeof text === 'string' && tags.every((t) => !text.includes(DATES[t]));
    const prefilled = (u, row) => !!u && u.yes === true && u.total === String(row.overall) && u.reading === String(row.reading) && u.listening === String(row.listening) && u.speaking === String(row.speaking) && u.writing === String(row.writing);
    const notPrefilled = (u) => !!u && u.yes === false && u.total === '' && u.reading === '' && u.listening === '' && u.speaking === '' && u.writing === '';
    const statusOf = (page) => page.evaluate(() => (window.EonAuth && typeof window.EonAuth.memberReadStatus === 'function' ? window.EonAuth.memberReadStatus('my-scores') : 'no-function')).then((s) => (s === null ? null : (STATUSES.includes(s) || s === 'no-function' ? s : 'other')), () => 'unreadable');
    const rowsAre = (r, a, b) => (r && r.server ? (r.server.status === 200 && !!r.server.rows && r.server.rows.A === a && r.server.rows.B === b && r.server.rows.other === 0) : null);
    const permittedAs = (r, credential, owner) => !!r && r.scores === 'permitted' && r.credential === credential && r.scoresOwner === owner && r.scoresShape === (credential === 'member' ? 'member' : 'wrapper') && (credential === 'member' ? r.scoresJwt === owner : r.scoresJwt === 'none');

    // 인증 응답(my_site_access)을 붙잡은 채로 go() 를 하고, 그동안의 것을 본다
    async function heldAuth(cx, page, go) {
        let reached;
        let release;
        const reachedP = new Promise((r) => { reached = r; });
        const releasedP = new Promise((r) => { release = r; });
        cx.hooks.my_site_access = { after: async () => { reached(true); await releasedP; return null; } };
        const from = cx.records.length;
        const nav = Promise.resolve().then(go).catch(() => null);
        const got = await Promise.race([reachedP, sleep(15000).then(() => false)]);
        await sleep(1300);
        const during = { reached: !!got, from, state: (await stateOf(page)).state, scores: scoresOf(cx, from).length };
        during.release = async () => { release(); delete cx.hooks.my_site_access; await nav; await settled(page, 30000); };
        return during;
    }

    // 옛 방식의 로그인 값(꺼진 화면이 읽는다) — 그 회원의 my_profile 에서 본 값으로 만든다(브라우저에만 넣는다. 결과에 쓰지 않는다)
    const oldSeed = (k) => ({
        iontoefl_user: JSON.stringify({ id: people.memberIdOf(k), name: people.nameOf(k), nickname: '', email: people.memberEmailOf(k), phone: '010-0000-0000', level: 2, role: 'user' }),
        iontoefl_login_time: String(Date.now() - 3600000),
    });
    // 꺼진 화면의 결과(같은 합성 자료): 공개 키로 지금 그대로 읽는다. 판정 (ii)의 견줄 대상
    async function offResult(cx, k) {
        if (!people.known(k)) return { known: false, ui: null, hist: null, scores: [], auth: null };
        const cx2 = await newCx(cx.id + '-off-' + k);
        try {
            arm(cx2, 'anon', [k]);
            const p = await cx2.page();
            await p.goto(OFF() + '/__b3a/blank');
            await p.evaluate((s) => { for (const [key, v] of Object.entries(s)) localStorage.setItem(key, v); }, oldSeed(k));
            await p.goto(OFF() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await until(p, BTN, 20000);
            await sleep(700);
            return { known: true, ui: await uiOf(p), hist: await historyOf(p), scores: scoresOf(cx2), auth: cx2.records.filter((r) => ['login', 'refresh', 'logout', 'my_profile', 'my_site_access', 'auth-other'].includes(r.target)).length };
        } finally {
            cx.records.push(...cx2.records);
            await cx2.context.close().catch(() => {});
        }
    }
    // 그 계정의 값을 아직 모르면(이 경우만 따로 돌릴 때) 다른 브라우저 상태에서 한 번 로그인해 my_profile 을 본다
    const know = async (cx, acct) => {
        if (people.known(acct)) return true;
        const cx2 = await newCx(cx.id + '-know-' + acct);
        try { await doLogin(cx2, await cx2.page(), acct); } finally { cx.records.push(...cx2.records); await cx2.context.close().catch(() => {}); }
        return people.known(acct);
    };

    // 확인된 acct 로 켜진(열림) 재시작 신청 화면을 연다. 성적 응답마다 answers 의 차례대로 한다:
    //   null·없음 = 서버의 응답 그대로 / { status, code } = **실행기가 응답을 바꿔 준다**(요청은 실제로 나가고, 서버가 준 것은 기록에 따로 남는다)
    // 첫 성적 응답은 붙잡아 둔다(그동안 학생이 값을 적는다). release() 로 푼다
    async function readWith(cx, acct, answers) {
        let n = 0;
        let first = null;
        let reached;
        let release;
        const reachedP = new Promise((r) => { reached = r; });
        const releasedP = new Promise((r) => { release = r; });
        cx.hooks.scores = {
            after: async (rec) => {
                const i = n++;
                if (i === 0) { rec.held = true; first = rec; reached(true); await releasedP; }      // held: 실행기가 이 응답을 붙잡아 뒀다가 화면에 넘겼다
                const a = answers[i];
                return a ? { replace: { status: a.status, body: JSON.stringify({ code: a.code, message: 'zz 실행기가 바꿔 준 응답' }) } } : null;
            },
        };
        const page = await cx.page();
        const login = await doLogin(cx, page, acct, { site: OPEN() });
        const from = cx.records.length;
        page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const got = await Promise.race([reachedP, sleep(25000).then(() => false)]);
        await sleep(400);
        return { page, from, loggedIn: login.message === 'success' && login.moved, got: !!got, firstRecord: () => first, release: () => release(), wait: async () => { await until(page, BTN, 25000); await sleep(900); } };
    }
    const TYPED_HIST = 'zz 학생이 적던 값';
    const TYPED_TOTAL = '5.5';
    const typeAll = async (page) => (await typeInto(page, HIST, TYPED_HIST)) && (await typeInto(page, TOTAL, TYPED_TOTAL));
    const typedKept = async (page) => { const u = await uiOf(page); return !!u && (await valueOf(page, HIST)) === TYPED_HIST && u.total === TYPED_TOTAL && u.reading === '' && u.listening === '' && u.speaking === '' && u.writing === '' && u.yes === false; };

    // ---- S1 (ㄱ) ----
    await runCase('S1', '(ㄱ) A: 켜진(성적 읽기 열림) 재시작 신청 화면 — 확인 전 성적 요청 0, 확인 뒤 A 의 JWT 로 한 번, 화면 결과가 같은 합성 자료의 꺼짐 결과와 같음', async (cx, ck) => {
        people.setRestart(['A']);
        arm(cx, 'member', ['A']);
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A', { site: OPEN() });
        ck('A 로 로그인됨', r.message === 'success' && r.moved);
        const d = await heldAuth(cx, page, () => page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }));
        ck('확인 응답을 붙잡음(상태 restoring)', d.reached && d.state === 'restoring' ? true : (d.reached ? false : null));
        ck('확인 전(붙잡은 동안): 성적 요청의 시도 0', d.reached ? d.scores === 0 : null);
        await d.release();
        ck('확인 뒤: 재시작 신청 화면이 되고 성적 이력의 버튼이 붙음', await until(page, BTN, 20000));
        await sleep(700);
        const sc = scoresOf(cx, d.from);
        const one = sc[0];
        ck('확인 뒤: 성적 요청이 한 번', sc.length === 1);
        ck('그 요청: 실행기가 따로 적어 둔 모양과 글자까지 같고, 회원 자격이며, JWT 의 사람 = 조건의 사람 = A', permittedAs(one, 'member', 'A'));
        ck('그 요청이 전송 지점을 지나 나감', !!one && wentOut(one));
        ck('서버가 실제로 준 응답: 200, A 의 합성 행 둘뿐(B 의 행 0·합성 행이 아닌 것 0), 실행기가 바꿔 주지 않음', all(rowsAre(one, 2, 0), !!one && one.substituted === false));
        ck('결과 상태: ok', (await statusOf(page)) === 'ok');
        ck('공개 키(또는 다른 자격)의 성적 요청 0', sc.every((x) => x.credential === 'member'));
        const on = { ui: await uiOf(page), hist: await historyOf(page) };
        ck('점수 칸이 가장 최근 합성 성적(A2)으로 채워짐', prefilled(on.ui, LATEST.A));
        ck('불러오기 글에 A 의 합성 성적 둘이 있고 B 의 것은 없음', histHas(on.hist, ['A1', 'A2']) && histLacks(on.hist, ['B1']));
        const off = await offResult(cx, 'A');
        ck('꺼진 화면(같은 합성 자료): 공개 키로, 실행기가 따로 적어 둔 "지금의 요청"과 글자까지 같은 요청 한 번', off.scores.length === 1 && permittedAs(off.scores[0], 'anon', 'A') && wentOut(off.scores[0]));
        ck('꺼진 화면: 서버가 실제로 준 응답이 200, A 의 합성 행 둘', rowsAre(off.scores[0], 2, 0));
        ck('판정 (ii): 미리 채움·버튼이 꺼진 화면의 결과와 같음', on.ui && off.ui ? JSON.stringify(on.ui) === JSON.stringify(off.ui) : null);
        ck('판정 (ii): 불러오기 글이 꺼진 화면의 결과와 같음', typeof on.hist === 'string' && typeof off.hist === 'string' ? on.hist === off.hist : null);
        ck('성적 읽기 말고 다른 업무 요청(시도)의 자격은 전부 공개 키', cx.records.filter((x) => x.business && x.target !== 'scores').every((x) => x.credential === 'anon'));
        people.setRestart([]);
    });

    // ---- S2 (ㄴ) ----
    await runCase('S2', '(ㄴ) 성적 0건 회원(GM — 6자리 전): ok·0건, 미리 채움 없음, 꺼짐과 같음', async (cx, ck) => {
        people.setRestart(['GM']);
        arm(cx, 'member', ['GM']);
        const page = await cx.page();
        const r = await doLogin(cx, page, 'GM', { site: OPEN() });
        ck('GM 으로 로그인됨(비밀번호 — 6자리 전. 되지 않으면 이 경우는 재지 못한다)', r.message === 'success' && r.moved ? true : null);
        if (!(r.message === 'success' && r.moved)) { people.setRestart([]); return; }
        const from = cx.records.length;
        await page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        ck('재시작 신청 화면이 되고 성적 이력의 버튼이 붙음(6자리 전의 GM 은 관리자 표시가 아니다)', await until(page, BTN, 25000));
        await sleep(700);
        const sc = scoresOf(cx, from);
        ck('성적 요청이 한 번: 회원 자격, JWT 의 사람 = 조건의 사람 = GM', sc.length === 1 && permittedAs(sc[0], 'member', 'GM') && wentOut(sc[0]));
        ck('서버가 실제로 준 응답: 200, 0건(A·B 의 합성 행 0 — 6자리 전의 관리자는 남의 행을 받지 않는다)', rowsAre(sc[0], 0, 0));
        ck('결과 상태: ok(실패가 아니라 0건)', (await statusOf(page)) === 'ok');
        const on = { ui: await uiOf(page), hist: await historyOf(page) };
        ck('미리 채움 없음, 불러오기 글에 합성 성적 없음', notPrefilled(on.ui) && histLacks(on.hist, ['A1', 'A2', 'B1']));
        const off = await offResult(cx, 'GM');
        ck('꺼진 화면(같은 회원): 공개 키로 한 번, 0건', off.scores.length === 1 && permittedAs(off.scores[0], 'anon', 'GM') && rowsAre(off.scores[0], 0, 0) === true);
        ck('판정 (ii): 화면 결과가 꺼진 화면의 결과와 같음', on.ui && off.ui ? (JSON.stringify(on.ui) === JSON.stringify(off.ui) && on.hist === off.hist) : null);
        people.setRestart([]);
    });

    // ---- S3 (ㄷ) ----
    await runCase('S3', '(ㄷ) B: 조건의 값이 B 의 회원번호, A 의 행 0', async (cx, ck) => {
        people.setRestart(['B']);
        arm(cx, 'member', ['B']);
        const page = await cx.page();
        const r = await doLogin(cx, page, 'B', { site: OPEN() });
        ck('B 로 로그인됨', r.message === 'success' && r.moved);
        const from = cx.records.length;
        await page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        ck('재시작 신청 화면이 되고 성적 이력의 버튼이 붙음', await until(page, BTN, 25000));
        await sleep(700);
        const sc = scoresOf(cx, from);
        ck('성적 요청이 한 번: 회원 자격, JWT 의 사람 = 조건의 사람 = B', sc.length === 1 && permittedAs(sc[0], 'member', 'B') && wentOut(sc[0]));
        ck('서버가 실제로 준 응답: 200, B 의 합성 행 하나뿐(A 의 행 0)', rowsAre(sc[0], 0, 1));
        ck('A 의 값이 조건인 성적 요청의 시도 0(양성 대조: 이 경우 안에서 B 의 회원번호가 조건인 성적 요청에 이름표가 붙음)', sc.some((x) => x.scoresOwner === 'B') ? sc.every((x) => x.scoresOwner !== 'A') : null);
        ck('결과 상태: ok', (await statusOf(page)) === 'ok');
        const on = { ui: await uiOf(page), hist: await historyOf(page) };
        ck('점수 칸이 B 의 합성 성적으로 채워지고, 불러오기 글에 B 의 것만 있음', prefilled(on.ui, LATEST.B) && histHas(on.hist, ['B1']) && histLacks(on.hist, ['A1', 'A2']));
        const off = await offResult(cx, 'B');
        ck('판정 (ii): 화면 결과가 꺼진 화면의 결과와 같음', on.ui && off.ui ? (JSON.stringify(on.ui) === JSON.stringify(off.ui) && on.hist === off.hist) : null);
        people.setRestart([]);
    });

    // ---- S4 (ㄹ) ----
    await runCase('S4', '(ㄹ) 방문자·차단·탈퇴 처리 중·대응 없음·끝난 로그인 기록: 성적 요청의 시도 0', async (cx, ck) => {
        people.setRestart(['A']);
        arm(cx, 'member', ['A']);
        // 양성 대조: 같은 경우 안에서, 확인된 A 의 같은 화면은 성적 요청을 낸다(차단기가 성적 표로 가는 요청을 알아본다)
        const page = await cx.page();
        await doLogin(cx, page, 'A', { site: OPEN() });
        await page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await until(page, BTN, 25000);
        await sleep(500);
        const control = scoresOf(cx).some((x) => x.scoresOwner === 'A' && x.scores === 'permitted');
        ck('양성 대조: 확인된 A 의 같은 화면은 성적 요청을 내고, 그 요청에 A 의 회원번호의 이름표가 붙음', control);
        const zero = (n) => (control ? n === 0 : null);
        const sid = cx.seen.lastLoginSid;
        const visit = async (label, prepare) => {
            const cx2 = await newCx('S4-' + label);
            try {
                arm(cx2, 'member', ['A']);
                const p = await cx2.page();
                if (prepare) await prepare(cx2, p);
                const from = cx2.records.length;
                await p.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
                await settled(p, 40000);
                await sleep(2500);
                ck(`${label}: 신청서 화면에 남고(로그인 화면으로 가지 않음) signed_in 이 아님`, onPage(p, 'application-form.html') && (await stateOf(p)).state !== 'signed_in');
                ck(`${label}: 성적 요청의 시도 0(어느 자격으로도)`, zero(scoresOf(cx2, from).length));
                ck(`${label}: 성적 이력의 버튼이 없음(재시작 신청 화면이 아니다)`, (await uiOf(p) || {}).btn === false);
            } finally {
                cx.records.push(...cx2.records);
                await cx2.context.close().catch(() => {});
            }
        };
        await visit('방문자', null);
        for (const acct of ['BLK', 'WD', 'N']) {
            await visit(acct, async (cx2, p) => { const r = await doLogin(cx2, p, acct, { site: OPEN() }); ck(`${acct}: 로그인되지 않음`, r.message !== 'success' && !r.moved); });
        }
        // 끝난 로그인 기록: A 의 저장된 로그인을 서버에서 끝낸 뒤 같은 브라우저에서 그 화면을 다시 연다
        await pause('expire-session', { sid }, { needsRevert: true });
        try {
            const from = cx.records.length;
            await page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await settled(page, 40000);
            await sleep(2500);
            ck('끝난 로그인 기록: 신청서 화면에 남고 signed_in 이 아님', onPage(page, 'application-form.html') && (await stateOf(page)).state !== 'signed_in');
            ck('끝난 로그인 기록: 성적 요청의 시도 0(어느 자격으로도)', zero(scoresOf(cx, from).length));
        } finally {
            const back = await pause('restore-session', { sid }, { revertOf: 'expire-session' });
            ck('원복 확인: 로그인 기록을 되돌렸다는 답', !!back && back.reverted === true ? true : null);
        }
        people.setRestart([]);
    });

    // ---- S5 (ㅁ) ----
    await runCase('S5', '(ㅁ) 점검 중(실제 점검 — PT503)·401·403(실행기가 응답을 바꿔 줌): 결과 상태가 맞고, 공개 키 재시도 0, 화면은 "이력 없음"과 같은 모양', async (cx, ck) => {
        // (1) 점검 중: 이미 확인된 B 의 화면이 성적을 읽기 직전에 점검을 켠다(B 는 예외 명단이 아니다)
        people.setRestart(['B']);
        arm(cx, 'member', ['B']);
        const page = await cx.page();
        const rb = await doLogin(cx, page, 'B', { site: OPEN() });
        ck('B: (점검 전) 로그인됨', rb.message === 'success' && rb.moved);
        let reached;
        let release;
        const reachedP = new Promise((r) => { reached = r; });
        const releasedP = new Promise((r) => { release = r; });
        // 신청서 화면의 "기존 신청 확인"(B 의 회원 이메일이 조건인 업무 시도 — 가짜 응답)을 붙잡아, 성적 읽기 앞에서 멈춰 둔다
        cx.hooks.business = { before: async (rec) => { if (rec.account === 'B' && rec.accountBy === 'email' && !rec.probe) { reached(true); await releasedP; } } };
        const from = cx.records.length;
        page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const got = await Promise.race([reachedP, sleep(25000).then(() => false)]);
        await sleep(600);
        ck('점검: 확인된 뒤·성적 읽기 앞에서 화면을 붙잡음(성적 요청의 시도 0)', got ? ((await stateOf(page)).state === 'signed_in' && scoresOf(cx, from).length === 0) : null);
        await pause('maintenance-on', { exception: 'A' }, { needsRevert: true });
        try {
            release();
            delete cx.hooks.business;
            ck('점검: 화면이 이어져 성적 이력의 버튼이 붙음(이력 없이 그대로 진행)', await until(page, BTN, 30000));
            await sleep(700);
            const sc = scoresOf(cx, from);
            ck('점검: 성적 요청이 한 번(회원 자격, JWT 의 사람 = 조건의 사람 = B) — 다시 보내지 않음', sc.length === 1 && permittedAs(sc[0], 'member', 'B') && wentOut(sc[0]));
            ck('점검: **서버가 실제로 준 응답**이 503·PT503(실행기가 바꿔 주지 않음)', sc[0] && sc[0].server ? (sc[0].server.status === 503 && sc[0].server.code === 'PT503' && sc[0].substituted === false) : null);
            ck('점검: 결과 상태 maintenance', (await statusOf(page)) === 'maintenance');
            ck('점검: 공개 키의 성적 요청 0·갱신 0', sc.every((x) => x.credential === 'member') && refreshes(cx, from).length === 0);
            const u = await uiOf(page);
            ck('점검: 화면은 "이력 없음"과 같은 모양(버튼은 있고 미리 채움·새 안내 없음), 불러오기 글에 합성 성적 없음', !!u && u.btn === true && notPrefilled(u) && u.notice === false && histLacks(await historyOf(page), ['A1', 'A2', 'B1']));
        } finally {
            const back = await pause('maintenance-off', {}, { revertOf: 'maintenance-on' });
            ck('원복 확인: 점검을 껐다는 답', !!back && back.reverted === true ? true : null);
        }
        // (2)(3) 서버가 401·403 을 줌 — 실행기가 응답을 바꿔 준다(요청은 실제로 나간다)
        people.setRestart(['A']);
        for (const [label, answer] of [['401(만료가 아닌 코드 PGRST301)', { status: 401, code: 'PGRST301' }], ['403(42501)', { status: 403, code: '42501' }]]) {
            const cx2 = await newCx('S5-' + answer.status);
            try {
                arm(cx2, 'member', ['A']);
                const h = await readWith(cx2, 'A', [answer]);
                ck(`${label}: A 로 로그인돼 성적 응답을 붙잡음`, h.loggedIn && h.got ? true : null);
                ck(`${label}: 붙잡은 동안 학생이 값을 적음`, (await typeAll(h.page)) ? true : null);
                h.release();
                await h.wait();
                const sc = scoresOf(cx2, h.from);
                ck(`${label}: 성적 요청이 한 번에서 끝남(다시 보내지 않음), 회원 자격`, sc.length === 1 && permittedAs(sc[0], 'member', 'A') && wentOut(sc[0]));
                ck(`${label}: 화면이 받은 것은 **실행기가 바꿔 준 응답**(${answer.status}·${answer.code}) — 서버가 실제로 준 응답은 따로 적힘`, !!sc[0] && sc[0].substituted === true && !!sc[0].given && sc[0].given.status === answer.status && sc[0].given.code === answer.code && sc[0].server !== undefined);
                ck(`${label}: 결과 상태 rejected(실패가 ok·0건으로 바뀌지 않음)`, (await statusOf(h.page)) === 'rejected');
                ck(`${label}: 공개 키의 성적 요청 0·갱신 0`, sc.every((x) => x.credential === 'member') && refreshes(cx2, h.from).length === 0);
                ck(`${label}: 적던 값 그대로·미리 채움 없음·새 안내 없음, 불러오기 글에 합성 성적 없음`, (await typedKept(h.page)) && (await uiOf(h.page)).notice === false && histLacks(await historyOf(h.page), ['A1', 'A2', 'B1']));
            } finally {
                cx.records.push(...cx2.records);
                await cx2.context.close().catch(() => {});
            }
        }
        people.setRestart([]);
    });

    // ---- S6 (ㅂ) ----
    await runCase('S6', '(ㅂ) 만료의 다섯 갈래(실행기가 첫 성적 응답을 만료로 바꿔 줌): 갈래마다 다시 보낸 횟수가 정해진 수에서 끝남, 공개 키 재시도 0, 적던 값 불변', async (cx, ck) => {
        people.setRestart(['A']);
        const branch = async (label, fn) => {
            const cx2 = await newCx('S6-' + label);
            try { arm(cx2, 'member', ['A', 'B']); await fn(cx2); } finally { cx.records.push(...cx2.records); await cx2.context.close().catch(() => {}); }
        };
        const common = (label, cx2, h, sc) => {
            ck(`${label}: 첫 성적 응답은 **실행기가 바꿔 준 만료**(401·PGRST303) — 서버가 실제로 준 응답은 따로 적힘`, !!sc[0] && sc[0].substituted === true && !!sc[0].given && sc[0].given.status === 401 && sc[0].given.code === 'PGRST303');
            ck(`${label}: 성적 요청은 전부 회원 자격·JWT 의 사람 = 조건의 사람 = A(공개 키 재시도 0)`, sc.length >= 1 && sc.every((x) => permittedAs(x, 'member', 'A')));
        };
        // (1) 갱신 성공 → 다시 확인 → 한 번만 다시 보내 성공
        let onUi = null;
        let onHist = null;
        await branch('갱신 성공', async (cx2) => {
            const label = '갱신 성공';
            const h = await readWith(cx2, 'A', [EXPIRED, null]);
            ck(`${label}: A 로 로그인돼 성적 응답을 붙잡음`, h.loggedIn && h.got ? true : null);
            ck(`${label}: 붙잡은 동안 학생이 이력 칸에 값을 적음`, (await typeInto(h.page, HIST, TYPED_HIST)) ? true : null);
            h.release();
            await h.wait();
            const sc = scoresOf(cx2, h.from);
            common(label, cx2, h, sc);
            ck(`${label}: 성적 요청이 "처음 1 + 다시 1"에서 끝남`, sc.length === 2 && sc.every(wentOut));
            ck(`${label}: 갱신이 한 번(실제로 나감)`, refreshes(cx2, h.from).length === 1);
            ck(`${label}: 다시 보낸 것은 서버의 응답 그대로(200, A 의 합성 행 둘)`, !!sc[1] && sc[1].substituted === false && rowsAre(sc[1], 2, 0) === true);
            ck(`${label}: 결과 상태 ok, 로그인 상태 그대로(signed_in)`, (await statusOf(h.page)) === 'ok' && (await stateOf(h.page)).state === 'signed_in');
            onUi = await uiOf(h.page);
            ck(`${label}: 적던 값(이력 칸) 그대로, 점수 칸은 A2 로 채워짐`, (await valueOf(h.page, HIST)) === TYPED_HIST && prefilled(onUi, LATEST.A));
            onHist = await historyOf(h.page);
        });
        const off = await offResult(cx, 'A');
        ck('갱신 성공: 판정 (ii) — 화면 결과가 꺼진 화면의 결과와 같음', onUi && off.ui ? (JSON.stringify(onUi) === JSON.stringify(off.ui) && onHist === off.hist) : null);
        // (2) 갱신 실패(실행기가 갱신의 응답을 줌 — 그 갱신은 서버로 나가지 않는다)
        await branch('갱신 실패', async (cx2) => {
            const label = '갱신 실패';
            cx2.hooks.refresh = { before: async () => ({ fulfill: { status: 400, body: JSON.stringify({ code: 'refresh_token_not_found', message: 'zz 실행기가 준 응답' }) } }) };
            const h = await readWith(cx2, 'A', [EXPIRED]);
            ck(`${label}: A 로 로그인돼 성적 응답을 붙잡음`, h.loggedIn && h.got ? true : null);
            ck(`${label}: 붙잡은 동안 학생이 값을 적음`, (await typeAll(h.page)) ? true : null);
            h.release();
            await h.wait();
            await sleep(1500);
            const sc = scoresOf(cx2, h.from);
            common(label, cx2, h, sc);
            ck(`${label}: 성적 요청이 한 번에서 끝남(다시 보내지 않음)`, sc.length === 1);
            ck(`${label}: 갱신은 한 번 시도되고(실행기가 400 을 줌) 되풀이되지 않음`, refreshes(cx2, h.from).length === 1);
            ck(`${label}: 결과 상태 rejected(실패가 ok·0건으로 바뀌지 않음)`, (await statusOf(h.page)) === 'rejected');
            ck(`${label}: 적던 값 그대로·미리 채움 없음`, await typedKept(h.page));
        });
        // (3) 갱신하는 사이 다른 계정으로 바뀜
        await branch('갱신하는 사이 다른 계정', async (cx2) => {
            const label = '갱신하는 사이 다른 계정';
            let reachedR;
            let releaseR;
            const reachedRP = new Promise((r) => { reachedR = r; });
            const releasedRP = new Promise((r) => { releaseR = r; });
            cx2.hooks.refresh = { before: async () => { reachedR(true); await releasedRP; return null; } };
            const h = await readWith(cx2, 'A', [EXPIRED]);
            ck(`${label}: A 로 로그인돼 성적 응답을 붙잡음`, h.loggedIn && h.got ? true : null);
            h.release();
            const gotR = await Promise.race([reachedRP, sleep(25000).then(() => false)]);
            ck(`${label}: 만료 뒤의 갱신을 보내기 전에 붙잡음`, gotR ? true : null);
            const p2 = await cx2.page();
            const rb = await doLogin(cx2, p2, 'B', { site: OPEN() });
            ck(`${label}: 다른 탭이 B 로 로그인됨`, rb.message === 'success' && rb.moved);
            const mark = cx2.records.length;
            releaseR();
            delete cx2.hooks.refresh;
            await sleep(4000);
            await settled(h.page, 30000);
            await sleep(1200);
            const sc = scoresOf(cx2, h.from);
            common(label, cx2, h, sc);
            ck(`${label}: A 가 시작한 흐름의 성적 요청이 한 번에서 끝남(다시 보내지 않음)`, gotR ? sc.filter((x) => x.scoresOwner === 'A').length === 1 : null);
            ck(`${label}: B 로 바뀐 뒤 성적 요청의 시도 0 — A 의 흐름이 B 의 JWT 로 이어 보내지 않음(양성 대조: 이 경우 안에서 A 의 성적 요청에 이름표가 붙음)`, sc.some((x) => x.scoresOwner === 'A') ? scoresOf(cx2, mark).length === 0 : null);
            ck(`${label}: 회원 자격의 성적 요청 가운데 "JWT 의 사람 ≠ 조건의 사람"인 것 0`, sc.every((x) => x.credential !== 'member' || x.scoresJwt === x.scoresOwner));
            const u = await uiOf(h.page);
            ck(`${label}: 그 탭의 점수 칸에 A 의 성적이 들어가지 않음`, !!u && u.total !== String(LATEST.A.overall) && u.reading !== String(LATEST.A.reading) && u.yes === false);
            cx.notes = { tabAfterSwitch: onPage(h.page, 'application-form.html') ? 'application-form.html' : (onPage(h.page, 'login.html') ? 'login.html' : 'other') };
        });
        // (4) 다시 보낸 것도 만료
        await branch('다시 보낸 것도 만료', async (cx2) => {
            const label = '다시 보낸 것도 만료';
            const h = await readWith(cx2, 'A', [EXPIRED, EXPIRED]);
            ck(`${label}: A 로 로그인돼 성적 응답을 붙잡음`, h.loggedIn && h.got ? true : null);
            ck(`${label}: 붙잡은 동안 학생이 값을 적음`, (await typeAll(h.page)) ? true : null);
            h.release();
            await h.wait();
            await sleep(1500);
            const sc = scoresOf(cx2, h.from);
            common(label, cx2, h, sc);
            ck(`${label}: 성적 요청이 둘에서 끝남(둘째도 실행기가 만료로 바꿔 줌)`, sc.length === 2 && !!sc[1] && sc[1].substituted === true);
            ck(`${label}: 갱신이 한 번에서 끝남`, refreshes(cx2, h.from).length === 1);
            ck(`${label}: 결과 상태 rejected`, (await statusOf(h.page)) === 'rejected');
            ck(`${label}: 적던 값 그대로·미리 채움 없음`, await typedKept(h.page));
        });
        // (5) 통신 시간 초과: 성적 응답을 화면이 기다리는 상한(15초)보다 오래 붙잡아 둔다
        await branch('통신 시간 초과', async (cx2) => {
            const label = '통신 시간 초과';
            const h = await readWith(cx2, 'A', [null]);
            ck(`${label}: A 로 로그인돼 성적 응답을 붙잡음`, h.loggedIn && h.got ? true : null);
            ck(`${label}: 붙잡은 동안 학생이 값을 적음`, (await typeAll(h.page)) ? true : null);
            let st = null;
            for (let i = 0; i < 50 && st !== 'unknown'; i++) { await sleep(500); st = await statusOf(h.page); }
            ck(`${label}: 응답을 붙잡아 둔 채 상한을 넘기자 결과 상태 unknown`, st === 'unknown');
            ck(`${label}: 그때 적던 값 그대로·미리 채움 없음`, await typedKept(h.page));
            if (h.firstRecord()) h.firstRecord().heldPastTimeout = true;      // 표에 적는다: 화면이 기다리기를 그만둔 뒤에야 넘긴 응답이다
            h.release();              // 뒤늦게 서버의 응답이 도착한다
            await sleep(2500);
            const sc = scoresOf(cx2, h.from);
            ck(`${label}: 성적 요청은 전부 회원 자격·JWT 의 사람 = 조건의 사람 = A(공개 키 재시도 0)`, sc.length >= 1 && sc.every((x) => permittedAs(x, 'member', 'A')));
            ck(`${label}: 성적 요청이 한 번에서 끝남·갱신 0`, sc.length === 1 && refreshes(cx2, h.from).length === 0);
            ck(`${label}: 뒤늦은 응답이 반영되지 않음(상태 unknown 그대로, 적던 값 그대로)`, (await statusOf(h.page)) === 'unknown' && (await typedKept(h.page)));
        });
        people.setRestart([]);
    });

    // ---- S7 (ㅅ) ----
    await runCase('S7', '(ㅅ) A 의 성적 응답을 붙잡아 둔 채 다른 탭에서 B 로 바뀜 → 응답을 풀어도 B 의 화면·적던 값에 A 의 성적이 들어가지 않음, A 의 흐름이 B 의 JWT 로 이어 보내지 않음', async (cx, ck) => {
        people.setRestart(['A', 'B']);
        arm(cx, 'member', ['A', 'B']);
        const h = await readWith(cx, 'A', [null]);
        const p1 = h.page;
        // 사슬: ① A 의 성적 응답을 실제로 붙잡음 → ② 그 탭이 B 의 화면이 되고 B 가 값을 적음 → ③ 붙잡은 응답을 풂 → ④ B 의 화면·값. 앞 고리가 성립하지 않으면 ④는 미확인
        ck('사슬 ①: A 로 로그인돼, A 의 성적 요청이 나가고 그 응답을 붙잡음', h.loggedIn && h.got ? true : null);
        const first = scoresOf(cx, h.from)[0];
        ck('사슬 ①: 그 요청은 회원 자격, JWT 의 사람 = 조건의 사람 = A', permittedAs(first, 'member', 'A'));
        const draftA = 'zzA 가 적던 값';
        const draftB = 'zzB 가 적는 값';
        ck('A 가 이력 칸에 값을 적어 둠', (await typeInto(p1, HIST, draftA)) ? true : null);
        const p2 = await cx.page();
        const rb = await doLogin(cx, p2, 'B', { site: OPEN() });
        ck('다른 탭: B 로 로그인됨', rb.message === 'success' && rb.moved);
        const mark = cx.records.length;
        await sleep(2500);
        ck('B 로그인 뒤(새로 고치기 전): 그 탭에 A 가 적던 값이 없음', (await valueOf(p1, HIST)) !== draftA ? true : ((await hidden(p1)) === true ? true : false));
        // 사용자가 그 탭을 새로 고친다 → B 의 재시작 신청 화면(B 의 성적은 B 의 JWT 로 읽는다)
        await p1.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        const isB = await until(p1, BTN, 30000);
        await sleep(900);
        const nameB = people.nameOf('B');
        const nameOk = people.known('B') && nameB ? (await valueOf(p1, '#applicantName')) === nameB : null;
        ck('사슬 ②: 새로 고친 그 탭이 B 의 재시작 신청 화면(계정 칸이 my_profile 에서 본 B 의 이름)', all(isB, nameOk));
        const typedB = await typeInto(p1, HIST, draftB);
        ck('사슬 ②: B 가 이력 칸에 값을 적어 둠', typedB ? true : null);
        const before = await uiOf(p1);
        h.release();
        await sleep(3000);
        const chain = h.got === true && isB === true && nameOk === true && typedB === true;
        const late = (v) => (chain ? v : null);
        const after = await uiOf(p1);
        ck('사슬 ③④: 붙잡아 둔 A 의 응답을 푼 뒤 — B 가 적던 값이 그대로', late((await valueOf(p1, HIST)) === draftB));
        ck('사슬 ④: B 의 점수 칸은 B 의 합성 성적 그대로(A 의 성적이 들어가지 않음), 화면을 다시 받지 않음', late(prefilled(after, LATEST.B) && JSON.stringify(after) === JSON.stringify(before)));
        const hist = await historyOf(p1);
        ck('사슬 ④: 불러오기 글에 B 의 것만 있고 A 의 성적이 없음', late(histHas(hist, ['B1']) && histLacks(hist, ['A1', 'A2'])));
        const sc = scoresOf(cx, h.from);
        ck('회원 자격의 성적 요청 가운데 "JWT 의 사람 ≠ 조건의 사람"인 것 0(양성 대조: A 의 것과 B 의 것이 각각 이름표와 함께 관측됨)', sc.some((x) => x.scoresOwner === 'A') && sc.some((x) => x.scoresOwner === 'B') ? sc.every((x) => x.credential === 'member' && x.scoresJwt === x.scoresOwner && x.scores === 'permitted') : null);
        ck('B 로 바뀐 뒤 A 의 회원번호가 조건인 성적 요청의 시도 0(양성 대조: 바뀐 뒤 B 의 것이 이름표와 함께 관측됨)', scoresOf(cx, mark).some((x) => x.scoresOwner === 'B') ? scoresOf(cx, mark).every((x) => x.scoresOwner !== 'A') : null);
        ck('A 의 성적 요청은 한 번뿐(다시 보내지 않음), 공개 키의 성적 요청 0', sc.filter((x) => x.scoresOwner === 'A').length === 1 && sc.every((x) => x.credential === 'member'));
        cx.notes = { lateResponseChain: chain };
        people.setRestart([]);
    });

    // ---- S8 (ㅇ) ----
    await runCase('S8', '(ㅇ) 꺼짐 대조: 공개 키, 지금과 글자까지 같은 요청', async (cx, ck) => {
        people.setRestart(['A']);
        ck('A 의 값을 앎(my_profile 을 본 적이 있음)', (await know(cx, 'A')) ? true : null);
        const from = cx.records.length;
        const off = await offResult(cx, 'A');
        ck('꺼진 화면: 성적 요청이 한 번 — 공개 키로, 실행기가 따로 적어 둔 "지금의 요청"과 글자까지 같음, 조건의 값이 A 의 회원번호', off.known ? (off.scores.length === 1 && permittedAs(off.scores[0], 'anon', 'A') && wentOut(off.scores[0])) : null);
        ck('꺼진 화면: 서버가 실제로 준 응답이 200, A 의 합성 행 둘(익명 역할의 규칙이 남아 있다 — 공개 키로 읽힌다)', off.known ? rowsAre(off.scores[0], 2, 0) : null);
        ck('꺼진 화면: 회원 자격의 성적 요청 0·인증 모듈의 요청 0', off.known ? (scoresOf(cx, from).every((x) => x.credential === 'anon') && off.auth === 0) : null);
        ck('꺼진 화면: 점수 칸이 A2 로 채워지고 불러오기 글에 A 의 합성 성적 둘', off.known ? (prefilled(off.ui, LATEST.A) && histHas(off.hist, ['A1', 'A2']) && histLacks(off.hist, ['B1'])) : null);
        people.setRestart([]);
    });

    // ---- S9 (ㅈ) ----
    await runCase('S9', '(ㅈ) 3C-1 켜짐 + 성적 읽기 닫힘: 확인 뒤 공개 키로 3C-1 의 켜짐과 같은 조회(회원 자격의 성적 요청 0)', async (cx, ck) => {
        people.setRestart(['A']);
        arm(cx, 'anon', ['A']);
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A', { site: ON() });
        ck('A 로 로그인됨(켜짐 — 성적 읽기는 닫힘)', r.message === 'success' && r.moved);
        const d = await heldAuth(cx, page, () => page.goto(ON() + FORM, { waitUntil: 'domcontentloaded' }));
        ck('확인 응답을 붙잡음(상태 restoring)', d.reached && d.state === 'restoring' ? true : (d.reached ? false : null));
        ck('확인 전(붙잡은 동안): 성적 요청의 시도 0', d.reached ? d.scores === 0 : null);
        await d.release();
        ck('확인 뒤: 성적 이력의 버튼이 붙음', await until(page, BTN, 25000));
        await sleep(700);
        const sc = scoresOf(cx, d.from);
        ck('확인 뒤: 성적 요청이 한 번 — 공개 키로, "지금의 요청"과 글자까지 같음, 조건의 값이 A 의 회원번호', sc.length === 1 && permittedAs(sc[0], 'anon', 'A') && wentOut(sc[0]));
        ck('회원 자격의 성적 요청(시도) 0(양성 대조: 이 경우 안에서 A 의 회원번호가 조건인 성적 요청에 이름표가 붙음)', sc.some((x) => x.scoresOwner === 'A') ? sc.every((x) => x.credential !== 'member') : null);
        ck('전송 담당 함수가 불리지 않음(마지막 상태 없음)', (await statusOf(page)) === null);
        const on = { ui: await uiOf(page), hist: await historyOf(page) };
        const off = await offResult(cx, 'A');
        ck('화면 결과가 꺼진 화면의 결과와 같음', on.ui && off.ui ? (JSON.stringify(on.ui) === JSON.stringify(off.ui) && on.hist === off.hist && prefilled(on.ui, LATEST.A)) : null);
        people.setRestart([]);
    });

    // ---- S10 (ㅊ) ----
    await runCase('S10', '(ㅊ) 성적 읽기 열림인데 인증 모듈을 받지 못한 켜진 화면: 성적 요청의 시도 0', async (cx, ck) => {
        people.setRestart(['A']);
        arm(cx, 'member', ['A']);
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A', { site: OPEN() });
        ck('A 로 로그인됨', r.message === 'success' && r.moved);
        await page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await until(page, BTN, 25000);
        await sleep(500);
        const control = scoresOf(cx).some((x) => x.scoresOwner === 'A' && x.scores === 'permitted');
        ck('양성 대조: 모듈을 받은 같은 화면은 성적 요청을 내고, 그 요청에 A 의 회원번호의 이름표가 붙음', control);
        cx.dropAuthModule = true;
        const from = cx.records.length;
        await page.goto(OPEN() + FORM, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(3000);
        ck('인증 모듈이 없는 켜진 화면(시험이 그 파일을 막음)', await page.evaluate(() => typeof window.EonAuth === 'undefined' && window.EonLogin.on() === true && window.EonLogin.missing() === true).catch(() => null));
        ck('그 화면에 남고 임시 안내(로그인 상태를 확인할 수 없음 또는 닫힘 안내)', onPage(page, 'application-form.html') && ((await noticeHas(page, MISSING_TEXT)) === true || (await noticeHas(page, CLOSED_TEXT)) === true));
        ck('성적 요청의 시도 0(어느 자격으로도)', control ? scoresOf(cx, from).length === 0 : null);
        ck('성적 이력의 버튼이 없음·점수 칸이 비어 있음', notPrefilled(await uiOf(page)) && (await uiOf(page)).btn === false);
        cx.dropAuthModule = false;
        people.setRestart([]);
    });

    void vault;
    void disarm;
}
