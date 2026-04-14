// Application Detail Page
let currentApplication = null;
let globalApplication = null; // Phase 2: 글로벌 변수
let _studentInfo = { name: '', phone: '', id: '' }; // 알림톡용 학생 기본정보 (변하지 않음)

// Utility function to escape HTML
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Utility function to format date
function formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Check if user is admin
function isAdmin() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    return userData && userData.role === 'admin';
}

// Check if user is the owner of the application
function isOwner(app) {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!userData) return false;
    
    // 이메일로 비교
    return userData.email === app.email;
}

// Check if user has access to the application
function hasAccess(app) {
    // 관리자는 모든 신청서 접근 가능
    if (isAdmin()) return true;
    
    // 비로그인 상태
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!userData) return false;
    
    // 본인 신청서인지 확인
    return isOwner(app);
}

document.addEventListener('DOMContentLoaded', () => {
    loadApplicationDetail();
    
    // 브라우저 뒤로가기/앞으로가기 지원
    window.addEventListener('hashchange', handleHashChange);
});

/**
 * URL hash 변경 시 탭 전환
 */
function handleHashChange() {
    const urlHash = window.location.hash;
    const hashToTab = {
        '#step1': 'tabInfo',
        '#step2': 'tabStudentAnalysis',
        '#step3': 'tabContract',
        '#step4': 'tabPayment',
        '#step5': 'tabUsage'
    };
    
    const targetTab = hashToTab[urlHash];
    if (!targetTab) return;
    
    // 모든 탭 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // 선택한 탭 표시
    const tabElement = document.getElementById(targetTab);
    if (tabElement) {
        tabElement.style.display = 'block';
    }
    
    // 사이드바 활성화 상태 업데이트
    document.querySelectorAll('.step-nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-tab') === targetTab) {
            link.classList.add('active');
        }
    });
}

async function loadApplicationDetail() {
    const loading = document.getElementById('detailLoading');
    const detailCard = document.getElementById('detailCard');
    const errorMessage = document.getElementById('errorMessage');
    
    // Get ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    
    if (!id) {
        loading.style.display = 'none';
        errorMessage.style.display = 'block';
        document.getElementById('errorDetail').textContent = 'URL에 신청서 ID가 없습니다.';
        return;
    }
    
    loading.style.display = 'block';
    
    try {
        console.log('Fetching application with ID:', id);
        const app = await supabaseAPI.getById('applications', id);
        
        if (app) {
            console.log('Application loaded');
            
            // 접근 권한 체크
            const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
            
            // 비로그인 상태
            if (!userData) {
                alert('⚠️ 로그인이 필요합니다.\n\n신청서를 확인하려면 로그인해주세요.');
                window.location.href = 'login.html';
                return;
            }
            
            // 본인 신청서가 아닌 경우 (관리자 제외)
            if (!hasAccess(app)) {
                alert('🔒 접근 권한이 없습니다.\n\n본인이 작성한 신청서만 확인할 수 있습니다.');
                window.location.href = 'my-application.html';
                return;
            }
            
            currentApplication = app;
            globalApplication = app;
            _studentInfo = { name: app.name, phone: app.phone, id: app.id, final_price: app.final_price };
            
            console.log('Calling displayApplicationDetail...');
            displayApplicationDetail(app);
            
            console.log('Calling loadStudentTabs...');
            // 학생 탭 표시 (누구나 볼 수 있음)
            loadStudentTabs(app);
            
            console.log('Showing detail card...');
            detailCard.style.display = 'block';
        } else {
            console.error('Application not found');
            errorMessage.style.display = 'block';
            document.getElementById('errorDetail').textContent = '신청서를 찾을 수 없습니다.';
        }
    } catch (error) {
        console.error('Failed to load application:', error);
        errorMessage.style.display = 'block';
        document.getElementById('errorDetail').textContent = `오류: ${error.message}`;
    } finally {
        loading.style.display = 'none';
    }
}

function displayApplicationDetail(app) {
    console.log('displayApplicationDetail called with:', app);
    
    // 상태 판단 로직
    let statusText = '';
    let statusClass = '';
    let statusIcon = '';
    
    if (!app.analysis_status || !app.analysis_content) {
        // 신청서 제출 ~ 관리자 분석 등록 전
        statusText = '승인 검토중';
        statusClass = 'status-reviewing';
        statusIcon = 'fa-clock';
    } else {
        // 관리자 분석 등록 후
        if (app.analysis_status === '승인') {
            statusText = '승인';
            statusClass = 'status-approved';
            statusIcon = 'fa-check-circle';
        } else if (app.analysis_status === '조건부승인') {
            statusText = '조건부승인';
            statusClass = 'status-conditional';
            statusIcon = 'fa-exclamation-circle';
        } else if (app.analysis_status === '거부') {
            statusText = '승인불가';
            statusClass = 'status-rejected';
            statusIcon = 'fa-times-circle';
        } else {
            statusText = '승인 검토중';
            statusClass = 'status-reviewing';
            statusIcon = 'fa-clock';
        }
    }
    
    console.log('Status:', statusText, statusClass);
    
    // 상태 배지 표시 (신청서 상세 제목 오른쪽)
    document.getElementById('detailStatus').innerHTML = `
        <span class="status-badge ${statusClass}" style="font-size: 13px; padding: 7px 14px;">
            <i class="fas ${statusIcon}" style="margin-right: 5px; font-size: 12px;"></i>
            ${statusText}
        </span>
    `;
    
    console.log('Status badge set');
    
    // 개정후 점수를 .0 형식으로 포맷팅하는 함수
    function formatNewScore(score) {
        if (score === null || score === undefined || score === '') return '-';
        return Number(score).toFixed(1);
    }
    
    // 목표 점수 표시
    let targetDisplay = '';
    if (app.no_target_score) {
        targetDisplay = '없음 (고고익선 🚀)';
    } else if (app.target_cutoff_old) {
        targetDisplay = `${app.target_cutoff_old}점`;
    } else if (app.target_cutoff_new) {
        targetDisplay = `${formatNewScore(app.target_cutoff_new)} 레벨`;
    } else {
        targetDisplay = '미설정';
    }
    
    console.log('Target display:', targetDisplay);
    
    // 현재 점수 표시
    let currentScoreDisplay = '';
    if (app.has_toefl_score === 'yes' && app.total_score) {
        if (app.score_version === 'new') {
            currentScoreDisplay = `
                <div class="detail-row">
                    <div class="detail-label">현재 토플 점수 (개정후)</div>
                    <div class="detail-value">
                        <div style="font-size: 19px; font-weight: 700; color: #9480c5; margin-bottom: 8px;">
                            Total: ${formatNewScore(app.total_score)} 레벨
                        </div>
                        <div class="section-score-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px;">
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Reading</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${formatNewScore(app.score_reading_new)}</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Listening</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${formatNewScore(app.score_listening_new)}</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Speaking</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${formatNewScore(app.score_speaking_new)}</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Writing</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${formatNewScore(app.score_writing_new)}</div>
                            </div>
                        </div>
                    </div>
                </div>`;
        } else {
            currentScoreDisplay = `
                <div class="detail-row">
                    <div class="detail-label">현재 토플 점수 (개정전)</div>
                    <div class="detail-value">
                        <div style="font-size: 19px; font-weight: 700; color: #9480c5; margin-bottom: 8px;">
                            Total: ${app.total_score}점
                        </div>
                        <div class="section-score-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px;">
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Reading</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${app.score_reading_old || '-'}</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Listening</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${app.score_listening_old || '-'}</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Speaking</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${app.score_speaking_old || '-'}</div>
                            </div>
                            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; text-align: center;">
                                <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Writing</div>
                                <div style="font-size: 17px; font-weight: 600; color: #1e293b;">${app.score_writing_old || '-'}</div>
                            </div>
                        </div>
                    </div>
                </div>
                ${app.score_date ? `
                <div class="detail-row" style="margin-top: 12px;">
                    <div class="detail-label">점수 응시일</div>
                    <div class="detail-value">${escapeHtml(app.score_date)}</div>
                </div>
                ` : ''}
                ${app.score_history ? `
                <div class="detail-row" style="margin-top: 12px;">
                    <div class="detail-label">점수 이력 메모</div>
                    <div class="detail-value" style="white-space: pre-wrap; line-height: 1.6; color: #64748b; font-size: 13px;">
${escapeHtml(app.score_history)}
                    </div>
                </div>
                ` : ''}
            `;
        }
    } else {
        currentScoreDisplay = `
            <div class="detail-row">
                <div class="detail-label">현재 토플 점수</div>
                <div class="detail-value">점수 없음 (영작 평가 제출)</div>
            </div>
            ${app.writing_sample_1 ? `
            <div class="detail-row">
                <div class="detail-label">Question 1<br><span style="font-size: 12px; color: #64748b; font-weight: 400;">What are your hobbies or interests, and why do you enjoy them?</span></div>
                <div class="detail-value" style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 15px; align-self: start;">${escapeHtml(app.writing_sample_1)}</div>
            </div>
            ` : ''}
            ${app.writing_sample_2 ? `
            <div class="detail-row">
                <div class="detail-label">Question 2<br><span style="font-size: 12px; color: #64748b; font-weight: 400;">Describe a challenge you faced recently and how you dealt with it.</span></div>
                <div class="detail-value" style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 15px; align-self: start;">${escapeHtml(app.writing_sample_2)}</div>
            </div>
            ` : ''}
        `;
    }
    
    // Detail content - tabInfo에 표시
    const tabInfoElement = document.getElementById('tabInfo');
    if (!tabInfoElement) {
        console.error('tabInfo element not found!');
        return;
    }
    
    tabInfoElement.innerHTML = `
        <style>
            .detail-row {
                display: grid;
                grid-template-columns: 180px 1fr;
                gap: 16px;
                padding: 16px 0;
                border-bottom: 1px solid #f1f5f9;
                align-items: start;
            }
            .detail-label {
                font-size: 15px;
                font-weight: 600;
                color: #64748b;
            }
            .detail-value {
                font-size: 15px;
                color: #1e293b;
            }
            @media (max-width: 768px) {
                .detail-row {
                    grid-template-columns: 90px 1fr;
                    gap: 8px;
                    padding: 12px 0;
                }
                .detail-label {
                    font-size: 13px;
                }
                .detail-value {
                    font-size: 13px;
                }
                .step1-container {
                    padding: 16px !important;
                }
                .step1-container h3 {
                    font-size: 16px !important;
                    margin-bottom: 16px !important;
                }
                .section-score-grid {
                    grid-template-columns: repeat(2, 1fr) !important;
                }
            }
        </style>
        <div class="step1-container" style="background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <h3 style="font-size: 19px; font-weight: 700; color: #1e293b; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid #9480c5;">📋 신청서 정보</h3>
            
            <div class="detail-row">
                <div class="detail-label">이름</div>
                <div class="detail-value" style="font-size: 17px; font-weight: 600;">${escapeHtml(app.name)}</div>
            </div>
        
        <div class="detail-row">
            <div class="detail-label">이메일</div>
            <div class="detail-value">${escapeHtml(app.email || '-')}</div>
        </div>
        
        <div class="detail-row">
            <div class="detail-label">전화번호</div>
            <div class="detail-value">${escapeHtml(app.phone || '-')}</div>
        </div>
        
        <div class="detail-row">
            <div class="detail-label">주소</div>
            <div class="detail-value">${escapeHtml(app.address || '-')}</div>
        </div>
        
        <div class="detail-row">
            <div class="detail-label">직업</div>
            <div class="detail-value">${escapeHtml(app.occupation || '-')}</div>
        </div>
        
        ${app.bank_name || app.account_number ? `
        <div class="detail-row">
            <div class="detail-label">환불 계좌</div>
            <div class="detail-value">
                ${app.bank_name ? escapeHtml(app.bank_name) : '-'} / 
                ${app.account_number ? escapeHtml(app.account_number) : '-'} / 
                ${app.account_holder ? escapeHtml(app.account_holder) : '-'}
            </div>
        </div>
        ` : ''}
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;">
        
        ${currentScoreDisplay}
        
        ${app.daily_study_time ? `
        <div class="detail-row">
            <div class="detail-label">하루 평균 공부 시간</div>
            <div class="detail-value">${escapeHtml(app.daily_study_time)}</div>
        </div>
        ` : ''}
        
        <div class="detail-row">
            <div class="detail-label">목표 점수</div>
            <div class="detail-value" style="font-size: 19px; font-weight: 700; color: #77bf7e;">
                ${targetDisplay}
            </div>
        </div>
        
        ${app.target_reading_old || app.target_listening_old || app.target_speaking_old || app.target_writing_old || 
          app.target_reading_new || app.target_listening_new || app.target_speaking_new || app.target_writing_new ? `
        <div class="detail-row" style="margin-top: 12px;">
            <div class="detail-label">섹션별 목표</div>
            <div class="detail-value">
                <div class="section-score-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
                    ${app.target_version === 'old' ? `
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Reading</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${app.target_reading_old || '-'}</div>
                        </div>
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Listening</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${app.target_listening_old || '-'}</div>
                        </div>
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Speaking</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${app.target_speaking_old || '-'}</div>
                        </div>
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Writing</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${app.target_writing_old || '-'}</div>
                        </div>
                    ` : `
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Reading</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${formatNewScore(app.target_reading_new)}</div>
                        </div>
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Listening</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${formatNewScore(app.target_listening_new)}</div>
                        </div>
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Speaking</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${formatNewScore(app.target_speaking_new)}</div>
                        </div>
                        <div style="padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
                            <div style="font-size: 12px; color: #15803d; margin-bottom: 4px;">Writing</div>
                            <div style="font-size: 17px; font-weight: 600; color: #166534;">${formatNewScore(app.target_writing_new)}</div>
                        </div>
                    `}
                </div>
            </div>
        </div>
        ` : ''}
        
        ${app.target_notes ? `
        <div class="detail-row" style="margin-top: 12px;">
            <div class="detail-label">목표 점수 메모</div>
            <div class="detail-value" style="white-space: pre-wrap; line-height: 1.6; color: #64748b; font-size: 13px;">
${escapeHtml(app.target_notes)}
            </div>
        </div>
        ` : ''}
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;">
        
        <div class="detail-row">
            <div class="detail-label">희망 프로그램</div>
            <div class="detail-value" style="font-size: 16px; font-weight: 600; color: #9480c5;">
                ${escapeHtml(app.preferred_program || app.program || '-')}
            </div>
        </div>
        
        <div class="detail-row">
            <div class="detail-label">희망 시작일</div>
            <div class="detail-value">${escapeHtml(app.preferred_start_date || '-')}</div>
        </div>
        
        <div class="detail-row">
            <div class="detail-label">스라첨삭 신청</div>
            <div class="detail-value" style="color: ${(app.preferred_correction === '신청희망' || app.preferred_correction === '신청') ? '#2563eb' : '#64748b'}; font-weight: 600;">
                ${(app.preferred_correction === '신청희망' || app.preferred_correction === '신청') ? '✅ 신청희망' : '미신청'}
            </div>
        </div>
        
        <div class="detail-row">
            <div class="detail-label">제출 데드라인</div>
            <div class="detail-value">${escapeHtml(app.submission_deadline || '-')}</div>
        </div>
        
        ${app.preferred_completion ? `
        <div class="detail-row">
            <div class="detail-label">희망 목표 달성 시점</div>
            <div class="detail-value">${escapeHtml(app.preferred_completion)}</div>
        </div>
        ` : ''}
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;">
        
        ${app.current_study_method ? `
        <div class="detail-row">
            <div class="detail-label">현재 토플 공부 방법</div>
            <div class="detail-value" style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 15px; align-self: start;">${escapeHtml(app.current_study_method)}</div>
        </div>
        ` : ''}
        
        ${app.toefl_reason ? `
        <div class="detail-row">
            <div class="detail-label">토플이 필요한 이유</div>
            <div class="detail-value">
                <div style="font-weight: 600; color: #9480c5; margin-bottom: 8px;">${escapeHtml(app.toefl_reason)}</div>
                ${app.toefl_reason_detail ? `
                <div style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; align-self: start;">${escapeHtml(app.toefl_reason_detail)}</div>
                ` : ''}
            </div>
        </div>
        ` : app.toefl_reason_detail ? `
        <div class="detail-row">
            <div class="detail-label">토플이 필요한 이유</div>
            <div class="detail-value" style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 15px; align-self: start;">${escapeHtml(app.toefl_reason_detail)}</div>
        </div>
        ` : ''}
        
        ${app.program_note ? `
        <div class="detail-row">
            <div class="detail-label">프로그램 추가 메모</div>
            <div class="detail-value" style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 15px; align-self: start;">${escapeHtml(app.program_note)}</div>
        </div>
        ` : ''}
        
        ${app.referral_search_keyword || app.referral_social_media || app.referral_friend || app.referral_friend_name || app.referral_other ? `
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;">
        <div class="detail-row">
            <div class="detail-label">이온토플을 알게 된 경로</div>
            <div class="detail-value">
                ${app.referral_search_keyword ? `<div style="margin-bottom: 8px;"><span style="font-weight: 600; color: #9480c5;">검색 키워드:</span> ${escapeHtml(app.referral_search_keyword)}</div>` : ''}
                ${app.referral_social_media ? `<div style="margin-bottom: 8px;"><span style="font-weight: 600; color: #9480c5;">SNS:</span> ${escapeHtml(app.referral_social_media)}</div>` : ''}
                ${app.referral_friend === 'yes' && app.referral_friend_name ? `<div style="margin-bottom: 8px;"><span style="font-weight: 600; color: #9480c5;">지인 추천:</span> ${escapeHtml(app.referral_friend_name)}님 추천</div>` : ''}
                ${app.referral_other ? `<div style="margin-bottom: 8px;"><span style="font-weight: 600; color: #9480c5;">기타:</span> ${escapeHtml(app.referral_other)}</div>` : ''}
            </div>
        </div>
        ` : ''}
        
        ${app.additional_notes ? `
        <div class="detail-row">
            <div class="detail-label">추가 전달사항</div>
            <div class="detail-value" style="white-space: pre-wrap; line-height: 1.8; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 15px; align-self: start;">${escapeHtml(app.additional_notes)}</div>
        </div>
        ` : ''}
        
        ${/* 개별분석은 별도 탭에서 표시 */ ''}
        
        ${app.admin_comment ? `
            <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;">
            <div style="padding: 20px; background: linear-gradient(135deg, #e8e0f5 0%, #f3e8f3 100%); border-radius: 12px; border-left: 4px solid #9480c5;">
                <div style="font-size: 13px; font-weight: 700; color: #5e4a8b; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-comment-dots"></i> 이온쌤의 답변
                </div>
                <div style="font-size: 15px; color: #1e293b; line-height: 1.8; white-space: pre-wrap; align-self: start;">
${escapeHtml(app.admin_comment)}
                </div>
            </div>
        ` : ''}
        
        <div style="margin-top: 24px; padding: 12px; background: #f8fafc; border-radius: 8px; font-size: 13px; color: #64748b; text-align: center;">
            신청일시: ${formatDate(app.created_at)}
        </div>
        
        ${app.confirm_materials || app.confirm_kakao ? `
        <div style="margin-top: 12px; padding: 12px; background: #f0f9ff; border-radius: 8px; font-size: 13px; color: #0369a1;">
            <div style="font-weight: 600; margin-bottom: 6px;">✓ 확인 사항</div>
            ${app.confirm_materials ? '<div>• 필독 공지사항 확인 완료</div>' : ''}
            ${app.confirm_kakao ? '<div>• 카카오톡 본인 인증 동의</div>' : ''}
        </div>
        ` : ''}
        </div>
    `;
    
    console.log('Detail content rendered successfully');
}

