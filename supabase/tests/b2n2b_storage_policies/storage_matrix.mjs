// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-2b: 파일 규칙 대조표 도구 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 이 도구는 작업방이 실제 Storage 에 한 번도 실행해 보지 않았다. 작업방 컴퓨터 안의 가짜 응답(네트워크 없음)으로만
// 돌려 봤고, 그 가짜 응답은 작업방이 짐작으로 흉내 낸 것이라 실제 동작을 대신하지 않는다.
// 2a 3차 도구(measure.mjs, c3b2cf2)에서 실행으로 확인된 요청 형식·응답 모양(올리기·목록·정보 조회·삭제·이동,
// 권한 오류 400/403, 객체 없음 400/404/NoSuchKey, 중복 400/409)은 그대로 가져왔다.
// 이번에 새로 쓰는 것(복사 요청, 꾸민 경로를 그대로 보내는 원시 요청, 올리기 응답의 Key·Id, 목록의 쪽 나눔,
// 객체 식별자 필드)은 실행으로 확인된 적이 없다 — 도구는 원 응답을 그대로 남긴다.
//
// 판정 방식 (2a 3차에서 가져오고 고친 것)
//   * 저장 정보는 서비스 열쇠의 목록 조회 + 정보 조회로만 읽는다(cf-cache-status 가 DYNAMIC 일 때만 인정,
//     eTag 를 올린 내용의 md5 와 대조). 이것은 저장 정보(메타데이터)다 — 본문을 다시 받아 확인한 것이 아니다.
//   * "객체 없음"으로 인정하는 응답은 관측된 모양 하나뿐이다: HTTP 400 · 본문 statusCode 404 · code NoSuchKey.
//     일반 404, 그 밖의 "not found" 문구, 서버 오류, 통신 오류는 전부 "미확인"이다.
//   * 기대값 대조는 올리기·정보 조회·덮어쓰기·삭제·이동·복사·목록으로 한다. 본문 GET 은 관측이다.
//     다만 새로 생긴 객체는 본문(md5)도 따로 견준다 — 서비스 열쇠가 그 객체를 처음 읽는 값 없는 인증 주소 한 번.
//     올린 사람의 읽기는 올리기 성공의 조건이 아니다(올린 사람은 읽기 규칙이 없어 못 읽는 것이 정상이다).
//   * 거절로 적는 칸에는 같은 입력의 서비스 열쇠 대조군이 성공해야 한다. 아니면 "권한 미판정"이다.
//   * 미확인은 통과 수에 넣지 않는다. 미확인이나 기대와 다른 칸이 하나라도 있으면 종료 값 1 이다.
//   * 소유자는 Storage API 로 볼 수 없다. 단계가 끝난 뒤 fingerprint.sql 을 떠서 owners 단계(요청 0)로 견준다.
//
// 상태 (--state): 지금 시험 프로젝트에 어떤 규칙이 올라가 있는가. 기대값이 이것으로 정해진다.
//   before      옛 26개만(새 규칙 적용 전)          applied     옛 26개 + 새 규칙 4개
//   rehearsal   옛 16개 + 새 규칙 4개(옛 비로그인 규칙 10개를 지운 예행 상태)
//   rolledback  새 규칙을 되돌린 뒤(= before 와 같은 기대값)
//   도구는 상태를 스스로 확인하지 못한다 — 실행하는 쪽이 fingerprint.sql 로 확인하고 넘긴다.
//
// 자격(칸): anon 비로그인 / member_a 회원 A / member_b 회원 B / no_map 대응 없는 계정 /
//   admin_g_pre·admin_g_post 관리자 G(회원 대응 없음) 6자리 전·후 /
//   admin_gm_pre·admin_gm_post 관리자 GM(회원 대응 있음) 6자리 전·후 / service 서비스 열쇠(대조군)
//   비로그인 칸은 before·applied·rolledback 에서는 기대값 없이 잰 값을 적고(compare 단계로 서로 견준다),
//   rehearsal 에서는 기대값이 있다.
//
// 환경 변수 (비밀값은 여기로만 받는다. 결과·출력에 넣지 않는다)
//   B2N2B_URL  B2N2B_SERVICE_KEY  B2N2B_ANON_KEY
//   B2N2B_MEMBER_A  B2N2B_MEMBER_B  B2N2B_MEMBER_GM            회원번호(public.users.id)
//   B2N2B_JWT_A  B2N2B_JWT_B  B2N2B_JWT_N                      A·B·대응 없는 계정
//   B2N2B_JWT_G1  B2N2B_JWT_G2                                 관리자 G 의 6자리 전(aal1)·후(aal2)
//   B2N2B_JWT_GM1  B2N2B_JWT_GM2                               관리자 GM 의 6자리 전(aal1)·후(aal2)
//   B2N2B_JWT_A_EXP  B2N2B_JWT_A_OUT                           A 의 만료 시험용·로그아웃 시험용(서로 다른 로그인 상태)
//   B2N2B_TABLE_REF_PATHS                                      table-ref 단계의 표 쪽 기준 요청 경로(쉼표)
//
// 단계 (--phase)                                                                    요청
//   plan             대조표의 줄·칸·기대값을 적는다                                   0
//   upload-new       새 이름 올리기: 경로 모양 × 요청 방식 × 자격                     있음
//   upload-existing  있는 이름에 다시 올리기: 경로 × 먼저 만든 쪽 × 요청 방식 × 자격   있음
//   actions          정보 조회·목록·삭제·이동·복사 + 공개 주소                        있음
//   revoked          만료·로그아웃한 A 의 올리기: --kind expired|loggedout --step pre|post|restored
//   cleanup          이 도구의 합성 객체(이름에 zzb2n2b)를 지우고 남은 객체를 적는다    있음
//   table-ref        표 쪽 기준 요청(비로그인 GET): --compare <앞 결과>                있음
//   compare          두 결과 파일의 칸을 견준다: --base <json> --with <json> [--actors anon]   0
//   owners           결과의 객체 장부를 fingerprint.sql 결과와 견준다(식별자·소유자·저장 정보):
//                    --result <json>[,<json>…] --fingerprint <json>                   0
// 공통 인자: --state <상태>  --out <결과 JSON>  [--actors a,b,…]  [--rows 시작-끝]  [--bucket <버킷>]
//            [--min-seconds N]  자격의 남은 유효 시간 하한(기본 1200초. 긴 단계가 도는 동안 자격이 살아 있어야 한다)
// 긴 단계는 줄마다 진행 상황을 표준 출력에 한 줄씩 적는다. 자격의 남은 시간이 90초 아래로 내려가면 그 줄 앞에서
// 멈추고 거기까지의 결과를 적는다(--rows 로 이어서 잰다).
//
// 종료 값: 0 = 끝까지 했고 기대값 있는 칸이 전부 통과(미확인 0) / 1 = 기대와 다르거나 미확인인 칸이 있음 /
//          2 = 대상·입력 확인에서 멈춤(요청 0) / 3 = 실행 중 멈춤
// =====================================================================

import { writeFile, readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import https from 'node:https';

const REF = 'hmncdheiwqwekdbtijar';
const HOST = `${REF}.supabase.co`;
const ORIGIN = `https://${HOST}`;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MARK = 'zzb2n2b'; // 이 도구가 만드는 모든 합성 파일의 이름에 들어가는 표식
const SCORE = 'toefl-score-images';
const BOARD = 'board-files';
const GUIDE = 'guide-images';
const MATERIALS = 'materials';
const BUCKETS = [SCORE, BOARD, GUIDE, MATERIALS];
const STUDENT_KEYS = ['reviews', 'reviews_book', 'study_certify'];
const ADMIN_KEYS = ['notice', 'materials', 'application_notice'];
const STATES = ['before', 'applied', 'rehearsal', 'rolledback'];
const ALL_ACTORS = ['anon', 'member_a', 'member_b', 'no_map', 'admin_g_pre', 'admin_g_post', 'admin_gm_pre', 'admin_gm_post', 'service'];
const ACTOR_CODE = { anon: 'an', member_a: 'ma', member_b: 'mb', no_map: 'nm', admin_g_pre: 'g1', admin_g_post: 'g2', admin_gm_pre: 'm1', admin_gm_post: 'm2', service: 'sv', subject: 'sj' };
const ACTOR_ENV = {
  member_a: ['B2N2B_JWT_A', null], member_b: ['B2N2B_JWT_B', null], no_map: ['B2N2B_JWT_N', null],
  admin_g_pre: ['B2N2B_JWT_G1', 'aal1'], admin_g_post: ['B2N2B_JWT_G2', 'aal2'],
  admin_gm_pre: ['B2N2B_JWT_GM1', 'aal1'], admin_gm_post: ['B2N2B_JWT_GM2', 'aal2'],
};

// ---------------------------------------------------------------------
// 인자·환경 변수·대상 확인 (여기까지는 어떤 요청도 보내지 않는다)
// ---------------------------------------------------------------------
let requestCount = 0;
const say = (msg) => console.log(`[b2n2b] ${msg}`);

function stop(code, message) {
  console.error(`[b2n2b] 멈춤: ${message}`);
  console.error('[b2n2b] 보낸 요청 수: ' + requestCount);
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

const PHASES = ['plan', 'upload-new', 'upload-existing', 'actions', 'revoked', 'cleanup', 'table-ref', 'compare', 'owners'];
const MEASURE_PHASES = ['upload-new', 'upload-existing', 'actions'];
const NO_REQUEST_PHASES = ['plan', 'compare', 'owners'];
const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
if (!PHASES.includes(phase)) stop(2, `--phase 는 다음 중 하나여야 한다: ${PHASES.join(', ')}`);
const state = args.state ?? null;
if ([...MEASURE_PHASES, 'plan', 'revoked'].includes(phase) && !STATES.includes(state)) stop(2, `--state 는 다음 중 하나여야 한다: ${STATES.join(', ')}`);
const step = args.step ?? null;
const kind = args.kind ?? null;
if (phase === 'revoked') {
  if (!['expired', 'loggedout'].includes(kind)) stop(2, 'revoked 는 --kind expired|loggedout 이 필요하다');
  if (!(kind === 'expired' ? ['pre', 'post', 'restored'] : ['pre', 'post']).includes(step)) stop(2, 'revoked 는 --step pre|post (만료는 restored 도) 가 필요하다');
}
const outPath = args.out ?? null;
if (!outPath && !['compare', 'owners'].includes(phase)) stop(2, '--out <결과 JSON 경로> 가 필요하다');
const minSeconds = Number.isFinite(Number(args['min-seconds'])) ? Math.max(120, Number(args['min-seconds'])) : 1200;
const onlyBucket = args.bucket ?? null;
if (onlyBucket && !BUCKETS.includes(onlyBucket)) stop(2, `--bucket 은 다음 중 하나여야 한다: ${BUCKETS.join(', ')}`);
let rowRange = null;
if (args.rows) {
  const m = /^(\d+)-(\d+)$/.exec(args.rows);
  if (!m || Number(m[1]) < 1 || Number(m[2]) < Number(m[1])) stop(2, '--rows 는 "시작-끝"(1부터) 모양이어야 한다');
  rowRange = [Number(m[1]), Number(m[2])];
}
let actors = ALL_ACTORS;
if (args.actors) {
  const list = args.actors.split(',').map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!ALL_ACTORS.includes(a)) stop(2, `--actors 에 모르는 자격이 있다: ${a} (${ALL_ACTORS.join(', ')})`);
  actors = ALL_ACTORS.filter((a) => list.includes(a) || a === 'service'); // 대조군(서비스 열쇠)은 늘 넣는다
}

const env = process.env;
const keyNotes = {};
let serviceKey = null;
let anonKey = null;
let memberA = null;
let memberB = null;
let memberGM = null;
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
function checkUserJwt(label, name, { aal, min }) {
  const token = needEnv(name);
  const p = decodeJwtPayload(token);
  if (!p) stop(2, `${name} 이 JWT 모양이 아니다`);
  if (typeof p.iss !== 'string' || !p.iss.startsWith(`${ORIGIN}/`)) stop(2, `${name} 의 발급자(iss)가 시험 프로젝트가 아니다. 아무 요청도 보내지 않는다`);
  if (p.role !== 'authenticated') stop(2, `${name} 의 role 이 authenticated 가 아니다`);
  if (!UUID_RE.test(String(p.sub ?? '')) || !UUID_RE.test(String(p.session_id ?? ''))) stop(2, `${name} 에 sub 또는 session_id 가 없다`);
  const left = (typeof p.exp === 'number' ? p.exp : 0) - Math.floor(Date.now() / 1000);
  if (left < min) stop(2, `${name} 의 남은 유효 시간이 ${min}초보다 짧다(지금 ${left}초). 자격 자체가 만료되면 규칙의 거절과 구분할 수 없으므로 새로 받아 올 것`);
  if (aal && p.aal !== aal) stop(2, `${name} 의 aal 이 ${aal} 이 아니다(지금 ${p.aal})`);
  jwts[label] = token;
  // sub·session_id 는 식별값이다(자격이 아니다). 소유자 대조와 만료용 SQL 의 조건에 쓰라고 결과에 적는다.
  jwtInfo[label] = { sub: p.sub, session_id: p.session_id, aal: p.aal ?? null, seconds_left_at_start: left, exp: p.exp };
}
function needMember(name) {
  const v = String(needEnv(name)).toLowerCase();
  if (!UUID_RE.test(v)) stop(2, `${name} 이 uuid 모양이 아니다`);
  return v;
}

if (!NO_REQUEST_PHASES.includes(phase)) {
  const baseUrl = String(env.B2N2B_URL ?? '').replace(/\/+$/, '');
  let origin = null;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = null;
  }
  if (origin !== ORIGIN || baseUrl !== ORIGIN) stop(2, `B2N2B_URL 이 시험 프로젝트(${ORIGIN})가 아니다. 아무 요청도 보내지 않는다`);

  if (phase === 'table-ref') {
    anonKey = needEnv('B2N2B_ANON_KEY');
    checkKey('B2N2B_ANON_KEY', anonKey, 'anon');
    needEnv('B2N2B_TABLE_REF_PATHS');
  } else {
    serviceKey = needEnv('B2N2B_SERVICE_KEY');
    checkKey('B2N2B_SERVICE_KEY', serviceKey, 'service_role');
    if (phase !== 'cleanup') {
      anonKey = needEnv('B2N2B_ANON_KEY');
      checkKey('B2N2B_ANON_KEY', anonKey, 'anon');
      if (anonKey === serviceKey) stop(2, 'anon 키와 service 키가 같다');
      memberA = needMember('B2N2B_MEMBER_A');
      memberB = needMember('B2N2B_MEMBER_B');
      memberGM = needMember('B2N2B_MEMBER_GM');
      if (new Set([memberA, memberB, memberGM]).size !== 3) stop(2, 'B2N2B_MEMBER_A·B·GM 이 서로 다른 값이 아니다');
    }
    if (MEASURE_PHASES.includes(phase)) {
      // 먼저 만드는 쪽(회원 A·B, 관리자 G 6자리 후)의 자격은 --actors 로 줄여도 필요하다
      const needed = new Set([...actors.filter((a) => ACTOR_ENV[a]), ...(phase === 'upload-new' ? [] : ['member_a', 'member_b', 'admin_g_post'])]);
      for (const a of needed) checkUserJwt(a, ACTOR_ENV[a][0], { aal: ACTOR_ENV[a][1], min: minSeconds });
      const pair = (x, y, who) => {
        if (jwtInfo[x] && jwtInfo[y] && jwtInfo[x].sub !== jwtInfo[y].sub) stop(2, `${who} 의 6자리 전·후 자격이 같은 계정이 아니다`);
      };
      pair('admin_g_pre', 'admin_g_post', '관리자 G');
      pair('admin_gm_pre', 'admin_gm_post', '관리자 GM');
      const people = ['member_a', 'member_b', 'no_map', 'admin_g_post', 'admin_g_pre', 'admin_gm_post', 'admin_gm_pre'].filter((a) => jwtInfo[a]);
      const subs = new Map();
      for (const a of people) {
        const person = a.replace(/_(pre|post)$/, '');
        const prev = subs.get(jwtInfo[a].sub);
        if (prev && prev !== person) stop(2, `${a} 의 자격이 ${prev} 와 같은 계정이다. A·B·N·G·GM 은 서로 다른 계정이어야 한다`);
        subs.set(jwtInfo[a].sub, person);
      }
    }
    if (phase === 'revoked') {
      const name = kind === 'expired' ? 'B2N2B_JWT_A_EXP' : 'B2N2B_JWT_A_OUT';
      checkUserJwt('subject', name, { aal: null, min: 180 });
      // 만료 시험과 로그아웃 시험은 서로 다른 로그인 상태, 그리고 평소 쓰는 A 의 로그인 상태와도 다른 것이어야 한다.
      for (const other of ['B2N2B_JWT_A', kind === 'expired' ? 'B2N2B_JWT_A_OUT' : 'B2N2B_JWT_A_EXP']) {
        const p = env[other] ? decodeJwtPayload(env[other]) : null;
        if (p && p.session_id === jwtInfo.subject.session_id) stop(2, `이 단계의 자격이 ${other} 와 같은 로그인 상태다. 서로 다른 로그인 상태에서 받은 자격을 쓸 것`);
        if (p && p.sub !== jwtInfo.subject.sub) stop(2, `이 단계의 자격이 ${other} 와 다른 계정이다(회원 A 의 다른 로그인 상태여야 한다)`);
      }
    }
  }
} else if (phase === 'plan') {
  // plan 은 요청을 보내지 않는다. 회원번호가 있으면 쓰고 없으면 자리 표시 값을 쓴다.
  const or = (name, fallback) => (env[name] && UUID_RE.test(env[name]) ? env[name].toLowerCase() : fallback);
  memberA = or('B2N2B_MEMBER_A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  memberB = or('B2N2B_MEMBER_B', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  memberGM = or('B2N2B_MEMBER_GM', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
}

// ---------------------------------------------------------------------
// 합성 파일: 같은 형식(PNG 1×1)의 서로 다른 정확한 내용
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
  const text = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(`${MARK} ${label}`, 'latin1')]);
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
// HTTP — 보통 요청은 fetch(2a 에서 실행으로 확인된 통로), 꾸민 경로는 원시 요청(node:https)
//   fetch 는 주소의 ".." 구간을 보내기 전에 스스로 정리해 버린다. 꾸민 경로는 적은 글자 그대로 보내야 하므로
//   원시 요청을 쓴다. 원시 요청이 중간 경로(CDN)에서 어떻게 다뤄지는지는 확인된 적이 없다 — 응답을 그대로 적는다.
// ---------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TIMEOUT_MS = 30000;

