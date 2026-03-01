// ===== Speaking Interview 관리 모듈 =====
const SI_TABLE = 'tr_speaking_interview';
const SI_PREFIX = 'interview_set_';
const SI_BASE_URL = 'https://eontoefl.github.io/toefl-audio/speaking/interview';
const SI_Q_COUNT = 4;

let siExistingSets = [];
let siEditingSet = null;
let siNextNum = 1;
let siAllExpanded = false;
let siCurrentAudio = null;

// ===== 성별 판별 =====
function getSiGender(num) {
    return (parseInt(num) % 2 === 0) ? 'female' : 'male';
}

function getSiGenderLabel(num) {
    return getSiGender(num) === 'male' ? '👨 남자 세트' : '👩 여자 세트';
}

function updateSiGenderBadge(num) {
    const badge = document.getElementById('siGenderBadge');
    if (!badge) return;
    const g = getSiGender(num);
    badge.className = `si-gender-badge ${g}`;
    badge.textContent = getSiGenderLabel(num);
}

// ===== 초기화: V1~V4 아코디언 생성 =====
function initSiQuestions() {
    const wrap = document.getElementById('siQuestionsWrap');
    if (!wrap) return;
    let html = '';
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        html += `
        <div class="sr-q-item" id="siV${i}Item">
            <div class="sr-q-header" onclick="toggleSiQuestion(${i})">
                <div>
                    <span class="sr-q-header-title">V${i}</span>
                    <span class="sr-q-header-sub" id="siV${i}Sub"></span>
                </div>
                <span class="sr-q-header-arrow" id="siV${i}Arrow"><i class="fas fa-chevron-down"></i></span>
            </div>
            <div class="sr-q-body" id="siV${i}Body">
                <div class="sr-q-field">
                    <label>질문 스크립트 (영어) *</label>
                    <textarea id="siV${i}Script" rows="2" placeholder="Can you tell me about yourself?" oninput="onSiVInput(${i})"></textarea>
                </div>
                <div class="sr-q-field">
                    <label>질문 번역 (한글)</label>
                    <textarea id="siV${i}Translation" rows="2" placeholder="자기소개를 해주시겠어요?"></textarea>
                </div>
                <div class="sr-q-field">
                    <label>모범 답변 (영어) *</label>
                    <textarea id="siV${i}ModelAnswer" rows="3" placeholder="I am a marketing professional..." oninput="updateSiRegisterBtn()"></textarea>
                </div>
                <div class="sr-q-field">
                    <label>모범 답변 번역 (한글)</label>
                    <textarea id="siV${i}ModelAnswerTrans" rows="3" placeholder="저는 마케팅 전문가입니다..."></textarea>
                </div>
                <div class="sr-q-field">
                    <label>핵심 표현</label>
                    <table class="si-hl-table" id="siV${i}HlTable">
                        <thead><tr><th style="width:30%">키워드 (key)</th><th style="width:35%">제목 (title)</th><th style="width:35%">설명 (description)</th></tr></thead>
                        <tbody id="siV${i}HlBody">
                            <tr>
                                <td><input type="text" placeholder="I believe"></td>
                                <td><input type="text" placeholder="피드백 제목"></td>
                                <td><input type="text" placeholder="피드백 상세 설명"></td>
                            </tr>
                        </tbody>
                    </table>
                    <div style="margin-top: 6px; display: flex; gap: 6px;">
                        <button class="si-hl-add-btn" onclick="addSiHighlightRow(${i})">+ 키워드 추가</button>
                        <button class="si-hl-del-btn" onclick="removeSiHighlightRow(${i})">- 마지막 삭제</button>
                    </div>
                </div>
            </div>
        </div>`;
    }
    wrap.innerHTML = html;
}

