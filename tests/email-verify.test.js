// 가입 이메일 인증 공통 부품 — 순수 도우미 + 화면 흐름 단위 테스트
// 실행: node --test tests/email-verify.test.js
// (브라우저 없이 최소한의 DOM 흉내로 mount() 흐름까지 확인한다. 서버 호출은 fetch를 가짜로 바꿔 검사.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------- 아주 작은 DOM 흉내 ----------
function makeEl(tag) {
    const classes = new Set();
    const el = {
        tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, attrs: {}, listeners: {},
        disabled: false, value: '', textContent: '', innerHTML: '', id: '', type: '', parentNode: null,
        get className() { return [...classes].join(' '); },
        set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
        classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); } },
        get parentElement() { return this.parentNode; },
        set parentElement(v) { this.parentNode = v; },
        appendChild(c) { if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(x => x !== c); this.children.push(c); c.parentNode = this; return c; },
        insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); c.parentNode = this; return c; },
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
        dispatch(ev, arg) { (this.listeners[ev] || []).forEach(fn => fn(arg || { key: '' })); },
        focus() {}, select() {}, scrollIntoView() {},
        querySelector(sel) {
            if (sel.includes('submit')) return this.submitBtn || null;
            if (sel.includes('emailStatus')) return this.statusEl || null;
            return null;
        },
    };
    return el;
}

function loadComponent({ fetchImpl, session = {} }) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'email-verify.js'), 'utf8');
    const head = makeEl('head');
    const byId = {};
    const document = {
        head,
        createElement: (t) => makeEl(t),
        getElementById: (id) => byId[id] || null,
    };
    const sessionStorage = {
        getItem: (k) => (k in session ? session[k] : null),
        setItem: (k, v) => { session[k] = v; },
        removeItem: (k) => { delete session[k]; },
    };
    const timers = [];
    // 실제 공홈처럼 SUPABASE_URL/KEY 는 전역 식별자(최상위 const)로만 존재하고 window 속성이 아니다
    const window = {
        document, sessionStorage, fetch: fetchImpl, console,
        setInterval: (fn, ms) => { timers.push(fn); return timers.length; },
        clearInterval: () => {},
    };
    window.window = window;
    vm.runInNewContext("const SUPABASE_URL = 'https://example.supabase.co'; const SUPABASE_ANON_KEY = 'anon';\n" + src, window);
    return { EmailVerify: window.EmailVerify, timers, byId, session };
}

function fakeFetch(script) {
    // script: 배열 — 호출 순서대로 돌려줄 응답 객체
    const calls = [];
    const impl = async (url, init) => {
        assert.equal(url, 'https://example.supabase.co/functions/v1/email-verify');   // 주소가 비면 공홈 404로 가던 실제 사고 재현 방지
        assert.equal(init.headers.Authorization, 'Bearer anon');
        const body = JSON.parse(init.body);
        calls.push(body);
        const next = script.shift() || { ok: false, reason: 'server_error' };
        return { ok: true, json: async () => next };
    };
    impl.calls = calls;
    return impl;
}

function setup(script, opts = {}) {
    const fetchImpl = fakeFetch(script);
    const { EmailVerify, timers, session } = loadComponent({ fetchImpl, session: opts.session });
    const form = makeEl('form'); const submitBtn = makeEl('button'); form.submitBtn = submitBtn;
    // 실제 페이지처럼: form-group > (상태표시 wrapper > 이메일칸 + 배지) + 인증 div
    const group = makeEl('div');
    const wrap = makeEl('div'); wrap.style.position = 'relative';
    const emailInput = makeEl('input'); emailInput.value = opts.email || ''; emailInput.className = opts.inputClass || '';
    const badge = makeEl('span'); badge.textContent = opts.badge || ''; wrap.statusEl = badge;
    wrap.appendChild(emailInput); wrap.appendChild(badge);
    const container = makeEl('div');
    group.appendChild(wrap); group.appendChild(container);
    const ev = EmailVerify.mount({ form, emailInput, container });
    const { row1, row2, sendBtn, timerEl, codeInput, confirmBtn, status } = ev._els;
    return { ev, fetchImpl, timers, session, submitBtn, emailInput, sendBtn, timerEl, codeInput, confirmBtn, status, row1, row2, group, wrap, badge, container };
}

const tick = () => new Promise(r => setImmediate(r));

// ---------- 순수 도우미 ----------
test('fmt: 초를 m:ss 로', () => {
    const { EmailVerify } = loadComponent({ fetchImpl: async () => ({}) });
    const { fmt, normalize, validEmail } = EmailVerify._internal;
    assert.equal(fmt(180), '3:00');
    assert.equal(fmt(59), '0:59');
    assert.equal(fmt(0), '0:00');
    assert.equal(normalize('  Kim@Gmail.com '), 'kim@gmail.com');
    assert.equal(validEmail('sadf@asdfg.asdgf'), true);   // 모양 검사만 (존재 여부는 서버/메일이 판단)
    assert.equal(validEmail('nope'), false);
});

