// Admin Guide Editor JavaScript
let sections = [];
let currentGuideId = 'current';

// 페이지 로드 시 실행
document.addEventListener('DOMContentLoaded', () => {
    // 관리자 권한 체크
    checkAdminAuth();
    
    // 기존 가이드 로드
    loadGuide();
});

// 관리자 권한 체크
function checkAdminAuth() {
    const userData = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    
    if (!userData || userData.role !== 'admin') {
        alert('⚠️ 관리자만 접근할 수 있습니다.');
        window.location.href = 'index.html';
    }
}

// 기존 가이드 로드
async function loadGuide() {
    try {
        const response = await fetch(`tables/guide_content?limit=1`);
        const result = await response.json();
        
        if (result.data && result.data.length > 0) {
            const guide = result.data[0];
            sections = guide.sections || [];
            currentGuideId = guide.id;
        } else {
            // 기본 섹션 추가
            sections = [{
                id: generateId(),
                title: '이용 방법 안내',
                content: '여기에 내용을 입력하세요.',
                image: '',
                video: ''
            }];
        }
        
        renderSections();
        updatePreview();
    } catch (error) {
        console.error('Failed to load guide:', error);
        // 에러 시 기본 섹션
        sections = [{
            id: generateId(),
            title: '이용 방법 안내',
            content: '여기에 내용을 입력하세요.',
            image: '',
            video: ''
        }];
        renderSections();
        updatePreview();
    }
}

