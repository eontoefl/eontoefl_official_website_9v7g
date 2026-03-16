// ===== 문제 데이터 조회 모듈 (Quick View) =====
// 각 유형별 세트 데이터를 조회하여, 선택한 요소만 리스트로 보여줌

const QV_CONFIGS = {
    'reading-fillblanks': {
        table: 'tr_reading_fillblanks',
        prefix: 'fillblank_set_',
        idField: 'id',
        setIdField: null,  // id가 세트 단위
        chips: [
            { key: 'passage', label: '지문 (원문)', extract: s => extractFbPassageText(s.passage_with_markers) },
            { key: 'answers', label: '정답', extract: s => extractFbAnswers(s.passage_with_markers) },
            { key: 'explanations', label: '해설', extract: s => extractFbExplanations(s.passage_with_markers) },
            { key: 'mistakes', label: '헷갈리는 오답', extract: s => extractFbMistakes(s.passage_with_markers) }
        ]
    },
    'reading-daily1': {
        table: 'tr_reading_daily1',
        prefix: 'daily1_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'main_title', label: '상단 제목', extract: s => s.main_title || '' },
            { key: 'passage_title', label: '지문 제목', extract: s => s.passage_title || '' },
            { key: 'passage_content', label: '지문', extract: s => d1FormatPassage(s.passage_content) },
            { key: 'sentence_translations', label: '해석', extract: s => d1FormatTranslations(s.sentence_translations) },
            { key: 'interactive_words', label: '핵심 단어', extract: s => d1FormatWords(s.interactive_words) },
            { key: 'question', label: '문제', extract: s => d1FormatQuestions(s) },
            { key: 'answer', label: '정답', extract: s => d1FormatAnswers(s) },
            { key: 'options', label: '보기', extract: s => d1FormatOptions(s) }
        ]
    },
    'reading-daily2': {
        table: 'tr_reading_daily2',
        prefix: 'daily2_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'main_title', label: '상단 제목', extract: s => s.main_title || '' },
            { key: 'passage_title', label: '지문 제목', extract: s => s.passage_title || '' },
            { key: 'passage_content', label: '지문', extract: s => d1FormatPassage(s.passage_content) },
            { key: 'sentence_translations', label: '해석', extract: s => d1FormatTranslations(s.sentence_translations) },
            { key: 'interactive_words', label: '핵심 단어', extract: s => d1FormatWords(s.interactive_words) },
            { key: 'question', label: '문제', extract: s => d2FormatQuestions(s) },
            { key: 'answer', label: '정답', extract: s => d2FormatAnswers(s) },
            { key: 'options', label: '보기', extract: s => d2FormatOptions(s) }
        ]
    },
    'reading-academic': {
        table: 'tr_reading_academic',
        prefix: 'academic_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'main_title', label: '상단 제목', extract: s => s.main_title || '' },
            { key: 'passage_title', label: '지문 제목', extract: s => s.passage_title || '' },
            { key: 'passage_content', label: '지문', extract: s => d1FormatPassage(s.passage_content) },
            { key: 'sentence_translations', label: '해석', extract: s => d1FormatTranslations(s.sentence_translations) },
            { key: 'interactive_words', label: '핵심 단어', extract: s => d1FormatWords(s.interactive_words) },
            { key: 'question', label: '문제', extract: s => acFormatQuestions(s) },
            { key: 'answer', label: '정답', extract: s => acFormatAnswers(s) },
            { key: 'options', label: '보기', extract: s => acFormatOptions(s) }
        ]
    },
    'listening-response': {
        table: 'tr_listening_response',
        prefix: 'response_set_',
        idField: 'set_id',
        setIdField: 'set_id',
        groupBy: 'set_id',
        chips: [
            { key: 'script', label: '대본 (영어)', extract: (s, rows) => lrFormatGrouped(rows, 'script') },
            { key: 'script_trans', label: '대본 (번역)', extract: (s, rows) => lrFormatGrouped(rows, 'script_trans') },
            { key: 'answer', label: '정답', extract: (s, rows) => lrFormatGrouped(rows, 'answer') },
            { key: 'options', label: '보기', extract: (s, rows) => lrFormatOptions(rows) },
            { key: 'options_trans', label: '보기 (번역)', extract: (s, rows) => lrFormatOptionsTrans(rows) },
            { key: 'explanations', label: '해설', extract: (s, rows) => lrFormatExplanations(rows) }
        ]
    },
    'listening-conversation': {
        table: 'tr_listening_conversation',
        prefix: 'conversation_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'script', label: '스크립트', extract: s => s.script || '' },
            { key: 'script_trans', label: '스크립트 (번역)', extract: s => s.script_trans || '' },
            { key: 'question', label: '문제', extract: s => lcFormatQuestions(s) },
            { key: 'answer', label: '정답', extract: s => lcFormatAnswers(s) },
            { key: 'options', label: '보기', extract: s => lcFormatOptions(s) },
            { key: 'highlights', label: '핵심표현', extract: s => formatHighlights(s.script_highlights) }
        ]
    },
    'listening-announcement': {
        table: 'tr_listening_announcement',
        prefix: 'announcement_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'script', label: '스크립트', extract: s => s.script || '' },
            { key: 'script_trans', label: '스크립트 (번역)', extract: s => s.script_trans || '' },
            { key: 'question', label: '문제', extract: s => laFormatQuestions(s) },
            { key: 'answer', label: '정답', extract: s => laFormatAnswers(s) },
            { key: 'options', label: '보기', extract: s => laFormatOptions(s) },
            { key: 'highlights', label: '핵심표현', extract: s => formatHighlights(s.script_highlights) }
        ]
    },
    'listening-lecture': {
        table: 'tr_listening_lecture',
        prefix: 'lecture_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'lecture_title', label: '강의 제목', extract: s => s.lecture_title || '' },
            { key: 'script', label: '스크립트', extract: s => s.script || '' },
            { key: 'script_trans', label: '스크립트 (번역)', extract: s => s.script_trans || '' },
            { key: 'question', label: '문제', extract: s => llFormatQuestions(s) },
            { key: 'answer', label: '정답', extract: s => llFormatAnswers(s) },
            { key: 'options', label: '보기', extract: s => llFormatOptions(s) },
            { key: 'highlights', label: '핵심표현', extract: s => formatHighlights(s.script_highlights) }
        ]
    },
    'writing-arrange': {
        table: 'tr_writing_arrange',
        prefix: 'arrange_set_',
        idField: 'set_id',
        setIdField: 'set_id',
        groupBy: 'set_id',
        chips: [
            { key: 'hint', label: '힌트', extract: (s, rows) => waFormatGrouped(rows, 'given_sentence') },
            { key: 'hint_trans', label: '힌트 (번역)', extract: (s, rows) => waFormatGrouped(rows, 'given_translation') },
            { key: 'answer', label: '정답', extract: (s, rows) => waFormatGrouped(rows, 'correct_answer') },
            { key: 'answer_trans', label: '정답 (번역)', extract: (s, rows) => waFormatGrouped(rows, 'correct_translation') },
            { key: 'options', label: '제시 단어', extract: (s, rows) => waFormatGrouped(rows, 'option_words') },
            { key: 'explanation', label: '해설', extract: (s, rows) => waFormatGrouped(rows, 'explanation') }
        ]
    },
    'writing-email': {
        table: 'tr_writing_email',
        prefix: 'email_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'scenario', label: '시나리오', extract: s => s.scenario || '' },
            { key: 'task', label: '과제', extract: s => s.task || '' },
            { key: 'to_recipient', label: '수신자', extract: s => s.to_recipient || '' },
            { key: 'subject', label: '이메일 제목', extract: s => s.subject || '' },
            { key: 'instruction', label: '지시사항', extract: s => weFormatInstructions(s) },
            { key: 'sample_answer', label: '모범답안', extract: s => s.sample_answer || '' },
            { key: 'must', label: 'must (꼭 말할것)', extract: s => weFormatBulletField(s, 'must') },
            { key: 'sample', label: 'sample (모범답안 부분)', extract: s => weFormatBulletField(s, 'sample') },
            { key: 'points', label: '만점 포인트', extract: s => weFormatBulletField(s, 'points') },
            { key: 'key', label: '핵심 요약', extract: s => weFormatBulletField(s, 'key') }
        ]
    },
    'writing-discussion': {
        table: 'tr_writing_discussion',
        prefix: 'discussion_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'class_context', label: '수업 맥락', extract: s => s.class_context || '' },
            { key: 'topic', label: '토론 주제', extract: s => s.topic || '' },
            { key: 'student1_opinion', label: '학생1 의견', extract: s => s.student1_opinion || '' },
            { key: 'student2_opinion', label: '학생2 의견', extract: s => s.student2_opinion || '' },
            { key: 'sample_answer', label: '모범답안', extract: s => s.sample_answer || '' },
            { key: 'bullet_sentence', label: '핵심 문장', extract: s => wdFormatBulletField(s, 'sentence') },
            { key: 'bullet_ets', label: 'ETS 채점', extract: s => wdFormatBulletField(s, 'ets') },
            { key: 'bullet_strategy', label: '전략', extract: s => wdFormatBulletField(s, 'strategy') }
        ]
    },
    'speaking-repeat': {
        table: 'tr_speaking_repeat',
        prefix: 'repeat_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'context_text', label: '상황 설명', extract: s => s.context_text || '' },
            { key: 'script', label: '스크립트', extract: s => srFormatScripts(s) },
            { key: 'translation', label: '번역', extract: s => srFormatTranslations(s) }
        ]
    },
    'speaking-interview': {
        table: 'tr_speaking_interview',
        prefix: 'interview_set_',
        idField: 'id',
        setIdField: null,
        chips: [
            { key: 'context_text', label: '상황 설명', extract: s => s.context_text || '' },
            { key: 'script', label: '질문', extract: s => siFormatScripts(s) },
            { key: 'translation', label: '질문 번역', extract: s => siFormatTranslations(s) },
            { key: 'model_answer', label: '모범 답변', extract: s => siFormatModelAnswers(s) },
            { key: 'model_answer_trans', label: '모범 답변 번역', extract: s => siFormatModelAnswersTrans(s) }
        ]
    }
};

