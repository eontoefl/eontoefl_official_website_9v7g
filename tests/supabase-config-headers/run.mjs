// 공홈 js/supabase-config.js 헤더 통합 회귀시험 (보안작업 묶음2 계약1)
//
// 실행:  node tests/supabase-config-headers/run.mjs      (저장소 폴더에서, Node v26, 설치할 것 없음)
//
// 하는 일
//   1) 변경 전 파일(git show 8bddea5:js/supabase-config.js)과 지금 파일을 각각 가짜 브라우저 환경(vm)에 올린다.
//   2) 같은 합성 입력으로 supabaseAPI 전 메서드·파일 올리기·fetchAPI 전 갈래를 부르고,
//      가짜 fetch 에 넘어간 주소·메서드·헤더(이름·값·순서)·본문과 반환값/오류 메시지를 비교한다.
//   3) 헤더 10곳과 새 함수를 뺀 나머지 텍스트가 같은지 비교한다.
//   4) 일부러 망가뜨린 사본으로 시험이 차이를 실제로 잡아내는지 확인한다.
// 실제 네트워크 요청은 0건이어야 한다. 공개 키 값은 출력하지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
    installNetworkGuard, verifyNetworkGuard, realNetworkAttempts,
    createEnv, runCall, diffCall, checkExpectations,
} from './harness.mjs';
import { targets, responses, expectedApiMethods, expectedStorageMethods } from './cases.mjs';

const BASE_COMMIT = '8bddea5';
const TARGET_FILE = 'js/supabase-config.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_LISTED = 40;

let secret = null;
const redact = (text) => {
    let s = String(text);
    if (secret) s = s.split(secret).join('<가림>');
    return s.replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)*/g, '<가림>');
};
const out = (line = '') => console.log(redact(line));

const failures = [];
const fail = (section, items) => {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) failures.push(`[${section}] ${item}`);
};

const normalize = (text) => text.replace(/\r\n/g, '\n');
const count = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------------------
// 텍스트 점검
// ---------------------------------------------------------------------------
const HEADER_BLOCK_BEFORE = /headers: \{(?:\$\{\w+\}|[^{}])*?'apikey'(?:\$\{\w+\}|[^{}])*\}/g;
const FUNCTION_BLOCK_AFTER = /(?:\/\/[^\n]*\n)*const supabaseHeaders = function \(extra\) \{\n[\s\S]*?\n\};\n\n/g;
const HEADER_CALL_AFTER = /headers: supabaseHeaders\((?:\{[^{}]*\})?\)/g;
const PLACEHOLDER = 'headers: <헤더 자리>';
const BEARER = 'Bearer ${SUPABASE_ANON_KEY}';
const KAKAO_START = 'async function sendKakaoAlimTalk(';

