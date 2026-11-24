#!/usr/bin/env node
// =====================================================================
// 보안작업 묶음 2 — 계약 3C-DB "본인 설정" 함수 다섯의 대조표 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
// (3-0 의 profile_matrix.mjs 를 본떴다. 다른 것: 함수가 다섯이고 그 가운데 셋이 회원 행을 고친다 — 그래서
//  "앞뒤 불변" 대신 "바뀐 열이 정확히 기대한 열뿐인가"를 본다.)
//
// 이 도구는 작업방이 실제 API 에 돌려 본 적이 없다(가짜 응답으로만 돌려 봤다 — 가짜 응답은 실제 동작을 대신하지 않는다).
// 보내는 요청은 POST·GET·HEAD  <주소>/rest/v1/rpc/<함수 다섯 가운데 하나> 뿐이다.
// **쓰기 함수의 유효한 POST 는 합성 회원의 설정 열을 실제로 고친다**(본인 행의 그 열만 — 그것이 재는 대상이다).
// 열쇠·자격은 머리글로만 실리고 결과·화면에 적지 않는다(결과에는 자격 안의 식별값 sub·session_id·aal 만).
// 결과 파일에 응답 본문을 적지 않는다. 적는 것: 상태 코드 · code · 응답의 키 · Cache-Control · state · 판정 · 문제,
//   그리고 효과 대조에 쓰는 값 셋(도구가 보낸 종류 값, 서버가 돌려준 동의 시각, 보관 답변의 sha256).
//
// 단계(--phase)                                                                                  요청
//   start-check     시작 지문(--fingerprint)이 이번 시작 기준과 같은가: 함수 다섯 없음 · my_profile 이 3-0 의 끝 상태     0
//                   (본문 md5 ea1fd98d…) · 공통 확인 설정 없음 · 점검 normal · 예외 0 · 합성 행 0. 다르면 종료 값 3
//   end-check       끝 확인을 한 표로: --p-start --p-end --g-start --g-end --leftover [--s-start --s-end] [--ignore 키,…]   0
//   plan            그 상태(--state)의 칸과 기대값을 적는다                                         0
//   sessions-sql    환경 변수의 로그인 자격들의 로그인 기록이 살아 있는지 읽는 SQL 을 적는다           0
//   absent          적용 전 기준: 다섯 RPC 가 "등록되지 않은 함수"로 응답하는가                        있음
//                   (--fingerprint 가 "DB 카탈로그에 그 함수들이 없음"을 함께 보여야 통과)
//   matrix          대조표: 함수 5 × 자격 12 × 요청(POST·GET·HEAD) + 쓰기 뒤 다시 읽기 + 인자를 붙인 요청   있음(쓰기 있음)
//                   --state normal | normal-hook | maint | maint-hook      --rows <재기 직전의 rows_md5.sql 결과>
//   effect          쓰기의 효과: --step track | consent | hold | bounds | rejects | coercion | race     있음(쓰기 있음)
//   variants        저장된 답변의 모양별 읽기: --round 1~6  --variant <answers_variant.sql 의 결과>   있음(읽기만)
//   revoked         --kind expired|loggedout  --step pre|post|restored   JWT 는 유효한데 로그인 기록이 끝난 경우   있음
//                   --kind jwt-expired  --step pre|post [--pre <pre 결과>]  JWT 자체가 만료된 경우(같은 JWT 로 한 쌍)
//   rows-effect     쓰기 단계의 앞뒤에 뜬 rows_md5.sql 결과 둘과 그 단계의 결과를 견준다                  0
//                   --before <앞> --after <뒤> --result <matrix·effect·variants·revoked 의 결과>
//                   바뀐 열이 정확히 기대한 열뿐인가, 저장된 값이 응답과 같은가, 동의 시각이 앞뒤 DB 시각 사이인가,
//                   다른 회원의 행·전체 회원 수·대응표·명부가 그대로인가
//   compare         지문 결과 둘을 견준다(--a --b, read_at 은 빼고. --ignore 로 더 뺄 키를 적는다)      0
//   body-md5        마이그레이션 파일의 함수 다섯의 본문 md5 를 계산한다                                0
//   set-lines       SQL 파일 앞에 둘 set 줄을 저장해 둔 파일에서 글자 그대로 만들어 적는다               0
//                   --for fixtures-up --accounts <json: {"a":{"id":"<계정 번호>","email":"<로그인 이메일>"}, … 여덟}>
//                       (계정 번호와, 계정을 만들 때 받은 로그인 이메일을 함께. 이메일에 합성 표식 zzb3c 가 있어야 한다)
//                   --for fixtures-reset | fixtures-down | leftover-check --expect <json>
//                   --for answers-variant --expect <json> --round <1~6>
//                   --for maint-on  --expect <json> --snapshot <켜기 전의 state_snapshot 결과>
//                   --for maint-off --expect <json> --snapshot <켜기 전의 state_snapshot 결과> --on <maint_on.sql 의 결과>
//                   --for rollback --fingerprint <적용 직후의 지문>
//                       (지문의 본문 md5 가 파일에서 계산한 값과 다르면 줄을 만들지 않고 멈춘다 — 종료 값 3. 스스로 맞추지 않는다)
//                   --for session-expire --expect <json> --sessions-sql <sessions-sql 결과> --not-after-before <값|null>
//                   --for session-restore --expect <json> --expired <session_expire.sql 결과>
//
// 공통 인자
//   --expect <json>          fixtures_up.sql 의 마지막 결과(합성 계정별 회원 값·설정의 처음 값·기대 상태).
//                            회원 표 비밀번호 열의 원문은 들어 있지 않다(접두사가 있다는 사실과 sha256 만). 원문이 든 파일은 받지 않는다
//   --fingerprint <json>     재기 직전에 뜬 이 폴더의 fingerprint.sql 결과. 도구는 상태를 스스로 알 수 없다 —
//                            이 파일로 함수의 존재·실행 권한·점검 상태·공통 확인 설정이 --state 와 맞는지 보고,
//                            맞지 않으면 요청을 보내지 않는다(종료 값 3). 30분보다 오래된 파일은 받지 않는다
//   --sessions-alive <json>  sessions-sql 의 SQL 을 재기 직전에 실행한 결과(30분 안)
//   --rows <json>            재기 직전에 뜬 rows_md5.sql 결과(30분 안). 읽기의 기대값은 이 파일의 "지금 저장된 값"이다
//   --out <json>             결과 파일
//   --actors a,b,…           일부 자격만(matrix)
// 환경 변수
//   B3C_URL            정확히 https://hmncdheiwqwekdbtijar.supabase.co
//   B3C_ANON_KEY / B3C_SERVICE_KEY
//   B3C_JWT_A · _B · _N · _G1 · _G2 · _GM1 · _GM2 · _BLK · _WD · _BW      대조표의 로그인 자격
//   B3C_JWT_A_EXP · _A_OUT · _A_OLD      A 의 다른 로그인: 만료용 · 로그아웃용 · JWT 만료용(revoked 단계)
//   ※ 자격 원문은 환경 변수로만 둔다. 파일에 쓰지 않는다(JWT 만료 쌍을 기다리는 60분 동안에도).
//
// 판정
//   통과    기대값과 전부 같다(상태 코드, 응답의 키 집합이 정확히 같음, 값, Cache-Control, 금지 키·금지 값 없음)
//   기대와 다름   응답은 왔는데 하나라도 다르다
//   미확인  네트워크 오류·시간 초과·429·기대하지 않은 5xx — 성공으로도 실패로도 세지 않는다
//   금지 값 = 합성 회원 전원(함정 행 포함)의 회원번호·이름·별명·이메일·전화, 탈퇴 사유 표식, 로그인 계정 번호·로그인 이메일,
//             **남의 보관 답변의 표식 글자**, 회원 표 비밀번호 열의 값(원문 없이: 고정 접두사 zzb3c-pwcol- 가 응답 글자에 없는가 +
//             응답의 글자 값 하나하나의 sha256 이 그 값의 sha256 과 같지 않은가). 이 함수들은 본인의 이름·이메일도 돌려주지 않는다 —
//             ok 칸에서 허용하는 것은 본인의 보관 답변 글자뿐이다. 응답 본문의 글자 전체에서 찾는다.
//   HEAD 는 본문이 비어 있다는 것으로 판정하지 않는다 — 상태 코드로 판정한다.
//   인자를 붙여 남을 고치려는 요청: 통과로 세는 거절은 둘뿐이다 — 함수를 찾지 못함(404·PGRST202) 또는 점검 거절(503·PT503).
//     값이 왔으면(state·settings·answers) 기대와 다름, 2xx 거나 **예상한 거절 코드가 아닌 4xx 면 미확인**이다.
//     남의 행이 고쳐지지 않았음은 rows-effect 가 본다.
//   effect --step coercion: p_consent 에 JSON true 가 아닌 값 여덟(글자 "true" · 숫자 1 · "yes" · "t" · "false" · 0 · 배열 · 객체).
//     3차부터 인자의 형이 jsonb 다 — **여덟 전부 400·PT400·invalid_consent 가 기대값이다.** 하나라도 동의로 받아들여지면
//     그 칸은 기대와 다름이고 결과의 json_true_only.holds 가 false 다.
//   JSON 의 형이 다른 값을 넣은 칸(종류에 참거짓·배열·객체, 답변에 "객체를 글자로 쓴 것"): 기대는 400·PT400 의 그 사유다.
//     다른 거절(4xx)이면 미확인, 받아들여지면 기대와 다름.
// 종료 값: 0 = 전부 통과 / 1 = 기대와 다름 또는 미확인이 있음 / 2 = 요청 전에 멈춤(주소·열쇠·자격·인자·로그인 기록) /
//          3 = 기준선 불일치(지문·저장된 값이 그 단계의 전제와 맞지 않음)
// =====================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = 'b3c settings_matrix.mjs';
const REF = 'hmncdheiwqwekdbtijar';
const TEST_URL = `https://${REF}.supabase.co`;
const ISSUER = `${TEST_URL}/auth/v1`;
const RPC_BASE = '/rest/v1/rpc/';
const MIGRATION = join(HERE, '..', '..', 'migrations', '20261124091000_b3c_db_my_settings.sql');
const MAINT_ID = 311;
const MAINT_MESSAGE = 'zzb3c 시험 점검';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANSWERED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// 함수 다섯: 인자의 형(지문의 args), 본문을 감싼 달러 인용 이름
const FUNCS = {
  my_settings: { args: '', tag: 'b3c_settings', kind: 'read' },
  my_book_answers: { args: '', tag: 'b3c_answers', kind: 'read' },
  my_intro_track_set: { args: 'text', tag: 'b3c_track', kind: 'write' },
  my_marketing_consent_set: { args: 'jsonb', tag: 'b3c_consent', kind: 'write' }, // 3차: boolean → jsonb(JSON 의 형을 그대로 본다)
  my_book_answers_hold: { args: 'jsonb', tag: 'b3c_hold', kind: 'write' },
};
const FN_ORDER = ['my_settings', 'my_book_answers', 'my_intro_track_set', 'my_marketing_consent_set', 'my_book_answers_hold'];
const TRACKS = ['regular', 'australia'];
const SETTINGS_KEYS = ['intro_book_track', 'intro_book_track_supported', 'marketing_consent', 'marketing_consent_at'];
// 보관 답변의 열두 항목: 형(JSON) · 널 허용 — 마이그레이션의 my_book_answers() 와 같은 표
const ANSWER_RULES = {
  current_score: ['number', true], target_score: ['number', false], no_target_score: ['boolean', false], stuck_area: ['string', false],
  goal_timeframe: ['string', false], referral_source: ['string', false], referral_source_detail: ['string', true],
  is_au_nz_direct_submit: ['string', false], referrer_url: ['string', true], landing_url: ['string', true], utm_data: ['object', true], user_agent: ['string', true],
};
const ANSWER_KEYS = Object.keys(ANSWER_RULES);
const ANSWER_KEYS_OUT = [...ANSWER_KEYS, 'answered_at'];
const LIMITS = { bytes: 16384, url: 2048, agent: 512, detail: 200, utm: 200 };
const FORBIDDEN_KEYS = ['password', 'role', 'level', 'blocked', 'withdrawal_requested_at', 'withdrawal_reason', 'withdrawal_reason_detail', 'pending_book_request', 'created_at', 'updated_at', 'auth_user_id', 'member_id', 'password_migrated', 'password_changed_at', 'renotify_on', 'id', 'name', 'nickname', 'email', 'phone', 'timezone', 'profile'];
const STATES = { normal: { maint: false, hook: false }, 'normal-hook': { maint: false, hook: true }, maint: { maint: true, hook: false }, 'maint-hook': { maint: true, hook: true } };
const HOOK_ITEM = 'pgrst.db_pre_request=security_private.check_api_request';
// 자격 이름 → 환경 변수, expect.json 의 계정 이름, 자격에 적혀 있어야 하는 aal
const LOGINS = {
  member_a: { env: 'B3C_JWT_A', account: 'a' }, member_b: { env: 'B3C_JWT_B', account: 'b' }, no_map: { env: 'B3C_JWT_N', account: 'n' },
  admin_g_pre: { env: 'B3C_JWT_G1', account: 'g', aal: 'aal1' }, admin_g_post: { env: 'B3C_JWT_G2', account: 'g', aal: 'aal2' },
  admin_gm_pre: { env: 'B3C_JWT_GM1', account: 'gm', aal: 'aal1' }, admin_gm_post: { env: 'B3C_JWT_GM2', account: 'gm', aal: 'aal2' },
  blocked: { env: 'B3C_JWT_BLK', account: 'blk' }, withdrawing: { env: 'B3C_JWT_WD', account: 'wd' }, blocked_withdrawing: { env: 'B3C_JWT_BW', account: 'bw' },
  a_expire: { env: 'B3C_JWT_A_EXP', account: 'a' }, a_logout: { env: 'B3C_JWT_A_OUT', account: 'a' }, a_old: { env: 'B3C_JWT_A_OLD', account: 'a' },
};
const MATRIX_ACTORS = ['anon', 'member_a', 'member_b', 'no_map', 'admin_g_pre', 'admin_g_post', 'admin_gm_pre', 'admin_gm_post', 'blocked', 'withdrawing', 'blocked_withdrawing', 'service'];
const ACCOUNT_OF = (actor) => LOGINS[actor]?.account ?? null;
const ALL_ACCOUNTS = ['a', 'b', 'n', 'g', 'gm', 'blk', 'wd', 'bw'];
const ROW_LABELS = ['a', 'b', 'gm', 'blk', 'wd', 'bw', 'trap'];
// 점검 중에 통과하는 자격: 예외 명단의 회원(A), 6자리 확인을 끝낸 관리자
const MAINT_EXEMPT = ['member_a', 'admin_g_post', 'admin_gm_post'];
// 저장된 답변의 모양(answers_variant.sql 과 같은 표 — 한쪽을 고치면 다른 쪽도 고친다)
const VARIANT_ROUNDS = {
  1: { a: 'json_null', b: 'array', gm: 'string' }, 2: { a: 'number', b: 'missing_key', gm: 'wrong_type' },
  3: { a: 'required_null', b: 'answered_at_number', gm: 'sql_null' }, 4: { a: 'extra_keys', b: 'no_answered_at', gm: 'nullable_all_null' },
  5: { a: 'utm_extra_key', b: 'utm_nested', gm: 'utm_nonstring' }, 6: { a: 'answered_at_not_time', b: 'answered_at_bad_date', gm: 'answered_at_offset' },
};
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
// 회원 표 비밀번호 열의 합성 값은 "고정 접두사 + 무작위"다. 원문은 어느 파일에도 없다 — 접두사와 sha256 으로만 찾는다
const PWCOL_PREFIX = 'zzb3c-pwcol-';
const SYNTH_MARK = 'zzb3c';
// 3-0 의 끝 상태(이번 시작 기준): public.my_profile() 의 본문 md5
const MY_PROFILE_BODY_MD5 = 'ea1fd98d18ba93cb4944e7a00c86bc7c';
// 시각으로 읽히는 글자의 모양(마이그레이션의 my_book_answers() 와 같은 식)
const TIME_TEXT_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})([.][0-9]{1,6})?(Z|[+-]([0-9]{2}):([0-9]{2}))$/;
const VARIANT_BASE = {
  current_score: 60.5, target_score: 95, no_target_score: false, stuck_area: '라이팅', goal_timeframe: '6개월 안에', referral_source: '인스타그램', referral_source_detail: null,
  is_au_nz_direct_submit: 'no', referrer_url: 'https://ref.zzb3c.invalid/variant', landing_url: 'https://land.zzb3c.invalid/variant', utm_data: { utm_medium: 'zzb3c-utm-variant' },
  user_agent: 'zzb3c-agent-variant', answered_at: '2026-02-03T04:05:06.789Z',
};
const VARIANT_NEVER = ['zzb3c-variant-extra', 'zzb3c-variant-not-an-object', 'zz_legacy_note', 'privacy_agreement', 'zzb3c-legacy-', 'zzb3c-variant-utm-extra', 'zz_other', 'zzb3c-variant-utm-nested', 'zzb3c-variant-not-a-time'];

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const phase = arg('--phase');
let requestCount = 0;
const log = (m) => console.error(`[b3c] ${m}`);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 키를 정렬한 JSON 글자(값의 비교·sha256 용)
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const sameJson = (a, b) => canon(a) === canon(b);
const sameInstant = (a, b) => (a == null && b == null) || (a != null && b != null && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

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
  if (env.B3C_URL !== TEST_URL) stop(2, `B3C_URL 이 정확히 ${TEST_URL} 가 아니다`);
  anonKey = checkKey('B3C_ANON_KEY', 'anon');
  if (needService) serviceKey = checkKey('B3C_SERVICE_KEY', 'service_role');
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
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function checkExpectShape(expect) {
  for (const acc of ALL_ACCOUNTS) if (!expect.accounts?.[acc]) stop(2, `--expect 에 계정 ${acc} 가 없다(fixtures_up.sql 의 결과여야 한다)`);
  // 비밀번호 열의 원문이 든 파일은 받지 않는다(1차 판의 expect.json). 접두사가 있다는 사실과 sha256 만 있어야 한다
  const holders = [...ALL_ACCOUNTS.map((a) => [a, expect.accounts[a]]), ['trap', expect.trap ?? {}]];
  for (const [name, h] of holders) {
    if (h && 'password_column_marker' in h) stop(2, `--expect 에 비밀번호 열의 원문(password_column_marker)이 들어 있다(${name}). 2차 판 fixtures_up.sql 의 결과여야 한다 — 이 파일은 지울 것`);
    if (name === 'trap' || h.member) { const pc = h.password_column; if (!pc || pc.prefix !== PWCOL_PREFIX || pc.has_prefix !== true || !isHex64(pc.sha256)) stop(2, `--expect 의 ${name} 에 password_column(prefix ${PWCOL_PREFIX} · has_prefix true · sha256)이 없다`); }
  }
  for (const acc of ALL_ACCOUNTS) { const em = expect.accounts[acc].auth_email; if (typeof em !== 'string' || !em.toLowerCase().includes(SYNTH_MARK)) stop(2, `--expect 의 ${acc} 에 합성 표식(${SYNTH_MARK})이 있는 로그인 이메일(auth_email)이 없다`); }
  for (const acc of ['a', 'b', 'gm']) if (!expect.accounts[acc].member || !expect.accounts[acc].settings) stop(2, `--expect 에 ${acc} 의 회원 값·설정 값이 없다`);
  if (!expect.trap?.id || String(expect.trap.id).toLowerCase() !== String(expect.accounts.n.auth_user_id).toLowerCase()) stop(2, '--expect 에 함정 행이 없거나, 그 회원번호가 계정 n 의 로그인 계정 번호와 다르다(fixtures_up.sql 의 결과여야 한다)');
}

// 지문이 --state 와 맞는가(도구는 DB 를 읽지 못한다 — 브레인방이 읽어 넘긴 파일을 본다)
function checkFingerprint(fp, { wantFunctions, state, expect }) {
  const problems = [];
  const age = fp?.read_at ? ageSeconds(fp.read_at) : NaN;
  if (!Number.isFinite(age)) stop(2, '--fingerprint 파일에 read_at 이 없다(이 폴더의 fingerprint.sql 결과여야 한다)');
  if (age > 1800 || age < -300) stop(2, `--fingerprint 가 ${age}초 전에 읽은 것이다. 재기 직전(30분 안)에 다시 읽을 것`);
  if (!fp.functions || typeof fp.functions !== 'object') stop(2, '--fingerprint 파일에 functions 가 없다(이 폴더의 fingerprint.sql 결과여야 한다)');
  const fns = {};
  for (const name of FN_ORDER) {
    const f = fp.functions[name] ?? {};
    fns[name] = { oid: f.oid ?? null, def_md5: f.def_md5 ?? null, body_md5: f.body_md5 ?? null };
    if (wantFunctions) {
      if (f.exists !== true || Number(f.named_count) !== 1) problems.push(`public.${name} 이 없거나 같은 이름의 함수가 ${f.named_count}개다`);
      const e = f.execute ?? {};
      if (!(e.public === false && e.anon === false && e.authenticated === true && e.service_role === false)) problems.push(`${name}: 실행 권한이 authenticated 뿐이 아니다`);
      if (f.volatility !== 'v') problems.push(`${name}: volatile 이 아니다`);
      if (f.security_definer !== true) problems.push(`${name}: security definer 가 아니다`);
    } else if (f.exists !== false || Number(f.named_count) !== 0) problems.push(`DB 카탈로그에 public.${name} 이 있다(같은 이름 ${f.named_count}개)`);
  }
  const mentions = fp.check_api_request?.mentions;
  if (!Array.isArray(mentions) || mentions.length !== 0) problems.push(`공통 확인 함수의 본문에 이 계약의 함수 이름이 있다(${JSON.stringify(mentions)}) — 예외에 추가하면 안 된다`);
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
  return { read_at: fp.read_at, seconds_before_this_run: age, problems, functions: fns, site_state: fp.site_state ?? null, pre_request: fp.pre_request ?? null };
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

// rows_md5.sql 의 결과: 합성 회원의 "지금 저장된 설정 값". label → settings
function loadRows(path, what = '--rows', { maxAge = 1800 } = {}) {
  const r = loadResult(path, what);
  if (!Array.isArray(r?.users) || !r.read_at) stop(2, `${what} 가 rows_md5.sql 의 결과가 아니다(users · read_at 이 없다)`);
  if (maxAge != null) { const age = ageSeconds(r.read_at); if (age > maxAge || age < -300) stop(2, `${what} 가 ${age}초 전에 읽은 것이다. 재기 직전(30분 안)에 다시 읽을 것`); }
  const by = {};
  for (const u of r.users) { if (!u.label || !u.cols || !u.settings) stop(2, `${what} 의 users 에 label · cols · settings 가 없는 행이 있다`); by[u.label] = u; }
  for (const l of ROW_LABELS) if (!by[l]) stop(2, `${what} 에 합성 회원 ${l} 의 행이 없다(합성 자료가 올라가 있어야 한다)`);
  return { raw: r, by };
}
// 저장된 값 → my_book_answers() 가 돌려줄 것(마이그레이션의 읽기 규칙과 같은 계산)
function projectStored(settings) {
  const raw = settings.pending_book_request;
  if (settings.pending_is_sql_null === true || raw === undefined) return { state: 'ok', answers: null };
  if (jsonType(raw) !== 'object') return { state: 'answers_corrupt' };
  const answers = {};
  for (const k of ANSWER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) return { state: 'answers_corrupt' };
    const [type, nullable] = ANSWER_RULES[k];
    const t = jsonType(raw[k]);
    if (t === 'null') { if (!nullable) return { state: 'answers_corrupt' }; } else if (t !== type) return { state: 'answers_corrupt' };
    answers[k] = raw[k];
  }
  // utm_data 의 안쪽: 값이 하나라도 글자가 아니면 파손. 정해 둔 다섯 키 가운데 있는 것만 돌려준다
  if (answers.utm_data !== null) {
    const utm = {};
    for (const [k, v] of Object.entries(answers.utm_data)) { if (typeof v !== 'string') return { state: 'answers_corrupt' }; if (UTM_KEYS.includes(k)) utm[k] = v; }
    answers.utm_data = utm;
  }
  // answered_at: 없거나 null 이면 null. 글자면 시각으로 읽히는 글자일 때만 그 글자 그대로. 그 밖은 파손
  const at = Object.prototype.hasOwnProperty.call(raw, 'answered_at') ? raw.answered_at : null;
  if (at !== null && !isTimeText(at)) return { state: 'answers_corrupt' };
  answers.answered_at = at;
  return { state: 'ok', answers };
}
// 시각으로 읽히는 글자인가(모양 + 있는 날짜·시각). DB 는 글자를 timestamptz 로 바꿔 보고, 도구는 같은 모양에 월·일·시·분·초의 범위를 본다.
// 둘의 판정이 갈릴 수 있는 가장자리(24:00:00 · 윤초 60 · ±16시 넘는 시간대)는 시험 값으로 쓰지 않는다
function isTimeText(s) {
  if (typeof s !== 'string') return false;
  const m = TIME_TEXT_RE.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return false;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > dim) return false;
  if (m[8] !== 'Z' && (Number(m[9]) > 15 || Number(m[10]) > 59)) return false;
  return true;
}
// PostgreSQL 이 jsonb 를 글자로 바꾼 것(p_answers::text)의 바이트 수. 객체는 {"키": 값, "키": 값} — 콜론·쉼표 뒤에 빈칸 하나씩.
// (도구가 계산한 값이다. DB 의 실제 길이와 다르면 "전체 바이트의 경계" 칸이 어긋난다 — 그래서 경계에서 64바이트 떨어진 칸을 함께 쟰다)
function pgJsonbTextBytes(v) {
  if (v === null || typeof v !== 'object') return Buffer.byteLength(JSON.stringify(v), 'utf8');
  if (Array.isArray(v)) return 2 + v.reduce((a, x) => a + pgJsonbTextBytes(x), 0) + Math.max(0, v.length - 1) * 2;
  const ks = Object.keys(v);
  return 2 + ks.reduce((a, k) => a + Buffer.byteLength(JSON.stringify(k), 'utf8') + 2 + pgJsonbTextBytes(v[k]), 0) + Math.max(0, ks.length - 1) * 2;
}
const KO = '가'; // 한 글자 = 코드 포인트 1 · UTF-8 3바이트
const ASTRAL = '\u{1F600}'; // 한 글자 = 코드 포인트 1 · UTF-16 단위 2 · UTF-8 4바이트
// 코드 포인트 n 개짜리 글자: prefix 뒤를 ch 로 채운다(String.padEnd 는 UTF-16 단위로 세므로 쓰지 않는다)
const fill = (prefix, n, ch) => prefix + ch.repeat(Math.max(0, n - [...prefix].length));
const cpLen = (s) => [...s].length;
// 전체가 정확히 target 바이트인 한 벌(항목별 상한은 전부 지킨다): 주소·상세·utm 을 상한까지 여러 바이트 글자로 채우고,
// user_agent 의 ASCII 길이(상한 512자 안)로 맞춘다. 모자라면 상세·utm 값을 하나씩 4바이트 글자로 바꾸어 늘린다
function payloadOfBytes(account, tag, target) {
  const m = `zzb3c-hold-${account}-${tag}-`;
  const slots = ['detail', ...UTM_KEYS];
  const ch = Object.fromEntries(slots.map((s) => [s, KO]));
  const build = (uaLen) => ({ current_score: 100, target_score: 110, no_target_score: false, stuck_area: '리딩', goal_timeframe: '6개월 안에', referral_source: '기타', referral_source_detail: fill(m, LIMITS.detail, ch.detail), is_au_nz_direct_submit: 'no',
    referrer_url: fill(`https://ref.zzb3c.invalid/${m}`, LIMITS.url, KO), landing_url: fill(`https://land.zzb3c.invalid/${m}`, LIMITS.url, KO),
    utm_data: Object.fromEntries(UTM_KEYS.map((k) => [k, fill(m, LIMITS.utm, ch[k])])), user_agent: fill(m, uaLen, 'u') });
  const minUa = cpLen(m);
  for (let i = 0; i <= slots.length; i++) {
    const uaLen = minUa + (target - pgJsonbTextBytes(build(minUa)));
    if (uaLen < minUa) break;
    if (uaLen <= LIMITS.agent) { const p = build(uaLen); if (pgJsonbTextBytes(p) !== target) break; return p; }
    if (i < slots.length) ch[slots[i]] = ASTRAL;
  }
  stop(2, `도구의 계산 오류: ${target}바이트의 한 벌을 항목 상한 안에서 만들지 못했다`);
  return null;
}
// 도구가 보관하는 답변(계정·이름별로 표식이 다르다). 정해 둔 열두 항목, 전부 허용 범위 안
function holdPayload(account, tag) {
  const m = `zzb3c-hold-${account}-${tag}`;
  return {
    current_score: 82.5, target_score: 105, no_target_score: false, stuck_area: '리스닝', goal_timeframe: '3개월 안에', referral_source: '기타',
    referral_source_detail: `${m}-detail`, is_au_nz_direct_submit: 'no', referrer_url: `https://ref.zzb3c.invalid/${m}`,
    landing_url: `https://land.zzb3c.invalid/${m}?utm_source=x`, utm_data: { utm_source: `${m}-utm`, utm_campaign: `${m}-camp` }, user_agent: `${m}-agent`,
  };
}
// 위와 모든 항목이 다른 한 벌(덮어쓰기·두 창 시험에서 "섞이지 않았는가"를 가리려고)
function holdPayloadOther(account, tag) {
  const m = `zzb3c-hold-${account}-${tag}`;
  return {
    current_score: null, target_score: 6, no_target_score: false, stuck_area: '스피킹', goal_timeframe: '한 달 안에', referral_source: '블로그',
    referral_source_detail: null, is_au_nz_direct_submit: 'yes', referrer_url: null, landing_url: `https://land.zzb3c.invalid/${m}`, utm_data: null, user_agent: null,
  };
}
const strOf = (n, head) => (head + 'x'.repeat(n)).slice(0, n);

