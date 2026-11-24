// 화면 시험 실행기 (보안작업 묶음2 계약 3A) — 실제 브라우저(Chromium)로 절차를 돌린다.
//
//   node tests/auth-session/screen.mjs --fake            가짜 서버(fake-supabase.mjs)를 상대로 — 작업방이 돌리는 것
//   node tests/auth-session/screen.mjs --real            시험 프로젝트(hmncdheiwqwekdbtijar)를 상대로 — 브레인방만
//   [--out 결과.json] [--only P,1,9] [--pause-timeout-ms 600000] [--headed]
//
// 환경 변수
//   B3A_PLAYWRIGHT   playwright-core 폴더의 경로            B3A_CHROMIUM   chrome.exe 의 경로      (둘 다 필수. 설치·내려받기를 하지 않는다)
//   --real 일 때: B3A_TEST_URL(정확히 시험 프로젝트의 주소), B3A_TEST_ANON_KEY(시험 프로젝트의 anon 키),
//                B3A_PW(합성 계정 공통 비밀번호), B3A_EMAIL_A·_B·_BLK·_WD·_N·_G·_GM, B3A_CONTROL_SECRET(16자 이상), [B3A_CONTROL_PORT]
//
// 지키는 것
//   * 모든 요청(새 창·화면 이동·폼·리디렉션 포함)이 차단기(request-log.mjs)의 결정을 거친 뒤에만 나간다.
//     브라우저는 127.0.0.1 말고는 이름을 풀지 못하게 띄운다 — 시험 프로젝트로 가는 요청은 차단기를 지난 뒤 이 실행기가 대신 내보낸다.
//     리디렉션 응답은 브라우저에 넘기지 않고 다음 주소를 차단기로 다시 가른다. 서비스 워커는 끈다.
//   * 차단기를 붙이지 못하면 아무 화면도 열지 않는다. playwright-core·Chromium 을 쓸 수 없으면 종료한다(다른 방식으로 넘어가지 않는다).
//   * 경우마다 디스크에 남지 않는 새 브라우저 상태(context). 추적·HAR·상태 내보내기·화면 캡처를 하지 않는다.
//   * 비밀번호·이메일·JWT·갱신값을 출력·파일에 쓰지 않는다. 결과에는 정해 둔 판정값·이름·수만 적는다.
//   * --fake 에서는 시험 프로젝트·바깥으로 나가는 연결이 0 이어야 한다(실행기가 연 연결도 센다).
//   * 차단의 예행(P)이 전부 통과하기 전에는 비밀번호를 꺼낼 수 없고(보관함), 뒤의 경우를 하나도 시작하지 않는다.
//   * DB 변경이 남는 멈춤은 내놓는 순간 원복 대상으로 표시하고, 원복 확인을 받기 전에는 다음 경우를 시작하지 않는다.
//   * 제어 포트로 받은 로그인 상태는 출처(발급자·합성 계정·aal·로그인 기록 번호·만료·키)를 확인한 뒤에만 브라우저에 넣는다.
//   종료 코드: 0 통과 / 1 통과 아님 / 2 환경 / 3 원복 확인을 받지 못함·중단 / 4 예행(P) 실패 — 뒤의 경우를 돌리지 않음 / 5 결과에 비밀값의 흔적

import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { TEST_URL, TEST_REF, CONFIG_FILE, readProdConfig } from './rewrite.mjs';
import { createCore, makeIgnore } from './serve-core.mjs';
import { makeDecider, summarize } from './request-log.mjs';
import { buildPageCases, PAGE_CASE_IDS, NOT_RUN_MATRIX } from './screen-pages.mjs';
import { FAKE_APP, FAKE_POST, makePeople } from './business-fake.mjs';
import { FakeSupabase, fakeJwt } from './fake-supabase.mjs';
import { ISSUER, PauseTimeout, PauseBoard, makeVault, runSequence, confirmRevert, checkProvidedSession, browserEnv, controlPassOk } from './screen-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);
function stop(message) { console.error('중단: ' + message); process.exit(2); }

const FAKE = flag('--fake');
const REAL = flag('--real');
if (FAKE === REAL) stop('--fake 또는 --real 중 하나를 주세요');
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;
const PAUSE_TIMEOUT = Number(arg('--pause-timeout-ms', '600000'));
// 실행기 자신의 대조 실험(--fake 에서만): 일부러 고장을 내고 실행기가 멈추는지 본다
//   --selftest leaky-blocker        차단기가 시험 목적지로 가는 요청을 보내 주게 한다 → 예행(P)이 잡고, 뒤의 경우를 시작하지 않아야 한다(종료 코드 4)
//   --selftest silent-operator      가짜 조작자가 DB 변경이 남는 멈춤과 원복 확인에 답하지 않는다 → 다음 경우를 시작하지 않아야 한다(종료 코드 3)
//   --selftest bad-session          가짜 조작자가 출처가 맞지 않는 로그인 상태(다른 계정·다른 aal·다른 발급자)를 준다 → 넣지 않아야 한다
//   --selftest bad-control-pass     예행의 대조용 요청을 자격·본문이 실린 POST 로 보낸다 → 예외로 내보내지 않아야 한다(수신 0, 종료 코드 4)
//   --selftest leaky-business       차단기가 업무 요청을 "보냄"으로 가르게 한다 → 전송 지점이 따로 막아야 한다(가짜 서버가 받은 업무 요청 0, 전체 판정은 통과 아님, 종료 코드 1)
//   --selftest login-email-fixtures 가짜 자료와 이름표의 "사람의 이메일"을 로그인 이메일로 만든다(3차 보완 전의 결함) → 본인 것이어야 하는 화면이 남의 것으로 처리돼
//                                   C2·C6·C7·C13·C15 가 "기대와 다름"이어야 한다(시험 프로젝트 상대의 1차 실제 실행에서 난 것과 같은 다섯)
const SELFTEST = arg('--selftest', null);
if (SELFTEST && !FAKE) stop('--selftest 는 --fake 에서만 쓴다');
if (SELFTEST && !['leaky-blocker', 'silent-operator', 'bad-session', 'bad-control-pass', 'leaky-business', 'login-email-fixtures'].includes(SELFTEST)) stop('--selftest 의 값이 맞지 않음');
const OUT = path.resolve(arg('--out', path.join(ROOT, 'tests', 'auth-session', '.run', `screen-${FAKE ? 'fake' : 'real'}.json`)));

// ---------------------------------------------------------------------------
// 환경
// ---------------------------------------------------------------------------
const ACCOUNT_KEYS = ['A', 'B', 'BLK', 'WD', 'N', 'G', 'GM'];
const FAKE_ACCOUNTS = {
    A: { member: 'ok', name: '합성 회원 A' }, B: { member: 'ok', name: '합성 회원 B' }, BLK: { member: 'blocked' }, WD: { member: 'withdrawal' },
    N: { member: 'none' }, G: { member: 'none', admin: true }, GM: { member: 'ok', admin: true, name: '합성 관리자 GM' },
};
let ANON;
let CONTROL_SECRET;
let vault;                 // 비밀번호·이메일의 보관함: 예행(P)이 통과하기 전에는 꺼낼 수 없다
const SCAN = [];           // 끝에서 결과에 흔적이 없는지 찾아볼 값들(찾는 데만 쓴다)
{
    let PW;
    const EMAIL = {};
if (FAKE) {
    ANON = fakeJwt({ role: 'anon', ref: TEST_REF, fake: true });      // 가짜 공개 키(서명 자리는 고정 글자)
    PW = 'zz-' + crypto.randomBytes(9).toString('hex');
    for (const k of ACCOUNT_KEYS) EMAIL[k] = `zzb3a_${k.toLowerCase()}@member.zz.invalid`;
    CONTROL_SECRET = crypto.randomBytes(24).toString('hex');
} else {
    if (process.env.B3A_TEST_URL !== TEST_URL) stop(`B3A_TEST_URL 이 시험 프로젝트의 주소(${TEST_URL})와 정확히 같지 않음`);
    ANON = process.env.B3A_TEST_ANON_KEY || '';
    let claims = null;
    try { claims = JSON.parse(Buffer.from(ANON.split('.')[1], 'base64url').toString('utf8')); } catch (e) { claims = null; }
    if (!claims || claims.ref !== TEST_REF || claims.role !== 'anon') stop('B3A_TEST_ANON_KEY 가 시험 프로젝트의 anon 키가 아님');
    PW = process.env.B3A_PW || '';
    if (PW.length < 8) stop('B3A_PW 가 없거나 너무 짧음');
    for (const k of ACCOUNT_KEYS) { EMAIL[k] = process.env['B3A_EMAIL_' + k] || ''; if (!/^[^@\s]+@[^@\s]+$/.test(EMAIL[k])) stop('B3A_EMAIL_' + k + ' 가 없음'); }
    CONTROL_SECRET = process.env.B3A_CONTROL_SECRET || '';
    if (CONTROL_SECRET.length < 16) stop('B3A_CONTROL_SECRET 이 없거나 16자보다 짧음(실행마다 새로 만든 값)');
}
    const values = { PW };
    for (const k of ACCOUNT_KEYS) values['EMAIL_' + k] = EMAIL[k];
    vault = makeVault(values);
    SCAN.push(PW, ANON, CONTROL_SECRET, ...Object.values(EMAIL));
}
const fakeEmail = (k) => `zzb3a_${String(k).toLowerCase()}@member.zz.invalid`;      // --fake 의 합성 로그인 이메일(비밀이 아니다)
// --fake 의 합성 회원 이메일(회원 표의 이메일 — my_profile 이 주는 값). 실제 시험 자료처럼 로그인 이메일과 **다르다**
const fakeMemberEmail = (k) => `zzb3c1_${String(k).toLowerCase()}@members-table.zz.invalid`;

// (계약 3C-1) 업무 요청은 --fake 든 --real 이든 **하나도 내보내지 않는다**. 시험 프로젝트(또는 가짜 서버)로 나가는 것은
// 3A 에서 승인된 인증 요청 다섯뿐이다. 막은 업무 요청에는 실행기가 가짜 응답을 준다 — 그 자료는 이번 실행의 합성 계정 값으로 만든다.
// (가짜 응답으로 그려진 화면은 실제 업무 성공이 아니다. 판정은 "시도"로 한다.)
// **사람의 값(가짜 응답·이름표·판정의 기대)은 my_profile 의 응답에서 본 회원 표의 값만 쓴다** — business-fake.mjs 한 곳.
// 로그인 이메일(환경 변수의 값)은 로그인 화면에 적는 값이고 JWT 에 든 값일 뿐, 화면에 보일 값도 업무 조건의 값도 아니다
// (시험 자료의 합성 회원은 로그인 이메일과 회원 이메일이 일부러 다르다).
const people = makePeople({
    loginEmails: () => (vault && vault.armed() ? Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, vault.get('EMAIL_' + k)])) : {}),
    fixturesFromLoginEmail: SELFTEST === 'login-email-fixtures',       // 대조 실험: 3차 보완 전의 결함을 다시 만든다
});
// 이름표의 대조(경우 CL)가 이번 실행에서 보인 것: 로그인 이메일이 조건인 시도에 'login-email' 이름표가 붙는가.
// 보이지 못했으면 "로그인 이메일을 조건에 쓴 시도 0"은 통과가 아니라 미확인이다
const labelControl = { loginEmail: null };
// 전송 지점이 따로 보는 목록(차단기의 결정과 독립): 이 다섯이 아니면 전송 지점에서 내보내지 않는다
const AUTH_FIVE = {
    'POST /auth/v1/token?grant_type=password': 'login',
    'POST /auth/v1/token?grant_type=refresh_token': 'refresh',
    'POST /auth/v1/logout?scope=local': 'logout',
    'POST /rest/v1/rpc/my_profile': 'my_profile',
    'POST /rest/v1/rpc/my_site_access': 'my_site_access',
};
const wire = { sent: { login: 0, refresh: 0, logout: 0, my_profile: 0, my_site_access: 0 }, refusedAtSendPoint: 0 };

const pwPath = process.env.B3A_PLAYWRIGHT;
const chromePath = process.env.B3A_CHROMIUM;
if (!pwPath || !fs.existsSync(pwPath)) stop('B3A_PLAYWRIGHT(playwright-core 폴더)가 없음 — 이 실행기는 설치·내려받기를 하지 않는다');
if (!chromePath || !fs.existsSync(chromePath)) stop('B3A_CHROMIUM(chrome.exe)이 없음 — 이 실행기는 설치·내려받기를 하지 않는다');
let chromium;
try { chromium = createRequire(import.meta.url)(pwPath).chromium; } catch (e) { chromium = null; }
if (!chromium || typeof chromium.launch !== 'function') stop('playwright-core 를 쓸 수 없음 — 같은 보호를 입증하지 못한 다른 방식으로 넘어가지 않고 종료한다');

