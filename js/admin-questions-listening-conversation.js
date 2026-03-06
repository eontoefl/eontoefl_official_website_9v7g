// ===== Listening Conversation 문제 등록 모듈 =====
const LC_TABLE = 'tr_listening_conversation';
const LC_PREFIX = 'conversation_set_';
const LC_BASE_URL = 'https://eontoefl.github.io/toefl-audio/listening/conversation/audio';
const LC_Q_COUNT = 2;

let lcExistingSets = [];
let lcEditMode = false;
let lcEditSetId = null;
let lcNextNum = 1;
let lcAllExpanded = false;

// ===== 핵심표현 카드 데이터 =====
let lcHighlightCards = []; // [{word, translation, explanation}, ...]

// ===== 초기화 =====
function initLcQuestions() {
    const wrap = document.getElementById('lcQuestionsWrap');
    if (!wrap) return;
    let html = '';
    for (let q = 1; q <= LC_Q_COUNT; q++) {
        html += buildLcQAccordion(q);
    }
    wrap.innerHTML = html;

    // 기본: Q1 펼침, Q2 접힘
    const q1Body = document.getElementById('lcQ1Body');
    const q1Arrow = document.getElementById('lcQ1Arrow');
    if (q1Body) q1Body.classList.add('open');
    if (q1Arrow) q1Arrow.classList.add('open');

    // 핵심표현 초기 카드 1개
    lcHighlightCards = [{ word: '', translation: '', explanation: '' }];
    renderLcHighlightCards();
}

function buildLcQAccordion(q) {
    return `
    <div class="sr-q-item" id="lcQ${q}Item">
        <div class="sr-q-header" onclick="toggleLcQuestion(${q})">
            <div>
                <span class="sr-q-header-title">Q${q}</span>
                <span class="sr-q-header-sub" id="lcQ${q}Sub"></span>
            </div>
            <span class="sr-q-header-arrow" id="lcQ${q}Arrow"><i class="fas fa-chevron-down"></i></span>
        </div>
        <div class="sr-q-body" id="lcQ${q}Body">
            <!-- 질문 -->
            <div class="sr-q-field">
                <label>질문 (영어) *</label>
                <input type="text" id="lcQ${q}Question" placeholder="What problem is the man experiencing?" oninput="onLcQInput(${q})">
            </div>
            <div class="sr-q-field">
                <label>질문 번역 (한국어) *</label>
                <input type="text" id="lcQ${q}QuestionTrans" placeholder="남자가 겪고 있는 문제는 무엇인가?">
            </div>

            <!-- 정답 선택 -->
            <div class="sr-q-field">
                <label>정답 번호 *</label>
                <div class="lr-answer-radio">
                    <label><input type="radio" name="lcAnswer${q}" value="1" onchange="onLcAnswerChange(${q})"> ①</label>
                    <label><input type="radio" name="lcAnswer${q}" value="2" onchange="onLcAnswerChange(${q})"> ②</label>
                    <label><input type="radio" name="lcAnswer${q}" value="3" onchange="onLcAnswerChange(${q})"> ③</label>
                    <label><input type="radio" name="lcAnswer${q}" value="4" onchange="onLcAnswerChange(${q})"> ④</label>
                </div>
            </div>

            <!-- 보기 1~4 -->
            <div class="lr-option-group">
                ${[1,2,3,4].map(j => `
                <div class="lr-option-item" id="lcQ${q}Opt${j}Wrap">
                    <div class="lr-option-num">
                        ⓘ 보기 ${j}
                        <span class="answer-badge" id="lcQ${q}Opt${j}Badge" style="display:none;">정답</span>
                    </div>
                    <div class="sr-q-field">
                        <label>영어 *</label>
                        <input type="text" id="lcQ${q}Opt${j}" placeholder="보기 ${j} 영어" oninput="updateLcRegisterBtn()">
                    </div>
                    <div class="sr-q-field">
                        <label>번역 (한국어) *</label>
                        <input type="text" id="lcQ${q}OptTrans${j}" placeholder="보기 ${j} 번역">
                    </div>
                    <div class="sr-q-field">
                        <label>해설 (한국어) *</label>
                        <textarea id="lcQ${q}OptExp${j}" rows="2" placeholder="보기 ${j} 해설"></textarea>
                    </div>
                </div>`).join('')}
            </div>
        </div>
    </div>`;
}

