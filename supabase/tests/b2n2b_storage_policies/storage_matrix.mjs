// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-2b: 파일 규칙 대조표 도구 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 1차 판(9cff0e7)은 브레인방이 시험 프로젝트에서 --state before --actors anon 의 upload-new 를 끝까지 돌렸다(요청 1,471건).
// 거기서 확인된 것: 원시 요청 통로, 올리기 응답의 Key·Id, 정보 조회·목록의 식별자 필드, 저장소가 이름을 다루는 방식 일부
// (보낸 대소문자를 그대로 저장한다 / 빈 구간은 합쳐지고 ".." 은 풀려서 도착한다 / %2F 는 빗금이 된다 /
//  %2F 가 남은 이름과 한글 이름은 InvalidKey / 파일 이름이 빈 경로는 그 이름의 객체로 저장된다).
// 그리고 드러난 것: 소문자 폴더의 목록 조회에 대문자 폴더의 객체가 함께 나왔다 — 목록으로는 전체 이름을 글자 그대로
// 가릴 수 없다. 2차에서 "도착한 이름"을 올리기 응답의 Key·Id 와 글자 그대로의 정보 조회로 정하도록 고쳤다.
// 2차 판(a20554b)도 브레인방이 같은 단계를 돌렸다(요청 1,269건): 대문자 세 경로가 보낸 글자 그대로 도착한 것으로 읽혔고,
// cleanup --fingerprint 가 앞 실행의 객체 148개를 정확한 이름으로 지웠다. 남은 미확인은 "저장소가 받지 않는 이름" 두 줄이었다 —
// 올리기 응답도, 그 이름의 정보 조회도 HTTP 400·statusCode 400·InvalidKey 였다. 3차에서 그 모양을 분류하도록 고쳤다.
// 3차에서 바꾼 부분은 아직 실제 Storage 에 실행된 적이 없다(작업방은 그 관측에 맞춘 가짜 응답으로만 돌려 봤다 —
// 가짜 응답은 실제 동작을 대신하지 않는다). upload-existing·actions·revoked 단계와 복사 요청, 목록의 쪽 나눔도 실행된 적이 없다.
//
// 판정 방식
//   * 도착한 이름은 글자 그대로 정한다: 올리기가 성공하면 응답의 Key(버킷/전체 이름)와 Id 가 근거이고, 그 정확한
//     전체 이름에 대한 서비스 열쇠의 정보 조회가 준 식별자·저장 정보와 대조한다. 어긋나면 미확인이다.
//     거절된 요청에는 Key 가 없는 것이 정상이다. 목록이 준 파일 이름에 조회한 폴더 이름을 붙여 전체 이름으로 삼지 않는다.
//   * 있음·없음은 글자 그대로의 정보 조회로 읽는다(cf-cache-status 가 DYNAMIC 일 때만 인정, eTag 를 올린 내용의 md5 와 대조).
//     "객체 없음"으로 인정하는 응답은 관측된 모양 하나뿐이다: HTTP 400 · 본문 statusCode 404 · code NoSuchKey.
//     일반 404, 그 밖의 "not found" 문구, 서버 오류, 통신 오류는 전부 "미확인"이다.
//     이것은 저장 정보(메타데이터)다 — 본문을 다시 받아 확인한 것이 아니다.
//   * 거절 칸 하나하나의 "저장 변화 0"은 그 요청 직후, 정리하기 전에 확인한다: 그 요청이 가리킨 정확한 이름과 꾸민 경로가
//     도착할 수 있는 후보 이름들의 정보 조회가 "객체 없음"이고, 대조 객체의 식별자·저장 정보가 그대로임. 못 하면 미확인이다.
//   * 꾸민 경로의 ③(허용된 경로로 저장)·④(권한 밖 위치에 저장)는 글자 그대로의 도착 이름으로 가른다.
//   * "저장소가 받지 않는 이름"으로 인정하는 응답도 관측된 모양 하나뿐이다: HTTP 400 · statusCode 400 · code(또는 error) InvalidKey.
//     올리기 응답이 이 모양이고 같은 입력의 서비스 열쇠 칸도 같은 모양이면 ① 입력 오류다(다른 400 은 미확인).
//     InvalidKey 는 입력 오류의 표시이지 "객체 없음"의 증거가 아니다. 그 이름의 정보 조회까지 이 모양이면 그 이름에 객체가 없는지를
//     이 도구는 모른다 — 그런 칸은 통과로도 미확인으로도 세지 않고 "입력 오류 확인 / 저장 변화 검증 대기"로 result.input_error_cells 에 모은다.
//     이 갈래만 남으면 종료 값은 0 이지만 "전부 확인됨"이 아니다: 칸마다 그 요청 하나만 다시 보내(--no-control) 앞뒤의 fingerprint.sql 을
//     outside 단계(--result 없이)로 견줘 "생긴 객체 0·없어진 객체 0·바뀐 객체 0"이 나와야 확인된 것이다.
//   * 기대값 대조는 올리기·정보 조회·덮어쓰기·삭제·이동·복사·목록으로 한다. 본문 GET 은 관측이다.
//     다만 새로 생긴 객체는 본문(md5)도 따로 견준다 — 서비스 열쇠의 값 없는 인증 주소 GET 한 번.
//     이름이 칸마다 다른 줄에서는 그것이 그 객체의 첫 읽기이고 판정에 든다. 여러 칸이 같은 이름을 쓰는 줄(파일 이름이 빈 경로)
//     에서는 "새 객체의 저장 정보 일치"가 판정의 근거이고, 본문 GET 의 결과(올린 내용 / 옛 본문의 재전달 / 그 밖)는 관측이다.
//     올린 사람의 읽기는 올리기 성공의 조건이 아니다(올린 사람은 읽기 규칙이 없어 못 읽는 것이 정상이다).
//   * 거절로 적는 칸에는 같은 입력의 서비스 열쇠 대조군이 성공해야 한다. 아니면 "권한 미판정"이다.
//   * 미확인은 통과 수에 넣지 않는다. 미확인이나 기대와 다른 칸이 하나라도 있으면 종료 값 1 이다.
//     기대값 없이 잰 칸(비로그인)도 도착 이름·저장 여부를 확인하지 못했으면 종료 값 1 이다(기준선으로 쓸 수 없다).
//   * "대상 밖 객체의 변화 0"은 이 도구의 목록 집계로 말하지 않는다. 단계 앞뒤로 뜬 fingerprint.sql 결과(DB 의 객체 행)를
//     outside 단계(요청 0)에 넘겨 확인한다. 그 비교는 단계가 끝났을 때 남은 변화만 본다.
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
//                    --rows <줄 하나> --actors <자격 하나> --no-control 이면 그 올리기 요청 하나만 보낸다(요청 1건.
//                    서비스 열쇠 대조군·대조 객체·저장 정보 읽기·목록 조회 없음. 판정하지 않는다 — 앞뒤 지문을 outside 로 견준다)
//   upload-existing  있는 이름에 다시 올리기: 경로 × 먼저 만든 쪽 × 요청 방식 × 자격   있음
//   actions          정보 조회·목록·삭제·이동·복사 + 공개 주소                        있음
//   revoked          만료·로그아웃한 A 의 올리기: --kind expired|loggedout --step pre|post|restored
//   cleanup          이 도구의 합성 객체를 지운다: [--fingerprint <json>] [--ledger <결과 json>[,…]]   있음
//                    정확한 이름은 fingerprint.sql 의 객체 행과 장부에서 얻는다(인자 없이 돌면 목록만 쓴다 — 어림).
//                    표식(zzb2n2b) 없는 이름은 장부의 식별자가 지금 그 객체와 같을 때만 지운다
//   table-ref        표 쪽 기준 요청(비로그인 GET): --compare <앞 결과>                있음
//   compare          두 결과 파일의 칸을 견준다: --base <json> --with <json> [--actors anon,public]   0
//   owners           결과의 객체 장부를 fingerprint.sql 결과와 견준다(식별자·소유자·저장 정보):
//                    --result <json>[,<json>…] --fingerprint <json>                   0
//   outside          대상 밖 객체의 변화를 DB 의 객체 행으로 본다:                     0
//                    --fingerprint-before <json> --fingerprint-after <json> --result <그 사이에 돈 단계들의 결과 json>[,…]
//                    --result 를 주지 않으면 장부 없이 두 지문만 견준다: 생긴 객체·없어진 객체·바뀐 객체를 전부 변화로 센다
// 공통 인자: --state <상태>  --out <결과 JSON>  [--actors a,b,…]  [--rows 시작-끝]  [--bucket <버킷>]
//            [--min-seconds N]  자격의 남은 유효 시간 하한(기본 1200초. 긴 단계가 도는 동안 자격이 살아 있어야 한다)
// 긴 단계는 줄마다 진행 상황을 표준 출력에 한 줄씩 적는다. 자격의 남은 시간이 90초 아래로 내려가면 그 줄 앞에서
// 멈추고 거기까지의 결과를 적는다(--rows 로 이어서 잰다).
//
// 종료 값: 0 = 끝까지 했고 기대와 다른 칸·미확인 칸이 없음("검증 대기" 칸은 남아 있을 수 있다 — 표준 출력과
//              result.input_error_cells 를 볼 것) / 1 = 기대와 다르거나 미확인인 칸이 있음 /
//          2 = 대상·입력 확인에서 멈춤(요청 0) / 3 = 실행 중 멈춤 /
//          4 = cleanup: 표식 없는 이름의 객체가 장부의 객체와 달라 아무것도 지우지 않고 멈춤
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

