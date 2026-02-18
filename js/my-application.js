// My Application Search JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Check if there's a saved name in localStorage
    const lastSearchName = localStorage.getItem('last_application_name');
    if (lastSearchName) {
        document.getElementById('searchName').value = lastSearchName;
        // Auto-search if redirected from application form
        if (document.referrer.includes('application.html')) {
            setTimeout(() => {
                document.getElementById('searchForm').dispatchEvent(new Event('submit'));
            }, 500);
        }
    }
});

// Search Form Handler
document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const searchName = document.getElementById('searchName').value.trim();
    if (!searchName) {
        showAlert('이름을 입력해주세요.', 'error');
        return;
    }
    
    // Show loading
    showLoading(true);
    document.getElementById('resultsContainer').style.display = 'none';
    document.getElementById('noResults').style.display = 'none';
    
    try {
        const response = await fetch(`tables/applications?search=${encodeURIComponent(searchName)}&limit=100`);
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            // Filter by exact or partial name match
            const filtered = data.data.filter(app => 
                app.name && app.name.toLowerCase().includes(searchName.toLowerCase())
            );
            
            if (filtered.length > 0) {
                displayResults(filtered);
            } else {
                document.getElementById('noResults').style.display = 'block';
            }
        } else {
            document.getElementById('noResults').style.display = 'block';
        }
    } catch (error) {
        console.error('Search error:', error);
        showAlert('검색 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
});

// Display search results
function displayResults(applications) {
    const container = document.getElementById('resultsContainer');
    const resultsList = document.getElementById('resultsList');
    
    // Sort by created_at descending
    applications.sort((a, b) => b.created_at - a.created_at);
    
    resultsList.innerHTML = applications.map(app => {
        const statusClass = app.status === '승인' ? 'status-approved' : 
                          app.status === '거부' ? 'status-rejected' : 'status-pending';
        const statusIcon = app.status === '승인' ? 'check-circle' : 
                          app.status === '거부' ? 'times-circle' : 'clock';
        
        return `
            <div class="program-card" style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                    <div>
                        <h3 class="program-title" style="font-size: 16px; margin-bottom: 8px;">
                            ${escapeHtml(app.assigned_program || app.preferred_program || '프로그램 미정')}
                        </h3>
                        <p style="font-size: 12px; color: #64748b;">
                            신청인: ${maskName(app.name)} | 신청일: ${formatDate(app.created_at)}
                        </p>
                    </div>
                    <span class="status-badge ${statusClass}">
                        <i class="fas fa-${statusIcon}"></i> ${escapeHtml(app.status)}
                    </span>
                </div>
                
                <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 12px;">
                        <div>
                            <div style="color: #64748b; margin-bottom: 4px;">이메일</div>
                            <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.email)}</div>
                        </div>
                        <div>
                            <div style="color: #64748b; margin-bottom: 4px;">전화번호</div>
                            <div style="font-weight: 600; color: #1e293b;">${escapeHtml(app.phone)}</div>
                        </div>
                        <div>
                            <div style="color: #64748b; margin-bottom: 4px;">현재 점수</div>
                            <div style="font-weight: 600; color: #1e293b;">${app.total_score || (app.has_toefl_score === 'no' ? '점수 없음' : '-')}</div>
                        </div>
                        <div>
                            <div style="color: #64748b; margin-bottom: 4px;">목표 점수</div>
                            <div style="font-weight: 600; color: #9480c5;">${app.target_cutoff_old || app.target_cutoff_new || '-'}</div>
                        </div>
                    </div>
                </div>
                
                ${app.why_toefl ? `
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px;">토플 준비 이유</div>
                    <div style="font-size: 13px; color: #1e293b; line-height: 1.6;">
                        ${escapeHtml(app.why_toefl)}
                    </div>
                </div>
                ` : ''}
                
                ${app.admin_comment ? `
                    <div style="background: #e8e0f5; border-left: 4px solid #9480c5; padding: 12px 16px; border-radius: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #5e4a8b; margin-bottom: 6px;">
                            <i class="fas fa-comment-dots"></i> 관리자 메시지
                        </div>
                        <div style="font-size: 13px; color: #1e293b; line-height: 1.6;">
                            ${escapeHtml(app.admin_comment)}
                        </div>
                    </div>
                ` : ''}
                
                ${app.status === '대기중' ? `
                    <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 6px; font-size: 12px; color: #92400e;">
                        <i class="fas fa-hourglass-half"></i> 신청서를 검토 중입니다. 곧 연락드리겠습니다.
                    </div>
                ` : ''}
                
                ${app.status === '승인' ? `
                    <div style="margin-top: 16px; padding: 12px; background: #e8f5e9; border-radius: 6px; font-size: 12px; color: #2e7d32;">
                        <i class="fas fa-check-circle"></i> 신청이 승인되었습니다! 등록된 연락처로 안내해드리겠습니다.
                    </div>
                ` : ''}
                
                ${app.status === '거부' ? `
                    <div style="margin-top: 16px; padding: 12px; background: #fee2e2; border-radius: 6px; font-size: 12px; color: #991b1b;">
                        <i class="fas fa-times-circle"></i> 죄송합니다. 현재 해당 프로그램의 정원이 마감되었습니다.
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    container.style.display = 'block';
}
