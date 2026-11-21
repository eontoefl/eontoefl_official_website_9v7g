// ===== D. 중복 특성 기록 =====
// 통과·실패를 가리는 시험이 아니라 측정이다. 여섯 동작 × 두 상황에서
// DB 쓰기 횟수, 학생 발송(알림톡 함수 호출) 횟수, n8n 발주 횟수를 있는 그대로 세어 출력한다.
//   상황 ① 같은 전달을 두 번: 같은 update(같은 콜백 번호)를 차례로 두 번 넣는다.
//   상황 ② 같은 업무에 콜백 번호만 다른 두 클릭: 콜백 번호·update 번호만 바꿔 차례로 두 번 넣는다.
// 가짜 DB는 첫 처리의 쓰기를 반영해서 두 번째 조회에 돌려준다.
// 두 번째 요청은 첫 번째가 끝난 뒤에 넣는다(동시에 겹쳐 들어오는 경우는 재지 않는다).
// 수정본(열림 모드)에서 재고, v26 원본에서도 같은 값인지 함께 적는다.

import {
  assert,
  callbackUpdate,
  type Call,
  FAKE,
  type Handler,
  invoke,
  jsonRequest,
  loadEntry,
  baseEnv,
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

function cell(c: Count): string {
  return `${c.dbWrites} (${c.dbRowsChanged}행) | ${c.kakao.length}${c.kakao.length ? ` (${c.kakao.join(", ")})` : ""} | ${c.n8n}`;
}

Deno.test("D01 중복 특성 측정(판정 아님): 여섯 동작 × 두 상황", async () => {
  const patched = await loadEntry("patched", baseEnv("open"));
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
