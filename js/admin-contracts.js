// Admin Contract Management
let allContracts = [];

// 독립 페이지에서 로드될 때만 실행
if (window.location.pathname.includes('admin-contracts.html')) {
    document.addEventListener('DOMContentLoaded', async () => {
        console.log('Admin contracts page loaded');
        
        // 관리자 확인
        if (!getLoggedInUser() || !getLoggedInUser().role || getLoggedInUser().role !== 'admin') {
            alert('관리자만 접근할 수 있습니다.');
            window.location.href = 'index.html';
            return;
        }
        
        // 관리자 이름 표시
        const adminUser = getLoggedInUser();
        const adminNameEl = document.getElementById('adminName');
        if (adminNameEl) {
            adminNameEl.textContent = adminUser.name || '관리자';
        }
        
        // 계약서 목록 로드
        await loadContracts();
    });
}

// 계약서 로드 (탭에서 호출 가능)
async function loadContracts() {
    await loadAllContracts();
}

// 모든 계약서 로드
async function loadAllContracts() {
    try {
        const response = await fetch('tables/contracts?limit=1000&sort=-created_at');
        const result = await response.json();
        
        if (result.data) {
            allContracts = result.data;
            console.log('Loaded contracts:', allContracts.length);
            
            // 사용 중인 학생 수 계산
            await calculateUsageCount();
            
            // UI 업데이트
            displayActiveContracts();
            displayInactiveContracts();
            updateLoadContractSelect();
            calculateNextVersion();
        }
        
        // 로딩 상태 숨기기 (탭과 독립 페이지 모두 지원)
        const loadingEl = document.getElementById('loading') || document.getElementById('contractsLoading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
        
        const managementEl = document.getElementById('contractManagement');
        if (managementEl) {
            managementEl.style.display = 'block';
        }
        
    } catch (error) {
        console.error('Failed to load contracts:', error);
        alert('계약서 목록을 불러오는데 실패했습니다.');
    }
}

// 사용 중인 학생 수 계산
async function calculateUsageCount() {
    try {
        const response = await fetch('tables/applications?limit=1000');
        const result = await response.json();
        
        if (result.data) {
            allContracts.forEach(contract => {
                contract.usageCount = result.data.filter(app => 
                    app.contract_template_id === contract.id
                ).length;
            });
        }
    } catch (error) {
        console.error('Failed to calculate usage count:', error);
    }
}

// 활성 계약서 목록 표시
function displayActiveContracts() {
    const activeContracts = allContracts.filter(c => c.is_active !== false);
    const container = document.getElementById('activeContractsList');
    
    if (activeContracts.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #94a3b8;">
                <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                <p>등록된 활성 계약서가 없습니다.</p>
                <p style="font-size: 14px; margin-top: 8px;">아래에서 새 계약서를 작성해주세요.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = activeContracts.map(contract => `
        <div style="border: 2px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px; background: white;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <span style="background: #9480c5; color: white; padding: 4px 12px; border-radius: 6px; font-weight: 600; font-size: 14px;">
                            ${escapeHtml(contract.version || 'v1')}
                        </span>
                        <h3 style="font-size: 18px; font-weight: 600; margin: 0; color: #1e293b;">
                            ${escapeHtml(contract.title)}
                        </h3>
                    </div>
                    <p style="font-size: 13px; color: #64748b; margin: 0;">
                        <i class="fas fa-calendar"></i> 생성: ${new Date(contract.created_at).toLocaleDateString('ko-KR')}
                        ${contract.updated_at !== contract.created_at ? 
                            ` | <i class="fas fa-edit"></i> 수정: ${new Date(contract.updated_at).toLocaleDateString('ko-KR')}` : ''}
                    </p>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: ${contract.usageCount > 0 ? '#dcfce7' : '#f1f5f9'}; 
                                 color: ${contract.usageCount > 0 ? '#166534' : '#64748b'}; 
                                 padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600;">
                        <i class="fas fa-users"></i> 사용 중: ${contract.usageCount || 0}명
                    </span>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button onclick="previewContract('${contract.id}')" class="btn-outline" style="font-size: 13px; padding: 8px 16px;">
                    <i class="fas fa-eye"></i> 미리보기
                </button>
                <button onclick="createNewVersionFrom('${contract.id}')" class="btn-secondary" style="font-size: 13px; padding: 8px 16px;">
                    <i class="fas fa-copy"></i> 이 계약서 기반으로 새 버전 만들기
                </button>
                <button onclick="deactivateContract('${contract.id}')" class="btn-outline" 
                        style="font-size: 13px; padding: 8px 16px; border-color: #f59e0b; color: #f59e0b;">
                    <i class="fas fa-archive"></i> 비활성화
                </button>
            </div>
        </div>
    `).join('');
}

// 비활성 계약서 목록 표시
function displayInactiveContracts() {
    const inactiveContracts = allContracts.filter(c => c.is_active === false);
    const container = document.getElementById('inactiveContractsList');
    const countBadge = document.getElementById('inactiveCount');
    
    countBadge.textContent = `${inactiveContracts.length}개`;
    
    if (inactiveContracts.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #94a3b8;">
                <p style="font-size: 14px;">비활성 계약서가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = inactiveContracts.map(contract => `
        <div style="border: 2px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px; background: #fafafa;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <span style="background: #94a3b8; color: white; padding: 4px 12px; border-radius: 6px; font-weight: 600; font-size: 14px;">
                            ${escapeHtml(contract.version || 'v1')}
                        </span>
                        <h4 style="font-size: 16px; font-weight: 600; margin: 0; color: #64748b;">
                            ${escapeHtml(contract.title)}
                        </h4>
                        <span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                            <i class="fas fa-archive"></i> 비활성
                        </span>
                    </div>
                    <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                        생성: ${new Date(contract.created_at).toLocaleDateString('ko-KR')} | 
                        사용됨: ${contract.usageCount || 0}명
                    </p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="previewContract('${contract.id}')" class="btn-outline" style="font-size: 12px; padding: 6px 12px;">
                        <i class="fas fa-eye"></i> 보기
                    </button>
                    <button onclick="reactivateContract('${contract.id}')" class="btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                        <i class="fas fa-undo"></i> 재활성화
                    </button>
                    ${contract.usageCount === 0 ? `
                        <button onclick="deleteContract('${contract.id}')" class="btn-outline" 
                                style="font-size: 12px; padding: 6px 12px; border-color: #ef4444; color: #ef4444;">
                            <i class="fas fa-trash"></i> 완전삭제
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

// 불러오기 셀렉트 업데이트
function updateLoadContractSelect() {
    const select = document.getElementById('loadContractSelect');
    const contracts = allContracts.filter(c => c.is_active !== false);
    
    select.innerHTML = '<option value="">기존 계약서 선택...</option>' + 
        contracts.map(c => `
            <option value="${c.id}">${c.version} - ${escapeHtml(c.title)}</option>
        `).join('');
}

// 다음 버전 계산
function calculateNextVersion() {
    if (allContracts.length === 0) {
        document.getElementById('newContractVersion').value = 'v1';
        return;
    }
    
    // 모든 버전 숫자 추출
    const versions = allContracts.map(c => {
        const match = (c.version || 'v0').match(/v(\d+)/);
        return match ? parseInt(match[1]) : 0;
    });
    
    const maxVersion = Math.max(...versions);
    const nextVersion = `v${maxVersion + 1}`;
    
    document.getElementById('newContractVersion').value = nextVersion;
}

// 기존 계약서 불러오기
function loadExistingContract() {
    const selectId = document.getElementById('loadContractSelect').value;
    if (!selectId) {
        alert('불러올 계약서를 선택해주세요.');
        return;
    }
    
    const contract = allContracts.find(c => c.id === selectId);
    if (!contract) {
        alert('계약서를 찾을 수 없습니다.');
        return;
    }
    
    document.getElementById('newContractTitle').value = contract.title;
    document.getElementById('newContractContent').value = contract.content;
    
    // 스크롤
    document.getElementById('newContractTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    alert(`✅ ${contract.version} - ${contract.title}\n\n내용이 불러와졌습니다.\n수정 후 저장하면 새 버전으로 등록됩니다.`);
}

// 특정 계약서 기반으로 새 버전 만들기
function createNewVersionFrom(contractId) {
    const contract = allContracts.find(c => c.id === contractId);
    if (!contract) return;
    
    document.getElementById('newContractTitle').value = contract.title;
    document.getElementById('newContractContent').value = contract.content;
    
    // 스크롤
    document.getElementById('newContractTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    alert(`✅ ${contract.version} - ${contract.title}\n\n내용이 복사되었습니다.\n수정 후 저장하면 ${document.getElementById('newContractVersion').value}로 등록됩니다.`);
}

// 새 계약서 저장
async function saveNewContract() {
    const version = document.getElementById('newContractVersion').value;
    const title = document.getElementById('newContractTitle').value.trim();
    const content = document.getElementById('newContractContent').value.trim();
    
    if (!title || !content) {
        alert('제목과 내용을 모두 입력해주세요.');
        return;
    }
    
    if (!confirm(`${version} - ${title}\n\n새 계약서를 등록하시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await fetch('tables/contracts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: version,
                title: title,
                content: content,
                is_active: true,
                created_at: Date.now(),
                updated_at: Date.now()
            })
        });
        
        if (response.ok) {
            alert('✅ 새 계약서가 등록되었습니다!');
            
            // 폼 초기화
            document.getElementById('newContractTitle').value = '';
            document.getElementById('newContractContent').value = '';
            
            // 새로고침
            await loadAllContracts();
        } else {
            alert('❌ 저장에 실패했습니다.');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 계약서 비활성화
async function deactivateContract(contractId) {
    const contract = allContracts.find(c => c.id === contractId);
    if (!contract) return;
    
    const message = `${contract.version} - ${contract.title}\n\n비활성화하시겠습니까?\n\n` +
                   `• 활성 계약서 목록에서 제거됩니다\n` +
                   `• 신규 발송 시 선택할 수 없습니다\n` +
                   `• 기존 사용 학생(${contract.usageCount || 0}명)은 영향 없음\n` +
                   `• 언제든지 재활성화 가능`;
    
    if (!confirm(message)) return;
    
    try {
        const response = await fetch(`tables/contracts/${contractId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                is_active: false,
                updated_at: Date.now()
            })
        });
        
        if (response.ok) {
            alert('✅ 비활성화되었습니다.');
            await loadAllContracts();
        } else {
            alert('❌ 실패했습니다.');
        }
    } catch (error) {
        console.error('Deactivate error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 계약서 재활성화
async function reactivateContract(contractId) {
    if (!confirm('이 계약서를 다시 활성화하시겠습니까?')) return;
    
    try {
        const response = await fetch(`tables/contracts/${contractId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                is_active: true,
                updated_at: Date.now()
            })
        });
        
        if (response.ok) {
            alert('✅ 재활성화되었습니다.');
            await loadAllContracts();
        } else {
            alert('❌ 실패했습니다.');
        }
    } catch (error) {
        console.error('Reactivate error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 계약서 완전 삭제
async function deleteContract(contractId) {
    const contract = allContracts.find(c => c.id === contractId);
    if (!contract) return;
    
    if (contract.usageCount > 0) {
        alert('사용 중인 계약서는 삭제할 수 없습니다.');
        return;
    }
    
    if (!confirm(`${contract.version} - ${contract.title}\n\n정말 완전히 삭제하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다!`)) {
        return;
    }
    
    try {
        const response = await fetch(`tables/contracts/${contractId}`, {
            method: 'DELETE'
        });
        
        if (response.ok || response.status === 204) {
            alert('✅ 삭제되었습니다.');
            await loadAllContracts();
        } else {
            alert('❌ 삭제에 실패했습니다.');
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('❌ 오류가 발생했습니다.');
    }
}

// 미리보기
function previewContract(contractId) {
    let contract;
    
    if (contractId) {
        contract = allContracts.find(c => c.id === contractId);
        if (!contract) {
            alert('계약서를 찾을 수 없습니다.');
            return;
        }
    } else {
        // 새 계약서 미리보기
        contract = {
            version: document.getElementById('newContractVersion').value,
            title: document.getElementById('newContractTitle').value.trim(),
            content: document.getElementById('newContractContent').value.trim()
        };
        
        if (!contract.title || !contract.content) {
            alert('제목과 내용을 입력해주세요.');
            return;
        }
    }
    
    // 샘플 데이터로 파싱
    const sampleData = getContractSampleData();
    const parsedHTML = parseContractTemplate(contract.content, sampleData);
    
    document.getElementById('previewContent').innerHTML = `
        ${getContractStyles()}
        <div class="contract-content">
            <h2 style="text-align: center; font-size: 28px; font-weight: 700; margin: 0 0 32px 0; color: #1e293b;">
                ${escapeHtml(contract.title)}
            </h2>
            <div style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="font-size: 13px; color: #1e40af; margin: 0;">
                    <i class="fas fa-info-circle"></i> 
                    이것은 샘플 데이터로 미리보기한 것입니다. 실제 발송 시 학생 정보가 자동으로 채워집니다.
                </p>
            </div>
            <div style="white-space: pre-wrap;">
                ${parsedHTML}
            </div>
        </div>
    `;
    
    document.getElementById('previewModal').style.display = 'block';
}

function previewNewContract() {
    previewContract(null);
}

function closePreview() {
    document.getElementById('previewModal').style.display = 'none';
}

// 비활성 계약서 토글
function toggleInactiveContracts() {
    const list = document.getElementById('inactiveContractsList');
    const icon = document.getElementById('inactiveToggleIcon');
    
    if (list.style.display === 'none') {
        list.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
    } else {
        list.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
    }
}

// 문법 가이드 토글
function toggleSyntaxGuide() {
    const guide = document.getElementById('syntaxGuide');
    guide.style.display = guide.style.display === 'none' ? 'block' : 'none';
}
