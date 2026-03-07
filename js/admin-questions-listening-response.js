// ===== Listening Response 문제 등록 모듈 =====
const LR_TABLE = 'tr_listening_response';
const LR_PREFIX = 'response_set_';
const LR_BASE_URL = 'https://eontoefl.github.io/toefl-audio/listening/response/audio';
const LR_Q_COUNT = 12;

let lrExistingSets = [];   // set_id 문자열 배열
let lrEditMode = false;
let lrEditSetId = null;
let lrNextNum = 1;
let lrAllExpanded = false;

// ===== 초기화: Q1~Q12 아코디언 동적 생성 =====
function initLrQuestions() {
    const wrap = document.getElementById('lrQuestionsWrap');
    if (!wrap) return;
    let html = '';
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        html += buildLrQAccordion(i);
    }
    wrap.innerHTML = html;
}

function buildLrQAccordion(i) {
    // Q1: 성별 변경 시 Q2~Q12 자동 교대 적용
    // Q2~Q12: 개별 변경만 (자동 교대 안 함)
    const genderOnchange = i === 1
        ? `onLrGenderChange(${i})`
        : `onLrQInput(${i})`;

    return `
    <div class="sr-q-item" id="lrQ${i}Item">
        <div class="sr-q-header" onclick="toggleLrQuestion(${i})">
            <div>
                <span class="sr-q-header-title">Q${i}</span>
                <span class="sr-q-header-sub" id="lrQ${i}Sub"></span>
            </div>
            <span class="sr-q-header-arrow" id="lrQ${i}Arrow"><i class="fas fa-chevron-down"></i></span>
        </div>
        <div class="sr-q-body" id="lrQ${i}Body">
            <!-- 화자 성별 -->
            <div class="sr-q-field">
                <label>화자 성별 *${i === 1 ? ' <span style="font-size:11px; color:#3b82f6;">(Q1 선택 시 Q2~Q12 자동 교대 적용)</span>' : ''}</label>
                <div class="lr-gender-radio">
                    <label><input type="radio" name="lrGender${i}" value="F" onchange="${genderOnchange}"> 👩 여성 (F)</label>
                    <label><input type="radio" name="lrGender${i}" value="M" onchange="${genderOnchange}"> 👨 남성 (M)</label>
                </div>
            </div>

            <!-- 대본 -->
            <div class="sr-q-field">
                <label>대본 (Script — 영어) *</label>
                <textarea id="lrQ${i}Script" rows="2" placeholder="Where is the nearest ATM located?" oninput="onLrQInput(${i})"></textarea>
            </div>
            <div class="sr-q-field">
                <label>대본 번역 (한글) *</label>
                <textarea id="lrQ${i}ScriptTrans" rows="2" placeholder="가장 가까운 ATM이 어디에 있나요?"></textarea>
            </div>

            <!-- 정답 선택 -->
            <div class="sr-q-field">
                <label>정답 번호 *</label>
                <div class="lr-answer-radio">
                    <label><input type="radio" name="lrAnswer${i}" value="1" onchange="onLrAnswerChange(${i})"> ①</label>
                    <label><input type="radio" name="lrAnswer${i}" value="2" onchange="onLrAnswerChange(${i})"> ②</label>
                    <label><input type="radio" name="lrAnswer${i}" value="3" onchange="onLrAnswerChange(${i})"> ③</label>
                    <label><input type="radio" name="lrAnswer${i}" value="4" onchange="onLrAnswerChange(${i})"> ④</label>
                </div>
            </div>

            <!-- 보기 1~4 -->
            <div class="lr-option-group">
                ${[1,2,3,4].map(j => `
                <div class="lr-option-item" id="lrQ${i}Opt${j}Wrap">
                    <div class="lr-option-num">
                        ⓘ 보기 ${j}
                        <span class="answer-badge" id="lrQ${i}Opt${j}Badge" style="display:none;">정답</span>
                    </div>
                    <div class="sr-q-field">
                        <label>영어 *</label>
                        <input type="text" id="lrQ${i}Opt${j}" placeholder="보기 ${j} 영어" oninput="updateLrRegisterBtn()">
                    </div>
                    <div class="sr-q-field">
                        <label>번역 (한글) *</label>
                        <input type="text" id="lrQ${i}OptTrans${j}" placeholder="보기 ${j} 번역">
                    </div>
                    <div class="sr-q-field">
                        <label>해설 (한글) *</label>
                        <textarea id="lrQ${i}OptExp${j}" rows="2" placeholder="보기 ${j} 해설"></textarea>
                    </div>
                </div>`).join('')}
            </div>
        </div>
    </div>`;
}

