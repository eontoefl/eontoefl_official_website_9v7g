// ===== D. 중복 특성 기록 =====
// 통과·실패를 가리는 시험이 아니라 측정이다. 여섯 동작에서
// DB 쓰기 횟수, 학생 발송(알림톡 함수 호출) 횟수, n8n 발주 횟수를 있는 그대로 세어 출력한다.
//
// D01 차례 측정(1차 계약): 두 번째 요청을 첫 번째가 끝난 뒤에 넣는다.
//   상황 ① 같은 전달을 두 번: 같은 update(같은 콜백 번호)를 차례로 두 번 넣는다.
//   상황 ② 같은 업무에 콜백 번호만 다른 두 클릭: 콜백 번호·update 번호만 바꿔 차례로 두 번 넣는다.
//
// D02 겹친 요청 측정(2차 계약 2-3): 가짜 fetch의 문(게이트)으로 두 요청을 실제로 겹치게 한다.
//   공통: 요청 A가 조회를 마치고 첫 쓰기(DB 쓰기·알림톡·n8n) 직전에 멈춘 사이에, 요청 B가 도착해 자기 조회를 한다.
//   차례 (가) "A먼저끝": 그 뒤 A가 끝까지 처리하고, 이어서 B가 끝까지 처리한다.   ← 계약이 정한 겹침
//   차례 (나) "번갈아": 그 뒤 A와 B가 바깥 호출을 한 번씩 번갈아 한다.           ← 덧붙임(뒤쪽 "조회 후 쓰기"도 겹치는 경우)
//
// 수정본(여섯 모두 허용)에서 재고, v26 원본에서도 같은 값인지 함께 적는다.

import {
  ALL_OPEN,
  assert,
  baseEnv,
  type Call,
  callbackUpdate,
  FAKE,
  type Handler,
  invoke,
  invokeOverlapped,
  isEffect,
  jsonRequest,
  loadEntry,
  type OverlapSchedule,
  type Row,
  SECRET_HEADER,
  seededWorld,
} from "./harness.ts";

const ACTION_DATA: Array<[string, string]> = [
  ["confirm_deposit", `confirm_deposit:${FAKE.appId}`],
  ["send_guide", `send_guide:${FAKE.appId}`],
  ["resume_approve", `resume_approve:${FAKE.appId}`],
  ["resume_hold", `resume_hold:${FAKE.appId}`],
  ["retry_correction", `retry_correction:${FAKE.subId}`],
  ["confirm_extension", `confirm_extension:${FAKE.extReqId}`],
];

type Count = {
  status: number;
  dbWrites: number; // DB 쓰기 요청 수(PATCH·POST)
  dbRowsChanged: number; // 그 요청들로 실제 바뀐 행 수
  dbWriteTables: string[];
  kakao: string[]; // 학생 발송(알림톡 함수 호출)의 종류
  n8n: number;
  telegram: string[];
  answerText: string; // 대표에게 뜨는 팝업 문구
};

function count(status: number, calls: Call[]): Count {
  const writes = calls.filter((c) => c.kind.startsWith("db-write:"));
  const answers = calls.filter((c) => c.kind === "telegram:answerCallbackQuery");
  return {
    status,
    dbWrites: writes.length,
    dbRowsChanged: writes.reduce((n, c) => n + (c.rowsChanged ?? 0), 0),
    dbWriteTables: writes.map((c) => c.kind.slice("db-write:".length)),
    kakao: calls.filter((c) => c.kind.startsWith("kakao:")).map((c) => c.kind.slice("kakao:".length)),
    n8n: calls.filter((c) => c.kind === "n8n").length,
    telegram: calls.filter((c) => c.kind.startsWith("telegram:")).map((c) => c.kind.slice("telegram:".length)),
    answerText: answers.map((c) => String((c.body as Row).text)).join(" / "),
  };
}

function cell(c: Count): string {
  return `${c.dbWrites} (${c.dbRowsChanged}행) | ${c.kakao.length}${c.kakao.length ? ` (${c.kakao.join(", ")})` : ""} | ${c.n8n}`;
}

