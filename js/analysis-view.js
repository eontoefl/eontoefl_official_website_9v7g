// Analysis View JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // 로그인 체크
    const userData = JSON.parse(localStorage.getItem('iontoefl_user'));
    if (!userData) {
        // 미로그인 → 로그인 페이지로 (현재 URL을 redirect 파라미터로 전달)
        const currentUrl = encodeURIComponent(window.location.href);
        window.location.href = `login.html?redirect=${currentUrl}`;
        return;
    }
    loadAnalysis();
});

// 개별분석지 로드
async function loadAnalysis() {
    const urlParams = new URLSearchParams(window.location.search);
    const applicationId = urlParams.get('id');
    
    if (!applicationId) {
        showError();
        return;
    }
    
    try {
        const application = await supabaseAPI.getById('applications', applicationId);
        
        if (!application) {
            showError();
            return;
        }
        
        // 권한 체크: 본인 신청서이거나 관리자만 열람 가능
        const userData = JSON.parse(localStorage.getItem('iontoefl_user'));
        if (userData.role !== 'admin' && userData.email !== application.email && userData.email !== application.user_email) {
            showError('이 분석지를 열람할 권한이 없습니다.');
            return;
        }
        
        // 개별분석이 완료되지 않은 경우
        if (!application.analysis_status || application.analysis_status === 'pending') {
            showError('아직 분석이 완료되지 않았습니다.');
            return;
        }
        
        // 개별분석지 표시
        displayAnalysis(application);
        
    } catch (error) {
        console.error('Failed to load analysis:', error);
        showError();
    }
}

