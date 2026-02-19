// Admin Applications Management JavaScript
let allApplications = [];
let filteredApplications = [];
let selectedIds = new Set();
const itemsPerPage = 20;
let currentPage = 1;

// 관리자 상태 메시지 반환 함수
function getAdminActionMessage(app) {
    // 1. 신청서 제출 ~ 관리자 분석 등록 전
    if (!app.analysis_status || !app.analysis_content) {
        return { text: '개별 분석을 올려주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 2. 관리자 분석 등록 ~ 학생 동의 전
    if (!app.student_agreed_at) {
        return { text: '학생 동의를 기다리고 있어요', color: '#3b82f6', bgColor: '#dbeafe' };
    }
    
    // 3. 학생 동의 완료 ~ 관리자 계약서 업로드 전
    if (!app.contract_sent) {
        return { text: '계약서를 올려주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 4. 관리자 계약서 업로드 ~ 학생 계약서 동의 전
    if (!app.contract_agreed) {
        return { text: '계약서 동의를 기다리고 있어요', color: '#3b82f6', bgColor: '#dbeafe' };
    }
    
    // 5. 학생 계약서 동의 ~ 학생 입금 버튼 클릭 전
    if (!app.deposit_confirmed_by_student) {
        return { text: '입금을 기다리고 있어요', color: '#3b82f6', bgColor: '#dbeafe' };
    }
    
    // 6. 학생 입금 버튼 클릭 ~ 관리자 입금 확인 전
    if (!app.deposit_confirmed_by_admin) {
        return { text: '입금확인 해주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 7. 관리자 입금 확인 ~ 관리자 이용방법 업로드 전
    if (!app.guide_sent) {
        return { text: '이용방법을 올려주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 8. 관리자 이용방법 업로드 ~ 택배 발송 등록 전
    if (!app.shipping_completed) {
        return { text: '택배를 발송해주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 9. 택배 발송 등록 ~ 알림톡 예약 완료 전
    if (!app.kakaotalk_notification_sent) {
        return { text: '알림톡 예약을 진행해주세요', color: '#f59e0b', bgColor: '#fef3c7' };
    }
    
    // 10. 모든 작업 완료
    return { text: '세팅 완료', color: '#22c55e', bgColor: '#dcfce7' };
}

document.addEventListener('DOMContentLoaded', () => {
    // 관리자 권한 체크
    requireAdmin();
    
    // 관리자 정보 표시
    const adminInfo = getAdminInfo();
    document.getElementById('adminName').textContent = adminInfo.name;
    
    // URL 파라미터 확인
    const urlParams = new URLSearchParams(window.location.search);
    const statusParam = urlParams.get('status');
    if (statusParam) {
        document.getElementById('statusFilter').value = statusParam;
    }
    
    // 이벤트 리스너
    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);
    document.getElementById('programFilter').addEventListener('change', applyFilters);
    document.getElementById('sortBy').addEventListener('change', applyFilters);
    
    // 데이터 로드
    loadApplications();
});

// 신청서 데이터 로드
async function loadApplications() {
    try {
        const result = await supabaseAPI.get('applications', { limit: 1000 });
        
        if (result.data && result.data.length > 0) {
            allApplications = result.data;
            applyFilters();
        } else {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('emptyState').style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to load applications:', error);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
    }
}

// 필터 적용
function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const programFilter = document.getElementById('programFilter').value;
    const sortBy = document.getElementById('sortBy').value;
    
    // 필터링
    filteredApplications = allApplications.filter(app => {
        // 검색어 필터
        const matchesSearch = !searchTerm || 
            (app.name && app.name.toLowerCase().includes(searchTerm)) ||
            (app.email && app.email.toLowerCase().includes(searchTerm)) ||
            (app.phone && app.phone.toLowerCase().includes(searchTerm));
        
        // 상태 필터
        const matchesStatus = statusFilter === 'all' || 
            (app.status || '접수완료') === statusFilter;
        
        // 프로그램 필터
        const matchesProgram = programFilter === 'all' || 
            (app.preferred_program || '') === programFilter;
        
        return matchesSearch && matchesStatus && matchesProgram;
    });
    
    // 정렬
    if (sortBy === 'newest') {
        filteredApplications.sort((a, b) => b.created_at - a.created_at);
    } else if (sortBy === 'oldest') {
        filteredApplications.sort((a, b) => a.created_at - b.created_at);
    } else if (sortBy === 'name') {
        filteredApplications.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }
    
    // 페이지 초기화
    currentPage = 1;
    displayApplications();
}

// 신청서 표시
function displayApplications() {
    if (filteredApplications.length === 0) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('applicationsTable').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';
        return;
    }
    
    // 페이지네이션 계산
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageApplications = filteredApplications.slice(startIndex, endIndex);
    
    // 테이블 생성
    const tableHTML = pageApplications.map(app => {
        const actionMessage = getAdminActionMessage(app);
        const isSelected = selectedIds.has(app.id);
        
        return `
            <tr style="${isSelected ? 'background: #f0f9ff;' : ''}">
                <td>
                    <input type="checkbox" 
                           class="app-checkbox" 
                           data-id="${app.id}" 
                           ${isSelected ? 'checked' : ''}
                           onchange="toggleSelection('${app.id}')">
                </td>
                <td style="font-weight: 600;">
                    ${escapeHtml(app.name)}
                </td>
                <td style="font-size: 13px;">
                    ${escapeHtml(app.email)}
                </td>
                <td style="font-size: 13px;">
                    ${formatPhone(app.phone)}
                </td>
                <td>
                    <span style="color: #9480c5; font-weight: 500; font-size: 13px;">
                        ${escapeHtml(app.preferred_program || '-')}
                    </span>
                </td>
                <td style="font-size: 13px; color: #64748b;">
                    ${formatDateOnly(app.created_at)}
                    <div style="font-size: 11px; color: #94a3b8;">
                        ${getRelativeTime(app.created_at)}
                    </div>
                </td>
                <td>
                    <div style="display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; white-space: nowrap; background: ${actionMessage.bgColor}; color: ${actionMessage.color};">
                        ${actionMessage.text}
                    </div>
                </td>
                <td>
                    <div style="display: flex; gap: 6px;">
                        <button class="admin-btn admin-btn-primary admin-btn-sm" 
                                onclick="openManageModal('${app.id}')"
                                title="관리">
                            <i class="fas fa-cog"></i> 관리
                        </button>
                        <a href="application-detail.html?id=${app.id}" 
                           class="admin-btn admin-btn-secondary admin-btn-sm"
                           target="_blank"
                           title="학생 화면 보기">
                            <i class="fas fa-eye"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    document.getElementById('tableBody').innerHTML = tableHTML;
    
    // 카운트 업데이트
    document.getElementById('totalCount').textContent = filteredApplications.length;
    document.getElementById('displayCount').textContent = pageApplications.length;
    
    // 페이지네이션 업데이트
    updatePagination();
    
    // 선택 카운트 업데이트
    updateSelectionCount();
    
    // 화면 표시
    document.getElementById('loading').style.display = 'none';
    document.getElementById('applicationsTable').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}

// 페이지네이션 업데이트
function updatePagination() {
    const totalPages = Math.ceil(filteredApplications.length / itemsPerPage);
    if (totalPages <= 1) {
        document.getElementById('pagination').innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    
    // 이전 버튼
    if (currentPage > 1) {
        paginationHTML += `
            <button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${currentPage - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
    }
    
    // 페이지 번호
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            paginationHTML += `
                <button class="admin-btn admin-btn-primary admin-btn-sm">
                    ${i}
                </button>
            `;
        } else if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            paginationHTML += `
                <button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${i})">
                    ${i}
                </button>
            `;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            paginationHTML += `<span style="padding: 8px;">...</span>`;
        }
    }
    
    // 다음 버튼
    if (currentPage < totalPages) {
        paginationHTML += `
            <button class="admin-btn admin-btn-outline admin-btn-sm" onclick="changePage(${currentPage + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
    }
    
    document.getElementById('pagination').innerHTML = paginationHTML;
}

// 페이지 변경
function changePage(page) {
    currentPage = page;
    displayApplications();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 선택 토글
function toggleSelection(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    updateSelectionCount();
    displayApplications();
}

// 전체 선택 토글
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageApplications = filteredApplications.slice(startIndex, endIndex);
    
    if (selectAll.checked) {
        pageApplications.forEach(app => selectedIds.add(app.id));
    } else {
        pageApplications.forEach(app => selectedIds.delete(app.id));
    }
    
    updateSelectionCount();
    displayApplications();
}

// 선택 해제
function clearSelection() {
    selectedIds.clear();
    document.getElementById('selectAll').checked = false;
    updateSelectionCount();
    displayApplications();
}

// 선택 카운트 업데이트
function updateSelectionCount() {
    document.getElementById('selectedCount').textContent = selectedIds.size;
    document.getElementById('bulkActionsCard').style.display = 
        selectedIds.size > 0 ? 'block' : 'none';
}

// 빠른 승인
async function quickApprove(id) {
    if (!confirm('이 신청서를 승인하시겠습니까?')) return;
    
    try {
        const result = await supabaseAPI.patch('applications', id, { status: '승인' });
        
        if (result) {
            alert('승인되었습니다.');
            loadApplications();
        } else {
            alert('승인 실패했습니다.');
        }
    } catch (error) {
        console.error('Approval error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 빠른 거부
async function quickReject(id) {
    if (!confirm('이 신청서를 거부하시겠습니까?')) return;
    
    try {
        const result = await supabaseAPI.patch('applications', id, { status: '거부' });
        
        if (result) {
            alert('거부되었습니다.');
            loadApplications();
        } else {
            alert('거부 실패했습니다.');
        }
    } catch (error) {
        console.error('Rejection error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 일괄 승인
async function bulkApprove() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }
    
    if (!confirm(`${selectedIds.size}개의 신청서를 일괄 승인하시겠습니까?`)) return;
    
    try {
        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, { status: '승인' })
        );
        
        await Promise.all(promises);
        alert('일괄 승인되었습니다.');
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk approval error:', error);
        alert('일부 신청서 승인에 실패했습니다.');
    }
}

// 일괄 거부
async function bulkReject() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }
    
    if (!confirm(`${selectedIds.size}개의 신청서를 일괄 거부하시겠습니까?`)) return;
    
    try {
        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, { status: '거부' })
        );
        
        await Promise.all(promises);
        alert('일괄 거부되었습니다.');
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk rejection error:', error);
        alert('일부 신청서 거부에 실패했습니다.');
    }
}

// 엑셀 다운로드
function downloadExcel() {
    if (filteredApplications.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    
    // 엑셀 데이터 준비
    const excelData = filteredApplications.map(app => ({
        '이름': app.name || '',
        '이메일': app.email || '',
        '전화번호': app.phone || '',
        '주소': app.address || '',
        '직업': app.occupation || '',
        '프로그램': app.preferred_program || '',
        '수업 시작일': app.preferred_start_date || '',
        '제출 데드라인': app.submission_deadline || '',
        '현재 점수': app.total_score || '',
        '목표 점수': app.target_cutoff_old || app.target_cutoff_new || '',
        '토플 필요 이유': app.toefl_reason || '',
        '상태': app.status || '접수완료',
        '신청일': formatDate(app.created_at),
        '관리자 코멘트': app.admin_comment || ''
    }));
    
    // 워크시트 생성
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '신청서 목록');
    
    // 파일 다운로드
    const fileName = `이온토플_신청서_${formatDateOnly(Date.now())}.xlsx`;
    XLSX.writeFile(wb, fileName);
}
