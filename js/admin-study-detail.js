// ===== 학생 학습 상세 (admin-study-detail.js) =====

// 전역 변수
let studentData = null;      // { user, app, records, authRecords }
let allTaskRows = [];         // 과제 테이블용 가공 데이터
let filteredTaskRows = [];    // 필터링된 과제 데이터

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

        // 렌더링
        loading.style.display = 'none';
        detailContent.style.display = 'block';

        renderProfileHeader();
        renderSummaryCards();
        renderGrassGrid();
        buildTaskRows();
        renderTaskTable();
        renderNotes();
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

// ===== 요약 카드 5개 =====
function renderSummaryCards() {
    const { app, records, authRecords } = studentData;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const totalWeeks = getTotalWeeks(app);
    const currentWeek = getCurrentWeek(app);
    const start = getScheduleStart(app);

    // ── 마감 과제 수 계산 ──
    const tasksPerDay = 4;
    const daysPerWeek = 6; // 일~금
    const elapsedWeeks = Math.min(currentWeek, totalWeeks);
    const dayOfWeek = today.getDay(); // 0=일, 1=월, ..., 5=금, 6=토
    // 일요일 시작 기준: 일=1일차, 월=2, 화=3, 수=4, 목=5, 금=6, 토=0(쉬는날)
    const daysThisWeek = currentWeek <= totalWeeks
        ? (dayOfWeek === 6 ? daysPerWeek : dayOfWeek + 1)  // 토=6일 다 지남, 일~금=dayOfWeek+1
        : 0;
    const clampedDaysThisWeek = Math.min(daysThisWeek, daysPerWeek);
    const completedDays = (Math.max(0, elapsedWeeks - 1) * daysPerWeek) + clampedDaysThisWeek;
    const totalDeadlinedTasks = completedDays * tasksPerDay;

    // ── 인증률 ──
    const totalAuthRate = authRecords.reduce((sum, r) => sum + (r.auth_rate || 0), 0);
    const avgAuthRate = totalDeadlinedTasks > 0 ? Math.round(totalAuthRate / totalDeadlinedTasks) : 0;

    // ── 등급 ──
    let grade = 'D', gradeColor = '#ef4444';
    if (avgAuthRate >= 90) { grade = 'A'; gradeColor = '#22c55e'; }
    else if (avgAuthRate >= 75) { grade = 'B'; gradeColor = '#3b82f6'; }
    else if (avgAuthRate >= 60) { grade = 'C'; gradeColor = '#f59e0b'; }

    // ── 환급 예상 ──
    const deposit = app.deposit_amount || app.final_price || 0;
    const refundRates = { A: 1.0, B: 0.8, C: 0.5, D: 0 };
    const expectedRefund = Math.round(deposit * (refundRates[grade] || 0));

    // ── 잔여일 ──
    const end = getScheduleEnd(app);
    const remainingDays = end ? Math.max(0, Math.ceil((end - today) / (1000 * 60 * 60 * 24))) : '-';

    // ── 제출률 ──
    const submittedTasks = records.length;
    const submitRate = totalDeadlinedTasks > 0 ? Math.round((submittedTasks / totalDeadlinedTasks) * 100) : 0;

    const container = document.getElementById('summaryCards');
    container.innerHTML = `
        <!-- 인증률 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:${avgAuthRate >= 75 ? '#dcfce7' : avgAuthRate >= 60 ? '#fef3c7' : '#fef2f2'}; color:${avgAuthRate >= 75 ? '#22c55e' : avgAuthRate >= 60 ? '#f59e0b' : '#ef4444'};">
                <i class="fas fa-shield-alt"></i>
            </div>
            <div class="stat-value" style="color:${avgAuthRate >= 75 ? '#22c55e' : avgAuthRate >= 60 ? '#f59e0b' : '#ef4444'};">${avgAuthRate}%</div>
            <div class="stat-label">인증률</div>
            <div class="stat-sub">인증 합계 ${totalAuthRate} / 마감 ${totalDeadlinedTasks}건</div>
        </div>

        <!-- 등급 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:${gradeColor}20; color:${gradeColor};">
                <i class="fas fa-award"></i>
            </div>
            <div class="stat-value" style="color:${gradeColor};">${grade}</div>
            <div class="stat-label">현재 등급</div>
            <div class="stat-sub">A≥90 B≥75 C≥60 D&lt;60</div>
        </div>

        <!-- 환급 예상 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:#dbeafe; color:#3b82f6;">
                <i class="fas fa-coins"></i>
            </div>
            <div class="stat-value">${expectedRefund > 0 ? expectedRefund.toLocaleString() : '0'}</div>
            <div class="stat-label">환급 예상 (원)</div>
            <div class="stat-sub">보증금 ${deposit.toLocaleString()}원 × ${Math.round((refundRates[grade] || 0) * 100)}%</div>
        </div>

        <!-- 잔여일 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:#faf5ff; color:#7c3aed;">
                <i class="fas fa-hourglass-half"></i>
            </div>
            <div class="stat-value">${remainingDays}</div>
            <div class="stat-label">잔여일</div>
            <div class="stat-sub">${currentWeek}/${totalWeeks}주차 진행 중</div>
        </div>

        <!-- 제출률 -->
        <div class="detail-stat-card">
            <div class="stat-icon" style="background:#ecfdf5; color:#10b981;">
                <i class="fas fa-clipboard-check"></i>
            </div>
            <div class="stat-value">${submitRate}%</div>
            <div class="stat-label">제출률</div>
            <div class="stat-sub">제출 ${submittedTasks} / 마감 ${totalDeadlinedTasks}건</div>
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
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // 요일 라벨
    let html = `<div class="grass-day-labels">`;
    const dayLabels = ['일', '월', '화', '수', '목', '금'];
    dayLabels.forEach(d => { html += `<div class="grass-day-label">${d}</div>`; });
    html += `</div>`;

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

            if (cellDate > today) {
                // 미도래
                html += `<div class="grass-cell grass-pending" data-tooltip="${dateStr} (${dayName}) 미도래">⬜</div>`;
                continue;
            }

            // 해당 날짜의 과제 수
            const dayRecords = records.filter(r => {
                return toDateStr(new Date(r.completed_at)) === dateStr;
            });
            const uniqueTypes = new Set(dayRecords.map(r => r.task_type));
            const count = uniqueTypes.size;

            if (count >= 4) {
                html += `<div class="grass-cell grass-done" data-tooltip="${dateStr} (${dayName}) ${count}종 완료">✅</div>`;
            } else if (count > 0) {
                html += `<div class="grass-cell grass-partial" data-tooltip="${dateStr} (${dayName}) ${count}/4종 제출">${count}</div>`;
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
            hasNote: !!(r.error_note_text && r.error_note_text.trim()),
            noteText: r.error_note_text || '',
            noteWordCount: r.error_note_word_count || 0,
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
        if (n.isFraud) tags.push('<span class="tag tag-fraud">⚠️ Fraud</span>');
        if (n.noteWordCount < 20) tags.push('<span class="tag tag-short">짧은 노트</span>');

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
    const today = new Date(); today.setHours(0, 0, 0, 0);

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

    // 일별 통계
    const dailyStats = [];
    for (let d = 0; d < 6; d++) {
        const cellDate = new Date(weekStart);
        cellDate.setDate(cellDate.getDate() + d);
        const dateStr = toDateStr(cellDate);
        const dayName = DAY_NAMES[cellDate.getDay()];

        if (cellDate > today) {
            dailyStats.push({ dateStr, dayName, status: '미도래', count: 0 });
            continue;
        }

        const dayRecs = weekRecords.filter(r => toDateStr(new Date(r.completed_at)) === dateStr);
        const types = new Set(dayRecs.map(r => r.task_type));
        const status = types.size >= 4 ? '✅ 완료' : types.size > 0 ? `🟨 ${types.size}/4` : '❌ 미제출';
        dailyStats.push({ dateStr, dayName, status, count: types.size });
    }

    // 주차 인증률 합계
    const weekAuthTotal = weekAuth.reduce((s, r) => s + (r.auth_rate || 0), 0);
    const weekTasksDue = dailyStats.filter(d => d.status !== '미도래').length * 4;
    const weekAuthRate = weekTasksDue > 0 ? Math.round(weekAuthTotal / weekTasksDue) : 0;

    // 오답노트 작성 수
    const weekNotes = weekRecords.filter(r => r.error_note_text && r.error_note_text.trim()).length;

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
    });
    text += `\n`;
    text += `── 주간 요약 ──\n`;
    text += `  제출 과제: ${weekRecords.length}건\n`;
    text += `  인증률 합계: ${weekAuthTotal} / 마감 ${weekTasksDue}건 → ${weekAuthRate}%\n`;
    text += `  오답노트: ${weekNotes}건 작성\n`;
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
