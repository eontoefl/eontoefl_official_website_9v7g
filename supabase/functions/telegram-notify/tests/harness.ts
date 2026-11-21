// ===== 격리 시험 도구 =====
// 네트워크 0, 운영 값 0. 여기 나오는 주소·열쇠·번호·이름은 전부 가짜다.
// - Deno.serve를 가짜로 바꿔 index.ts의 입구 함수를 받아 둔다.
// - globalThis.fetch를 가짜로 바꿔 모든 바깥 호출을 기록하고 가짜 응답을 돌려준다.
// - 가짜가 모르는 주소로 나가는 호출이 있으면 기록해 두었다가 시험을 실패시킨다.

// deno-lint-ignore-file no-explicit-any

export type Row = Record<string, unknown>;

export type Call = {
  kind: string; // 예: "telegram:sendMessage", "db-read:applications", "db-write:applications", "rpc:service_stop_at", "kakao:payment_confirmed", "n8n"
  method: string;
  url: string; // 가짜 열쇠 부분은 가림
  headers: Record<string, string>; // 열쇠가 들어가는 값은 가림
  body: unknown;
  rowsChanged?: number; // DB 쓰기일 때 실제로 바뀐 행 수
};

export type Captured = {
  status: number;
  bodyText: string;
  calls: Call[];
  logs: Array<{ level: "log" | "warn" | "error"; args: unknown[] }>;
};

export type Handler = (req: Request) => Response | Promise<Response>;

// ----- 가짜 값 (운영 값 아님) -----
export const FAKE = {
  supabaseUrl: "https://fake-project.supabase.invalid",
  serviceKey: "fake-service-role-key",
  botToken: "000000000:FAKE_BOT_TOKEN_FOR_TEST",
  chatId: "111111111",
  ownerUserId: 111111111,
  otherUserId: 222222222,
  groupChatId: -1000000000001,
  webhookSecret: "fake-webhook-secret-0001",
  entryUrl: "https://fake-entry.invalid/functions/v1/telegram-notify",
  appId: "00000000-0000-4000-8000-0000000000a1",
  subId: "00000000-0000-4000-8000-0000000000b1",
  extReqId: "00000000-0000-4000-8000-0000000000c1",
  userId: "00000000-0000-4000-8000-0000000000d1",
  missingId: "00000000-0000-4000-8000-00000000ffff",
};

// 시험 중 "지금"으로 쓰는 고정 시각: 2026-11-18 12:00 KST (수요일)
const RealDate = Date;
export const FIXED_MS = RealDate.UTC(2026, 10, 18, 3, 0, 0);
class FakeDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(FIXED_MS);
    else super(...(args as [any]));
  }
  static override now(): number {
    return FIXED_MS;
  }
}

const ENV_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_WEBHOOK_SECRET",
  "CS_TELEGRAM_OWNER_USER_ID",
  "TELEGRAM_CALLBACK_MODE",
];

export function baseEnv(mode: string | undefined): Record<string, string | undefined> {
  return {
    TELEGRAM_BOT_TOKEN: FAKE.botToken,
    TELEGRAM_CHAT_ID: FAKE.chatId,
    SUPABASE_URL: FAKE.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: FAKE.serviceKey,
    TELEGRAM_WEBHOOK_SECRET: FAKE.webhookSecret,
    CS_TELEGRAM_OWNER_USER_ID: String(FAKE.ownerUserId),
    TELEGRAM_CALLBACK_MODE: mode,
  };
}

// ----- 가짜 바깥 세계 (DB·텔레그램·알림톡·n8n) -----
export class World {
  calls: Call[] = [];
  unhandled: string[] = [];
  tables: Record<string, Row[]> = {
    applications: [],
    correction_submissions: [],
    users: [],
    correction_extension_requests: [],
    correction_schedules: [],
    toefl_survey_responses: [],
  };
  alertKeys = new Set<string>();
  telegramMessageSeq = 9000;

