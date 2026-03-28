// ===== 학생 학습 상세 V3 (admin-study-detail-v3.js) =====
// V3 테이블(study_results_v3, tr_schedule_assignment, tr_deadline_extensions) 기반

// ===== 전역 변수 =====
let studentData = null;      // { user, app }
let scheduleData = [];       // tr_schedule_assignment 전체
let studyResultsV3 = [];     // study_results_v3 해당 학생
let deadlineExtensionsData = []; // tr_deadline_extensions 해당 학생

// ===== 입문서 총 페이지 수 (추후 DB에서 자동 조회로 교체 예정) =====
const INTRO_BOOK_TOTAL_PAGES = 300;

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
                'select': 'id,user_id,section_type,module_number,week,day,initial_record,initial_level,locked_auth_rate,error_note_submitted,error_note_text,completed_at,speaking_file_1,writing_email_text,writing_discussion_text,rewrite_record',
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
        renderPracticeSection();
        renderV3SummaryCards();
        await renderStudyRecordTable();
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

    // 수강 상태 뱃지
    const liveStatus = getAppLiveStatus(app);
    const badgeEl = document.getElementById('studentStatusBadge');
    if (badgeEl && liveStatus) {
        badgeEl.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600; background:${liveStatus.bg}; color:${liveStatus.color};"><i class="fas ${liveStatus.icon}"></i> ${liveStatus.label}</span>`;
    }

    // 신청서 관리 버튼
    if (app.id) {
        const btn = document.getElementById('btnManageApp');
        btn.style.display = 'inline-flex';
        btn.onclick = () => { window.location.href = `admin-applications.html?manage=${app.id}`; };
    }
}

// ===== 연습코스 관리 =====

function renderPracticeSection() {
    const { app } = studentData;
    const section = document.getElementById('practiceSection');
    if (!section) return;

    // 섹션 표시
    section.style.display = 'block';

    const practiceEnabled = app.practice_enabled === true;
    const disabledManually = app.practice_disabled_manually === true;
    const scheduleEnd = app.schedule_end ? new Date(app.schedule_end) : null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isEnded = scheduleEnd && scheduleEnd < today;

    // 세그먼트 버튼 상태 반영
    updatePracticeSegment(practiceEnabled);

    // 상태 정보 렌더링
    const infoEl = document.getElementById('practiceInfo');
    if (!infoEl) return;

    // 상태 텍스트 결정
    let statusText, statusIcon, statusColor;
    if (practiceEnabled && !disabledManually && isEnded) {
        statusText = '활성화됨 (자동)'; statusIcon = 'fa-check-circle'; statusColor = '#22c55e';
    } else if (practiceEnabled && !isEnded) {
        statusText = '활성화됨 (수동)'; statusIcon = 'fa-check-circle'; statusColor = '#3b82f6';
    } else if (practiceEnabled) {
        statusText = '활성화됨'; statusIcon = 'fa-check-circle'; statusColor = '#22c55e';
    } else if (!practiceEnabled && disabledManually) {
        statusText = '비활성화 (수동 OFF)'; statusIcon = 'fa-times-circle'; statusColor = '#ef4444';
    } else if (!practiceEnabled && !isEnded) {
        statusText = '대기 중 (정규과정 종료 시 자동 활성화)'; statusIcon = 'fa-clock'; statusColor = '#f59e0b';
    } else {
        statusText = '비활성화'; statusIcon = 'fa-times-circle'; statusColor = '#ef4444';
    }

    // 종료일 / D-day
    let endDateText = '-';
    let ddayText = '';
    if (scheduleEnd) {
        endDateText = formatKSTDate(app.schedule_end);
        const diffDays = Math.ceil((scheduleEnd - today) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
            ddayText = `D-${diffDays}`;
        } else if (diffDays === 0) {
            ddayText = 'D-Day';
        } else {
            ddayText = '종료됨';
        }
    }

    infoEl.innerHTML = `
        <div class="practice-info-item">
            현재 상태: <span style="color:${statusColor};"><i class="fas ${statusIcon}"></i> ${statusText}</span>
        </div>
        <div class="practice-info-item">
            정규과정 종료일: <span>${endDateText}</span>
            ${ddayText ? `<span style="margin-left:4px; padding:2px 8px; border-radius:4px; font-size:11px; background:${isEnded ? '#fef2f2' : '#f0f9ff'}; color:${isEnded ? '#ef4444' : '#3b82f6'};">${ddayText}</span>` : ''}
        </div>
    `;
}

function updatePracticeSegment(isEnabled) {
    const btnOff = document.getElementById('practiceBtnOff');
    const btnOn = document.getElementById('practiceBtnOn');
    if (!btnOff || !btnOn) return;

    btnOff.className = isEnabled ? '' : 'active-off';
    btnOn.className = isEnabled ? 'active-on' : '';
}

