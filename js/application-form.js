// Application Form JavaScript

// n8n AI 자동분석 웹훅 URL
const N8N_WEBHOOK_URL = 'https://eontoefl.app.n8n.cloud/webhook/eontoefl-application-webhook';

// 편집 모드 전역 변수
let isEditMode = false;
let editApplicationId = null;

// 목표점수 없음 체크박스 토글
function toggleTargetScore(checked) {
    const allTargetInputs = document.querySelectorAll(
        '#newTargetSection input[type="number"], #oldTargetSection input[type="number"]'
    );
    const versionTabs = document.querySelectorAll('[data-tab="old-target"], [data-tab="new-target"]');
    const targetNote = document.querySelector('textarea[name="target_note"]');

    if (checked) {
        // 비활성화 (값은 보존)
        allTargetInputs.forEach(input => {
            input.disabled = true;
            input.required = false;
            input.style.opacity = '0.4';
            input.style.pointerEvents = 'none';
        });
        versionTabs.forEach(tab => {
            tab.disabled = true;
            tab.style.opacity = '0.4';
            tab.style.pointerEvents = 'none';
        });
        if (targetNote) {
            targetNote.disabled = true;
            targetNote.required = false;
            targetNote.style.opacity = '0.4';
        }
    } else {
        // 활성화
        allTargetInputs.forEach(input => {
            input.disabled = false;
            input.style.opacity = '1';
            input.style.pointerEvents = 'auto';
        });
        versionTabs.forEach(tab => {
            tab.disabled = false;
            tab.style.opacity = '1';
            tab.style.pointerEvents = 'auto';
        });
        if (targetNote) {
            targetNote.disabled = false;
            targetNote.required = true;
            targetNote.style.opacity = '1';
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    
    // Check if user is logged in
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    
    if (!userData) {
        alert('로그인이 필요합니다.');
        window.location.href = 'login.html?redirect=application-form.html';
        return;
    }

    // Pre-fill user information
    if (userData.name) {
        document.querySelector('input[name="name"]').value = userData.name;
    }
    if (userData.phone) {
        document.querySelector('input[name="phone"]').value = userData.phone;
    }
    if (userData.email) {
        document.querySelector('input[name="email"]').value = userData.email;
    }

    // Setup conditional field visibility handlers
    setupConditionalFields();
    
    // Setup score total calculation
    setupScoreTotalCalculation();

    // Privacy policy modal
    setupPrivacyModal();

    // Form submission
    setupFormSubmission();

    // Setup date dropdowns
    setupDateDropdowns();

    // 초기 상태: 비활성 탭의 required 해제
    cleanupInactiveTabRequired();

    // 편집 모드 확인 (URL 파라미터 ?edit=ID)
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    if (editId) {
        initEditMode(editId);
    } else {
        // 새 신청서 작성 시에만 자동 저장
        setupAutoSave();
    }
});

// Setup conditional field visibility
function setupConditionalFields() {
    
    // Occupation - no longer needed (changed to text input)
    
    // TOEFL score section - Show/Hide based on yes/no
    const toeflScoreRadios = document.querySelectorAll('input[name="has_toefl_score"]');
    const toeflScoreSection = document.getElementById('toeflScoreSection');
    const writingSection = document.getElementById('writingSection');
    
    toeflScoreRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const scoreHistory = document.querySelector('textarea[name="score_history"]');
            if (this.value === 'yes') {
                // Has score - show score section, hide writing section
                toeflScoreSection.style.display = 'block';
                writingSection.style.display = 'none';
                
                // Make writing fields optional
                document.querySelector('textarea[name="writing_sample_1"]').required = false;
                document.querySelector('textarea[name="writing_sample_2"]').required = false;

                // 점수 관련 상세 설명 필수
                if (scoreHistory) scoreHistory.required = true;

                // 현재 토플 점수 총점은 required 설정하지 않음 (validateForm에서 커스텀 검증)
            } else {
                // No score - hide score section, show writing section
                toeflScoreSection.style.display = 'none';
                writingSection.style.display = 'block';
                
                // Make writing fields required
                document.querySelector('textarea[name="writing_sample_1"]').required = true;
                document.querySelector('textarea[name="writing_sample_2"]').required = true;
                
                // Remove ALL score field requirements
                const scoreInputs = toeflScoreSection.querySelectorAll('input');
                scoreInputs.forEach(input => input.required = false);

                // 점수 관련 상세 설명 required 해제
                if (scoreHistory) scoreHistory.required = false;
            }
        });
    });

    // Tab system for score version
    const scoreTabs = document.querySelectorAll('[data-tab="old-score"], [data-tab="new-score"]');
    scoreTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            const isOld = tabName === 'old-score';
            
            // Update tabs
            scoreTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Update hidden input
            document.querySelector('input[name="score_version"]').value = isOld ? 'old' : 'new';
            
            // Show/hide sections
            document.getElementById('oldScoreSection').classList.toggle('active', isOld);
            document.getElementById('newScoreSection').classList.toggle('active', !isOld);
            
            // Update required fields - 활성 탭의 총점만 필수, 비활성 탭은 모두 해제
            const oldTotal = document.querySelector('input[name="score_total_old"]');
            const newTotal = document.querySelector('input[name="score_total_new"]');
            
            // 모든 점수 필드 required 해제 (validateForm에서 커스텀 검증)
            const oldAllInputs = document.getElementById('oldScoreSection').querySelectorAll('input');
            const newAllInputs = document.getElementById('newScoreSection').querySelectorAll('input');
            oldAllInputs.forEach(input => input.required = false);
            newAllInputs.forEach(input => input.required = false);
        });
    });

    // Tab system for target version
    const targetTabs = document.querySelectorAll('[data-tab="old-target"], [data-tab="new-target"]');
    targetTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            const isOld = tabName === 'old-target';
            
            // Update tabs
            targetTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Update hidden input
            const targetVersionInput = document.querySelector('input[name="target_version"]');
            if (targetVersionInput) {
                targetVersionInput.value = isOld ? 'old' : 'new';
            }
            
            // Show/hide sections
            document.getElementById('oldTargetSection').classList.toggle('active', isOld);
            document.getElementById('newTargetSection').classList.toggle('active', !isOld);
            
            // 비활성 탭의 모든 required 해제
            const oldTargetInputs = document.getElementById('oldTargetSection').querySelectorAll('input');
            const newTargetInputs = document.getElementById('newTargetSection').querySelectorAll('input');
            oldTargetInputs.forEach(input => input.required = false);
            newTargetInputs.forEach(input => input.required = false);
        });
    });

    // Format new TOEFL score inputs to always show .0 for whole numbers
    const newScoreInputs = document.querySelectorAll('input[name="target_cutoff_new"], input[name="target_reading_new"], input[name="target_listening_new"], input[name="target_writing_new"], input[name="target_speaking_new"], input[name="score_reading_new"], input[name="score_listening_new"], input[name="score_writing_new"], input[name="score_speaking_new"], input[name="score_total_new"]');
    
    newScoreInputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.value && !this.value.includes('.')) {
                // If it's a whole number without decimal, add .0
                this.value = parseFloat(this.value).toFixed(1);
            } else if (this.value && this.value.includes('.')) {
                // Ensure it's formatted to 1 decimal place
                this.value = parseFloat(this.value).toFixed(1);
            }
        });
        
        input.addEventListener('change', function() {
            if (this.value && !this.value.includes('.')) {
                this.value = parseFloat(this.value).toFixed(1);
            } else if (this.value && this.value.includes('.')) {
                this.value = parseFloat(this.value).toFixed(1);
            }
        });
    });

    // Referral from friend
    const referralFriendRadios = document.querySelectorAll('input[name="referral_from_friend"]');
    const referralFriendNameGroup = document.getElementById('referralFriendNameGroup');
    const referralFriendNameInput = document.querySelector('input[name="referral_friend_name"]');
    const referralFriendNameStar = document.getElementById('referralFriendNameStar');

    if (referralFriendRadios.length > 0) {
        referralFriendRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'yes') {
                    referralFriendNameGroup.style.display = 'block';
                    if (referralFriendNameInput) {
                        referralFriendNameInput.required = true;
                        referralFriendNameInput.placeholder = '추천인 성함';
                    }
                    if (referralFriendNameStar) {
                        referralFriendNameStar.style.display = 'inline';
                    }
                } else {
                    referralFriendNameGroup.style.display = 'none';
                    if (referralFriendNameInput) {
                        referralFriendNameInput.required = false;
                        referralFriendNameInput.placeholder = '추천인 성함 (선택)';
                    }
                    if (referralFriendNameStar) {
                        referralFriendNameStar.style.display = 'none';
                    }
                }
            });
        });
    }
}

