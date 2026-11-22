// 회귀시험 공통 도구: 네트워크 차단, 가짜 브라우저 환경(vm), 호출 기록, 기록 비교.
// 공개 키 값은 어디에도 출력하지 않는다. 차이는 "어느 호출의 어느 항목(헤더 이름)"만 남긴다.

import vm from 'node:vm';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';

// ---------------------------------------------------------------------------
// 1. 실제 네트워크 차단
//    시험은 가짜 fetch 만 쓴다. 그 밖의 길로 요청이 나가려 하면 여기 기록되고 예외가 난다.
// ---------------------------------------------------------------------------
export const realNetworkAttempts = [];

function blocker(label) {
    return function blockedNetworkCall() {
        realNetworkAttempts.push(label);
        throw new Error(`실제 네트워크 요청 시도 차단: ${label}`);
    };
}

function defineGlobal(name, value) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

export function installNetworkGuard() {
    net.Socket.prototype.connect = blocker('net.Socket.connect');
    net.connect = blocker('net.connect');
    net.createConnection = blocker('net.createConnection');
    tls.connect = blocker('tls.connect');
    http.request = blocker('http.request');
    http.get = blocker('http.get');
    https.request = blocker('https.request');
    https.get = blocker('https.get');
    http2.connect = blocker('http2.connect');
    dns.lookup = blocker('dns.lookup');
    dns.resolve = blocker('dns.resolve');
    dns.promises.lookup = blocker('dns.promises.lookup');
    dgram.createSocket = blocker('dgram.createSocket');
    defineGlobal('fetch', blocker('Node 전역 fetch'));
    defineGlobal('WebSocket', blocker('Node 전역 WebSocket'));
    defineGlobal('EventSource', blocker('Node 전역 EventSource'));
}

// 차단 장치가 실제로 막는지 스스로 확인한다(막힌 호출은 연결을 열기 전에 예외로 끝난다).
// 확인이 끝나면 기록을 비운다. 돌려주는 값: 확인한 경로 수.
export function verifyNetworkGuard() {
    const probes = [
        () => new net.Socket().connect(80, '127.0.0.1'),
        () => net.connect(80, '127.0.0.1'),
        () => net.createConnection(80, '127.0.0.1'),
        () => tls.connect(443, '127.0.0.1'),
        () => http.request('http://127.0.0.1/'),
        () => http.get('http://127.0.0.1/'),
        () => https.request('https://127.0.0.1/'),
        () => https.get('https://127.0.0.1/'),
        () => http2.connect('https://127.0.0.1/'),
        () => dns.lookup('localhost', () => {}),
        () => dns.resolve('localhost', () => {}),
        () => dns.promises.lookup('localhost'),
        () => dgram.createSocket('udp4'),
        () => globalThis.fetch('http://127.0.0.1/'),
        () => new globalThis.WebSocket('ws://127.0.0.1/'),
        () => new globalThis.EventSource('http://127.0.0.1/'),
    ];
    realNetworkAttempts.length = 0;
    let verified = 0;
    for (const probe of probes) {
        const before = realNetworkAttempts.length;
        let threw = false;
        try { probe(); } catch (e) { threw = true; }
        if (!threw || realNetworkAttempts.length !== before + 1) {
            throw new Error(`네트워크 차단 장치 자체 점검 실패: ${verified + 1}번째 경로가 막히지 않음`);
        }
        verified++;
    }
    realNetworkAttempts.length = 0;
    return verified;
}

// ---------------------------------------------------------------------------
// 2. 값 직렬화 (반환값·console 인자 비교용)
// ---------------------------------------------------------------------------
export function serialize(value) {
    return JSON.stringify(value, (key, v) => {
        if (v === undefined) return '__undefined__';
        if (typeof v === 'number' && !Number.isFinite(v)) return `__number:${String(v)}__`;
        if (typeof v === 'function') return '__function__';
        return v;
    });
}