const PHASES = ['plan', 'upload-new', 'upload-existing', 'actions', 'revoked', 'cleanup', 'table-ref', 'compare', 'owners', 'outside'];
const MEASURE_PHASES = ['upload-new', 'upload-existing', 'actions'];
const NO_REQUEST_PHASES = ['plan', 'compare', 'owners', 'outside'];
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
if (!outPath && !['compare', 'owners', 'outside'].includes(phase)) stop(2, '--out <결과 JSON 경로> 가 필요하다');
const minSeconds = Number.isFinite(Number(args['min-seconds'])) ? Math.max(120, Number(args['min-seconds'])) : 1200;
const onlyBucket = args.bucket ?? null;
if (onlyBucket && !BUCKETS.includes(onlyBucket)) stop(2, `--bucket 은 다음 중 하나여야 한다: ${BUCKETS.join(', ')}`);
let rowRange = null;
if (args.rows) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(args.rows);
  if (!m || Number(m[1]) < 1 || (m[2] != null && Number(m[2]) < Number(m[1]))) stop(2, '--rows 는 "시작-끝"(1부터) 또는 줄 번호 하나여야 한다');
  rowRange = [Number(m[1]), Number(m[2] ?? m[1])];
}
// --no-control: 요청 하나만 보낸다(서비스 열쇠 대조군도, 대조 객체도, 저장 정보 읽기도 없다). 브레인방이 그 요청의 앞뒤로
// fingerprint.sql 을 떠서 DB 로 "생긴 객체 0·없어진 객체 0·바뀐 객체 0"을 확인할 때 쓴다.
const noControl = args['no-control'] === 'true';
let actors = ALL_ACTORS;
if (args.actors) {
  const list = args.actors.split(',').map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!ALL_ACTORS.includes(a)) stop(2, `--actors 에 모르는 자격이 있다: ${a} (${ALL_ACTORS.join(', ')})`);
  actors = ALL_ACTORS.filter((a) => list.includes(a) || (a === 'service' && !noControl)); // 대조군(서비스 열쇠)은 늘 넣는다(--no-control 은 빼고)
}
if (noControl) {
  if (phase !== 'upload-new') stop(2, '--no-control 은 upload-new 에서만 쓴다');
  if (!args.actors || actors.length !== 1) stop(2, '--no-control 은 --actors 에 자격 하나만 줘야 한다');
  if (!rowRange || rowRange[0] !== rowRange[1]) stop(2, '--no-control 은 --rows <줄 번호 하나> 가 필요하다(요청 하나만 보낸다)');
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
//   invalid_key    HTTP 400 · statusCode 400 · code 또는 error 가 InvalidKey   (저장소가 그 이름 자체를 받지 않음, 2b 관측)
//                  — 입력 오류의 표시다. "객체 없음"의 증거가 아니다. 다른 400 은 other 로 남는다.
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
    else if (r.status === 400 && bodyStatus === '400' && (bodyCode === 'InvalidKey' || bodyError === 'InvalidKey')) k = 'invalid_key'; // 문구에 이름이 실려 오므로 아래의 글자 찾기보다 먼저 본다
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
// 저장 정보 읽기 (서비스 열쇠. 본문을 내려받지 않는다)
// ---------------------------------------------------------------------
const normEtag = (v) => (v == null ? null : String(v).trim().replace(/^W\//, '').replace(/^"+|"+$/g, '').toLowerCase());
const MD5_RE = /^[0-9a-f]{32}$/;
let noListCorroboration = 0; // "있음"으로 읽었지만 목록에서 같은 식별자의 항목을 찾지 못한 읽기의 수
const notDynamic = (cf) => (cf === 'DYNAMIC' ? null : `cf-cache-status 가 DYNAMIC 이 아님(${cf ?? '머리글 없음'})`);

// 저장 정보를 읽는 함수는 이것 하나다. path 는 글자 그대로의 전체 이름이다.
//   있음·없음의 근거는 정보 조회다(글자 그대로 찾는다 — 실측).
//     있음 = 200 이고 식별자·eTag(md5 모양)·크기가 옴
//     없음 = 관측된 "객체 없음" 모양(HTTP 400·statusCode 404·code NoSuchKey)
//     그 밖(DYNAMIC 이 아님, 시간 초과·서버 오류, 일반 404 나 다른 문구) = 미확인
//   목록 조회는 이름을 정하는 데 쓰지 않는다. 실측에서 소문자 폴더의 목록에 대문자 폴더의 객체가 함께 나왔다 —
//   목록이 돌려준 파일 이름에 조회한 폴더 이름을 붙여 전체 이름으로 삼으면 틀린다.
//   "있음"일 때만 목록을 불러, 정보 조회가 준 식별자와 같은 항목을 골라 eTag·크기·형식을 한 번 더 견주고
//   만든 시각·고친 시각을 읽는다. 같은 식별자의 항목이 있는데 값이 어긋나면 미확인이다.
//   같은 식별자의 항목을 목록에서 찾지 못하면 정보 조회만으로 적고(list_corroborated: false),
//   만든 시각·고친 시각은 비워 둔다 — 그 읽기가 몇 건이었는지를 결과에 적는다.
//   ※ 이것은 저장 정보(메타데이터)다. 본문을 다시 받아 확인한 것이 아니다.
async function readTrue(bucket, path) {
  const doubts = [];
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
  } else if (ii.kind === 'invalid_key') {
    // 저장소가 그 이름 자체를 받지 않는다는 응답. 입력 오류의 표시이지 "객체 없음"의 증거가 아니다 — 그 이름에 객체가 없는지는 모른다.
    info.name_not_accepted = true;
    doubts.push('정보 조회가 "받지 않는 이름"(HTTP 400·statusCode 400·InvalidKey) 응답 — 객체 없음의 증거가 아니다');
  } else {
    doubts.push(`정보 조회가 끝나지 않았거나 관측된 "객체 없음" 모양이 아닌 응답(${ir.status} ${ii.body_statusCode ?? '-'} ${ii.body_code ?? '-'} ${ii.kind})`);
  }

  let list = null;
  let core = null;
  if (!doubts.length && info.present === false) {
    core = { exists: false };
  } else if (!doubts.length && info.present === true) {
    if (!info.object_id) doubts.push('정보 조회에 객체 식별자가 없음');
    else if (!info.etag || !MD5_RE.test(info.etag)) doubts.push(`정보 조회의 eTag 가 없거나 md5 모양이 아님(${info.etag ?? '없음'})`);
    else if (info.size == null) doubts.push('정보 조회에 크기가 없음');
    else {
      const i = path.lastIndexOf('/');
      const folder = i < 0 ? '' : path.slice(0, i);
      const name = i < 0 ? path : path.slice(i + 1);
      const lr = await listRaw('service', bucket, folder, name || undefined);
      list = { http_status: lr.status, cf_cache_status: lr.cf, returned: Array.isArray(lr.json) ? lr.json.length : null, found_same_id: null };
      if (!lr.ok || !Array.isArray(lr.json)) doubts.push(`목록 조회 실패(${lr.status} ${responseInfo(lr).kind})`);
      else {
        if (notDynamic(lr.cf)) doubts.push('목록: ' + notDynamic(lr.cf));
        const it = lr.json.find((x) => x.id != null && String(x.id) === info.object_id); // 이름이 아니라 식별자로 고른다
        list.found_same_id = !!it;
        if (it) {
          list.item_name = String(it.name);
          list.etag = normEtag(it.metadata?.eTag);
          list.size = it.metadata?.size ?? null;
          list.mimetype = it.metadata?.mimetype != null ? String(it.metadata.mimetype).toLowerCase() : null;
          list.created_at = it.created_at ?? null;
          list.updated_at = it.updated_at ?? null;
          if (list.etag !== info.etag) doubts.push(`목록의 eTag(${list.etag})와 정보 조회의 eTag(${info.etag})가 어긋남`);
          else if (list.size == null || Number(list.size) !== Number(info.size)) doubts.push(`목록의 크기(${list.size})와 정보 조회의 크기(${info.size})가 어긋남`);
          else if (list.mimetype && info.content_type && list.mimetype !== info.content_type) doubts.push(`목록의 형식(${list.mimetype})과 정보 조회의 형식(${info.content_type})이 어긋남`);
        }
      }
      // 목록 조회 자체가 실패했거나 DYNAMIC 이 아니거나 값이 어긋나면 위에서 미확인이 됐다. 여기까지 왔으면 정보 조회는 믿을 수 있다.
      if (!doubts.length) {
        const corroborated = list.found_same_id === true;
        if (!corroborated) noListCorroboration += 1;
        core = {
          exists: true, md5: info.etag, size: Number(info.size), content_type: info.content_type ?? null, object_id: info.object_id,
          created_at: corroborated ? list.created_at : null, updated_at: corroborated ? list.updated_at : null, list_corroborated: corroborated,
        };
      }
    }
  }
  return {
    name: path, known: !!core, ...(core ?? {}), unverified: core ? null : doubts.join(' / '), name_not_accepted: !!info.name_not_accepted,
    basis: '저장 정보(서비스 열쇠의 정보 조회 — 글자 그대로의 이름. 있으면 같은 식별자의 목록 항목과 대조)',
    info, list,
  };
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
// 목록 조회로 훑은 객체 식별자 한 벌 — "어림"으로만 쓴다
//   목록은 객체의 전체 이름을 글자 그대로 가려 주지 못한다(실측: 소문자 폴더의 목록에 대문자 폴더의 객체가 함께 나왔다).
//   그래서 이름이 아니라 식별자로 모으고, 이것으로 "어디에 도착했는가"나 "대상 밖 변화 0"을 정하지 않는다.
//   listed_as 는 "조회한 폴더 + 목록이 준 파일 이름"일 뿐 실제 전체 이름이 아닐 수 있다.
// ---------------------------------------------------------------------
async function listIds(bucket) {
  const ids = new Map();
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
          if (!ids.has(String(it.id))) ids.set(String(it.id), { listed_as: full, etag: normEtag(it.metadata?.eTag), size: it.metadata?.size ?? null, updated_at: it.updated_at ?? null });
        } else if (String(it.name) !== '') {
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
  return { bucket, ok: doubts.length === 0, doubts, ids };
}
async function listIdsAll() {
  const out = {};
  for (const b of BUCKETS) out[b] = await listIds(b);
  return out;
}
// 단계 전후의 목록(식별자)을 견줘 눈에 띄는 것을 적는다. 어림이다 — 이것이 비어 있어도 "대상 밖 변화 0"이 아니다.
function listingHint(before, after, ledger) {
  const mine = new Set(ledger.map((e) => e.object_id).filter(Boolean));
  const out = { listings_complete: true, doubts: [], new_ids_not_in_ledger: [], gone_ids: [], changed_ids: [] };
  for (const b of BUCKETS) {
    const A = before[b];
    const B = after[b];
    if (!A.ok || !B.ok) {
      out.listings_complete = false;
      out.doubts.push(...A.doubts, ...B.doubts);
    }
    for (const [id, m] of B.ids) {
      const p = A.ids.get(id);
      if (!p) {
        if (!mine.has(id)) out.new_ids_not_in_ledger.push({ bucket: b, id, listed_as: m.listed_as });
      } else if (!mine.has(id) && (p.etag !== m.etag || p.size !== m.size || p.updated_at !== m.updated_at)) out.changed_ids.push({ bucket: b, id, listed_as: m.listed_as });
    }
    for (const [id, m] of A.ids) if (!B.ids.has(id)) out.gone_ids.push({ bucket: b, id, listed_as: m.listed_as });
  }
  out.nothing_noticed = !out.new_ids_not_in_ledger.length && !out.gone_ids.length && !out.changed_ids.length;
  return out;
}
const snapshotAll = listIdsAll; // 다른 단계가 쓰는 이름

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
    con('score-c-upper-prefix', SCORE, '꾸밈: 대문자 EXAM-REG/<A>/<파일> — 저장소는 보낸 대소문자 그대로 저장한다(실측)', (t) => same(`EXAM-REG/${A}/${fileFor(t)}`), { arrival: 'as_sent' }),
    con('score-c-extra-folder', SCORE, '꾸밈: exam-reg/<A>/sub/<파일> — 폴더가 더 있음', (t) => same(`exam-reg/${A}/sub/${fileFor(t)}`)),
    con('score-c-member-case', SCORE, '꾸밈: exam-reg/<A 의 대소문자를 바꾼 번호>/<파일> — 글자 그대로 비교하므로 거절이 기대값', (t) => same(`exam-reg/${AU}/${fileFor(t)}`),
      { arrival: 'as_sent', must: { member_a: 'not_stored' }, skip: AU === A ? 'A 의 회원번호에 영문자가 없어 대소문자를 바꿀 수 없다' : null }),
    con('score-c-empty-seg', SCORE, '꾸밈: exam-reg//<파일> — 빈 구간', (t) => same(`exam-reg//${fileFor(t)}`)),
    con('score-c-empty-seg2', SCORE, '꾸밈: exam-reg/<A>//<파일> — 빈 구간', (t) => same(`exam-reg/${A}//${fileFor(t)}`)),
    con('score-c-empty-file', SCORE, '꾸밈: exam-reg/<A>/ — 파일 이름이 빔(서비스 열쇠·비로그인에게는 이 이름의 객체가 만들어진다 — 기존 동작, 실측)', () => same(`exam-reg/${A}/`), { noTag: true, existing: { text: '파일 이름이 빈 경로가 서비스 열쇠·비로그인에게는 그 이름의 객체로 저장됨(기존 동작)', when: (cell) => (cell.actor === 'service' || cell.actor === 'anon') && (cell.class_key === 'control' || cell.class_key === 'allowed') } }),
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
    // 저장소가 한글 파일 이름을 받지 않는다(InvalidKey — 기존 동작, 실측. 공백이 없어도, 서비스 열쇠로도, 운영에서도 같았다).
    // 새 규칙은 한글을 막지 않는다. 이 줄은 모든 자격의 기대값이 "① 입력 오류"이고, 이 줄의 거절은 새 규칙의 성과가 아니다.
    con('board-c-korean', BOARD, '꾸밈: reviews/<한글·공백이 든 파일 이름> — 저장소가 받지 않는 이름(기존 동작). 새 규칙은 한글을 막지 않는다', (t) => {
      const f = `${runTs}_${MARK}_${t}_한글 이름.png`;
      return { raw: `reviews/${e(f)}`, literal: `reviews/${f}` };
    }, { expectInput: true, existing: { text: '저장소가 한글 이름을 받지 않음(기존 동작)', when: (cell) => cell.class_key === 'input' || cell.class_key === 'input_pending' } }),
    con('board-c-table-study', BOARD, '꾸밈: study_certifications/<파일> — 표 이름', (t) => same(`study_certifications/${fileFor(t)}`)),
    con('board-c-table-notices', BOARD, '꾸밈: notices/<파일> — 표 이름', (t) => same(`notices/${fileFor(t)}`)),
    con('board-c-table-appnotices', BOARD, '꾸밈: application_notices/<파일> — 표 이름', (t) => same(`application_notices/${fileFor(t)}`)),
    con('board-c-other-key', BOARD, '꾸밈: free/<파일> — 허용 밖의 키', (t) => same(`free/${fileFor(t)}`)),
    con('board-c-extra-seg', BOARD, '꾸밈: reviews/sub/<파일> — 구간이 하나 더', (t) => same(`reviews/sub/${fileFor(t)}`)),
    con('board-c-empty-seg', BOARD, '꾸밈: reviews//<파일> — 빈 구간', (t) => same(`reviews//${fileFor(t)}`)),
    con('board-c-upper', BOARD, '꾸밈: REVIEWS/<파일> — 대문자 키(저장소는 보낸 대소문자 그대로 저장한다 — 실측)', (t) => same(`REVIEWS/${fileFor(t)}`), { arrival: 'as_sent' }),
    con('board-c-dotdot', BOARD, '꾸밈: reviews/../notice/<파일> — ".." 로 관리자 게시판을 가리킴', (t) => same(`reviews/../notice/${fileFor(t)}`)),
    con('board-c-enc-slash', BOARD, '꾸밈: reviews%2F<파일> — 인코딩한 빗금', (t) => ({ raw: `reviews%2F${fileFor(t)}`, literal: `reviews/${fileFor(t)}` })),
    con('board-c-empty-file', BOARD, '꾸밈: reviews/ — 파일 이름이 빔(서비스 열쇠·비로그인에게는 이 이름의 객체가 만들어진다 — 기존 동작, 실측)', () => same('reviews/'), { noTag: true, existing: { text: '파일 이름이 빈 경로가 서비스 열쇠·비로그인에게는 그 이름의 객체로 저장됨(기존 동작)', when: (cell) => (cell.actor === 'service' || cell.actor === 'anon') && (cell.class_key === 'control' || cell.class_key === 'allowed') } }),
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
  const t = { cells: cells.length, with_expectation: 0, pass: 0, mismatch: 0, undetermined: 0, input_error_pending: 0, measured_only: 0, not_applicable: 0 };
  const byActor = {};
  for (const c of cells) {
    const a = (byActor[c.actor] ??= { pass: 0, mismatch: 0, undetermined: 0, input_error_pending: 0, measured_only: 0, not_applicable: 0 });
    let k;
    if (c.not_applicable) k = 'not_applicable';
    else if (c.pending_db_check) k = 'input_error_pending'; // "입력 오류 확인 / 저장 변화 검증 대기" — 통과에도 미확인에도 넣지 않는다
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
const tallyLine = (t) => `통과 ${t.pass} · 기대와 다름 ${t.mismatch} · 미확인 ${t.undetermined}${t.input_error_pending ? ' · 입력 오류 확인·저장 변화 검증 대기 ' + t.input_error_pending : ''} · 잰 값(기대값 없음) ${t.measured_only}${t.not_applicable ? ' · 해당 없음 ' + t.not_applicable : ''}`;
function expiringSoon(list) {
  const now = Math.floor(Date.now() / 1000);
  for (const a of list) if (jwtInfo[a] && jwtInfo[a].exp - now < 90) return a;
  return null;
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
//   도착한 이름은 글자 그대로 정한다: 올리기가 성공하면 응답의 Key(버킷/전체 이름)와 Id 를 근거로 삼고,
//   그 정확한 전체 이름에 대한 서비스 열쇠의 정보 조회가 준 식별자·저장 정보와 대조한다. 어긋나면 미확인이다.
//   거절된 요청에는 Key 가 없는 것이 정상이다. 거절 칸의 "저장 변화 0"은 그 요청 직후(정리 전)에 확인한다:
//   그 요청이 가리킨 정확한 이름과 꾸민 경로가 도착할 수 있는 후보 이름들의 정보 조회가 "객체 없음"이고,
//   그 줄의 대조 객체(서비스 열쇠가 줄 앞에서 만든 것)의 식별자·저장 정보가 그대로임. 못 하면 미확인이다.
//   목록 조회로 도착 위치를 정하지 않는다.
// ---------------------------------------------------------------------
function keyOfResponse(r) {
  const j = r.json && typeof r.json === 'object' && !Array.isArray(r.json) ? r.json : null;
  const Key = j?.Key != null ? String(j.Key) : null;
  const Id = j?.Id != null ? String(j.Id) : null;
  return Key || Id ? { Key, Id } : null;
}
// 성공한 올리기가 실제로 도착한 곳(글자 그대로)과 그 객체의 저장 정보
async function resolveArrival(bucket, r, bytes) {
  const key = keyOfResponse(r);
  if (!key || !key.Key || !key.Id) return { key, problem: '성공 응답에 Key 또는 Id 가 없음' };
  if (!key.Key.startsWith(`${bucket}/`)) return { key, problem: `응답의 Key 가 이 버킷으로 시작하지 않음(${key.Key})` };
  const name = key.Key.slice(bucket.length + 1); // 글자 그대로. 대소문자·끝의 빗금을 바꾸지 않는다
  const stored = await readTrue(bucket, name);
  return {
    key, name, id: key.Id, problem: null, stored,
    id_matches: stored.known && stored.exists ? stored.object_id === key.Id : null,
    stored_matches_upload: stateIs(stored, present(bytes)),
  };
}
// 실측에서 본 정리(빈 구간이 합쳐지고 "."·".." 이 풀림)를 흉내 낸 이름. 근거가 아니라 "없음을 확인할 이름"을 늘리는 데만 쓴다.
function normalizeName(name) {
  const trailing = name.endsWith('/');
  const out = [];
  for (const s of name.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/') + (trailing && out.length ? '/' : '');
}
const swapTag = (name, from, to) => name.replace(new RegExp(`${MARK}_${from}(?![a-z0-9])`), `${MARK}_${to}`);
// 거절된 요청이 저장됐다면 있었을 이름들: 적은 이름 그대로, 그것을 정리한 이름, 같은 입력의 서비스 열쇠 대조군이 실제로 도착한 이름(꼬리표만 이 칸의 것으로)
function candidateNames(cell, control) {
  const set = new Set([cell.literal, normalizeName(cell.literal)]);
  if (control?.arrival?.name) set.add(swapTag(control.arrival.name, control.tag, cell.tag));
  set.delete('');
  return [...set];
}
async function checkAbsent(bucket, names) {
  const out = [];
  for (const name of names) {
    const st = await readTrue(bucket, name);
    out.push({ name, known: st.known, exists: st.known ? st.exists : null, name_not_accepted: st.name_not_accepted, unverified: st.unverified, info_status: st.info.http_status, info_cf: st.info.cf_cache_status });
  }
  return out;
}
const allAbsent = (checks) => checks.length > 0 && checks.every((x) => x.known && x.exists === false);
const absentProblem = (checks) => {
  const there = checks.filter((x) => x.known && x.exists);
  if (there.length) return { kind: 'exists', text: there.map((x) => x.name).join(', ') };
  const unk = checks.filter((x) => !x.known && !x.name_not_accepted);
  if (unk.length || !checks.length) return { kind: 'unknown', text: unk.map((x) => `${x.name}: ${x.unverified}`).join(' / ') || '확인한 이름이 없음' };
  // 정보 조회가 "받지 않는 이름"인 이름이 있다: 다른 이름이 전부 "객체 없음"이어도 그 이름에 객체가 없는지는 모른다
  const na = checks.filter((x) => x.name_not_accepted);
  if (na.length) return { kind: 'not_accepted', text: `${na.map((x) => x.name).join(', ')}: 정보 조회가 "받지 않는 이름"(InvalidKey) 응답 — 객체 없음의 증거가 아니다` };
  return null;
};
// 견주기용: 실행·계정마다 달라지는 것(시각·꼬리표·회원번호)을 뺀 이름의 모양. 대소문자는 남긴다.
function shapeOfName(name) {
  if (name == null) return null;
  let s = String(name).replace(new RegExp(`\\d{10,}_${MARK}_[a-z0-9]+`, 'g'), '<파일>');
  for (const [id, label] of [[memberA, 'A'], [memberB, 'B'], [memberGM, 'GM']]) {
    if (!id) continue;
    s = s.split(id).join(`<${label}>`);
    if (id.toUpperCase() !== id) s = s.split(id.toUpperCase()).join(`<${label} 대문자>`);
  }
  return s;
}
// 대조 객체를 두는 폴더: 보통 경로는 그 폴더, 꾸민 경로는 그 버킷의 보통 폴더
const controlDirOf = (row) => (row.shape.kind === 'normal' ? row.shape.dir : row.bucket === SCORE ? `exam-reg/${memberA}` : row.bucket === BOARD ? 'reviews' : '');

// 올리기 한 칸의 공통 확인(대조 객체·도착·저장 변화 0). 문제가 있으면 그 말을, 없으면 null 을 돌려준다.
function arrivalProblem(cell, shared) {
  const a = cell.arrival;
  if (!a || a.problem) return ['unknown', `응답의 Key·Id 로 도착한 이름을 정하지 못함: ${a?.problem ?? '응답에 Key·Id 가 없음'}`];
  if (!a.stored.known) return ['unknown', `도착한 이름(${a.name})의 저장 정보 미확인: ${a.stored.unverified}`];
  if (!a.stored.exists) return ['bad', `성공 응답인데 응답의 Key 가 가리킨 이름(${a.name})에 객체가 없음`];
  if (!a.id_matches) return ['unknown', `응답의 Id(${a.id})와 정보 조회의 식별자(${a.stored.object_id})가 어긋남`];
  if (!a.stored_matches_upload) return ['bad', '도착한 객체의 저장 정보(eTag·크기·형식)가 올린 내용과 다름'];
  if (!shared) {
    // 이름이 칸마다 다른 줄: 서비스 열쇠의 첫 본문 GET 이 올린 내용과 같아야 한다
    if (!a.body || a.body.match === null) return ['unknown', `본문을 받지 못함: ${a.body?.http_status} ${a.body?.error?.kind ?? ''}`];
    if (a.body.match === false) return ['bad', '본문의 md5 가 올린 내용과 다름'];
  }
  return null;
}
function judgeNormalUpload(row, cell, control, rowCtl) {
  const c = ctxOf(cell.actor);
  const says = verdictWord(M.uploadNew(state, c, row.bucket, cell.literal, row.mode.upsert));
  cell.model_says = says;
  cell.expect = hasExpectation(cell.actor) ? says : null;
  const ri = cell.response;
  let o;
  if (!rowCtl.ok) o = `undetermined(이 줄의 대조 객체를 만들지 못했거나 확인하지 못함: ${rowCtl.why})`;
  else if (!cell.control_after?.known) o = `undetermined(대조 객체의 저장 정보 미확인: ${doubtOf(cell.control_after)})`;
  else if (!cell.control_unchanged) o = 'anomaly(대조 객체가 바뀜)';
  else if (cell.request_ok) {
    const p = arrivalProblem(cell, false);
    if (p) o = `${p[0] === 'unknown' ? 'undetermined' : 'anomaly'}(${p[1]})`;
    else if (cell.arrival.name !== cell.literal) o = `anomaly(보낸 이름과 다른 이름에 저장됨: ${cell.arrival.name})`;
    else o = 'allow';
  } else {
    const ap = absentProblem(cell.absent_checks ?? []);
    if (inconclusive(ri.kind)) o = `undetermined(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`;
    else if (ap?.kind === 'exists') o = `anomaly(거절 응답인데 객체가 있음: ${ap.text})`;
    else if (ap) o = `undetermined(저장 변화 0을 확인하지 못함: ${ap.text})`;
    else if (!DENY_KINDS.upload.includes(ri.kind)) o = `undetermined(권한 오류의 관측된 모양이 아닌 거절: ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.kind})`;
    else if (cell.actor !== 'service' && !(control && control.observed === 'allow')) o = 'undetermined(권한 미판정 — 같은 입력의 서비스 열쇠 대조군이 성공하지 못함)';
    else o = 'deny';
  }
  cell.observed = o;
  cell.pass = cell.expect == null ? null : o === cell.expect ? true : o.startsWith('undetermined') ? null : false;
}
const CLASS = {
  input: '① 입력 오류(저장소가 이름 자체를 받지 않음)',
  denied: '② 권한 거절(경로는 유효하지만 그 자격에 권한이 없음 — 저장 변화 없음)',
  allowed: '③ 허용된 경로로 저장됨',
  outside: '④ 권한 밖 위치에 실제로 저장됨(실패)',
  control: '저장됨(서비스 열쇠 — 대조군)',
};
const PENDING = '① 입력 오류 확인 / 저장 변화 검증 대기';
function judgeContrivedUpload(row, cell, control, rowCtl) {
  const c = ctxOf(cell.actor);
  const ri = cell.response;
  const shared = !!row.shape.noTag;
  cell.model_says_for_name_as_sent = verdictWord(M.uploadNew(state, c, row.bucket, cell.literal, row.mode.upsert));
  const must = row.shape.must?.[cell.actor] ?? null;
  const asSent = row.shape.arrival === 'as_sent';
  // 저장소가 받지 않는 이름으로 확인된 줄(한글 파일 이름): 모든 자격의 기대값이 "① 입력 오류"다(비로그인도). 관측은 observed 에 따로 적는다.
  const expectInput = !!row.shape.expectInput;
  cell.expect = expectInput ? '① 입력 오류(저장소가 받지 않는 이름 — 기존 동작)'
    : hasExpectation(cell.actor)
      ? (cell.actor === 'service' ? (asSent ? '보낸 글자 그대로 저장됨' : '저장됨 또는 ①') : must === 'not_stored' ? '① 또는 ②(저장되지 않음)' : '①·②·③ 중 하나(④가 아님)')
      : null;
  let cls;
  let key;
  if (!rowCtl.ok) [key, cls] = ['unknown', `미확인(이 줄의 대조 객체를 만들지 못했거나 확인하지 못함: ${rowCtl.why})`];
  else if (cell.start_not_clean) [key, cls] = ['unknown', `미확인(요청 전에 그 이름이 비어 있음을 확인하지 못함: ${cell.start_not_clean})`];
  else if (!cell.control_after?.known) [key, cls] = ['unknown', `미확인(대조 객체의 저장 정보 미확인: ${doubtOf(cell.control_after)})`];
  else if (!cell.control_unchanged) [key, cls] = ['bad', '이상(대조 객체가 바뀜)'];
  else if (cell.request_ok) {
    const p = arrivalProblem(cell, shared);
    cell.arrived_full_name = cell.arrival?.name ?? null; // 저장소에 실제로 도착한 전체 이름(응답의 Key, 글자 그대로)
    if (p) [key, cls] = [p[0], `${p[0] === 'unknown' ? '미확인' : '이상'}(${p[1]})`];
    else if (shared && cell.removed_after_inspect && !cell.removed_after_inspect.verified_absent) [key, cls] = ['unknown', '미확인(살핀 뒤 그 객체를 지웠는지 확인하지 못함 — 같은 이름을 쓰는 다음 칸을 믿을 수 없다)'];
    else if (cell.actor === 'service') {
      if (asSent && cell.arrival.name !== cell.literal) [key, cls] = ['bad', `이상(보낸 글자 그대로 저장되지 않음: ${cell.arrival.name})`];
      else [key, cls] = ['control', CLASS.control];
    } else if (M.uploadNew(state, c, row.bucket, cell.arrival.name, row.mode.upsert)) [key, cls] = ['allowed', CLASS.allowed]; // 글자 그대로의 도착 이름으로 가른다
    else [key, cls] = ['outside', CLASS.outside];
  } else {
    const ap = absentProblem(cell.absent_checks ?? []);
    // "받지 않는 이름": 관측된 모양(HTTP 400·statusCode 400·InvalidKey) 하나만 인정한다. 다른 400 은 미확인이다.
    const notAccepted = ri.kind === 'invalid_key';
    const controlNotAccepted = cell.actor === 'service' ? notAccepted : control?.response?.kind === 'invalid_key';
    const sig = `${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.body_code ?? ''} ${ri.kind}`;
    if (inconclusive(ri.kind)) [key, cls] = ['unknown', `미확인(요청이 끝나지 않았거나 서버 오류·자격 자체의 거절: ${ri.kind})`];
    else if (ap?.kind === 'exists') [key, cls] = ['bad', `이상(거절 응답인데 객체가 있음: ${ap.text})`];
    else if (ap?.kind === 'unknown') [key, cls] = ['unknown', `미확인(저장 변화 0을 확인하지 못함: ${ap.text})`];
    else if (notAccepted) {
      // ① 로 적으려면 같은 입력의 서비스 열쇠 칸도 같은 모양이어야 한다
      if (!controlNotAccepted) [key, cls] = ['unknown', '미확인(이 자격만 "받지 않는 이름" 응답이고, 같은 입력의 서비스 열쇠 칸은 그 모양이 아님)'];
      // 그 이름의 정보 조회도 "받지 않는 이름"이면 그 이름에 객체가 없는지는 모른다 — 통과로 세지 않고 검증 대기로 둔다
      else if (ap?.kind === 'not_accepted') [key, cls] = ['input_pending', `${PENDING}(올리기 응답과 그 이름의 정보 조회가 둘 다 "받지 않는 이름"이다 — 그 이름에 객체가 없는지는 요청 단위 DB 대조로 확인한다)`];
      else [key, cls] = ['input', CLASS.input];
    } else if (ap?.kind === 'not_accepted') [key, cls] = ['unknown', `미확인(그 이름의 정보 조회는 "받지 않는 이름"인데 올리기 응답은 그 모양이 아님: ${sig})`];
    else if (cell.actor === 'service') {
      // 서비스 열쇠는 규칙을 거치지 않는다
      if (ri.kind === 'rls' || ri.kind === 'access_denied') [key, cls] = ['bad', '이상(서비스 열쇠인데 권한 오류)'];
      else if (asSent) [key, cls] = ['bad', `이상(보낸 글자 그대로 저장되는 것이 기대인데 저장소가 받지 않음: ${sig})`];
      else [key, cls] = ['unknown', `미확인(서비스 열쇠가 저장하지 못했는데 "받지 않는 이름"의 관측된 모양이 아닌 응답: ${sig})`];
    } else if (ri.kind === 'rls') {
      if (control && control.class_key === 'control') [key, cls] = ['denied', CLASS.denied];
      else if (controlNotAccepted) [key, cls] = ['unknown', '권한 미판정(같은 입력이 서비스 열쇠에게는 "받지 않는 이름"인데 이 자격에는 권한 오류가 옴 — 성공 대조군이 없어 권한 거절로 세지 않고, 응답이 달라 입력 오류로도 세지 않는다)'];
      else [key, cls] = ['unknown', '권한 미판정(같은 입력의 서비스 열쇠 대조군이 저장되지 않음)'];
    } else [key, cls] = ['unknown', `미확인(권한 오류도 "받지 않는 이름"도 아닌 거절: ${sig})`];
  }
  cell.class_key = key;
  cell.observed = cls;
  cell.pending_db_check = key === 'input_pending';
  if (cell.expect == null) cell.pass = null;
  else if (key === 'unknown' || key === 'input_pending') cell.pass = null;
  else if (key === 'bad' || key === 'outside') cell.pass = false;
  else if (expectInput) cell.pass = key === 'input';               // 저장됐거나 권한 거절이면 기대와 다름
  else if (must === 'not_stored') cell.pass = key === 'input' || key === 'denied';
  else if (cell.actor === 'service' && asSent) cell.pass = key === 'control';
  else cell.pass = true;
}

// --no-control: 요청 하나만 보낸다. 서비스 열쇠 대조군, 대조 객체, 저장 정보 읽기, 목록 조회를 전부 하지 않는다 — 이 실행이 보내는 요청은 올리기 한 건뿐이다.
// 판정하지 않는다. 브레인방이 이 요청의 직전과 직후(정리 전)에 뜬 fingerprint.sql 을 outside 단계(--result 없이)로 견준다.
async function singleUploadOnly(run, all) {
  const row = selectRows(all)[0];
  if (!row) stop(2, '그 줄이 없다(--rows·--bucket 을 확인할 것). 아무 요청도 보내지 않았다');
  if (row.shape.skip) stop(2, `그 줄은 잴 수 없다: ${row.shape.skip}. 아무 요청도 보내지 않았다`);
  const actor = actors[0];
  const tag = `u${row.no}${ACTOR_CODE[actor]}`;
  const bytes = makePng(`${run} ${row.id} ${actor} single`);
  const target = row.shape.make(tag);
  const r = row.shape.kind === 'normal' ? await upload(actor, row.bucket, target.name, bytes, { upsert: row.mode.upsert }) : await uploadRaw(actor, row.bucket, target.raw, bytes, { upsert: row.mode.upsert });
  const ri = responseInfo(r);
  say(`요청 하나만 보냄 — ${row.no}번 줄 · ${who(actor)} · 응답 ${ri.http_status}/${ri.body_statusCode ?? '-'} ${ri.body_code ?? ''} (${ri.kind ?? '성공'}). 판정하지 않는다 — 앞뒤의 fingerprint.sql 을 outside 로 견줄 것`);
  return {
    exit: 0,
    result: {
      state, single_request: true,
      note: '요청 하나(올리기)만 보냈다. 서비스 열쇠 대조군·대조 객체·저장 정보 읽기·목록 조회는 하지 않았다. 이 결과는 판정이 아니다 — 이 요청의 직전과 직후(정리 전)에 뜬 fingerprint.sql 을 node storage_matrix.mjs --phase outside --fingerprint-before <앞> --fingerprint-after <뒤> (--result 없이)로 견줘 "생긴 객체 0·없어진 객체 0·바뀐 객체 0"을 본다. 객체가 생겼다면 그 지문으로 cleanup 한다.',
      row: row.no, row_id: row.id, label: row.label, actor, request_mode: row.mode.id,
      sent_path: row.shape.kind === 'normal' ? target.name : target.raw, name_as_sent: row.shape.kind === 'normal' ? target.name : target.literal,
      uploaded: describe(bytes), response: ri, request_ok: r.ok, response_key: keyOfResponse(r),
    },
  };
}

async function phaseUploadNew(run) {
  const all = rowsUploadNew();
  if (noControl) return singleUploadOnly(run, all);
  const rows = selectRows(all).filter((r) => !r.shape.skip);
  const skipped = selectRows(all).filter((r) => r.shape.skip).map((r) => ({ row: r.id, why: r.shape.skip }));
  const cells = [];
  const ledger = [];
  let stopped = null;
  const before = await listIdsAll();
  const sharedBodies = new Map(); // 같은 이름을 여러 칸이 쓰는 경로: 버킷/이름 → 이 실행에서 그 이름에 올렸던 내용들의 md5(요청 방식이 다른 줄끼리도 이름이 같다)
  const order = ['service', ...actors.filter((a) => a !== 'service')]; // 대조군(서비스 열쇠)을 먼저 보낸다 — 그 도착 이름이 다른 칸의 "없음을 확인할 이름"이 된다
  let done = 0;
  for (const row of rows) {
    const soon = expiringSoon(actors);
    if (soon) {
      stopped = `${who(soon)} 의 자격이 90초 안에 끝난다 — ${row.no}번 줄 앞에서 멈춤(--rows ${row.no}-${all.length} 로 이어서 잰다)`;
      break;
    }
    const shared = !!row.shape.noTag; // 칸마다 이름을 다르게 할 수 없는 줄(파일 이름이 빈 경로)
    // 이 줄의 대조 객체: 서비스 열쇠가 줄 앞에서 만든다. 칸마다 요청 뒤에 그대로인지 읽는다.
    const ctlName = join(controlDirOf(row), fileFor(`u${row.no}ctl`));
    const ctlBytes = makePng(`${run} ${row.id} control`);
    const cu = await upload('service', row.bucket, ctlName, ctlBytes, { upsert: false });
    const ctlStart = await readTrue(row.bucket, ctlName);
    const rowCtl = { name: ctlName, start: ctlStart, ok: cu.ok && stateIs(ctlStart, present(ctlBytes)), why: cu.ok ? doubtOf(ctlStart) ?? '저장 정보가 올린 내용과 다름' : `올리기 ${cu.status} ${responseInfo(cu).kind}` };
    if (rowCtl.ok) ledger.push(ledgerEntry(row.bucket, ctlName, ctlStart, null, `${row.id} · 이 줄의 대조 객체(서비스 열쇠)`));

    const byActor = new Map();
    let controlCell = null;
    for (const actor of order) {
      const tag = `u${row.no}${ACTOR_CODE[actor]}`;
      const bytes = makePng(`${run} ${row.id} ${actor}`);
      const target = row.shape.make(tag);
      const literal = row.shape.kind === 'normal' ? target.name : target.literal;
      const cell = {
        row: row.no, row_id: row.id, bucket: row.bucket, shape: row.shape.id, path_kind: row.shape.kind, request_mode: row.mode.id, actor, tag,
        sent_path: row.shape.kind === 'normal' ? target.name : target.raw, literal, shares_name_with_other_cells: shared, uploaded: describe(bytes),
        control_path: ctlName, arrival: null,
      };
      byActor.set(actor, cell);
      if (actor === 'service') controlCell = cell;
      if (!rowCtl.ok) continue;
      if (shared) {
        // 같은 이름을 쓰는 줄: 요청 전에 그 이름(과 후보 이름)이 비어 있어야 한다(앞 칸의 것은 살핀 뒤 지웠다)
        const pre = await checkAbsent(row.bucket, candidateNames(cell, controlCell === cell ? null : controlCell));
        cell.shared_name_start = pre;
        const ap = absentProblem(pre);
        if (ap) {
          cell.start_not_clean = ap.kind === 'exists' ? `이미 객체가 있음(${ap.text}) — 앞 실행의 것이면 cleanup 뒤 다시 잰다` : ap.text;
          continue;
        }
      }
      const r = row.shape.kind === 'normal' ? await upload(actor, row.bucket, target.name, bytes, { upsert: row.mode.upsert }) : await uploadRaw(actor, row.bucket, target.raw, bytes, { upsert: row.mode.upsert });
      cell.response = responseInfo(r);
      cell.request_ok = r.ok;
      cell.response_key = keyOfResponse(r); // 거절된 요청에는 없는 것이 정상이다
      if (r.ok) {
        const a = await resolveArrival(row.bucket, r, bytes);
        cell.arrival = a;
        if (!a.problem && a.stored_matches_upload && a.id_matches) {
          // 본문 GET: 서비스 열쇠, 값 없는 인증 주소. 이름이 칸마다 다른 줄에서는 이 객체의 첫 읽기다(판정에 든다).
          // 같은 이름을 쓰는 줄에서는 앞 칸 때 같은 주소를 이미 읽었을 수 있다 — 결과를 관측으로 따로 적는다.
          const b = await firstBodyByService(row.bucket, a.name, bytes);
          a.body = b;
          a.body_observation = {
            is: b.match === true ? '올린 내용' : b.match === null ? '본문 없음' : (sharedBodies.get(`${row.bucket}/${a.name}`) ?? []).includes(b.body_md5) ? '옛 본문의 재전달(이 실행의 앞 칸이 같은 이름에 올렸던 내용)' : '그 밖(이 실행이 그 이름에 올린 적 없는 내용 — 앞 실행 때 전달된 본문일 수 있다)',
            http_status: b.http_status, cf_cache_status: b.cf_cache_status, age: b.age,
            used_for_verdict: !shared,
          };
        }
      } else {
        // 거절: 저장 변화 0 을 이 요청 직후에 확인한다(정확한 이름과 후보 이름들의 정보 조회가 "객체 없음")
        cell.absent_checks = await checkAbsent(row.bucket, candidateNames(cell, controlCell === cell ? null : controlCell));
      }
      cell.control_after = await readTrue(row.bucket, ctlName);
      cell.control_unchanged = sameObject(rowCtl.start, cell.control_after);
      if (shared && r.ok) {
        const a = cell.arrival;
        if (a && !a.problem) sharedBodies.set(`${row.bucket}/${a.name}`, [...(sharedBodies.get(`${row.bucket}/${a.name}`) ?? []), md5(bytes)]);
        if (a && !a.problem && a.stored.known && a.stored.exists) {
          // 살핀 뒤 정확한 이름으로 지워, 같은 이름을 쓰는 다음 칸이 빈 상태에서 시작하게 한다
          await removeMany(row.bucket, [a.name]);
          const gone = await readTrue(row.bucket, a.name);
          cell.removed_after_inspect = { name: a.name, object_id: a.id, verified_absent: gone.known && gone.exists === false };
        }
      }
    }
    const judge = row.shape.kind === 'normal' ? judgeNormalUpload : judgeContrivedUpload;
    judge(row, controlCell, null, rowCtl);
    for (const cell of byActor.values()) if (cell !== controlCell) judge(row, cell, controlCell, rowCtl);
    const rowCells = actors.map((a) => byActor.get(a));
    for (const cell of rowCells) {
      const a = cell.arrival;
      cell.remaining_allowance = !!row.shape.remaining;
      if (row.shape.existing?.when(cell)) cell.existing_behavior = row.shape.existing.text; // 저장소의 기존 동작(새 규칙과 무관)
      cell.cmp = {
        observed: row.shape.kind === 'normal' ? String(cell.observed).replace(/\(.*$/s, '') : cell.class_key,
        response: respSig(cell.response ?? null),
        stored: !!(a && !a.problem && a.stored?.known && a.stored.exists),
        arrived_shape: a && !a.problem ? shapeOfName(a.name) : null,   // 글자 그대로의 도착 이름(시각·꼬리표·회원번호만 가림)
        as_sent: a && !a.problem ? a.name === cell.literal : null,
      };
      if (a && !a.problem && a.stored?.known && a.stored.exists && !cell.removed_after_inspect) {
        ledger.push(ledgerEntry(row.bucket, a.name, a.stored, ownerOf(cell.actor), `${row.id} · ${cell.actor} 가 올림`));
      }
      cells.push(cell);
    }
    done += 1;
    say(`upload-new ${done}/${rows.length} (${row.no}번 줄) — ${row.label} — ${tallyLine(tally(rowCells))}`);
  }
  const after = await listIdsAll();
  return finishMeasure({ rows, cells, ledger, before, after, stopped, extra: { skipped_rows: skipped } });
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

// 실측 단계의 마무리: 셈, 표, 목록으로 본 어림
//   "대상 밖 객체의 변화 0"은 여기서 말하지 않는다. 그것은 단계 앞뒤로 뜬 fingerprint.sql 결과를 outside 단계에 넘겨 확인한다.
function finishMeasure({ rows, cells, ledger, before, after, stopped, extra }) {
  const hint = listingHint(before, after, ledger);
  const summary = tally(cells);
  const table = {};
  const labels = new Map(rows.map((r) => [r.id, r.label]));
  for (const c of cells) {
    const mark = c.not_applicable ? '해당 없음' : c.expect == null ? `(잰 값) ${c.observed}` : `${c.expect} → ${c.observed}${c.pass === true ? '' : c.pass === false ? '  ✗' : '  ?'}`;
    (table[`${String(c.row).padStart(3, '0')} ${labels.get(c.row_id) ?? c.row_id}`] ??= {})[c.actor] = mark;
  }
  const bad = summary.mismatch > 0 || summary.undetermined > 0;
  if (!hint.nothing_noticed) say(`목록으로 본 어림에 눈에 띄는 것이 있다 — 장부에 없는 새 식별자 ${hint.new_ids_not_in_ledger.length}, 없어진 식별자 ${hint.gone_ids.length}, 바뀐 식별자 ${hint.changed_ids.length}. fingerprint.sql 을 떠서 --phase outside 로 확인할 것`);
  // 비로그인처럼 기대값 없이 잰 칸 중, 도착 이름이나 저장 여부를 확인하지 못한 칸(기준선으로 쓸 수 없다)
  const measuredUnverified = cells.filter((c) => c.expect == null && !c.not_applicable && !c.pending_db_check && /^(undetermined|anomaly|미확인|권한 미판정|이상)/.test(String(c.observed)));
  // "입력 오류 확인 / 저장 변화 검증 대기": 올리기 응답도, 그 이름의 정보 조회도 "받지 않는 이름"이라 그 이름에 객체가 없는지를 이 도구가 확인하지 못한 칸
  const pending = cells.filter((c) => c.pending_db_check);
  if (pending.length) say(`검증 대기 ${pending.length}칸 — DB 대조가 끝나야 확인됨(이 갈래만 남으면 종료 값은 0 이지만 "전부 확인됨"이 아니다)`);
  return {
    exit: stopped ? 3 : bad || measuredUnverified.length ? 1 : 0,
    result: {
      state, stopped,
      summary,
      measured_cells_unverified: measuredUnverified.map((c) => ({ row_id: c.row_id, actor: c.actor, observed: c.observed })),
      input_error_pending_note: pending.length
        ? `검증 대기 ${pending.length}칸 — DB 대조가 끝나야 확인됨. 이 칸들은 통과 수에도 미확인 수에도 들어 있지 않다. 칸마다 그 요청 하나만 다시 보내고(--no-control) 앞뒤의 fingerprint.sql 을 outside 단계(--result 없이)로 견줘 "생긴 객체 0·없어진 객체 0·바뀐 객체 0"을 확인한다.`
        : null,
      input_error_cells: pending.map((c) => ({
        row: c.row, row_id: c.row_id, actor: c.actor, request_mode: c.request_mode, sent_path: c.sent_path, name_as_sent: c.literal,
        upload_response: respSig(c.response), info_lookups: (c.absent_checks ?? []).map((x) => ({ name: x.name, result: x.name_not_accepted ? '받지 않는 이름(InvalidKey)' : x.known ? (x.exists ? '객체 있음' : '객체 없음') : '미확인' })),
        how_to_verify: `fingerprint.sql → node storage_matrix.mjs --phase upload-new --state ${state} --rows ${c.row} --actors ${c.actor} --no-control --out <파일> → fingerprint.sql → node storage_matrix.mjs --phase outside --fingerprint-before <앞> --fingerprint-after <뒤>`,
      })),
      existing_behaviors: cells.filter((c) => c.existing_behavior).map((c) => `${c.row_id} · ${c.actor}: ${c.existing_behavior}`),
      existing_behaviors_note: '저장소의 기존 동작으로 적는 것이다(새 규칙과 무관). 이 줄들의 거절·저장을 새 규칙의 성과로 세지 않는다.',
      outside_objects: {
        verified: false,
        how_to_verify: '이 단계 앞과 뒤에 fingerprint.sql 을 떠서: node storage_matrix.mjs --phase outside --result <이 결과 파일> --fingerprint-before <앞> --fingerprint-after <뒤>. DB 의 객체 행(정확한 이름·식별자)으로 본다. 그 비교는 단계가 끝났을 때 남은 변화만 본다 — 거절 칸 하나하나의 "저장 변화 0"은 칸마다 요청 직후에 확인했다(absent_checks·control_unchanged, 또는 대상·대조·도착지의 저장 정보).',
        listing_hint: hint,
        listing_hint_note: '목록 조회로 본 어림이다. 목록은 전체 이름을 글자 그대로 가려 주지 못하므로(실측) 식별자로만 견줬다. 이 값이 비어 있어도 "대상 밖 변화 0"이 아니다.',
      },
      reads_without_list_corroboration: noListCorroboration,
      fourth_class_cells: cells.filter((c) => c.class_key === 'outside').map((c) => `${c.row_id} · ${c.actor} → ${c.arrived_full_name}`),
      mismatches: cells.filter((c) => c.pass === false).map((c) => ({ row_id: c.row_id, actor: c.actor, expect: c.expect, observed: c.observed, response: c.response ?? null })),
      undetermined: cells.filter((c) => c.expect != null && c.pass === null && !c.not_applicable && !c.pending_db_check).map((c) => ({ row_id: c.row_id, actor: c.actor, expect: c.expect, observed: c.observed })),
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
        cellsOut[a] = r.shape.expectInput ? '① 입력 오류(저장소가 받지 않는 이름 — 기존 동작. 그 이름의 정보 조회도 받지 않는 이름이면 "검증 대기")' : r.shape.kind === 'normal'
          ? cellExp(a, (c) => exp(M.uploadNew(state, c, r.bucket, literal, r.mode.upsert)))
          : hasExpectation(a) ? (a === 'service' ? (r.shape.arrival === 'as_sent' ? '보낸 글자 그대로 저장됨' : '저장됨 또는 ①') : r.shape.must?.[a] === 'not_stored' ? '① 또는 ②(저장되지 않음)' : `①·②·③ 중 하나(④가 아님) — 적은 이름 그대로라면 ${exp(M.uploadNew(state, ctxOf(a), r.bucket, literal, r.mode.upsert))}`) : '(잰 값)';
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
  out.note = 'rough_requests 는 모든 자격으로 잴 때의 어림이다(2a 실행에서는 초당 12건쯤이었다). 비로그인 칸은 before·applied·rolledback 에서 기대값이 없다 — 잰 값을 compare 단계로 서로 견준다. 꾸민 경로의 기대값은 "전부 거절"이 아니다: 저장소가 이름을 어떻게 다루는지에 따라 ①·②·③이 될 수 있고, ④(권한 밖 위치에 저장)만 실패다. ③·④는 글자 그대로의 도착 이름(올리기 응답의 Key)으로 가른다. 대문자가 든 경로는 서비스 열쇠·비로그인에게 보낸 글자 그대로 저장되는 것이 실제 동작이다(실측).';
  for (const [g, v] of Object.entries(out.groups)) say(`plan ${g}: 줄 ${v.rows}, 칸 ${v.cells}, 요청 어림 ${v.rough_requests}`);
  return { exit: 0, result: out };
}

// ---------------------------------------------------------------------
// cleanup: 이 도구가 만든 합성 객체를 지운다
//   지울 객체의 "정확한 전체 이름"을 아는 길은 셋이다.
//     --fingerprint <fingerprint.sql 결과>   DB 의 객체 행(정확한 이름·식별자). 이름에 표식(zzb2n2b)이 있는 것을 지운다.
//                                            대소문자만 다른 폴더(EXAM-REG/…, REVIEWS/… 등)의 객체도 여기서 글자 그대로 나온다.
//     --ledger <결과 json>[,<json>…]         단계가 남긴 장부(정확한 이름·식별자). 표식 있는 것은 지우고,
//                                            표식 없는 이름(reviews/ 처럼 파일 이름이 빈 것)은 지금 그 이름의 객체 식별자가
//                                            장부와 같을 때만 지운다. 다르면 아무것도 지우지 않고 멈춘다(종료 값 4).
//     (인자 없음) 목록 조회                   표식 있는 이름을 찾는다. 어림이다 — 대소문자가 다른 폴더의 객체는 틀린 이름으로
//                                            나와 지워지지 않을 수 있다. 이것만으로는 "남은 것 0"을 말하지 않는다.
//   표식도 없고 장부에도 없는 객체는 지우지 않고 적는다.
// ---------------------------------------------------------------------
async function phaseCleanup() {
  const loadJson = async (p) => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
  let fp = null;
  if (args.fingerprint) {
    fp = await loadJson(args.fingerprint);
    if (Array.isArray(fp)) fp = fp[0];
    if (fp && fp.result) fp = fp.result;
    if (!Array.isArray(fp?.objects)) stop(2, '--fingerprint 파일에 objects 가 없다(fingerprint.sql 의 결과여야 한다)');
  }
  const ledgerEntries = [];
  if (args.ledger) {
    for (const p of args.ledger.split(',').map((s) => s.trim()).filter(Boolean)) ledgerEntries.push(...((await loadJson(p)).result?.ledger ?? []));
  }

  // 1) 지울 정확한 이름을 모은다(아직 아무것도 지우지 않는다)
  const exact = Object.fromEntries(BUCKETS.map((b) => [b, new Map()])); // 이름 → { id, source }
  const unmarkedInDb = [];
  for (const o of fp?.objects ?? []) {
    if (!BUCKETS.includes(o.bucket_id)) continue;
    if (String(o.name).includes(MARK)) exact[o.bucket_id].set(String(o.name), { id: o.id ?? null, source: 'fingerprint(표식)' });
    else unmarkedInDb.push({ bucket: o.bucket_id, name: String(o.name), id: o.id ?? null });
  }
  const conflicts = [];
  const unmarkedSeen = new Set();
  for (const e of ledgerEntries) {
    if (!BUCKETS.includes(e.bucket)) continue;
    if (String(e.name).includes(MARK)) {
      if (!exact[e.bucket].has(e.name)) exact[e.bucket].set(e.name, { id: e.object_id ?? null, source: '장부(표식)' });
      continue;
    }
    // 표식 없는 이름: 지금 그 이름의 객체가 장부의 그 객체일 때만
    const k = `${e.bucket}/${e.name}/${e.object_id}`;
    if (unmarkedSeen.has(k)) continue;
    unmarkedSeen.add(k);
    const st = await readTrue(e.bucket, e.name);
    if (!st.known) conflicts.push({ bucket: e.bucket, name: e.name, ledger_id: e.object_id, problem: `지금 상태를 확인하지 못함: ${st.unverified}` });
    else if (!st.exists) continue; // 이미 없다
    else if (e.object_id && st.object_id === e.object_id) exact[e.bucket].set(e.name, { id: st.object_id, source: '장부(표식 없음 — 식별자 일치)' });
    else conflicts.push({ bucket: e.bucket, name: e.name, ledger_id: e.object_id, current_id: st.object_id, problem: '지금 그 이름의 객체가 장부의 객체가 아니다(식별자가 다름)' });
  }
  if (conflicts.length) {
    say(`cleanup 멈춤: 표식 없는 이름 ${conflicts.length}건이 장부와 맞지 않는다. 아무것도 지우지 않았다`);
    return { exit: 4, result: { stopped: '표식 없는 이름의 객체가 장부의 객체와 다르다. 아무것도 지우지 않았다 — 무엇인지 확인하기 전에는 손대지 않는다', conflicts } };
  }

  // 2) 지운다. 정확한 이름을 아는 것은 그 이름으로, 그다음 목록으로 찾은 표식 있는 이름(어림)
  const report = {};
  for (const b of BUCKETS) {
    const names = [...exact[b].keys()];
    if (names.length) await removeMany(b, names);
    let listedDeleted = 0;
    const tried = new Set(names);
    for (let round = 0; round < 20; round += 1) {
      const s = await listIds(b);
      const more = [...s.ids.values()].map((m) => m.listed_as).filter((n) => n.includes(MARK) && !tried.has(n));
      if (!more.length) break;
      more.forEach((n) => tried.add(n));
      await removeMany(b, more);
      listedDeleted += more.length;
    }
    // 3) 정확한 이름마다 정보 조회로 "없음"을 확인한다
    const notGone = [];
    for (const n of names) {
      const st = await readTrue(b, n);
      if (!(st.known && st.exists === false)) notGone.push({ name: n, state: st.known ? '아직 있음' : `미확인: ${st.unverified}` });
    }
    const leftListing = [...(await listIds(b)).ids.entries()].map(([id, m]) => ({ id, listed_as: m.listed_as }));
    report[b] = {
      exact_names_deleted: names.length, exact_names_verified_absent: names.length - notGone.length, exact_names_not_gone: notGone,
      names_from_listing_tried: listedDeleted,
      left_by_listing: leftListing.length, left_by_listing_sample: leftListing.slice(0, 100),
    };
    say(`cleanup ${b}: 정확한 이름 ${names.length}건 지움(없음 확인 ${names.length - notGone.length}), 목록으로 찾아 지우려 한 이름 ${listedDeleted}건, 목록에 남은 것 ${leftListing.length}`);
  }
  const ledgerUnmarked = new Set(ledgerEntries.filter((e) => !String(e.name).includes(MARK)).map((e) => `${e.bucket}/${e.name}`));
  const unmarkedNotDeleted = unmarkedInDb.filter((o) => !exact[o.bucket].has(o.name)).map((o) => ({ ...o, in_ledger: ledgerUnmarked.has(`${o.bucket}/${o.name}`) }));
  const notGoneTotal = Object.values(report).reduce((s, r) => s + r.exact_names_not_gone.length, 0);
  const leftTotal = Object.values(report).reduce((s, r) => s + r.left_by_listing, 0);
  if (unmarkedNotDeleted.length) say(`cleanup: 표식 없는 객체 ${unmarkedNotDeleted.length}건은 지우지 않았다 — ${unmarkedNotDeleted.slice(0, 5).map((o) => `${o.bucket}/${o.name}`).join(', ')}`);
  if (!fp) say('cleanup: --fingerprint 없이 돌았다. 목록만으로는 대소문자가 다른 폴더의 객체를 빠뜨릴 수 있다 — "남은 것 0"이 확인된 것이 아니다');
  return {
    exit: notGoneTotal || leftTotal || unmarkedNotDeleted.length ? 1 : 0,
    result: {
      note: `정확한 이름(fingerprint.sql 의 객체 행이나 단계의 장부)을 아는 객체는 그 이름으로 지우고 이름마다 정보 조회로 "없음"을 확인한다. 표식(${MARK}) 없는 이름은 장부의 식별자가 지금 그 객체와 같을 때만 지운다. 목록 조회로 찾은 이름은 어림이다(대소문자가 다른 폴더의 객체는 틀린 이름으로 나와 지워지지 않을 수 있다). 남은 객체 0 의 확인은 정리 뒤에 다시 뜬 fingerprint.sql 의 object_counts 로 한다 — 이 도구의 집계만으로 0 이라고 적지 않는다. 지운 뒤에도 같은 주소의 본문 GET 은 한동안 옛 내용을 줄 수 있다(2a 관측).`,
      used: { fingerprint: !!fp, ledger_entries: ledgerEntries.length },
      verified_by: fp ? 'fingerprint.sql 의 정확한 이름마다 정보 조회로 없음을 확인(그 fingerprint 를 뜬 뒤에 생긴 객체는 모른다)' : '목록 조회만 — 확인이 아니다',
      nothing_left_as_far_as_known: !(notGoneTotal || leftTotal || unmarkedNotDeleted.length),
      unmarked_not_deleted: unmarkedNotDeleted,
      report,
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
// outside (요청 0): 단계 앞뒤로 뜬 fingerprint.sql 결과(DB 의 객체 행 — 정확한 이름·식별자)로 "대상 밖 객체의 변화"를 본다
//   --fingerprint-before <앞>  --fingerprint-after <뒤>  --result <그 사이에 돈 단계들의 결과 json>[,<json>…]
//   통과: 뒤에 새로 생긴 객체가 전부 장부에 있고(식별자와 버킷·전체 이름이 글자 그대로 같음), 장부의 객체가 전부 뒤에 있으며,
//         앞에 있던 객체가 없어지거나 바뀌지 않았다. 버킷을 가리지 않고 전부 본다.
//   이 비교는 단계가 끝났을 때 남은 변화만 본다(중간에 만들었다 지운 객체는 보지 못한다).
// ---------------------------------------------------------------------
async function phaseOutside() {
  if (!args['fingerprint-before'] || !args['fingerprint-after']) stop(2, 'outside 는 --fingerprint-before <json> --fingerprint-after <json> [--result <결과 json>[,<json>…]] 이 필요하다');
  // --result 가 없으면 장부 없이 두 지문만 견준다: 어떤 변화도 허용하지 않는다(생긴 객체·없어진 객체·바뀐 객체를 전부 센다).
  const strict = !args.result;
  const loadFp = async (p) => {
    let fp = JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
    if (Array.isArray(fp)) fp = fp[0];
    if (fp && fp.result) fp = fp.result;
    if (!Array.isArray(fp?.objects)) stop(2, `${p} 에 objects 가 없다(fingerprint.sql 의 결과여야 한다)`);
    return fp;
  };
  const A = await loadFp(args['fingerprint-before']);
  const B = await loadFp(args['fingerprint-after']);
  const ledger = new Map(); // 식별자 → 장부 줄
  const noId = [];
  const files = strict ? [] : args.result.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of files) {
    const f = JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
    for (const e of f.result?.ledger ?? []) {
      if (e.object_id) ledger.set(String(e.object_id), e);
      else noId.push(`${e.bucket}/${e.name}`);
    }
  }
  const key = (o) => `${o.bucket_id}/${o.name}`;
  const beforeById = new Map(A.objects.map((o) => [String(o.id), o]));
  const afterById = new Map(B.objects.map((o) => [String(o.id), o]));
  const unexplainedNew = [];
  const wrongName = [];
  const removed = [];
  const changed = [];
  const ledgerMissing = [];
  for (const [id, o] of afterById) {
    const was = beforeById.get(id);
    if (!was) {
      const e = ledger.get(id);
      if (!e) unexplainedNew.push({ object: key(o), id });
      else if (e.bucket !== o.bucket_id || e.name !== o.name) wrongName.push({ id, ledger: `${e.bucket}/${e.name}`, db: key(o), why: e.why }); // 글자 그대로 견준다
    } else if (key(was) !== key(o) || was.etag !== o.etag || was.size !== o.size || (was.mimetype ?? null) !== (o.mimetype ?? null) || (was.owner ?? null) !== (o.owner ?? null) || (was.owner_id ?? null) !== (o.owner_id ?? null) || was.created_at !== o.created_at || was.updated_at !== o.updated_at) {
      changed.push({ id, before: key(was), after: key(o), etag_same: was.etag === o.etag, owner_same: (was.owner_id ?? null) === (o.owner_id ?? null), updated_at_same: was.updated_at === o.updated_at });
    }
  }
  for (const [id, o] of beforeById) if (!afterById.has(id)) removed.push({ object: key(o), id });
  for (const [id, e] of ledger) if (!afterById.has(id)) ledgerMissing.push({ id, ledger: `${e.bucket}/${e.name}`, why: e.why });
  const ok = !unexplainedNew.length && !wrongName.length && !removed.length && !changed.length && !ledgerMissing.length && !noId.length;
  if (strict) console.log(`[b2n2b] outside(장부 없이 — 어떤 변화도 허용하지 않음): 앞 ${A.objects.length}개 → 뒤 ${B.objects.length}개 · 생긴 객체 ${unexplainedNew.length} · 없어진 객체 ${removed.length} · 바뀐 객체 ${changed.length} — ${ok ? '변화 0' : '변화 있음'}`);
  else console.log(`[b2n2b] outside: 앞 ${A.objects.length}개 → 뒤 ${B.objects.length}개, 장부 ${ledger.size}건 · 장부에 없는 새 객체 ${unexplainedNew.length} · 이름이 장부와 다른 객체 ${wrongName.length} · 없어진 객체 ${removed.length} · 바뀐 객체 ${changed.length} · 장부에는 있는데 DB 에 없는 것 ${ledgerMissing.length} — ${ok ? '대상 밖 변화 0' : '확인 필요'}`);
  for (const d of [...unexplainedNew, ...wrongName, ...removed, ...changed, ...ledgerMissing].slice(0, 20)) console.log('  ' + JSON.stringify(d));
  return {
    exit: ok ? 0 : 1,
    result: {
      outside_change_zero: ok,
      mode: strict ? '장부 없이 두 지문만 견줌 — 생긴 객체·없어진 객체·바뀐 객체를 전부 변화로 센다(요청 하나의 앞뒤를 볼 때 쓴다)' : '장부와 견줌 — 장부에 있는 새 객체는 이 도구가 만든 것으로 본다',
      created: strict ? unexplainedNew : undefined,
      objects_before: A.objects.length, objects_after: B.objects.length, ledger_objects: ledger.size, results_used: files,
      unexplained_new: unexplainedNew, name_differs_from_ledger: wrongName, removed, changed, in_ledger_but_not_in_db: ledgerMissing, ledger_entries_without_id: noId,
      note: 'DB 의 객체 행(fingerprint.sql 의 objects — 정확한 이름·식별자·소유자)으로 견줬다. 두 fingerprint 사이에 돈 단계의 결과 파일을 전부 --result 에 줘야 한다(빠뜨리면 그 단계의 객체가 "장부에 없는 새 객체"로 나온다). 단계가 끝났을 때 남은 변화만 본다 — 중간에 만들었다 지운 객체(같은 이름을 쓰는 줄의 객체, 삭제·이동 칸의 대상)는 보지 못한다. 소유자가 기대와 같은지는 owners 단계가 본다.',
    },
  };
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
  else if (phase === 'outside') res = await phaseOutside();
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
    how_read: '도착한 이름은 올리기 응답의 Key(버킷/전체 이름)와 Id 로 글자 그대로 정하고, 그 정확한 이름에 대한 서비스 열쇠의 정보 조회가 준 식별자·저장 정보와 대조한다. 있음·없음은 글자 그대로의 정보 조회로 읽는다(DYNAMIC 일 때만 인정, eTag 를 올린 내용의 md5 와 대조, "객체 없음"은 관측된 모양 — HTTP 400·statusCode 404·code NoSuchKey — 만 인정). 목록 조회는 이름을 정하는 데 쓰지 않는다(실측: 소문자 폴더의 목록에 대문자 폴더의 객체가 함께 나왔다). 이것은 저장 정보이지 본문의 재확인이 아니다 — 새로 생긴 객체의 본문은 서비스 열쇠의 본문 GET(값 없는 인증 주소)으로 따로 견준다. 대상 밖 객체의 변화는 이 결과가 말하지 않는다(outside 단계). 미확인은 통과에 넣지 않는다.',
    exit_code: res.exit,
    result: res.result,
  };
  if (outPath) await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

  const s = res.result?.summary;
  console.log(`[b2n2b] phase=${phase}${state ? ' state=' + state : ''}${kind ? ' kind=' + kind : ''}${step ? ' step=' + step : ''} 요청 ${requestCount}건${s ? ` — ${tallyLine(s)}` : ''}${res.result?.stopped ? ' — 멈춤: ' + res.result.stopped : ''}`);
  if (outPath) console.log(`[b2n2b] 결과: ${outPath}`);
  if (res.result?.input_error_cells?.length) console.log(`[b2n2b] 검증 대기 ${res.result.input_error_cells.length}칸 — DB 대조가 끝나야 확인됨(result.input_error_cells)`);
  process.exit(res.exit);
}

main().catch((e) => {
  console.error(`[b2n2b] 실행 중 멈춤: ${e?.message ?? e}`);
  console.error('[b2n2b] 합성 객체가 남아 있을 수 있다. --phase cleanup 으로 지우고 fingerprint.sql 의 object_counts 로 확인한다.');
  console.error('[b2n2b] 보낸 요청 수: ' + requestCount);
  process.exit(3);
});
