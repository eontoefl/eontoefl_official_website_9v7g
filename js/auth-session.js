// =====================================================================
// 공홈 인증 모듈 (보안작업 묶음2 계약 3A) — 전역 하나: window.EonAuth
//
// * 새 로그인 스위치가 꺼져 있으면 이 파일은 아무것도 하지 않는다:
//   공식 클라이언트(SDK)를 내려받지도 만들지도 않고, 저장소에 쓰지 않고, 요청을 보내지 않는다.
// * 켜져 있을 때만 Supabase 공식 클라이언트의 Auth 기능(AuthClient)을 별도 저장 이름으로 쓴다.
// * 이 모듈이 회원 자격을 싣는 요청은 자기 자신의 요청뿐이다:
//   로그인·갱신·로그아웃, rpc/my_profile, rpc/my_site_access. 그 밖의 업무 요청은 지금 쓰는 자격 그대로다.
// * 교재 편집(eon_book_auth_v1)과 후속메일 화면(sb-…-auth-token)의 로그인 상태는 읽지도 쓰지도 지우지도 않는다.
// * 이 파일은 화면의 head 에서 실린다(켜진 화면이 처음 그려질 때부터 관리자·회원 표시를 숨기기 위해).
//   설정 파일(js/supabase-config.js)은 뒤에 실리므로 주소·공개 키는 쓸 때 읽는다.
// =====================================================================
(function () {
    'use strict';

    // 새 로그인 스위치. 저장소의 값은 꺼짐('off')이다.
    // 이 줄의 값은 시험용 로컬 서버(tests/auth-session/serve-core.mjs)가 파일을 내줄 때만 바꾼다.
    // 주소의 꼬리표·저장소의 값·쿠키로 켜는 길은 없다.
    const EON_AUTH_SWITCH = 'off';

    const ON = EON_AUTH_SWITCH === 'on';

    const STORAGE_KEY = 'eon_auth_v1';          // 공식 클라이언트가 로그인 상태를 두는 이름
    const MARK_KEY = 'eon_auth_v1:compat';      // "이 호환 값은 새 모듈이 만들었다"는 표식
    const COMPAT_USER = 'iontoefl_user';        // 아직 전환하지 않은 화면이 읽는 호환 값
    const COMPAT_TIME = 'iontoefl_login_time';
    const SDK_SRC = 'vendor/supabase-2.116.0.js';
    const RPC_TIMEOUT_MS = 15000;               // 기다림의 상한일 뿐이다 — 넘겨도 서버의 작업이 취소되는 것은 아니다
    const SESSION_WAIT_MS = 20000;              // 공식 클라이언트의 복원·갱신을 기다리는 상한(위와 같음)

    // 서버가 "이 로그인 기록은 없다·끝났다"고 답한 것으로 보는 오류 코드.
    // 이 밖의 거절(쓴 갱신값 refresh_token_already_used, 못 찾음, 429 등)은 끝났다는 증거가 아니다 — "모름"이다.
    const ENDED_CODES = ['session_not_found', 'session_expired'];

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

    // 설정 파일의 값(이 파일보다 뒤에 실린다 — 쓸 때 읽는다)
    function anonKey() { return typeof SUPABASE_ANON_KEY === 'string' ? SUPABASE_ANON_KEY : ''; }
    function baseUrl() { return typeof SUPABASE_URL === 'string' ? SUPABASE_URL : ''; }

    function publicCredential() {
        return { apikey: anonKey(), authorization: 'Bearer ' + anonKey() };
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
                'apikey': anonKey(),
                'Authorization': 'Bearer ' + anonKey(),
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
            isCurrent: function () { return false; },
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

    // 화면이 처음 그려질 때부터: 확인된 관리자·회원이 아니면 학습 자료 링크와 대시보드 버튼이 보이지 않는다.
    // (확인이 끝나면 아래 applyClasses 가 html 에 표시를 붙여 푼다.)
    const HIDE_CSS =
        'html:not(.eon-auth-admin) a[href="materials.html"],' +
        'html:not(.eon-auth-admin) a[href="materials.html?id"],' +
        'html:not(.eon-auth-admin) #adminDashboardBtn,' +
        'html:not(.eon-auth-member) #studentDashboardBtn' +
        '{display:none !important}';
    (function () {
        const style = document.createElement('style');
        style.id = 'eon-auth-hide';
        style.textContent = HIDE_CSS;
        (document.head || document.documentElement).appendChild(style);
    })();

    // 설정된 Supabase 출처와 공개 키(시작할 때 읽는다). HTTPS 이고 주소가 출처 그대로일 때만 쓴다.
    let ORIGIN = null;
    let ANON = '';
    function loadConfig() {
        ANON = anonKey();
        ORIGIN = null;
        try {
            const base = baseUrl();
            const cfg = new URL(base);
            if (cfg.protocol === 'https:' && cfg.origin === base && !cfg.username && !cfg.password) ORIGIN = cfg.origin;
        } catch (e) { ORIGIN = null; }
    }

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
    function same(a, b) { return !!a && !!b && a.sub === b.sub && a.sid === b.sid; }

    // 지금 이 브라우저에 저장된 새 방식의 로그인(동기 — 한 구간에서 보고 판단하는 데 쓴다)
    function storedSession() {
        try {
            const st = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
            if (!st || typeof st !== 'object') return null;
            return { claims: decodeClaims(st.access_token), accessToken: st.access_token, refreshToken: st.refresh_token };
        } catch (e) { return null; }
    }
    function storedIs(att) {
        const st = storedSession();
        return !!st && same(st.claims, att);
    }
    // 저장된 로그인이 아직 그 기록일 때만 이 브라우저에서 지운다(다른 로그인으로 바뀌었으면 건드리지 않는다)
    function removeStoredIf(att) {
        try {
            if (!storedIs(att)) return false;
            window.localStorage.removeItem(STORAGE_KEY);
            window.localStorage.removeItem(STORAGE_KEY + '-user');
            window.localStorage.removeItem(STORAGE_KEY + '-code-verifier');
            return true;
        } catch (e) { return false; }
    }

    // 모듈이 시작한 갱신·종료 하나(그 시도의 로그인 기록에 묶는다). 맞지 않는 갱신·종료 요청은 보내지 않는다.
    //   { kind: 'refresh', token }  또는  { kind: 'logout', sub, sid }   + 보낸 뒤의 결과(result)
    let permit = null;

    // 결과를 모르는 갱신 요청에 쓴 갱신값(이 화면의 메모리에만 — 새로 고침·다른 탭까지 막는 것이 아니다)
    const unknownRefresh = [];

    function resultOf(res) {
        return res.clone().json().then(function (b) {
            const code = b && typeof b.code === 'string' ? b.code : (b && typeof b.error_code === 'string' ? b.error_code : null);
            return { status: res.status, code: code };
        }, function () { return { status: res.status, code: null }; });
    }

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
        const bound = permit;
        let refreshToken = null;
        if (target.key === 'logout') {
            // 종료 요청은 모듈이 시작한 것만, 그 시도의 로그인 기록의 JWT 일 때만 나간다
            const c = decodeClaims(auth.slice(7));
            if (!bound || bound.kind !== 'logout' || !c || c.sub !== bound.sub || c.sid !== bound.sid) {
                return Promise.reject(EonAuthError('not_bound'));
            }
        } else if (target.key === 'refresh') {
            try { refreshToken = JSON.parse(opt.body).refresh_token; } catch (e) { refreshToken = null; }
            if (typeof refreshToken !== 'string' || !refreshToken) return Promise.reject(EonAuthError('bad_body'));
            // 나가는 갱신은 "지금 저장된 로그인"의 갱신값이어야 한다(공식 클라이언트가 스스로 하는 갱신도 같다)
            const st = storedSession();
            if (!st || st.refreshToken !== refreshToken) return Promise.reject(EonAuthError('not_bound'));
            if (bound) {
                // 모듈이 시작한 갱신·종료가 진행 중이면: 그 시도의 로그인 기록·갱신값일 때만
                if (bound.kind !== 'refresh' || refreshToken !== bound.token || !same(st.claims, bound)) {
                    return Promise.reject(EonAuthError('not_bound'));
                }
            }
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
        if (target.key !== 'refresh' && target.key !== 'logout') return sent;
        return sent.then(function (res) {
            if (refreshToken !== null && res.status >= 500) unknownRefresh.push(refreshToken);
            if (bound) bound.result = resultOf(res);
            return res;
        }, function (err) {
            if (refreshToken !== null) unknownRefresh.push(refreshToken);
            if (bound) bound.result = Promise.resolve({ status: 0, code: null });
            throw err;
        });
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () { reject(EonAuthError('timeout')); }, ms);
            promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
        });
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
        // 저장된 새 방식의 로그인: 없음(absent) / 읽어서 기록 번호를 앎(ok) / 있지만 읽을 수 없음(unreadable)
        let stored = 'absent';
        let storedSid = null;
        if (store.getItem(STORAGE_KEY) !== null) {
            const st = storedSession();
            if (st && st.claims) { stored = 'ok'; storedSid = st.claims.sid; } else stored = 'unreadable';
        }
        let kind;
        if (user === null && time === null) kind = 'empty';
        else if (mark && user === mark.user && (time === mark.time || time === null)) kind = 'ours';
        else if (mark && user === null && time === mark.time) kind = 'ours';
        else kind = 'foreign';
        return { kind: kind, user: user, time: time, mark: mark, stored: stored, storedSid: storedSid };
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

    // 새 모듈이 만든 값(표식)만 지운다. 지우는 것은 다음 둘뿐이다.
    //   mine : 표식의 로그인 기록 번호가 sid(이 탭이 다루던 그 기록)와 정확히 같다
    //   stale: 주인 없는 값 — 저장된 로그인을 실제로 읽어서(또는 저장된 것이 없음을 확인해서)
    //          표식의 기록이 지금 저장된 기록이 아님이 확인됐다. 읽지 못한 것은 "다르다"로 치지 않는다
    //   onlyMine 이 참이면(확인을 거두는 길) stale 로는 지우지 않는다 — 다른 계정의 값이거나 주인을 알 수 없으면 그대로 둔다
    function clearCompat(sid, onlyMine) {
        try {
            const store = window.localStorage;
            const slot = readSlot();
            if (!slot.mark) return;
            const mine = sid !== null && sid !== undefined && slot.mark.sid === sid;
            const stale = slot.stored === 'absent' || (slot.stored === 'ok' && slot.mark.sid !== slot.storedSid);
            if (!mine && (onlyMine || !stale)) return;
            if (slot.kind === 'ours') {
                if (slot.user === slot.mark.user) store.removeItem(COMPAT_USER);
                if (slot.time === slot.mark.time) store.removeItem(COMPAT_TIME);
            }
            store.removeItem(MARK_KEY);
        } catch (e) { /* 저장소를 쓸 수 없으면 아무것도 지우지 않는다 */ }
    }

    // 화면이 그려도 되는 본인 표시: 로그인 기록을 확인했고(signed_in), 지금 저장된 로그인이 그 기록이고,
    // 그 자리의 값이 그 기록으로 만든 값일 때만
    function displayUserRaw() {
        if (displayHold || state !== 'signed_in' || !verified) return null;
        try {
            const slot = readSlot();
            if (slot.kind !== 'ours' || slot.user === null) return null;
            if (slot.mark.sid !== verified.sid || slot.storedSid !== verified.sid) return null;
            return slot.user;
        } catch (e) { return null; }
    }

    // html 에 붙이는 표시(숨김 규칙을 푸는 열쇠): 확인된 관리자 / 확인된 회원
    function applyClasses(raw) {
        let role = null;
        try { role = raw ? (JSON.parse(raw).role === 'admin' ? 'admin' : 'member') : null; } catch (e) { role = null; }
        const list = document.documentElement.classList;
        if (role === 'admin') list.add('eon-auth-admin'); else list.remove('eon-auth-admin');
        if (role === 'member') list.add('eon-auth-member'); else list.remove('eon-auth-member');
    }

    function redraw(force) {
        const now = displayUserRaw();
        applyClasses(now);
        if (!force && now === lastDrawn) return;
        lastDrawn = now;
        drawers.slice().forEach(function (fn) { safeCall(fn); });
    }

    function bindDisplay(fn) {
        if (typeof fn !== 'function') return;
        drawers.push(fn);
        lastDrawn = displayUserRaw();
        applyClasses(lastDrawn);
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
        if (status === 429) return 'rate_limited';
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

    // 그 시도의 로그인 기록(att)에서 my_profile 이 ok 이고 my_site_access.allowed 가 참인가
    async function verifyOnce(att, token) {
        if (!same(decodeClaims(token), att)) return { ok: false, reason: 'session_changed' };
        const p = await askProfile(token);
        if (p.kind !== 'ok') return { ok: false, reason: p.kind };
        const a = await askAccess(token);               // 같은 JWT(같은 로그인 기록)로 묻는다
        if (a.kind !== 'ok') return { ok: false, reason: a.kind };
        if (a.allowed !== true) return { ok: false, reason: 'not_allowed' };
        // 두 응답 사이에 이 브라우저의 계정·로그인 기록이 바뀌지 않았는가
        if (!storedIs(att)) return { ok: false, reason: 'session_changed' };
        return { ok: true, sub: att.sub, sid: att.sid, profile: p.profile, isAdmin: a.isAdmin === true };
    }

    // 그 시도의 로그인 기록만 갱신한다. 돌려주는 값: ok(session) / changed / ended / rate_limited / unknown
    async function boundRefresh(att) {
        const st = storedSession();
        if (!st || !same(st.claims, att) || typeof st.refreshToken !== 'string' || !st.refreshToken) return { kind: 'changed' };
        const p = { kind: 'refresh', sub: att.sub, sid: att.sid, token: st.refreshToken, result: null };
        permit = p;
        const release = function () { if (permit === p) permit = null; };
        let r = null;
        try {
            // 공식 클라이언트가 이 갱신을 끝낼 때까지 묶어 둔다(아래에서 기다리기를 그만둔 뒤에도 — 뒤늦은 재시도가 다른 로그인으로 나가지 않게)
            const call = client.refreshSession({ refresh_token: st.refreshToken });
            call.then(release, release);
            r = await withTimeout(call, SESSION_WAIT_MS);
        } catch (e) { r = null; }
        const res = p.result ? await p.result : null;
        if (r && !r.error && r.data && r.data.session) {
            if (!same(decodeClaims(r.data.session.access_token), att)) return { kind: 'changed' };
            return { kind: 'ok', session: r.data.session };
        }
        if (!res) return { kind: storedIs(att) ? 'unknown' : 'changed' };     // 보내지 않았거나 답을 기다리다 그만둠
        if (res.status === 200) {
            // 서버는 갱신해 줬는데 공식 클라이언트가 결과를 돌려주지 않은 경우: 저장된 것이 그 기록이면 그것으로 잇는다
            const now = storedSession();
            return now && same(now.claims, att) ? { kind: 'ok', session: { access_token: now.accessToken } } : { kind: 'changed' };
        }
        if (res.status === 429) return { kind: 'rate_limited' };
        if (res.status >= 400 && res.status < 500 && ENDED_CODES.indexOf(res.code) >= 0) return { kind: 'ended' };
        return { kind: 'unknown' };
    }

    // 그 시도의 로그인 기록만 끝낸다(이 사이트의 이 로그인만). 돌려주는 값: ended / changed / unknown
    // 서버가 끝났다고 답했을 때만 이 브라우저의 로그인도 지운다 — 그것도 저장된 것이 아직 그 기록일 때만.
    async function boundEnd(att) {
        const st = storedSession();
        if (!st || !same(st.claims, att)) return 'changed';
        const p = { kind: 'logout', sub: att.sub, sid: att.sid, result: null };
        permit = p;
        const release = function () { if (permit === p) permit = null; };
        try {
            const call = client.admin.signOut(st.accessToken, 'local');
            call.then(release, release);
            await withTimeout(call, RPC_TIMEOUT_MS);
        } catch (e) { /* 결과는 아래에서 본다 */ }
        const res = p.result ? await p.result : null;
        const ended = !!res && ((res.status >= 200 && res.status < 300) ||
            ((res.status === 403 || res.status === 404) && res.code === 'session_not_found'));
        if (!ended) return 'unknown';             // 실패·모름: 끝냈다고 하지 않는다. 다시 보내지도 않는다
        removeStoredIf(att);
        return 'ended';
    }

    async function verifyWithRecovery(att, token) {
        const first = await verifyOnce(att, token);
        if (first.ok || (first.reason !== 'jwt_rejected' && first.reason !== 'no_member')) return first;
        // JWT 가 만료됐거나 로그인 기록이 끝났을 수 있다 → 그 기록의 갱신값으로 한 번만 갱신해 본다
        const rf = await boundRefresh(att);
        if (rf.kind === 'changed') return { ok: false, reason: 'session_changed' };
        if (rf.kind === 'ended') return { ok: false, reason: 'expired', ended: true };
        if (rf.kind === 'rate_limited') return { ok: false, reason: 'rate_limited' };
        if (rf.kind !== 'ok') return { ok: false, reason: 'network' };
        const second = await verifyOnce(att, rf.session.access_token);
        if (!second.ok && second.reason === 'no_member') return { ok: false, reason: 'no_member', definitive: true };
        if (!second.ok && second.reason === 'jwt_rejected') return { ok: false, reason: 'unexpected' };
        return second;
    }

    // 로그인 기록 하나를 확인해 상태를 정한다. 돌려주는 값: 결과 이름.
    // 실패 처리(갱신·종료·정리)는 전부 그 시도의 로그인 기록(att)에만 한다.
    async function settle(session, origin) {
        setState('restoring', null);
        const att = decodeClaims(session && session.access_token);
        if (!att) {
            verified = null;
            clearCompat(null);
            setState('rejected', 'token_shape');
            return 'token_shape';
        }
        let r;
        try { r = await verifyWithRecovery(att, session.access_token); } catch (e) { r = { ok: false, reason: 'error' }; }

        if (r.ok) {
            const w = writeCompat(r);
            if (w.ok || (origin !== 'login' && w.why !== 'session_changed')) {
                verified = { sub: r.sub, sid: r.sid, profile: r.profile, isAdmin: r.isAdmin };
                lastRejected = null;
                setState('signed_in', w.ok ? null : w.why);
                return 'signed_in';
            }
            if (w.why !== 'session_changed') {
                // 로그인하는 사이에 옛 방식의 값이 생겼거나 저장할 수 없다 → 덮어쓰지 않고 이 로그인을 끝낸다
                verified = null;
                const e = await boundEnd(att);
                lastRejected = e === 'ended' ? null : att;
                setState(e === 'ended' ? 'signed_out' : 'rejected', w.why);
                return w.why === 'legacy_present' ? 'legacy_present' : 'error';
            }
            r = { ok: false, reason: 'session_changed' };
        }

        verified = null;
        if (r.reason === 'no_member' && r.definitive) {
            // 회원 대응이 없는 계정: 이 로그인을 끝낸다(끝났다고 확인됐을 때만 "로그인 전")
            const e = await boundEnd(att);
            clearCompat(att.sid);
            lastRejected = e === 'ended' ? null : att;
            setState(e === 'ended' ? 'signed_out' : 'rejected', 'no_member');
            return 'no_member';
        }
        if (r.ended) removeStoredIf(att);      // 서버가 끝났다고 답한 그 기록만 이 브라우저에서 지운다
        clearCompat(att.sid);
        lastRejected = att;
        setState('rejected', r.reason);
        return r.reason;
    }

    // 공식 클라이언트의 알림·저장소의 변화(이 탭·다른 탭의 로그인·로그아웃·갱신) 뒤에 상태를 맞춘다
    // 여기서는 공식 클라이언트에 묻지 않고 저장된 로그인을 직접 본다 — 공식 클라이언트에 물으면 갱신이 일어날 수 있고,
    // 갱신의 알림이 다시 이 함수를 부르므로(기기의 시계가 틀린 경우 등) 갱신이 되풀이될 수 있다.
    // 이 탭이 확인해 둔 것을 거둔다: 본인 정보·사이트 접근·표시를 더는 내주지 않는다.
    // 서버의 로그인 기록·저장된 로그인 값·다른 로그인의 호환 값은 건드리지 않는다.
    // 새 모듈이 만든 호환 값은 표식의 로그인 기록 번호가 sid(이 탭이 확인했던 그 기록)와 정확히 같을 때만 정리한다.
    // 다르거나 주인을 알 수 없으면 지우지 않고 이 탭의 표시만 거둔다.
    function withdraw(why, sid) {
        verified = null;
        clearCompat(sid === undefined ? null : sid, true);
        setState('rejected', why);
    }

    // 지금 저장된 로그인의 기록(sub·sid). 없거나 읽을 수 없으면 null
    function heldClaims() {
        const st = storedSession();
        return st && st.claims ? st.claims : null;
    }

    // 기다린 일(SDK 받기·저장된 로그인 읽기)이 실패로 끝났을 때의 정리.
    //   began: 기다리기 전에 잡아 둔, 이 탭이 복원·재확인하려던 기록. 실패한 뒤 다시 읽은 기록으로는 정리하지 않는다.
    //   저장된 기록이 시작 때 그대로면 그 기록으로 만든 호환 값만 정리하고 참을 돌려준다.
    //   그 사이 달라졌거나 시작 때 무엇이었는지 모르면 아무것도 지우지 않고 거짓을 돌려준다(이 탭의 표시만 거둔다).
    function cleanAfterFailedWait(began) {
        if (!began || !same(began, heldClaims())) return false;
        clearCompat(began.sid, true);
        return true;
    }

    // 저장된 로그인을 읽는 일이 실패로 끝남(갱신 실패 등) → 아무것도 확인할 수 없다.
    function failedRead(began) {
        verified = null;
        if (cleanAfterFailedWait(began)) {
            lastRejected = began;                  // 같은 기록을 알림마다 다시 묻지 않는다(시작 때의 그 기록만)
            setState('rejected', 'network');
            return;
        }
        // 기다리는 사이 저장된 로그인이 달라졌거나(다른 탭), 시작할 때 무엇이었는지 모른다:
        // 아무것도 지우지 않고, 지금 저장된 기록을 거절된 기록으로 남기지도 않는다.
        // 지금 저장된 것은 다음 상태 맞추기에서 별도의 확인으로만 그린다
        lastRejected = null;
        const now = heldClaims();
        setState('rejected', began && now ? 'session_changed' : 'network');
        if (now) scheduleReconcile();
    }

    async function reconcile() {
        let present = true;
        try { present = window.localStorage.getItem(STORAGE_KEY) !== null; } catch (e) {
            // 저장소를 읽지 못한다 → 무엇이 저장돼 있는지 모른다. 앞서 확인한 것을 그대로 믿지 않는다
            if (state === 'signed_in') withdraw('unreadable', verified ? verified.sid : null);
            return;
        }
        const st = present ? storedSession() : null;
        const s = st && st.claims && typeof st.accessToken === 'string' ? { access_token: st.accessToken } : null;
        if (!present) {
            if (state === 'signed_in') {
                const sid = verified ? verified.sid : null;
                verified = null;
                clearCompat(sid);
                setState('rejected', 'ended');      // 이 탭이 끝낸 것이 아니다 → 다시 로그인 필요
            }
            return;
        }
        if (!s) {
            // 풀이할 수 없는 값이 저장돼 있다: 그 값은 건드리지 않는다. 다만 앞서 확인한 로그인이 지금도 그것이라고 볼 수 없다
            if (state === 'signed_in') withdraw('unreadable', verified ? verified.sid : null);
            return;
        }
        const c = st.claims;
        if (verified && same(c, verified)) return;                 // 같은 로그인 기록(갱신 포함)
        if (!verified && same(c, lastRejected)) return;
        await settle(s, 'event');
    }

    // 작업을 하나씩 차례로(시작·로그인·로그아웃·복원·다시 확인이 서로 끼어들지 않게). 시작은 화면이 다 읽힌 뒤.
    let tail = new Promise(function (resolve) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { resolve(); });
        else resolve();
    });
    function enqueue(fn) {
        const run = tail.then(fn);
        tail = run.then(function () {}, function () {});
        return run;
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
        loadConfig();
        // 저장된 새 방식의 로그인이 없으면 기다릴 것이 없다 → 바로 "로그인 전"
        let hasStored = true;
        try { hasStored = window.localStorage.getItem(STORAGE_KEY) !== null; } catch (e) { hasStored = true; }
        if (!hasStored) { clearCompat(null); setState('signed_out', null); }
        const beganLoad = hasStored ? heldClaims() : null;     // 기다리기 전에: 이 탭이 복원하려던 기록
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
            cleanAfterFailedWait(beganLoad);       // 확인할 수 없다: 시작할 때 저장돼 있던 그 기록으로 만든 값만
            setState('signed_out', 'unavailable');
            return;
        }
        const beganRead = heldClaims();            // 기다리기 전에: 이 탭이 복원하려던 기록
        const cur = await readSession();
        if (cur.error) { failedRead(beganRead); return; }
        if (!cur.session) { clearCompat(null); setState('signed_out', null); return; }
        await settle(cur.session, 'restore');
    }

    function outcomeOf(result) {
        if (result === 'signed_in' || result === 'legacy_present' || result === 'blocked' ||
            result === 'withdrawal_pending' || result === 'no_member' || result === 'maintenance' ||
            result === 'not_allowed' || result === 'session_changed' || result === 'expired' ||
            result === 'rate_limited') return result;
        return 'error';
    }

    function signIn(email, password) {
        return enqueue(async function () {
            if (!client) return { outcome: 'error' };
            // 옛 방식의 로그인 상태가 있으면 인증 요청을 보내기 전에 멈춘다(덮어쓰지 않는다)
            let slot;
            try { slot = readSlot(); } catch (e) { return { outcome: 'error' }; }
            if (slot.kind === 'foreign') return { outcome: 'legacy_present' };
            // 이 브라우저에 새 방식의 로그인이 이미 있으면 그것부터 끝낸다(이 로그인만).
            // 끝났는지 모르면 새 로그인 요청을 보내지 않는다.
            let hasStored = true;
            try { hasStored = window.localStorage.getItem(STORAGE_KEY) !== null; } catch (e) { hasStored = true; }
            if (hasStored) {
                const st = storedSession();
                if (!st || !st.claims) {
                    if (state === 'signed_in') withdraw('unreadable', verified ? verified.sid : null);
                    return { outcome: 'previous_unknown' };
                }
                if ((await boundEnd(st.claims)) !== 'ended') {
                    // 끝났는지 모른다: 새 로그인을 보내지 않고, 이 탭이 그 로그인에 대해 확인해 둔 것도 거둔다
                    if (same(verified, st.claims) || state === 'signed_in') { lastRejected = st.claims; withdraw('logout_unknown', st.claims.sid); }
                    return { outcome: 'previous_unknown' };
                }
                if (same(verified, st.claims)) verified = null;
                clearCompat(st.claims.sid);
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
                return { outcome: wrong ? 'invalid_credentials' : (err && err.status === 429 ? 'rate_limited' : 'error') };
            }
            const att = decodeClaims(r.data.session.access_token);
            const result = await settle(r.data.session, 'login');
            // attempt: 이 시도의 로그인 기록 번호(비밀이 아니다). 화면은 이동 직전에 isCurrent 로 다시 본다
            return { outcome: outcomeOf(result), attempt: att ? att.sid : null };
        });
    }

    // 이 사이트의 이 로그인만 끝낸다(전역 종료 아님). 서버가 끝났다고 답했을 때만 signed_out 이다.
    function signOut() {
        return enqueue(async function () {
            if (!client) return { outcome: 'error' };
            let hasStored = true;
            try { hasStored = window.localStorage.getItem(STORAGE_KEY) !== null; } catch (e) { hasStored = true; }
            if (!hasStored) {
                const sid = verified ? verified.sid : null;
                verified = null;
                lastRejected = null;
                clearCompat(sid);
                setState('signed_out', null);
                return { outcome: 'signed_out' };
            }
            // 이 탭이 알고 있는 로그인(확인했거나 방금 거절된 것)만 끝낸다
            const st = storedSession();
            const mine = verified || lastRejected;
            if (!st || !st.claims || !same(st.claims, mine)) {
                // 저장된 로그인이 이 탭이 확인한 것이 아니다(바뀌었거나 읽을 수 없다): 끝내지 않는다. 이 탭이 확인해 둔 것은 거둔다
                const was = verified ? verified.sid : null;
                lastRejected = null;
                withdraw(st && st.claims ? 'session_changed' : 'unreadable', was);
                if (st && st.claims) scheduleReconcile();         // 바뀐 로그인은 별도의 확인으로만
                return { outcome: 'changed' };
            }
            const e = await boundEnd(st.claims);
            if (e !== 'ended') {
                // 실패·모름: 끝냈다고 하지 않는다. 그렇다고 "확인된 로그인"으로 남겨 두지도 않는다
                // (서버의 로그인 기록과 저장된 로그인 값은 그대로 둔다)
                lastRejected = e === 'changed' ? null : st.claims;
                withdraw(e === 'changed' ? 'session_changed' : 'logout_unknown', st.claims.sid);
                if (e === 'changed') scheduleReconcile();
                return { outcome: e === 'changed' ? 'changed' : 'unknown' };
            }
            verified = null;
            lastRejected = null;
            clearCompat(st.claims.sid);
            setState('signed_out', null);
            return { outcome: 'signed_out' };
        });
    }

    // 서버에 다시 물어 상태를 새로 정한다
    function recheck() {
        return enqueue(async function () {
            if (!client) return state;
            lastRejected = null;
            // 기다리기 전에: 이 탭이 재확인하려던 기록(이 탭이 확인해 둔 것이 있으면 저장된 것이 그것일 때만)
            const stored0 = heldClaims();
            const began = !verified || same(verified, stored0) ? stored0 : null;
            const cur = await readSession();
            if (cur.error) { failedRead(began); return state; }
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
        if (cur.error || !same(c, verified)) throw EonAuthError('session_changed');
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
        // 그 시도(attempt)의 로그인이 지금도 확인된 로그인이고 표시할 수 있는가(화면이 이동 직전에 본다)
        isCurrent: function (attempt) {
            return typeof attempt === 'string' && state === 'signed_in' && !!verified && verified.sid === attempt && displayUserRaw() !== null;
        },
        // 확인된 본인 정보(my_profile 의 여섯 열)와 사이트 접근(my_site_access). 확인 전이면 null.
        // (확인된 로그인이 지금도 저장된 그 로그인일 때만 — 저장값이 바뀌었거나 읽을 수 없으면 알림을 기다리지 않고 null)
        profile: function () { return state === 'signed_in' && verified && storedIs(verified) ? Object.assign({}, verified.profile) : null; },
        siteAccess: function () { return state === 'signed_in' && verified && storedIs(verified) ? { allowed: true, is_admin: verified.isAdmin } : null; },
        displayUserRaw: displayUserRaw,
        bindDisplay: bindDisplay,
        headersForGrade: headersForGrade,
        credentialFor: credentialFor
    });

    // 다른 탭이 호환 값이나 새 방식의 로그인을 바꾸면 표시를 다시 보고 상태를 맞춘다
    // (키 이름만 본다 — 다른 로그인 상태의 값은 읽지 않는다)
    window.addEventListener('storage', function (ev) {
        if (!ev) return;
        if (ev.key === COMPAT_USER || ev.key === COMPAT_TIME || ev.key === MARK_KEY || ev.key === null) redraw(false);
        if (ev.key === STORAGE_KEY || ev.key === null) { redraw(false); scheduleReconcile(); }
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
