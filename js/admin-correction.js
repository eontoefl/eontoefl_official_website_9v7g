// ===== Admin Correction Management JavaScript =====

let allCorrections = [];
let filteredCorrections = [];
let usersCache = {};       // user_id -> { name, email }
let selectedIds = new Set();
const itemsPerPage = 20;
let currentPage = 1;
let activeCardFilter = 'all'; // 'all' | 'pending' | 'approved' | 'today'

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    requireAdmin();

    const adminInfo = getAdminInfo();
    document.getElementById('adminName').textContent = adminInfo.name;

    // URL param: ?status=pending 등
    const urlParams = new URLSearchParams(window.location.search);
    const statusParam = urlParams.get('status');
    if (statusParam) {
        document.getElementById('statusFilter').value = statusParam;
        activeCardFilter = statusParam;
    }

    // Event listeners
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', () => { activeCardFilter = 'all'; updateCardActiveState(); applyFilters(); });
    document.getElementById('taskTypeFilter').addEventListener('change', () => { activeCardFilter = 'all'; updateCardActiveState(); applyFilters(); });
    document.getElementById('draftFilter').addEventListener('change', () => { activeCardFilter = 'all'; updateCardActiveState(); applyFilters(); });
    const sessionFilterEl = document.getElementById('sessionFilter');
    if (sessionFilterEl) sessionFilterEl.addEventListener('change', () => { activeCardFilter = 'all'; updateCardActiveState(); applyFilters(); });
    document.getElementById('sortBy').addEventListener('change', applyFilters);

    loadCorrections();
    loadDeadlineExtensions();
});

// ===== Data Loading =====
async function loadCorrections() {
    try {
        // Load correction_submissions (select=* as noted in spec: data is small enough)
        const data = await supabaseAPI.query('correction_submissions', {
            'order': 'created_at.desc',
            'limit': '1000'
        });

        if (!data || data.length === 0) {
            allCorrections = [];
            document.getElementById('loading').style.display = 'none';
            document.getElementById('emptyState').style.display = 'block';
            updateStats();
            return;
        }

        allCorrections = data;

        // Collect unique user_ids to fetch user info
        const userIds = [...new Set(allCorrections.map(c => c.user_id).filter(Boolean))];
        await loadUsersInfo(userIds);

        // Populate session filter dropdown with unique session numbers
        populateSessionFilter();

        updateStats();
        applyFilters();
    } catch (error) {
        console.error('Failed to load corrections:', error);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
    }
}

async function loadUsersInfo(userIds) {
    if (userIds.length === 0) return;

    try {
        // Fetch users by ids - batch query
        const idsFilter = userIds.map(id => `"${id}"`).join(',');
        const users = await supabaseAPI.query('users', {
            'id': `in.(${idsFilter})`,
            'select': 'id,name,email,phone',
            'limit': '1000'
        });

        if (users && users.length > 0) {
            users.forEach(u => {
                usersCache[u.id] = { name: u.name || '(이름없음)', email: u.email || '', phone: u.phone || '' };
            });
        }
    } catch (e) {
        console.warn('사용자 정보 로드 실패:', e);
    }
}

// ===== Populate Session Filter =====
function populateSessionFilter() {
    const sessionFilterEl = document.getElementById('sessionFilter');
    if (!sessionFilterEl) return;

    // Collect unique session numbers
    const sessions = [...new Set(allCorrections.map(c => c.session_number).filter(s => s !== null && s !== undefined))]
        .sort((a, b) => Number(a) - Number(b));

    // Preserve current selection
    const currentValue = sessionFilterEl.value;

    let html = '<option value="all">전체 세션</option>';
    sessions.forEach(s => {
        html += `<option value="${s}">S${s}</option>`;
    });
    sessionFilterEl.innerHTML = html;

    // Restore selection if still valid
    if (currentValue && (currentValue === 'all' || sessions.includes(Number(currentValue)) || sessions.includes(currentValue))) {
        sessionFilterEl.value = currentValue;
    }
}

// ===== Helper: Task Type Label =====
function getTaskTypeLabel(taskType) {
    const t = (taskType || '').toLowerCase();
    if (t === 'writing_email') return 'Email';
    if (t === 'writing_discussion') return 'Discussion';
    if (t === 'speaking_interview') return 'Interview';
    return taskType || '';
}

// ===== Status Logic =====

/**
 * Determine the display status of a correction submission.
 * Returns: { text, cssClass, isPending }
 */
function getCorrectionStatus(item) {
    // AI processing states — check if stuck (10+ minutes elapsed)
    if (item.status === 'draft1_submitted' && !item.feedback_1) {
        const submittedMs = parseTimestampMs(item.draft_1_submitted_at);
        if (!isNaN(submittedMs) && (Date.now() - submittedMs) >= 10 * 60 * 1000) {
            return { text: '처리 멈춤', cssClass: 'correction-badge-stuck', isPending: false, isStuck: true };
        }
        return { text: 'AI 처리 중', cssClass: 'correction-badge-processing', isPending: false, isStuck: false };
    }
    if (item.status === 'draft2_submitted' && !item.feedback_2) {
        const submittedMs = parseTimestampMs(item.draft_2_submitted_at);
        if (!isNaN(submittedMs) && (Date.now() - submittedMs) >= 10 * 60 * 1000) {
            return { text: '처리 멈춤', cssClass: 'correction-badge-stuck', isPending: false, isStuck: true };
        }
        return { text: 'AI 처리 중', cssClass: 'correction-badge-processing', isPending: false, isStuck: false };
    }

    // Scheduled release — show schedule badge if not yet fully released
    if (item.scheduled_release_at && (!item.released_2 || !item.released_1)) {
        const schedDate = new Date(item.scheduled_release_at);
        const kst = new Date(schedDate.getTime() + 9 * 60 * 60 * 1000);
        const m = kst.getUTCMonth() + 1;
        const d = kst.getUTCDate();
        const hh = String(kst.getUTCHours()).padStart(2, '0');
        const mm = String(kst.getUTCMinutes()).padStart(2, '0');
        return {
            text: `승인 예약 · ${m}/${d} ${hh}:${mm}`,
            cssClass: 'correction-badge-scheduled',
            isPending: true,
            isStuck: false,
            isScheduled: true
        };
    }

    // feedback_1 exists, released_1 = false → "1차 승인 대기"
    if (item.feedback_1 && !item.released_1) {
        return { text: '1차 승인 대기', cssClass: 'correction-badge-pending', isPending: true, isStuck: false };
    }

    // released_1 = true, feedback_2 exists, released_2 = false → "2차 승인 대기"
    if (item.released_1 && item.feedback_2 && !item.released_2) {
        return { text: '2차 승인 대기', cssClass: 'correction-badge-pending', isPending: true, isStuck: false };
    }

    // released_1 = true, no feedback_2 → "2차 작성 대기"
    if (item.released_1 && !item.feedback_2) {
        return { text: '2차 작성 대기', cssClass: 'correction-badge-waiting', isPending: false, isStuck: false };
    }

    // released_2 = true → "완료"
    if (item.released_2) {
        return { text: '완료', cssClass: 'correction-badge-complete', isPending: false, isStuck: false };
    }

    // Fallback
    return { text: '진행중', cssClass: 'correction-badge-processing', isPending: false, isStuck: false };
}

/**
 * Determine the current draft round: "1" or "2"
 */
function getDraftRound(item) {
    if (item.feedback_2 || item.status === 'draft2_submitted' || item.status === 'feedback2_ready' || item.status === 'complete') {
        return '2';
    }
    return '1';
}

/**
 * Get the score (level) from the current draft round's feedback.
 */
function getScore(item) {
    const round = getDraftRound(item);
    let feedback = null;
    if (round === '2' && item.feedback_2) {
        feedback = parseFeedback(item.feedback_2);
    } else if (item.feedback_1) {
        feedback = parseFeedback(item.feedback_1);
    }

    if (feedback && feedback.level !== undefined && feedback.level !== null) {
        return feedback.level;
    }
    return null;
}

/**
 * Get the elapsed time since feedback creation for pending items.
 * Returns: { text, cssClass } or null if not pending.
 */
/**
 * Parse a timestamp value (ISO string, PG string, or ms number) to ms.
 */
function parseTimestampMs(val) {
    if (!val) return NaN;
    if (typeof val === 'number') return val;
    return new Date(val).getTime();
}

function getElapsedTime(item) {
    const status = getCorrectionStatus(item);
    if (!status.isPending) return null;

    // Determine which feedback timestamp to use
    let feedbackAt = null;
    if (item.feedback_2 && item.released_1 && !item.released_2) {
        feedbackAt = item.feedback_2_at;
    } else if (item.feedback_1 && !item.released_1) {
        feedbackAt = item.feedback_1_at;
    }

    if (!feedbackAt) return null;

    const now = Date.now();
    const feedbackMs = parseTimestampMs(feedbackAt);
    if (isNaN(feedbackMs)) return null;
    const elapsed = now - feedbackMs;
    const hours = elapsed / (1000 * 60 * 60);

    let text = '';
    if (hours < 1) {
        const mins = Math.floor(elapsed / (1000 * 60));
        text = `${mins}분`;
    } else if (hours < 24) {
        text = `${Math.floor(hours)}시간`;
    } else {
        const days = Math.floor(hours / 24);
        text = `${days}일 ${Math.floor(hours % 24)}시간`;
    }

    let cssClass = 'elapsed-green';
    if (hours >= 12) {
        cssClass = 'elapsed-red';
    } else if (hours >= 6) {
        cssClass = 'elapsed-orange';
    }

    return { text, cssClass };
}

// ===== Stats =====
function updateStats() {
    const now = Date.now();
    // Today: KST 기준 오늘 자정 (0시)
    const kstNow = new Date(now + 9 * 60 * 60 * 1000);
    const todayStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
    const todayStartMs = todayStart.getTime() - 9 * 60 * 60 * 1000; // Convert back to UTC ms

    let total = 0;
    let pending = 0;
    let approved = 0;
    let today = 0;
    let stuck = 0;

    allCorrections.forEach(item => {
        total++;

        const status = getCorrectionStatus(item);
        if (status.isPending) pending++;
        if (status.isStuck) stuck++;

        // "승인 완료" = released_1 true or released_2 true
        if (item.released_1 || item.released_2) approved++;

        // "오늘 생성" = feedback_1_at or feedback_2_at is today
        const fb1Ms = parseTimestampMs(item.feedback_1_at);
        const fb2Ms = parseTimestampMs(item.feedback_2_at);
        if ((!isNaN(fb1Ms) && fb1Ms >= todayStartMs) ||
            (!isNaN(fb2Ms) && fb2Ms >= todayStartMs)) {
            today++;
        }
    });

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statPending').textContent = pending;
    document.getElementById('statApproved').textContent = approved;
    document.getElementById('statToday').textContent = today;
    document.getElementById('statStuck').textContent = stuck;

    updateCardActiveState();
}

function updateCardActiveState() {
    document.querySelectorAll('.correction-stat-card').forEach(card => {
        card.classList.toggle('active', card.dataset.filter === activeCardFilter);
    });
}

// ===== Card Filter =====
function filterByCard(filterType) {
    activeCardFilter = filterType;
    updateCardActiveState();

    // Reset dropdown to match
    if (filterType === 'pending') {
        document.getElementById('statusFilter').value = 'pending';
    } else if (filterType === 'approved') {
        document.getElementById('statusFilter').value = 'approved';
    } else if (filterType === 'stuck') {
        document.getElementById('statusFilter').value = 'stuck';
    } else {
        document.getElementById('statusFilter').value = 'all';
    }

    applyFilters();
}

// ===== Filtering & Sorting =====
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    const statusFilter = document.getElementById('statusFilter').value;
    const taskTypeFilter = document.getElementById('taskTypeFilter').value;
    const draftFilter = document.getElementById('draftFilter').value;
    const sessionFilterEl = document.getElementById('sessionFilter');
    const sessionFilter = sessionFilterEl ? sessionFilterEl.value : 'all';
    const sortBy = document.getElementById('sortBy').value;

    filteredCorrections = allCorrections.filter(item => {
        // Search by student name or email
        if (searchTerm) {
            const user = usersCache[item.user_id] || {};
            const name = (user.name || '').toLowerCase();
            const email = (user.email || '').toLowerCase();
            if (!name.includes(searchTerm) && !email.includes(searchTerm)) {
                return false;
            }
        }

        // Status filter
        if (statusFilter !== 'all') {
            const st = getCorrectionStatus(item);
            if (statusFilter === 'pending' && !st.isPending) return false;
            if (statusFilter === 'approved' && !(item.released_1 || item.released_2)) return false;
            if (statusFilter === 'stuck' && !st.isStuck) return false;
        }

        // Card filter: today
        if (activeCardFilter === 'today') {
            const now = Date.now();
            const kstNow = new Date(now + 9 * 60 * 60 * 1000);
            const todayStart = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
            const todayStartMs = todayStart.getTime() - 9 * 60 * 60 * 1000;
            const fb1Ms = parseTimestampMs(item.feedback_1_at);
            const fb2Ms = parseTimestampMs(item.feedback_2_at);
            if (!((!isNaN(fb1Ms) && fb1Ms >= todayStartMs) ||
                  (!isNaN(fb2Ms) && fb2Ms >= todayStartMs))) {
                return false;
            }
        }

        // Task type filter
        if (taskTypeFilter !== 'all') {
            const itemType = (item.task_type || '').toLowerCase();
            if (itemType !== taskTypeFilter) return false;
        }

        // Draft round filter
        if (draftFilter !== 'all') {
            const round = getDraftRound(item);
            if (round !== draftFilter) return false;
        }

        // Session filter
        if (sessionFilter !== 'all') {
            if (String(item.session_number) !== String(sessionFilter)) return false;
        }

        return true;
    });

    // Sorting
    sortCorrections(sortBy);

    currentPage = 1;
    displayCorrections();
}

