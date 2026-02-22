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

// 앱 상태를 필터 카테고리로 분류
function getAppStageFilter(app) {
    // 1. 개별분석 미등록
    if (!app.analysis_status || !app.analysis_content) return 'need_analysis';
    // 2. 학생 동의 대기
    if (!app.student_agreed_at) return 'student_waiting';
    // 3. 계약서 미발송
    if (!app.contract_sent) return 'need_contract';
    // 4. 계약서 동의 대기
    if (!app.contract_agreed) return 'student_waiting';
    // 5. 학생 입금 대기
    if (!app.deposit_confirmed_by_student) return 'student_waiting';
    // 6. 관리자 입금확인 필요
    if (!app.deposit_confirmed_by_admin) return 'need_deposit';
    // 7. 이용방법 전달 필요
    if (!app.guide_sent) return 'need_guide';
    // 8. 택배 발송 필요
    if (!app.shipping_completed) return 'need_shipping';
    // 9. 알림톡 예약 필요
    if (!app.kakaotalk_notification_sent) return 'need_kakao';
    // 10. 완료
    return 'completed';
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
        
        // 상태 필터 (프로세스 단계 기반)
        const matchesStatus = statusFilter === 'all' || getAppStageFilter(app) === statusFilter;
        
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
            <tr style="${isSelected ? 'background: #f0f9ff;' : ''}${app.deleted ? 'opacity: 0.55;' : ''}">
                <td>
                    <input type="checkbox" 
                           class="app-checkbox" 
                           data-id="${app.id}" 
                           ${isSelected ? 'checked' : ''}
                           onchange="toggleSelection('${app.id}')">
                </td>
                <td style="font-weight: 600;">
                    ${escapeHtml(app.name)}${app.deleted ? ' <span style="display:inline-block; background:#ef4444; color:white; font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:4px;">삭제됨</span>' : ''}
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
                    ${app.schedule_start ? formatDateOnly(app.schedule_start) : '<span style="color:#94a3b8;">미정</span>'}
                    <div style="font-size: 11px; color: #94a3b8;">
                        ${app.schedule_start ? getRelativeTime(app.schedule_start) : ''}
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
    // 선택 수에 따라 버튼 스타일 변경
    const btn = document.getElementById('bulkMenuBtn');
    if (btn) {
        btn.style.background = selectedIds.size > 0 ? '#8b5cf6' : '#475569';
    }
}

