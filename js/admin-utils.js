// Admin Utility Functions
// 관리자 인증 및 유틸리티 함수 모음

/**
 * 현재 로그인한 사용자가 관리자인지 확인
 * @returns {boolean} 관리자 여부
 */
function isAdmin() {
    const user = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
    return user.role === 'admin';
}

/**
 * 관리자 페이지 접근 권한 체크 (페이지 로드 시 호출)
 * 관리자가 아니면 홈으로 리다이렉트
 */
function requireAdmin() {
    if (!isAdmin()) {
        alert('⛔ 관리자만 접근 가능한 페이지입니다.');
        location.href = 'index.html';
    }
}

/**
 * 이름 마스킹 처리
 * @param {string} name - 원본 이름
 * @param {boolean} forceShow - 강제로 전체 이름 표시 (관리자용)
 * @returns {string} 마스킹된 이름 또는 원본 이름
 */
function maskName(name, forceShow = false) {
    // 관리자이거나 강제 표시 옵션이 있으면 본명 반환
    if (forceShow || isAdmin()) {
        return name || '-';
    }
    
    // 일반 사용자/비회원: 마스킹 처리
    if (!name || name.length === 0) return '-';
    if (name.length === 1) return name;
    if (name.length === 2) return name[0] + '*';
    
    // 3글자 이상: 김*플, 홍*동 형태
    return name[0] + '*' + name[name.length - 1];
}

/**
 * 관리자 정보 가져오기
 * @returns {Object} 관리자 정보
 */
function getAdminInfo() {
    const user = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
    return {
        name: user.name || '관리자',
        email: user.email || '',
        isAdmin: user.role === 'admin'
    };
}

/**
 * 로그인 여부 확인
 * @returns {boolean} 로그인 여부
 */
function isLoggedIn() {
    const user = localStorage.getItem('iontoefl_user');
    return !!user;
}

/**
 * 현재 로그인한 사용자 정보 가져오기
 * @returns {Object|null} 사용자 정보 또는 null
 */
function getLoggedInUser() {
    const userStr = localStorage.getItem('iontoefl_user');
    if (!userStr) return null;
    try {
        return JSON.parse(userStr);
    } catch (e) {
        return null;
    }
}

/**
 * 날짜 포맷팅 (한국어)
 * @param {number} timestamp - 밀리초 타임스탬프
 * @returns {string} 포맷된 날짜 문자열
 */
function formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 날짜만 포맷팅 (시간 제외)
 * @param {number} timestamp - 밀리초 타임스탬프
 * @returns {string} 포맷된 날짜 문자열
 */