function sortCorrections(sortBy) {
    filteredCorrections.sort((a, b) => {
        if (sortBy === 'newest') {
            const aTime = a.feedback_2_at || a.feedback_1_at || a.created_at || 0;
            const bTime = b.feedback_2_at || b.feedback_1_at || b.created_at || 0;
            return bTime - aTime;
        }
        if (sortBy === 'oldest') {
            const aTime = a.feedback_2_at || a.feedback_1_at || a.created_at || 0;
            const bTime = b.feedback_2_at || b.feedback_1_at || b.created_at || 0;
            return aTime - bTime;
        }
        if (sortBy === 'score_high') {
            const aScore = getScore(a);
            const bScore = getScore(b);
            return (bScore ?? -1) - (aScore ?? -1);
        }
        if (sortBy === 'score_low') {
            const aScore = getScore(a);
            const bScore = getScore(b);
            return (aScore ?? 999) - (bScore ?? 999);
        }
        return 0;
    });
}

// ===== Display =====
function displayCorrections() {
    if (filteredCorrections.length === 0) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('correctionsTable').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageItems = filteredCorrections.slice(startIndex, endIndex);

    const tableHTML = pageItems.map(item => {
        const user = usersCache[item.user_id] || { name: '(알수없음)', email: '' };
        const status = getCorrectionStatus(item);
        const draftRound = getDraftRound(item);
        const score = getScore(item);
        const elapsed = getElapsedTime(item);
        const isSelected = selectedIds.has(item.id);

        // Task type display
        const taskType = (item.task_type || '').toLowerCase();
        let taskTypeLabel = item.task_type || '-';
        let taskTypeCss = '';
        if (taskType === 'writing_email') { taskTypeLabel = 'Email'; taskTypeCss = 'task-type-email'; }
        else if (taskType === 'writing_discussion') { taskTypeLabel = 'Discussion'; taskTypeCss = 'task-type-discussion'; }
        else if (taskType === 'speaking_interview') { taskTypeLabel = 'Interview'; taskTypeCss = 'task-type-interview'; }

        return `
            <tr style="${isSelected ? 'background: #f0f9ff;' : ''}">
                <td>
                    <input type="checkbox" 
                           class="corr-checkbox" 
                           data-id="${item.id}" 
                           ${isSelected ? 'checked' : ''}
                           onchange="toggleSelection('${item.id}')">
                </td>
                <td>
                    <div style="font-weight: 600;">${escapeHtml(user.name)}</div>
                    <div style="font-size: 12px; color: #94a3b8;">${escapeHtml(user.email)}</div>
                </td>
                <td style="font-size: 13px; color: #64748b;">
                    ${item.session_number ? 'S' + item.session_number : '-'}
                </td>
                <td>
                    <span class="task-type-badge ${taskTypeCss}">${taskTypeLabel}</span>
                </td>
                <td>
                    <span class="draft-badge draft-badge-${draftRound}">${draftRound}차</span>
                </td>
                <td>
                    <span class="score-display" style="color: ${score !== null ? '#1e293b' : '#94a3b8'};">
                        ${score !== null ? score : '-'}
                    </span>
                </td>
                <td>
                    <span class="correction-badge ${status.cssClass}">
                        ${status.text}
                    </span>
                </td>
                <td>
                    ${elapsed 
                        ? `<span class="elapsed-time ${elapsed.cssClass}"><i class="fas fa-clock" style="font-size: 10px;"></i> ${elapsed.text}</span>` 
                        : '<span style="color: #cbd5e1;">-</span>'}
                </td>
                <td>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="admin-btn admin-btn-primary admin-btn-sm" 
                                onclick="openCorrectionDetail('${item.id}')">
                            <i class="fas fa-cog"></i>
                        </button>
                        ${status.isStuck ? `<button class="admin-btn admin-btn-sm retry-webhook-btn" 
                                style="background: #dc2626; color: white;" 
                                onclick="retryWebhook('${item.id}', this)">
                            <i class="fas fa-redo"></i> 재실행
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    document.getElementById('tableBody').innerHTML = tableHTML;

    // Counts
    document.getElementById('totalCount').textContent = filteredCorrections.length;
    document.getElementById('displayCount').textContent = pageItems.length;

    // Pagination
    updatePagination();

    // Selection count
    updateSelectionCount();

    // Show table
    document.getElementById('loading').style.display = 'none';
    document.getElementById('correctionsTable').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}

// ===== Pagination =====
function updatePagination() {
    const totalPages = Math.ceil(filteredCorrections.length / itemsPerPage);
    if (totalPages <= 1) {
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    let html = '';

    // Previous
    if (currentPage > 1) {
        html += `<button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${currentPage - 1})"><i class="fas fa-chevron-left"></i></button>`;
    }

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            html += `<button class="admin-btn admin-btn-primary admin-btn-sm">${i}</button>`;
        } else if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${i})">${i}</button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += `<span style="padding: 8px;">...</span>`;
        }
    }

    // Next
    if (currentPage < totalPages) {
        html += `<button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${currentPage + 1})"><i class="fas fa-chevron-right"></i></button>`;
    }

    document.getElementById('pagination').innerHTML = html;
}

function changePage(page) {
    currentPage = page;
    displayCorrections();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Checkbox Selection =====
function toggleSelection(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    updateSelectionCount();
    displayCorrections();
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageItems = filteredCorrections.slice(startIndex, endIndex);

    if (selectAll.checked) {
        pageItems.forEach(item => selectedIds.add(item.id));
    } else {
        pageItems.forEach(item => selectedIds.delete(item.id));
    }

    updateSelectionCount();
    displayCorrections();
}

function clearSelection() {
    selectedIds.clear();
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = false;
    updateSelectionCount();
    displayCorrections();
}

function updateSelectionCount() {
    const count = selectedIds.size;
    document.getElementById('selectedCount').textContent = count;

    const bar = document.getElementById('selectionBar');
    if (bar) {
        bar.style.display = count > 0 ? 'flex' : 'none';
    }
}

// ===== Section 2: Detail Modal (Read-only) =====

// Current modal state
let currentModalItem = null;

/**
 * Supabase Storage public URL helper
 */
function getStorageUrl(bucket, path) {
    if (!path) return '';
    if (path.indexOf('http') === 0) return path;
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Open the detail modal for a given correction submission ID.
 */
async function openCorrectionDetail(id) {
    const overlay = document.getElementById('corrDetailModal');
    const loading = document.getElementById('modalLoading');
    const content = document.getElementById('modalContent');

    // Show modal with loading
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    loading.style.display = 'block';
    content.style.display = 'none';

    // Reset toggle panels
    resetTogglePanels();

    try {
        // Try to find item in cache first
        let item = allCorrections.find(c => c.id === id);

        // If not in cache or missing feedback JSONB, re-fetch
        if (!item || (!item.feedback_1 && !item.feedback_2)) {
            const fresh = await supabaseAPI.getById('correction_submissions', id);
            if (fresh) {
                item = fresh;
                // Update cache
                const idx = allCorrections.findIndex(c => c.id === id);
                if (idx >= 0) allCorrections[idx] = item;
            }
        }

        if (!item) {
            content.innerHTML = '<div style="text-align:center; padding:40px; color:#888;">데이터를 찾을 수 없습니다.</div>';
            loading.style.display = 'none';
            content.style.display = 'block';
            return;
        }

        currentModalItem = item;

        // Populate header
        populateModalHeader(item);

        // Setup toggle buttons
        setupToggleButtons(item);

        // Render body based on task type
        const taskType = (item.task_type || '').toLowerCase();
        const isWriting = taskType.startsWith('writing');
        const round = getDraftRound(item);
        const feedback = round === '2' && item.feedback_2 ? parseFeedback(item.feedback_2) : parseFeedback(item.feedback_1);

        if (!feedback) {
            content.innerHTML = '<div style="text-align:center; padding:40px; color:#888;">피드백 데이터가 없습니다.</div>';
            loading.style.display = 'none';
            content.style.display = 'block';
            return;
        }

        if (isWriting) {
            renderWritingModal(content, feedback);
        } else {
            renderSpeakingModal(content, feedback);
        }

        loading.style.display = 'none';
        content.style.display = 'block';

    } catch (error) {
        console.error('Error opening correction detail:', error);
        content.innerHTML = `<div style="text-align:center; padding:40px; color:#dc2626;">오류가 발생했습니다: ${escapeHtml(error.message)}</div>`;
        loading.style.display = 'none';
        content.style.display = 'block';
    }
}

/**
 * Close the detail modal.
 */
function closeCorrectionModal() {
    const overlay = document.getElementById('corrDetailModal');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    currentModalItem = null;
    resetTogglePanels();
}

// Close on overlay click (not modal content)
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('corrDetailModal');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeCorrectionModal();
        });
    }
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
            closeCorrectionModal();
        }
    });
});

/**
 * Parse feedback JSONB (may be string or object).
 * 
 * Handles multiple storage formats:
 * 1. Already-parsed object with annotated_html/per_question (GPT-era direct JSONB)
 * 2. JSON string → parse once
 * 3. Double-stringified JSON string → parse twice
 * 4. { text: "{JSON}" } wrapper (Claude node output stored as-is) → unwrap and parse
 */
function parseFeedback(fb) {
    if (!fb) return null;

    // If it's a string, try to parse it (possibly double-stringified)
    if (typeof fb === 'string') {
        try {
            let parsed = JSON.parse(fb);
            // If still a string after first parse, try once more (double-stringified)
            if (typeof parsed === 'string') {
                try { parsed = JSON.parse(parsed); } catch (e2) { return null; }
            }
            return parseFeedback(parsed); // recurse to handle {text:...} wrapper
        } catch (e) {
            return null;
        }
    }

    // It's an object — check if it's a known feedback shape
    if (fb.annotated_html || fb.per_question || fb.summary !== undefined) {
        return fb; // Already the correct feedback object
    }

    // Claude wrapper: { text: "{JSON}" } — unwrap the inner JSON string
    if (fb.text && typeof fb.text === 'string') {
        try {
            const inner = JSON.parse(fb.text);
            if (typeof inner === 'object' && inner !== null) {
                return inner;
            }
        } catch (e) {
            // fb.text was not valid JSON
        }
    }

    // Fallback: return as-is (may still work if fields exist under different keys)
    return fb;
}

/**
 * Populate modal header with item info.
 */
function populateModalHeader(item) {
    const user = usersCache[item.user_id] || { name: '(알수없음)', email: '' };
    const status = getCorrectionStatus(item);
    const round = getDraftRound(item);

    // Task type label
    const taskType = (item.task_type || '').toLowerCase();
    let taskTypeLabel = item.task_type || '-';
    if (taskType === 'writing_email') taskTypeLabel = 'Email';
    else if (taskType === 'writing_discussion') taskTypeLabel = 'Discussion';
    else if (taskType === 'speaking_interview') taskTypeLabel = 'Interview';

    document.getElementById('modalStudentName').textContent = user.name;
    document.getElementById('modalSession').textContent = item.session_number ? `S${item.session_number}` : '-';
    document.getElementById('modalTaskType').textContent = taskTypeLabel;
    document.getElementById('modalDraftRound').textContent = `${round}차`;
    
    const badge = document.getElementById('modalStatusBadge');
    badge.textContent = status.text;
    badge.className = `correction-badge ${status.cssClass}`;

    // Schedule cancel button
    const existingCancelBtn = document.querySelector('.corr-schedule-cancel-btn');
    if (existingCancelBtn) existingCancelBtn.remove();

    if (item.scheduled_release_at) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'corr-schedule-cancel-btn';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i> 예약 취소';
        cancelBtn.onclick = () => cancelScheduledApproval(item.id);
        badge.parentNode.insertBefore(cancelBtn, badge.nextSibling);
    }

    // Deadline extension button visibility
    updateExtendDeadlineUI(item);
}

// ===== Deadline Extension (via correction_deadline_extensions table) =====

// Local cache for deadline extensions loaded from DB
let deadlineExtensionsCache = []; // { id, user_id, session_number, task_type, extended_hours, created_at }

/**
 * Load all correction_deadline_extensions into cache.
 * Called once on page load, and refreshed after each extension.
 */
async function loadDeadlineExtensions() {
    try {
        const data = await supabaseAPI.query('correction_deadline_extensions', {
            'order': 'created_at.desc',
            'limit': '1000'
        });
        deadlineExtensionsCache = data || [];
    } catch (err) {
        console.warn('deadline extensions 로드 실패:', err);
        deadlineExtensionsCache = [];
    }
}

/**
 * Find extension hours for a given user + session + task_type from cache.
 * Returns the extended_hours value, or 0 if none.
 */
function getExtendedHours(userId, sessionNumber, taskType) {
    const match = deadlineExtensionsCache.find(e =>
        e.user_id === userId &&
        String(e.session_number) === String(sessionNumber) &&
        e.task_type === taskType
    );
    return match ? (match.extended_hours || 0) : 0;
}

/**
 * Show/hide the deadline extension button based on item status.
 * Badge reads from correction_deadline_extensions cache.
 */
