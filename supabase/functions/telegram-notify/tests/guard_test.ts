// ===== G. 판정 단위 시험 (callback-guard.ts) =====
// 1차 계약 A-1 2번의 판정 순서에 2차 계약 1절(허용 목록·설정 형식·필드 경계)을 반영해 줄마다 확인한다.
// 값은 전부 가짜.

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
const ALL = CALLBACK_ACTIONS.join(",");

// 여섯 동작을 모두 연 올바른 설정
const OPEN: CallbackGuardConfig = { openActions: ALL, webhookSecret: SECRET, ownerUserId: String(OWNER), chatId: CHAT };

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

const msg = (chat: Obj, messageId: unknown = 7001) => ({ message: { message_id: messageId, chat } });
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

Deno.test("G01 닫힘: 허용 목록이 없거나 비었거나 이름이 하나도 없으면 전부 200 closed (헤더·내용과 무관)", () => {
  const empties: Array<[string, unknown]> = [
    ["빈 값", ""],
    ["공백만", "   "],
    ["탭·줄바꿈만", "\t\n"],
    ["쉼표만", ","],
    ["쉼표와 공백만", " , ,  "],
    ["undefined", undefined],
    ["null", null],
    ["숫자", 1],
    ["배열", ["confirm_deposit"]],
  ];
  for (const [label, value] of empties) {
    const cfg = { ...OPEN, openActions: value as string };
    assertEquals(checkTelegramCallback(SECRET, cq(), cfg), no(200, "closed"), `${label} / 맞는 요청`);
    assertEquals(checkTelegramCallback(null, cq(), cfg), no(200, "closed"), `${label} / 헤더 없음`);
    assertEquals(checkTelegramCallback("wrong", null, cfg), no(200, "closed"), `${label} / 틀린 헤더·빈 내용`);
  }
});

Deno.test("G01b 닫힘이 설정 불량보다 먼저다", () => {
  assertEquals(
    checkTelegramCallback(SECRET, cq(), { openActions: "", webhookSecret: "", ownerUserId: "abc", chatId: "" }),
    no(200, "closed"),
    "닫힘 + 다른 설정 불량",
  );
});

Deno.test("G02a 허용 목록에 모르는 이름이 하나라도 있으면 전부 200 config_invalid", () => {
  const lists = [
    "open", // 1차의 TELEGRAM_CALLBACK_MODE 값을 여기에 잘못 넣은 경우
    "all",
    "*",
    "true",
    "confirm_deposit,delete_all",
    "delete_all,confirm_deposit",
    "Confirm_Deposit", // 대소문자가 다르면 모르는 이름
    "confirm_deposit;send_guide", // 구분자가 쉼표가 아님
    "confirm_deposit send_guide",
    "confirm_deposit,send_guid", // 오타
    `${ALL},review_blog`,
  ];
  for (const openActions of lists) {
    const cfg = { ...OPEN, openActions };
    // 목록에 들어 있는 올바른 이름의 버튼도 통과하지 못한다.
    assertEquals(checkTelegramCallback(SECRET, cq(), cfg), no(200, "config_invalid"), `${openActions} / 맞는 요청`);
    assertEquals(checkTelegramCallback(null, cq(), cfg), no(200, "config_invalid"), `${openActions} / 헤더 없음`);
  }
});

Deno.test("G02b 헤더 값 설정이 비었으면 200 config_invalid", () => {
  const cfg = { ...OPEN, webhookSecret: "" };
  assertEquals(checkTelegramCallback(SECRET, cq(), cfg), no(200, "config_invalid"), "맞는 헤더");
  assertEquals(checkTelegramCallback(null, cq(), cfg), no(200, "config_invalid"), "헤더 없음");
  assertEquals(checkTelegramCallback("", cq(), cfg), no(200, "config_invalid"), "빈 값끼리 일치 금지");
  assertEquals(
    checkTelegramCallback(SECRET, cq(), { ...OPEN, webhookSecret: undefined as unknown as string }),
    no(200, "config_invalid"),
    "undefined",
  );
});

