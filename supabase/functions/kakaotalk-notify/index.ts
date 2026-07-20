// ===== 카카오 알림톡 Edge Function (LunaSoft Jupiter API) =====
// 역할: 프론트엔드 → Edge Function → LunaSoft API → 카카오 알림톡 발송 + DB 로그 기록

import "@supabase/functions-js/edge-runtime.d.ts";

// ===== 환경변수 =====
const LUNASOFT_USERID = Deno.env.get("LUNASOFT_USERID")!;       // ghkdrudals77
const LUNASOFT_API_KEY = Deno.env.get("LUNASOFT_API_KEY")!;      // API 키
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = "https://eonfl.com";
const TESTROOM_URL = "https://testroom.eonfl.com";

// ===== 템플릿 ID 매핑 =====
const TEMPLATE_IDS: Record<string, number> = {
  analysis_complete:  50202,  // 개별분석 완료 안내 (일반 학생)
  contract_sent:      50203,  // 계약서 발송 안내
  payment_request:    50204,  // 입금 안내
  payment_confirmed:  50205,  // 입금 확인 완료
  guide_uploaded:     50206,  // 이용방법 안내
  shipping_sent:      50207,  // 택배 발송 안내
  challenge_reminder: 50208,  // 챌린지 시작 D-1 안내
  correction_start_reminder: 50213, // 스라첨삭 시작 안내
  correction_feedback_1: 50211,  // 1차 첨삭 완료 안내
  correction_feedback_2: 50212,  // 최종 첨삭 완료 안내
  incentive_analysis_complete: 50214,  // 프로모션 학생: 개별분석 & 입문서 전송 완료 안내
  incentive_deadline_warning:  50215,  // 프로모션 학생: 동의 마감 6시간 전 안내
  analysis_updated:            50217,  // 개별분석 수정 안내
  analysis_registered:         50226,  // 개별분석 등록 안내 (조건부승인/거부 — 확인 필요)
  contract_deferred:           50221,  // 계약서 기한 유예 안내
  contract_deferral_reminder:  50222,  // 계약서 유예 만료 24시간 전 리마인더
  weekly_check_registered:     50225,  // 주간체크 등록 안내
  analysis_agree_reminder:     50228,  // 개별분석 동의 마감 2시간 전 리마인드 (일반 학생)
  contract_agree_reminder:     50229,  // 계약서 동의 마감 2시간 전 리마인드 (일반 학생)
  deposit_reminder:            50230,  // 입금 마감 2시간 전 리마인드 (일반 학생)
  practice_open:               50231,  // 연습코스 오픈 안내 (정규과정 종료 후 자동 활성화)
  toefl_exam_day:              50233,  // 시험 당일 회신 안내 + 리포트 참여
};

// ===== 입금 계좌 정보 (전 학생 공통, 하드코딩) =====
const DEPOSIT_BANK = "국민은행";
const DEPOSIT_ACCOUNT = "545601-01-233970";
const DEPOSIT_HOLDER = "황경민(이온)";

// ===== 택배사 코드 매핑 (LunaSoft carrier_code) =====
const CARRIER_CODES: Record<string, string> = {
  "CJ대한통운": "1",
  "우체국": "2",
  "한진택배": "3",
  "로젠택배": "6",
  "롯데택배": "8",
};