function updateExtendDeadlineUI(item) {
    const wrap = document.getElementById('extendDeadlineWrap');
    const badgeEl = document.getElementById('extendBadge');
    const popup = document.getElementById('extendPopup');
    if (!wrap || !badgeEl) return;

    // Close popup whenever modal re-populates
    if (popup) popup.classList.remove('open');

    const status = item.status || '';
    const hiddenStates = ['complete', 'expired', 'skipped', 'draft2_submitted', 'feedback2_processing', 'feedback2_ready', 'feedback2_failed'];

    if (hiddenStates.includes(status)) {
        wrap.style.display = 'none';
        return;
    }

    wrap.style.display = 'inline-flex';

    // Show existing extension badge from separate table
    const extHours = getExtendedHours(item.user_id, item.session_number, item.task_type);
    if (extHours > 0) {
        badgeEl.textContent = `+${extHours}h 연장됨`;
        badgeEl.style.display = 'inline-flex';
    } else {
        badgeEl.style.display = 'none';
    }
}

/**
 * Toggle the extension popup open/closed.
 */
function toggleExtendPopup() {
    const popup = document.getElementById('extendPopup');
    if (!popup) return;
    popup.classList.toggle('open');
}

/**
 * Confirm and save deadline extension (modal header button).
 * Inserts/updates a row in correction_deadline_extensions table.
 */
async function confirmExtendDeadline() {
    if (!currentModalItem) return;

    const selected = document.querySelector('input[name="extendHours"]:checked');
    if (!selected) return;

    const hours = parseInt(selected.value, 10);
    const user = usersCache[currentModalItem.user_id] || { name: '(알수없음)' };

    if (!confirm(`${user.name}님의 이 건에 마감을 +${hours}시간 연장하시겠습니까?`)) return;

    try {
        await upsertDeadlineExtension(
            currentModalItem.user_id,
            currentModalItem.session_number,
            currentModalItem.task_type,
            hours
        );

        // Update UI
        toggleExtendPopup();
        updateExtendDeadlineUI(currentModalItem);

        console.log(`✅ 마감 연장 완료: ${user.name}, +${hours}h`);
    } catch (err) {
        console.error('❌ 마감 연장 실패:', err);
        alert('마감 연장 저장에 실패했습니다: ' + err.message);
    }
}

/**
 * Insert or update a deadline extension in correction_deadline_extensions.
 * If a row already exists for (user_id, session_number, task_type), update it.
 * Otherwise insert a new row.
 */
async function upsertDeadlineExtension(userId, sessionNumber, taskType, hours) {
    // Check if extension already exists
    const existing = deadlineExtensionsCache.find(e =>
        e.user_id === userId &&
        String(e.session_number) === String(sessionNumber) &&
        e.task_type === taskType
    );

    if (existing) {
        // UPDATE existing row
        await supabaseAPI.patch('correction_deadline_extensions', existing.id, {
            extended_hours: hours
        });
        existing.extended_hours = hours;
    } else {
        // INSERT new row
        const newRow = {
            user_id: userId,
            session_number: parseInt(sessionNumber, 10),
            task_type: taskType,
            extended_hours: hours
        };
        const inserted = await supabaseAPI.post('correction_deadline_extensions', newRow);
        if (inserted) {
            deadlineExtensionsCache.push(inserted);
        }
    }
}

// ===== Standalone Deadline Extension Modal =====

let extModalSchedules = []; // cached correction_schedules for active students

/**
 * Open the standalone deadline extension modal.
 * Loads active correction students from correction_schedules table.
 */
async function openDeadlineExtendModal() {
    const overlay = document.getElementById('deadlineExtendModal');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Reset form
    document.getElementById('extModalSession').innerHTML = '<option value="">세션을 선택하세요</option>';
    document.getElementById('extModalTaskType').value = '';
    document.getElementById('extModalDraft').value = '1';
    document.querySelector('input[name="extModalHours"][value="24"]').checked = true;
    const statusInfo = document.getElementById('extModalStatusInfo');
    statusInfo.style.display = 'none';

    // Load active students
    const studentSelect = document.getElementById('extModalStudent');
    studentSelect.innerHTML = '<option value="">불러오는 중...</option>';

    try {
        // Fetch all correction_schedules
        const schedules = await supabaseAPI.query('correction_schedules', {
            'select': 'id,user_id,start_date,duration_weeks',
            'order': 'start_date.desc',
            'limit': '500'
        });
        extModalSchedules = schedules || [];

        // Filter active: start_date + duration_weeks * 7 days > today
        const now = new Date();
        const activeSchedules = extModalSchedules.filter(s => {
            if (!s.start_date) return false;
            const start = new Date(s.start_date);
            const weeks = s.duration_weeks || 4;
            const endDate = new Date(start.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
            // Add buffer of 7 days after end
            endDate.setDate(endDate.getDate() + 7);
            return endDate >= now;
        });

        // Load user info for these students if not already cached
        const missingUserIds = activeSchedules
            .map(s => s.user_id)
            .filter(uid => uid && !usersCache[uid]);
        if (missingUserIds.length > 0) {
            await loadUsersInfo(missingUserIds);
        }

        // Populate student dropdown
        studentSelect.innerHTML = '<option value="">학생을 선택하세요</option>';
        // Deduplicate by user_id (a student might have multiple schedules)
        const seen = new Set();
        activeSchedules.forEach(s => {
            if (seen.has(s.user_id)) return;
            seen.add(s.user_id);
            const user = usersCache[s.user_id] || { name: '(이름없음)' };
            const opt = document.createElement('option');
            opt.value = s.user_id;
            opt.textContent = user.name;
            opt.dataset.scheduleId = s.id;
            studentSelect.appendChild(opt);
        });

        if (activeSchedules.length === 0) {
            studentSelect.innerHTML = '<option value="">활성 학생이 없습니다</option>';
        }
    } catch (err) {
        console.error('Failed to load correction schedules:', err);
        studentSelect.innerHTML = '<option value="">학생 목록 로드 실패</option>';
    }
}

/**
 * Close the standalone deadline extension modal.
 */
function closeDeadlineExtendModal() {
    const overlay = document.getElementById('deadlineExtendModal');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

// Close on overlay click
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('deadlineExtendModal');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeDeadlineExtendModal();
        });
    }
});

/**
 * When student is selected, populate session dropdown based on their schedule.
 */
function onExtModalStudentChange() {
    const userId = document.getElementById('extModalStudent').value;
    const sessionSelect = document.getElementById('extModalSession');
    sessionSelect.innerHTML = '<option value="">세션을 선택하세요</option>';

    if (!userId) return;

    // Find the student's schedule to know duration_weeks
    const schedule = extModalSchedules.find(s => s.user_id === userId);
    const weeks = schedule ? (schedule.duration_weeks || 4) : 4;
    // Total sessions = weeks * 3
    const totalSessions = weeks * 3;

    for (let i = 1; i <= totalSessions; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `S${i}`;
        sessionSelect.appendChild(opt);
    }
}

/**
 * Confirm and apply the standalone deadline extension.
 * Always inserts/updates in correction_deadline_extensions table.
 * No blank rows in correction_submissions.
 */
async function confirmStandaloneExtend() {
    const userId = document.getElementById('extModalStudent').value;
    const sessionNumber = document.getElementById('extModalSession').value;
    const taskType = document.getElementById('extModalTaskType').value;
    const draftRound = document.getElementById('extModalDraft').value;
    const hoursRadio = document.querySelector('input[name="extModalHours"]:checked');

    // Validation
    if (!userId) { alert('학생을 선택하세요.'); return; }
    if (!sessionNumber) { alert('세션을 선택하세요.'); return; }
    if (!taskType) { alert('과제 유형을 선택하세요.'); return; }
    if (!hoursRadio) { alert('연장 시간을 선택하세요.'); return; }

    const hours = parseInt(hoursRadio.value, 10);
    const user = usersCache[userId] || { name: '(알수없음)' };
    const taskLabel = getTaskTypeLabel(taskType);
    const draftLabel = draftRound === '2' ? '2차' : '1차';

    if (!confirm(`${user.name}님의 S${sessionNumber} ${taskLabel} ${draftLabel}에 마감을 +${hours}시간 연장하시겠습니까?`)) return;

    const confirmBtn = document.getElementById('extModalConfirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';

    const statusInfo = document.getElementById('extModalStatusInfo');

    try {
        await upsertDeadlineExtension(userId, sessionNumber, taskType, hours);

        statusInfo.className = 'corr-extend-status-info success';
        statusInfo.innerHTML = `<i class="fas fa-check-circle"></i> ${user.name} S${sessionNumber} ${taskLabel} +${hours}시간 연장 완료`;
        statusInfo.style.display = 'block';

        console.log(`✅ 마감 연장: ${user.name}, S${sessionNumber} ${taskLabel} ${draftLabel}, +${hours}h`);

    } catch (err) {
        console.error('❌ 마감 연장 실패:', err);
        statusInfo.className = 'corr-extend-status-info warn';
        statusInfo.innerHTML = `<i class="fas fa-exclamation-triangle"></i> 연장 실패: ${err.message}`;
        statusInfo.style.display = 'block';
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> 연장하기';
    }
}

/**
 * Setup toggle buttons (1차 피드백 보기 / 학생 원문 보기).
 */
function setupToggleButtons(item) {
    const round = getDraftRound(item);
    const toggleFirstBtn = document.getElementById('toggleFirstFeedback');
    const toggleOriginalBtn = document.getElementById('toggleOriginalDraft');

    // "1차 피드백 보기" — only show when viewing 2nd round feedback
    if (round === '2' && item.feedback_1) {
        toggleFirstBtn.style.display = 'inline-flex';
    } else {
        toggleFirstBtn.style.display = 'none';
    }

    // "학생 원문 보기" — always show
    toggleOriginalBtn.style.display = 'inline-flex';
}

function resetTogglePanels() {
    // Reset first feedback panel
    const firstPanel = document.getElementById('firstFeedbackPanel');
    firstPanel.classList.remove('open');
    firstPanel.style.height = '';
    firstPanel.style.maxHeight = '';
    firstPanel.innerHTML = '';
    const firstBtn = document.getElementById('toggleFirstFeedback');
    if (firstBtn) { firstBtn.classList.remove('active'); firstBtn.innerHTML = '<i class="fas fa-eye"></i> 1차 피드백 보기'; }

    // Hide resize handle
    const resizeHandle = document.getElementById('firstFbResizeHandle');
    if (resizeHandle) resizeHandle.style.display = 'none';

    // Reset original draft panel
    const draftPanel = document.getElementById('originalDraftPanel');
    draftPanel.classList.remove('open');
    draftPanel.innerHTML = '';
    const draftBtn = document.getElementById('toggleOriginalDraft');
    if (draftBtn) { draftBtn.classList.remove('active'); draftBtn.innerHTML = '<i class="fas fa-file-alt"></i> 학생 원문 보기'; }
}

/**
 * Toggle 1차 피드백 패널.
 */
function toggleFirstFeedbackPanel() {
    const panel = document.getElementById('firstFeedbackPanel');
    const btn = document.getElementById('toggleFirstFeedback');
    const resizeHandle = document.getElementById('firstFbResizeHandle');
    const item = currentModalItem;

    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        panel.style.height = '';
        panel.style.maxHeight = '';
        if (resizeHandle) resizeHandle.style.display = 'none';
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-eye"></i> 1차 피드백 보기';
        return;
    }

    if (!item || !item.feedback_1) return;
    const fb1 = parseFeedback(item.feedback_1);
    if (!fb1) return;

    const taskType = (item.task_type || '').toLowerCase();
    const isWriting = taskType.startsWith('writing');

    let html = '';

    if (isWriting && fb1.annotated_html) {
        // Split layout: left annotated + right memo
        html += '<div class="corr-fb1-split" data-fb-scope="fb1">';
        html += '  <div class="corr-fb1-split-left">';
        html += `    <div class="corr-toggle-panel-annotated" id="fb1Annotated">${fb1.annotated_html}</div>`;
        html += '  </div>';
        html += '  <div class="corr-fb1-split-right" id="fb1Memo"></div>';
        html += '</div>';
    } else if (!isWriting && fb1.per_question) {
        // Speaking: split per Q + shared memo panel
        html += '<div class="corr-fb1-split" data-fb-scope="fb1">';
        html += '  <div class="corr-fb1-split-left">';
        html += '    <div class="corr-toggle-panel-annotated" id="fb1Annotated">';
        fb1.per_question.forEach((pq, i) => {
            html += `<div class="corr-feedback-question"><div class="corr-feedback-q-label">Q${pq.q || (i + 1)}</div>`;
            if (pq.annotated_html) html += `<div class="corr-feedback-q-body">${pq.annotated_html}</div>`;
            if (pq.comment) html += `<div class="corr-feedback-q-comment">${escapeHtml(pq.comment)}</div>`;
            html += '</div>';
        });
        html += '    </div>';
        html += '  </div>';
        html += '  <div class="corr-fb1-split-right" id="fb1Memo"></div>';
        html += '</div>';
    }

    if (fb1.summary) {
        html += `<div class="corr-toggle-panel-summary">
            <div class="corr-toggle-panel-summary-title"><i class="fas fa-comment-dots"></i> 1차 총평</div>
            <div class="corr-toggle-panel-summary-text">${escapeHtml(fb1.summary)}</div>
        </div>`;
    }

    panel.innerHTML = html;
    panel.classList.add('open');
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-eye-slash"></i> 1차 피드백 닫기';

    // Build memo panel for 1차 feedback (reuse buildMemoPanel with "fb1" scope)
    buildFb1MemoPanel();

    // Show and bind resize handle (targets the entire panel)
    if (resizeHandle) {
        resizeHandle.style.display = 'flex';
        bindResizeHandle(resizeHandle, panel);
    }
}

