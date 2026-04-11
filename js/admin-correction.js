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
    document.getElementById('sortBy').addEventListener('change', applyFilters);

    loadCorrections();
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
            'select': 'id,name,email',
            'limit': '1000'
        });

        if (users && users.length > 0) {
            users.forEach(u => {
                usersCache[u.id] = { name: u.name || '(이름없음)', email: u.email || '' };
            });
        }
    } catch (e) {
        console.warn('사용자 정보 로드 실패:', e);
    }
}

// ===== Status Logic =====

/**
 * Determine the display status of a correction submission.
 * Returns: { text, cssClass, isPending }
 */
function getCorrectionStatus(item) {
    // AI processing states
    if (item.status === 'draft1_submitted' && !item.feedback_1) {
        return { text: 'AI 처리 중', cssClass: 'correction-badge-processing', isPending: false };
    }
    if (item.status === 'draft2_submitted' && !item.feedback_2) {
        return { text: 'AI 처리 중', cssClass: 'correction-badge-processing', isPending: false };
    }

    // feedback_1 exists, released_1 = false → "1차 승인 대기"
    if (item.feedback_1 && !item.released_1) {
        return { text: '1차 승인 대기', cssClass: 'correction-badge-pending', isPending: true };
    }

    // released_1 = true, feedback_2 exists, released_2 = false → "2차 승인 대기"
    if (item.released_1 && item.feedback_2 && !item.released_2) {
        return { text: '2차 승인 대기', cssClass: 'correction-badge-pending', isPending: true };
    }

    // released_1 = true, no feedback_2 → "2차 작성 대기"
    if (item.released_1 && !item.feedback_2) {
        return { text: '2차 작성 대기', cssClass: 'correction-badge-waiting', isPending: false };
    }

    // released_2 = true → "완료"
    if (item.released_2) {
        return { text: '완료', cssClass: 'correction-badge-complete', isPending: false };
    }

    // Fallback
    return { text: '진행중', cssClass: 'correction-badge-processing', isPending: false };
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
        feedback = typeof item.feedback_2 === 'string' ? JSON.parse(item.feedback_2) : item.feedback_2;
    } else if (item.feedback_1) {
        feedback = typeof item.feedback_1 === 'string' ? JSON.parse(item.feedback_1) : item.feedback_1;
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

    allCorrections.forEach(item => {
        total++;

        const status = getCorrectionStatus(item);
        if (status.isPending) pending++;

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
                    <button class="admin-btn admin-btn-primary admin-btn-sm" 
                            onclick="openCorrectionDetail('${item.id}')">
                        <i class="fas fa-cog"></i> 관리
                    </button>
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
 */
function parseFeedback(fb) {
    if (!fb) return null;
    if (typeof fb === 'string') {
        try { return JSON.parse(fb); } catch (e) { return null; }
    }
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
    firstPanel.innerHTML = '';
    const firstBtn = document.getElementById('toggleFirstFeedback');
    if (firstBtn) { firstBtn.classList.remove('active'); firstBtn.innerHTML = '<i class="fas fa-eye"></i> 1차 피드백 보기'; }

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
    const item = currentModalItem;

    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
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
        html += `<div class="corr-toggle-panel-annotated">${fb1.annotated_html}</div>`;
    } else if (!isWriting && fb1.per_question) {
        html += '<div class="corr-toggle-panel-annotated">';
        fb1.per_question.forEach((pq, i) => {
            html += `<div class="corr-feedback-question"><div class="corr-feedback-q-label">Q${pq.q || (i + 1)}</div>`;
            if (pq.annotated_html) html += `<div class="corr-feedback-q-body">${pq.annotated_html}</div>`;
            if (pq.comment) html += `<div class="corr-feedback-q-comment">${escapeHtml(pq.comment)}</div>`;
            html += '</div>';
        });
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
        renderFeedbackSummary(summaryEl, feedback);
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
        renderFeedbackSummary(summaryEl, feedback);
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

function renderFeedbackSummary(container, feedback) {
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
            <div class="corr-feedback-level-badge">${Number(feedback.level).toFixed(1)}</div>
            <div class="corr-feedback-level-label">Level Score</div>
        </div>`;
    }

    if (feedback.encouragement) {
        html += `<div class="corr-feedback-encouragement-card">
            <div class="corr-feedback-encouragement-title"><i class="fas fa-star"></i> 격려 메시지</div>
            <div class="corr-feedback-encouragement-text">${escapeHtml(feedback.encouragement)}</div>
        </div>`;
    }

    container.innerHTML = html;
}

// =====================================================================
// Section 3: Edit Mode + Save + Approve
// =====================================================================

let isEditMode = false;
let originalFeedbackBackup = null; // Deep copy for cancel

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
    for (let v = 1.0; v <= 6.0; v += 0.5) {
        const selected = (feedback.level !== undefined && feedback.level !== null && Number(feedback.level) === v) ? 'selected' : '';
        html += `<option value="${v}" ${selected}>${v.toFixed(1)}</option>`;
    }
    html += `</select>
        <div class="corr-feedback-level-label">Level Score</div>
    </div>`;

    // Encouragement textarea
    html += `<div class="corr-feedback-encouragement-card">
        <div class="corr-feedback-encouragement-title"><i class="fas fa-star"></i> 격려 메시지</div>
        <textarea class="corr-editable-textarea" id="editEncouragement">${escapeHtml(feedback.encouragement || '')}</textarea>
    </div>`;

    // Level change textarea (only for 2nd round)
    if (isFinal) {
        html += `<div class="corr-feedback-level-change-card">
            <div class="corr-feedback-level-change-title"><i class="fas fa-chart-line"></i> 점수 변화 설명</div>
            <textarea class="corr-editable-textarea" id="editLevelChange">${escapeHtml(feedback.level_change || '')}</textarea>
        </div>`;
    }

    summaryEl.innerHTML = html;
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

        alert('임시 저장 완료');
    } catch (err) {
        console.error('Temp save error:', err);
        alert('저장 실패: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 임시 저장';
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

        alert('승인 완료! 학생에게 피드백이 공개됩니다.');

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
    if (levelEl) result.level = parseFloat(levelEl.value);

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

// ===== Override closeCorrectionModal to handle edit mode =====

const _originalCloseCorrectionModal = closeCorrectionModal;

closeCorrectionModal = function() {
    if (isEditMode) {
        if (!confirm('편집 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
        isEditMode = false;
        originalFeedbackBackup = null;
        disableMarkAddition();

        // Reset UI
        document.getElementById('editBanner').classList.remove('show');
        document.getElementById('modalFooter').classList.remove('show');
        const editBtn = document.getElementById('editModeBtn');
        if (editBtn) { editBtn.classList.remove('editing'); editBtn.innerHTML = '<i class="fas fa-edit"></i> 편집'; }
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

    // Filter: only pending items
    const pendingItems = allCorrections.filter(item =>
        selectedIds.has(item.id) && getCorrectionStatus(item).isPending
    );

    if (pendingItems.length === 0) {
        alert('선택된 건 중 승인 대기 상태인 건이 없습니다.');
        return;
    }

    if (!confirm(`${pendingItems.length}건을 승인하시겠습니까?\n\n⚠️ AI 피드백 원본 그대로 학생에게 공개됩니다.`)) return;

    let successCount = 0;
    let failCount = 0;
    const now = new Date().toISOString();

    // Process in parallel
    const promises = pendingItems.map(async (item) => {
        try {
            const updateData = {};

            // Determine which released flag to set
            if (item.feedback_1 && !item.released_1) {
                updateData.released_1 = true;
                updateData.released_1_at = now;
            } else if (item.released_1 && item.feedback_2 && !item.released_2) {
                updateData.released_2 = true;
                updateData.released_2_at = now;
            } else {
                return; // Not actually pending
            }

            await supabaseAPI.patch('correction_submissions', item.id, updateData);

            // Update cache
            Object.assign(item, updateData);
            const idx = allCorrections.findIndex(c => c.id === item.id);
            if (idx >= 0) Object.assign(allCorrections[idx], updateData);

            successCount++;
        } catch (err) {
            console.error(`Bulk approve failed for ${item.id}:`, err);
            failCount++;
        }
    });

    await Promise.all(promises);

    // Result message
    let msg = `승인 완료: ${successCount}건`;
    if (failCount > 0) msg += `, 실패: ${failCount}건`;
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