Deno.test("G02c 대표 번호·채팅 번호 설정은 '1~9로 시작하는 숫자 글자만' + 안전한 정수 범위일 때만 유효", () => {
  const badFormats: Array<[string, unknown]> = [
    ["빈 값", ""],
    ["지수 표기 1e3", "1e3"],
    ["앞뒤 공백", " 123 "],
    ["앞 공백", " 111111111"],
    ["뒤 줄바꿈", "111111111\n"],
    ["0으로 시작", "0123"],
    ["0", "0"],
    ["음수", "-5"],
    ["더하기 부호", "+5"],
    ["소수", "1.5"],
    ["소수점 0", "111111111.0"],
    ["16진수", "0x10"],
    ["글자", "abc"],
    ["숫자 뒤 글자", "111111111a"],
    ["전각 숫자", "１２３"],
    ["안전 범위 밖(2^53)", "9007199254740992"],
    ["안전 범위 밖(20자리)", "99999999999999999999"],
    ["undefined", undefined],
    ["숫자 형(문자열 아님)", OWNER],
  ];
  for (const [label, value] of badFormats) {
    // 요청은 "그 값을 Number()로 읽었을 때의 번호"로 맞춰 보낸다. 그래도 통과하면 안 된다.
    const asNumber = Number(value);
    const id = Number.isSafeInteger(asNumber) ? asNumber : OWNER;
    const lenient = cq({ from: { id }, ...msg({ id, type: "private" }) });
    for (const request of [cq(), lenient]) {
      assertEquals(
        checkTelegramCallback(SECRET, request, { ...OPEN, ownerUserId: value as string, chatId: value as string }),
        no(200, "config_invalid"),
        `대표·채팅 둘 다 ${label}`,
      );
      assertEquals(
        checkTelegramCallback(SECRET, request, { ...OPEN, ownerUserId: value as string }),
        no(200, "config_invalid"),
        `대표 번호 ${label}`,
      );
      assertEquals(
        checkTelegramCallback(SECRET, request, { ...OPEN, chatId: value as string }),
        no(200, "config_invalid"),
        `채팅 번호 ${label}`,
      );
    }
    assertEquals(
      checkTelegramCallback(null, cq(), { ...OPEN, ownerUserId: value as string }),
      no(200, "config_invalid"),
      `대표 번호 ${label} / 헤더 없음`,
    );
  }
  // 경계: 안전한 정수의 최댓값은 유효한 설정이다.
  const max = Number.MAX_SAFE_INTEGER;
  assertEquals(
    checkTelegramCallback(SECRET, cq({ from: { id: max }, ...msg({ id: max, type: "private" }) }), { ...OPEN, ownerUserId: String(max), chatId: String(max) }),
    PASS,
    "최댓값 설정",
  );
  assertEquals(
    checkTelegramCallback(SECRET, cq({ from: { id: 1 }, ...msg({ id: 1, type: "private" }) }), { ...OPEN, ownerUserId: "1", chatId: "1" }),
    PASS,
    "한 자리 설정",
  );
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
    ["chat.id 없음", cq(msg({ type: "private" }))],
    ["chat.id 문자열(채팅 번호와 같은 숫자 글자)", cq(msg({ id: CHAT, type: "private" }))],
    ["chat.type 없음", cq(msg({ id: OWNER }))],
    ["chat.type 숫자", cq(msg({ id: OWNER, type: 1 }))],
    ["message_id 없음", cq({ message: { chat: { id: OWNER, type: "private" } } })],
    ["message_id 문자열", cq(msg({ id: OWNER, type: "private" }, "7001"))],
  ];
  for (const [label, value] of cases) {
    assertEquals(checkTelegramCallback(SECRET, value, OPEN), no(200, "malformed"), label);
  }
});

Deno.test("G04c 필드 경계: 빈·공백 id, message_id 소수·0·음수, 안전한 정수가 아닌 번호는 200 malformed", () => {
  const chat = { id: OWNER, type: "private" };
  const cases: Array<[string, unknown]> = [
    ["id 빈 문자열", cq({ id: "" })],
    ["id 공백 하나", cq({ id: " " })],
    ["id 공백·탭·줄바꿈만", cq({ id: " \t\n" })],
    ["message_id 소수", cq(msg(chat, 7001.5))],
    ["message_id 0", cq(msg(chat, 0))],
    ["message_id 음수", cq(msg(chat, -7001))],
    ["message_id 안전 범위 밖", cq(msg(chat, Number.MAX_SAFE_INTEGER + 1))],
    ["from.id 소수", cq({ from: { id: OWNER + 0.5 } })],
    ["from.id 안전 범위 밖", cq({ from: { id: 2 ** 60 } })],
    ["chat.id 소수", cq(msg({ id: OWNER + 0.5, type: "private" }))],
    ["chat.id 안전 범위 밖", cq(msg({ id: 2 ** 60, type: "private" }))],
  ];
  for (const [label, value] of cases) {
    assertEquals(checkTelegramCallback(SECRET, value, OPEN), no(200, "malformed"), label);
  }
  // JSON으로는 올 수 없지만 값으로 들어오면: 무한대·NaN도 거절
  for (const bad of [Infinity, -Infinity, NaN]) {
    assertEquals(checkTelegramCallback(SECRET, cq(msg(chat, bad)), OPEN), no(200, "malformed"), `message_id ${bad}`);
    assertEquals(checkTelegramCallback(SECRET, cq({ from: { id: bad } }), OPEN), no(200, "malformed"), `from.id ${bad}`);
  }
  // 경계의 안쪽은 통과한다
  assertEquals(checkTelegramCallback(SECRET, cq({ id: " a " }), OPEN), PASS, "앞뒤 공백이 있어도 글자가 있는 id");
  assertEquals(checkTelegramCallback(SECRET, cq(msg(chat, 1)), OPEN), PASS, "message_id 1");
  assertEquals(checkTelegramCallback(SECRET, cq(msg(chat, Number.MAX_SAFE_INTEGER)), OPEN), PASS, "message_id 최댓값");
});