// ===== 아코디언 토글 =====
function toggleLcQuestion(num) {
    const body = document.getElementById(`lcQ${num}Body`);
    const arrow = document.getElementById(`lcQ${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}

function toggleAllLcQuestions() {
    lcAllExpanded = !lcAllExpanded;
    for (let q = 1; q <= LC_Q_COUNT; q++) {
        const body = document.getElementById(`lcQ${q}Body`);
        const arrow = document.getElementById(`lcQ${q}Arrow`);
        if (!body) continue;
        if (lcAllExpanded) { body.classList.add('open'); if (arrow) arrow.classList.add('open'); }
        else { body.classList.remove('open'); if (arrow) arrow.classList.remove('open'); }
    }
    const btn = document.getElementById('lcToggleAllBtn');
    if (btn) btn.textContent = lcAllExpanded ? '전체 접기' : '전체 펼치기';
}

// ===== 입력 이벤트 =====
function onLcQInput(q) {
    updateLcQHeader(q);
    updateLcRegisterBtn();
}

function onLcAnswerChange(q) {
    for (let j = 1; j <= 4; j++) {
        const wrap = document.getElementById(`lcQ${q}Opt${j}Wrap`);
        const badge = document.getElementById(`lcQ${q}Opt${j}Badge`);
        if (wrap) wrap.classList.remove('is-answer');
        if (badge) badge.style.display = 'none';
    }
    const sel = document.querySelector(`input[name="lcAnswer${q}"]:checked`);
    if (sel) {
        const v = parseInt(sel.value);
        const wrap = document.getElementById(`lcQ${q}Opt${v}Wrap`);
        const badge = document.getElementById(`lcQ${q}Opt${v}Badge`);
        if (wrap) wrap.classList.add('is-answer');
        if (badge) badge.style.display = 'inline';
    }
    updateLcRegisterBtn();
}

function updateLcQHeader(q) {
    const sub = document.getElementById(`lcQ${q}Sub`);
    if (!sub) return;
    const question = document.getElementById(`lcQ${q}Question`)?.value?.trim() || '';
    const preview = question ? (question.length > 50 ? question.substring(0, 50) + '...' : question) : '(미입력)';
    sub.textContent = `— ${preview}`;
}

// ===== 세트 번호 관리 =====
function getLcSetNum() { return String(lcNextNum).padStart(4, '0'); }
function getLcSetId() { return lcEditMode ? lcEditSetId : `${LC_PREFIX}${getLcSetNum()}`; }

function updateLcSetDisplay() {
    const el = document.getElementById('lcSetId');
    if (el) el.textContent = getLcSetId();
    const urlEl = document.getElementById('lcAudioUrl');
    if (urlEl) urlEl.textContent = `${LC_BASE_URL}/${getLcSetId()}.mp3`;
}

// ===== 오디오 검증 =====
function lcCheckAudio(url) {
    return new Promise(resolve => {
        const audio = new Audio();
        audio.oncanplaythrough = () => { audio.src = ''; resolve(true); };
        audio.onerror = () => resolve(false);
        audio.src = url;
    });
}

async function verifyLcAudioFile() {
    const statusEl = document.getElementById('lcAudioStatus');
    if (statusEl) statusEl.textContent = '⏳';
    const url = `${LC_BASE_URL}/${getLcSetId()}.mp3`;
    const ok = await lcCheckAudio(url);
    if (statusEl) statusEl.textContent = ok ? '✅' : '❌';
    alert(ok ? '✅ 오디오 파일 존재 확인!' : '❌ 오디오 파일을 찾을 수 없습니다.');
}

// ===== 오디오 모달 =====
function openLcModal() {
    const overlay = document.getElementById('lcAudioModal');
    const body = document.getElementById('lcModalBody');
    if (!overlay || !body) return;
    const url = `${LC_BASE_URL}/${getLcSetId()}.mp3`;
    body.innerHTML = `<div style="text-align:center; padding:20px;">
        <p style="margin-bottom:16px; font-weight:600; color:#1e293b;">🔊 오디오 재생</p>
        <audio controls autoplay style="width:100%;">
            <source src="${url}" type="audio/mpeg">오디오를 재생할 수 없습니다.
        </audio>
        <p style="margin-top:12px; font-size:11px; color:#94a3b8; word-break:break-all;">${url}</p>
    </div>`;
    overlay.classList.add('active');
}

function closeLcModal() {
    const overlay = document.getElementById('lcAudioModal');
    const body = document.getElementById('lcModalBody');
    if (!overlay) return;
    const audio = body?.querySelector('audio');
    if (audio) { audio.pause(); audio.src = ''; }
    overlay.classList.remove('active');
    if (body) body.innerHTML = '';
}

// ===== 핵심표현 카드 UI =====
function renderLcHighlightCards() {
    const wrap = document.getElementById('lcHighlightCards');
    if (!wrap) return;
    wrap.innerHTML = lcHighlightCards.map((card, idx) => `
        <div class="lc-highlight-card" data-idx="${idx}">
            <div class="lc-highlight-card-num">표현 ${idx + 1}</div>
            <button class="lc-hl-del-btn" onclick="removeLcHighlightCard(${idx})" title="삭제">🗑️</button>
            <div class="sr-q-field">
                <label>단어/표현 (영어)</label>
                <input type="text" value="${escapeHtml(card.word)}" placeholder="prescription" oninput="lcHighlightCards[${idx}].word=this.value; updateLcRegisterBtn();">
            </div>
            <div class="sr-q-field">
                <label>한국어 뜻</label>
                <input type="text" value="${escapeHtml(card.translation)}" placeholder="처방약, 처방전" oninput="lcHighlightCards[${idx}].translation=this.value; updateLcRegisterBtn();">
            </div>
            <div class="sr-q-field">
                <label>설명</label>
                <input type="text" value="${escapeHtml(card.explanation)}" placeholder="의사가 내준 약을 말해요" oninput="lcHighlightCards[${idx}].explanation=this.value; updateLcRegisterBtn();">
            </div>
        </div>`).join('');
}

function addLcHighlightCard() {
    lcHighlightCards.push({ word: '', translation: '', explanation: '' });
    renderLcHighlightCards();
}

function removeLcHighlightCard(idx) {
    if (lcHighlightCards.length <= 1) return; // 최소 1개 유지
    lcHighlightCards.splice(idx, 1);
    renderLcHighlightCards();
    updateLcRegisterBtn();
}

// 카드 → DB 형식 변환
function lcCardsToHighlights() {
    return lcHighlightCards
        .filter(c => c.word.trim())
        .map(c => `${c.word.trim()}::${c.translation.trim()}::${c.explanation.trim()}`)
        .join('##');
}

// DB 형식 → 카드 역변환
function lcHighlightsToCards(dbValue) {
    if (!dbValue || !dbValue.trim()) return [{ word: '', translation: '', explanation: '' }];
    const cards = dbValue.split('##').map(item => {
        const [word, translation, explanation] = item.split('::');
        return {
            word: (word || '').trim(),
            translation: (translation || '').trim(),
            explanation: (explanation || '').trim()
        };
    });
    return cards.length > 0 ? cards : [{ word: '', translation: '', explanation: '' }];
}

// ===== 기존 세트 목록 로드 =====
async function loadLcExistingSets() {
    try {
        const res = await supabaseAPI.query(LC_TABLE, {
            'select': 'id',
            'order': 'id.asc',
            'limit': '500'
        });
        lcExistingSets = (res || []).map(r => r.id);

        if (lcExistingSets.length > 0) {
            const lastId = lcExistingSets[lcExistingSets.length - 1];
            lcNextNum = parseInt(lastId.replace(LC_PREFIX, '')) + 1;
        } else {
            lcNextNum = 1;
        }

        renderLcSetList();
        updateLcSetDisplay();
    } catch (e) {
        console.error('Listening Conversation 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더링 =====
function renderLcSetList() {
    const wrap = document.getElementById('lcSetsListWrap');
    const count = document.getElementById('lcSetsCount');
    if (count) count.textContent = `${lcExistingSets.length}개`;
    if (!wrap) return;

    if (lcExistingSets.length === 0) {
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">등록된 세트가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = lcExistingSets.map(sid => {
        return `
        <div class="sr-set-item">
            <div style="display:flex; align-items:center; flex:1; cursor:pointer;" onclick="editLcSet('${escapeHtml(sid)}')">
                <span class="sr-set-item-id">${escapeHtml(sid)}</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="editLcSet('${escapeHtml(sid)}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button onclick="deleteLcSet('${escapeHtml(sid)}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>`;
    }).join('');
}

