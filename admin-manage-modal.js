// ==================== 관리자 관리 모달 ====================

let currentManageApp = null;

// 카카오 알림톡 발송 (Edge Function 경유)
async function sendKakaoAlimTalk(type, data) {
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/kakaotalk-notify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ type, data })
        });
        const result = await resp.json();
        if (!result.success) {
            console.warn('알림톡 발송 실패:', result);
        }
        return result;
    } catch (e) {
        console.warn('알림톡 발송 에러:', e);
    }
}

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

// ===== 기본정보 탭 =====
function loadModalInfoTab(app) {
    const container = document.getElementById('modalTabInfo');
    
    // 목표 점수
    let targetDisplay = '';
    if (app.target_cutoff_old) {
        targetDisplay = `${app.target_cutoff_old}점`;
    } else if (app.target_level_reading || app.target_level_listening || app.target_level_speaking || app.target_level_writing) {
        targetDisplay = `Reading ${app.target_level_reading || '-'} / Listening ${app.target_level_listening || '-'} / Speaking ${app.target_level_speaking || '-'} / Writing ${app.target_level_writing || '-'}`;
    }
    
    // 현재 점수
    let currentDisplay = '';
    if (app.score_total_old) {
        currentDisplay = `총점 ${app.score_total_old}점 (R:${app.score_reading_old || 0} / L:${app.score_listening_old || 0} / S:${app.score_speaking_old || 0} / W:${app.score_writing_old || 0})`;
    } else if (app.score_level_reading || app.score_level_listening || app.score_level_speaking || app.score_level_writing) {
        currentDisplay = `R:${app.score_level_reading || '-'} / L:${app.score_level_listening || '-'} / S:${app.score_level_speaking || '-'} / W:${app.score_level_writing || '-'}`;
    }
    
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
            <!-- 기본 정보 -->
            <div class="info-card">
                <h3 class="info-card-title"><i class="fas fa-user"></i> 기본 정보</h3>
                <div class="info-item">
                    <label>이름</label>
                    <div>${app.name}</div>
                </div>
                <div class="info-item">
                    <label>이메일</label>
                    <div>${app.email}</div>
                </div>
                <div class="info-item">
                    <label>전화번호</label>
                    <div>${app.phone}</div>
                </div>
                <div class="info-item">
                    <label>직업</label>
                    <div>${app.occupation || '-'}</div>
                </div>
            </div>
            
            <!-- 점수 정보 -->
            <div class="info-card">
                <h3 class="info-card-title"><i class="fas fa-chart-line"></i> 점수 정보</h3>
                <div class="info-item">
                    <label>현재 점수</label>
                    <div>${currentDisplay || '미제출'}</div>
                </div>
                <div class="info-item">
                    <label>목표 점수</label>
                    <div>${targetDisplay || '미입력'}</div>
                </div>
                <div class="info-item">
                    <label>목표 기한</label>
                    <div>${app.target_deadline ? new Date(app.target_deadline).toLocaleDateString('ko-KR') : '-'}</div>
                </div>
            </div>
            
            <!-- 신청 정보 -->
            <div class="info-card">
                <h3 class="info-card-title"><i class="fas fa-clipboard"></i> 신청 정보</h3>
                <div class="info-item">
                    <label>신청일</label>
                    <div>${new Date(app.submitted_date).toLocaleDateString('ko-KR')}</div>
                </div>
                <div class="info-item">
                    <label>희망 프로그램</label>
                    <div>${app.preferred_program || '-'}</div>
                </div>
                <div class="info-item">
                    <label>희망 시작일</label>
                    <div>${app.preferred_start_date || '-'}</div>
                </div>
                <div class="info-item">
                    <label>현재 단계</label>
                    <div>STEP ${app.current_step || 1}</div>
                </div>
            </div>
        </div>
        
        <!-- 추가 정보 섹션 -->
        ${app.address ? `
        <div class="info-card" style="margin-top: 24px;">
            <h3 class="info-card-title"><i class="fas fa-map-marker-alt"></i> 배송 정보</h3>
            <div class="info-item">
                <label>주소</label>
                <div>${app.address}</div>
            </div>
        </div>
        ` : ''}

        <!-- 수강 상태 관리 (세팅 완료된 학생만 표시) -->
        ${renderAppStatusSection(app)}
    `;
}

// ===== 개별분석 탭 =====
function loadModalAnalysisTab(app) {
    const container = document.getElementById('modalTabAnalysis');
    const hasAnalysis = app.analysis_status && app.analysis_content;
    
    // 읽기 전용/수정 모드 설정 (저장된 분석이 있으면 읽기 전용)
    const readOnly = hasAnalysis ? 'disabled' : '';
    const pointerEvents = hasAnalysis ? 'pointer-events: none; opacity: 0.7;' : '';
    const cursorStyle = hasAnalysis ? '' : 'cursor: pointer;';
    
    // 학생용 링크 생성
    const studentLink = `${window.location.origin}/analysis.html?id=${app.id}`;
    
    let html = `
        ${hasAnalysis ? `
        <div style="background: #f0fdf4; border: 1px solid #86efac; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <i class="fas fa-check-circle" style="font-size: 20px; color: #22c55e;"></i>
                    <div>
                        <div style="font-weight: 600; font-size: 14px; color: #166534;">개별분석 저장 완료</div>
                        <div style="font-size: 12px; color: #15803d; margin-top: 2px;">학생 전달용 링크</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" 
                           id="studentLinkInput" 
                           value="${studentLink}" 
                           readonly 
                           style="width: 320px; padding: 8px 12px; border: 1px solid #86efac; border-radius: 6px; font-size: 12px; background: white; font-family: monospace;">
                    <button type="button" 
                            onclick="copyModalStudentLink()" 
                            style="padding: 8px 16px; background: #22c55e; color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                        <i class="fas fa-copy"></i> 복사
                    </button>
                </div>
            </div>
        </div>
        ` : ''}
        
        <form id="modalAnalysisForm" onsubmit="saveModalAnalysis(event)">
            <!-- 1. 결과 선택 -->
            <div class="form-group">
                <label class="form-label">1. 결과 선택 <span class="required">*</span></label>
                <div id="statusOptionsContainer" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; ${pointerEvents}">
                    <label style="${cursorStyle}">
                        <input type="radio" name="analysis_status" value="승인" ${app.analysis_status === '승인' ? 'checked' : ''} required ${readOnly} style="display: none;">
                        <div class="status-option status-option-approval" data-value="승인" style="padding: 20px; border: 2px solid ${app.analysis_status === '승인' ? '#86efac' : '#e2e8f0'}; border-radius: 12px; text-align: center; background: ${app.analysis_status === '승인' ? '#f0fdf4' : '#ffffff'}; transition: all 0.2s;">
                            <i class="fas fa-check-circle" style="font-size: 32px; color: #86efac; margin-bottom: 8px;"></i>
                            <div style="font-weight: 600; font-size: 15px; color: #166534;">승인</div>
                        </div>
                    </label>
                    <label style="${cursorStyle}">
                        <input type="radio" name="analysis_status" value="조건부승인" ${app.analysis_status === '조건부승인' ? 'checked' : ''} ${readOnly} style="display: none;">
                        <div class="status-option status-option-conditional" data-value="조건부승인" style="padding: 20px; border: 2px solid ${app.analysis_status === '조건부승인' ? '#fcd34d' : '#e2e8f0'}; border-radius: 12px; text-align: center; background: ${app.analysis_status === '조건부승인' ? '#fef3c7' : '#ffffff'}; transition: all 0.2s;">
                            <i class="fas fa-exclamation-triangle" style="font-size: 32px; color: #fcd34d; margin-bottom: 8px;"></i>
                            <div style="font-weight: 600; font-size: 15px; color: #92400e;">조건부승인</div>
                        </div>
                    </label>
                    <label style="${cursorStyle}">
                        <input type="radio" name="analysis_status" value="거부" ${app.analysis_status === '거부' ? 'checked' : ''} ${readOnly} style="display: none;">
                        <div class="status-option status-option-reject" data-value="거부" style="padding: 20px; border: 2px solid ${app.analysis_status === '거부' ? '#fca5a5' : '#e2e8f0'}; border-radius: 12px; text-align: center; background: ${app.analysis_status === '거부' ? '#fee2e2' : '#ffffff'}; transition: all 0.2s;">
                            <i class="fas fa-times-circle" style="font-size: 32px; color: #fca5a5; margin-bottom: 8px;"></i>
                            <div style="font-weight: 600; font-size: 15px; color: #991b1b;">거부</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <!-- 2. 프로그램 배정 -->
            <div class="form-group">
                <label class="form-label">2. 프로그램 배정 <span class="required">*</span></label>
                <select name="assigned_program" class="form-select" required ${readOnly} style="background-position: right 12px center;">
                    <option value="">선택하세요</option>
                    <option value="내벨업챌린지 - Fast" ${app.assigned_program === '내벨업챌린지 - Fast' ? 'selected' : ''}>내벨업챌린지 - Fast (4주)</option>
                    <option value="내벨업챌린지 - Standard" ${app.assigned_program === '내벨업챌린지 - Standard' ? 'selected' : ''}>내벨업챌린지 - Standard (8주)</option>
                    <option value="상담 후 결정" ${app.assigned_program === '상담 후 결정' ? 'selected' : ''}>상담 후 결정</option>
                </select>
                <div style="font-size: 12px; color: #64748b; margin-top: 6px;">
                    학생이 신청한 프로그램: <strong>${app.preferred_program || '-'}</strong>
                </div>
            </div>
            
            <!-- 3. 가격 정보 -->
            <div class="form-group">
                <label class="form-label">3. 가격 정보</label>
                <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
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
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">
                                추가 할인 
                                <input type="number" name="additional_discount" id="additional_discount" 
                                       value="${app.additional_discount || 0}" min="0" max="790000"
                                       ${readOnly}
                                       onchange="calculateModalPrice()"
                                       style="width: 120px; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 4px; margin-left: 8px;">원
                            </td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #ef4444;" id="displayAdditionalDiscount">-0원</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; text-align: left;">보증금 (환불)</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: 600;">+100,000원</td>
                        </tr>
                        <tr style="border-top: 1px solid #e2e8f0;">
                            <td style="padding: 12px 0; font-weight: 700; color: #1e293b; text-align: left;">최종 금액</td>
                            <td style="padding: 12px 0; text-align: right; font-weight: 700; font-size: 20px; color: #9480c5;" id="displayFinalPrice">890,000원</td>
                        </tr>
                        </tbody>
                    </table>
                    <div id="discountReasonWrapper" style="margin-top: 12px; display: ${app.additional_discount && app.additional_discount > 0 ? 'block' : 'none'};">
                        <label style="font-size: 12px; color: #64748b; display: block; margin-bottom: 4px;">할인 사유</label>
                        <input type="text" name="discount_reason" value="${app.discount_reason || ''}" 
                               ${readOnly}
                               placeholder="할인 사유 입력"
                               style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    </div>
                </div>
            </div>
            
            <!-- 4. 일정 -->
            <div class="form-group">
                <label class="form-label">4. 프로그램 일정 <span class="required">*</span></label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div>
                        <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">시작일 (일요일만 가능)</label>
                        <input type="date" name="schedule_start" id="schedule_start" 
                               value="${app.schedule_start || ''}" 
                               required
                               ${readOnly}
                               style="width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-family: 'Pretendard', -apple-system, sans-serif;">
                    </div>
                    <div>
                        <label style="font-size: 13px; color: #64748b; display: block; margin-bottom: 6px;">종료일 (자동계산)</label>
                        <input type="date" name="schedule_end" id="schedule_end" 
                               value="${app.schedule_end || ''}" 
                               readonly
                               style="width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-family: 'Pretendard', -apple-system, sans-serif;">
                    </div>
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 6px;">
                    학생이 희망한 시작일: <strong>${app.preferred_start_date || '미입력'}</strong>
                </div>
            </div>
            
            <!-- 5. 분석 내용 -->
            <div class="form-group">
                <label class="form-label">5. 분석 내용 <span class="required">*</span></label>
                <textarea name="analysis_content" id="analysis_content" rows="10" required
                          ${readOnly}
                          style="width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-family: inherit; line-height: 1.6;"
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
5-8주차: Listening 강화 훈련">${app.analysis_content || ''}</textarea>
            </div>
            
            <!-- 하단 버튼 -->
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 32px; padding-top: 24px; border-top: 2px solid #e2e8f0;">
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
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn-secondary" onclick="closeManageModal()">취소</button>
                    <button type="submit" class="btn-primary" id="saveAnalysisBtn" ${hasAnalysis ? 'disabled style="opacity: 0.5; cursor: not-allowed; padding: 12px 24px;"' : 'style="padding: 12px 24px;"'}>
                        <i class="fas fa-save"></i> ${hasAnalysis ? '저장' : '분석 저장'}
                    </button>
                </div>
            </div>
        </form>
    `;
    
    container.innerHTML = html;
    
    // 이벤트 리스너 추가
    if (hasAnalysis) {
        calculateModalPrice();
    }
    
    // 결과 선택 옵션에 클릭 이벤트 추가 (읽기 전용 모드가 아닐 때만)
    if (!hasAnalysis) {
        document.querySelectorAll('.status-option').forEach(option => {
            option.addEventListener('click', function(e) {
                const value = this.getAttribute('data-value');
                selectStatus(value, e);
            });
        });
    }
    
    // 일정 계산 이벤트
    const scheduleStart = document.getElementById('schedule_start');
    const programSelect = document.querySelector('[name="assigned_program"]');
    if (scheduleStart && programSelect) {
        scheduleStart.addEventListener('change', calculateModalEndDate);
        programSelect.addEventListener('change', calculateModalEndDate);
    }
}

// 모달 내 가격 계산
function calculateModalPrice() {
    const additionalDiscount = parseInt(document.getElementById('additional_discount').value) || 0;
    const basePrice = 790000;
    const deposit = 100000;
    const finalPrice = basePrice - additionalDiscount + deposit;
    
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
    
    // 모든 옵션 스타일 초기화
    document.querySelectorAll('.status-option').forEach(option => {
        option.style.border = '2px solid #e2e8f0';
        option.style.background = '#ffffff';
    });
    
    // 선택된 라디오 버튼 체크
    const selectedRadio = document.querySelector(`#statusOptionsContainer input[value="${value}"]`);
    if (selectedRadio) {
        selectedRadio.checked = true;
    }
    
    // 선택된 옵션 스타일 적용
    const selectedOption = document.querySelector(`.status-option[data-value="${value}"]`);
    if (selectedOption) {
        if (value === '승인') {
            selectedOption.style.border = '2px solid #86efac';
            selectedOption.style.background = '#f0fdf4';
        } else if (value === '조건부승인') {
            selectedOption.style.border = '2px solid #fcd34d';
            selectedOption.style.background = '#fef3c7';
        } else if (value === '거부') {
            selectedOption.style.border = '2px solid #fca5a5';
            selectedOption.style.background = '#fee2e2';
        }
    }
}