// ===== State per section =====
const qvState = {};  // { sectionKey: { data: [], activeChip: null, rangeMode: 'all', rangeStart: 1, rangeEnd: 999, collapsed: false } }

// ===== Initialize a viewer for a section =====
function qvInit(sectionKey) {
    if (!qvState[sectionKey]) {
        qvState[sectionKey] = { data: null, activeChip: null, rangeMode: 'all', rangeStart: 1, rangeEnd: 9999, collapsed: false, loading: false };
    }
}

// ===== Toggle viewer collapse =====
function qvToggleCollapse(sectionKey) {
    qvInit(sectionKey);
    const st = qvState[sectionKey];
    st.collapsed = !st.collapsed;
    const body = document.getElementById(`qv-body-${sectionKey}`);
    const arrow = document.getElementById(`qv-arrow-${sectionKey}`);
    if (body) body.style.display = st.collapsed ? 'none' : 'block';
    if (arrow) arrow.innerHTML = st.collapsed ? '<i class="fas fa-chevron-down"></i>' : '<i class="fas fa-chevron-up"></i>';
}

// ===== Chip click → fetch if needed, then render =====
async function qvSelectChip(sectionKey, chipKey) {
    qvInit(sectionKey);
    const st = qvState[sectionKey];
    const config = QV_CONFIGS[sectionKey];
    if (!config) return;

    st.activeChip = chipKey;

    // Highlight active chip
    const chipsWrap = document.getElementById(`qv-chips-${sectionKey}`);
    if (chipsWrap) {
        chipsWrap.querySelectorAll('.qv-chip').forEach(el => {
            el.classList.toggle('active', el.dataset.chipKey === chipKey);
        });
    }

    // Fetch data if not cached
    if (!st.data) {
        st.loading = true;
        qvRenderResult(sectionKey);  // show loading
        try {
            const res = await supabaseAPI.query(config.table, { order: `${config.idField || 'id'}.asc`, limit: '500' });
            if (config.groupBy) {
                // Group rows by set_id
                const grouped = {};
                (res || []).forEach(row => {
                    const sid = row[config.groupBy];
                    if (!grouped[sid]) grouped[sid] = { _setId: sid, _rows: [] };
                    grouped[sid]._rows.push(row);
                });
                st.data = Object.values(grouped);
            } else {
                st.data = res || [];
            }
        } catch (e) {
            console.error('QV fetch error:', e);
            st.data = [];
        }
        st.loading = false;
    }

    qvRenderResult(sectionKey);
}

