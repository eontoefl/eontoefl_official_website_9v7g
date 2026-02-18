// ==================== 탭 전환 ====================

function switchTab(tabName) {
    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // 모든 탭 컨텐츠 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // 선택한 탭 활성화
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).style.display = 'block';
}

// ==================== 개별분석지 폼 ====================

function loadAnalysisForm(app) {
    try {
        console.log('Loading analysis form for app:', app.id);
        const hasAnalysis = app.analysis_status && app.analysis_content;
    
        // 학생용 링크 생성
        const studentLink = `${window.location.origin}/analysis.html?id=${app.id}`;
    
        const formHTML = `
        ${hasAnalysis ? `
        <div style="padding: 20px; background: linear-gradient(135deg, #dcfce7 0%, #d1fae5 100%); border: 2px solid #22c55e; border-radius: 12px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                <i class="fas fa-check-circle" style="color: #166534; font-size: 24px;"></i>
                <div style="flex: 1;">
                    <div style="font-weight: 700; color: #166534; font-size: 16px; margin-bottom: 4px;">✅ 개별분석 저장 완료</div>
                    <div style="font-size: 13px; color: #166534;">
                        학생이 아래 링크로 분석 결과를 확인하고 동의할 수 있습니다.
                    </div>
                </div>
            </div>
            <div style="padding: 16px; background: white; border-radius: 8px; margin-top: 12px;">
                <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; font-weight: 600;">
                    <i class="fas fa-link"></i> 학생 전달용 링크
                </div>
                <div style="display: flex; gap: 8px;">
                    <input type="text" 
                           id="studentLinkInput" 
                           value="${studentLink}" 
                           readonly 
                           style="flex: 1; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: #f8fafc; font-family: monospace;">
                    <button type="button" 
                            onclick="copyStudentLink()" 
                            class="admin-btn admin-btn-primary" 
                            style="white-space: nowrap; padding: 10px 20px;">
                        <i class="fas fa-copy"></i> 복사
                    </button>
                </div>
                <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
                    💡 이 링크를 카카오톡이나 이메일로 학생에게 전달하세요. 학생은 24시간 내에 동의해야 합니다.
                </div>
            </div>
        </div>
        ` : ''}
        
        ${addContractSendSection(app)}
    
        <div style="padding: 24px; background: #f8fafc; border-radius: 12px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                <i class="fas fa-info-circle" style="color: #3b82f6; font-size: 20px;"></i>
                <div>
                    <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">개별분석지 작성</div>
                    <div style="font-size: 13px; color: #64748b;">
                        ${hasAnalysis ? '이미 작성된 개별분석지가 있습니다. 수정 후 저장하면 학생에게 업데이트된 내용이 전달됩니다.' : '학생에게 보여질 개별분석지를 작성하세요. 저장하면 학생이 확인하고 동의할 수 있습니다.'}
                    </div>
                </div>
            </div>
        </div>

        <form id="analysisForm" onsubmit="saveAnalysis(event)">
            <!-- 1. 상태 결정 -->
            <div class="analysis-form-group">
                <label class="analysis-form-label">
                    1. 결과 선택<span class="required">*</span>
                </label>
                <div class="analysis-radio-group">
                    <label class="analysis-radio-label">
                        <input type="radio" name="analysis_status" value="승인" ${app.analysis_status === '승인' ? 'checked' : ''} required>
                        <span>✅ 승인</span>
                    </label>
                    <label class="analysis-radio-label">
                        <input type="radio" name="analysis_status" value="조건부승인" ${app.analysis_status === '조건부승인' ? 'checked' : ''}>
                        <span>⚠️ 조건부승인</span>
                    </label>
                    <label class="analysis-radio-label">
                        <input type="radio" name="analysis_status" value="거부" ${app.analysis_status === '거부' ? 'checked' : ''}>
                        <span>❌ 거부</span>
                    </label>
                </div>
            </div>

            <!-- 2. 프로그램 배정 -->
            <div class="analysis-form-group">
                <label class="analysis-form-label">
                    2. 프로그램 배정<span class="required">*</span>
                </label>
                <select name="assigned_program" class="analysis-select" onchange="calculateEndDate()" required>
                    <option value="">선택하세요</option>
                    <option value="내벨업챌린지 - Fast" ${app.assigned_program === '내벨업챌린지 - Fast' ? 'selected' : ''}>내벨업챌린지 - Fast (4주)</option>
                    <option value="내벨업챌린지 - Standard" ${app.assigned_program === '내벨업챌린지 - Standard' ? 'selected' : ''}>내벨업챌린지 - Standard (8주)</option>
                    <option value="상담 후 결정" ${app.assigned_program === '상담 후 결정' ? 'selected' : ''}>상담 후 결정</option>
                </select>
                <div style="font-size: 12px; color: #64748b; margin-top: 6px;">
                    학생이 신청한 프로그램: <strong>${escapeHtml(app.preferred_program || '-')}</strong>
                </div>
            </div>

            <!-- 3. 가격 정보 -->
            <div class="analysis-form-group">
                <label class="analysis-form-label">
                    3. 가격 정보
                </label>
                <div style="padding: 16px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; margin-bottom: 16px;">
                    <div style="font-size: 13px; color: #92400e; font-weight: 600; margin-bottom: 12px;">
                        <i class="fas fa-info-circle"></i> 내벨업챌린지 프로그램 기본 가격 정책
                    </div>
                    <div style="font-size: 12px; color: #78350f; line-height: 1.8;">
                        • <strong>정가:</strong> 1,000,000원<br>
                        • <strong>시험료 지원:</strong> -210,000원<br>
                        • <strong>이용가:</strong> 790,000원<br>
                        • <strong>보증금:</strong> +100,000원<br>
                        → <strong style="font-size: 13px; color: #92400e;">최종 입금금액: 890,000원</strong>
                    </div>
                </div>
                
                <div>
                    <label style="font-size: 13px; color: #64748b; margin-bottom: 6px; display: block;">
                        추가 할인 (선택사항)
                        <span style="font-size: 11px; font-weight: 400; color: #94a3b8; margin-left: 8px;">개인 사정에 따른 할인이 필요한 경우 입력</span>
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px;">
                        <div>
                            <input type="number" 
                                   name="additional_discount" 
                                   id="additional_discount"
                                   class="analysis-input" 
                                   value="${app.additional_discount || 0}" 
                                   onchange="calculateFinalPrice()"
                                   placeholder="0">
                        </div>
                        <div>
                            <input type="text" 
                                   name="discount_reason" 
                                   class="analysis-input" 
                                   value="${escapeHtml(app.discount_reason || '')}"
                                   placeholder="할인 사유 (예: 얼리버드 할인, 지인 추천 등)">
                        </div>
                    </div>
                </div>
                
                <div class="price-display">
                    <div class="price-row">
                        <span class="price-label">정가</span>
                        <span class="price-value">1,000,000원</span>
                    </div>
                    <div class="price-row">
                        <span class="price-label">시험료 지원</span>
                        <span class="price-value" style="color: #22c55e;">-210,000원</span>
                    </div>
                    <div class="price-row">
                        <span class="price-label">이용가</span>
                        <span class="price-value">790,000원</span>
                    </div>
                    <div class="price-row">
                        <span class="price-label">추가 할인</span>
                        <span class="price-value" id="displayAdditionalDiscount" style="color: #ef4444;">-${(app.additional_discount || 0).toLocaleString()}원</span>
                    </div>
                    <div class="price-row">
                        <span class="price-label">보증금</span>
                        <span class="price-value" style="color: #3b82f6;">+100,000원</span>
                    </div>
                    <div class="price-row price-total">
                        <span class="price-label" style="font-size: 16px; font-weight: 600;">최종 입금금액</span>
                        <span class="price-value" id="displayFinalPrice" style="font-size: 18px; font-weight: 700; color: #92400e;">${(890000 - (app.additional_discount || 0)).toLocaleString()}원</span>
                    </div>
                </div>
            </div>

            <!-- 4. 일정 -->
            <div class="analysis-form-group">
                <label class="analysis-form-label">
                    4. 프로그램 일정<span class="required">*</span>
                </label>
                <div style="padding: 12px; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #92400e; line-height: 1.6;">
                        <i class="fas fa-calendar-alt"></i> <strong>시작일 규칙:</strong> 매주 일요일만 시작 가능<br>
                        <i class="fas fa-clock"></i> <strong>종료일 자동 계산:</strong><br>
                        • Fast: 4주 프로그램 (시작일 + 4주 후 토요일)<br>
                        • Standard: 8주 프로그램 (시작일 + 8주 후 토요일)
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div>
                        <label style="font-size: 13px; color: #64748b; margin-bottom: 6px; display: block;">
                            시작일 (일요일만 선택 가능)<span class="required">*</span>
                        </label>
                        <input type="date" 
                               id="schedule_start"
                               name="schedule_start" 
                               class="analysis-input" 
                               value="${app.schedule_start || ''}"
                               onchange="calculateEndDate()"
                               required>
                    </div>
                    <div>
                        <label style="font-size: 13px; color: #64748b; margin-bottom: 6px; display: block;">
                            종료일 (자동 계산)
                        </label>
                        <input type="date" 
                               id="schedule_end"
                               name="schedule_end" 
                               class="analysis-input" 
                               value="${app.schedule_end || ''}"
                               readonly
                               style="background: #f1f5f9; cursor: not-allowed;">
                    </div>
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 6px;">
                    학생이 희망한 시작일: <strong>${app.preferred_start_date || '-'}</strong>
                </div>
            </div>

            <!-- 5. 분석 내용 -->
            <div class="analysis-form-group">
                <label class="analysis-form-label">
                    5. 분석 내용 (학생에게 표시됨)<span class="required">*</span>
                </label>
                <div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">
                    학생의 현재 상황, 추천 이유, 학습 계획 등을 자세히 작성해주세요.
                </div>
                <textarea name="analysis_content" 
                          class="analysis-textarea" 
                          placeholder="예시:&#10;&#10;${app.name}님의 현재 토플 점수와 목표를 분석한 결과, 내벨업챌린지 Fast 프로그램이 가장 적합하다고 판단됩니다.&#10;&#10;[현재 상황]&#10;• 현재 점수: ${app.total_score || '점수 없음'}&#10;• 목표 점수: ${app.target_cutoff_old || app.target_cutoff_new || '미설정'}&#10;• 데드라인: ${app.submission_deadline || '미설정'}&#10;&#10;[추천 이유]&#10;(여기에 상세한 분석 내용을 작성하세요)&#10;&#10;[학습 계획]&#10;(프로그램 진행 방식을 설명하세요)"
                          required>${app.analysis_content || ''}</textarea>
            </div>

            <!-- 저장 버튼 -->
            <div class="form-actions">
                <button type="button" class="admin-btn admin-btn-outline" onclick="previewAnalysis()">
                    <i class="fas fa-eye"></i> 미리보기
                </button>
                <button type="submit" class="admin-btn admin-btn-primary">
                    <i class="fas fa-save"></i> ${hasAnalysis ? '수정 사항 저장' : '저장하고 학생에게 공개'}
                </button>
            </div>
        </form>

        <!-- 미리보기 영역 (초기에는 숨김) -->
        <div id="analysisPreview" class="analysis-preview" style="display: none;">
            <div class="analysis-preview-title">
                <i class="fas fa-eye"></i>
                학생에게 보이는 화면 미리보기
            </div>
            <div id="analysisPreviewContent"></div>
        </div>
        `;
        
        document.getElementById('analysisContent').innerHTML = formHTML;
    } catch (error) {
        console.error('Error loading analysis form:', error);
        const analysisContent = document.getElementById('analysisContent');
        if (analysisContent) {
            analysisContent.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
                    <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">로딩 오류</h3>
                    <p style="font-size: 14px;">${error.message}</p>
                    <pre style="font-size: 12px; text-align: left; background: #f8fafc; padding: 16px; border-radius: 8px; margin-top: 16px; overflow: auto;">${error.stack}</pre>
                </div>
            `;
        }
    }
}

// 가격 계산
function calculateFinalPrice() {
    const additionalDiscount = parseInt(document.getElementById('additional_discount').value) || 0;
    const basePrice = 790000; // 이용가 (정가 1,000,000 - 시험료 지원 210,000)
    const deposit = 100000; // 보증금
    const finalPrice = basePrice - additionalDiscount + deposit;
    
    document.getElementById('displayAdditionalDiscount').textContent = '-' + additionalDiscount.toLocaleString() + '원';
    document.getElementById('displayFinalPrice').textContent = finalPrice.toLocaleString() + '원';
}

// 하위 호환성을 위해 기존 함수명도 유지
function calculatePrice() {
    calculateFinalPrice();
}

// 종료일 자동 계산
function calculateEndDate() {
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
        // 상담 후 결정인 경우 종료일 비우기
        endInput.value = '';
        return;
    }
    
    // 종료일 계산: 시작일 + weeks주 후 토요일
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (weeks * 7) - 1); // -1 하면 토요일
    
    // ISO 형식으로 변환 (YYYY-MM-DD)
    const endDateString = endDate.toISOString().split('T')[0];
    endInput.value = endDateString;
}

// 미리보기
function previewAnalysis() {
    const form = document.getElementById('analysisForm');
    const formData = new FormData(form);
    
    const status = formData.get('analysis_status');
    const program = formData.get('assigned_program');
    const programPrice = parseInt(formData.get('program_price')) || 0;
    const discount = parseInt(formData.get('discount_amount')) || 0;
    const finalPrice = programPrice - discount;
    const startDate = formData.get('schedule_start');
    const endDate = formData.get('schedule_end');
    const content = formData.get('analysis_content');
    
    // 미리보기 HTML 생성
    const previewHTML = `
        <div style="border: 2px solid #e2e8f0; border-radius: 12px; padding: 24px; background: white;">
            <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="font-size: 24px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">
                    🎓 ${currentApplication.name}님의 토플 일대일 진단서
                </h2>
                <div style="font-size: 14px; color: #64748b;">
                    작성일: ${formatDateOnly(Date.now())}
                </div>
            </div>
            
            <div style="padding: 16px; background: ${status === '승인' ? '#dcfce7' : status === '조건부승인' ? '#fef3c7' : '#fee2e2'}; border-radius: 8px; margin-bottom: 24px; text-align: center;">
                <div style="font-size: 18px; font-weight: 700; color: ${status === '승인' ? '#166534' : status === '조건부승인' ? '#92400e' : '#991b1b'};">
                    ${status === '승인' ? '✅ 승인' : status === '조건부승인' ? '⚠️ 조건부승인' : '❌ 거부'}
                </div>
            </div>
            
            <div style="margin-bottom: 24px; padding: 20px; background: #f8fafc; border-radius: 8px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #1e293b;">📝 맞춤 분석 내용</h3>
                <div style="white-space: pre-wrap; line-height: 1.8; color: #1e293b;">${escapeHtml(content)}</div>
            </div>
            
            <div style="margin-bottom: 24px; padding: 20px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #3b82f6;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #1e3a8a;">🎯 배정된 프로그램</h3>
                <div style="font-size: 18px; font-weight: 600; color: #1e3a8a;">${program}</div>
            </div>
            
            <div style="margin-bottom: 24px; padding: 20px; background: #fefce8; border-radius: 8px; border-left: 4px solid #eab308;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #92400e;">💰 가격 안내</h3>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748b;">프로그램 가격</span>
                    <span style="font-weight: 600;">${programPrice.toLocaleString()}원</span>
                </div>
                ${discount > 0 ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748b;">할인</span>
                    <span style="font-weight: 600; color: #ef4444;">-${discount.toLocaleString()}원</span>
                </div>
                ` : ''}
                <div style="border-top: 2px solid #eab308; padding-top: 12px; margin-top: 12px; display: flex; justify-content: space-between;">
                    <span style="font-size: 16px; font-weight: 700; color: #92400e;">최종 금액</span>
                    <span style="font-size: 20px; font-weight: 700; color: #92400e;">${finalPrice.toLocaleString()}원</span>
                </div>
            </div>
            
            <div style="margin-bottom: 24px; padding: 20px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #166534;">📅 일정 안내</h3>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: #64748b;">시작일</span>
                    <span style="font-weight: 600;">${startDate}</span>
                </div>
                ${endDate ? `
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">종료일</span>
                    <span style="font-weight: 600;">${endDate}</span>
                </div>
                ` : ''}
            </div>
            
            <div style="padding: 20px; background: #fef2f2; border-radius: 8px; border: 2px solid #fecaca;">
                <div style="font-weight: 700; margin-bottom: 12px; color: #991b1b;">
                    ⏰ 24시간 이내 회신 필요!
                </div>
                <div style="font-size: 13px; color: #64748b; line-height: 1.6;">
                    • 24시간 이내 미응답 시 자동 거부 처리됩니다<br>
                    • 거부 시 5일간 재신청이 불가능합니다
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('analysisPreviewContent').innerHTML = previewHTML;
    document.getElementById('analysisPreview').style.display = 'block';
    
    // 미리보기로 스크롤
    document.getElementById('analysisPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 개별분석지 저장
async function saveAnalysis(event) {
    event.preventDefault();
    
    if (!confirm('개별분석지를 저장하시겠습니까?\n학생이 이 내용을 확인하고 동의할 수 있게 됩니다.')) {
        return;
    }
    
    const form = event.target;
    const formData = new FormData(form);
    
    // 고정 가격 정책
    const basePrice = 1000000; // 정가
    const examSupport = 210000; // 시험료 지원
    const deposit = 100000; // 보증금
    const additionalDiscount = parseInt(formData.get('additional_discount')) || 0;
    const finalPrice = basePrice - examSupport - additionalDiscount + deposit; // 890,000 - 추가할인
    
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
        analysis_completed_at: Date.now(), // ISO 문자열 대신 밀리초 숫자로 변경
        current_step: 3, // 개별분석 완료 단계
        status: '개별분석완료'
    };
    
    try {
        const response = await fetch(`tables/applications/${currentApplication.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
            const studentLink = `${window.location.origin}/analysis.html?id=${currentApplication.id}`;
            alert(`✅ 개별분석지가 저장되었습니다!\n\n학생용 링크:\n${studentLink}\n\n위 링크를 학생에게 전달해주세요.\n(페이지 새로고침 후 링크 복사 버튼이 표시됩니다)`);
            location.reload();
        } else {
            alert('❌ 저장에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 학생용 링크 복사
function copyStudentLink() {
    const linkInput = document.getElementById('studentLinkInput');
    
    // 텍스트 선택
    linkInput.select();
    linkInput.setSelectionRange(0, 99999); // 모바일 지원
    
    // 클립보드에 복사
    try {
        document.execCommand('copy');
        
        // 버튼 텍스트 변경
        const btn = event.target.closest('button');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> 복사 완료!';
        btn.style.background = '#22c55e';
        
        // 2초 후 원래대로
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.background = '';
        }, 2000);
        
    } catch (err) {
        alert('복사에 실패했습니다. 수동으로 복사해주세요.');
    }
}

// ==================== Phase 2: 계약서 발송 ====================

// 계약서 발송 섹션을 폼에 추가
function addContractSendSection(app) {
    if (!app.student_agreed_at) {
        // 학생이 아직 개별분석에 동의하지 않았으면
        return '';
    }

    if (app.contract_sent) {
        // 이미 계약서가 발송되었으면
        return `
            <div style="padding: 20px; background: linear-gradient(135deg, #dcfce7 0%, #d1fae5 100%); border: 2px solid #22c55e; border-radius: 12px; margin-top: 24px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <i class="fas fa-check-circle" style="color: #166534; font-size: 24px;"></i>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: #166534; font-size: 16px; margin-bottom: 4px;">✅ 계약서 발송 완료</div>
                        <div style="font-size: 13px; color: #166534;">
                            ${new Date(app.contract_sent_at).toLocaleString('ko-KR')}에 계약서가 발송되었습니다.
                        </div>
                    </div>
                </div>
                ${app.contract_agreed ? `
                <div style="padding: 12px; background: white; border-radius: 8px; margin-top: 12px;">
                    <div style="font-size: 13px; color: #166534; font-weight: 600;">
                        <i class="fas fa-check-double"></i> 학생이 ${new Date(app.contract_agreed_at).toLocaleString('ko-KR')}에 계약에 동의했습니다.
                    </div>
                </div>
                ` : `
                <div style="padding: 12px; background: white; border-radius: 8px; margin-top: 12px;">
                    <div style="font-size: 13px; color: #92400e; font-weight: 600;">
                        <i class="fas fa-clock"></i> 학생의 계약 동의를 기다리는 중입니다.
                    </div>
                </div>
                `}
            </div>
        `;
    }

    // 계약서 발송 버튼
    return `
        <div style="padding: 20px; background: linear-gradient(135deg, #fff4e6 0%, #fef3c7 100%); border: 2px solid #f59e0b; border-radius: 12px; margin-top: 24px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                <i class="fas fa-file-signature" style="color: #92400e; font-size: 24px;"></i>
                <div style="flex: 1;">
                    <div style="font-weight: 700; color: #92400e; font-size: 16px; margin-bottom: 4px;">📋 계약서 발송</div>
                    <div style="font-size: 13px; color: #92400e;">
                        학생이 개별분석에 동의했습니다. 이제 계약서를 발송하세요.
                    </div>
                </div>
            </div>
            <div style="padding: 12px; background: white; border-radius: 8px; margin-top: 12px;">
                <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">
                    학생 동의 시각: <strong>${new Date(app.student_agreed_at).toLocaleString('ko-KR')}</strong>
                </div>
                <button type="button" 
                        onclick="sendContract('${app.id}')" 
                        class="admin-btn admin-btn-primary" 
                        style="width: 100%; padding: 14px;">
                    <i class="fas fa-paper-plane"></i> 계약서 발송하기
                </button>
                <div style="font-size: 11px; color: #64748b; margin-top: 8px; text-align: center;">
                    💡 발송하면 학생에게 계약서 탭이 활성화되고 24시간 내 동의를 받게 됩니다.
                </div>
            </div>
        </div>
    `;
}

// 계약서 발송
async function sendContract(appId) {
    if (!confirm('계약서를 발송하시겠습니까?\n\n학생에게 계약서가 표시되고 24시간 내에 동의해야 합니다.')) {
        return;
    }

    try {
        const response = await fetch(`tables/applications/${appId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_sent: true,
                contract_sent_at: Date.now(),
                current_step: 3  // STEP 3: 계약서 단계
            })
        });

        if (response.ok) {
            alert('✅ 계약서가 발송되었습니다!\n\n학생이 24시간 내에 동의해야 합니다.');
            location.reload();
        } else {
            alert('❌ 발송에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Send contract error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// ==================== Phase 2: 입금 확인 ====================

// 입금 확인 탭 로드
async function loadDepositTab(app) {
    try {
        const depositContent = document.getElementById('depositContent');
        if (!depositContent) {
            console.error('depositContent element not found');
            return;
        }
        console.log('Loading deposit tab for app:', app.id);
        
        // 입금 정보 HTML 미리 생성
        const depositInfoHtml = await getDepositInfo(app);

        // 계약이 완료되지 않았으면
        if (!app.contract_agreed) {
            depositContent.innerHTML = `
            <div style="padding: 80px 40px; text-align: center; color: #94a3b8;">
                <i class="fas fa-lock" style="font-size: 64px; margin-bottom: 24px; color: #cbd5e1;"></i>
                <h3 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #64748b;">입금 확인 대기</h3>
                <p style="font-size: 15px; line-height: 1.6;">
                    학생이 계약에 동의한 후 입금 확인이 가능합니다.<br/>
                    먼저 학생에게 계약서를 발송해주세요.
                </p>
            </div>
        `;
            return;
        }

        // 입금이 확인되었으면
        if (app.deposit_confirmed_by_admin) {
            // 이용방법 이미 전달했는지 확인
            if (app.guide_sent) {
            depositContent.innerHTML = `
                <div style="background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%); padding: 32px; border-radius: 16px; border: 2px solid #22c55e; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                        <i class="fas fa-check-circle" style="font-size: 32px; color: #22c55e;"></i>
                        <div>
                            <h3 style="font-size: 20px; font-weight: 700; color: #166534; margin: 0;">✅ 입금 확인 완료</h3>
                            <p style="font-size: 14px; color: #15803d; margin: 8px 0 0 0;">
                                ${new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR')}에 입금을 확인했습니다.
                            </p>
                        </div>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 12px;">
                        <table style="width: 100%; font-size: 15px;">
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">확인 금액</td>
                                <td style="padding: 8px 0; font-weight: 600; text-align: right;">${(app.deposit_amount || 0).toLocaleString()}원</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">입금 확인 시각</td>
                                <td style="padding: 8px 0; font-weight: 600; text-align: right;">${app.deposit_confirmed_by_admin_at ? new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR') : '-'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">이용방법 전달</td>
                                <td style="padding: 8px 0; font-weight: 600; text-align: right;">${app.guide_sent_at ? new Date(app.guide_sent_at).toLocaleString('ko-KR') : '-'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
                
                <div style="background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%); padding: 32px; border-radius: 16px; border: 2px solid #3b82f6; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <i class="fas fa-rocket" style="font-size: 32px; color: #3b82f6;"></i>
                        <div>
                            <h3 style="font-size: 20px; font-weight: 700; color: #1e3a8a; margin: 0;">✅ 이용방법 전달 완료</h3>
                            <p style="font-size: 14px; color: #1e40af; margin: 8px 0 0 0;">
                                ${app.guide_sent_at ? new Date(app.guide_sent_at).toLocaleString('ko-KR') : '-'}에 이용방법을 전달했습니다.
                            </p>
                        </div>
                    </div>
                    <p style="font-size: 15px; color: #1e3a8a; margin: 16px 0 0 0; line-height: 1.6;">
                        학생이 "이용방법" 탭에서 확인하고 "챌린지 시작하기" 버튼을 클릭하면 STEP 10으로 진행됩니다.
                    </p>
                </div>
                
                ${depositInfoHtml}
            `;
            } else {
            // 이용방법 전달 전
            depositContent.innerHTML = `
                <div style="background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%); padding: 32px; border-radius: 16px; border: 2px solid #22c55e; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                        <i class="fas fa-check-circle" style="font-size: 32px; color: #22c55e;"></i>
                        <div>
                            <h3 style="font-size: 20px; font-weight: 700; color: #166534; margin: 0;">✅ 입금 확인 완료</h3>
                            <p style="font-size: 14px; color: #15803d; margin: 8px 0 0 0;">
                                ${app.deposit_confirmed_by_admin_at ? new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR') + '에' : ''} 입금을 확인했습니다.
                            </p>
                        </div>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 12px;">
                        <table style="width: 100%; font-size: 15px;">
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">확인 금액</td>
                                <td style="padding: 8px 0; font-weight: 600; text-align: right;">${(app.deposit_amount || 0).toLocaleString()}원</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">학생 입금 알림</td>
                                <td style="padding: 8px 0; font-weight: 600; text-align: right;">${app.deposit_confirmed_by_student_at ? new Date(app.deposit_confirmed_by_student_at).toLocaleString('ko-KR') : '-'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">관리자 확인</td>
                                <td style="padding: 8px 0; font-weight: 600; text-align: right;">${app.deposit_confirmed_by_admin_at ? new Date(app.deposit_confirmed_by_admin_at).toLocaleString('ko-KR') : '-'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
                
                <div style="background: linear-gradient(135deg, #fff4e6 0%, #fefce8 100%); padding: 32px; border-radius: 16px; border: 2px solid #f59e0b; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                        <i class="fas fa-rocket" style="font-size: 32px; color: #f59e0b;"></i>
                        <div>
                            <h3 style="font-size: 20px; font-weight: 700; color: #92400e; margin: 0;">🚀 이용방법 전달</h3>
                            <p style="font-size: 14px; color: #a16207; margin: 8px 0 0 0;">
                                입금이 확인되었습니다. 이제 학생에게 이용방법을 전달하세요.
                            </p>
                        </div>
                    </div>
                    <div style="background: white; padding: 24px; border-radius: 12px;">
                        
                        <!-- 테스트룸 액세스 체크박스 -->
                        <div style="background: #f0f9ff; padding: 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3b82f6;">
                            <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                                <input type="checkbox" id="testroom-access-${app.id}" 
                                       ${app.challenge_access_granted ? 'checked' : ''}
                                       onchange="toggleTestroomAccess('${app.id}', this.checked)"
                                       style="width: 20px; height: 20px; cursor: pointer;">
                                <div>
                                    <span style="font-size: 15px; font-weight: 600; color: #1e40af;">
                                        🎯 테스트룸 액세스 완료
                                    </span>
                                    <p style="font-size: 13px; color: #1e40af; margin: 4px 0 0 0;">
                                        체크하면 학생 화면에 "테스트룸 액세스 완료" 안내가 표시됩니다.
                                    </p>
                                </div>
                            </label>
                            <p style="font-size: 12px; color: #64748b; margin: 12px 0 0 0; padding-top: 12px; border-top: 1px solid #bae6fd;">
                                💡 <strong>액세스 방법:</strong> 구글 시트에 학생 정보를 직접 기입하신 후 체크해주세요.
                            </p>
                        </div>
                        
                        <p style="font-size: 15px; color: #64748b; margin: 0 0 16px 0; line-height: 1.6;">
                            "이용방법 전달" 버튼을 클릭하면 학생의 "이용방법" 탭이 활성화됩니다.
                        </p>
                        <button onclick="sendUsageGuide('${app.id}')" 
                                style="width: 100%; padding: 16px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
                                       color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; 
                                       cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                            <i class="fas fa-paper-plane" style="margin-right: 8px;"></i>
                            이용방법 전달하기
                        </button>
                        <p style="font-size: 12px; color: #64748b; text-align: center; margin: 12px 0 0 0;">
                            💡 클릭하면 자동으로 STEP 9 (이용방법전달)로 진행됩니다.
                        </p>
                    </div>
                </div>
                
                ${depositInfoHtml}
                ${addShippingSection(app)}
            `;
            }
            return;
        }

        // 학생이 입금 완료 버튼을 눌렀으면
        if (app.deposit_confirmed_by_student) {
        depositContent.innerHTML = `
            <div style="background: linear-gradient(135deg, #fff4e6 0%, #fefce8 100%); padding: 32px; border-radius: 16px; border: 2px solid #f59e0b; margin-bottom: 32px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-bell" style="font-size: 32px; color: #f59e0b;"></i>
                    <div>
                        <h3 style="font-size: 20px; font-weight: 700; color: #92400e; margin: 0;">🔔 입금 확인 요청</h3>
                        <p style="font-size: 14px; color: #a16207; margin: 8px 0 0 0;">
                            ${new Date(app.deposit_confirmed_by_student_at).toLocaleString('ko-KR')}에 학생이 입금 완료를 알렸습니다.
                        </p>
                    </div>
                </div>
                <p style="font-size: 15px; color: #92400e; margin: 0 0 24px 0; line-height: 1.6;">
                    계좌를 확인하고 입금이 완료되었으면 아래 버튼을 눌러주세요.
                </p>
                ${getDepositConfirmForm(app)}
            </div>
            ${getDepositInfo(app)}
            ${addShippingSection(app)}
        `;
            return;
        }

        // 입금 대기 중
        depositContent.innerHTML = `
        <div style="background: #f8fafc; padding: 32px; border-radius: 16px; border: 2px solid #e2e8f0; margin-bottom: 32px; text-align: center;">
            <i class="fas fa-clock" style="font-size: 48px; color: #94a3b8; margin-bottom: 16px;"></i>
            <h3 style="font-size: 20px; font-weight: 700; color: #64748b; margin: 0 0 12px 0;">입금 대기 중</h3>
            <p style="font-size: 15px; color: #64748b; line-height: 1.6;">
                학생이 계약에 동의했습니다.<br/>
                학생이 입금 완료 알림을 보내면 여기에서 확인하실 수 있습니다.
            </p>
        </div>
        ${getDepositInfo(app)}
        ${addShippingSection(app)}
    `;
    } catch (error) {
        console.error('Error loading deposit tab:', error);
        const depositContent = document.getElementById('depositContent');
        if (depositContent) {
            depositContent.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
                    <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">로딩 오류</h3>
                    <p style="font-size: 14px;">${error.message}</p>
                </div>
            `;
        }
    }
}

// 입금 정보 표시 (관리자용)
async function getDepositInfo(app) {
    // 사이트 설정 불러오기
    const settings = await getSiteSettings();
    const accountInfo = settings 
        ? `${settings.bank_name} ${settings.account_number} (${settings.account_holder})`
        : '국민은행 123-456-789012 (김민서)';
    return `
        <div style="background: white; padding: 32px; border-radius: 16px; border: 2px solid #e2e8f0;">
            <h3 style="font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 24px 0;">
                <i class="fas fa-info-circle" style="color: #3b82f6; margin-right: 8px;"></i>
                입금 정보
            </h3>
            
            <table style="width: 100%; border-collapse: collapse; font-size: 15px; margin-bottom: 24px;">
                <tr style="background: #f8fafc;">
                    <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600; width: 30%;">학생 이름</td>
                    <td style="padding: 12px; border: 1px solid #e2e8f0;">${app.name}</td>
                </tr>
                <tr>
                    <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">입금 계좌</td>
                    <td style="padding: 12px; border: 1px solid #e2e8f0;">${accountInfo}</td>
                </tr>
                <tr style="background: #f8fafc;">
                    <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">최종 입금 금액</td>
                    <td style="padding: 12px; border: 1px solid #e2e8f0; font-size: 18px; font-weight: 700; color: #9480c5;">${(app.final_price || 0).toLocaleString()}원</td>
                </tr>
                <tr>
                    <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">계약 동의 시각</td>
                    <td style="padding: 12px; border: 1px solid #e2e8f0;">${app.contract_agreed_at ? new Date(app.contract_agreed_at).toLocaleString('ko-KR') : '-'}</td>
                </tr>
                <tr style="background: #f8fafc;">
                    <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: 600;">학생 입금 알림</td>
                    <td style="padding: 12px; border: 1px solid #e2e8f0;">${app.deposit_confirmed_by_student_at ? new Date(app.deposit_confirmed_by_student_at).toLocaleString('ko-KR') : '아직 알림 없음'}</td>
                </tr>
            </table>
            
            <div style="background: #f0f9ff; padding: 20px; border-radius: 12px; border: 1px solid #bae6fd;">
                <h4 style="font-size: 15px; font-weight: 600; color: #0c4a6e; margin: 0 0 12px 0;">
                    <i class="fas fa-lightbulb" style="margin-right: 8px;"></i>
                    입금 확인 절차
                </h4>
                <ol style="margin: 0; padding-left: 20px; font-size: 14px; color: #0c4a6e; line-height: 1.8;">
                    <li>학생이 "입금 완료했습니다" 버튼을 누르면 알림이 옵니다.</li>
                    <li>계좌에서 실제 입금 내역을 확인합니다.</li>
                    <li>입금액이 정확하면 입금액을 입력하고 "입금 확인 완료" 버튼을 누릅니다.</li>
                    <li>자동으로 STEP 8 (입금 확인 완료)로 진행됩니다.</li>
                </ol>
            </div>
        </div>
    `;
}

// 입금 확인 폼
function getDepositConfirmForm(app) {
    return `
        <div style="background: white; padding: 24px; border-radius: 12px;">
            <h4 style="font-size: 16px; font-weight: 600; color: #1e293b; margin: 0 0 16px 0;">입금 확인</h4>
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 14px; color: #64748b; margin-bottom: 8px;">
                    입금 확인 금액<span style="color: #ef4444;">*</span>
                </label>
                <input type="number" 
                       id="depositAmount" 
                       placeholder="실제 입금된 금액을 입력하세요" 
                       value="${app.final_price || ''}"
                       style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px;">
                <p style="font-size: 13px; color: #64748b; margin: 8px 0 0 0;">
                    예상 금액: <strong>${(app.final_price || 0).toLocaleString()}원</strong>
                </p>
            </div>
            <button onclick="confirmDepositByAdmin('${app.id}')" 
                    style="width: 100%; padding: 16px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); 
                           color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; 
                           cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);">
                <i class="fas fa-check-circle" style="margin-right: 8px;"></i>
                입금 확인 완료
            </button>
            <p style="font-size: 12px; color: #64748b; text-align: center; margin: 12px 0 0 0;">
                💡 입금 확인 후 자동으로 STEP 8로 진행되며 학생에게 이용 방법 안내가 가능합니다.
            </p>
        </div>
    `;
}

// 관리자 입금 확인
async function confirmDepositByAdmin(appId) {
    const amountInput = document.getElementById('depositAmount');
    const amount = parseInt(amountInput.value);

    if (!amount || amount <= 0) {
        alert('입금 금액을 입력해주세요.');
        return;
    }

    if (!confirm(`입금 금액 ${amount.toLocaleString()}원을 확인하시겠습니까?\n\n확인하면 학생에게 이용 방법 안내를 발송할 수 있습니다.`)) {
        return;
    }

    try {
        const response = await fetch(`tables/applications/${appId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deposit_confirmed_by_admin: true,
                deposit_confirmed_by_admin_at: Date.now(),
                deposit_amount: amount,
                current_step: 5
            })
        });

        if (response.ok) {
            const app = await response.json();
            
            // 알림 생성
            await createNotification({
                application_id: appId,
                user_email: app.email,
                type: 'payment_confirmed',
                icon: 'fa-check-circle',
                message: `입금이 확인되었습니다. (${amount.toLocaleString()}원)`
            });
            
            alert('✅ 입금이 확인되었습니다!\n\n이제 이용 방법 안내를 발송할 수 있습니다.');
            location.reload();
        } else {
            alert('❌ 입금 확인에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Confirm deposit error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// ==================== Phase 3: 이용방법 전달 ====================

// 관리자: 이용방법 전달
async function sendUsageGuide(appId) {
    if (!confirm('이용방법을 전달하시겠습니까?\n\n학생이 "이용방법" 탭에서 확인할 수 있습니다.')) {
        return;
    }

    try {
        const response = await fetch(`tables/applications/${appId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guide_sent: true,
                guide_sent_at: Date.now()
                // current_step은 5에서 유지
            })
        });

        if (response.ok) {
            const app = await response.json();
            
            // 알림 생성
            await createNotification({
                application_id: appId,
                user_email: app.email,
                type: 'guide_sent',
                icon: 'fa-book-open',
                message: '이용방법이 전달되었습니다.'
            });
            
            alert('✅ 이용방법이 전달되었습니다!\n\n학생이 플랫폼에 접속할 수 있습니다.');
            location.reload();
        } else {
            alert('❌ 전달에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Send usage guide error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 테스트룸 액세스 토글
async function toggleTestroomAccess(appId, checked) {
    try {
        const response = await fetch(`tables/applications/${appId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                challenge_access_granted: checked
            })
        });

        if (response.ok) {
            if (checked) {
                alert('✅ 테스트룸 액세스가 체크되었습니다.\n학생 화면에 "테스트룸 액세스 완료" 안내가 표시됩니다.');
            } else {
                alert('체크가 해제되었습니다.');
            }
            // 페이지 새로고침 없이 UI만 업데이트
        } else {
            alert('❌ 업데이트에 실패했습니다.');
            // 원래 상태로 복구
            document.getElementById(`testroom-access-${appId}`).checked = !checked;
        }
    } catch (error) {
        console.error('Toggle testroom access error:', error);
        alert('❌ 오류가 발생했습니다.');
        document.getElementById(`testroom-access-${appId}`).checked = !checked;
    }
}

// ==================== Phase 3: 택배 관리 (선택사항) ====================

// 관리자: 택배 발송 완료 처리
async function confirmShipping(appId) {
    const trackingNumber = document.getElementById(`trackingNumber_${appId}`)?.value || '';
    
    if (!confirm(`택배 발송을 완료하시겠습니까?${trackingNumber ? `\n\n운송장 번호: ${trackingNumber}` : ''}`)) {
        return;
    }
    
    try {
        const response = await fetch(`tables/applications/${appId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shipping_completed: true,
                shipping_completed_at: Date.now(),
                shipping_tracking_number: trackingNumber
            })
        });
        
        if (response.ok) {
            const app = await response.json();
            
            // 알림 생성
            await createNotification({
                application_id: appId,
                user_email: app.email,
                type: 'shipping_completed',
                icon: 'fa-shipping-fast',
                message: `실물 교재가 발송되었습니다.${trackingNumber ? ` (운송장: ${trackingNumber})` : ''}`
            });
            
            alert('✅ 택배 발송이 완료되었습니다!');
            location.reload();
        } else {
            alert('❌ 발송 처리에 실패했습니다. 다시 시도해주세요.');
        }
    } catch (error) {
        console.error('Confirm shipping error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 관리자: 택배 관리 섹션 추가 (입금 확인 탭에)
function addShippingSection(app) {
    if (!app.deposit_confirmed_by_admin) {
        return ''; // 입금 확인 전에는 표시 안 함
    }
    
    // 이미 발송 완료했으면
    if (app.shipping_completed) {
        return `
            <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); padding: 32px; border-radius: 16px; border: 2px solid #6ee7b7; margin-top: 32px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <i class="fas fa-check-circle" style="font-size: 32px; color: #059669;"></i>
                    <div>
                        <h3 style="font-size: 20px; font-weight: 700; color: #065f46; margin: 0;">✅ 택배 발송 완료</h3>
                        <p style="font-size: 14px; color: #047857; margin: 8px 0 0 0;">
                            ${new Date(app.shipping_completed_at).toLocaleString('ko-KR')}에 발송되었습니다.
                        </p>
                    </div>
                </div>
                ${app.shipping_tracking_number ? `
                    <div style="background: white; padding: 16px; border-radius: 12px;">
                        <p style="margin: 0; font-size: 15px; color: #64748b;">
                            <strong style="color: #1e293b;">운송장 번호:</strong> ${app.shipping_tracking_number}
                        </p>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // 발송 대기 중
    return `
        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 32px; border-radius: 16px; border: 2px solid #fbbf24; margin-top: 32px;">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                <i class="fas fa-shipping-fast" style="font-size: 32px; color: #f59e0b;"></i>
                <div>
                    <h3 style="font-size: 20px; font-weight: 700; color: #92400e; margin: 0;">📦 택배 발송 관리</h3>
                    <p style="font-size: 14px; color: #78350f; margin: 8px 0 0 0;">
                        교재/자료를 발송하고 운송장 번호를 입력하세요.
                    </p>
                </div>
            </div>
            
            <div style="background: white; padding: 24px; border-radius: 12px;">
                <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 2px solid #e2e8f0; margin-bottom: 16px;">
                    <h4 style="font-size: 15px; font-weight: 600; color: #1e293b; margin: 0 0 12px 0;">배송 정보</h4>
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
                    </table>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 14px; color: #64748b; margin-bottom: 8px;">
                        운송장 번호 (선택사항)
                    </label>
                    <input type="text" 
                           id="trackingNumber_${app.id}" 
                           placeholder="예: 123456789012"
                           style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px;">
                </div>
                
                <button onclick="confirmShipping('${app.id}')" 
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

// ==================== 알림 관리 ====================

/**
 * 알림 생성 함수
 * @param {Object} notificationData - 알림 데이터
 * @param {string} notificationData.application_id - 신청서 ID
 * @param {string} notificationData.user_email - 사용자 이메일
 * @param {string} notificationData.type - 알림 타입 (guide_sent, payment_confirmed, shipping_completed 등)
 * @param {string} notificationData.icon - Font Awesome 아이콘 클래스
 * @param {string} notificationData.message - 알림 메시지
 */
async function createNotification(notificationData) {
    try {
        const response = await fetch('tables/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                application_id: notificationData.application_id,
                user_email: notificationData.user_email,
                type: notificationData.type,
                icon: notificationData.icon || 'fa-bell',
                message: notificationData.message,
                is_read: false,
                created_at: Date.now()
            })
        });

        if (!response.ok) {
            console.error('알림 생성 실패:', await response.text());
        }
    } catch (error) {
        console.error('알림 생성 중 오류:', error);
    }
}

