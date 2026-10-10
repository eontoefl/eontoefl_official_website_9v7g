// ===== 가입 이메일 인증 Edge Function (email-verify) =====
// 역할: 가입 폼 3곳(회원가입·입문서 신청·챌린지 신청서)에서 새 계정을 만들기 전에
//       6자리 인증번호를 이메일로 보내고(request) 학생이 입력한 번호를 대조한다(confirm).
//
// 요청: POST JSON  { action: "request" | "confirm", email: string, code?: string }
//       헤더 Authorization: Bearer <anon key>  (브라우저가 호출)
// 응답: { ok: true, ... } 또는 { ok: false, reason: <아래 목록>, ... }
//   request → ok:true {expires_in:180, resend_after:30}
//             reason: invalid_email | already_registered | domain_not_found | too_soon(retry_after) |
//                     hourly_limit | daily_limit | send_failed
//   confirm → ok:true
//             reason: invalid_code | not_found | expired | too_many_attempts | wrong(remaining)
//
// 규칙(회의 확정): 번호 3분 유효 / 재발송 30초 뒤 / 틀림 5회면 폐기 / 같은 이메일 1시간 10회 /
//   하루 전체 100통 / 발송 실패 시 "이온토플 문제봇" 텔레그램 (첫 실패 즉시 + 10분에 1통 요약)
//
// 저장: public.email_verifications (번호 원문 없음, sha256(email:code) 해시만),
//       public.email_verification_state (알림 시각 1행). 둘 다 service_role 전용.
// 발송: n8n 웹훅(N8N_VERIFY_WEBHOOK_URL, 비밀 헤더 N8N_VERIFY_WEBHOOK_SECRET) → Resend(noreply@eonfl.com).
// 알림: DB 함수 send_problem_bot_alert(text) (Vault V2 열쇠, service_role 전용).
//
// 주의: 대시보드 Code 탭 배포 방식이므로 bare import 를 쓰지 않는다.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const N8N_URL = Deno.env.get("N8N_VERIFY_WEBHOOK_URL") || "";
const N8N_SECRET = Deno.env.get("N8N_VERIFY_WEBHOOK_SECRET") || "";

const CODE_TTL_SEC = 180;          // 번호 유효 3분
const RESEND_AFTER_SEC = 30;       // 재발송 30초 뒤부터
const MAX_ATTEMPTS = 5;            // 틀린 입력 5회면 폐기
const HOURLY_PER_EMAIL = 10;       // 같은 이메일 1시간 10회
const DAILY_TOTAL = 100;           // 하루 전체 100통 (Resend 무료 구간 하루 100통에 맞춤; 실측 가입 하루 평균 3.5건)
const ALERT_INTERVAL_MIN = 10;     // 장애 알림 10분에 1통
const N8N_TIMEOUT_MS = 15000;
const DNS_TIMEOUT_MS = 3000;       // 도메인 조회 대기 (넘으면 막지 않고 통과)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

type Row = Record<string, unknown>;

// ---------- Supabase REST (service_role) ----------
const SB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sbSelect(table: string, params: Record<string, string>): Promise<Row[]> {
  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB_HEADERS });
  if (!resp.ok) throw new Error(`DB select ${table} ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

async function sbInsert(table: string, row: Row): Promise<Row> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...SB_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!resp.ok) throw new Error(`DB insert ${table} ${resp.status}: ${await resp.text()}`);
  const rows = await resp.json();
  return rows[0];
}

async function sbUpdate(table: string, filter: Record<string, string>, patch: Row): Promise<Row[]> {
  const qs = new URLSearchParams(filter).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: { ...SB_HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error(`DB update ${table} ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

async function sbCount(table: string, params: Record<string, string>): Promise<number> {
  const qs = new URLSearchParams({ ...params, select: "id" }).toString();
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: { ...SB_HEADERS, Prefer: "count=exact" },
  });
  if (!resp.ok) throw new Error(`DB count ${table} ${resp.status}: ${await resp.text()}`);
  const range = resp.headers.get("content-range") || "";   // 예: "0-9/42" 또는 "*/0"
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : (await resp.json()).length;
}

