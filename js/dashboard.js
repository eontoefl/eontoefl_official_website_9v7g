/**
 * Student Dashboard Script
 * 학생 대시보드 - 진행 상황, 배송 정보, 알림 관리
 */

document.addEventListener('DOMContentLoaded', async function() {
    await checkLogin();
    updateSidebarUserInfo();
    await loadDashboard();
    setupEventListeners();
});

/**
 * 로그인 체크 및 권한 확인
 */
async function checkLogin() {
    const currentUser = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
    
    if (!currentUser.email) {
        alert('로그인이 필요합니다.');
        window.location.href = 'login.html';
        return;
    }

    // 관리자인 경우 관리자 대시보드로 리다이렉트
    if (currentUser.role === 'admin') {
        window.location.href = 'admin-dashboard.html';
        return;
    }
}

/**
 * 대시보드 데이터 로드
 */
async function loadDashboard() {
    try {
        const currentUser = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');

        // 닉네임 미설정 체크
        await checkNicknameSetup(currentUser);
        
        // 사용자의 신청서 로드 (Supabase API 사용) — 삭제되지 않은 것만, 최신순
        const result = await supabaseAPI.query('applications', { 
            'email': `eq.${currentUser.email}`, 
            'deleted': 'neq.true',
            'order': 'created_at.desc',
            'limit': '100' 
        });
        
        // 정확한 이메일 매칭 필터링 + 삭제되지 않은 것만
        const matchedApplications = result?.filter(app => 
            (app.email === currentUser.email || app.user_email === currentUser.email) &&
            app.deleted !== true && app.deleted !== 'true'
        );
        
        if (!matchedApplications || matchedApplications.length === 0) {
            showEmptyState();
            return;
        }

        // ===== 입문서 / 챌린지 분기 처리 =====
        const bookApp = matchedApplications.find(a => a.application_type === 'book_only');
        const challengeApp = matchedApplications.find(a => a.application_type !== 'book_only');

        // 케이스 1: 챌린지 + 입문서 둘 다 있음 → 챌린지 대시보드 + 하단에 입문서 미니카드
        if (challengeApp && bookApp) {
            renderWelcome(challengeApp);
            renderProgressSection(challengeApp);
            renderActionItems(challengeApp);
            renderTimeline(challengeApp);
            await renderQuickMenuGrid(challengeApp);
            renderShipping(challengeApp);
            await renderProgramInfo(challengeApp);
            // 로딩 숨기고 콘텐츠 표시
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('dashboardContent').style.display = 'block';
            // 하단에 입문서 미니카드 추가
            await renderBookOnlyMiniCard(bookApp);
            return;
        }

        // 케이스 2: 입문서만 있음 → 입문서 전용 대시보드
        if (bookApp && !challengeApp) {
            await renderBookOnlyDashboard(bookApp);
            // 로딩 숨기고 콘텐츠 표시
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('dashboardContent').style.display = 'block';
            return;
        }

        // 케이스 3: 챌린지만 있음 → 기존 로직 그대로
        const application = challengeApp || matchedApplications[0];
        
        // 각 섹션 렌더링
        renderWelcome(application);
        renderProgressSection(application);
        renderActionItems(application);
        renderTimeline(application);
        await renderQuickMenuGrid(application);
        renderShipping(application);
        await renderProgramInfo(application);
        
        // 로딩 숨기고 콘텐츠 표시
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('dashboardContent').style.display = 'block';
        
    } catch (error) {
        console.error('대시보드 로드 실패:', error);
        alert('대시보드를 불러오는 중 오류가 발생했습니다.');
    }
}

/**
 * 환영 메시지 렌더링
 */
function renderWelcome(app) {
    const welcomeMessage = document.getElementById('welcomeMessage');
    welcomeMessage.textContent = `${app.name}님, 환영합니다!`;
}

/**
 * 진행상황 섹션 렌더링 (원형 + 타임라인바)
 */
