// Tab Switching Function
function switchTab(tabName, event) {
    if (event) {
        event.preventDefault();
    }
    
    // Update nav items
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.settings-nav-item').classList.add('active');
    
    // Update tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    // Load tab content if needed
    if (tabName === 'contracts') {
        loadContractsTab();
    } else if (tabName === 'payment') {
        loadPaymentInfo();
    } else if (tabName === 'support') {
        loadSupportInfo();
    } else if (tabName === 'platform') {
        loadPlatformInfo();
    } else if (tabName === 'usage-guide') {
        loadUsageGuideTab();
    }
    
    // Update URL hash
    window.location.hash = tabName;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check admin auth
    const user = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!user || user.role !== 'admin') {
        alert('⚠️ 관리자만 접근할 수 있습니다.');
        window.location.href = 'index.html';
        return;
    }
    
    // Set admin name
    const adminName = document.getElementById('adminName');
    if (adminName) {
        adminName.textContent = user.name || '관리자';
    }
    
    // Load initial tab from hash or default to contracts
    const hash = window.location.hash.substring(1);
    const initialTab = hash || 'contracts';
    
    // Find and click the nav item
    const navItem = document.querySelector(`.settings-nav-item[href="#${initialTab}"]`);
    if (navItem) {
        navItem.click();
    } else {
        // Default to first tab
        loadContractsTab();
    }
});

// ===== CONTRACTS TAB =====
async function loadContractsTab() {
    // 계약서 관리 로드 (admin-contracts.js의 함수 호출)
    if (typeof loadContracts === 'function') {
        await loadContracts();
    } else {
        console.error('admin-contracts.js not loaded');
    }
}

// ===== PAYMENT TAB =====
async function loadPaymentInfo() {
    try {
        const settings = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        
        if (settings && settings.length > 0) {
            const data = settings[0];
            document.getElementById('bankName').value = data.bank_name || '';
            document.getElementById('accountNumber').value = data.account_number || '';
            document.getElementById('accountHolder').value = data.account_holder || '';
        }
    } catch (error) {
        console.error('Failed to load payment info:', error);
    }
}

async function savePaymentInfo() {
    const bankName = document.getElementById('bankName').value.trim();
    const accountNumber = document.getElementById('accountNumber').value.trim();
    const accountHolder = document.getElementById('accountHolder').value.trim();
    
    if (!bankName || !accountNumber || !accountHolder) {
        alert('⚠️ 모든 필드를 입력해주세요.');
        return;
    }
    
    try {
        // Check if settings exist
        const existing = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        const settingsExist = existing && existing.length > 0;
        
        const data = {
            bank_name: bankName,
            account_number: accountNumber,
            account_holder: accountHolder
        };
        
        let result;
        if (settingsExist) {
            result = await supabaseAPI.patch('site_settings', existing[0].id, data);
        } else {
            data.setting_key = 'default';
            data.setting_value = 'default';
            result = await supabaseAPI.post('site_settings', data);
        }
        
        if (result) {
            alert('✅ 입금 계좌 정보가 저장되었습니다.');
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 저장 중 오류가 발생했습니다.');
    }
}

// ===== SUPPORT TAB =====
async function loadSupportInfo() {
    try {
        const settings = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        
        if (settings && settings.length > 0) {
            const data = settings[0];
            document.getElementById('supportPhone').value = data.support_phone || '';
            document.getElementById('supportEmail').value = data.support_email || '';
            document.getElementById('kakaoLink').value = data.kakao_link || '';
            document.getElementById('businessHours').value = data.business_hours || '';
        }
    } catch (error) {
        console.error('Failed to load support info:', error);
    }
}

async function saveSupportInfo() {
    const supportPhone = document.getElementById('supportPhone').value.trim();
    const supportEmail = document.getElementById('supportEmail').value.trim();
    const kakaoLink = document.getElementById('kakaoLink').value.trim();
    const businessHours = document.getElementById('businessHours').value.trim();
    
    if (!supportPhone || !supportEmail || !kakaoLink || !businessHours) {
        alert('⚠️ 모든 필드를 입력해주세요.');
        return;
    }
    
    try {
        const existing = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        const settingsExist = existing && existing.length > 0;
        
        const data = {
            support_phone: supportPhone,
            support_email: supportEmail,
            kakao_link: kakaoLink,
            business_hours: businessHours
        };
        
        let result;
        if (settingsExist) {
            result = await supabaseAPI.patch('site_settings', existing[0].id, data);
        } else {
            data.setting_key = 'default';
            data.setting_value = 'default';
            result = await supabaseAPI.post('site_settings', data);
        }
        
        if (result) {
            alert('✅ 고객 지원 정보가 저장되었습니다.');
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 저장 중 오류가 발생했습니다.');
    }
}

// ===== PLATFORM TAB =====
async function loadPlatformInfo() {
    try {
        const settings = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        
        if (settings && settings.length > 0) {
            const data = settings[0];
            document.getElementById('platformUrl').value = data.platform_url || '';
            document.getElementById('platformLoginId').value = data.platform_login_id || '';
            document.getElementById('platformLoginPw').value = data.platform_login_pw || '';
            document.getElementById('platformLoginGuide').value = data.platform_login_guide || '';
        }
    } catch (error) {
        console.error('Failed to load platform info:', error);
    }
}

async function savePlatformInfo() {
    const platformUrl = document.getElementById('platformUrl').value.trim();
    const platformLoginId = document.getElementById('platformLoginId').value.trim();
    const platformLoginPw = document.getElementById('platformLoginPw').value.trim();
    const platformLoginGuide = document.getElementById('platformLoginGuide').value.trim();
    
    if (!platformUrl) {
        alert('⚠️ 플랫폼 URL을 입력해주세요.');
        return;
    }
    
    try {
        const existing = await supabaseAPI.query('site_settings', { 'setting_key': 'eq.default' });
        const settingsExist = existing && existing.length > 0;
        
        const data = {
            platform_url: platformUrl,
            platform_login_id: platformLoginId,
            platform_login_pw: platformLoginPw,
            platform_login_guide: platformLoginGuide
        };
        
        let result;
        if (settingsExist) {
            result = await supabaseAPI.patch('site_settings', existing[0].id, data);
        } else {
            data.setting_key = 'default';
            data.setting_value = 'default';
            result = await supabaseAPI.post('site_settings', data);
        }
        
        if (result) {
            alert('✅ 플랫폼 접속 정보가 저장되었습니다.');
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 저장 중 오류가 발생했습니다.');
    }
}

// ===== USAGE GUIDE TAB =====
function loadUsageGuideTab() {
    const container = document.getElementById('usageGuideContainer');
    container.innerHTML = `
        <div class="form-container">
            <h3 style="font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 16px;">
                <i class="fas fa-book"></i> 상세 가이드 관리
            </h3>
            
            <p style="font-size: 14px; color: #64748b; margin-bottom: 24px;">
                학생들이 볼 수 있는 상세 이용 가이드를 편집하고 관리하세요.
            </p>
            
            <div style="display: flex; gap: 12px;">
                <button type="button" class="btn-outline" onclick="window.open('usage-guide.html', '_blank')" style="flex: 1;">
                    <i class="fas fa-eye"></i> 미리보기
                </button>
                <button type="button" class="btn-primary" onclick="window.location.href='admin-guide-editor.html'" style="flex: 1;">
                    <i class="fas fa-edit"></i> 가이드 편집하기
                </button>
            </div>
        </div>
    `;
}
