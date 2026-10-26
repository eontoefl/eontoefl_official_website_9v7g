/**
 * ================================================
 * restart-shared.js — 재시작(수강 2) 공용 (2026-10-16)
 * ================================================
 * 학생 화면(대시보드·신청 상세·개별분석 보기)과 관리자 화면(관리창·계약서 설정)이 같이 쓰는 것만 둔다.
 *   - RESTART_COPY: 재시작 카드·신청서 띠·가격 박스 문구 (대표 확정 2026-10-16)
 *   - RESTART_MATERIALS: 카드에서 체크하는 실물 교재 목록 (대표 확정 2026-10-16: 단어장 · 빈 노트테이킹)
 *   - contractTypeForApp / contractTypeLabel: 계약서 종류 4개 (nevelup · correction · restart · restart_correction)
 *   - getRestartPricingBox: 수강 2용 "이용가 및 할인 내역" 박스
 */

// 대표 확정 문구(2026-10-16). 톤: 책망 없음, 기존 수강생 배려, '한 번 수강생은 영원한 수강생'.
const RESTART_COPY = {
    cardTitle: '한 번 수강생은 영원한 수강생이에요',
    cardBody: '갑작스러운 일정이나 사정으로 지난 수강을 끝까지 못 가셨어도 괜찮아요. 그럴 수 있어요. 그래서 기존 수강생께만, 딱 한 번 다시 시작할 기회를 열어 뒀어요. 수강료는 다시 받지 않을게요. 보증금 10만원만 새로 걸고 처음부터 같이 다시 가요.',
    cardMaterialsLabel: '실물 교재가 다시 필요하면 체크해 주세요 (없으면 그대로 두세요)',
    cardButton: '다시 시작 요청하기',
    cardRequested: '요청이 접수됐어요. 확인 후 카카오톡으로 안내드릴게요.',
    cardAllowed: '다시 시작이 열렸어요. 신청서를 새로 작성해 주세요.',
    cardAllowedButton: '신청서 작성하기',
    formBanner: '기존 수강생 재시작 신청서예요. 이름·이메일·연락처는 계정 정보라 그대로이고, 주소·환불 계좌는 지난 신청서 값이 미리 채워져 있어요(바뀌었으면 고쳐 주세요). 점수·목표·시험 일정·공부 시간·다짐은 지금 기준으로 새로 적어 주세요.',
    priceTitle: '기존 수강생 재시작 안내',
    priceIntro: '수강료(100만원)는 다시 받지 않아요. 한 번 수강생은 영원한 수강생이니까요. 보증금만 새로 걸고, 과정은 처음부터 다시 시작해요.',
    priceTuitionLabel: '수강료',
    priceExamLabel: '시험료 지원',
    priceExamNote: '시험료 지원 21만원도 그대로 드려요. 대신 조건도 새로 시작돼요 — 이번 수강 안에 실제 시험 2회 접수, 점수 인증, 후기 1회.',
    priceDepositNote: '지난 보증금은 환급 조건에 못 미쳐 소멸됐어요. 이번 보증금은 과제 인증률대로 다시 돌려드려요: 95% 이상 전액, 90% 이상 9만원, 80% 이상 8만원, 70% 이상 7만원, 70% 미만 0원.',
    priceCorrectionNew: '지난번에 첨삭 없이 하셨다면, 이번엔 라이팅·스피킹을 같이 잡는 걸 권해요.',
    priceCorrectionAgain: '지난 수강의 첨삭은 처음부터 다시 받아요(추가 비용 없음).',
    priceFinalNote: '추가 금액은 없고, 위 금액만 입금하시면 돼요.',
    // 재시작 신청서 화면(대표 확정 2026-10-17): 숨김·설명·불러오기
    formTitleDefault: '재시작 신청서 (수강 2)',
    formNoteScoreHistory: '지난 수강이 끝난 뒤에 본 시험이 있으면 그 시험 기준으로 적어 주세요. 없으면 가장 최근 시험이에요.',
    formNoteStudyMethod: '지난 수강이 끝난 뒤부터 지금까지 어떻게 공부했는지(안 했으면 \'쉬었음\'도 괜찮아요) 적어 주세요.',
    formNoteWriting: '지난번에 쓰셨더라도 지금 실력을 다시 보려는 거예요. 검색이나 수정 없이, 지금 바로 떠오르는 대로 써 주세요.',
    formNoteCorrection: '지난 수강에 첨삭이 없었다면 새로 신청(+200,000원), 있었다면 처음부터 다시 받는 데 추가 비용이 없어요. 최종 안내는 개별분석에서 드려요.',
    formNotePledge: '지난번에 끝까지 가지 못한 이유를 떠올려 보고 적어 주세요. 이번 계획을 짤 때 그대로 반영돼요.',
    formHistoryButton: '지난 기록 불러오기',
    formHistoryHint: '지난 신청서의 점수와 테스트룸에 등록한 실제 시험 성적을 아래 칸에 넣어 드려요. 그 뒤 상황만 덧붙여 주세요.',
    formHistoryPrev: '[지난 수강 신청 때 점수]',
    formHistoryActual: '[테스트룸에 등록한 실제 시험]',
    formHistoryNow: '[그 뒤 본 시험이나 지금 상황] ← 여기에 적어 주세요: 언제, 얼마나 준비해서, 어디가 어려웠는지'
};

// 대표 확정(2026-10-16): 다시 요청할 수 있는 실물 교재 2개
const RESTART_MATERIALS = ['단어장', '빈 노트테이킹'];

/** HTML 이스케이프 — 페이지마다 escapeHtml이 있을 수도 없을 수도 있어 여기서 하나 둔다 */
function restartEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));
}

