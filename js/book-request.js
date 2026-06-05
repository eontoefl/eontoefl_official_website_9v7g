// Book Request Form JavaScript
// 입문서 무료 신청 + 계정 생성 통합 페이지 로직
//
// 페이지 상태(3가지) + 차단(2종):
//   ① 비로그인 + 신규        → 계정필드 + 입문서필드 + 동의   (mode: 'anonymous')
//   ② 로그인 (신청 가능)     → 입문서필드 + 동의            (mode: 'loggedIn')
//   ③ 비로그인 + 계정 있음   → '로그인하기' 링크 → 로그인 후 ②
//   차단A: 이미 입문서 신청   → blockAlreadyApplied
//   차단B: 이미 챌린지 참여   → blockChallenge

// ===== 0. 페이지 진입 즉시 referrer / UTM / userAgent 캐시 =====
// (로그인 리다이렉트로 referrer가 사라지는 것을 방지하기 위해 스크립트 로드 시점에 저장)
(function cacheReferrerInfo() {
    try {
        const STORAGE_KEY = 'book_request_referrer_info';
        if (sessionStorage.getItem(STORAGE_KEY)) return; // 로그인 후 복귀 시 보존

        const params = new URLSearchParams(window.location.search);
        const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
        const utmData = {};
        utmKeys.forEach(key => {
            const val = params.get(key);
            if (val) utmData[key] = val;
        });

        const info = {
            referrer_url: document.referrer || '',
            landing_url: window.location.href,
            utm_data: Object.keys(utmData).length > 0 ? utmData : null,
            user_agent: navigator.userAgent || ''
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    } catch (e) {
        console.warn('referrer 정보 캐시 실패:', e);
    }
})();

// 로그인 후 이 페이지로 돌아오기 위한 redirect URL
const LOGIN_REDIRECT = 'login.html?redirect=book-request.html';

// 페이지 상태 (제출 분기에 사용)
const state = {
    mode: 'anonymous',   // 'anonymous' | 'loggedIn'
    user: null           // 로그인/계정 생성 후의 사용자 객체
};

// 닉네임 중복 체크 상태 (비로그인 신규 전용)
let nicknameAvailable = false;
let nicknameCheckTimer = null;
let isComposing = false;

// 이메일 중복 체크 상태 (비로그인 신규 전용)
let emailAvailable = false;
let emailCheckTimer = null;

// 카카오 채널 추가 클릭 여부
let kakaoChannelClicked = false;

document.addEventListener('DOMContentLoaded', async function () {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');

    if (userData && userData.email) {
        // ===== 로그인 상태: 차단 조건 확인 후 ② 모드 =====
        try {
            // 신청서 조회 기준을 사이트 전체(funnel/guard/dashboard)와 통일:
            //   - email 컬럼 기준 (user_email 아님)
            //   - 삭제된 신청서(deleted)는 제외 (서버 필터 + 클라이언트 재확인)
            const result = await supabaseAPI.query('applications', {
                'email': `eq.${userData.email}`,
                'deleted': 'neq.true',
                'order': 'created_at.desc',
                'limit': '100'
            });
            const applications = (result || []).filter(app => app.deleted !== true && app.deleted !== 'true');

            // 차단B: 내벨업챌린지 참여자 (book_only 이외의 신청서 보유)
            const challengeApp = applications.find(app => app.application_type !== 'book_only');
            if (challengeApp) {
                showBlock('blockChallenge');
                return;
            }

            // 차단A: 이미 입문서 신청함
            const bookApp = applications.find(app => app.application_type === 'book_only');
            if (bookApp) {
                showBlock('blockAlreadyApplied');
                return;
            }

            // 신청 가능 → ② 로그인 모드
            initForm('loggedIn', userData);
        } catch (error) {
            console.error('신청서 조회 오류:', error);
            // 조회 실패 시에도 폼은 띄움 (서버단에서도 중복 방지 가능)
            initForm('loggedIn', userData);
        }
    } else {
        // ===== 비로그인: ① 신규 모드 =====
        initForm('anonymous', null);
    }
});

// ===== 차단 화면 표시 =====
function showBlock(blockId) {
    document.getElementById('stateLoading').style.display = 'none';
    document.getElementById('formWrap').style.display = 'none';
    document.getElementById(blockId).style.display = 'block';
}

// ===== 폼 초기화 및 표시 =====
function initForm(mode, userData) {
    state.mode = mode;
    state.user = userData;

    document.getElementById('stateLoading').style.display = 'none';
    document.getElementById('formWrap').style.display = 'block';

    const accountSection = document.getElementById('accountSection');
    const accountSummary = document.getElementById('accountSummary');
    const accountInputs = accountSection.querySelectorAll('input');

    if (mode === 'loggedIn') {
        // ② 로그인: 계정 생성 섹션 숨김, 요약 표시
        accountSection.style.display = 'none';
        accountSummary.style.display = 'block';
        accountInputs.forEach(i => { i.required = false; i.disabled = true; });

        document.getElementById('summaryName').textContent = userData.name || '-';
        document.getElementById('summaryEmail').textContent = userData.email || '-';
        document.getElementById('summaryPhone').textContent = userData.phone || '-';

        const logoutLink = document.getElementById('logoutLink');
        if (logoutLink) {
            logoutLink.addEventListener('click', function (e) {
                e.preventDefault();
                localStorage.removeItem('iontoefl_user');
                localStorage.removeItem('iontoefl_login_time');
                window.location.href = LOGIN_REDIRECT;
            });
        }
    } else {
        // ① 비로그인 신규: 계정 생성 섹션 표시
        accountSection.style.display = 'block';
        accountSummary.style.display = 'none';
        accountInputs.forEach(i => { i.disabled = false; });

        setupNicknameCheck();
        setupEmailCheck();
        setupPhoneFormat();

        const goLoginLink = document.getElementById('goLoginLink');
        if (goLoginLink) {
            goLoginLink.addEventListener('click', function (e) {
                e.preventDefault();
                window.location.href = LOGIN_REDIRECT;
            });
        }
    }

    // 공통 설정
    setupNoScoreCheckbox('noScoreCheck', 'currentScore', '예: 75');
    setupNoScoreCheckbox('noTargetScoreCheck', 'targetScore', '예: 100');
    setupReferralSelect();
    setupKakaoTracking();
    setupAgreements();
    setupModals();
    loadLegalContent();
    setupSubmit();
}

// ===== 이용약관 / 개인정보 본문 DB 로드 (site_settings.default) =====
// 약관은 관리자가 수정할 수 있도록 코드가 아닌 DB에 보관한다.
// 셀 내용을 textContent로 넣어(자동 이스케이프) white-space:pre-wrap으로 줄바꿈 보존.
async function loadLegalContent() {
    const termsEl = document.getElementById('termsContent');
    const privacyEl = document.getElementById('privacyContent');
    if (!termsEl && !privacyEl) return;

    try {
        const rows = await supabaseAPI.query('site_settings', {
            'setting_key': 'eq.default',
            'select': 'terms_content,privacy_content',
            'limit': '1'
        });
        const s = (rows && rows[0]) ? rows[0] : {};
        const fallback = '약관 내용을 불러올 수 없습니다. 문의: messijessi@naver.com';

        if (termsEl) {
            termsEl.textContent = s.terms_content ? s.terms_content.replace(/\r\n/g, '\n') : fallback;
        }
        if (privacyEl) {
            privacyEl.textContent = s.privacy_content ? s.privacy_content.replace(/\r\n/g, '\n') : fallback;
        }
    } catch (e) {
        console.warn('약관 로드 실패:', e);
        const msg = '약관을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
        if (termsEl) termsEl.textContent = msg;
        if (privacyEl) privacyEl.textContent = msg;
    }
}

// ===== 닉네임 중복 체크 (register.js와 동일 규칙) =====
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
                'nickname': `eq.${encodeURIComponent(val)}`,
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
            nicknameAvailable = true; // 조회 실패 시 통과 (서버단 처리 가능)
        }
    }, 400);
}

