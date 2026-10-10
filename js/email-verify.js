// ===== 가입 이메일 인증 — 공통 화면 부품 =====
// 회원가입(register) · 입문서 신청(book-request) · 챌린지 신청서(application-form) 세 곳이 같이 쓴다.
//
// 사용법 (각 페이지에서, 계정 생성 칸이 보이는 상태일 때만 1회):
//   const ev = EmailVerify.mount({
//       form:        document.getElementById('registerForm'),   // 제출 버튼을 잠글 폼
//       emailInput:  document.getElementById('email'),          // 이메일 입력칸
//       container:   document.getElementById('emailVerifyBox'), // 인증 UI를 그릴 빈 div (이메일 칸 바로 아래)
//   });
//   제출 직전:  if (!ev.requireVerified()) return;   // 인증 안 됐으면 문구 표시 + false
//
// 동작(회의 확정): "인증번호 받기" → 6자리 입력칸 + 3:00 카운트다운 → "확인" → 인증 완료 ✓.
//   재발송은 30초 뒤부터(새 번호, 타이머 리셋). 틀리면 남은 횟수 표시(5회). 3분 지나면 재발송 안내.
//   이메일 칸을 고치면 인증이 풀린다. 인증 성공은 sessionStorage에 10분 보관(새로고침·초안 복원 대응).
//   인증 전에는 폼의 제출 버튼이 눌리지 않는다.
//
// 서버: Edge Function email-verify (supabase-config.js의 SUPABASE_URL / SUPABASE_ANON_KEY 사용)
// 입력칸에는 name 을 두지 않는다 (챌린지 신청서의 초안 저장·입력 변경 검사에 섞이지 않게).