// ===== 유효성 검증 =====
function validateLcForm() {
    const errors = [];
    // STEP 1
    if (!document.getElementById('lcScript')?.value?.trim()) errors.push('영어 스크립트를 입력해주세요');
    if (!document.getElementById('lcScriptTrans')?.value?.trim()) errors.push('한국어 번역을 입력해주세요');

    // STEP 2 핵심표현
    const filledCards = lcHighlightCards.filter(c => c.word.trim());
    if (filledCards.length === 0) {
        errors.push('핵심표현을 1개 이상 입력해주세요');
    } else {
        filledCards.forEach((c, idx) => {
            const realIdx = lcHighlightCards.indexOf(c);
            if (!c.translation.trim()) errors.push(`표현 ${realIdx + 1}번의 한국어 뜻을 입력해주세요`);
            if (!c.explanation.trim()) errors.push(`표현 ${realIdx + 1}번의 설명을 입력해주세요`);
            if (c.word.includes('::') || c.translation.includes('::') || c.explanation.includes('::'))
                errors.push(`표현 ${realIdx + 1}번에 '::' 문자가 포함되어 있습니다. 제거해주세요`);
            if (c.word.includes('##') || c.translation.includes('##') || c.explanation.includes('##'))
                errors.push(`표현 ${realIdx + 1}번에 '##' 문자가 포함되어 있습니다. 제거해주세요`);
        });
    }

    // STEP 3 Q1/Q2
    for (let q = 1; q <= LC_Q_COUNT; q++) {
        if (!document.getElementById(`lcQ${q}Question`)?.value?.trim())
            errors.push(`Q${q} 질문을 입력해주세요`);
        if (!document.getElementById(`lcQ${q}QuestionTrans`)?.value?.trim())
            errors.push(`Q${q} 질문 번역을 입력해주세요`);
        if (!document.querySelector(`input[name="lcAnswer${q}"]:checked`))
            errors.push(`Q${q} 정답을 선택해주세요`);
        for (let j = 1; j <= 4; j++) {
            if (!document.getElementById(`lcQ${q}Opt${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번을 입력해주세요`);
            if (!document.getElementById(`lcQ${q}OptTrans${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번 번역을 입력해주세요`);
            if (!document.getElementById(`lcQ${q}OptExp${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번 해설을 입력해주세요`);
        }
    }
    return errors;
}

function updateLcRegisterBtn() {
    const btn = document.getElementById('lcRegisterBtn');
    if (!btn) return;
    btn.disabled = validateLcForm().length > 0;
}

// ===== 페이로드 빌드 =====
function buildLcPayload() {
    const setId = lcEditMode ? lcEditSetId : getLcSetId();
    const data = {
        id: setId,
        audio_url: `${LC_BASE_URL}/${setId}.mp3`,
        script: document.getElementById('lcScript')?.value?.trim() || '',
        script_trans: document.getElementById('lcScriptTrans')?.value?.trim() || '',
        script_highlights: lcCardsToHighlights()
    };

    for (let q = 1; q <= LC_Q_COUNT; q++) {
        data[`q${q}_question`] = document.getElementById(`lcQ${q}Question`)?.value?.trim() || '';
        data[`q${q}_question_trans`] = document.getElementById(`lcQ${q}QuestionTrans`)?.value?.trim() || '';
        data[`q${q}_answer`] = parseInt(document.querySelector(`input[name="lcAnswer${q}"]:checked`)?.value || '0');
        for (let j = 1; j <= 4; j++) {
            data[`q${q}_opt${j}`] = document.getElementById(`lcQ${q}Opt${j}`)?.value?.trim() || '';
            data[`q${q}_opt_trans${j}`] = document.getElementById(`lcQ${q}OptTrans${j}`)?.value?.trim() || '';
            data[`q${q}_opt_exp${j}`] = document.getElementById(`lcQ${q}OptExp${j}`)?.value?.trim() || '';
        }
    }
    return data;
}

// ===== 등록 (POST / PATCH) =====
async function registerLcSet() {
    const errors = validateLcForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('lcRegisterBtn');
    const data = buildLcPayload();
    const setId = data.id;

    if (lcEditMode) {
        // 수정: PATCH 1회
        if (!confirm(`"${setId}" 세트를 수정하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            const patchData = { ...data };
            delete patchData.id; // id는 PATCH에서 제외
            const url = `${SUPABASE_URL}/rest/v1/${LC_TABLE}?id=eq.${setId}`;
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(patchData)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `수정 실패: ${res.status}`); }
            const updated = await res.json();
            if (updated.length === 0) throw new Error('수정된 행이 없습니다. RLS 정책을 확인해주세요.');

            alert(`✅ "${setId}" 수정 완료!`);
            cancelLcEdit();
            await loadLcExistingSets();
        } catch (err) {
            console.error('Conversation 수정 실패:', err);
            alert('❌ 수정 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLcRegisterBtn();
        }
    } else {
        // 신규: POST 1회
        if (lcExistingSets.includes(setId)) { alert(`❌ "${setId}"는 이미 존재합니다.`); return; }
        if (!confirm(`"${setId}" 세트를 새로 등록하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';
        try {
            const url = `${SUPABASE_URL}/rest/v1/${LC_TABLE}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(data)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `등록 실패: ${res.status}`); }

            alert(`✅ "${setId}" 등록 완료!`);
            resetLcForm();
            await loadLcExistingSets();
        } catch (err) {
            console.error('Conversation 등록 실패:', err);
            alert('❌ 등록 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLcRegisterBtn();
        }
    }
}

// ===== 수정 모드 =====
async function editLcSet(setId) {
    try {
        const result = await supabaseAPI.query(LC_TABLE, {
            'id': `eq.${setId}`,
            'limit': '1'
        });
        if (!result || result.length === 0) { alert('세트 데이터를 찾을 수 없습니다.'); return; }
        const row = result[0];

        lcEditMode = true;
        lcEditSetId = setId;
        document.getElementById('lcEditModeLabel').style.display = 'inline';
        document.getElementById('lcCancelEditBtn').style.display = 'inline-flex';
        document.getElementById('lcRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

        updateLcSetDisplay();

        // STEP 1
        setLcVal('lcScript', row.script || '');
        setLcVal('lcScriptTrans', row.script_trans || '');

        // STEP 2 핵심표현 카드 역변환
        lcHighlightCards = lcHighlightsToCards(row.script_highlights);
        renderLcHighlightCards();

        // STEP 3 Q1/Q2
        for (let q = 1; q <= LC_Q_COUNT; q++) {
            setLcVal(`lcQ${q}Question`, row[`q${q}_question`] || '');
            setLcVal(`lcQ${q}QuestionTrans`, row[`q${q}_question_trans`] || '');

            const answerRadio = document.querySelector(`input[name="lcAnswer${q}"][value="${row[`q${q}_answer`]}"]`);
            if (answerRadio) answerRadio.checked = true;

            for (let j = 1; j <= 4; j++) {
                setLcVal(`lcQ${q}Opt${j}`, row[`q${q}_opt${j}`] || '');
                setLcVal(`lcQ${q}OptTrans${j}`, row[`q${q}_opt_trans${j}`] || '');
                setLcVal(`lcQ${q}OptExp${j}`, row[`q${q}_opt_exp${j}`] || '');
            }

            onLcAnswerChange(q);
            updateLcQHeader(q);
        }

        updateLcRegisterBtn();

        // 기존 세트 → 자동 파일 검증
        const statusEl = document.getElementById('lcAudioStatus');
        if (statusEl) statusEl.textContent = '⏳';
        const audioUrl = `${LC_BASE_URL}/${setId}.mp3`;
        const audioOk = await lcCheckAudio(audioUrl);
        if (statusEl) statusEl.textContent = audioOk ? '✅' : '❌';

        document.getElementById('section-listening-conversation')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Conversation 수정 로드 실패:', e);
        alert('수정 로드 실패: ' + (e.message || e));
    }
}

// ===== 수정 취소 =====
function cancelLcEdit() {
    lcEditMode = false;
    lcEditSetId = null;
    document.getElementById('lcEditModeLabel').style.display = 'none';
    document.getElementById('lcCancelEditBtn').style.display = 'none';
    document.getElementById('lcRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    resetLcForm();
    updateLcSetDisplay();
    updateLcRegisterBtn();
}

// ===== 폼 초기화 =====
function resetLcForm() {
    // STEP 1
    setLcVal('lcScript', '');
    setLcVal('lcScriptTrans', '');

    // STEP 2
    lcHighlightCards = [{ word: '', translation: '', explanation: '' }];
    renderLcHighlightCards();

    // STEP 3
    for (let q = 1; q <= LC_Q_COUNT; q++) {
        setLcVal(`lcQ${q}Question`, '');
        setLcVal(`lcQ${q}QuestionTrans`, '');

        document.querySelectorAll(`input[name="lcAnswer${q}"]`).forEach(r => r.checked = false);

        for (let j = 1; j <= 4; j++) {
            setLcVal(`lcQ${q}Opt${j}`, '');
            setLcVal(`lcQ${q}OptTrans${j}`, '');
            setLcVal(`lcQ${q}OptExp${j}`, '');

            const wrap = document.getElementById(`lcQ${q}Opt${j}Wrap`);
            const badge = document.getElementById(`lcQ${q}Opt${j}Badge`);
            if (wrap) wrap.classList.remove('is-answer');
            if (badge) badge.style.display = 'none';
        }

        const sub = document.getElementById(`lcQ${q}Sub`);
        if (sub) sub.textContent = '';
    }

    // 검증 상태 초기화
    const audioStatus = document.getElementById('lcAudioStatus');
    if (audioStatus) audioStatus.textContent = '⬜';

    // 아코디언: Q1 펼침, Q2 접힘
    lcAllExpanded = false;
    for (let q = 1; q <= LC_Q_COUNT; q++) {
        const body = document.getElementById(`lcQ${q}Body`);
        const arrow = document.getElementById(`lcQ${q}Arrow`);
        if (q === 1) {
            if (body) body.classList.add('open');
            if (arrow) arrow.classList.add('open');
        } else {
            if (body) body.classList.remove('open');
            if (arrow) arrow.classList.remove('open');
        }
    }
    const toggleBtn = document.getElementById('lcToggleAllBtn');
    if (toggleBtn) toggleBtn.textContent = '전체 펼치기';
}

// ===== 삭제 (hard delete) =====
async function deleteLcSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const delUrl = `${SUPABASE_URL}/rest/v1/${LC_TABLE}?id=eq.${setId}`;
        const delRes = await fetch(delUrl, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
        });
        if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);
        const deleted = await delRes.json();
        if (deleted.length === 0) throw new Error('삭제된 행이 없습니다. RLS 정책을 확인해주세요.');

        alert(`✅ 세트가 삭제되었습니다.`);
        if (lcEditMode && lcEditSetId === setId) cancelLcEdit();
        await loadLcExistingSets();
    } catch (e) {
        console.error('Conversation 삭제 실패:', e);
        alert('❌ 삭제 실패: ' + (e.message || e));
    }
}

// ===== 유틸 =====
function setLcVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', () => {
    initLcQuestions();
});
