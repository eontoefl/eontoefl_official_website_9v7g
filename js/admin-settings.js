// 기본 템플릿 텍스트 (상수)
const DEFAULT_NECESSITIES = `1. 내벨업테스트룸 액세스
➡️ 내벨업테스트룸은 내벨업챌린지에 포함된 실제 모의고사 풀이 + 2단계 오답시스템 + 채점, 해설, 모범답안 + 인증률 체크 및 기록 등의 올인원 프로그램입니다.
➡️일괄로 챌린지 시작전 매주 목요일에 액세스가 가능해집니다. (먼저 공부를 시작하고 싶으신분은 개별적으로 요청해주시면 먼저 액세스 해드릴게요)

2. 실물택배 (빈노트테이킹, 보카실물책, 연필, 연필깎이) 
➡️직접 수기로 써야 하는 것들을 실물택배로 따로 제공합니다.
➡️보통 챌린지 시작(일요일) 전, 목~금 사이에 출고됩니다.(특별한일이 없으면 다음날 도착합니다)`;

const DEFAULT_REFUND = `✔️환불 '일절' 불가능한 상황 :
➡️내벨업테스트룸 액세스 이후
*실물교재 열람시 환불가능금액에서 50,000원 제외.`;

const DEFAULT_NEXT_ACTIONS = `✔️ 이제 뭘하면 되나요?
➡️이용방법을 정독해주세요. 미숙지로 인한 보상은 이루어지지 않습니다.
➡️개별분석에서 세팅한 기간으로 시험을 등록해주세요. 생각보다 많은 분들이 전문가의 조언을 간과하여 목표점수 달성 실패 뿐 아니라 할인금도 반환하고 계십니다. 
➡️시험등록을 미리 해놓는 경우 능률은 3.2배 이상 높아집니다. (토플을 10년넘게한 제말을 믿으세요!)
➡️챌린지 시작날에 리마인더를 보내드립니다.`;

const DEFAULT_COMMUNICATION = `✔️ 앞으로의 소통
➡️ 사이트 댓글은, 신청 및 진행과정만 진행합니다.
➡️ 이후부터의 문의사항은 채팅방(카카오톡)으로 보내주세요.`;

// Admin Site Settings
let currentSettings = null;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Admin settings page loaded');
    
    // 관리자 확인
    const user = getLoggedInUser();
    if (!user || user.role !== 'admin') {
        alert('관리자만 접근할 수 있습니다.');
        window.location.href = 'index.html';
        return;
    }
    
    // 관리자 이름 표시
    document.getElementById('adminName').textContent = user.name || '관리자';
    
    // 설정 로드
    await loadSettings();
});

// 설정 로드
async function loadSettings() {
    try {
        console.log('Loading site settings...');
        const result = await supabaseAPI.getById('site_settings', 'default');
        
        if (result) {
            currentSettings = result;
            console.log('Settings loaded:', currentSettings);
            
            // 폼에 데이터 채우기
            document.getElementById('bankName').value = currentSettings.bank_name || '';
            document.getElementById('accountNumber').value = currentSettings.account_number || '';
            document.getElementById('accountHolder').value = currentSettings.account_holder || '';
            document.getElementById('email').value = currentSettings.email || '';
            document.getElementById('kakaoLink').value = currentSettings.kakao_link || '';
            document.getElementById('platformUrl').value = currentSettings.platform_url || '';
            document.getElementById('platformLoginGuide').value = currentSettings.platform_login_guide || '';
            
            // 이용방법 안내 필드 (비어있으면 기본 템플릿 사용)
            document.getElementById('necessitiesText').value = currentSettings.necessities_text || DEFAULT_NECESSITIES;
            document.getElementById('refundWarning').value = currentSettings.refund_warning || DEFAULT_REFUND;
            document.getElementById('nextActions').value = currentSettings.next_actions || DEFAULT_NEXT_ACTIONS;
            document.getElementById('communicationGuide').value = currentSettings.communication_guide || DEFAULT_COMMUNICATION;
            document.getElementById('usageGuideUrl').value = currentSettings.usage_guide_url || 'usage-guide.html';
            
            // 마지막 수정 시간
            if (currentSettings.updated_at) {
                document.getElementById('lastUpdatedTime').textContent = 
                    new Date(currentSettings.updated_at).toLocaleString('ko-KR');
            }
        } else if (response.status === 404) {
            // 설정이 없으면 기본값 생성
            console.log('No settings found, creating default...');
            await createDefaultSettings();
            await loadSettings();
            return;
        } else {
            throw new Error('Failed to load settings');
        }
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('settingsContent').style.display = 'block';
        
    } catch (error) {
        console.error('Failed to load settings:', error);
        document.getElementById('loading').style.display = 'none';
        alert('설정을 불러오는데 실패했습니다.');
    }
}

