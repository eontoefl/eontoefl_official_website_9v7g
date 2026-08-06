// ===== 텔레그램 알림 Edge Function =====
// 역할: 텔레그램 메시지 발송 + 콜백 버튼 처리 (입금 확인, 이용방법 전달)

import "@supabase/functions-js/edge-runtime.d.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = "https://eonfl.com";

// ===== 텔레그램 API 호출 =====
async function sendTelegram(method: string, body: Record<string, unknown>) {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

// ===== Supabase DB 업데이트 =====
async function updateApplication(appId: string, data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${appId}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DB update failed: ${resp.status} ${err}`);
  }
}

// ===== 카카오 알림톡 발송 (kakaotalk-notify Edge Function 호출) =====
async function sendKakaoAlimTalk(type: string, data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/kakaotalk-notify`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type, data }),
  });
  const result = await resp.json();
  console.log("KakaoTalk send result:", JSON.stringify(result));
  return result;
}

// ===== 신청서 조회 =====
async function getApplication(appId: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/applications?id=eq.${appId}&limit=1`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  const data = await resp.json();
  return data[0] || null;
}

// ===== KST 시간 문자열 =====
function getKSTTimeString(): string {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

// ===== 첨삭(correction) 관련 헬퍼 (자동복구 실패 알림 + 텔레그램 재실행 버튼) =====
const N8N_BASE = "https://eontoefl.app.n8n.cloud/webhook";

// 과제 유형 + 차수 → n8n 재실행 웹훅 (admin-correction.js의 매핑과 동일)
// 준비 안 된 호주 유형은 "" → 재실행 불가.
function correctionWebhookUrl(taskType: string, isDraft1: boolean): string {
  const t = (taskType || "").toLowerCase();
  if (t === "writing_email" || t === "writing_discussion") {
    return isDraft1 ? `${N8N_BASE}/correction-writing-draft1` : `${N8N_BASE}/correction-writing-draft2`;
  }
  if (t === "speaking_interview") {
    return isDraft1 ? `${N8N_BASE}/correction-speaking-draft1` : `${N8N_BASE}/correction-speaking-draft2`;
  }
  if (t === "writing_aus_discussion") {
    return isDraft1 ? `${N8N_BASE}/correction-aus-writing-draft1` : "";
  }
  return ""; // 그 외 호주 유형은 워크플로우 미준비
}

function correctionTaskLabel(taskType: string): string {
  const t = (taskType || "").toLowerCase();
  switch (t) {
    case "writing_email": return "Email";
    case "writing_discussion": return "Discussion";
    case "speaking_interview": return "Interview";
    case "writing_aus_discussion": return "호주 Discussion";
    case "writing_aus_integrated": return "호주 통합라이팅";
    case "speaking_aus_independent": return "호주 독립말하기";
    default: return taskType || "-";
  }
}

async function getCorrectionSubmission(id: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/correction_submissions?id=eq.${id}&limit=1`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  const data = await resp.json();
  return data[0] || null;
}

async function getUser(userId: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&limit=1&select=id,name,email`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const data = await resp.json();
  return data[0] || null;
}

async function updateCorrection(id: string, data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/correction_submissions?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`correction update failed: ${resp.status} ${err}`);
  }
}

async function postN8nWebhook(url: string, payload: Record<string, unknown>) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`n8n webhook failed: ${resp.status} ${err}`);
  }
  return resp;
}

// ===== 기프티콘 미발송 인원 집계 =====
// 관리자 응답자 명단과 동일 기준: (학생+시험날짜) 묶음 중 gifty_sent_at이 하나도 없는 그룹 수.
async function countPendingGifty(): Promise<number> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/toefl_survey_responses?select=user_id,user_name,exam_date,gifty_sent_at`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!resp.ok) throw new Error(`pending query failed: ${resp.status}`);
  const rows = await resp.json() as Array<Record<string, unknown>>;

  // 그룹별로 "한 번이라도 발송됐는지" 표시
  const sentByKey: Record<string, boolean> = {};
  for (const r of rows) {
    const key = `${r.user_id || r.user_name || "?"}|${r.exam_date}`;
    if (!(key in sentByKey)) sentByKey[key] = false;
    if (r.gifty_sent_at) sentByKey[key] = true;
  }
  let pending = 0;
  for (const k in sentByKey) if (!sentByKey[k]) pending++;
  return pending;
}

