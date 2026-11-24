#!/usr/bin/env node
// =====================================================================
// 보안작업 묶음 2 — 계약 3-0 본인 회원 정보 함수 public.my_profile() 대조표 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 이 도구는 작업방이 실제 API 에 돌려 본 적이 없다(가짜 응답으로만 돌려 봤다 — 가짜 응답은 실제 동작을 대신하지 않는다).
// 보내는 요청은 POST·GET·HEAD  <주소>/rest/v1/rpc/my_profile 뿐이다. 아무것도 고치지 않는 요청이다.
// 열쇠·자격은 머리글로만 실리고 결과·화면에 적지 않는다(결과에는 자격 안의 식별값 sub·session_id·aal 만).
//
// 단계(--phase)                                                                                  요청
//   plan            그 상태(--state)의 칸과 기대값을 적는다                                         0
//   sessions-sql    환경 변수의 로그인 자격들의 로그인 기록이 살아 있는지 읽는 SQL 을 적는다           0
//   absent          적용 전 기준: 그 RPC 가 "등록되지 않은 함수"로 응답하는가                          있음
//                   (--fingerprint 가 "DB 카탈로그에 그 함수가 없음"을 함께 보여야 통과 — 일반 404 만으로는 통과가 아니다)
//   matrix          대조표: 자격 12 × 요청(POST·GET·HEAD) + 인자를 붙인 요청                          있음
//                   --state normal | normal-hook | maint | maint-hook
//                     normal      점검 꺼짐, 공통 확인 설정 없음        normal-hook  점검 꺼짐, 공통 확인 설정 걸림
//                     maint       점검 중,  공통 확인 설정 없음        maint-hook   점검 중,  공통 확인 설정 걸림
//   revoked         --kind expired|loggedout  --step pre|post|restored   JWT 는 유효한데 로그인 기록이 끝난 경우   있음
//                   --kind jwt-expired  --step pre|post [--pre <pre 결과>]  JWT 자체가 만료된 경우.
//                     **같은 JWT** 로 만료 전 성공(pre: ok)과 만료 뒤 오류의 사유(post)를 한 쌍으로 대조한다.
//                     post 는 pre 의 결과 파일을 받아 같은 JWT 인지(sha256 앞 12자·만료 시각) 본다
//   rows-compare    대조표 전체의 앞뒤에 뜬 rows_md5.sql 결과 둘을 견준다(--before --after)             0
//                   (대조표 전체를 사이에 둔 앞뒤 불변이다 — 호출 하나하나의 불변을 보이는 것이 아니다)
//   compare         지문 결과 둘을 견준다(--a --b, read_at 은 빼고. --ignore 로 더 뺄 키를 적는다)      0
//   body-md5        마이그레이션 파일의 함수 본문 md5 를 계산한다(되돌리기 SQL·지문의 body_md5 와 견줄 값)   0
//
// 공통 인자
//   --expect <json>          fixtures_up.sql 의 마지막 결과(합성 계정별 회원 값·기대 상태)
//   --fingerprint <json>     재기 직전에 뜬 이 폴더의 fingerprint.sql 결과. 도구는 상태를 스스로 알 수 없다 —
//                            이 파일로 함수의 존재·실행 권한·점검 상태·공통 확인 설정이 --state 와 맞는지 보고,
//                            맞지 않으면 요청을 보내지 않는다(종료 값 3). 30분보다 오래된 파일은 받지 않는다
//   --sessions-alive <json>  sessions-sql 의 SQL 을 재기 직전에 실행한 결과. 로그인 자격의 로그인 기록이 살아 있고
//                            계정·aal 이 자격과 같은지 본다(어긋나면 요청 0 으로 멈춘다). 30분보다 오래된 파일은 받지 않는다
//   --out <json>             결과 파일
//   --actors a,b,…           일부 자격만(matrix)
// 환경 변수
//   B3P0_URL            정확히 https://hmncdheiwqwekdbtijar.supabase.co
//   B3P0_ANON_KEY / B3P0_SERVICE_KEY
//   B3P0_JWT_A · _B · _N · _G1 · _G2 · _GM1 · _GM2 · _BLK · _WD · _BW      대조표의 로그인 자격
//   B3P0_JWT_A_EXP · _A_OUT · _A_OLD      A 의 다른 로그인: 만료용 · 로그아웃용 · JWT 만료용(revoked 단계)
//
// 판정
//   통과    기대값과 전부 같다(상태 코드, 응답의 키 집합이 정확히 같음, 값, Cache-Control, 금지 키·금지 값 없음)
//   기대와 다름   응답은 왔는데 하나라도 다르다
//   미확인  네트워크 오류·시간 초과·429·기대하지 않은 5xx — 성공으로도 실패로도 세지 않는다
//   금지 값 = 합성 회원 전원의 회원번호·이름·별명·이메일·전화, 옛 비밀번호 열의 합성 표식, 탈퇴 사유 표식, 로그인 계정 번호.
//             ok 칸에서는 그 회원 본인의 여섯 값만 허용한다. 응답 본문의 글자 전체에서 찾는다.
//   HEAD 는 본문이 비어 있다는 것으로 판정하지 않는다 — 상태 코드로 판정한다.
//   인자를 붙인 요청: 공통 확인이 걸려 있어도 함수를 찾지 못해 먼저 거절될 수 있다. 그래서 그 칸은 상태와 무관하게
//     "회원 정보가 오지 않음(state·profile 없음, 금지 값 없음, 2xx 아님)"으로 판정하고 관측한 상태·코드를 적는다.
//     공통 확인이 실제로 도는지는 유효한 POST 로 본다(일반 회원 → 503, 예외 회원 → 본인 것만) — 결과의 hook_evidence.
//   JWT 만료: 401 이고 오류 문구가 만료를 뜻할 때만 통과. 다른 인증 오류는 미확인.
// 종료 값: 0 = 전부 통과 / 1 = 기대와 다름 또는 미확인이 있음 / 2 = 요청 전에 멈춤(주소·열쇠·자격·인자·로그인 기록) /
//          3 = 기준선 불일치(지문이 --state 와 맞지 않음)
// =====================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = 'hmncdheiwqwekdbtijar';
const TEST_URL = `https://${REF}.supabase.co`;
const ISSUER = `${TEST_URL}/auth/v1`;
const RPC = '/rest/v1/rpc/my_profile';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_KEYS = ['email', 'id', 'name', 'nickname', 'phone', 'timezone'];
const FORBIDDEN_KEYS = ['password', 'role', 'level', 'blocked', 'withdrawal_requested_at', 'withdrawal_reason', 'withdrawal_reason_detail', 'marketing_consent', 'marketing_consent_at', 'intro_book_track', 'pending_book_request', 'created_at', 'updated_at', 'auth_user_id', 'member_id', 'password_migrated', 'password_changed_at', 'renotify_on'];
const STATES = { normal: { maint: false, hook: false }, 'normal-hook': { maint: false, hook: true }, maint: { maint: true, hook: false }, 'maint-hook': { maint: true, hook: true } };
const HOOK_ITEM = 'pgrst.db_pre_request=security_private.check_api_request';
// 자격 이름 → 환경 변수, expect.json 의 계정 이름, 자격에 적혀 있어야 하는 aal
const LOGINS = {
  member_a: { env: 'B3P0_JWT_A', account: 'a' }, member_b: { env: 'B3P0_JWT_B', account: 'b' }, no_map: { env: 'B3P0_JWT_N', account: 'n' },
  admin_g_pre: { env: 'B3P0_JWT_G1', account: 'g', aal: 'aal1' }, admin_g_post: { env: 'B3P0_JWT_G2', account: 'g', aal: 'aal2' },
  admin_gm_pre: { env: 'B3P0_JWT_GM1', account: 'gm', aal: 'aal1' }, admin_gm_post: { env: 'B3P0_JWT_GM2', account: 'gm', aal: 'aal2' },
  blocked: { env: 'B3P0_JWT_BLK', account: 'blk' }, withdrawing: { env: 'B3P0_JWT_WD', account: 'wd' }, blocked_withdrawing: { env: 'B3P0_JWT_BW', account: 'bw' },
  a_expire: { env: 'B3P0_JWT_A_EXP', account: 'a' }, a_logout: { env: 'B3P0_JWT_A_OUT', account: 'a' }, a_old: { env: 'B3P0_JWT_A_OLD', account: 'a' },
};
const MATRIX_ACTORS = ['anon', 'member_a', 'member_b', 'no_map', 'admin_g_pre', 'admin_g_post', 'admin_gm_pre', 'admin_gm_post', 'blocked', 'withdrawing', 'blocked_withdrawing', 'service'];
// 점검 중에 통과하는 자격: 예외 명단의 회원(A), 6자리 확인을 끝낸 관리자
const MAINT_EXEMPT = ['member_a', 'admin_g_post', 'admin_gm_post'];

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const phase = arg('--phase');
let requestCount = 0;
const log = (m) => console.error(`[b3p0] ${m}`);
function stop(code, msg) { log(`멈춤: ${msg}${requestCount === 0 ? ' — 아무 요청도 보내지 않았다' : ''}`); process.exit(code); }

