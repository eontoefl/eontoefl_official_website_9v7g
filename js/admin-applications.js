// Admin Applications Management JavaScript
let allApplications = [];
let filteredApplications = [];
let selectedIds = new Set();
const itemsPerPage = 20;
let currentPage = 1;
let currentAppTypeTab = 'all'; // 'all' | 'challenge' | 'book_only'
let bookProgressCache = {};  // user_id → { max_page_reached, last_page, is_completed, bookmarks }
let bookMemoCountCache = {}; // user_id → count

// ===== 유도학생 상태 판별 =====
// 반환값: 'waiting' (동의 대기 또는 분석 전) | 'converted' (동의 완료=매출전환) | 'expired' (5일 만료) | null (유도학생 아님)
function getIncentiveStatus(app) {
    if (!app.is_incentive_applicant) return null;
    // 동의 완료 → 매출 전환
    if (app.student_agreed_at) return 'converted';
    // 데드라인 기준: 최초 저장 시각(analysis_first_saved_at) 우선, 구 데이터는 폴백
    const analysisTs = app.analysis_first_saved_at || app.analysis_completed_at || app.analysis_saved_at;
    if (!analysisTs) return 'waiting'; // 분석 전이어도 프로모션 상태 표시 (목록 일괄처리로 ON된 케이스)
    const deadlineMs = 5 * 24 * 60 * 60 * 1000;
    const remaining = deadlineMs - (Date.now() - new Date(analysisTs).getTime());
    if (remaining <= 0) return 'expired';
    return 'waiting';
}

// ===== 유도학생 이름 옆 뱃지 (내챌 탭용) =====
function getIncentiveNameBadge(app) {
    const status = getIncentiveStatus(app);
    if (!status) return '';
    if (status === 'converted') {
        return ' <span style="display:inline-block; background:#dcfce7; color:#16a34a; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">유도전환</span>';
    }
    if (status === 'expired') {
        return ' <span style="display:inline-block; background:#f1f5f9; color:#94a3b8; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">프로모션 만료</span>';
    }
    // waiting
    return ' <span style="display:inline-block; background:#f59e0b; color:white; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">프로모션</span>';
}

// ===== 유도학생 이름 옆 뱃지 (입문서 탭용) =====
function getIncentiveBookBadge(app) {
    const isIncentive = app.is_incentive_applicant && app.application_type !== 'book_only';
    if (!isIncentive) {
        return '<span style="display:inline-block; background:#ede9fe; color:#7c3aed; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">📖 입문서</span>';
    }
    const status = getIncentiveStatus(app);
    if (status === 'converted') {
        return '<span style="display:inline-block; background:#dcfce7; color:#16a34a; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">🔀 유도전환</span>';
    }
    if (status === 'expired') {
        return '<span style="display:inline-block; background:#f1f5f9; color:#94a3b8; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">🔀 유도 만료</span>';
    }
    // waiting or null (분석 전)
    return '<span style="display:inline-block; background:#f59e0b; color:white; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">🔀 유도학생</span>';
}