/**
 * Build memo panel for 1차 feedback toggle.
 * Uses #fb1Annotated and #fb1Memo with scope "fb1".
 */
function buildFb1MemoPanel() {
    const splitWrap = document.querySelector('.corr-fb1-split[data-fb-scope="fb1"]');
    const annotatedEl = document.getElementById('fb1Annotated');
    const memoEl = document.getElementById('fb1Memo');
    if (!splitWrap || !annotatedEl || !memoEl) return;

    const marks = annotatedEl.querySelectorAll('.correction-mark[data-comment]');
    if (marks.length === 0) {
        memoEl.innerHTML = '<div class="corr-memo-empty">교정 코멘트가 없습니다.</div>';
        return;
    }

    memoEl.innerHTML = '<div class="corr-memo-header">1차 교정 메모</div>';

    marks.forEach((mark, i) => {
        const comment = mark.getAttribute('data-comment');
        const uid = `fb1_${i}`;
        mark.setAttribute('data-memo-id', uid);

        const card = document.createElement('div');
        card.className = 'corr-memo-card';
        card.setAttribute('data-memo-id', uid);
        card.textContent = comment;
        memoEl.appendChild(card);
    });

    // Left mark click → activate right memo + scroll
    marks.forEach(mark => {
        mark.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = mark.getAttribute('data-memo-id');
            activateMemoPair(splitWrap, id);
        });
    });

    // Right memo card click → activate left mark + scroll
    memoEl.querySelectorAll('.corr-memo-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = card.getAttribute('data-memo-id');
            activateMemoPair(splitWrap, id);
        });
    });

    // Click empty area to deactivate
    splitWrap.addEventListener('click', (e) => {
        if (!e.target.closest('.correction-mark') && !e.target.closest('.corr-memo-card')) {
            deactivateAllMemo(splitWrap);
        }
    });
}

/**
 * Bind drag-to-resize: dragging the handle adjusts the height
 * of the specified target element (the toggle panel).
 */
/**
 * Bind drag-to-resize on a handle element.
 * Stores target reference via _resizeTarget so re-opens work correctly.
 */
function bindResizeHandle(handle, target) {
    if (!target || !handle) return;

    // Update target reference each time (panel may be re-opened)
    handle._resizeTarget = target;

    // Only attach the listener once on this DOM element
    if (handle._resizeBound) return;
    handle._resizeBound = true;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const tgt = handle._resizeTarget;
        if (!tgt) return;

        const startY = e.clientY;
        const startH = tgt.getBoundingClientRect().height;
        handle.classList.add('dragging');

        function onMouseMove(ev) {
            const delta = ev.clientY - startY;
            const newH = Math.max(180, Math.min(startH + delta, window.innerHeight * 0.65));
            tgt.style.height = newH + 'px';
            tgt.style.maxHeight = newH + 'px';
        }

        function onMouseUp() {
            handle.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

/**
 * Toggle 학생 원문 패널.
 */
function toggleOriginalDraftPanel() {
    const panel = document.getElementById('originalDraftPanel');
    const btn = document.getElementById('toggleOriginalDraft');
    const item = currentModalItem;

    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-file-alt"></i> 학생 원문 보기';
        return;
    }

    if (!item) return;

    const round = getDraftRound(item);
    const taskType = (item.task_type || '').toLowerCase();
    const isWriting = taskType.startsWith('writing');

    let html = '';
    if (isWriting) {
        const draftText = round === '2' ? (item.draft_2_text || '') : (item.draft_1_text || '');
        if (draftText) {
            html = `<div class="corr-toggle-panel-draft">${escapeHtml(draftText)}</div>`;
        } else {
            html = '<div style="padding:10px; color:#888; text-align:center;">원문 데이터가 없습니다.</div>';
        }
    } else {
        // Speaking: show audio paths
        const prefix = round === '2' ? 'draft_2_audio_q' : 'draft_1_audio_q';
        html = '<div style="display:flex; flex-direction:column; gap:6px;">';
        for (let q = 1; q <= 4; q++) {
            const path = item[prefix + q] || '';
            html += `<div class="corr-toggle-panel-audio-path"><strong>Q${q}:</strong> ${path ? escapeHtml(path) : '(파일 없음)'}</div>`;
        }
        html += '</div>';
    }

    panel.innerHTML = html;
    panel.classList.add('open');
    btn.classList.add('active');
    btn.innerHTML = '<i class="fas fa-file-alt"></i> 학생 원문 닫기';
}

// ===== Writing Modal Rendering =====

function renderWritingModal(container, feedback) {
    let html = '';

    // Split layout: left annotated + right memo
    html += '<div class="corr-fb-split-wrap" data-fb-scope="admin">';
    html += '  <div class="corr-fb-split">';
    html += '    <div class="corr-fb-split-left">';
    html += '      <div class="corr-feedback-annotated" id="adminFbAnnotated"></div>';
    html += '    </div>';
    html += '    <div class="corr-fb-split-right" id="adminFbMemo"></div>';
    html += '  </div>';
    html += '  <div class="corr-feedback-summary" id="adminFbSummary"></div>';
    html += '</div>';

    container.innerHTML = html;

    // Render annotated HTML
    const annotatedEl = document.getElementById('adminFbAnnotated');
    if (annotatedEl && feedback.annotated_html) {
        annotatedEl.innerHTML = feedback.annotated_html;
        bindTooltipEvents(annotatedEl);
    }

    // Build memo panel (bidirectional click sync)
    buildMemoPanel('admin');

    // Render summary / level / encouragement
    const summaryEl = document.getElementById('adminFbSummary');
    if (summaryEl) {
        const round = currentModalItem ? getDraftRound(currentModalItem) : '1';
        renderFeedbackSummary(summaryEl, feedback, round);
    }
}

// ===== Speaking Modal Rendering =====

function renderSpeakingModal(container, feedback) {
    // Per-question data
    const questions = feedback.per_question || [];
    
    let html = '';

    // Tab navigation
    html += '<div class="corr-spk-tabs" id="spkTabs">';
    for (let i = 0; i < Math.max(questions.length, 4); i++) {
        html += `<button class="corr-spk-tab ${i === 0 ? 'active' : ''}" data-q="${i}" onclick="switchSpeakingTab(${i})">Q${i + 1}</button>`;
    }
    html += '</div>';

    // Tab panels — split layout for each Q
    html += '<div class="corr-fb-split-wrap" data-fb-scope="admin-spk">';
    for (let i = 0; i < Math.max(questions.length, 4); i++) {
        const pq = questions[i] || {};
        html += `<div class="corr-spk-q-panel ${i === 0 ? 'active' : ''}" data-q="${i}">`;
        html += '  <div class="corr-fb-split">';
        html += '    <div class="corr-fb-split-left">';
        html += `      <div class="corr-feedback-annotated" id="adminSpkFb_${i}"></div>`;
        if (pq.comment) {
            html += `<div class="corr-feedback-q-comment" style="margin-top:12px;">${escapeHtml(pq.comment)}</div>`;
        }
        html += '    </div>';
        html += `    <div class="corr-fb-split-right" id="adminSpkMemo_${i}"></div>`;
        html += '  </div>';
        html += '</div>';
    }

    // Summary area
    html += '  <div class="corr-feedback-summary" id="adminSpkSummary"></div>';
    html += '</div>';

    container.innerHTML = html;

    // Render annotated HTML for each Q
    for (let i = 0; i < Math.max(questions.length, 4); i++) {
        const pq = questions[i] || {};
        const el = document.getElementById(`adminSpkFb_${i}`);
        if (el && pq.annotated_html) {
            el.innerHTML = pq.annotated_html;
            bindTooltipEvents(el);
        } else if (el) {
            el.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">이 질문의 피드백이 없습니다.</div>';
        }
    }

    // Build memo panels for all Qs (all marks visible — recommended approach)
    buildSpkMemoPanels();

    // Render summary / level / encouragement
    const summaryEl = document.getElementById('adminSpkSummary');
    if (summaryEl) {
        const round = currentModalItem ? getDraftRound(currentModalItem) : '1';
        renderFeedbackSummary(summaryEl, feedback, round);
    }
}

/**
 * Switch Speaking Q tab.
 */
function switchSpeakingTab(idx) {
    // Update tab buttons
    document.querySelectorAll('.corr-spk-tab').forEach(tab => {
        tab.classList.toggle('active', parseInt(tab.dataset.q) === idx);
    });

    // Update panels
    document.querySelectorAll('.corr-spk-q-panel').forEach(panel => {
        panel.classList.toggle('active', parseInt(panel.dataset.q) === idx);
    });
}

/**
 * Build memo panels for all Speaking Q panels.
 * Each Q has its own memo panel on the right side.
 */
function buildSpkMemoPanels() {
    const wrap = document.querySelector('.corr-fb-split-wrap[data-fb-scope="admin-spk"]');
    if (!wrap) return;

    // Get all Q panels
    const panels = wrap.querySelectorAll('.corr-spk-q-panel');
    panels.forEach((panel, i) => {
        const annotatedEl = document.getElementById(`adminSpkFb_${i}`);
        const memoEl = document.getElementById(`adminSpkMemo_${i}`);
        if (!annotatedEl || !memoEl) return;

        const marks = annotatedEl.querySelectorAll('.correction-mark[data-comment]');
        if (marks.length === 0) {
            memoEl.innerHTML = '<div class="corr-memo-empty">교정 코멘트가 없습니다.</div>';
            return;
        }

        memoEl.innerHTML = '<div class="corr-memo-header">교정 메모 (Q' + (i + 1) + ')</div>';

        marks.forEach((mark, j) => {
            const comment = mark.getAttribute('data-comment');
            const uid = `spk_${i}_${j}`;

            mark.setAttribute('data-memo-id', uid);

            const card = document.createElement('div');
            card.className = 'corr-memo-card';
            card.setAttribute('data-memo-id', uid);
            card.textContent = comment;
            memoEl.appendChild(card);
        });

        // Bidirectional click events — scoped to this Q panel
        marks.forEach(mark => {
            mark.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = mark.getAttribute('data-memo-id');
                activateMemoPair(panel, id);
            });
        });

        memoEl.querySelectorAll('.corr-memo-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = card.getAttribute('data-memo-id');
                activateMemoPair(panel, id);
            });
        });

        // Click empty area to deactivate
        panel.addEventListener('click', (e) => {
            if (!e.target.closest('.correction-mark') && !e.target.closest('.corr-memo-card')) {
                deactivateAllMemo(panel);
            }
        });
    });
}

// ===== Memo Panel (Writing) — Bidirectional Highlight =====

/**
 * Build memo panel for writing feedback.
 * Mirrors testroom's _buildMemoPanel logic.
 */
function buildMemoPanel(scope) {
    const wrap = document.querySelector(`.corr-fb-split-wrap[data-fb-scope="${scope}"]`);
    if (!wrap) return;

    const annotatedEl = document.getElementById(`${scope}FbAnnotated`);
    const memoEl = document.getElementById(`${scope}FbMemo`);
    if (!annotatedEl || !memoEl) return;

    const marks = annotatedEl.querySelectorAll('.correction-mark[data-comment]');
    if (marks.length === 0) {
        memoEl.innerHTML = '<div class="corr-memo-empty">교정 코멘트가 없습니다.</div>';
        return;
    }

    memoEl.innerHTML = '<div class="corr-memo-header">교정 메모</div>';

    marks.forEach((mark, i) => {
        const comment = mark.getAttribute('data-comment');
        const uid = `${scope}_${i}`;

        mark.setAttribute('data-memo-id', uid);

        const card = document.createElement('div');
        card.className = 'corr-memo-card';
        card.setAttribute('data-memo-id', uid);
        card.textContent = comment;
        memoEl.appendChild(card);
    });

    // Left mark click → activate right memo + scroll
    marks.forEach(mark => {
        mark.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = mark.getAttribute('data-memo-id');
            activateMemoPair(wrap, id);
        });
    });

    // Right memo card click → activate left mark + scroll
    memoEl.querySelectorAll('.corr-memo-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = card.getAttribute('data-memo-id');
            activateMemoPair(wrap, id);
        });
    });

    // Click empty area to deactivate
    wrap.addEventListener('click', (e) => {
        if (!e.target.closest('.correction-mark') && !e.target.closest('.corr-memo-card')) {
            deactivateAllMemo(wrap);
        }
    });
}

/**
 * Activate a memo-id pair and deactivate all others.
 */