  seed(table: string, row: Row): this {
    this.tables[table].push(structuredClone(row));
    return this;
  }
}

// 시험마다 같은 출발 상태를 만든다(전부 가짜 자료).
export function seededWorld(): World {
  const w = new World();
  w.seed("applications", {
    id: FAKE.appId,
    name: "시험학생",
    phone: "010-0000-0000",
    email: "student@example.invalid",
    depositor_name: "시험입금자",
    deposit_confirmed_by_admin: false,
    guide_sent: false,
    current_step: 4,
    self_paced: false,
    schedule_start: "2026-11-08",
    schedule_end: "2026-12-05",
    correction_start_date: "2026-11-08",
    correction_enabled: true,
    assigned_program: "시험 프로그램",
    final_price: 100000,
    resume_requested_at: "2026-11-17T01:00:00+00:00",
    resume_stage: "동의",
    resume_request_note: "시험 메모",
  });
  w.seed("correction_submissions", {
    id: FAKE.subId,
    user_id: FAKE.userId,
    status: "feedback1_failed",
    task_type: "writing_email",
    task_number: 1,
    session_number: 3,
    auto_retry_count: 2,
    retry_failed_notified: true,
  });
  w.seed("users", { id: FAKE.userId, name: "시험학생", email: "student@example.invalid" });
  w.seed("correction_extension_requests", {
    id: FAKE.extReqId,
    user_id: FAKE.userId,
    application_id: FAKE.appId,
    status: "pending",
  });
  w.seed("toefl_survey_responses", { user_id: FAKE.userId, user_name: "시험학생", exam_date: "2026-11-01", gifty_sent_at: null });
  w.seed("toefl_survey_responses", { user_id: "u2", user_name: "시험학생2", exam_date: "2026-11-02", gifty_sent_at: "2026-11-03T00:00:00+00:00" });
  return w;
}

let currentWorld: World | null = null;

function maskUrl(url: string): string {
  return url.replace(/\/bot[^/]+\//, "/bot<가림>/");
}

function recordHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    out[k] = k === "apikey" || k === "authorization" ? (v ? "<가림>" : "") : v;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function matchRows(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "limit" || key === "on_conflict") continue;
    if (!value.startsWith("eq.")) throw new Error(`가짜 DB가 모르는 조건: ${key}=${value}`);
    const want = value.slice(3);
    out = out.filter((r) => String(r[key]) === want);
  }
  return out;
}

