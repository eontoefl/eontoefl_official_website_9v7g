// 계약 3C-2a 의 회귀시험이 쓰는 가짜 세계: 성적 표(toefl_actual_scores)와 재시작 신청 화면에 필요한 가짜 업무 응답.
// 전부 가짜다 — 실제 네트워크 요청은 없다. 여기의 "규칙"은 시험 프로젝트에서 읽은 것(로그인 역할은 본인·관리자만,
// 익명 역할은 전부 허용)을 흉내 낸 것이고, 실제 서버가 그렇게 답한다는 증거가 아니다.
//
// 3C-1 에서 배운 것을 처음부터: 로그인 이메일 ≠ 회원 이메일, 로그인 계정 번호(auth-A) ≠ 회원번호(m-A).

import { ACCOUNTS, makeWorld } from './world.mjs';
import { readFakeJwt } from './fake-supabase.mjs';
import { TEST_URL } from './rewrite.mjs';

export const SCORE_TABLE = 'toefl_actual_scores';
export const SCORE_COLUMNS = ['test_date', 'reading', 'listening', 'speaking', 'writing', 'overall', 'legacy_total'];
// 시험이 따로 적어 둔 "나가야 하는 요청"의 글자(제품의 규약표를 읽지 않는다)
const QUERY = (memberId) => `user_id=eq.${memberId}&select=test_date%2Creading%2Clistening%2Cspeaking%2Cwriting%2Coverall%2Clegacy_total&order=test_date.asc&limit=50`;
export const memberScoresUrl = (memberId) => `${TEST_URL}/rest/v1/${SCORE_TABLE}?${QUERY(memberId)}`;            // 전송 담당 함수가 보내는 모양
export const wrapperScoresPath = (memberId) => `/rest/v1/${SCORE_TABLE}?${QUERY(memberId)}&`;                     // 공개 래퍼(js/supabase-config.js)가 보내는 모양

// 합성 성적 행(전부 지어낸 값). A 는 둘(가장 최근 것이 미리 채움에 쓰인다), B 는 하나, GM 은 없음(성적 0건 회원)
export const SCORE_ROWS = [
    { id: 'score-A-1', user_id: 'm-A', user_email: ACCOUNTS.A.profile.email, user_name: '합성 회원 A', test_date: '2031-01-11', reading: 3, listening: 3, speaking: 3, writing: 3, overall: 3, legacy_total: null, score_image: null, memo: '합성 메모 A1' },
    { id: 'score-A-2', user_id: 'm-A', user_email: ACCOUNTS.A.profile.email, user_name: '합성 회원 A', test_date: '2031-03-13', reading: 4.5, listening: 3.5, speaking: 2.5, writing: 5.5, overall: 4, legacy_total: 81, score_image: null, memo: '합성 메모 A2' },
    { id: 'score-B-1', user_id: 'm-B', user_email: ACCOUNTS.B.profile.email, user_name: '합성 회원 B', test_date: '2031-02-12', reading: 2, listening: 2.5, speaking: 1.5, writing: 2, overall: 2, legacy_total: 45, score_image: null, memo: '합성 메모 B1' },
];

const json = (status, body) => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const MEMBERS = ['A', 'B', 'GM'].map((key) => ({ key, id: ACCOUNTS[key].profile.id, email: ACCOUNTS[key].profile.email, name: ACCOUNTS[key].profile.name, authId: ACCOUNTS[key].authId }));
export const memberOf = (key) => MEMBERS.find((m) => m.key === key);

// 재시작이 허용된 지난 신청서(수강 1). guardFormAccess 가 이것을 찾으면 재시작 신청 화면이 된다
const restartApp = (m) => ({
    id: 'app-prev-' + m.key, email: m.email, user_email: m.email, user_id: m.id, name: m.name, phone: '010-0000-0000', application_type: 'challenge',
    deleted: false, withdrawn_at: null, enrollment_no: 1, restart_allowed_at: '2026-11-01T00:00:00Z', superseded_by: null, restart_materials: [],
    has_toefl_score: 'no', address: '합성 주소', bank_name: '합성은행', account_number: '000-00-000000', account_holder: m.name,
    preferred_program: '', preferred_correction: '', submitted_date: '2026-06-01', created_at: '2026-06-01T00:00:00Z',
});

