// ===== 후속메일 관리자 대시보드 — 조회 + 대표 3동작 Edge Function =====
// 역할: 후속메일 장부(followup_jobs / followup_messages / followup_activity_logs /
//       followup_runtime)와 발송 제외 목록(followup_suppressions)을 service_role 로
//       읽어 관리자 화면(admin-followup.html)에 리스트 JSON 을 돌려주고,
//       대표의 세 가지 동작(수정 저장·발송 취소·지금 발송 요청)만 장부 함수로 전달한다.
//
// ★절대 규칙:
//   - 쓰기는 아래 세 장부 함수 호출로만 한다: followup_save_revision / followup_cancel_job /
//     followup_request_send_now. 그 밖의 상태 변경·후보 스캔·초안 생성 배선은 없다.
//   - Gmail(실제 발송)은 이 함수에서 절대 호출하지 않는다. `지금 발송`도 장부에 요청 시각만 남긴다.
//   - 전체 발송 잠금(followup_runtime.send_locked)은 이 함수가 풀지 않는다. 실제 발송 잠금은 유지된다.
//   - 학생에게 실제 메일을 보내는 기능은 대표 명시 승인 전까지 이 코드에 절대 없다.
//
// 접근은 공홈의 기존 관리자 화면 통로를 사용한다.
// 후속메일 화면만의 별도 암호는 대표 결정(2026-08-28)에 따라 사용하지 않는다.
// 전체 관리자 보안 개편은 별도 작업으로 남긴다.
//
// 배포(STOP-B): `supabase functions deploy followup-admin` 은 대표가. 이 파일은 코드만.