function project(rows: Row[], select: string | null): Row[] {
  if (!select || select === "*") return rows.map((r) => structuredClone(r));
  const cols = select.split(",");
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const world = currentWorld;
  const req = input instanceof Request ? input : new Request(String(input), init);
  const method = req.method.toUpperCase();
  const rawUrl = req.url;
  if (!world) throw new Error(`시험 밖에서 fetch가 불렸다: ${method} ${maskUrl(rawUrl)}`);
  const url = new URL(rawUrl);
  const text = method === "GET" || method === "HEAD" ? "" : await req.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_e) {
      body = text;
    }
  }
  const call: Call = { kind: "?", method, url: maskUrl(rawUrl), headers: recordHeaders(req.headers), body };
  const origin = url.origin;

  // --- 텔레그램 API ---
  if (origin === "https://api.telegram.org") {
    const m = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
    if (m && m[1] === FAKE.botToken && method === "POST") {
      const tgMethod = m[2];
      if (tgMethod === "sendMessage") {
        call.kind = "telegram:sendMessage";
        world.calls.push(call);
        const b = body as Row;
        return jsonResponse({ ok: true, result: { message_id: ++world.telegramMessageSeq, chat: { id: Number(b.chat_id), type: "private" }, date: 0, text: b.text } });
      }
      if (tgMethod === "editMessageText") {
        call.kind = "telegram:editMessageText";
        world.calls.push(call);
        return jsonResponse({ ok: true, result: { message_id: (body as Row).message_id } });
      }
      if (tgMethod === "answerCallbackQuery") {
        call.kind = "telegram:answerCallbackQuery";
        world.calls.push(call);
        return jsonResponse({ ok: true, result: true });
      }
    }
  }

  // --- 가짜 Supabase ---
  if (origin === FAKE.supabaseUrl) {
    // 알림톡 함수
    if (url.pathname === "/functions/v1/kakaotalk-notify" && method === "POST") {
      call.kind = `kakao:${String((body as Row)?.type ?? "?")}`;
      world.calls.push(call);
      return jsonResponse({ success: true });
    }
    // RPC
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc && method === "POST") {
      const name = rpc[1];
      const args = (body ?? {}) as Row;
      if (name === "followup_claim_alert") {
        call.kind = `rpc:${name}`;
        world.calls.push(call);
        const key = String(args.p_alert_key);
        if (world.alertKeys.has(key)) return jsonResponse({ claimed: false, status: "sent" });
        world.alertKeys.add(key);
        return jsonResponse({ claimed: true, status: "claimed" });
      }
      if (name === "followup_finish_alert") {
        call.kind = `rpc:${name}`;
        world.calls.push(call);
        return jsonResponse(true);
      }
      if (name === "service_stop_at") {
        call.kind = `rpc:${name}`;
        world.calls.push(call);
        return jsonResponse(null);
      }
    }
    // REST 표
    const rest = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (rest && rest[1] in world.tables) {
      const table = rest[1];
      const rows = world.tables[table];
      const params = url.searchParams;
      const prefer = req.headers.get("prefer") || "";
      if (method === "GET") {
        call.kind = `db-read:${table}`;
        world.calls.push(call);
        let found = matchRows(rows, params);
        const limit = params.get("limit");
        if (limit) found = found.slice(0, Number(limit));
        return jsonResponse(project(found, params.get("select")));
      }
      if (method === "PATCH") {
        const found = matchRows(rows, params);
        for (const r of found) Object.assign(r, structuredClone(body as Row));
        call.kind = `db-write:${table}`;
        call.rowsChanged = found.length;
        world.calls.push(call);
        if (prefer.includes("return=representation")) return jsonResponse(found.map((r) => structuredClone(r)));
        return new Response(null, { status: 204 });
      }
      if (method === "POST" && params.get("on_conflict")) {
        const keyCol = params.get("on_conflict")!;
        const b = body as Row;
        const existing = rows.find((r) => String(r[keyCol]) === String(b[keyCol]));
        if (existing) Object.assign(existing, structuredClone(b));
        else rows.push(structuredClone(b));
        call.kind = `db-write:${table}`;
        call.rowsChanged = 1;
        world.calls.push(call);
        return new Response(null, { status: 201 });
      }
    }
  }

  // --- n8n 첨삭 재실행 웹훅 ---
  if (origin === "https://eontoefl.app.n8n.cloud" && /^\/webhook\/correction-[a-z0-9-]+$/.test(url.pathname) && method === "POST") {
    call.kind = "n8n";
    world.calls.push(call);
    return jsonResponse({ ok: true });
  }

  // --- 모르는 주소: 기록하고 실패시킨다 ---
  world.unhandled.push(`${method} ${maskUrl(rawUrl)}`);
  throw new TypeError(`가짜가 받지 못한 바깥 호출: ${method} ${maskUrl(rawUrl)}`);
}

const realFetch = globalThis.fetch;
(globalThis as any).fetch = fakeFetch;
export function fetchIsFaked(): boolean {
  return globalThis.fetch === (fakeFetch as unknown) && globalThis.fetch !== realFetch;
}

