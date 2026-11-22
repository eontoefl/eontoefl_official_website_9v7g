// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-2a 파일 기준선·실측 도구 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 2차(중간 저장 구분): 인증 읽기 주소의 응답은 중간 저장(캐시)된다 — 같은 주소를 다시 읽으면 덮어쓴 뒤·지운 뒤에도
// 옛 바이트가 올 수 있다. 그래서 "실제 저장 상태"는 readTrue 하나로만 읽고(서비스 열쇠 + 매번 다른 임의 값,
// cf-cache-status·age 기록, HIT 이거나 불명확·충돌이면 "미확인"), 재려는 자격의 내려받기는 fresh(판정 근거)와
// same_url(같은 주소 재요청의 관측)로 나눠 적는다. 1차 판(3cd2408)은 브레인방이 시험 프로젝트에서 upsert 단계까지
// 실행했다(올리기·인증 내려받기·버킷 관리의 요청 형식, 권한 오류 400/403, 중복 409 확인). 2차에서 바꾼 것은 아직 실행된 적이 없다.
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
//   B2N2A_JWT_A_EXP     회원 A 의 "만료 시험용" 로그인 상태에서 받은 자격 (fn-expired. cache 단계에서는
//                       "같은 사람의 다른 로그인 상태"로 쓴다 — 그때는 살아 있는 로그인 상태여야 한다)
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
//   cache  [--max-seconds N]  중간 저장의 관측: 같은 주소 재읽기, 덮어쓴 뒤·지운 뒤, 다른 자격,
//                             같은 사람의 다른 로그인 상태, 유지 시간(0·10·30·60·120·300초), 공개 주소  — 잰 값 표
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
import { createHash, randomBytes } from 'node:crypto';
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
  'baseline-buckets', 'probe-buckets', 'upsert', 'side', 'business', 'fn-live', 'cache', 'fn-expired', 'fn-loggedout',
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
    if (['upsert', 'side', 'business', 'fn-live', 'cache', 'fn-expired', 'fn-loggedout'].includes(phase)) {
      anonKey = needEnv('B2N2A_ANON_KEY');
      checkKey('B2N2A_ANON_KEY', anonKey, 'anon');
      if (anonKey === serviceKey) stop(2, 'anon 키와 service 키가 같다');
    }
    if (['upsert', 'side', 'business'].includes(phase)) checkUserJwt('member_a', 'B2N2A_JWT_A', { aal: null, minSeconds: 600 });
    if (['business', 'cleanup', 'fn-live', 'cache', 'fn-expired', 'fn-loggedout'].includes(phase)) needMembers();
    if (phase === 'cache') {
      // 유지 시간을 재는 동안 자격이 살아 있어야 한다(기다리는 시간 + 여유 4분)
      const maxS = Number.isFinite(Number(args['max-seconds'])) ? Math.max(0, Number(args['max-seconds'])) : 300;
      checkUserJwt('member_a', 'B2N2A_JWT_A', { aal: null, minSeconds: maxS + 240 });
      checkUserJwt('member_b', 'B2N2A_JWT_B', { aal: null, minSeconds: 240 });
      checkUserJwt('no_map', 'B2N2A_JWT_N', { aal: null, minSeconds: 240 });
      checkUserJwt('member_a_other', 'B2N2A_JWT_A_EXP', { aal: null, minSeconds: 240 });
      if (jwtInfo.member_a_other.sub !== jwtInfo.member_a.sub) stop(2, 'B2N2A_JWT_A_EXP 가 회원 A 의 자격이 아니다(cache 단계는 같은 사람의 다른 로그인 상태가 필요하다)');
      if (jwtInfo.member_a_other.session_id === jwtInfo.member_a.session_id) stop(2, 'B2N2A_JWT_A_EXP 가 B2N2A_JWT_A 와 같은 로그인 상태다(다른 로그인 상태여야 한다)');
      if (new Set([jwtInfo.member_a.sub, jwtInfo.member_b.sub, jwtInfo.no_map.sub]).size !== 3) stop(2, 'A·B·N 의 자격이 서로 다른 계정이 아니다');
    }
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
const say = (msg) => console.log(`[b2n2a] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nonceCounter = 0;
const newNonce = () => `${Date.now().toString(36)}${(nonceCounter += 1).toString(36)}${randomBytes(6).toString('hex')}`;

function authFor(actor) {
  if (actor === null) return {}; // 공개 주소: 자격 없이
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
  const cf = res.headers.get('cf-cache-status');
  return {
    status: res.status, ok: res.status >= 200 && res.status < 300, buf, contentType, json: parsed,
    // 중간 저장(캐시) 관측용 머리글 — 읽기마다 함께 적는다
    cf: cf ? cf.trim().toUpperCase() : null,
    age: res.headers.get('age'),
    cacheControl: res.headers.get('cache-control'),
  };
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

// --- Storage 객체 API ---
function upload(actor, bucket, path, bytes, { upsert }) {
  const headers = { 'Content-Type': PNG };
  if (upsert === true) headers['x-upsert'] = 'true'; // 화면과 같다. "없음" 칸에서는 머리글을 아예 보내지 않는다.
  return http(actor, 'POST', `/storage/v1/object/${bucket}/${encPath(path)}`, { headers, body: bytes });
}
const removeOne = (actor, bucket, path) => http(actor, 'DELETE', `/storage/v1/object/${bucket}/${encPath(path)}`);
const move = (actor, bucket, from, to) => http(actor, 'POST', '/storage/v1/object/move', { json: { bucketId: bucket, sourceKey: from, destinationKey: to } });
const listRaw = (actor, bucket, prefix, search) => http(actor, 'POST', `/storage/v1/object/list/${bucket}`, {
  json: { prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' }, ...(search ? { search } : {}) },
});

// ---------------------------------------------------------------------
// 중간 저장(캐시)을 구분해 읽기
//   인증 읽기 주소의 응답은 중간 저장된다(같은 주소를 다시 읽으면 덮어쓴 뒤·지운 뒤에도 옛 바이트가 올 수 있다).
//   그래서 읽기를 두 종류로 나눈다.
//     fresh    : 주소에 매번 다른 임의 값을 붙인 새 주소 — 규칙 판정과 "실제 저장 상태"의 근거
//     same_url : 임의 값을 붙이지 않은 그대로의 주소 — 중간 저장의 관측(판정에 쓰지 않는다)
// ---------------------------------------------------------------------
const CLEAR_CACHE_STATUS = new Set(['MISS', 'BYPASS', 'DYNAMIC']);
// 이 응답을 "원 서버가 지금 낸 답"으로 믿을 수 없는 까닭(믿을 수 있으면 null)
function cacheDoubt(cf) {
  if (cf == null) return 'cf-cache-status 머리글이 없음';
  if (cf === 'HIT') return 'cf-cache-status 가 HIT(중간 저장된 응답)';
  if (!CLEAR_CACHE_STATUS.has(cf)) return `cf-cache-status 의 뜻이 불명확(${cf})`;
  return null;
}
function objectUrl(bucket, path, { fresh, pub }) {
  const base = `/storage/v1/object/${pub ? 'public' : 'authenticated'}/${bucket}/${encPath(path)}`;
  return fresh ? `${base}?t=${newNonce()}` : base;
}
// 한 번의 읽기를 그대로 적는다(누가, 어떤 주소로, 무엇이 왔는가)
async function readAs(actor, bucket, path, { fresh, pub = false }) {
  const r = await http(pub ? null : actor, 'GET', objectUrl(bucket, path, { fresh, pub }));
  const info = responseInfo(r);
  return {
    who: pub ? '공개 주소(자격 없음)' : actor,
    url: fresh ? 'fresh' : 'same_url',
    http_status: r.status, ok: r.ok,
    cf_cache_status: r.cf, age: r.age, cache_control: r.cacheControl,
    body: r.ok ? { sha256: sha256(r.buf), size: r.buf.length, content_type: r.contentType } : null,
    error: r.ok ? null : { body_statusCode: info.body_statusCode, body_error: info.body_error, body_message: info.body_message, kind: info.kind },
    cache_doubt: cacheDoubt(r.cf),
  };
}
// 받은 본문이 어느 바이트인가(이름표: original·new 등)
function bodyIs(read, named) {
  if (!read.body) return null;
  for (const [label, bytes] of Object.entries(named)) {
    if (bytes && read.body.sha256 === sha256(bytes) && read.body.size === bytes.length) return label;
  }
  return 'other';
}

// 객체 정보(서비스 열쇠의 목록 조회 — POST 라 주소 단위의 중간 저장을 타지 않는다): 있는지·크기·형식·수정 시각
async function listEntry(bucket, path) {
  const i = path.lastIndexOf('/');
  const folder = i < 0 ? '' : path.slice(0, i);
  const name = i < 0 ? path : path.slice(i + 1);
  const r = await listRaw('service', bucket, folder, name);
  if (!r.ok || !Array.isArray(r.json)) return { error: `${r.status} ${r.buf.toString('utf8').slice(0, 120)}` };
  const it = r.json.find((x) => x.id && String(x.name) === name);
  if (!it) return { present: false };
  return {
    present: true,
    size: it.metadata?.size ?? null,
    mimetype: it.metadata?.mimetype ?? null,
    etag: it.metadata?.eTag ?? null,
    updated_at: it.updated_at ?? null,
  };
}

// ★ 실제 저장 상태를 읽는 함수는 이것 하나다.
//   서비스 열쇠 + 매번 다른 임의 값을 붙인 주소로 읽고, cf-cache-status·age 를 함께 적는다.
//   다음 중 하나면 그 읽기는 "실제 상태 미확인"(known: false)이고 값을 믿지 않는다:
//     cf-cache-status 가 HIT / 머리글이 없거나 뜻이 불명확 / 읽기 오류 / 내려받은 바이트와 객체 정보(목록의 크기·형식·있음)가 어긋남
//   시작 상태 확인·요청 뒤 확인·대조군 확인이 전부 이 함수를 쓴다.
async function readTrue(bucket, path) {
  const rd = await readAs('service', bucket, path, { fresh: true });
  let core = null;
  let doubt = rd.cache_doubt;
  if (rd.ok) core = { exists: true, ...rd.body };
  else if (rd.error.kind === 'not_found') core = { exists: false };
  else doubt = doubt ?? `읽기 오류(${rd.http_status} ${rd.error.kind})`;

  const li = await listEntry(bucket, path);
  if (core && !doubt) {
    if (li.error) doubt = `객체 정보(목록)를 읽지 못함: ${li.error}`;
    else if (core.exists !== li.present) doubt = `내려받기(${core.exists ? '있음' : '없음'})와 객체 정보(${li.present ? '있음' : '없음'})가 어긋남`;
    else if (core.exists && li.size != null && Number(li.size) !== core.size) doubt = `내려받은 크기(${core.size})와 객체 정보의 크기(${li.size})가 어긋남`;
    else if (core.exists && li.mimetype && String(li.mimetype).toLowerCase() !== core.content_type) doubt = `내려받은 형식(${core.content_type})과 객체 정보의 형식(${li.mimetype})이 어긋남`;
  }
  return {
    known: !doubt && !!core,
    ...(core ?? {}),
    unverified: doubt ?? null,
    http_status: rd.http_status,
    cf_cache_status: rd.cf_cache_status, age: rd.age, cache_control: rd.cache_control,
    object_info: li,
  };
}
// 기대한 상태와 정확히 같은가. 읽기가 "미확인"이면 같다고 하지 않는다.
//   want: { exists: false }  또는  { exists: true, sha256, size, content_type }
function stateIs(st, want) {
  if (!st || !st.known) return false;
  if (!want.exists) return st.exists === false;
  return st.exists === true && st.sha256 === want.sha256 && st.size === want.size && st.content_type === want.content_type;
}
const present = (bytes) => ({ exists: true, ...describe(bytes) });
const ABSENT = { exists: false };
const coreOf = (st) => (st?.known ? (st.exists ? { exists: true, sha256: st.sha256, size: st.size, content_type: st.content_type } : { exists: false }) : null);
const sameKnown = (a, b) => !!a?.known && !!b?.known && JSON.stringify(coreOf(a)) === JSON.stringify(coreOf(b));
const allKnown = (state) => Object.values(state).every((s) => s.known);
const doubtsOf = (state) => Object.entries(state).filter(([, s]) => !s.known).map(([p, s]) => `${p.split('/').pop()}: ${s.unverified}`).join(' / ');

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
// 버킷 안의 파일 경로 전부(폴더를 따라 내려간다). 한 폴더에 1000개를 넘으면 여러 번 지우며 다시 훑는다(cleanup 참고).
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
const sameNames = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 칸의 시작 상태를 되돌린다(서비스 열쇠): 대상 이름을 지우고, 있어야 하는 칸이면 원본 바이트로 다시 만든다.
// 서비스 열쇠로 만든 객체의 소유자는 비어 있다(원래 소유 상태). 대조군 파일도 같은 방식으로 둔다.
// 그런 다음 readTrue 로 "있어야 하는 것은 정확히 그 바이트로 있고, 없어야 하는 것은 없음"을 확인한다.
// 읽기가 "미확인"이면 시작 상태도 확인되지 않은 것이다(ok: false).
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
    const st = await readTrue(bucket, s.path);
    state[s.path] = st;
    if (!stateIs(st, s.bytes ? present(s.bytes) : ABSENT)) ok = false;
  }
  return { ok, state };
}
async function readAllTrue(bucket, paths) {
  const state = {};
  for (const p of paths) state[p] = await readTrue(bucket, p);
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
  const after = await readAllTrue(bucket, [target, control]); // 실제 저장 상태(임의 값을 붙인 새 주소)
  const namesAfter = await folderFileNames(bucket, folder);

  let stored;
  if (!after[target].known) stored = 'unverified';
  else if (stateIs(after[target], present(uploaded))) stored = 'uploaded_bytes';
  else if (original && stateIs(after[target], present(original))) stored = 'original_bytes';
  else if (after[target].exists === false) stored = 'absent';
  else stored = 'other';
  const controlUnchanged = stateIs(after[control], present(controlBytes));
  const info = responseInfo(r);

  return {
    cell: `${phaseName}-${pad(no)}`, bucket, actor, name_state: nameState, x_upsert: upsert ? 'true' : '없음',
    path: target, control_path: control, ...extra,
    uploaded: describe(uploaded), original: original ? describe(original) : null,
    start_ok: start.ok, start: start.state,
    response: info, request_ok: r.ok,
    after, after_known: allKnown(after), stored, control_unchanged: controlUnchanged,
    object_names_before: namesBefore, object_names_after: namesAfter,
    object_count_before: namesBefore.length, object_count_after: namesAfter.length,
    state_unchanged: sameKnown(after[target], start.state[target]) && controlUnchanged && sameNames(namesBefore, namesAfter),
  };
}

// 잰 값을 읽는 말(통과·실패가 아니다). 권한 거절로 적으려면 같은 입력의 서비스 열쇠 대조군이 성공해야 한다.
function readingOfUpload(cell, control) {
  if (!cell.start_ok) return `시작 상태가 확인되지 않음(이 칸은 읽지 않는다) ${doubtsOf(cell.start)}`;
  if (!cell.after_known) return `미확인 — 요청 뒤의 실제 저장 상태를 읽지 못함(${doubtsOf(cell.after)})`;
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
        say(`upsert ${no}/48 — ${b.id} ${nameState === 'new' ? '새 이름' : '있는 이름'} x-upsert ${upsert ? 'true' : '없음'}`);
      }
    }
  }
  // 한눈에 보는 표: 버킷(규칙 조합) × 이름 상태 × x-upsert → 자격별 읽는 말
  const table = {};
  for (const c of cells) {
    const key = `${c.bucket} [${c.rule_set}] | ${c.name_state === 'new' ? '새 이름' : '있는 이름'} | x-upsert ${c.x_upsert}`;
    (table[key] ??= {})[c.actor] = `${c.response.http_status}${c.response.body_statusCode ? '/' + c.response.body_statusCode : ''} · ${c.reading}`;
  }
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 잰 값을 그대로 적은 표다. 저장 상태는 전부 readTrue(서비스 열쇠 + 임의 값을 붙인 새 주소)로 읽었고 읽기마다 cf_cache_status 가 적혀 있다. 소유자는 fingerprint.sql 의 objects 에서 path 로 찾아 본다.',
      unverified_cells: cells.filter((c) => !c.start_ok || !c.after_known).map((c) => c.cell),
      table, cells,
    },
  };
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
    start.state[target] = await readTrue(bucket, target);
    if (!stateIs(start.state[target], present(original))) {
      rec.start_ok = false;
      rec.start = start.state;
      rec.reading = '회원이 올린 대상 파일을 만들지 못했거나 확인하지 못해 이 칸은 재지 못함(올리기 응답과 start 를 볼 것)';
      return rec;
    }
  }
  rec.start_ok = start.ok;
  rec.start = start.state;
  const namesBefore = await folderFileNames(bucket, folder);
  rec.object_names_before = namesBefore;
  if (!rec.start_ok) {
    rec.reading = `시작 상태가 확인되지 않음(이 칸은 읽지 않는다) ${doubtsOf(start.state)}`;
    return rec;
  }

  let r = null;
  if (action === 'list') r = await listRaw(actor, bucket, folder);
  else if (action === 'delete') r = await removeOne(actor, bucket, target);
  else if (action === 'move') r = await move(actor, bucket, target, dest);
  if (action === 'download') {
    // 내려받기만 둘로 나눠 적는다: fresh(판정 근거) / same_url(중간 저장 관측 — 그 자격의 첫 읽기와 바로 다음 읽기)
    rec.download = {
      fresh: await readAs(actor, bucket, target, { fresh: true }),
      same_url: [await readAs(actor, bucket, target, { fresh: false }), await readAs(actor, bucket, target, { fresh: false })],
    };
    rec.download.fresh.body_is = bodyIs(rec.download.fresh, { original });
    for (const x of rec.download.same_url) x.body_is = bodyIs(x, { original });
  } else {
    rec.response = responseInfo(r);
    rec.request_ok = r.ok;
  }

  // 응답만으로 판정하지 않는다: 그 뒤 실제 저장 상태(readTrue)로 본 이름·바이트·크기·형식
  const after = await readAllTrue(bucket, [target, control, dest]);
  const namesAfter = await folderFileNames(bucket, folder);
  rec.after = after;
  rec.after_known = allKnown(after);
  rec.object_names_after = namesAfter;
  const ctrlSame = stateIs(after[control], present(controlBytes));
  rec.control_unchanged = ctrlSame;
  if (!rec.after_known) {
    rec.reading = `미확인 — 요청 뒤의 실제 저장 상태를 읽지 못함(${doubtsOf(after)})`;
    return rec;
  }

  if (action === 'list') {
    const returned = r.ok && Array.isArray(r.json) ? r.json.filter((x) => x.id).map((x) => String(x.name)).sort() : null;
    rec.returned_names = returned;
    rec.returned_all = !!returned && sameNames(returned, namesBefore);
    rec.reading = !r.ok ? `목록 요청이 거절됨(${rec.response.kind})`
      : rec.returned_all ? `목록에 그 폴더의 파일 이름이 전부 나옴(${returned.length}개)`
        : returned.length === 0 ? '응답은 성공이지만 목록이 비어 있음(파일은 실제로 있다)'
          : `목록에 일부만 나옴(${returned.length}/${namesBefore.length})`;
  } else if (action === 'download') {
    const f = rec.download.fresh;
    rec.downloaded_exact = f.ok && !f.cache_doubt && f.body_is === 'original';
    rec.reading = f.cache_doubt ? `미확인 — fresh 응답을 믿을 수 없음(${f.cache_doubt})`
      : rec.downloaded_exact ? '내려받아짐(fresh) — 바이트가 정확히 같음'
        : f.ok ? '응답은 성공이지만 받은 바이트가 원본과 다름(fresh)'
          : `내려받기가 거절됨(fresh, ${f.error.kind}) — 파일은 실제로 있다`;
    rec.same_url_note = rec.download.same_url.map((x, i) => `${i + 1}회: ${x.http_status} ${x.cf_cache_status ?? '머리글 없음'} ${x.body_is ?? '본문 없음'}`).join(' / ');
  } else if (action === 'delete') {
    rec.deleted = after[target].exists === false;
    rec.reading = rec.deleted ? '지워짐 — 실제 저장 상태에서 대상이 없음'
      : stateIs(after[target], present(original)) ? `지워지지 않음 — 대상이 원본 그대로(응답 ${rec.response.http_status}${r.ok ? ', 성공이라고 응답' : ', ' + rec.response.kind})`
        : '대상이 원본과 다른 상태로 남음';
  } else {
    rec.moved = after[target].exists === false && stateIs(after[dest], present(original));
    rec.reading = rec.moved ? '옮겨짐 — 출발지 없음, 도착지에 같은 바이트'
      : stateIs(after[target], present(original)) && after[dest].exists === false ? `옮겨지지 않음 — 출발지 원본 그대로, 도착지 없음(응답 ${rec.response.http_status}${r.ok ? ', 성공이라고 응답' : ', ' + rec.response.kind})`
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
        const controlOk = control.start_ok !== false && control.after_known && (
          (action === 'list' && control.returned_all) || (action === 'download' && control.downloaded_exact)
          || (action === 'delete' && control.deleted) || (action === 'move' && control.moved));
        for (const c of group) {
          c.control_cell = control.cell;
          c.control_ok = !!controlOk;
          if (c.actor !== 'service' && c.start_ok !== false && c.after_known && !controlOk) c.reading += ' / 권한 미판정 — 같은 입력의 서비스 열쇠 대조군도 성공하지 못함';
          cells.push(c);
        }
        say(`side ${no}/64 — ${b.id} ${origin} ${action}`);
      }
    }
  }
  const table = {};
  for (const c of cells.filter((x) => x.actor === 'member_a')) {
    const key = `${c.bucket} [${c.rule_set}] | 대상 파일을 만든 쪽: ${c.origin === 'service' ? '서비스 열쇠' : '회원 A'}`;
    (table[key] ??= {})[c.action] = c.reading + (c.same_url_note ? ` ‖ 같은 주소 재요청: ${c.same_url_note}` : '');
  }
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 잰 값을 그대로 적은 표다. 삭제·이동 뒤의 상태는 readTrue 로 읽었다. 내려받기는 fresh(판정 근거)와 same_url(같은 주소 재요청의 관측)을 따로 적는다. 소유자는 fingerprint.sql 의 objects 에서 path 로 찾아 본다.',
      unverified_cells: cells.filter((c) => c.start_ok === false || c.after_known === false).map((c) => c.cell),
      table, cells,
    },
  };
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
      const before = await readTrue(s.bucket, s.path); // 새 이름이어야 한다(비어 있음)
      const r = await upload(actor, s.bucket, s.path, bytes, { upsert: true }); // 화면과 같이 x-upsert: true
      const after = await readTrue(s.bucket, s.path);
      const pub = await readAs(null, s.bucket, s.path, { fresh: true, pub: true });
      const rec = {
        cell: `business-${pad(no)}`, bucket: s.bucket, actor, path_shape: s.shape, path: s.path, screen: s.screen, x_upsert: 'true',
        uploaded: describe(bytes), before, name_was_empty: stateIs(before, ABSENT),
        response: responseInfo(r), request_ok: r.ok, after,
        stored_exact: stateIs(after, present(bytes)),
        public_url: { http_status: pub.http_status, cf_cache_status: pub.cf_cache_status, age: pub.age, cache_control: pub.cache_control },
        how_to_read: s.how_to_read,
      };
      rec.reading = !before.known || !after.known ? `미확인 — 실제 저장 상태를 읽지 못함(${before.unverified ?? after.unverified})`
        : !rec.name_was_empty ? '시작 상태가 기대와 다름(이름이 비어 있지 않았다)'
          : rec.request_ok && rec.stored_exact ? '받아들여짐 — 올린 바이트가 정확히 저장됨'
            : rec.request_ok ? '받아들여졌다고 응답했으나 저장값이 올린 바이트가 아님'
              : after.exists ? '거절 응답인데 파일이 생김' : `거절(${rec.response.kind}) — 요청 전후 모두 이름이 비어 있음`;
      cells.push(rec);
    }
    say(`business ${no}/24 — 자격 ${actor}`);
    ts += 100; // 자격마다 다른 시각 값 → 서로 다른 새 이름
  }
  for (const c of cells) {
    const control = cells.find((x) => x.actor === 'service' && x.bucket === c.bucket && x.path_shape === c.path_shape);
    c.control_cell = control.cell;
    c.control_ok = control.request_ok && control.stored_exact;
    if (c.actor !== 'service' && !c.request_ok && c.response.kind === 'rls' && c.before.known && c.after.known && c.name_was_empty && c.after.exists === false) {
      c.reading = c.control_ok ? '권한 거절 — 같은 모양의 요청이 서비스 열쇠로는 성공(대조군 있음), 요청 전후 모두 이름이 비어 있음' : '권한 미판정 — 서비스 열쇠 대조군도 성공하지 못함';
    }
  }
  const table = {};
  for (const c of cells) (table[`${c.bucket} | ${c.path_shape}`] ??= {})[c.actor] = `${c.response.http_status}${c.response.body_statusCode ? '/' + c.response.body_statusCode : ''} · ${c.reading}`;
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 지금 규칙 그대로의 실측이다. 비로그인 칸은 2b 의 "옛 경로" 기준, 로그인 칸은 "지금 새 로그인으로 보내면 무엇이 되고 안 되는가"다. public_url 은 참고일 뿐 규칙의 증거가 아니다(공개 버킷의 공개 주소는 규칙과 무관하게 열린다).',
      how_to_read_general: [
        'materials 에 올리는 요청은 확인된 화면 호출이 없는 합성 진단 요청이다(업무 보존의 증거가 아님).',
        'guide-images 와 성적표의 관리자 경로(<회원번호>/…)에 회원 자격으로 보낸 요청이 되더라도, 그것은 "관리자 업무가 된다"가 아니라 "지금 그 경로가 회원에게도 열려 있다"는 사실이다.',
      ],
      table, cells,
    },
  };
}

// ---------------------------------------------------------------------
// fn-*: 판정 함수 버킷 (기대값을 대조하는 단계)
//   올리기·덮어쓰기·삭제의 판정은 readTrue 로 한다.
//   내려받기의 판정은 fresh(임의 값을 붙인 새 주소)로만 하고, same_url(같은 주소 재요청)은 따로 적는다.
// ---------------------------------------------------------------------
const FN_ACTIONS = ['upload', 'download', 'overwrite', 'delete'];

async function fnAttempt({ run, tag, no, folder, actor, action, primer }) {
  const base = `${folder}/r${run}-${tag}-${pad(no)}`;
  const target = `${base}-t.png`;
  const control = `${base}-c.png`;
  const original = action === 'upload' ? null : makePng(`${run} ${tag} ${no} original`);
  const controlBytes = makePng(`${run} ${tag} ${no} control`);
  const fresh = makePng(`${run} ${tag} ${no} new by ${actor}`);
  const namePrefix = `r${run}-${tag}-${pad(no)}-`;

  // 시작 상태 되돌리기 + 확인(readTrue): 내려받기·덮어쓰기·삭제는 대상 파일이 실제로 있음, 새로 올리기는 이름이 비어 있음
  const start = await restoreStart(FN_BUCKET, [{ path: target, bytes: original }, { path: control, bytes: controlBytes }]);
  const namesBefore = await folderFileNames(FN_BUCKET, folder, namePrefix);

  let r = null;
  let dl = null;
  if (action === 'upload' || action === 'overwrite') r = await upload(actor, FN_BUCKET, target, fresh, { upsert: true });
  else if (action === 'delete') r = await removeOne(actor, FN_BUCKET, target);
  else {
    dl = { primed_by: null, prime_reads: [] };
    // 같은 주소를 "앞서 읽은 주소"로 만들어 둔다: 그 폴더에 권한이 있는 자격이 같은 주소를 두 번 읽는다(1회·2회).
    if (primer) {
      dl.primed_by = primer;
      for (let i = 0; i < 2; i += 1) {
        const p = await readAs(primer, FN_BUCKET, target, { fresh: false });
        p.body_is = bodyIs(p, { original });
        dl.prime_reads.push(p);
      }
    }
    dl.fresh = await readAs(actor, FN_BUCKET, target, { fresh: true });      // 규칙 판정의 근거
    dl.fresh.body_is = bodyIs(dl.fresh, { original });
    dl.same_url = await readAs(actor, FN_BUCKET, target, { fresh: false });  // 같은 주소 재요청의 응답(판정에 쓰지 않는다)
    dl.same_url.body_is = bodyIs(dl.same_url, { original });
  }

  const after = await readAllTrue(FN_BUCKET, [target, control]);
  const namesAfter = await folderFileNames(FN_BUCKET, folder, namePrefix);
  const info = r ? responseInfo(r) : null;
  const tName = target.split('/').pop();
  const cName = control.split('/').pop();
  const controlSame = stateIs(after[control], present(controlBytes));
  const targetAsStart = stateIs(after[target], original ? present(original) : ABSENT);
  const unchanged = targetAsStart && controlSame && sameNames(namesBefore, namesAfter);

  let outcome;
  if (!start.ok) {
    outcome = `undetermined(시작 상태 미확인: ${doubtsOf(start.state) || '기대한 상태가 아님'})`;
  } else if (!allKnown(after)) {
    outcome = `undetermined(요청 뒤의 실제 상태 미확인: ${doubtsOf(after)})`;
  } else if (action === 'download') {
    const f = dl.fresh;
    if (f.cache_doubt) outcome = `undetermined(fresh 응답을 믿을 수 없음: ${f.cache_doubt})`;
    else if (f.ok && f.body_is === 'original' && unchanged) outcome = 'allow';
    // 거절 인정: fresh 가 받아들여지지 않았고, 같은 파일이 그 순간 독립 읽기(readTrue)로는 정상으로 읽힘(시작·요청 뒤 모두)
    else if (!f.ok && unchanged) outcome = f.error.kind === 'jwt' ? 'undetermined(자격 자체가 거절됨 — 규칙의 거절이 아님)' : 'deny';
    else outcome = 'anomaly';
  } else if (action === 'upload') {
    if (r.ok && stateIs(after[target], present(fresh)) && controlSame && sameNames(namesAfter, [cName, tName].sort())) outcome = 'allow';
    // 거절 인정: 받아들여지지 않았고, 그 이름이 요청 전과 후 모두 비어 있음
    else if (!r.ok && stateIs(start.state[target], ABSENT) && stateIs(after[target], ABSENT) && controlSame && sameNames(namesBefore, namesAfter)) {
      outcome = info.kind === 'jwt' ? 'undetermined(자격 자체가 거절됨 — 규칙의 거절이 아님)' : 'deny';
    } else outcome = 'anomaly';
  } else if (action === 'overwrite') {
    if (r.ok && stateIs(after[target], present(fresh)) && controlSame && sameNames(namesAfter, [cName, tName].sort())) outcome = 'allow';
    // 거절 인정: 받아들여지지 않았고, 같은 파일이 그 순간 독립 읽기로 원본 그대로 읽힘
    else if (!r.ok && unchanged) outcome = info.kind === 'jwt' ? 'undetermined(자격 자체가 거절됨 — 규칙의 거절이 아님)' : 'deny';
    else outcome = 'anomaly';
  } else {
    if (r.ok && stateIs(after[target], ABSENT) && controlSame && sameNames(namesAfter, [cName])) outcome = 'allow';
    // 거절 인정: 같은 파일이 그 순간 독립 읽기로 원본 그대로 읽힘(성공이라고 응답했더라도 지워진 것이 없으면 거절)
    else if (unchanged) outcome = !r.ok && info.kind === 'jwt' ? 'undetermined(자격 자체가 거절됨 — 규칙의 거절이 아님)' : 'deny';
    else outcome = 'anomaly';
  }

  return {
    actor, action, folder, path: target, control_path: control,
    start_ok: start.ok, start: start.state,
    target_existed_before: original ? stateIs(start.state[target], present(original)) : false, name_was_empty_before: stateIs(start.state[target], ABSENT),
    response: info, request_ok: r ? r.ok : null, download: dl, after,
    object_names_before: namesBefore, object_names_after: namesAfter,
    state_unchanged: unchanged, outcome,
  };
}

// 한 줄(자격·폴더·동작) = 시도 1번 + (거절이 기대인 줄은) 같은 입력의 서비스 열쇠 대조군 1번
async function fnRow({ run, tag, counter, caseName, folder, actor, action, expect, primer }) {
  const attempt = await fnAttempt({ run, tag, no: counter.next(), folder, actor, action, primer });
  const row = { case: caseName, actor, folder, action, expect, ...attempt, control: null };
  if (expect === 'deny') {
    const c = await fnAttempt({ run, tag, no: counter.next(), folder, actor: 'service', action, primer: null });
    row.control = { outcome: c.outcome, response: c.response, download_fresh: c.download?.fresh ?? null, path: c.path };
    if (c.outcome !== 'allow' && row.outcome === 'deny') row.outcome = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군도 성공하지 못함)';
  }
  row.match = row.outcome === expect;
  // 내려받기 줄: 같은 주소 재요청에 본문이 왔는가(판정과 따로 적는다)
  if (action === 'download') {
    const s = row.download.same_url;
    row.same_url_delivered_body = !!s.body;
    row.same_url_note = `${s.http_status} ${s.cf_cache_status ?? '머리글 없음'}${s.age != null ? ' age ' + s.age : ''} — ${s.body ? `본문이 옴(${s.body_is})` : '본문 없음'}`;
  }
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
  const dls = rows.filter((r) => r.action === 'download');
  return {
    total: rows.length, mismatch: mismatch.length, table,
    mismatches: mismatch.map((r) => ({ case: r.case, action: r.action, expect: r.expect, outcome: r.outcome, response: r.response, download_fresh: r.download?.fresh ?? null })),
    // 판정(fresh)과 따로 적는 관측: 같은 주소 재요청
    same_url_observations: Object.fromEntries(dls.map((r) => [r.case, `정책 판정(fresh): ${r.outcome} ‖ 같은 주소 재요청: ${r.same_url_note}`])),
    denied_but_same_url_delivered: dls.filter((r) => r.outcome === 'deny' && r.same_url_delivered_body).map((r) => r.case),
  };
}

async function phaseFnLive(run) {
  // primer: 그 폴더에 권한이 있는 자격. 내려받기 줄에서 같은 주소를 먼저 두 번 읽어 "앞서 읽은 주소"로 만든다.
  const cases = [
    { name: 'A 가 자기 폴더', actor: 'member_a', folder: memberA, expect: 'allow', primer: 'member_a' },
    { name: 'B 가 A 의 폴더', actor: 'member_b', folder: memberA, expect: 'deny', primer: 'member_a' },
    { name: 'A 가 B 의 폴더', actor: 'member_a', folder: memberB, expect: 'deny', primer: 'member_b' },
    { name: '대응 없는 계정이 A 의 폴더', actor: 'no_map', folder: memberA, expect: 'deny', primer: 'member_a' },
    { name: '관리자 6자리 전이 admin 폴더', actor: 'admin_pre', folder: 'admin', expect: 'deny', primer: 'admin_post' },
    { name: '관리자 6자리 후가 admin 폴더', actor: 'admin_post', folder: 'admin', expect: 'allow', primer: 'admin_post' },
    // 아래 둘은 계약서 목록 밖의 보탬: 임시 규칙이 "회원은 자기 폴더만, 관리자는 admin 폴더만"인지
    { name: '(보탬) A 가 admin 폴더', actor: 'member_a', folder: 'admin', expect: 'deny', primer: 'admin_post' },
    { name: '(보탬) 관리자 6자리 후가 A 의 폴더', actor: 'admin_post', folder: memberA, expect: 'deny', primer: 'member_a' },
  ];
  const counter = makeCounter();
  const rows = [];
  for (const c of cases) {
    for (const action of FN_ACTIONS) rows.push(await fnRow({ run, tag: 'live', counter, caseName: c.name, folder: c.folder, actor: c.actor, action, expect: c.expect, primer: c.primer }));
    say(`fn-live ${rows.length}/32 — ${c.name}`);
  }
  const summary = fnSummary(rows);
  if (summary.denied_but_same_url_delivered.length) say(`fn-live 관측: 정책 판정은 거절인데 같은 주소 재요청에 본문이 온 줄 — ${summary.denied_but_same_url_delivered.join(' / ')}`);
  return {
    exit: summary.mismatch ? 1 : 0,
    result: {
      credentials: jwtInfo,
      note: '종료 값과 summary.mismatch 는 정책 판정(올리기·덮어쓰기·삭제는 readTrue, 내려받기는 fresh)만 센다. 같은 주소 재요청(same_url)은 summary.same_url_observations 에 따로 적는다 — 둘을 합쳐 하나의 통과로 만들지 않는다.',
      summary, rows,
    },
  };
}

// 만료·로그아웃 시험의 "앞서 읽은 주소": pre 와 post 가 서로 다른 실행이므로, 로그인 상태 번호로 정해지는 이름과 바이트를 쓴다.
function revocationProbe(kind) {
  const sid = jwtInfo.subject.session_id;
  return { path: `${memberA}/zzrev-${kind}-${sid.slice(0, 8)}.png`, bytes: makePng(`revocation probe ${kind} ${sid}`) };
}

async function phaseFnSubject(run, kind) {
  // kind: 'expired' | 'loggedout'.  pre·restored = 허용이 기대, post = 거절이 기대
  const expect = step === 'post' ? 'deny' : 'allow';
  const caseName = kind === 'expired'
    ? { pre: '만료 전(먼저 허용 확인)', post: 'not_after 를 과거로 바꾼 뒤 — 이미 받아 둔 같은 자격', restored: 'not_after 를 원래 값으로 되돌린 뒤' }[step]
    : { pre: '로그아웃 전(먼저 허용 확인)', post: '로그아웃한 뒤 — 이미 받아 둔 같은 자격' }[step];
  const probe = revocationProbe(kind);
  const pr = { path: probe.path, bytes: describe(probe.bytes) };

  if (step === 'pre') {
    // 정상 자격으로 "바로 그 주소"에서 본문을 받아 둔다(그래야 post 의 same_url 이 "앞서 읽은 주소"다).
    const start = await restoreStart(FN_BUCKET, [{ path: probe.path, bytes: probe.bytes }]);
    pr.true_state = start.state[probe.path];
    pr.same_url_reads = [];
    for (let i = 0; i < 2; i += 1) {
      const x = await readAs('subject', FN_BUCKET, probe.path, { fresh: false });
      x.body_is = bodyIs(x, { original: probe.bytes });
      pr.same_url_reads.push(x);
    }
    pr.body_received_at_same_url = pr.same_url_reads.some((x) => x.body_is === 'original');
    pr.statement = !start.ok ? '앞서 읽을 파일을 만들지 못했거나 확인하지 못함'
      : pr.body_received_at_same_url ? '정상 자격으로 그 주소에서 본문을 받았다(post 의 same_url 이 "앞서 읽은 주소"가 된다)'
        : '정상 자격인데 그 주소에서 본문을 받지 못함 — post 의 재전달 관측은 뜻이 없다';
  } else {
    // 파일이 그 순간 실제로 있는가(readTrue) → 정책 판정(fresh) → 실제 재전달(same_url). 둘을 따로 적는다.
    pr.true_state = await readTrue(FN_BUCKET, probe.path);
    const fileThere = stateIs(pr.true_state, present(probe.bytes));
    const f = await readAs('subject', FN_BUCKET, probe.path, { fresh: true });
    f.body_is = bodyIs(f, { original: probe.bytes });
    const s = await readAs('subject', FN_BUCKET, probe.path, { fresh: false });
    s.body_is = bodyIs(s, { original: probe.bytes });
    let outcome;
    if (!fileThere) outcome = `undetermined(pre 단계의 파일이 그대로 있는지 확인하지 못함: ${pr.true_state.unverified ?? '없거나 다른 바이트'})`;
    else if (f.cache_doubt) outcome = `undetermined(fresh 응답을 믿을 수 없음: ${f.cache_doubt})`;
    else if (f.ok && f.body_is === 'original') outcome = 'allow';
    else if (!f.ok) outcome = f.error.kind === 'jwt' ? 'undetermined(자격 자체가 거절됨 — 규칙의 거절이 아님)' : 'deny';
    else outcome = 'anomaly';
    pr.policy = { basis: 'fresh(임의 값을 붙인 새 주소)', expect, outcome, match: outcome === expect, fresh: f };
    pr.redelivery = {
      basis: 'same_url(pre 단계에서 이 자격이 본문을 받은 바로 그 주소)',
      delivered_body: !!s.body, body_is: s.body_is,
      http_status: s.http_status, cf_cache_status: s.cf_cache_status, age: s.age, cache_control: s.cache_control, same_url: s,
    };
    if (step === 'post') {
      pr.statement = outcome !== 'deny' ? `정책 판정이 거절이 아님(${outcome})` + (s.body ? ' / 같은 주소 재요청에는 본문이 옴' : '')
        : s.body ? '정책 시험은 통과, 즉시 회수는 실패 — 새 주소 요청은 거절됐지만, 앞서 읽은 같은 주소에는 본문이 다시 전달됨'
          : '정책 시험은 통과 — 새 주소 요청이 거절됐고, 앞서 읽은 같은 주소에도 본문이 오지 않음(이 시점·이 주소·이 자격에 대한 관측)';
    } else {
      pr.statement = outcome === 'allow' ? '되돌린 뒤 새 주소 요청이 다시 허용됨' : `되돌린 뒤인데 허용이 아님(${outcome})`;
    }
  }

  const counter = makeCounter();
  const rows = [];
  for (const action of FN_ACTIONS) {
    rows.push(await fnRow({ run, tag: `${kind}-${step}`, counter, caseName, folder: memberA, actor: 'subject', action, expect, primer: null }));
    say(`fn-${kind} ${step} ${rows.length}/4 — ${action}`);
  }
  const summary = fnSummary(rows);
  const probePolicyMismatch = pr.policy ? !pr.policy.match : false;
  const preProbeFailed = step === 'pre' && !pr.body_received_at_same_url;
  const left = decodeJwtPayload(jwts.subject).exp - Math.floor(Date.now() / 1000);
  say(`fn-${kind} ${step} — 정책 판정: 다른 것 ${summary.mismatch + (probePolicyMismatch ? 1 : 0)}건 ‖ 앞서 읽은 주소: ${pr.statement}`);
  return {
    exit: summary.mismatch || probePolicyMismatch || preProbeFailed ? 1 : 0,
    result: {
      credential: { ...jwtInfo.subject, seconds_left_at_end: left },
      note: step === 'post'
        ? '두 가지를 따로 읽는다. ① 정책 판정(summary 와 revocation_probe.policy — 기대값 거절, 종료 값은 이것만 센다) ② 실제 재전달(revocation_probe.redelivery — pre 에서 본문을 받은 같은 주소에 본문이 다시 왔는가). ①이 거절이고 ②에 본문이 오면 "정책 시험은 통과, 즉시 회수는 실패"다. 둘을 합쳐 하나의 통과로 만들지 않는다. 거절이 규칙 때문인지 보려면 seconds_left_at_end 가 0보다 크고, 응답 종류가 jwt 가 아니며, 서비스 열쇠 대조군이 allow 여야 한다.'
        : step === 'pre' ? '같은 자격으로 네 동작이 모두 허용됨을 확인하고, revocation_probe 에 "정상 자격으로 그 주소에서 본문을 받았음"을 적는다.'
          : '원래 값으로 되돌린 뒤 다시 허용되는지 본다.',
      policy_mismatch_total: summary.mismatch + (probePolicyMismatch ? 1 : 0),
      revocation_probe: pr,
      summary, rows,
    },
  };
}

// ---------------------------------------------------------------------
// cache: 중간 저장의 관측 (잰 값 표, 기대값 없음)
//   인증 경로: 판정 함수 버킷, 회원 A 의 자기 폴더 파일. 공개 주소: 기준선의 공개 버킷 하나(guide-images) — 표를 따로 낸다.
// ---------------------------------------------------------------------
const RETENTION_OFFSETS = [0, 10, 30, 60, 120, 300];

function shortRead(label, rd, named) {
  return {
    label, who: rd.who, url: rd.url, http_status: rd.http_status,
    cf_cache_status: rd.cf_cache_status, age: rd.age, cache_control: rd.cache_control,
    body_sha256: rd.body?.sha256 ?? null, body_is: bodyIs(rd, named) ?? '본문 없음',
    error_kind: rd.error?.kind ?? null, error_message: rd.error?.body_message ?? null,
  };
}

async function phaseCache(run) {
  const maxSeconds = Number.isFinite(Number(args['max-seconds'])) ? Math.max(0, Number(args['max-seconds'])) : 300;
  const offsets = RETENTION_OFFSETS.filter((t) => t <= maxSeconds);
  const lastOffset = offsets[offsets.length - 1];
  const A = memberA;
  const file = (n) => `${A}/r${run}-cache-${n}.png`;
  const auth = {};   // 인증 경로의 표
  const mk = async (bucket, path, bytes) => {
    const st = await restoreStart(bucket, [{ path, bytes }]);
    return { start_ok: st.ok, start: st.state[path] };
  };
  const trueRow = async (label, bucket, path, named) => {
    const t = await readTrue(bucket, path);
    return {
      label, who: 'service(readTrue)', url: 'fresh', http_status: t.http_status, cf_cache_status: t.cf_cache_status, age: t.age, cache_control: t.cache_control,
      known: t.known, unverified: t.unverified,
      body_sha256: t.sha256 ?? null,
      body_is: !t.known ? '미확인' : !t.exists ? '없음' : (Object.entries(named).find(([, b]) => b && t.sha256 === sha256(b))?.[0] ?? 'other'),
    };
  };

  // E1. 같은 주소 재읽기: 1회·2회·3회, 그리고 새 주소
  {
    const p = file('e1');
    const original = makePng(`${run} cache e1 original`);
    const s = await mk(FN_BUCKET, p, original);
    const reads = [];
    for (let i = 1; i <= 3; i += 1) reads.push(shortRead(`A 같은 주소 ${i}회`, await readAs('member_a', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('A 새 주소', await readAs('member_a', FN_BUCKET, p, { fresh: true }), { original }));
    auth.e1_same_url_rereads = { path: p, ...s, reads };
    say('cache E1 같은 주소 재읽기 — ' + reads.map((x) => `${x.cf_cache_status ?? '-'}`).join(' → '));
  }

  // E2. 덮어쓴 뒤: 같은 주소와 새 주소
  {
    const p = file('e2');
    const original = makePng(`${run} cache e2 original`);
    const replaced = makePng(`${run} cache e2 replaced`);
    const named = { original, replaced };
    const s = await mk(FN_BUCKET, p, original);
    const reads = [];
    for (let i = 1; i <= 2; i += 1) reads.push(shortRead(`덮어쓰기 전 A 같은 주소 ${i}회`, await readAs('member_a', FN_BUCKET, p, { fresh: false }), named));
    const ow = await upload('service', FN_BUCKET, p, replaced, { upsert: true });
    reads.push({ label: '서비스 열쇠로 덮어씀(x-upsert: true)', http_status: ow.status, ok: ow.ok });
    reads.push(await trueRow('덮어쓴 뒤 실제 저장 상태', FN_BUCKET, p, named));
    reads.push(shortRead('덮어쓴 뒤 A 같은 주소', await readAs('member_a', FN_BUCKET, p, { fresh: false }), named));
    reads.push(shortRead('덮어쓴 뒤 A 새 주소', await readAs('member_a', FN_BUCKET, p, { fresh: true }), named));
    auth.e2_after_overwrite = { path: p, ...s, reads };
    say('cache E2 덮어쓴 뒤 — 같은 주소: ' + reads[4].body_is + ', 새 주소: ' + reads[5].body_is);
  }

  // E4. 다른 사람이 같은 주소를 요청했을 때 (A 가 읽어 둔 주소)
  {
    const p = file('e4');
    const original = makePng(`${run} cache e4 original`);
    const s = await mk(FN_BUCKET, p, original);
    const reads = [];
    for (let i = 1; i <= 2; i += 1) reads.push(shortRead(`A 같은 주소 ${i}회(먼저 읽어 둠)`, await readAs('member_a', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('B 같은 주소', await readAs('member_b', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('대응 없는 계정 같은 주소', await readAs('no_map', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('비로그인 같은 주소', await readAs('anon', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('A 같은 주소(다른 사람들 뒤)', await readAs('member_a', FN_BUCKET, p, { fresh: false }), { original }));
    auth.e4_other_people_same_url = { path: p, ...s, reads };
    say('cache E4 다른 사람 — ' + reads.slice(2, 5).map((x) => `${x.who}: ${x.http_status} ${x.cf_cache_status ?? '-'} ${x.body_is}`).join(' / '));
  }

  // E5. 같은 사람의 다른 로그인 상태에서 받은 자격으로 같은 주소
  {
    const p = file('e5');
    const original = makePng(`${run} cache e5 original`);
    const s = await mk(FN_BUCKET, p, original);
    const reads = [];
    for (let i = 1; i <= 2; i += 1) reads.push(shortRead(`A(평소 로그인 상태) 같은 주소 ${i}회`, await readAs('member_a', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('A(다른 로그인 상태) 같은 주소 — 이 자격의 첫 읽기', await readAs('member_a_other', FN_BUCKET, p, { fresh: false }), { original }));
    reads.push(shortRead('A(다른 로그인 상태) 새 주소', await readAs('member_a_other', FN_BUCKET, p, { fresh: true }), { original }));
    auth.e5_same_person_other_login = { path: p, ...s, sessions: { usual: jwtInfo.member_a.session_id, other: jwtInfo.member_a_other.session_id }, reads };
    say('cache E5 같은 사람의 다른 로그인 상태 — ' + `${reads[2].http_status} ${reads[2].cf_cache_status ?? '-'} ${reads[2].body_is}`);
  }

  // E3(인증)·E6(공개): 지운 뒤 같은 주소·새 주소, 그리고 유지 시간. 두 경로를 같은 시간표로 함께 잰다(표는 따로).
  const p3 = file('e3');
  const o3 = makePng(`${run} cache e3 original`);
  const s3 = await mk(FN_BUCKET, p3, o3);
  const reads3 = [];
  for (let i = 1; i <= 2; i += 1) reads3.push(shortRead(`지우기 전 A 같은 주소 ${i}회`, await readAs('member_a', FN_BUCKET, p3, { fresh: false }), { original: o3 }));

  const PUB_BUCKET = 'guide-images';
  const p6 = `${Date.now()}_${BUSINESS_MARK}_cache.png`; // cleanup 이 표식(_zzb2n2)으로 지운다
  const o6 = makePng(`${run} cache e6 public original`);
  const s6 = await mk(PUB_BUCKET, p6, o6);
  const reads6 = [];
  for (let i = 1; i <= 2; i += 1) reads6.push(shortRead(`지우기 전 공개 주소 같은 주소 ${i}회`, await readAs(null, PUB_BUCKET, p6, { fresh: false, pub: true }), { original: o6 }));
  reads6.push(shortRead('지우기 전 공개 주소 새 주소', await readAs(null, PUB_BUCKET, p6, { fresh: true, pub: true }), { original: o6 }));

  const d3 = await removeOne('service', FN_BUCKET, p3);
  const d6 = await removeOne('service', PUB_BUCKET, p6);
  const deletedAt = Date.now();
  reads3.push({ label: '서비스 열쇠로 지움', http_status: d3.status, ok: d3.ok });
  reads6.push({ label: '서비스 열쇠로 지움', http_status: d6.status, ok: d6.ok });
  reads3.push(await trueRow('지운 뒤 실제 저장 상태', FN_BUCKET, p3, { original: o3 }));
  reads6.push(await trueRow('지운 뒤 실제 저장 상태(인증 경로로 읽음)', PUB_BUCKET, p6, { original: o6 }));
  reads3.push(shortRead('지운 뒤 A 새 주소', await readAs('member_a', FN_BUCKET, p3, { fresh: true }), { original: o3 }));
  reads6.push(shortRead('지운 뒤 공개 주소 새 주소', await readAs(null, PUB_BUCKET, p6, { fresh: true, pub: true }), { original: o6 }));

  const ret3 = [];
  const ret6 = [];
  for (const t of offsets) {
    const wait = deletedAt + t * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    const elapsed = Math.round((Date.now() - deletedAt) / 100) / 10;
    const a = shortRead(`삭제 후 ${t}초 시점 A 같은 주소`, await readAs('member_a', FN_BUCKET, p3, { fresh: false }), { original: o3 });
    const b = shortRead(`삭제 후 ${t}초 시점 공개 주소 같은 주소`, await readAs(null, PUB_BUCKET, p6, { fresh: false, pub: true }), { original: o6 });
    ret3.push({ scheduled_seconds: t, elapsed_seconds: elapsed, ...a });
    ret6.push({ scheduled_seconds: t, elapsed_seconds: elapsed, ...b });
    say(`cache 유지 시간 — 삭제 후 ${t}초: 인증 ${a.http_status} ${a.cf_cache_status ?? '-'} ${a.body_is} / 공개 ${b.http_status} ${b.cf_cache_status ?? '-'} ${b.body_is}`);
  }
  // 유지 시간을 읽는 말: 마지막 시점에도 옛 바이트가 오면 "그 시점에도 관측, 끝나는 시각 미확인"이다(더 기다리지 않는다).
  const retentionStatement = (rows) => {
    const got = rows.filter((x) => x.body_is === 'original');
    if (got.length === 0) return '지운 뒤 같은 주소에서 옛 바이트가 한 번도 오지 않음(0초 시점부터)';
    const lastGot = got[got.length - 1].scheduled_seconds;
    const firstGone = rows.find((x) => x.scheduled_seconds > lastGot && x.body_is !== 'original');
    if (!firstGone) return `삭제 후 ${lastGot}초 시점에도 관측, 끝나는 시각 미확인`;
    return `삭제 후 ${lastGot}초 시점까지 옛 바이트가 관측됐고, ${firstGone.scheduled_seconds}초 시점에는 오지 않음(끝난 시각은 그 사이 — 정확한 시각은 재지 않음)`;
  };
  auth.e3_after_delete = { path: p3, ...s3, reads: reads3, retention: ret3, retention_statement: retentionStatement(ret3) };
  const pub = {
    bucket: PUB_BUCKET, path: p6, ...s6, reads: reads6, retention: ret6, retention_statement: retentionStatement(ret6),
    note: '공개 주소(/object/public/…)의 관측이다. 인증 경로의 표와 섞어 읽지 않는다. 공개 버킷의 공개 주소는 규칙과 무관하게 열린다.',
  };

  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 잰 값을 그대로 적은 표다. 각 읽기에 상태·cf_cache_status·age·cache_control·바이트 지문(body_sha256)과 그것이 어느 바이트인지(body_is)를 적는다. 여기서 본 것은 이 버킷·이 파일·이 자격들에 대한 관측이다(중간 저장이 어떤 단위로 나뉘는지의 원리나 운영의 설정을 입증하지 않는다).',
      max_seconds: maxSeconds, retention_offsets: offsets, last_offset: lastOffset,
      authenticated_path: auth,
      public_path: pub,
      statements: {
        인증_지운_뒤_유지: auth.e3_after_delete.retention_statement,
        공개_지운_뒤_유지: pub.retention_statement,
      },
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
    // 이번 실행뿐 아니라 앞선 실행이 남긴 합성 객체까지 지운다(실행 번호를 가리지 않는다).
    // 한 폴더의 목록은 한 번에 1000개까지라, 더 지울 것이 없을 때까지 훑고 지우기를 되풀이한다.
    const isProbe = id.startsWith('zz-b2n2a-');
    let found = 0;
    let deleted = 0;
    for (let round = 0; round < 50; round += 1) {
      const all = await walk(id);
      if (round === 0) found = all.length;
      const mine = isProbe ? all : BUSINESS_BUCKETS.includes(id) ? all.filter((p) => isSyntheticBusinessObject(id, p)) : [];
      if (!mine.length) break;
      await removeMany(id, mine);
      deleted += mine.length;
    }
    const left = await walk(id);
    report[id] = { present: true, found_first_pass: found, deleted, left: left.length, left_names: left.slice(0, 50) };
    say(`cleanup ${id}: 지움 ${deleted}, 남음 ${left.length}`);
  }
  const leftTotal = Object.values(report).reduce((s, r) => s + (r.left ?? 0), 0);
  return {
    exit: leftTotal === 0 ? 0 : 1,
    result: {
      note: '이번 실행뿐 아니라 앞선 실행이 남긴 합성 객체까지 지운다. 임시 버킷 5개는 안의 객체를 전부, 업무 버킷 4개는 이 도구의 표식이 있는 객체(이름에 _zzb2n2, 성적표는 합성 회원 A·B 의 폴더)만 지운다. 그 밖의 객체가 남아 있으면 지우지 않고 left_names 에 적는다. 남은 수는 목록 조회(주소 단위의 중간 저장을 타지 않는다)로 센다. 지운 뒤에도 같은 주소의 읽기에는 중간 저장된 본문이 올 수 있다(cache 단계의 관측).',
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
  else if (phase === 'cache') res = await phaseCache(run);
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
    independent_read: '실제 저장 상태는 readTrue 하나로만 읽는다: 서비스 열쇠의 인증 내려받기를 매번 다른 임의 값을 붙인 새 주소로 보내고(바이트 지문·크기·형식) cf_cache_status·age 를 함께 적는다. cf_cache_status 가 HIT 이거나 없거나 뜻이 불명확하거나, 내려받은 것과 객체 정보(서비스 열쇠의 목록 조회: 있음·크기·형식)가 어긋나면 known: false(미확인)이고 판정에 쓰지 않는다. 소유자는 Storage API 로 볼 수 없어 fingerprint.sql 의 objects 로 본다.',
    cache_reading_rule: '내려받기는 fresh(임의 값을 붙인 새 주소 — 규칙 판정의 근거)와 same_url(같은 주소 재요청의 관측 — 판정에 쓰지 않음)로 나눠 적는다.',
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
