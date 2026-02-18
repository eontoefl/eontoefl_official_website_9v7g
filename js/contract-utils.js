// ==================== 계약서 파싱 및 렌더링 유틸리티 ====================

console.log('contract-utils.js loaded');

/**
 * 계약서 템플릿을 파싱하여 학생용 HTML로 변환
 * @param {string} template - 계약서 템플릿
 * @param {object} studentData - 학생 데이터
 * @returns {string} 렌더링된 HTML
 */
function parseContractTemplate(template, studentData = {}) {
    if (!template) return '';
    
    let html = template;
    let inputCounter = 0;
    
    // 1. 자동 변수 치환 {변수}
    html = html.replace(/{(\w+)}/g, (match, varName) => {
        const value = studentData[varName] || '';
        return `<span class="auto-fill">${escapeHtml(value)}</span>`;
    });
    
    // 2. 자유 입력 빈칸 {{input:id:placeholder}}
    html = html.replace(/\{\{input:([^:]+):([^}]+)\}\}/g, (match, fieldId, placeholder) => {
        inputCounter++;
        return `<input type="text" 
                       class="contract-input contract-input-free" 
                       name="contract_${fieldId}" 
                       data-field-id="${fieldId}"
                       placeholder="${escapeHtml(placeholder)}" 
                       required
                       style="display: inline-block; min-width: 200px; padding: 4px 8px; border: none; border-bottom: 2px solid #3b82f6; background: #f0f9ff; font-family: inherit; font-size: inherit;">`;
    });
    
    // 3. 따라쓰기 빈칸 {{copy:내용}}
    html = html.replace(/\{\{copy:([^}]+)\}\}/g, (match, answer) => {
        inputCounter++;
        const displayId = `copy_${inputCounter}`;
        const minWidth = Math.max(answer.length * 16 + 40, 180); // 자동 너비 계산
        
        // 고유 fieldId 생성 (저장/불러오기용)
        const fieldId = `copy_${inputCounter - 1}_${answer.substring(0, 10).replace(/\s/g, '_')}`;
        
        return `<span class="copywrite-container" style="position: relative; display: inline-block; background: linear-gradient(to right, #fef3c7 0%, #fefce8 100%); border-radius: 4px; padding: 0;">
                    <span class="copywrite-hint" 
                          id="${displayId}"
                          style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #d1d5db; pointer-events: none; z-index: 1; font-family: inherit; font-size: inherit; white-space: pre;">${escapeHtml(answer)}</span>
                    <input type="text" 
                           class="contract-input contract-input-copy" 
                           data-answer="${escapeHtml(answer)}"
                           data-field-id="${fieldId}"
                           data-display-id="${displayId}"
                           placeholder=""
                           required
                           oninput="validateCopywrite(this)"
                           style="display: inline-block; width: ${minWidth}px; max-width: 100%; padding: 4px 8px; border: none; border-bottom: 2px solid #eab308; background: transparent; font-family: inherit; font-size: inherit; position: relative; z-index: 2; letter-spacing: 0.02em; color: #1e293b;">
                    <span class="copywrite-status" style="margin-left: 8px; display: inline-block; vertical-align: middle;"></span>
                </span>`;
    });
    
    return html;
}

/**
 * 따라쓰기 실시간 검증
 * @param {HTMLInputElement} input - 입력 필드
 */
