// ===== 학생 학습 상세 (admin-study-detail.js) =====

// 전역 변수
let studentData = null;      // { user, app, records, authRecords }
let allTaskRows = [];         // 과제 테이블용 가공 데이터
let filteredTaskRows = [];    // 필터링된 과제 데이터
let scheduleLookup = {};      // 스케줄 룩업: { 'standard': { '1_sunday': 3, ... }, 'fast': { ... } }
const DAY_INDEX_TO_ENG = { 0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday' };

// 스케줄 기반 일별 과제 수 반환
function getTaskCountForDay(programType, week, dayIndex) {
    const prog = programType.toLowerCase();
    const dayEng = DAY_INDEX_TO_ENG[dayIndex];
    if (!dayEng) return 0;
    const lookup = scheduleLookup[prog];
    if (!lookup) return 0;
    return lookup[`${week}_${dayEng}`] || 0;
}

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth();
    loadStudentDetail();
});

function checkAdminAuth() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!userData || userData.role !== 'admin') {
        alert('관리자 권한이 필요합니다.');
        window.location.href = 'login.html';
        return;
    }
    const adminName = document.getElementById('adminName');
    if (adminName) adminName.textContent = userData.name || '관리자';
}

// ===== 메인 데이터 로드 =====
async function loadStudentDetail() {
    const loading = document.getElementById('loading');
    const errorState = document.getElementById('errorState');
    const detailContent = document.getElementById('detailContent');

    try {
        // URL에서 user_id 추출
        const params = new URLSearchParams(window.location.search);
        const userId = params.get('id');
        if (!userId) throw new Error('학생 ID가 지정되지 않았습니다.');

        // 1. users 테이블에서 학생 조회
        const users = await supabaseAPI.query('users', { 'id': `eq.${userId}` });
        const user = users && users.length > 0 ? users[0] : null;
        if (!user) throw new Error('해당 학생을 찾을 수 없습니다.');

        // 2. applications 에서 해당 학생 신청서 (입금 확인된 것 우선)
        const apps = await supabaseAPI.query('applications', {
            'email': `eq.${user.email}`,
            'deposit_confirmed_by_admin': 'eq.true',
            'limit': '10',
            'order': 'created_at.desc'
        });
        const app = apps && apps.length > 0 ? apps[0] : null;
        if (!app) {
            // 입금 미확인이라도 시도
            const apps2 = await supabaseAPI.query('applications', {
                'email': `eq.${user.email}`,
                'limit': '10',
                'order': 'created_at.desc'
            });
            if (!apps2 || apps2.length === 0) throw new Error('해당 학생의 신청서를 찾을 수 없습니다.');
            studentData = { user, app: apps2[0] };
        } else {
            studentData = { user, app };
        }

        // 3. tr_study_records
        const records = await supabaseAPI.query('tr_study_records', {
            'user_id': `eq.${userId}`,
            'limit': '10000',
            'order': 'completed_at.desc'
        });
        studentData.records = records || [];

        // 4. tr_auth_records
        const authRecords = await supabaseAPI.query('tr_auth_records', {
            'user_id': `eq.${userId}`,
            'limit': '10000',
            'order': 'created_at.desc'
        });
        studentData.authRecords = authRecords || [];

        // 5. 스케줄 데이터 로드
        const scheduleData = await supabaseAPI.query('tr_schedule_assignment', { 'limit': '500' });
        scheduleLookup = {};
        (scheduleData || []).forEach(s => {
            const prog = (s.program || '').toLowerCase();
            if (!scheduleLookup[prog]) scheduleLookup[prog] = {};
            const taskCount = [s.section1, s.section2, s.section3, s.section4].filter(v => v && v.trim() !== '').length;
            scheduleLookup[prog][`${s.week}_${s.day}`] = taskCount;
        });

        // 6. ★ tr_student_stats (테스트룸이 계산한 인증률/등급/제출률/환급)
        const statsRes = await supabaseAPI.query('tr_student_stats', { 'user_id': `eq.${userId}` });
        studentData.stats = (statsRes && statsRes.length > 0) ? statsRes[0] : {};

        // 렌더링
        loading.style.display = 'none';
        detailContent.style.display = 'block';

        renderProfileHeader();
        renderSummaryCards();
        renderGrassGrid();
        buildTaskRows();
        renderTaskTable();
        renderNotes();
        loadProgressSaves();
        setupWeeklyCheckDropdown();

    } catch (error) {
        console.error('Failed to load student detail:', error);
        loading.style.display = 'none';
        errorState.style.display = 'block';
        document.getElementById('errorMsg').textContent = error.message || '학생 정보를 불러올 수 없습니다.';
    }
}

// ===== 유틸리티 =====
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function toDateStr(date) {
    // YYYY-MM-DD
    return date.toISOString().split('T')[0];
}

function formatKSTTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const kstOffset = 9 * 60 * 60 * 1000;
    const kst = new Date(d.getTime() + kstOffset);
    const h = kst.getUTCHours();
    const m = kst.getUTCMinutes();
    const ampm = h < 12 ? 'AM' : 'PM';
    const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${dh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatKSTDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function getProgram(app) {
    const p = (app.assigned_program || app.preferred_program || '');
    return p.includes('Fast') ? 'Fast' : 'Standard';
}

function getTotalWeeks(app) {
    return getProgram(app) === 'Fast' ? 4 : 8;
}

function getScheduleStart(app) {
    return app.schedule_start ? new Date(app.schedule_start) : null;
}

function getScheduleEnd(app) {
    return app.schedule_end ? new Date(app.schedule_end) : null;
}

function getCurrentWeek(app) {
    const start = getScheduleStart(app);
    if (!start) return 1;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(Math.floor(diff / 7) + 1, getTotalWeeks(app)));
}

