// ===== 학습 관리 (admin-study.js) =====

let allStudentData = [];
let filteredStudentData = [];

// 스케줄 전역 변수 (잔디/알림용)
let scheduleLookup = {};
const dayNameToEng = { 0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday' };

// 헬퍼: 특정 주차/요일의 과제 수 반환 (잔디/알림에서 사용)
function getTaskCount(programType, week, dayIndex) {
    const prog = programType.toLowerCase();
    const dayEng = dayNameToEng[dayIndex];
    if (!dayEng) return 0;
    const lookup = scheduleLookup[prog];
    if (!lookup) return 0;
    return lookup[`${week}_${dayEng}`] || 0;
}

document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth();
    loadStudyData();
});

// 관리자 인증 확인
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
async function loadStudyData() {
    const loading = document.getElementById('loading');
    const studyTable = document.getElementById('studyTable');
    const emptyState = document.getElementById('emptyState');

    try {
        // 새벽 4시 컷오프 적용
        const today = getEffectiveToday();

        // 1. 진행 중인 학생 조회: 입금 확인 완료
        const apps = await supabaseAPI.query('applications', {
            'deposit_confirmed_by_admin': 'eq.true',
            'limit': '500'
        });

        // 학생 필터링 (시작일 설정된 학생만 — 종료/환불/중도포기도 포함)
        const activeApps = (apps || []).filter(app => {
            if (!app.schedule_start) return false;
            return true;
        });

        if (activeApps.length === 0) {
            loading.style.display = 'none';
            emptyState.style.display = 'block';
            updateStatCards([], []);
            return;
        }

        // 2. 유저 매핑
        const users = await supabaseAPI.query('users', { 'limit': '500' });
        const userMap = {};
        (users || []).forEach(u => { userMap[u.email] = u; });

        const userIds = activeApps.map(app => {
            const user = userMap[app.email];
            return user ? user.id : null;
        }).filter(Boolean);

        // 3. tr_study_records (잔디/알림/추세용 — 여전히 필요)
        const studyRecords = await supabaseAPI.query('tr_study_records', {
            'select': 'id,user_id,week,day,task_type,module_number,completed_at',
            'limit': '10000'
        });
        const allRecords = (studyRecords || []).filter(r => userIds.includes(r.user_id));

        // 4. tr_auth_records (fraud/알림용 — 여전히 필요)
        const authRecords = await supabaseAPI.query('tr_auth_records', { 'limit': '10000' });
        const allAuthRecords = (authRecords || []).filter(r => userIds.includes(r.user_id));

        // 5. 스케줄 데이터 (잔디/알림/인증률 계산용)
        const scheduleData = await supabaseAPI.query('tr_schedule_assignment', { 'limit': '500' });
        scheduleLookup = {};
        (scheduleData || []).forEach(s => {
            const prog = (s.program || '').toLowerCase();
            if (!scheduleLookup[prog]) scheduleLookup[prog] = {};
            const taskCount = [s.section1, s.section2, s.section3, s.section4].filter(v => v && v.trim() !== '').length;
            scheduleLookup[prog][`${s.week}_${s.day}`] = taskCount;
        });

        // 6. study_results_v3 (V3 인증률 계산용 + 알림판 연속미제출 판정용)
        const v3Records = await supabaseAPI.query('study_results_v3', {
            'select': 'user_id,locked_auth_rate,initial_record,error_note_submitted,section_type,week,day,completed_at',
            'limit': '10000'
        });
        const v3Map = {};
        (v3Records || []).forEach(r => {
            if (!v3Map[r.user_id]) v3Map[r.user_id] = [];
            v3Map[r.user_id].push(r);
        });

        // 7. 토플 실제 성적 로드
        const toeflScores = await supabaseAPI.query('toefl_actual_scores', {
            'select': 'user_id',
            'limit': '5000'
        });
        const toeflCountMap = {};
        (toeflScores || []).forEach(s => {
            if (!toeflCountMap[s.user_id]) toeflCountMap[s.user_id] = 0;
            toeflCountMap[s.user_id]++;
        });

        // 8. 등급 규칙 로드
        const gradeRules = await loadGradeRules();

        // 7. 학생별 데이터 조합
        allStudentData = activeApps.map(app => {
            const user = userMap[app.email];
            if (!user) return null;

            const userId = user.id;
            const myRecords = allRecords.filter(r => r.user_id === userId);
            const myAuthRecords = allAuthRecords.filter(r => r.user_id === userId);

            const startDate = new Date(app.schedule_start);
            const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
            const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);

            const programType = (app.assigned_program || app.preferred_program || '').includes('Fast') ? 'Fast' : 'Standard';
            const totalWeeks = programType === 'Fast' ? 4 : 8;

            // 시작 전 여부
            const isBeforeStart = today < startDate;

            // ── study_results_v3 기반 인증률 계산 ──
            const myV3 = v3Map[userId] || [];
            let authRateSum = 0;
            for (const r of myV3) {
                if (r.locked_auth_rate != null) {
                    authRateSum += r.locked_auth_rate;
                } else if (r.initial_record) {
                    authRateSum += r.error_note_submitted ? 100 : 50;
                }
            }

            // 도래 과제 수 계산 (스케줄 기반)
            const prog = programType.toLowerCase();
            const dayEngNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            let totalDeadlinedTasks = 0;
            for (const s of (scheduleData || [])) {
                if ((s.program || '').toLowerCase() !== prog) continue;
                if (s.week > totalWeeks) continue;
                const dayIndex = dayEngNames.indexOf(s.day);
                if (dayIndex < 0) continue;
                const taskDate = new Date(startDate);
                taskDate.setDate(taskDate.getDate() + (s.week - 1) * 7 + dayIndex);
                if (taskDate > today) continue;
                for (const sec of [s.section1, s.section2, s.section3, s.section4]) {
                    const parsed = parseScheduleSection(sec);
                    if (parsed && parsed.taskType !== 'unknown') totalDeadlinedTasks++;
                }
            }

            const avgAuthRate = totalDeadlinedTasks > 0 ? Math.round(authRateSum / totalDeadlinedTasks) : 0;

            // 인증률 표시
            let authDisplay = '-';
            if (isBeforeStart) {
                authDisplay = '-';
            } else if (totalDeadlinedTasks > 0) {
                authDisplay = `${avgAuthRate}%`;
            } else if (myV3.length > 0) {
                authDisplay = `${avgAuthRate}%`;
            }

            // 등급 계산 (인증률 기반)
            let displayGrade = '-';
            if (totalDeadlinedTasks > 0) {
                const gradeResult = getGradeFromRules(avgAuthRate, gradeRules, 100000);
                displayGrade = gradeResult ? gradeResult.grade : '-';
            }
            const gradeColor = (displayGrade !== '-') ? getGradeColor(displayGrade) : '#94a3b8';

            // ── 추세 (이번 주 vs 저번 주 — 여전히 auth_records 기반) ──
            const thisWeekStart = new Date(startDate);
            thisWeekStart.setDate(thisWeekStart.getDate() + (currentWeek - 1) * 7);
            const lastWeekStart = new Date(thisWeekStart);
            lastWeekStart.setDate(lastWeekStart.getDate() - 7);

            const thisWeekAuth = myAuthRecords.filter(r => {
                const d = new Date(r.created_at);
                return d >= thisWeekStart && d < today;
            });
            const lastWeekAuth = myAuthRecords.filter(r => {
                const d = new Date(r.created_at);
                return d >= lastWeekStart && d < thisWeekStart;
            });

            const thisWeekAvg = thisWeekAuth.length > 0
                ? Math.round(thisWeekAuth.reduce((s, r) => s + (r.auth_rate || 0), 0) / thisWeekAuth.length)
                : 0;
            const lastWeekAvg = lastWeekAuth.length > 0
                ? Math.round(lastWeekAuth.reduce((s, r) => s + (r.auth_rate || 0), 0) / lastWeekAuth.length)
                : 0;

            let trend = '→';
            let trendColor = '#94a3b8';
            if (thisWeekAvg > lastWeekAvg + 5) { trend = '↑'; trendColor = '#22c55e'; }
            else if (thisWeekAvg < lastWeekAvg - 5) { trend = '↓'; trendColor = '#ef4444'; }

            // ── 이번 주 잔디 (여전히 study_records + 스케줄 기반) ──
            const weekGrass = [];
            const cw = Math.min(currentWeek, totalWeeks);
            for (let d = 0; d < 6; d++) {
                const checkDate = new Date(thisWeekStart);
                checkDate.setDate(checkDate.getDate() + d);
                const dateStr = checkDate.toISOString().split('T')[0];
                const todayStr = today.toISOString().split('T')[0];
                const isToday = dateStr === todayStr;
                const isFuture = checkDate > today;

                const requiredTasks = getTaskCount(programType, cw, checkDate.getDay());

                const dayRecords = myRecords.filter(r => {
                    const rDate = new Date(r.completed_at).toISOString().split('T')[0];
                    return rDate === dateStr;
                });
                const uniqueTypes = new Set(dayRecords.map(r => r.task_type));

                if (requiredTasks > 0 && uniqueTypes.size >= requiredTasks) {
                    weekGrass.push('🟩');
                } else if (uniqueTypes.size > 0) {
                    weekGrass.push('🟨');
                } else if (isFuture || isToday) {
                    weekGrass.push('⬜');
                } else {
                    weekGrass.push('🟥');
                }
            }

            // ── 최근 활동 ──
            const lastActivity = myRecords.length > 0
                ? Math.max(...myRecords.map(r => new Date(r.completed_at).getTime()))
                : null;
            const daysSinceActivity = lastActivity
                ? Math.floor((today - lastActivity) / (1000 * 60 * 60 * 24))
                : 999;

            // ── 연속 미제출 일수 ──
            let consecutiveMissing = 0;
            for (let d = 1; d <= 7; d++) {
                const checkDate = new Date(today);
                checkDate.setDate(checkDate.getDate() - d);
                if (checkDate < startDate) break;
                const checkDay = checkDate.getDay();
                if (checkDay === 6) continue;
                const dateStr = checkDate.toISOString().split('T')[0];
                const hasRecord = myRecords.some(r => new Date(r.completed_at).toISOString().split('T')[0] === dateStr);
                if (!hasRecord) consecutiveMissing++;
                else break;
            }

            // ── fraud 여부 ──
            const hasFraud = myAuthRecords.some(r => r.no_selection_flag || r.no_text_flag || r.focus_lost_count > 3);

            return {
                userId,
                appId: app.id,
                name: user.name || app.name || '-',
                email: user.email,
                programType,
                currentWeek: Math.min(currentWeek, totalWeeks),
                totalWeeks,
                avgAuthRate,
                authDisplay,
                trend,
                trendColor,
                grade: displayGrade,
                gradeColor,
                weekGrass,
                totalDeadlinedTasks,
                lastActivity,
                daysSinceActivity,
                consecutiveMissing,
                hasFraud,
                scheduleStart: app.schedule_start,
                scheduleEnd: app.schedule_end,
                appStatus: app.app_status || null,
                toeflCount: toeflCountMap[userId] || 0
            };
        }).filter(Boolean);

        // 통계 카드 업데이트
        updateStatCards(allStudentData, allAuthRecords);

        // 알림판 업데이트 (study_results_v3 + 스케줄 기반)
        updateAlertBoard(allStudentData, v3Records, scheduleData);

        // 필터 적용 및 렌더링
        applyFilters();

        loading.style.display = 'none';
        studyTable.style.display = 'block';

    } catch (error) {
        console.error('Failed to load study data:', error);
        loading.innerHTML = '<p style="color: #ef4444;">데이터 로드에 실패했습니다.</p>';
    }
}