async function togglePracticeMode(enable) {
    const { app } = studentData;
    const currentState = app.practice_enabled === true;

    // 이미 같은 상태면 무시
    if (enable === currentState) return;

    const actionText = enable ? '활성화' : '비활성화';
    const studentName = studentData.user.name || '학생';

    if (!confirm(`"${studentName}"의 연습코스를 ${actionText}하시겠습니까?`)) return;

    // 버튼 비활성화
    const btnOff = document.getElementById('practiceBtnOff');
    const btnOn = document.getElementById('practiceBtnOn');
    btnOff.disabled = true;
    btnOn.disabled = true;

    try {
        const updateData = enable
            ? { practice_enabled: true, practice_disabled_manually: false }
            : { practice_enabled: false, practice_disabled_manually: true };

        await supabaseAPI.patch('applications', app.id, updateData);

        // 로컬 데이터 업데이트
        app.practice_enabled = updateData.practice_enabled;
        app.practice_disabled_manually = updateData.practice_disabled_manually;

        // UI 갱신
        renderPracticeSection();

        alert(`✅ 연습코스가 ${actionText}되었습니다.`);
    } catch (err) {
        console.error('연습코스 토글 실패:', err);
        alert('❌ 변경 실패: ' + err.message);
    } finally {
        btnOff.disabled = false;
        btnOn.disabled = false;
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
    const depositAmount = 100000; // 보증금 10만원 고정

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
            <div class="auth-sub" style="color:#94a3b8; font-size:12px; margin-top:6px;">오늘까지 할당된 과제 ${tasksDueToday}건 기준</div>
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

// ===== 전체 학습 기록 테이블 =====
let recordTableCollapsed = false;

function toggleRecordTable() {
    const body = document.getElementById('recordTableBody');
    const icon = document.getElementById('recordTableToggleIcon');
    if (!body || !icon) return;

    recordTableCollapsed = !recordTableCollapsed;
    if (recordTableCollapsed) {
        body.style.maxHeight = '0';
        body.style.overflow = 'hidden';
        icon.style.transform = 'rotate(180deg)';
    } else {
        body.style.maxHeight = '';
        body.style.overflow = '';
        icon.style.transform = 'rotate(0deg)';
    }
}

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_KR_MAP = { 'sunday': '일', 'monday': '월', 'tuesday': '화', 'wednesday': '수', 'thursday': '목', 'friday': '금' };

let allRecordRows = [];     // 전체 행 데이터
let filteredRows = [];      // 필터 적용된 행
let currentSort = { col: null, dir: 'asc' };
let introMemoMapGlobal = {};  // 입문서 과제별 구간 메모 매핑 (모달에서 참조)
const NO_ERROR_NOTE_TYPES = ['vocab', 'intro-book'];  // 오답노트 해당 없는 과제 유형

// 과제 날짜 계산: scheduleStart + (week-1)*7 + dayIndex
function getTaskDate(scheduleStart, week, dayEng) {
    const d = new Date(scheduleStart);
    d.setUTCDate(d.getUTCDate() + (week - 1) * 7 + (DAY_ENG_TO_INDEX[dayEng] || 0));
    return d;
}

async function renderStudyRecordTable() {
    const { app } = studentData;
    const programType = getProgram(app);
    const totalWeeks = getTotalWeeks(app);
    const prog = programType.toLowerCase();

    // study_results_v3를 빠르게 조회할 수 있는 맵 생성
    const v3Map = {};
    studyResultsV3.forEach(r => {
        const key = `${r.section_type}|${r.module_number}|${r.week}|${r.day}`;
        v3Map[key] = r;
    });

    // 도래 판별용
    const effectiveToday = getEffectiveToday();
    const scheduleStart = getScheduleStart(app);

    // ── 입문서 과제별 메모 수 계산 ──
    // 1) 스케줄에서 입문서 과제 목록 추출 + 마감 시각 계산
    const introDeadlines = [];
    for (let week = 1; week <= totalWeeks; week++) {
        for (const dayEn of DAY_ORDER) {
            const sched = scheduleData.find(s =>
                (s.program || '').toLowerCase() === prog && s.week === week && s.day === dayEn
            );
            if (!sched) continue;
            for (const sec of [sched.section1, sched.section2, sched.section3, sched.section4]) {
                const parsed = parseScheduleSection(sec);
                if (parsed && parsed.taskType === 'intro-book' && scheduleStart) {
                    const taskDate = getTaskDate(scheduleStart, week, dayEn);
                    // 마감 = 익일 04:00 KST = 과제일 19:00 UTC
                    const deadline = new Date(taskDate);
                    deadline.setUTCDate(deadline.getUTCDate() + 1);
                    deadline.setUTCHours(19, 0, 0, 0);
                    introDeadlines.push({ week, dayEn, moduleNumber: parsed.moduleNumber, deadline });
                }
            }
        }
    }
    introDeadlines.sort((a, b) => a.deadline - b.deadline);

    // 2) tr_book_memos 조회 (학생당 1회) — week, day 컬럼 포함
    let allBookMemos = [];
    if (introDeadlines.length > 0) {
        try {
            allBookMemos = await supabaseAPI.query('tr_book_memos', {
                'user_id': `eq.${studentData.user.id}`,
                'select': 'page_number,content,created_at,week,day',
                'order': 'page_number.asc',
                'limit': '500'
            }) || [];
        } catch (e) {
            console.warn('입문서 메모 조회 실패:', e);
        }
    }

    // 3) 과제별 메모 매핑 — week+day 직접 매칭 (기존 데이터 fallback: 시간 구간)
    // 한글→영어 역매핑 (메모의 day는 한글, introDeadlines의 dayEn은 영어)
    const DAY_KR_TO_EN = { '일': 'sunday', '월': 'monday', '화': 'tuesday', '수': 'wednesday', '목': 'thursday', '금': 'friday', '토': 'saturday' };

    // week+day가 있는 메모와 없는 메모(기존 데이터) 분리
    const taggedMemos = allBookMemos.filter(m => m.week != null && m.day != null);
    const untaggedMemos = allBookMemos.filter(m => m.week == null || m.day == null);

    introMemoMapGlobal = {};
    introDeadlines.forEach((d, idx) => {
        const isLast = idx === introDeadlines.length - 1;

        // A) week+day 태그된 메모: 직접 매칭
        const directMatched = taggedMemos.filter(m =>
            m.week === d.week && DAY_KR_TO_EN[m.day] === d.dayEn
        );

        // B) 태그 없는 기존 메모: 시간 구간 fallback
        const prevDeadline = idx > 0 ? introDeadlines[idx - 1].deadline : null;
        const fallbackMatched = untaggedMemos.filter(m => {
            const t = new Date(m.created_at);
            return prevDeadline ? (t > prevDeadline && t <= d.deadline) : (t <= d.deadline);
        });

        const matched = [...directMatched, ...fallbackMatched];

        // 마감 후 메모 (마지막 과제만)
        const afterDeadline = isLast ? [
            ...taggedMemos.filter(m => m.week === d.week && DAY_KR_TO_EN[m.day] === d.dayEn && new Date(m.created_at) > d.deadline),
            ...untaggedMemos.filter(m => new Date(m.created_at) > d.deadline)
        ] : [];

        introMemoMapGlobal[`${d.week}|${d.dayEn}`] = {
            count: matched.length,
            memos: matched,
            afterDeadlineMemos: afterDeadline,
            isLast
        };
    });

    // ── 스케줄 기반 행 생성 ──
    allRecordRows = [];
    for (let week = 1; week <= totalWeeks; week++) {
        for (const dayEn of DAY_ORDER) {
            const sched = scheduleData.find(s =>
                (s.program || '').toLowerCase() === prog &&
                s.week === week &&
                s.day === dayEn
            );
            if (!sched) continue;

            const taskDate = scheduleStart ? getTaskDate(scheduleStart, week, dayEn) : null;
            const isDateUpcoming = !taskDate || taskDate > effectiveToday;

            for (const sec of [sched.section1, sched.section2, sched.section3, sched.section4]) {
                const parsed = parseScheduleSection(sec);
                if (!parsed || parsed.taskType === 'unknown') continue;

                const dayKr = DAY_KR_MAP[dayEn];
                const moduleNum = parsed.moduleNumber;
                const key = `${parsed.taskType}|${moduleNum}|${week}|${dayKr}`;
                const record = v3Map[key] || null;
                const hasRecord = !!(record && record.initial_record);

                // 우선순위: record 있으면 도래 여부와 무관하게 완료
                const isUpcoming = isDateUpcoming && !hasRecord;
                const isDone = hasRecord;

                // 입문서 점수: tr_book_memos 기반 과제별 메모 수
                let score;
                if (isUpcoming) {
                    score = '-';
                } else if (parsed.taskType === 'intro-book') {
                    const introInfo = introMemoMapGlobal[`${week}|${dayEn}`];
                    score = `메모 ${introInfo ? introInfo.count : 0}개`;
                } else {
                    score = getScoreText(parsed.taskType, record);
                }

                allRecordRows.push({
                    week, dayEn, dayKr, taskType: parsed.taskType,
                    moduleNumber: moduleNum,
                    rawSection: sec,
                    record,
                    isUpcoming,
                    isDone,
                    score,
                    level: isUpcoming ? '-' : getLevelText(parsed.taskType, record),
                    authRate: isUpcoming ? -1 : getAuthRateValue(record),
                    errorNote: isUpcoming ? false : NO_ERROR_NOTE_TYPES.includes(parsed.taskType) ? null : (record ? !!record.error_note_submitted : false),
                    completedAt: record ? record.completed_at : null
                });
            }
        }
    }

    // 주차 필터 옵션 동적 생성
    const weekSelect = document.getElementById('filterWeek');
    for (let w = 1; w <= totalWeeks; w++) {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = `W${w}`;
        weekSelect.appendChild(opt);
    }

    // 배지 업데이트
    const badge = document.getElementById('recordTableCount');
    if (badge) { badge.textContent = `${allRecordRows.length}건`; badge.style.display = 'inline-flex'; }

    filteredRows = [...allRecordRows];
    renderRecordTableHTML();
}

// ===== 영역별 점수 파싱 =====
function getScoreText(taskType, record) {
    if (!record || !record.initial_record) return '-';
    const ir = record.initial_record;
    switch (taskType) {
        case 'reading':
        case 'listening': {
            const correct = ir.totalCorrect ?? 0;
            const total = ir.totalQuestions ?? 0;
            const pct = total > 0 ? Math.round(correct / total * 100) : 0;
            return `${correct}/${total} (${pct}%)`;
        }
        case 'writing': {
            if (ir.arrange) {
                const c = ir.arrange.correct ?? 0;
                const t = ir.arrange.total ?? 0;
                const pct = t > 0 ? Math.round(c / t * 100) : 0;
                return `${c}/${t} (${pct}%)`;
            }
            return '완료';
        }
        case 'speaking':
            return ir.completed ? '완료' : '미완료';
        case 'vocab': {
            const s = ir.score ?? 0;
            const t = ir.total ?? 0;
            const pct = t > 0 ? Math.round(s / t * 100) : 0;
            return `${s}/${t} (${pct}%)`;
        }
        case 'intro-book':
            return `메모 ${ir.memo_count ?? 0}개`;  // fallback (테이블에서는 tr_book_memos 기반 값 사용)
        default:
            return '-';
    }
}

function getLevelText(taskType, record) {
    if (!record) return '-';
    if (taskType === 'reading' || taskType === 'listening') {
        return record.initial_level != null ? record.initial_level : '-';
    }
    return '-';
}

function getAuthRateValue(record) {
    if (!record) return 0;
    if (record.locked_auth_rate != null) return record.locked_auth_rate;
    if (record.initial_record) return record.error_note_submitted ? 100 : 50;
    return 0;
}

// ===== 필터/정렬 =====
function applyRecordFilters() {
    const weekVal = document.getElementById('filterWeek').value;
    const typeVal = document.getElementById('filterType').value;
    const statusVal = document.getElementById('filterStatus').value;
    const arrivalVal = document.getElementById('filterArrival').value;

    filteredRows = allRecordRows.filter(r => {
        if (weekVal && r.week !== parseInt(weekVal)) return false;
        if (typeVal && r.taskType !== typeVal) return false;
        if (arrivalVal === 'arrived' && r.isUpcoming) return false;
        if (arrivalVal === 'upcoming' && !r.isUpcoming) return false;
        if (statusVal === 'done' && !r.isDone) return false;
        if (statusVal === 'undone' && (r.isDone || r.isUpcoming)) return false;
        return true;
    });

    if (currentSort.col) {
        sortRows(currentSort.col, currentSort.dir, true);
    } else {
        renderRecordTableHTML();
    }
}

function sortRows(col, dir, skipToggle) {
    if (!skipToggle) {
        if (currentSort.col === col) {
            dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            dir = 'asc';
        }
    }
    currentSort = { col, dir };

    filteredRows.sort((a, b) => {
        let va, vb;
        switch (col) {
            case 'week': va = a.week; vb = b.week; break;
            case 'day': va = DAY_ORDER.indexOf(a.dayEn); vb = DAY_ORDER.indexOf(b.dayEn); break;
            case 'task': va = a.taskType; vb = b.taskType; break;
            case 'status': va = a.isDone ? 1 : 0; vb = b.isDone ? 1 : 0; break;
            case 'auth': va = a.authRate; vb = b.authRate; break;
            case 'note': va = a.errorNote === null ? -1 : a.errorNote ? 1 : 0; vb = b.errorNote === null ? -1 : b.errorNote ? 1 : 0; break;
            case 'time': va = a.completedAt || ''; vb = b.completedAt || ''; break;
            default: va = 0; vb = 0;
        }
        if (va < vb) return dir === 'asc' ? -1 : 1;
        if (va > vb) return dir === 'asc' ? 1 : -1;
        return 0;
    });

    renderRecordTableHTML();
}

// ===== 테이블 HTML 렌더 =====
function renderRecordTableHTML() {
    const wrap = document.getElementById('recordTableWrap');

    if (filteredRows.length === 0) {
        wrap.innerHTML = '<div class="record-empty"><i class="fas fa-inbox" style="font-size:24px; margin-bottom:8px; display:block;"></i>표시할 기록이 없습니다.</div>';
        return;
    }

    function sortIcon(col) {
        const active = currentSort.col === col;
        const arrow = active ? (currentSort.dir === 'asc' ? '\u25b2' : '\u25bc') : '\u25b4';
        return `<span class="sort-icon${active ? ' active' : ''}">${arrow}</span>`;
    }

    let html = `<table class="record-table">
        <thead><tr>
            <th onclick="sortRows('week')">\uc8fc\ucc28${sortIcon('week')}</th>
            <th onclick="sortRows('day')">\uc694\uc77c${sortIcon('day')}</th>
            <th onclick="sortRows('task')">\uacfc\uc81c${sortIcon('task')}</th>
            <th onclick="sortRows('status')">\uc0c1\ud0dc${sortIcon('status')}</th>
            <th>\uc810\uc218</th>
            <th>\ub808\ubca8</th>
            <th onclick="sortRows('auth')">\uc778\uc99d\ub960${sortIcon('auth')}</th>
            <th onclick="sortRows('note')">\uc624\ub2f5\ub178\ud2b8${sortIcon('note')}</th>
            <th onclick="sortRows('time')">\ud480\uc774 \uc2dc\uac01${sortIcon('time')}</th>
            <th>\uc0c1\uc138</th>
        </tr></thead><tbody>`;

    filteredRows.forEach(r => {
        // 행 스타일: 예정(회색) > 미완료(노랑) > 완료(기본)
        let rowClass = '';
        if (r.isUpcoming) rowClass = ' class="row-upcoming"';
        else if (!r.isDone) rowClass = ' class="row-undone"';

        const info = TASK_EMOJI_MAP[r.taskType] || { emoji: '\ud83d\udccc', label: r.taskType };
        const moduleStr = r.moduleNumber ? ` M${r.moduleNumber}` : '';
        const taskLabel = `${info.emoji} ${info.label}${moduleStr}`;

        // 상태 표시
        let statusHtml;
        if (r.isUpcoming) {
            statusHtml = '<span class="record-status-upcoming">\u23f3 \uc608\uc815</span>';
        } else if (r.isDone) {
            statusHtml = '<span class="record-status-done">\u2705 \uc644\ub8cc</span>';
        } else {
            statusHtml = '<span class="record-status-undone">\u274c \ubbf8\uc644\ub8cc</span>';
        }

        // 예정이면 '-', 그 외에는 score 표시
        const scoreHtml = r.isUpcoming ? '<span style="color:#cbd5e1;">-</span>' : r.score;

        const levelHtml = (!r.isUpcoming && r.level !== '-')
            ? `<span class="record-level">${r.level}</span>`
            : '<span style="color:#cbd5e1;">-</span>';

        let authHtml;
        if (r.isUpcoming) {
            authHtml = '<span style="color:#cbd5e1;">-</span>';
        } else {
            let authClass = 'record-auth-0';
            if (r.authRate >= 100) authClass = 'record-auth-100';
            else if (r.authRate >= 50) authClass = 'record-auth-50';
            authHtml = `<span class="${authClass}">${r.authRate}%</span>`;
        }

        let noteHtml;
        if (r.isUpcoming || r.errorNote === null) {
            noteHtml = '<span style="color:#cbd5e1;">-</span>';
        } else if (r.isDone) {
            noteHtml = r.errorNote ? '<span style="color:#22c55e;">\u2705</span>' : '<span style="color:#ef4444;">\u274c</span>';
        } else {
            noteHtml = '<span style="color:#cbd5e1;">-</span>';
        }

        const timeHtml = r.completedAt ? formatCompletedAt(r.completedAt) : '<span style="color:#cbd5e1;">-</span>';

        // 입문서는 record 없어도 도래했으면 [보기] 표시
        let viewBtn;
        if (r.isUpcoming) {
            viewBtn = '<span style="color:#cbd5e1;">-</span>';
        } else if (r.record) {
            viewBtn = `<button class="btn-record-view" onclick="openRecordDetailModal('${r.record.id}')">보기</button>`;
        } else if (r.taskType === 'intro-book') {
            viewBtn = `<button class="btn-record-view" onclick="openIntroBookModal(${r.week}, '${r.dayEn}')">보기</button>`;
        } else {
            viewBtn = '<span style="color:#cbd5e1;">-</span>';
        }

        html += `<tr${rowClass}>
            <td><span class="record-week-badge">W${r.week}</span></td>
            <td><span class="record-day-badge">${r.dayKr}</span></td>
            <td><span class="record-task-name">${taskLabel}</span></td>
            <td>${statusHtml}</td>
            <td class="record-score">${scoreHtml}</td>
            <td>${levelHtml}</td>
            <td>${authHtml}</td>
            <td style="text-align:center;">${noteHtml}</td>
            <td style="font-size:11px; color:#94a3b8;">${timeHtml}</td>
            <td style="text-align:center;">${viewBtn}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;
}

function formatCompletedAt(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const m = kst.getUTCMonth() + 1;
    const day = kst.getUTCDate();
    const h = kst.getUTCHours();
    const min = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
}

// ===== 입문서 전용 모달 (record 없이 열기) =====
async function openIntroBookModal(week, dayEn) {
    const dayKr = DAY_KR_MAP[dayEn];
    const row = allRecordRows.find(r => r.taskType === 'intro-book' && r.week === week && r.dayEn === dayEn);
    const moduleNum = row ? row.moduleNumber : '';
    const record = row ? row.record : null;

    const existing = document.getElementById('recordDetailModal');
    if (existing) existing.remove();

    const title = `📕 입문서 정독${moduleNum ? ` M${moduleNum}` : ''} (W${week} ${dayKr})`;
    const bodyHtml = await buildIntroBookModal(record, week, dayEn);

    const modal = document.createElement('div');
    modal.id = 'recordDetailModal';
    modal.className = 'detail-modal-overlay';
    modal.innerHTML = `
        <div class="detail-modal">
            <div class="detail-modal-header">
                <h3>${title}</h3>
                <button class="detail-modal-close" onclick="closeRecordDetailModal()">&times;</button>
            </div>
            <div class="detail-modal-body">${bodyHtml}</div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeRecordDetailModal(); });
}

// ===== [보기] 상세 모달 =====
async function openRecordDetailModal(recordId) {
    const record = studyResultsV3.find(r => r.id === recordId);
    if (!record) return alert('기록을 찾을 수 없습니다.');

    // current_record는 별도 조회
    let currentRecord = null;
    let currentErrorNote = null;
    try {
        const detail = await supabaseAPI.query('study_results_v3', {
            'id': `eq.${recordId}`,
            'select': 'current_record,current_error_note_text',
            'limit': '1'
        });
        if (detail && detail.length > 0) {
            currentRecord = detail[0].current_record;
            currentErrorNote = detail[0].current_error_note_text;
        }
    } catch (e) {
        console.warn('다시풀기 데이터 로드 실패:', e);
    }

    // 기존 모달 제거
    const existing = document.getElementById('recordDetailModal');
    if (existing) existing.remove();

    const info = TASK_EMOJI_MAP[record.section_type] || { emoji: '\ud83d\udccc', label: record.section_type };
    const moduleStr = record.module_number ? ` M${record.module_number}` : '';
    const title = `${info.emoji} ${info.label}${moduleStr} (W${record.week} ${record.day})`;

    let bodyHtml = '';
    switch (record.section_type) {
        case 'reading':
        case 'listening':
            bodyHtml = buildReadingListeningModal(record, currentRecord, currentErrorNote);
            break;
        case 'writing':
            bodyHtml = buildWritingModal(record, currentRecord);
            break;
        case 'speaking':
            bodyHtml = buildSpeakingModal(record);
            break;
        case 'vocab':
            bodyHtml = buildVocabModal(record);
            break;
        case 'intro-book': {
            // record.day(한글)에서 영문 요일 역산
            const dayEnFromRecord = Object.keys(DAY_KR_MAP).find(k => DAY_KR_MAP[k] === record.day);
            bodyHtml = await buildIntroBookModal(record, record.week, dayEnFromRecord);
            break;
        }
        default:
            bodyHtml = '<p>상세 데이터가 없습니다.</p>';
    }

    const modal = document.createElement('div');
    modal.id = 'recordDetailModal';
    modal.className = 'detail-modal-overlay';
    modal.innerHTML = `
        <div class="detail-modal">
            <div class="detail-modal-header">
                <h3>${title}</h3>
                <button class="detail-modal-close" onclick="closeRecordDetailModal()">&times;</button>
            </div>
            <div class="detail-modal-body">${bodyHtml}</div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeRecordDetailModal(); });
}

function closeRecordDetailModal() {
    const m = document.getElementById('recordDetailModal');
    if (m) m.remove();
}

// ===== Reading / Listening 모달 =====
function buildReadingListeningModal(record, currentRecord, currentErrorNote) {
    const ir = record.initial_record;
    let html = '';

    // 실전풀이
    if (ir) {
        const completedStr = ir.completedAt ? formatCompletedAt(ir.completedAt) : (record.completed_at ? formatCompletedAt(record.completed_at) : '-');
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-pen-fancy" style="color:#3b82f6;"></i> \uc2e4\uc804\ud480\uc774 (${completedStr})</div>`;

        // 문항별 테이블
        const answers = extractAnswers(ir);
        if (answers.length > 0) {
            html += '<table class="detail-qa-table"><thead><tr><th>\ubc88\ud638</th><th>\uc815\ub2f5</th><th>\ud559\uc0dd \uc120\ud0dd</th><th>\uacb0\uacfc</th></tr></thead><tbody>';
            answers.forEach(a => {
                const cls = a.isCorrect ? 'correct' : 'wrong';
                const icon = a.isCorrect ? '\u2705' : '\u274c';
                html += `<tr><td>Q${a.questionNumber}</td><td>${escapeHtml(a.correctAnswer)}</td><td class="${cls}">${escapeHtml(a.userAnswer)}</td><td>${icon}</td></tr>`;
            });
            html += '</tbody></table>';
        }

        const correct = ir.totalCorrect ?? 0;
        const total = ir.totalQuestions ?? 0;
        const pct = total > 0 ? Math.round(correct / total * 100) : 0;
        const level = record.initial_level != null ? record.initial_level : '-';
        html += `<div class="detail-summary">
            <span>\ucd1d\uc810: <strong>${correct}/${total} (${pct}%)</strong></span>
            <span>\ub808\ubca8: <strong>${level}</strong></span>
        </div></div>`;
    }

    // 다시풀기
    if (currentRecord) {
        const crCompletedStr = currentRecord.completedAt ? formatCompletedAt(currentRecord.completedAt) : '-';
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-redo" style="color:#8b5cf6;"></i> \ub2e4\uc2dc\ud480\uae30 (${crCompletedStr})</div>`;

        const answers2 = extractAnswers(currentRecord);
        if (answers2.length > 0) {
            html += '<table class="detail-qa-table"><thead><tr><th>\ubc88\ud638</th><th>\uc815\ub2f5</th><th>\ud559\uc0dd \uc120\ud0dd</th><th>\uacb0\uacfc</th></tr></thead><tbody>';
            answers2.forEach(a => {
                const cls = a.isCorrect ? 'correct' : 'wrong';
                const icon = a.isCorrect ? '\u2705' : '\u274c';
                html += `<tr><td>Q${a.questionNumber}</td><td>${escapeHtml(a.correctAnswer)}</td><td class="${cls}">${escapeHtml(a.userAnswer)}</td><td>${icon}</td></tr>`;
            });
            html += '</tbody></table>';
        }

        const c2 = currentRecord.totalCorrect ?? 0;
        const t2 = currentRecord.totalQuestions ?? 0;
        const p2 = t2 > 0 ? Math.round(c2 / t2 * 100) : 0;
        html += `<div class="detail-summary"><span>\ucd1d\uc810: <strong>${c2}/${t2} (${p2}%)</strong></span></div></div>`;
    }

    // 오답노트
    const noteText = record.error_note_text || currentErrorNote;
    if (noteText) {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-sticky-note" style="color:#f59e0b;"></i> \uc624\ub2f5\ub178\ud2b8</div>
            <div class="detail-text-block">${escapeHtml(noteText)}</div>
        </div>`;
    }

    return html || '<p style="color:#94a3b8; text-align:center;">데이터가 없습니다.</p>';
}

function extractAnswers(recordObj) {
    if (!recordObj || !recordObj.sets) return [];
    const answers = [];
    const sets = recordObj.sets;

    // 시험 순서: fillblanks → daily1 → daily2 → academic
    const SET_ORDER = [
        'fillblanks_set1', 'fillblanks_set2',
        'daily1_set1', 'daily1_set2',
        'daily2_set1', 'daily2_set2',
        'academic_set1'
    ];

    // sets가 객체면 시험 순서대로 정렬, 배열이면 그대로
    let setList;
    if (Array.isArray(sets)) {
        setList = sets;
    } else {
        const keys = Object.keys(sets);
        keys.sort((a, b) => {
            const ai = SET_ORDER.indexOf(a);
            const bi = SET_ORDER.indexOf(b);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        setList = keys.map(k => sets[k]);
    }

    let qNum = 1;
    setList.forEach(set => {
        if (set && set.answers && Array.isArray(set.answers)) {
            set.answers.forEach(a => {
                const correctRaw = a.correctAnswer ?? a.correct ?? '-';
                const userRaw = a.userAnswer ?? a.selected ?? '-';
                const options = a.options || [];

                const correctLabel = typeof correctRaw === 'number' && options[correctRaw]
                    ? (options[correctRaw].label || String.fromCharCode(65 + correctRaw))
                    : String(correctRaw);
                const userLabel = typeof userRaw === 'number' && options[userRaw]
                    ? (options[userRaw].label || String.fromCharCode(65 + userRaw))
                    : String(userRaw);

                answers.push({
                    questionNumber: qNum++,
                    correctAnswer: correctLabel,
                    userAnswer: userLabel,
                    isCorrect: a.isCorrect != null ? !!a.isCorrect : (correctRaw === userRaw)
                });
            });
        }
    });
    return answers;
}

// ===== Writing 모달 =====
function buildWritingModal(record, currentRecord) {
    let html = '';

    function buildWritingSection(label, icon, color, wr) {
        if (!wr) return '';
        let s = `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-${icon}" style="color:${color};"></i> ${label}</div>`;

        // 배열 정리
        if (wr.arrange) {
            const c = wr.arrange.correct ?? 0, t = wr.arrange.total ?? 0;
            const pct = t > 0 ? Math.round(c / t * 100) : 0;
            s += `<div style="margin-bottom:12px;"><strong>[\ubc30\uc5f4 \uc815\ub9ac]</strong> ${c}/${t} (${pct}%)</div>`;
        }

        // Email
        const emailText = record.writing_email_text || (wr.email ? wr.email.userAnswer : null);
        if (emailText || (wr.email && wr.email.wordCount)) {
            const wc = wr.email ? (wr.email.wordCount || 0) : 0;
            s += `<div style="margin-bottom:12px;"><strong>[Email]</strong> ${wc}\ub2e8\uc5b4</div>`;
            if (emailText) s += `<div class="detail-text-block">${escapeHtml(emailText)}</div>`;
        }

        // Discussion
        const discText = record.writing_discussion_text || (wr.discussion ? wr.discussion.userAnswer : null);
        if (discText || (wr.discussion && wr.discussion.wordCount)) {
            const wc = wr.discussion ? (wr.discussion.wordCount || 0) : 0;
            s += `<div style="margin-top:12px; margin-bottom:8px;"><strong>[Discussion]</strong> ${wc}\ub2e8\uc5b4</div>`;
            if (discText) s += `<div class="detail-text-block">${escapeHtml(discText)}</div>`;
        }

        s += '</div>';
        return s;
    }

    html += buildWritingSection('\uc2e4\uc804\ud480\uc774', 'pen-fancy', '#3b82f6', record.initial_record);
    if (currentRecord) html += buildWritingSection('\ub2e4\uc2dc\ud480\uae30', 'redo', '#8b5cf6', currentRecord);

    // Rewrite
    const rw = record.rewrite_record;
    if (rw) {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-pencil-alt" style="color:#10b981;"></i> Rewrite</div>`;
        if (rw.email && rw.email.text) {
            const wc = rw.email.wordCount || 0;
            const savedAt = rw.email.savedAt ? formatCompletedAt(rw.email.savedAt) : '';
            html += `<div style="margin-bottom:12px;"><strong>[Email]</strong> ${wc}단어${savedAt ? ` <span style="color:#94a3b8; font-size:11px;">(${savedAt})</span>` : ''}</div>`;
            html += `<div class="detail-text-block">${escapeHtml(rw.email.text)}</div>`;
        }
        if (rw.discussion && rw.discussion.text) {
            const wc = rw.discussion.wordCount || 0;
            const savedAt = rw.discussion.savedAt ? formatCompletedAt(rw.discussion.savedAt) : '';
            html += `<div style="margin-top:12px; margin-bottom:8px;"><strong>[Discussion]</strong> ${wc}단어${savedAt ? ` <span style="color:#94a3b8; font-size:11px;">(${savedAt})</span>` : ''}</div>`;
            html += `<div class="detail-text-block">${escapeHtml(rw.discussion.text)}</div>`;
        }
        html += '</div>';
    }

    // 오답노트
    if (record.error_note_text) {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-sticky-note" style="color:#f59e0b;"></i> \uc624\ub2f5\ub178\ud2b8</div>
            <div class="detail-text-block">${escapeHtml(record.error_note_text)}</div>
        </div>`;
    }

    return html || '<p style="color:#94a3b8; text-align:center;">데이터가 없습니다.</p>';
}

// ===== Speaking 모달 =====
function buildSpeakingModal(record) {
    const ir = record.initial_record;
    let html = '';

    if (ir) {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-microphone" style="color:#3b82f6;"></i> \uc2e4\uc804\ud480\uc774</div>
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
                <span>Repeat: ${ir.repeat && ir.repeat.completed ? '\u2705 \uc644\ub8cc' : '\u274c \ubbf8\uc644\ub8cc'}</span>
                <span>Interview: ${ir.interview && ir.interview.completed ? '\u2705 \uc644\ub8cc' : '\u274c \ubbf8\uc644\ub8cc'}</span>
            </div>
        </div>`;
    }

    // 오답노트
    if (record.error_note_text) {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-sticky-note" style="color:#f59e0b;"></i> \uc624\ub2f5\ub178\ud2b8</div>
            <div class="detail-text-block">${escapeHtml(record.error_note_text)}</div>
        </div>`;
    }

    // 녹음 파일
    if (record.speaking_file_1) {
        const audioUrl = `${SUPABASE_URL}/storage/v1/object/public/speaking-files/${record.speaking_file_1}`;
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-headphones" style="color:#10b981;"></i> \ub179\uc74c \ud30c\uc77c</div>
            <audio controls style="width:100%;" controlsList="nodownload">
                <source src="${escapeHtml(audioUrl)}" type="audio/webm">
                <source src="${escapeHtml(audioUrl)}" type="audio/mp4">
                <source src="${escapeHtml(audioUrl)}" type="audio/mpeg">
                \ube0c\ub77c\uc6b0\uc800\uac00 \uc624\ub514\uc624\ub97c \uc9c0\uc6d0\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.
            </audio>
            <div style="font-size:11px; color:#94a3b8; margin-top:4px; word-break:break-all;">${escapeHtml(record.speaking_file_1)}</div>
        </div>`;
    }

    return html || '<p style="color:#94a3b8; text-align:center;">데이터가 없습니다.</p>';
}

// ===== Vocab 모달 =====
function buildVocabModal(record) {
    const ir = record.initial_record;
    if (!ir) return '<p style="color:#94a3b8; text-align:center;">데이터가 없습니다.</p>';

    const s = ir.score ?? 0, t = ir.total ?? 0;
    const pct = t > 0 ? Math.round(s / t * 100) : 0;
    const pages = ir.pages ? (Array.isArray(ir.pages) ? ir.pages.join(', ') + 'pg' : ir.pages + 'pg') : '-';
    const authOk = pct >= 30;

    return `<div class="detail-section">
        <div class="detail-section-title"><i class="fas fa-spell-check" style="color:#3b82f6;"></i> \uacb0\uacfc</div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:14px;">
            <span>\uc810\uc218: <strong>${s}/${t} (${pct}%)</strong></span>
            <span>\ubc94\uc704: <strong>${pages}</strong></span>
            <span>\uc778\uc99d: ${authOk ? '<span style="color:#22c55e; font-weight:700;">\u2705 30% \uc774\uc0c1</span>' : '<span style="color:#ef4444; font-weight:700;">\u274c 30% \ubbf8\ub9cc (\ubbf8\uc778\uc815)</span>'}</span>
        </div>
    </div>`;
}

// ===== Intro-book 모달 =====
async function buildIntroBookModal(record, week, dayEn) {
    const ir = record ? record.initial_record : null;
    const userId = studentData.user.id;
    const authRate = record ? record.locked_auth_rate : null;

    // 과제별 구간 메모 정보 (renderStudyRecordTable에서 이미 계산됨)
    const introInfo = dayEn ? introMemoMapGlobal[`${week}|${dayEn}`] : null;
    const segmentMemos = introInfo ? introInfo.memos : [];
    const afterDeadlineMemos = introInfo ? introInfo.afterDeadlineMemos : [];
    const isLast = introInfo ? introInfo.isLast : false;
    const segmentCount = segmentMemos.length;

    // 읽기 진도 조회 (모달 열 때 1회)
    let progress = null;
    try {
        const progResult = await supabaseAPI.query('tr_book_progress', {
            'user_id': `eq.${userId}`,
            'select': 'last_page,max_page_reached,is_completed,completed_at,updated_at',
            'limit': '1'
        });
        progress = progResult && progResult.length > 0 ? progResult[0] : null;
    } catch (e) {
        console.warn('입문서 진도 로드 실패:', e);
    }

    let html = '';

    // 1. 이 과제 인증 시점 정보
    let authIcon;
    if (authRate != null && authRate >= 100) {
        authIcon = '<span style="color:#22c55e; font-weight:700;">✅ 인증</span>';
    } else if (authRate != null && authRate >= 50) {
        authIcon = '<span style="color:#f59e0b; font-weight:700;">🟡 초기 제출</span>';
    } else if (ir) {
        authIcon = record.error_note_submitted
            ? '<span style="color:#22c55e; font-weight:700;">✅ 인증</span>'
            : '<span style="color:#f59e0b; font-weight:700;">🟡 초기 제출</span>';
    } else {
        authIcon = '<span style="color:#ef4444; font-weight:700;">❌ 미인증</span>';
    }

    html += `<div class="detail-section">
        <div class="detail-section-title"><i class="fas fa-check-circle" style="color:#3b82f6;"></i> 이 과제 인증 시점</div>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:14px;">
            <span>메모 수: <strong>${segmentCount}개</strong></span>
            <span>인증: ${authIcon}</span>
        </div>
    </div>`;

    // 2. 읽기 진도
    if (progress) {
        const maxPage = progress.max_page_reached || 0;
        const lastPage = progress.last_page || 0;
        const pct = INTRO_BOOK_TOTAL_PAGES > 0 ? Math.round(maxPage / INTRO_BOOK_TOTAL_PAGES * 100) : 0;
        const completedStr = progress.is_completed
            ? '<span style="color:#22c55e; font-weight:700;">✅ 완독</span>'
            : '<span style="color:#f59e0b;">진행 중</span>';
        const updatedStr = progress.updated_at ? formatCompletedAt(progress.updated_at) : '-';

        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-book-open" style="color:#8b5cf6;"></i> 읽기 진도</div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:14px;">
                <span>현재 위치: <strong>${lastPage}p</strong> / ${INTRO_BOOK_TOTAL_PAGES}p</span>
                <span>최대 도달: <strong>${maxPage}p</strong> (${pct}%)</span>
                <div style="background:#f1f5f9; border-radius:6px; height:8px; overflow:hidden; margin:2px 0;">
                    <div style="height:100%; width:${Math.min(100, pct)}%; background:linear-gradient(90deg,#8b5cf6,#a78bfa); border-radius:6px;"></div>
                </div>
                <span>완독: ${completedStr}</span>
                <span>마지막 읽은 시각: ${updatedStr}</span>
            </div>
        </div>`;
    } else {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-book-open" style="color:#8b5cf6;"></i> 읽기 진도</div>
            <p style="color:#94a3b8; font-size:13px;">읽기 진도 데이터가 없습니다.</p>
        </div>`;
    }

    // 3. 이 과제 구간 메모 목록 (접기/펼치기)
    const totalDisplay = segmentMemos.length + afterDeadlineMemos.length;
    if (totalDisplay > 0) {
        const titleSuffix = isLast && afterDeadlineMemos.length > 0
            ? ` (구간 ${segmentMemos.length}개 + 마감 후 ${afterDeadlineMemos.length}개)`
            : ` (${segmentMemos.length}개)`;

        html += `<div class="detail-section">
            <div class="detail-section-title" style="cursor:pointer;" onclick="var w=this.parentElement.querySelector('.memo-list-wrap');var t=this.querySelector('.memo-toggle');if(w.style.display==='none'){w.style.display='block';t.textContent='▲ 접기';}else{w.style.display='none';t.textContent='▼ 펼치기';}">
                <i class="fas fa-sticky-note" style="color:#f59e0b;"></i> 이 과제 메모${titleSuffix}
                <span class="memo-toggle" style="font-size:11px; color:#94a3b8; margin-left:auto;">▼ 펼치기</span>
            </div>
            <div class="memo-list-wrap" style="display:none; max-height:300px; overflow-y:auto;">`;

        segmentMemos.forEach(m => {
            const timeStr = m.created_at ? formatCompletedAt(m.created_at) : '';
            html += `<div style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:13px;">
                <span style="color:#8b5cf6; font-weight:700; margin-right:8px;">p.${m.page_number}</span>
                <span style="color:#334155;">${escapeHtml(m.content)}</span>
                ${timeStr ? `<span style="color:#94a3b8; font-size:11px; margin-left:8px;">${timeStr}</span>` : ''}
            </div>`;
        });

        // 마지막 과제이고 마감 이후 메모가 있으면 구분선
        if (isLast && afterDeadlineMemos.length > 0) {
            html += `<div style="padding:10px; text-align:center; color:#94a3b8; font-size:12px; border-bottom:1px solid #e2e8f0; background:#f8fafc;">
                ─────── 마감 이후 작성 (${afterDeadlineMemos.length}개) ───────
            </div>`;
            afterDeadlineMemos.forEach(m => {
                const timeStr = m.created_at ? formatCompletedAt(m.created_at) : '';
                html += `<div style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-size:13px; background:#fffbeb;">
                    <span style="color:#8b5cf6; font-weight:700; margin-right:8px;">p.${m.page_number}</span>
                    <span style="color:#334155;">${escapeHtml(m.content)}</span>
                    ${timeStr ? `<span style="color:#94a3b8; font-size:11px; margin-left:8px;">${timeStr}</span>` : ''}
                </div>`;
            });
        }

        html += '</div></div>';
    } else {
        html += `<div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-sticky-note" style="color:#f59e0b;"></i> 이 과제 메모</div>
            <p style="color:#94a3b8; font-size:13px;">이 구간에 작성된 메모가 없습니다.</p>
        </div>`;
    }

    return html;
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

// --- 볼드 에디터 기능 ---

/**
 * 마크다운 볼드(**text**) 토글 함수
 * - 선택 없이 클릭: 커서 위치에 **** 삽입, 커서를 가운데로
 * - 텍스트 선택 후 클릭:
 *   - 이미 **로 감싸져 있으면 → ** 제거 (해제)
 *   - 아니면 → **선택영역**으로 감싸기 (적용)
 */
function toggleBold(textareaId) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;

    let start = ta.selectionStart;
    let end = ta.selectionEnd;
    const text = ta.value;

    if (start === end) {
        // 선택 없이 클릭 → **** 삽입, 커서를 가운데로
        const insert = '****';
        ta.value = text.slice(0, start) + insert + text.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
    } else {
        const selected = text.slice(start, end);

        // 선택 영역 자체가 **...**인지 확인
        if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
            // **텍스트** 전체를 선택한 경우 → 해제
            const inner = selected.slice(2, -2);
            ta.value = text.slice(0, start) + inner + text.slice(end);
            ta.selectionStart = start;
            ta.selectionEnd = start + inner.length;
        }
        // 바깥쪽 ±2 글자가 **인지 확인 (안쪽 텍스트만 선택한 경우)
        else if (start >= 2 && end + 2 <= text.length &&
                 text.slice(start - 2, start) === '**' && text.slice(end, end + 2) === '**') {
            // 바깥 ** 제거
            ta.value = text.slice(0, start - 2) + selected + text.slice(end + 2);
            ta.selectionStart = start - 2;
            ta.selectionEnd = start - 2 + selected.length;
        }
        // 볼드 적용
        else {
            const wrapped = '**' + selected + '**';
            ta.value = text.slice(0, start) + wrapped + text.slice(end);
            ta.selectionStart = start;
            ta.selectionEnd = start + wrapped.length;
        }
    }
    ta.focus();
}

