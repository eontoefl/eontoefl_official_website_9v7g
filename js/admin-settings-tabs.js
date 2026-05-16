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
    } else if (tabName === 'notices') {
        if (typeof loadNotices === 'function') loadNotices();
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
                프로그램별 상세 이용 가이드를 편집하고 관리하세요.<br>
                각 가이드의 링크를 학생에게 공유하면 해당 이용방법 페이지가 표시됩니다.
            </p>
            
            <!-- 내벨업챌린지 가이드 -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <h4 style="font-size: 15px; font-weight: 600; color: #1e293b; margin: 0;">
                        <i class="fas fa-flag" style="color: #9480c5; margin-right: 8px;"></i>내벨업챌린지 이용방법
                    </h4>
                    <span style="font-size: 12px; color: #94a3b8; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; cursor: pointer;" onclick="copyGuideLink('challenge')" title="클릭하여 복사">
                        <i class="fas fa-link"></i> usage-guide.html?type=challenge
                    </span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn-outline" onclick="window.open('usage-guide.html?type=challenge', '_blank')" style="flex: 1; font-size: 13px;">
                        <i class="fas fa-eye"></i> 미리보기
                    </button>
                    <button type="button" class="btn-primary" onclick="window.location.href='admin-guide-editor.html?type=challenge'" style="flex: 1; font-size: 13px;">
                        <i class="fas fa-edit"></i> 편집하기
                    </button>
                </div>
            </div>
            
            <!-- 내벨업챌린지 Australia 가이드 -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <h4 style="font-size: 15px; font-weight: 600; color: #1e293b; margin: 0;">
                        <span style="margin-right: 8px; font-size: 18px;">🇦🇺</span>내벨업챌린지 Australia
                    </h4>
                    <span style="font-size: 12px; color: #94a3b8; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; cursor: pointer;" onclick="copyGuideLink('nevelupaustralia')" title="클릭하여 복사">
                        <i class="fas fa-link"></i> usage-guide.html?type=nevelupaustralia
                    </span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn-outline" onclick="window.open('usage-guide.html?type=nevelupaustralia', '_blank')" style="flex: 1; font-size: 13px;">
                        <i class="fas fa-eye"></i> 미리보기
                    </button>
                    <button type="button" class="btn-primary" onclick="window.location.href='admin-guide-editor.html?type=nevelupaustralia'" style="flex: 1; font-size: 13px;">
                        <i class="fas fa-edit"></i> 편집하기
                    </button>
                </div>
            </div>
            
            <!-- 첨삭 가이드 -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <h4 style="font-size: 15px; font-weight: 600; color: #1e293b; margin: 0;">
                        <i class="fas fa-pen-nib" style="color: #3b82f6; margin-right: 8px;"></i>첨삭 이용방법
                    </h4>
                    <span style="font-size: 12px; color: #94a3b8; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; cursor: pointer;" onclick="copyGuideLink('correction')" title="클릭하여 복사">
                        <i class="fas fa-link"></i> usage-guide.html?type=correction
                    </span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="button" class="btn-outline" onclick="window.open('usage-guide.html?type=correction', '_blank')" style="flex: 1; font-size: 13px;">
                        <i class="fas fa-eye"></i> 미리보기
                    </button>
                    <button type="button" class="btn-primary" onclick="window.location.href='admin-guide-editor.html?type=correction'" style="flex: 1; font-size: 13px;">
                        <i class="fas fa-edit"></i> 편집하기
                    </button>
                </div>
            </div>
            
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e;">
                <i class="fas fa-info-circle"></i> 
                링크를 클릭하면 전체 URL이 클립보드에 복사됩니다. 카톡, 알림톡 등에 자유롭게 활용하세요.
            </div>
        </div>
    `;
}

// 가이드 링크 복사
function copyGuideLink(type) {
    const baseUrl = window.location.origin;
    const url = baseUrl + '/usage-guide.html?type=' + type;
    navigator.clipboard.writeText(url).then(() => {
        alert('링크가 복사되었습니다!\n\n' + url);
    }).catch(() => {
        // fallback
        prompt('아래 링크를 복사하세요:', url);
    });
}