// ===== 통계 카드 업데이트 =====
function updateStatCards(students, authRecords) {
    // 통계는 진행 중인 학생만 (종료/환불/중도포기 제외)
    const activeOnly = students.filter(s => {
        const ls = getAppLiveStatus({ deposit_confirmed_by_admin: true, schedule_start: s.scheduleStart, schedule_end: s.scheduleEnd, app_status: s.appStatus });
        return !ls || (ls.key !== 'completed' && ls.key !== 'refunded' && ls.key !== 'dropped');
    });
    document.getElementById('activeStudents').textContent = activeOnly.length;

    // 어제 미제출
    const yesterdayMissing = activeOnly.filter(s => {
        return s.consecutiveMissing >= 1;
    }).length;
    document.getElementById('yesterdayMissing').textContent = yesterdayMissing;

    // 평균 인증률 (study_results_v3 기반, 진행 중만)
    const studentsWithTasks = activeOnly.filter(s => s.totalDeadlinedTasks > 0);
    const totalAuth = studentsWithTasks.reduce((sum, s) => sum + s.avgAuthRate, 0);
    const avgAuth = studentsWithTasks.length > 0 ? Math.round(totalAuth / studentsWithTasks.length) : 0;
    document.getElementById('avgAuthRate').textContent = avgAuth + '%';

    // 알림 (fraud + 연속미제출 2일+, 진행 중만)
    const fraudCount = activeOnly.filter(s => s.hasFraud).length;
    const consecutiveCount = activeOnly.filter(s => s.consecutiveMissing >= 2).length;
    document.getElementById('alertCount').textContent = fraudCount + consecutiveCount;
}