// ---------------------------------------------------------------------------
// 실행기가 여는 연결도 막고 센다: 127.0.0.1 과(--real 일 때만) 시험 프로젝트
// ---------------------------------------------------------------------------
const egress = { local: 0, testProject: 0, blocked: 0 };
{
    const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);
    const testHost = new URL(TEST_URL).hostname;
    const classify = (host) => (LOCAL.has(host) ? 'local' : (REAL && host === testHost ? 'testProject' : 'blocked'));
    const origConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
        let host = 'localhost';
        let pipe = false;
        const first = Array.isArray(args[0]) ? args[0][0] : args[0];
        if (first && typeof first === 'object') { if (first.path) pipe = true; host = first.host || first.hostname || 'localhost'; }
        else if (typeof first === 'string') pipe = true;
        else if (typeof args[1] === 'string') host = args[1];
        const kind = pipe ? 'local' : classify(String(host));
        egress[kind]++;
        if (kind === 'blocked') { process.nextTick(() => this.destroy(new Error('b3a: 허용 밖 연결을 막음'))); return this; }
        return origConnect.apply(this, args);
    };
    const origLookup = dns.lookup;
    dns.lookup = function (hostname, ...rest) {
        if (classify(String(hostname)) === 'blocked') {
            egress.blocked++;
            const cb = rest[rest.length - 1];
            if (typeof cb === 'function') process.nextTick(() => cb(Object.assign(new Error('b3a: 허용 밖 이름 풀이를 막음'), { code: 'ENOTFOUND' })));
            return {};
        }
        return origLookup.call(this, hostname, ...rest);
    };
}

// ---------------------------------------------------------------------------
// 로컬 서버 둘(켜짐·꺼짐)과 제어 포트 — 전부 127.0.0.1
// ---------------------------------------------------------------------------
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
let ignoreText = '';
try { ignoreText = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8'); } catch (e) { ignoreText = ''; }
const ignored = makeIgnore(ignoreText);
const files = tracked.filter((f) => !ignored(f) && !f.startsWith('.'));
const prod = readProdConfig(fs.readFileSync(path.join(ROOT, CONFIG_FILE), 'utf8'));
const readFile = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel)); } catch (e) { return null; } };

async function startSite(mode) {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const core = createCore({ files, readFile, mode, testKey: ANON, port, prod, log: null });
    server.on('request', (req, res) => {
        const chunks = [];
        req.on('data', (c) => { if (chunks.length < 64) chunks.push(c); });
        req.on('end', () => {
            let out;
            try { out = core.respond({ method: req.method, url: req.url, body: Buffer.concat(chunks) }); } catch (e) { out = { status: 500, headers: {}, body: Buffer.alloc(0) }; }
            res.writeHead(out.status, out.headers);
            res.end(out.body);
        });
    });
    return { server, core, origin: `http://127.0.0.1:${port}` };
}

