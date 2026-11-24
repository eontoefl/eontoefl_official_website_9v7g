#!/usr/bin/env node
// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-3 (나) 측정 화면용 로컬 정적 서버 (127.0.0.1 에만 묶인다. 바깥으로 가는 요청 0)
//
// 쓰는 법:  node serve.mjs --manifest <make_pdf 의 manifest.json> [--port 8787]
//   브라우저에서  http://127.0.0.1:<포트>/measure.html
//   (임시 Edge 함수의 환경 값 B2N3_ALLOWED_ORIGIN 은 이 출처와 글자 그대로 같아야 한다 — 127.0.0.1 로 열 것)
//
// 내주는 것
//   /measure.html, /measure.js        측정 화면
//   /local/manifest.json              합성 PDF 의 표식·이름·크기·쪽수·sha256
//   /local/origin/<doc>.pdf           로컬 합성 원본(Range 지원) — 측정 화면이 범위 응답의 바이트를 견줄 때 쓴다
//   /local/credentials                환경 변수에 든 공개 키·회원 자격을 화면에 넘긴다(넣어 뒀을 때만).
//                                     B2N3_ANON_KEY / B2N3_JWT_KEEP(끝내지 않는 로그인) / B2N3_JWT_END(끝낼 로그인)
//                                     같은 출처의 화면만 읽을 수 있게 X-B2n3-Local 머리글을 요구하고 CORS 머리글을 주지 않는다.
//                                     서비스 열쇠는 이 서버와 측정 화면 어디에도 쓰이지 않는다.
//   POST /local/save?name=<이름>      측정 화면이 보낸 결과 JSON 을 <manifest 폴더>/results/<이름>.json 에 쓴다
// 종료: Ctrl+C
// =====================================================================
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
function stop(msg) { console.error(`[b2n3 serve] 멈춤: ${msg}`); process.exit(2); }

const manifestPath = arg('--manifest');
if (!manifestPath || !existsSync(manifestPath)) stop('--manifest <make_pdf 의 manifest.json> 이 필요하다');
const port = Number(arg('--port') ?? 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) stop('--port 는 1024~65535');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const dir = dirname(resolve(manifestPath));
const docs = {};
for (const d of manifest.docs) {
  const path = join(dir, d.file);
  if (!existsSync(path) || statSync(path).size !== d.bytes) stop(`로컬 원본이 없거나 크기가 manifest 와 다르다: ${d.file}`);
  docs[d.doc] = { ...d, path };
}
const publicManifest = { marker: manifest.marker, created_at: manifest.created_at, docs: manifest.docs.map((d) => ({ doc: d.doc, object_name: d.object_name, bytes: d.bytes, pages: d.pages, sha256: d.sha256, md5: d.md5, required_for_verdict: d.required_for_verdict })) };
const STATIC = { '/measure.html': ['measure.html', 'text/html; charset=utf-8'], '/measure.js': ['measure.js', 'text/javascript; charset=utf-8'] };
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

function send(res, status, headers, body) { res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(body); }
const json = (res, status, obj) => send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(obj));

const server = createServer((req, res) => {
  if (!hosts.has(String(req.headers.host))) return send(res, 403, {}, 'b2n3 serve: wrong host');
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  if (req.method === 'GET' && p === '/') return send(res, 302, { Location: '/measure.html' }, '');
  if (req.method === 'GET' && STATIC[p]) return send(res, 200, { 'Content-Type': STATIC[p][1] }, readFileSync(join(HERE, STATIC[p][0])));
  if (req.method === 'GET' && p === '/local/manifest.json') return json(res, 200, publicManifest);
  if (req.method === 'GET' && p === '/local/credentials') {
    if (req.headers['x-b2n3-local'] !== '1' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return send(res, 403, {}, 'b2n3 serve: same-origin only');
    const e = process.env;
    return json(res, 200, { anon_key: e.B2N3_ANON_KEY ?? null, jwt_keep: e.B2N3_JWT_KEEP ?? null, jwt_end: e.B2N3_JWT_END ?? null });
  }
  const m = /^\/local\/origin\/(160|68|34)\.pdf$/.exec(p);
  if ((req.method === 'GET' || req.method === 'HEAD') && m && docs[m[1]]) {
    const d = docs[m[1]];
    const common = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes' };
    const r = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (!r) {
      res.writeHead(200, { ...common, 'Content-Length': d.bytes, 'Cache-Control': 'no-store' });
      return req.method === 'HEAD' ? res.end() : createReadStream(d.path).pipe(res);
    }
    const a = Number(r[1]);
    const b = r[2] === '' ? d.bytes - 1 : Math.min(Number(r[2]), d.bytes - 1);
    if (a > b || a >= d.bytes) return send(res, 416, { 'Content-Range': `bytes */${d.bytes}` }, '');
    res.writeHead(206, { ...common, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${d.bytes}`, 'Cache-Control': 'no-store' });
    return req.method === 'HEAD' ? res.end() : createReadStream(d.path, { start: a, end: b }).pipe(res);
  }
  if (req.method === 'POST' && p === '/local/save') {
    const name = u.searchParams.get('name') ?? '';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return send(res, 400, {}, 'b2n3 serve: bad name');
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total > 64 * 1024 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        JSON.parse(text);
        mkdirSync(join(dir, 'results'), { recursive: true });
        const out = join(dir, 'results', `${name}.json`);
        writeFileSync(out, text, 'utf8');
        json(res, 200, { saved: out, bytes: total });
      } catch (e) { send(res, 400, {}, 'b2n3 serve: not json'); }
    });
    return undefined;
  }
  return send(res, 404, {}, 'b2n3 serve: not found');
});
server.listen(port, '127.0.0.1', () => {
  const e = process.env;
  console.error(`[b2n3 serve] http://127.0.0.1:${port}/measure.html  (표식 ${manifest.marker}, 원본 ${Object.keys(docs).join('·')})`);
  console.error(`[b2n3 serve] 환경 변수의 자격: 공개 키 ${e.B2N3_ANON_KEY ? '있음' : '없음'} · 끝내지 않는 로그인 ${e.B2N3_JWT_KEEP ? '있음' : '없음'} · 끝낼 로그인 ${e.B2N3_JWT_END ? '있음' : '없음'} (없으면 화면에 직접 넣는다)`);
  console.error(`[b2n3 serve] 결과 저장 폴더: ${join(dir, 'results')}`);
});
