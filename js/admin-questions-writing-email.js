// ===== Writing Email 문제 등록 모듈 =====
const WE_TABLE = 'tr_writing_email';
const WE_PREFIX = 'email_set_';
const WE_BULLET_COUNT = 3;

let weExistingSets = [];
let weEditMode = false;
let weEditSetId = null;
let weNextNum = 1;
let weAllExpanded = false;

// ===== 세트 ID 헬퍼 =====
function getWeSetId() {
    return WE_PREFIX + String(weNextNum).padStart(4, '0');
}

// ===== 기존 세트 목록 로드 =====
async function loadWeExistingSets() {
    try {
        const res = await supabaseAPI.query(WE_TABLE, {
            'select': 'id',
            'order': 'id.asc',
            'limit': '500'
        });
        weExistingSets = res || [];

        if (weExistingSets.length > 0) {
            const lastId = weExistingSets[weExistingSets.length - 1].id;
            weNextNum = parseInt(lastId.replace(WE_PREFIX, '')) + 1;
        } else {
            weNextNum = 1;
        }

        renderWeSetList();
        if (!weEditMode) {
            document.getElementById('weSetId').textContent = getWeSetId();
        }
    } catch (e) {
        console.error('Email 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더 =====
function renderWeSetList() {
    const wrap = document.getElementById('weSetList');
    if (!wrap) return;

    if (weExistingSets.length === 0) {
        wrap.innerHTML = '<span style="font-size:12px; color:#94a3b8;">등록된 세트가 없습니다.</span>';
        return;
    }

    wrap.innerHTML = weExistingSets.map(s => {
        const isEditing = weEditMode && weEditSetId === s.id;
        return `<button onclick="editWeSet('${s.id}')" style="padding:3px 10px; border:1px solid ${isEditing ? '#3b82f6' : '#d1d5db'}; border-radius:6px; font-size:12px; cursor:pointer; background:${isEditing ? '#dbeafe' : 'white'}; color:#1e293b; font-weight:${isEditing ? '700' : '400'};">${s.id.replace(WE_PREFIX, '')}</button>`;
    }).join('');
}

// ===== 불릿 아코디언 초기화 =====
function initWeBullets() {
    const wrap = document.getElementById('weBulletAccordion');
    if (!wrap) return;

    let html = '';
    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        html += buildWeBulletAccordion(b);
    }
    wrap.innerHTML = html;

    // 불릿 1만 펼침
    const b1Body = document.getElementById('weBullet1Body');
    const b1Arrow = document.getElementById('weBullet1Arrow');
    if (b1Body) b1Body.classList.add('open');
    if (b1Arrow) b1Arrow.classList.add('open');
}

function buildWeBulletAccordion(b) {
    return `
    <div class="sr-q-item" id="weBullet${b}Item">
        <div class="sr-q-header" onclick="toggleWeBullet(${b})">
            <div>
                <span class="sr-q-header-title">불릿 ${b}</span>
                <span class="sr-q-header-sub" id="weBullet${b}Sub" style="font-size:11px; color:#64748b; margin-left:8px;"></span>
            </div>
            <span class="sr-q-header-arrow" id="weBullet${b}Arrow"><i class="fas fa-chevron-down"></i></span>
        </div>
        <div class="sr-q-body" id="weBullet${b}Body">
            <!-- 지시사항 미리보기 (읽기전용) -->
            <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:8px 12px; margin-bottom:10px;">
                <div style="font-size:11px; font-weight:600; color:#0369a1; margin-bottom:4px;">📌 지시사항 ${b} (STEP 1에서 입력)</div>
                <div id="weBullet${b}InstructionPreview" style="font-size:12px; color:#334155; font-style:italic;">-</div>
            </div>

            <div class="sr-q-field">
                <label>📋 채점 기준 (한국어) — must *</label>
                <textarea id="weBullet${b}Must" rows="2" placeholder="고객들한테서 구체적으로 어떤 문제를 관찰했는지 말해야 해요..." oninput="updateWeRegisterBtn()"></textarea>
            </div>
            <div class="sr-q-field">
                <label>📝 예시 문장 (영어) — sample *</label>
                <textarea id="weBullet${b}Sample" rows="2" placeholder="I've noticed that students often have trouble finding their textbooks..." oninput="updateWeRegisterBtn()"></textarea>
            </div>
            <div class="sr-q-field">
                <label>⭐ 만점 포인트 (한국어, 장문) — points *</label>
                <textarea id="weBullet${b}Points" rows="4" placeholder="내용을 3가지나 언급했어요&#10;- 'camera settings' + 'composition...'&#10;- 시간도 명시했어요...&#10;- 실습 부분을 강조했어요..." oninput="updateWeRegisterBtn()"></textarea>
            </div>
            <div class="sr-q-field">
                <label>💡 핵심 요약 (한국어) — key *</label>
                <input type="text" id="weBullet${b}Key" placeholder="구체적인 활동 3가지 + 시간 정보 = 생생한 묘사예요!" oninput="updateWeRegisterBtn()">
            </div>
        </div>
    </div>`;
}

// ===== 아코디언 토글 =====
function toggleWeBullet(num) {
    const body = document.getElementById(`weBullet${num}Body`);
    const arrow = document.getElementById(`weBullet${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}

function toggleAllWeBullets() {
    weAllExpanded = !weAllExpanded;
    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        const body = document.getElementById(`weBullet${b}Body`);
        const arrow = document.getElementById(`weBullet${b}Arrow`);
        if (!body) continue;
        if (weAllExpanded) { body.classList.add('open'); if (arrow) arrow.classList.add('open'); }
        else { body.classList.remove('open'); if (arrow) arrow.classList.remove('open'); }
    }
    const btn = document.getElementById('weToggleAllBtn');
    if (btn) btn.innerHTML = weAllExpanded
        ? '<i class="fas fa-compress-arrows-alt"></i> 전체 접기'
        : '<i class="fas fa-expand-arrows-alt"></i> 전체 펼치기';
}

// ===== 지시사항 → 불릿 미리보기 동기화 =====
function syncWeInstructionPreview(num) {
    const input = document.getElementById(`weInstruction${num}`);
    const preview = document.getElementById(`weBullet${num}InstructionPreview`);
    if (input && preview) {
        preview.textContent = input.value.trim() || '-';
    }
    // 불릿 접힌 상태 서브텍스트 업데이트
    const sub = document.getElementById(`weBullet${num}Sub`);
    if (sub) {
        const val = input?.value?.trim() || '';
        sub.textContent = val ? `— "${val.substring(0, 50)}${val.length > 50 ? '...' : ''}"` : '';
    }
}

// ===== 유틸 =====
function setWeVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

// ===== 등록 버튼 활성화 체크 =====
function updateWeRegisterBtn() {
    const btn = document.getElementById('weRegisterBtn');
    if (!btn) return;

    const fields = [
        'weScenario', 'weTask', 'weToRecipient', 'weSubject',
        'weInstruction1', 'weInstruction2', 'weInstruction3',
        'weSampleAnswer'
    ];

    // 불릿 필드
    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        fields.push(`weBullet${b}Must`, `weBullet${b}Sample`, `weBullet${b}Points`, `weBullet${b}Key`);
    }

    const allFilled = fields.every(id => {
        const el = document.getElementById(id);
        return el && el.value.trim() !== '';
    });

    btn.disabled = !allFilled;
    btn.style.opacity = allFilled ? '1' : '0.5';
}

// ===== 유효성 검증 =====
function validateWeForm() {
    const errors = [];
    if (!document.getElementById('weScenario')?.value?.trim()) errors.push('시나리오를 입력해주세요');
    if (!document.getElementById('weTask')?.value?.trim()) errors.push('과제 지시문을 입력해주세요');
    if (!document.getElementById('weToRecipient')?.value?.trim()) errors.push('수신자를 입력해주세요');
    if (!document.getElementById('weSubject')?.value?.trim()) errors.push('이메일 제목을 입력해주세요');

    for (let i = 1; i <= 3; i++) {
        if (!document.getElementById(`weInstruction${i}`)?.value?.trim()) errors.push(`지시사항 ${i}을 입력해주세요`);
    }

    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        if (!document.getElementById(`weBullet${b}Must`)?.value?.trim()) errors.push(`불릿 ${b} 채점 기준을 입력해주세요`);
        if (!document.getElementById(`weBullet${b}Sample`)?.value?.trim()) errors.push(`불릿 ${b} 예시 문장을 입력해주세요`);
        if (!document.getElementById(`weBullet${b}Points`)?.value?.trim()) errors.push(`불릿 ${b} 만점 포인트를 입력해주세요`);
        if (!document.getElementById(`weBullet${b}Key`)?.value?.trim()) errors.push(`불릿 ${b} 핵심 요약을 입력해주세요`);
    }

    if (!document.getElementById('weSampleAnswer')?.value?.trim()) errors.push('영어 모범답안을 입력해주세요');

    // 신규 등록 시 중복 체크
    if (!weEditMode) {
        const setId = getWeSetId();
        if (weExistingSets.some(s => s.id === setId)) {
            errors.push(`이미 존재하는 세트입니다: ${setId}`);
        }
    }

    return errors;
}

// ===== payload 빌드 =====
function buildWePayload() {
    const setId = weEditMode ? weEditSetId : getWeSetId();
    const data = {
        id: setId,
        scenario: document.getElementById('weScenario')?.value?.trim() || '',
        task: document.getElementById('weTask')?.value?.trim() || '',
        to_recipient: document.getElementById('weToRecipient')?.value?.trim() || '',
        subject: document.getElementById('weSubject')?.value?.trim() || '',
        instruction1: document.getElementById('weInstruction1')?.value?.trim() || '',
        instruction2: document.getElementById('weInstruction2')?.value?.trim() || '',
        instruction3: document.getElementById('weInstruction3')?.value?.trim() || '',
        sample_answer: document.getElementById('weSampleAnswer')?.value?.trim() || ''
    };

    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        data[`bullet${b}_must`] = document.getElementById(`weBullet${b}Must`)?.value?.trim() || '';
        data[`bullet${b}_sample`] = document.getElementById(`weBullet${b}Sample`)?.value?.trim() || '';
        data[`bullet${b}_points`] = document.getElementById(`weBullet${b}Points`)?.value?.trim() || '';
        data[`bullet${b}_key`] = document.getElementById(`weBullet${b}Key`)?.value?.trim() || '';
    }

    return data;
}

// ===== 등록 (POST / PATCH) =====
async function registerWeSet() {
    const errors = validateWeForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('weRegisterBtn');
    const data = buildWePayload();
    const setId = data.id;

    if (weEditMode) {
        if (!confirm(`"${setId}" 세트를 수정하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            const patchData = { ...data };
            delete patchData.id;
            const url = `${SUPABASE_URL}/rest/v1/${WE_TABLE}?id=eq.${setId}`;
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(patchData)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `수정 실패: ${res.status}`); }
            const updated = await res.json();
            if (updated.length === 0) throw new Error('수정된 행이 없습니다. RLS 정책을 확인해주세요.');

            alert(`✅ "${setId}" 수정 완료!`);
            cancelWeEdit();
            await loadWeExistingSets();
        } catch (e) {
            alert('❌ 수정 실패: ' + (e.message || e));
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        }
    } else {
        if (!confirm(`"${setId}" 세트를 등록하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 등록 중...';
        try {
            const url = `${SUPABASE_URL}/rest/v1/${WE_TABLE}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(data)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `등록 실패: ${res.status}`); }

            alert(`✅ "${setId}" 등록 완료!`);
            clearWeForm();
            await loadWeExistingSets();
        } catch (e) {
            alert('❌ 등록 실패: ' + (e.message || e));
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        }
    }
}