// SQL 통로가 돌려준 결과 파일(한 칸 jsonb)을 읽는다: [{result:{…}}] · {result:{…}} · {…} 를 다 받는다.
function loadResult(path, what) {
  if (!path) stop(2, `${what} 파일이 필요하다`);
  if (!existsSync(path)) stop(2, `${what} 파일이 없다: ${path}`);
  let j;
  try { j = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { stop(2, `${what} 파일을 읽지 못했다(JSON 이 아니다)`); }
  if (Array.isArray(j) && j.length === 1) j = j[0];
  if (j && typeof j === 'object' && j.result && typeof j.result === 'object') j = j.result;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { /* 그대로 */ } }
  return j;
}
function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}
const ageSeconds = (iso) => Math.round((Date.now() - Date.parse(iso)) / 1000);
function writeOut(obj) { const out = arg('--out'); if (out) { writeFileSync(out, JSON.stringify(obj, null, 2), 'utf8'); log(`결과: ${out}`); } }

// ---------------------------------------------------------------------
// 요청 전 확인: 주소·열쇠·자격
const env = process.env;
let anonKey = null;
let serviceKey = null;
const jwts = {};
const jwtInfo = {};
const keyNotes = {};
function checkKey(name, role) {
  const v = env[name];
  if (!v) stop(2, `${name} 이 필요하다`);
  const p = decodeJwtPayload(v);
  if (p) {
    if (p.ref !== REF) stop(2, `${name} 의 ref 가 시험 프로젝트가 아니다`);
    if (p.role !== role) stop(2, `${name} 의 role 이 ${role} 이 아니다`);
    keyNotes[name] = 'jwt: ref·role 확인함';
  } else keyNotes[name] = 'jwt 모양이 아님: 열쇠에서 ref 를 확인하지 못함(주소로만 확인)';
  return v;
}
function checkTarget(needService) {
  if (env.B3P0_URL !== TEST_URL) stop(2, `B3P0_URL 이 정확히 ${TEST_URL} 가 아니다`);
  anonKey = checkKey('B3P0_ANON_KEY', 'anon');
  if (needService) serviceKey = checkKey('B3P0_SERVICE_KEY', 'service_role');
}
function loadLogin(label, expect, { minSeconds = 120, mustBeExpired = false } = {}) {
  const spec = LOGINS[label];
  const tok = env[spec.env];
  if (!tok) stop(2, `${spec.env} 이 필요하다(${label})`);
  const p = decodeJwtPayload(tok);
  if (!p) stop(2, `${spec.env} 가 자격의 모양이 아니다`);
  if (p.iss !== ISSUER) stop(2, `${spec.env} 의 발급자가 시험 프로젝트가 아니다`);
  if (p.role !== 'authenticated') stop(2, `${spec.env} 가 로그인 자격이 아니다`);
  if (!UUID_RE.test(String(p.sub ?? '')) || !UUID_RE.test(String(p.session_id ?? ''))) stop(2, `${spec.env} 에 sub 또는 session_id 가 없다`);
  if (spec.aal && p.aal !== spec.aal) stop(2, `${spec.env} 의 aal 이 ${spec.aal} 이 아니다(${p.aal})`);
  const want = expect.accounts?.[spec.account];
  if (!want) stop(2, `--expect 에 계정 ${spec.account} 가 없다`);
  if (String(want.auth_user_id).toLowerCase() !== String(p.sub).toLowerCase()) stop(2, `${spec.env} 의 계정이 --expect 의 ${spec.account} 계정과 다르다`);
  const left = (p.exp ?? 0) - Math.floor(Date.now() / 1000);
  if (mustBeExpired) { if (left > -5) stop(2, `${spec.env} 가 아직 만료되지 않았다(${left}초 남음). 만료 시각이 지난 뒤에 잴 것`); } else if (left < minSeconds) stop(2, `${spec.env} 의 남은 유효 시간이 ${left}초다(${minSeconds}초 이상이어야 한다). 새로 받을 것`);
  jwts[label] = tok;
  jwtInfo[label] = { sub: p.sub, session_id: p.session_id, aal: p.aal ?? null, seconds_left_at_start: left };
}
function checkDistinctSessions(labels) {
  const seen = {};
  for (const l of labels) { const s = jwtInfo[l].session_id; if (seen[s]) stop(2, `${l} 와 ${seen[s]} 가 같은 로그인 기록의 자격이다. 서로 다른 로그인에서 받을 것`); seen[s] = l; }
}

