// ===== 학생 학습 상세 V3 (admin-study-detail-v3.js) =====
// V2 테이블(tr_study_records, tr_auth_records, tr_schedule_assignment) 로직 제거
// V3 테이블(study_results_v3) 기반으로 추후 구현 예정

// ===== 전역 변수 =====
let studentData = null;      // { user, app }

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

        // ── V2 테이블 로드 제거됨 ──
        // tr_study_records, tr_auth_records, tr_schedule_assignment, grade rules
        // → V3 구현 시 study_results_v3 테이블 로드로 대체 예정

        // 렌더링
        loading.style.display = 'none';
        detailContent.style.display = 'block';

        renderProfileHeader();
        loadDeadlineExtensions();  // 데드라인 연장 건수 배지 표시용

        // ── V2 렌더링 함수 호출 제거됨 ──
        // renderSummaryCards(), renderGrassGrid(), buildTaskRows(),
        // renderTaskTable(), renderNotes(), loadProgressSaves(),
        // setupWeeklyCheckDropdown()
        // → V3 구현 시 새로운 함수로 대체 예정

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

    // 신청서 관리 버튼
    if (app.id) {
        const btn = document.getElementById('btnManageApp');
        btn.style.display = 'inline-flex';
        btn.onclick = () => { window.location.href = `admin-applications.html?manage=${app.id}`; };
    }
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
        const readBadge = n.is_read
            ? '<span class="notif-badge-read"><i class="fas fa-check-circle"></i> 읽음</span>'
            : '<span class="notif-badge-unread"><i class="fas fa-clock"></i> 안읽음</span>';
        const createdBy = n.created_by || '-';

        html += `<tr>
            <td style="font-size:12px; color:#94a3b8; white-space:nowrap;">${created}</td>
            <td style="font-weight:600;">${escapeHtml(title)}</td>
            <td style="color:#64748b; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(msgPreview)}${(n.message || '').length > 50 ? '…' : ''}</td>
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
                    <textarea id="editNotifMessage" rows="6">${escapeHtml(n.message || '')}</textarea>
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
