// Admin Users Management
let allUsers = [];
let selectedUserId = null;

// Load users on page load
document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
});

// Load all users
async function loadUsers() {
    try {
        const result = await supabaseAPI.get('users', { limit: 1000, sort: '-created_at' });
        
        if (result.data) {
            allUsers = result.data;
            displayUsers(allUsers);
            updateStats(allUsers);
        }
    } catch (error) {
        console.error('Failed to load users:', error);
        document.getElementById('usersBody').innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 60px; color: #ef4444;">
                    ❌ 회원 목록을 불러오는데 실패했습니다.
                </td>
            </tr>
        `;
    }
}

// Display users in table
function displayUsers(users) {
    const tbody = document.getElementById('usersBody');
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 60px;">
                    <i class="fas fa-users" style="font-size: 48px; color: #cbd5e1; margin-bottom: 16px;"></i>
                    <p style="color: #64748b;">등록된 회원이 없습니다.</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = users.map((user, index) => {
        const levelBadge = getLevelBadge(user.level);
        const statusBadge = user.blocked ? 
            '<span style="background: #fee2e2; color: #dc2626; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">🚫 차단</span>' : 
            '<span style="background: #dcfce7; color: #16a34a; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">✅ 정상</span>';
        
        const joinDate = new Date(user.created_at).toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
            <tr>
                <td style="text-align: center; font-weight: 600; color: #64748b;">${index + 1}</td>
                <td style="font-weight: 600;">${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.email)}</td>
                <td>${escapeHtml(user.phone || '-')}</td>
                <td style="text-align: center;">
                    <select onchange="changeUserLevel('${user.id}', this.value)" 
                            style="padding: 6px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; font-weight: 600;">
                        <option value="2" ${user.level === 2 ? 'selected' : ''}>등급 2</option>
                        <option value="5" ${user.level === 5 ? 'selected' : ''}>등급 5</option>
                        <option value="10" ${user.level === 10 ? 'selected' : ''}>등급 10</option>
                    </select>
                </td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="font-size: 13px; color: #64748b;">${joinDate}</td>
                <td style="text-align: center;">
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button onclick="resetPassword('${user.id}', '${escapeHtml(user.name)}')" 
                                class="admin-btn admin-btn-sm" 
                                style="background: #f59e0b; color: white;"
                                title="비밀번호 초기화">
                            <i class="fas fa-key"></i>
                        </button>
                        <button onclick="toggleBlock('${user.id}', ${user.blocked})" 
                                class="admin-btn admin-btn-sm ${user.blocked ? 'admin-btn-success' : 'admin-btn-danger'}"
                                title="${user.blocked ? '차단 해제' : '차단'}">
                            <i class="fas fa-${user.blocked ? 'check' : 'ban'}"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Get level badge HTML
function getLevelBadge(level) {
    const badges = {
        2: '<span style="background: #dbeafe; color: #2563eb; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">등급 2</span>',
        5: '<span style="background: #d1fae5; color: #059669; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">등급 5</span>',
        10: '<span style="background: #fef3c7; color: #d97706; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">등급 10</span>'
    };
    return badges[level] || badges[2];
}

// Update statistics
function updateStats(users) {
    document.getElementById('totalUsers').textContent = users.length;
    document.getElementById('level2Count').textContent = users.filter(u => u.level === 2).length;
    document.getElementById('level5Count').textContent = users.filter(u => u.level === 5).length;
    document.getElementById('level10Count').textContent = users.filter(u => u.level === 10).length;
}

// Search users
function searchUsers() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const levelFilter = document.getElementById('levelFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    
    let filtered = allUsers;
    
    // Search by name, email, phone
    if (searchTerm) {
        filtered = filtered.filter(user => 
            user.name.toLowerCase().includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm) ||
            (user.phone && user.phone.includes(searchTerm))
        );
    }
    
    // Filter by level
    if (levelFilter) {
        filtered = filtered.filter(user => user.level === parseInt(levelFilter));
    }
    
    // Filter by status
    if (statusFilter === 'active') {
        filtered = filtered.filter(user => !user.blocked);
    } else if (statusFilter === 'blocked') {
        filtered = filtered.filter(user => user.blocked);
    }
    
    displayUsers(filtered);
}

// Change user level
async function changeUserLevel(userId, newLevel) {
    if (!confirm(`회원 등급을 ${newLevel}로 변경하시겠습니까?`)) {
        loadUsers(); // 취소 시 원래 값으로 복원
        return;
    }
    
    try {
        const response = await fetch(`tables/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: parseInt(newLevel) })
        });
        
        if (response.ok) {
            alert('✅ 등급이 변경되었습니다.');
            loadUsers();
        } else {
            throw new Error('Failed to update level');
        }
    } catch (error) {
        console.error('Error updating level:', error);
        alert('❌ 등급 변경에 실패했습니다.');
        loadUsers();
    }
}

// Reset password
function resetPassword(userId, userName) {
    selectedUserId = userId;
    document.getElementById('resetUserName').textContent = userName;
    document.getElementById('resetPasswordModal').style.display = 'flex';
}

// Close reset password modal
function closeResetPasswordModal() {
    document.getElementById('resetPasswordModal').style.display = 'none';
    selectedUserId = null;
}

// Confirm reset password
async function confirmResetPassword() {
    if (!selectedUserId) return;
    
    try {
        const response = await fetch(`tables/users/${selectedUserId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: '000000' })
        });
        
        if (response.ok) {
            alert('✅ 비밀번호가 000000으로 초기화되었습니다.\n\n회원에게 임시 비밀번호를 전달해주세요.');
            closeResetPasswordModal();
            loadUsers();
        } else {
            throw new Error('Failed to reset password');
        }
    } catch (error) {
        console.error('Error resetting password:', error);
        alert('❌ 비밀번호 초기화에 실패했습니다.');
    }
}

// Toggle block status
async function toggleBlock(userId, currentBlocked) {
    const action = currentBlocked ? '차단 해제' : '차단';
    
    if (!confirm(`이 회원을 ${action}하시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await fetch(`tables/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocked: !currentBlocked })
        });
        
        if (response.ok) {
            alert(`✅ ${action}되었습니다.`);
            loadUsers();
        } else {
            throw new Error('Failed to toggle block');
        }
    } catch (error) {
        console.error('Error toggling block:', error);
        alert(`❌ ${action}에 실패했습니다.`);
    }
}

// Escape HTML
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Search on enter key
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchUsers();
        }
    });
});