function authFor(actor) {
  if (actor === null) return {}; // 공개 주소: 자격 없이
  if (actor === 'service') return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  if (actor === 'anon') return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  return { apikey: anonKey, Authorization: `Bearer ${jwts[actor]}` };
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
// fetch 가 바꿔 버리는 이름(빈 구간, "."·".." 구간)인가 — 그런 이름은 원시 요청으로만 가리킬 수 있다
const needsRaw = (name) => name.split('/').some((s) => s === '' || s === '.' || s === '..');

function shapeResponse(status, getHeader, buf) {
  const rawContentType = getHeader('content-type');
  const contentType = rawContentType ? String(rawContentType).split(';')[0].trim().toLowerCase() : null;
  let parsed = null;
  if (contentType && contentType.includes('json')) {
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      parsed = null;
    }
  }
  const cf = getHeader('cf-cache-status');
  return {
    status, ok: status >= 200 && status < 300, buf, contentType, json: parsed,
    cf: cf ? String(cf).trim().toUpperCase() : null,
    age: getHeader('age') ?? null,
    cacheControl: getHeader('cache-control') ?? null,
    netError: null,
  };
}
const netFail = (e) => ({ status: 0, ok: false, buf: Buffer.alloc(0), contentType: null, json: null, cf: null, age: null, cacheControl: null, netError: String(e?.name ?? 'Error') + ': ' + String(e?.message ?? e).slice(0, 120) });

// 시간 초과·네트워크 오류는 예외로 던지지 않고 status 0 의 응답으로 돌려준다(netError). 부르는 쪽이 "미확인"으로 적는다.
async function http(actor, method, urlPath, { headers = {}, body, json } = {}) {
  const h = { ...authFor(actor), ...headers };
  let payload = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  requestCount += 1;
  try {
    const res = await fetch(`${ORIGIN}${urlPath}`, { method, headers: h, body: payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const buf = Buffer.from(await res.arrayBuffer());
    return shapeResponse(res.status, (k) => res.headers.get(k), buf);
  } catch (e) {
    return netFail(e);
  }
}
// 원시 요청: rawPath 를 적은 글자 그대로 보낸다(정리·재인코딩 없음). rawPath 에는 ASCII 만 둔다.
function httpRaw(actor, method, rawPath, { headers = {}, body } = {}) {
  requestCount += 1;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const h = { ...authFor(actor), ...headers, Accept: '*/*', 'User-Agent': 'b2n2b-storage-matrix' };
      if (body) h['Content-Length'] = String(body.length);
      const req = https.request({ host: HOST, port: 443, method, path: rawPath, headers: h, timeout: TIMEOUT_MS }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => finish(shapeResponse(res.statusCode ?? 0, (k) => res.headers[k] ?? null, Buffer.concat(chunks))));
        res.on('error', (e) => finish(netFail(e)));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => finish(netFail(e)));
      if (body) req.write(body);
      req.end();
    } catch (e) {
      finish(netFail(e));
    }
  });
}

// 원 응답을 그대로 남기고(상태·본문의 코드와 문구), 종류를 정한다.
// 종류는 "관측된 모양과 정확히 같은 것"만 이름을 붙이고, 나머지는 other 다 — other 는 거절로 세지 않는다.
//   rls            HTTP 400 · statusCode 403 · 문구에 row-level security      (올리기·덮어쓰기의 권한 거절, 2a 관측)
//   access_denied  HTTP 400 · statusCode 403 · code AccessDenied(그 밖의 문구) (삭제의 권한 거절, 2a 관측)
//   no_such_key    HTTP 400 · statusCode 404 · code NoSuchKey                  (객체 없음, 2a 관측)
//   duplicate      HTTP 400 · statusCode 409                                   (이름이 이미 있음, 2a 관측)
//   network / server_error / jwt                                               (판정에 쓰지 않는다 — 미확인)
function responseInfo(r) {
  const j = r.json && typeof r.json === 'object' && !Array.isArray(r.json) ? r.json : null;
  const bodyStatus = j?.statusCode != null ? String(j.statusCode) : null;
  const bodyError = j?.error != null ? String(j.error) : null;
  const bodyCode = j?.code != null ? String(j.code) : null;
  const message = j?.message != null ? String(j.message) : null;
  let k = null;
  if (!r.ok) {
    const text = `${bodyError ?? ''} ${bodyCode ?? ''} ${message ?? ''}`.toLowerCase();
    if (r.netError) k = 'network';
    else if (r.status >= 500 || (bodyStatus && Number(bodyStatus) >= 500)) k = 'server_error';
    else if (text.includes('jwt') || text.includes('jws') || text.includes('signature') || text.includes('token')) k = 'jwt';
    else if (r.status === 400 && bodyStatus === '403' && (text.includes('row-level security') || text.includes('row level security'))) k = 'rls';
    else if (r.status === 400 && bodyStatus === '403' && bodyCode === 'AccessDenied') k = 'access_denied';
    else if (r.status === 400 && bodyStatus === '404' && bodyCode === 'NoSuchKey') k = 'no_such_key';
    else if (r.status === 400 && bodyStatus === '409') k = 'duplicate';
    else k = 'other';
  }
  return {
    http_status: r.status,
    cf_cache_status: r.cf,
    body_statusCode: bodyStatus,
    body_error: bodyError,
    body_code: bodyCode,
    body_message: message,
    body_snippet: r.ok ? null : (r.netError ?? r.buf.toString('utf8').slice(0, 300)),
    kind: k,
  };
}
// 판정에 쓸 수 없는 응답(요청이 끝나지 않았거나 서버 오류, 자격 자체의 거절)
const inconclusive = (k) => k === 'network' || k === 'server_error' || k === 'jwt';
// 권한 거절로 인정하는 응답 모양(동작마다). 그 밖은 거절로 세지 않는다.
const DENY_KINDS = {
  upload: ['rls'], overwrite: ['rls'],
  delete: ['access_denied', 'no_such_key', 'rls'],
  move: ['no_such_key', 'access_denied', 'rls'],
  copy: ['no_such_key', 'access_denied', 'rls'],
};
// 칸 견주기용: 실행마다 달라지는 것(이름·시각)을 뺀 응답의 모양
const respSig = (ri) => (ri ? { http_status: ri.http_status, body_statusCode: ri.body_statusCode, body_error: ri.body_error, body_code: ri.body_code, kind: ri.kind } : null);

// --- Storage 객체 API ---
function upload(actor, bucket, path, bytes, { upsert }) {
  const headers = { 'Content-Type': PNG };
  if (upsert === true) headers['x-upsert'] = 'true'; // 지금 화면의 방식. "옵션 없음"에서는 머리글을 아예 보내지 않는다.
  return http(actor, 'POST', `/storage/v1/object/${bucket}/${encPath(path)}`, { headers, body: bytes });
}
// 꾸민 경로: rawTail 은 버킷 뒤에 붙일 주소 글자 그대로다
function uploadRaw(actor, bucket, rawTail, bytes, { upsert }) {
  const headers = { 'Content-Type': PNG };
  if (upsert === true) headers['x-upsert'] = 'true';
  return httpRaw(actor, 'POST', `/storage/v1/object/${bucket}/${rawTail}`, { headers, body: bytes });
}
const removeOne = (actor, bucket, path) => (needsRaw(path)
  ? httpRaw(actor, 'DELETE', `/storage/v1/object/${bucket}/${encPath(path)}`)
  : http(actor, 'DELETE', `/storage/v1/object/${bucket}/${encPath(path)}`));
const move = (actor, bucket, from, to) => http(actor, 'POST', '/storage/v1/object/move', { json: { bucketId: bucket, sourceKey: from, destinationKey: to } });
const copy = (actor, bucket, from, to) => http(actor, 'POST', '/storage/v1/object/copy', { json: { bucketId: bucket, sourceKey: from, destinationKey: to } });
const LIST_LIMIT = 1000;
const listRaw = (actor, bucket, prefix, search, offset = 0) => http(actor, 'POST', `/storage/v1/object/list/${bucket}`, {
  json: { prefix, limit: LIST_LIMIT, offset, sortBy: { column: 'name', order: 'asc' }, ...(search ? { search } : {}) },
});
const infoRaw = (actor, bucket, path) => (needsRaw(path)
  ? httpRaw(actor, 'GET', `/storage/v1/object/info/authenticated/${bucket}/${encPath(path)}`)
  : http(actor, 'GET', `/storage/v1/object/info/authenticated/${bucket}/${encPath(path)}`));

// ---------------------------------------------------------------------
// 저장 정보 읽기 (서비스 열쇠의 목록 조회 + 정보 조회. 본문을 내려받지 않는다)
// ---------------------------------------------------------------------
const normEtag = (v) => (v == null ? null : String(v).trim().replace(/^W\//, '').replace(/^"+|"+$/g, '').toLowerCase());
const MD5_RE = /^[0-9a-f]{32}$/;
const notDynamic = (cf) => (cf === 'DYNAMIC' ? null : `cf-cache-status 가 DYNAMIC 이 아님(${cf ?? '머리글 없음'})`);

// 저장 정보를 읽는 함수는 이것 하나다.
//   있음 = 정확한 경로가 목록에 있고, 정보 조회도 200 이고, 둘의 eTag·크기·형식이 같고, eTag 가 md5 모양임
//   없음 = 정확한 경로가 목록에 없고(목록을 끝까지 읽었고), 정보 조회도 관측된 "객체 없음" 모양(400·404·NoSuchKey)임
//   그 밖(DYNAMIC 이 아님, 시간 초과·서버 오류, 일반 404 나 다른 문구, 목록이 잘림, eTag 모양이 다름, 둘이 어긋남)은 "미확인"
//   object_id·created_at·updated_at 은 목록 조회가 준 값이다(객체가 같은 것인지 — 식별자 — 를 견주는 데 쓴다).
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
      list.object_id = String(it.id);
      list.etag = normEtag(it.metadata?.eTag);
      list.size = it.metadata?.size ?? null;
      list.mimetype = it.metadata?.mimetype != null ? String(it.metadata.mimetype).toLowerCase() : null;
      list.created_at = it.created_at ?? null;
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
    info.object_id = ir.json.id != null ? String(ir.json.id) : null;
    info.etag = normEtag(ir.json.etag ?? ir.json.eTag ?? ir.json.metadata?.eTag);
    info.size = ir.json.size ?? ir.json.metadata?.size ?? null;
    const ct = ir.json.content_type ?? ir.json.contentType ?? ir.json.metadata?.mimetype ?? null;
    info.content_type = ct != null ? String(ct).toLowerCase() : null;
    if (notDynamic(ir.cf)) doubts.push('정보 조회: ' + notDynamic(ir.cf));
  } else if (ii.kind === 'no_such_key') {
    info.present = false;
    if (notDynamic(ir.cf)) doubts.push('정보 조회: ' + notDynamic(ir.cf));
  } else {
    doubts.push(`정보 조회가 끝나지 않았거나 관측된 "객체 없음" 모양이 아닌 응답(${ir.status} ${ii.body_statusCode ?? '-'} ${ii.body_code ?? '-'} ${ii.kind})`);
  }

  let core = null;
  if (!doubts.length) {
    if (list.present === true && info.present === true) {
      if (!list.etag || !MD5_RE.test(list.etag)) doubts.push(`목록의 eTag 가 없거나 md5 모양이 아님(${list.etag ?? '없음'})`);
      else if (list.etag !== info.etag) doubts.push(`목록의 eTag(${list.etag})와 정보 조회의 eTag(${info.etag})가 어긋남`);
      else if (list.size == null || Number(list.size) !== Number(info.size)) doubts.push(`목록의 크기(${list.size})와 정보 조회의 크기(${info.size})가 어긋남`);
      else if (list.mimetype && info.content_type && list.mimetype !== info.content_type) doubts.push(`목록의 형식(${list.mimetype})과 정보 조회의 형식(${info.content_type})이 어긋남`);
      else if (info.object_id && info.object_id !== list.object_id) doubts.push(`목록의 식별자(${list.object_id})와 정보 조회의 식별자(${info.object_id})가 어긋남`);
      else core = { exists: true, md5: list.etag, size: Number(list.size), content_type: list.mimetype ?? info.content_type, object_id: list.object_id, created_at: list.created_at, updated_at: list.updated_at };
    } else if (list.present === false && info.present === false) {
      core = { exists: false };
    } else {
      doubts.push(`목록(${list.present ? '있음' : '없음'})과 정보 조회(${info.present ? '있음' : '없음'})가 어긋남`);
    }
  }
  return { known: !!core, ...(core ?? {}), unverified: core ? null : doubts.join(' / '), basis: '저장 정보(서비스 열쇠의 목록 조회 + 정보 조회)', list, info };
}
// 기대한 저장 정보와 정확히 같은가. 읽기가 "미확인"이면 같다고 하지 않는다.
function stateIs(st, want) {
  if (!st || !st.known) return false;
  if (!want.exists) return st.exists === false;
  return st.exists === true && st.md5 === want.md5 && st.size === want.size && st.content_type === want.content_type;
}
const present = (bytes) => ({ exists: true, ...describe(bytes) });
const ABSENT = { exists: false };
// 같은 객체가 그대로인가: 저장 정보(md5·크기·형식)에 더해 식별자와 만든 시각·고친 시각까지 같아야 한다
const sameObject = (a, b) => !!a?.known && !!b?.known && a.exists === true && b.exists === true
  && a.md5 === b.md5 && a.size === b.size && a.content_type === b.content_type
  && a.object_id === b.object_id && a.created_at === b.created_at && a.updated_at === b.updated_at;
