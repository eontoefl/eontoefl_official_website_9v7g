// ===== G. 판정 단위 시험 (callback-guard.ts) =====
// 계약 A-1 2번의 판정 순서 1~7을 줄마다 확인한다. 값은 전부 가짜.

import {
  CALLBACK_ACTIONS,
  type CallbackGuardConfig,
  checkTelegramCallback,
} from "../callback-guard.ts";
import { assertEquals } from "./harness.ts";

const SECRET = "fake-webhook-secret-0001";
const OWNER = 111111111;
const CHAT = "111111111";
const UUID = "00000000-0000-4000-8000-0000000000a1";

const OPEN: CallbackGuardConfig = { mode: "open", webhookSecret: SECRET, ownerUserId: OWNER, chatId: CHAT };

type Obj = Record<string, unknown>;

function cq(overrides: Obj = {}): Obj {
  return {
    id: "cbq-0001",
    from: { id: OWNER, is_bot: false },
    message: {
      message_id: 7001,
      from: { id: 333333333, is_bot: true },
      chat: { id: OWNER, type: "private" },
      date: 1790000000,
    },
    data: `confirm_deposit:${UUID}`,
    ...overrides,
  };
}

const PASS = { ok: true };
const no = (status: number, reason: string) => ({ ok: false, status, reason });

Deno.test("G00 목록: CALLBACK_ACTIONS는 계약의 여섯 이름과 같다", () => {
  assertEquals([...CALLBACK_ACTIONS], [
    "confirm_deposit",
    "send_guide",
    "resume_approve",
    "resume_hold",
    "retry_correction",
    "confirm_extension",
  ], "여섯 이름");
});

Deno.test("G01 닫힘: mode가 open이 아니면 전부 200 closed (헤더·내용과 무관)", () => {
  for (const mode of ["", "closed", "OPEN", "Open", " open", "open ", "1", "true"]) {
    const cfg = { ...OPEN, mode };
    assertEquals(checkTelegramCallback(SECRET, cq(), cfg), no(200, "closed"), `mode=${JSON.stringify(mode)} 맞는 요청`);
    assertEquals(checkTelegramCallback(null, cq(), cfg), no(200, "closed"), `mode=${JSON.stringify(mode)} 헤더 없음`);
    assertEquals(checkTelegramCallback("wrong", null, cfg), no(200, "closed"), `mode=${JSON.stringify(mode)} 틀린 헤더·빈 내용`);
  }
  // mode 값이 문자열이 아니게 들어와도 닫힘
  assertEquals(
    checkTelegramCallback(SECRET, cq(), { ...OPEN, mode: undefined as unknown as string }),
    no(200, "closed"),
    "mode undefined",
  );
});

Deno.test("G01b 닫힘이 설정 불량보다 먼저다", () => {
  assertEquals(
    checkTelegramCallback(SECRET, cq(), { mode: "", webhookSecret: "", ownerUserId: NaN, chatId: "" }),
    no(200, "closed"),
    "닫힘 + 설정 불량",
  );
});

Deno.test("G02 설정 불량: 200 config_invalid (헤더가 맞아도, 없어도)", () => {
  const bad: Array<[string, CallbackGuardConfig]> = [
    ["webhookSecret 빈 값", { ...OPEN, webhookSecret: "" }],
    ["ownerUserId 0", { ...OPEN, ownerUserId: 0 }],
    ["ownerUserId 음수", { ...OPEN, ownerUserId: -OWNER }],
    ["ownerUserId NaN", { ...OPEN, ownerUserId: NaN }],
    ["ownerUserId 소수", { ...OPEN, ownerUserId: 1.5 }],
    ["ownerUserId 무한대", { ...OPEN, ownerUserId: Infinity }],
    ["ownerUserId 안전 범위 밖", { ...OPEN, ownerUserId: Number.MAX_SAFE_INTEGER + 1 }],
    ["ownerUserId 문자열", { ...OPEN, ownerUserId: String(OWNER) as unknown as number }],
    ["chatId 빈 값", { ...OPEN, chatId: "" }],
    ["chatId undefined", { ...OPEN, chatId: undefined as unknown as string }],
  ];
  for (const [label, cfg] of bad) {
    assertEquals(checkTelegramCallback(SECRET, cq(), cfg), no(200, "config_invalid"), `${label} / 맞는 헤더`);
    assertEquals(checkTelegramCallback(null, cq(), cfg), no(200, "config_invalid"), `${label} / 헤더 없음`);
  }
  // webhookSecret이 빈 값일 때 빈 헤더로 통과하면 안 된다
  assertEquals(checkTelegramCallback("", cq(), { ...OPEN, webhookSecret: "" }), no(200, "config_invalid"), "빈 값끼리 일치 금지");
});

