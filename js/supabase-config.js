// Supabase 설정
const SUPABASE_URL = 'https://qpqjevecjejvbeuogtbx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcWpldmVjamVqdmJldW9ndGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MDAxNDEsImV4cCI6MjA4Njk3NjE0MX0.pJvY4u9oHQYa7IvAjWluHMow_4WIkONDBBasnXxF5Gc';

// Supabase REST API 헬퍼 함수
const supabaseAPI = {
    // GET: 데이터 조회
    async get(table, params = {}) {
        const queryParams = new URLSearchParams();
        
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.page) queryParams.append('offset', (params.page - 1) * params.limit);
        if (params.search) queryParams.append('search', params.search);
        
        // sort 파라미터 처리: "-created_at" → "created_at.desc"
        if (params.sort) {
            const sortField = params.sort.startsWith('-') ? params.sort.substring(1) : params.sort;
            const sortOrder = params.sort.startsWith('-') ? 'desc' : 'asc';
            queryParams.append('order', `${sortField}.${sortOrder}`);
        }
        
        if (params.filter) {
            Object.keys(params.filter).forEach(key => {
                queryParams.append(key, params.filter[key]);
            });
        }
        
        const url = `${SUPABASE_URL}/rest/v1/${table}?${queryParams.toString()}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        return { data, total: data.length };
    },
    
    // GET by ID: 단일 데이터 조회
    async getById(table, id) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        return data[0] || null;
    },
    
    // POST: 데이터 생성
    async post(table, data) {
        const url = `${SUPABASE_URL}/rest/v1/${table}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `API Error: ${response.status}`);
        }
        
        const result = await response.json();
        return result[0];
    },
    
    // PATCH: 데이터 부분 수정
    async patch(table, id, data) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const result = await response.json();
        return result[0];
    },
    
    // PUT: 데이터 전체 수정
    async put(table, id, data) {
        return this.patch(table, id, data);
    },
    
    // DELETE: 데이터 삭제 (소프트 삭제)
    async delete(table, id) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ deleted: true })
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        return true;
    },

    // HARD DELETE: 데이터 완전 삭제
    async hardDelete(table, id) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        return true;
    },
    
    // 커스텀 쿼리
    async query(table, filters = {}) {
        let url = `${SUPABASE_URL}/rest/v1/${table}?`;
        
        Object.keys(filters).forEach(key => {
            url += `${key}=${filters[key]}&`;
        });
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        return await response.json();
    }
};

