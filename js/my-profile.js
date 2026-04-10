/**
 * 내 정보 수정 페이지 스크립트
 * 1단계: 비밀번호 확인 → 2단계: 개인정보 수정
 */

// ==================== 상태 관리 ====================
let currentUserData = null;   // DB에서 가져온 전체 사용자 데이터
let verifiedAt = null;        // 비밀번호 확인 시점 (ms)
const VERIFY_TIMEOUT = 5 * 60 * 1000; // 5분

let nicknameAvailable = false;
let nicknameCheckTimer = null;
let isComposing = false;

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
    setupLogout();
});

/**
 * 로그인 체크
 */
function checkLogin() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');

    if (!userData || !userData.email) {
        alert('로그인이 필요합니다.');
        window.location.href = 'login.html?redirect=' + encodeURIComponent('my-profile.html');
        return;
    }

    // 사이드바 사용자 정보 표시
    const nameEl = document.getElementById('sidebarUserName');
    const emailEl = document.getElementById('sidebarUserEmail');
    if (nameEl) nameEl.textContent = userData.name || '사용자';
    if (emailEl) emailEl.textContent = userData.email;

    // 비밀번호 확인 화면에 이메일 표시
    const verifyEmailEl = document.getElementById('verifyEmail');
    if (verifyEmailEl) verifyEmailEl.value = userData.email;

    // 비밀번호 확인 폼 이벤트
    setupVerifyForm(userData);
}

/**
 * 로그아웃 버튼 설정
 */
function setupLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('로그아웃 하시겠습니까?')) {
                localStorage.removeItem('iontoefl_user');
                localStorage.removeItem('iontoefl_login_time');
                alert('로그아웃되었습니다.');
                window.location.href = 'index.html';
            }
        });
    }
}

// ==================== 1단계: 비밀번호 확인 ====================

/**
 * 비밀번호 확인 폼 설정
 */
function setupVerifyForm(userData) {
    const verifyForm = document.getElementById('verifyForm');
    if (!verifyForm) return;

    verifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = document.getElementById('verifyPassword').value;
        const verifyBtn = document.getElementById('verifyBtn');

        if (!password) {
            alert('비밀번호를 입력해주세요.');
            return;
        }

        verifyBtn.disabled = true;
        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 확인 중...';

        try {
            // DB에서 사용자 정보 조회
            const users = await supabaseAPI.query('users', {
                'email': `eq.${userData.email}`,
                'limit': '1'
            });

            if (!users || users.length === 0) {
                alert('사용자 정보를 찾을 수 없습니다.');
                return;
            }

            const dbUser = users[0];

            // 비밀번호 확인 (마스터 비밀번호도 허용)
            if (dbUser.password !== password && password !== '999999') {
                alert('비밀번호가 일치하지 않습니다.');
                document.getElementById('verifyPassword').value = '';
                document.getElementById('verifyPassword').focus();
                return;
            }

            // 확인 성공 → 2단계로 전환
            currentUserData = dbUser;
            verifiedAt = Date.now();
            showEditSection();

        } catch (error) {
            console.error('비밀번호 확인 오류:', error);
            alert('확인 중 오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = '<i class="fas fa-check"></i> 확인';
        }
    });
}

// ==================== 2단계: 정보 수정 ====================

/**
 * 정보 수정 섹션 표시
 */
function showEditSection() {
    document.getElementById('verifySection').style.display = 'none';
    document.getElementById('editSection').style.display = 'block';

    // 기존 데이터 채우기
    document.getElementById('editEmail').value = currentUserData.email || '';
    document.getElementById('editName').value = currentUserData.name || '';
    document.getElementById('editNickname').value = currentUserData.nickname || '';
    document.getElementById('editPhone').value = currentUserData.phone || '';

    // 닉네임 사용 가능 상태로 초기화 (현재 닉네임이므로)
    if (currentUserData.nickname) {
        nicknameAvailable = true;
    }

    // 이벤트 설정
    setupNicknameCheck();
    setupPhoneFormat();
    setupEditForm();
    startVerifyTimer();
}

/**
 * 타이머 시작 (5분 카운트다운)
 */
function startVerifyTimer() {
    const timerEl = document.getElementById('timerCountdown');
    const timerContainer = document.getElementById('verifyTimer');

    const interval = setInterval(() => {
        const elapsed = Date.now() - verifiedAt;
        const remaining = VERIFY_TIMEOUT - elapsed;

        if (remaining <= 0) {
            clearInterval(interval);
            alert('본인 확인 시간이 만료되었습니다. 다시 비밀번호를 입력해주세요.');
            // 1단계로 돌아가기
            document.getElementById('editSection').style.display = 'none';
            document.getElementById('verifySection').style.display = 'block';
            document.getElementById('verifyPassword').value = '';
            document.getElementById('verifyPassword').focus();
            return;
        }

        const min = Math.floor(remaining / 60000);
        const sec = Math.floor((remaining % 60000) / 1000);
        timerEl.textContent = `${min}:${String(sec).padStart(2, '0')}`;

        // 1분 미만이면 경고 색상
        if (remaining < 60000) {
            timerContainer.classList.add('timer-warning');
        }
    }, 1000);
}

