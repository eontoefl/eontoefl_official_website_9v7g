// Applications List Page
let allApplications = [];
let allAppNotices = [];
let currentPage = 1;
const itemsPerPage = 15;
let deleteTargetId = null;

/**
 * 이름 마스킹 처리 (김영희 → 김*희)
 */
function maskName(name) {
    if (!name || name.length === 0) return '-';
    if (name.length === 1) return name;
    if (name.length === 2) return name[0] + '*';
    return name[0] + '*' + name[name.length - 1];
}

/**
 * 현재 로그인한 사용자의 이메일 가져오기
 */
function getCurrentUserEmail() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    return userData ? userData.email : null;
}

/**
 * 현재 사용자가 관리자인지 확인
 */
function isAdmin() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    return userData && userData.role === 'admin';
}

/**
 * 본인 신청서인지 확인
 */
function isMyApplication(app) {
    const userEmail = getCurrentUserEmail();
    return userEmail && app.email === userEmail;
}

/**
 * 개별분석 등록 여부 확인
 */
function hasAnalysis(app) {
    return app.analysis_status && app.analysis_content;
}

/**
 * 액션 메뉴 토글 (position: fixed로 뷰포트 기준 배치 - 뱃지 기준)
 */
function toggleActionMenu(e, appId) {
    e.stopPropagation();
    e.preventDefault();
    // 기존 열린 메뉴 닫기
    document.querySelectorAll('.action-dropdown').forEach(el => {
        if (el.id !== 'menu-' + appId) {
            el.style.display = 'none';
        }
    });
    const menu = document.getElementById('menu-' + appId);
    
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
    } else {
        // 뱃지 위치 기준으로 fixed 포지션 계산
        const badge = e.currentTarget;
        const rect = badge.getBoundingClientRect();
        
        menu.style.position = 'fixed';
        menu.style.top = (rect.bottom + 6) + 'px';
        menu.style.left = rect.left + 'px';
        menu.style.right = 'auto';
        menu.style.display = 'block';
    }
}

/**
 * 수정하기
 */
function editApplication(e, appId) {
    e.stopPropagation();
    const app = allApplications.find(a => a.id === appId);
    if (!app) return;
    
    if (hasAnalysis(app)) {
        alert('개별분석이 이미 등록되어 수정할 수 없습니다.');
        return;
    }
    
    window.location.href = 'application-form.html?edit=' + appId;
}

/**
 * 삭제하기 모달 열기
 */
function openDeleteModal(e, appId) {
    e.stopPropagation();
    const app = allApplications.find(a => a.id === appId);
    if (!app) return;
    
    if (hasAnalysis(app)) {
        alert('개별분석이 이미 등록되어 삭제할 수 없습니다.');
        return;
    }
    
    deleteTargetId = appId;
    document.getElementById('deleteModal').style.display = 'block';
    // 메뉴 닫기
    document.querySelectorAll('.action-dropdown').forEach(el => el.style.display = 'none');
}

/**
 * 삭제 모달 닫기
 */
function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    deleteTargetId = null;
}

/**
 * 신청서 삭제 실행
 */
async function confirmDelete() {
    if (!deleteTargetId) return;
    
    const btn = document.getElementById('confirmDeleteBtn');
    btn.textContent = '삭제 중...';
    btn.disabled = true;
    
    try {
        await supabaseAPI.delete('applications', deleteTargetId);
        closeDeleteModal();
        
        // 삭제 완료 알림
        alert('신청서가 삭제되었습니다.');
        
        // 목록 새로고침
        await loadApplicationsList();
    } catch (error) {
        console.error('Delete failed:', error);
        alert('삭제 중 오류가 발생했습니다.');
    } finally {
        btn.textContent = '삭제하기';
        btn.disabled = false;
    }
}

// ==================== 공지사항 관련 ====================

/**
 * 공지사항 상세보기 - 페이지 이동 방식
 */
function openNoticeDetail(e, noticeId) {
    e.stopPropagation();
    e.preventDefault();
    window.location.href = 'application.html?notice_id=' + noticeId;
}

/**
 * 공지사항 상세 페이지 표시
 */