const doubtOf = (st) => (st?.known ? null : st?.unverified ?? '읽지 못함');

// 정보 조회(재려는 자격). 원 응답을 그대로 적는다.
async function infoAs(actor, bucket, path) {
  const r = await infoRaw(actor, bucket, path);
  const ri = responseInfo(r);
  const out = { who: actor, http_status: r.status, ok: r.ok, cf_cache_status: r.cf, etag: null, size: null, error: r.ok ? null : ri };
  if (r.ok && r.json && typeof r.json === 'object') {
    out.etag = normEtag(r.json.etag ?? r.json.eTag ?? r.json.metadata?.eTag);
    out.size = r.json.size ?? r.json.metadata?.size ?? null;
  }
  return out;
}
// 정보 조회의 허용·거절.  허용 = 200 이고 eTag·크기가 저장 정보와 같음 / 거절 = 관측된 "객체 없음" 모양이고 같은 순간 파일은 정상으로 있음
// 이 결과는 "그 자격으로 그 파일의 정보를 볼 수 있는가"까지만 뜻한다.
function infoVerdict(rd, trueState) {
  if (!trueState?.known) return `undetermined(저장 정보 미확인: ${trueState?.unverified ?? ''})`;
  if (!trueState.exists) return 'undetermined(그 순간 파일이 없음 — "객체 없음"을 거절로 세지 않는다)';
  if (notDynamic(rd.cf_cache_status)) return `undetermined(정보 조회 응답: ${notDynamic(rd.cf_cache_status)})`;
  if (rd.ok) {
    if (rd.etag === trueState.md5 && Number(rd.size) === trueState.size) return 'allow';
    return `undetermined(정보 조회는 200 인데 eTag·크기가 저장 정보와 다름: ${rd.etag}/${rd.size})`;
  }
  if (rd.error.kind === 'no_such_key') return 'deny';
  return `undetermined(정보 조회가 끝나지 않았거나 관측된 "객체 없음" 모양이 아닌 응답: ${rd.http_status} ${rd.error.body_statusCode ?? '-'} ${rd.error.body_code ?? '-'})`;
}

// 새로 생긴 객체의 본문 대조: 서비스 열쇠가 그 객체를 "처음" 읽는 값 없는 인증 주소 한 번.
// 올린 사람의 읽기를 쓰지 않는다(올린 사람은 읽기 규칙이 없어 못 읽는 것이 정상이다).
async function firstBodyByService(bucket, path, bytes) {
  const tail = `/storage/v1/object/authenticated/${bucket}/${encPath(path)}`;
  const r = needsRaw(path) ? await httpRaw('service', 'GET', tail) : await http('service', 'GET', tail);
  const ri = responseInfo(r);
  const got = r.ok ? md5(r.buf) : null;
  return {
    request: '본문 GET(서비스 열쇠, 값 없는 인증 주소, 이 객체의 첫 읽기)',
    http_status: r.status, cf_cache_status: r.cf, age: r.age,
    body_md5: got, body_size: r.ok ? r.buf.length : null,
    match: r.ok ? got === md5(bytes) && r.buf.length === bytes.length : null, // null = 본문을 받지 못함(미확인)
    error: r.ok ? null : ri,
  };
}
// 공개 주소의 본문 GET(자격 없음, 값 없는 주소)
async function publicBody(bucket, path, bytes) {
  const r = await http(null, 'GET', `/storage/v1/object/public/${bucket}/${encPath(path)}`);
  const ri = responseInfo(r);
  const got = r.ok ? md5(r.buf) : null;
  return { request: '본문 GET(공개 주소, 자격 없음, 값 없는 주소)', http_status: r.status, cf_cache_status: r.cf, age: r.age, body_md5: got, match: r.ok ? got === md5(bytes) : null, error: r.ok ? null : ri };
}

