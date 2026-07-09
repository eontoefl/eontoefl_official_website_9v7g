// ==================== 관리자 관리 모달 ====================
// sendKakaoAlimTalk()는 supabase-config.js에서 공통 유틸로 정의됨

let currentManageApp = null;

// 모달 열기
async function openManageModal(appId) {
    try {
        // 데이터 로드
        const app = await supabaseAPI.getById('applications', appId);
        if (!app) {
            alert('❌ 신청서를 불러올 수 없습니다.');
            return;
        }
        currentManageApp = app;
        
        // 모달 표시
        document.getElementById('manageModal').style.display = 'flex';
        document.getElementById('modalStudentName').textContent = app.name;
        
        // 첫 번째 탭 로드
        switchModalTab('info');
    } catch (error) {
        console.error('Error opening modal:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 모달 닫기
function closeManageModal() {
    document.getElementById('manageModal').style.display = 'none';
    currentManageApp = null;
    
    // 목록 새로고침
    if (typeof loadApplications === 'function') {
        loadApplications();
    }
}

// 탭 전환
function switchModalTab(tabName) {
    // 탭 버튼 활성화
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    const targetTab = document.querySelector(`[data-modal-tab="${tabName}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // 탭 컨텐츠 표시
    document.querySelectorAll('.modal-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    const targetContent = document.getElementById(`modalTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    if (targetContent) {
        targetContent.style.display = 'block';
    }
    
    // 탭 내용 로드
    loadModalTab(tabName);
}

// 탭 내용 로드
function loadModalTab(tabName) {
    if (!currentManageApp) return;
    
    switch(tabName) {
        case 'info':
            loadModalInfoTab(currentManageApp);
            break;
        case 'analysis':
            loadModalAnalysisTab(currentManageApp);
            break;
        case 'contract':
            loadModalContractTab(currentManageApp);
            break;
        case 'usage':
            loadModalUsageTab(currentManageApp);
            break;
        case 'shipping':
            loadModalShippingTab(currentManageApp);
            break;
    }
}

// ===== 기본정보 TXT 다운로드 =====
function downloadInfoTxt() {
    const app = currentManageApp;
    if (!app) return;

    let lines = [];
    lines.push('=== 기본 정보 ===');
    lines.push(`이름 : ${app.name || '-'}`);
    lines.push(`전화번호 : ${app.phone || '-'}`);
    lines.push(`이메일 : ${app.email || '-'}`);
    lines.push(`직업 : ${app.occupation || '-'}`);
    lines.push(`주소 : ${app.address || '-'}`);
    lines.push(`환불 계좌 : ${app.bank_account || '-'}`);
    lines.push(`신청일 : ${app.submitted_date ? new Date(app.submitted_date).toLocaleString('ko-KR') : '-'}`);
    lines.push(`현재 단계 : STEP ${app.current_step || 1}`);

    lines.push('');
    lines.push('=== 현재 토플 점수 ===');
    if (app.has_toefl_score === 'yes') {
        if (app.score_version === 'new' || app.score_total_new || app.score_reading_new) {
            lines.push('버전 : 개정후');
            lines.push(`Overall : ${app.score_total_new || '-'}`);
            lines.push(`Reading : ${app.score_reading_new || '-'}`);
            lines.push(`Listening : ${app.score_listening_new || '-'}`);
            lines.push(`Speaking : ${app.score_speaking_new || '-'}`);
            lines.push(`Writing : ${app.score_writing_new || '-'}`);
        } else {
            lines.push('버전 : 개정전');
            lines.push(`Overall : ${app.score_total_old || '-'}`);
            lines.push(`Reading : ${app.score_reading_old || '-'}`);
            lines.push(`Listening : ${app.score_listening_old || '-'}`);
            lines.push(`Speaking : ${app.score_speaking_old || '-'}`);
            lines.push(`Writing : ${app.score_writing_old || '-'}`);
        }
        if (app.score_history) lines.push(`점수 관련 상세 설명 : ${app.score_history}`);
    } else {
        lines.push('TOEFL 응시 여부 : 없음');
        lines.push('');
        lines.push('Q1: What are your hobbies or interests, and why do you enjoy them?');
        lines.push(`A1: ${app.writing_sample_1 || '-'}`);
        lines.push('');
        lines.push('Q2: Describe a challenge you faced recently and how you dealt with it.');
        lines.push(`A2: ${app.writing_sample_2 || '-'}`);
    }

    lines.push('');
    lines.push('=== 학습 현황 ===');
    lines.push(`현재 공부 방법 : ${app.current_study_method || '-'}`);
    lines.push(`하루 평균 공부 시간 : ${app.daily_study_time || '-'}`);

    lines.push('');
    lines.push('=== 목표 점수 ===');
    if (app.no_target_score) {
        lines.push('목표 점수 : 없음 (고고익선)');
    } else if (app.target_version === 'new' || app.target_cutoff_new || app.target_reading_new) {
        lines.push('버전 : 개정후');
        lines.push(`커트라인 (Total) : ${app.target_cutoff_new || '-'}`);
        lines.push(`Reading : ${app.target_reading_new || '-'}`);
        lines.push(`Listening : ${app.target_listening_new || '-'}`);
        lines.push(`Writing : ${app.target_writing_new || '-'}`);
        lines.push(`Speaking : ${app.target_speaking_new || '-'}`);
    } else if (app.target_cutoff_old || app.target_reading_old) {
        lines.push('버전 : 개정전');
        lines.push(`커트라인 (Total) : ${app.target_cutoff_old || '-'}`);
        lines.push(`Reading : ${app.target_reading_old || '-'}`);
        lines.push(`Listening : ${app.target_listening_old || '-'}`);
        lines.push(`Speaking : ${app.target_speaking_old || '-'}`);
        lines.push(`Writing : ${app.target_writing_old || '-'}`);
    } else if (app.target_score) {
        lines.push(`목표 점수 : ${app.target_score}점`);
    } else {
        lines.push('목표 점수 : 미입력');
    }
    if (app.target_note) lines.push(`개인 희망 점수 및 추가 설명 : ${app.target_note}`);

    lines.push('');
    lines.push('=== 마감 기한 ===');
    lines.push(`마지막 응시 가능일 : ${app.submission_deadline || '-'}`);
    lines.push(`희망 완료일 : ${app.preferred_completion || '-'}`);

    if (app.toefl_reason) {
        lines.push('');
        lines.push('=== 토플이 필요한 이유 ===');
        lines.push(`목적 : ${app.toefl_reason}`);
        if (app.is_au_nz_direct_submit === 'yes') {
            lines.push(`호주/뉴질랜드 직접 제출 : 예`);
        }
        if (app.toefl_reason_detail) {
            lines.push(`상세 설명 : ${app.toefl_reason_detail}`);
        }
    }

    lines.push('');
    lines.push('=== 기억에 남는 블로그 글 ===');
    lines.push(app.memorable_blog_content || '-');

    lines.push('');
    lines.push('=== 프로그램 및 일정 ===');
    lines.push(`희망 프로그램 : ${app.preferred_program || '-'}`);
    lines.push(`스라첨삭 신청 : ${app.preferred_correction === '신청희망' ? '신청희망' : app.preferred_correction === '신청' ? '신청희망' : app.preferred_correction || '미선택'}`);
    lines.push(`희망하는 챌린지 시작일 : ${app.preferred_start_date || '-'}`);
    lines.push(`포기/조절할 것 : ${app.give_up_plan || '-'}`);
    lines.push(`챌린지를 알린/알릴 사람 : ${app.tell_plan || '-'}`);
    lines.push(`노트북/데스크탑 보유 여부 : ${app.program_note || '-'}`);

    lines.push('');
    lines.push('=== 유입 경로 ===');
    let refParts = [];
    if (app.referral_search_keyword) refParts.push(`검색: ${app.referral_search_keyword}`);
    if (app.referral_social_media) refParts.push(`SNS: ${app.referral_social_media}`);
    if (app.referral_from_friend === 'yes') refParts.push(`지인 추천${app.referral_friend_name ? ' (' + app.referral_friend_name + ')' : ''}`);
    if (app.referral_other) refParts.push(app.referral_other);
    lines.push(refParts.length > 0 ? refParts.join(' / ') : '-');

    lines.push('');
    lines.push('=== 추가 전달 사항 ===');
    lines.push(app.additional_notes || '-');

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.name || '학생'}_기본정보.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// ===== 기본정보 탭 =====
function loadModalInfoTab(app) {
    const container = document.getElementById('modalTabInfo');
    
    // 현재 점수 (개정전/개정후 구분)
    let currentScoreHTML = '';
    if (app.has_toefl_score === 'yes') {
        if (app.score_version === 'new' || app.score_total_new || app.score_reading_new) {
            currentScoreHTML = `
                <div class="info-item"><label>Overall</label><div>${app.score_total_new || '-'}</div></div>
                <div class="info-item"><label>Reading</label><div>${app.score_reading_new || '-'}</div></div>
                <div class="info-item"><label>Listening</label><div>${app.score_listening_new || '-'}</div></div>
                <div class="info-item"><label>Speaking</label><div>${app.score_speaking_new || '-'}</div></div>
                <div class="info-item"><label>Writing</label><div>${app.score_writing_new || '-'}</div></div>
            `;
        } else {
            currentScoreHTML = `
                <div class="info-item"><label>Overall</label><div>${app.score_total_old || '-'}</div></div>
                <div class="info-item"><label>Reading</label><div>${app.score_reading_old || '-'}</div></div>
                <div class="info-item"><label>Listening</label><div>${app.score_listening_old || '-'}</div></div>
                <div class="info-item"><label>Speaking</label><div>${app.score_speaking_old || '-'}</div></div>
                <div class="info-item"><label>Writing</label><div>${app.score_writing_old || '-'}</div></div>
            `;
        }
    }

    // 목표 점수 (개정전/개정후 구분)
    let targetScoreHTML = '';
    // 값이 입력된 항목만 렌더 (빈 칸은 표시하지 않음)
    const buildScoreRows = (rows) => rows
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([l, v]) => `<div class="info-item"><label>${l}</label><div>${v}</div></div>`)
        .join('');
    if (app.no_target_score) {
        targetScoreHTML = `<div class="info-item"><label>목표 점수</label><div>없음 (고고익선 🚀)</div></div>`;
    } else if (app.target_version === 'new' || app.target_cutoff_new || app.target_reading_new) {
        targetScoreHTML = buildScoreRows([
            ['커트라인', app.target_cutoff_new],
            ['Reading', app.target_reading_new],
            ['Listening', app.target_listening_new],
            ['Writing', app.target_writing_new],
            ['Speaking', app.target_speaking_new],
        ]) || `<div class="info-item"><label>목표 점수</label><div>미입력</div></div>`;
    } else if (app.target_cutoff_old || app.target_reading_old) {
        targetScoreHTML = buildScoreRows([
            ['커트라인', app.target_cutoff_old],
            ['Reading', app.target_reading_old],
            ['Listening', app.target_listening_old],
            ['Speaking', app.target_speaking_old],
            ['Writing', app.target_writing_old],
        ]) || `<div class="info-item"><label>목표 점수</label><div>미입력</div></div>`;
    } else if (app.target_score) {
        // 입문서 신청자용 (단순 숫자 입력)
        targetScoreHTML = `<div class="info-item"><label>목표 점수</label><div>${app.target_score}점</div></div>`;
    } else {
        targetScoreHTML = `<div class="info-item"><label>목표 점수</label><div>미입력</div></div>`;
    }

    // 유입 경로 정리
    let referralParts = [];
    if (app.referral_search_keyword) referralParts.push(`검색: ${app.referral_search_keyword}`);
    if (app.referral_social_media) referralParts.push(`SNS: ${app.referral_social_media}`);
    if (app.referral_from_friend === 'yes') referralParts.push(`지인 추천${app.referral_friend_name ? ' (' + app.referral_friend_name + ')' : ''}`);
    if (app.referral_other) referralParts.push(app.referral_other);

    container.innerHTML = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:12px;">
            <button onclick="downloadInfoTxt()" style="display:inline-flex; align-items:center; gap:6px; padding:8px 16px; background:#f1f5f9; border:none; border-radius:8px; font-size:13px; font-weight:600; color:#475569; cursor:pointer; font-family:inherit; transition:0.15s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                <i class="fas fa-download" style="font-size:12px;"></i> TXT 다운로드
            </button>
        </div>
        <!-- 1. 기본 정보 & 배송/환불 -->
        <div class="info-card">
            <h3 class="info-card-title"><i class="fas fa-user"></i> 기본 정보</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px;">
                <div class="info-item"><label>이름</label><div>${app.name || '-'}</div></div>
                <div class="info-item"><label>전화번호</label><div>${app.phone || '-'}</div></div>
                <div class="info-item"><label>이메일</label><div>${app.email || '-'}</div></div>
                <div class="info-item"><label>직업</label><div>${app.occupation || '-'}</div></div>
                <div class="info-item"><label>신청일</label><div>${app.submitted_date ? new Date(app.submitted_date).toLocaleString('ko-KR') : '-'}</div></div>
                <div class="info-item"><label>현재 단계</label><div>STEP ${app.current_step || 1}</div></div>
            </div>
            <div class="info-item"><label>주소</label><div>${app.address || '-'}</div></div>
            <div class="info-item"><label>환불 계좌</label><div>${app.bank_account || '-'}</div></div>
        </div>

        <!-- 2. 현재 토플 점수 / 라이팅 샘플 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-chart-bar"></i> 현재 토플 점수</h3>
            ${app.has_toefl_score === 'yes' ? `
                <div class="info-item"><label>응시 여부</label><div style="color:#2563eb; font-weight:700;">있음 (${app.score_version === 'new' ? '개정후' : '개정전'})</div></div>
                <div class="score-grid">${currentScoreHTML}</div>
                ${app.score_history ? `<div class="info-item"><label>점수 상세</label><div>${app.score_history}</div></div>` : ''}
            ` : `
                <div class="info-item"><label>응시 여부</label><div style="color:#dc2626; font-weight:700;">없음</div></div>
                <div class="info-item info-item-stack">
                    <label>Q1: What are your hobbies or interests, and why do you enjoy them?</label>
                    <div>${app.writing_sample_1 || '-'}</div>
                </div>
                <div class="info-item info-item-stack">
                    <label>Q2: Describe a challenge you faced recently and how you dealt with it.</label>
                    <div>${app.writing_sample_2 || '-'}</div>
                </div>
            `}
        </div>

        <!-- 3. 학습 현황 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-book-reader"></i> 학습 현황</h3>
            <div class="info-item"><label>현재 공부 방법</label><div>${app.current_study_method || '-'}</div></div>
            <div class="info-item"><label>하루 공부시간</label><div>${app.daily_study_time || '-'}</div></div>
        </div>

        <!-- 4. 목표 점수 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-bullseye"></i> 목표 점수 ${!app.no_target_score && (app.target_version === 'new' || app.target_cutoff_new || app.target_reading_new) ? '(개정후)' : !app.no_target_score && (app.target_cutoff_old || app.target_reading_old) ? '(개정전)' : ''}</h3>
            <div class="score-grid">${targetScoreHTML}</div>
            ${app.target_note ? `<div class="info-item"><label>희망점수 설명</label><div>${app.target_note}</div></div>` : ''}
        </div>

        <!-- 5. 마감 기한 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-calendar-alt"></i> 마감 기한</h3>
            <div class="info-item"><label>응시 가능일</label><div>${app.submission_deadline || '-'}</div></div>
            <div class="info-item"><label>희망 완료일</label><div>${app.preferred_completion || '-'}</div></div>
        </div>

        <!-- 6. 토플 필요 이유 (있을 때만 표시 - 과거 신청자용) -->
        ${app.toefl_reason ? `
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-question-circle"></i> 토플이 필요한 이유</h3>
            <div class="info-item"><label>목적</label><div>${app.toefl_reason}</div></div>
            ${app.is_au_nz_direct_submit === 'yes' ? `
            <div class="info-item"><label>호주/NZ 제출</label><div><span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; background:#fef3c7; color:#92400e; border-radius:5px; font-size:12px; font-weight:600;">AU/NZ 호주/뉴질랜드 기관 직접 제출</span></div></div>
            ` : ''}
            ${app.toefl_reason_detail ? `<div class="info-item"><label>상세 설명</label><div>${app.toefl_reason_detail}</div></div>` : ''}
        </div>
        ` : ''}

        <!-- 7. 블로그 인상 깊은 내용 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-blog"></i> 기억에 남는 블로그 글</h3>
            <div class="info-item"><div style="grid-column:1 / -1;">${app.memorable_blog_content || '-'}</div></div>
        </div>

        <!-- 8. 프로그램 & 일정 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-clipboard"></i> 프로그램 및 일정</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px;">
                <div class="info-item"><label>희망 프로그램</label><div>${app.preferred_program || '-'}</div></div>
                <div class="info-item"><label>스라첨삭 신청</label><div style="color: ${app.preferred_correction === '신청희망' || app.preferred_correction === '신청' ? '#2563eb' : '#64748b'}; font-weight:600;">${app.preferred_correction === '신청희망' ? '신청희망' : app.preferred_correction === '신청' ? '신청희망' : app.preferred_correction || '미선택'}</div></div>
                <div class="info-item"><label>희망 시작일</label><div>${app.preferred_start_date || '-'}</div></div>
            </div>
            ${app.give_up_plan ? `<div class="info-item"><label>포기/조절할 것</label><div>${app.give_up_plan}</div></div>` : ''}
            ${app.tell_plan ? `<div class="info-item"><label>알릴 사람</label><div>${app.tell_plan}</div></div>` : ''}
            ${app.program_note ? `<div class="info-item"><label>노트북 보유</label><div>${app.program_note}</div></div>` : ''}
        </div>

        <!-- 9. 유입 경로 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-route"></i> 유입 경로</h3>
            <div class="info-item"><div style="grid-column:1 / -1;">${referralParts.length > 0 ? referralParts.join(' / ') : '-'}</div></div>
        </div>

        <!-- 10. 추가 전달 사항 -->
        <div class="info-card" style="margin-top: 16px;">
            <h3 class="info-card-title"><i class="fas fa-comment-dots"></i> 추가 전달 사항</h3>
            <div class="info-item"><div style="grid-column:1 / -1;">${app.additional_notes || '-'}</div></div>
        </div>

        <!-- 수강 상태 관리 (세팅 완료된 학생만 표시) -->
        ${renderAppStatusSection(app)}
    `;
}

// ===== 개별분석 탭 =====
function loadModalAnalysisTab(app) {
    const container = document.getElementById('modalTabAnalysis');
    const hasAnalysis = app.analysis_status && app.analysis_content;

    // AI 자동 분석 감지: analysis_content는 있지만 analysis_status가 없는 경우
    const hasAIAnalysis = !app.analysis_status && !!app.analysis_content;

    // 미발송 수정본(임시 보관) 존재 여부: 정식 컬럼은 비어있고 pending 컬럼에 내용이 있음.
    // 예약을 걸어둔 경우 + 예약을 취소했지만 수정본은 보존된 경우를 모두 포함한다.
    const hasPendingDraft = !hasAnalysis
        && !!app.analysis_status_pending
        && !!app.analysis_content_pending;

    // 예약 발송 대기 중 여부 = 미발송 수정본이 있고, 예약 시각이 설정되어 있는 상태.
    const isScheduled = hasPendingDraft && !!app.analysis_alimtalk_scheduled_at;

    // 읽기 전용/수정 모드 설정
    //  - 저장 완료(공개됨)된 분석: 기본 읽기 전용 (수정 버튼 클릭 시 활성화)
    //  - 예약 대기 중: 항상 수정 가능
    //  - 그 외 (최초 저장 전): 항상 수정 가능
    const readOnly = hasAnalysis ? 'disabled' : '';
    const pointerEvents = hasAnalysis ? 'pointer-events: none; opacity: 0.7;' : '';
    const cursorStyle = hasAnalysis ? '' : 'cursor: pointer;';

    // 폼 prefill 시 사용할 값 (미발송 수정본이 있으면 pending 데이터에서 가져옴.
    // 예약을 취소해도 수정본은 보존되므로 예약 여부와 무관하게 hasPendingDraft 기준으로 채운다.)
    const pendingPayload = hasPendingDraft ? (app.analysis_pending_payload || {}) : {};
    const fillStatus  = hasPendingDraft ? app.analysis_status_pending  : app.analysis_status;
    const fillContent = hasPendingDraft ? app.analysis_content_pending : app.analysis_content;
    const fillProgram = hasPendingDraft ? (pendingPayload.assigned_program || '') : (app.assigned_program || '');
    const fillScheduleStart = hasPendingDraft ? (pendingPayload.schedule_start || '') : (app.schedule_start || '');
    const fillScheduleEnd   = hasPendingDraft ? (pendingPayload.schedule_end || '')   : (app.schedule_end || '');
    const fillCorrectionEnabled = hasPendingDraft
        ? (pendingPayload.correction_enabled === true)
        : !!app.correction_enabled;
    const fillCorrectionStartDate = hasPendingDraft ? (pendingPayload.correction_start_date || '') : (app.correction_start_date || '');
    // 자기주도(Self-Paced): 켜짐 여부 + 완료 종료일. 테스트룸이 self_paced/self_paced_end_date 컬럼을 읽어
    // 시작일~종료일 사이에 24세트를 자동 배분(압축+매일마감)한다. 종료일은 관리자가 직접 입력.
    const fillSelfPaced = hasPendingDraft
        ? (pendingPayload.self_paced === true)
        : !!app.self_paced;
    const fillSelfPacedEndDate = hasPendingDraft ? (pendingPayload.self_paced_end_date || '') : (app.self_paced_end_date || '');
    // 연장(13~24세션)은 개별분석 발행과 무관한 별도 즉시 액션 → 항상 실제 app 값 사용(pending 미사용)
    const fillExtensionStartDate = app.extension_start_date || '';
    const fillAdditionalDiscount = hasPendingDraft
        ? (pendingPayload.additional_discount || 0)
        : (app.additional_discount || 0);
    const fillDiscountReason = hasPendingDraft ? (pendingPayload.discount_reason || '') : (app.discount_reason || '');
    const fillIsIncentive = hasPendingDraft
        ? (pendingPayload.is_incentive_applicant === true)
        : !!app.is_incentive_applicant;
    const fillBookAccess = hasPendingDraft
        ? (pendingPayload.book_access_enabled === true)
        : !!app.book_access_enabled;

    // 예약 발송 대기 배너 (예약 중일 때만)
    const scheduledAtKstStr = isScheduled ? formatScheduledAtKst(app.analysis_alimtalk_scheduled_at) : '';
    const scheduledBanner = isScheduled ? `
        <div id="scheduledReleaseBanner" style="background: #fdf8ef; padding: 22px 24px; border-radius: 16px; margin-bottom: 20px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                <div style="display: flex; align-items: flex-start; gap: 14px; flex: 1; min-width: 320px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #fbecd2; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fas fa-clock" style="font-size: 16px; color: #b45309;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 15px; color: #1e293b; letter-spacing: -0.01em; margin-bottom: 5px;">예약 발송 대기 중</div>
                        <div style="font-size: 13px; color: #64748b; line-height: 1.7;">
                            <strong style="color: #1e293b;">${scheduledAtKstStr}</strong>에 학생에게 공개되며<br>알림톡(${fillIsIncentive ? '프로모션 학생 전용 템플릿' : '일반 학생 템플릿'})이 발송됩니다.
                        </div>
                        <div style="font-size: 12px; color: #94a3b8; margin-top: 8px; line-height: 1.6;">
                            발송 전까지 분석 내용을 자유롭게 수정할 수 있습니다. 수정해도 예약 시각은 유지됩니다.
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; flex-shrink: 0;">
                    <button type="button" onclick="openChangeScheduleModal()"
                            style="padding: 9px 14px; background: #ffffff; color: #475569; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; transition: 0.15s;"
                            onmouseover="this.style.background='#f8fafc';" onmouseout="this.style.background='#ffffff';">
                        <i class="fas fa-calendar-alt" style="font-size: 11px;"></i> 예약 시각 변경
                    </button>
                    <button type="button" onclick="cancelScheduledRelease()"
                            style="padding: 9px 14px; background: #fbeae6; color: #a53b22; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; transition: 0.15s;"
                            onmouseover="this.style.background='#f6ded8';" onmouseout="this.style.background='#fbeae6';">
                        <i class="fas fa-times" style="font-size: 11px;"></i> 예약 취소
                    </button>
                </div>
            </div>
        </div>
    ` : '';

    // 예약 취소 후 수정본 보존 배너 (예약은 풀렸지만 미발송 수정본이 남아있는 상태)
    const preservedDraftBanner = (hasPendingDraft && !isScheduled) ? `
        <div style="background: #f0f8fa; padding: 22px 24px; border-radius: 16px; margin-bottom: 20px;">
            <div style="display: flex; align-items: flex-start; gap: 14px;">
                <div style="width: 44px; height: 44px; border-radius: 12px; background: #d8eef2; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-save" style="font-size: 16px; color: #0e7490;"></i>
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 15px; color: #1e293b; letter-spacing: -0.01em; margin-bottom: 5px;">작성하신 수정본이 보존되어 있습니다</div>
                    <div style="font-size: 13px; color: #64748b; line-height: 1.7;">
                        예약은 취소되었지만 수정 내용은 그대로 남아있습니다 (학생에게는 아직 공개되지 않았습니다).<br>
                        검토 후 <strong style="color: #1e293b;">[즉시발송]</strong> 또는 <strong style="color: #1e293b;">[예약발송]</strong>을 선택해주세요.
                    </div>
                </div>
            </div>
        </div>
    ` : '';

    // AI 자동 분석 배너 (미발송 수정본이 보존된 상태에서는 표시하지 않음)
    const aiAnalysisBanner = (hasAIAnalysis && !hasPendingDraft) ? `
        <div style="background: #f6f4fb; padding: 22px 24px; border-radius: 16px; margin-bottom: 20px;">
            <div style="display: flex; align-items: flex-start; gap: 14px;">
                <div style="width: 44px; height: 44px; border-radius: 12px; background: #e6e0f2; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-robot" style="font-size: 16px; color: #6d28d9;"></i>
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 15px; color: #1e293b; letter-spacing: -0.01em; margin-bottom: 5px;">AI가 자동 생성한 개별분석입니다</div>
                    <div style="font-size: 13px; color: #64748b; line-height: 1.7;">
                        아래 분석 내용을 검토하신 후, 결과 선택 및 프로그램 배정을 완료하고 발송해주세요.<br>
                        AI가 자동 생성한 내용이므로 반드시 검토 후 수정이 필요할 수 있습니다.
                    </div>
                    <div style="display: none; gap: 8px; margin-top: 10px; flex-wrap: wrap;"><!-- 프로모션 폐지: AI 판단/확신도 뱃지 숨김 (되살리려면 display:flex) -->
                        ${app.auto_analysis_type ? `
                        <div style="display: inline-flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 999px; font-size: 12px; color: #5b21b6; font-weight: 600;">
                            <i class="fas fa-tag" style="font-size: 10px;"></i> AI 판단: ${app.auto_analysis_type === 'promotion' ? '프로모션 학생' : '일반 학생'}
                        </div>` : ''}
                        ${app.applicant_type_score !== null && app.applicant_type_score !== undefined ? `
                        <div style="display: inline-flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 999px; font-size: 12px; color: #5b21b6; font-weight: 600;">
                            <i class="fas fa-chart-bar" style="font-size: 10px;"></i> AI 확신도: ${app.applicant_type_score}점
                        </div>` : ''}
                    </div>
                </div>
            </div>
        </div>
    ` : '';

    let html = `
        ${scheduledBanner}
        ${preservedDraftBanner}
        ${aiAnalysisBanner}
        <!-- 입문서 제공 토글 (form 밖, 즉시 저장) -->
        <div class="form-group" style="background: #ffffff; padding: 18px 20px; border-radius: 14px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; border-radius: 10px; background: #e2eef5; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fas fa-book-open" style="font-size: 14px; color: #0369a1;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 14px; color: #1e293b;">입문서 제공</div>
                        <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">ON 시 학생 대시보드에 입문서 열람 카드 표시</div>
                    </div>
                </div>
                <label style="position: relative; display: inline-block; width: 48px; height: 26px; cursor: pointer;">
                    <input type="checkbox" id="bookAccessToggle"
                           ${fillBookAccess ? 'checked' : ''}
                           style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: ${fillBookAccess ? '#38bdf8' : '#cbd5e1'}; border-radius: 26px; transition: 0.3s;"></span>
                    <span style="position: absolute; top: 3px; left: ${fillBookAccess ? '25px' : '3px'}; width: 20px; height: 20px; background: white; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></span>
                </label>
            </div>
        </div>

        <form id="modalAnalysisForm" onsubmit="saveModalAnalysis(event)">
            <!-- 0. 프로모션 유도 학생 토글 (프로모션 폐지: 숨김. 체크박스는 DOM에 남겨 저장 로직 유지 → 항상 false. 되살리려면 display:none 제거) -->
            <div class="form-group" style="display: none; background: linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%); padding: 16px 20px; border-radius: 12px; border: 1px solid #f59e0b; margin-bottom: 24px; ${pointerEvents}">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-bullhorn" style="font-size: 18px; color: #d97706;"></i>
                        <div>
                            <div style="font-weight: 600; font-size: 14px; color: #92400e;">프로모션 유도 학생</div>
                            <div style="font-size: 12px; color: #b45309; margin-top: 2px;">ON 시 동의 데드라인 5일 적용 · 프로모션 전용 알림톡 자동 발송</div>
                        </div>
                    </div>
                    <label style="position: relative; display: inline-block; width: 48px; height: 26px; cursor: pointer;">
                        <input type="checkbox" id="incentiveToggle" name="is_incentive_applicant"
                               ${fillIsIncentive ? 'checked' : ''}
                               ${hasAnalysis ? 'disabled' : ''}
                               style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: ${fillIsIncentive ? '#f59e0b' : '#cbd5e1'}; border-radius: 26px; transition: 0.3s;"></span>
                        <span style="position: absolute; top: 3px; left: ${fillIsIncentive ? '25px' : '3px'}; width: 20px; height: 20px; background: white; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></span>
                    </label>
                </div>
            </div>

            <!-- 1. 결과 선택 -->
            <div class="form-group">
                <label class="form-label">1. 결과 선택 <span class="required">*</span></label>
                <div id="statusOptionsContainer" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; ${pointerEvents}">
                    <label style="${cursorStyle}">
                        <input type="radio" name="analysis_status" value="승인" ${fillStatus === '승인' ? 'checked' : ''} required ${readOnly} style="display: none;">
                        <div class="status-option status-option-approval" data-value="승인" style="padding: 20px; border: none; border-radius: 14px; text-align: center; background: ${fillStatus === '승인' ? '#e4f3e9' : '#ffffff'}; transition: 0.15s;">
                            <i class="fas fa-check-circle" style="font-size: 26px; color: ${fillStatus === '승인' ? '#2f855a' : '#cbd5e1'}; margin-bottom: 8px; transition: 0.15s;"></i>
                            <div style="font-weight: 600; font-size: 15px; color: ${fillStatus === '승인' ? '#1e293b' : '#94a3b8'};">승인</div>
                        </div>
                    </label>
                    <label style="${cursorStyle}">
                        <input type="radio" name="analysis_status" value="조건부승인" ${fillStatus === '조건부승인' ? 'checked' : ''} ${readOnly} style="display: none;">
                        <div class="status-option status-option-conditional" data-value="조건부승인" style="padding: 20px; border: none; border-radius: 14px; text-align: center; background: ${fillStatus === '조건부승인' ? '#fbecd2' : '#ffffff'}; transition: 0.15s;">
                            <i class="fas fa-exclamation-triangle" style="font-size: 26px; color: ${fillStatus === '조건부승인' ? '#b45309' : '#cbd5e1'}; margin-bottom: 8px; transition: 0.15s;"></i>
                            <div style="font-weight: 600; font-size: 15px; color: ${fillStatus === '조건부승인' ? '#1e293b' : '#94a3b8'};">조건부승인</div>
                        </div>
                    </label>
                    <label style="${cursorStyle}">
                        <input type="radio" name="analysis_status" value="거부" ${fillStatus === '거부' ? 'checked' : ''} ${readOnly} style="display: none;">
                        <div class="status-option status-option-reject" data-value="거부" style="padding: 20px; border: none; border-radius: 14px; text-align: center; background: ${fillStatus === '거부' ? '#fbeae6' : '#ffffff'}; transition: 0.15s;">
                            <i class="fas fa-times-circle" style="font-size: 26px; color: ${fillStatus === '거부' ? '#a53b22' : '#cbd5e1'}; margin-bottom: 8px; transition: 0.15s;"></i>
                            <div style="font-weight: 600; font-size: 15px; color: ${fillStatus === '거부' ? '#1e293b' : '#94a3b8'};">거부</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <!-- 2. 프로그램 & 일정 (학습 방식 → 프로그램 → 시작일·종료일 한 흐름) -->
            <div class="form-group" id="formGroup-program">
                <label class="form-label">2. 프로그램 &amp; 일정</label>

                <!-- 저장용 hidden: 자기주도 여부 / 기간·트랙(문자열 재조립 소스) -->
                <input type="hidden" name="self_paced" id="self_paced" value="${fillSelfPaced ? 'true' : 'false'}">
                <input type="hidden" name="program_duration" id="program_duration" value="${fillProgram.includes('Fast') ? 'fast' : fillProgram.includes('Standard') ? 'standard' : ''}">
                <input type="hidden" name="program_track" id="program_track" value="${fillProgram.includes('Australia') ? 'australia' : 'regular'}">

                <!-- 회색 본문 위에 뜨는 흰 카드. 세그먼트·입력칸이 배경에 묻히지 않게 한다 -->
                <div style="background: #ffffff; border-radius: 14px; padding: 20px 22px;">

                <!-- 학습 방식 세그먼트 (정규 과정 / 자기주도) -->
                <div id="modeSegmentWrap" style="${pointerEvents}">
                    <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">학습 방식</label>
                    <div style="display: flex; gap: 4px; background: #eef1f5; border-radius: 10px; padding: 4px; max-width: 340px;">
                        <button type="button" id="seg_mode_regular" onclick="setLearningMode('regular')" style="flex: 1; padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.15s; font-family: inherit; ${!fillSelfPaced ? 'background:#ffffff; color:#4c1d95; font-weight:700; box-shadow:0 1px 3px rgba(25,28,29,0.12);' : 'background:transparent; color:#64748b; font-weight:500;'}">정규 과정</button>
                        <button type="button" id="seg_mode_selfpaced" onclick="setLearningMode('selfpaced')" style="flex: 1; padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.15s; font-family: inherit; ${fillSelfPaced ? 'background:#ffffff; color:#4c1d95; font-weight:700; box-shadow:0 1px 3px rgba(25,28,29,0.12);' : 'background:transparent; color:#64748b; font-weight:500;'}">자기주도</button>
                    </div>
                </div>

                <!-- 정규 프로그램 타입 (기간·트랙) — 자기주도면 숨김 -->
                <div id="regularProgramType" style="${fillSelfPaced ? 'display: none;' : ''} margin-top: 16px; ${pointerEvents}">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div>
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">기간 <span class="required">*</span></label>
                            <div style="display: flex; gap: 4px; background: #eef1f5; border-radius: 10px; padding: 4px;">
                                <button type="button" id="seg_duration_fast" onclick="setProgramSegment('duration','fast')" style="flex: 1; padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.15s; font-family: inherit; ${fillProgram.includes('Fast') ? 'background:#ffffff; color:#4c1d95; font-weight:700; box-shadow:0 1px 3px rgba(25,28,29,0.12);' : 'background:transparent; color:#64748b; font-weight:500;'}">Fast · 4주</button>
                                <button type="button" id="seg_duration_standard" onclick="setProgramSegment('duration','standard')" style="flex: 1; padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.15s; font-family: inherit; ${fillProgram.includes('Standard') ? 'background:#ffffff; color:#4c1d95; font-weight:700; box-shadow:0 1px 3px rgba(25,28,29,0.12);' : 'background:transparent; color:#64748b; font-weight:500;'}">Standard · 8주</button>
                            </div>
                        </div>
                        <div>
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">트랙</label>
                            <div style="display: flex; gap: 4px; background: #eef1f5; border-radius: 10px; padding: 4px;">
                                <button type="button" id="seg_track_regular" onclick="setProgramSegment('track','regular')" style="flex: 1; padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.15s; font-family: inherit; ${!fillProgram.includes('Australia') ? 'background:#ffffff; color:#4c1d95; font-weight:700; box-shadow:0 1px 3px rgba(25,28,29,0.12);' : 'background:transparent; color:#64748b; font-weight:500;'}">일반</button>
                                <button type="button" id="seg_track_australia" onclick="setProgramSegment('track','australia')" style="flex: 1; padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.15s; font-family: inherit; ${fillProgram.includes('Australia') ? 'background:#ffffff; color:#4c1d95; font-weight:700; box-shadow:0 1px 3px rgba(25,28,29,0.12);' : 'background:transparent; color:#64748b; font-weight:500;'}">호주</button>
                            </div>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 8px;">
                        학생 희망: <strong>${app.preferred_program || '-'}</strong>
                    </div>
                </div>

                <!-- 자기주도 학습 카드 — 자기주도면 표시. 내부적으로는 Fast·일반으로 저장 -->
                <div id="selfPacedCard" style="${fillSelfPaced ? '' : 'display: none;'} margin-top: 16px; background: #ecfeff; border-radius: 12px; padding: 14px 16px;">
                    <div style="font-weight: 600; font-size: 14px; color: #0e7490;">자기주도 학습 <span style="font-size: 12px; font-weight: 500;">· 24세트</span></div>
                    <div style="font-size: 12px; color: #155e75; margin-top: 4px; line-height: 1.5;">시작일~완료 종료일 사이에 24세트가 자동 배분됩니다. 매일 마감·시작 요일 제약 없음.</div>
                </div>

                <!-- 일정: 시작일 + 종료일(모드별) -->
                <div style="margin-top: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div>
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">시작일 <span id="scheduleStartWeekdayHint" style="color:#94a3b8; font-size:11px;">${fillSelfPaced ? '(요일 제약 없음)' : '(일요일만)'}</span> <span class="required">*</span></label>
                            <input type="date" name="schedule_start" id="schedule_start"
                                   value="${fillScheduleStart}"
                                   required
                                   ${readOnly}
                                   style="width: 100%; box-sizing: border-box; padding: 10px 12px; border: none; border-radius: 8px; background: #eef1f5; outline: none; font-family: 'Pretendard', -apple-system, sans-serif;">
                        </div>
                        <!-- 정규: 자동계산 종료일 -->
                        <div id="scheduleEndWrapper" style="${fillSelfPaced ? 'display: none;' : ''}">
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">종료일 (자동계산)</label>
                            <input type="date" name="schedule_end" id="schedule_end"
                                   value="${fillScheduleEnd}"
                                   readonly
                                   style="width: 100%; box-sizing: border-box; padding: 10px 12px; border: none; border-radius: 8px; background: #eef1f5; color: #94a3b8; outline: none; font-family: 'Pretendard', -apple-system, sans-serif;">
                        </div>
                        <!-- 자기주도: 완료 종료일(수동) — input 자체 disabled(${readOnly})로 잠금 처리 -->
                        <div id="selfPacedEndWrapper" style="${fillSelfPaced ? '' : 'display: none;'}">
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">완료 종료일 <span style="color:#0e7490; font-size:11px;">(24세트 배분 마지막 날)</span></label>
                            <input type="date" name="self_paced_end_date" id="self_paced_end_date"
                                   value="${fillSelfPacedEndDate}"
                                   ${readOnly}
                                   style="width: 100%; box-sizing: border-box; padding: 10px 12px; border: none; border-radius: 8px; background: #eef1f5; outline: none; font-family: 'Pretendard', -apple-system, sans-serif;">
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 6px;">
                        학생이 희망한 챌린지 시작일: <strong>${app.preferred_start_date || '미입력'}</strong>
                    </div>
                </div>

                </div><!-- /흰 카드 -->
            </div>

            <!-- 3. 추가 옵션 (스라첨삭) -->
            <div class="form-group" id="formGroup-options">
                <label class="form-label">3. 추가 옵션</label>
                <div id="optionToggles" style="background: #ffffff; border-radius: 14px; padding: 4px 18px; ${pointerEvents}">
                    <!-- 스라첨삭 -->
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; gap: 12px;">
                        <div>
                            <div style="font-weight: 600; font-size: 14px; color: #1e293b;">스라첨삭 <span style="font-size: 12px; color: #3b82f6; font-weight: 500;">+200,000원</span></div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">학생 희망: <strong>${app.preferred_correction === '신청희망' ? '신청희망' : app.preferred_correction === '신청' ? '신청희망' : app.preferred_correction === '미신청' ? '미신청' : '미선택'}</strong></div>
                        </div>
                        <input type="hidden" name="correction_enabled" id="correction_enabled" value="${fillCorrectionEnabled ? 'true' : 'false'}">
                        <label onclick="toggleOptionSwitch('correction_enabled')" style="position: relative; display: inline-block; width: 48px; height: 26px; cursor: pointer; flex-shrink: 0;">
                            <span id="correction_enabled_track" style="position: absolute; inset: 0; background: ${fillCorrectionEnabled ? '#3b82f6' : '#cbd5e1'}; border-radius: 26px; transition: 0.3s;"></span>
                            <span id="correction_enabled_knob" style="position: absolute; top: 3px; left: ${fillCorrectionEnabled ? '25px' : '3px'}; width: 20px; height: 20px; background: white; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></span>
                        </label>
                    </div>
                    <!-- 첨삭 시작일 (아코디언) -->
                    <div id="correctionStartDateWrapper" style="padding: 0 0 12px; ${fillCorrectionEnabled ? '' : 'display: none;'}">
                        <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">첨삭 시작일 (일·월요일만) <span style="color:#3b82f6; font-size:11px;">(D-1부터 자동 활성화)</span></label>
                        <input type="date" name="correction_start_date" id="correction_start_date"
                               value="${fillCorrectionStartDate}"
                               ${readOnly}
                               style="width: 100%; box-sizing: border-box; padding: 10px 12px; border: none; border-radius: 8px; background: #eef1f5; outline: none; font-family: 'Pretendard', -apple-system, sans-serif;">
                    </div>
                    <!-- 첨삭 연장 (13~24세션) — 개별분석 발행과 무관한 독립 액션. 발행 후(읽기전용)에도 동작 -->
                    <div id="correctionExtensionWrapper" style="padding: 0 0 12px; ${fillCorrectionEnabled ? '' : 'display: none;'}">
                        <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">첨삭 연장 (13~24세션) <span style="color:#7c3aed; font-size:11px;">결제 확인 후 적용</span></label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="date" id="extension_start_date" value="${fillExtensionStartDate}"
                                   style="flex: 1; box-sizing: border-box; padding: 10px 12px; border: none; border-radius: 8px; background: #eef1f5; outline: none; font-family: 'Pretendard', -apple-system, sans-serif;">
                            <button type="button" id="applyExtensionBtn" onclick="applyCorrectionExtension()"
                                    style="padding: 10px 16px; background: #7c3aed; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; white-space: nowrap;">연장 적용</button>
                        </div>
                        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">13~24세션 시작일을 넣고 [연장 적용]. 날짜를 비우고 적용하면 연장이 해제됩니다.</div>
                    </div>
                </div>
            </div>

            <!-- 4. 가격 정보 -->
            <div class="form-group" id="formGroup-price">
                <label class="form-label">4. 가격 정보</label>
                <div style="background: #ffffff; padding: 20px 22px; border-radius: 14px;">
                    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                        <tbody>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">정가</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600;">1,000,000원</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">시험료 지원</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #22c55e;">-210,000원</td>
                        </tr>
                        <tr id="correctionPriceRow" style="${fillCorrectionEnabled ? '' : 'display: none;'}">
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">스라첨삭</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #3b82f6;">+200,000원</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">
                                추가 할인 
                                <input type="number" name="additional_discount" id="additional_discount" 
                                       value="${fillAdditionalDiscount}" min="0" max="790000"
                                       ${readOnly}
                                       onchange="calculateModalPrice()"
                                       style="width: 120px; padding: 6px 10px; border: none; border-radius: 6px; background: #eef1f5; outline: none; font-family: inherit; margin-left: 8px;">원
                            </td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #ef4444;" id="displayAdditionalDiscount">-0원</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">보증금 (환불)</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600;">+100,000원</td>
                        </tr>
                        <tr>
                            <td style="padding: 16px 12px 14px; font-weight: 700; color: #1e293b; text-align: left; background: #f4f6f9; border-radius: 10px 0 0 10px;">최종 금액</td>
                            <td style="padding: 16px 12px 14px; text-align: right; font-weight: 700; font-size: 20px; letter-spacing: -0.02em; color: #7c68a8; background: #f4f6f9; border-radius: 0 10px 10px 0;" id="displayFinalPrice">890,000원</td>
                        </tr>
                        </tbody>
                    </table>
                    <div id="discountReasonWrapper" style="margin-top: 12px; display: ${fillAdditionalDiscount && fillAdditionalDiscount > 0 ? 'block' : 'none'};">
                        <label style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">할인 사유</label>
                        <input type="text" name="discount_reason" value="${fillDiscountReason}"
                               ${readOnly}
                               placeholder="할인 사유 입력"
                               style="width: 100%; box-sizing: border-box; padding: 10px 12px; border: none; border-radius: 8px; background: #eef1f5; outline: none; font-family: inherit;">
                    </div>
                </div>
            </div>
            
            <!-- 5. 분석 내용 -->
            <div class="form-group">
                <label class="form-label">5. 분석 내용 <span class="required">*</span></label>
                <textarea name="analysis_content" id="analysis_content" rows="10" required
                          ${readOnly}
                          style="width: 100%; box-sizing: border-box; padding: 14px; border: none; border-radius: 12px; background: #ffffff; outline: none; font-family: inherit; line-height: 1.7;"
                          placeholder="학생에게 보여질 분석 내용을 작성하세요.

예시:
[현재 수준]
- Reading: 중급 / Listening: 초급
- 현재 총점: 65점

[목표 점수]
- 목표: 100점 / 기한: 2024년 6월

[추천 사항]
- Standard 프로그램 (8주) 권장
- Listening 집중 학습 필요

[학습 계획]
1주차: 기초 문법 다지기
2-4주차: Reading 실전 연습
5-8주차: Listening 강화 훈련">${fillContent || ''}</textarea>
            </div>
            
            <!-- 하단 버튼 -->
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 36px;">
                <div style="display: flex; gap: 8px;">
                    ${hasAnalysis ? `
                    <button type="button" class="btn-secondary" onclick="previewAnalysis('${app.id}')">
                        <i class="fas fa-eye"></i> 미리보기
                    </button>
                    <button type="button" class="btn-secondary" onclick="editAnalysis()" id="editAnalysisBtn">
                        <i class="fas fa-edit"></i> 수정하기
                    </button>
                    ` : ''}
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button type="button" class="btn-secondary" onclick="closeManageModal()">취소</button>
                    ${isScheduled ? `
                        <!-- 예약 중: 변경사항 저장 (예약 시각 유지) -->
                        <button type="submit" class="btn-primary" id="saveAnalysisBtn" data-mode="update-scheduled" style="padding: 12px 24px;">
                            <i class="fas fa-save"></i> 변경사항 저장
                        </button>
                    ` : hasAnalysis ? `
                        <!-- 이미 공개됨: 수정 모드 — 즉시발송 / 예약발송 / 조용히수정 -->
                        <button type="button" class="btn-primary" id="silentSaveBtn" onclick="silentSaveAnalysis()" disabled
                                style="opacity: 0.5; cursor: not-allowed; padding: 12px 24px; background: #64748b; border: none; color: white; border-radius: 8px; font-weight: 600;">
                            <i class="fas fa-volume-mute"></i> 조용히수정
                        </button>
                        <button type="submit" class="btn-primary" id="saveAnalysisBtn" data-mode="immediate" disabled style="opacity: 0.5; cursor: not-allowed; padding: 12px 24px;">
                            <i class="fas fa-paper-plane"></i> 즉시발송
                        </button>
                        <button type="button" class="btn-primary" id="scheduleAnalysisBtn" onclick="openScheduleModal()" disabled
                                style="opacity: 0.5; cursor: not-allowed; padding: 12px 24px; background: #ebe6f4; border: none; color: #4c1d95; border-radius: 8px; font-weight: 600;">
                            <i class="fas fa-clock"></i> 예약발송
                        </button>
                    ` : `
                        <!-- 최초 저장: 즉시발송 / 예약발송 (조용히수정 없음) -->
                        <button type="submit" class="btn-primary" id="saveAnalysisBtn" data-mode="immediate" style="padding: 12px 24px;">
                            <i class="fas fa-paper-plane"></i> 즉시발송
                        </button>
                        <button type="button" class="btn-primary" onclick="openScheduleModal()"
                                style="padding: 12px 24px; background: #ebe6f4; border: none; color: #4c1d95; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit;">
                            <i class="fas fa-clock"></i> 예약발송
                        </button>
                    `}
                </div>
            </div>
        </form>
    `;
    
    container.innerHTML = html;
    
    // 이벤트 리스너 추가
    calculateModalPrice();
    toggleCorrectionStartDate();
    // 학습 방식(정규/자기주도)에 맞춰 프로그램 영역·종료일 슬롯·시작일 안내 초기 반영
    syncLearningModeUI();

    // 거부·조건부승인으로 저장된 경우 프로그램/일정/가격 섹션 비활성화 적용
    if (fillStatus === '거부' || fillStatus === '조건부승인') {
        setRejectionUIState(true);
    }

    // 결과 선택 옵션에 클릭 이벤트 추가
    // (저장 완료 후 읽기 전용 상태가 아닐 때 = 최초 저장 전 또는 예약 대기 중)
    if (!hasAnalysis) {
        document.querySelectorAll('.status-option').forEach(option => {
            option.addEventListener('click', function(e) {
                const value = this.getAttribute('data-value');
                selectStatus(value, e);
            });
        });
    }
    
    // 일정 계산 이벤트 (기간 세그먼트 변경은 setProgramSegment 내부에서 직접 호출)
    const scheduleStart = document.getElementById('schedule_start');
    if (scheduleStart) {
        scheduleStart.addEventListener('change', calculateModalEndDate);
    }
    
    // 첨삭 시작일 일·월요일 검증 이벤트
    const correctionStartDate = document.getElementById('correction_start_date');
    if (correctionStartDate) {
        correctionStartDate.addEventListener('change', validateCorrectionStartDate);
    }
    
    // 프로모션 유도 학생 토글 인터랙션
    const incentiveToggle = document.getElementById('incentiveToggle');
    const bookAccessToggle = document.getElementById('bookAccessToggle');
    if (incentiveToggle && !hasAnalysis) {
        incentiveToggle.addEventListener('change', function() {
            const slider = this.parentElement.querySelectorAll('span');
            if (this.checked) {
                slider[0].style.background = '#f59e0b';
                slider[1].style.left = '25px';
                // 프로모션 ON → 입문서도 자동 ON (dispatchEvent로 즉시 DB 저장 트리거)
                if (bookAccessToggle && !bookAccessToggle.checked) {
                    bookAccessToggle.checked = true;
                    bookAccessToggle.dispatchEvent(new Event('change'));
                }
            } else {
                slider[0].style.background = '#cbd5e1';
                slider[1].style.left = '3px';
            }
        });
    }

    // 입문서 제공 토글 인터랙션 (즉시 DB 저장)
    if (bookAccessToggle) {
        bookAccessToggle.addEventListener('change', async function() {
            const slider = this.parentElement.querySelectorAll('span');
            const newValue = this.checked;
            if (newValue) {
                slider[0].style.background = '#38bdf8';
                slider[1].style.left = '25px';
            } else {
                slider[0].style.background = '#cbd5e1';
                slider[1].style.left = '3px';
            }
            try {
                await supabaseAPI.patch('applications', currentManageApp.id, { book_access_enabled: newValue });
                currentManageApp.book_access_enabled = newValue;
            } catch (e) {
                console.error('입문서 제공 토글 저장 실패:', e);
                alert('❌ 입문서 제공 설정 저장에 실패했습니다.');
                this.checked = !newValue;
                slider[0].style.background = !newValue ? '#38bdf8' : '#cbd5e1';
                slider[1].style.left = !newValue ? '25px' : '3px';
            }
        });
    }
}

// 첨삭 시작일 일·월요일 검증
function validateCorrectionStartDate() {
    const input = document.getElementById('correction_start_date');
    if (!input || !input.value) return;

    const selectedDate = new Date(input.value);
    const dayOfWeek = selectedDate.getDay();

    // 일요일(0)·월요일(1)이 아니면 경고
    if (dayOfWeek !== 0 && dayOfWeek !== 1) {
        alert('⚠️ 첨삭 시작일은 일요일 또는 월요일만 선택 가능합니다.\n가장 가까운 일요일 또는 월요일을 선택해주세요.');
        input.value = '';
    }
}

// 스라첨삭 시작일 토글
function toggleCorrectionStartDate() {
    const enabled = document.getElementById('correction_enabled').value === 'true';
    const wrapper = document.getElementById('correctionStartDateWrapper');
    const priceRow = document.getElementById('correctionPriceRow');
    const extWrapper = document.getElementById('correctionExtensionWrapper');
    if (wrapper) {
        wrapper.style.display = enabled ? '' : 'none';
    }
    if (priceRow) {
        priceRow.style.display = enabled ? '' : 'none';
    }
    // 연장은 첨삭이 켜진 학생에게만 의미가 있음
    if (extWrapper) {
        extWrapper.style.display = enabled ? '' : 'none';
    }
}

// 세그먼트 버튼 선택/비선택 스타일 적용 (공통)
function _applySegStyle(btn, on) {
    if (!btn) return;
    btn.style.background = on ? '#ffffff' : 'transparent';
    btn.style.color = on ? '#4c1d95' : '#64748b';
    btn.style.fontWeight = on ? '700' : '500';
    btn.style.boxShadow = on ? '0 1px 3px rgba(25,28,29,0.12)' : 'none';
}
function _setDisp(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
}

// 학습 방식 세그먼트 클릭(정규 과정 / 자기주도) — 숨은 self_paced 값 갱신 후 UI 동기화.
function setLearningMode(mode) {
    const input = document.getElementById('self_paced');
    if (input) input.value = (mode === 'selfpaced') ? 'true' : 'false';
    syncLearningModeUI();
}

// 현재 self_paced 상태에 맞춰 학습방식 세그먼트/프로그램 영역/종료일 슬롯/시작일 안내를 일괄 반영.
// (렌더 초기화 및 모드 전환 시 호출) 자기주도는 일반·Fast(24세트) 고정.
function syncLearningModeUI() {
    const sp = isSelfPacedOn();
    // 학습 방식 세그먼트 하이라이트
    _applySegStyle(document.getElementById('seg_mode_regular'), !sp);
    _applySegStyle(document.getElementById('seg_mode_selfpaced'), sp);
    // 자기주도면 저장 호환 위해 기간=Fast·트랙=일반 강제
    if (sp) {
        setProgramSegment('duration', 'fast', true);
        setProgramSegment('track', 'regular', true);
    }
    // 프로그램 영역: 정규 기간·트랙 vs 자기주도 카드
    _setDisp('regularProgramType', !sp);
    _setDisp('selfPacedCard', sp);
    // 종료일 슬롯: 정규 자동계산 vs 자기주도 완료 종료일
    _setDisp('scheduleEndWrapper', !sp);
    _setDisp('selfPacedEndWrapper', sp);
    // 시작일 요일 안내
    const startHint = document.getElementById('scheduleStartWeekdayHint');
    if (startHint) startHint.textContent = sp ? '(요일 제약 없음)' : '(일요일만)';
    // 정규 전환 시 종료일 재계산
    if (!sp) calculateModalEndDate();
}

// 자기주도 여부 조회 헬퍼
function isSelfPacedOn() {
    const sel = document.getElementById('self_paced');
    return !!(sel && sel.value === 'true');
}

// 프로그램 세그먼트(기간 fast/standard · 트랙 regular/australia) 선택.
// 저장 시 assigned_program 문자열로 재조립되며, 기간 변경 시 종료일을 다시 계산한다.
// skipRecalc: syncLearningModeUI 내부에서 중복 재계산을 막기 위한 플래그.
function setProgramSegment(group, val, skipRecalc) {
    const input = document.getElementById('program_' + group);
    if (input) input.value = val;
    const opts = group === 'duration' ? ['fast', 'standard'] : ['regular', 'australia'];
    opts.forEach(function(opt) {
        _applySegStyle(document.getElementById('seg_' + group + '_' + opt), opt === val);
    });
    if (group === 'duration' && !skipRecalc) calculateModalEndDate();
}

// 추가옵션 스위치 토글(스라첨삭) — 숨은 input(value 'true'/'false')을 갱신하고
// 스위치 색·노브 위치 + 의존 UI(가격표·아코디언)를 함께 반영한다.
function toggleOptionSwitch(name) {
    const input = document.getElementById(name);
    if (!input) return;
    const on = input.value !== 'true';
    input.value = on ? 'true' : 'false';
    const track = document.getElementById(name + '_track');
    const knob = document.getElementById(name + '_knob');
    if (track) track.style.background = on ? '#3b82f6' : '#cbd5e1';
    if (knob) knob.style.left = on ? '25px' : '3px';
    if (name === 'correction_enabled') { toggleCorrectionStartDate(); calculateModalPrice(); }
}

// ===== 첨삭 연장(13~24세션) 적용/해제 — 개별분석 저장과 분리된 즉시 액션 =====
// applications(대시보드용 미러) + correction_schedules(테스트룸 원본) 양쪽에 기록.
async function applyCorrectionExtension() {
    if (!currentManageApp) return;
    const input = document.getElementById('extension_start_date');
    const btn = document.getElementById('applyExtensionBtn');
    const extStart = (input && input.value) ? input.value : '';
    const enabled = !!extStart;
    const userId = currentManageApp.user_id;

    if (!userId) { alert('학생 user_id를 찾을 수 없습니다.'); return; }

    if (enabled) {
        if (!confirm(`${currentManageApp.name || '학생'}님의 13~24세션을 ${extStart}부터 열겠습니까?`)) return;
    } else {
        if (!confirm('연장을 해제하시겠습니까?\n13~24세션이 학생 화면에서 숨겨집니다.')) return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
    try {
        // 1) applications 미러 (대시보드/신청상세가 읽음)
        await supabaseAPI.patch('applications', currentManageApp.id, {
            extension_enabled: enabled,
            extension_start_date: extStart || null
        });
        currentManageApp.extension_enabled = enabled;
        currentManageApp.extension_start_date = extStart || null;

        // 2) correction_schedules 원본 (테스트룸이 읽음)
        await upsertCorrectionExtensionSchedule(userId, enabled, extStart || null);

        // 3) 첨삭 연장 완료 알림톡 — 켤 때 & 아직 미발송일 때만 1회 (실패해도 연장 적용은 유지)
        if (enabled) {
            try {
                await maybeSendExtensionAlimTalk(userId, extStart);
            } catch (e) {
                console.warn('연장 알림톡 처리 실패(무시):', e);
            }
        }

        alert(enabled
            ? '✅ 연장 적용 완료 — 학생 화면에 13~24세션이 열렸습니다.'
            : '✅ 연장 해제 완료.');
    } catch (e) {
        console.error('첨삭 연장 적용 실패:', e);
        alert('❌ 연장 적용에 실패했습니다.\n\n' + (e.message || ''));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '연장 적용'; }
    }
}

// correction_schedules에 연장 필드 UPSERT (on_conflict=user_id).
// 행이 없을 경우(신규 insert)에도 NOT NULL 제약을 만족하도록 1학기 기준값을 함께 보냄.
async function upsertCorrectionExtensionSchedule(userId, enabled, extStartDate) {
    const url = `${SUPABASE_URL}/rest/v1/correction_schedules?on_conflict=user_id`;
    const body = {
        user_id: userId,
        extension_enabled: enabled,
        extension_start_date: extStartDate
    };
    // 행이 없을 때만 의미가 있는 안전장치(행이 있으면 동일 값 재기록)
    if (currentManageApp && currentManageApp.correction_start_date) {
        body.start_date = currentManageApp.correction_start_date;
        body.duration_weeks = 4;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.message || `correction_schedules 연장 UPSERT 실패: ${response.status}`);
    }
    return await response.json();
}

// ===== 첨삭 연장 완료 알림톡(50227) 발송 =====
// correction_schedules.extension_notify_sent 플래그로 중복 발송 방지 — 학생당 1회.
// 발송 성공 시에만 플래그를 set하므로, 실패하면 다음 연장 적용 때 재시도된다.
async function maybeSendExtensionAlimTalk(userId, extStart) {
    if (!currentManageApp || !currentManageApp.phone || !extStart) return;

    // 1) 이미 발송했는지 확인 (correction_schedules)
    const checkUrl = `${SUPABASE_URL}/rest/v1/correction_schedules?user_id=eq.${userId}&select=extension_notify_sent`;
    const checkResp = await fetch(checkUrl, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const rows = await checkResp.json();
    if (Array.isArray(rows) && rows[0] && rows[0].extension_notify_sent === true) {
        console.log('연장 알림톡 이미 발송됨 — 스킵');
        return;
    }

    // 2) 일정 계산: 시작일 ~ +27일(연장 4주차 마지막 날)
    const startD = new Date(extStart + 'T00:00:00');
    const endD = new Date(startD.getTime() + 27 * 24 * 60 * 60 * 1000);
    const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

    // 3) 발송 (회차: 첫 연장 = 1회차. 다회 연장 도입 시 회차 카운터로 교체)
    const res = await sendKakaoAlimTalk('correction_extension_complete', {
        name: currentManageApp.name,
        phone: currentManageApp.phone,
        app_id: currentManageApp.id,
        round: '1',
        start_date: fmt(startD),
        end_date: fmt(endD)
    });

    // 4) 성공 시에만 플래그 set
    if (res && res.success) {
        const patchUrl = `${SUPABASE_URL}/rest/v1/correction_schedules?user_id=eq.${userId}`;
        await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                extension_notify_sent: true,
                extension_notify_sent_at: new Date().toISOString()
            })
        });
    } else {
        console.warn('연장 알림톡 발송 실패 — 플래그 미설정(다음에 재시도):', res);
    }
}

// 모달 내 가격 계산
function calculateModalPrice() {
    const additionalDiscount = parseInt(document.getElementById('additional_discount').value) || 0;
    const correctionEnabled = document.getElementById('correction_enabled')?.value === 'true';
    const correctionFee = correctionEnabled ? 200000 : 0;
    const basePrice = 790000;
    const deposit = 100000;
    const finalPrice = basePrice + correctionFee - additionalDiscount + deposit;
    
    document.getElementById('displayAdditionalDiscount').textContent = '-' + additionalDiscount.toLocaleString() + '원';
    document.getElementById('displayFinalPrice').textContent = finalPrice.toLocaleString() + '원';
    
    // 추가 할인 금액에 따라 할인 사유란 표시/숨김
    const reasonWrapper = document.getElementById('discountReasonWrapper');
    if (reasonWrapper) {
        reasonWrapper.style.display = additionalDiscount > 0 ? 'block' : 'none';
    }
}

// 결과 선택 시각적 피드백
function selectStatus(value, event) {
    if (event) event.preventDefault();

    // 모든 옵션의 라디오 버튼 체크 해제
    document.querySelectorAll('#statusOptionsContainer input[type="radio"]').forEach(radio => {
        radio.checked = false;
    });

    // 선택 표시는 테두리가 아니라 면 채움과 아이콘 색으로 한다 (DESIGN.md: No-Line Rule)
    const TONE = {
        '승인':       { bg: '#e4f3e9', icon: '#2f855a' },
        '조건부승인': { bg: '#fbecd2', icon: '#b45309' },
        '거부':       { bg: '#fbeae6', icon: '#a53b22' }
    };

    // 모든 옵션 스타일 초기화
    document.querySelectorAll('.status-option').forEach(option => {
        option.style.background = '#ffffff';
        const icon = option.querySelector('i');
        const label = option.querySelector('div');
        if (icon) icon.style.color = '#cbd5e1';
        if (label) label.style.color = '#94a3b8';
    });

    // 선택된 라디오 버튼 체크
    const selectedRadio = document.querySelector(`#statusOptionsContainer input[value="${value}"]`);
    if (selectedRadio) {
        selectedRadio.checked = true;
    }

    // 선택된 옵션 스타일 적용
    const selectedOption = document.querySelector(`.status-option[data-value="${value}"]`);
    const tone = TONE[value];
    if (selectedOption && tone) {
        selectedOption.style.background = tone.bg;
        const icon = selectedOption.querySelector('i');
        const label = selectedOption.querySelector('div');
        if (icon) icon.style.color = tone.icon;
        if (label) label.style.color = '#1e293b';
    }

    // 거부·조건부승인 시 프로그램/일정/가격 섹션 비활성화 (조건부승인은 아직 협의 전이라 미정)
    setRejectionUIState(value === '거부' || value === '조건부승인');
}

// 거부·조건부승인 선택 시 프로그램 배정/일정/가격 정보 섹션 비활성화 처리
// (조건부승인은 아직 학생과 협의 전 단계라 프로그램·가격·일정을 미정으로 둔다)
function setRejectionUIState(isRejected) {
    // 실제 입력 필드(날짜/숫자/텍스트)는 disabled 처리
    const fieldNames = [
        'schedule_start',
        'correction_start_date',
        'self_paced_end_date',
        'additional_discount',
        'discount_reason'
    ];
    fieldNames.forEach(name => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) el.disabled = isRejected;
    });

    // 세그먼트(학습방식·기간·트랙) / 추가옵션 토글은 커스텀 컨트롤 → 컨테이너 클릭 차단으로 비활성화
    ['modeSegmentWrap', 'regularProgramType', 'optionToggles'].forEach(id => {
        const c = document.getElementById(id);
        if (c) c.style.pointerEvents = isRejected ? 'none' : 'auto';
    });

    // required 토글 (시작일만 — 프로그램은 커스텀 세그먼트라 저장 시 JS로 검증)
    const startEl = document.querySelector('[name="schedule_start"]');
    if (startEl) {
        if (isRejected) startEl.removeAttribute('required');
        else startEl.setAttribute('required', '');
    }

    // 시각적 그레이아웃
    ['formGroup-program', 'formGroup-options', 'formGroup-price'].forEach(id => {
        const g = document.getElementById(id);
        if (g) g.style.opacity = isRejected ? '0.5' : '';
    });
}

// 모달 내 종료일 계산 (기간 세그먼트 program_duration 기준)
function calculateModalEndDate() {
    const startInput = document.getElementById('schedule_start');
    const endInput = document.getElementById('schedule_end');
    if (!startInput || !endInput) return;
    const durationEl = document.getElementById('program_duration');
    const duration = durationEl ? durationEl.value : '';

    if (!startInput.value || !duration) {
        return;
    }

    // 자기주도(Self-Paced)는 시작 요일 제약이 없다. 종료일도 관리자가 직접 입력하므로
    // 여기서 챌린지 종료일 자동계산을 하지 않는다.
    if (typeof isSelfPacedOn === 'function' && isSelfPacedOn()) {
        return;
    }

    const startDate = new Date(startInput.value);
    const dayOfWeek = startDate.getDay();

    // 일요일(0)이 아니면 경고
    if (dayOfWeek !== 0) {
        alert('⚠️ 시작일은 일요일만 선택 가능합니다.\n가장 가까운 일요일을 선택해주세요.');
        startInput.value = '';
        endInput.value = '';
        return;
    }

    // 기간에 따라 주수 결정 (fast=4주 / standard=8주)
    const weeks = duration === 'fast' ? 4 : 8;

    // 종료일 계산: 시작일 + weeks주 후 토요일
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (weeks * 7) - 1);

    // ISO 형식으로 변환
    const endDateString = endDate.toISOString().split('T')[0];
    endInput.value = endDateString;
}