// 지문이 --state 와 맞는가(도구는 DB 를 읽지 못한다 — 브레인방이 읽어 넘긴 파일을 본다)
function checkFingerprint(fp, { wantFunction, state, expect }) {
  const problems = [];
  const age = fp?.read_at ? ageSeconds(fp.read_at) : NaN;
  if (!Number.isFinite(age)) stop(2, '--fingerprint 파일에 read_at 이 없다(이 폴더의 fingerprint.sql 결과여야 한다)');
  if (age > 1800 || age < -300) stop(2, `--fingerprint 가 ${age}초 전에 읽은 것이다. 재기 직전(30분 안)에 다시 읽을 것`);
  const f = fp.my_profile ?? {};
  if (wantFunction) {
    if (f.exists !== true || Number(f.named_count) !== 1) problems.push(`public.my_profile() 이 없거나 같은 이름의 함수가 ${f.named_count}개다`);
    const e = f.execute ?? {};
    if (!(e.public === false && e.anon === false && e.authenticated === true && e.service_role === false)) problems.push('실행 권한이 authenticated 뿐이 아니다');
    if (f.volatility !== 'v') problems.push('함수가 volatile 이 아니다');
    if (f.security_definer !== true) problems.push('함수가 security definer 가 아니다');
  } else if (f.exists !== false || Number(f.named_count) !== 0) problems.push(`DB 카탈로그에 public.my_profile 이 있다(같은 이름 ${f.named_count}개)`);
  if (fp.check_api_request?.mentions_my_profile !== false) problems.push('공통 확인 함수의 본문에 my_profile 이 있다(예외에 추가하면 안 된다)');
  if (state) {
    const s = STATES[state];
    const phaseNow = fp.site_state?.phase;
    if ((s.maint ? 'maintenance' : 'normal') !== phaseNow) problems.push(`점검 상태가 ${phaseNow} 이다(--state ${state} 는 ${s.maint ? 'maintenance' : 'normal'})`);
    const hooks = Array.isArray(fp.pre_request) ? fp.pre_request : [];
    if (s.hook ? !(hooks.length === 1 && hooks[0] === HOOK_ITEM) : hooks.length !== 0) problems.push(`공통 확인 설정이 --state ${state} 와 다르다(지금 ${hooks.length ? hooks.join(', ') : '없음'})`);
    if (s.maint) {
      const mid = fp.site_state?.maintenance_id;
      const live = (fp.maintenance_exception?.rows ?? []).filter((r) => r.maintenance_id === mid && (r.expires_at == null || Date.parse(r.expires_at) > Date.now())).map((r) => String(r.auth_user_id).toLowerCase());
      const idOf = (acc) => String(expect.accounts[acc].auth_user_id).toLowerCase();
      if (!live.includes(idOf('a'))) problems.push('예외 명단에 회원 A 의 계정이 없다(점검 중 예외 회원이 A 여야 한다)');
      for (const acc of ['b', 'n', 'g', 'gm', 'blk', 'wd', 'bw']) if (live.includes(idOf(acc))) problems.push(`예외 명단에 ${acc} 의 계정이 있다(예외는 A 만이어야 한다)`);
    }
  }
  return { read_at: fp.read_at, seconds_before_this_run: age, problems, body_md5: f.body_md5 ?? null, def_md5: f.def_md5 ?? null, oid: f.oid ?? null, site_state: fp.site_state ?? null, pre_request: fp.pre_request ?? null };
}

// 로그인 기록 확인. want[label] = 'alive' | 'expired'(행은 있고 not_after 가 지남) | 'gone'(행이 없음)
function checkSessions(path, want) {
  const f = loadResult(path, '--sessions-alive');
  const rowsIn = Array.isArray(f) ? f : f?.sessions;
  if (!Array.isArray(rowsIn)) stop(2, '--sessions-alive 파일에 sessions 가 없다(sessions-sql 단계가 적어 준 SQL 의 결과여야 한다)');
  const age = f?.read_at ? ageSeconds(f.read_at) : NaN;
  if (!Number.isFinite(age)) stop(2, '--sessions-alive 파일에 read_at 이 없다');
  if (age > 1800 || age < -300) stop(2, `--sessions-alive 가 ${age}초 전에 읽은 것이다. 재기 직전(30분 안)에 다시 읽을 것`);
  const out = [];
  const bad = [];
  for (const [label, need] of Object.entries(want)) {
    const j = jwtInfo[label];
    const row = rowsIn.find((x) => String(x.session_id ?? x.id) === j.session_id);
    const alive = row ? row.alive === true || (row.alive == null && (row.not_after == null || Date.parse(row.not_after) > Date.now())) : null;
    out.push({ credential: label, account: j.sub, session_id: j.session_id, aal_in_credential: j.aal, wanted: need, record_found: !!row, record_account: row ? String(row.user_id) : null, record_aal: row ? String(row.aal) : null, not_after: row ? row.not_after ?? null : null, alive });
    if (need === 'gone') { if (row) bad.push(`${label}: 로그인 기록이 아직 있다(로그아웃 뒤에는 없어야 한다)`); continue; }
    if (!row) { bad.push(`${label}: 로그인 기록이 없다`); continue; }
    if (String(row.user_id).toLowerCase() !== String(j.sub).toLowerCase()) bad.push(`${label}: 로그인 기록의 계정이 자격의 계정과 다르다`);
    else if (need === 'alive' && !alive) bad.push(`${label}: 로그인 기록이 만료됐다(not_after ${row.not_after})`);
    else if (need === 'expired' && alive) bad.push(`${label}: 로그인 기록이 아직 살아 있다(not_after 를 과거로 바꾼 뒤여야 한다)`);
    else if (need === 'alive' && String(row.aal) !== String(j.aal)) bad.push(`${label}: 로그인 기록의 aal(${row.aal})이 자격의 aal(${j.aal})과 다르다`);
  }
  if (bad.length) stop(2, `로그인 기록 확인에서 어긋남 — ${bad.join(' / ')}`);
  return { source: '브레인방이 DB 에서 읽어 넘긴 파일(--sessions-alive)', read_at: f.read_at, seconds_before_this_run: age, credentials: out };
}

// ---------------------------------------------------------------------
// 요청
function authFor(actor) {
  if (actor === 'anon') return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  if (actor === 'service') return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  return { apikey: anonKey, Authorization: `Bearer ${jwts[actor]}` };
}
async function call(actor, method, bodyObj) {
  requestCount++;
  const headers = { ...authFor(actor), Accept: 'application/json' };
  let body;
  if (method === 'POST') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(bodyObj ?? {}); }
  try {
    const res = await fetch(TEST_URL + RPC, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = undefined; } // undefined = 본문이 JSON 이 아님
    return { status: res.status, text, json, cacheControl: res.headers.get('cache-control'), contentType: res.headers.get('content-type'), netError: null };
  } catch (e) {
    return { status: 0, text: '', json: null, cacheControl: null, contentType: null, netError: `${String(e?.name ?? 'Error')}` };
  }
}

