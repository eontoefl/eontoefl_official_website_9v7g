// ===== 격리 시험 도구 =====
// 네트워크 0, 운영 값 0. 여기 나오는 주소·열쇠·번호·이름은 전부 가짜다.
// - Deno.serve를 가짜로 바꿔 index.ts의 입구 함수를 받아 둔다.
// - globalThis.fetch를 가짜로 바꿔 모든 바깥 호출을 기록하고 가짜 응답을 돌려준다.
// - 가짜가 모르는 주소로 나가는 호출이 있으면 기록해 두었다가 시험을 실패시킨다.
// - 가짜 수신기는 인증 값(서비스 키 헤더, 봇 열쇠가 든 주소)이 예정된 가짜 값과 같은지 검사한다.
// - 두 요청을 실제로 겹치게 하는 문(게이트)을 둘 수 있다(invokeOverlapped).

// deno-lint-ignore-file no-explicit-any

export type Row = Record<string, unknown>;

export type Call = {
  kind: string; // 예: "telegram:sendMessage", "db-read:applications", "db-write:applications", "rpc:service_stop_at", "kakao:payment_confirmed", "n8n"
  method: string;
  url: string; // 가짜 열쇠 부분은 가림
  headers: Record<string, string>; // 열쇠가 들어가는 값은 가림
  body: unknown;
  rowsChanged?: number; // DB 쓰기일 때 실제로 바뀐 행 수
  result?: unknown; // DB 조회일 때 돌려준 행
  authOk: boolean; // 인증 값이 예정된 가짜 값과 같았는가(n8n은 인증 값이 없어 항상 true)
  by?: string; // 겹침 측정에서 어느 요청의 호출인가("A" | "B")
};

export type LogLine = { level: "log" | "warn" | "error"; args: unknown[]; by?: string };

export type Captured = {
  status: number;
  bodyText: string;
  calls: Call[];
  logs: LogLine[];
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

export const ALL_ACTIONS = [
  "confirm_deposit",
  "send_guide",
  "resume_approve",
  "resume_hold",
  "retry_correction",
  "confirm_extension",
] as const;
export const ALL_OPEN = ALL_ACTIONS.join(",");

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
  "TELEGRAM_CALLBACK_OPEN",
  "TELEGRAM_CALLBACK_MODE", // 1차의 환경값. 이제 읽지 않는다는 것을 시험하려고 지우기 목록에 둔다.
];

// open: 허용 목록(TELEGRAM_CALLBACK_OPEN). undefined면 환경값 없음.
export function baseEnv(open: string | undefined): Record<string, string | undefined> {
  return {
    TELEGRAM_BOT_TOKEN: FAKE.botToken,
    TELEGRAM_CHAT_ID: FAKE.chatId,
    SUPABASE_URL: FAKE.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: FAKE.serviceKey,
    TELEGRAM_WEBHOOK_SECRET: FAKE.webhookSecret,
    CS_TELEGRAM_OWNER_USER_ID: String(FAKE.ownerUserId),
    TELEGRAM_CALLBACK_OPEN: open,
  };
}

