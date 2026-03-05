// ===== Writing Arrange 문제 등록 모듈 =====
const WA_PREFIX = 'arrange_set_';
const WA_Q_COUNT = 10;

let waExistingSets = [];      // 기존 세트 ID 목록
let waNextSetNum = 1;         // 다음 세트 번호
let waEditMode = false;       // 수정 모드 여부
let waEditSetId = null;       // 수정 중인 세트 ID
let waAllExpanded = false;    // 전체 펼침 상태

// ===== 초기화 =====
function initWaQuestions() {
    const wrap = document.getElementById('waAccordionWrap');
    if (!wrap) return;
    let html = '';
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        html += `
        <div class="wa-q-block" data-q="${i}">
            <div class="wa-accordion-header" onclick="toggleWaQuestion(${i})">
                <i class="fas fa-chevron-right wa-q-chevron" id="waChevron${i}"></i>
                <span class="wa-q-label">Q${i}</span>
                <span class="wa-q-preview" id="waQPreview${i}">(미입력)</span>
            </div>
            <div class="wa-accordion-body" id="waQBody${i}">
                <div class="wa-field">
                    <label>힌트 문장 (영어) *</label>
                    <input type="text" id="waGiven${i}" placeholder="What did Rebecca ask about the meeting?" oninput="onWaInput(${i})">
                </div>
                <div class="wa-field">
                    <label>힌트 번역 (한글) *</label>
                    <input type="text" id="waGivenTrans${i}" placeholder="레베카가 회의에 대해 뭐라고 물었니?" oninput="onWaInput(${i})">
                </div>
                <div class="wa-field">
                    <label>화면 표시 * <span class="wa-hint">주어진 단어 + 빈칸(_)을 파이프로 구분</span></label>
                    <input type="text" class="wa-pipe-input" id="waPresented${i}" placeholder="She|_|_|_|_|_|_|_" oninput="onWaInput(${i})">
                </div>
                <div class="wa-field">
                    <label>보기 단어 * <span class="wa-hint">정답+오답 섞어서 파이프 구분</span></label>
                    <input type="text" class="wa-pipe-input" id="waOptions${i}" placeholder="the|was|prepared|to know|agenda|I|if|wanted" oninput="onWaInput(${i})">
                </div>
                <div class="wa-field">
                    <label>정답 단어 배열 * <span class="wa-hint">파이프(|) 구분, 순서대로</span></label>
                    <input type="text" class="wa-pipe-input" id="waAnswer${i}" placeholder="wanted|to know|if|I|prepared|the|agenda" oninput="onWaInput(${i})">
                </div>
                <div class="wa-field">
                    <label>정답 번역 (한글) *</label>
                    <input type="text" id="waAnswerTrans${i}" placeholder="그녀는 내가 안건을 준비했는지 알고 싶어 했어요." oninput="onWaInput(${i})">
                </div>
                <div class="wa-field">
                    <label>문장 끝 부호</label>
                    <div class="wa-punct-row">
                        <label><input type="radio" name="waPunct${i}" value="." checked> . 마침표</label>
                        <label><input type="radio" name="waPunct${i}" value="?"> ? 물음표</label>
                    </div>
                </div>
                <div class="wa-field">
                    <label>해설 <span class="wa-hint">(선택)</span></label>
                    <textarea id="waExplain${i}" rows="2" placeholder="문법 해설 등"></textarea>
                </div>
                <div class="wa-preview-box" id="waPreview${i}">
                    <div class="wa-pv-label">📋 실시간 미리보기</div>
                    <div style="color:#94a3b8; font-size:12px;">입력하면 미리보기가 표시됩니다.</div>
                </div>
            </div>
        </div>`;
    }
    wrap.innerHTML = html;
}

// ===== 아코디언 =====
function toggleWaQuestion(num) {
    const header = document.querySelector(`.wa-q-block[data-q="${num}"] .wa-accordion-header`);
    const body = document.getElementById(`waQBody${num}`);
    const isOpen = body.classList.toggle('open');
    header.classList.toggle('open', isOpen);
}

