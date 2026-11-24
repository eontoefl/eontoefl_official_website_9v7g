// 화면 시험용 로컬 서버 (보안작업 묶음2 계약 3A) — 브레인방이 시험 프로젝트로 실제 화면을 확인할 때 쓴다.
//
//   node tests/auth-session/serve.mjs --mode on   [--port 8787] [--log 파일] [--scan-only]
//   node tests/auth-session/serve.mjs --mode off
//
// 환경 변수(둘 다 있어야 하고, 맞지 않으면 아무것도 하지 않고 종료 코드 2):
//   B3A_TEST_URL       정확히 https://hmncdheiwqwekdbtijar.supabase.co
//   B3A_TEST_ANON_KEY  시험 프로젝트의 공개(anon) 키. 출력·기록하지 않는다. 다른 프로젝트의 키·service_role 키면 거절.
//
// * 127.0.0.1 에만 묶인다. 이 서버는 바깥으로 요청을 보내지 않는다(Supabase 로도 0건 — 요청은 브라우저가 보낸다).
// * 저장소의 파일은 바꾸지 않는다. 내주는 사본만 바꾼다(주소·공개 키 → 시험 프로젝트, 스위치 → --mode 의 값).
// * 저장소의 스위치 값이 꺼짐이 아니면 시작하지 않는다.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { TEST_URL, TEST_REF, CONFIG_FILE, readProdConfig } from './rewrite.mjs';
import { createCore, makeIgnore, STATIC_ALLOW } from './serve-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stop(message) {
    console.error('중단: ' + message);
    process.exit(2);
}

function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

// 공개 키의 모양을 본다(값은 찍지 않는다): 시험 프로젝트의 anon 키여야 한다
function checkAnonKey(key) {
    if (typeof key !== 'string' || !key) return '없음';
    const parts = key.split('.');
    if (parts.length !== 3) return 'JWT 모양이 아님(이 도구는 ref 를 확인할 수 있는 anon 키만 받는다)';
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (e) { return '읽을 수 없음'; }
    if (claims.ref !== TEST_REF) return '시험 프로젝트의 키가 아님';
    if (claims.role !== 'anon') return 'anon 키가 아님(' + String(claims.role) + ')';
    return null;
}

const mode = arg('--mode');
const port = Number(arg('--port', '8787'));
const scanOnly = process.argv.includes('--scan-only');
if (mode !== 'on' && mode !== 'off') stop('--mode on 또는 --mode off 를 주세요');
if (!Number.isInteger(port) || port < 1024 || port > 65535) stop('--port 는 1024~65535');
if (process.env.B3A_TEST_URL !== TEST_URL) stop(`B3A_TEST_URL 이 시험 프로젝트의 주소(${TEST_URL})와 정확히 같지 않음`);
const keyProblem = checkAnonKey(process.env.B3A_TEST_ANON_KEY);
if (keyProblem) stop('B3A_TEST_ANON_KEY: ' + keyProblem);

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
let ignoreText = '';
try { ignoreText = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8'); } catch (e) { ignoreText = ''; }
const ignored = makeIgnore(ignoreText);
const files = tracked.filter((f) => !ignored(f) && !f.startsWith('.'));
const prod = readProdConfig(fs.readFileSync(path.join(ROOT, CONFIG_FILE), 'utf8'));

const logFile = path.resolve(arg('--log', path.join(ROOT, 'tests', 'auth-session', '.run', `serve-${mode}.jsonl`)));
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const logStream = scanOnly ? null : fs.createWriteStream(logFile, { flags: 'a' });

const core = createCore({
    files,
    readFile: (rel) => { try { return fs.readFileSync(path.join(ROOT, rel)); } catch (e) { return null; } },
    mode,
    testKey: process.env.B3A_TEST_ANON_KEY,
    port,
    prod,
    log: (entry) => { if (logStream) logStream.write(JSON.stringify(entry) + '\n'); },
});

const scan = core.scan();
console.log(`화면 시험용 로컬 서버 — 스위치: ${mode === 'on' ? '켜짐' : '꺼짐'} (내주는 사본에서만)`);
console.log(`  저장소의 스위치 값: ${scan.repoSwitch === 'off' ? '꺼짐' : String(scan.repoSwitch)}`);
console.log(`  Supabase 주소·공개 키: 시험 프로젝트(${TEST_REF})의 값으로 바꿔 내줌`);
console.log(`  내줄 수 있는 파일 ${scan.servable}개 / 내주지 않는 파일(운영 흔적이 남음) ${scan.refused.length}개:`);
for (const r of scan.refused) console.log(`    · ${r.file} — ${r.residue.join(', ')}`);
console.log('  읽기 전용 정적 자원의 허용 목록(이 밖의 바깥 요청은 브라우저에서 막힘):');
console.log(`    · 글꼴·모양: ${[...new Set([...STATIC_ALLOW.style, ...STATIC_ALLOW.font])].join(', ')}`);
console.log(`    · 그림: ${STATIC_ALLOW.img.join(', ')}`);
console.log(`  로컬 시험 목적지: ${core.sinkUrl}`);
if (scan.repoSwitch !== 'off') stop('저장소의 스위치 값이 꺼짐이 아니다');
if (scanOnly) process.exit(0);

const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 65536) chunks.push(c); });
    req.on('end', () => {
        let out;
        try {
            out = core.respond({ method: req.method, url: req.url, body: Buffer.concat(chunks) });
        } catch (e) {
            out = { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from('서버 오류', 'utf8') };
        }
        res.writeHead(out.status, out.headers);
        res.end(out.body);
    });
});
server.listen(port, '127.0.0.1', () => {
    console.log(`  열림: http://127.0.0.1:${port}/login.html   (상태: http://127.0.0.1:${port}/__b3a/status)`);
    console.log(`  기록: ${logFile}   (머리글·본문은 남기지 않는다)`);
    console.log('  멈추려면 Ctrl+C');
});
