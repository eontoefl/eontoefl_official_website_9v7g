// Admin Panel JavaScript
let allApplications = [];
let currentPage = 1;
const itemsPerPage = 10;

// Load applications on page load
document.addEventListener('DOMContentLoaded', () => {
    loadApplications();
    
    // Filter listeners
    document.getElementById('searchInput').addEventListener('input', filterApplications);
    document.getElementById('statusFilter').addEventListener('change', filterApplications);
    document.getElementById('programFilter').addEventListener('change', filterApplications);
});

// Load all applications from API
async function loadApplications() {
    showLoading(true);
    
    try {
        const response = await fetch('tables/applications?limit=1000&sort=-created_at');
        const data = await response.json();
        
        if (data.data) {
            allApplications = data.data;
            filterApplications();
        } else {
            document.getElementById('applicationsBody').innerHTML = 
                '<tr><td colspan="8" style="text-align:center;padding:40px;color:#64748b;">등록된 신청서가 없습니다.</td></tr>';
        }
    } catch (error) {
        console.error('Failed to load applications:', error);
        document.getElementById('applicationsBody').innerHTML = 
            '<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">데이터를 불러오는데 실패했습니다.</td></tr>';
    } finally {
        showLoading(false);
    }
}

// Filter and display applications
function filterApplications() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const programFilter = document.getElementById('programFilter').value;
    
    let filtered = allApplications.filter(app => {
        const matchesSearch = app.student_name.toLowerCase().includes(searchTerm) || 
                            app.email.toLowerCase().includes(searchTerm);
        const matchesStatus = !statusFilter || app.status === statusFilter;
        const matchesProgram = !programFilter || app.program === programFilter;
        
        return matchesSearch && matchesStatus && matchesProgram;
    });
    
    displayApplications(filtered);
}

// Display applications in table
function displayApplications(applications) {
    const tbody = document.getElementById('applicationsBody');
    
    if (applications.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#64748b;">검색 결과가 없습니다.</td></tr>';
        return;
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedApps = applications.slice(startIndex, endIndex);
    
    tbody.innerHTML = paginatedApps.map(app => {
        const statusClass = app.status === '승인' ? 'status-approved' : 
                          app.status === '거부' ? 'status-rejected' : 'status-pending';
        
        return `
            <tr>
                <td><strong>${escapeHtml(app.student_name)}</strong></td>
                <td style="font-size:12px;">${escapeHtml(app.email)}</td>
                <td style="font-size:12px;">${escapeHtml(app.phone)}</td>
                <td style="font-size:12px;">${escapeHtml(app.program)}</td>
                <td><strong>${app.target_score}점</strong></td>
                <td><span class="status-badge ${statusClass}">${escapeHtml(app.status)}</span></td>
                <td style="font-size:11px;">${formatDate(app.created_at)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-view" onclick="viewApplication('${app.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${app.status === '대기중' ? `
                            <button class="btn-small btn-approve" onclick="updateStatus('${app.id}', '승인')">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="btn-small btn-reject" onclick="updateStatus('${app.id}', '거부')">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // Show pagination if needed
    if (applications.length > itemsPerPage) {
        displayPagination(applications.length);
    } else {
        document.getElementById('pagination').style.display = 'none';
    }
}

// Display pagination
function displayPagination(totalItems) {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'block';
    pagination.innerHTML = '';
    
    for (let i = 1; i <= totalPages; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.style.cssText = `
            padding: 8px 14px;
            margin: 0 4px;
            border: 1px solid #e2e8f0;
            background: ${i === currentPage ? '#9480c5' : '#fff'};
            color: ${i === currentPage ? '#fff' : '#1e293b'};
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        `;
        
        button.addEventListener('click', () => {
            currentPage = i;
            filterApplications();
        });
        
        pagination.appendChild(button);
    }
}

// View application details
async function viewApplication(id) {
    const app = allApplications.find(a => a.id === id);
    if (!app) return;
    
    const modalContent = document.getElementById('modalContent');
    modalContent.innerHTML = `
        <div class="detail-row">
            <div class="detail-label">학생 이름</div>
            <div class="detail-value">${escapeHtml(app.student_name)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">이메일</div>
            <div class="detail-value">${escapeHtml(app.email)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">전화번호</div>
            <div class="detail-value">${escapeHtml(app.phone)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">희망 프로그램</div>
            <div class="detail-value">${escapeHtml(app.program)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">현재 레벨</div>
            <div class="detail-value">${escapeHtml(app.current_level)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">목표 점수</div>
            <div class="detail-value">${app.target_score}점</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">학습 목표</div>
            <div class="detail-value">${escapeHtml(app.learning_goals)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">상태</div>
            <div class="detail-value">
                <span class="status-badge ${app.status === '승인' ? 'status-approved' : app.status === '거부' ? 'status-rejected' : 'status-pending'}">
                    ${escapeHtml(app.status)}
                </span>
            </div>
        </div>
        <div class="detail-row">
            <div class="detail-label">신청일</div>
            <div class="detail-value">${formatDate(app.created_at)}</div>
        </div>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">
        <div class="form-group">
            <label for="adminComment" class="form-label">관리자 댓글</label>
            <textarea id="adminComment" class="form-textarea" placeholder="학생에게 전달할 메시지를 작성하세요...">${escapeHtml(app.admin_comment || '')}</textarea>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button class="btn-primary" onclick="saveComment('${app.id}')" style="flex: 1;">
                <i class="fas fa-save"></i> 댓글 저장
            </button>
            ${app.status === '대기중' ? `
                <button class="btn-outline" onclick="updateStatus('${app.id}', '승인')" style="flex: 1;">
                    <i class="fas fa-check"></i> 승인
                </button>
                <button class="btn-outline" onclick="updateStatus('${app.id}', '거부')" style="flex: 1; border-color: #ef4444; color: #ef4444;">
                    <i class="fas fa-times"></i> 거부
                </button>
            ` : ''}
        </div>
        ${app.status !== '대기중' ? `
            <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 6px; font-size: 12px; color: #92400e;">
                <strong>💡 카카오톡 알림 발송 (백엔드 서버 연동 필요)</strong><br>
                이 기능은 서버 측에서 카카오톡 API를 통해 구현해야 합니다.<br>
                현재는 정적 웹사이트이므로 직접 전화나 이메일로 연락해주세요.
            </div>
        ` : ''}
    `;
    
    openModal('detailModal');
}

// Update application status
async function updateStatus(id, newStatus) {
    if (!confirm(`정말로 이 신청서를 ${newStatus} 처리하시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await fetch(`tables/applications/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
            showAlert(`신청서가 ${newStatus} 처리되었습니다.`, 'success');
            await loadApplications();
            closeModal('detailModal');
        } else {
            throw new Error('상태 업데이트 실패');
        }
    } catch (error) {
        console.error('Status update error:', error);
        showAlert('상태 업데이트에 실패했습니다.', 'error');
    }
}

// Save admin comment
async function saveComment(id) {
    const comment = document.getElementById('adminComment').value.trim();
    
    try {
        const response = await fetch(`tables/applications/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ admin_comment: comment })
        });
        
        if (response.ok) {
            showAlert('댓글이 저장되었습니다.', 'success');
            await loadApplications();
            closeModal('detailModal');
        } else {
            throw new Error('댓글 저장 실패');
        }
    } catch (error) {
        console.error('Comment save error:', error);
        showAlert('댓글 저장에 실패했습니다.', 'error');
    }
}

// Modal functions
function openModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
    }
});