// ===== 수정 모드 진입 =====
async function editWeSet(setId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${WE_TABLE}?id=eq.${setId}&select=*`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const rows = await res.json();
        if (!rows || rows.length === 0) { alert('데이터를 찾을 수 없습니다.'); return; }
        const row = rows[0];

        weEditMode = true;
        weEditSetId = setId;

        document.getElementById('weSetId').textContent = setId;
        document.getElementById('weEditModeLabel').style.display = 'inline';
        document.getElementById('weCancelEditBtn').style.display = 'inline-block';
        document.getElementById('weDeleteBtn').style.display = 'inline-block';
        document.getElementById('weRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정';

        // 필드 채우기
        setWeVal('weScenario', row.scenario);
        setWeVal('weTask', row.task);
        setWeVal('weToRecipient', row.to_recipient);
        setWeVal('weSubject', row.subject);
        setWeVal('weInstruction1', row.instruction1);
        setWeVal('weInstruction2', row.instruction2);
        setWeVal('weInstruction3', row.instruction3);
        setWeVal('weSampleAnswer', row.sample_answer);

        for (let b = 1; b <= WE_BULLET_COUNT; b++) {
            setWeVal(`weBullet${b}Must`, row[`bullet${b}_must`]);
            setWeVal(`weBullet${b}Sample`, row[`bullet${b}_sample`]);
            setWeVal(`weBullet${b}Points`, row[`bullet${b}_points`]);
            setWeVal(`weBullet${b}Key`, row[`bullet${b}_key`]);
        }

        // 지시사항 미리보기 동기화
        for (let i = 1; i <= 3; i++) {
            syncWeInstructionPreview(i);
        }

        renderWeSetList();
        updateWeRegisterBtn();

        // 맨 위로 스크롤
        document.getElementById('section-writing-email')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Email 세트 로드 실패:', e);
        alert('❌ 데이터 로드 실패: ' + (e.message || e));
    }
}

// ===== 수정 모드 취소 =====
function cancelWeEdit() {
    weEditMode = false;
    weEditSetId = null;

    document.getElementById('weSetId').textContent = getWeSetId();
    document.getElementById('weEditModeLabel').style.display = 'none';
    document.getElementById('weCancelEditBtn').style.display = 'none';
    document.getElementById('weDeleteBtn').style.display = 'none';
    document.getElementById('weRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    clearWeForm();
    renderWeSetList();
}

// ===== 폼 초기화 =====
function clearWeForm() {
    const fields = [
        'weScenario', 'weTask', 'weToRecipient', 'weSubject',
        'weInstruction1', 'weInstruction2', 'weInstruction3',
        'weSampleAnswer'
    ];
    fields.forEach(id => setWeVal(id, ''));

    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        setWeVal(`weBullet${b}Must`, '');
        setWeVal(`weBullet${b}Sample`, '');
        setWeVal(`weBullet${b}Points`, '');
        setWeVal(`weBullet${b}Key`, '');
    }

    // 지시사항 미리보기 초기화
    for (let i = 1; i <= 3; i++) {
        syncWeInstructionPreview(i);
    }

    updateWeRegisterBtn();
}

// ===== 삭제 =====
async function deleteWeSet() {
    if (!weEditMode || !weEditSetId) return;
    if (!confirm(`⚠️ "${weEditSetId}" 세트를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        // 메인 테이블 삭제
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${WE_TABLE}?id=eq.${weEditSetId}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        if (!res.ok) throw new Error(`삭제 실패: ${res.status}`);

        alert(`✅ "${weEditSetId}" 삭제 완료!`);
        cancelWeEdit();
        await loadWeExistingSets();
    } catch (e) {
        console.error('Email 삭제 실패:', e);
        alert('❌ 삭제 실패: ' + (e.message || e));
    }
}

