// ===== Listening Announcement 문제 등록 모듈 =====
const LA_TABLE = 'tr_listening_announcement';
const LA_PREFIX = 'announcement_set_';
const LA_NARRATION_BASE = 'https://eontoefl.github.io/toefl-audio/listening/announcement/narration';
const LA_AUDIO_BASE = 'https://eontoefl.github.io/toefl-audio/listening/announcement/audio';
const LA_Q_COUNT = 2;

let laExistingSets = [];
let laEditMode = false;
let laEditSetId = null;
let laNextNum = 1;
let laAllExpanded = false;

// ===== 핵심표현 카드 데이터 =====
let laHighlightCards = [];

// ===== URL 생성 헬퍼 (4자리 0패딩) =====
function getLaSetNumPadded() {
    const setId = getLaSetId();
    return setId.replace(LA_PREFIX, ''); // '0019' 그대로 반환
}

function getLaNarrationUrl() {
    const num = getLaSetNumPadded();
    return `${LA_NARRATION_BASE}/announcement_nr_${num}.mp3`;
}

function getLaAudioUrl() {
    const num = getLaSetNumPadded();
    return `${LA_AUDIO_BASE}/announcement_set_${num}.mp3`;
}

// ===== 초기화 =====
function initLaQuestions() {
    const wrap = document.getElementById('laQuestionsWrap');
    if (!wrap) return;
    let html = '';
    for (let q = 1; q <= LA_Q_COUNT; q++) {
        html += buildLaQAccordion(q);
    }
    wrap.innerHTML = html;

    // 기본: Q1 펼침, Q2 접힘
    const q1Body = document.getElementById('laQ1Body');
    const q1Arrow = document.getElementById('laQ1Arrow');
    if (q1Body) q1Body.classList.add('open');
    if (q1Arrow) q1Arrow.classList.add('open');

    // 핵심표현 초기 카드 1개
    laHighlightCards = [{ word: '', translation: '', explanation: '' }];
    renderLaHighlightCards();
}

function buildLaQAccordion(q) {
    return `
    <div class="sr-q-item" id="laQ${q}Item">
        <div class="sr-q-header" onclick="toggleLaQuestion(${q})">
            <div>
                <span class="sr-q-header-title">Q${q}</span>
                <span class="sr-q-header-sub" id="laQ${q}Sub"></span>
            </div>
            <span class="sr-q-header-arrow" id="laQ${q}Arrow"><i class="fas fa-chevron-down"></i></span>
        </div>
        <div class="sr-q-body" id="laQ${q}Body">
            <!-- 질문 -->
            <div class="sr-q-field">
                <label>질문 (영어) *</label>
                <input type="text" id="laQ${q}Question" placeholder="What is the announcement mainly about?" oninput="onLaQInput(${q})">
            </div>
            <div class="sr-q-field">
                <label>질문 번역 (한국어) *</label>
                <input type="text" id="laQ${q}QuestionTrans" placeholder="이 공지사항은 주로 무엇에 관한 것인가?" oninput="updateLaRegisterBtn()">
            </div>

            <!-- 정답 선택 -->
            <div class="sr-q-field">
                <label>정답 번호 *</label>
                <div class="lr-answer-radio">
                    <label><input type="radio" name="laAnswer${q}" value="1" onchange="onLaAnswerChange(${q})"> ①</label>
                    <label><input type="radio" name="laAnswer${q}" value="2" onchange="onLaAnswerChange(${q})"> ②</label>
                    <label><input type="radio" name="laAnswer${q}" value="3" onchange="onLaAnswerChange(${q})"> ③</label>
                    <label><input type="radio" name="laAnswer${q}" value="4" onchange="onLaAnswerChange(${q})"> ④</label>
                </div>
            </div>

            <!-- 보기 1~4 -->
            <div class="lr-option-group">
                ${[1,2,3,4].map(j => `
                <div class="lr-option-item" id="laQ${q}Opt${j}Wrap">
                    <div class="lr-option-num">
                        ⓘ 보기 ${j}
                        <span class="answer-badge" id="laQ${q}Opt${j}Badge" style="display:none;">정답</span>
                    </div>
                    <div class="sr-q-field">
                        <label>영어 *</label>
                        <input type="text" id="laQ${q}Opt${j}" placeholder="보기 ${j} 영어" oninput="updateLaRegisterBtn()">
                    </div>
                    <div class="sr-q-field">
                        <label>번역 (한국어) *</label>
                        <input type="text" id="laQ${q}OptTrans${j}" placeholder="보기 ${j} 번역" oninput="updateLaRegisterBtn()">
                    </div>
                    <div class="sr-q-field">
                        <label>해설 (한국어) *</label>
                        <textarea id="laQ${q}OptExp${j}" rows="2" placeholder="보기 ${j} 해설" oninput="updateLaRegisterBtn()"></textarea>
                    </div>
                </div>`).join('')}
            </div>
        </div>
    </div>`;
}

