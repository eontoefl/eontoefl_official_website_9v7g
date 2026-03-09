// ===== Writing Discussion 문제 등록 모듈 =====
const WD_TABLE = 'tr_writing_discussion';
const WD_PREFIX = 'discussion_set_';
const WD_MAX_BULLETS = 5;

let wdExistingSets = [];
let wdEditMode = false;
let wdEditSetId = null;
let wdNextNum = 1;
let wdAllExpanded = false;
let wdBulletCount = 1; // 현재 표시된 불릿 수

// ===== 세트 ID 헬퍼 =====
function getWdSetId() {
    return WD_PREFIX + String(wdNextNum).padStart(4, '0');
}

// ===== 기존 세트 목록 로드 =====
async function loadWdExistingSets() {
    try {
        const res = await supabaseAPI.query(WD_TABLE, {
            'select': 'id',
            'order': 'id.asc',
            'limit': '500'
        });
        wdExistingSets = res || [];

        if (wdExistingSets.length > 0) {
            const lastId = wdExistingSets[wdExistingSets.length - 1].id;
            wdNextNum = parseInt(lastId.replace(WD_PREFIX, '')) + 1;
        } else {
            wdNextNum = 1;
        }

        renderWdSetList();
        if (!wdEditMode) {
            document.getElementById('wdSetId').textContent = getWdSetId();
        }
    } catch (e) {
        console.error('Discussion 세트 로드 실패:', e);
    }
}

// ===== 세트 목록 렌더 =====
function renderWdSetList() {
    const wrap = document.getElementById('wdSetList');
    if (!wrap) return;

    if (wdExistingSets.length === 0) {
        wrap.innerHTML = '<span style="font-size:12px; color:#94a3b8;">등록된 세트가 없습니다.</span>';
        return;
    }

    wrap.innerHTML = wdExistingSets.map(s => {
        const isEditing = wdEditMode && wdEditSetId === s.id;
        return `<button onclick="editWdSet('${s.id}')" style="padding:3px 10px; border:1px solid ${isEditing ? '#3b82f6' : '#d1d5db'}; border-radius:6px; font-size:12px; cursor:pointer; background:${isEditing ? '#dbeafe' : 'white'}; color:#1e293b; font-weight:${isEditing ? '700' : '400'};">${s.id.replace(WD_PREFIX, '')}</button>`;
    }).join('');
}

// ===== 불릿 아코디언 빌드 =====
function buildWdBulletAccordion(b) {
    const isRequired = b === 1;
    const deleteBtn = !isRequired ? `<button onclick="removeWdBullet(${b})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:14px; padding:2px 6px;" title="불릿 ${b} 삭제"><i class="fas fa-times"></i></button>` : '';

    return `
    <div class="sr-q-item" id="wdBullet${b}Item">
        <div class="sr-q-header" onclick="toggleWdBullet(${b})">
            <div>
                <span class="sr-q-header-title">문장 ${b} ${isRequired ? '(필수)' : '(선택)'}</span>
                <span class="sr-q-header-sub" id="wdBullet${b}Sub" style="font-size:11px; color:#64748b; margin-left:8px;"></span>
            </div>
            <div style="display:flex; align-items:center; gap:4px;">
                ${deleteBtn}
                <span class="sr-q-header-arrow" id="wdBullet${b}Arrow"><i class="fas fa-chevron-down"></i></span>
            </div>
        </div>
        <div class="sr-q-body" id="wdBullet${b}Body">
            <div class="sr-q-field">
                <label>📝 핵심 문장 (영어, 1~2문장) — sentence ${isRequired ? '*' : ''}</label>
                <textarea id="wdBullet${b}Sentence" rows="2" placeholder="I believe participation should remain voluntary, and I agree with {name1} that..." oninput="updateWdRegisterBtn(); updateWdBulletSub(${b})"></textarea>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">ℹ️ {name1}, {name2} 사용 가능</div>
            </div>
            <div class="sr-q-field">
                <label>✅ ETS 필수 요소 해설 (한국어, 장문) — ets ${isRequired ? '*' : ''}</label>
                <textarea id="wdBullet${b}Ets" rows="5" placeholder="ETS는 'clearly state your viewpoint on the professor's question'이라고 명시하고 있어요..." oninput="updateWdRegisterBtn()"></textarea>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">ℹ️ {name1}, {name2} 사용 가능</div>
            </div>
            <div class="sr-q-field">
                <label>🎯 효과적인 작성 전략 (한국어, 장문) — strategy ${isRequired ? '*' : ''}</label>
                <textarea id="wdBullet${b}Strategy" rows="5" placeholder="이 문장은 '입장 표명'과 '다른 학생 동의'를 하나의 문장으로 효율적으로 결합했어요..." oninput="updateWdRegisterBtn()"></textarea>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">ℹ️ {name1}, {name2} 사용 가능</div>
            </div>
        </div>
    </div>`;
}

