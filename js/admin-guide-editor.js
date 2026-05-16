// ===== 상세 가이드 편집기 (Quill.js WYSIWYG) =====

let quill = null;
let currentGuideId = null;
let lastSavedHtml = '';
let currentGuideType = 'challenge'; // URL 파라미터로 결정

// 가이드 타입별 설정
const GUIDE_TYPE_CONFIG = {
    challenge: { title: '📝 내벨업챌린지 가이드 편집기', label: '내벨업챌린지' },
    nevelupaustralia: { title: '내벨업챌린지 Australia 가이드 편집기', label: '내벨업챌린지 Australia', icon: 'https://flagcdn.com/24x18/au.png' },
    correction: { title: '📝 첨삭 가이드 편집기', label: '첨삭' }
};

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    // URL 파라미터에서 가이드 타입 결정
    const urlParams = new URLSearchParams(window.location.search);
    currentGuideType = urlParams.get('type') || 'challenge';
    
    // 에디터 타이틀 업데이트
    const config = GUIDE_TYPE_CONFIG[currentGuideType] || GUIDE_TYPE_CONFIG.challenge;
    const titleEl = document.getElementById('editorTitle');
    if (titleEl) {
        if (config.icon) {
            titleEl.innerHTML = '<img src="' + config.icon + '" alt="" style="vertical-align: middle; margin-right: 6px; border-radius: 2px;"> ' + config.title;
        } else {
            titleEl.textContent = config.title;
        }
    }
    document.title = config.title + ' - 이온토플';
    
    checkAdminAuth();
    initQuillEditor();
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

// ===== Quill 에디터 초기화 =====
function initQuillEditor() {
    quill = new Quill('#quillEditor', {
        theme: 'snow',
        placeholder: '여기에 내용을 입력하거나, 외부에서 서식이 있는 텍스트를 붙여넣기 하세요...',
        modules: {
            toolbar: [
                // 헤더
                [{ header: [1, 2, 3, false] }],
                // 기본 서식
                ['bold', 'italic', 'underline', 'strike'],
                // 색상
                [{ color: [] }, { background: [] }],
                // 리스트
                [{ list: 'ordered' }, { list: 'bullet' }],
                // 정렬
                [{ align: [] }],
                // 들여쓰기
                [{ indent: '-1' }, { indent: '+1' }],
                // 미디어
                ['link', 'image', 'video'],
                // 인용, 코드
                ['blockquote', 'code-block'],
                // 초기화
                ['clean']
            ]
        }
    });

    // 이미지 붙여넣기/삽입 시 base64 → Storage 자동 업로드
    quill.root.addEventListener('paste', () => {
        // paste 후 DOM 업데이트를 기다린 뒤 변환
        setTimeout(() => convertBase64Images(), 100);
    });

    // 툴바 이미지 버튼 커스텀 핸들러
    const toolbar = quill.getModule('toolbar');
    toolbar.addHandler('image', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                setSaveStatus('saving', '이미지 업로드 중...');
                const url = await uploadImageFile(file);
                const range = quill.getSelection(true);
                quill.insertEmbed(range.index, 'image', url);
                quill.setSelection(range.index + 1);
                setSaveStatus('saved', '이미지 업로드 완료');
                setTimeout(() => setSaveStatus('saved', '최종 저장됨'), 2000);
            } catch (e) {
                console.error('Image upload failed:', e);
                alert('❌ 이미지 업로드 실패: ' + e.message);
                setSaveStatus('error', '이미지 업로드 실패');
            }
        };
        input.click();
    });

    // 실시간 미리보기 업데이트
    quill.on('text-change', () => {
        updatePreview();
    });
}

// ===== 실시간 미리보기 =====
function updatePreview() {
    const html = quill.root.innerHTML;
    const previewContent = document.getElementById('previewContent');

    if (!html || html === '<p><br></p>') {
        previewContent.innerHTML = `
            <p style="text-align: center; color: #94a3b8; margin-top: 100px;">
                <i class="fas fa-info-circle" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
                내용을 입력하면 실시간으로 미리보기가 표시됩니다.
            </p>
        `;
        return;
    }

    previewContent.innerHTML = `<div class="ql-editor preview-rendered">${html}</div>`;
}