// ===== Range mode change =====
function qvSetRange(sectionKey, mode) {
    qvInit(sectionKey);
    const st = qvState[sectionKey];
    st.rangeMode = mode;
    const rangeInputs = document.getElementById(`qv-range-inputs-${sectionKey}`);
    if (rangeInputs) rangeInputs.style.display = mode === 'range' ? 'inline-flex' : 'none';
    if (st.activeChip) qvRenderResult(sectionKey);
}

function qvUpdateRange(sectionKey) {
    qvInit(sectionKey);
    const st = qvState[sectionKey];
    const startEl = document.getElementById(`qv-range-start-${sectionKey}`);
    const endEl = document.getElementById(`qv-range-end-${sectionKey}`);
    st.rangeStart = parseInt(startEl?.value) || 1;
    st.rangeEnd = parseInt(endEl?.value) || 9999;
    if (st.activeChip) qvRenderResult(sectionKey);
}

// ===== Get set number from id =====
function qvGetSetNum(sectionKey, item) {
    const config = QV_CONFIGS[sectionKey];
    if (config.groupBy) {
        return parseInt((item._setId || '').replace(config.prefix, '')) || 0;
    }
    return parseInt(((item.id || '') + '').replace(config.prefix, '')) || 0;
}

// ===== Render result list =====
function qvRenderResult(sectionKey) {
    const st = qvState[sectionKey];
    const config = QV_CONFIGS[sectionKey];
    const wrap = document.getElementById(`qv-result-${sectionKey}`);
    if (!wrap) return;

    if (st.loading) {
        wrap.innerHTML = '<div class="qv-loading"><i class="fas fa-spinner fa-spin"></i> 데이터 로딩 중...</div>';
        return;
    }

    if (!st.activeChip || !st.data) {
        wrap.innerHTML = '<div class="qv-empty">위 항목 칩을 클릭하면 조회 결과가 여기에 표시됩니다.</div>';
        return;
    }

    const chip = config.chips.find(c => c.key === st.activeChip);
    if (!chip) return;

    // Filter by range
    let filtered = st.data;
    if (st.rangeMode === 'range') {
        filtered = st.data.filter(item => {
            const num = qvGetSetNum(sectionKey, item);
            return num >= st.rangeStart && num <= st.rangeEnd;
        });
    }

    if (filtered.length === 0) {
        wrap.innerHTML = '<div class="qv-empty">조회 결과가 없습니다.</div>';
        return;
    }

    let html = `<div class="qv-result-header">
        <span class="qv-result-title">"${qvEsc(chip.label)}" 조회 (${filtered.length}건)</span>
        <button class="qv-copy-btn" onclick="qvCopyAll('${sectionKey}')"><i class="fas fa-copy"></i> 전체 복사</button>
    </div>`;

    html += '<div class="qv-result-list" id="qv-result-list-' + sectionKey + '">';

    filtered.forEach(item => {
        const num = qvGetSetNum(sectionKey, item);
        const numStr = String(num).padStart(4, '0');
        let content;
        if (config.groupBy) {
            content = chip.extract(item, item._rows);
        } else {
            content = chip.extract(item);
        }
        const displayContent = qvFormatContent(content);
        html += `<div class="qv-result-item">
            <span class="qv-result-num">#${numStr}</span>
            <div class="qv-result-content">${displayContent}</div>
        </div>`;
    });

    html += '</div>';
    wrap.innerHTML = html;
}