// 제어 포트: 브레인방이 사이에 끼어야 하는 단계에서 멈춰 기다린다.
// 127.0.0.1 이라는 것은 권한 확인이 아니다 — 실행마다의 비밀과 그 멈춤의 일회용 단계 번호가 둘 다 맞는 명령만 받는다.
const control = { server: null, port: 0, arrivals: 0, rejected: 0 };
const board = new PauseBoard({
    timeoutMs: PAUSE_TIMEOUT,
    randomStep: () => crypto.randomInt(100000, 999999999),
    onOpen: (w) => console.log(`  [멈춤] ${w.kind}${w.needsRevert ? ' (DB 변경이 남는다 — 원복 대상으로 표시함)' : ''} — 제어 포트 ${control.port} 에서 기다림(단계 번호는 GET /wait 로)`),
});
function secretOk(value) {
    const a = Buffer.from(String(value || ''));
    const b = Buffer.from(CONTROL_SECRET);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function startControl() {
    control.server = http.createServer((req, res) => {
        control.arrivals++;
        const chunks = [];
        let size = 0;
        req.on('data', (c) => { size += c.length; if (size <= 262144) chunks.push(c); });
        req.on('end', () => {
            const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
            if (!secretOk(req.headers['x-b3a-secret'])) { control.rejected++; return reply(403, { error: 'forbidden' }); }
            const u = new URL(req.url, 'http://127.0.0.1');
            if (req.method === 'GET' && u.pathname === '/wait') {
                return reply(200, { waiting: board.view(), pendingRevert: board.pendingRevert });
            }
            if (req.method === 'POST' && u.pathname === '/continue') {
                let body = null;
                if (size > 262144) return reply(413, { error: 'too-large' });
                try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch (e) { return reply(400, { error: 'bad-json' }); }
                if (!board.answer(u.searchParams.get('step'), body)) { control.rejected++; return reply(409, { error: 'no-such-step' }); }
                return reply(200, { ok: true, pendingRevert: board.pendingRevert });
            }
            control.rejected++;
            return reply(404, { error: 'not-found' });
        });
    });
    const wanted = Number(process.env.B3A_CONTROL_PORT || 0);
    await new Promise((resolve) => control.server.listen(wanted, '127.0.0.1', resolve));
    control.port = control.server.address().port;
}

// 멈춤(장부는 screen-core.mjs): kind 는 정해 둔 이름, info 는 비밀이 아닌 식별값(로그인 기록 번호·계정 이름표).
//   needsRevert 인 멈춤은 내놓는 순간 원복 대상으로 표시된다. revertOf 인 멈춤은 본문 { "reverted": true } 를 받아야 그 표시를 지운다.
const pause = (kind, info, opts) => board.open(kind, info, opts);

// ---------------------------------------------------------------------------
// --fake: 가짜 서버와, 브레인방 구실을 하는 가짜 조작자(제어 포트로 답한다)
// ---------------------------------------------------------------------------
let fake = null;
const fakeNotes = { otherSession: null };
function setupFake() {
    fake = new FakeSupabase({ origin: TEST_URL, anonKey: ANON, now: () => Date.now() });
    for (const k of ACCOUNT_KEYS) {
        const a = FAKE_ACCOUNTS[k];
        fake.addAccount({
            email: fakeEmail(k), password: SCAN[0], authId: 'auth-' + k, member: a.member, admin: !!a.admin,
            profile: a.member === 'ok' ? { id: 'm-' + k, name: a.name, nickname: null, email: fakeMemberEmail(k), phone: '010-0000-0000', timezone: 'Asia/Seoul' } : undefined,
        });
    }
    // 가짜 서버까지 오는 것은 인증 요청 다섯뿐이다(업무 요청은 실행기가 전송 지점 앞에서 막는다). 왔다면 세어 둔다
    fake.businessArrivals = 0;
    fake.business = () => { fake.businessArrivals++; return { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' }; };
}
function controlCall(method, pathAndQuery, body) {
    return new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: control.port, method, path: pathAndQuery, headers: { 'x-b3a-secret': CONTROL_SECRET, 'Content-Type': 'application/json' } }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}
async function fakeOperator() {
    for (;;) {
        await sleep(150);
        if (!control.server) return;
        const r = await controlCall('GET', '/wait');
        const w = r && r.waiting;
        if (!w) continue;
        if (SELFTEST === 'silent-operator' && (w.kind === 'expire-session' || w.kind === 'revert-confirm')) continue;      // 대조 실험: 답하지 않는다
        let body = null;
        const bySid = (sid) => fake.sessions.get(sid);
        if (w.kind === 'other-session-create') fakeNotes.otherSession = fake.createSession(fakeEmail(w.info.account));
        else if (w.kind === 'check-logout-scope') {
            const ended = bySid(w.info.ended);
            body = { result: ended && !ended.alive && fakeNotes.otherSession && fakeNotes.otherSession.alive ? 'ok' : 'differs' };
        } else if (w.kind === 'check-records-intact') {
            body = { result: (w.info.sids || []).every((sid) => bySid(sid) && bySid(sid).alive) ? 'ok' : 'differs' };
        } else if (w.kind === 'expire-session') fake.endSession(bySid(w.info.sid), 'session_expired');
        else if (w.kind === 'restore-session') { const s = bySid(w.info.sid); if (s) { s.alive = true; s.endCode = null; } body = { reverted: true }; }
        else if (w.kind === 'maintenance-on') { fake.maintenance = true; fake.maintenanceExcept = new Set(['auth-A']); }
        else if (w.kind === 'maintenance-off') { fake.maintenance = false; fake.maintenanceExcept = new Set(); body = { reverted: true }; }
        else if (w.kind === 'revert-confirm') {
            fake.maintenance = false;
            for (const s of fake.sessions.values()) if (s.endCode === 'session_expired') { s.alive = true; s.endCode = null; }
            body = { reverted: true };
        } else if (w.kind === 'provide-session') {
            body = { session: fake.tokenBody(fake.createSession(fakeEmail(w.info.account), { aal: w.info.aal })) };
            if (SELFTEST === 'bad-session') {
                // 대조 실험: 경우마다 다른 방식으로 출처가 맞지 않는 로그인 상태를 준다
                const n = (fakeNotes.bad = (fakeNotes.bad || 0) + 1);
                if (n % 3 === 1) body = { session: fake.tokenBody(fake.createSession(fakeEmail('A'), { aal: w.info.aal })) };                       // 다른 계정
                else if (n % 3 === 2) body = { session: fake.tokenBody(fake.createSession(fakeEmail(w.info.account), { aal: w.info.aal === 'aal2' ? 'aal1' : 'aal2' })) };   // 다른 aal
                else {                                                                                                                         // 다른 발급자
                    const c = JSON.parse(Buffer.from(body.session.access_token.split('.')[1], 'base64url').toString('utf8'));
                    body.session.access_token = fakeJwt(Object.assign(c, { iss: 'https://other-project.invalid/auth/v1' }));
                }
            }
        }
        await controlCall('POST', '/continue?step=' + w.step, body === null ? undefined : body);
    }
}

// ---------------------------------------------------------------------------
// 브라우저 안에 넣는 관찰 장치(화면이 뜨기 전에): 표시의 시각, 저장소 접근 횟수(키의 무리 이름만), 되살아난 화면
// ---------------------------------------------------------------------------
const INIT_SCRIPT = `(() => {
  if (window.__b3a) return;
  const b = window.__b3a = { last: { name: -1, adminLink: -1, adminBtn: -1, studentBtn: -1, materials: -1 }, persistedAt: -1, shows: 0 };
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  b.sample = () => {
    const out = { name: false, adminLink: false, adminBtn: false, studentBtn: false, materials: false };
    try {
      const menu = document.getElementById('authMenu');
      out.name = !!(menu && menu.querySelector('a[href="my-dashboard.html"], a[href="admin-dashboard.html"]'));
      out.adminLink = !!(menu && menu.querySelector('a[href="admin-dashboard.html"]'));
      out.adminBtn = shown(document.getElementById('adminDashboardBtn'));
      out.studentBtn = shown(document.getElementById('studentDashboardBtn'));
      out.materials = [...document.querySelectorAll('a[href="materials.html"], a[href="materials.html?id"]')].some(shown);
    } catch (e) {}
    const now = performance.now();
    for (const k of Object.keys(out)) if (out[k]) b.last[k] = now;
    return out;
  };
  const tickFrame = () => { b.sample(); requestAnimationFrame(tickFrame); };
  requestAnimationFrame(tickFrame);
  setInterval(b.sample, 100);
  const watch = () => { try { new MutationObserver(b.sample).observe(document.documentElement, { subtree: true, childList: true, attributes: true }); } catch (e) {} b.sample(); };
  if (document.documentElement) watch(); else document.addEventListener('readystatechange', watch, { once: true });
  window.addEventListener('pageshow', (ev) => { b.shows++; if (ev.persisted) { b.persistedAt = performance.now(); } try { window.__b3aEvent(ev.persisted ? 'pageshow-persisted' : 'pageshow-normal'); } catch (e) {} }, true);
  // 저장소 접근 횟수: 키는 정해 둔 무리 이름으로만 센다(값은 보지 않는다)
  const bucket = (k) => { k = String(k);
    if (k === 'iontoefl_user' || k === 'iontoefl_login_time' || k === 'eon_book_auth_v1' || k === 'eon_auth_v1' || k === 'eon_auth_v1:compat') return k;
    if (/^sb-.*-auth-token$/.test(k)) return 'followup';
    if (k.indexOf('eon_auth_v1') === 0) return 'eon_auth_other';
    return 'other'; };
  const P = Storage.prototype;
  b.rawGet = P.getItem;
  for (const op of ['getItem', 'setItem', 'removeItem']) {
    const orig = P[op];
    P[op] = function (k) { if (this === window.localStorage) { try { window.__b3aCount(bucket(k), op); } catch (e) {} } return orig.apply(this, arguments); };
  }
  const origClear = P.clear;
  P.clear = function () { if (this === window.localStorage) { try { window.__b3aCount('all', 'clear'); } catch (e) {} } return origClear.apply(this, arguments); };
})();`;

const MESSAGES = {
    success: '로그인 성공! 환영합니다.',
    wrong: '이메일 또는 비밀번호가 일치하지 않습니다.',
    blocked: '🚫 차단된 계정입니다.\n\n관리자에게 문의해주세요.',
    withdrawal: '탈퇴 처리 중인 계정입니다.',
    maintenance: '지금은 점검 중입니다. 잠시 뒤 다시 시도해주세요.',
    legacy: '기존 방식의 로그인 상태가 있습니다. 기존 방식에서 로그아웃한 뒤 다시 로그인해 주세요.',
    error: '로그인 중 오류가 발생했습니다. 다시 시도해주세요.',
    rate: '요청이 많습니다. 잠시 뒤 다시 시도해주세요.',
    previous: '이전 로그인을 끝내지 못했습니다. 잠시 뒤 다시 시도해주세요.',
    moved: '로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.',
    logoutConfirm: '로그아웃 하시겠습니까?',
    logoutDone: '로그아웃되었습니다.',
    logoutUnknown: '로그아웃을 확인하지 못했습니다. 잠시 뒤 다시 시도해주세요.',
};
const messageId = (text) => { for (const [id, t] of Object.entries(MESSAGES)) if (t === text) return id; return 'other'; };
const STATES = ['off', 'signed_out', 'restoring', 'signed_in', 'rejected'];
const REASONS = [null, 'blocked', 'withdrawal_pending', 'no_member', 'not_allowed', 'maintenance', 'network', 'rate_limited', 'expired', 'ended', 'logout_unknown', 'unreadable',
    'session_changed', 'legacy_present', 'unexpected', 'token_shape', 'unavailable', 'storage', 'error'];
const PROFILE_KEYS = ['id', 'name', 'nickname', 'email', 'phone', 'timezone'];
// 서버의 오류 코드는 이 목록의 이름으로만 적는다(그 밖은 other) — 끝난 기록의 갱신에 실제 서버가 무엇을 주는지 보려고
const KNOWN_CODES = ['session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used', 'invalid_credentials',
    'over_request_rate_limit', 'bad_jwt', 'no_authorization', 'validation_failed', 'user_banned', 'PGRST301', 'PGRST303', 'PGRST202', 'PT503', 'PT405', '42501'];
const KEY_BUCKETS = ['iontoefl_user', 'iontoefl_login_time', 'eon_book_auth_v1', 'eon_auth_v1', 'eon_auth_v1:compat', 'followup', 'eon_auth_other', 'other'];
const bucketOf = (k) => (KEY_BUCKETS.includes(k) ? k : (/^sb-.*-auth-token$/.test(k) ? 'followup' : (k.startsWith('eon_auth_v1') ? 'eon_auth_other' : 'other')));

// ---------------------------------------------------------------------------
// 브라우저와 경우 하나의 환경
// ---------------------------------------------------------------------------
let browser = null;
let ON = '';
let OFF = '';
let siteOn = null;
let siteOff = null;
let decide = null;
const STATIC_BODY = { stylesheet: 'text/css', font: 'font/woff2', image: 'image/png' };

async function newCx(id) {
    const context = await browser.newContext({ serviceWorkers: 'block' });      // 디스크에 남지 않는 새 상태
    const cx = { id, context, records: [], hooks: {}, dialogs: [], store: {}, events: [], seen: { profileKeysOk: null, sids: {}, names: {}, lastLoginSid: null, states: [] }, account: null };
    await context.exposeBinding('__b3aCount', (src, bucket, op) => {
        if (!KEY_BUCKETS.includes(bucket) && bucket !== 'all') return;
        if (!['getItem', 'setItem', 'removeItem', 'clear'].includes(op)) return;
        cx.store[bucket] = cx.store[bucket] || { getItem: 0, setItem: 0, removeItem: 0, clear: 0 };
        cx.store[bucket][op]++;
    });
    await context.exposeBinding('__b3aEvent', (src, name) => { if (name === 'pageshow-persisted' || name === 'pageshow-normal') cx.events.push(name); });
    await context.addInitScript(INIT_SCRIPT);
    // 차단기: context 단위로, 첫 화면을 열기 전에. 붙이지 못하면(예외) 이 경우는 아무 화면도 열지 않는다.
    await context.route('**/*', (route) => handleRoute(route, cx).catch(() => route.abort('blockedbyclient').catch(() => {})));
    context.on('page', (page) => page.on('dialog', (d) => { cx.dialogs.push(messageId(d.message())); d.accept().catch(() => {}); }));
    cx.page = () => context.newPage();
    return cx;
}

// 응답에서 정해 둔 것만 본다(본문을 기록하지 않는다)
function observe(cx, rec, out) {
    let body = null;
    try { body = JSON.parse(Buffer.isBuffer(out.body) ? out.body.toString('utf8') : String(out.body || '')); } catch (e) { body = null; }
    rec.status = [200, 204, 400, 401, 403, 404, 405, 409, 429, 500, 503].includes(out.status) ? out.status : (out.status >= 500 ? 500 : (out.status >= 400 ? 400 : 200));
    if (!body || typeof body !== 'object') return;
    if (out.status >= 400) {
        const code = typeof body.code === 'string' ? body.code : (typeof body.error_code === 'string' ? body.error_code : null);
        rec.code = code === null ? 'none' : (KNOWN_CODES.includes(code) ? code : 'other');
    }
    if ((rec.target === 'login' || rec.target === 'refresh') && out.status === 200 && typeof body.access_token === 'string') {
        try {
            const c = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString('utf8'));
            if (typeof c.session_id === 'string') { cx.seen.lastLoginSid = c.session_id; cx.seen.sids[cx.account || '?'] = c.session_id; rec.hasSessionId = true; } else rec.hasSessionId = false;
        } catch (e) { rec.hasSessionId = false; }
    }
    if (rec.target === 'my_profile' && out.status === 200) {
        const state = ['ok', 'no_member', 'blocked', 'withdrawal_pending'].includes(body.state) ? body.state : 'other';
        rec.profileState = state;
        cx.seen.states.push(state);
        const keys = Object.keys(body).concat(body.profile && typeof body.profile === 'object' ? Object.keys(body.profile) : []);
        const ok = Object.keys(body).every((k) => k === 'state' || k === 'profile') &&
            (state !== 'ok' ? Object.keys(body).length === 1 : Object.keys(body.profile || {}).every((k) => PROFILE_KEYS.includes(k))) &&
            !keys.some((k) => /pass|pw|secret|hash/i.test(k));
        cx.seen.profileKeysOk = cx.seen.profileKeysOk === false ? false : ok;
        if (state === 'ok' && body.profile && typeof body.profile.name === 'string') cx.seen.names[cx.account || '?'] = body.profile.name;
        // 가짜 응답·이름표·판정의 기대에 쓴다(결과에는 적지 않는다). 누구의 응답인가는 그 요청의 JWT 로 가린다
        // (지금 치고 있는 계정 cx.account 로 가리면, 다른 계정이 저장된 채 열린 화면의 응답이 잘못 붙는다)
        if (state === 'ok' && body.profile && out.jwtAccount) people.note(out.jwtAccount, body.profile);
    }
    if (rec.target === 'my_site_access' && out.status === 200) { rec.allowed = body.allowed === true; rec.isAdmin = body.is_admin === true; }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
async function handleRoute(route, cx) {
    const r = route.request();
    let headers;
    try { headers = await r.allHeaders(); } catch (e) { headers = r.headers(); }
    const d = decide({ url: r.url(), method: r.method(), headers, postData: r.postData(), resourceType: r.resourceType(), isNavigation: r.isNavigationRequest() });
    const rec = d.record;
    rec.sent = false;
    cx.records.push(rec);
    if (SELFTEST === 'leaky-business' && d.action === 'fake') {
        // 대조 실험(--fake 에서만): 차단기가 고장 나 업무 요청을 "보냄"으로 가른다 → 아래의 전송 지점이 따로 막아야 한다
        d.action = 'continue';
        rec.aborted = false;
        rec.selftestLeak = true;
    }
    if (cx.sinkPass && rec.where === 'sink' && r.url() === cx.sinkPass) {
        // 예행(P)의 대조: 차단하지 않은 정상 요청 1건을 같은 수신기(시험 목적지)가 실제로 받는지 본다 — 이 한 건만 일부러 보낸다.
        // 자격 위반 판정(위의 decide)이 먼저다: 예외로 나갈 수 있는 것은 자격 없는·본문 없는 GET 한 번뿐.
        // 그 조건을 벗어난 요청이 이 주소로 오면 예외를 거두고 아래의 보통 길로 중단한다(P 는 통과가 아니다).
        cx.sinkPass = null;
        if (controlPassOk(rec, { method: r.method(), postData: r.postData() })) {
            rec.aborted = false;
            rec.how = 'control-pass';
            const resp = await route.fetch({ maxRedirects: 0 });
            rec.sent = true;
            return route.fulfill({ response: resp });
        }
        cx.sinkPassRefused = (cx.sinkPassRefused || 0) + 1;
    }
    if (SELFTEST === 'leaky-blocker' && rec.where === 'sink') {
        // 대조 실험(--fake 에서만): 차단기가 고장 나 시험 목적지로 가는 요청을 보내 준다
        rec.aborted = false;
        rec.how = 'selftest-leak';
        const resp = await route.fetch({ maxRedirects: 0 });
        rec.sent = true;
        return route.fulfill({ response: resp });
    }
    if (d.action === 'abort') return route.abort('blockedbyclient');
    if (d.action === 'fake') {
        // (계약 3C-1) 업무 요청: 전송 전에 막고 가짜 응답을 준다(화면의 동작을 보려는 것 — 업무 성공으로 세지 않는다)
        rec.how = 'business-blocked-fake-response';
        const hold = cx.hooks.business;
        if (hold && hold.before) await hold.before(rec);          // 시험이 이 가짜 응답을 붙잡아 둘 수 있다(늦게 도착하는 응답)
        if (cx.probing) rec.probe = true;                          // 시험이 일부러 시킨 대조용 시도(이름표의 대조) — 화면이 스스로 보낸 것이 아니다
        const rows = vault.armed() ? people.fake(r.method(), r.url()) : [];
        return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, CORS), body: JSON.stringify(rows) });
    }
    if (rec.where === 'self' && cx.dropAuthModule && rec.target === 'file' && new URL(r.url()).pathname === '/js/auth-session.js') {
        // (계약 3C-1) 경우 C11: 인증 모듈 파일을 받지 못한 켜진 화면
        rec.how = 'dropped-auth-module';
        rec.aborted = true;
        return route.abort('failed');
    }
    if (rec.where === 'local') return route.continue();                        // data:·blob:·about: — 네트워크로 나가지 않는다
    if (rec.where === 'static-allowed') {                                       // 허용 목록의 정적 자원: 보내지 않고 빈 응답(화면 시험에 필요 없다)
        rec.how = 'fulfilled-empty';
        return route.fulfill({ status: 200, contentType: STATIC_BODY[rec.type] || 'text/plain', body: '' });
    }
    if (rec.where === 'self') {
        const resp = await route.fetch({ maxRedirects: 0 });
        rec.sent = true;
        if (resp.status() >= 300 && resp.status() < 400) {
            // 리디렉션은 브라우저에 넘기지 않는다: 다음 주소를 차단기로 다시 가른다
            let next = '';
            try { next = new URL(resp.headers().location || '', r.url()).href; } catch (e) { next = ''; }
            const d2 = decide({ url: next, method: 'GET', headers: {}, postData: null, resourceType: r.resourceType(), isNavigation: r.isNavigationRequest() });
            d2.record.redirectHop = true;
            d2.record.sent = false;
            d2.record.aborted = true;           // 허용되는 다음 주소라도 이 실행기는 리디렉션을 따라가지 않는다(이 조각에 필요한 리디렉션이 없다)
            cx.records.push(d2.record);
            return route.abort('blockedbyclient');
        }
        return route.fulfill({ response: resp });
    }
    // 시험 프로젝트 — 전송 지점. 여기서 실제로(--fake 면 가짜 서버로) 나가는 것은 인증 요청 다섯뿐이다.
    // 차단기의 결정과 따로, 주소를 직접 다시 본다: 다섯이 아니면 차단기가 무엇이라 했든 내보내지 않는다(끌 수 없다).
    let wireName = null;
    try { const wu = new URL(r.url()); wireName = AUTH_FIVE[`${r.method()} ${wu.pathname}${wu.search}`] || null; } catch (e) { wireName = null; }
    if (!wireName) {
        wire.refusedAtSendPoint++;
        rec.how = 'refused-at-send-point';
        rec.aborted = true;
        rec.sent = false;
        return route.abort('blockedbyclient');
    }
    const hook = cx.hooks[rec.target];
    if (hook && hook.before) {
        const act = await hook.before(rec);
        if (act === 'abort') { rec.how = 'aborted-before-send'; return route.abort('failed'); }
        if (act && act.fulfill) { rec.how = 'fake-response'; rec.status = act.fulfill.status; return route.fulfill({ status: act.fulfill.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: act.fulfill.body }); }
    }
    let out;
    wire.sent[wireName]++;
    if (FAKE) {
        rec.how = 'fake-server';
        const res = await fake.handle({ url: r.url(), method: r.method(), headers: Object.entries(headers), bodyText: r.postData(), page: cx.id });
        out = { status: res.status, headers: Object.assign({}, res.headers, CORS), body: res.body === null || res.body === undefined ? '' : res.body };
    } else {
        const resp = await route.fetch({ maxRedirects: 0 });
        rec.sent = true;
        rec.how = 'sent';
        if (resp.status() >= 300 && resp.status() < 400) { rec.how = 'redirect-blocked'; return route.abort('blockedbyclient'); }
        out = { status: resp.status(), headers: resp.headers(), body: await resp.body() };
    }
    out.jwtAccount = rec.target === 'my_profile' ? people.accountOfJwt(headers.authorization || headers.Authorization) : null;
    observe(cx, rec, out);
    if (hook && hook.after) {
        const act = await hook.after(rec, out);
        if (act === 'drop') { rec.how = rec.how + '+response-dropped'; return route.abort('failed'); }
        if (act && act.replace) { rec.how = rec.how + '+response-replaced'; out = Object.assign({}, out, act.replace); }
    }
    return route.fulfill({ status: out.status, headers: out.headers, body: out.body });
}

