// 가짜 브라우저: 가짜 화면(DOM 흉내)·가짜 저장소·가짜 시계·가짜 fetch·가짜 탭 사이 알림.
// 실제 브라우저가 아니다 — 여기서 통과한 것은 "실제 화면에서 된다"의 증거가 아니다.
// 화면의 스크립트(js/*.js)와 SDK 사본(vendor/supabase-2.116.0.js)은 실제 파일을 그대로 올린다.

import vm from 'node:vm';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function headerPairs(headers) {
    if (!headers) return [];
    if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
        const out = [];
        headers.forEach((value, name) => out.push([String(name), String(value)]));
        return out;
    }
    return Reflect.ownKeys(headers).map((name) => [String(name), String(headers[name])]);
}

class FakeEl {
    constructor(page, tag, label) {
        this._page = page;
        this._label = label || tag;
        this._attrs = {};
        this._listeners = [];
        this._html = '';
        this._text = '';
        this._children = [];
        this._single = {};      // 선택자 → 요소
        this._lists = {};       // 선택자 → () => 요소 배열
        this._closest = {};     // 선택자 → 참/거짓
        this.tagName = String(tag).toUpperCase();
        this.id = '';
        this.className = '';
        this.value = '';
        this.disabled = false;
        this.firstChild = null;
        const el = this;
        const style = { _display: '', _css: '' };
        Object.defineProperty(style, 'display', {
            get() { return style._display; },
            set(v) { style._display = String(v); page.rec({ t: 'style', el: el._label, prop: 'display', value: String(v) }); },
            enumerable: true,
        });
        Object.defineProperty(style, 'cssText', {
            get() { return style._css; },
            set(v) { style._css = String(v); page.rec({ t: 'style', el: el._label, prop: 'cssText', value: String(v).replace(/\s+/g, ' ').trim() }); },
            enumerable: true,
        });
        this.style = style;
        this.classList = {
            _set: new Set(),
            add: (c) => { this.classList._set.add(c); },
            remove: (c) => { this.classList._set.delete(c); },
            toggle: (c) => { if (this.classList._set.has(c)) this.classList._set.delete(c); else this.classList._set.add(c); },
            contains: (c) => this.classList._set.has(c),
        };
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v); this._page.rec({ t: 'html', el: this._label, html: String(v).replace(/\s+/g, ' ').trim() }); }
    get outerHTML() { return `<${this.tagName.toLowerCase()}>`; }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); this._page.rec({ t: 'text', el: this._label, text: String(v) }); }
    get href() { return this._attrs.href; }
    set href(v) { this.setAttribute('href', v); }
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
    setAttribute(name, value) { this._attrs[name] = String(value); this._page.rec({ t: 'attr', el: this._label, name, value: String(value) }); }
    addEventListener(type, fn) { this._listeners.push({ type, fn }); }
    removeEventListener(type, fn) { this._listeners = this._listeners.filter((l) => !(l.type === type && l.fn === fn)); }
    querySelector(sel) { return this._single[sel] || null; }
    querySelectorAll(sel) { return this._lists[sel] ? this._lists[sel]() : []; }
    closest(sel) { return this._closest[sel] ? this : null; }
    appendChild(child) { this._children.push(child); this._page.onAppend(this, child); return child; }
    insertBefore(child) { this._children.unshift(child); this._page.rec({ t: 'box', cls: child.className, text: child._text }); return child; }
    remove() { this._page.rec({ t: 'remove', el: this._label }); }
    scrollIntoView() {}
    async fire(type, event) {
        const out = [];
        for (const l of this._listeners.filter((x) => x.type === type)) out.push(l.fn.call(this, event || { preventDefault() {} }));
        await Promise.allSettled(out);
    }
}

export class FakePage {
    constructor(browser, name, opts) {
        this.browser = browser;
        this.name = name;
        this.closed = false;
        this.trace = [];
        this.confirmAnswer = opts.confirmAnswer !== false;
        this.files = opts.files;                    // (경로) → 글자 또는 null
        this.winListeners = [];
        this.docListeners = [];
        this.created = [];
        this.byId = {};
        this.session = new Map();
        this.scriptLoads = [];
        this.search = opts.search || '';
        this.hash = opts.hash || '';
        this.pageFile = opts.pageFile;
        this._buildDom(opts.dom || {});
        this._buildContext();
    }

    rec(entry) {
        entry.page = this.name;
        this.browser.log(entry);
        this.trace.push(entry);
        return entry;
    }

    el(tag, label, id) {
        const e = new FakeEl(this, tag, label);
        if (id) { e.id = id; this.byId[id] = e; }
        return e;
    }