Deno.test("G03 헤더: 없음·불일치는 401 bad_secret (길이 같음·다름 경계)", () => {
  const sameLenLastDiff = SECRET.slice(0, -1) + "2";
  const sameLenFirstDiff = "x" + SECRET.slice(1);
  const cases: Array<[string, string | null | undefined]> = [
    ["null", null],
    ["undefined", undefined],
    ["빈 문자열", ""],
    ["길이 같고 마지막 글자만 다름", sameLenLastDiff],
    ["길이 같고 첫 글자만 다름", sameLenFirstDiff],
    ["한 글자 짧음", SECRET.slice(0, -1)],
    ["한 글자 김", SECRET + "1"],
    ["앞뒤 공백", ` ${SECRET} `],
    ["대문자로 바꿈", SECRET.toUpperCase()],
  ];
  for (const [label, header] of cases) {
    assertEquals(checkTelegramCallback(header, cq(), OPEN), no(401, "bad_secret"), label);
  }
  assertEquals(sameLenLastDiff.length, SECRET.length, "경계값 길이 확인");
  // 헤더 확인이 필드 확인보다 먼저다: 내용이 엉망이어도 헤더가 틀리면 401
  assertEquals(checkTelegramCallback("wrong", null, OPEN), no(401, "bad_secret"), "헤더 틀림 + 내용 없음");
  assertEquals(checkTelegramCallback(SECRET, cq(), OPEN), PASS, "맞는 헤더는 통과");
});

Deno.test("G04 필드: 없거나 형이 틀리면 200 malformed", () => {
  const cases: Array<[string, unknown]> = [
    ["callback_query가 null", null],
    ["문자열", "x"],
    ["숫자", 1],
    ["배열", []],
    ["빈 객체", {}],
    ["id 없음", cq({ id: undefined })],
    ["id 숫자", cq({ id: 12345 })],
    ["data 없음", cq({ data: undefined })],
    ["data 숫자", cq({ data: 1 })],
    ["data null", cq({ data: null })],
    ["from 없음", cq({ from: undefined })],
    ["from null", cq({ from: null })],
    ["from.id 없음", cq({ from: { is_bot: false } })],
    ["from.id 문자열(대표 번호와 같은 숫자 글자)", cq({ from: { id: String(OWNER) } })],
    ["message 없음", cq({ message: undefined })],
    ["message null", cq({ message: null })],
    ["message 문자열", cq({ message: "x" })],
    ["message.chat 없음", cq({ message: { message_id: 7001 } })],
    ["message.chat null", cq({ message: { message_id: 7001, chat: null } })],
    ["chat.id 없음", cq({ message: { message_id: 7001, chat: { type: "private" } } })],
    ["chat.id 문자열(채팅 번호와 같은 숫자 글자)", cq({ message: { message_id: 7001, chat: { id: CHAT, type: "private" } } })],
    ["chat.type 없음", cq({ message: { message_id: 7001, chat: { id: OWNER } } })],
    ["chat.type 숫자", cq({ message: { message_id: 7001, chat: { id: OWNER, type: 1 } } })],
    ["message_id 없음", cq({ message: { chat: { id: OWNER, type: "private" } } })],
    ["message_id 문자열", cq({ message: { message_id: "7001", chat: { id: OWNER, type: "private" } } })],
  ];
  for (const [label, value] of cases) {
    assertEquals(checkTelegramCallback(SECRET, value, OPEN), no(200, "malformed"), label);
  }
});

