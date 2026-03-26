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
});

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
    
    // 2. 신청서 조회 (모든 신청서를 가져온 후 필터링)
    try {
        const response = await fetch(`tables/applications?limit=1000&sort=-created_at`);
        const result = await response.json();
        
        // 본인의 신청서만 필터링
        const myApplications = result.data ? result.data.filter(app => app.email === userData.email) : [];
        
        if (myApplications.length > 0) {
            // 신청서가 있으면 가장 최근 신청서 상세 페이지로 이동
            const application = myApplications[0];
            window.location.href = `application-detail.html?id=${application.id}`;
        } else {
            // 신청서가 없으면 알림
            alert('📋 접수한 신청서가 없습니다.\n\n신청서를 먼저 작성해주세요.');
        }
    } catch (error) {
        console.error('Failed to check application:', error);
        alert('❌ 신청서 확인 중 오류가 발생했습니다.\n\n잠시 후 다시 시도해주세요.');
    }
}