// 섹션 렌더링
function renderSections() {
    const container = document.getElementById('sectionsContainer');
    
    if (sections.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>섹션이 없습니다.<br>"섹션 추가" 버튼을 클릭하여 시작하세요.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = sections.map((section, index) => `
        <div class="section-card" data-section-id="${section.id}">
            <div class="section-header">
                <span class="section-number">섹션 ${index + 1}</span>
                <div class="section-actions">
                    ${index > 0 ? `<button class="btn-icon-sm" onclick="moveSectionUp(${index})" title="위로 이동">
                        <i class="fas fa-arrow-up"></i>
                    </button>` : ''}
                    ${index < sections.length - 1 ? `<button class="btn-icon-sm" onclick="moveSectionDown(${index})" title="아래로 이동">
                        <i class="fas fa-arrow-down"></i>
                    </button>` : ''}
                    <button class="btn-icon-sm danger" onclick="removeSection(${index})" title="삭제">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            
            <div class="form-group">
                <label>📌 제목</label>
                <input type="text" 
                       value="${escapeHtml(section.title)}" 
                       oninput="updateSection(${index}, 'title', this.value)"
                       placeholder="섹션 제목을 입력하세요">
            </div>
            
            <div class="form-group">
                <label>📝 내용</label>
                <textarea oninput="updateSection(${index}, 'content', this.value)"
                          placeholder="내용을 입력하세요">${escapeHtml(section.content)}</textarea>
            </div>
            
            <div class="form-group">
                <label>🖼️ 이미지</label>
                <div class="image-upload-area" 
                     onclick="document.getElementById('imageInput-${index}').click()"
                     ondrop="handleDrop(event, ${index})"
                     ondragover="handleDragOver(event)"
                     ondragleave="handleDragLeave(event)">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>클릭하거나 이미지를 드래그하여 업로드</p>
                </div>
                <input type="file" 
                       id="imageInput-${index}" 
                       accept="image/*" 
                       style="display: none;"
                       onchange="handleImageUpload(event, ${index})">
                ${section.image ? `
                    <div class="image-preview">
                        <img src="${section.image}" alt="미리보기">
                        <button class="remove-image" onclick="removeImage(${index})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                ` : ''}
                <input type="text" 
                       value="${escapeHtml(section.image)}" 
                       oninput="updateSection(${index}, 'image', this.value)"
                       placeholder="또는 이미지 URL을 입력하세요"
                       style="margin-top: 8px;">
            </div>
            
            <div class="form-group">
                <label>🎬 영상 URL (YouTube, Vimeo 등)</label>
                <input type="text" 
                       value="${escapeHtml(section.video)}" 
                       oninput="updateSection(${index}, 'video', this.value)"
                       placeholder="https://www.youtube.com/embed/VIDEO_ID">
            </div>
        </div>
    `).join('');
}

// 섹션 추가
function addSection() {
    const newSection = {
        id: generateId(),
        title: '',
        content: '',
        image: '',
        video: ''
    };
    
    sections.push(newSection);
    renderSections();
    updatePreview();
    
    // 스크롤을 새로 추가된 섹션으로 이동
    setTimeout(() => {
        const container = document.getElementById('sectionsContainer');
        container.scrollTop = container.scrollHeight;
    }, 100);
}

// 섹션 업데이트
function updateSection(index, field, value) {
    sections[index][field] = value;
    updatePreview();
}

// 섹션 위로 이동
function moveSectionUp(index) {
    if (index === 0) return;
    
    [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
    renderSections();
    updatePreview();
}

// 섹션 아래로 이동
function moveSectionDown(index) {
    if (index === sections.length - 1) return;
    
    [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];
    renderSections();
    updatePreview();
}

// 섹션 삭제
function removeSection(index) {
    if (!confirm('이 섹션을 삭제하시겠습니까?')) return;
    
    sections.splice(index, 1);
    renderSections();
    updatePreview();
}

// 이미지 제거
function removeImage(index) {
    sections[index].image = '';
    renderSections();
    updatePreview();
}

// 이미지 업로드 처리
function handleImageUpload(event, index) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드할 수 있습니다.');
        return;
    }
    
    // 파일을 Base64로 변환
    const reader = new FileReader();
    reader.onload = function(e) {
        sections[index].image = e.target.result;
        renderSections();
        updatePreview();
    };
    reader.readAsDataURL(file);
}

// 드래그앤드롭 이벤트
function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('dragover');
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('dragover');
}

function handleDrop(event, index) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragover');
    
    const file = event.dataTransfer.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드할 수 있습니다.');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        sections[index].image = e.target.result;
        renderSections();
        updatePreview();
    };
    reader.readAsDataURL(file);
}

// 실시간 미리보기 업데이트
function updatePreview() {
    const previewContainer = document.getElementById('previewContainer');
    
    if (sections.length === 0) {
        previewContainer.innerHTML = `
            <div class="preview-content">
                <p style="text-align: center; color: #94a3b8; margin-top: 100px;">
                    <i class="fas fa-info-circle" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
                    섹션을 추가하고 내용을 입력하면<br>실시간으로 미리보기가 표시됩니다.
                </p>
            </div>
        `;
        return;
    }
    
    const previewHtml = `
        <div class="preview-content">
            ${sections.map((section, index) => `
                <div class="preview-section">
                    ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ''}
                    ${section.content ? `<p>${escapeHtml(section.content)}</p>` : ''}
                    ${section.image ? `<img src="${section.image}" alt="${escapeHtml(section.title)}">` : ''}
                    ${section.video ? `
                        <div class="video-container">
                            <iframe src="${section.video}" allowfullscreen></iframe>
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
    
    previewContainer.innerHTML = previewHtml;
}

// 전체 미리보기 (새 탭)
function previewFullPage() {
    // 임시로 localStorage에 저장
    localStorage.setItem('guide_preview', JSON.stringify(sections));
    window.open('usage-guide.html?preview=true', '_blank');
}

// 저장
async function saveGuide() {
    if (sections.length === 0) {
        alert('⚠️ 최소 1개 이상의 섹션을 추가해주세요.');
        return;
    }
    
    // 제목이 비어있는 섹션 체크
    const emptySections = sections.filter(s => !s.title.trim());
    if (emptySections.length > 0) {
        if (!confirm('제목이 비어있는 섹션이 있습니다.\n그래도 저장하시겠습니까?')) {
            return;
        }
    }
    
    const userData = JSON.parse(localStorage.getItem('iontoefl_user'));
    const now = new Date().toISOString();
    
    try {
        // 1. 기존 가이드 체크
        const checkResponse = await fetch('tables/guide_content?limit=1');
        const checkResult = await checkResponse.json();
        
        const guideData = {
            sections: sections,
            updated_at: now,
            updated_by: userData.email
        };
        
        let saveResponse;
        if (checkResult.data && checkResult.data.length > 0) {
            // 업데이트
            const existingId = checkResult.data[0].id;
            saveResponse = await fetch(`tables/guide_content/${existingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(guideData)
            });
        } else {
            // 새로 생성
            guideData.id = 'current';
            saveResponse = await fetch('tables/guide_content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(guideData)
            });
        }
        
        if (!saveResponse.ok) throw new Error('Failed to save guide');
        
        // 2. 버전 저장
        const versionData = {
            content: JSON.stringify(sections),
            created_at: now,
            created_by: userData.email,
            version_name: `버전 ${new Date().toLocaleString('ko-KR')}`
        };
        
        const versionResponse = await fetch('tables/guide_versions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(versionData)
        });
        
        if (!versionResponse.ok) throw new Error('Failed to save version');
        
        alert('✅ 저장되었습니다!');
        
    } catch (error) {
        console.error('Save error:', error);
        alert('❌ 저장 중 오류가 발생했습니다.\n\n' + error.message);
    }
}

// 버전 관리 모달
async function showVersionHistory() {
    try {
        const response = await fetch('tables/guide_versions?limit=20&sort=-created_at');
        const result = await response.json();
        
        const versionList = document.getElementById('versionList');
        
        if (!result.data || result.data.length === 0) {
            versionList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <p>저장된 버전이 없습니다.</p>
                </div>
            `;
        } else {
            versionList.innerHTML = result.data.map(version => `
                <div class="version-item">
                    <div class="version-info">
                        <h4>${escapeHtml(version.version_name || '버전')}</h4>
                        <p>
                            <i class="fas fa-clock"></i> ${new Date(version.created_at).toLocaleString('ko-KR')}
                            <span style="margin-left: 12px;">
                                <i class="fas fa-user"></i> ${escapeHtml(version.created_by)}
                            </span>
                        </p>
                    </div>
                    <div class="version-actions">
                        <button class="btn-outline btn-sm" onclick="restoreVersion('${version.id}')">
                            <i class="fas fa-undo"></i> 복원
                        </button>
                    </div>
                </div>
            `).join('');
        }
        
        document.getElementById('versionModal').style.display = 'flex';
        
    } catch (error) {
        console.error('Failed to load versions:', error);
        alert('❌ 버전 목록을 불러오는 중 오류가 발생했습니다.');
    }
}

// 버전 복원
async function restoreVersion(versionId) {
    if (!confirm('이 버전으로 복원하시겠습니까?\n현재 작업 중인 내용은 사라집니다.')) {
        return;
    }
    
    try {
        const response = await fetch(`tables/guide_versions/${versionId}`);
        const version = await response.json();
        
        sections = JSON.parse(version.content);
        renderSections();
        updatePreview();
        closeVersionModal();
        
        alert('✅ 버전이 복원되었습니다.\n저장 버튼을 클릭하여 적용하세요.');
        
    } catch (error) {
        console.error('Failed to restore version:', error);
        alert('❌ 버전 복원 중 오류가 발생했습니다.');
    }
}

// 버전 모달 닫기
function closeVersionModal() {
    document.getElementById('versionModal').style.display = 'none';
}

// 뒤로가기
function goBack() {
    if (confirm('저장하지 않은 내용은 사라집니다.\n뒤로 가시겠습니까?')) {
        window.location.href = 'admin-settings.html';
    }
}

// 유틸리티 함수
function generateId() {
    return 'section-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