// correction_schedules UPSERT (첨삭 스케줄 자동 생성/업데이트)
async function upsertCorrectionSchedule(userId, startDate, durationWeeks) {
    const url = `${SUPABASE_URL}/rest/v1/correction_schedules?on_conflict=user_id`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify({
            user_id: userId,
            start_date: startDate,
            duration_weeks: durationWeeks
        })
    });
    
    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.message || `correction_schedules UPSERT 실패: ${response.status}`);
    }
    
    return await response.json();
}

// ===== 조용히수정 (알림톡 없이 저장) =====
function silentSaveAnalysis() {
    const form = document.getElementById('modalAnalysisForm');
    if (!form) return;
    if (!form.reportValidity()) return;

    window._scheduledMode = 'silent';
    form.requestSubmit();
}

// ===== 분석 저장 =====
// 호출 모드 (saveAnalysisBtn 의 data-mode 또는 _scheduledMode 임시 플래그):
//   - 'immediate'         : 즉시 저장 + 알림톡 즉시 발송 (기존 동작)
//   - 'silent'            : 즉시 저장 + 알림톡 발송 안 함 (조용히수정)
//   - 'scheduled'         : 예약 저장 (DB는 pending 컬럼에 보관, 알림톡은 cron이 발송)
//   - 'update-scheduled'  : 예약 대기 중인 분석 내용만 수정 (예약 시각은 유지)
async function saveModalAnalysis(event) {
    event.preventDefault();

    const form = event.target;
    const saveBtn = document.getElementById('saveAnalysisBtn');
    // openScheduleModal()이 _scheduledMode='scheduled'와 _scheduledAtIso를 세팅하고 폼을 submit함.
    let mode = window._scheduledMode || (saveBtn?.dataset?.mode || 'immediate');
    const scheduledAtIso = window._scheduledAtIso || null;
    // 한 번 사용했으면 즉시 클리어 (다음 저장 시 영향 방지)
    window._scheduledMode = null;
    window._scheduledAtIso = null;

    // 모드별 confirm 메시지
    let confirmMsg;
    if (mode === 'scheduled') {
        const kstStr = formatScheduledAtKst(scheduledAtIso);
        confirmMsg = `예약 발송으로 저장하시겠습니까?\n\n📅 ${kstStr}에\n   학생에게 공개 + 알림톡 발송됩니다.\n\n발송 전까지 분석 내용을 자유롭게 수정하실 수 있습니다.`;
    } else if (mode === 'update-scheduled') {
        confirmMsg = '변경사항을 저장하시겠습니까?\n\n예약 시각은 그대로 유지됩니다.';
    } else if (mode === 'silent') {
        confirmMsg = '알림톡 없이 조용히 수정하시겠습니까?\n\n내용은 저장되지만 학생에게 알림톡이 발송되지 않습니다.';
    } else {
        confirmMsg = '개별분석을 즉시 저장하고 알림톡을 발송하시겠습니까?\n\n학생이 즉시 확인하고 동의할 수 있습니다.';
    }
    if (!confirm(confirmMsg)) return;

    const formData = new FormData(form);

    // 가격 계산
    // 거부·조건부승인은 프로그램/가격/일정을 비워서 저장한다.
    // (거부=종료 / 조건부승인=아직 협의 전. 승인으로 전환 저장할 때 새로 채워짐)
    const blankProgramFields = formData.get('analysis_status') === '거부'
        || formData.get('analysis_status') === '조건부승인';
    const basePrice = 1000000;
    const examSupport = 210000;
    const additionalDiscount = parseInt(formData.get('additional_discount')) || 0;
    const correctionEnabled = formData.get('correction_enabled') === 'true';
    const correctionFee = correctionEnabled ? 200000 : 0;
    const deposit = 100000;
    const finalPrice = basePrice - examSupport + correctionFee - additionalDiscount + deposit;

    // 프로그램: 기간(fast/standard) × 트랙(regular/australia) 세그먼트 → 기존 캐노니컬 문자열로 재조립.
    // (저장값은 종전과 100% 동일 → 대시보드·계약·테스트룸 등 다운스트림 파싱 로직 무변경)
    let programDuration = formData.get('program_duration') || '';
    let programTrack = formData.get('program_track') || 'regular';
    // 자기주도는 일반·Fast(24세트) 고정 — 잘못된 조합이 저장되지 않도록 방어적으로 강제.
    if (formData.get('self_paced') === 'true') {
        programDuration = 'fast';
        programTrack = 'regular';
    }
    const reconstructedProgram = programDuration
        ? ('내벨업챌린지' + (programTrack === 'australia' ? ' Australia' : '') + ' - ' + (programDuration === 'fast' ? 'Fast' : 'Standard'))
        : null;
    // 승인(프로그램을 채우는 상태)인데 기간 미선택이면 저장 불가
    if (!blankProgramFields && !programDuration) {
        alert('⚠️ 프로그램 기간(Fast / Standard)을 선택해주세요.');
        return;
    }

    // 자기주도(Self-Paced): 시작일~완료 종료일 사이에 24세트를 자동 배분. 첨삭과 병행 가능.
    const selfPacedEnabled = formData.get('self_paced') === 'true';
    const selfPacedEndDate = formData.get('self_paced_end_date') || null;
    // 자기주도 ON(프로그램을 채우는 상태)이면 종료일 필수 + 시작일보다 뒤여야 함
    if (selfPacedEnabled && !blankProgramFields) {
        const spStart = formData.get('schedule_start');
        if (!selfPacedEndDate) {
            alert('⚠️ 자기주도를 켜면 완료 종료일을 입력해야 합니다.');
            return;
        }
        if (spStart && new Date(selfPacedEndDate) <= new Date(spStart)) {
            alert('⚠️ 자기주도 완료 종료일은 시작일보다 뒤여야 합니다.');
            return;
        }
    }

    const isIncentive = document.getElementById('incentiveToggle')?.checked || false;
    const nowMs = Date.now();

    // === 분기: 예약 발송 ===
    if (mode === 'scheduled' || mode === 'update-scheduled') {
        // pending 컬럼에 저장 (정식 컬럼은 건드리지 않음 → 학생에게 공개되지 않음)
        const assignedProgramVal = blankProgramFields ? null : reconstructedProgram;
        const pendingPayload = {
            assigned_program: assignedProgramVal,
            course_track: (assignedProgramVal && assignedProgramVal.includes('Australia')) ? 'australia' : 'regular',
            correction_enabled: blankProgramFields ? false : correctionEnabled,
            correction_start_date: blankProgramFields ? null : (correctionEnabled ? (formData.get('correction_start_date') || null) : null),
            correction_fee: blankProgramFields ? 0 : correctionFee,
            program_price: blankProgramFields ? null : basePrice,
            discount_amount: blankProgramFields ? null : examSupport,
            additional_discount: blankProgramFields ? 0 : additionalDiscount,
            discount_reason: blankProgramFields ? '' : (formData.get('discount_reason') || ''),
            final_price: blankProgramFields ? null : finalPrice,
            schedule_start: blankProgramFields ? null : formData.get('schedule_start'),
            schedule_end: blankProgramFields ? null : formData.get('schedule_end'),
            self_paced: blankProgramFields ? false : selfPacedEnabled,
            self_paced_end_date: (blankProgramFields || !selfPacedEnabled) ? null : selfPacedEndDate,
            is_incentive_applicant: isIncentive,
            // 수정 여부: analysis_first_saved_at가 이미 있으면 = 이전에 공개한 적 있음 = 수정
            is_analysis_update: !!currentManageApp.analysis_first_saved_at
        };

        const updateData = {
            analysis_status_pending: formData.get('analysis_status'),
            analysis_content_pending: formData.get('analysis_content'),
            analysis_pending_payload: pendingPayload
        };
        // 'scheduled' 모드일 때만 예약 시각 새로 세팅. 'update-scheduled'는 시각 유지.
        if (mode === 'scheduled') {
            updateData.analysis_alimtalk_scheduled_at = scheduledAtIso;
        }

        try {
            const updatedApp = await supabaseAPI.patch('applications', currentManageApp.id, updateData);
            if (!updatedApp) { alert('❌ 저장에 실패했습니다.'); return; }

            currentManageApp = updatedApp;

            if (mode === 'scheduled') {
                const kstStr = formatScheduledAtKst(updatedApp.analysis_alimtalk_scheduled_at);
                alert(`✅ 예약 저장 완료!\n\n🕐 ${kstStr}에\n   학생에게 공개 + 알림톡 발송됩니다.\n\n발송 전까지 자유롭게 수정하실 수 있습니다.`);
            } else {
                alert('✅ 변경사항이 저장되었습니다.\n\n예약 시각은 그대로 유지됩니다.');
            }
            loadModalTab('analysis');
        } catch (error) {
            console.error('Save scheduled analysis error:', error);
            alert('❌ 오류가 발생했습니다.\n\n' + (error.message || ''));
        }
        return;
    }

    // === 분기: 즉시 저장 + 발송 (기존 동작) ===
    const immediateProgram = blankProgramFields ? null : reconstructedProgram;
    const updateData = {
        analysis_status: formData.get('analysis_status'),
        assigned_program: immediateProgram,
        course_track: (immediateProgram && immediateProgram.includes('Australia')) ? 'australia' : 'regular',
        correction_enabled: blankProgramFields ? false : correctionEnabled,
        correction_start_date: blankProgramFields ? null : (correctionEnabled ? (formData.get('correction_start_date') || null) : null),
        // 첨삭을 끄면 연장(13~24세션)도 함께 해제 (고아 데이터 방지)
        ...((blankProgramFields || !correctionEnabled) ? { extension_enabled: false, extension_start_date: null } : {}),
        correction_fee: blankProgramFields ? 0 : correctionFee,
        program_price: blankProgramFields ? null : basePrice,
        discount_amount: blankProgramFields ? null : examSupport,
        additional_discount: blankProgramFields ? 0 : additionalDiscount,
        discount_reason: blankProgramFields ? '' : (formData.get('discount_reason') || ''),
        final_price: blankProgramFields ? null : finalPrice,
        schedule_start: blankProgramFields ? null : formData.get('schedule_start'),
        schedule_end: blankProgramFields ? null : formData.get('schedule_end'),
        self_paced: blankProgramFields ? false : selfPacedEnabled,
        self_paced_end_date: (blankProgramFields || !selfPacedEnabled) ? null : selfPacedEndDate,
        analysis_content: formData.get('analysis_content'),
        analysis_saved_at: nowMs,
        current_step: 2,
        status: '개별분석완료',
        is_incentive_applicant: isIncentive,
        // 즉시 저장 시 예약 데이터가 남아있으면 정리 (이론상 이 분기는 isScheduled=false 상태에서만 도달하지만 안전장치)
        analysis_alimtalk_scheduled_at: null,
        analysis_status_pending: null,
        analysis_content_pending: null,
        analysis_pending_payload: null
    };

    // 동의 데드라인 계산 기준: '승인'이 되는 순간부터 시작한다.
    // 조건부승인/거부 동안에는 타이머를 시작하지 않고, '승인'으로 (전)환되는 시점에 새로 기록한다.
    // (이미 승인 상태에서 수정 저장하는 경우엔 기존 시각을 유지 → 수정해도 리셋되지 않음)
    if (formData.get('analysis_status') === '승인' && currentManageApp.analysis_status !== '승인') {
        updateData.analysis_first_saved_at = nowMs;
    }

    try {
        const updatedApp = await supabaseAPI.patch('applications', currentManageApp.id, updateData);

        if (updatedApp) {
            // 첨삭 포함일 때 correction_schedules UPSERT
            if (correctionEnabled && updateData.correction_start_date) {
                try {
                    const userId = updatedApp.user_id || currentManageApp.user_id;
                    await upsertCorrectionSchedule(userId, updateData.correction_start_date, 4);
                    console.log('✅ correction_schedules UPSERT 완료');
                } catch (e) {
                    console.error('correction_schedules UPSERT 실패:', e);
                    alert('⚠️ 첨삭 스케줄 저장에 실패했습니다. 테스트룸 쪽에서 수동 확인이 필요합니다.\n\n에러: ' + e.message);
                }
            } else if (!correctionEnabled || blankProgramFields) {
                // 첨삭 OFF → correction_schedules의 연장도 해제 (행이 있을 때만 갱신, 신규 insert 안 함)
                try {
                    const userId = updatedApp.user_id || currentManageApp.user_id;
                    if (userId) {
                        await fetch(`${SUPABASE_URL}/rest/v1/correction_schedules?user_id=eq.${userId}`, {
                            method: 'PATCH',
                            headers: {
                                'apikey': SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ extension_enabled: false, extension_start_date: null })
                        });
                    }
                } catch (e) {
                    console.warn('연장 해제(correction_schedules) 실패:', e);
                }
            }

            // 알림톡: silent 모드가 아닐 때만 발송
            let alimTalkNotice = '';
            if (mode === 'silent') {
                alimTalkNotice = '\n\n🔇 알림톡은 발송되지 않았습니다.';
            } else {
                // 최초 저장 vs 수정 저장 분기
                // analysis_first_saved_at가 이미 있었으면 = 이전에 공개한 적 있음 = 수정
                // 조건부승인/거부는 '개별분석 등록 안내(50226 — 확인 필요)' 템플릿으로 발송.
                // 단 수정 재발송(isUpdate)일 땐 기존 '수정 안내'를 우선한다.
                const isUpdate = !!currentManageApp.analysis_first_saved_at;
                const savedStatus = formData.get('analysis_status');
                const isConditionalOrReject = savedStatus === '조건부승인' || savedStatus === '거부';
                const alimTalkType = isUpdate
                    ? 'analysis_updated'
                    : isConditionalOrReject
                        ? 'analysis_registered'
                        : (isIncentive ? 'incentive_analysis_complete' : 'analysis_complete');
                try {
                    await sendKakaoAlimTalk(alimTalkType, {
                        name: updatedApp.name || currentManageApp.name,
                        phone: updatedApp.phone || currentManageApp.phone,
                        app_id: updatedApp.id || currentManageApp.id
                    });
                } catch (e) { console.warn('알림톡 발송 실패:', e); }

                alimTalkNotice = isUpdate
                    ? '\n\n📢 개별분석 수정 알림톡이 발송되었습니다.'
                    : isConditionalOrReject
                        ? '\n\n📢 개별분석 등록 안내 알림톡(확인 필요 안내)이 발송되었습니다.'
                        : (isIncentive ? '\n\n📢 프로모션 학생 전용 알림톡(개별분석 & 입문서 전송 완료 안내)이 발송되었습니다.' : '');
            }
            alert('✅ 개별분석이 저장되었습니다!' + alimTalkNotice);

            // 앱 데이터 업데이트
            currentManageApp = updatedApp;

            // 탭 새로고침
            loadModalTab('analysis');
        } else {
            alert('❌ 저장에 실패했습니다.');
        }
    } catch (error) {
        console.error('Save analysis error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// ===== 예약 발송: 헬퍼 + UI =====

// timestamptz/ISO 문자열을 KST 가독 포맷으로 변환
function formatScheduledAtKst(value) {
    if (!value) return '-';
    const d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

// 예약 발송 모달 열기 (최초 저장 시 사용)
function openScheduleModal() {
    // 폼 유효성 사전 체크 — 사용자가 필수 항목을 비운 채로 예약 누르는 것 방지
    const form = document.getElementById('modalAnalysisForm');
    if (!form) return;
    if (!form.reportValidity()) return;

    showScheduleModal({
        title: '🕐 예약 발송 시각 설정',
        subtitle: '입력하신 분석 내용은 아래 시각에 학생에게 공개되며 알림톡이 발송됩니다.',
        defaultIso: defaultScheduleIso(),
        confirmLabel: '예약 저장',
        onConfirm: (iso) => {
            // 폼 submit 으로 트리거 (saveModalAnalysis가 실행됨)
            window._scheduledMode = 'scheduled';
            window._scheduledAtIso = iso;
            form.requestSubmit();
        }
    });
}

// 예약 시각 변경 모달 (예약 대기 중인 항목)
function openChangeScheduleModal() {
    if (!currentManageApp || !currentManageApp.analysis_alimtalk_scheduled_at) return;
    showScheduleModal({
        title: '📅 예약 시각 변경',
        subtitle: `현재 예약: ${formatScheduledAtKst(currentManageApp.analysis_alimtalk_scheduled_at)}`,
        defaultIso: currentManageApp.analysis_alimtalk_scheduled_at,
        confirmLabel: '변경 저장',
        onConfirm: async (iso) => {
            try {
                const updated = await supabaseAPI.patch('applications', currentManageApp.id, {
                    analysis_alimtalk_scheduled_at: iso
                });
                if (!updated) { alert('❌ 변경에 실패했습니다.'); return; }
                currentManageApp = updated;
                alert(`✅ 예약 시각이 변경되었습니다.\n\n🕐 ${formatScheduledAtKst(iso)}`);
                closeScheduleModal();
                loadModalTab('analysis');
            } catch (e) {
                console.error('Change schedule error:', e);
                alert('❌ 변경 중 오류가 발생했습니다.\n\n' + (e.message || ''));
            }
        }
    });
}

// 예약 취소
async function cancelScheduledRelease() {
    if (!currentManageApp || !currentManageApp.analysis_alimtalk_scheduled_at) return;
    if (!confirm('예약 발송을 취소하시겠습니까?\n\n작성하신 수정본은 그대로 보존되며,\n다시 [즉시 발송] 또는 [예약 발송]을 선택하실 수 있습니다.\n\n학생에게는 아무런 영향이 없습니다.')) return;

    try {
        // 예약 시각만 해제한다. 수정본(pending 컬럼)은 절대 지우지 않는다.
        // (정식 컬럼은 비어있는 상태이므로 학생에게는 여전히 공개되지 않는다.)
        const updated = await supabaseAPI.patch('applications', currentManageApp.id, {
            analysis_alimtalk_scheduled_at: null
        });
        if (!updated) { alert('❌ 취소에 실패했습니다.'); return; }
        currentManageApp = updated;
        alert('✅ 예약이 취소되었습니다.\n\n작성하신 수정본은 폼에 그대로 보존되어 있으니,\n다시 [즉시 발송] 또는 [예약 발송]을 선택해주세요.');
        loadModalTab('analysis');
    } catch (e) {
        console.error('Cancel schedule error:', e);
        alert('❌ 취소 중 오류가 발생했습니다.\n\n' + (e.message || ''));
    }
}

// 기본 예약 시각: 다음 정시 (예: 14:23 → 15:00). 30분 이내면 다다음 정시.
function defaultScheduleIso() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + ((new Date().getMinutes() < 30) ? 1 : 2));
    return d.toISOString();
}

// ISO → datetime-local 입력값 형식 (YYYY-MM-DDTHH:mm, KST 기준)
function isoToDatetimeLocalKst(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    // KST 기준 컴포넌트 추출
    const kst = new Date(d.getTime() + (9 * 60 - d.getTimezoneOffset()) * 60 * 1000);
    const yy = kst.getUTCFullYear();
    const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(kst.getUTCDate()).padStart(2, '0');
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mi = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${yy}-${mm}-${dd}T${hh}:${mi}`;
}

// datetime-local 값 (KST 기준 wall time) → ISO 문자열
function datetimeLocalKstToIso(localStr) {
    if (!localStr) return null;
    // localStr 예: "2026-04-30T14:00" (KST 의도)
    // KST = UTC+9 이므로 9시간 빼서 UTC로 만든 다음 ISO
    const [datePart, timePart] = localStr.split('T');
    const [y, m, dd] = datePart.split('-').map(Number);
    const [hh, mi] = timePart.split(':').map(Number);
    const utcMs = Date.UTC(y, m - 1, dd, hh - 9, mi, 0, 0);
    return new Date(utcMs).toISOString();
}

// 예약 시각 선택 모달 (공통)
function showScheduleModal({ title, subtitle, defaultIso, confirmLabel, onConfirm }) {
    closeScheduleModal(); // 기존 인스턴스 제거

    const overlay = document.createElement('div');
    overlay.id = 'scheduleModalOverlay';
    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px;';

    const minLocal = isoToDatetimeLocalKst(new Date(Date.now() + 60 * 1000).toISOString()); // 최소: 1분 후
    const defaultLocal = isoToDatetimeLocalKst(defaultIso);

    overlay.innerHTML = `
        <div style="background: white; border-radius: 16px; padding: 28px; max-width: 460px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.3);">
            <div style="font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">${title}</div>
            <div style="font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 20px;">${subtitle}</div>
            <label style="display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 8px;">발송 시각 (KST)</label>
            <input type="datetime-local" id="scheduleAtInput"
                   value="${defaultLocal}"
                   min="${minLocal}"
                   style="width: 100%; padding: 12px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 15px; font-family: inherit;">
            <div style="font-size: 12px; color: #94a3b8; margin-top: 8px; line-height: 1.6;">
                ⓘ 매분 단위로 cron이 체크하므로 실제 발송은 지정 시각의 ±1분 이내에 처리됩니다.<br>
                ⓘ 한국 표준시(KST) 기준입니다.
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px;">
                <button type="button" class="btn-secondary" onclick="closeScheduleModal()">취소</button>
                <button type="button" id="scheduleConfirmBtn"
                        style="padding: 10px 20px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
                    <i class="fas fa-check"></i> ${confirmLabel}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // 외부 영역 클릭 시 닫기
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeScheduleModal();
    });

    document.getElementById('scheduleConfirmBtn').addEventListener('click', () => {
        const input = document.getElementById('scheduleAtInput');
        const localStr = input.value;
        if (!localStr) {
            alert('발송 시각을 선택해주세요.');
            return;
        }
        const iso = datetimeLocalKstToIso(localStr);
        if (!iso) { alert('유효한 시각을 선택해주세요.'); return; }
        // 과거 시각 방지
        if (new Date(iso).getTime() <= Date.now()) {
            alert('현재 이후의 시각을 선택해주세요.');
            return;
        }
        // 모달은 onConfirm 안에서 닫는 게 자연스러움(에러 시 유지). 여기선 일단 닫기.
        closeScheduleModal();
        onConfirm(iso);
    });
}

