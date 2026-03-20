// ===== 학생 학습 상세 V3 (admin-study-detail-v3.js) =====
// V3 테이블(study_results_v3, tr_schedule_assignment, tr_deadline_extensions) 기반

// ===== 전역 변수 =====
let studentData = null;      // { user, app }
let scheduleData = [];       // tr_schedule_assignment 전체
let studyResultsV3 = [];     // study_results_v3 해당 학생
let deadlineExtensionsData = []; // tr_deadline_extensions 해당 학생

// ===== 과제 타입 → 이모지/라벨 매핑 =====
const TASK_EMOJI_MAP = {
    'reading': { emoji: '\ud83d\udcd6', label: 'Reading' },
    'listening': { emoji: '\ud83c\udfa7', label: 'Listening' },
    'writing': { emoji: '\u270d\ufe0f', label: 'Writing' },
    'speaking': { emoji: '\ud83c\udfa4', label: 'Speaking' },
    'vocab': { emoji: '\ud83d\udcdd', label: '\ub0b4\ubca8\uc5c5\ubcf4\uce74' },
    'intro-book': { emoji: '\ud83d\udcd5', label: '\uc785\ubb38\uc11c \uc815\ub3c5' }
};

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

        // ── V3 데이터 로드 ──
        const studentUserId = studentData.user.id;

        // 병렬로 필요한 데이터 모두 로드
        const [scheduleResult, studyV3Result, deadlineResult, gradeRules] = await Promise.all([
            supabaseAPI.query('tr_schedule_assignment', { 'order': 'id.asc', 'limit': '500' }),
            supabaseAPI.query('study_results_v3', {
                'user_id': `eq.${studentUserId}`,
                'select': 'id,user_id,section_type,module_number,week,day,locked_auth_rate,error_note_submitted,initial_record,created_at',
                'limit': '1000'
            }),
            supabaseAPI.query('tr_deadline_extensions', {
                'user_id': `eq.${studentUserId}`,
                'order': 'original_date.desc',
                'limit': '200'
            }),
            loadGradeRules()
        ]);

        scheduleData = scheduleResult || [];
        studyResultsV3 = studyV3Result || [];
        deadlineExtensionsData = deadlineResult || [];

        // 렌더링
        loading.style.display = 'none';
        detailContent.style.display = 'block';

        renderProfileHeader();
        renderV3SummaryCards();
        loadDeadlineExtensions();  // 데드라인 연장 건수 배지 표시용

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

// ===== 오답노트 모달 =====

// ===== V3 요약 카드 렌더링 (메인 함수) =====
function renderV3SummaryCards() {
    const { app } = studentData;
    const effectiveToday = getEffectiveToday();
    const programType = getProgram(app);
    const totalWeeks = getTotalWeeks(app);
    const totalDays = programType === 'Fast' ? 28 : 56;
    const startDate = getScheduleStart(app);
    const depositAmount = app.deposit_amount || 100000;

    renderCardTodayTasks(effectiveToday, programType, startDate, totalWeeks);
    renderCardChallenge(effectiveToday, startDate, totalDays);
    renderCardAuthRate(effectiveToday, programType, startDate, totalWeeks);
    renderCardGrade(effectiveToday, programType, startDate, totalWeeks, depositAmount);
}