// ==================== 관리자 전용 기능 ====================

// 관리자 패널 열기
function openAdminPanel() {
    if (!isAdmin()) {
        alert('관리자만 접근 가능합니다.');
        return;
    }
    
    const app = currentApplication;
    if (!app) return;
    
    // 모달 HTML 생성
    const modalHTML = `
        <div id="adminModal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;">
            <div style="background: white; border-radius: 12px; max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <div style="padding: 24px; border-bottom: 2px solid #e2e8f0;">
                    <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #1e293b;">
                        <i class="fas fa-cog" style="color: #9480c5;"></i> 관리자 액션 패널
                    </h3>
                </div>
                
                <div style="padding: 24px;">
                    <!-- 상태 변경 -->
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1e293b;">
                            상태 변경
                        </label>
                        <select id="adminStatusSelect" style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
                            <option value="접수완료" ${(app.status || '접수완료') === '접수완료' ? 'selected' : ''}>접수완료</option>
                            <option value="검토중" ${app.status === '검토중' ? 'selected' : ''}>검토중</option>
                            <option value="승인" ${app.status === '승인' ? 'selected' : ''}>승인 ✓</option>
                            <option value="거부" ${app.status === '거부' ? 'selected' : ''}>거부 ✗</option>
                            <option value="보류" ${app.status === '보류' ? 'selected' : ''}>보류</option>
                        </select>
                    </div>
                    
                    <!-- 프로그램 배정 -->
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1e293b;">
                            프로그램 배정
                        </label>
                        <select id="adminProgramSelect" style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
                            <option value="${app.preferred_program || ''}">${app.preferred_program || '미정'} (신청한 프로그램)</option>
                            <option value="내벨업챌린지 - Fast">내벨업챌린지 - Fast</option>
                            <option value="내벨업챌린지 - Standard">내벨업챌린지 - Standard</option>
                            <option value="상담 후 결정">상담 후 결정</option>
                        </select>
                    </div>
                    
                    <!-- 관리자 코멘트 -->
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #1e293b;">
                            관리자 코멘트 (학생에게 표시됨)
                        </label>
                        <textarea id="adminCommentText" 
                                  rows="6" 
                                  style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; resize: vertical; font-family: Pretendard, -apple-system, sans-serif;"
                                  placeholder="학생에게 전달할 메시지를 입력하세요...">${escapeHtml(app.admin_comment || '')}</textarea>
                    </div>
                    
                    <!-- 빠른 연락 -->
                    <div style="margin-bottom: 24px; padding: 16px; background: #f8fafc; border-radius: 8px;">
                        <div style="font-weight: 600; margin-bottom: 12px; color: #1e293b;">
                            <i class="fas fa-phone-alt" style="color: #9480c5;"></i> 빠른 연락
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                            <a href="mailto:${app.email}" class="admin-btn admin-btn-outline admin-btn-sm" style="text-align: center;">
                                <i class="fas fa-envelope"></i> 이메일
                            </a>
                            <a href="tel:${app.phone}" class="admin-btn admin-btn-outline admin-btn-sm" style="text-align: center;">
                                <i class="fas fa-phone"></i> 전화
                            </a>
                            <button onclick="copyToClipboard('${app.email}')" class="admin-btn admin-btn-outline admin-btn-sm">
                                <i class="fas fa-copy"></i> 이메일 복사
                            </button>
                            <button onclick="copyToClipboard('${app.phone}')" class="admin-btn admin-btn-outline admin-btn-sm">
                                <i class="fas fa-copy"></i> 전화번호 복사
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- 버튼 -->
                <div style="padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; gap: 12px; justify-content: flex-end;">
                    <button onclick="closeAdminPanel()" class="admin-btn admin-btn-outline">
                        <i class="fas fa-times"></i> 취소
                    </button>
                    <button onclick="saveAdminChanges()" class="admin-btn admin-btn-primary">
                        <i class="fas fa-save"></i> 저장
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // 모달 추가
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // ESC 키로 닫기
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeAdminPanel();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

// 관리자 패널 닫기
function closeAdminPanel() {
    const modal = document.getElementById('adminModal');
    if (modal) {
        modal.remove();
    }
}

// 관리자 변경사항 저장
async function saveAdminChanges() {
    const app = currentApplication;
    if (!app) return;
    
    const newStatus = document.getElementById('adminStatusSelect').value;
    const newProgram = document.getElementById('adminProgramSelect').value;
    const newComment = document.getElementById('adminCommentText').value.trim();
    
    try {
        const updateData = {
            status: newStatus,
            assigned_program: newProgram,
            admin_comment: newComment
        };
        
        const result = await supabaseAPI.patch('applications', app.id, updateData);
        
        if (result) {
            alert('✅ 변경사항이 저장되었습니다!');
            closeAdminPanel();
            // 페이지 새로고침
            location.reload();
        } else {
            alert('❌ 저장에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 클립보드 복사
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            alert('✅ 복사되었습니다: ' + text);
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

// 클립보드 복사 폴백
function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        alert('✅ 복사되었습니다: ' + text);
    } catch (err) {
        alert('❌ 복사에 실패했습니다.');
    }
    document.body.removeChild(textarea);
}

// ==================== 개별분석 표시 (학생용) ====================

function getAnalysisSection(app) {
    // 개별분석이 없으면 빈 문자열 반환
    if (!app.analysis_status || !app.analysis_content) {
        return '';
    }
    
    // 상태 텍스트 및 색상
    const statusInfo = {
        '승인': { text: '<svg width="24" height="24" viewBox="0 0 24 24" style="display: inline-block; vertical-align: middle; margin-right: 8px;"><circle cx="12" cy="12" r="10" fill="#22c55e"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>합격 - 승인되었습니다!', color: '#22c55e', bg: '#dcfce7', border: '#22c55e' },
        '조건부승인': { text: '⚠️ 조건부 합격', color: '#f59e0b', bg: '#fef3c7', border: '#eab308' },
        '거부': { text: '❌ 불합격', color: '#ef4444', bg: '#fee2e2', border: '#ef4444' }
    };
    
    const status = statusInfo[app.analysis_status] || statusInfo['승인'];
    
    // 동의가 필요한지 확인
    const needsAgreement = (app.analysis_status === '승인' || app.analysis_status === '조건부승인') 
                          && !app.student_program_agreed;
    
    return `
        <hr style="margin: 32px 0; border: none; border-top: 2px solid #e2e8f0;">
        
        <!-- 개별분석 결과 상태 -->
        <div style="padding: 24px; background: ${status.bg}; border: 2px solid ${status.border}; border-radius: 12px; margin-bottom: 24px; text-align: center;">
            <div style="font-size: 20px; font-weight: 700; color: ${status.color};">
                ${status.text}
            </div>
        </div>
        
        <!-- 1. 개별 분석 내용 -->
        ${app.analysis_content ? `
        <div style="padding: 24px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px;">
            <div style="font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-file-alt" style="color: #9480c5;"></i> 개별 분석 내용
            </div>
            <div style="line-height: 1.8; color: #1e293b; white-space: pre-wrap; font-size: 15px; align-self: start;">
                ${escapeHtml(app.analysis_content)}
            </div>
        </div>
        ` : ''}
        
        <!-- 2. 배정 프로그램 정보 -->
        ${app.assigned_program ? `
        <div style="padding: 24px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px;">
            <div style="font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-graduation-cap" style="color: #9480c5;"></i> 배정 프로그램 정보
            </div>
            
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="color: #64748b; font-size: 15px;">프로그램명</span>
                <span style="font-weight: 600; color: #9480c5; font-size: 16px;">${escapeHtml(app.assigned_program)}</span>
            </div>
            
            ${app.schedule_start ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="color: #64748b; font-size: 15px;">시작일</span>
                <span style="font-weight: 600; color: #1e293b; font-size: 15px;">${app.schedule_start}</span>
            </div>
            ` : ''}
            
            ${app.schedule_end ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="color: #64748b; font-size: 15px;">종료일</span>
                <span style="font-weight: 600; color: #1e293b; font-size: 15px;">${app.schedule_end}</span>
            </div>
            ` : ''}
            ${app.correction_enabled ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span style="color: #64748b; font-size: 15px;">스라첨삭</span>
                <span style="font-weight: 600; color: #2563eb; font-size: 15px;">포함</span>
            </div>
            ${app.correction_start_date ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                <span style="color: #64748b; font-size: 15px;">첨삭 시작일</span>
                <span style="font-weight: 600; color: #1e293b; font-size: 15px;">${app.correction_start_date}</span>
            </div>
            ` : ''}
            ` : ''}
        </div>
        ` : ''}
        
        <!-- 3. 이용가 및 할인 내역 -->
        ${getPricingBox(app)}
        
        <!-- 중요 안내사항 (가격 정보와 동의 섹션 사이) -->
        ${app.analysis_content ? `
        <div style="padding: 20px; background: #fef2f2; border: 2px solid #fca5a5; border-radius: 12px; margin-bottom: 24px;">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 24px; color: #dc2626; margin-top: 2px;"></i>
                <div>
                    <div style="font-size: 16px; font-weight: 700; color: #dc2626; margin-bottom: 8px;">⏰ 필독! 자동 승인불가 처리 안내</div>
                    <div style="font-size: 14px; color: #991b1b; line-height: 1.7;">
                        토플 일대일 진단서 업로드 시간으로부터 <strong>24시간 이내에 댓글이 없을 시</strong>, 알림 없이 자동으로 <strong style="text-decoration: underline;">승인불가 처리</strong>가 됩니다.
                        토플이 최우선이고, 열심히 하실 마음, 절박함과 의지가 있으신 분들이라고 판단되지 않기 때문에 내린 결정입니다.
                        또한, 이후 <strong>만 5일간 새로운 신청서를 업로드 하실 수 없으니</strong> 반드시 참고해주시기 바랍니다.
                    </div>
                </div>
            </div>
        </div>
        ` : ''}
        
        <!-- 동의 섹션 -->
        ${needsAgreement ? getAgreementSection(app) : ''}
        
        <!-- 동의 완료 메시지 -->
        ${app.student_program_agreed ? `
        <div style="padding: 24px; background: #dcfce7; border: 2px solid #22c55e; border-radius: 12px; text-align: center;">
            <i class="fas fa-check-circle" style="font-size: 48px; color: #22c55e; margin-bottom: 16px;"></i>
            <h3 style="font-size: 18px; font-weight: 700; color: #166534; margin-bottom: 8px;">동의 완료</h3>
            <p style="font-size: 14px; color: #166534;">
                프로그램 동의가 완료되었습니다.<br>
                ${app.student_agreed_at ? `(동의일: ${formatDate(app.student_agreed_at)})` : ''}
            </p>
            <p style="font-size: 13px; color: #166534; margin-top: 12px;">
                다음 단계 진행을 위해 관리자가 연락드릴 예정입니다.
            </p>
        </div>
        ` : ''}
    `;
}

// 동의 섹션 HTML
function getAgreementSection(app) {
    const hoursElapsed = app.analysis_completed_at 
        ? Math.floor((Date.now() - new Date(app.analysis_completed_at).getTime()) / (1000 * 60 * 60))
        : 0;
    const hoursRemaining = 24 - hoursElapsed;
    
    let timerHTML = '';
    if (app.analysis_completed_at) {
        if (hoursRemaining <= 0) {
            timerHTML = `
                <div style="padding: 12px; background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; margin-top: 12px; display: flex; align-items: center; gap: 12px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 20px; color: #ef4444;"></i>
                    <div>
                        <div style="font-weight: 700; color: #991b1b; margin-bottom: 4px;">시간 초과</div>
                        <div style="font-size: 13px; color: #991b1b;">24시간이 경과되었습니다. 관리자에게 문의해주세요.</div>
                    </div>
                </div>
            `;
        } else if (hoursRemaining <= 6) {
            timerHTML = `
                <div style="padding: 12px; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; margin-top: 12px; display: flex; align-items: center; gap: 12px;">
                    <i class="fas fa-clock" style="font-size: 20px; color: #ef4444;"></i>
                    <div>
                        <div style="font-size: 18px; font-weight: 700; color: #991b1b;">${hoursRemaining}시간 남음</div>
                        <div style="font-size: 13px; color: #991b1b;">동의 기한이 얼마 남지 않았습니다. 서둘러 주세요!</div>
                    </div>
                </div>
            `;
        } else {
            timerHTML = `
                <div style="padding: 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; margin-top: 12px; display: flex; align-items: center; gap: 12px;">
                    <i class="fas fa-info-circle" style="font-size: 20px; color: #f59e0b;"></i>
                    <div>
                        <div style="font-size: 18px; font-weight: 700; color: #92400e;">${hoursRemaining}시간 남음</div>
                        <div style="font-size: 13px; color: #92400e;">분석 완료 후 24시간 이내에 동의해주세요.</div>
                    </div>
                </div>
            `;
        }
    }
    
    return `
        <div style="padding: 24px; background: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; margin-bottom: 24px;">
            <div style="font-size: 16px; font-weight: 700; color: #991b1b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-exclamation-circle"></i> 프로그램 동의 (필수)
            </div>
            <div style="font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 20px;">
                위 프로그램 내용을 확인하셨나요?<br>
                <strong>24시간 이내</strong>에 아래 동의 절차를 완료해주세요.
            </div>
            
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 16px; background: white; border-radius: 8px; margin-bottom: 12px; cursor: pointer;" onclick="toggleCheckbox(event, 'agreeProgram')">
                <input type="checkbox" id="agreeProgram" onchange="updateAgreementButton()" style="width: 20px; height: 20px; margin-top: 4px; cursor: pointer;">
                <label for="agreeProgram" style="flex: 1; cursor: pointer; line-height: 1.6; color: #1e293b;">
                    <strong>프로그램명, 시작일, 가격에 동의합니다.</strong><br>
                    <span style="font-size: 13px; color: #64748b;">
                        배정된 프로그램 정보를 확인했으며, 해당 내용에 동의합니다.
                    </span>
                </label>
            </div>
            
            <div style="display: flex; align-items: flex-start; gap: 12px; padding: 16px; background: white; border-radius: 8px; margin-bottom: 12px; cursor: pointer;" onclick="toggleCheckbox(event, 'agreeSchedule')">
                <input type="checkbox" id="agreeSchedule" onchange="updateAgreementButton()" style="width: 20px; height: 20px; margin-top: 4px; cursor: pointer;">
                <label for="agreeSchedule" style="flex: 1; cursor: pointer; line-height: 1.6; color: #1e293b;">
                    <strong>일정에 동의합니다.</strong><br>
                    <span style="font-size: 13px; color: #64748b;">
                        시작일과 종료일을 확인했으며, 해당 일정에 참여할 수 있습니다.
                    </span>
                </label>
            </div>
            
            <button id="submitAgreementBtn" 
                    onclick="submitStudentAgreement()" 
                    disabled
                    style="width: 100%; padding: 16px; background: linear-gradient(135deg, #9480c5 0%, #b8a4d6 100%); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(148, 128, 197, 0.3);">
                <i class="fas fa-check-circle"></i> 동의하고 다음 단계로
            </button>
            
            ${timerHTML}
        </div>
    `;
}

// 체크박스 토글
function toggleCheckbox(event, id) {
    // 체크박스나 label을 클릭한 경우 div의 onclick 무시 (이벤트 버블링 방지)
    if (event && (event.target.tagName === 'INPUT' || event.target.tagName === 'LABEL')) {
        return;
    }
    
    const checkbox = document.getElementById(id);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
    }
}

// 동의 버튼 활성화/비활성화
function updateAgreementButton() {
    const agreeProgram = document.getElementById('agreeProgram');
    const agreeSchedule = document.getElementById('agreeSchedule');
    const submitBtn = document.getElementById('submitAgreementBtn');
    
    if (agreeProgram && agreeSchedule && submitBtn) {
        const isEnabled = agreeProgram.checked && agreeSchedule.checked;
        submitBtn.disabled = !isEnabled;
        
        if (isEnabled) {
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        } else {
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';
        }
    }
}

// 학생 동의 제출
async function submitStudentAgreement() {
    if (!confirm('프로그램에 동의하시겠습니까?')) {
        return;
    }
    
    const submitBtn = document.getElementById('submitAgreementBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';
    
    try {
        // 1. 학생 동의 처리
        const agreementData = {
            student_program_agreed: true,
            student_schedule_agreed: true,
            student_agreed_at: new Date().toISOString(),
            current_step: 3,
            status: '학생동의완료'
        };

        // 2. 활성 계약서 자동 조회 → 자동 발송 (첨삭 포함 여부에 따라 타입 구분)
        try {
            const contractType = currentApplication.correction_enabled ? 'correction' : 'nevelup';
            const contracts = await supabaseAPI.query('contracts', { 'is_active': 'eq.true', 'contract_type': `eq.${contractType}`, 'limit': '1' });
            if (contracts && contracts.length > 0) {
                const contract = contracts[0];
                agreementData.contract_sent = true;
                agreementData.contract_sent_at = Date.now();
                agreementData.contract_template_id = contract.id;
                agreementData.contract_version = contract.version;
                agreementData.contract_title = contract.title;
                agreementData.contract_snapshot = contract.content;
                agreementData.current_step = 4;
                agreementData.status = '계약서발송완료';
            }
        } catch (contractError) {
            console.warn('계약서 자동 발송 실패, 수동 발송 필요:', contractError);
            // 계약서 조회 실패해도 동의 처리는 진행
        }

        const result = await supabaseAPI.patch('applications', currentApplication.id, agreementData);
        
        if (!result) {
            throw new Error('Failed to submit agreement');
        }
        
        // 텔레그램 알림: 2번 - 학생 프로그램 동의 완료
        try {
            await sendEdgeFunctionNotify('student_agreed', {
                name: currentApplication.name,
                program: currentApplication.assigned_program || currentApplication.preferred_program,
                app_id: currentApplication.id
            });
        } catch (e) { console.warn('텔레그램 알림 실패:', e); }

        // 알림톡: 계약서 발송 안내 (계약서가 자동 발송된 경우에만)
        if (agreementData.contract_sent) {
            try {
                await sendKakaoAlimTalk('contract_sent', {
                    name: currentApplication.name || _studentInfo.name,
                    phone: currentApplication.phone || _studentInfo.phone,
                    program: currentApplication.assigned_program || currentApplication.preferred_program,
                    app_id: currentApplication.id || _studentInfo.id
                });
            } catch (e) { console.warn('알림톡 발송 실패:', e); }
        }

        const hasContract = agreementData.contract_sent;
        alert(hasContract 
            ? '✅ 동의가 완료되었습니다!\n\n계약서가 자동으로 발송되었습니다.\n계약서 내용을 확인해주세요.' 
            : '✅ 동의가 완료되었습니다!\n\n다음 단계 진행을 위해 관리자가 곧 연락드리겠습니다.');
        window.location.href = `application-detail.html?id=${currentApplication.id}`;
        
    } catch (error) {
        console.error('Failed to submit agreement:', error);
        alert('❌ 동의 처리에 실패했습니다.\n\n다시 시도해주세요.');
        
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> 동의하고 다음 단계로';
    }
}

// ==================== 학생용 Progress Bar & 탭 ====================

// 학생용 Progress Bar 로드
// ============================================
// DEPRECATED: loadStudentProgressBar - 더 이상 사용하지 않음
// Progress Bar와 Tabs를 통합하여 loadStudentTabs에서 처리
// ============================================
/*
function loadStudentProgressBar(app) {
    const step = app.current_step || 1;
    
    const steps = [
        { num: 1, name: '신청', icon: 'file-alt' },
        { num: 2, name: '분석', icon: 'search' },
        { num: 3, name: '계약', icon: 'file-contract' },
        { num: 4, name: '입금', icon: 'credit-card' },
        { num: 5, name: '완료', icon: 'check-circle' }
    ];
    
    // current_step을 5단계로 매핑
    let mappedStep = 1;
    if (step >= 1 && step <= 2) mappedStep = 1; // 접수완료, 검토중
    else if (step === 3) mappedStep = 2; // 개별분석완료
    else if (step === 4 || step === 5 || step === 6) mappedStep = 2; // 학생동의완료, 계약서발송, 계약동의완료
    else if (step === 7 || step === 8) mappedStep = 4; // 입금대기, 입금확인완료
    else if (step >= 9) mappedStep = 5; // 이용방법전달, 챌린지시작
    
    const stepsHTML = steps.map((s, index) => {
        const isCompleted = s.num < mappedStep || (s.num === mappedStep && app.student_program_agreed && s.num === 2);
        const isCurrent = s.num === mappedStep;
        const isLocked = s.num > mappedStep;
        
        let statusIcon = '';
        let statusColor = '';
        let bgColor = '';
        
        if (isCompleted) {
            statusIcon = '<i class="fas fa-check-circle"></i>';
            statusColor = '#22c55e';
            bgColor = '#dcfce7';
        } else if (isCurrent) {
            statusIcon = '<i class="fas fa-spinner fa-pulse"></i>';
            statusColor = '#9480c5';
            bgColor = '#f3e8ff';
        } else {
            statusIcon = '<i class="fas fa-lock"></i>';
            statusColor = '#cbd5e1';
            bgColor = '#f8fafc';
        }
        
        const arrow = index < steps.length - 1 ? `
            <div class="progress-arrow ${isCurrent ? 'active' : isCompleted ? 'completed' : ''}">
                <i class="fas fa-chevron-right"></i>
                <i class="fas fa-chevron-right"></i>
            </div>
        ` : '';
        
        return `
            <div class="progress-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isLocked ? 'locked' : ''}">
                <div class="step-circle" style="background: ${bgColor}; border-color: ${statusColor};">
                    <div class="step-number" style="color: ${statusColor};">
                        ${statusIcon}
                    </div>
                </div>
                <div class="step-label" style="color: ${statusColor}; font-weight: ${isCurrent ? '700' : '500'};">
                    ${s.name}
                </div>
            </div>
            ${arrow}
        `;
    }).join('');
    
    const currentStepText = getStepDescription(step);
    
    const progressHTML = `
        <style>
            .progress-container {
                max-width: 1400px;
                margin: 0 auto;
                padding: 0 32px;
            }
            
            .progress-header {
                text-align: center;
                margin-bottom: 32px;
            }
            
            .progress-user-name {
                font-size: 24px;
                font-weight: 700;
                color: #1e293b;
                margin-bottom: 8px;
            }
            
            .progress-subtitle {
                font-size: 14px;
                color: #64748b;
            }
            
            .progress-steps {
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 32px;
                gap: 0;
            }
            
            .progress-step {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
            }
            
            .step-circle {
                width: 80px;
                height: 80px;
                border-radius: 50%;
                border: 4px solid;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 32px;
                transition: all 0.3s;
                background: white;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }
            
            .progress-step.current .step-circle {
                animation: pulse 2s infinite;
                box-shadow: 0 8px 24px rgba(148, 128, 197, 0.3);
            }
            
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.08); }
            }
            
            .step-label {
                font-size: 15px;
                font-weight: 600;
                text-align: center;
            }
            
            .step-description {
                font-size: 12px;
                color: #64748b;
                text-align: center;
            }
            
            .progress-arrow {
                display: flex;
                gap: 4px;
                align-items: center;
                font-size: 20px;
                margin: 0 16px;
                color: #cbd5e1;
            }
            
            .progress-arrow.active {
                color: #9480c5;
                animation: arrowFlow 1.5s infinite;
            }
            
            .progress-arrow.completed {
                color: #22c55e;
            }
            
            @keyframes arrowFlow {
                0%, 100% { opacity: 0.3; transform: translateX(-4px); }
                50% { opacity: 1; transform: translateX(4px); }
            }
            
            .current-step-banner {
                text-align: center;
                padding: 20px;
                background: white;
                border-radius: 12px;
                border: 2px solid #e2e8f0;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
            }
            
            .current-step-label {
                font-size: 13px;
                color: #64748b;
                margin-bottom: 6px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .current-step-text {
                font-size: 20px;
                font-weight: 700;
                color: #9480c5;
            }
            
            @media (max-width: 1024px) {
                .step-circle {
                    width: 70px;
                    height: 70px;
                    font-size: 28px;
                }
                
                .progress-arrow {
                    margin: 0 12px;
                    font-size: 18px;
                }
            }
            
            @media (max-width: 768px) {
                .progress-container {
                    padding: 0 20px;
                }
                
                .progress-user-name {
                    font-size: 20px;
                }
                
                .progress-steps {
                    flex-wrap: wrap;
                    gap: 16px 8px;
                }
                
                .progress-arrow {
                    display: none;
                }
                
                .step-circle {
                    width: 64px;
                    height: 64px;
                    font-size: 24px;
                }
                
                .step-label {
                    font-size: 13px;
                }
            }
        </style>
        
        <div class="progress-container">
            <div class="progress-header">
                <div class="progress-user-name">${escapeHtml(app.name)} 님의 신청 진행 현황</div>
                <div class="progress-subtitle">단계별로 진행 상황을 확인하세요</div>
            </div>
            
            <div class="progress-steps">
                ${stepsHTML}
            </div>
            
            <div class="current-step-banner">
                <div class="current-step-label">Current Step</div>
                <div class="current-step-text">${currentStepText}</div>
            </div>
        </div>
    `;
    
    document.getElementById('studentProgressSection').innerHTML = progressHTML;
    document.getElementById('studentProgressSection').style.display = 'block';
}
*/

// ============================================
// 학생용 통합 Progress-Tabs (Sticky)
// ============================================

// 학생용 탭 로드
function loadStudentTabs(app) {
    try {
        console.log('Loading student tabs for app:', app.id, 'current_step:', app.current_step);
        
        // STEP을 상태 필드 기반으로 동적 계산
        let step = 1;
        
        // STEP 1: 접수완료 (신청서 제출됨)
        if (app.id) {
            step = 1;
        }
        
        // STEP 2: 승인받기 (관리자가 분석 등록함)
        if (app.analysis_status && app.analysis_content) {
            step = 2;
        }
        
        // STEP 3: 계약서 작성 (학생이 분석에 동의하고, 관리자가 계약서 발송함)
        if (app.student_agreed_at && app.contract_sent) {
            step = 3;
        }
        
        // STEP 4: 입금 (학생이 계약서에 동의함)
        if (app.contract_agreed) {
            step = 4;
        }
        
        // STEP 5: 시작 (관리자가 입금 확인함)
        if (app.deposit_confirmed_by_admin) {
            step = 5;
        }
        
        console.log('Calculated step:', step, {
            has_analysis: !!(app.analysis_status && app.analysis_content),
            student_agreed: !!app.student_agreed_at,
            contract_sent: !!app.contract_sent,
            contract_agreed: !!app.contract_agreed,
            deposit_confirmed: !!app.deposit_confirmed_by_admin
        });
    const hasAnalysis = app.analysis_status && app.analysis_content;
    
    // 5단계 정의
    const progressSteps = [
        { id: 1, name: '접수완료', icon: 'fa-file-alt', tab: 'info', unlockStep: 1 },
        { id: 2, name: '승인받기', icon: 'fa-clipboard-check', tab: 'studentAnalysis', unlockStep: 2 },
        { id: 3, name: '계약서 작성', icon: 'fa-file-signature', tab: 'contract', unlockStep: 3 },
        { id: 4, name: '입금', icon: 'fa-credit-card', tab: 'payment', unlockStep: 4 },
        { id: 5, name: '시작', icon: 'fa-book-open', tab: 'usage', unlockStep: 5 }
    ];
    
    // 현재 상황에 맞는 상태 메시지 반환
    const getCurrentStatusMessage = (app) => {
        // 1. 신청서 제출 ~ 관리자 분석 등록 전
        if (!app.analysis_status || !app.analysis_content) {
            return '승인여부를 검토중이에요! 잠시만 기다려주세요 ⏳';
        }
        
        // 2. 관리자 분석 등록 ~ 학생 동의 전
        if (!app.student_agreed_at) {
            return '개별분석이 업로드 됐어요! 확인해주세요🔔';
        }
        
        // 3. 학생 동의 완료 ~ 관리자 계약서 업로드 전
        if (!app.contract_sent) {
            return '계약서를 곧 업로드해드릴게요! 잠시만 기다려주세요 ⏳';
        }
        
        // 4. 관리자 계약서 업로드 ~ 학생 계약서 동의 전
        if (!app.contract_agreed) {
            return '계약서가 업로드 됐어요! 꼼꼼히 읽어보신 뒤 동의해주세요 ⚠️';
        }
        
        // 5. 학생 계약서 동의 ~ 학생 입금 버튼 클릭 전
        if (!app.deposit_confirmed_by_student) {
            return '결제를 진행해주세요 💳';
        }
        
        // 6. 학생 입금 버튼 클릭 ~ 관리자 입금 확인 전
        if (!app.deposit_confirmed_by_admin) {
            return '입금을 확인하는 대로 안내드릴게요 🔍';
        }
        
        // 7. 관리자 입금 확인 ~ 관리자 이용방법 업로드 전
        if (!app.guide_sent) {
            return '입금이 확인됐어요! 이용 방법을 곧 안내드릴게요 🚀';
        }
        
        // 8. 관리자 이용방법 업로드 ~ 택배 발송 등록 전
        if (!app.shipping_completed) {
            return '마이페이지에 이용 방법이 업로드 됐어요! 꼼꼼히 확인해주세요 📌';
        }
        
        // 9. 시작 준비 완료
        return '시작 준비가 모두 완료됐어요! 꼼꼼히 읽어보신 뒤 잘 준비해주세요 🎉';
    };
    
    const tabsHTML = ''; // 사이드바 네비게이션으로 대체
    
    // studentTabs 요소가 있으면 숨김 처리
    const studentTabsElement = document.getElementById('studentTabs');
    if (studentTabsElement) {
        studentTabsElement.style.display = 'none';
    }
    
    // 개별분석이 있으면 해당 탭에 내용 로드
    if (hasAnalysis) {
        const analysisTab = document.getElementById('tabStudentAnalysis');
        if (analysisTab) {
            analysisTab.innerHTML = getAnalysisSection(app);
        }
    } else {
        const analysisTab = document.getElementById('tabStudentAnalysis');
        if (analysisTab) {
            analysisTab.innerHTML = `
                <div style="padding: 80px 20px; text-align: center; color: #64748b;">
                    <i class="fas fa-clock" style="font-size: 64px; margin-bottom: 20px; opacity: 0.3;"></i>
                    <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">분석 대기 중</h3>
                    <p style="font-size: 14px;">이온쌤이 신청서를 검토 중입니다. 곧 개별분석 결과를 보내드리겠습니다!</p>
                </div>
            `;
        }
    }
    
    // Phase 2: 계약서, 입금, 이용방법 탭 로드
    loadContractTab(app);
    loadPaymentTab(app);
    loadUsageTab(app);
    
    // ========================================
    // URL Hash 우선 처리 로직
    // ========================================
    
    // 현재 진행 단계 기본값
    const defaultTab = step >= 5 ? 'tabUsage' :
                      step >= 4 ? 'tabPayment' :
                      step >= 3 ? 'tabContract' :
                      step >= 2 ? 'tabStudentAnalysis' :
                      'tabInfo';
    
    // URL hash 확인 (#step1, #step2, #step3, #step4, #step5)
    const urlHash = window.location.hash;
    let activeTab = defaultTab; // 기본값
    
    if (urlHash) {
        // hash가 있으면 해당 탭으로 이동
        const hashToTab = {
            '#step1': 'tabInfo',
            '#step2': 'tabStudentAnalysis',
            '#step3': 'tabContract',
            '#step4': 'tabPayment',
            '#step5': 'tabUsage'
        };
        
        // hash가 유효하면 사용, 아니면 기본값
        if (hashToTab[urlHash]) {
            activeTab = hashToTab[urlHash];
        }
    }
    
    // 모든 탭 컨텐츠 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // 활성화할 탭만 표시
    const activeTabElement = document.getElementById(activeTab);
    if (activeTabElement) {
        activeTabElement.style.display = 'block';
    }
    
    // 사이드바 네비게이션 활성화
    document.querySelectorAll('.step-nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-tab') === activeTab) {
            link.classList.add('active');
        }
    });
    
    // ========================================
    // 사이드바 클릭 이벤트 설정 (URL hash 업데이트)
    // ========================================
    setupSidebarNavigation();
    
    } catch (error) {
        console.error('Error loading student tabs:', error);
    }
}

/**
 * 사이드바 네비게이션 클릭 이벤트 설정
 */
function setupSidebarNavigation() {
    const tabToHash = {
        'tabInfo': '#step1',
        'tabStudentAnalysis': '#step2',
        'tabContract': '#step3',
        'tabPayment': '#step4',
        'tabUsage': '#step5'
    };
    
    document.querySelectorAll('.step-nav-link').forEach(link => {
        const tabName = link.getAttribute('data-tab');
        
        // 내 대시보드 링크는 제외
        if (!tabName) return;
        
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // 모든 탭 숨기기
            document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
            });
            
            // 선택한 탭 표시
            const targetTab = document.getElementById(tabName);
            if (targetTab) {
                targetTab.style.display = 'block';
            }
            
            // 사이드바 활성화 상태 업데이트
            document.querySelectorAll('.step-nav-link').forEach(l => {
                l.classList.remove('active');
            });
            link.classList.add('active');
            
            // URL hash 업데이트 (브라우저 히스토리에 추가)
            if (tabToHash[tabName]) {
                window.location.hash = tabToHash[tabName];
            }
        });
    });
}

// 학생용 탭 전환
function switchStudentTab(tabName) {
    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.student-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // 모든 탭 컨텐츠 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // 선택한 탭 활성화
    const targetTab = tabName === 'info' ? 'tabInfo' : 
                     tabName === 'studentAnalysis' ? 'tabStudentAnalysis' :
                     tabName === 'contract' ? 'tabContract' :
                     tabName === 'payment' ? 'tabPayment' :
                     'tabUsage';
    
    document.getElementById(targetTab).style.display = 'block';
    
    // 버튼 활성화
    event.target.classList.add('active');
}

// ==================== Phase 2: 계약 & 입금 관련 함수 ====================

// 학생용 계약서 탭 로드
async function loadContractTab(app) {
    const contractContent = document.getElementById('tabContract');
    if (!contractContent) return;

    // 계약서가 발송되지 않았으면
    if (!app.contract_sent) {
        contractContent.innerHTML = `
            <div style="text-align: center; padding: 80px 40px; color: #94a3b8;">
                <i class="fas fa-lock" style="font-size: 64px; margin-bottom: 24px; color: #cbd5e1;"></i>
                <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #64748b;">계약서 대기 중</h3>
                <p style="font-size: 15px; line-height: 1.6;">
                    관리자가 계약서를 발송하면 이곳에 표시됩니다.<br/>
                    개별분석에 동의하신 후 24시간 이내에 계약서가 발송됩니다.
                </p>
            </div>
        `;
        return;
    }

    // 계약서 이미 동의했으면
    if (app.contract_agreed) {
        const contractHTML = await getContractDisplay(app);
        contractContent.innerHTML = `
            <div style="background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%); padding: 32px; border-radius: 16px; border: 2px solid #22c55e; margin-bottom: 32px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 32px; color: #22c55e;"></i>
                    <div>
                        <h3 style="font-size: 20px; font-weight: 700; color: #166534; margin: 0;">✅ 계약 완료</h3>
                        <p style="font-size: 14px; color: #15803d; margin: 8px 0 0 0;">
                            ${new Date(app.contract_agreed_at).toLocaleString('ko-KR')}에 계약에 동의하셨습니다.
                        </p>
                    </div>
                </div>
                <p style="font-size: 15px; color: #166534; margin: 0; line-height: 1.6;">
                    다음 단계로 입금 안내가 발송됩니다.
                </p>
            </div>
            ${contractHTML}
        `;
        setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); }, 50);
        return;
    }

    // 타이머 계산
    const sentTime = new Date(app.contract_sent_at).getTime();
    const now = Date.now();
    const elapsed = now - sentTime;
    const remaining = (24 * 60 * 60 * 1000) - elapsed;

    // 24시간 초과
    if (remaining <= 0) {
        const contractHTML = await getContractDisplay(app);
        contractContent.innerHTML = `
            <div style="background: linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%); padding: 32px; border-radius: 16px; border: 2px solid #ef4444; margin-bottom: 32px;">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 32px; color: #dc2626;"></i>
                    <div>
                        <h3 style="font-size: 20px; font-weight: 700; color: #991b1b; margin: 0;">⚠️ 동의 기한 초과</h3>
                        <p style="font-size: 14px; color: #b91c1c; margin: 8px 0 0 0;">
                            계약 동의 기한 24시간이 초과되었습니다.
                        </p>
                    </div>
                </div>
                <p style="font-size: 15px; color: #991b1b; margin: 16px 0 0 0; line-height: 1.6;">
                    관리자에게 문의하여 계약 기한을 연장해 주세요.
                </p>
            </div>
            ${contractHTML}
        `;
        setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); }, 50);
        return;
    }

    // 계약 동의 대기 중 (타이머 표시)
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    const timerColor = hours < 6 ? '#dc2626' : '#9480c5';
    const timerBg = hours < 6 ? '#fee2e2' : '#f8f4ff';

    const contractHTML = await getContractDisplay(app);

    contractContent.innerHTML = `
        <div style="background: ${timerBg}; padding: 24px; border-radius: 12px; border: 2px solid ${timerColor}; margin-bottom: 32px;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <i class="fas fa-clock" style="font-size: 24px; color: ${timerColor};"></i>
                    <div>
                        <h4 style="font-size: 16px; font-weight: 600; color: ${timerColor}; margin: 0;">계약 동의 기한</h4>
                        <p style="font-size: 13px; color: ${timerColor}; opacity: 0.8; margin: 4px 0 0 0;">
                            ${new Date(sentTime).toLocaleString('ko-KR')}부터 24시간
                        </p>
                    </div>
                </div>
                <div style="background: white; padding: 12px 24px; border-radius: 8px; border: 2px solid ${timerColor};">
                    <span id="contractTimer" style="font-size: 24px; font-weight: 700; color: ${timerColor};">
                        ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}
                    </span>
                    <span style="font-size: 14px; color: ${timerColor}; margin-left: 8px; position: relative; top: -5px;">남음</span>
                </div>
            </div>
        </div>
        
        ${contractHTML}
        
        <div style="background: #f8fafc; padding: 32px; border-radius: 16px; margin-top: 32px;">
            <h3 style="font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 24px 0;">
                <i class="fas fa-check-square" style="color: #9480c5; margin-right: 8px;"></i>
                계약 동의
            </h3>
            
            <button onclick="submitContractAgreement()" 
                    id="submitContractBtn"
                    style="width: 100%; padding: 18px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%); 
                           color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; 
                           cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(148, 128, 197, 0.3);">
                <i class="fas fa-check-circle" style="margin-right: 8px;"></i>
                계약에 동의하고 제출합니다
            </button>
            
            <p style="font-size: 13px; color: #64748b; text-align: center; margin: 16px 0 0 0; line-height: 1.6;">
                모든 빈칸을 작성하고 버튼을 클릭하면 다음 단계로 진행됩니다.
            </p>
        </div>
    `;

    // 타이머 업데이트
    startContractTimer(sentTime);
    
    // 렌더링 후 넘치는 입력 필드 보정
    setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); }, 50);
}

/**
 * 저장된 계약서 입력값을 필드에 채우기
 */
function fillContractInputs(contractInputs) {
    if (!contractInputs) {
        console.log('No contract inputs to fill');
        return;
    }
    
    // 문자열이면 객체로 변환
    if (typeof contractInputs === 'string') {
        try {
            contractInputs = JSON.parse(contractInputs);
        } catch (e) {
            console.log('Failed to parse contract inputs:', e);
            return;
        }
    }
    
    if (typeof contractInputs !== 'object') {
        console.log('Invalid contract inputs type');
        return;
    }
    
    console.log('Filling contract inputs:', contractInputs);
    
    // 모든 계약서 입력 필드 찾기
    const inputs = document.querySelectorAll('.contract-input');
    
    inputs.forEach(input => {
        const fieldId = input.dataset.fieldId;
        const name = input.getAttribute('name');
        
        // fieldId 또는 name으로 매칭되는 값 찾기
        let value = null;
        
        if (fieldId && contractInputs[fieldId]) {
            value = contractInputs[fieldId];
        } else if (name && contractInputs[name]) {
            value = contractInputs[name];
        }
        
        // 값이 있으면 입력 필드에 채우기
        if (value) {
            input.value = value;
            
            // 따라쓰기 필드인 경우 검증
            if (input.classList.contains('contract-input-copy')) {
                validateCopywrite(input);
            }
            
            console.log(`Filled field ${fieldId || name}:`, value);
        }
    });
    
    console.log('Contract inputs filled successfully');
}

// 계약서 본문 표시 (스냅샷 기반)
async function getContractDisplay(app) {
    try {
        console.log('Loading contract for student...');
        
        // 스냅샷이 있으면 스냅샷 사용 (우선순위)
        if (app.contract_snapshot) {
            console.log('Using contract snapshot:', app.contract_version);
            
            // 학생 데이터 준비
            const studentData = {
                name: app.name,
                email: app.email,
                phone: app.phone,
                assigned_program: app.assigned_program,
                schedule_start: app.schedule_start,
                schedule_end: app.schedule_end,
                final_price: (app.final_price || 0).toLocaleString(),
                program_price: (app.program_price || 0).toLocaleString(),
                discount_amount: (app.discount_amount || 0).toLocaleString(),
                additional_discount: (app.additional_discount || 0).toLocaleString(),
                contract_date: new Date().toLocaleDateString('ko-KR')
            };
            
            // 스냅샷 파싱
            const parsedHTML = parseContractTemplate(app.contract_snapshot, studentData);
            
            // 계약서 HTML 반환
            const contractHTML = `
                ${getContractStyles()}
                <div class="contract-content" id="contractContent">
                    <h2 style="text-align: center; font-size: 28px; font-weight: 700; margin: 0 0 32px 0; color: #1e293b;">
                        ${escapeHtml(app.contract_title || '이온토플 수강 계약서')}
                    </h2>
                    <div style="white-space: pre-wrap;">
                        ${parsedHTML}
                    </div>
                </div>
            `;
            
            // 계약서가 이미 동의되었고 contract_inputs가 있으면 입력값 채우기
            if (app.contract_agreed && app.contract_inputs) {
                // HTML을 반환한 후, DOM에 추가되면 입력값 채우기
                setTimeout(() => {
                    fillContractInputs(app.contract_inputs);
                }, 100);
            }
            
            return contractHTML;
        }
        
        // 스냅샷이 없으면 contracts 테이블에서 로드 (하위 호환성)
        console.log('No snapshot, loading from contracts table...');
        const result = await supabaseAPI.query('contracts', { 'is_active': 'eq.true', 'limit': '1' });
        console.log('Contract API result:', result);
        
        if (result && result.length > 0) {
            const contract = result[0];
            console.log('Contract found:', contract.title, 'version:', contract.version);
            
            // 학생 데이터 준비
            const studentData = {
                name: app.name,
                email: app.email,
                phone: app.phone,
                assigned_program: app.assigned_program,
                schedule_start: app.schedule_start,
                schedule_end: app.schedule_end,
                final_price: (app.final_price || 0).toLocaleString(),
                program_price: (app.program_price || 0).toLocaleString(),
                discount_amount: (app.discount_amount || 0).toLocaleString(),
                additional_discount: (app.additional_discount || 0).toLocaleString(),
                contract_date: new Date().toLocaleDateString('ko-KR')
            };
            
            console.log('Student data prepared:', studentData);
            
            // parseContractTemplate 함수 존재 확인
            if (typeof parseContractTemplate === 'undefined') {
                console.error('parseContractTemplate function is not defined!');
                console.error('Check if contract-utils.js is loaded properly');
                throw new Error('계약서 파싱 함수가 로드되지 않았습니다. 페이지를 새로고침해주세요.');
            }
            
            // 계약서 템플릿 파싱
            const parsedHTML = parseContractTemplate(contract.content, studentData);
            console.log('Contract template parsed successfully');
            
            const contractHTML = `
                ${getContractStyles()}
                <div class="contract-content" id="contractContent">
                    <h2 style="text-align: center; font-size: 28px; font-weight: 700; margin: 0 0 32px 0; color: #1e293b;">
                        ${escapeHtml(contract.title)}
                    </h2>
                    <div style="white-space: pre-wrap;">
                        ${parsedHTML}
                    </div>
                </div>
            `;
            
            // 계약서가 이미 동의되었고 contract_inputs가 있으면 입력값 채우기
            if (app.contract_agreed && app.contract_inputs) {
                setTimeout(() => {
                    fillContractInputs(app.contract_inputs);
                }, 100);
            }
            
            return contractHTML;
        } else {
            // 계약서 템플릿이 없으면 기본 메시지
            console.warn('No active contract found in database');
            return `
                <div style="padding: 40px; text-align: center; color: #64748b;">
                    <i class="fas fa-file-contract" style="font-size: 48px; margin-bottom: 16px; color: #cbd5e1;"></i>
                    <p style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">계약서 템플릿이 준비되지 않았습니다.</p>
                    <p style="font-size: 14px; color: #94a3b8;">관리자가 계약서를 등록하면 이곳에 표시됩니다.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Failed to load contract:', error);
        console.error('Error stack:', error.stack);
        return `
            <div style="padding: 40px; text-align: center; color: #ef4444;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">계약서를 불러오는데 실패했습니다.</p>
                <p style="font-size: 14px; color: #94a3b8;">오류: ${escapeHtml(error.message)}</p>
                <p style="font-size: 13px; color: #94a3b8; margin-top: 16px;">관리자에게 문의해주세요.</p>
            </div>
        `;
    }
}

