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

    // 0. 재시작(수강2) 계약서의 '수강1 계약서' 접힌 상자 자리 {{prev:contract}}
    //    다른 치환(자동변수·입력칸·따라쓰기)이 상자 안 글을 건드리지 않도록 표시만 바꿔 두고 맨 끝에 끼운다.
    const PREV_TOKEN = '@@PREV_CONTRACT_SLOT@@';
    const hasPrevSlot = html.indexOf(PREV_CONTRACT_MARKER) !== -1;
    if (hasPrevSlot) html = html.split(PREV_CONTRACT_MARKER).join(PREV_TOKEN);
    
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
    
    // 상자는 블록이라 바로 뒤 줄바꿈 하나는 지운다(본문이 pre-wrap 이라 빈 줄이 두 번 생김)
    if (hasPrevSlot) html = html.replace(new RegExp(PREV_TOKEN + '\r?\n?', 'g'), () => renderPrevContractBox(studentData.__prevContract));
    
    return html;
}

// ==================== 재시작(수강2) — 수강1 계약서 접힌 상자 ====================

const PREV_CONTRACT_MARKER = '{{prev:contract}}';

/**
 * 수강2 신청서의 수강1 계약서(서명 저장본 + 학생이 입력한 값)를 불러온다.
 * 반환: { snapshot, inputs } / 수강1을 못 찾으면 { missing: true }
 */
async function loadPrevContractForApp(app) {
    try {
        if (!app || !app.restart_of || typeof supabaseAPI === 'undefined') return { missing: true };
        const prev = await supabaseAPI.getById('applications', app.restart_of);
        if (!prev) return { missing: true };
        let inputs = prev.contract_inputs || {};
        if (typeof inputs === 'string') { try { inputs = JSON.parse(inputs); } catch (e) { inputs = {}; } }
        return { snapshot: prev.contract_snapshot || '', inputs: inputs || {} };
    } catch (e) {
        console.warn('[restart] 수강1 계약서 불러오기 실패:', e);
        return { missing: true };
    }
}

/** 계약서 글에 수강1 상자 자리가 있으면 수강1 계약서를 불러와 studentData.__prevContract 에 넣는다 */
async function attachPrevContract(template, app, studentData) {
    if (template && template.indexOf(PREV_CONTRACT_MARKER) !== -1) {
        studentData.__prevContract = await loadPrevContractForApp(app);
    }
    return studentData;
}

function _prevEsc(t) {
    return String(t === null || t === undefined ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * 수강1 저장본을 읽기 전용 글로 그린다. 입력칸·따라쓰기 칸 자리에는 학생이 수강1 때 쓴 값을 글자로 채운다.
 * 따라쓰기 값의 이름표는 parseContractTemplate 와 같은 규칙(입력칸 먼저 센 뒤 이어서 번호)으로 만든다.
 */
function renderPrevContractText(snapshot, inputs) {
    inputs = inputs || {};
    const filled = (v) => '<span class="prev-filled">' + _prevEsc(v) + '</span>';
    const parts = [];
    const re = /\{\{(input|copy):([^}]+)\}\}/g;
    const inputCount = (snapshot.match(/\{\{input:([^:]+):([^}]+)\}\}/g) || []).length;
    let copyNo = 0, last = 0, m;
    while ((m = re.exec(snapshot)) !== null) {
        parts.push(_prevEsc(snapshot.slice(last, m.index)));
        if (m[1] === 'input') {
            const fieldId = m[2].split(':')[0];
            const v = inputs[fieldId];
            parts.push(v ? filled(v) : '<span class="prev-empty">(미입력)</span>');
        } else {
            copyNo++;
            const answer = m[2];
            const fieldId = 'copy_' + (inputCount + copyNo - 1) + '_' + answer.substring(0, 10).replace(/\s/g, '_');
            parts.push(filled(inputs[fieldId] || answer));
        }
        last = re.lastIndex;
    }
    parts.push(_prevEsc(snapshot.slice(last)));
    return parts.join('');
}

/**
 * 접힌 상자 HTML. 계약서 본문이 white-space: pre-wrap 이라 줄바꿈 없이 한 줄로 만든다.
 * prev 가 없으면(계약서 관리 미리보기) 안내만, missing/빈 저장본이면 보관 없음 안내.
 */
