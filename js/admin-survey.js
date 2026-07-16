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
    initGiftyDrop();
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
/** 응답자 그룹: 학생+시험날짜 = 한 줄 (응답 행 id들과 발송 상태 포함) */
function buildResponderGroups() {
    const groups = {};
    asvResponses.forEach(function(r) {
        const key = (r.user_id || r.user_name || '?') + '|' + r.exam_date;
        if (!groups[key]) {
            groups[key] = {
                user_id: r.user_id, name: r.user_name || '', email: r.user_email || '',
                exam_date: r.exam_date, count: 0, at: r.created_at, ids: [], sent_at: null
            };
        }
        const g = groups[key];
        g.count++;
        g.ids.push(r.id);
        if (r.created_at > g.at) g.at = r.created_at;
        if (r.gifty_sent_at && (!g.sent_at || r.gifty_sent_at > g.sent_at)) g.sent_at = r.gifty_sent_at;
        if (r.user_phone && !g.resp_phone) g.resp_phone = r.user_phone;   // 학생이 직접 적은 번호
    });
    return Object.values(groups).sort(function(a, b) { return a.at < b.at ? 1 : -1; });
}

function normPhone(p) {
    p = String(p || '').replace(/[^0-9]/g, '');
    if (p.length === 10 && p.charAt(0) === '1') p = '0' + p;   // 업체는 첫 0 생략 허용
    return p;
}

/** 전화번호 결정: ① 학생이 설문에 직접 적은 번호(최우선) ② 없으면 회원 DB 매칭(옛 응답 fallback).
 *  DB 매칭은 user_id 우선이되, 그 계정의 이름이 입력된 이름과 다르면(묵은 테스트 세션 등)
 *  계정 번호를 버리고 입력한 이름으로 다시 찾는다 — 엉뚱한 번호 발송 방지. */
