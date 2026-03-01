// ===== Speaking Repeat 관리 모듈 =====
const SR_TABLE = 'tr_speaking_repeat';
const SR_PREFIX = 'repeat_set_';
const SR_BASE_URL = 'https://eontoefl.github.io/toefl-audio/speaking/repeat';
const SR_Q_COUNT = 7;

let srExistingSets = [];
let srEditingSet = null;
let srNextNum = 1;
let srAllExpanded = false;
let srCurrentAudio = null; // 현재 재생 중인 오디오

// ===== 초기화 =====
function initSrQuestions() {
    const wrap = document.getElementById('srQuestionsWrap');
    if (!wrap) return;
    let html = '';
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        html += `
        <div class="sr-q-item" id="srQ${i}Item">
            <div class="sr-q-header" onclick="toggleSrQuestion(${i})">
                <div>
                    <span class="sr-q-header-title">Q${i}</span>
                    <span class="sr-q-header-sub" id="srQ${i}Sub"></span>
                </div>
                <span class="sr-q-header-arrow" id="srQ${i}Arrow"><i class="fas fa-chevron-down"></i></span>
            </div>
            <div class="sr-q-body" id="srQ${i}Body">
                <div class="sr-url-row">
                    <span class="sr-url-label">오디오:</span>
                    <span id="srQ${i}AudioUrl" class="sr-url-text">-</span>
                    <button class="sr-url-btn" onclick="window.open(document.getElementById('srQ${i}AudioUrl').textContent, '_blank')" title="새 탭에서 열기">🔗</button>
                    <span id="srQ${i}AudioStatus" class="sr-check-icon">⬜</span>
                </div>
                <div class="sr-url-row" style="margin-bottom: 12px;">
                    <span class="sr-url-label">이미지:</span>
                    <span id="srQ${i}ImageUrl" class="sr-url-text">-</span>
                    <button class="sr-url-btn" onclick="window.open(document.getElementById('srQ${i}ImageUrl').textContent, '_blank')" title="새 탭에서 열기">🔗</button>
                    <span id="srQ${i}ImageStatus" class="sr-check-icon">⬜</span>
                </div>
                <div class="sr-q-field">
                    <label>스크립트 (영어) *</label>
                    <textarea id="srQ${i}Script" rows="2" placeholder="Good afternoon, welcome to..." oninput="onSrQInput(${i})"></textarea>
                </div>
                <div class="sr-q-field">
                    <label>번역 (한글)</label>
                    <textarea id="srQ${i}Translation" rows="2" placeholder="안녕하세요, 그랜드 호텔에..."></textarea>
                </div>
                <div class="sr-q-field">
                    <label>응답시간 (초, 기본 10)</label>
                    <input type="number" id="srQ${i}Time" value="10" min="1" max="60" style="max-width: 100px;">
                </div>
            </div>
        </div>`;
    }
    wrap.innerHTML = html;
}

// ===== 아코디언 토글 =====
function toggleSrQuestion(num) {
    const body = document.getElementById(`srQ${num}Body`);
    const arrow = document.getElementById(`srQ${num}Arrow`);
    if (!body) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function toggleAllSrQuestions() {
    srAllExpanded = !srAllExpanded;
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const body = document.getElementById(`srQ${i}Body`);
        const arrow = document.getElementById(`srQ${i}Arrow`);
        if (!body) continue;
        if (srAllExpanded) {
            body.classList.add('open');
            arrow.classList.add('open');
        } else {
            body.classList.remove('open');
            arrow.classList.remove('open');
        }
    }
    const btn = document.querySelector('.sr-toggle-all-btn');
    if (btn) btn.textContent = srAllExpanded ? '전체 접기' : '전체 펼치기';
}

// ===== Q 입력 시 헤더 미리보기 업데이트 =====
function onSrQInput(num) {
    const script = document.getElementById(`srQ${num}Script`);
    const sub = document.getElementById(`srQ${num}Sub`);
    if (script && sub) {
        const text = script.value.trim();
        sub.textContent = text ? (text.length > 40 ? text.substring(0, 40) + '...' : text) : '';
    }
    updateSrRegisterBtn();
}

// ===== 세트 번호 관리 =====
function getSrSetNum() {
    return String(srNextNum).padStart(4, '0');
}

function getSrSetId() {
    return srEditingSet ? srEditingSet.id : `${SR_PREFIX}${getSrSetNum()}`;
}

function updateSrSetDisplay() {
    const idEl = document.getElementById('srSetId');
    if (idEl) idEl.textContent = getSrSetId();
    // URL 자동 생성
    const num = srEditingSet
        ? srEditingSet.id.replace(SR_PREFIX, '')
        : getSrSetNum();
    updateSrUrls(num);
}