function getWeekForDate(app, dateStr) {
    const start = getScheduleStart(app);
    if (!start) return 1;
    const d = new Date(dateStr);
    const diff = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diff / 7) + 1);
}

// ===== 프로필 헤더 =====
function renderProfileHeader() {
    const { user, app } = studentData;
    const name = user.name || app.name || '-';
    document.getElementById('studentAvatar').textContent = name.charAt(0);
    document.getElementById('studentName').textContent = name;
    document.getElementById('studentProgram').textContent =
        `내벨업챌린지 - ${getProgram(app)} (${getTotalWeeks(app)}주)`;
    
    const start = getScheduleStart(app);
    const end = getScheduleEnd(app);
    document.getElementById('studentPeriod').textContent = start && end
        ? `${formatKSTDate(app.schedule_start)} ~ ${formatKSTDate(app.schedule_end)}`
        : '-';
    document.getElementById('studentEmail').textContent = user.email || '-';

    // 신청서 관리 버튼
    if (app.id) {
        const btn = document.getElementById('btnManageApp');
        btn.style.display = 'inline-flex';
        btn.onclick = () => { window.location.href = `admin-applications.html?manage=${app.id}`; };
    }
}

// ===== 요약 카드 4개 (테스트룸 마이페이지와 동일) =====
function renderSummaryCards() {
    const { app, stats } = studentData;
    // D-day는 실제 오늘 날짜 기준 (effectiveToday가 아님, 테스트룸과 동일)
    const todayReal = new Date(); todayReal.setHours(0,0,0,0);
    const totalWeeks = getTotalWeeks(app);
    const currentWeek = getCurrentWeek(app);
    const start = getScheduleStart(app);
    const end = getScheduleEnd(app);

    // ── ★ tr_student_stats에서 읽기 (계산 없이 그대로) ──
    const authRate = stats.calc_auth_rate || 0;
    const grade = stats.calc_grade || '-';
    const submitRate = stats.calc_submit_rate || 0;
    const refundAmount = stats.calc_refund_amount || 0;
    const tasksDue = stats.calc_tasks_due || 0;
    const tasksSubmitted = stats.calc_tasks_submitted || 0;
    const authSum = stats.calc_auth_sum || 0;

    // ── 카드1: 챌린지 현황 (applications 기반) ──
    let challengeValue = '-';
    let challengeSub = '';
    if (start && end) {
        if (todayReal < start) {
            const dDay = Math.ceil((start - todayReal) / (1000 * 60 * 60 * 24));
            const startDay = ['일','월','화','수','목','금','토'][start.getDay()];
            challengeValue = `D-${dDay}`;
            challengeSub = `${start.getMonth()+1}/${start.getDate()}(${startDay}) 시작 예정`;
        } else if (todayReal > end) {
            challengeValue = '종료';
            challengeSub = `${end.getMonth()+1}/${end.getDate()} 종료됨`;
        } else {
            let remaining = 0;
            const checkDate = new Date(todayReal);
            checkDate.setDate(checkDate.getDate() + 1);
            while (checkDate <= end) {
                if (checkDate.getDay() !== 6) remaining++;
                checkDate.setDate(checkDate.getDate() + 1);
            }
            challengeValue = `${currentWeek}/${totalWeeks}주차`;
            challengeSub = `잔여 ${remaining}일`;
        }
    }

    // ── 카드2: 제출률 (calc_tasks_due 기준 3분기) ──
    let submitDisplay, submitSub;
    if (tasksDue > 0) {
        // 시작 후: 정상 표시
        submitDisplay = `${submitRate}%`;
        submitSub = `${tasksSubmitted}/${tasksDue}개 완료`;
    } else if (tasksDue === 0 && tasksSubmitted > 0) {
        // 시작 전 + 선제출 있음
        submitDisplay = `${tasksSubmitted}건 미리 완료 🎉`;
        submitSub = '시작 전 선제출';
    } else {
        // 시작 전 + 제출 없음
        submitDisplay = '0%';
        submitSub = '아직 제출된 과제가 없어요';
    }

    // ── 카드3: 인증률 (calc_tasks_due 기준 3분기) ──
    let authDisplay, authSub;
    if (tasksDue > 0) {
        // 시작 후: 정상 표시
        authDisplay = `${authRate}%`;
        authSub = `인증 합계 ${authSum} / 마감 ${tasksDue}건`;
    } else if (tasksDue === 0 && tasksSubmitted > 0) {
        // 시작 전 + 선제출 있음
        authDisplay = `${authRate}%`;
        authSub = `인증 합계 ${authSum} / 제출 ${tasksSubmitted}건 (시작 전)`;
    } else {
        // 시작 전 + 제출 없음
        authDisplay = '데이터 없음';
        authSub = '';
    }

    // ── 카드4: 등급 & 환급 (calc_tasks_due 기준 3분기) ──
    let gradeDisplay, gradeSub;
    if (tasksDue > 0) {
        // 시작 후: 테스트룸 등급 그대로
        gradeDisplay = grade;
        gradeSub = `${grade}등급 · 환급 ${refundAmount > 0 ? refundAmount.toLocaleString() : '0'}원`;
    } else {
        // 시작 전: tasks_due = 0
        gradeDisplay = '-';
        gradeSub = '시작 후 산정';
    }
    const gradeColor = (gradeDisplay !== '-') ? getGradeColor(grade) : '#94a3b8';

    // ── 인증률 색상 ──
    const authColor = (authDisplay !== '데이터 없음' && authDisplay !== '-')
        ? (authRate >= 95 ? '#22c55e' : authRate >= 90 ? '#3b82f6' : authRate >= 80 ? '#f59e0b' : authRate >= 70 ? '#f97316' : '#ef4444')
        : '#64748b';

    const container = document.getElementById('summaryCards');
    container.innerHTML = `
        <!-- 카드1: 챌린지 현황 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:#faf5ff; color:#7c3aed;">
                <i class="fas fa-calendar-check"></i>
            </div>
            <div class="stat-value">${challengeValue}</div>
            <div class="stat-label">챌린지 현황</div>
            <div class="stat-sub">${challengeSub}</div>
        </div>

        <!-- 카드2: 제출률 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:#ecfdf5; color:#10b981;">
                <i class="fas fa-clipboard-check"></i>
            </div>
            <div class="stat-value">${submitDisplay}</div>
            <div class="stat-label">제출률</div>
            <div class="stat-sub">${submitSub}</div>
        </div>

        <!-- 카드3: 인증률 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:${(authDisplay !== '데이터 없음' && authDisplay !== '-') ? (authRate >= 80 ? '#dcfce7' : authRate >= 70 ? '#fef3c7' : '#fef2f2') : '#f1f5f9'}; color:${authColor};">
                <i class="fas fa-shield-alt"></i>
            </div>
            <div class="stat-value" style="color:${authColor};">${authDisplay}</div>
            <div class="stat-label">인증률</div>
            <div class="stat-sub">${authSub}</div>
        </div>

        <!-- 카드4: 등급 & 환급 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:${gradeDisplay !== '-' ? gradeColor + '20' : '#f1f5f9'}; color:${gradeColor};">
                <i class="fas fa-award"></i>
            </div>
            <div class="stat-value" style="color:${gradeColor};">${gradeDisplay}</div>
            <div class="stat-label">등급 & 환급</div>
            <div class="stat-sub">${gradeSub}</div>
        </div>
    `;
}