// ---------------------------------------------------------------------
// 요청
function authFor(actor) {
  if (actor === 'anon') return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  if (actor === 'service') return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  return { apikey: anonKey, Authorization: `Bearer ${jwts[actor]}` };
}
// body: POST 의 본문 객체. query: GET·HEAD 의 인자(쓰기 함수는 인자를 붙여야 함수에 닿는다)
async function call(actor, fn, method, body, query) {
  requestCount++;
  const headers = { ...authFor(actor), Accept: 'application/json' };
  let payload;
  let url = TEST_URL + RPC_BASE + fn;
  if (method === 'POST') { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body ?? {}); } else if (query && Object.keys(query).length) url += '?' + new URLSearchParams(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))).toString();
  try {
    const res = await fetch(url, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = undefined; } // undefined = 본문이 JSON 이 아님
    return { status: res.status, text, json, cacheControl: res.headers.get('cache-control'), contentType: res.headers.get('content-type'), netError: null };
  } catch (e) {
    return { status: 0, text: '', json: null, cacheControl: null, contentType: null, netError: `${String(e?.name ?? 'Error')}` };
  }
}

// 금지 값. 누구의 값인지(owner)를 함께 둔다 — 보관 답변의 글자는 그 주인의 응답에서만 허용한다
function collectStrings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collectStrings(x, out);
  return out;
}
// 저장된 답변에서 글자를 모은다: 정해 둔 열두 항목 + answered_at 아래의 글자(own — 주인의 응답에서만 허용)와
// 그 밖의 글자(never — 옛 형식의 그 밖의 키, 객체가 아닌 값. 누구의 응답에도 나오면 안 된다)
function answerStrings(pending) {
  // own = my_book_answers() 가 돌려줄 것(열두 항목 + answered_at, utm 은 정해 둔 키만) 안의 글자. 파손이면 하나도 없다
  const proj = projectStored({ pending_book_request: pending, pending_is_sql_null: false });
  const own = proj.state === 'ok' && proj.answers ? collectStrings(proj.answers, []) : [];
  const never = collectStrings(pending ?? null, []).filter((s) => !own.includes(s));
  return { own: own.filter((s) => s.includes('zzb3c')), never: never.filter((s) => s.includes('zzb3c')) };
}
function forbiddenValues(expect, rowsBy) {
  const out = [];
  const add = (owner, field, value, answers = false) => { if (typeof value === 'string' && value.length >= 6) out.push({ owner, field, value, answers }); };
  const addAnswers = (owner, field, pending) => { const s = answerStrings(pending); for (const x of s.own) add(owner, field, x, true); for (const x of s.never) add(owner, `${field} — 항목 밖의 값`, x, false); };
  for (const [acc, a] of Object.entries(expect.accounts ?? {})) {
    add(acc, 'auth_user_id', a.auth_user_id);
    for (const k of ['id', 'name', 'nickname', 'email', 'phone']) if (a.member) add(acc, `member.${k}`, a.member[k]);
    add(acc, 'auth_email(로그인 이메일)', a.auth_email);
    for (const w of a.withdrawal_markers ?? []) add(acc, 'withdrawal_marker', w);
    addAnswers(acc, 'answers(처음 값)', a.settings?.pending_book_request ?? null);
    // 이 도구가 그 계정으로 보관하는 답변의 표식(다른 계정의 응답에 나오면 안 된다)
    add(acc, 'answers(도구가 보관한 값의 표식)', `zzb3c-hold-${acc}-`, true);
  }
  if (expect.trap) {
    for (const k of ['name', 'nickname', 'email', 'phone']) add('trap', k, expect.trap[k]);
    addAnswers('trap', 'answers(처음 값)', expect.trap.settings?.pending_book_request ?? null);
  }
  // 지금 저장돼 있는 답변의 글자(처음 값과 달라져 있을 수 있다)
  if (rowsBy) for (const [label, u] of Object.entries(rowsBy)) addAnswers(label, 'answers(지금 저장된 값)', u.settings?.pending_book_request ?? null);
  for (const s of VARIANT_NEVER) out.push({ owner: '(누구에게도)', field: '옛 형식의 그 밖의 키·파손 값', value: s, answers: false });
  // 회원 표 비밀번호 열: 원문은 도구가 모른다. 고정 접두사가 응답 글자에 없는가 + 응답의 글자 값 하나하나의 sha256 이 그 값의 sha256 과 같지 않은가
  out.push({ owner: '(누구에게도)', field: '회원 표 비밀번호 열의 합성 값(고정 접두사)', value: PWCOL_PREFIX, answers: false });
  out.passwordHashes = [...Object.entries(expect.accounts ?? {}).map(([acc, a]) => [acc, a.password_column?.sha256]), ['trap', expect.trap?.password_column?.sha256]].filter(([, h]) => isHex64(h));
  return out;
}
function collectKeys(v, keys) {
  if (Array.isArray(v)) v.forEach((x) => collectKeys(x, keys));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); collectKeys(x, keys); }
  return keys;
}
// 응답 어디에도 금지 키·금지 값이 없는가. owner = 이 칸의 응답에서 보관 답변 글자를 허용하는 계정(없으면 아무것도 허용하지 않는다)
function leakProblems(res, forbidden, owner, allowAnswers) {
  const problems = [];
  const keys = res.json && typeof res.json === 'object' ? collectKeys(res.json, []) : [];
  const strings = res.json && typeof res.json === 'object' ? collectStrings(res.json, []) : [];
  const hay = (res.text ?? '') + '\n' + strings.join('\n');
  const lower = hay.toLowerCase();
  for (const k of FORBIDDEN_KEYS) if (keys.includes(k)) problems.push(`금지 키가 응답에 있다: ${k}`);
  if (lower.includes('password')) problems.push('응답 본문에 password 라는 글자가 있다');
  // 비밀번호 열의 값(원문 없이): 응답의 글자 값 하나하나의 sha256 을 견준다(접두사는 아래의 금지 값 목록에서 찾는다)
  if (forbidden.passwordHashes?.length && strings.length) { const hs = new Set(strings.map((s) => sha256(s))); for (const [who, h] of forbidden.passwordHashes) if (hs.has(h)) problems.push(`회원 표 비밀번호 열의 값이 응답에 있다(sha256 일치): ${who}`); }
  const allowed = forbidden.filter((f) => f.answers && allowAnswers && f.owner === owner).map((f) => f.value);
  for (const f of forbidden) {
    if (f.answers && allowAnswers && f.owner === owner) continue;
    if (allowed.some((s) => s.includes(f.value))) continue; // 본인 값의 일부인 글자(이름이 겹치는 표식)는 세지 않는다
    if (hay.includes(f.value) || lower.includes(String(f.value).toLowerCase())) problems.push(`금지 값이 응답에 있다: ${f.owner}.${f.field}`);
  }
  return [...new Set(problems)];
}
const normCache = (v) => (v == null ? null : String(v).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).sort().join(', '));
const sameKeys = (obj, want) => obj && typeof obj === 'object' && !Array.isArray(obj) && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...want].sort());

