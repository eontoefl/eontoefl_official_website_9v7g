// Application Form JavaScript

document.addEventListener('DOMContentLoaded', function() {
    
    // Check if user is logged in
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    
    if (!userData) {
        alert('로그인이 필요합니다.');
        window.location.href = 'login.html';
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

    // Auto-save to localStorage (optional enhancement)
    setupAutoSave();
    
    // Setup Sunday-only date picker
    setupSundayOnlyDatePicker();
    
    // Setup date dropdowns
    setupDateDropdowns();
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
            if (this.value === 'yes') {
                // Has score - show score section, hide writing section
                toeflScoreSection.style.display = 'block';
                writingSection.style.display = 'none';
                
                // Make writing fields optional
                document.querySelector('textarea[name="writing_sample_1"]').required = false;
                document.querySelector('textarea[name="writing_sample_2"]').required = false;
            } else {
                // No score - hide score section, show writing section
                toeflScoreSection.style.display = 'none';
                writingSection.style.display = 'block';
                
                // Make writing fields required
                document.querySelector('textarea[name="writing_sample_1"]').required = true;
                document.querySelector('textarea[name="writing_sample_2"]').required = true;
                
                // Remove score field requirements
                const scoreInputs = toeflScoreSection.querySelectorAll('input[required]');
                scoreInputs.forEach(input => input.required = false);
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
            
            // Update required fields
            const oldInputs = document.getElementById('oldScoreSection').querySelectorAll('input[type="number"]');
            const newInputs = document.getElementById('newScoreSection').querySelectorAll('input[type="number"]');
            
            oldInputs.forEach(input => input.required = isOld);
            newInputs.forEach(input => input.required = !isOld);
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
            const targetVersionInput = document.querySelectorAll('input[name="target_version"]')[1]; // Second one for target
            if (targetVersionInput) {
                targetVersionInput.value = isOld ? 'old' : 'new';
            }
            
            // Show/hide sections
            document.getElementById('oldTargetSection').classList.toggle('active', isOld);
            document.getElementById('newTargetSection').classList.toggle('active', !isOld);
            
            // Update required field
            const oldCutoff = document.querySelector('input[name="target_cutoff_old"]');
            const newCutoff = document.querySelector('input[name="target_cutoff_new"]');
            
            if (oldCutoff) oldCutoff.required = isOld;
            if (newCutoff) newCutoff.required = !isOld;
        });
    });

    // Format new TOEFL score inputs to always show .0 for whole numbers
    const newScoreInputs = document.querySelectorAll('input[name="target_cutoff_new"], input[name="target_reading_new"], input[name="target_listening_new"], input[name="target_writing_new"], input[name="target_speaking_new"]');
    
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
    
    if (referralFriendRadios.length > 0) {
        referralFriendRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'yes') {
                    referralFriendNameGroup.style.display = 'block';
                } else {
                    referralFriendNameGroup.style.display = 'none';
                }
            });
        });
    }
}