// ===== 주차별 잔디심기 =====
function renderGrassGrid() {
    const { app, records } = studentData;
    const start = getScheduleStart(app);
    if (!start) {
        document.getElementById('grassGrid').innerHTML = '<p style="color:#94a3b8;">시작일이 설정되지 않았습니다.</p>';
        return;
    }

    const totalWeeks = getTotalWeeks(app);
    const today = getEffectiveToday();

    // 요일 라벨
    let html = `<div class="grass-day-labels">`;
    const dayLabels = ['일', '월', '화', '수', '목', '금'];
    dayLabels.forEach(d => { html += `<div class="grass-day-label">${d}</div>`; });
    html += `</div>`;

    const programType = getProgram(app); // 'Fast' or 'Standard'

    for (let w = 1; w <= totalWeeks; w++) {
        const weekStart = new Date(start);
        weekStart.setDate(weekStart.getDate() + (w - 1) * 7);

        html += `<div class="grass-week-row">`;
        html += `<div class="grass-week-label">${w}주차</div>`;
        html += `<div class="grass-cells">`;

        for (let d = 0; d < 6; d++) { // 일~금 (0~5)
            const cellDate = new Date(weekStart);
            cellDate.setDate(cellDate.getDate() + d);
            const dateStr = toDateStr(cellDate);
            const dayName = DAY_NAMES[cellDate.getDay()];
            const isToday = dateStr === toDateStr(today);
            const isFuture = cellDate > today;

            // 해당 날짜의 스케줄 과제 수
            const requiredTasks = getTaskCountForDay(programType, w, cellDate.getDay());

            // 해당 날짜의 과제 수 (미래/오늘 포함하여 항상 확인)
            const dayRecords = records.filter(r => {
                return toDateStr(new Date(r.completed_at)) === dateStr;
            });
            const uniqueTypes = new Set(dayRecords.map(r => r.task_type));
            const count = uniqueTypes.size;

            if (requiredTasks > 0 && count >= requiredTasks) {
                html += `<div class="grass-cell grass-done" data-tooltip="${dateStr} (${dayName}) ${count}/${requiredTasks}종 완료">✅</div>`;
            } else if (count > 0) {
                html += `<div class="grass-cell grass-partial" data-tooltip="${dateStr} (${dayName}) ${count}/${requiredTasks}종 제출${isToday ? ' (진행중)' : ''}">${count}</div>`;
            } else if (isFuture || isToday) {
                html += `<div class="grass-cell grass-pending" data-tooltip="${dateStr} (${dayName}) ${isToday ? '진행 중' : '미도래'}">⬜</div>`;
            } else {
                html += `<div class="grass-cell grass-missed" data-tooltip="${dateStr} (${dayName}) 미제출">❌</div>`;
            }
        }

        html += `</div></div>`;
    }

    document.getElementById('grassGrid').innerHTML = html;
}