// 개별분석지 표시
function displayAnalysis(app) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('analysisContent').style.display = 'block';
    
    const statusClass = app.analysis_status === '승인' ? 'approved' : 
                        app.analysis_status === '조건부승인' ? 'conditional' : 'rejected';
    
    const statusText = app.analysis_status === '승인' ? '✅ 합격 - 승인되었습니다!' : 
                       app.analysis_status === '조건부승인' ? '⚠️ 조건부 합격' : 
                       '❌ 불합격';
    
    const programInfo = app.assigned_program ? `
        <div class="analysis-section">
            <div class="section-title">
                <i class="fas fa-graduation-cap"></i>
                배정 프로그램 정보
            </div>
            <div class="info-row">
                <div class="info-label">프로그램명</div>
                <div class="info-value" style="color: #9480c5; font-size: 16px;">
                    ${escapeHtml(app.assigned_program)}
                </div>
            </div>
            ${app.schedule_start ? `
                <div class="info-row">
                    <div class="info-label">시작일</div>
                    <div class="info-value">${formatDateOnly(new Date(app.schedule_start).getTime())}</div>
                </div>
            ` : ''}
            ${app.schedule_end ? `
                <div class="info-row">
                    <div class="info-label">종료일</div>
                    <div class="info-value">${formatDateOnly(new Date(app.schedule_end).getTime())}</div>
                </div>
            ` : ''}
            ${app.program_price ? `
                <div class="info-row">
                    <div class="info-label">정가</div>
                    <div class="info-value">${formatPrice(app.program_price)}</div>
                </div>
            ` : ''}
            ${app.discount_amount ? `
                <div class="info-row">
                    <div class="info-label">시험료 지원</div>
                    <div class="info-value" style="color: #22c55e;">-${formatPrice(app.discount_amount)}</div>
                </div>
            ` : ''}
            ${app.correction_enabled && app.correction_fee ? `
                <div class="info-row">
                    <div class="info-label">스라첨삭</div>
                    <div class="info-value" style="color: #3b82f6;">+${formatPrice(app.correction_fee)}</div>
                </div>
            ` : ''}
            <div class="info-row">
                <div class="info-label">이용가</div>
                <div class="info-value">${formatPrice((app.program_price || 1000000) - (app.discount_amount || 210000) + (app.correction_fee || 0))}</div>
            </div>
            ${app.additional_discount ? `
                <div class="info-row">
                    <div class="info-label">추가 할인</div>
                    <div class="info-value" style="color: #ef4444;">-${formatPrice(app.additional_discount)}</div>
                </div>
            ` : ''}
            ${app.discount_reason ? `
                <div class="info-row">
                    <div class="info-label">할인 사유</div>
                    <div class="info-value" style="font-size: 13px;">${escapeHtml(app.discount_reason)}</div>
                </div>
            ` : ''}
            <div class="info-row">
                <div class="info-label">보증금</div>
                <div class="info-value" style="color: #3b82f6;">+${formatPrice(100000)}</div>
            </div>
            ${app.final_price ? `
                <div class="info-row price-total">
                    <div class="info-label">최종 입금금액</div>
                    <div class="info-value" style="font-weight: 700; font-size: 18px; color: #92400e;">${formatPrice(app.final_price)}</div>
                </div>
            ` : ''}
        </div>
    ` : '';
    
    const analysisContent = app.analysis_content ? `
        <div class="analysis-section">
            <div class="section-title">
                <i class="fas fa-file-alt"></i>
                개별 분석 내용
            </div>
            <div class="section-content">
                ${escapeHtml(app.analysis_content)}
            </div>
        </div>
    ` : '';
    
    // 동의가 필요한 경우 (승인 또는 조건부 승인 + 아직 동의 안 함)
    const needsAgreement = (app.analysis_status === '승인' || app.analysis_status === '조건부승인') 
                          && !app.student_program_agreed;
    
    const isIncentive = app.is_incentive_applicant === true;
    const deadlineLabel = isIncentive ? '5일' : '24시간';
    
    // 안내 문구: 유도학생은 입문서 + 할인/재신청 제한 안내 포함, 일반학생은 기본 문구
    let guideText;
    if (isIncentive) {
        guideText = '개별분석 결과와 입문서를 꼼꼼히 읽어보신 후, <strong>5일 이내</strong>에 동의해주세요.'
            + '<div style="margin-top: 10px; padding: 10px 12px; background: rgba(255,255,255,0.7); border-radius: 8px; font-size: 12px; line-height: 1.7; color: #92400e;">'
            + '<div style="margin-bottom: 4px;"><i class="fas fa-tag" style="margin-right: 4px;"></i> 프로모션 할인은 이 <strong>5일</strong> 기간에만 유효합니다. 기간 만료 후 재신청 시 할인이 적용되지 않습니다.</div>'
            + '<div><i class="fas fa-ban" style="margin-right: 4px;"></i> 5일 내 미동의 시 신청이 자동 취소되며, 이후 <strong>5일간 새로운 신청서를 제출할 수 없습니다.</strong></div>'
            + '</div>';
    } else {
        guideText = '개별분석 결과를 확인하신 후, <strong>24시간 이내</strong>에 동의해주세요.';
    }
    
    // 타이머 초기값 계산
    const viewAnalysisTs = app.analysis_completed_at || app.analysis_saved_at;
    const viewDeadlineMs = isIncentive ? (5 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const viewElapsedMs = viewAnalysisTs ? (Date.now() - new Date(viewAnalysisTs).getTime()) : 0;
    const viewRemainingMs = viewDeadlineMs - viewElapsedMs;
    const viewInitialCountdown = formatViewCountdown(viewRemainingMs, isIncentive);
    const viewUrgentThreshold = isIncentive ? (24 * 60 * 60 * 1000) : (6 * 60 * 60 * 1000);
    const viewIsExpired = viewRemainingMs <= 0;
    const viewIsUrgent = !viewIsExpired && viewRemainingMs <= viewUrgentThreshold;
    
    // 타이머 색상
    let viewTimerColor, viewTimerBorderColor;
    if (viewIsExpired) {
        viewTimerColor = '#dc2626'; viewTimerBorderColor = '#ef4444';
    } else if (viewIsUrgent) {
        viewTimerColor = '#dc2626'; viewTimerBorderColor = '#fca5a5';
    } else {
        viewTimerColor = '#92400e'; viewTimerBorderColor = '#f59e0b';
    }
    
    // 만료/긴급 메시지
    const viewExpiredMsg = viewIsExpired
        ? `<div style="font-size: 12px; color: #dc2626; margin-top: 6px; font-weight: 600;"><i class="fas fa-exclamation-triangle"></i> 시간이 초과되었습니다. 관리자에게 문의해주세요.</div>`
        : (viewIsUrgent ? `<div id="viewCountdownMsg" style="font-size: 12px; color: #dc2626; margin-top: 6px; font-weight: 600;"><i class="fas fa-exclamation-circle"></i> 동의 기한이 얼마 남지 않았습니다!</div>` : '');
    
    // 인라인 타이머 HTML
    const viewInlineTimer = viewAnalysisTs ? `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px;">
            <i class="fas fa-clock" style="font-size: 16px; color: ${viewTimerColor};"></i>
            <div style="background: white; padding: 6px 14px; border-radius: 8px; border: 2px solid ${viewTimerBorderColor};">
                <span id="viewCountdownTimer" style="font-size: 18px; font-weight: 700; color: ${viewTimerColor}; font-variant-numeric: tabular-nums;">${viewInitialCountdown}</span>
            </div>
            <span style="font-size: 13px; color: ${viewTimerColor}; font-weight: 600;">남음</span>
        </div>
        ${viewExpiredMsg}
    ` : '';
    
    // 만료 시 → 따뜻한 안내 + 카톡 버튼 (동의 폼 숨김)
    // 미만료 시 → 기존 동의 폼
    let agreementSection = '';
    if (needsAgreement && viewIsExpired) {
        agreementSection = `
        <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 16px; padding: 32px 24px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 16px;">⏰</div>
            <h3 style="font-size: 20px; font-weight: 700; color: #334155; margin-bottom: 12px;">동의 기간이 마감되었어요</h3>
            <p style="font-size: 14px; color: #64748b; line-height: 1.8; margin-bottom: 8px;">
                아쉽지만 동의 가능한 기간(${deadlineLabel})이 지났어요.
            </p>
            <p style="font-size: 14px; color: #64748b; line-height: 1.8; margin-bottom: 24px;">
                아직 고민 중이시라면 걱정 마세요!<br>
                카카오톡으로 편하게 연락 주시면, 다시 함께 방법을 찾아볼게요.
            </p>
            <a href="http://pf.kakao.com/_FWxcZC" target="_blank"
               style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 32px; background: #FEE500; color: #3C1E1E; border: none; border-radius: 12px; font-size: 15px; font-weight: 700; text-decoration: none; box-shadow: 0 4px 12px rgba(254, 229, 0, 0.4); transition: all 0.2s;"
               onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(254,229,0,0.5)'"
               onmouseout="this.style.transform=''; this.style.boxShadow='0 4px 12px rgba(254,229,0,0.4)'">
                <i class="fas fa-comment" style="font-size: 18px;"></i> 카카오톡 문의하기
            </a>
        </div>
        `;
    } else if (needsAgreement) {
        agreementSection = `
        <div class="agreement-section">
            <div class="agreement-title">
                <i class="fas fa-exclamation-circle"></i>
                프로그램 동의 (필수)
            </div>
            
            <div id="viewCountdownContainer" style="padding: 16px; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; margin-bottom: 20px;">
                <div style="font-size: 14px; font-weight: 700; color: #92400e; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <i class="fas fa-clipboard-list" style="color: #d97706;"></i> 동의 안내
                </div>
                <div style="font-size: 13px; color: #92400e; line-height: 1.6;">
                    ${guideText}
                </div>
                ${viewInlineTimer}
            </div>
            
            <div class="agreement-checkbox">
                <input type="checkbox" id="agreeProgram">
                <label for="agreeProgram">
                    <strong>프로그램명, 시작일, 가격에 동의합니다.</strong><br>
                    <span style="font-size: 13px; color: #64748b;">
                        배정된 프로그램 정보를 확인했으며, 해당 내용에 동의합니다.
                    </span>
                </label>
            </div>
            
            <div class="agreement-checkbox">
                <input type="checkbox" id="agreeSchedule">
                <label for="agreeSchedule">
                    <strong>일정에 동의합니다.</strong><br>
                    <span style="font-size: 13px; color: #64748b;">
                        시작일과 종료일을 확인했으며, 해당 일정에 참여할 수 있습니다.
                    </span>
                </label>
            </div>
            
            <button class="submit-button" id="submitAgreement" disabled>
                <i class="fas fa-check-circle"></i> 동의하고 다음 단계로
            </button>
        </div>
        `;
    }
    
    const alreadyAgreedMessage = app.student_program_agreed ? `
        <div class="analysis-section" style="background: #dcfce7; border: 2px solid #22c55e;">
            <div style="text-align: center;">
                <i class="fas fa-check-circle" style="font-size: 48px; color: #22c55e; margin-bottom: 16px;"></i>
                <h3 style="font-size: 18px; font-weight: 700; color: #166534; margin-bottom: 8px;">동의 완료</h3>
                <p style="font-size: 14px; color: #166534;">
                    프로그램 동의가 완료되었습니다.<br>
                    ${app.student_agreed_at ? `(동의일: ${formatDateTime(app.student_agreed_at)})` : ''}
                </p>
                <p style="font-size: 13px; color: #166534; margin-top: 12px;">
                    다음 단계 진행을 위해 관리자가 연락드릴 예정입니다.
                </p>
            </div>
        </div>
    ` : '';
    
    const html = `
        <div class="analysis-header">
            <div class="analysis-title">개별분석 결과</div>
            <div class="analysis-date">
                ${escapeHtml(app.name)} 님의 개별분석지
                ${(app.analysis_completed_at || app.analysis_saved_at) ? ` · ${formatDateTime(app.analysis_completed_at || app.analysis_saved_at)}` : ''}
            </div>
        </div>
        
        <div class="analysis-status status-${statusClass}">
            ${statusText}
        </div>
        
        ${programInfo}
        ${analysisContent}
        ${alreadyAgreedMessage}
        ${agreementSection}
    `;
    
    document.getElementById('analysisContent').innerHTML = html;
    
    // 동의 체크박스 이벤트
    if (needsAgreement) {
        const agreeProgram = document.getElementById('agreeProgram');
        const agreeSchedule = document.getElementById('agreeSchedule');
        const submitBtn = document.getElementById('submitAgreement');
        
        function updateSubmitButton() {
            submitBtn.disabled = !(agreeProgram.checked && agreeSchedule.checked);
        }
        
        agreeProgram.addEventListener('change', updateSubmitButton);
        agreeSchedule.addEventListener('change', updateSubmitButton);
        
        submitBtn.addEventListener('click', () => submitAgreement(app.id));
        
        // 실시간 카운트다운 시작
        const viewAnalysisTs = app.analysis_completed_at || app.analysis_saved_at;
        if (viewAnalysisTs) {
            startViewCountdown(viewAnalysisTs, app.is_incentive_applicant === true);
        }
    }
}

