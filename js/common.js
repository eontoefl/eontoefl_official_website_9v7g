// Common JavaScript for all pages

// 로그인 상태 확인 및 네비게이션 업데이트
function updateAuthMenu() {
    const authMenu = document.getElementById('authMenu');
    if (!authMenu) return;
    
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    
    if (userData) {
        // 로그인 상태
        const isAdmin = userData.role === 'admin';
        
        if (isAdmin) {
            authMenu.innerHTML = `
                <a href="admin-dashboard.html">${userData.name || '관리자'}</a>
            `;
        } else {
            authMenu.innerHTML = `
                <a href="my-dashboard.html">${userData.name || '사용자'}</a>
            `;
        }
    } else {
        // 로그아웃 상태
        authMenu.innerHTML = `
            <a href="login.html">LOGIN</a>
            <span style="color: #cbd5e1; margin: 0 8px;">|</span>
            <a href="register.html">JOIN</a>
        `;
    }
}

// 햄버거 메뉴 토글
function initHamburgerMenu() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    
    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            hamburger.classList.toggle('active');
        });

        // 모바일: 드롭다운 메뉴 토글 (터치 지원)
        const dropdownItems = navMenu.querySelectorAll('.nav-item.has-dropdown');
        dropdownItems.forEach(item => {
            const mainLink = item.querySelector(':scope > a');
            if (mainLink) {
                mainLink.addEventListener('click', (e) => {
                    // 모바일(768px 이하)에서만 동작
                    if (window.innerWidth <= 768) {
                        e.preventDefault();
                        // 다른 드롭다운 닫기
                        dropdownItems.forEach(other => {
                            if (other !== item) other.classList.remove('active');
                        });
                        item.classList.toggle('active');
                    }
                });
            }
        });

        // 메뉴 링크 클릭 시 메뉴 닫기 (서브메뉴 링크)
        navMenu.querySelectorAll('.dropdown-menu a').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                hamburger.classList.remove('active');
            });
        });
    }
}

// 페이지 로드 시 실행
document.addEventListener('DOMContentLoaded', () => {
    updateAuthMenu();
    initHamburgerMenu();
    hideMaterialsForNonAdmin();
});

/**
 * 관리자가 아니면 모든 페이지에서 학습 자료 링크 숨김
 */
function hideMaterialsForNonAdmin() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (userData && userData.role === 'admin') return;

    // 네비게이션 드롭다운, 사이드바, 푸터 등 모든 materials.html 링크 숨김
    document.querySelectorAll('a[href="materials.html"], a[href="materials.html?id"]').forEach(link => {
        link.style.display = 'none';
    });
}

// ==================== 첨부파일 표시 공통 함수 ====================
/**
 * 게시글 상세보기에서 attachments 배열을 받아 HTML을 렌더링
 * @param {Array} attachments - [{name, url, size, type}, ...]
 * @param {string} containerId - 삽입할 요소의 ID
 */