// ===== 과제 데이터 가공 =====
function buildTaskRows() {
    const { app, records, authRecords } = studentData;

    // study_record_id 로 auth 매핑
    const authMap = {};
    authRecords.forEach(ar => {
        if (ar.study_record_id) authMap[ar.study_record_id] = ar;
    });

    allTaskRows = records.map(r => {
        const auth = authMap[r.id] || null;
        const dateStr = toDateStr(new Date(r.completed_at));
        const week = getWeekForDate(app, dateStr);
        const dayName = DAY_NAMES[new Date(r.completed_at).getDay()];

        // fraud 판별
        const isFraud = auth ? (auth.fraud_flag || auth.no_selection_flag || auth.no_text_flag || (auth.focus_lost_count > 3)) : false;

        // 과제 이름
        const typeLabel = getTaskTypeLabel(r.task_type);
        const moduleStr = r.module_number ? ` M${r.module_number}` : '';
        const attemptStr = r.attempt > 1 ? ` (${r.attempt}차)` : '';
        const taskName = `${typeLabel}${moduleStr}${attemptStr}`;

        // 노트 텍스트: error_note_text 또는 memo_text (입문서 등)
        const hasErrorNote = !!(r.error_note_text && r.error_note_text.trim());
        const hasMemo = !!(r.memo_text && r.memo_text.trim());
        const noteContent = hasErrorNote ? r.error_note_text : (hasMemo ? r.memo_text : '');
        const noteWc = noteContent ? (r.error_note_word_count || noteContent.length) : 0;
        const noteType = hasErrorNote ? 'error_note' : (hasMemo ? 'memo' : null);

        return {
            dateStr,
            dayName,
            week,
            taskType: r.task_type,
            taskName,
            score: r.score || 0,
            total: r.total || 0,
            authRate: auth ? (auth.auth_rate || 0) : '-',
            submittedTime: formatKSTTime(r.completed_at),
            hasNote: !!noteContent,
            noteText: noteContent,
            noteWordCount: noteWc,
            noteType,
            isFraud,
            rawDate: new Date(r.completed_at),
            recordId: r.id
        };
    });

    // 날짜 내림차순 정렬
    allTaskRows.sort((a, b) => b.rawDate - a.rawDate);

    // 주차 필터 드롭다운 갱신
    const weekSet = new Set(allTaskRows.map(r => r.week));
    const weekFilter = document.getElementById('taskWeekFilter');
    const weekNums = [...weekSet].sort((a, b) => a - b);
    weekNums.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = `${w}주차`;
        weekFilter.appendChild(opt);
    });

    filteredTaskRows = [...allTaskRows];
}

function getTaskTypeLabel(type) {
    const map = {
        'reading': 'Reading',
        'listening': 'Listening',
        'writing': 'Writing',
        'speaking': 'Speaking',
        'vocab': 'Vocab',
        'intro-book': '입문서'
    };
    return map[type] || type || '-';
}

// ===== 과제 필터 =====
function applyTaskFilters() {
    const weekVal = document.getElementById('taskWeekFilter').value;
    const typeVal = document.getElementById('taskTypeFilter').value;
    const statusVal = document.getElementById('taskStatusFilter').value;

    filteredTaskRows = allTaskRows.filter(r => {
        if (weekVal && r.week !== parseInt(weekVal)) return false;
        if (typeVal && r.taskType !== typeVal) return false;
        if (statusVal === 'fraud' && !r.isFraud) return false;
        if (statusVal === 'normal' && r.isFraud) return false;
        return true;
    });

    renderTaskTable();
}

// ===== 과제 테이블 렌더링 =====
function renderTaskTable() {
    const tbody = document.getElementById('taskTableBody');
    const taskEmpty = document.getElementById('taskEmpty');
    const taskTable = document.getElementById('taskTable');
    const taskCount = document.getElementById('taskCount');

    taskCount.textContent = `${filteredTaskRows.length}건`;

    if (filteredTaskRows.length === 0) {
        taskTable.style.display = 'none';
        taskEmpty.style.display = 'block';
        return;
    }

    taskTable.style.display = '';
    taskEmpty.style.display = 'none';

    tbody.innerHTML = filteredTaskRows.map(r => {
        const scoreText = r.total > 0 ? `${r.score}/${r.total}` : `${r.score}`;
        const authText = r.authRate !== '-' ? `${r.authRate}%` : '-';
        const authColor = r.authRate >= 80 ? '#22c55e' : r.authRate >= 50 ? '#f59e0b' : '#ef4444';

        const noteBtn = r.hasNote
            ? `<button onclick="openNoteModal('${r.recordId}')" style="background:#f8fafc; border:1px solid #e2e8f0; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px; color:#7c3aed; font-weight:600;">
                <i class="fas fa-eye"></i> 보기
               </button>`
            : '<span style="color:#cbd5e1;">-</span>';

        const statusIcon = r.isFraud
            ? '<span style="background:#fef2f2; color:#ef4444; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600;">⚠️ Fraud</span>'
            : '<span style="color:#22c55e;">✅</span>';

        const rowBg = r.isFraud ? 'background:#fef2f2;' : '';

        return `
            <tr style="${rowBg}">
                <td style="white-space:nowrap;">${r.dateStr}</td>
                <td>${r.dayName}</td>
                <td><strong>${escapeHtml(r.taskName)}</strong></td>
                <td>${scoreText}</td>
                <td><span style="color:${r.authRate !== '-' ? authColor : '#cbd5e1'}; font-weight:600;">${authText}</span></td>
                <td style="white-space:nowrap;">${r.submittedTime}</td>
                <td>${noteBtn}</td>
                <td>${statusIcon}</td>
            </tr>
        `;
    }).join('');
}