// ===== 카드1: 오늘의 과제 =====
function renderCardTodayTasks(effectiveToday, programType, startDate, totalWeeks) {
    const el = document.getElementById('cardTodayTasks');

    // 시작 전
    if (!startDate || effectiveToday < startDate) {
        const startStr = startDate ? formatCardDate(startDate) : '-';
        el.innerHTML = `
            <div class="card-prestart-msg">
                <i class="fas fa-hourglass-start" style="color:#3b82f6;"></i><br>
                <span style="font-size:14px; font-weight:700; color:#3b82f6;">${startStr} 시작</span>
            </div>`;
        return;
    }

    // 주차/요일 계산
    const diffDays = Math.floor((effectiveToday - startDate) / (1000 * 60 * 60 * 24));
    const weekNum = Math.floor(diffDays / 7) + 1;
    const dayIndex = effectiveToday.getUTCDay(); // 0=일, 1=월...

    // 챌린지 종료 후
    if (weekNum > totalWeeks) {
        el.innerHTML = `<div class="card-prestart-msg"><i class="fas fa-check-circle" style="color:#22c55e;"></i><br>챌린지 완료!</div>`;
        return;
    }

    // 토요일(6)은 휴무
    if (dayIndex === 6) {
        el.innerHTML = `<div class="task-rest-msg"><i class="fas fa-couch"></i> 오늘은 휴무일</div>`;
        return;
    }

    const dayEngNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayEn = dayEngNames[dayIndex];

    // tr_schedule_assignment에서 오늘 과제 가져오기
    const prog = programType.toLowerCase();
    const todaySchedule = scheduleData.find(s =>
        (s.program || '').toLowerCase() === prog &&
        s.week === weekNum &&
        s.day === dayEn
    );

    if (!todaySchedule) {
        el.innerHTML = `<div class="task-rest-msg"><i class="fas fa-couch"></i> 오늘은 휴무일</div>`;
        return;
    }

    // section1~4 파싱
    const tasks = [];
    for (const sec of [todaySchedule.section1, todaySchedule.section2, todaySchedule.section3, todaySchedule.section4]) {
        const parsed = parseScheduleSection(sec);
        if (parsed && parsed.taskType !== 'unknown') {
            const info = TASK_EMOJI_MAP[parsed.taskType] || { emoji: '\ud83d\udccc', label: parsed.taskType };
            const moduleStr = parsed.moduleNumber ? ` M${parsed.moduleNumber}` : '';
            tasks.push({ emoji: info.emoji, label: `${info.label}${moduleStr}` });
        }
    }

    if (tasks.length === 0) {
        el.innerHTML = `<div class="task-rest-msg"><i class="fas fa-couch"></i> 오늘은 휴무일</div>`;
        return;
    }

    let html = '<div class="task-list-items">';
    tasks.forEach(t => {
        html += `<div class="task-item"><span class="task-emoji">${t.emoji}</span> ${escapeHtml(t.label)}</div>`;
    });
    html += '</div>';
    html += `<div class="task-count-badge"><i class="fas fa-tasks"></i> 총 ${tasks.length}개 과제</div>`;

    el.innerHTML = html;
}

