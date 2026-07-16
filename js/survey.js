/**
 * 실전 리포트 (학생 설문)
 *
 * 실제 시험을 본 학생에게서 시험 정보를 수집한다.
 * - 로그인 필수 (미로그인 시 login.html?redirect=survey.html)
 * - 질문은 전부 관리자가 등록한 것 (toefl_survey_questions, status=active)
 * - 목표 인원(target_count)이 찬 질문은 자동으로 안 보인다 (수집 종료)
 * - 응답에는 학생의 최근 응시 시험 날짜가 자동으로 붙는다.
 *   등록된 시험이 없으면 날짜를 직접 선택한다.
 * - 같은 시험(응시일)당 1회만 제출 가능. 제출 후 추가된 질문은 다음 시험 때.
 * - 테이블이 아직 없어도(마이그레이션 전) 페이지가 깨지지 않고 "없음" 상태를 보여준다.
 */

let svUser = null;
let svExamDate = null;     // 'YYYY-MM-DD' | null(직접 선택)
let svQuestions = [];      // 학생에게 보여줄 질문들

document.addEventListener('DOMContentLoaded', async function() {
    svUser = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!svUser || !svUser.id) {
        window.location.href = 'login.html?redirect=survey.html';
        return;
    }
    try {
        await loadSurvey();
    } catch (err) {
        console.warn('실전 리포트 로드 실패:', err);
        showState('svEmpty');
    }
});

function showState(id) {
    ['svLoading', 'svEmpty', 'svDone', 'svForm'].forEach(function(s) {
        var el = document.getElementById(s);
        if (el) el.style.display = (s === id) ? '' : 'none';
    });
}

function svEsc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadSurvey() {
    // 1. 최근 응시한 시험 (등록된 일정 중 가장 최근의 지난 시험)
    try {
        const exams = await supabaseAPI.query('toefl_exam_schedules', {
            'user_id': 'eq.' + svUser.id,
            'exam_datetime': 'lte.' + new Date().toISOString(),
            'status': 'neq.cancelled',
            'order': 'exam_datetime.desc',
            'limit': '1'
        });
        if (exams && exams.length) {
            svExamDate = exams[0].exam_datetime.slice(0, 10);
        }
    } catch (e) { /* 일정 없어도 진행 (날짜 직접 선택) */ }

    // 2. 활성 질문 (관리자가 정한 순서대로 — sort_order 없으면 등록순으로 뒤에)
    const questions = await supabaseAPI.query('toefl_survey_questions', {
        'status': 'eq.active',
        'order': 'created_at.asc'
    });
    if (!questions || !questions.length) { showState('svEmpty'); return; }
    questions.sort(function(a, b) {
        var ao = (a.sort_order == null) ? Infinity : a.sort_order;
        var bo = (b.sort_order == null) ? Infinity : b.sort_order;
        if (ao !== bo) return ao - bo;
        return a.created_at < b.created_at ? -1 : 1;
    });

    // 3. 질문별 응답 수 → 목표 찬 질문은 제외 (자동 수집 종료)
    const ids = questions.map(function(q) { return q.id; }).join(',');
    const resps = await supabaseAPI.query('toefl_survey_responses', {
        'question_id': 'in.(' + ids + ')',
        'select': 'question_id'
    });
    const countBy = {};
    (resps || []).forEach(function(r) {
        countBy[r.question_id] = (countBy[r.question_id] || 0) + 1;
    });
    svQuestions = questions.filter(function(q) {
        if (q.hidden === true) return false;   // 관리자가 잠시 숨긴 질문
        return q.target_count == null || (countBy[q.id] || 0) < q.target_count;
    });
    if (!svQuestions.length) { showState('svEmpty'); return; }

    // 4. 이 시험에 대해 이미 제출했는지 (시험당 1회)
    if (svExamDate) {
        const mine = await supabaseAPI.query('toefl_survey_responses', {
            'user_id': 'eq.' + svUser.id,
            'exam_date': 'eq.' + svExamDate,
            'select': 'id',
            'limit': '1'
        });
        if (mine && mine.length) { showState('svDone'); return; }
    }

    renderForm();
}

var SV_DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
function svDayKr(dateStr) {
    return SV_DAY_KR[new Date(dateStr + 'T00:00:00').getDay()];
}

/** 날짜 선택 시 옆의 요일 칩 갱신 */
function updateSvDay() {
    var input = document.getElementById('svDate');
    var chip = document.getElementById('svDayChip');
    if (input && chip) chip.textContent = input.value ? '(' + svDayKr(input.value) + ')' : '';
}