// ---------------------------------------------------------------------
// 버킷 전체의 저장 정보 한 벌(서비스 열쇠의 목록 조회만. 폴더를 따라 내려가고, 1000개를 넘으면 쪽을 넘긴다)
//   "대상 밖 객체의 변화 0"과 "꾸민 경로가 실제로 어디에 도착했는가"를 이것의 전후 비교로 본다.
//   응답이 하나라도 DYNAMIC 이 아니거나 실패하면 ok: false 이고, 그 비교는 "미확인"이다.
// ---------------------------------------------------------------------
async function snapshot(bucket) {
  const objects = new Map();
  const doubts = [];
  async function walk(prefix, depth) {
    if (depth > 8) {
      doubts.push(`폴더가 너무 깊다(${prefix})`);
      return;
    }
    for (let offset = 0; ; offset += LIST_LIMIT) {
      const r = await listRaw('service', bucket, prefix, null, offset);
      if (!r.ok || !Array.isArray(r.json)) {
        doubts.push(`목록 조회 실패(${bucket}/${prefix}): ${r.status} ${responseInfo(r).kind}`);
        return;
      }
      if (notDynamic(r.cf)) doubts.push(`목록(${bucket}/${prefix}): ${notDynamic(r.cf)}`);
      for (const it of r.json) {
        const full = prefix ? `${prefix}/${it.name}` : String(it.name);
        if (it.id) {
          objects.set(full, { id: String(it.id), etag: normEtag(it.metadata?.eTag), size: it.metadata?.size ?? null, mimetype: it.metadata?.mimetype ?? null, created_at: it.created_at ?? null, updated_at: it.updated_at ?? null });
        } else {
          await walk(full, depth + 1);
        }
      }
      if (r.json.length < LIST_LIMIT) return;
      if (offset > 50 * LIST_LIMIT) {
        doubts.push(`목록이 너무 길다(${bucket}/${prefix})`);
        return;
      }
    }
  }
  await walk('', 0);
  return { bucket, ok: doubts.length === 0, doubts, objects };
}
function diffSnapshots(a, b) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [name, m] of b.objects) {
    const p = a.objects.get(name);
    if (!p) added.push(name);
    else if (p.id !== m.id || p.etag !== m.etag || p.size !== m.size || p.updated_at !== m.updated_at) changed.push(name);
  }
  for (const name of a.objects.keys()) if (!b.objects.has(name)) removed.push(name);
  return { ok: a.ok && b.ok, doubts: [...a.doubts, ...b.doubts], added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
async function snapshotAll() {
  const out = {};
  for (const b of BUCKETS) out[b] = await snapshot(b);
  return out;
}

// ---------------------------------------------------------------------
// 규칙의 모형 — 기대값은 여기서 나온다
//   옛 규칙(사실 자료의 26개 중 네 업무 버킷에 걸리는 것)과 새 규칙 4개(마이그레이션과 같은 조건)를 옮겨 적었다.
//   op: a 올리기(INSERT) · r 읽기(SELECT) · w 수정(UPDATE) · d 삭제(DELETE)
// ---------------------------------------------------------------------
function ctxOf(actor, subjectDead = false) {
  if (actor === 'service') return { role: 'service' };
  if (actor === 'anon') return { role: 'anon' };
  const member = { member_a: memberA, member_b: memberB, admin_gm_pre: memberGM, admin_gm_post: memberGM, subject: subjectDead ? null : memberA }[actor] ?? null;
  return { role: 'authenticated', member, admin: actor === 'admin_g_post' || actor === 'admin_gm_post' };
}
function can(st, c, op, bucket, name) {
  if (c.role === 'service') return true;                         // 서비스 열쇠는 규칙을 거치지 않는다
  if (bucket === GUIDE && op === 'a') return true;               // "allow upload iqdobt_0": 모든 역할의 올리기(남는 허용)
  const old10 = st !== 'rehearsal';                              // 옛 비로그인 규칙 10개가 있는가
  const fresh = st === 'applied' || st === 'rehearsal';          // 새 규칙 4개가 있는가
  if (c.role === 'anon') {
    if (!old10) return false;
    return ({ [MATERIALS]: 'ar', [GUIDE]: 'r', [BOARD]: 'awrd', [SCORE]: 'dra' }[bucket] ?? '').includes(op);
  }
  if (!fresh || op !== 'a') return false;                        // 로그인 역할의 새 규칙은 올리기뿐이다
  const seg = name.split('/');
  if (bucket === SCORE) {
    if (c.member != null && seg.length === 3 && seg[0] === 'exam-reg' && seg[1] === c.member && seg[2] !== '') return true;
    if (c.admin && seg.length === 2 && seg[0].length === 36 && UUID_RE.test(seg[0]) && seg[1] !== '') return true;
  }
  if (bucket === BOARD) {
    if (c.member != null && seg.length === 2 && STUDENT_KEYS.includes(seg[0]) && seg[1] !== '') return true;
    if (c.admin && seg.length === 2 && ADMIN_KEYS.includes(seg[0]) && seg[1] !== '') return true;
  }
  return false;
}
// 동작이 요구하는 규칙(2a 실측: x-upsert: true 는 읽기까지, 덮어쓰기는 수정까지 / 삭제·이동·복사의 요구는 로그인 역할에는
// 읽기 규칙이 없어 어느 쪽이든 거절이다 — 비로그인 쪽 모형은 실측되지 않은 어림이다)
const M = {
  uploadNew: (st, c, bucket, name, upsert) => can(st, c, 'a', bucket, name) && (!upsert || can(st, c, 'r', bucket, name)),
  overwrite: (st, c, bucket, name) => can(st, c, 'a', bucket, name) && can(st, c, 'r', bucket, name) && can(st, c, 'w', bucket, name),
  read: (st, c, bucket, name) => can(st, c, 'r', bucket, name),
  remove: (st, c, bucket, name) => can(st, c, 'r', bucket, name) && can(st, c, 'd', bucket, name),
  move: (st, c, bucket, from) => can(st, c, 'r', bucket, from) && can(st, c, 'w', bucket, from),
  copy: (st, c, bucket, from, to) => can(st, c, 'r', bucket, from) && can(st, c, 'a', bucket, to),
};
const verdictWord = (b) => (b ? 'allow' : 'deny');
// 그 자격·상태의 칸에 기대값이 있는가(비로그인은 예행 상태에서만)
const hasExpectation = (actor) => actor !== 'anon' || state === 'rehearsal';

// ---------------------------------------------------------------------
// 대조표의 줄
// ---------------------------------------------------------------------
let runTs = Date.now(); // 합성 파일 이름의 "시각" 자리(실행마다 다르다)
const fileFor = (tag, suffix = '.png') => `${runTs}_${MARK}_${tag}${suffix}`;
const tagRe = (tag) => new RegExp(`${MARK}_${tag}(?![a-z0-9])`);
const join = (dir, file) => (dir ? `${dir}/${file}` : file);
const MODES = [
  { id: 'upsert', upsert: true, label: 'x-upsert: true(지금 화면의 방식)' },
  { id: 'plain', upsert: false, label: '옵션 없음(계약 3 후보)' },
];
// 소유자로 기록될 값(식별값): 비로그인·서비스 열쇠가 올린 객체는 소유자가 비어 있고(2a 관측), 로그인 자격이 올린 객체는 그 계정 번호일 것으로 본다
const ownerOf = (actor) => (actor === 'anon' || actor === 'service' ? null : jwtInfo[actor]?.sub ?? undefined);
const who = (actor) => ({ anon: '비로그인', member_a: '회원 A', member_b: '회원 B', no_map: '대응 없는 계정', admin_g_pre: '관리자 G 6자리 전', admin_g_post: '관리자 G 6자리 후', admin_gm_pre: '관리자 GM 6자리 전', admin_gm_post: '관리자 GM 6자리 후', service: '서비스 열쇠', subject: '만료·로그아웃 시험의 A' }[actor] ?? actor);

// 새 이름 올리기의 경로 모양.
//   normal    기대값을 모형으로 엄격하게 대조한다(허용이면 적은 이름 그대로 저장돼야 한다)
//   contrived 꾸민 경로. 기대값을 "전부 거절"로 두지 않고 결과를 넷으로 나눈다(① 입력 오류 ② 권한 거절 ③ 허용된 경로로 저장 ④ 권한 밖 위치에 저장).
//             raw = 주소에 적어 보내는 글자 그대로, literal = 그 글자를 한 번 풀었을 때의 이름(정리하지 않는 저장소가 보게 될 이름)
function uploadShapes() {
  const A = memberA;
  const B = memberB;
  const GM = memberGM;
  const AU = A.toUpperCase();
  const UPPER_UUID = 'ABCDEF01-2345-4678-9ABC-DEF012345678';   // 대문자 uuid 모양(어느 회원의 번호도 아니다)
  const NO_MEMBER = '00000000-0000-4000-8000-00000000b2b2';    // uuid 모양이지만 그런 회원이 없는 번호
  const e = encodeURIComponent;
  const normal = (id, bucket, dir, label, extra = {}) => ({ id, bucket, kind: 'normal', label, dir, make: (tag) => ({ name: join(dir, fileFor(tag)) }), ...extra });
  const con = (id, bucket, label, mk, extra = {}) => ({ id, bucket, kind: 'contrived', label, make: mk, ...extra });
  const same = (s) => ({ raw: s, literal: s });
  const shapes = [
    // ---- toefl-score-images ----
    normal('score-self-a', SCORE, `exam-reg/${A}`, 'exam-reg/<A>/<파일> — A 본인의 경로'),
    normal('score-self-b', SCORE, `exam-reg/${B}`, 'exam-reg/<B>/<파일> — B 의 번호(A 에게는 남의 번호)'),
    normal('score-self-gm', SCORE, `exam-reg/${GM}`, 'exam-reg/<GM 의 회원번호>/<파일> — 관리자 GM 이 회원으로서 쓰는 자기 경로'),
    normal('score-admin-a', SCORE, A, '<A>/<파일> — 관리자 경로'),
    normal('score-admin-upper', SCORE, UPPER_UUID, '<대문자 uuid>/<파일> — 관리자 경로의 uuid 는 대문자도 허용이 기대값'),
    normal('score-admin-nomember', SCORE, NO_MEMBER, '<없는 회원번호>/<파일> — 관리자 경로는 모양만 본다(남은 허용: 없는 회원번호 폴더)', { remaining: true }),
    con('score-c-upper-prefix', SCORE, '꾸밈: 대문자 EXAM-REG/<A>/<파일>', (t) => same(`EXAM-REG/${A}/${fileFor(t)}`)),
    con('score-c-extra-folder', SCORE, '꾸밈: exam-reg/<A>/sub/<파일> — 폴더가 더 있음', (t) => same(`exam-reg/${A}/sub/${fileFor(t)}`)),
    con('score-c-member-case', SCORE, '꾸밈: exam-reg/<A 의 대소문자를 바꾼 번호>/<파일> — 글자 그대로 비교하므로 거절이 기대값', (t) => same(`exam-reg/${AU}/${fileFor(t)}`),
      { must: { member_a: 'not_stored' }, skip: AU === A ? 'A 의 회원번호에 영문자가 없어 대소문자를 바꿀 수 없다' : null }),
    con('score-c-empty-seg', SCORE, '꾸밈: exam-reg//<파일> — 빈 구간', (t) => same(`exam-reg//${fileFor(t)}`)),
    con('score-c-empty-seg2', SCORE, '꾸밈: exam-reg/<A>//<파일> — 빈 구간', (t) => same(`exam-reg/${A}//${fileFor(t)}`)),
    con('score-c-empty-file', SCORE, '꾸밈: exam-reg/<A>/ — 파일 이름이 빔', () => same(`exam-reg/${A}/`), { noTag: true }),
    con('score-c-dotdot', SCORE, '꾸밈: exam-reg/<B>/../<A>/<파일> — ".." 로 A 의 폴더를 가리킴', (t) => same(`exam-reg/${B}/../${A}/${fileFor(t)}`)),
    con('score-c-enc-slash', SCORE, '꾸밈: exam-reg%2F<A>%2F<파일> — 인코딩한 빗금', (t) => ({ raw: `exam-reg%2F${A}%2F${fileFor(t)}`, literal: `exam-reg/${A}/${fileFor(t)}` })),
    con('score-c-enc-twice', SCORE, '꾸밈: exam-reg%252F<A>%252F<파일> — 두 번 인코딩한 빗금', (t) => ({ raw: `exam-reg%252F${A}%252F${fileFor(t)}`, literal: `exam-reg%2F${A}%2F${fileFor(t)}` })),
    con('score-c-root-file', SCORE, '꾸밈: <파일> — 폴더 없이 버킷 바로 아래', (t) => same(fileFor(t))),
    con('score-c-admin-notuuid', SCORE, '꾸밈: <A 뒤에 글자 하나 더>/<파일> — uuid 모양이 끝까지 맞지 않음', (t) => same(`${A}x/${fileFor(t)}`)),
    con('score-c-admin-nothex', SCORE, '꾸밈: <16진수가 아닌 글자가 든 번호>/<파일>', (t) => same(`g${A.slice(1)}/${fileFor(t)}`)),
    con('score-c-admin-extra', SCORE, '꾸밈: <A>/sub/<파일> — 관리자 경로에 폴더가 더 있음', (t) => same(`${A}/sub/${fileFor(t)}`)),
    // ---- board-files ----
    ...STUDENT_KEYS.map((k) => normal(`board-${k}`, BOARD, k, `${k}/<파일> — 학생 게시판 키`)),
    ...ADMIN_KEYS.map((k) => normal(`board-${k}`, BOARD, k, `${k}/<파일> — 관리자 게시판 키`)),
    normal('board-noext', BOARD, 'reviews', 'reviews/<확장자 없는 파일> — 확장자는 막지 않는다', { make: (tag) => ({ name: `reviews/${fileFor(tag, '')}` }) }),
    con('board-c-korean', BOARD, '꾸밈: reviews/<한글·공백이 든 파일 이름> — 규칙은 한글을 막지 않는다(저장소가 이름을 받는지는 잰다)', (t) => {
      const f = `${runTs}_${MARK}_${t}_한글 이름.png`;
      return { raw: `reviews/${e(f)}`, literal: `reviews/${f}` };
    }),
    con('board-c-table-study', BOARD, '꾸밈: study_certifications/<파일> — 표 이름', (t) => same(`study_certifications/${fileFor(t)}`)),
    con('board-c-table-notices', BOARD, '꾸밈: notices/<파일> — 표 이름', (t) => same(`notices/${fileFor(t)}`)),
    con('board-c-table-appnotices', BOARD, '꾸밈: application_notices/<파일> — 표 이름', (t) => same(`application_notices/${fileFor(t)}`)),
    con('board-c-other-key', BOARD, '꾸밈: free/<파일> — 허용 밖의 키', (t) => same(`free/${fileFor(t)}`)),
    con('board-c-extra-seg', BOARD, '꾸밈: reviews/sub/<파일> — 구간이 하나 더', (t) => same(`reviews/sub/${fileFor(t)}`)),
    con('board-c-empty-seg', BOARD, '꾸밈: reviews//<파일> — 빈 구간', (t) => same(`reviews//${fileFor(t)}`)),
    con('board-c-upper', BOARD, '꾸밈: REVIEWS/<파일> — 대문자 키', (t) => same(`REVIEWS/${fileFor(t)}`)),
    con('board-c-dotdot', BOARD, '꾸밈: reviews/../notice/<파일> — ".." 로 관리자 게시판을 가리킴', (t) => same(`reviews/../notice/${fileFor(t)}`)),
    con('board-c-enc-slash', BOARD, '꾸밈: reviews%2F<파일> — 인코딩한 빗금', (t) => ({ raw: `reviews%2F${fileFor(t)}`, literal: `reviews/${fileFor(t)}` })),
    con('board-c-empty-file', BOARD, '꾸밈: reviews/ — 파일 이름이 빔', () => same('reviews/'), { noTag: true }),
    con('board-c-root-file', BOARD, '꾸밈: <파일> — 폴더 없이 버킷 바로 아래', (t) => same(fileFor(t))),
    // ---- guide-images · materials (새 규칙 없음) ----
    normal('guide-root', GUIDE, '', '<파일> — 안내서 편집의 경로 모양(남은 허용: 모든 역할 올리기 규칙)', { remaining: true }),
    normal('guide-book', GUIDE, 'book', 'book/<파일> — 입문서 편집의 경로 모양(남은 허용: 모든 역할 올리기 규칙)', { remaining: true }),
    normal('materials-root', MATERIALS, '', '<파일> — 합성 진단 요청(이 버킷에 올리는 화면 호출은 확인되지 않았다)'),
  ];
  return shapes;
}
function rowsUploadNew() {
  const rows = [];
  for (const shape of uploadShapes()) for (const mode of MODES) rows.push({ id: `new|${shape.id}|${mode.id}`, group: 'upload-new', bucket: shape.bucket, shape, mode, label: `${shape.bucket} · ${shape.label} · ${mode.label}` });
  rows.forEach((r, i) => { r.no = i + 1; });
  return rows;
}
// 있는 이름에 다시 올리기: 경로 × 먼저 만든 쪽 × 요청 방식
function existingPlaces() {
  return [
    { id: 'score-self', bucket: SCORE, dir: `exam-reg/${memberA}`, label: 'exam-reg/<A>/<파일>', creators: ['anon', 'service', 'member_a'] },
    { id: 'score-other', bucket: SCORE, dir: `exam-reg/${memberB}`, label: 'exam-reg/<B>/<파일>', creators: ['member_b'] },
    { id: 'score-admin', bucket: SCORE, dir: memberA, label: '<A>/<파일>(관리자 경로)', creators: ['anon', 'service', 'admin_g_post'] },
    { id: 'board-reviews', bucket: BOARD, dir: 'reviews', label: 'reviews/<파일>', creators: ['anon', 'service', 'member_a', 'member_b'] },
    { id: 'board-notice', bucket: BOARD, dir: 'notice', label: 'notice/<파일>', creators: ['anon', 'service', 'admin_g_post'] },
    { id: 'guide-root', bucket: GUIDE, dir: '', label: '<파일>', creators: ['anon', 'service', 'member_a'] },
    { id: 'materials-root', bucket: MATERIALS, dir: '', label: '<파일>', creators: ['anon', 'service'] },
  ];
}
function rowsUploadExisting() {
  const rows = [];
  for (const place of existingPlaces()) for (const creator of place.creators) for (const mode of MODES) {
    rows.push({ id: `existing|${place.id}|by-${creator}|${mode.id}`, group: 'upload-existing', bucket: place.bucket, place, creator, mode, label: `${place.bucket} · ${place.label} · 먼저 만든 쪽 ${who(creator)} · ${mode.label}` });
  }
  rows.forEach((r, i) => { r.no = i + 1; });
  return rows;
}
const ACTIONS = ['info', 'list', 'delete', 'move', 'copy'];
const ACTION_KO = { info: '정보 조회', list: '목록 조회', delete: '삭제', move: '이동', copy: '복사', public: '공개 주소의 본문 GET' };
function rowsActions() {
  const places = [
    { id: 'score-self', bucket: SCORE, dir: `exam-reg/${memberA}`, label: 'exam-reg/<A>/<파일>', creators: ['service', 'member_a'] },
    { id: 'score-admin', bucket: SCORE, dir: memberA, label: '<A>/<파일>(관리자 경로)', creators: ['service'] },
    { id: 'board-reviews', bucket: BOARD, dir: 'reviews', label: 'reviews/<파일>', creators: ['service', 'member_a'] },
    { id: 'board-notice', bucket: BOARD, dir: 'notice', label: 'notice/<파일>', creators: ['service'] },
    { id: 'guide-root', bucket: GUIDE, dir: '', label: '<파일>', creators: ['service', 'member_a'] },
    { id: 'materials-root', bucket: MATERIALS, dir: '', label: '<파일>', creators: ['service'] },
  ];
  const rows = [];
  for (const place of places) for (const creator of place.creators) for (const action of ACTIONS) {
    rows.push({ id: `action|${place.id}|by-${creator}|${action}`, group: 'actions', bucket: place.bucket, place, creator, action, label: `${place.bucket} · ${place.label} · 먼저 만든 쪽 ${who(creator)} · ${ACTION_KO[action]}` });
  }
  for (const p of [{ bucket: SCORE, dir: `exam-reg/${memberA}` }, { bucket: BOARD, dir: 'reviews' }, { bucket: GUIDE, dir: '' }, { bucket: MATERIALS, dir: '' }]) {
    rows.push({ id: `action|public|${p.bucket}`, group: 'actions', bucket: p.bucket, place: { id: 'public', bucket: p.bucket, dir: p.dir, label: '공개 주소' }, creator: 'service', action: 'public', label: `${p.bucket} · 공개 주소의 본문 GET(남은 허용: 공개 버킷의 공개 주소는 규칙과 무관하게 열린다)` });
  }
  rows.forEach((r, i) => { r.no = i + 1; });
  return rows;
}
function rowsRevoked() {
  const rows = [
    { id: 'revoked|score-self|plain', bucket: SCORE, dir: `exam-reg/${memberA}`, label: `${SCORE} · exam-reg/<A>/<파일> · 옵션 없음 — 새로 주는 올리기(회원, 성적표 자기 경로)` },
    { id: 'revoked|board-reviews|plain', bucket: BOARD, dir: 'reviews', label: `${BOARD} · reviews/<파일> · 옵션 없음 — 새로 주는 올리기(회원, 학생 게시판)` },
    { id: 'revoked|guide-root|plain', bucket: GUIDE, dir: '', remaining: true, label: `${GUIDE} · <파일> · 옵션 없음 — 남은 허용(모든 역할 올리기 규칙: 로그인 상태가 끝나도 자격 자체가 유효하면 열려 있을 것으로 본다)` },
  ];
  rows.forEach((r, i) => { r.no = i + 1; });
  return rows;
}
function selectRows(rows) {
  return rows.filter((r) => (!onlyBucket || r.bucket === onlyBucket) && (!rowRange || (r.no >= rowRange[0] && r.no <= rowRange[1])));
}

// ---------------------------------------------------------------------
// 공통: 셈, 자격의 남은 시간, 대상 밖 객체의 변화
// ---------------------------------------------------------------------
function tally(cells) {
  const t = { cells: cells.length, with_expectation: 0, pass: 0, mismatch: 0, undetermined: 0, measured_only: 0, not_applicable: 0 };
  const byActor = {};
  for (const c of cells) {
    const a = (byActor[c.actor] ??= { pass: 0, mismatch: 0, undetermined: 0, measured_only: 0, not_applicable: 0 });
    let k;
    if (c.not_applicable) k = 'not_applicable';
    else if (c.expect == null) k = 'measured_only';
    else if (c.pass === true) k = 'pass';
    else if (c.pass === false) k = 'mismatch';
    else k = 'undetermined';
    t[k] += 1;
    a[k] += 1;
    if (k === 'pass' || k === 'mismatch' || k === 'undetermined') t.with_expectation += 1;
  }
  return { ...t, by_actor: byActor };
}
const tallyLine = (t) => `통과 ${t.pass} · 기대와 다름 ${t.mismatch} · 미확인 ${t.undetermined} · 잰 값(기대값 없음) ${t.measured_only}${t.not_applicable ? ' · 해당 없음 ' + t.not_applicable : ''}`;
function expiringSoon(list) {
  const now = Math.floor(Date.now() / 1000);
  for (const a of list) if (jwtInfo[a] && jwtInfo[a].exp - now < 90) return a;
  return null;
}
// 단계 전후의 버킷 네 개 전체를 견줘, 이 단계가 만든다고 알고 있는 이름(known) 밖의 변화를 찾는다
function outsideChange(before, after, known) {
  const out = { ok: true, doubts: [], unaccounted_new: [], removed: [], changed: [] };
  for (const b of BUCKETS) {
    const d = diffSnapshots(before[b], after[b]);
    if (!d.ok) {
      out.ok = false;
      out.doubts.push(...d.doubts);
    }
    for (const n of d.added) if (!known.has(`${b}/${n}`)) out.unaccounted_new.push(`${b}/${n}`);
    for (const n of d.removed) if (!known.has(`${b}/${n}`)) out.removed.push(`${b}/${n}`);
    for (const n of d.changed) if (!known.has(`${b}/${n}`)) out.changed.push(`${b}/${n}`);
  }
  out.zero = out.ok && !out.unaccounted_new.length && !out.removed.length && !out.changed.length;
  return out;
}
async function removeMany(bucket, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const r = await http('service', 'DELETE', `/storage/v1/object/${bucket}`, { json: { prefixes: paths.slice(i, i + 100) } });
    if (!r.ok) throw new Error(`지우기 실패(${bucket}): ${r.status} ${r.netError ?? r.buf.toString('utf8').slice(0, 200)}`);
  }
}
const ledgerEntry = (bucket, name, st, expectOwner, why) => ({ bucket, name, object_id: st?.object_id ?? null, md5: st?.md5 ?? null, size: st?.size ?? null, expect_owner: expectOwner, why });

