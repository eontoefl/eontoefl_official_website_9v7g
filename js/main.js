// Mobile Menu Toggle
document.addEventListener('DOMContentLoaded', () => {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navMenu = document.getElementById('navMenu');

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            navMenu.classList.toggle('active');
        });
    }

    // Update navigation based on login status
    updateNavigation();
    
    // Create floating dashboard buttons if not exist
    createFloatingButtons();

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href !== '') {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                    // Close mobile menu if open
                    if (navMenu) {
                        navMenu.classList.remove('active');
                    }
                }
            }
        });
    });

    // Load reviews on homepage
    if (document.getElementById('reviewsContainer')) {
        loadReviews();
    }
});

// Load Reviews from API
async function loadReviews() {
    const container = document.getElementById('reviewsContainer');
    
    try {
        const response = await fetch('tables/reviews?limit=100');
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            container.innerHTML = data.data.map(review => `
                <div class="review-card">
                    <div class="review-header">
                        <div class="review-student">
                            <div class="student-name">${escapeHtml(review.student_name)}</div>
                            <div class="student-program">${escapeHtml(review.program)}</div>
                        </div>
                        <div class="review-rating">
                            ${generateStars(review.rating)}
                        </div>
                    </div>
                    <p class="review-text">${escapeHtml(review.review_text)}</p>
                    <div class="review-scores">
                        <div class="score-item">
                            <span class="score-label">수강 전</span>
                            <span class="score-value">${review.score_before}점</span>
                        </div>
                        <div class="score-item">
                            <span class="score-label">수강 후</span>
                            <span class="score-value">${review.score_after}점</span>
                        </div>
                        <div class="score-item">
                            <span class="score-label">상승</span>
                            <span class="score-value">+${review.score_after - review.score_before}점</span>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="text-align:center;color:#64748b;">등록된 후기가 없습니다.</p>';
        }
    } catch (error) {
        console.error('Failed to load reviews:', error);
        container.innerHTML = '<p style="text-align:center;color:#ef4444;">후기를 불러오는데 실패했습니다.</p>';
    }
}

// Generate star rating HTML
function generateStars(rating) {
    let stars = '';
    for (let i = 0; i < 5; i++) {
        if (i < rating) {
            stars += '<i class="fas fa-star"></i>';
        } else {
            stars += '<i class="far fa-star"></i>';
        }
    }
    return stars;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Show alert message
function showAlert(message, type = 'success') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} show`;
    alertDiv.textContent = message;
    
    const container = document.querySelector('.form-container') || document.querySelector('.container');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
        
        setTimeout(() => {
            alertDiv.remove();
        }, 5000);
    }
}

// Show loading spinner
function showLoading(show = true) {
    const loading = document.querySelector('.loading');
    if (loading) {
        if (show) {
            loading.classList.add('show');
        } else {
            loading.classList.remove('show');
        }
    }
}

// Form validation
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePhone(phone) {
    const re = /^[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}$/;
    return re.test(phone);
}

function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return false;
    
    let isValid = true;
    const inputs = form.querySelectorAll('.form-input[required], .form-select[required], .form-textarea[required]');
    
    inputs.forEach(input => {
        const formGroup = input.closest('.form-group');
        const errorElement = formGroup.querySelector('.form-error');
        
        // Clear previous errors
        formGroup.classList.remove('error');
        
        // Check if empty
        if (!input.value.trim()) {
            formGroup.classList.add('error');
            if (errorElement) {
                errorElement.textContent = '이 필드는 필수입니다';
            }
            isValid = false;
            return;
        }
        
        // Email validation
        if (input.type === 'email' && !validateEmail(input.value)) {
            formGroup.classList.add('error');
            if (errorElement) {
                errorElement.textContent = '올바른 이메일 형식이 아닙니다';
            }
            isValid = false;
            return;
        }
        
        // Phone validation
        if (input.name === 'phone' && !validatePhone(input.value)) {
            formGroup.classList.add('error');
            if (errorElement) {
                errorElement.textContent = '전화번호 형식: 010-1234-5678';
            }
            isValid = false;
            return;
        }
    });
    
    return isValid;
}

// Format date
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// Update Navigation based on login status
function updateNavigation() {
    const authMenu = document.getElementById('authMenu');
    if (!authMenu) return;
    
    const userData = localStorage.getItem('iontoefl_user');
    
    if (userData) {
        // User is logged in
        const user = JSON.parse(userData);
        
        // 사용자 이름 클릭 시 대시보드로 이동
        const dashboardUrl = user.role === 'admin' ? 'admin-dashboard.html' : 'my-dashboard.html';
        
        authMenu.innerHTML = `
            <a href="${dashboardUrl}" target="_blank" style="text-decoration: none; color: #1e293b; font-size: 14px; font-weight: 500 !important; transition: all 0.2s; padding: 6px 12px; border-radius: 6px; background: rgba(148, 128, 197, 0.1);">
                <i class="fas fa-user-circle" style="margin-right: 6px; color: #9480c5; font-size: 16px; position: relative; top: 1.5px;"></i>
                ${escapeHtml(user.name)}
            </a>
            <span style="color: #cbd5e1; margin: 0 10px; font-size: 14px; font-weight: 200;">|</span>
            <a href="#" onclick="logout(); return false;" style="text-decoration: none; color: #94a3b8; font-size: 14px; font-weight: 200; transition: opacity 0.2s;">
                LOGOUT
            </a>
        `;
        
        // 관리자인 경우 관리자 대시보드 버튼 표시
        const adminBtn = document.getElementById('adminDashboardBtn');
        if (adminBtn && user.role === 'admin') {
            adminBtn.style.display = 'flex';
        }
        
        // 학생인 경우 학생 대시보드 버튼 표시
        const studentBtn = document.getElementById('studentDashboardBtn');
        if (studentBtn && user.role !== 'admin') {
            studentBtn.style.display = 'flex';
        }
    } else {
        // User is not logged in - show LOGIN | JOIN
        authMenu.innerHTML = `
            <a href="login.html" style="text-decoration: none; color: #555555; font-size: 14px; font-weight: 200;">LOGIN</a>
            <span style="color: #cbd5e1; margin: 0 10px; font-size: 14px;">|</span>
            <a href="register.html" style="text-decoration: none; color: #555555; font-size: 14px; font-weight: 200;">JOIN</a>
        `;
    }
}

