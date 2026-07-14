// Application Detail Page
let currentApplication = null;
let globalApplication = null; // Phase 2: 글로벌 변수
let _studentInfo = { name: '', phone: '', id: '' }; // 알림톡용 학생 기본정보 (변하지 않음)

// ===== 신청서 삭제 (상세 페이지용) =====
function openDetailDeleteModal() {
    document.getElementById('detailDeleteModal').style.display = 'block';
}

function closeDetailDeleteModal() {
    document.getElementById('detailDeleteModal').style.display = 'none';
}

async function confirmDetailDelete() {
    if (!currentApplication) return;
    
    const btn = document.getElementById('confirmDetailDeleteBtn');
    btn.textContent = '삭제 중...';
    btn.disabled = true;
    
    try {
        await supabaseAPI.delete('applications', currentApplication.id);
        alert('신청서가 삭제되었습니다.');
        window.location.href = 'application.html';
    } catch (error) {
        console.error('Delete failed:', error);
        alert('삭제 중 오류가 발생했습니다.');
        btn.textContent = '삭제하기';
        btn.disabled = false;
    }
}

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
            
            // 삭제된 신청서 차단 (관리자는 열람 가능)
            if (app.deleted === true && !isAdmin()) {
                loading.style.display = 'none';
                errorMessage.style.display = 'block';
                document.getElementById('errorDetail').textContent = '삭제된 신청서입니다.';
                return;
            }
            
            // 접근 권한 체크
            const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
            
            // 비로그인 상태
            if (!userData) {
                alert('⚠️ 로그인이 필요합니다.\n\n신청서를 확인하려면 로그인해주세요.');
                // 로그인 후 원래 페이지로 복귀할 수 있도록 redirect 파라미터 전달
                // (pathname + search + hash 보존: ex. /application-detail.html?id=XXX#step2)
                const currentUrl = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
                window.location.href = `login.html?redirect=${currentUrl}`;
                return;
            }
            
            // 본인 신청서가 아닌 경우 (관리자 제외)
            if (!hasAccess(app)) {
                alert('🔒 접근 권한이 없습니다.\n\n본인이 작성한 신청서만 확인할 수 있습니다.');
                window.location.href = 'my-application.html';
                return;
            }
            
            // 입문서 무료신청(book_only)은 내벨업챌린지 전용 5단계 흐름과 맞지 않음.
            // 학생에게는 안내 화면 + 대시보드 버튼만 노출하고 종료 (관리자는 정상 열람).
            if (app.application_type === 'book_only' && !isAdmin()) {
                showBookOnlyGuard();
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

// 입문서 무료신청자가 이 페이지에 들어왔을 때 보여줄 안내 화면.
// (5단계 챌린지 흐름은 입문서와 무관하므로 막다른 길 대신 대시보드로 안내)
function showBookOnlyGuard() {
    document.getElementById('detailLoading').style.display = 'none';
    document.getElementById('detailCard').style.display = 'none';
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.innerHTML = `
        <i class="fas fa-book-open" style="font-size: 64px; color: #9480c5; margin-bottom: 20px;"></i>
        <p style="font-size: 18px; color: #1e293b; font-weight: 700; margin-bottom: 8px;">이 페이지는 내벨업챌린지 신청자 전용입니다</p>
        <p style="font-size: 14px; color: #64748b; margin-bottom: 32px; line-height: 1.7;">
            입문서 무료신청은 신청과 동시에 바로 열람할 수 있어요.<br>
            아래 버튼을 눌러 마이페이지에서 입문서를 확인해보세요.
        </p>
        <a href="my-dashboard.html" class="program-button" style="display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; font-size: 15px; font-weight: 700; text-decoration: none;">
            <i class="fas fa-book-reader"></i> 입문서 보러 가기
        </a>
    `;
    errorMessage.style.display = 'block';
}

function displayApplicationDetail(app) {
    console.log('displayApplicationDetail called with:', app);
    
    // 상태 판단 로직
    let statusText = '';
    let statusClass = '';
    let statusIcon = '';
    
    if (app.analysis_content && !app.analysis_status) {
        // AI 자동 분석 생성 완료, 관리자 검토 대기
        statusText = '검토중';
        statusClass = 'status-reviewing';
        statusIcon = 'fa-robot';
    } else if (!app.analysis_status || !app.analysis_content) {
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

    // 상태 이름만으로는 "그래서 내가 뭘 기다려야 하나"를 알 수 없다. 한 줄로 답해준다.
    // 승인 이후에는 실제 진행 위치(동의 → 계약 → 입금 → 시작)에 따라 안내가 달라진다.
    let statusHint = '';
    if (statusText === '검토중') {
        statusHint = '이온쌤이 분석 내용을 검토하고 있어요.';
    } else if (statusText === '승인 검토중') {
        statusHint = '이온쌤이 신청서를 살펴보고 있어요. 조금만 기다려 주세요.';
    } else if (statusText === '조건부승인') {
        statusHint = '함께 이야기 나눌 부분이 있어요. STEP 2에서 확인해 주세요.';
    } else if (statusText === '승인불가') {
        statusHint = '이번 기수는 함께하기 어려워요. 자세한 내용은 STEP 2에 있어요.';
    } else if (statusText === '승인') {
        if (!app.student_agreed_at) {
            statusHint = '개별분석이 도착했어요. STEP 2에서 확인하고 동의해 주세요.';
        } else if (!app.contract_sent) {
            statusHint = '계약서를 준비하고 있어요.';
        } else if (!app.contract_agreed) {
            statusHint = '계약서가 도착했어요. STEP 3에서 확인하고 동의해 주세요.';
        } else if (!app.deposit_confirmed_by_student) {
            statusHint = '입금 후 STEP 4에서 완료 버튼을 눌러 주세요.';
        } else if (!app.deposit_confirmed_by_admin) {
            statusHint = '입금을 확인하고 있어요.';
        } else {
            statusHint = '모든 준비가 끝났어요. STEP 5에서 이용 방법을 확인해 주세요.';
        }
    }

    // 상태 배지 + 수정/삭제 버튼 표시 (신청서 상세 제목 오른쪽)
    const hasAnalysisRegistered = app.analysis_status && app.analysis_content;
    const canEdit = isOwner(app) && !hasAnalysisRegistered && !app.deleted;
    
    // 수정·삭제는 신청서(STEP 1)에만 해당하는 동작이라 헤더가 아니라 본문 맨 아래에 둔다.
    // 삭제는 되돌릴 수 없으므로 내용을 다 읽은 뒤에 만나게 한다.
    const applicationActions = canEdit ? `
        <div class="s1-actions">
            <div class="s1-actions-hint">개별분석이 등록되기 전까지 신청서를 고칠 수 있어요.</div>
            <div class="s1-actions-btns">
                <button class="s1-btn s1-btn-edit" onclick="window.location.href='application-form.html?edit=${app.id}'">
                    <i class="fas fa-pen"></i> 수정하기
                </button>
                <button class="s1-btn s1-btn-delete" onclick="openDetailDeleteModal()">
                    <i class="fas fa-trash-alt"></i> 신청서 삭제
                </button>
            </div>
        </div>
    ` : '';

    document.getElementById('detailStatus').innerHTML = `
        <span class="status-badge ${statusClass}">
            <i class="fas ${statusIcon}" style="margin-right: 6px; font-size: 11px;"></i>
            ${statusText}
        </span>
        ${statusHint ? `<span class="detail-header-hint">${statusHint}</span>` : ''}
    `;
    
    console.log('Status badge set');
    
    // 개정후 점수를 .0 형식으로 포맷팅하는 함수
    function formatNewScore(score) {
        if (score === null || score === undefined || score === '') return '-';
        return Number(score).toFixed(1);
    }
    
    
    // Detail content - tabInfo에 표시
    const tabInfoElement = document.getElementById('tabInfo');
    if (!tabInfoElement) {
        console.error('tabInfo element not found!');
        return;
    }
    
    // ── 표시용 준비 ──────────────────────────────────────────
    // 이 화면은 "내가 제출한 신청서"다. 값을 가공하지 않고, 신청 폼에 입력한 순서 그대로 보여준다.
    const hasScore = app.has_toefl_score === 'yes';
    const scoreIsNew = app.score_version === 'new' || !!app.score_total_new || !!app.score_reading_new;
    const targetIsNew = app.target_version === 'new' || !!app.target_cutoff_new || !!app.target_reading_new;

    const fmtCur = (v) => scoreIsNew ? formatNewScore(v) : (v || v === 0 ? String(v) : '-');
    const fmtTgt = (v) => targetIsNew ? formatNewScore(v) : (v || v === 0 ? String(v) : '-');

    const curTotal = scoreIsNew ? (app.score_total_new || app.total_score) : (app.score_total_old || app.total_score);
    const tgtTotal = targetIsNew ? app.target_cutoff_new : (app.target_cutoff_old || app.target_score);

    const curSections = [
        ['Reading',   scoreIsNew ? app.score_reading_new   : app.score_reading_old],
        ['Listening', scoreIsNew ? app.score_listening_new : app.score_listening_old],
        ['Speaking',  scoreIsNew ? app.score_speaking_new  : app.score_speaking_old],
        ['Writing',   scoreIsNew ? app.score_writing_new   : app.score_writing_old]
    ];
    const tgtSections = [
        ['Reading',   targetIsNew ? app.target_reading_new   : app.target_reading_old],
        ['Listening', targetIsNew ? app.target_listening_new : app.target_listening_old],
        ['Speaking',  targetIsNew ? app.target_speaking_new  : app.target_speaking_old],
        ['Writing',   targetIsNew ? app.target_writing_new   : app.target_writing_old]
    ];
    const hasTargetSections = tgtSections.some(([, v]) => v || v === 0);

    const referrals = [
        app.referral_search_keyword ? ['검색 키워드', app.referral_search_keyword] : null,
        app.referral_social_media ? ['SNS', app.referral_social_media] : null,
        (app.referral_friend === 'yes' && app.referral_friend_name) ? ['지인 추천', `${app.referral_friend_name}님`] : null,
        app.referral_other ? ['기타', app.referral_other] : null
    ].filter(Boolean);

    // 기한까지 남은 날짜 뱃지. 오늘 자정과 마감일 자정의 차이로 센다.
    const dDayChip = (dateStr) => {
        if (!dateStr) return '';
        const target = new Date(dateStr);
        if (isNaN(target.getTime())) return '';
        const today = new Date();
        target.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const days = Math.round((target - today) / 86400000);
        let text, bg, color;
        if (days > 0) {
            text = `${days}일 남음`;
            // 2주 안쪽이면 주의를 끈다
            if (days <= 14) { bg = '#fbecd2'; color = '#b45309'; }
            else { bg = '#eef1f5'; color = '#64748b'; }
        } else if (days === 0) {
            text = '오늘';
            bg = '#fbeae6'; color = '#a53b22';
        } else {
            text = `${Math.abs(days)}일 지남`;
            bg = '#f1f5f9'; color = '#94a3b8';
        }
        return `<span class="s1-chip" style="background: ${bg}; color: ${color}; margin-left: 10px;">${text}</span>`;
    };

    tabInfoElement.innerHTML = `
        <style>
            /* 선 대신 카드와 여백으로 구역을 나눈다 (DESIGN.md: No-Line Rule) */
            .s1-card {
                background: #ffffff;
                border-radius: 16px;
                padding: 24px 28px;
                box-shadow: 0 2px 20px rgba(25, 28, 29, 0.05);
                margin-bottom: 14px;
            }
            .s1-card-title {
                font-size: 15px;
                font-weight: 700;
                color: #1e293b;
                letter-spacing: -0.01em;
                margin: 0 0 18px 0;
            }
            /* 학생이 붙인 제목: 표제이므로 다른 카드와 다르게 보여야 한다.
               바탕(#faf7fa)보다 확실히 진해야 카드가 녹지 않는다. */
            .s1-title-card {
                background: linear-gradient(135deg, #e3d5e1 0%, #eee3ec 100%);
                padding: 26px 28px;
                box-shadow: 0 2px 20px rgba(59, 45, 92, 0.08);
            }
            .s1-title-cap {
                font-size: 12px;
                font-weight: 600;
                color: #7a6690;
                letter-spacing: 0.02em;
                margin-bottom: 8px;
            }
            .s1-title-text {
                font-size: 21px;
                font-weight: 700;
                color: #3b2d5c;
                letter-spacing: -0.02em;
                line-height: 1.4;
            }
            /* 값이 한 줄뿐인 카드: 제목 옆에 붙인다 (오른쪽 끝으로 밀지 않는다) */
            .s1-inline-card {
                display: flex;
                align-items: baseline;
                gap: 16px;
            }
            .s1-inline-card .s1-card-title { width: 150px; flex-shrink: 0; }
            .s1-row {
                display: grid;
                grid-template-columns: 150px 1fr;
                gap: 16px;
                padding: 7px 0;
                align-items: center;
            }
            .s1-label { font-size: 13px; color: #64748b; font-weight: 500; }
            .s1-value { font-size: 15px; color: #1e293b; }
            .s1-note {
                white-space: pre-wrap;
                line-height: 1.75;
                padding: 14px 16px;
                background: #f5f2f6;
                border-radius: 12px;
                font-size: 14px;
                color: #1e293b;
            }
            /* 소제목: 회색으로는 눈에 안 들어와 진하게 세운다 */
            .s1-note-label {
                font-size: 13px;
                color: #334155;
                font-weight: 600;
                letter-spacing: -0.01em;
                margin: 18px 0 8px 0;
            }
            .s1-note-label:first-child { margin-top: 0; }
            /* 총점 강조 */
            .s1-total {
                font-size: 26px;
                font-weight: 700;
                letter-spacing: -0.02em;
                line-height: 1.2;
            }
            .s1-total-unit { font-size: 14px; font-weight: 500; color: #94a3b8; margin-left: 4px; }
            /* 영역별 점수 타일 */
            .s1-tiles {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 10px;
                margin-top: 14px;
            }
            .s1-tile {
                border-radius: 12px;
                padding: 13px 10px;
                text-align: center;
            }
            .s1-tile-name { font-size: 11px; font-weight: 500; margin-bottom: 6px; }
            .s1-tile-num { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
            .s1-chip {
                display: inline-block;
                padding: 5px 12px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 600;
            }
            /* 신청서 수정·삭제: 내용을 다 읽은 뒤 만나는 자리.
               삭제는 되돌릴 수 없으므로 수정보다 한 단계 낮춰 고스트로 둔다. */
            .s1-actions {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                flex-wrap: wrap;
                margin-top: 8px;
                padding: 4px 6px 8px;
            }
            .s1-actions-hint {
                font-size: 12px;
                color: #9c8ea0;
                line-height: 1.6;
            }
            .s1-actions-btns {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .s1-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                padding: 10px 18px;
                border: none;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 600;
                font-family: inherit;
                cursor: pointer;
                transition: 0.15s;
            }
            .s1-btn i { font-size: 11px; }
            .s1-btn-edit {
                background: #eadfe8;
                color: #3b2d5c;
            }
            .s1-btn-edit:hover { background: #e0d2de; }
            .s1-btn-delete {
                background: transparent;
                color: #a08b9e;
            }
            .s1-btn-delete:hover {
                background: rgba(165, 59, 34, 0.08);
                color: #a53b22;
            }

            @media (max-width: 768px) {
                .s1-card { padding: 20px 18px; border-radius: 14px; }
                .s1-title-card { padding: 20px 18px; }
                /* 좁은 화면: 안내문 위, 버튼은 아래에 나란히 */
                .s1-actions {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 12px;
                }
                .s1-actions-hint { text-align: center; }
                .s1-actions-btns { flex-direction: column-reverse; }
                .s1-btn { width: 100%; padding: 13px; font-size: 14px; }
                .s1-title-text { font-size: 17px; line-height: 1.45; }
                .s1-title-cap { font-size: 11px; margin-bottom: 6px; }
                /* 라벨을 값 위로 올려 좁은 칸에서 두 줄로 접히지 않게 */
                .s1-row { display: block; padding: 8px 0; }
                .s1-label { margin-bottom: 5px; }
                .s1-value { font-size: 14px; }
                .s1-tiles { grid-template-columns: repeat(2, 1fr); }
                .s1-total { font-size: 22px; }
            }
        </style>

        ${app.application_title ? `
        <!-- 학생이 직접 붙인 제목. 나머지 카드와 달리 이건 '내용'이 아니라 '표제'다. -->
        <div class="s1-card s1-title-card">
            <div class="s1-title-cap">신청서 제목</div>
            <div class="s1-title-text">${escapeHtml(app.application_title)}</div>
        </div>
        ` : ''}

        <!-- 1. 기본 정보 -->
        <div class="s1-card">
            <div class="s1-card-title">기본 정보</div>
            <div class="s1-row">
                <div class="s1-label">성함</div>
                <div class="s1-value" style="font-weight: 600;">${escapeHtml(app.name)}</div>
            </div>
            <div class="s1-row">
                <div class="s1-label">전화번호</div>
                <div class="s1-value">${escapeHtml(app.phone)}</div>
            </div>
            <div class="s1-row">
                <div class="s1-label">이메일</div>
                <div class="s1-value">${escapeHtml(app.email)}</div>
            </div>
            ${app.address ? `
            <div class="s1-row">
                <div class="s1-label">주소</div>
                <div class="s1-value">${escapeHtml(app.address)}</div>
            </div>` : ''}
            ${app.bank_account ? `
            <div class="s1-row">
                <div class="s1-label">환불 계좌</div>
                <div class="s1-value">${escapeHtml(app.bank_account)}</div>
            </div>` : ''}
        </div>

        <!-- 2. 직업 정보 (한 줄이라 제목 옆에 바로 값을 붙인다) -->
        ${app.occupation ? `
        <div class="s1-card s1-inline-card">
            <div class="s1-card-title" style="margin: 0;">직업 정보</div>
            <div class="s1-value">${escapeHtml(app.occupation)}</div>
        </div>
        ` : ''}

        <!-- 3. 현재 토플 점수 -->
        <div class="s1-card">
            <div class="s1-card-title">현재 토플 점수</div>
            ${hasScore ? `
                <div class="s1-row">
                    <div class="s1-label">응시 여부</div>
                    <div class="s1-value"><span style="color: #2f855a; font-weight: 600;">있음</span> <span style="color: #94a3b8;">· ${scoreIsNew ? '개정 후' : '개정 전'}</span></div>
                </div>
                <div class="s1-row">
                    <div class="s1-label">총점</div>
                    <div class="s1-total" style="color: #5b4a7d;">${fmtCur(curTotal)}<span class="s1-total-unit">${scoreIsNew ? '레벨' : '점'}</span></div>
                </div>
                <div class="s1-tiles">
                    ${curSections.map(([name, v]) => `
                    <div class="s1-tile" style="background: #f3eef3;">
                        <div class="s1-tile-name" style="color: #8b7a92;">${name}</div>
                        <div class="s1-tile-num" style="color: #3b2d5c;">${fmtCur(v)}</div>
                    </div>`).join('')}
                </div>
                ${app.score_history ? `
                    <div class="s1-note-label" style="margin-top: 20px;">점수 관련 상세 설명</div>
                    <div class="s1-note">${escapeHtml(app.score_history)}</div>
                ` : ''}
            ` : `
                <div class="s1-value" style="color: #a53b22; font-weight: 600;">없음</div>
            `}
        </div>

        <!-- 4. 영어 실력 평가 (점수가 없는 경우만) -->
        ${!hasScore && (app.writing_sample_1 || app.writing_sample_2) ? `
        <div class="s1-card">
            <div class="s1-card-title">영어 실력 평가</div>
            ${app.writing_sample_1 ? `
                <div class="s1-note-label">Q1. What are your hobbies or interests, and why do you enjoy them?</div>
                <div class="s1-note">${escapeHtml(app.writing_sample_1)}</div>
            ` : ''}
            ${app.writing_sample_2 ? `
                <div class="s1-note-label">Q2. Describe a challenge you faced recently and how you dealt with it.</div>
                <div class="s1-note">${escapeHtml(app.writing_sample_2)}</div>
            ` : ''}
        </div>
        ` : ''}

        <!-- 5. 학습 현황 -->
        ${app.current_study_method || app.daily_study_time ? `
        <div class="s1-card">
            <div class="s1-card-title">학습 현황</div>
            ${app.current_study_method ? `
                <div class="s1-note-label">현재 토플 공부 방법</div>
                <div class="s1-note">${escapeHtml(app.current_study_method)}</div>
            ` : ''}
            ${app.daily_study_time ? `
            <div class="s1-row" style="margin-top: 14px;">
                <div class="s1-label">하루 평균 공부 시간</div>
                <div class="s1-value">${escapeHtml(app.daily_study_time)}</div>
            </div>` : ''}
        </div>
        ` : ''}

        <!-- 6. 목표 점수 -->
        <div class="s1-card">
            <div class="s1-card-title">목표 점수</div>
            ${app.no_target_score ? `
                <div class="s1-value" style="font-weight: 600; color: #2f855a;">없음 · 고고익선 🚀</div>
            ` : `
                <div class="s1-row">
                    <div class="s1-label">커트라인</div>
                    <div class="s1-total" style="color: #2f855a;">${fmtTgt(tgtTotal)}<span class="s1-total-unit">${targetIsNew ? '레벨' : '점'}</span></div>
                </div>
                ${hasTargetSections ? `
                <div class="s1-tiles">
                    ${tgtSections.map(([name, v]) => `
                    <div class="s1-tile" style="background: #eef6f0;">
                        <div class="s1-tile-name" style="color: #6b9c7d;">${name}</div>
                        <div class="s1-tile-num" style="color: #2f855a;">${fmtTgt(v)}</div>
                    </div>`).join('')}
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">영역별 최소 요구 점수</div>
                ` : ''}
            `}
            ${app.target_note || app.target_notes ? `
                <div class="s1-note-label" style="margin-top: 20px;">개인 희망 점수 및 추가 설명</div>
                <div class="s1-note">${escapeHtml(app.target_note || app.target_notes)}</div>
            ` : ''}
        </div>

        <!-- 7. 마감 기한 -->
        ${app.submission_deadline || app.preferred_completion ? `
        <div class="s1-card">
            <div class="s1-card-title">마감 기한</div>
            ${app.submission_deadline ? `
            <div class="s1-row">
                <div class="s1-label">마지막 응시 가능일</div>
                <div class="s1-value">${escapeHtml(app.submission_deadline)}${dDayChip(app.submission_deadline)}</div>
            </div>` : ''}
            ${app.preferred_completion ? `
            <div class="s1-row">
                <div class="s1-label">희망 목표 달성 시점</div>
                <div class="s1-value">${escapeHtml(app.preferred_completion)}${dDayChip(app.preferred_completion)}</div>
            </div>` : ''}
        </div>
        ` : ''}

        <!-- 8. 토플 점수가 필요한 이유 -->
        ${app.toefl_reason || app.toefl_reason_detail ? `
        <div class="s1-card">
            <div class="s1-card-title">토플 점수가 필요한 이유</div>
            ${app.toefl_reason ? `
            <div class="s1-row">
                <div class="s1-label">목적</div>
                <div class="s1-value" style="font-weight: 600; color: #3b2d5c;">${escapeHtml(app.toefl_reason)}</div>
            </div>` : ''}
            ${app.is_au_nz_direct_submit === 'yes' ? `
            <div class="s1-row">
                <div class="s1-label">기관 직접 제출</div>
                <div class="s1-value"><span class="s1-chip" style="background: #fbecd2; color: #b45309;">호주 · 뉴질랜드</span></div>
            </div>` : ''}
            ${app.toefl_reason_detail ? `
                <div class="s1-note-label">상세 설명</div>
                <div class="s1-note">${escapeHtml(app.toefl_reason_detail)}</div>
            ` : ''}
        </div>
        ` : ''}

        <!-- 9. 가장 기억에 남는 블로그 글 -->
        ${app.memorable_blog_content ? `
        <div class="s1-card">
            <div class="s1-card-title">가장 기억에 남는 블로그 글</div>
            <div class="s1-note">${escapeHtml(app.memorable_blog_content)}</div>
        </div>
        ` : ''}

        <!-- 10. 프로그램 및 일정 -->
        <div class="s1-card">
            <div class="s1-card-title">프로그램 및 일정</div>
            <div class="s1-row">
                <div class="s1-label">희망 프로그램</div>
                <div class="s1-value" style="font-weight: 600; color: #3b2d5c;">${escapeHtml(app.preferred_program || app.program || '-')}</div>
            </div>
            <div class="s1-row">
                <div class="s1-label">스라첨삭 신청</div>
                <div class="s1-value">${(app.preferred_correction === '신청희망' || app.preferred_correction === '신청') ? '<span style="color:#2f855a; font-weight:600;">신청 희망</span>' : '<span style="color:#94a3b8;">미신청</span>'}</div>
            </div>
            <div class="s1-row">
                <div class="s1-label">희망 시작일</div>
                <div class="s1-value">${escapeHtml(app.preferred_start_date || '-')}</div>
            </div>
            ${app.give_up_plan ? `
                <div class="s1-note-label" style="margin-top: 14px;">포기 · 조절할 것</div>
                <div class="s1-note">${escapeHtml(app.give_up_plan)}</div>
            ` : ''}
            ${app.tell_plan ? `
                <div class="s1-note-label">챌린지를 알린 · 알릴 사람</div>
                <div class="s1-note">${escapeHtml(app.tell_plan)}</div>
            ` : ''}
            ${app.program_note ? `
                <div class="s1-note-label">노트북 또는 데스크탑 준비 여부</div>
                <div class="s1-note">${escapeHtml(app.program_note)}</div>
            ` : ''}
        </div>

        <!-- 11. 이온토플을 알게 된 경로 -->
        ${referrals.length ? `
        <div class="s1-card">
            <div class="s1-card-title">이온토플을 알게 된 경로</div>
            ${referrals.map(([label, value]) => `
            <div class="s1-row">
                <div class="s1-label">${label}</div>
                <div class="s1-value">${escapeHtml(value)}</div>
            </div>`).join('')}
        </div>
        ` : ''}

        <!-- 12. 추가 전달 사항 -->
        ${app.additional_notes ? `
        <div class="s1-card">
            <div class="s1-card-title">추가 전달 사항</div>
            <div class="s1-note">${escapeHtml(app.additional_notes)}</div>
        </div>
        ` : ''}

        <!-- 이온쌤의 답변 -->
        ${app.admin_comment ? `
        <div class="s1-card" style="background: #f6f4fb;">
            <div class="s1-card-title" style="color: #3b2d5c;">이온쌤의 답변</div>
            <div style="font-size: 15px; color: #1e293b; line-height: 1.8; white-space: pre-wrap;">${escapeHtml(app.admin_comment)}</div>
        </div>
        ` : ''}

        <!-- 신청 정보 -->
        <div class="s1-card">
            <div class="s1-row">
                <div class="s1-label">신청일시</div>
                <div class="s1-value" style="color: #64748b;">${formatDate(app.created_at)}</div>
            </div>
            ${app.confirm_materials || app.confirm_kakao ? `
            <div class="s1-row">
                <div class="s1-label">확인 사항</div>
                <div class="s1-value" style="font-size: 13px; color: #64748b;">
                    ${app.confirm_materials ? '필독 공지사항 확인 완료' : ''}${app.confirm_materials && app.confirm_kakao ? ' · ' : ''}${app.confirm_kakao ? '카카오톡 본인 인증 동의' : ''}
                </div>
            </div>` : ''}
        </div>

        ${applicationActions}
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
                            <option value="내벨업챌린지 Australia - Fast">내벨업챌린지 Australia - Fast</option>
                            <option value="내벨업챌린지 Australia - Standard">내벨업챌린지 Australia - Standard</option>
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

    // 상태별 표제 (톤: 합격=초록, 조건부=주황, 불합격=코랄. 선/큰 배너 대신 아이콘 타일 + 한 줄)
    const statusInfo = {
        '승인':       { title: '합격 · 승인되었습니다', icon: 'fa-circle-check', accent: '#2f855a', tile: '#dcf0e3' },
        '조건부승인': { title: '조건부 합격',           icon: 'fa-circle-exclamation', accent: '#b45309', tile: '#fbecd2' },
        '거부':       { title: '불합격',               icon: 'fa-circle-xmark', accent: '#a53b22', tile: '#f6ddd6' }
    };
    const status = statusInfo[app.analysis_status] || statusInfo['승인'];

    const isConditional = app.analysis_status === '조건부승인';
    const isRejected = app.analysis_status === '거부';
    // 프로그램·가격은 승인 케이스에만 보여준다.
    // 조건부승인은 협의 전이라, 불합격은 진행이 없으므로 숨긴다.
    const showProgramAndPrice = !isConditional && !isRejected;
    const needsAgreement = app.analysis_status === '승인' && !app.student_program_agreed;
    // 조건부승인은 아직 협의 단계 → 동의 폼 대신 카톡 문의 안내를 표시
    const showConditionalContact = isConditional && !app.student_program_agreed;

    return `
        <style>
            /* STEP 1과 같은 카드/여백 언어. 선·2px 컬러 테두리·hr 없음. */
            .s2-card {
                background: #ffffff;
                border-radius: 16px;
                padding: 24px 28px;
                box-shadow: 0 2px 20px rgba(25, 28, 29, 0.05);
                margin-bottom: 14px;
            }
            .s2-card-title {
                font-size: 15px;
                font-weight: 700;
                color: #1e293b;
                letter-spacing: -0.01em;
                margin: 0 0 16px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .s2-card-title i { font-size: 13px; color: #9c8ea0; }
            /* 합격/불합격 표제 */
            .s2-verdict {
                display: flex;
                align-items: center;
                gap: 14px;
            }
            .s2-verdict-tile {
                width: 46px; height: 46px;
                border-radius: 13px;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
            }
            .s2-verdict-tile i { font-size: 20px; }
            .s2-verdict-title { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: #1e293b; }
            /* 분석 본문 */
            .s2-analysis {
                line-height: 1.85;
                color: #1e293b;
                white-space: pre-wrap;
                font-size: 15px;
            }
            /* 라벨-값 행 */
            .s2-row {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 16px;
                padding: 8px 0;
            }
            .s2-row-label { font-size: 14px; color: #64748b; flex-shrink: 0; }
            .s2-row-value { font-size: 15px; font-weight: 600; color: #1e293b; text-align: right; }
            /* 체크 항목 */
            .s2-check {
                display: flex; align-items: flex-start; gap: 12px;
                padding: 16px 18px;
                background: #f6f4fb;
                border-radius: 12px;
                margin-bottom: 10px;
                cursor: pointer;
                transition: 0.15s;
            }
            .s2-check:hover { background: #efeaf7; }
            .s2-check input { width: 20px; height: 20px; margin-top: 2px; cursor: pointer; accent-color: #7c68a8; flex-shrink: 0; }
            .s2-check label { flex: 1; cursor: pointer; line-height: 1.6; color: #1e293b; }
            .s2-check label span { font-size: 13px; color: #94a3b8; }
            /* 주 동의 버튼: 시그니처 그라데이션(주색→밝은 톤). 그림자 대신 색으로 존재감.
               비활성일 땐 채움을 걷고 눌린 톤으로 — 아직 못 누른다는 걸 색으로 알린다. */
            .s2-agree-btn {
                width: 100%;
                padding: 15px;
                background: #efeaf7;
                color: #5b4a7d;
                border: none;
                border-radius: 12px;
                font-size: 15px;
                font-weight: 600;
                font-family: inherit;
                letter-spacing: -0.01em;
                cursor: pointer;
                transition: 0.15s;
            }
            .s2-agree-btn:disabled {
                background: #f1eef7;
                color: #b3a6c9;
                cursor: not-allowed;
            }
            .s2-agree-btn:not(:disabled):hover { background: #e5ddf3; }
            @media (max-width: 768px) {
                .s2-card { padding: 20px 18px; border-radius: 14px; }
                .s2-row { flex-direction: column; align-items: flex-start; gap: 3px; }
                .s2-row-value { text-align: left; }
            }
        </style>

        <!-- 표제: 큰 배너 대신 아이콘 타일 + 한 줄 -->
        <div class="s2-card">
            <div class="s2-verdict">
                <div class="s2-verdict-tile" style="background: ${status.tile};">
                    <i class="fas ${status.icon}" style="color: ${status.accent};"></i>
                </div>
                <div class="s2-verdict-title">${status.title}</div>
            </div>
        </div>

        <!-- 1. 개별 분석 내용 -->
        ${app.analysis_content ? `
        <div class="s2-card">
            <div class="s2-card-title"><i class="fas fa-file-lines"></i> 개별 분석 내용</div>
            <div class="s2-analysis">${escapeHtml(app.analysis_content)}</div>
        </div>
        ` : ''}

        <!-- 2. 배정 프로그램 정보 (조건부승인 동안엔 숨김 — 아직 협의 전) -->
        ${showProgramAndPrice && app.assigned_program ? `
        <div class="s2-card">
            <div class="s2-card-title"><i class="fas fa-graduation-cap"></i> 배정 프로그램 정보</div>
            <div class="s2-row">
                <span class="s2-row-label">프로그램명</span>
                <span class="s2-row-value" style="color: #5b4a7d;">${escapeHtml(app.assigned_program)}</span>
            </div>
            ${app.schedule_start ? `
            <div class="s2-row">
                <span class="s2-row-label">시작일</span>
                <span class="s2-row-value">${app.schedule_start}</span>
            </div>` : ''}
            ${app.schedule_end ? `
            <div class="s2-row">
                <span class="s2-row-label">종료일</span>
                <span class="s2-row-value">${app.schedule_end}</span>
            </div>` : ''}
            ${app.correction_enabled ? `
            <div class="s2-row">
                <span class="s2-row-label">스라첨삭</span>
                <span class="s2-row-value" style="color: #2f855a;">포함</span>
            </div>
            ${app.correction_start_date ? `
            <div class="s2-row">
                <span class="s2-row-label">첨삭 시작일</span>
                <span class="s2-row-value">${app.correction_start_date}</span>
            </div>` : ''}
            ${app.extension_enabled && app.extension_start_date ? `
            <div class="s2-row">
                <span class="s2-row-label">13~24세션 시작일</span>
                <span class="s2-row-value" style="color: #5b4a7d;">${app.extension_start_date}</span>
            </div>` : ''}
            ` : ''}
        </div>
        ` : ''}

        <!-- 3. 이용가 및 할인 내역 (조건부승인 동안엔 숨김 — 아직 협의 전) -->
        ${showProgramAndPrice ? getPricingBox(app) : ''}

        <!-- 동의 섹션 (승인일 때만) — 경고·타이머·동의폼이 여기서 한 덩어리가 된다 -->
        ${needsAgreement ? getAgreementSection(app) : ''}

        <!-- 불합격: 격려 카드 (다음 도전을 위한 마무리) -->
        ${isRejected ? `
        <div class="s2-card" style="background: linear-gradient(135deg, #e3d5e1 0%, #eee3ec 100%); box-shadow: 0 2px 20px rgba(59, 45, 92, 0.08); text-align: center; padding: 34px 28px;">
            <div class="s2-verdict-tile" style="background: #ffffff; margin: 0 auto 16px;">
                <i class="fas fa-seedling" style="color: #7c68a8; font-size: 20px;"></i>
            </div>
            <div style="font-size: 18px; font-weight: 700; color: #3b2d5c; letter-spacing: -0.01em; margin-bottom: 10px;">포기하지 마세요</div>
            <p style="font-size: 14px; color: #5b4a72; line-height: 1.9; margin: 0 auto; max-width: 460px;">
                지금은 아니지만, 토플은 준비된 만큼 반드시 오릅니다.<br>
                분석에서 짚어드린 부분을 채우고 다시 도전해 주세요.<br>
                언제든 응원하겠습니다.
            </p>
        </div>
        ` : ''}

        <!-- 조건부승인: 카톡 문의 안내 (동의 폼·타이머 대신) -->
        ${showConditionalContact ? `
        <div class="s2-card">
            <div style="display: flex; align-items: flex-start; gap: 14px;">
                <div class="s2-verdict-tile" style="background: #f3f0e2;">
                    <i class="fas fa-comment-dots" style="color: #b58a2e; font-size: 18px;"></i>
                </div>
                <div style="flex: 1;">
                    <div style="font-size: 16px; font-weight: 700; color: #1e293b; letter-spacing: -0.01em; margin-bottom: 8px;">카톡 한 번 부탁드려요</div>
                    <p style="font-size: 14px; color: #64748b; line-height: 1.8; margin: 0 0 18px 0;">
                        위 개별분석을 보시면 아시겠지만, 함께 조금 더 이야기 나눠보면 좋을 부분이 있어요.<br>분석에서 제가 여쭤본 내용에 대해서 카카오톡으로 답변 주시면, 그 내용을 바탕으로 프로그램과 일정을 다시 상담하면서 맞춰보도록 해요!<br><span style="color: #94a3b8; font-size: 13px;">(카카오톡 채널 특성상 제가 먼저 카톡을 보낼 수 없어서ㅠ 꼭 카톡 부탁드려요!)</span>
                    </p>
                    <a href="http://pf.kakao.com/_FWxcZC/chat" target="_blank" rel="noopener noreferrer"
                       style="display: inline-flex; align-items: center; gap: 7px; padding: 11px 20px; background: #f3eccf; color: #7a5f1e; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none;">
                        <i class="fas fa-comment" style="font-size: 14px;"></i> 카카오톡으로 답변 보내기
                    </a>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- 동의 완료 메시지 -->
        ${app.student_program_agreed ? `
        <div class="s2-card" style="background: #f2f8f4; text-align: center;">
            <div class="s2-verdict-tile" style="background: #dcf0e3; margin: 0 auto 14px;">
                <i class="fas fa-circle-check" style="color: #2f855a; font-size: 20px;"></i>
            </div>
            <h3 style="font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">동의 완료</h3>
            <p style="font-size: 14px; color: #64748b; line-height: 1.7;">
                프로그램 동의가 완료되었습니다.<br>
                ${app.student_agreed_at ? `(동의일: ${formatDate(app.student_agreed_at)})` : ''}
            </p>
            <p style="font-size: 13px; color: #94a3b8; margin-top: 12px;">
                다음 단계 진행을 위해 관리자가 연락드릴 예정입니다.
            </p>
        </div>
        ` : ''}
    `;
}

// 남은 시간 포맷팅: 일반 24:00:00 / 유도 4일 12:00:00
function formatCountdown(remainingMs, isIncentive) {
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
let analysisCountdownInterval = null;

function startAnalysisCountdown(completedAt, isIncentive) {
    if (analysisCountdownInterval) clearInterval(analysisCountdownInterval);
    
    const deadlineMs = isIncentive ? (5 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const completedTime = new Date(completedAt).getTime();
    const urgentThresholdMs = isIncentive ? (24 * 60 * 60 * 1000) : (6 * 60 * 60 * 1000);
    
    function tick() {
        const remaining = deadlineMs - (Date.now() - completedTime);
        const el = document.getElementById('analysisCountdownTimer');
        const containerEl = document.getElementById('analysisCountdownContainer');
        if (!el || !containerEl) { clearInterval(analysisCountdownInterval); return; }
        
        if (remaining <= 0) {
            clearInterval(analysisCountdownInterval);
            el.textContent = '00:00:00';
            // 만료: 타이머 칩을 코랄로 (칩 배경은 부모 span)
            el.style.color = '#a53b22';
            const chip = el.parentElement;
            if (chip) chip.style.background = '#f6ddd6';
            const msgEl = document.getElementById('analysisCountdownMsg');
            if (msgEl) {
                msgEl.innerHTML = '<i class="fas fa-triangle-exclamation"></i> 시간이 초과되었습니다. 관리자에게 문의해주세요.';
                msgEl.style.color = '#a53b22';
                msgEl.style.fontSize = '13px';
                msgEl.style.fontWeight = '600';
                msgEl.style.marginTop = '4px';
            }
            return;
        }

        el.textContent = formatCountdown(remaining, isIncentive);

        // 임박: 타이머 칩을 주황으로
        if (remaining <= urgentThresholdMs) {
            el.style.color = '#b45309';
            const chip = el.parentElement;
            if (chip) chip.style.background = '#fbecd2';
            const msgEl = document.getElementById('analysisCountdownMsg');
            if (msgEl) {
                msgEl.innerHTML = '<i class="fas fa-circle-exclamation"></i> 동의 기한이 얼마 남지 않았습니다!';
                msgEl.style.color = '#b45309';
                msgEl.style.fontSize = '13px';
                msgEl.style.fontWeight = '600';
                msgEl.style.marginTop = '4px';
            }
        }
    }
    
    tick();
    analysisCountdownInterval = setInterval(tick, 1000);
}

// 동의 섹션 HTML
function getAgreementSection(app) {
    const isIncentive = app.is_incentive_applicant === true;
    const deadlineMs = isIncentive ? (5 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const deadlineLabel = isIncentive ? '5일' : '24시간';
    
    // 데드라인 기준: 최초 저장 시각(analysis_first_saved_at) 우선, 구 데이터는 폴백
    const analysisTimestamp = app.analysis_first_saved_at || app.analysis_completed_at || app.analysis_saved_at;
    const elapsedMs = analysisTimestamp 
        ? (Date.now() - new Date(analysisTimestamp).getTime())
        : 0;
    const remainingMs = deadlineMs - elapsedMs;
    const initialCountdown = formatCountdown(remainingMs, isIncentive);
    
    // 긴급 기준: 유도학생은 남은 1일 미만, 일반은 6시간 미만
    const urgentThresholdMs = isIncentive ? (24 * 60 * 60 * 1000) : (6 * 60 * 60 * 1000);
    const isExpired = remainingMs <= 0;
    const isUrgent = !isExpired && remainingMs <= urgentThresholdMs;
    
    // 타이머 상태별 색상 (안내 컨테이너 내부 타이머에 사용)
    let timerColor, timerBorderColor;
    if (isExpired) {
        timerColor = '#dc2626'; timerBorderColor = '#ef4444';
    } else if (isUrgent) {
        timerColor = '#dc2626'; timerBorderColor = '#fca5a5';
    } else {
        timerColor = '#92400e'; timerBorderColor = '#f59e0b';
    }
    
    // 안내 영역 배경색: 만료/긴급 시 빨간색, 그 외 노란색
    let infoBg, infoBorder, infoIconColor, infoTextColor;
    if (isExpired) {
        infoBg = '#fee2e2'; infoBorder = '#ef4444'; infoIconColor = '#dc2626'; infoTextColor = '#991b1b';
    } else if (isUrgent) {
        infoBg = '#fef3c7'; infoBorder = '#f59e0b'; infoIconColor = '#d97706'; infoTextColor = '#92400e';
    } else {
        infoBg = '#fef3c7'; infoBorder = '#f59e0b'; infoIconColor = '#d97706'; infoTextColor = '#92400e';
    }
    
    // 안내 문구: 유도학생은 입문서 + 할인/재신청 제한 안내 포함, 일반학생은 기본 문구
    const guideText = isIncentive
        ? `개별분석 결과와 입문서를 꼼꼼히 읽어보신 후, <strong>5일 이내</strong>에 동의해주세요.
            <div style="margin-top: 10px; padding: 12px 14px; background: rgba(255,255,255,0.7); border-radius: 8px; font-size: 13px; line-height: 1.7; color: #92400e;">
                <div style="font-weight: 700; margin-bottom: 6px;">⚠️ 꼭 알아두세요!</div>
                <div style="margin-bottom: 4px;">· 지금 적용된 할인 혜택은 <strong>이 5일 동의 기간에만 유효</strong>해요. 기간이 지나면 할인은 사라지고, 다시 신청하셔도 같은 할인은 적용되지 않아요.</div>
                <div>· 동의하지 않고 기간이 지나면 <strong>5일 동안 새로 신청할 수 없어요.</strong></div>
            </div>`
        : '개별분석 결과를 확인하신 후, <strong>24시간 이내</strong>에 동의해주세요.';
    
    // 만료 시 경고 문구
    const expiredMsg = isExpired
        ? `<div style="font-size: 12px; color: #dc2626; margin-top: 6px; font-weight: 600;"><i class="fas fa-exclamation-triangle"></i> 시간이 초과되었습니다. 관리자에게 문의해주세요.</div>`
        : (isUrgent ? `<div id="analysisCountdownMsg" style="font-size: 12px; color: #dc2626; margin-top: 6px; font-weight: 600;"><i class="fas fa-exclamation-circle"></i> 동의 기한이 얼마 남지 않았습니다!</div>` : '');
    
    // 동의 대상 요약: 학생이 "무엇에 동의하는지"를 폼 바로 위에서 다시 보여준다.
    // (프로그램·가격 카드가 한참 위에 있어 스크롤 없이 확인하도록)
    const priceStr = app.final_price ? `${app.final_price.toLocaleString()}원` : '';
    const agreeSummary = `
        <div style="background: #f6f4fb; border-radius: 12px; padding: 14px 18px; margin-bottom: 18px;">
            ${app.assigned_program ? `
            <div style="display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 14px;">
                <span style="color: #64748b;">프로그램</span>
                <span style="font-weight: 600; color: #5b4a7d; text-align: right;">${escapeHtml(app.assigned_program)}</span>
            </div>` : ''}
            ${app.schedule_start ? `
            <div style="display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 14px;">
                <span style="color: #64748b;">일정</span>
                <span style="font-weight: 600; color: #1e293b; text-align: right;">${app.schedule_start}${app.schedule_end ? ' ~ ' + app.schedule_end : ''}</span>
            </div>` : ''}
            ${priceStr ? `
            <div style="display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 14px;">
                <span style="color: #64748b;">최종 입금금액</span>
                <span style="font-weight: 700; color: #5b4a7d; text-align: right;">${priceStr}</span>
            </div>` : ''}
        </div>
    `;

    // 자동 승인불가 경고: 프로모션(유도) 학생이 아닐 때만. 문구는 정책이라 그대로 유지한다.
    const autoRejectWarning = !isIncentive ? `
        <div style="background: #f9edea; border-radius: 12px; padding: 16px 18px; margin-bottom: 18px;">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
                <i class="fas fa-triangle-exclamation" style="font-size: 15px; color: #a53b22; margin-top: 3px; flex-shrink: 0;"></i>
                <div>
                    <div style="font-size: 14px; font-weight: 700; color: #a53b22; margin-bottom: 6px;">⏰ 필독! 자동 승인불가 처리 안내</div>
                    <div style="font-size: 13px; color: #7a3423; line-height: 1.7;">
                        토플 일대일 진단서 업로드 시간으로부터 <strong>24시간 이내에 댓글이 없을 시</strong>, 알림 없이 자동으로 <strong style="text-decoration: underline;">승인불가 처리</strong>가 됩니다.
                        토플이 최우선이고, 열심히 하실 마음, 절박함과 의지가 있으신 분들이라고 판단되지 않기 때문에 내린 결정입니다.
                        또한, 이후 <strong>만 5일간 새로운 신청서를 업로드 하실 수 없으니</strong> 반드시 참고해주시기 바랍니다.
                    </div>
                </div>
            </div>
        </div>
    ` : '';

    // 남은 시간 뱃지: 만료/임박이면 코랄, 평상시 라벤더. 큰 노란 박스 대신 폼 헤더 옆 작은 칩.
    let timerChipBg, timerChipColor;
    if (isExpired) { timerChipBg = '#f6ddd6'; timerChipColor = '#a53b22'; }
    else if (isUrgent) { timerChipBg = '#fbecd2'; timerChipColor = '#b45309'; }
    else { timerChipBg = '#ece4f2'; timerChipColor = '#5b4a7d'; }

    const timerChip = analysisTimestamp ? `
        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: ${timerChipBg}; flex-shrink: 0;">
            <i class="fas fa-clock" style="font-size: 11px; color: ${timerChipColor};"></i>
            <span id="analysisCountdownTimer" style="font-size: 15px; font-weight: 700; color: ${timerChipColor}; font-variant-numeric: tabular-nums;">${initialCountdown}</span>
        </span>
    ` : '';

    // 만료/임박 안내 한 줄 (id 유지 — 카운트다운 로직이 갱신)
    const deadlineMsg = isExpired
        ? `<div id="analysisCountdownMsg" style="font-size: 13px; color: #a53b22; font-weight: 600; margin-top: 4px;"><i class="fas fa-triangle-exclamation"></i> 시간이 초과되었습니다. 관리자에게 문의해주세요.</div>`
        : (isUrgent ? `<div id="analysisCountdownMsg" style="font-size: 13px; color: #b45309; font-weight: 600; margin-top: 4px;"><i class="fas fa-circle-exclamation"></i> 동의 기한이 얼마 남지 않았습니다!</div>` : `<div id="analysisCountdownMsg"></div>`);

    // 경고·타이머·동의폼을 한 카드로 묶는다. (id: analysisCountdownContainer 유지)
    return `
        <div id="analysisCountdownContainer" class="s2-card">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px;">
                <div class="s2-card-title" style="margin: 0;"><i class="fas fa-clipboard-check"></i> 프로그램 동의 (필수)</div>
                ${timerChip}
            </div>
            <div style="font-size: 14px; color: #64748b; line-height: 1.7; margin-bottom: 4px;">
                ${guideText}
            </div>
            ${deadlineMsg}

            <div style="margin-top: 18px;">
                ${agreeSummary}
                ${autoRejectWarning}

                <div class="s2-check" onclick="toggleCheckbox(event, 'agreeProgram')">
                    <input type="checkbox" id="agreeProgram" onchange="updateAgreementButton()">
                    <label for="agreeProgram">
                        <strong>프로그램명, 시작일, 가격에 동의합니다.</strong><br>
                        <span>배정된 프로그램 정보를 확인했으며, 해당 내용에 동의합니다.</span>
                    </label>
                </div>

                <div class="s2-check" onclick="toggleCheckbox(event, 'agreeSchedule')">
                    <input type="checkbox" id="agreeSchedule" onchange="updateAgreementButton()">
                    <label for="agreeSchedule">
                        <strong>일정에 동의합니다.</strong><br>
                        <span>시작일과 종료일을 확인했으며, 해당 일정에 참여할 수 있습니다.</span>
                    </label>
                </div>

                <div style="text-align: center; margin: 14px 0; font-size: 13px; color: #94a3b8; line-height: 1.6;">
                    프로그램·일정·첨삭 등 변경을 원하시면 오른쪽 카카오톡 아이콘을 눌러주세요.
                </div>

                <button id="submitAgreementBtn" onclick="submitStudentAgreement()" disabled class="s2-agree-btn">
                    <i class="fas fa-circle-check" style="margin-right: 7px;"></i> 동의하고 다음 단계로
                </button>
            </div>
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
        // disabled 속성만 토글한다. 색·커서는 .s2-agree-btn:disabled CSS가 담당.
        submitBtn.disabled = !(agreeProgram.checked && agreeSchedule.checked);
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
        
        // 8. 관리자 이용방법 업로드 ~ 택배 발송 등록 전 (발송 생략 학생은 통과)
        if (!app.shipping_completed && !app.shipping_waived) {
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
            // 실시간 카운트다운 시작 (동의 전 + 분석 완료 시점이 있을 때)
            // 데드라인 기준: 최초 저장 시각(analysis_first_saved_at) 우선, 구 데이터는 폴백
            const needsAgreement = app.analysis_status === '승인' && !app.student_program_agreed;
            const analysisTs = app.analysis_first_saved_at || app.analysis_completed_at || app.analysis_saved_at;
            if (needsAgreement && analysisTs) {
                startAnalysisCountdown(analysisTs, app.is_incentive_applicant === true);
            }
        }
    } else {
        const analysisTab = document.getElementById('tabStudentAnalysis');
        if (analysisTab) {
            analysisTab.innerHTML = `
                <div style="background: #ffffff; border-radius: 16px; padding: 64px 24px; text-align: center; box-shadow: 0 2px 20px rgba(25, 28, 29, 0.05);">
                    <div style="width: 60px; height: 60px; border-radius: 16px; background: #f0e9ef; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                        <i class="fas fa-clock" style="font-size: 26px; color: #b3a0b8;"></i>
                    </div>
                    <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #1e293b;">분석 대기 중</h3>
                    <p style="font-size: 14px; color: #64748b; line-height: 1.7;">이온쌤이 신청서를 검토 중입니다.<br>곧 개별분석 결과를 보내드리겠습니다!</p>
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
    // 아직 도달하지 않은 단계는 흐리게 표시한다(클릭은 계속 허용 — 눌러보면 잠금 안내가 뜬다)
    const stepTabOrder = ['tabInfo', 'tabStudentAnalysis', 'tabContract', 'tabPayment', 'tabUsage'];
    document.querySelectorAll('.step-nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-tab') === activeTab) {
            link.classList.add('active');
        }
        const stepIndex = stepTabOrder.indexOf(link.getAttribute('data-tab'));
        const stepNo = stepIndex + 1;
        // 지나온 단계 / 지금 단계 / 아직 못 간 단계를 나눈다
        link.classList.toggle('step-done', stepIndex >= 0 && stepNo < step);
        link.classList.toggle('step-current', stepIndex >= 0 && stepNo === step);
        link.classList.toggle('step-locked', stepIndex >= 0 && stepNo > step);
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
// 학생 계약서 화면 전용 색 보정: 공유 스타일(contract-utils.js)은 파랑·노랑을 쓴다.
// 관리자 미리보기를 건드리지 않으려고, 학생 페이지에서 그린 뒤 색만 라벤더로 갈아입힌다.
// - 노란 '따라쓰기' 배경은 인라인이라 JS로 교체 / 파란 포커스색은 override CSS로 누른다.
function applyStudentContractTheme(readonly = false) {
    // 기한 초과·계약 완료 상태에서는 입력칸을 잠근다 (제출이 불가능하므로 입력도 막는다)
    if (readonly) {
        document.querySelectorAll('#tabContract .contract-input').forEach(el => {
            el.disabled = true;
            el.style.cursor = 'not-allowed';
            el.style.opacity = '0.55';
        });
        document.querySelectorAll('#tabContract .copywrite-container').forEach(el => {
            el.style.opacity = '0.55';
        });
    }
    // override CSS 한 번만 주입
    if (!document.getElementById('s3-contract-theme')) {
        const st = document.createElement('style');
        st.id = 's3-contract-theme';
        st.textContent = `
            #tabContract .contract-content { box-shadow: 0 2px 20px rgba(25,28,29,0.05) !important; border-radius: 16px !important; }
            #tabContract .contract-input-free:focus { border-bottom-color: #9480c5 !important; background: #f3f0ff !important; }
            #tabContract .auto-fill { color: #4c1d95 !important; background: #ece4f2 !important; }
        `;
        document.head.appendChild(st);
    }
    // 따라쓰기 칸: 자유입력칸과 같은 라벤더 라운드 박스로. 배경은 컨테이너가,
    // input은 밑줄을 지우고 투명하게 둔다(뒤에 깔린 '정답 힌트'가 가려지지 않도록).
    document.querySelectorAll('#tabContract .copywrite-container').forEach(el => {
        el.style.background = '#f6f4fb';
        el.style.borderRadius = '9px';
        el.style.border = '1.5px dashed #b3a0d8';  // 점선 = "따라 채우는 칸"이라는 신호
        el.style.padding = '1px 10px';             // 성명칸(31px)과 높이를 맞춘다
        el.style.margin = '4px 4px';               // 뒤따르는 텍스트와 한 칸 띄운다
        el.style.verticalAlign = 'middle';
        el.style.maxWidth = '100%';                // 모바일에서 화면 밖으로 넘치지 않게
        el.style.boxSizing = 'border-box';
    });
    // 뒤에 깔린 정답 힌트: 너무 흐려서(#d1d5db) 안 보였다. 진한 라벤더 + 기울임으로
    // "이 글자를 그대로 따라 쓴다"가 읽히게 한다.
    document.querySelectorAll('#tabContract .copywrite-hint').forEach(el => {
        el.style.color = '#b0a2cc';
        el.style.fontStyle = 'italic';
        el.style.fontSize = '13px';      // 입력 글씨와 같은 크기로 (겹쳐 있으므로)
    });
    document.querySelectorAll('#tabContract .contract-input-copy').forEach(el => {
        el.style.border = 'none';
        el.style.borderBottom = 'none';
        el.style.background = 'transparent';
        el.style.color = '#3b2d5c';
        el.style.paddingTop = '0';       // 컨테이너가 이미 세로 여백을 가지므로 안쪽 input은 0
        el.style.paddingBottom = '0';
        el.style.fontSize = '13px';      // 본문보다 살짝 작게
        el.style.maxWidth = '100%';      // 인라인 width(정답 길이 비례)가 화면을 넘지 않게
        el.style.boxSizing = 'border-box';
    });
    // 자유입력칸: 날카로운 밑줄형 → 부드러운 둥근 박스형 (인라인 스타일 통째 교체)
    document.querySelectorAll('#tabContract .contract-input-free').forEach(el => {
        el.style.border = 'none';
        el.style.borderBottom = 'none';
        el.style.background = '#f1edf8';
        el.style.borderRadius = '9px';
        el.style.padding = '5px 13px';
        el.style.margin = '4px 0';       // 문단 줄 간격이 좁아 칸이 겹치므로 세로 여백을 준다
        el.style.verticalAlign = 'middle';
        el.style.minWidth = '220px';
        el.style.color = '#3b2d5c';
        el.style.outline = 'none';
        el.style.transition = '0.15s';
        el.addEventListener('focus', () => { el.style.boxShadow = '0 0 0 2px #9480c5'; el.style.background = '#ffffff'; });
        el.addEventListener('blur', () => { el.style.boxShadow = 'none'; el.style.background = '#f1edf8'; });
    });

    // 따라쓰기 검증(validateCopywrite, 공유 함수)은 입력 중 노란/빨강으로 색을 되돌린다.
    // 학생 페이지에서만 한 번 래핑해, 정답 아닐 때 라벤더/코랄로 후처리한다.
    if (typeof window.validateCopywrite === 'function' && !window.__vcWrapped) {
        const orig = window.validateCopywrite;
        window.validateCopywrite = function(input) {
            orig(input);
            // 학생 계약서 안의 칸만 톤 보정
            if (!input.closest || !input.closest('#tabContract')) return;
            const container = input.closest('.copywrite-container');
            const valid = input.dataset.valid === 'true';
            const value = (input.value || '');
            const answer = input.dataset.answer || '';
            input.style.border = 'none';
            input.style.borderBottom = 'none';
            input.style.background = 'transparent';
            if (valid) { if (container) container.style.background = '#e4f3e9'; return; } // 정답=연초록 박스
            if (value.length && !answer.startsWith(value)) {
                if (container) container.style.background = '#fbeae6'; // 완전 오답=연코랄
            } else {
                if (container) container.style.background = '#f1edf8'; // 입력 중/미입력=라벤더
            }
        };
        window.__vcWrapped = true;
    }
}

async function loadContractTab(app) {
    const contractContent = document.getElementById('tabContract');
    if (!contractContent) return;

    // STEP 2와 같은 라벤더 카드 언어. 계약서 본문(getContractDisplay)·스타일은 건드리지 않는다.
    const s3style = `
        <style>
            .s3-lock {
                background: #ffffff; border-radius: 16px;
                box-shadow: 0 2px 20px rgba(25, 28, 29, 0.05);
                padding: 64px 24px; text-align: center;
            }
            .s3-lock-tile {
                width: 60px; height: 60px; border-radius: 16px; background: #f0e9ef;
                display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;
            }
            .s3-banner {
                background: #ffffff; border-radius: 16px;
                box-shadow: 0 2px 20px rgba(25, 28, 29, 0.05);
                padding: 20px 24px; margin-bottom: 20px;
                display: flex; align-items: center;
                gap: 14px; flex-wrap: wrap;
            }
            .s3-banner-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
            .s3-banner-tile {
                width: 46px; height: 46px; border-radius: 13px;
                display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            }
            .s3-banner-title { font-size: 16px; font-weight: 700; color: #1e293b; letter-spacing: -0.01em; }
            .s3-banner-sub { font-size: 13px; color: #64748b; margin-top: 3px; }
            .s3-timer-chip {
                display: inline-flex; align-items: center; gap: 6px;
                padding: 5px 12px; border-radius: 999px; flex-shrink: 0;
            }
            .s3-timer-num { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
            .s3-timer-unit { font-size: 11px; font-weight: 600; }
            .s3-agree {
                background: #ffffff; border-radius: 16px;
                box-shadow: 0 2px 20px rgba(25, 28, 29, 0.05);
                padding: 24px 28px; margin-top: 20px;
            }
            .s3-agree-title { font-size: 15px; font-weight: 700; color: #1e293b; letter-spacing: -0.01em; margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px; }
            .s3-agree-title i { font-size: 13px; color: #9c8ea0; }
            .s3-agree-btn {
                width: 100%; padding: 15px; background: #efeaf7; color: #5b4a7d;
                border: none; border-radius: 12px; font-size: 15px; font-weight: 600;
                font-family: inherit; letter-spacing: -0.01em; cursor: pointer; transition: 0.15s;
            }
            .s3-agree-btn:hover { background: #e5ddf3; }
            .s3-agree-hint { font-size: 13px; color: #94a3b8; text-align: center; margin: 14px 0 0 0; line-height: 1.6; }
        </style>
    `;

    // 1. 계약서 미발송 → 잠금 대기
    if (!app.contract_sent) {
        contractContent.innerHTML = `
            ${s3style}
            <div class="s3-lock">
                <div class="s3-lock-tile"><i class="fas fa-lock" style="font-size: 26px; color: #b3a0b8;"></i></div>
                <h3 style="font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 10px;">계약서 대기 중</h3>
                <p style="font-size: 14px; color: #64748b; line-height: 1.8;">
                    관리자가 계약서를 발송하면 이곳에 표시됩니다.<br>
                    개별분석에 동의하신 후 24시간 이내에 계약서가 발송됩니다.
                </p>
            </div>
        `;
        return;
    }

    // 2. 계약 완료 → 초록 배너 + 계약서 본문(읽기)
    if (app.contract_agreed) {
        const contractHTML = await getContractDisplay(app);
        contractContent.innerHTML = `
            ${s3style}
            <div class="s3-banner" style="background: #f2f8f4;">
                <div class="s3-banner-left">
                    <div class="s3-banner-tile" style="background: #dcf0e3;"><i class="fas fa-circle-check" style="color: #2f855a; font-size: 20px;"></i></div>
                    <div>
                        <div class="s3-banner-title">계약 완료</div>
                        <div class="s3-banner-sub">${new Date(app.contract_agreed_at).toLocaleString('ko-KR')}에 동의하셨습니다 · 다음 단계로 입금 안내가 발송됩니다.</div>
                    </div>
                </div>
            </div>
            ${contractHTML}
        `;
        // 완료 상태: 서명한 값을 보여주되 입력칸은 잠근다.
        // 값 채우기(fillContractInputs)가 100ms 뒤이므로 잠금은 그 후에 건다.
        setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); applyStudentContractTheme(true); }, 150);
        return;
    }

    // 타이머 계산 (기존 로직 유지)
    const sentTime = new Date(app.contract_sent_at).getTime();
    const isContractDeferred = !!app.contract_deadline_override;
    const contractDeadlineMs = isContractDeferred
        ? new Date(app.contract_deadline_override).getTime()
        : sentTime + (24 * 60 * 60 * 1000);
    const now = Date.now();
    const remaining = contractDeadlineMs - now;

    // 3. 기한 초과 → 코랄 배너 + 계약서 본문
    if (remaining <= 0) {
        const contractHTML = await getContractDisplay(app);
        contractContent.innerHTML = `
            ${s3style}
            <div class="s3-banner" style="background: #f9edea;">
                <div class="s3-banner-left">
                    <div class="s3-banner-tile" style="background: #f6ddd6;"><i class="fas fa-triangle-exclamation" style="color: #a53b22; font-size: 18px;"></i></div>
                    <div>
                        <div class="s3-banner-title">동의 기한 초과</div>
                        <div class="s3-banner-sub">계약 동의 기한이 초과되었습니다. 관리자에게 문의하여 기한을 연장해 주세요.</div>
                    </div>
                </div>
            </div>
            ${contractHTML}
        `;
        setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); applyStudentContractTheme(true); }, 50);
        return;
    }

    // 4. 동의 대기 → 타이머 배너 + 계약서 본문 + 동의 버튼
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    // 6시간 미만이면 임박(주황), 그 외 평상시(라벤더)
    const urgent = hours < 6;
    const chipBg = urgent ? '#fbecd2' : '#ece4f2';
    const chipColor = urgent ? '#b45309' : '#5b4a7d';
    const tileBg = urgent ? '#fbecd2' : '#ece4f2';
    const tileColor = urgent ? '#b45309' : '#5b4a7d';

    // 기한 안내 문구 (기존 로직 유지)
    let deadlineSubText;
    if (isContractDeferred) {
        const deadlineDate = new Date(app.contract_deadline_override);
        const deadlineDateLabel = deadlineDate.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        deadlineSubText = `${deadlineDateLabel}까지`;
    } else {
        deadlineSubText = `${new Date(sentTime).toLocaleString('ko-KR')}부터 24시간`;
    }

    const contractHTML = await getContractDisplay(app);

    contractContent.innerHTML = `
        ${s3style}
        <div class="s3-banner">
            <div class="s3-banner-tile" style="background: ${tileBg};"><i class="fas fa-clock" style="color: ${tileColor}; font-size: 17px;"></i></div>
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div class="s3-banner-title">계약 동의 기한</div>
                    <div class="s3-timer-chip" style="background: ${chipBg};">
                        <span id="contractTimer" class="s3-timer-num" style="color: ${chipColor};">${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}</span>
                        <span class="s3-timer-unit" style="color: ${chipColor};">남음</span>
                    </div>
                </div>
                <div class="s3-banner-sub" style="margin-top: 4px;">${deadlineSubText}</div>
            </div>
        </div>

        ${contractHTML}

        <div class="s3-agree">
            <div class="s3-agree-title"><i class="fas fa-square-check"></i> 계약 동의</div>
            <button onclick="submitContractAgreement()" id="submitContractBtn" class="s3-agree-btn">
                <i class="fas fa-circle-check" style="margin-right: 7px;"></i> 계약에 동의하고 제출합니다
            </button>
            <p class="s3-agree-hint">모든 빈칸을 작성하고 버튼을 클릭하면 다음 단계로 진행됩니다.</p>
        </div>
    `;

    // 타이머 시작 (기존 로직 유지)
    startContractTimer(sentTime, contractDeadlineMs);
    setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); applyStudentContractTheme(); }, 50);
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
function startContractTimer(sentTime, deadlineMs) {
    // deadlineMs가 지정되면 절대 시각 기준, 아니면 sentTime + 24시간
    const targetMs = deadlineMs || (sentTime + 24 * 60 * 60 * 1000);
    const timerInterval = setInterval(() => {
        const now = Date.now();
        const remaining = targetMs - now;
        const timerElem = document.getElementById('contractTimer');
        if (!timerElem) { clearInterval(timerInterval); return; }
        const chip = timerElem.closest('.s3-timer-chip');

        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerElem.textContent = '00:00';
            timerElem.style.color = '#a53b22';
            if (chip) { chip.style.background = '#f6ddd6'; chip.querySelector('.s3-timer-unit')?.style.setProperty('color', '#a53b22'); }
            return;
        }

        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        // 배너 초기값과 같은 HH:MM 포맷 유지
        timerElem.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        // 6시간 미만이면 임박(주황)으로 칩 전환
        if (hours < 6 && chip) {
            timerElem.style.color = '#b45309';
            chip.style.background = '#fbecd2';
            chip.querySelector('.s3-timer-unit')?.style.setProperty('color', '#b45309');
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

    // 한 줄 항목: 라벨 좌 / 값 우. 선 없이 여백으로만 나눈다.
    const row = (label, value, valueColor = '#1e293b', strong = false) => `
        <div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0;">
            <span class="pb-label" style="color: #64748b; font-size: 13px;">${label}</span>
            <span class="pb-value" style="font-weight: ${strong ? 700 : 600}; color: ${valueColor}; font-size: 13px; text-align: right;">${value}</span>
        </div>
    `;
    const note = (text) => `
        <div style="padding: 0 0 8px 0;">
            <p class="pb-note" style="font-size: 10px; color: #94a3b8; line-height: 1.5; margin: 0;">${text}</p>
        </div>
    `;

    const realPrice = (app.program_price || 1000000) - (app.discount_amount || 210000) + (app.correction_fee || 0);

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
            <div style="font-size:15px; font-weight:700; color:#1e293b; letter-spacing:-0.01em; margin:0 0 16px 0; display:flex; align-items:center; gap:8px;"><i class="fas fa-receipt" style="font-size:13px; color:#9c8ea0;"></i> 이용가 및 할인 내역</div>

            ${app.program_price ? row('정가', `${app.program_price.toLocaleString()}원`) : ''}
            ${app.discount_amount ? row('시험료 지원', `-${app.discount_amount.toLocaleString()}원`, '#2f855a') : ''}
            ${app.discount_amount ? note('※ 실제시험 2회 진행 및 점수 인증, 후기 1회 작성 조건이 포함되어있습니다.') : ''}
            ${app.correction_enabled && app.correction_fee ? row('스라첨삭 (Speaking &amp; Writing)', `+${app.correction_fee.toLocaleString()}원`, '#5b4a7d') : ''}
            ${row('실제 이용가', `${realPrice.toLocaleString()}원`)}
            ${app.additional_discount ? row('추가 할인', `-${app.additional_discount.toLocaleString()}원`, '#a53b22') : ''}
            ${app.discount_reason ? row('할인 사유', escapeHtml(app.discount_reason)) : ''}
            ${row('보증금 (환불)', '+100,000원', '#5b4a7d')}
            ${note('※ 과제 인증률에 따라 환불되는 금액입니다.')}

            ${app.final_price ? `
            <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 16px 18px; margin-top: 10px; background: #f3eef3; border-radius: 12px;">
                <span class="pb-final-label" style="color: #1e293b; font-size: 14px; font-weight: 700;">최종 입금금액</span>
                <span class="pb-final-value" style="font-weight: 700; color: #5b4a7d; font-size: 19px; letter-spacing: -0.02em;">${app.final_price.toLocaleString()}원</span>
            </div>
            <div style="padding: 14px 16px; background: #f6f8fa; border-radius: 10px; margin-top: 12px;">
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

    // STEP 2·3와 같은 라벤더 카드/배너/타이머 언어. 선·큰 그라데이션·2px 테두리 없음.
    const s4style = `
        <style>
            .s4-card { background:#ffffff; border-radius:16px; padding:24px 28px; box-shadow:0 2px 20px rgba(25,28,29,0.05); margin-bottom:14px; }
            .s4-card-title { font-size:15px; font-weight:700; color:#1e293b; letter-spacing:-0.01em; margin:0 0 16px 0; display:flex; align-items:center; gap:8px; }
            .s4-card-title i { font-size:13px; color:#9c8ea0; }
            .s4-lock { background:#ffffff; border-radius:16px; box-shadow:0 2px 20px rgba(25,28,29,0.05); padding:64px 24px; text-align:center; }
            .s4-lock-tile { width:60px; height:60px; border-radius:16px; background:#f0e9ef; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
            .s4-banner { background:#ffffff; border-radius:16px; box-shadow:0 2px 20px rgba(25,28,29,0.05); padding:20px 24px; margin-bottom:14px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
            .s4-banner-left { display:flex; align-items:center; gap:14px; flex:1; min-width:0; }
            .s4-banner-tile { width:46px; height:46px; border-radius:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
            .s4-banner-title { font-size:16px; font-weight:700; color:#1e293b; letter-spacing:-0.01em; }
            .s4-banner-sub { font-size:13px; color:#64748b; margin-top:3px; line-height:1.6; }
            .s4-timer-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:999px; flex-shrink:0; }
            .s4-timer-num { font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1; }
            .s4-timer-unit { font-size:11px; font-weight:600; }
            .s4-acct-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 2px; }
            .s4-acct-label { font-size:13px; color:#64748b; flex-shrink:0; }
            .s4-acct-value { font-size:15px; font-weight:700; color:#1e293b; text-align:right; }
            .s4-amount-box { text-align:center; padding:22px; background:#f6f4fb; border-radius:12px; }
            .s4-amount-num { font-size:28px; font-weight:700; color:#5b4a7d; letter-spacing:-0.02em; }
            .s4-input { width:100%; box-sizing:border-box; padding:12px 14px; border:none; background:#f1edf8; border-radius:10px; font-size:14px; color:#1e293b; font-family:inherit; transition:0.15s; }
            .s4-input:focus { outline:none; background:#ffffff; box-shadow:0 0 0 3px rgba(148,128,197,0.25); }
            .s4-btn { width:100%; padding:15px; background:#efeaf7; color:#5b4a7d; border:none; border-radius:12px; font-size:15px; font-weight:600; font-family:inherit; letter-spacing:-0.01em; cursor:pointer; transition:0.15s; }
            .s4-btn:hover { background:#e5ddf3; }
            .s4-note { font-size:12px; color:#94a3b8; line-height:1.7; }
            /* 펼침 영역 안의 공용 가격 카드(getPricingBox)를 이 컨테이너의 일부처럼: 카드 크롬 제거 */
            #s4-breakdown > div { box-shadow:none !important; margin:0 !important; border-radius:0 !important; background:transparent !important; padding:0 !important; }
            .s4-fold-head { display:flex; align-items:center; gap:14px; width:100%; border:none; background:transparent; text-align:left; cursor:pointer; font-family:inherit; padding:22px 26px; }
            .s4-fold-body { display:none; padding:2px 26px 22px; }
            @media (max-width:768px) {
                .s4-fold-head { padding:18px; }
                .s4-fold-body { padding:2px 18px 18px; }
                .s4-card { padding:20px 18px; border-radius:14px; }
                .s4-banner { padding:18px; }
                .s4-amount-num { font-size:24px; }
            }
        </style>
    `;

    // 계약이 완료되지 않았으면 → 잠금 대기
    if (!app.contract_agreed) {
        paymentContent.innerHTML = `
            ${s4style}
            <div class="s4-lock">
                <div class="s4-lock-tile"><i class="fas fa-lock" style="font-size:26px; color:#b3a0b8;"></i></div>
                <h3 style="font-size:18px; font-weight:700; color:#1e293b; margin-bottom:10px;">입금 안내 대기 중</h3>
                <p style="font-size:14px; color:#64748b; line-height:1.8;">
                    계약서에 동의하시면 입금 안내가 표시됩니다.<br>
                    먼저 계약서 탭에서 계약에 동의해 주세요.
                </p>
            </div>
        `;
        return;
    }

    // 입금 완료 확인되었으면 → 초록 배너
    if (app.deposit_confirmed_by_admin) {
        paymentContent.innerHTML = `
            ${s4style}
            <div class="s4-banner" style="background:#f2f8f4;">
                <div class="s4-banner-left">
                    <div class="s4-banner-tile" style="background:#dcf0e3;"><i class="fas fa-circle-check" style="color:#2f855a; font-size:20px;"></i></div>
                    <div>
                        <div class="s4-banner-title">입금 확인 완료</div>
                        <div class="s4-banner-sub">${new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR')}에 입금이 확인되었습니다 · 곧 이용 방법 안내가 발송됩니다.</div>
                    </div>
                </div>
            </div>

            ${getPricingBox(app, false)}
        `;
        return;
    }

    // 학생이 입금 완료 버튼을 눌렀으면
    if (app.deposit_confirmed_by_student) {
        // 카톡으로 보낼 인사 메시지 (프로그램 트랙명 " - Fast/Standard"은 제외)
        const progBase = (app.assigned_program || app.program || '').split(' - ')[0].trim();
        const kakaoMsg = `안녕하세요! ${progBase ? progBase + ' ' : ''}신청한 ${app.name || ''}입니다 :)`;
        paymentContent.innerHTML = `
            ${s4style}
            <div class="s4-banner" style="background:#fbf6ec;">
                <div class="s4-banner-left">
                    <div class="s4-banner-tile" style="background:#fbecd2;"><i class="fas fa-clock" style="color:#b45309; font-size:18px;"></i></div>
                    <div>
                        <div class="s4-banner-title">입금 확인 대기 중</div>
                        <div class="s4-banner-sub">${new Date(app.deposit_confirmed_by_student_at).toLocaleString('ko-KR')}에 입금 완료 알림을 보내셨습니다 · 관리자가 확인 후 이용 방법을 안내드립니다.</div>
                    </div>
                </div>
            </div>

            <div class="s4-card">
                <div class="s4-card-title"><i class="fas fa-comment"></i> 마지막 단계예요!</div>
                <p style="font-size:14px; color:#64748b; margin:0 0 18px 0; line-height:1.75;">
                    이제 정식 수강생이 되셨어요. 앞으로는 카카오톡 채널로 소통하게 되니, 아래 <strong style="color:#1e293b;">성함을 채널로 보내 인사를 남겨주세요.</strong> 이 과정까지 마쳐야 신청이 완료됩니다.
                </p>
                <div style="font-size:12px; font-weight:600; color:#64748b; margin-bottom:8px;">보낼 내용</div>
                <div style="display:flex; align-items:stretch; gap:8px; margin-bottom:18px;">
                    <div style="flex:1; background:#f6f4fb; border-radius:10px; padding:14px 16px; font-size:14px; color:#1e293b; line-height:1.5;">${kakaoMsg}</div>
                    <button type="button" onclick="copyKakaoMsg(this)" data-msg="${kakaoMsg.replace(/"/g, '&quot;')}" style="flex-shrink:0; background:#efeaf7; border:none; border-radius:10px; padding:0 18px; font-size:13px; font-weight:600; color:#5b4a7d; cursor:pointer; white-space:nowrap; font-family:inherit;">복사</button>
                </div>
                <a href="http://pf.kakao.com/_FWxcZC" target="_blank" rel="noopener" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; box-sizing:border-box; background:#FEE500; color:#3c1e1e; font-size:15px; font-weight:700; padding:15px; border-radius:12px; text-decoration:none;">
                    <i class="fas fa-comment"></i> 카카오톡으로 성함 남기기
                </a>
            </div>

            ${paymentInfoHtml}
        `;
        return;
    }

    // 입금 안내 표시
    // 입금 데드라인 계산: deposit_deadline_override가 있으면 해당 값, 없으면 계약 동의 후 24시간
    let deadlineHTML = '';
    if (app.contract_agreed_at) {
        let deadlineMs;
        let deadlineLabel;
        if (app.deposit_deadline_override) {
            // 관리자가 지정한 입금 기한
            deadlineMs = new Date(app.deposit_deadline_override).getTime();
            const deadlineDate = new Date(app.deposit_deadline_override);
            deadlineLabel = deadlineDate.toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
                month: 'long', day: 'numeric',
                weekday: 'short',
                hour: '2-digit', minute: '2-digit', hour12: false
            });
        } else {
            // 기본: 계약 동의 후 24시간
            deadlineMs = new Date(app.contract_agreed_at).getTime() + (24 * 60 * 60 * 1000);
            deadlineLabel = null; // 24시간 표현 사용
        }

        const now = Date.now();
        const remaining = deadlineMs - now;

        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

        // 만료=코랄 / 임박(6h 이하)=주황 / 평상시=라벤더 (STEP 3와 동일 톤)
        const isExpired = remaining <= 0;
        const isUrgent = !isExpired && hours < 6;
        const chipColor = isExpired ? '#a53b22' : (isUrgent ? '#b45309' : '#5b4a7d');
        const chipBg = isExpired ? '#f6ddd6' : (isUrgent ? '#fbecd2' : '#ece4f2');
        const tileBg = chipBg;

        if (isExpired) {
            // 만료 → 코랄 배너, 타이머 칩 없음
            deadlineHTML = `
                <div class="s4-banner" style="background:#f9edea;">
                    <div class="s4-banner-left">
                        <div class="s4-banner-tile" style="background:#f6ddd6;"><i class="fas fa-triangle-exclamation" style="color:#a53b22; font-size:18px;"></i></div>
                        <div>
                            <div class="s4-banner-title">입금 기한 초과</div>
                            <div class="s4-banner-sub">입금 기한이 지났습니다. 빠른 입금 부탁드립니다.</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 기한 안내 텍스트: override가 있으면 날짜 표시, 없으면 24시간 표현
            const deadlineNotice = deadlineLabel
                ? `<strong style="color:${chipColor};">${deadlineLabel}</strong>까지 입금을 완료해주세요.`
                : `계약 동의 후 <strong style="color:${chipColor};">24시간 이내</strong>에 입금을 완료해주세요.`;
            // 계약서 탭(STEP 3 동의 기한 배너)과 동일 구조: 타일 + [제목+칩 한 줄] + 하단 안내
            deadlineHTML = `
                <div class="s4-banner">
                    <div class="s4-banner-tile" style="background:${tileBg};"><i class="fas fa-clock" style="color:${chipColor}; font-size:17px;"></i></div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <div class="s4-banner-title">입금 기한</div>
                            <div class="s4-timer-chip" style="background:${chipBg};">
                                <span id="paymentTimer" class="s4-timer-num" style="color:${chipColor};">${String(Math.max(0, hours)).padStart(2, '0')}:${String(Math.max(0, minutes)).padStart(2, '0')}</span>
                                <span class="s4-timer-unit" style="color:${chipColor};">남음</span>
                            </div>
                        </div>
                        <div class="s4-banner-sub" style="margin-top:4px;">${deadlineNotice}</div>
                    </div>
                </div>
            `;
        }
    }

    paymentContent.innerHTML = s4style + deadlineHTML + paymentInfoHtml + `
        <div class="s4-card">
            <div class="s4-card-title"><i class="fas fa-circle-check"></i> 입금 완료 확인</div>
            <p style="font-size:13px; color:#64748b; margin:0 0 18px 0; line-height:1.7;">
                위 계좌로 입금을 완료하셨다면 입금자명을 확인하고 버튼을 눌러 주세요. 관리자가 입금을 확인한 후 이용 방법 안내를 보내드립니다.
            </p>
            <label for="depositorName" style="display:block; font-size:13px; font-weight:600; color:#1e293b; margin-bottom:8px;">
                입금자명 <span style="color:#a53b22;">*</span>
            </label>
            <input type="text" id="depositorName" value="${app.name || ''}" placeholder="실제 입금하신 분의 성함" class="s4-input">
            <p class="s4-note" style="margin:8px 0 18px 0;">
                본인이 직접 입금하셨으면 그대로 두시고, 다른 분(부모님·배우자 등)이 입금하셨으면 실제 입금자명으로 수정해 주세요.
            </p>
            <button onclick="confirmDeposit()" class="s4-btn">
                <i class="fas fa-circle-check" style="margin-right:7px;"></i> 입금 완료했습니다
            </button>
            <p class="s4-note" style="text-align:center; margin:14px 0 0 0;">
                관리자가 입금을 확인하면 이용 방법 안내가 발송됩니다.<br>
                입금 관련 문의는 <a href="http://pf.kakao.com/_FWxcZC/chat" target="_blank" rel="noopener" style="color:#5b4a7d; font-weight:600; text-decoration:underline;">카카오톡</a>으로 해주세요.
            </p>
        </div>
    `;
    
    // 실시간 카운트다운 시작
    if (app.contract_agreed_at) {
        // deposit_deadline_override가 있으면 해당 값, 없으면 contract_agreed_at + 24시간
        const paymentDeadlineMs = app.deposit_deadline_override
            ? new Date(app.deposit_deadline_override).getTime()
            : new Date(app.contract_agreed_at).getTime() + (24 * 60 * 60 * 1000);
        
        const updatePaymentTimer = () => {
            const now = Date.now();
            const remaining = paymentDeadlineMs - now;
            
            const timerEl = document.getElementById('paymentTimer');
            if (!timerEl) return;
            
            if (remaining <= 0) {
                timerEl.textContent = '00:00';
                return;
            }

            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

            // 계약서 탭과 동일하게 HH:MM 표기
            timerEl.textContent =
                String(Math.max(0, hours)).padStart(2, '0') + ':' +
                String(Math.max(0, minutes)).padStart(2, '0');
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
        <!-- 입금 정보: 어디로 + 얼마를 한 카드로 -->
        <div class="s4-card">
            <div class="s4-card-title"><i class="fas fa-building-columns"></i> 입금 정보</div>
            <div class="s4-acct-row">
                <span class="s4-acct-label">은행</span>
                <span class="s4-acct-value">${bankName}</span>
            </div>
            <div class="s4-acct-row">
                <span class="s4-acct-label">계좌번호</span>
                <span class="s4-acct-value">
                    <span style="letter-spacing:0.3px; word-break:break-all;">${accountNumber}</span>
                    <i class="fas fa-copy" onclick="copyToClipboard('${accountNumber}', '계좌번호')"
                       style="margin-left:8px; font-size:13px; color:#9480c5; cursor:pointer; vertical-align:middle;"
                       title="계좌번호 복사"></i>
                </span>
            </div>
            <div class="s4-acct-row" style="border-bottom:0;">
                <span class="s4-acct-label">예금주</span>
                <span class="s4-acct-value">${accountHolder}</span>
            </div>

            <div class="s4-amount-box" style="margin-top:14px;">
                <p style="margin:0 0 8px 0; font-size:13px; color:#64748b;">최종 입금 금액</p>
                <p class="s4-amount-num" style="margin:0;">${(app.final_price || 0).toLocaleString()}원</p>
            </div>
            <div style="background:#fbf6ec; padding:12px 16px; border-radius:10px; margin-top:12px;">
                <p style="font-size:12px; color:#8a6d1f; margin:0; text-align:center; line-height:1.7; font-weight:600;">
                    위 금액과 <strong>동일하게</strong> 입금해 주세요
                    <span style="display:block; font-size:11px; font-weight:400; color:#a08a4a; margin-top:2px;">입금액이 다를 경우 확인이 지연될 수 있습니다</span>
                </p>
            </div>
            <p class="s4-note" style="margin:12px 0 0 0; text-align:center;">
                보증금 100,000원 포함 · 과제 인증률에 따라 최대 100,000원 환급<br>
                <span style="font-size:11px;">(70% 미만 0원 / 70~94% 부분 환급 / 95% 이상 전액 환급)</span>
            </p>
        </div>

        <!-- 금액 산정 내역: 헤더(토글) + 펼침 영역이 하나의 카드. 입금 정보 다음 순서, 기본 접힘 -->
        <div class="s4-card" style="padding:0; overflow:hidden;">
            <button type="button" class="s4-fold-head" onclick="var d=document.getElementById('s4-breakdown'); var open=getComputedStyle(d).display==='none'; d.style.display=open?'block':'none'; this.querySelector('.s4-bd-chev').style.transform=open?'rotate(180deg)':'';">
                <span style="width:40px; height:40px; border-radius:11px; background:#ece4f2; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i class="fas fa-receipt" style="color:#5b4a7d; font-size:16px;"></i>
                </span>
                <span style="flex:1;">
                    <span style="display:block; font-size:15px; font-weight:700; color:#3b2d5c; word-break:keep-all;">이 금액은 어떻게 산정되었나요?</span>
                    <span style="display:block; font-size:12px; color:#94a3b8; margin-top:3px;">정가 · 시험료 지원 · 첨삭 · 보증금 내역 보기</span>
                </span>
                <i class="fas fa-chevron-down s4-bd-chev" style="color:#9480c5; font-size:14px; transition:0.2s; flex-shrink:0;"></i>
            </button>
            <div id="s4-breakdown" class="s4-fold-body">
                ${getPricingBox(app, false)}
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

        alert('✅ 입금 완료 알림이 전송되었습니다!\n\n📩 이제 정식 수강생이 되셨어요! 카카오톡 채널에 성함을 보내주시면 신청이 완료돼요.\n\n바로 이어서 도와드릴게요!');

        // 페이지 새로고침
        location.reload();

    } catch (error) {
        console.error('Error:', error);
        alert('입금 완료 알림 전송 중 오류가 발생했습니다.');
    }
}

// 입금 대기 카드: 카톡 인사 메시지 복사
function copyKakaoMsg(btn) {
    const msg = btn.getAttribute('data-msg') || '';
    const done = () => {
        const orig = btn.textContent;
        btn.textContent = '복사됨!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(msg).then(done).catch(() => fallbackCopy(msg, done));
    } else {
        fallbackCopy(msg, done);
    }
}

function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done && done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
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
    const platformUrl = settings?.platform_url || DEFAULT_PLATFORM_URL;
    const platformLoginGuide = settings?.platform_login_guide || '이메일로 발송된 비밀번호를 사용하세요';
    const kakaoLink = settings?.kakao_link || 'https://business.kakao.com/_FWxcZC/chats';
    
    // DB 기반 이용방법 안내 텍스트
    const necessitiesText = settings?.necessities_text || '';
    const refundWarning = settings?.refund_warning || '';
    const nextActions = settings?.next_actions || '';
    const communicationGuide = settings?.communication_guide || '';
    const usageGuideUrl = settings?.usage_guide_url || 'usage-guide.html';
    
    // 과정 트랙에 따른 가이드 타입 결정
    const guideType = app.course_track === 'australia' ? 'nevelupaustralia' : 'challenge';
    const guideLabel = app.course_track === 'australia' ? '내벨업챌린지 Australia' : '내벨업챌린지';
    
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

    // 입금이 확인되지 않았으면 → 잠금 대기 (STEP 3·4와 같은 흰 카드 잠금 언어)
    if (!app.deposit_confirmed_by_admin) {
        usageContent.innerHTML = `
            <style>
                .s5-lock { background:#ffffff; border-radius:16px; box-shadow:0 2px 20px rgba(25,28,29,0.05); padding:64px 24px; text-align:center; }
                .s5-lock-tile { width:60px; height:60px; border-radius:16px; background:#f0e9ef; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
                @media (max-width:768px) { .s5-lock { padding:48px 20px; border-radius:14px; } }
            </style>
            <div class="s5-lock">
                <div class="s5-lock-tile"><i class="fas fa-lock" style="font-size:26px; color:#b3a0b8;"></i></div>
                <h3 style="font-size:18px; font-weight:700; color:#1e293b; margin-bottom:10px;">이용 방법 대기 중</h3>
                <p style="font-size:14px; color:#64748b; line-height:1.8;">
                    입금이 확인되면 이용 방법이 이곳에 표시됩니다.<br>
                    조금만 기다려 주세요.
                </p>
            </div>
        `;
        return;
    }

    // 이용방법이 전달되지 않았으면 (관리자가 아직 안 보냄) → 준비 중 대기
    // 입금은 확인된 긍정 마일스톤이라 잠금(회색)과 구분되게 라벤더 톤 타일 사용
    if (!app.guide_sent) {
        usageContent.innerHTML = `
            <style>
                .s5-wait { background:#ffffff; border-radius:16px; box-shadow:0 2px 20px rgba(25,28,29,0.05); padding:64px 24px; text-align:center; }
                .s5-wait-tile { width:60px; height:60px; border-radius:16px; background:#ece4f2; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
                @media (max-width:768px) { .s5-wait { padding:48px 20px; border-radius:14px; } }
            </style>
            <div class="s5-wait">
                <div class="s5-wait-tile"><i class="fas fa-hourglass-half" style="font-size:24px; color:#5b4a7d;"></i></div>
                <h3 style="font-size:18px; font-weight:700; color:#1e293b; margin-bottom:10px;">이용 방법 준비 중</h3>
                <p style="font-size:14px; color:#64748b; line-height:1.8;">
                    입금이 확인되었습니다. 관리자가 이용 방법을 준비하고 있어요.<br>
                    준비되는 대로 이곳에 안내드릴게요.
                </p>
            </div>
        `;
        return;
    }

    // 이용방법 (STEP 9) — STEP 2·3·4와 같은 라벤더 카드 언어. 무지개색·2px 테두리·그라데이션 제거.
    const showShippingNext = !globalApplication.shipping_completed && !globalApplication.shipping_waived;
    usageContent.innerHTML = `
        <style>
            .s5-card { background:#ffffff; border-radius:16px; padding:24px 28px; box-shadow:0 2px 20px rgba(25,28,29,0.05); margin-bottom:14px; }
            .s5-card-title { font-size:15px; font-weight:700; color:#1e293b; letter-spacing:-0.01em; margin:0 0 16px 0; display:flex; align-items:center; gap:8px; }
            .s5-card-title i { font-size:13px; color:#9c8ea0; }
            .s5-row { display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:8px 0; }
            .s5-row-label { font-size:14px; color:#64748b; flex-shrink:0; }
            .s5-row-value { font-size:15px; font-weight:600; color:#1e293b; text-align:right; }
            .s5-field { background:#f6f4fb; border-radius:12px; padding:16px 18px; }
            .s5-field-label { font-size:12px; color:#94a3b8; margin:0 0 6px 0; }
            .s5-field-value { font-size:15px; font-weight:600; color:#1e293b; margin:0; word-break:break-all; }
            .s5-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
            /* DESIGN.md: 채도 높은 solid·꽉찬 폭 금지. 톤다운 배경 + 라벤더 텍스트, 콘텐츠 폭. */
            .s5-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:11px 22px; border-radius:10px; font-size:14px; font-weight:600; font-family:inherit; letter-spacing:-0.01em; text-decoration:none; cursor:pointer; transition:0.15s; border:none; background:#efeaf7; color:#5b4a7d; }
            .s5-btn i { font-size:13px; }
            .s5-btn:hover { background:#e5ddf3; }
            .s5-guide { background:#ffffff; border-radius:16px; box-shadow:0 2px 20px rgba(25,28,29,0.05); padding:8px; margin-bottom:14px; }
            .s5-guide-row { display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:12px; text-decoration:none; transition:0.15s; }
            .s5-guide-row:hover { background:#f6f4fb; }
            .s5-guide-tile { width:38px; height:38px; border-radius:10px; background:#ece4f2; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
            .s5-guide-tile i { color:#5b4a7d; font-size:15px; }
            .s5-guide-label { flex:1; font-size:14.5px; font-weight:600; color:#3b2d5c; word-break:keep-all; }
            .s5-guide-label span { font-weight:500; color:#94a3b8; font-size:13px; }
            .s5-guide-row .s5-guide-chev { color:#b3a0d8; font-size:12px; flex-shrink:0; }
            .s5-pre { font-family:'Pretendard', sans-serif; font-size:14px; color:#3b2d5c; line-height:1.85; margin:0; white-space:pre-wrap; word-wrap:break-word; }
            @media (max-width:768px) {
                .s5-card { padding:20px 18px; border-radius:14px; }
                .s5-grid2 { grid-template-columns:1fr; }
                .s5-row { flex-direction:column; align-items:flex-start; gap:3px; }
                .s5-row-value { text-align:left; }
            }
        </style>

        <!-- 1. 개인화: 프로그램·시작일 요약 (이름은 인사로 흡수) -->
        <div class="s5-card">
            <div class="s5-card-title"><i class="fas fa-book-open"></i> ${guideLabel} 이용 방법</div>
            <p style="font-size:14px; color:#64748b; margin:-4px 0 14px 0; line-height:1.6;">${app.name}님,<br>아래 순서대로 확인하고 시작해주세요.</p>
            <div class="s5-row">
                <span class="s5-row-label">${guideLabel}</span>
                <span class="s5-row-value" style="color:#5b4a7d;">${app.assigned_program || '-'} · ${formatDateWithDay(app.schedule_start)} 시작</span>
            </div>
            ${app.correction_enabled ? `
            <div class="s5-row">
                <span class="s5-row-label">스라첨삭</span>
                <span class="s5-row-value" style="color:#5b4a7d;">${formatDateWithDay(app.correction_start_date)} 시작</span>
            </div>` : ''}
        </div>

        <!-- 2. 이제 할 일 (가장 중요 → 상단으로) -->
        ${nextActions ? `
        <div class="s5-card">
            <div class="s5-card-title"><i class="fas fa-bullseye"></i> 이제 무엇을 하면 되나요?</div>
            <pre class="s5-pre">${replaceVars(nextActions)}</pre>
        </div>` : ''}

        <!-- 3. 플랫폼 접속 + 지금 로그인 (진짜 주 행동 → 버튼으로 강조) -->
        <div class="s5-card">
            <div class="s5-card-title"><i class="fas fa-globe"></i> 플랫폼 접속 정보</div>
            <div class="s5-field" style="margin-bottom:12px;">
                <p class="s5-field-label">접속 URL</p>
                <a href="${platformUrl}" target="_blank" style="font-size:15px; font-weight:700; color:#5b4a7d; text-decoration:none; word-break:break-all;">${platformUrl}</a>
                ${app.challenge_access_granted ? `
                <div style="display:flex; align-items:center; gap:8px; background:#eaf5ee; border-radius:9px; padding:10px 12px; margin-top:12px;">
                    <i class="fas fa-circle-check" style="color:#2f855a; font-size:13px; flex-shrink:0;"></i>
                    <span style="font-size:13px; color:#2f855a; font-weight:600;">테스트룸 액세스 완료 · 지금 바로 로그인할 수 있어요.</span>
                </div>` : ''}
                <div style="margin-top:12px;">
                    <a href="${platformUrl}" target="_blank" class="s5-btn" style="background:#ffffff;">
                        <i class="fas fa-arrow-right-to-bracket"></i> 지금 로그인하기
                    </a>
                </div>
            </div>
            <div class="s5-grid2">
                <div class="s5-field">
                    <p class="s5-field-label">로그인 ID</p>
                    <p class="s5-field-value">${app.email}</p>
                </div>
                <div class="s5-field">
                    <p class="s5-field-label">비밀번호</p>
                    <p class="s5-field-value">${platformLoginGuide}</p>
                </div>
            </div>
        </div>

        <!-- 4. 상세 가이드 링크 (차분한 메뉴 행) -->
        ${(usageGuideUrl || app.correction_enabled) ? `
        <div class="s5-guide">
            ${usageGuideUrl ? `
            <a href="usage-guide.html?type=${guideType}" target="_blank" class="s5-guide-row">
                <span class="s5-guide-tile"><i class="fas fa-book"></i></span>
                <span class="s5-guide-label">${guideLabel} 이용방법 <span>자세히 보기</span></span>
                <i class="fas fa-chevron-right s5-guide-chev"></i>
            </a>` : ''}
            ${app.correction_enabled ? `
            <a href="usage-guide.html?type=correction" target="_blank" class="s5-guide-row">
                <span class="s5-guide-tile"><i class="fas fa-pen"></i></span>
                <span class="s5-guide-label">첨삭 이용방법 <span>자세히 보기</span></span>
                <i class="fas fa-chevron-right s5-guide-chev"></i>
            </a>` : ''}
        </div>` : ''}

        <!-- 5. 준비물 -->
        ${necessitiesText ? `
        <div class="s5-card">
            <div class="s5-card-title"><i class="fas fa-clipboard-check"></i> 이용 전 준비물 (Necessities)</div>
            <pre class="s5-pre">${replaceVars(necessitiesText)}</pre>
        </div>` : ''}

        <!-- 6. 앞으로의 소통 -->
        ${communicationGuide ? `
        <div class="s5-card">
            <div class="s5-card-title"><i class="fas fa-comments"></i> 앞으로의 소통</div>
            <pre class="s5-pre">${replaceVars(communicationGuide)}</pre>
        </div>` : ''}

        <!-- 7. 대시보드 이동 (배송 안내 통합 send-off) -->
        <div class="s5-card" style="text-align:center;">
            <div style="font-size:16px; font-weight:700; color:#3b2d5c; margin-bottom:6px;">모든 준비가 완료됐어요</div>
            <p style="font-size:13px; color:#64748b; line-height:1.7; margin:0 0 16px 0;">진행 상황과 프로그램 정보를 대시보드에서 한눈에 확인하세요.${showShippingNext ? '<br>실물 교재 배송 상태·운송장 번호도 대시보드에서 볼 수 있어요.' : ''}</p>
            <a href="my-dashboard.html" class="s5-btn">
                <i class="fas fa-gauge-high"></i> 대시보드로 이동
            </a>
        </div>

        <!-- 8. 참고: 환불 불가 조건 (이미 계약서에서 동의 → 맨 아래 차분한 참고) -->
        ${refundWarning ? `
        <div class="s5-card" style="margin-bottom:0;">
            <div class="s5-card-title" style="color:#a53b22;"><i class="fas fa-circle-info" style="color:#a53b22;"></i> 참고 · 환불 불가 조건</div>
            <pre class="s5-pre" style="color:#64748b;">${replaceVars(refundWarning)}</pre>
        </div>` : ''}
    `;
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