// Setup Score Total Calculation (직접 기입 방식 - 자동계산 없음)
function setupScoreTotalCalculation() {
    // 총점 직접 입력 방식이므로 별도 계산 로직 불필요
}

// 비활성 탭의 모든 required 해제
function cleanupInactiveTabRequired() {
    const sections = ['oldScoreSection', 'newScoreSection', 'oldTargetSection', 'newTargetSection'];
    sections.forEach(id => {
        const section = document.getElementById(id);
        if (section && !section.classList.contains('active')) {
            section.querySelectorAll('input[required]').forEach(input => {
                input.required = false;
            });
        }
    });
}

// Setup privacy policy modal
function setupPrivacyModal() {
    const privacyModal = document.getElementById('privacyModal');
    const privacyPolicyLink = document.getElementById('privacyPolicyLink');
    const closePrivacyModal = document.getElementById('closePrivacyModal');

    privacyPolicyLink.addEventListener('click', function(e) {
        e.preventDefault();
        privacyModal.style.display = 'block';
    });

    closePrivacyModal.addEventListener('click', function() {
        privacyModal.style.display = 'none';
    });

    window.addEventListener('click', function(e) {
        if (e.target === privacyModal) {
            privacyModal.style.display = 'none';
        }
    });
}

// 편집 모드 초기화
async function initEditMode(appId) {
    isEditMode = true;
    editApplicationId = appId;

    // UI 변경: 상단에 수정 중 배너 표시
    const formHeader = document.querySelector('.form-header');
    if (formHeader) {
        const editBanner = document.createElement('div');
        editBanner.id = 'editModeBanner';
        editBanner.style.cssText = 'background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #f59e0b; border-radius: 10px; padding: 14px 20px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;';
        editBanner.innerHTML = `
            <i class="fas fa-pen-to-square" style="color: #d97706; font-size: 20px;"></i>
            <div>
                <strong style="color: #92400e; font-size: 15px;">신청서 수정 모드</strong>
                <p style="color: #a16207; font-size: 13px; margin: 2px 0 0 0;">기존에 제출한 내용을 수정하고 있습니다. 수정 후 하단의 "수정하기" 버튼을 눌러주세요.</p>
            </div>
        `;
        formHeader.insertAdjacentElement('afterend', editBanner);
    }

    // 버튼 변경: 제출 → 수정하기
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-check"></i> 수정하기';
    }

    // 페이지 타이틀 변경
    document.title = '신청서 수정 - 이온토플';
    const formTitle = document.querySelector('.form-header h1');
    if (formTitle) {
        formTitle.textContent = '신청서 수정';
    }

    // 기존 데이터 불러오기
    try {
        const app = await supabaseAPI.getById('applications', appId);
        if (!app) {
            alert('신청서를 찾을 수 없습니다.');
            window.location.href = 'application.html';
            return;
        }

        // 본인 신청서인지 확인 (관리자는 모든 신청서 수정 가능)
        const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
        if (!userData || (userData.role !== 'admin' && app.email !== userData.email)) {
            alert('본인의 신청서만 수정할 수 있습니다.');
            window.location.href = 'application.html';
            return;
        }

        // 개별분석 등록 여부 확인 (관리자는 수정 가능)
        if (userData.role !== 'admin' && app.analysis_status && app.analysis_content) {
            alert('개별분석이 이미 등록되어 수정할 수 없습니다.');
            window.location.href = 'application.html';
            return;
        }

        // 폼에 데이터 채우기
        populateFormData(app);

    } catch (error) {
        console.error('Failed to load application for editing:', error);
        alert('신청서 데이터를 불러오는 데 실패했습니다.');
        window.location.href = 'application.html';
    }
}

