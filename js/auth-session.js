// =====================================================================
// 공홈 인증 모듈 (보안작업 묶음2 계약 3A) — 전역 하나: window.EonAuth
//
// * 새 로그인 스위치가 꺼져 있으면 이 파일은 아무것도 하지 않는다:
//   공식 클라이언트(SDK)를 내려받지도 만들지도 않고, 저장소에 쓰지 않고, 요청을 보내지 않는다.
// * 켜져 있을 때만 Supabase 공식 클라이언트의 Auth 기능(AuthClient)을 별도 저장 이름으로 쓴다.
// * 이 모듈이 회원 자격을 싣는 요청은 자기 자신의 요청뿐이다:
//   로그인·갱신·로그아웃, rpc/my_profile, rpc/my_site_access. 그 밖의 업무 요청은 지금 쓰는 자격 그대로다.
// * 교재 편집(eon_book_auth_v1)과 후속메일 화면(sb-…-auth-token)의 로그인 상태는 읽지도 쓰지도 지우지도 않는다.
// =====================================================================
(function () {
    'use strict';

    // 새 로그인 스위치. 저장소의 값은 꺼짐('off')이다.
    // 이 줄의 값은 시험용 로컬 서버(tests/auth-session/serve.mjs)가 파일을 내줄 때만 바꾼다.
    // 주소의 꼬리표·저장소의 값·쿠키로 켜는 길은 없다.
    const EON_AUTH_SWITCH = 'off';

    const ON = EON_AUTH_SWITCH === 'on';

    const STORAGE_KEY = 'eon_auth_v1';          // 공식 클라이언트가 로그인 상태를 두는 이름
    const MARK_KEY = 'eon_auth_v1:compat';      // "이 호환 값은 새 모듈이 만들었다"는 표식
    const COMPAT_USER = 'iontoefl_user';        // 아직 전환하지 않은 화면이 읽는 호환 값
    const COMPAT_TIME = 'iontoefl_login_time';
    const SDK_SRC = 'vendor/supabase-2.116.0.js';
    const RPC_TIMEOUT_MS = 15000;
    const SESSION_WAIT_MS = 20000;              // 공식 클라이언트의 복원·갱신을 기다리는 상한

    // 요청 등급
    const GRADES = Object.freeze({
        ANON: 'anon',               // 익명 가능
        MEMBER: 'member',           // 회원 필요
        ADMIN: 'admin',             // 관리자 전용
        LEGACY_OWN: 'legacy_own',   // 기존 전용 자격 유지(교재 편집·후속메일 — 모듈은 자격을 주지 않는다)
        HOLD: 'hold'                // 전환 보류(지금 쓰는 자격 그대로)
    });
    const GRADE_VALUES = Object.keys(GRADES).map(function (k) { return GRADES[k]; });

    function EonAuthError(code) {
        const e = new Error('EonAuth: ' + code);
        e.name = 'EonAuthError';
        e.code = code;
        return e;
    }

    const BASE = typeof SUPABASE_URL === 'string' ? SUPABASE_URL : '';
    const ANON = typeof SUPABASE_ANON_KEY === 'string' ? SUPABASE_ANON_KEY : '';

    function publicCredential() {
        return { apikey: ANON, authorization: 'Bearer ' + ANON };
    }

    // 호출자가 넘긴 추가 머리글이 Authorization·apikey 를 덮어쓰지 못한다
    function assertNoCredentialOverride(extra) {
        if (extra === undefined || extra === null) return;
        if (typeof extra !== 'object') throw EonAuthError('bad_headers');
        Object.keys(extra).forEach(function (name) {
            const n = String(name).toLowerCase();
            if (n === 'authorization' || n === 'apikey') throw EonAuthError('credential_override');
        });
    }

    function normalizeGrade(grade) {
        if (GRADE_VALUES.indexOf(grade) < 0) throw EonAuthError('bad_grade');
        return grade;
    }

    // js/supabase-config.js 의 연결점이 "등급을 받은 호출"에만 부른다(이 조각에는 그런 호출이 없다).
    // 주소를 모르는 자리이므로 회원·관리자 자격은 여기서 싣지 않는다 — 공개 키로 떨어지지 않고 오류다.
    function headersForGrade(grade, extra) {
        const g = normalizeGrade(grade);
        assertNoCredentialOverride(extra);
        if (g === GRADES.ANON || g === GRADES.HOLD) {
            return Object.assign({
                'apikey': ANON,
                'Authorization': 'Bearer ' + ANON,
                'Content-Type': 'application/json'
            }, extra);
        }
        throw EonAuthError(g === GRADES.LEGACY_OWN ? 'legacy_own' : 'grade_closed');
    }

    // -----------------------------------------------------------------
    // 꺼짐: 아무것도 하지 않는다
    // -----------------------------------------------------------------
    if (!ON) {
        window.EonAuth = Object.freeze({
            GRADES: GRADES,
            isOn: function () { return false; },
            state: function () { return 'off'; },
            reason: function () { return null; },
            ready: function () { return Promise.resolve('off'); },
            onChange: function () { return function () {}; },
            signIn: function () { return Promise.resolve({ outcome: 'off' }); },
            signOut: function () { return Promise.resolve({ outcome: 'off' }); },
            recheck: function () { return Promise.resolve('off'); },
            profile: function () { return null; },
            siteAccess: function () { return null; },
            displayUserRaw: function () { return null; },
            bindDisplay: function () {},
            headersForGrade: headersForGrade,
            credentialFor: function (grade) {
                let g;
                try { g = normalizeGrade(grade); } catch (e) { return Promise.reject(e); }
                if (g === GRADES.ANON || g === GRADES.HOLD) return Promise.resolve(publicCredential());
                return Promise.reject(EonAuthError(g === GRADES.LEGACY_OWN ? 'legacy_own' : 'off'));
            }
        });
        return;
    }

    // -----------------------------------------------------------------
    // 켜짐
    // -----------------------------------------------------------------

    // 설정된 Supabase 출처. HTTPS 이고 주소가 출처 그대로일 때만 쓴다.
    let ORIGIN = null;
    try {
        const cfg = new URL(BASE);
        if (cfg.protocol === 'https:' && cfg.origin === BASE && !cfg.username && !cfg.password) ORIGIN = cfg.origin;
    } catch (e) { ORIGIN = null; }

    // 인증 모듈이 쓰는 주소의 목록. 이 목록 밖으로는 요청을 보내지 않는다.
    const TARGETS = [
        { key: 'login', method: 'POST', path: '/auth/v1/token', search: '?grant_type=password', member: false },
        { key: 'refresh', method: 'POST', path: '/auth/v1/token', search: '?grant_type=refresh_token', member: false },
        { key: 'logout', method: 'POST', path: '/auth/v1/logout', search: '?scope=local', member: false },
        { key: 'my_profile', method: 'POST', path: '/rest/v1/rpc/my_profile', search: '', member: true },
        { key: 'my_site_access', method: 'POST', path: '/rest/v1/rpc/my_site_access', search: '', member: true }
    ];

    // 주소를 파싱해 출처가 정확히 같고(HTTPS·호스트·포트), 허용된 경로·메서드일 때만 목록의 항목을 돌려준다.
    function matchTarget(rawUrl, method) {
        if (!ORIGIN || typeof rawUrl !== 'string' || rawUrl.indexOf('#') >= 0) return null;
        let u;
        try { u = new URL(rawUrl); } catch (e) { return null; }
        if (u.href !== rawUrl) return null;                        // 정규 모양 그대로만
        if (u.protocol !== 'https:' || u.origin !== ORIGIN) return null;
        if (u.username || u.password) return null;
        const m = String(method === undefined || method === null ? 'GET' : method).toUpperCase();
        for (let i = 0; i < TARGETS.length; i++) {
            const t = TARGETS[i];
            if (t.method === m && u.pathname === t.path && u.search === t.search) return t;
        }
        return null;
    }

    function plainHeaders(h) {
        const out = {};
        const seen = {};
        let bad = false;
        const put = function (name, value) {
            const n = String(name).toLowerCase();
            if (seen[n]) bad = true;
            seen[n] = true;
            out[name] = String(value);
        };
        if (h && typeof h.forEach === 'function' && typeof h.get === 'function') {
            h.forEach(function (value, name) { put(name, value); });
        } else if (h && typeof h === 'object') {
            Object.keys(h).forEach(function (name) { put(name, h[name]); });
        } else {
            return null;
        }
        return bad ? null : out;
    }

    function headerValue(h, lowerName) {
        const names = Object.keys(h);
        for (let i = 0; i < names.length; i++) if (names[i].toLowerCase() === lowerName) return h[names[i]];
        return undefined;
    }

    // 결과를 모르는 갱신 요청에 쓴 갱신값(이 화면의 메모리에만). 같은 값으로는 다시 보내지 않는다.
    const unknownRefresh = [];

    // 인증 모듈과 공식 클라이언트가 내는 모든 요청이 지나는 한 곳.
    // (전역 fetch 를 바꾸지 않는다 — 이 함수를 받은 호출만 지난다.)
    function guardedFetch(input, init) {
        const opt = init || {};
        const target = matchTarget(input, opt.method);
        if (!target) return Promise.reject(EonAuthError('target_not_allowed'));
        const headers = plainHeaders(opt.headers);
        if (!headers) return Promise.reject(EonAuthError('bad_headers'));
        const auth = headerValue(headers, 'authorization');
        if (headerValue(headers, 'apikey') !== ANON || typeof auth !== 'string' || auth.indexOf('Bearer ') !== 0) {
            return Promise.reject(EonAuthError('bad_headers'));
        }
        let refreshToken = null;
        if (target.key === 'refresh') {
            try { refreshToken = JSON.parse(opt.body).refresh_token; } catch (e) { refreshToken = null; }
            if (typeof refreshToken !== 'string' || !refreshToken) return Promise.reject(EonAuthError('bad_body'));
            // 공식 클라이언트는 응답을 못 받은 갱신을 스스로 다시 보내려 한다 — 결과를 모르는 요청은 다시 보내지 않는다
            if (unknownRefresh.indexOf(refreshToken) >= 0) return Promise.reject(EonAuthError('refresh_unknown'));
        }
        const sent = window.fetch(input, {
            method: target.method,
            headers: headers,
            body: opt.body,
            redirect: 'error',            // 리디렉션을 따라가지 않는다
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal: opt.signal
        });
        if (refreshToken === null) return sent;
        return sent.then(function (res) {
            if (res.status >= 500) unknownRefresh.push(refreshToken);
            return res;
        }, function (err) {
            unknownRefresh.push(refreshToken);
            throw err;
        });
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () { reject(EonAuthError('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
        });
    }

    // 서버가 분명히 거절한 갱신인가(응답을 못 받은 것과 구분한다)
    function isDefiniteAuthFailure(err) {
        if (!err) return false;
        if (err.name === 'AuthSessionMissingError') return true;
        return err.name === 'AuthApiError' && typeof err.status === 'number' && err.status >= 400 && err.status < 500;
    }

    // 공식 클라이언트에 주는 저장 어댑터: 자기 이름(eon_auth_v1…)만 읽고 쓴다.
    function ownKey(key) {
        if (key === STORAGE_KEY || (typeof key === 'string' && key.indexOf(STORAGE_KEY + '-') === 0)) return key;
        throw EonAuthError('storage_key_not_allowed');
    }
    const scopedStorage = {
        getItem: function (key) { return window.localStorage.getItem(ownKey(key)); },
        setItem: function (key, value) { window.localStorage.setItem(ownKey(key), value); },
        removeItem: function (key) { window.localStorage.removeItem(ownKey(key)); }
    };

    // JWT 의 계정 번호와 로그인 기록 번호(서명은 서버가 본다 — 여기서는 "같은 로그인 기록인가"를 가리는 데만 쓴다)
    function decodeClaims(token) {
        try {
            if (typeof token !== 'string') return null;
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b.length % 4) b += '=';
            const c = JSON.parse(atob(b));
            if (!c || typeof c.sub !== 'string' || !c.sub || typeof c.session_id !== 'string' || !c.session_id) return null;
            return { sub: c.sub, sid: c.session_id };
        } catch (e) { return null; }
    }

    // ---- 상태 ----
    let state = 'restoring';       // signed_out / restoring / signed_in / rejected
    let reason = null;
    let verified = null;           // { sub, sid, profile, isAdmin } — signed_in 일 때만
    let lastRejected = null;       // 방금 거절된 로그인 기록(같은 기록을 알림마다 다시 묻지 않는다)
    let client = null;
    const listeners = [];
    const drawers = [];
    let displayHold = false;
    let lastDrawn;

    function safeCall(fn, arg) {
        try { fn(arg); } catch (e) { try { console.error('EonAuth 콜백 오류:', e && e.message); } catch (_) {} }
    }

    function setState(next, why) {
        const changed = state !== next || reason !== (why || null);
        state = next;
        reason = why || null;
        if (changed) listeners.slice().forEach(function (fn) { safeCall(fn, next); });
        redraw(false);
    }

    // 작업을 하나씩 차례로(로그인·로그아웃·복원·다시 확인이 서로 끼어들지 않게)
    let tail = Promise.resolve();
    function enqueue(fn) {
        const run = tail.then(fn);
        tail = run.then(function () {}, function () {});
        return run;
    }
    // 복원·갱신·확인이 끝날 때까지 기다린다(상태가 restoring 이 아니게 될 때까지)
    function ready() {
        if (state !== 'restoring') return Promise.resolve(state);
        return new Promise(function (resolve) {
            const check = function () {
                if (state === 'restoring') return;
                const i = listeners.indexOf(check);
                if (i >= 0) listeners.splice(i, 1);
                resolve(state);
            };
            listeners.push(check);
        });
    }

    // ---- 호환 값(iontoefl_user·iontoefl_login_time) ----
    // 한 번의 동기 구간에서 "지금 그 자리의 값"을 다시 보고 쓰거나 지운다.
    function readSlot() {
        const store = window.localStorage;
        const user = store.getItem(COMPAT_USER);
        const time = store.getItem(COMPAT_TIME);
        let mark = null;
        try {
            const m = JSON.parse(store.getItem(MARK_KEY));
            if (m && m.v === 1 && typeof m.sid === 'string' && typeof m.sub === 'string' &&
                typeof m.user === 'string' && typeof m.time === 'string') mark = m;
        } catch (e) { mark = null; }
        let storedSid = null;
        try {
            const st = JSON.parse(store.getItem(STORAGE_KEY));
            const c = st && decodeClaims(st.access_token);
            storedSid = c ? c.sid : null;
        } catch (e) { storedSid = null; }
        let kind;
        if (user === null && time === null) kind = 'empty';
        else if (mark && user === mark.user && (time === mark.time || time === null)) kind = 'ours';
        else if (mark && user === null && time === mark.time) kind = 'ours';
        else kind = 'foreign';
        return { kind: kind, user: user, time: time, mark: mark, storedSid: storedSid };
    }

    function writeCompat(v) {
        try {
            const store = window.localStorage;
            const slot = readSlot();
            if (slot.kind === 'foreign') return { ok: false, why: 'legacy_present' };   // 덮어쓰지 않는다
            if (slot.storedSid !== v.sid) return { ok: false, why: 'session_changed' };  // 확인한 그 로그인 기록이 아니다
            const p = v.profile;
            const userJson = JSON.stringify({
                id: p.id,
                name: p.name,
                nickname: p.nickname || '',
                email: p.email,
                phone: p.phone,
                role: v.isAdmin ? 'admin' : 'user'      // 표시에만 쓴다(서버 권한이 아니다)
            });
            const keepTime = slot.kind === 'ours' && slot.mark.sid === v.sid && slot.time === slot.mark.time;
            const time = keepTime ? slot.mark.time : String(Date.now());
            store.setItem(MARK_KEY, JSON.stringify({ v: 1, sid: v.sid, sub: v.sub, user: userJson, time: time }));
            store.setItem(COMPAT_USER, userJson);
            store.setItem(COMPAT_TIME, time);
            return { ok: true };
        } catch (e) {
            return { ok: false, why: 'storage' };
        }
    }

    // 새 모듈이 만든 값이고(표식), 끝내려는 그 로그인 기록의 것이거나 이미 주인 없는 값일 때만 지운다.
    function clearCompat(sid) {
        try {
            const store = window.localStorage;
            const slot = readSlot();
            if (!slot.mark) return;
            const mine = sid !== null && sid !== undefined && slot.mark.sid === sid;
            const stale = slot.mark.sid !== slot.storedSid;
            if (!mine && !stale) return;
            if (slot.kind === 'ours') {
                if (slot.user === slot.mark.user) store.removeItem(COMPAT_USER);
                if (slot.time === slot.mark.time) store.removeItem(COMPAT_TIME);
            }
            store.removeItem(MARK_KEY);
        } catch (e) { /* 저장소를 쓸 수 없으면 아무것도 지우지 않는다 */ }
    }

    // 화면이 그려도 되는 본인 표시: 로그인 기록을 확인했고(signed_in), 그 자리의 값이 그 기록으로 만든 값일 때만
    function displayUserRaw() {
        if (displayHold || state !== 'signed_in' || !verified) return null;
        try {
            const slot = readSlot();
            if (slot.kind !== 'ours' || slot.mark.sid !== verified.sid || slot.user === null) return null;
            return slot.user;
        } catch (e) { return null; }
    }

    function redraw(force) {
        const now = displayUserRaw();
        if (!force && now === lastDrawn) return;
        lastDrawn = now;
        drawers.slice().forEach(function (fn) { safeCall(fn); });
    }

    function bindDisplay(fn) {
        if (typeof fn !== 'function') return;
        drawers.push(fn);
        lastDrawn = displayUserRaw();
        safeCall(fn);
    }

    // ---- 서버에 묻기 ----
    async function readSession() {
        if (!client) return { session: null, error: true };
        try {
            const r = await withTimeout(client.getSession(), SESSION_WAIT_MS);
            if (r && r.error) return { session: null, error: true };
            return { session: (r && r.data && r.data.session) || null, error: false };
        } catch (e) {
            return { session: null, error: true };
        }
    }

    async function callRpc(path, token) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(function () { ctl.abort(); }, RPC_TIMEOUT_MS) : null;
        try {
            const res = await guardedFetch(ORIGIN + path, {
                method: 'POST',
                headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: '{}',
                signal: ctl ? ctl.signal : undefined
            });
            let body = null;
            try { body = await res.json(); } catch (e) { body = null; }
            return { status: res.status, body: body };
        } catch (e) {
            return { status: 0, body: null };       // 결과를 모른다 — 다시 보내지 않는다
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function statusKind(status) {
        if (status === 0) return 'network';
        if (status === 401) return 'jwt_rejected';
        if (status === 503) return 'maintenance';
        return 'unexpected';
    }

    async function askProfile(token) {
        const r = await callRpc('/rest/v1/rpc/my_profile', token);
        if (r.status !== 200) return { kind: statusKind(r.status) };
        const b = r.body;
        if (!b || typeof b !== 'object') return { kind: 'unexpected' };
        if (b.state === 'ok') {
            const p = b.profile;
            if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) return { kind: 'unexpected' };
            return {
                kind: 'ok',
                profile: {
                    id: p.id,
                    name: p.name === undefined ? null : p.name,
                    nickname: p.nickname === undefined ? null : p.nickname,
                    email: p.email === undefined ? null : p.email,
                    phone: p.phone === undefined ? null : p.phone,
                    timezone: p.timezone === undefined ? null : p.timezone
                }
            };
        }
        if (b.state === 'no_member' || b.state === 'blocked' || b.state === 'withdrawal_pending') return { kind: b.state };
        return { kind: 'unexpected' };
    }

    async function askAccess(token) {
        const r = await callRpc('/rest/v1/rpc/my_site_access', token);
        if (r.status !== 200) return { kind: statusKind(r.status) };
        const b = r.body;
        if (!b || typeof b !== 'object' || typeof b.allowed !== 'boolean' || typeof b.is_admin !== 'boolean') return { kind: 'unexpected' };
        return { kind: 'ok', allowed: b.allowed, isAdmin: b.is_admin };
    }

    // 같은 현재 로그인 기록에서 my_profile 이 ok 이고 my_site_access.allowed 가 참인가
    async function verifyOnce(session) {
        const token = session && session.access_token;
        const c = decodeClaims(token);
        if (!c) return { ok: false, reason: 'token_shape' };
        if (session.user && session.user.id && session.user.id !== c.sub) return { ok: false, reason: 'token_shape' };
        const p = await askProfile(token);
        if (p.kind !== 'ok') return { ok: false, reason: p.kind };
        const a = await askAccess(token);               // 같은 JWT(같은 로그인 기록)로 묻는다
        if (a.kind !== 'ok') return { ok: false, reason: a.kind };
        if (a.allowed !== true) return { ok: false, reason: 'not_allowed' };
        // 두 응답 사이에 이 브라우저의 계정·로그인 기록이 바뀌지 않았는가
        const cur = await readSession();
        const c2 = cur.session ? decodeClaims(cur.session.access_token) : null;
        if (cur.error || !c2 || c2.sub !== c.sub || c2.sid !== c.sid) return { ok: false, reason: 'session_changed' };
        return { ok: true, sub: c.sub, sid: c.sid, profile: p.profile, isAdmin: a.isAdmin === true };
    }

    async function verifyWithRecovery(session) {
        const first = await verifyOnce(session);
        if (first.ok || (first.reason !== 'jwt_rejected' && first.reason !== 'no_member')) return first;
        // JWT 가 만료됐거나 로그인 기록이 끝났을 수 있다 → 공식 클라이언트로 한 번만 갱신해 본다
        let refreshed = null;
        let definite = false;
        try {
            const r = await withTimeout(client.refreshSession(), SESSION_WAIT_MS);
            if (r && !r.error && r.data && r.data.session) refreshed = r.data.session;
            else definite = isDefiniteAuthFailure(r && r.error);
        } catch (e) { refreshed = null; }
        // 서버가 갱신을 거절했으면 이 로그인 기록은 끝났다. 응답을 못 받았으면 모른다(다시 보내지 않는다).
        if (!refreshed) return { ok: false, reason: definite ? 'expired' : 'network', ended: definite };
        const second = await verifyOnce(refreshed);
        if (!second.ok && second.reason === 'no_member') return { ok: false, reason: 'no_member', definitive: true };
        if (!second.ok && second.reason === 'jwt_rejected') return { ok: false, reason: 'expired' };
        return second;
    }

    async function endLocal() {
        try { await client.signOut({ scope: 'local' }); } catch (e) { /* 결과를 몰라도 다시 보내지 않는다 */ }
    }

    // 로그인 기록 하나를 확인해 상태를 정한다. 돌려주는 값: 결과 이름.
    async function settle(session, origin) {
        setState('restoring', null);
        let r;
        try { r = await verifyWithRecovery(session); } catch (e) { r = { ok: false, reason: 'error' }; }

        if (r.ok) {
            const w = writeCompat(r);
            if (w.ok || (origin !== 'login' && w.why !== 'session_changed')) {
                verified = { sub: r.sub, sid: r.sid, profile: r.profile, isAdmin: r.isAdmin };
                lastRejected = null;
                setState('signed_in', w.ok ? null : w.why);
                return 'signed_in';
            }
            if (origin === 'login' && w.why !== 'session_changed') {
                // 로그인하는 사이에 옛 방식의 값이 생겼거나 저장할 수 없다 → 덮어쓰지 않고 이 로그인을 끝낸다
                verified = null;
                await endLocal();
                setState('signed_out', w.why);
                return w.why === 'legacy_present' ? 'legacy_present' : 'error';
            }
            r = { ok: false, reason: 'session_changed' };
        }

        verified = null;
        const c = decodeClaims(session && session.access_token);
        if (r.reason === 'no_member' && r.definitive) {
            // 회원 대응이 없는 계정: 이 로그인을 끝낸다
            await endLocal();
            clearCompat(c ? c.sid : null);
            setState('signed_out', 'no_member');
            return 'no_member';
        }
        if (r.ended) await endLocal();       // 끝난 로그인 기록을 이 브라우저에 남겨 두지 않는다
        clearCompat(c ? c.sid : null);
        lastRejected = c;
        setState('rejected', r.reason);
        return r.reason;
    }

    // 공식 클라이언트의 알림(이 탭·다른 탭의 로그인·로그아웃·갱신) 뒤에 상태를 맞춘다
    async function reconcile() {
        const cur = await readSession();
        if (cur.error) return;
        const s = cur.session;
        if (!s) {
            if (state === 'signed_in') {
                const sid = verified ? verified.sid : null;
                verified = null;
                clearCompat(sid);
                setState('rejected', 'ended');      // 이 탭이 끝낸 것이 아니다 → 다시 로그인 필요
            }
            return;
        }
        const c = decodeClaims(s.access_token);
        if (verified && c && c.sub === verified.sub && c.sid === verified.sid) return;     // 같은 로그인 기록(갱신 포함)
        if (!verified && c && lastRejected && c.sub === lastRejected.sub && c.sid === lastRejected.sid) return;
        await settle(s, 'event');
    }

    let reconcileQueued = false;
    function scheduleReconcile() {
        if (reconcileQueued) return;
        reconcileQueued = true;
        setTimeout(function () {
            reconcileQueued = false;
            enqueue(reconcile);
        }, 0);
    }

    function loadSdk() {
        return new Promise(function (resolve, reject) {
            const el = document.createElement('script');
            el.src = SDK_SRC;
            el.async = true;
            el.onload = function () {
                if (window.supabase && typeof window.supabase.AuthClient === 'function') resolve(window.supabase);
                else reject(EonAuthError('sdk_shape'));
            };
            el.onerror = function () { reject(EonAuthError('sdk_load')); };
            document.head.appendChild(el);
        });
    }

    async function start() {
        // 저장된 새 방식의 로그인이 없으면 기다릴 것이 없다 → 바로 "로그인 전"
        let hasStored = true;
        try { hasStored = window.localStorage.getItem(STORAGE_KEY) !== null; } catch (e) { hasStored = true; }
        if (!hasStored) { clearCompat(null); setState('signed_out', null); }
        try {
            if (!ORIGIN || !ANON) throw EonAuthError('config');
            const sdk = await loadSdk();
            client = new sdk.AuthClient({
                url: ORIGIN + '/auth/v1',
                headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
                storageKey: STORAGE_KEY,
                storage: scopedStorage,
                persistSession: true,
                autoRefreshToken: true,          // 갱신하는 주체는 공식 클라이언트 하나
                detectSessionInUrl: false,       // 주소에서 로그인 정보를 읽지 않는다
                fetch: guardedFetch
            });
            client.onAuthStateChange(function () { scheduleReconcile(); });
        } catch (e) {
            client = null;
            setState('signed_out', 'unavailable');
            return;
        }
        const cur = await readSession();
        if (cur.error) { setState('rejected', 'network'); return; }
        if (!cur.session) { clearCompat(null); setState('signed_out', null); return; }
        await settle(cur.session, 'restore');
    }

    function outcomeOf(result) {
        if (result === 'signed_in' || result === 'legacy_present' || result === 'blocked' ||
            result === 'withdrawal_pending' || result === 'no_member' || result === 'maintenance' ||
            result === 'not_allowed' || result === 'session_changed' || result === 'expired') return result;
        return 'error';
    }

    function signIn(email, password) {
        return enqueue(async function () {
            if (!client) return { outcome: 'error' };
            // 옛 방식의 로그인 상태가 있으면 인증 요청을 보내기 전에 멈춘다(덮어쓰지 않는다)
            let slot;
            try { slot = readSlot(); } catch (e) { return { outcome: 'error' }; }
            if (slot.kind === 'foreign') return { outcome: 'legacy_present' };
            // 이 브라우저에 새 방식의 로그인이 이미 있으면 그것부터 끝낸다(이 로그인만)
            const prev = await readSession();
            if (prev.session) {
                const pc = decodeClaims(prev.session.access_token);
                verified = null;
                await endLocal();
                clearCompat(pc ? pc.sid : null);
            }
            lastRejected = null;
            setState('restoring', null);
            let r;
            try {
                r = await client.signInWithPassword({ email: email, password: password });
            } catch (e) {
                setState('signed_out', null);
                return { outcome: 'error' };
            }
            if (!r || r.error || !r.data || !r.data.session) {
                setState('signed_out', null);
                const err = r && r.error;
                const wrong = !!err && err.status === 400 && err.code === 'invalid_credentials';
                return { outcome: wrong ? 'invalid_credentials' : 'error' };
            }
            return { outcome: outcomeOf(await settle(r.data.session, 'login')) };
        });
    }

    // 이 사이트의 이 로그인만 끝낸다(전역 종료 아님)
    function signOut() {
        return enqueue(async function () {
            if (!client) return { outcome: 'error' };
            const before = await readSession();
            const c = before.session ? decodeClaims(before.session.access_token) : null;
            let serverConfirmed = false;
            try {
                const r = await client.signOut({ scope: 'local' });
                serverConfirmed = !!r && !r.error;
            } catch (e) { serverConfirmed = false; }
            const after = await readSession();
            if (after.error || after.session) return { outcome: 'error' };     // 이 브라우저의 로그인이 남아 있다
            const sid = c ? c.sid : (verified ? verified.sid : null);
            verified = null;
            lastRejected = null;
            clearCompat(sid);
            setState('signed_out', null);
            return { outcome: 'signed_out', serverConfirmed: serverConfirmed };
        });
    }

    // 서버에 다시 물어 상태를 새로 정한다
    function recheck() {
        return enqueue(async function () {
            if (!client) return state;
            lastRejected = null;
            const cur = await readSession();
            if (cur.error) { verified = null; setState('rejected', 'network'); return state; }
            if (!cur.session) {
                const sid = verified ? verified.sid : null;
                const was = state;
                verified = null;
                clearCompat(sid);
                if (was === 'signed_in') setState('rejected', 'ended');
                return state;
            }
            await settle(cur.session, 'recheck');
            return state;
        });
    }

    // 요청 등급에 따른 자격. 회원 자격은 허용된 주소·메서드에만, 확인된 로그인에만.
    // 복원·갱신 중이면 기다리고, 그 밖에는 오류다 — 공개 키로 떨어지지 않는다.
    async function credentialFor(grade, url, method) {
        const g = normalizeGrade(grade);
        if (g === GRADES.ANON || g === GRADES.HOLD) return publicCredential();
        if (g === GRADES.LEGACY_OWN) throw EonAuthError('legacy_own');
        if (g === GRADES.ADMIN) throw EonAuthError('grade_closed');
        const target = matchTarget(url, method);
        if (!target || !target.member) throw EonAuthError('target_not_allowed');
        await ready();
        if (state !== 'signed_in' || !verified) throw EonAuthError(state === 'rejected' ? 'rejected' : 'signed_out');
        const cur = await readSession();
        const c = cur.session ? decodeClaims(cur.session.access_token) : null;
        if (cur.error || !c || c.sub !== verified.sub || c.sid !== verified.sid) throw EonAuthError('session_changed');
        return { apikey: ANON, authorization: 'Bearer ' + cur.session.access_token };
    }

    window.EonAuth = Object.freeze({
        GRADES: GRADES,
        isOn: function () { return true; },
        state: function () { return state; },
        reason: function () { return reason; },
        ready: ready,
        onChange: function (fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.push(fn);
            return function () {
                const i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
            };
        },
        signIn: signIn,
        signOut: signOut,
        recheck: recheck,
        // 확인된 본인 정보(my_profile 의 여섯 열)와 사이트 접근(my_site_access). 확인 전이면 null.
        profile: function () { return state === 'signed_in' && verified ? Object.assign({}, verified.profile) : null; },
        siteAccess: function () { return state === 'signed_in' && verified ? { allowed: true, is_admin: verified.isAdmin } : null; },
        displayUserRaw: displayUserRaw,
        bindDisplay: bindDisplay,
        headersForGrade: headersForGrade,
        credentialFor: credentialFor
    });

    // 다른 탭이 호환 값을 바꾸면 표시를 다시 본다(이름만 본다 — 다른 로그인 상태의 값은 읽지 않는다)
    window.addEventListener('storage', function (ev) {
        if (ev && (ev.key === COMPAT_USER || ev.key === COMPAT_TIME || ev.key === MARK_KEY || ev.key === null)) redraw(false);
    });

    // 뒤로 가기로 보관된 화면이 되살아나면: 먼저 로그인 전 모양으로 돌리고, 다시 확인한 뒤에 그린다
    window.addEventListener('pageshow', function (ev) {
        if (!ev || !ev.persisted) return;
        displayHold = true;
        redraw(true);
        recheck().then(function () {}, function () {}).then(function () {
            displayHold = false;
            redraw(true);
        });
    });

    enqueue(start);
})();
