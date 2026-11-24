// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-3 (나) 임시 Edge 함수 zz-b2n3-relay (시험 프로젝트 hmncdheiwqwekdbtijar 전용)
//
// ★ 시험 전용이다. 운영에 올리지 않는다. 실제 책 중계(계약 5)가 아니다 — "요청마다 판정 1회 + 범위 요청 흘려보내기"의
//   비용과 "로그인 종료 뒤 거절"만 재려는 것이다. 실측이 끝나면 지운다(절차.md).
// ★ 이 파일은 작업방이 Edge 실행 환경에서 돌려 본 적이 없다(Node 에 Deno 흉내를 씌워 가짜 응답으로만 돌려 봤다).
//
// 배포 설정: 이름 zz-b2n3-relay, verify_jwt 끔(판정은 함수 안에서 한다).
// 환경 값(이름과 뜻은 절차.md 에도 있다)
//   실행 환경이 주는 것: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   브레인방이 넣는 것 : B2N3_MARKER          이 실행의 표식(make_pdf 의 marker)
//                        B2N3_MEMBER_ID       이 실행의 시험 회원번호(public.users.id — 로그인 계정 번호가 아니다)
//                        B2N3_OBJECT_160 / B2N3_OBJECT_68 / B2N3_OBJECT_34   books 버킷의 합성 객체 이름
//                                             (zzb2n3_<표식>_160.pdf 모양이 아니면 함수가 돌지 않는다)
//                        B2N3_ALLOWED_ORIGIN  측정 화면의 출처(예: http://127.0.0.1:8787)
//
// 받는 요청: GET·HEAD  ?doc=160|68|34&run=<요청 꼬리표>   (OPTIONS 는 사전 요청)
//   호출자는 버킷·경로를 보내지 못한다. 함수가 환경 값의 고정된 이름 셋 중 하나를 고른다.
// 요청마다: 받은 회원 자격 그대로 public.zz_b2n3_whoami() 를 부른다(지금 로그인 기록이 살아 있고 대응하는 회원번호).
//   허용이 아니면 Storage 를 부르지 않는다.
//     확인된 자격 거절  → 401(회원이 아님·로그인 자격이 아님) / 403(다른 회원), 본문 없음
//     판정 장애         → 503 과 고정 문구(RPC 오류·시간 초과·예상 밖 응답). 장애를 자격 거절로 바꿔 내지 않는다
//   허용이면 서비스 열쇠로 그 객체를 가져오되 들어온 Range 를 그대로 전달하고, 응답을 모으지 않고 흘려보낸다.
// 응답 머리글 X-B2n3-Judge 에 판정 결과를 적는다(측정 화면이 "이 함수가 낸 응답"임을 확인하는 데 쓴다).
// 로그: 요청마다 한 줄  b2n3 marker=… run=… doc=… m=… range=… judge=… status=… bytes=… ms=… end=…
//   자격·열쇠는 적지 않는다.
// =====================================================================

const TEST_URL = "https://hmncdheiwqwekdbtijar.supabase.co";
const BUCKET = "books";
const DOCS = ["160", "68", "34"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const JUDGE_TIMEOUT_MS = 5000;

type Config = { marker: string; member: string; objects: Record<string, string>; origin: string; anonKey: string; serviceKey: string };

function readConfig(): Config | null {
  const env = (k: string) => Deno.env.get(k) ?? "";
  const marker = env("B2N3_MARKER");
  const member = env("B2N3_MEMBER_ID");
  const origin = env("B2N3_ALLOWED_ORIGIN");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!/^[a-z0-9]{4,16}$/.test(marker)) return null;
  if (!UUID_RE.test(member)) return null;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin)) return null;
  if (!anonKey || !serviceKey) return null;
  const objects: Record<string, string> = {};
  for (const d of DOCS) {
    const name = env(`B2N3_OBJECT_${d}`);
    if (name !== `zzb2n3_${marker}_${d}.pdf`) return null; // 이 실행의 합성 객체 이름 모양만
    objects[d] = name;
  }
  return { marker, member, objects, origin, anonKey, serviceKey };
}