(function (global) {
    'use strict';

    const ENDPOINT = () => `${global.SUPABASE_URL}/functions/v1/email-verify`;
    const SESSION_KEY = 'iontoefl_email_verified';
    const VERIFIED_KEEP_MS = 10 * 60 * 1000;   // 인증 성공 기록 10분 보관
    const DEFAULT_TTL = 180;                    // 서버 응답이 없을 때의 기본값(3분)
    const DEFAULT_RESEND = 30;

    const MSG = {
        idle: '이메일을 입력한 뒤 인증번호를 받아주세요.',
        sending: '인증번호를 보내는 중...',
        sent: '인증번호를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.',
        checking: '확인 중...',
        verified: '인증 완료 ✓',
        expired: '시간이 지났어요. 재발송을 눌러주세요.',
        wrong: (n) => `인증번호가 달라요. (${n}회 남음)`,
        tooMany: '너무 많이 틀렸어요. 재발송을 눌러주세요.',
        notFound: '먼저 인증번호를 받아주세요.',
        invalidEmail: '올바른 이메일을 입력해 주세요.',
        invalidCode: '숫자 6자리를 입력해 주세요.',
        registered: '이미 가입된 이메일이에요. 로그인해 주세요.',
        domainNotFound: '존재하지 않는 이메일 도메인이에요. 주소를 다시 확인해 주세요.',
        tooSoon: (s) => `${s}초 뒤에 다시 보낼 수 있어요.`,
        hourly: '이 이메일로는 잠시 후에 다시 받을 수 있어요. (1시간 최대 10회)',
        daily: '오늘은 인증 메일을 더 보낼 수 없어요. 내일 다시 시도해 주세요.',
        sendFailed: '지금은 인증 메일을 보낼 수 없어요. 잠시 후 다시 시도해 주세요.',
        network: '연결이 불안정해요. 잠시 후 다시 시도해 주세요.',
        needVerify: '이메일 인증을 먼저 완료해 주세요.',
        changed: '이메일이 바뀌어 인증이 풀렸어요. 다시 받아주세요.'
    };

    const COLOR = {
        text: '#334155', muted: '#64748b', ok: '#15803d', err: '#dc2626',
        btnBg: '#efeaf7', btnText: '#5b4a7d', border: '#d9d2e6'
    };

    // ---------- 작은 도우미 ----------
    function normalize(v) { return String(v || '').trim().toLowerCase(); }
    function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
    function fmt(sec) {
        const m = Math.floor(sec / 60), s = sec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }
    function readSession() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
    }
    function writeSession(email) {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email, at: Date.now() })); } catch (e) { /* 저장 불가 환경이면 무시 */ }
    }
    function clearSession() {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 무시 */ }
    }
    // 10분 안에 같은 이메일로 인증했으면 true (새로고침·초안 복원 대응)
    function sessionVerified(email) {
        const s = readSession();
        return !!(s && s.email === email && Date.now() - s.at < VERIFIED_KEEP_MS);
    }

    async function call(action, email, code) {
        const resp = await fetch(ENDPOINT(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${global.SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action, email, code })
        });
        let body = null;
        try { body = await resp.json(); } catch (e) { body = null; }
        if (!body) return { ok: false, reason: resp.ok ? 'bad_response' : 'server_error' };
        return body;
    }

    // ---------- 부품 ----------
    function mount(opts) {
        const form = opts.form;
        const emailInput = opts.emailInput;
        let container = opts.container;
        if (!form || !emailInput) throw new Error('EmailVerify.mount: form, emailInput 이 필요합니다.');
        // 브라우저가 옛 HTML(인증 칸 div 없음)을 캐시한 채 새 스크립트만 받은 경우에도 페이지가 멈추지 않게,
        // 칸이 없으면 이메일 입력칸 바로 아래에 직접 만든다.
        if (!container) {
            container = document.createElement('div');
            const wrap = emailInput.parentElement;
            const anchor = (wrap && (wrap.classList.contains('field-with-status') || wrap.style.position === 'relative')) ? wrap : emailInput;
            anchor.insertAdjacentElement('afterend', container);
        }

        // 상태
        let verifiedEmail = null;      // 인증 완료된 이메일(정규화본)
        let codeSentFor = null;        // 번호를 보낸 이메일(정규화본)
        let ttlLeft = 0;               // 남은 유효 초
        let resendLeft = 0;            // 재발송까지 남은 초
        let timerId = null;
        let busy = false;

        // 화면
        container.innerHTML = '';
        container.classList.add('email-verify-box');
        if (!document.getElementById('emailVerifyStyle')) {
            const st = document.createElement('style');
            st.id = 'emailVerifyStyle';
            st.textContent = '.email-verify-box button:disabled{opacity:.55;cursor:default}';
            document.head.appendChild(st);
        }
        container.style.cssText = 'margin-top:6px;';

        const row1 = el('div', 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;');
        const sendBtn = button('인증번호 받기');
        const timerEl = el('span', `font-size:13px; color:${COLOR.muted}; min-width:40px; display:none; font-variant-numeric:tabular-nums;`);
        row1.appendChild(sendBtn); row1.appendChild(timerEl);

        const row2 = el('div', 'display:none; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap;');
        const codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.inputMode = 'numeric';
        codeInput.autocomplete = 'one-time-code';
        codeInput.maxLength = 6;
        codeInput.placeholder = '인증번호 6자리';
        codeInput.setAttribute('aria-label', '이메일 인증번호');
        codeInput.style.cssText = `width:150px; padding:8px 10px; border:1px solid ${COLOR.border}; border-radius:8px; font-size:15px; letter-spacing:3px; font-variant-numeric:tabular-nums;`;
        const confirmBtn = button('확인');
        row2.appendChild(codeInput); row2.appendChild(confirmBtn);

        const status = el('div', `font-size:12px; margin-top:6px; color:${COLOR.muted}; min-height:16px;`);
        status.setAttribute('aria-live', 'polite');
        status.textContent = MSG.idle;

        container.appendChild(row1); container.appendChild(row2); container.appendChild(status);

        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');

        // ---------- 상태 전이 ----------
        function setStatus(text, kind) {
            status.textContent = text;
            status.style.color = kind === 'ok' ? COLOR.ok : kind === 'err' ? COLOR.err : COLOR.muted;
        }
        function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
        function lockSubmit(locked) {
            if (!submitBtn) return;
            if (locked) { submitBtn.disabled = true; submitBtn.dataset.emailVerifyLocked = '1'; }
            else if (submitBtn.dataset.emailVerifyLocked === '1') { submitBtn.disabled = false; delete submitBtn.dataset.emailVerifyLocked; }
        }
        function renderSendBtn() {
            if (verifiedEmail) { sendBtn.style.display = 'none'; return; }
            sendBtn.style.display = '';
            if (!codeSentFor) { sendBtn.textContent = '인증번호 받기'; sendBtn.disabled = busy; return; }
            if (resendLeft > 0) { sendBtn.textContent = `재발송 (${resendLeft}초)`; sendBtn.disabled = true; }
            else { sendBtn.textContent = '재발송'; sendBtn.disabled = busy; }
        }
        function tick() {
            if (ttlLeft > 0) ttlLeft -= 1;
            if (resendLeft > 0) resendLeft -= 1;
            timerEl.textContent = fmt(Math.max(ttlLeft, 0));
            if (ttlLeft <= 0) {
                stopTimer();
                timerEl.style.display = 'none';
                codeInput.disabled = true; confirmBtn.disabled = true;
                setStatus(MSG.expired, 'err');
            }
            renderSendBtn();
        }
        function startTimer(ttl, resend) {
            stopTimer();
            ttlLeft = ttl; resendLeft = resend;
            timerEl.textContent = fmt(ttlLeft); timerEl.style.display = '';
            codeInput.disabled = false; confirmBtn.disabled = false;
            renderSendBtn();
            timerId = setInterval(tick, 1000);
        }
        function markVerified(email) {
            verifiedEmail = email;
            stopTimer();
            timerEl.style.display = 'none';
            row2.style.display = 'none';
            renderSendBtn();
            setStatus(MSG.verified, 'ok');
            writeSession(email);
            lockSubmit(false);
        }
        function reset(reasonText) {
            verifiedEmail = null; codeSentFor = null;
            stopTimer();
            timerEl.style.display = 'none';
            row2.style.display = 'none';
            codeInput.value = '';
            // 세션 기록은 지우지 않는다: 이메일을 고쳤다가 같은 값으로 돌아오면 10분 안에는 복원된다.
            renderSendBtn();
            setStatus(reasonText || MSG.idle, reasonText ? 'err' : null);
            lockSubmit(true);
        }

        // ---------- 동작 ----------
        async function requestCode() {
            const email = normalize(emailInput.value);
            if (!validEmail(email)) { setStatus(MSG.invalidEmail, 'err'); emailInput.focus(); return; }
            busy = true; renderSendBtn(); setStatus(MSG.sending);
            try {
                const r = await call('request', email);
                if (r.ok) {
                    codeSentFor = email;
                    row2.style.display = 'flex';
                    codeInput.value = '';
                    startTimer(Number(r.expires_in) || DEFAULT_TTL, Number(r.resend_after) || DEFAULT_RESEND);
                    setStatus(MSG.sent);
                    codeInput.focus();
                    return;
                }
                if (r.reason === 'already_registered') { setStatus(MSG.registered, 'err'); return; }
                if (r.reason === 'domain_not_found') { setStatus(MSG.domainNotFound, 'err'); emailInput.focus(); return; }
                if (r.reason === 'too_soon') { setStatus(MSG.tooSoon(r.retry_after || DEFAULT_RESEND), 'err'); return; }
                if (r.reason === 'hourly_limit') { setStatus(MSG.hourly, 'err'); return; }
                if (r.reason === 'daily_limit') { setStatus(MSG.daily, 'err'); return; }
                if (r.reason === 'invalid_email') { setStatus(MSG.invalidEmail, 'err'); return; }
                setStatus(MSG.sendFailed, 'err');
            } catch (e) {
                console.warn('이메일 인증 요청 실패:', e);
                setStatus(MSG.network, 'err');
            } finally {
                busy = false; renderSendBtn();
            }
        }

        async function confirmCode() {
            const email = normalize(emailInput.value);
            const code = codeInput.value.trim();
            if (!codeSentFor || email !== codeSentFor) { setStatus(MSG.notFound, 'err'); return; }
            if (!/^\d{6}$/.test(code)) { setStatus(MSG.invalidCode, 'err'); codeInput.focus(); return; }
            busy = true; confirmBtn.disabled = true; setStatus(MSG.checking);
            try {
                const r = await call('confirm', email, code);
                if (r.ok) { markVerified(email); return; }
                if (r.reason === 'wrong') { setStatus(MSG.wrong(r.remaining), 'err'); codeInput.select(); return; }
                if (r.reason === 'expired') { setStatus(MSG.expired, 'err'); codeInput.disabled = true; return; }
                if (r.reason === 'too_many_attempts') { setStatus(MSG.tooMany, 'err'); codeInput.disabled = true; return; }
                if (r.reason === 'not_found') { setStatus(MSG.notFound, 'err'); return; }
                if (r.reason === 'invalid_code') { setStatus(MSG.invalidCode, 'err'); return; }
                setStatus(MSG.network, 'err');
            } catch (e) {
                console.warn('이메일 인증 확인 실패:', e);
                setStatus(MSG.network, 'err');
            } finally {
                busy = false;
                if (!verifiedEmail && ttlLeft > 0 && !codeInput.disabled) confirmBtn.disabled = false;
            }
        }

        sendBtn.addEventListener('click', requestCode);
        confirmBtn.addEventListener('click', confirmCode);
        codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); });
        codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCode(); } });

        // 이메일 칸을 고치면 인증·발송 상태가 풀린다 (같은 값으로 돌아오면 10분 내 기록으로 복원)
        emailInput.addEventListener('input', () => {
            const now = normalize(emailInput.value);
            if (verifiedEmail && now === verifiedEmail) return;
            if (sessionVerified(now)) { markVerified(now); return; }
            if (verifiedEmail || codeSentFor) reset(verifiedEmail ? MSG.changed : null);
        });

        // 초기 상태: 복원 가능하면 인증 완료, 아니면 잠금
        const initial = normalize(emailInput.value);
        if (initial && sessionVerified(initial)) markVerified(initial);
        else reset(null);

        return {
            isVerified() {
                const now = normalize(emailInput.value);
                // 초안 복원처럼 input 이벤트 없이 값이 채워진 경우도 10분 내 기록이면 인정
                if (!verifiedEmail && now && sessionVerified(now)) markVerified(now);
                return !!verifiedEmail && verifiedEmail === now;
            },
            verifiedEmail() { return verifiedEmail; },
            // 제출 직전 검사: 인증 안 됐으면 문구 보여주고 false
            requireVerified() {
                if (this.isVerified()) return true;
                setStatus(MSG.needVerify, 'err');
                try { container.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 무시 */ }
                (codeSentFor ? codeInput : emailInput).focus();
                return false;
            },
            // 로그인 전환 등으로 계정 칸이 사라질 때 잠금 해제
            release() { stopTimer(); lockSubmit(false); },
            reset() { clearSession(); reset(null); }
        };

        function el(tag, css) { const d = document.createElement(tag); d.style.cssText = css; return d; }
        function button(label) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText = `padding:8px 14px; border:1px solid ${COLOR.border}; border-radius:8px; background:${COLOR.btnBg}; color:${COLOR.btnText}; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap;`;
            b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = '#e7dce7'; });
            b.addEventListener('mouseleave', () => { b.style.background = COLOR.btnBg; });
            return b;
        }
    }

    global.EmailVerify = { mount, _internal: { normalize, validEmail, fmt, sessionVerified, SESSION_KEY, VERIFIED_KEEP_MS } };
})(typeof window !== 'undefined' ? window : globalThis);