// ===== 불릿 초기화 (신규) =====
function initWdBullets(count) {
    count = count || 1;
    wdBulletCount = count;
    renderWdBullets();
}

// ===== 불릿 렌더링 =====
function renderWdBullets() {
    const wrap = document.getElementById('wdBulletAccordion');
    if (!wrap) return;

    let html = '';
    for (let b = 1; b <= wdBulletCount; b++) {
        html += buildWdBulletAccordion(b);
    }
    wrap.innerHTML = html;

    // 불릿 1만 펼침
    const b1Body = document.getElementById('wdBullet1Body');
    const b1Arrow = document.getElementById('wdBullet1Arrow');
    if (b1Body) b1Body.classList.add('open');
    if (b1Arrow) b1Arrow.classList.add('open');

    updateWdAddBulletBtn();
    updateWdBulletInfo();
}

// ===== 불릿 추가 =====
function addWdBullet() {
    if (wdBulletCount >= WD_MAX_BULLETS) return;

    // 기존 불릿 데이터 임시 저장
    const saved = saveWdBulletData();
    wdBulletCount++;
    renderWdBullets();
    restoreWdBulletData(saved);

    // 새로 추가된 불릿 펼치기
    const newBody = document.getElementById(`wdBullet${wdBulletCount}Body`);
    const newArrow = document.getElementById(`wdBullet${wdBulletCount}Arrow`);
    if (newBody) newBody.classList.add('open');
    if (newArrow) newArrow.classList.add('open');

    updateWdRegisterBtn();
}

// ===== 불릿 제거 =====
function removeWdBullet(num) {
    if (num === 1 || wdBulletCount <= 1) return;

    const sentence = document.getElementById(`wdBullet${num}Sentence`)?.value?.trim() || '';
    if (sentence && !confirm(`문장 ${num}의 내용이 삭제됩니다. 계속하시겠습니까?`)) return;

    // 기존 데이터 저장 (삭제할 불릿 제외)
    const saved = [];
    let idx = 0;
    for (let b = 1; b <= wdBulletCount; b++) {
        if (b === num) continue;
        saved[idx] = {
            sentence: document.getElementById(`wdBullet${b}Sentence`)?.value || '',
            ets: document.getElementById(`wdBullet${b}Ets`)?.value || '',
            strategy: document.getElementById(`wdBullet${b}Strategy`)?.value || ''
        };
        idx++;
    }

    wdBulletCount--;
    renderWdBullets();

    // 데이터 복원
    for (let i = 0; i < saved.length; i++) {
        const b = i + 1;
        setWdVal(`wdBullet${b}Sentence`, saved[i].sentence);
        setWdVal(`wdBullet${b}Ets`, saved[i].ets);
        setWdVal(`wdBullet${b}Strategy`, saved[i].strategy);
        updateWdBulletSub(b);
    }

    updateWdRegisterBtn();
}

// ===== 불릿 데이터 임시 저장/복원 =====
function saveWdBulletData() {
    const data = [];
    for (let b = 1; b <= wdBulletCount; b++) {
        data.push({
            sentence: document.getElementById(`wdBullet${b}Sentence`)?.value || '',
            ets: document.getElementById(`wdBullet${b}Ets`)?.value || '',
            strategy: document.getElementById(`wdBullet${b}Strategy`)?.value || ''
        });
    }
    return data;
}

function restoreWdBulletData(data) {
    for (let i = 0; i < data.length; i++) {
        const b = i + 1;
        setWdVal(`wdBullet${b}Sentence`, data[i].sentence);
        setWdVal(`wdBullet${b}Ets`, data[i].ets);
        setWdVal(`wdBullet${b}Strategy`, data[i].strategy);
        updateWdBulletSub(b);
    }
}