function renderAttachments(attachments, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    function _getFileCat(type, name) {
        type = type || '';
        name = name || '';
        if (type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|aac|flac|wma)$/i.test(name)) return 'audio';
        if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(name)) return 'image';
        if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
        if (type.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv)$/i.test(name)) return 'video';
        if (/\.(doc|docx|ppt|pptx|xls|xlsx|hwp|hwpx|txt|csv)$/i.test(name)) return 'document';
        return 'other';
    }

    function _fmtSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function _iconCls(cat) {
        const m = { audio: 'fa-music', image: 'fa-image', pdf: 'fa-file-pdf', video: 'fa-video', document: 'fa-file-alt', other: 'fa-file' };
        return m[cat] || 'fa-file';
    }

    function _bgColor(cat) {
        const m = { audio: '#ede9fe', image: '#dbeafe', pdf: '#fee2e2', video: '#fce7f3', document: '#dbeafe', other: '#f1f5f9' };
        return m[cat] || '#f1f5f9';
    }

    function _fgColor(cat) {
        const m = { audio: '#7c3aed', image: '#2563eb', pdf: '#dc2626', video: '#db2777', document: '#2563eb', other: '#64748b' };
        return m[cat] || '#64748b';
    }

    let html = '<div style="margin-top:32px; padding-top:24px; border-top:1px solid #e2e8f0;">';
    html += '<h4 style="font-size:14px; font-weight:600; color:#1e293b; margin-bottom:12px; display:flex; align-items:center; gap:6px;"><i class="fas fa-paperclip" style="color:#9480c5;"></i> 첨부파일</h4>';

    for (const a of attachments) {
        const cat = _getFileCat(a.type, a.name);

        if (cat === 'audio') {
            html += `<div style="margin-bottom:12px; padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="width:28px; height:28px; border-radius:6px; background:${_bgColor(cat)}; color:${_fgColor(cat)}; display:flex; align-items:center; justify-content:center; font-size:12px;"><i class="fas ${_iconCls(cat)}"></i></span>
                    <span style="font-size:13px; font-weight:500; color:#1e293b;">${a.name}</span>
                    <span style="font-size:11px; color:#94a3b8;">${_fmtSize(a.size)}</span>
                </div>
                <audio controls preload="metadata" style="width:100%; height:40px; border-radius:8px;">
                    <source src="${a.url}" type="${a.type || 'audio/mpeg'}">
                </audio>
            </div>`;
        } else if (cat === 'image') {
            html += `<div style="margin-bottom:12px; padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="width:28px; height:28px; border-radius:6px; background:${_bgColor(cat)}; color:${_fgColor(cat)}; display:flex; align-items:center; justify-content:center; font-size:12px;"><i class="fas ${_iconCls(cat)}"></i></span>
                    <span style="font-size:13px; font-weight:500; color:#1e293b;">${a.name}</span>
                    <span style="font-size:11px; color:#94a3b8;">${_fmtSize(a.size)}</span>
                    <a href="${a.url}" download="${a.name}" style="margin-left:auto; font-size:12px; color:#9480c5; text-decoration:none; font-weight:500;" title="다운로드"><i class="fas fa-download"></i></a>
                </div>
                <img src="${a.url}" alt="${a.name}" style="max-width:100%; max-height:400px; border-radius:8px; display:block;">
            </div>`;
        } else if (cat === 'video') {
            html += `<div style="margin-bottom:12px; padding:14px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="width:28px; height:28px; border-radius:6px; background:${_bgColor(cat)}; color:${_fgColor(cat)}; display:flex; align-items:center; justify-content:center; font-size:12px;"><i class="fas ${_iconCls(cat)}"></i></span>
                    <span style="font-size:13px; font-weight:500; color:#1e293b;">${a.name}</span>
                    <span style="font-size:11px; color:#94a3b8;">${_fmtSize(a.size)}</span>
                </div>
                <video controls preload="metadata" style="width:100%; max-height:400px; border-radius:8px;">
                    <source src="${a.url}" type="${a.type || 'video/mp4'}">
                </video>
            </div>`;
        } else {
            // PDF, document, other → 다운로드 바
            html += `<div style="margin-bottom:8px; display:flex; align-items:center; gap:10px; padding:12px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
                <span style="width:32px; height:32px; border-radius:6px; background:${_bgColor(cat)}; color:${_fgColor(cat)}; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0;"><i class="fas ${_iconCls(cat)}"></i></span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:13px; font-weight:500; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
                    <div style="font-size:11px; color:#94a3b8;">${_fmtSize(a.size)}</div>
                </div>
                <a href="${a.url}" download="${a.name}" target="_blank" style="padding:6px 14px; background:white; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; color:#64748b; text-decoration:none; font-weight:500; white-space:nowrap; transition:all 0.2s;" onmouseover="this.style.borderColor='#9480c5'; this.style.color='#9480c5';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.color='#64748b';"><i class="fas fa-download" style="margin-right:4px;"></i>다운로드</a>
            </div>`;
        }
    }

    html += '</div>';
    container.innerHTML = html;
}

/**
 * '내 신청서' 메뉴 클릭 시 처리
 * 1. 비로그인 -> 로그인 페이지로 이동
 * 2. 로그인 + 신청서 없음 -> 알림
 * 3. 로그인 + 신청서 있음 -> 신청서 상세로 이동
 */
async function goToMyApplication(event) {
    event.preventDefault();
    
    // 1. 로그인 여부 확인
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    
    if (!userData) {
        alert('⚠️ 로그인 후 이용해주세요.\n\n내 신청서를 확인하려면 로그인이 필요합니다.');
        window.location.href = 'login.html';
        return;
    }
    
    // 2. 신청서 조회 (supabaseAPI 사용)
    try {
        const result = await supabaseAPI.query('applications', {
            'email': `eq.${userData.email}`,
            'order': 'created_at.desc',
            'limit': '1'
        });
        
        if (result && result.length > 0) {
            // 신청서가 있으면 가장 최근 신청서 상세 페이지로 이동
            window.location.href = `application-detail.html?id=${result[0].id}`;
        } else {
            // 신청서가 없으면 알림
            alert('📋 접수한 신청서가 없습니다.\n\n신청서를 먼저 작성해주세요.');
        }
    } catch (error) {
        console.error('Failed to check application:', error);
        alert('❌ 신청서 확인 중 오류가 발생했습니다.\n\n잠시 후 다시 시도해주세요.');
    }
}
