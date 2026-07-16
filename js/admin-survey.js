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

function renderActive() {
    const active = asvQuestions.filter(function(q) { return q.status === 'active'; });
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
        return '<div class="asv-q">' +
            '<div class="asv-q-head">' +
                '<div>' +
                    '<div class="asv-q-text">' + escapeHtml(q.question_text) + '</div>' +
                    '<div class="asv-q-meta">' +
                        '<span>' + (q.question_type === 'choice' ? '객관식' : '서술형') + '</span>' +
                        (q.hypothesis ? '<span>가설: ' + escapeHtml(q.hypothesis) + '</span>' : '') +
                        '<span>서로 다른 시험 날짜 ' + distinctDates(resps) + '개</span>' +
                    '</div>' +
                '</div>' +
                '<div class="asv-q-actions">' + targetStr +
                    '<button class="asv-btn-sm" onclick="toggleAnswers(\'' + q.id + '\')">응답 보기</button>' +
                    '<button class="asv-btn-sm" onclick="toggleVerdict(\'' + q.id + '\')">마감·판정</button>' +
                '</div>' +
            '</div>' +
            buildAnswersHtml(q, resps) +
            buildVerdictHtml(q) +
        '</div>';
    }).join('');
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