// Logout function
function logout() {
    if (confirm('로그아웃 하시겠습니까?')) {
        localStorage.removeItem('iontoefl_user');
        localStorage.removeItem('iontoefl_login_time');
        alert('로그아웃되었습니다.');
        window.location.reload();
    }
}

// Check login status
function isLoggedIn() {
    return localStorage.getItem('iontoefl_user') !== null;
}

// Get current user
function getCurrentUser() {
    const userData = localStorage.getItem('iontoefl_user');
    return userData ? JSON.parse(userData) : null;
}

// Create floating dashboard buttons
async function createFloatingButtons() {
    const user = getCurrentUser();
    
    // 로그인하지 않았으면 버튼 생성 안 함
    if (!user) return;
    
    // 관리자는 항상 버튼 표시
    if (user.role === 'admin') {
        createAdminButton();
        return;
    }
    
    // 학생인 경우 신청서 접수 여부 확인
    try {
        const response = await fetch(`tables/applications?limit=1000`);
        const result = await response.json();
        
        // 본인의 신청서만 필터링
        const myApplications = result.data ? result.data.filter(app => app.email === user.email) : [];
        
        // 신청서가 있는 경우에만 버튼 표시
        if (myApplications.length > 0) {
            createStudentButton();
        }
    } catch (error) {
        console.error('Failed to check application status:', error);
    }
}

// 학생 대시보드 버튼 생성
function createStudentButton() {
    // 학생 대시보드 버튼이 없으면 생성
    if (!document.getElementById('studentDashboardBtn')) {
        const studentBtn = document.createElement('a');
        studentBtn.id = 'studentDashboardBtn';
        studentBtn.href = 'my-dashboard.html';
        studentBtn.target = '_blank';
        studentBtn.rel = 'noopener noreferrer';
        studentBtn.title = '내 대시보드';
        studentBtn.innerHTML = '<i class="fas fa-tachometer-alt"></i>';
        studentBtn.style.cssText = `
            display: flex;
            position: fixed;
            bottom: 30px;
            left: 30px;
            width: 70px;
            height: 70px;
            background: linear-gradient(135deg, #9480c5 0%, #b8a4d6 100%);
            color: white;
            border-radius: 16px;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 24px rgba(148, 128, 197, 0.4);
            font-size: 28px;
            z-index: 9999;
            transition: all 0.3s ease;
            text-decoration: none;
            border: 3px solid rgba(255, 255, 255, 0.2);
        `;
        
        studentBtn.addEventListener('mouseover', function() {
            this.style.transform = 'translateY(-6px) scale(1.05)';
            this.style.boxShadow = '0 12px 32px rgba(148, 128, 197, 0.5)';
        });
        
        studentBtn.addEventListener('mouseout', function() {
            this.style.transform = 'translateY(0) scale(1)';
            this.style.boxShadow = '0 8px 24px rgba(148, 128, 197, 0.4)';
        });
        
        document.body.appendChild(studentBtn);
    } else {
        // 이미 있으면 표시만
        document.getElementById('studentDashboardBtn').style.display = 'flex';
    }
}

// 관리자 대시보드 버튼 생성
function createAdminButton() {
    // 관리자 대시보드 버튼이 없으면 생성
    if (!document.getElementById('adminDashboardBtn')) {
        const adminBtn = document.createElement('a');
        adminBtn.id = 'adminDashboardBtn';
        adminBtn.href = 'admin-dashboard.html';
        adminBtn.title = '관리자 대시보드';
        adminBtn.innerHTML = '<i class="fas fa-crown"></i>';
        adminBtn.style.cssText = `
            display: flex;
            position: fixed;
            bottom: 30px;
            left: 30px;
            width: 70px;
            height: 70px;
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            color: white;
            border-radius: 16px;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 24px rgba(124, 58, 237, 0.4);
            font-size: 28px;
            z-index: 9999;
            transition: all 0.3s ease;
            text-decoration: none;
            border: 3px solid rgba(255, 255, 255, 0.2);
        `;
        
        adminBtn.addEventListener('mouseover', function() {
            this.style.transform = 'translateY(-6px) scale(1.05)';
            this.style.boxShadow = '0 12px 32px rgba(124, 58, 237, 0.5)';
        });
        
        adminBtn.addEventListener('mouseout', function() {
            this.style.transform = 'translateY(0) scale(1)';
            this.style.boxShadow = '0 8px 24px rgba(124, 58, 237, 0.4)';
        });
        
        document.body.appendChild(adminBtn);
    } else {
        // 이미 있으면 표시만
        document.getElementById('adminDashboardBtn').style.display = 'flex';
    }
}
