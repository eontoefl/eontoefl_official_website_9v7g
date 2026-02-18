// Analysis View JavaScript
document.addEventListener('DOMContentLoaded', () => {
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
        const response = await fetch(`tables/applications/${applicationId}`);
        
        if (!response.ok) {
            showError();
            return;
        }
        
        const application = await response.json();
        
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
            <div class="info-row">
                <div class="info-label">이용가</div>
                <div class="info-value">${formatPrice((app.program_price || 1000000) - (app.discount_amount || 210000))}</div>
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
    
    const agreementSection = needsAgreement ? `
        <div class="agreement-section">
            <div class="agreement-title">
                <i class="fas fa-exclamation-circle"></i>
                프로그램 동의 (필수)
            </div>
            <div class="agreement-warning">
                위 프로그램 내용을 확인하셨나요?<br>
                <strong>24시간 이내</strong>에 아래 동의 절차를 완료해주세요.
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
            
            ${getTimerWarning(app.analysis_completed_at)}
        </div>
    ` : '';
    
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
                ${app.analysis_completed_at ? ` · ${formatDateTime(app.analysis_completed_at)}` : ''}
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
    }
}

// 타이머 경고 메시지
function getTimerWarning(completedAt) {
    if (!completedAt) return '';
    
    const completedTime = new Date(completedAt).getTime();
    const now = Date.now();
    const hoursElapsed = Math.floor((now - completedTime) / (1000 * 60 * 60));
    const hoursRemaining = 24 - hoursElapsed;
    
    if (hoursRemaining <= 0) {
        return `
            <div class="timer-warning" style="background: #fee2e2; border-color: #ef4444;">
                <i class="fas fa-exclamation-triangle timer-icon" style="color: #ef4444;"></i>
                <div class="timer-text">
                    <div style="font-weight: 700; color: #991b1b; margin-bottom: 4px;">시간 초과</div>
                    <div style="font-size: 13px; color: #991b1b;">
                        24시간이 경과되었습니다. 관리자에게 문의해주세요.
                    </div>
                </div>
            </div>
        `;
    }
    
    if (hoursRemaining <= 6) {
        return `
            <div class="timer-warning" style="background: #fee2e2; border-color: #fca5a5;">
                <i class="fas fa-clock timer-icon" style="color: #ef4444;"></i>
                <div class="timer-text">
                    <div class="timer-countdown">${hoursRemaining}시간 남음</div>
                    <div style="font-size: 13px; color: #991b1b;">
                        동의 기한이 얼마 남지 않았습니다. 서둘러 주세요!
                    </div>
                </div>
            </div>
        `;
    }
    
    return `
        <div class="timer-warning">
            <i class="fas fa-info-circle timer-icon"></i>
            <div class="timer-text">
                <div class="timer-countdown">${hoursRemaining}시간 남음</div>
                <div style="font-size: 13px; color: #92400e;">
                    분석 완료 후 24시간 이내에 동의해주세요.
                </div>
            </div>
        </div>
    `;
}

// 동의 제출
async function submitAgreement(applicationId) {
    const submitBtn = document.getElementById('submitAgreement');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';
    
    try {
        const response = await fetch(`tables/applications/${applicationId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                student_program_agreed: true,
                student_schedule_agreed: true,
                student_agreed_at: new Date().toISOString(),
                current_step: 3
            })
        });
        
        if (!response.ok) {
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