// 모달 내 종료일 계산
function calculateModalEndDate() {
    const startInput = document.getElementById('schedule_start');
    const endInput = document.getElementById('schedule_end');
    const programSelect = document.querySelector('[name="assigned_program"]');
    
    if (!startInput.value || !programSelect.value) {
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
    
    // 프로그램에 따라 주수 결정
    let weeks = 0;
    if (programSelect.value === '내벨업챌린지 - Fast') {
        weeks = 4;
    } else if (programSelect.value === '내벨업챌린지 - Standard') {
        weeks = 8;
    } else {
        endInput.value = '';
        return;
    }
    
    // 종료일 계산: 시작일 + weeks주 후 토요일
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (weeks * 7) - 1);
    
    // ISO 형식으로 변환
    const endDateString = endDate.toISOString().split('T')[0];
    endInput.value = endDateString;
}

// 학생 링크 복사
function copyModalStudentLink() {
    const input = document.getElementById('studentLinkInput');
    input.select();
    document.execCommand('copy');
    
    alert('✅ 링크가 복사되었습니다!');
}

// 분석 저장
async function saveModalAnalysis(event) {
    event.preventDefault();
    
    if (!confirm('개별분석을 저장하시겠습니까?\n\n저장하면 학생이 확인하고 동의할 수 있습니다.')) {
        return;
    }
    
    const form = event.target;
    const formData = new FormData(form);
    
    // 가격 계산
    const basePrice = 1000000;
    const examSupport = 210000;
    const additionalDiscount = parseInt(formData.get('additional_discount')) || 0;
    const deposit = 100000;
    const finalPrice = basePrice - examSupport - additionalDiscount + deposit;
    
    const updateData = {
        analysis_status: formData.get('analysis_status'),
        assigned_program: formData.get('assigned_program'),
        program_price: basePrice,
        discount_amount: examSupport,
        additional_discount: additionalDiscount,
        discount_reason: formData.get('discount_reason') || '',
        final_price: finalPrice,
        schedule_start: formData.get('schedule_start'),
        schedule_end: formData.get('schedule_end'),
        analysis_content: formData.get('analysis_content'),
        analysis_saved_at: Date.now(),
        current_step: 2,
        status: '개별분석완료'
    };
    
    try {
        const updatedApp = await supabaseAPI.patch('applications', currentManageApp.id, updateData);
        
        if (updatedApp) {
            // 알림톡: 개별분석 완료 안내
            try {
                await sendKakaoAlimTalk('analysis_complete', {
                    name: updatedApp.name,
                    phone: updatedApp.phone,
                    app_id: updatedApp.id
                });
            } catch (e) { console.warn('알림톡 발송 실패:', e); }

            alert('✅ 개별분석이 저장되었습니다!\n\n학생 전달용 링크:\n' + `${window.location.origin}/analysis.html?id=${currentManageApp.id}`);
            
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
        
        // 수정하기 버튼 숨기기
        const editBtn = document.getElementById('editAnalysisBtn');
        if (editBtn) {
            editBtn.style.display = 'none';
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
                        ${contracts.map(c => `
                            <option value="${c.id}">${c.version} - ${escapeHtml(c.title)}</option>
                        `).join('')}
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
                `}
            </div>
        `;
    }
    
    // 입금 확인 섹션
    if (app.contract_agreed) {
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
            const sampleData = getContractSampleData();
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
    const studentData = {
        name: app.name,
        email: app.email,
        phone: app.phone,
        assigned_program: app.assigned_program,
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
                    ${contracts.map(c => `
                        <option value="${c.id}" ${c.id === currentManageApp.contract_template_id ? 'selected' : ''}>
                            ${c.version} - ${escapeHtml(c.title)}
                        </option>
                    `).join('')}
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
                    name: updatedApp.name,
                    phone: updatedApp.phone,
                    app_id: updatedApp.id
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
    
    // 입금이 확인되지 않았으면
    if (!app.deposit_confirmed_by_admin) {
        html = `
            <div class="alert alert-info">
                <i class="fas fa-info-circle" style="font-size: 24px; margin-right: 12px;"></i>
                <div>
                    <div style="font-weight: 700; font-size: 16px;">입금 확인 대기 중</div>
                    <div style="font-size: 14px; margin-top: 4px;">
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
        html += `
            <div class="alert alert-warning">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-rocket" style="font-size: 32px;"></i>
                    <div>
                        <div style="font-weight: 700; font-size: 18px;">🚀 이용방법 전달</div>
                        <div style="font-size: 14px; margin-top: 4px;">
                            입금이 확인되었습니다. 이제 학생에게 이용방법을 전달하세요.
                        </div>
                    </div>
                </div>
                <button onclick="sendUsageGuideFromModal('${app.id}')" class="btn-primary btn-lg" style="width: 100%; margin-top: 16px;">
                    <i class="fas fa-paper-plane"></i> 이용방법 전달하기
                </button>
                <div style="font-size: 12px; color: #78350f; text-align: center; margin-top: 12px;">
                    💡 클릭하면 자동으로 STEP 9 (이용방법전달)로 진행됩니다.
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="alert alert-success">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                    <div>
                        <div style="font-weight: 700; font-size: 18px;">✅ 이용방법 전달 완료</div>
                        <div style="font-size: 14px; margin-top: 4px;">
                            ${new Date(app.guide_sent_at).toLocaleString('ko-KR')}에 이용방법을 전달했습니다.
                        </div>
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
                    name: updatedApp.name,
                    phone: updatedApp.phone,
                    program: updatedApp.assigned_program || '',
                    start_date: updatedApp.schedule_start || '',
                    app_id: updatedApp.id
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
                    name: app.name,
                    phone: app.phone,
                    courier: app.shipping_courier || 'CJ대한통운',
                    tracking_number: app.shipping_tracking_number || '',
                    app_id: app.id
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

// ===== 택배발송 탭 =====
function loadModalShippingTab(app) {
    const container = document.getElementById('modalTabShipping');
    
    let html = '';
    
    // 이용방법이 전달되지 않았으면
    if (!app.guide_sent) {
        html = `
            <div class="alert alert-info">
                <i class="fas fa-info-circle" style="font-size: 24px; margin-right: 12px;"></i>
                <div>
                    <div style="font-weight: 700; font-size: 16px;">이용방법 전달 대기 중</div>
                    <div style="font-size: 14px; margin-top: 4px;">
                        이용방법을 먼저 전달해야 택배를 발송할 수 있습니다.
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = html;
        return;
    }
    
    // 이미 발송 완료되었으면
    if (app.shipping_completed) {
        html = `
            <div class="alert alert-success">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                    <div>
                        <div style="font-weight: 700; font-size: 18px;">✅ 택배 발송 완료</div>
                        <div style="font-size: 14px; margin-top: 4px;">
                            ${new Date(app.shipping_completed_at).toLocaleString('ko-KR')}에 발송 완료 처리되었습니다.
                        </div>
                    </div>
                </div>
                ${app.shipping_tracking_number ? `
                <div style="background: white; padding: 16px; border-radius: 8px; margin-top: 16px;">
                    <div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">택배사</div>
                    <div style="font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 16px;">
                        ${app.shipping_courier || 'CJ대한통운'}
                    </div>
                    <div style="font-size: 14px; color: #64748b; margin-bottom: 4px;">운송장 번호</div>
                    <div style="font-size: 18px; font-weight: 600; color: #1e293b; font-family: monospace;">
                        ${app.shipping_tracking_number}
                    </div>
                </div>
                ` : ''}
            </div>
            
            ${!app.kakaotalk_notification_sent ? `
            <!-- 알림톡 예약 섹션 -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fef9ef 100%); padding: 32px; border-radius: 16px; border: 2px solid #f59e0b; margin-top: 24px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
                    <i class="fas fa-comment-dots" style="font-size: 32px; color: #f59e0b;"></i>
                    <div>
                        <h3 style="font-size: 20px; font-weight: 700; color: #92400e; margin: 0;">📱 알림톡 예약</h3>
                        <p style="font-size: 14px; color: #78350f; margin: 4px 0 0 0;">
                            학생에게 챌린지 시작 전 알림톡을 예약하세요.
                        </p>
                    </div>
                </div>
                
                <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 16px 0;">📋 알림 정보</h4>
                    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; width: 120px;">학생 이름</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">연락처</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.phone}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">프로그램</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.assigned_program || '-'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">시작일</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.schedule_start || '-'}</td>
                        </tr>
                    </table>
                </div>
                
                <div style="background: #fff8e1; padding: 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
                    <div style="font-size: 13px; color: #78350f; line-height: 1.6;">
                        <i class="fas fa-info-circle" style="margin-right: 6px;"></i>
                        <strong>알림톡 전송 안내</strong><br>
                        • 전송 내용: 챌린지 시작 안내, 플랫폼 접속 정보<br>
                        • 예약 후에는 취소할 수 없습니다.
                    </div>
                </div>
                
                <button onclick="scheduleKakaoNotification('${app.id}')" 
                        style="width: 100%; padding: 16px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); 
                               color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; 
                               cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);">
                    <i class="fas fa-paper-plane" style="margin-right: 8px;"></i>
                    알림톡 예약 완료
                </button>
            </div>
            ` : `
            <!-- 알림톡 예약 완료 -->
            <div style="background: #dcfce7; padding: 24px; border-radius: 12px; margin-top: 24px; border: 2px solid #22c55e;">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 32px; color: #22c55e;"></i>
                    <div>
                        <div style="font-weight: 700; font-size: 18px; color: #166534;">✅ 알림톡 예약 완료</div>
                        <div style="font-size: 14px; margin-top: 4px; color: #166534;">
                            ${app.kakaotalk_notification_sent_at ? new Date(app.kakaotalk_notification_sent_at).toLocaleString('ko-KR') : ''}에 예약되었습니다.
                        </div>
                    </div>
                </div>
            </div>
            `}
        `;
    } else {
        // 발송 대기 중
        html = `
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fef9ef 100%); padding: 32px; border-radius: 16px; border: 2px solid #f59e0b; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
                    <i class="fas fa-shipping-fast" style="font-size: 32px; color: #f59e0b;"></i>
                    <div>
                        <h3 style="font-size: 20px; font-weight: 700; color: #92400e; margin: 0;">📦 택배 발송 관리</h3>
                        <p style="font-size: 14px; color: #78350f; margin: 4px 0 0 0;">
                            교재/자료를 발송하고 운송장 번호를 입력하세요.
                        </p>
                    </div>
                </div>
                
                <!-- 배송 정보 -->
                <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 16px 0;">📮 배송 정보</h4>
                    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #64748b; width: 100px;">수령인</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">연락처</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.phone}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">배송지</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.address || '주소 미입력'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">프로그램</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.assigned_program || '-'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; color: #64748b;">시작일</td>
                            <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${app.schedule_start || '-'}</td>
                        </tr>
                    </table>
                </div>
                
                <!-- 발송 품목 -->
                <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 16px 0;">📦 발송 품목</h4>
                    <ul style="margin: 0; padding-left: 24px; color: #78350f; font-size: 14px; line-height: 1.8;">
                        <li><strong>빈 노트테이킹</strong> - 수기 작성용 노트</li>
                        <li><strong>보카 실물책</strong> - 어휘 학습 교재</li>
                        <li><strong>필기구 세트</strong> - 연필, 연필깎이</li>
                    </ul>
                </div>
                
                <!-- 운송장 입력 -->
                <div style="background: white; padding: 24px; border-radius: 12px;">
                    <h4 style="font-size: 16px; font-weight: 600; color: #92400e; margin: 0 0 12px 0;">🚚 운송장 정보</h4>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 14px; color: #64748b; margin-bottom: 8px;">
                            택배사
                        </label>
                        <input type="text" 
                               id="modalCourier" 
                               value="CJ대한통운"
                               readonly
                               style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px; background: #f8fafc; color: #64748b;">
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 14px; color: #64748b; margin-bottom: 8px;">
                            운송장 번호 (선택사항)
                        </label>
                        <input type="text" 
                               id="modalTrackingNumber" 
                               placeholder="예: 123456789012"
                               style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px; font-family: monospace;">
                    </div>
                    
                    <button onclick="markShippingCompletedFromModal('${app.id}')" 
                            style="width: 100%; padding: 16px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); 
                                   color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; 
                                   cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);">
                        <i class="fas fa-check-circle" style="margin-right: 8px;"></i>
                        택배 발송 완료
                    </button>
                </div>
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

// 알림톡 예약 함수 (챌린지 D-1 알림톡 실제 발송)
async function scheduleKakaoNotification(appId) {
    if (!confirm('챌린지 시작 알림톡을 발송하시겠습니까?')) {
        return;
    }
    
    try {
        const app = await supabaseAPI.patch('applications', appId, {
                kakaotalk_notification_sent: true,
                kakaotalk_notification_sent_at: Date.now()
        });
        
        if (app) {
            // 알림톡: 챌린지 시작 D-1 안내 (실제 발송)
            try {
                await sendKakaoAlimTalk('challenge_reminder', {
                    name: app.name,
                    phone: app.phone,
                    program: app.assigned_program || '',
                    start_date: app.schedule_start || '',
                    app_id: app.id
                });
            } catch (e) { console.warn('알림톡 발송 실패:', e); }

            // 알림 생성
            await createNotification({
                application_id: appId,
                user_email: app.email,
                type: 'kakaotalk_scheduled',
                icon: 'fa-comment-dots',
                message: '챌린지 시작 알림톡이 발송되었습니다.'
            });
            
            alert('✅ 챌린지 시작 알림톡이 발송되었습니다!');
            currentManageApp = app;
            loadModalTab('shipping');
        } else {
            alert('❌ 처리에 실패했습니다.');
        }
    } catch (error) {
        console.error('Schedule KakaoTalk notification error:', error);
        alert('❌ 오류가 발생했습니다.');
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