// ---------------------------------------------------------------------------
// D01 차례 측정
// ---------------------------------------------------------------------------

type Measured = { action: string; situation: string; first: Count; second: Count };

async function measure(handler: Handler, action: string, data: string, situation: "①" | "②"): Promise<Measured> {
  const world = seededWorld();
  const firstUpdate = callbackUpdate(data);
  const secondUpdate = situation === "①"
    ? callbackUpdate(data) // 같은 전달 그대로
    : { ...callbackUpdate(data, { id: "cbq-0002" }), update_id: 500002 }; // 콜백 번호만 다른 두 번째 클릭
  const a = await invoke(handler, world, jsonRequest(firstUpdate, SECRET_HEADER));
  const b = await invoke(handler, world, jsonRequest(secondUpdate, SECRET_HEADER));
  return { action, situation, first: count(a.status, a.calls), second: count(b.status, b.calls) };
}

Deno.test("D01 중복 특성 측정(판정 아님): 차례로 넣은 두 요청 — 여섯 동작 × 두 상황", async () => {
  const patched = await loadEntry("patched", baseEnv(ALL_OPEN));
  const original = await loadEntry("v26", baseEnv(undefined));
  const rows: Measured[] = [];
  const sameAsV26: Record<string, boolean> = {};
  for (const [action, data] of ACTION_DATA) {
    for (const situation of ["①", "②"] as const) {
      const m = await measure(patched, action, data, situation);
      const o = await measure(original, action, data, situation);
      rows.push(m);
      sameAsV26[`${action}${situation}`] = JSON.stringify(m) === JSON.stringify(o);
    }
  }

  const lines: string[] = [];
  lines.push("D_TABLE_BEGIN");
  lines.push("| 동작 | 상황 | 첫 처리: DB 쓰기 | 첫 처리: 학생 발송 | 첫 처리: n8n | 두 번째: DB 쓰기 | 두 번째: 학생 발송 | 두 번째: n8n | 두 번째에 대표에게 뜬 문구 | 추가 처리 | v26과 같은 값 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const m of rows) {
    const extra = m.second.dbWrites > 0 || m.second.kakao.length > 0 || m.second.n8n > 0;
    lines.push(
      `| ${m.action} | ${m.situation} | ${cell(m.first)} | ${cell(m.second)} | ${m.second.answerText} | ${extra ? "관측됨" : "없음"} | ${sameAsV26[`${m.action}${m.situation}`] ? "같음" : "다름"} |`,
    );
  }
  lines.push("D_TABLE_END");
  lines.push("D_JSON " + JSON.stringify(rows));
  console.log(lines.join("\n"));

  // 측정이 성립했는지만 확인한다(값의 좋고 나쁨은 가리지 않는다).
  assert(rows.length === 12, "12칸을 모두 쟀다");
  for (const m of rows) {
    assert(m.first.status === 200 && m.second.status === 200, `${m.action}${m.situation}: 두 요청 모두 입구를 지나 응답 200`);
    assert(m.first.telegram.length > 0, `${m.action}${m.situation}: 첫 처리가 분기에 도달했다`);
  }
});

// ---------------------------------------------------------------------------
// D02 겹친 요청 측정
// ---------------------------------------------------------------------------

// 조회 결과에서 "이미 처리됐는지"를 가르는 칸만 뽑아 적는다.
const STATE_COLUMNS: Record<string, string[]> = {
  applications: ["deposit_confirmed_by_admin", "guide_sent", "resume_requested_at", "extension_enabled"],
  correction_submissions: ["status"],
  correction_extension_requests: ["status"],
  correction_schedules: ["extension_notify_sent"],
  users: [],
};