    _buildDom(dom) {
        const page = this;
        this.head = this.el('head', 'head');
        this.body = this.el('body', 'body');
        const singles = {};
        const lists = {};
        for (const id of dom.ids || []) this.el('div', '#' + id, id);
        if (this.byId.navMenu) {
            this.byId.navMenu._lists['.nav-item.has-dropdown'] = () => [];
            this.byId.navMenu._lists['.dropdown-menu a'] = () => [];
        }
        if (dom.formContainer) singles['.form-container'] = this.el('div', '.form-container');
        if (dom.loading) singles['.loading'] = this.el('div', '.loading');
        // 학습 자료 링크
        this.materials = (dom.materials || []).map((n) => this.el('a', 'materials-link-' + n));
        lists['a[href="materials.html"], a[href="materials.html?id"]'] = () => this.materials;
        // 신청 링크(주소가 바뀌면 선택자에 더는 걸리지 않는다)
        this.appLinks = (dom.appLinks || []).map((spec) => {
            const a = this.el('a', 'app-link-' + spec.where);
            a._attrs.href = spec.href;
            a._text = spec.text;
            a._closest[spec.where] = true;
            return a;
        });
        lists['a[href="application.html"], a[href="application-form.html"]'] = () =>
            this.appLinks.filter((a) => a._attrs.href === 'application.html' || a._attrs.href === 'application-form.html');
        lists['a[href^="#"]'] = () => [];

        this.document = {
            readyState: 'loading',
            visibilityState: 'visible',
            hidden: false,
            head: this.head,
            body: this.body,
            getElementById: (id) => page.byId[id] || null,
            querySelector: (sel) => singles[sel] || null,
            querySelectorAll: (sel) => (lists[sel] ? lists[sel]() : []),
            createElement: (tag) => { const e = page.el(tag, 'created-' + tag); page.created.push(e); return e; },
            addEventListener: (type, fn) => { page.docListeners.push({ type, fn }); },
            removeEventListener: (type, fn) => { page.docListeners = page.docListeners.filter((l) => !(l.type === type && l.fn === fn)); },
        };
        Object.defineProperty(this.document, 'cookie', {
            get() { page.rec({ t: 'cookie', op: 'read' }); return ''; },
            set() { page.rec({ t: 'cookie', op: 'write' }); },
        });
    }

    onAppend(parent, child) {
        if (child.id) { this.byId[child.id] = child; child._label = '#' + child.id; }
        if (child.tagName === 'SCRIPT' && child.src) {
            const src = String(child.src);
            this.scriptLoads.push(src);
            this.rec({ t: 'script', src });
            const source = this.files(src.split('?')[0]);
            this.browser.setTimer(this, () => {
                if (source === null || source === undefined) { if (child.onerror) child.onerror(new Error('load')); return; }
                vm.runInContext(source, this.context, { filename: 'page:' + src });
                if (child.onload) child.onload();
            }, 0);
        } else {
            this.rec({ t: 'append', el: child._label, to: parent._label });
        }
    }

    _buildContext() {
        const page = this;
        const browser = this.browser;
        const sb = {};
        const trap = (label) => function () { page.rec({ t: 'forbidden', what: label }); throw new Error('가짜 fetch 가 아닌 통신 시도: ' + label); };

        const fakeConsole = {};
        for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
            fakeConsole[level] = (...args) => page.rec({
                t: 'console', level,
                text: args.map((a) => (a && typeof a === 'object' && typeof a.message === 'string' ? `${a.name}:${a.message}` : String(a))).join(' '),
            });
        }
        const loc = {
            origin: 'http://127.0.0.1:8787', protocol: 'http:', host: '127.0.0.1:8787', hostname: '127.0.0.1', port: '8787',
            pathname: '/' + this.pageFile, search: this.search, hash: this.hash,
            reload() { page.rec({ t: 'reload' }); },
            assign(v) { page.rec({ t: 'nav', to: String(v) }); },
            replace(v) { page.rec({ t: 'nav', to: String(v) }); },
        };
        Object.defineProperty(loc, 'href', {
            get() { return loc.origin + loc.pathname + loc.search + loc.hash; },
            set(v) { page.rec({ t: 'nav', to: String(v) }); },
            enumerable: true,
        });