function renderPrevContractBox(prev) {
    const summary = '<summary class="prev-contract-summary"><span class="prev-contract-arrow">▸</span> 수강1 계약서 본문 — 수강1 때 이미 체결한 계약으로 본 계약에 의해 수정되지 않으며, 수강2에도 그대로 적용됩니다. <span class="prev-contract-open">펼쳐서 읽기</span></summary>';
    let inner;
    if (prev === undefined) {
        inner = '<div class="prev-contract-note">여기에 학생의 수강1 계약서(서명 당시 저장본과 학생이 작성한 내용)가 들어갑니다.</div>';
    } else if (!prev || prev.missing || !String(prev.snapshot || '').trim()) {
        inner = '<div class="prev-contract-note">수강1 계약서 원본이 보관되어 있지 않아 표시할 수 없습니다. 필요하면 이온 카카오톡 채널로 요청해 주세요.</div>';
    } else {
        inner = '<div class="prev-contract-note"><i class="fas fa-lock"></i> 수강1 때 학생이 작성·서명한 내용입니다. 다시 입력하거나 수정할 수 없습니다.</div>'
              + '<div class="prev-contract-body">' + renderPrevContractText(String(prev.snapshot), prev.inputs) + '</div>';
    }
    return '<details class="prev-contract">' + summary + inner + '</details>';
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
 * 렌더링 후 넘치는 따라쓰기/자유입력 필드 너비 보정
 * - DOM에 계약서가 삽입된 후 호출
 * - 부모 블록을 넘치는 input만 줄여줌 (정상 크기는 그대로)
 */
function fixContractInputOverflow() {
    document.querySelectorAll('.copywrite-container').forEach(container => {
        const parent = container.parentElement;
        if (!parent) return;
        const parentWidth = parent.getBoundingClientRect().width;
        const containerWidth = container.getBoundingClientRect().width;
        
        if (containerWidth > parentWidth) {
            const input = container.querySelector('.contract-input-copy');
            if (input) {
                input.style.width = parentWidth + 'px';
            }
        }
    });
    
    document.querySelectorAll('.contract-input-free').forEach(input => {
        const parent = input.parentElement;
        if (!parent) return;
        const parentWidth = parent.getBoundingClientRect().width;
        const inputWidth = input.getBoundingClientRect().width;
        
        if (inputWidth > parentWidth) {
            input.style.width = parentWidth + 'px';
            input.style.minWidth = '0';
        }
    });
}

/**
 * 계약서 미리보기용 샘플 데이터
 */
function getContractSampleData(contractType) {
    const isCorrection = contractType === 'correction' || contractType === 'restart_correction';
    const isRestart = contractType === 'restart' || contractType === 'restart_correction';
    return {
        name: '홍길동',
        email: 'hong@example.com',
        phone: '010-1234-5678',
        assigned_program: isCorrection ? '내벨업챌린지 - Fast + 스라첨삭' : '내벨업챌린지 - Fast',
        schedule_start: '2026-02-16',
        schedule_end: '2026-03-15',
        final_price: isRestart ? (isCorrection ? '300,000' : '100,000') : (isCorrection ? '1,090,000' : '890,000'),
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
            
            .prev-contract { margin: 12px 0; border: 1.5px solid #e7dce7; border-radius: 12px; background: #faf7fa; white-space: normal; }
            .prev-contract-summary { cursor: pointer; list-style: none; padding: 14px 16px; font-size: 14px; font-weight: 600; color: #5b4a7d; line-height: 1.6; }
            .prev-contract-summary::-webkit-details-marker { display: none; }
            .prev-contract-arrow { display: inline-block; transition: transform 0.15s; }
            .prev-contract[open] .prev-contract-arrow { transform: rotate(90deg); }
            .prev-contract-open { font-size: 12px; font-weight: 600; color: #9480c5; margin-left: 4px; white-space: nowrap; }
            .prev-contract[open] .prev-contract-open { display: none; }
            .prev-contract-note { margin: 0 16px 12px; padding: 10px 12px; background: #efeaf7; border-radius: 8px; font-size: 13px; color: #5b4a7d; line-height: 1.6; }
            .prev-contract-body { margin: 0 16px 16px; padding: 16px; background: #ffffff; border: 1px dashed #d8cbe0; border-radius: 8px; white-space: pre-wrap; font-size: 13.5px; line-height: 1.8; color: #475569; max-height: 60vh; overflow-y: auto; }
            .prev-filled { color: #3b2d5c; font-weight: 600; background: #f1edf8; border-radius: 4px; padding: 1px 6px; }
            .prev-empty { color: #94a3b8; }
            
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
            
            @media (max-width: 768px) {
                .contract-content {
                    font-size: 13px;
                    line-height: 1.7;
                    padding: 20px;
                }
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
