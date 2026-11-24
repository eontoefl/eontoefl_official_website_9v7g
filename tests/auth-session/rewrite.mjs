// 시험용 로컬 서버(serve.mjs)와 회귀시험(run.mjs)이 함께 쓰는 "내줄 때 바꾸기"와 "운영 흔적 찾기".
// 저장소의 파일은 바꾸지 않는다 — 내주는 사본(메모리)만 바꾼다.

export const PROD_REF = 'qpqjevecjejvbeuogtbx';
export const TEST_REF = 'hmncdheiwqwekdbtijar';
export const TEST_URL = `https://${TEST_REF}.supabase.co`;

export const CONFIG_FILE = 'js/supabase-config.js';
export const AUTH_FILE = 'js/auth-session.js';

const URL_LINE = /^const SUPABASE_URL = '([^']*)';(\r?)$/m;
const KEY_LINE = /^const SUPABASE_ANON_KEY = '([^']*)';(\r?)$/m;
const PLATFORM_LINE = /^const DEFAULT_PLATFORM_URL = '([^']*)';(\r?)$/m;
const SWITCH_LINE = /^( *)const EON_AUTH_SWITCH = '(off|on)';(\r?)$/m;

// (계약 3C-2a) 업무 규약의 그 업무 한 칸: my-scores 의 회원 읽기가 열렸는가. 저장소의 값은 닫힘(false)이어야 한다.
const MEMBER_TASK_LINE = /^( *)'my-scores': Object\.freeze\(\{ open: (false|true),(\r?)$/m;

const countMatches = (text, re) => (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;

function exactlyOne(text, re, what) {
    const n = countMatches(text, re);
    if (n !== 1) throw new Error(`${what}: 바꿀 줄을 정확히 1곳 찾지 못함(${n}곳)`);
}

// 저장소의 설정 파일에서 운영 주소·운영 공개 키를 읽는다(값은 어디에도 찍지 않는다 — 흔적을 찾는 데만 쓴다).
export function readProdConfig(configText) {
    exactlyOne(configText, URL_LINE, 'SUPABASE_URL');
    exactlyOne(configText, KEY_LINE, 'SUPABASE_ANON_KEY');
    return { url: configText.match(URL_LINE)[1], key: configText.match(KEY_LINE)[1] };
}

// 설정 파일의 주소·공개 키를 시험 프로젝트의 값으로, 테스트룸 주소를 로컬 시험 목적지로 바꾼다.
export function rewriteConfig(text, { testUrl, testKey, sinkUrl }) {
    if (testUrl !== TEST_URL) throw new Error('시험 프로젝트의 주소가 아니다');
    if (typeof testKey !== 'string' || !testKey || testKey.includes("'") || testKey.includes('\\')) throw new Error('시험 공개 키의 모양이 맞지 않다');
    exactlyOne(text, URL_LINE, 'SUPABASE_URL');
    exactlyOne(text, KEY_LINE, 'SUPABASE_ANON_KEY');
    let out = text.replace(URL_LINE, (m, v, cr) => `const SUPABASE_URL = '${testUrl}';${cr}`);
    out = out.replace(KEY_LINE, (m, v, cr) => `const SUPABASE_ANON_KEY = '${testKey}';${cr}`);
    if (sinkUrl) {
        exactlyOne(out, PLATFORM_LINE, 'DEFAULT_PLATFORM_URL');
        out = out.replace(PLATFORM_LINE, (m, v, cr) => `const DEFAULT_PLATFORM_URL = '${sinkUrl}';${cr}`);
    }
    return out;
}

// 스위치: 저장소의 값은 'off' 여야 한다. mode 가 'on' 일 때만 내주는 사본에서 'on' 으로 바꾼다.
export function rewriteSwitch(text, mode) {
    exactlyOne(text, SWITCH_LINE, 'EON_AUTH_SWITCH');
    const current = text.match(SWITCH_LINE)[2];
    if (current !== 'off') throw new Error('저장소의 스위치 값이 꺼짐이 아니다');
    if (mode === 'off') return text;
    if (mode !== 'on') throw new Error('mode 는 on 또는 off');
    return text.replace(SWITCH_LINE, (m, indent, v, cr) => `${indent}const EON_AUTH_SWITCH = 'on';${cr}`);
}

// 화면(HTML)의 head 에 든 스위치(게이트의 EON_LOGIN_PAGE). 저장소의 값은 'off' 여야 한다.
// mode 가 'on' 일 때만 내주는 사본에서 'on' 으로 바꾼다. 게이트가 없는 화면(대상이 아닌 화면)은 그대로 둔다.
const PAGE_SWITCH_LINE = /^( *)var EON_LOGIN_PAGE = '(off|on)';(\r?)$/m;
export function hasPageSwitch(text) { return countMatches(text, PAGE_SWITCH_LINE) > 0; }
export function rewritePageSwitch(text, mode) {
    if (!hasPageSwitch(text)) return text;
    exactlyOne(text, PAGE_SWITCH_LINE, 'EON_LOGIN_PAGE');
    const current = text.match(PAGE_SWITCH_LINE)[2];
    if (current !== 'off') throw new Error('저장소의 화면 스위치 값이 꺼짐이 아니다');
    if (mode === 'off') return text;
    if (mode !== 'on') throw new Error('mode 는 on 또는 off');
    return text.replace(PAGE_SWITCH_LINE, (m, indent, v, cr) => `${indent}var EON_LOGIN_PAGE = 'on';${cr}`);
}
export function pageSwitchValue(text) {
    const m = text.match(PAGE_SWITCH_LINE);
    return m && countMatches(text, PAGE_SWITCH_LINE) === 1 ? m[2] : null;
}

// (계약 3C-2a) 인증 모듈의 업무 규약에서 my-scores 의 회원 읽기를 연다(내주는 사본에서만). 저장소의 값은 닫힘이어야 한다.
// 새 스위치 자리가 아니다 — 규약의 그 업무 한 칸이다.
export function rewriteMemberTask(text, open) {
    exactlyOne(text, MEMBER_TASK_LINE, "업무 규약의 'my-scores'");
    if (text.match(MEMBER_TASK_LINE)[2] !== 'false') throw new Error('저장소의 업무 규약에서 my-scores 가 닫힘이 아니다');
    if (!open) return text;
    return text.replace(MEMBER_TASK_LINE, (m, indent, v, cr) => `${indent}'my-scores': Object.freeze({ open: true,${cr}`);
}
export function memberTaskValue(text) {
    const m = text.match(MEMBER_TASK_LINE);
    return m && countMatches(text, MEMBER_TASK_LINE) === 1 ? m[2] : null;
}

export function switchValue(text) {
    const m = text.match(SWITCH_LINE);
    return m && countMatches(text, SWITCH_LINE) === 1 ? m[2] : null;
}

const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

// 응답 본문에 운영 ref·운영 주소·운영 키(또는 시험 프로젝트의 것이 아닌 Supabase 키)가 남아 있는가.
// 돌려주는 값: 흔적의 종류 이름들(값은 돌려주지 않는다).
export function findProdResidue(buffer, { prodKey, prodUrl } = {}) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
    const found = [];
    if (text.includes(PROD_REF)) found.push('운영 ref');
    if (prodUrl && text.includes(prodUrl)) found.push('운영 주소');
    if (prodKey && text.includes(prodKey)) found.push('운영 키');
    for (const token of text.match(JWT_SHAPE) || []) {
        let claims = null;
        try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch (e) { claims = null; }
        if (claims && typeof claims.ref === 'string' && claims.ref !== TEST_REF) { found.push('시험 프로젝트의 것이 아닌 Supabase 키'); break; }
    }
    return [...new Set(found)];
}

// 한 파일을 내줄 사본으로 바꾸고 운영 흔적을 찾는다.
// 돌려주는 값: { body(Buffer), residue(종류 이름들), changed(바꾼 것) }
export function transformForServe(relPath, buffer, { mode, testUrl, testKey, sinkUrl, prodKey, prodUrl }) {
    let body = buffer;
    const changed = [];
    if (mode !== 'off' && mode !== 'on' && mode !== 'on-open') throw new Error('mode 는 off·on·on-open');
    const sw = mode === 'off' ? 'off' : 'on';
    if (relPath === CONFIG_FILE) {
        body = Buffer.from(rewriteConfig(buffer.toString('utf8'), { testUrl, testKey, sinkUrl }), 'utf8');
        changed.push('Supabase 주소·공개 키 → 시험 프로젝트', '테스트룸 주소 → 로컬 시험 목적지');
    } else if (relPath === AUTH_FILE) {
        // mode: off / on(새 로그인 켜짐, my-scores 닫힘 — 3C-1 의 켜짐) / on-open(새 로그인 켜짐 + my-scores 의 회원 읽기 열림 — 계약 3C-2a)
        let text = rewriteSwitch(buffer.toString('utf8'), sw);
        if (memberTaskValue(text) !== null || mode === 'on-open') text = rewriteMemberTask(text, mode === 'on-open');
        body = Buffer.from(text, 'utf8');
        if (sw === 'on') changed.push('새 로그인 스위치 → 켜짐');
        if (mode === 'on-open') changed.push('업무 규약의 my-scores → 열림');
    } else if (/\.html$/i.test(relPath)) {
        const html = buffer.toString('utf8');
        if (hasPageSwitch(html)) {
            body = Buffer.from(rewritePageSwitch(html, sw), 'utf8');
            if (sw === 'on') changed.push('화면의 새 로그인 스위치 → 켜짐');
        }
    }
    return { body, residue: findProdResidue(body, { prodKey, prodUrl }), changed };
}
