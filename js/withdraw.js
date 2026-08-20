// =====================================================================
// 회원탈퇴 페이지 로직
//   - 진입 가드: 로그인 확인 → 관리자 차단 → 진행 중 학생 차단(fail-safe)
//   - 제출: 사유/체크/비밀번호 검증(백도어 불인정) → withdrawal_requested_at patch
//   - 실제 파기는 프론트가 아니라 서버 pg_cron(process_member_withdrawals)이 7일 후 수행
// =====================================================================

// 진행 중으로 간주해 탈퇴를 막는 상태 키
const BLOCKING_LIVE_KEYS = ['completed', 'refunded', 'dropped']; // 이 상태여야 "통과"
const BLOCKING_CORRECTION_KEYS = ['pending', 'waiting', 'active', 'ext_waiting', 'ext_active'];

let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1) 로그인 확인
    currentUser = JSON.parse(localStorage.getItem('iontoefl_user') || 'null');
    if (!currentUser) {
        alert('로그인이 필요합니다.');
        window.location.href = 'login.html?redirect=withdraw.html';
        return;
    }

    // 2) 관리자 차단
    if (currentUser.role === 'admin') {
        alert('관리자 계정은 탈퇴할 수 없습니다.');
        window.location.href = 'index.html';
        return;
    }

    // 3) 진행 중 차단 판정 (조회 실패 시에도 차단 = fail-safe)
    const blocked = await isBlockedFromWithdrawal(currentUser);

    document.getElementById('loadingState').style.display = 'none';
    if (blocked) {
        document.getElementById('blockedState').style.display = 'block';
    } else {
        document.getElementById('withdrawMain').style.display = 'block';
        setupForm();
    }
});

// 진행 중인 수강·첨삭·첨삭연장 정산이 있으면 true (판정 불가도 true)
async function isBlockedFromWithdrawal(user) {
    try {
        const apps = await supabaseAPI.query('applications', {
            'email': `eq.${user.email}`,
            'deleted': 'neq.true',
            'withdrawn_at': 'is.null',
            'limit': '100'
        });

        for (const app of (apps || [])) {
            // (a) 입금확인 완료인데 수강이 종료/환불/중도포기 상태가 아님 (null=세팅 중 포함)
            const live = getAppLiveStatus(app);
            if (app.deposit_confirmed_by_admin === true &&
                (!live || !BLOCKING_LIVE_KEYS.includes(live.key))) {
                return true;
            }
            // (b) 첨삭 진행/대기 중
            const corr = getCorrectionStatus(app);
            if (corr && BLOCKING_CORRECTION_KEYS.includes(corr.key)) {
                return true;
            }
        }

        // (c) 첨삭연장 입금대기(pending)
        const ext = await supabaseAPI.query('correction_extension_requests', {
            'user_id': `eq.${user.id}`,
            'status': 'eq.pending',
            'limit': '1'
        });
        if (ext && ext.length > 0) return true;

        return false;
    } catch (e) {
        console.error('탈퇴 차단 판정 조회 실패 → 안전하게 차단:', e);
        return true; // fail-safe: 판정 불가 상태에서 탈퇴 진행 금지
    }
}