// ===== 불릿 추가 버튼 상태 =====
function updateWdAddBulletBtn() {
    const btn = document.getElementById('wdAddBulletBtn');
    if (!btn) return;
    if (wdBulletCount >= WD_MAX_BULLETS) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'inline-block';
    }
}

// ===== 불릿 안내 텍스트 =====
function updateWdBulletInfo() {
    const info = document.getElementById('wdBulletInfo');
    if (info) info.textContent = `현재 ${wdBulletCount}개 / 최대 ${WD_MAX_BULLETS}개`;
}

// ===== 아코디언 토글 =====
function toggleWdBullet(num) {
    const body = document.getElementById(`wdBullet${num}Body`);
    const arrow = document.getElementById(`wdBullet${num}Arrow`);
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
}

function toggleAllWdBullets() {
    wdAllExpanded = !wdAllExpanded;
    for (let b = 1; b <= wdBulletCount; b++) {
        const body = document.getElementById(`wdBullet${b}Body`);
        const arrow = document.getElementById(`wdBullet${b}Arrow`);
        if (!body) continue;
        if (wdAllExpanded) { body.classList.add('open'); if (arrow) arrow.classList.add('open'); }
        else { body.classList.remove('open'); if (arrow) arrow.classList.remove('open'); }
    }
    const btn = document.getElementById('wdToggleAllBtn');
    if (btn) btn.innerHTML = wdAllExpanded
        ? '<i class="fas fa-compress-arrows-alt"></i> 전체 접기'
        : '<i class="fas fa-expand-arrows-alt"></i> 전체 펼치기';
}

// ===== 불릿 접힌 서브텍스트 업데이트 =====
function updateWdBulletSub(num) {
    const input = document.getElementById(`wdBullet${num}Sentence`);
    const sub = document.getElementById(`wdBullet${num}Sub`);
    if (sub) {
        const val = input?.value?.trim() || '';
        sub.textContent = val ? `— "${val.substring(0, 50)}${val.length > 50 ? '...' : ''}"` : '';
    }
}

// ===== 유틸 =====
function setWdVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

// ===== 등록 버튼 활성화 체크 =====
function updateWdRegisterBtn() {
    const btn = document.getElementById('wdRegisterBtn');
    if (!btn) return;

    // 필수 필드
    const requiredFields = [
        'wdClassContext', 'wdTopic',
        'wdStudent1Opinion', 'wdStudent2Opinion',
        'wdSampleAnswer',
        'wdBullet1Sentence', 'wdBullet1Ets', 'wdBullet1Strategy'
    ];

    const allFilled = requiredFields.every(id => {
        const el = document.getElementById(id);
        return el && el.value.trim() !== '';
    });

    // 선택 불릿: sentence가 있으면 ets와 strategy도 필요
    let optionalValid = true;
    for (let b = 2; b <= wdBulletCount; b++) {
        const sentence = document.getElementById(`wdBullet${b}Sentence`)?.value?.trim();
        if (sentence) {
            const ets = document.getElementById(`wdBullet${b}Ets`)?.value?.trim();
            const strategy = document.getElementById(`wdBullet${b}Strategy`)?.value?.trim();
            if (!ets || !strategy) { optionalValid = false; break; }
        }
    }

    const enabled = allFilled && optionalValid;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.5';
}