function formatDateOnly(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 상대적 시간 표시 (방금 전, 3일 전 등)
 * @param {number} timestamp - 밀리초 타임스탬프
 * @returns {string} 상대적 시간 문자열
 */
function getRelativeTime(timestamp) {
    if (!timestamp) return '-';
    
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    
    return formatDateOnly(timestamp);
}

/**
 * 상태 배지 HTML 생성
 * @param {string} status - 상태값
 * @returns {string} HTML 문자열
 */
function getStatusBadge(status) {
    const statusMap = {
        '접수완료': { class: 'status-pending', icon: 'clock', text: '접수완료' },
        '검토중': { class: 'status-review', icon: 'search', text: '검토중' },
        '승인': { class: 'status-approved', icon: 'check-circle', text: '승인' },
        '거부': { class: 'status-rejected', icon: 'times-circle', text: '거부' },
        '보류': { class: 'status-hold', icon: 'pause-circle', text: '보류' }
    };
    
    const info = statusMap[status] || statusMap['접수완료'];
    return `
        <span class="status-badge ${info.class}">
            <i class="fas fa-${info.icon}"></i> ${info.text}
        </span>
    `;
}

/**
 * HTML 이스케이프 처리
 * @param {string} str - 원본 문자열
 * @returns {string} 이스케이프된 문자열
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 경과 일수 계산
 * @param {number} timestamp - 밀리초 타임스탬프
 * @returns {number} 경과 일수
 */
function getDaysAgo(timestamp) {
    if (!timestamp) return 0;
    const now = Date.now();
    const diff = now - timestamp;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * 전화번호 포맷팅
 * @param {string} phone - 원본 전화번호
 * @returns {string} 포맷된 전화번호
 */
function formatPhone(phone) {
    if (!phone) return '-';
    // 010-1234-5678 형태로 변환
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length === 11) {
        return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
}

/**
 * 날짜 + 요일 포맷팅 (예: 2026-03-01 (일))
 * @param {string|number} dateInput - 날짜 문자열 또는 타임스탬프
 * @returns {string} 포맷된 날짜 + 요일
 */
function formatDateWithDay(dateInput) {
    if (!dateInput) return '-';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '-';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = days[date.getDay()];
    return `${year}-${month}-${day} (${dayName})`;
}

/**
 * D-Day 계산 (예: D-3, D-DAY, D+2)
 * @param {string|number} dateInput - 시작일 문자열 또는 타임스탬프
 * @returns {string} D-Day HTML 문자열
 */
function getDday(dateInput) {
    if (!dateInput) return '';
    const target = new Date(dateInput);
    if (isNaN(target.getTime())) return '';
    const today = new Date();
    // 날짜만 비교 (시간 제거)
    const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((targetDate - todayDate) / (1000 * 60 * 60 * 24));
    
    if (diff === 0) {
        return '<span style="color:#ef4444; font-weight:700;">D-DAY</span>';
    } else if (diff > 0) {
        return `<span style="color:#7c3aed; font-weight:600;">D-${diff}</span>`;
    } else {
        return `<span style="color:#94a3b8; font-weight:500;">D+${Math.abs(diff)}</span>`;
    }
}

/**
 * 사이트 설정 조회 함수
 * @returns {Promise<Object|null>} 사이트 설정 객체 또는 null
 */
async function getSiteSettings() {
    try {
        const result = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        if (result && result.length > 0) {
            return result[0];
        }
        return null;
    } catch (error) {
        console.error('Failed to get site settings:', error);
        return null;
    }
}

/**
 * 남은 기간을 "X달 X주 남음" 형태로 반환
 * @param {string} dateStr - 날짜 문자열 (예: "2026-10", "2026-05-10")
 * @returns {string} 남은 기간 HTML 문자열
 */
function getRemainingPeriod(dateStr) {
    if (!dateStr) return '';
    
    // "2026-10" 같은 월만 있는 경우 → 해당 월 말일로 처리
    let targetDate;
    if (/^\d{4}-\d{2}$/.test(dateStr)) {
        const [year, month] = dateStr.split('-').map(Number);
        targetDate = new Date(year, month, 0); // 해당 월의 마지막 날
    } else {
        targetDate = new Date(dateStr);
    }
    
    if (isNaN(targetDate.getTime())) return '';
    
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    
    const diffDays = Math.round((target - todayDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return '<span style="color:#ef4444; font-weight:600;">마감</span>';
    if (diffDays === 0) return '<span style="color:#ef4444; font-weight:700;">오늘 마감</span>';
    
    const months = Math.floor(diffDays / 30);
    const weeks = Math.floor((diffDays % 30) / 7);
    
    let text = '';
    if (months > 0) text += `${months}달 `;
    if (weeks > 0) text += `${weeks}주 `;
    if (months === 0 && weeks === 0) text = `${diffDays}일 `;
    text += '남음';
    
    // 색상: 1달 이내 빨강, 2달 이내 주황, 그 외 초록
    let color = '#22c55e';
    if (diffDays <= 30) color = '#ef4444';
    else if (diffDays <= 60) color = '#f59e0b';
    
    return `<span style="color:${color}; font-weight:600; font-size:11px;">${text}</span>`;
}

/**
 * 목표기한 표시 (submission_deadline 우선, 지났으면 preferred_completion)
 * @param {Object} app - 신청서 객체
 * @returns {string} HTML 문자열
 */
function getDeadlineDisplay(app) {
    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // submission_deadline 파싱
    let sdDate = null;
    if (app.submission_deadline) {
        if (/^\d{4}-\d{2}$/.test(app.submission_deadline)) {
            const [y, m] = app.submission_deadline.split('-').map(Number);
            sdDate = new Date(y, m, 0);
        } else {
            sdDate = new Date(app.submission_deadline);
        }
    }
    
    // submission_deadline이 아직 안 지났으면
    if (sdDate && sdDate >= todayDate) {
        return `<div style="font-size:13px; color:#1e293b;">${escapeHtml(app.submission_deadline)}</div>
                <div style="margin-top:2px;">${getRemainingPeriod(app.submission_deadline)}</div>`;
    }
    
    // 지났으면 preferred_completion으로 전환
    if (app.preferred_completion) {
        let pcDate = null;
        if (/^\d{4}-\d{2}$/.test(app.preferred_completion)) {
            const [y, m] = app.preferred_completion.split('-').map(Number);
            pcDate = new Date(y, m, 0);
        } else {
            pcDate = new Date(app.preferred_completion);
        }
        
        return `<div style="font-size:13px; color:#1e293b;">${escapeHtml(app.preferred_completion)}</div>
                <div style="margin-top:2px;">${getRemainingPeriod(app.preferred_completion)}</div>`;
    }
    
    // 둘 다 없거나 둘 다 지남
    if (sdDate) {
        return `<div style="font-size:13px; color:#94a3b8;">${escapeHtml(app.submission_deadline)}</div>
                <div style="margin-top:2px;">${getRemainingPeriod(app.submission_deadline)}</div>`;
    }
    
    return '<span style="color:#94a3b8;">-</span>';
}

/**
 * 점수 표시 (현재 → 목표)
 * @param {Object} app - 신청서 객체
 * @returns {string} HTML 문자열
 */
function getScoreDisplay(app) {
    const current = app.score_total_old || app.score_total_new || null;
    const target = app.target_cutoff_old || app.target_cutoff_new || null;
    
    const currentText = current ? current : '없음';
    // new 점수는 소수점 포함 가능 (예: 4.0)
    let targetText = '없음';
    if (target !== null && target !== undefined) {
        targetText = Number.isInteger(Number(target)) && !app.target_cutoff_new ? String(target) : String(target);
    }
    
    const currentColor = current ? '#1e293b' : '#94a3b8';
    const targetColor = target ? '#7c3aed' : '#94a3b8';
    
    return `<span style="color:${currentColor}; font-weight:600;">${currentText}</span>
            <span style="color:#94a3b8; margin:0 2px;">→</span>
            <span style="color:${targetColor}; font-weight:600;">${targetText}</span>`;
}