// 기대값의 종류
//   ok(fn, …) · state_only(state) · maintenance · no_execute · method · no_execute_or_method · not_found_fn ·
//   args_no_data(인자를 붙여 남을 고치려는 요청) · invalid(message, details) · missing_arg · observe · jwt_expired
function describeExpect(e) {
  switch (e.kind) {
    case 'ok': return `200 {"state":"ok", …} — ${e.what}, Cache-Control private, no-store`;
    case 'state_only': return `200 {"state":"${e.state}"} 뿐, Cache-Control private, no-store`;
    case 'maintenance': return '503 (code PT503 · message maintenance), 값 없음';
    case 'no_execute': return '401 또는 403 (code 42501 — 실행 권한 없음)';
    case 'method': return '405 (GET 은 code PT405 — 함수 안의 확인)';
    case 'no_execute_or_method': return '401·403(42501) 또는 405 (거절 상태)';
    case 'not_found_fn': return '404 (code PGRST202 — 등록되지 않은 함수)';
    case 'missing_arg': return '404 (code PGRST202 — 인자 없는 이름으로는 함수를 찾지 못한다)';
    case 'args_no_data': return '거절이고 값 없음(state·settings·answers 없음) — 관측한 상태·코드를 적는다';
    case 'invalid': return `400 (code PT400 · message ${e.message}${e.details ? ' · details ' + e.details : ''}), 값 없음`;
    case 'observe': return '관측만: 거절(4xx)이거나 ok — 무엇이 왔는지 적는다(값이 새지 않았는지는 본다)';
    case 'jwt_expired': return '401 이고 오류의 사유가 만료(함수에 들어오기 전 거절). 다른 인증 오류는 미확인';
    default: return '?';
  }
}
// 판정. ctx = { forbidden, owner(계정 이름 또는 null) }. ok 의 값 비교는 expected.check(json) 이 문제 목록을 돌려준다
function judge(expected, res, method, ctx) {
  const out = { http_status: res.status, code: null, cache_control: res.cacheControl, body_state: null, body_keys: null, inner_keys: null, body_length: (res.text ?? '').length, verdict: 'pass', problems: [] };
  if (res.netError) { out.verdict = 'unverified'; out.problems.push(`요청 오류(${res.netError})`); return out; }
  const j = res.json;
  const isObj = j && typeof j === 'object' && !Array.isArray(j);
  if (isObj) {
    out.body_keys = Object.keys(j).sort(); out.code = j.code != null ? String(j.code).slice(0, 16) : null; out.body_state = typeof j.state === 'string' ? j.state : null;
    const inner = j.settings ?? j.answers; if (inner && typeof inner === 'object' && !Array.isArray(inner)) out.inner_keys = Object.keys(inner).sort();
  }
  const bad = (m) => out.problems.push(m);
  const hasData = isObj && ('state' in j || 'settings' in j || 'answers' in j || 'intro_book_track' in j || 'marketing_consent' in j || 'marketing_consent_at' in j);
  const expectsBody = expected.kind === 'ok' || expected.kind === 'state_only';
  const maintenanceShape = res.status === 503 && (method === 'HEAD' || out.code === 'PT503');
  if (!expectsBody && res.status === 429) { out.verdict = 'unverified'; bad('429 — 요청 한도'); }
  if (!expectsBody && res.status >= 500 && !((expected.kind === 'maintenance' && res.status === 503) || (expected.kind === 'args_no_data' && maintenanceShape))) { out.verdict = 'unverified'; bad(`기대하지 않은 ${res.status}`); }
  let allowAnswers = false;
  switch (expected.kind) {
    case 'ok': {
      allowAnswers = true;
      if (res.status !== 200) { bad(`상태 ${res.status} (기대 200)`); if (res.status === 429 || res.status >= 500) out.verdict = 'unverified'; break; }
      if (!isObj || j.state !== 'ok') bad(`state 가 ok 가 아니다(${out.body_state})`);
      else for (const p of expected.check(j, out)) bad(p);
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
      if (method !== 'HEAD' && res.status === 503) { if (out.code !== 'PT503') bad(`code 가 PT503 이 아니다(${out.code})`); if (!(isObj && j.message === 'maintenance')) bad('message 가 maintenance 가 아니다'); }
      if (hasData) bad('거절인데 state·값이 응답에 있다');
      break;
    case 'no_execute':
      if (res.status !== 401 && res.status !== 403) bad(`상태 ${res.status} (기대 401 또는 403)`);
      else if (out.code !== '42501') bad(`code 가 42501 이 아니다(${out.code})`);
      if (hasData) bad('거절인데 state·값이 응답에 있다');
      break;
    case 'method':
      if (res.status !== 405) bad(`상태 ${res.status} (기대 405 — 거절 상태)`);
      else if (method === 'GET' && out.code !== 'PT405') bad(`GET 의 code 가 PT405 가 아니다(${out.code}) — 함수 안의 확인이 거절한 것이 아니다`);
      out.rejected_by = out.code === 'PT405' ? '함수 안의 확인(PT405)' : method === 'HEAD' ? '본문이 없어 알 수 없다' : `PostgREST(code ${out.code})`;
      if (hasData) bad('거절인데 state·값이 응답에 있다');
      break;
    case 'no_execute_or_method':
      if (![401, 403, 405].includes(res.status)) bad(`상태 ${res.status} (기대 401·403·405 — 거절 상태)`);
      if (hasData) bad('거절인데 state·값이 응답에 있다');
      break;
    case 'not_found_fn':
    case 'missing_arg':
      if (res.status !== 404) bad(`상태 ${res.status} (기대 404)`);
      else if (out.code !== 'PGRST202') bad(`code 가 PGRST202 가 아니다(${out.code}) — 일반 404 는 "등록되지 않은 함수"의 증거가 아니다`);
      if (hasData) bad('함수를 찾지 못해야 하는데 state·값이 응답에 있다');
      break;
    case 'args_no_data': {
      // 통과로 세는 거절은 둘뿐이다: 함수를 찾지 못함(404·PGRST202) · 점검 거절(503·PT503). 그 밖의 거절(다른 4xx)은 미확인이다
      const notFound = res.status === 404 && out.code === 'PGRST202';
      out.observed = notFound ? '함수를 찾지 못함(404·PGRST202)' : maintenanceShape ? '점검 거절(503·PT503)' : `그 밖(${res.status}·${out.code})`;
      if (hasData) bad('인자를 붙였는데 state·값이 응답에 있다(함수가 실행됐다)');
      else if (res.status >= 200 && res.status < 400) { out.verdict = 'unverified'; bad(`거절이 아니라 ${res.status} — 무엇이 실행됐는지 확인할 것`); }
      else if (!notFound && !maintenanceShape && out.verdict !== 'unverified') { out.verdict = 'unverified'; bad(`예상한 거절(404·PGRST202 또는 503·PT503)이 아니다(${res.status}·${out.code}) — 무엇이 거절했는지 확인할 것`); }
      break;
    }
    case 'invalid':
      out.observed_details = isObj && typeof j.details === 'string' ? j.details.slice(0, 40) : null; // 고정된 사유 이름이다(받은 값이 아니다)
      // 형을 달리한 값의 칸(other_reject_is_unverified): 다른 거절(4xx)은 "누가 거절했는지 모른다" — 미확인으로 남긴다
      if (expected.other_reject_is_unverified && !hasData && res.status >= 400 && res.status < 500 && !(res.status === 400 && out.code === 'PT400')) { out.verdict = 'unverified'; bad(`예상한 거절(400·PT400·${expected.message})이 아니다(${res.status}·${out.code}) — 무엇이 거절했는지 확인할 것`); }
      else if (res.status !== 400) bad(`상태 ${res.status} (기대 400)`);
      else {
        if (out.code !== 'PT400') bad(`code 가 PT400 이 아니다(${out.code})`);
        if (!(isObj && j.message === expected.message)) bad(`message 가 ${expected.message} 가 아니다`);
        if (expected.details && out.observed_details !== expected.details) bad(`details 가 ${expected.details} 가 아니다(${out.observed_details})`);
      }
      if (hasData) bad('거절인데 state·값이 응답에 있다');
      break;
    case 'observe':
      // 형 변환을 PostgREST 가 어떻게 하는지 모른다 — 통과·실패로 가르지 않고 적는다. ok 면 호출자가 효과에 반영한다
      allowAnswers = true;
      out.observed = res.status === 200 && isObj && j.state === 'ok' ? '받아들여짐(200 ok)' : `거절(${res.status}·${out.code})`;
      if (res.status >= 500 || res.status === 0) { out.verdict = 'unverified'; bad(`기대하지 않은 ${res.status}`); }
      break;
    case 'jwt_expired': {
      // 만료를 뜻하는 사유일 때만 통과. 오류 문구는 고정된 안내문이라 앞 80자를 적는다(자격·회원 값이 아니다)
      const msg = isObj && typeof j.message === 'string' ? j.message : '';
      out.observed_message = msg.slice(0, 80);
      out.reason_is_expiry = /expired/i.test(msg);
      if (hasData) bad('함수에 들어오기 전에 거절돼야 하는데 state·값이 응답에 있다');
      else if (res.status === 200) bad('만료된 JWT 인데 200 이다');
      else if (res.status !== 401) { out.verdict = 'unverified'; bad(`상태 ${res.status} (기대 401) — 만료로 거절된 것인지 확인하지 못했다`); }
      else if (!out.reason_is_expiry) { out.verdict = 'unverified'; bad(`401 이지만 오류의 사유가 만료가 아니다(code ${out.code}) — 다른 인증 오류는 미확인이다`); }
      break;
    }
    default: bad('기대값을 정하지 못했다');
  }
  const leaks = leakProblems(res, ctx.forbidden, ctx.owner, allowAnswers);
  out.leaks = leaks.length;
  out.problems.push(...leaks);
  if (leaks.length) out.verdict = 'mismatch'; // 금지 값이 실렸으면 다른 사정과 관계없이 실패다
  else if (out.problems.length && out.verdict !== 'unverified') out.verdict = 'mismatch';
  return out;
}

// ok 응답의 값 검사(함수별). 문제 목록을 돌려주고, 효과 대조에 쓸 값을 cell 에 적는다
const near = (iso) => Number.isFinite(Date.parse(iso)) && Math.abs(Date.parse(iso) - Date.now()) < 10 * 60 * 1000;
function okSettings(want) { // want = { intro_book_track, marketing_consent, marketing_consent_at } | null(모양만)
  return { kind: 'ok', what: 'settings 의 키가 정확히 넷, 저장된 값 그대로', check: (j) => {
    const p = [];
    if (!sameKeys(j, ['state', 'settings'])) p.push(`응답의 키가 정확히 state·settings 가 아니다(${JSON.stringify(Object.keys(j).sort())})`);
    const s = j.settings;
    if (!sameKeys(s, SETTINGS_KEYS)) { p.push(`settings 의 키가 정확히 넷이 아니다(${JSON.stringify(s && typeof s === 'object' ? Object.keys(s).sort() : s)})`); return p; }
    if (s.intro_book_track_supported !== TRACKS.includes(s.intro_book_track)) p.push('intro_book_track_supported 가 저장된 종류 값과 맞지 않는다');
    if (!(s.marketing_consent === true || s.marketing_consent === false || s.marketing_consent === null)) p.push('marketing_consent 가 참·거짓·null 이 아니다');
    if (want) {
      if (s.intro_book_track !== (want.intro_book_track ?? null)) p.push('intro_book_track 이 저장된 값과 다르다');
      if (s.marketing_consent !== (want.marketing_consent ?? null)) p.push('marketing_consent 가 저장된 값과 다르다(널을 다른 값으로 바꾸면 안 된다)');
      if (!sameInstant(s.marketing_consent_at ?? null, want.marketing_consent_at ?? null)) p.push('marketing_consent_at 이 저장된 값과 다르다');
    }
    return p;
  } };
}
function okAnswers(wantAnswers, shapeOnly = false) { // wantAnswers = null(보관 없음) | {열두 항목 + answered_at}
  return { kind: 'ok', what: wantAnswers === null && !shapeOnly ? 'answers 가 null(보관 없음)' : 'answers 의 키가 정확히 열두 항목 + answered_at, 저장된 값 그대로', check: (j) => {
    const p = [];
    if (!sameKeys(j, ['state', 'answers'])) p.push(`응답의 키가 정확히 state·answers 가 아니다(${JSON.stringify(Object.keys(j).sort())})`);
    if (shapeOnly) { if (j.answers !== null && !sameKeys(j.answers, ANSWER_KEYS_OUT)) p.push('answers 가 null 도 아니고 열두 항목 + answered_at 도 아니다'); return p; }
    if (wantAnswers === null) { if (j.answers !== null) p.push('보관이 없는데 answers 가 null 이 아니다'); return p; }
    if (!sameKeys(j.answers, ANSWER_KEYS_OUT)) { p.push(`answers 의 키가 정확히 열두 항목 + answered_at 이 아니다(${JSON.stringify(j.answers && typeof j.answers === 'object' ? Object.keys(j.answers).sort() : j.answers)})`); return p; }
    for (const k of ANSWER_KEYS_OUT) if (!sameJson(j.answers[k], wantAnswers[k])) p.push(`answers.${k} 가 저장된 값과 다르다`);
    return p;
  } };
}
function okTrack(sent) {
  return { kind: 'ok', what: `intro_book_track 이 보낸 값(${sent})`, check: (j, cell) => {
    const p = [];
    if (!sameKeys(j, ['state', 'intro_book_track'])) p.push(`응답의 키가 정확히 state·intro_book_track 이 아니다(${JSON.stringify(Object.keys(j).sort())})`);
    if (j.intro_book_track !== sent) p.push('intro_book_track 이 보낸 값과 다르다');
    cell.returned = { intro_book_track: TRACKS.includes(j.intro_book_track) ? j.intro_book_track : '(그 밖의 값)' };
    return p;
  } };
}
function okConsent() {
  return { kind: 'ok', what: 'marketing_consent true, marketing_consent_at 이 서버 시각', check: (j, cell) => {
    const p = [];
    if (!sameKeys(j, ['state', 'marketing_consent', 'marketing_consent_at'])) p.push(`응답의 키가 정확히 state·marketing_consent·marketing_consent_at 이 아니다(${JSON.stringify(Object.keys(j).sort())})`);
    if (j.marketing_consent !== true) p.push('marketing_consent 가 true 가 아니다');
    if (typeof j.marketing_consent_at !== 'string' || !near(j.marketing_consent_at)) p.push('marketing_consent_at 이 시각이 아니거나 지금과 10분 넘게 다르다(도구의 시계 기준 — DB 시각과의 대조는 rows-effect)');
    cell.returned = { marketing_consent: j.marketing_consent === true, marketing_consent_at: typeof j.marketing_consent_at === 'string' && Number.isFinite(Date.parse(j.marketing_consent_at)) ? new Date(Date.parse(j.marketing_consent_at)).toISOString() : null, marketing_consent_at_raw_length: typeof j.marketing_consent_at === 'string' ? j.marketing_consent_at.length : null };
    return p;
  } };
}
function okHold(sent) {
  return { kind: 'ok', what: 'answers 가 보낸 열두 항목 + 서버가 붙인 answered_at', check: (j, cell) => {
    const p = [];
    if (!sameKeys(j, ['state', 'answers'])) p.push(`응답의 키가 정확히 state·answers 가 아니다(${JSON.stringify(Object.keys(j).sort())})`);
    const a = j.answers;
    if (!sameKeys(a, ANSWER_KEYS_OUT)) { p.push(`answers 의 키가 정확히 열두 항목 + answered_at 이 아니다(${JSON.stringify(a && typeof a === 'object' ? Object.keys(a).sort() : a)})`); return p; }
    for (const k of ANSWER_KEYS) if (!sameJson(a[k], sent[k])) p.push(`answers.${k} 가 보낸 값과 다르다`);
    if (typeof a.answered_at !== 'string' || !ANSWERED_AT_RE.test(a.answered_at)) p.push('answered_at 이 YYYY-MM-DDTHH:MM:SS.mmmZ 모양이 아니다');
    else if (!near(a.answered_at)) p.push('answered_at 이 지금과 10분 넘게 다르다(도구의 시계 기준)');
    cell.returned = { answers_sha256: sha256(canon(a)), answered_at: typeof a.answered_at === 'string' && ANSWERED_AT_RE.test(a.answered_at) ? a.answered_at : null };
    return p;
  } };
}

// 효과 장부: 계정마다 "이 단계가 고쳤어야 하는 열"과 마지막 값. rows-effect 가 앞뒤 스냅숏과 견준다
function newLedger(rowsBy) {
  const start = {};
  for (const l of ROW_LABELS) { const s = rowsBy[l].settings; start[l] = { intro_book_track: s.intro_book_track ?? null, marketing_consent: s.marketing_consent ?? null, marketing_consent_at: s.marketing_consent_at ?? null, answers_sha256: s.pending_is_sql_null ? null : sha256(canon(s.pending_book_request)) }; }
  return { start, now: JSON.parse(JSON.stringify(start)), consent_times: {}, writes: 0 };
}
function applyReturned(ledger, account, fn, cell) {
  if (!ROW_LABELS.includes(account) || cell.verdict !== 'pass' || cell.body_state !== 'ok' || !cell.returned) return;
  const n = ledger.now[account];
  if (fn === 'my_intro_track_set') n.intro_book_track = cell.returned.intro_book_track;
  if (fn === 'my_marketing_consent_set') { n.marketing_consent = true; n.marketing_consent_at = cell.returned.marketing_consent_at; (ledger.consent_times[account] ??= []).push(cell.returned.marketing_consent_at); }
  if (fn === 'my_book_answers_hold') n.answers_sha256 = cell.returned.answers_sha256;
  ledger.writes++;
}
function ledgerOut(ledger) {
  const effects = {};
  for (const l of ROW_LABELS) {
    const a = ledger.start[l]; const b = ledger.now[l]; const changed = [];
    if (a.intro_book_track !== b.intro_book_track) changed.push('intro_book_track');
    if (a.marketing_consent !== b.marketing_consent) changed.push('marketing_consent');
    if (!sameInstant(a.marketing_consent_at, b.marketing_consent_at)) changed.push('marketing_consent_at');
    if (a.answers_sha256 !== b.answers_sha256) changed.push('pending_book_request');
    effects[l] = { changed_columns: changed.sort(), final: b, consent_times_from_responses: ledger.consent_times[l] ?? [] };
  }
  return { rule: '이 단계의 앞뒤에 뜬 rows_md5.sql 결과에서, 합성 회원마다 바뀐 열이 정확히 changed_columns 여야 하고(없으면 아무 열도 바뀌지 않아야 한다) 저장된 값이 final 과 같아야 한다', successful_writes: ledger.writes, by_member: effects };
}

function summarize(cells) {
  const count = (v) => cells.filter((c) => c.verdict === v).length;
  const by = {}; const byFn = {};
  for (const c of cells) { by[c.actor] = by[c.actor] ?? { pass: 0, mismatch: 0, unverified: 0 }; by[c.actor][c.verdict]++; byFn[c.fn] = byFn[c.fn] ?? { pass: 0, mismatch: 0, unverified: 0 }; byFn[c.fn][c.verdict]++; }
  return { cells: cells.length, pass: count('pass'), mismatch: count('mismatch'), unverified: count('unverified'), leaks: cells.reduce((a, c) => a + (c.leaks ?? 0), 0), cache_control_wrong: cells.filter((c) => c.problems.some((p) => p.startsWith('Cache-Control'))).length, by_actor: by, by_function: byFn };
}
function finish(result, cells) {
  result.request_count = requestCount;
  result.summary = summarize(cells);
  result.cells = cells;
  result.mismatches = cells.filter((c) => c.verdict === 'mismatch').map((c) => ({ no: c.no, actor: c.actor, fn: c.fn, request: c.request, expect: c.expect_text, http_status: c.http_status, problems: c.problems }));
  result.undetermined = cells.filter((c) => c.verdict === 'unverified').map((c) => ({ no: c.no, actor: c.actor, fn: c.fn, request: c.request, problems: c.problems }));
  result.observations = cells.filter((c) => c.observed).map((c) => ({ no: c.no, actor: c.actor, fn: c.fn, request: c.request, observed: c.observed }));
  result.finished_at = new Date().toISOString();
  writeOut(result);
  const s = result.summary;
  log(`phase=${result.phase}${result.state ? ' state=' + result.state : ''}${result.step ? ' step=' + result.step : ''}${result.kind ? ` kind=${result.kind}` : ''} 요청 ${requestCount}건 — 통과 ${s.pass} · 기대와 다름 ${s.mismatch} · 미확인 ${s.unverified} · 금지 키·값 ${s.leaks}`);
  for (const m of result.mismatches.slice(0, 14)) log(`  기대와 다름 #${m.no} ${m.actor} ${m.fn} ${m.request}: ${m.problems.join(' / ')}`);
  for (const m of result.undetermined.slice(0, 6)) log(`  미확인 #${m.no} ${m.actor} ${m.fn} ${m.request}: ${m.problems.join(' / ')}`);
  return s.mismatch === 0 && s.unverified === 0 && !(result.extra_problems?.length) ? 0 : 1;
}
const credentialsOut = () => Object.fromEntries(Object.entries(jwtInfo).map(([k, v]) => [k, { sub: v.sub, session_id: v.session_id, aal: v.aal, seconds_left_at_start: v.seconds_left_at_start }]));
function baseResult(extra) { return { tool: TOOL, target: TEST_URL, rpc_base: RPC_BASE, started_at: new Date().toISOString(), key_check: keyNotes, ...extra }; }
const cellOf = (no, actor, fn, method, request, expected, judged) => ({ no, actor, fn, method, request, expect_kind: expected.kind, expect_text: describeExpect(expected), why: expected.why ?? null, ...judged });

// ---------------------------------------------------------------------
// 대조표의 칸. 자격마다: 읽기 둘 → 쓰기 셋(각각 POST·GET·HEAD) → 쓰기 뒤 다시 읽기 둘(POST)
// 기대값은 그 자리에서 정한다(쓰기 뒤의 읽기는 방금 받은 응답이 기준이다)
function baseExpect(stateName, actor, method) {
  const s = STATES[stateName];
  const outside = actor === 'anon' || actor === 'service';
  const exempt = MAINT_EXEMPT.includes(actor);
  if (s.maint && s.hook && !exempt) return { kind: 'maintenance', why: '공통 확인이 먼저 거절한다(점검 중, 예외가 아님)' };
  if (method !== 'POST') return outside ? { kind: 'no_execute_or_method', why: '실행 권한이 없거나 POST 가 아니라서 거절' } : { kind: 'method', why: 'POST 가 아니면 거절(405)' };
  if (outside) return { kind: 'no_execute', why: '실행 권한이 없다' };
  if (s.maint && !exempt) return { kind: 'maintenance', why: '함수가 회원 행을 읽기 전에 점검을 확인해 거절한다' };
  switch (actor) {
    case 'member_a': case 'member_b': case 'admin_gm_pre': case 'admin_gm_post': return { kind: 'ok' };
    case 'no_map': case 'admin_g_pre': case 'admin_g_post': return { kind: 'state_only', state: 'no_member' };
    case 'blocked': case 'blocked_withdrawing': return { kind: 'state_only', state: 'blocked' };
    case 'withdrawing': return { kind: 'state_only', state: 'withdrawal_pending' };
    default: return { kind: 'unknown' };
  }
}
// 대조표에서 쓰기 함수에 보내는 유효한 값
function validArgs(fn, account, current, tag) {
  if (fn === 'my_intro_track_set') return { p_track: TRACKS.includes(current?.intro_book_track) ? current.intro_book_track : 'regular' };
  if (fn === 'my_marketing_consent_set') return { p_consent: true };
  if (fn === 'my_book_answers_hold') return { p_answers: holdPayload(account ?? 'x', tag) };
  return {};
}
function requestLabel(fn, method, args) {
  const short = fn === 'my_book_answers_hold' ? '{p_answers: 열두 항목}' : JSON.stringify(args);
  if (method === 'POST') return `POST ${FUNCS[fn].kind === 'read' ? '{}' : short}`;
  return FUNCS[fn].kind === 'read' ? method : `${method} ?${Object.keys(args).join('&')}=…`;
}
// 인자를 붙여 남을 고치려는 요청(자격 → 본문). b·a 는 expect 의 회원 값
function crossTargetRows(expect, actors) {
  const a = expect?.accounts?.a?.member; const b = expect?.accounts?.b?.member;
  const rows = [];
  if (actors.includes('member_a') && b) {
    rows.push({ actor: 'member_a', fn: 'my_settings', request: 'POST {"member_id": <B 의 회원번호>}', body: () => ({ member_id: b.id }) });
    rows.push({ actor: 'member_a', fn: 'my_book_answers', request: 'POST {"id": <B 의 회원번호>}', body: () => ({ id: b.id }) });
    rows.push({ actor: 'member_a', fn: 'my_intro_track_set', request: 'POST {"p_track":"regular","member_id": <B 의 회원번호>}', body: () => ({ p_track: 'regular', member_id: b.id }) });
    rows.push({ actor: 'member_a', fn: 'my_intro_track_set', request: 'POST {"p_track":"regular","email": <B 의 이메일>}', body: () => ({ p_track: 'regular', email: b.email }) });
    rows.push({ actor: 'member_a', fn: 'my_marketing_consent_set', request: 'POST {"p_consent":true,"member_id": <B 의 회원번호>}', body: () => ({ p_consent: true, member_id: b.id }) });
    rows.push({ actor: 'member_a', fn: 'my_marketing_consent_set', request: 'POST {"p_consent":true,"p_consent_at":"2001-01-01T00:00:00Z"} (시각을 넘기려 함)', body: () => ({ p_consent: true, p_consent_at: '2001-01-01T00:00:00Z' }) });
    rows.push({ actor: 'member_a', fn: 'my_book_answers_hold', request: 'POST {"p_answers": 열두 항목, "member_id": <B 의 회원번호>}', body: () => ({ p_answers: holdPayload('a', 'cross'), member_id: b.id }) });
  }
  if (actors.includes('member_b') && a) rows.push({ actor: 'member_b', fn: 'my_intro_track_set', request: 'POST {"p_track":"australia","id": <A 의 회원번호>}', body: () => ({ p_track: 'australia', id: a.id }) });
  return rows;
}
function planRows(stateName) {
  const rows = []; let no = 0;
  for (const actor of MATRIX_ACTORS) {
    for (const fn of FN_ORDER) for (const method of ['POST', 'GET', 'HEAD']) rows.push({ no: ++no, actor, fn, request: requestLabel(fn, method, validArgs(fn, 'x', null, 'm')), expect: describeExpect({ ...baseExpect(stateName, actor, method), what: '함수별 값' }) });
    for (const fn of ['my_settings', 'my_book_answers']) rows.push({ no: ++no, actor, fn, request: 'POST {} (쓰기 뒤 다시 읽기)', expect: describeExpect({ ...baseExpect(stateName, actor, 'POST'), what: '방금 쓴 값 그대로' }) });
  }
  for (const r of crossTargetRows({ accounts: { a: { member: { id: 'A', email: 'A' } }, b: { member: { id: 'B', email: 'B' } } } }, MATRIX_ACTORS)) rows.push({ no: ++no, actor: r.actor, fn: r.fn, request: r.request, expect: describeExpect({ kind: 'args_no_data' }) });
  return rows;
}
function phasePlan() {
  const state = arg('--state') ?? 'normal';
  if (!STATES[state]) stop(2, '--state 는 normal | normal-hook | maint | maint-hook');
  const rows = planRows(state);
  for (const r of rows) console.log(`${String(r.no).padStart(3)}  ${r.actor.padEnd(20)} ${r.fn.padEnd(26)} ${r.request.padEnd(44)} → ${r.expect}`);
  writeOut({ tool: TOOL, phase: 'plan', state, rows, request_count: 0 });
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
  writeOut({ tool: TOOL, phase: 'sessions-sql', request_count: 0, credentials: found, sql, note: 'session_id·sub 는 식별값이다(자격이 아니다)' });
  log(`phase=sessions-sql 요청 0건 — 자격 ${found.length}개`);
  return 0;
}
async function phaseAbsent() {
  const expect = loadResult(arg('--expect'), '--expect');
  checkExpectShape(expect);
  checkTarget(true);
  loadLogin('member_a', expect);
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunctions: false });
  const result = baseResult({ phase: 'absent', rule: '통과 = DB 카탈로그에 다섯 함수가 없음(지문) + 그 RPC 가 404·code PGRST202("등록되지 않은 함수")로 응답함, 둘 다. 일반 404 만으로는 통과가 아니다', fingerprint_check: fpCheck, credentials: credentialsOut() });
  const ctx = (actor) => ({ forbidden: forbiddenValues(expect, null), owner: ACCOUNT_OF(actor) });
  const cells = []; let no = 0;
  for (const actor of ['member_a', 'anon', 'service']) for (const fn of FN_ORDER) {
    const args = validArgs(fn, ACCOUNT_OF(actor), null, 'absent');
    const res = await call(actor, fn, 'POST', args);
    const exp = { kind: 'not_found_fn' };
    const j = judge(exp, res, 'POST', ctx(actor));
    if (fpCheck.problems.length) { j.verdict = 'mismatch'; j.problems.push(...fpCheck.problems.map((p) => `지문: ${p}`)); }
    cells.push(cellOf(++no, actor, fn, 'POST', requestLabel(fn, 'POST', args), exp, j));
  }
  return finish(result, cells);
}
async function phaseMatrix() {
  const state = arg('--state');
  if (!STATES[state]) stop(2, '--state 는 normal | normal-hook | maint | maint-hook');
  const actors = arg('--actors') ? arg('--actors').split(',').map((s) => s.trim()) : MATRIX_ACTORS;
  for (const a of actors) if (!MATRIX_ACTORS.includes(a)) stop(2, `모르는 자격: ${a}`);
  const expect = loadResult(arg('--expect'), '--expect');
  checkExpectShape(expect);
  checkTarget(actors.includes('service'));
  const logins = actors.filter((a) => LOGINS[a]);
  for (const l of logins) loadLogin(l, expect);
  checkDistinctSessions(logins);
  const rows = loadRows(arg('--rows'));
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunctions: true, state, expect });
  if (fpCheck.problems.length) { writeOut(baseResult({ phase: 'matrix', state, stopped: '기준선 불일치', fingerprint_check: fpCheck, request_count: 0 })); stop(3, `기준선 불일치 — ${fpCheck.problems.join(' / ')}`); }
  const sessionCheck = logins.length ? checkSessions(arg('--sessions-alive'), Object.fromEntries(logins.map((l) => [l, 'alive']))) : null;
  // 읽기의 여러 경우가 이 재기의 시작 상태에 있는가(없으면 그 경우는 재지 못한다 — 적어 둔다)
  const sA = rows.by.a.settings; const sB = rows.by.b.settings; const sGM = rows.by.gm.settings;
  const coverage = {
    track_supported_and_unsupported: TRACKS.includes(sA.intro_book_track) && !TRACKS.includes(sGM.intro_book_track),
    consent_true_false_null: [sA, sB, sGM].some((s) => s.marketing_consent === true) && [sA, sB, sGM].some((s) => s.marketing_consent === false) && [sA, sB, sGM].some((s) => s.marketing_consent == null),
    answers_present_none_oldformat: projectStored(sA).answers != null && sB.pending_is_sql_null === true && jsonType(sGM.pending_book_request) === 'object' && Object.keys(sGM.pending_book_request).some((k) => !ANSWER_KEYS_OUT.includes(k)),
  };
  if (!argv.includes('--allow-any-start') && Object.values(coverage).includes(false)) stop(3, `시작 상태가 합성 자료의 처음 값이 아니다(${JSON.stringify(coverage)}). fixtures_reset.sql 을 먼저 실행하고 rows_md5.sql 을 다시 뜰 것`);
  const result = baseResult({ phase: 'matrix', state, state_meaning: STATES[state], actors, fingerprint_check: fpCheck, session_check: sessionCheck, credentials: credentialsOut(), maintenance_exempt: STATES[state].maint ? MAINT_EXEMPT : null, rows_read_at: rows.raw.read_at, start_coverage: coverage });
  const forbidden = forbiddenValues(expect, rows.by);
  const ledger = newLedger(rows.by);
  // 계정마다 "지금 저장돼 있을 것"(도구가 아는 한): 설정 값과 my_book_answers 의 기대 응답
  const known = {};
  for (const l of ['a', 'b', 'gm']) { const s = rows.by[l].settings; known[l] = { settings: { intro_book_track: s.intro_book_track ?? null, marketing_consent: s.marketing_consent ?? null, marketing_consent_at: s.marketing_consent_at ?? null }, answers: projectStored(s) }; }
  const cells = []; let no = 0;
  const tag = `m${Date.now().toString(36)}`;
  for (const actor of actors) {
    const account = ACCOUNT_OF(actor);
    const ctx = { forbidden, owner: account };
    const okFor = (fn, args, returnedCellRef) => {
      const k = known[account];
      if (fn === 'my_settings') return okSettings(k.settings);
      if (fn === 'my_book_answers') return k.answers.state === 'ok' ? okAnswers(k.answers.answers) : { kind: 'state_only', state: 'answers_corrupt' };
      if (fn === 'my_intro_track_set') return okTrack(args.p_track);
      if (fn === 'my_marketing_consent_set') return okConsent();
      return okHold(args.p_answers);
    };
    const afterWrite = (fn, args, cell) => {
      if (cell.verdict !== 'pass' || cell.body_state !== 'ok' || !known[account]) return;
      applyReturned(ledger, account, fn, cell);
      if (fn === 'my_intro_track_set') known[account].settings.intro_book_track = args.p_track;
      if (fn === 'my_marketing_consent_set') { known[account].settings.marketing_consent = true; known[account].settings.marketing_consent_at = cell.returned.marketing_consent_at; }
      if (fn === 'my_book_answers_hold') known[account].answers = { state: 'ok', answers: { ...args.p_answers, answered_at: cell.returned.answered_at } };
    };
    for (const fn of FN_ORDER) for (const method of ['POST', 'GET', 'HEAD']) {
      const args = validArgs(fn, account, known[account]?.settings, tag);
      let exp = baseExpect(state, actor, method);
      if (exp.kind === 'ok') exp = { ...okFor(fn, args), why: exp.why };
      const res = await call(actor, fn, method, args, FUNCS[fn].kind === 'write' ? args : null);
      const cell = cellOf(++no, actor, fn, method, requestLabel(fn, method, args), exp, judge(exp, res, method, ctx));
      if (method === 'POST' && FUNCS[fn].kind === 'write') afterWrite(fn, args, cell);
      cells.push(cell);
    }
    // 쓰기 뒤 다시 읽기: 방금 받은 응답과 같은 값이 저장돼 있는가(본인 것만)
    for (const fn of ['my_settings', 'my_book_answers']) {
      let exp = baseExpect(state, actor, 'POST');
      if (exp.kind === 'ok') exp = okFor(fn, {});
      const res = await call(actor, fn, 'POST', {});
      cells.push(cellOf(++no, actor, fn, 'POST', 'POST {} (쓰기 뒤 다시 읽기)', exp, judge(exp, res, 'POST', ctx)));
    }
  }
  for (const r of crossTargetRows(expect, actors)) {
    const exp = { kind: 'args_no_data', why: '정해 둔 인자 말고는 받지 않는다 — 어느 쪽이 먼저 거절하든 값이 오지 않아야 하고 남의 행이 고쳐지면 안 된다(rows-effect)' };
    const res = await call(r.actor, r.fn, 'POST', r.body());
    cells.push(cellOf(++no, r.actor, r.fn, 'POST', r.request, exp, judge(exp, res, 'POST', { forbidden, owner: ACCOUNT_OF(r.actor) })));
  }
  // 공통 확인이 실제로 도는가는 유효한 POST 로 본다
  const post = (actor, fn) => cells.find((c) => c.actor === actor && c.fn === fn && c.method === 'POST' && !c.request.includes('다시 읽기') && c.expect_kind !== 'args_no_data');
  const is503 = (c) => !!c && c.verdict === 'pass' && c.http_status === 503;
  const s = STATES[state];
  result.hook_evidence = !s.hook ? null : !s.maint
    ? { note: '점검이 꺼진 상태에서는 공통 확인이 전부 통과시킨다 — 도는지의 입증은 maint-hook 에서 한다' }
    : {
      rule: '유효한 POST 로 본다(함수 다섯 모두): 일반 회원 → 503, 예외 회원 → 본인 것만, 공개 키·서비스 열쇠 → 503(공통 확인이 함수보다 먼저 돈다)',
      general_member_post_is_503: actors.includes('member_b') ? FN_ORDER.every((fn) => is503(post('member_b', fn))) : null,
      exempt_member_gets_own_only: actors.includes('member_a') ? FN_ORDER.every((fn) => { const c = post('member_a', fn); return !!c && c.verdict === 'pass' && c.body_state === 'ok'; }) : null,
      outside_roles_post_is_503: ['anon', 'service'].filter((a) => actors.includes(a)).every((a) => FN_ORDER.every((fn) => is503(post(a, fn)))),
    };
  result.expected_effects = ledgerOut(ledger);
  return finish(result, cells);
}

