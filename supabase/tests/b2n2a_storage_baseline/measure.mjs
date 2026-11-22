// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-2a 파일 기준선·실측 도구 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 3차(정보 조회 판정): 본문을 받는 GET 은 임의 값을 붙여도 중간 저장(캐시)된 응답이 올 수 있다 — 어떤 모양의 주소로도
// 실제 상태나 현재 권한의 근거가 될 수 없다. 그래서 셋을 따로 잰다. ① 저장 정보 = 서비스 열쇠의 목록 조회 + 정보 조회
// (cf-cache-status 가 DYNAMIC 일 때만 인정, eTag 를 md5 와 대조) ② 정보 조회의 허용·거절 = 재려는 자격의 정보 조회
// (기대값 대조는 이것으로만) ③ 실제 전달된 본문 = 재려는 자격의 본문 GET 을 값 없는 주소와 임의 값 주소로(관측만).
// 1·2차 판은 브레인방이 시험 프로젝트에서 실행했다(요청 형식·오류 모양·목록과 정보 조회의 DYNAMIC·eTag = md5 확인). 3차에서 바꾼 것은 아직 실행된 적이 없다.
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
//   side                      임시 4개 버킷에서 목록·정보 조회(+본문 GET 관측)·삭제·이동 실측  — 잰 값 표
//   business                  기준선의 업무 버킷 4개에 화면과 같은 요청으로 새 이름 올리기  — 잰 값 표
//   fn-live                   판정 함수 버킷: 본인·남·대응 없음·관리자 전/후. 읽기는 "정보 조회"로 대조  — 기대값 대조
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
const md5 = (buf) => createHash('md5').update(buf).digest('hex'); // 저장 정보의 eTag 와 견주는 지문
const PNG = 'image/png';
const describe = (buf) => ({ md5: md5(buf), size: buf.length, content_type: PNG });

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
const say = (msg) => console.log(`[b2n2a] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nonceCounter = 0;
const newNonce = () => `${Date.now().toString(36)}${(nonceCounter += 1).toString(36)}${randomBytes(6).toString('hex')}`;
const TIMEOUT_MS = 30000;

function authFor(actor) {
  if (actor === null) return {}; // 공개 주소: 자격 없이
  if (actor === 'service') return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  if (actor === 'anon') return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  return { apikey: anonKey, Authorization: `Bearer ${jwts[actor]}` };
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

// 시간 초과·네트워크 오류는 예외로 던지지 않고 status 0 의 응답으로 돌려준다(netError). 부르는 쪽이 "미확인"으로 적는다.
async function http(actor, method, urlPath, { headers = {}, body, json } = {}) {
  const h = { ...authFor(actor), ...headers };
  let payload = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  requestCount += 1;
  let res;
  let buf;
  try {
    res = await fetch(`${ORIGIN}${urlPath}`, { method, headers: h, body: payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { status: 0, ok: false, buf: Buffer.alloc(0), contentType: null, json: null, cf: null, age: null, cacheControl: null, netError: String(e?.name ?? 'Error') + ': ' + String(e?.message ?? e).slice(0, 120) };
  }
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
    cf: cf ? cf.trim().toUpperCase() : null,
    age: res.headers.get('age'),
    cacheControl: res.headers.get('cache-control'),
    netError: null,
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
    if (r.netError) kind = 'network';                                   // 시간 초과·연결 실패
    else if (r.status >= 500 || (bodyStatus && Number(bodyStatus) >= 500)) kind = 'server_error';
    else if (all.includes('row-level security') || all.includes('row level security')) kind = 'rls';
    else if (all.includes('duplicate') || all.includes('already exists') || bodyStatus === '409' || r.status === 409) kind = 'duplicate';
    else if (all.includes('not found') || all.includes('not_found') || all.includes('nosuchkey') || bodyStatus === '404' || r.status === 404) kind = 'not_found';
    else if (all.includes('mime') || bodyStatus === '415' || r.status === 415) kind = 'mime';
    else if (all.includes('too large') || bodyStatus === '413' || r.status === 413) kind = 'size';
    else if (all.includes('jwt') || all.includes('token') || all.includes('signature') || all.includes('jws')) kind = 'jwt';
    else if (bodyStatus === '403' || r.status === 403 || r.status === 401 || bodyStatus === '401') kind = 'forbidden_other';
    else kind = 'other';
  }
  return {
    http_status: r.status,
    cf_cache_status: r.cf,
    body_statusCode: bodyStatus,
    body_error: bodyError,
    body_code: bodyCode,
    body_message: message,
    body_snippet: r.ok ? null : (r.netError ?? r.buf.toString('utf8').slice(0, 300)),
    kind,
  };
}
// 권한 거절로 셀 수 없는 응답(요청이 끝나지 않았거나 서버 오류, 자격 자체의 거절)
const inconclusiveKind = (kind) => kind === 'network' || kind === 'server_error' || kind === 'jwt';

// --- Storage 객체 API ---
function upload(actor, bucket, path, bytes, { upsert }) {
  const headers = { 'Content-Type': PNG };
  if (upsert === true) headers['x-upsert'] = 'true'; // 화면과 같다. "없음" 칸에서는 머리글을 아예 보내지 않는다.
  return http(actor, 'POST', `/storage/v1/object/${bucket}/${encPath(path)}`, { headers, body: bytes });
}
const removeOne = (actor, bucket, path) => http(actor, 'DELETE', `/storage/v1/object/${bucket}/${encPath(path)}`);
const move = (actor, bucket, from, to) => http(actor, 'POST', '/storage/v1/object/move', { json: { bucketId: bucket, sourceKey: from, destinationKey: to } });
const LIST_LIMIT = 1000;
const listRaw = (actor, bucket, prefix, search) => http(actor, 'POST', `/storage/v1/object/list/${bucket}`, {
  json: { prefix, limit: LIST_LIMIT, offset: 0, sortBy: { column: 'name', order: 'asc' }, ...(search ? { search } : {}) },
});
const infoRaw = (actor, bucket, path) => http(actor, 'GET', `/storage/v1/object/info/authenticated/${bucket}/${encPath(path)}`);

// ---------------------------------------------------------------------
// 셋을 따로 잰다 (3차)
//   ① 저장 정보           readTrue  — 서비스 열쇠의 목록 조회 + 정보 조회. 본문을 내려받지 않는다.
//   ② 정보 조회의 허용·거절  infoAs    — 재려는 자격의 정보 조회. 기대값 대조는 이것으로만 한다.
//   ③ 실제 전달된 본문      bodyGet   — 재려는 자격의 본문 GET(값 없는 주소 / 임의 값을 붙인 주소). 관측만 한다.
//   본문을 받는 GET 은 어떤 모양의 주소로도 실제 상태나 현재 권한의 근거로 쓰지 않는다(중간 저장되기 때문이다).
//   정보 조회가 본문 GET 과 같은 규칙을 거친다는 것은 입증되지 않았다 — ②의 거절을 "파일 접근이 막혔다"로 읽지 않는다.
// ---------------------------------------------------------------------
const normEtag = (v) => (v == null ? null : String(v).trim().replace(/^W\//, '').replace(/^"+|"+$/g, '').toLowerCase());
const MD5_RE = /^[0-9a-f]{32}$/;
const notDynamic = (cf) => (cf === 'DYNAMIC' ? null : `cf-cache-status 가 DYNAMIC 이 아님(${cf ?? '머리글 없음'})`);

// ① 저장 정보를 읽는 함수는 이것 하나다.
//   있음 = 정확한 경로가 목록에 있고, 정보 조회도 200 이고, 둘의 eTag·크기·형식이 같고, eTag 가 md5 모양임
//   없음 = 정확한 경로가 목록에 없고(목록을 끝까지 읽었고), 정보 조회도 "객체 없음"임
//   그 밖(응답이 DYNAMIC 이 아님, 시간 초과·서버 오류, 목록이 잘림, eTag 모양이 다름, 둘이 어긋남)은 전부 "미확인"(known: false)
//   ※ 이것은 저장 정보(메타데이터)를 읽은 것이다. 본문 바이트를 다시 받아 확인한 것이 아니다.
async function readTrue(bucket, path) {
  const i = path.lastIndexOf('/');
  const folder = i < 0 ? '' : path.slice(0, i);
  const name = i < 0 ? path : path.slice(i + 1);
  const doubts = [];

  const lr = await listRaw('service', bucket, folder, name);
  const list = { http_status: lr.status, cf_cache_status: lr.cf, returned: Array.isArray(lr.json) ? lr.json.length : null, present: null };
  if (!lr.ok || !Array.isArray(lr.json)) doubts.push(`목록 조회 실패(${lr.status} ${responseInfo(lr).kind})`);
  else {
    if (notDynamic(lr.cf)) doubts.push('목록: ' + notDynamic(lr.cf));
    const it = lr.json.find((x) => x.id && String(x.name) === name);
    list.present = !!it;
    if (it) {
      list.etag = normEtag(it.metadata?.eTag);
      list.size = it.metadata?.size ?? null;
      list.mimetype = it.metadata?.mimetype != null ? String(it.metadata.mimetype).toLowerCase() : null;
      list.updated_at = it.updated_at ?? null;
    } else if (lr.json.length >= LIST_LIMIT) {
      doubts.push(`목록이 한도(${LIST_LIMIT})까지 차서 끝까지 읽지 못함 — "없음"을 말할 수 없다`);
    }
  }

  const ir = await infoRaw('service', bucket, path);
  const ii = responseInfo(ir);
  const info = { http_status: ir.status, cf_cache_status: ir.cf, present: null, kind: ii.kind };
  if (ir.ok && ir.json && typeof ir.json === 'object') {
    info.present = true;
    info.etag = normEtag(ir.json.etag ?? ir.json.eTag ?? ir.json.metadata?.eTag);
    info.size = ir.json.size ?? ir.json.metadata?.size ?? null;
    const ct = ir.json.content_type ?? ir.json.contentType ?? ir.json.metadata?.mimetype ?? null;
    info.content_type = ct != null ? String(ct).toLowerCase() : null;
    if (notDynamic(ir.cf)) doubts.push('정보 조회: ' + notDynamic(ir.cf));
  } else if (ii.kind === 'not_found') {
    info.present = false;
    if (notDynamic(ir.cf)) doubts.push('정보 조회: ' + notDynamic(ir.cf));
  } else {
    doubts.push(`정보 조회가 끝나지 않았거나 알 수 없는 응답(${ir.status} ${ii.kind})`);
  }

  let core = null;
  if (!doubts.length) {
    if (list.present === true && info.present === true) {
      if (!list.etag || !MD5_RE.test(list.etag)) doubts.push(`목록의 eTag 가 없거나 md5 모양이 아님(${list.etag ?? '없음'})`);
      else if (list.etag !== info.etag) doubts.push(`목록의 eTag(${list.etag})와 정보 조회의 eTag(${info.etag})가 어긋남`);
      else if (list.size == null || Number(list.size) !== Number(info.size)) doubts.push(`목록의 크기(${list.size})와 정보 조회의 크기(${info.size})가 어긋남`);
      else if (list.mimetype && info.content_type && list.mimetype !== info.content_type) doubts.push(`목록의 형식(${list.mimetype})과 정보 조회의 형식(${info.content_type})이 어긋남`);
      else core = { exists: true, md5: list.etag, size: Number(list.size), content_type: list.mimetype ?? info.content_type };
    } else if (list.present === false && info.present === false) {
      core = { exists: false };
    } else {
      doubts.push(`목록(${list.present ? '있음' : '없음'})과 정보 조회(${info.present ? '있음' : '없음'})가 어긋남`);
    }
  }
  return {
    known: !!core,
    ...(core ?? {}),
    unverified: core ? null : doubts.join(' / '),
    basis: '저장 정보(서비스 열쇠의 목록 조회 + 정보 조회)',
    list, info,
  };
}
// 기대한 상태와 정확히 같은가. 읽기가 "미확인"이면 같다고 하지 않는다.
//   want: { exists: false }  또는  { exists: true, md5, size, content_type }
function stateIs(st, want) {
  if (!st || !st.known) return false;
  if (!want.exists) return st.exists === false;
  return st.exists === true && st.md5 === want.md5 && st.size === want.size && st.content_type === want.content_type;
}
const present = (bytes) => ({ exists: true, ...describe(bytes) });
const ABSENT = { exists: false };
const coreOf = (st) => (st?.known ? (st.exists ? { exists: true, md5: st.md5, size: st.size, content_type: st.content_type } : { exists: false }) : null);
const sameKnown = (a, b) => !!a?.known && !!b?.known && JSON.stringify(coreOf(a)) === JSON.stringify(coreOf(b));
const allKnown = (state) => Object.values(state).every((s) => s.known);
const doubtsOf = (state) => Object.entries(state).filter(([, s]) => !s.known).map(([p, s]) => `${p.split('/').pop()}: ${s.unverified}`).join(' ‖ ');

// ② 정보 조회(재려는 자격). 원 응답을 그대로 적는다.
async function infoAs(actor, bucket, path) {
  const r = await infoRaw(actor, bucket, path);
  const ri = responseInfo(r);
  const out = {
    who: actor, request: '정보 조회(GET /object/info/authenticated/…)',
    http_status: r.status, ok: r.ok, cf_cache_status: r.cf,
    etag: null, size: null, content_type: null,
    error: r.ok ? null : { body_statusCode: ri.body_statusCode, body_error: ri.body_error, body_code: ri.body_code, body_message: ri.body_message, kind: ri.kind, snippet: ri.body_snippet },
  };
  if (r.ok && r.json && typeof r.json === 'object') {
    out.etag = normEtag(r.json.etag ?? r.json.eTag ?? r.json.metadata?.eTag);
    out.size = r.json.size ?? r.json.metadata?.size ?? null;
    const ct = r.json.content_type ?? r.json.contentType ?? r.json.metadata?.mimetype ?? null;
    out.content_type = ct != null ? String(ct).toLowerCase() : null;
  }
  return out;
}
// 정보 조회의 허용·거절(기대값 대조는 이것으로만 한다)
//   허용  = 200 이고 돌려준 eTag·크기가 저장 정보와 같음
//   거절  = "객체 없음" 모양의 거절 응답이고, 같은 순간 저장 정보로는 그 파일이 정상으로 있음
//   미확인 = 응답이 DYNAMIC 이 아님 / 시간 초과·서버 오류·그 밖의 응답 / 저장 정보가 미확인이거나 파일이 없음
// 이 결과는 "그 자격으로 그 파일의 정보를 볼 수 있는가"까지만 뜻한다.
function infoVerdict(rd, trueState) {
  if (!trueState?.known) return `undetermined(저장 정보 미확인: ${trueState?.unverified ?? ''})`;
  if (!trueState.exists) return 'undetermined(그 순간 파일이 없음 — "객체 없음"을 거절로 세지 않는다)';
  if (notDynamic(rd.cf_cache_status)) return `undetermined(정보 조회 응답: ${notDynamic(rd.cf_cache_status)})`;
  if (rd.ok) {
    if (rd.etag === trueState.md5 && Number(rd.size) === trueState.size) return 'allow';
    return `undetermined(정보 조회는 200 인데 eTag·크기가 저장 정보와 다름: ${rd.etag}/${rd.size})`;
  }
  if (rd.error.kind === 'not_found') return 'deny';
  return `undetermined(정보 조회가 끝나지 않았거나 "객체 없음"이 아닌 응답: ${rd.http_status} ${rd.error.kind})`;
}

// ③ 본문을 받는 GET(관측만). shape: 'same_url'(값 없는 주소) / 'with_query'(임의 값을 붙인 주소)
//   contents: { current: 지금 저장된 내용의 바이트(없으면 null), old: [예전 내용의 바이트…] }
async function bodyGet(actor, bucket, path, shape, contents, { pub = false } = {}) {
  const base = `/storage/v1/object/${pub ? 'public' : 'authenticated'}/${bucket}/${encPath(path)}`;
  const r = await http(pub ? null : actor, 'GET', shape === 'with_query' ? `${base}?t=${newNonce()}` : base);
  const ri = responseInfo(r);
  let bodyIs = '본문 없음';
  let m = null;
  if (r.ok) {
    m = md5(r.buf);
    if (contents?.current && m === md5(contents.current) && r.buf.length === contents.current.length) bodyIs = '현재 내용';
    else if ((contents?.old ?? []).some((b) => b && m === md5(b) && r.buf.length === b.length)) bodyIs = '옛 내용';
    else bodyIs = '그 밖';
  }
  return {
    who: pub ? '공개 주소(자격 없음)' : actor,
    request: '본문 GET', url_shape: shape,
    http_status: r.status, ok: r.ok,
    cf_cache_status: r.cf, age: r.age, cache_control: r.cacheControl,
    body_md5: m, body_size: r.ok ? r.buf.length : null, body_is: bodyIs,
    error: r.ok ? null : { body_statusCode: ri.body_statusCode, body_error: ri.body_error, body_code: ri.body_code, body_message: ri.body_message, kind: ri.kind },
  };
}
const bodyLine = (x) => `${x.http_status} ${x.cf_cache_status ?? '머리글 없음'}${x.age != null ? ' age ' + x.age : ''} ${x.body_is}`;

// 폴더 안의 파일 이름(서비스 열쇠의 목록 조회). 폴더(하위 묶음)는 id 가 없는 항목이다.
async function listFolder(bucket, prefix) {
  const r = await listRaw('service', bucket, prefix);
  if (!r.ok || !Array.isArray(r.json)) throw new Error(`목록 읽기 실패(${bucket}/${prefix}): ${r.status} ${r.netError ?? r.buf.toString('utf8').slice(0, 200)}`);
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
    if (!r.ok) throw new Error(`지우기 실패(${bucket}): ${r.status} ${r.netError ?? r.buf.toString('utf8').slice(0, 200)}`);
  }
}
const sameNames = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 칸의 시작 상태를 되돌린다(서비스 열쇠): 대상 이름을 지우고, 있어야 하는 칸이면 원본 바이트로 다시 만든다.
// 서비스 열쇠로 만든 객체의 소유자는 비어 있다(원래 소유 상태). 대조군 파일도 같은 방식으로 둔다.
// 그런 다음 readTrue(저장 정보)로 "있어야 하는 것은 정확히 그 지문으로 있고, 없어야 하는 것은 없음"을 확인한다.
// 저장 정보가 "미확인"이면 시작 상태도 확인되지 않은 것이다(ok: false).
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
//   저장 상태는 readTrue(저장 정보)로만 읽는다. 본문을 내려받지 않는다.
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
  const after = await readAllTrue(bucket, [target, control]);
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
    // 대상이 전후 같은 상태(새 이름 칸: 전후 모두 비어 있음 / 있는 이름 칸: 전후 모두 같은 지문)이고 대조군·이름 집합도 그대로
    state_unchanged: sameKnown(after[target], start.state[target]) && controlUnchanged && sameNames(namesBefore, namesAfter),
  };
}

// 잰 값을 읽는 말(통과·실패가 아니다).
//   성공: 새로 올리기 = 없음 → 올린 지문 / 덮어쓰기 = 옛 지문 → 새 지문
//   권한 거절: 같은 입력의 서비스 열쇠 대조군이 성공 + 대상(새 이름은 전후 모두 비어 있음, 있는 이름은 전후 모두 같은 지문)·대조군이 변하지 않음
function readingOfUpload(cell, control) {
  if (!cell.start_ok) return `시작 상태가 확인되지 않음(이 칸은 읽지 않는다) ${doubtsOf(cell.start)}`;
  if (!cell.after_known) return `미확인 — 요청 뒤의 저장 정보를 읽지 못함(${doubtsOf(cell.after)})`;
  if (cell.request_ok && cell.stored === 'uploaded_bytes') {
    return cell.name_state === 'new' ? '받아들여짐 — 없음 → 올린 지문(저장 정보의 eTag 가 올린 바이트의 md5 와 같음)' : '받아들여짐 — 옛 지문 → 새 지문(저장 정보의 eTag 가 올린 바이트의 md5 와 같음)';
  }
  if (cell.request_ok) return `받아들여졌다고 응답했으나 저장 정보가 올린 지문이 아님(${cell.stored})`;
  if (inconclusiveKind(cell.response.kind)) return `미확인 — 요청이 끝나지 않았거나 서버 오류·자격 자체의 거절(${cell.response.kind}). 권한 거절로 세지 않는다`;
  if (cell.response.kind === 'duplicate') return '권한 미판정(중복) — 이름이 이미 있어 생긴 오류';
  if (!cell.state_unchanged) return `거절 응답인데 저장 상태가 바뀜(${cell.stored})`;
  if (cell.response.kind === 'rls') {
    if (cell.actor === 'service') return '서비스 열쇠인데 권한 오류(대조군이 성립하지 않음)';
    if (control && control.request_ok && control.stored === 'uploaded_bytes') {
      return cell.name_state === 'new' ? '권한 거절 — 같은 입력이 서비스 열쇠로는 성공(대조군 있음), 그 이름이 전후 모두 비어 있음' : '권한 거절 — 같은 입력이 서비스 열쇠로는 성공(대조군 있음), 대상이 전후 모두 같은 지문';
    }
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
  const table = {};
  for (const c of cells) {
    const key = `${c.bucket} [${c.rule_set}] | ${c.name_state === 'new' ? '새 이름' : '있는 이름'} | x-upsert ${c.x_upsert}`;
    (table[key] ??= {})[c.actor] = `${c.response.http_status}${c.response.body_statusCode ? '/' + c.response.body_statusCode : ''} · ${c.reading}`;
  }
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 잰 값을 그대로 적은 표다. 저장 상태는 전부 readTrue(서비스 열쇠의 목록 조회 + 정보 조회, eTag 를 md5 와 대조)로 읽었다 — 저장 정보를 읽은 것이지 본문 바이트를 다시 받아 확인한 것이 아니다. 소유자는 fingerprint.sql 의 objects 에서 path 로 찾아 본다.',
      unverified_cells: cells.filter((c) => !c.start_ok || !c.after_known).map((c) => c.cell),
      table, cells,
    },
  };
}

// ---------------------------------------------------------------------
// side: 그 규칙 조합이 함께 여는 것 — 목록·정보 조회(+본문 GET 관측)·삭제·이동 (로그인 회원, 대조군 = 서비스 열쇠)
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
  if (action === 'info') {
    // 정보 조회(읽는 말의 근거)와, 같은 자격·같은 객체에 "처음 보내는 본문 GET"(관측)을 나란히
    rec.info_lookup = await infoAs(actor, bucket, target);
    const contents = { current: original, old: [] };
    rec.body_get = {
      same_url: await bodyGet(actor, bucket, target, 'same_url', contents),
      with_query: await bodyGet(actor, bucket, target, 'with_query', contents),
    };
  } else {
    rec.response = responseInfo(r);
    rec.request_ok = r.ok;
  }

  // 응답만으로 판정하지 않는다: 그 뒤 저장 정보(readTrue)로 본 있음·지문·크기·형식
  const after = await readAllTrue(bucket, [target, control, dest]);
  const namesAfter = await folderFileNames(bucket, folder);
  rec.after = after;
  rec.after_known = allKnown(after);
  rec.object_names_after = namesAfter;
  const ctrlSame = stateIs(after[control], present(controlBytes));
  rec.control_unchanged = ctrlSame;
  if (!rec.after_known) {
    rec.reading = `미확인 — 요청 뒤의 저장 정보를 읽지 못함(${doubtsOf(after)})`;
    return rec;
  }
  const targetSame = stateIs(after[target], present(original));

  if (action === 'list') {
    const returned = r.ok && Array.isArray(r.json) ? r.json.filter((x) => x.id).map((x) => String(x.name)).sort() : null;
    rec.returned_names = returned;
    rec.returned_all = !!returned && sameNames(returned, namesBefore);
    rec.reading = !r.ok ? (inconclusiveKind(rec.response.kind) ? `미확인 — 목록 요청이 끝나지 않았거나 서버 오류(${rec.response.kind})` : `목록 요청이 거절됨(${rec.response.kind})`)
      : rec.returned_all ? `목록에 그 폴더의 파일 이름이 전부 나옴(${returned.length}개)`
        : returned.length === 0 ? '응답은 성공이지만 목록이 비어 있음(파일은 실제로 있다)'
          : `목록에 일부만 나옴(${returned.length}/${namesBefore.length})`;
  } else if (action === 'info') {
    const v = targetSame ? infoVerdict(rec.info_lookup, start.state[target]) : 'undetermined(요청 전후로 대상의 저장 정보가 달라짐)';
    rec.info_verdict = v;
    rec.info_allowed = v === 'allow';
    rec.reading = v === 'allow' ? '정보 조회 허용 — 돌려준 eTag·크기가 저장 정보와 같음'
      : v === 'deny' ? '정보 조회 거절("객체 없음" 모양) — 같은 순간 저장 정보로는 파일이 정상으로 있음'
        : `미확인 — ${v}`;
    rec.body_get_note = `본문 GET(이 자격이 이 객체에 처음 보내는 것): 값 없는 주소 ${bodyLine(rec.body_get.same_url)} / 임의 값 주소 ${bodyLine(rec.body_get.with_query)}`;
    const delivered = rec.body_get.same_url.ok || rec.body_get.with_query.ok;
    rec.info_vs_body = v === 'deny' && delivered ? '정보 조회 거절·본문 전달'
      : v === 'deny' ? '같은 방향(정보 조회 거절·본문 없음)'
        : v === 'allow' && delivered ? '같은 방향(정보 조회 허용·본문 전달)'
          : v === 'allow' ? '정보 조회 허용·본문 없음' : '판단 불가(정보 조회 미확인)';
  } else if (action === 'delete') {
    // 성공: 있음 → 없음 / 거절: 대상이 전후 모두 같은 지문
    rec.deleted = after[target].exists === false;
    rec.reading = rec.deleted ? '지워짐 — 있음 → 없음(저장 정보)'
      : targetSame ? (inconclusiveKind(rec.response.kind) ? `미확인 — 요청이 끝나지 않았거나 서버 오류(${rec.response.kind}). 대상은 같은 지문 그대로` : `지워지지 않음 — 대상이 전후 모두 같은 지문(응답 ${rec.response.http_status}${r.ok ? ', 성공이라고 응답' : ', ' + rec.response.kind})`)
        : '대상이 원본과 다른 상태로 남음';
  } else {
    // 성공: 출발지 없어짐 + 도착지 지문 일치 / 거절: 출발지가 전후 모두 같은 지문, 도착지 없음
    rec.moved = after[target].exists === false && stateIs(after[dest], present(original));
    rec.reading = rec.moved ? '옮겨짐 — 출발지 없어짐, 도착지의 지문이 원본과 같음'
      : targetSame && after[dest].exists === false ? (inconclusiveKind(rec.response.kind) ? `미확인 — 요청이 끝나지 않았거나 서버 오류(${rec.response.kind}). 출발지는 같은 지문 그대로` : `옮겨지지 않음 — 출발지가 전후 모두 같은 지문, 도착지 없음(응답 ${rec.response.http_status}${r.ok ? ', 성공이라고 응답' : ', ' + rec.response.kind})`)
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
      for (const action of ['list', 'info', 'delete', 'move']) {
        const group = [];
        for (const actor of ['service', 'member_a']) {
          no += 1;
          group.push(await sideCell({ run, no, bucket: b.id, ruleSet: b.rule_set, action, actor, origin }));
        }
        const control = group.find((c) => c.actor === 'service');
        const controlOk = control.start_ok !== false && control.after_known && (
          (action === 'list' && control.returned_all) || (action === 'info' && control.info_allowed)
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
    (table[key] ??= {})[c.action] = c.reading + (c.body_get_note ? ` ‖ ${c.body_get_note} ‖ ${c.info_vs_body}` : '');
  }
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 잰 값을 그대로 적은 표다. 삭제·이동 뒤의 상태는 readTrue(저장 정보)로 읽었다. "info" 칸은 정보 조회의 허용·거절이고, 본문 GET(값 없는 주소 / 임의 값 주소)은 전달 관측으로 따로 적는다 — 정보 조회의 결과를 "파일 접근이 막혔다"로 읽지 않는다. 소유자는 fingerprint.sql 의 objects 에서 path 로 찾아 본다.',
      unverified_cells: cells.filter((c) => c.start_ok === false || c.after_known === false || String(c.info_verdict ?? '').startsWith('undetermined')).map((c) => c.cell),
      info_denied_but_body_delivered: cells.filter((c) => c.info_vs_body === '정보 조회 거절·본문 전달').map((c) => c.cell),
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
      const pub = await bodyGet(null, s.bucket, s.path, 'with_query', { current: bytes, old: [] }, { pub: true });
      const rec = {
        cell: `business-${pad(no)}`, bucket: s.bucket, actor, path_shape: s.shape, path: s.path, screen: s.screen, x_upsert: 'true',
        uploaded: describe(bytes), before, name_was_empty: stateIs(before, ABSENT),
        response: responseInfo(r), request_ok: r.ok, after,
        stored_exact: stateIs(after, present(bytes)),
        public_url: { note: '참고(공개 주소의 본문 GET, 임의 값 주소) — 규칙의 증거가 아니다', line: bodyLine(pub), ...pub },
        how_to_read: s.how_to_read,
      };
      rec.reading = !before.known || !after.known ? `미확인 — 저장 정보를 읽지 못함(${before.unverified ?? after.unverified})`
        : !rec.name_was_empty ? '시작 상태가 기대와 다름(이름이 비어 있지 않았다)'
          : rec.request_ok && rec.stored_exact ? '받아들여짐 — 없음 → 올린 지문(저장 정보의 eTag 가 올린 바이트의 md5 와 같음)'
            : rec.request_ok ? '받아들여졌다고 응답했으나 저장 정보가 올린 지문이 아님'
              : inconclusiveKind(rec.response.kind) ? `미확인 — 요청이 끝나지 않았거나 서버 오류·자격 자체의 거절(${rec.response.kind})`
                : after.exists ? '거절 응답인데 파일이 생김' : `거절(${rec.response.kind}) — 그 이름이 전후 모두 비어 있음`;
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
      c.reading = c.control_ok ? '권한 거절 — 같은 모양의 요청이 서비스 열쇠로는 성공(대조군 있음), 그 이름이 전후 모두 비어 있음' : '권한 미판정 — 서비스 열쇠 대조군도 성공하지 못함';
    }
  }
  const table = {};
  for (const c of cells) (table[`${c.bucket} | ${c.path_shape}`] ??= {})[c.actor] = `${c.response.http_status}${c.response.body_statusCode ? '/' + c.response.body_statusCode : ''} · ${c.reading}`;
  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 지금 규칙 그대로의 실측이다. 비로그인 칸은 2b 의 "옛 경로" 기준, 로그인 칸은 "지금 새 로그인으로 보내면 무엇이 되고 안 되는가"다. 저장 상태는 readTrue(저장 정보)로 읽었다. public_url 은 참고일 뿐 규칙의 증거가 아니다(공개 버킷의 공개 주소는 규칙과 무관하게 열리고, 중간 저장도 된다).',
      how_to_read_general: [
        'materials 에 올리는 요청은 확인된 화면 호출이 없는 합성 진단 요청이다(업무 보존의 증거가 아님).',
        'guide-images 와 성적표의 관리자 경로(<회원번호>/…)에 회원 자격으로 보낸 요청이 되더라도, 그것은 "관리자 업무가 된다"가 아니라 "지금 그 경로가 회원에게도 열려 있다"는 사실이다.',
      ],
      unverified_cells: cells.filter((c) => !c.before.known || !c.after.known).map((c) => c.cell),
      table, cells,
    },
  };
}

// ---------------------------------------------------------------------
// fn-*: 판정 함수 버킷 (기대값을 대조하는 단계)
//   올리기·덮어쓰기·삭제: readTrue(저장 정보)의 전후 비교로 판정한다.
//   읽기: "정보 조회"의 허용·거절로 기대값을 대조한다. 본문 GET 은 전달 관측으로만 나란히 적는다.
// ---------------------------------------------------------------------
const FN_ACTIONS = ['upload', 'info', 'overwrite', 'delete'];

async function fnAttempt({ run, tag, no, folder, actor, action, withBody }) {
  const base = `${folder}/r${run}-${tag}-${pad(no)}`;
  const target = `${base}-t.png`;
  const control = `${base}-c.png`;
  const original = action === 'upload' ? null : makePng(`${run} ${tag} ${no} original`);
  const controlBytes = makePng(`${run} ${tag} ${no} control`);
  const newBytes = makePng(`${run} ${tag} ${no} new by ${actor}`);
  const namePrefix = `r${run}-${tag}-${pad(no)}-`;

  // 시작 상태 되돌리기 + 확인(readTrue): 정보 조회·덮어쓰기·삭제는 대상 파일이 실제로 있음, 새로 올리기는 이름이 비어 있음
  const start = await restoreStart(FN_BUCKET, [{ path: target, bytes: original }, { path: control, bytes: controlBytes }]);
  const namesBefore = await folderFileNames(FN_BUCKET, folder, namePrefix);

  let r = null;
  let lookup = null;
  let body = null;
  if (action === 'upload' || action === 'overwrite') r = await upload(actor, FN_BUCKET, target, newBytes, { upsert: true });
  else if (action === 'delete') r = await removeOne(actor, FN_BUCKET, target);
  else {
    lookup = await infoAs(actor, FN_BUCKET, target);                 // ② 정보 조회 — 기대값 대조의 근거
    if (withBody) {
      // ③ 같은 자격이 같은 객체에 "처음 보내는 본문 GET"(관측만). 이 객체의 본문은 아직 누구도 받은 적이 없다.
      const contents = { current: original, old: [] };
      body = {
        same_url: await bodyGet(actor, FN_BUCKET, target, 'same_url', contents),
        with_query: await bodyGet(actor, FN_BUCKET, target, 'with_query', contents),
      };
    }
  }

  const after = await readAllTrue(FN_BUCKET, [target, control]);
  const namesAfter = await folderFileNames(FN_BUCKET, folder, namePrefix);
  const info = r ? responseInfo(r) : null;
  const tName = target.split('/').pop();
  const cName = control.split('/').pop();
  const controlSame = stateIs(after[control], present(controlBytes));
  const targetAsStart = stateIs(after[target], original ? present(original) : ABSENT);
  const unchanged = targetAsStart && controlSame && sameNames(namesBefore, namesAfter);
  const noReply = info && inconclusiveKind(info.kind) ? `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${info.kind} — 권한 거절로 세지 않는다)` : null;

  let outcome;
  if (!start.ok) {
    outcome = `undetermined(시작 상태 미확인: ${doubtsOf(start.state) || '기대한 상태가 아님'})`;
  } else if (!allKnown(after)) {
    outcome = `undetermined(요청 뒤의 저장 정보 미확인: ${doubtsOf(after)})`;
  } else if (action === 'info') {
    // 같은 순간(요청 전과 후 모두) 저장 정보로 파일이 정상이어야 거절·허용을 말한다
    outcome = unchanged ? infoVerdict(lookup, start.state[target]) : 'anomaly(정보 조회 전후로 저장 상태가 달라짐)';
  } else if (action === 'upload') {
    // 성공: 없음 → 기대한 파일(지문 일치) / 거절: 그 이름이 전후 모두 비어 있음
    if (r.ok && stateIs(start.state[target], ABSENT) && stateIs(after[target], present(newBytes)) && controlSame && sameNames(namesAfter, [cName, tName].sort())) outcome = 'allow';
    else if (!r.ok && stateIs(start.state[target], ABSENT) && stateIs(after[target], ABSENT) && controlSame && sameNames(namesBefore, namesAfter)) outcome = noReply ?? 'deny';
    else outcome = 'anomaly';
  } else if (action === 'overwrite') {
    // 성공: 옛 지문 → 새 지문 / 거절: 대상이 전후 모두 같은 지문
    if (r.ok && stateIs(start.state[target], present(original)) && stateIs(after[target], present(newBytes)) && controlSame && sameNames(namesAfter, [cName, tName].sort())) outcome = 'allow';
    else if (!r.ok && unchanged) outcome = noReply ?? 'deny';
    else outcome = 'anomaly';
  } else {
    // 성공: 있음 → 없음 / 거절: 대상이 전후 모두 같은 지문(성공이라고 응답했더라도 지워진 것이 없으면 거절)
    if (r.ok && stateIs(start.state[target], present(original)) && stateIs(after[target], ABSENT) && controlSame && sameNames(namesAfter, [cName])) outcome = 'allow';
    else if (unchanged) outcome = noReply ?? 'deny';
    else outcome = 'anomaly';
  }

  return {
    actor, action, folder, path: target, control_path: control,
    start_ok: start.ok, start: start.state,
    target_existed_before: original ? stateIs(start.state[target], present(original)) : false, name_was_empty_before: stateIs(start.state[target], ABSENT),
    response: info, request_ok: r ? r.ok : null, info_lookup: lookup, body_get: body, after,
    object_names_before: namesBefore, object_names_after: namesAfter,
    state_unchanged: unchanged, outcome,
  };
}

// 정보 조회와 본문 GET 이 같은 방향인가(관측을 읽는 말 — 판정이 아니다)
function infoVsBody(outcome, bodyRead) {
  if (!bodyRead) return null;
  const delivered = bodyRead.ok;
  if (outcome === 'deny') return delivered ? `정보 조회 거절·본문 전달(${bodyRead.body_is})` : '같은 방향(정보 조회 거절·본문 없음)';
  if (outcome === 'allow') return delivered ? `같은 방향(정보 조회 허용·본문 전달: ${bodyRead.body_is})` : '정보 조회 허용·본문 없음';
  return '판단 불가(정보 조회 미확인)';
}

// 한 줄(자격·폴더·동작) = 시도 1번 + (거절이 기대인 줄은) 같은 입력의 서비스 열쇠 대조군 1번
async function fnRow({ run, tag, counter, caseName, folder, actor, action, expect }) {
  const attempt = await fnAttempt({ run, tag, no: counter.next(), folder, actor, action, withBody: true });
  const row = { case: caseName, actor, folder, action, expect, ...attempt, control: null };
  if (expect === 'deny') {
    const c = await fnAttempt({ run, tag, no: counter.next(), folder, actor: 'service', action, withBody: false });
    row.control = { outcome: c.outcome, response: c.response, info_lookup: c.info_lookup, path: c.path };
    if (c.outcome !== 'allow' && row.outcome === 'deny') row.outcome = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군도 성공하지 못함)';
  }
  row.match = row.outcome === expect;
  if (action === 'info') {
    // 줄 이름은 "정보 조회". 같은 자격·같은 객체에 처음 보내는 본문 GET 을 나란히 적는다(판정과 따로).
    row.first_body_get = {
      same_url: bodyLine(row.body_get.same_url), with_query: bodyLine(row.body_get.with_query),
      same_url_vs_info: infoVsBody(row.outcome, row.body_get.same_url),
      with_query_vs_info: infoVsBody(row.outcome, row.body_get.with_query),
    };
    row.info_denied_but_body_delivered = row.outcome === 'deny' && (row.body_get.same_url.ok || row.body_get.with_query.ok);
  }
  return row;
}
const makeCounter = () => {
  let n = 0;
  return { next: () => (n += 1) };
};
const ACTION_KO = { upload: '새로 올리기', info: '정보 조회', overwrite: '덮어쓰기', delete: '삭제' };
function fnSummary(rows) {
  const table = {};
  for (const r of rows) (table[r.case] ??= {})[ACTION_KO[r.action]] = `${r.expect} → ${r.outcome}${r.match ? '' : '  ✗'}`;
  const mismatch = rows.filter((r) => !r.match);
  const infos = rows.filter((r) => r.action === 'info');
  return {
    total: rows.length, mismatch: mismatch.length, table,
    mismatches: mismatch.map((r) => ({ case: r.case, action: r.action, expect: r.expect, outcome: r.outcome, response: r.response, info_lookup: r.info_lookup })),
    // 정보 조회(판정)와 처음 보내는 본문 GET(관측)을 나란히
    info_and_first_body_get: Object.fromEntries(infos.map((r) => [r.case, {
      '정보 조회': r.outcome,
      '본문 GET(값 없는 주소)': `${r.first_body_get.same_url} → ${r.first_body_get.same_url_vs_info}`,
      '본문 GET(임의 값 주소)': `${r.first_body_get.with_query} → ${r.first_body_get.with_query_vs_info}`,
    }])),
    info_denied_but_body_delivered: infos.filter((r) => r.info_denied_but_body_delivered).map((r) => r.case),
  };
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
    say(`fn-live ${rows.length}/32 — ${c.name}`);
  }
  const summary = fnSummary(rows);
  if (summary.info_denied_but_body_delivered.length) say(`fn-live 관측: 정보 조회 거절·본문 전달인 줄 — ${summary.info_denied_but_body_delivered.join(' / ')}`);
  return {
    exit: summary.mismatch ? 1 : 0,
    result: {
      credentials: jwtInfo,
      note: '종료 값과 summary.mismatch 는 기대값 대조만 센다: 새로 올리기·덮어쓰기·삭제는 저장 정보의 전후 비교, 읽기는 "정보 조회"의 허용·거절. 본문 GET 은 summary.info_and_first_body_get 에 관측으로 나란히 적는다. 정보 조회의 거절은 "그 자격으로 그 파일의 정보를 볼 수 없다"까지만 뜻한다 — 정보 조회가 거절인데 본문이 온 줄은 "정보 조회 거절·본문 전달"이고 파일 접근 차단 성공이 아니다.',
      summary, rows,
    },
  };
}

// 만료·로그아웃 시험의 "pre 에서 이미 읽은 주소": pre 와 post 가 서로 다른 실행이므로, 로그인 상태 번호로 정해지는 이름과 바이트를 쓴다.
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
  const contents = { current: probe.bytes, old: [] };
  const pr = { path: probe.path, bytes: describe(probe.bytes) };

  if (step === 'pre') {
    // 정상 자격으로 "바로 그 주소"에서 본문을 받아 둔다(그래야 post 의 재전달이 "이미 읽은 주소"다).
    const start = await restoreStart(FN_BUCKET, [{ path: probe.path, bytes: probe.bytes }]);
    pr.true_state = start.state[probe.path];
    pr.info_lookup = await infoAs('subject', FN_BUCKET, probe.path);
    pr.info = { expect: 'allow', outcome: infoVerdict(pr.info_lookup, pr.true_state) };
    pr.info.match = pr.info.outcome === 'allow';
    pr.body_reads = [
      await bodyGet('subject', FN_BUCKET, probe.path, 'same_url', contents),
      await bodyGet('subject', FN_BUCKET, probe.path, 'same_url', contents),
      await bodyGet('subject', FN_BUCKET, probe.path, 'with_query', contents),
    ];
    pr.body_received_at_same_url = pr.body_reads.filter((x) => x.url_shape === 'same_url').some((x) => x.body_is === '현재 내용');
    pr.statement = !start.ok ? '앞서 읽을 파일을 만들지 못했거나 저장 정보를 확인하지 못함'
      : pr.body_received_at_same_url ? `정상 자격으로 그 주소(값 없는 주소)에서 본문을 받았다 — ${pr.body_reads.map(bodyLine).join(' / ')}`
        : '정상 자격인데 그 주소에서 본문을 받지 못함 — post 의 재전달 관측은 뜻이 없다';
  } else {
    // 셋을 따로: ① 정보 조회(기대값 대조) ② 처음 보내는 주소의 본문 GET(아래 rows 의 "정보 조회" 줄에 있다) ③ pre 에서 이미 읽은 주소의 재전달
    pr.true_state = await readTrue(FN_BUCKET, probe.path);
    const fileThere = stateIs(pr.true_state, present(probe.bytes));
    pr.info_lookup = await infoAs('subject', FN_BUCKET, probe.path);
    const v = fileThere ? infoVerdict(pr.info_lookup, pr.true_state) : `undetermined(pre 단계의 파일이 그대로 있는지 확인하지 못함: ${pr.true_state.unverified ?? '없거나 다른 지문'})`;
    pr.info = { expect, outcome: v, match: v === expect };
    const s = await bodyGet('subject', FN_BUCKET, probe.path, 'same_url', contents);
    const q = await bodyGet('subject', FN_BUCKET, probe.path, 'with_query', contents);
    pr.redelivery = {
      what: 'pre 단계에서 이 자격이 본문을 받은 객체. same_url 이 "이미 읽은 바로 그 주소"이고, with_query 는 같은 객체의 새 주소다',
      same_url: s, with_query: q,
      delivered_at_read_url: s.ok, body_is_at_read_url: s.body_is,
      line: `이미 읽은 주소 ${bodyLine(s)} / 임의 값 주소 ${bodyLine(q)}`,
    };
  }

  const counter = makeCounter();
  const rows = [];
  for (const action of FN_ACTIONS) {
    rows.push(await fnRow({ run, tag: `${kind}-${step}`, counter, caseName, folder: memberA, actor: 'subject', action, expect }));
    say(`fn-${kind} ${step} ${rows.length}/4 — ${ACTION_KO[action]}`);
  }
  const summary = fnSummary(rows);
  const infoRow = rows.find((r) => r.action === 'info');

  // post·restored: 셋을 따로 적는다(합쳐서 하나의 통과로 만들지 않는다)
  let three = null;
  if (step !== 'pre') {
    const firstDelivered = infoRow.body_get.same_url.ok || infoRow.body_get.with_query.ok;
    three = {
      '1_정보_조회': {
        expect,
        '이미 읽은 객체': pr.info.outcome,
        '새 객체': infoRow.outcome,
        match: pr.info.match && infoRow.match,
      },
      '2_처음_보내는_주소의_본문_GET': {
        what: '이 자격이 본문을 받은 적 없는 새 객체(rows 의 "정보 조회" 줄)',
        same_url: infoRow.first_body_get.same_url, with_query: infoRow.first_body_get.with_query,
        delivered: firstDelivered,
        reading: infoRow.outcome === 'deny' && firstDelivered ? '정보 조회 거절·본문 전달' : infoRow.first_body_get.same_url_vs_info,
      },
      '3_pre에서_이미_읽은_주소의_재전달': {
        line: pr.redelivery.line,
        delivered: pr.redelivery.delivered_at_read_url, body_is: pr.redelivery.body_is_at_read_url,
        reading: pr.info.outcome === 'deny' && pr.redelivery.delivered_at_read_url ? '정보 조회 거절·본문 전달'
          : pr.info.outcome === 'deny' ? '정보 조회 거절·본문 없음(이 시점·이 주소·이 자격에 대한 관측)'
            : infoVsBody(pr.info.outcome, pr.redelivery.same_url),
      },
    };
    pr.statement = step === 'post'
      ? `정보 조회: ${pr.info.outcome}(기대 ${expect}) ‖ 처음 보내는 주소의 본문 GET: ${three['2_처음_보내는_주소의_본문_GET'].reading} ‖ 이미 읽은 주소의 재전달: ${three['3_pre에서_이미_읽은_주소의_재전달'].reading}`
      : `되돌린 뒤 정보 조회: ${pr.info.outcome}(기대 allow) ‖ 이미 읽은 주소: ${pr.redelivery.line}`;
  }

  const probeMismatch = pr.info ? !pr.info.match : false;
  const preProbeFailed = step === 'pre' && !pr.body_received_at_same_url;
  const left = decodeJwtPayload(jwts.subject).exp - Math.floor(Date.now() / 1000);
  say(`fn-${kind} ${step} — 기대값 대조(정보 조회·올리기·덮어쓰기·삭제): 다른 것 ${summary.mismatch + (probeMismatch ? 1 : 0)}건`);
  say(`fn-${kind} ${step} — ${pr.statement}`);
  return {
    exit: summary.mismatch || probeMismatch || preProbeFailed ? 1 : 0,
    result: {
      credential: { ...jwtInfo.subject, seconds_left_at_end: left },
      note: step === 'post'
        ? '셋을 따로 읽는다(three_way). ① 정보 조회 — 기대값 거절. 종료 값과 expectation_mismatch_total 은 이것과 올리기·덮어쓰기·삭제의 기대값 대조만 센다 ② 처음 보내는 주소의 본문 GET — 관측 ③ pre 에서 이미 읽은 주소의 재전달 — 관측. 정보 조회가 거절인데 본문이 오면 그 줄은 "정보 조회 거절·본문 전달"이고, 파일 접근 차단 성공으로 적지 않는다. 정보 조회의 거절이 본문 내려받기의 차단을 뜻하는지는 이 도구가 입증하지 않는다. 거절이 규칙 때문인지 보려면 seconds_left_at_end 가 0보다 크고, 응답 종류가 jwt 가 아니며, 서비스 열쇠 대조군이 allow 여야 한다.'
        : step === 'pre' ? '같은 자격으로 네 동작이 모두 허용됨을 확인하고, revocation_probe 에 "정상 자격으로 그 주소에서 본문을 받았음"을 적는다.'
          : '원래 값으로 되돌린 뒤 다시 허용되는지 본다.',
      expectation_mismatch_total: summary.mismatch + (probeMismatch ? 1 : 0),
      three_way: three,
      revocation_probe: pr,
      summary, rows,
    },
  };
}

// ---------------------------------------------------------------------
// cache: 중간 저장의 관측 (잰 값 표, 기대값 없음)
//   실제 상태(목록 + 정보 조회)와 전달된 것(본문 GET, 값 없는 주소 / 임의 값 주소)을 나란히 적는다.
//   인증 경로: 판정 함수 버킷, 회원 A 의 자기 폴더 파일. 공개 주소: 기준선의 공개 버킷 하나(guide-images) — 표를 따로 낸다.
// ---------------------------------------------------------------------
const RETENTION_OFFSETS = [0, 10, 30, 60, 120, 300];

async function phaseCache(run) {
  const maxSeconds = Number.isFinite(Number(args['max-seconds'])) ? Math.max(0, Number(args['max-seconds'])) : 300;
  const offsets = RETENTION_OFFSETS.filter((t) => t <= maxSeconds);
  const lastOffset = offsets[offsets.length - 1];
  const file = (n) => `${memberA}/r${run}-cache-${n}.png`;
  const auth = {};

  const make = async (bucket, path, bytes) => {
    const st = await restoreStart(bucket, [{ path, bytes }]);
    return { start_ok: st.ok };
  };
  // 실제 상태(저장 정보): 어느 내용인가
  const actual = async (label, bucket, path, named) => {
    const t = await readTrue(bucket, path);
    const is = !t.known ? '미확인' : !t.exists ? '없음' : (Object.entries(named).find(([, b]) => b && t.md5 === md5(b))?.[0] ?? '그 밖');
    return { label, row: '실제 상태(목록 + 정보 조회)', known: t.known, unverified: t.unverified, is, md5: t.md5 ?? null, list_cf: t.list.cf_cache_status, info_cf: t.info.cf_cache_status, list_updated_at: t.list.updated_at ?? null };
  };
  // 전달된 것(본문 GET)
  const got = async (label, actor, bucket, path, shape, contents, pub = false) => {
    const b = await bodyGet(actor, bucket, path, shape, contents, { pub });
    return { label, row: '전달된 본문(GET)', who: b.who, url_shape: shape, http_status: b.http_status, cf_cache_status: b.cf_cache_status, age: b.age, cache_control: b.cache_control, body_md5: b.body_md5, body_is: b.body_is, error_kind: b.error?.kind ?? null };
  };
  // 정보 조회(재려는 자격)
  const look = async (label, actor, bucket, path) => {
    const i = await infoAs(actor, bucket, path);
    return { label, row: '정보 조회', who: actor, http_status: i.http_status, cf_cache_status: i.cf_cache_status, etag: i.etag, error_kind: i.error?.kind ?? null };
  };
  const brief = (x) => (x.row === '전달된 본문(GET)' ? `${x.http_status} ${x.cf_cache_status ?? '-'} ${x.body_is}` : x.row === '정보 조회' ? `정보 ${x.http_status}` : `실제 ${x.is}`);

  // E1. 같은 주소 재읽기(값 없는 주소 1·2·3회), 임의 값 주소도 매번 다른 값으로 1·2·3회
  {
    const p = file('e1');
    const original = makePng(`${run} cache e1 original`);
    const c = { current: original, old: [] };
    const s = await make(FN_BUCKET, p, original);
    const rows = [await actual('처음', FN_BUCKET, p, { original })];
    for (let i = 1; i <= 3; i += 1) rows.push(await got(`A 값 없는 주소 ${i}회`, 'member_a', FN_BUCKET, p, 'same_url', c));
    for (let i = 1; i <= 3; i += 1) rows.push(await got(`A 임의 값 주소 ${i}회(매번 다른 값)`, 'member_a', FN_BUCKET, p, 'with_query', c));
    auth.e1_rereads = { path: p, ...s, rows };
    say('cache E1 재읽기 — ' + rows.slice(1).map((x) => x.cf_cache_status ?? '-').join(' → '));
  }

  // E2. 덮어쓴 뒤: 실제 상태와 두 주소 모양
  {
    const p = file('e2');
    const original = makePng(`${run} cache e2 original`);
    const replaced = makePng(`${run} cache e2 replaced`);
    const named = { original, replaced };
    const s = await make(FN_BUCKET, p, original);
    const before = { current: original, old: [] };
    const afterC = { current: replaced, old: [original] };
    const rows = [];
    for (let i = 1; i <= 2; i += 1) rows.push(await got(`덮어쓰기 전 A 값 없는 주소 ${i}회`, 'member_a', FN_BUCKET, p, 'same_url', before));
    rows.push(await got('덮어쓰기 전 A 임의 값 주소', 'member_a', FN_BUCKET, p, 'with_query', before));
    const ow = await upload('service', FN_BUCKET, p, replaced, { upsert: true });
    rows.push({ label: '서비스 열쇠로 덮어씀(x-upsert: true)', row: '쓰기', http_status: ow.status, ok: ow.ok });
    rows.push(await actual('덮어쓴 뒤', FN_BUCKET, p, named));
    rows.push(await got('덮어쓴 뒤 A 값 없는 주소', 'member_a', FN_BUCKET, p, 'same_url', afterC));
    rows.push(await got('덮어쓴 뒤 A 임의 값 주소 1회', 'member_a', FN_BUCKET, p, 'with_query', afterC));
    rows.push(await got('덮어쓴 뒤 A 임의 값 주소 2회(다른 값)', 'member_a', FN_BUCKET, p, 'with_query', afterC));
    auth.e2_after_overwrite = { path: p, ...s, rows };
    say('cache E2 덮어쓴 뒤 — ' + rows.slice(4).map(brief).join(' | '));
  }

  // E4. 다른 사람이 요청했을 때(A 가 읽어 둔 객체): 정보 조회와 본문 GET 두 모양
  {
    const p = file('e4');
    const original = makePng(`${run} cache e4 original`);
    const c = { current: original, old: [] };
    const s = await make(FN_BUCKET, p, original);
    const rows = [];
    for (let i = 1; i <= 2; i += 1) rows.push(await got(`A 값 없는 주소 ${i}회(먼저 읽어 둠)`, 'member_a', FN_BUCKET, p, 'same_url', c));
    rows.push(await got('A 임의 값 주소(먼저 읽어 둠)', 'member_a', FN_BUCKET, p, 'with_query', c));
    for (const [who, label] of [['member_b', 'B'], ['no_map', '대응 없는 계정'], ['anon', '비로그인']]) {
      rows.push(await look(`${label} 정보 조회`, who, FN_BUCKET, p));
      rows.push(await got(`${label} 값 없는 주소`, who, FN_BUCKET, p, 'same_url', c));
      rows.push(await got(`${label} 임의 값 주소`, who, FN_BUCKET, p, 'with_query', c));
    }
    rows.push(await got('A 값 없는 주소(다른 사람들 뒤)', 'member_a', FN_BUCKET, p, 'same_url', c));
    auth.e4_other_people = { path: p, ...s, rows };
    say('cache E4 다른 사람 — ' + rows.slice(3, 12).map((x) => `${x.label}: ${brief(x)}`).join(' | '));
  }

  // E5. 같은 사람의 다른 로그인 상태에서 받은 자격
  {
    const p = file('e5');
    const original = makePng(`${run} cache e5 original`);
    const c = { current: original, old: [] };
    const s = await make(FN_BUCKET, p, original);
    const rows = [];
    for (let i = 1; i <= 2; i += 1) rows.push(await got(`A(평소 로그인 상태) 값 없는 주소 ${i}회`, 'member_a', FN_BUCKET, p, 'same_url', c));
    rows.push(await look('A(다른 로그인 상태) 정보 조회', 'member_a_other', FN_BUCKET, p));
    rows.push(await got('A(다른 로그인 상태) 값 없는 주소 — 이 자격의 첫 읽기', 'member_a_other', FN_BUCKET, p, 'same_url', c));
    rows.push(await got('A(다른 로그인 상태) 임의 값 주소', 'member_a_other', FN_BUCKET, p, 'with_query', c));
    auth.e5_same_person_other_login = { path: p, ...s, sessions: { usual: jwtInfo.member_a.session_id, other: jwtInfo.member_a_other.session_id }, rows };
    say('cache E5 같은 사람의 다른 로그인 상태 — ' + rows.slice(2).map(brief).join(' | '));
  }

  // E3(인증)·E6(공개): 지운 뒤의 실제 상태와 두 주소 모양, 그리고 유지 시간. 두 경로를 같은 시간표로 함께 잰다(표는 따로).
  const p3 = file('e3');
  const o3 = makePng(`${run} cache e3 original`);
  const s3 = await make(FN_BUCKET, p3, o3);
  const live3 = { current: o3, old: [] };
  const gone3 = { current: null, old: [o3] };
  const rows3 = [];
  for (let i = 1; i <= 2; i += 1) rows3.push(await got(`지우기 전 A 값 없는 주소 ${i}회`, 'member_a', FN_BUCKET, p3, 'same_url', live3));
  rows3.push(await got('지우기 전 A 임의 값 주소', 'member_a', FN_BUCKET, p3, 'with_query', live3));

  const PUB_BUCKET = 'guide-images';
  const p6 = `${Date.now()}_${BUSINESS_MARK}_cache.png`; // cleanup 이 표식(_zzb2n2)으로 지운다
  const o6 = makePng(`${run} cache e6 public original`);
  const s6 = await make(PUB_BUCKET, p6, o6);
  const live6 = { current: o6, old: [] };
  const gone6 = { current: null, old: [o6] };
  const rows6 = [];
  for (let i = 1; i <= 2; i += 1) rows6.push(await got(`지우기 전 공개 주소 값 없는 주소 ${i}회`, null, PUB_BUCKET, p6, 'same_url', live6, true));
  rows6.push(await got('지우기 전 공개 주소 임의 값 주소', null, PUB_BUCKET, p6, 'with_query', live6, true));

  const d3 = await removeOne('service', FN_BUCKET, p3);
  const d6 = await removeOne('service', PUB_BUCKET, p6);
  const deletedAt = Date.now();
  rows3.push({ label: '서비스 열쇠로 지움', row: '쓰기', http_status: d3.status, ok: d3.ok });
  rows6.push({ label: '서비스 열쇠로 지움', row: '쓰기', http_status: d6.status, ok: d6.ok });

  const ret3 = [];
  const ret6 = [];
  for (const t of offsets) {
    const wait = deletedAt + t * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    const elapsed = Math.round((Date.now() - deletedAt) / 100) / 10;
    const a = {
      scheduled_seconds: t, elapsed_seconds: elapsed,
      actual: await actual(`삭제 후 ${t}초 시점`, FN_BUCKET, p3, { original: o3 }),
      same_url: await got(`삭제 후 ${t}초 시점 A 값 없는 주소`, 'member_a', FN_BUCKET, p3, 'same_url', gone3),
      with_query: await got(`삭제 후 ${t}초 시점 A 임의 값 주소`, 'member_a', FN_BUCKET, p3, 'with_query', gone3),
    };
    const b = {
      scheduled_seconds: t, elapsed_seconds: elapsed,
      actual: await actual(`삭제 후 ${t}초 시점`, PUB_BUCKET, p6, { original: o6 }),
      same_url: await got(`삭제 후 ${t}초 시점 공개 주소 값 없는 주소`, null, PUB_BUCKET, p6, 'same_url', gone6, true),
      with_query: await got(`삭제 후 ${t}초 시점 공개 주소 임의 값 주소`, null, PUB_BUCKET, p6, 'with_query', gone6, true),
    };
    ret3.push(a);
    ret6.push(b);
    say(`cache 유지 시간 — 삭제 후 ${t}초: 인증[실제 ${a.actual.is} | 값 없는 주소 ${brief(a.same_url)} | 임의 값 주소 ${brief(a.with_query)}] 공개[실제 ${b.actual.is} | 값 없는 주소 ${brief(b.same_url)} | 임의 값 주소 ${brief(b.with_query)}]`);
  }
  // 유지 시간을 읽는 말: "아직 옛 내용이 오는가"는 GET 으로 본다. 마지막 시점에도 오면 "그 시점에도 관측, 끝나는 시각 미확인"(더 기다리지 않는다).
  const retentionStatement = (rows, shape) => {
    const seq = rows.map((x) => ({ t: x.scheduled_seconds, old: x[shape].body_is === '옛 내용' }));
    const got2 = seq.filter((x) => x.old);
    if (got2.length === 0) return '지운 뒤 옛 내용이 한 번도 오지 않음(0초 시점부터)';
    const lastGot = got2[got2.length - 1].t;
    const firstGone = seq.find((x) => x.t > lastGot && !x.old);
    if (!firstGone) return `삭제 후 ${lastGot}초 시점에도 관측, 끝나는 시각 미확인`;
    return `삭제 후 ${lastGot}초 시점까지 옛 내용이 관측됐고, ${firstGone.t}초 시점에는 오지 않음(끝난 시각은 그 사이 — 정확한 시각은 재지 않음)`;
  };
  const actualStatement = (rows) => (rows.every((x) => x.actual.known && x.actual.is === '없음') ? '모든 시점에서 실제 상태는 "없음"(목록에 없고 정보 조회도 객체 없음)' : '실제 상태가 "없음"으로 확인되지 않은 시점이 있음(retention 의 actual 을 볼 것)');
  auth.e3_after_delete = {
    path: p3, ...s3, rows: rows3, retention: ret3,
    statements: { 실제_상태: actualStatement(ret3), 값_없는_주소: retentionStatement(ret3, 'same_url'), 임의_값_주소: retentionStatement(ret3, 'with_query') },
  };
  const pub = {
    bucket: PUB_BUCKET, path: p6, ...s6, rows: rows6, retention: ret6,
    statements: { 실제_상태: actualStatement(ret6), 값_없는_주소: retentionStatement(ret6, 'same_url'), 임의_값_주소: retentionStatement(ret6, 'with_query') },
    note: '공개 주소(/object/public/…)의 관측이다. 인증 경로의 표와 섞어 읽지 않는다. 공개 버킷의 공개 주소는 규칙과 무관하게 열린다.',
  };

  return {
    exit: 0,
    result: {
      note: '기대값 없음 — 잰 값을 그대로 적은 표다. 줄마다 "실제 상태(목록 + 정보 조회)"·"전달된 본문(GET)"·"정보 조회" 중 무엇인지(row)를 적는다. 전달된 본문은 상태·cf_cache_status·age·cache_control·바이트의 md5 와 그것이 현재 내용/옛 내용/그 밖 중 무엇인지(body_is)를 적는다. 여기서 본 것은 이 버킷·이 파일·이 자격들에 대한 관측이다(중간 저장이 어떤 단위로 나뉘는지의 원리나 운영의 설정을 입증하지 않는다).',
      max_seconds: maxSeconds, retention_offsets: offsets, last_offset: lastOffset,
      authenticated_path: auth,
      public_path: pub,
      statements: { 인증_지운_뒤: auth.e3_after_delete.statements, 공개_지운_뒤: pub.statements },
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
    independent_read: '저장 상태는 readTrue 하나로만 읽는다: 서비스 열쇠의 목록 조회(POST)와 정보 조회(GET /object/info/authenticated/…)로 있음·eTag·크기·형식을 읽고 eTag 를 기대한 바이트의 md5 와 견준다. 두 응답의 cf_cache_status 가 DYNAMIC 이 아니거나, 시간 초과·서버 오류이거나, 목록이 한도까지 차서 끝까지 읽지 못했거나, eTag 가 md5 모양이 아니거나, 둘이 어긋나면 known: false(미확인)이고 판정에 쓰지 않는다. "없음"은 정확한 경로가 목록에 없고 정보 조회도 객체 없음일 때만이다. 이것은 저장 정보를 읽은 것이지 본문 바이트를 다시 받아 확인한 것이 아니다. 소유자는 Storage API 로 볼 수 없어 fingerprint.sql 의 objects 로 본다.',
    three_separate_readings: '셋을 따로 잰다: ① 저장 정보(readTrue) ② 정보 조회의 허용·거절(infoAs — 기대값 대조는 이것으로만) ③ 실제 전달된 본문(bodyGet: 값 없는 주소 same_url / 임의 값 주소 with_query — 관측만, 받은 바이트가 현재 내용/옛 내용/그 밖). 본문을 받는 GET 은 어떤 모양의 주소로도 판정에 쓰지 않는다. 정보 조회의 거절은 "그 자격으로 그 파일의 정보를 볼 수 없다"까지만 뜻하고, 본문 내려받기의 차단을 뜻하는지는 입증하지 않는다.',
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