function toggleAllWaQuestions() {
    waAllExpanded = !waAllExpanded;
    const btn = document.querySelector('.wa-toggle-all-btn');
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        const header = document.querySelector(`.wa-q-block[data-q="${i}"] .wa-accordion-header`);
        const body = document.getElementById(`waQBody${i}`);
        if (waAllExpanded) {
            body.classList.add('open');
            header.classList.add('open');
        } else {
            body.classList.remove('open');
            header.classList.remove('open');
        }
    }
    btn.innerHTML = waAllExpanded
        ? '<i class="fas fa-compress-arrows-alt"></i> 전체 접기'
        : '<i class="fas fa-expand-arrows-alt"></i> 전체 펼치기';
}

// ===== 입력 이벤트 =====
function onWaInput(num) {
    updateWaPreview(num);
    updateWaQHeader(num);
    updateWaRegisterBtn();
}

function updateWaQHeader(num) {
    const given = document.getElementById(`waGiven${num}`)?.value.trim() || '';
    const preview = document.getElementById(`waQPreview${num}`);
    preview.textContent = given || '(미입력)';
    preview.style.color = given ? '#475569' : '#94a3b8';
}

// ===== 세트 번호 관리 =====
function getWaSetNum() {
    return String(waNextSetNum).padStart(4, '0');
}

function getWaSetId() {
    return `${WA_PREFIX}${getWaSetNum()}`;
}

function updateWaSetDisplay() {
    const el = document.getElementById('waSetId');
    if (waEditMode) {
        el.textContent = waEditSetId;
    } else {
        el.textContent = getWaSetId();
    }
}

// ===== 기존 세트 로드 =====
async function loadWaExistingSets() {
    try {
        const result = await supabaseAPI.query('tr_writing_arrange', {
            'select': 'set_id',
            'order': 'set_id.asc',
            'limit': '500'
        });
        // 중복 제거
        const setIds = [...new Set((result || []).map(r => r.set_id))];
        waExistingSets = setIds;

        // 다음 번호 계산
        if (setIds.length > 0) {
            const lastId = setIds[setIds.length - 1];
            const lastNum = parseInt(lastId.replace(WA_PREFIX, ''));
            waNextSetNum = lastNum + 1;
        } else {
            waNextSetNum = 1;
        }

        renderWaSetList();
        updateWaSetDisplay();
        resetWaForm();
    } catch (err) {
        console.error('Arrange 세트 목록 로드 실패:', err);
    }
}

function renderWaSetList() {
    const wrap = document.getElementById('waSetList');
    if (!wrap) return;

    let html = '';
    waExistingSets.forEach(sid => {
        const num = sid.replace(WA_PREFIX, '');
        const activeClass = (waEditMode && waEditSetId === sid) ? ' active' : '';
        html += `<button class="wa-set-item${activeClass}" onclick="editWaSet('${sid}')" title="${sid}">
            ${num}
        </button>`;
    });
    html += `<button class="wa-set-item wa-set-item-new${!waEditMode ? ' active' : ''}" onclick="cancelWaEdit()">
        <i class="fas fa-plus"></i> 신규
    </button>`;
    wrap.innerHTML = html;
}

