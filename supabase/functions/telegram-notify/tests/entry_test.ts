// ===== 입구 통째 시험: F(본문 동결) · C(닫힘) · O(열림 거절) · P(열림 정상) · N(알림 경로 비교) =====
// index.ts(수정본)와 tests/v26_original/index.ts(운영 배포본 v26 복사본)를 같은 가짜 세계에서 돌린다.
// 네트워크 0, 운영 값 0.

import {
  assert,
  assertEquals,
  baseEnv,
  callbackUpdate,
  type Captured,
  comparable,
  FAKE,
  fetchIsFaked,
  type Handler,
  invoke,
  jsonRequest,
  kinds,
  loadEntry,
  rejectedReasons,
  type Row,
  SECRET_HEADER,
  seededWorld,
} from "./harness.ts";

const V26_SHA256 = "8964f1293fec41bad2c742182e414ffa06a68e041413c2568cd9a9517166fa46";

const ACTION_DATA: Record<string, string> = {
  confirm_deposit: `confirm_deposit:${FAKE.appId}`,
  send_guide: `send_guide:${FAKE.appId}`,
  resume_approve: `resume_approve:${FAKE.appId}`,
  resume_hold: `resume_hold:${FAKE.appId}`,
  retry_correction: `retry_correction:${FAKE.subId}`,
  confirm_extension: `confirm_extension:${FAKE.extReqId}`,
};

// 수정본은 모드마다, v26은 한 번만 불러 둔다(환경값은 불러올 때 읽힌다).
const handlers: Record<string, Promise<Handler>> = {};
function entry(variant: "patched" | "v26", mode: string | undefined): Promise<Handler> {
  const key = `${variant}|${mode === undefined ? "<없음>" : mode}`;
  if (!(key in handlers)) {
    // 불러오기는 환경값을 바꾸므로 한 번에 하나씩만 한다.
    const prev = Object.values(handlers);
    handlers[key] = Promise.all(prev).then(() => loadEntry(variant, baseEnv(mode)));
  }
  return handlers[key];
}

async function readText(rel: string): Promise<string> {
  const text = await Deno.readTextFile(new URL(rel, import.meta.url));
  return text.replaceAll("\r\n", "\n");
}

function assertRejected(cap: Captured, status: number, reason: string, label: string) {
  assertEquals(cap.status, status, `${label}: 응답 코드`);
  assertEquals(
    cap.bodyText,
    status === 401 ? '{"error":"unauthorized"}' : '{"accepted":false}',
    `${label}: 응답 본문`,
  );
  assertEquals(cap.calls.length, 0, `${label}: 바깥 호출 0 (실제: ${kinds(cap.calls).join(", ")})`);
  // 로그는 고정 사유 한 줄만
  assertEquals(cap.logs.map((l) => [l.level, ...l.args]), [["warn", "callback rejected:", reason]], `${label}: 로그`);
}

// ---------------------------------------------------------------------------
// F. 본문 동결
// ---------------------------------------------------------------------------

