// ===== Listening Lecture 문제 등록 모듈 =====
const LL_TABLE = 'tr_listening_lecture';
const LL_PREFIX = 'lecture_set_';
const LL_NARRATION_BASE = 'https://eontoefl.github.io/toefl-audio/listening/lecture/narration';
const LL_AUDIO_BASE = 'https://eontoefl.github.io/toefl-audio/listening/lecture/audio';
const LL_Q_COUNT = 4;

let llExistingSets = [];
let llEditMode = false;
let llEditSetId = null;
let llNextNum = 1;
let llAllExpanded = false;

// ===== 핵심표현 카드 데이터 =====
let llHighlightCards = [];

// ===== URL 생성 헬퍼 (4자리 0패딩 유지) =====
function getLlSetNumPadded() {
    const setId = getLlSetId();
    return setId.replace(LL_PREFIX, ''); // '0013' 그대로 반환
}

function getLlNarrationUrl() {
    const num = getLlSetNumPadded();
    return `${LL_NARRATION_BASE}/lecture_nr_${num}.mp3`;
}

function getLlAudioUrl() {
    const num = getLlSetNumPadded();
    return `${LL_AUDIO_BASE}/lecture_set_${num}.mp3`;
}

// ===== 초기화 =====
function initLlQuestions() {
    const wrap = document.getElementById('llQuestionsWrap');
    if (!wrap) return;
    let html = '';
    for (let q = 1; q <= LL_Q_COUNT; q++) {
        html += buildLlQAccordion(q);
    }
    wrap.innerHTML = html;

    // 기본: Q1 펼침, Q2~Q4 접힘
    const q1Body = document.getElementById('llQ1Body');
    const q1Arrow = document.getElementById('llQ1Arrow');
    if (q1Body) q1Body.classList.add('open');
    if (q1Arrow) q1Arrow.classList.add('open');

    // 핵심표현 초기 카드 1개
    llHighlightCards = [{ word: '', translation: '', explanation: '' }];
    renderLlHighlightCards();
}

function buildLlQAccordion(q) {
    return `
    <div class="sr-q-item" id="llQ${q}Item">
        <div class="sr-q-header" onclick="toggleLlQuestion(${q})">
            <div>
                <span class="sr-q-header-title">Q${q}</span>
                <span class="sr-q-header-sub" id="llQ${q}Sub"></span>
            </div>
            <span class="sr-q-header-arrow" id="llQ${q}Arrow"><i class="fas fa-chevron-down"></i></span>
        </div>
        <div class="sr-q-body" id="llQ${q}Body">
            <!-- 질문 -->
            <div class="sr-q-field">
                <label>질문 (영어) *</label>
                <input type="text" id="llQ${q}Question" placeholder="What is the talk mainly about?" oninput="onLlQInput(${q})">
            </div>
            <div class="sr-q-field">
                <label>질문 번역 (한국어) *</label>
                <input type="text" id="llQ${q}QuestionTrans" placeholder="이 강의는 주로 무엇에 관한 것인가?" oninput="updateLlRegisterBtn()">
            </div>

            <!-- 정답 선택 -->
            <div class="sr-q-field">
                <label>정답 번호 *</label>
                <div class="lr-answer-radio">
                    <label><input type="radio" name="llAnswer${q}" value="1" onchange="onLlAnswerChange(${q})"> ①</label>
                    <label><input type="radio" name="llAnswer${q}" value="2" onchange="onLlAnswerChange(${q})"> ②</label>
                    <label><input type="radio" name="llAnswer${q}" value="3" onchange="onLlAnswerChange(${q})"> ③</label>
                    <label><input type="radio" name="llAnswer${q}" value="4" onchange="onLlAnswerChange(${q})"> ④</label>
                </div>
            </div>

            <!-- 보기 1~4 -->
            <div class="lr-option-group">
                ${[1,2,3,4].map(j => `
                <div class="lr-option-item" id="llQ${q}Opt${j}Wrap">
                    <div class="lr-option-num">
                        ⓘ 보기 ${j}
                        <span class="answer-badge" id="llQ${q}Opt${j}Badge" style="display:none;">정답</span>
                    </div>
                    <div class="sr-q-field">
                        <label>영어 *</label>
                        <input type="text" id="llQ${q}Opt${j}" placeholder="보기 ${j} 영어" oninput="updateLlRegisterBtn()">
                    </div>
                    <div class="sr-q-field">
                        <label>번역 (한국어) *</label>
                        <input type="text" id="llQ${q}OptTrans${j}" placeholder="보기 ${j} 번역" oninput="updateLlRegisterBtn()">
                    </div>
                    <div class="sr-q-field">
                        <label>해설 (한국어) *</label>
                        <textarea id="llQ${q}OptExp${j}" rows="2" placeholder="보기 ${j} 해설" oninput="updateLlRegisterBtn()"></textarea>
                    </div>
                </div>`).join('')}
            </div>
        </div>
    </div>`;
}