// ===== 아코디언 토글 =====
function toggleLrQuestion(num) {
    const body = document.getElementById(`lrQ${num}Body`);
    const arrow = document.getElementById(`lrQ${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}

function toggleAllLrQuestions() {
    lrAllExpanded = !lrAllExpanded;
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const body = document.getElementById(`lrQ${i}Body`);
        const arrow = document.getElementById(`lrQ${i}Arrow`);
        if (!body) continue;
        if (lrAllExpanded) { body.classList.add('open'); if (arrow) arrow.classList.add('open'); }
        else { body.classList.remove('open'); if (arrow) arrow.classList.remove('open'); }
    }
    const btn = document.getElementById('lrToggleAllBtn');
    if (btn) btn.textContent = lrAllExpanded ? '전체 접기' : '전체 펼치기';
}

// ===== Q1 성별 자동 교대 배치 =====
function onLrGenderChange(num) {
    // Q1 성별 변경 → Q2~Q12 자동 교대 적용
    const q1Gender = document.querySelector(`input[name="lrGender${num}"]:checked`)?.value;
    if (!q1Gender) return;

    for (let i = 2; i <= LR_Q_COUNT; i++) {
        // 홀수 번째(Q1, Q3, Q5...) = Q1과 같은 성별, 짝수 번째(Q2, Q4, Q6...) = 반대 성별
        const targetGender = (i % 2 === 1) ? q1Gender : (q1Gender === 'F' ? 'M' : 'F');
        const radio = document.querySelector(`input[name="lrGender${i}"][value="${targetGender}"]`);
        if (radio) radio.checked = true;
        updateLrQHeader(i);
    }

    // Q1 자신의 헤더도 갱신
    updateLrQHeader(num);
    updateLrRegisterBtn();
}

// ===== 입력 이벤트 =====
function onLrQInput(num) {
    updateLrQHeader(num);
    updateLrRegisterBtn();
}

function onLrAnswerChange(num) {
    // 정답 보기 하이라이트
    for (let j = 1; j <= 4; j++) {
        const wrap = document.getElementById(`lrQ${num}Opt${j}Wrap`);
        const badge = document.getElementById(`lrQ${num}Opt${j}Badge`);
        if (!wrap) continue;
        wrap.classList.remove('is-answer');
        if (badge) badge.style.display = 'none';
    }
    const selected = document.querySelector(`input[name="lrAnswer${num}"]:checked`);
    if (selected) {
        const val = parseInt(selected.value);
        const wrap = document.getElementById(`lrQ${num}Opt${val}Wrap`);
        const badge = document.getElementById(`lrQ${num}Opt${val}Badge`);
        if (wrap) wrap.classList.add('is-answer');
        if (badge) badge.style.display = 'inline';
    }
    updateLrRegisterBtn();
}

function updateLrQHeader(num) {
    const sub = document.getElementById(`lrQ${num}Sub`);
    if (!sub) return;
    const gender = document.querySelector(`input[name="lrGender${num}"]:checked`)?.value || '';
    const script = document.getElementById(`lrQ${num}Script`)?.value?.trim() || '';
    const gLabel = gender ? `(${gender})` : '';
    const preview = script ? (script.length > 40 ? script.substring(0, 40) + '...' : script) : '(미입력)';
    sub.textContent = `${gLabel} — ${preview}`;
}

// ===== 세트 번호 관리 =====
function getLrSetNum() { return String(lrNextNum).padStart(4, '0'); }
function getLrSetId() { return lrEditMode ? lrEditSetId : `${LR_PREFIX}${getLrSetNum()}`; }

function updateLrSetDisplay() {
    const el = document.getElementById('lrSetId');
    if (el) el.textContent = getLrSetId();
    updateLrFileGrid();
}

// ===== 오디오 URL =====
function lrGetAudioUrl(qNum) {
    const setId = getLrSetId();
    const qi = String(qNum).padStart(2, '0');
    return `${LR_BASE_URL}/${setId}_q${qi}.mp3`;
}

function updateLrFileGrid() {
    const grid = document.getElementById('lrFileGrid');
    if (!grid) return;
    const setId = getLrSetId();
    let html = '';
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        const url = `${LR_BASE_URL}/${setId}_q${qi}.mp3`;
        html += `
            <span class="lr-file-label">Q${i} 오디오</span>
            <span class="lr-file-url">${url}</span>
            <button class="sr-url-btn" onclick="window.open('${url}','_blank')" title="새 탭에서 열기">🔗</button>
            <span id="lrFile${i}Status" class="sr-check-icon">⬜</span>`;
    }
    grid.innerHTML = html;
}

// ===== 파일 검증 =====
function lrCheckAudio(url) {
    return new Promise(resolve => {
        const audio = new Audio();
        audio.oncanplaythrough = () => { audio.src = ''; resolve(true); };
        audio.onerror = () => resolve(false);
        audio.src = url;
    });
}

async function verifyLrAllFiles() {
    const setId = getLrSetId();
    const checks = [];
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        checks.push({ idx: i, url: `${LR_BASE_URL}/${setId}_q${qi}.mp3` });
    }

    // 상단 그리드만 ⏳ 표시
    checks.forEach(c => {
        const el = document.getElementById(`lrFile${c.idx}Status`);
        if (el) el.textContent = '⏳';
    });

    const results = await Promise.all(checks.map(async c => {
        const ok = await lrCheckAudio(c.url);
        return { idx: c.idx, ok };
    }));

    // 상단 그리드만 결과 표시
    results.forEach(r => {
        const icon = r.ok ? '✅' : '❌';
        const el = document.getElementById(`lrFile${r.idx}Status`);
        if (el) el.textContent = icon;
    });

    const passed = results.filter(r => r.ok).length;
    alert(`파일 검증 완료: ${passed}/${LR_Q_COUNT}개 존재`);
}

// ===== 오디오 재생 모달 =====
function openLrModal(url) {
    const overlay = document.getElementById('lrAudioModal');
    const body = document.getElementById('lrModalBody');
    if (!overlay || !body) return;
    body.innerHTML = `<div style="text-align:center; padding:20px;">
        <p style="margin-bottom:16px; font-weight:600; color:#1e293b;">🔊 오디오 재생</p>
        <audio controls autoplay style="width:100%;">
            <source src="${url}" type="audio/mpeg">오디오를 재생할 수 없습니다.
        </audio>
        <p style="margin-top:12px; font-size:11px; color:#94a3b8; word-break:break-all;">${url}</p>
    </div>`;
    overlay.classList.add('active');
}

function closeLrModal() {
    const overlay = document.getElementById('lrAudioModal');
    const body = document.getElementById('lrModalBody');
    if (!overlay) return;
    const audio = body?.querySelector('audio');
    if (audio) { audio.pause(); audio.src = ''; }
    overlay.classList.remove('active');
    if (body) body.innerHTML = '';
}

// ===== 기존 세트 목록 로드 =====
async function loadLrExistingSets() {
    try {
        const res = await supabaseAPI.query(LR_TABLE, {
            'select': 'set_id',
            'order': 'set_id.asc',
            'limit': '500'
        });
        const setIds = [...new Set((res || []).map(r => r.set_id))];
        lrExistingSets = setIds;

        if (setIds.length > 0) {
            const lastId = setIds[setIds.length - 1];
            lrNextNum = parseInt(lastId.replace(LR_PREFIX, '')) + 1;
        } else {
            lrNextNum = 1;
        }

        renderLrSetList();
        updateLrSetDisplay();
    } catch (e) {
        console.error('Listening Response 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더링 =====
function renderLrSetList() {
    const wrap = document.getElementById('lrSetsListWrap');
    const count = document.getElementById('lrSetsCount');
    if (count) count.textContent = `${lrExistingSets.length}개`;
    if (!wrap) return;

    if (lrExistingSets.length === 0) {
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">등록된 세트가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = lrExistingSets.map(sid => {
        const num = sid.replace(LR_PREFIX, '');
        return `
        <div class="sr-set-item">
            <div style="display:flex; align-items:center; flex:1; cursor:pointer;" onclick="editLrSet('${escapeHtml(sid)}')">
                <span class="sr-set-item-id">${escapeHtml(sid)}</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="editLrSet('${escapeHtml(sid)}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button onclick="deleteLrSet('${escapeHtml(sid)}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>`;
    }).join('');
}

