// ===== 카카오 알림톡 Edge Function (LunaSoft Jupiter API) =====
// 역할: 프론트엔드 → Edge Function → LunaSoft API → 카카오 알림톡 발송 + DB 로그 기록

import "@supabase/functions-js/edge-runtime.d.ts";

// ===== 환경변수 =====
const LUNASOFT_USERID = Deno.env.get("LUNASOFT_USERID")!;       // ghkdrudals77
const LUNASOFT_API_KEY = Deno.env.get("LUNASOFT_API_KEY")!;      // API 키
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = "https://eonfl.com";

// ===== 템플릿 ID 매핑 =====
const TEMPLATE_IDS: Record<string, number> = {
  analysis_complete:  50202,  // 개별분석 완료 안내
  contract_sent:      50203,  // 계약서 발송 안내
  payment_request:    50204,  // 입금 안내
  payment_confirmed:  50205,  // 입금 확인 완료
  guide_uploaded:     50206,  // 이용방법 안내
  shipping_sent:      50207,  // 택배 발송 안내
  challenge_reminder: 50208,  // 챌린지 시작 D-1 안내
};

// ===== 택배사 코드 매핑 (LunaSoft carrier_code) =====
const CARRIER_CODES: Record<string, string> = {
  "CJ대한통운": "1",
  "우체국": "2",
  "한진택배": "3",
  "로젠택배": "6",
  "롯데택배": "8",
};

// ===== 메시지 본문 생성 =====
function buildMsgContent(type: string, data: Record<string, unknown>): string {
  const link = `${SITE_URL}/application-detail.html?id=${data.app_id}`;

  switch (type) {
    case "analysis_complete":
      return [
        "이온토플 - 개별분석 완료 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        "신청서에 대한 개별분석이 완료되었습니다.",
        "아래 링크에서 분석 내용을 확인하시고, 프로그램 및 일정에 동의해주세요.",
        "",
        "* 24시간 이내 미확인 시 승인이 자동 취소됩니다.",
        "",
        link,
      ].join("\n");

    case "contract_sent":
      return [
        "이온토플 - 계약서 발송 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        `${data.program} 계약서가 발송되었습니다.`,
        "아래 링크에서 계약 내용을 꼼꼼히 확인하신 후 동의해주세요.",
        "",
        "* 24시간 이내 미동의 시 자동 취소됩니다.",
        "",
        link,
      ].join("\n");

    case "payment_request":
      return [
        "이온토플 - 입금 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        "계약이 완료되었습니다.",
        "아래 계좌로 입금을 진행해주세요.",
        "",
        `- 금액: ${data.price}원`,
        `- 은행: ${data.bank}`,
        `- 계좌번호: ${data.account}`,
        `- 예금주: ${data.holder}`,
        "",
        "* 24시간 이내 미입금 시 자동 취소됩니다.",
        "",
        link,
      ].join("\n");

    case "payment_confirmed":
      return [
        "이온토플 - 입금 확인 완료",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        "입금이 확인되었습니다.",
        "이용방법 안내를 곧 보내드리겠습니다.",
        "",
        "조금만 기다려주세요!",
      ].join("\n");

    case "guide_uploaded":
      return [
        "이온토플 - 이용방법 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        `신청하신 ${data.program}의 이용방법이 등록되었습니다.`,
        `프로그램 시작일은 ${data.start_date}입니다.`,
        "",
        "아래 링크에서 이용방법을 꼼꼼히 읽고 숙지해주세요.",
        "이용방법을 모르면 프로그램을 따라오실 수 없습니다.",
        "",
        link,
      ].join("\n");

    case "shipping_sent": {
      const trackingUrl = `https://trace.cjlogistics.com/next/tracking.html?wblNo=${data.tracking_number}`;
      return [
        "이온토플 - 택배 발송 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        "택배가 발송되었습니다.",
        "",
        `- 택배사: ${data.courier}`,
        `- 운송장번호: ${data.tracking_number}`,
        "",
        "아래 링크에서 배송 현황을 확인하실 수 있습니다.",
        "",
        trackingUrl,
      ].join("\n");
    }

    case "challenge_reminder":
      return [
        "이온토플 - Friendly Reminder :-)",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        `신청하신 ${data.program}이 ${data.start_date}부터 시작됩니다`,
        "",
        `*이용방법이 숙지되어있지 않으면 절대로 ${data.program}을 따라오실 수 없습니다. 최소 이틀전까지 이용방법을 꼼꼼히 읽으며 정독해주세요`,
        "",
        link,
      ].join("\n");

    default:
      return "";
  }
}

