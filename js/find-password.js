// Find Password Handler
document.getElementById('findPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const findBtn = document.getElementById('findBtn');
    const resultArea = document.getElementById('resultArea');
    
    // Disable button
    findBtn.disabled = true;
    findBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';
    resultArea.style.display = 'none';
    
    try {
        // Fetch all users
        const result = await supabaseAPI.get('users', { limit: 1000 });
        
        if (result.data && result.data.length > 0) {
            // Find user by email, name, and phone
            const user = result.data.find(u => 
                u.email === email && u.name === name && u.phone === phone
            );
            
            if (user) {
                // Reset password to 000000
                const updateResponse = await fetch(`tables/users/${user.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ password: '000000' })
                });
                
                if (updateResponse.ok) {
                    // Show result
                    resultArea.style.display = 'block';
                    
                    // Hide form buttons
                    document.getElementById('formButtons').style.display = 'none';
                    
                    // Scroll to result
                    resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    throw new Error('Failed to reset password');
                }
            } else {
                alert('❌ 일치하는 회원 정보를 찾을 수 없습니다.\n\n이메일, 이름, 전화번호를 다시 확인해주세요.');
            }
        } else {
            alert('❌ 회원 정보를 불러올 수 없습니다.\n\n잠시 후 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Find password error:', error);
        alert('❌ 비밀번호 찾기 중 오류가 발생했습니다.\n\n잠시 후 다시 시도해주세요.');
    } finally {
        findBtn.disabled = false;
        findBtn.innerHTML = '<i class="fas fa-redo"></i> 임시 비밀번호 부여받기';
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
