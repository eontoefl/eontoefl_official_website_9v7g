// ===== 학습 관리 (admin-study.js) =====

let allStudentData = [];
let filteredStudentData = [];
let weeklyCheckPendingDrafts = [];  // 주간체크 승인대기 drafts (전체)

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

            // ── 최근 활동 (study_results_v3 기반) ──
            const v3Completed = myV3.filter(r => r.completed_at).map(r => new Date(r.completed_at).getTime());
            const lastActivity = v3Completed.length > 0
                ? Math.max(...v3Completed)
                : null;
            const daysSinceActivity = lastActivity
                ? Math.floor((today - lastActivity) / (1000 * 60 * 60 * 24))
                : 999;

            // ── 연속 미제출 일수 (study_results_v3 + 스케줄 기반, 알림판과 동일 기준) ──
            // v3 제출 Set 구성
            const myV3Submitted = new Set();
            myV3.forEach(r => {
                if (r.initial_record) myV3Submitted.add(`${r.section_type}|${r.week}|${r.day}`);
            });

            const dayEngToKrLocal = { 'sunday': '일', 'monday': '월', 'tuesday': '화', 'wednesday': '수', 'thursday': '목', 'friday': '금', 'saturday': '토' };

            // 스케줄에서 이 학생의 날짜별 과제 그룹핑
            const myTasksByDate = {};
            (scheduleData || []).forEach(sched => {
                if ((sched.program || '').toLowerCase() !== prog) return;
                if (sched.week > totalWeeks) return;
                const dayIndex = dayEngNames.indexOf(sched.day);
                if (dayIndex < 0) return;
                const taskDate = new Date(startDate);
                taskDate.setDate(taskDate.getDate() + (sched.week - 1) * 7 + dayIndex);
                if (taskDate >= today) return;
                if (taskDate < startDate) return;
                const dateStr = taskDate.toISOString().split('T')[0];
                const dayKr = dayEngToKrLocal[sched.day];
                for (const sec of [sched.section1, sched.section2, sched.section3, sched.section4]) {
                    const parsed = parseScheduleSection(sec);
                    if (!parsed || parsed.taskType === 'unknown') continue;
                    if (!myTasksByDate[dateStr]) myTasksByDate[dateStr] = [];
                    myTasksByDate[dateStr].push({ sectionType: parsed.taskType, week: sched.week, dayKr });
                }
            });

            let consecutiveMissing = 0;
            for (let d = 1; d <= 14; d++) {
                const checkDate = new Date(today);
                checkDate.setDate(checkDate.getDate() - d);
                if (checkDate < startDate) break;
                const dateStr = checkDate.toISOString().split('T')[0];
                const dayTasks = myTasksByDate[dateStr];
                if (!dayTasks || dayTasks.length === 0) continue; // 과제 없는 날은 스킵
                const hasAny = dayTasks.some(t => myV3Submitted.has(`${t.sectionType}|${t.week}|${t.dayKr}`));
                if (!hasAny) consecutiveMissing++;
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

        // 주간체크 pending drafts 조회
        try {
            weeklyCheckPendingDrafts = await supabaseAPI.query('tr_weekly_check_drafts', {
                'status': 'in.(pending,skipped)',
                'order': 'created_at.desc',
                'limit': '100'
            }) || [];
        } catch (e) {
            console.warn('주간체크 drafts 조회 실패:', e);
            weeklyCheckPendingDrafts = [];
        }

        // 통계 카드 업데이트
        updateStatCards(allStudentData, allAuthRecords);

        // 알림판 업데이트 (study_results_v3 + 스케줄 기반 + 주간체크)
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
        // 스라첨삭 뱃지
        if (s.app && s.app.correction_enabled) {
            const corrStatus = typeof getCorrectionStatus === 'function' ? getCorrectionStatus(s.app) : null;
            const corrLabel = corrStatus ? corrStatus.label : '첨삭';
            const corrColor = corrStatus ? corrStatus.color : '#3b82f6';
            statusBadge += ` <span style="display:inline-block; background:${corrColor}; color:white; font-size:9px; font-weight:600; padding:2px 7px; border-radius:4px; margin-left:4px;"><i class="fas fa-pen-nib" style="margin-right:2px;"></i>${corrLabel}</span>`;
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
// 캐싱: refreshAlertBoardAfterBatch에서 v3Records/scheduleData 없이 재호출 시 사용
let _cachedV3Records = null;
let _cachedScheduleData = null;

function updateAlertBoard(students, v3Records, scheduleData) {
    // 캐싱 처리
    if (v3Records != null) _cachedV3Records = v3Records;
    if (scheduleData != null) _cachedScheduleData = scheduleData;
    v3Records = _cachedV3Records || [];
    scheduleData = _cachedScheduleData || [];

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

    // ── 주간체크 알림 (pending drafts) ──
    const pendingDrafts = weeklyCheckPendingDrafts.filter(d => d.status === 'pending');
    let weeklyCheckAlertHtml = '';
    if (pendingDrafts.length > 0) {
        const names = pendingDrafts.map(d => d.student_name || '학생');
        const firstName = names[0];
        const fastCount = pendingDrafts.filter(d => (d.program_type || '').toLowerCase().includes('fast')).length;
        const stdCount = pendingDrafts.length - fastCount;
        const programInfo = [fastCount > 0 ? `Fast ${fastCount}명` : '', stdCount > 0 ? `Standard ${stdCount}명` : ''].filter(Boolean).join(' · ');
        const createdAt = pendingDrafts[0].created_at ? new Date(pendingDrafts[0].created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const titleText = pendingDrafts.length === 1
            ? `${firstName}님의 주간체크가 등록되었습니다`
            : `${firstName} 외 ${pendingDrafts.length - 1}명의 주간체크가 등록되었습니다`;

        weeklyCheckAlertHtml = `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-left:4px solid #7c3aed; background:#f5f3ff; border-radius:0 8px 8px 0; margin-bottom:8px;">
                <div style="flex:1;">
                    <div style="font-size:14px; font-weight:600; color:#1e293b;">
                        <i class="fas fa-clipboard-check" style="color:#7c3aed;"></i> ${escapeHtml(titleText)}
                    </div>
                    <div style="font-size:12px; color:#64748b; margin-top:4px;">
                        ${programInfo}${createdAt ? ' | ' + createdAt + ' 생성' : ''}
                    </div>
                </div>
                <button onclick="openBatchReviewModal()" 
                        style="background:#7c3aed; color:white; border:none; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; white-space:nowrap; margin-left:12px;">
                    일괄 확인하기 <i class="fas fa-arrow-right" style="font-size:10px;"></i>
                </button>
            </div>`;
    }

    // 렌더링
    const totalAlertCount = alerts.length + (pendingDrafts.length > 0 ? 1 : 0);
    if (totalAlertCount === 0) {
        alertList.innerHTML = `
            <div style="padding: 32px; text-align: center; color: #22c55e;">
                <i class="fas fa-check-circle" style="font-size: 32px;"></i>
                <p style="margin-top: 12px; font-weight: 600;">오늘은 특이사항 없습니다</p>
            </div>
        `;
        alertBadge.style.display = 'none';
    } else {
        alertBadge.textContent = totalAlertCount;
        alertBadge.style.display = 'inline-block';

        const consecutiveAlertsHtml = alerts.map(a => `
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

        alertList.innerHTML = weeklyCheckAlertHtml + consecutiveAlertsHtml;
    }
}

// ===== 주간체크 일괄검토 모달 =====

let batchReviewCurrentIndex = 0;

function openBatchReviewModal() {
    const pendingDrafts = weeklyCheckPendingDrafts.filter(d => d.status === 'pending');
    const skippedDrafts = weeklyCheckPendingDrafts.filter(d => d.status === 'skipped');

    if (pendingDrafts.length === 0 && skippedDrafts.length === 0) {
        alert('검토할 주간체크가 없습니다.');
        return;
    }

    batchReviewCurrentIndex = 0;

    const existing = document.getElementById('batchReviewModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'batchReviewModal';
    modal.className = 'batch-modal-overlay';
    modal.innerHTML = `
        <div class="batch-modal">
            <div class="batch-modal-header">
                <h3><i class="fas fa-clipboard-check" style="color:#7c3aed;"></i> 주간체크 일괄 검토 <span id="batchHeaderCount" style="font-size:14px; color:#64748b; font-weight:400;">(${pendingDrafts.length}명 대기)</span></h3>
                <button class="batch-modal-close" onclick="closeBatchReviewModal()">&times;</button>
            </div>
            <div class="batch-modal-body">
                <div class="batch-student-list" id="batchStudentList"></div>
                <div class="batch-review-area" id="batchReviewArea">
                    <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#94a3b8;">
                        <div style="text-align:center;">
                            <i class="fas fa-hand-pointer" style="font-size:32px; margin-bottom:12px;"></i>
                            <p>왼쪽에서 학생을 선택해주세요</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeBatchReviewModal(); });

    renderBatchStudentList();

    // 자동으로 첫 번째 pending 학생 선택
    if (pendingDrafts.length > 0) {
        selectBatchDraft(pendingDrafts[0].id);
    }
}

function closeBatchReviewModal() {
    const modal = document.getElementById('batchReviewModal');
    if (modal) modal.remove();
    // 알림판 새로고침 (발송 완료된 것 반영)
    refreshAlertBoardAfterBatch();
}

async function refreshAlertBoardAfterBatch() {
    try {
        weeklyCheckPendingDrafts = await supabaseAPI.query('tr_weekly_check_drafts', {
            'status': 'in.(pending,skipped)',
            'order': 'created_at.desc',
            'limit': '100'
        }) || [];
    } catch (e) {
        weeklyCheckPendingDrafts = [];
    }
    // 알림판 재렌더링 (기존 데이터 재활용)
    if (typeof updateAlertBoard === 'function' && allStudentData.length > 0) {
        updateAlertBoard(allStudentData, null, null);
    }
    // nav 뱃지 업데이트
    if (typeof updateNavWeeklyCheckBadge === 'function') {
        updateNavWeeklyCheckBadge();
    }
}

function renderBatchStudentList() {
    const listEl = document.getElementById('batchStudentList');
    if (!listEl) return;

    const pendingDrafts = weeklyCheckPendingDrafts.filter(d => d.status === 'pending');
    const skippedDrafts = weeklyCheckPendingDrafts.filter(d => d.status === 'skipped');

    let html = '';

    // pending drafts
    pendingDrafts.forEach((draft, idx) => {
        const weekLabel = draft.week ? `${draft.week}주차` : '';
        const programLabel = draft.program_type || '';
        const authLabel = draft.auth_rate != null ? `${draft.auth_rate}%` : '-';
        const isSent = draft.status === 'sent';

        html += `
            <div class="batch-student-item ${isSent ? 'sent' : ''}" id="batchItem_${draft.id}" onclick="selectBatchDraft('${draft.id}')">
                <div class="batch-student-status" id="batchStatus_${draft.id}">
                    <i class="fas fa-clock" style="color:#f59e0b;"></i>
                </div>
                <div class="batch-student-info">
                    <div class="batch-student-name">${escapeHtml(draft.student_name || '학생')}</div>
                    <div class="batch-student-meta">${weekLabel} · ${programLabel} · ${authLabel}</div>
                </div>
            </div>`;
    });

    // skipped drafts
    if (skippedDrafts.length > 0) {
        html += `<div class="batch-divider"><span>발송 중단</span></div>`;
        skippedDrafts.forEach(draft => {
            const weekLabel = draft.week ? `${draft.week}주차` : '';
            const inactiveWeeks = draft.consecutive_inactive_weeks || 0;
            html += `
                <div class="batch-student-item skipped" id="batchItem_${draft.id}" onclick="selectBatchDraft('${draft.id}')">
                    <div class="batch-student-status">
                        <i class="fas fa-pause-circle" style="color:#94a3b8;"></i>
                    </div>
                    <div class="batch-student-info">
                        <div class="batch-student-name" style="color:#94a3b8;">${escapeHtml(draft.student_name || '학생')}</div>
                        <div class="batch-student-meta">${weekLabel} · ${inactiveWeeks}주 미활동</div>
                    </div>
                </div>`;
        });
    }

    listEl.innerHTML = html;
}

function selectBatchDraft(draftId) {
    const draft = weeklyCheckPendingDrafts.find(d => d.id === draftId);
    if (!draft) return;

    // 좌측 리스트 active 상태 업데이트
    document.querySelectorAll('.batch-student-item').forEach(el => el.classList.remove('active'));
    const item = document.getElementById('batchItem_' + draftId);
    if (item) item.classList.add('active');

    const reviewArea = document.getElementById('batchReviewArea');
    if (!reviewArea) return;

    const isSkipped = draft.status === 'skipped';
    const isSent = draft.status === 'sent';
    const weekLabel = draft.week ? `${draft.week}주차` : '';
    const programLabel = draft.program_type || '';
    const authLabel = draft.auth_rate != null ? `${draft.auth_rate}%` : '-';
    const metaInfo = [weekLabel, programLabel, `인증률 ${authLabel}`].filter(Boolean).join(' · ');

    // scoring_summary
    let scoringHtml = '';
    if (draft.scoring_summary) {
        const summaryStr = typeof draft.scoring_summary === 'string'
            ? draft.scoring_summary
            : JSON.stringify(draft.scoring_summary, null, 2);
        scoringHtml = `
            <div style="margin-top:8px;">
                <div style="cursor:pointer; font-size:12px; color:#94a3b8; display:flex; align-items:center; gap:4px;"
                     onclick="var el=this.nextElementSibling; el.style.display=el.style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent=el.style.display==='none'?'\u25BC':'\u25B2';">
                    <span class="toggle-icon">\u25BC</span> scoring_summary (참고용)
                </div>
                <pre style="display:none; margin-top:8px; padding:12px; background:#f1f5f9; border-radius:8px; font-size:11px; color:#475569; overflow-x:auto; white-space:pre-wrap; max-height:200px; overflow-y:auto;">${escapeHtml(summaryStr)}</pre>
            </div>`;
    }

    if (isSent) {
        // 이미 발송 완료
        reviewArea.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#22c55e;">
                <div style="text-align:center;">
                    <i class="fas fa-check-circle" style="font-size:40px; margin-bottom:12px;"></i>
                    <p style="font-weight:600; font-size:16px;">${escapeHtml(draft.student_name || '학생')}님 발송 완료</p>
                </div>
            </div>`;
    } else if (isSkipped) {
        // skipped: 읽기 전용
        const renderedMessage = batchRenderBold(draft.message || '').replace(/\n/g, '<br>');
        reviewArea.innerHTML = `
            <div class="batch-review-content">
                <div class="batch-review-header-info">
                    <span style="background:#fee2e2; color:#ef4444; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">
                        <i class="fas fa-pause-circle"></i> 발송 중단 (${draft.consecutive_inactive_weeks || 0}주 미활동)
                    </span>
                    <span style="font-size:12px; color:#94a3b8;">${metaInfo}</span>
                </div>
                <div class="batch-field">
                    <label>제목</label>
                    <div class="batch-readonly-field">${escapeHtml(draft.title || '')}</div>
                </div>
                <div class="batch-field" style="flex:1;">
                    <label>본문</label>
                    <div class="batch-readonly-message">${renderedMessage}</div>
                </div>
                ${scoringHtml}
                <div class="batch-actions">
                    <button class="batch-btn-delete" onclick="batchDeleteDraft('${draft.id}')" title="이 초안 삭제">
                        <i class="fas fa-trash"></i> 삭제
                    </button>
                </div>
            </div>`;
    } else {
        // pending: 수정 + 발송 가능
        reviewArea.innerHTML = `
            <div class="batch-review-content">
                <div class="batch-review-header-info">
                    <span style="background:#fef3c7; color:#d97706; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">
                        <i class="fas fa-clock"></i> 승인대기
                    </span>
                    <span style="font-size:12px; color:#94a3b8;">${metaInfo}</span>
                </div>
                <div class="batch-field">
                    <label>제목</label>
                    <input type="text" id="batchEditTitle" value="${escapeHtml(draft.title || '')}">
                </div>
                <div class="batch-field" style="flex:1;">
                    <label>본문 <span style="font-weight:400; color:#94a3b8;">(**볼드** · 줄바꿈 가능)</span></label>
                    <textarea id="batchEditMessage" rows="14">${escapeHtml(draft.message || '')}</textarea>
                </div>
                ${scoringHtml}
                <div class="batch-actions">
                    <button class="batch-btn-delete" onclick="batchDeleteDraft('${draft.id}')" title="이 초안 삭제">
                        <i class="fas fa-trash"></i> 삭제
                    </button>
                    <div style="flex:1;"></div>
                    <button class="batch-btn-save" id="batchSaveBtn" onclick="batchSaveDraft('${draft.id}')">
                        <i class="fas fa-save"></i> 저장만
                    </button>
                    <button class="batch-btn-skip" onclick="batchGoNext('${draft.id}')">
                        다음 <i class="fas fa-arrow-right"></i>
                    </button>
                    <button class="batch-btn-send" id="batchSendBtn" onclick="batchSendDraft('${draft.id}')">
                        <i class="fas fa-paper-plane"></i> 발송하기
                    </button>
                </div>
            </div>`;

        // Ctrl+B 단축키
        const ta = document.getElementById('batchEditMessage');
        if (ta) {
            ta.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                    e.preventDefault();
                    batchToggleBold('batchEditMessage');
                }
            });
        }
    }
}

function batchRenderBold(text) {
    const div = document.createElement('div');
    div.textContent = text;
    const escaped = div.innerHTML;
    return escaped.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function batchToggleBold(textareaId) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    let start = ta.selectionStart;
    let end = ta.selectionEnd;
    const text = ta.value;
    if (start === end) {
        const insert = '****';
        ta.value = text.slice(0, start) + insert + text.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
    } else {
        const selected = text.slice(start, end);
        if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
            const inner = selected.slice(2, -2);
            ta.value = text.slice(0, start) + inner + text.slice(end);
            ta.selectionStart = start;
            ta.selectionEnd = start + inner.length;
        } else {
            const wrapped = '**' + selected + '**';
            ta.value = text.slice(0, start) + wrapped + text.slice(end);
            ta.selectionStart = start;
            ta.selectionEnd = start + wrapped.length;
        }
    }
    ta.focus();
}

async function batchSaveDraft(draftId) {
    const title = document.getElementById('batchEditTitle')?.value.trim();
    const message = document.getElementById('batchEditMessage')?.value.trim();
    const btn = document.getElementById('batchSaveBtn');

    if (!title) return alert('제목을 입력해주세요.');
    if (!message) return alert('본문을 입력해주세요.');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

    try {
        await supabaseAPI.patch('tr_weekly_check_drafts', draftId, { title, message });
        const draft = weeklyCheckPendingDrafts.find(d => d.id === draftId);
        if (draft) { draft.title = title; draft.message = message; }
        alert('저장 완료!');
    } catch (err) {
        alert('저장 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 저장만';
    }
}

async function batchSendDraft(draftId) {
    const titleEl = document.getElementById('batchEditTitle');
    const messageEl = document.getElementById('batchEditMessage');
    const btn = document.getElementById('batchSendBtn');

    const title = titleEl ? titleEl.value.trim() : '';
    const message = messageEl ? messageEl.value.trim() : '';

    if (!title) return alert('제목을 입력해주세요.');
    if (!message) return alert('본문을 입력해주세요.');

    const draft = weeklyCheckPendingDrafts.find(d => d.id === draftId);
    if (!draft) return alert('초안을 찾을 수 없습니다.');

    const studentName = draft.student_name || '학생';
    const weekLabel = draft.week ? ` ${draft.week}주차` : '';
    if (!confirm(`"${studentName}"님에게${weekLabel} 주간체크를 발송하시겠습니까?`)) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 발송 중...';

    try {
        // 1. draft 업데이트
        await supabaseAPI.patch('tr_weekly_check_drafts', draftId, { title, message });

        // 2. tr_notifications INSERT
        await supabaseAPI.post('tr_notifications', {
            user_id: draft.user_id,
            title: title,
            message: message,
            created_by: '이온쌤'
        });

        // 3. draft status → sent
        await supabaseAPI.patch('tr_weekly_check_drafts', draftId, {
            status: 'sent',
            sent_at: new Date().toISOString()
        });

        // 4. 로컬 데이터 업데이트
        draft.status = 'sent';

        // 4-1. 카카오 알림톡 발송 (주간체크 등록 안내)
        try {
            const userRows = await supabaseAPI.query('users', { 'id': `eq.${draft.user_id}`, 'select': 'phone' });
            const phone = userRows && userRows.length > 0 ? userRows[0].phone : null;
            if (phone) {
                const weekNum = draft.week || '';
                await sendKakaoAlimTalk('weekly_check_registered', {
                    name: studentName,
                    phone: phone,
                    week: weekNum
                });
                console.log('주간체크 알림톡 발송 완료:', studentName);
            } else {
                console.warn('학생 전화번호 없음 — 알림톡 생략:', studentName);
            }
        } catch (alimErr) {
            console.warn('주간체크 알림톡 발송 실패 (사이트 알림은 정상 발송됨):', alimErr);
        }

        // 5. 좌측 리스트에서 해당 학생 완료 표시
        const statusEl = document.getElementById('batchStatus_' + draftId);
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e;"></i>';
        const itemEl = document.getElementById('batchItem_' + draftId);
        if (itemEl) itemEl.classList.add('sent');

        // 6. 카운트 업데이트
        const remaining = weeklyCheckPendingDrafts.filter(d => d.status === 'pending').length;
        const headerCount = document.getElementById('batchHeaderCount');
        if (headerCount) headerCount.textContent = remaining > 0 ? `(${remaining}명 대기)` : '(모두 완료!)';

        // 7. 자동으로 다음 학생
        const nextDraft = weeklyCheckPendingDrafts.find(d => d.status === 'pending');
        if (nextDraft) {
            selectBatchDraft(nextDraft.id);
        } else {
            // 모두 완료
            const reviewArea = document.getElementById('batchReviewArea');
            if (reviewArea) {
                reviewArea.innerHTML = `
                    <div style="display:flex; align-items:center; justify-content:center; height:100%;">
                        <div style="text-align:center;">
                            <div style="font-size:48px; margin-bottom:16px;">&#127881;</div>
                            <p style="font-size:18px; font-weight:700; color:#1e293b; margin-bottom:8px;">모든 주간체크 발송이 완료되었습니다!</p>
                            <p style="font-size:13px; color:#64748b;">모달을 닫으면 알림판이 자동으로 업데이트됩니다.</p>
                            <button onclick="closeBatchReviewModal()" style="margin-top:20px; background:#7c3aed; color:white; border:none; padding:10px 24px; border-radius:8px; cursor:pointer; font-size:14px; font-weight:600;">
                                닫기
                            </button>
                        </div>
                    </div>`;
            }
        }
    } catch (err) {
        console.error('주간체크 발송 실패:', err);
        alert('발송 실패: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> 발송하기';
    }
}

function batchGoNext(currentDraftId) {
    const pendingDrafts = weeklyCheckPendingDrafts.filter(d => d.status === 'pending');
    const currentIdx = pendingDrafts.findIndex(d => d.id === currentDraftId);
    const nextIdx = currentIdx + 1;
    if (nextIdx < pendingDrafts.length) {
        selectBatchDraft(pendingDrafts[nextIdx].id);
    } else if (pendingDrafts.length > 0) {
        // 마지막이면 처음으로
        selectBatchDraft(pendingDrafts[0].id);
    }
}

async function batchDeleteDraft(draftId) {
    const draft = weeklyCheckPendingDrafts.find(d => d.id === draftId);
    if (!draft) return;

    const studentName = draft.student_name || '학생';
    const weekLabel = draft.week ? ` ${draft.week}주차` : '';
    if (!confirm(`"${studentName}"${weekLabel} 주간체크 초안을 삭제하시겠습니까?`)) return;

    try {
        await supabaseAPI.hardDelete('tr_weekly_check_drafts', draftId);

        // 로컬 데이터에서 제거
        weeklyCheckPendingDrafts = weeklyCheckPendingDrafts.filter(d => d.id !== draftId);

        // 좌측 리스트 재렌더링
        renderBatchStudentList();

        // 카운트 업데이트
        const remaining = weeklyCheckPendingDrafts.filter(d => d.status === 'pending').length;
        const headerCount = document.getElementById('batchHeaderCount');
        if (headerCount) headerCount.textContent = remaining > 0 ? `(${remaining}명 대기)` : '(모두 완료!)';

        // 다음 학생 선택
        const nextDraft = weeklyCheckPendingDrafts.find(d => d.status === 'pending');
        if (nextDraft) {
            selectBatchDraft(nextDraft.id);
        } else if (weeklyCheckPendingDrafts.length > 0) {
            selectBatchDraft(weeklyCheckPendingDrafts[0].id);
        } else {
            // 전부 삭제됨
            const reviewArea = document.getElementById('batchReviewArea');
            if (reviewArea) {
                reviewArea.innerHTML = `
                    <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#94a3b8;">
                        <div style="text-align:center;">
                            <i class="fas fa-inbox" style="font-size:32px; margin-bottom:12px;"></i>
                            <p>검토할 주간체크가 없습니다.</p>
                        </div>
                    </div>`;
            }
        }
    } catch (err) {
        console.error('초안 삭제 실패:', err);
        alert('삭제 실패: ' + err.message);
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