// ===== 오답노트 모달 =====
function openNoteModal(recordId) {
    const row = allTaskRows.find(r => r.recordId === recordId);
    if (!row) return;

    const modal = document.getElementById('noteModal');
    document.getElementById('modalNoteTitle').textContent = `오답노트 - ${row.taskName} (${row.dateStr})`;
    document.getElementById('modalNoteBody').textContent = row.noteText || '(내용 없음)';
    document.getElementById('modalNoteMeta').textContent =
        `글자 수: ${row.noteWordCount}자 | 과제: ${row.taskName} | 날짜: ${row.dateStr} ${row.submittedTime}`;

    modal.classList.add('active');

    // 모달 바깥 클릭 닫기
    modal.onclick = (e) => {
        if (e.target === modal) closeNoteModal();
    };
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.remove('active');
}

// ===== 오답노트 모아보기 =====
function renderNotes() {
    const notes = allTaskRows.filter(r => r.hasNote).sort((a, b) => b.rawDate - a.rawDate);
    const notesList = document.getElementById('notesList');
    const notesEmpty = document.getElementById('notesEmpty');

    if (notes.length === 0) {
        notesList.style.display = 'none';
        notesEmpty.style.display = 'block';
        return;
    }

    notesList.style.display = 'block';
    notesEmpty.style.display = 'none';

    notesList.innerHTML = notes.map((n, idx) => {
        const tags = [];
        // 노트 타입 태그
        if (n.noteType === 'memo') tags.push('<span class="tag" style="background:#dbeafe; color:#2563eb;">📝 메모</span>');
        else tags.push('<span class="tag" style="background:#fef3c7; color:#d97706;">📋 오답노트</span>');
        if (n.isFraud) tags.push('<span class="tag tag-fraud">⚠️ Fraud</span>');
        if (n.noteType === 'error_note' && n.noteWordCount < 20) tags.push('<span class="tag tag-short">짧은 노트</span>');

        const preview = n.noteText.length > 200 ? n.noteText.substring(0, 200) + '...' : n.noteText;
        const needsToggle = n.noteText.length > 200;

        return `
            <div class="note-card">
                <div class="note-card-header">
                    <div class="note-card-meta">
                        <strong>${escapeHtml(n.taskName)}</strong> · ${n.dateStr} (${n.dayName}) · ${n.noteWordCount}자
                    </div>
                    <div class="note-card-tags">${tags.join('')}</div>
                </div>
                <div class="note-card-body" id="noteBody${idx}">${escapeHtml(preview)}</div>
                ${needsToggle
                    ? `<button class="note-toggle" onclick="openNoteModal('${n.recordId}')">전체 보기 →</button>`
                    : ''
                }
            </div>
        `;
    }).join('');
}

// ===== 주간체크 데이터 수집 =====
function setupWeeklyCheckDropdown() {
    const { app } = studentData;
    const totalWeeks = getTotalWeeks(app);
    const currentWeek = getCurrentWeek(app);
    const select = document.getElementById('weeklyCheckWeek');

    select.innerHTML = '<option value="">주차 선택</option>';
    for (let w = 1; w <= totalWeeks; w++) {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = `${w}주차${w === currentWeek ? ' (현재)' : ''}`;
        select.appendChild(opt);
    }
    // 현재 주차 자동 선택
    select.value = currentWeek;
    generateWeeklyCheckData();
}