// ---------------------------------------------------------------------
// 효과 재기: 한 단계 = 앞 스냅숏(--rows) → 이 단계의 요청 → (브레인방이 뒤 스냅숏) → rows-effect
function invalidHoldCases(account) {
  const base = () => holdPayload(account, 'rej');
  const w = (patch) => ({ ...base(), ...patch });
  const drop = (k) => { const o = base(); delete o[k]; return o; };
  return [
    ['null', null, 'not_object'], ['배열', [], 'not_object'], ['글자', 'zzb3c-not-object', 'not_object'], ['숫자', 5, 'not_object'], ['참', true, 'not_object'],
    ['answered_at 을 넣음', w({ answered_at: '2001-01-01T00:00:00.000Z' }), 'unknown_key'], ['member_id 를 넣음', w({ member_id: '00000000-0000-4000-8000-000000000000' }), 'unknown_key'],
    ['그 밖의 키', w({ note: 'x' }), 'unknown_key'], ['user_agent 가 빠짐', drop('user_agent'), 'missing_key'], ['빈 객체', {}, 'missing_key'],
    ['current_score 글자', w({ current_score: '75' }), 'current_score'], ['current_score 음수', w({ current_score: -0.5 }), 'current_score'], ['current_score 120.5', w({ current_score: 120.5 }), 'current_score'], ['current_score 0.5 단위 아님', w({ current_score: 75.3 }), 'current_score'],
    ['target_score 0', w({ target_score: 0 }), 'target_score'], ['target_score null', w({ target_score: null }), 'target_score'], ['target_score 120.5', w({ target_score: 120.5 }), 'target_score'], ['target_score 글자', w({ target_score: '100' }), 'target_score'], ['target_score 0.5 단위 아님', w({ target_score: 99.9 }), 'target_score'],
    ['no_target_score true', w({ no_target_score: true }), 'no_target_score'], ['no_target_score 글자', w({ no_target_score: 'false' }), 'no_target_score'], ['no_target_score null', w({ no_target_score: null }), 'no_target_score'],
    ['stuck_area 목록 밖', w({ stuck_area: 'reading' }), 'stuck_area'], ['stuck_area null', w({ stuck_area: null }), 'stuck_area'],
    ['goal_timeframe 목록 밖', w({ goal_timeframe: '1년 안에' }), 'goal_timeframe'], ['goal_timeframe 숫자', w({ goal_timeframe: 3 }), 'goal_timeframe'],
    ['referral_source 목록 밖', w({ referral_source: '유튜브' }), 'referral_source'], ['referral_source 빈 글자', w({ referral_source: '' }), 'referral_source'],
    ['기타인데 상세 null', w({ referral_source_detail: null }), 'referral_source_detail'], ['기타인데 상세 빈 글자', w({ referral_source_detail: '' }), 'referral_source_detail'], ['기타인데 상세 공백만', w({ referral_source_detail: '   ' }), 'referral_source_detail'],
    ['상세 201자', w({ referral_source_detail: strOf(LIMITS.detail + 1, 'zzb3c-hold-' + account + '-') }), 'referral_source_detail'], ['기타가 아닌데 상세 있음', w({ referral_source: '블로그' }), 'referral_source_detail'],
    // 공백 글자만으로 된 상세: 화면의 trim() 이 빈 글자로 만드는 것은 서버도 거절해야 한다(SQL 의 기본 btrim 은 빈칸만 지운다)
    ['기타인데 상세가 탭만', w({ referral_source_detail: '\t\t' }), 'referral_source_detail'], ['기타인데 상세가 줄바꿈만', w({ referral_source_detail: '\n\r\n' }), 'referral_source_detail'],
    ['기타인데 상세가 전각 빈칸(U+3000)만', w({ referral_source_detail: '\u3000\u3000' }), 'referral_source_detail'], ['기타인데 상세가 U+00A0 만', w({ referral_source_detail: '\u00A0' }), 'referral_source_detail'],
    ['기타인데 상세가 여러 공백 글자의 섞임', w({ referral_source_detail: ' \u3000\t\u00A0\u2003\uFEFF\n' }), 'referral_source_detail'],
    // 여러 바이트 글자의 길이 경계(글자 수 = 코드 포인트): 상한 + 1
    ['상세 한글 201자', w({ referral_source_detail: fill('zzb3c-hold-' + account + '-', LIMITS.detail + 1, KO) }), 'referral_source_detail'], ['상세 4바이트 글자 201자', w({ referral_source_detail: fill('zzb3c-hold-' + account + '-', LIMITS.detail + 1, ASTRAL) }), 'referral_source_detail'],
    ['user_agent 한글 513자', w({ user_agent: fill('zzb3c-hold-' + account + '-', LIMITS.agent + 1, KO) }), 'user_agent'],
    ['referrer_url 한글 2049자', w({ referrer_url: fill('https://ref.zzb3c.invalid/zzb3c-hold-' + account + '-', LIMITS.url + 1, KO) }), 'referrer_url'], ['landing_url 한글 2049자', w({ landing_url: fill('https://land.zzb3c.invalid/zzb3c-hold-' + account + '-', LIMITS.url + 1, KO) }), 'landing_url'],
    ['utm_data 값 한글 201자', w({ utm_data: { utm_source: fill('zzb3c-hold-' + account + '-', LIMITS.utm + 1, KO) } }), 'utm_data'],
    // 전체 바이트의 경계: 항목별 상한은 전부 지키면서 전체만 넘긴다(상한 + 1, 상한 + 64)
    ['전체 16385 바이트(항목별 상한은 지킴)', payloadOfBytes(account, 'rejb1', LIMITS.bytes + 1), 'too_large'], ['전체 16448 바이트(항목별 상한은 지킴)', payloadOfBytes(account, 'rejb64', LIMITS.bytes + 64), 'too_large'],
    ['is_au_nz 목록 밖', w({ is_au_nz_direct_submit: 'maybe' }), 'is_au_nz_direct_submit'], ['is_au_nz 참거짓', w({ is_au_nz_direct_submit: true }), 'is_au_nz_direct_submit'],
    ['referrer_url 빈 글자', w({ referrer_url: '' }), 'referrer_url'], ['referrer_url 2049자', w({ referrer_url: strOf(LIMITS.url + 1, 'https://ref.zzb3c.invalid/') }), 'referrer_url'], ['referrer_url 숫자', w({ referrer_url: 123 }), 'referrer_url'], ['referrer_url 객체', w({ referrer_url: { href: 'x' } }), 'referrer_url'],
    ['landing_url 2049자', w({ landing_url: strOf(LIMITS.url + 1, 'https://land.zzb3c.invalid/') }), 'landing_url'], ['landing_url 배열', w({ landing_url: ['x'] }), 'landing_url'],
    ['user_agent 513자', w({ user_agent: strOf(LIMITS.agent + 1, 'zzb3c-hold-' + account + '-') }), 'user_agent'], ['user_agent 빈 글자', w({ user_agent: '' }), 'user_agent'],
    ['utm_data 배열', w({ utm_data: [] }), 'utm_data'], ['utm_data 빈 객체', w({ utm_data: {} }), 'utm_data'], ['utm_data 글자', w({ utm_data: 'utm_source=x' }), 'utm_data'], ['utm_data 모르는 키', w({ utm_data: { utm_other: 'x' } }), 'utm_data'],
    ['utm_data 값 빈 글자', w({ utm_data: { utm_source: '' } }), 'utm_data'], ['utm_data 값 201자', w({ utm_data: { utm_source: strOf(LIMITS.utm + 1, 'u') } }), 'utm_data'], ['utm_data 값이 객체(깊이 2)', w({ utm_data: { utm_source: { a: 'x' } } }), 'utm_data'], ['utm_data 값 숫자', w({ utm_data: { utm_source: 5 } }), 'utm_data'],
    ['전체 16384 바이트 초과', w({ user_agent: strOf(LIMITS.bytes + 200, 'u') }), 'too_large'],
  ].map(([label, value, details]) => ({ label, body: { p_answers: value }, expected: { kind: 'invalid', message: 'invalid_answers', details } }));
}
async function phaseEffect() {
  const step = arg('--step');
  const STEPS = ['track', 'consent', 'hold', 'bounds', 'rejects', 'coercion', 'race'];
  if (!STEPS.includes(step)) stop(2, `--step 은 ${STEPS.join(' | ')}`);
  const expect = loadResult(arg('--expect'), '--expect');
  checkExpectShape(expect);
  checkTarget(false);
  const logins = ['member_a', 'member_b'];
  for (const l of logins) loadLogin(l, expect);
  checkDistinctSessions(logins);
  const rows = loadRows(arg('--rows'));
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunctions: true, state: 'normal', expect });
  if (fpCheck.problems.length) stop(3, `기준선 불일치 — ${fpCheck.problems.join(' / ')}`);
  const sessionCheck = checkSessions(arg('--sessions-alive'), { member_a: 'alive', member_b: 'alive' });
  const result = baseResult({ phase: 'effect', step, fingerprint_check: fpCheck, session_check: sessionCheck, credentials: credentialsOut(), rows_read_at: rows.raw.read_at });
  const forbidden = forbiddenValues(expect, rows.by);
  const ledger = newLedger(rows.by);
  const cells = []; let no = 0;
  const tag = `${step[0]}${Date.now().toString(36)}`;
  const run = async (actor, fn, body, expected, label) => {
    const res = await call(actor, fn, 'POST', body);
    const cell = cellOf(++no, actor, fn, 'POST', label, expected, judge(expected, res, 'POST', { forbidden, owner: ACCOUNT_OF(actor) }));
    applyReturned(ledger, ACCOUNT_OF(actor), fn, cell);
    cells.push(cell);
    return { cell, res };
  };
  const extra = [];
  if (step === 'track') {
    // A: 지금 값과 다른 종류로 → 같은 값을 한 번 더(같은 결과) → 설정 읽기
    const cur = rows.by.a.settings.intro_book_track;
    const to = cur === 'australia' ? 'regular' : 'australia';
    result.meaning = `회원 A 의 종류를 ${TRACKS.includes(cur) ? cur : '(지원하지 않는 값)'} → ${to} 로. 바뀌어야 하는 것은 A 의 intro_book_track 한 열뿐`;
    await run('member_a', 'my_intro_track_set', { p_track: to }, okTrack(to), `POST {"p_track":"${to}"} (지금과 다른 값)`);
    await run('member_a', 'my_intro_track_set', { p_track: to }, okTrack(to), `POST {"p_track":"${to}"} (같은 값 한 번 더 — 같은 결과)`);
    const s = rows.by.a.settings;
    await run('member_a', 'my_settings', {}, okSettings({ intro_book_track: to, marketing_consent: s.marketing_consent, marketing_consent_at: s.marketing_consent_at }), 'POST {} (다시 읽기: 종류만 바뀌고 동의는 그대로)');
  } else if (step === 'consent') {
    // B: 동의 → 1.5초 뒤 다시 동의(시각을 새로 쓴다)
    const before = rows.by.b.settings;
    result.meaning = `회원 B(지금 동의 ${JSON.stringify(before.marketing_consent)})가 동의한다. 바뀌어야 하는 것은 B 의 marketing_consent · marketing_consent_at 뿐. 한 번 더 부르면 시각이 새로 쓰인다`;
    const r1 = await run('member_b', 'my_marketing_consent_set', { p_consent: true }, okConsent(), 'POST {"p_consent":true} (첫 번째)');
    await sleep(1500);
    const r2 = await run('member_b', 'my_marketing_consent_set', { p_consent: true }, okConsent(), 'POST {"p_consent":true} (두 번째 — 시각을 새로 쓴다)');
    const t1 = r1.cell.returned?.marketing_consent_at; const t2 = r2.cell.returned?.marketing_consent_at;
    result.consent_times = { first: t1 ?? null, second: t2 ?? null, second_is_later: !!t1 && !!t2 && Date.parse(t2) > Date.parse(t1), stored_before: before.marketing_consent_at ?? null };
    if (!result.consent_times.second_is_later) extra.push('두 번째 동의의 시각이 첫 번째보다 뒤가 아니다(부를 때마다 새로 써야 한다)');
    await run('member_b', 'my_settings', {}, okSettings({ intro_book_track: before.intro_book_track, marketing_consent: true, marketing_consent_at: t2 ?? null }), 'POST {} (다시 읽기: 동의만 바뀌고 종류는 그대로)');
  } else if (step === 'hold') {
    // B: 보관 → 모든 항목이 다른 한 벌로 덮어쓰기(항목이 합쳐지지 않는다) → 읽기
    const p1 = holdPayload('b', tag); const p2 = holdPayloadOther('b', tag);
    result.meaning = '회원 B 가 답변을 보관하고, 모든 항목이 다른 한 벌로 다시 보관한다. 바뀌어야 하는 것은 B 의 pending_book_request 한 열뿐이고, 남는 것은 두 번째 한 벌 전체다(앞 것의 항목이 섞여 남지 않는다)';
    await run('member_b', 'my_book_answers_hold', { p_answers: p1 }, okHold(p1), 'POST {p_answers: 한 벌 ㉮}');
    const r2 = await run('member_b', 'my_book_answers_hold', { p_answers: p2 }, okHold(p2), 'POST {p_answers: 한 벌 ㉯ (모든 항목이 ㉮와 다름, 널 여럿)}');
    await run('member_b', 'my_book_answers', {}, okAnswers({ ...p2, answered_at: r2.cell.returned?.answered_at ?? null }), 'POST {} (다시 읽기: ㉯ 전체)');
  } else if (step === 'bounds') {
    // A: 상한에 딱 맞는 값은 받는다(상한 + 1 은 rejects 단계가 거절을 본다)
    const m = `zzb3c-hold-a-${tag}`;
    const pMax = { current_score: 120, target_score: 120, no_target_score: false, stuck_area: '라이팅', goal_timeframe: '6개월 안에', referral_source: '기타', referral_source_detail: strOf(LIMITS.detail, m + '-'), is_au_nz_direct_submit: 'yes',
      referrer_url: strOf(LIMITS.url, `https://ref.zzb3c.invalid/${m}/`), landing_url: strOf(LIMITS.url, `https://land.zzb3c.invalid/${m}/`),
      utm_data: Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].map((k) => [k, strOf(LIMITS.utm, m + '-')])), user_agent: strOf(LIMITS.agent, m + '-') };
    const pMin = { current_score: 0, target_score: 0.5, no_target_score: false, stuck_area: '리딩', goal_timeframe: '한 달 안에', referral_source: '지인추천', referral_source_detail: null, is_au_nz_direct_submit: 'no', referrer_url: null, landing_url: null, utm_data: null, user_agent: null };
    result.meaning = '회원 A 가 상한에 딱 맞는 답변(주소 2048자 · user_agent 512자 · 상세 200자 · utm 값 200자 ×5 · 점수 120), 여러 바이트 글자로 상한에 딱 맞는 값(한글 · 4바이트 글자), 전체 16320 · 16384 바이트, 하한(현재 0 · 목표 0.5 · 널 다섯)을 보관한다. 전부 받아야 한다(상한 + 1 의 거절은 rejects 단계)';
    result.sent_bytes = { max_payload_as_pg_text: pgJsonbTextBytes(pMax), limit: LIMITS.bytes, note: '도구가 계산한 "PostgreSQL 이 jsonb 를 글자로 바꾼 것"의 바이트 수다. DB 의 실제 길이와 다르면 정확히 16384 · 16385 칸이 어긋난다 — 그때는 64바이트 떨어진 칸(16320 통과 · 16448 거절)이 맞는지를 함께 본다' };
    await run('member_a', 'my_book_answers_hold', { p_answers: pMax }, okHold(pMax), 'POST {p_answers: 상한에 딱 맞는 한 벌}');
    // 여러 바이트 글자의 길이 경계(글자 수 = 코드 포인트): 상한에 딱 맞는 값은 받는다
    const mb = (patch) => ({ ...holdPayload('a', tag), ...patch });
    const multi = [
      ['상세 한글 200자', mb({ referral_source_detail: fill(m + '-', LIMITS.detail, KO) })],
      ['상세 4바이트 글자 200자(UTF-16 단위로는 400 — 서버는 코드 포인트로 센다)', mb({ referral_source_detail: fill(m + '-', LIMITS.detail, ASTRAL) })],
      ['user_agent 한글 512자', mb({ user_agent: fill(m + '-', LIMITS.agent, KO) })],
      ['referrer_url 한글 2048자', mb({ referrer_url: fill(`https://ref.zzb3c.invalid/${m}/`, LIMITS.url, KO) })],
      ['utm_data 값 한글 200자', mb({ utm_data: { utm_term: fill(m + '-', LIMITS.utm, KO) } })],
      ['상세의 앞뒤에 전각 빈칸이 있고 가운데 글자가 있음(공백만이 아니다 — 받은 그대로 저장)', mb({ referral_source_detail: `\u3000${m}-가\u3000` })],
      ['전체 16320 바이트(상한 - 64)', payloadOfBytes('a', `${tag}b64`, LIMITS.bytes - 64)],
      ['전체 정확히 16384 바이트(상한)', payloadOfBytes('a', `${tag}b0`, LIMITS.bytes)],
    ];
    for (const [label, p] of multi) await run('member_a', 'my_book_answers_hold', { p_answers: p }, okHold(p), `POST {p_answers: ${label}}`);
    const r2 = await run('member_a', 'my_book_answers_hold', { p_answers: pMin }, okHold(pMin), 'POST {p_answers: 하한 한 벌}');
    await run('member_a', 'my_book_answers', {}, okAnswers({ ...pMin, answered_at: r2.cell.returned?.answered_at ?? null }), 'POST {} (다시 읽기: 하한 한 벌 전체)');
  } else if (step === 'rejects') {
    result.meaning = '잘못된 값은 전부 거절되고(400·PT400 또는 404·PGRST202) 아무 열도 바뀌지 않는다(이 단계의 앞뒤 스냅숏이 같아야 한다)';
    const inv = (message, details) => ({ kind: 'invalid', message, details });
    for (const [label, v] of [['null', null], ['대문자', 'Regular'], ['빈 글자', ''], ['그 밖의 값', 'canada'], ['앞뒤 공백', ' regular'], ['숫자', 123]]) await run('member_a', 'my_intro_track_set', { p_track: v }, inv('invalid_track'), `POST {"p_track": ${label}}`);
    // JSON 글자가 아닌 값: PostgREST 가 글자로 바꿔 넘겨도(참 → 'true', 배열 → '["regular"]') 허용 값 둘이 될 수 없다 — 전부 거절이어야 한다
    for (const [label, v] of [['참', true], ['거짓', false], ['배열 ["regular"]', ['regular']], ['객체 {"p_track":"regular"}', { p_track: 'regular' }]]) await run('member_a', 'my_intro_track_set', { p_track: v }, { ...inv('invalid_track'), other_reject_is_unverified: true }, `POST {"p_track": ${label}} (JSON 글자가 아닌 값)`);
    await run('member_a', 'my_intro_track_set', {}, { kind: 'missing_arg' }, 'POST {} (인자 없음)');
    for (const [label, v] of [['false', false], ['null', null]]) await run('member_a', 'my_marketing_consent_set', { p_consent: v }, inv('invalid_consent'), `POST {"p_consent": ${label}}`);
    await run('member_a', 'my_marketing_consent_set', {}, { kind: 'missing_arg' }, 'POST {} (인자 없음)');
    await run('member_a', 'my_book_answers_hold', {}, { kind: 'missing_arg' }, 'POST {} (인자 없음)');
    for (const c of invalidHoldCases('a')) await run('member_a', 'my_book_answers_hold', c.body, c.expected, `POST {p_answers: ${c.label}}`);
    // 올바른 열두 항목의 객체를 "글자로 쓴 것"(JSON 글자): 객체로 풀어 받으면 안 된다 — 객체가 아니므로 거절
    await run('member_a', 'my_book_answers_hold', { p_answers: JSON.stringify(holdPayload('a', 'rejstr')) }, { ...inv('invalid_answers', 'not_object'), other_reject_is_unverified: true }, 'POST {p_answers: 올바른 한 벌을 글자로 쓴 것(JSON 글자)}');
    // 남을 겨냥한 것: B 의 번호를 답변 안에 넣음(위의 member_id 경우와 같은 규칙), B 가 A 를 겨냥
    await run('member_b', 'my_book_answers_hold', { p_answers: { ...holdPayload('b', 'rej'), id: expect.accounts.a.member.id } }, inv('invalid_answers', 'unknown_key'), 'POST {p_answers: 열두 항목 + "id": <A 의 회원번호>}');
    await run('member_b', 'my_marketing_consent_set', { p_consent: false }, inv('invalid_consent'), 'POST {"p_consent": false} (B — 철회는 없다)');
  } else if (step === 'coercion') {
    // PostgREST 가 JSON 값을 boolean 으로 어떻게 바꾸는지 모른다(글자 "true", 숫자 1 등). 관측해서 적는다.
    // 계약은 "참만"이다. 3차부터 인자의 형이 jsonb 라 함수가 JSON 의 형을 그대로 본다 — JSON 의 true 가 아닌 값은
    // **전부 400·PT400·invalid_consent 로 거절되는 것이 기대값**이다. 하나라도 동의로 받아들여져 동의 시각을 바꾸면 통과가 아니다.
    result.meaning = 'p_consent 에 JSON true 가 아닌 값 여덟(글자 · 숫자 · 배열 · 객체)을 넣는다. 여덟 전부 400·PT400·invalid_consent 로 거절돼야 한다(인자의 형이 jsonb — 함수가 JSON 의 형을 그대로 본다). 하나라도 동의로 받아들여지면(200 ok — 동의 시각이 새로 쓰인다) "JSON 참만"은 통과가 아니다. 받아들여진 효과가 있으면 expected_effects 에 반영된다 — rows-effect 는 그 효과가 A 의 그 열에만 있는지를 본다';
    const wantReject = { kind: 'invalid', message: 'invalid_consent' };
    for (const [label, v] of [['글자 "true"', 'true'], ['숫자 1', 1], ['글자 "yes"', 'yes'], ['글자 "t"', 't'], ['글자 "false"', 'false'], ['숫자 0', 0], ['배열 [true]', [true]], ['객체 {"value":true}', { value: true }]]) {
      const res = await call('member_a', 'my_marketing_consent_set', 'POST', { p_consent: v });
      const accepted = res.status === 200 && res.json && res.json.state === 'ok';
      // 받아들여졌으면 실제로 쓰인 것이다 — 응답의 시각을 장부에 적으려고 ok 의 모양으로 읽고, 판정은 아래에서 기대와 다름으로 바꾼다
      const exp = accepted ? { ...okConsent(), kind: 'ok' } : wantReject;
      const cell = cellOf(++no, 'member_a', 'my_marketing_consent_set', 'POST', `POST {"p_consent": ${label}}`, wantReject, judge(exp, res, 'POST', { forbidden, owner: 'a' }));
      cell.observed = accepted ? '받아들여짐(200 ok — 참으로 바뀌어 넘어갔고 동의 시각이 새로 쓰였다)' : `거절(${res.status}·${cell.code})`;
      applyReturned(ledger, 'a', 'my_marketing_consent_set', cell); // 효과는 판정을 바꾸기 전에 장부에 적는다(실제로 쓰였으므로)
      if (accepted) { cell.verdict = 'mismatch'; cell.problems.push('JSON true 가 아닌 값이 동의로 받아들여져 동의 시각을 바꿨다 — "JSON 참만"이 아니다'); }
      cells.push(cell);
    }
    result.accepted_non_boolean = cells.filter((c) => c.observed.startsWith('받아들여짐')).map((c) => c.request);
    result.json_true_only = { holds: result.accepted_non_boolean.length === 0, accepted: result.accepted_non_boolean, all_rejected_with_invalid_consent: cells.every((c) => c.verdict === 'pass' && c.http_status === 400 && c.code === 'PT400'), meaning: result.accepted_non_boolean.length === 0 ? 'JSON true 가 아닌 값은 하나도 동의로 받아들여지지 않았다' : '"JSON 참만"이 아니다 — JSON true 가 아닌 값이 동의로 받아들여졌다(인자의 형이 jsonb 인데도 — 함수의 본문이나 적용된 판을 확인할 것)' };
  } else if (step === 'race') {
    // 두 창: A 가 서로 다른 두 벌을 동시에 보낸다. 남은 것이 둘 중 한 벌 "전체"인가(항목이 섞이지 않았는가)
    const rounds = 5; const winners = [];
    result.meaning = '회원 A 가 서로 다른 두 벌을 동시에 보관한다(5번). 남는 것은 마지막으로 DB 에 반영된 한 벌 전체여야 한다(두 벌의 항목이 섞이면 안 된다). 이것은 "오래된 창의 덮어쓰기를 막는다"는 뜻이 아니다 — 어느 쪽이 남는지는 정해져 있지 않다';
    for (let i = 1; i <= rounds; i++) {
      const pX = holdPayload('a', `${tag}x${i}`); const pY = holdPayloadOther('a', `${tag}y${i}`);
      const [rx, ry] = await Promise.all([call('member_a', 'my_book_answers_hold', 'POST', { p_answers: pX }), call('member_a', 'my_book_answers_hold', 'POST', { p_answers: pY })]);
      const cx = cellOf(++no, 'member_a', 'my_book_answers_hold', 'POST', `POST {p_answers: ㉮} (동시 ${i}/${rounds})`, okHold(pX), judge(okHold(pX), rx, 'POST', { forbidden, owner: 'a' }));
      const cy = cellOf(++no, 'member_a', 'my_book_answers_hold', 'POST', `POST {p_answers: ㉯} (동시 ${i}/${rounds})`, okHold(pY), judge(okHold(pY), ry, 'POST', { forbidden, owner: 'a' }));
      cells.push(cx, cy);
      const rr = await call('member_a', 'my_book_answers', 'POST', {});
      const got = rr.json && rr.json.state === 'ok' ? rr.json.answers : null;
      const isX = !!got && ANSWER_KEYS.every((k) => sameJson(got[k], pX[k])) && got.answered_at === cx.returned?.answered_at;
      const isY = !!got && ANSWER_KEYS.every((k) => sameJson(got[k], pY[k])) && got.answered_at === cy.returned?.answered_at;
      const want = isX ? { ...pX, answered_at: cx.returned.answered_at } : isY ? { ...pY, answered_at: cy.returned.answered_at } : null;
      const expRead = want ? okAnswers(want) : { kind: 'ok', what: '둘 중 한 벌 전체', check: () => ['남은 답변이 ㉮ 전체도 ㉯ 전체도 아니다(항목이 섞였거나 answered_at 이 응답과 다르다)'] };
      cells.push(cellOf(++no, 'member_a', 'my_book_answers', 'POST', `POST {} (동시 ${i}/${rounds} 뒤 읽기)`, expRead, judge(expRead, rr, 'POST', { forbidden, owner: 'a' })));
      winners.push(isX ? '㉮' : isY ? '㉯' : '섞임 또는 불명');
      ledger.now.a.answers_sha256 = got ? sha256(canon(got)) : ledger.now.a.answers_sha256; // 마지막으로 남은 것이 기준이다
    }
    result.race = { rounds, left_in_db: winners, mixed: winners.filter((w) => w.startsWith('섞임')).length, note: '어느 쪽이 남는지는 관측일 뿐 기대값이 아니다. 섞임이 0 이어야 한다' };
  }
  result.extra_problems = extra;
  for (const e of extra) log(`  문제: ${e}`);
  result.expected_effects = ledgerOut(ledger);
  return finish(result, cells);
}

