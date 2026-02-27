// ===== 문제 관리: Reading - Fill in the Blanks =====

const TABLE_NAME = 'tr_reading_fillblanks';
const ID_PREFIX = 'fillblank_set_';

// State
let blanksData = [];       // 감지된 빈칸 배열 [{prefix, blankCount, startIndex, endIndex, answer, explanation, commonMistakes, mistakesExplanation}]
let activeBlankIdx = -1;   // 현재 편집 중인 빈칸 인덱스
let existingSets = [];     // 기존 세트 목록
let editingSetId = null;   // 수정 모드 시 세트 ID (null이면 신규 등록)
let nextSetNumber = 1;     // 다음 세트 번호

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    // 관리자 권한 체크
    const user = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!user || user.role !== 'admin') {
        alert('⚠️ 관리자만 접근할 수 있습니다.');
        window.location.href = 'index.html';
        return;
    }
    const adminName = document.getElementById('adminName');
    if (adminName) adminName.textContent = user.name || '관리자';

    loadExistingSets();
});

// ===== 섹션 전환 =====
function onSectionChange() {
    const val = document.getElementById('sectionSelect').value;
    // 모든 섹션 숨기기
    const sections = document.querySelectorAll('[id^="section-"]');
    sections.forEach(s => s.classList.add('q-hidden'));
    // 선택된 섹션 표시
    const target = document.getElementById('section-' + val);
    if (target) target.classList.remove('q-hidden');
    // 섹션별 초기 로드
    if (val === 'reading-fillblanks') {
        loadExistingSets();
    } else if (val === 'reading-daily1') {
        if (typeof loadD1ExistingSets === 'function') loadD1ExistingSets();
    } else if (val === 'reading-daily2') {
        if (typeof loadD2ExistingSets === 'function') loadD2ExistingSets();
    }
}

// ===== 기존 세트 목록 로드 =====
async function loadExistingSets() {
    try {
        const res = await supabaseAPI.query(TABLE_NAME, { order: 'id.asc', limit: '500' });
        existingSets = res || [];

        // 다음 세트 번호 계산
        if (existingSets.length > 0) {
            const lastId = existingSets[existingSets.length - 1].id;
            const lastNum = parseInt(lastId.replace(ID_PREFIX, '')) || 0;
            nextSetNumber = lastNum + 1;
        } else {
            nextSetNumber = 1;
        }

        updateSetId();
        renderSetsList();
    } catch (error) {
        console.error('세트 목록 로드 실패:', error);
        document.getElementById('setsListWrap').innerHTML = '<div class="q-empty"><i class="fas fa-exclamation-triangle"></i>로드 실패</div>';
    }
}

// ===== 세트 ID 표시 업데이트 =====
function updateSetId() {
    const idStr = editingSetId || `${ID_PREFIX}${String(nextSetNumber).padStart(4, '0')}`;
    document.getElementById('setId').textContent = idStr;
}