function checkText(before, after) {
    const problems = [];
    const info = {};

    if (before === after) problems.push('변경 전과 변경 후 파일이 같다(비교가 의미 없음)');

    info.beforeBlocks = (before.match(HEADER_BLOCK_BEFORE) || []).length;
    info.afterCalls = (after.match(HEADER_CALL_AFTER) || []).length;
    info.afterFunctionBlocks = (after.match(FUNCTION_BLOCK_AFTER) || []).length;
    info.afterNameCount = count(after, 'supabaseHeaders');
    info.apikeyBefore = count(before, "'apikey'");
    info.apikeyAfter = count(after, "'apikey'");
    info.bearerBefore = count(before, BEARER);
    info.bearerAfter = count(after, BEARER);

    if (info.beforeBlocks !== 10) problems.push(`변경 전 헤더 객체가 10곳이 아님(${info.beforeBlocks})`);
    if (info.afterCalls !== 10) problems.push(`변경 후 함수 사용처가 10곳이 아님(${info.afterCalls})`);
    if (info.afterFunctionBlocks !== 1) problems.push(`변경 후 헤더 함수 정의가 1곳이 아님(${info.afterFunctionBlocks})`);
    if (info.afterNameCount !== 11) problems.push(`변경 후 supabaseHeaders 이름이 11번(정의 1 + 사용 10)이 아님(${info.afterNameCount})`);
    if (count(before, 'supabaseHeaders') !== 0) problems.push('변경 전 파일에 supabaseHeaders 가 이미 있음');
    if (info.apikeyBefore !== 10) problems.push(`변경 전 'apikey' 가 10번이 아님(${info.apikeyBefore})`);
    if (info.apikeyAfter !== 1) problems.push(`변경 후 'apikey' 가 1번이 아님(${info.apikeyAfter}) — 헤더 복사본이 남아 있음`);
    if (info.bearerBefore !== 12) problems.push(`변경 전 Bearer 줄이 12번(10곳 + 알림톡 2)이 아님(${info.bearerBefore})`);
    if (info.bearerAfter !== 3) problems.push(`변경 후 Bearer 줄이 3번(함수 1 + 알림톡 2)이 아님(${info.bearerAfter})`);

    // 헤더 10곳과 새 함수를 뺀 나머지
    const restBefore = before.replace(HEADER_BLOCK_BEFORE, PLACEHOLDER);
    const restAfter = after.replace(FUNCTION_BLOCK_AFTER, '').replace(HEADER_CALL_AFTER, PLACEHOLDER);
    info.restLines = restBefore.split('\n').length;
    info.restSame = restBefore === restAfter;
    if (!info.restSame) {
        const a = restBefore.split('\n');
        const b = restAfter.split('\n');
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        problems.push(`헤더 10곳·새 함수를 뺀 나머지 텍스트가 다름(나머지 기준 ${i + 1}번째 줄부터)`);
    }
    if (restAfter.includes('supabaseHeaders')) problems.push('나머지 텍스트에 supabaseHeaders 가 남아 있음');

    // 알림톡 함수 두 개(범위 밖)는 글자 그대로여야 한다
    const kakaoBefore = before.slice(before.indexOf(KAKAO_START));
    const kakaoAfter = after.slice(after.indexOf(KAKAO_START));
    info.kakaoSame = before.includes(KAKAO_START) && kakaoBefore === kakaoAfter;
    if (!info.kakaoSame) problems.push('sendKakaoAlimTalk·sendKakaoAlimTalkBulk 부분이 달라짐');

    return { problems, info };
}

// ---------------------------------------------------------------------------
// 동작 비교
// ---------------------------------------------------------------------------
async function runAll(env) {
    const results = [];
    for (const target of targets) {
        for (const input of target.inputs) {
            for (const scenario of responses) {
                const label = `${target.name} › ${input.label} › ${scenario.name}`;
                const record = await runCall(env, label, (g) => target.invoke(g, input.args()), scenario);
                results.push({ target, input, record });
            }
        }
    }
    return results;
}

function compareRuns(a, b) {
    const diffs = [];
    if (a.length !== b.length) diffs.push('호출 수가 다름');
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffs.push(...diffCall(a[i].record, b[i].record));
    return diffs;
}

function checkEnvShape(env) {
    const problems = [];
    const apiKeys = Object.keys(env.api.supabaseAPI);
    const storageKeys = Object.keys(env.api.supabaseStorage);
    if (JSON.stringify(apiKeys) !== JSON.stringify(expectedApiMethods)) problems.push(`${env.label}: supabaseAPI 메서드 목록이 시험 목록과 다름(${apiKeys.join(', ')})`);
    if (JSON.stringify(storageKeys) !== JSON.stringify(expectedStorageMethods)) problems.push(`${env.label}: supabaseStorage 메서드 목록이 시험 목록과 다름(${storageKeys.join(', ')})`);
    if (typeof env.api.fetchAPI !== 'function') problems.push(`${env.label}: fetchAPI 가 함수가 아님`);
    if (env.loadConsole.length) problems.push(`${env.label}: 파일을 올리는 동안 console 출력이 있었음`);
    return problems;
}