function renderProgressSection(app) {
    const progressSection = document.getElementById('progressSectionNew');
    if (!progressSection) return;

    const steps = [
        { id: 1, name: '신청서\n제출', icon: 'fa-file-alt', completed: !!app.submitted_date },
        { id: 2, name: '검토중', icon: 'fa-search', completed: !!app.analysis_saved_at },
        { id: 3, name: '개별\n분석', icon: 'fa-chart-line', completed: !!app.analysis_saved_at },
        { id: 4, name: '학생\n동의', icon: 'fa-user-check', completed: !!app.student_agreed_at },
        { id: 5, name: '계약서\n발송', icon: 'fa-file-contract', completed: !!app.contract_sent_at },
        { id: 6, name: '계약\n동의', icon: 'fa-signature', completed: !!app.contract_agreed_at },
        { id: 7, name: '입금\n대기', icon: 'fa-credit-card', completed: !!app.deposit_confirmed_by_student_at },
        { id: 8, name: '입금\n확인', icon: 'fa-check-double', completed: !!app.deposit_confirmed_by_admin_at },
        { id: 9, name: '이용방법\n전달', icon: 'fa-book-open', completed: !!app.guide_sent },
        { id: 10, name: '택배\n발송', icon: 'fa-shipping-fast', completed: !!app.shipping_completed }
    ];

    // 현재 단계 찾기
    let currentStepIndex = steps.findIndex(step => !step.completed);
    if (currentStepIndex === -1) currentStepIndex = steps.length;

    // 진행률 계산
    const progress = Math.round((currentStepIndex / steps.length) * 100);
    const progressDeg = (progress / 100) * 360;
    
    // 진행률 표시 (100%일 때 체크 표시)
    const progressDisplay = progress === 100 
        ? '<i class="fas fa-check" style="font-size: 40px; -webkit-text-stroke: 2px currentColor;"></i>' 
        : `${progress}%`;
    
    const progressLabel = progress === 100 ? '준비 완료' : '현재 진행률';

    // 프로그램 이름
    const programName = app.assigned_program || '내벨업챌린지';

    // HTML 생성
    progressSection.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h2 style="font-size: 20px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 10px; margin: 0;">
                <svg width="24" height="24" viewBox="0 0 24 24" style="flex-shrink: 0;">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="#9480c5" stroke-width="2"/>
                    <path d="M12 6 L12 12 L16 14" fill="none" stroke="#9480c5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                진행 상황
            </h2>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div class="progress-circle" style="--progress-deg: ${progressDeg}deg;">
                <div class="progress-circle-inner">
                    <div class="progress-percentage">${progressDisplay}</div>
                    <div class="progress-label">${progressLabel}</div>
                </div>
            </div>
            <div class="timeline-bar-section" style="flex: 1; padding-left: 11px; padding-top: 0px;">
                <div class="timeline-title">${app.name}님의 ${programName} 프로그램</div>
                <div class="timeline-bar">
                    ${steps.map((step, index) => {
                        let statusClass = 'pending';
                        let icon = 'fa-lock';
                        
                        if (step.completed) {
                            statusClass = 'completed';
                            icon = 'fa-check';
                        } else if (index === currentStepIndex) {
                            statusClass = 'current';
                            icon = 'fa-spinner fa-pulse';
                        }

                        return `
                            <div class="timeline-step ${statusClass}">
                                <div class="timeline-step-icon ${statusClass}">
                                    <i class="fas ${icon}"></i>
                                </div>
                                <div class="timeline-step-label">${step.name.replace(/\\n/g, '<br>')}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * 지금 해야 할 일 렌더링
 */
function renderActionItems(app) {
    const actionItemsContent = document.getElementById('actionItemsContent');
    if (!actionItemsContent) return;

    const actionItems = [];
    
    // 1️⃣ 신청서 제출 직후 ~ 분석 등록 직전
    if (app.submitted_date && !app.analysis_saved_at) {
        actionItemsContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 16px; color: #f59e0b;"></i>
                <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">관리자가 신청서를 검토하고 있어요</h3>
                <p style="font-size: 14px;">조금만 기다려주세요!</p>
            </div>
        `;
        return;
    }
    
    // 2️⃣ 분석 등록 직후 ~ 학생 동의 직전
    if (app.analysis_saved_at && !app.student_agreed_at) {
        const deadline = new Date(app.analysis_saved_at);
        deadline.setDate(deadline.getDate() + 1); // 24시간 = 1일
        const hoursLeft = Math.ceil((deadline - new Date()) / (1000 * 60 * 60));
        
        actionItems.push({
            icon: 'fa-file-signature',
            iconColor: '#f59e0b',
            title: '개별 분석 결과를 확인하고 동의해주세요',
            deadline: hoursLeft > 0 ? `마감: ${hoursLeft}시간 남음` : '마감 임박!',
            urgent: hoursLeft <= 24,
            link: `application-detail.html?id=${app.id}#step2`,
            linkText: '분석 결과 보기'
        });
    }
    
    // 3️⃣ 학생 동의 완료 직후 ~ 계약서 업로드 직전
    else if (app.student_agreed_at && !app.contract_sent_at) {
        actionItemsContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 16px; color: #f59e0b;"></i>
                <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">계약서를 준비하고 있어요</h3>
                <p style="font-size: 14px;">조금만 기다려주세요!</p>
            </div>
        `;
        return;
    }
    
    // 4️⃣ 계약서 업로드 직후 ~ 학생 계약서 동의 직전
    else if (app.contract_sent_at && !app.contract_agreed_at) {
        const deadline = new Date(app.contract_sent_at);
        deadline.setDate(deadline.getDate() + 1); // 24시간 = 1일
        const hoursLeft = Math.ceil((deadline - new Date()) / (1000 * 60 * 60));
        
        actionItems.push({
            icon: 'fa-file-contract',
            iconColor: '#9480c5',
            title: '계약서에 동의해주세요',
            deadline: hoursLeft > 0 ? `마감: ${hoursLeft}시간 남음` : '마감 임박!',
            urgent: hoursLeft <= 24,
            link: `application-detail.html?id=${app.id}#step3`,
            linkText: '계약서 보기'
        });
    }
    
    // 5️⃣ 학생 계약서 동의 직후 ~ 학생 입금 버튼 클릭 직전
    else if (app.contract_agreed_at && !app.deposit_confirmed_by_student_at) {
        const deadline = new Date(app.contract_agreed_at);
        deadline.setDate(deadline.getDate() + 1); // 24시간 = 1일
        const hoursLeft = Math.ceil((deadline - new Date()) / (1000 * 60 * 60));
        
        actionItems.push({
            icon: 'fa-credit-card',
            iconColor: '#77bf7e',
            title: '결제를 진행해주세요',
            deadline: hoursLeft > 0 ? `마감: ${hoursLeft}시간 남음` : '마감 임박!',
            urgent: hoursLeft <= 24,
            link: `application-detail.html?id=${app.id}#step4`,
            linkText: '입금 정보 보기'
        });
    }
    
    // 6️⃣ 학생 입금 버튼 클릭 직후 ~ 관리자 입금 확인 직전
    else if (app.deposit_confirmed_by_student_at && !app.deposit_confirmed_by_admin_at) {
        actionItemsContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-clock" style="font-size: 48px; margin-bottom: 16px; color: #64748b;"></i>
                <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">빠르게 입금확인을 체크할게요</h3>
                <p style="font-size: 14px;">관리자가 확인 중입니다</p>
            </div>
        `;
        return;
    }
    
    // 7️⃣ 관리자 입금 확인 직후 ~ 이용방법 업로드 직전
    else if (app.deposit_confirmed_by_admin_at && !app.guide_sent) {
        actionItemsContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-hourglass-half" style="font-size: 48px; margin-bottom: 16px; color: #f59e0b;"></i>
                <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">프로그램 이용 방법을 준비하고 있어요!</h3>
                <p style="font-size: 14px;">조금만 기다려주세요!</p>
            </div>
        `;
        return;
    }
    
    // 8️⃣ 이용방법 업로드 직후 ~ 택배 발송 등록 직전 (또는 이용방법을 읽지 않은 경우)
    else if (app.guide_sent && !app.shipping_completed) {
        actionItems.push({
            icon: 'fa-book-open',
            iconColor: '#9480c5',
            title: '프로그램 이용 방법을 확인해주세요',
            deadline: '시작 전 필수 확인',
            urgent: true,
            link: `application-detail.html?id=${app.id}#step5`,
            linkText: '이용 방법 보기'
        });
    }
    
    // 9️⃣ 택배 발송 등록 직후 (완전 완료)
    if (actionItems.length === 0 && app.shipping_completed) {
        actionItemsContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 16px; color: #77bf7e;"></i>
                <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">모든 할 일을 완료했어요! 🎉</h3>
                <p style="font-size: 14px;">프로그램 시작일까지 편안히 기다려주세요.<br>택배 발송 정보는 아래 '배송 정보'에서 확인하실 수 있어요.</p>
            </div>
        `;
        return;
    }
    
    // 액션 아이템이 없으면 기본 메시지
    if (actionItems.length === 0) {
        actionItemsContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 16px; color: #77bf7e;"></i>
                <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1e293b;">현재 할 일이 없어요</h3>
                <p style="font-size: 14px;">편안히 기다려주세요.</p>
            </div>
        `;
        return;
    }
    
    // 액션 아이템 렌더링
    actionItemsContent.innerHTML = actionItems.map(item => `
        <div class="action-item ${item.urgent ? 'urgent' : ''}">
            <div class="action-icon" style="color: ${item.iconColor};">
                <i class="fas ${item.icon}"></i>
            </div>
            <div class="action-content">
                <h4 class="action-title">${item.title}</h4>
                <p class="action-deadline">${item.deadline}</p>
            </div>
            <a href="${item.link}" class="action-button">
                ${item.linkText}
                <i class="fas fa-chevron-right"></i>
            </a>
        </div>
    `).join('');
}