function setupNicknameCheck() {
    const nicknameInput = document.getElementById('nickname');
    if (!nicknameInput) return;

    nicknameInput.addEventListener('compositionstart', () => { isComposing = true; });
    nicknameInput.addEventListener('compositionend', (e) => {
        isComposing = false;
        sanitizeNickname(e.target);
        checkNickname(e.target.value.trim());
    });
    nicknameInput.addEventListener('input', (e) => {
        // 한글 조합 중에는 sanitize만 건너뛰고(조합 깨짐 방지),
        // 중복 체크는 현재 값(조합 중인 글자 포함)으로 계속 수행한다.
        if (!isComposing) sanitizeNickname(e.target);
        checkNickname(e.target.value.trim());
    });
}

// ===== 이메일 중복 체크 (닉네임과 동일 패턴) =====
function checkEmailDup(val) {
    const status = document.getElementById('emailStatus');
    emailAvailable = false;
    if (!status) return;

    // 이메일 형식이 갖춰진 뒤에만 조회
    if (!validateEmail(val)) {
        status.textContent = '';
        return;
    }

    status.textContent = '확인 중...';
    status.style.color = '#94a3b8';

    clearTimeout(emailCheckTimer);
    emailCheckTimer = setTimeout(async () => {
        try {
            // 대소문자 무시 정확 매칭 (UNIQUE 인덱스 lower(email)과 일치, % 와일드카드 없음)
            const result = await supabaseAPI.query('users', {
                'email': `ilike.${encodeURIComponent(val)}`,
                'limit': '1'
            });
            if (result && result.length > 0) {
                status.textContent = '이미 가입됨';
                status.style.color = '#ef4444';
                emailAvailable = false;
            } else {
                status.textContent = '사용 가능';
                status.style.color = '#22c55e';
                emailAvailable = true;
            }
        } catch {
            status.textContent = '';
            emailAvailable = true; // 조회 실패 시 통과 (제출 시 재확인 + DB 제약으로 보호)
        }
    }, 400);
}