function generateWeeklyCheckData() {
    const weekVal = parseInt(document.getElementById('weeklyCheckWeek').value);
    const area = document.getElementById('weeklyCheckData');
    if (!weekVal) {
        area.textContent = '주차를 선택하면 데이터가 생성됩니다.';
        return;
    }

    const { user, app, records, authRecords } = studentData;
    const start = getScheduleStart(app);
    if (!start) {
        area.textContent = '시작일이 설정되지 않았습니다.';
        return;
    }

    const name = user.name || app.name || '-';
    const program = getProgram(app);
    const totalWeeks = getTotalWeeks(app);
    const today = getEffectiveToday();

    // 주차 시작일/종료일
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() + (weekVal - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 5); // 일~금

    // 해당 주차 레코드
    const weekRecords = records.filter(r => {
        const d = toDateStr(new Date(r.completed_at));
        return d >= toDateStr(weekStart) && d <= toDateStr(weekEnd);
    });

    // 해당 주차 인증 레코드
    const weekRecordIds = new Set(weekRecords.map(r => r.id));
    const weekAuth = authRecords.filter(r => weekRecordIds.has(r.study_record_id));

    const programType = getProgram(app);

    // 일별 통계
    const dailyStats = [];
    let weekTasksDue = 0; // 마감된 과제 수 합계
    for (let d = 0; d < 6; d++) {
        const cellDate = new Date(weekStart);
        cellDate.setDate(cellDate.getDate() + d);
        const dateStr = toDateStr(cellDate);
        const dayName = DAY_NAMES[cellDate.getDay()];
        const requiredTasks = getTaskCountForDay(programType, weekVal, cellDate.getDay());

        if (cellDate > today) {
            // 미래이지만 선제 완료 확인
            const dayRecs = weekRecords.filter(r => toDateStr(new Date(r.completed_at)) === dateStr);
            const types = new Set(dayRecs.map(r => r.task_type));
            if (requiredTasks > 0 && types.size >= requiredTasks) {
                dailyStats.push({ dateStr, dayName, status: `✅ 완료 (${types.size}/${requiredTasks})`, count: types.size, required: requiredTasks });
                weekTasksDue += requiredTasks;
            } else if (types.size > 0) {
                dailyStats.push({ dateStr, dayName, status: `🟨 ${types.size}/${requiredTasks} (진행중)`, count: types.size, required: requiredTasks });
            } else {
                dailyStats.push({ dateStr, dayName, status: '미도래', count: 0, required: requiredTasks });
            }
            continue;
        }

        const dayRecs = weekRecords.filter(r => toDateStr(new Date(r.completed_at)) === dateStr);
        const types = new Set(dayRecs.map(r => r.task_type));
        const isToday = dateStr === toDateStr(today);
        let status;
        if (requiredTasks > 0 && types.size >= requiredTasks) {
            status = `✅ 완료 (${types.size}/${requiredTasks})`;
            weekTasksDue += requiredTasks;
        } else if (types.size > 0) {
            status = `🟨 ${types.size}/${requiredTasks}${isToday ? ' (진행중)' : ''}`;
            if (!isToday) weekTasksDue += requiredTasks; // 과거 미완료일은 마감에 포함
        } else if (isToday) {
            status = '진행 중';
        } else {
            status = '❌ 미제출';
            weekTasksDue += requiredTasks; // 과거 미제출도 마감에 포함
        }
        dailyStats.push({ dateStr, dayName, status, count: types.size, required: requiredTasks });
    }

    // 주차 인증률 합계
    const weekAuthTotal = weekAuth.reduce((s, r) => s + (r.auth_rate || 0), 0);
    const weekAuthRate = weekTasksDue > 0 ? Math.round(weekAuthTotal / weekTasksDue) : 0;

    // 오답노트 & 메모 작성 수
    const weekErrorNotes = weekRecords.filter(r => r.error_note_text && r.error_note_text.trim());
    const weekMemos = weekRecords.filter(r => r.memo_text && r.memo_text.trim());
    const weekTotalNotes = weekErrorNotes.length + weekMemos.length;

    // fraud 수
    const weekFraud = weekAuth.filter(r => r.fraud_flag || r.no_selection_flag || r.no_text_flag || (r.focus_lost_count > 3)).length;

    let text = '';
    text += `📋 주간체크 - ${name}\n`;
    text += `프로그램: 내벨업챌린지 - ${program} (${totalWeeks}주)\n`;
    text += `기간: ${toDateStr(weekStart)} ~ ${toDateStr(weekEnd)}\n`;
    text += `주차: ${weekVal}/${totalWeeks}주차\n`;
    text += `\n`;
    text += `── 일별 현황 ──\n`;
    dailyStats.forEach(d => {
        text += `  ${d.dayName} (${d.dateStr}): ${d.status}\n`;

        // 해당 날짜의 과제 상세
        const dayRecs = weekRecords.filter(r => toDateStr(new Date(r.completed_at)) === d.dateStr);
        dayRecs.forEach(r => {
            const typeLabel = getTaskTypeLabel(r.task_type);
            const moduleStr = r.module_number ? ` M${r.module_number}` : '';
            const scoreStr = r.total > 0 ? `${r.score}/${r.total}` : `${r.score}`;
            text += `    └ ${typeLabel}${moduleStr}: ${scoreStr}\n`;

            // 오답노트
            if (r.error_note_text && r.error_note_text.trim()) {
                const preview = r.error_note_text.trim().length > 100 
                    ? r.error_note_text.trim().substring(0, 100) + '...' 
                    : r.error_note_text.trim();
                text += `      📝 오답노트: ${preview}\n`;
            }
            // 메모 (입문서 등)
            if (r.memo_text && r.memo_text.trim()) {
                const preview = r.memo_text.trim().length > 100 
                    ? r.memo_text.trim().substring(0, 100) + '...' 
                    : r.memo_text.trim();
                text += `      📝 메모: ${preview}\n`;
            }
        });
    });
    text += `\n`;
    text += `── 주간 요약 ──\n`;
    text += `  제출 과제: ${weekRecords.length}건\n`;
    text += `  인증률 합계: ${weekAuthTotal} / 마감 ${weekTasksDue}건 → ${weekAuthRate}%\n`;
    text += `  오답노트: ${weekErrorNotes.length}건 / 메모: ${weekMemos.length}건 (합계 ${weekTotalNotes}건)\n`;
    if (weekFraud > 0) {
        text += `  ⚠️ Fraud 감지: ${weekFraud}건\n`;
    }

    area.textContent = text;
}