/**
 * 타임라인 렌더링
 */
function renderTimeline(app) {
    const timelineContent = document.getElementById('timelineContent');
    if (!timelineContent) return;

    const events = [];
    
    // 모든 이벤트 수집
    if (app.submitted_date) {
        events.push({
            date: new Date(app.submitted_date),
            icon: 'fa-file-alt',
            iconColor: '#9480c5',
            title: '신청서 제출 완료',
            description: '이온토플 프로그램에 신청하셨습니다.'
        });
    }
    
    if (app.analysis_saved_at) {
        events.push({
            date: new Date(app.analysis_saved_at),
            icon: 'fa-chart-line',
            iconColor: '#77bf7e',
            title: '개별 분석 완료',
            description: '맞춤형 학습 플랜이 준비되었습니다.'
        });
    }
    
    if (app.student_agreed_at) {
        events.push({
            date: new Date(app.student_agreed_at),
            icon: 'fa-check-circle',
            iconColor: '#77bf7e',
            title: '개별 분석에 동의',
            description: '분석 결과를 확인하고 동의하셨습니다.'
        });
    }
    
    if (app.contract_sent_at) {
        events.push({
            date: new Date(app.contract_sent_at),
            icon: 'fa-file-signature',
            iconColor: '#9480c5',
            title: '계약서 발송됨',
            description: '프로그램 계약서가 발송되었습니다.'
        });
    }
    
    if (app.contract_agreed_at) {
        events.push({
            date: new Date(app.contract_agreed_at),
            icon: 'fa-handshake',
            iconColor: '#77bf7e',
            title: '계약 동의 완료',
            description: '계약서에 동의하셨습니다.'
        });
    }
    
    if (app.deposit_confirmed_by_student_at) {
        events.push({
            date: new Date(app.deposit_confirmed_by_student_at),
            icon: 'fa-money-bill-wave',
            iconColor: '#77bf7e',
            title: '입금 완료',
            description: '수강료를 입금하셨습니다.'
        });
    }
    
    if (app.deposit_confirmed_by_admin_at) {
        events.push({
            date: new Date(app.deposit_confirmed_by_admin_at),
            icon: 'fa-check-double',
            iconColor: '#77bf7e',
            title: '입금 확인 완료',
            description: '관리자가 입금을 확인했습니다.'
        });
    }
    
    if (app.guide_sent) {
        events.push({
            date: new Date(app.guide_sent_at || Date.now()),
            icon: 'fa-book',
            iconColor: '#9480c5',
            title: '이용 방법 전달',
            description: '프로그램 이용 가이드가 전달되었습니다.'
        });
    }
    
    if (app.shipping_completed) {
        events.push({
            date: new Date(app.shipping_completed_at || Date.now()),
            icon: 'fa-shipping-fast',
            iconColor: '#77bf7e',
            title: '교재 발송 완료',
            description: `운송장번호: ${app.shipping_tracking_number || '-'}`
        });
    }
    
    if (app.schedule_start) {
        const startDate = new Date(app.schedule_start);
        if (startDate > new Date()) {
            events.push({
                date: startDate,
                icon: 'fa-rocket',
                iconColor: '#f59e0b',
                title: '프로그램 시작 예정',
                description: '챌린지가 시작됩니다!',
                future: true
            });
        }
    }
    
    // 날짜순 정렬 (최신순)
    events.sort((a, b) => b.date - a.date);
    
    // 타임라인 렌더링
    if (events.length === 0) {
        timelineContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
                <i class="fas fa-clock" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p style="font-size: 14px;">아직 활동 내역이 없습니다.</p>
            </div>
        `;
        return;
    }
    
    timelineContent.innerHTML = events.map((event, index) => {
        const dateStr = formatTimelineDate(event.date);
        
        return `
            <div class="timeline-item ${event.future ? 'future' : ''}">
                <div class="timeline-icon" style="background-color: ${event.iconColor}20; color: ${event.iconColor};">
                    <i class="fas ${event.icon}"></i>
                </div>
                <div class="timeline-content">
                    <div class="timeline-text">
                        <h4 class="timeline-title">${event.title}</h4>
                        <p class="timeline-description">${event.description}</p>
                    </div>
                    <span class="timeline-date">${dateStr}</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 빠른 메뉴 그리드 렌더링 (2x3 그리드)
 */
async function renderQuickMenuGrid(app) {
    const quickMenuGrid = document.getElementById('quickMenuGrid');
    if (!quickMenuGrid) return;

    // 사이트 설정에서 플랫폼 URL 가져오기
    const settings = await getSiteSettings();
    const platformUrl = settings?.platform_url || 'https://levelupchallenge.kr';

    const menuItems = [
        {
            icon: 'fa-external-link-alt',
            iconColor: '#9480c5',
            title: '플랫폼\n바로가기',
            link: platformUrl,
            available: !!app.deposit_confirmed_by_admin_at,
            external: true
        },
        {
            icon: 'fa-book',
            iconColor: '#f59e0b',
            title: '이용방법',
            link: `application-detail.html?id=${app.id}#step5`,
            available: !!app.guide_sent
        },
        {
            icon: 'fa-file-alt',
            iconColor: '#6366f1',
            title: '신청서\n전체 보기',
            link: `application-detail.html?id=${app.id}#step1`,
            available: true
        },
        {
            icon: 'fa-chart-bar',
            iconColor: '#10b981',
            title: '개별 분석\n결과',
            link: `application-detail.html?id=${app.id}#step2`,
            available: !!app.analysis_saved_at
        },
        {
            icon: 'fa-file-contract',
            iconColor: '#8b5cf6',
            title: '계약서\n보기',
            link: `application-detail.html?id=${app.id}#step3`,
            available: !!app.contract_sent_at
        },
        {
            icon: 'fa-credit-card',
            iconColor: '#06b6d4',
            title: '입금\n정보',
            link: `application-detail.html?id=${app.id}#step4`,
            available: !!app.contract_agreed_at
        }
    ];

    quickMenuGrid.innerHTML = menuItems.map(item => {
        if (!item.available) {
            return `
                <div class="quick-menu-button locked">
                    <div class="quick-menu-icon" style="color: #cbd5e1;">
                        <i class="fas ${item.icon}"></i>
                    </div>
                    <div class="quick-menu-text">${item.title.replace('\n', ' ')}</div>
                </div>
            `;
        }
        
        const target = item.external ? 'target="_blank"' : '';
        return `
            <a href="${item.link}" class="quick-menu-button" ${target}>
                <div class="quick-menu-icon" style="color: ${item.iconColor};">
                    <i class="fas ${item.icon}"></i>
                </div>
                <div class="quick-menu-text">${item.title.replace('\n', ' ')}</div>
            </a>
        `;
    }).join('');
}

/**
 * 빠른 링크 렌더링
 */
function renderQuickLinks(app) {
    const quickLinksContent = document.getElementById('quickLinksContent');
    if (!quickLinksContent) return;

    const links = [
        {
            icon: 'fa-file-alt',
            iconColor: '#9480c5',
            title: '신청서 전체 보기',
            description: '제출한 신청서 내용 확인',
            link: `application-detail.html?id=${app.id}#step1`,
            available: true
        },
        {
            icon: 'fa-chart-bar',
            iconColor: '#77bf7e',
            title: '개별 분석 결과',
            description: '맞춤형 학습 플랜 확인',
            link: `application-detail.html?id=${app.id}#step2`,
            available: !!app.analysis_saved_at
        },
        {
            icon: 'fa-file-contract',
            iconColor: '#9480c5',
            title: '계약서 보기',
            description: '프로그램 계약서 확인',
            link: `application-detail.html?id=${app.id}#step3`,
            available: !!app.contract_sent_at
        },
        {
            icon: 'fa-credit-card',
            iconColor: '#77bf7e',
            title: '입금 정보',
            description: '계좌번호 및 입금 현황',
            link: `application-detail.html?id=${app.id}#step4`,
            available: !!app.contract_agreed_at
        },
        {
            icon: 'fa-book-open',
            iconColor: '#9480c5',
            title: '이용 방법',
            description: '프로그램 사용 가이드',
            link: `application-detail.html?id=${app.id}#step5`,
            available: !!app.guide_sent
        },
        {
            icon: 'fa-box',
            iconColor: '#f59e0b',
            title: '배송 조회',
            description: '교재 배송 현황 확인',
            link: app.shipping_tracking_number ? 
                `https://trace.cjlogistics.com/next/tracking.html?wblNo=${app.shipping_tracking_number}` : '#',
            available: !!app.shipping_completed,
            external: !!app.shipping_tracking_number
        }
    ];

    quickLinksContent.innerHTML = links.map(link => {
        if (!link.available) {
            return `
                <div class="quick-link-item disabled">
                    <div class="quick-link-icon" style="background-color: #e2e8f0; color: #94a3b8;">
                        <i class="fas ${link.icon}"></i>
                    </div>
                    <div class="quick-link-content">
                        <h4 class="quick-link-title" style="color: #94a3b8;">${link.title}</h4>
                        <p class="quick-link-description" style="color: #cbd5e1;">준비 중</p>
                    </div>
                    <div class="quick-link-arrow" style="color: #cbd5e1;">
                        <i class="fas fa-lock"></i>
                    </div>
                </div>
            `;
        }
        
        return `
            <a href="${link.link}" class="quick-link-item" ${link.external ? 'target="_blank"' : ''}>
                <div class="quick-link-icon" style="background-color: ${link.iconColor}20; color: ${link.iconColor};">
                    <i class="fas ${link.icon}"></i>
                </div>
                <div class="quick-link-content">
                    <h4 class="quick-link-title">${link.title}</h4>
                    <p class="quick-link-description">${link.description}</p>
                </div>
                <div class="quick-link-arrow">
                    <i class="fas fa-chevron-right"></i>
                </div>
            </a>
        `;
    }).join('');
}

/**
 * 타임라인 날짜 포맷
 */
function formatTimelineDate(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // 미래 날짜
    if (diffDays > 0) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    // 오늘
    if (diffDays === 0) {
        const hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const period = hours >= 12 ? '오후' : '오전';
        const displayHours = hours % 12 || 12;
        return `오늘 ${period} ${displayHours}:${minutes}`;
    }
    
    // 어제
    if (diffDays === -1) {
        const hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const period = hours >= 12 ? '오후' : '오전';
        const displayHours = hours % 12 || 12;
        return `어제 ${period} ${displayHours}:${minutes}`;
    }
    
    // 그 이전
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 환영 메시지 렌더링 (중복 제거됨 - 위에 정의됨)
 */
function renderWelcome(app) {
    const welcomeMessage = document.getElementById('welcomeMessage');
    welcomeMessage.textContent = `${app.name}님, 환영합니다!`;
}

/**
 * 진행 상황 렌더링
 */
function renderProgress(app) {
    const steps = [
        { id: 1, name: '신청서 제출', completed: !!app.submitted_date },
        { id: 2, name: '검토 중', completed: !!app.submitted_date }, // 제출되면 검토 시작
        { id: 3, name: '개인 분석 완료', completed: !!app.analysis_saved_at || !!app.student_agreed_at }, // 분석 완료 또는 학생이 동의했으면 완료
        { id: 4, name: '학생 동의 완료', completed: !!app.student_agreed_at },
        { id: 5, name: '계약서 발송', completed: !!app.contract_sent_at },
        { id: 6, name: '계약 동의 완료', completed: !!app.contract_agreed_at },
        { id: 7, name: '입금 대기', completed: !!app.deposit_confirmed_by_student_at },
        { id: 8, name: '입금 확인 완료', completed: !!app.deposit_confirmed_by_admin_at },
        { id: 9, name: '이용방법 전달', completed: !!app.guide_sent },
        { id: 10, name: '실물 교재 발송', completed: !!app.shipping_completed }
    ];

    // 현재 단계 찾기
    let currentStepIndex = steps.findIndex(step => !step.completed);
    if (currentStepIndex === -1) currentStepIndex = steps.length;

    // 진행률 계산
    const progress = Math.round((currentStepIndex / steps.length) * 100);

    // 진행률 바 업데이트
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = progress + '%';
    progressBar.textContent = progress + '%';

    // 현재 단계 표시
    const currentStepText = currentStepIndex < steps.length 
        ? `현재 단계: STEP ${currentStepIndex + 1} - ${steps[currentStepIndex].name}`
        : '모든 단계 완료! 🎉';
    document.getElementById('currentStep').textContent = currentStepText;

    // 단계 리스트 렌더링
    const stepList = document.getElementById('stepList');
    stepList.innerHTML = steps.map((step, index) => {
        let statusClass = 'step-pending';
        let icon = 'fa-circle';
        
        if (step.completed) {
            statusClass = 'step-completed';
            icon = 'fa-check-circle';
        } else if (index === currentStepIndex) {
            statusClass = 'step-current';
            icon = 'fa-spinner fa-spin';
        }

        return `
            <li class="step-item ${statusClass}">
                <i class="fas ${icon}"></i>
                <span>${step.name}</span>
            </li>
        `;
    }).join('');
}

/**
 * 배송 정보 렌더링
 */
function renderShipping(app) {
    const shippingContent = document.getElementById('shippingContent');
    
    // 이용방법 업로드 전까지는 배송 정보를 표시하지 않음
    if (!app.guide_sent) {
        shippingContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-lock" style="font-size: 48px; margin-bottom: 16px; color: #cbd5e1;"></i>
                <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #475569;">아직 프로그램이 준비되지 않았어요</h3>
                <p style="font-size: 13px; line-height: 1.6; color: #64748b;">관리자가 이용방법을 업로드하면<br>프로그램 정보가 자동으로 표시됩니다.</p>
            </div>
        `;
        return;
    }
    
    let statusClass = 'preparing';
    let statusIcon = 'fa-box';
    let statusText = '준비 중';
    let trackingNumber = '-';
    let expectedDate = '-';
    let trackingUrl = '';

    if (app.shipping_completed) {
        statusClass = 'delivered';
        statusIcon = 'fa-check-circle';
        statusText = '출고 완료';
        trackingNumber = app.shipping_tracking_number || '-';
        
        // 발송 완료 시간으로부터 예상 도착일 계산 (2-3일 후)
        if (app.shipping_completed_at) {
            const shippingDate = new Date(app.shipping_completed_at);
            const expectedArrival = new Date(shippingDate);
            expectedArrival.setDate(expectedArrival.getDate() + 2);
            expectedDate = expectedArrival.toLocaleDateString('ko-KR');
        }

        // 택배사 조회 URL (CJ대한통운)
        if (trackingNumber && trackingNumber !== '-') {
            trackingUrl = `https://trace.cjlogistics.com/next/tracking.html?wblNo=${trackingNumber}`;
        }
    } else if (app.guide_sent) {
        statusClass = 'preparing';
        statusIcon = 'fa-box-open';
        statusText = '발송 준비 중';
        
        // 챌린지 시작일 기준으로 발송 예정일 표시
        if (app.schedule_start) {
            const startDate = new Date(app.schedule_start);
            const shipDate = new Date(startDate);
            shipDate.setDate(shipDate.getDate() - 3); // 시작 3일 전 발송
            expectedDate = shipDate.toLocaleDateString('ko-KR');
        }
    }

    shippingContent.innerHTML = `
        <div class="shipping-status ${statusClass}">
            <div class="shipping-icon">
                <i class="fas ${statusIcon}"></i>
            </div>
            <h3>${statusText}</h3>
        </div>
        
        <div class="shipping-info">
            <div class="shipping-info-row">
                <span class="shipping-info-label">출고 ${app.shipping_completed ? '완료' : '예정'}</span>
                <span class="shipping-info-value">${expectedDate}</span>
            </div>
            ${app.shipping_completed ? `
            <div class="shipping-info-row">
                <span class="shipping-info-label">택배사</span>
                <span class="shipping-info-value">${app.shipping_courier || 'CJ대한통운'}</span>
            </div>
            ` : ''}
            <div class="shipping-info-row">
                <span class="shipping-info-label">운송장 번호</span>
                <span class="shipping-info-value">${trackingNumber}</span>
            </div>
            <div class="shipping-info-row">
                <span class="shipping-info-label">배송 상태</span>
                <span class="shipping-info-value">${statusText}</span>
            </div>
        </div>
        
        ${app.shipping_completed ? `
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; line-height: 1.6; color: #0c4a6e;">
            <i class="fas fa-info-circle" style="color: #0284c7; margin-right: 6px;"></i>
            <strong>배송 안내</strong><br>
            • 특별한 일이 없는 한 다음날 도착합니다.<br>
            • 제주 및 도서산간의 경우 +1일이 더 소요될 수 있습니다.
        </div>
        ` : ''}
        
        <button class="tracking-button" ${!trackingUrl ? 'disabled' : ''} onclick="window.open('${trackingUrl}', '_blank')">
            <i class="fas fa-search"></i> 택배 배송 조회하기
        </button>
    `;
}

/**
 * 빠른 메뉴 렌더링
 */
function renderQuickMenu(app) {
    const quickMenuButtons = document.getElementById('quickMenuButtons');
    
    const menus = [
        {
            icon: 'fa-file-alt',
            text: '내 신청서 보기',
            action: () => window.location.href = `application-detail.html?id=${app.id}#step1`
        },
        {
            icon: 'fa-chart-line',
            text: '개인 분석 보기',
            action: () => window.location.href = `application-detail.html?id=${app.id}#step2`,
            disabled: !app.analysis_completed_at && !app.student_agreed_at
        },
        {
            icon: 'fa-file-contract',
            text: '계약서 보기',
            action: () => window.location.href = `application-detail.html?id=${app.id}#step3`,
            disabled: !app.contract_sent_at
        },
        {
            icon: 'fa-book-open',
            text: '이용방법 보기',
            action: () => window.open('usage-guide.html', '_blank'),
            disabled: !app.guide_sent
        },
        {
            icon: 'fa-comment-dots',
            text: '문의하기',
            action: async () => {
                const siteSettings = await getSiteSettings();
                const kakaoLink = siteSettings.kakao_link || 'https://business.kakao.com/_FWxcZC/chats';
                window.open(kakaoLink, '_blank');
            }
        }
    ];

    quickMenuButtons.innerHTML = menus.map(menu => `
        <a href="#" class="menu-button ${menu.disabled ? 'disabled' : ''}" 
           onclick="${menu.disabled ? 'return false;' : 'event.preventDefault();'}"
           data-action="${menus.indexOf(menu)}"
           style="${menu.disabled ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
            <i class="fas ${menu.icon}"></i>
            <span>${menu.text}</span>
        </a>
    `).join('');

    // 이벤트 리스너 추가
    document.querySelectorAll('.menu-button:not(.disabled)').forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const actionIndex = parseInt(btn.getAttribute('data-action'));
            if (menus[actionIndex] && !menus[actionIndex].disabled) {
                menus[actionIndex].action();
            }
        });
    });
}