// ===== Format content for display =====
function qvFormatContent(content) {
    if (!content) return '<span class="qv-na">-</span>';
    if (typeof content === 'number') return qvEsc(String(content));
    if (typeof content === 'string') {
        if (!content.trim()) return '<span class="qv-na">-</span>';
        return qvEsc(content).replace(/\n/g, '<br>');
    }
    // Array of lines (for bullets etc)
    if (Array.isArray(content)) {
        return content.map(line => {
            if (typeof line === 'object' && line.label) {
                return `<div class="qv-bullet-line"><span class="qv-bullet-label">${qvEsc(line.label)}</span> ${qvEsc(line.text)}</div>`;
            }
            return qvEsc(String(line)).replace(/\n/g, '<br>');
        }).join('');
    }
    return qvEsc(String(content));
}

// ===== Copy all results =====
function qvCopyAll(sectionKey) {
    const st = qvState[sectionKey];
    const config = QV_CONFIGS[sectionKey];
    if (!st.data || !st.activeChip) return;

    const chip = config.chips.find(c => c.key === st.activeChip);
    if (!chip) return;

    let filtered = st.data;
    if (st.rangeMode === 'range') {
        filtered = st.data.filter(item => {
            const num = qvGetSetNum(sectionKey, item);
            return num >= st.rangeStart && num <= st.rangeEnd;
        });
    }

    let text = '';
    filtered.forEach(item => {
        const num = qvGetSetNum(sectionKey, item);
        const numStr = String(num).padStart(4, '0');
        let content;
        if (config.groupBy) {
            content = chip.extract(item, item._rows);
        } else {
            content = chip.extract(item);
        }
        const plainText = qvContentToPlain(content);
        text += `#${numStr}\n${plainText}\n\n`;
    });

    navigator.clipboard.writeText(text.trim()).then(() => {
        const btn = document.querySelector(`#qv-result-${sectionKey} .qv-copy-btn`);
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> 복사됨!';
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
        }
    }).catch(() => alert('복사에 실패했습니다.'));
}

function qvContentToPlain(content) {
    if (!content) return '-';
    if (typeof content === 'number') return String(content);
    if (typeof content === 'string') return content || '-';
    if (Array.isArray(content)) {
        return content.map(line => {
            if (typeof line === 'object' && line.label) return `${line.label} ${line.text}`;
            return String(line);
        }).join('\n');
    }
    return String(content);
}