// ===== 유효성 검증 =====
function validateLrForm() {
    const errors = [];
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const gender = document.querySelector(`input[name="lrGender${i}"]:checked`)?.value;
        const script = document.getElementById(`lrQ${i}Script`)?.value?.trim();
        const scriptTrans = document.getElementById(`lrQ${i}ScriptTrans`)?.value?.trim();
        const answer = document.querySelector(`input[name="lrAnswer${i}"]:checked`)?.value;

        if (!gender) errors.push(`Q${i}: 화자 성별을 선택해주세요`);
        if (!script) errors.push(`Q${i}: 대본을 입력해주세요`);
        if (!scriptTrans) errors.push(`Q${i}: 대본 번역을 입력해주세요`);
        if (!answer) errors.push(`Q${i}: 정답을 선택해주세요`);

        for (let j = 1; j <= 4; j++) {
            if (!document.getElementById(`lrQ${i}Opt${j}`)?.value?.trim())
                errors.push(`Q${i}: 보기 ${j}번을 입력해주세요`);
            if (!document.getElementById(`lrQ${i}OptTrans${j}`)?.value?.trim())
                errors.push(`Q${i}: 보기 ${j}번 번역을 입력해주세요`);
            if (!document.getElementById(`lrQ${i}OptExp${j}`)?.value?.trim())
                errors.push(`Q${i}: 보기 ${j}번 해설을 입력해주세요`);
        }
    }
    return errors;
}