// ----- 가짜 바깥 세계 (DB·텔레그램·알림톡·n8n) -----
export class World {
  calls: Call[] = [];
  unhandled: string[] = [];
  authFailures: string[] = [];
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
let currentOverlap: Overlap | null = null;

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

// 호출 하나를 "무슨 호출인지(kind)"와 "실행(run)"으로 나눈다.
// 겹침 측정에서는 kind를 보고 문 앞에 세운 뒤, 차례가 오면 run을 실행한다.
type Route = { kind: string; needsSupabaseAuth?: boolean; run: (call: Call) => Response };

function resolveRoute(world: World, method: string, url: URL, reqHeaders: Headers, body: unknown): Route | null {
  const origin = url.origin;

  // --- 텔레그램 API (봇 열쇠 검사는 fakeFetch에서) ---
  if (origin === "https://api.telegram.org") {
    const m = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
    if (m && method === "POST") {
      const tgMethod = m[2];
      if (tgMethod === "sendMessage") {
        return {
          kind: "telegram:sendMessage",
          run: () => {
            const b = body as Row;
            return jsonResponse({ ok: true, result: { message_id: ++world.telegramMessageSeq, chat: { id: Number(b.chat_id), type: "private" }, date: 0, text: b.text } });
          },
        };
      }
      if (tgMethod === "editMessageText") {
        return { kind: "telegram:editMessageText", run: () => jsonResponse({ ok: true, result: { message_id: (body as Row).message_id } }) };
      }
      if (tgMethod === "answerCallbackQuery") {
        return { kind: "telegram:answerCallbackQuery", run: () => jsonResponse({ ok: true, result: true }) };
      }
    }
    return null;
  }

  // --- 가짜 Supabase ---
  if (origin === FAKE.supabaseUrl) {
    // 알림톡 함수
    if (url.pathname === "/functions/v1/kakaotalk-notify" && method === "POST") {
      return { kind: `kakao:${String((body as Row)?.type ?? "?")}`, needsSupabaseAuth: true, run: () => jsonResponse({ success: true }) };
    }
    // RPC
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc && method === "POST") {
      const name = rpc[1];
      const args = (body ?? {}) as Row;
      if (name === "followup_claim_alert") {
        return {
          kind: `rpc:${name}`,
          needsSupabaseAuth: true,
          run: () => {
            const key = String(args.p_alert_key);
            if (world.alertKeys.has(key)) return jsonResponse({ claimed: false, status: "sent" });
            world.alertKeys.add(key);
            return jsonResponse({ claimed: true, status: "claimed" });
          },
        };
      }
      if (name === "followup_finish_alert") return { kind: `rpc:${name}`, needsSupabaseAuth: true, run: () => jsonResponse(true) };
      if (name === "service_stop_at") return { kind: `rpc:${name}`, needsSupabaseAuth: true, run: () => jsonResponse(null) };
      return null;
    }
    // REST 표
    const rest = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (rest && rest[1] in world.tables) {
      const table = rest[1];
      const rows = world.tables[table];
      const params = url.searchParams;
      const prefer = reqHeaders.get("prefer") || "";
      if (method === "GET") {
        return {
          kind: `db-read:${table}`,
          needsSupabaseAuth: true,
          run: (call) => {
            let found = matchRows(rows, params);
            const limit = params.get("limit");
            if (limit) found = found.slice(0, Number(limit));
            const out = project(found, params.get("select"));
            call.result = structuredClone(out);
            return jsonResponse(out);
          },
        };
      }
      if (method === "PATCH") {
        return {
          kind: `db-write:${table}`,
          needsSupabaseAuth: true,
          run: (call) => {
            const found = matchRows(rows, params);
            for (const r of found) Object.assign(r, structuredClone(body as Row));
            call.rowsChanged = found.length;
            if (prefer.includes("return=representation")) return jsonResponse(found.map((r) => structuredClone(r)));
            return new Response(null, { status: 204 });
          },
        };
      }
      if (method === "POST" && params.get("on_conflict")) {
        return {
          kind: `db-write:${table}`,
          needsSupabaseAuth: true,
          run: (call) => {
            const keyCol = params.get("on_conflict")!;
            const b = body as Row;
            const existing = rows.find((r) => String(r[keyCol]) === String(b[keyCol]));
            if (existing) Object.assign(existing, structuredClone(b));
            else rows.push(structuredClone(b));
            call.rowsChanged = 1;
            return new Response(null, { status: 201 });
          },
        };
      }
    }
    return null;
  }

