// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-1 대조표 실행 스크립트 (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// 이 파일은 작업방이 시험 프로젝트에 실행해 보지 않았다(문법 확인과 "대상이 다르면 요청 0으로 멈춤" 확인만 했다).
// 쓰는 법과 기대값은 같은 폴더의 절차.md 를 따른다.
//
// 하는 일: 대상 표 14개 × 동작 4개(56줄)를 자격별로 실제 REST 요청으로 보내고,
//          응답(상태·오류 코드·돌려받은 행의 식별값)과 저장값(서비스 열쇠로 RLS 를 건너뛰어 읽은 값)을
//          JSON 으로 저장한다. 쓰기 시험 뒤에는 합성 행을 같은 처음 값으로 되돌린 다음에 다음 요청을 보낸다.
//
// 외부 꾸러미 없음(Node 내장 fetch·fs 만). 주소·열쇠·자격은 환경 변수로만 받고 파일·결과에 적지 않는다.
//
// 환경 변수
//   B2N1_URL          https://hmncdheiwqwekdbtijar.supabase.co  (다르면 요청 0으로 멈춘다)
//   B2N1_ANON_KEY     시험 프로젝트의 anon 키
//   B2N1_SERVICE_KEY  시험 프로젝트의 service_role 키(합성 행 되돌리기와 저장값 읽기에도 쓴다)
//   B2N1_MEMBER_A     회원 A 의 회원번호(public.users.id)
//   B2N1_MEMBER_B     회원 B 의 회원번호
//   B2N1_JWT_A / B2N1_JWT_B / B2N1_JWT_N   회원 A·B, 대응 없는 계정 N 의 로그인 자격(access token)
//   B2N1_JWT_G1 / B2N1_JWT_G2              관리자 G 의 6자리 전(aal1)·6자리 후(aal2) 자격
//     (--actors anon 으로 돌리는 단계에서는 JWT 5개가 없어도 된다)
//
// 실행
//   node run_matrix.mjs --phase before     --out before.json
//   node run_matrix.mjs --phase applied    --out applied.json    --compare before.json
//   node run_matrix.mjs --phase rolledback --out rolledback.json --compare before.json
//   node run_matrix.mjs --phase reapplied  --out reapplied.json  --compare before.json
//   phase: before·rolledback = 비로그인 칸만(56줄) / applied·reapplied = 자격 전부
//   --actors anon|all 로 바꿀 수 있다.
// 끝낼 때의 종료 값: 0 = 기대와 전부 같음(비교 기준이 있으면 비로그인 칸도 같음) / 1 = 다른 것이 있음 /
//                    2 = 대상·입력 확인에서 멈춤(요청 0) / 3 = 실행 중 멈춤(환경 문제)
// =====================================================================

import { writeFile, readFile } from 'node:fs/promises';

const REF = 'hmncdheiwqwekdbtijar';
const EXPECTED_ORIGIN = `https://${REF}.supabase.co`;

// ---------------------------------------------------------------------
// 표 정의 (fixtures_up.sql · rehearsal.sql 과 같은 키·열)
// ---------------------------------------------------------------------
const TR8 = [
  'tr_listening_announcement', 'tr_listening_conversation', 'tr_listening_lecture',
  'tr_reading_academic', 'tr_speaking_interview', 'tr_speaking_repeat',
  'tr_writing_discussion', 'tr_writing_email',
];
const TR10 = [...TR8, 'tr_listening_response', 'tr_writing_arrange'];
const TR11 = [...TR10, 'tr_writing_ko_data'];
const NOT_GIVEN5 = [
  'tr_listening_response UPDATE', 'tr_writing_arrange UPDATE',
  'tr_writing_ko_data UPDATE', 'tr_writing_ko_data DELETE', 'aus_intspk UPDATE',
];

function trSpec(tbl, short, mcol, extra) {
  return {
    tbl, mcol,
    k1: `zz-b2n1-${short}-1`, k2: `zz-b2n1-${short}-2`, kn: `zz-b2n1-${short}-new`,
    row: (key, value, which) => ({ id: key, ...(extra ? extra(which) : {}), [mcol]: value }),
  };
}
const qn = (which) => (which === 'k1' ? 1 : which === 'k2' ? 2 : 9);