// ===== 가이드 불러오기 =====
async function loadGuide() {
    setSaveStatus('loading', '불러오는 중...');

    try {
        const result = await supabaseAPI.get('guide_content', { 
            limit: 1,
            filter: { 'guide_type': `eq.${currentGuideType}` }
        });

        if (result.data && result.data.length > 0) {
            const guide = result.data[0];
            currentGuideId = guide.id;

            // 새 포맷 (html) 또는 기존 포맷 (sections) 둘 다 호환
            if (guide.html) {
                quill.root.innerHTML = guide.html;
                lastSavedHtml = guide.html;
            } else if (guide.content && guide.content.sections) {
                // 기존 섹션 포맷 → HTML로 변환
                const html = convertSectionsToHtml(guide.content.sections);
                quill.root.innerHTML = html;
                lastSavedHtml = html;
            } else if (guide.sections) {
                const html = convertSectionsToHtml(guide.sections);
                quill.root.innerHTML = html;
                lastSavedHtml = html;
            }

            updatePreview();
            setSaveStatus('saved', '최종 저장됨');
        } else {
            setSaveStatus('', '');
        }
    } catch (error) {
        console.error('Failed to load guide:', error);
        setSaveStatus('error', '불러오기 실패');
    }
}

// 기존 섹션 포맷 → HTML 변환 (하위 호환)
function convertSectionsToHtml(sections) {
    if (!sections || sections.length === 0) return '';

    return sections.map(s => {
        let html = '';
        if (s.title) html += `<h2>${escapeHtml(s.title)}</h2>`;
        if (s.content) html += `<p>${escapeHtml(s.content).replace(/\n/g, '<br>')}</p>`;
        if (s.image) html += `<p><img src="${s.image}" alt="${escapeHtml(s.title || '')}"></p>`;
        if (s.video) html += `<p><iframe src="${s.video}" frameborder="0" allowfullscreen></iframe></p>`;
        return html;
    }).join('');
}

// ===== 이미지 업로드 헬퍼 =====
const STORAGE_BUCKET = 'guide-images';