// 기존 데이터로 폼 채우기
function populateFormData(app) {
    const form = document.getElementById('applicationForm');
    if (!form) return;

    // 텍스트/이메일/tel 입력 필드
    const textFields = [
        'application_title', 'name', 'phone', 'email', 'address', 'bank_account',
        'occupation', 'score_history', 'current_study_method',
        'target_note', 'toefl_reason_detail', 'memorable_blog_content',
        'preferred_program', 'preferred_correction', 'program_note',
        'give_up_plan', 'tell_plan',
        'referral_search_keyword', 'referral_social_media', 'referral_friend_name',
        'referral_other', 'additional_notes'
    ];

    textFields.forEach(field => {
        const input = form.querySelector(`[name="${field}"]`);
        if (input && app[field] !== null && app[field] !== undefined) {
            input.value = app[field];
        }
    });

    // 숫자 입력 필드 (점수)
    const numberFields = [
        'score_reading_old', 'score_listening_old', 'score_speaking_old', 'score_writing_old', 'score_total_old',
        'score_reading_new', 'score_listening_new', 'score_writing_new', 'score_speaking_new', 'score_total_new',
        'target_cutoff_new', 'target_reading_new', 'target_listening_new', 'target_writing_new', 'target_speaking_new',
        'target_cutoff_old', 'target_reading_old', 'target_listening_old', 'target_speaking_old', 'target_writing_old'
    ];

    numberFields.forEach(field => {
        const input = form.querySelector(`[name="${field}"]`);
        if (input && app[field] !== null && app[field] !== undefined) {
            input.value = app[field];
        }
    });

    // textarea 필드
    const textareaFields = ['writing_sample_1', 'writing_sample_2'];
    textareaFields.forEach(field => {
        const textarea = form.querySelector(`textarea[name="${field}"]`);
        if (textarea && app[field]) {
            textarea.value = app[field];
        }
    });

    // 라디오 버튼
    if (app.has_toefl_score) {
        const radio = form.querySelector(`input[name="has_toefl_score"][value="${app.has_toefl_score}"]`);
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }
    }

    // 호주/뉴질랜드 직접 제출 라디오
    if (app.is_au_nz_direct_submit) {
        const radio = form.querySelector(`input[name="is_au_nz_direct_submit"][value="${app.is_au_nz_direct_submit}"]`);
        if (radio) {
            radio.checked = true;
        }
    }

    // 지인 추천 라디오
    if (app.referral_from_friend) {
        const radio = form.querySelector(`input[name="referral_from_friend"][value="${app.referral_from_friend}"]`);
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }
    }

    // 체크박스
    if (app.privacy_agreement) {
        const cb = form.querySelector('input[name="privacy_agreement"]');
        if (cb) cb.checked = true;
    }

    // 선택 필드 (select)
    const selectFields = ['daily_study_time', 'toefl_reason'];
    selectFields.forEach(field => {
        const select = form.querySelector(`select[name="${field}"]`);
        if (select && app[field]) {
            select.value = app[field];
        }
    });

    // 점수 버전 탭 전환
    // DB에 score_version이 null/잘못된 경우: 실제 데이터로 판단
    let actualScoreVersion = app.score_version;
    
    if (!actualScoreVersion || actualScoreVersion === 'new') {
        // null이거나 new인데 실제 old 데이터만 있으면 → old
        if (!app.score_total_new && app.score_total_old) {
            actualScoreVersion = 'old';
        }
    }
    if (!actualScoreVersion || actualScoreVersion === 'old') {
        // null이거나 old인데 실제 new 데이터만 있으면 → new
        if (!app.score_total_old && app.score_total_new) {
            actualScoreVersion = 'new';
        }
    }
    // 그래도 null이면 기본값 old (HTML 기본 활성 탭)
    if (!actualScoreVersion) actualScoreVersion = 'old';
    
    const scoreTabName = actualScoreVersion === 'old' ? 'old-score' : 'new-score';
    const scoreTab = document.querySelector(`[data-tab="${scoreTabName}"]`);
    if (scoreTab) scoreTab.click();

    // 목표 점수 버전 탭 전환
    // DB에 target_version이 null/잘못된 경우: 실제 데이터로 판단
    let actualTargetVersion = app.target_version;
    
    if (!actualTargetVersion || actualTargetVersion === 'new') {
        if (!app.target_cutoff_new && app.target_cutoff_old) {
            actualTargetVersion = 'old';
        }
    }
    if (!actualTargetVersion || actualTargetVersion === 'old') {
        if (!app.target_cutoff_old && app.target_cutoff_new) {
            actualTargetVersion = 'new';
        }
    }
    // 그래도 null이면: 데이터가 있는 쪽, 둘다 없으면 기본 new (HTML 기본 활성 탭)
    if (!actualTargetVersion) {
        actualTargetVersion = app.target_cutoff_old ? 'old' : 'new';
    }
    
    const targetTabName = actualTargetVersion === 'old' ? 'old-target' : 'new-target';
    const targetTab = document.querySelector(`[data-tab="${targetTabName}"]`);
    if (targetTab) targetTab.click();

    // 🔒 안전장치: 비활성 탭의 모든 required를 강제 해제
    // (DB에 target_version이 잘못 저장된 경우 대비)
    setTimeout(() => {
        // 현재 토플 점수 - 비활성 탭
        const oldScoreSection = document.getElementById('oldScoreSection');
        const newScoreSection = document.getElementById('newScoreSection');
        if (oldScoreSection && !oldScoreSection.classList.contains('active')) {
            oldScoreSection.querySelectorAll('input').forEach(i => i.required = false);
        }
        if (newScoreSection && !newScoreSection.classList.contains('active')) {
            newScoreSection.querySelectorAll('input').forEach(i => i.required = false);
        }
        
        // 목표 점수 - 비활성 탭
        const oldTargetSection = document.getElementById('oldTargetSection');
        const newTargetSection = document.getElementById('newTargetSection');
        if (oldTargetSection && !oldTargetSection.classList.contains('active')) {
            oldTargetSection.querySelectorAll('input').forEach(i => i.required = false);
        }
        if (newTargetSection && !newTargetSection.classList.contains('active')) {
            newTargetSection.querySelectorAll('input').forEach(i => i.required = false);
        }

        // 목표점수 없음 체크박스 복원 (탭 전환 후 disabled 처리)
        if (app.no_target_score) {
            const noTargetCb = document.getElementById('noTargetScore');
            if (noTargetCb) {
                noTargetCb.checked = true;
                toggleTargetScore(true);
            }
        }
    }, 100);

    // 날짜 필드 (submission_deadline, preferred_completion)
    if (app.submission_deadline) {
        const parts = app.submission_deadline.split('-');
        if (parts[0]) {
            const yearSelect = form.querySelector('select[name="submission_deadline_year"]');
            if (yearSelect) yearSelect.value = parts[0];
        }
        if (parts[1]) {
            const monthSelect = form.querySelector('select[name="submission_deadline_month"]');
            if (monthSelect) monthSelect.value = parts[1];
        }
        if (parts[2]) {
            const daySelect = form.querySelector('select[name="submission_deadline_day"]');
            if (daySelect) daySelect.value = parts[2];
        }
    }

    if (app.preferred_completion) {
        const parts = app.preferred_completion.split('-');
        if (parts[0]) {
            const yearSelect = form.querySelector('select[name="preferred_completion_year"]');
            if (yearSelect) yearSelect.value = parts[0];
        }
        if (parts[1]) {
            const monthSelect = form.querySelector('select[name="preferred_completion_month"]');
            if (monthSelect) monthSelect.value = parts[1];
        }
        if (parts[2]) {
            const daySelect = form.querySelector('select[name="preferred_completion_day"]');
            if (daySelect) daySelect.value = parts[2];
        }
    }

    // 수업 시작 희망일
    if (app.preferred_start_date) {
        const startDateInput = form.querySelector('input[name="preferred_start_date"]');
        if (startDateInput) startDateInput.value = app.preferred_start_date;
    }
}