function buildSpecs(memberA, memberB) {
  return [
    trSpec('tr_listening_announcement', 'la', 'script'),
    trSpec('tr_listening_conversation', 'lc', 'script'),
    trSpec('tr_listening_lecture', 'll', 'script'),
    trSpec('tr_listening_response', 'lr', 'script', (w) => ({ set_id: 'zz-b2n1-set', question_num: qn(w) })),
    trSpec('tr_reading_academic', 'ra', 'main_title'),
    trSpec('tr_speaking_interview', 'si', 'context_text'),
    trSpec('tr_speaking_repeat', 'sr', 'context_text'),
    trSpec('tr_writing_arrange', 'wa', 'explanation', (w) => ({ set_id: 'zz-b2n1-set', question_num: qn(w) })),
    trSpec('tr_writing_discussion', 'wd', 'topic'),
    trSpec('tr_writing_email', 'we', 'subject'),
    trSpec('tr_writing_ko_data', 'wk', 'ko_text', () => ({ type: 'zz-b2n1', set_id: 'zz-b2n1-set' })),
    {
      tbl: 'aus_intspk', mcol: 'passage',
      k1: '990000001', k2: '990000002', kn: '990000009',
      row: (key, value, which) => ({
        id: Number(key), type: 2,
        title: which === 'k1' ? 'zz-b2n1-int-1' : which === 'k2' ? 'zz-b2n1-int-2' : 'zz-b2n1-int-new',
        passage: value,
      }),
    },
    {
      tbl: 'toefl_actual_scores', mcol: 'memo', scores: true,
      k1: 'b2b2b2b2-0000-4000-8000-0000000000a1',
      k2: 'b2b2b2b2-0000-4000-8000-0000000000b1',
      kn: 'b2b2b2b2-0000-4000-8000-0000000000c9',
      // which: 'k1' = A의 행, 'k2' = B의 행, 'kn' = 넣기 시험(owner 로 회원번호를 정한다)
      row: (key, value, which, owner) => ({
        id: key,
        user_id: which === 'k1' ? memberA : which === 'k2' ? memberB : (owner ?? memberA),
        user_name: which === 'k1' ? 'zz-b2n1-A' : which === 'k2' ? 'zz-b2n1-B' : 'zz-b2n1-new',
        reading: 3.0, listening: 3.0, speaking: 3.0, writing: 3.0, overall: 3.0,
        test_date: '2026-01-01',
        memo: value,
      }),
    },
    {
      tbl: 'note3_store', mcol: 'data',
      k1: 'zz-b2n1-note-1', k2: 'zz-b2n1-note-2', kn: 'zz-b2n1-note-new',
      row: (key, value) => ({ id: key, data: value }),
    },
  ];
}

// ---------------------------------------------------------------------
// 인자·환경 변수·대상 확인 (여기까지는 어떤 요청도 보내지 않는다)
// ---------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
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

function stop(code, message) {
  console.error(`[b2n1] 멈춤: ${message}`);
  console.error('[b2n1] 보낸 요청 수: ' + requestCount);
  process.exit(code);
}

let requestCount = 0;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
if (!['before', 'applied', 'rolledback', 'reapplied'].includes(phase)) {
  stop(2, '--phase 는 before·applied·rolledback·reapplied 중 하나여야 한다');
}
const outPath = args.out;
if (!outPath) stop(2, '--out <결과 JSON 경로> 가 필요하다');
const actorsMode = args.actors ?? (phase === 'applied' || phase === 'reapplied' ? 'all' : 'anon');
if (!['all', 'anon'].includes(actorsMode)) stop(2, '--actors 는 all 또는 anon');

const env = process.env;
const baseUrl = (env.B2N1_URL ?? '').replace(/\/+$/, '');
let origin = null;
try {
  origin = new URL(baseUrl).origin;
} catch {
  origin = null;
}
if (origin !== EXPECTED_ORIGIN || baseUrl !== EXPECTED_ORIGIN) {
  stop(2, `B2N1_URL 이 시험 프로젝트(${EXPECTED_ORIGIN})가 아니다. 아무 요청도 보내지 않는다`);
}

