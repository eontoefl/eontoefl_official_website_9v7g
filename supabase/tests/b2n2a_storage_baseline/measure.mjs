// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-2a 파일 기준선·실측 도구 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 이 파일은 작업방이 시험 프로젝트에 실행해 보지 않았다(문법 확인, "대상이 다르면 요청 0으로 멈춤" 확인,
// 작업방 컴퓨터 안의 가짜 응답으로 흐름이 끝까지 도는지만 봤다). Storage API 의 요청 형식과 오류 모양은
// 문서·기억으로 적은 것이다 — 원 응답(상태·본문)을 그대로 남기므로 다르면 결과에서 드러난다.
// 쓰는 법은 같은 폴더의 절차.md 를 따른다.
//
// 외부 꾸러미 없음(Node 내장 fetch·fs·crypto·zlib 만). 주소·열쇠·자격은 환경 변수(B2N2A_*)로만 받고
// 결과 파일에 넣지 않는다. 주소·열쇠·자격 안의 ref 가 시험 프로젝트가 아니면 요청 0으로 멈춘다.
//
// 환경 변수
//   B2N2A_URL           https://hmncdheiwqwekdbtijar.supabase.co
//   B2N2A_SERVICE_KEY   service_role 키 (버킷 관리, 시작 상태 만들기·되돌리기, 독립 읽기, 허용 대조군)
//   B2N2A_ANON_KEY      anon 키 (비로그인, 로그인 요청의 apikey)
//   B2N2A_MEMBER_A / B2N2A_MEMBER_B   회원 A·B 의 회원번호(public.users.id)
//   B2N2A_JWT_A / _B / _N / _G1 / _G2   회원 A·B, 대응 없는 계정 N, 관리자 G 의 6자리 전·후 자격
//   B2N2A_JWT_A_EXP     회원 A 의 "만료 시험용" 로그인 상태에서 받은 자격 (fn-expired)
//   B2N2A_JWT_A_OUT     회원 A 의 "로그아웃 시험용" 로그인 상태에서 받은 자격 (fn-loggedout)
//   B2N2A_TABLE_REF_PATHS   (table-ref 단계만) 쉼표로 나눈 REST 경로들
//
// 단계 (--phase)
//   baseline-buckets          기준선 버킷 10개를 버킷 관리 API 로 만든다(설정은 운영 원자료 그대로)
//   probe-buckets             임시 버킷 5개(전부 비공개)를 만든다
//   upsert                    임시 4개 버킷에서 올리기 요건 실측(48칸)                     — 잰 값 표
//   side                      임시 4개 버킷에서 목록·내려받기·삭제·이동 실측                — 잰 값 표
//   business                  기준선의 업무 버킷 4개에 화면과 같은 요청으로 새 이름 올리기  — 잰 값 표
//   fn-live                   판정 함수 버킷: 본인·남·대응 없음·관리자 전/후               — 기대값 대조
//   fn-expired  --step pre|post|restored   만료(로그인 상태 한 행의 not_after)           — 기대값 대조
//   fn-loggedout --step pre|post           로그아웃                                       — 기대값 대조
//   cleanup                   이 도구가 만든 합성 객체를 전부 지우고 버킷별 남은 객체 수 확인
//   probe-buckets-remove      임시 버킷 5개를 지운다(객체가 남아 있으면 지우지 않고 멈춤)
//   baseline-buckets-remove   기준선 버킷 10개를 지운다(객체가 남아 있으면 지우지 않고 멈춤)
//   compare-facts             (요청 0) fingerprint.sql 결과를 사실 자료와 견준다: --facts <json> --fingerprint <json>
//   table-ref                 표 쪽 기준 요청(비로그인 GET)을 보내 상태·본문 지문을 적는다: --compare <앞 결과>
// 공통 인자: --out <결과 JSON>   (compare-facts 는 없어도 된다)
//
// 종료 값: 0 = 끝까지 함(fn-* 와 compare-facts·table-ref 는 기대와 전부 같음) / 1 = 기대와 다른 것이 있음 /
//          2 = 대상·입력 확인에서 멈춤(요청 0) / 3 = 실행 중 멈춤 / 4 = 객체가 남아 있어 버킷을 지우지 않음
// =====================================================================

import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';

const REF = 'hmncdheiwqwekdbtijar';
const ORIGIN = `https://${REF}.supabase.co`;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// 기준선 버킷 10개 — 운영 원자료(계약2나2a_파일기준선_사실.json 의 production.buckets)를 옮겨 적은 것
const BASELINE_BUCKETS = [
  { id: 'board-files', public: true, file_size_limit: 31457280, allowed_mime_types: null },
  { id: 'board-images', public: true, file_size_limit: 10485760, allowed_mime_types: null },
  { id: 'book-private', public: false, file_size_limit: 20971520, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] },
  { id: 'books', public: false, file_size_limit: null, allowed_mime_types: null },
  { id: 'correction-audio', public: true, file_size_limit: 26214400, allowed_mime_types: null },
  { id: 'guide-images', public: true, file_size_limit: null, allowed_mime_types: null },
  { id: 'materials', public: true, file_size_limit: null, allowed_mime_types: null },
  { id: 'review-images', public: true, file_size_limit: null, allowed_mime_types: null },
  { id: 'speaking-files', public: true, file_size_limit: null, allowed_mime_types: null },
  { id: 'toefl-score-images', public: true, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
];
// 임시 버킷 5개 — 전부 비공개. rule_set 은 probe_up.sql 이 로그인 역할에 주는 규칙 조합이다.
const UP_BUCKETS = [
  { id: 'zz-b2n2a-up-i', rule_set: '올리기만' },
  { id: 'zz-b2n2a-up-is', rule_set: '올리기+읽기' },
  { id: 'zz-b2n2a-up-iu', rule_set: '올리기+수정' },
  { id: 'zz-b2n2a-up-isu', rule_set: '올리기+읽기+수정' },
];
const FN_BUCKET = 'zz-b2n2a-fn';
const PROBE_BUCKETS = [...UP_BUCKETS.map((b) => b.id), FN_BUCKET].map((id) => ({ id, public: false, file_size_limit: null, allowed_mime_types: null }));
const BUSINESS_BUCKETS = ['materials', 'guide-images', 'board-files', 'toefl-score-images'];
const BUSINESS_MARK = 'zzb2n2'; // 화면이 쓰는 "임의 6글자" 자리에 넣는 표식

// ---------------------------------------------------------------------
// 인자·환경 변수·대상 확인 (여기까지는 어떤 요청도 보내지 않는다)
// ---------------------------------------------------------------------
let requestCount = 0;