        Object.assign(sb, {
            console: fakeConsole,
            document: this.document,
            navigator: { userAgent: 'fake-browser', sendBeacon: trap('navigator.sendBeacon') },
            localStorage: browser.makeLocalStorage(this),
            sessionStorage: {
                getItem: (k) => (this.session.has(String(k)) ? this.session.get(String(k)) : null),
                setItem: (k, v) => { this.session.set(String(k), String(v)); },
                removeItem: (k) => { this.session.delete(String(k)); },
            },
            fetch: (url, init) => browser.doFetch(this, url, init),
            setTimeout: (fn, ms, ...a) => browser.setTimer(this, () => fn(...a), ms, false),
            clearTimeout: (id) => browser.clearTimer(id),
            setInterval: (fn, ms, ...a) => browser.setTimer(this, () => fn(...a), ms, true),
            clearInterval: (id) => browser.clearTimer(id),
            alert: (m) => { page.rec({ t: 'alert', text: String(m) }); },
            confirm: (m) => { page.rec({ t: 'confirm', text: String(m) }); return page.confirmAnswer; },
            addEventListener: (type, fn) => { page.winListeners.push({ type, fn }); },
            removeEventListener: (type, fn) => { page.winListeners = page.winListeners.filter((l) => !(l.type === type && l.fn === fn)); },
            BroadcastChannel: browser.makeBroadcastChannel(this),
            XMLHttpRequest: trap('XMLHttpRequest'),
            WebSocket: trap('WebSocket'),
            EventSource: trap('EventSource'),
            URL, URLSearchParams, Headers, Response, AbortController, Blob, TextEncoder, TextDecoder,
            atob, btoa, queueMicrotask, structuredClone,
            crypto: globalThis.crypto,
            innerWidth: 1280,
            __now: () => browser.now,
        });
        Object.defineProperty(sb, 'location', {
            get() { return loc; },
            set(v) { page.rec({ t: 'nav', to: String(v) }); },
            enumerable: true,
        });
        sb.window = sb;
        sb.self = sb;
        this.context = vm.createContext(sb);
        vm.runInContext(
            '(() => { const R = Date; class D extends R { constructor(...a) { if (a.length === 0) super(__now()); else super(...a); } static now() { return __now(); } } globalThis.Date = D; })();',
            this.context,
        );
        this.sandbox = sb;
    }

    run(source, filename) {
        vm.runInContext(source, this.context, { filename: 'page:' + filename });
    }

    evaluate(code) {
        return vm.runInContext(code, this.context);
    }

    dispatchWindow(type, event) {
        for (const l of this.winListeners.filter((x) => x.type === type)) {
            try { l.fn(event); } catch (e) { this.rec({ t: 'listener-error', text: String(e && e.message) }); }
        }
    }

    async domContentLoaded() {
        this.document.readyState = 'interactive';
        for (const l of this.docListeners.filter((x) => x.type === 'DOMContentLoaded')) {
            try { l.fn({}); } catch (e) { this.rec({ t: 'listener-error', text: String(e && e.message) }); }
        }
        this.document.readyState = 'complete';
        await this.browser.idle();
    }

    close() { this.closed = true; }
}

export class FakeBrowser {
    // net: async (요청, 쪽) → { status, headers, body } 또는 예외(네트워크 오류)
    constructor({ startMs, net }) {
        this.now = startMs || 1795500000000;
        this.net = net;
        this.timers = [];
        this.timerSeq = 0;
        this.local = new Map();
        this.storageLog = [];
        this.pages = [];
        this.channels = [];
        this.channelLog = [];
        this.requests = [];
        this.pending = 0;
        this.events = [];
        this.seq = 0;
    }

    log(entry) { entry.n = ++this.seq; this.events.push(entry); return entry; }

    open(name, opts) {
        const page = new FakePage(this, name, opts);
        this.pages.push(page);
        return page;
    }

    setTimer(page, fn, ms, repeat) {
        const id = ++this.timerSeq;
        const delay = Math.max(0, Number(ms) || 0);
        this.timers.push({ id, at: this.now + delay, fn, every: repeat ? Math.max(1, delay) : 0, page });
        return id;
    }
    clearTimer(id) { this.timers = this.timers.filter((t) => t.id !== id); }

    runDue() {
        let ran = 0;
        for (;;) {
            const due = this.timers.filter((t) => t.at <= this.now).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            if (due.every) due.at = this.now + due.every; else this.clearTimer(due.id);
            if (!due.page.closed) {
                try { due.fn(); } catch (e) { this.log({ t: 'timer-error', text: String(e && e.message) }); }
            }
            if (++ran > 5000) throw new Error('가짜 시계: 타이머가 끝없이 돈다');
        }
        return ran;
    }

    // 할 일이 없어질 때까지(지금 시각의 타이머·진행 중인 가짜 요청)
    async idle() {
        let quiet = 0;
        for (let i = 0; i < 5000 && quiet < 5; i++) {
            await tick();
            const ran = this.runDue();
            if (ran === 0 && this.pending === 0) quiet++; else quiet = 0;
        }
        if (quiet < 5) throw new Error('가짜 브라우저가 잠잠해지지 않음');
    }

