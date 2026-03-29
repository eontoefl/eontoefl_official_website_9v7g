// ==================== 닉네임 중복 체크 ====================
let nicknameAvailable = false;
let nicknameCheckTimer = null;

document.getElementById('nickname').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    const status = document.getElementById('nicknameStatus');
    nicknameAvailable = false;

    // 허용 문자: 한글, 영문, 숫자만
    e.target.value = e.target.value.replace(/[^가-힣a-zA-Z0-9]/g, '');

    if (val.length < 2) {
        status.textContent = '';
        return;
    }

    status.textContent = '확인 중...';
    status.style.color = '#94a3b8';

    clearTimeout(nicknameCheckTimer);
    nicknameCheckTimer = setTimeout(async () => {
        try {
            const result = await supabaseAPI.query('users', {
                'nickname': `eq.${val}`,
                'limit': '1'
            });
            if (result && result.length > 0) {
                status.textContent = '이미 사용 중';
                status.style.color = '#ef4444';
                nicknameAvailable = false;
            } else {
                status.textContent = '사용 가능';
                status.style.color = '#22c55e';
                nicknameAvailable = true;
            }
        } catch {
            status.textContent = '';
            nicknameAvailable = true; // API 오류 시 일단 허용, 서버에서 unique 제약으로 걸림
        }
    }, 400);
});

// ==================== 회원가입 제출 ====================
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateForm('registerForm')) return;

    const nickname = document.getElementById('nickname').value.trim();
    if (nickname.length < 2) {
        showAlert('닉네임을 2자 이상 입력해주세요.', 'error');
        document.getElementById('nickname').focus();
        return;
    }
    if (!nicknameAvailable) {
        showAlert('닉네임 중복을 확인해주세요.', 'error');
        document.getElementById('nickname').focus();
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    const formData = {
        name: document.getElementById('name').value.trim(),
        nickname: nickname,
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        password: document.getElementById('password').value,
        level: 2,
        blocked: false,
        role: 'user'
    };

    showLoading(true);
    submitBtn.disabled = true;

    try {
        const result = await supabaseAPI.post('users', formData);

        if (result) {
            showAlert('회원가입이 완료되었습니다! 로그인 후 이용해주세요.', 'success');
            document.getElementById('registerForm').reset();
            setTimeout(() => { window.location.href = 'login.html'; }, 2000);
        } else {
            throw new Error('회원가입에 실패했습니다');
        }
    } catch (error) {
        console.error('Registration error:', error);
        if (error.message && error.message.includes('nickname')) {
            showAlert('이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.', 'error');
        } else {
            showAlert('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
        }
    } finally {
        showLoading(false);
        submitBtn.disabled = false;
    }
});

// ==================== 전화번호 자동 포맷 ====================
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
