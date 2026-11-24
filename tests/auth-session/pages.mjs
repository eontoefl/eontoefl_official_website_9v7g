// 계약 3C-1 의 대상 화면(새 일반 로그인을 쓰는 화면) 목록 — 한 곳. gate-sync.mjs·run.mjs·screen.mjs 가 함께 쓴다.
// 범주: public(공개 화면) / member(회원 화면) / branch(방문자·회원 갈래) / entry(가입·찾기·로그인)

export const TARGET_PAGES = [
    { file: 'index.html', category: 'public' },
    { file: 'about.html', category: 'public' },
    { file: 'faq.html', category: 'public' },
    { file: 'pricing.html', category: 'public' },
    { file: 'programs.html', category: 'public' },
    { file: 'notice.html', category: 'public' },
    { file: 'reviews.html', category: 'public' },
    { file: 'reviews-book.html', category: 'public' },
    { file: 'study-certify.html', category: 'public' },
    { file: 'materials.html', category: 'public' },
    { file: 'my-application.html', category: 'public' },
    { file: 'my-dashboard.html', category: 'member' },
    { file: 'my-profile.html', category: 'member' },
    { file: 'change-password.html', category: 'member' },
    { file: 'withdraw.html', category: 'member' },
    { file: 'application-detail.html', category: 'member' },
    { file: 'analysis.html', category: 'member' },
    { file: 'write.html', category: 'member' },
    { file: 'application-form.html', category: 'branch' },
    { file: 'book-request.html', category: 'branch' },
    { file: 'survey.html', category: 'branch' },
    { file: 'application.html', category: 'branch' },
    { file: 'login.html', category: 'entry' },
    { file: 'register.html', category: 'entry' },
    { file: 'find-id.html', category: 'entry' },
    { file: 'find-password.html', category: 'entry' },
];

export const TARGET_FILES = TARGET_PAGES.map((p) => p.file);

// 화면의 head 에 들어가는 글자(게이트)의 표시
export const GATE_BEGIN = '/* eon-login-gate:begin';
export const GATE_END = '/* eon-login-gate:end */';
export const GATE_SOURCE = 'tests/auth-session/login-gate.inline.js';
export const MODULE_TAG = '<script src="js/auth-session.js?v=20261126"></script>';
export const GATE_COMMENT = '<!-- 새 로그인(계약 3A·3C-1): 이 화면의 스위치와 인증 모듈. 처음 그려지기 전에 싣는다(스위치가 꺼져 있으면 아무것도 하지 않는다) -->';

// 화면의 스위치 줄(게이트 안). 저장소의 값은 'off' 여야 한다.
export const PAGE_SWITCH_LINE = /^( *)var EON_LOGIN_PAGE = '(off|on)';(\r?)$/m;

// HTML 에서 게이트의 글자(시작 표시부터 끝 표시까지)를 꺼낸다. 없거나 둘 이상이면 null
export function extractGate(html) {
    const a = html.indexOf(GATE_BEGIN);
    if (a < 0 || html.indexOf(GATE_BEGIN, a + 1) >= 0) return null;
    const b = html.indexOf(GATE_END, a);
    if (b < 0) return null;
    return html.slice(a, b + GATE_END.length);
}