function copyWeeklyCheck() {
    const text = document.getElementById('weeklyCheckData').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btnCopy');
        btn.innerHTML = '<i class="fas fa-check"></i> 복사 완료!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-copy"></i> 클립보드에 복사';
            btn.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        // 폴백: textarea 사용
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('클립보드에 복사되었습니다.');
    });
}

// ===== 과제 진행상태 관리 (tr_progress_save) =====

let progressSaves = [];

async function loadProgressSaves() {
    const loadingEl = document.getElementById('progressLoading');
    const tableWrap = document.getElementById('progressTableWrap');
    const emptyEl = document.getElementById('progressEmpty');
    const countEl = document.getElementById('progressCount');

    loadingEl.style.display = 'block';
    tableWrap.style.display = 'none';
    emptyEl.style.display = 'none';

    try {
        const userId = studentData.user.id;
        const res = await supabaseAPI.query('tr_progress_save', {
            'user_id': `eq.${userId}`,
            'order': 'updated_at.desc',
            'limit': '100'
        });
        progressSaves = res || [];

        loadingEl.style.display = 'none';

        if (progressSaves.length === 0) {
            emptyEl.style.display = 'block';
            countEl.textContent = '';
            return;
        }

        countEl.textContent = `(${progressSaves.length}건)`;
        tableWrap.style.display = 'block';
        renderProgressTable();

    } catch (err) {
        console.error('Failed to load progress saves:', err);
        loadingEl.style.display = 'none';
        emptyEl.style.display = 'block';
        emptyEl.querySelector('p').textContent = '불러오기 실패';
    }
}

function renderProgressTable() {
    const tbody = document.getElementById('progressTableBody');
    tbody.innerHTML = '';

    progressSaves.forEach((save, idx) => {
        const components = save.completed_components || [];
        const totalComponents = getTotalComponentCount(save);
        const completedCount = components.length;
        const progressPct = totalComponents > 0 ? Math.round((completedCount / totalComponents) * 100) : 0;

        const statusLabel = {
            'in_progress': '진행중',
            'completed': '완료',
            'abandoned': '중단'
        }[save.status] || save.status;

        const statusClass = `status-${save.status || 'in_progress'}`;

        const taskTypeLabel = {
            'reading': '리딩',
            'listening': '리스닝',
            'vocab': '어휘',
            'speaking': '스피킹',
            'writing': '라이팅'
        }[save.task_type] || save.task_type || '-';

        const updatedAt = save.updated_at ? formatProgressDate(save.updated_at) : '-';
        const attempt = save.attempt || 1;

        // 메인 행
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.innerHTML = `
            <td style="width:30px; text-align:center;">
                <i class="fas fa-chevron-right" id="progressArrow_${idx}" style="color:#94a3b8; font-size:11px; transition:transform 0.2s;"></i>
            </td>
            <td><strong>${taskTypeLabel}</strong></td>
            <td>Module ${save.module_number || '-'}</td>
            <td>${attempt}차</td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="flex:1; background:#e2e8f0; border-radius:4px; height:6px; min-width:60px;">
                        <div style="background:${progressPct === 100 ? '#16a34a' : '#6366f1'}; height:100%; border-radius:4px; width:${progressPct}%;"></div>
                    </div>
                    <span style="font-size:12px; color:#64748b; white-space:nowrap;">${completedCount}/${totalComponents}</span>
                </div>
            </td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td style="font-size:12px; color:#64748b;">${updatedAt}</td>
            <td style="white-space:nowrap;" onclick="event.stopPropagation();">
                ${save.status === 'abandoned' ? `<button class="btn-restore" onclick="restoreProgress('${save.id}', ${idx})"><i class="fas fa-undo"></i> 복원</button> ` : ''}
                <button class="btn-delete-progress" onclick="deleteProgress('${save.id}', ${idx})"><i class="fas fa-trash-alt"></i> 삭제</button>
            </td>
        `;

        tr.addEventListener('click', () => toggleProgressDetail(idx));
        tbody.appendChild(tr);

        // 상세 패널 행 (숨김 상태)
        const detailTr = document.createElement('tr');
        detailTr.id = `progressDetail_${idx}`;
        detailTr.style.display = 'none';
        detailTr.innerHTML = `
            <td colspan="8" style="padding:0 12px 12px 12px;">
                <div class="progress-detail-panel">
                    ${renderProgressDetailContent(save, idx)}
                </div>
            </td>
        `;
        tbody.appendChild(detailTr);
    });
}

function getTotalComponentCount(save) {
    // completed_components 길이 + 남은 컴포넌트
    const completed = (save.completed_components || []).length;
    const currentIdx = save.current_component_index || 0;
    // total = max(completed, currentIdx) + 남은 것 추정
    // 정확한 total은 알 수 없으므로 current_component_index 기반 추정
    // completed가 currentIdx와 같거나 크면, 아직 풀지 않은 것이 있을 수 있음
    // total_components 필드가 있으면 사용
    if (save.total_components) return save.total_components;
    // 없으면 currentIdx 기반: completed + (status가 completed가 아니면 최소 1개 이상 남음)
    if (save.status === 'completed') return completed;
    // 진행중/중단이면 최소 completed + 1
    return Math.max(completed + 1, currentIdx + 1);
}

