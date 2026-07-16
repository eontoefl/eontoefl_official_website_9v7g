/**
 * 실전 리포트 관리 (관리자)
 *
 * - 질문 생성: 질문 + 응답 방식(객관식/서술형) + 객관식 보기(+ 추가) + 목표 인원(기본 5, 계속 수집 가능)
 * - 진행 중 질문: 응답 현황(n/목표, 날짜 분포), 응답 보기, 마감·판정(사실/거짓)
 * - 응답자 명단: 기프티콘 수동 발송용 (학생·시험날짜별 묶음)
 * - 아카이브: 판정 완료된 질문 + 결론
 */

let asvQuestions = [];
let asvResponses = [];
let asvQType = 'choice';

document.addEventListener('DOMContentLoaded', function() {
    checkAsvAdminAuth();
    addOption();
    addOption();
    loadAll();
});

function checkAsvAdminAuth() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!userData || userData.role !== 'admin') {
        alert('관리자 권한이 필요합니다.');
        window.location.href = 'login.html';
        return;
    }
    const adminName = document.getElementById('adminName');
    if (adminName) adminName.textContent = userData.name || '관리자';
}

async function loadAll() {
    try {
        const [questions, responses] = await Promise.all([
            supabaseAPI.query('toefl_survey_questions', { 'order': 'created_at.desc' }),
            supabaseAPI.query('toefl_survey_responses', { 'order': 'created_at.desc' })
        ]);
        asvQuestions = questions || [];
        asvResponses = responses || [];
    } catch (err) {
        console.warn('실전 리포트 로드 실패 (테이블 미생성?):', err);
        document.getElementById('activeList').innerHTML =
            '<div class="asv-empty">데이터를 불러올 수 없습니다. 마이그레이션(toefl_survey.sql)이 실행됐는지 확인하세요.</div>';
        document.getElementById('respondersList').innerHTML = '<div class="asv-empty">-</div>';
        document.getElementById('archiveList').innerHTML = '<div class="asv-empty">-</div>';
        return;
    }
    renderActive();
    renderResponders();
    renderArchive();
}

// ================================================
// 질문 생성 폼
// ================================================
function setQType(type) {
    asvQType = type;
    document.getElementById('typeChoice').classList.toggle('on', type === 'choice');
    document.getElementById('typeText').classList.toggle('on', type === 'text');
    document.getElementById('optionsField').style.display = (type === 'choice') ? '' : 'none';
}

function addOption(value) {
    const list = document.getElementById('optionsList');
    const row = document.createElement('div');
    row.className = 'asv-opt-row';
    row.innerHTML =
        '<input type="text" placeholder="보기 (예: 4문단)" value="' + (value ? escapeHtml(value) : '') + '">' +
        '<button type="button" class="asv-opt-del" onclick="this.parentNode.remove()"><i class="fas fa-times"></i></button>';
    list.appendChild(row);
}

async function createQuestion() {
    const text = document.getElementById('newQText').value.trim();
    if (!text) { alert('질문을 입력해주세요.'); return; }

    let options = null;
    if (asvQType === 'choice') {
        options = Array.from(document.querySelectorAll('#optionsList input'))
            .map(function(i) { return i.value.trim(); })
            .filter(Boolean);
        if (options.length < 2) { alert('객관식은 보기를 2개 이상 입력해주세요.'); return; }
    }

    const infinite = document.getElementById('newQInfinite').checked;
    let target = null;
    if (!infinite) {
        target = parseInt(document.getElementById('newQTarget').value, 10);
        if (!target || target < 1) { alert('목표 응답 수를 확인해주세요.'); return; }
    }

    try {
        await supabaseAPI.post('toefl_survey_questions', {
            question_text: text,
            question_type: asvQType,
            options: options,
            target_count: target,
            hypothesis: document.getElementById('newQHypothesis').value.trim() || null,
            status: 'active'
        });
        // 폼 초기화
        document.getElementById('newQText').value = '';
        document.getElementById('newQHypothesis').value = '';
        document.getElementById('optionsList').innerHTML = '';
        addOption(); addOption();
        document.getElementById('newQInfinite').checked = false;
        document.getElementById('newQTarget').disabled = false;
        document.getElementById('newQTarget').value = '5';
        await loadAll();
        alert('질문이 등록됐습니다. 학생 설문에 바로 노출됩니다.');
    } catch (err) {
        alert('등록 실패: ' + err.message);
    }
}