function closeScheduleModal() {
    const el = document.getElementById('scheduleModalOverlay');
    if (el) el.remove();
}

// 미리보기 함수
function previewAnalysis(appId) {
    if (!appId) {
        alert('⚠️ 애플리케이션 ID를 찾을 수 없습니다.');
        return;
    }
    
    console.log('Opening preview for application:', appId);
    
    // 현재 페이지의 base URL을 기준으로 상대 경로 생성
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
    const previewUrl = `${baseUrl}/analysis.html?id=${appId}`;
    
    console.log('Preview URL:', previewUrl);
    
    window.open(previewUrl, '_blank');
}

// 수정하기 함수 (폼을 수정 가능하게)
function editAnalysis() {
    // 모든 input, select, textarea를 활성화
    const form = document.getElementById('modalAnalysisForm');
    if (form) {
        // 일반 input, select, textarea 활성화
        const inputs = form.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), select, textarea');
        inputs.forEach(input => {
            input.removeAttribute('readonly');
            input.removeAttribute('disabled');
        });
        
        // 라디오 버튼 활성화
        const radios = form.querySelectorAll('input[type="radio"]');
        radios.forEach(radio => {
            radio.removeAttribute('disabled');
        });

        // 학습방식/프로그램 세그먼트 / 추가옵션 토글 컨테이너 클릭 차단 해제 (커스텀 컨트롤)
        ['modeSegmentWrap', 'regularProgramType', 'optionToggles'].forEach(id => {
            const c = document.getElementById(id);
            if (c) {
                c.style.pointerEvents = 'auto';
                c.style.opacity = '1';
            }
        });

        // 프로모션 유도 학생 토글 활성화 (체크박스는 위 selector에서 제외돼 있어 별도 처리)
        //  - disabled 해제 + 박스의 클릭 차단(pointer-events) 해제
        //  - 수정 모드에서도 토글 색/노브가 즉시 반영되도록 change 핸들러를 연결
        const incentiveToggle = document.getElementById('incentiveToggle');
        if (incentiveToggle) {
            incentiveToggle.removeAttribute('disabled');
            const incentiveBox = incentiveToggle.closest('.form-group');
            if (incentiveBox) {
                incentiveBox.style.pointerEvents = 'auto';
                incentiveBox.style.opacity = '1';
            }
            if (!incentiveToggle.dataset.editBound) {
                incentiveToggle.dataset.editBound = '1';
                incentiveToggle.addEventListener('change', function() {
                    const slider = this.parentElement.querySelectorAll('span');
                    if (this.checked) {
                        slider[0].style.background = '#f59e0b';
                        slider[1].style.left = '25px';
                        // 프로모션 ON → 입문서도 자동 ON
                        const bookAccessToggle = document.getElementById('bookAccessToggle');
                        if (bookAccessToggle && !bookAccessToggle.checked) {
                            bookAccessToggle.checked = true;
                            bookAccessToggle.dispatchEvent(new Event('change'));
                        }
                    } else {
                        slider[0].style.background = '#cbd5e1';
                        slider[1].style.left = '3px';
                    }
                });
            }
        }

        // 결과 선택 컨테이너 활성화
        const statusContainer = document.getElementById('statusOptionsContainer');
        if (statusContainer) {
            statusContainer.style.pointerEvents = 'auto';
            statusContainer.style.opacity = '1';
            
            // label에 cursor: pointer 추가
            const labels = statusContainer.querySelectorAll('label');
            labels.forEach(label => {
                label.style.cursor = 'pointer';
            });
            
            // 결과 선택 옵션에 클릭 이벤트 추가
            document.querySelectorAll('.status-option').forEach(option => {
                option.addEventListener('click', function(e) {
                    const value = this.getAttribute('data-value');
                    selectStatus(value, e);
                });
            });
        }
        
        // 저장 버튼 활성화
        const saveBtn = document.getElementById('saveAnalysisBtn');
        if (saveBtn) {
            saveBtn.removeAttribute('disabled');
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
        }
        
        // 예약 저장 버튼 활성화
        const scheduleBtn = document.getElementById('scheduleAnalysisBtn');
        if (scheduleBtn) {
            scheduleBtn.removeAttribute('disabled');
            scheduleBtn.style.opacity = '1';
            scheduleBtn.style.cursor = 'pointer';
        }
        
        // 조용히수정 버튼 활성화
        const silentBtn = document.getElementById('silentSaveBtn');
        if (silentBtn) {
            silentBtn.removeAttribute('disabled');
            silentBtn.style.opacity = '1';
            silentBtn.style.cursor = 'pointer';
        }
        
        // 수정하기 버튼 숨기기
        const editBtn = document.getElementById('editAnalysisBtn');
        if (editBtn) {
            editBtn.style.display = 'none';
        }

        // 현재 저장된 상태가 '거부'·'조건부승인'이면 프로그램/일정/가격 섹션은 비활성화 유지
        const currentStatus = document.querySelector('#statusOptionsContainer input[type="radio"]:checked')?.value;
        if (currentStatus === '거부' || currentStatus === '조건부승인') {
            setRejectionUIState(true);
        }

        alert('💡 수정 모드로 전환되었습니다. 내용을 수정한 후 저장 버튼을 눌러주세요.');
    }
}