/**
 * 프로그램 정보 렌더링
 */
async function renderProgramInfo(app) {
    const programDetails = document.getElementById('programDetails');
    const programActions = document.getElementById('programActions');

    // 이용방법 업로드 전까지는 프로그램 정보를 표시하지 않음
    if (!app.guide_sent) {
        programDetails.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <i class="fas fa-lock" style="font-size: 48px; margin-bottom: 16px; color: #cbd5e1;"></i>
                <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #475569;">아직 프로그램이 준비되지 않았어요</h3>
                <p style="font-size: 13px; line-height: 1.6; color: #64748b;">관리자가 이용방법을 업로드하면<br>프로그램 정보가 자동으로 표시됩니다.</p>
            </div>
        `;
        
        programActions.innerHTML = `
            <button class="program-button" style="opacity: 0.5; cursor: not-allowed; pointer-events: none;">
                <i class="fas fa-lock"></i> 플랫폼 바로가기
            </button>
            <button class="program-button secondary" style="opacity: 0.5; cursor: not-allowed; pointer-events: none;">
                <i class="fas fa-book"></i> 이용방법 보기
            </button>
        `;
        return;
    }

    // 날짜 포맷팅 함수
    function formatDateWithDay(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dayOfWeek = days[date.getDay()];
        return `${year}-${month}-${day}(${dayOfWeek})`;
    }

    // 플랫폼 로그인 가이드 가져오기
    let platformUrl = 'https://study.iontoefl.com';
    let loginGuide = '이메일로 발송된 비밀번호를 사용하세요';
    
    try {
        const settings = await getSiteSettings();
        if (settings) {
            platformUrl = settings.platform_url || platformUrl;
            loginGuide = settings.platform_login_guide || loginGuide;
        }
    } catch(e) {
        console.warn('사이트 설정 로드 실패, 기본값 사용:', e);
    }

    programDetails.innerHTML = `
        <div class="program-row">
            <span class="program-label">프로그램</span>
            <span class="program-value">${app.assigned_program || '-'}</span>
        </div>
        <div class="program-row">
            <span class="program-label">시작일</span>
            <span class="program-value">${formatDateWithDay(app.schedule_start)}</span>
        </div>
        <div class="program-row">
            <span class="program-label">종료일</span>
            <span class="program-value">${formatDateWithDay(app.schedule_end)}</span>
        </div>
        <div class="program-row">
            <span class="program-label">플랫폼</span>
            <span class="program-value">${platformUrl}</span>
        </div>
        <div class="program-row">
            <span class="program-label">로그인 ID</span>
            <span class="program-value">${app.email}</span>
        </div>
        <div class="program-row">
            <span class="program-label">비밀번호</span>
            <span class="program-value" style="display: flex; align-items: center; gap: 10px;">
                <span id="passwordText" style="font-family: monospace;">••••••••</span>
                <button onclick="togglePassword()" style="background: none; border: none; cursor: pointer; color: #9480c5; font-size: 16px; padding: 0;">
                    <i id="passwordIcon" class="fas fa-eye"></i>
                </button>
            </span>
        </div>
    `;

    // 비밀번호 토글 함수를 전역으로 추가
    const _savedLoginGuide = loginGuide;
    window.togglePassword = function() {
        const passwordText = document.getElementById('passwordText');
        const passwordIcon = document.getElementById('passwordIcon');
        
        if (passwordText.textContent === '••••••••') {
            passwordText.textContent = _savedLoginGuide;
            passwordIcon.classList.remove('fa-eye');
            passwordIcon.classList.add('fa-eye-slash');
        } else {
            passwordText.textContent = '••••••••';
            passwordIcon.classList.remove('fa-eye-slash');
            passwordIcon.classList.add('fa-eye');
        }
    };

    programActions.innerHTML = `
        <a href="${platformUrl}" target="_blank" class="program-button">
            <i class="fas fa-external-link-alt"></i> 플랫폼 바로가기
        </a>
        <a href="usage-guide.html" target="_blank" class="program-button secondary" ${!app.guide_sent ? 'style="opacity: 0.5; pointer-events: none;"' : ''}>
            <i class="fas fa-book"></i> 이용방법 보기
        </a>
    `;
}

/**
 * 알림 렌더링
 */
async function renderNotifications(app) {
    const notificationList = document.getElementById('notificationList');
    
    try {
        // 알림 기능은 추후 구현 예정 - 일단 신청서 정보로부터 생성
        const notifications = createNotificationsFromApplication(app);
        
        if (notifications.length === 0) {
            notificationList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-bell-slash"></i>
                    <p>아직 알림이 없습니다.</p>
                </div>
            `;
            return;
        }

        notificationList.innerHTML = notifications.map(notif => `
                <li class="notification-item">
                    <i class="fas ${notif.icon} notification-icon"></i>
                    <div class="notification-content">
                        <div class="notification-message">${notif.message}</div>
                        <div class="notification-time">${notif.time}</div>
                    </div>
                </li>
            `).join('');
    } catch (error) {
        console.error('알림 로드 실패:', error);
        // 에러 시에도 신청서 정보로부터 생성
        const notifications = createNotificationsFromApplication(app);
        notificationList.innerHTML = notifications.map(notif => `
            <li class="notification-item">
                <i class="fas ${notif.icon} notification-icon"></i>
                <div class="notification-content">
                    <div class="notification-message">${notif.message}</div>
                    <div class="notification-time">${notif.time}</div>
                </div>
            </li>
        `).join('');
    }
}

