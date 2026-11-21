// ===== 텔레그램 버튼 콜백 입구 판정 =====
// 역할: 텔레그램 버튼 콜백을 처리부(handleCallback)에 넘기기 전에,
//       "텔레그램이 보낸 것인가 / 대표가 누른 것인가 / 우리가 만든 버튼인가"를 확인한다.
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

export type CallbackGuardConfig = {
  // "open"일 때만 버튼을 처리한다. 그 밖의 값(없음 포함)은 전부 닫힘.
  mode: string;
  // 웹훅 등록 때 정한 헤더 값(x-telegram-bot-api-secret-token).
  webhookSecret: string;
  // 버튼을 누를 수 있는 사람(대표)의 텔레그램 사용자 번호.
  ownerUserId: number;
  // 알림이 가는 채팅방 번호(문자열).
  chatId: string;
};

export type CallbackGuardReason =
  | "closed"
  | "config_invalid"
  | "bad_secret"
  | "malformed"
  | "not_owner"
  | "bad_data";

export type CallbackGuardResult =
  | { ok: true }
  | { ok: false; status: 200 | 401; reason: CallbackGuardReason };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reject(status: 200 | 401, reason: CallbackGuardReason): CallbackGuardResult {
  return { ok: false, status, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

// data가 "여섯 동작 중 하나:UUID" 모양인지 확인한다.
// 동작 이름은 글자 그대로(대소문자 구분), UUID는 대소문자를 가리지 않는다.
function isKnownCallbackData(data: string): boolean {
  const sep = data.indexOf(":");
  if (sep < 0) return false;
  const action = data.slice(0, sep);
  const target = data.slice(sep + 1);
  return (CALLBACK_ACTIONS as readonly string[]).includes(action) && UUID_PATTERN.test(target);
}

export function checkTelegramCallback(
  headerSecret: string | null | undefined,
  callbackQuery: unknown,
  cfg: CallbackGuardConfig,
): CallbackGuardResult {
  // 1. 닫힘 모드: 헤더와 무관하게 모든 버튼을 받지 않는다.
  if (cfg.mode !== "open") return reject(200, "closed");

  // 2. 설정이 빠졌거나 잘못됐으면 아무도 통과시키지 않는다.
  if (
    typeof cfg.webhookSecret !== "string" || cfg.webhookSecret === "" ||
    typeof cfg.ownerUserId !== "number" || !Number.isSafeInteger(cfg.ownerUserId) || cfg.ownerUserId <= 0 ||
    typeof cfg.chatId !== "string" || cfg.chatId === ""
  ) {
    return reject(200, "config_invalid");
  }

  // 3. 텔레그램이 보낸 요청인지: 웹훅 헤더 값이 없거나 다르면 거절.
  if (typeof headerSecret !== "string" || !sameSecret(headerSecret, cfg.webhookSecret)) {
    return reject(401, "bad_secret");
  }

  // 4. 처리부가 꺼내 쓰는 필드가 있고 형이 맞는지.
  //    message.from은 요구하지 않는다(접근 불가 메시지 InaccessibleMessage에는 없다).
  if (!isRecord(callbackQuery)) return reject(200, "malformed");
  const from = callbackQuery.from;
  const message = callbackQuery.message;
  if (!isRecord(from) || !isRecord(message)) return reject(200, "malformed");
  const chat = message.chat;
  if (!isRecord(chat)) return reject(200, "malformed");
  if (
    typeof callbackQuery.id !== "string" ||
    typeof callbackQuery.data !== "string" ||
    typeof from.id !== "number" ||
    typeof chat.id !== "number" ||
    typeof chat.type !== "string" ||
    typeof message.message_id !== "number"
  ) {
    return reject(200, "malformed");
  }

  // 5. 대표가, 알림 채팅방(1:1)에서 누른 것인지. 세 가지를 각각 비교한다.
  if (
    from.id !== cfg.ownerUserId ||
    String(chat.id) !== cfg.chatId ||
    chat.type !== "private"
  ) {
    return reject(200, "not_owner");
  }

  // 6. 우리가 만든 버튼의 모양인지: 여섯 동작 중 하나 + UUID.
  if (!isKnownCallbackData(callbackQuery.data)) return reject(200, "bad_data");

  // 7. 통과
  return { ok: true };
}