function setupForm() {
    const reasonSelect = document.getElementById('withdrawReason');
    const detail = document.getElementById('withdrawReasonDetail');

    // 불만족/기타 선택 시 placeholder 교체
    reasonSelect.addEventListener('change', () => {
        if (reasonSelect.value === '서비스가 불만족스러워요' || reasonSelect.value === '기타') {
            detail.placeholder = '어떤 점이 아쉬웠는지 알려주시면 개선에 큰 도움이 됩니다 (선택)';
        } else {
            detail.placeholder = '남기고 싶은 말씀이 있다면 적어주세요 (선택)';
        }
    });

    // 입력 포커스 스타일
    document.querySelectorAll('#withdrawMain input, #withdrawMain select, #withdrawMain textarea').forEach(el => {
        el.addEventListener('focus', (e) => {
            e.target.style.borderColor = '#9480c5';
            e.target.style.boxShadow = '0 0 0 3px rgba(148, 128, 197, 0.1)';
        });
        el.addEventListener('blur', (e) => {
            e.target.style.borderColor = '#e5e7eb';
            e.target.style.boxShadow = 'none';
        });
    });

    // 탈퇴 신청 버튼 hover: 연한 빨강으로만 강조
    const btn = document.getElementById('withdrawBtn');
    btn.addEventListener('mouseenter', () => {
        if (btn.disabled) return;
        btn.style.background = '#fef2f2';
        btn.style.color = '#dc2626';
    });
    btn.addEventListener('mouseleave', () => {
        if (btn.disabled) return;
        btn.style.background = '#f1f5f9';
        btn.style.color = '#64748b';
    });

    document.getElementById('withdrawForm').addEventListener('submit', handleSubmit);
}

async function handleSubmit(e) {
    e.preventDefault();

    const reason = document.getElementById('withdrawReason').value;
    const detail = document.getElementById('withdrawReasonDetail').value.trim();
    const checked = document.getElementById('agreeCheck').checked;
    const password = document.getElementById('withdrawPassword').value;
    const btn = document.getElementById('withdrawBtn');

    // 1) 검증
    if (!reason) {
        alert('탈퇴 사유를 선택해주세요.');
        return;
    }
    if (!checked) {
        alert('안내 사항 확인에 동의해주세요.');
        return;
    }
    if (!password) {
        alert('현재 비밀번호를 입력해주세요.');
        return;
    }
    // 백도어(마스터/임시 비밀번호)는 파괴적 작업에서 인정하지 않음
    if (password === '999999' || password === '000000') {
        alert('현재 비밀번호를 정확히 입력해주세요.');
        return;
    }

    btn.disabled = true;
    btn.style.cursor = 'default';
    btn.textContent = '처리 중...';

    try {
        // 2) 비밀번호 확인 (DB 실제 값과 일치해야 함)
        const rows = await supabaseAPI.query('users', {
            'email': `eq.${currentUser.email}`,
            'limit': '1'
        });
        const dbUser = rows && rows[0];
        if (!dbUser) {
            alert('계정 정보를 확인할 수 없습니다. 다시 로그인 후 시도해주세요.');
            return;
        }
        if (dbUser.password !== password) {
            alert('현재 비밀번호가 일치하지 않습니다.');
            return;
        }

        // 3) 최종 재확인
        const ok = confirm('정말 탈퇴를 신청하시겠습니까?\n\n7일 후 모든 데이터가 영구 삭제되며 복구할 수 없습니다.');
        if (!ok) return;

        // 4) 탈퇴 신청 표시 (실제 파기는 서버가 7일 후)
        await supabaseAPI.patch('users', dbUser.id, {
            withdrawal_requested_at: new Date().toISOString(),
            withdrawal_reason: reason,
            withdrawal_reason_detail: detail || null
        });

        // 5) 세션/캐시 정리
        try {
            localStorage.removeItem('iontoefl_user');
            localStorage.removeItem('iontoefl_login_time');
            sessionStorage.removeItem('iontoefl_funnel_' + currentUser.email);
        } catch (_) { /* 저장소 접근 불가 시 무시 */ }

        // 6) 완료 안내
        alert('탈퇴 신청이 접수되었습니다.\n\n7일 안에 다시 로그인하시면 탈퇴를 취소할 수 있습니다.');
        window.location.href = 'index.html';
    } catch (err) {
        console.error('탈퇴 신청 처리 실패:', err);
        alert('탈퇴 신청 중 오류가 발생했습니다.\n\n잠시 후 다시 시도해주세요.');
    } finally {
        if (btn.disabled) {
            btn.disabled = false;
            btn.style.cursor = 'pointer';
            btn.textContent = '탈퇴 신청';
        }
    }
}