function updateLrRegisterBtn() {
    const btn = document.getElementById('lrRegisterBtn');
    if (!btn) return;
    btn.disabled = validateLrForm().length > 0;
}

// ===== 페이로드 빌드 =====
function buildLrPayload() {
    const setId = lrEditMode ? lrEditSetId : getLrSetId();
    const rows = [];
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        rows.push({
            id: `${setId}_q${qi}`,
            set_id: setId,
            question_num: i,
            audio_url: `${LR_BASE_URL}/${setId}_q${qi}.mp3`,
            gender: document.querySelector(`input[name="lrGender${i}"]:checked`)?.value || '',
            script: document.getElementById(`lrQ${i}Script`)?.value?.trim() || '',
            script_trans: document.getElementById(`lrQ${i}ScriptTrans`)?.value?.trim() || '',
            script_highlights: '[]',
            answer: parseInt(document.querySelector(`input[name="lrAnswer${i}"]:checked`)?.value || '0'),
            option1: document.getElementById(`lrQ${i}Opt1`)?.value?.trim() || '',
            option2: document.getElementById(`lrQ${i}Opt2`)?.value?.trim() || '',
            option3: document.getElementById(`lrQ${i}Opt3`)?.value?.trim() || '',
            option4: document.getElementById(`lrQ${i}Opt4`)?.value?.trim() || '',
            option_trans1: document.getElementById(`lrQ${i}OptTrans1`)?.value?.trim() || '',
            option_trans2: document.getElementById(`lrQ${i}OptTrans2`)?.value?.trim() || '',
            option_trans3: document.getElementById(`lrQ${i}OptTrans3`)?.value?.trim() || '',
            option_trans4: document.getElementById(`lrQ${i}OptTrans4`)?.value?.trim() || '',
            option_exp1: document.getElementById(`lrQ${i}OptExp1`)?.value?.trim() || '',
            option_exp2: document.getElementById(`lrQ${i}OptExp2`)?.value?.trim() || '',
            option_exp3: document.getElementById(`lrQ${i}OptExp3`)?.value?.trim() || '',
            option_exp4: document.getElementById(`lrQ${i}OptExp4`)?.value?.trim() || ''
        });
    }
    return rows;
}