const anonKey = env.B2N1_ANON_KEY;
const serviceKey = env.B2N1_SERVICE_KEY;
if (!anonKey || !serviceKey) stop(2, 'B2N1_ANON_KEY·B2N1_SERVICE_KEY 가 필요하다');
if (anonKey === serviceKey) stop(2, 'anon 키와 service 키가 같다');

// 키가 JWT 모양이면 그 안의 ref·role 을 확인한다(모양이 다르면 주소 확인만으로 진행하고 결과에 적는다)
const keyNotes = {};
for (const [name, key, role] of [['anon', anonKey, 'anon'], ['service', serviceKey, 'service_role']]) {
  const p = decodeJwtPayload(key);
  if (p) {
    if (p.ref !== REF) stop(2, `${name} 키의 ref 가 시험 프로젝트가 아니다. 아무 요청도 보내지 않는다`);
    if (p.role !== role) stop(2, `${name} 키의 role 이 ${role} 이 아니다`);
    keyNotes[name] = 'jwt: ref·role 확인함';
  } else {
    keyNotes[name] = 'jwt 모양이 아님: ref 를 키에서 확인하지 못함(주소로만 확인)';
  }
}

const memberA = (env.B2N1_MEMBER_A ?? '').toLowerCase();
const memberB = (env.B2N1_MEMBER_B ?? '').toLowerCase();
if (!UUID_RE.test(memberA) || !UUID_RE.test(memberB) || memberA === memberB) {
  stop(2, 'B2N1_MEMBER_A·B2N1_MEMBER_B 가 없거나 uuid 모양이 아니거나 서로 같다');
}

const userJwts = {};
if (actorsMode === 'all') {
  const need = { member_a: 'B2N1_JWT_A', member_b: 'B2N1_JWT_B', no_map: 'B2N1_JWT_N', admin_pre: 'B2N1_JWT_G1', admin_post: 'B2N1_JWT_G2' };
  const nowSec = Math.floor(Date.now() / 1000);
  const subs = {};
  for (const [label, name] of Object.entries(need)) {
    const token = env[name];
    if (!token) stop(2, `${name} 이 필요하다(--actors all)`);
    const p = decodeJwtPayload(token);
    if (!p) stop(2, `${name} 이 JWT 모양이 아니다`);
    if (typeof p.iss !== 'string' || !p.iss.startsWith(`${EXPECTED_ORIGIN}/`)) {
      stop(2, `${name} 의 발급자(iss)가 시험 프로젝트가 아니다. 아무 요청도 보내지 않는다`);
    }
    if (p.role !== 'authenticated') stop(2, `${name} 의 role 이 authenticated 가 아니다`);
    if (!p.sub || !p.session_id) stop(2, `${name} 에 sub 또는 session_id 가 없다`);
    if (typeof p.exp !== 'number' || p.exp < nowSec + 600) {
      stop(2, `${name} 의 남은 유효 시간이 10분보다 짧다(새로 받아 올 것)`);
    }
    const wantAal = label === 'admin_post' ? 'aal2' : 'aal1';
    if (p.aal !== wantAal) stop(2, `${name} 의 aal 이 ${wantAal} 이 아니다(지금 ${p.aal})`);
    subs[label] = p.sub;
    userJwts[label] = token;
  }
  if (subs.admin_pre !== subs.admin_post) stop(2, 'B2N1_JWT_G1 과 B2N1_JWT_G2 가 같은 계정이 아니다');
  if (new Set([subs.member_a, subs.member_b, subs.no_map, subs.admin_post]).size !== 4) {
    stop(2, 'A·B·N·G 의 자격이 서로 다른 계정이 아니다');
  }
}

const SPECS = buildSpecs(memberA, memberB);
const ACTORS = actorsMode === 'all'
  ? ['anon', 'member_a', 'member_b', 'no_map', 'admin_pre', 'admin_post', 'service']
  : ['anon'];

// ---------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------
function headersFor(actor) {
  if (actor === 'service') return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  if (actor === 'anon') return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  return { apikey: anonKey, Authorization: `Bearer ${userJwts[actor]}` };
}