// ===== URL 자동 생성 =====
function updateSrUrls(setNum) {
    // 나레이션
    const nrAudio = `${SR_BASE_URL}/narration/${SR_PREFIX}${setNum}_nr.mp3`;
    const nrImage = `${SR_BASE_URL}/baseimage/${SR_PREFIX}${setNum}_baseimage.png`;
    setTextSafe('srNarrationAudioUrl', nrAudio);
    setTextSafe('srNarrationImageUrl', nrImage);
    // Q1~Q7
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        setTextSafe(`srQ${i}AudioUrl`, `${SR_BASE_URL}/audio/${SR_PREFIX}${setNum}_q${qi}.mp3`);
        setTextSafe(`srQ${i}ImageUrl`, `${SR_BASE_URL}/baseimage/${SR_PREFIX}${setNum}_q${qi}.png`);
    }
}

function setTextSafe(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ===== 기존 세트 목록 로드 =====
async function loadSrExistingSets() {
    try {
        const res = await supabaseAPI.query(SR_TABLE, { order: 'id.asc', limit: '500' });
        srExistingSets = res || [];

        if (srExistingSets.length > 0) {
            const lastId = srExistingSets[srExistingSets.length - 1].id;
            const lastNum = parseInt(lastId.replace(SR_PREFIX, '')) || 0;
            srNextNum = lastNum + 1;
        } else {
            srNextNum = 1;
        }

        updateSrSetDisplay();
        renderSrSetsList();
    } catch (e) {
        console.error('Speaking Repeat 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더링 =====
function renderSrSetsList() {
    const wrap = document.getElementById('srSetsListWrap');
    const count = document.getElementById('srSetsCount');
    if (count) count.textContent = `${srExistingSets.length}개`;
    if (!wrap) return;

    if (srExistingSets.length === 0) {
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">등록된 세트가 없습니다.</div>';
        return;
    }

    wrap.innerHTML = srExistingSets.map(s => {
        const ctx = s.context_text ? (s.context_text.length > 50 ? s.context_text.substring(0, 50) + '...' : s.context_text) : '';
        return `
        <div class="sr-set-item">
            <div style="display:flex; align-items:center; flex:1; cursor:pointer;" onclick="editSrSet('${escapeHtml(s.id)}')">
                <span class="sr-set-item-id">${escapeHtml(s.id)}</span>
                <span class="sr-set-item-ctx">${escapeHtml(ctx)}</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="editSrSet('${escapeHtml(s.id)}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button onclick="deleteSrSet('${escapeHtml(s.id)}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>`;
    }).join('');
}

// ===== 파일 존재 검증 =====
function checkImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

function checkAudio(url) {
    return new Promise(resolve => {
        const audio = new Audio();
        audio.oncanplaythrough = () => { audio.src = ''; resolve(true); };
        audio.onerror = () => resolve(false);
        audio.src = url;
    });
}

async function verifySrAllFiles() {
    const setNum = srEditingSet
        ? srEditingSet.id.replace(SR_PREFIX, '')
        : getSrSetNum();

    // 모든 상태 초기화
    const statusIds = ['srNarrationAudioStatus', 'srNarrationImageStatus'];
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        statusIds.push(`srQ${i}AudioStatus`, `srQ${i}ImageStatus`);
    }
    statusIds.forEach(id => setTextSafe(id, '⏳'));

    // 나레이션
    const nrAudioOk = await checkAudio(`${SR_BASE_URL}/narration/${SR_PREFIX}${setNum}_nr.mp3`);
    setTextSafe('srNarrationAudioStatus', nrAudioOk ? '✅' : '❌');

    const nrImageOk = await checkImage(`${SR_BASE_URL}/baseimage/${SR_PREFIX}${setNum}_baseimage.png`);
    setTextSafe('srNarrationImageStatus', nrImageOk ? '✅' : '❌');

    // Q1~Q7
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        const audioOk = await checkAudio(`${SR_BASE_URL}/audio/${SR_PREFIX}${setNum}_q${qi}.mp3`);
        setTextSafe(`srQ${i}AudioStatus`, audioOk ? '✅' : '❌');
        const imageOk = await checkImage(`${SR_BASE_URL}/baseimage/${SR_PREFIX}${setNum}_q${qi}.png`);
        setTextSafe(`srQ${i}ImageStatus`, imageOk ? '✅' : '❌');
    }

    alert('파일 검증이 완료되었습니다. 각 항목의 ✅/❌ 아이콘을 확인하세요.');
}

// ===== 미리보기 =====
function renderSrPreview() {
    const previewEl = document.getElementById('srPreviewContent');
    if (!previewEl) return;

    const ctx = document.getElementById('srContextText')?.value?.trim() || '';
    const setNum = srEditingSet
        ? srEditingSet.id.replace(SR_PREFIX, '')
        : getSrSetNum();

    let html = `<div class="sr-preview-card">
        <h4><i class="fas fa-comment-dots" style="color:#3b82f6;"></i> 상황 설명</h4>
        <div class="sr-preview-script">${escapeHtml(ctx) || '<span style="color:#94a3b8;">미입력</span>'}</div>
    </div>`;

    // 나레이션 오디오
    const nrUrl = `${SR_BASE_URL}/narration/${SR_PREFIX}${setNum}_nr.mp3`;
    html += `<div class="sr-preview-card">
        <h4><i class="fas fa-volume-up" style="color:#8b5cf6;"></i> 나레이션</h4>
        <button class="sr-preview-play" onclick="playSrAudio('${nrUrl}', this)">▶️ 재생</button>
    </div>`;

    // Q1~Q7
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const script = document.getElementById(`srQ${i}Script`)?.value?.trim() || '';
        const trans = document.getElementById(`srQ${i}Translation`)?.value?.trim() || '';
        const time = document.getElementById(`srQ${i}Time`)?.value || '10';
        const qi = String(i).padStart(2, '0');
        const audioUrl = `${SR_BASE_URL}/audio/${SR_PREFIX}${setNum}_q${qi}.mp3`;

        html += `<div class="sr-preview-card">
            <h4>Q${i} <span style="font-size:12px; color:#94a3b8; font-weight:400;">응답시간 ${escapeHtml(time)}초</span></h4>
            <div class="sr-preview-script">${escapeHtml(script) || '<span style="color:#94a3b8;">미입력</span>'}</div>
            ${trans ? `<div class="sr-preview-trans">${escapeHtml(trans)}</div>` : ''}
            <button class="sr-preview-play" onclick="playSrAudio('${audioUrl}', this)">▶️ 재생</button>
        </div>`;
    }

    previewEl.innerHTML = html;
    previewEl.style.display = 'block';
}

function playSrAudio(url, btn) {
    // 이전 오디오 정지
    if (srCurrentAudio) {
        srCurrentAudio.pause();
        srCurrentAudio = null;
    }
    const audio = new Audio(url);
    srCurrentAudio = audio;
    btn.textContent = '⏸️ 재생 중...';
    btn.disabled = true;
    audio.play().catch(() => {
        btn.textContent = '❌ 재생 실패';
        btn.disabled = false;
    });
    audio.onended = () => {
        btn.textContent = '▶️ 재생';
        btn.disabled = false;
        srCurrentAudio = null;
    };
    audio.onerror = () => {
        btn.textContent = '❌ 재생 실패';
        btn.disabled = false;
        srCurrentAudio = null;
    };
}

// ===== 등록 버튼 활성화 =====
function updateSrRegisterBtn() {
    const btn = document.getElementById('srRegisterBtn');
    if (!btn) return;
    const ctx = document.getElementById('srContextText')?.value?.trim();
    if (!ctx) { btn.disabled = true; return; }
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const script = document.getElementById(`srQ${i}Script`)?.value?.trim();
        if (!script) { btn.disabled = true; return; }
    }
    btn.disabled = false;
}