// ===== 메인 핸들러 =====
Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    // ===== 텔레그램 콜백 (Webhook) =====
    if (contentType.includes("application/json")) {
      const body = await req.json();

      // 텔레그램 webhook update (콜백 버튼 클릭)
      if (body.callback_query) {
        return await handleCallback(body.callback_query, corsHeaders);
      }

      // 프론트엔드에서 호출 (알림 발송 요청)
      if (body.type) {
        return await handleNotification(body, corsHeaders);
      }
    }

    return new Response(
      JSON.stringify({ error: "Invalid request" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ===== 알림 발송 처리 =====
async function handleNotification(body: Record<string, unknown>, corsHeaders: Record<string, string>) {
  const { type, data } = body as { type: string; data: Record<string, unknown> };
  const now = getKSTTimeString();

  let text = "";
  let buttons: Array<Array<Record<string, unknown>>> = [];

  switch (type) {
    // ----- 1번: 신청서 접수 -----
    case "new_application": {
      text =
        `📋 새 신청서 접수!\n\n` +
        `👤 이름: ${data.name || "-"}\n` +
        `📧 이메일: ${data.email || "-"}\n` +
        `📱 전화: ${data.phone || "-"}\n` +
        `🎯 목표: ${data.target_score || "-"}점\n` +
        `📚 희망 프로그램: ${data.preferred_program || "-"}\n` +
        `🕐 접수 시간: ${now}`;
      break;
    }

    // ----- 2번: 프로그램 동의 완료 -----
    case "student_agreed": {
      text =
        `✅ 학생 동의 완료!\n\n` +
        `👤 이름: ${data.name || "-"}\n` +
        `📚 프로그램: ${data.program || "-"}\n` +
        `🕐 동의 시간: ${now}\n\n` +
        `계약서가 자동 발송되었습니다.`;
      break;
    }

    // ----- 3번: 계약서 서명 완료 -----
    case "contract_signed": {
      text =
        `✍️ 계약서 서명 완료!\n\n` +
        `👤 이름: ${data.name || "-"}\n` +
        `📚 프로그램: ${data.program || "-"}\n` +
        `🕐 서명 시간: ${now}\n\n` +
        `학생이 입금 단계로 이동했습니다.`;
      break;
    }

    // ----- 실전 리포트(설문) 접수 알림 -----
    case "survey_submitted": {
      let pendingLine = "";
      try {
        const pending = await countPendingGifty();   // 방금 접수분 포함 (survey.js가 저장 후 알림 호출)
        pendingLine = `\n☕ 미발송 ${pending}명`;
      } catch (e) {
        console.warn("미발송 집계 실패(접수 알림은 발송):", e);
      }
      text = `📋 실전 리포트 접수 — ${data.name || "-"}\n📅 시험일 ${data.exam_date || "-"}${pendingLine}`;
      break;
    }

    // ----- 4번: 입금 완료 알림 -----
    case "deposit_claimed": {
      text =
        `💰 입금 완료 알림!\n\n` +
        `👤 이름: ${data.name || "-"}\n` +
        `💳 입금자명: ${data.depositor_name || "-"}\n` +
        `🕐 알림 시간: ${now}\n\n` +
        `학생이 입금했다고 합니다.\n확인 후 처리해주세요.`;
      buttons = [
        [
          { text: "✅ 입금 확인하기", callback_data: `confirm_deposit:${data.app_id}` },
          { text: "📄 신청서 보기", url: `${SITE_URL}/application-detail.html?id=${data.app_id}` },
        ],
      ];
      break;
    }

    // ----- 첨삭 자동복구 실패 알림 (자동 재실행 2번 모두 실패) -----
    case "correction_retry_failed": {
      const draftRound = data.draft_round || 1;
      const label = correctionTaskLabel(String(data.task_type || ""));
      const roundStr = `${data.session_number ?? "-"}회 ${label} (${draftRound}차)`;
      text =
        `⚠️ 첨삭 자동복구 실패 — 확인 필요\n\n` +
        `이름: ${data.name || "-"}\n` +
        `항목: ${roundStr}\n` +
        `시간: ${now}\n\n` +
        `AI 채점을 자동으로 다시 돌려봤지만 계속 실패했어요.\n` +
        `아래 '다시 재실행'을 누르거나 관리자 페이지에서 확인해주세요.`;
      buttons = [
        [
          { text: "🔄 다시 재실행", callback_data: `retry_correction:${data.submission_id}` },
          { text: "📄 관리자 페이지", url: `${SITE_URL}/admin-correction.html` },
        ],
      ];
      break;
    }

    // ----- 첨삭 연장(13~24세션) 신청 접수 -----
    // 테스트룸에서 학생이 [신청하기]를 누르는 순간 발송.
    // 입금 확인 버튼 = 원탭 처리(연장 적용 + 알림톡). 시작일이 일요일이 아니어야 하는
    // 예외 상황이면 버튼 대신 관리자 모달의 [연장 적용]으로 수동 처리한다.
    case "extension_requested": {
      text =
        `📥 첨삭 연장 신청!\n\n` +
        `👤 이름: ${data.name || "-"}\n` +
        `💳 입금 대기 · 200,000원 (입금자명 = 학생 이름)\n` +
        `📅 신청 마감: ${data.deadline || "-"}\n` +
        `🕐 신청 시간: ${now}`;
      buttons = [
        [
          { text: "✅ 입금 확인 → 연장 적용", callback_data: `confirm_extension:${data.request_id}` },
          { text: "📄 신청서 보기", url: `${SITE_URL}/application-detail.html?id=${data.app_id}` },
        ],
      ];
      break;
    }

    default:
      return new Response(
        JSON.stringify({ error: "Unknown notification type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
  }

  // 텔레그램 메시지 발송
  const messageBody: Record<string, unknown> = {
    chat_id: CHAT_ID,
    text: text,
  };

  if (buttons.length > 0) {
    messageBody.reply_markup = { inline_keyboard: buttons };
  }

  const result = await sendTelegram("sendMessage", messageBody);

  return new Response(
    JSON.stringify({ success: true, result }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ===== 콜백 버튼 처리 =====
async function handleCallback(callbackQuery: Record<string, unknown>, corsHeaders: Record<string, string>) {
  const callbackData = callbackQuery.data as string;
  const callbackId = callbackQuery.id as string;
  const message = callbackQuery.message as Record<string, unknown>;
  const chatId = (message.chat as Record<string, unknown>).id;
  const messageId = message.message_id;
  const now = getKSTTimeString();

  const [action, appId] = callbackData.split(":");

  // ----- 첨삭 재실행 (correction_retry_failed 알림의 버튼) -----
  //   appId 자리는 correction_submissions.id (신청서 id 아님) → 별도 처리
  if (action === "retry_correction") {
    return await handleRetryCorrectionCallback(appId, callbackId, chatId, messageId, now, corsHeaders);
  }

  // ----- 첨삭 연장 원탭 처리 (extension_requested 알림의 버튼) -----
  //   appId 자리는 correction_extension_requests.id (신청서 id 아님) → 별도 처리
  if (action === "confirm_extension") {
    return await handleConfirmExtensionCallback(appId, callbackId, chatId, messageId, now, corsHeaders);
  }

  try {
    // 신청서 정보 조회
    const app = await getApplication(appId);
    if (!app) {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "신청서를 찾을 수 없습니다.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    switch (action) {
      // ----- 입금 확인하기 -----
      case "confirm_deposit": {
        // 이미 처리됐는지 확인
        if (app.deposit_confirmed_by_admin) {
          await sendTelegram("answerCallbackQuery", {
            callback_query_id: callbackId,
            text: "이미 입금 확인 처리된 신청서입니다.",
            show_alert: true,
          });
          return new Response("OK", { headers: corsHeaders });
        }

        // DB 업데이트: 입금 확인 (관리자 패널과 동일하게 current_step=5)
        await updateApplication(appId, {
          deposit_confirmed_by_admin: true,
          deposit_confirmed_by_admin_at: Date.now(),
          current_step: 5,
        });

        // 알림톡: 입금 확인 완료 (관리자 패널 확인과 동일 동작)
        // 실패해도 입금 확인 처리/텔레그램 안내는 그대로 진행
        try {
          await sendKakaoAlimTalk("payment_confirmed", {
            name: app.name,
            phone: app.phone,
            app_id: appId,
          });
        } catch (e) {
          console.warn("payment_confirmed 알림톡 발송 실패:", e);
        }

        // 기존 메시지 수정 (버튼 제거, 완료 표시)
        await sendTelegram("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text:
            `💰 입금 완료 알림\n\n` +
            `👤 이름: ${app.name || "-"}\n` +
            `💳 입금자명: ${app.depositor_name || "-"}\n\n` +
            `✅ 입금 확인 완료 (${now})`,
        });

        // 팝업 알림
        await sendTelegram("answerCallbackQuery", {
          callback_query_id: callbackId,
          text: "입금 확인 완료!",
        });

        // 5번: 다음 단계 메시지 발송 (이용방법 전달하기 버튼 포함)
        await sendTelegram("sendMessage", {
          chat_id: CHAT_ID,
          text:
            `✅ 입금 확인 처리 완료!\n\n` +
            `👤 이름: ${app.name || "-"}\n` +
            `🕐 확인 시간: ${now}\n\n` +
            `다음 단계: 이용방법 전달`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📖 이용방법 전달하기", callback_data: `send_guide:${appId}` },
                { text: "📄 신청서 보기", url: `${SITE_URL}/application-detail.html?id=${appId}` },
              ],
            ],
          },
        });

        break;
      }

      // ----- 이용방법 전달하기 -----
      case "send_guide": {
        // 이미 처리됐는지 확인
        if (app.guide_sent) {
          await sendTelegram("answerCallbackQuery", {
            callback_query_id: callbackId,
            text: "이미 이용방법이 전달된 신청서입니다.",
            show_alert: true,
          });
          return new Response("OK", { headers: corsHeaders });
        }

        // DB 업데이트: 이용방법 전달
        await updateApplication(appId, {
          guide_sent: true,
          guide_sent_at: Date.now(),
          current_step: 9,
        });

        // 기존 메시지 수정 (버튼 제거, 완료 표시)
        await sendTelegram("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text:
            `✅ 입금 확인 처리 완료!\n\n` +
            `👤 이름: ${app.name || "-"}\n\n` +
            `📖 이용방법 전달 완료 (${now})`,
        });

        // 팝업 알림
        await sendTelegram("answerCallbackQuery", {
          callback_query_id: callbackId,
          text: "이용방법 전달 완료!",
        });

        break;
      }

      default: {
        await sendTelegram("answerCallbackQuery", {
          callback_query_id: callbackId,
          text: "알 수 없는 액션입니다.",
          show_alert: true,
        });
      }
    }
  } catch (error) {
    console.error("Callback error:", error);
    await sendTelegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: `오류 발생: ${error.message}`,
      show_alert: true,
    });
  }

  return new Response("OK", { headers: corsHeaders });
}

// ===== 첨삭 재실행 콜백 처리 (텔레그램 '다시 재실행' 버튼) =====
async function handleRetryCorrectionCallback(
  subId: string,
  callbackId: string,
  chatId: unknown,
  messageId: unknown,
  now: string,
  corsHeaders: Record<string, string>,
) {
  try {
    const sub = await getCorrectionSubmission(subId);
    if (!sub) {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "해당 첨삭 건을 찾을 수 없습니다.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    // 차수 판정. 이미 처리(성공)된 건이면 재실행 대상 아님.
    let isDraft1: boolean;
    if (sub.status === "feedback1_failed" || sub.status === "draft1_submitted") {
      isDraft1 = true;
    } else if (sub.status === "feedback2_failed" || sub.status === "draft2_submitted") {
      isDraft1 = false;
    } else {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "이미 처리되었거나 재실행 대상이 아닙니다.",
        show_alert: true,
      });
      await sendTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: `✅ 이미 처리된 건입니다. (${now})`,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    const webhookUrl = correctionWebhookUrl(sub.task_type, isDraft1);
    if (!webhookUrl) {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "이 유형은 아직 채점 워크플로우가 준비되지 않았습니다.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    const submittedEvent = isDraft1 ? "draft1_submitted" : "draft2_submitted";

    // 상태를 제출 직후로 되돌리고, 자동 재실행 예산도 초기화(사람이 직접 눌렀으니 다시 기회 부여)
    await updateCorrection(subId, {
      status: submittedEvent,
      auto_retry_count: 0,
      last_auto_retry_at: null,
      retry_failed_notified: false,
    });

    const user = await getUser(sub.user_id);
    await postN8nWebhook(webhookUrl, {
      event: submittedEvent,
      user_id: sub.user_id,
      user_name: user?.name || "",
      user_email: user?.email || "",
      session_number: sub.session_number,
      task_type: sub.task_type,
      task_number: sub.task_number,
    });

    const label = correctionTaskLabel(sub.task_type);
    const draftRound = isDraft1 ? 1 : 2;
    await sendTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text:
        `⚠️ 첨삭 자동복구 실패 — 재실행 요청됨\n\n` +
        `이름: ${user?.name || "-"}\n` +
        `항목: ${sub.session_number ?? "-"}회 ${label} (${draftRound}차)\n\n` +
        `재실행 요청 완료 (${now})\n결과가 나오면 평소처럼 승인 대기로 넘어갑니다.`,
    });
    await sendTelegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "재실행 요청 완료!",
    });
  } catch (error) {
    console.error("retry_correction callback error:", error);
    await sendTelegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: `재실행 실패: ${error.message}`,
      show_alert: true,
    });
  }

  return new Response("OK", { headers: corsHeaders });
}

