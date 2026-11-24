// 화면 시험에서 브라우저 자동화가 쓰는 "보내기 전에 가르기"와 "가려서 기록하기".
// 이 파일은 요청을 보내지 않는다 — 자동화가 가로챈 요청 하나를 받아 "계속/중단"과 기록 한 줄을 돌려줄 뿐이다.
//
// 쓰는 법(Playwright 계열의 예 — 브레인방의 자동화에 맞게):
//   import { makeDecider, summarize } from './request-log.mjs';
//   const decide = makeDecider({ selfOrigin: 'http://127.0.0.1:8787', anonKey: process.env.B3A_TEST_ANON_KEY });
//   const records = [];
//   await context.route('**/*', async (route) => {
//       const r = route.request();
//       const d = decide({ url: r.url(), method: r.method(), headers: r.headers(), postData: r.postData(),
//                          resourceType: r.resourceType(), isNavigation: r.isNavigationRequest() });
//       records.push(d.record);
//       if (d.action === 'abort') return route.abort('blockedbyclient');     // 전송 전에 중단
//       return route.continue();
//   });
//   … 시험 …   console.log(summarize(records));
//
// 기록에는 비밀번호·JWT·갱신값을 남기지 않는다: 자격은 "있음/없음"과 종류만, 본문은 키 이름만.

import { TEST_URL } from './rewrite.mjs';
import { STATIC_ALLOW } from './serve-core.mjs';

export const MEMBER_TARGETS = [
    'POST /auth/v1/token?grant_type=password',
    'POST /auth/v1/token?grant_type=refresh_token',
    'POST /auth/v1/logout?scope=local',
    'POST /rest/v1/rpc/my_profile',
    'POST /rest/v1/rpc/my_site_access',
];

const STATIC_TYPES = { stylesheet: STATIC_ALLOW.style, font: STATIC_ALLOW.font, image: STATIC_ALLOW.img };

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

// 본문에서 값은 버리고 키 이름만(비밀번호·갱신값이 기록에 남지 않게)
export function bodyKeys(postData) {
    if (postData === null || postData === undefined || postData === '') return [];
    try {
        const parsed = JSON.parse(String(postData));
        if (parsed && typeof parsed === 'object') return Object.keys(parsed).sort();
        return ['(JSON 값)'];
    } catch (e) {
        try { return [...new URLSearchParams(String(postData)).keys()].sort(); } catch (_) { return ['(읽지 못함)']; }
    }
}

// 주소에서 꼬리표의 값은 버린다(grant_type·scope 만 남긴다 — 허용 목록 판정에 필요)
export function safeUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        const keep = [];
        for (const [k, v] of u.searchParams) keep.push(k === 'grant_type' || k === 'scope' ? `${k}=${v}` : `${k}=…`);
        return u.origin + u.pathname + (keep.length ? '?' + keep.join('&') : '');
    } catch (e) { return '(주소 아님)'; }
}

export function makeDecider({ selfOrigin, anonKey }) {
    if (!selfOrigin) throw new Error('selfOrigin 이 필요하다');
    return function decide(req) {
        let u = null;
        try { u = new URL(req.url); } catch (e) { u = null; }
        const method = String(req.method || 'GET').toUpperCase();
        const type = String(req.resourceType || 'other');
        const nav = !!req.isNavigation;
        const local = !!u && (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:');
        let where;
        if (!u) where = 'outside';
        else if (local) where = 'local';
        else if (u.origin === selfOrigin) where = u.pathname.startsWith('/__b3a/sink') ? 'sink' : 'self';
        else if (u.origin === TEST_URL) where = 'test-project';
        else if (!nav && method === 'GET' && STATIC_TYPES[type] && STATIC_TYPES[type].includes(u.origin)) where = 'static-allowed';
        else where = 'outside';

        const cred = credentialKind(req.headers, anonKey);
        const keys = bodyKeys(req.postData);
        const secretBody = keys.includes('password') || keys.includes('refresh_token');
        const route = u ? `${method} ${u.pathname}${u.search && /^(\?grant_type=[a-z_]+|\?scope=[a-z]+)$/.test(u.search) ? u.search : (u.search ? '?…' : '')}` : '';
        const memberTarget = where === 'test-project' && MEMBER_TARGETS.includes(route);
        // 시험 프로젝트로 가는 것이라도 화면 이동(최상위·폼)은 이 조각에 없다 → 중단
        const allowed = where === 'self' || where === 'local' || where === 'static-allowed' || (where === 'test-project' && !nav);
        return {
            action: allowed ? 'continue' : 'abort',
            record: {
                where, nav, type, method,
                // 바깥 주소는 출처만 남긴다(경로에 비밀이 들어갈 수 있다 — 봇 토큰·웹훅 번호)
                url: local ? u.protocol : (where === 'outside' ? (u ? u.origin : '(주소 아님)') : safeUrl(req.url)),
                apikey: headerOf(req.headers, 'apikey') === null ? '없음' : '있음',
                credential: cred,
                bodyKeys: keys,
                memberTarget,
                // 회원 자격(또는 비밀번호·갱신값)이 허용 목록 밖으로 실렸는가
                leak: (cred === 'member' || secretBody) && !memberTarget,
                // 회원 자격이 필요한 주소에 공개 키로 나갔는가(거절 뒤 공개 키 재시도)
                publicRetry: where === 'test-project' && /\/rest\/v1\/rpc\/my_(profile|site_access)$/.test(u.pathname) && cred !== 'member',
                aborted: !allowed,
            },
        };
    };
}

// 통과 기준의 숫자들. 전부 0 이어야 하는 것: leak, publicRetry, outsideSent, sink, serviceRole.
export function summarize(records) {
    const is = (fn) => records.filter(fn).length;
    return {
        total: records.length,
        self: is((r) => r.where === 'self'),
        testProject: is((r) => r.where === 'test-project'),
        memberTargets: is((r) => r.memberTarget),
        staticAllowed: is((r) => r.where === 'static-allowed'),
        leak: is((r) => r.leak),
        publicRetry: is((r) => r.publicRetry),
        serviceRole: is((r) => r.credential === 'service_role'),
        sink: is((r) => r.where === 'sink'),
        // 허용 밖으로 가려던 것: 전부 전송 전에 중단돼야 한다(aborted). 중단되지 않은 것이 outsideSent.
        outsideBlockedNavigation: is((r) => r.where === 'outside' && r.nav && r.aborted),
        outsideBlockedRequest: is((r) => r.where === 'outside' && !r.nav && r.aborted),
        outsideSent: is((r) => (r.where === 'outside' || (r.where === 'test-project' && r.nav)) && !r.aborted),
    };
}