// ---------------------------------------------------------------------------
// 감도 점검: 변경 후 파일을 메모리에서만 일부러 바꾼 사본. 시험이 차이를 잡아야 한다.
// ---------------------------------------------------------------------------
const UPLOAD = 'supabaseStorage.uploadBase64';
const controls = [
    {
        name: 'x-upsert 헤더를 뺌',
        from: "                'Content-Type': mime,\n                'x-upsert': 'true'      // 같은 이름 파일 덮어쓰기\n",
        to: "                'Content-Type': mime\n",
        mustInclude: '헤더 빠짐 [x-upsert]',
        onlyIn: [UPLOAD],
    },
    {
        name: 'apikey 와 Authorization 순서를 바꿈',
        from: "        'apikey': SUPABASE_ANON_KEY,\n        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,\n",
        to: "        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,\n        'apikey': SUPABASE_ANON_KEY,\n",
        mustInclude: '헤더 순서',
    },
    {
        name: 'Authorization 값에 공백 하나 추가',
        from: "        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,\n        'Content-Type'",
        to: "        'Authorization': `Bearer  ${SUPABASE_ANON_KEY}`,\n        'Content-Type'",
        mustInclude: '헤더 값 [Authorization]',
    },
    {
        name: '건수 조회의 Prefer 값을 바꿈',
        from: "supabaseHeaders({ 'Prefer': 'count=exact' })",
        to: "supabaseHeaders({ 'Prefer': 'count=planned' })",
        mustInclude: '헤더 값 [Prefer]',
        onlyIn: ['supabaseAPI.queryWithCount'],
    },
    {
        name: '파일 올리기의 Content-Type 을 json 으로 고정',
        from: "                'Content-Type': mime,\n",
        to: "                'Content-Type': 'application/json',\n",
        mustInclude: '헤더 값 [Content-Type]',
        onlyIn: [UPLOAD],
    },
    {
        name: '헤더 하나를 더 붙임',
        from: "        'Content-Type': 'application/json'\n    }, extra);",
        to: "        'Content-Type': 'application/json',\n        'X-Extra': '1'\n    }, extra);",
        mustInclude: '헤더 추가됨 [X-Extra]',
    },
    {
        name: '올리는 파일의 바이트를 바꿈',
        from: 'bytes[i] = binary.charCodeAt(i);',
        to: 'bytes[i] = binary.charCodeAt(i) ^ 1;',
        mustInclude: 'Blob 바이트',
        onlyIn: [UPLOAD],
    },
    {
        name: '수정 뒤 반환값을 바꿈',
        from: 'return result[0] || { id };',
        to: 'return result[0] || null;',
        mustInclude: '반환값',
        onlyIn: ['supabaseAPI.patch', 'supabaseAPI.put', 'fetchAPI PATCH', 'fetchAPI PUT'],
    },
];

async function runControls(afterSource, beforeRun) {
    const problems = [];
    const lines = [];
    for (const control of controls) {
        if (count(afterSource, control.from) !== 1) {
            problems.push(`감도 점검 "${control.name}": 바꿀 자리를 정확히 1곳 찾지 못함`);
            continue;
        }
        const env = createEnv(afterSource.replace(control.from, control.to), `감도:${control.name}`);
        const diffs = compareRuns(beforeRun, await runAll(env));
        if (env.forbidden.length) problems.push(`감도 점검 "${control.name}": 가짜 fetch 밖의 통신 시도`);
        if (diffs.length === 0) { problems.push(`감도 점검 "${control.name}": 차이를 잡지 못함`); continue; }
        if (!diffs.some((d) => d.includes(control.mustInclude))) problems.push(`감도 점검 "${control.name}": 기대한 종류(${control.mustInclude})의 차이가 없음`);
        if (control.onlyIn && !diffs.every((d) => control.onlyIn.some((t) => d.startsWith(`${t} › `)))) {
            problems.push(`감도 점검 "${control.name}": 관계없는 호출에서도 차이가 남`);
        }
        lines.push(`    - ${control.name}: 차이 ${diffs.length}건 검출`);
    }
    return { problems, lines };
}

// 다른 파일이 새 함수를 부르지 않는지(저장소 안, 로컬 git grep)
function findOutsideUsers() {
    try {
        const text = execFileSync('git', ['grep', '-l', '--untracked', '-I', 'supabaseHeaders', '--', '.'], { cwd: ROOT, encoding: 'utf8' });
        return text.split('\n').map((s) => s.trim()).filter(Boolean)
            .filter((f) => f !== TARGET_FILE && !f.startsWith('tests/supabase-config-headers/'));
    } catch (e) {
        if (e.status === 1) return [];
        throw e;
    }
}

function listSome(items) {
    for (const item of items.slice(0, MAX_LISTED)) out(`    · ${item}`);
    if (items.length > MAX_LISTED) out(`    · … 외 ${items.length - MAX_LISTED}건`);
}