// ===== 핵심 표현 행 추가/삭제 =====
function addSiHighlightRow(vNum) {
    const tbody = document.getElementById(`siV${vNum}HlBody`);
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" placeholder="키워드"></td>
        <td><input type="text" placeholder="제목"></td>
        <td><input type="text" placeholder="설명"></td>`;
    tbody.appendChild(tr);
}

function removeSiHighlightRow(vNum) {
    const tbody = document.getElementById(`siV${vNum}HlBody`);
    if (!tbody || tbody.rows.length <= 1) return;
    tbody.deleteRow(tbody.rows.length - 1);
}

// ===== 핵심 표현 → JSON 빌드 =====
function buildSiHighlightsJSON(vNum) {
    const tbody = document.getElementById(`siV${vNum}HlBody`);
    if (!tbody) return '{}';
    const result = {};
    for (const row of tbody.rows) {
        const inputs = row.querySelectorAll('input');
        const key = inputs[0]?.value?.trim() || '';
        const title = inputs[1]?.value?.trim() || '';
        const description = inputs[2]?.value?.trim() || '';
        if (key) {
            result[key] = { title, description };
        }
    }
    return Object.keys(result).length > 0 ? JSON.stringify(result) : '{}';
}

// ===== JSON → 핵심 표현 테이블 로드 =====
function loadSiHighlights(vNum, jsonStr) {
    const tbody = document.getElementById(`siV${vNum}HlBody`);
    if (!tbody) return;
    tbody.innerHTML = '';
    let data;
    try { data = JSON.parse(jsonStr || '{}'); } catch { data = {}; }
    // 새 형식: { "키워드": { "title": ..., "description": ... } }
    // 레거시 형식: { "expressions": [{ "phrase", "meaning", "usage" }] }
    let entries = [];
    if (data.expressions && Array.isArray(data.expressions)) {
        // 레거시 형식 호환
        entries = data.expressions.map(e => ({ key: e.phrase || '', title: e.meaning || '', description: e.usage || '' }));
    } else {
        entries = Object.entries(data).map(([k, v]) => ({ key: k, title: v?.title || '', description: v?.description || '' }));
    }
    if (entries.length === 0) {
        addSiHighlightRow(vNum);
        return;
    }
    for (const e of entries) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${escapeHtml(e.key || '')}"></td>
            <td><input type="text" value="${escapeHtml(e.title || '')}"></td>
            <td><input type="text" value="${escapeHtml(e.description || '')}"></td>`;
        tbody.appendChild(tr);
    }
}

