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
    const elapsed = now - feedbackAt;
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
        if ((item.feedback_1_at && item.feedback_1_at >= todayStartMs) ||
            (item.feedback_2_at && item.feedback_2_at >= todayStartMs)) {
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
            if (!(
                (item.feedback_1_at && item.feedback_1_at >= todayStartMs) ||
                (item.feedback_2_at && item.feedback_2_at >= todayStartMs)
            )) {
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

// ===== Detail Modal Placeholder (Section 2) =====
function openCorrectionDetail(id) {
    alert('상세 모달은 구간 2에서 구현');
}
