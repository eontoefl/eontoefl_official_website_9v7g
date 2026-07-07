// ===== 공지사항 관리 (admin-notices.js) =====

// 공지 타입 스타일 맵 (테스트룸과 동일)
const NOTICE_STYLES = {
    urgent:   { emoji: '🚨', label: '긴급 공지',   bg: '#fef2f2', titleColor: '#dc2626', textColor: '#991b1b' },
    notice:   { emoji: '📢', label: '일반 공지',   bg: '#eff6ff', titleColor: '#1d4ed8', textColor: '#1e3a5f' },
    deadline: { emoji: '⏰', label: '마감 안내',   bg: '#fff7ed', titleColor: '#c2410c', textColor: '#9a3412' },
    tip:      { emoji: '💡', label: '팁 / 도움말', bg: '#f0fdf4', titleColor: '#16a34a', textColor: '#14532d' },
    update:   { emoji: '🔄', label: '업데이트',    bg: '#fefce8', titleColor: '#a16207', textColor: '#78350f' },
    event:    { emoji: '🎉', label: '이벤트',      bg: '#faf5ff', titleColor: '#7c3aed', textColor: '#5b21b6' },
    warning:  { emoji: '⚠️', label: '주의사항',    bg: '#fff7ed', titleColor: '#ea580c', textColor: '#9a3412' },
    check:    { emoji: '✅', label: '완료 / 확인', bg: '#f0fdf4', titleColor: '#16a34a', textColor: '#166534' }
};

let allNotices = [];

// ===== 등록 시각 → KST "2026.07.06 16:27" 포맷 =====
function formatNoticeDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const p = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(d);
        const g = t => (p.find(x => x.type === t) || {}).value || '';
        return `${g('year')}.${g('month')}.${g('day')} ${g('hour')}:${g('minute')}`;
    } catch (e) { return ''; }
}