// 남은 시간 포맷팅: 일반 24:00:00 / 유도 4일 12:00:00
function formatViewCountdown(remainingMs, isIncentive) {
    if (remainingMs <= 0) return '00:00:00';
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    if (isIncentive) {
        return `${days}일 ${hh}:${mm}:${ss}`;
    }
    return `${hh}:${mm}:${ss}`;
}

// 실시간 카운트다운 인터벌 관리
let viewCountdownInterval = null;

function startViewCountdown(completedAt, isIncentive) {
    if (viewCountdownInterval) clearInterval(viewCountdownInterval);
    
    const deadlineMs = isIncentive ? (5 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const completedTime = new Date(completedAt).getTime();
    const urgentThresholdMs = isIncentive ? (24 * 60 * 60 * 1000) : (6 * 60 * 60 * 1000);
    
    function tick() {
        const remaining = deadlineMs - (Date.now() - completedTime);
        const el = document.getElementById('viewCountdownTimer');
        const containerEl = document.getElementById('viewCountdownContainer');
        if (!el || !containerEl) { clearInterval(viewCountdownInterval); return; }
        
        if (remaining <= 0) {
            clearInterval(viewCountdownInterval);
            // 동의 섹션 전체를 따뜻한 만료 안내로 교체
            const agreementEl = containerEl.closest('.agreement-section');
            if (agreementEl) {
                const dlLabel = isIncentive ? '5일' : '24시간';
                agreementEl.outerHTML = `
                <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 16px; padding: 32px 24px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 16px;">⏰</div>
                    <h3 style="font-size: 20px; font-weight: 700; color: #334155; margin-bottom: 12px;">동의 기간이 마감되었어요</h3>
                    <p style="font-size: 14px; color: #64748b; line-height: 1.8; margin-bottom: 8px;">
                        아쉽지만 동의 가능한 기간(${dlLabel})이 지났어요.
                    </p>
                    <p style="font-size: 14px; color: #64748b; line-height: 1.8; margin-bottom: 24px;">
                        아직 고민 중이시라면 걱정 마세요!<br>
                        카카오톡으로 편하게 연락 주시면, 다시 함께 방법을 찾아볼게요.
                    </p>
                    <a href="http://pf.kakao.com/_FWxcZC" target="_blank"
                       style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 32px; background: #FEE500; color: #3C1E1E; border: none; border-radius: 12px; font-size: 15px; font-weight: 700; text-decoration: none; box-shadow: 0 4px 12px rgba(254, 229, 0, 0.4);">
                        <i class="fas fa-comment" style="font-size: 18px;"></i> 카카오톡 문의하기
                    </a>
                </div>`;
            }
            return;
        }
        
        el.textContent = formatViewCountdown(remaining, isIncentive);
        
        // 긴급 시 타이머만 빨간색으로
        if (remaining <= urgentThresholdMs) {
            el.style.color = '#dc2626';
            const msgEl = document.getElementById('viewCountdownMsg');
            if (msgEl) {
                msgEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> 동의 기한이 얼마 남지 않았습니다!';
                msgEl.style.color = '#dc2626';
            }
        }
    }
    
    tick();
    viewCountdownInterval = setInterval(tick, 1000);
}

// 동의 제출
async function submitAgreement(applicationId) {
    const submitBtn = document.getElementById('submitAgreement');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';
    
    try {
        const result = await supabaseAPI.patch('applications', applicationId, {
                student_program_agreed: true,
                student_schedule_agreed: true,
                student_agreed_at: new Date().toISOString(),
                current_step: 3
        });
        
        if (!result) {
            throw new Error('Failed to submit agreement');
        }
        
        // 성공 메시지
        alert('✅ 동의가 완료되었습니다!\n\n다음 단계 진행을 위해 관리자가 곧 연락드리겠습니다.');
        
        // 페이지 새로고침
        location.reload();
        
    } catch (error) {
        console.error('Failed to submit agreement:', error);
        alert('❌ 동의 처리에 실패했습니다.\n\n다시 시도해주세요.');
        
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> 동의하고 다음 단계로';
    }
}

// 에러 표시
function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
    
    if (message) {
        document.querySelector('#errorMessage p').textContent = message;
    }
}

// 날짜 포맷 (날짜만)
function formatDateOnly(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
}

// 날짜 포맷 (날짜 + 시간)
function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hours}:${minutes}`;
}

// 가격 포맷
function formatPrice(price) {
    return `${Number(price).toLocaleString('ko-KR')}원`;
}

// HTML 이스케이프
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