function renderProgressDetailContent(save, idx) {
    const components = save.completed_components || [];
    const currentIdx = save.current_component_index || 0;
    const totalComponents = getTotalComponentCount(save);
    const timerRemaining = save.timer_remaining || 0;
    const taskTypeLabel = {
        'reading': '리딩',
        'listening': '리스닝',
        'vocab': '어휘',
        'speaking': '스피킹',
        'writing': '라이팅'
    }[save.task_type] || save.task_type || '-';

    let html = '';
    html += `<div style="font-weight:600; margin-bottom:12px; color:#1e293b;">📋 상세 진행 정보</div>`;
    html += `<div style="color:#64748b; font-size:12px; margin-bottom:12px;">`;
    html += `과제: ${taskTypeLabel} Module ${save.module_number || '-'} / ${save.attempt || 1}차 풀이`;
    html += `<br>총 컴포넌트: ${totalComponents}개`;
    html += `</div>`;

    // 컴포넌트 목록 렌더링
    for (let i = 0; i < totalComponents; i++) {
        const comp = components[i];
        let icon, name, scoreText = '', extraClass = '';

        if (comp) {
            // 완료된 컴포넌트
            icon = '✅';
            name = formatComponentName(comp);
            const answers = comp.answers || [];
            if (answers.length > 0) {
                const correct = answers.filter(a => a.isCorrect).length;
                scoreText = `— ${correct}/${answers.length} 정답`;
            }
        } else if (i === currentIdx && save.status !== 'completed') {
            // 현재 진행중인 컴포넌트
            icon = '⏸️';
            name = `컴포넌트 ${i + 1}`;
            extraClass = '<span class="component-current">← 여기서 끊김</span>';
        } else {
            // 아직 안 한 컴포넌트
            icon = '⬜';
            name = `컴포넌트 ${i + 1}`;
        }

        html += `<div class="component-item">`;
        html += `<span class="component-icon">${icon}</span>`;
        html += `<span class="component-name">${i + 1}. ${name}</span>`;
        if (scoreText) html += `<span class="component-score">${scoreText}</span>`;
        if (extraClass) html += ` ${extraClass}`;
        html += `</div>`;
    }

    // 남은 타이머
    if (timerRemaining > 0) {
        const minutes = Math.floor(timerRemaining / 60);
        const seconds = timerRemaining % 60;
        html += `<div style="margin-top:12px; padding-top:12px; border-top:1px solid #e2e8f0; color:#64748b; font-size:12px;">`;
        html += `⏱ 남은 타이머: ${minutes}분 ${seconds}초`;
        html += `</div>`;
    }

    // 마지막 저장 시간
    if (save.updated_at) {
        html += `<div style="color:#94a3b8; font-size:11px; margin-top:8px;">`;
        html += `마지막 저장: ${new Date(save.updated_at).toLocaleString('ko-KR')}`;
        html += `</div>`;
    }

    return html;
}

function formatComponentName(comp) {
    if (!comp) return '알 수 없음';
    const type = comp.componentType || comp.component_type || '';
    const setId = comp.setId || comp.set_id || '';

    const typeLabels = {
        'fill_blank': '빈칸채우기',
        'fill-blank': '빈칸채우기',
        'fillBlank': '빈칸채우기',
        'casual_reading': '일상리딩',
        'casual-reading': '일상리딩',
        'casualReading': '일상리딩',
        'academic_reading': '아카데믹 리딩',
        'academic-reading': '아카데믹 리딩',
        'academicReading': '아카데믹 리딩',
        'casual_listening': '일상리스닝',
        'academic_listening': '아카데믹 리스닝',
        'vocab': '어휘',
        'speaking': '스피킹',
        'writing': '라이팅'
    };

    let label = typeLabels[type] || type || '컴포넌트';
    if (setId) label += ` (${setId})`;
    return label;
}

function formatProgressDate(dateStr) {
    try {
        const d = new Date(dateStr);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${month}/${day} ${hours}:${mins}`;
    } catch {
        return dateStr;
    }
}

function toggleProgressDetail(idx) {
    const detailRow = document.getElementById(`progressDetail_${idx}`);
    const arrow = document.getElementById(`progressArrow_${idx}`);

    if (detailRow.style.display === 'none') {
        detailRow.style.display = 'table-row';
        arrow.style.transform = 'rotate(90deg)';
    } else {
        detailRow.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
    }
}

async function restoreProgress(id, idx) {
    if (!confirm('이어하기 상태(in_progress)로 복원할까요?\n학생이 다시 이어서 풀 수 있게 됩니다.')) return;

    try {
        await supabaseAPI.patch('tr_progress_save', id, {
            status: 'in_progress',
            updated_at: new Date().toISOString()
        });
        alert('✅ 복원 완료! 학생이 이어하기 할 수 있습니다.');
        await loadProgressSaves();
    } catch (err) {
        console.error('Restore failed:', err);
        alert('❌ 복원 실패: ' + err.message);
    }
}

async function deleteProgress(id, idx) {
    if (!confirm('⚠️ 완전 삭제하면 학생이 처음부터 다시 풀어야 합니다.\n\n정말 삭제할까요?')) return;

    try {
        await supabaseAPI.hardDelete('tr_progress_save', id);
        alert('✅ 삭제 완료! 학생이 처음부터 새로 풀 수 있습니다.');
        await loadProgressSaves();
    } catch (err) {
        console.error('Delete failed:', err);
        alert('❌ 삭제 실패: ' + err.message);
    }
}
