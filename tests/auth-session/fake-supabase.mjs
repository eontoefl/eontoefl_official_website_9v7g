// 가짜 Supabase(로그인 서버 + my_profile·my_site_access). 프로세스 안에서만 돈다 — 실제 서버가 아니다.
// 응답 모양은 계약 3-0 시험에서 실제로 확인된 것(브레인방 전달)과 2-가 마이그레이션의 my_site_access 를 따랐다.
// 로그인·갱신·로그아웃 응답의 모양은 실제 서버에서 확인하지 못한 것이다(틀릴 수 있다).

const b64url = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

// JWT 모양의 가짜 값(서명 자리는 고정 글자). 실제 자격이 아니다.
export function fakeJwt(payload) {
    return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.zzfakesignature`;
}

export function readFakeJwt(token) {
    try {
        const parts = String(token).split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (e) { return null; }
}

const json = (status, body, headers) => ({
    status,
    body: JSON.stringify(body),
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
});

export class FakeSupabase {
    constructor({ origin, anonKey, now }) {
        this.origin = origin;
        this.anonKey = anonKey;
        this.now = now;                 // () => 밀리초
        this.accounts = new Map();      // 이메일 → 계정
        this.sessions = new Map();      // 로그인 기록 번호 → 기록
        this.maintenance = false;
        this.maintenanceExcept = new Set();   // 점검 중에도 통과하는 계정 번호(예외 명단 흉내)
        this.allowedOverride = null;    // my_site_access.allowed 를 강제로
        this.seq = 0;
        this.log = [];                  // 받은 요청
        this.foreign = [];              // 이 가짜 서버의 출처가 아닌 곳으로 온 요청
        this.hooks = {};                // 'after:my_profile' 등
        this.faults = {};               // 'my_profile' → (요청) => 응답 | 'network' | null
        this.business = () => json(200, []);
    }

    addAccount(a) {
        const account = Object.assign({ member: 'ok', admin: false }, a);
        this.accounts.set(account.email, account);
        return account;
    }

    // 시험이 로그인 기록을 직접 만든다(aal2 처럼 화면으로 만들 수 없는 것)
    createSession(email, { aal = 'aal1', expiresIn = 3600 } = {}) {
        const account = this.accounts.get(email);
        const sid = `sess-${++this.seq}`;
        const s = { sid, authId: account.authId, email, aal, alive: true, refresh: `fake-refresh-${sid}-1`, prevRefresh: null, rotatedAt: 0, expiresIn };
        this.sessions.set(sid, s);
        return s;
    }

    // 시험이 로그인 기록을 끝낸다(만료·삭제). code: 그 뒤 갱신에 돌려줄 오류 코드
    endSession(s, code) { s.alive = false; s.endCode = code; }

    tokenBody(s) {
        const nowSec = Math.floor(this.now() / 1000);
        const exp = nowSec + s.expiresIn;
        const access = fakeJwt({ sub: s.authId, session_id: s.sid, role: 'authenticated', aal: s.aal, exp, iat: nowSec, n: ++this.seq });
        return {
            access_token: access,
            token_type: 'bearer',
            expires_in: s.expiresIn,
            expires_at: exp,
            refresh_token: s.refresh,
            user: { id: s.authId, aud: 'authenticated', role: 'authenticated', email: s.email, app_metadata: {}, user_metadata: {} },
        };
    }

    bearer(req) {
        const h = req.headers.find(([n]) => n.toLowerCase() === 'authorization');
        const v = h ? h[1] : '';
        return v.startsWith('Bearer ') ? v.slice(7) : null;
    }
    header(req, name) {
        const h = req.headers.find(([n]) => n.toLowerCase() === name);
        return h ? h[1] : null;
    }

    // 요청에 실린 자격의 종류(값은 남기지 않는다)
    credentialKind(req) {
        const b = this.bearer(req);
        if (b === null) return 'none';
        if (b === this.anonKey) return 'anon';
        const c = readFakeJwt(b);
        if (c && c.role === 'authenticated') return 'member';
        return 'other';
    }

    async handle(req) {
        let u;
        try { u = new URL(req.url); } catch (e) { this.foreign.push(req); throw new TypeError('Failed to fetch'); }
        if (u.origin !== this.origin) { this.foreign.push(req); throw new TypeError('Failed to fetch (다른 출처)'); }
        const route = `${req.method.toUpperCase()} ${u.pathname}`;
        const entry = { route, search: u.search, cred: this.credentialKind(req), apikey: this.header(req, 'apikey') === this.anonKey, viaRedirect: !!req.viaRedirect, page: req.page };
        if (u.pathname === '/auth/v1/logout') entry.scope = u.searchParams.get('scope');
        this.log.push(entry);

        const name = u.pathname.split('/').pop();
        const fault = this.faults[name];
        if (fault) {
            const forced = await fault(req, u);
            if (forced === 'network') throw new TypeError('Failed to fetch');
            if (forced) return forced;
        }

        let res;
        if (u.pathname === '/auth/v1/token' && req.method === 'POST') res = this.token(req, u);
        else if (u.pathname === '/auth/v1/logout' && req.method === 'POST') res = this.logout(req, u, entry);
        else if (u.pathname === '/rest/v1/rpc/my_profile') res = this.myProfile(req, u);
        else if (u.pathname === '/rest/v1/rpc/my_site_access') res = this.mySiteAccess(req, u);
        else if (u.pathname.startsWith('/auth/v1/')) res = json(404, { code: 'not_found', message: 'fake: 이 가짜 서버에 없는 인증 경로' });
        else res = this.business(req, u);

        const hook = this.hooks['after:' + name];
        if (hook) await hook(req, res);
        return res;
    }

    token(req, u) {
        const grant = u.searchParams.get('grant_type');
        let body = {};
        try { body = JSON.parse(req.bodyText || '{}'); } catch (e) { body = {}; }
        const v = { 'x-supabase-api-version': '2024-01-01' };
        if (grant === 'password') {
            const a = this.accounts.get(body.email);
            if (!a || a.password !== body.password) return json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' }, v);
            const s = this.createSession(a.email);
            return json(200, this.tokenBody(s), v);
        }
        if (grant === 'refresh_token') {
            const rt = body.refresh_token;
            const s = [...this.sessions.values()].find((x) => x.refresh === rt || (x.prevRefresh === rt && this.now() - x.rotatedAt < 10000));
            // 끝난 로그인 기록의 갱신: 로그아웃으로 끝났으면 갱신값이 없다는 답, 만료로 끝났으면 만료라는 답(실제 서버의 코드는 확인하지 못함)
            if (!s) return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }, v);
            if (!s.alive) return json(400, { code: s.endCode || 'refresh_token_not_found', message: 'Invalid Refresh Token' }, v);
            if (s.refresh === rt) {
                s.prevRefresh = s.refresh;
                s.refresh = `fake-refresh-${s.sid}-${++this.seq}`;
                s.rotatedAt = this.now();
            }
            return json(200, this.tokenBody(s), v);
        }
        return json(400, { code: 'validation_failed', message: 'unsupported grant' }, v);
    }

    logout(req, u, entry) {
        const scope = u.searchParams.get('scope');
        entry.scope = scope;
        const c = readFakeJwt(this.bearer(req));
        const s = c ? this.sessions.get(c.session_id) : null;
        if (!s || !s.alive) return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }, { 'x-supabase-api-version': '2024-01-01' });
        if (scope === 'local') s.alive = false;
        else if (scope === 'global') for (const x of this.sessions.values()) if (x.authId === s.authId) x.alive = false;
        else if (scope === 'others') for (const x of this.sessions.values()) if (x.authId === s.authId && x !== s) x.alive = false;
        return { status: 204, headers: {}, body: null };
    }

    // JWT 를 보고 호출자를 가린다. 돌려주는 값: { error } 또는 { session(없을 수 있음), account }
    caller(req) {
        const b = this.bearer(req);
        if (b === null || b === this.anonKey) return { error: json(401, { code: '42501', message: 'permission denied for function' }) };
        const c = readFakeJwt(b);
        if (!c || c.role !== 'authenticated') return { error: json(401, { code: 'PGRST301', message: 'JWT invalid' }) };
        if (c.exp * 1000 <= this.now()) return { error: json(401, { code: 'PGRST303', message: 'JWT expired' }) };
        const s = this.sessions.get(c.session_id);
        const live = s && s.alive ? s : null;
        const account = live ? this.accounts.get(live.email) : null;
        return { session: live, account };
    }

    myProfile(req, u) {
        if (req.method !== 'POST') return json(405, { code: 'PT405', message: 'method not allowed' });
        if (u.search || (req.bodyText && req.bodyText !== '{}')) return json(404, { code: 'PGRST202', message: 'Could not find the function' });
        const who = this.caller(req);
        if (who.error) return who.error;
        if (this.maintenance && !(who.session && this.maintenanceExcept.has(who.session.authId))) return json(503, { code: 'PT503', message: 'maintenance' });
        const noStore = { 'Cache-Control': 'private, no-store' };
        const a = who.account;
        if (!a || a.member === 'none') return json(200, { state: 'no_member' }, noStore);
        if (a.member === 'blocked') return json(200, { state: 'blocked' }, noStore);
        if (a.member === 'withdrawal') return json(200, { state: 'withdrawal_pending' }, noStore);
        return json(200, { state: 'ok', profile: Object.assign({}, a.profile) }, noStore);
    }

    mySiteAccess(req) {
        if (req.method !== 'POST') return json(405, { code: 'PGRST', message: 'method not allowed' });
        const who = this.caller(req);
        if (who.error) return who.error;
        const excepted = !!(who.session && this.maintenanceExcept.has(who.session.authId));
        const allowed = this.allowedOverride === null ? (!this.maintenance || excepted) : this.allowedOverride;
        const isAdmin = !!(who.session && who.account && who.account.admin && who.session.aal === 'aal2');
        return json(200, { allowed, is_admin: isAdmin }, { 'Cache-Control': 'private, no-store' });
    }
}