Deno.test("G04b 접근 불가 메시지 형식(InaccessibleMessage: chat, message_id, date=0뿐, from 없음)은 통과", () => {
  const inaccessible = cq({ message: { chat: { id: OWNER, type: "private" }, message_id: 7001, date: 0 } });
  assertEquals(checkTelegramCallback(SECRET, inaccessible, OPEN), PASS, "message.from 없음");
});

Deno.test("G05 대표·채팅 확인: 200 not_owner (세 가지를 각각 본다)", () => {
  const cases: Array<[string, unknown, CallbackGuardConfig]> = [
    ["다른 사람이 누름", cq({ from: { id: 222222222 } }), OPEN],
    ["다른 사람이 자기 1:1 채팅에서 누름", cq({ from: { id: 222222222 }, ...msg({ id: 222222222, type: "private" }) }), OPEN],
    ["대표가 다른 채팅에서 누름", cq(msg({ id: 222222222, type: "private" })), OPEN],
    ["대표가 그룹에서 누름(채팅 번호가 음수)", cq(msg({ id: -1000000000001, type: "group" })), OPEN],
    ["채팅 번호는 같지만 종류가 group", cq(msg({ id: OWNER, type: "group" })), OPEN],
    ["종류가 supergroup", cq(msg({ id: OWNER, type: "supergroup" })), OPEN],
    ["종류가 channel", cq(msg({ id: OWNER, type: "channel" })), OPEN],
    ["종류 대문자 Private", cq(msg({ id: OWNER, type: "Private" })), OPEN],
    ["채팅 번호가 부호만 다름", cq(msg({ id: -OWNER, type: "private" })), OPEN],
    // 알림 목적지가 다른 사람의 1:1 채팅으로 잘못 바뀐 경우: 그 사람이 눌러도, 대표가 눌러도 통과하지 못한다.
    ["목적지 오설정: 그 채팅의 상대가 누름", cq({ from: { id: 222222222 }, ...msg({ id: 222222222, type: "private" }) }), { ...OPEN, chatId: "222222222" }],
    ["목적지 오설정: 대표가 자기 채팅에서 누름", cq(), { ...OPEN, chatId: "222222222" }],
  ];
  for (const [label, value, cfg] of cases) {
    assertEquals(checkTelegramCallback(SECRET, value, cfg), no(200, "not_owner"), label);
  }
});

Deno.test("G05b 채팅 번호 설정이 음수(그룹 번호 모양)이면 요청이 그 번호와 같아도 통과하지 못한다", () => {
  const negChat = cq(msg({ id: -1000000000001, type: "private" }));
  assertEquals(
    checkTelegramCallback(SECRET, negChat, { ...OPEN, chatId: "-1000000000001" }),
    no(200, "config_invalid"),
    "음수 채팅 번호 설정",
  );
});

Deno.test("G06 data 모양: 여섯 동작 중 하나:UUID가 아니면 200 bad_data (허용 목록과 무관)", () => {
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
    assertEquals(checkTelegramCallback(SECRET, cq({ data }), OPEN), no(200, "bad_data"), `${label} / 여섯 모두 허용`);
    // 일부만 열었을 때도 모양이 틀린 data는 held가 아니라 bad_data
    assertEquals(
      checkTelegramCallback(SECRET, cq({ data }), { ...OPEN, openActions: "send_guide" }),
      no(200, "bad_data"),
      `${label} / 일부만 허용`,
    );
  }
});