test('인증 칸 div가 없는 옛 HTML이어도 멈추지 않고 이메일 칸 아래에 직접 만든다', () => {
    const { EmailVerify } = loadComponent({ fetchImpl: async () => ({}) });
    const form = makeEl('form'); form.submitBtn = makeEl('button');
    const wrap = makeEl('div'); wrap.style.position = 'relative';
    const emailInput = makeEl('input'); emailInput.parentElement = wrap;
    let inserted = null;
    wrap.insertAdjacentElement = (where, el) => { inserted = { where, el }; };
    const ev = EmailVerify.mount({ form, emailInput, container: null });
    assert.ok(inserted && inserted.where === 'afterend');
    assert.equal(ev.isVerified(), false);
    assert.deepEqual(ev._els.row1.children, [wrap, ev._els.sendBtn]);   // wrapper째 줄 안으로 옮기고 오른쪽에 버튼
});

// ---------- 배치 ----------
test('배치: 이메일 칸 오른쪽에 버튼, 안내 줄은 처음엔 비어 있고 자리도 차지하지 않는다', () => {
    const s = setup([], { inputClass: 'form-input' });
    assert.deepEqual(s.group.children, [s.row1, s.container]);           // form-group > [줄1][인증 div]
    assert.deepEqual(s.row1.children, [s.wrap, s.sendBtn]);              // 줄1 = [이메일 wrapper][인증번호 받기]
    assert.ok(s.wrap.classList.contains('email-verify-field'));
    assert.equal(s.sendBtn.textContent, '인증번호 받기');
    assert.equal(s.row2.style.display, 'none');
    assert.equal(s.status.style.display, 'none');
    assert.equal(s.status.textContent, '');
    assert.equal(s.codeInput.className, 'form-input');                    // 번호 칸은 페이지 입력칸 모양을 따른다
    assert.equal(s.row2.children[0].children[0], s.codeInput);            // 줄2 = [번호칸+남은시간][확인]
    assert.equal(s.row2.children[0].children[1], s.timerEl);
    assert.equal(s.row2.children[1], s.confirmBtn);
});

test('없는 도메인 거절 시 이메일 칸 안의 "사용 가능" 표시를 비운다', async () => {
    const s = setup([{ ok: false, reason: 'domain_not_found' }], { email: 'sadf@asdfg.asdgf', badge: '사용 가능' });
    s.sendBtn.dispatch('click'); await tick();
    assert.equal(s.badge.textContent, '');
    assert.equal(s.status.textContent, '존재하지 않는 이메일 도메인이에요. 주소를 다시 확인해 주세요.');
    assert.equal(s.status.style.display, '');
});

// ---------- 화면 흐름 ----------
test('처음엔 제출 버튼이 잠긴다', () => {
    const s = setup([]);
    assert.equal(s.submitBtn.disabled, true);
    assert.equal(s.ev.isVerified(), false);
    assert.equal(s.ev.requireVerified(), false);
});

test('받기 → 확인 성공 → 인증 완료 + 제출 버튼 풀림 + 세션 기록', async () => {
    const s = setup([{ ok: true, expires_in: 180, resend_after: 30 }, { ok: true }], { email: 'Kim@Gmail.com' });
    s.sendBtn.dispatch('click'); await tick();
    assert.equal(s.fetchImpl.calls[0].action, 'request');
    assert.equal(s.fetchImpl.calls[0].email, 'kim@gmail.com');   // 소문자 정규화
    assert.equal(s.row2.style.display, 'flex');
    assert.equal(s.timerEl.textContent, '3:00');
    assert.equal(s.sendBtn.disabled, true);                        // 재발송 30초 전엔 잠김
    s.codeInput.value = '482913';
    s.confirmBtn.dispatch('click'); await tick();
    assert.equal(s.fetchImpl.calls[1].action, 'confirm');
    assert.equal(s.fetchImpl.calls[1].code, '482913');
    assert.equal(s.ev.isVerified(), true);
    assert.equal(s.submitBtn.disabled, false);
    assert.equal(s.sendBtn.textContent, '인증 완료 ✓');          // 완료 표시는 오른쪽 버튼이 맡는다
    assert.equal(s.sendBtn.dataset.verified, '1');
    assert.equal(s.row2.style.display, 'none');                   // 번호 줄은 사라짐
    assert.equal(s.status.style.display, 'none');                 // 안내 줄은 비움
    const saved = JSON.parse(s.session.iontoefl_email_verified);
    assert.equal(saved.email, 'kim@gmail.com');
});