// Setup form submission
function setupFormSubmission() {
    const form = document.getElementById('applicationForm');
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Validate form
        if (!validateForm()) {
            return;
        }

        // Collect form data
        const formData = collectFormData();

        // Show loading state
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.innerHTML = isEditMode 
            ? '<i class="fas fa-spinner fa-spin"></i> 수정 중...'
            : '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
        submitBtn.disabled = true;

        try {
            let result;
            
            if (isEditMode && editApplicationId) {
                // 수정 모드: PATCH로 업데이트
                formData.updated_date = new Date().toISOString();
                result = await supabaseAPI.patch('applications', editApplicationId, formData);
                
                if (!result) {
                    throw new Error('신청서 수정에 실패했습니다.');
                }
                
                // 수정 완료 모달 표시
                showEditSuccessModal();
            } else {
                // 새 신청서: POST로 생성
                result = await supabaseAPI.post('applications', formData);

                if (!result) {
                    throw new Error('신청서 제출에 실패했습니다.');
                }

                // 텔레그램 알림 발송 (실패해도 신청서 제출에는 영향 없음)
                try {
                    await sendTelegramNotification(formData);
                } catch (notifyErr) {
                    console.warn('텔레그램 알림 발송 실패:', notifyErr);
                }

                // n8n AI 자동분석 웹훅 호출 (fire-and-forget: 응답을 기다리지 않음)
                const appId = Array.isArray(result) ? result[0]?.id : result?.id;
                if (appId) {
                    fetch(N8N_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...formData, app_id: appId })
                    }).catch(webhookErr => {
                        console.warn('n8n 웹훅 호출 실패:', webhookErr);
                    });
                }

                // Clear auto-saved data
                localStorage.removeItem(getDraftKey());

                // Show success modal
                showSuccessModal();
            }

        } catch (error) {
            console.error('Error submitting application:', error);
            alert(isEditMode ? '신청서 수정 중 오류가 발생했습니다. 다시 시도해주세요.' : '신청서 제출 중 오류가 발생했습니다. 다시 시도해주세요.');
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }
    });
}

