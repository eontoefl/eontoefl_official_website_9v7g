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

    // KST 기준 새벽 4시 이전이면 어제로 취급
    const effective = new Date(now);
    if (kstHour < 4) {
        effective.setDate(effective.getDate() - 1);
    }
    effective.setHours(0, 0, 0, 0);
    return effective;
}

// ===== 공통 유틸: 오늘까지 할당된 과제 수 (분모) =====
// getTaskCountFn: (programType, week, dayIndex) => number
// 시작일~effectiveToday까지, 토요일(6) 제외, 각 날짜의 실제 요일 기반으로 스케줄 조회
function countTasksDueToday(startDate, programType, totalWeeks, getTaskCountFn) {
    const effectiveToday = getEffectiveToday();
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    // 시작 전이면 0
    if (effectiveToday < start) return 0;

    let total = 0;

    for (let w = 1; w <= totalWeeks; w++) {
        for (let d = 0; d < 6; d++) { // 주당 6일 (일~금)
            const taskDate = new Date(start);
            taskDate.setDate(taskDate.getDate() + (w - 1) * 7 + d);
            if (taskDate > effectiveToday) return total; // 미도래일이면 중단
            // 실제 날짜의 요일(getDay())을 사용하여 스케줄 조회
            const actualDayIndex = taskDate.getDay(); // 0=일, 1=월, ..., 5=금, 6=토
            if (actualDayIndex === 6) continue; // 토요일은 스킵
            total += getTaskCountFn(programType, w, actualDayIndex);
        }
    }
    return total;
}

// ===== 공통 유틸: 등급/환급 판정 (tr_grade_rules 기반) =====
let gradeRulesCache = null;

async function loadGradeRules() {
    if (gradeRulesCache) return gradeRulesCache;
    try {
        const rules = await supabaseAPI.query('tr_grade_rules', { 'order': 'min_rate.desc' });
        gradeRulesCache = rules || [];
        return gradeRulesCache;
    } catch (e) {
        console.error('Failed to load grade rules:', e);
        // 폴백: 하드코딩 기본값
        return [
            { grade: 'A', min_rate: 95, refund_rate: 1.0, deposit: 100000 },
            { grade: 'B', min_rate: 90, refund_rate: 0.9, deposit: 100000 },
            { grade: 'C', min_rate: 80, refund_rate: 0.8, deposit: 100000 },
            { grade: 'D', min_rate: 70, refund_rate: 0.7, deposit: 100000 },
            { grade: 'F', min_rate: 0, refund_rate: 0, deposit: 100000 }
        ];
    }
}

function getGradeFromRules(authRate, gradeRules) {
    for (const rule of gradeRules) {
        if (authRate >= rule.min_rate) {
            return {
                grade: rule.grade,
                refundRate: rule.refund_rate,
                deposit: rule.deposit,
                refundAmount: Math.round(rule.deposit * rule.refund_rate)
            };
        }
    }
    // 폴백: F등급
    return { grade: 'F', refundRate: 0, deposit: 100000, refundAmount: 0 };
}

// 등급별 색상
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