function activateMemoPair(container, memoId) {
    // If same one is already active, toggle off
    const alreadyActive = container.querySelector(`.correction-mark.memo-active[data-memo-id="${memoId}"]`);
    deactivateAllMemo(container);
    if (alreadyActive) return;

    // Activate mark
    const mark = container.querySelector(`.correction-mark[data-memo-id="${memoId}"]`);
    if (mark) {
        mark.classList.add('memo-active');
        mark.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Activate memo card
    const card = container.querySelector(`.corr-memo-card[data-memo-id="${memoId}"]`);
    if (card) {
        card.classList.add('memo-active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/**
 * Deactivate all memo highlights within a container.
 */
function deactivateAllMemo(container) {
    container.querySelectorAll('.memo-active').forEach(el => {
        el.classList.remove('memo-active');
    });
}

// ===== Tooltip Events (for marks outside split wrap) =====

function bindTooltipEvents(container) {
    const marks = container.querySelectorAll('.correction-mark[data-comment]');
    marks.forEach(mark => {
        mark.addEventListener('click', (e) => {
            e.stopPropagation();
            // Inside split wrap → handled by memo panel events
            if (mark.closest('.corr-fb-split-wrap')) return;
            // Toggle active for tooltip display
            container.querySelectorAll('.correction-mark.active').forEach(m => {
                if (m !== mark) m.classList.remove('active');
            });
            mark.classList.toggle('active');
        });
    });
}

// ===== Feedback Summary Rendering =====

function renderFeedbackSummary(container, feedback, round) {
    if (!container || !feedback) return;

    let html = '';

    if (feedback.summary) {
        html += `<div class="corr-feedback-summary-card">
            <div class="corr-feedback-summary-title"><i class="fas fa-comment-dots"></i> 총평</div>
            <div class="corr-feedback-summary-text">${escapeHtml(feedback.summary)}</div>
        </div>`;
    }

    if (feedback.hint_count !== undefined && feedback.hint_count !== null) {
        html += `<div class="corr-feedback-hint">교정 포인트: <strong>${feedback.hint_count}</strong>개</div>`;
    }

    if (feedback.level !== undefined && feedback.level !== null) {
        html += `<div class="corr-feedback-level-card">
            <div class="corr-feedback-level-badge">${Math.round(Number(feedback.level))}</div>
            <div class="corr-feedback-level-label">Score</div>
        </div>`;
    }

    // Encouragement is only for 2nd round feedback
    if (round === '2' && feedback.encouragement) {
        html += `<div class="corr-feedback-encouragement-card">
            <div class="corr-feedback-encouragement-title"><i class="fas fa-star"></i> 격려 메시지</div>
            <div class="corr-feedback-encouragement-text">${escapeHtml(feedback.encouragement)}</div>
        </div>`;
    }

    // Level change explanation (only for 2nd round)
    if (round === '2' && feedback.level_change) {
        html += `<div class="corr-feedback-level-change-card">
            <div class="corr-feedback-level-change-title"><i class="fas fa-chart-line"></i> 점수 변화 설명</div>
            <div class="corr-feedback-level-change-text">${escapeHtml(feedback.level_change)}</div>
        </div>`;
    }

    container.innerHTML = html;
}

// =====================================================================
// Section 3: Edit Mode + Save + Approve
// =====================================================================

let isEditMode = false;
let originalFeedbackBackup = null; // Deep copy for cancel
let isDirty = false; // Tracks unsaved changes since last save

/**
 * Toggle edit mode on/off.
 */
function toggleEditMode() {
    if (isEditMode) {
        exitEditMode();
    } else {
        enterEditMode();
    }
}

function enterEditMode() {
    if (!currentModalItem) return;

    isEditMode = true;
    isDirty = false;

    // Backup original feedback for cancel
    const round = getDraftRound(currentModalItem);
    const fbKey = round === '2' && currentModalItem.feedback_2 ? 'feedback_2' : 'feedback_1';
    const fbData = parseFeedback(currentModalItem[fbKey]);
    originalFeedbackBackup = JSON.parse(JSON.stringify(fbData));

    // UI updates
    const editBtn = document.getElementById('editModeBtn');
    editBtn.classList.add('editing');
    editBtn.innerHTML = '<i class="fas fa-times"></i> 편집 취소';

    document.getElementById('editBanner').classList.add('show');
    document.getElementById('modalFooter').classList.add('show');
    document.getElementById('btnTempSave').disabled = false;
    document.getElementById('btnApprove').disabled = false;
    const btnSilentEnter = document.getElementById('btnSilentApprove');
    if (btnSilentEnter) btnSilentEnter.disabled = false;
    const btnScheduleEnter = document.getElementById('btnSchedule');
    if (btnScheduleEnter) btnScheduleEnter.disabled = false;

    // Make memo cards editable + add delete buttons
    makeMemosEditable();

    // Make summary/level/encouragement editable
    makeSummaryEditable();

    // Enable text selection for new mark addition
    enableMarkAddition();

    // Speaking: make Q comments editable
    makeSpeakingCommentsEditable();
}

function exitEditMode() {
    if (!currentModalItem || !originalFeedbackBackup) return;

    isEditMode = false;

    // UI updates
    const editBtn = document.getElementById('editModeBtn');
    editBtn.classList.remove('editing');
    editBtn.innerHTML = '<i class="fas fa-edit"></i> 편집';

    document.getElementById('editBanner').classList.remove('show');
    document.getElementById('modalFooter').classList.remove('show');
    const btnSilentExit = document.getElementById('btnSilentApprove');
    if (btnSilentExit) btnSilentExit.disabled = true;
    const btnScheduleExit = document.getElementById('btnSchedule');
    if (btnScheduleExit) btnScheduleExit.disabled = true;
    const scheduleDropdownExit = document.getElementById('scheduleDropdown');
    if (scheduleDropdownExit) scheduleDropdownExit.classList.remove('open');

    // Hide popups and disable mark addition
    hideAddMarkPopup();
    cancelAddMark();
    disableMarkAddition();

    // Re-render modal from backup to discard changes
    const content = document.getElementById('modalContent');
    const taskType = (currentModalItem.task_type || '').toLowerCase();
    const isWriting = taskType.startsWith('writing');

    if (isWriting) {
        renderWritingModal(content, originalFeedbackBackup);
    } else {
        renderSpeakingModal(content, originalFeedbackBackup);
    }

    originalFeedbackBackup = null;
}

// ===== 3-2. Inline Comment Editing =====

function makeMemosEditable() {
    document.querySelectorAll('.corr-memo-card').forEach(card => {
        card.classList.add('editable');

        // Add delete button
        if (!card.querySelector('.memo-delete-btn')) {
            const delBtn = document.createElement('button');
            delBtn.className = 'memo-delete-btn';
            delBtn.innerHTML = '<i class="fas fa-times"></i>';
            delBtn.title = '교정 삭제';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteMark(card);
            };
            card.appendChild(delBtn);
        }

        // Replace click handler: double-click to edit
        card.ondblclick = (e) => {
            e.stopPropagation();
            startInlineEdit(card);
        };
    });
}

function startInlineEdit(card) {
    if (card.querySelector('.corr-memo-edit-textarea')) return; // Already editing

    const currentText = card.getAttribute('data-memo-id')
        ? getMarkComment(card.getAttribute('data-memo-id'))
        : card.textContent.trim();

    // Save original text content nodes (excluding delete button)
    const originalText = currentText;

    // Clear text content but keep delete button
    const delBtn = card.querySelector('.memo-delete-btn');
    card.textContent = '';
    if (delBtn) card.appendChild(delBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'corr-memo-edit-textarea';
    textarea.value = originalText;
    card.insertBefore(textarea, delBtn);
    textarea.focus();

    // Ctrl+Enter or blur to finish
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            finishInlineEdit(card, textarea);
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            finishInlineEdit(card, textarea, originalText); // revert
        }
    });

    textarea.addEventListener('blur', () => {
        // Small delay to allow button clicks
        setTimeout(() => finishInlineEdit(card, textarea), 150);
    });
}

function finishInlineEdit(card, textarea, revertText) {
    if (!textarea || !textarea.parentNode) return;

    const newText = revertText !== undefined ? revertText : textarea.value.trim();
    const memoId = card.getAttribute('data-memo-id');

    // Remove textarea
    textarea.remove();

    // Restore text content (keep delete button)
    const delBtn = card.querySelector('.memo-delete-btn');
    const textNode = document.createTextNode(newText || '(비어있음)');
    if (delBtn) {
        card.insertBefore(textNode, delBtn);
    } else {
        card.appendChild(textNode);
    }

    // Sync to mark's data-comment
    if (memoId && newText) {
        syncCommentToMark(memoId, newText);
        isDirty = true;
    }
}

function getMarkComment(memoId) {
    const mark = document.querySelector(`.correction-mark[data-memo-id="${memoId}"]`);
    return mark ? (mark.getAttribute('data-comment') || '') : '';
}

function syncCommentToMark(memoId, newComment) {
    const mark = document.querySelector(`.correction-mark[data-memo-id="${memoId}"]`);
    if (mark) {
        mark.setAttribute('data-comment', newComment);
    }
}

// ===== 3-3. Mark Deletion =====

function deleteMark(card) {
    if (!confirm('이 교정을 삭제하시겠습니까?')) return;

    const memoId = card.getAttribute('data-memo-id');

    // Remove the <mark> tag from annotated HTML, keep inner text
    const mark = document.querySelector(`.correction-mark[data-memo-id="${memoId}"]`);
    if (mark) {
        const parent = mark.parentNode;
        while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        // Normalize text nodes
        parent.normalize();
    }

    // Remove memo card
    card.remove();
    isDirty = true;
}

// ===== 3-4. New Mark Addition =====

let pendingMarkRange = null;

function enableMarkAddition() {
    // Add mouseup listener to annotated areas
    document.querySelectorAll('.corr-fb-split-left').forEach(el => {
        el.classList.add('edit-mode');
    });

    document.addEventListener('mouseup', onTextSelectionForMark);
}

function disableMarkAddition() {
    document.querySelectorAll('.corr-fb-split-left').forEach(el => {
        el.classList.remove('edit-mode');
    });

    document.removeEventListener('mouseup', onTextSelectionForMark);
    hideAddMarkPopup();
}

function onTextSelectionForMark(e) {
    if (!isEditMode) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
        hideAddMarkPopup();
        return;
    }

    const range = sel.getRangeAt(0);

    // Check if selection is inside an annotated area
    const annotatedArea = range.startContainer.parentElement?.closest('.corr-feedback-annotated') ||
                          range.startContainer.closest?.('.corr-feedback-annotated');
    if (!annotatedArea) {
        hideAddMarkPopup();
        return;
    }

    // Check if selection contains existing marks
    const fragment = range.cloneContents();
    if (fragment.querySelector('.correction-mark')) {
        hideAddMarkPopup();
        alert('이미 교정이 있는 부분입니다');
        sel.removeAllRanges();
        return;
    }

    // Check if selection starts or ends inside a mark
    if (range.startContainer.parentElement?.closest('.correction-mark') ||
        range.endContainer.parentElement?.closest('.correction-mark')) {
        hideAddMarkPopup();
        alert('이미 교정이 있는 부분입니다');
        sel.removeAllRanges();
        return;
    }

    // Show popup near selection
    const rect = range.getBoundingClientRect();
    const popup = document.getElementById('addMarkPopup');
    popup.style.left = `${rect.left + rect.width / 2 - 60}px`;
    popup.style.top = `${rect.top - 40}px`;
    popup.classList.add('show');

    pendingMarkRange = range;
}

function hideAddMarkPopup() {
    document.getElementById('addMarkPopup').classList.remove('show');
}

function onAddMarkClick() {
    hideAddMarkPopup();
    if (!pendingMarkRange) return;

    // Show comment input popup
    document.getElementById('commentInputPopup').classList.add('show');
    const textarea = document.getElementById('newMarkComment');
    textarea.value = '';
    textarea.focus();
}

function cancelAddMark() {
    document.getElementById('commentInputPopup').classList.remove('show');
    document.getElementById('newMarkComment').value = '';
    pendingMarkRange = null;
    window.getSelection()?.removeAllRanges();
}

function confirmAddMark() {
    const comment = document.getElementById('newMarkComment').value.trim();
    if (!comment) {
        alert('코멘트를 입력해주세요.');
        return;
    }

    if (!pendingMarkRange) {
        cancelAddMark();
        return;
    }

    try {
        const range = pendingMarkRange;

        // Try surroundContents first (works for single text node)
        const mark = document.createElement('mark');
        mark.className = 'correction-mark';
        mark.setAttribute('data-comment', comment);

        try {
            range.surroundContents(mark);
        } catch (e) {
            // Fallback: extractContents + insertNode
            const contents = range.extractContents();
            mark.appendChild(contents);
            range.insertNode(mark);
        }

        // Find the containing annotated area and its memo panel
        const annotatedArea = mark.closest('.corr-feedback-annotated');
        if (annotatedArea) {
            rebuildMemoPanelAfterChange(annotatedArea);
        }

    } catch (err) {
        console.error('Mark addition failed:', err);
        alert('교정 추가에 실패했습니다. 한 문장 내에서만 선택해주세요.');
    }

    cancelAddMark();
    isDirty = true;
}

/**
 * After adding/deleting a mark, rebuild the memo panel
 * for the containing annotated area.
 */
function rebuildMemoPanelAfterChange(annotatedEl) {
    // Determine which memo panel to rebuild
    const id = annotatedEl.id;

    if (id === 'adminFbAnnotated') {
        // Writing panel
        buildMemoPanel('admin');
        if (isEditMode) makeMemosEditable();
    } else if (id && id.startsWith('adminSpkFb_')) {
        // Speaking panel — rebuild all
        buildSpkMemoPanels();
        if (isEditMode) makeMemosEditable();
    }
}

// ===== 3-5. Editable Summary / Level / Encouragement =====