// Validate form
function validateForm() {
    // Check if writing samples are required and valid (when no TOEFL score)
    const hasToeflScore = document.querySelector('input[name="has_toefl_score"]:checked');
    
    if (hasToeflScore && hasToeflScore.value === 'no') {
        const writingSample1 = document.querySelector('textarea[name="writing_sample_1"]').value.trim();
        const writingSample2 = document.querySelector('textarea[name="writing_sample_2"]').value.trim();

        if (writingSample1) {
            const sentences1 = writingSample1.split(/[.!?]+/).filter(s => s.trim().length > 0);
            if (sentences1.length < 5) {
                alert('영어 실력 평가 Question 1: 최소 5문장 이상 작성해주세요.');
                document.querySelector('textarea[name="writing_sample_1"]').focus();
                return false;
            }
        }

        if (writingSample2) {
            const sentences2 = writingSample2.split(/[.!?]+/).filter(s => s.trim().length > 0);
            if (sentences2.length < 5) {
                alert('영어 실력 평가 Question 2: 최소 5문장 이상 작성해주세요.');
                document.querySelector('textarea[name="writing_sample_2"]').focus();
                return false;
            }
        }
    }

    // Validate TOEFL scores if provided (old version)
    if (hasToeflScore && hasToeflScore.value === 'yes') {
        // 총점: 개정전 또는 개정후 중 하나는 입력해야 함
        const scoreTotalOld = document.querySelector('input[name="score_total_old"]');
        const scoreTotalNew = document.querySelector('input[name="score_total_new"]');
        const hasOldScore = scoreTotalOld && scoreTotalOld.value.trim() !== '';
        const hasNewScore = scoreTotalNew && scoreTotalNew.value.trim() !== '';
        
        if (!hasOldScore && !hasNewScore) {
            alert('현재 토플 점수의 Overall Score를 개정전 또는 개정후 중 하나는 입력해주세요.');
            return false;
        }

        const scoreVersion = document.querySelector('input[name="score_version"]:checked');
        
        if (scoreVersion && scoreVersion.value === 'old') {
            const scores = ['reading_old', 'listening_old', 'speaking_old', 'writing_old'];
            for (const section of scores) {
                const input = document.querySelector(`input[name="score_${section}"]`);
                if (input && input.value) {
                    const score = parseInt(input.value);
                    if (isNaN(score) || score < 0 || score > 30) {
                        alert(`${section.replace('_old', '').toUpperCase()} 점수는 0-30 사이여야 합니다.`);
                        return false;
                    }
                }
            }
        }
        
        // Validate new version scores
        if (scoreVersion && scoreVersion.value === 'new') {
            const scores = ['reading_new', 'listening_new', 'speaking_new', 'writing_new'];
            for (const section of scores) {
                const input = document.querySelector(`input[name="score_${section}"]`);
                if (input && input.value) {
                    const score = parseFloat(input.value);
                    if (isNaN(score) || score < 1 || score > 6 || (score % 0.5 !== 0)) {
                        alert(`${section.replace('_new', '').toUpperCase()} 점수는 1-6 사이의 0.5 단위여야 합니다.`);
                        return false;
                    }
                }
            }
        }
    }

    // 목표 점수: 개정후 또는 개정전 Total 중 하나는 입력해야 함
    // 단, "목표 점수 없음" 체크 시 검증 스킵
    const noTargetCb = document.getElementById('noTargetScore');
    const isNoTargetScore = noTargetCb && noTargetCb.checked;

    if (!isNoTargetScore) {
        const targetCutoffNew = document.querySelector('input[name="target_cutoff_new"]');
        const targetCutoffOld = document.querySelector('input[name="target_cutoff_old"]');
        const hasNewTarget = targetCutoffNew && targetCutoffNew.value.trim() !== '';
        const hasOldTarget = targetCutoffOld && targetCutoffOld.value.trim() !== '';

        if (!hasNewTarget && !hasOldTarget) {
            alert('목표 점수의 커트라인(Total)을 개정후 또는 개정전 중 하나는 입력해주세요.');
            // 현재 활성 탭의 input에 포커스
            const activeTarget = document.querySelector('.version-content.active input[name="target_cutoff_new"], .version-content.active input[name="target_cutoff_old"]');
            if (activeTarget) activeTarget.focus();
            return false;
        }
    }

    // 희망 수업 시작 시기: 일요일만 선택 가능
    const startDateInput = document.querySelector('input[name="preferred_start_date"]');
    if (startDateInput && startDateInput.value) {
        const selectedDate = new Date(startDateInput.value);
        if (selectedDate.getDay() !== 0) {
            alert('수업 시작일은 매주 일요일만 가능합니다. 일요일을 선택해주세요.');
            startDateInput.focus();
            return false;
        }
    }

    // 호주/뉴질랜드 직접 제출 여부 필수 체크
    const auNzRadio = document.querySelector('input[name="is_au_nz_direct_submit"]:checked');
    if (!auNzRadio) {
        alert('호주/뉴질랜드 기관 직접 제출 여부를 선택해주세요.');
        const firstAuNzRadio = document.querySelector('input[name="is_au_nz_direct_submit"]');
        if (firstAuNzRadio) firstAuNzRadio.focus();
        return false;
    }

    // 이온토플을 알게 된 경로: 최소 하나는 입력해야 함
    const referralSearchKeyword = (document.querySelector('input[name="referral_search_keyword"]')?.value || '').trim();
    const referralSocialMedia = (document.querySelector('select[name="referral_social_media"]')?.value || '').trim();
    const referralFromFriend = document.querySelector('input[name="referral_from_friend"]:checked')?.value;
    const referralFriendName = (document.querySelector('input[name="referral_friend_name"]')?.value || '').trim();
    const referralOther = (document.querySelector('textarea[name="referral_other"]')?.value || '').trim();

    const hasSearchKeyword = referralSearchKeyword !== '';
    const hasSocialMedia = referralSocialMedia !== '';
    const hasFriendReferral = referralFromFriend === 'yes' && referralFriendName !== '';
    const hasOther = referralOther !== '';

    if (!hasSearchKeyword && !hasSocialMedia && !hasFriendReferral && !hasOther) {
        // 지인 추천 "예"인데 추천인 성함이 비어있는 경우 안내 분기
        if (referralFromFriend === 'yes' && referralFriendName === '') {
            alert('지인 추천을 "예"로 선택하셨다면 추천인 성함을 입력해주세요.');
            const friendNameInput = document.querySelector('input[name="referral_friend_name"]');
            if (friendNameInput) friendNameInput.focus();
            return false;
        }
        alert('이온토플을 알게 된 경로를 최소 하나 이상 입력해주세요.');
        const searchKeywordInput = document.querySelector('input[name="referral_search_keyword"]');
        if (searchKeywordInput) searchKeywordInput.focus();
        return false;
    }

    return true;
}