// ================================================
// 진행 중 질문
// ================================================
function respsOf(qid) {
    return asvResponses.filter(function(r) { return r.question_id === qid; });
}

function distinctDates(resps) {
    const set = {};
    resps.forEach(function(r) { set[r.exam_date] = true; });
    return Object.keys(set).length;
}

/** 노출 순서: sort_order 오름차순, 없으면 등록순으로 뒤에 (학생 설문과 동일 규칙) */
function byDisplayOrder(a, b) {
    const ao = (a.sort_order == null) ? Infinity : a.sort_order;
    const bo = (b.sort_order == null) ? Infinity : b.sort_order;
    if (ao !== bo) return ao - bo;
    return a.created_at < b.created_at ? -1 : 1;
}

function renderActive() {
    const active = asvQuestions.filter(function(q) { return q.status === 'active'; }).sort(byDisplayOrder);
    const el = document.getElementById('activeList');
    if (!active.length) {
        el.innerHTML = '<div class="asv-empty">진행 중인 질문이 없습니다. 위에서 새 질문을 만들어보세요.</div>';
        return;
    }
    el.innerHTML = active.map(function(q) {
        const resps = respsOf(q.id);
        const full = q.target_count != null && resps.length >= q.target_count;
        const targetStr = q.target_count == null
            ? '<span class="asv-badge asv-badge-infinite">계속 수집</span>'
            : '<span class="asv-badge ' + (full ? 'asv-badge-full' : 'asv-badge-collect') + '">' +
                  resps.length + ' / ' + q.target_count + (full ? ' · 판정 대기' : '') +
              '</span>';
        // 액션은 ⋯ 메뉴 하나로 모은다 (응답 보기 / 숨기기·보이기 / 마감·판정 / 삭제)
        var menu =
            '<div class="asv-menu-wrap">' +
                '<button class="asv-kebab" onclick="toggleQMenu(event, \'' + q.id + '\')">' +
                    '<i class="fas fa-ellipsis-vertical"></i></button>' +
                '<div class="asv-menu" id="menu_' + q.id + '">' +
                    '<button class="asv-menu-item" onclick="toggleAnswers(\'' + q.id + '\'); closeQMenus();">' +
                        '<i class="fas fa-list"></i> 응답 보기</button>' +
                    '<button class="asv-menu-item" onclick="setQuestionHidden(\'' + q.id + '\', ' + (q.hidden ? 'false' : 'true') + ')">' +
                        (q.hidden
                            ? '<i class="fas fa-eye"></i> 다시 보이기'
                            : '<i class="fas fa-eye-slash"></i> 숨기기') + '</button>' +
                    '<button class="asv-menu-item" onclick="toggleEdit(\'' + q.id + '\'); closeQMenus();">' +
                        '<i class="fas fa-pen"></i> 수정</button>' +
                    '<button class="asv-menu-item" onclick="toggleVerdict(\'' + q.id + '\'); closeQMenus();">' +
                        '<i class="fas fa-gavel"></i> 마감·판정</button>' +
                    '<button class="asv-menu-item asv-menu-danger" onclick="deleteQuestion(\'' + q.id + '\')">' +
                        '<i class="fas fa-trash"></i> 삭제</button>' +
                '</div>' +
            '</div>';
        return '<div class="asv-q' + (q.hidden ? ' asv-q-hidden' : '') + '" data-qid="' + q.id + '">' +
            '<div class="asv-q-head">' +
                '<span class="asv-drag" title="드래그로 순서 이동"><i class="fas fa-grip-vertical"></i></span>' +
                '<div class="asv-q-body">' +
                    '<div class="asv-q-text">' + escapeHtml(q.question_text) + '</div>' +
                    '<div class="asv-q-meta">' +
                        '<span>' + (q.question_type === 'choice' ? '객관식' : '서술형') + '</span>' +
                        (q.hypothesis ? '<span>가설: ' + escapeHtml(q.hypothesis) + '</span>' : '') +
                        '<span>서로 다른 시험 날짜 ' + distinctDates(resps) + '개</span>' +
                    '</div>' +
                '</div>' +
                '<div class="asv-q-actions">' + targetStr +
                    (q.hidden ? '<span class="asv-badge asv-badge-hidden">숨김</span>' : '') +
                    menu +
                '</div>' +
            '</div>' +
            buildAnswersHtml(q, resps) +
            buildVerdictHtml(q) +
            buildEditHtml(q) +
        '</div>';
    }).join('');
    initDragHandles();
}