function makeSummaryEditable() {
    const item = currentModalItem;
    if (!item) return;

    const round = getDraftRound(item);
    const fbKey = round === '2' && item.feedback_2 ? 'feedback_2' : 'feedback_1';
    const feedback = parseFeedback(item[fbKey]);
    if (!feedback) return;

    const taskType = (item.task_type || '').toLowerCase();
    const isWriting = taskType.startsWith('writing');
    const isFinal = (round === '2');
    const summaryElId = isWriting ? 'adminFbSummary' : 'adminSpkSummary';
    const summaryEl = document.getElementById(summaryElId);
    if (!summaryEl) return;

    let html = '';

    // Summary textarea
    html += `<div class="corr-feedback-summary-card">
        <div class="corr-feedback-summary-title"><i class="fas fa-comment-dots"></i> 총평</div>
        <textarea class="corr-editable-textarea" id="editSummary">${escapeHtml(feedback.summary || '')}</textarea>
    </div>`;

    // Hint count (read-only, auto-calculated)
    html += `<div class="corr-feedback-hint">교정 포인트: <strong id="editHintCount">${feedback.hint_count || 0}</strong>개 (저장 시 자동 계산)</div>`;

    // Level dropdown
    html += `<div class="corr-feedback-level-card">
        <select class="corr-editable-select" id="editLevel">`;
    for (let v = 1; v <= 5; v += 1) {
        const selected = (feedback.level !== undefined && feedback.level !== null && Math.round(Number(feedback.level)) === v) ? 'selected' : '';
        html += `<option value="${v}" ${selected}>${v}</option>`;
    }
    html += `</select>
        <div class="corr-feedback-level-label">Score</div>
    </div>`;

    // Encouragement textarea (only for 2nd round)
    if (isFinal) {
        html += `<div class="corr-feedback-encouragement-card">
            <div class="corr-feedback-encouragement-title"><i class="fas fa-star"></i> 격려 메시지</div>
            <textarea class="corr-editable-textarea" id="editEncouragement">${escapeHtml(feedback.encouragement || '')}</textarea>
        </div>`;
    }

    // Level change textarea (only for 2nd round)
    if (isFinal) {
        html += `<div class="corr-feedback-level-change-card">
            <div class="corr-feedback-level-change-title"><i class="fas fa-chart-line"></i> 점수 변화 설명</div>
            <textarea class="corr-editable-textarea" id="editLevelChange">${escapeHtml(feedback.level_change || '')}</textarea>
        </div>`;
    }

    summaryEl.innerHTML = html;

    // Track changes on summary/level/encouragement/level_change inputs
    summaryEl.querySelectorAll('textarea, select').forEach(el => {
        el.addEventListener('input', () => { isDirty = true; });
        el.addEventListener('change', () => { isDirty = true; });
    });
}

// ===== 3-8. Speaking: Editable Q Comments =====

function makeSpeakingCommentsEditable() {
    const item = currentModalItem;
    if (!item) return;
    const taskType = (item.task_type || '').toLowerCase();
    if (taskType.startsWith('writing')) return;

    const round = getDraftRound(item);
    const fbKey = round === '2' && item.feedback_2 ? 'feedback_2' : 'feedback_1';
    const feedback = parseFeedback(item[fbKey]);
    if (!feedback || !feedback.per_question) return;

    const qCount = Math.max(feedback.per_question.length, 4);
    for (let i = 0; i < qCount; i++) {
        const pq = feedback.per_question[i] || {};
        const panel = document.querySelector(`.corr-spk-q-panel[data-q="${i}"]`);
        if (!panel) continue;

        // Find the existing comment div and replace with textarea
        const commentDiv = panel.querySelector('.corr-feedback-q-comment');
        if (commentDiv) {
            const textarea = document.createElement('textarea');
            textarea.className = 'corr-spk-comment-textarea';
            textarea.id = `editSpkComment_${i}`;
            textarea.value = pq.comment || '';
            textarea.placeholder = `Q${i + 1} 코멘트를 입력하세요...`;
            commentDiv.replaceWith(textarea);
        } else {
            // No comment div exists, add textarea after annotated area
            const leftPane = panel.querySelector('.corr-fb-split-left');
            if (leftPane) {
                const textarea = document.createElement('textarea');
                textarea.className = 'corr-spk-comment-textarea';
                textarea.id = `editSpkComment_${i}`;
                textarea.value = pq.comment || '';
                textarea.placeholder = `Q${i + 1} 코멘트를 입력하세요...`;
                leftPane.appendChild(textarea);
            }
        }
    }

    // Track changes on all speaking comment textareas
    document.querySelectorAll('.corr-spk-comment-textarea').forEach(el => {
        el.addEventListener('input', () => { isDirty = true; });
    });
}

// ===== 3-6. Temp Save =====

async function tempSaveCorrection() {
    if (!currentModalItem) return;

    const btn = document.getElementById('btnTempSave');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';

    try {
        const feedbackData = collectFeedbackFromDOM();
        const round = getDraftRound(currentModalItem);
        const fbKey = round === '2' && currentModalItem.feedback_2 ? 'feedback_2' : 'feedback_1';

        const updateData = {};
        updateData[fbKey] = feedbackData;

        await supabaseAPI.patch('correction_submissions', currentModalItem.id, updateData);

        // Update cache
        currentModalItem[fbKey] = feedbackData;
        const idx = allCorrections.findIndex(c => c.id === currentModalItem.id);
        if (idx >= 0) allCorrections[idx][fbKey] = feedbackData;

        // Update backup so "cancel" won't lose saved changes
        originalFeedbackBackup = JSON.parse(JSON.stringify(feedbackData));

        isDirty = false;
        alert('저장 완료');
    } catch (err) {
        console.error('Temp save error:', err);
        alert('저장 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 저장';
    }
}

// ===== 3-7. Approve (Release) =====

async function approveCorrection() {
    if (!currentModalItem) return;

    if (!confirm('이 피드백을 학생에게 공개합니다. 계속하시겠습니까?')) return;

    const btn = document.getElementById('btnApprove');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 승인 중...';

    try {
        const feedbackData = collectFeedbackFromDOM();
        const round = getDraftRound(currentModalItem);
        const fbKey = round === '2' && currentModalItem.feedback_2 ? 'feedback_2' : 'feedback_1';

        const now = new Date().toISOString();
        const updateData = {};
        updateData[fbKey] = feedbackData;
        updateData.scheduled_release_at = null;

        // Determine which released flag to set
        if (fbKey === 'feedback_1') {
            updateData.released_1 = true;
            updateData.released_1_at = now;
        } else {
            updateData.released_2 = true;
            updateData.released_2_at = now;
        }

        await supabaseAPI.patch('correction_submissions', currentModalItem.id, updateData);

        // Update cache
        Object.assign(currentModalItem, updateData);
        const idx = allCorrections.findIndex(c => c.id === currentModalItem.id);
        if (idx >= 0) Object.assign(allCorrections[idx], updateData);

        // 카카오 알림톡 발송
        const user = usersCache[currentModalItem.user_id] || {};
        const alimTalkType = fbKey === 'feedback_1' ? 'correction_feedback_1' : 'correction_feedback_2';

        if (user.phone) {
            try {
                const taskLabel = getTaskTypeLabel(currentModalItem.task_type);
                const roundStr = `${currentModalItem.session_number || ''}회 ${taskLabel}`;
                const alimResult = await sendKakaoAlimTalk(alimTalkType, {
                    name: user.name || '',
                    phone: user.phone,
                    round: roundStr
                });
                if (alimResult && alimResult.success) {
                    alert('승인 완료! 알림톡 발송 완료');
                } else {
                    alert('승인 완료! (알림톡 발송 실패 — 승인은 정상 처리됨)');
                }
            } catch (alimErr) {
                console.error('알림톡 발송 에러:', alimErr);
                alert('승인 완료! (알림톡 발송 실패 — 승인은 정상 처리됨)');
            }
        } else {
            console.warn('학생 전화번호 없음, 알림톡 미발송');
            alert('승인 완료! (학생 전화번호 없음 — 알림톡 미발송)');
        }

        // Clean up edit mode UI before resetting flags
        cleanUpEditModeUI();

        // Exit edit mode and close modal
        isEditMode = false;
        originalFeedbackBackup = null;
        closeCorrectionModal();

        // Refresh list
        updateStats();
        applyFilters();

    } catch (err) {
        console.error('Approve error:', err);
        alert('승인 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> 승인';
    }
}

// ===== 3-7b. Silent Approve (no KakaoTalk notification) =====

async function silentApproveCorrection() {
    if (!currentModalItem) return;

    if (!confirm('이 피드백을 학생에게 공개합니다.\n(알림톡은 발송하지 않습니다)\n\n계속하시겠습니까?')) return;

    const btn = document.getElementById('btnSilentApprove');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 승인 중...';

    try {
        const feedbackData = collectFeedbackFromDOM();
        const round = getDraftRound(currentModalItem);
        const fbKey = round === '2' && currentModalItem.feedback_2 ? 'feedback_2' : 'feedback_1';

        const now = new Date().toISOString();
        const updateData = {};
        updateData[fbKey] = feedbackData;
        updateData.scheduled_release_at = null;

        // Determine which released flag to set
        if (fbKey === 'feedback_1') {
            updateData.released_1 = true;
            updateData.released_1_at = now;
        } else {
            updateData.released_2 = true;
            updateData.released_2_at = now;
        }

        await supabaseAPI.patch('correction_submissions', currentModalItem.id, updateData);

        // Update cache
        Object.assign(currentModalItem, updateData);
        const idx = allCorrections.findIndex(c => c.id === currentModalItem.id);
        if (idx >= 0) Object.assign(allCorrections[idx], updateData);

        // No KakaoTalk notification — silent approve
        alert('조용히 승인 완료! (알림톡 미발송)');

        // Clean up edit mode UI
        cleanUpEditModeUI();

        // Exit edit mode and close modal
        isEditMode = false;
        originalFeedbackBackup = null;
        closeCorrectionModal();

        // Refresh list
        updateStats();
        applyFilters();

    } catch (err) {
        console.error('Silent approve error:', err);
        alert('승인 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-volume-mute"></i> 조용히 승인';
    }
}

// ===== Helper: Clean up edit mode UI =====

function cleanUpEditModeUI() {
    disableMarkAddition();
    document.getElementById('editBanner').classList.remove('show');
    document.getElementById('modalFooter').classList.remove('show');
    const btnSilent = document.getElementById('btnSilentApprove');
    if (btnSilent) btnSilent.disabled = true;
    const btnSchedule = document.getElementById('btnSchedule');
    if (btnSchedule) btnSchedule.disabled = true;
    const scheduleDropdown = document.getElementById('scheduleDropdown');
    if (scheduleDropdown) scheduleDropdown.classList.remove('open');
    const editModeBtn = document.getElementById('editModeBtn');
    if (editModeBtn) {
        editModeBtn.classList.remove('editing');
        editModeBtn.innerHTML = '<i class="fas fa-edit"></i> 편집';
    }
}

// ===== Collect Feedback from DOM =====

function collectFeedbackFromDOM() {
    const item = currentModalItem;
    const taskType = (item.task_type || '').toLowerCase();
    const isWriting = taskType.startsWith('writing');
    const round = getDraftRound(item);
    const isFinal = (round === '2');

    // Get original feedback as base
    const fbKey = round === '2' && item.feedback_2 ? 'feedback_2' : 'feedback_1';
    const baseFeedback = parseFeedback(item[fbKey]) || {};

    const result = { ...baseFeedback };

    // Common editable fields
    const summaryEl = document.getElementById('editSummary');
    if (summaryEl) result.summary = summaryEl.value.trim();

    const levelEl = document.getElementById('editLevel');
    if (levelEl) result.level = parseInt(levelEl.value, 10);

    const encouragementEl = document.getElementById('editEncouragement');
    if (encouragementEl) result.encouragement = encouragementEl.value.trim();

    if (isFinal) {
        const levelChangeEl = document.getElementById('editLevelChange');
        if (levelChangeEl) result.level_change = levelChangeEl.value.trim();
    }

    if (isWriting) {
        // Extract annotated_html from DOM
        const annotatedEl = document.getElementById('adminFbAnnotated');
        if (annotatedEl) {
            result.annotated_html = annotatedEl.innerHTML;
            result.hint_count = annotatedEl.querySelectorAll('.correction-mark').length;
        }
    } else {
        // Speaking: rebuild per_question array
        const questions = result.per_question || [];
        const qCount = Math.max(questions.length, 4);
        const newPerQuestion = [];

        for (let i = 0; i < qCount; i++) {
            const pq = { ...(questions[i] || {}) };

            // Extract annotated_html for this Q
            const qAnnotated = document.getElementById(`adminSpkFb_${i}`);
            if (qAnnotated) {
                pq.annotated_html = qAnnotated.innerHTML;
            }

            // Get comment from textarea (edit mode) or keep original
            const commentTextarea = document.getElementById(`editSpkComment_${i}`);
            if (commentTextarea) {
                pq.comment = commentTextarea.value.trim();
            }

            newPerQuestion.push(pq);
        }

        result.per_question = newPerQuestion;

        // Count all marks across all Q panels
        let totalMarks = 0;
        for (let i = 0; i < qCount; i++) {
            const qEl = document.getElementById(`adminSpkFb_${i}`);
            if (qEl) totalMarks += qEl.querySelectorAll('.correction-mark').length;
        }
        result.hint_count = totalMarks;
    }

    return result;
}

// ===== Retry Webhook for Stuck Items =====

async function retryWebhook(id, btnElement) {
    const item = allCorrections.find(c => c.id === id);
    if (!item) {
        alert('해당 제출 건을 찾을 수 없습니다.');
        return;
    }

    const user = usersCache[item.user_id] || { name: '(알수없음)', email: '' };
    const taskType = (item.task_type || '').toLowerCase();
    const taskLabel = getTaskTypeLabel(item.task_type);

    // Determine draft round from status
    let draftNum = '';
    if (item.status === 'draft1_submitted') draftNum = '1';
    else if (item.status === 'draft2_submitted') draftNum = '2';
    else {
        alert('재실행 가능한 상태가 아닙니다.');
        return;
    }

    if (!confirm(`${user.name} - ${taskLabel} ${draftNum}차 첨삭을 재실행하시겠습니까?`)) return;

    // Disable button to prevent duplicate clicks
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 재실행 중...';
    }

    // Determine webhook URL
    let webhookUrl = '';
    if (taskType === 'writing_email' || taskType === 'writing_discussion') {
        if (item.status === 'draft1_submitted') {
            webhookUrl = 'https://eontoefl.app.n8n.cloud/webhook/correction-writing-draft1';
        } else {
            webhookUrl = 'https://eontoefl.app.n8n.cloud/webhook/correction-writing-draft2';
        }
    } else if (taskType === 'speaking_interview') {
        if (item.status === 'draft1_submitted') {
            webhookUrl = 'https://eontoefl.app.n8n.cloud/webhook/correction-speaking-draft1';
        } else {
            webhookUrl = 'https://eontoefl.app.n8n.cloud/webhook/correction-speaking-draft2';
        }
    } else {
        alert('알 수 없는 과제 유형입니다.');
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i class="fas fa-redo"></i> 재실행';
        }
        return;
    }

    // Build payload identical to student submission
    const payload = {
        event: item.status,
        user_id: item.user_id,
        user_name: user.name,
        user_email: user.email,
        session_number: item.session_number,
        task_type: item.task_type,
        task_number: item.task_number
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert('재실행 요청이 완료되었습니다.');
            loadCorrections();
        } else {
            const errText = await response.text();
            alert(`재실행 실패: ${errText || response.statusText}. 잠시 후 다시 시도해주세요.`);
        }
    } catch (err) {
        console.error('Retry webhook error:', err);
        alert(`재실행 실패: ${err.message}. 잠시 후 다시 시도해주세요.`);
    } finally {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i class="fas fa-redo"></i> 재실행';
        }
    }
}