test('틀린 번호는 남은 횟수 표시, 5회째는 재발송 안내', async () => {
    const s = setup([{ ok: true }, { ok: false, reason: 'wrong', remaining: 4 }, { ok: false, reason: 'too_many_attempts' }], { email: 'a@b.co' });
    s.sendBtn.dispatch('click'); await tick();
    s.codeInput.value = '000000'; s.confirmBtn.dispatch('click'); await tick();
    assert.equal(s.status.textContent, '인증번호가 달라요. (4회 남음)');
    assert.equal(s.ev.isVerified(), false);
    s.confirmBtn.dispatch('click'); await tick();
    assert.equal(s.status.textContent, '너무 많이 틀렸어요. 재발송을 눌러주세요.');
    assert.equal(s.codeInput.disabled, true);
});

test('3분이 지나면 만료 안내, 30초 뒤 재발송 가능', async () => {
    const s = setup([{ ok: true, expires_in: 180, resend_after: 30 }], { email: 'a@b.co' });
    s.sendBtn.dispatch('click'); await tick();
    const tickFn = s.timers[0];
    for (let i = 0; i < 29; i++) tickFn();
    assert.equal(s.sendBtn.disabled, true);
    tickFn();                                        // 30초
    assert.equal(s.sendBtn.disabled, false);
    assert.equal(s.sendBtn.textContent, '재발송');
    for (let i = 0; i < 150; i++) tickFn();          // 180초
    assert.equal(s.status.textContent, '시간이 지났어요. 재발송을 눌러주세요.');
    assert.equal(s.codeInput.disabled, true);
});

test('이메일을 고치면 인증이 풀리고, 같은 이메일로 돌아오면 10분 내 기록으로 복원', async () => {
    const s = setup([{ ok: true }, { ok: true }], { email: 'a@b.co' });
    s.sendBtn.dispatch('click'); await tick();
    s.codeInput.value = '123456'; s.confirmBtn.dispatch('click'); await tick();
    assert.equal(s.ev.isVerified(), true);
    s.emailInput.value = 'other@b.co'; s.emailInput.dispatch('input');
    assert.equal(s.ev.isVerified(), false);
    assert.equal(s.submitBtn.disabled, true);
    assert.equal(s.status.textContent, '이메일이 바뀌어 인증이 풀렸어요. 다시 받아주세요.');
    s.emailInput.value = 'a@b.co'; s.emailInput.dispatch('input');
    assert.equal(s.ev.isVerified(), true);
    assert.equal(s.submitBtn.disabled, false);
});

test('새로고침(초안 복원): input 이벤트 없이 값만 채워져도 10분 내 기록이면 인증 인정', () => {
    const session = { iontoefl_email_verified: JSON.stringify({ email: 'a@b.co', at: Date.now() - 5 * 60 * 1000 }) };
    const s = setup([], { email: '', session });
    assert.equal(s.ev.isVerified(), false);
    s.emailInput.value = 'a@b.co';                   // 초안 복원처럼 값만 바뀜
    assert.equal(s.ev.isVerified(), true);
    assert.equal(s.submitBtn.disabled, false);
});

test('10분 지난 기록은 복원하지 않는다', () => {
    const session = { iontoefl_email_verified: JSON.stringify({ email: 'a@b.co', at: Date.now() - 11 * 60 * 1000 }) };
    const s = setup([], { email: 'a@b.co', session });
    assert.equal(s.ev.isVerified(), false);
    assert.equal(s.submitBtn.disabled, true);
});

test('서버 거부 사유별 문구', async () => {
    const cases = [
        ['already_registered', '이미 가입된 이메일이에요. 로그인해 주세요.'],
        ['domain_not_found', '존재하지 않는 이메일 도메인이에요. 주소를 다시 확인해 주세요.'],
        ['too_soon', '12초 뒤에 다시 보낼 수 있어요.'],
        ['hourly_limit', '이 이메일로는 잠시 후에 다시 받을 수 있어요. (1시간 최대 10회)'],
        ['daily_limit', '오늘은 인증 메일을 더 보낼 수 없어요. 내일 다시 시도해 주세요.'],
        ['send_failed', '지금은 인증 메일을 보낼 수 없어요. 잠시 후 다시 시도해 주세요.'],
    ];
    for (const [reason, text] of cases) {
        const s = setup([{ ok: false, reason, retry_after: 12 }], { email: 'a@b.co' });
        s.sendBtn.dispatch('click'); await tick();
        assert.equal(s.status.textContent, text, reason);
        assert.equal(s.submitBtn.disabled, true, reason);
    }
});