// ===== 유효성 검증 =====
function validateSrForm() {
    const ctx = document.getElementById('srContextText')?.value?.trim();
    if (!ctx) { alert('상황 설명을 입력해주세요.'); return false; }

    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const script = document.getElementById(`srQ${i}Script`)?.value?.trim();
        if (!script) { alert(`Q${i} 스크립트를 입력해주세요.`); return false; }
        const time = parseInt(document.getElementById(`srQ${i}Time`)?.value);
        if (isNaN(time) || time < 1 || time > 60) {
            alert(`Q${i} 응답시간은 1~60초여야 합니다.`);
            return false;
        }
    }

    // 신규 등록 시 중복 ID 체크
    if (!srEditingSet) {
        const newId = getSrSetId();
        if (srExistingSets.some(s => s.id === newId)) {
            alert('이미 존재하는 세트입니다.');
            return false;
        }
    }

    return true;
}

// ===== 데이터 빌드 =====
function buildSrPayload() {
    const setNum = srEditingSet
        ? srEditingSet.id.replace(SR_PREFIX, '')
        : getSrSetNum();

    const data = {
        id: getSrSetId(),
        context_text: document.getElementById('srContextText').value.trim(),
        narration_audio: `${SR_BASE_URL}/narration/${SR_PREFIX}${setNum}_nr.mp3`,
        narration_image: `${SR_BASE_URL}/baseimage/${SR_PREFIX}${setNum}_baseimage.png`
    };

    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const qi = String(i).padStart(2, '0');
        data[`audio${i}_url`] = `${SR_BASE_URL}/audio/${SR_PREFIX}${setNum}_q${qi}.mp3`;
        data[`audio${i}_image`] = `${SR_BASE_URL}/baseimage/${SR_PREFIX}${setNum}_q${qi}.png`;
        data[`audio${i}_script`] = document.getElementById(`srQ${i}Script`).value.trim();
        data[`audio${i}_translation`] = document.getElementById(`srQ${i}Translation`)?.value?.trim() || '';
        data[`audio${i}_response_time`] = parseInt(document.getElementById(`srQ${i}Time`)?.value) || 10;
    }

    return data;
}