// ===== 유효성 검증 =====
function validateWdForm() {
    const errors = [];
    if (!document.getElementById('wdClassContext')?.value?.trim()) errors.push('수업 맥락을 입력해주세요');
    if (!document.getElementById('wdTopic')?.value?.trim()) errors.push('토론 주제를 입력해주세요');
    if (!document.getElementById('wdStudent1Opinion')?.value?.trim()) errors.push('학생1 의견을 입력해주세요');
    if (!document.getElementById('wdStudent2Opinion')?.value?.trim()) errors.push('학생2 의견을 입력해주세요');
    if (!document.getElementById('wdSampleAnswer')?.value?.trim()) errors.push('모범답안을 입력해주세요');

    // 불릿 1 필수
    if (!document.getElementById('wdBullet1Sentence')?.value?.trim()) errors.push('문장 1 핵심 문장을 입력해주세요');
    if (!document.getElementById('wdBullet1Ets')?.value?.trim()) errors.push('문장 1 ETS 해설을 입력해주세요');
    if (!document.getElementById('wdBullet1Strategy')?.value?.trim()) errors.push('문장 1 작성 전략을 입력해주세요');

    // 불릿 2~5: sentence가 있으면 ets, strategy 필수
    for (let b = 2; b <= wdBulletCount; b++) {
        const sentence = document.getElementById(`wdBullet${b}Sentence`)?.value?.trim();
        if (sentence) {
            if (!document.getElementById(`wdBullet${b}Ets`)?.value?.trim()) errors.push(`문장 ${b}: ETS 해설을 입력해주세요`);
            if (!document.getElementById(`wdBullet${b}Strategy`)?.value?.trim()) errors.push(`문장 ${b}: 작성 전략을 입력해주세요`);
        }
    }

    // 신규 등록 시 중복 체크
    if (!wdEditMode) {
        const setId = getWdSetId();
        if (wdExistingSets.some(s => s.id === setId)) {
            errors.push(`이미 존재하는 세트입니다: ${setId}`);
        }
    }

    return errors;
}

// ===== payload 빌드 =====
function buildWdPayload() {
    const setId = wdEditMode ? wdEditSetId : getWdSetId();
    const data = {
        id: setId,
        class_context: document.getElementById('wdClassContext')?.value?.trim() || '',
        topic: document.getElementById('wdTopic')?.value?.trim() || '',
        student1_opinion: document.getElementById('wdStudent1Opinion')?.value?.trim() || '',
        student2_opinion: document.getElementById('wdStudent2Opinion')?.value?.trim() || '',
        sample_answer: document.getElementById('wdSampleAnswer')?.value?.trim() || ''
    };

    for (let b = 1; b <= WD_MAX_BULLETS; b++) {
        if (b <= wdBulletCount) {
            data[`bullet${b}_sentence`] = document.getElementById(`wdBullet${b}Sentence`)?.value?.trim() || '';
            data[`bullet${b}_ets`] = document.getElementById(`wdBullet${b}Ets`)?.value?.trim() || '';
            data[`bullet${b}_strategy`] = document.getElementById(`wdBullet${b}Strategy`)?.value?.trim() || '';
        } else {
            data[`bullet${b}_sentence`] = '';
            data[`bullet${b}_ets`] = '';
            data[`bullet${b}_strategy`] = '';
        }
    }

    return data;
}

// ===== 등록 (POST / PATCH) =====
async function registerWdSet() {
    const errors = validateWdForm();
    if (errors.length > 0) {
        alert('❌ 입력 오류:\n\n' + errors.join('\n'));
        return;
    }

    const btn = document.getElementById('wdRegisterBtn');
    const data = buildWdPayload();
    const setId = data.id;

    if (wdEditMode) {
        if (!confirm(`"${setId}" 세트를 수정하시겠습니까?`)) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 수정 중...';
        try {
            const patchData = { ...data };
            delete patchData.id;
            const url = `${SUPABASE_URL}/rest/v1/${WD_TABLE}?id=eq.${setId}`;
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(patchData)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `수정 실패: ${res.status}`); }
            const updated = await res.json();
            if (updated.length === 0) throw new Error('수정된 행이 없습니다. RLS 정책을 확인해주세요.');

            alert(`✅ "${setId}" 수정 완료!`);
            cancelWdEdit();
            await loadWdExistingSets();
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
            const url = `${SUPABASE_URL}/rest/v1/${WD_TABLE}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify(data)
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.message || `등록 실패: ${res.status}`); }

            alert(`✅ "${setId}" 등록 완료!`);
            clearWdForm();
            await loadWdExistingSets();
        } catch (e) {
            alert('❌ 등록 실패: ' + (e.message || e));
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 등록';
        }
    }
}

// ===== 수정 모드 진입 =====
async function editWdSet(setId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${WD_TABLE}?id=eq.${setId}&select=*`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const rows = await res.json();
        if (!rows || rows.length === 0) { alert('데이터를 찾을 수 없습니다.'); return; }
        const row = rows[0];

        wdEditMode = true;
        wdEditSetId = setId;

        document.getElementById('wdSetId').textContent = setId;
        document.getElementById('wdEditModeLabel').style.display = 'inline';
        document.getElementById('wdCancelEditBtn').style.display = 'inline-block';
        document.getElementById('wdDeleteBtn').style.display = 'inline-block';
        document.getElementById('wdRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 수정';

        // 필드 채우기 — STEP 1 & 2
        setWdVal('wdClassContext', row.class_context);
        setWdVal('wdTopic', row.topic);
        setWdVal('wdStudent1Opinion', row.student1_opinion);
        setWdVal('wdStudent2Opinion', row.student2_opinion);
        setWdVal('wdSampleAnswer', row.sample_answer);

        // 불릿 개수 판별
        let bulletCount = 0;
        for (let i = 1; i <= WD_MAX_BULLETS; i++) {
            if (row[`bullet${i}_sentence`] && row[`bullet${i}_sentence`].trim()) {
                bulletCount = i;
            }
        }
        if (bulletCount < 1) bulletCount = 1;

        // 불릿 렌더 후 데이터 채우기
        initWdBullets(bulletCount);
        for (let b = 1; b <= bulletCount; b++) {
            setWdVal(`wdBullet${b}Sentence`, row[`bullet${b}_sentence`]);
            setWdVal(`wdBullet${b}Ets`, row[`bullet${b}_ets`]);
            setWdVal(`wdBullet${b}Strategy`, row[`bullet${b}_strategy`]);
            updateWdBulletSub(b);
        }

        renderWdSetList();
        updateWdRegisterBtn();

        document.getElementById('section-writing-discussion')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Discussion 세트 로드 실패:', e);
        alert('❌ 데이터 로드 실패: ' + (e.message || e));
    }
}