// 기존 코드와의 호환성을 위한 래퍼 함수
async function fetchAPI(endpoint, options = {}) {
    const method = options.method || 'GET';
    const table = endpoint.replace('tables/', '').split('/')[0];
    const id = endpoint.split('/')[2];
    
    try {
        if (method === 'GET' && id) {
            return await supabaseAPI.getById(table, id);
        } else if (method === 'GET') {
            const params = new URLSearchParams(endpoint.split('?')[1] || '');
            return await supabaseAPI.get(table, {
                limit: params.get('limit'),
                page: params.get('page'),
                search: params.get('search'),
                sort: params.get('sort')
            });
        } else if (method === 'POST') {
            return await supabaseAPI.post(table, JSON.parse(options.body));
        } else if (method === 'PATCH') {
            return await supabaseAPI.patch(table, id, JSON.parse(options.body));
        } else if (method === 'PUT') {
            return await supabaseAPI.put(table, id, JSON.parse(options.body));
        } else if (method === 'DELETE') {
            return await supabaseAPI.delete(table, id);
        }
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ===== 공통 유틸: 새벽 4시 컷오프 기반 effectiveToday =====
function getEffectiveToday() {
    const now = new Date();
    const kstOffset = 9 * 60; // KST = UTC+9
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const kstMinutes = utcMinutes + kstOffset;
    const kstHour = Math.floor((kstMinutes % 1440) / 60);

    // KST 기준 현재 날짜 구하기
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    let y = kstNow.getUTCFullYear();
    let m = kstNow.getUTCMonth();
    let d = kstNow.getUTCDate();

    // KST 기준 새벽 4시 이전이면 어제로 취급
    if (kstHour < 4) {
        d -= 1;
    }

    // UTC 자정으로 반환 (schedule_start/end와 동일한 기준)
    return new Date(Date.UTC(y, m, d));
}

// ===== 공통 유틸: 등급별 색상 =====
function getGradeColor(grade) {
    const colors = {
        'A': '#22c55e',
        'B': '#3b82f6',
        'C': '#f59e0b',
        'D': '#f97316',
        'F': '#ef4444',
        '-': '#94a3b8'
    };
    return colors[grade] || '#94a3b8';
}

// ===== 공통 유틸: 등급 규칙 로드 =====
let gradeRulesCache = null;
async function loadGradeRules() {
    if (gradeRulesCache) return gradeRulesCache;
    try {
        const rules = await supabaseAPI.query('tr_grade_rules', { 'order': 'min_rate.desc', 'limit': '20' });
        if (rules && rules.length > 0) {
            gradeRulesCache = rules;
            return rules;
        }
    } catch (e) {
        console.warn('등급 규칙 로드 실패, 기본값 사용:', e);
    }
    // 기본 등급 규칙
    gradeRulesCache = [
        { grade: 'A', min_rate: 95, refund_rate: 100 },
        { grade: 'B', min_rate: 90, refund_rate: 50 },
        { grade: 'C', min_rate: 80, refund_rate: 30 },
        { grade: 'D', min_rate: 70, refund_rate: 0 },
        { grade: 'F', min_rate: 0, refund_rate: 0 }
    ];
    return gradeRulesCache;
}

// ===== 공통 유틸: 등급 판정 =====
function getGradeFromRules(authRate, rules, deposit) {
    deposit = deposit || 0;
    for (const rule of rules) {
        if (authRate >= rule.min_rate) {
            return {
                grade: rule.grade,
                refundRate: rule.refund_rate || 0,
                refundAmount: Math.round(deposit * (rule.refund_rate || 0) / 100),
                deposit: deposit
            };
        }
    }
    return { grade: 'F', refundRate: 0, refundAmount: 0, deposit: deposit };
}

// ===== 공통 유틸: 스케줄 section → task 파싱 =====
function parseScheduleSection(sectionText) {
    if (!sectionText || !sectionText.trim()) return null;
    const text = sectionText.trim();
    if (text.startsWith('내벨업보카')) return { taskType: 'vocab', moduleNumber: null };
    if (text.startsWith('입문서 정독')) return { taskType: 'intro-book', moduleNumber: null };
    const readingMatch = text.match(/리딩 Module\s*(\d+)/);
    if (readingMatch) return { taskType: 'reading', moduleNumber: parseInt(readingMatch[1]) };
    const listeningMatch = text.match(/리스닝 Module\s*(\d+)/);
    if (listeningMatch) return { taskType: 'listening', moduleNumber: parseInt(listeningMatch[1]) };
    const writingMatch = text.match(/라이팅\s*(\d+)/);
    if (writingMatch) return { taskType: 'writing', moduleNumber: parseInt(writingMatch[1]) };
    const speakingMatch = text.match(/스피킹\s*(\d+)/);
    if (speakingMatch) return { taskType: 'speaking', moduleNumber: parseInt(speakingMatch[1]) };
    return { taskType: 'unknown', moduleNumber: null };
}

// ===== 공통 유틸: 도래 과제 목록 생성 =====
const DAY_ENG_TO_KR = { 'sunday': '일', 'monday': '월', 'tuesday': '화', 'wednesday': '수', 'thursday': '목', 'friday': '금', 'saturday': '토' };
const DAY_ENG_TO_INDEX = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };

function getDueTaskList(scheduleRaw, programType, startDate, effectiveToday, totalWeeks) {
    const prog = programType.toLowerCase();
    const dueTasks = [];

    // 해당 프로그램의 스케줄만 필터
    const progSchedule = (scheduleRaw || []).filter(s => (s.program || '').toLowerCase() === prog);

    for (const s of progSchedule) {
        if (s.week > totalWeeks) continue;
        const dayIndex = DAY_ENG_TO_INDEX[s.day];
        if (dayIndex === undefined) continue;

        // 해당 과제의 날짜 계산: start + (week-1)*7 + dayOffset
        const taskDate = new Date(startDate);
        taskDate.setUTCDate(taskDate.getUTCDate() + (s.week - 1) * 7 + dayIndex);

        // effectiveToday 이하만 (도래한 과제만)
        if (taskDate > effectiveToday) continue;

        const dayKr = DAY_ENG_TO_KR[s.day] || s.day;

        // section1~4 파싱
        for (const sec of [s.section1, s.section2, s.section3, s.section4]) {
            const parsed = parseScheduleSection(sec);
            if (!parsed || parsed.taskType === 'unknown') continue;
            dueTasks.push({
                week: s.week,
                day: s.day,
                dayKr: dayKr,
                taskType: parsed.taskType,
                moduleNumber: parsed.moduleNumber,
                taskDate: taskDate
            });
        }
    }
    return dueTasks;
}

// ===== 공통 유틸: 제출률 계산 =====
function calcSubmitRate(dueTasks, studyRecords) {
    if (dueTasks.length === 0) return { tasksDue: 0, tasksSubmitted: 0, submitRate: 0 };

    let matched = 0;
    for (const task of dueTasks) {
        let found = false;
        if (task.taskType === 'vocab' || task.taskType === 'intro-book') {
            // week + day + task_type 매칭
            found = studyRecords.some(r =>
                r.task_type === task.taskType &&
                r.week === task.week &&
                r.day === task.dayKr
            );
        } else {
            // task_type + module_number 매칭
            found = studyRecords.some(r =>
                r.task_type === task.taskType &&
                r.module_number === task.moduleNumber
            );
        }
        if (found) matched++;
    }

    return {
        tasksDue: dueTasks.length,
        tasksSubmitted: matched,
        submitRate: Math.round(matched / dueTasks.length * 100)
    };
}

// ===== 공통 유틸: 인증률 계산 =====
// auth_records는 study_record_id로 study_records와 연결됨
// 도래 과제 → 매칭 study_record 찾기 → 해당 auth_record의 auth_rate 합산
function calcAuthRate(dueTasks, studyRecords, authRecords) {
    if (dueTasks.length === 0) return { authSum: 0, authRate: 0 };

    // auth_records를 study_record_id로 빠르게 조회할 수 있게 맵 생성
    const authMap = {};
    (authRecords || []).forEach(ar => {
        if (ar.study_record_id) authMap[ar.study_record_id] = ar;
    });

    let authSum = 0;
    for (const task of dueTasks) {
        // 1. 도래 과제에 매칭되는 study_record 찾기
        let studyRecord = null;
        if (task.taskType === 'vocab' || task.taskType === 'intro-book') {
            studyRecord = studyRecords.find(r =>
                r.task_type === task.taskType &&
                r.week === task.week &&
                r.day === task.dayKr
            );
        } else {
            studyRecord = studyRecords.find(r =>
                r.task_type === task.taskType &&
                r.module_number === task.moduleNumber
            );
        }

        // 2. study_record가 있으면 auth_record 찾기
        if (studyRecord && authMap[studyRecord.id]) {
            authSum += (authMap[studyRecord.id].auth_rate || 0);
        }
        // 매칭 안 되면 auth_rate = 0 (미제출 or 인증 미완료)
    }

    return {
        authSum: authSum,
        authRate: Math.round(authSum / dueTasks.length)
    };
}