// ===== HTML escape =====
function qvEsc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ================================================================
// ===== Fill in the Blanks extractors =====
// ================================================================
function extractFbPassageText(markers) {
    if (!markers) return '';
    return markers.replace(/\{\{([^|]+)\|([^|}]+)(?:\|[^}]*)?\}\}/g, (m, prefix, answer) => {
        return prefix + '_'.repeat(answer.length);
    });
}

function extractFbAnswers(markers) {
    if (!markers) return '';
    const pattern = /\{\{([^|]+)\|([^|}]+)/g;
    const answers = [];
    let match;
    while ((match = pattern.exec(markers)) !== null) {
        answers.push(`${match[1]}${match[2]}`);
    }
    return answers.map((a, i) => `${i + 1}. ${a}`).join('\n');
}

function extractFbExplanations(markers) {
    if (!markers) return '';
    const pattern = /\{\{([^|]+)\|([^|}]+)(?:\|([^|}]*))?\}\}/g;
    const items = [];
    let match, idx = 0;
    while ((match = pattern.exec(markers)) !== null) {
        idx++;
        const exp = match[3] || '';
        items.push(`${idx}. ${exp || '-'}`);
    }
    return items.join('\n');
}

function extractFbMistakes(markers) {
    if (!markers) return '';
    const pattern = /\{\{[^|]+\|[^|}]+(?:\|[^|}]*)?(?:\|\(([^)]*)\))?(?:\|([^}]*))?\}\}/g;
    const items = [];
    let match, idx = 0;
    while ((match = pattern.exec(markers)) !== null) {
        idx++;
        const mistake = match[1] || '';
        const mistakeExp = match[2] || '';
        if (mistake) {
            items.push(`${idx}. ${mistake}${mistakeExp ? ' — ' + mistakeExp : ''}`);
        } else {
            items.push(`${idx}. -`);
        }
    }
    return items.join('\n');
}