// ===== 미리보기 =====
function updateWaPreview(num) {
    const box = document.getElementById(`waPreview${num}`);
    if (!box) return;

    const given = document.getElementById(`waGiven${num}`)?.value.trim() || '';
    const givenTrans = document.getElementById(`waGivenTrans${num}`)?.value.trim() || '';
    const answer = document.getElementById(`waAnswer${num}`)?.value.trim() || '';
    const answerTrans = document.getElementById(`waAnswerTrans${num}`)?.value.trim() || '';
    const presented = document.getElementById(`waPresented${num}`)?.value.trim() || '';
    const options = document.getElementById(`waOptions${num}`)?.value.trim() || '';
    const punct = document.querySelector(`input[name="waPunct${num}"]:checked`)?.value || '.';

    if (!given && !answer && !presented) {
        box.innerHTML = `<div class="wa-pv-label">📋 실시간 미리보기</div>
            <div style="color:#94a3b8; font-size:12px;">입력하면 미리보기가 표시됩니다.</div>`;
        return;
    }

    const answerParts = answer ? answer.split('|') : [];
    const presentedParts = presented ? presented.split('|') : [];
    const optionParts = options ? options.split('|') : [];

    // 빈칸 개수 세기
    const blankCount = presentedParts.filter(w => w.trim() === '_').length;
    const answerCount = answerParts.length;

    // 경고 메시지 수집
    let warnings = [];
    if (presented && answer && blankCount !== answerCount) {
        warnings.push(`⚠️ 빈칸 ${blankCount}개인데 정답 단어가 ${answerCount}개입니다`);
    }
    if (answer && options) {
        answerParts.forEach(aw => {
            const trimmed = aw.trim();
            if (trimmed && !optionParts.some(o => o.trim() === trimmed)) {
                warnings.push(`⚠️ 정답 단어 '${trimmed}'가 보기에 없습니다`);
            }
        });
    }

    // 문장 구조 렌더
    let sentenceHtml = '';
    presentedParts.forEach(w => {
        const t = w.trim();
        if (t === '_') {
            sentenceHtml += `<span class="wa-pv-word blank">___</span>`;
        } else {
            sentenceHtml += `<span class="wa-pv-word given">${escapeHtml(t)}</span>`;
        }
    });
    if (sentenceHtml) {
        sentenceHtml += `<span class="wa-pv-word punct">${escapeHtml(punct)}</span>`;
    }

    // 보기 칩
    let optionsHtml = '';
    optionParts.forEach(o => {
        const t = o.trim();
        if (t) optionsHtml += `<span class="wa-pv-chip">${escapeHtml(t)}</span>`;
    });

    // 정답 조합
    let fullAnswer = '';
    if (presented && answer) {
        let ai = 0;
        const parts = [];
        presentedParts.forEach(w => {
            const t = w.trim();
            if (t === '_') {
                parts.push(answerParts[ai] ? answerParts[ai].trim() : '???');
                ai++;
            } else {
                parts.push(t);
            }
        });
        fullAnswer = parts.join(' ') + punct;
    }

    let html = `<div class="wa-pv-label">📋 실시간 미리보기</div>`;
    if (given) html += `<div class="wa-pv-hint">📖 ${escapeHtml(given)}</div>`;
    if (givenTrans) html += `<div class="wa-pv-hint-trans">📝 ${escapeHtml(givenTrans)}</div>`;
    if (sentenceHtml) html += `<div class="wa-pv-sentence">${sentenceHtml}</div>`;
    if (optionsHtml) html += `<div class="wa-pv-options">${optionsHtml}</div>`;
    if (fullAnswer) html += `<div class="wa-pv-answer">✅ 정답: ${escapeHtml(fullAnswer)}</div>`;
    if (answerTrans) html += `<div class="wa-pv-answer-trans">📝 ${escapeHtml(answerTrans)}</div>`;
    warnings.forEach(w => {
        html += `<div class="wa-pv-warn"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(w)}</div>`;
    });

    box.innerHTML = html;
}

// ===== 유효성 검증 =====
function validateWaForm() {
    const errors = [];
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        const given = document.getElementById(`waGiven${i}`)?.value.trim();
        const givenTrans = document.getElementById(`waGivenTrans${i}`)?.value.trim();
        const answer = document.getElementById(`waAnswer${i}`)?.value.trim();
        const answerTrans = document.getElementById(`waAnswerTrans${i}`)?.value.trim();
        const presented = document.getElementById(`waPresented${i}`)?.value.trim();
        const options = document.getElementById(`waOptions${i}`)?.value.trim();

        if (!given) errors.push(`Q${i}: 힌트 문장을 입력해주세요`);
        if (!givenTrans) errors.push(`Q${i}: 힌트 번역을 입력해주세요`);
        if (!answer) errors.push(`Q${i}: 정답 단어 배열을 입력해주세요`);
        if (!answerTrans) errors.push(`Q${i}: 정답 번역을 입력해주세요`);
        if (!presented) errors.push(`Q${i}: 화면 표시를 입력해주세요`);
        if (!options) errors.push(`Q${i}: 보기 단어를 입력해주세요`);

        if (answer && presented) {
            const answerParts = answer.split('|');
            const blankCount = presented.split('|').filter(w => w.trim() === '_').length;
            if (blankCount !== answerParts.length) {
                errors.push(`Q${i}: 빈칸 ${blankCount}개, 정답 단어 ${answerParts.length}개 — 불일치`);
            }
        }
        if (answer && options) {
            const answerParts = answer.split('|');
            const optionParts = options.split('|').map(o => o.trim());
            answerParts.forEach(aw => {
                const t = aw.trim();
                if (t && !optionParts.includes(t)) {
                    errors.push(`Q${i}: 정답 단어 '${t}'가 보기에 없습니다`);
                }
            });
        }
    }
    return errors;
}

