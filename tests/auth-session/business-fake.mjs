// 화면 시험 실행기(screen.mjs)가 쓰는 "사람의 값"의 한 곳: 막은 업무 요청에 주는 가짜 응답, 업무 요청의 기록에 붙이는 이름표,
// 판정이 기대하는 이름·이메일. 이 파일은 요청을 보내지 않는다(계산뿐) — 회귀시험(run-pages.mjs)이 변조까지 본다.
//
// **사람의 값은 my_profile 의 응답에서 본 것만 쓴다**: 회원 표의 이메일·회원번호·이름.
// 로그인 이메일(환경 변수의 값)은 화면에 보일 값도 업무 조건의 값도 아니다 — 화면이 쓰는 것은 확인된 회원의 이메일이고,
// 시험 자료의 합성 회원은 로그인 이메일과 회원 이메일이 일부러 다르다.
// 로그인 이메일을 쓰는 곳은 둘뿐이다: (1) 요청의 JWT 로 "누구의 my_profile 응답인가"를 가린다
// (2) 이름표에 따로 둔다 — 화면이 로그인 이메일을 업무 조건에 쓰면 결함이고, 따로 센다.
// 이 값들은 결과 파일에 쓰지 않는다(이름표로만 적는다).

export const FAKE_APP = '00000000-0000-4000-8000-0000b3c1a001';      // 가짜 응답에만 있는 신청서 번호(시험 프로젝트의 DB 에는 없다)
export const FAKE_POST = 'zz-b3c1-post';                              // 가짜 응답에만 있는 글 번호
export const FAKE_PREV_APP = '00000000-0000-4000-8000-0000b3c2a0';    // (계약 3C-2a) 가짜 응답에만 있는 "지난 신청서(수강 1)" 번호의 앞부분 — 뒤에 이름표가 붙는다
const CONTENT_TABLES = ['notices', 'reviews', 'reviews_book', 'study_certifications', 'materials', 'application_notices'];
// A 의 my_profile 을 아직 보지 못했을 때의 가짜 자료의 주인(어느 합성 계정도 아니다)
const NOBODY = { id: 'zz-fake-nobody', name: '합성 신청자', email: 'nobody@fake-rows.zz.invalid' };

