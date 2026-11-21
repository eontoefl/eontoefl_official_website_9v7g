// ===== 텔레그램 버튼 콜백 입구 판정 =====
// 역할: 텔레그램 버튼 콜백을 처리부(handleCallback)에 넘기기 전에,
//       "텔레그램이 보낸 것인가 / 대표가 누른 것인가 / 우리가 만든 버튼인가 / 지금 열어 둔 버튼인가"를 확인한다.
// 순수 모듈: Deno API·환경값·네트워크·DB를 쓰지 않는다. 받은 값만 보고 판정한다.

// 버튼으로 처리하는 동작 이름. index.ts의 handleCallback 분기와 같은 여섯 개.
export const CALLBACK_ACTIONS = [
  "confirm_deposit",
  "send_guide",
  "resume_approve",
  "resume_hold",
  "retry_correction",
  "confirm_extension",
] as const;

// 설정은 환경값의 문자열 그대로 받는다. 형식 확인과 해석은 여기서 한다.
export type CallbackGuardConfig = {
  // 처리할 동작 이름을 쉼표로 구분한 허용 목록(이름 앞뒤 공백은 무시).
  // 없거나 비면 전부 닫힘. CALLBACK_ACTIONS에 없는 이름이 하나라도 있으면 설정 불량으로 전부 닫힘.
  openActions: string;
  // 웹훅 등록 때 정한 헤더 값(x-telegram-bot-api-secret-token).
  webhookSecret: string;
  // 버튼을 누를 수 있는 사람(대표)의 텔레그램 사용자 번호. 0으로 시작하지 않는 10진 숫자 글자만.
  ownerUserId: string;
  // 알림이 가는 채팅방 번호. 0으로 시작하지 않는 10진 숫자 글자만(대표와의 1:1 채팅).
  chatId: string;
};

export type CallbackGuardReason =
  | "closed"
  | "config_invalid"
  | "bad_secret"
  | "malformed"
  | "not_owner"
  | "bad_data"
  | "held";

export type CallbackGuardResult =
  | { ok: true }
  | { ok: false; status: 200 | 401; reason: CallbackGuardReason };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_SETTING_PATTERN = /^[1-9][0-9]*$/;

function reject(status: 200 | 401, reason: CallbackGuardReason): CallbackGuardResult {
  return { ok: false, status, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

// 번호 설정: 원래 글자가 "1~9로 시작하는 숫자만"이고 안전한 정수 범위일 때만 숫자로 읽는다.
// ("1e3", " 123 ", "0123", "-5" 같은 값을 다른 번호로 읽지 않는다.)
function parseIdSetting(raw: unknown): number | null {
  if (typeof raw !== "string" || !ID_SETTING_PATTERN.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

// 허용 목록 해석. 빈 칸(쉼표 사이에 이름이 없는 곳)은 이름으로 세지 않는다.
type OpenList =
  | { state: "closed" }
  | { state: "invalid" }
  | { state: "ok"; open: ReadonlySet<string> };

function parseOpenActions(raw: unknown): OpenList {
  if (typeof raw !== "string") return { state: "closed" };
  const names = raw.split(",").map((name) => name.trim()).filter((name) => name !== "");
  if (names.length === 0) return { state: "closed" };
  const known = CALLBACK_ACTIONS as readonly string[];
  if (names.some((name) => !known.includes(name))) return { state: "invalid" };
  return { state: "ok", open: new Set(names) };
}

// 헤더 값 비교. 길이가 다르면 바로 거절하고, 같으면 중간에 멈추지 않고 끝까지 비교한다.
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// data가 "여섯 동작 중 하나:UUID" 모양이면 동작 이름을, 아니면 null을 돌려준다.
// 동작 이름은 글자 그대로(대소문자 구분), UUID는 대소문자를 가리지 않는다.
function knownCallbackAction(data: string): string | null {
  const sep = data.indexOf(":");
  if (sep < 0) return null;
  const action = data.slice(0, sep);
  const target = data.slice(sep + 1);
  if (!(CALLBACK_ACTIONS as readonly string[]).includes(action)) return null;
  return UUID_PATTERN.test(target) ? action : null;
}

export function checkTelegramCallback(
  headerSecret: string | null | undefined,
  callbackQuery: unknown,
  cfg: CallbackGuardConfig,
): CallbackGuardResult {
  // 1. 허용 목록이 없거나 비었으면: 헤더와 무관하게 모든 버튼을 받지 않는다.
  const openList = parseOpenActions(cfg.openActions);
  if (openList.state === "closed") return reject(200, "closed");

  // 2. 설정이 잘못됐으면 아무도 통과시키지 않는다.
  //    (허용 목록에 모르는 이름, 헤더 값 없음, 대표 번호·채팅 번호의 형식이 틀림)
  const ownerUserId = parseIdSetting(cfg.ownerUserId);
  const chatId = parseIdSetting(cfg.chatId);
  if (
    openList.state === "invalid" ||
    typeof cfg.webhookSecret !== "string" || cfg.webhookSecret === "" ||
    ownerUserId === null ||
    chatId === null
  ) {
    return reject(200, "config_invalid");
  }

  // 3. 텔레그램이 보낸 요청인지: 웹훅 헤더 값이 없거나 다르면 거절.
  if (typeof headerSecret !== "string" || !sameSecret(headerSecret, cfg.webhookSecret)) {
    return reject(401, "bad_secret");
  }

  // 4. 처리부가 꺼내 쓰는 필드가 있고 형과 범위가 맞는지.
  //    message.from은 요구하지 않는다(접근 불가 메시지 InaccessibleMessage에는 없다).
  if (!isRecord(callbackQuery)) return reject(200, "malformed");
  const from = callbackQuery.from;
  const message = callbackQuery.message;
  if (!isRecord(from) || !isRecord(message)) return reject(200, "malformed");
  const chat = message.chat;
  if (!isRecord(chat)) return reject(200, "malformed");
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data;
  const messageId = message.message_id;
  if (
    typeof callbackId !== "string" || callbackId.trim().length < 1 ||
    typeof data !== "string" ||
    !isSafeInt(from.id) ||
    !isSafeInt(chat.id) ||
    typeof chat.type !== "string" ||
    !isSafeInt(messageId) || messageId <= 0
  ) {
    return reject(200, "malformed");
  }

  // 5. 대표가, 알림 채팅방(1:1)에서 누른 것인지. 세 가지를 각각 비교한다.
  if (
    from.id !== ownerUserId ||
    chat.id !== chatId ||
    chat.type !== "private"
  ) {
    return reject(200, "not_owner");
  }

  // 6. 우리가 만든 버튼의 모양인지: 여섯 동작 중 하나 + UUID.
  const action = knownCallbackAction(data);
  if (action === null) return reject(200, "bad_data");

  // 7. 지금 열어 둔 버튼인지. 여기까지 온 요청(헤더·대표 확인 통과)에만 보류를 알린다.
  if (!openList.open.has(action)) return reject(200, "held");

  // 8. 통과
  return { ok: true };
}