// ── 드래그 정렬: 핸들바를 잡고 끌어서 순서 이동, 놓으면 sort_order 저장 ──
let asvDragEl = null;

function initDragHandles() {
    const list = document.getElementById('activeList');
    list.querySelectorAll('.asv-drag').forEach(function(h) {
        h.addEventListener('mousedown', function() { h.closest('.asv-q').draggable = true; });
        h.addEventListener('mouseup', function() { h.closest('.asv-q').draggable = false; });
    });
    list.querySelectorAll('.asv-q').forEach(function(el) {
        el.addEventListener('dragstart', function(e) {
            asvDragEl = el;
            el.classList.add('asv-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dragend', async function() {
            el.classList.remove('asv-dragging');
            el.draggable = false;
            asvDragEl = null;
            await persistOrder();
        });
    });
    // 컨테이너 리스너는 한 번만
    if (!list.dataset.dragBound) {
        list.dataset.dragBound = '1';
        list.addEventListener('dragover', function(e) {
            e.preventDefault();
            if (!asvDragEl) return;
            const after = getDragAfterElement(list, e.clientY);
            if (after == null) list.appendChild(asvDragEl);
            else if (after !== asvDragEl) list.insertBefore(asvDragEl, after);
        });
    }
}

function getDragAfterElement(container, y) {
    const els = Array.from(container.querySelectorAll('.asv-q:not(.asv-dragging)'));
    let closest = { offset: -Infinity, element: null };
    els.forEach(function(child) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset: offset, element: child };
    });
    return closest.element;
}

/** 현재 DOM 순서를 sort_order로 저장 (학생 설문도 이 순서로 노출) */
async function persistOrder() {
    const ids = Array.from(document.querySelectorAll('#activeList .asv-q'))
        .map(function(el) { return el.dataset.qid; });
    try {
        for (let i = 0; i < ids.length; i++) {
            await supabaseAPI.patch('toefl_survey_questions', ids[i], { sort_order: i + 1 });
        }
        ids.forEach(function(id, i) {
            const q = asvQuestions.find(function(x) { return x.id === id; });
            if (q) q.sort_order = i + 1;
        });
    } catch (err) {
        alert('순서 저장 실패: ' + err.message + '\n(sort_order 마이그레이션이 실행됐는지 확인하세요)');
        await loadAll();
    }
}

// ── 수정 패널 ──
// 수정은 "의미가 유지되는 손질"만을 위한 것. 의미가 바뀌면 기존 응답과 어긋나므로
// 패널 상단에 경고를 상시 표시하고, 응답이 있으면 저장 전에 한 번 더 확인받는다.
function editOptRow(value) {
    return '<div class="asv-opt-row">' +
        '<input type="text" placeholder="보기" value="' + escapeHtml(value || '') + '">' +
        '<button type="button" class="asv-opt-del" onclick="this.parentNode.remove()"><i class="fas fa-times"></i></button>' +
    '</div>';
}