// ===== 유도학생 동의 데드라인 타이머 표시 (관리자 상태칸) =====
function getIncentiveDeadlineDisplay(app) {
    if (!app.is_incentive_applicant) return '';
    if (app.student_agreed_at) return ''; // 동의 완료 → 타이머 불필요
    // 데드라인 기준: 최초 저장 시각(analysis_first_saved_at) 우선, 구 데이터는 폴백
    const analysisTs = app.analysis_first_saved_at || app.analysis_completed_at || app.analysis_saved_at;
    if (!analysisTs) return '';
    
    const deadlineMs = 5 * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(analysisTs).getTime();
    const remaining = deadlineMs - elapsed;
    
    // 만료 → 회색
    if (remaining <= 0) {
        return '<div style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:600; background:#f1f5f9; color:#94a3b8; margin-top:4px; white-space:nowrap;"><i class="fas fa-ban" style="font-size:9px;"></i> 동의기한 만료</div>';
    }
    
    const totalSec = Math.floor(remaining / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    
    let timeText;
    if (days > 0) {
        timeText = `${days}일 ${hours}시간`;
    } else if (hours > 0) {
        timeText = `${hours}시간 ${minutes}분`;
    } else {
        timeText = `${minutes}분`;
    }
    
    // 긴급 (24시간 이내)
    const isUrgent = remaining <= 24 * 60 * 60 * 1000;
    const bgColor = isUrgent ? '#fee2e2' : '#fef3c7';
    const textColor = isUrgent ? '#dc2626' : '#92400e';
    const icon = isUrgent ? 'fa-exclamation-circle' : 'fa-clock';
    
    return `<div style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; background:${bgColor}; color:${textColor}; margin-top:4px; white-space:nowrap;"><i class="fas ${icon}" style="font-size:9px;"></i> 동의 ${timeText} 남음</div>`;
}

// 관리자 상태 메시지 반환 함수
function getAdminActionMessage(app) {
    // 입문서 신청은 별도 배지 표시
    if (app.application_type === 'book_only') {
        return { text: '📖 입문서 신청', color: '#7c3aed', bgColor: '#ede9fe' };
    }
    
    // 1-a. AI 분석 자동 생성 완료, 관리자 검토 대기 → 🟠 검토 대기
    if (app.analysis_content && !app.analysis_status) {
        // 예약 발송 대기 중이면 → 🟢 발송 예약됨 (검토 완료 + 발송 시간 대기)
        if (app.analysis_alimtalk_scheduled_at && app.analysis_status_pending && app.analysis_content_pending) {
            const schedDate = new Date(app.analysis_alimtalk_scheduled_at);
            const schedStr = !isNaN(schedDate.getTime()) ? schedDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            return { text: `발송예약 ${schedStr}`, color: '#14b8a6', bgColor: '#f0fdfa', icon: 'fa-clock' };
        }
        return { text: '검토 대기', color: '#f59e0b', bgColor: '#fef3c7', icon: 'fa-bell' };
    }

    // 1-b. 신청서 제출 ~ 관리자 분석 등록 전 (분석 내용 없음)
    if (!app.analysis_status || !app.analysis_content) {
        // 예약 발송 대기 중 (n8n 자동 생성 전이지만 관리자가 직접 예약 저장한 케이스)
        if (app.analysis_alimtalk_scheduled_at && app.analysis_status_pending && app.analysis_content_pending) {
            const schedDate = new Date(app.analysis_alimtalk_scheduled_at);
            const schedStr = !isNaN(schedDate.getTime()) ? schedDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            return { text: `발송예약 ${schedStr}`, color: '#14b8a6', bgColor: '#f0fdfa', icon: 'fa-clock' };
        }
        return { text: '개별 분석을 올려주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 2. 관리자 분석 등록 완료 → ✅ 발송 완료 (학생 동의 대기)
    if (!app.student_agreed_at) {
        return { text: '발송완료', color: '#22c55e', bgColor: '#dcfce7', icon: 'fa-check-circle', subText: '학생 동의 대기' };
    }
    
    // 3. 학생 동의 완료 ~ 관리자 계약서 업로드 전
    if (!app.contract_sent) {
        return { text: '계약서를 올려주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 4. 관리자 계약서 업로드 ~ 학생 계약서 동의 전
    if (!app.contract_agreed) {
        return { text: '계약서 동의를 기다리고 있어요', color: '#3b82f6', bgColor: '#dbeafe' };
    }
    
    // 5. 학생 계약서 동의 ~ 학생 입금 버튼 클릭 전
    if (!app.deposit_confirmed_by_student) {
        return { text: '입금을 기다리고 있어요', color: '#3b82f6', bgColor: '#dbeafe' };
    }
    
    // 6. 학생 입금 버튼 클릭 ~ 관리자 입금 확인 전
    if (!app.deposit_confirmed_by_admin) {
        return { text: '입금확인 해주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 7. 관리자 입금 확인 ~ 관리자 이용방법 업로드 전
    if (!app.guide_sent) {
        return { text: '이용방법을 올려주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 8. 관리자 이용방법 업로드 ~ 택배 발송 등록 전
    if (!app.shipping_completed) {
        return { text: '택배를 발송해주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 9. 모든 세팅 완료 → 운영 상태로 전환 (isLive로 디자인 구분)
    const liveStatus = getAppLiveStatus(app);
    if (liveStatus) {
        // 내챌 상태 텍스트 결정
        const hasCorrection = app.correction_enabled;
        const nLabel = hasCorrection ? '내챌 ' : '';
        let result;
        if (liveStatus.key === 'ready') result = { text: `${nLabel}시작 대기`, color: '#3b82f6', bgColor: '#dbeafe', icon: 'fa-clock', isLive: true };
        else if (liveStatus.key === 'active') result = { text: `${nLabel}진행중`, color: '#7c3aed', bgColor: '#ede9fe', icon: 'fa-running', isLive: true };
        else if (liveStatus.key === 'completed') result = { text: `${nLabel}종료`, color: '#22c55e', bgColor: '#dcfce7', icon: 'fa-check-circle', isLive: true };
        else if (liveStatus.key === 'refunded') result = { text: '환불완료', color: '#ef4444', bgColor: '#fef2f2', icon: 'fa-undo', isLive: true };
        else if (liveStatus.key === 'dropped') result = { text: '중도포기', color: '#94a3b8', bgColor: '#f1f5f9', icon: 'fa-user-slash', isLive: true };
        
        // 첨삭 상태 뱃지 추가 (환불/중도포기가 아닌 경우)
        if (result && hasCorrection && liveStatus.key !== 'refunded' && liveStatus.key !== 'dropped') {
            const corrStatus = getCorrectionStatus(app);
            if (corrStatus) {
                const corrColorMap = {
                    'waiting': { color: '#3b82f6', icon: 'fa-hourglass-half' },
                    'pending': { color: '#94a3b8', icon: 'fa-clock' },
                    'active': { color: '#2563eb', icon: 'fa-pen-nib' },
                    'completed': { color: '#22c55e', icon: 'fa-check-circle' },
                    'refunded': { color: '#ef4444', icon: 'fa-undo' }
                };
                const corrStyle = corrColorMap[corrStatus.key] || { color: '#94a3b8', icon: 'fa-circle' };
                const corrLabel = corrStatus.key === 'waiting' ? `첨삭 ${corrStatus.label}` 
                    : corrStatus.key === 'pending' ? `첨삭 ${corrStatus.label}` 
                    : corrStatus.key === 'active' ? '첨삭 진행중' 
                    : corrStatus.key === 'completed' ? '첨삭 종료' 
                    : corrStatus.key === 'refunded' ? '첨삭 환불' : '첨삭';
                result.correctionBadge = { text: corrLabel, color: corrStyle.color, icon: corrStyle.icon };
            }
        }
        if (result) return result;
    }
    return { text: '세팅 완료', color: '#22c55e', bgColor: '#dcfce7' };
}

// 앱 상태를 필터 카테고리로 분류
function getAppStageFilter(app) {
    // 입문서 신청은 별도 카테고리
    if (app.application_type === 'book_only') return 'book_only';
    // 예약 발송 대기 중이면 → 학생 액션 대기 (관리자 할 일 끝남)
    if (app.analysis_alimtalk_scheduled_at && app.analysis_status_pending && app.analysis_content_pending) return 'student_waiting';
    // 1-a. AI 분석 자동 생성 완료, 관리자 검토 대기
    if (app.analysis_content && !app.analysis_status) return 'need_review';
    // 1-b. 개별분석 미등록
    if (!app.analysis_status || !app.analysis_content) return 'need_analysis';
    // 2. 학생 동의 대기
    if (!app.student_agreed_at) return 'student_waiting';
    // 3. 계약서 미발송
    if (!app.contract_sent) return 'need_contract';
    // 4. 계약서 동의 대기
    if (!app.contract_agreed) return 'student_waiting';
    // 5. 학생 입금 대기
    if (!app.deposit_confirmed_by_student) return 'student_waiting';
    // 6. 관리자 입금확인 필요
    if (!app.deposit_confirmed_by_admin) return 'need_deposit';
    // 7. 이용방법 전달 필요
    if (!app.guide_sent) return 'need_guide';
    // 8. 택배 발송 필요
    if (!app.shipping_completed) return 'need_shipping';
    // 9. 세팅 완료 → 운영 상태 세분화
    const liveStatus = getAppLiveStatus(app);
    if (liveStatus) {
        if (liveStatus.key === 'ready') return 'live_ready';
        if (liveStatus.key === 'active') return 'live_active';
        if (liveStatus.key === 'completed') return 'live_completed';
        if (liveStatus.key === 'refunded') return 'live_refunded';
        if (liveStatus.key === 'dropped') return 'live_dropped';
    }
    return 'completed';
}

document.addEventListener('DOMContentLoaded', () => {
    // 관리자 권한 체크
    requireAdmin();
    
    // 관리자 정보 표시
    const adminInfo = getAdminInfo();
    document.getElementById('adminName').textContent = adminInfo.name;
    
    // URL 파라미터 확인
    const urlParams = new URLSearchParams(window.location.search);
    const statusParam = urlParams.get('status');
    if (statusParam) {
        document.getElementById('statusFilter').value = statusParam;
    }
    
    // 이벤트 리스너
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);
    document.getElementById('programFilter').addEventListener('change', applyFilters);
    const correctionFilterEl = document.getElementById('correctionFilter');
    if (correctionFilterEl) correctionFilterEl.addEventListener('change', applyFilters);
    document.getElementById('sortBy').addEventListener('change', applyFilters);
    
    // URL 해시에서 탭 상태 복원
    const hash = window.location.hash.replace('#', '');
    if (['all', 'challenge', 'book_only'].includes(hash)) {
        currentAppTypeTab = hash;
    }

    // 데이터 로드
    loadApplications();
});

// 신청서 데이터 로드
async function loadApplications() {
    try {
        const result = await supabaseAPI.get('applications', { limit: 1000 });
        
        if (result.data && result.data.length > 0) {
            allApplications = result.data;
            updateTabCounts();
            switchAppTypeTab(currentAppTypeTab, true);
        } else {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('emptyState').style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to load applications:', error);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
    }
}

// ===== 탭 카운트 업데이트 =====
function updateTabCounts() {
    const notDeleted = a => a.deleted !== true && a.deleted !== 'true';
    const allCount = allApplications.filter(notDeleted).length;
    const challengeCount = allApplications.filter(a => a.application_type !== 'book_only' && notDeleted(a)).length;
    // 입문서 탭: 순수 입문서 신청 + 유도학생(챌린지 신청이지만 is_incentive_applicant=true)
    const bookCount = allApplications.filter(a => 
        (a.application_type === 'book_only' || a.is_incentive_applicant) && notDeleted(a)
    ).length;
    
    const elAll = document.getElementById('tabCountAll');
    const elChallenge = document.getElementById('tabCountChallenge');
    const elBook = document.getElementById('tabCountBook');
    if (elAll) elAll.textContent = allCount;
    if (elChallenge) elChallenge.textContent = challengeCount;
    if (elBook) elBook.textContent = bookCount;
}

// ===== 탭 전환 =====
function switchAppTypeTab(tabType, skipReload) {
    currentAppTypeTab = tabType;
    window.location.hash = tabType;
    
    // 탭 UI 업데이트
    document.querySelectorAll('.app-type-tab').forEach(btn => {
        const isActive = btn.dataset.type === tabType;
        btn.style.color = isActive ? '#9480c5' : '#94a3b8';
        btn.style.borderBottomColor = isActive ? '#9480c5' : 'transparent';
        const badge = btn.querySelector('span');
        if (badge) {
            badge.style.background = isActive ? '#9480c5' : '#e2e8f0';
            badge.style.color = isActive ? 'white' : '#64748b';
        }
    });
    
    // 입문서 탭이면 챌린지 전용 필터 숨기기
    const statusFilter = document.getElementById('statusFilter');
    const programFilter = document.getElementById('programFilter');
    if (tabType === 'book_only') {
        statusFilter.style.display = 'none';
        programFilter.style.display = 'none';
    } else {
        statusFilter.style.display = '';
        programFilter.style.display = '';
    }
    
    // 테이블 전환
    const challengeTable = document.getElementById('challengeTable');
    const bookTable = document.getElementById('bookTable');
    if (challengeTable) challengeTable.style.display = tabType === 'book_only' ? 'none' : '';
    if (bookTable) bookTable.style.display = tabType === 'book_only' ? '' : 'none';
    
    // 입문서 탭이면 진도 데이터를 먼저 로드한 뒤 필터 적용
    if (tabType === 'book_only') {
        loadBookProgressData().then(() => applyFilters());
    } else {
        applyFilters();
    }
}

// ===== 입문서 진도/메모 데이터 일괄 로드 =====
async function loadBookProgressData() {
    // 이미 로드했으면 스킵
    if (Object.keys(bookProgressCache).length > 0) return;
    
    try {
        const [progressResult, memosResult] = await Promise.all([
            supabaseAPI.query('tr_book_progress', { 'order': 'updated_at.desc', 'limit': '1000' }),
            supabaseAPI.query('tr_book_memos', { 'limit': '5000' })
        ]);
        
        // 진도: user_id별 최신 1건만
        if (progressResult) {
            for (const p of progressResult) {
                if (!bookProgressCache[p.user_id]) {
                    bookProgressCache[p.user_id] = p;
                }
            }
        }
        
        // 메모: user_id별 카운트
        if (memosResult) {
            for (const m of memosResult) {
                bookMemoCountCache[m.user_id] = (bookMemoCountCache[m.user_id] || 0) + 1;
            }
        }
    } catch (e) {
        console.warn('입문서 진도/메모 로드 실패:', e);
    }
}

// 필터 적용
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const programFilter = document.getElementById('programFilter').value;
    const correctionFilter = document.getElementById('correctionFilter')?.value || 'all';
    const sortBy = document.getElementById('sortBy').value;
    
    // 탭 기반 사전 필터링
    let baseApplications = allApplications;
    if (currentAppTypeTab === 'challenge') {
        baseApplications = allApplications.filter(a => a.application_type !== 'book_only');
    } else if (currentAppTypeTab === 'book_only') {
        // 순수 입문서 신청 + 유도학생(챌린지 신청이지만 is_incentive_applicant=true)
        baseApplications = allApplications.filter(a => a.application_type === 'book_only' || a.is_incentive_applicant);
    }
    
    // 필터링
    filteredApplications = baseApplications.filter(app => {
        // 검색어 필터
        const matchesSearch = !searchTerm || 
            (app.name && app.name.toLowerCase().includes(searchTerm)) ||
            (app.email && app.email.toLowerCase().includes(searchTerm)) ||
            (app.phone && app.phone.toLowerCase().includes(searchTerm));
        
        // 입문서 탭에서는 상태/프로그램 필터 무시
        if (currentAppTypeTab === 'book_only') {
            return matchesSearch;
        }
        
        // 상태 필터 (프로세스 단계 기반)
        const matchesStatus = statusFilter === 'all' || getAppStageFilter(app) === statusFilter;
        
        // 프로그램 필터
        const matchesProgram = programFilter === 'all' || 
            (app.preferred_program || '') === programFilter;
        
        // 첨삭 필터
        const matchesCorrection = correctionFilter === 'all' ||
            (correctionFilter === 'enabled' && app.correction_enabled) ||
            (correctionFilter === 'disabled' && !app.correction_enabled);
        
        return matchesSearch && matchesStatus && matchesProgram && matchesCorrection;
    });
    
    // 정렬
    if (sortBy === 'newest') {
        filteredApplications.sort((a, b) => b.created_at - a.created_at);
    } else if (sortBy === 'oldest') {
        filteredApplications.sort((a, b) => a.created_at - b.created_at);
    } else if (sortBy === 'name') {
        filteredApplications.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
    } else if (sortBy === 'startDate_asc') {
        filteredApplications.sort((a, b) => {
            const dateA = a.schedule_start ? new Date(a.schedule_start) : new Date('9999-12-31');
            const dateB = b.schedule_start ? new Date(b.schedule_start) : new Date('9999-12-31');
            return dateA - dateB;
        });
    } else if (sortBy === 'startDate_desc') {
        filteredApplications.sort((a, b) => {
            const dateA = a.schedule_start ? new Date(a.schedule_start) : new Date('0000-01-01');
            const dateB = b.schedule_start ? new Date(b.schedule_start) : new Date('0000-01-01');
            return dateB - dateA;
        });
    }
    
    // 페이지 초기화
    currentPage = 1;
    
    if (currentAppTypeTab === 'book_only') {
        displayBookApplications();
    } else {
        displayApplications();
    }
}

// 신청서 표시
function displayApplications() {
    if (filteredApplications.length === 0) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('applicationsTable').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }
    
    // 페이지네이션 계산
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageApplications = filteredApplications.slice(startIndex, endIndex);
    
    // 테이블 생성
    const tableHTML = pageApplications.map(app => {
        const actionMessage = getAdminActionMessage(app);
        const isSelected = selectedIds.has(app.id);
        const liveStatus = getAppLiveStatus(app);
        const isInactive = liveStatus && (liveStatus.key === 'refunded' || liveStatus.key === 'dropped');
        
        return `
            <tr style="${isSelected ? 'background: #f0f9ff;' : ''}${app.deleted || isInactive ? 'opacity: 0.55;' : ''}">
                <td>
                    <input type="checkbox" 
                           class="app-checkbox" 
                           data-id="${app.id}" 
                           ${isSelected ? 'checked' : ''}
                           onchange="toggleSelection('${app.id}')">
                </td>
                <td style="font-weight: 600;">
                    ${escapeHtml(app.name)}${getIncentiveNameBadge(app)}${app.deleted ? ' <span style="display:inline-block; background:#ef4444; color:white; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">삭제됨</span>' : ''}
                </td>
                <td style="font-size: 13px;">
                    ${escapeHtml(app.email)}
                </td>
                <td style="font-size: 13px; white-space:nowrap;">
                    ${getScoreDisplay(app)}
                </td>
                <td style="font-size: 13px;">
                    ${getDeadlineDisplay(app)}
                </td>
                <td>
                    <span style="color: #9480c5; font-weight: 500; font-size: 13px;">
                        ${escapeHtml(app.assigned_program || app.preferred_program || '-')}
                    </span>
                    ${app.correction_enabled ? '<span style="display:inline-block; background:#dbeafe; color:#2563eb; font-size:10px; font-weight:600; padding:1px 6px; border-radius:4px; margin-left:4px;">첨삭</span>' : ''}
                </td>
                <td style="font-size: 12px; color: #64748b; line-height: 1.5;">
                    ${app.schedule_start 
                        ? `<div style="white-space:nowrap;">${app.correction_enabled ? '<span style="color:#7c3aed; font-weight:600;">내챌</span> ' : ''}${formatDateWithDay(app.schedule_start)} ${getDday(app.schedule_start)}</div>`
                        : '<span style="color:#94a3b8;">미정</span>'}
                    ${app.correction_enabled && app.correction_start_date 
                        ? `<div style="white-space:nowrap; margin-top:2px;"><span style="color:#2563eb; font-weight:600;">첨삭</span> ${formatDateWithDay(app.correction_start_date)} ${getDday(app.correction_start_date)}</div>`
                        : ''}
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                        ${actionMessage.isLive 
                            ? `<div style="display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; white-space: nowrap; background: ${actionMessage.color}; color: white; letter-spacing: 0.3px;"><i class="fas ${actionMessage.icon}" style="font-size: 10px;"></i>${actionMessage.text}</div>`
                            : `<div style="display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap; background: ${actionMessage.bgColor}; color: ${actionMessage.color};">${actionMessage.icon ? `<i class="fas ${actionMessage.icon}" style="font-size: 10px;"></i> ` : ''}${actionMessage.text}</div>`
                        }
                        ${actionMessage.subText 
                            ? `<div style="font-size: 11px; color: #64748b; white-space: nowrap; padding-left: 4px;">${actionMessage.subText}</div>`
                            : ''
                        }
                        ${actionMessage.correctionBadge 
                            ? `<div style="display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; white-space: nowrap; background: ${actionMessage.correctionBadge.color}; color: white; letter-spacing: 0.3px;"><i class="fas ${actionMessage.correctionBadge.icon}" style="font-size: 10px;"></i>${actionMessage.correctionBadge.text}</div>`
                            : ''
                        }
                        ${getIncentiveDeadlineDisplay(app)}
                    </div>
                </td>
                <td>
                    <div style="display: flex; gap: 6px;">
                        <button class="admin-btn admin-btn-primary admin-btn-sm" 
                                onclick="openManageModal('${app.id}')"
                                title="관리">
                            <i class="fas fa-cog"></i> 관리
                        </button>
                        <a href="application-detail.html?id=${app.id}" 
                           class="admin-btn admin-btn-secondary admin-btn-sm"
                           target="_blank"
                           title="학생 화면 보기">
                            <i class="fas fa-eye"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    document.getElementById('tableBody').innerHTML = tableHTML;
    
    // 카운트 업데이트
    document.getElementById('totalCount').textContent = filteredApplications.length;
    document.getElementById('displayCount').textContent = pageApplications.length;
    
    // 페이지네이션 업데이트
    updatePagination();
    
    // 선택 카운트 업데이트
    updateSelectionCount();
    
    // 화면 표시
    document.getElementById('loading').style.display = 'none';
    document.getElementById('applicationsTable').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}

// 페이지네이션 업데이트
function updatePagination() {
    const totalPages = Math.ceil(filteredApplications.length / itemsPerPage);
    if (totalPages <= 1) {
        document.getElementById('pagination').innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    
    // 이전 버튼
    if (currentPage > 1) {
        paginationHTML += `
            <button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${currentPage - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
    }
    
    // 페이지 번호
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            paginationHTML += `
                <button class="admin-btn admin-btn-primary admin-btn-sm">
                    ${i}
                </button>
            `;
        } else if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            paginationHTML += `
                <button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${i})">
                    ${i}
                </button>
            `;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            paginationHTML += `<span style="padding: 8px;">...</span>`;
        }
    }
    
    // 다음 버튼
    if (currentPage < totalPages) {
        paginationHTML += `
            <button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${currentPage + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
    }
    
    document.getElementById('pagination').innerHTML = paginationHTML;
}

// 페이지 변경
function changePage(page) {
    currentPage = page;
    displayApplications();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 선택 토글
function toggleSelection(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    updateSelectionCount();
    displayApplications();
}

// 전체 선택 토글
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageApplications = filteredApplications.slice(startIndex, endIndex);
    
    if (selectAll.checked) {
        pageApplications.forEach(app => selectedIds.add(app.id));
    } else {
        pageApplications.forEach(app => selectedIds.delete(app.id));
    }
    
    updateSelectionCount();
    displayApplications();
}

// 선택 해제
function clearSelection() {
    selectedIds.clear();
    document.getElementById('selectAll').checked = false;
    updateSelectionCount();
    displayApplications();
}

// 선택 카운트 업데이트
function updateSelectionCount() {
    document.getElementById('selectedCount').textContent = selectedIds.size;
    // 선택 수에 따라 버튼 스타일 변경
    const btn = document.getElementById('bulkMenuBtn');
    if (btn) {
        btn.style.background = selectedIds.size > 0 ? '#8b5cf6' : '#475569';
    }
}

// 일괄처리 드롭다운 토글
function toggleBulkMenu() {
    const dropdown = document.getElementById('bulkDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// 드롭다운 외부 클릭 시 닫기
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('bulkDropdown');
    const btn = document.getElementById('bulkMenuBtn');
    if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

// 빠른 승인
async function quickApprove(id) {
    if (!confirm('이 신청서를 승인하시겠습니까?')) return;
    
    try {
        const result = await supabaseAPI.patch('applications', id, { status: '승인' });
        
        if (result) {
            alert('승인되었습니다.');
            loadApplications();
        } else {
            alert('승인 실패했습니다.');
        }
    } catch (error) {
        console.error('Approval error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 빠른 거부
async function quickReject(id) {
    if (!confirm('이 신청서를 거부하시겠습니까?')) return;
    
    try {
        const result = await supabaseAPI.patch('applications', id, { status: '거부' });
        
        if (result) {
            alert('거부되었습니다.');
            loadApplications();
        } else {
            alert('거부 실패했습니다.');
        }
    } catch (error) {
        console.error('Rejection error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 일괄 승인
async function bulkApprove() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }
    
    if (!confirm(`${selectedIds.size}개의 신청서를 일괄 승인하시겠습니까?`)) return;
    
    try {
        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, { status: '승인' })
        );
        
        await Promise.all(promises);
        alert('일괄 승인되었습니다.');
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk approval error:', error);
        alert('일부 신청서 승인에 실패했습니다.');
    }
}

// 일괄 거부
async function bulkReject() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }
    
    if (!confirm(`${selectedIds.size}개의 신청서를 일괄 거부하시겠습니까?`)) return;
    
    try {
        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, { status: '거부' })
        );
        
        await Promise.all(promises);
        alert('일괄 거부되었습니다.');
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk rejection error:', error);
        alert('일부 신청서 거부에 실패했습니다.');
    }
}

// ===== 일괄 계약서 발송 =====
async function showBulkContractModal() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 활성 계약서 목록 불러오기
    try {
        const contracts = await supabaseAPI.query('contracts', { 'is_active': 'eq.true', 'limit': '100' });
        
        if (!contracts || contracts.length === 0) {
            alert('활성화된 계약서가 없습니다.\n\n계약서 관리에서 먼저 계약서를 등록해주세요.');
            return;
        }

        // 선택 모달 생성
        const options = contracts.map(c => `<option value="${c.id}">${c.version} - ${c.title}</option>`).join('');
        
        const modal = document.createElement('div');
        modal.id = 'bulkContractModal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;';
        modal.innerHTML = `
            <div style="background:white; border-radius:12px; padding:32px; max-width:450px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 8px 0; font-size:18px;">📋 일괄 계약서 발송</h3>
                <p style="margin:0 0 20px 0; color:#64748b; font-size:14px;">${selectedIds.size}명에게 계약서를 발송합니다.</p>
                <select id="bulkContractSelect" style="width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; margin-bottom:20px;">
                    <option value="">계약서를 선택하세요...</option>
                    ${options}
                </select>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button onclick="document.getElementById('bulkContractModal').remove()" style="padding:10px 20px; border:1px solid #d1d5db; background:white; border-radius:8px; cursor:pointer; font-size:14px;">취소</button>
                    <button onclick="executeBulkContract()" style="padding:10px 20px; background:#8b5cf6; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; font-weight:600;">발송하기</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (error) {
        console.error('Load contracts error:', error);
        alert('계약서 목록을 불러오는데 실패했습니다.');
    }
}

async function executeBulkContract() {
    const selectId = document.getElementById('bulkContractSelect').value;
    if (!selectId) {
        alert('계약서를 선택해주세요.');
        return;
    }

    try {
        const contract = await supabaseAPI.getById('contracts', selectId);
        if (!contract) {
            alert('계약서를 찾을 수 없습니다.');
            return;
        }

        if (!confirm(`${selectedIds.size}명에게 "${contract.version} - ${contract.title}" 계약서를 발송하시겠습니까?`)) return;

        const updateData = {
            contract_sent: true,
            contract_sent_at: Date.now(),
            contract_template_id: contract.id,
            contract_version: contract.version,
            contract_title: contract.title,
            contract_snapshot: contract.content,
            current_step: 3
        };

        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, updateData)
        );

        await Promise.all(promises);
        document.getElementById('bulkContractModal').remove();
        alert(`✅ ${selectedIds.size}명에게 계약서가 발송되었습니다!`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk contract error:', error);
        alert('일부 계약서 발송에 실패했습니다.');
    }
}

// ===== 일괄 입금확인 =====
async function bulkConfirmDeposit() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    if (!confirm(`${selectedIds.size}명의 입금을 확인 처리하시겠습니까?\n\n각 학생의 최종 입금금액(final_price)으로 자동 처리됩니다.`)) return;

    try {
        const alimTalkItems = [];

        const promises = Array.from(selectedIds).map(async (id) => {
            const updatedApp = await supabaseAPI.patch('applications', id, {
                deposit_confirmed_by_admin: true,
                deposit_confirmed_by_admin_at: Date.now(),
                current_step: 5
            });
            // 알림톡 일괄 발송용 데이터 수집
            const app = updatedApp || allApplications.find(a => a.id === id);
            if (app && app.phone) {
                alimTalkItems.push({
                    type: 'payment_confirmed',
                    data: { name: app.name, phone: app.phone, app_id: app.id }
                });
            }
        });

        await Promise.all(promises);

        // 알림톡 일괄 발송
        if (alimTalkItems.length > 0) {
            try {
                await sendKakaoAlimTalkBulk(alimTalkItems);
            } catch (e) { console.warn('일괄 입금확인 알림톡 발송 실패:', e); }
        }

        alert(`✅ ${selectedIds.size}명의 입금이 확인되었습니다!`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk deposit confirm error:', error);
        alert('일부 입금확인에 실패했습니다.');
    }
}

// ===== 일괄 이용방법 전달 =====
async function bulkSendGuide() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    if (!confirm(`${selectedIds.size}명에게 이용방법을 전달하시겠습니까?\n\n학생들의 "이용방법" 탭이 활성화됩니다.`)) return;

    try {
        const updateData = {
            guide_sent: true,
            guide_sent_at: Date.now()
        };

        const alimTalkItems = [];

        const promises = Array.from(selectedIds).map(async (id) => {
            const updatedApp = await supabaseAPI.patch('applications', id, updateData);
            // 알림톡 일괄 발송용 데이터 수집
            const app = updatedApp || allApplications.find(a => a.id === id);
            if (app && app.phone) {
                alimTalkItems.push({
                    type: 'guide_uploaded',
                    data: {
                        name: app.name,
                        phone: app.phone,
                        program: app.assigned_program || '',
                        start_date: app.schedule_start || '',
                        app_id: app.id
                    }
                });
            }
        });

        await Promise.all(promises);

        // 알림톡 일괄 발송
        if (alimTalkItems.length > 0) {
            try {
                await sendKakaoAlimTalkBulk(alimTalkItems);
            } catch (e) { console.warn('일괄 이용방법 알림톡 발송 실패:', e); }
        }

        alert(`✅ ${selectedIds.size}명에게 이용방법이 전달되었습니다!`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk guide send error:', error);
        alert('일부 이용방법 전달에 실패했습니다.');
    }
}

// ===== 일괄 프로모션 뱃지 ON/OFF =====
// turnOn: true → 프로모션 ON, false → 프로모션 OFF
// 처리 대상: 챌린지 신청자 + 학생 동의 전(student_agreed_at 없음)
// 자동 제외: 입문서 신청(application_type === 'book_only'), 학생 동의 완료
async function bulkSetIncentive(turnOn) {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 드롭다운 닫기
    const dropdown = document.getElementById('bulkDropdown');
    if (dropdown) dropdown.style.display = 'none';

    // 선택된 신청서 분류
    const selectedApps = allApplications.filter(a => selectedIds.has(a.id));
    const bookOnlyApps = selectedApps.filter(a => a.application_type === 'book_only');
    const agreedApps = selectedApps.filter(a => a.application_type !== 'book_only' && a.student_agreed_at);
    const targetApps = selectedApps.filter(a => a.application_type !== 'book_only' && !a.student_agreed_at);

    // 변경이 실제로 필요한 대상만 추림 (이미 원하는 상태면 스킵)
    const needChangeApps = targetApps.filter(a => Boolean(a.is_incentive_applicant) !== Boolean(turnOn));
    const noChangeApps = targetApps.filter(a => Boolean(a.is_incentive_applicant) === Boolean(turnOn));

    // 처리 가능한 대상이 0명이면 사유 안내 후 종료
    if (needChangeApps.length === 0) {
        let msg = '⚠️ 처리할 신청서가 없습니다.\n\n';
        msg += `선택: ${selectedApps.length}명\n`;
        if (bookOnlyApps.length > 0) msg += `• 입문서 신청 제외: ${bookOnlyApps.length}명\n`;
        if (agreedApps.length > 0) msg += `• 학생 동의 완료 제외: ${agreedApps.length}명\n`;
        if (noChangeApps.length > 0) msg += `• 이미 ${turnOn ? 'ON' : 'OFF'} 상태: ${noChangeApps.length}명`;
        alert(msg);
        return;
    }

    // 확인창 메시지 구성
    let confirmMsg;
    if (turnOn) {
        confirmMsg = `선택한 ${selectedApps.length}명 중 ${needChangeApps.length}명을 프로모션 유도 학생으로 변경합니다.\n\n`;
        confirmMsg += `처리 대상: ${needChangeApps.length}명 (동의 전인 챌린지 신청자)\n`;
        const skipParts = [];
        if (bookOnlyApps.length > 0) skipParts.push(`입문서 신청 ${bookOnlyApps.length}명`);
        if (agreedApps.length > 0) skipParts.push(`동의 완료 ${agreedApps.length}명`);
        if (noChangeApps.length > 0) skipParts.push(`이미 ON ${noChangeApps.length}명`);
        if (skipParts.length > 0) confirmMsg += `제외: ${skipParts.join(' / ')}\n`;
        confirmMsg += `\n변경 후 적용되는 사항:\n`;
        confirmMsg += `• 학생 동의 데드라인: 24시간 → 5일\n`;
        confirmMsg += `• 입문서 탭에 노출됨\n`;
        confirmMsg += `• 이름 옆 "프로모션" 뱃지 표시\n`;
        confirmMsg += `• (이후 분석 저장 시) 프로모션 학생 전용 알림톡(개별분석 & 입문서 전송 완료 안내) 자동 발송\n\n`;
        confirmMsg += `진행하시겠습니까?`;
    } else {
        confirmMsg = `선택한 ${selectedApps.length}명 중 ${needChangeApps.length}명의 프로모션 유도 학생 지정을 해제합니다.\n\n`;
        confirmMsg += `처리 대상: ${needChangeApps.length}명 (동의 전인 챌린지 신청자)\n`;
        const skipParts = [];
        if (bookOnlyApps.length > 0) skipParts.push(`입문서 신청 ${bookOnlyApps.length}명`);
        if (agreedApps.length > 0) skipParts.push(`동의 완료 ${agreedApps.length}명`);
        if (noChangeApps.length > 0) skipParts.push(`이미 OFF ${noChangeApps.length}명`);
        if (skipParts.length > 0) confirmMsg += `제외: ${skipParts.join(' / ')}\n`;
        confirmMsg += `\n변경 후 적용되는 사항:\n`;
        confirmMsg += `• 학생 동의 데드라인: 5일 → 24시간\n`;
        confirmMsg += `• 입문서 탭에서 제외됨\n`;
        confirmMsg += `• "프로모션" 뱃지 제거\n\n`;
        confirmMsg += `⚠️ 이미 분석이 저장된 학생은 분석 저장 시점부터 24시간 기준으로 재계산되어\n`;
        confirmMsg += `   이미 24시간이 지났다면 즉시 만료 상태가 됩니다.\n\n`;
        confirmMsg += `진행하시겠습니까?`;
    }

    if (!confirm(confirmMsg)) return;

    try {
        const promises = needChangeApps.map(a =>
            supabaseAPI.patch('applications', a.id, { is_incentive_applicant: turnOn })
        );

        await Promise.all(promises);

        // 결과 알림
        let resultMsg = `✅ ${needChangeApps.length}명 프로모션 ${turnOn ? 'ON' : 'OFF'} 처리 완료`;
        const skipTotal = bookOnlyApps.length + agreedApps.length + noChangeApps.length;
        if (skipTotal > 0) {
            const skipParts = [];
            if (bookOnlyApps.length > 0) skipParts.push(`입문서 신청 ${bookOnlyApps.length}명`);
            if (agreedApps.length > 0) skipParts.push(`동의 완료 ${agreedApps.length}명`);
            if (noChangeApps.length > 0) skipParts.push(`이미 ${turnOn ? 'ON' : 'OFF'} ${noChangeApps.length}명`);
            resultMsg += `\n⏭️ ${skipTotal}명 제외 (${skipParts.join(' / ')})`;
        }
        alert(resultMsg);

        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk set incentive error:', error);
        alert('일부 프로모션 설정 변경에 실패했습니다.');
    }
}

// ===== 일괄 삭제 처리 (Soft Delete) =====
async function bulkSoftDelete() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 드롭다운 닫기
    const dropdown = document.getElementById('bulkDropdown');
    if (dropdown) dropdown.style.display = 'none';

    const selectedApps = allApplications.filter(a => selectedIds.has(a.id));
    const alreadyDeleted = selectedApps.filter(a => a.deleted === true || a.deleted === 'true');
    const targetApps = selectedApps.filter(a => a.deleted !== true && a.deleted !== 'true');

    if (targetApps.length === 0) {
        alert(`⚠️ 처리할 신청서가 없습니다.\n\n선택: ${selectedApps.length}건\n• 이미 삭제 처리됨: ${alreadyDeleted.length}건`);
        return;
    }

    const nameList = targetApps.map(a => `  • ${a.name || '(이름없음)'} (${a.email || '-'})`).join('\n');
    let confirmMsg = `🗑 ${targetApps.length}건의 신청서를 삭제 처리하시겠습니까?\n\n`;
    confirmMsg += `대상:\n${nameList}\n\n`;
    if (alreadyDeleted.length > 0) {
        confirmMsg += `⏭️ 이미 삭제됨 ${alreadyDeleted.length}건 제외\n\n`;
    }
    confirmMsg += `• DB에 기록은 보존됩니다\n`;
    confirmMsg += `• 학생에게는 표시되지 않습니다\n`;
    confirmMsg += `• 관리자 목록에서 "삭제됨" 뱃지로 표시됩니다`;

    if (!confirm(confirmMsg)) return;

    try {
        const promises = targetApps.map(a =>
            supabaseAPI.delete('applications', a.id)
        );
        await Promise.all(promises);

        alert(`✅ ${targetApps.length}건 삭제 처리 완료`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk soft delete error:', error);
        alert('일부 삭제 처리에 실패했습니다.');
    }
}

// ===== 일괄 완전 삭제 (Hard Delete - DB 제거) =====
async function bulkHardDelete() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 드롭다운 닫기
    const dropdown = document.getElementById('bulkDropdown');
    if (dropdown) dropdown.style.display = 'none';

    const selectedApps = allApplications.filter(a => selectedIds.has(a.id));
    const nameList = selectedApps.map(a => `  • ${a.name || '(이름없음)'} (${a.email || '-'})`).join('\n');

    // 1차 확인
    let confirmMsg = `⚠️ ${selectedApps.length}건의 신청서를 DB에서 완전히 삭제하시겠습니까?\n\n`;
    confirmMsg += `대상:\n${nameList}\n\n`;
    confirmMsg += `❌ 이 작업은 되돌릴 수 없습니다\n`;
    confirmMsg += `❌ DB에서 완전히 제거되어 기록이 남지 않습니다`;

    if (!confirm(confirmMsg)) return;

    // 2차 확인 (이중 안전장치)
    if (!confirm(`정말로 ${selectedApps.length}건을 완전 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const promises = selectedApps.map(a =>
            supabaseAPI.hardDelete('applications', a.id)
        );
        await Promise.all(promises);

        alert(`✅ ${selectedApps.length}건 완전 삭제 완료\n\nDB에서 영구적으로 제거되었습니다.`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk hard delete error:', error);
        alert('일부 완전 삭제에 실패했습니다.');
    }
}

// ===== 택배송장출력 (선택된 학생) =====
async function bulkExportShipping() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 드롭다운 닫기
    const dropdown = document.getElementById('bulkDropdown');
    if (dropdown) dropdown.style.display = 'none';

    try {
        const ids = Array.from(selectedIds);
        const apps = [];
        for (const id of ids) {
            const app = await supabaseAPI.getById('applications', id);
            if (app) apps.push(app);
        }

        if (apps.length === 0) {
            alert('선택된 신청서 정보를 불러올 수 없습니다.');
            return;
        }

        // 엑셀 데이터 생성 (지정된 컬럼 형식)
        const shippingData = apps.map(app => ({
            '받는분성명': app.name || '',
            '받는분전화번호': app.phone || '',
            '받는분기타연락처': '',
            '받는분주소(전체, 분할)': app.address || '',
            '품목명': '이온토플',
            '기본운임': '',
            '운임구분': '신용',
            '박스타입': '극소',
            '배송메세지1': ''
        }));

        const ws = XLSX.utils.json_to_sheet(shippingData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '택배송장');

        // 컬럼 너비 설정
        ws['!cols'] = [
            { wch: 12 },  // 받는분성명
            { wch: 15 },  // 받는분전화번호
            { wch: 15 },  // 받는분기타연락처
            { wch: 40 },  // 받는분주소
            { wch: 12 },  // 품목명
            { wch: 10 },  // 기본운임
            { wch: 10 },  // 운임구분
            { wch: 10 },  // 박스타입
            { wch: 20 }   // 배송메세지1
        ];

        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        XLSX.writeFile(wb, `택배송장_${today}_${apps.length}건.xlsx`);
        alert(`✅ ${apps.length}건의 택배송장이 다운로드되었습니다.`);
    } catch (error) {
        console.error('Shipping export error:', error);
        alert('택배송장 출력 중 오류가 발생했습니다.');
    }
}

// 엑셀 다운로드 (탭에 따라 다른 컬럼 구조로 출력)
function downloadExcel() {
    if (filteredApplications.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }

    let excelData;
    let sheetName;
    let fileName;

    if (currentAppTypeTab === 'book_only') {
        // 입문서 탭: 광고 발송용 정리된 형태
        excelData = filteredApplications.map(app => {
            // UTM 데이터 펼치기
            let utm = {};
            if (app.utm_data) {
                try {
                    utm = typeof app.utm_data === 'string' ? JSON.parse(app.utm_data) : app.utm_data;
                } catch (e) { utm = {}; }
            }

            // 유입경로 (기타면 상세 사용)
            let referralSource = app.referral_source || '';
            if (app.referral_source === '기타' && app.referral_source_detail) {
                referralSource = app.referral_source_detail;
            }

            return {
                '이름': app.name || '',
                '이메일': app.email || '',
                '전화번호': app.phone || '',
                '현재점수': app.current_score != null ? app.current_score : (app.no_score ? '없음' : ''),
                '목표점수': app.no_target_score ? '미정' : (app.target_score != null ? app.target_score : ''),
                '유입경로(자가응답)': referralSource,
                '카카오 채널 추가': app.kakao_channel_clicked ? 'O' : 'X',
                '신청일시': formatDate(app.submitted_date || app.created_at),
                'UTM Source': utm.utm_source || '',
                'UTM Medium': utm.utm_medium || '',
                'UTM Campaign': utm.utm_campaign || '',
                'UTM Content': utm.utm_content || '',
                'Referrer': app.referrer_url || '',
                'Landing URL': app.landing_url || '',
                'User Agent': app.user_agent || ''
            };
        });
        sheetName = '입문서 신청자 목록';
        fileName = `이온토플_입문서신청자_${formatDateOnly(Date.now())}.xlsx`;
    } else {
        // 챌린지 / 전체 탭: 기존 형식 유지 (토플 이유는 과거 데이터를 위해 유지)
        excelData = filteredApplications.map(app => ({
            '이름': app.name || '',
            '이메일': app.email || '',
            '전화번호': app.phone || '',
            '주소': app.address || '',
            '직업': app.occupation || '',
            '프로그램': app.preferred_program || '',
            '스라첨삭': app.correction_enabled ? '포함' : '-',
            '수업 시작일': app.preferred_start_date || '',
            '제출 데드라인': app.submission_deadline || '',
            '현재 점수': app.total_score || '',
            '목표 점수': app.target_cutoff_old || app.target_cutoff_new || '',
            '토플 필요 이유': app.toefl_reason || '',
            '상태': app.status || '접수완료',
            '신청일': formatDate(app.created_at),
            '관리자 코멘트': app.admin_comment || ''
        }));
        sheetName = '신청서 목록';
        fileName = `이온토플_신청서_${formatDateOnly(Date.now())}.xlsx`;
    }

    // 워크시트 생성
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // 파일 다운로드
    XLSX.writeFile(wb, fileName);
}

// ===== 운송장 일괄등록 =====
let trackingMatchResults = []; // 매칭 결과 저장

function openTrackingUploadModal() {
    const modal = document.getElementById('trackingUploadModal');
    modal.style.display = 'flex';
    resetTrackingUpload();
}

function closeTrackingUploadModal() {
    document.getElementById('trackingUploadModal').style.display = 'none';
    resetTrackingUpload();
}

function resetTrackingUpload() {
    document.getElementById('trackingUploadArea').style.display = 'block';
    document.getElementById('trackingPreview').style.display = 'none';
    document.getElementById('trackingFileInput').value = '';
    trackingMatchResults = [];
}

// 드래그 앤 드롭 설정
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('trackingDropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#0ea5e9';
        dropZone.style.background = '#f0f9ff';
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#cbd5e1';
        dropZone.style.background = 'transparent';
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#cbd5e1';
        dropZone.style.background = 'transparent';
        const file = e.dataTransfer.files[0];
        if (file) handleTrackingFile(file);
    });
});

// 엑셀 파일 파싱
function handleTrackingFile(file) {
    if (!file) return;
    if (!file.name.match(/\.xlsx?$/i)) {
        alert('엑셀 파일(.xlsx)만 업로드 가능합니다.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (rows.length === 0) {
                alert('엑셀 파일에 데이터가 없습니다.');
                return;
            }

            matchTrackingData(rows);
        } catch (err) {
            console.error('엑셀 파싱 에러:', err);
            alert('엑셀 파일을 읽을 수 없습니다. 파일 형식을 확인해주세요.');
        }
    };
    reader.readAsArrayBuffer(file);
}

// 이름 + 전화번호 중간4자리로 매칭
function matchTrackingData(rows) {
    trackingMatchResults = [];

    // 엑셀 컬럼명 자동 감지 (받는분, 전화번호, 운송장번호)
    // 엑셀에 "받는분" 컬럼이 2개 있을 수 있으므로 (보내는/받는) 뒤쪽 것을 사용
    const sampleRow = rows[0];
    const keys = Object.keys(sampleRow);

    // "받는분" 키 찾기 - 뒤쪽에 있는 것
    let recipientKey = null;
    let recipientPhoneKey = null;
    let trackingKey = null;

    // 키 이름으로 직접 매칭
    for (const key of keys) {
        if (key === '운송장번호') trackingKey = key;
    }

    // "받는분" 과 그 바로 다음 "전화번호" 찾기
    // 엑셀에서 동일한 컬럼명이 있으면 뒤의 것은 "_1" 등이 붙음
    for (let i = keys.length - 1; i >= 0; i--) {
        if (!recipientKey && (keys[i] === '받는분' || keys[i].match(/^받는분/))) {
            recipientKey = keys[i];
            // 바로 다음 키가 전화번호인지 확인
            if (i + 1 < keys.length && keys[i + 1].match(/전화번호/)) {
                recipientPhoneKey = keys[i + 1];
            }
        }
    }

    // 전화번호 키가 여러 개일 수 있음 - 뒤쪽 것 사용
    if (!recipientPhoneKey) {
        for (let i = keys.length - 1; i >= 0; i--) {
            if (keys[i].match(/전화번호/)) {
                recipientPhoneKey = keys[i];
                break;
            }
        }
    }

    if (!recipientKey || !trackingKey) {
        alert(`엑셀에서 필수 컬럼을 찾을 수 없습니다.\n필요: 받는분, 운송장번호\n발견된 컬럼: ${keys.join(', ')}`);
        return;
    }

    console.log('=== 운송장 매칭 디버그 ===');
    console.log('엑셀 컬럼:', keys);
    console.log('받는분 키:', recipientKey, '/ 전화번호 키:', recipientPhoneKey, '/ 운송장 키:', trackingKey);
    console.log('첫 행 샘플:', JSON.stringify(rows[0]));
    console.log('DB 신청서 수:', allApplications.length);

    // 각 행 매칭
    rows.forEach(row => {
        const name = String(row[recipientKey] || '').trim();
        const phone = String(row[recipientPhoneKey] || '').trim();
        const tracking = String(row[trackingKey] || '').trim();

        if (!name || !tracking) return; // 빈 행 스킵

        // 전화번호에서 중간 4자리 추출 (010-XXXX-****)
        const phoneMid = extractPhoneMid(phone);

        // DB에서 매칭 (allApplications 사용, 삭제된 신청서 제외)
        // 운송장은 내벨업챌린지(challenge) 신청자에게만 발송되므로
        // 입문서(book_only) 등 다른 신청서는 매칭 대상에서 제외
        const matched = allApplications.filter(app => {
            if (app.deleted) return false;
            if (app.application_type !== 'challenge') return false;
            if (app.name !== name) return false;
            if (phoneMid && app.phone) {
                const appPhoneMid = extractPhoneMid(app.phone);
                return appPhoneMid === phoneMid;
            }
            return true; // 전화번호 없으면 이름만으로 매칭
        });

        if (matched.length === 1) {
            // 이미 운송장이 등록된 경우 체크
            if (matched[0].shipping_tracking_number) {
                trackingMatchResults.push({
                    name, phone, tracking,
                    status: 'skip',
                    message: `이미 등록됨 (${matched[0].shipping_tracking_number})`,
                    appId: null
                });
            } else {
                trackingMatchResults.push({
                    name, phone, tracking,
                    status: 'matched',
                    message: matched[0].email,
                    appId: matched[0].id
                });
            }
        } else if (matched.length > 1) {
            trackingMatchResults.push({
                name, phone, tracking,
                status: 'fail',
                message: `동명이인 ${matched.length}명 (전화번호로 구별 불가)`,
                appId: null
            });
        } else {
            trackingMatchResults.push({
                name, phone, tracking,
                status: 'fail',
                message: '신청서를 찾을 수 없음',
                appId: null
            });
        }
    });

    renderTrackingPreview();
}

// 전화번호 중간 4자리 추출
function extractPhoneMid(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/[^0-9]/g, '');
    // 010XXXXXXXX (11자리) → 중간 4자리 = [3..7]
    if (cleaned.length >= 7) {
        return cleaned.substring(3, 7);
    }
    return '';
}

// 매칭 미리보기 렌더링
function renderTrackingPreview() {
    document.getElementById('trackingUploadArea').style.display = 'none';
    document.getElementById('trackingPreview').style.display = 'block';

    const matchCount = trackingMatchResults.filter(r => r.status === 'matched').length;
    const failCount = trackingMatchResults.filter(r => r.status === 'fail').length;
    const skipCount = trackingMatchResults.filter(r => r.status === 'skip').length;

    document.getElementById('trackingMatchCount').textContent = `✅ 매칭 성공: ${matchCount}건`;
    document.getElementById('trackingFailCount').textContent = 
        (failCount > 0 ? `❌ 실패: ${failCount}건` : '') +
        (skipCount > 0 ? ` ⏭️ 이미등록: ${skipCount}건` : '');

    const tbody = document.getElementById('trackingPreviewBody');
    tbody.innerHTML = trackingMatchResults.map(r => {
        const statusIcon = r.status === 'matched' ? '✅' : r.status === 'skip' ? '⏭️' : '❌';
        const rowColor = r.status === 'matched' ? '' : r.status === 'skip' ? 'background:#f8fafc;' : 'background:#fef2f2;';
        return `<tr style="${rowColor}">
            <td style="padding:8px 12px;">${statusIcon}</td>
            <td style="padding:8px 12px;">${escapeHtml(r.name)}</td>
            <td style="padding:8px 12px;">${escapeHtml(r.phone)}</td>
            <td style="padding:8px 12px; font-family:monospace; font-size:12px;">${escapeHtml(r.tracking)}</td>
            <td style="padding:8px 12px; font-size:12px; color:#64748b;">${escapeHtml(r.message)}</td>
        </tr>`;
    }).join('');

    // 매칭 성공 건이 없으면 등록 버튼 비활성화
    const submitBtn = document.getElementById('trackingSubmitBtn');
    if (matchCount === 0) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
    }
}

// 일괄 등록 실행
async function submitTrackingBulk() {
    const toUpdate = trackingMatchResults.filter(r => r.status === 'matched');
    if (toUpdate.length === 0) {
        alert('등록할 건이 없습니다.');
        return;
    }

    if (!confirm(`매칭된 ${toUpdate.length}건의 운송장번호를 등록하고 발송완료 처리하시겠습니까?`)) {
        return;
    }

    const submitBtn = document.getElementById('trackingSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';

    let successCount = 0;
    const failedItems = [];

    const alimTalkItems = [];

    for (const item of toUpdate) {
        try {
            await supabaseAPI.patch('applications', item.appId, {
                shipping_tracking_number: item.tracking,
                shipping_courier: 'CJ대한통운',
                shipping_completed: true,
                shipping_completed_at: Date.now()
            });
            successCount++;
            // 알림톡 일괄 발송용 데이터 수집
            const app = allApplications.find(a => a.id === item.appId);
            if (app && app.phone) {
                alimTalkItems.push({
                    type: 'shipping_sent',
                    data: {
                        name: app.name || item.name,
                        phone: app.phone,
                        courier: 'CJ대한통운',
                        tracking_number: item.tracking,
                        app_id: app.id
                    }
                });
            }
        } catch (err) {
            console.error(`운송장 등록 실패: ${item.name}`, err);
            failedItems.push(item.name);
        }
    }

    // 알림톡 일괄 발송
    if (alimTalkItems.length > 0) {
        try {
            await sendKakaoAlimTalkBulk(alimTalkItems);
        } catch (e) { console.warn('운송장 일괄등록 알림톡 발송 실패:', e); }
    }

    // 결과 알림
    let message = `✅ ${successCount}건 운송장 등록 및 발송완료 처리되었습니다.`;

    const skipped = trackingMatchResults.filter(r => r.status === 'fail');
    const alreadyDone = trackingMatchResults.filter(r => r.status === 'skip');

    if (failedItems.length > 0) {
        message += `\n\n❌ 등록 실패 ${failedItems.length}건:\n${failedItems.join(', ')}\n(발송완료 처리도 되지 않았습니다)`;
    }
    if (skipped.length > 0) {
        message += `\n\n⚠️ 매칭 실패로 스킵된 ${skipped.length}건:\n${skipped.map(s => `${s.name} - ${s.message}`).join('\n')}`;
    }
    if (alreadyDone.length > 0) {
        message += `\n\n⏭️ 이미 등록된 ${alreadyDone.length}건:\n${alreadyDone.map(s => s.name).join(', ')}`;
    }

    alert(message);
    closeTrackingUploadModal();

    // 테이블 새로고침
    await loadApplications();
}

// =====================================================
// 입문서 신청자 전용 목록 표시 (Phase 3-A)
// =====================================================

function displayBookApplications() {
    if (filteredApplications.length === 0) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('applicationsTable').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }
    
    // 페이지네이션 계산
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageApplications = filteredApplications.slice(startIndex, endIndex);
    
    // 입문서 테이블 생성
    const tableHTML = pageApplications.map(app => {
        const isSelected = selectedIds.has(app.id);
        const userId = app.user_id;
        const isIncentive = app.is_incentive_applicant && app.application_type !== 'book_only';
        
        // 진도 데이터
        const prog = bookProgressCache[userId];
        const maxPage = prog?.max_page_reached || 0;
        const isCompleted = prog?.is_completed || false;
        const totalPages = 366;
        const progressPercent = totalPages > 0 ? Math.round((maxPage / totalPages) * 100) : 0;
        
        // 메모 수
        const memoCount = bookMemoCountCache[userId] || 0;
        
        // 현재 점수 표시
        const scoreDisplay = app.current_score != null ? app.current_score : '<span style="color:#94a3b8;">없음</span>';

        // 목표 점수 표시 (no_target_score 체크 또는 빈값)
        let targetScoreDisplay;
        if (app.no_target_score) {
            targetScoreDisplay = '<span style="color:#94a3b8;">미정</span>';
        } else if (app.target_score != null) {
            targetScoreDisplay = app.target_score;
        } else {
            targetScoreDisplay = '<span style="color:#94a3b8;">-</span>';
        }

        // 유입 경로
        let sourceDisplay = app.referral_source || '-';
        if (app.referral_source === '기타' && app.referral_source_detail) {
            sourceDisplay = app.referral_source_detail;
        }

        // 유입경로 상세 정보 (referrer / UTM / landing) - 툴팁용
        const referrerInfoParts = [];
        if (app.referrer_url) referrerInfoParts.push(`직전: ${app.referrer_url}`);
        if (app.landing_url) referrerInfoParts.push(`진입: ${app.landing_url}`);
        if (app.utm_data) {
            try {
                const utm = typeof app.utm_data === 'string' ? JSON.parse(app.utm_data) : app.utm_data;
                const utmStr = Object.entries(utm || {}).map(([k, v]) => `${k}=${v}`).join(', ');
                if (utmStr) referrerInfoParts.push(`UTM: ${utmStr}`);
            } catch (e) { /* ignore */ }
        }
        const hasReferrerInfo = referrerInfoParts.length > 0;
        const referrerTooltip = hasReferrerInfo ? referrerInfoParts.join('\n') : '';

        // 카카오 채널 추가 클릭 여부 표시 (이름 옆)
        const kakaoIcon = app.kakao_channel_clicked
            ? '<i class="fas fa-comment" style="color:#FEE500; margin-left:4px;" title="카카오 채널 추가 클릭함"></i>'
            : '';

        // 신청일시 (YYYY-MM-DD HH:mm 24시간제)
        const submittedDate = formatDate(app.submitted_date || app.created_at);
        
        // 진도 바 색상
        const progressColor = isCompleted ? '#22c55e' : '#9480c5';
        
        // 뱃지: 유도학생 3단계 vs 순수 입문서 (getIncentiveBookBadge가 알아서 판별)
        const badgeHtml = getIncentiveBookBadge(app);
        
        return `
            <tr style="${isSelected ? 'background: #f0f9ff;' : ''}">
                <td>
                    <input type="checkbox" 
                           class="app-checkbox" 
                           data-id="${app.id}" 
                           ${isSelected ? 'checked' : ''}
                           onchange="toggleSelection('${app.id}')">
                </td>
                <td style="font-weight: 600;">
                    ${escapeHtml(app.name)}${kakaoIcon}
                    ${badgeHtml}
                </td>
                <td style="font-size: 13px;">${escapeHtml(app.email)}</td>
                <td style="font-size: 13px;">${escapeHtml(app.phone || '-')}</td>
                <td style="font-size: 13px; font-weight: 600;">${scoreDisplay}</td>
                <td style="font-size: 13px; font-weight: 600; color:#7c3aed;">${targetScoreDisplay}</td>
                <td style="font-size: 12px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(sourceDisplay)}">
                    ${escapeHtml(sourceDisplay)}
                    ${hasReferrerInfo ? `<i class="fas fa-info-circle" style="color:#9480c5; margin-left:4px; cursor:help;" title="${escapeHtml(referrerTooltip)}"></i>` : ''}
                </td>
                <td style="font-size: 12px; color: #64748b; white-space:nowrap;">${submittedDate}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:6px; min-width:100px;">
                        <div style="flex:1; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                            <div style="width:${progressPercent}%; height:100%; background:${progressColor}; border-radius:3px;"></div>
                        </div>
                        <span style="font-size:11px; color:#64748b; white-space:nowrap;">${maxPage}/${totalPages}</span>
                    </div>
                </td>
                <td style="font-size: 13px; text-align: center; font-weight: 600; color: #f59e0b;">${memoCount}</td>
                <td style="text-align: center;">
                    ${isCompleted 
                        ? '<span style="background:#dcfce7; color:#16a34a; padding:3px 8px; border-radius:10px; font-size:11px; font-weight:600;">완독 ✅</span>'
                        : '<span style="color:#94a3b8; font-size:12px;">-</span>'
                    }
                </td>
                <td>
                    ${isIncentive ? `
                        <button class="admin-btn admin-btn-primary admin-btn-sm" 
                                onclick="openManageModal('${app.id}')"
                                title="신청서 관리">
                            <i class="fas fa-cog"></i> 관리
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
    
    document.getElementById('bookTableBody').innerHTML = tableHTML;
    
    // 카운트 업데이트
    document.getElementById('totalCount').textContent = filteredApplications.length;
    document.getElementById('displayCount').textContent = pageApplications.length;
    
    // 페이지네이션 업데이트
    updatePagination();
    
    // 선택 카운트 업데이트
    updateSelectionCount();
    
    // 화면 표시
    document.getElementById('loading').style.display = 'none';
    document.getElementById('applicationsTable').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}
