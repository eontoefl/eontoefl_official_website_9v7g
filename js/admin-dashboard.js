// Admin Dashboard JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // 관리자 권한 체크
    requireAdmin();
    
    // 관리자 정보 표시
    const adminInfo = getAdminInfo();
    document.getElementById('adminName').textContent = adminInfo.name;
    
    // 데이터 로드
    loadDashboardData();
});

// 대시보드 데이터 로드
async function loadDashboardData() {
    try {
        const response = await fetch('tables/applications?limit=1000');
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const applications = data.data;
            
            // 통계 업데이트
            updateStatistics(applications);
            
            // 긴급 처리 필요 목록
            displayUrgentApplications(applications);
            
            // 최근 신청서 표시
            displayRecentApplications(applications);
        } else {
            // 데이터 없음
            document.getElementById('recentLoading').style.display = 'none';
            document.getElementById('recentEmpty').style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        document.getElementById('recentLoading').style.display = 'none';
        document.getElementById('recentEmpty').style.display = 'block';
    }
}

// 통계 업데이트
function updateStatistics(applications) {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    // 전체 신청
    const total = applications.length;
    document.getElementById('totalApplications').textContent = total;
    
    // 최근 7일 신청
    const recent = applications.filter(app => app.created_at >= sevenDaysAgo).length;
    document.getElementById('recentCount').textContent = recent;
    
    // 상태별 카운트
    const statusCount = {
        '접수완료': 0,
        '검토중': 0,
        '개별분석완료': 0,
        '학생동의완료': 0,
        '승인': 0,
        '거부': 0,
        '보류': 0
    };
    
    // 단계별 카운트 (추가!)
    const stepCount = {
        1: 0, // 접수완료
        2: 0, // 검토중
        3: 0, // 개별분석완료
        4: 0, // 학생동의완료
        5: 0, // 계약서발송
        6: 0, // 계약동의완료
        7: 0, // 입금대기
        8: 0, // 입금확인완료
        9: 0, // 이용방법전달
        10: 0 // 완료
    };
    
    applications.forEach(app => {
        const status = app.status || '접수완료';
        if (statusCount.hasOwnProperty(status)) {
            statusCount[status]++;
        } else {
            statusCount['접수완료']++;
        }
        
        // 단계별 카운트
        const step = app.current_step || 1;
        if (stepCount.hasOwnProperty(step)) {
            stepCount[step]++;
        }
    });
    
    // 대기중 (접수완료 + 검토중 + 개별분석완료 + 학생동의완료 + 보류)
    const pending = statusCount['접수완료'] + statusCount['검토중'] + statusCount['개별분석완료'] + statusCount['학생동의완료'] + statusCount['보류'];
    document.getElementById('pendingApplications').textContent = pending;
    
    // 승인
    document.getElementById('approvedApplications').textContent = statusCount['승인'];
    
    // 거부
    document.getElementById('rejectedApplications').textContent = statusCount['거부'];
    
    // 승인율 계산
    const approvalRate = total > 0 ? Math.round((statusCount['승인'] / total) * 100) : 0;
    document.getElementById('approvalRate').textContent = approvalRate;
    
    // 거부율 계산
    const rejectionRate = total > 0 ? Math.round((statusCount['거부'] / total) * 100) : 0;
    document.getElementById('rejectionRate').textContent = rejectionRate;
    
    // 긴급 처리 (3일 이상 경과)
    const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
    const urgent = applications.filter(app => {
        const status = app.status || '접수완료';
        return (status === '접수완료' || status === '검토중' || status === '개별분석완료') && app.created_at < threeDaysAgo;
    }).length;
    
    document.querySelector('#urgentCount span').textContent = urgent;
    
    // 단계별 통계 표시 (추가!)
    displayStepStatistics(stepCount, applications);
}

