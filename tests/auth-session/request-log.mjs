// 화면 시험에서 요청을 "보내기 전에 가르는" 차단기와 "가려서 기록하기".
// 이 파일은 요청을 보내지 않는다 — 가로챈 요청 하나를 받아 "계속/중단"과 기록 한 줄을 돌려줄 뿐이다.
// 쓰는 곳: tests/auth-session/screen.mjs (화면 시험 실행기 — 모든 요청이 이 결정을 거친 뒤에만 나간다).
//
// 규칙
//   * 허용 밖의 목적지는 전송 전에 중단한다(화면 이동·폼 제출·새 창 포함).
//   * 자격의 종류와 용도가 맞아야 한다 — 맞지 않으면 목적지가 시험 프로젝트여도 전송 전에 중단한다:
//       비밀번호 → 로그인 요청에만 / 갱신값 → 갱신 요청에만 / 회원 JWT → 로그아웃(scope=local)과 두 RPC 에만
//       service_role·알 수 없는 자격 → 어디로도 보내지 않는다
//       회원 JWT 는 발급자가 시험 프로젝트이고 계정이 이번 실행의 합성 계정 가운데 하나일 때만(실행기가 그 기준을 넘겨줄 때)
//   * 기록에는 자유 형식의 글자(주소·경로·키 이름·값)를 남기지 않는다. 정해 둔 이름과 참/거짓만 남긴다.
//   * (계약 3C-1) 시험 프로젝트로 실제 나가는 것은 3A 에서 승인된 인증 요청 다섯뿐이다.
//       그 밖에 시험 프로젝트로 가는 요청(업무 요청 — 표·RPC·파일·함수)은 **전부** 전송 전에 막는다. 고르는 것이 아니다(끄는 인자가 없다).
//       막은 업무 요청에는 실행기가 가짜 응답을 준다(화면의 동작을 보려는 것이다 — 실제 업무 성공으로 세지 않는다).
//       판정은 "시도"로 한다: 시도한 요청의 갈래(쓰기·부분 검색·조건 없는 조회·조건 있는 조회·그 밖)와,
//       조건의 값이 이번 실행의 어느 합성 계정의 것인지(이름표만)를 기록한다.

import { TEST_URL } from './rewrite.mjs';
import { STATIC_ALLOW } from './serve-core.mjs';

// 시험 프로젝트로 가는 요청의 이름(이 밖은 무리 이름으로만 적는다)
const NAMED = {
    'POST /auth/v1/token?grant_type=password': 'login',
    'POST /auth/v1/token?grant_type=refresh_token': 'refresh',
    'POST /auth/v1/logout?scope=local': 'logout',
    'POST /rest/v1/rpc/my_profile': 'my_profile',
    'POST /rest/v1/rpc/my_site_access': 'my_site_access',
};
export const MEMBER_JWT_TARGETS = ['logout', 'my_profile', 'my_site_access'];

// 종류 other 는 파비콘(<link rel="icon">)이다 — 그림의 허용 호스트에만
const STATIC_TYPES = { stylesheet: STATIC_ALLOW.style, font: STATIC_ALLOW.font, image: STATIC_ALLOW.img, other: STATIC_ALLOW.img };
const TYPES = ['document', 'stylesheet', 'image', 'media', 'font', 'script', 'xhr', 'fetch', 'websocket', 'manifest', 'other'];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function claimsOf(token) {
    try {
        const parts = String(token).split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (e) { return null; }
}

function headerOf(headers, lowerName) {
    for (const name of Object.keys(headers || {})) if (name.toLowerCase() === lowerName) return String(headers[name]);
    return null;
}

// Authorization 의 종류(값은 돌려주지 않는다)
export function credentialKind(headers, anonKey) {
    const auth = headerOf(headers, 'authorization');
    if (auth === null) return 'none';
    if (!auth.startsWith('Bearer ')) return 'other';
    const token = auth.slice(7);
    if (anonKey && token === anonKey) return 'anon';
    const c = claimsOf(token);
    if (!c) return 'other';
    if (c.role === 'anon') return 'anon';
    if (c.role === 'authenticated') return 'member';
    if (c.role === 'service_role') return 'service_role';
    return 'other';
}

// 본문에 비밀번호·갱신값이 들어 있는가(값도 키 이름도 돌려주지 않는다)
export function secretItems(postData) {
    const out = { password: false, refreshToken: false };
    if (postData === null || postData === undefined || postData === '') return out;
    const text = String(postData);
    let keys = [];
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') keys = Object.keys(parsed);
    } catch (e) {
        try { keys = [...new URLSearchParams(text).keys()]; } catch (_) { keys = []; }
    }
    const lower = keys.map((k) => String(k).toLowerCase());
    out.password = lower.includes('password') || /"password"\s*:/i.test(text);
    out.refreshToken = lower.includes('refresh_token') || /"refresh_token"\s*:/i.test(text);
    return out;
}