function describeConsoleArg(arg) {
    if (arg && typeof arg === 'object' && typeof arg.message === 'string' && typeof arg.name === 'string') {
        return `오류객체:${arg.name}:${arg.message}`;
    }
    return `${typeof arg}:${serialize(arg)}`;
}

// ---------------------------------------------------------------------------
// 3. fetch 에 넘어온 것 기록
// ---------------------------------------------------------------------------
function describeHeaders(headers, plainProto) {
    if (headers === null || typeof headers !== 'object') return { kind: headers === null ? 'null' : typeof headers };
    return {
        kind: 'object',
        plain: Object.getPrototypeOf(headers) === plainProto,
        entries: Reflect.ownKeys(headers).map((name) => {
            const desc = Object.getOwnPropertyDescriptor(headers, name);
            return { name: String(name), value: desc.value, valueType: typeof desc.value, enumerable: desc.enumerable };
        }),
    };
}

async function describeBody(init) {
    if (!init || typeof init !== 'object' || !('body' in init)) return { kind: '없음' };
    const body = init.body;
    if (body === undefined) return { kind: 'undefined' };
    if (typeof body === 'string') return { kind: 'string', text: body };
    if (body instanceof Blob) {
        const bytes = Buffer.from(await body.arrayBuffer());
        return { kind: 'blob', type: body.type, size: body.size, hex: bytes.toString('hex') };
    }
    return { kind: `기타:${typeof body}`, text: String(body) };
}

function makeResponse(scenario) {
    return new Response(scenario.body, { status: scenario.status, headers: scenario.headers || {} });
}

// ---------------------------------------------------------------------------
// 4. 가짜 브라우저 환경에 파일 올리기
// ---------------------------------------------------------------------------
export function createEnv(source, label) {
    const env = { label, current: null, fakeFetchCount: 0, forbidden: [], loadConsole: [] };

    const trap = (name) => function forbiddenChannel() {
        env.forbidden.push(name);
        throw new Error(`가짜 fetch 가 아닌 통신 시도: ${name}`);
    };

    function fakeFetch(...fetchArgs) {
        env.fakeFetchCount++;
        const call = env.current;
        if (!call) {
            env.forbidden.push('호출 구간 밖의 fetch');
            return Promise.reject(new Error('호출 구간 밖의 fetch'));
        }
        const [url, init] = fetchArgs;
        const isObj = init !== null && typeof init === 'object';
        const record = {
            argCount: fetchArgs.length,
            urlType: typeof url,
            url: String(url),
            initType: init === null ? 'null' : typeof init,
            initKeys: isObj ? Reflect.ownKeys(init).map(String) : null,
            method: isObj ? init.method : undefined,
            methodType: isObj ? typeof init.method : 'undefined',
            headers: describeHeaders(isObj ? init.headers : undefined, env.plainProto),
            body: null,
        };
        call.fetches.push(record);
        const done = describeBody(init).then((body) => { record.body = body; });
        call.pending.push(done);
        return done.then(() => makeResponse(call.scenario));
    }

    const fakeConsole = {};
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        fakeConsole[level] = (...args) => {
            const entry = { level, args: args.map(describeConsoleArg) };
            (env.current ? env.current.console : env.loadConsole).push(entry);
        };
    }

    const sandbox = {
        fetch: fakeFetch,
        console: fakeConsole,
        URLSearchParams,
        atob,
        btoa,
        Blob,
        XMLHttpRequest: trap('XMLHttpRequest'),
        WebSocket: trap('WebSocket'),
        EventSource: trap('EventSource'),
        navigator: { sendBeacon: trap('navigator.sendBeacon') },
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;

    const context = vm.createContext(sandbox);
    const propsBeforeLoad = new Set(Object.getOwnPropertyNames(sandbox));
    env.plainProto = vm.runInContext('Object.prototype', context);
    vm.runInContext(source, context, { filename: `${label}/supabase-config.js` });

    env.context = context;
    env.api = vm.runInContext('({ supabaseAPI, supabaseStorage, fetchAPI })', context);
    env.key = vm.runInContext('SUPABASE_ANON_KEY', context);
    env.baseUrl = vm.runInContext('SUPABASE_URL', context);
    // 파일이 window(전역 객체)에 새로 붙인 이름들 — function/var 선언은 여기 잡히고 const/let 은 안 잡힌다.
    env.windowAdded = Object.getOwnPropertyNames(sandbox).filter((n) => !propsBeforeLoad.has(n)).sort();
    env.typeOf = (name) => vm.runInContext(`typeof ${name}`, context);
    return env;
}

