// 화면 시험용 로컬 서버의 몸통(소켓 없이 "요청 → 응답"만 계산한다 — serve.mjs 가 127.0.0.1 에 묶어 쓴다).
//
// * 작업 브랜치의 파일을 내주되, 켜짐·꺼짐 어느 쪽이든 Supabase 주소와 공개 키는 시험 프로젝트의 값으로 바꾼 사본을 내준다.
// * 내줄 사본에 운영 ref·운영 주소·운영 키가 남아 있으면 그 파일은 내주지 않는다(409).
// * 응답마다 내용 보안 정책을 붙여, 브라우저의 연결·폼 제출이 자기 자신과 시험 프로젝트 출처로만 가게 한다.
// * 이 서버는 바깥으로 요청을 보내지 않는다. 기록에는 머리글·본문을 남기지 않는다.

import { TEST_URL, transformForServe, switchValue, AUTH_FILE } from './rewrite.mjs';

// 읽기 전용 정적 자원의 허용 목록(index.html·login.html 이 실제로 쓰는 것만)
export const STATIC_ALLOW = {
    style: ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
    font: ['https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'],
    img: ['https://eontoefl.github.io'],
};

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

// .vercelignore 의 줄(배포에서 빠지는 것)은 이 서버도 내주지 않는다
export function makeIgnore(vercelignoreText) {
    const rules = String(vercelignoreText || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return (rel) => rules.some((rule) => {
        if (rule.startsWith('**/')) {
            const rest = rule.slice(3);
            if (rest.endsWith('/')) return rel.startsWith(rest) || rel.includes('/' + rest);
            const re = new RegExp('^' + rest.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
            return re.test(rel.split('/').pop());
        }
        if (rule.endsWith('/')) return rel.startsWith(rule);
        return rel === rule;
    });
}

export function cspHeader() {
    return [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        `style-src 'self' 'unsafe-inline' ${STATIC_ALLOW.style.join(' ')}`,
        `font-src 'self' data: ${STATIC_ALLOW.font.join(' ')}`,
        `img-src 'self' data: blob: ${STATIC_ALLOW.img.join(' ')}`,
        "media-src 'self'",
        `connect-src 'self' ${TEST_URL}`,
        "form-action 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "worker-src 'self' blob:",
        "base-uri 'self'",
        'report-uri /__b3a/csp-report',
    ].join('; ');
}

// 기록에는 자유 형식의 글자를 남기지 않는다: 막힌 주소는 "어느 무리인가"만, 지시어는 정해 둔 이름만.
const DIRECTIVES = ['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr',
    'font-src', 'img-src', 'media-src', 'connect-src', 'form-action', 'frame-src', 'object-src', 'worker-src', 'base-uri'];
const STATIC_ORIGINS = new Set([...STATIC_ALLOW.style, ...STATIC_ALLOW.font, ...STATIC_ALLOW.img]);
function originClass(value, selfOrigin) {
    const text = String(value || '');
    if (/^(inline|eval|data|blob|about)$/.test(text)) return 'local';
    let u;
    try { u = new URL(text); } catch (e) { return 'unknown'; }
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return 'local';
    if (u.origin === selfOrigin) return 'self';
    if (u.origin === TEST_URL) return 'test-project';
    if (STATIC_ORIGINS.has(u.origin)) return 'static-allowed';
    return 'outside';
}

// config: { files(Set 또는 배열 — 내줄 수 있는 상대 경로), readFile(rel) → Buffer|null, mode, testKey, port, prod: { url, key }, log(entry) }
export function createCore(config) {
    const mode = config.mode;
    if (mode !== 'on' && mode !== 'off') throw new Error('mode 는 on 또는 off');
    const files = new Set(config.files);
    const selfOrigin = `http://127.0.0.1:${config.port}`;
    const sinkUrl = `${selfOrigin}/__b3a/sink/testroom`;
    const counts = { served: 0, refused: 0, notFound: 0, sink: 0, probe: 0, csp: 0, bad: 0 };
    const refusedSeen = new Set();
    const log = (entry) => { if (config.log) config.log(Object.assign({ ts: new Date().toISOString(), mode }, entry)); };
    const opts = { mode, testUrl: TEST_URL, testKey: config.testKey, sinkUrl, prodKey: config.prod.key, prodUrl: config.prod.url };
    const baseHeaders = () => ({
        'Content-Security-Policy': cspHeader(),
        // 다시 확인은 하되 보관은 허용한다(no-store 면 브라우저가 뒤로 가기용으로 화면을 보관하지 않아 그 경우를 잴 수 없다)
        'Cache-Control': 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-B3a-Mode': mode,
    });
    const text = (status, body, extra) => ({ status, headers: Object.assign(baseHeaders(), { 'Content-Type': 'text/plain; charset=utf-8' }, extra || {}), body: Buffer.from(body, 'utf8') });

    function transform(rel) {
        const raw = config.readFile(rel);
        if (raw === null || raw === undefined) return null;
        return transformForServe(rel, raw, opts);
    }

    // 시작할 때 전체를 훑는다: 내주지 않을 파일(운영 흔적이 남는 것)의 목록
    function scan() {
        const refused = [];
        let servable = 0;
        for (const rel of [...files].sort()) {
            const r = transform(rel);
            if (!r) continue;
            if (r.residue.length) refused.push({ file: rel, residue: r.residue }); else servable++;
        }
        const auth = config.readFile(AUTH_FILE);
        return { refused, servable, repoSwitch: auth ? switchValue(auth.toString('utf8')) : null };
    }

    // request: { method, url(경로와 꼬리표), body(Buffer|null) }
    function respond(request) {
        let u;
        try { u = new URL(request.url, `http://127.0.0.1:${config.port}`); } catch (e) { counts.bad++; return text(400, '잘못된 요청'); }
        const rawMethod = String(request.method || 'GET').toUpperCase();
        const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(rawMethod) ? rawMethod : 'OTHER';

        if (u.pathname.startsWith('/__b3a/sink')) {
            // 로컬 시험 목적지: 여기로 온 요청은 "차단기를 지나 실제로 나간 것"이다(차단 시험에서는 0 이어야 한다)
            counts.sink++;
            log({ t: 'sink', method });
            return text(200, '로컬 시험 목적지입니다. 여기로 온 요청은 "바깥으로 나갈 뻔한 것"으로 셉니다.');
        }
        if (u.pathname === '/__b3a/probe') {
            // 수신기가 살아 있음을 보이는 정상 요청(차단하지 않는다)
            counts.probe++;
            log({ t: 'probe', method });
            return text(200, 'ok');
        }
        if (u.pathname === '/__b3a/blank') {
            return { status: 200, headers: Object.assign(baseHeaders(), { 'Content-Type': 'text/html; charset=utf-8' }), body: Buffer.from('<!doctype html><meta charset="utf-8"><title>b3a</title><body></body>', 'utf8') };
        }
        if (u.pathname === '/__b3a/redirect/sink' || u.pathname === '/__b3a/redirect/blank') {
            // 리디렉션이 차단기를 거치는지 보는 데 쓴다
            const to = u.pathname.endsWith('/sink') ? '/__b3a/sink/redirected' : '/__b3a/blank';
            log({ t: 'redirect', to: u.pathname.endsWith('/sink') ? 'sink' : 'blank' });
            return { status: 302, headers: Object.assign(baseHeaders(), { Location: to }), body: Buffer.alloc(0) };
        }
        if (u.pathname === '/__b3a/csp-report') {
            counts.csp++;
            let directive = 'unknown';
            let blocked = 'unknown';
            try {
                const parsed = JSON.parse((request.body || Buffer.alloc(0)).toString('utf8').slice(0, 65536));
                const r = Array.isArray(parsed) ? (parsed[0] && parsed[0].body) || {} : parsed['csp-report'] || {};
                const d = String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || '').split(' ')[0];
                directive = DIRECTIVES.includes(d) ? d : 'other';
                blocked = originClass(r['blocked-uri'] || r.blockedURL || '', selfOrigin);
            } catch (e) { directive = 'unreadable'; }
            log({ t: 'csp', directive, blocked });   // 막힌 것의 기록일 뿐 — 이 서버가 대신 보내지 않는다
            return { status: 204, headers: baseHeaders(), body: Buffer.alloc(0) };
        }
        if (u.pathname === '/__b3a/status') {
            return { status: 200, headers: Object.assign(baseHeaders(), { 'Content-Type': 'application/json; charset=utf-8' }), body: Buffer.from(JSON.stringify({ mode, counts, refused: [...refusedSeen].sort(), testUrl: TEST_URL, sink: sinkUrl }), 'utf8') };
        }
        if (method !== 'GET' && method !== 'HEAD') { counts.bad++; log({ t: 'bad', method }); return text(405, '이 서버는 파일을 읽어 주기만 합니다.'); }

        let rel;
        try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch (e) { counts.bad++; return text(400, '잘못된 경로'); }
        if (rel === '') rel = 'index.html';
        if (rel.includes('..') || rel.includes('\\') || rel.includes('\0') || !files.has(rel)) {
            counts.notFound++;
            log({ t: 'notfound', method });
            return text(404, '없는 파일');
        }
        let r;
        try { r = transform(rel); } catch (e) {
            counts.refused++;
            refusedSeen.add(rel);
            log({ t: 'refused', method, file: rel, why: 'rewrite-failed' });
            return text(409, '이 파일은 시험 설정으로 바꾸지 못해 내주지 않습니다.');
        }
        if (!r) { counts.notFound++; log({ t: 'notfound', method }); return text(404, '없는 파일'); }
        if (r.residue.length) {
            counts.refused++;
            refusedSeen.add(rel);
            log({ t: 'refused', method, file: rel, why: 'prod-residue', kinds: r.residue.length });
            return text(409, `이 파일은 내주지 않습니다: 응답에 ${r.residue.join(', ')}이(가) 남아 있습니다.`);
        }
        counts.served++;
        log({ t: 'file', method, file: rel, rewritten: r.changed.length > 0 });   // file 은 저장소의 파일 목록에 있는 이름이다
        const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
        return {
            status: 200,
            headers: Object.assign(baseHeaders(), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': String(r.body.length) }),
            body: method === 'HEAD' ? Buffer.alloc(0) : r.body,
        };
    }

    return { respond, scan, counts, sinkUrl, selfOrigin, csp: cspHeader() };
}