Deno.test("G04b 접근 불가 메시지 형식(InaccessibleMessage: chat, message_id, date=0뿐, from 없음)은 통과", () => {
  const inaccessible = cq({ message: { chat: { id: OWNER, type: "private" }, message_id: 7001, date: 0 } });
  assertEquals(checkTelegramCallback(SECRET, inaccessible, OPEN), PASS, "message.from 없음");
});

Deno.test("G05 대표·채팅 확인: 200 not_owner (세 가지를 각각 본다)", () => {
  const msg = (chat: Obj) => ({ message_id: 7001, chat });
  const cases: Array<[string, unknown, CallbackGuardConfig]> = [
    ["다른 사람이 누름", cq({ from: { id: 222222222 } }), OPEN],
    ["다른 사람이 자기 1:1 채팅에서 누름", cq({ from: { id: 222222222 }, message: msg({ id: 222222222, type: "private" }) }), OPEN],
    ["대표가 다른 채팅에서 누름", cq({ message: msg({ id: 222222222, type: "private" }) }), OPEN],
    ["대표가 그룹에서 누름(채팅 번호 다름)", cq({ message: msg({ id: -1000000000001, type: "group" }) }), OPEN],
    ["채팅 번호는 같지만 종류가 group", cq({ message: msg({ id: OWNER, type: "group" }) }), OPEN],
    ["종류가 supergroup", cq({ message: msg({ id: OWNER, type: "supergroup" }) }), OPEN],
    ["종류가 channel", cq({ message: msg({ id: OWNER, type: "channel" }) }), OPEN],
    ["종류 대문자 Private", cq({ message: msg({ id: OWNER, type: "Private" }) }), OPEN],
    ["from.id 소수", cq({ from: { id: OWNER + 0.5 } }), OPEN],
    // 알림 목적지가 다른 사람의 1:1 채팅으로 잘못 바뀐 경우: 그 사람이 눌러도, 대표가 눌러도 통과하지 못한다.
    ["목적지 오설정: 그 채팅의 상대가 누름", cq({ from: { id: 222222222 }, message: msg({ id: 222222222, type: "private" }) }), { ...OPEN, chatId: "222222222" }],
    ["목적지 오설정: 대표가 자기 채팅에서 누름", cq(), { ...OPEN, chatId: "222222222" }],
    // 채팅 번호 설정에 공백이 섞이면 글자 그대로 비교하므로 닫힌다.
    ["chatId 설정에 공백", cq(), { ...OPEN, chatId: ` ${CHAT}` }],
  ];
  for (const [label, value, cfg] of cases) {
    assertEquals(checkTelegramCallback(SECRET, value, cfg), no(200, "not_owner"), label);
  }
});

Deno.test("G05b chat.id는 숫자로 오고, 설정의 문자열과 String()으로 비교한다 (음수 채팅 번호 포함)", () => {
  const negChat = cq({ message: { message_id: 7001, chat: { id: -1000000000001, type: "private" } } });
  // 종류가 private이고 번호가 설정과 같으면 번호의 부호와 무관하게 비교 자체는 성립한다.
  assertEquals(
    checkTelegramCallback(SECRET, negChat, { ...OPEN, chatId: "-1000000000001" }),
    PASS,
    "숫자 chat.id ↔ 문자열 chatId",
  );
});