// ===== SMS 대체 문구 생성 =====
function buildSmsContent(type: string): string {
  switch (type) {
    case "analysis_complete":
      return "[이온토플] 개별분석이 완료되었습니다. 24시간 이내에 확인해주세요.";
    case "contract_sent":
      return "[이온토플] 계약서가 발송되었습니다. 24시간 이내에 확인해주세요.";
    case "payment_request":
      return "[이온토플] 입금을 진행해주세요. 24시간 이내에 완료해주세요.";
    case "payment_confirmed":
      return "[이온토플] 입금이 확인되었습니다. 이용방법 안내를 곧 보내드립니다.";
    case "guide_uploaded":
      return "[이온토플] 이용방법이 등록되었습니다. 꼼꼼히 확인해주세요.";
    case "shipping_sent":
      return "[이온토플] 교재 택배가 발송되었습니다. 배송현황을 확인해주세요.";
    case "challenge_reminder":
      return "[이온토플] 내일부터 챌린지가 시작됩니다! 이용방법을 꼭 확인해주세요.";
    default:
      return "[이온토플] 알림이 도착했습니다.";
  }
}

// ===== LunaSoft API 호출 =====
async function sendLunaSoftAlimTalk(
  templateId: number,
  phone: string,
  msgContent: string,
  smsContent: string,
  btnUrl: string,
  data: Record<string, unknown>,
) {
  const message: Record<string, unknown> = {
    no: "0",
    tel_num: phone.replace(/-/g, ""),   // 하이픈 제거
    msg_content: msgContent,
    sms_content: smsContent,
    use_sms: "1",                        // 알림톡 실패 시 SMS 대체 발송
  };

  // 버튼이 있는 템플릿만 btn_url 추가 (입금확인완료는 버튼 없음)
  if (templateId !== TEMPLATE_IDS.payment_confirmed) {
    message.btn_url = [
      {
        url_pc: btnUrl,
        url_mobile: btnUrl,
      },
    ];
  }

  // 택배 발송인 경우 carrier_code, invoice_number 추가
  if (templateId === TEMPLATE_IDS.shipping_sent) {
    const courierName = (data.courier as string) || "CJ대한통운";
    message.carrier_code = CARRIER_CODES[courierName] || "1";
    message.invoice_number = (data.tracking_number as string) || "";
  }

  const requestBody = {
    userid: LUNASOFT_USERID,
    api_key: LUNASOFT_API_KEY,
    template_id: templateId,
    messages: [message],
  };

  console.log("LunaSoft API request:", JSON.stringify({
    template_id: templateId,
    phone: phone.replace(/-/g, "").slice(0, 5) + "****",
  }));

  const resp = await fetch("https://jupiter.lunasoft.co.kr/api/AlimTalk/message/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const result = await resp.json();
  console.log("LunaSoft API response:", JSON.stringify(result));
  return result;
}

// ===== DB 로그 기록 =====
async function logToDatabase(logData: Record<string, unknown>) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/kakaotalk_logs`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(logData),
    });
    if (!resp.ok) {
      console.warn("Log insert failed:", resp.status, await resp.text());
    }
  } catch (e) {
    console.warn("Log insert error:", e);
  }
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
    const body = await req.json();
    const { type, data } = body as {
      type: string;
      data: Record<string, unknown>;
    };

    // 유효성 검사
    const templateId = TEMPLATE_IDS[type];
    if (!templateId) {
      return new Response(
        JSON.stringify({ success: false, error: `Unknown template type: ${type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!data.phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 메시지 본문 생성
    const msgContent = buildMsgContent(type, data);
    const smsContent = buildSmsContent(type);
    // 택배 발송은 CJ택배 조회 링크, 나머지는 신청서 링크
    const btnUrl = type === "shipping_sent"
      ? `https://trace.cjlogistics.com/next/tracking.html?wblNo=${data.tracking_number}`
      : `${SITE_URL}/application-detail.html?id=${data.app_id}`;

    // LunaSoft API 호출
    const result = await sendLunaSoftAlimTalk(
      templateId,
      data.phone as string,
      msgContent,
      smsContent,
      btnUrl,
      data,
    );

    // 성공 여부 판단 (code 0 = 성공)
    const isSuccess = result.code === 0;
    const messageResult = result.messages?.[0];

    // DB 로그 기록
    await logToDatabase({
      application_id: data.app_id || null,
      student_name: data.name || null,
      phone: (data.phone as string).replace(/-/g, ""),
      template_type: type,
      template_id: templateId,
      msg_content: msgContent,
      sms_content: smsContent,
      status: isSuccess ? "sent" : "failed",
      response_code: result.code,
      response_msg: messageResult?.result_msg || result.msg || null,
      sent_at: isSuccess ? new Date().toISOString() : null,
    });

    return new Response(
      JSON.stringify({
        success: isSuccess,
        code: result.code,
        msg: result.msg,
        message_result: messageResult || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