// 금지 값 목록: [{ who, field, value }]
function forbiddenValues(expect) {
  const out = [];
  for (const [acc, a] of Object.entries(expect.accounts ?? {})) {
    out.push({ who: acc, field: 'auth_user_id', value: a.auth_user_id });
    for (const k of ['id', 'name', 'nickname', 'email', 'phone']) if (a.member && a.member[k] != null) out.push({ who: acc, field: `member.${k}`, value: a.member[k] });
    if (a.password_column_marker) out.push({ who: acc, field: 'password_column_marker', value: a.password_column_marker });
    for (const w of a.withdrawal_markers ?? []) if (w) out.push({ who: acc, field: 'withdrawal_marker', value: w });
  }
  // 함정 행: 회원번호가 대응 없는 계정 n 의 로그인 계정 번호와 같은 회원 행. 어느 응답에도 나오면 안 된다
  // (id 는 n 의 auth_user_id 와 같은 값이라 위에서 이미 들어갔다)
  if (expect.trap) for (const k of ['name', 'nickname', 'email', 'phone', 'password_column_marker']) if (expect.trap[k] != null) out.push({ who: 'trap', field: k, value: expect.trap[k] });
  return out.filter((x) => typeof x.value === 'string' && x.value.length >= 6);
}
function collectStringsAndKeys(v, strings, keys) {
  if (typeof v === 'string') strings.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStringsAndKeys(x, strings, keys));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); collectStringsAndKeys(x, strings, keys); }
}
// 응답 어디에도 금지 키·금지 값이 없는가. allowed = 이 칸에서 허용하는 값(본인의 여섯 값)
function leakProblems(res, forbidden, allowed) {
  const problems = [];
  const strings = [];
  const keys = [];
  if (res.json && typeof res.json === 'object') collectStringsAndKeys(res.json, strings, keys);
  const hay = (res.text ?? '') + '\n' + strings.join('\n');
  const lower = hay.toLowerCase();
  for (const k of FORBIDDEN_KEYS) if (keys.includes(k)) problems.push(`금지 키가 응답에 있다: ${k}`);
  if (lower.includes('password')) problems.push('응답 본문에 password 라는 글자가 있다');
  for (const f of forbidden) {
    if (allowed.has(f.value)) continue;
    if (hay.includes(f.value) || lower.includes(String(f.value).toLowerCase())) problems.push(`금지 값이 응답에 있다: ${f.who}.${f.field}`);
  }
  return problems;
}
const normCache = (v) => (v == null ? null : String(v).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).sort().join(', '));
const sameKeys = (obj, want) => obj && typeof obj === 'object' && !Array.isArray(obj) && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...want].sort());