  // --- n8n 첨삭 재실행 웹훅 (인증 값 없음) ---
  if (origin === "https://eontoefl.app.n8n.cloud" && /^\/webhook\/correction-[a-z0-9-]+$/.test(url.pathname) && method === "POST") {
    return { kind: "n8n", run: () => jsonResponse({ ok: true }) };
  }
  return null;
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const world = currentWorld;
  const req = input instanceof Request ? input : new Request(String(input), init);
  const method = req.method.toUpperCase();
  const rawUrl = req.url;
  if (!world) throw new Error(`시험 밖에서 fetch가 불렸다: ${method} ${maskUrl(rawUrl)}`);
  const url = new URL(rawUrl);
  // 겹침 측정에서는 본문을 읽는 동안에도 "지금 움직이는 요청"이 바뀌지 않는다(한 번에 한 요청만 움직인다).
  const text = method === "GET" || method === "HEAD" ? "" : await req.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_e) {
      body = text;
    }
  }

  const route = resolveRoute(world, method, url, req.headers, body);
  if (!route) {
    // 모르는 주소: 기록하고 실패시킨다.
    world.unhandled.push(`${method} ${maskUrl(rawUrl)}`);
    throw new TypeError(`가짜가 받지 못한 바깥 호출: ${method} ${maskUrl(rawUrl)}`);
  }

  // 겹침 측정 중이면 여기서 차례를 기다린다.
  const overlap = currentOverlap;
  const by = overlap ? await overlap.gate(route.kind) : undefined;

  const call: Call = { kind: route.kind, method, url: maskUrl(rawUrl), headers: recordHeaders(req.headers), body, authOk: true };
  if (by) call.by = by;

  // --- 인증 값 검사(값을 가린 비교와 별개): 예정된 가짜 값과 글자까지 같아야 한다 ---
  if (route.kind.startsWith("telegram:")) {
    const token = url.pathname.match(/^\/bot([^/]+)\//)![1];
    call.authOk = decodeURIComponent(token) === FAKE.botToken;
  } else if (route.needsSupabaseAuth) {
    call.authOk = req.headers.get("apikey") === FAKE.serviceKey &&
      req.headers.get("authorization") === `Bearer ${FAKE.serviceKey}`;
  }
  if (!call.authOk) {
    // 실제 수신처처럼 401로 답하고, 업무(가짜 DB 변화·발송)는 일어나지 않는다.
    world.calls.push(call);
    world.authFailures.push(`${route.kind} ${method} ${maskUrl(rawUrl)}`);
    return route.kind.startsWith("telegram:")
      ? jsonResponse({ ok: false, error_code: 401, description: "Unauthorized" }, 401)
      : jsonResponse({ message: "Invalid API key" }, 401);
  }

  const resp = route.run(call);
  world.calls.push(call);
  return resp;
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

// ----- 시험 중 전역(시각·무작위·로그)을 바꿔 끼우고 되돌린다 -----
function installGlobals(sink: (line: LogLine) => void): () => void {
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  const realRandomUUID = crypto.randomUUID;
  let uuidSeq = 0;
  (globalThis as any).Date = FakeDate;
  (crypto as any).randomUUID = () => `11111111-1111-4111-8111-${String(++uuidSeq).padStart(12, "0")}`;
  console.log = (...args: unknown[]) => sink({ level: "log", args });
  console.warn = (...args: unknown[]) => sink({ level: "warn", args });
  console.error = (...args: unknown[]) => sink({ level: "error", args });
  return () => {
    console.log = realConsole.log;
    console.warn = realConsole.warn;
    console.error = realConsole.error;
    (crypto as any).randomUUID = realRandomUUID;
    (globalThis as any).Date = RealDate;
  };
}

function failOnBadCalls(world: World, allowAuthFailures: boolean) {
  if (world.unhandled.length > 0) {
    throw new Error(`가짜가 받지 못한 바깥 호출이 있었다: ${world.unhandled.join(" | ")}`);
  }
  if (!allowAuthFailures && world.authFailures.length > 0) {
    throw new Error(`인증 값이 예정된 가짜 값과 다른 바깥 호출이 있었다: ${world.authFailures.join(" | ")}`);
  }
}

// ----- 입구 함수 부르기 (바깥 호출·로그를 붙잡는다) -----
export async function invoke(
  handler: Handler,
  world: World,
  req: Request,
  opts: { allowAuthFailures?: boolean } = {},
): Promise<Captured> {
  if (currentWorld) throw new Error("invoke가 겹쳐 불렸다(겹침 측정은 invokeOverlapped를 쓴다)");
  const startIndex = world.calls.length;
  const logs: LogLine[] = [];
  currentWorld = world;
  const restore = installGlobals((line) => void logs.push(line));
  let resp: Response;
  try {
    resp = await handler(req);
  } finally {
    restore();
    currentWorld = null;
  }
  const bodyText = await resp.text();
  failOnBadCalls(world, opts.allowAuthFailures === true);
  return { status: resp.status, bodyText, calls: world.calls.slice(startIndex), logs };
}

// ----- 겹친 요청: 두 요청을 한 세계에서 실제로 겹치게 한다 -----
// 모든 바깥 호출은 문 앞에서 멈추고, 차례를 정해 준 요청 하나만 한 걸음(바깥 호출 1번) 나아간다.
// 한 번에 한 요청만 움직이므로, 전역(가짜 세계·고정 시각·로그)을 두 요청이 같이 써도
// 어느 호출·어느 로그가 누구 것인지 섞이지 않는다.
export type ReqId = "A" | "B";

class Overlap {
  current: ReqId | null = null;
  private waiting = new Map<ReqId, { kind: string; release: () => void }>();
  private finished = new Set<ReqId>();
  private notify: (() => void) | null = null;

  // fakeFetch가 부른다: 지금 움직이는 요청을 문 앞에 세운다.
  gate(kind: string): Promise<ReqId> {
    const id = this.current;
    if (!id || this.waiting.has(id) || this.finished.has(id)) {
      throw new Error("겹침 측정: 어느 요청의 호출인지 가릴 수 없다");
    }
    return new Promise<ReqId>((resolve) => {
      this.waiting.set(id, {
        kind,
        release: () => {
          this.current = id;
          resolve(id);
        },
      });
      this.current = null;
      this.notify?.();
    });
  }

  private arrival(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.notify = () => {
        this.notify = null;
        resolve();
      };
    });
  }

  // 요청을 시작하고, 첫 문에 닿거나 끝날 때까지 기다린다.
  async start(id: ReqId, run: () => Promise<void>): Promise<void> {
    if (this.current) throw new Error("겹침 측정: 다른 요청이 움직이는 중에 시작할 수 없다");
    const arrived = this.arrival();
    this.current = id;
    run().finally(() => {
      this.finished.add(id);
      if (this.current === id) this.current = null;
      this.notify?.();
    });
    await arrived;
  }

  // 문 앞의 요청을 한 걸음 보내고, 다음 문에 닿거나 끝날 때까지 기다린다.
  async step(id: ReqId): Promise<void> {
    const w = this.waiting.get(id);
    if (!w) throw new Error(`겹침 측정: ${id}가 문 앞에 없다`);
    if (this.current) throw new Error("겹침 측정: 다른 요청이 움직이는 중이다");
    this.waiting.delete(id);
    const arrived = this.arrival();
    w.release();
    await arrived;
  }

  isDone(id: ReqId): boolean {
    return this.finished.has(id);
  }

  // 문 앞에서 기다리는 호출의 종류(끝났으면 null)
  nextKind(id: ReqId): string | null {
    return this.waiting.get(id)?.kind ?? null;
  }
}