// ================================================================
// ===== Daily1 / Daily2 / Academic format helpers =====
// ================================================================
function d1FormatPassage(content) {
    if (!content) return '';
    return content.replace(/##/g, '\n\n').replace(/#\|\|#/g, '\n').replace(/#\|#/g, ' ');
}

function d1FormatTranslations(trans) {
    if (!trans) return '';
    return trans.split('##').map((t, i) => t ? `[${i + 1}] ${t}` : '').filter(Boolean).join('\n');
}

function d1FormatWords(words) {
    if (!words) return '';
    return words.split('##').map(w => {
        const parts = w.split('::');
        return parts[0] ? `${parts[0]} — ${parts[1] || ''}${parts[2] ? ' (' + parts[2] + ')' : ''}` : '';
    }).filter(Boolean).join('\n');
}

function parseD1Question(qStr) {
    if (!qStr) return null;
    const parts = qStr.split('::');
    if (parts.length < 4) return null;
    return { num: parts[0], text: parts[1], trans: parts[2], answer: parts[3], optionsRaw: parts.slice(4).join('::') };
}

function d1FormatQuestions(s) {
    const lines = [];
    const q1 = parseD1Question(s.question1);
    if (q1) lines.push(`Q1: ${q1.text}\n    (${q1.trans})`);
    const q2 = parseD1Question(s.question2);
    if (q2) lines.push(`Q2: ${q2.text}\n    (${q2.trans})`);
    return lines.join('\n') || '-';
}

function d1FormatAnswers(s) {
    const lines = [];
    const q1 = parseD1Question(s.question1);
    if (q1) lines.push(`Q1: ${['A','B','C','D'][parseInt(q1.answer) - 1] || q1.answer}`);
    const q2 = parseD1Question(s.question2);
    if (q2) lines.push(`Q2: ${['A','B','C','D'][parseInt(q2.answer) - 1] || q2.answer}`);
    return lines.join('\n') || '-';
}

function d1FormatOptions(s) {
    const lines = [];
    [s.question1, s.question2].forEach((qStr, qi) => {
        const q = parseD1Question(qStr);
        if (!q) return;
        lines.push(`Q${qi + 1}:`);
        const opts = q.optionsRaw.split('##');
        opts.forEach(opt => {
            const p = opt.split('::');
            lines.push(`  ${p[0] || ''} (${p[1] || ''})`);
        });
    });
    return lines.join('\n') || '-';
}

function d2FormatQuestions(s) {
    const lines = [];
    [s.question1, s.question2, s.question3].forEach((qStr, i) => {
        const q = parseD1Question(qStr);
        if (q) lines.push(`Q${i + 1}: ${q.text}\n    (${q.trans})`);
    });
    return lines.join('\n') || '-';
}

function d2FormatAnswers(s) {
    const lines = [];
    [s.question1, s.question2, s.question3].forEach((qStr, i) => {
        const q = parseD1Question(qStr);
        if (q) lines.push(`Q${i + 1}: ${['A','B','C','D'][parseInt(q.answer) - 1] || q.answer}`);
    });
    return lines.join('\n') || '-';
}

function d2FormatOptions(s) {
    const lines = [];
    [s.question1, s.question2, s.question3].forEach((qStr, qi) => {
        const q = parseD1Question(qStr);
        if (!q) return;
        lines.push(`Q${qi + 1}:`);
        const opts = q.optionsRaw.split('##');
        opts.forEach(opt => {
            const p = opt.split('::');
            lines.push(`  ${p[0] || ''} (${p[1] || ''})`);
        });
    });
    return lines.join('\n') || '-';
}

function acFormatQuestions(s) {
    const lines = [];
    for (let i = 1; i <= 5; i++) {
        const q = parseD1Question(s[`question${i}`]);
        if (q) lines.push(`Q${i}: ${q.text}\n    (${q.trans})`);
    }
    return lines.join('\n') || '-';
}

function acFormatAnswers(s) {
    const lines = [];
    for (let i = 1; i <= 5; i++) {
        const q = parseD1Question(s[`question${i}`]);
        if (q) lines.push(`Q${i}: ${['A','B','C','D'][parseInt(q.answer) - 1] || q.answer}`);
    }
    return lines.join('\n') || '-';
}

function acFormatOptions(s) {
    const lines = [];
    for (let qi = 1; qi <= 5; qi++) {
        const q = parseD1Question(s[`question${qi}`]);
        if (!q) continue;
        lines.push(`Q${qi}:`);
        const opts = q.optionsRaw.split('##');
        opts.forEach(opt => {
            const p = opt.split('::');
            lines.push(`  ${p[0] || ''} (${p[1] || ''})`);
        });
    }
    return lines.join('\n') || '-';
}

// ================================================================
// ===== Listening Response (row-per-question, grouped by set_id) =====
// ================================================================
function lrFormatGrouped(rows, field) {
    if (!rows || rows.length === 0) return '-';
    const sorted = [...rows].sort((a, b) => (a.question_num || 0) - (b.question_num || 0));
    return sorted.map(r => `Q${r.question_num}: ${r[field] || '-'}`).join('\n');
}

function lrFormatOptions(rows) {
    if (!rows || rows.length === 0) return '-';
    const sorted = [...rows].sort((a, b) => (a.question_num || 0) - (b.question_num || 0));
    return sorted.map(r => {
        const opts = [r.option1, r.option2, r.option3, r.option4].map((o, i) => `${i + 1}) ${o || '-'}`).join('  ');
        return `Q${r.question_num}: ${opts}`;
    }).join('\n');
}

function lrFormatOptionsTrans(rows) {
    if (!rows || rows.length === 0) return '-';
    const sorted = [...rows].sort((a, b) => (a.question_num || 0) - (b.question_num || 0));
    return sorted.map(r => {
        const opts = [r.option_trans1, r.option_trans2, r.option_trans3, r.option_trans4].map((o, i) => `${i + 1}) ${o || '-'}`).join('  ');
        return `Q${r.question_num}: ${opts}`;
    }).join('\n');
}

function lrFormatExplanations(rows) {
    if (!rows || rows.length === 0) return '-';
    const sorted = [...rows].sort((a, b) => (a.question_num || 0) - (b.question_num || 0));
    return sorted.map(r => {
        const exps = [r.option_exp1, r.option_exp2, r.option_exp3, r.option_exp4]
            .map((e, i) => e ? `${i + 1}) ${e}` : '').filter(Boolean).join('  ');
        return `Q${r.question_num}: ${exps || '-'}`;
    }).join('\n');
}

// ================================================================
// ===== Listening Conversation (2 Q per set) =====
// ================================================================
function lcFormatQuestions(s) {
    const lines = [];
    for (let q = 1; q <= 2; q++) {
        const text = s[`q${q}_question`] || '';
        const trans = s[`q${q}_question_trans`] || '';
        if (text) lines.push(`Q${q}: ${text}${trans ? '\n    (' + trans + ')' : ''}`);
    }
    return lines.join('\n') || '-';
}

function lcFormatAnswers(s) {
    const lines = [];
    for (let q = 1; q <= 2; q++) {
        const a = s[`q${q}_answer`];
        if (a) lines.push(`Q${q}: ${a}`);
    }
    return lines.join('\n') || '-';
}

function lcFormatOptions(s) {
    const lines = [];
    for (let q = 1; q <= 2; q++) {
        lines.push(`Q${q}:`);
        for (let j = 1; j <= 4; j++) {
            const opt = s[`q${q}_opt${j}`] || '';
            const trans = s[`q${q}_opt_trans${j}`] || '';
            lines.push(`  ${j}) ${opt}${trans ? ' (' + trans + ')' : ''}`);
        }
    }
    return lines.join('\n') || '-';
}

// ================================================================
// ===== Listening Announcement (2 Q per set) =====
// ================================================================
function laFormatQuestions(s) {
    const lines = [];
    for (let q = 1; q <= 2; q++) {
        const text = s[`q${q}_question_text`] || '';
        const trans = s[`q${q}_question_text_trans`] || '';
        if (text) lines.push(`Q${q}: ${text}${trans ? '\n    (' + trans + ')' : ''}`);
    }
    return lines.join('\n') || '-';
}

function laFormatAnswers(s) {
    const lines = [];
    for (let q = 1; q <= 2; q++) {
        const a = s[`q${q}_correct_answer`];
        if (a) lines.push(`Q${q}: ${a}`);
    }
    return lines.join('\n') || '-';
}

function laFormatOptions(s) {
    const lines = [];
    for (let q = 1; q <= 2; q++) {
        lines.push(`Q${q}:`);
        for (let j = 1; j <= 4; j++) {
            const opt = s[`q${q}_opt${j}`] || '';
            const trans = s[`q${q}_trans${j}`] || '';
            lines.push(`  ${j}) ${opt}${trans ? ' (' + trans + ')' : ''}`);
        }
    }
    return lines.join('\n') || '-';
}

// ================================================================
// ===== Listening Lecture (4 Q per set) =====
// ================================================================
function llFormatQuestions(s) {
    const lines = [];
    for (let q = 1; q <= 4; q++) {
        const text = s[`q${q}_question_text`] || '';
        const trans = s[`q${q}_question_trans`] || '';
        if (text) lines.push(`Q${q}: ${text}${trans ? '\n    (' + trans + ')' : ''}`);
    }
    return lines.join('\n') || '-';
}

function llFormatAnswers(s) {
    const lines = [];
    for (let q = 1; q <= 4; q++) {
        const a = s[`q${q}_correct_answer`];
        if (a) lines.push(`Q${q}: ${a}`);
    }
    return lines.join('\n') || '-';
}

function llFormatOptions(s) {
    const lines = [];
    for (let q = 1; q <= 4; q++) {
        lines.push(`Q${q}:`);
        for (let j = 1; j <= 4; j++) {
            const opt = s[`q${q}_opt${j}`] || '';
            const trans = s[`q${q}_trans${j}`] || '';
            lines.push(`  ${j}) ${opt}${trans ? ' (' + trans + ')' : ''}`);
        }
    }
    return lines.join('\n') || '-';
}

// ================================================================
// ===== Highlights (JSON string) =====
// ================================================================
function formatHighlights(hlStr) {
    if (!hlStr) return '-';
    try {
        const arr = JSON.parse(hlStr);
        if (!Array.isArray(arr) || arr.length === 0) return '-';
        return arr.map((h, i) => `${i + 1}. ${h.word || h.key || ''} — ${h.translation || h.title || ''}`).join('\n');
    } catch {
        return hlStr;
    }
}

// ================================================================
// ===== Writing Arrange (row-per-question, grouped by set_id) =====
// ================================================================
function waFormatGrouped(rows, field) {
    if (!rows || rows.length === 0) return '-';
    const sorted = [...rows].sort((a, b) => (a.question_num || 0) - (b.question_num || 0));
    return sorted.map(r => `Q${r.question_num}: ${r[field] || '-'}`).join('\n');
}

// ================================================================
// ===== Writing Email =====
// ================================================================
function weFormatInstructions(s) {
    const lines = [];
    const bullets = ['\u2776', '\u2777', '\u2778'];
    for (let i = 1; i <= 3; i++) {
        const inst = s[`instruction${i}`];
        if (inst) lines.push({ label: bullets[i - 1], text: inst });
    }
    return lines.length > 0 ? lines : '-';
}

function weFormatBulletField(s, fieldSuffix) {
    const lines = [];
    for (let b = 1; b <= 3; b++) {
        const val = s[`bullet${b}_${fieldSuffix}`];
        if (val) lines.push({ label: ['\u2776', '\u2777', '\u2778'][b - 1], text: val });
    }
    return lines.length > 0 ? lines : '-';
}

// ================================================================
// ===== Writing Discussion =====
// ================================================================
function wdFormatBulletField(s, fieldSuffix) {
    const lines = [];
    for (let b = 1; b <= 5; b++) {
        const val = s[`bullet${b}_${fieldSuffix}`];
        if (val) lines.push({ label: ['\u2776', '\u2777', '\u2778', '\u2779', '\u277A'][b - 1], text: val });
    }
    return lines.length > 0 ? lines : '-';
}

// ================================================================
// ===== Speaking Repeat =====
// ================================================================
function srFormatScripts(s) {
    const lines = [];
    for (let i = 1; i <= 7; i++) {
        const v = s[`audio${i}_script`];
        if (v) lines.push(`Q${i}: ${v}`);
    }
    return lines.join('\n') || '-';
}

function srFormatTranslations(s) {
    const lines = [];
    for (let i = 1; i <= 7; i++) {
        const v = s[`audio${i}_translation`];
        if (v) lines.push(`Q${i}: ${v}`);
    }
    return lines.join('\n') || '-';
}

// ================================================================
// ===== Speaking Interview =====
// ================================================================
function siFormatScripts(s) {
    const lines = [];
    for (let i = 1; i <= 4; i++) {
        const v = s[`v${i}_script`];
        if (v) lines.push(`V${i}: ${v}`);
    }
    return lines.join('\n') || '-';
}

function siFormatTranslations(s) {
    const lines = [];
    for (let i = 1; i <= 4; i++) {
        const v = s[`v${i}_translation`];
        if (v) lines.push(`V${i}: ${v}`);
    }
    return lines.join('\n') || '-';
}

function siFormatModelAnswers(s) {
    const lines = [];
    for (let i = 1; i <= 4; i++) {
        const v = s[`v${i}_model_answer`];
        if (v) lines.push(`V${i}: ${v}`);
    }
    return lines.join('\n') || '-';
}

function siFormatModelAnswersTrans(s) {
    const lines = [];
    for (let i = 1; i <= 4; i++) {
        const v = s[`v${i}_model_answer_trans`];
        if (v) lines.push(`V${i}: ${v}`);
    }
    return lines.join('\n') || '-';
}

// ================================================================
// ===== Build viewer HTML for a section =====
// ================================================================
function qvBuildHTML(sectionKey) {
    const config = QV_CONFIGS[sectionKey];
    if (!config) return '';

    let chipsHtml = config.chips.map(c =>
        `<button class="qv-chip" data-chip-key="${c.key}" onclick="qvSelectChip('${sectionKey}','${c.key}')">${qvEsc(c.label)}</button>`
    ).join('');

    return `
    <div class="qv-panel" id="qv-panel-${sectionKey}">
        <div class="qv-panel-header" onclick="qvToggleCollapse('${sectionKey}')">
            <span class="qv-panel-title"><i class="fas fa-search" style="color:#6366f1;"></i> 데이터 조회</span>
            <span class="qv-panel-arrow" id="qv-arrow-${sectionKey}"><i class="fas fa-chevron-up"></i></span>
        </div>
        <div class="qv-panel-body" id="qv-body-${sectionKey}">
            <div class="qv-chips-wrap" id="qv-chips-${sectionKey}">
                ${chipsHtml}
            </div>
            <div class="qv-range-wrap">
                <label class="qv-range-label">
                    <input type="radio" name="qv-range-${sectionKey}" value="all" checked onchange="qvSetRange('${sectionKey}','all')"> 전체
                </label>
                <label class="qv-range-label">
                    <input type="radio" name="qv-range-${sectionKey}" value="range" onchange="qvSetRange('${sectionKey}','range')"> 범위
                </label>
                <span class="qv-range-inputs" id="qv-range-inputs-${sectionKey}" style="display:none;">
                    <input type="number" id="qv-range-start-${sectionKey}" class="qv-range-input" value="1" min="1" onchange="qvUpdateRange('${sectionKey}')">
                    <span class="qv-range-tilde">~</span>
                    <input type="number" id="qv-range-end-${sectionKey}" class="qv-range-input" value="9999" min="1" onchange="qvUpdateRange('${sectionKey}')">
                </span>
            </div>
            <div class="qv-result-wrap" id="qv-result-${sectionKey}">
                <div class="qv-empty">위 항목 칩을 클릭하면 조회 결과가 여기에 표시됩니다.</div>
            </div>
        </div>
    </div>`;
}

// ================================================================
// ===== Auto-inject viewer panels into sections =====
// ================================================================
function qvInjectPanel(sectionKey) {
    const sectionEl = document.getElementById('section-' + sectionKey);
    if (!sectionEl) return;
    // Already injected?
    if (document.getElementById('qv-panel-' + sectionKey)) return;

    const html = qvBuildHTML(sectionKey);
    if (!html) return;

    // Insert as first child of the section
    sectionEl.insertAdjacentHTML('afterbegin', html);
}

// Inject into all sections on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    Object.keys(QV_CONFIGS).forEach(key => {
        qvInjectPanel(key);
    });
});