function corsHeaders(req: Request, cfg: Config | null): Record<string, string> {
  const h: Record<string, string> = { "Vary": "Origin" };
  if (cfg && req.headers.get("origin") === cfg.origin) {
    h["Access-Control-Allow-Origin"] = cfg.origin;
    h["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
    h["Access-Control-Allow-Headers"] = "authorization, apikey, range";
    h["Access-Control-Expose-Headers"] = "Content-Range, Accept-Ranges, Content-Length, X-B2n3-Judge";
  }
  return h;
}

const clean = (s: string | null, max: number) => (s ?? "-").replace(/[^\x21-\x7e]/g, "_").slice(0, max) || "-";

// 받은 자격이 "로그인 자격의 모양"인가만 본다(서명은 확인하지 않는다 — 거절에만 쓴다. 허용은 RPC 만 정한다).
function loginTokenOf(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  try {
    const b64 = m[1].split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    if (payload?.role !== "authenticated") return null;
  } catch {
    return null;
  }
  return m[1];
}

type Judge = { result: "allow" | "not_member" | "other_member" | "judge_error"; detail: string };

async function judge(cfg: Config, token: string): Promise<Judge> {
  let res: Response;
  try {
    res = await fetch(`${TEST_URL}/rest/v1/rpc/zz_b2n3_whoami`, {
      method: "POST",
      headers: { "apikey": cfg.anonKey, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
  } catch (e) {
    return { result: "judge_error", detail: (e as Error)?.name === "TimeoutError" ? "rpc_timeout" : "rpc_network" };
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { result: "judge_error", detail: `rpc_${res.status}_unreadable` };
  }
  if (res.status !== 200) {
    let code = "";
    try {
      code = String(JSON.parse(text)?.code ?? "");
    } catch { /* 본문이 JSON 이 아님 */ }
    return { result: "judge_error", detail: `rpc_${res.status}${code ? "_" + clean(code, 16) : ""}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { result: "judge_error", detail: "rpc_200_not_json" };
  }
  if (value === null) return { result: "not_member", detail: "whoami_null" };
  if (typeof value !== "string" || !UUID_RE.test(value)) return { result: "judge_error", detail: "rpc_200_unexpected" };
  if (value.toLowerCase() === cfg.member.toLowerCase()) return { result: "allow", detail: "whoami_match" };
  return { result: "other_member", detail: "whoami_other" };
}

// 흘려보내면서 바이트 수만 센다(모으지 않는다).
function counted(body: ReadableStream<Uint8Array>, onEnd: (bytes: number, how: string) => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let n = 0;
  let ended = false;
  const finish = (how: string) => {
    if (!ended) {
      ended = true;
      onEnd(n, how);
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish("done");
          return;
        }
        n += value.byteLength;
        controller.enqueue(value);
      } catch (e) {
        finish("upstream_error");
        controller.error(e);
      }
    },
    cancel(reason) {
      finish("client_closed");
      return reader.cancel(reason);
    },
  });
}

async function handler(req: Request): Promise<Response> {
  const t0 = Date.now();
  // 0. 함수 스스로의 대상 확인 — 다르면 바깥으로 어떤 요청도 보내기 전에 끝낸다
  if ((Deno.env.get("SUPABASE_URL") ?? "") !== TEST_URL) {
    console.log("b2n3 wrong_target status=500");
    return new Response("b2n3: wrong target", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
  const cfg = readConfig();
  const cors = corsHeaders(req, cfg);
  const base = { ...cors, "Cache-Control": "private, no-store" };
  if (!cfg) {
    console.log("b2n3 bad_config status=500");
    return new Response("b2n3: bad config", { status: 500, headers: base });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const doc = url.searchParams.get("doc") ?? "";
  const run = url.searchParams.get("run") ?? "";
  const range = req.headers.get("range");
  const line = (judgeText: string, status: number, bytes: number, end: string) =>
    console.log(`b2n3 marker=${cfg.marker} run=${clean(run, 64)} doc=${clean(doc, 4)} m=${req.method} range=${clean(range, 64)} judge=${judgeText} status=${status} bytes=${bytes} ms=${Date.now() - t0} end=${end}`);
  const plain = (status: number, judgeText: string, body: string | null) => {
    line(judgeText, status, 0, "none");
    return new Response(body, { status, headers: { ...base, "X-B2n3-Judge": judgeText.split(":")[0] } });
  };

  if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "not_judged:method", null);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || !DOCS.includes(doc) || !RUN_RE.test(run)) return plain(400, "not_judged:bad_request", null);

  // 1. 판정 — 허용이 아니면 Storage 를 부르지 않는다
  const token = loginTokenOf(req);
  if (!token) return plain(401, "no_login_credential", null);
  const j = await judge(cfg, token);
  if (j.result === "not_member") return plain(401, "not_member", null);
  if (j.result === "other_member") return plain(403, "other_member", null);
  if (j.result !== "allow") return plain(503, `judge_error:${j.detail}`, "b2n3: judge unavailable");

  // 2. 전달 — 들어온 Range 를 그대로, 응답은 흘려보낸다
  const upHeaders: Record<string, string> = { "apikey": cfg.serviceKey, "Authorization": `Bearer ${cfg.serviceKey}`, "Accept-Encoding": "identity" };
  if (range !== null) upHeaders["Range"] = range;
  let up: Response;
  try {
    up = await fetch(`${TEST_URL}/storage/v1/object/authenticated/${BUCKET}/${cfg.objects[doc]}`, { method: req.method, headers: upHeaders });
  } catch {
    return plain(502, "allow:upstream_network", "b2n3: upstream error");
  }
  const out: Record<string, string> = { ...base, "X-B2n3-Judge": "allow" };
  for (const [from, to] of [["content-type", "Content-Type"], ["content-length", "Content-Length"], ["content-range", "Content-Range"], ["accept-ranges", "Accept-Ranges"]]) {
    const v = up.headers.get(from);
    if (v !== null) out[to] = v;
  }
  if (up.status === 416) {
    await up.body?.cancel();
    line("allow", 416, 0, "none");
    return new Response(null, { status: 416, headers: out });
  }
  if (up.status !== 200 && up.status !== 206) {
    await up.body?.cancel();
    return plain(502, `allow:upstream_${up.status}`, "b2n3: upstream error");
  }
  if (req.method === "HEAD" || !up.body) {
    await up.body?.cancel();
    line("allow", up.status, 0, "none");
    return new Response(null, { status: up.status, headers: out });
  }
  const status = up.status;
  return new Response(counted(up.body, (bytes, how) => line("allow", status, bytes, how)), { status, headers: out });
}

Deno.serve(handler);