// Collect form data
function collectFormData() {
    const form = document.getElementById('applicationForm');
    const formData = new FormData(form);
    const data = {};

    // Get user data
    const userData = JSON.parse(localStorage.getItem('iontoefl_user'));
    data.user_id = userData.id;
    data.user_email = userData.email;

    // Collect all form fields
    for (let [key, value] of formData.entries()) {
        if (key === 'score_history' || key === 'target_note') {
            // 점수/목표 관련 텍스트 필드는 score_/target_ prefix지만 숫자가 아님 → 문자열 그대로
            data[key] = value;
        } else if (key.startsWith('score_') || key.startsWith('target_')) {
            // Convert score fields to numbers
            data[key] = value ? parseFloat(value) : null;
        } else if (key === 'no_target_score' || key === 'privacy_agreement' || key === 'confirm_kakao') {
            // Convert checkboxes to boolean
            data[key] = value === 'on';
        } else {
            data[key] = value;
        }
    }
    
    // Merge submission deadline date parts
    if (data.submission_deadline_year && data.submission_deadline_month) {
        data.submission_deadline = data.submission_deadline_year + '-' + data.submission_deadline_month;
        if (data.submission_deadline_day) {
            data.submission_deadline += '-' + data.submission_deadline_day;
        }
    }
    delete data.submission_deadline_year;
    delete data.submission_deadline_month;
    delete data.submission_deadline_day;
    
    // Merge preferred completion date parts (optional)
    if (data.preferred_completion_year && data.preferred_completion_month) {
        data.preferred_completion = data.preferred_completion_year + '-' + data.preferred_completion_month;
        if (data.preferred_completion_day) {
            data.preferred_completion += '-' + data.preferred_completion_day;
        }
    }
    delete data.preferred_completion_year;
    delete data.preferred_completion_month;
    delete data.preferred_completion_day;

    // Use directly entered total score
    if (data.has_toefl_score === 'yes' && data.score_version === 'old') {
        if (data.score_total_old) {
            data.total_score = data.score_total_old;
        }
    }
    
    if (data.has_toefl_score === 'yes' && data.score_version === 'new') {
        if (data.score_total_new) {
            data.total_score = data.score_total_new;
        }
    }

    // 호주/뉴질랜드 직접 제출 여부
    const auNzRadio = document.querySelector('input[name="is_au_nz_direct_submit"]:checked');
    data.is_au_nz_direct_submit = auNzRadio ? auNzRadio.value : null;

    // 토플 점수 "없음" 선택 시 score_history는 사용자에게 보이지 않으므로 null로 초기화
    if (data.has_toefl_score === 'no') {
        data.score_history = null;
    }

    // 목표점수 없음 체크박스 처리
    const noTargetCheckbox = document.getElementById('noTargetScore');
    data.no_target_score = noTargetCheckbox ? noTargetCheckbox.checked : false;
    
    // 목표점수 없음이면 목표 점수 필드 초기화
    if (data.no_target_score) {
        data.target_cutoff_new = null;
        data.target_cutoff_old = null;
        data.target_reading_new = null;
        data.target_listening_new = null;
        data.target_writing_new = null;
        data.target_speaking_new = null;
        data.target_reading_old = null;
        data.target_listening_old = null;
        data.target_speaking_old = null;
        data.target_writing_old = null;
        data.target_note = null;
    }

    // Set status
    data.status = '접수완료';
    data.current_step = 1;
    data.program = data.preferred_program;
    data.submitted_date = new Date().toISOString();

    return data;
}