// ===== JSON 붙여넣기 기능 =====
function openWeJsonModal() {
    document.getElementById('weJsonModal').style.display = 'flex';
    document.getElementById('weJsonInput').value = '';
    document.getElementById('weJsonError').style.display = 'none';
}

function closeWeJsonModal() {
    document.getElementById('weJsonModal').style.display = 'none';
    document.getElementById('weJsonInput').value = '';
    document.getElementById('weJsonError').style.display = 'none';
}

function applyWeJson() {
    const raw = document.getElementById('weJsonInput').value.trim();
    const errEl = document.getElementById('weJsonError');
    errEl.style.display = 'none';

    if (!raw) {
        errEl.textContent = '❌ JSON을 입력해주세요.';
        errEl.style.display = 'block';
        return;
    }

    // ```json ... ``` 코드블록 자동 제거
    let cleaned = raw;
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    let data;
    try {
        data = JSON.parse(cleaned);
    } catch (e) {
        errEl.textContent = '❌ JSON 형식이 올바르지 않습니다: ' + e.message;
        errEl.style.display = 'block';
        return;
    }

    // 배열인 경우 첫 번째 객체 사용
    if (Array.isArray(data)) {
        if (data.length === 0) {
            errEl.textContent = '❌ 빈 배열입니다.';
            errEl.style.display = 'block';
            return;
        }
        data = data[0];
    }

    if (typeof data !== 'object' || data === null) {
        errEl.textContent = '❌ JSON은 객체 { } 형식이어야 합니다.';
        errEl.style.display = 'block';
        return;
    }

    // === STEP 1 채우기 ===
    if (data.scenario) setWeVal('weScenario', data.scenario);
    if (data.task) setWeVal('weTask', data.task);
    if (data.to_recipient) setWeVal('weToRecipient', data.to_recipient);
    if (data.subject) setWeVal('weSubject', data.subject);
    if (data.instruction1) setWeVal('weInstruction1', data.instruction1);
    if (data.instruction2) setWeVal('weInstruction2', data.instruction2);
    if (data.instruction3) setWeVal('weInstruction3', data.instruction3);

    // 지시사항 미리보기 동기화
    for (let i = 1; i <= 3; i++) {
        syncWeInstructionPreview(i);
    }

    // === STEP 2 불릿 채우기 ===
    let filledBullets = 0;
    for (let b = 1; b <= WE_BULLET_COUNT; b++) {
        let filled = false;
        if (data[`bullet${b}_must`]) { setWeVal(`weBullet${b}Must`, data[`bullet${b}_must`]); filled = true; }
        if (data[`bullet${b}_sample`]) { setWeVal(`weBullet${b}Sample`, data[`bullet${b}_sample`]); filled = true; }
        if (data[`bullet${b}_points`]) { setWeVal(`weBullet${b}Points`, data[`bullet${b}_points`]); filled = true; }
        if (data[`bullet${b}_key`]) { setWeVal(`weBullet${b}Key`, data[`bullet${b}_key`]); filled = true; }
        if (filled) filledBullets++;
    }

    // === STEP 3 모범답안 채우기 ===
    if (data.sample_answer) setWeVal('weSampleAnswer', data.sample_answer);

    updateWeRegisterBtn();
    closeWeJsonModal();

    alert(`✅ 자동 채움 완료!\n\n` +
        `📄 시나리오: ${data.scenario ? '채움' : '없음'}\n` +
        `📝 과제: ${data.task ? '채움' : '없음'}\n` +
        `📌 지시사항: ${[data.instruction1, data.instruction2, data.instruction3].filter(Boolean).length}개\n` +
        `📋 불릿 해설: ${filledBullets}개\n` +
        `📧 모범답안: ${data.sample_answer ? '채움' : '없음'}\n\n` +
        `내용을 확인한 후 등록 버튼을 눌러주세요.`);
}

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', () => {
    initWeBullets();
});