// ===== 등록 (INSERT / UPDATE) =====
async function registerLrSet() {
    const errors = validateLrForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('lrRegisterBtn');
    const rows = buildLrPayload();
    const setId = rows[0].set_id;

    if (lrEditMode) {
        if (!confirm(`"${setId}" 세트를 수정합니다.\n기존 12문제를 삭제 후 새로 저장합니다.\n\n계속하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            // 1. DELETE by set_id
            const delUrl = `${SUPABASE_URL}/rest/v1/${LR_TABLE}?set_id=eq.${setId}`;
            const delRes = await fetch(delUrl, {
                method: 'DELETE',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
            });
            if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);
            const deletedRows = await delRes.json();
            console.log(`LR DELETE 결과: ${deletedRows.length}행 삭제됨`);
            if (deletedRows.length === 0) {
                throw new Error(`삭제된 행이 없습니다. Supabase RLS 정책 또는 set_id를 확인해주세요.`);
            }

            // 2. INSERT batch
            const postUrl = `${SUPABASE_URL}/rest/v1/${LR_TABLE}`;
            const postRes = await fetch(postUrl, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(rows)
            });
            if (!postRes.ok) { const err = await postRes.json(); throw new Error(err.message || `저장 실패: ${postRes.status}`); }

            alert(`✅ "${setId}" 수정 완료!`);
            cancelLrEdit();
            await loadLrExistingSets();
        } catch (err) {
            console.error('Listening Response 수정 실패:', err);
            alert('❌ 수정 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLrRegisterBtn();
        }
    } else {
        // 신규
        if (lrExistingSets.includes(setId)) { alert(`❌ "${setId}"는 이미 존재합니다.`); return; }
        if (!confirm(`"${setId}" 세트를 새로 등록합니다.\n12문제가 저장됩니다.\n\n계속하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';
        try {
            const postUrl = `${SUPABASE_URL}/rest/v1/${LR_TABLE}`;
            const postRes = await fetch(postUrl, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(rows)
            });
            if (!postRes.ok) { const err = await postRes.json(); throw new Error(err.message || `저장 실패: ${postRes.status}`); }

            alert(`✅ "${setId}" 등록 완료!`);
            resetLrForm();
            await loadLrExistingSets();
        } catch (err) {
            console.error('Listening Response 등록 실패:', err);
            alert('❌ 등록 실패: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
            updateLrRegisterBtn();
        }
    }
}

// ===== 수정 모드 =====
async function editLrSet(setId) {
    try {
        const result = await supabaseAPI.query(LR_TABLE, {
            'set_id': `eq.${setId}`,
            'order': 'question_num.asc',
            'limit': '12'
        });
        if (!result || result.length === 0) { alert('세트 데이터를 찾을 수 없습니다.'); return; }

        lrEditMode = true;
        lrEditSetId = setId;
        document.getElementById('lrEditModeLabel').style.display = 'inline';
        document.getElementById('lrCancelEditBtn').style.display = 'inline-flex';
        document.getElementById('lrRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

        updateLrSetDisplay();
        renderLrSetList();

        // 폼 채우기
        result.forEach((row, idx) => {
            const i = idx + 1;
            // 성별
            const genderRadio = document.querySelector(`input[name="lrGender${i}"][value="${row.gender}"]`);
            if (genderRadio) genderRadio.checked = true;

            // 대본
            setLrVal(`lrQ${i}Script`, row.script || '');
            setLrVal(`lrQ${i}ScriptTrans`, row.script_trans || '');

            // 정답
            const answerRadio = document.querySelector(`input[name="lrAnswer${i}"][value="${row.answer}"]`);
            if (answerRadio) answerRadio.checked = true;

            // 보기
            for (let j = 1; j <= 4; j++) {
                setLrVal(`lrQ${i}Opt${j}`, row[`option${j}`] || '');
                setLrVal(`lrQ${i}OptTrans${j}`, row[`option_trans${j}`] || '');
                setLrVal(`lrQ${i}OptExp${j}`, row[`option_exp${j}`] || '');
            }

            // UI 갱신
            onLrAnswerChange(i);
            updateLrQHeader(i);
        });

        updateLrRegisterBtn();

        // 기존 세트 → 자동 파일 검증
        await verifyLrAllFiles();

        document.getElementById('section-listening-response')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Listening Response 수정 로드 실패:', e);
        alert('수정 로드 실패: ' + (e.message || e));
    }
}

// ===== 수정 취소 =====
function cancelLrEdit() {
    lrEditMode = false;
    lrEditSetId = null;
    document.getElementById('lrEditModeLabel').style.display = 'none';
    document.getElementById('lrCancelEditBtn').style.display = 'none';
    document.getElementById('lrRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    resetLrForm();
    updateLrSetDisplay();
    renderLrSetList();
    updateLrRegisterBtn();
}

// ===== 폼 초기화 =====
function resetLrForm() {
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        // 성별 초기화
        const genderRadios = document.querySelectorAll(`input[name="lrGender${i}"]`);
        genderRadios.forEach(r => r.checked = false);

        // 대본 초기화
        setLrVal(`lrQ${i}Script`, '');
        setLrVal(`lrQ${i}ScriptTrans`, '');

        // 정답 초기화
        const answerRadios = document.querySelectorAll(`input[name="lrAnswer${i}"]`);
        answerRadios.forEach(r => r.checked = false);

        // 보기 초기화
        for (let j = 1; j <= 4; j++) {
            setLrVal(`lrQ${i}Opt${j}`, '');
            setLrVal(`lrQ${i}OptTrans${j}`, '');
            setLrVal(`lrQ${i}OptExp${j}`, '');

            const wrap = document.getElementById(`lrQ${i}Opt${j}Wrap`);
            const badge = document.getElementById(`lrQ${i}Opt${j}Badge`);
            if (wrap) wrap.classList.remove('is-answer');
            if (badge) badge.style.display = 'none';
        }

        // 헤더 초기화
        const sub = document.getElementById(`lrQ${i}Sub`);
        if (sub) sub.textContent = '';
    }

    // 파일 검증 그리드 초기화
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const el = document.getElementById(`lrFile${i}Status`);
        if (el) el.textContent = '⬜';
    }

    // 아코디언 접기
    lrAllExpanded = false;
    for (let i = 1; i <= LR_Q_COUNT; i++) {
        const body = document.getElementById(`lrQ${i}Body`);
        const arrow = document.getElementById(`lrQ${i}Arrow`);
        if (body) body.classList.remove('open');
        if (arrow) arrow.classList.remove('open');
    }
    const toggleBtn = document.getElementById('lrToggleAllBtn');
    if (toggleBtn) toggleBtn.textContent = '전체 펼치기';
}

// ===== 삭제 (hard delete) =====
async function deleteLrSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제하시겠습니까?\n12문제가 모두 삭제됩니다.\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const delUrl = `${SUPABASE_URL}/rest/v1/${LR_TABLE}?set_id=eq.${setId}`;
        const delRes = await fetch(delUrl, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
        });
        if (!delRes.ok) throw new Error(`삭제 실패: ${delRes.status}`);
        const deleted = await delRes.json();
        if (deleted.length === 0) throw new Error(`삭제된 행이 없습니다.`);

        alert(`세트가 삭제되었습니다. (${deleted.length}행)`);
        if (lrEditMode && lrEditSetId === setId) cancelLrEdit();
        await loadLrExistingSets();
    } catch (e) {
        console.error('Listening Response 삭제 실패:', e);
        alert('삭제 실패: ' + (e.message || e));
    }
}

// ===== 유틸 =====
function setLrVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

// ===== DOMContentLoaded에서 아코디언 생성 =====
document.addEventListener('DOMContentLoaded', () => {
    initLrQuestions();
});