// ---------------------------------------------------------------------
// upload-new: 새 이름 올리기 (경로 모양 × 요청 방식 × 자격)
//   한 줄의 칸들을 다 보낸 뒤 그 버킷 전체의 저장 정보를 줄 앞과 견줘, 칸마다 "실제로 어디에 무엇이 생겼는가"를 정한다
//   (파일 이름에 칸의 꼬리표가 들어 있다). 꼬리표를 둘 수 없는 모양(파일 이름이 빈 것)은 칸마다 전후를 뜬다.
// ---------------------------------------------------------------------
async function inspectArrived(bucket, names, bytes) {
  const out = [];
  for (const name of names) {
    const stored = await readTrue(bucket, name);
    const body = stateIs(stored, present(bytes)) ? await firstBodyByService(bucket, name, bytes) : null;
    out.push({ name, stored, stored_matches_upload: stateIs(stored, present(bytes)), body });
  }
  return out;
}
function judgeNormalUpload(row, cell, control, integrity) {
  const c = ctxOf(cell.actor);
  const says = verdictWord(M.uploadNew(state, c, row.bucket, cell.literal, row.mode.upsert));
  cell.model_says = says;
  cell.expect = hasExpectation(cell.actor) ? says : null;
  const ri = cell.response;
  let o;
  if (!integrity.ok) o = `undetermined(줄 전후의 목록 비교를 믿을 수 없음: ${integrity.why})`;
  else if (cell.request_ok) {
    if (cell.arrived.length !== 1) o = `anomaly(성공 응답인데 새 객체가 ${cell.arrived.length}개)`;
    else if (cell.arrived[0].name !== cell.literal) o = `anomaly(다른 이름에 저장됨: ${cell.arrived[0].name})`;
    else if (!cell.arrived[0].stored.known) o = `undetermined(저장 정보 미확인: ${cell.arrived[0].stored.unverified})`;
    else if (!cell.arrived[0].stored_matches_upload) o = 'anomaly(저장 정보가 올린 내용의 지문·크기·형식과 다름)';
    else if (cell.arrived[0].body.match === null) o = `undetermined(본문을 받지 못함: ${cell.arrived[0].body.http_status} ${cell.arrived[0].body.error?.kind})`;
    else if (cell.arrived[0].body.match === false) o = 'anomaly(본문의 md5 가 올린 내용과 다름)';
    else o = 'allow';
  } else if (cell.arrived.length) o = `anomaly(거절 응답인데 객체가 생김: ${cell.arrived.map((x) => x.name).join(', ')})`;
  else if (inconclusive(ri.kind)) o = `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`;
  else if (!cell.literal_state?.known) o = `undetermined(그 이름의 저장 정보 미확인: ${doubtOf(cell.literal_state)})`;
  else if (cell.literal_state.exists) o = 'anomaly(거절 응답인데 그 이름에 객체가 있음)';
  else if (!DENY_KINDS.upload.includes(ri.kind)) o = `undetermined(권한 오류의 관측된 모양이 아닌 거절: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.kind})`;
  else if (cell.actor !== 'service' && !(control && control.observed === 'allow')) o = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군이 성공하지 못함)';
  else o = 'deny';
  cell.observed = o;
  cell.pass = cell.expect == null ? null : o === cell.expect ? true : o.startsWith('undetermined') ? null : false;
  cell.cmp = { observed: o.replace(/\(.*$/s, ''), response: respSig(ri), stored: cell.arrived.length, as_sent: cell.arrived.length === 1 && cell.arrived[0].name === cell.literal };
}
const CLASS = {
  input: '① 입력 오류(저장소가 이름 자체를 받지 않음)',
  denied: '② 권한 거절(경로는 유효하지만 그 자격에 권한이 없음 — 저장 변화 없음)',
  allowed: '③ 허용된 경로로 저장됨',
  outside: '④ 권한 밖 위치에 실제로 저장됨(실패)',
  control: '저장됨(서비스 열쇠 — 대조군)',
};
function judgeContrivedUpload(row, cell, control, integrity) {
  const c = ctxOf(cell.actor);
  const ri = cell.response;
  cell.model_says_for_name_as_sent = verdictWord(M.uploadNew(state, c, row.bucket, cell.literal, row.mode.upsert));
  const must = row.shape.must?.[cell.actor] ?? null;
  cell.expect = hasExpectation(cell.actor) ? (cell.actor === 'service' ? '저장됨 또는 ①' : must === 'not_stored' ? '① 또는 ②(저장되지 않음)' : '①·②·③ 중 하나(④가 아님)') : null;
  let cls;
  let key;
  if (!integrity.ok) [key, cls] = ['unknown', `미확인(줄 전후의 목록 비교를 믿을 수 없음: ${integrity.why})`];
  else if (cell.request_ok) {
    const a = cell.arrived;
    if (a.length !== 1) [key, cls] = ['unknown', `미확인(성공 응답인데 새 객체가 ${a.length}개)`];
    else if (!a[0].stored.known) [key, cls] = ['unknown', `미확인(도착한 객체의 저장 정보 미확인: ${a[0].stored.unverified})`];
    else if (!a[0].stored_matches_upload) [key, cls] = ['bad', '이상(도착한 객체의 저장 정보가 올린 내용과 다름)'];
    else if (a[0].body.match === null) [key, cls] = ['unknown', `미확인(본문을 받지 못함: ${a[0].body.http_status})`];
    else if (a[0].body.match === false) [key, cls] = ['bad', '이상(본문의 md5 가 올린 내용과 다름)'];
    else if (cell.actor === 'service') [key, cls] = ['control', CLASS.control];
    else if (M.uploadNew(state, c, row.bucket, a[0].name, row.mode.upsert)) [key, cls] = ['allowed', CLASS.allowed];
    else [key, cls] = ['outside', CLASS.outside];
    cell.arrived_full_name = a.length === 1 ? a[0].name : null; // 저장소에 실제로 도착한 전체 이름
  } else if (cell.arrived.length) [key, cls] = ['bad', `이상(거절 응답인데 객체가 생김: ${cell.arrived.map((x) => x.name).join(', ')})`];
  else if (inconclusive(ri.kind)) [key, cls] = ['unknown', `미확인(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`];
  else if (cell.actor === 'service') {
    // 서비스 열쇠는 규칙을 거치지 않는다. 저장되지 않았다면 저장소가 그 이름 자체를 받지 않은 것이다.
    if (ri.kind === 'rls' || ri.kind === 'access_denied') [key, cls] = ['bad', '이상(서비스 열쇠인데 권한 오류)'];
    else [key, cls] = ['input', CLASS.input];
  } else if (control && control.class_key === 'input') {
    // 같은 입력을 서비스 열쇠도 저장하지 못했다 → 입력 오류. 이 자격에게 온 응답은 권한 오류일 수도 있다(그대로 적는다).
    [key, cls] = ['input', CLASS.input];
    cell.same_response_as_control = JSON.stringify(respSig(control.response)) === JSON.stringify(respSig(ri));
  } else if (ri.kind === 'rls') {
    if (control && control.class_key === 'control') [key, cls] = ['denied', CLASS.denied];
    else [key, cls] = ['unknown', '권한 미판정(같은 입력의 서비스 열쇠 대조군이 저장도 입력 오류도 아님)'];
  } else [key, cls] = ['unknown', `미확인(서비스 열쇠로는 저장되는 이름인데 권한 오류의 관측된 모양이 아닌 거절: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.body_code ?? ''} ${ri.kind})`];
  cell.class_key = key;
  cell.observed = cls;
  if (cell.expect == null) cell.pass = null;
  else if (key === 'unknown') cell.pass = null;
  else if (key === 'bad' || key === 'outside') cell.pass = false;
  else if (must === 'not_stored') cell.pass = key === 'input' || key === 'denied';
  else cell.pass = true;
  cell.cmp = { observed: key, response: respSig(ri), stored: cell.arrived.length, arrived_shape: (cell.arrived[0]?.name ?? '').replace(new RegExp(`\\d+_${MARK}_[a-z0-9]+`), '<파일>') };
}

async function phaseUploadNew(run) {
  const all = rowsUploadNew();
  const rows = selectRows(all).filter((r) => !r.shape.skip);
  const skipped = selectRows(all).filter((r) => r.shape.skip).map((r) => ({ row: r.id, why: r.shape.skip }));
  const cells = [];
  const ledger = [];
  const known = new Set();
  const rowNotes = [];
  let stopped = null;
  const before = await snapshotAll();
  const snaps = { ...before };
  let done = 0;
  for (const row of rows) {
    const soon = expiringSoon(actors);
    if (soon) {
      stopped = `${who(soon)} 의 자격이 90초 안에 끝난다 — ${row.no}번 줄 앞에서 멈춤(--rows ${row.no}-${all.length} 로 이어서 잰다)`;
      break;
    }
    const rowCells = [];
    for (const actor of actors) {
      const tag = `u${row.no}${ACTOR_CODE[actor]}`;
      const bytes = makePng(`${run} ${row.id} ${actor}`);
      const target = row.shape.make(tag);
      const literal = row.shape.kind === 'normal' ? target.name : target.literal;
      const cell = { row: row.no, row_id: row.id, bucket: row.bucket, shape: row.shape.id, path_kind: row.shape.kind, request_mode: row.mode.id, actor, tag, sent_path: row.shape.kind === 'normal' ? target.name : target.raw, literal, uploaded: describe(bytes), arrived: [] };
      const pre = row.shape.noTag ? await snapshot(row.bucket) : null;
      const r = row.shape.kind === 'normal' ? await upload(actor, row.bucket, target.name, bytes, { upsert: row.mode.upsert }) : await uploadRaw(actor, row.bucket, target.raw, bytes, { upsert: row.mode.upsert });
      cell.response = responseInfo(r);
      cell.request_ok = r.ok;
      cell.response_key = r.ok && r.json && typeof r.json === 'object' ? { Key: r.json.Key ?? null, Id: r.json.Id ?? null } : null;
      cell._bytes = bytes;
      if (row.shape.noTag) {
        // 꼬리표가 없는 이름: 이 칸의 전후를 바로 뜨고, 생긴 것이 있으면 살핀 뒤 지워서 다음 칸이 같은 상태에서 시작하게 한다
        const post = await snapshot(row.bucket);
        const d = diffSnapshots(pre, post);
        cell.cell_diff = { ok: d.ok, doubts: d.doubts, added: d.added, removed: d.removed, changed: d.changed };
        cell.arrived = await inspectArrived(row.bucket, d.added, bytes);
        if (d.added.length) {
          await removeMany(row.bucket, d.added);
          cell.removed_after_inspect = d.added;
        }
      }
      rowCells.push(cell);
    }
    // 줄 전후의 버킷 전체 비교
    const after = await snapshot(row.bucket);
    const d = diffSnapshots(snaps[row.bucket], after);
    snaps[row.bucket] = after;
    const claimed = new Set();
    for (const cell of rowCells) {
      if (row.shape.noTag) continue;
      const mine = d.added.filter((n) => tagRe(cell.tag).test(n));
      mine.forEach((n) => claimed.add(n));
      cell.arrived = await inspectArrived(row.bucket, mine, cell._bytes);
    }
    const unattributed = d.added.filter((n) => !claimed.has(n));
    const integrity = { ok: d.ok && !unattributed.length && !d.removed.length && !d.changed.length, why: null };
    if (!integrity.ok) integrity.why = [...d.doubts, unattributed.length ? `어느 칸의 것인지 알 수 없는 새 객체 ${unattributed.join(', ')}` : null, d.removed.length ? `없어진 객체 ${d.removed.join(', ')}` : null, d.changed.length ? `바뀐 객체 ${d.changed.join(', ')}` : null].filter(Boolean).join(' / ');
    if (row.shape.noTag) {
      const bad = rowCells.find((x) => !x.cell_diff.ok || x.cell_diff.removed.length || x.cell_diff.changed.length);
      if (bad) {
        integrity.ok = false;
        integrity.why = `칸 전후의 목록 비교를 믿을 수 없음(${bad.actor})`;
      }
    }
    rowNotes.push({ row: row.no, row_id: row.id, bucket_diff: { ok: d.ok, added: d.added.length, unattributed, removed: d.removed, changed: d.changed } });
    // 거절 응답이고 생긴 것이 없는 칸(normal): 적은 이름 그대로가 비어 있는지를 저장 정보로 따로 확인한다.
    // 꾸민 경로는 적은 이름을 그대로 가리킬 수 없는 경우가 있어, 줄 전후의 버킷 전체 비교로만 "저장 변화 없음"을 본다.
    for (const cell of rowCells) {
      if (row.shape.kind === 'normal' && !cell.request_ok && !cell.arrived.length) cell.literal_state = await readTrue(row.bucket, cell.literal);
    }
    const control = rowCells.find((x) => x.actor === 'service');
    const judge = row.shape.kind === 'normal' ? judgeNormalUpload : judgeContrivedUpload;
    judge(row, control, null, integrity);
    for (const cell of rowCells) if (cell !== control) judge(row, cell, control, integrity);
    for (const cell of rowCells) {
      delete cell._bytes;
      cell.remaining_allowance = !!row.shape.remaining;
      for (const a of cell.arrived) {
        if (cell.removed_after_inspect?.includes(a.name)) continue;
        known.add(`${row.bucket}/${a.name}`);
        ledger.push(ledgerEntry(row.bucket, a.name, a.stored, ownerOf(cell.actor), `${row.id} · ${cell.actor} 가 올림`));
      }
      cells.push(cell);
    }
    done += 1;
    say(`upload-new ${done}/${rows.length} (${row.no}번 줄) — ${row.label} — ${tallyLine(tally(rowCells))}`);
  }
  const after = await snapshotAll();
  return finishMeasure({ rows, cells, ledger, known, before, after, stopped, extra: { skipped_rows: skipped, row_notes: rowNotes } });
}

