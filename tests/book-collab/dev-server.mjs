// 버전 협업 로컬 검수 서버 (127.0.0.1 전용)
//  * 사이트 파일을 그대로 제공하되 Supabase 주소를 이 서버의 시험 DB(PGlite)로 바꾼다. 운영 DB에 연결하지 않는다.
//  * PostgREST/Auth/Storage를 검수에 필요한 만큼만 흉내 낸다.
// 실행: node dev-server.mjs [--port 8794] [--testroom <테스트룸 저장소 경로>]
//       BOOK_COLLAB_FIXTURE=<운영 읽기 사본 json>이 있으면 그 내용으로 시험 DB를 채운다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTestDb, loadFixture, REPO, TARGET_BOOK, ADMIN_ID, ADMIN_EMAIL, OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL } from './testdb.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(opt('port', 8794));
const TESTROOM = opt('testroom', null);
const ORIGIN = 'http://127.0.0.1:' + PORT;
const SB = ORIGIN + '/sb';
const ANON = 'local-anon-key';
let ACCESS_TTL = 3600;

const fixture = loadFixture();
const db = await createTestDb({ fixture });
// 기존 로그인 화면용 users 표 (시험 계정만)
await db.exec(`
  create table if not exists public.users (
    id uuid primary key default gen_random_uuid(), email text unique, password text, name text, nickname text,
    phone text, level int default 2, role text default 'user', blocked boolean default false,
    withdrawal_requested_at timestamptz, withdrawal_reason text, withdrawal_reason_detail text);
  grant all on public.users to anon, authenticated;
  insert into public.users (email, password, name, role) values
    ('${ADMIN_EMAIL}', 'site-pass', '대표(시험)', 'admin'),
    ('${OTHER_ADMIN_EMAIL}', 'site-pass', '다른 관리자(시험)', 'admin'),
    ('student@example.test', 'site-pass', '학생(시험)', 'user');
`);
const SITE_MODE = args.includes('--site');
const act = (await db.query(`select public.book_collab_activate($1, $2) r`, [TARGET_BOOK, SITE_MODE ? [] : [ADMIN_ID]])).rows[0].r;
console.log('협업 방식:', act.auth_mode);
console.log('시험 DB 준비:', fixture.source, '쪽', act.pages_live, '기준본 V' + act.seq);

const tokens = new Map(); // access_token -> { sub, email, exp }
const refresh = new Map(); // refresh_token -> { sub, email }
const log = [];

function issue(user) {
  const at = 'at-' + crypto.randomUUID();
  const rt = 'rt-' + crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL;
  tokens.set(at, { sub: user.id, email: user.email, exp });
  refresh.set(rt, { sub: user.id, email: user.email });
  return { access_token: at, refresh_token: rt, expires_in: ACCESS_TTL, expires_at: exp, token_type: 'bearer', user: { id: user.id, email: user.email } };
}

function who(req) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const t = tokens.get(auth);
  if (t) {
    if (t.exp < Math.floor(Date.now() / 1000)) return { expired: true };
    return { role: 'authenticated', claims: { sub: t.sub, email: t.email, role: 'authenticated' } };
  }
  if (auth && auth !== ANON) return { expired: true }; // 모르는 토큰 = Supabase처럼 401
  return { role: 'anon', claims: { role: 'anon' } };
}

