/* eon-login-gate:begin v1 — 대상 화면의 head 에 똑같은 글자로 들어 있다(원본: tests/auth-session/login-gate.inline.js, 넣는 도구: gate-sync.mjs) */
(function () {
    'use strict';

    // 이 화면의 새 로그인 스위치. 저장소의 값은 꺼짐('off')이다.
    // 이 값은 시험용 로컬 서버가 화면을 내줄 때만 바꾼다(js/auth-session.js 의 스위치와 함께).
    // 인증 모듈 파일을 받지 못해도 "켜진 화면인지"를 알 수 있게 화면 안에 둔다.
    var EON_LOGIN_PAGE = 'off';

    var PAGE_ON = EON_LOGIN_PAGE === 'on';
    var KEY = 'iontoefl_user';
    var MISSING_TEXT = '로그인 상태를 확인할 수 없습니다. 잠시 뒤 새로 고침해 주세요.';
    var LOGOUT_UNKNOWN_TEXT = '로그아웃을 확인하지 못했습니다. 잠시 뒤 다시 시도해주세요.';

    // 살아 있는 켜진 인증 모듈(파일을 받지 못했거나, 초기화에 실패했거나, 꺼져 있으면 null)
    function mod() {
        var m = window.EonAuth;
        try { return m && typeof m.isOn === 'function' && m.isOn() === true ? m : null; } catch (e) { return null; }
    }

    // 켜진 화면인가: 이 화면의 값이 켜짐이거나 실린 모듈이 켜짐이다(둘이 어긋나면 켜진 쪽으로 본다).
    // 켜진 화면인데 모듈이 없으면 "꺼짐"이 아니라 "닫음"이다 — 저장된 옛 값을 믿지 않는다.
    function on() { return PAGE_ON || !!mod(); }

    // 화면 맨 위의 임시 안내(시험판 문구)
    function notice(text) {
        try {
            var d = document;
            var el = d.getElementById('eonLoginNotice');
            if (!el) {
                el = d.createElement('div');
                el.id = 'eonLoginNotice';
                el.setAttribute('role', 'alert');
                el.style.cssText = 'position:sticky;top:0;z-index:2147483000;background:#fff7ed;color:#9a3412;border-bottom:1px solid #fed7aa;padding:12px 16px;font-size:14px;line-height:1.5;text-align:center;';
                var put = function () { if (d.body) d.body.insertBefore(el, d.body.firstChild); };
                if (d.body) put(); else d.addEventListener('DOMContentLoaded', put);
            }
            el.textContent = String(text);
        } catch (e) { /* 안내를 그리지 못해도 닫힌 것은 그대로다 */ }
    }

    window.EonLogin = Object.freeze({
        // 켜진 화면인가(꺼짐이면 화면은 지금의 코드 그대로 돈다)
        on: on,
        // 켜진 화면인데 인증 모듈이 없는가
        missing: function () { return on() && !mod(); },
        // 화면이 쓸 로그인 값(글자). 꺼짐: 저장된 값 그대로. 켜짐: 인증 모듈이 서버에 확인한 표시 값만(없으면 null)
        raw: function () {
            if (!on()) return window.localStorage.getItem(KEY);
            var m = mod();
            return m ? m.displayUserRaw() : null;
        },
        // 켜진 길에서 닫아 둔 기능인가: 닫혀 있으면 임시 안내 문구, 열려 있으면 null (목록은 js/auth-session.js 한 곳)
        closed: function (name) {
            if (!on()) return null;
            var m = mod();
            return m ? m.closedFeature(name) : MISSING_TEXT;
        },
        // 확인된 표시가 정해지거나 바뀔 때마다 fn 을 부른다(처음 한 번은 바로 — 확인 전이면 로그인 전 모양)
        display: function (fn) {
            var m = mod();
            if (m) { m.bindDisplay(fn); return; }
            try { fn(); } catch (e) { /* 그리지 못해도 닫힌 쪽이다 */ }
        },
        // 로그인 상태가 정해질 때까지(저장된 새 로그인이 없으면 기다릴 것이 없다)
        settle: function () {
            var m = mod();
            return m ? m.ready() : Promise.resolve(on() ? 'missing' : 'off');
        },
        // 회원 화면: 확인이 끝난 뒤 start 를 한 번 부르고, 그 뒤 확인된 계정이 달라지면 화면을 가리고 다시 받는다.
        // 모듈이 없으면 시작하지 않는다(보호 표시·보호 요청 0).
        member: function (start) {
            var m = mod();
            if (m) { m.memberPage(start); return; }
            notice(MISSING_TEXT);
        },
        // 회원 갈래로 시작한 화면: 지금의 확인된 계정을 기준으로 지킨다
        watch: function () {
            var m = mod();
            if (m) m.watchPage();
        },
        // 이 사이트의 이 로그인만 끝낸다. 서버가 끝났다고 답했을 때만 done 을 부른다
        signOutThen: function (done) {
            var m = mod();
            if (!m) { notice(MISSING_TEXT); return; }
            m.signOut().then(function (r) { return r; }, function () { return null; }).then(function (r) {
                if (r && r.outcome === 'signed_out') { done(); return; }
                window.alert(LOGOUT_UNKNOWN_TEXT);
            });
        },
        // 로그인 뒤 돌아갈 주소: 허용 목록에 맞으면 그 주소, 아니면 null
        returnTarget: function (value) {
            var m = mod();
            return m ? m.returnTarget(value) : null;
        },
        notice: notice
    });
})();
/* eon-login-gate:end */
