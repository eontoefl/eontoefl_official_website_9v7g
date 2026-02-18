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
 * 사이트 설정 조회 함수
 * @returns {Promise<Object|null>} 사이트 설정 객체 또는 null
 */
async function getSiteSettings() {
    try {
        const response = await fetch('tables/site_settings/default');
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('Failed to get site settings:', error);
        return null;
    }
}