// ===== 계약 & 입금 탭 =====
async function loadModalContractTab(app) {
    const container = document.getElementById('modalTabContract');
    
    // 사이트 설정 불러오기
    const settings = await getSiteSettings();
    const accountInfo = settings 
        ? `${settings.bank_name} ${settings.account_number} (${settings.account_holder})`
        : '국민은행 123-456-789012 (김민서)';
    
    let html = '';
    
    // 학생이 개별분석에 동의하지 않았으면
    if (!app.student_agreed_at) {
        html = `
            <div class="alert alert-info">
                <i class="fas fa-info-circle" style="font-size: 24px; margin-right: 12px;"></i>
                <div>
                    <div style="font-weight: 700; font-size: 16px;">학생 동의 대기 중</div>
                    <div style="font-size: 14px; margin-top: 4px;">
                        학생이 개별분석에 동의한 후 계약서를 발송할 수 있습니다.
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = html;
        return;
    }
    
    // 계약서 발송 섹션
    if (!app.contract_sent) {
        // 계약서 미발송 - 드롭다운 선택
        const contracts = await loadActiveContractsForDropdown();
        
        html += `
            <div class="alert alert-warning">
                <div style="margin-bottom: 10px;">
                    <div style="font-weight: 700; font-size: 18px;">📋 계약서 선택 및 발송</div>
                    <div style="font-size: 14px; margin-top: 4px;">
                        학생이 ${new Date(app.student_agreed_at).toLocaleString('ko-KR')}에 개별분석에 동의했습니다.
                    </div>
                </div>
                
                <div style="background: white; padding: 20px; border-radius: 12px;">
                    <label style="font-size: 14px; font-weight: 600; color: #1e293b; display: block; margin-bottom: 8px;">
                        발송할 계약서 선택
                    </label>
                    <select id="contractSelectDropdown" style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; margin-bottom: 12px;">
                        <option value="">계약서를 선택하세요...</option>
                        ${contracts.map(c => {
                            const typeLabel = c.contract_type === 'correction' ? '첨삭포함' : '내벨업챌린지';
                            const recommendType = app.correction_enabled ? 'correction' : 'nevelup';
                            const isRecommend = (c.contract_type || 'nevelup') === recommendType;
                            return `<option value="${c.id}" ${isRecommend ? 'selected' : ''}>${c.version} [${typeLabel}] - ${escapeHtml(c.title)}${isRecommend ? ' ✓ 추천' : ''}</option>`;
                        }).join('')}
                    </select>
                    
                    <div style="display: flex; gap: 12px;">
                        <button onclick="previewSelectedContract()" class="btn-secondary" style="flex: 1; white-space: nowrap;">
                            <i class="fas fa-eye"></i> 미리보기
                        </button>
                        <button onclick="sendContractFromModal('${app.id}')" class="btn-primary" style="flex: 1; white-space: nowrap;">
                            <i class="fas fa-paper-plane"></i> 발송하기
                        </button>
                    </div>
                </div>
                
                <div style="font-size: 12px; color: #78350f; text-align: center; margin-top: 12px;">
                    💡 발송하면 학생에게 계약서 탭이 활성화되고 24시간 내 동의를 받게 됩니다.
                </div>
            </div>
        `;
    } else {
        // 계약서 발송 완료
        const contractInfo = app.contract_version ? 
            `${app.contract_version} - ${app.contract_title}` : 
            '계약서';
        
        html += `
            <div class="alert alert-success">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 18px;">✅ 계약서 발송 완료</div>
                        <div style="font-size: 14px; margin-top: 4px;">
                            발송 계약서: <strong>${contractInfo}</strong>
                        </div>
                        <div style="font-size: 13px; color: #166534; margin-top: 4px;">
                            ${new Date(app.contract_sent_at).toLocaleString('ko-KR')}에 발송
                        </div>
                    </div>
                </div>
                
                ${app.contract_agreed ? `
                    <div style="background: white; padding: 16px; border-radius: 8px; margin-top: 16px; border-left: 4px solid #22c55e;">
                        <div style="font-weight: 600; color: #166534;">
                            <i class="fas fa-check-double"></i> 학생이 ${new Date(app.contract_agreed_at).toLocaleString('ko-KR')}에 계약에 동의했습니다.
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-top: 12px;">
                        <button onclick="previewSentContract('${app.id}')" class="btn-outline" style="flex: 1; font-size: 13px;">
                            <i class="fas fa-eye"></i> 미리보기
                        </button>
                        <button onclick="changeContractAfterAgreed('${app.id}')" class="btn-outline" 
                                style="flex: 1; font-size: 13px; border-color: #ef4444; color: #ef4444;">
                            <i class="fas fa-lock"></i> 계약서 변경
                        </button>
                    </div>
                ` : `
                    <div style="background: white; padding: 16px; border-radius: 8px; margin-top: 16px; border-left: 4px solid #f59e0b;">
                        <div style="font-weight: 600; color: #92400e;">
                            <i class="fas fa-clock"></i> 학생의 계약 동의를 기다리는 중입니다.
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-top: 12px;">
                        <button onclick="previewSentContract('${app.id}')" class="btn-outline" style="flex: 1; font-size: 13px;">
                            <i class="fas fa-eye"></i> 미리보기
                        </button>
                        <button onclick="changeContractBeforeAgreed('${app.id}')" class="btn-secondary" style="flex: 1; font-size: 13px;">
                            <i class="fas fa-exchange-alt"></i> 다른 계약서로 변경
                        </button>
                    </div>

                    <!-- 계약서 기한 유예 관리 -->
                    ${(() => {
                        const contractDeadlineInfo = getContractDeadlineInfo(app);
                        return `
                    <div style="background: white; padding: 20px; border-radius: 12px; margin-top: 16px; border: 1px solid ${app.contract_deadline_override ? '#7c3aed' : '#e2e8f0'};">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                            <h4 style="font-size: 15px; font-weight: 600; margin: 0;">
                                <i class="fas fa-calendar-plus" style="color: #7c3aed; margin-right: 6px;"></i>계약서 기한 유예
                            </h4>
                            <span style="font-size: 12px; padding: 4px 10px; border-radius: 12px; font-weight: 600;
                                ${app.contract_deadline_override
                                    ? 'background: #ede9fe; color: #7c3aed;'
                                    : 'background: #f1f5f9; color: #64748b;'}">
                                ${app.contract_deadline_override ? '유예 적용 중' : '기본 (24시간)'}
                            </span>
                        </div>
                        <div style="font-size: 13px; color: #64748b; margin-bottom: 12px; line-height: 1.6;">
                            현재 계약서 동의 기한: <strong style="color: #1e293b;">${contractDeadlineInfo.label}</strong><br/>
                            <span style="font-size: 12px;">
                                ${app.contract_deadline_override
                                    ? '관리자가 유예 설정한 기한입니다.'
                                    : '계약서 발송 시각 + 24시간 자동 계산입니다.'}
                            </span>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: flex-end;">
                            <div style="flex: 1;">
                                <label style="display: block; font-size: 12px; color: #64748b; margin-bottom: 4px;">유예 기한 지정 (KST)</label>
                                <input type="datetime-local" id="contractDeadlineInput"
                                       value="${contractDeadlineInfo.inputValue}"
                                       style="width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit;">
                            </div>
                            <button type="button" onclick="saveContractDeadlineOverride('${app.id}')"
                                    style="padding: 10px 16px; background: #7c3aed; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                                <i class="fas fa-save"></i> 저장
                            </button>
                            ${app.contract_deadline_override ? `
                            <button type="button" onclick="clearContractDeadlineOverride('${app.id}')"
                                    style="padding: 10px 16px; background: white; color: #ef4444; border: 1px solid #ef4444; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                                <i class="fas fa-undo"></i> 초기화
                            </button>
                            ` : ''}
                        </div>
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 8px; line-height: 1.6;">
                            💡 학생이 계약서 동의 기한 연장을 요청한 경우, 유예 날짜를 지정하세요.<br/>
                            💡 저장하면 학생에게 기한 연장 안내 알림톡이 발송됩니다.<br/>
                            💡 초기화하면 기본 24시간 로직으로 돌아갑니다.
                        </div>
                    </div>
                        `;
                    })()}
                `}
            </div>
        `;
    }
    
    // 입금 확인 섹션
    if (app.contract_agreed) {
        // 입금 기한 계산 (override 우선, 없으면 contract_agreed_at + 24시간)
        const depositDeadlineInfo = getDepositDeadlineInfo(app);

        if (!app.deposit_confirmed_by_student) {
            html += `
                <div class="alert alert-info" style="margin-top: 24px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <i class="fas fa-clock" style="font-size: 32px;"></i>
                        <div>
                            <div style="font-weight: 700; font-size: 18px;">입금 대기 중</div>
                            <div style="font-size: 14px; margin-top: 4px;">
                                학생이 계약에 동의했습니다. 학생이 입금 완료 알림을 보내면 여기에서 확인하실 수 있습니다.
                            </div>
                        </div>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 12px; margin-top: 16px;">
                        <h4 style="font-size: 15px; font-weight: 600; margin-bottom: 12px;">입금 정보</h4>
                        <table style="width: 100%; font-size: 14px;">
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">계좌번호</td>
                                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${accountInfo}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">입금 금액</td>
                                <td style="padding: 8px 0; text-align: right; font-weight: 700; font-size: 18px; color: #9480c5;">${(app.final_price || 0).toLocaleString()}원</td>
                            </tr>
                        </table>
                    </div>

                    <!-- 입금 기한 관리 -->
                    <div style="background: white; padding: 20px; border-radius: 12px; margin-top: 16px; border: 1px solid ${app.deposit_deadline_override ? '#7c3aed' : '#e2e8f0'};">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                            <h4 style="font-size: 15px; font-weight: 600; margin: 0;">
                                <i class="fas fa-calendar-check" style="color: #7c3aed; margin-right: 6px;"></i>입금 기한 관리
                            </h4>
                            <span style="font-size: 12px; padding: 4px 10px; border-radius: 12px; font-weight: 600;
                                ${app.deposit_deadline_override 
                                    ? 'background: #ede9fe; color: #7c3aed;'
                                    : 'background: #f1f5f9; color: #64748b;'}">
                                ${app.deposit_deadline_override ? '관리자 지정' : '기본 (24시간)'}
                            </span>
                        </div>
                        <div style="font-size: 13px; color: #64748b; margin-bottom: 12px; line-height: 1.6;">
                            현재 입금 기한: <strong style="color: #1e293b;">${depositDeadlineInfo.label}</strong><br/>
                            <span style="font-size: 12px;">
                                ${app.deposit_deadline_override 
                                    ? '관리자가 직접 지정한 기한입니다.' 
                                    : '계약 동의 시각 + 24시간 자동 계산입니다.'}
                            </span>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: flex-end;">
                            <div style="flex: 1;">
                                <label style="display: block; font-size: 12px; color: #64748b; margin-bottom: 4px;">입금 기한 지정 (KST)</label>
                                <input type="datetime-local" id="depositDeadlineInput"
                                       value="${depositDeadlineInfo.inputValue}"
                                       style="width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; font-family: inherit;">
                            </div>
                            <button type="button" onclick="saveDepositDeadlineOverride('${app.id}')"
                                    style="padding: 10px 16px; background: #7c3aed; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                                <i class="fas fa-save"></i> 저장
                            </button>
                            ${app.deposit_deadline_override ? `
                            <button type="button" onclick="clearDepositDeadlineOverride('${app.id}')"
                                    style="padding: 10px 16px; background: white; color: #ef4444; border: 1px solid #ef4444; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                                <i class="fas fa-undo"></i> 초기화
                            </button>
                            ` : ''}
                        </div>
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 8px; line-height: 1.6;">
                            💡 시작일이 먼 학생에게 입금 기한을 넉넉하게 지정할 수 있습니다.<br/>
                            💡 초기화하면 기본 24시간 로직으로 돌아갑니다.
                        </div>
                    </div>
                </div>
            `;
        } else if (!app.deposit_confirmed_by_admin) {
            html += `
                <div class="alert alert-warning" style="margin-top: 24px;">
                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                        <i class="fas fa-bell" style="font-size: 32px;"></i>
                        <div>
                            <div style="font-weight: 700; font-size: 18px;">🔔 입금 확인 요청</div>
                            <div style="font-size: 14px; margin-top: 4px;">
                                ${new Date(app.deposit_confirmed_by_student_at).toLocaleString('ko-KR')}에 학생이 입금 완료를 알렸습니다.
                            </div>
                        </div>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 12px;">
                        <div style="margin-bottom: 16px;">
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">입금자명</label>
                            <input type="text" id="modalDepositorName" value="${app.depositor_name || app.name}" readonly
                                   style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 16px; background: #f8fafc;">
                            <p style="font-size: 12px; color: #64748b; margin: 6px 0 0 0;">
                                💡 학생이 입력한 실제 입금자명입니다.
                            </p>
                        </div>
                        <div style="margin-bottom: 16px;">
                            <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">입금 금액 확인</label>
                            <input type="number" id="modalDepositAmount" value="${app.final_price || 0}" 
                                   style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 16px;">
                        </div>
                        <button onclick="confirmDepositFromModal('${app.id}')" class="btn-primary btn-lg" style="width: 100%;">
                            <i class="fas fa-check-circle"></i> 입금 확인 완료
                        </button>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-success" style="margin-top: 24px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                        <div>
                            <div style="font-weight: 700; font-size: 18px;">✅ 입금 확인 완료</div>
                            <div style="font-size: 14px; margin-top: 4px;">
                                ${new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR')}에 입금을 확인했습니다.
                            </div>
                        </div>
                    </div>
                    <div style="background: white; padding: 16px; border-radius: 8px; margin-top: 16px;">
                        <table style="width: 100%; font-size: 14px;">
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">입금자명</td>
                                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${app.depositor_name || app.name}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">확인 금액</td>
                                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${(app.final_price || 0).toLocaleString()}원</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
        }
    }
    
    container.innerHTML = html;
}