function setupEmailCheck() {
    const emailInput = document.getElementById('email');
    if (!emailInput) return;
    emailInput.addEventListener('input', (e) => {
        checkEmailDup(e.target.value.trim());
    });
}

// ===== 전화번호 자동 포맷 =====
function setupPhoneFormat() {
    const phone = document.getElementById('phone');
    if (!phone) return;
    phone.addEventListener('input', (e) => {
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

// ===== "아직 없음" 체크박스 =====
function setupNoScoreCheckbox(checkboxId, inputId, defaultPlaceholder) {
    const checkbox = document.getElementById(checkboxId);
    const scoreInput = document.getElementById(inputId);
    if (!checkbox || !scoreInput) return;

    checkbox.addEventListener('change', function () {
        if (this.checked) {
            scoreInput.value = '';
            scoreInput.disabled = true;
            scoreInput.placeholder = '점수 없음';
            scoreInput.style.background = '#f0f0f0';
        } else {
            scoreInput.disabled = false;
            scoreInput.placeholder = defaultPlaceholder;
            scoreInput.style.background = 'white';
        }
    });
}

// ===== 유입경로 "기타" 직접 입력 =====
function setupReferralSelect() {
    const sourceSelect = document.getElementById('referralSource');
    const sourceDetail = document.getElementById('referralSourceDetail');
    if (!sourceSelect || !sourceDetail) return;

    sourceSelect.addEventListener('change', function () {
        const input = sourceDetail.querySelector('input');
        if (this.value === '기타') {
            sourceDetail.style.display = 'block';
            if (input) input.required = true;
        } else {
            sourceDetail.style.display = 'none';
            if (input) { input.required = false; input.value = ''; }
        }
    });
}

// ===== 카카오 채널 추가 클릭 추적 =====
function setupKakaoTracking() {
    const btn = document.getElementById('kakaoChannelBtn');
    if (!btn) return;
    btn.addEventListener('click', function () { kakaoChannelClicked = true; });
}

// ===== 약관 동의 (전체동의 연동) =====
function setupAgreements() {
    const all = document.getElementById('agreeAll');
    const items = ['agreeTerms', 'agreePrivacy', 'agreeMarketing'].map(id => document.getElementById(id));

    if (all) {
        all.addEventListener('change', function () {
            items.forEach(cb => { if (cb) cb.checked = all.checked; });
        });
    }
    items.forEach(cb => {
        if (!cb) return;
        cb.addEventListener('change', function () {
            if (all) all.checked = items.every(c => c && c.checked);
        });
    });
}

// ===== 약관/개인정보 모달 =====
function setupModals() {
    bindModal('termsLink', 'termsModal', 'closeTermsModal');
    bindModal('privacyPolicyLink', 'privacyModal', 'closePrivacyModal');
}

function bindModal(linkId, modalId, closeId) {
    const link = document.getElementById(linkId);
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeId);
    if (!link || !modal) return;

    link.addEventListener('click', function (e) {
        e.preventDefault();
        modal.style.display = 'block';
    });
    if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', function (e) {
        if (e.target === modal) modal.style.display = 'none';
    });
}