// ===== 아코디언 토글 =====
function toggleLaQuestion(num) {
    const body = document.getElementById(`laQ${num}Body`);
    const arrow = document.getElementById(`laQ${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}

function toggleAllLaQuestions() {
    laAllExpanded = !laAllExpanded;
    for (let q = 1; q <= LA_Q_COUNT; q++) {
        const body = document.getElementById(`laQ${q}Body`);
        const arrow = document.getElementById(`laQ${q}Arrow`);
        if (!body) continue;
        if (laAllExpanded) { body.classList.add('open'); if (arrow) arrow.classList.add('open'); }
        else { body.classList.remove('open'); if (arrow) arrow.classList.remove('open'); }
    }
    const btn = document.getElementById('laToggleAllBtn');
    if (btn) btn.textContent = laAllExpanded ? '전체 접기' : '전체 펼치기';
}

// ===== 입력 이벤트 =====
function onLaQInput(q) {
    updateLaQHeader(q);
    updateLaRegisterBtn();
}

function onLaAnswerChange(q) {
    for (let j = 1; j <= 4; j++) {
        const wrap = document.getElementById(`laQ${q}Opt${j}Wrap`);
        const badge = document.getElementById(`laQ${q}Opt${j}Badge`);
        if (wrap) wrap.classList.remove('is-answer');
        if (badge) badge.style.display = 'none';
    }
    const sel = document.querySelector(`input[name="laAnswer${q}"]:checked`);
    if (sel) {
        const v = parseInt(sel.value);
        const wrap = document.getElementById(`laQ${q}Opt${v}Wrap`);
        const badge = document.getElementById(`laQ${q}Opt${v}Badge`);
        if (wrap) wrap.classList.add('is-answer');
        if (badge) badge.style.display = 'inline';
    }
    updateLaRegisterBtn();
}

function updateLaQHeader(q) {
    const sub = document.getElementById(`laQ${q}Sub`);
    if (!sub) return;
    const question = document.getElementById(`laQ${q}Question`)?.value?.trim() || '';
    const preview = question ? (question.length > 50 ? question.substring(0, 50) + '...' : question) : '(미입력)';
    sub.textContent = `— ${preview}`;
}

// ===== 세트 번호 관리 =====
function getLaSetNum() { return String(laNextNum).padStart(4, '0'); }
function getLaSetId() { return laEditMode ? laEditSetId : `${LA_PREFIX}${getLaSetNum()}`; }

function updateLaSetDisplay() {
    const el = document.getElementById('laSetId');
    if (el) el.textContent = getLaSetId();
    const narrEl = document.getElementById('laNarrationUrl');
    if (narrEl) narrEl.textContent = getLaNarrationUrl();
    const audioEl = document.getElementById('laAudioUrl');
    if (audioEl) audioEl.textContent = getLaAudioUrl();
}

// ===== 오디오 검증 =====
function laCheckAudio(url) {
    return new Promise(resolve => {
        const audio = new Audio();
        audio.oncanplaythrough = () => { audio.src = ''; resolve(true); };
        audio.onerror = () => resolve(false);
        audio.src = url;
    });
}

async function verifyLaAllFiles() {
    const narrStatus = document.getElementById('laNarrationStatus');
    const audioStatus = document.getElementById('laAudioStatus');
    if (narrStatus) narrStatus.textContent = '⏳';
    if (audioStatus) audioStatus.textContent = '⏳';

    const [narrOk, audioOk] = await Promise.all([
        laCheckAudio(getLaNarrationUrl()),
        laCheckAudio(getLaAudioUrl())
    ]);

    if (narrStatus) narrStatus.textContent = narrOk ? '✅' : '❌';
    if (audioStatus) audioStatus.textContent = audioOk ? '✅' : '❌';

    const results = [];
    results.push(`나레이션: ${narrOk ? '✅ 존재' : '❌ 없음'}`);
    results.push(`오디오: ${audioOk ? '✅ 존재' : '❌ 없음'}`);
    alert('파일 검증 완료!\n\n' + results.join('\n'));
}

// ===== 오디오 모달 =====
function openLaModal(type) {
    const overlay = document.getElementById('laAudioModal');
    const body = document.getElementById('laModalBody');
    if (!overlay || !body) return;
    const url = type === 'narration' ? getLaNarrationUrl() : getLaAudioUrl();
    const label = type === 'narration' ? '🔊 나레이션 재생' : '🔊 오디오 재생';
    body.innerHTML = `<div style="text-align:center; padding:20px;">
        <p style="margin-bottom:16px; font-weight:600; color:#1e293b;">${label}</p>
        <audio controls autoplay style="width:100%;">
            <source src="${url}" type="audio/mpeg">오디오를 재생할 수 없습니다.
        </audio>
        <p style="margin-top:12px; font-size:11px; color:#94a3b8; word-break:break-all;">${url}</p>
    </div>`;
    overlay.classList.add('active');
}

function closeLaModal() {
    const overlay = document.getElementById('laAudioModal');
    const body = document.getElementById('laModalBody');
    if (!overlay) return;
    const audio = body?.querySelector('audio');
    if (audio) { audio.pause(); audio.src = ''; }
    overlay.classList.remove('active');
    if (body) body.innerHTML = '';
}

// ===== 핵심표현 카드 UI =====
function renderLaHighlightCards() {
    const wrap = document.getElementById('laHighlightCards');
    if (!wrap) return;
    wrap.innerHTML = laHighlightCards.map((card, idx) => `
        <div class="lc-highlight-card" data-idx="${idx}">
            <div class="lc-highlight-card-num">표현 ${idx + 1}</div>
            <button class="lc-hl-del-btn" onclick="removeLaHighlightCard(${idx})" title="삭제">🗑️</button>
            <div class="sr-q-field">
                <label>단어/표현 (영어)</label>
                <input type="text" value="${escapeHtml(card.word)}" placeholder="Based on your survey responses" oninput="laHighlightCards[${idx}].word=this.value; updateLaRegisterBtn();">
            </div>
            <div class="sr-q-field">
                <label>한국어 뜻</label>
                <input type="text" value="${escapeHtml(card.translation)}" placeholder="설문조사 응답을 바탕으로" oninput="laHighlightCards[${idx}].translation=this.value; updateLaRegisterBtn();">
            </div>
            <div class="sr-q-field">
                <label>설명</label>
                <input type="text" value="${escapeHtml(card.explanation)}" placeholder="'based on'은 '~을 기반으로'라는 뜻이에요" oninput="laHighlightCards[${idx}].explanation=this.value; updateLaRegisterBtn();">
            </div>
        </div>`).join('');
}

function addLaHighlightCard() {
    laHighlightCards.push({ word: '', translation: '', explanation: '' });
    renderLaHighlightCards();
}

function removeLaHighlightCard(idx) {
    if (laHighlightCards.length <= 1) return;
    laHighlightCards.splice(idx, 1);
    renderLaHighlightCards();
    updateLaRegisterBtn();
}

// 카드 → DB 형식 변환
function laCardsToHighlights() {
    return laHighlightCards
        .filter(c => c.word.trim())
        .map(c => `${c.word.trim()}::${c.translation.trim()}::${c.explanation.trim()}`)
        .join('##');
}

// DB 형식 → 카드 역변환
function laHighlightsToCards(dbValue) {
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
async function loadLaExistingSets() {
    try {
        const res = await supabaseAPI.query(LA_TABLE, {
            'select': 'id,gender',
            'order': 'id.asc',
            'limit': '500'
        });
        laExistingSets = res || [];

        if (laExistingSets.length > 0) {
            const lastId = laExistingSets[laExistingSets.length - 1].id;
            laNextNum = parseInt(lastId.replace(LA_PREFIX, '')) + 1;
        } else {
            laNextNum = 1;
        }

        renderLaSetList();
        updateLaSetDisplay();
    } catch (e) {
        console.error('Listening Announcement 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더링 =====
function renderLaSetList() {
    const wrap = document.getElementById('laSetsListWrap');
    const count = document.getElementById('laSetsCount');
    if (count) count.textContent = `${laExistingSets.length}개`;
    if (!wrap) return;

    if (laExistingSets.length === 0) {
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">등록된 세트가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = laExistingSets.map(set => {
        const sid = set.id;
        const genderIcon = set.gender === 'F' ? '👩' : set.gender === 'M' ? '👨' : '❓';
        return `
        <div class="sr-set-item">
            <div style="display:flex; align-items:center; flex:1; cursor:pointer;" onclick="editLaSet('${escapeHtml(sid)}')">
                <span style="margin-right:8px; font-size:16px;">${genderIcon}</span>
                <span class="sr-set-item-id">${escapeHtml(sid)}</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="editLaSet('${escapeHtml(sid)}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button onclick="deleteLaSet('${escapeHtml(sid)}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>`;
    }).join('');
}

