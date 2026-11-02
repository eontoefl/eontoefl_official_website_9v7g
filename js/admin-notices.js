// ===== 공지사항 관리 (admin-notices.js) =====
//
// 공지 카드의 모양·동작·게시 기간 규칙은 테스트룸의 js/notice-board.js 하나를 같이 쓴다 (window.NoticeBoard).
// 미리보기가 학생 화면과 항상 같게 보이도록 이 파일에는 사본을 두지 않는다.

const NOTICE_BOARD_VERSION = '001';                   // 테스트룸 js/notice-board.js 버전
const NOTICE_PANEL_CSS_VERSION = '004_notice_board';  // 테스트룸 css/notice-panel.css 버전

// 테스트룸 주소 — 로컬 개발(localhost)에서만 ?testroom=http://localhost:포트 로 바꿔 시험할 수 있음
function _noticeBoardOrigin() {
    const local = ['localhost', '127.0.0.1', '[::1]'];
    const param = new URLSearchParams(location.search).get('testroom');
    if (param && local.includes(location.hostname)) {
        try {
            const u = new URL(param);
            if (local.includes(u.hostname)) return u.origin;
        } catch (e) { /* 잘못된 값은 무시 */ }
    }
    return 'https://testroom.eonfl.com';
}

// 테스트룸 공지 카드 파일(css + js)을 한 번만 불러옴
const noticeBoardReady = new Promise((resolve, reject) => {
    const origin = _noticeBoardOrigin();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${origin}/css/notice-panel.css?v=${NOTICE_PANEL_CSS_VERSION}`;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = `${origin}/js/notice-board.js?v=${NOTICE_BOARD_VERSION}`;
    script.onload = () => window.NoticeBoard ? resolve(window.NoticeBoard) : reject(new Error('NoticeBoard 없음'));
    script.onerror = () => reject(new Error('테스트룸 공지 파일을 불러오지 못했습니다'));
    document.head.appendChild(script);
});
noticeBoardReady.then(_fillNoticeTypeOptions).catch(e => console.error('공지 카드 파일 로드 실패:', e));

// 타입 선택 목록 — NoticeBoard.STYLES에서 생성
function _fillNoticeTypeOptions(NB) {
    const sel = document.getElementById('noticeType');
    if (!sel) return;
    const current = sel.value || 'notice';
    sel.innerHTML = Object.keys(NB.STYLES)
        .map(k => `<option value="${k}">${NB.STYLES[k].emoji} ${NB.STYLES[k].label}</option>`)
        .join('');
    sel.value = NB.STYLES[current] ? current : 'notice';
}

let allNotices = [];

// 공개 대상 라벨/스타일 맵
const AUDIENCE_STYLES = {
    all:       { label: '전체', icon: '🌐', color: '#475569', bg: '#f1f5f9' },
    regular:   { label: '일반내챌', icon: '🇰🇷', color: '#1d4ed8', bg: '#eff6ff' },
    australia: { label: '호주내챌', icon: '🇦🇺', color: '#c2410c', bg: '#fff7ed' }
};

// ===== 공지 목록 로드 =====
async function loadNotices() {
    const listEl = document.getElementById('noticeList');
    const countEl = document.getElementById('noticeCount');
    
    listEl.innerHTML = '<div style="text-align: center; padding: 40px 0; color: #94a3b8;">로딩 중...</div>';

    let NB;
    try {
        NB = await noticeBoardReady;
    } catch (e) {
        listEl.innerHTML = '<div style="text-align: center; padding: 40px 0; color: #ef4444;">테스트룸 공지 파일을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</div>';
        return;
    }

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
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 44px;">순서</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 100px;">타입</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 88px;">대상</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600;">제목</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 96px;">등록일시</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 124px;">게시</th>
                <th style="padding: 10px 8px; color: #64748b; font-weight: 600; width: 104px;">액션</th>
            </tr>
        </thead><tbody>`;

        const now = new Date();
        allNotices.forEach(n => {
            const style = NB.styleOf(n.type);
            const live = NB.isLive(n, now);
            const aud = AUDIENCE_STYLES[n.audience] || AUDIENCE_STYLES.all;
            const contentPreview = (n.content || '').replace(/<[^>]*>/g, '').substring(0, 30) + ((n.content || '').length > 30 ? '...' : '');

            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px 8px; color: #64748b; text-align: center;">${n.sort_order || 0}</td>
                <td style="padding: 12px 8px;">
                    <span style="background: ${style.bg}; color: ${style.titleColor}; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap;">
                        ${style.emoji} ${style.label}
                    </span>
                </td>
                <td style="padding: 12px 8px;">
                    <span style="background: ${aud.bg}; color: ${aud.color}; padding: 4px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap;">
                        ${aud.icon} ${aud.label}
                    </span>
                </td>
                <td style="padding: 12px 8px;">
                    <div style="font-weight: 600; color: #1e293b;">${escapeHtml(n.title || '')}</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">${escapeHtml(contentPreview)}</div>
                </td>
                <td style="padding: 12px 8px; white-space: nowrap;">
                    <div style="color: #64748b; font-size: 12px;">${(NB.formatDate(n.created_at).split(' ')[0]) || ''}</div>
                    <div style="color: #94a3b8; font-size: 12px; margin-top: 2px;">${(NB.formatDate(n.created_at).split(' ')[1]) || ''}</div>
                </td>
                <td style="padding: 12px 8px; text-align: center;">
                    <label style="cursor: pointer; display: inline-flex; align-items: center;">
                        <input type="checkbox" ${live ? 'checked' : ''} onchange="toggleNoticeActive('${n.id}', this.checked)" style="width: 16px; height: 16px; cursor: pointer;">
                        <span style="margin-left: 4px; font-size: 12px; color: ${live ? '#22c55e' : '#94a3b8'};">${live ? '게시 중' : '꺼짐'}</span>
                    </label>
                    ${live ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 2px; white-space: nowrap;">${NB.formatDate(n.active_until).slice(5)}까지</div>` : ''}
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

// ===== 미리보기 업데이트 — 테스트룸과 같은 카드(NoticeBoard.renderItem)를 펼친 상태로 그림 =====
async function updateNoticePreview() {
    const type = document.getElementById('noticeType').value;
    const title = document.getElementById('noticeTitle').value;
    const content = document.getElementById('noticeContent').value;
    const previewEl = document.getElementById('noticePreview');

    if (!title && !content) {
        previewEl.innerHTML = '<p style="color: #94a3b8; text-align: center; margin: 0;">위에 내용을 입력하면 미리보기가 표시됩니다</p>';
        return;
    }

    let NB;
    try {
        NB = await noticeBoardReady;
    } catch (e) {
        previewEl.innerHTML = '<p style="color: #ef4444; text-align: center; margin: 0;">테스트룸 공지 파일을 불러오지 못해 미리보기를 표시할 수 없습니다.</p>';
        return;
    }

    const editId = document.getElementById('noticeEditId').value;
    const editing = editId ? allNotices.find(n => n.id === editId) : null;

    previewEl.innerHTML = NB.renderItem({
        id: 'preview',
        type,
        title: title || '제목을 입력하세요',
        content: content || '내용을 입력하세요',
        created_at: editing ? editing.created_at : new Date().toISOString()
    }, { isNew: true, collapsed: false });
}

// ===== 폼 표시/숨기기 =====
async function showNoticeForm(editData) {
    const formEl = document.getElementById('noticeFormContainer');
    const titleEl = document.getElementById('noticeFormTitle');
    
    if (editData) {
        titleEl.innerHTML = '<i class="fas fa-edit" style="color: #f59e0b;"></i> 공지 수정';
        document.getElementById('noticeEditId').value = editData.id;
        document.getElementById('noticeType').value = editData.type || 'notice';
        document.getElementById('noticeAudience').value = editData.audience || 'all';
        document.getElementById('noticeTitle').value = editData.title || '';
        document.getElementById('noticeContent').value = editData.content || '';
        document.getElementById('noticeSortOrder').value = editData.sort_order || 0;
        let live = false;
        try { live = (await noticeBoardReady).isLive(editData); } catch (e) { /* 파일 로드 실패 시 꺼짐으로 표시 */ }
        document.getElementById('noticeIsActive').checked = live;
    } else {
        titleEl.innerHTML = '<i class="fas fa-plus-circle" style="color: #3b82f6;"></i> 공지 등록';
        document.getElementById('noticeEditId').value = '';
        document.getElementById('noticeType').value = 'notice';
        document.getElementById('noticeAudience').value = 'all';
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
// 게시 켜기/끄기 → 게시 종료 시각 (저장·목록 토글 공통)
//   켜면 지금부터 NoticeBoard.ACTIVE_DAYS일, 끄면 지금 종료. 상태가 그대로면 undefined(기간 유지)
function _activeUntilFor(NB, notice, wantLive, now) {
    const wasLive = notice ? NB.isLive(notice, now) : false;
    if (wantLive === wasLive) return undefined;
    return wantLive ? NB.newActiveUntil(now) : now.toISOString();
}

async function saveNotice() {
    const editId = document.getElementById('noticeEditId').value;
    const type = document.getElementById('noticeType').value;
    const audience = document.getElementById('noticeAudience').value || 'all';
    const title = document.getElementById('noticeTitle').value.trim();
    const content = document.getElementById('noticeContent').value.trim();
    const sortOrder = parseInt(document.getElementById('noticeSortOrder').value) || 0;
    const isActive = document.getElementById('noticeIsActive').checked;

    if (!title) {
        alert('제목을 입력하세요.');
        document.getElementById('noticeTitle').focus();
        return;
    }

    let NB;
    try {
        NB = await noticeBoardReady;
    } catch (e) {
        alert('테스트룸 공지 파일을 불러오지 못해 게시 기간을 정할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }

    const now = new Date();
    const editing = editId ? allNotices.find(n => n.id === editId) : null;
    const data = {
        type,
        audience,
        title,
        content,
        sort_order: sortOrder,
        updated_at: now.toISOString()
    };
    const activeUntil = _activeUntilFor(NB, editing, isActive, now);
    if (activeUntil !== undefined) data.active_until = activeUntil;

    try {
        if (editId) {
            // 수정
            await supabaseAPI.patch('tr_notices', editId, data);
        } else {
            // 등록
            data.created_at = now.toISOString();
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

    if (!confirm(`"${notice.title}" 공지를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await supabaseAPI.hardDelete('tr_notices', id);
        await loadNotices();
    } catch (error) {
        console.error('공지 삭제 실패:', error);
        alert('삭제에 실패했습니다: ' + error.message);
    }
}

// ===== 게시 켜기/끄기 (목록 체크박스) =====
async function toggleNoticeActive(id, wantLive) {
    try {
        const NB = await noticeBoardReady;
        const now = new Date();
        const notice = allNotices.find(n => n.id === id);
        const activeUntil = _activeUntilFor(NB, notice, wantLive, now);
        if (activeUntil !== undefined) {
            await supabaseAPI.patch('tr_notices', id, {
                active_until: activeUntil,
                updated_at: now.toISOString()
            });
        }
    } catch (error) {
        console.error('상태 변경 실패:', error);
        alert('상태 변경에 실패했습니다.');
    }
    await loadNotices(); // 게시 종료 시각 표시까지 다시 그림
}

// ===== HTML 이스케이프 =====
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