// ---------------------------------------------------------------------
// upload-existing: 있는 이름에 다시 올리기 (경로 × 먼저 만든 쪽 × 요청 방식 × 자격)
//   x-upsert: true  → 덮어쓰기 시도. 기대값 대조(허용 = 옛 지문 → 새 지문 / 거절 = 먼저 있던 객체가 식별자·저장 정보까지 그대로)
//   옵션 없음       → 서비스 대조군도 중복이 난다. 판정은 "권한 미판정 · 덮어쓰기 없음" 하나다:
//                     자격마다 실제 응답을 그대로 적고, 확인하는 것은 먼저 있던 객체가 그대로라는 것뿐이다.
// ---------------------------------------------------------------------
async function setupPair(bucket, creator, target, original, control, controlBytes) {
  const cu = await upload(creator, bucket, target, original, { upsert: false });
  const su = await upload('service', bucket, control, controlBytes, { upsert: false });
  const start = { target: await readTrue(bucket, target), control: await readTrue(bucket, control) };
  return {
    creator_upload: responseInfo(cu), control_upload: responseInfo(su), start,
    ok: cu.ok && su.ok && stateIs(start.target, present(original)) && stateIs(start.control, present(controlBytes)),
  };
}
const relationOf = (creator, actor) => (creator === actor ? '본인이 올린 것' : creator === 'anon' ? '비로그인이 올린 것' : creator === 'service' ? '서비스 열쇠가 올린 것' : '남이 올린 것');

async function phaseUploadExisting(run) {
  const all = rowsUploadExisting();
  const rows = selectRows(all);
  const cells = [];
  const ledger = [];
  const known = new Set();
  let stopped = null;
  const before = await snapshotAll();
  let done = 0;
  for (const row of rows) {
    const soon = expiringSoon([...actors, row.creator]);
    if (soon) {
      stopped = `${who(soon)} 의 자격이 90초 안에 끝난다 — ${row.no}번 줄 앞에서 멈춤(--rows ${row.no}-${all.length} 로 이어서 잰다)`;
      break;
    }
    const { bucket } = row;
    const rowCells = [];
    const feasible = M.uploadNew(state, ctxOf(row.creator), bucket, join(row.place.dir, 'x.png'), false);
    for (const actor of actors) {
      const tag = `e${row.no}${ACTOR_CODE[actor]}`;
      const target = join(row.place.dir, fileFor(`${tag}-t`));
      const control = join(row.place.dir, fileFor(`${tag}-c`));
      const cell = { row: row.no, row_id: row.id, bucket, place: row.place.id, created_by: row.creator, relation: relationOf(row.creator, actor), request_mode: row.mode.id, actor, path: target, control_path: control };
      if (!feasible) {
        cell.not_applicable = `이 상태(${state})에서는 ${who(row.creator)} 가 이 경로에 먼저 올릴 수 없다(모형)`;
        cell.expect = null;
        cell.pass = null;
        cell.cmp = { not_applicable: true };
        rowCells.push(cell);
        continue;
      }
      known.add(`${bucket}/${target}`);
      known.add(`${bucket}/${control}`);
      const original = makePng(`${run} ${row.id} ${actor} original`);
      const controlBytes = makePng(`${run} ${row.id} ${actor} control`);
      const fresh = makePng(`${run} ${row.id} ${actor} second upload`);
      const s = await setupPair(bucket, row.creator, target, original, control, controlBytes);
      cell.setup = { creator_upload: s.creator_upload, control_upload: s.control_upload, ok: s.ok };
      cell.start = s.start;
      cell.original = describe(original);
      cell.second_upload = describe(fresh);
      const r = s.ok ? await upload(actor, bucket, target, fresh, { upsert: row.mode.upsert }) : null;
      cell.response = r ? responseInfo(r) : null;
      cell.request_ok = r ? r.ok : null;
      const after = { target: await readTrue(bucket, target), control: await readTrue(bucket, control) };
      cell.after = after;
      const targetSame = sameObject(s.start.target, after.target);
      const controlSame = sameObject(s.start.control, after.control);
      cell.target_unchanged = targetSame;   // 식별자·저장 정보(지문·크기·형식)·만든 시각·고친 시각이 그대로
      cell.control_unchanged = controlSame;
      cell._overwritten = r && r.ok && stateIs(after.target, present(fresh)) && controlSame;
      if (cell._overwritten) cell.body = await firstBodyByService(bucket, target, fresh);
      rowCells.push(cell);
      if (after.target.known && after.target.exists) ledger.push(ledgerEntry(bucket, target, after.target, targetSame ? ownerOf(row.creator) : undefined, `${row.id} · ${actor} 칸의 대상(먼저 만든 쪽 ${row.creator})${targetSame ? '' : ' — 바뀜(소유자는 견주지 않는다)'}`));
      if (after.control.known && after.control.exists) ledger.push(ledgerEntry(bucket, control, after.control, null, `${row.id} · ${actor} 칸의 대조 객체(서비스 열쇠)`));
    }
    const control = rowCells.find((x) => x.actor === 'service');
    const judge = (cell) => {
      if (cell.not_applicable) return;
      const c = ctxOf(cell.actor);
      const ri = cell.response;
      if (row.mode.upsert) {
        cell.model_says = verdictWord(M.overwrite(state, c, bucket, cell.path));
        cell.expect = hasExpectation(cell.actor) ? cell.model_says : null;
      } else {
        // 옵션 없음: 판정은 하나 — "권한 미판정 · 덮어쓰기 없음"(모든 자격에 같다)
        cell.expect = 'no_overwrite';
        cell.verdict_label = '권한 미판정 · 덮어쓰기 없음';
      }
      let o;
      if (!cell.setup.ok) o = `undetermined(시작 상태를 만들지 못했거나 확인하지 못함: 먼저 만든 쪽의 올리기 ${cell.setup.creator_upload.http_status}, ${doubtOf(cell.start.target) ?? ''})`;
      else if (!cell.after.target.known || !cell.after.control.known) o = `undetermined(요청 뒤의 저장 정보 미확인: ${doubtOf(cell.after.target) ?? doubtOf(cell.after.control)})`;
      else if (row.mode.upsert) {
        if (cell._overwritten) o = cell.body.match === true ? 'allow' : cell.body.match === null ? `undetermined(본문을 받지 못함: ${cell.body.http_status})` : 'anomaly(본문의 md5 가 다시 올린 내용과 다름)';
        else if (!cell.request_ok && cell.target_unchanged && cell.control_unchanged) {
          if (inconclusive(ri.kind)) o = `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`;
          else if (!DENY_KINDS.overwrite.includes(ri.kind)) o = `undetermined(권한 오류의 관측된 모양이 아닌 거절: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.kind})`;
          else if (cell.actor !== 'service' && !(control && control.observed === 'allow')) o = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군이 성공하지 못함)';
          else o = 'deny';
        } else o = `anomaly(응답 ${ri.http_status}, 대상 ${cell.target_unchanged ? '그대로' : '바뀜'}, 대조 객체 ${cell.control_unchanged ? '그대로' : '바뀜'})`;
      } else {
        if (inconclusive(ri.kind)) o = `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`;
        else if (!cell.request_ok && cell.target_unchanged && cell.control_unchanged) o = 'no_overwrite';
        else if (cell.target_unchanged && cell.control_unchanged) o = 'anomaly(성공 응답인데 먼저 있던 객체가 그대로)';
        else o = `OVERWRITTEN(먼저 있던 객체가 바뀜 — 응답 ${ri.http_status})`;
      }
      cell.observed = o;
      cell.pass = cell.expect == null ? null : o === cell.expect ? true : o.startsWith('undetermined') ? null : false;
      cell.cmp = { observed: o.replace(/\(.*$/s, ''), response: respSig(ri), target_unchanged: cell.target_unchanged, control_unchanged: cell.control_unchanged };
      delete cell._overwritten;
    };
    if (control) judge(control);
    for (const cell of rowCells) if (cell !== control) judge(cell);
    cells.push(...rowCells);
    done += 1;
    say(`upload-existing ${done}/${rows.length} (${row.no}번 줄) — ${row.label} — ${tallyLine(tally(rowCells))}`);
  }
  const after = await snapshotAll();
  return finishMeasure({ rows, cells, ledger, known, before, after, stopped, extra: { note_plain: '옵션 없는 칸의 expect "no_overwrite" 는 "권한 미판정 · 덮어쓰기 없음"이다 — 권한이 있다/없다를 말하지 않는다. 자격마다의 실제 응답은 response 에 그대로 있다. 소유자가 그대로인지는 owners 단계가 fingerprint.sql 결과로 견준다.' } });
}