Deno.test("G07 통과: 여섯 모두 허용이면 여섯 동작 각각 통과 + UUID 대소문자", () => {
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

Deno.test("G07b 일부만 허용: 목록의 동작은 통과, 여섯 중 나머지는 200 held", () => {
  const lists: Array<[string, string[]]> = [
    ["confirm_deposit", ["confirm_deposit"]],
    ["confirm_deposit,send_guide,resume_approve,confirm_extension", ["confirm_deposit", "send_guide", "resume_approve", "confirm_extension"]],
    ["resume_hold,retry_correction", ["resume_hold", "retry_correction"]],
    // 이름 앞뒤 공백은 무시, 빈 칸과 겹친 이름은 세지 않는다
    ["  send_guide ,\tresume_hold\n", ["send_guide", "resume_hold"]],
    ["send_guide,,send_guide,", ["send_guide"]],
    [",confirm_extension", ["confirm_extension"]],
  ];
  for (const [openActions, open] of lists) {
    const cfg = { ...OPEN, openActions };
    for (const action of CALLBACK_ACTIONS) {
      const want = open.includes(action) ? PASS : no(200, "held");
      assertEquals(checkTelegramCallback(SECRET, cq({ data: `${action}:${UUID}` }), cfg), want, `[${JSON.stringify(openActions)}] ${action}`);
    }
  }
});

Deno.test("G07c held는 헤더·대표 확인을 통과한 요청에만 나온다(인증 안 된 요청에 어떤 버튼이 보류인지 알려 주지 않는다)", () => {
  const cfg = { ...OPEN, openActions: "send_guide" }; // confirm_deposit은 보류 대상
  const heldData = `confirm_deposit:${UUID}`;
  assertEquals(checkTelegramCallback(SECRET, cq({ data: heldData }), cfg), no(200, "held"), "대표의 맞는 요청 → held");
  assertEquals(checkTelegramCallback(null, cq({ data: heldData }), cfg), no(401, "bad_secret"), "헤더 없음 → held 아님");
  assertEquals(checkTelegramCallback("wrong", cq({ data: heldData }), cfg), no(401, "bad_secret"), "헤더 틀림 → held 아님");
  assertEquals(checkTelegramCallback(SECRET, cq({ data: heldData, from: { id: 222222222 } }), cfg), no(200, "not_owner"), "다른 사람 → held 아님");
  assertEquals(checkTelegramCallback(SECRET, cq({ data: heldData, ...msg({ id: OWNER, type: "group" }) }), cfg), no(200, "not_owner"), "그룹 → held 아님");
  assertEquals(checkTelegramCallback(SECRET, cq({ data: heldData, id: "" }), cfg), no(200, "malformed"), "필드 불량 → held 아님");
  // 열린 버튼과 보류 버튼의 거절 사유가 인증 안 된 요청에서는 서로 같다
  for (const header of [null, "wrong"]) {
    assertEquals(
      checkTelegramCallback(header, cq({ data: heldData }), cfg),
      checkTelegramCallback(header, cq({ data: `send_guide:${UUID}` }), cfg),
      `헤더 ${header}: 보류 버튼과 열린 버튼의 결과가 같다`,
    );
  }
});

Deno.test("G08 판정 순서: 앞 단계의 사유가 먼저 나온다", () => {
  const everythingWrong = { id: 1, from: { id: 222222222 }, data: "x" };
  const partial = { ...OPEN, openActions: "send_guide" };
  assertEquals(checkTelegramCallback("wrong", everythingWrong, { ...partial, openActions: "" }), no(200, "closed"), "1 닫힘");
  assertEquals(checkTelegramCallback("wrong", everythingWrong, { ...partial, openActions: "nope" }), no(200, "config_invalid"), "2 설정(목록)");
  assertEquals(checkTelegramCallback("wrong", everythingWrong, { ...partial, webhookSecret: "" }), no(200, "config_invalid"), "2 설정(헤더 값)");
  assertEquals(checkTelegramCallback("wrong", everythingWrong, partial), no(401, "bad_secret"), "3 헤더");
  assertEquals(checkTelegramCallback(SECRET, everythingWrong, partial), no(200, "malformed"), "4 필드");
  assertEquals(checkTelegramCallback(SECRET, cq({ from: { id: 222222222 }, data: "x" }), partial), no(200, "not_owner"), "5 대표");
  assertEquals(checkTelegramCallback(SECRET, cq({ data: "x" }), partial), no(200, "bad_data"), "6 data");
  assertEquals(checkTelegramCallback(SECRET, cq(), partial), no(200, "held"), "7 보류");
  assertEquals(checkTelegramCallback(SECRET, cq({ data: `send_guide:${UUID}` }), partial), PASS, "8 통과");
});

Deno.test("G09 판정은 받은 값을 바꾸지 않는다", () => {
  const value = cq();
  const cfg = { ...OPEN };
  const before = JSON.stringify([value, cfg]);
  checkTelegramCallback(SECRET, value, cfg);
  assertEquals(JSON.stringify([value, cfg]), before, "입력 그대로");
});