// 업무 효과가 있는 호출(DB 쓰기·알림톡·n8n)
export function isEffect(kind: string | null): boolean {
  return !!kind && (kind.startsWith("db-write:") || kind.startsWith("kakao:") || kind === "n8n");
}

export type OverlapSchedule = "A먼저끝" | "번갈아";

export type OverlapCaptured = {
  A: { status: number; bodyText: string };
  B: { status: number; bodyText: string };
  calls: Call[]; // 실제 실행된 순서, by로 구분
  logs: LogLine[];
};

// 공통 겹침: A가 조회를 마치고 첫 쓰기(업무 효과) 직전에 멈춘 사이에, B가 도착해 자기 조회를 한다.
// 그 뒤의 차례:
//   "A먼저끝": A가 끝까지 처리한 뒤 B가 이어서 끝까지 처리한다.
//   "번갈아": A와 B가 바깥 호출을 한 번씩 번갈아 한다.
export async function invokeOverlapped(
  handler: Handler,
  world: World,
  reqA: Request,
  reqB: Request,
  schedule: OverlapSchedule,
): Promise<OverlapCaptured> {
  if (currentWorld) throw new Error("invokeOverlapped가 다른 호출과 겹쳤다");
  const overlap = new Overlap();
  const logs: LogLine[] = [];
  const out: Partial<Record<ReqId, { status: number; bodyText: string }>> = {};
  const startIndex = world.calls.length;
  currentWorld = world;
  currentOverlap = overlap;
  const restore = installGlobals((line) => {
    if (!overlap.current) throw new Error("겹침 측정: 어느 요청의 로그인지 가릴 수 없다");
    logs.push({ ...line, by: overlap.current });
  });
  const run = (id: ReqId, req: Request) => async () => {
    const resp = await handler(req);
    out[id] = { status: resp.status, bodyText: await resp.text() };
  };
  try {
    await overlap.start("A", run("A", reqA));
    while (!overlap.isDone("A") && !isEffect(overlap.nextKind("A"))) await overlap.step("A");
    await overlap.start("B", run("B", reqB));
    while (!overlap.isDone("B") && !isEffect(overlap.nextKind("B"))) await overlap.step("B");
    if (schedule === "A먼저끝") {
      while (!overlap.isDone("A")) await overlap.step("A");
      while (!overlap.isDone("B")) await overlap.step("B");
    } else {
      while (!overlap.isDone("A") || !overlap.isDone("B")) {
        if (!overlap.isDone("A")) await overlap.step("A");
        if (!overlap.isDone("B")) await overlap.step("B");
      }
    }
  } finally {
    restore();
    currentOverlap = null;
    currentWorld = null;
  }
  failOnBadCalls(world, false);
  if (!out.A || !out.B) throw new Error("겹침 측정: 응답을 받지 못한 요청이 있다");
  return { A: out.A, B: out.B, calls: world.calls.slice(startIndex), logs };
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