// ---------------------------------------------------------------------------
async function main() {
    installNetworkGuard();
    const guardPaths = verifyNetworkGuard();

    const before = normalize(execFileSync('git', ['show', `${BASE_COMMIT}:${TARGET_FILE}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    const after = normalize(fs.readFileSync(path.join(ROOT, TARGET_FILE), 'utf8'));

    out('공홈 supabase-config.js 헤더 통합 회귀시험');
    out(`  변경 전: git show ${BASE_COMMIT}:${TARGET_FILE} (${before.split('\n').length - 1}줄)`);
    out(`  변경 후: ${TARGET_FILE} (${after.split('\n').length - 1}줄)`);
    out('');

    // [1] 네트워크 차단
    out(`[1] 네트워크 차단 장치 자체 점검: ${guardPaths}개 경로가 막히는 것을 확인`);

    // [2] 텍스트
    const text = checkText(before, after);
    fail('텍스트', text.problems);
    out(`[2] 텍스트 점검: ${text.problems.length === 0 ? '통과' : '실패'}`);
    out(`    - 헤더 객체: 변경 전 ${text.info.beforeBlocks}곳 → 변경 후 함수 정의 ${text.info.afterFunctionBlocks}곳 + 사용 ${text.info.afterCalls}곳`);
    out(`    - 'apikey' 글자: 변경 전 ${text.info.apikeyBefore}번 → 변경 후 ${text.info.apikeyAfter}번`);
    out(`    - 헤더 10곳·새 함수를 뺀 나머지 텍스트(${text.info.restLines}줄): ${text.info.restSame ? '동일' : '다름'}`);
    out(`    - 알림톡 함수 2개(범위 밖): ${text.info.kakaoSame ? '글자 그대로' : '달라짐'}`);
    listSome(text.problems);

    // [3] 환경
    const envBefore = createEnv(before, '변경 전');
    const envAfter = createEnv(after, '변경 후');
    secret = envBefore.key;
    const envProblems = [...checkEnvShape(envBefore), ...checkEnvShape(envAfter)];
    if (envBefore.key !== envAfter.key) envProblems.push('공개 키 상수 값이 변경 전후로 다름');
    if (envBefore.baseUrl !== envAfter.baseUrl) envProblems.push('SUPABASE_URL 값이 변경 전후로 다름');
    if (JSON.stringify(envBefore.windowAdded) !== JSON.stringify(envAfter.windowAdded)) envProblems.push('파일이 window 에 붙이는 이름 목록이 달라짐');
    if (envAfter.windowAdded.includes('supabaseHeaders')) envProblems.push('supabaseHeaders 가 window 에 붙음');
    if (envAfter.typeOf('window.supabaseHeaders') !== 'undefined') envProblems.push('window.supabaseHeaders 가 있음');
    if (envAfter.typeOf('supabaseHeaders') !== 'function') envProblems.push('변경 후 파일 안에 supabaseHeaders 함수가 없음');
    if (envBefore.typeOf('supabaseHeaders') !== 'undefined') envProblems.push('변경 전 파일에 supabaseHeaders 가 있음');
    const outsideUsers = findOutsideUsers();
    if (outsideUsers.length) envProblems.push(`다른 파일이 supabaseHeaders 를 씀: ${outsideUsers.join(', ')}`);
    fail('환경', envProblems);
    out(`[3] 올린 환경 점검: ${envProblems.length === 0 ? '통과' : '실패'}`);
    out(`    - supabaseAPI 메서드 ${expectedApiMethods.length}개·supabaseStorage ${expectedStorageMethods.length}개·fetchAPI 를 모두 시험 목록에 넣음`);
    out(`    - window 에 붙는 이름 ${envAfter.windowAdded.length}개로 변경 전과 같음, window.supabaseHeaders 없음, 다른 파일의 사용 ${outsideUsers.length}곳`);
    listSome(envProblems);

    // [4] 동작 비교
    const runBefore = await runAll(envBefore);
    const runAfter = await runAll(envAfter);
    const labels = new Set(runBefore.map((r) => r.record.label));
    if (labels.size !== runBefore.length) fail('동작', '호출 이름이 겹침');

    const diffs = compareRuns(runBefore, runAfter);
    fail('동작 비교', diffs);

    const expectProblems = [];
    for (const r of runBefore) expectProblems.push(...checkExpectations(r.record, r.target, r.input, envBefore).map((p) => `변경 전 ${p}`));
    for (const r of runAfter) expectProblems.push(...checkExpectations(r.record, r.target, r.input, envAfter).map((p) => `변경 후 ${p}`));
    fail('기대 모양', expectProblems);

    const inputCount = targets.reduce((n, t) => n + t.inputs.length, 0);
    const fetchRecords = runAfter.reduce((n, r) => n + r.record.fetches.length, 0);
    const headerEntries = runAfter.reduce((n, r) => n + r.record.fetches.reduce((m, f) => m + (f.headers.entries ? f.headers.entries.length : 0), 0), 0);
    const blobBodies = runAfter.reduce((n, r) => n + r.record.fetches.filter((f) => f.body.kind === 'blob').length, 0);
    const returned = runAfter.filter((r) => r.record.outcome.type === '반환').length;
    const threw = runAfter.length - returned;
    const minInputs = Math.min(...targets.map((t) => t.inputs.length));
    if (minInputs < 3) fail('동작', `입력이 3개 미만인 진입점이 있음(최소 ${minInputs})`);
    if (runBefore.length !== inputCount * responses.length) fail('동작', '호출 수가 입력 × 응답과 맞지 않음');
    if (fetchRecords === 0 || blobBodies === 0) fail('동작', 'fetch 기록 또는 Blob 본문이 하나도 잡히지 않음');

    out(`[4] 동작 비교: ${diffs.length === 0 ? '차이 0' : `차이 ${diffs.length}건`}`);
    out(`    - 진입점 ${targets.length}개 × 입력 ${inputCount}개(진입점마다 최소 ${minInputs}개) × 가짜 응답 ${responses.length}종 = 비교한 호출 ${runAfter.length}건`);
    out(`    - 그 안에서 대조한 fetch 요청 ${fetchRecords}건, 헤더 ${headerEntries}개(이름·값·순서), Blob 본문 ${blobBodies}건(MIME·바이트)`);
    out(`    - 결과 대조: 반환 ${returned}건, 오류 ${threw}건(종류·메시지)`);
    listSome(diffs);
    out(`[5] 계약서 헤더 모양 ①~④·메서드·주소 앞부분·Blob 원본 대조(변경 전·후 각각): ${expectProblems.length === 0 ? '어긋남 0' : `어긋남 ${expectProblems.length}건`}`);
    listSome(expectProblems);

    // [6] 감도
    const control = await runControls(after, runBefore);
    fail('감도', control.problems);
    out(`[6] 감도 점검(일부러 바꾼 사본 ${controls.length}개): ${control.problems.length === 0 ? '모두 차이로 검출' : '실패'}`);
    for (const line of control.lines) out(line);
    listSome(control.problems);

    // [7] 네트워크
    const forbidden = envBefore.forbidden.length + envAfter.forbidden.length;
    if (realNetworkAttempts.length) fail('네트워크', `실제 네트워크 요청 시도 ${realNetworkAttempts.length}건: ${[...new Set(realNetworkAttempts)].join(', ')}`);
    if (forbidden) fail('네트워크', `가짜 fetch 밖의 통신 시도 ${forbidden}건`);
    if (envBefore.fakeFetchCount !== envAfter.fakeFetchCount) fail('네트워크', '가짜 fetch 호출 수가 변경 전후로 다름');
    out(`[7] 실제 네트워크 요청 ${realNetworkAttempts.length}건, 가짜 fetch 밖의 통신 시도 ${forbidden}건 (가짜 fetch 호출: 변경 전 ${envBefore.fakeFetchCount}건, 변경 후 ${envAfter.fakeFetchCount}건)`);

    out('');
    if (failures.length === 0) {
        out('결과: 통과');
    } else {
        out(`결과: 실패 (${failures.length}건)`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    // 오류 내용에 소스 줄이 섞여 나올 수 있어 메시지만, 가려서 찍는다.
    out(`결과: 실패 — 시험 도구 오류: ${e && e.message ? e.message : String(e)}`);
    process.exitCode = 1;
});