// Setup Score Total Calculation
function setupScoreTotalCalculation() {
    // 개정전 (Old Score) - 단순 합계 (0-120)
    const oldScoreInputs = document.querySelectorAll('.score-input-old');
    const totalValueOld = document.getElementById('totalValueOld');
    const totalScoreOld = document.getElementById('totalScoreOld');
    
    oldScoreInputs.forEach(input => {
        input.addEventListener('input', function() {
            calculateOldTotal();
        });
    });
    
    function calculateOldTotal() {
        const reading = parseFloat(document.querySelector('input[name="score_reading_old"]').value) || null;
        const listening = parseFloat(document.querySelector('input[name="score_listening_old"]').value) || null;
        const speaking = parseFloat(document.querySelector('input[name="score_speaking_old"]').value) || null;
        const writing = parseFloat(document.querySelector('input[name="score_writing_old"]').value) || null;
        
        // 하나라도 비어있으면 계산 안함
        if (reading === null || listening === null || speaking === null || writing === null) {
            totalValueOld.textContent = '네 섹션을 모두 입력하세요';
            totalValueOld.classList.add('placeholder');
            totalScoreOld.classList.remove('has-score');
            return;
        }
        
        // 네 섹션 모두 다 더하기
        const total = reading + listening + speaking + writing;
        
        totalValueOld.textContent = `${total}점 / 120점`;
        totalValueOld.classList.remove('placeholder');
        totalScoreOld.classList.add('has-score');
    }
    
    // 개정후 (New Score) - 평균의 0.5 단위 반올림 (1-6)
    const newScoreInputs = document.querySelectorAll('.score-input-new');
    const totalValueNew = document.getElementById('totalValueNew');
    const totalScoreNew = document.getElementById('totalScoreNew');
    
    newScoreInputs.forEach(input => {
        input.addEventListener('input', function() {
            calculateNewTotal();
        });
    });
    
    function calculateNewTotal() {
        const reading = parseFloat(document.querySelector('input[name="score_reading_new"]').value) || null;
        const listening = parseFloat(document.querySelector('input[name="score_listening_new"]').value) || null;
        const writing = parseFloat(document.querySelector('input[name="score_writing_new"]').value) || null;
        const speaking = parseFloat(document.querySelector('input[name="score_speaking_new"]').value) || null;
        
        // 하나라도 비어있으면 계산 안함
        if (reading === null || listening === null || writing === null || speaking === null) {
            totalValueNew.textContent = '네 섹션을 모두 입력하세요';
            totalValueNew.classList.add('placeholder');
            totalScoreNew.classList.remove('has-score');
            return;
        }
        
        // 네 섹션 평균 구하기
        const average = (reading + listening + writing + speaking) / 4;
        
        // 0.5 단위로 반올림
        const total = Math.round(average * 2) / 2;
        
        totalValueNew.textContent = `${total.toFixed(1)} / 6.0`;
        totalValueNew.classList.remove('placeholder');
        totalScoreNew.classList.add('has-score');
    }
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
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
        submitBtn.disabled = true;

        try {
            // Submit to applications table
            const result = await supabaseAPI.post('applications', formData);

            if (!result) {
                throw new Error('신청서 제출에 실패했습니다.');
            }

            // Clear auto-saved data
            localStorage.removeItem('iontoefl_form_draft');

            // Show success modal
            showSuccessModal();

        } catch (error) {
            console.error('Error submitting application:', error);
            alert('신청서 제출 중 오류가 발생했습니다. 다시 시도해주세요.');
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
        if (key.startsWith('score_') || key.startsWith('target_')) {
            // Convert score fields to numbers
            data[key] = value ? parseFloat(value) : null;
        } else if (key === 'confirm_materials' || key === 'privacy_agreement' || key === 'confirm_kakao') {
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

    // Calculate total score for old version if TOEFL scores provided
    if (data.has_toefl_score === 'yes' && data.score_version === 'old') {
        if (data.score_reading_old && data.score_listening_old && data.score_speaking_old && data.score_writing_old) {
            data.total_score = data.score_reading_old + data.score_listening_old + data.score_speaking_old + data.score_writing_old;
        }
    }
    
    // Calculate total score for new version (average rounded to 0.5)
    if (data.has_toefl_score === 'yes' && data.score_version === 'new') {
        if (data.score_reading_new && data.score_listening_new && data.score_speaking_new && data.score_writing_new) {
            const avg = (data.score_reading_new + data.score_listening_new + data.score_speaking_new + data.score_writing_new) / 4;
            data.total_score = Math.round(avg * 2) / 2; // Round to nearest 0.5
        }
    }

    // Set status
    data.status = '접수완료';
    data.current_step = 1;
    data.program = data.preferred_program;
    data.submitted_date = new Date().toISOString();

    return data;
}

// Show success modal
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

// Auto-save form data to localStorage
function setupAutoSave() {
    const form = document.getElementById('applicationForm');
    let autoSaveTimeout;

    // Check for existing draft
    const savedDraft = localStorage.getItem('iontoefl_form_draft');
    if (savedDraft) {
        const shouldRestore = confirm('저장된 작성 중인 신청서가 있습니다. 불러오시겠습니까?');
        if (shouldRestore) {
            restoreFormData(JSON.parse(savedDraft));
        } else {
            localStorage.removeItem('iontoefl_form_draft');
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
            localStorage.setItem('iontoefl_form_draft', JSON.stringify(data));
            
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

// Setup Sunday-only date picker
function setupSundayOnlyDatePicker() {
    const startDateInput = document.querySelector('input[name="preferred_start_date"]');
    
    if (!startDateInput) return;
    
    // Validate on change
    startDateInput.addEventListener('change', function() {
        const selectedDate = new Date(this.value);
        
        // Check if it's Sunday (0 = Sunday)
        if (selectedDate.getDay() !== 0) {
            alert('수업 시작일은 매주 일요일만 가능합니다. 일요일을 선택해주세요.');
            this.value = ''; // Clear invalid selection
        }
    });
    
    // Also validate on blur
    startDateInput.addEventListener('blur', function() {
        if (this.value) {
            const selectedDate = new Date(this.value);
            if (selectedDate.getDay() !== 0) {
                alert('수업 시작일은 매주 일요일만 가능합니다. 일요일을 선택해주세요.');
                this.value = '';
            }
        }
    });
}

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