/**
 * 신청서 정보로부터 알림 생성
 */
function createNotificationsFromApplication(app) {
    const notifications = [];

    if (app.shipping_completed_at) {
        notifications.push({
            icon: 'fa-shipping-fast',
            message: '실물 교재가 발송되었습니다.',
            time: formatNotificationTime(app.shipping_completed_at)
        });
    }

    if (app.guide_sent_at) {
        notifications.push({
            icon: 'fa-book-open',
            message: '이용방법이 전달되었습니다.',
            time: formatNotificationTime(app.guide_sent_at)
        });
    }

    if (app.deposit_confirmed_by_admin_at) {
        notifications.push({
            icon: 'fa-check-circle',
            message: '입금이 확인되었습니다.',
            time: formatNotificationTime(app.deposit_confirmed_by_admin_at)
        });
    }

    if (app.contract_sent_at) {
        notifications.push({
            icon: 'fa-file-contract',
            message: '계약서가 발송되었습니다.',
            time: formatNotificationTime(app.contract_sent_at)
        });
    }

    if (app.analysis_completed_at) {
        notifications.push({
            icon: 'fa-chart-line',
            message: '개인 분석이 완료되었습니다.',
            time: formatNotificationTime(app.analysis_completed_at)
        });
    }

    // 최신 순으로 정렬 (최대 5개)
    return notifications.slice(0, 5);
}

