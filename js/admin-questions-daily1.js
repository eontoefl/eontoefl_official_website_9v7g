// ===== 문제 관리: Reading - Daily1 =====

const D1_TABLE = 'tr_reading_daily1';
const D1_PREFIX = 'daily1_set_';

// State
let d1ExistingSets = [];
let d1EditingSetId = null;
let d1NextSetNumber = 1;
let d1Q2Visible = false;

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    initD1QuestionBlock('d1Question1', 1);
    // Q2는 토글 시 초기화
});

// ===== 기존 세트 목록 로드 =====
async function loadD1ExistingSets() {
    try {
        const res = await supabaseAPI.query(D1_TABLE, { order: 'id.asc', limit: '500' });
        d1ExistingSets = res || [];

        if (d1ExistingSets.length > 0) {
            const lastId = d1ExistingSets[d1ExistingSets.length - 1].id;
            const lastNum = parseInt(lastId.replace(D1_PREFIX, '')) || 0;
            d1NextSetNumber = lastNum + 1;
        } else {
            d1NextSetNumber = 1;
        }

        updateD1SetId();
        renderD1SetsList();
    } catch (error) {
        console.error('Daily1 세트 목록 로드 실패:', error);
        document.getElementById('d1SetsListWrap').innerHTML = '<div class="q-empty"><i class="fas fa-exclamation-triangle"></i> 로드 실패</div>';
    }
}

function updateD1SetId() {
    const idStr = d1EditingSetId || `${D1_PREFIX}${String(d1NextSetNumber).padStart(4, '0')}`;
    document.getElementById('d1SetId').textContent = idStr;
}