function validateCopywrite(input) {
    const answer = input.dataset.answer;
    const value = input.value;
    const container = input.closest('.copywrite-container');
    const status = container.querySelector('.copywrite-status');
    const hint = document.getElementById(input.dataset.displayId);
    
    // 입력된 글자만큼 힌트를 가리고 나머지는 보이게
    if (value.length > 0) {
        // 입력된 글자 수만큼 앞부분을 투명하게, 나머지는 보이게
        const typedPart = answer.substring(0, value.length);
        const remainingPart = answer.substring(value.length);
        
        hint.innerHTML = `<span style="opacity: 0;">${escapeHtml(typedPart)}</span><span style="opacity: 0.4; color: #9ca3af;">${escapeHtml(remainingPart)}</span>`;
    } else {
        // 입력이 없으면 전체 힌트 표시
        hint.innerHTML = escapeHtml(answer);
        hint.style.opacity = '1';
        hint.style.color = '#d1d5db';
    }
    
    // 입력 필드 너비 자동 조절
    const minWidth = Math.max(answer.length * 16 + 40, 180);
    const currentWidth = Math.max(value.length * 16 + 40, minWidth);
    input.style.width = `${currentWidth}px`;
    
    // 검증
    if (value === answer) {
        // 정답
        input.style.borderBottom = '2px solid #22c55e';
        container.style.background = 'linear-gradient(to right, #dcfce7 0%, #f0fdf4 100%)';
        status.innerHTML = '<i class="fas fa-check-circle" style="color: #22c55e;"></i>';
        input.dataset.valid = 'true';
    } else if (value.length > 0) {
        // 오답 (부분 일치 체크)
        const isPartialMatch = answer.startsWith(value);
        
        if (isPartialMatch) {
            // 부분적으로 맞음 (계속 입력 중)
            input.style.borderBottom = '2px solid #eab308';
            container.style.background = 'linear-gradient(to right, #fef3c7 0%, #fefce8 100%)';
            status.innerHTML = '<i class="fas fa-pen" style="color: #eab308;"></i>';
            input.dataset.valid = 'false';
        } else {
            // 완전 오답
            input.style.borderBottom = '2px solid #ef4444';
            container.style.background = 'linear-gradient(to right, #fee2e2 0%, #fef2f2 100%)';
            status.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
            input.dataset.valid = 'false';
        }
    } else {
        // 미입력
        input.style.borderBottom = '2px solid #eab308';
        container.style.background = 'linear-gradient(to right, #fef3c7 0%, #fefce8 100%)';
        status.innerHTML = '';
        input.dataset.valid = 'false';
    }
}

/**
 * 계약서 입력값 검증
 * @returns {object} { valid: boolean, errors: string[], inputs: object }
 */
function validateContractInputs() {
    const errors = [];
    const inputs = {};
    
    // 1. 자유 입력 필드 검증
    const freeInputs = document.querySelectorAll('.contract-input-free');
    freeInputs.forEach(input => {
        const fieldId = input.dataset.fieldId;
        const value = input.value.trim();
        
        if (!value) {
            errors.push(`"${input.placeholder}" 항목을 입력해주세요.`);
        } else {
            inputs[fieldId] = value;
        }
    });
    
    // 2. 따라쓰기 필드 검증 및 저장
    const copyInputs = document.querySelectorAll('.contract-input-copy');
    copyInputs.forEach((input, index) => {
        const answer = input.dataset.answer;
        const value = input.value.trim();
        
        // HTML에 이미 있는 data-field-id 사용
        const fieldId = input.dataset.fieldId;
        
        if (!value) {
            errors.push(`"${answer}"를 정확히 입력해주세요.`);
        } else if (value !== answer) {
            errors.push(`"${answer}"를 정확히 입력해주세요. (현재 입력: "${value}")`);
        } else {
            // 검증 통과하면 저장
            inputs[fieldId] = value;
        }
    });
    
    return {
        valid: errors.length === 0,
        errors: errors,
        inputs: inputs
    };
}

/**
 * 계약서 미리보기용 샘플 데이터
 */
function getContractSampleData() {
    return {
        name: '홍길동',
        email: 'hong@example.com',
        phone: '010-1234-5678',
        assigned_program: '내벨업챌린지 - Fast',
        schedule_start: '2026-02-16',
        schedule_end: '2026-03-15',
        final_price: '890,000',
        contract_date: '2026-02-13'
    };
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * 계약서 CSS 스타일
 */
function getContractStyles() {
    return `
        <style>
            .contract-content {
                padding: 40px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                line-height: 1.8;
                font-size: 15px;
                color: #1e293b;
            }
            
            .auto-fill {
                color: #9480c5;
                font-weight: 600;
                background: #f3f0ff;
                padding: 2px 6px;
                border-radius: 4px;
            }
            
            .contract-input {
                transition: all 0.3s ease;
            }
            
            .contract-input:focus {
                outline: none;
                transform: scale(1.02);
            }
            
            .contract-input-free:focus {
                border-bottom-color: #3b82f6;
                background: #dbeafe;
            }
            
            .copywrite-container {
                white-space: nowrap;
                display: inline-block;
                position: relative;
            }
            
            .copywrite-hint {
                transition: none;
                user-select: none;
            }
            
            @media print {
                .contract-input {
                    border: none !important;
                    background: transparent !important;
                }
                .copywrite-status {
                    display: none !important;
                }
            }
        </style>
    `;
}