async function asRole(role, claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function send(res, status, body, headers = {}) {
  const text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}
function pgError(res, e) {
  const msg = e.message || String(e);
  const status = /permission denied/.test(msg) ? 403 : /BOOK_COLLAB_AUTH_REQUIRED/.test(msg) ? 401 : 400;
  send(res, status, { message: msg, code: e.code || 'PGERR' });
}

function parseFilters(sp) {
  const where = [];
  const params = [];
  let select = '*';
  let order = '';
  let limit = '';
  for (const [k, v] of sp.entries()) {
    if (k === 'select') { select = v.split(',').map((c) => { const t = c.trim(); if (t !== '*' && !IDENT.test(t)) throw new Error('bad select'); return t; }).join(','); continue; }
    if (k === 'order') { order = ' order by ' + v.split(',').map((o) => { const [c, d] = o.split('.'); if (!IDENT.test(c)) throw new Error('bad order'); return c + (d === 'desc' ? ' desc' : ' asc'); }).join(','); continue; }
    if (k === 'limit') { limit = ' limit ' + Number(v); continue; }
    if (k === 'offset') continue;
    if (!IDENT.test(k)) throw new Error('bad column ' + k);
    const m = /^(eq|neq|is|ilike|like|gt|gte|lt|lte|in)\.(.*)$/s.exec(v);
    if (!m) throw new Error('bad filter ' + k);
    const [, op, val] = m;
    if (op === 'is') { where.push(k + (val === 'null' ? ' is null' : val === 'true' ? ' is true' : ' is false')); continue; }
    if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(','); params.push(list); where.push(k + '::text = any($' + params.length + ')'); continue; }
    const sqlop = { eq: '=', neq: '<>', ilike: 'ilike', like: 'like', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
    params.push(op.endsWith('like') ? val.replace(/\*/g, '%') : val);
    where.push(k + '::text ' + sqlop + ' $' + params.length);
  }
  return { where: where.length ? ' where ' + where.join(' and ') : '', params, select, order, limit };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handleSupabase(req, res, url) {
  const p = url.pathname.slice(3);
  const id = who(req);
  log.push({ t: Date.now(), method: req.method, path: p, role: id.role || 'expired', q: url.search.slice(0, 200) });
  if (log.length > 2000) log.shift();
  if (p.startsWith('/auth/v1/token')) {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const u = (await db.query(`select id, email from auth.users where lower(email) = lower($1) and test_password = $2`, [body.email || '', body.password || ''])).rows[0];
      if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return send(res, 200, issue(u));
    }
    if (grant === 'refresh_token') {
      const r = refresh.get(body.refresh_token);
      if (!r || r.revoked) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      refresh.delete(body.refresh_token);
      return send(res, 200, issue({ id: r.sub, email: r.email }));
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }
  if (p.startsWith('/storage/v1/object/')) {
    await readBody(req);
    return send(res, 200, { Key: p.replace('/storage/v1/object/', '') });
  }
  if (id.expired) return send(res, 401, { message: 'JWT expired', code: 'PGRST301' });
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length);
    if (!/^book_collab_[a-z_]+$/.test(fn)) return send(res, 404, { message: 'function not found', code: 'PGRST202' });
    const args = JSON.parse((await readBody(req)).toString() || '{}');
    const keys = Object.keys(args).filter((k) => /^p_[a-z_]+$/.test(k));
    const vals = keys.map((k) => { const v = args[k]; return v !== null && typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x === 'string')) ? JSON.stringify(v) : v; });
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    if (DELAY.rpc[fn]) await new Promise((r) => setTimeout(r, DELAY.rpc[fn]));
    try {
      const r = await asRole(id.role, id.claims, (tx) => tx.query(sql, vals));
      if (DROP.rpc[fn] > 0) { DROP.rpc[fn]--; req.socket.destroy(); return; } // 응답 유실 흉내 (서버에는 반영됨)
      return send(res, 200, r.rows[0].r);
    } catch (e) { return pgError(res, e); }
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.slice('/rest/v1/'.length);
    if (!IDENT.test(table)) return send(res, 404, { message: 'not found' });
    try {
      const f = parseFilters(url.searchParams);
      if (req.method === 'GET') {
        const r = await asRole(id.role, id.claims, (tx) => tx.query(`select ${f.select} from public.${table}${f.where}${f.order}${f.limit}`, f.params));
        return send(res, 200, r.rows);
      }
      const body = JSON.parse((await readBody(req)).toString() || 'null');
      if (req.method === 'PATCH') {
        const cols = Object.keys(body || {});
        if (!cols.every((c) => IDENT.test(c))) throw new Error('bad column');
        const params = [...f.params];
        const sets = cols.map((c) => { params.push(typeof body[c] === 'object' && body[c] !== null ? JSON.stringify(body[c]) : body[c]); return c + ' = $' + params.length; });
        const r = await asRole(id.role, id.claims, (tx) => tx.query(`update public.${table} set ${sets.join(', ')}${f.where} returning *`, params));
        return send(res, 200, r.rows);
      }
      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const out = [];
        await asRole(id.role, id.claims, async (tx) => {
          for (const row of rows) {
            const cols = Object.keys(row);
            if (!cols.every((c) => IDENT.test(c))) throw new Error('bad column');
            const vals = cols.map((c) => (typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c]));
            const r = await tx.query(`insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, vals);
            out.push(r.rows[0]);
          }
        });
        return send(res, 201, out);
      }
      if (req.method === 'DELETE') {
        await asRole(id.role, id.claims, (tx) => tx.query(`delete from public.${table}${f.where}`, f.params));
        return send(res, 204, null);
      }
    } catch (e) { return pgError(res, e); }
  }
  return send(res, 404, { message: 'not found' });
}

// 검수용 조작 (127.0.0.1에서만)
const DELAY = { rpc: {} };
const DROP = { rpc: {} };
async function handleTest(req, res, url) {
  const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
  if (url.pathname === '/__test/sql') {
    try { const r = await db.query(body.sql, body.params || []); return send(res, 200, r.rows); } catch (e) { return send(res, 400, { message: e.message }); }
  }
  if (url.pathname === '/__test/rpc-as') {
    // 다른 기기/다른 사람의 저장을 흉내 낸다: 지정 계정으로 RPC 실행
    const claims = { sub: body.sub || ADMIN_ID, email: body.email || ADMIN_EMAIL, role: 'authenticated' };
    const keys = Object.keys(body.args || {});
    const vals = keys.map((k) => { const v = body.args[k]; return v !== null && typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x === 'string')) ? JSON.stringify(v) : v; });
    try {
      const r = await asRole('authenticated', claims, (tx) => tx.query(`select public.${body.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals));
      return send(res, 200, r.rows[0].r);
    } catch (e) { return send(res, 400, { message: e.message }); }
  }
  if (url.pathname === '/__test/expire-tokens') { for (const t of tokens.values()) t.exp = 0; if (body.revokeRefresh) for (const r of refresh.values()) r.revoked = true; return send(res, 200, { ok: true }); }
  if (url.pathname === '/__test/ttl') { ACCESS_TTL = Number(body.ttl) || 3600; return send(res, 200, { ok: true }); }
  if (url.pathname === '/__test/delay') { DELAY.rpc = body.rpc || {}; return send(res, 200, { ok: true }); }
  if (url.pathname === '/__test/drop') { DROP.rpc = body.rpc || {}; return send(res, 200, { ok: true }); }
  if (url.pathname === '/__test/log') { const n = Number(url.searchParams.get('since') || 0); return send(res, 200, log.filter((l) => l.t >= n)); }
  if (url.pathname === '/__test/info') return send(res, 200, { book: TARGET_BOOK, admin: ADMIN_EMAIL, helper: OTHER_ADMIN_EMAIL, fixture: fixture.source });
  return send(res, 404, { message: 'no test route' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
function serveStatic(res, root, rel) {
  const file = path.resolve(root, '.' + decodeURIComponent(rel));
  if (!file.startsWith(path.resolve(root))) return send(res, 403, { message: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { message: 'not found' });
  let data = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' && /supabase-(config|client)\.js$/.test(file)) {
    let s = data.toString('utf8');
    s = s.replace(/https:\/\/qpqjevecjejvbeuogtbx\.supabase\.co(?!\/storage\/v1\/object\/public)/g, SB)
         .replace(/(SUPABASE_ANON_KEY\s*=\s*)(['"])[^'"]+\2/, `$1'${ANON}'`);
    data = Buffer.from(s);
  }
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  try {
    if (req.method === 'OPTIONS') return send(res, 204, null, { 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
    if (url.pathname.startsWith('/sb/')) return await handleSupabase(req, res, url);
    if (url.pathname.startsWith('/__test/')) return await handleTest(req, res, url);
    if (TESTROOM && url.pathname.startsWith('/testroom/')) return serveStatic(res, TESTROOM, url.pathname.slice('/testroom'.length));
    return serveStatic(res, REPO, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('검수 서버', ORIGIN, '책', TARGET_BOOK));