async function showNoticeDetail(noticeId) {
    // 목록 숨기고 상세 표시
    document.querySelector('.main-content > section:first-child').style.display = 'none';
    document.getElementById('noticeDetailView').style.display = 'block';

    try {
        // DB에서 공지 가져오기
        const notice = await supabaseAPI.getById('application_notices', noticeId);
        if (!notice) {
            document.getElementById('noticeDetailLoading').innerHTML = `
                <div style="text-align:center; color:#ef4444;">
                    <i class="fas fa-exclamation-circle" style="font-size:32px; margin-bottom:12px;"></i>
                    <p>존재하지 않는 공지사항입니다.</p>
                </div>`;
            return;
        }

        document.getElementById('noticeDetailSubject').textContent = notice.subject;
        document.getElementById('noticeDetailAuthor').textContent = notice.author || '관리자';
        document.getElementById('noticeDetailDate').textContent = notice.published_at
            ? new Date(notice.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
            : '';
        document.getElementById('noticeDetailContent').innerHTML = notice.content || '';

        // 첨부파일 표시
        if (typeof renderAttachments === 'function') {
            renderAttachments(notice.attachments, 'noticeDetailAttachments');
        }

        // 관리자 수정/삭제 버튼
        const adminBtns = document.getElementById('noticeAdminBtns');
        if (isAdmin()) {
            adminBtns.style.display = 'flex';
            adminBtns.innerHTML = `
                <button onclick="editNotice('${notice.id}')" style="width:32px; height:32px; border:1px solid #e2e8f0; background:white; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; color:#64748b; transition:all 0.2s;" onmouseover="this.style.borderColor='#9480c5'; this.style.color='#9480c5'; this.style.background='#f8f4ff'" onmouseout="this.style.borderColor='#e2e8f0'; this.style.color='#64748b'; this.style.background='white'" title="수정">
                    <i class="fas fa-pen" style="font-size:13px;"></i>
                </button>
                <button onclick="deleteNotice('${notice.id}')" style="width:32px; height:32px; border:1px solid #e2e8f0; background:white; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; color:#64748b; transition:all 0.2s;" onmouseover="this.style.borderColor='#ef4444'; this.style.color='#ef4444'; this.style.background='#fef2f2'" onmouseout="this.style.borderColor='#e2e8f0'; this.style.color='#64748b'; this.style.background='white'" title="삭제">
                    <i class="fas fa-trash-alt" style="font-size:13px;"></i>
                </button>
            `;
        }

        document.getElementById('noticeDetailLoading').style.display = 'none';
        document.getElementById('noticeDetailArticle').style.display = 'block';

    } catch (error) {
        console.error('공지 로드 실패:', error);
        document.getElementById('noticeDetailLoading').innerHTML = `
            <div style="text-align:center; color:#ef4444;">
                <i class="fas fa-exclamation-circle" style="font-size:32px; margin-bottom:12px;"></i>
                <p>공지사항을 불러오는데 실패했습니다.</p>
            </div>`;
    }
}

/**
 * 공지사항 수정 (write.html로 이동)
 */
function editNotice(noticeId) {
    window.location.href = 'write.html?board=application_notice&edit=' + noticeId;
}

/**
 * 공지사항 삭제
 */
async function deleteNotice(noticeId) {
    if (!confirm('이 공지사항을 삭제하시겠습니까?\n\n삭제된 글은 복구할 수 없습니다.')) return;
    try {
        await supabaseAPI.hardDelete('application_notices', noticeId);
        alert('공지사항이 삭제되었습니다.');
        window.location.href = 'application.html';
    } catch (error) {
        console.error('공지 삭제 실패:', error);
        alert('삭제에 실패했습니다. 다시 시도해주세요.');
    }
}

/**
 * 공지사항 행 HTML 생성
 */
function renderNoticeRows(notices) {
    const admin = isAdmin();
    return notices.map(notice => {
        const dateStr = notice.published_at
            ? getTimeAgo(notice.published_at)
            : '';
        return `
            <tr style="cursor:pointer; background:#faf8ff;" onclick="openNoticeDetail(event, '${notice.id}')">
                <td style="text-align:center;">
                    <span style="display:inline-flex; align-items:center; justify-content:center; background:linear-gradient(135deg, #9480c5 0%, #7d6aad 100%); color:white; font-size:10px; font-weight:700; padding:3px 8px; border-radius:4px; letter-spacing:0.5px;">공지</span>
                </td>
                <td>
                    <div style="font-size:14px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-bullhorn" style="color:#9480c5; font-size:12px;"></i>
                        ${escapeHtml(notice.subject)}
                    </div>
                </td>
                <td style="font-weight:500; color:#9480c5;">${escapeHtml(notice.author || '관리자')}</td>
                <td>
                    <span style="display:inline-flex; align-items:center; gap:4px; background:#f0ecf9; color:#7d6aad; font-size:11px; font-weight:600; padding:4px 10px; border-radius:12px;">
                        <i class="fas fa-thumbtack" style="font-size:9px;"></i> 고정
                    </span>
                </td>
                <td style="font-size:12px; color:#64748b;">${dateStr}</td>
            </tr>
        `;
    }).join('');
}

// ==================== 초기화 ====================

// 삭제 확인 버튼 이벤트
document.addEventListener('DOMContentLoaded', () => {
    // URL에 notice_id가 있으면 공지 상세 표시
    const params = new URLSearchParams(window.location.search);
    const noticeId = params.get('notice_id');
    
    if (noticeId) {
        showNoticeDetail(noticeId);
    } else {
        loadApplicationsList();
    }
    
    // 관리자면 공지 작성 버튼 표시
    if (isAdmin()) {
        const btn = document.getElementById('adminNoticeBtn');
        if (btn) btn.style.display = 'inline-flex';
    }
    
    // 삭제 확인 버튼
    setTimeout(() => {
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', confirmDelete);
    }, 100);
    
    // 문서 클릭 시 메뉴 닫기
    document.addEventListener('click', () => {
        document.querySelectorAll('.action-dropdown').forEach(el => el.style.display = 'none');
    });
    
    // 스크롤 시 메뉴 닫기
    window.addEventListener('scroll', () => {
        document.querySelectorAll('.action-dropdown').forEach(el => el.style.display = 'none');
    }, true);
});

// Load Applications List (+ 공지사항)
async function loadApplicationsList() {
    const listLoading = document.getElementById('listLoading');
    const tbody = document.getElementById('applicationsBody');
    
    listLoading.classList.add('show');
    
    try {
        // 공지사항과 신청서를 동시에 로드
        const [noticeResult, appResult] = await Promise.all([
            supabaseAPI.query('application_notices', { 'order': 'published_at.desc', 'limit': '50' }).catch(() => []),
            supabaseAPI.get('applications', { limit: 1000, sort: '-created_at' })
        ]);

        // 공지사항 저장
        allAppNotices = Array.isArray(noticeResult) ? noticeResult : [];

        if (appResult.data && appResult.data.length > 0) {
            // 삭제된 신청서 및 입문서 무료 신청(book_only) 필터링
            allApplications = appResult.data.filter(app => !app.deleted && app.application_type !== 'book_only');
            
            // Update total count
            document.getElementById('totalCount').textContent = allApplications.length;
            
            displayApplications();
        } else {
            // 공지사항만 있을 수 있으므로 공지 먼저 렌더링
            let html = '';
            if (allAppNotices.length > 0) {
                html += renderNoticeRows(allAppNotices);
            }
            html += '<tr><td colspan="5" style="text-align:center;padding:60px;color:#64748b;">아직 신청서가 없습니다.<br>첫 번째 신청자가 되어보세요!</td></tr>';
            tbody.innerHTML = html;
        }
    } catch (error) {
        console.error('Failed to load applications:', error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:60px;color:#ef4444;">목록을 불러오는데 실패했습니다.</td></tr>';
    } finally {
        listLoading.classList.remove('show');
    }
}

// Display Applications (공지사항 상단 고정 포함)
function displayApplications() {
    const tbody = document.getElementById('applicationsBody');
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedApps = allApplications.slice(startIndex, endIndex);

    // 1페이지일 때만 공지사항 상단 고정 표시
    let noticeHtml = '';
    if (currentPage === 1 && allAppNotices.length > 0) {
        noticeHtml = renderNoticeRows(allAppNotices);
    }
    
    const appHtml = paginatedApps.map((app, index) => {
        const rowNumber = allApplications.length - startIndex - index;
        
        // 상태 판단 로직
        let statusText = '';
        let statusClass = '';
        let statusIcon = '';
        
        if (!app.analysis_status || !app.analysis_content) {
            statusText = '승인 검토중';
            statusClass = 'status-reviewing';
            statusIcon = 'fa-clock';
        } else {
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
        
        const timeAgo = getTimeAgo(app.created_at);
        
        // 제목 - application_title 필드 우선, 없으면 기존 방식
        let title = app.application_title || `${app.program || app.preferred_program || '프로그램'} 신청`;
        if (app.admin_comment) {
            title += ' 💬';
        }
        
        // 본인 신청서 여부
        const isMine = isMyApplication(app);
        const analysisRegistered = hasAnalysis(app);
        
        // 내 신청서 뱃지 (클릭 시 수정/삭제 드롭다운)
        let myBadge = '';
        if (isMine) {
            myBadge = `<span onclick="toggleActionMenu(event, '${app.id}')" style="display:inline-flex; align-items:center; justify-content:center; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:white; width:22px; height:22px; border-radius:50%; margin-left:6px; cursor:pointer; flex-shrink:0; transition:transform 0.15s, box-shadow 0.15s;" onmouseover="this.style.transform='scale(1.15)'; this.style.boxShadow='0 2px 8px rgba(102,126,234,0.4)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'" title="내 신청서 - 클릭하여 관리"><i class="fas fa-user" style="font-size:10px;"></i></span>`;
            myBadge += `<div id="menu-${app.id}" class="action-dropdown" style="display:none; background:white; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:10000; min-width:140px; overflow:hidden;">
                <button onclick="editApplication(event, '${app.id}')" style="display:flex; align-items:center; gap:8px; width:100%; padding:10px 16px; border:none; background:none; cursor:pointer; font-size:13px; color:#1e293b; font-family:inherit; text-align:left;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='none'">
                    <i class="fas fa-pen" style="color:#9480c5; font-size:12px; width:16px;"></i> 수정하기
                </button>
                <button onclick="openDeleteModal(event, '${app.id}')" style="display:flex; align-items:center; gap:8px; width:100%; padding:10px 16px; border:none; background:none; cursor:pointer; font-size:13px; color:#ef4444; font-family:inherit; text-align:left;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='none'">
                    <i class="fas fa-trash" style="font-size:12px; width:16px;"></i> 삭제하기
                </button>
            </div>`;
        }
        
        return `
            <tr style="cursor: pointer;" onclick="window.location.href='application-detail.html?id=${app.id}'">
                <td style="text-align: center; font-weight: 600; color: #64748b;">${rowNumber}</td>
                <td>
                    <div style="font-size: 14px; font-weight: 600; color: #1e293b; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-lock" style="color: #94a3b8; font-size: 12px;"></i>
                        ${escapeHtml(title)}
                        ${myBadge}
                    </div>
                </td>
                <td style="font-weight: 600;">${escapeHtml(maskName(app.name) || '이름 없음')}</td>
                <td>
                    <span class="status-badge ${statusClass}">
                        <i class="fas ${statusIcon}" style="margin-right: 4px; font-size: 11px;"></i>
                        ${statusText}
                    </span>
                </td>
                <td style="font-size: 12px; color: #64748b;">${timeAgo}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = noticeHtml + appHtml;
    
    // Show pagination if needed
    if (allApplications.length > itemsPerPage) {
        displayPagination();
    } else {
        document.getElementById('pagination').style.display = 'none';
    }
}

// Display Pagination
function displayPagination() {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(allApplications.length / itemsPerPage);
    
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'block';
    pagination.innerHTML = '';
    
    // Previous button
    if (currentPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.style.cssText = `
            padding: 8px 12px;
            margin: 0 4px;
            border: 1px solid #e2e8f0;
            background: #fff;
            color: #1e293b;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
        `;
        prevBtn.addEventListener('click', () => {
            currentPage--;
            displayApplications();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        pagination.appendChild(prevBtn);
    }
    
    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            const button = document.createElement('button');
            button.textContent = i;
            button.style.cssText = `
                padding: 8px 14px;
                margin: 0 4px;
                border: 1px solid #e2e8f0;
                background: ${i === currentPage ? '#9480c5' : '#fff'};
                color: ${i === currentPage ? '#fff' : '#1e293b'};
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
            `;
            
            button.addEventListener('click', () => {
                currentPage = i;
                displayApplications();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            
            pagination.appendChild(button);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.style.cssText = 'margin: 0 8px; color: #64748b;';
            pagination.appendChild(dots);
        }
    }
    
    // Next button
    if (currentPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.style.cssText = `
            padding: 8px 12px;
            margin: 0 4px;
            border: 1px solid #e2e8f0;
            background: #fff;
            color: #1e293b;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
        `;
        nextBtn.addEventListener('click', () => {
            currentPage++;
            displayApplications();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        pagination.appendChild(nextBtn);
    }
}

// Get time ago text
function getTimeAgo(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    
    // 오늘 날짜 (시간 제거)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    // 날짜 차이 계산 (일 단위)
    const diffDays = Math.floor((today - targetDay) / 86400000);
    
    // 시간 포맷팅
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? '오후' : '오전';
    const displayHours = hours % 12 || 12;
    const timeString = `${period} ${displayHours}:${minutes.toString().padStart(2, '0')}`;
    
    if (diffDays === 0) {
        // 당일: "오후 6:11"
        return timeString;
    } else if (diffDays === 1) {
        // 전날: "어제 오후 6:11"
        return `어제 ${timeString}`;
    } else {
        // 그 이전: "2026-02-13"
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}
