// ===== 문제 관리: Reading - Academic (v2 블록 + 문제 유형) =====

const AC_TABLE = 'tr_reading_academic';
const AC_PREFIX = 'academic_set_';

// State
let acExistingSets = [];
let acEditingSetId = null;
let acNextSetNumber = 1;

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    for (let i = 1; i <= 5; i++) {
        initAcQuestionBlock(`acQuestion${i}`, i);
    }
});

// ===== 기존 세트 목록 로드 =====
async function loadAcExistingSets() {
    try {
        const res = await supabaseAPI.query(AC_TABLE, { order: 'id.asc', limit: '500' });
        acExistingSets = res || [];

        if (acExistingSets.length > 0) {
            const lastId = acExistingSets[acExistingSets.length - 1].id;
            const lastNum = parseInt(lastId.replace(AC_PREFIX, '')) || 0;
            acNextSetNumber = lastNum + 1;
        } else {
            acNextSetNumber = 1;
        }

        updateAcSetId();
        renderAcSetsList();
    } catch (error) {
        console.error('Academic 세트 목록 로드 실패:', error);
        document.getElementById('acSetsListWrap').innerHTML = '<div class="q-empty"><i class="fas fa-exclamation-triangle"></i> 로드 실패</div>';
    }
}

function updateAcSetId() {
    const idStr = acEditingSetId || `${AC_PREFIX}${String(acNextSetNumber).padStart(4, '0')}`;
    document.getElementById('acSetId').textContent = idStr;
}