// ===== 첨삭 연장(13~24세션) 관련 헬퍼 =====

async function getExtensionRequest(id: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/correction_extension_requests?id=eq.${id}&limit=1`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const data = await resp.json();
  return data[0] || null;
}

async function updateExtensionRequest(id: string, data: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/correction_extension_requests?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`extension request update failed: ${resp.status} ${err}`);
  }
}

// correction_schedules에 연장 필드 UPSERT — 관리자 모달(upsertCorrectionExtensionSchedule)과 동일 규칙.
// 행이 없을 때(신규 insert)에도 NOT NULL 제약을 만족하도록 1학기 시작일이 있으면 함께 보낸다.
async function upsertScheduleExtension(userId: string, extStartDate: string, correctionStartDate: string | null) {
  const body: Record<string, unknown> = {
    user_id: userId,
    extension_enabled: true,
    extension_start_date: extStartDate,
  };
  if (correctionStartDate) {
    body.start_date = correctionStartDate;
    body.duration_weeks = 4;
  }
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/correction_schedules?on_conflict=user_id`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal,resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`correction_schedules upsert failed: ${resp.status} ${err}`);
  }
}

async function getScheduleByUser(userId: string) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/correction_schedules?user_id=eq.${userId}&limit=1&select=extension_notify_sent`,
    {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const data = await resp.json();
  return data[0] || null;
}

async function markExtensionNotified(userId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/correction_schedules?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      extension_notify_sent: true,
      extension_notify_sent_at: new Date().toISOString(),
    }),
  });
}

// date(UTC 자정) 이후(포함) 첫 일요일
function sundayOnOrAfterUTC(d: Date): Date {
  const r = new Date(d.getTime());
  const add = (7 - r.getUTCDay()) % 7;
  r.setUTCDate(r.getUTCDate() + add);
  return r;
}
function ymdUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 12세션(writing·speaking) 모두 제출됐는지 = 1학기 진도 완료
async function isSession12Submitted(userId: string): Promise<boolean> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/correction_submissions?user_id=eq.${userId}&session_number=eq.12&select=task_type`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  const rows = await resp.json();
  if (!Array.isArray(rows)) return false;
  const w = rows.some((r: Record<string, unknown>) => String(r.task_type || "").startsWith("writing"));
  const s = rows.some((r: Record<string, unknown>) => String(r.task_type || "").startsWith("speaking"));
  return w && s;
}

