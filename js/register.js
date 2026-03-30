// ==================== 닉네임 중복 체크 ====================
let nicknameAvailable = false;
let nicknameCheckTimer = null;
let isComposing = false;

const nicknameInput = document.getElementById('nickname');

function sanitizeNickname(el) {
    el.value = el.value.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, '');
}

function checkNickname(val) {
    const status = document.getElementById('nicknameStatus');
    nicknameAvailable = false;

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
            nicknameAvailable = true;
        }
    }, 400);
}

// 한글 조합 시작 — JS가 개입하지 않음
nicknameInput.addEventListener('compositionstart', () => {
    isComposing = true;
});

// 한글 조합 완료 — 이때 필터링 + 중복체크
nicknameInput.addEventListener('compositionend', (e) => {
    isComposing = false;
    sanitizeNickname(e.target);
    checkNickname(e.target.value.trim());
});

// 영문/숫자 등 비조합 입력 처리
nicknameInput.addEventListener('input', (e) => {
    if (isComposing) return;
    sanitizeNickname(e.target);
    checkNickname(e.target.value.trim());
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
            // 자동 로그인: localStorage에 세션 저장
            const loginData = {
                id: result.id,
                name: result.name,
                nickname: result.nickname || '',
                email: result.email,
                phone: result.phone,
                level: result.level || 2,
                role: result.role || 'user'
            };
            localStorage.setItem('iontoefl_user', JSON.stringify(loginData));
            localStorage.setItem('iontoefl_login_time', Date.now().toString());

            showAlert('회원가입이 완료되었습니다!', 'success');
            document.getElementById('registerForm').reset();

            // redirect 파라미터가 있으면 해당 페이지로, 없으면 홈으로
            const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
            setTimeout(() => {
                window.location.href = redirectUrl || 'index.html';
            }, 1500);
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