// 계약서 본문 표시 (기존 하드코딩 방식 - 백업용)
function getContractDisplayOld(app) {
    const contractContent = `
<div style="background: white; padding: 40px; border-radius: 16px; border: 2px solid #e2e8f0; line-height: 1.8; color: #1e293b;">
    <h2 style="text-align: center; font-size: 28px; font-weight: 700; margin: 0 0 32px 0; color: #1e293b;">
        프로그램 이용 계약서
    </h2>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제1조 (계약 당사자)
        </h3>
        <p style="margin: 0 0 12px 0; font-size: 15px;">
            <strong>가. 서비스 제공자:</strong> 이온토플 (Ion TOEFL)<br/>
            - 대표자: 김민서<br/>
            - 사업자등록번호: 123-45-67890<br/>
            - 소재지: 서울특별시 강남구 테헤란로 123<br/>
            - 연락처: 02-1234-5678 / contact@iontoefl.com
        </p>
        <p style="margin: 0; font-size: 15px;">
            <strong>나. 서비스 이용자 (이하 "회원"):</strong><br/>
            - 성명: ${app.name || 'N/A'}<br/>
            - 이메일: ${app.email || 'N/A'}<br/>
            - 전화번호: ${app.phone || 'N/A'}
        </p>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제2조 (프로그램 정보)
        </h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
            <tr style="background: #f8fafc;">
                <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600; width: 30%;">프로그램명</td>
                <td style="padding: 12px; border: 1px solid #e2e8f0;">${app.assigned_program || 'N/A'}</td>
            </tr>
            <tr>
                <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">수강 기간</td>
                <td style="padding: 12px; border: 1px solid #e2e8f0;">${app.schedule_start || 'N/A'} ~ ${app.schedule_end || 'N/A'}</td>
            </tr>
            <tr style="background: #f8fafc;">
                <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">정가</td>
                <td style="padding: 12px; border: 1px solid #e2e8f0;">${(app.program_price || 0).toLocaleString()}원</td>
            </tr>
            <tr>
                <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">시험료 지원</td>
                <td style="padding: 12px; border: 1px solid #e2e8f0;">-${(app.discount_amount || 0).toLocaleString()}원</td>
            </tr>
            <tr style="background: #f8fafc;">
                <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">추가 할인</td>
                <td style="padding: 12px; border: 1px solid #e2e8f0;">-${(app.additional_discount || 0).toLocaleString()}원 ${app.discount_reason ? '(' + app.discount_reason + ')' : ''}</td>
            </tr>
            <tr>
                <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">보증금</td>
                <td style="padding: 12px; border: 1px solid #e2e8f0;">+100,000원 (환급 가능)</td>
            </tr>
            <tr style="background: #fff4e6;">
                <td style="padding: 12px; border: 2px solid #9480c5; font-weight: 700; font-size: 16px;">최종 입금 금액</td>
                <td style="padding: 12px; border: 2px solid #9480c5; font-weight: 700; font-size: 16px; color: #9480c5;">${(app.final_price || 0).toLocaleString()}원</td>
            </tr>
        </table>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제3조 (출석 및 과제)
        </h3>
        <ol style="padding-left: 24px; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 12px;">회원은 프로그램 기간 동안 주 5일 이상 플랫폼에 접속하여 학습해야 합니다.</li>
            <li style="margin-bottom: 12px;">일일 학습 시간은 최소 2시간 이상을 권장하며, 미달 시 목표 달성이 어려울 수 있습니다.</li>
            <li style="margin-bottom: 12px;">제공되는 모든 과제는 기한 내에 제출해야 하며, 미제출 시 피드백이 제한될 수 있습니다.</li>
            <li style="margin-bottom: 0;">수강 기간 중 3일 이상 연속 미접속 시, 관리자가 학습 동기 부여를 위해 연락할 수 있습니다.</li>
        </ol>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제4조 (진단 테스트)
        </h3>
        <ol style="padding-left: 24px; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 12px;">프로그램 시작 전, 현재 실력을 파악하기 위한 진단 테스트를 실시합니다.</li>
            <li style="margin-bottom: 12px;">프로그램 종료 후, 최종 실력 향상도를 측정하기 위한 최종 테스트를 실시합니다.</li>
            <li style="margin-bottom: 0;">진단 테스트 결과는 학습 계획 수립 및 맞춤 피드백 제공에 활용됩니다.</li>
        </ol>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제5조 (환불 규정)
        </h3>
        <ol style="padding-left: 24px; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 12px;"><strong>프로그램 시작 전 취소:</strong> 전액 환불 (100%)</li>
            <li style="margin-bottom: 12px;"><strong>프로그램 시작 후 7일 이내:</strong> 80% 환불</li>
            <li style="margin-bottom: 12px;"><strong>프로그램 진행률 25% 이내:</strong> 50% 환불</li>
            <li style="margin-bottom: 12px;"><strong>프로그램 진행률 50% 이내:</strong> 30% 환불</li>
            <li style="margin-bottom: 12px;"><strong>프로그램 진행률 50% 초과:</strong> 환불 불가</li>
            <li style="margin-bottom: 0;">환불 요청은 이메일(contact@iontoefl.com) 또는 고객센터(02-1234-5678)를 통해 신청하실 수 있습니다.</li>
        </ol>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제6조 (보증금 환급)
        </h3>
        <ol style="padding-left: 24px; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 12px;">보증금 100,000원은 프로그램 성실 수료 시 전액 환급됩니다.</li>
            <li style="margin-bottom: 12px;"><strong>환급 조건:</strong> 출석률 80% 이상 + 과제 제출률 90% 이상</li>
            <li style="margin-bottom: 12px;">환급 조건 미달 시, 보증금은 환급되지 않습니다.</li>
            <li style="margin-bottom: 0;">환급은 프로그램 종료 후 7영업일 이내에 회원이 등록한 환불 계좌로 입금됩니다.</li>
        </ol>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제7조 (개인정보 처리)
        </h3>
        <ol style="padding-left: 24px; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 12px;"><strong>수집 항목:</strong> 성명, 이메일, 전화번호, 학습 기록, 과제 제출 내역, 진단 테스트 결과</li>
            <li style="margin-bottom: 12px;"><strong>이용 목적:</strong> 프로그램 제공, 학습 관리, 피드백 제공, 고객 상담</li>
            <li style="margin-bottom: 12px;"><strong>보유 기간:</strong> 프로그램 종료 후 1년 (법령에 따라 더 긴 기간 보관 가능)</li>
            <li style="margin-bottom: 0;">회원은 언제든지 개인정보 열람, 수정, 삭제를 요청할 수 있습니다.</li>
        </ol>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제8조 (계약 해지)
        </h3>
        <ol style="padding-left: 24px; margin: 0; font-size: 15px;">
            <li style="margin-bottom: 12px;">회원이 본 계약을 위반하거나 부당한 방법으로 서비스를 이용할 경우, 서비스 제공자는 계약을 해지할 수 있습니다.</li>
            <li style="margin-bottom: 12px;">계약 해지 시, 환불 규정에 따라 환불이 진행됩니다.</li>
            <li style="margin-bottom: 0;">불가항력(천재지변, 전염병 등)으로 인한 서비스 중단 시, 상호 협의하여 계약을 연장하거나 환불합니다.</li>
        </ol>
    </div>
    
    <div style="margin-bottom: 32px;">
        <h3 style="font-size: 20px; font-weight: 600; margin: 0 0 16px 0; color: #334155; border-bottom: 2px solid #9480c5; padding-bottom: 8px;">
            제9조 (분쟁 해결)
        </h3>
        <p style="margin: 0; font-size: 15px;">
            본 계약과 관련된 분쟁은 상호 협의를 통해 우선 해결하며, 협의가 이루어지지 않을 경우 서울중앙지방법원을 관할 법원으로 합니다.
        </p>
    </div>
    
    <div style="background: #f8fafc; padding: 24px; border-radius: 12px; margin-top: 40px;">
        <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #1e293b;">본 계약서는 2026년 2월 13일에 작성되었습니다.</p>
        <p style="margin: 0; font-size: 14px; color: #64748b;">
            상기 내용을 확인하였으며, 계약 조건에 동의합니다.
        </p>
    </div>
</div>
    `;

    return contractContent;
}