// 활성 계약서 목록 로드 (드롭다운용)
async function loadActiveContractsForDropdown() {
    try {
        const result = await supabaseAPI.query('contracts', { 'is_active': 'eq.true', 'limit': '100' });
        return result || [];
    } catch (error) {
        console.error('Failed to load contracts:', error);
        return [];
    }
}

// 선택한 계약서 미리보기
async function previewSelectedContract() {
    const selectId = document.getElementById('contractSelectDropdown').value;
    if (!selectId) {
        alert('미리볼 계약서를 선택해주세요.');
        return;
    }
    
    try {
        const contract = await supabaseAPI.getById('contracts', selectId);
        
        if (contract) {
            // 샘플 데이터로 미리보기
            const sampleData = getContractSampleData(contract.contract_type);
            const parsedHTML = parseContractTemplate(contract.content, sampleData);
            
            // 모달 표시
            const previewModal = document.createElement('div');
            previewModal.id = 'tempPreviewModal';
            previewModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 99999; overflow-y: auto;';
            previewModal.innerHTML = `
                <div style="max-width: 900px; margin: 40px auto; background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div style="padding: 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="font-size: 20px; font-weight: 700; margin: 0;">
                            <i class="fas fa-eye"></i> ${contract.version} - ${escapeHtml(contract.title)}
                        </h2>
                        <button onclick="this.closest('#tempPreviewModal').remove()" style="background: none; border: none; font-size: 24px; color: #64748b; cursor: pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div style="padding: 40px; max-height: 70vh; overflow-y: auto;">
                        ${getContractStyles()}
                        <div class="contract-content">
                            <div style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border-left: 4px solid #3b82f6;">
                                <p style="font-size: 13px; color: #1e40af; margin: 0;">
                                    <i class="fas fa-info-circle"></i> 샘플 데이터로 미리보기
                                </p>
                            </div>
                            ${parsedHTML}
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(previewModal);
            setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); }, 50);
        }
    } catch (error) {
        console.error('Preview error:', error);
        alert('미리보기에 실패했습니다.');
    }
}

// 발송된 계약서 미리보기
async function previewSentContract(appId) {
    const app = currentManageApp;
    
    if (!app.contract_snapshot) {
        alert('계약서 내용이 없습니다.');
        return;
    }
    
    // 학생 데이터
    const programLabel = app.correction_enabled 
        ? `${app.assigned_program} + 스라첨삭` 
        : app.assigned_program;
    const studentData = {
        name: app.name,
        email: app.email,
        phone: app.phone,
        assigned_program: programLabel,
        schedule_start: app.schedule_start,
        schedule_end: app.schedule_end,
        final_price: (app.final_price || 0).toLocaleString(),
        contract_date: new Date().toLocaleDateString('ko-KR')
    };
    
    const parsedHTML = parseContractTemplate(app.contract_snapshot, studentData);
    
    // 모달 표시
    const previewModal = document.createElement('div');
    previewModal.id = 'tempPreviewModal';
    previewModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 99999; overflow-y: auto;';
    previewModal.innerHTML = `
        <div style="max-width: 900px; margin: 40px auto; background: white; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding: 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="font-size: 20px; font-weight: 700; margin: 0;">
                    <i class="fas fa-eye"></i> ${app.contract_version} - ${escapeHtml(app.contract_title)}
                </h2>
                <button onclick="this.closest('#tempPreviewModal').remove()" style="background: none; border: none; font-size: 24px; color: #64748b; cursor: pointer;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div style="padding: 40px; max-height: 70vh; overflow-y: auto;">
                ${getContractStyles()}
                <div class="contract-content">
                    <div style="margin-bottom: 16px; padding: 12px; background: #dcfce7; border-left: 4px solid #22c55e;">
                        <p style="font-size: 13px; color: #166534; margin: 0;">
                            <i class="fas fa-check-circle"></i> 학생에게 발송된 계약서
                        </p>
                    </div>
                    ${parsedHTML}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(previewModal);
    setTimeout(() => { if (typeof fixContractInputOverflow === 'function') fixContractInputOverflow(); }, 50);
}

// 계약서 변경 (동의 전)
async function changeContractBeforeAgreed(appId) {
    const contracts = await loadActiveContractsForDropdown();
    
    // 변경 모달 생성
    const changeModal = document.createElement('div');
    changeModal.id = 'changeContractModal';
    changeModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 99999; display: flex; align-items: center; justify-content: center;';
    changeModal.innerHTML = `
        <div style="background: white; border-radius: 16px; padding: 32px; max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 8px 0; color: #1e293b;">
                <i class="fas fa-exchange-alt" style="color: #f59e0b;"></i> 계약서 변경
            </h2>
            <p style="font-size: 14px; color: #64748b; margin: 0 0 24px 0;">
                현재: ${currentManageApp.contract_version} - ${currentManageApp.contract_title}
            </p>
            
            <div style="margin-bottom: 24px;">
                <label style="font-size: 14px; font-weight: 600; color: #1e293b; display: block; margin-bottom: 8px;">
                    새 계약서 선택
                </label>
                <select id="newContractSelect" style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
                    <option value="">계약서를 선택하세요...</option>
                    ${contracts.map(c => {
                        const typeLabel = c.contract_type === 'correction' ? '첨삭포함' : '내벨업챌린지';
                        return `<option value="${c.id}" ${c.id === currentManageApp.contract_template_id ? 'selected' : ''}>
                            ${c.version} [${typeLabel}] - ${escapeHtml(c.title)}
                        </option>`;
                    }).join('')}
                </select>
            </div>
            
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; border-radius: 4px; margin-bottom: 24px;">
                <p style="font-size: 13px; color: #92400e; margin: 0; line-height: 1.6;">
                    💡 기존 계약서는 폐기되고 새 계약서로 교체됩니다.<br>
                    학생 화면이 자동으로 갱신됩니다.
                </p>
            </div>
            
            <div style="display: flex; gap: 12px;">
                <button onclick="document.getElementById('changeContractModal').remove()" class="btn-outline" style="flex: 1;">
                    취소
                </button>
                <button onclick="executeContractChange('${appId}', false)" class="btn-primary" style="flex: 1;">
                    <i class="fas fa-check"></i> 변경하기
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(changeModal);
}

// 계약서 변경 (동의 후) ⚠️
async function changeContractAfterAgreed(appId) {
    const contracts = await loadActiveContractsForDropdown();
    
    // 경고 모달 생성
    const changeModal = document.createElement('div');
    changeModal.id = 'changeContractModal';
    changeModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 99999; display: flex; align-items: center; justify-content: center;';
    changeModal.innerHTML = `
        <div style="background: white; border-radius: 16px; padding: 32px; max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 8px 0; color: #dc2626;">
                <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i> 경고: 계약서 재발송
            </h2>
            <p style="font-size: 14px; color: #64748b; margin: 0 0 16px 0;">
                학생이 이미 계약서에 동의한 상태입니다.
            </p>
            
            <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 4px; margin-bottom: 20px;">
                <p style="font-size: 14px; font-weight: 600; color: #991b1b; margin: 0 0 12px 0;">계약서를 변경하면:</p>
                <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #b91c1c; line-height: 1.8;">
                    <li>기존 계약 동의가 <strong>취소</strong>됩니다</li>
                    <li>STEP 4 (입금) → STEP 3 (계약서)로 <strong>롤백</strong></li>
                    <li>학생이 새 계약서에 <strong>다시 동의</strong>해야 함</li>
                </ul>
            </div>
            
            <div style="margin-bottom: 24px;">
                <label style="font-size: 14px; font-weight: 600; color: #1e293b; display: block; margin-bottom: 8px;">
                    새 계약서 선택
                </label>
                <select id="newContractSelect" style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
                    <option value="">계약서를 선택하세요...</option>
                    ${contracts.map(c => `
                        <option value="${c.id}">
                            ${c.version} - ${escapeHtml(c.title)}
                        </option>
                    `).join('')}
                </select>
            </div>
            
            <p style="font-size: 14px; font-weight: 600; color: #1e293b; text-align: center; margin-bottom: 16px;">
                정말 변경하시겠습니까?
            </p>
            
            <div style="display: flex; gap: 12px;">
                <button onclick="document.getElementById('changeContractModal').remove()" class="btn-outline" style="flex: 1;">
                    취소
                </button>
                <button onclick="executeContractChange('${appId}', true)" class="btn-primary" 
                        style="flex: 1; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);">
                    <i class="fas fa-exclamation-triangle"></i> 변경하기
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(changeModal);
}

// 계약서 변경 실행
async function executeContractChange(appId, wasAgreed) {
    const newContractId = document.getElementById('newContractSelect').value;
    
    if (!newContractId) {
        alert('변경할 계약서를 선택해주세요.');
        return;
    }
    
    try {
        // 새 계약서 가져오기
        const contract = await supabaseAPI.getById('contracts', newContractId);
        
        if (!contract) {
            alert('계약서를 찾을 수 없습니다.');
            return;
        }
        
        // 확인 메시지
        let confirmMsg = `${contract.version} - ${contract.title}\n\n이 계약서로 변경하시겠습니까?`;
        if (wasAgreed) {
            confirmMsg += '\n\n⚠️ 기존 동의가 취소되고 STEP이 롤백됩니다!';
        }
        
        if (!confirm(confirmMsg)) {
            return;
        }
        
        // 업데이트 데이터 준비
        const updateData = {
            contract_template_id: contract.id,
            contract_version: contract.version,
            contract_title: contract.title,
            contract_snapshot: contract.content,
            contract_sent_at: Date.now()
        };
        
        // 동의 후 변경이면 동의 취소
        if (wasAgreed) {
            updateData.contract_agreed = false;
            updateData.contract_agreed_at = null;
            // current_step은 자동 계산되므로 설정 안 함
        }
        
        // 업데이트
        const updatedApp = await supabaseAPI.patch('applications', appId, updateData);
        
        if (updatedApp) {
            document.getElementById('changeContractModal').remove();
            
            if (wasAgreed) {
                alert(`✅ 계약서가 변경되었습니다!\n\n버전: ${contract.version}\n\n⚠️ 기존 동의가 취소되었습니다.\n학생이 다시 동의해야 합니다.`);
            } else {
                alert(`✅ 계약서가 변경되었습니다!\n\n버전: ${contract.version}`);
            }
            
            currentManageApp = updatedApp;
            loadModalTab('contract');
        } else {
            alert('❌ 변경에 실패했습니다.');
        }
    } catch (error) {
        console.error('Contract change error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 계약서 발송 (모달에서) - 스냅샷 저장
async function sendContractFromModal(appId) {
    const selectId = document.getElementById('contractSelectDropdown').value;
    
    if (!selectId) {
        alert('발송할 계약서를 선택해주세요.');
        return;
    }
    
    try {
        // 선택한 계약서 가져오기
        const contract = await supabaseAPI.getById('contracts', selectId);
        
        if (!contract) {
            alert('계약서를 찾을 수 없습니다.');
            return;
        }
        
        if (!confirm(`${contract.version} - ${contract.title}\n\n이 계약서를 발송하시겠습니까?\n\n학생에게 계약서가 표시되고 24시간 내에 동의해야 합니다.`)) {
            return;
        }
        
        // 스냅샷 저장
        const updatedApp = await supabaseAPI.patch('applications', appId, {
                contract_sent: true,
                contract_sent_at: Date.now(),
                contract_template_id: contract.id,
                contract_version: contract.version,
                contract_title: contract.title,
                contract_snapshot: contract.content,  // 스냅샷!
                current_step: 3  // STEP 3: 계약서 단계
        });
        
        if (updatedApp) {
            alert(`✅ 계약서가 발송되었습니다!\n\n버전: ${contract.version}\n학생이 24시간 내에 동의해야 합니다.`);
            currentManageApp = updatedApp;
            loadModalTab('contract');
        } else {
            alert('❌ 발송에 실패했습니다.');
        }
    } catch (error) {
        console.error('Send contract error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 입금 확인 (모달에서)
async function confirmDepositFromModal(appId) {
    const amount = document.getElementById('modalDepositAmount').value;
    if (!confirm(`${parseInt(amount).toLocaleString()}원 입금을 확인하시겠습니까?`)) {
        return;
    }
    
    try {
        const updatedApp = await supabaseAPI.patch('applications', appId, {
                deposit_confirmed_by_admin: true,
                deposit_confirmed_by_admin_at: Date.now(),
                current_step: 5
        });
        
        if (updatedApp) {
            // 알림톡: 입금 확인 완료
            try {
                await sendKakaoAlimTalk('payment_confirmed', {
                    name: updatedApp.name || currentManageApp.name,
                    phone: updatedApp.phone || currentManageApp.phone,
                    app_id: updatedApp.id || currentManageApp.id
                });
            } catch (e) { console.warn('알림톡 발송 실패:', e); }

            alert('✅ 입금이 확인되었습니다!');
            currentManageApp = updatedApp;
            loadModalTab('contract');
        } else {
            alert('❌ 입금 확인에 실패했습니다.');
        }
    } catch (error) {
        console.error('Confirm deposit error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// ===== 이용방법 & 택배 탭 =====
function loadModalUsageTab(app) {
    const container = document.getElementById('modalTabUsage');
    
    let html = '';
    
    // 입금이 확인되지 않았으면 (잠금 상태 — 회색 면)
    if (!app.deposit_confirmed_by_admin) {
        html = `
            <div style="background: #ffffff; border-radius: 16px; padding: 24px; display: flex; align-items: center; gap: 14px;">
                <div style="width: 44px; height: 44px; border-radius: 12px; background: #eef1f5; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-lock" style="font-size: 16px; color: #64748b;"></i>
                </div>
                <div>
                    <div style="font-weight: 600; font-size: 15px; color: #1e293b; letter-spacing: -0.01em;">입금 확인 대기 중</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.6;">
                        입금이 확인된 후 이용방법을 전달할 수 있습니다.
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = html;
        return;
    }

    // 이용방법 전달 섹션
    if (!app.guide_sent) {
        // 할 일이 남은 상태 — 연한 주황 면
        html += `
            <div style="background: #fdf8ef; border-radius: 16px; padding: 24px;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #fbecd2; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fas fa-rocket" style="font-size: 16px; color: #b45309;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 17px; color: #1e293b; letter-spacing: -0.01em;">이용방법 전달</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 3px;">
                            입금이 확인되었습니다. 이제 학생에게 이용방법을 전달하세요.
                        </div>
                    </div>
                </div>

                <button onclick="sendUsageGuideFromModal('${app.id}')"
                        style="width: 100%; margin-top: 20px; padding: 14px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%);
                               color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: 600;
                               cursor: pointer; font-family: inherit; transition: 0.15s;
                               box-shadow: 0 4px 16px rgba(25, 28, 29, 0.06);"
                        onmouseover="this.style.transform='translateY(-1px)';"
                        onmouseout="this.style.transform='none';">
                    <i class="fas fa-paper-plane" style="margin-right: 7px; font-size: 13px;"></i>
                    이용방법 전달하기
                </button>
                <div style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 12px;">
                    💡 클릭하면 자동으로 STEP 9 (이용방법전달)로 진행됩니다.
                </div>
            </div>
        `;
    } else {
        // 완료 상태 — 연한 초록 면
        html += `
            <div style="background: #f2f8f4; border-radius: 16px; padding: 24px; display: flex; align-items: center; gap: 14px;">
                <div style="width: 44px; height: 44px; border-radius: 12px; background: #dcf0e3; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-check" style="font-size: 17px; color: #2f855a;"></i>
                </div>
                <div>
                    <div style="font-weight: 700; font-size: 17px; color: #1e293b; letter-spacing: -0.01em;">이용방법 전달 완료</div>
                    <div style="font-size: 13px; color: #64748b; margin-top: 3px;">
                        ${new Date(app.guide_sent_at).toLocaleString('ko-KR')}
                    </div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

// 이용방법 전달 (모달에서)
async function sendUsageGuideFromModal(appId) {
    if (!confirm('이용방법을 전달하시겠습니까?\n\n학생의 "이용방법" 탭이 활성화됩니다.')) {
        return;
    }
    
    try {
        const updatedApp = await supabaseAPI.patch('applications', appId, {
                guide_sent: true,
                guide_sent_at: Date.now()
                // current_step은 5에서 유지
        });
        
        if (updatedApp) {
            // 알림톡: 이용방법 안내
            try {
                await sendKakaoAlimTalk('guide_uploaded', {
                    name: updatedApp.name || currentManageApp.name,
                    phone: updatedApp.phone || currentManageApp.phone,
                    program: updatedApp.assigned_program || currentManageApp.assigned_program || '',
                    start_date: updatedApp.schedule_start || currentManageApp.schedule_start || '',
                    app_id: updatedApp.id || currentManageApp.id
                });
            } catch (e) { console.warn('알림톡 발송 실패:', e); }

            alert('✅ 이용방법이 전달되었습니다!');
            currentManageApp = updatedApp;
            loadModalTab('usage');
        } else {
            alert('❌ 전달에 실패했습니다.');
        }
    } catch (error) {
        console.error('Send usage guide error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 택배 발송 완료 (모달에서)
async function markShippingCompletedFromModal(appId) {
    const trackingNumber = document.getElementById('modalTrackingNumber').value;
    
    if (!confirm('택배 발송을 완료 처리하시겠습니까?')) {
        return;
    }
    
    try {
        const updateData = {
            shipping_completed: true,
            shipping_completed_at: Date.now(),
            shipping_courier: 'CJ대한통운'
        };
        
        if (trackingNumber) {
            updateData.shipping_tracking_number = trackingNumber.trim();
        }
        
        const app = await supabaseAPI.patch('applications', appId, updateData);
        
        if (app) {
            // 알림 생성
            await createNotification({
                application_id: appId,
                user_email: app.email,
                type: 'shipping_completed',
                icon: 'fa-shipping-fast',
                message: `실물 교재가 발송되었습니다.${trackingNumber ? ` (운송장: ${trackingNumber})` : ''}`
            });
            
            // 알림톡: 택배 발송 안내
            try {
                await sendKakaoAlimTalk('shipping_sent', {
                    name: app.name || currentManageApp.name,
                    phone: app.phone || currentManageApp.phone,
                    courier: 'CJ대한통운',
                    tracking_number: trackingNumber?.trim() || app.shipping_tracking_number || currentManageApp.shipping_tracking_number || '',
                    app_id: app.id || currentManageApp.id
                });
            } catch (e) { console.warn('알림톡 발송 실패:', e); }

            alert('✅ 택배 발송이 완료 처리되었습니다!');
            currentManageApp = app;
            loadModalTab('shipping'); // usage -> shipping으로 변경
        } else {
            alert('❌ 처리에 실패했습니다.');
        }
    } catch (error) {
        console.error('Mark shipping completed error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 택배 발송 생략 처리 (해외 거주 등으로 실물 수령이 불가한 경우)
// - 알림톡을 보내지 않는다. 운송장이 없으므로 안내할 내용이 없다.
async function markShippingWaivedFromModal(appId) {
    const reason = document.getElementById('modalWaiveReason')?.value?.trim() || '';

    if (!confirm('택배 발송을 생략 처리하시겠습니까?\n\n실물 택배를 발송하지 않고 이 단계를 완료 처리합니다.\n학생에게 알림톡은 발송되지 않습니다.')) {
        return;
    }

    try {
        const app = await supabaseAPI.patch('applications', appId, {
            shipping_waived: true,
            shipping_waived_at: Date.now(),
            shipping_waived_reason: reason || null
        });

        if (app) {
            alert('✅ 택배 발송이 생략 처리되었습니다.');
            currentManageApp = app;
            loadModalTab('shipping');
        } else {
            alert('❌ 처리에 실패했습니다.');
        }
    } catch (error) {
        console.error('Mark shipping waived error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 택배 발송 생략 취소 (실제로 발송하기로 바뀐 경우)
async function undoShippingWaivedFromModal(appId) {
    if (!confirm('생략 처리를 취소하시겠습니까?\n\n다시 택배 발송 대기 상태로 돌아갑니다.')) {
        return;
    }

    try {
        const app = await supabaseAPI.patch('applications', appId, {
            shipping_waived: false,
            shipping_waived_at: null,
            shipping_waived_reason: null
        });

        if (app) {
            alert('✅ 생략 처리가 취소되었습니다.');
            currentManageApp = app;
            loadModalTab('shipping');
        } else {
            alert('❌ 처리에 실패했습니다.');
        }
    } catch (error) {
        console.error('Undo shipping waived error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// ===== 택배발송 탭 =====
function loadModalShippingTab(app) {
    const container = document.getElementById('modalTabShipping');

    let html = '';

    // 이용방법이 전달되지 않았으면
    if (!app.guide_sent) {
        html = `
            <div style="background: #ffffff; border-radius: 16px; padding: 24px; display: flex; align-items: center; gap: 14px;">
                <div style="width: 44px; height: 44px; border-radius: 12px; background: #eef1f5; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-lock" style="font-size: 16px; color: #64748b;"></i>
                </div>
                <div>
                    <div style="font-weight: 600; font-size: 15px; color: #1e293b; letter-spacing: -0.01em;">이용방법 전달 대기 중</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.6;">
                        이용방법을 먼저 전달해야 택배를 발송할 수 있습니다.
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = html;
        return;
    }
    
    // 발송 생략 처리되었으면
    if (app.shipping_waived) {
        // 테두리 없이 톤으로 구역을 나눈다 (DESIGN.md: No-Line Rule, Tonal Layering)
        html = `
            <div style="background: #f2f8f4; border-radius: 16px; padding: 24px;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #dcf0e3; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fas fa-box-open" style="font-size: 18px; color: #2f855a;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 17px; color: #1e293b; letter-spacing: -0.01em;">택배 발송 생략</div>
                        <div style="font-size: 13px; color: #64748b; margin-top: 3px;">
                            ${new Date(app.shipping_waived_at).toLocaleString('ko-KR')}
                        </div>
                    </div>
                </div>

                <div style="background: #ffffff; padding: 16px 18px; border-radius: 12px; margin-top: 20px;">
                    <div style="font-size: 12px; color: #94a3b8; font-weight: 500; margin-bottom: 6px;">생략 사유</div>
                    <div style="font-size: 15px; color: ${app.shipping_waived_reason ? '#1e293b' : '#94a3b8'};">
                        ${app.shipping_waived_reason || '기록된 사유 없음'}
                    </div>
                </div>

                <div style="font-size: 12px; color: #94a3b8; margin-top: 18px; line-height: 1.7;">
                    실물 택배를 발송하지 않았으며, 알림톡도 발송되지 않았습니다.<br>
                    송장 출력·운송장 일괄등록 대상에서도 제외됩니다.
                </div>
            </div>

            <button onclick="undoShippingWaivedFromModal('${app.id}')"
                    style="display: block; margin: 18px auto 0; padding: 10px 16px; background: transparent; color: #64748b;
                           border: none; border-radius: 8px; font-size: 13px; font-weight: 500;
                           cursor: pointer; font-family: inherit; transition: 0.15s;"
                    onmouseover="this.style.background='#f1f5f9'; this.style.color='#475569';"
                    onmouseout="this.style.background='transparent'; this.style.color='#64748b';">
                <i class="fas fa-undo" style="margin-right: 6px; font-size: 11px;"></i>
                생략 처리 취소하고 발송 대기로 되돌리기
            </button>
        `;
        container.innerHTML = html;
        return;
    }

    // 이미 발송 완료되었으면
    if (app.shipping_completed) {
        html = `
            <div style="background: #f2f8f4; border-radius: 16px; padding: 24px;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #dcf0e3; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fas fa-check" style="font-size: 17px; color: #2f855a;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 700; font-size: 17px; color: #1e293b; letter-spacing: -0.01em;">택배 발송 완료</div>
                        <div style="font-size: 13px; color: #64748b; margin-top: 3px;">
                            ${new Date(app.shipping_completed_at).toLocaleString('ko-KR')}
                        </div>
                    </div>
                </div>
                ${app.shipping_tracking_number ? `
                <div style="background: #ffffff; padding: 16px 18px; border-radius: 12px; margin-top: 20px; display: flex; gap: 32px;">
                    <div>
                        <div style="font-size: 12px; color: #94a3b8; font-weight: 500; margin-bottom: 6px;">택배사</div>
                        <div style="font-size: 15px; font-weight: 600; color: #1e293b;">
                            ${app.shipping_courier || 'CJ대한통운'}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 12px; color: #94a3b8; font-weight: 500; margin-bottom: 6px;">운송장 번호</div>
                        <div style="font-size: 15px; font-weight: 600; color: #1e293b; font-family: 'SF Mono', Menlo, monospace; letter-spacing: 0.02em;">
                            ${app.shipping_tracking_number}
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    } else {
        // 발송 대기 중 — 테두리 없이 면 위에 흰 카드를 올려 층을 만든다 (DESIGN.md)
        const infoRow = (label, value) => `
            <div style="display: flex; gap: 16px; padding: 9px 0;">
                <div style="font-size: 13px; color: #94a3b8; width: 76px; flex-shrink: 0;">${label}</div>
                <div style="font-size: 14px; color: #1e293b; font-weight: 500;">${value}</div>
            </div>
        `;

        html = `
            <div style="background: #fdf8ef; padding: 24px; border-radius: 16px; margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 20px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #fbecd2; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="fas fa-shipping-fast" style="font-size: 16px; color: #b45309;"></i>
                    </div>
                    <div>
                        <h3 style="font-size: 17px; font-weight: 700; color: #1e293b; margin: 0; letter-spacing: -0.01em;">택배 발송 관리</h3>
                        <p style="font-size: 12px; color: #64748b; margin: 3px 0 0 0;">
                            교재/자료를 발송하고 운송장 번호를 입력하세요.
                        </p>
                    </div>
                </div>

                <!-- 배송 정보 -->
                <div style="background: #ffffff; padding: 20px; border-radius: 12px; margin-bottom: 14px;">
                    <h4 style="font-size: 12px; font-weight: 600; color: #94a3b8; margin: 0 0 8px 0; letter-spacing: 0.02em;">배송 정보</h4>
                    ${infoRow('수령인', app.name)}
                    ${infoRow('연락처', app.phone)}
                    ${infoRow('배송지', app.address || '<span style="color:#cbd5e1;">주소 미입력</span>')}
                    ${infoRow('프로그램', app.assigned_program || '-')}
                    ${infoRow('시작일', app.schedule_start || '-')}
                </div>

                <!-- 발송 품목 -->
                <div style="background: #ffffff; padding: 20px; border-radius: 12px; margin-bottom: 14px;">
                    <h4 style="font-size: 12px; font-weight: 600; color: #94a3b8; margin: 0 0 8px 0; letter-spacing: 0.02em;">발송 품목</h4>
                    ${infoRow('노트', '빈 노트테이킹 <span style="color:#94a3b8; font-weight:400;">수기 작성용</span>')}
                    ${infoRow('교재', '보카 실물책 <span style="color:#94a3b8; font-weight:400;">어휘 학습</span>')}
                    ${infoRow('필기구', '연필, 연필깎이')}
                </div>

                <!-- 운송장 입력 -->
                <div style="background: #ffffff; padding: 20px; border-radius: 12px;">
                    <h4 style="font-size: 12px; font-weight: 600; color: #94a3b8; margin: 0 0 14px 0; letter-spacing: 0.02em;">운송장 정보</h4>

                    <div style="margin-bottom: 14px;">
                        <label style="display: block; font-size: 13px; color: #64748b; margin-bottom: 6px;">택배사</label>
                        <input type="text"
                               id="modalCourier"
                               value="CJ대한통운"
                               readonly
                               style="width: 100%; box-sizing: border-box; padding: 11px 13px; border: none; border-radius: 8px;
                                      background: #f1f5f9; font-size: 14px; color: #94a3b8; font-family: inherit; outline: none; cursor: default;">
                    </div>

                    <div style="margin-bottom: 18px;">
                        <label style="display: block; font-size: 13px; color: #64748b; margin-bottom: 6px;">
                            운송장 번호 <span style="font-size: 11px; color: #94a3b8;">선택</span>
                        </label>
                        <input type="text"
                               id="modalTrackingNumber"
                               placeholder="예: 123456789012"
                               style="width: 100%; box-sizing: border-box; padding: 11px 13px; border: none; border-radius: 8px;
                                      background: #f1f5f9; font-size: 14px; color: #1e293b; letter-spacing: 0.02em;
                                      font-family: 'SF Mono', Menlo, monospace; outline: none; transition: 0.15s;"
                               onfocus="this.style.boxShadow='0 0 0 2px #9480c5'; this.style.background='#ffffff';"
                               onblur="this.style.boxShadow='none'; this.style.background='#f1f5f9';">
                    </div>

                    <button onclick="markShippingCompletedFromModal('${app.id}')"
                            style="width: 100%; padding: 14px; background: linear-gradient(135deg, #9480c5 0%, #7c68a8 100%);
                                   color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: 600;
                                   cursor: pointer; font-family: inherit; transition: 0.15s;
                                   box-shadow: 0 4px 16px rgba(25, 28, 29, 0.06);"
                            onmouseover="this.style.transform='translateY(-1px)';"
                            onmouseout="this.style.transform='none';">
                        <i class="fas fa-check-circle" style="margin-right: 7px; font-size: 13px;"></i>
                        택배 발송 완료
                    </button>
                </div>
            </div>

            <!-- 발송 생략: 테두리 대신 톤으로 구역을 나눈다 (DESIGN.md: No-Line Rule) -->
            <div style="background: #ffffff; padding: 24px; border-radius: 16px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-box-open" style="font-size: 14px; color: #94a3b8;"></i>
                    <h4 style="font-size: 14px; font-weight: 600; color: #1e293b; margin: 0; letter-spacing: -0.01em;">
                        택배를 발송하지 않는 경우
                    </h4>
                </div>
                <p style="font-size: 12px; color: #64748b; margin: 8px 0 20px 0; line-height: 1.7;">
                    해외 거주 등으로 실물 수령이 어려운 학생은 발송 없이 이 단계를 완료 처리할 수 있습니다.<br>
                    알림톡은 발송되지 않으며, 송장 출력·운송장 일괄등록 대상에서 제외됩니다.
                </p>

                <label style="display: block; font-size: 13px; color: #64748b; margin-bottom: 6px;">
                    생략 사유 <span style="font-size: 11px; color: #94a3b8;">선택 · 관리자만 확인</span>
                </label>
                <input type="text"
                       id="modalWaiveReason"
                       placeholder="예: 해외 거주 / 학생 요청"
                       style="width: 100%; box-sizing: border-box; padding: 11px 13px; border: none; border-radius: 8px;
                              background: #f4f6f9; font-size: 14px; color: #1e293b; font-family: inherit; outline: none; transition: 0.15s;"
                       onfocus="this.style.boxShadow='0 0 0 2px #9480c5'; this.style.background='#ffffff';"
                       onblur="this.style.boxShadow='none'; this.style.background='#f4f6f9';">

                <button onclick="markShippingWaivedFromModal('${app.id}')"
                        style="width: 100%; margin-top: 14px; padding: 12px; background: #ebe6f4; color: #4c1d95;
                               border: none; border-radius: 10px; font-size: 14px; font-weight: 600;
                               cursor: pointer; font-family: inherit; transition: 0.15s;"
                        onmouseover="this.style.background='#e0d8ef';"
                        onmouseout="this.style.background='#ebe6f4';">
                    <i class="fas fa-forward" style="margin-right: 7px; font-size: 12px;"></i>
                    발송 없이 완료 처리
                </button>
            </div>
        `;
    }

    container.innerHTML = html;
}

// 학생 화면 보기
function openStudentView() {
    if (currentManageApp) {
        window.open(`/application-detail.html?id=${currentManageApp.id}`, '_blank');
    }
}

// 알림 생성 함수
async function createNotification(notificationData) {
    try {
        await supabaseAPI.post('notifications', {
            application_id: notificationData.application_id,
            user_email: notificationData.user_email,
            type: notificationData.type,
            icon: notificationData.icon || 'fa-bell',
            message: notificationData.message,
            is_read: false,
            created_at: Date.now()
        });
    } catch (error) {
        console.error('알림 생성 중 오류:', error);
    }
}

// ===== 계약서 기한 유예 관리 (contract_deadline_override) =====

/**
 * 계약서 동의 기한 정보를 계산하여 반환
 * - contract_deadline_override가 있으면 해당 값 사용
 * - 없으면 contract_sent_at + 24시간
 */
function getContractDeadlineInfo(app) {
    let deadlineDate;
    let isOverride = false;

    if (app.contract_deadline_override) {
        deadlineDate = new Date(app.contract_deadline_override);
        isOverride = true;
    } else if (app.contract_sent_at) {
        deadlineDate = new Date(new Date(app.contract_sent_at).getTime() + 24 * 60 * 60 * 1000);
    } else {
        return { label: '-', inputValue: '', deadlineMs: null, isOverride: false };
    }

    const label = deadlineDate.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
    });

    // datetime-local 입력값 (KST)
    const inputValue = isoToDatetimeLocalKst(deadlineDate.toISOString());

    return {
        label,
        inputValue,
        deadlineMs: deadlineDate.getTime(),
        isOverride
    };
}

/**
 * 계약서 기한 유예 저장
 * - DB에 contract_deadline_override 저장
 * - 유예 안내 알림톡 발송 (580221 — 검수 완료 후 연결)
 */
async function saveContractDeadlineOverride(appId) {
    const input = document.getElementById('contractDeadlineInput');
    if (!input || !input.value) {
        alert('유예 기한 날짜를 선택해주세요.');
        return;
    }

    const iso = datetimeLocalKstToIso(input.value);
    if (!iso) {
        alert('유효한 날짜를 선택해주세요.');
        return;
    }

    const kstLabel = new Date(iso).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
    });

    if (!confirm(`계약서 동의 기한을 유예하시겠습니까?\n\n📅 ${kstLabel}\n\n학생에게 보이는 계약서 동의 마감 타이머가 이 시각 기준으로 변경되고,\n기한 연장 안내 알림톡이 발송됩니다.`)) {
        return;
    }

    try {
        const updated = await supabaseAPI.patch('applications', appId, {
            contract_deadline_override: iso,
            contract_deferral_reminder_sent_at: null  // 유예 재설정 시 리마인더 초기화
        });
        if (!updated) {
            alert('❌ 저장에 실패했습니다.');
            return;
        }
        currentManageApp = updated;

        // 유예 안내 알림톡 발송 (50221)
        try {
            await sendKakaoAlimTalk('contract_deferred', {
                name: updated.name || currentManageApp.name,
                phone: updated.phone || currentManageApp.phone,
                app_id: updated.id || currentManageApp.id,
                program: updated.assigned_program || currentManageApp.assigned_program || '',
                deadline: kstLabel
            });
        } catch (e) { console.warn('유예 안내 알림톡 발송 실패:', e); }

        alert(`✅ 계약서 동의 기한이 유예되었습니다.\n\n📅 ${kstLabel}\n\n학생에게 기한 연장 안내 알림톡이 발송되었습니다.`);
        loadModalTab('contract');
    } catch (e) {
        console.error('Save contract deadline override error:', e);
        alert('❌ 오류가 발생했습니다.\n\n' + (e.message || ''));
    }
}

/**
 * 계약서 기한 유예 초기화 (기본 24시간으로 복원)
 */
async function clearContractDeadlineOverride(appId) {
    if (!confirm('계약서 유예를 초기화하시겠습니까?\n\n기본 로직(계약서 발송 후 24시간)으로 돌아갑니다.')) {
        return;
    }

    try {
        const updated = await supabaseAPI.patch('applications', appId, {
            contract_deadline_override: null,
            contract_deferral_reminder_sent_at: null
        });
        if (!updated) {
            alert('❌ 초기화에 실패했습니다.');
            return;
        }
        currentManageApp = updated;
        alert('✅ 계약서 유예가 초기화되었습니다.\n\n기본 24시간 로직이 적용됩니다.');
        loadModalTab('contract');
    } catch (e) {
        console.error('Clear contract deadline override error:', e);
        alert('❌ 오류가 발생했습니다.\n\n' + (e.message || ''));
    }
}

// ===== 입금 기한 관리 (deposit_deadline_override) =====

/**
 * 입금 기한 정보를 계산하여 반환
 * - deposit_deadline_override가 있으면 해당 값 사용
 * - 없으면 contract_agreed_at + 24시간
 */
function getDepositDeadlineInfo(app) {
    let deadlineDate;
    let isOverride = false;

    if (app.deposit_deadline_override) {
        deadlineDate = new Date(app.deposit_deadline_override);
        isOverride = true;
    } else if (app.contract_agreed_at) {
        deadlineDate = new Date(new Date(app.contract_agreed_at).getTime() + 24 * 60 * 60 * 1000);
    } else {
        return { label: '-', inputValue: '', deadlineMs: null, isOverride: false };
    }

    const label = deadlineDate.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
    });

    // datetime-local 입력값 (KST)
    const inputValue = isoToDatetimeLocalKst(deadlineDate.toISOString());

    return {
        label,
        inputValue,
        deadlineMs: deadlineDate.getTime(),
        isOverride
    };
}

/**
 * 입금 기한 override 저장
 */
async function saveDepositDeadlineOverride(appId) {
    const input = document.getElementById('depositDeadlineInput');
    if (!input || !input.value) {
        alert('입금 기한 날짜를 선택해주세요.');
        return;
    }

    const iso = datetimeLocalKstToIso(input.value);
    if (!iso) {
        alert('유효한 날짜를 선택해주세요.');
        return;
    }

    const kstLabel = new Date(iso).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false
    });

    if (!confirm(`입금 기한을 다음으로 지정하시겠습니까?\n\n📅 ${kstLabel}\n\n학생에게 보이는 입금 마감 타이머가 이 시각 기준으로 변경됩니다.`)) {
        return;
    }

    try {
        const updated = await supabaseAPI.patch('applications', appId, {
            deposit_deadline_override: iso
        });
        if (!updated) {
            alert('❌ 저장에 실패했습니다.');
            return;
        }
        currentManageApp = updated;
        alert(`✅ 입금 기한이 지정되었습니다.\n\n📅 ${kstLabel}`);
        loadModalTab('contract');
    } catch (e) {
        console.error('Save deposit deadline override error:', e);
        alert('❌ 오류가 발생했습니다.\n\n' + (e.message || ''));
    }
}

/**
 * 입금 기한 override 초기화 (기본 24시간으로 복원)
 */
async function clearDepositDeadlineOverride(appId) {
    if (!confirm('입금 기한을 초기화하시겠습니까?\n\n기본 로직(계약 동의 후 24시간)으로 돌아갑니다.')) {
        return;
    }

    try {
        const updated = await supabaseAPI.patch('applications', appId, {
            deposit_deadline_override: null
        });
        if (!updated) {
            alert('❌ 초기화에 실패했습니다.');
            return;
        }
        currentManageApp = updated;
        alert('✅ 입금 기한이 초기화되었습니다.\n\n기본 24시간 로직이 적용됩니다.');
        loadModalTab('contract');
    } catch (e) {
        console.error('Clear deposit deadline override error:', e);
        alert('❌ 오류가 발생했습니다.\n\n' + (e.message || ''));
    }
}

// ESC 키로 모달 닫기
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('manageModal');
        if (modal && modal.style.display === 'flex') {
            closeManageModal();
        }
    }
});

// ===== 수강 상태 관리 섹션 =====
function renderAppStatusSection(app) {
    const status = getAppLiveStatus(app);
    if (!status) return ''; // 세팅 미완료면 표시 안 함

    const statuses = [
        { key: 'active', label: '진행중', color: '#7c3aed', bg: '#ede9fe', icon: 'fa-running' },
        { key: 'refunded', label: '환불완료', color: '#ef4444', bg: '#fef2f2', icon: 'fa-undo' },
        { key: 'dropped', label: '중도포기', color: '#94a3b8', bg: '#f1f5f9', icon: 'fa-user-slash' }
    ];

    // 수료/시작대기는 자동 판정이므로 버튼 없이 표시만
    if (status.key === 'completed' || status.key === 'ready') {
        return `
        <div class="info-card" style="margin-top: 24px;">
            <h3 class="info-card-title"><i class="fas fa-flag"></i> 수강 상태</h3>
            <div style="display:flex; align-items:center; gap:10px; padding:16px 0;">
                <span style="display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:20px; font-size:14px; font-weight:600; background:${status.bg}; color:${status.color};">
                    <i class="fas ${status.icon}"></i> ${status.label}
                </span>
                <span style="font-size:12px; color:#94a3b8;">자동 판정</span>
            </div>
        </div>`;
    }

    // 환불 상세 정보 (이미 환불/중도포기 처리된 경우)
    const refundInfo = (status.key === 'refunded' || status.key === 'dropped') ? `
        <div style="margin-top:16px; padding:16px; background:#f8fafc; border-radius:8px; font-size:13px;">
            ${app.refund_reason ? `<div style="margin-bottom:8px;"><span style="color:#64748b;">사유:</span> ${escapeHtml(app.refund_reason)}</div>` : ''}
            ${app.refund_amount ? `<div style="margin-bottom:8px;"><span style="color:#64748b;">환불 금액:</span> ${Number(app.refund_amount).toLocaleString()}원</div>` : ''}
            ${app.refund_at ? `<div><span style="color:#64748b;">처리일:</span> ${new Date(app.refund_at).toLocaleDateString('ko-KR')}</div>` : ''}
        </div>` : '';

    return `
    <div class="info-card" style="margin-top: 24px;">
        <h3 class="info-card-title"><i class="fas fa-flag"></i> 수강 상태</h3>
        <div style="display:flex; gap:10px; padding:16px 0; flex-wrap:wrap;">
            ${statuses.map(s => `
                <button onclick="selectAppStatus('${s.key}')"
                    id="appStatusBtn_${s.key}"
                    style="display:inline-flex; align-items:center; gap:6px; padding:10px 20px; border-radius:20px; font-size:14px; font-weight:600; cursor:pointer; transition:all 0.2s;
                    ${status.key === s.key
                        ? `background:${s.color}; color:white; border:2px solid ${s.color};`
                        : `background:white; color:${s.color}; border:2px solid #e2e8f0;`}">
                    <i class="fas ${s.icon}"></i> ${s.label}
                </button>
            `).join('')}
        </div>

        <!-- 환불/중도포기 입력 폼 (숨김) -->
        <div id="appStatusForm" style="display:none; margin-top:12px; padding:20px; background:#f8fafc; border-radius:10px;">
            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:13px; font-weight:600; color:#475569; margin-bottom:6px;">사유</label>
                <input type="text" id="appStatusReason" placeholder="환불 사유 입력..."
                    style="width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; box-sizing:border-box;">
            </div>
            <div style="margin-bottom:16px;">
                <label style="display:block; font-size:13px; font-weight:600; color:#475569; margin-bottom:6px;">환불 금액</label>
                <input type="number" id="appStatusRefundAmount" placeholder="0"
                    style="width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; box-sizing:border-box;">
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end;">
                <button onclick="cancelAppStatusChange()" style="padding:8px 20px; border:1px solid #d1d5db; background:white; border-radius:8px; cursor:pointer; font-size:13px;">취소</button>
                <button onclick="confirmAppStatusChange()" style="padding:8px 20px; background:#7c3aed; color:white; border:none; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600;">저장</button>
            </div>
        </div>

        ${refundInfo}
    </div>`;
}

let pendingAppStatus = null;

function selectAppStatus(key) {
    const current = getAppLiveStatus(currentManageApp);
    if (current && current.key === key) return; // 이미 같은 상태

    if (key === 'refunded' || key === 'dropped') {
        pendingAppStatus = key;
        document.getElementById('appStatusForm').style.display = 'block';
        document.getElementById('appStatusReason').value = '';
        document.getElementById('appStatusRefundAmount').value = '';
        // 버튼 하이라이트
        highlightAppStatusBtn(key);
    } else if (key === 'active') {
        // 진행중으로 되돌리기
        if (!confirm('수강 상태를 "진행중"으로 되돌리시겠습니까?')) return;
        changeAppStatus('active', '', 0);
    }
}

function highlightAppStatusBtn(activeKey) {
    const statuses = [
        { key: 'active', color: '#7c3aed' },
        { key: 'refunded', color: '#ef4444' },
        { key: 'dropped', color: '#94a3b8' }
    ];
    statuses.forEach(s => {
        const btn = document.getElementById('appStatusBtn_' + s.key);
        if (!btn) return;
        if (s.key === activeKey) {
            btn.style.background = s.color;
            btn.style.color = 'white';
            btn.style.borderColor = s.color;
        } else {
            btn.style.background = 'white';
            btn.style.color = s.color;
            btn.style.borderColor = '#e2e8f0';
        }
    });
}

function cancelAppStatusChange() {
    pendingAppStatus = null;
    document.getElementById('appStatusForm').style.display = 'none';
    // 원래 상태로 버튼 복원
    const current = getAppLiveStatus(currentManageApp);
    if (current) highlightAppStatusBtn(current.key);
}

async function confirmAppStatusChange() {
    if (!pendingAppStatus) return;
    const reason = document.getElementById('appStatusReason').value.trim();
    const amount = parseInt(document.getElementById('appStatusRefundAmount').value) || 0;

    const label = pendingAppStatus === 'refunded' ? '환불완료' : '중도포기';
    if (!confirm(`"${label}" 처리하시겠습니까?`)) return;

    await changeAppStatus(pendingAppStatus, reason, amount);
    pendingAppStatus = null;
}

async function changeAppStatus(status, reason, amount) {
    try {
        const updateData = { app_status: status };
        if (status === 'refunded' || status === 'dropped') {
            updateData.refund_reason = reason || '';
            updateData.refund_amount = amount || 0;
            updateData.refund_at = Date.now();
        } else {
            // 진행중으로 되돌리기
            updateData.refund_reason = null;
            updateData.refund_amount = null;
            updateData.refund_at = null;
        }

        await supabaseAPI.patch('applications', currentManageApp.id, updateData);
        Object.assign(currentManageApp, updateData);
        alert('✅ 수강 상태가 변경되었습니다.');
        loadModalInfoTab(currentManageApp);
    } catch (error) {
        console.error('App status change error:', error);
        alert('❌ 상태 변경에 실패했습니다.');
    }
}