// ---------------------------------------------------------------------
// actions: 정보 조회·목록·삭제·이동·복사 + 공개 주소
// ---------------------------------------------------------------------
async function actionCell(run, row, actor) {
  const { bucket } = row;
  const tag = `a${row.no}${ACTOR_CODE[actor] ?? 'pb'}`;
  const base = fileFor(tag, '');
  const target = join(row.place.dir, `${base}-t.png`);
  const control = join(row.place.dir, `${base}-c.png`);
  const dest = join(row.place.dir, `${base}-d.png`);
  const cell = { row: row.no, row_id: row.id, bucket, place: row.place.id, created_by: row.creator, relation: relationOf(row.creator, actor), action: row.action, actor, path: target, control_path: control };
  const original = makePng(`${run} ${row.id} ${actor} original`);
  const controlBytes = makePng(`${run} ${row.id} ${actor} control`);
  const s = await setupPair(bucket, row.creator, target, original, control, controlBytes);
  cell.setup = { creator_upload: s.creator_upload, control_upload: s.control_upload, ok: s.ok };
  cell.start = s.start;
  cell._names = [target, control, dest];
  cell._original = original;
  if (!s.ok) return cell;
  const c = ctxOf(actor);
  let r = null;
  if (row.action === 'info') {
    cell.info_lookup = await infoAs(actor, bucket, target);
    cell.model_says = verdictWord(M.read(state, c, bucket, target));
  } else if (row.action === 'list') {
    r = await listRaw(actor, bucket, row.place.dir, `${base}-`);
    cell.list_cf = r.cf;
    cell.returned_names = r.ok && Array.isArray(r.json) ? r.json.filter((x) => x.id).map((x) => String(x.name)).sort() : null;
    cell.model_says = verdictWord(M.read(state, c, bucket, target));
  } else if (row.action === 'delete') {
    r = await removeOne(actor, bucket, target);
    cell.model_says = verdictWord(M.remove(state, c, bucket, target));
  } else if (row.action === 'move') {
    cell.dest_path = dest;
    cell.dest_start = await readTrue(bucket, dest);
    r = await move(actor, bucket, target, dest);
    cell.model_says = verdictWord(M.move(state, c, bucket, target));
  } else if (row.action === 'copy') {
    cell.dest_path = dest;
    cell.dest_start = await readTrue(bucket, dest);
    r = await copy(actor, bucket, target, dest);
    cell.model_says = verdictWord(M.copy(state, c, bucket, target, dest));
  }
  if (r) {
    cell.response = responseInfo(r);
    cell.request_ok = r.ok;
  }
  cell.after = { target: await readTrue(bucket, target), control: await readTrue(bucket, control) };
  if (cell.dest_path) cell.dest_after = await readTrue(bucket, dest);
  return cell;
}
function judgeAction(row, cell, control) {
  const ri = cell.response ?? null;
  cell.expect = hasExpectation(cell.actor) ? cell.model_says ?? null : null;
  const original = cell._original;
  let o;
  const st = cell.start;
  const af = cell.after;
  if (!cell.setup.ok) o = `undetermined(시작 상태를 만들지 못했거나 확인하지 못함: 먼저 만든 쪽의 올리기 ${cell.setup.creator_upload.http_status}, ${doubtOf(st.target) ?? ''})`;
  else if (!af.target.known || !af.control.known || (cell.dest_path && (!cell.dest_after.known || !cell.dest_start.known))) o = `undetermined(저장 정보 미확인: ${doubtOf(af.target) ?? doubtOf(af.control) ?? doubtOf(cell.dest_after) ?? doubtOf(cell.dest_start)})`;
  else {
    const tSame = sameObject(st.target, af.target);
    const cSame = sameObject(st.control, af.control);
    cell.target_unchanged = tSame;
    cell.control_unchanged = cSame;
    const destAbsent = cell.dest_path ? cell.dest_after.exists === false : null;
    const denyByResponse = (action) => (inconclusive(ri.kind) ? `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`
      : !DENY_KINDS[action].includes(ri.kind) ? `undetermined(권한 거절의 관측된 모양이 아닌 응답: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.body_code ?? ''} ${ri.kind})` : 'deny');
    if (row.action === 'info') {
      o = tSame && cSame ? infoVerdict(cell.info_lookup, st.target) : 'anomaly(정보 조회 전후로 저장 상태가 달라짐)';
    } else if (row.action === 'list') {
      const want = [cell.control_path, cell.path].map((p) => p.split('/').pop()).sort();
      if (!tSame || !cSame) o = 'anomaly(목록 조회 전후로 저장 상태가 달라짐)';
      else if (!cell.request_ok) o = inconclusive(ri.kind) ? `undetermined(요청이 끝나지 않았거나 서버 오류: ${ri.kind})` : `undetermined(목록 요청이 오류로 끝남: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.kind} — 빈 목록이 아니다)`;
      else if (notDynamic(cell.list_cf)) o = `undetermined(목록 응답: ${notDynamic(cell.list_cf)})`;
      else if (cell.returned_names === null) o = 'undetermined(목록 응답이 배열이 아님)';
      else if (JSON.stringify(cell.returned_names) === JSON.stringify(want)) o = 'allow';
      else if (cell.returned_names.length === 0) o = 'deny';          // 응답은 성공, 목록은 빔(파일은 실제로 있다)
      else o = `anomaly(목록에 일부만 나옴: ${cell.returned_names.length}/2)`;
    } else if (row.action === 'delete') {
      if (cell.request_ok && af.target.exists === false && cSame) o = 'allow';
      else if (tSame && cSame) o = cell.request_ok ? 'deny' : denyByResponse('delete'); // 성공이라고 응답했더라도 지워진 것이 없으면 거절
      else o = `anomaly(응답 ${ri.http_status}, 대상 ${af.target.exists ? '다른 상태로 남음' : '없어짐'}, 대조 객체 ${cSame ? '그대로' : '바뀜'})`;
    } else if (row.action === 'move') {
      if (cell.request_ok && af.target.exists === false && stateIs(cell.dest_after, present(original)) && cSame) o = 'allow';
      else if (tSame && cSame && destAbsent) o = cell.request_ok ? 'anomaly(성공 응답인데 변화 없음)' : denyByResponse('move'); // 출발지·대조 객체 그대로, 도착지 생기지 않음
      else o = `anomaly(응답 ${ri.http_status}, 출발지 ${tSame ? '그대로' : '바뀜'}, 도착지 ${destAbsent ? '없음' : '있음'}, 대조 객체 ${cSame ? '그대로' : '바뀜'})`;
    } else if (row.action === 'copy') {
      if (cell.request_ok && tSame && stateIs(cell.dest_after, present(original)) && cSame) o = 'allow';
      else if (tSame && cSame && destAbsent) o = cell.request_ok ? 'anomaly(성공 응답인데 변화 없음)' : denyByResponse('copy');
      else o = `anomaly(응답 ${ri.http_status}, 출발지 ${tSame ? '그대로' : '바뀜'}, 도착지 ${destAbsent ? '없음' : '있음'}, 대조 객체 ${cSame ? '그대로' : '바뀜'})`;
    }
    if (o === 'deny' && cell.actor !== 'service' && !(control && control.observed === 'allow')) o = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군이 성공하지 못함)';
  }
  cell.observed = o;
  cell.pass = cell.expect == null ? null : o === cell.expect ? true : o.startsWith('undetermined') ? null : false;
  cell.cmp = { observed: o.replace(/\(.*$/s, ''), response: respSig(ri), info_status: cell.info_lookup?.http_status ?? null, returned: cell.returned_names?.length ?? null, target_unchanged: cell.target_unchanged ?? null };
}
async function publicCell(run, row) {
  const { bucket } = row;
  const tag = `a${row.no}pb`;
  const target = join(row.place.dir, fileFor(tag));
  const bytes = makePng(`${run} ${row.id} public`);
  const cell = { row: row.no, row_id: row.id, bucket, place: 'public', action: 'public', actor: 'public', path: target, remaining_allowance: true, _names: [target] };
  const u = await upload('service', bucket, target, bytes, { upsert: false });
  cell.setup = { creator_upload: responseInfo(u), ok: u.ok };
  cell.start = { target: await readTrue(bucket, target) };
  cell.body = await publicBody(bucket, target, bytes);
  cell.expect = 'allow'; // 공개 버킷의 공개 주소는 규칙과 무관하게 열린다(어느 상태에서도). 성과가 아니라 남은 허용이다.
  let o;
  if (!u.ok || !stateIs(cell.start.target, present(bytes))) o = `undetermined(읽을 파일을 만들지 못했거나 확인하지 못함: ${u.status} ${doubtOf(cell.start.target) ?? ''})`;
  else if (cell.body.match === true) o = 'allow';
  else if (cell.body.match === false) o = 'anomaly(공개 주소의 본문이 올린 내용과 다름)';
  else if (cell.body.error?.kind === 'no_such_key') o = 'deny';
  else o = `undetermined(본문을 받지 못함: ${cell.body.http_status} ${cell.body.error?.kind})`;
  cell.observed = o;
  cell.pass = o === 'allow' ? true : o.startsWith('undetermined') ? null : false;
  cell.cmp = { observed: o.replace(/\(.*$/s, ''), http_status: cell.body.http_status };
  cell._ledger = ledgerEntry(bucket, target, cell.start.target, null, `${row.id} · 공개 주소 시험용(서비스 열쇠)`);
  return cell;
}
async function phaseActions(run) {
  const all = rowsActions();
  const rows = selectRows(all);
  const cells = [];
  const ledger = [];
  const known = new Set();
  let stopped = null;
  const before = await snapshotAll();
  let done = 0;
  for (const row of rows) {
    const soon = expiringSoon([...actors, row.creator]);
    if (soon) {
      stopped = `${who(soon)} 의 자격이 90초 안에 끝난다 — ${row.no}번 줄 앞에서 멈춤(--rows ${row.no}-${all.length} 로 이어서 잰다)`;
      break;
    }
    const rowCells = [];
    if (row.action === 'public') {
      const cell = await publicCell(run, row);
      rowCells.push(cell);
      if (cell.start.target.known && cell.start.target.exists) ledger.push(cell._ledger);
      delete cell._ledger;
    } else {
      const feasible = M.uploadNew(state, ctxOf(row.creator), row.bucket, join(row.place.dir, 'x.png'), false);
      for (const actor of actors) {
        if (!feasible) {
          rowCells.push({ row: row.no, row_id: row.id, bucket: row.bucket, place: row.place.id, created_by: row.creator, action: row.action, actor, not_applicable: `이 상태(${state})에서는 ${who(row.creator)} 가 이 경로에 먼저 올릴 수 없다(모형)`, expect: null, pass: null, cmp: { not_applicable: true }, _names: [] });
          continue;
        }
        rowCells.push(await actionCell(run, row, actor));
      }
      const control = rowCells.find((x) => x.actor === 'service');
      if (control && !control.not_applicable) judgeAction(row, control, null);
      for (const cell of rowCells) if (cell !== control && !cell.not_applicable) judgeAction(row, cell, control);
      for (const cell of rowCells) {
        if (cell.not_applicable) continue;
        const [t, c, d] = cell._names;
        if (cell.after?.target.known && cell.after.target.exists) ledger.push(ledgerEntry(row.bucket, t, cell.after.target, cell.target_unchanged ? ownerOf(row.creator) : undefined, `${row.id} · ${cell.actor} 칸의 대상(먼저 만든 쪽 ${row.creator})`));
        if (cell.after?.control.known && cell.after.control.exists) ledger.push(ledgerEntry(row.bucket, c, cell.after.control, null, `${row.id} · ${cell.actor} 칸의 대조 객체(서비스 열쇠)`));
        if (cell.dest_after?.known && cell.dest_after.exists) ledger.push(ledgerEntry(row.bucket, d, cell.dest_after, undefined, `${row.id} · ${cell.actor} 칸의 도착지(소유자는 견주지 않는다)`));
      }
    }
    for (const cell of rowCells) {
      for (const n of cell._names ?? []) known.add(`${row.bucket}/${n}`);
      delete cell._names;
      delete cell._original;
    }
    cells.push(...rowCells);
    done += 1;
    say(`actions ${done}/${rows.length} (${row.no}번 줄) — ${row.label} — ${tallyLine(tally(rowCells))}`);
  }
  const after = await snapshotAll();
  return finishMeasure({ rows, cells, ledger, known, before, after, stopped, extra: { note: '정보 조회의 거절은 "그 자격으로 그 파일의 정보를 볼 수 없다"까지만 뜻한다(본문 내려받기의 차단을 뜻하지 않는다). 목록의 거절은 "응답은 성공이고 목록이 빔"이다. 이동·복사의 거절은 출발지와 대조 객체가 식별자·저장 정보까지 그대로이고 도착지가 생기지 않은 것이다 — 소유자는 owners 단계가 견준다.' } });
}

// ---------------------------------------------------------------------
// revoked: 만료·로그아웃한 A — 새로 주는 올리기만 다시 잰다
//   pre = 먼저 허용 확인, post = (만료 SQL 또는 로그아웃 뒤) 이미 받아 둔 같은 자격으로 다시, restored = 만료를 되돌린 뒤
// ---------------------------------------------------------------------
async function phaseRevoked(run) {
  const rows = rowsRevoked();
  const dead = step === 'post';
  const cells = [];
  const ledger = [];
  const known = new Set();
  const before = await snapshotAll();
  for (const row of rows) {
    const rowCells = [];
    for (const actor of ['subject', 'service']) {
      const tag = `x${kind === 'expired' ? 'e' : 'o'}${step.slice(0, 2)}${row.no}${ACTOR_CODE[actor]}`;
      const name = join(row.dir, fileFor(tag));
      const bytes = makePng(`${run} ${row.id} ${kind} ${step} ${actor}`);
      known.add(`${row.bucket}/${name}`);
      const cell = { row: row.no, row_id: row.id, bucket: row.bucket, actor, kind, step, path: name, request_mode: 'plain', uploaded: describe(bytes), remaining_allowance: !!row.remaining };
      cell.start = await readTrue(row.bucket, name);
      const r = await upload(actor, row.bucket, name, bytes, { upsert: false });
      cell.response = responseInfo(r);
      cell.request_ok = r.ok;
      cell.after = await readTrue(row.bucket, name);
      if (r.ok && stateIs(cell.after, present(bytes))) cell.body = await firstBodyByService(row.bucket, name, bytes);
      cell._bytes = bytes;
      rowCells.push(cell);
    }
    const control = rowCells.find((x) => x.actor === 'service');
    for (const cell of [control, ...rowCells.filter((x) => x !== control)]) {
      const c = ctxOf(cell.actor, dead);
      cell.expect = verdictWord(M.uploadNew(state, c, row.bucket, cell.path, false));
      const ri = cell.response;
      let o;
      if (!stateIs(cell.start, ABSENT)) o = `undetermined(시작 상태 미확인 — 그 이름이 비어 있음을 확인하지 못함: ${doubtOf(cell.start) ?? '객체가 있음'})`;
      else if (!cell.after.known) o = `undetermined(요청 뒤의 저장 정보 미확인: ${cell.after.unverified})`;
      else if (cell.request_ok && stateIs(cell.after, present(cell._bytes))) o = cell.body.match === true ? 'allow' : cell.body.match === null ? `undetermined(본문을 받지 못함: ${cell.body.http_status})` : 'anomaly(본문의 md5 가 올린 내용과 다름)';
      else if (!cell.request_ok && cell.after.exists === false) {
        if (inconclusive(ri.kind)) o = `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind} — 규칙의 거절로 세지 않는다)`;
        else if (!DENY_KINDS.upload.includes(ri.kind)) o = `undetermined(권한 오류의 관측된 모양이 아닌 거절: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.kind})`;
        else if (cell !== control && control.observed !== 'allow') o = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군이 성공하지 못함)';
        else o = 'deny';
      } else o = `anomaly(응답 ${ri.http_status}, 그 이름 ${cell.after.exists ? '객체 있음' : '비어 있음'})`;
      cell.observed = o;
      cell.pass = o === cell.expect ? true : o.startsWith('undetermined') ? null : false;
      cell.cmp = { observed: o.replace(/\(.*$/s, ''), response: respSig(ri) };
      if (cell.after.known && cell.after.exists) ledger.push(ledgerEntry(row.bucket, cell.path, cell.after, cell.actor === 'service' ? null : jwtInfo.subject.sub, `${row.id} · ${kind} ${step} · ${cell.actor}`));
      delete cell._bytes;
    }
    cells.push(...rowCells);
    say(`revoked ${kind} ${step} ${row.no}/${rows.length} — ${row.label} — A: 기대 ${rowCells[0].expect} → ${rowCells[0].observed}`);
  }
  const after = await snapshotAll();
  const left = decodeJwtPayload(jwts.subject).exp - Math.floor(Date.now() / 1000);
  return finishMeasure({
    rows, cells, ledger, known, before, after, stopped: null,
    extra: {
      credential: { sub: jwtInfo.subject.sub, session_id: jwtInfo.subject.session_id, aal: jwtInfo.subject.aal, seconds_left_at_end: left },
      note: step === 'post'
        ? '이미 받아 둔 같은 자격으로 다시 보낸 것이다. 거절이 규칙 때문인지 보려면 credential.seconds_left_at_end 가 0보다 크고, 응답 종류가 jwt 가 아니며, 서비스 열쇠 대조군이 allow 여야 한다(도구가 이 셋을 확인한 칸만 deny 로 적는다). guide-images 줄은 남은 허용이다 — 로그인 상태가 끝나도 자격 자체가 유효하면 모든 역할 올리기 규칙으로 올라갈 것으로 본다.'
        : '같은 자격으로 새로 주는 올리기가 허용됨을 먼저 확인한다. credential.session_id 가 만료용 SQL·로그아웃이 다룰 로그인 상태다.',
    },
  });
}

// 실측 단계의 마무리: 셈, 표, 대상 밖 변화
function finishMeasure({ rows, cells, ledger, known, before, after, stopped, extra }) {
  const outside = outsideChange(before, after, known);
  const summary = tally(cells);
  const table = {};
  const labels = new Map(rows.map((r) => [r.id, r.label]));
  for (const c of cells) {
    const mark = c.not_applicable ? '해당 없음' : c.expect == null ? `(잰 값) ${c.observed}` : `${c.expect} → ${c.observed}${c.pass === true ? '' : c.pass === false ? '  ✗' : '  ?'}`;
    (table[`${String(c.row).padStart(3, '0')} ${labels.get(c.row_id) ?? c.row_id}`] ??= {})[c.actor] = mark;
  }
  const bad = summary.mismatch > 0 || summary.undetermined > 0 || !outside.zero;
  if (!outside.zero) say(`대상 밖 객체의 변화가 있거나 확인하지 못함 — 새 객체 ${outside.unaccounted_new.length}, 없어진 것 ${outside.removed.length}, 바뀐 것 ${outside.changed.length}${outside.ok ? '' : ', 목록 비교를 믿을 수 없음'}`);
  return {
    exit: stopped ? 3 : bad ? 1 : 0,
    result: {
      state, stopped,
      summary,
      outside_objects: outside,
      fourth_class_cells: cells.filter((c) => c.class_key === 'outside').map((c) => `${c.row_id} · ${c.actor} → ${c.arrived_full_name}`),
      mismatches: cells.filter((c) => c.pass === false).map((c) => ({ row_id: c.row_id, actor: c.actor, expect: c.expect, observed: c.observed, response: c.response ?? null })),
      undetermined: cells.filter((c) => c.expect != null && c.pass === null && !c.not_applicable).map((c) => ({ row_id: c.row_id, actor: c.actor, expect: c.expect, observed: c.observed })),
      remaining_allowances: cells.filter((c) => c.remaining_allowance && c.observed === 'allow').map((c) => `${c.row_id} · ${c.actor}`),
      ...extra,
      table, cells, ledger,
    },
  };
}

// ---------------------------------------------------------------------
// plan (요청 0): 대조표의 줄·칸·기대값
// ---------------------------------------------------------------------
function phasePlan() {
  const exp = (b) => verdictWord(b);
  const out = { state, members_used: { A: memberA, B: memberB, GM: memberGM }, groups: {} };
  const cellExp = (actor, f) => (hasExpectation(actor) ? f(ctxOf(actor)) : '(잰 값 — compare 로 견준다)');
  // upload-new
  {
    const rows = rowsUploadNew().map((r) => {
      const t = r.shape.make(`u${r.no}xx`);
      const literal = r.shape.kind === 'normal' ? t.name : t.literal;
      const cellsOut = {};
      for (const a of ALL_ACTORS) {
        cellsOut[a] = r.shape.kind === 'normal'
          ? cellExp(a, (c) => exp(M.uploadNew(state, c, r.bucket, literal, r.mode.upsert)))
          : hasExpectation(a) ? (a === 'service' ? '저장됨 또는 ①' : r.shape.must?.[a] === 'not_stored' ? '① 또는 ②(저장되지 않음)' : `①·②·③ 중 하나(④가 아님) — 적은 이름 그대로라면 ${exp(M.uploadNew(state, ctxOf(a), r.bucket, literal, r.mode.upsert))}`) : '(잰 값)';
      }
      return { no: r.no, id: r.id, label: r.label, path_kind: r.shape.kind, sent_path: r.shape.kind === 'normal' ? t.name : t.raw, skip: r.shape.skip ?? null, cells: cellsOut };
    });
    out.groups['upload-new'] = { rows: rows.length, cells: rows.length * ALL_ACTORS.length, rough_requests: rows.length * 55, table: rows };
  }
  {
    const rows = rowsUploadExisting().map((r) => {
      const name = join(r.place.dir, 'x.png');
      const feasible = M.uploadNew(state, ctxOf(r.creator), r.bucket, name, false);
      const cellsOut = {};
      for (const a of ALL_ACTORS) cellsOut[a] = !feasible ? '해당 없음(먼저 만들 수 없음)' : r.mode.upsert ? cellExp(a, (c) => exp(M.overwrite(state, c, r.bucket, name))) : 'no_overwrite(권한 미판정 · 덮어쓰기 없음)';
      return { no: r.no, id: r.id, label: r.label, cells: cellsOut };
    });
    out.groups['upload-existing'] = { rows: rows.length, cells: rows.length * ALL_ACTORS.length, rough_requests: rows.length * 110, table: rows };
  }
  {
    const rows = rowsActions().map((r) => {
      const name = join(r.place.dir, 'x-t.png');
      const dest = join(r.place.dir, 'x-d.png');
      const cellsOut = {};
      if (r.action === 'public') cellsOut.public = 'allow(남은 허용)';
      else {
        const feasible = M.uploadNew(state, ctxOf(r.creator), r.bucket, name, false);
        const f = { info: (c) => M.read(state, c, r.bucket, name), list: (c) => M.read(state, c, r.bucket, name), delete: (c) => M.remove(state, c, r.bucket, name), move: (c) => M.move(state, c, r.bucket, name), copy: (c) => M.copy(state, c, r.bucket, name, dest) }[r.action];
        for (const a of ALL_ACTORS) cellsOut[a] = !feasible ? '해당 없음(먼저 만들 수 없음)' : cellExp(a, (c) => exp(f(c)));
      }
      return { no: r.no, id: r.id, label: r.label, cells: cellsOut };
    });
    out.groups.actions = { rows: rows.length, cells: rows.reduce((s, r) => s + Object.keys(r.cells).length, 0), rough_requests: rows.length * 130, table: rows };
  }
  {
    const rows = rowsRevoked().map((r) => ({
      no: r.no, id: r.id, label: r.label,
      cells: { 'pre·restored(살아 있는 로그인 상태)': exp(M.uploadNew(state, ctxOf('subject', false), r.bucket, join(r.dir, 'x.png'), false)), 'post(만료·로그아웃 뒤)': exp(M.uploadNew(state, ctxOf('subject', true), r.bucket, join(r.dir, 'x.png'), false)), service: 'allow' },
    }));
    out.groups.revoked = { rows: rows.length, cells: rows.length * 2, rough_requests: 60, table: rows };
  }
  out.note = 'rough_requests 는 모든 자격으로 잴 때의 어림이다(2a 실행에서는 초당 12건쯤이었다). 비로그인 칸은 before·applied·rolledback 에서 기대값이 없다 — 잰 값을 compare 단계로 서로 견준다. 꾸민 경로의 기대값은 "전부 거절"이 아니다: 저장소가 이름을 어떻게 다루는지에 따라 ①·②·③이 될 수 있고, ④(권한 밖 위치에 저장)만 실패다.';
  for (const [g, v] of Object.entries(out.groups)) say(`plan ${g}: 줄 ${v.rows}, 칸 ${v.cells}, 요청 어림 ${v.rough_requests}`);
  return { exit: 0, result: out };
}

// ---------------------------------------------------------------------
// cleanup: 이 도구가 만든 합성 객체(이름에 zzb2n2b)를 지우고 남은 객체를 적는다
// ---------------------------------------------------------------------
async function phaseCleanup() {
  const report = {};
  for (const b of BUCKETS) {
    let found = 0;
    let deleted = 0;
    for (let round = 0; round < 50; round += 1) {
      const s = await snapshot(b);
      if (!s.ok) throw new Error(`목록을 믿을 수 없다(${b}): ${s.doubts.join(' / ')}`);
      const names = [...s.objects.keys()];
      if (round === 0) found = names.length;
      const mine = names.filter((n) => n.includes(MARK));
      if (!mine.length) break;
      await removeMany(b, mine);
      deleted += mine.length;
    }
    const left = [...(await snapshot(b)).objects.keys()];
    report[b] = { found_first_pass: found, deleted, left: left.length, left_names: left.slice(0, 100) };
    say(`cleanup ${b}: 지움 ${deleted}, 남음 ${left.length}`);
  }
  const leftTotal = Object.values(report).reduce((s, r) => s + r.left, 0);
  return {
    exit: leftTotal === 0 ? 0 : 1,
    result: {
      note: `업무 버킷 4개에서 이름에 ${MARK} 가 든 객체만 지운다(이 도구의 합성 파일은 전부 그 표식을 가진다). 그 밖의 객체가 남아 있으면 지우지 않고 left_names 에 적는다 — 무엇인지 확인하기 전에는 손대지 않는다. 남은 수는 목록 조회로 센다. 지운 뒤에도 같은 주소의 본문 GET 은 한동안 옛 내용을 줄 수 있다(2a 관측).`,
      all_zero: leftTotal === 0, report,
    },
  };
}

// ---------------------------------------------------------------------
// table-ref: 표 쪽 기준 요청(비로그인 GET)의 상태·본문 지문
// ---------------------------------------------------------------------
async function phaseTableRef() {
  const paths = String(env.B2N2B_TABLE_REF_PATHS).split(',').map((s) => s.trim()).filter(Boolean);
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
// compare (요청 0): 두 결과 파일의 칸을 견준다(기본은 비로그인 칸)
//   견주는 것: 칸의 결과(허용·거절·분류), 응답의 모양(상태·본문 코드), 저장 여부·저장된 위치의 모양, 대상·대조 객체가 그대로였는지.
//   실행마다 달라지는 이름·시각은 견주지 않는다.
// ---------------------------------------------------------------------
async function phaseCompare() {
  if (!args.base || !args.with) stop(2, 'compare 는 --base <결과 json> --with <결과 json> 이 필요하다');
  const load = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
  const a = await load(args.base);
  const b = await load(args.with);
  if (a.phase !== b.phase) stop(2, `두 결과의 단계가 다르다(${a.phase} / ${b.phase})`);
  const want = args.actors ? args.actors.split(',').map((s) => s.trim()) : ['anon', 'public']; // 기본: 비로그인 칸과 공개 주소 칸
  const index = (f) => new Map((f.result?.cells ?? []).filter((c) => want.includes(c.actor)).map((c) => [`${c.row_id} · ${c.actor}`, c.cmp ?? null]));
  const A = index(a);
  const B = index(b);
  const different = [];
  const onlyBase = [];
  const onlyWith = [];
  const noBaseline = []; // 한쪽 상태에서는 그 줄을 만들 수 없어(먼저 올릴 자격에 규칙이 없음) 견줄 기준이 없는 칸
  let compared = 0;
  for (const [k, v] of A) {
    if (!B.has(k)) onlyBase.push(k);
    else if (v?.not_applicable || B.get(k)?.not_applicable) {
      if (!(v?.not_applicable && B.get(k)?.not_applicable)) noBaseline.push({ cell: k, not_applicable_in: v?.not_applicable ? 'base' : 'with' });
    } else {
      compared += 1;
      if (JSON.stringify(v) !== JSON.stringify(B.get(k))) different.push({ cell: k, base: v, with: B.get(k) });
    }
  }
  for (const k of B.keys()) if (!A.has(k)) onlyWith.push(k);
  const same = compared > 0 && !different.length && !onlyBase.length && !onlyWith.length;
  console.log(`[b2n2b] compare ${a.phase}: ${a.result?.state ?? '-'} ↔ ${b.result?.state ?? '-'} · 자격 ${want.join(',')} · 견준 칸 ${compared} · ${same ? '같음' : `다름 ${different.length}건, 한쪽에만 있는 칸 ${onlyBase.length + onlyWith.length}건`}${noBaseline.length ? ` · 한쪽 상태에서는 만들 수 없어 견줄 기준이 없는 칸 ${noBaseline.length}건(같음에 넣지 않았다)` : ''}`);
  for (const d of different.slice(0, 20)) console.log('  ' + JSON.stringify(d));
  return { exit: same ? 0 : 1, result: { phase: a.phase, base: { state: a.result?.state, run: a.run }, with: { state: b.result?.state, run: b.run }, actors: want, cells_base: A.size, cells_with: B.size, compared, same, different, only_in_base: onlyBase, only_in_with: onlyWith, no_baseline: noBaseline, note: 'no_baseline 은 한쪽 상태에서 그 줄의 시작 상태(먼저 있는 객체)를 만들 수 없어 재지 못한 칸이다 — 같음에도 다름에도 넣지 않는다.' } };
}

// ---------------------------------------------------------------------
// owners (요청 0): 결과의 객체 장부를 fingerprint.sql 결과(objects)와 견준다
//   Storage API 로 볼 수 없는 소유자를 SQL 로 뜬 값과 맞춘다. 식별자·크기·형식·eTag 도 함께 본다.
// ---------------------------------------------------------------------
async function phaseOwners() {
  if (!args.result || !args.fingerprint) stop(2, 'owners 는 --result <결과 json>[,<json>…] --fingerprint <fingerprint 결과 json> 이 필요하다');
  let fp = JSON.parse((await readFile(args.fingerprint, 'utf8')).replace(/^\uFEFF/, ''));
  if (Array.isArray(fp)) fp = fp[0];
  if (fp && fp.result) fp = fp.result;
  const sql = new Map((fp.objects ?? []).map((o) => [`${o.bucket_id}/${o.name}`, o]));
  const problems = [];
  let checked = 0;
  let ownerChecked = 0;
  const seen = new Set();
  for (const p of args.result.split(',').map((s) => s.trim()).filter(Boolean)) {
    const f = JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
    for (const e of f.result?.ledger ?? []) {
      const key = `${e.bucket}/${e.name}`;
      seen.add(key);
      checked += 1;
      const o = sql.get(key);
      if (!o) {
        problems.push({ object: key, problem: 'SQL 로 뜬 객체 행에 없음', why: e.why });
        continue;
      }
      if (e.object_id && o.id !== e.object_id) problems.push({ object: key, problem: '식별자가 다름', tool: e.object_id, sql: o.id, why: e.why });
      if (e.md5 && normEtag(o.etag) !== e.md5) problems.push({ object: key, problem: 'eTag 가 다름', tool: e.md5, sql: o.etag, why: e.why });
      if (e.size != null && Number(o.size) !== Number(e.size)) problems.push({ object: key, problem: '크기가 다름', tool: e.size, sql: o.size, why: e.why });
      if (e.expect_owner !== undefined) {
        ownerChecked += 1;
        const got = o.owner_id ?? o.owner ?? null;
        if ((got ?? null) !== (e.expect_owner ?? null)) problems.push({ object: key, problem: '소유자가 기대와 다름', expected: e.expect_owner, sql_owner_id: o.owner_id ?? null, sql_owner: o.owner ?? null, why: e.why });
      }
    }
  }
  const notInLedger = [...sql.keys()].filter((k) => BUCKETS.includes(k.split('/')[0]) && !seen.has(k));
  const ok = checked > 0 && problems.length === 0;
  console.log(`[b2n2b] owners: 장부 ${checked}건(소유자까지 견준 것 ${ownerChecked}건), 어긋난 것 ${problems.length}건, 장부에 없는 SQL 객체 ${notInLedger.length}건`);
  for (const d of problems.slice(0, 20)) console.log('  ' + JSON.stringify(d));
  return { exit: ok ? 0 : 1, result: { checked, owner_checked: ownerChecked, problems, sql_objects_not_in_ledger: notInLedger, note: '기대한 소유자: 비로그인·서비스 열쇠가 올린 객체는 비어 있음, 로그인 자격이 올린 객체는 그 계정 번호(auth.users.id). 덮어써졌거나 이동·복사로 생긴 객체의 소유자는 견주지 않는다(expect_owner 없음). 장부에 없는 SQL 객체는 다른 단계의 결과 파일을 --result 에 함께 주지 않았을 때도 생긴다.' } };
}

// ---------------------------------------------------------------------
// 본 실행
// ---------------------------------------------------------------------
async function main() {
  const startedAt = new Date().toISOString();
  runTs = Date.now();
  const run = String(runTs);
  let res;
  if (phase === 'plan') res = phasePlan();
  else if (phase === 'upload-new') res = await phaseUploadNew(run);
  else if (phase === 'upload-existing') res = await phaseUploadExisting(run);
  else if (phase === 'actions') res = await phaseActions(run);
  else if (phase === 'revoked') res = await phaseRevoked(run);
  else if (phase === 'cleanup') res = await phaseCleanup();
  else if (phase === 'compare') res = await phaseCompare();
  else if (phase === 'owners') res = await phaseOwners();
  else res = await phaseTableRef();

  const out = {
    tool: 'b2n2b storage_matrix',
    ref: REF,
    phase, state, kind, step,
    run,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    request_count: requestCount,
    key_notes: keyNotes,
    actors: [...MEASURE_PHASES].includes(phase) ? actors : undefined,
    rows_filter: { bucket: onlyBucket, rows: rowRange },
    // sub·session_id 는 식별값이다(자격이 아니다)
    credentials: Object.fromEntries(Object.entries(jwtInfo).map(([k, v]) => [k, { sub: v.sub, session_id: v.session_id, aal: v.aal, seconds_left_at_start: v.seconds_left_at_start }])),
    members: memberA ? { A: memberA, B: memberB, GM: memberGM } : undefined,
    how_read: '저장 정보는 서비스 열쇠의 목록 조회 + 정보 조회로만 읽는다(DYNAMIC 일 때만 인정, eTag 를 올린 내용의 md5 와 대조). "객체 없음"은 관측된 모양(HTTP 400·statusCode 404·code NoSuchKey)만 인정한다. 이것은 저장 정보이지 본문의 재확인이 아니다 — 새로 생긴 객체의 본문은 서비스 열쇠의 첫 읽기(값 없는 인증 주소) 한 번으로 따로 견준다. 미확인은 통과에 넣지 않는다.',
    exit_code: res.exit,
    result: res.result,
  };
  if (outPath) await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

  const s = res.result?.summary;
  console.log(`[b2n2b] phase=${phase}${state ? ' state=' + state : ''}${kind ? ' kind=' + kind : ''}${step ? ' step=' + step : ''} 요청 ${requestCount}건${s ? ` — ${tallyLine(s)}` : ''}${res.result?.stopped ? ' — 멈춤: ' + res.result.stopped : ''}`);
  if (outPath) console.log(`[b2n2b] 결과: ${outPath}`);
  process.exit(res.exit);
}

main().catch((e) => {
  console.error(`[b2n2b] 실행 중 멈춤: ${e?.message ?? e}`);
  console.error('[b2n2b] 합성 객체가 남아 있을 수 있다. --phase cleanup 으로 지우고 fingerprint.sql 의 object_counts 로 확인한다.');
  console.error('[b2n2b] 보낸 요청 수: ' + requestCount);
  process.exit(3);
});