// ===== 공지 목록 로드 =====
async function loadNotices() {
    const listEl = document.getElementById('noticeList');
    const countEl = document.getElementById('noticeCount');
    
    listEl.innerHTML = '<div style="text-align: center; padding: 40px 0; color: #94a3b8;">로딩 중...</div>';

    try {
        const res = await supabaseAPI.query('tr_notices', {
            'order': 'sort_order.asc,created_at.desc',
            'limit': '100'
        });
        allNotices = res || [];

        countEl.textContent = `(${allNotices.length}건)`;

        if (allNotices.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 60px 0; color: #94a3b8;">
                    <i class="fas fa-bullhorn" style="font-size: 32px; margin-bottom: 12px; display: block;"></i>
                    등록된 공지가 없습니다.<br>
                    <span style="font-size: 13px;">"새 공지 등록" 버튼을 눌러 공지를 추가하세요.</span>
                </div>`;
            return;
        }

        let html = '<table style="width: 100%; border-collapse: collapse; font-size: 14px;">';
        html += `<thead>
            <tr style="border-bottom: 2px solid #e2e8f0; text-align: left;">
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 50px;">순서</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 120px;">타입</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600;">제목</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 130px;">등록일시</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 80px;">상태</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 140px;">액션</th>
            </tr>
        </thead><tbody>`;

        allNotices.forEach(n => {
            const style = NOTICE_STYLES[n.type] || NOTICE_STYLES.notice;
            const contentPreview = (n.content || '').replace(/<[^>]*>/g, '').substring(0, 30) + ((n.content || '').length > 30 ? '...' : '');
            
            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px 8px; color: #64748b; text-align: center;">${n.sort_order || 0}</td>
                <td style="padding: 12px 8px;">
                    <span style="background: ${style.bg}; color: ${style.titleColor}; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                        ${style.emoji} ${style.label}
                    </span>
                </td>
                <td style="padding: 12px 8px;">
                    <div style="font-weight: 600; color: #1e293b;">${escapeHtml(n.title || '')}</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">${escapeHtml(contentPreview)}</div>
                </td>
                <td style="padding: 12px 8px; color: #64748b; font-size: 13px; white-space: nowrap;">${formatNoticeDate(n.created_at)}</td>
                <td style="padding: 12px 8px; text-align: center;">
                    <label style="cursor: pointer; display: inline-flex; align-items: center;">
                        <input type="checkbox" ${n.is_active ? 'checked' : ''} onchange="toggleNoticeActive('${n.id}', this.checked)" style="width: 16px; height: 16px; cursor: pointer;">
                        <span style="margin-left: 4px; font-size: 12px; color: ${n.is_active ? '#22c55e' : '#94a3b8'};">${n.is_active ? '활성' : '비활성'}</span>
                    </label>
                </td>
                <td style="padding: 12px 8px; text-align: center;">
                    <button onclick="editNotice('${n.id}')" style="padding: 5px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: white; color: #475569; font-size: 12px; cursor: pointer; margin-right: 4px;" title="수정">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteNotice('${n.id}')" style="padding: 5px 10px; border: 1px solid #fca5a5; border-radius: 6px; background: #fef2f2; color: #ef4444; font-size: 12px; cursor: pointer;" title="삭제">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        listEl.innerHTML = html;

    } catch (error) {
        console.error('공지 로드 실패:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 40px 0; color: #ef4444;">공지 로드에 실패했습니다.</div>';
    }
}

// ===== 미리보기 업데이트 =====
function updateNoticePreview() {
    const type = document.getElementById('noticeType').value;
    const title = document.getElementById('noticeTitle').value;
    const content = document.getElementById('noticeContent').value;
    const previewEl = document.getElementById('noticePreview');

    if (!title && !content) {
        previewEl.innerHTML = '<p style="color: #94a3b8; text-align: center; margin: 0;">위에 내용을 입력하면 미리보기가 표시됩니다</p>';
        return;
    }

    const style = NOTICE_STYLES[type] || NOTICE_STYLES.notice;
    
    // 긴급 공지 깜빡임 효과
    const pulseStyle = type === 'urgent' ? 'animation: noticePulse 2s ease-in-out infinite;' : '';
    
    previewEl.innerHTML = `
        <div style="background: ${style.bg}; border-radius: 12px; padding: 16px 20px; ${pulseStyle}">
            <div style="font-weight: 700; color: ${style.titleColor}; font-size: 15px; margin-bottom: 6px;">
                ${style.emoji} ${escapeHtml(title || '제목을 입력하세요')}
            </div>
            <div style="color: ${style.textColor}; font-size: 14px; line-height: 1.5;">
                ${content || '<span style="color: #94a3b8;">내용을 입력하세요</span>'}
            </div>
        </div>
    `;
}

// ===== 폼 표시/숨기기 =====
function showNoticeForm(editData) {
    const formEl = document.getElementById('noticeFormContainer');
    const titleEl = document.getElementById('noticeFormTitle');
    
    if (editData) {
        titleEl.innerHTML = '<i class="fas fa-edit" style="color: #f59e0b;"></i> 공지 수정';
        document.getElementById('noticeEditId').value = editData.id;
        document.getElementById('noticeType').value = editData.type || 'notice';
        document.getElementById('noticeTitle').value = editData.title || '';
        document.getElementById('noticeContent').value = editData.content || '';
        document.getElementById('noticeSortOrder').value = editData.sort_order || 0;
        document.getElementById('noticeIsActive').checked = editData.is_active !== false;
    } else {
        titleEl.innerHTML = '<i class="fas fa-plus-circle" style="color: #3b82f6;"></i> 공지 등록';
        document.getElementById('noticeEditId').value = '';
        document.getElementById('noticeType').value = 'notice';
        document.getElementById('noticeTitle').value = '';
        document.getElementById('noticeContent').value = '';
        document.getElementById('noticeSortOrder').value = allNotices.length;
        document.getElementById('noticeIsActive').checked = true;
    }

    formEl.style.display = 'block';
    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateNoticePreview();
}

function cancelNoticeForm() {
    document.getElementById('noticeFormContainer').style.display = 'none';
}

// ===== 저장 =====
async function saveNotice() {
    const editId = document.getElementById('noticeEditId').value;
    const type = document.getElementById('noticeType').value;
    const title = document.getElementById('noticeTitle').value.trim();
    const content = document.getElementById('noticeContent').value.trim();
    const sortOrder = parseInt(document.getElementById('noticeSortOrder').value) || 0;
    const isActive = document.getElementById('noticeIsActive').checked;

    if (!title) {
        alert('제목을 입력하세요.');
        document.getElementById('noticeTitle').focus();
        return;
    }

    const data = {
        type,
        title,
        content,
        sort_order: sortOrder,
        is_active: isActive,
        updated_at: new Date().toISOString()
    };

    try {
        if (editId) {
            // 수정
            await supabaseAPI.patch('tr_notices', editId, data);
        } else {
            // 등록
            data.created_at = new Date().toISOString();
            await supabaseAPI.post('tr_notices', data);
        }

        cancelNoticeForm();
        await loadNotices();
        
    } catch (error) {
        console.error('공지 저장 실패:', error);
        alert('저장에 실패했습니다: ' + error.message);
    }
}

// ===== 수정 =====
function editNotice(id) {
    const notice = allNotices.find(n => n.id === id);
    if (notice) {
        showNoticeForm(notice);
    }
}

// ===== 삭제 =====
async function deleteNotice(id) {
    const notice = allNotices.find(n => n.id === id);
    if (!notice) return;

    const style = NOTICE_STYLES[notice.type] || NOTICE_STYLES.notice;
    if (!confirm(`"${notice.title}" 공지를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete('tr_notices', id);
        await loadNotices();
    } catch (error) {
        console.error('공지 삭제 실패:', error);
        alert('삭제에 실패했습니다: ' + error.message);
    }
}

// ===== 활성/비활성 토글 =====
async function toggleNoticeActive(id, isActive) {
    try {
        await supabaseAPI.patch('tr_notices', id, {
            is_active: isActive,
            updated_at: new Date().toISOString()
        });
        // 목록 다시 로드하지 않고 로컬만 업데이트
        const notice = allNotices.find(n => n.id === id);
        if (notice) notice.is_active = isActive;
    } catch (error) {
        console.error('상태 변경 실패:', error);
        alert('상태 변경에 실패했습니다.');
        await loadNotices(); // 실패 시 다시 로드
    }
}

// ===== HTML 이스케이프 =====
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