// ===== 세트 목록 렌더링 =====
function renderAcSetsList() {
    const wrap = document.getElementById('acSetsListWrap');
    const countEl = document.getElementById('acSetsCount');
    countEl.textContent = `(${acExistingSets.length}건)`;

    if (acExistingSets.length === 0) {
        wrap.innerHTML = '<div class="q-empty"><i class="fas fa-inbox"></i> 등록된 세트가 없습니다.</div>';
        return;
    }

    let html = `<table class="q-sets-table">
        <thead><tr>
            <th>세트 ID</th>
            <th>상단 제목</th>
            <th>지문 제목</th>
            <th>문제 수</th>
            <th>등록일</th>
            <th style="width:120px; text-align:center;">액션</th>
        </tr></thead><tbody>`;

    acExistingSets.forEach(s => {
        const date = s.created_at ? new Date(s.created_at).toLocaleDateString('ko-KR') : '-';
        const titleShort = (s.passage_title || '').length > 25
            ? acEscapeHtml(s.passage_title.substring(0, 25)) + '...'
            : acEscapeHtml(s.passage_title || '');
        html += `<tr>
            <td style="font-family:monospace; font-weight:600;">${acEscapeHtml(s.id)}</td>
            <td>${acEscapeHtml(s.main_title || '')}</td>
            <td title="${acEscapeHtml(s.passage_title || '')}">${titleShort}</td>
            <td>5개</td>
            <td style="color:#64748b;">${date}</td>
            <td style="text-align:center;">
                <button class="q-btn q-btn-secondary q-btn-sm" onclick="editAcSet('${acEscapeHtml(s.id)}')" title="수정">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="q-btn q-btn-danger q-btn-sm" onclick="deleteAcSet('${acEscapeHtml(s.id)}')" title="삭제">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

// ===== 상단 제목 =====
function onAcMainTitleChange() {
    const sel = document.getElementById('acMainTitleSelect');
    const custom = document.getElementById('acMainTitleCustom');
    if (sel.value === '__custom__') {
        custom.classList.remove('q-hidden');
        custom.focus();
    } else {
        custom.classList.add('q-hidden');
        custom.value = '';
    }
    updateAcRegisterBtn();
}

function getAcMainTitle() {
    const sel = document.getElementById('acMainTitleSelect');
    if (sel.value === '__custom__') {
        return document.getElementById('acMainTitleCustom').value.trim();
    }
    return sel.value;
}

// ===== 단락 입력 (3개 고정) =====
function countAcLines(text) {
    return text.split('\n').filter(line => line.trim() !== '').length;
}

function onAcParagraphInput(paraNum) {
    const origEl = document.getElementById(`acPara${paraNum}Original`);
    const transEl = document.getElementById(`acPara${paraNum}Translation`);
    const statusEl = document.getElementById(`acPara${paraNum}Status`);

    const origLines = countAcLines(origEl.value);
    const transLines = countAcLines(transEl.value);

    if (origLines === 0 && transLines === 0) {
        statusEl.textContent = '';
        statusEl.className = 'ac-paragraph-status';
    } else if (origLines === transLines) {
        statusEl.textContent = `✅ 원문 ${origLines}줄 / 해석 ${transLines}줄 — 일치`;
        statusEl.className = 'ac-paragraph-status match';
    } else {
        statusEl.textContent = `❌ 원문 ${origLines}줄 / 해석 ${transLines}줄 — 불일치!`;
        statusEl.className = 'ac-paragraph-status mismatch';
    }

    updateAcRegisterBtn();
}

function getAcParagraphs() {
    const paragraphs = [];
    for (let i = 1; i <= 3; i++) {
        const original = document.getElementById(`acPara${i}Original`)?.value || '';
        const translation = document.getElementById(`acPara${i}Translation`)?.value || '';
        paragraphs.push({ original: original.trim(), translation: translation.trim() });
    }
    return paragraphs;
}

// ===== 핵심 단어 =====
function addAcWord(word, translation, explanation) {
    const list = document.getElementById('acWordList');
    const row = document.createElement('div');
    row.className = 'd1-word-row';
    row.innerHTML = `
        <input type="text" value="${acEscapeAttr(word || '')}" placeholder="영어 단어" oninput="updateAcRegisterBtn()">
        <input type="text" value="${acEscapeAttr(translation || '')}" placeholder="한글 뜻" oninput="updateAcRegisterBtn()">
        <input type="text" value="${acEscapeAttr(explanation || '')}" placeholder="설명 (선택)">
        <button class="d1-del-btn" onclick="removeAcWord(this)" title="삭제"><i class="fas fa-times"></i></button>
    `;
    list.appendChild(row);
    updateAcWordCount();
    updateAcRegisterBtn();
}

function removeAcWord(btn) {
    btn.closest('.d1-word-row').remove();
    updateAcWordCount();
    updateAcRegisterBtn();
}

function updateAcWordCount() {
    const rows = document.querySelectorAll('#acWordList .d1-word-row');
    document.getElementById('acWordCount').textContent = `(${rows.length}개)`;
}

function getAcWords() {
    const rows = document.querySelectorAll('#acWordList .d1-word-row');
    return Array.from(rows).map(r => {
        const inputs = r.querySelectorAll('input');
        return {
            word: inputs[0].value.trim(),
            translation: inputs[1].value.trim(),
            explanation: inputs[2].value.trim()
        };
    });
}

// ===== 🆕 문제 유형 시스템 =====
function onAcQuestionTypeChange(qNum) {
    const type = getAcQuestionType(qNum);
    const hintEl = document.getElementById(`acQ${qNum}TypeHint`);

    // 안내 메시지 업데이트
    hintEl.className = 'ac-qtype-hint';
    if (type === 'highlight') {
        hintEl.classList.add('highlight-hint', 'visible');
        hintEl.innerHTML = '💡 지문 원문에서 하이라이트할 단어를 &lt;&lt;단어&gt;&gt; 로 감싸주세요.';
    } else if (type === 'insertion') {
        hintEl.classList.add('insertion-hint', 'visible');
        hintEl.textContent = '💡 지문 원문에 (A)(B)(C)(D) 삽입 위치 마커가 포함되어 있어야 합니다.';
    } else if (type === 'simplification') {
        hintEl.classList.add('simplification-hint', 'visible');
        hintEl.textContent = '💡 지문 원문에서 하이라이트할 문장을 [[문장]] 으로 감싸주세요.';
    } else {
        // normal — 숨김
    }

    updateAcHighlightBanner();
    updateAcRegisterBtn();
}

function getAcQuestionType(qNum) {
    const sel = document.getElementById(`acQ${qNum}Type`);
    return sel ? sel.value : 'normal';
}

function setAcQuestionType(qNum, type) {
    const sel = document.getElementById(`acQ${qNum}Type`);
    if (sel) {
        sel.value = type || 'normal';
        onAcQuestionTypeChange(qNum);
    }
}

function updateAcHighlightBanner() {
    const banner = document.getElementById('acHighlightBanner');
    let hasHighlight = false;
    for (let i = 1; i <= 5; i++) {
        if (getAcQuestionType(i) === 'highlight') {
            hasHighlight = true;
            break;
        }
    }
    if (hasHighlight) {
        banner.classList.add('visible');
    } else {
        banner.classList.remove('visible');
    }
}

// ===== 문제 블록 생성 =====
function initAcQuestionBlock(containerId, qNum) {
    const container = document.getElementById(containerId);
    const prefix = `acQ${qNum}`;
    const labels = ['A', 'B', 'C', 'D'];

    let html = `<div class="d1-q-section">
        <div class="d1-q-row">
            <div>
                <div class="d1-q-label">문제 원문 <span class="d1-required">*</span></div>
                <input type="text" id="${prefix}Text" class="d1-input" placeholder="영어 질문 (예: The word &quot;validity&quot; in the passage is closest in meaning to...)" oninput="updateAcRegisterBtn()">
            </div>
            <div>
                <div class="d1-q-label">문제 해석 <span class="d1-required">*</span></div>
                <input type="text" id="${prefix}Trans" class="d1-input" placeholder="한글 해석" oninput="updateAcRegisterBtn()">
            </div>
        </div>

        <div class="d1-q-full">
            <div class="d1-q-label">정답 선택 <span class="d1-required">*</span></div>
            <div class="d1-radio-group" id="${prefix}RadioGroup">`;

    labels.forEach((l, i) => {
        html += `
                <label class="d1-radio-label" id="${prefix}Radio${l}" onclick="selectAcAnswer('${prefix}', ${i + 1})">
                    <input type="radio" name="${prefix}Answer" value="${i + 1}"> ${l}
                </label>`;
    });

    html += `
            </div>
        </div>`;

    labels.forEach((l) => {
        html += `
        <div class="d1-option-card" id="${prefix}Option${l}">
            <div class="d1-option-card-header">
                <span class="d1-option-label">${l}</span>
                보기 ${l}
            </div>
            <div class="d1-q-row">
                <div>
                    <div class="d1-q-label">원문 <span class="d1-required">*</span></div>
                    <input type="text" id="${prefix}Opt${l}Text" class="d1-input" placeholder="보기 원문" oninput="updateAcRegisterBtn()">
                </div>
                <div>
                    <div class="d1-q-label">해석 <span class="d1-required">*</span></div>
                    <input type="text" id="${prefix}Opt${l}Trans" class="d1-input" placeholder="보기 해석" oninput="updateAcRegisterBtn()">
                </div>
            </div>
            <div class="d1-q-full">
                <div class="d1-q-label">해설 <span class="d1-required">*</span></div>
                <textarea id="${prefix}Opt${l}Exp" class="d1-input" style="min-height:60px; resize:vertical;" placeholder="정답/오답 이유 설명" oninput="updateAcRegisterBtn()"></textarea>
            </div>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
}

function selectAcAnswer(prefix, num) {
    const labels = ['A', 'B', 'C', 'D'];
    labels.forEach((l, i) => {
        const radioLabel = document.getElementById(`${prefix}Radio${l}`);
        const optionCard = document.getElementById(`${prefix}Option${l}`);
        if (i + 1 === num) {
            radioLabel.classList.add('selected');
            optionCard.classList.add('correct');
        } else {
            radioLabel.classList.remove('selected');
            optionCard.classList.remove('correct');
        }
    });
    const radio = document.querySelector(`input[name="${prefix}Answer"][value="${num}"]`);
    if (radio) radio.checked = true;
    updateAcRegisterBtn();
}

function getAcQuestionData(qNum) {
    const prefix = `acQ${qNum}`;
    const text = document.getElementById(`${prefix}Text`)?.value.trim();
    const trans = document.getElementById(`${prefix}Trans`)?.value.trim();
    const answerEl = document.querySelector(`input[name="${prefix}Answer"]:checked`);
    const correctAnswer = answerEl ? parseInt(answerEl.value) : 0;

    const labels = ['A', 'B', 'C', 'D'];
    const options = labels.map(l => ({
        label: l,
        text: document.getElementById(`${prefix}Opt${l}Text`)?.value.trim() || '',
        translation: document.getElementById(`${prefix}Opt${l}Trans`)?.value.trim() || '',
        explanation: document.getElementById(`${prefix}Opt${l}Exp`)?.value.trim() || ''
    }));

    return {
        num: `Q${qNum}`,
        type: getAcQuestionType(qNum),
        text,
        translation: trans,
        correctAnswer,
        options
    };
}

// ===== 🆕 구분자 치환 (<<>> 보호 포함) =====
function acSanitizeDelimiters(str) {
    if (!str) return '';

    // 1단계: <<...>> 및 [[...]] 내부를 임시 보호
    const preserved = [];
    let safeText = str.replace(/<<([^>]+)>>/g, (match) => {
        preserved.push(match);
        return `__HIGHLIGHT_${preserved.length - 1}__`;
    });
    safeText = safeText.replace(/\[\[([\s\S]+?)\]\]/g, (match) => {
        preserved.push(match);
        return `__HIGHLIGHT_${preserved.length - 1}__`;
    });

    // 2단계: 기존 sanitize 실행 (순서 중요: 긴 패턴 먼저)
    safeText = safeText
        .replace(/::/g, ': :')
        .replace(/#\|\|#/g, '# ||#')
        .replace(/#\|#/g, '# |#')
        .replace(/##/g, '# #');

    // 3단계: 중첩 플레이스홀더까지 완전 복원 ([[]] 안에 <<>>가 있는 경우 대응)
    let maxIter = 10;
    while (safeText.includes('__HIGHLIGHT_') && maxIter-- > 0) {
        safeText = safeText.replace(/__HIGHLIGHT_(\d+)__/g, (match, idx) => {
            return preserved[parseInt(idx)];
        });
    }

    return safeText;
}

// ===== 데이터 조합 (폼 → DB) =====
function buildAcData() {
    const mainTitle = acSanitizeDelimiters(getAcMainTitle());
    const passageTitle = acSanitizeDelimiters(document.getElementById('acPassageTitle').value.trim());
    const paragraphs = getAcParagraphs();
    const words = getAcWords();

    // passage_content: 단락 내 문장은 #|#, 단락 간은 ##
    const passageContent = paragraphs.map(p => {
        const sentences = p.original.split('\n').filter(s => s.trim() !== '');
        return sentences.map(s => acSanitizeDelimiters(s.trim())).join('#|#');
    }).join('##');

    // sentence_translations: 전체 해석을 ##로 연결
    const allTranslations = paragraphs.flatMap(p => {
        return p.translation.split('\n').filter(s => s.trim() !== '');
    });
    const sentenceTranslations = allTranslations.map(t => acSanitizeDelimiters(t.trim())).join('##');

    const interactiveWords = words.map(w => {
        const word = acSanitizeDelimiters(w.word);
        const translation = acSanitizeDelimiters(w.translation);
        const explanation = acSanitizeDelimiters(w.explanation);
        if (explanation) return `${word}::${translation}::${explanation}`;
        return `${word}::${translation}`;
    }).join('##');

    // 🆕 question 빌드 (유형 태그 포함)
    function buildQuestion(qData) {
        if (!qData || !qData.text) return '';
        const labels = ['A', 'B', 'C', 'D'];
        const optionsStr = qData.options.map((opt, i) => {
            const text = acSanitizeDelimiters(opt.text);
            const trans = acSanitizeDelimiters(opt.translation);
            const exp = acSanitizeDelimiters(opt.explanation);
            return `${labels[i]})${text}::${trans}::${exp}`;
        }).join('##');

        const qText = acSanitizeDelimiters(qData.text);
        const qTrans = acSanitizeDelimiters(qData.translation);

        // 유형 태그 생성
        let qPrefix = qData.num;
        if (qData.type === 'highlight') {
            qPrefix += '[highlight]';
        } else if (qData.type === 'insertion') {
            qPrefix += '[insertion]';
        } else if (qData.type === 'simplification') {
            qPrefix += '[simplification]';
        }
        // normal이면 태그 없음 (하위 호환)

        return `${qPrefix}::${qText}::${qTrans}::${qData.correctAnswer}::${optionsStr}`;
    }

    const setId = acEditingSetId || `${AC_PREFIX}${String(acNextSetNumber).padStart(4, '0')}`;

    const data = {
        id: setId,
        main_title: mainTitle,
        passage_title: passageTitle,
        passage_content: passageContent,
        sentence_translations: sentenceTranslations,
        interactive_words: interactiveWords
    };

    for (let i = 1; i <= 5; i++) {
        const q = getAcQuestionData(i);
        data[`question${i}`] = buildQuestion(q);
    }

    return data;
}

// ===== 🆕 유효성 검사 =====
function validateAcForm() {
    const errors = [];

    // 상단 제목
    if (!getAcMainTitle()) errors.push('상단 제목을 선택해주세요');
    // 지문 제목
    if (!document.getElementById('acPassageTitle').value.trim()) errors.push('지문 제목을 입력해주세요');

    // 단락 검사 (3개 고정)
    const paragraphs = getAcParagraphs();
    for (let i = 0; i < 3; i++) {
        const p = paragraphs[i];
        if (!p.original) errors.push(`단락 ${i + 1}의 원문을 입력해주세요`);
        if (!p.translation) errors.push(`단락 ${i + 1}의 해석을 입력해주세요`);
        if (p.original && p.translation) {
            const origLines = countAcLines(p.original);
            const transLines = countAcLines(p.translation);
            if (origLines !== transLines) {
                errors.push(`단락 ${i + 1}의 원문(${origLines}줄)과 해석(${transLines}줄)의 문장 수가 일치하지 않습니다`);
            }
        }
    }

    // 핵심 단어
    const words = getAcWords();
    if (words.length === 0) {
        errors.push('핵심 단어를 최소 1개 입력해주세요');
    } else {
        words.forEach((w, i) => {
            if (!w.word) errors.push(`핵심 단어 #${i + 1}의 단어를 입력해주세요`);
            if (!w.translation) errors.push(`핵심 단어 #${i + 1}의 뜻을 입력해주세요`);
        });
    }

    // 문제 1~5 필수 검사
    for (let i = 1; i <= 5; i++) {
        const qErrors = validateAcQuestion(i);
        errors.push(...qErrors);
    }

    // 🆕 문제 유형 관련 검사
    const questionTypes = [];
    for (let i = 1; i <= 5; i++) {
        questionTypes.push({ qNum: i, type: getAcQuestionType(i) });
    }

    const highlightQuestions = questionTypes.filter(q => q.type === 'highlight');
    const insertionQuestions = questionTypes.filter(q => q.type === 'insertion');
    const simplificationQuestions = questionTypes.filter(q => q.type === 'simplification');

    // highlight 중복 검사
    if (highlightQuestions.length > 1) {
        errors.push('highlight 유형 문제는 1개만 설정할 수 있습니다');
    }

    // insertion 중복 검사
    if (insertionQuestions.length > 1) {
        errors.push('insertion 유형 문제는 1개만 설정할 수 있습니다');
    }

    // simplification 중복 검사
    if (simplificationQuestions.length > 1) {
        errors.push('simplification 유형 문제는 1개만 설정할 수 있습니다');
    }

    // <<>> 마크업 검사
    const fullPassage = paragraphs.map(p => p.original).join('');
    const highlightMarkers = fullPassage.match(/<<[^>]+>>/g) || [];

    if (highlightQuestions.length > 0 && highlightMarkers.length === 0) {
        errors.push('highlight 유형 문제가 있으면 지문에 <<단어>> 마크업이 필요합니다');
    }

    if (highlightMarkers.length > 1) {
        errors.push('<<>> 마크업은 지문에 1개만 사용할 수 있습니다');
    }

    if (highlightMarkers.length > 0 && highlightQuestions.length === 0) {
        errors.push('지문에 <<>> 마크업이 있으면 highlight 유형 문제를 설정해주세요');
    }

    // <<>> 열기/닫기 검사
    const openCount = (fullPassage.match(/<</g) || []).length;
    const closeCount = (fullPassage.match(/>>/g) || []).length;
    if (openCount !== closeCount) {
        errors.push('<<>> 마크업이 올바르게 열고 닫혔는지 확인해주세요');
    }

    // (A)(B)(C)(D) 마커 검사 (순서 무관)
    if (insertionQuestions.length > 0) {
        const hasAllMarkers =
            fullPassage.includes('(A)') &&
            fullPassage.includes('(B)') &&
            fullPassage.includes('(C)') &&
            fullPassage.includes('(D)');
        if (!hasAllMarkers) {
            errors.push('insertion 유형 문제가 있으면 지문에 (A)(B)(C)(D) 마커가 필요합니다');
        }
    }

    // [[]] 마크업 검사 (simplification)
    const simplificationMarkers = fullPassage.match(/\[\[[^\]]+\]\]/g) || [];

    if (simplificationQuestions.length > 0 && simplificationMarkers.length === 0) {
        errors.push('simplification 유형 문제가 있으면 지문에 [[문장]] 마크업이 필요합니다');
    }

    if (simplificationMarkers.length > 1) {
        errors.push('[[]] 마크업은 지문에 1개만 사용할 수 있습니다');
    }

    if (simplificationMarkers.length > 0 && simplificationQuestions.length === 0) {
        errors.push('지문에 [[]] 마크업이 있으면 simplification 유형 문제를 설정해주세요');
    }

    // [[]] 열기/닫기 검사
    const openBracketCount = (fullPassage.match(/\[\[/g) || []).length;
    const closeBracketCount = (fullPassage.match(/\]\]/g) || []).length;
    if (openBracketCount !== closeBracketCount) {
        errors.push('[[]] 마크업이 올바르게 열고 닫혔는지 확인해주세요');
    }

    return errors;
}

function validateAcQuestion(qNum) {
    const errors = [];
    const prefix = `acQ${qNum}`;
    const label = `문제 ${qNum}`;

    const text = document.getElementById(`${prefix}Text`)?.value.trim();
    const trans = document.getElementById(`${prefix}Trans`)?.value.trim();
    if (!text) errors.push(`${label}의 문제 원문을 입력해주세요`);
    if (!trans) errors.push(`${label}의 문제 해석을 입력해주세요`);

    const answerEl = document.querySelector(`input[name="${prefix}Answer"]:checked`);
    if (!answerEl) errors.push(`${label}의 정답을 선택해주세요`);

    const labels = ['A', 'B', 'C', 'D'];
    labels.forEach(l => {
        const optText = document.getElementById(`${prefix}Opt${l}Text`)?.value.trim();
        const optTrans = document.getElementById(`${prefix}Opt${l}Trans`)?.value.trim();
        const optExp = document.getElementById(`${prefix}Opt${l}Exp`)?.value.trim();
        if (!optText) errors.push(`${label} 보기 ${l}의 원문을 입력해주세요`);
        if (!optTrans) errors.push(`${label} 보기 ${l}의 해석을 입력해주세요`);
        if (!optExp) errors.push(`${label} 보기 ${l}의 해설을 입력해주세요`);
    });

    return errors;
}

// ===== 등록 버튼 상태 =====
function updateAcRegisterBtn() {
    const btn = document.getElementById('acRegisterBtn');
    const errors = validateAcForm();
    btn.disabled = errors.length > 0;
    btn.innerHTML = acEditingSetId
        ? '<i class="fas fa-save"></i> 수정 저장'
        : '<i class="fas fa-upload"></i> 등록하기';
}

// ===== 등록 / 수정 =====
async function registerAcSet() {
    const errors = validateAcForm();
    if (errors.length > 0) {
        alert('⚠️ 입력을 확인해주세요:\n\n' + errors.map(e => '• ' + e).join('\n'));
        return;
    }

    const data = buildAcData();

    try {
        if (acEditingSetId) {
            const { id, ...updateData } = data;
            await supabaseAPI.patch(AC_TABLE, acEditingSetId, updateData);
            alert(`✅ ${acEditingSetId} 수정 완료!`);
        } else {
            await supabaseAPI.post(AC_TABLE, data);
            alert(`✅ ${data.id} 등록 완료!`);
        }

        resetAcForm();
        await loadAcExistingSets();
    } catch (error) {
        console.error('저장 실패:', error);
        alert('❌ 저장에 실패했습니다: ' + error.message);
    }
}

// ===== 🆕 문제 유형 태그 파싱 =====
function parseAcQuestionType(questionStr) {
    const match = questionStr.match(/^(Q\d+)(?:\[(\w+)\])?::(.*)$/s);
    if (!match) return { qNum: '', type: 'normal', rest: questionStr };

    return {
        qNum: match[1],
        type: match[2] || 'normal',
        rest: match[3]
    };
}

// ===== 수정 모드 =====
async function editAcSet(id) {
    const set = acExistingSets.find(s => s.id === id);
    if (!set) return;

    acEditingSetId = id;
    updateAcSetId();
    document.getElementById('acEditModeLabel').classList.remove('q-hidden');
    document.getElementById('acCancelEditBtn').classList.remove('q-hidden');

    // 기본 정보
    const mainTitleSel = document.getElementById('acMainTitleSelect');
    const presetValues = [
        'Read a passage about social psychology.',
        'Read a passage about marine biology.',
        'Read a passage about astrophysics.',
        'Read a passage from a biology textbook.'
    ];
    if (presetValues.includes(set.main_title)) {
        mainTitleSel.value = set.main_title;
        document.getElementById('acMainTitleCustom').classList.add('q-hidden');
    } else {
        mainTitleSel.value = '__custom__';
        document.getElementById('acMainTitleCustom').classList.remove('q-hidden');
        document.getElementById('acMainTitleCustom').value = set.main_title || '';
    }

    document.getElementById('acPassageTitle').value = set.passage_title || '';

    // ===== 단락 로드 (하위 호환 포함) =====
    // 레거시 배너 숨김 (기본)
    document.getElementById('acLegacyBanner').classList.remove('visible');

    if (set.passage_content && (set.passage_content.includes('##') || set.passage_content.includes('#|#'))) {
        // 새 방식: ## 로 단락 분리, #|# 로 문장 분리
        const rawParagraphs = set.passage_content.split('##');
        const allTranslations = (set.sentence_translations || '').split('##');

        let transIndex = 0;
        for (let i = 0; i < 3; i++) {
            const origEl = document.getElementById(`acPara${i + 1}Original`);
            const transEl = document.getElementById(`acPara${i + 1}Translation`);

            if (rawParagraphs[i]) {
                const sentences = rawParagraphs[i].split('#|#');
                origEl.value = sentences.join('\n');
                const translations = sentences.map(() => allTranslations[transIndex++] || '');
                transEl.value = translations.join('\n');
            } else {
                origEl.value = '';
                transEl.value = '';
            }
            onAcParagraphInput(i + 1);
        }
    } else {
        // 기존 방식 (레거시): 전체 원문을 단락 1에 넣기
        document.getElementById('acLegacyBanner').classList.add('visible');
        const fullText = set.passage_content || '';
        const allTrans = set.sentence_translations
            ? set.sentence_translations.split('##').join('\n')
            : '';
        document.getElementById('acPara1Original').value = fullText;
        document.getElementById('acPara1Translation').value = allTrans;
        document.getElementById('acPara2Original').value = '';
        document.getElementById('acPara2Translation').value = '';
        document.getElementById('acPara3Original').value = '';
        document.getElementById('acPara3Translation').value = '';
        for (let i = 1; i <= 3; i++) onAcParagraphInput(i);
    }

    // 핵심 단어 로드
    document.getElementById('acWordList').innerHTML = '';
    if (set.interactive_words) {
        set.interactive_words.split('##').forEach(wStr => {
            const parts = wStr.split('::');
            addAcWord(parts[0] || '', parts[1] || '', parts[2] || '');
        });
    }

    // 🆕 문제 1~5 로드 (유형 태그 포함)
    for (let i = 1; i <= 5; i++) {
        const questionStr = set[`question${i}`];
        if (questionStr && questionStr.trim()) {
            loadAcQuestionToForm(questionStr, i);
        }
    }

    updateAcRegisterBtn();
    renderAcPreview();

    // 스크롤 위로
    document.getElementById('acMainTitleSelect').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 문제 역파싱 → 폼 로드 =====
function loadAcQuestionToForm(questionStr, qNum) {
    const prefix = `acQ${qNum}`;

    // 1단계: 유형 태그 추출
    const parsed = parseAcQuestionType(questionStr);

    // 2단계: 유형 드롭다운 복원
    setAcQuestionType(qNum, parsed.type);

    // 3단계: 기존 파싱 (rest를 :: 로 split)
    const allParts = parsed.rest.split('::');
    const qText = allParts[0] || '';
    const qTrans = allParts[1] || '';
    const correctAnswer = parseInt(allParts[2]) || 0;

    const optionsRaw = allParts.slice(3).join('::');
    const optionParts = optionsRaw.split('##');

    document.getElementById(`${prefix}Text`).value = qText;
    document.getElementById(`${prefix}Trans`).value = qTrans;

    if (correctAnswer >= 1 && correctAnswer <= 4) {
        selectAcAnswer(prefix, correctAnswer);
    }

    const labels = ['A', 'B', 'C', 'D'];
    optionParts.forEach((optStr, i) => {
        if (i >= 4) return;
        const optParts = optStr.split('::');
        const match = optParts[0].match(/^([A-D])\)(.*)/);
        const text = match ? match[2] : optParts[0];
        const trans = optParts[1] || '';
        const exp = optParts.slice(2).join('::');

        const l = labels[i];
        const textEl = document.getElementById(`${prefix}Opt${l}Text`);
        const transEl = document.getElementById(`${prefix}Opt${l}Trans`);
        const expEl = document.getElementById(`${prefix}Opt${l}Exp`);
        if (textEl) textEl.value = text;
        if (transEl) transEl.value = trans;
        if (expEl) expEl.value = exp;
    });
}

// ===== 수정 취소 =====
function cancelAcEdit() {
    resetAcForm();
}

// ===== 폼 초기화 =====
function resetAcForm() {
    acEditingSetId = null;

    document.getElementById('acEditModeLabel').classList.add('q-hidden');
    document.getElementById('acCancelEditBtn').classList.add('q-hidden');

    // 기본 정보
    document.getElementById('acMainTitleSelect').value = '';
    document.getElementById('acMainTitleCustom').classList.add('q-hidden');
    document.getElementById('acMainTitleCustom').value = '';
    document.getElementById('acPassageTitle').value = '';

    // 단락 초기화
    for (let i = 1; i <= 3; i++) {
        document.getElementById(`acPara${i}Original`).value = '';
        document.getElementById(`acPara${i}Translation`).value = '';
        document.getElementById(`acPara${i}Status`).textContent = '';
        document.getElementById(`acPara${i}Status`).className = 'ac-paragraph-status';
    }
    // 레거시 배너 숨김
    document.getElementById('acLegacyBanner').classList.remove('visible');

    // 핵심 단어
    document.getElementById('acWordList').innerHTML = '';
    updateAcWordCount();

    // 문제 1~5 초기화
    for (let i = 1; i <= 5; i++) {
        initAcQuestionBlock(`acQuestion${i}`, i);
        // 유형 드롭다운 리셋
        const typeEl = document.getElementById(`acQ${i}Type`);
        if (typeEl) typeEl.value = 'normal';
        // 안내 메시지 숨김
        const hintEl = document.getElementById(`acQ${i}TypeHint`);
        if (hintEl) {
            hintEl.className = 'ac-qtype-hint';
        }
    }

    // highlight 배너 숨김
    document.getElementById('acHighlightBanner').classList.remove('visible');

    // 미리보기
    document.getElementById('acPreviewContent').innerHTML = '입력값을 채우면 미리보기가 표시됩니다.';
    document.getElementById('acPreviewContent').style.color = '#94a3b8';

    updateAcSetId();
    updateAcRegisterBtn();
}

// ===== 삭제 =====
async function deleteAcSet(id) {
    if (!confirm(`"${id}" 세트를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete(AC_TABLE, id);
        alert(`✅ ${id} 삭제 완료!`);
        await loadAcExistingSets();
    } catch (error) {
        console.error('삭제 실패:', error);
        alert('❌ 삭제에 실패했습니다: ' + error.message);
    }
}

// ===== 🆕 미리보기 (단락 3개 기반) =====
function renderAcPreview() {
    const container = document.getElementById('acPreviewContent');
    const mainTitle = getAcMainTitle();
    const passageTitle = document.getElementById('acPassageTitle').value.trim();
    const paragraphs = getAcParagraphs();
    const words = getAcWords();

    const hasParagraphContent = paragraphs.some(p => p.original);
    if (!mainTitle && !passageTitle && !hasParagraphContent) {
        container.innerHTML = '입력값을 채우면 미리보기가 표시됩니다.';
        container.style.color = '#94a3b8';
        return;
    }

    container.style.color = '';

    // insertion 문제가 있는지 확인
    let hasInsertionType = false;
    let hasSimplificationType = false;
    for (let i = 1; i <= 5; i++) {
        if (getAcQuestionType(i) === 'insertion') {
            hasInsertionType = true;
        }
        if (getAcQuestionType(i) === 'simplification') {
            hasSimplificationType = true;
        }
    }

    let html = '<div class="d1-preview">';

    // 상단 제목 + 지문 제목
    html += '<div class="d1-preview-section">';
    if (mainTitle) html += `<div class="d1-preview-main-title">📖 ${acEscapeHtml(mainTitle)}</div>`;
    if (passageTitle) html += `<div class="d1-preview-passage-title">📄 ${acEscapeHtml(passageTitle)}</div>`;
    html += '</div>';

    // 단락별 원문 + 해석 (문장 단위)
    let totalSentences = 0;
    const paraCounts = [];
    const validParas = paragraphs.filter(p => p.original);
    if (validParas.length > 0) {
        html += '<div class="d1-preview-section">';

        paragraphs.forEach((para, pIdx) => {
            if (!para.original) {
                paraCounts.push(0);
                return;
            }

            const origLines = para.original.split('\n').filter(l => l.trim() !== '');
            const transLines = para.translation ? para.translation.split('\n').filter(l => l.trim() !== '') : [];
            paraCounts.push(origLines.length);
            totalSentences += origLines.length;

            html += `<div style="margin-bottom:14px; padding:12px; background:#f8fafc; border-radius:8px; border-left:3px solid #6366f1;">`;
            html += `<div style="font-weight:700; color:#475569; font-size:13px; margin-bottom:8px;">[단락 ${pIdx + 1}]</div>`;

            origLines.forEach((sentence, sIdx) => {
                // 원문 렌더링: <<단어>> 하이라이트 + (A)~(D) insertion 마커
                let sentHtml = acEscapeHtml(sentence.trim());
                // <<>> → 하이라이트 (escape 후 &lt;&lt;...&gt;&gt; 를 변환)
                sentHtml = sentHtml.replace(/&lt;&lt;([^&]+?)&gt;&gt;/g, '<span class="ac-preview-highlight">$1</span>');
                // (A)~(D) → insertion 마커
                if (hasInsertionType) {
                    sentHtml = sentHtml.replace(/\(([A-D])\)/g, '<span class="ac-preview-insertion-marker">($1)</span>');
                }
                // [[]] → simplification 하이라이트
                if (hasSimplificationType) {
                    sentHtml = sentHtml.replace(/\[\[([^\]]+?)\]\]/g, '<span class="ac-preview-simplification">$1</span>');
                }

                html += `<div style="margin-bottom:4px; color:#1e293b;">${sentHtml}</div>`;
                // 해석이 있으면 바로 아래 표시
                if (transLines[sIdx]) {
                    html += `<div style="margin-bottom:8px; color:#6366f1; font-size:13px; padding-left:12px;">→ ${acEscapeHtml(transLines[sIdx].trim())}</div>`;
                }
            });

            html += '</div>';
        });

        // 총 문장 수 요약
        const paraCountStr = paraCounts.map((c, i) => `단락${i + 1}: ${c}`).join(' / ');
        html += `<div style="font-weight:600; margin-top:4px; font-size:13px; color:#475569;">📝 총 ${totalSentences}문장 (${paraCountStr})</div>`;

        html += '</div>';
    }

    // 핵심 단어
    const validWords = words.filter(w => w.word && w.translation);
    if (validWords.length > 0) {
        html += '<div class="d1-preview-section">';
        html += `<div style="font-weight:600; margin-bottom:8px;">🔤 핵심 단어 <span class="d1-preview-tag">${validWords.length}개</span></div>`;
        validWords.forEach(w => {
            let wordHtml = `<strong>${acEscapeHtml(w.word)}</strong> — ${acEscapeHtml(w.translation)}`;
            if (w.explanation) wordHtml += ` <span style="color:#94a3b8;">(${acEscapeHtml(w.explanation)})</span>`;
            html += `<div style="margin-bottom:4px; padding-left:8px;">${wordHtml}</div>`;
        });
        html += '</div>';
    }

    // 문제 1~5 미리보기
    for (let i = 1; i <= 5; i++) {
        const q = getAcQuestionData(i);
        if (q && q.text) {
            html += '<div class="d1-preview-section">';
            html += renderAcQuestionPreview(q);
            html += '</div>';
        }
    }

    html += '</div>';
    container.innerHTML = html;
}

function renderAcQuestionPreview(q) {
    if (!q || !q.text) return '';
    const labels = ['A', 'B', 'C', 'D'];

    // 유형 태그 표시
    let typeTag = '';
    if (q.type === 'highlight') {
        typeTag = ' <span style="background:#fefce8; color:#854d0e; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; border:1px solid #fde047;">[highlight]</span>';
    } else if (q.type === 'insertion') {
        typeTag = ' <span style="background:#fff7ed; color:#9a3412; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; border:1px solid #fdba74;">[insertion]</span>';
    } else if (q.type === 'simplification') {
        typeTag = ' <span style="background:#f0f9ff; color:#0369a1; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; border:1px solid #7dd3fc;">[simplification]</span>';
    } else {
        typeTag = ' <span style="background:#f1f5f9; color:#64748b; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">[일반]</span>';
    }

    let qHtml = `<div style="font-weight:600; margin-bottom:6px;">❓ ${acEscapeHtml(q.num)}${typeTag}: ${acEscapeHtml(q.text)}</div>`;
    if (q.translation) qHtml += `<div style="color:#64748b; margin-bottom:8px; padding-left:20px;">(${acEscapeHtml(q.translation)})</div>`;

    q.options.forEach((opt, i) => {
        const isCorrect = q.correctAnswer === (i + 1);
        const mark = isCorrect ? ' ← ✅ 정답' : '';
        const color = isCorrect ? 'color:#16a34a; font-weight:600;' : '';
        qHtml += `<div style="padding-left:20px; margin-bottom:3px; ${color}">${labels[i]}) ${acEscapeHtml(opt.text)}`;
        if (opt.translation) qHtml += ` <span style="color:#94a3b8;">(${acEscapeHtml(opt.translation)})</span>`;
        qHtml += `${mark}</div>`;
    });

    return qHtml;
}

// ===== 유틸리티 =====
function acEscapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function acEscapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== Academic JSON 붙여넣기 기능 =====

function openAcJsonModal() {
    document.getElementById('acJsonModal').style.display = 'flex';
    document.getElementById('acJsonInput').value = '';
    document.getElementById('acJsonError').style.display = 'none';
}

function closeAcJsonModal() {
    document.getElementById('acJsonModal').style.display = 'none';
    document.getElementById('acJsonInput').value = '';
    document.getElementById('acJsonError').style.display = 'none';
}

/**
 * Academic 문제 문자열 파싱
 * "Q1[highlight]::What...::뭐...::B::A)opt::해석::해설##B)opt::해석::해설##C)...##D)..."
 */
function parseAcJsonQuestion(questionStr) {
    if (!questionStr || !questionStr.trim()) return null;

    const str = questionStr.trim();

    // 유형 태그 추출: Q1[highlight]::... 또는 Q1[normal]::... 또는 Q1::...
    const typeMatch = str.match(/^(Q\d+)(?:\[(\w+)\])?\s*::\s*(.*)/s);
    if (!typeMatch) return null;

    const qNum = typeMatch[1];
    const type = typeMatch[2] || 'normal';
    const rest = typeMatch[3];

    const allParts = rest.split('::');
    if (allParts.length < 4) return null;

    const text = allParts[0] || '';
    const trans = allParts[1] || '';

    // 정답: 알파벳(A/B/C/D) 또는 숫자(1/2/3/4) 둘 다 지원
    const answerRaw = (allParts[2] || '').trim();
    let correctAnswer = 0;
    const letterMap = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
    if (letterMap[answerRaw.toUpperCase()]) {
        correctAnswer = letterMap[answerRaw.toUpperCase()];
    } else {
        correctAnswer = parseInt(answerRaw) || 0;
    }

    // 보기 부분
    const optionsRaw = allParts.slice(3).join('::');
    const optionParts = optionsRaw.split('##');

    const options = [];
    for (let i = 0; i < optionParts.length && i < 4; i++) {
        const optParts = optionParts[i].split('::');
        const match = optParts[0].match(/^([A-D])\)(.*)/);
        const optText = match ? match[2].trim() : optParts[0].trim();
        const optTrans = (optParts[1] || '').trim();
        const optExp = optParts.slice(2).join('::').trim();
        options.push({
            label: ['A', 'B', 'C', 'D'][i],
            text: optText,
            translation: optTrans,
            explanation: optExp
        });
    }

    return { qNum, type, text, translation: trans, correctAnswer, options };
}

/**
 * 파싱된 문제 데이터를 Academic 폼에 채우기
 */
function fillAcQuestionFromJson(qData, qNum) {
    if (!qData) return;
    const prefix = `acQ${qNum}`;

    // 유형 설정
    setAcQuestionType(qNum, qData.type);

    const textEl = document.getElementById(`${prefix}Text`);
    const transEl = document.getElementById(`${prefix}Trans`);
    if (textEl) textEl.value = qData.text;
    if (transEl) transEl.value = qData.translation;

    if (qData.correctAnswer >= 1 && qData.correctAnswer <= 4) {
        selectAcAnswer(prefix, qData.correctAnswer);
    }

    const labels = ['A', 'B', 'C', 'D'];
    qData.options.forEach((opt, i) => {
        if (i >= 4) return;
        const l = labels[i];
        const t = document.getElementById(`${prefix}Opt${l}Text`);
        const tr = document.getElementById(`${prefix}Opt${l}Trans`);
        const ex = document.getElementById(`${prefix}Opt${l}Exp`);
        if (t) t.value = opt.text;
        if (tr) tr.value = opt.translation;
        if (ex) ex.value = opt.explanation;
    });
}

/**
 * 메인: Academic JSON 붙여넣기 적용
 * Academic은 paragraphs 배열 구조 (Daily1/2의 구분자 방식과 다름)
 */
function applyAcJson() {
    const raw = document.getElementById('acJsonInput').value.trim();
    const errEl = document.getElementById('acJsonError');
    errEl.style.display = 'none';

    if (!raw) {
        errEl.textContent = '❌ JSON을 입력해주세요.';
        errEl.style.display = 'block';
        return;
    }

    let data = null;

    // ```json ... ``` 코드블록 자동 제거
    let cleaned = raw;
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    try {
        data = JSON.parse(cleaned);
        if (Array.isArray(data)) data = data[0];
    } catch (e) {
        errEl.textContent = '❌ JSON 형식이 올바르지 않습니다: ' + e.message;
        errEl.style.display = 'block';
        return;
    }

    if (!data || typeof data !== 'object') {
        errEl.textContent = '❌ 파싱 결과가 비어있습니다.';
        errEl.style.display = 'block';
        return;
    }

    if (!data.paragraphs && !data.question1) {
        errEl.textContent = '❌ paragraphs 또는 question1 중 하나는 필수입니다.';
        errEl.style.display = 'block';
        return;
    }

    // === 폼 채우기 시작 ===
    const summary = {
        main_title: false,
        passage_title: false,
        paragraphs: 0,
        sentences: 0,
        words: 0,
        questions: 0
    };

    // 1) MAIN_TITLE
    if (data.main_title) {
        const mainTitleSel = document.getElementById('acMainTitleSelect');
        const presetValues = [
            'Read a passage about social psychology.',
            'Read a passage about marine biology.',
            'Read a passage about astrophysics.',
            'Read a passage from a biology textbook.'
        ];
        const titleVal = data.main_title.trim();

        const matchedPreset = presetValues.find(p =>
            p === titleVal ||
            p.toLowerCase() === titleVal.toLowerCase() ||
            p.replace('.', '') === titleVal ||
            p.replace('.', '').toLowerCase() === titleVal.toLowerCase()
        );

        if (matchedPreset) {
            mainTitleSel.value = matchedPreset;
            document.getElementById('acMainTitleCustom').classList.add('q-hidden');
        } else {
            mainTitleSel.value = '__custom__';
            document.getElementById('acMainTitleCustom').classList.remove('q-hidden');
            document.getElementById('acMainTitleCustom').value = titleVal;
        }
        summary.main_title = true;
    }

    // 2) PASSAGE_TITLE
    if (data.passage_title) {
        document.getElementById('acPassageTitle').value = data.passage_title.trim();
        summary.passage_title = true;
    }

    // 3) PARAGRAPHS → 단락 3개 textarea에 채우기
    if (data.paragraphs && Array.isArray(data.paragraphs)) {
        // 핵심 단어 초기화
        document.getElementById('acWordList').innerHTML = '';

        for (let i = 0; i < 3; i++) {
            const para = data.paragraphs[i];
            const origEl = document.getElementById(`acPara${i + 1}Original`);
            const transEl = document.getElementById(`acPara${i + 1}Translation`);

            if (para) {
                // original: 문장 배열 → 줄바꿈으로 연결
                if (Array.isArray(para.original)) {
                    origEl.value = para.original.join('\n');
                    summary.sentences += para.original.length;
                } else if (typeof para.original === 'string') {
                    origEl.value = para.original;
                } else {
                    origEl.value = '';
                }

                // translation: 해석 배열 → 줄바꿈으로 연결
                if (Array.isArray(para.translation)) {
                    transEl.value = para.translation.join('\n');
                } else if (typeof para.translation === 'string') {
                    transEl.value = para.translation;
                } else {
                    transEl.value = '';
                }

                // words: 단락별 핵심 단어 → 통합 단어 목록에 추가
                if (Array.isArray(para.words)) {
                    para.words.forEach(wStr => {
                        const parts = wStr.split('::');
                        if (parts[0] && parts[0].trim()) {
                            addAcWord(
                                (parts[0] || '').trim(),
                                (parts[1] || '').trim(),
                                (parts[2] || '').trim()
                            );
                            summary.words++;
                        }
                    });
                }

                summary.paragraphs++;
            } else {
                origEl.value = '';
                transEl.value = '';
            }

            onAcParagraphInput(i + 1);
        }
    }

    // 4) QUESTION 1~5
    for (let i = 1; i <= 5; i++) {
        const qStr = data[`question${i}`];
        if (qStr && qStr.trim()) {
            const qData = parseAcJsonQuestion(qStr);
            if (qData) {
                initAcQuestionBlock(`acQuestion${i}`, i);
                fillAcQuestionFromJson(qData, i);
                summary.questions++;
            }
        }
    }

    // UI 갱신
    updateAcWordCount();
    updateAcHighlightBanner();
    updateAcRegisterBtn();
    renderAcPreview();

    closeAcJsonModal();

    // 결과 알림
    alert(`✅ 자동 채움 완료!\n\n` +
        `📖 상단 제목: ${summary.main_title ? '채움' : '없음 (수동 입력 필요)'}\n` +
        `📄 지문 제목: ${summary.passage_title ? '채움' : '없음 (수동 입력 필요)'}\n` +
        `📝 단락: ${summary.paragraphs}개 (문장: ${summary.sentences}개)\n` +
        `🔤 핵심 단어: ${summary.words}개\n` +
        `❓ 문제: ${summary.questions}개 채움\n\n` +
        `내용을 확인한 후 등록 버튼을 눌러주세요.`);
}