Deno.test("G06 data 모양: 여섯 동작 중 하나:UUID가 아니면 200 bad_data", () => {
  const cases: Array<[string, string]> = [
    ["빈 문자열", ""],
    ["구분자 없음", "confirm_deposit"],
    ["대상 없음", "confirm_deposit:"],
    ["동작 없음", `:${UUID}`],
    ["목록에 없는 동작", `delete_all:${UUID}`],
    ["후기 봇 동작", "review_blog:12"],
    ["동작 이름 대문자", `CONFIRM_DEPOSIT:${UUID}`],
    ["동작 이름 앞 공백", ` confirm_deposit:${UUID}`],
    ["동작 이름이 목록 이름으로 시작만 함", `confirm_deposit_x:${UUID}`],
    ["UUID 아님(숫자)", "confirm_deposit:12345"],
    ["UUID 한 글자 짧음", `confirm_deposit:${UUID.slice(0, -1)}`],
    ["UUID 한 글자 김", `confirm_deposit:${UUID}0`],
    ["UUID에 16진수 아닌 글자", `confirm_deposit:${UUID.slice(0, -1)}g`],
    ["UUID 줄표 없음", `confirm_deposit:${UUID.replaceAll("-", "")}`],
    ["UUID 뒤에 조건 덧붙임", `confirm_deposit:${UUID}&select=*`],
    ["UUID 뒤에 구분자 하나 더", `confirm_deposit:${UUID}:x`],
    ["UUID 뒤 줄바꿈", `confirm_deposit:${UUID}\n`],
    ["UUID 앞 공백", `confirm_deposit: ${UUID}`],
    ["조회 조건 주입 모양", "confirm_deposit:x&id=neq.0"],
  ];
  for (const [label, data] of cases) {
    assertEquals(checkTelegramCallback(SECRET, cq({ data }), OPEN), no(200, "bad_data"), label);
  }
});

Deno.test("G07 통과: 여섯 동작 각각 + UUID 대소문자", () => {
  for (const action of CALLBACK_ACTIONS) {
    assertEquals(checkTelegramCallback(SECRET, cq({ data: `${action}:${UUID}` }), OPEN), PASS, `${action} 소문자 UUID`);
    assertEquals(checkTelegramCallback(SECRET, cq({ data: `${action}:${UUID.toUpperCase()}` }), OPEN), PASS, `${action} 대문자 UUID`);
  }
  assertEquals(
    checkTelegramCallback(SECRET, cq({ data: "send_guide:AbCdEf01-2345-6789-aBcD-Ef0123456789" }), OPEN),
    PASS,
    "대소문자 섞인 UUID",
  );
});

Deno.test("G08 판정 순서: 앞 단계의 사유가 먼저 나온다", () => {
  const everythingWrong = { id: 1, from: { id: 222222222 }, data: "x" };
  assertEquals(checkTelegramCallback("wrong", everythingWrong, { ...OPEN, mode: "" }), no(200, "closed"), "1 닫힘");
  assertEquals(checkTelegramCallback("wrong", everythingWrong, { ...OPEN, webhookSecret: "" }), no(200, "config_invalid"), "2 설정");
  assertEquals(checkTelegramCallback("wrong", everythingWrong, OPEN), no(401, "bad_secret"), "3 헤더");
  assertEquals(checkTelegramCallback(SECRET, everythingWrong, OPEN), no(200, "malformed"), "4 필드");
  assertEquals(checkTelegramCallback(SECRET, cq({ from: { id: 222222222 }, data: "x" }), OPEN), no(200, "not_owner"), "5 대표");
  assertEquals(checkTelegramCallback(SECRET, cq({ data: "x" }), OPEN), no(200, "bad_data"), "6 data");
  assertEquals(checkTelegramCallback(SECRET, cq(), OPEN), PASS, "7 통과");
});

Deno.test("G09 판정은 받은 값을 바꾸지 않는다", () => {
  const value = cq();
  const before = JSON.stringify(value);
  checkTelegramCallback(SECRET, value, OPEN);
  assertEquals(JSON.stringify(value), before, "입력 그대로");
});