// ===== 등록된 세트 목록 렌더링 =====
function renderSetsList() {
    const wrap = document.getElementById('setsListWrap');
    const countEl = document.getElementById('setsCount');
    countEl.textContent = `(${existingSets.length}건)`;

    if (existingSets.length === 0) {
        wrap.innerHTML = '<div class="q-empty"><i class="fas fa-inbox"></i>등록된 세트가 없습니다.</div>';
        return;
    }

    let html = `<table class="q-sets-table">
        <thead><tr>
            <th>세트 ID</th>
            <th>빈칸 수</th>
            <th>등록일</th>
            <th style="width:120px; text-align:center;">액션</th>
        </tr></thead><tbody>`;

    existingSets.forEach(s => {
        const blankCount = (s.passage_with_markers?.match(/\{\{/g) || []).length;
        const date = s.created_at ? new Date(s.created_at).toLocaleDateString('ko-KR') : '-';
        html += `<tr>
            <td style="font-family:monospace; font-weight:600;">${escapeHtml(s.id)}</td>
            <td>${blankCount}개</td>
            <td style="color:#64748b;">${date}</td>
            <td style="text-align:center;">
                <button class="q-btn q-btn-secondary q-btn-sm" onclick="editSet('${escapeHtml(s.id)}')" title="수정">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="q-btn q-btn-danger q-btn-sm" onclick="deleteSet('${escapeHtml(s.id)}')" title="삭제" style="margin-left:4px;">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

// ===== 지문 입력 시 빈칸 자동 감지 =====
function onPassageInput() {
    const text = document.getElementById('passageInput').value;

    if (!text.trim()) {
        hide('blanksSection');
        hide('previewSection');
        hide('registerSection');
        blanksData = [];
        return;
    }

    detectBlanks(text);
}

// ===== 빈칸 감지 =====
function detectBlanks(text) {
    const pattern = /([a-zA-Z]+)((?:\s*_\s*)+)/g;
    const newBlanks = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
        const prefix = match[1];
        const underscoreStr = match[2].replace(/\s/g, '');
        const blankCount = underscoreStr.length;

        // 기존 데이터 보존 (같은 prefix + 같은 위치면 유지)
        const existing = blanksData.find((b, i) =>
            b.prefix === prefix && i === newBlanks.length
        );

        newBlanks.push({
            prefix: prefix,
            blankCount: blankCount,
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            answer: existing?.answer || '',
            explanation: existing?.explanation || '',
            commonMistakes: existing?.commonMistakes || '',
            mistakesExplanation: existing?.mistakesExplanation || ''
        });
    }

    blanksData = newBlanks;

    if (blanksData.length === 0) {
        hide('blanksSection');
        hide('previewSection');
        hide('registerSection');
        return;
    }

    renderBlanksTable();
    renderPreview();
    updateRegisterButton();
    show('blanksSection');
    show('previewSection');
    show('registerSection');
}

// ===== 빈칸 목록 테이블 렌더링 =====
function renderBlanksTable() {
    const wrap = document.getElementById('blanksTableWrap');
    const summary = document.getElementById('blanksSummary');

    const completedCount = blanksData.filter(b => b.answer).length;
    const isCorrectCount = blanksData.length === 10;
    summary.innerHTML = `<span class="count" style="${isCorrectCount ? '' : 'background:#dc2626;'}">${blanksData.length}개 감지</span> `
        + (isCorrectCount
            ? `<span style="color:#64748b; font-weight:400;">(입력 완료: ${completedCount}/${blanksData.length})</span>`
            : `<span style="color:#dc2626; font-weight:600;">❌ 빈칸은 정확히 10개여야 합니다 (현재 ${blanksData.length}개)</span>`);

    let html = `<table class="q-blanks-table">
        <thead><tr>
            <th style="width:40px;">#</th>
            <th>앞글자</th>
            <th>빈칸 수</th>
            <th>정답</th>
            <th>해설</th>
            <th style="width:80px;">상태</th>
            <th style="width:60px;"></th>
        </tr></thead><tbody>`;

    blanksData.forEach((b, i) => {
        const isActive = i === activeBlankIdx;
        const hasAnswer = !!b.answer;
        const hasError = hasAnswer && b.answer.length !== b.blankCount;
        let statusHtml, statusClass;

        if (hasError) {
            statusHtml = `<span class="q-blank-status error">❌ 불일치</span>`;
        } else if (hasAnswer) {
            statusHtml = `<span class="q-blank-status done">✅ 완료</span>`;
        } else {
            statusHtml = `<span class="q-blank-status pending">⚠️ 미입력</span>`;
        }

        html += `<tr class="${isActive ? 'active-row' : ''}" style="cursor:pointer;" onclick="openDetail(${i})">
            <td style="font-weight:600; color:#6366f1;">${i + 1}</td>
            <td style="font-family:monospace; font-weight:600;">${escapeHtml(b.prefix)}</td>
            <td>${b.blankCount}개</td>
            <td style="font-family:monospace;">${hasAnswer ? escapeHtml(b.answer) : '<span style="color:#cbd5e1;">-</span>'}</td>
            <td style="color:#64748b; font-size:12px;">${b.explanation ? '있음' : '-'}</td>
            <td>${statusHtml}</td>
            <td><button class="q-btn q-btn-secondary q-btn-sm" onclick="event.stopPropagation(); openDetail(${i})"><i class="fas fa-edit"></i></button></td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

// ===== 빈칸 상세 입력 열기 =====
function openDetail(idx) {
    activeBlankIdx = idx;
    const b = blanksData[idx];

    document.getElementById('detailIndex').textContent = idx + 1;
    document.getElementById('detailPrefix').value = b.prefix;
    document.getElementById('detailBlankCount').value = b.blankCount + '개';
    document.getElementById('detailAnswer').value = b.answer;
    document.getElementById('detailExplanation').value = b.explanation;
    document.getElementById('detailMistakes').value = b.commonMistakes;
    document.getElementById('detailMistakesExp').value = b.mistakesExplanation;

    validateAnswer();
    show('detailSection');
    renderBlanksTable();

    // 스크롤
    document.getElementById('detailSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ===== 정답 입력 시 유효성 검사 =====
function onAnswerInput() {
    validateAnswer();
}

function validateAnswer() {
    const answer = document.getElementById('detailAnswer').value;
    const el = document.getElementById('answerValidation');
    const b = blanksData[activeBlankIdx];

    if (!b) return;
    if (!answer) {
        el.textContent = '';
        el.className = 'q-validation';
        return;
    }

    // 영문자만 허용
    if (!/^[a-zA-Z]+$/.test(answer)) {
        el.textContent = '❌ 정답은 영문자만 입력 가능합니다';
        el.className = 'q-validation err';
        return;
    }

    if (answer.length === b.blankCount) {
        el.textContent = `✅ 글자수 일치 (${answer.length}/${b.blankCount})`;
        el.className = 'q-validation ok';
    } else {
        el.textContent = `❌ 빈칸 ${b.blankCount}개인데 정답이 ${answer.length}글자입니다`;
        el.className = 'q-validation err';
    }
}

// ===== 빈칸 상세 저장 =====
function saveBlankDetail() {
    if (activeBlankIdx < 0) return;
    const b = blanksData[activeBlankIdx];

    const answer = document.getElementById('detailAnswer').value.trim();
    const explanation = sanitizePipe(document.getElementById('detailExplanation').value.trim());
    const mistakes = document.getElementById('detailMistakes').value.trim();
    const mistakesExp = sanitizePipe(document.getElementById('detailMistakesExp').value.trim());

    // 유효성 검사
    if (answer && !/^[a-zA-Z]+$/.test(answer)) {
        alert('정답은 영문자만 입력 가능합니다.');
        return;
    }

    b.answer = answer;
    b.explanation = explanation;
    b.commonMistakes = mistakes;
    b.mistakesExplanation = mistakesExp;

    renderBlanksTable();
    renderPreview();
    updateRegisterButton();

    // 다음 미입력 빈칸으로 자동 이동
    const nextEmpty = blanksData.findIndex((bb, i) => i > activeBlankIdx && !bb.answer);
    if (nextEmpty >= 0) {
        openDetail(nextEmpty);
    } else {
        closeDetail();
    }
}

// ===== 상세 닫기 =====
function closeDetail() {
    activeBlankIdx = -1;
    hide('detailSection');
    renderBlanksTable();
}

// ===== 파이프 → 슬래시 치환 =====
function sanitizePipe(str) {
    return str.replace(/\|/g, '/');
}

// ===== 미리보기 렌더링 =====
function renderPreview() {
    const text = document.getElementById('passageInput').value;
    if (!text || blanksData.length === 0) {
        hide('previewSection');
        return;
    }

    let result = '';
    let lastIdx = 0;

    blanksData.forEach(b => {
        // 빈칸 앞의 일반 텍스트
        result += escapeHtml(text.substring(lastIdx, b.startIndex));

        // prefix + blank
        result += `<span class="q-preview-prefix">${escapeHtml(b.prefix)}</span>`;

        const slots = b.answer ? b.answer.length : b.blankCount;
        let blankHtml = '';
        for (let i = 0; i < slots; i++) {
            blankHtml += '_';
        }
        result += `<span class="q-preview-blank">${blankHtml}</span>`;

        lastIdx = b.endIndex;
    });

    // 나머지 텍스트
    result += escapeHtml(text.substring(lastIdx));

    document.getElementById('previewContent').innerHTML = result;
    show('previewSection');
}

// ===== 등록 버튼 상태 업데이트 =====
function updateRegisterButton() {
    const btn = document.getElementById('registerBtn');
    const isCorrectCount = blanksData.length === 10;
    const allFilled = isCorrectCount && blanksData.every(b => {
        return b.answer && b.answer.length === b.blankCount && /^[a-zA-Z]+$/.test(b.answer);
    });

    btn.disabled = !allFilled;
    btn.innerHTML = editingSetId
        ? '<i class="fas fa-save"></i> 수정 저장'
        : '<i class="fas fa-upload"></i> 등록하기';
}

// ===== 마커 형식으로 변환 =====
function buildPassageWithMarkers() {
    const text = document.getElementById('passageInput').value;
    let result = '';
    let lastIdx = 0;

    blanksData.forEach(b => {
        result += text.substring(lastIdx, b.startIndex);

        let marker = `{{${b.prefix}|${b.answer}`;
        if (b.explanation) marker += `|${b.explanation}`;
        if (b.commonMistakes) {
            marker += `|(${b.commonMistakes})`;
            if (b.mistakesExplanation) marker += `|${b.mistakesExplanation}`;
        }
        marker += '}}';

        result += marker;
        lastIdx = b.endIndex;
    });

    result += text.substring(lastIdx);
    return result;
}

// ===== 등록 / 수정 저장 =====
async function registerSet() {
    // 최종 유효성 검사
    if (blanksData.length === 0) {
        alert('빈칸이 감지되지 않았습니다.');
        return;
    }

    for (let i = 0; i < blanksData.length; i++) {
        const b = blanksData[i];
        if (!b.answer) {
            alert(`빈칸 #${i + 1}의 정답을 입력해주세요.`);
            openDetail(i);
            return;
        }
        if (b.answer.length !== b.blankCount) {
            alert(`빈칸 #${i + 1}: 빈칸 수(${b.blankCount}개)와 정답 글자수(${b.answer.length}개)가 일치하지 않습니다.`);
            openDetail(i);
            return;
        }
        if (!/^[a-zA-Z]+$/.test(b.answer)) {
            alert('정답은 영문자만 입력 가능합니다.');
            openDetail(i);
            return;
        }
    }

    const passageWithMarkers = buildPassageWithMarkers();
    const setId = editingSetId || `${ID_PREFIX}${String(nextSetNumber).padStart(4, '0')}`;

    try {
        if (editingSetId) {
            // 수정
            await supabaseAPI.patch(TABLE_NAME, editingSetId, {
                passage_with_markers: passageWithMarkers
            });
            alert(`✅ ${editingSetId} 수정 완료!`);
        } else {
            // 신규 등록
            await supabaseAPI.post(TABLE_NAME, {
                id: setId,
                passage_with_markers: passageWithMarkers
            });
            alert(`✅ ${setId} 등록 완료!`);
        }

        resetForm();
        await loadExistingSets();
    } catch (error) {
        console.error('저장 실패:', error);
        alert('저장에 실패했습니다: ' + error.message);
    }
}

// ===== 수정 모드 진입 =====
function editSet(id) {
    const set = existingSets.find(s => s.id === id);
    if (!set) return;

    editingSetId = id;

    // 마커 → 원본 지문 + 빈칸 데이터로 역변환
    const parsed = parseMarkerPassage(set.passage_with_markers);

    document.getElementById('passageInput').value = parsed.originalText;
    blanksData = parsed.blanks;

    updateSetId();
    document.getElementById('editModeLabel').classList.remove('q-hidden');
    document.getElementById('cancelEditBtn').classList.remove('q-hidden');
    document.getElementById('registerBtn').innerHTML = '<i class="fas fa-save"></i> 수정 저장';

    renderBlanksTable();
    renderPreview();
    updateRegisterButton();
    show('blanksSection');
    show('previewSection');
    show('registerSection');

    // 맨 위로 스크롤
    document.getElementById('passageInput').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 마커 → 원본 + 빈칸 데이터 역변환 =====
function parseMarkerPassage(markerText) {
    const blanks = [];
    const markerPattern = /\{\{([^|]+)\|([^|}]+)(?:\|([^|}]*))?(?:\|\(([^)]*)\))?(?:\|([^}]*))?\}\}/g;
    let originalText = '';
    let lastIdx = 0;
    let match;

    while ((match = markerPattern.exec(markerText)) !== null) {
        // 마커 앞의 일반 텍스트
        originalText += markerText.substring(lastIdx, match.index);

        const prefix = match[1];
        const answer = match[2];
        const explanation = match[3] || '';
        const commonMistakes = match[4] || '';
        const mistakesExplanation = match[5] || '';

        // 원본 형태 복원: prefix + 언더스코어
        const underscores = ' ' + answer.split('').map(() => '_').join(' ');
        const startIndex = originalText.length;
        originalText += prefix + underscores;
        const endIndex = originalText.length;

        blanks.push({
            prefix,
            blankCount: answer.length,
            startIndex,
            endIndex,
            answer,
            explanation,
            commonMistakes,
            mistakesExplanation
        });

        lastIdx = match.index + match[0].length;
    }

    originalText += markerText.substring(lastIdx);

    return { originalText, blanks };
}

// ===== 수정 취소 =====
function cancelEdit() {
    resetForm();
}

// ===== 폼 초기화 =====
function resetForm() {
    editingSetId = null;
    blanksData = [];
    activeBlankIdx = -1;

    document.getElementById('passageInput').value = '';
    document.getElementById('editModeLabel').classList.add('q-hidden');
    document.getElementById('cancelEditBtn').classList.add('q-hidden');

    hide('blanksSection');
    hide('detailSection');
    hide('previewSection');
    hide('registerSection');

    updateSetId();
}

// ===== 삭제 =====
async function deleteSet(id) {
    if (!confirm(`"${id}" 세트를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete(TABLE_NAME, id);
        alert(`✅ ${id} 삭제 완료!`);
        await loadExistingSets();
    } catch (error) {
        console.error('삭제 실패:', error);
        alert('삭제에 실패했습니다: ' + error.message);
    }
}

// ===== 유틸: show / hide =====
function show(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('q-hidden');
}
function hide(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('q-hidden');
}

// ===== HTML 이스케이프 =====
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