// 긴급 처리 필요 목록 표시
function displayUrgentApplications(applications) {
    const now = Date.now();
    const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
    
    const urgentApps = applications.filter(app => {
        const status = app.status || '접수완료';
        return (status === '접수완료' || status === '검토중') && app.created_at < threeDaysAgo;
    }).sort((a, b) => a.created_at - b.created_at); // 오래된 순
    
    if (urgentApps.length > 0) {
        document.getElementById('urgentCard').style.display = 'block';
        
        const urgentListHTML = urgentApps.slice(0, 5).map(app => {
            const daysAgo = getDaysAgo(app.created_at);
            return `
                <div style="padding: 16px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">
                                ${escapeHtml(app.name)} - ${escapeHtml(app.preferred_program || '프로그램 미정')}
                            </div>
                            <div style="font-size: 12px; color: #64748b;">
                                신청일: ${formatDateOnly(app.created_at)} (${daysAgo}일 경과)
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <a href="application-detail.html?id=${app.id}" class="admin-btn admin-btn-outline admin-btn-sm">
                                <i class="fas fa-eye"></i> 상세보기
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('urgentList').innerHTML = urgentListHTML;
    }
}

// 최근 신청서 표시
function displayRecentApplications(applications) {
    // 최신순 정렬
    const sortedApps = applications.sort((a, b) => b.created_at - a.created_at);
    
    // 최근 10개만
    const recentApps = sortedApps.slice(0, 10);
    
    const tableHTML = recentApps.map(app => {
        const status = app.status || '접수완료';
        let statusClass = 'info';
        let statusIcon = 'clock';
        
        if (status === '승인') {
            statusClass = 'success';
            statusIcon = 'check-circle';
        } else if (status === '거부') {
            statusClass = 'danger';
            statusIcon = 'times-circle';
        } else if (status === '검토중') {
            statusClass = 'warning';
            statusIcon = 'search';
        }
        
        return `
            <tr>
                <td style="font-weight: 600;">
                    ${escapeHtml(app.name)}
                </td>
                <td>
                    <span style="color: #9480c5; font-weight: 500;">
                        ${escapeHtml(app.preferred_program || '-')}
                    </span>
                </td>
                <td style="font-size: 13px; color: #64748b;">
                    ${getRelativeTime(app.created_at)}
                </td>
                <td>
                    <span class="admin-badge admin-badge-${statusClass}">
                        <i class="fas fa-${statusIcon}"></i> ${escapeHtml(status)}
                    </span>
                </td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <a href="application-detail.html?id=${app.id}" class="admin-btn admin-btn-primary admin-btn-sm">
                            <i class="fas fa-eye"></i> 상세
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    document.getElementById('recentTableBody').innerHTML = tableHTML;
    document.getElementById('recentLoading').style.display = 'none';
    document.getElementById('recentApplications').style.display = 'block';
}

// 상태별 필터링 (신청서 관리 페이지로 이동)
function filterByStatus(status) {
    if (status === 'all') {
        window.location.href = 'admin-applications.html';
    } else {
        window.location.href = `admin-applications.html?status=${encodeURIComponent(status)}`;
    }
}

// 단계별 통계 표시
function displayStepStatistics(stepCount, applications) {
    const stepNames = {
        1: '접수완료',
        2: '검토중',
        3: '개별분석완료 (학생 동의 대기)',
        4: '학생동의완료',
        5: '계약서발송',
        6: '계약동의완료',
        7: '입금대기',
        8: '입금확인완료',
        9: '이용방법전달',
        10: '챌린지시작'
    };
    
    // 긴급 카드 다음에 단계별 통계 카드 추가
    const urgentCard = document.getElementById('urgentCard');
    
    // 기존 단계별 카드가 있으면 제거
    const existingCard = document.getElementById('stepStatsCard');
    if (existingCard) {
        existingCard.remove();
    }
    
    // 단계별 통계 HTML 생성
    const stepStatsHTML = `
        <div class="admin-card" id="stepStatsCard">
            <div class="admin-card-header">
                <h2 class="admin-card-title">
                    <i class="fas fa-tasks"></i> 단계별 현황
                </h2>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                ${Object.entries(stepCount).map(([step, count]) => {
                    if (count === 0) return '';
                    
                    let color = '#64748b';
                    let bgColor = '#f8fafc';
                    let icon = 'clock';
                    
                    if (step === '3') {
                        color = '#f59e0b';
                        bgColor = '#fef3c7';
                        icon = 'exclamation-triangle';
                    } else if (step === '7') {
                        color = '#ef4444';
                        bgColor = '#fee2e2';
                        icon = 'credit-card';
                    } else if (step === '10') {
                        color = '#22c55e';
                        bgColor = '#dcfce7';
                        icon = 'check-circle';
                    }
                    
                    return `
                        <div style="padding: 16px; background: ${bgColor}; border-radius: 8px; border-left: 4px solid ${color};">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                <i class="fas fa-${icon}" style="color: ${color};"></i>
                                <span style="font-size: 12px; color: ${color}; font-weight: 600;">STEP ${step}</span>
                            </div>
                            <div style="font-size: 24px; font-weight: 700; color: ${color}; margin-bottom: 4px;">
                                ${count}건
                            </div>
                            <div style="font-size: 12px; color: #64748b;">
                                ${stepNames[step]}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    // 긴급 카드 다음에 삽입
    if (urgentCard && urgentCard.style.display !== 'none') {
        urgentCard.insertAdjacentHTML('afterend', stepStatsHTML);
    } else {
        // 긴급 카드가 없으면 최근 신청서 카드 앞에 삽입
        const recentCard = document.querySelector('.admin-card:last-of-type');
        if (recentCard) {
            recentCard.insertAdjacentHTML('beforebegin', stepStatsHTML);
        }
    }
}
