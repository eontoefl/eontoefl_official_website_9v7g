// 화면 시험에서 요청을 "보내기 전에 가르는" 차단기와 "가려서 기록하기".
// 이 파일은 요청을 보내지 않는다 — 가로챈 요청 하나를 받아 "계속/중단"과 기록 한 줄을 돌려줄 뿐이다.
// 쓰는 곳: tests/auth-session/screen.mjs (화면 시험 실행기 — 모든 요청이 이 결정을 거친 뒤에만 나간다).
//
// 규칙
//   * 허용 밖의 목적지는 전송 전에 중단한다(화면 이동·폼 제출·새 창 포함).
//   * 자격의 종류와 용도가 맞아야 한다 — 맞지 않으면 목적지가 시험 프로젝트여도 전송 전에 중단한다:
//       비밀번호 → 로그인 요청에만 / 갱신값 → 갱신 요청에만 / 회원 JWT → 로그아웃(scope=local)과 두 RPC 에만
//       service_role·알 수 없는 자격 → 어디로도 보내지 않는다
//   * 기록에는 자유 형식의 글자(주소·경로·키 이름·값)를 남기지 않는다. 정해 둔 이름과 참/거짓만 남긴다.

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

export function makeDecider({ selfOrigins, anonKey }) {
    const selves = new Set([].concat(selfOrigins || []));
    if (!selves.size) throw new Error('selfOrigins 가 필요하다');
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
        if (cred === 'service_role') problems.push('service_role');
        if (cred === 'other') problems.push('unknown_credential');
        const leak = problems.length > 0;
        const publicRetry = where === 'test-project' && (target === 'my_profile' || target === 'my_site_access') && cred !== 'member';

        // 시험 프로젝트로 가는 것이라도 화면 이동(최상위·폼)은 이 조각에 없다 → 중단
        const placeOk = where === 'self' || where === 'local' || where === 'static-allowed' || (where === 'test-project' && !nav);
        const allowed = placeOk && !leak;
        return {
            action: allowed ? 'continue' : 'abort',
            record: {
                where, target, nav, type, method,
                apikey: headerOf(req.headers, 'apikey') !== null,
                credential: cred,
                password: items.password,
                refreshToken: items.refreshToken,
                leak,
                leakKinds: problems,
                publicRetry,
                aborted: !allowed,
            },
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
    };
}