// ===== 수정 모드 취소 =====
function cancelWdEdit() {
    wdEditMode = false;
    wdEditSetId = null;

    document.getElementById('wdSetId').textContent = getWdSetId();
    document.getElementById('wdEditModeLabel').style.display = 'none';
    document.getElementById('wdCancelEditBtn').style.display = 'none';
    document.getElementById('wdDeleteBtn').style.display = 'none';
    document.getElementById('wdRegisterBtn').innerHTML = '<i class="fas fa-save"></i> 등록';

    clearWdForm();
    renderWdSetList();
}

// ===== 폼 초기화 =====
function clearWdForm() {
    setWdVal('wdClassContext', '');
    setWdVal('wdTopic', '');
    setWdVal('wdStudent1Opinion', '');
    setWdVal('wdStudent2Opinion', '');
    setWdVal('wdSampleAnswer', '');

    initWdBullets(1);
    updateWdRegisterBtn();
}

// ===== 삭제 =====
async function deleteWdSet() {
    if (!wdEditMode || !wdEditSetId) return;
    if (!confirm(`⚠️ "${wdEditSetId}" 세트를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${WD_TABLE}?id=eq.${wdEditSetId}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        if (!res.ok) throw new Error(`삭제 실패: ${res.status}`);

        alert(`✅ "${wdEditSetId}" 삭제 완료!`);
        cancelWdEdit();
        await loadWdExistingSets();
    } catch (e) {
        console.error('Discussion 삭제 실패:', e);
        alert('❌ 삭제 실패: ' + (e.message || e));
    }
}

// ===== JSON 붙여넣기 기능 =====
function openWdJsonModal() {
    document.getElementById('wdJsonModal').style.display = 'flex';
    document.getElementById('wdJsonInput').value = '';
    document.getElementById('wdJsonError').style.display = 'none';
}

function closeWdJsonModal() {
    document.getElementById('wdJsonModal').style.display = 'none';
    document.getElementById('wdJsonInput').value = '';
    document.getElementById('wdJsonError').style.display = 'none';
}

function applyWdJson() {
    const raw = document.getElementById('wdJsonInput').value.trim();
    const errEl = document.getElementById('wdJsonError');
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

    // === STEP 1 & 2 채우기 (있는 경우만) ===
    if (data.class_context) setWdVal('wdClassContext', data.class_context);
    if (data.topic) setWdVal('wdTopic', data.topic);
    if (data.student1_opinion) setWdVal('wdStudent1Opinion', data.student1_opinion);
    if (data.student2_opinion) setWdVal('wdStudent2Opinion', data.student2_opinion);

    // === STEP 4 모범답안 ===
    if (data.sample_answer) setWdVal('wdSampleAnswer', data.sample_answer);

    // === STEP 3 불릿 채우기 ===
    let filledBullets = 0;

    if (data.bullets && Array.isArray(data.bullets) && data.bullets.length > 0) {
        // JSON 형식: { bullets: [ { sentence, ets, strategy }, ... ] }
        const bulletArr = data.bullets.slice(0, WD_MAX_BULLETS);
        const needed = Math.max(bulletArr.length, 1);

        // 기존 STEP 1&2 데이터 보존을 위해 불릿만 재렌더
        const savedMain = {
            classContext: document.getElementById('wdClassContext')?.value || '',
            topic: document.getElementById('wdTopic')?.value || '',
            student1: document.getElementById('wdStudent1Opinion')?.value || '',
            student2: document.getElementById('wdStudent2Opinion')?.value || '',
            sampleAnswer: document.getElementById('wdSampleAnswer')?.value || ''
        };

        initWdBullets(needed);

        // 메인 필드 복원
        setWdVal('wdClassContext', savedMain.classContext);
        setWdVal('wdTopic', savedMain.topic);
        setWdVal('wdStudent1Opinion', savedMain.student1);
        setWdVal('wdStudent2Opinion', savedMain.student2);
        setWdVal('wdSampleAnswer', savedMain.sampleAnswer);

        for (let i = 0; i < bulletArr.length; i++) {
            const b = i + 1;
            const item = bulletArr[i];
            if (item.sentence) { setWdVal(`wdBullet${b}Sentence`, item.sentence); filledBullets++; }
            if (item.ets) setWdVal(`wdBullet${b}Ets`, item.ets);
            if (item.strategy) setWdVal(`wdBullet${b}Strategy`, item.strategy);
            updateWdBulletSub(b);
        }
    } else {
        // DB 컬럼 형식 fallback: { bullet1_sentence, bullet1_ets, ... }
        let maxBullet = 0;
        for (let b = 1; b <= WD_MAX_BULLETS; b++) {
            if (data[`bullet${b}_sentence`]) maxBullet = b;
        }

        if (maxBullet > 0) {
            const savedMain = {
                classContext: document.getElementById('wdClassContext')?.value || '',
                topic: document.getElementById('wdTopic')?.value || '',
                student1: document.getElementById('wdStudent1Opinion')?.value || '',
                student2: document.getElementById('wdStudent2Opinion')?.value || '',
                sampleAnswer: document.getElementById('wdSampleAnswer')?.value || ''
            };

            initWdBullets(maxBullet);

            setWdVal('wdClassContext', savedMain.classContext);
            setWdVal('wdTopic', savedMain.topic);
            setWdVal('wdStudent1Opinion', savedMain.student1);
            setWdVal('wdStudent2Opinion', savedMain.student2);
            setWdVal('wdSampleAnswer', savedMain.sampleAnswer);

            for (let b = 1; b <= maxBullet; b++) {
                if (data[`bullet${b}_sentence`]) { setWdVal(`wdBullet${b}Sentence`, data[`bullet${b}_sentence`]); filledBullets++; }
                if (data[`bullet${b}_ets`]) setWdVal(`wdBullet${b}Ets`, data[`bullet${b}_ets`]);
                if (data[`bullet${b}_strategy`]) setWdVal(`wdBullet${b}Strategy`, data[`bullet${b}_strategy`]);
                updateWdBulletSub(b);
            }
        }
    }

    updateWdRegisterBtn();
    closeWdJsonModal();

    alert(`✅ 자동 채움 완료!\n\n` +
        `📋 수업 맥락: ${data.class_context ? '채움' : '없음 (수동 입력 필요)'}\n` +
        `📝 토론 주제: ${data.topic ? '채움' : '없음 (수동 입력 필요)'}\n` +
        `🗣️ 학생 의견: ${[data.student1_opinion, data.student2_opinion].filter(Boolean).length}개\n` +
        `📄 문장 해설: ${filledBullets}개\n` +
        `📧 모범답안: ${data.sample_answer ? '채움' : '없음'}\n\n` +
        `내용을 확인한 후 등록 버튼을 눌러주세요.`);
}

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', () => {
    initWdBullets(1);
});