// ===== 필터 적용 =====
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const programFilter = document.getElementById('programFilter').value;
    const weekFilter = document.getElementById('weekFilter').value;
    const sortBy = document.getElementById('sortBy').value;

    filteredStudentData = allStudentData.filter(s => {
        if (searchTerm && !s.name.toLowerCase().includes(searchTerm)) return false;
        if (programFilter && s.programType !== programFilter) return false;
        if (weekFilter && s.currentWeek !== parseInt(weekFilter)) return false;
        return true;
    });

    // 정렬 (종료/환불/중도포기 → 하단, 미시작 → 그 위)
    filteredStudentData.sort((a, b) => {
        const aLive = getAppLiveStatus({ deposit_confirmed_by_admin: true, schedule_start: a.scheduleStart, schedule_end: a.scheduleEnd, app_status: a.appStatus });
        const bLive = getAppLiveStatus({ deposit_confirmed_by_admin: true, schedule_start: b.scheduleStart, schedule_end: b.scheduleEnd, app_status: b.appStatus });
        const aEnded = aLive && (aLive.key === 'completed' || aLive.key === 'refunded' || aLive.key === 'dropped');
        const bEnded = bLive && (bLive.key === 'completed' || bLive.key === 'refunded' || bLive.key === 'dropped');

        // 종료된 학생 하단
        if (aEnded !== bEnded) return aEnded ? 1 : -1;

        const aBeforeStart = new Date(a.scheduleStart) > new Date();
        const bBeforeStart = new Date(b.scheduleStart) > new Date();

        // 미시작자 하단
        if (aBeforeStart !== bBeforeStart) return aBeforeStart ? 1 : -1;

        switch (sortBy) {
            case 'manage':
                // 관리 필요순: 인증률 낮은순 (과제 있는 학생 우선)
                if ((a.totalDeadlinedTasks > 0) !== (b.totalDeadlinedTasks > 0)) {
                    return a.totalDeadlinedTasks > 0 ? -1 : 1;
                }
                return a.avgAuthRate - b.avgAuthRate;
            case 'authRate_asc': return a.avgAuthRate - b.avgAuthRate;
            case 'authRate_desc': return b.avgAuthRate - a.avgAuthRate;
            case 'startDate_asc': return new Date(a.scheduleStart) - new Date(b.scheduleStart);
            case 'startDate_desc': return new Date(b.scheduleStart) - new Date(a.scheduleStart);
            case 'lastActivity_asc': return (b.daysSinceActivity || 999) - (a.daysSinceActivity || 999);
            case 'name_asc': return a.name.localeCompare(b.name, 'ko');
            default: return a.avgAuthRate - b.avgAuthRate;
        }
    });

    renderTable();
}