// ===== 아코디언 토글 =====
function toggleSiQuestion(num) {
    const body = document.getElementById(`siV${num}Body`);
    const arrow = document.getElementById(`siV${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function toggleAllSiQuestions() {
    siAllExpanded = !siAllExpanded;
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const body = document.getElementById(`siV${i}Body`);
        const arrow = document.getElementById(`siV${i}Arrow`);
        if (!body) continue;
        if (siAllExpanded) { body.classList.add('open'); arrow.classList.add('open'); }
        else { body.classList.remove('open'); arrow.classList.remove('open'); }
    }
    const btn = document.querySelector('#section-speaking-interview .sr-toggle-all-btn');
    if (btn) btn.textContent = siAllExpanded ? '전체 접기' : '전체 펼치기';
}

// ===== V 입력 시 헤더 서브타이틀 업데이트 =====
function onSiVInput(num) {
    const script = document.getElementById(`siV${num}Script`);
    const sub = document.getElementById(`siV${num}Sub`);
    if (script && sub) {
        const text = script.value.trim();
        sub.textContent = text ? (text.length > 40 ? text.substring(0, 40) + '...' : text) : '';
    }
    updateSiRegisterBtn();
}

// ===== 세트 번호 관리 =====
function getSiSetNum() { return String(siNextNum).padStart(4, '0'); }
function getSiSetId() { return siEditingSet ? siEditingSet.id : `${SI_PREFIX}${getSiSetNum()}`; }
function getSiCurrentNum() {
    return siEditingSet ? siEditingSet.id.replace(SI_PREFIX, '') : getSiSetNum();
}

function updateSiSetDisplay() {
    const idEl = document.getElementById('siSetId');
    if (idEl) idEl.textContent = getSiSetId();
    const num = getSiCurrentNum();
    updateSiGenderBadge(num);
    updateSiFileGrid(num);
}

// ===== 파일 URL 그리드 생성 =====
function updateSiFileGrid(setNum) {
    const grid = document.getElementById('siFileGrid');
    if (!grid) return;
    const g = getSiGender(setNum);
    const gLabel = g === 'male' ? '남자' : '여자';

    const files = [
        { label: '나레이션 오디오', url: `${SI_BASE_URL}/narration/${SI_PREFIX}${setNum}_nr.mp3`, id: 'siFileNr', type: 'audio' },
        { label: `베이스 이미지 (${gLabel})`, url: `${SI_BASE_URL}/contextimage/interview_baseimage_${g}.png`, id: 'siFileImg', type: 'image' },
        { label: `끄덕임 비디오 (${gLabel})`, url: `${SI_BASE_URL}/video/nodding_video_${g === 'female' ? 'f' : 'm'}.mp4`, id: 'siFileNod', type: 'video' },
    ];
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        files.push({ label: `V${i} 질문 영상`, url: `${SI_BASE_URL}/video/${SI_PREFIX}${setNum}_q${qi}.mp4`, id: `siFileV${i}`, type: 'video' });
    }
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        files.push({ label: `V${i} 모범답안 오디오`, url: `${SI_BASE_URL}/sampleanswer/${SI_PREFIX}${setNum}_sa${qi}.mp3`, id: `siFileSa${i}`, type: 'audio' });
    }

    grid.innerHTML = files.map(f => `
        <span class="si-file-label">${f.label}</span>
        <span class="si-file-url" id="${f.id}Url">${f.url}</span>
        <button class="sr-url-btn" onclick="window.open('${f.url}','_blank')" title="새 탭에서 열기">🔗</button>
        <span id="${f.id}Status" class="sr-check-icon">⬜</span>
    `).join('');
}

// ===== 파일 검증 =====
function siCheckImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}
function siCheckAudio(url) {
    return new Promise(resolve => {
        const audio = new Audio();
        audio.oncanplaythrough = () => { audio.src = ''; resolve(true); };
        audio.onerror = () => resolve(false);
        audio.src = url;
    });
}
function siCheckVideo(url) {
    return new Promise(resolve => {
        const video = document.createElement('video');
        video.onloadeddata = () => { video.src = ''; resolve(true); };
        video.onerror = () => resolve(false);
        video.src = url;
    });
}

async function verifySiAllFiles() {
    const setNum = getSiCurrentNum();
    const g = getSiGender(setNum);

    const checks = [
        { id: 'siFileNr', url: `${SI_BASE_URL}/narration/${SI_PREFIX}${setNum}_nr.mp3`, type: 'audio' },
        { id: 'siFileImg', url: `${SI_BASE_URL}/contextimage/interview_baseimage_${g}.png`, type: 'image' },
        { id: 'siFileNod', url: `${SI_BASE_URL}/video/nodding_video_${g === 'female' ? 'f' : 'm'}.mp4`, type: 'video' },
    ];
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        checks.push({ id: `siFileV${i}`, url: `${SI_BASE_URL}/video/${SI_PREFIX}${setNum}_q${qi}.mp4`, type: 'video' });
        checks.push({ id: `siFileSa${i}`, url: `${SI_BASE_URL}/sampleanswer/${SI_PREFIX}${setNum}_sa${qi}.mp3`, type: 'audio' });
    }

    // 모두 ⏳
    checks.forEach(c => { const el = document.getElementById(`${c.id}Status`); if (el) el.textContent = '⏳'; });

    // 병렬 검증
    const results = await Promise.all(checks.map(async c => {
        let ok = false;
        if (c.type === 'audio') ok = await siCheckAudio(c.url);
        else if (c.type === 'image') ok = await siCheckImage(c.url);
        else ok = await siCheckVideo(c.url);
        return { id: c.id, ok };
    }));

    results.forEach(r => {
        const el = document.getElementById(`${r.id}Status`);
        if (el) el.textContent = r.ok ? '✅' : '❌';
    });

    alert('파일 검증이 완료되었습니다.');
}

// ===== 기존 세트 목록 로드 =====
async function loadSiExistingSets() {
    try {
        const res = await supabaseAPI.query(SI_TABLE, { order: 'id.asc', limit: '500' });
        siExistingSets = res || [];
        if (siExistingSets.length > 0) {
            const lastId = siExistingSets[siExistingSets.length - 1].id;
            const lastNum = parseInt(lastId.replace(SI_PREFIX, '')) || 0;
            siNextNum = lastNum + 1;
        } else {
            siNextNum = 1;
        }
        updateSiSetDisplay();
        renderSiSetsList();
    } catch (e) {
        console.error('Speaking Interview 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더링 =====
function renderSiSetsList() {
    const wrap = document.getElementById('siSetsListWrap');
    const count = document.getElementById('siSetsCount');
    if (count) count.textContent = `${siExistingSets.length}개`;
    if (!wrap) return;

    if (siExistingSets.length === 0) {
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">등록된 세트가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = siExistingSets.map(s => {
        const num = s.id.replace(SI_PREFIX, '');
        const gIcon = getSiGender(num) === 'male' ? '👨' : '👩';
        const ctx = s.context_text ? (s.context_text.length > 40 ? s.context_text.substring(0, 40) + '...' : s.context_text) : '';
        return `
        <div class="sr-set-item">
            <div style="display:flex; align-items:center; flex:1; cursor:pointer;" onclick="editSiSet('${escapeHtml(s.id)}')">
                <span class="sr-set-item-id">${escapeHtml(s.id)} ${gIcon}</span>
                <span class="sr-set-item-ctx">${escapeHtml(ctx)}</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="editSiSet('${escapeHtml(s.id)}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button onclick="deleteSiSet('${escapeHtml(s.id)}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>`;
    }).join('');
}