// Show success modal (새 신청서 제출)
function showSuccessModal() {
    const modal = document.getElementById('successModal');
    modal.style.display = 'block';

    // Close modal when clicking outside
    window.addEventListener('click', function(e) {
        if (e.target === modal) {
            window.location.href = 'application.html';
        }
    });
}

// Show edit success modal (수정 완료)
function showEditSuccessModal() {
    const modal = document.getElementById('successModal');
    // 모달 내용 변경
    const modalContent = modal.querySelector('.success-modal');
    if (modalContent) {
        modalContent.innerHTML = `
            <div class="success-icon">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2>신청서가 수정되었습니다!</h2>
            <p>신청서가 성공적으로 수정되었습니다.<br>변경된 내용이 반영되었습니다.</p>
            <button class="btn-primary" onclick="window.location.href='application.html'">
                <i class="fas fa-list"></i> 신청 내역 확인
            </button>
        `;
    }
    modal.style.display = 'block';

    window.addEventListener('click', function(e) {
        if (e.target === modal) {
            window.location.href = 'application.html';
        }
    });
}

// Auto-save form data to localStorage
function getDraftKey() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    const email = userData?.email || 'unknown';
    return `iontoefl_form_draft_${email}`;
}

function setupAutoSave() {
    const form = document.getElementById('applicationForm');
    let autoSaveTimeout;
    const draftKey = getDraftKey();

    // Check for existing draft
    const savedDraft = localStorage.getItem(draftKey);
    if (savedDraft) {
        const shouldRestore = confirm('저장된 작성 중인 신청서가 있습니다. 불러오시겠습니까?');
        if (shouldRestore) {
            restoreFormData(JSON.parse(savedDraft));
        } else {
            localStorage.removeItem(draftKey);
        }
    }

    // Auto-save on input
    form.addEventListener('input', function() {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            const formData = new FormData(form);
            const data = {};
            for (let [key, value] of formData.entries()) {
                data[key] = value;
            }
            localStorage.setItem(draftKey, JSON.stringify(data));
            
            // Show save indicator (optional)
            showSaveIndicator();
        }, 2000); // Save after 2 seconds of inactivity
    });
}