// ===== 카드2: 챌린지 현황 =====
function renderCardChallenge(effectiveToday, startDate, totalDays) {
    const el = document.getElementById('cardChallenge');

    // 시작 전
    if (!startDate || effectiveToday < startDate) {
        const daysUntil = startDate ? Math.ceil((startDate - effectiveToday) / (1000 * 60 * 60 * 24)) : '?';
        const startStr = startDate ? formatCardDate(startDate) : '-';
        el.innerHTML = `
            <div style="text-align:center;">
                <div class="challenge-dplus">D-${daysUntil}</div>
                <div style="font-size:12px; color:#a78bfa; margin-top:6px; font-weight:600;">${startStr} 시작</div>
                <div class="challenge-bar-wrap"><div class="challenge-bar" style="width:0%;"></div></div>
                <div class="challenge-sub"><span>대기 중</span><span>총 ${totalDays}일</span></div>
            </div>`;
        return;
    }

    const dplus = Math.floor((effectiveToday - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const elapsed = Math.min(dplus, totalDays);
    const remainingDays = Math.max(0, totalDays - elapsed);
    const elapsedPct = Math.min(100, Math.round((elapsed / totalDays) * 100));
    const startStr = formatCardDate(startDate);

    // 완료 후
    const isComplete = dplus > totalDays;

    el.innerHTML = `
        <div style="text-align:center;">
            <div class="challenge-dplus">
                D+${isComplete ? totalDays : dplus}
                <small>/ ${totalDays}일</small>
            </div>
            <div class="challenge-bar-wrap">
                <div class="challenge-bar" style="width:${elapsedPct}%;${isComplete ? ' background:linear-gradient(90deg,#22c55e,#4ade80);' : ''}"></div>
            </div>
            <div class="challenge-sub">
                <span>${isComplete ? '\u2705 \ucc4c\ub9b0\uc9c0 \uc644\ub8cc' : `\ub0a8\uc740 ${remainingDays}\uc77c`}</span>
                <span>${startStr} ~</span>
            </div>
        </div>`;
}

// ===== 카드3: 인증률 =====
function renderCardAuthRate(effectiveToday, programType, startDate, totalWeeks) {
    const el = document.getElementById('cardAuthRate');

    // 시작 전
    if (!startDate || effectiveToday < startDate) {
        el.innerHTML = `
            <div style="text-align:center;">
                <div class="auth-rate-value" style="color:#94a3b8;">-<span>%</span></div>
                <div class="auth-bar-wrap"><div class="auth-bar" style="width:0%; background:#e2e8f0;"></div></div>
                <div class="auth-sub">시작 전</div>
            </div>`;
        return;
    }

    // study_results_v3에서 인증률 분자 계산
    // locked_auth_rate가 있으면 사용, 없으면 initial_record 존재시 50 (error_note_submitted이면 100), 아니면 0
    let authRateSum = 0;
    for (const r of studyResultsV3) {
        if (r.locked_auth_rate != null) {
            authRateSum += r.locked_auth_rate;
        } else if (r.initial_record) {
            // 초기 기록이 있으면 50, 오답노트 제출했으면 100
            authRateSum += r.error_note_submitted ? 100 : 50;
        }
        // initial_record 없으면 0 (미제출)
    }

    // 인증률 분모 계산: 도래한 과제 수 (tr_deadline_extensions 적용)
    const tasksDueToday = countDueTasks(effectiveToday, programType, startDate, totalWeeks);

    const authRate = tasksDueToday > 0 ? Math.round(authRateSum / tasksDueToday) : 0;
    const barColor = authRate >= 90 ? '#10b981' : authRate >= 70 ? '#f59e0b' : '#ef4444';

    el.innerHTML = `
        <div style="text-align:center;">
            <div class="auth-rate-value" style="color:${barColor};">${authRate}<span>%</span></div>
            <div class="auth-bar-wrap"><div class="auth-bar" style="width:${Math.min(100, authRate)}%; background:${barColor};"></div></div>
            <div class="auth-sub">인증 ${authRateSum.toLocaleString()} / 과제 ${tasksDueToday}개</div>
        </div>`;
}

// ===== 카드4: 등급 & 환급 =====
function renderCardGrade(effectiveToday, programType, startDate, totalWeeks, depositAmount) {
    const el = document.getElementById('cardGrade');

    // 시작 전
    if (!startDate || effectiveToday < startDate) {
        el.innerHTML = `
            <div style="text-align:center;">
                <div class="grade-badge-lg" style="background:#cbd5e1;">-</div>
                <div class="grade-sub">시작 후 산정</div>
            </div>`;
        return;
    }

    // 인증률 재계산 (카드3과 동일 로직)
    let authRateSum = 0;
    for (const r of studyResultsV3) {
        if (r.locked_auth_rate != null) {
            authRateSum += r.locked_auth_rate;
        } else if (r.initial_record) {
            authRateSum += r.error_note_submitted ? 100 : 50;
        }
    }
    const tasksDueToday = countDueTasks(effectiveToday, programType, startDate, totalWeeks);
    const authRate = tasksDueToday > 0 ? Math.round(authRateSum / tasksDueToday) : 0;

    // 등급 판정
    const rules = gradeRulesCache || [];
    let grade = '-', refundRate = 0, refundAmount = 0;

    if (rules.length > 0) {
        for (const rule of rules) {
            if (authRate >= rule.min_rate) {
                grade = rule.grade;
                refundRate = rule.refund_rate || 0;
                // refund_rate가 1 이하면 비율(0.9 = 90%), 100 초과면 퍼센트로 처리
                if (refundRate > 1) {
                    refundAmount = Math.round(depositAmount * refundRate / 100);
                } else {
                    refundAmount = Math.round(depositAmount * refundRate);
                }
                break;
            }
        }
        if (grade === '-') {
            grade = 'F'; refundRate = 0; refundAmount = 0;
        }
    }

    const gradeColor = getGradeColor(grade);

    el.innerHTML = `
        <div style="text-align:center;">
            <div class="grade-badge-lg" style="background:${gradeColor};">${grade}</div>
            <div class="grade-refund">
                환급 <span class="grade-refund-amount">${refundAmount.toLocaleString()}원</span>
            </div>
            <div class="grade-sub">보증금 ${depositAmount.toLocaleString()}원 / ${Math.round((refundRate > 1 ? refundRate : refundRate * 100))}% 환급</div>
        </div>`;
}

// ===== 도래 과제 수 계산 (tr_deadline_extensions 적용) =====
function countDueTasks(effectiveToday, programType, startDate, totalWeeks) {
    const prog = programType.toLowerCase();
    const progSchedule = (scheduleData || []).filter(s => (s.program || '').toLowerCase() === prog);

    // deadline extensions를 날짜 키로 매핑
    const extMap = {};
    (deadlineExtensionsData || []).forEach(ext => {
        if (ext.original_date) extMap[ext.original_date] = ext.extra_days || 0;
    });

    let count = 0;
    const dayEngNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    for (const s of progSchedule) {
        if (s.week > totalWeeks) continue;
        const dayIndex = DAY_ENG_TO_INDEX[s.day];
        if (dayIndex === undefined) continue;

        // 해당 과제의 날짜 계산
        const taskDate = new Date(startDate);
        taskDate.setUTCDate(taskDate.getUTCDate() + (s.week - 1) * 7 + dayIndex);

        // effectiveToday 이후면 아직 도래하지 않음
        if (taskDate > effectiveToday) continue;

        // deadline extension 체크: 연장된 날짜의 과제는 분모에서 제외하지 않음
        // (인증률 분모는 모든 도래 과제를 포함, 연장은 마감만 늦춤)
        const dateStr = toDateStr(taskDate);

        // section1~4 중 유효한 과제 수 세기
        for (const sec of [s.section1, s.section2, s.section3, s.section4]) {
            const parsed = parseScheduleSection(sec);
            if (parsed && parsed.taskType !== 'unknown') {
                count++;
            }
        }
    }

    return count;
}

// ===== 카드용 날짜 포맷 =====
function formatCardDate(date) {
    if (!date) return '-';
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const dayNames = ['\uc77c', '\uc6d4', '\ud654', '\uc218', '\ubaa9', '\uae08', '\ud1a0'];
    const dayName = dayNames[date.getUTCDay()];
    return `${m}/${d} (${dayName})`;
}

// ===== 오답노트 모달 =====
function openNoteModal(title, body, meta) {
    const modal = document.getElementById('noteModal');
    document.getElementById('modalNoteTitle').textContent = title || '오답노트 / 메모';
    document.getElementById('modalNoteBody').textContent = body || '(내용 없음)';
    document.getElementById('modalNoteMeta').textContent = meta || '';

    modal.classList.add('active');
    modal.onclick = (e) => {
        if (e.target === modal) closeNoteModal();
    };
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.remove('active');
}

// ===== 스피킹 녹음 재생 =====
function playSpeaking(filePath, label) {
    const audioUrl = `${SUPABASE_URL}/storage/v1/object/public/speaking-files/${filePath}`;

    let modal = document.getElementById('speakingAudioModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'speakingAudioModal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1100; display:flex; align-items:center; justify-content:center;';
    modal.innerHTML = `
        <div style="background:white; border-radius:16px; padding:24px; min-width:340px; max-width:480px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div style="font-weight:700; font-size:15px; color:#1e293b;">
                    <i class="fas fa-volume-up" style="color:#16a34a;"></i> ${escapeHtml(label)}
                </div>
                <button onclick="closeSpeakingModal()" style="background:none; border:none; cursor:pointer; font-size:18px; color:#94a3b8; padding:4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <audio controls autoplay style="width:100%;" controlsList="nodownload">
                <source src="${escapeHtml(audioUrl)}" type="audio/webm">
                <source src="${escapeHtml(audioUrl)}" type="audio/mp4">
                <source src="${escapeHtml(audioUrl)}" type="audio/mpeg">
                브라우저가 오디오 재생을 지원하지 않습니다.
            </audio>
            <div style="margin-top:10px; font-size:11px; color:#94a3b8; word-break:break-all;">${escapeHtml(filePath)}</div>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSpeakingModal();
    });

    document.body.appendChild(modal);
}

function closeSpeakingModal() {
    const modal = document.getElementById('speakingAudioModal');
    if (modal) {
        const audio = modal.querySelector('audio');
        if (audio) { audio.pause(); audio.src = ''; }
        modal.remove();
    }
}

// ===== 데드라인 연장 관리 =====
let deadlineExtensions = [];

function toggleDeadlineSection() {
    const body = document.getElementById('deadlineBody');
    const icon = document.getElementById('deadlineToggleIcon');
    const btn = document.getElementById('deadlineToggleBtn');
    const isOpen = body.classList.toggle('open');
    icon.className = isOpen ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
    btn.innerHTML = `<i class="${icon.className}"></i> ${isOpen ? '접기' : '펼치기'}`;

    if (isOpen && deadlineExtensions.length === 0) {
        loadDeadlineExtensions();
    }
}

async function loadDeadlineExtensions() {
    if (!studentData || !studentData.user) return;
    const userId = studentData.user.id;

    try {
        const result = await supabaseAPI.query('tr_deadline_extensions', {
            'user_id': `eq.${userId}`,
            'order': 'original_date.desc',
            'limit': '200'
        });
        deadlineExtensions = result || [];
        renderDeadlineList();
        updateDeadlineCount();
    } catch (err) {
        console.error('데드라인 연장 로드 실패:', err);
        document.getElementById('deadlineListWrap').innerHTML =
            '<div class="deadline-empty"><i class="fas fa-exclamation-triangle"></i> 로드 실패</div>';
    }
}

function updateDeadlineCount() {
    const badge = document.getElementById('deadlineCount');
    if (deadlineExtensions.length > 0) {
        badge.textContent = `${deadlineExtensions.length}건`;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderDeadlineList() {
    const wrap = document.getElementById('deadlineListWrap');

    if (deadlineExtensions.length === 0) {
        wrap.innerHTML = '<div class="deadline-empty"><i class="fas fa-check-circle" style="color:#22c55e;"></i> 등록된 연장이 없습니다.</div>';
        return;
    }

    let html = `<table class="deadline-list-table">
        <thead><tr>
            <th>과제 날짜</th>
            <th>연장 일수</th>
            <th>사유</th>
            <th>등록일</th>
            <th style="width:60px; text-align:center;">삭제</th>
        </tr></thead><tbody>`;

    deadlineExtensions.forEach(ext => {
        const date = ext.original_date || '-';
        const days = ext.extra_days || 1;
        const reason = ext.reason || '-';
        const created = ext.created_at
            ? new Date(ext.created_at).toLocaleDateString('ko-KR')
            : '-';

        html += `<tr>
            <td style="font-family:monospace; font-weight:600;">${escapeHtml(date)}</td>
            <td><span style="color:#7c3aed; font-weight:700;">+${days}일</span></td>
            <td style="color:#64748b;">${escapeHtml(reason)}</td>
            <td style="color:#94a3b8; font-size:12px;">${created}</td>
            <td style="text-align:center;">
                <button class="btn-deadline-del" onclick="deleteDeadlineExtension('${ext.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

async function addDeadlineExtension() {
    if (!studentData || !studentData.user) return;
    const userId = studentData.user.id;

    const dateEl = document.getElementById('dlDate');
    const daysEl = document.getElementById('dlDays');
    const reasonEl = document.getElementById('dlReason');
    const btn = document.getElementById('dlAddBtn');

    const originalDate = dateEl.value;
    const extraDays = parseInt(daysEl.value) || 1;
    const reason = reasonEl.value.trim();

    if (!originalDate) {
        alert('과제 날짜를 선택해주세요.');
        dateEl.focus();
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';

    try {
        const existing = await supabaseAPI.query('tr_deadline_extensions', {
            'user_id': `eq.${userId}`,
            'original_date': `eq.${originalDate}`,
            'limit': '1'
        });

        if (existing && existing.length > 0) {
            await supabaseAPI.patch('tr_deadline_extensions', existing[0].id, {
                extra_days: extraDays,
                reason: reason || null
            });
            alert(`✅ ${originalDate} 연장이 +${extraDays}일로 수정되었습니다.`);
        } else {
            await supabaseAPI.post('tr_deadline_extensions', {
                id: crypto.randomUUID(),
                user_id: userId,
                original_date: originalDate,
                extra_days: extraDays,
                reason: reason || null
            });
            alert(`✅ ${originalDate} +${extraDays}일 연장 등록 완료!`);
        }

        dateEl.value = '';
        reasonEl.value = '';
        daysEl.value = '1';

        await loadDeadlineExtensions();
    } catch (err) {
        console.error('연장 등록 실패:', err);
        alert('❌ 등록 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus"></i> 연장 등록';
    }
}

async function deleteDeadlineExtension(id) {
    if (!confirm('이 연장을 삭제하시겠습니까?\n삭제하면 학생의 마감이 원래대로 돌아갑니다.')) return;

    try {
        await supabaseAPI.hardDelete('tr_deadline_extensions', id);
        alert('✅ 연장 삭제 완료!');
        await loadDeadlineExtensions();
    } catch (err) {
        console.error('연장 삭제 실패:', err);
        alert('❌ 삭제 실패: ' + err.message);
    }
}

// ===== 학생 알림 발송 =====
let notifList = [];
let notifLoaded = false;

function toggleNotifSection() {
    const body = document.getElementById('notifBody');
    const icon = document.getElementById('notifToggleIcon');
    const btn = document.getElementById('notifToggleBtn');
    const isOpen = body.classList.toggle('open');
    icon.className = isOpen ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
    btn.innerHTML = `<i class="${icon.className}"></i> ${isOpen ? '접기' : '펼치기'}`;

    if (isOpen && !notifLoaded) {
        loadNotifications();
    }
}

async function loadNotifications() {
    if (!studentData || !studentData.user) return;
    const userId = studentData.user.id;

    try {
        const result = await supabaseAPI.query('tr_notifications', {
            'user_id': `eq.${userId}`,
            'order': 'created_at.desc',
            'limit': '100'
        });
        notifList = result || [];
        notifLoaded = true;
        renderNotifList();
        updateNotifCount();
    } catch (err) {
        console.error('알림 목록 로드 실패:', err);
        document.getElementById('notifListWrap').innerHTML =
            '<div class="notif-empty"><i class="fas fa-exclamation-triangle"></i> 로드 실패</div>';
    }
}

function updateNotifCount() {
    const badge = document.getElementById('notifCount');
    if (notifList.length > 0) {
        badge.textContent = `${notifList.length}건`;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderNotifList() {
    const wrap = document.getElementById('notifListWrap');

    if (notifList.length === 0) {
        wrap.innerHTML = '<div class="notif-empty"><i class="fas fa-bell-slash" style="color:#cbd5e1;"></i> 발송된 알림이 없습니다.</div>';
        return;
    }

    let html = `<table class="notif-list-table">
        <thead><tr>
            <th>발송일</th>
            <th>제목</th>
            <th>본문 미리보기</th>
            <th>읽음</th>
            <th>발송자</th>
            <th style="width:60px; text-align:center;">수정</th>
            <th style="width:60px; text-align:center;">삭제</th>
        </tr></thead><tbody>`;

    notifList.forEach(n => {
        const created = n.created_at
            ? new Date(n.created_at).toLocaleString('ko-KR', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
              })
            : '-';
        const title = n.title || '-';
        const msgPreview = (n.message || '').replace(/\n/g, ' ').substring(0, 50);
        const readBadge = n.is_read
            ? '<span class="notif-badge-read"><i class="fas fa-check-circle"></i> 읽음</span>'
            : '<span class="notif-badge-unread"><i class="fas fa-clock"></i> 안읽음</span>';
        const createdBy = n.created_by || '-';

        html += `<tr>
            <td style="font-size:12px; color:#94a3b8; white-space:nowrap;">${created}</td>
            <td style="font-weight:600;">${escapeHtml(title)}</td>
            <td style="color:#64748b; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(msgPreview)}${(n.message || '').length > 50 ? '…' : ''}</td>
            <td>${readBadge}</td>
            <td style="font-size:12px; color:#94a3b8;">${escapeHtml(createdBy)}</td>
            <td style="text-align:center;">
                <button class="btn-notif-edit" onclick="editNotification('${n.id}')">
                    <i class="fas fa-pen"></i>
                </button>
            </td>
            <td style="text-align:center;">
                <button class="btn-notif-del" onclick="deleteNotification('${n.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

async function sendNotification() {
    if (!studentData || !studentData.user) {
        alert('학생 데이터가 로드되지 않았습니다.');
        return;
    }
    const userId = studentData.user.id;

    const titleEl = document.getElementById('notifTitle');
    const messageEl = document.getElementById('notifMessage');
    const createdByEl = document.getElementById('notifCreatedBy');
    const btn = document.getElementById('notifSendBtn');

    const title = titleEl.value.trim();
    const message = messageEl.value.trim();
    const createdBy = createdByEl.value.trim() || '이온쌤';

    if (!title) {
        alert('제목을 입력해주세요.');
        titleEl.focus();
        return;
    }
    if (!message) {
        alert('본문을 입력해주세요.');
        messageEl.focus();
        return;
    }

    const studentName = studentData.user.name || '학생';
    if (!confirm(`"${studentName}"에게 알림을 발송합니다.\n\n제목: ${title}\n\n계속하시겠습니까?`)) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 발송 중...';

    try {
        await supabaseAPI.post('tr_notifications', {
            user_id: userId,
            title: title,
            message: message,
            created_by: createdBy
        });

        alert(`✅ "${studentName}"에게 알림 발송 완료!`);

        titleEl.value = '';
        messageEl.value = '';

        await loadNotifications();
    } catch (err) {
        console.error('알림 발송 실패:', err);
        alert('❌ 발송 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> 발송';
    }
}

function editNotification(id) {
    const n = notifList.find(x => x.id === id);
    if (!n) return alert('알림을 찾을 수 없습니다.');

    const existing = document.getElementById('notifEditModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'notifEditModal';
    modal.className = 'notif-edit-overlay';
    modal.innerHTML = `
        <div class="notif-edit-modal">
            <div class="notif-edit-header">
                <h3><i class="fas fa-pen"></i> 알림 수정</h3>
                <button class="notif-edit-close" onclick="closeEditModal()">&times;</button>
            </div>
            <div class="notif-edit-body">
                <div class="field">
                    <label>제목</label>
                    <input type="text" id="editNotifTitle" value="${escapeHtml(n.title || '')}">
                </div>
                <div class="field">
                    <label>본문</label>
                    <textarea id="editNotifMessage" rows="6">${escapeHtml(n.message || '')}</textarea>
                </div>
            </div>
            <div class="notif-edit-footer">
                <button class="btn-notif-cancel" onclick="closeEditModal()">취소</button>
                <button class="btn-notif-save" id="editNotifSaveBtn" onclick="saveNotification('${n.id}')">
                    <i class="fas fa-check"></i> 저장
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEditModal(); });
    document.getElementById('editNotifTitle').focus();
}

function closeEditModal() {
    const modal = document.getElementById('notifEditModal');
    if (modal) modal.remove();
}

async function saveNotification(id) {
    const title = document.getElementById('editNotifTitle').value.trim();
    const message = document.getElementById('editNotifMessage').value.trim();
    const btn = document.getElementById('editNotifSaveBtn');

    if (!title) return alert('제목을 입력해주세요.');
    if (!message) return alert('본문을 입력해주세요.');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

    try {
        await supabaseAPI.patch('tr_notifications', id, { title, message });
        alert('✅ 알림이 수정되었습니다!');
        closeEditModal();
        await loadNotifications();
    } catch (err) {
        console.error('알림 수정 실패:', err);
        alert('❌ 수정 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> 저장';
    }
}

async function deleteNotification(id) {
    if (!confirm('이 알림을 삭제하시겠습니까?\n삭제하면 학생 화면에서도 사라집니다.')) return;

    try {
        await supabaseAPI.hardDelete('tr_notifications', id);
        alert('✅ 알림 삭제 완료!');
        await loadNotifications();
    } catch (err) {
        console.error('알림 삭제 실패:', err);
        alert('❌ 삭제 실패: ' + err.message);
    }
}
