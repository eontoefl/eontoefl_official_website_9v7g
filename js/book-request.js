// Book Request Form JavaScript
// 입문서 무료 신청 전용 페이지 로직

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

        // "아직 없음" 체크박스 토글
        setupNoScoreCheckbox();

        // "기타" 선택 시 직접 입력 필드 표시
        setupConditionalSelects();

        // 개인정보 모달
        setupPrivacyModal();

        // 폼 제출 핸들러
        setupFormSubmission();
    }

    // "아직 없음" 체크박스
    function setupNoScoreCheckbox() {
        const noScoreCheck = document.getElementById('noScoreCheck');
        const scoreInput = document.getElementById('currentScore');

        if (!noScoreCheck || !scoreInput) return;

        noScoreCheck.addEventListener('change', function () {
            if (this.checked) {
                scoreInput.value = '';
                scoreInput.disabled = true;
                scoreInput.placeholder = '점수 없음';
                scoreInput.style.background = '#f0f0f0';
            } else {
                scoreInput.disabled = false;
                scoreInput.placeholder = '예: 75';
                scoreInput.style.background = 'white';
            }
        });
    }

    // select → "기타" 선택 시 detail input 표시
    function setupConditionalSelects() {
        // 토플 필요 이유
        const reasonSelect = document.getElementById('toeflReason');
        const reasonDetail = document.getElementById('toeflReasonDetail');

        if (reasonSelect && reasonDetail) {
            reasonSelect.addEventListener('change', function () {
                if (this.value === '기타') {
                    reasonDetail.style.display = 'block';
                    reasonDetail.querySelector('input').required = true;
                } else {
                    reasonDetail.style.display = 'none';
                    reasonDetail.querySelector('input').required = false;
                    reasonDetail.querySelector('input').value = '';
                }
            });
        }

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
                // 점수값 처리
                const noScoreCheck = document.getElementById('noScoreCheck');
                const scoreInput = document.getElementById('currentScore');
                let currentScore = null;

                if (!noScoreCheck.checked && scoreInput.value.trim() !== '') {
                    currentScore = parseInt(scoreInput.value, 10);
                    if (isNaN(currentScore)) currentScore = null;
                }

                // 토플 이유
                const toeflReason = document.getElementById('toeflReason').value;
                const toeflReasonDetailInput = document.querySelector('input[name="toefl_reason_detail"]');
                const toeflReasonDetail = (toeflReason === '기타' && toeflReasonDetailInput)
                    ? toeflReasonDetailInput.value.trim() || null
                    : null;

                // 유입 경로
                const referralSource = document.getElementById('referralSource').value;
                const referralSourceDetailInput = document.querySelector('input[name="referral_source_detail"]');
                const referralSourceDetail = (referralSource === '기타' && referralSourceDetailInput)
                    ? referralSourceDetailInput.value.trim() || null
                    : null;

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
                    toefl_reason: toeflReason,
                    toefl_reason_detail: toeflReasonDetail,
                    referral_source: referralSource,
                    referral_source_detail: referralSourceDetail,
                    privacy_agreement: true,
                    submitted_date: new Date().toISOString(),
                    current_step: 10
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
        // 토플 이유 선택 확인
        const toeflReason = document.getElementById('toeflReason');
        if (!toeflReason.value) {
            alert('토플이 필요한 이유를 선택해주세요.');
            toeflReason.focus();
            return false;
        }

        // "기타" 선택 시 직접 입력 확인
        if (toeflReason.value === '기타') {
            const detail = document.querySelector('input[name="toefl_reason_detail"]');
            if (detail && !detail.value.trim()) {
                alert('토플이 필요한 이유를 직접 입력해주세요.');
                detail.focus();
                return false;
            }
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