// ----- index.ts를 불러와 입구 함수를 받는다 -----
let loadSeq = 0;
export async function loadEntry(
  variant: "patched" | "v26",
  env: Record<string, string | undefined>,
): Promise<Handler> {
  for (const key of ENV_KEYS) Deno.env.delete(key);
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) Deno.env.set(key, value);
  }
  const realServe = Deno.serve;
  let captured: Handler | null = null;
  (Deno as any).serve = (handler: Handler) => {
    captured = handler;
    return {};
  };
  try {
    const rel = variant === "patched" ? "../index.ts" : "./v26_original/index.ts";
    // 물음표 뒤 값이 다르면 새 모듈로 불러와서, 환경값을 다시 읽게 된다.
    await import(new URL(`${rel}?load=${++loadSeq}`, import.meta.url).href);
  } finally {
    (Deno as any).serve = realServe;
  }
  if (!captured) throw new Error("입구 함수를 받지 못했다(Deno.serve가 불리지 않음)");
  return captured;
}

// ----- 요청 만들기 -----
export function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(FAKE.entryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function callbackUpdate(data: string, overrides: Row = {}): Row {
  return {
    update_id: 500001,
    callback_query: {
      id: "cbq-0001",
      from: { id: FAKE.ownerUserId, is_bot: false, first_name: "시험대표" },
      message: {
        message_id: 7001,
        from: { id: 333333333, is_bot: true, first_name: "시험봇" },
        chat: { id: Number(FAKE.chatId), type: "private", first_name: "시험대표" },
        date: 1790000000,
        text: "시험 알림",
      },
      chat_instance: "ci-0001",
      data,
      ...overrides,
    },
  };
}

export const SECRET_HEADER = { "x-telegram-bot-api-secret-token": FAKE.webhookSecret };

// ----- 입구 함수 부르기 (바깥 호출·로그를 붙잡는다) -----
export async function invoke(handler: Handler, world: World, req: Request): Promise<Captured> {
  const startIndex = world.calls.length;
  const logs: Captured["logs"] = [];
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  const realRandomUUID = crypto.randomUUID;
  let uuidSeq = 0;
  currentWorld = world;
  (globalThis as any).Date = FakeDate;
  (crypto as any).randomUUID = () => `11111111-1111-4111-8111-${String(++uuidSeq).padStart(12, "0")}`;
  console.log = (...args: unknown[]) => void logs.push({ level: "log", args });
  console.warn = (...args: unknown[]) => void logs.push({ level: "warn", args });
  console.error = (...args: unknown[]) => void logs.push({ level: "error", args });
  let resp: Response;
  try {
    resp = await handler(req);
  } finally {
    console.log = realConsole.log;
    console.warn = realConsole.warn;
    console.error = realConsole.error;
    (crypto as any).randomUUID = realRandomUUID;
    (globalThis as any).Date = RealDate;
    currentWorld = null;
  }
  const bodyText = await resp.text();
  if (world.unhandled.length > 0) {
    throw new Error(`가짜가 받지 못한 바깥 호출이 있었다: ${world.unhandled.join(" | ")}`);
  }
  return { status: resp.status, bodyText, calls: world.calls.slice(startIndex), logs };
}

// ----- 작은 확인 도구 (바깥 라이브러리를 받지 않기 위해 직접 둔다) -----
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`확인 실패: ${msg}`);
}

export function assertEquals(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual, null, 1);
  const e = JSON.stringify(expected, null, 1);
  if (a !== e) throw new Error(`확인 실패: ${msg}\n  실제: ${a}\n  기대: ${e}`);
}

export function kinds(calls: Call[]): string[] {
  return calls.map((c) => c.kind);
}

// 비교용 호출 기록(주소에서 가짜 열쇠 가림, 메서드, 헤더, 본문)
export function comparable(calls: Call[]): unknown[] {
  return calls.map((c) => ({ kind: c.kind, method: c.method, url: c.url, headers: c.headers, body: c.body }));
}

export function rejectedReasons(cap: Captured): unknown[][] {
  return cap.logs.filter((l) => l.level === "warn").map((l) => l.args);
}