// loginEmails: { 이름표: 로그인 이메일 } 또는 그것을 돌려주는 함수
// fixturesFromLoginEmail: 대조 실험 전용 — 가짜 자료와 이름표의 이메일을 로그인 이메일로 만든다(3차 보완 전의 결함)
export function makePeople({ loginEmails, fixturesFromLoginEmail = false } = {}) {
    const seen = { ids: {}, names: {}, emails: {} };       // my_profile 의 응답에서 본 것
    const login = () => (typeof loginEmails === 'function' ? loginEmails() : loginEmails) || {};
    const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 0 && a.trim().toLowerCase() === b.trim().toLowerCase();
    // 그 계정의 my_profile 을 본 적이 있는가
    const known = (k) => typeof seen.ids[k] === 'string' && typeof seen.names[k] === 'string' && typeof seen.emails[k] === 'string';
    // **가짜 자료와 이름표가 쓰는 "그 사람의 이메일"** — my_profile 이 준 회원 표의 이메일
    const emailOf = (k) => (fixturesFromLoginEmail ? login()[k] : seen.emails[k]) || '';
    const person = (k) => (known(k) ? { id: seen.ids[k], name: seen.names[k], email: emailOf(k) } : null);
    // (계약 3C-2a) 재시작이 허용된 회원의 이름표들: 그 회원의 "기존 신청 확인"(회원 이메일이 조건)에 지난 신청서 한 건을 준다
    // → 신청서 화면이 재시작 신청 화면이 되고 성적 이력을 읽는다. 그 신청서는 가짜 응답에만 있다
    let restart = [];
    const restartApp = (k) => {
        const p = person(k);
        return {
            id: FAKE_PREV_APP + String(Object.keys(seen.ids).indexOf(k) + 10), email: p.email, user_email: p.email, user_id: p.id, name: p.name, phone: '010-0000-0000', application_type: 'challenge',
            deleted: false, withdrawn_at: null, enrollment_no: 1, restart_allowed_at: '2026-11-01T00:00:00Z', superseded_by: null, restart_materials: [],
            has_toefl_score: 'no', address: '합성 주소', bank_name: '합성은행', account_number: '000-00-000000', account_holder: p.name,
            preferred_program: '', preferred_correction: '', submitted_date: '2026-06-01', created_at: '2026-06-01T00:00:00Z',
        };
    };
    const byValue = (v) => Object.keys(seen.ids).find((k) => known(k) && (same(emailOf(k), v) || seen.ids[k] === v));

    return {
        // my_profile 의 응답 한 건을 그 요청의 계정에 적는다(key 는 accountOfJwt 가 가린 이름표)
        note(key, profile) {
            if (!key || !profile || typeof profile !== 'object') return false;
            if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || typeof profile.email !== 'string' || !profile.id || !profile.email) return false;
            seen.ids[key] = profile.id;
            seen.names[key] = profile.name;
            seen.emails[key] = profile.email;
            return true;
        },
        // 요청의 JWT(로그인 이메일이 들어 있다)로 계정의 이름표를 가린다
        accountOfJwt(authorization) {
            try {
                const parts = String(authorization || '').replace(/^Bearer /, '').split('.');
                if (parts.length !== 3) return null;
                const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                if (!c || typeof c.email !== 'string') return null;
                for (const [key, value] of Object.entries(login())) if (same(value, c.email)) return key;
                return null;
            } catch (e) { return null; }
        },
        known,
        // 판정의 기대에 쓰는 값(화면에 보여야 하는 것) — 언제나 my_profile 에서 본 것
        nameOf: (k) => (known(k) ? seen.names[k] : ''),
        memberEmailOf: (k) => (known(k) ? seen.emails[k] : ''),
        memberIdOf: (k) => (known(k) ? seen.ids[k] : ''),
        setRestart: (keys) => { restart = Array.isArray(keys) ? keys.slice() : []; },
        // 로그인 이메일과 회원 이메일이 다른가(같으면 "화면이 로그인 이메일을 조건에 쓰는가"를 잴 수 없다). 모르면 null
        differs: (k) => (known(k) && login()[k] ? !same(seen.emails[k], login()[k]) : null),
        // 결과에 적히면 안 되는 값들(끝에서 흔적을 찾아보는 데만 쓴다): my_profile 에서 본 회원 이메일과, 짧지 않은 회원번호
        privateValues: () => Object.values(seen.emails).concat(Object.values(seen.ids).filter((x) => x.length >= 16)),
        // 기록의 이름표에 쓰는 값들: { 이름표: { emails: [회원 이메일], ids: [회원번호], loginEmails: [로그인 이메일] } }
        labels() {
            const out = {};
            for (const k of new Set([...Object.keys(login()), ...Object.keys(seen.ids)])) {
                out[k] = { emails: known(k) && emailOf(k) ? [emailOf(k)] : [], ids: known(k) ? [seen.ids[k]] : [], loginEmails: login()[k] ? [login()[k]] : [] };
            }
            return out;
        },
        // 막은 업무 요청에 주는 가짜 응답(--fake·--real 같은 모양). 조회에만 자료를 주고, 쓰기에는 빈 목록을 준다
        fake(method, rawUrl) {
            let u;
            try { u = new URL(rawUrl); } catch (e) { return []; }
            if (String(method).toUpperCase() !== 'GET') return [];
            const m = /^\/rest\/v1\/([A-Za-z0-9_]+)$/.exec(u.pathname);
            if (!m) return [];
            const table = m[1];
            const q = u.searchParams;
            const eq = (k) => { const v = q.get(k) || ''; return v.startsWith('eq.') ? v.slice(3) : ''; };
            const a = person('A') || NOBODY;                 // 가짜 신청서·가짜 글의 주인은 A 다(A 를 아직 모르면 주인 없는 자료)
            const appA = { id: FAKE_APP, email: a.email, user_email: a.email, user_id: a.id, name: a.name, phone: '010-0000-0000', application_type: 'challenge', program: '합성 과정', deleted: false, withdrawn_at: null, analysis_status: '승인', analysis_content: '합성 분석', created_at: '2026-11-01T00:00:00Z' };
            if (table === 'users') {
                const k = byValue(eq('email')) || byValue(eq('id'));
                const p = k ? person(k) : null;
                return p ? [{ id: p.id, name: p.name, nickname: '합성닉', email: p.email, phone: '010-0000-0000', role: 'user', intro_book_track: 'regular', blocked: false, withdrawal_requested_at: null }] : [];
            }
            if (table === 'applications') {
                if (eq('id')) return eq('id') === FAKE_APP ? [appA] : [];
                if (eq('email')) { const k = restart.find((x) => known(x) && same(emailOf(x), eq('email'))); if (k) return [restartApp(k)]; }
                if (q.has('email') || q.has('user_id') || q.has('user_email')) return [];       // 합성 회원은 "신청서가 없는 회원"이다(번호로 열 때만 A 의 가짜 신청서 한 건)
                return [appA];                                                                  // 신청 게시판의 목록
            }
            if (table === 'toefl_survey_questions') return [{ id: 'zz-b3c1-q1', question: '합성 질문', question_type: 'text', options: null, status: 'active', hidden: false, target_count: null, sort_order: 1, created_at: '2026-11-01T00:00:00Z' }];
            if (CONTENT_TABLES.includes(table)) {
                return [{ id: eq('id') || FAKE_POST, subject: '합성 글', content: '<p>합성 본문</p>', author: '합성 글쓴이', author_name: '합성 글쓴이', author_email: a.email, published_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', hit: 1, is_private: false, attachments: [] }];
            }
            return [];
        },
    };
}
