// 계약 3C-1 의 회귀시험이 쓰는 "화면 그대로의 가짜 DOM".
// 3A 의 가짜 화면(browser.mjs)은 index·login 두 화면의 요소만 손으로 적어 둔 것이다. 대상 화면 26개는
// 화면의 HTML 을 읽어 요소(id·class·속성·부모/자식)를 그대로 만들고, 화면의 스크립트를 실제 파일 그대로 올린다.
// 전부 가짜다 — 실제 브라우저가 아니다. 그리기·배치·이벤트 전파를 흉내 내지 않는다.
// 기준(BASE)과 작업본을 같은 가짜 DOM 에서 돌려 견주므로, 흉내가 모자란 곳은 양쪽에 똑같이 모자라다.

import vm from 'node:vm';
import { extractScripts } from './world.mjs';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// ---- HTML 을 요소 나무로 ----
function parseAttrs(text) {
    const attrs = {};
    const re = /([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(text))) attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    return attrs;
}

export function parseTree(html) {
    const clean = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const root = { tag: '#root', attrs: {}, children: [], parent: null };
    const stack = [root];
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    let m;
    while ((m = re.exec(clean))) {
        const tag = m[2].toLowerCase();
        if (m[1]) {
            for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
            continue;
        }
        const node = { tag, attrs: parseAttrs(m[3].replace(/\/\s*$/, '')), children: [], parent: stack[stack.length - 1] };
        node.parent.children.push(node);
        if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
    }
    return root;
}

// ---- 선택자(자주 쓰는 모양만) ----
function parseCompound(text) {
    const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [], ok: true };
    let rest = text;
    const tag = /^[a-zA-Z*][a-zA-Z0-9-]*/.exec(rest);
    if (tag) { c.tag = tag[0] === '*' ? null : tag[0].toLowerCase(); rest = rest.slice(tag[0].length); }
    while (rest.length) {
        let m;
        if ((m = /^#([\w-]+)/.exec(rest))) c.id = m[1];
        else if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
        else if ((m = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(rest))) c.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]) });
        else if ((m = /^:([\w-]+)(?:\(([^)]*)\))?/.exec(rest))) c.pseudos.push({ name: m[1], arg: m[2] });
        else { c.ok = false; break; }
        rest = rest.slice(m[0].length);
    }
    return c;
}
function parseSelector(sel) {
    return String(sel).split(',').map((alt) => {
        const parts = [];
        const re = /\s*(>)\s*|\s+/g;
        let last = 0;
        let comb = null;
        let m;
        const text = alt.trim();
        while ((m = re.exec(text))) {
            if (m.index === last) { last = re.lastIndex; continue; }
            parts.push({ comb, c: parseCompound(text.slice(last, m.index)) });
            comb = m[1] ? '>' : ' ';
            last = re.lastIndex;
        }
        parts.push({ comb, c: parseCompound(text.slice(last)) });
        return parts;
    });
}
function matchCompound(el, c, scope) {
    if (!c.ok) return false;
    if (c.tag && el._tag !== c.tag) return false;
    if (c.id !== null && el.id !== c.id) return false;
    const classes = String(el.className || '').split(/\s+/).concat([...el.classList._set]);
    for (const k of c.classes) if (!classes.includes(k)) return false;
    for (const a of c.attrs) {
        const v = el.getAttribute(a.name);
        if (v === null) return false;
        if (a.op === '=' && v !== a.value) return false;
        if (a.op === '^=' && !v.startsWith(a.value)) return false;
        if (a.op === '$=' && !v.endsWith(a.value)) return false;
        if (a.op === '*=' && !v.includes(a.value)) return false;
        if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    }
    for (const p of c.pseudos) {
        if (p.name === 'checked') { if (!el.checked) return false; }
        else if (p.name === 'scope') { if (el !== scope) return false; }
        else if (p.name === 'first-child') { if (!el.parentElement || el.parentElement.children[0] !== el) return false; }
        else if (p.name === 'last-child') { const s = el.parentElement && el.parentElement.children; if (!s || s[s.length - 1] !== el) return false; }
        else if (p.name === 'not') { if (matchCompound(el, parseCompound(p.arg || ''), scope)) return false; }
        else return false;
    }
    return true;
}
function matches(el, parts, scope) {
    let i = parts.length - 1;
    if (!matchCompound(el, parts[i].c, scope)) return false;
    let cur = el;
    while (i > 0) {
        const comb = parts[i].comb;
        i--;
        if (comb === '>') {
            cur = cur.parentElement;
            if (!cur || !matchCompound(cur, parts[i].c, scope)) return false;
        } else {
            let found = null;
            for (let p = cur.parentElement; p; p = p.parentElement) if (matchCompound(p, parts[i].c, scope)) { found = p; break; }
            if (!found) return false;
            cur = found;
        }
    }
    return true;
}
function descendants(el, out = []) {
    for (const ch of el.children) { out.push(ch); descendants(ch, out); }
    return out;
}
function queryAll(scope, sel) {
    let alts;
    try { alts = parseSelector(sel); } catch (e) { return []; }
    return descendants(scope).filter((el) => alts.some((parts) => matches(el, parts, scope)));
}

