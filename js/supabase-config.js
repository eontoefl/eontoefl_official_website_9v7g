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
