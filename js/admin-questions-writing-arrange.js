// ===== Writing Arrange 문제 등록 모듈 (인터랙티브 방식) =====
const WA_PREFIX = 'arrange_set_';
const WA_Q_COUNT = 10;

let waExistingSets = [];
let waNextSetNum = 1;
let waEditMode = false;
let waEditSetId = null;
let waAllExpanded = false;

// 각 문제별 상태 저장
// waQData[i] = { words: [{text, isGiven}], dummies: ['word1','word2'], punct: '.', ...}
let waQData = {};

// ===== 초기화 =====
function initWaQuestions() {
    const wrap = document.getElementById('waAccordionWrap');
    if (!wrap) return;
    let html = '';
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        waQData[i] = { words: [], dummies: [], punct: '.' };
        html += `
        <div class="wa-q-block" data-q="${i}">
            <div class="wa-accordion-header" onclick="toggleWaQuestion(${i})">
                <i class="fas fa-chevron-right wa-q-chevron" id="waChevron${i}"></i>
                <span class="wa-q-label">Q${i}</span>
                <span class="wa-q-preview" id="waQPreview${i}">(미입력)</span>
            </div>
            <div class="wa-accordion-body" id="waQBody${i}">
                <!-- Step 0: 힌트 -->
                <div class="wa-field">
                    <label>힌트 문장 (영어) *</label>
                    <input type="text" id="waHint${i}" placeholder="What did Rebecca ask about the meeting?" oninput="onWaHintInput(${i})">
                </div>
                <div class="wa-field">
                    <label>힌트 번역 (한글) *</label>
                    <input type="text" id="waHintTrans${i}" placeholder="레베카가 회의에 대해 뭐라고 물었니?">
                </div>

                <!-- Step 1: 정답 문장 입력 -->
                <div class="wa-field">
                    <label>정답 문장 * <span class="wa-hint">띄어쓰기로 자동 분리 · 붙여야 할 단어는 밑줄(_)로 연결 (예: to_know)</span></label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="waSentence${i}" placeholder="She wanted to_know if we could extend it" style="flex:1;" onkeydown="if(event.key==='Enter'){event.preventDefault();parseWaSentence(${i});}">
                        <button class="wa-action-btn wa-btn-parse" onclick="parseWaSentence(${i})">
                            <i class="fas fa-magic"></i> 분석
                        </button>
                    </div>
                </div>

                <!-- Step 2: 단어 선택 영역 -->
                <div class="wa-word-select-area" id="waWordArea${i}" style="display:none;">
                    <label style="font-size:12px; font-weight:600; color:#64748b; margin-bottom:6px; display:block;">
                        주어진 단어 선택 <span class="wa-hint">클릭하면 주어진 단어(회색)로 토글됩니다</span>
                    </label>
                    <div class="wa-word-chips" id="waWordChips${i}"></div>
                </div>

                <!-- Step 3: 더미(오답) 단어 추가 -->
                <div class="wa-dummy-area" id="waDummyArea${i}" style="display:none;">
                    <label style="font-size:12px; font-weight:600; color:#64748b; margin-bottom:6px; display:block;">
                        오답 단어 추가 <span class="wa-hint">학생을 헷갈리게 할 오답을 추가하세요</span>
                    </label>
                    <div style="display:flex; gap:8px; margin-bottom:8px;">
                        <input type="text" id="waDummyInput${i}" placeholder="예: wants" style="flex:1; max-width:200px;" onkeydown="if(event.key==='Enter'){event.preventDefault();addWaDummy(${i});}">
                        <button class="wa-action-btn wa-btn-dummy-add" onclick="addWaDummy(${i})">
                            <i class="fas fa-plus"></i> 추가
                        </button>
                    </div>
                    <div class="wa-dummy-chips" id="waDummyChips${i}"></div>
                </div>

                <!-- 정답 번역 -->
                <div class="wa-field" id="waTransArea${i}" style="display:none;">
                    <label>정답 번역 (한글) *</label>
                    <input type="text" id="waAnswerTrans${i}" placeholder="그녀는 우리가 그것을 연장할 수 있는지 알고 싶어 했어요." oninput="updateWaRegisterBtn()">
                </div>

                <!-- 해설 -->
                <div class="wa-field" id="waExplainArea${i}" style="display:none;">
                    <label>해설 <span class="wa-hint">(선택)</span></label>
                    <textarea id="waExplain${i}" rows="2" placeholder="문법 해설 등"></textarea>
                </div>

                <!-- 자동 생성 결과 + 미리보기 -->
                <div class="wa-preview-box" id="waPreview${i}">
                    <div class="wa-pv-label">📋 미리보기</div>
                    <div style="color:#94a3b8; font-size:12px;">정답 문장을 입력하고 [분석] 버튼을 누르세요.</div>
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

// ===== Step 1: 정답 문장 분석 =====
function parseWaSentence(num) {
    const input = document.getElementById(`waSentence${num}`);
    const raw = input?.value.trim();
    if (!raw) { alert('정답 문장을 입력해주세요.'); input?.focus(); return; }

    // 끝 부호 자동 감지
    let punct = '.';
    let sentence = raw;
    if (sentence.endsWith('?')) { punct = '?'; sentence = sentence.slice(0, -1).trim(); }
    else if (sentence.endsWith('.')) { sentence = sentence.slice(0, -1).trim(); }

    // 띄어쓰기로 분리
    const rawWords = sentence.split(/\s+/).filter(w => w);
    const words = rawWords.map(w => ({
        text: w.replace(/_/g, ' '),     // to_know → to know
        raw: w,                          // 원본 (밑줄 포함)
        isGiven: false
    }));

    waQData[num].words = words;
    waQData[num].punct = punct;
    // 기존 더미 유지

    renderWaWordChips(num);
    showWaSubAreas(num);
    updateWaPreview(num);
    updateWaQHeader(num);
    updateWaRegisterBtn();
}

function showWaSubAreas(num) {
    document.getElementById(`waWordArea${num}`).style.display = '';
    document.getElementById(`waDummyArea${num}`).style.display = '';
    document.getElementById(`waTransArea${num}`).style.display = '';
    document.getElementById(`waExplainArea${num}`).style.display = '';
}

// ===== Step 2: 단어 클릭 토글 =====
function renderWaWordChips(num) {
    const wrap = document.getElementById(`waWordChips${num}`);
    if (!wrap) return;
    const words = waQData[num].words;
    let html = '';
    words.forEach((w, idx) => {
        const cls = w.isGiven ? 'wa-chip-given' : 'wa-chip-blank';
        const label = w.isGiven ? '주어진' : '빈칸';
        html += `<button class="wa-chip ${cls}" onclick="toggleWaWord(${num},${idx})" title="${label}">
            ${escapeHtml(w.text)}
            <span class="wa-chip-badge">${label}</span>
        </button>`;
    });
    wrap.innerHTML = html;
}

function toggleWaWord(num, idx) {
    waQData[num].words[idx].isGiven = !waQData[num].words[idx].isGiven;
    renderWaWordChips(num);
    updateWaPreview(num);
    updateWaRegisterBtn();
}

// ===== Step 3: 더미(오답) 단어 =====
function addWaDummy(num) {
    const input = document.getElementById(`waDummyInput${num}`);
    const val = input?.value.trim();
    if (!val) return;
    waQData[num].dummies.push(val);
    input.value = '';
    renderWaDummyChips(num);
    updateWaPreview(num);
    updateWaRegisterBtn();
}

function removeWaDummy(num, idx) {
    waQData[num].dummies.splice(idx, 1);
    renderWaDummyChips(num);
    updateWaPreview(num);
    updateWaRegisterBtn();
}

function renderWaDummyChips(num) {
    const wrap = document.getElementById(`waDummyChips${num}`);
    if (!wrap) return;
    const dummies = waQData[num].dummies;
    if (dummies.length === 0) {
        wrap.innerHTML = '<span style="font-size:12px; color:#94a3b8;">추가된 오답 없음</span>';
        return;
    }
    let html = '';
    dummies.forEach((d, idx) => {
        html += `<span class="wa-chip wa-chip-dummy">
            ${escapeHtml(d)}
            <button class="wa-chip-remove" onclick="removeWaDummy(${num},${idx})" title="삭제">&times;</button>
        </span>`;
    });
    wrap.innerHTML = html;
}

// ===== 자동 생성 함수 =====
function getWaGenerated(num) {
    const data = waQData[num];
    if (!data || data.words.length === 0) return null;

    const words = data.words;
    const punct = data.punct;
    const dummies = data.dummies;

    // presented_words: 주어진 단어는 그대로, 나머지는 _
    const presented = words.map(w => w.isGiven ? w.text : '_').join('|');

    // correct_answer: 빈칸 단어만 순서대로
    const correctParts = words.filter(w => !w.isGiven).map(w => w.text);
    const correctAnswer = correctParts.join('|');

    // option_words: 정답 + 더미 섞기
    const allOptions = [...correctParts, ...dummies];
    const shuffled = shuffleArray([...allOptions]);
    const optionWords = shuffled.join('|');

    // 완성 문장
    const fullSentence = words.map(w => w.text).join(' ') + punct;

    return { presented, correctAnswer, optionWords, punct, fullSentence, correctParts };
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ===== 미리보기 =====
function updateWaPreview(num) {
    const box = document.getElementById(`waPreview${num}`);
    if (!box) return;

    const hint = document.getElementById(`waHint${num}`)?.value.trim() || '';
    const hintTrans = document.getElementById(`waHintTrans${num}`)?.value.trim() || '';
    const gen = getWaGenerated(num);

    if (!gen) {
        box.innerHTML = `<div class="wa-pv-label">📋 미리보기</div>
            <div style="color:#94a3b8; font-size:12px;">정답 문장을 입력하고 [분석] 버튼을 누르세요.</div>`;
        return;
    }

    const data = waQData[num];
    const words = data.words;
    const punct = data.punct;

    // 문장 구조
    let sentenceHtml = '';
    words.forEach(w => {
        if (w.isGiven) {
            sentenceHtml += `<span class="wa-pv-word given">${escapeHtml(w.text)}</span>`;
        } else {
            sentenceHtml += `<span class="wa-pv-word blank">___</span>`;
        }
    });
    sentenceHtml += `<span class="wa-pv-word punct">${escapeHtml(punct)}</span>`;

    // 보기 칩 (셔플된 상태)
    const optionArr = gen.optionWords.split('|');
    let optionsHtml = '';
    optionArr.forEach(o => {
        const t = o.trim();
        if (t) optionsHtml += `<span class="wa-pv-chip">${escapeHtml(t)}</span>`;
    });

    // 경고
    let warnings = [];
    if (gen.correctParts.length === 0) {
        warnings.push('⚠️ 빈칸이 없습니다 — 주어진 단어를 전부 선택하셨나요?');
    }
    if (data.dummies.length === 0) {
        warnings.push('💡 오답 단어를 추가하면 난이도가 올라갑니다');
    }

    const answerTrans = document.getElementById(`waAnswerTrans${num}`)?.value.trim() || '';

    let html = `<div class="wa-pv-label">📋 미리보기</div>`;
    if (hint) html += `<div class="wa-pv-hint">📖 ${escapeHtml(hint)}</div>`;
    if (hintTrans) html += `<div class="wa-pv-hint-trans">📝 ${escapeHtml(hintTrans)}</div>`;
    html += `<div class="wa-pv-sentence">${sentenceHtml}</div>`;
    if (optionsHtml) html += `<div style="font-size:11px; color:#64748b; margin-top:4px;">보기:</div><div class="wa-pv-options">${optionsHtml}</div>`;
    html += `<div class="wa-pv-answer">✅ 정답: ${escapeHtml(gen.fullSentence)}</div>`;
    if (answerTrans) html += `<div class="wa-pv-answer-trans">📝 ${escapeHtml(answerTrans)}</div>`;

    // 자동 생성 필드 표시 (디버그용, 접기)
    html += `<details style="margin-top:8px; font-size:11px; color:#94a3b8;">
        <summary style="cursor:pointer;">DB 저장값 확인</summary>
        <div style="margin-top:4px; font-family:monospace; font-size:11px; line-height:1.8; background:#f8fafc; padding:8px; border-radius:6px;">
            <div><strong>presented_words:</strong> ${escapeHtml(gen.presented)}</div>
            <div><strong>correct_answer:</strong> ${escapeHtml(gen.correctAnswer)}</div>
            <div><strong>option_words:</strong> ${escapeHtml(gen.optionWords)}</div>
            <div><strong>end_punctuation:</strong> ${escapeHtml(gen.punct)}</div>
        </div>
    </details>`;

    warnings.forEach(w => {
        const isInfo = w.startsWith('💡');
        html += `<div class="wa-pv-warn" style="${isInfo ? 'color:#f59e0b;' : ''}"><i class="fas fa-${isInfo ? 'info-circle' : 'exclamation-triangle'}"></i> ${w}</div>`;
    });

    box.innerHTML = html;
}

function onWaHintInput(num) {
    updateWaQHeader(num);
    updateWaPreview(num);
}

function updateWaQHeader(num) {
    const hint = document.getElementById(`waHint${num}`)?.value.trim() || '';
    const preview = document.getElementById(`waQPreview${num}`);
    if (hint) {
        preview.textContent = hint;
        preview.style.color = '#475569';
    } else {
        const gen = getWaGenerated(num);
        if (gen) {
            preview.textContent = gen.fullSentence;
            preview.style.color = '#475569';
        } else {
            preview.textContent = '(미입력)';
            preview.style.color = '#94a3b8';
        }
    }
}

// ===== 세트 번호 관리 =====
function getWaSetNum() { return String(waNextSetNum).padStart(4, '0'); }
function getWaSetId() { return `${WA_PREFIX}${getWaSetNum()}`; }

function updateWaSetDisplay() {
    const el = document.getElementById('waSetId');
    el.textContent = waEditMode ? waEditSetId : getWaSetId();
}

// ===== 기존 세트 로드 =====
async function loadWaExistingSets() {
    try {
        const result = await supabaseAPI.query('tr_writing_arrange', {
            'select': 'set_id',
            'order': 'set_id.asc',
            'limit': '500'
        });
        const setIds = [...new Set((result || []).map(r => r.set_id))];
        waExistingSets = setIds;

        if (setIds.length > 0) {
            const lastId = setIds[setIds.length - 1];
            waNextSetNum = parseInt(lastId.replace(WA_PREFIX, '')) + 1;
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
        html += `<button class="wa-set-item${activeClass}" onclick="editWaSet('${sid}')" title="${sid}">${num}</button>`;
    });
    html += `<button class="wa-set-item wa-set-item-new${!waEditMode ? ' active' : ''}" onclick="cancelWaEdit()">
        <i class="fas fa-plus"></i> 신규</button>`;
    wrap.innerHTML = html;
}

// ===== 유효성 검증 =====
function validateWaForm() {
    const errors = [];
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        const hint = document.getElementById(`waHint${i}`)?.value.trim();
        const hintTrans = document.getElementById(`waHintTrans${i}`)?.value.trim();
        const answerTrans = document.getElementById(`waAnswerTrans${i}`)?.value.trim();
        const gen = getWaGenerated(i);

        if (!hint) errors.push(`Q${i}: 힌트 문장을 입력해주세요`);
        if (!hintTrans) errors.push(`Q${i}: 힌트 번역을 입력해주세요`);
        if (!gen) errors.push(`Q${i}: 정답 문장을 입력하고 [분석]을 눌러주세요`);
        else if (gen.correctParts.length === 0) errors.push(`Q${i}: 빈칸이 없습니다 — 주어진 단어만 있으면 안 됩니다`);
        if (!answerTrans) errors.push(`Q${i}: 정답 번역을 입력해주세요`);
    }
    return errors;
}

function updateWaRegisterBtn() {
    const btn = document.getElementById('waRegisterBtn');
    if (!btn) return;
    btn.disabled = validateWaForm().length > 0;
}

// ===== 페이로드 빌드 =====
function buildWaPayload() {
    const setId = waEditMode ? waEditSetId : getWaSetId();
    const rows = [];
    for (let i = 1; i <= WA_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        const gen = getWaGenerated(i);
        rows.push({
            id: `${setId}_q${qi}`,
            set_id: setId,
            question_num: i,
            given_sentence: document.getElementById(`waHint${i}`)?.value.trim() || '',
            given_translation: document.getElementById(`waHintTrans${i}`)?.value.trim() || '',
            correct_answer: gen ? gen.correctAnswer : '',
            correct_translation: document.getElementById(`waAnswerTrans${i}`)?.value.trim() || '',
            presented_words: gen ? gen.presented : '',
            option_words: gen ? gen.optionWords : '',
            end_punctuation: gen ? gen.punct : '.',
            explanation: document.getElementById(`waExplain${i}`)?.value.trim() || '',
            week: '',
            day: ''
        });
    }
    return rows;
}

// ===== 신규 등록 / 수정 =====
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
        if (!confirm(`"${setId}" 세트를 수정합니다.\n기존 10문제를 삭제 후 새로 저장합니다.\n\n계속하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            const delUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange?set_id=eq.${setId}`;
            const delRes = await fetch(delUrl, { method: 'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' } });
            if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);

            const postUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange`;
            const postRes = await fetch(postUrl, { method: 'POST', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify(rows) });
            if (!postRes.ok) { const err = await postRes.json(); throw new Error(err.message || `저장 실패: ${postRes.status}`); }

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
        if (waExistingSets.includes(setId)) { alert(`❌ "${setId}"는 이미 존재합니다.`); return; }
        if (!confirm(`"${setId}" 세트를 새로 등록합니다.\n10문제가 저장됩니다.\n\n계속하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';
        try {
            const postUrl = `${SUPABASE_URL}/rest/v1/tr_writing_arrange`;
            const postRes = await fetch(postUrl, { method: 'POST', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify(rows) });
            if (!postRes.ok) { const err = await postRes.json(); throw new Error(err.message || `저장 실패: ${postRes.status}`); }

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
        if (!result || result.length === 0) { alert('세트 데이터를 찾을 수 없습니다.'); return; }

        waEditMode = true;
        waEditSetId = setId;
        document.getElementById('waEditBadge').style.display = 'inline';
        document.getElementById('waCancelEditBtn').style.display = 'inline-flex';
        updateWaSetDisplay();
        renderWaSetList();

        result.forEach((row, idx) => {
            const i = idx + 1;
            setVal(`waHint${i}`, row.given_sentence || '');
            setVal(`waHintTrans${i}`, row.given_translation || '');
            setVal(`waAnswerTrans${i}`, row.correct_translation || '');
            setVal(`waExplain${i}`, row.explanation || '');

            // DB에서 역으로 waQData 복원
            const presentedParts = (row.presented_words || '').split('|');
            const correctParts = (row.correct_answer || '').split('|');
            const punct = row.end_punctuation || '.';

            // words 복원: presented에서 주어진/빈칸 판별
            const words = [];
            let ci = 0;
            presentedParts.forEach(p => {
                const t = p.trim();
                if (t === '_') {
                    const ansWord = correctParts[ci] || '';
                    words.push({ text: ansWord, raw: ansWord.replace(/ /g, '_'), isGiven: false });
                    ci++;
                } else {
                    words.push({ text: t, raw: t.replace(/ /g, '_'), isGiven: true });
                }
            });

            // 더미 복원: option_words에서 correct_answer에 없는 것
            const correctLower = correctParts.map(c => c.trim().toLowerCase());
            const givenTextsLower = words.filter(w => w.isGiven).map(w => w.text.toLowerCase());
            const optionParts = (row.option_words || '').split('|').map(o => o.trim());
            const dummies = optionParts.filter(o => {
                const lower = o.toLowerCase();
                return !correctLower.includes(lower) && !givenTextsLower.includes(lower);
            });

            waQData[i] = { words, dummies, punct };

            // 정답 문장 복원 (입력 필드에)
            const fullSentence = words.map(w => w.raw).join(' ') + punct;
            setVal(`waSentence${i}`, fullSentence);

            showWaSubAreas(i);
            renderWaWordChips(i);
            renderWaDummyChips(i);
            updateWaPreview(i);
            updateWaQHeader(i);
        });

        updateWaRegisterBtn();
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

// ===== 취소 / 리셋 =====
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
        setVal(`waHint${i}`, '');
        setVal(`waHintTrans${i}`, '');
        setVal(`waSentence${i}`, '');
        setVal(`waAnswerTrans${i}`, '');
        setVal(`waExplain${i}`, '');

        waQData[i] = { words: [], dummies: [], punct: '.' };

        document.getElementById(`waWordArea${i}`).style.display = 'none';
        document.getElementById(`waDummyArea${i}`).style.display = 'none';
        document.getElementById(`waTransArea${i}`).style.display = 'none';
        document.getElementById(`waExplainArea${i}`).style.display = 'none';

        updateWaPreview(i);
        updateWaQHeader(i);

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
        const delRes = await fetch(delUrl, { method: 'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' } });
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
