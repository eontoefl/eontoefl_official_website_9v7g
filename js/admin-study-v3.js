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

        // 진행 중인 학생 필터링 (시작일 설정됨 + 종료일+7일 안 지남)
        const activeApps = (apps || []).filter(app => {
            if (!app.schedule_start) return false;
            const end = app.schedule_end ? new Date(app.schedule_end) : null;
            if (end) {
                const endPlus7 = new Date(end);
                endPlus7.setDate(endPlus7.getDate() + 7);
                return today <= endPlus7;
            }
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
        const studyRecords = await supabaseAPI.query('tr_study_records', { 'limit': '10000' });
        const allRecords = (studyRecords || []).filter(r => userIds.includes(r.user_id));

        // 4. tr_auth_records (fraud/알림용 — 여전히 필요)
        const authRecords = await supabaseAPI.query('tr_auth_records', { 'limit': '10000' });
        const allAuthRecords = (authRecords || []).filter(r => userIds.includes(r.user_id));

        // 5. 스케줄 데이터 (잔디/알림용)
        const scheduleData = await supabaseAPI.query('tr_schedule_assignment', { 'limit': '500' });
        scheduleLookup = {};
        (scheduleData || []).forEach(s => {
            const prog = (s.program || '').toLowerCase();
            if (!scheduleLookup[prog]) scheduleLookup[prog] = {};
            const taskCount = [s.section1, s.section2, s.section3, s.section4].filter(v => v && v.trim() !== '').length;
            scheduleLookup[prog][`${s.week}_${s.day}`] = taskCount;
        });

        // 6. ★ tr_student_stats (테스트룸이 계산한 인증률/등급/제출률/환급)
        const allStats = await supabaseAPI.query('tr_student_stats', { 'limit': '500' });
        const statsMap = {};
        (allStats || []).forEach(st => { statsMap[st.user_id] = st; });

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

            // ── ★ tr_student_stats에서 읽기 (테스트룸 계산 결과) ──
            const stats = statsMap[userId] || {};
            const avgAuthRate = stats.calc_auth_rate || 0;
            const grade = stats.calc_grade || '-';
            const totalDeadlinedTasks = stats.calc_tasks_due || 0;
            const submittedTasksCount = stats.calc_tasks_submitted || 0;

            // 시작 전 여부
            const isBeforeStart = today < startDate;

            // ── calc_tasks_due 기준 3분기 (테스트룸 개발자 포맷) ──
            const submitRate = stats.calc_submit_rate || 0;

            // 인증률 표시
            let authDisplay = '-';
            if (totalDeadlinedTasks > 0) {
                authDisplay = `${avgAuthRate}%`;
            } else if (totalDeadlinedTasks === 0 && submittedTasksCount > 0) {
                authDisplay = `${avgAuthRate}%`;
            } else {
                authDisplay = '-';
            }

            // 등급 표시
            let displayGrade;
            if (totalDeadlinedTasks > 0) {
                displayGrade = grade;
            } else {
                displayGrade = '-';
            }
            const gradeColor = (displayGrade !== '-') ? getGradeColor(grade) : '#94a3b8';

            // 제출률 표시
            let submitDisplay = '-';
            if (totalDeadlinedTasks > 0) {
                submitDisplay = `${submitRate}%`;
            } else if (totalDeadlinedTasks === 0 && submittedTasksCount > 0) {
                submitDisplay = `${submittedTasksCount}건 미리 완료 🎉`;
            } else {
                submitDisplay = '0%';
            }

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
                submitRate,
                submitDisplay,
                totalDeadlinedTasks,
                lastActivity,
                daysSinceActivity,
                consecutiveMissing,
                hasFraud,
                scheduleStart: app.schedule_start
            };
        }).filter(Boolean);

        // 통계 카드 업데이트
        updateStatCards(allStudentData, allAuthRecords);

        // 알림판 업데이트
        updateAlertBoard(allStudentData, allRecords, allAuthRecords);

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
    document.getElementById('activeStudents').textContent = students.length;

    // 어제 미제출
    const yesterdayMissing = students.filter(s => {
        return s.consecutiveMissing >= 1;
    }).length;
    document.getElementById('yesterdayMissing').textContent = yesterdayMissing;

    // 평균 인증률 (tr_student_stats 기반)
    const studentsWithTasks = students.filter(s => s.totalDeadlinedTasks > 0);
    const totalAuth = studentsWithTasks.reduce((sum, s) => sum + s.avgAuthRate, 0);
    const avgAuth = studentsWithTasks.length > 0 ? Math.round(totalAuth / studentsWithTasks.length) : 0;
    document.getElementById('avgAuthRate').textContent = avgAuth + '%';

    // 알림 (fraud + 연속미제출 2일+)
    const fraudCount = students.filter(s => s.hasFraud).length;
    const consecutiveCount = students.filter(s => s.consecutiveMissing >= 2).length;
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

    // 정렬 (미시작자는 항상 하단)
    filteredStudentData.sort((a, b) => {
        const aStarted = a.totalDeadlinedTasks > 0 || a.avgAuthRate > 0 ? 1 : (new Date(a.scheduleStart) <= new Date() ? 1 : 0);
        const bStarted = b.totalDeadlinedTasks > 0 || b.avgAuthRate > 0 ? 1 : (new Date(b.scheduleStart) <= new Date() ? 1 : 0);
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
            case 'submitRate_asc': return a.submitRate - b.submitRate;
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
        // 행 스타일
        let rowStyle = '';
        const isBeforeStart = new Date(s.scheduleStart) > new Date();
        if (isBeforeStart) {
            rowStyle += 'background: #f8fafc; opacity: 0.7;';
        } else if (s.grade !== '-' && s.avgAuthRate < 50) {
            rowStyle += 'background: #fef2f2;';
        }
        if (s.grade !== '-' && s.consecutiveMissing >= 2) rowStyle += 'border-left: 4px solid #f59e0b;';

        const nameWarning = (s.grade !== '-' && s.daysSinceActivity >= 3) ? ' ⚠️' : '';

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
                    <strong>${escapeHtml(s.name)}</strong>${nameWarning}
                    ${s.hasFraud ? '<span style="display:inline-block; background:#ef4444; color:white; font-size:9px; padding:1px 5px; border-radius:3px; margin-left:4px;">FRAUD</span>' : ''}
                </td>
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
                    <span style="color:${s.trendColor}; font-size:18px; font-weight:700;">${s.trend}</span>
                </td>
                <td>
                    <span style="display:inline-block; width:28px; height:28px; line-height:28px; text-align:center; background:${s.gradeColor}; color:white; border-radius:50%; font-size:13px; font-weight:700;">
                        ${s.grade}
                    </span>
                </td>
                <td>
                    <div style="display:flex; gap:3px; font-size:14px;">
                        ${s.weekGrass.map(g => `<span>${g}</span>`).join('')}
                    </div>
                </td>
                <td>${s.submitDisplay}</td>
                <td>${lastActivityText}</td>
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

// ===== 오늘의 알림판 =====
function updateAlertBoard(students, allRecords, allAuthRecords) {
    const alertList = document.getElementById('alertList');
    const alertBadge = document.getElementById('alertBadge');
    const alerts = [];

    const yesterday = getYesterdayDateKST();
    const yesterdayDay = new Date(yesterday).getDay();

    const isWeekday = yesterdayDay !== 6;

    const now = new Date();
    const oneDayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;

    // 테스트 계정 제외
    const TEST_ACCOUNTS = ['홍길동', '김철수'];

    students.forEach(s => {
        if (TEST_ACCOUNTS.includes(s.name)) return;

        const myRecords = allRecords.filter(r => r.user_id === s.userId);
        const myAuthRecords = allAuthRecords.filter(r => r.user_id === s.userId);

        // --- 🚨 Fraud 감지 (최근 24시간) ---
        const recentFraud = myAuthRecords.filter(r => {
            const t = new Date(r.created_at).getTime();
            return t >= oneDayAgoMs && r.fraud_flag;
        });
        recentFraud.forEach(fr => {
            const detail = [];
            if (fr.no_text_flag) detail.push('텍스트 미입력');
            if (fr.no_selection_flag) detail.push('선택지 미선택');
            if (fr.focus_lost_count > 3) detail.push(`창 이탈 ${fr.focus_lost_count}회`);
            alerts.push({
                priority: 1,
                type: 'fraud',
                color: '#ef4444',
                icon: '🚨',
                title: `${s.name} - ${detail.join(', ') || 'Fraud 감지'}`,
                subtitle: `${s.programType} ${s.totalWeeks}주 | ${s.currentWeek}주차 | fraud_flag = true`,
                userId: s.userId
            });
        });

        // --- 🟠 연속 미제출 2일+ (이탈 위험) ---
        if (s.consecutiveMissing >= 2) {
            const missedDays = [];
            const startDate = new Date(s.scheduleStart);
            for (let d = 1; d <= s.consecutiveMissing + 3; d++) {
                const checkDate = new Date(now);
                checkDate.setDate(checkDate.getDate() - d);
                if (checkDate < startDate) break;
                const checkDay = checkDate.getDay();
                if (checkDay === 6 || checkDay === 0) continue;
                const dateStr = checkDate.toISOString().split('T')[0];
                const hasRecord = myRecords.some(r => new Date(r.completed_at).toISOString().split('T')[0] === dateStr);
                if (!hasRecord) missedDays.push(getDayName(dateStr).replace('요일', ''));
                else break;
            }
            if (missedDays.length >= 2) {
                alerts.push({
                    priority: 2,
                    type: 'consecutive',
                    color: '#f59e0b',
                    icon: '⚠️',
                    title: `${s.name} - ${missedDays.length}일 연속 미제출 (${missedDays.reverse().join(', ')})`,
                    subtitle: `${s.programType} ${s.totalWeeks}주 | ${s.currentWeek}주차 | 인증률 ${s.avgAuthRate}% → 이탈 위험`,
                    userId: s.userId
                });
            }
        }


    });

    // 우선순위 정렬
    alerts.sort((a, b) => a.priority - b.priority);

    // 렌더링
    if (alerts.length === 0) {
        alertList.innerHTML = `
            <div style="padding: 32px; text-align: center; color: #22c55e;">
                <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                <p style="margin-top: 12px; font-weight: 600;">✅ 오늘은 특이사항 없습니다</p>
            </div>
        `;
        alertBadge.style.display = 'none';
    } else {
        alertBadge.textContent = alerts.length;
        alertBadge.style.display = 'inline-block';

        alertList.innerHTML = alerts.map(a => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-left:4px solid ${a.color}; background:${a.type === 'fraud' ? '#fef2f2' : a.type === 'consecutive' ? '#fffbeb' : a.type === 'missing' ? '#fef2f2' : '#fefce8'}; border-radius:0 8px 8px 0; margin-bottom:8px;">
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