// File 객체를 Storage에 업로드
async function uploadImageFile(file) {
    const ext = file.name.split('.').pop() || 'png';
    const path = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

    const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': file.type,
            'x-upsert': 'true'
        },
        body: file
    });

    if (!response.ok) {
        let errMsg = `Storage Error: ${response.status}`;
        try { const e = await response.json(); errMsg = e.message || e.error || errMsg; } catch(e) {}
        throw new Error(errMsg);
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

// 에디터 내 base64 이미지를 찾아서 Storage URL로 교체
async function convertBase64Images() {
    const imgs = quill.root.querySelectorAll('img[src^="data:"]');
    if (imgs.length === 0) return;

    setSaveStatus('saving', `이미지 변환 중... (0/${imgs.length})`);
    let converted = 0;

    for (const img of imgs) {
        try {
            const dataUri = img.src;
            const mimeMatch = dataUri.match(/data:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
            const ext = extMap[mime] || 'png';
            const path = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

            const publicUrl = await supabaseStorage.uploadBase64(STORAGE_BUCKET, path, dataUri);
            img.src = publicUrl;
            converted++;
            setSaveStatus('saving', `이미지 변환 중... (${converted}/${imgs.length})`);
        } catch (e) {
            console.error('Image convert failed:', e);
        }
    }

    if (converted > 0) {
        setSaveStatus('saved', `이미지 ${converted}개 변환 완료`);
        updatePreview();
        setTimeout(() => setSaveStatus('saved', '최종 저장됨'), 2000);
    }
}

// ===== 저장 =====
async function saveGuide() {
    // HTML 모드에서 저장 시 textarea 내용을 Quill에 반영
    if (isHtmlMode) {
        quill.root.innerHTML = document.getElementById('htmlSourceEditor').value;
    }

    // 저장 전 남아있는 base64 이미지 일괄 변환
    await convertBase64Images();

    const html = quill.root.innerHTML;

    if (!html || html === '<p><br></p>') {
        alert('⚠️ 내용을 입력해주세요.');
        return;
    }

    setSaveStatus('saving', '저장 중...');
    const userData = JSON.parse(localStorage.getItem('iontoefl_user'));

    try {
        const guideData = {
            html: html,
            content: { html: html },  // 호환성
            guide_type: currentGuideType,
            updated_at: Date.now(),
            updated_by: userData.email
        };

        let saveResult;
        if (currentGuideId) {
            saveResult = await supabaseAPI.put('guide_content', currentGuideId, guideData);
        } else {
            const checkResult = await supabaseAPI.get('guide_content', { 
                limit: 1,
                filter: { 'guide_type': `eq.${currentGuideType}` }
            });
            if (checkResult.data && checkResult.data.length > 0) {
                currentGuideId = checkResult.data[0].id;
                saveResult = await supabaseAPI.put('guide_content', currentGuideId, guideData);
            } else {
                saveResult = await supabaseAPI.post('guide_content', guideData);
                if (saveResult) currentGuideId = saveResult.id;
            }
        }

        if (!saveResult) throw new Error('저장 실패');

        // 버전 저장
        const versionData = {
            html: html,
            content: { html: html },
            guide_type: currentGuideType,
            created_at: Date.now(),
            created_by: userData.email
        };
        await supabaseAPI.post('guide_versions', versionData);

        lastSavedHtml = html;
        setSaveStatus('saved', '저장 완료!');
        setTimeout(() => setSaveStatus('saved', '최종 저장됨'), 2000);

    } catch (error) {
        console.error('Save error:', error);
        setSaveStatus('error', '저장 실패');
        alert('❌ 저장 중 오류가 발생했습니다.\n\n' + error.message);
    }
}

// ===== 전체 미리보기 =====
function previewFullPage() {
    const html = quill.root.innerHTML;
    localStorage.setItem('guide_preview_html_' + currentGuideType, html);
    window.open(`usage-guide.html?type=${currentGuideType}&preview=true`, '_blank');
}

// ===== 버전 관리 =====
async function showVersionHistory() {
    try {
        const result = await supabaseAPI.get('guide_versions', { 
            limit: 20, 
            sort: '-created_at',
            filter: { 'guide_type': `eq.${currentGuideType}` }
        });
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
                        <h4>${version.version_name || '저장 버전'}</h4>
                        <p>
                            <i class="fas fa-clock"></i> ${new Date(version.created_at).toLocaleString('ko-KR')}
                            <span style="margin-left: 12px;">
                                <i class="fas fa-user"></i> ${escapeHtml(version.created_by || '-')}
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

async function restoreVersion(versionId) {
    if (!confirm('이 버전으로 복원하시겠습니까?\n현재 작업 중인 내용은 사라집니다.')) return;

    try {
        const version = await supabaseAPI.getById('guide_versions', versionId);

        // 새 포맷 (html) 또는 기존 포맷 (sections) 호환
        let html = '';
        if (version.html) {
            html = version.html;
        } else if (version.content) {
            if (typeof version.content === 'string') {
                // 기존: JSON 문자열로 저장된 sections
                try {
                    const sections = JSON.parse(version.content);
                    html = convertSectionsToHtml(sections);
                } catch (e) {
                    html = version.content;
                }
            } else if (version.content.html) {
                html = version.content.html;
            } else if (version.content.sections) {
                html = convertSectionsToHtml(version.content.sections);
            }
        }

        quill.root.innerHTML = html;
        updatePreview();
        closeVersionModal();
        setSaveStatus('', '복원됨 - 저장 필요');

        alert('✅ 버전이 복원되었습니다.\n저장 버튼을 클릭하여 적용하세요.');

    } catch (error) {
        console.error('Failed to restore version:', error);
        alert('❌ 버전 복원 중 오류가 발생했습니다.');
    }
}

function closeVersionModal() {
    document.getElementById('versionModal').style.display = 'none';
}

// ===== 저장 상태 표시 =====
function setSaveStatus(type, text) {
    const el = document.getElementById('saveStatus');
    if (!el) return;

    const colors = {
        loading: '#3b82f6',
        saving: '#f59e0b',
        saved: '#22c55e',
        error: '#ef4444',
        '': '#94a3b8'
    };

    el.style.color = colors[type] || '#94a3b8';
    el.innerHTML = type === 'loading' || type === 'saving'
        ? `<i class="fas fa-spinner fa-spin"></i> ${text}`
        : text;
}

// ===== HTML 편집 모드 토글 =====
let isHtmlMode = false;

function toggleHtmlMode() {
    const quillWrapper = document.querySelector('.quill-wrapper');
    const htmlEditor = document.getElementById('htmlSourceEditor');
    const toggleBtn = document.getElementById('htmlToggleBtn');

    if (!isHtmlMode) {
        // WYSIWYG → HTML 모드
        htmlEditor.value = quill.root.innerHTML;
        quillWrapper.style.display = 'none';
        htmlEditor.style.display = 'block';
        toggleBtn.style.background = '#fef3c7';
        toggleBtn.style.borderColor = '#f59e0b';
        toggleBtn.style.color = '#92400e';
        toggleBtn.innerHTML = '<i class="fas fa-edit"></i> 편집 모드로 돌아가기';
        isHtmlMode = true;
    } else {
        // HTML 모드 → WYSIWYG
        quill.root.innerHTML = htmlEditor.value;
        quillWrapper.style.display = '';
        htmlEditor.style.display = 'none';
        toggleBtn.style.background = '';
        toggleBtn.style.borderColor = '';
        toggleBtn.style.color = '';
        toggleBtn.innerHTML = '<i class="fas fa-code"></i> HTML 모드';
        updatePreview();
        isHtmlMode = false;
    }
}

// ===== 뒤로가기 =====
function goBack() {
    const currentHtml = quill ? quill.root.innerHTML : '';
    if (currentHtml !== lastSavedHtml) {
        if (!confirm('저장하지 않은 변경사항이 있습니다.\n뒤로 가시겠습니까?')) return;
    }
    window.location.href = 'admin-settings.html';
}

// ===== 유틸리티 =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
