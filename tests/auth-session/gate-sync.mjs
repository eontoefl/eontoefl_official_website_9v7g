// 대상 화면 26개의 head 에 게이트(화면의 스위치 + 로그인 값을 주는 한 길)와 인증 모듈 태그를 넣는다.
//   node tests/auth-session/gate-sync.mjs          넣기(이미 있으면 원본의 글자로 맞춘다)
//   node tests/auth-session/gate-sync.mjs --check  저장소의 화면이 원본과 같은지만 본다(다르면 종료 코드 1)
// 파일만 고친다. 네트워크를 쓰지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_FILES, GATE_BEGIN, GATE_END, GATE_SOURCE, MODULE_TAG, GATE_COMMENT } from './pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const check = process.argv.includes('--check');
const gate = fs.readFileSync(path.join(ROOT, GATE_SOURCE), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
if (!gate.startsWith(GATE_BEGIN) || !gate.endsWith(GATE_END)) throw new Error('원본의 시작·끝 표시가 맞지 않다');

export function block(eol) {
    const lines = ['    ' + GATE_COMMENT, '    <script>', ...gate.split('\n'), '    </script>', '    ' + MODULE_TAG];
    return lines.join(eol) + eol;
}

let changed = 0;
let different = 0;
for (const file of TARGET_FILES) {
    const full = path.join(ROOT, file);
    const before = fs.readFileSync(full, 'utf8');
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    let text = before;
    // 이미 넣은 묶음(주석 + 게이트 + 모듈 태그)을 걷어 낸다
    const begin = text.indexOf(GATE_BEGIN);
    if (begin >= 0) {
        const from = text.lastIndexOf('<!--', begin);
        const end = text.indexOf('</script>', text.indexOf('</script>', begin) + 1);
        if (from < 0 || end < 0) throw new Error(file + ': 넣어 둔 묶음의 모양이 맞지 않다');
        const lineStart = text.lastIndexOf('\n', from) + 1;
        let lineEnd = text.indexOf('\n', end);
        lineEnd = lineEnd < 0 ? text.length : lineEnd + 1;
        text = text.slice(0, lineStart) + text.slice(lineEnd);
    }
    // 3A 가 넣은 줄(주석 + 모듈 태그)을 걷어 낸다
    text = text.replace(/^[ \t]*<!-- 인증 모듈:[^\n]*-->\r?\n/m, '');
    text = text.replace(/^[ \t]*<script src="js\/auth-session\.js[^"]*"><\/script>\r?\n/gm, '');
    if (/auth-session\.js/.test(text)) throw new Error(file + ': 인증 모듈 태그가 다른 모양으로 남아 있다');
    const headEnd = text.indexOf('</head>');
    if (headEnd < 0 || text.indexOf('</head>', headEnd + 1) >= 0) throw new Error(file + ': </head> 를 정확히 1곳 찾지 못함');
    const lineStart = text.lastIndexOf('\n', headEnd) + 1;
    if (text.slice(lineStart, headEnd).trim() !== '') throw new Error(file + ': </head> 가 줄의 처음이 아니다');
    text = text.slice(0, lineStart) + block(eol) + text.slice(lineStart);
    if (text !== before) {
        different++;
        if (!check) { fs.writeFileSync(full, text); changed++; }
    }
}
if (check) {
    console.log(different === 0 ? `게이트: 대상 화면 ${TARGET_FILES.length}개가 원본과 같음` : `게이트: 원본과 다른 화면 ${different}개`);
    process.exit(different === 0 ? 0 : 1);
}
console.log(`게이트: 대상 화면 ${TARGET_FILES.length}개 가운데 ${changed}개를 고침`);