function buildEditHtml(q) {
    var optsHtml = '';
    if (q.question_type === 'choice') {
        var rows = (Array.isArray(q.options) ? q.options : []).map(function(opt) {
            return editOptRow(opt);
        }).join('');
        optsHtml =
            '<div class="asv-field"><label>보기</label>' +
                '<div id="editOpts_' + q.id + '">' + rows + '</div>' +
                '<button type="button" class="asv-add-opt" onclick="addEditOption(\'' + q.id + '\')">' +
                    '<i class="fas fa-plus"></i> 보기 추가</button>' +
            '</div>';
    }
    var inf = (q.target_count == null);
    return '<div class="asv-edit" id="edit_' + q.id + '">' +
        '<div class="asv-edit-warn"><i class="fas fa-triangle-exclamation"></i> ' +
            '<strong>내용(의미)은 바꾸면 안 돼요!</strong> 이미 모인 응답과 어긋납니다. ' +
            '오타 교정처럼 의미가 그대로인 수정만 하세요. 내용을 바꾸려면 삭제 후 새로 등록.</div>' +
        '<div class="asv-field"><label>질문</label>' +
            '<input type="text" id="editQText_' + q.id + '" value="' + escapeHtml(q.question_text) + '"></div>' +
        '<div class="asv-field"><label>가설 메모</label>' +
            '<input type="text" id="editQHyp_' + q.id + '" value="' + escapeHtml(q.hypothesis || '') + '"></div>' +
        optsHtml +
        '<div class="asv-field"><label>목표 응답 수</label><div class="asv-target-row">' +
            '<input type="number" id="editQTarget_' + q.id + '" value="' + (inf ? 5 : q.target_count) + '" min="1" max="100"' + (inf ? ' disabled' : '') + '>' +
            '<label class="asv-inline"><input type="checkbox" id="editQInf_' + q.id + '"' + (inf ? ' checked' : '') +
                ' onchange="document.getElementById(\'editQTarget_' + q.id + '\').disabled = this.checked;"> 계속 수집</label>' +
        '</div></div>' +
        '<div class="asv-edit-actions">' +
            '<button class="asv-btn-verdict" onclick="saveQuestionEdit(\'' + q.id + '\')"><i class="fas fa-check"></i> 저장</button>' +
            '<button class="asv-btn-ghost" onclick="toggleEdit(\'' + q.id + '\')">취소</button>' +
        '</div>' +
    '</div>';
}

function addEditOption(qid) {
    var list = document.getElementById('editOpts_' + qid);
    var tmp = document.createElement('div');
    tmp.innerHTML = editOptRow('');
    list.appendChild(tmp.firstChild);
}

function toggleEdit(qid) {
    var el = document.getElementById('edit_' + qid);
    if (el) el.style.display = (el.style.display === 'block') ? 'none' : 'block';
}

async function saveQuestionEdit(qid) {
    var q = asvQuestions.find(function(x) { return x.id === qid; });
    if (!q) return;

    var text = document.getElementById('editQText_' + qid).value.trim();
    if (!text) { alert('질문을 입력해주세요.'); return; }

    var patch = {
        question_text: text,
        hypothesis: document.getElementById('editQHyp_' + qid).value.trim() || null
    };
    if (q.question_type === 'choice') {
        var options = Array.from(document.querySelectorAll('#editOpts_' + qid + ' input'))
            .map(function(i) { return i.value.trim(); })
            .filter(Boolean);
        if (options.length < 2) { alert('객관식은 보기를 2개 이상 입력해주세요.'); return; }
        patch.options = options;
    }
    if (document.getElementById('editQInf_' + qid).checked) {
        patch.target_count = null;
    } else {
        var target = parseInt(document.getElementById('editQTarget_' + qid).value, 10);
        if (!target || target < 1) { alert('목표 응답 수를 확인해주세요.'); return; }
        patch.target_count = target;
    }

    var respCount = respsOf(qid).length;
    if (respCount > 0 &&
        !confirm('이미 응답이 ' + respCount + '건 모인 질문입니다.\n질문의 의미가 바뀌지 않는 수정이 맞나요?\n(의미가 바뀌면 기존 응답과 어긋납니다)')) return;

    try {
        await supabaseAPI.patch('toefl_survey_questions', qid, patch);
        await loadAll();
    } catch (err) {
        alert('저장 실패: ' + err.message);
    }
}