async function rest(actor, method, pathAndQuery, { body, prefer } = {}) {
  const url = `${EXPECTED_ORIGIN}/rest/v1/${pathAndQuery}`;
  const headers = { ...headersFor(actor), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  let lastError = null;
  // 읽기(GET)만 한 번 더 시도한다. 쓰기를 두 번 보내면 판정이 흐려지므로 다시 보내지 않는다.
  const attempts = method === 'GET' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      requestCount += 1;
      const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, text };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`요청 실패(${method} ${pathAndQuery.split('?')[0]}): ${lastError?.message ?? lastError}`);
}

const keysIn = (spec) => `id=in.(${spec.k1},${spec.k2},${spec.kn})`;

// 저장값: 서비스 열쇠로 RLS 를 건너뛰어 읽는다. {id: 값}. 성적 표의 값은 "memo|user_id".
async function readState(spec) {
  const cols = spec.scores ? `id,${spec.mcol},user_id` : `id,${spec.mcol}`;
  const r = await rest('service', 'GET', `${spec.tbl}?select=${cols}&${keysIn(spec)}`);
  if (r.status !== 200 || !Array.isArray(r.json)) {
    throw new Error(`저장값 읽기 실패(${spec.tbl}): ${r.status} ${String(r.text).slice(0, 200)}`);
  }
  const state = {};
  for (const row of r.json) {
    state[String(row.id)] = spec.scores ? `${row[spec.mcol]}|${row.user_id}` : row[spec.mcol];
  }
  return state;
}

function initialState(spec) {
  if (spec.scores) return { [spec.k1]: `init|${memberA}`, [spec.k2]: `init|${memberB}` };
  return { [spec.k1]: 'init', [spec.k2]: 'init' };
}