/**
 * 알림 시간 포맷팅
 */
function formatNotificationTime(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // 1분 미만
    if (diff < 60000) {
        return '방금 전';
    }
    // 1시간 미만
    else if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}분 전`;
    }
    // 24시간 미만
    else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}시간 전`;
    }
    // 그 외
    else {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
}

/**
 * 사이트 설정 가져오기
 */
async function getSiteSettings() {
    try {
        const result = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        if (result && result.length > 0) {
            return result[0];
        }
    } catch (error) {
        console.error('사이트 설정 로드 실패:', error);
    }
    return {};
}

/**
 * 빈 상태 표시
 */
function showEmptyState() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('dashboardContent').innerHTML = `
        <div class="empty-state" style="padding: 100px 20px;">
            <i class="fas fa-inbox" style="font-size: 72px; color: #cbd5e1; margin-bottom: 20px;"></i>
            <h2 style="color: #64748b; margin-bottom: 10px;">신청서가 없습니다</h2>
            <p style="color: #94a3b8; margin-bottom: 30px;">아직 프로그램을 신청하지 않으셨네요.</p>
            <a href="application-form.html" class="program-button" style="display: inline-block;">
                <i class="fas fa-plus"></i> 프로그램 신청하기
            </a>
        </div>
    `;
    document.getElementById('dashboardContent').style.display = 'block';
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 로그아웃 버튼
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            if (confirm('로그아웃 하시겠습니까?')) {
                localStorage.removeItem('iontoefl_user');
                localStorage.removeItem('iontoefl_login_time');
                alert('로그아웃되었습니다.');
                window.location.href = 'index.html';
            }
        });
    }
}