function isRestartApp(app) {
    return !!app && Number(app.enrollment_no) >= 2;
}

/**
 * 수강 2 신청서가 삭제될 때(학생 상세·학생 목록·관리자 일괄 삭제) 수강 1에 붙은 "수강 2로 이어졌다" 표시를 지운다.
 * 안 지우면 카드도 안 뜨고 신청서도 못 써서 학생이 갇힌다(2026-10-17 대표 범위 추가).
 * 삭제가 성공한 뒤에 부른다. 실패해도 삭제 흐름은 막지 않는다.
 */
async function releaseRestartLink(deletedApp) {
    try {
        if (!deletedApp || !deletedApp.restart_of || typeof supabaseAPI === 'undefined') return false;
        await supabaseAPI.patch('applications', deletedApp.restart_of, { superseded_by: null });
        console.log('[restart] 수강 1 superseded_by 해제:', deletedApp.restart_of);
        return true;
    } catch (e) {
        console.warn('[restart] 수강 1 superseded_by 해제 실패(무시):', e);
        return false;
    }
}

/** 신청서 → 자동 발송·추천할 계약서 종류 */
function contractTypeForApp(app) {
    if (!app) return 'nevelup';
    if (isRestartApp(app)) return app.correction_enabled ? 'restart_correction' : 'restart';
    return app.correction_enabled ? 'correction' : 'nevelup';
}

function contractTypeLabel(type) {
    switch (type) {
        case 'correction': return '첨삭포함';
        case 'restart': return '재시작';
        case 'restart_correction': return '재시작+첨삭';
        default: return '내벨업챌린지';
    }
}

/** 수강 2 신청서용 가격 박스 — application-detail.js getPricingBox()와 같은 모양 */
function getRestartPricingBox(app, showPaymentNoticeArg) {
    const esc = restartEsc;
    const row = (label, value, valueColor = '#1e293b', strong = false) => `
        <div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0;">
            <span class="pb-label" style="color: #64748b; font-size: 13px;">${label}</span>
            <span class="pb-value" style="font-weight: ${strong ? 700 : 600}; color: ${valueColor}; font-size: 13px; text-align: right;">${value}</span>
        </div>`;
    const note = (text) => `
        <div style="padding: 0 0 8px 0;">
            <p class="pb-note" style="font-size: 10px; color: #94a3b8; line-height: 1.5; margin: 0;">${text}</p>
        </div>`;
    const corrFee = Number(app.correction_fee) || 0;
    const corrMode = app.correction_mode || (app.correction_enabled ? 'new' : 'none');
    const finalPrice = Number(app.final_price) || (100000 + corrFee);
    const showPaymentNotice = (showPaymentNoticeArg === undefined) ? !app.deposit_confirmed_by_admin : !!showPaymentNoticeArg;
    return `
        <style>
            @media (min-width: 768px) {
                .pb-title { font-size: 15px !important; }
                .pb-label { font-size: 14px !important; }
                .pb-value { font-size: 14px !important; }
                .pb-note { font-size: 11px !important; }
                .pb-final-label { font-size: 15px !important; }
                .pb-final-value { font-size: 22px !important; }
                .pb-info { font-size: 13px !important; }
            }
        </style>
        <div style="background:#ffffff; border-radius:16px; padding:24px 28px; box-shadow:0 2px 20px rgba(25,28,29,0.05); margin-bottom:14px;">
            <div style="font-size:15px; font-weight:700; color:#1e293b; letter-spacing:-0.01em; margin:0 0 6px 0; display:flex; align-items:center; gap:8px;"><i class="fas fa-receipt" style="font-size:13px; color:#9c8ea0;"></i> ${esc(RESTART_COPY.priceTitle)}</div>
            <p style="font-size:13px; color:#5b4a7d; line-height:1.7; margin:0 0 14px 0;">${esc(RESTART_COPY.priceIntro)}</p>

            ${row(esc(RESTART_COPY.priceTuitionLabel || '수강료'), '0원', '#2f855a')}
            ${row(esc(RESTART_COPY.priceExamLabel || '시험료 지원'), '-', '#2f855a')}
            ${note(esc(RESTART_COPY.priceExamNote))}
            ${app.correction_enabled ? row('스라첨삭 (Speaking &amp; Writing)', corrFee > 0 ? `+${corrFee.toLocaleString()}원` : '0원', '#5b4a7d') : ''}
            ${app.correction_enabled ? note(esc(corrMode === 'again' ? RESTART_COPY.priceCorrectionAgain : RESTART_COPY.priceCorrectionNew)) : ''}
            ${row('보증금 (환불)', '+100,000원', '#5b4a7d')}
            ${note(esc(RESTART_COPY.priceDepositNote))}

            <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 16px 18px; margin-top: 10px; background: #f3eef3; border-radius: 12px;">
                <span class="pb-final-label" style="color: #1e293b; font-size: 14px; font-weight: 700;">최종 입금금액</span>
                <span class="pb-final-value" style="font-weight: 700; color: #5b4a7d; font-size: 19px; letter-spacing: -0.02em;">${finalPrice.toLocaleString()}원</span>
            </div>
            <div style="padding: 14px 16px; background: #f6f8fa; border-radius: 10px; margin-top: 12px;">
                <p class="pb-info" style="font-size: 11px; color: #475569; line-height: 1.7; margin: 0;">
                    ✓ <strong>${esc(RESTART_COPY.priceFinalNote)}</strong>${showPaymentNotice ? '<br>✓ <strong>결제는 최종적으로 프로그램 및 가격, 계약서까지 동의 후 가장 마지막에 진행됩니다.</strong>' : ''}
                </p>
            </div>
        </div>
    `;
}
