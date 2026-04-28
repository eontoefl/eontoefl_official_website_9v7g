// Book Request Form JavaScript
// 입문서 무료 신청 전용 페이지 로직

// ===== 0. 페이지 진입 즉시 referrer / UTM / userAgent 캐시 =====
// 로그인 리다이렉트로 인해 referrer가 사라지는 것을 방지하기 위해
// DOMContentLoaded 이전(스크립트 로드 시점)에 sessionStorage에 저장
(function cacheReferrerInfo() {
    try {
        const STORAGE_KEY = 'book_request_referrer_info';

        // 이미 캐시되어 있으면 덮어쓰지 않음 (로그인 후 돌아왔을 때 보존)
        if (sessionStorage.getItem(STORAGE_KEY)) return;

        // UTM 파라미터 파싱
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

document.addEventListener('DOMContentLoaded', async function () {

    // ===== 1. 로그인 확인 =====
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');

    if (!userData) {
        // 비로그인 → 로그인 페이지로 리다이렉트 (복귀 URL 포함)
        window.location.href = 'login.html?redirect=book-request.html';
        return;
    }

    // ===== 2. 진입 차단 조건 확인 =====
    try {
        // 해당 사용자의 모든 신청서 조회
        const applications = await supabaseAPI.query('applications', {
            'user_email': `eq.${userData.email}`,
            'order': 'created_at.desc'
        });

        // 2-a. 기존 내벨업챌린지 신청자 차단
        // application_type이 'book_only'가 아닌 레코드가 있으면 챌린지 사용자
        const challengeApp = (applications || []).find(app =>
            app.application_type !== 'book_only'
        );

        if (challengeApp) {
            showBlockScreen('challengeUserBlock');
            return;
        }

        // 2-b. 이미 입문서를 신청한 사용자 차단
        const bookApp = (applications || []).find(app =>
            app.application_type === 'book_only'
        );

        if (bookApp) {
            showBlockScreen('alreadyAppliedBlock');
            return;
        }

        // ===== 3. 신청 폼 표시 =====
        showForm();

    } catch (error) {
        console.error('신청서 조회 오류:', error);
        // 오류 발생 시에도 폼은 표시 (중복 방지는 서버에서도 처리 가능)
        showForm();
    }

    // ===== 함수 정의 =====

    // 차단 화면 표시
    function showBlockScreen(blockId) {
        document.getElementById('bookRequestForm').style.display = 'none';
        document.getElementById(blockId).style.display = 'block';
    }

    // 폼 표시 및 초기화
    function showForm() {
        const form = document.getElementById('bookRequestForm');
        form.style.display = 'block';

        // 사용자 정보 자동 채움 (읽기 전용)
        const nameInput = form.querySelector('input[name="name"]');
        const emailInput = form.querySelector('input[name="email"]');
        const phoneInput = form.querySelector('input[name="phone"]');

        if (nameInput) nameInput.value = userData.name || '';
        if (emailInput) emailInput.value = userData.email || '';
        if (phoneInput) phoneInput.value = userData.phone || '';

        // "아직 없음" 체크박스 토글 (현재점수 / 목표점수)
        setupNoScoreCheckbox('noScoreCheck', 'currentScore', '예: 75');
        setupNoScoreCheckbox('noTargetScoreCheck', 'targetScore', '예: 100');

        // "기타" 선택 시 직접 입력 필드 표시 (유입경로만 남음)
        setupConditionalSelects();

        // 카카오 채널 추가 버튼 클릭 추적
        setupKakaoChannelTracking();

        // 개인정보 모달
        setupPrivacyModal();

        // 폼 제출 핸들러
        setupFormSubmission();
    }

    // "아직 없음" 체크박스 (재사용 가능한 형태로 변경)
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

    // select → "기타" 선택 시 detail input 표시 (유입경로만)
    function setupConditionalSelects() {
        // 유입 경로
        const sourceSelect = document.getElementById('referralSource');
        const sourceDetail = document.getElementById('referralSourceDetail');

        if (sourceSelect && sourceDetail) {
            sourceSelect.addEventListener('change', function () {
                if (this.value === '기타') {
                    sourceDetail.style.display = 'block';
                    sourceDetail.querySelector('input').required = true;
                } else {
                    sourceDetail.style.display = 'none';
                    sourceDetail.querySelector('input').required = false;
                    sourceDetail.querySelector('input').value = '';
                }
            });
        }
    }

    // 카카오 채널 추가 버튼 클릭 추적 (내부 상태만 변경, UI 변화 없음)
    let kakaoChannelClicked = false;

    function setupKakaoChannelTracking() {
        const btn = document.getElementById('kakaoChannelBtn');
        if (!btn) return;

        btn.addEventListener('click', function () {
            // 새 창은 href로 자동 열림. 내부적으로 클릭 상태만 기록.
            kakaoChannelClicked = true;
        });
    }

    // 개인정보 처리방침 모달
    function setupPrivacyModal() {
        const privacyModal = document.getElementById('privacyModal');
        const privacyPolicyLink = document.getElementById('privacyPolicyLink');
        const closePrivacyModal = document.getElementById('closePrivacyModal');

        if (!privacyPolicyLink || !privacyModal || !closePrivacyModal) return;

        privacyPolicyLink.addEventListener('click', function (e) {
            e.preventDefault();
            privacyModal.style.display = 'block';
        });

        closePrivacyModal.addEventListener('click', function () {
            privacyModal.style.display = 'none';
        });

        window.addEventListener('click', function (e) {
            if (e.target === privacyModal) {
                privacyModal.style.display = 'none';
            }
        });
    }

    // 폼 제출 처리
    function setupFormSubmission() {
        const form = document.getElementById('bookRequestForm');
        const submitBtn = document.getElementById('submitBtn');

        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            // 유효성 검증
            if (!validateForm()) return;

            // 제출 버튼 비활성화 (중복 클릭 방지)
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 신청 중...';

            try {
                // 현재 점수 처리
                const noScoreCheck = document.getElementById('noScoreCheck');
                const scoreInput = document.getElementById('currentScore');
                let currentScore = null;

                if (!noScoreCheck.checked && scoreInput.value.trim() !== '') {
                    currentScore = parseInt(scoreInput.value, 10);
                    if (isNaN(currentScore)) currentScore = null;
                }

                // 목표 점수 처리
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
                    ? referralSourceDetailInput.value.trim() || null
                    : null;

                // sessionStorage에서 referrer/UTM 정보 꺼내기
                let referrerInfo = {};
                try {
                    referrerInfo = JSON.parse(sessionStorage.getItem('book_request_referrer_info') || '{}');
                } catch (e) {
                    referrerInfo = {};
                }

                // 데이터 구성
                const postData = {
                    user_id: userData.id,
                    user_email: userData.email,
                    name: userData.name,
                    phone: userData.phone,
                    email: userData.email,
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
                    // 카카오 채널 추가 클릭 여부
                    kakao_channel_clicked: kakaoChannelClicked,
                    // 유입 정보
                    referrer_url: referrerInfo.referrer_url || null,
                    landing_url: referrerInfo.landing_url || null,
                    utm_data: referrerInfo.utm_data || null,
                    user_agent: referrerInfo.user_agent || null
                };

                // API 호출
                await supabaseAPI.post('applications', postData);

                // 성공 모달 표시
                document.getElementById('successModal').style.display = 'block';
                form.style.display = 'none';

            } catch (error) {
                console.error('신청 제출 오류:', error);
                alert('신청 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 입문서 신청하기';
            }
        });
    }

    // 폼 유효성 검증
    function validateForm() {
        // 현재 점수 확인 (점수 입력 또는 "아직 없음" 체크 필수)
        const noScoreCheck = document.getElementById('noScoreCheck');
        const currentScoreInput = document.getElementById('currentScore');
        if (!noScoreCheck.checked && currentScoreInput.value.trim() === '') {
            alert('현재 토플 점수를 입력하거나 "아직 없음"을 체크해주세요.');
            currentScoreInput.focus();
            return false;
        }

        // 목표 점수 확인 (점수 입력 또는 "아직 정하지 않음" 체크 필수)
        const noTargetScoreCheck = document.getElementById('noTargetScoreCheck');
        const targetScoreInput = document.getElementById('targetScore');
        if (!noTargetScoreCheck.checked && targetScoreInput.value.trim() === '') {
            alert('목표 토플 점수를 입력하거나 "아직 정하지 않음"을 체크해주세요.');
            targetScoreInput.focus();
            return false;
        }

        // 유입 경로 선택 확인
        const referralSource = document.getElementById('referralSource');
        if (!referralSource.value) {
            alert('이온토플을 알게 된 경로를 선택해주세요.');
            referralSource.focus();
            return false;
        }

        // "기타" 선택 시 직접 입력 확인
        if (referralSource.value === '기타') {
            const detail = document.querySelector('input[name="referral_source_detail"]');
            if (detail && !detail.value.trim()) {
                alert('알게 된 경로를 직접 입력해주세요.');
                detail.focus();
                return false;
            }
        }

        // 카카오 채널 추가 확인 (필수)
        if (!kakaoChannelClicked) {
            alert('❗ 입문서를 받으시려면 먼저 카카오 채널을 추가해주세요.\n\n노란색 "이온토플 카카오 채널 추가하기" 버튼을 눌러주세요.');
            const kakaoBtn = document.getElementById('kakaoChannelBtn');
            if (kakaoBtn) kakaoBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
        }

        // 개인정보 동의 확인
        const privacyAgreement = document.getElementById('privacyAgreement');
        if (!privacyAgreement.checked) {
            alert('개인정보 수집 및 이용에 동의해주세요.');
            privacyAgreement.focus();
            return false;
        }

        return true;
    }
});