// ── ⋯ 메뉴 열고 닫기 ──
function toggleQMenu(event, qid) {
    event.stopPropagation();
    var menu = document.getElementById('menu_' + qid);
    var wasOpen = menu.classList.contains('open');
    closeQMenus();
    if (!wasOpen) menu.classList.add('open');
}
function closeQMenus() {
    document.querySelectorAll('.asv-menu.open').forEach(function(m) { m.classList.remove('open'); });
}
document.addEventListener('click', closeQMenus);

/** 숨기기/보이기: 마감하지 않고 학생에게만 잠시 안 보이게 */
async function setQuestionHidden(qid, hide) {
    try {
        await supabaseAPI.patch('toefl_survey_questions', qid, { hidden: hide });
        await loadAll();
    } catch (err) {
        alert('변경 실패: ' + err.message + '\n(hidden 컬럼 마이그레이션이 실행됐는지 확인하세요)');
    }
}

/** 삭제: 질문과 그 응답을 완전히 삭제 (수정 대신 삭제 후 재등록하는 운영 방식) */
async function deleteQuestion(qid) {
    var resps = respsOf(qid);
    var msg = '이 질문을 완전히 삭제할까요?';
    if (resps.length > 0) msg += '\n지금까지 모인 응답 ' + resps.length + '건도 함께 삭제됩니다.';
    msg += '\n(내용을 바꾸려면 삭제 후 새로 등록하세요)';
    if (!confirm(msg)) return;
    try {
        await supabaseAPI.hardDelete('toefl_survey_questions', qid);
        await loadAll();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
}

function buildAnswersHtml(q, resps) {
    let inner;
    if (!resps.length) {
        inner = '<div class="asv-empty">아직 응답이 없습니다.</div>';
    } else {
        inner = resps.map(function(r) {
            return '<div class="asv-answer-row">' +
                '<span class="asv-answer-who">' + escapeHtml(r.user_name || '-') + ' · ' + escapeHtml(r.exam_date || '') + '</span>' +
                '<span class="asv-answer-val">' + escapeHtml(r.answer) + '</span>' +
            '</div>';
        }).join('');
        // 객관식이면 보기별 집계도
        if (q.question_type === 'choice') {
            const tally = {};
            resps.forEach(function(r) { tally[r.answer] = (tally[r.answer] || 0) + 1; });
            inner += '<div class="asv-dist">집계: ' +
                Object.keys(tally).map(function(k) { return escapeHtml(k) + ' ' + tally[k] + '명'; }).join(' · ') +
            '</div>';
        }
    }
    return '<div class="asv-answers" id="ans_' + q.id + '">' + inner + '</div>';
}

function buildVerdictHtml(q) {
    return '<div class="asv-verdict" id="vd_' + q.id + '">' +
        '<div class="asv-verdict-row">' +
            '<select id="vdSel_' + q.id + '">' +
                '<option value="사실">✅ 사실 (자료 반영 필요)</option>' +
                '<option value="거짓">❌ 거짓 (기각)</option>' +
            '</select>' +
            '<input type="text" id="vdNote_' + q.id + '" placeholder="판정 메모 (예: 4문단 4명/5명 → 자료에 4문단 지문 추가)">' +
            '<button class="asv-btn-verdict" onclick="closeQuestion(\'' + q.id + '\')">판정하고 마감</button>' +
        '</div>' +
    '</div>';
}

function toggleAnswers(qid) {
    const el = document.getElementById('ans_' + qid);
    if (el) el.style.display = (el.style.display === 'block') ? 'none' : 'block';
}

function toggleVerdict(qid) {
    const el = document.getElementById('vd_' + qid);
    if (el) el.style.display = (el.style.display === 'block') ? 'none' : 'block';
}

async function closeQuestion(qid) {
    const verdict = document.getElementById('vdSel_' + qid).value;
    const note = document.getElementById('vdNote_' + qid).value.trim();
    if (!confirm('"' + verdict + '"(으)로 판정하고 마감할까요? 마감하면 학생에게 더 이상 보이지 않습니다.')) return;
    try {
        await supabaseAPI.patch('toefl_survey_questions', qid, {
            status: 'closed',
            verdict: verdict,
            verdict_note: note || null,
            closed_at: new Date().toISOString()
        });
        await loadAll();
    } catch (err) {
        alert('마감 실패: ' + err.message);
    }
}

// ================================================
// 응답자 명단 (기프티콘 발송용)
// ================================================
function renderResponders() {
    const el = document.getElementById('respondersList');
    if (!asvResponses.length) {
        el.innerHTML = '<div class="asv-empty">아직 응답자가 없습니다.</div>';
        return;
    }
    // 학생 + 시험날짜로 묶기 (한 제출 = 한 줄)
    const groups = {};
    asvResponses.forEach(function(r) {
        const key = r.user_id + '|' + r.exam_date;
        if (!groups[key]) {
            groups[key] = { name: r.user_name, email: r.user_email, exam_date: r.exam_date, count: 0, at: r.created_at };
        }
        groups[key].count++;
        if (r.created_at > groups[key].at) groups[key].at = r.created_at;
    });
    const rows = Object.values(groups).sort(function(a, b) { return a.at < b.at ? 1 : -1; });
    el.innerHTML = '<table class="asv-table">' +
        '<tr><th>이름</th><th>이메일</th><th>시험 날짜</th><th>답변 수</th><th>제출 시각</th></tr>' +
        rows.map(function(g) {
            return '<tr>' +
                '<td><strong>' + escapeHtml(g.name || '-') + '</strong></td>' +
                '<td>' + escapeHtml(g.email || '-') + '</td>' +
                '<td>' + escapeHtml(g.exam_date || '-') + '</td>' +
                '<td>' + g.count + '</td>' +
                '<td>' + formatDate(g.at) + '</td>' +
            '</tr>';
        }).join('') +
    '</table>';
}

// ================================================
// 아카이브
// ================================================
function renderArchive() {
    const closed = asvQuestions.filter(function(q) { return q.status === 'closed'; });
    const el = document.getElementById('archiveList');
    if (!closed.length) {
        el.innerHTML = '<div class="asv-empty">판정 완료된 질문이 아직 없습니다.</div>';
        return;
    }
    el.innerHTML = closed.map(function(q) {
        const resps = respsOf(q.id);
        const badge = q.verdict === '사실'
            ? '<span class="asv-badge asv-badge-true">✅ 사실</span>'
            : '<span class="asv-badge asv-badge-false">❌ 거짓</span>';
        return '<div class="asv-q">' +
            '<div class="asv-q-head">' +
                '<div>' +
                    '<div class="asv-q-text">' + escapeHtml(q.question_text) + '</div>' +
                    '<div class="asv-q-meta">' +
                        (q.hypothesis ? '<span>가설: ' + escapeHtml(q.hypothesis) + '</span>' : '') +
                        '<span>응답 ' + resps.length + '명</span>' +
                        (q.verdict_note ? '<span>메모: ' + escapeHtml(q.verdict_note) + '</span>' : '') +
                        '<span>' + (q.closed_at ? formatDateOnly(q.closed_at) + ' 마감' : '') + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="asv-q-actions">' + badge +
                    '<button class="asv-btn-sm" onclick="toggleAnswers(\'' + q.id + '\')">응답 보기</button>' +
                '</div>' +
            '</div>' +
            buildAnswersHtml(q, resps) +
        '</div>';
    }).join('');
}