function renderForm() {
    // 시험 날짜: 자동 인식 배지 또는 직접 선택
    var examInfo = document.getElementById('svExamInfo');
    if (svExamDate) {
        var d = new Date(svExamDate + 'T00:00:00');
        examInfo.innerHTML =
            '<span class="sv-exam-badge"><i class="fas fa-calendar-check"></i> ' +
            (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + svDayKr(svExamDate) + ') 시험에 대한 리포트</span>';
    } else {
        var today = new Date().toISOString().slice(0, 10);
        // 오늘을 기본값으로: iOS는 빈 date 인풋에 아무것도 안 보여줘서, 값을 채워야 보인다.
        // (시험 직후 여는 설문이라 오늘이 최선의 기본값 — 다른 날이면 학생이 바꾼다)
        examInfo.innerHTML =
            '<div class="sv-date-row">' +
                '<label>시험 본 날짜</label>' +
                '<div class="sv-date-flex">' +
                    '<input type="date" id="svDate" value="' + today + '" max="' + today + '" onchange="updateSvDay()">' +
                    '<span class="sv-day-chip" id="svDayChip">(' + svDayKr(today) + ')</span>' +
                '</div>' +
            '</div>';
    }

    // 질문 카드들
    var html = '';
    svQuestions.forEach(function(q, i) {
        var body = '';
        if (q.question_type === 'choice') {
            var opts = Array.isArray(q.options) ? q.options : [];
            body = opts.map(function(opt) {
                return '<label class="sv-opt">' +
                    '<input type="radio" name="q_' + q.id + '" value="' + svEsc(opt) + '" ' +
                        'onchange="markSelected(this)">' +
                    '<span>' + svEsc(opt) + '</span>' +
                '</label>';
            }).join('');
        } else {
            body = '<textarea id="q_' + q.id + '" placeholder="천천히 떠올려서 최대한 정확하게 적어주세요."></textarea>';
        }
        html += '<div class="sv-card sv-q" id="qcard_' + q.id + '">' +
            '<div class="sv-q-text"><span class="sv-q-num">' + (i + 1) + '</span>' +
                svEsc(q.question_text) +
                '<span class="sv-req">*</span>' +
            '</div>' + body +
        '</div>';
    });
    document.getElementById('svQuestions').innerHTML = html;
    showState('svForm');
}

/** 객관식 선택 시 보기 강조 */
function markSelected(input) {
    var group = document.getElementsByName(input.name);
    for (var i = 0; i < group.length; i++) {
        group[i].closest('.sv-opt').classList.toggle('sv-opt-on', group[i].checked);
    }
}

async function submitSurvey() {
    var date = svExamDate;
    if (!date) {
        var dateInput = document.getElementById('svDate');
        date = dateInput ? dateInput.value : '';
        if (!date) { alert('시험 본 날짜를 선택해주세요.'); return; }
    }

    // 모든 문항 필수 — 빈 문항이 있으면 안내하고 그 문항으로 데려간다
    var goToQuestion = function(q, idx, msg) {
        alert(msg);
        var card = document.getElementById('qcard_' + q.id);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (q.question_type === 'text') {
            var ta = document.getElementById('q_' + q.id);
            if (ta) setTimeout(function() { ta.focus(); }, 350);
        }
    };

    var rows = [];
    for (var i = 0; i < svQuestions.length; i++) {
        var q = svQuestions[i];
        var answer = '';
        if (q.question_type === 'choice') {
            var sel = document.querySelector('input[name="q_' + q.id + '"]:checked');
            if (!sel) { goToQuestion(q, i, (i + 1) + '번 문항에 답해주세요.\n모든 항목이 필수예요!'); return; }
            answer = sel.value;
        } else {
            var ta = document.getElementById('q_' + q.id);
            answer = ta ? ta.value.trim() : '';
            if (!answer) { goToQuestion(q, i, (i + 1) + '번 문항을 작성해주세요.\n모든 항목이 필수예요!'); return; }
        }
        rows.push({
            question_id: q.id,
            user_id: svUser.id,
            user_name: svUser.name || '',
            user_email: svUser.email || '',
            exam_date: date,
            answer: answer
        });
    }
    if (!rows.length) { alert('답변을 입력해주세요.'); return; }

    var btn = document.getElementById('svSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 보내는 중...';
    try {
        await supabaseAPI.post('toefl_survey_responses', rows);
        showState('svDone');
    } catch (err) {
        console.error('리포트 제출 실패:', err);
        if (/duplicate|unique/i.test(err.message || '')) {
            showState('svDone');   // 이미 제출된 시험 → 완료로 안내
        } else {
            alert('제출 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> 리포트 보내기';
        }
    }
}