// 저장된 답변의 모양별 읽기(answers_variant.sql 로 넣은 값). 읽기만 — 아무 열도 바뀌지 않아야 한다
function variantStored(name) {
  const b = () => JSON.parse(JSON.stringify(VARIANT_BASE));
  const o = b();
  switch (name) {
    case 'json_null': return { pending_book_request: null, pending_is_sql_null: false };
    case 'sql_null': return { pending_book_request: null, pending_is_sql_null: true };
    case 'array': return { pending_book_request: [] };
    case 'string': return { pending_book_request: 'zzb3c-variant-not-an-object' };
    case 'number': return { pending_book_request: 5 };
    case 'missing_key': delete o.user_agent; return { pending_book_request: o };
    case 'wrong_type': o.target_score = '95'; return { pending_book_request: o };
    case 'required_null': o.stuck_area = null; return { pending_book_request: o };
    case 'answered_at_number': o.answered_at = 12345; return { pending_book_request: o };
    case 'extra_keys': o.zz_legacy_note = 'zzb3c-variant-extra'; o.privacy_agreement = true; return { pending_book_request: o };
    case 'no_answered_at': delete o.answered_at; return { pending_book_request: o };
    case 'nullable_all_null': for (const k of ['current_score', 'referral_source_detail', 'referrer_url', 'landing_url', 'utm_data', 'user_agent']) o[k] = null; return { pending_book_request: o };
    case 'utm_extra_key': o.utm_data = { utm_medium: 'zzb3c-utm-variant', zz_other: 'zzb3c-variant-utm-extra' }; return { pending_book_request: o };
    case 'utm_nested': o.utm_data = { utm_source: { nested: 'zzb3c-variant-utm-nested' } }; return { pending_book_request: o };
    case 'utm_nonstring': o.utm_data = { utm_medium: 'zzb3c-utm-variant', utm_term: 5 }; return { pending_book_request: o };
    case 'answered_at_not_time': o.answered_at = 'zzb3c-variant-not-a-time'; return { pending_book_request: o };
    case 'answered_at_bad_date': o.answered_at = '2026-13-45T99:99:99.000Z'; return { pending_book_request: o };
    case 'answered_at_offset': o.answered_at = '2026-02-03T13:05:06.789012+09:00'; return { pending_book_request: o };
    default: return null;
  }
}
async function phaseVariants() {
  const round = Number(arg('--round'));
  if (!VARIANT_ROUNDS[round]) stop(2, '--round 는 1 ~ 6');
  const expect = loadResult(arg('--expect'), '--expect');
  checkExpectShape(expect);
  const applied = loadResult(arg('--variant'), '--variant(answers_variant.sql 의 마지막 결과)');
  if (String(applied?.round) !== String(round) || !sameJson(applied?.variants, VARIANT_ROUNDS[round])) stop(3, `--variant 가 ${round}차의 결과가 아니다(answers_variant.sql 을 set b3c.variant_round = '${round}' 로 실행한 결과여야 한다)`);
  if (!applied.read_at || ageSeconds(applied.read_at) > 1800) stop(2, '--variant 가 30분보다 오래됐다. 다시 실행할 것');
  checkTarget(false);
  const actorOf = { a: 'member_a', b: 'member_b', gm: 'admin_gm_post' };
  const logins = Object.values(actorOf);
  for (const l of logins) loadLogin(l, expect);
  checkDistinctSessions(logins);
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunctions: true, state: 'normal', expect });
  if (fpCheck.problems.length) stop(3, `기준선 불일치 — ${fpCheck.problems.join(' / ')}`);
  const sessionCheck = checkSessions(arg('--sessions-alive'), Object.fromEntries(logins.map((l) => [l, 'alive'])));
  const result = baseResult({ phase: 'variants', round, variants: VARIANT_ROUNDS[round], fingerprint_check: fpCheck, session_check: sessionCheck, credentials: credentialsOut(), meaning: '저장된 값의 모양별로 my_book_answers() 가 "보관 없음"(SQL NULL → ok·answers null) · 파손(answers_corrupt, 값 없음) · 정상(열두 항목 + answered_at 만)을 섞지 않는가. 같은 때 my_settings() 는 그대로 ok 인가' });
  // 이 단계에서 본인 응답에 허용하는 답변 글자는 바탕 값의 것뿐이다
  const allForbidden = forbiddenValues(expect, null);
  const forbidden = allForbidden.filter((f) => !f.answers);
  forbidden.passwordHashes = allForbidden.passwordHashes;
  for (const s of collectStrings(VARIANT_BASE, [])) if (s.includes('zzb3c')) for (const acc of ['a', 'b', 'gm']) forbidden.push({ owner: acc, field: 'answers(모양 시험의 바탕 값)', value: s, answers: true });
  const cells = []; let no = 0; const expectedStates = {};
  for (const [acc, name] of Object.entries(VARIANT_ROUNDS[round])) {
    const proj = projectStored(variantStored(name));
    expectedStates[acc] = { variant: name, expect: proj.state === 'ok' ? (proj.answers === null ? 'ok · answers null' : 'ok · 열두 항목 + answered_at') : proj.state };
    const exp = proj.state === 'ok' ? okAnswers(proj.answers) : { kind: 'state_only', state: 'answers_corrupt', why: `저장된 값의 모양: ${name}` };
    const res = await call(actorOf[acc], 'my_book_answers', 'POST', {});
    cells.push(cellOf(++no, actorOf[acc], 'my_book_answers', 'POST', `POST {} (저장된 모양: ${name})`, exp, judge(exp, res, 'POST', { forbidden, owner: acc })));
    const res2 = await call(actorOf[acc], 'my_settings', 'POST', {});
    const exp2 = okSettings(null);
    cells.push(cellOf(++no, actorOf[acc], 'my_settings', 'POST', `POST {} (답변의 모양이 ${name} 일 때의 설정 읽기)`, exp2, judge(exp2, res2, 'POST', { forbidden, owner: acc })));
  }
  result.expected_by_member = expectedStates;
  result.expected_effects = { rule: '읽기만 했다 — 이 단계의 앞뒤 스냅숏에서 아무 열도 바뀌지 않아야 한다', successful_writes: 0, by_member: Object.fromEntries(ROW_LABELS.map((l) => [l, { changed_columns: [], final: null, consent_times_from_responses: [] }])) };
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
  checkExpectShape(expect);
  checkTarget(false);
  const subject = kind === 'expired' ? 'a_expire' : kind === 'loggedout' ? 'a_logout' : 'a_old';
  const jwtPost = kind === 'jwt-expired' && step === 'post';
  loadLogin('member_a', expect);
  // JWT 는 유효해야 한다(로그인 기록이 끝난 것과 JWT 만료를 가르려면). jwt-expired 의 post 는 반대로 만료돼 있어야 한다.
  loadLogin(subject, expect, jwtPost ? { mustBeExpired: true } : { minSeconds: kind === 'jwt-expired' ? 30 : 120 });
  checkDistinctSessions(['member_a', subject]);
  // 같은 JWT 인지 가르는 지문: 글자의 sha256 앞 12자와 만료 시각(자격 글자는 적지 않는다)
  const subjectFingerprint = { sha256_12: sha256(jwts[subject]).slice(0, 12), exp: decodeJwtPayload(jwts[subject]).exp ?? null, session_id: jwtInfo[subject].session_id };
  let pairCheck = null;
  if (jwtPost) {
    const pre = loadResult(arg('--pre'), '--pre(만료 전에 같은 JWT 로 잰 jwt-expired pre 의 결과)');
    const preCells = (pre.cells ?? []).filter((c) => c.actor === 'a_old');
    if (pre.phase !== 'revoked' || pre.kind !== 'jwt-expired' || pre.step !== 'pre') stop(2, '--pre 파일이 jwt-expired pre 의 결과가 아니다');
    if (preCells.length !== FN_ORDER.length || !preCells.every((c) => c.verdict === 'pass' && c.body_state === 'ok')) stop(2, '--pre 의 그 자격 칸 다섯이 전부 통과(ok)가 아니다 — 만료 전 성공이 없으면 한 쌍이 되지 않는다');
    const f = pre.subject_jwt ?? {};
    if (f.sha256_12 !== subjectFingerprint.sha256_12 || f.exp !== subjectFingerprint.exp || f.session_id !== subjectFingerprint.session_id) stop(2, '지금의 B3C_JWT_A_OLD 가 --pre 때의 JWT 와 같은 글자가 아니다. 같은 JWT 로 만료 전·후를 재야 한다');
    pairCheck = { same_jwt_as_pre: true, pre_finished_at: pre.finished_at ?? null, pre_cells_ok: preCells.length };
  }
  const fpCheck = checkFingerprint(loadResult(arg('--fingerprint'), '--fingerprint'), { wantFunctions: true, state: 'normal', expect });
  if (fpCheck.problems.length) stop(3, `기준선 불일치 — ${fpCheck.problems.join(' / ')}`);
  const want = { member_a: 'alive' };
  // jwt-expired 는 앞뒤 모두 로그인 기록이 살아 있어야 한다(거절이 기록 종료가 아니라 JWT 만료 때문임을 가르려면)
  want[subject] = kind === 'jwt-expired' ? 'alive' : step === 'post' ? (kind === 'expired' ? 'expired' : 'gone') : 'alive';
  const sessionCheck = checkSessions(arg('--sessions-alive'), want);
  const rows = loadRows(arg('--rows'));
  const subjectAlive = !(jwtPost || (kind !== 'jwt-expired' && step === 'post'));
  const result = baseResult({
    phase: 'revoked', kind, step: step ?? null, fingerprint_check: fpCheck, session_check: sessionCheck, credentials: credentialsOut(), subject_jwt: subjectFingerprint, pair_check: pairCheck, rows_read_at: rows.raw.read_at,
    meaning: jwtPost ? 'JWT 자체가 만료됐다(로그인 기록은 살아 있다) — 같은 JWT 가 만료 전에는 다섯 함수 모두 ok 였고(pre), 만료 뒤에는 만료를 사유로 함수에 들어오기 전에 거절된다. 아무 열도 바뀌지 않아야 한다'
      : kind === 'jwt-expired' ? '한 쌍의 앞쪽: 이 JWT 로 만료 전에 다섯 함수가 ok 다. 같은 JWT 를 만료 시각이 지난 뒤 --step post --pre <이 결과> 로 다시 잰다. 자격 원문은 환경 변수에만 둔다(파일에 쓰지 않는다)'
        : step === 'post' ? `JWT 는 유효한데 로그인 기록이 ${kind === 'expired' ? 'not_after 만료로' : '로그아웃으로'} 끝났다 — 다섯 함수가 전부 no_member 를 돌려주고 아무 열도 바뀌지 않는다` : '로그인 기록이 살아 있다 — 다섯 함수가 ok 다(쓰기는 A 의 행을 고친다)',
  });
  const forbidden = forbiddenValues(expect, rows.by);
  const ledger = newLedger(rows.by);
  const cells = []; let no = 0;
  const tag = `r${Date.now().toString(36)}`;
  const s0 = rows.by.a.settings;
  const known = { settings: { intro_book_track: s0.intro_book_track ?? null, marketing_consent: s0.marketing_consent ?? null, marketing_consent_at: s0.marketing_consent_at ?? null }, answers: projectStored(s0) };
  for (const fn of FN_ORDER) {
    const args = validArgs(fn, 'a', known.settings, tag);
    let exp;
    if (jwtPost) exp = { kind: 'jwt_expired' };
    else if (!subjectAlive) exp = { kind: 'state_only', state: 'no_member' };
    else if (fn === 'my_settings') exp = okSettings(known.settings);
    else if (fn === 'my_book_answers') exp = known.answers.state === 'ok' ? okAnswers(known.answers.answers) : { kind: 'state_only', state: 'answers_corrupt' };
    else if (fn === 'my_intro_track_set') exp = okTrack(args.p_track);
    else if (fn === 'my_marketing_consent_set') exp = okConsent();
    else exp = okHold(args.p_answers);
    const res = await call(subject, fn, 'POST', args);
    const cell = cellOf(++no, subject, fn, 'POST', `${requestLabel(fn, 'POST', args)} (재는 자격)`, exp, judge(exp, res, 'POST', { forbidden, owner: 'a' }));
    if (FUNCS[fn].kind === 'write' && cell.verdict === 'pass' && cell.body_state === 'ok') {
      applyReturned(ledger, 'a', fn, cell);
      if (fn === 'my_marketing_consent_set') { known.settings.marketing_consent = true; known.settings.marketing_consent_at = cell.returned.marketing_consent_at; }
      if (fn === 'my_book_answers_hold') known.answers = { state: 'ok', answers: { ...args.p_answers, answered_at: cell.returned.answered_at } };
    }
    cells.push(cell);
  }
  // 같은 때의 대조군: A 의 평소 로그인으로 읽기 둘(쓰지 않는다 — 재는 자격의 효과와 섞이지 않게)
  for (const fn of ['my_settings', 'my_book_answers']) {
    const exp = fn === 'my_settings' ? okSettings(known.settings) : (known.answers.state === 'ok' ? okAnswers(known.answers.answers) : { kind: 'state_only', state: 'answers_corrupt' });
    const res = await call('member_a', fn, 'POST', {});
    cells.push(cellOf(++no, 'member_a', fn, 'POST', 'POST {} (같은 때의 대조군: A 의 평소 로그인)', exp, judge(exp, res, 'POST', { forbidden, owner: 'a' })));
  }
  result.subject_seconds_left_at_end = (decodeJwtPayload(jwts[subject]).exp ?? 0) - Math.floor(Date.now() / 1000);
  result.expected_effects = ledgerOut(ledger);
  return finish(result, cells);
}