// 기본 설정 생성
async function createDefaultSettings() {
    try {
        const result = await supabaseAPI.post('site_settings', {
                id: 'default',
                bank_name: '국민은행',
                account_number: '123-456-789012',
                account_holder: '김민서',
                email: 'info@iontoefl.com',
                kakao_link: 'https://business.kakao.com/_FWxcZC/chats',
                platform_url: 'https://study.iontoefl.com',
                platform_login_guide: '이메일로 발송된 비밀번호를 사용하세요',
                necessities_text: '',
                refund_warning: '',
                next_actions: '',
                communication_guide: '',
                usage_guide_url: 'usage-guide.html',
                updated_at: Date.now()
        });
        
        if (!result) {
            throw new Error('Failed to create default settings');
        }
        
        console.log('Default settings created');
    } catch (error) {
        console.error('Failed to create default settings:', error);
    }
}

// 설정 저장
async function saveSettings() {
    // 입력값 가져오기
    const bankName = document.getElementById('bankName').value.trim();
    const accountNumber = document.getElementById('accountNumber').value.trim();
    const accountHolder = document.getElementById('accountHolder').value.trim();
    const email = document.getElementById('email').value.trim();
    const kakaoLink = document.getElementById('kakaoLink').value.trim();
    const platformUrl = document.getElementById('platformUrl').value.trim();
    const platformLoginGuide = document.getElementById('platformLoginGuide').value.trim();
    const necessitiesText = document.getElementById('necessitiesText').value.trim();
    const refundWarning = document.getElementById('refundWarning').value.trim();
    const nextActions = document.getElementById('nextActions').value.trim();
    const communicationGuide = document.getElementById('communicationGuide').value.trim();
    const usageGuideUrl = document.getElementById('usageGuideUrl').value.trim();
    
    // 유효성 검사
    if (!bankName || !accountNumber || !accountHolder) {
        alert('입금 계좌 정보를 모두 입력해주세요.');
        return;
    }
    
    if (!kakaoLink) {
        alert('카카오톡 상담 링크를 입력해주세요.');
        return;
    }
    
    if (!platformUrl || !platformLoginGuide) {
        alert('플랫폼 접속 정보를 모두 입력해주세요.');
        return;
    }
    
    // 확인
    if (!confirm('설정을 저장하시겠습니까?')) {
        return;
    }
    
    try {
        const result = await supabaseAPI.put('site_settings', 'default', {
                id: 'default',
                bank_name: bankName,
                account_number: accountNumber,
                account_holder: accountHolder,
                email: email,
                kakao_link: kakaoLink,
                platform_url: platformUrl,
                platform_login_guide: platformLoginGuide,
                necessities_text: necessitiesText,
                refund_warning: refundWarning,
                next_actions: nextActions,
                communication_guide: communicationGuide,
                usage_guide_url: usageGuideUrl,
                updated_at: Date.now()
        });
        
        if (result) {
            alert('✅ 설정이 저장되었습니다!');
            await loadSettings();
        } else {
            throw new Error('Failed to save settings');
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 저장에 실패했습니다. 다시 시도해주세요.');
    }
}

// 설정 조회 함수 (다른 페이지에서 사용)
async function getSiteSettings() {
    try {
        const result = await supabaseAPI.getById('site_settings', 'default');
        if (result) {
            return result;
        }
        return null;
    } catch (error) {
        console.error('Failed to get site settings:', error);
        return null;
    }
}

// 탭 전환
function switchUsageTab(tabName) {
    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.usage-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottom = '3px solid transparent';
        btn.style.color = '#64748b';
    });
    
    // 모든 탭 콘텐츠 숨기기
    document.querySelectorAll('.usage-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // 선택된 탭 활성화
    const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
        selectedBtn.style.borderBottom = '3px solid #9480c5';
        selectedBtn.style.color = '#9480c5';
    }
    
    // 선택된 콘텐츠 표시
    const selectedContent = document.getElementById(`tab-${tabName}`);
    if (selectedContent) {
        selectedContent.style.display = 'block';
    }
}

// 기본 템플릿 불러오기
function loadUsageTemplate() {
    if (!confirm('기본 템플릿을 불러오시겠습니까?\n현재 입력된 내용은 덮어씌워집니다.')) {
        return;
    }
    
    // 필드에 채우기
    document.getElementById('necessitiesText').value = DEFAULT_NECESSITIES;
    document.getElementById('refundWarning').value = DEFAULT_REFUND;
    document.getElementById('nextActions').value = DEFAULT_NEXT_ACTIONS;
    document.getElementById('communicationGuide').value = DEFAULT_COMMUNICATION;
    
    alert('✅ 기본 템플릿이 입력되었습니다!');
}

// 상세 가이드 미리보기
function previewGuidePage() {
    const url = document.getElementById('usageGuideUrl').value.trim() || 'usage-guide.html';
    window.open(url, '_blank');
}

// 상세 가이드 편집
function openGuideEditor() {
    // 편집기 페이지로 이동
    window.location.href = 'admin-guide-editor.html';
}
