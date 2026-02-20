// ===== 학습 관리 (admin-study.js) =====

let allStudentData = [];
let filteredStudentData = [];

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
        // 1. 진행 중인 학생 조회: 입금 확인 완료 + 프로그램 기간 내
        const apps = await supabaseAPI.query('applications', {
            'deposit_confirmed_by_admin': 'eq.true',
            'limit': '500'
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 진행 중인 학생 필터링 (schedule_start 지남 & schedule_end 안 지남)
        const activeApps = (apps || []).filter(app => {
            if (!app.schedule_start) return false;
            const start = new Date(app.schedule_start);
            const end = app.schedule_end ? new Date(app.schedule_end) : null;
            // 시작일이 지났고, 종료일이 없거나 아직 안 지난 경우
            // 종료일 + 7일 여유 (마지막 주 데이터 확인용)
            if (end) {
                const endPlus7 = new Date(end);
                endPlus7.setDate(endPlus7.getDate() + 7);
                return start <= today && today <= endPlus7;
            }
            return start <= today;
        });

        if (activeApps.length === 0) {
            loading.style.display = 'none';
            emptyState.style.display = 'block';
            updateStatCards([], []);
            return;
        }

        // 2. 해당 학생들의 user_id 수집
        const userEmails = activeApps.map(a => a.email).filter(Boolean);
        const users = await supabaseAPI.query('users', { 'limit': '500' });
        const userMap = {};
        (users || []).forEach(u => { userMap[u.email] = u; });

        // user_id 목록
        const userIds = activeApps.map(app => {
            const user = userMap[app.email];
            return user ? user.id : null;
        }).filter(Boolean);

        // 3. tr_study_records 전체 조회
        const studyRecords = await supabaseAPI.query('tr_study_records', { 'limit': '10000' });
        const allRecords = (studyRecords || []).filter(r => userIds.includes(r.user_id));

        // 4. tr_auth_records 전체 조회
        const authRecords = await supabaseAPI.query('tr_auth_records', { 'limit': '10000' });
        const allAuthRecords = (authRecords || []).filter(r => userIds.includes(r.user_id));

        // 5. 학생별 데이터 조합
        allStudentData = activeApps.map(app => {
            const user = userMap[app.email];
            if (!user) return null;

            const userId = user.id;
            const myRecords = allRecords.filter(r => r.user_id === userId);
            const myAuthRecords = allAuthRecords.filter(r => r.user_id === userId);

            const startDate = new Date(app.schedule_start);
            const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
            const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);

            // 프로그램 타입
            const programType = (app.assigned_program || app.preferred_program || '').includes('Fast') ? 'Fast' : 'Standard';
            const totalWeeks = programType === 'Fast' ? 4 : 8;

            // 마감된 과제 수 계산 (하루 4개 과제, 주 6일)
            const tasksPerDay = 4;
            const daysPerWeek = 6;
            const elapsedWeeks = Math.min(currentWeek, totalWeeks);
            // 이번 주 경과 일수 (일요일 시작 기준, 주 6일: 일~금)
            const dayOfWeek = today.getDay(); // 0=일, 1=월, ..., 5=금, 6=토
            const daysThisWeek = currentWeek <= totalWeeks ? Math.min(dayOfWeek === 0 ? 0 : dayOfWeek, daysPerWeek) : 0;
            const completedDays = (Math.max(0, elapsedWeeks - 1) * daysPerWeek) + daysThisWeek;
            const totalDeadlinedTasks = completedDays * tasksPerDay;

            // 인증률 계산
            const totalAuthRate = myAuthRecords.reduce((sum, r) => sum + (r.auth_rate || 0), 0);
            const avgAuthRate = totalDeadlinedTasks > 0 ? Math.round(totalAuthRate / totalDeadlinedTasks) : 0;

            // 이번 주 / 저번 주 인증률 (추세 계산용)
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

            // 추세
            let trend = '→';
            let trendColor = '#94a3b8';
            if (thisWeekAvg > lastWeekAvg + 5) { trend = '↑'; trendColor = '#22c55e'; }
            else if (thisWeekAvg < lastWeekAvg - 5) { trend = '↓'; trendColor = '#ef4444'; }

            // 등급
            let grade = 'D';
            if (avgAuthRate >= 90) grade = 'A';
            else if (avgAuthRate >= 75) grade = 'B';
            else if (avgAuthRate >= 60) grade = 'C';

            const gradeColors = { A: '#22c55e', B: '#3b82f6', C: '#f59e0b', D: '#ef4444' };

            // 이번 주 잔디 (일~금)
            const weekGrass = [];
            for (let d = 0; d < 6; d++) {
                const checkDate = new Date(thisWeekStart);
                checkDate.setDate(checkDate.getDate() + d);
                
                if (checkDate > today) {
                    weekGrass.push('⬜'); // 아직 안 된 날
                    continue;
                }

                const dateStr = checkDate.toISOString().split('T')[0];
                const dayRecords = myRecords.filter(r => {
                    const rDate = new Date(r.completed_at).toISOString().split('T')[0];
                    return rDate === dateStr;
                });

                const uniqueTypes = new Set(dayRecords.map(r => r.task_type));
                if (uniqueTypes.size >= 4) weekGrass.push('🟩');
                else if (uniqueTypes.size > 0) weekGrass.push('🟨');
                else weekGrass.push('🟥');
            }

            // 제출률
            const submittedTasks = myRecords.length;
            const submitRate = totalDeadlinedTasks > 0 ? Math.round((submittedTasks / totalDeadlinedTasks) * 100) : 0;

            // 최근 활동
            const lastActivity = myRecords.length > 0 
                ? Math.max(...myRecords.map(r => new Date(r.completed_at).getTime()))
                : null;
            const daysSinceActivity = lastActivity 
                ? Math.floor((today - lastActivity) / (1000 * 60 * 60 * 24))
                : 999;

            // 연속 미제출 일수
            let consecutiveMissing = 0;
            for (let d = 1; d <= 7; d++) {
                const checkDate = new Date(today);
                checkDate.setDate(checkDate.getDate() - d);
                if (checkDate < startDate) break;
                const checkDay = checkDate.getDay();
                if (checkDay === 6) continue; // 토요일 스킵
                const dateStr = checkDate.toISOString().split('T')[0];
                const hasRecord = myRecords.some(r => new Date(r.completed_at).toISOString().split('T')[0] === dateStr);
                if (!hasRecord) consecutiveMissing++;
                else break;
            }

            // fraud 여부
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
                trend,
                trendColor,
                grade,
                gradeColor: gradeColors[grade],
                weekGrass,
                submitRate,
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

    // 평균 인증률
    const totalAuth = students.reduce((sum, s) => sum + s.avgAuthRate, 0);
    const avgAuth = students.length > 0 ? Math.round(totalAuth / students.length) : 0;
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

    // 정렬
    filteredStudentData.sort((a, b) => {
        switch (sortBy) {
            case 'authRate_asc': return a.avgAuthRate - b.avgAuthRate;
            case 'authRate_desc': return b.avgAuthRate - a.avgAuthRate;
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
        if (s.avgAuthRate < 50) rowStyle += 'background: #fef2f2;';
        if (s.consecutiveMissing >= 2) rowStyle += 'border-left: 4px solid #f59e0b;';

        // 이름 경고
        const nameWarning = s.daysSinceActivity >= 3 ? ' ⚠️' : '';

        // 인증률 색상
        let authColor = '#22c55e';
        if (s.avgAuthRate < 60) authColor = '#ef4444';
        else if (s.avgAuthRate < 75) authColor = '#f59e0b';
        else if (s.avgAuthRate < 90) authColor = '#3b82f6';

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
                <td>${s.currentWeek}/${s.totalWeeks}주</td>
                <td>
                    <span style="color:${authColor}; font-weight:700;">${s.avgAuthRate}%</span>
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
                <td>${s.submitRate}%</td>
                <td>${lastActivityText}</td>
                <td>
                    <button onclick="window.location.href='admin-study-detail.html?id=${s.userId}'" 
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
    // KST = UTC + 9
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    // 새벽 4시 기준: 4시 이전이면 이틀 전이 "어제"
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
    const yesterdayDay = new Date(yesterday).getDay(); // 0=일, 6=토

    // 어제가 토요일(6) 또는 일요일(0)이면 미제출 알림 스킵
    const isWeekday = yesterdayDay >= 1 && yesterdayDay <= 5;

    const now = new Date();
    const oneDayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;

    students.forEach(s => {
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
            // 연속 미제출 날짜들
            const missedDays = [];
            const startDate = new Date(s.scheduleStart);
            for (let d = 1; d <= s.consecutiveMissing + 3; d++) {
                const checkDate = new Date(now);
                checkDate.setDate(checkDate.getDate() - d);
                if (checkDate < startDate) break;
                const checkDay = checkDate.getDay();
                if (checkDay === 6 || checkDay === 0) continue; // 토/일 스킵
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

        // --- 🔴 어제 미제출 (평일만) ---
        if (isWeekday) {
            const yesterdayRecords = myRecords.filter(r => {
                return new Date(r.completed_at).toISOString().split('T')[0] === yesterday;
            });
            const uniqueTypes = new Set(yesterdayRecords.map(r => r.task_type));
            if (uniqueTypes.size === 0) {
                // 연속 미제출 알림에 이미 포함된 경우 스킵
                if (s.consecutiveMissing < 2) {
                    alerts.push({
                        priority: 3,
                        type: 'missing',
                        color: '#ef4444',
                        icon: '🔴',
                        title: `${s.name} - ${getDayName(yesterday)} 과제 전체 미제출`,
                        subtitle: `${s.programType} ${s.totalWeeks}주 | ${s.currentWeek}주차 | 현재 인증률 ${s.avgAuthRate}%`,
                        userId: s.userId
                    });
                }
            } else if (uniqueTypes.size < 4) {
                alerts.push({
                    priority: 3,
                    type: 'missing',
                    color: '#ef4444',
                    icon: '🔴',
                    title: `${s.name} - ${getDayName(yesterday)} 과제 ${uniqueTypes.size}/4개만 제출`,
                    subtitle: `${s.programType} ${s.totalWeeks}주 | ${s.currentWeek}주차 | 현재 인증률 ${s.avgAuthRate}%`,
                    userId: s.userId
                });
            }
        }

        // --- 🟡 마감 직전 제출 (어제 새벽 0~4시 KST) ---
        const lateRecords = myRecords.filter(r => {
            const completedDate = new Date(r.completed_at).toISOString().split('T')[0];
            if (completedDate !== yesterday) return false;
            const completedTime = new Date(r.completed_at);
            // KST로 변환
            const kstHour = (completedTime.getUTCHours() + 9) % 24;
            return kstHour >= 0 && kstHour < 4;
        });
        if (lateRecords.length > 0) {
            const latestTime = new Date(Math.max(...lateRecords.map(r => new Date(r.completed_at).getTime())));
            const kstHour = (latestTime.getUTCHours() + 9) % 24;
            const kstMin = latestTime.getUTCMinutes();
            const ampm = kstHour < 12 ? 'AM' : 'PM';
            const displayHour = kstHour === 0 ? 12 : kstHour > 12 ? kstHour - 12 : kstHour;
            alerts.push({
                priority: 4,
                type: 'late',
                color: '#eab308',
                icon: '🟡',
                title: `${s.name} - ${getDayName(yesterday)} 과제 새벽 ${displayHour}:${String(kstMin).padStart(2, '0')} ${ampm} 제출`,
                subtitle: `${s.programType} ${s.totalWeeks}주 | ${s.currentWeek}주차 | 습관 주의`,
                userId: s.userId
            });
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
                <button onclick="window.location.href='admin-study-detail.html?id=${a.userId}'" 
                        style="background:white; border:1px solid #e2e8f0; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; color:#475569; font-weight:500; white-space:nowrap; margin-left:12px;">
                    학생 보기 <i class="fas fa-chevron-right" style="font-size:10px;"></i>
                </button>
            </div>
        `).join('');
    }
}