function updateWaRegisterBtn() {
    const btn = document.getElementById('waRegisterBtn');
    if (!btn) return;
    const errors = validateWaForm();
    btn.disabled = errors.length > 0;
}

// ===== 페이로드 빌드 =====
function buildWaPayload() {
    const setId = waEditMode ? waEditSetId : getWaSetId();
    const rows = [];

    for (let i = 1; i <= WA_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        const punct = document.querySelector(`input[name="waPunct${i}"]:checked`)?.value || '.';
        rows.push({
            id: `${setId}_q${qi}`,
            set_id: setId,
            question_num: i,
            given_sentence: document.getElementById(`waGiven${i}`)?.value.trim() || '',
            given_translation: document.getElementById(`waGivenTrans${i}`)?.value.trim() || '',
            correct_answer: document.getElementById(`waAnswer${i}`)?.value.trim() || '',
            correct_translation: document.getElementById(`waAnswerTrans${i}`)?.value.trim() || '',
            presented_words: document.getElementById(`waPresented${i}`)?.value.trim() || '',
            option_words: document.getElementById(`waOptions${i}`)?.value.trim() || '',
            end_punctuation: punct,
            explanation: document.getElementById(`waExplain${i}`)?.value.trim() || '',
            week: '',
            day: ''
        });
    }
    return rows;
}