const sameState = (a, b) => JSON.stringify(sortObj(a)) === JSON.stringify(sortObj(b));
function sortObj(o) {
  return Object.fromEntries(Object.entries(o ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}
function without(o, key) {
  const c = { ...o };
  delete c[key];
  return c;
}

// 합성 행을 같은 처음 값으로 되돌린다(서비스 열쇠): 세 키를 지우고 처음 두 행을 다시 넣는다.
async function resetTable(spec) {
  const del = await rest('service', 'DELETE', `${spec.tbl}?${keysIn(spec)}`, { prefer: 'return=minimal' });
  if (del.status < 200 || del.status >= 300) {
    throw new Error(`되돌리기 실패(지우기, ${spec.tbl}): ${del.status} ${String(del.text).slice(0, 200)}`);
  }
  const ins = await rest('service', 'POST', spec.tbl, {
    body: [spec.row(spec.k1, 'init', 'k1'), spec.row(spec.k2, 'init', 'k2')],
    prefer: 'return=minimal',
  });
  if (ins.status < 200 || ins.status >= 300) {
    throw new Error(`되돌리기 실패(넣기, ${spec.tbl}): ${ins.status} ${String(ins.text).slice(0, 200)}`);
  }
  const state = await readState(spec);
  if (!sameState(state, initialState(spec))) {
    throw new Error(`되돌린 뒤 값이 처음 값과 다르다(${spec.tbl}): ${JSON.stringify(state)}`);
  }
}

// ---------------------------------------------------------------------
// 기대값 (REST 시험은 옛 규칙이 있는 상태에서만 한다. 옛 규칙을 지운 상태는 rehearsal.sql 이 본다)
// ---------------------------------------------------------------------
function classify(tbl, op) {
  const isTr = TR11.includes(tbl);
  if ((isTr && (op === 'SELECT' || op === 'INSERT')) || (tbl === 'aus_intspk' && op === 'INSERT')) return 'open_existing';
  if (tbl === 'aus_intspk' && op === 'DELETE') return 'no_rule';
  if (op === 'DELETE+INSERT') return 'set';
  return 'target32';
}

// newRules: 새 규칙 27개가 적용돼 있는가(applied·reapplied = true)
function expectFor(tbl, op, kind, actor, newRules) {
  const cls = classify(tbl, op);
  const isTr = TR11.includes(tbl);
  if (actor === 'service') return 'allow';
  if (actor === 'anon') {
    if (cls === 'no_rule') return 'deny';
    return 'allow';
  }
  // 로그인 역할
  if (kind === 'reassign') return 'deny';
  const admin = newRules && actor === 'admin_post';
  if (kind === 'set') return admin ? 'allow' : 'deny';
  if (isTr) {
    if (op === 'SELECT' || op === 'INSERT') return 'allow';
    if (op === 'UPDATE') return admin && TR8.includes(tbl) ? 'allow' : 'deny';
    return admin && TR10.includes(tbl) ? 'allow' : 'deny';
  }
  if (tbl === 'aus_intspk') {
    if (op === 'SELECT') return newRules && ['member_a', 'member_b', 'admin_post'].includes(actor) ? 'allow' : 'deny';
    if (op === 'INSERT') return 'allow';
    return 'deny';
  }
  if (tbl === 'toefl_actual_scores') {
    if (op === 'SELECT') {
      if (admin) return 'allow';
      if (newRules && actor === 'member_a') return 'own_a';
      if (newRules && actor === 'member_b') return 'own_b';
      return 'deny';
    }
    return admin ? 'allow' : 'deny';
  }
  return admin ? 'allow' : 'deny'; // note3_store
}

// ---------------------------------------------------------------------
// 요청 하나의 실행과 판정
// ---------------------------------------------------------------------
function errInfo(r) {
  const j = r.json && !Array.isArray(r.json) ? r.json : null;
  return { code: j?.code ?? null, msg: j?.message ? String(j.message).slice(0, 200) : null };
}

async function runOp(spec, actor, op, kind, tgt, variant, newRules) {
  const cls = classify(spec.tbl, op);
  const expect = expectFor(spec.tbl, op, kind, actor, newRules);
  const rec = {
    tbl: spec.tbl, op, actor, variant, kind, class: cls,
    not_given5: NOT_GIVEN5.includes(`${spec.tbl} ${op}`),
    expect, actual: null, match: false,
    status: null, code: null, msg: null, returned_ids: null, rows: null,
    status2: null, code2: null,
    pre_ok: null, before: null, after: null,
  };

  const before = await readState(spec);
  rec.before = before;
  // 시험 전 확인: 읽기·수정·삭제는 대상 행이 있어야 하고, 넣기는 넣을 키가 비어 있어야 한다
  if (kind === 'insert') rec.pre_ok = !(spec.kn in before) && sameState(before, initialState(spec));
  else rec.pre_ok = sameState(before, initialState(spec));
  if (!rec.pre_ok) {
    rec.actual = 'precondition_failed';
    return rec;
  }

  let r;
  let r2 = null;
  if (kind === 'select') {
    r = await rest(actor, 'GET', `${spec.tbl}?select=id&id=in.(${spec.k1},${spec.k2})`);
  } else if (kind === 'insert') {
    const owner = actor === 'member_b' ? memberB : memberA;
    r = await rest(actor, 'POST', spec.tbl, { body: spec.row(spec.kn, 'init-new', 'kn', owner), prefer: 'return=minimal' });
  } else if (kind === 'update') {
    r = await rest(actor, 'PATCH', `${spec.tbl}?id=eq.${tgt}`, { body: { [spec.mcol]: 'changed' }, prefer: 'return=representation' });
  } else if (kind === 'reassign') {
    const own = actor === 'member_b' ? memberB : memberA;
    r = await rest(actor, 'PATCH', `${spec.tbl}?id=eq.${tgt}`, { body: { user_id: own }, prefer: 'return=representation' });
  } else if (kind === 'delete') {
    r = await rest(actor, 'DELETE', `${spec.tbl}?id=eq.${tgt}`, { prefer: 'return=representation' });
  } else {
    // set: 삭제 → 같은 키로 다시 넣기
    r = await rest(actor, 'DELETE', `${spec.tbl}?id=eq.${tgt}`, { prefer: 'return=representation' });
    r2 = await rest(actor, 'POST', spec.tbl, { body: spec.row(spec.k1, 'reinserted', 'k1'), prefer: 'return=minimal' });
  }

  rec.status = r.status;
  Object.assign(rec, errInfo(r));
  const ok = r.status >= 200 && r.status < 300;
  if (ok && Array.isArray(r.json)) {
    rec.returned_ids = r.json.map((x) => String(x.id)).sort();
    rec.rows = r.json.length;
  }
  if (r2) {
    rec.status2 = r2.status;
    rec.code2 = errInfo(r2).code;
  }

  const after = await readState(spec);
  rec.after = after;
  const unchanged = sameState(after, before);
  const denied42501 = !ok && rec.code === '42501';

  if (kind === 'select') {
    const both = [spec.k1, spec.k2].sort();
    const ids = JSON.stringify(rec.returned_ids);
    if (!ok) rec.actual = denied42501 ? 'deny' : 'error';
    else if (ids === JSON.stringify(both)) rec.actual = 'allow';
    else if (ids === JSON.stringify([spec.k1])) rec.actual = 'own_a';
    else if (ids === JSON.stringify([spec.k2])) rec.actual = 'own_b';
    else if (ids === '[]') rec.actual = 'deny';
    else rec.actual = 'anomaly';
    rec.match = rec.actual === expect && unchanged;
  } else if (kind === 'insert') {
    // 거절은 오류 코드가 권한 오류(42501)인 것만. 중복 키·필수 열 누락·제약 위반은 거절로 세지 않는다.
    if (denied42501 && unchanged) rec.actual = 'deny';
    else if (!ok) rec.actual = 'error';
    else if (spec.kn in after && sameState(without(after, spec.kn), before)) rec.actual = 'allow';
    else rec.actual = 'anomaly';
    rec.match = rec.actual === expect;
  } else if (kind === 'update') {
    const changed = typeof after[tgt] === 'string' && after[tgt].startsWith('changed');
    if (ok && rec.rows === 1 && changed && sameState(without(after, tgt), without(before, tgt))) rec.actual = 'allow';
    else if (((ok && rec.rows === 0) || denied42501) && unchanged) rec.actual = 'deny';
    else if (!ok) rec.actual = 'error';
    else rec.actual = 'anomaly';
    rec.match = rec.actual === expect;
  } else if (kind === 'reassign') {
    if (((ok && rec.rows === 0) || denied42501) && unchanged) rec.actual = 'deny';
    else if (ok && rec.rows === 1) rec.actual = 'allow';
    else if (!ok) rec.actual = 'error';
    else rec.actual = 'anomaly';
    rec.match = rec.actual === expect;
  } else if (kind === 'delete') {
    if (ok && rec.rows === 1 && !(tgt in after) && sameState(after, without(before, tgt))) rec.actual = 'allow';
    else if (((ok && rec.rows === 0) || denied42501) && unchanged) rec.actual = 'deny';
    else if (!ok) rec.actual = 'error';
    else rec.actual = 'anomaly';
    rec.match = rec.actual === expect;
  } else {
    const ok2 = r2.status >= 200 && r2.status < 300;
    const reinserted = typeof after[tgt] === 'string' && after[tgt].startsWith('reinserted');
    if (ok && rec.rows === 1 && ok2 && reinserted && sameState(without(after, tgt), without(before, tgt))) rec.actual = 'allow';
    else if (unchanged) rec.actual = 'deny';
    else rec.actual = 'anomaly';
    rec.match = rec.actual === expect;
  }
  return rec;
}

// 이 표·이 자격으로 보낼 요청 목록
function opsFor(spec, actor) {
  const ops = [];
  ops.push({ op: 'SELECT', kind: 'select', tgt: '', variant: '' });
  ops.push({ op: 'INSERT', kind: 'insert', tgt: spec.kn, variant: '' });
  const targets = spec.scores ? [spec.k1, spec.k2] : [spec.k1];
  for (const tgt of targets) {
    let variant = '';
    if (spec.scores) {
      if ((actor === 'member_a' && tgt === spec.k1) || (actor === 'member_b' && tgt === spec.k2)) variant = '자기 행';
      else variant = tgt === spec.k1 ? 'A의 행' : 'B의 행';
    }
    ops.push({ op: 'UPDATE', kind: 'update', tgt, variant });
    ops.push({ op: 'DELETE', kind: 'delete', tgt, variant });
  }
  if (spec.scores && (actor === 'member_a' || actor === 'member_b')) {
    ops.push({
      op: 'UPDATE', kind: 'reassign',
      tgt: actor === 'member_a' ? spec.k2 : spec.k1,
      variant: '남의 행의 user_id 를 자기 번호로 바꿔 보내기',
    });
  }
  if ((spec.tbl === 'tr_listening_response' || spec.tbl === 'tr_writing_arrange') && actor === 'admin_post') {
    ops.push({ op: 'DELETE+INSERT', kind: 'set', tgt: spec.k1, variant: '삭제 뒤 다시 넣기 한 세트' });
  }
  return ops;
}

// ---------------------------------------------------------------------
// 본 실행
// ---------------------------------------------------------------------
async function main() {
  const newRules = phase === 'applied' || phase === 'reapplied';
  const startedAt = new Date().toISOString();
  const results = [];
  const insertPayloadValid = {};

  // 0. 처음 상태 만들기 + 넣기 입력의 유효성(서비스 열쇠로는 들어가는 값인지)
  for (const spec of SPECS) {
    await resetTable(spec);
    for (const owner of spec.scores ? [memberA, memberB] : [memberA]) {
      const r = await rest('service', 'POST', spec.tbl, { body: spec.row(spec.kn, 'init-new', 'kn', owner), prefer: 'return=minimal' });
      const ok = r.status >= 200 && r.status < 300;
      insertPayloadValid[spec.scores ? `${spec.tbl} (${owner === memberA ? 'A' : 'B'})` : spec.tbl] = ok;
      if (!ok) throw new Error(`넣기 입력이 유효하지 않다(${spec.tbl}): ${r.status} ${String(r.text).slice(0, 200)}`);
      await resetTable(spec);
    }
  }

  // 1. 표 × 자격 × 요청
  for (const spec of SPECS) {
    let dirty = false;
    for (const actor of ACTORS) {
      for (const o of opsFor(spec, actor)) {
        if (dirty) {
          await resetTable(spec);
          dirty = false;
        }
        const rec = await runOp(spec, actor, o.op, o.kind, o.tgt, o.variant, newRules);
        results.push(rec);
        if (o.kind !== 'select') dirty = true;
      }
    }
    await resetTable(spec); // 표를 끝낼 때마다 처음 값으로
  }

  // 2. 대조표(56줄 × 자격 칸)
  const cellKey = (r) => `${r.tbl} ${r.op}`;
  const matrix = {};
  for (const r of results) {
    if (r.kind === 'set' || r.kind === 'reassign') continue;
    const line = (matrix[cellKey(r)] ??= {});
    let col = r.actor;
    if (r.variant) col = `${r.actor} / ${r.variant}`;
    line[col] = { expect: r.expect, actual: r.actual, match: r.match, status: r.status, code: r.code, rows: r.rows };
  }

  // 3. (마) 목록
  const cells = [...new Set(results.filter((r) => r.kind !== 'set' && r.kind !== 'reassign').map(cellKey))];
  const opened = (cell, actor) => {
    const rs = results.filter((r) => cellKey(r) === cell && r.actor === actor && r.kind !== 'reassign' && r.kind !== 'set');
    return rs.length > 0 && rs.some((r) => ['allow', 'own_a', 'own_b'].includes(r.actual));
  };
  const loginActors = ['member_a', 'member_b', 'no_map', 'admin_pre', 'admin_post'];
  const lists = {};
  if (actorsMode === 'all') {
    lists.anon_open_but_no_login_actor_open = cells.filter((c) => opened(c, 'anon') && !loginActors.some((a) => opened(c, a))).sort();
    lists.expected_when_applied = [...NOT_GIVEN5].sort();
    lists.anon_open_list_matches_not_given5 = JSON.stringify(lists.anon_open_but_no_login_actor_open) === JSON.stringify(lists.expected_when_applied);
    lists.note_reviews = 'reviews 2칸(UPDATE·DELETE)은 이 스크립트가 보지 않는다. fingerprint.sql 의 anon_only_cells(적용 뒤 7칸)로 본다.';
    lists.already_open_to_every_role = cells.filter((c) => classify(...c.split(' ')) === 'open_existing' && opened(c, 'anon') && opened(c, 'no_map')).sort();
    lists.not_given5_admin_post = Object.fromEntries(
      results.filter((r) => r.not_given5 && r.actor === 'admin_post' && r.kind !== 'set').map((r) => [cellKey(r), r.actual]),
    );
  }
  lists.not_proven_by_this_run = [
    '노트 화면(note3.html)의 새 로그인 동작 — 그 화면은 공통 래퍼가 아니라 자체 헤더로 직접 호출한다. 이 시험은 DB 규칙만 본다.',
    '다른 화면의 새 로그인 동작 전부(화면·헤더는 이 계약에서 바꾸지 않았다).',
    '옛 규칙을 지운 상태의 판정은 REST 가 아니라 rehearsal.sql(같은 DB 접속)이 본다.',
    '점검 중 차단(2-가의 공통 확인)은 범위 밖이다. 공통 확인 설정은 걸지 않은 채 시험한다.',
  ];

  // 4. (가) 비로그인 칸 비교
  let compare = null;
  if (args.compare) {
    const base = JSON.parse(await readFile(args.compare, 'utf8'));
    const pick = (r) => ({ status: r.status, code: r.code, returned_ids: r.returned_ids, rows: r.rows, actual: r.actual, before: sortObj(r.before), after: sortObj(r.after) });
    const key = (r) => `${r.tbl}|${r.op}|${r.kind}|${r.variant}`;
    const baseAnon = new Map(base.results.filter((r) => r.actor === 'anon').map((r) => [key(r), pick(r)]));
    const nowAnon = new Map(results.filter((r) => r.actor === 'anon').map((r) => [key(r), pick(r)]));
    const diffs = [];
    for (const k of new Set([...baseAnon.keys(), ...nowAnon.keys()])) {
      const a = JSON.stringify(baseAnon.get(k) ?? null);
      const b = JSON.stringify(nowAnon.get(k) ?? null);
      if (a !== b) diffs.push({ key: k, base: baseAnon.get(k) ?? null, now: nowAnon.get(k) ?? null });
    }
    const anonCells = new Set(results.filter((r) => r.actor === 'anon').map(cellKey));
    compare = {
      base_file_phase: base.phase ?? null,
      anon_requests_compared: nowAnon.size,
      anon_cells: anonCells.size, // 56이어야 한다
      anon_same: diffs.length === 0 && baseAnon.size === nowAnon.size,
      diffs,
    };
  }

  const mismatches = results.filter((r) => !r.match);
  const out = {
    tool: 'b2n1 run_matrix',
    ref: REF,
    phase,
    actors: ACTORS,
    new_rules_expected: newRules,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    request_count: requestCount,
    key_notes: keyNotes,
    stored_value_source: '서비스 열쇠로 RLS 를 건너뛰어 REST 로 읽은 값(SQL 직접 읽기는 fingerprint.sql 로 단계마다 따로 한다)',
    insert_payload_valid: insertPayloadValid,
    summary: {
      total: results.length,
      mismatch: mismatches.length,
      lines_tbl_x_op: cells.length, // 56이어야 한다
      by_actor: Object.fromEntries(ACTORS.map((a) => [a, {
        total: results.filter((r) => r.actor === a).length,
        mismatch: results.filter((r) => r.actor === a && !r.match).length,
      }])),
    },
    compare,
    lists,
    matrix,
    mismatches,
    results,
  };
  await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`[b2n1] phase=${phase} actors=${actorsMode} 요청 ${requestCount}건, 판정 ${results.length}건, 기대와 다른 것 ${mismatches.length}건`);
  if (compare) console.log(`[b2n1] 비로그인 칸 비교: ${compare.anon_same ? '같음' : `다름 ${compare.diffs.length}건`} (칸 ${compare.anon_cells})`);
  console.log(`[b2n1] 결과: ${outPath}`);
  const failed = mismatches.length > 0 || (compare && !compare.anon_same);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`[b2n1] 실행 중 멈춤: ${e?.message ?? e}`);
  console.error('[b2n1] 합성 행이 처음 값이 아닐 수 있다. fingerprint.sql 의 rows 로 확인하고, 필요하면 fixtures_down.sql → fixtures_up.sql 로 되돌린다.');
  console.error('[b2n1] 보낸 요청 수: ' + requestCount);
  process.exit(3);
});