// ===== 미리보기 =====
function renderSiPreview() {
    const previewEl = document.getElementById('siPreviewContent');
    if (!previewEl) return;

    const setNum = getSiCurrentNum();
    const g = getSiGender(setNum);
    const gLabel = g === 'male' ? '👨 남자' : '👩 여자';
    const ctx = document.getElementById('siContextText')?.value?.trim() || '';
    const ctxTrans = document.getElementById('siContextTrans')?.value?.trim() || '';

    const nrUrl = `${SI_BASE_URL}/narration/${SI_PREFIX}${setNum}_nr.mp3`;

    let html = `<div class="sr-preview-card">
        <h4>🎬 ${SI_PREFIX}${setNum} (${gLabel})</h4>
        <div class="sr-preview-script">${escapeHtml(ctx) || '<span style="color:#94a3b8;">미입력</span>'}</div>
        ${ctxTrans ? `<div class="sr-preview-trans">${escapeHtml(ctxTrans)}</div>` : ''}
        <button class="sr-preview-play" onclick="openSiModal('audio','${nrUrl}')">▶️ 나레이션 재생</button>
    </div>`;

    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        const script = document.getElementById(`siV${i}Script`)?.value?.trim() || '';
        const trans = document.getElementById(`siV${i}Translation`)?.value?.trim() || '';
        const answer = document.getElementById(`siV${i}ModelAnswer`)?.value?.trim() || '';
        const answerTrans = document.getElementById(`siV${i}ModelAnswerTrans`)?.value?.trim() || '';
        const videoUrl = `${SI_BASE_URL}/video/${SI_PREFIX}${setNum}_q${qi}.mp4`;
        const saUrl = `${SI_BASE_URL}/sampleanswer/${SI_PREFIX}${setNum}_sa${qi}.mp3`;
        const hlJson = buildSiHighlightsJSON(i);
        let hlText = '';
        try {
            const hl = JSON.parse(hlJson);
            const keys = Object.keys(hl);
            if (keys.length > 0) {
                hlText = keys.join(', ');
            }
        } catch {}

        html += `<div class="sr-preview-card">
            <h4>V${i}</h4>
            <button class="sr-preview-play" onclick="openSiModal('video','${videoUrl}')" style="margin-bottom:8px;">▶️ 질문 영상</button>
            <div class="sr-preview-script"><strong>Q:</strong> ${escapeHtml(script) || '<span style="color:#94a3b8;">미입력</span>'}</div>
            ${trans ? `<div class="sr-preview-trans">${escapeHtml(trans)}</div>` : ''}
            <div style="margin-top:6px;" class="sr-preview-script"><strong>모범답변:</strong> ${escapeHtml(answer) || '<span style="color:#94a3b8;">미입력</span>'}</div>
            ${answerTrans ? `<div class="sr-preview-trans">${escapeHtml(answerTrans)}</div>` : ''}
            <button class="sr-preview-play" onclick="openSiModal('audio','${saUrl}')" style="margin-top:6px;">▶️ 모범답변 오디오</button>
            ${hlText ? `<div style="margin-top:6px; font-size:12px; color:#64748b;">핵심표현: ${escapeHtml(hlText)}</div>` : ''}
        </div>`;
    }

    previewEl.innerHTML = html;
    previewEl.style.display = 'block';
}

