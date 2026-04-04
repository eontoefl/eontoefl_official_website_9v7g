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

        // DB 업데이트: 입금 확인
        await updateApplication(appId, {
          deposit_confirmed_by_admin: true,
          deposit_confirmed_by_admin_at: Date.now(),
          current_step: 8,
        });

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