// ---------------------------------------------------------------------
// rows-effect: 앞뒤 스냅숏(rows_md5.sql)과 그 단계의 결과(expected_effects)를 견준다
function phaseRowsEffect() {
  const before = loadRows(arg('--before'), '--before', { maxAge: null });
  const after = loadRows(arg('--after'), '--after', { maxAge: null });
  const res = loadResult(arg('--result'), '--result');
  const eff = res?.expected_effects?.by_member;
  if (!eff) stop(2, '--result 에 expected_effects 가 없다(matrix · effect · variants · revoked 의 결과여야 한다)');
  const problems = [];
  const tB = Date.parse(before.raw.read_at); const tA = Date.parse(after.raw.read_at);
  const tS = Date.parse(res.started_at); const tF = Date.parse(res.finished_at);
  if (!(tB < tA)) problems.push('뒤 스냅숏의 read_at 이 앞 스냅숏보다 뒤가 아니다');
  const perMember = {};
  for (const l of ROW_LABELS) {
    const b = before.by[l]; const a = after.by[l]; const e = eff[l] ?? { changed_columns: [], final: null };
    if (b.id !== a.id || b.email !== a.email) { problems.push(`${l}: 앞뒤 스냅숏의 회원번호·이메일이 다르다`); continue; }
    const cols = [...new Set([...Object.keys(b.cols), ...Object.keys(a.cols)])].sort();
    const changed = cols.filter((c) => b.cols[c] !== a.cols[c]);
    const want = [...e.changed_columns].sort();
    perMember[l] = { changed_columns: changed, expected_changed_columns: want, same: JSON.stringify(changed) === JSON.stringify(want) };
    if (!perMember[l].same) problems.push(`${l}: 바뀐 열이 기대와 다르다(바뀜 ${JSON.stringify(changed)} / 기대 ${JSON.stringify(want)})`);
    if (e.final) {
      const s = a.settings;
      if ((s.intro_book_track ?? null) !== e.final.intro_book_track) problems.push(`${l}: 저장된 intro_book_track 이 응답과 다르다`);
      if ((s.marketing_consent ?? null) !== e.final.marketing_consent) problems.push(`${l}: 저장된 marketing_consent 가 응답과 다르다`);
      if (!sameInstant(s.marketing_consent_at ?? null, e.final.marketing_consent_at ?? null)) problems.push(`${l}: 저장된 marketing_consent_at 이 응답과 다르다`);
      const storedSha = s.pending_is_sql_null ? null : sha256(canon(s.pending_book_request));
      if (storedSha !== e.final.answers_sha256) problems.push(`${l}: 저장된 pending_book_request 가 응답(또는 시작 값)과 다르다`);
      if (want.includes('marketing_consent_at')) {
        const t = Date.parse(s.marketing_consent_at);
        const inDb = Number.isFinite(t) && t >= tB && t <= tA;
        perMember[l].consent_at_between_db_reads = inDb;
        if (!inDb) problems.push(`${l}: 저장된 동의 시각이 앞뒤 스냅숏의 DB 시각 사이가 아니다(서버 시각이 아니다)`);
        for (const ct of e.consent_times_from_responses ?? []) { const x = Date.parse(ct); if (!(x >= tB && x <= tA)) problems.push(`${l}: 응답이 돌려준 동의 시각 가운데 앞뒤 DB 시각 사이가 아닌 것이 있다`); }
      }
    }
  }
  const others = { other_users: sameJson(before.raw.other_users, after.raw.other_users), all_users_n: before.raw.all_users_n === after.raw.all_users_n, member_identity: sameJson(before.raw.all_member_identity, after.raw.all_member_identity), admin_principal: sameJson(before.raw.all_admin_principal, after.raw.all_admin_principal) };
  if (!others.other_users) problems.push('합성 회원이 아닌 회원 행이 바뀌었다(수 또는 md5)');
  if (!others.all_users_n) problems.push('전체 회원 수가 바뀌었다');
  if (!others.member_identity) problems.push('대응표가 바뀌었다');
  if (!others.admin_principal) problems.push('관리자 명부가 바뀌었다');
  // 스냅숏이 그 단계를 실제로 사이에 두었는가(도구의 시계와 DB 시계의 차이를 5분까지 봐준다)
  const bracket = { before_read_at: before.raw.read_at, step_started_at: res.started_at ?? null, step_finished_at: res.finished_at ?? null, after_read_at: after.raw.read_at };
  if (Number.isFinite(tS) && Number.isFinite(tF) && !(tB - 300000 <= tS && tF <= tA + 300000)) problems.push('앞뒤 스냅숏이 그 단계를 사이에 두지 않았다(시각 순서가 맞지 않는다)');
  const out = { tool: TOOL, phase: 'rows-effect', request_count: 0, of: { phase: res.phase, state: res.state ?? null, step: res.step ?? null, kind: res.kind ?? null, successful_writes: res.expected_effects.successful_writes ?? null }, same: problems.length === 0, problems, by_member: perMember, others, bracket,
    note: '이 단계 전체를 사이에 둔 앞뒤의 대조다. 사이에 고쳐졌다가 되돌려진 것은 보이지 않는다. 요청 하나의 효과는 그 요청만 사이에 둔 단계(effect)의 결과로 본다' };
  writeOut(out);
  log(`phase=rows-effect 요청 0건 — ${out.same ? '같음(바뀐 열이 기대한 열뿐)' : '다름: ' + problems.slice(0, 10).join(' / ')}`);
  return out.same ? 0 : 1;
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
function phaseCompare() {
  const a = loadResult(arg('--a'), '--a');
  const b = loadResult(arg('--b'), '--b');
  const ignore = ['read_at', ...(arg('--ignore') ? arg('--ignore').split(',').map((s) => s.trim()) : [])];
  const differences = diffJson(a, b, ignore);
  const result = { tool: TOOL, phase: 'compare', request_count: 0, ignored_keys: ignore, same: differences.length === 0, differences };
  writeOut(result);
  log(`phase=compare 요청 0건 — ${result.same ? '같음' : '다름: ' + differences.slice(0, 12).join(', ')}`);
  return result.same ? 0 : 1;
}
export function bodyMd5OfMigration(path) {
  const t = readFileSync(path, 'utf8');
  const out = {};
  for (const [name, f] of Object.entries(FUNCS)) {
    const tag = '$' + f.tag + '$';
    const i = t.indexOf('as ' + tag);
    const j = t.indexOf(tag + ';', i + 3 + tag.length);
    if (i < 0 || j < 0) return null;
    out[name] = createHash('md5').update(t.slice(i + 3 + tag.length, j).replace(/\r/g, ''), 'utf8').digest('hex');
  }
  return out;
}
function phaseBodyMd5() {
  const path = arg('--migration') ?? MIGRATION;
  if (!existsSync(path)) stop(2, `마이그레이션 파일이 없다: ${path}`);
  const md5 = bodyMd5OfMigration(path);
  if (!md5) stop(2, '마이그레이션 파일에서 함수 다섯의 본문을 찾지 못했다');
  for (const n of FN_ORDER) console.log(`${n.padEnd(26)} ${md5[n]}`);
  writeOut({ tool: TOOL, phase: 'body-md5', request_count: 0, migration: path, body_md5: md5, note: '본문에서 줄 끝의 CR 을 뺀 글자의 md5. 지문의 functions.<이름>.body_md5, 되돌리기 SQL 안의 값과 같아야 한다' });
  log('phase=body-md5 요청 0건');
  return 0;
}

// SQL 파일 앞에 둘 set 줄. 값은 저장해 둔 파일에서 글자 그대로 옮기고, 작은따옴표는 두 번 쓴다.
function phaseSetLines() {
  const what = arg('--for');
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const lines = [`set b3c.test_project_ref = '${REF}';`];
  const uuid = (v, name) => { if (!UUID_RE.test(String(v ?? ''))) stop(2, `${name} 이 번호 모양이 아니다`); return String(v); };
  const acctA = () => uuid(loadResult(arg('--expect'), '--expect').accounts?.a?.auth_user_id, '--expect 의 accounts.a.auth_user_id');
  const created = () => {
    const c = loadResult(arg('--expect'), '--expect').created;
    if (!c || !Array.isArray(c.users) || c.users.length !== 7 || !Array.isArray(c.mappings) || c.mappings.length !== 6 || !Array.isArray(c.admins) || c.admins.length !== 2) stop(2, '--expect 에 created(users 7 · mappings 6 · admins 2)가 없다(fixtures_up.sql 의 결과여야 한다)');
    if (!Array.isArray(c.accounts) || c.accounts.length !== 8 || !c.accounts.every((a) => UUID_RE.test(String(a?.auth_user_id ?? '')) && typeof a.email === 'string' && a.email.toLowerCase().includes(SYNTH_MARK))) stop(2, `--expect 의 created 에 accounts 8(로그인 계정의 번호와 합성 표식 ${SYNTH_MARK} 이 있는 이메일)이 없다(fixtures_up.sql 2차 판의 결과여야 한다)`);
    return `set b3c.created = ${q(JSON.stringify(c))};`;
  };
  if (what === 'fixtures-up') {
    // accounts.json: {"a": {"id": "<계정 번호>", "email": "<계정을 만들 때 받은 로그인 이메일>"}, … 여덟}
    const acc = loadResult(arg('--accounts'), '--accounts');
    for (const l of ALL_ACCOUNTS) {
      const a = acc?.[l];
      if (!a || typeof a !== 'object') stop(2, `--accounts 의 ${l} 가 {"id": …, "email": …} 모양이 아니다(계정 번호만 적은 1차 판의 모양은 받지 않는다)`);
      const em = String(a.email ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+$/.test(em)) stop(2, `--accounts 의 ${l}.email 이 이메일 모양이 아니다`);
      if (!em.toLowerCase().includes(SYNTH_MARK)) stop(2, `--accounts 의 ${l}.email 에 합성 표식(${SYNTH_MARK})이 없다 — 이 시험이 만든 합성 계정이 아닐 수 있다`);
      lines.push(`set b3c.acct_${l} = ${q(uuid(a.id, `--accounts 의 ${l}.id`))};`, `set b3c.acct_${l}_email = ${q(em)};`);
    }
    if (new Set(ALL_ACCOUNTS.map((l) => String(acc[l].id).toLowerCase())).size !== 8) stop(2, '--accounts 의 계정 번호 여덟 개가 서로 다르지 않다');
    if (new Set(ALL_ACCOUNTS.map((l) => String(acc[l].email).trim().toLowerCase())).size !== 8) stop(2, '--accounts 의 이메일 여덟 개가 서로 다르지 않다');
  } else if (what === 'fixtures-down' || what === 'fixtures-reset') {
    lines.push(created());
  } else if (what === 'leftover-check') {
    lines.shift(); // 읽기만 하는 SQL 이다(대상 확인 값을 쓰지 않는다)
    lines.push(created());
  } else if (what === 'answers-variant') {
    const round = Number(arg('--round'));
    if (!VARIANT_ROUNDS[round]) stop(2, '--round 는 1 ~ 6');
    lines.push(created(), `set b3c.variant_round = '${round}';`);
  } else if (what === 'maint-on' || what === 'maint-off') {
    const snap = loadResult(arg('--snapshot'), '--snapshot');
    const COLS = ['id', 'last_ended_at', 'last_ended_maintenance_id', 'maintenance_id', 'message', 'phase', 'starts_at', 'updated_at'];
    const isRow = (r) => r && typeof r === 'object' && JSON.stringify(Object.keys(r).sort()) === JSON.stringify(COLS);
    if (!isRow(snap.site_state_row) || !Array.isArray(snap.site_state_columns)) stop(2, '--snapshot 이 state_snapshot.sql 의 결과가 아니다(site_state_row 의 열이 여덟 개가 아니다)');
    if (snap.site_state_row.phase !== 'normal') stop(2, `--snapshot 의 phase 가 normal 이 아니다(${snap.site_state_row.phase}) — 켜기 전에 뜬 것이어야 한다`);
    lines.push(`set b3c.acct_a = ${q(acctA())};`);
    if (what === 'maint-on') {
      // 예외 명단에 넣을 계정이 이번에 만든 합성 계정인가를 maint_on.sql 이 계정 번호 + 로그인 이메일로 대조한다
      const em = loadResult(arg('--expect'), '--expect').accounts?.a?.auth_email;
      if (typeof em !== 'string' || !em.toLowerCase().includes(SYNTH_MARK)) stop(2, `--expect 의 accounts.a.auth_email 이 없거나 합성 표식(${SYNTH_MARK})이 없다`);
      lines.push(`set b3c.acct_a_email = ${q(em)};`);
    }
    lines.push(`set b3c.saved_site_state = ${q(JSON.stringify(snap.site_state_row))};`);
    if (what === 'maint-off') {
      const on = loadResult(arg('--on'), '--on(maint_on.sql 의 마지막 결과)');
      const r = on.site_state_row;
      if (!isRow(r)) stop(2, '--on 이 maint_on.sql 의 결과가 아니다(site_state_row 의 열이 여덟 개가 아니다)');
      if (r.phase !== 'maintenance' || r.maintenance_id !== MAINT_ID || r.message !== MAINT_MESSAGE) stop(2, `--on 의 행이 이 시험이 켠 값(maintenance · ${MAINT_ID} · ${MAINT_MESSAGE})이 아니다`);
      if (on.row_now_is_the_same === false) stop(2, '--on 의 row_now_is_the_same 이 false 다 — 켠 직후에 이미 행이 바뀌어 있었다. 사람이 확인할 것');
      lines.push(`set b3c.on_site_state = ${q(JSON.stringify(r))};`);
    }
  } else if (what === 'rollback') {
    const fns = loadResult(arg('--fingerprint'), '--fingerprint').functions ?? {};
    const applied = {}; const differs = [];
    const expected = bodyMd5OfMigration(arg('--migration') ?? MIGRATION);
    if (!expected) stop(2, '마이그레이션 파일에서 함수 다섯의 본문을 찾지 못했다(견줄 기준이 없다)');
    for (const n of FN_ORDER) {
      const f = fns[n] ?? {};
      if (f.exists !== true || !/^[0-9]{1,10}$/.test(String(f.oid ?? '')) || !/^[0-9a-f]{32}$/.test(String(f.def_md5 ?? ''))) stop(2, `--fingerprint 에 ${n} 의 oid·def_md5 가 없다(적용 직후에 뜬 지문이어야 한다)`);
      applied[n] = { oid: String(f.oid), def_md5: f.def_md5 };
      if (f.body_md5 !== expected[n]) differs.push(`${n}(지문 ${f.body_md5 ?? '없음'} / 파일 ${expected[n]})`);
    }
    // 기준이 다르면 스스로 맞추지 않는다: DB 에서 읽은 값을 견줄 값으로 대신 넘기지 않고 멈춘다. 그 뒤는 사람이 판단한다
    if (differs.length) {
      writeOut({ tool: TOOL, phase: 'set-lines', for: what, request_count: 0, stopped: '본문 md5 불일치', differs, lines: [], note: '지문의 함수 본문 md5 가 마이그레이션 파일에서 계산한 값과 다르다. 되돌리기의 set 줄을 만들지 않았다 — 원인(누가 함수를 바꿨는가, SQL 통로가 본문 글자를 바꿔 보냈는가)을 사람이 확인한다' });
      stop(3, `되돌리기의 기준이 다르다 — 지문의 함수 본문 md5 가 파일에서 계산한 값과 다르다: ${differs.join(' · ')}. set 줄을 만들지 않았다. 사람이 원인을 확인할 것`);
    }
    lines.shift(); // 되돌리기 SQL 은 대상 확인 값을 쓰지 않는다(운영으로도 갈 수 있는 파일이다)
    lines.push(`set b3c.applied = ${q(JSON.stringify(applied))};`);
  } else if (what === 'session-expire' || what === 'session-restore') {
    lines.push(`set b3c.account_id = ${q(acctA())};`);
    if (what === 'session-expire') {
      const s = loadResult(arg('--sessions-sql'), '--sessions-sql');
      const c = (s.credentials ?? []).find((x) => x.credential === 'a_expire');
      if (!c) stop(2, '--sessions-sql 에 a_expire 가 없다(sessions-sql 단계의 결과여야 한다)');
      const before = arg('--not-after-before');
      if (before === undefined) stop(2, '--not-after-before <직전에 읽은 not_after 글자 그대로 | null> 이 필요하다');
      lines.push(`set b3c.session_id = ${q(uuid(c.session_id, 'a_expire 의 session_id'))};`, `set b3c.not_after_before = ${q(before)};`);
    } else {
      const x = loadResult(arg('--expired'), '--expired');
      if (!x.session_id || !x.not_after_expired) stop(2, '--expired 가 session_expire.sql 의 결과가 아니다');
      lines.push(`set b3c.session_id = ${q(uuid(x.session_id, '--expired 의 session_id'))};`, `set b3c.not_after_expired = ${q(x.not_after_expired)};`, `set b3c.not_after_before = ${q(x.not_after_before === null || x.not_after_before === undefined ? 'null' : x.not_after_before)};`);
    }
  } else stop(2, '--for 는 fixtures-up | fixtures-reset | fixtures-down | leftover-check | answers-variant | maint-on | maint-off | rollback | session-expire | session-restore');
  console.log(lines.join('\n'));
  writeOut({ tool: TOOL, phase: 'set-lines', for: what, request_count: 0, lines, note: '이 줄들을 같은 요청의 맨 앞에 두고 그 뒤에 SQL 파일 전체를 붙인다. 값은 식별값이다(열쇠·자격이 아니다)' });
  log(`phase=set-lines for=${what} 요청 0건 — ${lines.length}줄`);
  return 0;
}

// 시작 지문이 이번 시작 기준(3-0 의 끝 상태, 다른 조각의 시험이 진행 중이 아님)과 같은가. 요청 0
function phaseStartCheck() {
  const fp = loadResult(arg('--fingerprint'), '--fingerprint');
  if (!fp?.functions || !fp.read_at) stop(2, '--fingerprint 가 이 폴더의 fingerprint.sql 결과가 아니다');
  const age = ageSeconds(fp.read_at);
  if (age > 1800 || age < -300) stop(2, `--fingerprint 가 ${age}초 전에 읽은 것이다. 방금 읽은 것이어야 한다`);
  const mp = fp.my_profile ?? {}; const e = mp.execute ?? {};
  const rows = [
    ['이 계약의 함수 다섯이 없다', '다섯 모두 named_count 0', FN_ORDER.map((n) => `${n}:${fp.functions[n]?.named_count}`).join(' '), FN_ORDER.every((n) => Number(fp.functions[n]?.named_count) === 0 && fp.functions[n]?.exists === false)],
    ['my_profile 이 3-0 의 끝 상태로 있다', `exists true · named_count 1 · body_md5 ${MY_PROFILE_BODY_MD5}`, `exists ${mp.exists} · named_count ${mp.named_count} · body_md5 ${mp.body_md5 ?? '없음'}`, mp.exists === true && Number(mp.named_count) === 1 && mp.body_md5 === MY_PROFILE_BODY_MD5],
    ['my_profile 의 실행 권한이 authenticated 뿐', 'public·anon·service_role false, authenticated true', JSON.stringify(e), e.public === false && e.anon === false && e.authenticated === true && e.service_role === false],
    ['공통 확인 설정이 걸려 있지 않다', '[]', JSON.stringify(fp.pre_request), Array.isArray(fp.pre_request) && fp.pre_request.length === 0],
    ['점검 상태가 normal', 'normal', String(fp.site_state?.phase), fp.site_state?.phase === 'normal'],
    ['점검 예외 명단이 비어 있다', '0', String(fp.maintenance_exception?.n), Number(fp.maintenance_exception?.n) === 0],
    ['이 시험의 합성 회원 행이 없다', '0', String(fp.synthetic?.public_users), Number(fp.synthetic?.public_users) === 0],
    ['공통 확인 함수의 본문에 이 계약의 함수 이름이 없다', '[]', JSON.stringify(fp.check_api_request?.mentions), Array.isArray(fp.check_api_request?.mentions) && fp.check_api_request.mentions.length === 0],
  ].map(([item, expect, got, ok]) => ({ item, expect, got, ok }));
  const ok = rows.every((r) => r.ok);
  for (const r of rows) console.log(`${r.ok ? '같음' : '다름'}  ${r.item} — 기대 ${r.expect} / 지금 ${r.got}`);
  writeOut({ tool: TOOL, phase: 'start-check', request_count: 0, ok, rows, note: ok ? '시작해도 된다(다른 조각의 시험이 진행 중이 아님은 브레인방의 진행 기록으로 따로 확인한다)' : '시작하지 않는다. 다른 작업의 행·설정을 이 절차가 지우거나 되돌리지 않는다' });
  log(`phase=start-check 요청 0건 — ${ok ? '시작 기준과 같음' : '시작 기준과 다름: ' + rows.filter((r) => !r.ok).map((r) => r.item).join(' / ')}`);
  return ok ? 0 : 3;
}
// 끝 확인을 한 표로: 새 함수 0 · 이번에 만든 것의 남은 것 0 · 끝 지문 = 시작 지문(이 계약의 지문, 표·파일 규칙 지문, 상태 저장). 요청 0
function phaseEndCheck() {
  const p0 = loadResult(arg('--p-start'), '--p-start(시작 지문 P0)'); const p9 = loadResult(arg('--p-end'), '--p-end(끝 지문)');
  const g0 = loadResult(arg('--g-start'), '--g-start(표·파일 규칙의 시작 지문 G0)'); const g9 = loadResult(arg('--g-end'), '--g-end(표·파일 규칙의 끝 지문)');
  const left = loadResult(arg('--leftover'), '--leftover(leftover_check.sql 의 결과)');
  const sPair = arg('--s-start') || arg('--s-end') ? [loadResult(arg('--s-start'), '--s-start(켜기 전의 상태 저장 S0)'), loadResult(arg('--s-end'), '--s-end(끝의 상태 저장)')] : null;
  const ignore = ['read_at', ...(arg('--ignore') ? arg('--ignore').split(',').map((s) => s.trim()) : [])];
  if (!left?.exact || !left.marker) stop(2, '--leftover 가 leftover_check.sql 의 결과가 아니다');
  const x = left.exact; const mk = left.marker;
  const zero = (label, v) => ({ item: label, expect: '0', got: String(v), ok: Number(v) === 0 });
  const same = (label, a, b, part) => { const d = diffJson(part ? a?.[part] : a, part ? b?.[part] : b, ignore); return { item: label, expect: '시작과 같음', got: d.length ? '다름: ' + d.slice(0, 6).join(', ') : '같음', ok: d.length === 0 }; };
  const rows = [
    zero('이 계약의 새 함수(다섯 가운데 남은 수)', left.new_functions),
    { item: '끝 지문에도 함수 다섯이 없다', expect: '다섯 모두 named_count 0', got: FN_ORDER.map((n) => p9.functions?.[n]?.named_count).join(' '), ok: FN_ORDER.every((n) => Number(p9.functions?.[n]?.named_count) === 0) },
    zero('이번 합성 회원 행(7 가운데 남은 수)', x.public_users), zero('이번 합성 로그인 계정(8 가운데 남은 수)', x.auth_users), zero('이번 대응 행(6 가운데 남은 수)', x.member_identity), zero('이번 관리자 명부 행(2 가운데 남은 수)', x.admin_principal),
    zero('그 계정들의 로그인 기록', x.sessions), zero('그 계정들의 점검 예외 행', x.maintenance_exception), zero('그 계정들의 인증 앱 등록', x.mfa_factors),
    zero(`회원 표에서 이메일에 ${SYNTH_MARK} 가 있는 행`, mk.public_users_email), zero(`로그인 계정에서 이메일에 ${SYNTH_MARK} 가 있는 행`, mk.auth_users_email), zero(`점검 번호 ${MAINT_ID} 의 예외 행`, mk.maintenance_exception_311),
    same('이 계약의 지문 전체(함수 다섯 · my_profile · 다른 공개·비공개 함수 · 공통 확인 · 점검 · 회원 표의 열·권한·규칙·트리거 · 수)', p0, p9),
    same('그 가운데 my_profile', p0, p9, 'my_profile'), same('그 가운데 판정 함수(비공개 스키마)', p0, p9, 'private_functions'), same('그 가운데 회원 표', p0, p9, 'users_table'),
    same('표 규칙 · 파일 규칙의 지문(2-나-2b 의 fingerprint.sql)', g0, g9),
    sPair ? same('상태 저장(점검 상태 행 전체 · authenticator 설정 · 예외 명단)', sPair[0], sPair[1]) : { item: '상태 저장', expect: '시작과 같음', got: '견주지 않음(S0 을 뜨기 전에 끝났으면 점검·설정을 켠 적이 없다 — 위 지문의 점검·설정이 시작과 같은지로 본다)', ok: true },
  ];
  const ok = rows.every((r) => r.ok);
  for (const r of rows) console.log(`${r.ok ? '확인' : '다름'}  ${r.item} — 기대 ${r.expect} / 지금 ${r.got}`);
  writeOut({ tool: TOOL, phase: 'end-check', request_count: 0, ok, ignored_keys: ignore, rows });
  log(`phase=end-check 요청 0건 — ${ok ? '끝 상태가 시작 상태와 같고 남은 것이 없다' : '다름: ' + rows.filter((r) => !r.ok).map((r) => r.item).join(' / ')}`);
  return ok ? 0 : 1;
}

const PHASES = { 'start-check': phaseStartCheck, 'end-check': phaseEndCheck, 'set-lines': phaseSetLines, plan: phasePlan, 'sessions-sql': phaseSessionsSql, absent: phaseAbsent, matrix: phaseMatrix, effect: phaseEffect, variants: phaseVariants, revoked: phaseRevoked, 'rows-effect': phaseRowsEffect, compare: phaseCompare, 'body-md5': phaseBodyMd5 };
if (!PHASES[phase]) stop(2, `--phase 는 ${Object.keys(PHASES).join(' | ')}`);
const code = await Promise.resolve(PHASES[phase]()).catch((e) => { log(`예외: ${String(e?.name ?? 'Error')} ${String(e?.message ?? '').slice(0, 200)}`); return 1; });
process.exit(code);
