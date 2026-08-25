// ===== 후속메일 관리자 대시보드 — 읽기 전용 Edge Function =====
// 역할: 후속메일 장부(followup_jobs / followup_messages / followup_activity_logs)를
//       service_role 로 읽어 관리자 대시보드(admin-followup.html)에 리스트 JSON 을 돌려준다.
//
// ★절대 규칙(설계 수리설계_후속메일_v2.md §6 위험모델):
//   - 이 함수는 "읽기(GET)만" 한다. 쓰기·상태변경·발송(Gmail)·후보스캔·초안생성 배선 없음.
//   - 학생에게 실제 메일을 보내는 기능은 대표 명시 승인 전까지 이 코드에 절대 없다.
//
// 접근 통제(★대표 결정 2026-08-25): 관리자 접근 잠금은 이 함수만 별도로 걸지 않는다.
//   - 관리자 화면 전체(admin-*.html)가 지금은 화면단 requireAdmin() 게이트만 쓰므로,
//     이 함수도 형제 화면과 동일하게 맞춘다(별도 공유비밀 없음). 다른 Edge Function
//     (telegram-notify 등)과 동일한 Supabase 게이트(anon 키)만 사용.
//   - 서버 전용 이유는 그대로: followup_* 는 RLS 로 anon 직접 조회가 막혀 있어, service_role
//     로 읽어 주는 통로가 필요하기 때문(설계 §3.4·§3.5).
//   - ★관리자 전용 잠금은 사이트 전체(회원DB 포함)와 함께 별도 "보안작업"에서 일괄 처리한다.
//     (이 함수도 그 일괄 잠금 대상 — 보안작업 목록에 포함.)
//
// 배포(STOP-B): `supabase functions deploy followup-admin` 은 대표가. 이 파일은 코드만.

import "@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// service_role 로 followup_* 테이블 조회. 실패 시 null(대시보드는 "아직 데이터 없음" 처리).
async function readTable(path: string): Promise<unknown[] | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    // 테이블 미생성(스키마 라이브 전) 등은 정상 상황 → null 로 처리하고 대시보드가 빈 화면 안내.
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

// stage → 퍼널 위치 프록시(라이브 파이프라인 전 단계용, 설계 §3.5 정밀 derivation 은 파이프라인 라이브 때).
//   stage1=신청 · stage2=동의 · stage3a=계약 · stage3b=결제. status='canceled' 면 그 단계에서 이탈로 표시.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 읽기 전용: GET 만 허용.
  if (req.method !== "GET") {
    return json({ error: "이 함수는 읽기(GET) 전용입니다." }, 405);
  }

  try {
    // 1) followup_jobs (예약시각 최신순) + applications(이름·점수) + followup_messages 임베드.
    //    임베드는 PostgREST FK 기반. 메시지는 job 당 최신 1건을 코드에서 고른다(002 후 unique(job_id)).
    const select =
      "id,application_id,user_id,email,stage,reason,progress_percent,scheduled_at,status," +
      "applications(name,score_total_old,score_total_new,target_cutoff_old,target_cutoff_new)," +
      "followup_messages(subject,body,used_review_id,used_materials,machine_check_result,tone_score,self_check,created_at)";
    const jobsRaw = await readTable(
      `followup_jobs?select=${encodeURIComponent(select)}&order=scheduled_at.desc.nullslast`,
    );

    // 테이블 미생성/조회 실패 = 라이브 전 정상 상황 → 빈 리스트 + 안내 플래그.
    if (jobsRaw === null) {
      return json({ jobs: [], count: 0, data_ready: false });
    }

    const jobs = (jobsRaw as Array<Record<string, unknown>>).map((j) => {
      const app = (j.applications as Record<string, unknown>) || null;
      const msgs = (j.followup_messages as Array<Record<string, unknown>>) || [];
      // 최신 메시지 1건(created_at desc). 정렬 불가 시 첫 행.
      const msg = msgs.slice().sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || ""))
      )[0] || null;

      const stage = String(j.stage || "");
      const status = String(j.status || "");
      const mcr = (msg?.machine_check_result as Record<string, unknown>) || {};

      const out: Record<string, unknown> = {
        name: (app?.name as string) || "-",
        stage,
        status,
        when: j.scheduled_at || "",
        score: scoreText(app),
        progress: j.progress_percent ?? null,
        funnel: funnelFor(stage, status),
        why: j.reason || "",
        review: (msg?.used_review_id as string) || "",
        materials: (msg?.used_materials as unknown[]) || [],
        subject: (msg?.subject as string) || "",
        body: (msg?.body as string) || "",
      };

      // 보류건: machine_check_result 안의 실패·경고 사유를 그대로 실어 보낸다(gate3/gate2 출력 형식).
      if (status === "held") {
        out.hold_kind = (mcr.hold_kind as string) || (Array.isArray(mcr.failed) ? "gate3" : "gate2");
        out.regen = (mcr.regen as string) || "";
        if (Array.isArray(mcr.failed)) out.failed = mcr.failed;
        if (Array.isArray(mcr.warns)) out.warns = mcr.warns;
      }

      return out;
    });

    return json({ jobs, count: jobs.length, data_ready: true });
  } catch (error) {
    console.error("followup-admin error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});