function stop(code, message) {
  console.error(`[b2n2a] 멈춤: ${message}`);
  console.error('[b2n2a] 보낸 요청 수: ' + requestCount);
  process.exit(code);
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const PHASES = [
  'baseline-buckets', 'probe-buckets', 'upsert', 'side', 'business', 'fn-live', 'fn-expired', 'fn-loggedout',
  'cleanup', 'probe-buckets-remove', 'baseline-buckets-remove', 'compare-facts', 'table-ref',
];
const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
if (!PHASES.includes(phase)) stop(2, `--phase 는 다음 중 하나여야 한다: ${PHASES.join(', ')}`);
const step = args.step ?? null;
if (phase === 'fn-expired' && !['pre', 'post', 'restored'].includes(step)) stop(2, 'fn-expired 는 --step pre|post|restored 가 필요하다');
if (phase === 'fn-loggedout' && !['pre', 'post'].includes(step)) stop(2, 'fn-loggedout 은 --step pre|post 가 필요하다');
const outPath = args.out ?? null;
if (!outPath && phase !== 'compare-facts') stop(2, '--out <결과 JSON 경로> 가 필요하다');

const env = process.env;
const keyNotes = {};
let serviceKey = null;
let anonKey = null;
let memberA = null;
let memberB = null;
const jwts = {};
const jwtInfo = {};

function needEnv(name) {
  const v = env[name];
  if (!v) stop(2, `${name} 이 필요하다(--phase ${phase})`);
  return v;
}
function checkKey(name, key, role) {
  const p = decodeJwtPayload(key);
  if (p) {
    if (p.ref !== REF) stop(2, `${name} 의 ref 가 시험 프로젝트가 아니다. 아무 요청도 보내지 않는다`);
    if (p.role !== role) stop(2, `${name} 의 role 이 ${role} 이 아니다`);
    keyNotes[name] = 'jwt: ref·role 확인함';
  } else {
    keyNotes[name] = 'jwt 모양이 아님: 키에서 ref 를 확인하지 못함(주소로만 확인)';
  }
}
function checkUserJwt(label, name, { aal, minSeconds }) {
  const token = needEnv(name);
  const p = decodeJwtPayload(token);
  if (!p) stop(2, `${name} 이 JWT 모양이 아니다`);
  if (typeof p.iss !== 'string' || !p.iss.startsWith(`${ORIGIN}/`)) stop(2, `${name} 의 발급자(iss)가 시험 프로젝트가 아니다. 아무 요청도 보내지 않는다`);
  if (p.role !== 'authenticated') stop(2, `${name} 의 role 이 authenticated 가 아니다`);
  if (!UUID_RE.test(String(p.sub ?? '')) || !UUID_RE.test(String(p.session_id ?? ''))) stop(2, `${name} 에 sub 또는 session_id 가 없다`);
  const left = (typeof p.exp === 'number' ? p.exp : 0) - Math.floor(Date.now() / 1000);
  if (left < minSeconds) stop(2, `${name} 의 남은 유효 시간이 ${minSeconds}초보다 짧다(지금 ${left}초). 자격 자체가 만료되면 규칙의 거절과 구분할 수 없으므로 새로 받아 올 것`);
  if (aal && p.aal !== aal) stop(2, `${name} 의 aal 이 ${aal} 이 아니다(지금 ${p.aal})`);
  jwts[label] = token;
  // sub·session_id 는 식별값이다(자격이 아니다). 만료용 SQL 의 조건에 쓰라고 결과에 적는다.
  jwtInfo[label] = { sub: p.sub, session_id: p.session_id, aal: p.aal ?? null, seconds_left_at_start: left };
}
function needMembers() {
  memberA = String(needEnv('B2N2A_MEMBER_A')).toLowerCase();
  memberB = String(needEnv('B2N2A_MEMBER_B')).toLowerCase();
  if (!UUID_RE.test(memberA) || !UUID_RE.test(memberB) || memberA === memberB) stop(2, 'B2N2A_MEMBER_A·B2N2A_MEMBER_B 가 uuid 모양이 아니거나 서로 같다');
}

if (phase !== 'compare-facts') {
  const baseUrl = String(env.B2N2A_URL ?? '').replace(/\/+$/, '');
  let origin = null;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = null;
  }
  if (origin !== ORIGIN || baseUrl !== ORIGIN) stop(2, `B2N2A_URL 이 시험 프로젝트(${ORIGIN})가 아니다. 아무 요청도 보내지 않는다`);

  if (phase === 'table-ref') {
    anonKey = needEnv('B2N2A_ANON_KEY');
    checkKey('B2N2A_ANON_KEY', anonKey, 'anon');
    needEnv('B2N2A_TABLE_REF_PATHS');
  } else {
    serviceKey = needEnv('B2N2A_SERVICE_KEY');
    checkKey('B2N2A_SERVICE_KEY', serviceKey, 'service_role');
    if (['upsert', 'side', 'business', 'fn-live', 'fn-expired', 'fn-loggedout'].includes(phase)) {
      anonKey = needEnv('B2N2A_ANON_KEY');
      checkKey('B2N2A_ANON_KEY', anonKey, 'anon');
      if (anonKey === serviceKey) stop(2, 'anon 키와 service 키가 같다');
    }
    if (['upsert', 'side', 'business'].includes(phase)) checkUserJwt('member_a', 'B2N2A_JWT_A', { aal: null, minSeconds: 600 });
    if (['business', 'cleanup', 'fn-live', 'fn-expired', 'fn-loggedout'].includes(phase)) needMembers();
    if (phase === 'fn-live') {
      checkUserJwt('member_a', 'B2N2A_JWT_A', { aal: null, minSeconds: 600 });
      checkUserJwt('member_b', 'B2N2A_JWT_B', { aal: null, minSeconds: 600 });
      checkUserJwt('no_map', 'B2N2A_JWT_N', { aal: null, minSeconds: 600 });
      checkUserJwt('admin_pre', 'B2N2A_JWT_G1', { aal: 'aal1', minSeconds: 600 });
      checkUserJwt('admin_post', 'B2N2A_JWT_G2', { aal: 'aal2', minSeconds: 600 });
      if (jwtInfo.admin_pre.sub !== jwtInfo.admin_post.sub) stop(2, 'B2N2A_JWT_G1 과 B2N2A_JWT_G2 가 같은 계정이 아니다');
      if (new Set([jwtInfo.member_a.sub, jwtInfo.member_b.sub, jwtInfo.no_map.sub, jwtInfo.admin_post.sub]).size !== 4) stop(2, 'A·B·N·G 의 자격이 서로 다른 계정이 아니다');
    }
    if (phase === 'fn-expired') checkUserJwt('subject', 'B2N2A_JWT_A_EXP', { aal: null, minSeconds: 180 });
    if (phase === 'fn-loggedout') checkUserJwt('subject', 'B2N2A_JWT_A_OUT', { aal: null, minSeconds: 180 });
    if (phase === 'fn-expired' || phase === 'fn-loggedout') {
      // 만료 시험과 로그아웃 시험은 서로 다른 로그인 상태, 그리고 평소 쓰는 A 의 로그인 상태와도 다른 것이어야 한다.
      for (const other of ['B2N2A_JWT_A', phase === 'fn-expired' ? 'B2N2A_JWT_A_OUT' : 'B2N2A_JWT_A_EXP']) {
        const p = env[other] ? decodeJwtPayload(env[other]) : null;
        if (p && p.session_id === jwtInfo.subject.session_id) stop(2, `이 단계의 자격이 ${other} 와 같은 로그인 상태다. 서로 다른 로그인 상태에서 받은 자격을 쓸 것`);
        if (p && p.sub !== jwtInfo.subject.sub) stop(2, `이 단계의 자격이 ${other} 와 다른 계정이다(회원 A 의 다른 로그인 상태여야 한다)`);
      }
    }
  }
}

// ---------------------------------------------------------------------
// 합성 파일: 같은 형식(PNG 1×1)의 서로 다른 정확한 바이트
// ---------------------------------------------------------------------
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(label) {
  const h = createHash('sha256').update(label).digest();
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = deflateSync(Buffer.from([0, h[0], h[1], h[2]]));
  const text = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(`zz-b2n2a ${label}`, 'latin1')]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('tEXt', text), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const PNG = 'image/png';