// ===== Override closeCorrectionModal to handle edit mode =====

const _originalCloseCorrectionModal = closeCorrectionModal;

closeCorrectionModal = function() {
    if (isEditMode && isDirty) {
        if (!confirm('편집 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
    }
    if (isEditMode) {
        isEditMode = false;
        originalFeedbackBackup = null;
        disableMarkAddition();

        // Reset UI
        document.getElementById('editBanner').classList.remove('show');
        document.getElementById('modalFooter').classList.remove('show');
        const editBtn = document.getElementById('editModeBtn');
        if (editBtn) { editBtn.classList.remove('editing'); editBtn.innerHTML = '<i class="fas fa-edit"></i> 편집'; }
        const btnSilentClose = document.getElementById('btnSilentApprove');
        if (btnSilentClose) btnSilentClose.disabled = true;
        const btnScheduleClose = document.getElementById('btnSchedule');
        if (btnScheduleClose) btnScheduleClose.disabled = true;
        const scheduleDropdownClose = document.getElementById('scheduleDropdown');
        if (scheduleDropdownClose) scheduleDropdownClose.classList.remove('open');
    }
    hideAddMarkPopup();
    cancelAddMark();
    _originalCloseCorrectionModal();
}

// =====================================================================
// Section 5: Bulk Actions + Excel Download
// =====================================================================

// ===== 5-1 & 5-2. Bulk Approve =====

async function bulkApprove() {
    if (selectedIds.size === 0) return;

    // Filter: only pending items that are NOT already scheduled
    const pendingItems = allCorrections.filter(item =>
        selectedIds.has(item.id) && getCorrectionStatus(item).isPending && !item.scheduled_release_at
    );

    if (pendingItems.length === 0) {
        alert('선택된 건 중 승인 대기 상태인 건이 없습니다.');
        return;
    }

    if (!confirm(`${pendingItems.length}건을 승인하시겠습니까?\n\n⚠️ AI 피드백 원본 그대로 학생에게 공개됩니다.`)) return;

    let successCount = 0;
    let failCount = 0;
    const now = new Date().toISOString();

    // 알림톡 일괄 발송용 items 수집
    const alimTalkItems = [];

    // Process in parallel
    const promises = pendingItems.map(async (item) => {
        try {
            const updateData = {};
            let alimTalkType = '';

            // Determine which released flag to set
            updateData.scheduled_release_at = null;
            if (item.feedback_1 && !item.released_1) {
                updateData.released_1 = true;
                updateData.released_1_at = now;
                alimTalkType = 'correction_feedback_1';
            } else if (item.released_1 && item.feedback_2 && !item.released_2) {
                updateData.released_2 = true;
                updateData.released_2_at = now;
                alimTalkType = 'correction_feedback_2';
            } else {
                return; // Not actually pending
            }

            await supabaseAPI.patch('correction_submissions', item.id, updateData);

            // Update cache
            Object.assign(item, updateData);
            const idx = allCorrections.findIndex(c => c.id === item.id);
            if (idx >= 0) Object.assign(allCorrections[idx], updateData);

            // 알림톡 발송 대상 수집
            const user = usersCache[item.user_id] || {};
            if (user.phone && alimTalkType) {
                const taskLabel = getTaskTypeLabel(item.task_type);
                const roundStr = `${item.session_number || ''}회 ${taskLabel}`;
                alimTalkItems.push({
                    type: alimTalkType,
                    data: {
                        name: user.name || '',
                        phone: user.phone,
                        round: roundStr
                    }
                });
            }

            successCount++;
        } catch (err) {
            console.error(`Bulk approve failed for ${item.id}:`, err);
            failCount++;
        }
    });

    await Promise.all(promises);

    // 알림톡 일괄 발송 (Edge Function bulk 모드)
    let alimMsg = '';
    if (alimTalkItems.length > 0) {
        try {
            const alimResult = await sendKakaoAlimTalkBulk(alimTalkItems);
            if (alimResult && alimResult.success) {
                alimMsg = `\n알림톡 발송: ${alimResult.sent || alimTalkItems.length}건 완료`;
            } else {
                const sent = alimResult?.sent || 0;
                const failed = alimResult?.failed || alimTalkItems.length;
                alimMsg = `\n알림톡: 성공 ${sent}건, 실패 ${failed}건`;
            }
        } catch (alimErr) {
            console.error('일괄 알림톡 발송 에러:', alimErr);
            alimMsg = '\n알림톡 발송 실패 (승인은 정상 처리됨)';
        }
    }

    // Result message
    let msg = `승인 완료: ${successCount}건`;
    if (failCount > 0) msg += `, 실패: ${failCount}건`;
    msg += alimMsg;
    alert(msg);

    // Refresh
    clearSelection();
    updateStats();
    applyFilters();
}

// ===== 5-3. Excel Download =====

function downloadExcel() {
    if (filteredCorrections.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }

    if (typeof XLSX === 'undefined') {
        alert('엑셀 라이브러리를 로드하지 못했습니다. 페이지를 새로고침해주세요.');
        return;
    }

    const rows = filteredCorrections.map(item => {
        const user = usersCache[item.user_id] || { name: '(알수없음)', email: '' };
        const status = getCorrectionStatus(item);
        const round = getDraftRound(item);
        const score = getScore(item);

        // Task type label
        const taskType = (item.task_type || '').toLowerCase();
        let taskTypeLabel = item.task_type || '-';
        if (taskType === 'writing_email') taskTypeLabel = 'Email';
        else if (taskType === 'writing_discussion') taskTypeLabel = 'Discussion';
        else if (taskType === 'speaking_interview') taskTypeLabel = 'Interview';

        // Format dates
        const submitDate = item.draft_1_submitted_at
            ? new Date(item.draft_1_submitted_at).toLocaleString('ko-KR')
            : '';
        const feedbackDate = (item.feedback_2_at || item.feedback_1_at)
            ? new Date(item.feedback_2_at || item.feedback_1_at).toLocaleString('ko-KR')
            : '';

        return {
            '학생 이름': user.name,
            '이메일': user.email,
            '세션': item.session_number ? `S${item.session_number}` : '-',
            '과제 유형': taskTypeLabel,
            '차수': `${round}차`,
            '점수': score !== null ? score : '-',
            '상태': status.text,
            '제출일': submitDate,
            '피드백 생성일': feedbackDate
        };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '첨삭 목록');

    // Column widths
    ws['!cols'] = [
        { wch: 12 }, // 학생 이름
        { wch: 25 }, // 이메일
        { wch: 6 },  // 세션
        { wch: 12 }, // 과제 유형
        { wch: 6 },  // 차수
        { wch: 6 },  // 점수
        { wch: 14 }, // 상태
        { wch: 20 }, // 제출일
        { wch: 20 }, // 피드백 생성일
    ];

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `첨삭관리_${today}.xlsx`);
}

// ===== 5-4. Text Report Download =====
// Downloads a comprehensive text file with:
// - Student info, session, task type, question prompt
// - 1st draft (text or STT q1~q4) + 1st feedback (annotations + summary + level)
// - 2nd draft (text or STT q1~q4) + final feedback (+ encouragement + level_change)
// Filters (student search, session) are applied automatically via filteredCorrections.

async function downloadTextReport() {
    if (filteredCorrections.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }

    // Show loading state on button
    const btn = document.querySelector('button[onclick="downloadTextReport()"]');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...';
    }

    try {
        // 1) Fetch question prompts in batch by task_type
        const questionsMap = await fetchQuestionsForCorrections(filteredCorrections);

        // 2) Sort: by student name, then session number, then task type
        const sorted = [...filteredCorrections].sort((a, b) => {
            const userA = usersCache[a.user_id] || {};
            const userB = usersCache[b.user_id] || {};
            const nameA = (userA.name || '').toLowerCase();
            const nameB = (userB.name || '').toLowerCase();
            if (nameA !== nameB) return nameA.localeCompare(nameB);
            const sA = Number(a.session_number) || 0;
            const sB = Number(b.session_number) || 0;
            if (sA !== sB) return sA - sB;
            return (a.task_type || '').localeCompare(b.task_type || '');
        });

        // 3) Build text content per item
        const blocks = sorted.map(item => buildTextBlockForItem(item, questionsMap));
        const fullText = blocks.join('\n\n');

        // 4) Determine filename
        const today = new Date().toISOString().slice(0, 10);
        // If a single student is filtered (search shows only one student), use their name
        const uniqueUsers = [...new Set(sorted.map(c => c.user_id))];
        let filename;
        if (uniqueUsers.length === 1) {
            const user = usersCache[uniqueUsers[0]] || {};
            const safeName = (user.name || 'student').replace(/[\\/:*?"<>|]/g, '_');
            filename = `첨삭기록_${safeName}_${today}.txt`;
        } else {
            filename = `첨삭기록_전체_${today}.txt`;
        }

        // 5) Download as .txt file (UTF-8 with BOM for proper encoding on Windows)
        const blob = new Blob(['\ufeff' + fullText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (err) {
        console.error('Text report download error:', err);
        alert('텍스트 다운로드 실패: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHtml;
        }
    }
}

/**
 * Fetch question prompts for the given corrections, grouped by task_type.
 * Returns a map: { 'writing_email|0001': {...}, 'speaking_interview|0003': {...}, ... }
 */
async function fetchQuestionsForCorrections(items) {
    const result = {};

    // Collect (task_type, task_number) pairs per question table
    const emailIds = new Set();
    const discussionIds = new Set();
    const interviewIds = new Set();

    items.forEach(it => {
        const tt = (it.task_type || '').toLowerCase();
        const tn = it.task_number;
        if (tn === null || tn === undefined || tn === '') return;
        const idStr = String(tn).padStart(4, '0');
        if (tt === 'writing_email') emailIds.add(`email_set_${idStr}`);
        else if (tt === 'writing_discussion') discussionIds.add(`discussion_set_${idStr}`);
        else if (tt === 'speaking_interview') interviewIds.add(`interview_set_${idStr}`);
    });

    // Helper to batch-fetch by ids
    async function fetchBatch(table, ids) {
        if (ids.size === 0) return [];
        // Use 'in.(...)' filter — quote each id since they are strings like "email_set_0001"
        const idList = [...ids].map(i => `"${i}"`).join(',');
        try {
            const data = await supabaseAPI.query(table, {
                'id': `in.(${idList})`,
                'limit': '1000'
            });
            return data || [];
        } catch (e) {
            console.warn(`Failed to fetch ${table}:`, e);
            return [];
        }
    }

    const [emails, discussions, interviews] = await Promise.all([
        fetchBatch('tr_writing_email', emailIds),
        fetchBatch('tr_writing_discussion', discussionIds),
        fetchBatch('tr_speaking_interview', interviewIds)
    ]);

    emails.forEach(q => { result[`writing_email|${q.id}`] = q; });
    discussions.forEach(q => { result[`writing_discussion|${q.id}`] = q; });
    interviews.forEach(q => { result[`speaking_interview|${q.id}`] = q; });

    return result;
}

/**
 * Build a full text report block for a single correction submission.
 */
function buildTextBlockForItem(item, questionsMap) {
    const user = usersCache[item.user_id] || { name: '(알수없음)', email: '' };
    const taskType = (item.task_type || '').toLowerCase();
    const taskTypeLabel = getTaskTypeLabel(item.task_type) || item.task_type || '-';
    const isWriting = taskType.startsWith('writing');
    const sessionStr = item.session_number ? `S${item.session_number}` : '-';

    const lines = [];
    const SEP = '═══════════════════════════════════════════════════════════';
    const SUB = '───────────────────────────────────────────────────────────';

    lines.push(SEP);
    lines.push(`학생: ${user.name}${user.email ? ` (${user.email})` : ''}`);
    lines.push(`세션: ${sessionStr}  ·  유형: ${taskTypeLabel}${item.task_number !== undefined && item.task_number !== null ? `  ·  문제번호: ${item.task_number}` : ''}`);
    lines.push(SEP);
    lines.push('');

    // === [문제] ===
    lines.push('[문제]');
    const questionText = formatQuestionPrompt(item, questionsMap);
    lines.push(questionText || '(문제 정보 없음)');
    lines.push('');

    // === [1차] ===
    lines.push(SUB);
    lines.push('[1차]');
    lines.push(SUB);

    // 1차 학생 답변
    lines.push('');
    lines.push('▶ 학생 답변 (1차)');
    lines.push(formatStudentDraft(item, 1, isWriting));

    // 1차 첨삭
    lines.push('');
    lines.push('▶ 1차 첨삭');
    if (item.feedback_1) {
        const fb1 = parseFeedback(item.feedback_1);
        lines.push(formatFeedback(fb1, isWriting, false));
    } else {
        lines.push('(1차 첨삭 데이터 없음)');
    }

    // === [2차 / 최종] ===
    const has2nd = !!(item.draft_2_text || item.stt_text_2 || item.feedback_2);
    if (has2nd) {
        lines.push('');
        lines.push(SUB);
        lines.push('[2차 / 최종]');
        lines.push(SUB);

        // 2차 학생 답변
        lines.push('');
        lines.push('▶ 학생 답변 (2차)');
        lines.push(formatStudentDraft(item, 2, isWriting));

        // 최종 첨삭
        lines.push('');
        lines.push('▶ 최종 첨삭');
        if (item.feedback_2) {
            const fb2 = parseFeedback(item.feedback_2);
            lines.push(formatFeedback(fb2, isWriting, true));
        } else {
            lines.push('(2차 첨삭 데이터 없음)');
        }

        // 모범답안
        lines.push('');
        lines.push('▶ [모범답안]');
        if (item.model_answer_text) {
            lines.push(item.model_answer_text);
        } else {
            lines.push('(모범답안 데이터 없음)');
        }
    }

    lines.push('');
    return lines.join('\n');
}

/**
 * Format the question prompt based on task_type.
 */
function formatQuestionPrompt(item, questionsMap) {
    const taskType = (item.task_type || '').toLowerCase();
    const tn = item.task_number;
    if (tn === null || tn === undefined || tn === '') return '(문제번호 없음)';
    const idStr = String(tn).padStart(4, '0');

    let q = null;
    if (taskType === 'writing_email') q = questionsMap[`writing_email|email_set_${idStr}`];
    else if (taskType === 'writing_discussion') q = questionsMap[`writing_discussion|discussion_set_${idStr}`];
    else if (taskType === 'speaking_interview') q = questionsMap[`speaking_interview|interview_set_${idStr}`];

    if (!q) return '(문제 정보를 찾을 수 없습니다)';

    const out = [];
    if (taskType === 'writing_email') {
        if (q.scenario) out.push(`- 시나리오: ${q.scenario}`);
        if (q.task) out.push(`- 과제: ${q.task}`);
        if (q.to_recipient) out.push(`- 수신자: ${q.to_recipient}`);
        if (q.subject) out.push(`- 제목: ${q.subject}`);
        if (q.instruction) out.push(`- 지시사항: ${q.instruction}`);
    } else if (taskType === 'writing_discussion') {
        if (q.class_context) out.push(`- 수업 맥락: ${q.class_context}`);
        if (q.topic) out.push(`- 토론 주제: ${q.topic}`);
        if (q.student1_opinion) out.push(`- 학생1 의견: ${q.student1_opinion}`);
        if (q.student2_opinion) out.push(`- 학생2 의견: ${q.student2_opinion}`);
    } else if (taskType === 'speaking_interview') {
        if (q.context_text) out.push(`- 상황 설명: ${q.context_text}`);
        for (let i = 1; i <= 4; i++) {
            const scriptVal = q[`v${i}_script`];
            if (scriptVal) out.push(`- Q${i}: ${scriptVal}`);
        }
    }

    return out.length > 0 ? out.join('\n') : '(문제 정보 없음)';
}

/**
 * Format student draft answer for the given round (1 or 2).
 */
function formatStudentDraft(item, round, isWriting) {
    if (isWriting) {
        const text = round === 2 ? (item.draft_2_text || '') : (item.draft_1_text || '');
        return text ? text : '(답변 없음)';
    } else {
        // Speaking — STT JSON parsed from stt_text_1 / stt_text_2
        const sttRaw = round === 2 ? item.stt_text_2 : item.stt_text_1;
        if (!sttRaw) return '(STT 텍스트 없음)';
        let stt = sttRaw;
        if (typeof stt === 'string') {
            try { stt = JSON.parse(stt); } catch (e) { return sttRaw; }
        }
        const out = [];
        for (let i = 1; i <= 4; i++) {
            const qKey = `q${i}`;
            const txt = stt && stt[qKey] ? stt[qKey] : '(없음)';
            out.push(`Q${i}: ${txt}`);
        }
        return out.join('\n\n');
    }
}

/**
 * Format feedback (annotated marks + summary + level + extras for 2nd round).
 */
function formatFeedback(feedback, isWriting, isFinal) {
    if (!feedback) return '(첨삭 데이터 없음)';

    const lines = [];

    if (isWriting) {
        // Writing: annotated_html → extract marks
        const marks = extractMarksFromHtml(feedback.annotated_html || '');
        if (marks.length > 0) {
            lines.push('• 교정 포인트:');
            marks.forEach((m, i) => {
                lines.push(`  ${i + 1}. "${m.text}"`);
                lines.push(`     → ${m.comment}`);
            });
        } else {
            lines.push('• 교정 포인트: (없음)');
        }
    } else {
        // Speaking: per_question array
        const perQ = Array.isArray(feedback.per_question) ? feedback.per_question : [];
        if (perQ.length === 0) {
            lines.push('• 교정 포인트: (per_question 데이터 없음)');
        } else {
            perQ.forEach(pq => {
                const qNum = pq.q || '?';
                lines.push(`• Q${qNum} 교정 포인트:`);
                const marks = extractMarksFromHtml(pq.annotated_html || '');
                if (marks.length > 0) {
                    marks.forEach((m, i) => {
                        lines.push(`  ${i + 1}. "${m.text}"`);
                        lines.push(`     → ${m.comment}`);
                    });
                } else {
                    lines.push('  (없음)');
                }
                if (pq.comment) {
                    lines.push(`  [Q${qNum} 코멘트] ${pq.comment}`);
                }
            });
        }
    }

    // Summary
    if (feedback.summary) {
        lines.push('');
        lines.push('• 총평:');
        lines.push(indent(feedback.summary, '  '));
    }

    // Level (score)
    if (feedback.level !== undefined && feedback.level !== null) {
        lines.push('');
        lines.push(`• 점수: ${feedback.level} / 5`);
    }

    // 2nd round extras
    if (isFinal) {
        if (feedback.encouragement) {
            lines.push('');
            lines.push('• 격려 메시지:');
            lines.push(indent(feedback.encouragement, '  '));
        }
        if (feedback.level_change) {
            lines.push('');
            lines.push('• 점수 변화 설명:');
            lines.push(indent(feedback.level_change, '  '));
        }
    }

    return lines.join('\n');
}

/**
 * Parse annotated_html and extract array of { text, comment } from
 * <mark class="correction-mark" data-comment="...">text</mark> tags.
 */
function extractMarksFromHtml(html) {
    if (!html) return [];
    const result = [];
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
        const marks = doc.querySelectorAll('mark.correction-mark, mark[data-comment], .correction-mark');
        marks.forEach(m => {
            const text = (m.textContent || '').trim().replace(/\s+/g, ' ');
            const comment = (m.getAttribute('data-comment') || '').trim();
            if (text || comment) {
                result.push({ text, comment });
            }
        });
    } catch (e) {
        console.warn('Failed to parse annotated_html:', e);
    }
    return result;
}

/**
 * Indent every line of a multiline string.
 */
function indent(str, prefix) {
    if (!str) return '';
    return String(str).split('\n').map(line => prefix + line).join('\n');
}

// =====================================================================
// Section 6: Scheduled Approval
// =====================================================================

// ===== 6-1. Toggle Schedule Dropdown =====

function toggleScheduleDropdown() {
    const dropdown = document.getElementById('scheduleDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) {
        renderSchedulePresets();
    }
}

// ===== 6-2. Render Schedule Presets =====

function renderSchedulePresets() {
    const dropdown = document.getElementById('scheduleDropdown');
    if (!dropdown) return;

    const now = new Date();
    const utcMs = now.getTime();

    // KST = UTC + 9h
    const kstMs = utcMs + 9 * 60 * 60 * 1000;
    const kstNow = new Date(kstMs);

    const presets = [];

    // Relative presets: +1h, +2h, +3h
    for (let h = 1; h <= 3; h++) {
        const target = new Date(utcMs + h * 60 * 60 * 1000);
        presets.push({ label: `${h}시간 후`, iso: target.toISOString() });
    }

    // Fixed 18:00 KST today or tomorrow
    const kstToday18 = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), 18, 0, 0));
    const utcToday18 = new Date(kstToday18.getTime() - 9 * 60 * 60 * 1000);
    if (utcToday18.getTime() > utcMs) {
        presets.push({ label: '오늘 18:00', iso: utcToday18.toISOString() });
    } else {
        const utcTomorrow18 = new Date(utcToday18.getTime() + 24 * 60 * 60 * 1000);
        presets.push({ label: '내일 18:00', iso: utcTomorrow18.toISOString() });
    }

    // Fixed 09:00 KST today or tomorrow
    const kstToday09 = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), 9, 0, 0));
    const utcToday09 = new Date(kstToday09.getTime() - 9 * 60 * 60 * 1000);
    if (utcToday09.getTime() > utcMs) {
        presets.push({ label: '오늘 09:00', iso: utcToday09.toISOString() });
    } else {
        const utcTomorrow09 = new Date(utcToday09.getTime() + 24 * 60 * 60 * 1000);
        presets.push({ label: '내일 09:00', iso: utcTomorrow09.toISOString() });
    }

    let html = '';
    presets.forEach(p => {
        html += `<button class="corr-schedule-preset" onclick="scheduleApproval('${p.iso}')">
            <i class="fas fa-clock"></i> ${p.label}
        </button>`;
    });

    dropdown.innerHTML = html;
}