// 연장 시작일(KST, YYYY-MM-DD):
//   12세션 제출 완료(선입선출/진도 끝) → 다가오는 첫 일요일
//   아직 진행 중 → 1학기 종료(시작+27일) 이후 첫 일요일
//   (입금이 늦어 그 일요일이 과거면 다가오는 일요일로 — 둘 중 늦은 날)
async function computeExtStartDate(userId: string, correctionStartYmd: string | null): Promise<string> {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayUTC = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
  const base = sundayOnOrAfterUTC(todayUTC);            // 다가오는 일요일
  const done = await isSession12Submitted(userId);
  if (done || !correctionStartYmd) return ymdUTC(base);
  const cStart = new Date(correctionStartYmd + "T00:00:00Z");
  const cEnd = new Date(cStart.getTime() + 27 * 24 * 60 * 60 * 1000);   // 1학기 종료
  const endSunday = sundayOnOrAfterUTC(cEnd);
  return ymdUTC(endSunday.getTime() > base.getTime() ? endSunday : base);
}

// ===== 첨삭 연장 원탭 콜백 처리 (텔레그램 '입금 확인 → 연장 적용' 버튼) =====
// 한 번의 탭으로: 신청 confirmed → applications 미러 + correction_schedules 원본 기록
// (= 학생 화면 13~24세션 오픈) → 연장 완료 알림톡(50227) 발송.
// 시작일 = 다가오는 첫 일요일(KST). 다른 시작일이 필요하면 이 버튼 대신
// 관리자 모달의 [연장 적용]으로 수동 처리한다(그쪽은 날짜 선택 가능).
async function handleConfirmExtensionCallback(
  reqId: string,
  callbackId: string,
  chatId: unknown,
  messageId: unknown,
  now: string,
  corsHeaders: Record<string, string>,
) {
  try {
    const reqRow = await getExtensionRequest(reqId);
    if (!reqRow) {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "연장 신청 기록을 찾을 수 없습니다.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    if (reqRow.status === "confirmed") {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "이미 처리된 연장 신청입니다.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    if (!reqRow.application_id) {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "신청서 연결 정보가 없습니다. 관리자 페이지에서 수동으로 적용해주세요.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    const app = await getApplication(reqRow.application_id);
    if (!app) {
      await sendTelegram("answerCallbackQuery", {
        callback_query_id: callbackId,
        text: "신청서를 찾을 수 없습니다. 관리자 페이지에서 수동으로 적용해주세요.",
        show_alert: true,
      });
      return new Response("OK", { headers: corsHeaders });
    }

    const extStart = await computeExtStartDate(reqRow.user_id, app.correction_start_date || null);

    // 1) applications 미러 (대시보드/신청상세가 읽음)
    await updateApplication(reqRow.application_id, {
      extension_enabled: true,
      extension_start_date: extStart,
    });

    // 2) correction_schedules 원본 (테스트룸이 읽음) — 이 순간 학생 화면에 13~24세션이 열림
    await upsertScheduleExtension(reqRow.user_id, extStart, app.correction_start_date || null);

    // 3) 신청 기록 확정
    await updateExtensionRequest(reqId, {
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    });

    // 4) 연장 완료 알림톡(50227) — 학생당 1회, 실패해도 연장 적용은 유지
    //    (관리자 모달 maybeSendExtensionAlimTalk와 동일 규칙·동일 일정 계산)
    let kakaoOk = false;
    try {
      const schedule = await getScheduleByUser(reqRow.user_id);
      if (schedule && schedule.extension_notify_sent === true) {
        kakaoOk = true; // 이미 발송됨 — 재발송하지 않음
      } else {
        const startD = new Date(extStart + "T00:00:00");
        const endD = new Date(startD.getTime() + 27 * 24 * 60 * 60 * 1000);
        const fmt = (d: Date) =>
          `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
        const res = await sendKakaoAlimTalk("correction_extension_complete", {
          name: app.name,
          phone: app.phone,
          app_id: reqRow.application_id,
          round: "1",
          start_date: fmt(startD),
          end_date: fmt(endD),
        });
        kakaoOk = !!(res && res.success);
        if (kakaoOk) await markExtensionNotified(reqRow.user_id);
      }
    } catch (e) {
      console.warn("연장 알림톡 발송 실패(연장 적용은 유지):", e);
    }

    // 5) 기존 메시지 수정 (버튼 제거, 완료 표시)
    await sendTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text:
        `📥 첨삭 연장 신청\n\n` +
        `👤 이름: ${app.name || "-"}\n\n` +
        `✅ 입금 확인 · 연장 적용 완료 (${now})\n` +
        `📅 13~24세션 시작일: ${extStart} (일요일)\n` +
        (kakaoOk
          ? `📨 연장 완료 알림톡 발송됨`
          : `⚠️ 알림톡 발송 실패 — 관리자 모달에서 [연장 적용]을 다시 누르면 재발송됩니다.`),
    });

    await sendTelegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: "연장 적용 완료!",
    });
  } catch (error) {
    console.error("confirm_extension callback error:", error);
    await sendTelegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: `연장 적용 실패: ${error.message}`,
      show_alert: true,
    });
  }

  return new Response("OK", { headers: corsHeaders });
}