// ===== 아코디언 토글 =====
function toggleLlQuestion(num) {
    const body = document.getElementById(`llQ${num}Body`);
    const arrow = document.getElementById(`llQ${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}

function toggleAllLlQuestions() {
    llAllExpanded = !llAllExpanded;
    for (let q = 1; q <= LL_Q_COUNT; q++) {
        const body = document.getElementById(`llQ${q}Body`);
        const arrow = document.getElementById(`llQ${q}Arrow`);
        if (!body) continue;
        if (llAllExpanded) { body.classList.add('open'); if (arrow) arrow.classList.add('open'); }
        else { body.classList.remove('open'); if (arrow) arrow.classList.remove('open'); }
    }
    const btn = document.getElementById('llToggleAllBtn');
    if (btn) btn.textContent = llAllExpanded ? '전체 접기' : '전체 펼치기';
}

// ===== 입력 이벤트 =====
function onLlQInput(q) {
    updateLlQHeader(q);
    updateLlRegisterBtn();
}

function onLlAnswerChange(q) {
    for (let j = 1; j <= 4; j++) {
        const wrap = document.getElementById(`llQ${q}Opt${j}Wrap`);
        const badge = document.getElementById(`llQ${q}Opt${j}Badge`);
        if (wrap) wrap.classList.remove('is-answer');
        if (badge) badge.style.display = 'none';
    }
    const sel = document.querySelector(`input[name="llAnswer${q}"]:checked`);
    if (sel) {
        const v = parseInt(sel.value);
        const wrap = document.getElementById(`llQ${q}Opt${v}Wrap`);
        const badge = document.getElementById(`llQ${q}Opt${v}Badge`);
        if (wrap) wrap.classList.add('is-answer');
        if (badge) badge.style.display = 'inline';
    }
    updateLlRegisterBtn();
}

function updateLlQHeader(q) {
    const sub = document.getElementById(`llQ${q}Sub`);
    if (!sub) return;
    const question = document.getElementById(`llQ${q}Question`)?.value?.trim() || '';
    const preview = question ? (question.length > 50 ? question.substring(0, 50) + '...' : question) : '(미입력)';
    sub.textContent = `— ${preview}`;
}

// ===== 세트 번호 관리 =====
function getLlSetNum() { return String(llNextNum).padStart(4, '0'); }
function getLlSetId() { return llEditMode ? llEditSetId : `${LL_PREFIX}${getLlSetNum()}`; }

function updateLlSetDisplay() {
    const el = document.getElementById('llSetId');
    if (el) el.textContent = getLlSetId();
    const narrEl = document.getElementById('llNarrationUrl');
    if (narrEl) narrEl.textContent = getLlNarrationUrl();
    const audioEl = document.getElementById('llAudioUrl');
    if (audioEl) audioEl.textContent = getLlAudioUrl();
}

// ===== 오디오 검증 =====
function llCheckAudio(url) {
    return new Promise(resolve => {
        const audio = new Audio();
        audio.oncanplaythrough = () => { audio.src = ''; resolve(true); };
        audio.onerror = () => resolve(false);
        audio.src = url;
    });
}

async function verifyLlAllFiles() {
    const narrStatus = document.getElementById('llNarrationStatus');
    const audioStatus = document.getElementById('llAudioStatus');
    if (narrStatus) narrStatus.textContent = '⏳';
    if (audioStatus) audioStatus.textContent = '⏳';

    const [narrOk, audioOk] = await Promise.all([
        llCheckAudio(getLlNarrationUrl()),
        llCheckAudio(getLlAudioUrl())
    ]);

    if (narrStatus) narrStatus.textContent = narrOk ? '✅' : '❌';
    if (audioStatus) audioStatus.textContent = audioOk ? '✅' : '❌';

    const results = [];
    results.push(`나레이션: ${narrOk ? '✅ 존재' : '❌ 없음'}`);
    results.push(`오디오: ${audioOk ? '✅ 존재' : '❌ 없음'}`);
    alert('파일 검증 완료!\n\n' + results.join('\n'));
}

// ===== 오디오 모달 =====
function openLlModal(type) {
    const overlay = document.getElementById('llAudioModal');
    const body = document.getElementById('llModalBody');
    if (!overlay || !body) return;
    const url = type === 'narration' ? getLlNarrationUrl() : getLlAudioUrl();
    const label = type === 'narration' ? '🔊 나레이션 재생' : '🔊 강의 오디오 재생';
    body.innerHTML = `<div style="text-align:center; padding:20px;">
        <p style="margin-bottom:16px; font-weight:600; color:#1e293b;">${label}</p>
        <audio controls autoplay style="width:100%;">
            <source src="${url}" type="audio/mpeg">오디오를 재생할 수 없습니다.
        </audio>
        <p style="margin-top:12px; font-size:11px; color:#94a3b8; word-break:break-all;">${url}</p>
    </div>`;
    overlay.classList.add('active');
}

function closeLlModal() {
    const overlay = document.getElementById('llAudioModal');
    const body = document.getElementById('llModalBody');
    if (!overlay) return;
    const audio = body?.querySelector('audio');
    if (audio) { audio.pause(); audio.src = ''; }
    overlay.classList.remove('active');
    if (body) body.innerHTML = '';
}

// ===== 핵심표현 카드 UI =====
function renderLlHighlightCards() {
    const wrap = document.getElementById('llHighlightCards');
    if (!wrap) return;
    wrap.innerHTML = llHighlightCards.map((card, idx) => `
        <div class="lc-highlight-card" data-idx="${idx}">
            <div class="lc-highlight-card-num">표현 ${idx + 1}</div>
            <button class="lc-hl-del-btn" onclick="removeLlHighlightCard(${idx})" title="삭제">🗑️</button>
            <div class="sr-q-field">
                <label>단어/표현 (영어)</label>
                <input type="text" value="${escapeHtml(card.word)}" placeholder="dark matter" oninput="llHighlightCards[${idx}].word=this.value; updateLlRegisterBtn();">
            </div>
            <div class="sr-q-field">
                <label>한국어 뜻</label>
                <input type="text" value="${escapeHtml(card.translation)}" placeholder="암흑 물질" oninput="llHighlightCards[${idx}].translation=this.value; updateLlRegisterBtn();">
            </div>
            <div class="sr-q-field">
                <label>설명</label>
                <input type="text" value="${escapeHtml(card.explanation)}" placeholder="빛을 내지도 않고 빛을 반사하지도 않는 물질" oninput="llHighlightCards[${idx}].explanation=this.value; updateLlRegisterBtn();">
            </div>
        </div>`).join('');
}

function addLlHighlightCard() {
    llHighlightCards.push({ word: '', translation: '', explanation: '' });
    renderLlHighlightCards();
}

function removeLlHighlightCard(idx) {
    if (llHighlightCards.length <= 1) return;
    llHighlightCards.splice(idx, 1);
    renderLlHighlightCards();
    updateLlRegisterBtn();
}

// 카드 → DB 형식 변환
function llCardsToHighlights() {
    return llHighlightCards
        .filter(c => c.word.trim())
        .map(c => `${c.word.trim()}::${c.translation.trim()}::${c.explanation.trim()}`)
        .join('##');
}

// DB 형식 → 카드 역변환
function llHighlightsToCards(dbValue) {
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
async function loadLlExistingSets() {
    try {
        const res = await supabaseAPI.query(LL_TABLE, {
            'select': 'id,gender,lecture_title',
            'order': 'id.asc',
            'limit': '500'
        });
        llExistingSets = res || [];

        if (llExistingSets.length > 0) {
            const lastId = llExistingSets[llExistingSets.length - 1].id;
            llNextNum = parseInt(lastId.replace(LL_PREFIX, '')) + 1;
        } else {
            llNextNum = 1;
        }

        renderLlSetList();
        updateLlSetDisplay();
    } catch (e) {
        console.error('Listening Lecture 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더링 =====
function renderLlSetList() {
    const wrap = document.getElementById('llSetsListWrap');
    const count = document.getElementById('llSetsCount');
    if (count) count.textContent = `${llExistingSets.length}개`;
    if (!wrap) return;

    if (llExistingSets.length === 0) {
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">등록된 세트가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = llExistingSets.map(set => {
        const sid = set.id;
        const genderIcon = set.gender === 'female' ? '👩' : set.gender === 'male' ? '👨' : '❓';
        const num = sid.replace(LL_PREFIX, '');
        const titlePreview = set.lecture_title ? (set.lecture_title.length > 30 ? set.lecture_title.substring(0, 30) + '...' : set.lecture_title) : '';
        return `
        <div class="sr-set-item">
            <div style="display:flex; align-items:center; flex:1; cursor:pointer;" onclick="editLlSet('${escapeHtml(sid)}')">
                <span style="margin-right:8px; font-size:16px;">${genderIcon}</span>
                <span class="sr-set-item-id">${escapeHtml(num)}</span>
                ${titlePreview ? `<span style="margin-left:8px; font-size:12px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(titlePreview)}</span>` : ''}
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="editLlSet('${escapeHtml(sid)}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button onclick="deleteLlSet('${escapeHtml(sid)}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>`;
    }).join('');
}