// ---- 요소 ----
const STUB = Symbol('stub');
function makeStub() {
    const fn = function () { return undefined; };
    fn[STUB] = true;
    return fn;
}

function wrap(page, raw) {
    if (raw.__proxy) return raw.__proxy;
    const proxy = new Proxy(raw, {
        get(target, prop, receiver) {
            if (prop === '__raw') return target;
            if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, target);
            if (prop === 'then') return undefined;
            return makeStub();       // 흉내 내지 않은 메서드(scroll·focus·animate 등)는 아무것도 하지 않는다
        },
        set(target, prop, value) {
            if (prop === 'innerHTML') {
                target.innerHTML = value;
                rebuildChildren(page, proxy, String(value));
                return true;
            }
            target[prop] = value;
            return true;
        },
    });
    raw.__proxy = proxy;
    return proxy;
}

function setupEl(page, raw, node) {
    raw._tag = node ? node.tag : raw.tagName.toLowerCase();
    raw.children = [];
    raw.parentElement = null;
    raw.dataset = {};
    raw.checked = false;
    raw.required = false;
    raw.readOnly = false;
    raw.type = '';
    raw.name = '';
    raw.files = [];
    raw.options = [];
    raw.selectedIndex = -1;
    raw.scrollTop = 0;
    raw.offsetHeight = 0;
    raw.offsetWidth = 0;
    if (node) {
        for (const [k, v] of Object.entries(node.attrs)) {
            raw._attrs[k] = v;
            if (k.startsWith('data-')) raw.dataset[k.slice(5).replace(/-([a-z])/g, (m, ch) => ch.toUpperCase())] = v;
        }
        if (node.attrs.id) raw.id = node.attrs.id;
        if (node.attrs.class) raw.className = node.attrs.class;
        if (node.attrs.value !== undefined) raw.value = node.attrs.value;
        if (node.attrs.type !== undefined) raw.type = node.attrs.type;
        if (node.attrs.name !== undefined) raw.name = node.attrs.name;
        raw.checked = 'checked' in node.attrs;
        raw.disabled = 'disabled' in node.attrs;
        raw.required = 'required' in node.attrs;
        raw.readOnly = 'readonly' in node.attrs;
        const display = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(node.attrs.style || '');
        if (display) raw.style._display = display[1].trim();
    }
    const proxy = wrap(page, raw);
    // 범위 안 찾기
    raw.querySelector = (sel) => queryAll(proxy, sel)[0] || null;
    raw.querySelectorAll = (sel) => queryAll(proxy, sel);
    raw.closest = (sel) => {
        let alts;
        try { alts = parseSelector(sel); } catch (e) { return null; }
        for (let p = proxy; p; p = p.parentElement) if (alts.some((parts) => matches(p, parts, null))) return p;
        return null;
    };
    raw.matches = (sel) => { try { return parseSelector(sel).some((parts) => matches(proxy, parts, null)); } catch (e) { return false; } };
    raw.contains = (other) => { for (let p = other; p; p = p.parentElement) if (p === proxy) return true; return false; };
    raw.appendChild = (child) => {
        const c = child && child.__raw ? child : child;
        if (c && c.__raw) { c.__raw.parentElement = proxy; raw.children.push(c); }
        raw._children.push(child && child.__raw ? child.__raw : child);
        page.onAppend(raw, child && child.__raw ? child.__raw : child);
        if (child && child.id) page.byId[child.id] = child;
        return child;
    };
    raw.append = (...kids) => { for (const k of kids) if (k && typeof k === 'object') raw.appendChild(k); };
    raw.insertBefore = (child) => {
        if (child && child.__raw) { child.__raw.parentElement = proxy; raw.children.unshift(child); }
        raw._children.unshift(child);
        page.rec({ t: 'box', cls: child && child.className, text: child && child._text, id: child && child.id });
        if (child && child.id) page.byId[child.id] = child;
        return child;
    };
    raw.removeChild = (child) => { raw.children = raw.children.filter((x) => x !== child); return child; };
    raw.remove = () => {
        page.rec({ t: 'remove', el: raw._label });
        if (raw.parentElement && raw.parentElement.__raw) raw.parentElement.__raw.children = raw.parentElement.__raw.children.filter((x) => x !== proxy);
    };
    raw.focus = () => {};
    raw.blur = () => {};
    raw.click = () => { raw.fire('click', { preventDefault() {}, stopPropagation() {}, target: proxy, currentTarget: proxy }); };
    raw.reset = () => {};
    raw.select = () => {};
    raw.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    raw.hasAttribute = (name) => name in raw._attrs;
    raw.removeAttribute = (name) => { delete raw._attrs[name]; };
    raw.cloneNode = () => proxy;
    Object.defineProperty(raw, 'firstElementChild', { get() { return raw.children[0] || null; }, configurable: true });
    Object.defineProperty(raw, 'lastElementChild', { get() { return raw.children[raw.children.length - 1] || null; }, configurable: true });
    Object.defineProperty(raw, 'childNodes', { get() { return raw.children; }, configurable: true });
    Object.defineProperty(raw, 'innerText', { get() { return raw._text; }, set(v) { raw.textContent = v; }, configurable: true });
    return proxy;
}