async function attachPhones(allGroups) {
    // 직접 적은 번호가 있으면 그걸로 확정
    allGroups.forEach(function(g) {
        if (g.resp_phone) g.phone = normPhone(g.resp_phone);
    });
    const groups = allGroups.filter(function(g) { return !g.phone; });
    if (!groups.length) return;

    const userById = {}, phoneByName = {};
    const ids = Array.from(new Set(groups.map(function(g) { return g.user_id; }).filter(Boolean)));
    if (ids.length) {
        try {
            (await supabaseAPI.query('users', { 'id': 'in.(' + ids.join(',') + ')', 'select': 'id,name,phone' }) || [])
                .forEach(function(u) { userById[u.id] = u; });
        } catch (e) { /* 계속 */ }
    }
    // 이름 조회 대상: 비로그인 그룹 + "계정 이름 ≠ 입력 이름"인 그룹
    const needName = groups.filter(function(g) {
        if (!g.name) return false;
        if (!g.user_id) return true;
        const u = userById[g.user_id];
        return !u || u.name !== g.name;
    });
    const names = Array.from(new Set(needName.map(function(g) { return g.name; })));
    if (names.length) {
        try {
            (await supabaseAPI.query('users', {
                'name': 'in.(' + names.map(function(n) { return '"' + n.replace(/"/g, '') + '"'; }).join(',') + ')',
                'select': 'name,phone'
            }) || []).forEach(function(u) { if (!(u.name in phoneByName)) phoneByName[u.name] = u.phone; });
        } catch (e) { /* 계속 */ }
    }
    groups.forEach(function(g) {
        const u = g.user_id ? userById[g.user_id] : null;
        if (u && u.name === g.name) {
            g.phone = normPhone(u.phone);          // 계정과 입력 이름 일치 → 계정 번호
        } else {
            g.phone = normPhone(phoneByName[g.name]);   // 불일치/비로그인 → 이름으로 찾은 번호
        }
    });
}

function renderResponders() {
    const el = document.getElementById('respondersList');
    if (!asvResponses.length) {
        el.innerHTML = '<div class="asv-empty">아직 응답자가 없습니다.</div>';
        return;
    }
    const rows = buildResponderGroups();
    el.innerHTML = '<table class="asv-table">' +
        '<tr><th>이름</th><th>번호</th><th>시험 날짜</th><th>답변 수</th><th>제출 시각</th><th>기프티콘</th></tr>' +
        rows.map(function(g) {
            const sent = g.sent_at
                ? '<span class="asv-badge asv-badge-true">발송 완료</span>'
                : '<span class="asv-badge asv-badge-hidden">미발송</span>';
            return '<tr>' +
                '<td><strong>' + escapeHtml(g.name || '-') + '</strong></td>' +
                '<td>' + escapeHtml(g.resp_phone || '(DB 매칭)') + '</td>' +
                '<td>' + escapeHtml(g.exam_date || '-') + '</td>' +
                '<td>' + g.count + '</td>' +
                '<td>' + formatDate(g.at) + '</td>' +
                '<td>' + sent + '</td>' +
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

// ================================================
// 기프티콘 엑셀 다운로드 (GiftyShowBiz 업로드 양식)
//
// "양식 변경 시 발송 불가"라서 새로 만들지 않고, 업체 원본 템플릿
// (assets/giftyshowbiz_template.xlsx)의 8행 이후 데이터만 갈아끼운다.
// 전화번호는 회원 DB에서 자동 매칭: 로그인 제출은 user_id로,
// 이름만 쓴 제출은 이름으로. 못 찾으면 제외하고 이름을 알려준다.
// ================================================
async function downloadGiftyExcel() {
    // 미발송 응답자만 (발송 완료 처리된 사람은 자동 제외 — 중복 발송 방지)
    const list = buildResponderGroups().filter(function(g) { return !g.sent_at; });
    if (!list.length) { alert('발송할 대상이 없습니다. (전원 발송 완료 상태)'); return; }
    await attachPhones(list);

    const excelRows = [];
    const missing = [];
    list.forEach(function(g) {
        if (!g.phone) { missing.push(g.name || '(이름 없음)'); return; }
        excelRows.push({ phone: g.phone, name: g.name });
    });
    if (!excelRows.length) {
        alert('전화번호를 찾은 응답자가 없습니다.\n(회원 DB의 이름과 응답 이름이 일치하는지 확인하세요)');
        return;
    }

    // 3. 템플릿 로드 → 예시 데이터 행(8행~) 제거 → 우리 데이터로 교체
    try {
        const buf = await (await fetch('assets/giftyshowbiz_template.xlsx')).arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        let xml = await zip.file('xl/worksheets/sheet1.xml').async('string');

        // 8행 이후(예시 행) 제거 — 1~7행(안내문+헤더)은 원본 그대로 보존
        xml = xml.replace(/<row r="(?:[89]|[1-9][0-9]+)"[\s\S]*?<\/row>/g, '');

        const esc = function(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        const newRows = excelRows.map(function(r, i) {
            const rn = 8 + i;
            return '<row r="' + rn + '" spans="1:7">' +
                '<c r="A' + rn + '" s="2" t="inlineStr"><is><t>' + esc(r.phone) + '</t></is></c>' +
                '<c r="B' + rn + '" s="1" t="inlineStr"><is><t>' + esc(r.name) + '</t></is></c>' +
                ['C', 'D', 'E', 'F', 'G'].map(function(col) { return '<c r="' + col + rn + '" s="1"/>'; }).join('') +
            '</row>';
        }).join('');
        xml = xml.replace('</sheetData>', newRows + '</sheetData>');
        xml = xml.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:G' + (7 + excelRows.length) + '"/>');

        zip.file('xl/worksheets/sheet1.xml', xml);
        const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '기프티콘발송_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (err) {
        alert('엑셀 생성 실패: ' + err.message);
        return;
    }

    if (missing.length) {
        alert('전화번호를 찾지 못해 엑셀에서 제외된 응답자:\n' + missing.join(', ') + '\n\n엑셀 파일에 직접 추가해주세요.');
    }
}

// ================================================
// 발송 결과 파일 드롭 → 발송 완료 처리
//
// GiftyShowBiz에서 발송 후 내려받는 결과 xlsx(H열 '업로드결과')를
// 드롭하면, '성공' 행의 전화번호/이름을 미발송 응답자와 매칭해
// gifty_sent_at을 기록한다. 완료된 응답자는 이후 엑셀 다운로드에서 제외.
// ================================================
function initGiftyDrop() {
    const dz = document.getElementById('giftyDrop');
    const fi = document.getElementById('giftyFile');
    if (!dz || !fi) return;
    dz.addEventListener('click', function() { fi.click(); });
    dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('asv-drop-on'); });
    dz.addEventListener('dragleave', function() { dz.classList.remove('asv-drop-on'); });
    dz.addEventListener('drop', function(e) {
        e.preventDefault();
        dz.classList.remove('asv-drop-on');
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleGiftyResult(f);
    });
    fi.addEventListener('change', function() {
        if (fi.files && fi.files[0]) handleGiftyResult(fi.files[0]);
        fi.value = '';
    });
}

function xmlUnesc(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** 결과 xlsx 파싱: 8행부터 {phone(A), name(B), result(H)} 추출 (inlineStr/sharedStrings 모두 지원) */
async function parseGiftyResult(file) {
    const zip = await JSZip.loadAsync(file);
    const sheetName = Object.keys(zip.files).find(function(p) { return /^xl\/worksheets\/sheet1\.xml$/i.test(p); });
    if (!sheetName) throw new Error('워크시트를 찾을 수 없습니다.');
    const xml = await zip.file(sheetName).async('string');

    let shared = [];
    const ssFile = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
        const ss = await ssFile.async('string');
        shared = Array.from(ss.matchAll(/<si>([\s\S]*?)<\/si>/g)).map(function(m) {
            return Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
                .map(function(t) { return t[1]; }).join('');
        });
    }

    const rows = [];
    for (const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        if (parseInt(rm[1], 10) < 8) continue;   // 1~7행은 안내문+헤더
        const cells = {};
        for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
            const col = cm[1], attrs = cm[2], inner = cm[3];
            let val = '';
            const ism = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
            const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
            if (ism) val = ism[1];
            else if (vm) val = /t="s"/.test(attrs) ? (shared[parseInt(vm[1], 10)] || '') : vm[1];
            if (val) cells[col] = xmlUnesc(val);
        }
        if (cells.A || cells.B) {
            rows.push({ phone: cells.A || '', name: cells.B || '', result: cells.H || '' });
        }
    }
    return rows;
}

/** 응답 행들에 발송 시각 기록 (id 일괄) */
async function markGiftySent(ids) {
    const url = SUPABASE_URL + '/rest/v1/toefl_survey_responses?id=in.(' + ids.join(',') + ')';
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ gifty_sent_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('API Error: ' + res.status);
}

async function handleGiftyResult(file) {
    if (!/\.xlsx$/i.test(file.name)) { alert('xlsx 파일을 올려주세요.'); return; }

    let rows;
    try {
        rows = await parseGiftyResult(file);
    } catch (err) {
        alert('파일을 읽지 못했습니다: ' + err.message);
        return;
    }
    const success = rows.filter(function(r) { return (r.result || '').indexOf('성공') !== -1; });
    if (!success.length) {
        alert("'성공' 상태의 발송 행을 찾지 못했습니다.\n(H열에 '업로드결과'가 있는 발송 결과 파일이 맞는지 확인하세요)");
        return;
    }

    const groups = buildResponderGroups().filter(function(g) { return !g.sent_at; });
    if (!groups.length) { alert('미발송 상태의 응답자가 없습니다. (이미 전원 완료 처리됨)'); return; }
    await attachPhones(groups);

    const idSet = {};
    const matchedNames = [];
    const unmatched = [];
    success.forEach(function(row) {
        const p = normPhone(row.phone);
        let hits = p ? groups.filter(function(g) { return g.phone && g.phone === p; }) : [];
        if (!hits.length && row.name) hits = groups.filter(function(g) { return g.name === row.name; });
        if (!hits.length) { unmatched.push(((row.name || '') + ' ' + (row.phone || '')).trim()); return; }
        hits.forEach(function(g) {
            if (!idSet[g.ids[0]]) matchedNames.push(g.name || '(이름 없음)');
            g.ids.forEach(function(id) { idSet[id] = true; });
        });
    });

    const ids = Object.keys(idSet);
    if (!ids.length) {
        alert('결과 파일과 매칭되는 미발송 응답자가 없습니다.\n매칭 실패: ' + unmatched.join(', '));
        return;
    }
    if (!confirm(matchedNames.join(', ') + ' — ' + matchedNames.length + '명을 기프티콘 발송 완료로 처리할까요?')) return;
    try {
        await markGiftySent(ids);
        await loadAll();
        let msg = '✅ 발송 완료 처리됨: ' + matchedNames.join(', ');
        if (unmatched.length) msg += '\n\n매칭 안 된 행(수동 확인): ' + unmatched.join(', ');
        alert(msg);
    } catch (err) {
        alert('완료 처리 실패: ' + err.message + '\n(gifty_sent_at 마이그레이션이 실행됐는지 확인하세요)');
    }
}