// ===== 유효성 검증 =====
function validateLlForm() {
    const errors = [];

    // 성별
    const gender = document.getElementById('llGender')?.value;
    if (!gender) errors.push('성별을 선택해주세요');

    // 강의 제목
    if (!document.getElementById('llLectureTitle')?.value?.trim()) errors.push('강의 제목을 입력해주세요');

    // STEP 1
    if (!document.getElementById('llScript')?.value?.trim()) errors.push('영어 스크립트를 입력해주세요');
    if (!document.getElementById('llScriptTrans')?.value?.trim()) errors.push('한국어 번역을 입력해주세요');

    // STEP 2 핵심표현
    const filledCards = llHighlightCards.filter(c => c.word.trim());
    if (filledCards.length === 0) {
        errors.push('핵심표현을 1개 이상 입력해주세요');
    } else {
        filledCards.forEach((c, idx) => {
            const realIdx = llHighlightCards.indexOf(c);
            if (!c.translation.trim()) errors.push(`표현 ${realIdx + 1}번의 한국어 뜻을 입력해주세요`);
            if (!c.explanation.trim()) errors.push(`표현 ${realIdx + 1}번의 설명을 입력해주세요`);
            if (c.word.includes('::') || c.translation.includes('::') || c.explanation.includes('::'))
                errors.push(`표현 ${realIdx + 1}번에 '::' 문자가 포함되어 있습니다. 제거해주세요`);
            if (c.word.includes('##') || c.translation.includes('##') || c.explanation.includes('##'))
                errors.push(`표현 ${realIdx + 1}번에 '##' 문자가 포함되어 있습니다. 제거해주세요`);
        });
    }

    // STEP 3 Q1~Q4
    for (let q = 1; q <= LL_Q_COUNT; q++) {
        if (!document.getElementById(`llQ${q}Question`)?.value?.trim())
            errors.push(`Q${q} 질문을 입력해주세요`);
        if (!document.getElementById(`llQ${q}QuestionTrans`)?.value?.trim())
            errors.push(`Q${q} 질문 번역을 입력해주세요`);
        if (!document.querySelector(`input[name="llAnswer${q}"]:checked`))
            errors.push(`Q${q} 정답을 선택해주세요`);
        for (let j = 1; j <= 4; j++) {
            if (!document.getElementById(`llQ${q}Opt${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번을 입력해주세요`);
            if (!document.getElementById(`llQ${q}OptTrans${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번 번역을 입력해주세요`);
            if (!document.getElementById(`llQ${q}OptExp${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번 해설을 입력해주세요`);
        }
    }
    return errors;
}

function updateLlRegisterBtn() {
    const btn = document.getElementById('llRegisterBtn');
    if (!btn) return;
    btn.disabled = validateLlForm().length > 0;
}

// ===== 페이로드 빌드 (컬럼명 매핑: Lecture 전용) =====
function buildLlPayload() {
    const setId = llEditMode ? llEditSetId : getLlSetId();
    const setNum = setId.replace(LL_PREFIX, ''); // '0013' 패딩 유지
    const data = {
        id: setId,
        gender: document.getElementById('llGender')?.value || '',
        lecture_title: document.getElementById('llLectureTitle')?.value?.trim() || '',
        narration_url: `${LL_NARRATION_BASE}/lecture_nr_${setNum}.mp3`,
        audio_url: `${LL_AUDIO_BASE}/lecture_set_${setNum}.mp3`,
        script: document.getElementById('llScript')?.value?.trim() || '',
        script_trans: document.getElementById('llScriptTrans')?.value?.trim() || '',
        script_highlights: llCardsToHighlights()
    };

    for (let q = 1; q <= LL_Q_COUNT; q++) {
        // Lecture 컬럼명 매핑 (Announcement와 동일 패턴)
        data[`q${q}_question_text`] = document.getElementById(`llQ${q}Question`)?.value?.trim() || '';
        data[`q${q}_question_trans`] = document.getElementById(`llQ${q}QuestionTrans`)?.value?.trim() || '';
        data[`q${q}_correct_answer`] = parseInt(document.querySelector(`input[name="llAnswer${q}"]:checked`)?.value || '0');
        for (let j = 1; j <= 4; j++) {
            data[`q${q}_opt${j}`] = document.getElementById(`llQ${q}Opt${j}`)?.value?.trim() || '';
            data[`q${q}_trans${j}`] = document.getElementById(`llQ${q}OptTrans${j}`)?.value?.trim() || '';
            data[`q${q}_exp${j}`] = document.getElementById(`llQ${q}OptExp${j}`)?.value?.trim() || '';
        }
    }
    return data;
}

// ===== 등록 (POST / PATCH) =====
async function registerLlSet() {
    const errors = validateLlForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('llRegisterBtn');
    const data = buildLlPayload();
    const setId = data.id;

    if (llEditMode) {
        if (!confirm(`"${setId}" 세트를 수정하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            const patchData = { ...data };
            delete patchData.id;
            const url = `${SUPABASE_URL}/rest/v1/${LL_TABLE}?id=eq.${setId}`;
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(patchData)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `수정 실패: ${res.status}`); }
            const updated = await res.json();
            if (updated.length === 0) throw new Error('수정된 행이 없습니다. RLS 정책을 확인해주세요.');

            alert(`✅ "${setId}" 수정 완료!`);
            cancelLlEdit();
            await loadLlExistingSets();
        } catch (err) {
            console.error('Lecture 수정 실패:', err);
            alert('❌ 수정 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLlRegisterBtn();
        }
    } else {
        if (llExistingSets.some(s => s.id === setId)) { alert(`❌ "${setId}"는 이미 존재합니다.`); return; }
        if (!confirm(`"${setId}" 세트를 새로 등록하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';
        try {
            const url = `${SUPABASE_URL}/rest/v1/${LL_TABLE}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(data)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `등록 실패: ${res.status}`); }

            alert(`✅ "${setId}" 등록 완료!`);
            resetLlForm();
            await loadLlExistingSets();
        } catch (err) {
            console.error('Lecture 등록 실패:', err);
            alert('❌ 등록 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLlRegisterBtn();
        }
    }
}

// ===== 수정 모드 (컬럼명 매핑: Lecture 전용) =====
async function editLlSet(setId) {
    try {
        const result = await supabaseAPI.query(LL_TABLE, {
            'id': `eq.${setId}`,
            'limit': '1'
        });
        if (!result || result.length === 0) { alert('세트 데이터를 찾을 수 없습니다.'); return; }
        const row = result[0];

        llEditMode = true;
        llEditSetId = setId;
        document.getElementById('llEditModeLabel').style.display = 'inline';
        document.getElementById('llCancelEditBtn').style.display = 'inline-flex';
        document.getElementById('llRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

        updateLlSetDisplay();

        // 성별 (male / female)
        const genderEl = document.getElementById('llGender');
        if (genderEl) genderEl.value = row.gender || '';

        // 강의 제목
        setLlVal('llLectureTitle', row.lecture_title || '');

        // STEP 1
        setLlVal('llScript', row.script || '');
        setLlVal('llScriptTrans', row.script_trans || '');

        // STEP 2 핵심표현
        llHighlightCards = llHighlightsToCards(row.script_highlights);
        renderLlHighlightCards();

        // STEP 3 Q1~Q4 (Lecture 컬럼명 매핑)
        for (let q = 1; q <= LL_Q_COUNT; q++) {
            setLlVal(`llQ${q}Question`, row[`q${q}_question_text`] || '');
            setLlVal(`llQ${q}QuestionTrans`, row[`q${q}_question_trans`] || '');

            const answerRadio = document.querySelector(`input[name="llAnswer${q}"][value="${row[`q${q}_correct_answer`]}"]`);
            if (answerRadio) answerRadio.checked = true;

            for (let j = 1; j <= 4; j++) {
                setLlVal(`llQ${q}Opt${j}`, row[`q${q}_opt${j}`] || '');
                setLlVal(`llQ${q}OptTrans${j}`, row[`q${q}_trans${j}`] || '');
                setLlVal(`llQ${q}OptExp${j}`, row[`q${q}_exp${j}`] || '');
            }

            onLlAnswerChange(q);
            updateLlQHeader(q);
        }

        updateLlRegisterBtn();

        // 기존 세트 → 자동 파일 검증 (2개)
        const narrStatus = document.getElementById('llNarrationStatus');
        const audioStatus = document.getElementById('llAudioStatus');
        if (narrStatus) narrStatus.textContent = '⏳';
        if (audioStatus) audioStatus.textContent = '⏳';

        const [narrOk, audioOk] = await Promise.all([
            llCheckAudio(getLlNarrationUrl()),
            llCheckAudio(getLlAudioUrl())
        ]);
        if (narrStatus) narrStatus.textContent = narrOk ? '✅' : '❌';
        if (audioStatus) audioStatus.textContent = audioOk ? '✅' : '❌';

        document.getElementById('section-listening-lecture')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Lecture 수정 로드 실패:', e);
        alert('수정 로드 실패: ' + (e.message || e));
    }
}

// ===== 수정 취소 =====
function cancelLlEdit() {
    llEditMode = false;
    llEditSetId = null;
    document.getElementById('llEditModeLabel').style.display = 'none';
    document.getElementById('llCancelEditBtn').style.display = 'none';
    document.getElementById('llRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    resetLlForm();
    updateLlSetDisplay();
    updateLlRegisterBtn();
}

// ===== 폼 초기화 =====
function resetLlForm() {
    // 성별
    const genderEl = document.getElementById('llGender');
    if (genderEl) genderEl.value = '';

    // 강의 제목
    setLlVal('llLectureTitle', '');

    // STEP 1
    setLlVal('llScript', '');
    setLlVal('llScriptTrans', '');

    // STEP 2
    llHighlightCards = [{ word: '', translation: '', explanation: '' }];
    renderLlHighlightCards();

    // STEP 3
    for (let q = 1; q <= LL_Q_COUNT; q++) {
        setLlVal(`llQ${q}Question`, '');
        setLlVal(`llQ${q}QuestionTrans`, '');

        document.querySelectorAll(`input[name="llAnswer${q}"]`).forEach(r => r.checked = false);

        for (let j = 1; j <= 4; j++) {
            setLlVal(`llQ${q}Opt${j}`, '');
            setLlVal(`llQ${q}OptTrans${j}`, '');
            setLlVal(`llQ${q}OptExp${j}`, '');

            const wrap = document.getElementById(`llQ${q}Opt${j}Wrap`);
            const badge = document.getElementById(`llQ${q}Opt${j}Badge`);
            if (wrap) wrap.classList.remove('is-answer');
            if (badge) badge.style.display = 'none';
        }

        const sub = document.getElementById(`llQ${q}Sub`);
        if (sub) sub.textContent = '';
    }

    // 검증 상태 초기화
    const narrStatus = document.getElementById('llNarrationStatus');
    const audioStatus = document.getElementById('llAudioStatus');
    if (narrStatus) narrStatus.textContent = '⬜';
    if (audioStatus) audioStatus.textContent = '⬜';

    // 아코디언: Q1 펼침, Q2~Q4 접힘
    llAllExpanded = false;
    for (let q = 1; q <= LL_Q_COUNT; q++) {
        const body = document.getElementById(`llQ${q}Body`);
        const arrow = document.getElementById(`llQ${q}Arrow`);
        if (q === 1) {
            if (body) body.classList.add('open');
            if (arrow) arrow.classList.add('open');
        } else {
            if (body) body.classList.remove('open');
            if (arrow) arrow.classList.remove('open');
        }
    }
    const toggleBtn = document.getElementById('llToggleAllBtn');
    if (toggleBtn) toggleBtn.textContent = '전체 펼치기';
}

// ===== 삭제 (hard delete) =====
async function deleteLlSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const delUrl = `${SUPABASE_URL}/rest/v1/${LL_TABLE}?id=eq.${setId}`;
        const delRes = await fetch(delUrl, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
        });
        if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);
        const deleted = await delRes.json();
        if (deleted.length === 0) throw new Error('삭제된 행이 없습니다. RLS 정책을 확인해주세요.');

        alert(`✅ 세트가 삭제되었습니다.`);
        if (llEditMode && llEditSetId === setId) cancelLlEdit();
        await loadLlExistingSets();
    } catch (e) {
        console.error('Lecture 삭제 실패:', e);
        alert('❌ 삭제 실패: ' + (e.message || e));
    }
}

// ===== 유틸 =====
function setLlVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

// ===== 스크립트 덩어리 수 체크 =====
function checkLlScriptLines() {
    const statusEl = document.getElementById('llScriptLineStatus');
    if (!statusEl) return;
    const script = document.getElementById('llScript')?.value || '';
    const trans = document.getElementById('llScriptTrans')?.value || '';
    const scriptChunks = script.trim() ? script.trim().split(/\n\n+/).filter(s => s.trim()).length : 0;
    const transChunks = trans.trim() ? trans.trim().split(/\n\n+/).filter(s => s.trim()).length : 0;
    if (scriptChunks === 0 && transChunks === 0) {
        statusEl.innerHTML = '';
    } else if (scriptChunks === transChunks) {
        statusEl.innerHTML = `<span style="color:#16a34a;">✅ 원문 ${scriptChunks}덩어리 / 해석 ${transChunks}덩어리 — 일치</span>`;
    } else {
        statusEl.innerHTML = `<span style="color:#dc2626;">❌ 원문 ${scriptChunks}덩어리 / 해석 ${transChunks}덩어리 — 불일치!</span>`;
    }
}

// ===== JSON 붙여넣기 기능 =====
function openLlJsonModal() {
    document.getElementById('llJsonModal').style.display = 'flex';
    document.getElementById('llJsonInput').value = '';
    document.getElementById('llJsonError').style.display = 'none';
}

function closeLlJsonModal() {
    document.getElementById('llJsonModal').style.display = 'none';
    document.getElementById('llJsonInput').value = '';
    document.getElementById('llJsonError').style.display = 'none';
}

function applyLlJson() {
    const raw = document.getElementById('llJsonInput').value.trim();
    const errEl = document.getElementById('llJsonError');
    errEl.style.display = 'none';

    if (!raw) {
        errEl.textContent = '❌ JSON을 입력해주세요.';
        errEl.style.display = 'block';
        return;
    }

    // ```json ... ``` 코드블록 자동 제거
    let cleaned = raw;
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    let data;
    try {
        data = JSON.parse(cleaned);
    } catch (e) {
        errEl.textContent = '❌ JSON 형식이 올바르지 않습니다: ' + e.message;
        errEl.style.display = 'block';
        return;
    }

    // 배열인 경우 첫 번째 객체 사용
    if (Array.isArray(data)) {
        if (data.length === 0) {
            errEl.textContent = '❌ 빈 배열입니다.';
            errEl.style.display = 'block';
            return;
        }
        data = data[0];
    }

    if (typeof data !== 'object' || data === null) {
        errEl.textContent = '❌ JSON은 객체 { } 형식이어야 합니다.';
        errEl.style.display = 'block';
        return;
    }

    // questions 검증 (4개)
    if (!data.questions || !Array.isArray(data.questions)) {
        errEl.textContent = '❌ "questions" 배열이 필요합니다.';
        errEl.style.display = 'block';
        return;
    }

    if (data.questions.length !== LL_Q_COUNT) {
        errEl.textContent = `❌ questions는 ${LL_Q_COUNT}개여야 합니다. (현재 ${data.questions.length}개)`;
        errEl.style.display = 'block';
        return;
    }

    // === 강의 제목 채우기 ===
    if (data.lecture_title) {
        setLlVal('llLectureTitle', data.lecture_title);
    }

    // === 스크립트 채우기 ===
    if (data.script) {
        setLlVal('llScript', data.script);
    }
    if (data.script_trans) {
        setLlVal('llScriptTrans', data.script_trans);
    }

    // === 핵심표현 채우기 ===
    if (data.script_highlights && data.script_highlights.trim()) {
        const items = data.script_highlights.split('##');
        llHighlightCards = items.map(item => {
            const parts = item.split('::');
            return {
                word: (parts[0] || '').trim(),
                translation: (parts[1] || '').trim(),
                explanation: (parts[2] || '').trim()
            };
        });
        renderLlHighlightCards();
    }

    // === Q1~Q4 채우기 ===
    let filledCount = 0;
    data.questions.forEach((q, idx) => {
        const num = idx + 1;

        // 질문
        if (q.question) setLlVal(`llQ${num}Question`, q.question);
        if (q.question_trans) setLlVal(`llQ${num}QuestionTrans`, q.question_trans);

        // 보기 1~4
        for (let j = 1; j <= 4; j++) {
            if (q[`option${j}`]) setLlVal(`llQ${num}Opt${j}`, q[`option${j}`]);
            if (q[`option_trans${j}`]) setLlVal(`llQ${num}OptTrans${j}`, q[`option_trans${j}`]);
            if (q[`option_exp${j}`]) setLlVal(`llQ${num}OptExp${j}`, q[`option_exp${j}`]);
        }

        // 정답 라디오
        if (q.answer && q.answer >= 1 && q.answer <= 4) {
            const radio = document.querySelector(`input[name="llAnswer${num}"][value="${q.answer}"]`);
            if (radio) {
                radio.checked = true;
                onLlAnswerChange(num);
            }
        }

        updateLlQHeader(num);
        filledCount++;
    });

    // 줄 수 체크 및 등록 버튼 갱신
    checkLlScriptLines();
    updateLlRegisterBtn();

    closeLlJsonModal();
    alert(`✅ 자동 채움 완료!\n\n` +
        `📚 강의제목: ${data.lecture_title ? '채움' : '없음'}\n` +
        `📝 스크립트: ${data.script ? '채움' : '없음'}\n` +
        `🔑 핵심표현: ${llHighlightCards.filter(c => c.word.trim()).length}개\n` +
        `📋 문제: ${filledCount}문제\n\n` +
        `⚠️ 성별(Gender)은 직접 선택해주세요.`);
}

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', () => {
    initLlQuestions();
});