// ===== 세트 목록 렌더링 =====
function renderD1SetsList() {
    const wrap = document.getElementById('d1SetsListWrap');
    const countEl = document.getElementById('d1SetsCount');
    countEl.textContent = `(${d1ExistingSets.length}건)`;

    if (d1ExistingSets.length === 0) {
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

    d1ExistingSets.forEach(s => {
        const qCount = s.question2 ? 2 : 1;
        const date = s.created_at ? new Date(s.created_at).toLocaleDateString('ko-KR') : '-';
        const titleShort = (s.passage_title || '').length > 25
            ? d1EscapeHtml(s.passage_title.substring(0, 25)) + '...'
            : d1EscapeHtml(s.passage_title || '');
        html += `<tr>
            <td style="font-family:monospace; font-weight:600;">${d1EscapeHtml(s.id)}</td>
            <td>${d1EscapeHtml(s.main_title || '')}</td>
            <td title="${d1EscapeHtml(s.passage_title || '')}">${titleShort}</td>
            <td>${qCount}개</td>
            <td style="color:#64748b;">${date}</td>
            <td style="text-align:center;">
                <button class="q-btn q-btn-secondary q-btn-sm" onclick="editD1Set('${d1EscapeHtml(s.id)}')" title="수정">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="q-btn q-btn-danger q-btn-sm" onclick="deleteD1Set('${d1EscapeHtml(s.id)}')" title="삭제" style="margin-left:4px;">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

// ===== 상단 제목 드롭다운 =====
function onD1MainTitleChange() {
    const sel = document.getElementById('d1MainTitleSelect');
    const custom = document.getElementById('d1MainTitleCustom');
    if (sel.value === '__custom__') {
        custom.classList.remove('q-hidden');
        custom.focus();
    } else {
        custom.classList.add('q-hidden');
        custom.value = '';
    }
    updateD1RegisterBtn();
}

function getD1MainTitle() {
    const sel = document.getElementById('d1MainTitleSelect');
    if (sel.value === '__custom__') {
        return document.getElementById('d1MainTitleCustom').value.trim();
    }
    return sel.value;
}

// ===== 문장별 번역: 동적 행 =====
function addD1Sentence(value) {
    const list = document.getElementById('d1SentenceList');
    const idx = list.children.length + 1;
    const row = document.createElement('div');
    row.className = 'd1-sentence-row';
    row.innerHTML = `
        <div class="d1-sentence-num">${idx}</div>
        <input type="text" value="${d1EscapeAttr(value || '')}" placeholder="문장의 한글 해석을 입력하세요" oninput="updateD1RegisterBtn()">
        <button class="d1-del-btn" onclick="removeD1Sentence(this)" title="삭제"><i class="fas fa-times"></i></button>
    `;
    list.appendChild(row);
    updateD1SentenceNumbers();
    updateD1RegisterBtn();
}

function removeD1Sentence(btn) {
    btn.closest('.d1-sentence-row').remove();
    updateD1SentenceNumbers();
    updateD1RegisterBtn();
}

function updateD1SentenceNumbers() {
    const rows = document.querySelectorAll('#d1SentenceList .d1-sentence-row');
    rows.forEach((row, i) => {
        row.querySelector('.d1-sentence-num').textContent = i + 1;
    });
    document.getElementById('d1SentenceCount').textContent = `(${rows.length}개)`;
}

function getD1Sentences() {
    const rows = document.querySelectorAll('#d1SentenceList .d1-sentence-row');
    return Array.from(rows).map(r => r.querySelector('input').value.trim());
}

// ===== 핵심 단어: 동적 행 =====
function addD1Word(word, translation, explanation) {
    const list = document.getElementById('d1WordList');
    const row = document.createElement('div');
    row.className = 'd1-word-row';
    row.innerHTML = `
        <input type="text" value="${d1EscapeAttr(word || '')}" placeholder="영어 단어" oninput="updateD1RegisterBtn()">
        <input type="text" value="${d1EscapeAttr(translation || '')}" placeholder="한글 뜻" oninput="updateD1RegisterBtn()">
        <input type="text" value="${d1EscapeAttr(explanation || '')}" placeholder="설명 (선택)">
        <button class="d1-del-btn" onclick="removeD1Word(this)" title="삭제"><i class="fas fa-times"></i></button>
    `;
    list.appendChild(row);
    updateD1WordCount();
    updateD1RegisterBtn();
}

function removeD1Word(btn) {
    btn.closest('.d1-word-row').remove();
    updateD1WordCount();
    updateD1RegisterBtn();
}

function updateD1WordCount() {
    const rows = document.querySelectorAll('#d1WordList .d1-word-row');
    document.getElementById('d1WordCount').textContent = `(${rows.length}개)`;
}

function getD1Words() {
    const rows = document.querySelectorAll('#d1WordList .d1-word-row');
    return Array.from(rows).map(r => {
        const inputs = r.querySelectorAll('input');
        return {
            word: inputs[0].value.trim(),
            translation: inputs[1].value.trim(),
            explanation: inputs[2].value.trim()
        };
    });
}

// ===== 문제 블록 생성 =====
function initD1QuestionBlock(containerId, qNum) {
    const container = document.getElementById(containerId);
    const prefix = `d1Q${qNum}`;
    const labels = ['A', 'B', 'C', 'D'];

    let html = `<div class="d1-q-section">
        <div class="d1-q-row">
            <div>
                <div class="d1-q-label">문제 원문 <span class="d1-required">*</span></div>
                <input type="text" id="${prefix}Text" class="d1-input" placeholder="영어 질문 (예: When will the library reopen?)" oninput="updateD1RegisterBtn()">
            </div>
            <div>
                <div class="d1-q-label">문제 해석 <span class="d1-required">*</span></div>
                <input type="text" id="${prefix}Trans" class="d1-input" placeholder="한글 해석 (예: 도서관은 언제 다시 열리나요?)" oninput="updateD1RegisterBtn()">
            </div>
        </div>

        <div class="d1-q-full">
            <div class="d1-q-label">정답 선택 <span class="d1-required">*</span></div>
            <div class="d1-radio-group" id="${prefix}RadioGroup">`;

    labels.forEach((l, i) => {
        html += `
                <label class="d1-radio-label" id="${prefix}Radio${l}" onclick="selectD1Answer('${prefix}', ${i + 1})">
                    <input type="radio" name="${prefix}Answer" value="${i + 1}"> ${l}
                </label>`;
    });

    html += `
            </div>
        </div>`;

    // 보기 4개
    labels.forEach((l, i) => {
        html += `
        <div class="d1-option-card" id="${prefix}Option${l}">
            <div class="d1-option-card-header">
                <span class="d1-option-label">${l}</span>
                보기 ${l}
            </div>
            <div class="d1-q-row">
                <div>
                    <div class="d1-q-label">원문 <span class="d1-required">*</span></div>
                    <input type="text" id="${prefix}Opt${l}Text" class="d1-input" placeholder="보기 원문" oninput="updateD1RegisterBtn()">
                </div>
                <div>
                    <div class="d1-q-label">해석 <span class="d1-required">*</span></div>
                    <input type="text" id="${prefix}Opt${l}Trans" class="d1-input" placeholder="보기 해석" oninput="updateD1RegisterBtn()">
                </div>
            </div>
            <div class="d1-q-full">
                <div class="d1-q-label">해설 <span class="d1-required">*</span></div>
                <textarea id="${prefix}Opt${l}Exp" class="d1-input" style="min-height:60px; resize:vertical;" placeholder="정답/오답 이유 설명" oninput="updateD1RegisterBtn()"></textarea>
            </div>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
}

function selectD1Answer(prefix, num) {
    const labels = ['A', 'B', 'C', 'D'];
    // 라디오 UI 업데이트
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
    // 실제 라디오 체크
    const radio = document.querySelector(`input[name="${prefix}Answer"][value="${num}"]`);
    if (radio) radio.checked = true;
    updateD1RegisterBtn();
}

function getD1QuestionData(qNum) {
    const prefix = `d1Q${qNum}`;
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

    return { num: `Q${qNum}`, text, translation: trans, correctAnswer, options };
}

// ===== 문제 2 토글 =====
function toggleD1Question2() {
    const container = document.getElementById('d1Question2');
    const btn = document.getElementById('d1Q2ToggleBtn');

    if (!d1Q2Visible) {
        d1Q2Visible = true;
        container.classList.remove('q-hidden');
        initD1QuestionBlock('d1Question2', 2);
        btn.innerHTML = '<i class="fas fa-minus"></i> 문제 2 제거';
        btn.classList.remove('q-btn-secondary');
        btn.classList.add('q-btn-danger');
    } else {
        if (!confirm('문제 2 입력값이 모두 초기화됩니다. 제거하시겠습니까?')) return;
        d1Q2Visible = false;
        container.classList.add('q-hidden');
        container.innerHTML = '';
        btn.innerHTML = '<i class="fas fa-plus"></i> 문제 2 추가';
        btn.classList.remove('q-btn-danger');
        btn.classList.add('q-btn-secondary');
    }
    updateD1RegisterBtn();
}

// ===== 구분자 치환 =====
function d1SanitizeDelimiters(str) {
    if (!str) return '';
    return str.replace(/::/g, ': :').replace(/##/g, '# #');
}

// ===== 데이터 조합 (폼 → DB) =====
function buildD1Data() {
    const mainTitle = d1SanitizeDelimiters(getD1MainTitle());
    const passageTitle = d1SanitizeDelimiters(document.getElementById('d1PassageTitle').value.trim());
    const passageContent = document.getElementById('d1PassageContent').value.trim();
    const sentences = getD1Sentences().map(s => d1SanitizeDelimiters(s));
    const words = getD1Words();

    const sentenceTranslations = sentences.join('##');
    const interactiveWords = words.map(w => {
        const word = d1SanitizeDelimiters(w.word);
        const translation = d1SanitizeDelimiters(w.translation);
        const explanation = d1SanitizeDelimiters(w.explanation);
        if (explanation) return `${word}::${translation}::${explanation}`;
        return `${word}::${translation}`;
    }).join('##');

    function buildQuestion(qData) {
        if (!qData || !qData.text) return '';
        const labels = ['A', 'B', 'C', 'D'];
        const optionsStr = qData.options.map((opt, i) => {
            const text = d1SanitizeDelimiters(opt.text);
            const trans = d1SanitizeDelimiters(opt.translation);
            const exp = d1SanitizeDelimiters(opt.explanation);
            return `${labels[i]})${text}::${trans}::${exp}`;
        }).join('##');
        const qText = d1SanitizeDelimiters(qData.text);
        const qTrans = d1SanitizeDelimiters(qData.translation);
        return `${qData.num}::${qText}::${qTrans}::${qData.correctAnswer}::${optionsStr}`;
    }

    const q1 = getD1QuestionData(1);
    const q2 = d1Q2Visible ? getD1QuestionData(2) : null;

    const setId = d1EditingSetId || `${D1_PREFIX}${String(d1NextSetNumber).padStart(4, '0')}`;

    return {
        id: setId,
        main_title: mainTitle,
        passage_title: passageTitle,
        passage_content: passageContent,
        sentence_translations: sentenceTranslations,
        interactive_words: interactiveWords,
        question1: buildQuestion(q1),
        question2: buildQuestion(q2)
    };
}

// ===== 유효성 검사 =====
function validateD1Form() {
    const errors = [];

    // 상단 제목
    if (!getD1MainTitle()) errors.push('상단 제목을 선택해주세요');
    // 지문 제목
    if (!document.getElementById('d1PassageTitle').value.trim()) errors.push('지문 제목을 입력해주세요');
    // 지문 본문
    if (!document.getElementById('d1PassageContent').value.trim()) errors.push('지문 본문을 입력해주세요');

    // 문장별 번역
    const sentences = getD1Sentences();
    if (sentences.length === 0) {
        errors.push('문장별 번역을 최소 1개 입력해주세요');
    } else {
        sentences.forEach((s, i) => {
            if (!s) errors.push(`문장별 번역 #${i + 1}이 비어있습니다`);
        });
    }

    // 핵심 단어
    const words = getD1Words();
    if (words.length === 0) {
        errors.push('핵심 단어를 최소 1개 입력해주세요');
    } else {
        words.forEach((w, i) => {
            if (!w.word) errors.push(`핵심 단어 #${i + 1}의 단어를 입력해주세요`);
            if (!w.translation) errors.push(`핵심 단어 #${i + 1}의 뜻을 입력해주세요`);
        });
    }

    // 문제 1 검사
    const q1Errors = validateD1Question(1);
    errors.push(...q1Errors);

    // 문제 2 (있을 때만)
    if (d1Q2Visible) {
        const q2Errors = validateD1Question(2);
        errors.push(...q2Errors);
    }

    return errors;
}

function validateD1Question(qNum) {
    const errors = [];
    const prefix = `d1Q${qNum}`;
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

// ===== 등록 버튼 상태 업데이트 =====
function updateD1RegisterBtn() {
    const btn = document.getElementById('d1RegisterBtn');
    const errors = validateD1Form();
    btn.disabled = errors.length > 0;
    btn.innerHTML = d1EditingSetId
        ? '<i class="fas fa-save"></i> 수정 저장'
        : '<i class="fas fa-upload"></i> 등록하기';
}

// ===== 등록 / 수정 =====
async function registerD1Set() {
    const errors = validateD1Form();
    if (errors.length > 0) {
        alert('⚠️ 입력을 확인해주세요:\n\n' + errors.map(e => '• ' + e).join('\n'));
        return;
    }

    const data = buildD1Data();

    try {
        if (d1EditingSetId) {
            // 수정
            const { id, ...updateData } = data;
            await supabaseAPI.patch(D1_TABLE, d1EditingSetId, updateData);
            alert(`✅ ${d1EditingSetId} 수정 완료!`);
        } else {
            // 신규 등록
            await supabaseAPI.post(D1_TABLE, data);
            alert(`✅ ${data.id} 등록 완료!`);
        }

        resetD1Form();
        await loadD1ExistingSets();
    } catch (error) {
        console.error('저장 실패:', error);
        alert('❌ 저장에 실패했습니다: ' + error.message);
    }
}

// ===== 수정 모드 =====
async function editD1Set(id) {
    const set = d1ExistingSets.find(s => s.id === id);
    if (!set) return;

    d1EditingSetId = id;
    updateD1SetId();
    document.getElementById('d1EditModeLabel').classList.remove('q-hidden');
    document.getElementById('d1CancelEditBtn').classList.remove('q-hidden');

    // 기본 정보
    const mainTitleSel = document.getElementById('d1MainTitleSelect');
    const presetValues = ['Read a notice.', 'Read an email.', 'Read an advertisement.', 'Read an article.'];
    if (presetValues.includes(set.main_title)) {
        mainTitleSel.value = set.main_title;
        document.getElementById('d1MainTitleCustom').classList.add('q-hidden');
    } else {
        mainTitleSel.value = '__custom__';
        document.getElementById('d1MainTitleCustom').classList.remove('q-hidden');
        document.getElementById('d1MainTitleCustom').value = set.main_title || '';
    }

    document.getElementById('d1PassageTitle').value = set.passage_title || '';
    document.getElementById('d1PassageContent').value = set.passage_content || '';

    // 문장별 번역 로드
    document.getElementById('d1SentenceList').innerHTML = '';
    if (set.sentence_translations) {
        set.sentence_translations.split('##').forEach(s => addD1Sentence(s));
    }

    // 핵심 단어 로드
    document.getElementById('d1WordList').innerHTML = '';
    if (set.interactive_words) {
        set.interactive_words.split('##').forEach(wStr => {
            const parts = wStr.split('::');
            addD1Word(parts[0] || '', parts[1] || '', parts[2] || '');
        });
    }

    // 문제 1 로드
    if (set.question1) {
        loadD1QuestionToForm(set.question1, 1);
    }

    // 문제 2 로드
    if (set.question2 && set.question2.trim()) {
        if (!d1Q2Visible) toggleD1Question2();
        // initD1QuestionBlock이 toggleD1Question2 안에서 호출되므로 약간의 지연 필요
        setTimeout(() => {
            loadD1QuestionToForm(set.question2, 2);
            updateD1RegisterBtn();
        }, 50);
    } else {
        if (d1Q2Visible) {
            d1Q2Visible = false;
            document.getElementById('d1Question2').classList.add('q-hidden');
            document.getElementById('d1Question2').innerHTML = '';
            const btn = document.getElementById('d1Q2ToggleBtn');
            btn.innerHTML = '<i class="fas fa-plus"></i> 문제 2 추가';
            btn.classList.remove('q-btn-danger');
            btn.classList.add('q-btn-secondary');
        }
    }

    updateD1RegisterBtn();
    renderD1Preview();

    // 스크롤 위로
    document.getElementById('d1MainTitleSelect').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 문제 역파싱 → 폼 로드 =====
function loadD1QuestionToForm(questionStr, qNum) {
    const prefix = `d1Q${qNum}`;

    // 먼저 :: 로 4개 파트를 추출 (Qn, text, trans, answer)
    // 나머지는 보기 파트
    const allParts = questionStr.split('::');
    // allParts[0] = "Q1", allParts[1] = 문제원문, allParts[2] = 문제해석, allParts[3] = 정답번호
    // allParts[4~] = 보기 데이터 (##로 구분된 보기들이 ::로 쪼개진 상태)

    const qText = allParts[1] || '';
    const qTrans = allParts[2] || '';
    const correctAnswer = parseInt(allParts[3]) || 0;

    // 나머지를 다시 합치고 ##로 분리
    const optionsRaw = allParts.slice(4).join('::');
    const optionParts = optionsRaw.split('##');

    document.getElementById(`${prefix}Text`).value = qText;
    document.getElementById(`${prefix}Trans`).value = qTrans;

    // 정답 선택
    if (correctAnswer >= 1 && correctAnswer <= 4) {
        selectD1Answer(prefix, correctAnswer);
    }

    // 보기 로드
    const labels = ['A', 'B', 'C', 'D'];
    optionParts.forEach((optStr, i) => {
        if (i >= 4) return;
        const optParts = optStr.split('::');
        const match = optParts[0].match(/^([A-D])\)(.*)/);
        const text = match ? match[2] : optParts[0];
        const trans = optParts[1] || '';
        const exp = optParts.slice(2).join('::'); // 해설에 :: 포함 가능

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
function cancelD1Edit() {
    resetD1Form();
}

// ===== 폼 초기화 =====
function resetD1Form() {
    d1EditingSetId = null;
    d1Q2Visible = false;

    document.getElementById('d1EditModeLabel').classList.add('q-hidden');
    document.getElementById('d1CancelEditBtn').classList.add('q-hidden');

    // 기본 정보
    document.getElementById('d1MainTitleSelect').value = '';
    document.getElementById('d1MainTitleCustom').classList.add('q-hidden');
    document.getElementById('d1MainTitleCustom').value = '';
    document.getElementById('d1PassageTitle').value = '';
    document.getElementById('d1PassageContent').value = '';

    // 문장별 번역
    document.getElementById('d1SentenceList').innerHTML = '';
    updateD1SentenceNumbers();

    // 핵심 단어
    document.getElementById('d1WordList').innerHTML = '';
    updateD1WordCount();

    // 문제 1 초기화
    initD1QuestionBlock('d1Question1', 1);

    // 문제 2 초기화
    const q2Container = document.getElementById('d1Question2');
    q2Container.classList.add('q-hidden');
    q2Container.innerHTML = '';
    const btn = document.getElementById('d1Q2ToggleBtn');
    btn.innerHTML = '<i class="fas fa-plus"></i> 문제 2 추가';
    btn.classList.remove('q-btn-danger');
    btn.classList.add('q-btn-secondary');

    // 미리보기
    document.getElementById('d1PreviewContent').innerHTML = '입력값을 채우면 미리보기가 표시됩니다.';
    document.getElementById('d1PreviewContent').style.color = '#94a3b8';

    updateD1SetId();
    updateD1RegisterBtn();
}

// ===== 삭제 =====
async function deleteD1Set(id) {
    if (!confirm(`"${id}" 세트를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete(D1_TABLE, id);
        alert(`✅ ${id} 삭제 완료!`);
        await loadD1ExistingSets();
    } catch (error) {
        console.error('삭제 실패:', error);
        alert('❌ 삭제에 실패했습니다: ' + error.message);
    }
}

// ===== 미리보기 =====
function renderD1Preview() {
    const container = document.getElementById('d1PreviewContent');
    const mainTitle = getD1MainTitle();
    const passageTitle = document.getElementById('d1PassageTitle').value.trim();
    const passageContent = document.getElementById('d1PassageContent').value.trim();
    const sentences = getD1Sentences();
    const words = getD1Words();
    const q1 = getD1QuestionData(1);
    const q2 = d1Q2Visible ? getD1QuestionData(2) : null;

    if (!mainTitle && !passageTitle && !passageContent) {
        container.innerHTML = '입력값을 채우면 미리보기가 표시됩니다.';
        container.style.color = '#94a3b8';
        return;
    }

    container.style.color = '';
    let html = '<div class="d1-preview">';

    // 상단 제목 + 지문 제목
    html += '<div class="d1-preview-section">';
    if (mainTitle) html += `<div class="d1-preview-main-title">📖 ${d1EscapeHtml(mainTitle)}</div>`;
    if (passageTitle) html += `<div class="d1-preview-passage-title">📄 ${d1EscapeHtml(passageTitle)}</div>`;
    if (passageContent) html += `<div class="d1-preview-passage">${d1EscapeHtml(passageContent)}</div>`;
    html += '</div>';

    // 문장별 번역
    const validSentences = sentences.filter(s => s);
    if (validSentences.length > 0) {
        html += '<div class="d1-preview-section">';
        html += `<div style="font-weight:600; margin-bottom:8px;">📝 문장별 번역 <span class="d1-preview-tag">${validSentences.length}개</span></div>`;
        validSentences.forEach((s, i) => {
            html += `<div style="margin-bottom:4px; padding-left:8px; color:#475569;">${i + 1}. ${d1EscapeHtml(s)}</div>`;
        });
        html += '</div>';
    }

    // 핵심 단어
    const validWords = words.filter(w => w.word && w.translation);
    if (validWords.length > 0) {
        html += '<div class="d1-preview-section">';
        html += `<div style="font-weight:600; margin-bottom:8px;">🔤 핵심 단어 <span class="d1-preview-tag">${validWords.length}개</span></div>`;
        validWords.forEach(w => {
            let wordHtml = `<strong>${d1EscapeHtml(w.word)}</strong> — ${d1EscapeHtml(w.translation)}`;
            if (w.explanation) wordHtml += ` <span style="color:#94a3b8;">(${d1EscapeHtml(w.explanation)})</span>`;
            html += `<div style="margin-bottom:4px; padding-left:8px;">${wordHtml}</div>`;
        });
        html += '</div>';
    }

    // 문제 미리보기
    function renderQuestionPreview(q) {
        if (!q || !q.text) return '';
        const labels = ['A', 'B', 'C', 'D'];
        let qHtml = `<div style="font-weight:600; margin-bottom:6px;">❓ ${d1EscapeHtml(q.num)}: ${d1EscapeHtml(q.text)}</div>`;
        if (q.translation) qHtml += `<div style="color:#64748b; margin-bottom:8px; padding-left:20px;">(${d1EscapeHtml(q.translation)})</div>`;
        q.options.forEach((opt, i) => {
            const isCorrect = q.correctAnswer === (i + 1);
            const mark = isCorrect ? ' ← ✅ 정답' : '';
            const color = isCorrect ? 'color:#16a34a; font-weight:600;' : '';
            qHtml += `<div style="padding-left:20px; margin-bottom:3px; ${color}">${labels[i]}) ${d1EscapeHtml(opt.text)}`;
            if (opt.translation) qHtml += ` <span style="color:#94a3b8;">(${d1EscapeHtml(opt.translation)})</span>`;
            qHtml += `${mark}</div>`;
        });
        return qHtml;
    }

    if (q1 && q1.text) {
        html += '<div class="d1-preview-section">';
        html += renderQuestionPreview(q1);
        html += '</div>';
    }
    if (q2 && q2.text) {
        html += '<div class="d1-preview-section">';
        html += renderQuestionPreview(q2);
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}

// ===== 유틸리티 =====
function d1EscapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function d1EscapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