// ===== 유효성 검증 =====
function validateLaForm() {
    const errors = [];

    // 성별
    const gender = document.getElementById('laGender')?.value;
    if (!gender) errors.push('성별을 선택해주세요');

    // STEP 1
    if (!document.getElementById('laScript')?.value?.trim()) errors.push('영어 스크립트를 입력해주세요');
    if (!document.getElementById('laScriptTrans')?.value?.trim()) errors.push('한국어 번역을 입력해주세요');

    // STEP 2 핵심표현
    const filledCards = laHighlightCards.filter(c => c.word.trim());
    if (filledCards.length === 0) {
        errors.push('핵심표현을 1개 이상 입력해주세요');
    } else {
        filledCards.forEach((c, idx) => {
            const realIdx = laHighlightCards.indexOf(c);
            if (!c.translation.trim()) errors.push(`표현 ${realIdx + 1}번의 한국어 뜻을 입력해주세요`);
            if (!c.explanation.trim()) errors.push(`표현 ${realIdx + 1}번의 설명을 입력해주세요`);
            if (c.word.includes('::') || c.translation.includes('::') || c.explanation.includes('::'))
                errors.push(`표현 ${realIdx + 1}번에 '::' 문자가 포함되어 있습니다. 제거해주세요`);
            if (c.word.includes('##') || c.translation.includes('##') || c.explanation.includes('##'))
                errors.push(`표현 ${realIdx + 1}번에 '##' 문자가 포함되어 있습니다. 제거해주세요`);
        });
    }

    // STEP 3 Q1/Q2
    for (let q = 1; q <= LA_Q_COUNT; q++) {
        if (!document.getElementById(`laQ${q}Question`)?.value?.trim())
            errors.push(`Q${q} 질문을 입력해주세요`);
        if (!document.getElementById(`laQ${q}QuestionTrans`)?.value?.trim())
            errors.push(`Q${q} 질문 번역을 입력해주세요`);
        if (!document.querySelector(`input[name="laAnswer${q}"]:checked`))
            errors.push(`Q${q} 정답을 선택해주세요`);
        for (let j = 1; j <= 4; j++) {
            if (!document.getElementById(`laQ${q}Opt${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번을 입력해주세요`);
            if (!document.getElementById(`laQ${q}OptTrans${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번 번역을 입력해주세요`);
            if (!document.getElementById(`laQ${q}OptExp${j}`)?.value?.trim())
                errors.push(`Q${q} 보기 ${j}번 해설을 입력해주세요`);
        }
    }
    return errors;
}

function updateLaRegisterBtn() {
    const btn = document.getElementById('laRegisterBtn');
    if (!btn) return;
    btn.disabled = validateLaForm().length > 0;
}

// ===== 페이로드 빌드 (컬럼명 매핑: Announcement 전용) =====
function buildLaPayload() {
    const setId = laEditMode ? laEditSetId : getLaSetId();
    const setNum = setId.replace(LA_PREFIX, ''); // '0019' 패딩 유지
    const data = {
        id: setId,
        gender: document.getElementById('laGender')?.value || '',
        narration_url: `${LA_NARRATION_BASE}/announcement_nr_${setNum}.mp3`,
        audio_url: `${LA_AUDIO_BASE}/announcement_set_${setNum}.mp3`,
        script: document.getElementById('laScript')?.value?.trim() || '',
        script_trans: document.getElementById('laScriptTrans')?.value?.trim() || '',
        script_highlights: laCardsToHighlights()
    };

    for (let q = 1; q <= LA_Q_COUNT; q++) {
        // Announcement 컬럼명 매핑
        data[`q${q}_question_text`] = document.getElementById(`laQ${q}Question`)?.value?.trim() || '';
        data[`q${q}_question_text_trans`] = document.getElementById(`laQ${q}QuestionTrans`)?.value?.trim() || '';
        data[`q${q}_correct_answer`] = parseInt(document.querySelector(`input[name="laAnswer${q}"]:checked`)?.value || '0');
        for (let j = 1; j <= 4; j++) {
            data[`q${q}_opt${j}`] = document.getElementById(`laQ${q}Opt${j}`)?.value?.trim() || '';
            data[`q${q}_trans${j}`] = document.getElementById(`laQ${q}OptTrans${j}`)?.value?.trim() || '';
            data[`q${q}_exp${j}`] = document.getElementById(`laQ${q}OptExp${j}`)?.value?.trim() || '';
        }
    }
    return data;
}

// ===== 등록 (POST / PATCH) =====
async function registerLaSet() {
    const errors = validateLaForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('laRegisterBtn');
    const data = buildLaPayload();
    const setId = data.id;

    if (laEditMode) {
        if (!confirm(`"${setId}" 세트를 수정하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            const patchData = { ...data };
            delete patchData.id;
            const url = `${SUPABASE_URL}/rest/v1/${LA_TABLE}?id=eq.${setId}`;
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(patchData)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `수정 실패: ${res.status}`); }
            const updated = await res.json();
            if (updated.length === 0) throw new Error('수정된 행이 없습니다. RLS 정책을 확인해주세요.');

            alert(`✅ "${setId}" 수정 완료!`);
            cancelLaEdit();
            await loadLaExistingSets();
        } catch (err) {
            console.error('Announcement 수정 실패:', err);
            alert('❌ 수정 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLaRegisterBtn();
        }
    } else {
        if (laExistingSets.some(s => s.id === setId)) { alert(`❌ "${setId}"는 이미 존재합니다.`); return; }
        if (!confirm(`"${setId}" 세트를 새로 등록하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';
        try {
            const url = `${SUPABASE_URL}/rest/v1/${LA_TABLE}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(data)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `등록 실패: ${res.status}`); }

            alert(`✅ "${setId}" 등록 완료!`);
            resetLaForm();
            await loadLaExistingSets();
        } catch (err) {
            console.error('Announcement 등록 실패:', err);
            alert('❌ 등록 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLaRegisterBtn();
        }
    }
}

// ===== 수정 모드 (컬럼명 매핑: Announcement 전용) =====
async function editLaSet(setId) {
    try {
        const result = await supabaseAPI.query(LA_TABLE, {
            'id': `eq.${setId}`,
            'limit': '1'
        });
        if (!result || result.length === 0) { alert('세트 데이터를 찾을 수 없습니다.'); return; }
        const row = result[0];

        laEditMode = true;
        laEditSetId = setId;
        document.getElementById('laEditModeLabel').style.display = 'inline';
        document.getElementById('laCancelEditBtn').style.display = 'inline-flex';
        document.getElementById('laRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

        updateLaSetDisplay();

        // 성별
        const genderEl = document.getElementById('laGender');
        if (genderEl) genderEl.value = row.gender || '';

        // STEP 1
        setLaVal('laScript', row.script || '');
        setLaVal('laScriptTrans', row.script_trans || '');

        // STEP 2 핵심표현
        laHighlightCards = laHighlightsToCards(row.script_highlights);
        renderLaHighlightCards();

        // STEP 3 Q1/Q2 (Announcement 컬럼명 매핑)
        for (let q = 1; q <= LA_Q_COUNT; q++) {
            setLaVal(`laQ${q}Question`, row[`q${q}_question_text`] || '');
            setLaVal(`laQ${q}QuestionTrans`, row[`q${q}_question_text_trans`] || '');

            const answerRadio = document.querySelector(`input[name="laAnswer${q}"][value="${row[`q${q}_correct_answer`]}"]`);
            if (answerRadio) answerRadio.checked = true;

            for (let j = 1; j <= 4; j++) {
                setLaVal(`laQ${q}Opt${j}`, row[`q${q}_opt${j}`] || '');
                setLaVal(`laQ${q}OptTrans${j}`, row[`q${q}_trans${j}`] || '');
                setLaVal(`laQ${q}OptExp${j}`, row[`q${q}_exp${j}`] || '');
            }

            onLaAnswerChange(q);
            updateLaQHeader(q);
        }

        updateLaRegisterBtn();

        // 기존 세트 → 자동 파일 검증 (2개)
        const narrStatus = document.getElementById('laNarrationStatus');
        const audioStatus = document.getElementById('laAudioStatus');
        if (narrStatus) narrStatus.textContent = '⏳';
        if (audioStatus) audioStatus.textContent = '⏳';

        const [narrOk, audioOk] = await Promise.all([
            laCheckAudio(getLaNarrationUrl()),
            laCheckAudio(getLaAudioUrl())
        ]);
        if (narrStatus) narrStatus.textContent = narrOk ? '✅' : '❌';
        if (audioStatus) audioStatus.textContent = audioOk ? '✅' : '❌';

        document.getElementById('section-listening-announcement')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Announcement 수정 로드 실패:', e);
        alert('수정 로드 실패: ' + (e.message || e));
    }
}

// ===== 수정 취소 =====
function cancelLaEdit() {
    laEditMode = false;
    laEditSetId = null;
    document.getElementById('laEditModeLabel').style.display = 'none';
    document.getElementById('laCancelEditBtn').style.display = 'none';
    document.getElementById('laRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    resetLaForm();
    updateLaSetDisplay();
    updateLaRegisterBtn();
}

// ===== 폼 초기화 =====
function resetLaForm() {
    // 성별
    const genderEl = document.getElementById('laGender');
    if (genderEl) genderEl.value = '';

    // STEP 1
    setLaVal('laScript', '');
    setLaVal('laScriptTrans', '');

    // STEP 2
    laHighlightCards = [{ word: '', translation: '', explanation: '' }];
    renderLaHighlightCards();

    // STEP 3
    for (let q = 1; q <= LA_Q_COUNT; q++) {
        setLaVal(`laQ${q}Question`, '');
        setLaVal(`laQ${q}QuestionTrans`, '');

        document.querySelectorAll(`input[name="laAnswer${q}"]`).forEach(r => r.checked = false);

        for (let j = 1; j <= 4; j++) {
            setLaVal(`laQ${q}Opt${j}`, '');
            setLaVal(`laQ${q}OptTrans${j}`, '');
            setLaVal(`laQ${q}OptExp${j}`, '');

            const wrap = document.getElementById(`laQ${q}Opt${j}Wrap`);
            const badge = document.getElementById(`laQ${q}Opt${j}Badge`);
            if (wrap) wrap.classList.remove('is-answer');
            if (badge) badge.style.display = 'none';
        }

        const sub = document.getElementById(`laQ${q}Sub`);
        if (sub) sub.textContent = '';
    }

    // 검증 상태 초기화
    const narrStatus = document.getElementById('laNarrationStatus');
    const audioStatus = document.getElementById('laAudioStatus');
    if (narrStatus) narrStatus.textContent = '⬜';
    if (audioStatus) audioStatus.textContent = '⬜';

    // 아코디언: Q1 펼침, Q2 접힘
    laAllExpanded = false;
    for (let q = 1; q <= LA_Q_COUNT; q++) {
        const body = document.getElementById(`laQ${q}Body`);
        const arrow = document.getElementById(`laQ${q}Arrow`);
        if (q === 1) {
            if (body) body.classList.add('open');
            if (arrow) arrow.classList.add('open');
        } else {
            if (body) body.classList.remove('open');
            if (arrow) arrow.classList.remove('open');
        }
    }
    const toggleBtn = document.getElementById('laToggleAllBtn');
    if (toggleBtn) toggleBtn.textContent = '전체 펼치기';
}

// ===== 삭제 (hard delete) =====
async function deleteLaSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const delUrl = `${SUPABASE_URL}/rest/v1/${LA_TABLE}?id=eq.${setId}`;
        const delRes = await fetch(delUrl, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
        });
        if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);
        const deleted = await delRes.json();
        if (deleted.length === 0) throw new Error('삭제된 행이 없습니다. RLS 정책을 확인해주세요.');

        alert(`✅ 세트가 삭제되었습니다.`);
        if (laEditMode && laEditSetId === setId) cancelLaEdit();
        await loadLaExistingSets();
    } catch (e) {
        console.error('Announcement 삭제 실패:', e);
        alert('❌ 삭제 실패: ' + (e.message || e));
    }
}

// ===== 유틸 =====
function setLaVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

// ===== 스크립트 줄 수 체크 =====
function checkLaScriptLines() {
    const statusEl = document.getElementById('laScriptLineStatus');
    if (!statusEl) return;
    const script = document.getElementById('laScript')?.value || '';
    const trans = document.getElementById('laScriptTrans')?.value || '';
    const scriptLines = script.trim() ? script.trim().split('\n').length : 0;
    const transLines = trans.trim() ? trans.trim().split('\n').length : 0;
    if (scriptLines === 0 && transLines === 0) {
        statusEl.innerHTML = '';
    } else if (scriptLines === transLines) {
        statusEl.innerHTML = `<span style="color:#16a34a;">✅ 원문 ${scriptLines}줄 / 해석 ${transLines}줄 — 일치</span>`;
    } else {
        statusEl.innerHTML = `<span style="color:#dc2626;">❌ 원문 ${scriptLines}줄 / 해석 ${transLines}줄 — 불일치!</span>`;
    }
}

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', () => {
    initLaQuestions();
});