// ---------------------------------------------------------------------------
// 5. 호출 한 번 실행하고 기록
// ---------------------------------------------------------------------------
export async function runCall(env, label, invoke, scenario) {
    const call = { fetches: [], console: [], pending: [], scenario };
    env.current = call;
    let outcome;
    try {
        const value = await invoke(env.api);
        outcome = { type: '반환', value: serialize(value) };
    } catch (e) {
        const isObj = e !== null && typeof e === 'object';
        outcome = { type: '오류', name: String(isObj ? e.name : typeof e), message: String(isObj ? e.message : e) };
    }
    await Promise.allSettled(call.pending);
    env.current = null;
    return { label, fetches: call.fetches, outcome, console: call.console };
}

// ---------------------------------------------------------------------------
// 6. 두 기록 비교 — 값은 남기지 않고 위치만 남긴다
// ---------------------------------------------------------------------------
export function diffCall(a, b) {
    const diffs = [];
    const at = (what) => diffs.push(`${a.label} › ${what}`);

    if (a.label !== b.label) at('호출 이름');
    if (a.fetches.length !== b.fetches.length) at('fetch 횟수');

    const n = Math.min(a.fetches.length, b.fetches.length);
    for (let i = 0; i < n; i++) {
        const x = a.fetches[i];
        const y = b.fetches[i];
        const p = `fetch#${i + 1} `;
        const simple = [
            ['argCount', '인자 수'], ['urlType', '주소 자료형'], ['url', '주소'],
            ['initType', '옵션 자료형'], ['method', '메서드'], ['methodType', '메서드 자료형'],
        ];
        for (const [field, name] of simple) if (x[field] !== y[field]) at(p + name);
        if (JSON.stringify(x.initKeys) !== JSON.stringify(y.initKeys)) at(p + '옵션 이름·순서');

        if (x.headers.kind !== y.headers.kind) {
            at(p + '헤더 자료형');
        } else if (x.headers.kind === 'object') {
            if (x.headers.plain !== y.headers.plain) at(p + '헤더 객체 종류');
            const xn = x.headers.entries.map((e) => e.name);
            const yn = y.headers.entries.map((e) => e.name);
            const sameOrder = xn.length === yn.length && xn.every((v, k) => v === yn[k]);
            const sameSet = JSON.stringify([...xn].sort()) === JSON.stringify([...yn].sort());
            if (!sameOrder && sameSet) at(p + `헤더 순서 [${xn.join(', ')}]`);
            for (const e of x.headers.entries) {
                const o = y.headers.entries.find((z) => z.name === e.name);
                if (!o) { at(p + `헤더 빠짐 [${e.name}]`); continue; }
                if (e.value !== o.value || e.valueType !== o.valueType) at(p + `헤더 값 [${e.name}]`);
                if (e.enumerable !== o.enumerable) at(p + `헤더 속성 [${e.name}]`);
            }
            for (const e of y.headers.entries) {
                if (!x.headers.entries.some((z) => z.name === e.name)) at(p + `헤더 추가됨 [${e.name}]`);
            }
        }

        if (x.body.kind !== y.body.kind) {
            at(p + '본문 종류');
        } else if (x.body.kind === 'blob') {
            if (x.body.type !== y.body.type) at(p + 'Blob MIME');
            if (x.body.size !== y.body.size) at(p + 'Blob 크기');
            if (x.body.hex !== y.body.hex) at(p + 'Blob 바이트');
        } else if (x.body.text !== y.body.text) {
            at(p + '본문');
        }
    }

    if (a.outcome.type !== b.outcome.type) {
        at('결과 종류(반환/오류)');
    } else if (a.outcome.type === '반환') {
        if (a.outcome.value !== b.outcome.value) at('반환값');
    } else {
        if (a.outcome.name !== b.outcome.name) at('오류 종류');
        if (a.outcome.message !== b.outcome.message) at('오류 메시지');
    }

    if (JSON.stringify(a.console) !== JSON.stringify(b.console)) at('console 출력');
    return diffs;
}