// ===== KST 기준 deadline 계산 (현재 시각 + 24시간) =====
function getDeadlineKST(): string {
  const now = new Date();
  const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  // KST = UTC+9
  const kst = new Date(deadline.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const h = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

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
      // 운송장번호에서 하이픈/공백 등 제거 (CJ 조회는 숫자만 인식). 표시용 줄은 원본 유지.
      const trackingNoDigits = String(data.tracking_number ?? "").replace(/[^0-9]/g, "");
      const trackingUrl = `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNoDigits}`;
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

    case "correction_start_reminder":
      return [
        "이온토플 - 스라첨삭 시작 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "",
        `신청하신 스라첨삭이 ${data.start_date}부터 시작됩니다.`,
        "",
        "아래 버튼에서 진행방법과 일정을 반드시 확인해주세요.",
        "이용방법을 모르면 절대로 첨삭을 따라오실 수 없습니다.",
      ].join("\n");

    case "correction_feedback_1": {
      const deadline = getDeadlineKST();
      return [
        "이온토플 - 1차 첨삭 완료 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        `제출하신 ${data.round} 과제의 1차 첨삭이 완료되었습니다.`,
        "피드백을 꼼꼼히 읽고 수정본을 제출해주세요.",
        "",
        `⏰ 수정본 마감: ${deadline}`,
        "",
        "*마감 기한을 넘기면 해당 회차는 자동 종료됩니다.",
      ].join("\n");
    }

    case "correction_feedback_2":
      return [
        "이온토플 - 최종 첨삭 완료 안내",
        "",
        `${data.name}님, 안녕하세요.`,
        "이온토플입니다.",
        "",
        `제출하신 ${data.round} 과제의 최종 첨삭이 완료되었습니다.`,
        "최종 점수와 모범 답안을 확인해보세요.",
      ].join("\n");

    case "incentive_analysis_complete":
      return [
        "이온토플 - 개별분석 & 입문서 전송 완료 안내",
        "",
        `${data.name}님, 안녕하세요!`,
        "",
        "요청하신 개별분석을 올려드렸어요 :)",
        "아래 링크에서 분석 결과를 확인하실 수 있습니다.",
        "",
        "입문서는 공홈 로그인 후 우측 상단 이름 클릭 > 내 대시보드에서 확인 가능합니다.",
        "",
        "[안내]",
        "- 5일 이내 동의 시 할인 적용된 금액으로 진행됩니다.",
        "- 할인은 본 안내일로부터 5일간만 유효하며, 이후 재신청 시 적용 불가합니다.",
        "- 5일 내 미동의 시, 이후 5일간 신청서 제출이 제한됩니다.",
        "",
        "궁금한 점은 편하게 문의해주세요 !",
      ].join("\n");

    case "incentive_deadline_warning": {
      const hoursLeft = (data.time as string) || "6";
      return [
        "이온토플 - 개별분석 동의 마감 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        "",
        `요청하신 개별분석의 동의 가능 기간이 ${hoursLeft}시간 후 에 만료됩니다.`,
        "만료 전에 분석 결과를 확인하시고 동의 여부를 결정해주세요!",
      ].join("\n");
    }

    case "analysis_updated":
      return [
        "이온토플 - 개별분석 수정 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        "",
        "앞서 보내드린 개별분석에 수정할 부분이 있어서 내용을 보완해 다시 올려드렸어요!",
        "",
        "시간 되실 때 아래 링크에서 한 번 확인 부탁드려요 :)",
      ].join("\n");

    case "analysis_registered":
      return [
        "이온토플 - 개별분석 등록 안내",
        "",
        `${data.name}님, 안녕하세요!`,
        "",
        "요청해주신 개별분석이 등록되었습니다.",
        "",
        "다만 바로 승인해드리기에는 확인이 필요한 부분이 있어, 해당 내용을 함께 담아두었어요.",
        "",
        "아래 버튼을 눌러 내용을 확인해주세요 :)",
      ].join("\n");

    case "contract_deferred":
      return [
        "이온토플 - 진행 연기 안내",
        "",
        `${data.name}님, 안녕하세요!`,
        "",
        `요청하신 대로 ${data.program}에 대한 신청 진행이 연기되었습니다 :)`,
        "",
        `계약서 동의 및 입금 등은 ${data.deadline}까지 천천히 진행해주시면 됩니다!`,
        "",
        "기한이 도래하면 다시 안내 드릴게요!",
      ].join("\n");

    case "contract_deferral_reminder":
      return [
        "이온토플 - 계약서 동의 마감 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        "",
        `계약서 동의 기한이 내일(${data.deadline})까지입니다.`,
        "만료 전에 아래 링크에서 계약 내용을 확인하시고 동의해주세요!",
        "",
        link,
      ].join("\n");

    case "weekly_check_registered":
      return [
        "이온토플 - 주간체크 등록 안내",
        "",
        `${data.name}님, 안녕하세요!`,
        "",
        `진행 중인 내벨업챌린지의 ${data.week}주차 주간체크가 등록되었습니다.`,
        "",
        "아래 버튼을 눌러 이번 주 체크 내용을 확인해주세요 :)",
      ].join("\n");

    case "practice_open":
      return [
        "이온토플 - 연습코스 오픈 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        "",
        "내벨업챌린지 일정이 마무리되어 연습코스가 활성화되었습니다.",
        "",
        "연습코스는 내벨업챌린지와 동일한 구조로 구성된 60세트이며, 문제는 모두 새로운 문항입니다.",
        "",
        "별도의 인증 절차는 없으며, 자유롭게 이용하실 수 있습니다.",
        "",
        "테스트룸 탭에서 확인해주세요.",
      ].join("\n");

    case "toefl_exam_day":
      return [
        `이온토플 - ${data.exam_datetime} 시험 관련 안내`,
        "",
        `${data.name}님, 오늘 시험 보시느라 고생 많으셨습니다.`,
        "",
        "▶ 오늘 시험에 대한 피드백을 위해 아래 내용을 지금 회신해주세요.",
        "1. 리딩·리스닝 unofficial 점수를 알려주세요.",
        "2. email, discussion, interview에서 어떤 주제가 나왔고 어떻게 답변하셨는지 알려주세요. ",
        "기억은 하루가 지나면 흐려집니다. 오늘이 가장 정확합니다.",
        "※ 이 채팅방에 그대로 답장해주시면 됩니다.",
        "",
        "또한, 오늘 응시한 시험에 대한 간단한 리포트(10초)에 참여해주세요.",
      ].join("\n");

    case "analysis_agree_reminder":
      return [
        "이온토플 - 개별분석 동의 마감 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        "",
        `요청하신 개별분석 동의 마감까지 ${data.time}시간 남았어요. (${data.deadline}까지)`,
        "",
        "아래 링크에서 분석 결과 확인하시고 동의 여부 결정해주세요.",
        "기한이 지나면 이 분석 건은 만료되고, 이후 5일간은 재신청이 불가해요.",
      ].join("\n");

    case "contract_agree_reminder":
      return [
        "이온토플 - 계약서 동의 마감 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        "",
        `${data.program} 계약서 동의 마감까지 ${data.time}시간 남았어요. (${data.deadline}까지)`,
        "",
        "아래 링크에서 계약 내용 확인하시고 동의해주세요.",
        "기한이 지나면 지금까지 진행된 신청은 자동 취소되어, 처음부터 다시 접수하셔야 해요.",
      ].join("\n");

    case "deposit_reminder": {
      const rawPrice = String(data.price ?? "0").replace(/[^\d.]/g, "");
      const price = rawPrice ? Number(rawPrice).toLocaleString() : "0";
      return [
        "이온토플 - 입금 마감 안내",
        "",
        `${data.name}님, 안녕하세요 :)`,
        `${data.program} 입금 마감까지 ${data.time}시간 남았어요. (${data.deadline}까지)`,
        "",
        `- ${DEPOSIT_BANK} ${DEPOSIT_ACCOUNT} (${DEPOSIT_HOLDER}) / ${price}원`,
        "",
        "기한이 지나면 지금까지 진행된 신청은 자동 취소되어, 처음부터 다시 접수하셔야 해요.",
        "입금이 확인되면 바로 다음 단계 안내드릴게요!",
        "",
        "입금을 마치신 후, 아래 버튼을 눌러 입금 완료를 알려주세요.",
      ].join("\n");
    }

    default:
      return "";
  }
}