// =====================================================
// 입문서 전용 대시보드 (Phase 2-B)
// =====================================================

/**
 * 입문서 전용 대시보드 렌더링
 * 기존 dashboardContent를 완전히 덮어쓴다.
 */
async function renderBookOnlyDashboard(app) {
    const dashboardContent = document.getElementById('dashboardContent');
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
    const userId = app.user_id || userData.id;

    // tr_book_progress 조회
    let progress = null;
    try {
        const progressResult = await supabaseAPI.query('tr_book_progress', {
            'user_id': `eq.${userId}`,
            'limit': '1',
            'order': 'updated_at.desc'
        });
        if (progressResult && progressResult.length > 0) {
            progress = progressResult[0];
        }
    } catch (e) {
        console.warn('입문서 진도 조회 실패:', e);
    }

    // tr_book_memos 조회
    let memoCount = 0;
    try {
        const memos = await supabaseAPI.query('tr_book_memos', {
            'user_id': `eq.${userId}`
        });
        memoCount = memos ? memos.length : 0;
    } catch (e) {
        console.warn('입문서 메모 조회 실패:', e);
    }

    // 진도 데이터 파싱
    const lastPage = progress?.last_page || 0;
    const maxPageReached = progress?.max_page_reached || 0;
    const isCompleted = progress?.is_completed || false;
    const totalPages = 366;
    const progressPercent = Math.min(Math.round((maxPageReached / totalPages) * 100), 100);
    const progressDeg = (progressPercent / 100) * 360;

    // 북마크 수
    let bookmarkCount = 0;
    try {
        if (progress?.bookmarks) {
            bookmarkCount = Array.isArray(progress.bookmarks) ? progress.bookmarks.length : 0;
        }
    } catch (e) {
        bookmarkCount = 0;
    }

    // 진행률 표시
    const progressDisplay = isCompleted
        ? '<i class="fas fa-check" style="font-size: 40px; -webkit-text-stroke: 2px currentColor;"></i>'
        : `${progressPercent}%`;
    const progressLabel = isCompleted ? '완독 완료' : '읽기 진도';

    // 대시보드 HTML 생성
    dashboardContent.innerHTML = `
        <!-- 환영 메시지 -->
        <div class="welcome-section" style="background: linear-gradient(135deg, #9480c5 0%, #7a62b0 100%);">
            <h1 style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-book-open"></i>
                ${app.name || userData.name || ''}님, 입문서가 준비되어 있습니다
            </h1>
            <p>토플 독학의 첫걸음, 이온토플 입문서를 읽어보세요.</p>
        </div>

        <!-- 메인 그리드 -->
        <div class="dashboard-grid" style="grid-template-columns: 1fr;">
            <!-- 입문서 진도 카드 -->
            <div class="dashboard-card" style="margin-bottom: 0;">
                <div style="display: flex; align-items: center; gap: 30px; flex-wrap: wrap;">
                    <!-- 원형 프로그레스 -->
                    <div style="flex-shrink: 0;">
                        <div class="progress-circle" style="--progress-deg: ${progressDeg}deg; width: 140px; height: 140px;">
                            <div class="progress-circle-inner" style="width: 116px; height: 116px;">
                                <div class="progress-percentage" style="color: ${isCompleted ? '#77bf7e' : '#9480c5'};">${progressDisplay}</div>
                                <div class="progress-label">${progressLabel}</div>
                            </div>
                        </div>
                    </div>

                    <!-- 통계 정보 -->
                    <div style="flex: 1; min-width: 250px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
                            <h2 style="font-size: 20px; font-weight: 700; color: #1e293b; margin: 0;">입문서 읽기 현황</h2>
                            ${isCompleted ? '<span style="background: #dcfce7; color: #16a34a; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600;">완독 완료 ✅</span>' : ''}
                        </div>

                        <!-- 통계 그리드 -->
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                            <!-- 페이지 진도 -->
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 24px; font-weight: 700; color: #9480c5;">${maxPageReached}</div>
                                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">/ ${totalPages}페이지</div>
                            </div>
                            <!-- 메모 수 -->
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${memoCount}</div>
                                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">작성한 메모</div>
                            </div>
                            <!-- 북마크 수 -->
                            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 24px; font-weight: 700; color: #ef4444;">${bookmarkCount}</div>
                                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">북마크</div>
                            </div>
                        </div>

                        <!-- 이어서 읽기 버튼 -->
                        <div style="margin-top: 20px;">
                            <button id="btnGoToBook" class="program-button" style="width: 100%; padding: 16px; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; border: none; cursor: pointer;">
                                <i class="fas fa-book-reader"></i> ${lastPage > 0 ? `이어서 읽기 (${lastPage}페이지부터)` : '읽기 시작하기'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 내벨업챌린지 유도 영역 -->
        <div class="dashboard-card" style="margin-top: 24px; background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border: 2px solid #fde68a;">
            <div style="text-align: center; padding: 20px 16px;">
                <div style="font-size: 48px; margin-bottom: 16px;">🍳</div>
                <p style="font-size: 15px; color: #92400e; line-height: 1.8; font-weight: 500; margin-bottom: 20px;">
                    입문서는 레시피, 내벨업챌린지는 요리 실습입니다.<br>
                    레시피를 백날 째려봐도 요리 실력은 늘지 않습니다.<br>
                    이제 직접 문제를 풀어볼 차례입니다.
                </p>
                <a href="https://eonfl.com/programs.html#basic" class="program-button" style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; text-decoration: none; border: none; cursor: pointer;">
                    <i class="fas fa-rocket"></i> 내벨업챌린지 알아보기
                </a>
            </div>
        </div>
    `;

    // 이벤트 리스너 바인딩
    document.getElementById('btnGoToBook').addEventListener('click', () => goToBookViewer(app, 'btnGoToBook'));
}