// ---------------------------------------------------------------------------
// 7. 기록이 계약서의 네 가지 헤더 모양과 맞는지(변경 전·후 각각) 확인
//    비교 대상이 둘 다 같이 틀린 경우나, 시험 도구가 아무것도 못 잡는 경우를 걸러낸다.
// ---------------------------------------------------------------------------
const JSON_TYPE = 'application/json';

function expectedHeaders(shape, key, mime) {
    const base = [['apikey', key], ['Authorization', `Bearer ${key}`]];
    if (shape === 'json') return [...base, ['Content-Type', JSON_TYPE]];
    if (shape === 'json+return') return [...base, ['Content-Type', JSON_TYPE], ['Prefer', 'return=representation']];
    if (shape === 'json+count') return [...base, ['Content-Type', JSON_TYPE], ['Prefer', 'count=exact']];
    if (shape === 'upload') return [...base, ['Content-Type', mime], ['x-upsert', 'true']];
    throw new Error(`알 수 없는 헤더 모양: ${shape}`);
}

export function checkExpectations(record, target, input, env) {
    const problems = [];
    const at = (what) => problems.push(`${record.label} › ${what}`);

    const expectedFetches = input.noFetch ? 0 : 1;
    if (record.fetches.length !== expectedFetches) {
        at(`fetch 횟수가 기대(${expectedFetches})와 다름`);
        return problems;
    }
    if (input.noFetch) {
        if (input.noFetch === '오류' && record.outcome.type !== '오류') at('fetch 전 오류가 나야 하는 입력인데 오류가 없음');
        return problems;
    }

    const f = record.fetches[0];
    if (f.argCount !== 2) at('fetch 인자 수');
    if (f.urlType !== 'string') at('주소 자료형');
    if (!f.url.startsWith(env.baseUrl + target.urlPrefix)) at('주소 앞부분');
    if (f.method !== target.method) at('메서드');

    if (f.headers.kind !== 'object' || !f.headers.plain) {
        at('헤더가 일반 객체가 아님');
    } else {
        const want = expectedHeaders(target.shape, env.key, input.expect ? input.expect.mime : undefined);
        const got = f.headers.entries;
        const names = got.map((e) => e.name);
        const wantNames = want.map((w) => w[0]);
        if (JSON.stringify(names) !== JSON.stringify(wantNames)) at(`헤더 이름·순서가 기대(${wantNames.join(', ')})와 다름`);
        for (const [name, value] of want) {
            const e = got.find((z) => z.name === name);
            if (!e) continue;
            if (e.value !== value || e.valueType !== 'string') at(`헤더 값 [${name}]`);
            if (!e.enumerable) at(`헤더 속성 [${name}]`);
        }
    }

    if (target.shape === 'upload') {
        if (f.body.kind !== 'blob') {
            at('본문이 Blob 이 아님');
        } else {
            if (f.body.type !== input.expect.mime.toLowerCase()) at('Blob MIME 이 기대와 다름');
            if (f.body.hex !== input.expect.hex) at('Blob 바이트가 입력 원본과 다름');
            if (f.body.size !== input.expect.hex.length / 2) at('Blob 크기가 입력 원본과 다름');
        }
    } else if (target.hasBody) {
        if (!(f.body.kind === 'string' || f.body.kind === 'undefined')) at('본문 종류');
    } else if (f.body.kind !== '없음') {
        at('본문이 없어야 하는 요청에 본문이 있음');
    }
    return problems;
}