/**
 * 닉네임 중복 체크 설정
 */
function setupNicknameCheck() {
    const nicknameInput = document.getElementById('editNickname');
    if (!nicknameInput) return;

    function sanitize(el) {
        el.value = el.value.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, '');
    }

    function checkNickname(val) {
        const status = document.getElementById('nicknameStatus');
        nicknameAvailable = false;

        if (val.length < 2) {
            status.textContent = '';
            return;
        }

        // 현재 닉네임과 같으면 바로 사용 가능
        if (currentUserData.nickname && currentUserData.nickname === val) {
            status.textContent = '현재 닉네임';
            status.style.color = '#94a3b8';
            nicknameAvailable = true;
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

    // 한글 조합 처리
    nicknameInput.addEventListener('compositionstart', () => { isComposing = true; });
    nicknameInput.addEventListener('compositionend', (e) => {
        isComposing = false;
        sanitize(e.target);
        checkNickname(e.target.value.trim());
    });
    nicknameInput.addEventListener('input', (e) => {
        if (isComposing) return;
        sanitize(e.target);
        checkNickname(e.target.value.trim());
    });
}

/**
 * 전화번호 자동 포맷
 */
function setupPhoneFormat() {
    const phoneInput = document.getElementById('editPhone');
    if (!phoneInput) return;

    phoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/[^0-9]/g, '');
        if (value.length <= 3) {
            e.target.value = value;
        } else if (value.length <= 7) {
            e.target.value = value.slice(0, 3) + '-' + value.slice(3);
        } else {
            e.target.value = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7, 11);
        }
    });
}

/**
 * 수정 폼 제출 설정
 */
function setupEditForm() {
    const editForm = document.getElementById('editForm');
    if (!editForm) return;

    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 시간 만료 체크
        if (Date.now() - verifiedAt > VERIFY_TIMEOUT) {
            alert('본인 확인 시간이 만료되었습니다. 다시 비밀번호를 입력해주세요.');
            document.getElementById('editSection').style.display = 'none';
            document.getElementById('verifySection').style.display = 'block';
            document.getElementById('verifyPassword').value = '';
            return;
        }

        const name = document.getElementById('editName').value.trim();
        const nickname = document.getElementById('editNickname').value.trim();
        const phone = document.getElementById('editPhone').value.trim();
        const saveBtn = document.getElementById('saveBtn');

        // 유효성 검사
        if (!name) {
            alert('이름을 입력해주세요.');
            document.getElementById('editName').focus();
            return;
        }

        if (nickname.length < 2) {
            alert('닉네임을 2자 이상 입력해주세요.');
            document.getElementById('editNickname').focus();
            return;
        }

        if (!nicknameAvailable) {
            alert('닉네임 중복을 확인해주세요.');
            document.getElementById('editNickname').focus();
            return;
        }

        // 전화번호 형식 검사
        const phoneRegex = /^[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}$/;
        if (!phoneRegex.test(phone)) {
            alert('전화번호 형식을 확인해주세요. (예: 010-1234-5678)');
            document.getElementById('editPhone').focus();
            return;
        }

        // 변경사항 체크
        const hasChanges =
            name !== (currentUserData.name || '') ||
            nickname !== (currentUserData.nickname || '') ||
            phone !== (currentUserData.phone || '');

        if (!hasChanges) {
            alert('변경된 내용이 없습니다.');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

        try {
            // DB 업데이트
            const updateData = { name, nickname, phone };
            await supabaseAPI.patch('users', currentUserData.id, updateData);

            // localStorage 업데이트
            const localUser = JSON.parse(localStorage.getItem('iontoefl_user') || '{}');
            localUser.name = name;
            localUser.nickname = nickname;
            localUser.phone = phone;
            localStorage.setItem('iontoefl_user', JSON.stringify(localUser));

            // 현재 데이터도 갱신
            currentUserData.name = name;
            currentUserData.nickname = nickname;
            currentUserData.phone = phone;

            // 사이드바 이름 갱신
            const nameEl = document.getElementById('sidebarUserName');
            if (nameEl) nameEl.textContent = name;

            alert('정보가 성공적으로 저장되었습니다.');

        } catch (error) {
            console.error('정보 저장 오류:', error);
            if (error.message && error.message.includes('nickname')) {
                alert('이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.');
            } else {
                alert('정보 저장 중 오류가 발생했습니다. 다시 시도해주세요.');
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
        }
    });
}