// 성적 표의 가짜 응답. 자격을 보고 보이는 행을 가린다:
//   공개 키(익명 역할)  전부 보인다(익명 역할의 전체 허용 규칙이 남아 있다)
//   회원 JWT           그 계정의 회원번호가 주인인 행만(관리자·aal2 는 전부). 만료된 JWT 는 401·PGRST303, 점검 중이면 503·PT503
function scoresResponse(w, req, u) {
    const entry = { n: w.scoreLog.length + 1, method: req.method, url: req.url, page: req.page, cred: w.server.credentialKind(req), authId: null, sid: null };
    const bearer = w.server.bearer(req);
    if (entry.cred === 'member') { const c = readFakeJwt(bearer); entry.authId = c.sub; entry.sid = c.session_id; }
    w.scoreLog.push(entry);
    w.server.scoreRows = w.scores;
    return w.server.scoresTable(req, u);        // 규칙의 흉내는 가짜 서버(fake-supabase.mjs)의 것이다
}

// 가짜 업무 응답: 성적 표 + 재시작 신청 화면이 읽는 것(지난 신청서·회원 한 줄). 그 밖은 빈 목록
function memberRest(w) {
    return async (req, u) => {
        const table = u.pathname.replace('/rest/v1/', '');
        const q = u.searchParams;
        const eq = (k) => { const v = q.get(k) || ''; return v.startsWith('eq.') ? v.slice(3) : null; };
        if (table === SCORE_TABLE) {
            const fault = w.scoreFault ? await w.scoreFault(req, w.scoreLog.length + 1) : null;
            if (fault === 'network') { scoresResponse(w, req, u); throw new TypeError('Failed to fetch'); }
            const real = scoresResponse(w, req, u);
            return fault || real;
        }
        if (req.method !== 'GET') return json(200, [{ id: 'written-1' }]);
        if (table === 'applications') {
            // 붙잡는 것은 신청서 화면의 "기존 신청 확인"(guardFormAccess)과 글자가 같은 조회다(limit 100 — 퍼널의 조회 하나도 같은 글자라 함께 붙잡힌다)
            if (w.applicationsGate && q.get('limit') === '100' && q.get('withdrawn_at') === 'is.null') await w.applicationsGate(req, u);
            const m = MEMBERS.find((x) => x.email === eq('email'));
            return json(200, m && w.restart.includes(m.key) ? [restartApp(m)] : []);
        }
        if (table === 'users') {
            const m = MEMBERS.find((x) => x.email === eq('email') || x.id === eq('id'));
            return json(200, m ? [{ id: m.id, name: m.name, nickname: '합성닉', email: m.email, phone: '010-0000-0000', role: 'user', blocked: false, withdrawal_requested_at: null, intro_book_track: 'regular' }] : []);
        }
        return json(200, []);
    };
}

// variant: world.mjs 의 V.…  /  restart: 재시작이 허용된 회원의 이름표들  /  old: 옛 방식의 로그인 값을 넣을 회원(꺼진 화면용)
export function memberWorld(variant, { mutate, restart = ['A', 'B', 'GM'], scores = SCORE_ROWS, old = null } = {}) {
    const w = makeWorld('빈 브라우저', { variant, mutate });
    w.scores = scores.map((r) => Object.assign({}, r));
    w.restart = restart;
    w.scoreLog = [];
    w.scoreFault = null;
    w.applicationsGate = null;
    w.rest = memberRest(w);
    if (old) {
        const m = memberOf(old);
        w.browser.local.set('iontoefl_user', JSON.stringify({ id: m.id, name: m.name, nickname: '', email: m.email, phone: '010-0000-0000', level: 2, role: 'user' }));
        w.browser.local.set('iontoefl_login_time', String(w.browser.now - 3600000));
        w.initial = new Map(w.browser.local);
    }
    return w;
}

// 화면이 보낸 성적 요청(브라우저의 기록 — 가짜 서버의 기록과 따로)
export const scoreRequests = (w, page) => w.browser.requests.filter((r) => (!page || r.page === page.name) && r.url.includes('/rest/v1/' + SCORE_TABLE));
export function credOf(w, r) {
    const h = r.headers.find(([n]) => n.toLowerCase() === 'authorization');
    const v = h ? h[1] : '';
    if (!v.startsWith('Bearer ')) return { kind: 'none' };
    const token = v.slice(7);
    const c = token.split('.').length === 3 ? readFakeJwt(token) : null;
    if (c && c.role === 'authenticated') return { kind: 'member', authId: c.sub, sid: c.session_id };
    const apikey = r.headers.find(([n]) => n.toLowerCase() === 'apikey');
    return { kind: apikey && apikey[1] === token ? 'anon' : 'other' };
}