let labelSeq = 0;
function build(page, node, parent) {
    const label = node.attrs.id ? '#' + node.attrs.id : `${node.tag}${node.attrs.class ? '.' + node.attrs.class.split(/\s+/)[0] : ''}~${++labelSeq}`;
    const raw = page.el(node.tag, label, null);
    const proxy = setupEl(page, raw, node);
    raw.parentElement = parent;
    if (node.attrs.id) page.byId[node.attrs.id] = proxy;
    for (const ch of node.children) raw.children.push(build(page, ch, proxy));
    return proxy;
}

function rebuildChildren(page, proxy, html) {
    const raw = proxy.__raw;
    raw.children = [];
    if (!/</.test(html)) return;
    let tree;
    try { tree = parseTree(html); } catch (e) { return; }
    for (const ch of tree.children) raw.children.push(build(page, ch, proxy));
}

// 화면 하나를 연다: HTML 로 요소를 만들고, script 태그를 순서대로 올리고, DOMContentLoaded 까지.
//   w        world.mjs 의 makeWorld 가 만든 세계
//   opts     search, hash, confirmAnswer, noIdle(DOMContentLoaded 뒤에 잠잠해질 때까지 기다리지 않음), dropScript(올리지 않을 src — 파일을 받지 못한 경우)
export async function openPage(w, name, pageFile, opts = {}) {
    const html = w.files(pageFile);
    if (html === null) throw new Error('없는 화면: ' + pageFile);
    labelSeq = 0;
    const page = w.browser.open(name, { files: w.files, pageFile, search: opts.search, hash: opts.hash, dom: {}, confirmAnswer: opts.confirmAnswer });
    page.byId = {};
    const tree = parseTree(html);
    const find = (n, tag) => { for (const ch of n.children) { if (ch.tag === tag) return ch; const r = find(ch, tag); if (r) return r; } return null; };
    const htmlNode = find(tree, 'html') || tree;
    const bodyNode = find(htmlNode, 'body') || { tag: 'body', attrs: {}, children: [] };

    // html·head·body 는 3A 의 가짜 화면이 만든 것을 그대로 쓴다(인증 모듈의 숨김 규칙·표시가 거기에 붙는다)
    const rootProxy = setupEl(page, page.root, { tag: 'html', attrs: htmlNode.attrs || {}, children: [] });
    page.root._trackClass = true;
    const headProxy = setupEl(page, page.head, { tag: 'head', attrs: {}, children: [] });
    const bodyProxy = setupEl(page, page.body, { tag: 'body', attrs: bodyNode.attrs || {}, children: [] });
    page.head.parentElement = rootProxy;
    page.body.parentElement = rootProxy;
    page.root.children = [headProxy, bodyProxy];
    for (const ch of bodyNode.children) page.body.children.push(build(page, ch, bodyProxy));
    page.rootProxy = rootProxy;
    page.bodyProxy = bodyProxy;

    const doc = page.document;
    doc.head = headProxy;
    doc.body = bodyProxy;
    doc.documentElement = rootProxy;
    doc.title = '';
    doc.getElementById = (id) => page.byId[id] || null;
    doc.querySelector = (sel) => queryAll(rootProxy, sel)[0] || null;
    doc.querySelectorAll = (sel) => queryAll(rootProxy, sel);
    doc.getElementsByClassName = (k) => queryAll(rootProxy, '.' + k);
    doc.getElementsByTagName = (t) => queryAll(rootProxy, t);
    doc.getElementsByName = (n) => queryAll(rootProxy, `[name="${n}"]`);
    doc.createElement = (tag) => { const raw = page.el(tag, 'created-' + tag); page.created.push(raw); return setupEl(page, raw, null); };
    doc.createTextNode = (text) => ({ nodeType: 3, textContent: String(text) });
    doc.createDocumentFragment = () => doc.createElement('fragment');
    doc.execCommand = () => false;
    doc.activeElement = bodyProxy;

    // 화면이 쓰는 그 밖의 브라우저 기능(아무것도 하지 않는 흉내)
    const sb = page.sandbox;
    const noop = () => {};
    Object.assign(sb, {
        matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        requestAnimationFrame: (fn) => sb.setTimeout(fn, 16),
        cancelAnimationFrame: (id) => sb.clearTimeout(id),
        scrollTo: noop, scrollBy: noop, scroll: noop,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        history: { pushState: (s, t, u) => page.rec({ t: 'history', op: 'push', to: String(u) }), replaceState: (s, t, u) => page.rec({ t: 'history', op: 'replace', to: String(u) }), back: () => page.rec({ t: 'history', op: 'back' }), state: null, length: 1 },
        open: (u) => { page.rec({ t: 'nav', to: 'open:' + String(u) }); return null; },
        FormData: class { constructor() { this._m = new Map(); } get(k) { return this._m.has(k) ? this._m.get(k) : null; } getAll(k) { return this._m.has(k) ? [this._m.get(k)] : []; } has(k) { return this._m.has(k); } append(k, v) { this._m.set(k, v); } set(k, v) { this._m.set(k, v); } entries() { return this._m.entries(); } forEach(fn) { this._m.forEach((v, k) => fn(v, k)); } },
        FileReader: class { readAsDataURL() {} readAsText() {} },
        Image: class {},
        Intl, Math, JSON, Promise, Map, Set, WeakMap, Symbol, Reflect, Proxy, Array, Object, String, Number, Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, parseInt, parseFloat, isNaN, isFinite,
        pageYOffset: 0, scrollY: 0, innerHeight: 800, outerWidth: 1280, devicePixelRatio: 1,
        screen: { width: 1280, height: 800 },
        performance: { now: () => 0 },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        Event: class { constructor(type) { this.type = type; } },
        dispatchEvent: noop,
    });
    // 난수는 화면마다 같은 차례로 나오게 한다(기준과 작업본을 견줄 때 난수 때문에 달라지지 않게)
    let uuidSeq = 0;
    sb.crypto = {
        randomUUID: () => '00000000-0000-4000-8000-' + String(++uuidSeq).padStart(12, '0'),
        getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 255; return arr; },
        subtle: globalThis.crypto.subtle,
    };
    sb.navigator.clipboard = { writeText: () => Promise.resolve() };
    sb.navigator.language = 'ko-KR';
    sb.document.referrer = '';

    // script 태그를 순서대로. 바깥 주소(CDN)의 스크립트는 올리지 않는다(양쪽이 같다). 스크립트의 예외는 기록하고 다음으로 간다.
    for (const s of extractScripts(html)) {
        if (s.src) {
            const src = s.src.split('?')[0];
            if (/^(https?:)?\/\//.test(s.src)) { page.rec({ t: 'run-script', src: '[바깥] ' + s.src, head: s.head }); continue; }
            page.rec({ t: 'run-script', src, head: s.head });
            if (opts.dropScript && opts.dropScript === src) continue;      // 파일을 받지 못한 경우(기록에는 남기지 않는다 — 기준과 견줄 때 시험의 흔적이 섞이지 않게)
            const source = w.files(src);
            if (source === null) { page.rec({ t: 'script-missing', src }); continue; }
            try { page.run(source, s.src); } catch (e) { page.rec({ t: 'script-error', src, text: String(e && e.message) }); }
        } else if (s.inline.trim()) {
            try { vm.runInContext(s.inline, page.context, { filename: 'page:' + pageFile + ':inline' }); } catch (e) { page.rec({ t: 'script-error', src: 'inline', text: String(e && e.message) }); }
        }
    }
    if (opts.beforeLoad) await opts.beforeLoad(page);
    if (opts.noIdle) {
        page.document.readyState = 'interactive';
        for (const l of page.docListeners.filter((x) => x.type === 'DOMContentLoaded')) {
            try { const r = l.fn({}); if (r && typeof r.catch === 'function') r.catch((e) => page.rec({ t: 'listener-error', text: String(e && e.message) })); } catch (e) { page.rec({ t: 'listener-error', text: String(e && e.message) }); }
        }
        page.document.readyState = 'complete';
    } else {
        page.document.readyState = 'interactive';
        for (const l of page.docListeners.filter((x) => x.type === 'DOMContentLoaded')) {
            try { const r = l.fn({}); if (r && typeof r.catch === 'function') r.catch((e) => page.rec({ t: 'listener-error', text: String(e && e.message) })); } catch (e) { page.rec({ t: 'listener-error', text: String(e && e.message) }); }
        }
        page.document.readyState = 'complete';
        for (const l of page.winListeners.filter((x) => x.type === 'load')) { try { l.fn({}); } catch (e) { page.rec({ t: 'listener-error', text: String(e && e.message) }); } }
        await w.browser.idle();
    }
    return page;
}

// 요소의 이벤트를 일으킨다(submit·click). 처리기의 예외는 기록한다.
export async function fire(w, page, el, type) {
    if (!el) throw new Error('요소가 없음');
    const raw = el.__raw || el;
    const ev = { preventDefault() {}, stopPropagation() {}, target: el, currentTarget: el, type };
    const outs = [];
    for (const l of raw._listeners.filter((x) => x.type === type)) {
        try { outs.push(l.fn.call(el, ev)); } catch (e) { page.rec({ t: 'listener-error', text: String(e && e.message) }); }
    }
    await w.browser.idle();
    await Promise.allSettled(outs);
    await w.browser.idle();
}