// ===== 등록 (INSERT / UPDATE) =====
async function registerSrSet() {
    if (!validateSrForm()) return;

    const btn = document.getElementById('srRegisterBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

    try {
        const data = buildSrPayload();

        if (srEditingSet) {
            // UPDATE (PATCH)
            await supabaseAPI.patch(SR_TABLE, srEditingSet.id, data);
            alert('세트가 수정되었습니다.');
        } else {
            // INSERT (POST)
            await supabaseAPI.post(SR_TABLE, data);
            alert('세트가 등록되었습니다.');
        }

        cancelSrEdit();
        await loadSrExistingSets();
    } catch (e) {
        console.error('저장 실패:', e);
        alert('저장 실패: ' + (e.message || e));
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        updateSrRegisterBtn();
    }
}

// ===== 수정 모드 =====
async function editSrSet(setId) {
    const set = srExistingSets.find(s => s.id === setId);
    if (!set) { alert('세트를 찾을 수 없습니다.'); return; }

    srEditingSet = set;

    // 수정 모드 표시
    document.getElementById('srEditModeLabel').style.display = 'inline';
    document.getElementById('srCancelEditBtn').style.display = 'inline-flex';
    document.getElementById('srRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

    // 세트 ID 표시
    updateSrSetDisplay();

    // 폼 채우기
    document.getElementById('srContextText').value = set.context_text || '';

    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const scriptEl = document.getElementById(`srQ${i}Script`);
        const transEl = document.getElementById(`srQ${i}Translation`);
        const timeEl = document.getElementById(`srQ${i}Time`);

        if (scriptEl) scriptEl.value = set[`audio${i}_script`] || '';
        if (transEl) transEl.value = set[`audio${i}_translation`] || '';
        if (timeEl) timeEl.value = set[`audio${i}_response_time`] || 10;

        onSrQInput(i);
    }

    updateSrRegisterBtn();

    // 스크롤 상단으로
    document.getElementById('section-speaking-repeat')?.scrollIntoView({ behavior: 'smooth' });
}

// ===== 수정 취소 =====
function cancelSrEdit() {
    srEditingSet = null;

    // UI 리셋
    document.getElementById('srEditModeLabel').style.display = 'none';
    document.getElementById('srCancelEditBtn').style.display = 'none';
    document.getElementById('srRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    // 폼 초기화
    document.getElementById('srContextText').value = '';
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const scriptEl = document.getElementById(`srQ${i}Script`);
        const transEl = document.getElementById(`srQ${i}Translation`);
        const timeEl = document.getElementById(`srQ${i}Time`);
        if (scriptEl) scriptEl.value = '';
        if (transEl) transEl.value = '';
        if (timeEl) timeEl.value = 10;

        // 헤더 서브타이틀 초기화
        setTextSafe(`srQ${i}Sub`, '');

        // 검증 상태 초기화
        setTextSafe(`srQ${i}AudioStatus`, '⬜');
        setTextSafe(`srQ${i}ImageStatus`, '⬜');
    }
    setTextSafe('srNarrationAudioStatus', '⬜');
    setTextSafe('srNarrationImageStatus', '⬜');

    // 미리보기 숨기기
    const preview = document.getElementById('srPreviewContent');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }

    // 아코디언 접기
    srAllExpanded = false;
    for (let i = 1; i <= SR_Q_COUNT; i++) {
        const body = document.getElementById(`srQ${i}Body`);
        const arrow = document.getElementById(`srQ${i}Arrow`);
        if (body) body.classList.remove('open');
        if (arrow) arrow.classList.remove('open');
    }
    const toggleBtn = document.querySelector('.sr-toggle-all-btn');
    if (toggleBtn) toggleBtn.textContent = '전체 펼치기';

    updateSrSetDisplay();
    updateSrRegisterBtn();
}

// ===== 삭제 (hard delete) =====
async function deleteSrSet(setId) {
    if (!confirm(`"${setId}" 세트를 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete(SR_TABLE, setId);
        alert('세트가 삭제되었습니다.');

        // 수정 중이던 세트라면 폼 리셋
        if (srEditingSet && srEditingSet.id === setId) {
            cancelSrEdit();
        }

        await loadSrExistingSets();
    } catch (e) {
        console.error('삭제 실패:', e);
        alert('삭제 실패: ' + (e.message || e));
    }
}

// ===== 페이지 로드 시 Q 아코디언 생성 =====
document.addEventListener('DOMContentLoaded', () => {
    initSrQuestions();
});