import "@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 대표가 화면에서 부를 수 있는 장부 함수 화이트리스트. 이 셋 외에는 절대 부르지 않는다.
const ACTION_RPC: Record<string, string> = {
  save_revision: "followup_save_revision",
  cancel: "followup_cancel_job",
  send_now: "followup_request_send_now",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// service_role 로 followup_* 테이블 조회. 실패 시 null(화면은 "아직 데이터 없음" 처리).
async function readTable(path: string): Promise<unknown[] | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) {
      console.warn(`followup-admin read ${path} → ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.warn(`followup-admin read ${path} 예외:`, e);
    return null;
  }
}

// 장부 함수(RPC) 호출. 화이트리스트 함수만, service_role 로. 반환은 함수의 jsonb 결과.
async function callRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(args),
    });
    const text = await resp.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: String(e) } };
  }
}

// 장부 함수가 내는 영어 예외를 대표가 읽을 한국어로 바꾼다.
function koreanError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("subject and body are required")) return "제목과 본문을 모두 채워 주세요.";
  if (m.includes("reason are required") || m.includes("reason is required")) {
    return "취소 사유를 입력해 주세요.";
  }
  if (m.includes("revision can only be saved during review")) {
    return "검토 중인 메일만 수정할 수 있어요.";
  }
  if (m.includes("gmail reconciliation is required")) {
    return "Gmail 발송 결과를 먼저 확인해야 해요.";
  }
  if (m.includes("send can only be requested during review")) {
    return "검토 중인 메일만 지금 발송을 요청할 수 있어요.";
  }
  if (m.includes("cannot be canceled")) return "지금 상태에서는 이 메일을 취소할 수 없어요.";
  if (m.includes("job not found")) return "해당 메일을 찾을 수 없어요.";
  if (m.includes("message slot is missing")) return "이 메일의 본문 기록을 찾을 수 없어요.";
  if (m.includes("rule version")) return "작성 규칙 정보가 없어 저장할 수 없어요.";
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

// stage → 퍼널 위치 프록시. status='canceled' 면 그 단계 이탈로 표시.
function funnelFor(stage: string, status: string): string {
  const base: Record<string, string> = {
    stage1: "apply",
    stage2: "agree",
    stage3a: "contract",
    stage3b: "paid",
  };
  const b = base[stage] || "apply";
  if (status === "canceled" && b !== "paid") return `${b}_drop`;
  return b;
}

// 현재점수 → 목표 문자열(admin-utils getScoreDisplay 와 같은 컬럼 우선순위).
function scoreText(app: Record<string, unknown> | null): string {
  if (!app) return "-";
  const current = app.score_total_old ?? app.score_total_new ?? null;
  const target = app.target_cutoff_old ?? app.target_cutoff_new ?? null;
  const c = current === null || current === undefined || current === "" ? "무점수" : String(current);
  const t = target === null || target === undefined || target === "" ? "-" : String(target);
  return `${c} → 목표 ${t}`;
}

const V2_JOB_COLS =
  "id,application_id,user_id,email,stage,reason,progress_percent,scheduled_at,status," +
  "cancel_reason,review_started_at,review_deadline_at,next_action_at,send_requested_at," +
  "next_retry_at,held_at,held_kind,held_reason,skipped_at,skip_reason,failed_at,last_failed_at,last_error," +
  "send_attempt_count,send_retry_count,attachment_asset_id,rule_version,sent_at,gmail_message_id,gmail_thread_id," +
  "created_at,updated_at";
const V2_APP_EMBED =
  "applications(name,score_total_old,score_total_new,target_cutoff_old,target_cutoff_new)";
const V2_MSG_EMBED =
  "followup_messages(subject,body,review_status,ref_materials,validation_evidence," +
  "validation_passed_at,attachment_asset_id,rule_version,created_at)";

// 오전 7시부터 오후 11시까지 매 정시에 도는 운영 작업의 다음 실행 시각.
// send_requested_at을 기준으로 계산하므로, 실행이 늦어져도 화면의 약속 시각이 뒤로 밀리지 않는다.
function nextProcessingAt(requestedAt: unknown): string {
  const requested = new Date(String(requestedAt || ""));
  if (Number.isNaN(requested.getTime())) return "";

  const kstMs = requested.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const day = kst.getUTCDate();
  const hour = kst.getUTCHours();

  let targetLocalUtcMs: number;
  if (hour < 7) {
    targetLocalUtcMs = Date.UTC(year, month, day, 7, 0, 0, 0);
  } else if (hour >= 23) {
    targetLocalUtcMs = Date.UTC(year, month, day + 1, 7, 0, 0, 0);
  } else {
    targetLocalUtcMs = Date.UTC(year, month, day, hour + 1, 0, 0, 0);
  }
  return new Date(targetLocalUtcMs - 9 * 60 * 60 * 1000).toISOString();
}

// followup_jobs 한 행 → 화면용 객체.
function shapeJob(j: Record<string, unknown>): Record<string, unknown> {
  const app = (j.applications as Record<string, unknown>) || null;
  const embeddedMessages = j.followup_messages;
  const msgs = Array.isArray(embeddedMessages)
    ? embeddedMessages as Array<Record<string, unknown>>
    : embeddedMessages && typeof embeddedMessages === "object"
    ? [embeddedMessages as Record<string, unknown>]
    : [];
  const msg = msgs.slice().sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  )[0] || null;

  const stage = String(j.stage || "");
  const status = String(j.status || "");
  const refs = (msg?.ref_materials as Record<string, unknown>) || {};
  const validation = (msg?.validation_evidence as Record<string, unknown>) || {};
  const mcr = (validation.machine as Record<string, unknown>) || {};
  const attachment = (j.attachment_asset_id as string) ||
    (msg?.attachment_asset_id as string) || "";

  const out: Record<string, unknown> = {
    job_id: j.id || "",
    name: (app?.name as string) || "-",
    email: (j.email as string) || "",
    stage,
    status,
    when: j.scheduled_at || "",
    review_deadline_at: j.review_deadline_at || "",
    next_action_at: j.next_action_at || "",
    send_requested_at: j.send_requested_at || "",
    next_processing_at: j.send_requested_at ? nextProcessingAt(j.send_requested_at) : "",
    score: scoreText(app),
    progress: j.progress_percent ?? null,
    funnel: funnelFor(stage, status),
    why: (status === "skipped" ? (j.skip_reason || j.cancel_reason) : j.reason) || j.reason || "",
    manual_review: status === "skipped",
    review: (refs.used_review_id as string) || (refs.review_id as string) || "",
    materials: (refs.used_materials as unknown[]) || (refs.materials as unknown[]) || [],
    subject: (msg?.subject as string) || "",
    body: (msg?.body as string) || "",
    attachment_asset_id: attachment,
    has_attachment: !!attachment,
    rule_version: (j.rule_version as string) || (msg?.rule_version as string) || "",
    review_status: (msg?.review_status as string) || "",
    validation_passed_at: msg?.validation_passed_at || "",
    sent_at: j.sent_at || "",
    gmail_message_id: j.gmail_message_id || "",
    gmail_thread_id: j.gmail_thread_id || "",
  };

  // 검사 보류: 사람이 읽을 사유 + machine_check_result 상세.
  if (status === "held") {
    out.hold_reason = (j.held_reason as string) || "";
    out.hold_kind = (j.held_kind as string) || (mcr.hold_kind as string) ||
      (Array.isArray(validation.server_failed) ? "gate3" : "gate2");
    out.regen = (mcr.regen as string) ||
      (validation.attempt_count ? `작성 시도 ${validation.attempt_count}회` : "");
    if (Array.isArray(mcr.results)) {
      out.failed = (mcr.results as Array<Record<string, unknown>>)
        .filter((r) => r.pass === false)
        .map((r) => ({ check: r.check || "검사", reason: r.reason || r.evidence || "탈락" }));
    } else if (Array.isArray(validation.server_failed)) {
      out.failed = (validation.server_failed as unknown[]).map((reason) => ({
        check: "공통 검사",
        reason: String(reason),
      }));
    }
    const human = (validation.human as Record<string, unknown>) || {};
    if (Array.isArray(human.checks)) {
      out.warns = (human.checks as Array<Record<string, unknown>>)
        .filter((r) => r.pass === false)
        .map((r) => ({ check: r.check || "사람 판단", reason: r.reason || r.evidence || "확인 필요" }));
    }
  }

  // 발송 실패: 마지막 실패 사유·시각·시도 횟수·다음 재시도.
  if (status === "failed" || j.last_error || j.failed_at) {
    out.fail_error = (j.last_error as string) || "";
    out.failed_at = j.failed_at || j.last_failed_at || "";
    out.attempt_count = j.send_attempt_count ?? 0;
    out.next_retry_at = j.next_retry_at || "";
  }

  // 시기 지난 종결(skipped): 별도 관리 기록으로만.
  if (status === "skipped") {
    out.skipped_at = j.skipped_at || "";
    out.skip_reason = (j.skip_reason as string) || (j.cancel_reason as string) || "";
  }

  return out;
}

// ---- 조회(GET) ----
async function handleRead(): Promise<Response> {
  const selectV2 = `${V2_JOB_COLS},${V2_APP_EMBED},${V2_MSG_EMBED}`;
  let jobsRaw = await readTable(
    `followup_jobs?select=${encodeURIComponent(selectV2)}&order=scheduled_at.desc.nullslast`,
  );

  let schemaVersion = "v3";
  if (jobsRaw === null) {
    // 라이브 장부(v3) 전 호환: 최소 컬럼으로 한 번 더 시도.
    const selectV1 =
      "id,application_id,user_id,email,stage,reason,progress_percent,scheduled_at,status," +
      "cancel_reason,created_at,updated_at," +
      V2_APP_EMBED + "," +
      "followup_messages(subject,body,personalization,ref_materials,created_at)";
    jobsRaw = await readTable(
      `followup_jobs?select=${encodeURIComponent(selectV1)}&order=scheduled_at.desc.nullslast`,
    );
    schemaVersion = "v1";
  }

  if (jobsRaw === null) {
    return json({ jobs: [], suppressions: [], count: 0, data_ready: false, server_now: new Date().toISOString() });
  }

  const jobs = (jobsRaw as Array<Record<string, unknown>>).map(shapeJob);
  const jobById = new Map(jobs.map((job) => [String(job.job_id || ""), job]));

  // 최근 발송과 다섯 가지 성과. 본문 전문은 내려주지 않는다.
  const activityRaw = await readTable(
    "followup_activity_logs?select=id,job_id,event,detail,occurred_at,created_at" +
      "&event=in.(send_succeeded,reply,application,analysis_consent,contract_consent,payment)" +
      "&order=occurred_at.desc.nullslast&limit=200",
  );
  const activities = (activityRaw || []).map((row) => {
    const r = row as Record<string, unknown>;
    const detail = (r.detail as Record<string, unknown>) || {};
    const job = (jobById.get(String(r.job_id || "")) || {}) as Record<string, unknown>;
    return {
      id: r.id || "",
      job_id: r.job_id || "",
      event: r.event || "",
      occurred_at: r.occurred_at || r.created_at || "",
      attributed: detail.attributed === true,
      classification: detail.classification || "",
      name: job.name || "-",
      email: job.email || "",
      stage: job.stage || "",
      sent_at: job.sent_at || detail.linked_sent_at || "",
    };
  });
  const outcomeCounts: Record<string, number> = {
    reply: 0, application: 0, analysis_consent: 0, contract_consent: 0, payment: 0,
  };
  for (const activity of activities) {
    const event = String(activity.event || "");
    if (activity.attributed && event in outcomeCounts) outcomeCounts[event] += 1;
  }

  // 영구 발송 제외 목록.
  const suppressionsRaw = await readTable(
    "followup_suppressions?select=id,user_id,email,label,reason,note,active,created_at,updated_at" +
      "&active=eq.true&order=created_at.desc",
  );
  const suppressions = (suppressionsRaw || []).map((s) => {
    const r = s as Record<string, unknown>;
    return {
      id: r.id || "",
      email: r.email || "",
      label: r.label || "",
      reason: r.reason || "manual",
      note: r.note || "",
      created_at: r.created_at || "",
    };
  });

  // 전역 운영 상태(관찰 중 여부·전체 발송 잠금).
  const runtimeRaw = await readTable(
    "followup_runtime?select=operation_mode,send_locked,last_success_at,last_run_started_at," +
      "last_failure_at,expected_interval_minutes,missed_after_minutes&singleton_id=eq.1",
  );
  const rt = (runtimeRaw && runtimeRaw[0]) as Record<string, unknown> | undefined;
  const runtime = rt
    ? {
      operation_mode: rt.operation_mode || "observe",
      send_locked: rt.send_locked !== false,
      last_success_at: rt.last_success_at || "",
      last_run_started_at: rt.last_run_started_at || "",
      last_failure_at: rt.last_failure_at || "",
      expected_interval_minutes: rt.expected_interval_minutes ?? 60,
      missed_after_minutes: rt.missed_after_minutes ?? 90,
    }
    : { operation_mode: "observe", send_locked: true };

  return json({
    jobs,
    activities,
    outcome_counts: outcomeCounts,
    suppressions,
    runtime,
    count: jobs.length,
    suppression_count: suppressions.length,
    data_ready: true,
    schema_version: schemaVersion,
    server_now: new Date().toISOString(),
  });
}

// ---- 대표 동작(POST) ----
async function handleAction(req: Request): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "요청 형식이 올바르지 않아요." }, 400);
  }

  const action = String(payload.action || "");
  const rpc = ACTION_RPC[action];
  if (!rpc) return json({ ok: false, error: "알 수 없는 요청이에요." }, 400);

  const jobId = String(payload.job_id || "");
  const requestId = String(payload.request_id || "");
  if (!jobId || !requestId) {
    return json({ ok: false, error: "요청 정보가 부족해요.(job_id·request_id)" }, 400);
  }

  let args: Record<string, unknown>;
  if (action === "save_revision") {
    const subject = String(payload.subject ?? "").trim();
    const body = String(payload.body ?? "").trim();
    if (!subject || !body) return json({ ok: false, error: "제목과 본문을 모두 채워 주세요." }, 400);

    // 첨부·작성 규칙은 현재 값을 그대로 보존한다. 장부에서 현재 값을 읽어 넘긴다.
    const cur = await readTable(
      `followup_messages?job_id=eq.${encodeURIComponent(jobId)}` +
        `&select=attachment_asset_id,rule_version`,
    );
    const curRow = (cur && cur[0]) as Record<string, unknown> | undefined;
    const jobCur = await readTable(
      `followup_jobs?id=eq.${encodeURIComponent(jobId)}&select=attachment_asset_id,rule_version`,
    );
    const jobRow = (jobCur && jobCur[0]) as Record<string, unknown> | undefined;
    const attachment = (jobRow?.attachment_asset_id as string) ||
      (curRow?.attachment_asset_id as string) || "";
    const ruleVersion = (jobRow?.rule_version as string) || (curRow?.rule_version as string) || "";

    args = {
      p_job_id: jobId,
      p_request_id: requestId,
      p_subject: subject,
      p_body: body,
      p_attachment_asset_id: attachment,
      p_rule_version: ruleVersion,
      p_editor: "representative",
    };
  } else if (action === "cancel") {
    const reason = String(payload.reason ?? "").trim();
    if (!reason) return json({ ok: false, error: "취소 사유를 입력해 주세요." }, 400);
    args = { p_job_id: jobId, p_request_id: requestId, p_reason: reason };
  } else {
    // send_now — 장부에 요청 시각만 남긴다. Gmail·발송 잠금은 건드리지 않는다.
    args = { p_job_id: jobId, p_request_id: requestId };
  }

  const res = await callRpc(rpc, args);
  if (!res.ok) {
    const raw = (res.data as Record<string, unknown> | null)?.message
      ? String((res.data as Record<string, unknown>).message)
      : JSON.stringify(res.data);
    return json({ ok: false, error: koreanError(raw), raw }, 400);
  }

  // 함수는 갱신된 job 행(jsonb)을 돌려준다. 화면 표시에 필요한 값만 추린다.
  const jobRow = (res.data as Record<string, unknown>) || {};
  return json({
    ok: true,
    action,
    job: {
      job_id: jobRow.id || jobId,
      status: jobRow.status || "",
      review_deadline_at: jobRow.review_deadline_at || "",
      next_action_at: jobRow.next_action_at || "",
      send_requested_at: jobRow.send_requested_at || "",
      next_processing_at: jobRow.send_requested_at ? nextProcessingAt(jobRow.send_requested_at) : "",
      cancel_reason: jobRow.cancel_reason || "",
    },
    server_now: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "지원하지 않는 요청이에요." }, 405);
  }

  try {
    return req.method === "GET" ? await handleRead() : await handleAction(req);
  } catch (error) {
    console.error("followup-admin error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});