// Restore form data from object
function restoreFormData(data) {
    for (let [key, value] of Object.entries(data)) {
        const element = document.querySelector(`[name="${key}"]`);
        if (element) {
            if (element.type === 'checkbox' || element.type === 'radio') {
                if (element.value === value || value === 'on') {
                    element.checked = true;
                    // Trigger change event for conditional fields
                    element.dispatchEvent(new Event('change'));
                }
            } else {
                element.value = value;
            }
        }
    }
}

// Show save indicator
function showSaveIndicator() {
    // Create or update save indicator
    let indicator = document.getElementById('autoSaveIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'autoSaveIndicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--accent-color);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 0.9rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        indicator.innerHTML = '<i class="fas fa-check"></i> 자동 저장됨';
        document.body.appendChild(indicator);
    }

    // Show indicator
    indicator.style.opacity = '1';

    // Hide after 2 seconds
    setTimeout(() => {
        indicator.style.opacity = '0';
    }, 2000);
}

// AU/NZ tooltip toggle
function toggleAuNzTooltip() {
    const content = document.getElementById('auNzTooltipContent');
    if (content) {
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
    }
}

// Word/sentence counter for writing samples (optional enhancement)
function setupWritingCounters() {
    const writingSample1 = document.querySelector('textarea[name="writing_sample_1"]');
    const writingSample2 = document.querySelector('textarea[name="writing_sample_2"]');

    [writingSample1, writingSample2].forEach(textarea => {
        if (!textarea) return;
        
        const counter = document.createElement('div');
        counter.style.cssText = 'font-size: 0.9rem; color: #777; margin-top: 0.5rem;';
        textarea.parentElement.appendChild(counter);

        textarea.addEventListener('input', function() {
            const text = this.value.trim();
            const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
            const words = text.split(/\s+/).filter(w => w.length > 0).length;
            
            counter.textContent = `${sentences} sentences, ${words} words`;
            
            if (sentences >= 5) {
                counter.style.color = 'var(--accent-color)';
            } else {
                counter.style.color = '#ff6b6b';
            }
        });
    });
}

// Call setup for writing counters
setTimeout(setupWritingCounters, 100);

// Setup date dropdowns
function setupDateDropdowns() {
    const currentYear = new Date().getFullYear();
    
    // Populate year dropdowns (current year + 3 years)
    const yearSelects = [
        document.querySelector('select[name="submission_deadline_year"]'),
        document.querySelector('select[name="preferred_completion_year"]')
    ];
    
    yearSelects.forEach(select => {
        if (!select) return;
        for (let i = 0; i < 4; i++) {
            const year = currentYear + i;
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year + '년';
            select.appendChild(option);
        }
    });
    
    // Populate day dropdowns (1-31)
    const daySelects = [
        document.querySelector('select[name="submission_deadline_day"]'),
        document.querySelector('select[name="preferred_completion_day"]')
    ];
    
    daySelects.forEach(select => {
        if (!select) return;
        for (let day = 1; day <= 31; day++) {
            const option = document.createElement('option');
            const dayStr = String(day).padStart(2, '0');
            option.value = dayStr;
            option.textContent = day + '일';
            select.appendChild(option);
        }
    });
}

// ==================== 텔레그램 알림 (Edge Function 경유) ====================

async function sendTelegramNotification(formData) {
    await fetch(`${SUPABASE_URL}/functions/v1/telegram-notify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
            type: 'new_application',
            data: {
                name: formData.name,
                email: formData.email,
                phone: formData.phone,
                target_score: formData.target_score,
                preferred_program: formData.preferred_program
            }
        })
    });
}

