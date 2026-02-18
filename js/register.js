// Register Form Handler
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Validate form
    if (!validateForm('registerForm')) {
        return;
    }
    
    const submitBtn = document.getElementById('submitBtn');
    const formData = {
        name: document.getElementById('name').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        password: document.getElementById('password').value,
        level: 2,           // 기본 등급: 학생
        blocked: false,     // 기본값: 차단 안됨
        role: 'user'        // 기본 역할: 일반 사용자
    };
    
    // Show loading
    showLoading(true);
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('tables/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            const result = await response.json();
            
            // Show success message
            showAlert('회원가입이 완료되었습니다! 로그인 후 이용해주세요.', 'success');
            
            // Reset form
            document.getElementById('registerForm').reset();
            
            // Redirect after 2 seconds
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);
        } else {
            throw new Error('회원가입에 실패했습니다');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showAlert('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
    } finally {
        showLoading(false);
        submitBtn.disabled = false;
    }
});

// Auto-format phone number
document.getElementById('phone').addEventListener('input', (e) => {
    let value = e.target.value.replace(/[^0-9]/g, '');
    
    if (value.length <= 3) {
        e.target.value = value;
    } else if (value.length <= 7) {
        e.target.value = value.slice(0, 3) + '-' + value.slice(3);
    } else {
        e.target.value = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7, 11);
    }
});