function describeRead(call: Call): string {
  const table = call.kind.slice("db-read:".length);
  const rows = (call.result ?? []) as Row[];
  // 12세션 제출 여부 조회는 처리 여부와 무관한 조회라 표 이름만 적는다.
  if (table === "correction_submissions" && call.url.includes("session_number=eq.12")) return `${table}(12세션 제출 조회: ${rows.length}행)`;
  if (rows.length === 0) return `${table}(행 없음)`;
  const cols = STATE_COLUMNS[table] ?? [];
  if (cols.length === 0) return table;
  const parts = cols.filter((c) => c in rows[0]).map((c) => `${c}=${JSON.stringify(rows[0][c] ?? null)}`);
  return `${table}{${parts.join(", ")}}`;
}

type OverlapMeasured = {
  action: string;
  schedule: OverlapSchedule;
  measured: boolean; // 겹침이 실제로 일어났는가(아니면 "재지 못함")
  note: string;
  A: Count & { reads: string[] };
  B: Count & { reads: string[] };
  total: { dbWrites: number; dbRowsChanged: number; kakao: number; n8n: number };
  single: { dbWrites: number; dbRowsChanged: number; kakao: number; n8n: number }; // 한 번만 눌렀을 때(기준)
  extra: { dbWrites: number; dbRowsChanged: number; kakao: number; n8n: number }; // total - single
  timeline: string[];
};

async function singleBaseline(handler: Handler, data: string) {
  const cap = await invoke(handler, seededWorld(), jsonRequest(callbackUpdate(data), SECRET_HEADER));
  const c = count(cap.status, cap.calls);
  return { dbWrites: c.dbWrites, dbRowsChanged: c.dbRowsChanged, kakao: c.kakao.length, n8n: c.n8n };
}

async function measureOverlap(handler: Handler, action: string, data: string, schedule: OverlapSchedule): Promise<OverlapMeasured> {
  const single = await singleBaseline(handler, data);
  const world = seededWorld();
  const reqA = jsonRequest(callbackUpdate(data, { id: "cbq-A" }), SECRET_HEADER);
  const reqB = jsonRequest({ ...callbackUpdate(data, { id: "cbq-B" }), update_id: 500002 }, SECRET_HEADER);
  const cap = await invokeOverlapped(handler, world, reqA, reqB, schedule);

  const of = (id: string) => cap.calls.filter((c) => c.by === id);
  const side = (id: "A" | "B") => ({
    ...count(cap[id].status, of(id)),
    reads: of(id).filter((c) => c.kind.startsWith("db-read:")).map(describeRead),
  });
  const A = side("A");
  const B = side("B");
  const total = {
    dbWrites: A.dbWrites + B.dbWrites,
    dbRowsChanged: A.dbRowsChanged + B.dbRowsChanged,
    kakao: A.kakao.length + B.kakao.length,
    n8n: A.n8n + B.n8n,
  };
  const extra = {
    dbWrites: total.dbWrites - single.dbWrites,
    dbRowsChanged: total.dbRowsChanged - single.dbRowsChanged,
    kakao: total.kakao - single.kakao,
    n8n: total.n8n - single.n8n,
  };

  // 겹침이 실제로 일어났는지: B의 첫 조회가 A의 첫 업무 효과 호출보다 먼저 실행됐어야 한다.
  const firstEffectOfA = cap.calls.findIndex((c) => c.by === "A" && isEffect(c.kind));
  const firstReadOfB = cap.calls.findIndex((c) => c.by === "B" && c.kind.startsWith("db-read:"));
  const everyCallOwned = cap.calls.every((c) => c.by === "A" || c.by === "B");
  const measured = everyCallOwned && firstEffectOfA >= 0 && firstReadOfB >= 0 && firstReadOfB < firstEffectOfA;
  const note = measured ? "" : "재지 못함: B의 조회가 A의 첫 쓰기보다 먼저 일어나지 않았다";

  return {
    action,
    schedule,
    measured,
    note,
    A,
    B,
    total,
    single,
    extra,
    timeline: cap.calls.map((c) => `${c.by}:${c.kind}${c.rowsChanged !== undefined ? `(${c.rowsChanged}행)` : ""}`),
  };
}