/**
 * 토큰 발급 + 테스트룸 book.html 이동
 */
async function goToBookViewer(app, btnId) {
    const btn = document.getElementById(btnId || 'btnGoToBook');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 이동 중...';
    }

    try {
        const userData = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');

        // 1. 일회용 토큰 생성
        const token = crypto.randomUUID();

        // 2. tr_auth_tokens 테이블에 저장
        await supabaseAPI.post('tr_auth_tokens', {
            token: token,
            user_id: app.user_id || userData.id,
            email: app.email || userData.email,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()  // 5분 유효
        });

        // 3. 테스트룸 book.html로 이동
        window.location.href = 'https://testroom.eonfl.com/book.html?auth_token=' + token;

    } catch (error) {
        console.error('토큰 발급 실패:', error);
        alert('입문서 이동 중 오류가 발생했습니다. 다시 시도해주세요.');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

/**
 * 챌린지 대시보드 하단에 입문서 미니카드 추가
 */
async function renderBookOnlyMiniCard(bookApp) {
    const dashboardContent = document.getElementById('dashboardContent');
    if (!dashboardContent) return;

    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
    const userId = bookApp.user_id || userData.id;

    // tr_book_progress 조회
    let progress = null;
    try {
        const progressResult = await supabaseAPI.query('tr_book_progress', {
            'user_id': `eq.${userId}`,
            'limit': '1',
            'order': 'updated_at.desc'
        });
        if (progressResult && progressResult.length > 0) {
            progress = progressResult[0];
        }
    } catch (e) {
        console.warn('입문서 진도 조회 실패:', e);
    }

    const lastPage = progress?.last_page || 0;
    const maxPageReached = progress?.max_page_reached || 0;
    const isCompleted = progress?.is_completed || false;
    const totalPages = 366;

    // 미니카드 HTML
    const miniCard = document.createElement('div');
    miniCard.className = 'dashboard-card';
    miniCard.style.cssText = 'margin-top: 24px; cursor: pointer; transition: all 0.3s;';
    miniCard.innerHTML = `
        <div style="display: flex; align-items: center; gap: 16px;">
            <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #9480c5, #7a62b0); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-book-reader" style="color: white; font-size: 22px;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-size: 15px; font-weight: 600; color: #1e293b; display: flex; align-items: center; gap: 8px;">
                    입문서 읽기
                    ${isCompleted
                        ? '<span style="background: #dcfce7; color: #16a34a; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">완독 ✅</span>'
                        : `<span style="background: #f0f0ff; color: #9480c5; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">진행중 — ${maxPageReached}/${totalPages}</span>`
                    }
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                    ${lastPage > 0 ? `마지막으로 읽은 페이지: ${lastPage}` : '아직 읽기를 시작하지 않았습니다'}
                </div>
            </div>
            <button id="btnMiniCardBook" style="padding: 10px 20px; background: linear-gradient(135deg, #9480c5 0%, #7a62b0 100%); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; display: flex; align-items: center; gap: 6px; transition: transform 0.2s;">
                <i class="fas fa-external-link-alt"></i> 열기
            </button>
        </div>
    `;

    // dashboardContent의 dashboard-grid 다음에 추가
    const dashboardGrid = dashboardContent.querySelector('.dashboard-grid');
    if (dashboardGrid) {
        dashboardGrid.parentNode.insertBefore(miniCard, dashboardGrid.nextSibling);
    } else {
        dashboardContent.appendChild(miniCard);
    }

    // 이벤트 리스너 바인딩
    document.getElementById('btnMiniCardBook').addEventListener('click', (e) => {
        e.stopPropagation();
        goToBookViewer(bookApp, 'btnMiniCardBook');
    });
}

// ==================== 닉네임 미설정 → 내 정보 수정 페이지로 안내 ====================

/**
 * 닉네임 미설정 유저 체크 → my-profile.html로 리다이렉트
 */
async function checkNicknameSetup(currentUser) {
    if (!currentUser.email) return;
    try {
        const users = await supabaseAPI.query('users', {
            'email': `eq.${currentUser.email}`,
            'limit': '1'
        });
        if (users && users.length > 0 && !users[0].nickname) {
            alert('닉네임이 설정되지 않았습니다.\n내 정보 수정 페이지에서 설정해주세요.');
            window.location.href = 'my-profile.html';
        }
    } catch (e) {
        console.error('닉네임 체크 오류:', e);
    }
}

// ==================== 사이드바 사용자 정보 표시 ====================

/**
 * 사이드바에 사용자 이름/이메일 표시
 */
function updateSidebarUserInfo() {
    const currentUser = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
    const nameEl = document.getElementById('sidebarUserName');
    const emailEl = document.getElementById('sidebarUserEmail');
    if (nameEl) nameEl.textContent = currentUser.name || '사용자';
    if (emailEl) emailEl.textContent = currentUser.email || '';
}