async function sbRpc(fn: string, args: Row): Promise<unknown> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: SB_HEADERS,
    body: JSON.stringify(args),
  });
  if (!resp.ok) throw new Error(`RPC ${fn} ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

// ---------- 공통 도구 ----------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function normalizeEmail(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function escapeIlike(v: string): string {
  return v.replace(/[\\%_]/g, "\\$&");
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  // 000000~999999 균등 추출 (6자리, 앞자리 0 허용)
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}

function kstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function kstString(d = kstNow()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function kstDateString(d = kstNow()): string {
  return kstString(d).slice(0, 10);
}

// 오늘(KST) 0시의 UTC ISO 문자열 — 하루 전체 발송 수 집계 기준
function kstDayStartIso(): string {
  const k = kstNow();
  const startUtcMs = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600 * 1000;
  return new Date(startUtcMs).toISOString();
}

// 이메일 도메인이 실제로 메일을 받을 수 있는지 (MX, 없으면 A/AAAA) 조회한다.
// 목적: 없는 도메인(오타 포함)으로는 번호를 보내지 않아 반송을 막고, 학생에게 바로 알린다.
// DNS 조회가 느리거나 실패하면 진짜 학생을 막지 않도록 '통과'로 본다(반송 1건이 가입 1건 손실보다 싸다).
async function domainAcceptsMail(domain: string): Promise<boolean> {
  const lookup = async (type: "MX" | "A" | "AAAA"): Promise<boolean> => {
    try {
      const recs = await Deno.resolveDns(domain, type);
      return Array.isArray(recs) && recs.length > 0;
    } catch (e) {
      // NXDOMAIN / 레코드 없음 → false, 그 외 네트워크 오류는 호출자가 판단
      const msg = String((e as Error).message || "");
      if (/NotFound|no record|NXDOMAIN|name not found/i.test(msg) || (e as Error).name === "NotFound") return false;
      throw e;
    }
  };
  const check = (async () => {
    if (await lookup("MX")) return true;
    if (await lookup("A")) return true;
    return await lookup("AAAA");
  })();
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), DNS_TIMEOUT_MS));
  try {
    return await Promise.race([check, timeout]);
  } catch (e) {
    console.warn("domain lookup error (pass-through):", domain, (e as Error).message);
    return true;
  }
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim().slice(0, 64);
}

// ---------- 문제봇 알림 ----------
async function problemBot(text: string): Promise<void> {
  try {
    await sbRpc("send_problem_bot_alert", { message_text: text });
  } catch (e) {
    console.error("problem bot alert failed:", e);
  }
}

// 발송 실패 알림: 첫 실패는 즉시, 그 뒤로는 10분에 1통(그 사이 실패를 묶어서)
async function alertSendFailure(email: string, reason: string): Promise<void> {
  try {
    const [state] = await sbSelect("email_verification_state", { singleton_id: "eq.1", select: "*" });
    const last = state && state.last_failure_alert_at ? new Date(String(state.last_failure_alert_at)).getTime() : 0;
    const sinceMin = (Date.now() - last) / 60000;
    if (last && sinceMin < ALERT_INTERVAL_MIN) return;   // 아직 10분 안 지남 → 다음 실패 때 요약

    const windowStart = new Date(Date.now() - ALERT_INTERVAL_MIN * 60000).toISOString();
    const failedRecent = await sbSelect("email_verifications", {
      send_status: "eq.failed",
      created_at: `gte.${windowStart}`,
      select: "email",
    });
    const failCount = failedRecent.length;
    const emails = new Set(failedRecent.map((r) => String(r.email)));

    let text: string;
    if (failCount <= 1) {
      text =
        `⚠️ 가입 인증 메일 발송 실패\n\n` +
        `대상: ${email}\n` +
        `사유: ${reason}\n` +
        `발생: ${kstString()}\n\n` +
        `n8n(signup-email-verify)·Gmail 상태를 확인해 주세요. 장애 동안 신규 가입은 막힙니다.`;
    } else {
      text =
        `🔴 가입 인증 메일 장애 계속\n\n` +
        `지난 ${ALERT_INTERVAL_MIN}분 실패 ${failCount}건, 가입 못 한 이메일 ${emails.size}개\n` +
        `마지막 사유: ${reason}\n` +
        `시각: ${kstString()}`;
    }
    await problemBot(text);
    await sbUpdate("email_verification_state", { singleton_id: "eq.1" }, {
      last_failure_alert_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("alertSendFailure error:", e);
  }
}

// 하루 상한 알림: 하루 1회
async function alertDailyLimit(count: number): Promise<void> {
  try {
    const today = kstDateString();
    const [state] = await sbSelect("email_verification_state", { singleton_id: "eq.1", select: "*" });
    if (state && String(state.daily_limit_alert_date || "") === today) return;
    await problemBot(
      `🛑 가입 인증 메일 하루 상한 도달 (${count}/${DAILY_TOTAL}통)\n\n` +
      `오늘(${today})은 더 보내지 않습니다. 신규 가입이 막혀 있으니 장난 발송인지 확인해 주세요.\n` +
      `(상한은 Resend 무료 구간 하루 100통에 맞춘 값입니다)`,
    );
    await sbUpdate("email_verification_state", { singleton_id: "eq.1" }, {
      daily_limit_alert_date: today,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("alertDailyLimit error:", e);
  }
}

// ---------- n8n → Gmail ----------
async function sendViaN8n(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  if (!N8N_URL || !N8N_SECRET) return { ok: false, error: "N8N_VERIFY_WEBHOOK_* 환경변수 없음" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), N8N_TIMEOUT_MS);
  try {
    const resp = await fetch(N8N_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-verify-secret": N8N_SECRET },
      body: JSON.stringify({ email, code, requested_at: kstString(), ttl_min: CODE_TTL_SEC / 60 }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, error: `n8n ${resp.status}: ${text.slice(0, 200)}` };
    let body: Row = {};
    try { body = JSON.parse(text); } catch { /* 본문이 JSON이 아니면 상태코드만 믿는다 */ }
    if (body && body.ok === false) return { ok: false, error: `n8n: ${String(body.error || "ok:false")}` };
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "n8n 응답 없음 (시간 초과)" : `n8n 호출 실패: ${(e as Error).message}`;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- request ----------
async function handleRequest(email: string, ip: string): Promise<Response> {
  // 이미 가입된 이메일이면 보내지 않는다 (세 폼의 중복 판정을 서버에서 통일)
  const existing = await sbSelect("users", { email: `ilike.${escapeIlike(email)}`, select: "id", limit: "1" });
  if (existing.length > 0) return json({ ok: false, reason: "already_registered" });

  // 없는 도메인(오타 포함)이면 보내지 않는다 — 기록도 남기지 않음
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!(await domainAcceptsMail(domain))) return json({ ok: false, reason: "domain_not_found" });

  // 재발송 간격 30초
  const [latest] = await sbSelect("email_verifications", {
    email: `eq.${email}`, order: "created_at.desc", limit: "1", select: "created_at",
  });
  if (latest) {
    const elapsed = (Date.now() - new Date(String(latest.created_at)).getTime()) / 1000;
    if (elapsed < RESEND_AFTER_SEC) {
      return json({ ok: false, reason: "too_soon", retry_after: Math.ceil(RESEND_AFTER_SEC - elapsed) });
    }
  }

  // 같은 이메일 1시간 10회
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const hourly = await sbCount("email_verifications", { email: `eq.${email}`, created_at: `gte.${hourAgo}` });
  if (hourly >= HOURLY_PER_EMAIL) return json({ ok: false, reason: "hourly_limit" });

  // 하루 전체 300통 (실제로 보낸 것만 센다)
  const daily = await sbCount("email_verifications", { send_status: "eq.sent", created_at: `gte.${kstDayStartIso()}` });
  if (daily >= DAILY_TOTAL) {
    await alertDailyLimit(daily);
    return json({ ok: false, reason: "daily_limit" });
  }

  const code = randomCode();
  const row = await sbInsert("email_verifications", {
    email,
    code_hash: await sha256Hex(`${email}:${code}`),
    expires_at: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString(),
    client_ip: ip || null,
  });

  const sent = await sendViaN8n(email, code);
  if (!sent.ok) {
    await sbUpdate("email_verifications", { id: `eq.${row.id}` }, {
      send_status: "failed", send_error: (sent.error || "").slice(0, 500),
    });
    await alertSendFailure(email, sent.error || "알 수 없음");
    return json({ ok: false, reason: "send_failed" });
  }

  await sbUpdate("email_verifications", { id: `eq.${row.id}` }, { send_status: "sent" });
  return json({ ok: true, expires_in: CODE_TTL_SEC, resend_after: RESEND_AFTER_SEC });
}

// ---------- confirm ----------
async function handleConfirm(email: string, codeRaw: unknown): Promise<Response> {
  const code = String(codeRaw || "").trim();
  if (!/^\d{6}$/.test(code)) return json({ ok: false, reason: "invalid_code" });

  // 가장 최근에 실제로 보낸 번호만 유효 (재발송하면 이전 번호는 자동 무효)
  const [row] = await sbSelect("email_verifications", {
    email: `eq.${email}`, send_status: "eq.sent", order: "created_at.desc", limit: "1", select: "*",
  });
  if (!row) return json({ ok: false, reason: "not_found" });
  if (row.verified_at) return json({ ok: true, already: true });
  if (new Date(String(row.expires_at)).getTime() < Date.now()) return json({ ok: false, reason: "expired" });
  const attempts = Number(row.attempts || 0);
  if (attempts >= MAX_ATTEMPTS) return json({ ok: false, reason: "too_many_attempts" });

  const hash = await sha256Hex(`${email}:${code}`);
  if (hash !== row.code_hash) {
    const next = attempts + 1;
    await sbUpdate("email_verifications", { id: `eq.${row.id}` }, { attempts: next });
    if (next >= MAX_ATTEMPTS) return json({ ok: false, reason: "too_many_attempts" });
    return json({ ok: false, reason: "wrong", remaining: MAX_ATTEMPTS - next });
  }

  await sbUpdate("email_verifications", { id: `eq.${row.id}` }, { verified_at: new Date().toISOString() });
  return json({ ok: true });
}

// ---------- 입구 ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }

  const action = String(body.action || "");
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return json({ ok: false, reason: "invalid_email" });

  try {
    if (action === "request") return await handleRequest(email, clientIp(req));
    if (action === "confirm") return await handleConfirm(email, body.code);
    return json({ ok: false, reason: "unknown_action" }, 400);
  } catch (e) {
    console.error("email-verify error:", e);
    return json({ ok: false, reason: "server_error" }, 500);
  }
});