// 계약서 타이머 시작
function startContractTimer(sentTime) {
    const timerInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - sentTime;
        const remaining = (24 * 60 * 60 * 1000) - elapsed;

        if (remaining <= 0) {
            clearInterval(timerInterval);
            const timerElem = document.getElementById('contractTimer');
            if (timerElem) {
                timerElem.textContent = '00:00';
                timerElem.style.color = '#dc2626';
            }
            return;
        }

        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

        const timerElem = document.getElementById('contractTimer');
        if (timerElem) {
            timerElem.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }, 1000);
}

// 계약 동의 제출
async function submitContractAgreement() {
    // 1. 계약서 입력값 검증
    const validation = validateContractInputs();
    
    if (!validation.valid) {
        alert('⚠️ 계약서를 작성해주세요:\n\n' + validation.errors.join('\n'));
        return;
    }

    if (!confirm('계약에 동의하시겠습니까?\n\n모든 입력 내용을 확인하셨나요?\n동의하시면 다음 단계인 입금 안내로 자동 진행됩니다.')) {
        return;
    }

    // 버튼 비활성화
    const submitBtn = document.getElementById('submitContractBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i>처리 중...';
    }

    try {
        const updateData = {
            contract_agreed: true,
            contract_agreed_at: Date.now(),
            contract_inputs: validation.inputs, // 학생이 입력한 데이터 저장
            current_step: 4
        };

        const updatedApp = await supabaseAPI.patch('applications', globalApplication.id, updateData);

        if (!updatedApp) throw new Error('Failed to update');

        globalApplication = updatedApp;

        // 텔레그램 알림: 3번 - 계약서 서명 완료
        try {
            await sendEdgeFunctionNotify('contract_signed', {
                name: globalApplication.name,
                program: globalApplication.assigned_program || globalApplication.preferred_program,
                app_id: globalApplication.id
            });
        } catch (e) { console.warn('텔레그램 알림 실패:', e); }

        // 알림톡: 입금 안내
        try {
            const settings = await getSiteSettings();
            await sendKakaoAlimTalk('payment_request', {
                name: globalApplication.name || _studentInfo.name,
                phone: globalApplication.phone || _studentInfo.phone,
                price: String((globalApplication.final_price || _studentInfo.final_price || 0).toLocaleString()),
                bank: settings?.bank_name || '',
                account: settings?.account_number || '',
                holder: settings?.account_holder || '',
                app_id: globalApplication.id || _studentInfo.id
            });
        } catch (e) { console.warn('알림톡 발송 실패:', e); }

        alert('✅ 계약 동의가 완료되었습니다!\n\n입금 안내로 자동 진행됩니다.');
        
        // Step 4 (입금 탭)로 이동
        window.location.hash = '#step4';
        location.reload();

    } catch (error) {
        console.error('Error:', error);
        alert('계약 동의 처리 중 오류가 발생했습니다.');
        
        // 버튼 재활성화
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check-circle" style="margin-right: 8px;"></i>계약에 동의하고 제출합니다';
        }
    }
}