// ===== 테이블 렌더링 =====
function renderTable() {
    const tbody = document.getElementById('studyTableBody');
    const emptyState = document.getElementById('emptyState');
    const studyTable = document.getElementById('studyTable');

    if (filteredStudentData.length === 0) {
        studyTable.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    studyTable.style.display = 'block';
    emptyState.style.display = 'none';

    tbody.innerHTML = filteredStudentData.map(s => {
        // 운영 상태 판정
        const sLiveStatus = getAppLiveStatus({ deposit_confirmed_by_admin: true, schedule_start: s.scheduleStart, schedule_end: s.scheduleEnd, app_status: s.appStatus });
        const isEnded = sLiveStatus && (sLiveStatus.key === 'completed' || sLiveStatus.key === 'refunded' || sLiveStatus.key === 'dropped');

        // 행 스타일
        let rowStyle = '';
        const isBeforeStart = new Date(s.scheduleStart) > new Date();
        if (isBeforeStart) {
            rowStyle += 'background: #f8fafc; opacity: 0.7;';
        } else if (isEnded) {
            rowStyle += 'background: #f8fafc;';
        } else if (s.grade !== '-' && s.avgAuthRate < 50) {
            rowStyle += 'background: #fef2f2;';
        }
        if (!isEnded && s.grade !== '-' && s.consecutiveMissing >= 2) rowStyle += 'border-left: 4px solid #f59e0b;';

        const nameWarning = (!isEnded && s.grade !== '-' && s.daysSinceActivity >= 3) ? ' ⚠️' : '';

        // 이름 옆 뱃지 (종료/환불완료/중도포기)
        let statusBadge = '';
        if (sLiveStatus && isEnded) {
            statusBadge = ` <span style="display:inline-block; background:${sLiveStatus.color}; color:white; font-size:9px; font-weight:600; padding:2px 7px; border-radius:4px; margin-left:4px;"><i class="fas ${sLiveStatus.icon}" style="margin-right:2px;"></i>${sLiveStatus.label}</span>`;
        }

        // 인증률 색상 (등급 기준 연동)
        let authColor = '#22c55e';
        if (s.grade === '-') authColor = '#64748b';
        else if (s.avgAuthRate < 70) authColor = '#ef4444';
        else if (s.avgAuthRate < 80) authColor = '#f97316';
        else if (s.avgAuthRate < 90) authColor = '#f59e0b';
        else if (s.avgAuthRate < 95) authColor = '#3b82f6';

        // 최근 활동 텍스트
        let lastActivityText = '-';
        if (s.lastActivity) {
            const d = new Date(s.lastActivity);
            lastActivityText = `${d.getMonth() + 1}/${d.getDate()}`;
            if (s.daysSinceActivity >= 3) {
                lastActivityText += ` <span style="color:#ef4444; font-size:11px;">(${s.daysSinceActivity}일 전)</span>`;
            }
        }

        return `
            <tr style="${rowStyle}">
                <td>
                    <strong>${escapeHtml(s.name)}</strong>${statusBadge}${nameWarning}
                    ${s.hasFraud ? '<span style="display:inline-block; background:#ef4444; color:white; font-size:9px; padding:1px 5px; border-radius:3px; margin-left:4px;">FRAUD</span>' : ''}
                </td>
                <td style="font-size:12px; color:#64748b; white-space:nowrap;">${escapeHtml(s.email || '')}</td>
                <td>
                    <span style="display:inline-block; background:${s.programType === 'Fast' ? '#ede9fe' : '#e0f2fe'}; color:${s.programType === 'Fast' ? '#7c3aed' : '#0284c7'}; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:600;">
                        ${s.programType}
                    </span>
                </td>
                <td style="font-size:13px; white-space:nowrap;">
                    ${s.scheduleStart ? formatDateWithDay(s.scheduleStart) : '<span style="color:#94a3b8;">미정</span>'}
                    <div style="font-size:11px; margin-top:2px;">
                        ${s.scheduleStart ? getDday(s.scheduleStart) : ''}
                    </div>
                </td>
                <td>${isBeforeStart ? '<span style="color:#94a3b8; font-size:12px;">미시작</span>' : s.currentWeek + '/' + s.totalWeeks + '주'}</td>
                <td>
                    <span style="color:${authColor}; font-weight:700;">${s.authDisplay}</span>
                </td>
                <td>
                    <span style="display:inline-block; width:28px; height:28px; line-height:28px; text-align:center; background:${s.gradeColor}; color:white; border-radius:50%; font-size:13px; font-weight:700;">
                        ${s.grade}
                    </span>
                </td>
                <td>${lastActivityText}</td>
                <td style="text-align: center;">${getToeflBadge(s.toeflCount)}</td>
                <td>
                    <button onclick="window.location.href='admin-study-detail-v3.html?id=${s.userId}'" 
                            style="background:#7c3aed; color:white; border:none; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">
                        <i class="fas fa-eye"></i> 상세
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// HTML escape
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== KST 기준 어제 날짜 =====
function getYesterdayDateKST() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    if (kst.getUTCHours() < 4) {
        kst.setUTCDate(kst.getUTCDate() - 2);
    } else {
        kst.setUTCDate(kst.getUTCDate() - 1);
    }
    return kst.toISOString().split('T')[0];
}

// 요일 이름
function getDayName(dateStr) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[new Date(dateStr).getDay()] + '요일';
}

// ===== 오늘의 알림판 (study_results_v3 + 스케줄 기반) =====
function updateAlertBoard(students, v3Records, scheduleData) {
    const alertList = document.getElementById('alertList');
    const alertBadge = document.getElementById('alertBadge');
    const alerts = [];

    const today = getEffectiveToday();
    const dayEngNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // 테스트 계정 제외
    const TEST_ACCOUNTS = ['홍길동', '김철수'];

    // study_results_v3를 user_id별 → (section_type|week|day) Set으로 구성
    // initial_record가 존재하면 "제출한 것"으로 판정 (상세 페이지와 동일 기준)
    const v3SubmittedMap = {};
    (v3Records || []).forEach(r => {
        if (!r.initial_record) return;
        if (!v3SubmittedMap[r.user_id]) v3SubmittedMap[r.user_id] = new Set();
        v3SubmittedMap[r.user_id].add(`${r.section_type}|${r.week}|${r.day}`);
    });

    // 진행 중인 학생만 (종료/환불/중도포기/미시작 제외)
    const activeStudents = students.filter(s => {
        const ls = getAppLiveStatus({ deposit_confirmed_by_admin: true, schedule_start: s.scheduleStart, schedule_end: s.scheduleEnd, app_status: s.appStatus });
        if (ls && (ls.key === 'completed' || ls.key === 'refunded' || ls.key === 'dropped')) return false;
        // 미시작 제외
        const startDate = new Date(s.scheduleStart);
        if (today < startDate) return false;
        return true;
    });

    activeStudents.forEach(s => {
        if (TEST_ACCOUNTS.includes(s.name)) return;

        const startDate = new Date(s.scheduleStart);
        const prog = s.programType.toLowerCase();
        const submitted = v3SubmittedMap[s.userId] || new Set();

        // 한글 요일 매핑 (study_results_v3의 day 컬럼은 한글)
        const dayEngToKr = { 'sunday': '일', 'monday': '월', 'tuesday': '화', 'wednesday': '수', 'thursday': '목', 'friday': '금', 'saturday': '토' };

        // 스케줄에서 해당 프로그램의 과제를 날짜별로 그룹핑
        // key: 'YYYY-MM-DD' → [{ section_type, week, dayKr }]
        const tasksByDate = {};
        (scheduleData || []).forEach(sched => {
            if ((sched.program || '').toLowerCase() !== prog) return;
            if (sched.week > s.totalWeeks) return;
            const dayIndex = dayEngNames.indexOf(sched.day);
            if (dayIndex < 0) return;
            const taskDate = new Date(startDate);
            taskDate.setDate(taskDate.getDate() + (sched.week - 1) * 7 + dayIndex);
            if (taskDate >= today) return;  // 오늘 이후는 제외
            if (taskDate < startDate) return;
            const dateStr = taskDate.toISOString().split('T')[0];
            const dayKr = dayEngToKr[sched.day];
            for (const sec of [sched.section1, sched.section2, sched.section3, sched.section4]) {
                const parsed = parseScheduleSection(sec);
                if (!parsed || parsed.taskType === 'unknown') continue;
                if (!tasksByDate[dateStr]) tasksByDate[dateStr] = { tasks: [], dayKr, week: sched.week };
                tasksByDate[dateStr].tasks.push({ sectionType: parsed.taskType, week: sched.week, dayKr });
            }
        });

        // 어제부터 역순으로 순회하며 연속 미제출 일수 계산
        // - 스케줄에 과제가 있는 날만 체크 (토요일 등 과제 없는 날은 자동 스킵)
        // - 해당 날의 과제 중 하나라도 제출했으면 "제출한 날"로 판정
        const missedDays = [];
        for (let d = 1; d <= 14; d++) {
            const checkDate = new Date(today);
            checkDate.setDate(checkDate.getDate() - d);
            if (checkDate < startDate) break;
            const dateStr = checkDate.toISOString().split('T')[0];

            // 이 날에 스케줄상 과제가 없으면 건너뜀
            const dayTasks = tasksByDate[dateStr];
            if (!dayTasks || dayTasks.tasks.length === 0) continue;

            // 이 날의 과제 중 하나라도 제출했는지 확인
            const hasAnySubmission = dayTasks.tasks.some(t =>
                submitted.has(`${t.sectionType}|${t.week}|${t.dayKr}`)
            );

            if (!hasAnySubmission) {
                const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                missedDays.push(dayNames[checkDate.getDay()]);
            } else {
                break;  // 제출한 날을 만나면 중단
            }
        }

        if (missedDays.length >= 2) {
            alerts.push({
                type: 'consecutive',
                color: '#f59e0b',
                icon: '⚠️',
                title: `${s.name} - ${missedDays.length}일 연속 미제출 (${missedDays.reverse().join(', ')})`,
                subtitle: `${s.programType} ${s.totalWeeks}주 | ${s.currentWeek}주차 | 인증률 ${s.avgAuthRate}%`,
                userId: s.userId
            });
        }
    });

    // 연속 미제출 일수 많은 순으로 정렬
    alerts.sort((a, b) => {
        const aDays = parseInt(a.title.match(/(\d+)일/)?.[1] || '0');
        const bDays = parseInt(b.title.match(/(\d+)일/)?.[1] || '0');
        return bDays - aDays;
    });

    // 렌더링
    if (alerts.length === 0) {
        alertList.innerHTML = `
            <div style="padding: 32px; text-align: center; color: #22c55e;">
                <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                <p style="margin-top: 12px; font-weight: 600;">오늘은 특이사항 없습니다</p>
            </div>
        `;
        alertBadge.style.display = 'none';
    } else {
        alertBadge.textContent = alerts.length;
        alertBadge.style.display = 'inline-block';

        alertList.innerHTML = alerts.map(a => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-left:4px solid ${a.color}; background:#fffbeb; border-radius:0 8px 8px 0; margin-bottom:8px;">
                <div style="flex:1;">
                    <div style="font-size:14px; font-weight:600; color:#1e293b;">
                        ${a.icon} ${escapeHtml(a.title)}
                    </div>
                    <div style="font-size:12px; color:#64748b; margin-top:4px;">
                        ${escapeHtml(a.subtitle)}
                    </div>
                </div>
                <button onclick="window.location.href='admin-study-detail-v3.html?id=${a.userId}'" 
                        style="background:white; border:1px solid #e2e8f0; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; color:#475569; font-weight:500; white-space:nowrap; margin-left:12px;">
                    학생 보기 <i class="fas fa-chevron-right" style="font-size:10px;"></i>
                </button>
            </div>
        `).join('');
    }
}

// ===== 토플 응시 배지 =====
function getToeflBadge(count) {
    if (count === 0) {
        return '<span style="display:inline-flex; align-items:center; gap:4px; background:#fef2f2; color:#ef4444; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">' +
            '<i class="fas fa-exclamation-circle"></i> 0/2</span>';
    } else if (count === 1) {
        return '<span style="display:inline-flex; align-items:center; gap:4px; background:#fffbeb; color:#d97706; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">' +
            '<i class="fas fa-clock"></i> 1/2</span>';
    } else {
        return '<span style="display:inline-flex; align-items:center; gap:4px; background:#dcfce7; color:#16a34a; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">' +
            '<i class="fas fa-check-circle"></i> ' + count + '/2</span>';
    }
}