// ===== 모달 재생 =====
function openSiModal(type, url) {
    const overlay = document.getElementById('siMediaModal');
    const body = document.getElementById('siModalBody');
    if (!overlay || !body) return;

    // 이전 오디오 정지
    if (siCurrentAudio) { siCurrentAudio.pause(); siCurrentAudio = null; }

    if (type === 'video') {
        body.innerHTML = `<video controls autoplay playsinline webkit-playsinline style="width:100%; border-radius:10px;">
            <source src="${url}" type="video/mp4">비디오를 재생할 수 없습니다.
        </video>`;
    } else {
        body.innerHTML = `<div style="text-align:center; padding:20px;">
            <p style="margin-bottom:16px; font-weight:600; color:#1e293b;">🔊 오디오 재생</p>
            <audio controls autoplay style="width:100%;">
                <source src="${url}" type="audio/mpeg">오디오를 재생할 수 없습니다.
            </audio>
        </div>`;
    }

    overlay.classList.add('active');
}

function closeSiModal() {
    const overlay = document.getElementById('siMediaModal');
    const body = document.getElementById('siModalBody');
    if (!overlay) return;
    // 미디어 정지
    const video = body?.querySelector('video');
    const audio = body?.querySelector('audio');
    if (video) { video.pause(); video.src = ''; }
    if (audio) { audio.pause(); audio.src = ''; }
    overlay.classList.remove('active');
    if (body) body.innerHTML = '';
}

// ===== 등록 버튼 활성화 =====
function updateSiRegisterBtn() {
    const btn = document.getElementById('siRegisterBtn');
    if (!btn) return;
    const ctx = document.getElementById('siContextText')?.value?.trim();
    if (!ctx) { btn.disabled = true; return; }
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        if (!document.getElementById(`siV${i}Script`)?.value?.trim()) { btn.disabled = true; return; }
        if (!document.getElementById(`siV${i}ModelAnswer`)?.value?.trim()) { btn.disabled = true; return; }
    }
    btn.disabled = false;
}

// ===== 유효성 검증 =====
function validateSiForm() {
    if (!document.getElementById('siContextText')?.value?.trim()) { alert('상황 설명을 입력해주세요.'); return false; }
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        if (!document.getElementById(`siV${i}Script`)?.value?.trim()) { alert(`V${i} 질문 스크립트를 입력해주세요.`); return false; }
        if (!document.getElementById(`siV${i}ModelAnswer`)?.value?.trim()) { alert(`V${i} 모범 답변을 입력해주세요.`); return false; }
    }
    if (!siEditingSet) {
        if (siExistingSets.some(s => s.id === getSiSetId())) { alert('이미 존재하는 세트입니다.'); return false; }
    }
    return true;
}

// ===== 데이터 빌드 =====
function buildSiPayload() {
    const setNum = getSiCurrentNum();
    const g = getSiGender(setNum);

    const data = {
        id: getSiSetId(),
        context_text: document.getElementById('siContextText').value.trim(),
        context_translation: document.getElementById('siContextTrans')?.value?.trim() || '',
        context_audio: `${SI_BASE_URL}/narration/${SI_PREFIX}${setNum}_nr.mp3`,
        context_image: `${SI_BASE_URL}/contextimage/interview_baseimage_${g}.png`,
        nodding_video: `${SI_BASE_URL}/video/nodding_video_${g === 'female' ? 'f' : 'm'}.mp4`,
    };

    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        data[`v${i}_video`] = `${SI_BASE_URL}/video/${SI_PREFIX}${setNum}_q${qi}.mp4`;
        data[`v${i}_script`] = document.getElementById(`siV${i}Script`).value.trim();
        data[`v${i}_translation`] = document.getElementById(`siV${i}Translation`)?.value?.trim() || '';
        data[`v${i}_model_answer`] = document.getElementById(`siV${i}ModelAnswer`).value.trim();
        data[`v${i}_model_answer_trans`] = document.getElementById(`siV${i}ModelAnswerTrans`)?.value?.trim() || '';
        data[`v${i}_model_answer_audio`] = `${SI_BASE_URL}/sampleanswer/${SI_PREFIX}${setNum}_sa${qi}.mp3`;
        data[`v${i}_highlights`] = buildSiHighlightsJSON(i);
    }

    return data;
}