// 시험 프로젝트로 가는 요청의 이름(정해 둔 다섯 또는 무리 이름)
function targetName(method, u) {
    const exact = NAMED[`${method} ${u.pathname}${u.search}`];
    if (exact) return exact;
    if (u.pathname.startsWith('/rest/v1/rpc/')) return 'rest-rpc-other';
    if (u.pathname.startsWith('/rest/v1/')) return 'rest-table';
    if (u.pathname.startsWith('/auth/v1/')) return 'auth-other';
    if (u.pathname.startsWith('/storage/v1/')) return 'storage';
    if (u.pathname.startsWith('/functions/v1/')) return 'functions';
    return 'other';
}

// 업무 요청(시도)의 갈래 — 기록에 적는 이름일 뿐이다. 어느 갈래든 내보내지 않는다.
//   write           쓰기(POST·PATCH·PUT·DELETE — RPC·함수 포함)
//   partial-search  부분 검색·or 조건(이름 검색 등)
//   unconditioned   조건 없는 조회(전체 목록)
//   read            조건 있는 조회
//   other           그 밖(GET 인 RPC·파일 등)
const CONTROL_PARAMS = ['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'];
const PARTIAL_OPS = /^(not\.)?(ilike|like|imatch|match|fts|plfts|phfts|wfts)(\(|\.)/;
export const BUSINESS_KINDS = ['write', 'partial-search', 'unconditioned', 'read', 'other'];
export function businessKind(method, u, target) {
    const m = String(method).toUpperCase();
    if (m !== 'GET' && m !== 'HEAD') return 'write';
    if (target !== 'rest-table') return 'other';
    if (!/^\/rest\/v1\/[A-Za-z0-9_]+$/.test(u.pathname)) return 'other';
    let conditions = 0;
    for (const [k, v] of u.searchParams) {
        if (CONTROL_PARAMS.includes(k)) continue;
        if (k === 'or' || k === 'and' || k === 'not.or' || k === 'not.and' || PARTIAL_OPS.test(v)) return 'partial-search';
        conditions++;
    }
    return conditions === 0 ? 'unconditioned' : 'read';
}
// 조건(eq)의 값이 이번 실행의 어느 합성 계정의 것인가 — 이름표(예: 'A')만 돌려준다. 없으면 'none'
// labels: { 이름표: [그 계정의 값들(이메일·회원번호)] }
export function businessAccount(u, labels) {
    if (!u || !labels) return 'none';
    for (const [, v] of u.searchParams) {
        if (!v.startsWith('eq.')) continue;
        const value = v.slice(3).trim().toLowerCase();
        for (const [label, values] of Object.entries(labels)) {
            if ((values || []).some((x) => typeof x === 'string' && x.length > 0 && x.trim().toLowerCase() === value)) return label;
        }
    }
    return 'none';
}

// issuer·memberEmails(배열 또는 배열을 돌려주는 함수)를 주면 회원 JWT 의 출처도 본다
// accountLabels({ 이름표: [값들] } 또는 그것을 돌려주는 함수)를 주면 업무 요청의 기록에 "어느 합성 계정의 값이 조건인가"를 적는다
// (적는 것뿐이다 — 주든 안 주든 업무 요청은 전부 막는다)
export function makeDecider({ selfOrigins, anonKey, issuer, memberEmails, accountLabels }) {
    const selves = new Set([].concat(selfOrigins || []));
    if (!selves.size) throw new Error('selfOrigins 가 필요하다');
    const emailsNow = () => (typeof memberEmails === 'function' ? memberEmails() : (memberEmails || [])).map((e) => String(e).trim().toLowerCase());
    return function decide(req) {
        let u = null;
        try { u = new URL(req.url); } catch (e) { u = null; }
        const rawMethod = String(req.method || 'GET').toUpperCase();
        const method = METHODS.includes(rawMethod) ? rawMethod : 'OTHER';
        const type = TYPES.includes(String(req.resourceType)) ? String(req.resourceType) : 'other';
        const nav = !!req.isNavigation;
        const local = !!u && (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:');
        let where;
        let target = 'other';
        if (!u) where = 'outside';
        else if (local) where = 'local';
        else if (selves.has(u.origin)) {
            where = 'self';
            if (u.pathname.startsWith('/__b3a/sink')) { where = 'sink'; target = 'sink'; }
            else if (u.pathname.startsWith('/__b3a/')) target = 'test-endpoint';
            else target = 'file';
        } else if (u.origin === TEST_URL) { where = 'test-project'; target = targetName(rawMethod, u); }
        else if (!nav && method === 'GET' && STATIC_TYPES[type] && STATIC_TYPES[type].includes(u.origin)) { where = 'static-allowed'; target = 'static'; }
        else where = 'outside';

        const cred = credentialKind(req.headers, anonKey);
        const items = secretItems(req.postData);
        // 자격의 종류와 용도
        const problems = [];
        if (items.password && !(where === 'test-project' && target === 'login')) problems.push('password');
        if (items.refreshToken && !(where === 'test-project' && target === 'refresh')) problems.push('refresh_token');
        if (cred === 'member' && !(where === 'test-project' && MEMBER_JWT_TARGETS.includes(target))) problems.push('member_jwt');
        if (cred === 'member' && issuer) {
            const c = claimsOf((headerOf(req.headers, 'authorization') || '').slice(7)) || {};
            if (c.iss !== issuer || typeof c.email !== 'string' || !emailsNow().includes(c.email.trim().toLowerCase())) problems.push('foreign_member_jwt');
        }
        if (cred === 'service_role') problems.push('service_role');
        if (cred === 'other') problems.push('unknown_credential');
        const leak = problems.length > 0;
        const publicRetry = where === 'test-project' && (target === 'my_profile' || target === 'my_site_access') && cred !== 'member';

        // 시험 프로젝트로 가는 것이라도 화면 이동(최상위·폼)은 이 조각에 없다 → 중단
        const placeOk = where === 'self' || where === 'local' || where === 'static-allowed' || (where === 'test-project' && !nav);
        const allowed = placeOk && !leak;
        // (계약 3C-1) 업무 요청: 인증 모듈의 다섯 요청이 아닌, 시험 프로젝트로 가는 요청 — 전부 전송 전에 막는다
        const isBusiness = where === 'test-project' && !Object.values(NAMED).includes(target);
        const businessOf = isBusiness ? (u ? businessKind(rawMethod, u, target) : 'other') : null;
        const labels = typeof accountLabels === 'function' ? accountLabels() : accountLabels;
        const businessBlocked = allowed && isBusiness;
        return {
            // fake: 전송 전에 막고, 실행기가 가짜 응답을 준다(보내지 않는다). 자격 위반·허용 밖은 가짜 응답 없이 중단(abort)
            action: !allowed ? 'abort' : (businessBlocked ? 'fake' : 'continue'),
            record: Object.assign(!isBusiness ? {} : { business: businessOf, account: businessAccount(u, labels) }, {
                where, target, nav, type, method,
                apikey: headerOf(req.headers, 'apikey') !== null,
                credential: cred,
                password: items.password,
                refreshToken: items.refreshToken,
                leak,
                leakKinds: problems,
                publicRetry,
                aborted: !allowed || businessBlocked,
            }),
        };
    };
}

// 통과 기준의 숫자들.
//   leakSent·outsideSent 는 차단기의 결정을 센 것이다(차단기가 중단한 것은 "보내지 않은 것"으로 센다).
//   실제로 나가지 않았다는 독립된 증거는 로컬 시험 목적지의 수신 수(서버 쪽 숫자)다.
export function summarize(records) {
    const is = (fn) => records.filter(fn).length;
    const byTarget = {};
    for (const r of records) if (r.where === 'test-project' && !r.aborted) byTarget[r.target] = (byTarget[r.target] || 0) + 1;
    return {
        total: records.length,
        self: is((r) => r.where === 'self' && !r.aborted),
        testProject: is((r) => r.where === 'test-project' && !r.aborted),
        testProjectByTarget: byTarget,
        staticAllowed: is((r) => r.where === 'static-allowed'),
        leakBlocked: is((r) => r.leak && r.aborted),
        leakSent: is((r) => r.leak && !r.aborted),
        publicRetry: is((r) => r.publicRetry && !r.aborted),
        serviceRole: is((r) => r.credential === 'service_role'),
        sinkAttempts: is((r) => r.where === 'sink'),
        outsideBlockedNavigation: is((r) => (r.where === 'outside' || r.where === 'sink' || (r.where === 'test-project' && r.nav)) && r.nav && r.aborted),
        outsideBlockedRequest: is((r) => (r.where === 'outside' || r.where === 'sink') && !r.nav && r.aborted),
        outsideSent: is((r) => (r.where === 'outside' || r.where === 'sink' || (r.where === 'test-project' && r.nav)) && !r.aborted),
        // (계약 3C-1) 업무 요청: 내보낸 것은 0 이어야 한다. 시도는 갈래마다 센다(가짜 응답을 받은 화면은 업무 성공이 아니다)
        businessSent: is((r) => r.business && !r.aborted),
        businessAttempts: Object.fromEntries(BUSINESS_KINDS.map((k) => [k, is((r) => r.business === k)])),
    };
}