// ===== SMS 대체 문구 생성 =====
function buildSmsContent(type: string, data: Record<string, unknown> = {}): string {
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
    case "correction_start_reminder":
      return "[이온토플] 내일부터 스라첨삭이 시작됩니다! 테스트룸을 확인해주세요.";
    case "correction_feedback_1":
      return "[이온토플] 1차 첨삭이 완료되었습니다. 피드백 확인 후 수정본을 제출해주세요. https://testroom.eonfl.com";
    case "correction_feedback_2":
      return "[이온토플] 최종 첨삭이 완료되었습니다. 최종 점수와 모범 답안을 확인해보세요. https://testroom.eonfl.com";
    case "incentive_analysis_complete":
      return "[이온토플] 요청하신 개별분석이 등록되었습니다. 5일 이내 확인 후 동의 부탁드려요.";
    case "incentive_deadline_warning":
      return "[이온토플] 개별분석 동의 마감이 6시간 남았습니다. 만료 전에 확인 부탁드려요.";
    case "analysis_updated":
      return "[이온토플] 개별분석이 수정되었습니다. 확인 부탁드려요.";
    case "analysis_registered":
      return "[이온토플] 확인이 필요한 부분이 있으니 개별분석 내용 확인 부탁드려요 :)";
    case "contract_deferred":
      return "[이온토플] 신청 진행이 연기되었습니다. 기한 내 진행 부탁드려요.";
    case "contract_deferral_reminder":
      return "[이온토플] 계약서 동의 마감이 내일까지입니다. 확인 부탁드려요.";
    case "weekly_check_registered":
      return "[이온토플] 주간체크가 등록되었습니다. 확인해주세요. https://testroom.eonfl.com";
    case "practice_open":
      return "[이온토플] 연습코스가 활성화되었습니다. 테스트룸에서 자유롭게 이용해주세요. https://testroom.eonfl.com";
    case "analysis_agree_reminder":
      return `[이온토플] 개별분석 동의 기한이 ${data.time}시간 남았어요. 만료 시 5일간 재신청이 불가해요.`;
    case "contract_agree_reminder":
      return `[이온토플] 계약서 동의 기한이 ${data.time}시간 남았어요. 미동의 시 신청이 자동취소돼요.`;
    case "deposit_reminder":
      return `[이온토플] 입금 기한 ${data.deadline}까지(${data.time}시간 남음). 미입금 시 신청이 자동취소돼요.`;
    case "toefl_exam_day":
      return "[이온토플] 오늘 시험 고생하셨습니다. 리딩·리스닝 점수와 출제 내용을 카톡으로 알려주시면 피드백 드릴게요. 시험 리포트도 참여 부탁드려요 https://eonfl.com/survey.html";
    default:
      return "[이온토플] 알림이 도착했습니다.";
  }
}