// ===== 폼 제출 =====
function setupSubmit() {
    const form = document.getElementById('bookRequestForm');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        if (!validateBookForm()) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 신청 중...';
        showLoading(true);

        // 마케팅 동의 여부가 입문서 지급 여부를 결정한다.
        //   동의  → 회원가입 + 입문서 신청(book_only) 생성
        //   미동의 → 회원가입만 (입문서 신청 없음)
        const marketingChecked = document.getElementById('agreeMarketing').checked;

        try {
            // ── 비로그인 신규: 계정 먼저 생성 → 자동 로그인 ──
            if (state.mode === 'anonymous') {
                const created = await createAccount();
                if (!created) {
                    // createAccount 내부에서 안내/리다이렉트 처리됨
                    resetSubmitBtn(submitBtn);
                    showLoading(false);
                    return;
                }
                // 계정 생성 성공 → 이후 신청 저장 실패 시 ② 모드로 전환되도록 상태 갱신
                state.mode = 'loggedIn';
                state.user = created;
                switchToLoggedInUI(created);
            } else {
                // ② 로그인 사용자: 마케팅 동의 체크 시 users 갱신
                await maybeUpdateMarketingConsent(state.user);
            }

            // 호주/일반 선택 → 기본 입문서 트랙 저장 (마케팅 동의와 무관, best-effort)
            await saveIntroBookTrack(state.user);

            // ── 마케팅 동의 시에만 입문서 신청 저장 ──
            if (marketingChecked) {
                await saveApplication(state.user);
            }

            // 성공 (입문서 지급 여부에 따라 안내 다름)
            showLoading(false);
            showSuccess(marketingChecked);
            document.getElementById('formWrap').style.display = 'none';

        } catch (error) {
            console.error('신청 처리 오류:', error);
            showLoading(false);
            resetSubmitBtn(submitBtn);

            if (state.user) {
                // 계정은 있고 입문서 신청만 실패한 경우 (재시도 = ② 모드)
                showToast('계정은 정상적으로 만들어졌어요. 입문서 신청만 다시 시도해주세요.', 'error');
            } else {
                showToast('처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error');
            }
        }
    });
}

// 성공 모달 표시 (입문서 지급 여부에 따라 문구 변경)
function showSuccess(bookGranted) {
    const titleEl = document.getElementById('successTitle');
    const descEl = document.getElementById('successDesc');
    const btnEl = document.getElementById('successBtn');

    if (bookGranted) {
        if (titleEl) titleEl.textContent = '입문서가 준비되었습니다!';
        if (descEl) descEl.innerHTML = '지금 바로 읽어보세요.<br>토플 독학의 첫걸음을 시작합니다.';
        if (btnEl) btnEl.innerHTML = '<i class="fas fa-book-reader"></i> 읽기 시작하기';
    } else {
        if (titleEl) titleEl.textContent = '회원가입이 완료되었습니다!';
        if (descEl) descEl.innerHTML = '마이페이지에서 시크릿 정보 수신에 동의하시면<br>입문서를 바로 받아보실 수 있어요.';
        if (btnEl) btnEl.innerHTML = '<i class="fas fa-th-large"></i> 마이페이지로 가기';
    }
    document.getElementById('successModal').style.display = 'block';
}

function resetSubmitBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> 완료';
}