// 일괄처리 드롭다운 토글
function toggleBulkMenu() {
    const dropdown = document.getElementById('bulkDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// 드롭다운 외부 클릭 시 닫기
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('bulkDropdown');
    const btn = document.getElementById('bulkMenuBtn');
    if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

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

// ===== 일괄 계약서 발송 =====
async function showBulkContractModal() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 활성 계약서 목록 불러오기
    try {
        const contracts = await supabaseAPI.query('contracts', { 'is_active': 'eq.true', 'limit': '100' });
        
        if (!contracts || contracts.length === 0) {
            alert('활성화된 계약서가 없습니다.\n\n계약서 관리에서 먼저 계약서를 등록해주세요.');
            return;
        }

        // 선택 모달 생성
        const options = contracts.map(c => `<option value="${c.id}">${c.version} - ${c.title}</option>`).join('');
        
        const modal = document.createElement('div');
        modal.id = 'bulkContractModal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;';
        modal.innerHTML = `
            <div style="background:white; border-radius:12px; padding:32px; max-width:450px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 8px 0; font-size:18px;">📋 일괄 계약서 발송</h3>
                <p style="margin:0 0 20px 0; color:#64748b; font-size:14px;">${selectedIds.size}명에게 계약서를 발송합니다.</p>
                <select id="bulkContractSelect" style="width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; margin-bottom:20px;">
                    <option value="">계약서를 선택하세요...</option>
                    ${options}
                </select>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button onclick="document.getElementById('bulkContractModal').remove()" style="padding:10px 20px; border:1px solid #d1d5db; background:white; border-radius:8px; cursor:pointer; font-size:14px;">취소</button>
                    <button onclick="executeBulkContract()" style="padding:10px 20px; background:#8b5cf6; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; font-weight:600;">발송하기</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (error) {
        console.error('Load contracts error:', error);
        alert('계약서 목록을 불러오는데 실패했습니다.');
    }
}

async function executeBulkContract() {
    const selectId = document.getElementById('bulkContractSelect').value;
    if (!selectId) {
        alert('계약서를 선택해주세요.');
        return;
    }

    try {
        const contract = await supabaseAPI.getById('contracts', selectId);
        if (!contract) {
            alert('계약서를 찾을 수 없습니다.');
            return;
        }

        if (!confirm(`${selectedIds.size}명에게 "${contract.version} - ${contract.title}" 계약서를 발송하시겠습니까?`)) return;

        const updateData = {
            contract_sent: true,
            contract_sent_at: Date.now(),
            contract_template_id: contract.id,
            contract_version: contract.version,
            contract_title: contract.title,
            contract_snapshot: contract.content,
            current_step: 3
        };

        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, updateData)
        );

        await Promise.all(promises);
        document.getElementById('bulkContractModal').remove();
        alert(`✅ ${selectedIds.size}명에게 계약서가 발송되었습니다!`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk contract error:', error);
        alert('일부 계약서 발송에 실패했습니다.');
    }
}

// ===== 일괄 입금확인 =====
async function bulkConfirmDeposit() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    if (!confirm(`${selectedIds.size}명의 입금을 확인 처리하시겠습니까?\n\n각 학생의 최종 입금금액(final_price)으로 자동 처리됩니다.`)) return;

    try {
        const promises = Array.from(selectedIds).map(async (id) => {
            const app = await supabaseAPI.getById('applications', id);
            const amount = app?.final_price || 0;
            return supabaseAPI.patch('applications', id, {
                deposit_confirmed_by_admin: true,
                deposit_confirmed_by_admin_at: Date.now(),
                deposit_amount: amount,
                current_step: 5
            });
        });

        await Promise.all(promises);
        alert(`✅ ${selectedIds.size}명의 입금이 확인되었습니다!`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk deposit confirm error:', error);
        alert('일부 입금확인에 실패했습니다.');
    }
}

// ===== 일괄 이용방법 전달 =====
async function bulkSendGuide() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    if (!confirm(`${selectedIds.size}명에게 이용방법을 전달하시겠습니까?\n\n학생들의 "이용방법" 탭이 활성화됩니다.`)) return;

    try {
        const updateData = {
            guide_sent: true,
            guide_sent_at: Date.now()
        };

        const promises = Array.from(selectedIds).map(id =>
            supabaseAPI.patch('applications', id, updateData)
        );

        await Promise.all(promises);
        alert(`✅ ${selectedIds.size}명에게 이용방법이 전달되었습니다!`);
        clearSelection();
        loadApplications();
    } catch (error) {
        console.error('Bulk guide send error:', error);
        alert('일부 이용방법 전달에 실패했습니다.');
    }
}

// ===== 택배송장출력 (선택된 학생) =====
async function bulkExportShipping() {
    if (selectedIds.size === 0) {
        alert('선택된 신청서가 없습니다.');
        return;
    }

    // 드롭다운 닫기
    const dropdown = document.getElementById('bulkDropdown');
    if (dropdown) dropdown.style.display = 'none';

    try {
        const ids = Array.from(selectedIds);
        const apps = [];
        for (const id of ids) {
            const app = await supabaseAPI.getById('applications', id);
            if (app) apps.push(app);
        }

        if (apps.length === 0) {
            alert('선택된 신청서 정보를 불러올 수 없습니다.');
            return;
        }

        // 엑셀 데이터 생성 (지정된 컬럼 형식)
        const shippingData = apps.map(app => ({
            '받는분성명': app.name || '',
            '받는분전화번호': app.phone || '',
            '받는분기타연락처': '',
            '받는분주소(전체, 분할)': app.address || '',
            '품목명': '이온토플',
            '기본운임': '',
            '운임구분': '신용',
            '박스타입': '극소',
            '배송메세지1': ''
        }));

        const ws = XLSX.utils.json_to_sheet(shippingData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '택배송장');

        // 컬럼 너비 설정
        ws['!cols'] = [
            { wch: 12 },  // 받는분성명
            { wch: 15 },  // 받는분전화번호
            { wch: 15 },  // 받는분기타연락처
            { wch: 40 },  // 받는분주소
            { wch: 12 },  // 품목명
            { wch: 10 },  // 기본운임
            { wch: 10 },  // 운임구분
            { wch: 10 },  // 박스타입
            { wch: 20 }   // 배송메세지1
        ];

        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        XLSX.writeFile(wb, `택배송장_${today}_${apps.length}건.xlsx`);
        alert(`✅ ${apps.length}건의 택배송장이 다운로드되었습니다.`);
    } catch (error) {
        console.error('Shipping export error:', error);
        alert('택배송장 출력 중 오류가 발생했습니다.');
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

// ===== 운송장 일괄등록 =====
let trackingMatchResults = []; // 매칭 결과 저장

function openTrackingUploadModal() {
    const modal = document.getElementById('trackingUploadModal');
    modal.style.display = 'flex';
    resetTrackingUpload();
}

function closeTrackingUploadModal() {
    document.getElementById('trackingUploadModal').style.display = 'none';
    resetTrackingUpload();
}

function resetTrackingUpload() {
    document.getElementById('trackingUploadArea').style.display = 'block';
    document.getElementById('trackingPreview').style.display = 'none';
    document.getElementById('trackingFileInput').value = '';
    trackingMatchResults = [];
}

// 드래그 앤 드롭 설정
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('trackingDropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#0ea5e9';
        dropZone.style.background = '#f0f9ff';
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#cbd5e1';
        dropZone.style.background = 'transparent';
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#cbd5e1';
        dropZone.style.background = 'transparent';
        const file = e.dataTransfer.files[0];
        if (file) handleTrackingFile(file);
    });
});

// 엑셀 파일 파싱
function handleTrackingFile(file) {
    if (!file) return;
    if (!file.name.match(/\.xlsx?$/i)) {
        alert('엑셀 파일(.xlsx)만 업로드 가능합니다.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            if (rows.length === 0) {
                alert('엑셀 파일에 데이터가 없습니다.');
                return;
            }

            matchTrackingData(rows);
        } catch (err) {
            console.error('엑셀 파싱 에러:', err);
            alert('엑셀 파일을 읽을 수 없습니다. 파일 형식을 확인해주세요.');
        }
    };
    reader.readAsArrayBuffer(file);
}

// 이름 + 전화번호 중간4자리로 매칭
function matchTrackingData(rows) {
    trackingMatchResults = [];

    // 엑셀 컬럼명 자동 감지 (받는분, 전화번호, 운송장번호)
    // 엑셀에 "받는분" 컬럼이 2개 있을 수 있으므로 (보내는/받는) 뒤쪽 것을 사용
    const sampleRow = rows[0];
    const keys = Object.keys(sampleRow);

    // "받는분" 키 찾기 - 뒤쪽에 있는 것
    let recipientKey = null;
    let recipientPhoneKey = null;
    let trackingKey = null;

    // 키 이름으로 직접 매칭
    for (const key of keys) {
        if (key === '운송장번호') trackingKey = key;
    }

    // "받는분" 과 그 바로 다음 "전화번호" 찾기
    // 엑셀에서 동일한 컬럼명이 있으면 뒤의 것은 "_1" 등이 붙음
    for (let i = keys.length - 1; i >= 0; i--) {
        if (!recipientKey && (keys[i] === '받는분' || keys[i].match(/^받는분/))) {
            recipientKey = keys[i];
            // 바로 다음 키가 전화번호인지 확인
            if (i + 1 < keys.length && keys[i + 1].match(/전화번호/)) {
                recipientPhoneKey = keys[i + 1];
            }
        }
    }

    // 전화번호 키가 여러 개일 수 있음 - 뒤쪽 것 사용
    if (!recipientPhoneKey) {
        for (let i = keys.length - 1; i >= 0; i--) {
            if (keys[i].match(/전화번호/)) {
                recipientPhoneKey = keys[i];
                break;
            }
        }
    }

    if (!recipientKey || !trackingKey) {
        alert(`엑셀에서 필수 컬럼을 찾을 수 없습니다.\n필요: 받는분, 운송장번호\n발견된 컬럼: ${keys.join(', ')}`);
        return;
    }

    // 각 행 매칭
    rows.forEach(row => {
        const name = String(row[recipientKey] || '').trim();
        const phone = String(row[recipientPhoneKey] || '').trim();
        const tracking = String(row[trackingKey] || '').trim();

        if (!name || !tracking) return; // 빈 행 스킵

        // 전화번호에서 중간 4자리 추출 (010-XXXX-****)
        const phoneMid = extractPhoneMid(phone);

        // DB에서 매칭 (allApplications 사용)
        const matched = allApplications.filter(app => {
            if (app.name !== name) return false;
            if (phoneMid && app.phone) {
                const appPhoneMid = extractPhoneMid(app.phone);
                return appPhoneMid === phoneMid;
            }
            return true; // 전화번호 없으면 이름만으로 매칭
        });

        if (matched.length === 1) {
            // 이미 운송장이 등록된 경우 체크
            if (matched[0].shipping_tracking_number) {
                trackingMatchResults.push({
                    name, phone, tracking,
                    status: 'skip',
                    message: `이미 등록됨 (${matched[0].shipping_tracking_number})`,
                    appId: null
                });
            } else {
                trackingMatchResults.push({
                    name, phone, tracking,
                    status: 'matched',
                    message: matched[0].email,
                    appId: matched[0].id
                });
            }
        } else if (matched.length > 1) {
            trackingMatchResults.push({
                name, phone, tracking,
                status: 'fail',
                message: `동명이인 ${matched.length}명 (전화번호로 구별 불가)`,
                appId: null
            });
        } else {
            trackingMatchResults.push({
                name, phone, tracking,
                status: 'fail',
                message: '신청서를 찾을 수 없음',
                appId: null
            });
        }
    });

    renderTrackingPreview();
}

// 전화번호 중간 4자리 추출
function extractPhoneMid(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/[^0-9]/g, '');
    // 010XXXXXXXX (11자리) → 중간 4자리 = [3..7]
    if (cleaned.length >= 7) {
        return cleaned.substring(3, 7);
    }
    return '';
}

// 매칭 미리보기 렌더링
function renderTrackingPreview() {
    document.getElementById('trackingUploadArea').style.display = 'none';
    document.getElementById('trackingPreview').style.display = 'block';

    const matchCount = trackingMatchResults.filter(r => r.status === 'matched').length;
    const failCount = trackingMatchResults.filter(r => r.status === 'fail').length;
    const skipCount = trackingMatchResults.filter(r => r.status === 'skip').length;

    document.getElementById('trackingMatchCount').textContent = `✅ 매칭 성공: ${matchCount}건`;
    document.getElementById('trackingFailCount').textContent = 
        (failCount > 0 ? `❌ 실패: ${failCount}건` : '') +
        (skipCount > 0 ? ` ⏭️ 이미등록: ${skipCount}건` : '');

    const tbody = document.getElementById('trackingPreviewBody');
    tbody.innerHTML = trackingMatchResults.map(r => {
        const statusIcon = r.status === 'matched' ? '✅' : r.status === 'skip' ? '⏭️' : '❌';
        const rowColor = r.status === 'matched' ? '' : r.status === 'skip' ? 'background:#f8fafc;' : 'background:#fef2f2;';
        return `<tr style="${rowColor}">
            <td style="padding:8px 12px;">${statusIcon}</td>
            <td style="padding:8px 12px;">${escapeHtml(r.name)}</td>
            <td style="padding:8px 12px;">${escapeHtml(r.phone)}</td>
            <td style="padding:8px 12px; font-family:monospace; font-size:12px;">${escapeHtml(r.tracking)}</td>
            <td style="padding:8px 12px; font-size:12px; color:#64748b;">${escapeHtml(r.message)}</td>
        </tr>`;
    }).join('');

    // 매칭 성공 건이 없으면 등록 버튼 비활성화
    const submitBtn = document.getElementById('trackingSubmitBtn');
    if (matchCount === 0) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.cursor = 'not-allowed';
    } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
    }
}

// 일괄 등록 실행
async function submitTrackingBulk() {
    const toUpdate = trackingMatchResults.filter(r => r.status === 'matched');
    if (toUpdate.length === 0) {
        alert('등록할 건이 없습니다.');
        return;
    }

    if (!confirm(`매칭된 ${toUpdate.length}건의 운송장번호를 등록하고 발송완료 처리하시겠습니까?`)) {
        return;
    }

    const submitBtn = document.getElementById('trackingSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';

    let successCount = 0;
    const failedItems = [];

    for (const item of toUpdate) {
        try {
            await supabaseAPI.patch('applications', item.appId, {
                shipping_tracking_number: item.tracking,
                shipping_courier: 'CJ대한통운',
                shipping_completed: true,
                shipping_completed_at: Date.now()
            });
            successCount++;
        } catch (err) {
            console.error(`운송장 등록 실패: ${item.name}`, err);
            failedItems.push(item.name);
        }
    }

    // 결과 알림
    let message = `✅ ${successCount}건 운송장 등록 및 발송완료 처리되었습니다.`;

    const skipped = trackingMatchResults.filter(r => r.status === 'fail');
    const alreadyDone = trackingMatchResults.filter(r => r.status === 'skip');

    if (failedItems.length > 0) {
        message += `\n\n❌ 등록 실패 ${failedItems.length}건:\n${failedItems.join(', ')}\n(발송완료 처리도 되지 않았습니다)`;
    }
    if (skipped.length > 0) {
        message += `\n\n⚠️ 매칭 실패로 스킵된 ${skipped.length}건:\n${skipped.map(s => `${s.name} - ${s.message}`).join('\n')}`;
    }
    if (alreadyDone.length > 0) {
        message += `\n\n⏭️ 이미 등록된 ${alreadyDone.length}건:\n${alreadyDone.map(s => s.name).join(', ')}`;
    }

    alert(message);
    closeTrackingUploadModal();

    // 테이블 새로고침
    await loadApplications();
}