// 기대값: { kind, … }
//   ok(account) · state_only(state) · maintenance · no_execute · method · no_execute_or_method · not_found_fn(absent 단계) ·
//   args_no_profile(인자를 붙인 요청) · jwt_expired
function expectFor(stateName, actor, method, withArgs) {
  const s = STATES[stateName];
  const outside = actor === 'anon' || actor === 'service';
  const exempt = MAINT_EXEMPT.includes(actor);
  // 인자를 붙인 요청은 점검·공통 확인의 상태와 떼어 판정한다(함수를 찾지 못해 먼저 거절될 수도, 공통 확인이 먼저 거절할 수도 있다)
  if (withArgs) return { kind: 'args_no_profile', why: '인자 없는 함수다 — 인자를 붙이면 어느 쪽이 먼저 거절하든 회원 정보가 오지 않아야 한다' };
  if (s.maint && s.hook && !exempt) return { kind: 'maintenance', why: '공통 확인이 먼저 거절한다(점검 중, 예외가 아님)' };
  if (method !== 'POST') return outside ? { kind: 'no_execute_or_method', why: '실행 권한이 없거나 POST 가 아니라서 거절' } : { kind: 'method', why: 'POST 가 아니면 거절(405)' };
  if (outside) return { kind: 'no_execute', why: '실행 권한이 없다' };
  if (s.maint && !exempt) return { kind: 'maintenance', why: '함수가 회원 행을 읽기 전에 점검을 확인해 거절한다' };
  switch (actor) {
    case 'member_a': return { kind: 'ok', account: 'a' };
    case 'member_b': return { kind: 'ok', account: 'b' };
    case 'admin_gm_pre': case 'admin_gm_post': return { kind: 'ok', account: 'gm' };
    case 'no_map': case 'admin_g_pre': case 'admin_g_post': return { kind: 'state_only', state: 'no_member' };
    case 'blocked': case 'blocked_withdrawing': return { kind: 'state_only', state: 'blocked' };
    case 'withdrawing': return { kind: 'state_only', state: 'withdrawal_pending' };
    default: return { kind: 'unknown' };
  }
}
function describeExpect(e) {
  switch (e.kind) {
    case 'ok': return `200 {"state":"ok","profile":{여섯 열}} — ${e.account} 본인의 값, Cache-Control private, no-store`;
    case 'state_only': return `200 {"state":"${e.state}"} 뿐, Cache-Control private, no-store`;
    case 'maintenance': return '503 (code PT503 · message maintenance), 회원 정보 없음';
    case 'no_execute': return '401 또는 403 (code 42501 — 실행 권한 없음)';
    case 'method': return '405 (거절 상태)';
    case 'no_execute_or_method': return '401·403(42501) 또는 405 (거절 상태)';
    case 'not_found_fn': return '404 (code PGRST202 — 등록되지 않은 함수)';
    case 'args_no_profile': return '거절이고 회원 정보 없음(state·profile 없음) — 관측한 상태·코드를 적는다(404·PGRST202 또는 503·PT503 등)';
    case 'jwt_expired': return '401 이고 오류의 사유가 만료(함수에 들어오기 전 거절 — 함수의 응답 아님). 다른 인증 오류는 미확인';
    default: return '?';
  }
}
function judge(expected, res, method, expect, forbidden) {
  const out = { http_status: res.status, code: null, cache_control: res.cacheControl, body_state: null, body_keys: null, profile_keys: null, body_length: (res.text ?? '').length, verdict: 'pass', problems: [] };
  if (res.netError) { out.verdict = 'unverified'; out.problems.push(`요청 오류(${res.netError})`); return out; }
  const j = res.json;
  const isObj = j && typeof j === 'object' && !Array.isArray(j);
  if (isObj) { out.body_keys = Object.keys(j).sort(); out.code = j.code != null ? String(j.code).slice(0, 16) : null; out.body_state = typeof j.state === 'string' ? j.state : null; if (j.profile && typeof j.profile === 'object') out.profile_keys = Object.keys(j.profile).sort(); }
  const bad = (m) => out.problems.push(m);
  const allowed = new Set();
  const hasProfile = isObj && ('state' in j || 'profile' in j);
  const expectsBody = expected.kind === 'ok' || expected.kind === 'state_only';
  if (!expectsBody && res.status === 429) { out.verdict = 'unverified'; bad('429 — 요청 한도'); }
  const maintenanceShape = res.status === 503 && (method === 'HEAD' || out.code === 'PT503');
  if (!expectsBody && res.status >= 500 && !((expected.kind === 'maintenance' && res.status === 503) || (expected.kind === 'args_no_profile' && maintenanceShape))) { out.verdict = 'unverified'; bad(`기대하지 않은 ${res.status}`); }
  switch (expected.kind) {
    case 'ok': {
      const want = expect.accounts[expected.account].member;
      for (const k of PROFILE_KEYS) if (typeof want[k] === 'string') allowed.add(want[k]); // 본인의 여섯 값은 이 칸에서 허용
      if (res.status !== 200) { bad(`상태 ${res.status} (기대 200)`); if (res.status === 429 || res.status >= 500) out.verdict = 'unverified'; break; }
      if (!sameKeys(j, ['state', 'profile'])) bad(`응답의 키가 정확히 state·profile 이 아니다(${JSON.stringify(out.body_keys)})`);
      if (!isObj || j.state !== 'ok') bad(`state 가 ok 가 아니다(${out.body_state})`);
      if (!isObj || !sameKeys(j.profile, PROFILE_KEYS)) bad(`profile 의 키가 정확히 여섯 개가 아니다(${JSON.stringify(out.profile_keys)})`);
      else for (const k of PROFILE_KEYS) if (j.profile[k] !== (want[k] ?? null)) bad(`profile.${k} 의 값이 합성 회원의 값과 다르다`);
      if (normCache(res.cacheControl) !== 'no-store, private') bad(`Cache-Control 이 private, no-store 가 아니다(${res.cacheControl ?? '없음'})`);
      break;
    }
    case 'state_only':
      if (res.status !== 200) { bad(`상태 ${res.status} (기대 200)`); if (res.status === 429 || res.status >= 500) out.verdict = 'unverified'; break; }
      if (!sameKeys(j, ['state'])) bad(`응답의 키가 정확히 state 하나가 아니다(${JSON.stringify(out.body_keys)})`);
      if (!isObj || j.state !== expected.state) bad(`state 가 ${expected.state} 가 아니다(${out.body_state})`);
      if (normCache(res.cacheControl) !== 'no-store, private') bad(`Cache-Control 이 private, no-store 가 아니다(${res.cacheControl ?? '없음'})`);
      break;
    case 'maintenance':
      if (res.status !== 503) bad(`상태 ${res.status} (기대 503)`);
      if (method !== 'HEAD' && res.status === 503) { if (out.code !== 'PT503') bad(`code 가 PT503 이 아니다(${out.code})`); out.message_is_maintenance = isObj && j.message === 'maintenance'; if (!out.message_is_maintenance) bad('message 가 maintenance 가 아니다'); }
      if (hasProfile) bad('거절인데 state·profile 이 응답에 있다');
      break;
    case 'no_execute':
      if (res.status !== 401 && res.status !== 403) bad(`상태 ${res.status} (기대 401 또는 403)`);
      else if (out.code !== '42501') bad(`code 가 42501 이 아니다(${out.code})`);
      if (hasProfile) bad('거절인데 state·profile 이 응답에 있다');
      break;
    case 'method':
      if (res.status !== 405) bad(`상태 ${res.status} (기대 405 — 거절 상태)`);
      out.rejected_by = out.code === 'PT405' ? '함수 안의 확인(PT405)' : method === 'HEAD' ? '본문이 없어 알 수 없다' : `PostgREST(code ${out.code})`;
      if (hasProfile) bad('거절인데 state·profile 이 응답에 있다');
      break;
    case 'no_execute_or_method':
      if (![401, 403, 405].includes(res.status)) bad(`상태 ${res.status} (기대 401·403·405 — 거절 상태)`);
      if (hasProfile) bad('거절인데 state·profile 이 응답에 있다');
      break;
    case 'not_found_fn':
      if (res.status !== 404) bad(`상태 ${res.status} (기대 404)`);
      else if (out.code !== 'PGRST202') bad(`code 가 PGRST202 가 아니다(${out.code}) — 일반 404 는 "등록되지 않은 함수"의 증거가 아니다`);
      if (hasProfile) bad('함수를 찾지 못해야 하는데 state·profile 이 응답에 있다');
      break;
    case 'args_no_profile':
      // 어느 쪽이 먼저 거절했는지는 기대값이 아니라 관측이다
      out.observed = res.status === 404 && out.code === 'PGRST202' ? '함수를 찾지 못함(404·PGRST202)' : maintenanceShape ? '점검 거절(503·PT503)' : `그 밖(${res.status}·${out.code})`;
      if (hasProfile) bad('인자를 붙였는데 state·profile 이 응답에 있다(함수가 실행됐다)');
      else if (res.status >= 200 && res.status < 400) { out.verdict = 'unverified'; bad(`거절이 아니라 ${res.status} — 무엇이 실행됐는지 확인할 것`); }
      break;
    case 'jwt_expired': {
      // 만료를 뜻하는 사유일 때만 통과. 오류 문구는 고정된 안내문이라 앞 80자를 적는다(자격·회원 값이 아니다)
      const msg = isObj && typeof j.message === 'string' ? j.message : '';
      out.observed_message = msg.slice(0, 80);
      out.reason_is_expiry = /expired/i.test(msg);
      if (hasProfile) bad('함수에 들어오기 전에 거절돼야 하는데 state·profile 이 응답에 있다');
      else if (res.status === 200) bad('만료된 JWT 인데 200 이다');
      else if (res.status !== 401) { out.verdict = 'unverified'; bad(`상태 ${res.status} (기대 401) — 만료로 거절된 것인지 확인하지 못했다`); }
      else if (!out.reason_is_expiry) { out.verdict = 'unverified'; bad(`401 이지만 오류의 사유가 만료가 아니다(code ${out.code}) — 다른 인증 오류는 미확인이다`); }
      break;
    }
    default: bad('기대값을 정하지 못했다');
  }
  const leaks = leakProblems(res, forbidden, allowed);
  out.leaks = leaks.length;
  out.problems.push(...leaks);
  if (leaks.length) out.verdict = 'mismatch'; // 금지 값이 실렸으면 다른 사정과 관계없이 실패다
  else if (out.problems.length && out.verdict !== 'unverified') out.verdict = 'mismatch';
  return out;
}
function summarize(cells) {
  const count = (v) => cells.filter((c) => c.verdict === v).length;
  const by = {};
  for (const c of cells) { by[c.actor] = by[c.actor] ?? { pass: 0, mismatch: 0, unverified: 0 }; by[c.actor][c.verdict]++; }
  return { cells: cells.length, pass: count('pass'), mismatch: count('mismatch'), unverified: count('unverified'), leaks: cells.reduce((a, c) => a + (c.leaks ?? 0), 0), cache_control_wrong: cells.filter((c) => c.problems.some((p) => p.startsWith('Cache-Control'))).length, by_actor: by };
}
function finish(result, cells) {
  result.request_count = requestCount;
  result.summary = summarize(cells);
  result.cells = cells;
  result.mismatches = cells.filter((c) => c.verdict === 'mismatch').map((c) => ({ no: c.no, actor: c.actor, request: c.request, expect: c.expect_text, http_status: c.http_status, problems: c.problems }));
  result.undetermined = cells.filter((c) => c.verdict === 'unverified').map((c) => ({ no: c.no, actor: c.actor, request: c.request, problems: c.problems }));
  result.finished_at = new Date().toISOString();
  writeOut(result);
  const s = result.summary;
  log(`phase=${result.phase}${result.state ? ' state=' + result.state : ''}${result.kind ? ` kind=${result.kind} step=${result.step ?? '-'}` : ''} 요청 ${requestCount}건 — 통과 ${s.pass} · 기대와 다름 ${s.mismatch} · 미확인 ${s.unverified} · 금지 키·값 ${s.leaks}`);
  for (const m of result.mismatches.slice(0, 12)) log(`  기대와 다름 #${m.no} ${m.actor} ${m.request}: ${m.problems.join(' / ')}`);
  for (const m of result.undetermined.slice(0, 6)) log(`  미확인 #${m.no} ${m.actor} ${m.request}: ${m.problems.join(' / ')}`);
  return s.mismatch === 0 && s.unverified === 0 ? 0 : 1;
}
const credentialsOut = () => Object.fromEntries(Object.entries(jwtInfo).map(([k, v]) => [k, { sub: v.sub, session_id: v.session_id, aal: v.aal, seconds_left_at_start: v.seconds_left_at_start }]));
function baseResult(extra) { return { tool: 'b3p0 profile_matrix.mjs', target: TEST_URL, rpc: RPC, started_at: new Date().toISOString(), key_check: keyNotes, ...extra }; }