// ===== 신규 등록 =====
async function registerWaSet() {
    const errors = validateWaForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('waRegisterBtn');
    const rows = buildWaPayload();
    const setId = rows[0].set_id;

    if (waEditMode) {
        // 수정 모드: DELETE + INSERT
        if (!confirm(`"${setId}" 세트를 수정합니다.\n기존 10문제를 삭제 후 새로 저장합니다.\n\n계속하시겠습니까?`)) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';

        try {
            // 1) 기존 삭제
            const delUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange?set_id=eq.${setId}`;
            const delRes = await fetch(delUrl, {
                method: 'DELETE',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);

            // 2) 새로 삽입
            const postUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange`;
            const postRes = await fetch(postUrl, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(rows)
            });
            if (!postRes.ok) {
                const err = await postRes.json();
                throw new Error(err.message || `저장 실패: ${postRes.status}`);
            }

            alert(`✅ "${setId}" 수정 완료!`);
            await loadWaExistingSets();
        } catch (err) {
            console.error('Arrange 수정 실패:', err);
            alert('❌ 수정 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        }
    } else {
        // 신규 모드: 중복 확인 + INSERT
        if (waExistingSets.includes(setId)) {
            alert(`❌ "${setId}"는 이미 존재합니다.`);
            return;
        }
        if (!confirm(`"${setId}" 세트를 새로 등록합니다.\n10문제가 저장됩니다.\n\n계속하시겠습니까?`)) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';

        try {
            const postUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange`;
            const postRes = await fetch(postUrl, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(rows)
            });
            if (!postRes.ok) {
                const err = await postRes.json();
                throw new Error(err.message || `저장 실패: ${postRes.status}`);
            }

            alert(`✅ "${setId}" 등록 완료!`);
            await loadWaExistingSets();
        } catch (err) {
            console.error('Arrange 등록 실패:', err);
            alert('❌ 등록 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        }
    }
}

// ===== 수정 모드 =====
async function editWaSet(setId) {
    try {
        const result = await supabaseAPI.query('tr_writing_arrange', {
            'set_id': `eq.${setId}`,
            'order': 'question_num.asc',
            'limit': '10'
        });

        if (!result || result.length === 0) {
            alert('세트 데이터를 찾을 수 없습니다.');
            return;
        }

        waEditMode = true;
        waEditSetId = setId;
        document.getElementById('waEditBadge').style.display = 'inline';
        document.getElementById('waCancelEditBtn').style.display = 'inline-flex';
        updateWaSetDisplay();
        renderWaSetList();

        // 폼 채우기
        result.forEach((row, idx) => {
            const i = idx + 1;
            setVal(`waGiven${i}`, row.given_sentence || '');
            setVal(`waGivenTrans${i}`, row.given_translation || '');
            setVal(`waAnswer${i}`, row.correct_answer || '');
            setVal(`waAnswerTrans${i}`, row.correct_translation || '');
            setVal(`waPresented${i}`, row.presented_words || '');
            setVal(`waOptions${i}`, row.option_words || '');
            setVal(`waExplain${i}`, row.explanation || '');

            // 끝 부호
            const punct = row.end_punctuation || '.';
            const radio = document.querySelector(`input[name="waPunct${i}"][value="${punct}"]`);
            if (radio) radio.checked = true;

            updateWaPreview(i);
            updateWaQHeader(i);
        });

        updateWaRegisterBtn();

        // 삭제 버튼 추가
        addWaDeleteBtn(setId);

    } catch (err) {
        console.error('Arrange 세트 로드 실패:', err);
        alert('❌ 로드 실패: ' + err.message);
    }
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function addWaDeleteBtn(setId) {
    // 기존 삭제 버튼 제거
    const old = document.getElementById('waDeleteBtn');
    if (old) old.remove();

    const actions = document.querySelector('.wa-actions');
    if (!actions) return;

    const btn = document.createElement('button');
    btn.id = 'waDeleteBtn';
    btn.className = 'wa-action-btn wa-btn-delete';
    btn.innerHTML = '<i class="fas fa-trash"></i> 세트 삭제';
    btn.style.marginLeft = 'auto';
    btn.onclick = () => deleteWaSet(setId);
    actions.appendChild(btn);
}

// ===== 취소 =====
function cancelWaEdit() {
    waEditMode = false;
    waEditSetId = null;
    document.getElementById('waEditBadge').style.display = 'none';
    document.getElementById('waCancelEditBtn').style.display = 'none';

    const delBtn = document.getElementById('waDeleteBtn');
    if (delBtn) delBtn.remove();

    resetWaForm();
    updateWaSetDisplay();
    renderWaSetList();
}

function resetWaForm() {
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        setVal(`waGiven${i}`, '');
        setVal(`waGivenTrans${i}`, '');
        setVal(`waAnswer${i}`, '');
        setVal(`waAnswerTrans${i}`, '');
        setVal(`waPresented${i}`, '');
        setVal(`waOptions${i}`, '');
        setVal(`waExplain${i}`, '');

        const dotRadio = document.querySelector(`input[name="waPunct${i}"][value="."]`);
        if (dotRadio) dotRadio.checked = true;

        updateWaPreview(i);
        updateWaQHeader(i);

        // 아코디언 접기
        const header = document.querySelector(`.wa-q-block[data-q="${i}"] .wa-accordion-header`);
        const body = document.getElementById(`waQBody${i}`);
        if (header) header.classList.remove('open');
        if (body) body.classList.remove('open');
    }
    waAllExpanded = false;
    const toggleBtn = document.querySelector('.wa-toggle-all-btn');
    if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i> 전체 펼치기';

    updateWaRegisterBtn();
}

// ===== 삭제 =====
async function deleteWaSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제합니다.\n10문제가 모두 삭제되며 복구할 수 없습니다.\n\n계속하시겠습니까?`)) return;

    try {
        const delUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange?set_id=eq.${setId}`;
        const delRes = await fetch(delUrl, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);

        alert(`✅ "${setId}" 삭제 완료!`);
        cancelWaEdit();
        await loadWaExistingSets();
    } catch (err) {
        console.error('Arrange 삭제 실패:', err);
        alert('❌ 삭제 실패: ' + err.message);
    }
}

// ===== 페이지 로드 시 초기화 =====
initWaQuestions();