Deno.test("F01 시험용 v26 복사본이 운영 배포본 v26과 같은 파일이다(SHA-256)", async () => {
  const bytes = await Deno.readFile(new URL("./v26_original/index.ts", import.meta.url));
  // 작업 폴더의 줄바꿈 설정에 흔들리지 않게 LF로 맞춘 뒤 계산한다.
  const lf = new TextEncoder().encode(new TextDecoder().decode(bytes).replaceAll("\r\n", "\n"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", lf));
  const hex = Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(hex, V26_SHA256, "v26 복사본 해시");
});

Deno.test("F02 수정본은 v26에서 입구 세 곳만 다르고, handleNotification부터 끝까지는 글자 하나 다르지 않다", async () => {
  const v26 = await readText("./v26_original/index.ts");
  const patched = await readText("../index.ts");

  const tailMarker = "// ===== 알림 발송 처리 =====";
  assert(v26.split(tailMarker).length === 2 && patched.split(tailMarker).length === 2, "끝 구간 표식이 한 번씩 있다");
  assertEquals(patched.slice(patched.indexOf(tailMarker)), v26.slice(v26.indexOf(tailMarker)), "handleNotification~끝 동일");

  // 앞 구간: 추가한 세 덩어리를 걷어내면 v26과 같아야 한다.
  const importBlock = 'import { checkTelegramCallback } from "./callback-guard.ts";\n\n';
  const cfgStart = "// ===== 버튼 콜백 입구 판정 설정 =====\n";
  const mainMarker = "// ===== 메인 핸들러 =====\n";
  const guardStart = "        // 입구 판정: 거절이면";
  const guardEnd = "        return await handleCallback(body.callback_query, corsHeaders);\n";

  let head = patched.slice(0, patched.indexOf(tailMarker));
  assert(head.includes(importBlock), "import 한 줄이 있다");
  head = head.replace(importBlock, "");
  const cfgAt = head.indexOf(cfgStart);
  const mainAt = head.indexOf(mainMarker);
  assert(cfgAt > 0 && mainAt > cfgAt, "설정 덩어리 위치");
  head = head.slice(0, cfgAt) + head.slice(mainAt);
  const gAt = head.indexOf(guardStart);
  const gEnd = head.indexOf(guardEnd);
  assert(gAt > 0 && gEnd > gAt, "판정 덩어리 위치");
  head = head.slice(0, gAt) + head.slice(gEnd);
  assertEquals(head, v26.slice(0, v26.indexOf(tailMarker)), "입구 밖 앞 구간 동일");
});

Deno.test("F03 수정본에 웹훅 등록 동작이 없다", async () => {
  const patched = await readText("../index.ts");
  const guard = await readText("../callback-guard.ts");
  for (const word of ["setWebhook", "deleteWebhook", "getWebhookInfo"]) {
    assert(!patched.includes(word) && !guard.includes(word), `${word} 없음`);
  }
  assert(!/\bDeno\b|\bfetch\b/.test(guard.replace(/^\s*\/\/.*$/gm, "")), "callback-guard.ts는 Deno API·fetch를 쓰지 않는다");
});

Deno.test("F04 시험 도구 확인: fetch가 가짜로 바뀌어 있고, 모르는 주소는 시험을 실패시킨다", async () => {
  assert(fetchIsFaked(), "fetch 가짜");
  const world = seededWorld();
  const probe: Handler = async () => {
    try {
      await fetch("https://unknown-host.invalid/x", { method: "POST", body: "{}" });
    } catch (_e) {
      // 본문이 오류를 삼켜도 기록은 남아야 한다.
    }
    return new Response("OK");
  };
  let failed = false;
  try {
    await invoke(probe, world, jsonRequest({}));
  } catch (_e) {
    failed = true;
  }
  assert(failed, "모르는 주소 호출이 있으면 invoke가 실패한다");
  // 텔레그램의 다른 메서드(예: setWebhook)도 가짜가 받지 않는다.
  const world2 = seededWorld();
  const probe2: Handler = async () => {
    try {
      await fetch(`https://api.telegram.org/bot${FAKE.botToken}/setWebhook`, { method: "POST", body: "{}" });
    } catch (_e) { /* 위와 같음 */ }
    return new Response("OK");
  };
  let failed2 = false;
  try {
    await invoke(probe2, world2, jsonRequest({}));
  } catch (_e) {
    failed2 = true;
  }
  assert(failed2, "setWebhook 호출이 있으면 실패한다");
});

// ---------------------------------------------------------------------------
// C. 닫힘 모드
// ---------------------------------------------------------------------------

const CLOSED_MODES: Array<string | undefined> = [undefined, "", "closed", "OPEN", " open"];

for (const mode of CLOSED_MODES) {
  const label = mode === undefined ? "환경값 없음" : JSON.stringify(mode);

  Deno.test(`C01 닫힘(${label}): 맞는 헤더·대표·정상 data 여섯 동작 모두 200 미수락, 바깥 호출 0`, async () => {
    const handler = await entry("patched", mode);
    for (const [action, data] of Object.entries(ACTION_DATA)) {
      const world = seededWorld();
      const before = JSON.stringify(world.tables);
      const cap = await invoke(handler, world, jsonRequest(callbackUpdate(data), SECRET_HEADER));
      assertRejected(cap, 200, "closed", `${label} ${action}`);
      assertEquals(JSON.stringify(world.tables), before, `${label} ${action}: 가짜 DB 변화 0`);
    }
  });

  Deno.test(`C02 닫힘(${label}): 헤더 없음·틀림·남·엉망인 콜백도 전부 200 미수락, 바깥 호출 0`, async () => {
    const handler = await entry("patched", mode);
    const cases: Array<[string, Row, Record<string, string>]> = [
      ["헤더 없음", callbackUpdate(ACTION_DATA.confirm_deposit), {}],
      ["헤더 틀림", callbackUpdate(ACTION_DATA.confirm_deposit), { "x-telegram-bot-api-secret-token": "wrong" }],
      ["다른 사람", callbackUpdate(ACTION_DATA.confirm_deposit, { from: { id: FAKE.otherUserId } }), SECRET_HEADER],
      ["목록에 없는 동작", callbackUpdate(`delete_all:${FAKE.appId}`), SECRET_HEADER],
      ["callback_query가 문자열", { callback_query: "x" }, SECRET_HEADER],
      ["callback_query가 빈 객체", { callback_query: {} }, {}],
      ["콜백 + 알림 type을 함께 넣음", { ...callbackUpdate(ACTION_DATA.confirm_deposit), type: "new_application", data: { name: "x" } }, SECRET_HEADER],
    ];
    for (const [name, body, headers] of cases) {
      const cap = await invoke(handler, seededWorld(), jsonRequest(body, headers));
      assertRejected(cap, 200, "closed", `${label} ${name}`);
    }
  });

  Deno.test(`C03 닫힘(${label}): 알림 요청은 그대로 발송된다(텔레그램 sendMessage 1회)`, async () => {
    const handler = await entry("patched", mode);
    const cap = await invoke(
      handler,
      seededWorld(),
      jsonRequest({ type: "deposit_claimed", data: { name: "시험학생", depositor_name: "시험입금자", app_id: FAKE.appId } }),
    );
    assertEquals(cap.status, 200, "응답 코드");
    assertEquals(kinds(cap.calls), ["telegram:sendMessage"], "바깥 호출");
    const sent = cap.calls[0].body as Row;
    assertEquals(sent.chat_id, FAKE.chatId, "목적지");
    assert(JSON.stringify(sent.reply_markup).includes(`confirm_deposit:${FAKE.appId}`), "버튼이 그대로 붙는다");
    assert(JSON.parse(cap.bodyText).result.ok === true, "응답의 result.ok");
  });
}

// ---------------------------------------------------------------------------
// O. 열림 모드 거절
// ---------------------------------------------------------------------------

Deno.test("O01 열림: 헤더 없음 / 틀림 → 401, 바깥 호출 0", async () => {
  const handler = await entry("patched", "open");
  const sameLenWrong = FAKE.webhookSecret.slice(0, -1) + "2";
  const cases: Array<[string, Record<string, string>]> = [
    ["헤더 없음", {}],
    ["헤더 빈 값", { "x-telegram-bot-api-secret-token": "" }],
    ["헤더 틀림(길이 다름)", { "x-telegram-bot-api-secret-token": "wrong" }],
    ["헤더 틀림(길이 같음)", { "x-telegram-bot-api-secret-token": sameLenWrong }],
    ["다른 이름의 헤더에 맞는 값", { "x-webhook-secret": FAKE.webhookSecret }],
    ["Authorization에 맞는 값", { "Authorization": `Bearer ${FAKE.webhookSecret}` }],
  ];
  for (const [name, headers] of cases) {
    for (const [action, data] of Object.entries(ACTION_DATA)) {
      const world = seededWorld();
      const before = JSON.stringify(world.tables);
      const cap = await invoke(handler, world, jsonRequest(callbackUpdate(data), headers));
      assertRejected(cap, 401, "bad_secret", `${name} ${action}`);
      assertEquals(JSON.stringify(world.tables), before, `${name} ${action}: 가짜 DB 변화 0`);
    }
  }
});

Deno.test("O02 열림: 맞는 헤더 + 다른 사람 / 다른 채팅 / 그룹 / 필드 누락 / 목록에 없는 동작 / UUID 아님 → 200 미수락, 바깥 호출 0", async () => {
  const handler = await entry("patched", "open");
  const d = ACTION_DATA.confirm_deposit;
  const msg = (chat: Row, extra: Row = {}) => ({ message: { message_id: 7001, chat, ...extra } });
  const cases: Array<[string, Row, string]> = [
    ["다른 사람", callbackUpdate(d, { from: { id: FAKE.otherUserId } }), "not_owner"],
    ["다른 사람이 자기 1:1 채팅에서", callbackUpdate(d, { from: { id: FAKE.otherUserId }, ...msg({ id: FAKE.otherUserId, type: "private" }) }), "not_owner"],
    ["대표가 다른 채팅에서", callbackUpdate(d, msg({ id: FAKE.otherUserId, type: "private" })), "not_owner"],
    ["그룹", callbackUpdate(d, msg({ id: FAKE.groupChatId, type: "group" })), "not_owner"],
    ["채팅 번호는 같고 종류만 group", callbackUpdate(d, msg({ id: Number(FAKE.chatId), type: "group" })), "not_owner"],
    ["필드 누락: id", callbackUpdate(d, { id: undefined }), "malformed"],
    ["필드 누락: data", { callback_query: { ...(callbackUpdate(d).callback_query as Row), data: undefined } }, "malformed"],
    ["필드 누락: from", callbackUpdate(d, { from: undefined }), "malformed"],
    ["필드 누락: message", callbackUpdate(d, { message: undefined }), "malformed"],
    ["필드 누락: message.chat", callbackUpdate(d, { message: { message_id: 7001 } }), "malformed"],
    ["필드 누락: message_id", callbackUpdate(d, { message: { chat: { id: Number(FAKE.chatId), type: "private" } } }), "malformed"],
    ["형 틀림: from.id 문자열", callbackUpdate(d, { from: { id: String(FAKE.ownerUserId) } }), "malformed"],
    ["형 틀림: chat.id 문자열", callbackUpdate(d, msg({ id: FAKE.chatId, type: "private" })), "malformed"],
    ["callback_query가 문자열", { callback_query: "x" }, "malformed"],
    ["callback_query가 숫자", { callback_query: 1 }, "malformed"],
    ["callback_query가 빈 객체", { callback_query: {} }, "malformed"],
    ["목록에 없는 동작", callbackUpdate(`delete_all:${FAKE.appId}`), "bad_data"],
    ["동작 이름 대문자", callbackUpdate(`CONFIRM_DEPOSIT:${FAKE.appId}`), "bad_data"],
    ["UUID 아님", callbackUpdate("confirm_deposit:12345"), "bad_data"],
    ["UUID 뒤에 조회 조건", callbackUpdate(`confirm_deposit:${FAKE.appId}&select=*`), "bad_data"],
    ["구분자 없음", callbackUpdate("confirm_deposit"), "bad_data"],
    ["빈 data", callbackUpdate(""), "bad_data"],
  ];
  for (const [name, body, reason] of cases) {
    const world = seededWorld();
    const before = JSON.stringify(world.tables);
    const cap = await invoke(handler, world, jsonRequest(body, SECRET_HEADER));
    assertRejected(cap, 200, reason, name);
    assertEquals(JSON.stringify(world.tables), before, `${name}: 가짜 DB 변화 0`);
  }
});

Deno.test("O03 열림: 거절된 콜백 본문은 알림(type) 분기로 넘어가지 않는다", async () => {
  const handler = await entry("patched", "open");
  const extra = { type: "new_application", data: { name: "x" } };
  const cases: Array<[string, Row, Record<string, string>, number, string]> = [
    ["헤더 없음 + type", { ...callbackUpdate(ACTION_DATA.confirm_deposit), ...extra }, {}, 401, "bad_secret"],
    ["다른 사람 + type", { ...callbackUpdate(ACTION_DATA.confirm_deposit, { from: { id: FAKE.otherUserId } }), ...extra }, SECRET_HEADER, 200, "not_owner"],
    ["엉망인 callback_query + type", { callback_query: "x", ...extra }, SECRET_HEADER, 200, "malformed"],
  ];
  for (const [name, body, headers, status, reason] of cases) {
    const cap = await invoke(handler, seededWorld(), jsonRequest(body, headers));
    assertRejected(cap, status, reason, name);
  }
});

Deno.test("O04 열림: 거절 로그에 요청 원문·헤더·사람 번호·data가 남지 않는다", async () => {
  const handler = await entry("patched", "open");
  const marker = "MARKER-SHOULD-NOT-BE-LOGGED";
  const cases: Array<[Row, Record<string, string>]> = [
    [callbackUpdate(`${marker}:${FAKE.appId}`), SECRET_HEADER],
    [callbackUpdate(ACTION_DATA.confirm_deposit, { from: { id: FAKE.otherUserId, first_name: marker } }), SECRET_HEADER],
    [callbackUpdate(ACTION_DATA.confirm_deposit), { "x-telegram-bot-api-secret-token": marker }],
  ];
  for (const [body, headers] of cases) {
    const cap = await invoke(handler, seededWorld(), jsonRequest(body, headers));
    const logText = JSON.stringify(cap.logs);
    for (const banned of [marker, FAKE.webhookSecret, String(FAKE.otherUserId), String(FAKE.ownerUserId), FAKE.appId]) {
      assert(!logText.includes(banned), `로그에 ${banned} 없음`);
    }
    assert(!cap.bodyText.includes(marker), "응답에도 없음");
    assertEquals(rejectedReasons(cap).length, 1, "거절 로그 한 줄");
  }
});

Deno.test("O05 열림 + 설정 불량: 맞는 헤더·대표·정상 data여도 200 미수락, 바깥 호출 0", async () => {
  const variants: Array<[string, Record<string, string | undefined>]> = [
    ["웹훅 헤더 값 없음", { ...baseEnv("open"), TELEGRAM_WEBHOOK_SECRET: undefined }],
    ["대표 번호 없음", { ...baseEnv("open"), CS_TELEGRAM_OWNER_USER_ID: undefined }],
    ["대표 번호가 숫자가 아님", { ...baseEnv("open"), CS_TELEGRAM_OWNER_USER_ID: "abc" }],
    ["대표 번호 0", { ...baseEnv("open"), CS_TELEGRAM_OWNER_USER_ID: "0" }],
    ["대표 번호 음수", { ...baseEnv("open"), CS_TELEGRAM_OWNER_USER_ID: "-111111111" }],
    ["채팅 번호 없음", { ...baseEnv("open"), TELEGRAM_CHAT_ID: undefined }],
  ];
  // 다른 시험이 불러오기를 끝낸 뒤에 환경값을 바꾼다.
  await Promise.all([entry("patched", "open"), entry("patched", undefined), entry("v26", undefined)]);
  for (const [name, env] of variants) {
    const handler = await loadEntry("patched", env);
    for (const headers of [SECRET_HEADER, {}, { "x-telegram-bot-api-secret-token": "" }]) {
      const cap = await invoke(handler, seededWorld(), jsonRequest(callbackUpdate(ACTION_DATA.confirm_deposit), headers));
      assertRejected(cap, 200, "config_invalid", `${name} / 헤더 ${JSON.stringify(headers)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// P. 열림 모드 정상
// ---------------------------------------------------------------------------

// 동작마다 자기 분기에서만 나오는 바깥 호출 순서(= 한 번 전달에 업무 한 번).
const EXPECTED_BRANCH: Record<string, string[]> = {
  confirm_deposit: [
    "db-read:applications",
    "db-write:applications",
    "kakao:payment_confirmed",
    "telegram:editMessageText",
    "telegram:answerCallbackQuery",
    "telegram:sendMessage",
  ],
  send_guide: [
    "db-read:applications",
    "db-write:applications",
    "telegram:editMessageText",
    "telegram:answerCallbackQuery",
  ],
  resume_approve: [
    "db-read:applications",
    "db-write:applications",
    "kakao:resume_approved",
    "telegram:editMessageText",
    "telegram:answerCallbackQuery",
  ],
  resume_hold: [
    "db-read:applications",
    "kakao:resume_held",
    "telegram:editMessageText",
    "telegram:answerCallbackQuery",
  ],
  retry_correction: [
    "db-read:correction_submissions",
    "db-write:correction_submissions",
    "db-read:users",
    "n8n",
    "telegram:editMessageText",
    "telegram:answerCallbackQuery",
  ],
  confirm_extension: [
    "db-read:correction_extension_requests",
    "db-read:applications",
    "rpc:service_stop_at",
    "db-read:correction_submissions",
    "db-write:applications",
    "db-write:correction_schedules",
    "db-write:correction_extension_requests",
    "db-read:correction_schedules",
    "kakao:correction_extension_complete",
    "db-write:correction_schedules",
    "telegram:editMessageText",
    "telegram:answerCallbackQuery",
  ],
};

// 분기를 구별하는 내용 확인
const BRANCH_DETAIL: Record<string, (cap: Captured) => void> = {
  confirm_deposit: (cap) => {
    const w = cap.calls[1];
    assertEquals(w.body, { deposit_confirmed_by_admin: true, deposit_confirmed_by_admin_at: Date.UTC(2026, 10, 18, 3), current_step: 5 }, "입금 확인 쓰기");
    assert(JSON.stringify(cap.calls[5].body).includes(`send_guide:${FAKE.appId}`), "다음 단계 버튼");
  },
  send_guide: (cap) => {
    assertEquals(cap.calls[1].body, { guide_sent: true, guide_sent_at: Date.UTC(2026, 10, 18, 3), current_step: 9 }, "이용방법 전달 쓰기");
  },
  resume_approve: (cap) => {
    const w = cap.calls[1];
    assert(w.url.includes("resume_requested_at=eq.") && w.url.includes("resume_stage=eq."), "조건부 쓰기");
    assertEquals((w.body as Row).resume_requested_at, null, "재개 요청 비움");
    assertEquals(w.rowsChanged, 1, "한 행");
  },
  resume_hold: (cap) => {
    assert(String((cap.calls[2].body as Row).text).includes("보류"), "보류 표시");
  },
  retry_correction: (cap) => {
    assertEquals(cap.calls[1].body, { status: "draft1_submitted", auto_retry_count: 0, last_auto_retry_at: null, retry_failed_notified: false }, "상태 되돌림");
    assert(cap.calls[3].url.endsWith("/webhook/correction-writing-draft1"), "n8n 주소");
    assertEquals((cap.calls[3].body as Row).event, "draft1_submitted", "n8n 발주 내용");
  },
  confirm_extension: (cap) => {
    assertEquals(cap.calls[6].body, { status: "confirmed", confirmed_at: "2026-11-18T03:00:00.000Z" }, "신청 확정");
    assertEquals((cap.calls[4].body as Row).extension_enabled, true, "연장 적용");
  },
};

for (const [action, data] of Object.entries(ACTION_DATA)) {
  Deno.test(`P01 열림 정상: ${action} → 자기 분기에 도달, 한 번 전달 = 업무 한 번`, async () => {
    const handler = await entry("patched", "open");
    const cap = await invoke(handler, seededWorld(), jsonRequest(callbackUpdate(data), SECRET_HEADER));
    assertEquals(cap.status, 200, "응답 코드");
    assertEquals(cap.bodyText, "OK", "응답 본문");
    assertEquals(kinds(cap.calls), EXPECTED_BRANCH[action], "바깥 호출 순서");
    BRANCH_DETAIL[action](cap);
    assertEquals(rejectedReasons(cap), [], "거절 로그 없음");
    assertEquals(cap.logs.filter((l) => l.level === "error"), [], "오류 로그 없음");
  });

  Deno.test(`P02 열림 정상: ${action} → v26 원본에 같은 요청을 넣었을 때와 바깥 호출 기록이 같다`, async () => {
    const patched = await entry("patched", "open");
    const original = await entry("v26", undefined);
    const req = () => jsonRequest(callbackUpdate(data), SECRET_HEADER);
    const a = await invoke(patched, seededWorld(), req());
    const b = await invoke(original, seededWorld(), req());
    assert(a.calls.length > 0, "호출이 있다");
    assertEquals(comparable(a.calls), comparable(b.calls), "호출 기록");
    assertEquals([a.status, a.bodyText], [b.status, b.bodyText], "응답");
  });
}

Deno.test("P03 열림 정상: 접근 불가 메시지 형식(message.from 없음)의 버튼도 처리된다", async () => {
  const handler = await entry("patched", "open");
  const update = callbackUpdate(ACTION_DATA.send_guide, {
    message: { chat: { id: Number(FAKE.chatId), type: "private" }, message_id: 7001, date: 0 },
  });
  const cap = await invoke(handler, seededWorld(), jsonRequest(update, SECRET_HEADER));
  assertEquals([cap.status, cap.bodyText], [200, "OK"], "응답");
  assertEquals(kinds(cap.calls), EXPECTED_BRANCH.send_guide, "바깥 호출 순서");
});

Deno.test("P04 열림 정상: 없는 대상(시험용 UUID) → 조회 1회 + '찾을 수 없습니다' 응답 1회, 쓰기·발송 0", async () => {
  const handler = await entry("patched", "open");
  const cap = await invoke(handler, seededWorld(), jsonRequest(callbackUpdate(`confirm_deposit:${FAKE.missingId}`), SECRET_HEADER));
  assertEquals([cap.status, cap.bodyText], [200, "OK"], "응답");
  assertEquals(kinds(cap.calls), ["db-read:applications", "telegram:answerCallbackQuery"], "바깥 호출");
  assertEquals((cap.calls[1].body as Row).text, "신청서를 찾을 수 없습니다.", "안내 문구");
});

Deno.test("P05 열림 정상: 대문자 UUID도 같은 분기에 도달한다(조회 주소에는 받은 글자 그대로 들어간다)", async () => {
  const handler = await entry("patched", "open");
  const upper = FAKE.missingId.toUpperCase();
  const cap = await invoke(handler, seededWorld(), jsonRequest(callbackUpdate(`send_guide:${upper}`), SECRET_HEADER));
  assertEquals(kinds(cap.calls), ["db-read:applications", "telegram:answerCallbackQuery"], "바깥 호출");
  assert(cap.calls[0].url.includes(`id=eq.${upper}`), "조회 주소");
});

// ---------------------------------------------------------------------------
// N. 알림 경로 비교 (v26 원본 ↔ 수정본, 두 모드)
// ---------------------------------------------------------------------------

const NOTIFICATIONS: Array<[string, Row, { sendMessage: number }]> = [
  ["new_application", { type: "new_application", data: { name: "시험학생", email: "student@example.invalid", phone: "010-0000-0000", target_score: 100, preferred_program: "시험 프로그램", enrollment_no: 2 } }, { sendMessage: 1 }],
  ["student_agreed", { type: "student_agreed", data: { name: "시험학생", program: "시험 프로그램" } }, { sendMessage: 1 }],
  ["contract_signed", { type: "contract_signed", data: { name: "시험학생", program: "시험 프로그램" } }, { sendMessage: 1 }],
  ["survey_submitted", { type: "survey_submitted", data: { name: "시험학생", exam_date: "2026-11-01" } }, { sendMessage: 1 }],
  ["deposit_claimed", { type: "deposit_claimed", data: { name: "시험학생", depositor_name: "시험입금자", app_id: FAKE.appId } }, { sendMessage: 1 }],
  ["correction_retry_failed", { type: "correction_retry_failed", data: { name: "시험학생", task_type: "writing_email", session_number: 3, draft_round: 1, submission_id: FAKE.subId } }, { sendMessage: 1 }],
  ["extension_requested", { type: "extension_requested", data: { name: "시험학생", deadline: "2026-11-30", request_id: FAKE.extReqId, app_id: FAKE.appId } }, { sendMessage: 1 }],
  ["resume_requested", { type: "resume_requested", data: { app_id: FAKE.appId } }, { sendMessage: 1 }],
  ["restart_requested", { type: "restart_requested", data: { app_id: FAKE.appId, materials: ["시험 교재"] } }, { sendMessage: 1 }],
  ["followup_new_drafts", { type: "followup_new_drafts", data: { alert_key: "drafts:2026-11-18T12", count: 3, earliest_scheduled_at: "2026-11-19T01:00:00Z" } }, { sendMessage: 1 }],
  ["followup_alert", { type: "followup_alert", data: { alert_key: "fail:job-0001:final", kind: "send_failed", failure_stage: "final", name: "시험학생", email: "student@example.invalid", stage: "1차", reason: "시험 사유", occurred_at: "2026-11-18T02:00:00Z" } }, { sendMessage: 1 }],
];

// 11종 밖의 덧붙임(같은 입구를 지나는 다른 요청 모양)
const NOTIFICATION_EXTRAS: Array<[string, Row, { sendMessage: number }]> = [
  ["추가: followup_alert check_failed", { type: "followup_alert", data: { alert_key: "held:job-0002", kind: "check_failed", reason: "시험 사유", occurred_at: "2026-11-18T02:00:00Z" } }, { sendMessage: 1 }],
  ["추가: followup_alert stale_target", { type: "followup_alert", data: { alert_key: "stale:job-0003", kind: "stale_target", reason: "시험 사유", occurred_at: "2026-11-18T02:00:00Z" } }, { sendMessage: 1 }],
  ["추가: followup_alert missed_run", { type: "followup_alert", data: { alert_key: "missed_run:2026-11-18T11", kind: "missed_run", last_success_at: "2026-11-18T01:00:00Z", occurred_at: "2026-11-18T02:00:00Z" } }, { sendMessage: 1 }],
  ["추가: resume_requested 없는 신청서(404)", { type: "resume_requested", data: { app_id: FAKE.missingId } }, { sendMessage: 0 }],
  ["추가: 모르는 type(400)", { type: "no_such_type", data: {} }, { sendMessage: 0 }],
  ["추가: followup alert_key 없음(400)", { type: "followup_alert", data: { kind: "send_failed" } }, { sendMessage: 0 }],
  ["추가: type도 callback_query도 없음(400)", { hello: "x" }, { sendMessage: 0 }],
];

async function compareNotification(label: string, body: Row, expect: { sendMessage: number }) {
  const original = await entry("v26", undefined);
  const base = await invoke(original, seededWorld(), jsonRequest(body));
  assertEquals(
    kinds(base.calls).filter((k) => k === "telegram:sendMessage").length,
    expect.sendMessage,
    `${label}: v26의 sendMessage 횟수(비교가 빈 것끼리가 아님을 확인)`,
  );
  for (const mode of ["open", undefined] as const) {
    const modeLabel = mode === undefined ? "닫힘" : "열림";
    const patched = await entry("patched", mode);
    // 알림 요청은 헤더가 있든 없든 같다.
    for (const headers of [{}, SECRET_HEADER]) {
      const got = await invoke(patched, seededWorld(), jsonRequest(body, headers));
      assertEquals(comparable(got.calls), comparable(base.calls), `${label} [${modeLabel}]: 바깥 호출 기록이 v26과 같다`);
      assertEquals([got.status, got.bodyText], [base.status, base.bodyText], `${label} [${modeLabel}]: 응답이 v26과 같다`);
      assertEquals(got.logs, base.logs, `${label} [${modeLabel}]: 로그가 v26과 같다`);
    }
  }
}

for (const [label, body, expect] of NOTIFICATIONS) {
  Deno.test(`N01 알림 ${label}: 두 모드 모두 v26 원본과 같은 바깥 호출·응답`, async () => {
    await compareNotification(label, body, expect);
  });
}

for (const [label, body, expect] of NOTIFICATION_EXTRAS) {
  Deno.test(`N02 ${label}: 두 모드 모두 v26 원본과 같은 바깥 호출·응답`, async () => {
    await compareNotification(label, body, expect);
  });
}

Deno.test("N03 후속메일 알림 같은 키 두 번: 두 번째는 발송하지 않는 동작이 v26과 같다", async () => {
  const body = NOTIFICATIONS.find(([l]) => l === "followup_alert")![1];
  const run = async (handler: Handler) => {
    const world = seededWorld();
    const first = await invoke(handler, world, jsonRequest(body));
    const second = await invoke(handler, world, jsonRequest(body));
    return { first: comparable(first.calls), second: comparable(second.calls), responses: [first.status, first.bodyText, second.status, second.bodyText] };
  };
  const base = await run(await entry("v26", undefined));
  assertEquals((base.second as Row[]).map((c) => c.kind), ["rpc:followup_claim_alert"], "v26: 두 번째는 장부 확인만");
  for (const mode of ["open", undefined] as const) {
    assertEquals(await run(await entry("patched", mode)), base, `모드 ${mode ?? "닫힘"}`);
  }
});

Deno.test("N04 입구의 다른 길: OPTIONS·JSON이 아닌 요청이 v26과 같다", async () => {
  const original = await entry("v26", undefined);
  const make: Array<[string, () => Request]> = [
    ["OPTIONS", () => new Request(FAKE.entryUrl, { method: "OPTIONS" })],
    ["JSON 아님", () => new Request(FAKE.entryUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" })],
    ["깨진 JSON", () => new Request(FAKE.entryUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })],
  ];
  for (const [label, mk] of make) {
    const base = await invoke(original, seededWorld(), mk());
    for (const mode of ["open", undefined] as const) {
      const got = await invoke(await entry("patched", mode), seededWorld(), mk());
      assertEquals([got.status, got.bodyText, got.calls.length], [base.status, base.bodyText, base.calls.length], `${label} [${mode ?? "닫힘"}]`);
    }
  }
});

Deno.test("N05 대조: 같은 위조 콜백을 v26 원본에 넣으면 처리된다(시험이 차이를 잡아낼 수 있음을 확인)", async () => {
  const original = await entry("v26", undefined);
  const forged = callbackUpdate(ACTION_DATA.confirm_deposit, { from: { id: FAKE.otherUserId } });
  const cap = await invoke(original, seededWorld(), jsonRequest(forged)); // 헤더 없음 + 다른 사람
  assertEquals(kinds(cap.calls), EXPECTED_BRANCH.confirm_deposit, "v26은 확인 없이 입금 확인 분기를 탄다");
});