/**
 * 이용가 및 할인 내역 박스 생성
 * @param {Object} app - 신청서 데이터
 * @param {boolean} showPaymentNotice - 결제 안내 문구 표시 여부 (기본값: true, Step 4에서는 false)
 */
function getPricingBox(app, showPaymentNotice = true) {
    if (!app.assigned_program) return '';
    
    return `
        <style>
            @media (min-width: 768px) {
                .pb-title { font-size: 17px !important; }
                .pb-label { font-size: 15px !important; }
                .pb-value { font-size: 15px !important; }
                .pb-reason { font-size: 14px !important; }
                .pb-note { font-size: 11.5px !important; }
                .pb-final-label { font-size: 16px !important; }
                .pb-final-value { font-size: 22px !important; }
                .pb-info { font-size: 13px !important; }
            }
        </style>
        <div style="padding: 20px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px;">
            <div class="pb-title" style="font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 14px; display: flex; align-items: center; gap: 6px;">
                <i class="fas fa-receipt" style="color: #9480c5;"></i> 이용가 및 할인 내역
            </div>
            
            ${app.program_price ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">정가</span>
                <span class="pb-value" style="font-weight: 600; color: #1e293b; font-size: 13px;">${app.program_price.toLocaleString()}원</span>
            </div>
            ` : ''}
            
            ${app.discount_amount ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">시험료 지원</span>
                <span class="pb-value" style="font-weight: 600; color: #22c55e; font-size: 13px;">-${app.discount_amount.toLocaleString()}원</span>
            </div>
            <div style="padding: 8px 0 12px 0; border-bottom: 1px solid #f1f5f9;">
                <p class="pb-note" style="font-size: 10px; color: #64748b; line-height: 1.5; margin: 0;">
                    ※ 실제시험 2회 진행 및 점수 인증, 후기 1회 작성 조건이 포함되어있습니다.
                </p>
            </div>
            ` : ''}
            
            ${app.correction_enabled && app.correction_fee ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">스라첨삭 (Speaking & Writing)</span>
                <span class="pb-value" style="font-weight: 600; color: #3b82f6; font-size: 13px;">+${app.correction_fee.toLocaleString()}원</span>
            </div>
            ` : ''}
            
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">실제 이용가</span>
                <span class="pb-value" style="font-weight: 600; color: #1e293b; font-size: 13px;">${((app.program_price || 1000000) - (app.discount_amount || 210000) + (app.correction_fee || 0)).toLocaleString()}원</span>
            </div>
            
            ${app.additional_discount ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">추가 할인</span>
                <span class="pb-value" style="font-weight: 600; color: #ef4444; font-size: 13px;">-${app.additional_discount.toLocaleString()}원</span>
            </div>
            ` : ''}
            
            ${app.discount_reason ? `
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">할인 사유</span>
                <span class="pb-reason" style="font-weight: 600; color: #1e293b; font-size: 12px;">${escapeHtml(app.discount_reason)}</span>
            </div>
            ` : ''}
            
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
                <span class="pb-label" style="color: #64748b; font-size: 13px;">보증금 (환불)</span>
                <span class="pb-value" style="font-weight: 600; color: #3b82f6; font-size: 13px;">+100,000원</span>
            </div>
            <div style="padding: 8px 0 12px 0; border-bottom: 1px solid #f1f5f9;">
                <p class="pb-note" style="font-size: 10px; color: #64748b; line-height: 1.5; margin: 0;">
                    ※ 과제 인증률에 따라 환불되는 금액입니다.
                </p>
            </div>
            
            ${app.final_price ? `
            <div style="display: flex; justify-content: space-between; padding: 16px 0; margin-top: 8px;">
                <span class="pb-final-label" style="color: #1e293b; font-size: 14px; font-weight: 700;">최종 입금금액</span>
                <span class="pb-final-value" style="font-weight: 700; color: #9480c5; font-size: 19px;">${app.final_price.toLocaleString()}원</span>
            </div>
            <div style="padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 12px;">
                <p class="pb-info" style="font-size: 11px; color: #475569; line-height: 1.7; margin: 0;">
                    ✓ <strong>일절 추가 금액 없으며, 모든 것이 포함된 금액입니다.</strong><br>
                    ✓ 중간에 목표점수 달성 시, 아직 시작하지 않은 프로그램은 <strong>전액환불</strong>이 가능합니다.${showPaymentNotice ? '<br>✓ <strong>결제는 최종적으로 프로그램 및 가격, 계약서까지 동의 후 가장 마지막에 진행됩니다.</strong>' : ''}
                </p>
            </div>
            ` : ''}
        </div>
    `;
}