    // 몇 번만 돌린다(응답을 일부러 붙잡아 둔 동안 — idle 은 끝나지 않는다)
    async spin(times) {
        for (let i = 0; i < times; i++) { await tick(); this.runDue(); }
    }

    // 가짜 시계를 앞으로(다음 타이머 시각마다 멈춰 처리)
    async advance(ms) {
        const end = this.now + ms;
        await this.idle();          // 지금 시각의 일을 먼저 끝낸다
        while (this.now < end) {
            const next = this.timers.filter((t) => !t.page.closed && t.at > this.now).map((t) => t.at).sort((a, b) => a - b)[0];
            this.now = Math.min(end, next === undefined ? end : next);
            await this.idle();
        }
    }

    makeLocalStorage(page) {
        const b = this;
        const note = (op, key) => b.storageLog.push({ op, key, page: page.name, n: ++b.seq });
        return {
            getItem(k) { k = String(k); note('get', k); return b.local.has(k) ? b.local.get(k) : null; },
            setItem(k, v) {
                k = String(k); v = String(v); note('set', k);
                const old = b.local.has(k) ? b.local.get(k) : null;
                b.local.set(k, v);
                b.emitStorage(page, k, old, v);
            },
            removeItem(k) {
                k = String(k); note('remove', k);
                const old = b.local.has(k) ? b.local.get(k) : null;
                b.local.delete(k);
                b.emitStorage(page, k, old, null);
            },
            key(i) { note('key', String(i)); return [...b.local.keys()][i] ?? null; },
            get length() { note('length', ''); return b.local.size; },
            clear() { note('clear', ''); b.local.clear(); },
        };
    }

    emitStorage(from, key, oldValue, newValue) {
        if (oldValue === newValue) return;
        for (const p of this.pages) {
            if (p === from || p.closed) continue;
            this.setTimer(p, () => p.dispatchWindow('storage', { key, oldValue, newValue }), 0);
        }
    }

    makeBroadcastChannel(page) {
        const b = this;
        return class FakeBroadcastChannel {
            constructor(name) {
                this.name = String(name);
                this.onmessage = null;
                this._listeners = [];
                this._closed = false;
                this._page = page;
                b.channels.push(this);
                b.channelLog.push({ page: page.name, name: this.name });
            }
            postMessage(data) {
                const copy = JSON.parse(JSON.stringify(data));
                for (const c of b.channels) {
                    if (c === this || c._closed || c.name !== this.name || c._page.closed) continue;
                    b.setTimer(c._page, () => {
                        const ev = { data: copy };
                        c._listeners.forEach((fn) => fn(ev));
                        if (typeof c.onmessage === 'function') c.onmessage(ev);
                    }, 0);
                }
            }
            addEventListener(type, fn) { if (type === 'message') this._listeners.push(fn); }
            removeEventListener(type, fn) { this._listeners = this._listeners.filter((f) => f !== fn); }
            close() { this._closed = true; }
        };
    }

    doFetch(page, url, init) {
        const opt = init && typeof init === 'object' ? init : {};
        const first = {
            page: page.name,
            url: String(url),
            method: opt.method === undefined ? 'GET' : String(opt.method),
            headers: headerPairs(opt.headers),
            body: opt.body,
            bodyText: typeof opt.body === 'string' ? opt.body : (opt.body === undefined || opt.body === null ? null : '[본문:' + typeof opt.body + ']'),
            redirect: opt.redirect === undefined ? 'follow' : opt.redirect,
            credentials: opt.credentials,
            viaRedirect: false,
            n: ++this.seq,
        };
        this.pending++;
        const send = async (req, hops) => {
            this.requests.push(req);
            page.rec({ t: 'fetch', url: req.url, method: req.method });
            const r = await this.net(req, page);
            if (r && r.status >= 300 && r.status < 400 && r.headers && r.headers.Location) {
                if (req.redirect === 'error') throw new TypeError('Failed to fetch (redirect blocked)');
                if (req.redirect !== 'manual' && hops < 3) {
                    // 브라우저가 리디렉션을 따라간 것으로 본다(같은 머리글로 다시 보냄)
                    return send(Object.assign({}, req, { url: String(r.headers.Location), viaRedirect: true, n: ++this.seq }), hops + 1);
                }
            }
            const status = r.status;
            const nullBody = status === 204 || status === 304 || (status >= 300 && status < 400);
            return new Response(nullBody ? null : (r.body === undefined ? '' : r.body), { status, headers: r.headers || {} });
        };
        return send(first, 0).finally(() => { this.pending--; });
    }
}
