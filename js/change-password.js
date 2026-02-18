// Change Password Handler
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const changeBtn = document.getElementById('changeBtn');
    
    // Validation
    if (newPassword.length < 6) {
        alert('⚠️ 새 비밀번호는 최소 6자 이상이어야 합니다.');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        alert('⚠️ 새 비밀번호가 일치하지 않습니다.');
        return;
    }
    
    if (currentPassword === newPassword) {
        alert('⚠️ 현재 비밀번호와 새 비밀번호가 같습니다.\n다른 비밀번호를 입력해주세요.');
        return;
    }
    
    // Get current user
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    
    if (!userData) {
        alert('❌ 로그인이 필요합니다.');
        window.location.href = 'login.html';
        return;
    }
    
    // Disable button
    changeBtn.disabled = true;
    changeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 변경 중...';
    
    try {
        // Fetch user data
        const response = await fetch(`tables/users/${userData.id}`);
        const user = await response.json();
        
        // Verify current password
        if (user.password !== currentPassword) {
            alert('❌ 현재 비밀번호가 일치하지 않습니다.');
            return;
        }
        
        // Update password
        const updateResponse = await fetch(`tables/users/${userData.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: newPassword })
        });
        
        if (updateResponse.ok) {
            alert('✅ 비밀번호가 성공적으로 변경되었습니다!\n\n새 비밀번호로 다시 로그인해주세요.');
            
            // Logout
            localStorage.removeItem('iontoefl_user');
            localStorage.removeItem('iontoefl_login_time');
            
            // Redirect to login
            window.location.href = 'login.html';
        } else {
            throw new Error('Failed to update password');
        }
    } catch (error) {
        console.error('Change password error:', error);
        alert('❌ 비밀번호 변경 중 오류가 발생했습니다.\n\n잠시 후 다시 시도해주세요.');
    } finally {
        changeBtn.disabled = false;
        changeBtn.innerHTML = '<i class="fas fa-check"></i> 변경하기';
    }
});

// Check if logged in
document.addEventListener('DOMContentLoaded', () => {
    const userData = localStorage.getItem('iontoefl_user');
    if (!userData) {
        alert('❌ 로그인이 필요합니다.');
        window.location.href = 'login.html';
    }
});

// Focus styles
document.querySelectorAll('input').forEach(input => {
    input.addEventListener('focus', (e) => {
        e.target.style.borderColor = '#9480c5';
        e.target.style.boxShadow = '0 0 0 3px rgba(148, 128, 197, 0.1)';
    });
    
    input.addEventListener('blur', (e) => {
        e.target.style.borderColor = '#e5e7eb';
        e.target.style.boxShadow = 'none';
    });
});