// 학생용 입금안내 탭 로드
async function loadPaymentTab(app) {
    const paymentContent = document.getElementById('tabPayment');
    if (!paymentContent) return;
    
    // 입금 정보 HTML 미리 생성
    const paymentInfoHtml = await getPaymentInfo(app);

    // 계약이 완료되지 않았으면
    if (!app.contract_agreed) {
        paymentContent.innerHTML = `
            <div style="text-align: center; padding: 80px 40px; color: #94a3b8;">
                <i class="fas fa-lock" style="font-size: 48px; margin-bottom: 20px; color: #cbd5e1;"></i>
                <h3 style="font-size: 17px; font-weight: 600; margin-bottom: 10px; color: #64748b;">입금 안내 대기 중</h3>
                <p style="font-size: 13px; line-height: 1.6;">
                    계약서에 동의하시면 입금 안내가 표시됩니다.<br/>
                    먼저 계약서 탭에서 계약에 동의해 주세요.
                </p>
            </div>
        `;
        return;
    }

    // 입금 완료 확인되었으면
    if (app.deposit_confirmed_by_admin) {
        paymentContent.innerHTML = `
            <div style="background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%); padding: 32px; border-radius: 16px; border: 2px solid #22c55e; margin-bottom: 32px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 26px; color: #22c55e;"></i>
                    <div>
                        <h3 style="font-size: 17px; font-weight: 700; color: #166534; margin: 0;">✅ 입금 확인 완료</h3>
                        <p style="font-size: 12px; color: #15803d; margin: 6px 0 0 0;">
                            ${new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR')}에 입금이 확인되었습니다.
                        </p>
                    </div>
                </div>
                <p style="font-size: 13px; color: #166534; margin: 0; line-height: 1.6;">
                    입금액: <strong>${(app.final_price || 0).toLocaleString()}원</strong><br/>
                    곧 이용 방법 안내가 발송됩니다.
                </p>
            </div>
            
            ${getPricingBox(app, false)}
        `;
        return;
    }

    // 학생이 입금 완료 버튼을 눌렀으면
    if (app.deposit_confirmed_by_student) {
        paymentContent.innerHTML = `
            <div style="background: linear-gradient(135deg, #fff4e6 0%, #fefce8 100%); padding: 32px; border-radius: 16px; border: 2px solid #f59e0b; margin-bottom: 32px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-clock" style="font-size: 26px; color: #f59e0b;"></i>
                    <div>
                        <h3 style="font-size: 17px; font-weight: 700; color: #92400e; margin: 0;">⏳ 입금 확인 대기 중</h3>
                        <p style="font-size: 12px; color: #a16207; margin: 6px 0 0 0;">
                            ${new Date(app.deposit_confirmed_by_student_at).toLocaleString('ko-KR')}에 입금 완료 알림을 보내셨습니다.
                        </p>
                    </div>
                </div>
                <p style="font-size: 15px; color: #92400e; margin: 0; line-height: 1.6;">
                    관리자가 입금을 확인 중입니다.<br/>
                    확인 후 이용 방법 전달 및 챌린지 시작을 위한 준비가 진행됩니다.
                </p>
            </div>
            
            ${paymentInfoHtml}
        `;
        return;
    }

    // 입금 안내 표시
    // 입금 데드라인 계산 (계약 동의 후 24시간)
    let deadlineHTML = '';
    if (app.contract_agreed_at) {
        const agreedTime = new Date(app.contract_agreed_at).getTime();
        const now = Date.now();
        const elapsed = now - agreedTime;
        const remaining = (24 * 60 * 60 * 1000) - elapsed;
        
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
        
        let timerColor = '#dc2626'; // 레드
        let timerBg = '#fee2e2';
        let timerBorder = '#fca5a5';
        let timerIcon = 'fa-clock';
        let timerTextColor = '#991b1b';
        
        if (remaining <= 0) {
            timerColor = '#dc2626';
            timerBg = '#fef2f2';
            timerBorder = '#f87171';
            timerIcon = 'fa-exclamation-triangle';
            timerTextColor = '#7f1d1d';
        } else if (hours <= 6) {
            timerColor = '#dc2626';
            timerBg = '#fee2e2';
            timerBorder = '#f87171';
            timerTextColor = '#991b1b';
        }
        
        deadlineHTML = `
            <div style="background: linear-gradient(135deg, ${timerBg} 0%, #fef2f2 100%); padding: 20px; border-radius: 14px; border: 2px solid ${timerBorder}; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.1);">
                <div class="payment-deadline-flex" style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div style="background: white; padding: 12px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(220, 38, 38, 0.15);">
                        <i class="fas ${timerIcon}" style="font-size: 24px; color: ${timerColor};"></i>
                    </div>
                    <div style="flex: 1; min-width: 130px;">
                        <h3 style="font-size: 17px; font-weight: 700; color: ${timerColor}; margin: 0 0 6px 0;">
                            ⏰ 입금 기한 안내
                        </h3>
                        <p style="font-size: 13px; color: ${timerTextColor}; margin: 0; line-height: 1.6;">
                            ${remaining > 0 
                                ? `계약 동의 후 <strong style="color: ${timerColor}; font-size: 14px;">24시간 이내</strong>에 입금을 완료해주세요.` 
                                : `<strong style="color: ${timerColor}; font-size: 14px;">입금 기한이 초과되었습니다.</strong> 빠른 입금 부탁드립니다.`
                            }
                        </p>
                    </div>
                    <div class="payment-timer-box" style="text-align: center; padding: 16px; background: white; border-radius: 14px; min-width: 150px; box-shadow: 0 2px 8px rgba(220, 38, 38, 0.1);">
                        <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; font-weight: 600;">남은 시간</div>
                        <div id="paymentTimer" class="payment-timer-text" style="font-size: 30px; font-weight: 700; color: ${timerColor}; line-height: 1; font-family: 'Courier New', monospace;">
                            ${remaining > 0 
                                ? `${String(Math.max(0, hours)).padStart(2, '0')}:${String(Math.max(0, minutes)).padStart(2, '0')}:${String(Math.max(0, seconds)).padStart(2, '0')}`
                                : '00:00:00'
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    paymentContent.innerHTML = paymentInfoHtml + deadlineHTML + `
        <div style="background: #f8fafc; padding: 24px; border-radius: 14px; margin-top: 24px;">
            <h3 style="font-size: 15px; font-weight: 700; color: #1e293b; margin: 0 0 12px 0;">
                <i class="fas fa-credit-card" style="color: #9480c5; margin-right: 6px;"></i>
                입금 완료 확인
            </h3>
            <p style="font-size: 13px; color: #64748b; margin: 0 0 20px 0; line-height: 1.6;">
                위 계좌로 입금을 완료하셨다면 아래 정보를 입력하고 버튼을 눌러 주세요.<br/>
                관리자가 입금을 확인한 후 이용 방법 안내를 보내드립니다.
            </p>
            
            <div style="margin-bottom: 16px;">
                <label for="depositorName" style="display: block; font-size: 12px; font-weight: 600; color: #1e293b; margin-bottom: 6px;">
                    <i class="fas fa-user" style="color: #9480c5; margin-right: 5px;"></i>
                    입금자명 <span style="color: #ef4444;">*</span>
                </label>
                <input type="text" id="depositorName" value="${app.name || ''}" placeholder="실제 입금하신 분의 성함을 입력해주세요"
                       style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; 
                              font-size: 13px; transition: all 0.3s;"
                       onfocus="this.style.borderColor='#9480c5'"
                       onblur="this.style.borderColor='#e2e8f0'">
                <p style="font-size: 11px; color: #64748b; margin: 6px 0 0 0;">
                    💡 본인이 직접 입금하신 경우 그대로 두시고, 다른 분(부모님, 배우자 등)이 입금하신 경우 실제 입금자명으로 수정해주세요.
                </p>
            </div>
            
            <button onclick="confirmDeposit()" 
                    style="width: 100%; padding: 14px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%); 
                           color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; 
                           cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(148, 128, 197, 0.3);">
                <i class="fas fa-check-circle" style="margin-right: 6px;"></i>
                입금 완료했습니다
            </button>
            <p style="font-size: 11px; color: #64748b; text-align: center; margin: 12px 0 0 0; line-height: 1.6;">
                입금 확인 후 자동으로 다음 단계로 진행됩니다.
            </p>
        </div>
    `;
    
    // 실시간 카운트다운 시작
    if (app.contract_agreed_at) {
        const agreedTime = new Date(app.contract_agreed_at).getTime();
        
        const updatePaymentTimer = () => {
            const now = Date.now();
            const elapsed = now - agreedTime;
            const remaining = (24 * 60 * 60 * 1000) - elapsed;
            
            const timerEl = document.getElementById('paymentTimer');
            if (!timerEl) return;
            
            if (remaining <= 0) {
                timerEl.textContent = '00:00:00';
                return;
            }
            
            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
            const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
            
            timerEl.textContent = 
                String(Math.max(0, hours)).padStart(2, '0') + ':' + 
                String(Math.max(0, minutes)).padStart(2, '0') + ':' + 
                String(Math.max(0, seconds)).padStart(2, '0');
        };
        
        // 즉시 한 번 실행
        updatePaymentTimer();
        
        // 1초마다 업데이트
        setInterval(updatePaymentTimer, 1000);
    }
}

// 입금 정보 표시
async function getPaymentInfo(app) {
    // 사이트 설정 불러오기
    const settings = await getSiteSettings();
    const bankName = settings?.bank_name || '국민은행';
    const accountNumber = settings?.account_number || '123-456-789012';
    const accountHolder = settings?.account_holder || '김민서';
    
    return `
        <!-- 입금탭 모바일 반응형 스타일 -->
        <style>
            @media (max-width: 768px) {
                .payment-wrap { padding: 16px !important; }
                .payment-wrap h2 { font-size: 17px !important; margin-bottom: 16px !important; }
                .payment-wrap h2 svg { width: 20px !important; height: 20px !important; }
                .payment-wrap h3 { font-size: 14px !important; }
                .payment-wrap h4 { font-size: 12px !important; }
                .payment-account-section { padding: 14px !important; margin-bottom: 16px !important; }
                .payment-account-section h3 { margin-bottom: 12px !important; }
                .payment-account-table { font-size: 12px !important; }
                .payment-account-table td { padding: 8px 10px !important; }
                .payment-account-number { font-size: 13px !important; letter-spacing: 0 !important; word-break: break-all; }
                .payment-account-value { font-size: 13px !important; }
                .payment-amount-big { font-size: 22px !important; }
                .payment-amount-section { padding: 14px !important; margin-bottom: 16px !important; }
                .payment-info-section { padding: 14px !important; }
                .payment-deadline-flex { gap: 10px !important; }
                .payment-deadline-flex h3 { font-size: 14px !important; }
                .payment-deadline-flex p { font-size: 11px !important; }
                .payment-timer-box { min-width: 0 !important; width: 100% !important; padding: 10px !important; }
                .payment-timer-text { font-size: 24px !important; }
            }
        </style>

        <!-- 이용가 및 할인 내역 -->
        ${getPricingBox(app, false)}
        
        <div class="payment-wrap" style="background: white; padding: 32px; border-radius: 16px; border: 2px solid #e2e8f0; margin-bottom: 24px;">
            <h2 style="text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 24px 0; color: #1e293b;">
                <svg width="28" height="28" viewBox="0 0 24 24" style="display: inline-block; vertical-align: middle; margin-right: 10px;">
                    <rect x="2" y="4" width="20" height="14" rx="2" fill="none" stroke="#9480c5" stroke-width="1.5"/>
                    <rect x="2" y="8" width="20" height="3" fill="#9480c5"/>
                    <line x1="5" y1="15" x2="10" y2="15" stroke="#9480c5" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                입금 안내
            </h2>
            
            <div class="payment-account-section" style="background: #f8fafc; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; margin-bottom: 24px;">
                <h3 style="font-size: 17px; font-weight: 700; color: #1e293b; margin: 0 0 20px 0; text-align: center;">
                    입금 계좌 정보
                </h3>
                <table class="payment-account-table" style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr>
                        <td style="padding: 12px; background: white; border-radius: 12px 12px 0 0; font-weight: 600; white-space: nowrap;">은행</td>
                        <td class="payment-account-value" style="padding: 12px; background: white; border-radius: 12px 12px 0 0; font-size: 15px; font-weight: 700; color: #1e293b;">${bankName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; background: white; font-weight: 600; white-space: nowrap;">계좌번호</td>
                        <td style="padding: 12px; background: white;">
                            <span class="payment-account-number" style="font-size: 19px; font-weight: 700; color: #1e293b; letter-spacing: 0.5px;">${accountNumber}</span>
                            <i class="fas fa-copy" onclick="copyToClipboard('${accountNumber}', '계좌번호')" 
                               style="margin-left: 6px; font-size: 12px; color: #9480c5; cursor: pointer; vertical-align: middle;" 
                               title="계좌번호 복사"></i>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; background: white; border-radius: 0 0 12px 12px; font-weight: 600; white-space: nowrap;">예금주</td>
                        <td class="payment-account-value" style="padding: 12px; background: white; border-radius: 0 0 12px 12px; font-size: 15px; font-weight: 600;">${accountHolder}</td>
                    </tr>
                </table>
            </div>
            
            <div class="payment-amount-section" style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 24px;">
                <h3 style="font-size: 15px; font-weight: 700; color: #1e293b; margin: 0 0 12px 0;">
                    <i class="fas fa-won-sign" style="margin-right: 8px; color: #9480c5;"></i>
                    입금 금액
                </h3>
                <div style="text-align: center; padding: 14px; background: white; border-radius: 12px;">
                    <p style="margin: 0 0 6px 0; font-size: 14px; color: #64748b;">최종 입금 금액</p>
                    <p class="payment-amount-big" style="margin: 0; font-size: 30px; font-weight: 700; color: #9480c5;">
                        ${(app.final_price || 0).toLocaleString()}원
                    </p>
                </div>
                <div style="background: #fffbeb; padding: 12px; border-radius: 8px; margin-top: 12px; border: 1px solid #fde68a;">
                    <p style="font-size: 12px; color: #78716c; margin: 0; text-align: center; line-height: 1.7; font-weight: 600;">
                        ⚠️ <strong>위 금액과 동일하게 입금해주세요</strong><br/>
                        <span style="font-size: 11px; font-weight: 400;">
                            (입금액이 다를 경우 확인이 지연될 수 있습니다)
                        </span>
                    </p>
                </div>
                <p style="font-size: 11px; color: #64748b; margin: 12px 0 0 0; text-align: center; line-height: 1.7;">
                    * 보증금 100,000원 포함<br/>
                    <span style="font-size: 10px;">
                        (과제인증률에 따라 최소 0원 ~ 최대 100,000원 환급)<br/>
                        - 70% 미만: 0원 / 70~94%: 부분 환급 / 95% 이상: 전액 환급
                    </span>
                </p>
            </div>
            
            <div class="payment-info-section" style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
                <h4 style="font-size: 14px; font-weight: 600; color: #1e293b; margin: 0 0 10px 0;">
                    <i class="fas fa-info-circle" style="margin-right: 6px; color: #9480c5;"></i>
                    입금 안내
                </h4>
                <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #64748b; line-height: 1.8;">
                    <li>관리자가 입금을 확인하면 이용 방법 안내가 발송됩니다.</li>
                    <li>입금 관련 문의는 카카오톡으로 해주세요.</li>
                </ul>
            </div>
        </div>
    `;
}

// 입금 완료 확인
async function confirmDeposit() {
    // 입금자명 입력 확인
    const depositorName = document.getElementById('depositorName')?.value.trim();
    
    if (!depositorName) {
        alert('⚠️ 입금자명을 입력해주세요.\n\n실제 입금하신 분의 성함을 입력해야 합니다.');
        document.getElementById('depositorName')?.focus();
        return;
    }
    
    if (!confirm(`입금을 완료하셨습니까?\n\n입금자명: ${depositorName}\n\n확인 버튼을 누르시면 관리자에게 알림이 전송됩니다.`)) {
        return;
    }

    try {
        const updateData = {
            deposit_confirmed_by_student: true,
            deposit_confirmed_by_student_at: Date.now(),
            depositor_name: depositorName,
            current_step: 7  // STEP 7: 입금 대기 중
        };

        const updatedApp = await supabaseAPI.patch('applications', globalApplication.id, updateData);

        if (!updatedApp) throw new Error('Failed to update');

        globalApplication = updatedApp;

        // 텔레그램 알림: 4번 - 입금 완료 (콜백 버튼 포함)
        try {
            await sendEdgeFunctionNotify('deposit_claimed', {
                name: globalApplication.name,
                depositor_name: depositorName,
                app_id: globalApplication.id
            });
        } catch (e) { console.warn('텔레그램 알림 실패:', e); }

        alert('✅ 입금 완료 알림이 전송되었습니다!\n\n관리자가 입금을 확인하면 이용 방법 안내가 발송됩니다.');
        
        // 페이지 새로고침
        location.reload();

    } catch (error) {
        console.error('Error:', error);
        alert('입금 완료 알림 전송 중 오류가 발생했습니다.');
    }
}

// 클립보드에 복사
function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(() => {
        alert(`✅ ${label}가 복사되었습니다.\n\n${text}`);
    }).catch(err => {
        console.error('Copy failed:', err);
        alert('복사에 실패했습니다. 직접 선택하여 복사해 주세요.');
    });
}

// 학생용 이용방법 탭 로드
async function loadUsageTab(app) {
    const usageContent = document.getElementById('tabUsage');
    if (!usageContent) return;
    
    // 사이트 설정 불러오기
    const settings = await getSiteSettings();
    const platformUrl = settings?.platform_url || 'https://study.iontoefl.com';
    const platformLoginGuide = settings?.platform_login_guide || '이메일로 발송된 비밀번호를 사용하세요';
    const kakaoLink = settings?.kakao_link || 'https://business.kakao.com/_FWxcZC/chats';
    
    // DB 기반 이용방법 안내 텍스트
    const necessitiesText = settings?.necessities_text || '';
    const refundWarning = settings?.refund_warning || '';
    const nextActions = settings?.next_actions || '';
    const communicationGuide = settings?.communication_guide || '';
    const usageGuideUrl = settings?.usage_guide_url || 'usage-guide.html';
    
    // 변수 치환 함수
    const replaceVars = (text) => {
        if (!text) return '';
        return text
            .replace(/\{name\}/g, app.name || '')
            .replace(/\{program\}/g, app.assigned_program || '')
            .replace(/\{start_date\}/g, app.schedule_start || '');
    };
    
    // 날짜 포맷 함수 (2026-02-22 → 2026-02-22(일))
    const formatDateWithDay = (dateStr) => {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            const days = ['일', '월', '화', '수', '목', '금', '토'];
            const dayOfWeek = days[date.getDay()];
            return `${dateStr}(${dayOfWeek})`;
        } catch (e) {
            return dateStr;
        }
    };

    // 입금이 확인되지 않았으면
    if (!app.deposit_confirmed_by_admin) {
        usageContent.innerHTML = `
            <div class="step5-wrap" style="text-align: center; padding: 80px 40px; color: #94a3b8;">
                <i class="fas fa-lock" style="font-size: 64px; margin-bottom: 24px; color: #cbd5e1;"></i>
                <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #64748b;">🔒 이용 방법은 입금 확인 후 제공됩니다</h3>
                <p style="font-size: 15px; line-height: 1.6;">
                    기다려 주셔서 감사합니다 ⏳
                </p>
            </div>
        `;
        return;
    }

    // 이용방법이 전달되지 않았으면 (관리자가 아직 안 보냄)
    if (!app.guide_sent) {
        usageContent.innerHTML = `
            <div class="step5-wrap" style="text-align: center; padding: 80px 40px; color: #94a3b8;">
                <i class="fas fa-hourglass-half" style="font-size: 64px; margin-bottom: 24px; color: #cbd5e1;"></i>
                <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #64748b;">⏳ 이용 방법 준비 중</h3>
                <p style="font-size: 15px; line-height: 1.6;">
                    입금이 확인되었습니다!<br>
                    관리자가 이용 방법을 준비하고 있습니다.<br>
                    곧 안내드릴게요 😊
                </p>
            </div>
        `;
        return;
    }

    // 챌린지 이미 시작했으면
    if (app.challenge_start_date) {
        usageContent.innerHTML = `
            <div class="step5-wrap" style="background: white; padding: 40px; border-radius: 16px; border: 2px solid #e2e8f0;">
                <div style="background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%); padding: 32px; border-radius: 16px; border: 2px solid #22c55e; margin-bottom: 32px; text-align: center;">
                    <i class="fas fa-rocket" style="font-size: 64px; color: #22c55e; margin-bottom: 16px;"></i>
                    <h2 style="font-size: 28px; font-weight: 700; color: #166534; margin: 0 0 16px 0;">🎉 챌린지가 시작되었습니다!</h2>
                    <p style="font-size: 16px; color: #15803d; margin: 0;">
                        ${new Date(app.challenge_start_date).toLocaleString('ko-KR')}
                    </p>
                </div>
                
                <div style="background: #f8fafc; padding: 32px; border-radius: 16px; margin-bottom: 24px;">
                    <h3 style="font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 24px 0;">
                        🌐 플랫폼 접속 정보
                    </h3>
                    <div style="background: white; padding: 24px; border-radius: 12px; border: 2px solid #e2e8f0; margin-bottom: 16px;">
                        <p style="margin: 0 0 12px 0; font-size: 15px; color: #64748b;">접속 URL</p>
                        <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #9480c5;">${platformUrl}</p>
                        <button onclick="copyToClipboard('${platformUrl}', 'URL')" 
                                style="padding: 10px 20px; background: #9480c5; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer;">
                            <i class="fas fa-copy"></i> URL 복사
                        </button>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #e2e8f0;">
                            <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;">로그인 ID</p>
                            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${app.email}</p>
                        </div>
                        <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #e2e8f0;">
                            <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;">비밀번호</p>
                            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${platformLoginGuide}</p>
                        </div>
                    </div>
                </div>
                
                <div style="background: #f0f9ff; padding: 24px; border-radius: 12px; border: 1px solid #bae6fd; margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #0c4a6e; margin: 0 0 16px 0;">
                        📅 일정 정보
                    </h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div style="background: white; padding: 16px; border-radius: 8px;">
                            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;">내벨업챌린지 시작일</p>
                            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${app.schedule_start || '-'}</p>
                        </div>
                        <div style="background: white; padding: 16px; border-radius: 8px;">
                            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;">내벨업챌린지 종료일</p>
                            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${app.schedule_end || '-'}</p>
                        </div>
                    </div>
                    ${app.correction_enabled ? `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
                        <div style="background: white; padding: 16px; border-radius: 8px;">
                            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;">스라첨삭 시작일</p>
                            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${app.correction_start_date || '-'}</p>
                        </div>
                        <div style="background: white; padding: 16px; border-radius: 8px;"></div>
                    </div>
                    ` : ''}
                </div>
                
                <!-- 이용방법 링크 -->
                <div style="text-align: center; margin-bottom: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                    <a href="usage-guide.html?type=challenge" target="_blank" 
                       style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%); 
                              color: white; text-decoration: none; border-radius: 12px; font-size: 15px; font-weight: 700; 
                              box-shadow: 0 4px 16px rgba(148, 128, 197, 0.3); transition: all 0.3s;">
                        📖 내벨업챌린지 이용방법 자세히 보기
                    </a>
                    ${app.correction_enabled ? `
                    <a href="usage-guide.html?type=correction" target="_blank" 
                       style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
                              color: white; text-decoration: none; border-radius: 12px; font-size: 15px; font-weight: 700; 
                              box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3); transition: all 0.3s;">
                        📖 첨삭 이용방법 자세히 보기
                    </a>
                    ` : ''}
                </div>
                
                ${necessitiesText ? `
                <div style="background: #fef9ef; padding: 24px; border-radius: 12px; border: 1px solid #fcd34d; margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 16px 0;">
                        ✅ 내벨업챌린지 Necessities
                    </h4>
                    <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #78350f; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(necessitiesText)}</pre>
                </div>
                ` : ''}
                
                ${refundWarning ? `
                <div style="background: #fef2f2; padding: 24px; border-radius: 12px; border: 1px solid #fca5a5; margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #991b1b; margin: 0 0 16px 0;">
                        ⚠️ 환불 불가 조건
                    </h4>
                    <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #7f1d1d; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(refundWarning)}</pre>
                </div>
                ` : ''}
                
                ${nextActions ? `
                <div style="background: #eff6ff; padding: 24px; border-radius: 12px; border: 1px solid #93c5fd; margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #1e3a8a; margin: 0 0 16px 0;">
                        🎯 다음 액션
                    </h4>
                    <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #1e40af; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(nextActions)}</pre>
                </div>
                ` : ''}
                
                ${communicationGuide ? `
                <div style="background: #f0fdf4; padding: 24px; border-radius: 12px; border: 1px solid #86efac; margin-bottom: 24px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #14532d; margin: 0 0 16px 0;">
                        💬 소통 채널
                    </h4>
                    <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #166534; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(communicationGuide)}</pre>
                </div>
                ` : ''}
                
                <div style="background: linear-gradient(135deg, #f8f4ff 0%, #f0ebff 100%); padding: 24px; border-radius: 12px; border: 1px solid #d4c8ef; text-align: center;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #5e4a8b; margin: 0 0 8px 0;">
                        모든 준비가 완료됐어요! 🎉
                    </h4>
                    <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748b; line-height: 1.6;">
                        진행 상황과 프로그램 정보를 대시보드에서 한눈에 확인하세요.
                    </p>
                    <a href="my-dashboard.html" 
                       style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%); 
                              color: white; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; 
                              box-shadow: 0 4px 12px rgba(148, 128, 197, 0.3);">
                        📋 대시보드로 이동
                    </a>
                </div>
            </div>
        `;
        return;
    }

    // 챌린지 시작 전 (STEP 9)
    usageContent.innerHTML = `
        <div class="step5-wrap" style="background: white; padding: 40px; border-radius: 16px; border: 2px solid #e2e8f0;">
            <!-- 개인화 정보 -->
            <div style="background: linear-gradient(135deg, #f8f4ff 0%, #faf5ff 100%); padding: 24px; border-radius: 12px; border: 2px solid #9480c5; margin-bottom: 32px;">
                <h2 style="text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #6d28d9;">
                    📚 내벨업챌린지 이용방법
                </h2>
                <div style="text-align: center; font-size: 16px; color: #6d28d9; line-height: 1.8;">
                    <p style="margin: 0;"><strong>✔️ 성함:</strong> ${app.name}님</p>
                    <p style="margin: 8px 0 0 0;"><strong>✔️ 내벨업챌린지:</strong> ${app.assigned_program || '-'} / ${formatDateWithDay(app.schedule_start)} 시작</p>
                    ${app.correction_enabled ? `
                    <p style="margin: 8px 0 0 0;"><strong>✔️ 스라첨삭:</strong> ${formatDateWithDay(app.correction_start_date)} 시작</p>
                    ` : ''}
                </div>
            </div>
            
            <!-- 플랫폼 접속 정보 -->
            <div style="background: #f8fafc; padding: 32px; border-radius: 16px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 24px 0;">
                    🌐 플랫폼 접속 정보
                </h3>
                <div style="background: white; padding: 24px; border-radius: 12px; border: 2px solid #e2e8f0; margin-bottom: 16px;">
                    <p style="margin: 0 0 12px 0; font-size: 15px; color: #64748b;">접속 URL</p>
                    <a href="${platformUrl}" target="_blank" 
                       style="display: inline-block; margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #9480c5; text-decoration: none; word-break: break-all;">
                        ${platformUrl}
                    </a>
                    ${app.challenge_access_granted ? `
                    <div style="background: #dcfce7; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #22c55e; margin-top: 12px;">
                        <p style="margin: 0; font-size: 14px; color: #166534; font-weight: 600;">
                            ✅ 테스트룸 액세스 완료! 지금 바로 로그인하실 수 있습니다.
                        </p>
                    </div>
                    ` : ''}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #e2e8f0;">
                        <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;">로그인 ID</p>
                        <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${app.email}</p>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #e2e8f0;">
                        <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;">비밀번호</p>
                        <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${platformLoginGuide}</p>
                    </div>
                </div>
            </div>
            
            <!-- 상세 가이드 링크 -->
            <div style="text-align: center; margin-bottom: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                ${usageGuideUrl ? `
                <a href="usage-guide.html?type=challenge" target="_blank" 
                   style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%); 
                          color: white; text-decoration: none; border-radius: 12px; font-size: 16px; font-weight: 700; 
                          box-shadow: 0 4px 16px rgba(148, 128, 197, 0.3); transition: all 0.3s;">
                    📖 내벨업챌린지 이용방법 자세히 보기
                </a>
                ` : ''}
                ${app.correction_enabled ? `
                <a href="usage-guide.html?type=correction" target="_blank" 
                   style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
                          color: white; text-decoration: none; border-radius: 12px; font-size: 16px; font-weight: 700; 
                          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3); transition: all 0.3s;">
                    📖 첨삭 이용방법 자세히 보기
                </a>
                ` : ''}
            </div>
            
            <!-- Necessities -->
            ${necessitiesText ? `
            <div style="background: #fef9ef; padding: 24px; border-radius: 12px; border: 1px solid #fcd34d; margin-bottom: 24px;">
                <h4 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 16px 0;">
                    ✅ 내벨업챌린지 Necessities
                </h4>
                <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #78350f; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(necessitiesText)}</pre>
            </div>
            ` : ''}
            
            <!-- 환불 불가 조건 -->
            ${refundWarning ? `
            <div style="background: #fef2f2; padding: 24px; border-radius: 12px; border: 1px solid #fca5a5; margin-bottom: 24px;">
                <h4 style="font-size: 16px; font-weight: 600; color: #991b1b; margin: 0 0 16px 0;">
                    ⚠️ 환불 불가 조건
                </h4>
                <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #7f1d1d; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(refundWarning)}</pre>
            </div>
            ` : ''}
            
            <!-- 다음 액션 -->
            ${nextActions ? `
            <div style="background: #eff6ff; padding: 24px; border-radius: 12px; border: 1px solid #93c5fd; margin-bottom: 24px;">
                <h4 style="font-size: 16px; font-weight: 600; color: #1e3a8a; margin: 0 0 16px 0;">
                    🎯 이제 뭘하면 되나요?
                </h4>
                <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #1e40af; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(nextActions)}</pre>
            </div>
            ` : ''}
            
            <!-- 소통 채널 -->
            ${communicationGuide ? `
            <div style="background: #f0fdf4; padding: 24px; border-radius: 12px; border: 1px solid #86efac; margin-bottom: 24px;">
                <h4 style="font-size: 16px; font-weight: 600; color: #14532d; margin: 0 0 16px 0;">
                    💬 앞으로의 소통
                </h4>
                <pre style="font-family: 'Pretendard', sans-serif; font-size: 14px; color: #166534; line-height: 1.8; margin: 0; white-space: pre-wrap; word-wrap: break-word;">${replaceVars(communicationGuide)}</pre>
            </div>
            ` : ''}
            
            <!-- 대시보드 이동 -->
            <div style="background: linear-gradient(135deg, #f8f4ff 0%, #f0ebff 100%); padding: 24px; border-radius: 12px; border: 1px solid #d4c8ef; margin-bottom: 32px; text-align: center;">
                <h4 style="font-size: 16px; font-weight: 600; color: #5e4a8b; margin: 0 0 8px 0;">
                    모든 준비가 완료됐어요! 🎉
                </h4>
                <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748b; line-height: 1.6;">
                    진행 상황과 프로그램 정보를 대시보드에서 한눈에 확인하세요.
                </p>
                <a href="my-dashboard.html" 
                   style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%); 
                          color: white; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; 
                          box-shadow: 0 4px 12px rgba(148, 128, 197, 0.3);">
                    📋 대시보드로 이동
                </a>
            </div>
            
            <!-- 다음 단계 안내 (배송 완료 전에만 표시) -->
            ${!globalApplication.shipping_completed ? `
            <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 20px; border-radius: 12px; border-left: 4px solid #9480c5; margin-top: 24px;">
                <h4 style="font-size: 15px; font-weight: 600; color: #1e293b; margin: 0 0 8px 0;">
                    <i class="fas fa-arrow-right" style="color: #9480c5;"></i> 다음 단계
                </h4>
                <p style="font-size: 14px; color: #64748b; margin: 0 0 12px 0;">
                    📦 실물 교재 배송이 진행됩니다. 배송 상태와 운송장 번호는 대시보드에서 확인하세요.
                </p>
                <a href="my-dashboard.html" style="display: inline-flex; align-items: center; gap: 6px; color: #9480c5; font-size: 14px; font-weight: 600; text-decoration: none; transition: gap 0.2s;" onmouseover="this.style.gap='10px'" onmouseout="this.style.gap='6px'">
                    대시보드로 이동 <i class="fas fa-chevron-right"></i>
                </a>
            </div>
            ` : ''}
        </div>
    `;
}

// ==================== Phase 3: 챌린지 시작하기 ====================

// 학생: 챌린지 시작하기
async function startChallenge() {
    if (!confirm('챌린지를 시작하시겠습니까?\n\n시작하면 본격적으로 학습이 시작됩니다. 매일 꾸준히 학습하며 목표를 달성하세요!')) {
        return;
    }

    try {
        const result = await supabaseAPI.patch('applications', globalApplication.id, {
            // current_step은 5에서 유지
            challenge_start_date: Date.now()
        });

        if (result) {
            alert('🎉 챌린지가 시작되었습니다!\n\n매일 꾸준히 학습하며 목표 점수를 달성하세요. 파이팅! 💪');
            location.reload();
        } else {
            alert('❌ 챌린지 시작에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Start challenge error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// ==================== 텔레그램 알림 (Edge Function 경유) ====================

async function sendEdgeFunctionNotify(type, data) {
    await fetch(`${SUPABASE_URL}/functions/v1/telegram-notify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ type, data })
    });
}

// ==================== 카카오 알림톡 (Edge Function 경유) ====================
// sendKakaoAlimTalk()는 supabase-config.js에서 공통 유틸로 정의됨