// 칸 목록(상태별)
function matrixRows(stateName, actors, expect) {
  const rows = [];
  for (const actor of actors) for (const method of ['POST', 'GET', 'HEAD']) rows.push({ actor, method, request: method === 'POST' ? 'POST {}' : method, args: null });
  const a = expect?.accounts?.a?.member;
  const b = expect?.accounts?.b?.member;
  const argRows = [
    { actor: 'member_a', request: 'POST {"member_id": <B 의 회원번호>}', args: () => ({ member_id: b.id }) },
    { actor: 'member_a', request: 'POST {"id": <B 의 회원번호>}', args: () => ({ id: b.id }) },
    { actor: 'member_a', request: 'POST {"email": <B 의 이메일>}', args: () => ({ email: b.email }) },
    { actor: 'member_b', request: 'POST {"id": <A 의 회원번호>}', args: () => ({ id: a.id }) },
  ];
  for (const r of argRows) if (actors.includes(r.actor)) rows.push({ ...r, method: 'POST' });
  return rows.map((r, i) => ({ no: i + 1, ...r, expected: expectFor(stateName, r.actor, r.method, !!r.args) }));
}

// ---------------------------------------------------------------------
function phasePlan() {
  const state = arg('--state') ?? 'normal';
  if (!STATES[state]) stop(2, '--state 는 normal | normal-hook | maint | maint-hook');
  const rows = matrixRows(state, MATRIX_ACTORS, null);
  for (const r of rows) console.log(`${String(r.no).padStart(2)}  ${r.actor.padEnd(20)} ${r.request.padEnd(38)} → ${describeExpect(r.expected)}`);
  writeOut({ tool: 'b3p0 profile_matrix.mjs', phase: 'plan', state, rows: rows.map((r) => ({ no: r.no, actor: r.actor, request: r.request, expect: describeExpect(r.expected), why: r.expected.why ?? null })), request_count: 0 });
  log(`phase=plan state=${state} 요청 0건 — ${rows.length}칸`);
  return 0;
}
function phaseSessionsSql() {
  const found = [];
  for (const [label, spec] of Object.entries(LOGINS)) {
    const p = env[spec.env] ? decodeJwtPayload(env[spec.env]) : null;
    if (!p || !UUID_RE.test(String(p.sub ?? '')) || !UUID_RE.test(String(p.session_id ?? ''))) continue;
    found.push({ env: spec.env, credential: label, sub: p.sub, session_id: p.session_id, aal_in_credential: p.aal ?? null });
  }
  if (!found.length) stop(2, '환경 변수에 로그인 자격이 하나도 없다');
  const sql = [
    '-- 읽기만: 이 로그인 기록들이 지금 살아 있는가(계정·aal·만료). 결과를 파일로 저장해 --sessions-alive 로 넘긴다.',
    'select pg_catalog.jsonb_build_object(',
    "  'read_at', pg_catalog.now(),",
    "  'sessions', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(",
    "     'session_id', s.id, 'user_id', s.user_id, 'aal', s.aal, 'not_after', s.not_after,",
    "     'alive', (s.not_after is null or s.not_after > pg_catalog.now())) order by s.created_at), '[]'::pg_catalog.jsonb)",
    ') as result',
    '  from auth.sessions s',
    ' where s.id in (',
    found.map((f) => `   '${f.session_id}'::uuid`).join(',\n'),
    ' );',
  ].join('\n');
  console.log(sql);
  writeOut({ tool: 'b3p0 profile_matrix.mjs', phase: 'sessions-sql', request_count: 0, credentials: found, sql, note: 'session_id·sub 는 식별값이다(자격이 아니다)' });
  log(`phase=sessions-sql 요청 0건 — 자격 ${found.length}개`);
  return 0;
}
async function phaseAbsent() {
  const expect = loadResult(arg('--expect'), '--expect');
  checkTarget(true);
  loadLogin('member_a', expect);
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunction: false });
  const result = baseResult({ phase: 'absent', rule: '통과 = DB 카탈로그에 그 함수가 없음(지문) + 그 RPC 가 404·code PGRST202("등록되지 않은 함수")로 응답함, 둘 다. 일반 404 만으로는 통과가 아니다', fingerprint_check: fpCheck, credentials: credentialsOut() });
  const forbidden = forbiddenValues(expect);
  const cells = [];
  let no = 0;
  for (const actor of ['member_a', 'anon', 'service']) {
    const res = await call(actor, 'POST', {});
    const j = judge({ kind: 'not_found_fn' }, res, 'POST', expect, forbidden);
    if (fpCheck.problems.length) { j.verdict = 'mismatch'; j.problems.push(...fpCheck.problems.map((p) => `지문: ${p}`)); }
    cells.push({ no: ++no, actor, method: 'POST', request: 'POST {}', expect_text: describeExpect({ kind: 'not_found_fn' }) + ' + 지문에 함수 없음', ...j });
  }
  return finish(result, cells);
}
async function phaseMatrix() {
  const state = arg('--state');
  if (!STATES[state]) stop(2, '--state 는 normal | normal-hook | maint | maint-hook');
  const actors = arg('--actors') ? arg('--actors').split(',').map((s) => s.trim()) : MATRIX_ACTORS;
  for (const a of actors) if (!MATRIX_ACTORS.includes(a)) stop(2, `모르는 자격: ${a}`);
  const expect = loadResult(arg('--expect'), '--expect');
  checkTarget(actors.includes('service'));
  const logins = actors.filter((a) => LOGINS[a]);
  const needForArgs = ['member_a', 'member_b'].filter((a) => actors.includes(a));
  for (const l of logins) loadLogin(l, expect);
  checkDistinctSessions(logins);
  for (const acc of ['a', 'b']) if (!expect.accounts?.[acc]?.member) stop(2, `--expect 에 ${acc} 의 회원 값이 없다`);
  if (!expect.trap?.id || String(expect.trap.id).toLowerCase() !== String(expect.accounts?.n?.auth_user_id).toLowerCase()) stop(2, '--expect 에 함정 행이 없거나, 그 회원번호가 계정 n 의 로그인 계정 번호와 다르다(fixtures_up.sql 의 결과여야 한다)');
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunction: true, state, expect });
  if (fpCheck.problems.length) { writeOut(baseResult({ phase: 'matrix', state, stopped: '기준선 불일치', fingerprint_check: fpCheck, request_count: 0 })); stop(3, `기준선 불일치 — ${fpCheck.problems.join(' / ')}`); }
  const sessionCheck = logins.length ? checkSessions(arg('--sessions-alive'), Object.fromEntries(logins.map((l) => [l, 'alive']))) : null;
  const result = baseResult({ phase: 'matrix', state, state_meaning: STATES[state], actors, fingerprint_check: fpCheck, session_check: sessionCheck, credentials: credentialsOut(), maintenance_exempt: STATES[state].maint ? MAINT_EXEMPT : null, args_rows_for: needForArgs });
  const forbidden = forbiddenValues(expect);
  const cells = [];
  for (const row of matrixRows(state, actors, expect)) {
    const res = await call(row.actor, row.method, row.args ? row.args() : {});
    cells.push({ no: row.no, actor: row.actor, method: row.method, request: row.request, expect_kind: row.expected.kind, expect_text: describeExpect(row.expected), why: row.expected.why ?? null, ...judge(row.expected, res, row.method, expect, forbidden) });
  }
  // 공통 확인이 실제로 도는가는 유효한 POST 로 본다(인자를 붙인 요청으로 보지 않는다)
  const post = (actor) => cells.find((c) => c.actor === actor && c.request === 'POST {}');
  const is503 = (c) => !!c && c.verdict === 'pass' && c.http_status === 503;
  const s = STATES[state];
  result.hook_evidence = !s.hook ? null : !s.maint
    ? { note: '점검이 꺼진 상태에서는 공통 확인이 전부 통과시킨다 — 도는지의 입증은 maint-hook 에서 한다' }
    : {
      rule: '유효한 POST {} 로 본다: 일반 회원 → 503, 예외 회원 → 본인 것만',
      general_member_post_is_503: actors.includes('member_b') ? is503(post('member_b')) : null,
      exempt_member_gets_own_profile_only: actors.includes('member_a') ? (() => { const c = post('member_a'); return !!c && c.verdict === 'pass' && c.body_state === 'ok'; })() : null,
      // 함수 안의 점검 확인만으로는 공개 키·서비스 열쇠가 401·403 이다(maint). 여기서 503 이면 공통 확인이 함수보다 먼저 돈 것이다
      outside_roles_post_is_503: ['anon', 'service'].filter((a) => actors.includes(a)).every((a) => is503(post(a))),
    };
  return finish(result, cells);
}
async function phaseRevoked() {
  const kind = arg('--kind');
  const step = arg('--step');
  if (!['expired', 'loggedout', 'jwt-expired'].includes(kind)) stop(2, '--kind 는 expired | loggedout | jwt-expired');
  if (kind !== 'jwt-expired' && !['pre', 'post', 'restored'].includes(step)) stop(2, '--step 은 pre | post | restored');
  if (kind === 'jwt-expired' && !['pre', 'post'].includes(step)) stop(2, '--kind jwt-expired 의 --step 은 pre(만료 전) | post(만료 뒤)');
  if (kind === 'loggedout' && step === 'restored') stop(2, '로그아웃은 되돌릴 수 없다(--step restored 는 expired 에만)');
  const expect = loadResult(arg('--expect'), '--expect');
  checkTarget(false);
  const subject = kind === 'expired' ? 'a_expire' : kind === 'loggedout' ? 'a_logout' : 'a_old';
  const jwtPost = kind === 'jwt-expired' && step === 'post';
  loadLogin('member_a', expect);
  // JWT 는 유효해야 한다(로그인 기록이 끝난 것과 JWT 만료를 가르려면). jwt-expired 의 post 는 반대로 만료돼 있어야 한다.
  loadLogin(subject, expect, jwtPost ? { mustBeExpired: true } : { minSeconds: kind === 'jwt-expired' ? 20 : 120 });
  checkDistinctSessions(['member_a', subject]);
  // 같은 JWT 인지 가르는 지문: 글자의 sha256 앞 12자와 만료 시각(자격 글자는 적지 않는다)
  const subjectFingerprint = { sha256_12: createHash('sha256').update(jwts[subject], 'utf8').digest('hex').slice(0, 12), exp: decodeJwtPayload(jwts[subject]).exp ?? null, session_id: jwtInfo[subject].session_id };
  let pairCheck = null;
  if (jwtPost) {
    // 한 쌍의 앞쪽: 같은 JWT 로 만료 전에 성공했다는 결과 파일
    const pre = loadResult(arg('--pre'), '--pre(만료 전에 같은 JWT 로 쟰 jwt-expired pre 의 결과)');
    const preCell = (pre.cells ?? []).find((c) => c.actor === 'a_old');
    if (pre.phase !== 'revoked' || pre.kind !== 'jwt-expired' || pre.step !== 'pre') stop(2, '--pre 파일이 jwt-expired pre 의 결과가 아니다');
    if (!preCell || preCell.verdict !== 'pass' || preCell.body_state !== 'ok') stop(2, '--pre 의 그 자격 칸이 통과(ok)가 아니다 — 만료 전 성공이 없으면 한 쌍이 되지 않는다');
    const f = pre.subject_jwt ?? {};
    if (f.sha256_12 !== subjectFingerprint.sha256_12 || f.exp !== subjectFingerprint.exp || f.session_id !== subjectFingerprint.session_id) stop(2, '지금의 B3P0_JWT_A_OLD 가 --pre 때의 JWT 와 같은 글자가 아니다. 같은 JWT 로 만료 전·후를 재야 한다');
    pairCheck = { same_jwt_as_pre: true, pre_finished_at: pre.finished_at ?? null, pre_state: preCell.body_state, pre_http_status: preCell.http_status };
  }
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunction: true, state: 'normal', expect });
  if (fpCheck.problems.length) stop(3, `기준선 불일치 — ${fpCheck.problems.join(' / ')}`);
  const want = { member_a: 'alive' };
  // jwt-expired 는 앞뒤 모두 로그인 기록이 살아 있어야 한다(거절이 기록 종료가 아니라 JWT 만료 때문임을 가르려면)
  want[subject] = kind === 'jwt-expired' ? 'alive' : step === 'post' ? (kind === 'expired' ? 'expired' : 'gone') : 'alive';
  const sessionCheck = checkSessions(arg('--sessions-alive'), want);
  const subjectExpect = jwtPost ? { kind: 'jwt_expired' } : kind !== 'jwt-expired' && step === 'post' ? { kind: 'state_only', state: 'no_member' } : { kind: 'ok', account: 'a' };
  const result = baseResult({
    phase: 'revoked', kind, step: step ?? null, fingerprint_check: fpCheck, session_check: sessionCheck, credentials: credentialsOut(),
    subject_jwt: subjectFingerprint, pair_check: pairCheck,
    meaning: jwtPost ? 'JWT 자체가 만료됐다(로그인 기록은 살아 있다) — 같은 JWT 가 만료 전에는 ok 였고(pre), 만료 뒤에는 만료를 사유로 함수에 들어오기 전에 거절된다' : kind === 'jwt-expired' ? '한 쌍의 앞쪽: 이 JWT 로 만료 전에 본인 정보가 온다. 같은 JWT 를 만료 시각이 지난 뒤 --step post --pre <이 결과> 로 다시 잰다' : step === 'post' ? `JWT 는 유효한데 로그인 기록이 ${kind === 'expired' ? 'not_after 만료로' : '로그아웃으로'} 끝났다 — 함수가 no_member 를 돌려준다` : '로그인 기록이 살아 있다 — 본인 정보가 온다',
  });
  const forbidden = forbiddenValues(expect);
  const cells = [];
  const one = async (no, actor, exp, label) => { const res = await call(actor, 'POST', {}); cells.push({ no, actor, method: 'POST', request: `POST {} (${label})`, expect_kind: exp.kind, expect_text: describeExpect(exp), ...judge(exp, res, 'POST', expect, forbidden) }); };
  await one(1, subject, subjectExpect, '재는 자격');
  await one(2, 'member_a', { kind: 'ok', account: 'a' }, '같은 때의 대조군: A 의 평소 로그인');
  result.subject_seconds_left_at_end = (decodeJwtPayload(jwts[subject]).exp ?? 0) - Math.floor(Date.now() / 1000);
  return finish(result, cells);
}
// 두 JSON 을 견준다(ignore 에 적힌 키는 어디에 있든 뺀다)
function diffJson(a, b, ignore, path = '') {
  const out = [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { if (ignore.includes(k)) continue; out.push(...diffJson(a[k], b[k], ignore, path ? `${path}.${k}` : k)); }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path || '(전체)');
  return out;
}
function phaseCompare(kindOfCompare) {
  const [pa, pb] = kindOfCompare === 'rows' ? [arg('--before'), arg('--after')] : [arg('--a'), arg('--b')];
  const a = loadResult(pa, kindOfCompare === 'rows' ? '--before' : '--a');
  const b = loadResult(pb, kindOfCompare === 'rows' ? '--after' : '--b');
  const ignore = ['read_at', ...(arg('--ignore') ? arg('--ignore').split(',').map((s) => s.trim()) : [])];
  const differences = diffJson(a, b, ignore);
  const result = { tool: 'b3p0 profile_matrix.mjs', phase: kindOfCompare === 'rows' ? 'rows-compare' : 'compare', request_count: 0, ignored_keys: ignore, same: differences.length === 0, differences };
  if (kindOfCompare === 'rows') {
    result.synthetic_user_rows = Array.isArray(a.users) ? a.users.length : null;
    result.note = '대조표 전체의 앞뒤 불변: 대조표를 재기 전과 다 잰 뒤에 뜬 합성 회원 행·대응 행의 md5 와 회원 표·대응표·명부 전체의 md5 가 같은가. 호출 하나하나가 아무것도 고치지 않았다는 증거는 아니다(사이에 고쳐졌다가 되돌려진 것은 이 비교로 보이지 않는다)';
    if (!Array.isArray(a.users) || a.users.length === 0) { result.same = false; result.differences.push('앞 결과에 합성 회원 행이 없다(견줄 것이 없다)'); }
  }
  writeOut(result);
  log(`phase=${result.phase} 요청 0건 — ${result.same ? '같음' : '다름: ' + result.differences.slice(0, 12).join(', ')}`);
  return result.same ? 0 : 1;
}
export function bodyMd5OfMigration(path) {
  const t = readFileSync(path, 'utf8');
  const tag = '$' + 'b3_0' + '$';
  const i = t.indexOf('as ' + tag);
  const j = t.indexOf(tag + ';', i + 3 + tag.length);
  if (i < 0 || j < 0) return null;
  const body = t.slice(i + 3 + tag.length, j).replace(/\r/g, '');
  return createHash('md5').update(body, 'utf8').digest('hex');
}
function phaseBodyMd5() {
  const path = arg('--migration') ?? join(HERE, '..', '..', 'migrations', '20261124033800_b3_0_my_profile.sql');
  if (!existsSync(path)) stop(2, `마이그레이션 파일이 없다: ${path}`);
  const md5 = bodyMd5OfMigration(path);
  if (!md5) stop(2, '마이그레이션 파일에서 함수 본문을 찾지 못했다');
  console.log(md5);
  writeOut({ tool: 'b3p0 profile_matrix.mjs', phase: 'body-md5', request_count: 0, migration: path, body_md5: md5, note: '본문에서 줄 끝의 CR 을 뺀 글자의 md5. 지문의 my_profile.body_md5, 되돌리기 SQL 안의 값과 같아야 한다' });
  log(`phase=body-md5 요청 0건 — ${md5}`);
  return 0;
}

const PHASES = { plan: phasePlan, 'sessions-sql': phaseSessionsSql, absent: phaseAbsent, matrix: phaseMatrix, revoked: phaseRevoked, 'rows-compare': () => phaseCompare('rows'), compare: () => phaseCompare('json'), 'body-md5': phaseBodyMd5 };
if (!PHASES[phase]) stop(2, `--phase 는 ${Object.keys(PHASES).join(' | ')}`);
const code = await Promise.resolve(PHASES[phase]()).catch((e) => { log(`예외: ${String(e?.name ?? 'Error')} ${String(e?.message ?? '').slice(0, 200)}`); return 1; });
process.exit(code);