// ===== 토스트 알림 (스크롤 위치와 무관하게 상단 중앙 고정) =====
function showToast(message, type = 'error') {
    let toast = document.getElementById('brToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'brToast';
        toast.className = 'br-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('show', 'success', 'error');
    toast.classList.add(type);
    void toast.offsetWidth; // 애니메이션 재시작용 reflow
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// 계정 생성 실패 후 재시도를 위해 UI를 ② 로그인 모드로 전환
function switchToLoggedInUI(user) {
    const accountSection = document.getElementById('accountSection');
    const accountSummary = document.getElementById('accountSummary');
    accountSection.style.display = 'none';
    accountSection.querySelectorAll('input').forEach(i => { i.required = false; i.disabled = true; });
    accountSummary.style.display = 'block';
    document.getElementById('summaryName').textContent = user.name || '-';
    document.getElementById('summaryEmail').textContent = user.email || '-';
    document.getElementById('summaryPhone').textContent = user.phone || '-';
}

// ===== 계정 생성 (비로그인 신규) =====
// 성공 시 사용자 객체 반환, 실패/중단 시 null
async function createAccount() {
    const name = document.getElementById('name').value.trim();
    const nickname = document.getElementById('nickname').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const password = document.getElementById('password').value;

    // 닉네임 중복 최종 확인
    if (!nicknameAvailable) {
        showToast('닉네임 중복을 확인해주세요.', 'error');
        document.getElementById('nickname').focus();
        return null;
    }

    // 이메일 중복 확인 (register.js에는 없던 신규 안전장치)
    try {
        const existing = await supabaseAPI.query('users', {
            'email': `ilike.${encodeURIComponent(email)}`,
            'limit': '1'
        });
        if (existing && existing.length > 0) {
            const goLogin = confirm('이미 가입된 이메일이에요.\n로그인 후 신청하시겠어요?');
            if (goLogin) {
                window.location.href = LOGIN_REDIRECT;
            } else {
                document.getElementById('email').focus();
            }
            return null;
        }
    } catch (e) {
        console.warn('이메일 중복 조회 실패(계속 진행):', e);
        // 조회 실패 시에도 계정 생성은 시도 (DB UNIQUE 제약이 있으면 거기서 막힘)
    }

    const marketingChecked = document.getElementById('agreeMarketing').checked;

    const newUser = {
        name: name,
        nickname: nickname,
        email: email,
        phone: phone,
        password: password,
        level: 2,
        blocked: false,
        role: 'user',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
        marketing_consent: marketingChecked,
        marketing_consent_at: marketingChecked ? new Date().toISOString() : null
    };

    const result = await supabaseAPI.post('users', newUser);
    if (!result) throw new Error('계정 생성 실패');

    // 자동 로그인 세션 저장
    const session = {
        id: result.id,
        name: result.name,
        nickname: result.nickname || '',
        email: result.email,
        phone: result.phone,
        level: result.level || 2,
        role: result.role || 'user'
    };
    localStorage.setItem('iontoefl_user', JSON.stringify(session));
    localStorage.setItem('iontoefl_login_time', Date.now().toString());

    return session;
}

// ===== 로그인 사용자: 마케팅 동의 체크 시 users 갱신 =====
async function maybeUpdateMarketingConsent(user) {
    const checked = document.getElementById('agreeMarketing').checked;
    if (!checked || !user || !user.id) return; // 동의했을 때만 부여 (의도치 않은 철회 방지)
    try {
        await supabaseAPI.patch('users', user.id, {
            marketing_consent: true,
            marketing_consent_at: new Date().toISOString()
        });
    } catch (e) {
        console.warn('마케팅 동의 갱신 실패(신청은 계속 진행):', e);
    }
}

// ===== 입문서 신청 저장 (applications, application_type: 'book_only') =====
async function saveApplication(user) {
    // 현재 점수
    const noScoreCheck = document.getElementById('noScoreCheck');
    const scoreInput = document.getElementById('currentScore');
    let currentScore = null;
    if (!noScoreCheck.checked && scoreInput.value.trim() !== '') {
        currentScore = parseInt(scoreInput.value, 10);
        if (isNaN(currentScore)) currentScore = null;
    }

    // 목표 점수
    const noTargetScoreCheck = document.getElementById('noTargetScoreCheck');
    const targetScoreInput = document.getElementById('targetScore');
    let targetScore = null;
    const noTargetScore = noTargetScoreCheck.checked;
    if (!noTargetScore && targetScoreInput.value.trim() !== '') {
        targetScore = parseInt(targetScoreInput.value, 10);
        if (isNaN(targetScore)) targetScore = null;
    }

    // 유입 경로
    const referralSource = document.getElementById('referralSource').value;
    const referralSourceDetailInput = document.querySelector('input[name="referral_source_detail"]');
    const referralSourceDetail = (referralSource === '기타' && referralSourceDetailInput)
        ? (referralSourceDetailInput.value.trim() || null)
        : null;

    // referrer/UTM
    let referrerInfo = {};
    try {
        referrerInfo = JSON.parse(sessionStorage.getItem('book_request_referrer_info') || '{}');
    } catch { referrerInfo = {}; }

    // 기존 book_only 레코드와 동일한 필드 구조 유지 (관리자 페이지 호환)
    const postData = {
        user_id: user.id,
        user_email: user.email,
        name: user.name,
        phone: user.phone,
        email: user.email,
        application_type: 'book_only',
        program: '입문서 무료 신청',
        status: '승인완료',
        confirmed: true,
        current_score: currentScore,
        target_score: targetScore,
        no_target_score: noTargetScore,
        referral_source: referralSource,
        referral_source_detail: referralSourceDetail,
        privacy_agreement: true,
        submitted_date: new Date().toISOString(),
        current_step: 10,
        kakao_channel_clicked: kakaoChannelClicked,
        referrer_url: referrerInfo.referrer_url || null,
        landing_url: referrerInfo.landing_url || null,
        utm_data: referrerInfo.utm_data || null,
        user_agent: referrerInfo.user_agent || null
    };

    await supabaseAPI.post('applications', postData);
}

// ===== 유효성 검증 =====
function validateBookForm() {
    // 계정 필드 (비로그인 신규만)
    if (state.mode === 'anonymous') {
        const name = document.getElementById('name').value.trim();
        const nickname = document.getElementById('nickname').value.trim();
        const email = document.getElementById('email').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const password = document.getElementById('password').value;

        if (!name) { showToast('이름을 입력해주세요.', 'error'); focusEl('name'); return false; }
        if (nickname.length < 2) { showToast('닉네임을 2자 이상 입력해주세요.', 'error'); focusEl('nickname'); return false; }
        if (!email || !validateEmail(email)) { showToast('올바른 이메일을 입력해주세요.', 'error'); focusEl('email'); return false; }
        if (!phone) { showToast('전화번호를 입력해주세요.', 'error'); focusEl('phone'); return false; }
        if (!password || password.length < 6) { showToast('비밀번호를 6자 이상 입력해주세요.', 'error'); focusEl('password'); return false; }
    }

    // 현재 점수
    const noScoreCheck = document.getElementById('noScoreCheck');
    const currentScoreInput = document.getElementById('currentScore');
    if (!noScoreCheck.checked && currentScoreInput.value.trim() === '') {
        showToast('현재 토플 점수를 입력하거나 "아직 없음"을 체크해주세요.', 'error');
        currentScoreInput.focus();
        return false;
    }

    // 목표 점수
    const noTargetScoreCheck = document.getElementById('noTargetScoreCheck');
    const targetScoreInput = document.getElementById('targetScore');
    if (!noTargetScoreCheck.checked && targetScoreInput.value.trim() === '') {
        showToast('목표 토플 점수를 입력하거나 "아직 정하지 않음"을 체크해주세요.', 'error');
        targetScoreInput.focus();
        return false;
    }

    // 유입 경로
    const referralSource = document.getElementById('referralSource');
    if (!referralSource.value) {
        showToast('이온토플을 알게 된 경로를 선택해주세요.', 'error');
        referralSource.focus();
        return false;
    }
    if (referralSource.value === '기타') {
        const detail = document.querySelector('input[name="referral_source_detail"]');
        if (detail && !detail.value.trim()) {
            showToast('알게 된 경로를 직접 입력해주세요.', 'error');
            detail.focus();
            return false;
        }
    }

    // 카카오 채널 추가는 선택 항목 (제출을 막지 않음)

    // 호주/뉴질랜드 직접 제출 여부 (입문서 종류 결정)
    if (!document.querySelector('input[name="is_au_nz_direct_submit"]:checked')) {
        showToast('호주/뉴질랜드 직접 제출 여부를 선택해주세요.', 'error');
        return false;
    }

    // 필수 약관 동의
    if (!document.getElementById('agreeTerms').checked) {
        showToast('이용약관에 동의해주세요.', 'error');
        return false;
    }
    if (!document.getElementById('agreePrivacy').checked) {
        showToast('개인정보 수집 및 이용에 동의해주세요.', 'error');
        return false;
    }

    return true;
}

function focusEl(id) {
    const el = document.getElementById(id);
    if (el) el.focus();
}

// ===== 호주/뉴질랜드 안내 토글 =====
function toggleAuNzTooltip() {
    const content = document.getElementById('auNzTooltipContent');
    if (content) content.style.display = content.style.display === 'none' ? 'block' : 'none';
}

// 라디오 선택값 → 입문서 트랙('australia' | 'regular')
function getAuNzTrack() {
    const checked = document.querySelector('input[name="is_au_nz_direct_submit"]:checked');
    return checked && checked.value === 'yes' ? 'australia' : 'regular';
}

// 기본 입문서 트랙을 계정에 저장 (마케팅 동의와 무관, best-effort).
// users.intro_book_track 컬럼이 아직 없으면 조용히 무시된다(계정 생성에는 영향 없음).
async function saveIntroBookTrack(user) {
    if (!user || !user.id) return;
    const track = getAuNzTrack();
    try {
        await supabaseAPI.patch('users', user.id, { intro_book_track: track });
    } catch (e) {
        console.warn('입문서 트랙 저장 실패(무시):', e);
    }
}
