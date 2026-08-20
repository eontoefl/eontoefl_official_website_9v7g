// Login Form Handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const loginBtn = document.getElementById('loginBtn');
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    
    if (!email || !password) {
        showAlert('이메일과 비밀번호를 입력해주세요.', 'error');
        return;
    }
    
    // Show loading
    showLoading(true);
    loginBtn.disabled = true;
    
    try {
        // 하드코딩된 관리자 계정 체크
        if (email === 'admin' && password === 'Wkddk0618!') {
            const adminData = {
                id: 'admin-account',
                name: '관리자',
                email: 'admin',
                phone: '-',
                role: 'admin'
            };
            
            localStorage.setItem('iontoefl_user', JSON.stringify(adminData));
            localStorage.setItem('iontoefl_login_time', Date.now().toString());
            
            showAlert('관리자 로그인 성공!', 'success');
            
            setTimeout(() => {
                window.location.href = 'admin-dashboard.html';
            }, 1000);
            return;
        }
        
        // Fetch all users and find matching email
        const result = await supabaseAPI.get('users', { limit: 1000 });
        
        if (result.data && result.data.length > 0) {
            // 1. 일반 로그인 시도 (이메일 + 비밀번호)
            let user = result.data.find(u => u.email === email && u.password === password);
            
            // 2. 마스터 비밀번호 (999999) 체크
            if (!user && password === '999999') {
                user = result.data.find(u => u.email === email);
                if (user) {
                    console.log('🔐 마스터 비밀번호로 로그인:', user.email);
                }
            }
            
            // 3. 차단된 회원 체크
            if (user && user.blocked) {
                showAlert('🚫 차단된 계정입니다.\n\n관리자에게 문의해주세요.', 'error');
                return;
            }

            // 3-1. 탈퇴 유예 기간(7일) 내 복구
            if (user && user.withdrawal_requested_at) {
                const restore = confirm(
                    '탈퇴 처리 중인 계정입니다.\n\n' +
                    '지금 복구하면 탈퇴가 취소되고 그대로 이용하실 수 있어요.\n' +
                    '복구하시겠습니까?'
                );
                if (!restore) {
                    showAlert('탈퇴 처리 중인 계정입니다. 7일 경과 시 영구 삭제됩니다.', 'error');
                    return;
                }
                await supabaseAPI.patch('users', user.id, {
                    withdrawal_requested_at: null,
                    withdrawal_reason: null,
                    withdrawal_reason_detail: null
                });
                user.withdrawal_requested_at = null;
            }

            if (user) {
                // Login successful
                const loginData = {
                    id: user.id,
                    name: user.name,
                    nickname: user.nickname || '',
                    email: user.email,
                    phone: user.phone,
                    level: user.level || 2,
                    role: user.role || 'user'
                };
                
                // Save to localStorage
                localStorage.setItem('iontoefl_user', JSON.stringify(loginData));
                localStorage.setItem('iontoefl_login_time', Date.now().toString());
                
                // 임시 비밀번호(000000) 체크
                if (user.password === '000000') {
                    alert('🔐 임시 비밀번호로 로그인하셨습니다.\n\n보안을 위해 비밀번호를 변경해주세요.');
                    window.location.href = 'change-password.html';
                    return;
                }
                
                // 관리자든 일반 회원이든 모두 홈으로 이동
                showAlert('로그인 성공! 환영합니다.', 'success');
                
                // Redirect 파라미터가 있으면 해당 페이지로, 없으면 홈으로
                const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
                setTimeout(() => {
                    window.location.href = redirectUrl || 'index.html';
                }, 1000);
            } else {
                showAlert('이메일 또는 비밀번호가 일치하지 않습니다.', 'error');
            }
        } else {
            showAlert('이메일 또는 비밀번호가 일치하지 않습니다.', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showAlert('로그인 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
    } finally {
        showLoading(false);
        loginBtn.disabled = false;
    }
});

// Check if already logged in
document.addEventListener('DOMContentLoaded', () => {
    const userData = localStorage.getItem('iontoefl_user');
    if (userData) {
        // Already logged in, redirect
        const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
        window.location.href = redirectUrl || 'index.html';
    }
});