// ---------------------------------------------------------------------------
// 화면을 다루는 작은 도구
// ---------------------------------------------------------------------------
async function until(page, expr, ms = 12000) {
    const end = Date.now() + ms;
    for (;;) {
        try { if (await page.evaluate(expr)) return true; } catch (e) { /* 이동 중 */ }
        if (Date.now() > end) return false;
        await sleep(120);
    }
}
const settled = (page, ms) => until(page, "!!window.EonAuth && window.EonAuth.state() !== 'restoring'", ms);
async function stateOf(page) {
    try {
        const [s, r] = await page.evaluate(() => [window.EonAuth.state(), window.EonAuth.reason()]);
        return { state: STATES.includes(s) ? s : 'other', reason: REASONS.includes(r) ? r : 'other' };
    } catch (e) { return { state: 'other', reason: 'other' }; }
}
const marks = (page) => page.evaluate(() => ({ cur: window.__b3a.sample(), last: window.__b3a.last, now: performance.now(), persistedAt: window.__b3a.persistedAt })).catch(() => null);
const anyNow = (m) => !!m && Object.values(m.cur).some(Boolean);
const anySince = (m, since) => !!m && (Object.values(m.cur).some(Boolean) || Object.values(m.last).some((t) => t >= since));
const keyBuckets = async (page) => [...new Set((await page.evaluate(() => Object.keys(window.localStorage)).catch(() => [])).map(bucketOf))].sort();
const pathOf = (page) => { try { return new URL(page.url()).pathname; } catch (e) { return ''; } };
const nameShown = (page, expected) => page.evaluate((n) => { const m = document.getElementById('authMenu'); return !!m && typeof n === 'string' && n.length > 0 && m.textContent.includes(n); }, expected).catch(() => false);
const count = (cx, target, pred) => cx.records.filter((r) => r.where === 'test-project' && r.target === target && !r.aborted && (!pred || pred(r))).length;
const alertId = (page) => page.evaluate((table) => {
    const el = document.querySelector('.alert');
    if (!el) return null;
    for (const [id, t] of Object.entries(table)) if (t === el.textContent) return id;
    return 'other';
}, MESSAGES).catch(() => null);

// 로그인 화면에서 제출. 돌려주는 값: { message(정해 둔 이름), moved(index.html 로 갔는가), path }
async function doLogin(cx, page, acct, { query = '?redirect=my-dashboard.html', wrongPassword = false, site = ON } = {}) {
    cx.account = acct;
    await page.goto(site + '/login.html' + query, { waitUntil: 'domcontentloaded' });
    await settled(page);
    await page.fill('#email', vault.get('EMAIL_' + acct));           // 예행(P)이 통과하기 전에는 여기서 예외가 난다
    await page.fill('#password', wrongPassword ? vault.get('PW') + 'x' : vault.get('PW'));
    await page.click('#loginBtn');
    await until(page, "!!document.querySelector('.alert') || !location.pathname.endsWith('/login.html')", 25000);
    const message = pathOf(page).endsWith('/login.html') ? await alertId(page) : 'success';
    let moved = false;
    if (message === 'success') moved = await until(page, "location.pathname.endsWith('/index.html')", 4000);
    else await sleep(1600);                                   // 실패 안내 뒤에도 이동하지 않는지 본다
    if (moved) { await settled(page); await sleep(500); }
    return { message, moved, path: pathOf(page) };
}

// 응답을 붙잡아 둔 동안 표시가 0 인지, 풀어 준 뒤에는 어떤지
async function heldLoad(cx, page, target, go, { sinceBfcache = false } = {}) {
    let reached;
    let release;
    const reachedP = new Promise((r) => { reached = r; });
    const releasedP = new Promise((r) => { release = r; });
    cx.hooks[target] = { after: async () => { reached(true); await releasedP; return null; } };
    const nav = go().catch(() => null);
    const got = await Promise.race([reachedP, sleep(15000).then(() => false)]);
    await sleep(1300);
    const during = await marks(page);
    const since = sinceBfcache && during ? during.persistedAt : 0;
    const shownDuring = got ? anySince(during, since) : null;
    const st = await stateOf(page);
    release();
    delete cx.hooks[target];
    await nav;
    await settled(page, 30000);
    await sleep(600);
    return { reached: !!got, shownDuring, stateDuring: st.state, after: await marks(page), stateAfter: await stateOf(page) };
}

// ---------------------------------------------------------------------------
// 경우들. 판정: ok 가 전부 참이면 통과 / 거짓이 있으면 기대와 다름 / null(재지 못함)이 있으면 미확인
// ---------------------------------------------------------------------------
const results = [];
function makeChecks() {
    const list = [];
    return { list, ck: (name, ok) => { list.push({ name, ok: ok === null || ok === undefined ? null : !!ok }); } };
}
const baseline = (cx, ck) => {
    const s = summarize(cx.records);
    ck('자격이 용도 밖으로 나간 것 0(차단기의 결정)', s.leakSent === 0);
    // 대조 단계(P)는 일부러 용도가 맞지 않는 요청을 시켜 본다. 그 밖의 경우에는 그런 시도 자체가 없어야 한다
    if (cx.id !== 'P') ck('자격의 용도가 맞지 않는 요청을 시도한 것 0', s.leakBlocked === 0);
    else ck('대조: 자격의 용도가 맞지 않는 요청을 전송 전에 막음', s.leakBlocked >= 1);
    // 대조 단계는 수신기가 살아 있음을 보이려고 정상 요청 1건을 일부러 시험 목적지로 보낸다
    ck('회원 자격이 필요한 주소에 공개 키로 나간 것 0', s.publicRetry === 0);
    ck(cx.id === 'P' ? '허용 밖으로 보낸 것은 대조용 1건뿐(차단기의 결정)' : '허용 밖으로 보낸 것 0(차단기의 결정)', s.outsideSent === (cx.id === 'P' ? 1 : 0));
    ck('service_role 자격 0', s.serviceRole === 0);
    // (계약 3C-1) 업무 요청: 내보낸 것 0(전부 전송 전에 막고 가짜 응답), 차단기를 지나 전송 지점까지 온 업무 요청 0
    ck('내보낸 업무 요청 0(차단기의 결정)', s.businessSent === 0);
    ck('차단기를 지나 전송 지점까지 온 업무 요청 0(전송 지점이 따로 본 것)', cx.records.filter((x) => x.how === 'refused-at-send-point' || x.selftestLeak).length === 0);
    // (3차) 화면은 확인된 회원의 이메일을 쓴다 — 로그인 이메일을 업무 조건에 쓰면 결함. 3C-1 의 경우(C…)의 판정에 넣는다
    // (3A 의 경우들의 판정 목록은 그대로 둔다 — 그 경우들에서 잡힌 것은 전체 판정과 결과의 loginEmailConditions 로 본다).
    // 양성 대조: 이번 실행의 CL 이 "로그인 이메일이 조건인 시도에 그 이름표가 붙는다"를 보였어야 한다. 아니면 미확인
    if (/^C/.test(cx.id) && cx.id !== 'CL') ck('화면이 로그인 이메일을 업무 조건에 쓴 시도 0(쓰면 결함 — 이름표의 대조는 CL)', s.businessByLoginEmail > 0 ? false : (labelControl.loginEmail === true ? true : null));
    return s;
};
async function execCase(id, title, fn, { required = true } = {}) {
    const entry = { id, title, required, verdict: 'unknown', checks: [], summary: null, storage: null, records: [] };
    results.push(entry);
    let cx = null;
    const t0 = Date.now();
    try {
        cx = await newCx(id);
        const { list, ck } = makeChecks();
        entry.checks = list;
        const sink0 = siteOn.core.counts.sink + siteOff.core.counts.sink;
        await fn(cx, ck);
        entry.summary = baseline(cx, ck);
        ck(id === 'P' ? '로컬 시험 목적지 수신은 대조용 1건뿐(차단기와 독립된 증거)' : '로컬 시험 목적지 수신 0(차단기와 독립된 증거)', siteOn.core.counts.sink + siteOff.core.counts.sink === sink0 + (id === 'P' ? 1 : 0));
    } catch (e) {
        if (e instanceof PauseTimeout) entry.checks.push({ name: '멈춤의 기다림이 상한을 넘김', ok: null });
        else entry.checks.push({ name: '실행 도중 예외(경우를 끝까지 돌리지 못함)', ok: null });
    } finally {
        if (cx) {
            entry.storage = cx.store;
            entry.records = cx.records;
            entry.pageshow = cx.events;
            entry.notes = cx.notes || null;
            // 바깥으로 가려던 시도(전송 전에 막힌 것)의 수 — 대조 단계(P) 말고는 0 이 기대다. 판정에는 넣지 않고 적어 둔다
            const s = summarize(cx.records);
            entry.outsideAttempts = s.outsideBlockedRequest + s.outsideBlockedNavigation;
            await cx.context.close().catch(() => {});
        }
        entry.verdict = entry.checks.some((c) => c.ok === false) ? 'differs' : (entry.checks.some((c) => c.ok === null) || entry.checks.length === 0 ? 'unknown' : 'pass');
        console.log(`  ${id.padEnd(4)} ${entry.verdict === 'pass' ? '통과' : (entry.verdict === 'differs' ? '기대와 다름' : '미확인')}  ${title}  (${Math.round((Date.now() - t0) / 100) / 10}초)`);
        for (const c of entry.checks.filter((x) => x.ok !== true)) console.log(`         · ${c.ok === false ? '다름' : '미확인'}: ${c.name}`);
        if (id !== 'P' && entry.outsideAttempts) console.log(`         · 참고: 바깥으로 가려던 시도 ${entry.outsideAttempts}건(전송 전에 막힘)`);
    }
}