/**
 * 마크다운 볼드를 HTML <b> 태그로 변환 (미리보기용)
 * XSS 방어: escapeHtml 먼저 적용 후 ** 패턴만 <b>로 변환
 */
function renderBoldPreview(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/**
 * textarea에 Ctrl+B / Cmd+B 단축키 바인딩
 */
function bindBoldShortcut(textareaId) {
    const ta = document.getElementById(textareaId);
    if (!ta || ta._boldShortcutBound) return;
    ta._boldShortcutBound = true;
    ta.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            toggleBold(textareaId);
        }
    });
}

// 발송 폼 textarea에 단축키 바인딩 (DOM 로드 후)
document.addEventListener('DOMContentLoaded', function() {
    bindBoldShortcut('notifMessage');
});

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
        const msgPreviewHtml = renderBoldPreview(msgPreview + ((n.message || '').length > 50 ? '…' : ''));
        const readBadge = n.is_read
            ? '<span class="notif-badge-read"><i class="fas fa-check-circle"></i> 읽음</span>'
            : '<span class="notif-badge-unread"><i class="fas fa-clock"></i> 안읽음</span>';
        const createdBy = n.created_by || '-';

        html += `<tr>
            <td style="font-size:12px; color:#94a3b8; white-space:nowrap;">${created}</td>
            <td style="font-weight:600;">${escapeHtml(title)}</td>
            <td style="color:#64748b; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${msgPreviewHtml}</td>
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
                    <div class="notif-editor-wrap">
                        <div class="notif-editor-toolbar">
                            <button type="button" title="볼드 (Ctrl+B)" onclick="toggleBold('editNotifMessage')"><b>B</b></button>
                        </div>
                        <textarea id="editNotifMessage" rows="6">${escapeHtml(n.message || '')}</textarea>
                    </div>
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
    bindBoldShortcut('editNotifMessage');
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