function sideCell(s: Count): string {
  return `${s.dbWrites} (${s.dbRowsChanged}행) | ${s.kakao.length}${s.kakao.length ? ` (${s.kakao.join(", ")})` : ""} | ${s.n8n}`;
}

Deno.test("D02 겹친 요청 측정(판정 아님): 첫 요청의 조회 뒤·쓰기 전에 두 번째 요청이 조회 — 여섯 동작 × 차례 두 가지", async () => {
  const patched = await loadEntry("patched", baseEnv(ALL_OPEN));
  const original = await loadEntry("v26", baseEnv(undefined));
  const rows: OverlapMeasured[] = [];
  const sameAsV26: Record<string, boolean> = {};
  for (const [action, data] of ACTION_DATA) {
    for (const schedule of ["A먼저끝", "번갈아"] as const) {
      const m = await measureOverlap(patched, action, data, schedule);
      const o = await measureOverlap(original, action, data, schedule);
      rows.push(m);
      sameAsV26[`${action}|${schedule}`] = JSON.stringify(m) === JSON.stringify(o);
    }
  }

  const label = (s: OverlapSchedule) => (s === "A먼저끝" ? "(가) A 먼저 끝" : "(나) 번갈아");
  const lines: string[] = [];
  lines.push("D2_TABLE_BEGIN");
  lines.push("| 동작 | 차례 | A: DB 쓰기 | A: 학생 발송 | A: n8n | B: DB 쓰기 | B: 학생 발송 | B: n8n | 한 번 눌렀을 때보다 더 일어난 것 (DB 쓰기 요청 / 바뀐 행 / 학생 발송 / n8n) | 추가 처리 | v26과 같은 값 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const m of rows) {
    const extra = m.extra.dbRowsChanged > 0 || m.extra.kakao > 0 || m.extra.n8n > 0;
    const verdict = !m.measured ? "재지 못함" : extra ? "관측됨" : "없음";
    lines.push(
      `| ${m.action} | ${label(m.schedule)} | ${sideCell(m.A)} | ${sideCell(m.B)} | +${m.extra.dbWrites} / +${m.extra.dbRowsChanged}행 / +${m.extra.kakao} / +${m.extra.n8n} | ${verdict} | ${sameAsV26[`${m.action}|${m.schedule}`] ? "같음" : "다름"} |`,
    );
  }
  lines.push("D2_TABLE_END");
  lines.push("D2_READS_BEGIN");
  lines.push("| 동작 | 차례 | A가 읽은 것 | B가 읽은 것 | A에게 뜬 문구 | B에게 뜬 문구 |");
  lines.push("|---|---|---|---|---|---|");
  for (const m of rows) {
    lines.push(`| ${m.action} | ${label(m.schedule)} | ${m.A.reads.join(" → ")} | ${m.B.reads.join(" → ")} | ${m.A.answerText} | ${m.B.answerText} |`);
  }
  lines.push("D2_READS_END");
  lines.push("D2_TIMELINE_BEGIN");
  for (const m of rows) lines.push(`- ${m.action} ${label(m.schedule)}: ${m.timeline.join(" → ")}`);
  lines.push("D2_TIMELINE_END");
  lines.push("D2_JSON " + JSON.stringify(rows));
  console.log(lines.join("\n"));

  // 측정이 성립했는지만 확인한다(값의 좋고 나쁨은 가리지 않는다).
  assert(rows.length === 12, "12칸을 모두 쟀다");
  for (const m of rows) {
    assert(m.A.status === 200 && m.B.status === 200, `${m.action} ${m.schedule}: 두 요청 모두 입구를 지나 응답 200`);
    assert(m.A.reads.length > 0 && m.B.reads.length > 0, `${m.action} ${m.schedule}: 두 요청 모두 조회를 했다`);
    // 재지 못한 칸이 있으면 숨기지 않고 표에 "재지 못함"으로 적는다. 여기서는 표가 만들어졌는지만 본다.
  }
});