const NEW_KEYS = ['eon_auth_v1', 'eon_auth_v1:compat', 'iontoefl_login_time', 'iontoefl_user'];
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// 경우들의 차례표를 만든다(여기서는 아무것도 돌리지 않는다 — 돌리는 차례는 runSequence 가 정한다: P 가 먼저, 전부 참이어야 다음)
async function buildCases() {
    const plan = [];
    const runCase = (id, title, fn, opts) => { plan.push({ id, run: () => execCase(id, title, fn, opts) }); };
    // ---- P. 로컬 대조: 차단이 실제로 듣는가(수신기가 살아 있음을 먼저 보인 뒤) ----
    await runCase('P', '차단기의 로컬 대조(첫 화면·새 창·리디렉션·폼·제어 포트)', async (cx, ck) => {
        const core = siteOn.core;
        const page = await cx.page();
        await page.goto(ON + '/__b3a/blank');
        // 같은 수신기(시험 목적지)로: 먼저 차단하지 않은 정상 요청 1건을 실제로 받는지, 그 뒤 차단 시험 동안 추가 수신이 0 인지
        const sinkBefore = core.counts.sink;
        cx.sinkPass = ON + '/__b3a/sink/alive';
        // 대조 실험(--fake 에서만): 대조용 요청을 자격·본문이 실린 POST 로 보낸다 → 예외로 나가면 안 된다
        const controlInit = SELFTEST === 'bad-control-pass' ? { method: 'POST', headers: { Authorization: 'Bearer zz-not-a-real-credential' }, body: 'x=1' } : null;
        await page.evaluate((init) => fetch('/__b3a/sink/alive', init || undefined).then((r) => r.status, () => 0), controlInit);
        ck('수신기가 살아 있음: 차단하지 않은 정상 요청 1건을 시험 목적지가 실제로 받음', core.counts.sink === sinkBefore + 1);
        ck('예행의 예외로 나간 것은 자격 없는·본문 없는 GET 한 번뿐(조건을 벗어난 요청 0, 예외는 거둬짐)', !cx.sinkPassRefused && cx.sinkPass === null && cx.records.filter((r) => r.how === 'control-pass').length === 1);
        const sink0 = core.counts.sink;
        const csp0 = core.counts.csp;
        const rejected0 = control.rejected;
        const blockedBefore = cx.records.filter((r) => r.aborted).length;
        const tryFetch = (url, init) => page.evaluate(([u, i]) => fetch(u, i).then(() => 'sent', () => 'blocked'), [url, init || {}]);
        let attempts = 0;
        ck('fetch → 시험 목적지: 막힘', (await tryFetch('/__b3a/sink/fetch')) === 'blocked'); attempts++;
        ck('fetch(POST) → 시험 목적지: 막힘', (await tryFetch('/__b3a/sink/post', { method: 'POST', body: 'x=1' })) === 'blocked'); attempts++;
        ck('fetch → 리디렉션 → 시험 목적지: 막힘', (await tryFetch('/__b3a/redirect/sink')) === 'blocked'); attempts++;
        ck('fetch → 제어 포트: 막힘', (await tryFetch(`http://127.0.0.1:${control.port}/wait`)) === 'blocked'); attempts++;
        ck('fetch → 바깥 주소: 막힘', (await tryFetch('https://example.invalid/x')) === 'blocked'); attempts++;
        ck('fetch → 시험 프로젝트에 회원 표 읽기(공개 키 없이 알 수 없는 자격): 막힘', (await tryFetch(TEST_URL + '/rest/v1/users', { headers: { Authorization: 'Bearer zz-not-a-real-credential' } })) === 'blocked'); attempts++;
        const navTry = async (how) => {                   // 화면 이동은 새 탭에서(중단된 이동은 그 탭을 오류 화면으로 만든다)
            const p = await cx.page();
            await p.goto(ON + '/__b3a/blank');
            await how(p).catch(() => {});
            await sleep(500);
            await p.close().catch(() => {});
        };
        await navTry((p) => p.evaluate(() => { location.href = '/__b3a/sink/nav'; })); attempts++;
        await navTry((p) => p.evaluate(() => { const f = document.createElement('form'); f.method = 'POST'; f.action = '/__b3a/sink/form'; document.body.appendChild(f); f.submit(); })); attempts++;
        await navTry((p) => p.goto(ON + '/__b3a/redirect/sink')); attempts++;
        await navTry((p) => p.evaluate(() => { window.open('/__b3a/sink/popup'); })); attempts++;
        await navTry((p) => p.evaluate(() => { location.href = 'https://example.invalid/nav'; })); attempts++;
        await navTry((p) => p.evaluate((port) => { location.href = 'http://127.0.0.1:' + port + '/wait'; }, control.port)); attempts++;
        await navTry((p) => p.evaluate((u) => { location.href = u + '/auth/v1/authorize?provider=x'; }, TEST_URL)); attempts++;
        {   // 첫 화면이 곧 시험 목적지인 새 브라우저 상태
            const cx2 = await newCx('P2');
            const p = await cx2.page();
            await p.goto(ON + '/__b3a/sink/first').catch(() => {});
            await sleep(300);
            cx.records.push(...cx2.records);
            await cx2.context.close();
            attempts++;
        }
        const blocked = cx.records.filter((r) => r.aborted).length - blockedBefore;
        // 화면 안의 fetch 중 일부(바깥 주소·제어 포트)는 내용 보안 정책이 차단기보다 먼저 막는다 — 따로 센다
        const cspBlocked = core.counts.csp - csp0;
        ck('시킨 시도가 전부 전송 전에 막힘(차단기가 센 수 + 내용 보안 정책이 먼저 막은 수 ≥ 시킨 수)', blocked + cspBlocked >= attempts);
        ck('차단기가 직접 막은 것: fetch·리디렉션·폼·화면 이동·새 창·첫 화면(11건 이상)', blocked >= 11);
        ck('차단 시험 동안 같은 수신기(시험 목적지)의 추가 수신 0', core.counts.sink === sink0);
        ck('비밀 보관함이 아직 닫혀 있음(예행 중에는 비밀번호를 꺼낼 수 없다)', vault.armed() === false);
        ck('제어 포트가 화면에서 받은 요청 0(비밀 없이 온 요청 0)', control.rejected === rejected0);
    });

    // ---- 1~8. 로그인 ----
    const loginOk = (acct, id) => runCase(id, `${acct} 로그인 → index.html 에 이름`, async (cx, ck) => {
        const page = await cx.page();
        const r = await doLogin(cx, page, acct);
        const st = await stateOf(page);
        ck('안내: 로그인 성공', r.message === 'success');
        ck('index.html 로만 이동(redirect 값으로 가지 않음)', r.moved && r.path.endsWith('/index.html'));
        ck('상태 signed_in', st.state === 'signed_in');
        ck('머리말에 그 계정의 이름', await nameShown(page, cx.seen.names[acct]));
        ck('두 확인 요청: login.html 에서 각 1회 + index.html 에서 각 1회', count(cx, 'my_profile') === 2 && count(cx, 'my_site_access') === 2);
        ck('로그인 요청 1회, 갱신·로그아웃 0', count(cx, 'login') === 1 && count(cx, 'refresh') === 0 && count(cx, 'logout') === 0);
        ck('회원 표를 읽는 요청 0(업무 요청은 공개 키)', cx.records.filter((x) => x.where === 'test-project' && x.target === 'rest-table' && x.credential !== 'anon').length === 0);
        ck('저장소의 키 이름: 새 모듈의 넷뿐', sameSet(await keyBuckets(page), NEW_KEYS));
        const compatKeys = await page.evaluate(() => { try { return Object.keys(JSON.parse(window.__b3a.rawGet.call(localStorage, 'iontoefl_user'))).sort().join(','); } catch (e) { return ''; } });
        ck('호환 값의 키: id·name·nickname·email·phone·role (password·level 없음)', compatKeys === 'email,id,name,nickname,phone,role');
        ck('my_profile 응답의 키: state + 여섯 열뿐(비밀번호 열 없음)', cx.seen.profileKeysOk);
        ck('JWT 에 로그인 기록 번호(session_id)가 있음', cx.records.some((x) => x.target === 'login' && x.hasSessionId === true));
        const m = await marks(page);
        ck('일반 회원에게 관리자 링크·버튼·학습 자료 링크 0', !!m && !m.cur.adminLink && !m.cur.adminBtn && !m.cur.materials);
    });
    await loginOk('A', '1');
    await loginOk('B', '2');

    const loginRefused = (id, title, acct, want, extra) => runCase(id, title, async (cx, ck) => {
        const page = await cx.page();
        const r = await doLogin(cx, page, acct, want.opts || {});
        const st = await stateOf(page);
        ck('안내 문구', r.message === want.message);
        ck('화면 이동 0', !r.moved && r.path.endsWith('/login.html'));
        ck('상태', st.state === want.state && (want.reason === undefined || st.reason === want.reason));
        ck('호환 값 없음', !(await keyBuckets(page)).some((k) => k === 'iontoefl_user' || k === 'iontoefl_login_time' || k === 'eon_auth_v1:compat'));
        ck('이름·관리자 표시 0', !anyNow(await marks(page)));
        if (extra) await extra(cx, ck, page);
    });
    await loginRefused('3', '틀린 비밀번호', 'A', { message: 'wrong', state: 'signed_out', opts: { wrongPassword: true } },
        (cx, ck) => ck('확인 요청 0', count(cx, 'my_profile') === 0 && count(cx, 'my_site_access') === 0));
    await loginRefused('4', '차단된 계정', 'BLK', { message: 'blocked', state: 'rejected', reason: 'blocked' });
    await loginRefused('5', '탈퇴 처리 중', 'WD', { message: 'withdrawal', state: 'rejected', reason: 'withdrawal_pending' },
        (cx, ck) => ck('회원 표를 고치는 요청 0', cx.records.filter((x) => x.target === 'rest-table' && x.method !== 'GET').length === 0));
    const noMember = async (cx, ck, page) => {
        ck('순서: 로그인 → my_profile → 갱신 1 → my_profile → 로그아웃(이 로그인만)', count(cx, 'my_profile') === 2 && count(cx, 'refresh') === 1 && count(cx, 'logout') === 1 && count(cx, 'my_site_access') === 0);
        ck('이 브라우저의 로그인도 지워짐', !(await keyBuckets(page)).includes('eon_auth_v1'));
    };
    await loginRefused('6', '회원 대응이 없는 계정', 'N', { message: 'wrong', state: 'signed_out', reason: 'no_member' }, noMember);
    await loginRefused('7', '회원 대응 없는 관리자(aal1)', 'G', { message: 'wrong', state: 'signed_out', reason: 'no_member' }, noMember);
    await runCase('8', '회원 대응 있는 관리자(aal1): 관리자 표시 없음', async (cx, ck) => {
        const page = await cx.page();
        const r = await doLogin(cx, page, 'GM');
        ck('로그인되고 index.html 로', r.message === 'success' && r.moved);
        const role = await page.evaluate(() => { try { return JSON.parse(window.__b3a.rawGet.call(localStorage, 'iontoefl_user')).role; } catch (e) { return ''; } });
        ck('role 은 user(6자리 확인 전)', role === 'user');
        const m = await marks(page);
        ck('관리자 링크·버튼·학습 자료 링크 0', !!m && !m.cur.adminLink && !m.cur.adminBtn && !m.cur.materials);
    });

    // ---- 9. 확인 전 표시 0: 깨끗한 첫 방문·새로 고침·뒤로 가기(다시 불러옴 / 보관된 화면) ----
    await runCase('9', '확인 전 표시 0(응답을 붙잡은 동안) — 회원 A', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        const expectName = cx.seen.names.A;
        const judge = async (label, h, since) => {
            ck(`${label}: 응답을 붙잡음`, h.reached ? true : null);
            ck(`${label}: 붙잡은 동안 이름·관리자 링크·버튼·학습 자료 링크 0`, h.reached ? h.shownDuring === false : null);
            ck(`${label}: 풀어 준 뒤 signed_in·이름`, h.stateAfter.state === 'signed_in' && !!h.after && h.after.cur.name && (await nameShown(page, expectName)));
            ck(`${label}: 일반 회원에게는 풀어 준 뒤에도 관리자 링크·버튼·학습 자료 링크 0`, !!h.after && !h.after.cur.adminLink && !h.after.cur.adminBtn && !h.after.cur.materials);
        };
        await judge('새로 고침', await heldLoad(cx, page, 'my_site_access', () => page.reload({ waitUntil: 'domcontentloaded' })));
        // 깨끗한 첫 방문(새 탭에서 index.html 을 처음 엶)
        const fresh = await cx.page();
        const h2 = await heldLoad(cx, fresh, 'my_site_access', () => fresh.goto(ON + '/index.html', { waitUntil: 'domcontentloaded' }));
        ck('첫 방문: 응답을 붙잡음', h2.reached ? true : null);
        ck('첫 방문: 붙잡은 동안 표시 0', h2.reached ? h2.shownDuring === false : null);
        ck('첫 방문: 풀어 준 뒤 이름', !!h2.after && h2.after.cur.name);
        await fresh.close();
        // 뒤로 가기(다시 불러오게 만든 경우): unload 처리기가 있으면 브라우저가 화면을 보관하지 않는다
        await page.evaluate(() => window.addEventListener('unload', () => {}));
        await page.goto(ON + '/__b3a/blank');
        cx.events.length = 0;
        await judge('뒤로 가기(다시 불러옴)', await heldLoad(cx, page, 'my_site_access', () => page.goBack({ waitUntil: 'domcontentloaded' })));
        ck('뒤로 가기(다시 불러옴): 보관된 화면이 아니었음', !cx.events.includes('pageshow-persisted'));
    });
    // 뒤로 가기(브라우저가 보관해 둔 화면을 되살린 경우). 브라우저가 되살리지 않으면 재지 못한다 → 미확인으로 남고, 필수 경우로 세지 않는다
    await runCase('9b', '확인 전 표시 0 — 뒤로 가기로 되살아난(보관된) 화면', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        await page.goto(ON + '/__b3a/blank');
        cx.events.length = 0;
        const h = await heldLoad(cx, page, 'my_site_access', () => page.goBack({ waitUntil: 'commit' }), { sinceBfcache: true });
        const persisted = cx.events.includes('pageshow-persisted');
        ck('브라우저가 화면을 되살림(아니면 다시 불러온 것 — 재지 못함)', persisted ? true : null);
        ck('되살아난 뒤 붙잡은 동안 표시 0', persisted && h.reached ? h.shownDuring === false : null);
        ck('풀어 준 뒤 이름', persisted ? (!!h.after && h.after.cur.name) : null);
    }, { required: false });

    // ---- 10·11. 로그아웃과 재로그인 ----
    await runCase('10', '로그아웃: 이 로그인만 + 재로그인', async (cx, ck) => {
        await pause('other-session-create', { account: 'A' }, { leaves: 'A' });
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        const sid = cx.seen.lastLoginSid;
        await page.locator('#authMenu a', { hasText: 'LOGOUT' }).click();
        await until(page, "window.EonAuth && window.EonAuth.state() === 'signed_out'", 15000);
        await sleep(800);
        ck('확인 창과 "로그아웃되었습니다" 안내', cx.dialogs.includes('logoutConfirm') && cx.dialogs.includes('logoutDone') && !cx.dialogs.includes('logoutUnknown'));
        ck('로그아웃 요청 1회(이 로그인만)', count(cx, 'logout') === 1);
        ck('새 모듈의 값이 저장소에 없음', !(await keyBuckets(page)).some((k) => NEW_KEYS.includes(k)));
        ck('머리말이 로그인 전 모양', !anyNow(await marks(page)));
        const db = await pause('check-logout-scope', { account: 'A', ended: sid });
        ck('DB: 그 로그인 기록만 끝나고 다른 기록은 그대로(브레인방 확인)', db && db.result === 'ok' ? true : (db && db.result === 'differs' ? false : null));
        const again = await doLogin(cx, page, 'A');                          // 11. 재로그인
        ck('재로그인: 성공하고 index.html 에 이름', again.message === 'success' && again.moved && (await nameShown(page, cx.seen.names.A)));
    });

    // ---- 12·13. 두 탭 ----
    await runCase('12', '두 탭: 갱신 뒤에도 상태 유지 → 한 탭 로그아웃', async (cx, ck) => {
        let clock = true;
        try { await cx.context.clock.install(); } catch (e) { clock = false; }
        const p1 = await cx.page();
        await doLogin(cx, p1, 'A');
        const p2 = await cx.page();
        await p2.goto(ON + '/index.html', { waitUntil: 'domcontentloaded' });
        await settled(p2);
        ck('두 탭 모두 signed_in', (await stateOf(p1)).state === 'signed_in' && (await stateOf(p2)).state === 'signed_in');
        if (clock) {
            // JWT 수명은 바꾸지 않는다 — 브라우저의 시계만 앞으로 돌려 갱신 시각을 지나게 한다
            try { await cx.context.clock.fastForward(3530 * 1000); } catch (e) { clock = false; }
            for (let i = 0; clock && i < 40 && count(cx, 'refresh') === 0; i++) { await sleep(250); try { await cx.context.clock.runFor(1000); } catch (e) { /* 계속 */ } }
        }
        const refreshed = count(cx, 'refresh') >= 1;
        ck('갱신이 일어남(브라우저의 시계를 앞으로)', clock ? (refreshed ? true : null) : null);
        await sleep(600);
        ck('갱신 뒤에도 두 탭 모두 signed_in·이름', refreshed ? ((await stateOf(p1)).state === 'signed_in' && (await stateOf(p2)).state === 'signed_in' && (await nameShown(p1, cx.seen.names.A)) && (await nameShown(p2, cx.seen.names.A))) : null);
        ck('로그인 요청은 1회뿐', count(cx, 'login') === 1);
        // 13. 한 탭만 로그아웃
        await p1.evaluate(() => window.EonAuth.signOut());
        await until(p1, "window.EonAuth.state() === 'signed_out'", 15000);
        for (let i = 0; i < 20; i++) { try { await cx.context.clock.runFor(500); } catch (e) { /* 시계 없음 */ } await sleep(150); if ((await stateOf(p2)).state !== 'signed_in') break; }
        const s2 = await stateOf(p2);
        ck('다른 탭: rejected·ended', s2.state === 'rejected' && s2.reason === 'ended');
        ck('다른 탭: 이름 없음, 호환 값 없음', !anyNow(await marks(p2)) && !(await keyBuckets(p2)).some((k) => NEW_KEYS.includes(k)));
        ck('로그아웃 요청 1회', count(cx, 'logout') === 1);
    });

    // ---- T. A → B 전환: 한 탭이 A 를 확인하는 사이 다른 탭이 B 로 로그인 ----
    await runCase('T', '두 탭: A 를 확인하는 사이 다른 탭이 B 로 로그인', async (cx, ck) => {
        const p0 = await cx.page();
        await doLogin(cx, p0, 'A');
        const sidA = cx.seen.sids.A;
        await p0.close();
        const p1 = await cx.page();
        let reached;
        let release;
        const reachedP = new Promise((r) => { reached = r; });
        const releasedP = new Promise((r) => { release = r; });
        let first = true;
        cx.hooks.my_site_access = { after: async () => { if (!first) return null; first = false; reached(true); await releasedP; return null; } };
        const nav = p1.goto(ON + '/index.html', { waitUntil: 'domcontentloaded' }).catch(() => null);
        const got = await Promise.race([reachedP, sleep(15000).then(() => false)]);
        ck('탭 1: A 의 확인 응답을 붙잡음', got ? true : null);
        const refresh0 = count(cx, 'refresh');
        const p2 = await cx.page();
        const r2 = await doLogin(cx, p2, 'B');
        const sidB = cx.seen.sids.B;
        ck('탭 2: B 로그인 성공', r2.message === 'success' && r2.moved);
        ck('B 로그인 전에 A 의 로그인을 끝내는 요청 1회', count(cx, 'logout') === 1);
        release();
        await nav;
        await settled(p1, 30000);
        await sleep(1500);
        const m1 = await marks(p1);
        ck('탭 1: A 의 이름이 그려진 적 없음', !(await nameShown(p1, cx.seen.names.A)));
        ck('탭 1: 끝난 뒤 B 를 별도로 확인해 B 의 이름', (await stateOf(p1)).state === 'signed_in' && (await nameShown(p1, cx.seen.names.B)));
        ck('A 의 실패 처리가 낸 갱신·종료 요청 0(B 를 건드리지 않음)', count(cx, 'refresh') === refresh0 && count(cx, 'logout') === 1);
        ck('탭 1: 화면 이동 0', pathOf(p1).endsWith('/index.html') && !!m1);
        const db = await pause('check-records-intact', { sids: [sidB].filter(Boolean), ended: sidA });
        ck('DB: B 의 로그인 기록이 그대로(브레인방 확인)', db && db.result === 'ok' ? true : (db && db.result === 'differs' ? false : null));
    });

    // ---- 14. 확정된 만료(실제 — 브레인방이 DB 에서 기록을 끝냄) ----
    await runCase('14', '끝난 로그인 기록(서버에서 끝냄) → 새로 고침', async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        const sid = cx.seen.lastLoginSid;
        await pause('expire-session', { sid }, { needsRevert: true });
        try {
            const before = cx.seen.states.length;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await settled(page, 40000);
            await sleep(600);
            const st = await stateOf(page);
            ck('my_profile 이 200 no_member', cx.seen.states.slice(before).includes('no_member'));
            ck('signed_in 이 아님', st.state === 'rejected' || st.state === 'signed_out');
            ck('갱신 1회, 공개 키 재시도 0', count(cx, 'refresh') === 1);
            ck('이름·관리자 표시 0', !anyNow(await marks(page)));
            ck('새 모듈이 만든 호환 값 없음', !(await keyBuckets(page)).some((k) => k === 'iontoefl_user' || k === 'iontoefl_login_time' || k === 'eon_auth_v1:compat'));
            const refused = cx.records.filter((x) => x.target === 'refresh' && x.status >= 400)[0];
            cx.notes = { refreshRefusalCode: refused ? refused.code : 'none', stateAfter: st.state, reasonAfter: st.reason };   // 끝난 기록의 갱신에 서버가 준 코드(정해 둔 이름)
            ck('서버가 "끝남"으로 답했으면(expired) 이 브라우저의 로그인도 지워짐 / 아니면 남음', st.reason === 'expired' ? !(await keyBuckets(page)).includes('eon_auth_v1') : (st.reason === 'no_member' ? true : (await keyBuckets(page)).includes('eon_auth_v1') || st.state === 'signed_out'));
        } finally {
            const back = await pause('restore-session', { sid }, { revertOf: 'expire-session' });
            ck('원복 확인: 로그인 기록을 되돌렸다는 답', !!back && back.reverted === true ? true : null);
        }
    });

    // ---- 15·16. 점검(실제 503) ----
    await runCase('15', '점검 켠 상태: B 는 점검 안내, 예외 명단의 A 는 로그인', async (cx, ck) => {
        await pause('maintenance-on', { exception: 'A' }, { needsRevert: true });
        try {
            const page = await cx.page();
            const r = await doLogin(cx, page, 'B');
            const st = await stateOf(page);
            ck('B: 점검 안내', r.message === 'maintenance');
            ck('B: rejected·maintenance(실제 503)', st.state === 'rejected' && st.reason === 'maintenance' && cx.records.some((x) => x.target === 'my_profile' && x.status === 503));
            ck('B: 이동 0·호환 값 없음·표시 0', !r.moved && !(await keyBuckets(page)).includes('iontoefl_user') && !anyNow(await marks(page)));
            const cx2 = await newCx('16');
            try {
                const p2 = await cx2.page();
                const r2 = await doLogin(cx2, p2, 'A');
                ck('A(예외 명단): 로그인되고 index.html 에 이름', r2.message === 'success' && r2.moved && (await nameShown(p2, cx2.seen.names.A)));
                cx.records.push(...cx2.records);
            } finally { await cx2.context.close(); }
        } finally {
            const back = await pause('maintenance-off', {}, { revertOf: 'maintenance-on' });
            ck('원복 확인: 점검을 껐다는 답', !!back && back.reverted === true ? true : null);
        }
    });

    // ---- allowed 거짓(실행기가 만든 가짜 응답 — 실제 503 과 따로 센다) ----
    await runCase('AF', 'allowed 거짓(가짜 응답): 표시·이동 0', async (cx, ck) => {
        cx.hooks.my_site_access = { after: async (rec, out) => ({ replace: { status: 200, body: JSON.stringify({ allowed: false, is_admin: false }) } }) };
        const page = await cx.page();
        const r = await doLogin(cx, page, 'A');
        const st = await stateOf(page);
        ck('점검 안내(임시 문구)', r.message === 'maintenance');
        ck('rejected·not_allowed', st.state === 'rejected' && st.reason === 'not_allowed');
        ck('이동 0·호환 값 없음·표시 0', !r.moved && !(await keyBuckets(page)).includes('iontoefl_user') && !anyNow(await marks(page)));
    });

    // ---- 17~19. 저장된 로그인으로 시작(aal2 는 화면으로 만들 수 없다) ----
    const seeded = (id, title, acct, aal, judge) => runCase(id, title, async (cx, ck) => {
        const got = await pause('provide-session', { account: acct, aal }, { leaves: acct });
        const session = got && got.session;
        // 넣기 전에 출처를 확인한다: 발급자·합성 계정·aal·로그인 기록 번호·만료·키. 어긋나면 넣지도 보내지도 않는다(미확인)
        const origin = checkProvidedSession(session, { email: vault.get('EMAIL_' + acct), aal }, Date.now());
        if (!origin.ok) { cx.notes = { sessionRefused: origin.why }; ck('받은 로그인 상태의 출처 확인(어긋나서 넣지 않음)', null); return; }
        ck('받은 로그인 상태의 출처 확인: 발급자·합성 계정·aal·로그인 기록 번호·만료·키', true);
        cx.account = acct;
        const page = await cx.page();
        await page.goto(ON + '/__b3a/blank');
        await page.evaluate((s) => { localStorage.setItem('eon_auth_v1', JSON.stringify(s)); }, session);     // 메모리에서 브라우저로만(디스크에 쓰지 않는다)
        const h = await heldLoad(cx, page, 'my_profile', () => page.goto(ON + '/index.html', { waitUntil: 'domcontentloaded' }));
        ck('확인 응답을 붙잡음', h.reached ? true : null);
        ck('붙잡은 동안 이름·관리자 링크·버튼·학습 자료 링크 0', h.reached ? h.shownDuring === false : null);
        await judge(cx, ck, page, h);
    });
    await seeded('17', 'GM·aal2(저장된 로그인): 확인 뒤에만 관리자 표시', 'GM', 'aal2', async (cx, ck, page, h) => {
        const role = await page.evaluate(() => { try { return JSON.parse(window.__b3a.rawGet.call(localStorage, 'iontoefl_user')).role; } catch (e) { return ''; } });
        ck('signed_in, role 은 admin', h.stateAfter.state === 'signed_in' && role === 'admin');
        ck('풀어 준 뒤 관리자 링크·버튼·학습 자료 링크가 보임', !!h.after && h.after.cur.adminLink && h.after.cur.adminBtn && h.after.cur.materials);
        ck('my_site_access 의 is_admin 이 참', cx.records.some((x) => x.target === 'my_site_access' && x.isAdmin === true));
    });
    const seededNoMember = async (cx, ck, page, h) => {
        ck('signed_in 이 아님(no_member)', h.stateAfter.state !== 'signed_in' && h.stateAfter.reason === 'no_member');
        ck('관리자 표시 0', !!h.after && !anyNow(h.after));
        ck('호환 값 없음', !(await keyBuckets(page)).includes('iontoefl_user'));
    };
    await seeded('18', 'G·aal2(저장된 로그인): 대응 없음 → 표시 0', 'G', 'aal2', seededNoMember);
    await seeded('19a', 'G·aal1(저장된 로그인): 대응 없음 → 표시 0', 'G', 'aal1', seededNoMember);
    await seeded('19b', 'GM·aal1(저장된 로그인): 회원 표시만', 'GM', 'aal1', async (cx, ck, page, h) => {
        ck('signed_in', h.stateAfter.state === 'signed_in');
        ck('관리자 링크·버튼·학습 자료 링크 0', !!h.after && !h.after.cur.adminLink && !h.after.cur.adminBtn && !h.after.cur.materials);
    });

    // ---- R. 갱신의 경우들(구분해서) ----
    //   my_profile 에 가짜 401(JWT 만료) 하나를 돌려줘 모듈이 갱신을 한 번 하게 만든 뒤, 그 갱신을 경우마다 다르게 다룬다.
    const refreshCase = (id, title, hook, want) => runCase(id, title, async (cx, ck) => {
        const page = await cx.page();
        await doLogin(cx, page, 'A');
        let once = true;
        cx.hooks.my_profile = { before: async () => (once ? ((once = false), { fulfill: { status: 401, body: JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }) } }) : null) };
        cx.hooks.refresh = hook;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await settled(page, 45000);
        await sleep(600);
        const st = await stateOf(page);
        const attempts = cx.records.filter((x) => x.target === 'refresh' && !x.aborted);
        ck('갱신 시도는 한 번뿐(결과를 모르는 갱신을 다시 보내지 않음)', attempts.length === 1);
        ck(`상태 rejected·${want.reason}`, st.state === 'rejected' && st.reason === want.reason);
        ck('로그인 기록을 지우지 않음(끝났다는 증거가 아니다)', (await keyBuckets(page)).includes('eon_auth_v1'));
        ck('종료 요청 0', count(cx, 'logout') === 0);
        ck('이름·관리자 표시 0, 새 모듈이 만든 호환 값 없음', !anyNow(await marks(page)) && !(await keyBuckets(page)).includes('iontoefl_user'));
        ck(want.sentLabel, want.sent(attempts[0] || {}));
    });
    await refreshCase('R1', '갱신: 전송 전 중단(서버가 받지 못함)', { before: async () => 'abort' }, { reason: 'network', sentLabel: '그 갱신은 서버로 나가지 않음', sent: (r) => r.how === 'aborted-before-send' && r.sent === false });
    await refreshCase('R2', '갱신: 서버가 처리한 뒤 응답 유실', { after: async () => 'drop' }, { reason: 'network', sentLabel: '그 갱신은 서버가 받았고 응답만 버림', sent: (r) => /response-dropped$/.test(r.how || '') });
    await refreshCase('R3', '갱신: 429(가짜 응답)', { before: async () => ({ fulfill: { status: 429, body: JSON.stringify({ code: 'over_request_rate_limit', message: 'rate limit' }) } }) }, { reason: 'rate_limited', sentLabel: '429 는 실행기가 만든 가짜 응답', sent: (r) => r.how === 'fake-response' });

    // ---- I. 기존 로그인 상태와의 격리 ----
    const SEEDS = {
        old: { iontoefl_user: JSON.stringify({ id: 'm-old', name: '옛학생', nickname: '', email: 'old@zz.invalid', phone: '010-0000-0000', level: 2, role: 'user' }), iontoefl_login_time: '1790000000000' },
        book: { eon_book_auth_v1: JSON.stringify({ access_token: 'zz-other-book', refresh_token: 'zz-other-book-r', expires_at: 4102444800, user: { id: 'other-book', email: 'book@other.zz.invalid' } }) },
        followup: { [`sb-${TEST_REF}-auth-token`]: JSON.stringify({ access_token: 'zz-other-followup', refresh_token: 'zz-other-followup-r', expires_at: 4102444800 }) },
    };
    SEEDS.mixed = Object.assign({}, SEEDS.old, { eon_book_auth_v1: SEEDS.book.eon_book_auth_v1.replace('4102444800', '1700000000') }, { [`sb-${TEST_REF}-auth-token`]: SEEDS.followup[`sb-${TEST_REF}-auth-token`].replace('4102444800', '1700000000') });
    const seedStore = async (cx, page, site, seed) => {
        await page.goto(site + '/__b3a/blank');
        await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, seed);
        for (const k of Object.keys(cx.store)) delete cx.store[k];            // 넣는 동안 센 것은 버린다
    };
    const unchanged = (page, seed) => page.evaluate((s) => Object.entries(s).every(([k, v]) => window.__b3a.rawGet.call(localStorage, k) === v), seed);
    const touched = (cx, bucket, ops) => ops.reduce((n, op) => n + ((cx.store[bucket] || {})[op] || 0), 0);
    for (const [id, name] of [['I1', 'old'], ['I4', 'mixed']]) {
        await runCase(id, `격리: 옛 방식의 로그인 상태가 있는 브라우저(${name === 'old' ? '옛 학생' : '섞임+만료'})`, async (cx, ck) => {
            const page = await cx.page();
            await seedStore(cx, page, ON, SEEDS[name]);
            await page.goto(ON + '/login.html?redirect=my-dashboard.html', { waitUntil: 'domcontentloaded' });
            await settled(page);
            await sleep(1500);
            ck('옛 값만 보고 자동 이동하지 않음', pathOf(page).endsWith('/login.html'));
            await page.fill('#email', vault.get('EMAIL_A'));
            await page.fill('#password', vault.get('PW'));
            await page.click('#loginBtn');
            await until(page, "!!document.querySelector('.alert')", 15000);
            await sleep(1500);
            ck('안내: 기존 방식의 로그인 상태가 있습니다', (await alertId(page)) === 'legacy');
            ck('인증 요청 0', cx.records.filter((x) => ['login', 'refresh', 'logout', 'my_profile', 'my_site_access', 'auth-other'].includes(x.target)).length === 0);
            ck('옛 값이 글자 그대로', await unchanged(page, SEEDS[name]));
            ck('옛 값의 자리에 쓰기·지우기 0', touched(cx, 'iontoefl_user', ['setItem', 'removeItem']) === 0 && touched(cx, 'iontoefl_login_time', ['setItem', 'removeItem']) === 0 && touched(cx, 'all', ['clear']) === 0);
            ck('교재 편집·후속메일 상태의 읽기·쓰기·지우기 0', touched(cx, 'eon_book_auth_v1', ['getItem', 'setItem', 'removeItem']) === 0 && touched(cx, 'followup', ['getItem', 'setItem', 'removeItem']) === 0);
            await page.goto(ON + '/index.html', { waitUntil: 'domcontentloaded' });
            await settled(page);
            await sleep(500);
            ck('index.html 이 옛 값으로 이름을 그리지 않음', !anyNow(await marks(page)));
        });
    }
    for (const [id, name, bucket] of [['I2', 'book', 'eon_book_auth_v1'], ['I3', 'followup', 'followup']]) {
        await runCase(id, `격리: ${name === 'book' ? '교재 편집' : '후속메일'} 상태만 있는 브라우저에서 로그인 → 로그아웃`, async (cx, ck) => {
            const page = await cx.page();
            await seedStore(cx, page, ON, SEEDS[name]);
            const r = await doLogin(cx, page, 'A');
            ck('로그인되고 index.html 에 이름', r.message === 'success' && r.moved && (await nameShown(page, cx.seen.names.A)));
            await page.locator('#authMenu a', { hasText: 'LOGOUT' }).click();
            await until(page, "window.EonAuth && window.EonAuth.state() === 'signed_out'", 15000);
            await sleep(600);
            ck('넣어 둔 값이 글자 그대로', await unchanged(page, SEEDS[name]));
            ck('그 키의 읽기·쓰기·지우기 0', touched(cx, bucket, ['getItem', 'setItem', 'removeItem']) === 0 && touched(cx, 'all', ['clear']) === 0);
            ck('업무 요청의 자격은 공개 키', cx.records.filter((x) => x.where === 'test-project' && (x.target === 'rest-table' || x.target === 'rest-rpc-other')).every((x) => x.credential === 'anon'));
        });
    }

    // ---- O. 꺼짐 대조 ----
    const offStates = { O1: {}, O2: SEEDS.old, O3: SEEDS.book, O4: SEEDS.followup, O5: SEEDS.mixed };
    for (const [id, seed] of Object.entries(offStates)) {
        await runCase(id, `꺼짐 대조(${{ O1: '빈 브라우저', O2: '옛 학생', O3: '교재 편집만', O4: '후속메일만', O5: '섞임+만료' }[id]})`, async (cx, ck) => {
            const page = await cx.page();
            await seedStore(cx, page, OFF, seed);
            const module0 = siteOff.core.counts.authModule;
            await page.goto(OFF + '/index.html?eon_auth=on&EON_AUTH_SWITCH=on', { waitUntil: 'domcontentloaded' });
            await sleep(1200);
            ck('EonAuth.state() 가 off(주소의 꼬리표로 켜지지 않음)', (await stateOf(page)).state === 'off');
            const hasOld = Object.prototype.hasOwnProperty.call(seed, 'iontoefl_user');
            const m = await marks(page);
            ck(hasOld ? '옛 값으로 이름을 그림(지금 그대로)' : '로그인 전 모양', !!m && m.cur.name === hasOld);
            await page.goto(OFF + '/login.html?redirect=my-dashboard.html', { waitUntil: 'commit' }).catch(() => {});
            await sleep(1500);
            ck(hasOld ? '옛 값이 있으면 redirect 주소로 자동 이동(지금 그대로)' : '자동 이동 없음', pathOf(page).endsWith(hasOld ? '/my-dashboard.html' : '/login.html'));
            ck('인증 모듈의 요청 0', cx.records.filter((x) => ['login', 'refresh', 'logout', 'my_profile', 'my_site_access', 'auth-other'].includes(x.target)).length === 0);
            ck('SDK 파일을 받는 요청 0(꺼짐 서버가 그 파일을 내준 횟수)', siteOff.core.counts.sdk === 0);
            // (계약 3C-1) 옛 값이 있으면 login.html 이 지금처럼 my-dashboard.html 로 넘어가고, 그 화면도 이제 인증 모듈 파일을 받는다
            ck('지금과 다른 것(차이 장부): 꺼짐의 화면이 인증 모듈 파일을 화면마다 1번 받음(index.html·login.html, 넘어간 화면이 있으면 그 화면도)', siteOff.core.counts.authModule - module0 === (hasOld ? 3 : 2));
            ck('새 모듈의 저장소 키 0', !(await keyBuckets(page)).some((k) => k.startsWith('eon_auth')));
            ck('새 모듈의 키·교재 편집·후속메일 키의 읽기·쓰기·지우기 0', ['eon_auth_v1', 'eon_auth_v1:compat', 'eon_auth_other', 'eon_book_auth_v1', 'followup'].every((b) => touched(cx, b, ['getItem', 'setItem', 'removeItem']) === 0));
            ck('넣어 둔 값이 글자 그대로', await unchanged(page, seed));
        });
    }
    // ---- C. 계약 3C-1: 대상 화면의 로그인 상태 통일 ----
    await buildPageCases({
        runCase, pause, doLogin, until, settled, stateOf, sleep, pathOf, count, vault, seedStore, SEEDS, newCx,
        synth: () => ({ appA: FAKE_APP, post: FAKE_POST }),
        people, labelControl, restUrl: () => TEST_URL + '/rest/v1',
        hidden: (page) => page.evaluate(() => document.documentElement.classList.contains('eon-auth-away')).catch(() => null),
        checkProvidedSession, keyBuckets,
        sites: () => ({ on: ON, off: OFF }),
        authModuleCount: () => siteOff.core.counts.authModule,
        sdkCountOff: () => siteOff.core.counts.sdk,
    });
    return plan;
}