// ===== 등록 (INSERT / UPDATE) =====
async function registerSiSet() {
    if (!validateSiForm()) return;

    const btn = document.getElementById('siRegisterBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

    try {
        const data = buildSiPayload();
        if (siEditingSet) {
            await supabaseAPI.patch(SI_TABLE, siEditingSet.id, data);
            alert('세트가 수정되었습니다.');
        } else {
            await supabaseAPI.post(SI_TABLE, data);
            alert('세트가 등록되었습니다.');
        }
        cancelSiEdit();
        await loadSiExistingSets();
    } catch (e) {
        console.error('저장 실패:', e);
        alert('저장 실패: ' + (e.message || e));
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        updateSiRegisterBtn();
    }
}

// ===== 수정 모드 =====
async function editSiSet(setId) {
    const set = siExistingSets.find(s => s.id === setId);
    if (!set) { alert('세트를 찾을 수 없습니다.'); return; }

    siEditingSet = set;

    document.getElementById('siEditModeLabel').style.display = 'inline';
    document.getElementById('siCancelEditBtn').style.display = 'inline-flex';
    document.getElementById('siRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

    updateSiSetDisplay();

    // 폼 채우기
    document.getElementById('siContextText').value = set.context_text || '';
    document.getElementById('siContextTrans').value = set.context_translation || '';

    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const sEl = document.getElementById(`siV${i}Script`);
        const tEl = document.getElementById(`siV${i}Translation`);
        const maEl = document.getElementById(`siV${i}ModelAnswer`);
        const matEl = document.getElementById(`siV${i}ModelAnswerTrans`);

        if (sEl) sEl.value = set[`v${i}_script`] || '';
        if (tEl) tEl.value = set[`v${i}_translation`] || '';
        if (maEl) maEl.value = set[`v${i}_model_answer`] || '';
        if (matEl) matEl.value = set[`v${i}_model_answer_trans`] || '';

        loadSiHighlights(i, set[`v${i}_highlights`] || '{}');
        onSiVInput(i);
    }

    updateSiRegisterBtn();

    // 기존 세트 → 자동 검증
    await verifySiAllFiles();

    document.getElementById('section-speaking-interview')?.scrollIntoView({ behavior: 'smooth' });
}

// ===== 수정 취소 =====
function cancelSiEdit() {
    siEditingSet = null;

    document.getElementById('siEditModeLabel').style.display = 'none';
    document.getElementById('siCancelEditBtn').style.display = 'none';
    document.getElementById('siRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    document.getElementById('siContextText').value = '';
    document.getElementById('siContextTrans').value = '';

    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const sEl = document.getElementById(`siV${i}Script`);
        const tEl = document.getElementById(`siV${i}Translation`);
        const maEl = document.getElementById(`siV${i}ModelAnswer`);
        const matEl = document.getElementById(`siV${i}ModelAnswerTrans`);
        if (sEl) sEl.value = '';
        if (tEl) tEl.value = '';
        if (maEl) maEl.value = '';
        if (matEl) matEl.value = '';

        // 핵심 표현 초기화
        const tbody = document.getElementById(`siV${i}HlBody`);
        if (tbody) {
            tbody.innerHTML = '';
            addSiHighlightRow(i);
        }

        setTextSafe(`siV${i}Sub`, '');
    }

    // 검증 상태 초기화
    const grid = document.getElementById('siFileGrid');
    if (grid) {
        grid.querySelectorAll('.sr-check-icon').forEach(el => el.textContent = '⬜');
    }

    // 미리보기 숨기기
    const preview = document.getElementById('siPreviewContent');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }

    // 아코디언 접기
    siAllExpanded = false;
    for (let i = 1; i <= SI_Q_COUNT; i++) {
        const body = document.getElementById(`siV${i}Body`);
        const arrow = document.getElementById(`siV${i}Arrow`);
        if (body) body.classList.remove('open');
        if (arrow) arrow.classList.remove('open');
    }
    const toggleBtn = document.querySelector('#section-speaking-interview .sr-toggle-all-btn');
    if (toggleBtn) toggleBtn.textContent = '전체 펼치기';

    updateSiSetDisplay();
    updateSiRegisterBtn();
}

// ===== 삭제 (hard delete) =====
async function deleteSiSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete(SI_TABLE, setId);
        alert('세트가 삭제되었습니다.');
        if (siEditingSet && siEditingSet.id === setId) cancelSiEdit();
        await loadSiExistingSets();
    } catch (e) {
        console.error('삭제 실패:', e);
        alert('삭제 실패: ' + (e.message || e));
    }
}

// ===== setTextSafe (Repeat에서 이미 정의되어 있으면 스킵) =====
if (typeof setTextSafe === 'undefined') {
    function setTextSafe(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }
}

// ===== 페이지 로드 시 V 아코디언 생성 =====
document.addEventListener('DOMContentLoaded', () => {
    initSiQuestions();
});