// ===== 버튼 URL 결정 =====
function getBtnUrl(type: string, data: Record<string, unknown>): string {
  if (type === "shipping_sent") {
    const trackingNoDigits = String(data.tracking_number ?? "").replace(/[^0-9]/g, "");
    return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNoDigits}`;
  }
  if (type === "correction_start_reminder") {
    return `${SITE_URL}/my-dashboard.html`;
  }
  if (type === "correction_feedback_1" || type === "correction_feedback_2" || type === "weekly_check_registered" || type === "practice_open") {
    return TESTROOM_URL;
  }
  // 시험 직후 리포트 설문 — 학생별 파라미터 없이 고정 링크
  if (type === "toefl_exam_day") {
    return `${SITE_URL}/survey.html`;
  }
  return `${SITE_URL}/application-detail.html?id=${data.app_id}`;
}

// ===== 버튼 없는 템플릿 여부 =====
function hasNoButton(templateId: number): boolean {
  return templateId === TEMPLATE_IDS.payment_confirmed
      || templateId === TEMPLATE_IDS.contract_deferred;
}

// ===== 단건 메시지 객체 생성 =====
function buildMessageObject(
  phone: string,
  msgContent: string,
  smsContent: string,
  btnUrl: string,
  templateId: number,
  data: Record<string, unknown>,
  no: string = "0",
): Record<string, unknown> {
  const message: Record<string, unknown> = {
    no,
    tel_num: phone.replace(/-/g, ""),
    msg_content: msgContent,
    sms_content: smsContent,
    use_sms: "1",
  };

  if (!hasNoButton(templateId)) {
    message.btn_url = [{ url_pc: btnUrl, url_mobile: btnUrl }];
  }

  if (templateId === TEMPLATE_IDS.shipping_sent) {
    const courierName = (data.courier as string) || "CJ대한통운";
    message.carrier_code = CARRIER_CODES[courierName] || "1";
    message.invoice_number = String(data.tracking_number ?? "").replace(/[^0-9]/g, "");
  }

  return message;
}

// ===== LunaSoft API 호출 (단건) =====
async function sendLunaSoftAlimTalk(
  templateId: number,
  phone: string,
  msgContent: string,
  smsContent: string,
  btnUrl: string,
  data: Record<string, unknown>,
) {
  const message = buildMessageObject(phone, msgContent, smsContent, btnUrl, templateId, data);

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

// ===== LunaSoft API 호출 (일괄 — messages 배열) =====
async function sendLunaSoftAlimTalkBulk(
  templateId: number,
  messages: Record<string, unknown>[],
) {
  const requestBody = {
    userid: LUNASOFT_USERID,
    api_key: LUNASOFT_API_KEY,
    template_id: templateId,
    messages,
  };

  console.log("LunaSoft API bulk request:", JSON.stringify({
    template_id: templateId,
    count: messages.length,
  }));

  const resp = await fetch("https://jupiter.lunasoft.co.kr/api/AlimTalk/message/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const result = await resp.json();
  console.log("LunaSoft API bulk response:", JSON.stringify(result));
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

    // ===== 일괄 발송 모드 (bulk) =====
    if (body.bulk && Array.isArray(body.items)) {
      return await handleBulkSend(body, corsHeaders);
    }

    // ===== 단건 발송 모드 =====
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
    const smsContent = buildSmsContent(type, data);
    const btnUrl = getBtnUrl(type, data);

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

// ===== 일괄 발송 핸들러 =====
async function handleBulkSend(
  body: { items: Array<{ type: string; data: Record<string, unknown> }> },
  corsHeaders: Record<string, string>,
) {
  const { items } = body;

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: "No items provided" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 템플릿별로 그룹핑 (LunaSoft API는 요청당 1개 template_id)
  const grouped: Record<number, { messages: Record<string, unknown>[]; logEntries: Record<string, unknown>[] }> = {};

  for (let i = 0; i < items.length; i++) {
    const { type, data } = items[i];
    const templateId = TEMPLATE_IDS[type];
    if (!templateId || !data.phone) continue;

    const msgContent = buildMsgContent(type, data);
    const smsContent = buildSmsContent(type, data);
    const btnUrl = getBtnUrl(type, data);

    const message = buildMessageObject(
      data.phone as string,
      msgContent,
      smsContent,
      btnUrl,
      templateId,
      data,
      String(i),
    );

    if (!grouped[templateId]) {
      grouped[templateId] = { messages: [], logEntries: [] };
    }
    grouped[templateId].messages.push(message);
    grouped[templateId].logEntries.push({
      application_id: data.app_id || null,
      student_name: data.name || null,
      phone: (data.phone as string).replace(/-/g, ""),
      template_type: type,
      template_id: templateId,
      msg_content: msgContent,
      sms_content: smsContent,
    });
  }

  // 템플릿별로 API 호출
  let totalSuccess = 0;
  let totalFail = 0;
  const results: Record<string, unknown>[] = [];

  for (const [tidStr, group] of Object.entries(grouped)) {
    const tid = Number(tidStr);
    try {
      const result = await sendLunaSoftAlimTalkBulk(tid, group.messages);
      const isSuccess = result.code === 0;

      // 각 메시지별 로그 기록
      const now = new Date().toISOString();
      for (let i = 0; i < group.logEntries.length; i++) {
        const msgResult = result.messages?.[i];
        const msgSuccess = isSuccess && (!msgResult || msgResult.result_code === "0" || msgResult.result_code === 0);
        if (msgSuccess) totalSuccess++;
        else totalFail++;

        await logToDatabase({
          ...group.logEntries[i],
          status: msgSuccess ? "sent" : "failed",
          response_code: result.code,
          response_msg: msgResult?.result_msg || result.msg || null,
          sent_at: msgSuccess ? now : null,
        });
      }

      results.push({ template_id: tid, code: result.code, count: group.messages.length });
    } catch (err) {
      console.error(`Bulk send failed for template ${tid}:`, err);
      totalFail += group.messages.length;

      for (const entry of group.logEntries) {
        await logToDatabase({
          ...entry,
          status: "failed",
          response_code: -1,
          response_msg: err.message,
        });
      }

      results.push({ template_id: tid, error: err.message, count: group.messages.length });
    }
  }

  return new Response(
    JSON.stringify({
      success: totalFail === 0,
      total: items.length,
      sent: totalSuccess,
      failed: totalFail,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