// ---------------------------------------------------------------------------
async function main() {
    console.log(`화면 시험 실행기 — ${FAKE ? '가짜 서버를 상대로(실제 서버의 증거가 아니다)' : '시험 프로젝트를 상대로'}`);
    if (FAKE) setupFake();
    siteOn = await startSite('on');
    siteOff = await startSite('off');
    ON = siteOn.origin;
    OFF = siteOff.origin;
    for (const site of [siteOn, siteOff]) {
        const scan = site.core.scan();
        if (scan.repoSwitch !== 'off') stop('저장소의 스위치 값이 꺼짐이 아니다');
        site.core.counts.sdk = 0;
        site.core.counts.authModule = 0;
    }
    // SDK 파일을 내준 횟수(꺼짐 서버에서는 0 이어야 한다)
    for (const site of [siteOn, siteOff]) {
        const respond = site.core.respond;
        site.core.respond = (req) => {
            const p = String(req.url).split('?')[0];
            if (p === '/vendor/supabase-2.116.0.js') site.core.counts.sdk++;
            if (p === '/js/auth-session.js') site.core.counts.authModule++;
            return respond(req);
        };
    }
    await startControl();
    // 회원 JWT 는 발급자가 시험 프로젝트이고 계정이 이번 실행의 합성 계정일 때만 내보낸다(보관함이 열리기 전에는 어떤 회원 JWT 도 내보내지 않는다)
    decide = makeDecider({
        selfOrigins: [ON, OFF], anonKey: ANON, issuer: ISSUER,
        memberEmails: () => (vault.armed() ? ACCOUNT_KEYS.map((k) => vault.get('EMAIL_' + k)) : []),
        // (계약 3C-1) 업무 요청은 전부 막는다(인자와 무관). 여기서 주는 것은 기록의 이름표뿐이다: 조건의 값이 어느 합성 계정의 것인가
        // 회원 이메일·회원번호는 my_profile 에서 본 것, 로그인 이메일은 따로(화면이 로그인 이메일을 업무 조건에 쓰면 결함 — 따로 센다)
        accountLabels: () => people.labels(),
    });
    if (FAKE) fakeOperator();
    console.log(`  켜짐 ${ON}   꺼짐 ${OFF}   제어 포트 ${control.port}`);

    browser = await chromium.launch({
        executablePath: chromePath,
        headless: !flag('--headed'),
        // 브라우저는 127.0.0.1 말고는 이름을 풀지 못한다(차단기를 거치지 않고 바깥으로 나가는 길을 막는다)
        args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
        env: browserEnv(process.env),                              // 필요한 환경 변수만(비밀번호·제어 비밀·공개 키·이메일은 물려지지 않는다)
        ignoreDefaultArgs: ['--disable-back-forward-cache'],      // 보관된 화면이 되살아나는 경우도 재려고
    });

    let stopped = null;
    let seq = { stopped: 'error', started: [] };
    try {
        const plan = await buildCases();
        const first = plan.find((c) => c.id === 'P');
        const wantsPageCase = !!ONLY && [...ONLY].some((id) => PAGE_CASE_IDS.includes(id));
        const rest = plan.filter((c) => c.id !== 'P' && (!ONLY || ONLY.has(c.id) || (c.id === 'CL' && wantsPageCase)));
        // 예행(P)은 언제나 먼저 돈다. P 의 판정이 전부 참이 아니면 뒤의 경우를 하나도 시작하지 않는다(보관함도 열리지 않는다)
        seq = await runSequence({
            preflight: async () => { await first.run(); return results.find((r) => r.id === 'P'); },
            cases: rest, vault, board,
        });
    } catch (e) {
        stopped = '실행 도중 예외';
    } finally {
        await browser.close().catch(() => {});
    }
    if (seq.stopped === 'preflight') stopped = '차단의 예행(P)이 통과하지 못해 뒤의 경우를 시작하지 않음';
    // 브레인방이 건 DB 변경이 남아 있을 수 있으면 "원복 확인"을 받기 전에는 끝내지 않는다
    if (board.pendingRevert && seq.stopped !== 'revert') await confirmRevert(board);
    if (board.pendingRevert) stopped = '원복 확인을 받지 못함 — 시험 프로젝트의 점검·로그인 기록을 직접 확인해 되돌릴 것';

    const sinkTotal = siteOn.core.counts.sink + siteOff.core.counts.sink;
    const required = results.filter((r) => r.required);
    const totals = { pass: results.filter((r) => r.verdict === 'pass').length, differs: results.filter((r) => r.verdict === 'differs').length, unknown: results.filter((r) => r.verdict === 'unknown').length };
    const expectedIds = ['P', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9b', '10', '12', 'T', '14', '15', 'AF', '17', '18', '19a', '19b', 'R1', 'R2', 'R3', 'I1', 'I4', 'I2', 'I3', 'O1', 'O2', 'O3', 'O4', 'O5'];
    expectedIds.push(...PAGE_CASE_IDS);
    const notRun = expectedIds.filter((id) => !results.some((r) => r.id === id));
    const all = results.flatMap((r) => r.records);
    const controlPass = all.filter((r) => r.how === 'control-pass').length;         // 예행에서 일부러 보낸 대조용 정상 요청(1건)
    const sinkUnexpected = sinkTotal - controlPass;
    const businessLeaks = all.filter((r) => r.business && (r.sent || !r.aborted)).length + wire.refusedAtSendPoint + (fake ? fake.businessArrivals : 0);
    const loginEmailConditions = all.filter((r) => r.business && !r.probe && r.accountBy === 'login-email').length;       // 어느 경우에서든 0 이어야 한다
    const overall = businessLeaks === 0 && loginEmailConditions === 0 && !stopped && notRun.length === 0 && required.every((r) => r.verdict === 'pass') && sinkUnexpected === 0 && controlPass === 1 && egress.blocked === 0 && (!FAKE || egress.testProject === 0);
    const output = {
        tool: 'tests/auth-session/screen.mjs',
        mode: FAKE ? 'fake-server' : 'test-project',
        selftest: SELFTEST,                                 // null 이 아니면 일부러 고장을 낸 대조 실험이다(통과가 아닌 것이 기대)
        vaultOpened: vault.armed(),                         // 예행이 통과해 비밀 보관함이 열렸는가
        started: seq.started,
        note: FAKE ? '가짜 서버를 상대로 돌린 결과다 — 실제 서버·실제 응답의 증거가 아니다' : '시험 프로젝트를 상대로 돌린 결과',
        overall: overall ? 'pass' : 'not-pass',
        stopped,
        notRun,
        totals,
        independentEvidence: {
            // 차단기의 결정과 독립된 숫자들
            sinkReceived: sinkTotal,                        // 시험 목적지가 실제로 받은 수
            sinkControlPass: controlPass,                   // 그 가운데 예행이 일부러 보낸 대조용 정상 요청(1 이어야 한다)
            sinkUnexpected,                                 // 그 밖(0 이어야 한다)
            controlArrivals: control.arrivals,
            controlRejected: control.rejected,
            runnerConnections: egress,                      // 실행기가 연 연결: local / testProject / blocked(막은 시도)
            requestsSentToTestProject: all.filter((r) => r.where === 'test-project' && r.sent).length,
            // (계약 3C-1) 업무 요청: 실제로 나간 것 0 이어야 한다. 전송 지점이 따로 센 것 — 그 지점을 지난 요청은 인증 요청 다섯뿐
            businessSentToTestProject: all.filter((r) => r.business && r.sent).length,
            wireSentByName: wire.sent,                      // 전송 지점을 지난 요청(--real 이면 시험 프로젝트로, --fake 면 가짜 서버로)
            wireSentTotal: Object.values(wire.sent).reduce((a, b) => a + b, 0),
            businessRefusedAtSendPoint: wire.refusedAtSendPoint,       // 차단기를 지나 전송 지점까지 온 업무 요청(0 이어야 한다 — 왔어도 내보내지 않는다)
            businessArrivedAtFakeServer: fake ? fake.businessArrivals : null,   // --fake: 가짜 서버가 받은 업무 요청(0 이어야 한다)
            requestsAnsweredByFakeServer: all.filter((r) => r.how && r.how.startsWith('fake-server')).length,
            staticAllowedFulfilledLocally: all.filter((r) => r.where === 'static-allowed').length,
            // (3차) 화면이 로그인 이메일을 업무 조건에 쓴 시도(0 이어야 한다)와, 그 이름표가 붙는다는 대조(CL)를 이번 실행이 보였는가
            loginEmailConditions,
            loginEmailLabelControl: labelControl.loginEmail,
        },
        summary: summarize(all),
        // (계약 3C-1) 이 실행기가 돌리지 않는 조합 — 통과로 세지 않는다
        notRunMatrix: NOT_RUN_MATRIX,
        businessNote: '업무 요청은 하나도 내보내지 않았다. 막은 업무 요청에는 가짜 응답을 줬다 — 그 응답으로 그려진 화면은 실제 업무 성공이 아니다',
        pendingRevert: board.pendingRevert,                 // null 이 아니면 브레인방이 건 DB 변경이 남아 있을 수 있다
        operatorLeftovers: board.leftovers,                 // 브레인방이 만든 것이 남아 있을 수 있음(로그인 기록 — 정리는 브레인방이 DB 로)
        pauses: board.history,
        cases: results,
    };
    const text = JSON.stringify(output, null, 1);
    // 덧붙이는 점검: 결과에 비밀값·JWT 모양이 없는가(주된 보호는 "정해 둔 값만 적는다"이다)
    const leaks = SCAN.filter((s) => s && text.includes(s)).length + (/eyJ[A-Za-z0-9_-]{8,}/.test(text) ? 1 : 0);
    if (leaks) { console.error('중단: 결과에 비밀값의 흔적이 있어 파일을 쓰지 않는다'); process.exitCode = 5; }
    else { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); }

    console.log('');
    console.log(`  경우: 통과 ${totals.pass} / 기대와 다름 ${totals.differs} / 미확인 ${totals.unknown}${notRun.length ? ` / 돌리지 않음 ${notRun.length}` : ''}`);
    console.log(`  독립된 증거: 시험 목적지 수신 ${sinkTotal}(대조용 ${controlPass} + 그 밖 ${sinkUnexpected}), 실행기가 연 연결 — 로컬 ${egress.local}·시험 프로젝트 ${egress.testProject}·막은 시도 ${egress.blocked}`);
    console.log(`  시험 프로젝트로 실제 보낸 요청 ${output.independentEvidence.requestsSentToTestProject}건, 가짜 서버가 답한 요청 ${output.independentEvidence.requestsAnsweredByFakeServer}건`);
    console.log(`  업무 요청: 실제로 나간 것 ${output.independentEvidence.businessSentToTestProject}건(전송 지점을 지난 요청 ${output.independentEvidence.wireSentTotal}건은 전부 인증 요청 다섯 — ${Object.entries(wire.sent).map(([k, n]) => k + ' ' + n).join(', ')}) / 전송 지점까지 온 업무 요청 ${wire.refusedAtSendPoint}건`);
    console.log(`  업무 요청의 시도(전부 전송 전에 막고 가짜 응답 — 업무 성공으로 세지 않는다): ${Object.entries(output.summary.businessAttempts).map(([k, n]) => k + ' ' + n).join(', ')}`);
    console.log(`  시도의 이름표(조건의 값이 합성 계정의 어느 열의 값인가): ${Object.entries(output.summary.businessLabeled).map(([k, n]) => k + ' ' + n).join(', ')} — 로그인 이메일이 조건인 시도 ${loginEmailConditions}건(0 이어야 한다, 대조 ${labelControl.loginEmail === true ? '보임' : '보이지 못함'})`);
    if (!leaks) console.log(`  결과: ${OUT}`);
    if (SELFTEST) console.log(`  대조 실험(${SELFTEST}): 일부러 고장을 냈다 — 통과가 아닌 것이 기대다`);
    console.log(`전체 판정: ${overall ? '통과' : '통과 아님'}${FAKE ? '  (가짜 서버 — 실제 서버의 증거가 아니다)' : ''}${stopped ? '  [' + stopped + ']' : ''}`);
    control.server.close();
    control.server = null;
    siteOn.server.close();
    siteOff.server.close();
    if (board.leftovers.length) console.log(`  브레인방이 만든 것이 남아 있을 수 있음: ${board.leftovers.map((x) => x.kind + '(' + x.account + ')').join(', ')}`);
    if (!process.exitCode) process.exitCode = seq.stopped === 'preflight' ? 4 : (stopped ? 3 : (overall ? 0 : 1));
    setTimeout(() => process.exit(process.exitCode), 300);
}

main().catch((e) => { console.error('중단: 실행기 오류 — ' + String(e && e.message).split('\n')[0]); process.exit(3); });