// ===== 6-3. Close dropdown on outside click =====

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('scheduleDropdown');
    const btnSched = document.getElementById('btnSchedule');
    if (!dropdown || !btnSched) return;
    if (!dropdown.contains(e.target) && !btnSched.contains(e.target)) {
        dropdown.classList.remove('open');
    }
});

// ===== 6-4. Schedule Approval =====

async function scheduleApproval(isoString) {
    if (!currentModalItem) return;

    // Close dropdown
    const dropdown = document.getElementById('scheduleDropdown');
    if (dropdown) dropdown.classList.remove('open');

    // Convert to KST display string
    const schedDate = new Date(isoString);
    const kst = new Date(schedDate.getTime() + 9 * 60 * 60 * 1000);
    const kstMonth = kst.getUTCMonth() + 1;
    const kstDay = kst.getUTCDate();
    const kstHH = String(kst.getUTCHours()).padStart(2, '0');
    const kstMM = String(kst.getUTCMinutes()).padStart(2, '0');
    const kstStr = `${kstMonth}월 ${kstDay}일 ${kstHH}:${kstMM}`;

    if (!confirm(`${kstStr}에 승인 예약하시겠습니까?`)) return;

    try {
        const feedbackData = collectFeedbackFromDOM();
        const round = getDraftRound(currentModalItem);
        const fbKey = round === '2' && currentModalItem.feedback_2 ? 'feedback_2' : 'feedback_1';

        const updateData = {};
        updateData[fbKey] = feedbackData;
        updateData.scheduled_release_at = isoString;

        await supabaseAPI.patch('correction_submissions', currentModalItem.id, updateData);

        // Update cache
        Object.assign(currentModalItem, updateData);
        const idx = allCorrections.findIndex(c => c.id === currentModalItem.id);
        if (idx >= 0) Object.assign(allCorrections[idx], updateData);

        alert(`${kstStr} 승인 예약 완료`);

        // Clean up edit mode UI
        cleanUpEditModeUI();
        isEditMode = false;
        originalFeedbackBackup = null;

        closeCorrectionModal();
        updateStats();
        applyFilters();

    } catch (err) {
        console.error('Schedule approval error:', err);
        alert('예약 실패: ' + err.message);
    }
}

// ===== 6-5. Cancel Scheduled Approval =====

async function cancelScheduledApproval(itemId) {
    if (!confirm('승인 예약을 취소하시겠습니까?')) return;

    try {
        await supabaseAPI.patch('correction_submissions', itemId, { scheduled_release_at: null });

        // Update cache
        const idx = allCorrections.findIndex(c => c.id === itemId);
        if (idx >= 0) allCorrections[idx].scheduled_release_at = null;
        if (currentModalItem && currentModalItem.id === itemId) {
            currentModalItem.scheduled_release_at = null;
        }

        alert('예약이 취소되었습니다.');
        closeCorrectionModal();
        updateStats();
        applyFilters();

    } catch (err) {
        console.error('Cancel schedule error:', err);
        alert('예약 취소 실패: ' + err.message);
    }
}