const describe = (buf) => ({ sha256: sha256(buf), size: buf.length, content_type: PNG });

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
function authFor(actor) {
  if (actor === 'service') return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  if (actor === 'anon') return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  return { apikey: anonKey, Authorization: `Bearer ${jwts[actor]}` };
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function http(actor, method, urlPath, { headers = {}, body, json } = {}) {
  const h = { ...authFor(actor), ...headers };
  let payload = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  requestCount += 1;
  const res = await fetch(`${ORIGIN}${urlPath}`, { method, headers: h, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  const rawContentType = res.headers.get('content-type');
  // 형식은 매개변수(; charset 등)를 떼고 소문자로 견준다
  const contentType = rawContentType ? rawContentType.split(';')[0].trim().toLowerCase() : null;
  let parsed = null;
  if (contentType && contentType.includes('json')) {
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, buf, contentType, json: parsed };
}

// 원 응답을 그대로 남기고(상태·본문의 코드와 문구), 종류를 어림한다. 종류는 어림일 뿐이다 — 판단은 원 응답으로 한다.
function responseInfo(r) {
  const j = r.json && typeof r.json === 'object' && !Array.isArray(r.json) ? r.json : null;
  const bodyStatus = j?.statusCode != null ? String(j.statusCode) : null;
  const bodyError = j?.error != null ? String(j.error) : null;
  const bodyCode = j?.code != null ? String(j.code) : null;
  const message = j?.message != null ? String(j.message) : null;
  let kind = null;
  if (!r.ok) {
    const all = `${r.status} ${bodyStatus ?? ''} ${bodyError ?? ''} ${bodyCode ?? ''} ${message ?? ''}`.toLowerCase();
    if (all.includes('row-level security') || all.includes('row level security')) kind = 'rls';
    else if (all.includes('duplicate') || all.includes('already exists') || bodyStatus === '409' || r.status === 409) kind = 'duplicate';
    else if (all.includes('not found') || all.includes('not_found') || bodyStatus === '404' || r.status === 404) kind = 'not_found';
    else if (all.includes('mime') || bodyStatus === '415' || r.status === 415) kind = 'mime';
    else if (all.includes('too large') || all.includes('size') || bodyStatus === '413' || r.status === 413) kind = 'size';
    else if (all.includes('jwt') || all.includes('token') || all.includes('signature') || all.includes('jws')) kind = 'jwt';
    else if (bodyStatus === '403' || r.status === 403 || r.status === 401 || bodyStatus === '401') kind = 'forbidden_other';
    else kind = 'other';
  }
  return {
    http_status: r.status,
    body_statusCode: bodyStatus,
    body_error: bodyError,
    body_code: bodyCode,
    body_message: message,
    body_snippet: r.ok ? null : r.buf.toString('utf8').slice(0, 300),
    kind,
  };
}

// --- Storage 객체 API (요청 형식은 문서 기준) ---
function upload(actor, bucket, path, bytes, { upsert }) {
  const headers = { 'Content-Type': PNG };
  if (upsert === true) headers['x-upsert'] = 'true'; // 화면과 같다. "없음" 칸에서는 머리글을 아예 보내지 않는다.
  return http(actor, 'POST', `/storage/v1/object/${bucket}/${encPath(path)}`, { headers, body: bytes });
}
const download = (actor, bucket, path) => http(actor, 'GET', `/storage/v1/object/authenticated/${bucket}/${encPath(path)}`);
const removeOne = (actor, bucket, path) => http(actor, 'DELETE', `/storage/v1/object/${bucket}/${encPath(path)}`);
const move = (actor, bucket, from, to) => http(actor, 'POST', '/storage/v1/object/move', { json: { bucketId: bucket, sourceKey: from, destinationKey: to } });
const listRaw = (actor, bucket, prefix) => http(actor, 'POST', `/storage/v1/object/list/${bucket}`, {
  json: { prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } },
});

// 독립 읽기(권한 있는 자격 = 서비스 열쇠의 인증 내려받기): 있는지, 정확한 바이트의 지문, 크기, 형식
async function readObject(bucket, path) {
  const r = await download('service', bucket, path);
  if (r.ok) return { exists: true, sha256: sha256(r.buf), size: r.buf.length, content_type: r.contentType };
  const info = responseInfo(r);
  if (info.kind === 'not_found') return { exists: false };
  throw new Error(`독립 읽기 실패(${bucket}/${path}): ${r.status} ${info.body_snippet}`);
}
// 폴더 안의 파일 이름(서비스 열쇠). 폴더(하위 묶음)는 id 가 없는 항목이다.
async function listFolder(bucket, prefix) {
  const r = await listRaw('service', bucket, prefix);
  if (!r.ok || !Array.isArray(r.json)) throw new Error(`목록 읽기 실패(${bucket}/${prefix}): ${r.status} ${r.buf.toString('utf8').slice(0, 200)}`);
  return r.json;
}
async function folderFileNames(bucket, prefix, startsWith = '') {
  const items = await listFolder(bucket, prefix);
  return items.filter((x) => x.id && String(x.name).startsWith(startsWith)).map((x) => String(x.name)).sort();
}
// 버킷 안의 파일 경로 전부(폴더를 따라 내려간다). 한 폴더에 1000개를 넘는 경우는 다루지 않는다(시험 버킷은 합성 파일뿐이다).
async function walk(bucket, prefix = '') {
  const out = [];
  const items = await listFolder(bucket, prefix);
  for (const it of items) {
    const full = prefix ? `${prefix}/${it.name}` : String(it.name);
    if (it.id) out.push(full);
    else out.push(...(await walk(bucket, full)));
  }
  return out;
}
async function removeMany(bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const r = await http('service', 'DELETE', `/storage/v1/object/${bucket}`, { json: { prefixes: paths.slice(i, i + 100) } });
    if (!r.ok) throw new Error(`지우기 실패(${bucket}): ${r.status} ${r.buf.toString('utf8').slice(0, 200)}`);
  }
}
const sameObject = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameNames = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 칸의 시작 상태를 되돌린다(서비스 열쇠): 대상 이름을 지우고, 있어야 하는 칸이면 원본 바이트로 다시 만든다.
// 서비스 열쇠로 만든 객체의 소유자는 비어 있다(원래 소유 상태). 대조군 파일도 같은 방식으로 둔다.
// 그런 다음 독립 읽기로 "있어야 하는 것은 정확히 그 바이트로 있고, 없어야 하는 것은 없음"을 확인한다.
async function restoreStart(bucket, spec) {
  // spec: [{ path, bytes|null }]  bytes 가 null 이면 "없어야 함"
  for (const s of spec) {
    const d = await removeOne('service', bucket, s.path);
    const di = responseInfo(d);
    if (!d.ok && di.kind !== 'not_found') throw new Error(`시작 상태 되돌리기 실패(지우기 ${bucket}/${s.path}): ${d.status} ${di.body_snippet}`);
    if (s.bytes) {
      const u = await upload('service', bucket, s.path, s.bytes, { upsert: false });
      if (!u.ok) throw new Error(`시작 상태 되돌리기 실패(만들기 ${bucket}/${s.path}): ${u.status} ${responseInfo(u).body_snippet}`);
    }
  }
  const state = {};
  let ok = true;
  for (const s of spec) {
    const st = await readObject(bucket, s.path);
    state[s.path] = st;
    if (s.bytes ? !sameObject(st, { exists: true, ...describe(s.bytes) }) : st.exists) ok = false;
  }
  return { ok, state };
}
async function readAll(bucket, paths) {
  const state = {};
  for (const p of paths) state[p] = await readObject(bucket, p);
  return state;
}

// ---------------------------------------------------------------------
// 버킷 관리 (서비스 열쇠, 버킷 관리 API)
// ---------------------------------------------------------------------
async function getBuckets() {
  const r = await http('service', 'GET', '/storage/v1/bucket');
  if (!r.ok || !Array.isArray(r.json)) throw new Error(`버킷 목록 읽기 실패: ${r.status} ${r.buf.toString('utf8').slice(0, 200)}`);
  return r.json;
}
const bucketView = (b) => ({
  id: b.id, name: b.name, public: !!b.public,
  file_size_limit: b.file_size_limit ?? null,
  allowed_mime_types: b.allowed_mime_types ?? null,
});
const sameBucket = (have, want) => JSON.stringify(bucketView(have)) === JSON.stringify(bucketView({ ...want, name: want.id }));

async function phaseBucketsCreate(wanted) {
  const before = await getBuckets();
  const plan = wanted.map((w) => {
    const have = before.find((b) => b.id === w.id);
    return { want: w, have: have ? bucketView(have) : null, action: !have ? 'create' : sameBucket(have, w) ? 'already_same' : 'conflict' };
  });
  const conflicts = plan.filter((p) => p.action === 'conflict');
  if (conflicts.length) {
    return { exit: 3, result: { stopped: '같은 이름의 버킷이 다른 설정으로 이미 있다. 아무것도 만들지 않았다', plan } };
  }
  for (const p of plan.filter((x) => x.action === 'create')) {
    const body = { id: p.want.id, name: p.want.id, public: p.want.public };
    if (p.want.file_size_limit != null) body.file_size_limit = p.want.file_size_limit;
    if (p.want.allowed_mime_types != null) body.allowed_mime_types = p.want.allowed_mime_types;
    const r = await http('service', 'POST', '/storage/v1/bucket', { json: body });
    p.create_response = responseInfo(r);
    if (!r.ok) return { exit: 3, result: { stopped: `버킷 만들기 실패: ${p.want.id}`, plan } };
  }
  const after = await getBuckets();
  const verify = wanted.map((w) => {
    const have = after.find((b) => b.id === w.id);
    return { id: w.id, exists: !!have, same_as_wanted: !!have && sameBucket(have, w), now: have ? bucketView(have) : null };
  });
  const ok = verify.every((v) => v.same_as_wanted);
  return { exit: ok ? 0 : 3, result: { plan, verify, all_same_as_wanted: ok, buckets_after: after.map(bucketView).sort((a, b) => (a.id < b.id ? -1 : 1)) } };
}

async function phaseBucketsRemove(wanted) {
  const before = await getBuckets();
  const present = wanted.filter((w) => before.some((b) => b.id === w.id));
  const counts = {};
  for (const w of present) counts[w.id] = (await walk(w.id)).length;
  const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
  if (nonEmpty.length) {
    return { exit: 4, result: { stopped: '객체가 남아 있는 버킷이 있다. 어떤 버킷도 지우지 않았다(먼저 --phase cleanup)', object_counts: counts } };
  }
  const removed = [];
  for (const w of present) {
    const r = await http('service', 'DELETE', `/storage/v1/bucket/${w.id}`);
    removed.push({ id: w.id, response: responseInfo(r) });
    if (!r.ok) return { exit: 3, result: { stopped: `버킷 지우기 실패: ${w.id}`, object_counts: counts, removed } };
  }
  const after = await getBuckets();
  const left = wanted.filter((w) => after.some((b) => b.id === w.id)).map((w) => w.id);
  return { exit: left.length ? 3 : 0, result: { object_counts_before: counts, removed, not_present_before: wanted.filter((w) => !present.includes(w)).map((w) => w.id), left, buckets_after: after.map(bucketView) } };
}

// ---------------------------------------------------------------------
// upsert: 올리기 요건 실측 (4 버킷 × 새 이름/있는 이름 × x-upsert 있음/없음 × 자격 3)
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(3, '0');

async function uploadCell({ run, phaseName, no, bucket, actor, nameState, upsert, extra }) {
  const folder = `r${run}/${phaseName}/${pad(no)}`;
  const target = `${folder}/t.png`;
  const control = `${folder}/c.png`;
  const original = nameState === 'existing' ? makePng(`${run} ${phaseName} ${no} original`) : null;
  const controlBytes = makePng(`${run} ${phaseName} ${no} control`);
  const uploaded = makePng(`${run} ${phaseName} ${no} uploaded by ${actor}`);

  const start = await restoreStart(bucket, [{ path: target, bytes: original }, { path: control, bytes: controlBytes }]);
  const namesBefore = await folderFileNames(bucket, folder);
  const r = await upload(actor, bucket, target, uploaded, { upsert });
  const after = await readAll(bucket, [target, control]);
  const namesAfter = await folderFileNames(bucket, folder);

  const want = { exists: true, ...describe(uploaded) };
  const orig = original ? { exists: true, ...describe(original) } : { exists: false };
  let stored;
  if (sameObject(after[target], want)) stored = 'uploaded_bytes';
  else if (sameObject(after[target], orig)) stored = original ? 'original_bytes' : 'absent';
  else stored = 'other';
  const controlUnchanged = sameObject(after[control], { exists: true, ...describe(controlBytes) });
  const info = responseInfo(r);

  return {
    cell: `${phaseName}-${pad(no)}`, bucket, actor, name_state: nameState, x_upsert: upsert ? 'true' : '없음',
    path: target, control_path: control, ...extra,
    uploaded: describe(uploaded), original: original ? describe(original) : null,
    start_ok: start.ok, start: start.state,
    response: info, request_ok: r.ok,
    after, stored, control_unchanged: controlUnchanged,
    object_names_before: namesBefore, object_names_after: namesAfter,
    object_count_before: namesBefore.length, object_count_after: namesAfter.length,
    state_unchanged: sameObject(after[target], start.state[target]) && controlUnchanged && sameNames(namesBefore, namesAfter),
  };
}

// 잰 값을 읽는 말(통과·실패가 아니다). 권한 거절로 적으려면 같은 입력의 서비스 열쇠 대조군이 성공해야 한다.
function readingOfUpload(cell, control) {
  if (!cell.start_ok) return '시작 상태가 기대와 다름(이 칸은 읽지 않는다)';
  if (cell.request_ok && cell.stored === 'uploaded_bytes') return '받아들여짐 — 올린 바이트가 정확히 저장됨';
  if (cell.request_ok) return `받아들여졌다고 응답했으나 저장값이 올린 바이트가 아님(${cell.stored})`;
  if (cell.response.kind === 'duplicate') return '권한 미판정(중복) — 이름이 이미 있어 생긴 오류';
  if (!cell.state_unchanged) return `거절 응답인데 저장 상태가 바뀜(${cell.stored})`;
  if (cell.response.kind === 'rls') {
    if (cell.actor === 'service') return '서비스 열쇠인데 권한 오류(대조군이 성립하지 않음)';
    if (control && control.request_ok && control.stored === 'uploaded_bytes') return '권한 거절 — 같은 입력이 서비스 열쇠로는 성공(대조군 있음), 변화 0';
    return '권한 미판정 — 같은 입력의 서비스 열쇠 대조군도 성공하지 못함';
  }
  return `거절(권한 오류로 분류되지 않음: ${cell.response.kind}) — 원 응답을 볼 것, 변화 0`;
}

async function phaseUpsert(run) {
  const cells = [];
  let no = 0;
  for (const b of UP_BUCKETS) {
    for (const nameState of ['new', 'existing']) {
      for (const upsert of [true, false]) {
        const group = [];
        for (const actor of ['service', 'anon', 'member_a']) {
          no += 1;
          group.push(await uploadCell({ run, phaseName: 'upsert', no, bucket: b.id, actor, nameState, upsert, extra: { rule_set: b.rule_set } }));
        }
        const control = group.find((c) => c.actor === 'service');
        for (const c of group) {
          c.control_cell = control.cell;
          c.control_ok = control.request_ok && control.stored === 'uploaded_bytes';
          c.reading = readingOfUpload(c, control);
          cells.push(c);
        }
      }
    }
  }
  // 한눈에 보는 표: 버킷(규칙 조합) × 이름 상태 × x-upsert → 자격별 읽는 말
  const table = {};
  for (const c of cells) {
    const key = `${c.bucket} [${c.rule_set}] | ${c.name_state === 'new' ? '새 이름' : '있는 이름'} | x-upsert ${c.x_upsert}`;
    (table[key] ??= {})[c.actor] = `${c.response.http_status}${c.response.body_statusCode ? '/' + c.response.body_statusCode : ''} · ${c.reading}`;
  }
  return { exit: 0, result: { note: '기대값 없음 — 잰 값을 그대로 적은 표다. 소유자는 fingerprint.sql 의 objects 에서 path 로 찾아 본다.', table, cells } };
}

// ---------------------------------------------------------------------
// side: 그 규칙 조합이 함께 여는 것 — 목록·인증 내려받기·삭제·이동 (로그인 회원, 대조군 = 서비스 열쇠)
// ---------------------------------------------------------------------
async function sideCell({ run, no, bucket, ruleSet, action, actor, origin }) {
  const folder = `r${run}/side/${pad(no)}`;
  const target = `${folder}/t.png`;
  const control = `${folder}/c.png`;
  const dest = `${folder}/moved.png`;
  const original = makePng(`${run} side ${no} original`);
  const controlBytes = makePng(`${run} side ${no} control`);
  const rec = { cell: `side-${pad(no)}`, bucket, rule_set: ruleSet, action, actor, origin, path: target, control_path: control, original: describe(original) };

  // 시작 상태: 대조군 파일은 서비스 열쇠로, 대상 파일은 origin 에 따라 서비스 열쇠 또는 회원이 올린 것
  const start = await restoreStart(bucket, [{ path: target, bytes: origin === 'service' ? original : null }, { path: control, bytes: controlBytes }, { path: dest, bytes: null }]);
  if (origin === 'member') {
    const u = await upload('member_a', bucket, target, original, { upsert: false });
    rec.origin_upload = responseInfo(u);
    start.state[target] = await readObject(bucket, target);
    if (!sameObject(start.state[target], { exists: true, ...describe(original) })) {
      rec.start_ok = false;
      rec.start = start.state;
      rec.reading = '회원이 올린 대상 파일을 만들지 못해 이 칸은 재지 못함(올리기 응답을 볼 것)';
      return rec;
    }
  }
  rec.start_ok = start.ok;
  rec.start = start.state;
  const namesBefore = await folderFileNames(bucket, folder);
  rec.object_names_before = namesBefore;

  let r;
  if (action === 'list') r = await listRaw(actor, bucket, folder);
  else if (action === 'download') r = await download(actor, bucket, target);
  else if (action === 'delete') r = await removeOne(actor, bucket, target);
  else r = await move(actor, bucket, target, dest);
  rec.response = responseInfo(r);
  rec.request_ok = r.ok;

  // 응답만으로 판정하지 않는다: 그 뒤 독립 읽기로 본 이름·바이트·크기·형식
  const after = await readAll(bucket, [target, control, dest]);
  const namesAfter = await folderFileNames(bucket, folder);
  rec.after = after;
  rec.object_names_after = namesAfter;
  const orig = { exists: true, ...describe(original) };
  const ctrlSame = sameObject(after[control], { exists: true, ...describe(controlBytes) });
  rec.control_unchanged = ctrlSame;

  if (action === 'list') {
    const returned = r.ok && Array.isArray(r.json) ? r.json.filter((x) => x.id).map((x) => String(x.name)).sort() : null;
    rec.returned_names = returned;
    rec.returned_all = !!returned && sameNames(returned, namesBefore);
    rec.reading = !r.ok ? `목록 요청이 거절됨(${rec.response.kind})`
      : rec.returned_all ? `목록에 그 폴더의 파일 이름이 전부 나옴(${returned.length}개)`
        : returned.length === 0 ? '응답은 성공이지만 목록이 비어 있음(파일은 실제로 있다)'
          : `목록에 일부만 나옴(${returned.length}/${namesBefore.length})`;
  } else if (action === 'download') {
    const got = r.ok ? { exists: true, sha256: sha256(r.buf), size: r.buf.length, content_type: r.contentType } : null;
    rec.downloaded = got;
    rec.downloaded_exact = !!got && sameObject(got, orig);
    rec.reading = rec.downloaded_exact ? '내려받아짐 — 바이트가 정확히 같음'
      : r.ok ? '응답은 성공이지만 받은 바이트가 원본과 다름' : `내려받기가 거절됨(${rec.response.kind}) — 파일은 실제로 있다`;
  } else if (action === 'delete') {
    rec.deleted = !after[target].exists;
    rec.reading = rec.deleted ? '지워짐 — 독립 읽기에서 대상이 없음'
      : sameObject(after[target], orig) ? `지워지지 않음 — 대상이 원본 그대로(응답 ${rec.response.http_status}${r.ok ? ', 성공이라고 응답' : ', ' + rec.response.kind})`
        : '대상이 원본과 다른 상태로 남음';
  } else {
    rec.moved = !after[target].exists && sameObject(after[dest], orig);
    rec.reading = rec.moved ? '옮겨짐 — 출발지 없음, 도착지에 같은 바이트'
      : sameObject(after[target], orig) && !after[dest].exists ? `옮겨지지 않음 — 출발지 원본 그대로, 도착지 없음(응답 ${rec.response.http_status}${r.ok ? ', 성공이라고 응답' : ', ' + rec.response.kind})`
        : '출발지·도착지가 기대하지 않은 상태(after 를 볼 것)';
  }
  if (!ctrlSame) rec.reading += ' / 대조군 파일이 바뀜';
  return rec;
}

async function phaseSide(run) {
  const cells = [];
  let no = 0;
  for (const b of UP_BUCKETS) {
    for (const origin of ['service', 'member']) {
      for (const action of ['list', 'download', 'delete', 'move']) {
        const group = [];
        for (const actor of ['service', 'member_a']) {
          no += 1;
          group.push(await sideCell({ run, no, bucket: b.id, ruleSet: b.rule_set, action, actor, origin }));
        }
        const control = group.find((c) => c.actor === 'service');
        const controlOk = control.start_ok !== false && (
          (action === 'list' && control.returned_all) || (action === 'download' && control.downloaded_exact)
          || (action === 'delete' && control.deleted) || (action === 'move' && control.moved));
        for (const c of group) {
          c.control_cell = control.cell;
          c.control_ok = !!controlOk;
          if (c.actor !== 'service' && c.start_ok !== false && !controlOk) c.reading += ' / 권한 미판정 — 같은 입력의 서비스 열쇠 대조군도 성공하지 못함';
          cells.push(c);
        }
      }
    }
  }
  const table = {};
  for (const c of cells.filter((x) => x.actor === 'member_a')) {
    const key = `${c.bucket} [${c.rule_set}] | 대상 파일을 만든 쪽: ${c.origin === 'service' ? '서비스 열쇠' : '회원 A'}`;
    (table[key] ??= {})[c.action] = c.reading;
  }
  return { exit: 0, result: { note: '기대값 없음 — 잰 값을 그대로 적은 표다. 이동·삭제 뒤의 소유자는 fingerprint.sql 의 objects 에서 path 로 찾아 본다.', table, cells } };
}

// ---------------------------------------------------------------------
// business: 기준선의 업무 버킷 4개에 지금 규칙 그대로, 화면과 같은 요청으로 새 이름 올리기
// ---------------------------------------------------------------------
function businessShapes(ts) {
  const m = BUSINESS_MARK;
  return [
    { bucket: 'materials', shape: `<시각>_<임의>.png`, path: `${ts}_${m}.png`, screen: '없음',
      how_to_read: '합성 진단 요청이다. materials 에 올리는 화면 호출은 두 사이트 코드에서 확인되지 않았다 — 되든 안 되든 업무 보존의 증거가 아니다.' },
    { bucket: 'guide-images', shape: `<시각>_<임의>.png`, path: `${ts + 1}_${m}.png`, screen: '공홈 js/admin-guide-editor.js:194·231 (관리자 화면)',
      how_to_read: '관리자 화면의 경로 모양이다. 회원 자격으로 보낸 요청이 되더라도 "관리자 업무가 된다"가 아니라 "지금 그 경로가 회원에게도 열려 있다"는 사실이다. 올리기 규칙은 모든 역할, 읽기 규칙은 비로그인만이므로 로그인 칸에서 올리기가 읽기 규칙을 요구하는지 드러난다.' },
    { bucket: 'guide-images', shape: `book/<시각>_<임의>.png`, path: `book/${ts + 2}_${m}.png`, screen: '공홈 js/admin-book-editor.js:1131 (관리자 화면)',
      how_to_read: '위와 같다(입문서 편집의 경로 모양).' },
    { bucket: 'board-files', shape: `reviews/<시각>_<임의>_<파일이름>`, path: `reviews/${ts + 3}_${m}_zz-b2n2a.png`, screen: '공홈 write.html:1095~1121 (학생 게시판 키 reviews)',
      how_to_read: '학생이 쓰는 게시판 키의 경로 모양이다. 비로그인 결과가 2b 의 "옛 경로" 기준이다.' },
    { bucket: 'board-files', shape: `notice/<시각>_<임의>_<파일이름>`, path: `notice/${ts + 4}_${m}_zz-b2n2a.png`, screen: '공홈 write.html:1095~1121 (관리자 게시판 키 notice)',
      how_to_read: '관리자가 쓰는 게시판 키의 경로 모양이다. 지금 규칙은 게시판 키를 가리지 않는다 — 회원 자격으로 되더라도 관리자 업무의 증거가 아니다.' },
    { bucket: 'toefl-score-images', shape: `exam-reg/<A 회원번호>/<시각>.png`, path: `exam-reg/${memberA}/${ts + 5}.png`, screen: '테스트룸 js/toefl-exam.js:376~377 (학생, 자기 시험 등록)',
      how_to_read: '학생의 실제 경로 모양(자기 회원번호)이다.' },
    { bucket: 'toefl-score-images', shape: `exam-reg/<B 회원번호>/<시각>.png`, path: `exam-reg/${memberB}/${ts + 6}.png`, screen: '없음(남의 회원번호로 보낸 것)',
      how_to_read: '회원 A 의 자격으로 B 의 회원번호 폴더에 보낸 요청이다. 되면 "지금 규칙이 경로의 회원번호를 가리지 않는다"는 사실이다.' },
    { bucket: 'toefl-score-images', shape: `<A 회원번호>/<시각>.png`, path: `${memberA}/${ts + 7}.png`, screen: '공홈 js/admin-study-detail-v3.js:3328~3329 (관리자 화면)',
      how_to_read: '성적표의 관리자 경로 모양이다. 회원 자격으로 보낸 요청이 되더라도 "관리자 업무가 된다"가 아니라 "지금 그 경로가 회원에게도 열려 있다"는 사실이다.' },
  ];
}

async function phaseBusiness() {
  const cells = [];
  let no = 0;
  let ts = Date.now();
  for (const actor of ['service', 'anon', 'member_a']) {
    for (const s of businessShapes(ts)) {
      no += 1;
      const bytes = makePng(`business ${ts} ${no} ${actor}`);
      const before = await readObject(s.bucket, s.path); // 새 이름이어야 한다(비어 있음)
      const r = await upload(actor, s.bucket, s.path, bytes, { upsert: true }); // 화면과 같이 x-upsert: true
      const after = await readObject(s.bucket, s.path);
      const pub = await fetchPublic(s.bucket, s.path);
      const rec = {
        cell: `business-${pad(no)}`, bucket: s.bucket, actor, path_shape: s.shape, path: s.path, screen: s.screen, x_upsert: 'true',
        uploaded: describe(bytes), name_was_empty: !before.exists,
        response: responseInfo(r), request_ok: r.ok, after,
        stored_exact: sameObject(after, { exists: true, ...describe(bytes) }),
        public_url_status: pub, how_to_read: s.how_to_read,
      };
      rec.reading = !rec.name_was_empty ? '시작 상태가 기대와 다름(이름이 비어 있지 않았다)'
        : rec.request_ok && rec.stored_exact ? '받아들여짐 — 올린 바이트가 정확히 저장됨'
          : rec.request_ok ? '받아들여졌다고 응답했으나 저장값이 올린 바이트가 아님'
            : after.exists ? '거절 응답인데 파일이 생김' : `거절(${rec.response.kind}) — 파일이 생기지 않음`;
      cells.push(rec);
    }
    ts += 100; // 자격마다 다른 시각 값 → 서로 다른 새 이름
  }
  for (const c of cells) {
    const control = cells.find((x) => x.actor === 'service' && x.bucket === c.bucket && x.path_shape === c.path_shape);
    c.control_cell = control.cell;
    c.control_ok = control.request_ok && control.stored_exact;
    if (c.actor !== 'service' && !c.request_ok && c.response.kind === 'rls') {
      c.reading = c.control_ok ? '권한 거절 — 같은 모양의 요청이 서비스 열쇠로는 성공(대조군 있음), 파일이 생기지 않음' : '권한 미판정 — 서비스 열쇠 대조군도 성공하지 못함';
    }
  }
  const table = {};
  for (const c of cells) (table[`${c.bucket} | ${c.path_shape}`] ??= {})[c.actor] = `${c.response.http_status}${c.response.body_statusCode ? '/' + c.response.body_statusCode : ''} · ${c.reading}`;
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 지금 규칙 그대로의 실측이다. 비로그인 칸은 2b 의 "옛 경로" 기준, 로그인 칸은 "지금 새 로그인으로 보내면 무엇이 되고 안 되는가"다. public_url_status 는 참고일 뿐 규칙의 증거가 아니다(공개 버킷의 공개 주소는 규칙과 무관하게 열린다).',
      how_to_read_general: [
        'materials 에 올리는 요청은 확인된 화면 호출이 없는 합성 진단 요청이다(업무 보존의 증거가 아님).',
        'guide-images 와 성적표의 관리자 경로(<회원번호>/…)에 회원 자격으로 보낸 요청이 되더라도, 그것은 "관리자 업무가 된다"가 아니라 "지금 그 경로가 회원에게도 열려 있다"는 사실이다.',
      ],
      table, cells,
    },
  };
}
async function fetchPublic(bucket, path) {
  requestCount += 1;
  try {
    const res = await fetch(`${ORIGIN}/storage/v1/object/public/${bucket}/${encPath(path)}`, { method: 'GET' });
    await res.arrayBuffer();
    return res.status;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// fn-*: 판정 함수 버킷 (기대값을 대조하는 단계)
// ---------------------------------------------------------------------
const FN_ACTIONS = ['upload', 'download', 'overwrite', 'delete'];

async function fnAttempt({ run, tag, no, folder, actor, action }) {
  const base = `${folder}/r${run}-${tag}-${pad(no)}`;
  const target = `${base}-t.png`;
  const control = `${base}-c.png`;
  const original = action === 'upload' ? null : makePng(`${run} ${tag} ${no} original`);
  const controlBytes = makePng(`${run} ${tag} ${no} control`);
  const fresh = makePng(`${run} ${tag} ${no} new by ${actor}`);

  // 시작 상태 되돌리기 + 확인: 내려받기·덮어쓰기·삭제는 대상 파일이 실제로 있음, 새로 올리기는 이름이 비어 있음
  const start = await restoreStart(FN_BUCKET, [{ path: target, bytes: original }, { path: control, bytes: controlBytes }]);
  const namesBefore = await folderFileNames(FN_BUCKET, folder, `r${run}-${tag}-${pad(no)}-`);

  let r;
  if (action === 'upload') r = await upload(actor, FN_BUCKET, target, fresh, { upsert: true });
  else if (action === 'download') r = await download(actor, FN_BUCKET, target);
  else if (action === 'overwrite') r = await upload(actor, FN_BUCKET, target, fresh, { upsert: true });
  else r = await removeOne(actor, FN_BUCKET, target);

  const after = await readAll(FN_BUCKET, [target, control]);
  const namesAfter = await folderFileNames(FN_BUCKET, folder, `r${run}-${tag}-${pad(no)}-`);
  const info = responseInfo(r);
  const origState = original ? { exists: true, ...describe(original) } : { exists: false };
  const freshState = { exists: true, ...describe(fresh) };
  const ctrlState = { exists: true, ...describe(controlBytes) };
  const controlUnchanged = sameObject(after[control], ctrlState);
  const unchanged = sameObject(after[target], origState) && controlUnchanged && sameNames(namesBefore, namesAfter);

  // 허용: 기대한 저장 상태 전체와 정확히 같아야 한다(대상의 바이트·크기·형식, 대조군, 그 묶음의 파일 이름 집합)
  const tName = target.split('/').pop();
  const cName = control.split('/').pop();
  let allowed = false;
  if (action === 'upload' || action === 'overwrite') {
    allowed = r.ok && sameObject(after[target], freshState) && controlUnchanged && sameNames(namesAfter, [cName, tName].sort());
  } else if (action === 'download') {
    const got = r.ok ? { exists: true, sha256: sha256(r.buf), size: r.buf.length, content_type: r.contentType } : null;
    allowed = !!got && sameObject(got, origState) && unchanged;
  } else {
    allowed = r.ok && !after[target].exists && controlUnchanged && sameNames(namesAfter, [cName]);
  }
  let outcome;
  if (!start.ok) outcome = 'undetermined(시작 상태가 기대와 다름)';
  else if (allowed) outcome = 'allow';
  else if (!r.ok && unchanged) outcome = info.kind === 'jwt' ? 'undetermined(자격 자체가 거절됨 — 규칙의 거절이 아님)' : 'deny';
  else if (r.ok && unchanged && action === 'delete') outcome = 'deny'; // 성공이라고 응답했지만 지워진 것이 없음
  else outcome = 'anomaly';

  return {
    actor, action, folder, path: target, control_path: control,
    start_ok: start.ok, start: start.state,
    target_existed_before: !!start.state[target]?.exists, name_was_empty_before: !start.state[target]?.exists,
    response: info, request_ok: r.ok, after,
    object_names_before: namesBefore, object_names_after: namesAfter,
    state_unchanged: unchanged, outcome,
  };
}

// 한 줄(자격·폴더·동작) = 시도 1번 + (거절이 기대인 줄은) 같은 입력의 서비스 열쇠 대조군 1번
async function fnRow({ run, tag, counter, caseName, folder, actor, action, expect }) {
  const attempt = await fnAttempt({ run, tag, no: counter.next(), folder, actor, action });
  const row = { case: caseName, actor, folder, action, expect, ...attempt, control: null };
  if (expect === 'deny') {
    const c = await fnAttempt({ run, tag, no: counter.next(), folder, actor: 'service', action });
    row.control = { outcome: c.outcome, response: c.response, path: c.path };
    if (c.outcome !== 'allow' && row.outcome === 'deny') row.outcome = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군도 성공하지 못함)';
  }
  row.match = row.outcome === expect;
  return row;
}
const makeCounter = () => {
  let n = 0;
  return { next: () => (n += 1) };
};
function fnSummary(rows) {
  const table = {};
  for (const r of rows) (table[r.case] ??= {})[r.action] = `${r.expect} → ${r.outcome}${r.match ? '' : '  ✗'}`;
  const mismatch = rows.filter((r) => !r.match);
  return { total: rows.length, mismatch: mismatch.length, table, mismatches: mismatch.map((r) => ({ case: r.case, action: r.action, expect: r.expect, outcome: r.outcome, response: r.response })) };
}

async function phaseFnLive(run) {
  const cases = [
    { name: 'A 가 자기 폴더', actor: 'member_a', folder: memberA, expect: 'allow' },
    { name: 'B 가 A 의 폴더', actor: 'member_b', folder: memberA, expect: 'deny' },
    { name: 'A 가 B 의 폴더', actor: 'member_a', folder: memberB, expect: 'deny' },
    { name: '대응 없는 계정이 A 의 폴더', actor: 'no_map', folder: memberA, expect: 'deny' },
    { name: '관리자 6자리 전이 admin 폴더', actor: 'admin_pre', folder: 'admin', expect: 'deny' },
    { name: '관리자 6자리 후가 admin 폴더', actor: 'admin_post', folder: 'admin', expect: 'allow' },
    // 아래 둘은 계약서 목록 밖의 보탬: 임시 규칙이 "회원은 자기 폴더만, 관리자는 admin 폴더만"인지
    { name: '(보탬) A 가 admin 폴더', actor: 'member_a', folder: 'admin', expect: 'deny' },
    { name: '(보탬) 관리자 6자리 후가 A 의 폴더', actor: 'admin_post', folder: memberA, expect: 'deny' },
  ];
  const counter = makeCounter();
  const rows = [];
  for (const c of cases) {
    for (const action of FN_ACTIONS) rows.push(await fnRow({ run, tag: 'live', counter, caseName: c.name, folder: c.folder, actor: c.actor, action, expect: c.expect }));
  }
  const summary = fnSummary(rows);
  return { exit: summary.mismatch ? 1 : 0, result: { credentials: jwtInfo, summary, rows } };
}

async function phaseFnSubject(run, kind) {
  // kind: 'expired' | 'loggedout'.  pre·restored = 허용이 기대, post = 거절이 기대
  const expect = step === 'post' ? 'deny' : 'allow';
  const caseName = kind === 'expired'
    ? { pre: '만료 전(먼저 허용 확인)', post: 'not_after 를 과거로 바꾼 뒤 — 이미 받아 둔 같은 자격', restored: 'not_after 를 원래 값으로 되돌린 뒤' }[step]
    : { pre: '로그아웃 전(먼저 허용 확인)', post: '로그아웃한 뒤 — 이미 받아 둔 같은 자격' }[step];
  const counter = makeCounter();
  const rows = [];
  for (const action of FN_ACTIONS) rows.push(await fnRow({ run, tag: `${kind}-${step}`, counter, caseName, folder: memberA, actor: 'subject', action, expect }));
  const summary = fnSummary(rows);
  const left = decodeJwtPayload(jwts.subject).exp - Math.floor(Date.now() / 1000);
  return {
    exit: summary.mismatch ? 1 : 0,
    result: {
      credential: { ...jwtInfo.subject, seconds_left_at_end: left },
      note: step === 'post'
        ? '거절이 규칙(판정 함수) 때문인지 보려면: 자격의 남은 유효 시간이 끝까지 0보다 커야 하고(seconds_left_at_end), 각 줄의 응답 종류가 jwt 가 아니어야 하며, 서비스 열쇠 대조군이 allow 여야 한다.'
        : '이 단계는 같은 자격으로 네 동작이 모두 허용됨을 먼저 확인하는 것이다.',
      summary, rows,
    },
  };
}

// ---------------------------------------------------------------------
// cleanup: 이 도구가 만든 합성 객체를 Storage API 로 전부 지우고 남은 객체 수 확인
// ---------------------------------------------------------------------
function isSyntheticBusinessObject(bucket, path) {
  if (bucket === 'toefl-score-images') {
    return [`exam-reg/${memberA}/`, `exam-reg/${memberB}/`, `${memberA}/`, `${memberB}/`].some((p) => path.startsWith(p));
  }
  return path.includes(`_${BUSINESS_MARK}`);
}
async function phaseCleanup() {
  const buckets = (await getBuckets()).map((b) => b.id);
  const report = {};
  for (const id of [...PROBE_BUCKETS.map((b) => b.id), ...BASELINE_BUCKETS.map((b) => b.id)]) {
    if (!buckets.includes(id)) {
      report[id] = { present: false };
      continue;
    }
    const all = await walk(id);
    const isProbe = id.startsWith('zz-b2n2a-');
    const mine = isProbe ? all : BUSINESS_BUCKETS.includes(id) ? all.filter((p) => isSyntheticBusinessObject(id, p)) : [];
    if (mine.length) await removeMany(id, mine);
    const left = await walk(id);
    report[id] = { present: true, found: all.length, deleted: mine.length, left: left.length, left_names: left.slice(0, 50) };
  }
  const leftTotal = Object.values(report).reduce((s, r) => s + (r.left ?? 0), 0);
  return {
    exit: leftTotal === 0 ? 0 : 1,
    result: {
      note: '임시 버킷은 안의 객체를 전부, 업무 버킷 4개는 이 도구의 표식이 있는 객체(이름에 _zzb2n2, 성적표는 합성 회원 A·B 의 폴더)만 지운다. 그 밖의 객체가 남아 있으면 지우지 않고 left_names 에 적는다.',
      all_zero: leftTotal === 0, report,
    },
  };
}

// ---------------------------------------------------------------------
// compare-facts (요청 0): fingerprint.sql 결과를 사실 자료의 production 과 견준다
// ---------------------------------------------------------------------
async function phaseCompareFacts() {
  if (!args.facts || !args.fingerprint) stop(2, 'compare-facts 는 --facts <사실 자료 json> --fingerprint <fingerprint 결과 json> 이 필요하다');
  const facts = JSON.parse((await readFile(args.facts, 'utf8')).replace(/^\uFEFF/, ''));
  let fp = JSON.parse((await readFile(args.fingerprint, 'utf8')).replace(/^\uFEFF/, ''));
  if (Array.isArray(fp)) fp = fp[0];
  if (fp && fp.result) fp = fp.result;
  const diffs = [];
  const norm = (v) => (v === undefined ? null : v);
  const sortedSet = (a) => [...(a ?? [])].map(String).sort();

  const wantB = new Map(facts.production.buckets.map((b) => [b.id, b]));
  const haveB = new Map((fp.baseline_buckets?.list ?? []).map((b) => [b.id, b]));
  for (const id of new Set([...wantB.keys(), ...haveB.keys()])) {
    const w = wantB.get(id);
    const h = haveB.get(id);
    if (!w || !h) {
      diffs.push({ what: 'bucket', id, problem: !h ? '시험 쪽에 없음' : '사실 자료에 없음' });
      continue;
    }
    for (const k of ['name', 'public', 'file_size_limit', 'avif_autodetection']) {
      if (JSON.stringify(norm(w[k])) !== JSON.stringify(norm(h[k]))) diffs.push({ what: 'bucket', id, field: k, facts: norm(w[k]), test: norm(h[k]) });
    }
    const wm = w.allowed_mime_types == null ? null : sortedSet(w.allowed_mime_types);
    const hm = h.allowed_mime_types == null ? null : sortedSet(h.allowed_mime_types);
    if (JSON.stringify(wm) !== JSON.stringify(hm)) diffs.push({ what: 'bucket', id, field: 'allowed_mime_types(집합)', facts: wm, test: hm });
  }
  const wantP = new Map(facts.production.policies.map((p) => [p.name, p]));
  const haveP = new Map((fp.storage_policies?.list ?? []).filter((p) => !String(p.name).startsWith('zz_b2n2a_')).map((p) => [p.name, p]));
  for (const name of new Set([...wantP.keys(), ...haveP.keys()])) {
    const w = wantP.get(name);
    const h = haveP.get(name);
    if (!w || !h) {
      diffs.push({ what: 'policy', name, problem: !h ? '시험 쪽에 없음' : '사실 자료에 없음' });
      continue;
    }
    for (const k of ['cmd', 'permissive', 'to_public', 'using', 'check']) {
      if (JSON.stringify(norm(w[k])) !== JSON.stringify(norm(h[k]))) diffs.push({ what: 'policy', name, field: k, facts: norm(w[k]), test: norm(h[k]) });
    }
    if (JSON.stringify(sortedSet(w.roles)) !== JSON.stringify(sortedSet(h.roles))) diffs.push({ what: 'policy', name, field: 'roles(집합)', facts: sortedSet(w.roles), test: sortedSet(h.roles) });
  }
  const result = {
    buckets: { facts: wantB.size, test: haveB.size },
    policies: { facts: wantP.size, test: haveP.size },
    same: diffs.length === 0 && wantB.size === haveB.size && wantP.size === haveP.size,
    diffs,
    note: '견준 것: 버킷의 이름·공개 여부·크기 제한·형식 제한(집합)·avif, 규칙의 이름·동작·permissive·역할(집합)·모든 역할 대상 여부·USING·WITH CHECK 글자. 객체 수는 견주지 않는다(시험 쪽 기준은 0).',
  };
  console.log(`[b2n2a] 사실 자료와 대조: 버킷 ${haveB.size}/${wantB.size}, 규칙 ${haveP.size}/${wantP.size}, ${result.same ? '같음' : `다름 ${diffs.length}건`}`);
  for (const d of diffs.slice(0, 20)) console.log('  ' + JSON.stringify(d));
  return { exit: result.same ? 0 : 1, result };
}

// ---------------------------------------------------------------------
// table-ref: 표 쪽 기준 요청(비로그인 GET)의 상태·본문 지문
// ---------------------------------------------------------------------
async function phaseTableRef() {
  const paths = String(env.B2N2A_TABLE_REF_PATHS).split(',').map((s) => s.trim()).filter(Boolean);
  const rows = [];
  for (const p of paths) {
    const r = await http('anon', 'GET', `/rest/v1/${p.replace(/^\/+/, '')}`, { headers: { Accept: 'application/json' } });
    rows.push({ path: p, status: r.status, body_sha256: sha256(r.buf), body_length: r.buf.length });
  }
  let compare = null;
  if (args.compare) {
    const base = JSON.parse((await readFile(args.compare, 'utf8')).replace(/^\uFEFF/, ''));
    const diffs = rows.filter((x) => JSON.stringify(x) !== JSON.stringify((base.result?.rows ?? []).find((y) => y.path === x.path) ?? null));
    compare = { same: diffs.length === 0 && rows.length === (base.result?.rows ?? []).length, diffs };
  }
  return { exit: compare && !compare.same ? 1 : 0, result: { rows, compare } };
}

// ---------------------------------------------------------------------
// 본 실행
// ---------------------------------------------------------------------
async function main() {
  const startedAt = new Date().toISOString();
  const run = args.run ?? Date.now().toString(36);
  let res;
  if (phase === 'baseline-buckets') res = await phaseBucketsCreate(BASELINE_BUCKETS);
  else if (phase === 'probe-buckets') res = await phaseBucketsCreate(PROBE_BUCKETS);
  else if (phase === 'baseline-buckets-remove') res = await phaseBucketsRemove(BASELINE_BUCKETS);
  else if (phase === 'probe-buckets-remove') res = await phaseBucketsRemove(PROBE_BUCKETS);
  else if (phase === 'upsert') res = await phaseUpsert(run);
  else if (phase === 'side') res = await phaseSide(run);
  else if (phase === 'business') res = await phaseBusiness();
  else if (phase === 'fn-live') res = await phaseFnLive(run);
  else if (phase === 'fn-expired') res = await phaseFnSubject(run, 'expired');
  else if (phase === 'fn-loggedout') res = await phaseFnSubject(run, 'loggedout');
  else if (phase === 'cleanup') res = await phaseCleanup();
  else if (phase === 'compare-facts') res = await phaseCompareFacts();
  else res = await phaseTableRef();

  const out = {
    tool: 'b2n2a measure',
    ref: REF,
    phase,
    step,
    run,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    request_count: requestCount,
    key_notes: keyNotes,
    independent_read: '서비스 열쇠의 인증 내려받기(바이트 지문·크기·형식)와 서비스 열쇠의 목록 조회(파일 이름). 소유자는 Storage API 로 볼 수 없어 fingerprint.sql 의 objects 로 본다.',
    has_expectations: ['fn-live', 'fn-expired', 'fn-loggedout', 'compare-facts'].includes(phase),
    exit_code: res.exit,
    result: res.result,
  };
  if (outPath) await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

  const s = res.result?.summary;
  console.log(`[b2n2a] phase=${phase}${step ? ' step=' + step : ''} 요청 ${requestCount}건${s ? `, 판정 ${s.total}건·기대와 다른 것 ${s.mismatch}건` : ''}${res.result?.stopped ? ' — 멈춤: ' + res.result.stopped : ''}`);
  if (outPath) console.log(`[b2n2a] 결과: ${outPath}`);
  process.exit(res.exit);
}

main().catch((e) => {
  console.error(`[b2n2a] 실행 중 멈춤: ${e?.message ?? e}`);
  console.error('[b2n2a] 합성 객체가 남아 있을 수 있다. --phase cleanup 으로 지우고 fingerprint.sql 의 object_counts 로 확인한다.');
  console.error('[b2n2a] 보낸 요청 수: ' + requestCount);
  process.exit(3);
});
