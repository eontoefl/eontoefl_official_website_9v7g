// Find ID Handler
document.getElementById('findIdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const findBtn = document.getElementById('findBtn');
    const resultArea = document.getElementById('resultArea');
    const resultEmail = document.getElementById('resultEmail');
    
    // Disable button
    findBtn.disabled = true;
    findBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 검색 중...';
    resultArea.style.display = 'none';
    
    try {
        // Fetch all users
        const result = await supabaseAPI.get('users', { limit: 1000 });
        
        if (result.data && result.data.length > 0) {
            // Find user by name and phone
            const user = result.data.find(u => 
                u.name === name && u.phone === phone
            );
            
            if (user) {
                // Mask email
                const maskedEmail = maskEmail(user.email);
                
                // Show result
                resultEmail.textContent = maskedEmail;
                resultArea.style.display = 'block';
                
                // Scroll to result
                resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                alert('❌ 일치하는 회원 정보를 찾을 수 없습니다.\n\n이름과 전화번호를 다시 확인해주세요.');
            }
        } else {
            alert('❌ 회원 정보를 불러올 수 없습니다.\n\n잠시 후 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Find ID error:', error);
        alert('❌ 아이디 찾기 중 오류가 발생했습니다.\n\n잠시 후 다시 시도해주세요.');
    } finally {
        findBtn.disabled = false;
        findBtn.innerHTML = '<i class="fas fa-search"></i> 아이디 찾기';
    }
});

// Mask email (h***@example.com)
function maskEmail(email) {
    const [local, domain] = email.split('@');
    
    if (local.length <= 1) {
        return local + '***@' + domain;
    } else if (local.length === 2) {
        return local[0] + '*@' + domain;
    } else {
        return local[0] + '*'.repeat(local.length - 1) + '@' + domain;
    }
}

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
