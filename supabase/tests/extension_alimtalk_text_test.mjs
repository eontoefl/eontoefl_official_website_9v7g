// kakaotalk-notify 엣지 함수 — 마감 연장 알림톡(50246 / 50247) 본문이 카카오 승인 원문과 문자 단위로 같은지 확인.
//  - 제품 원문(index.ts)에서 타입 선언 import 1줄만 제거 → node:module.stripTypeScriptTypes 로 타입 제거 → vm 에서 실행.
//  - Deno.env.get / Deno.serve 는 가짜. fetch 도 가짜(공급사 URL 은 code 0 응답, DB 로그는 201). 실제 발송 아님.
//  - 실행: node supabase/tests/extension_alimtalk_text_test.mjs
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REL = path.join(HERE, '..', 'functions', 'kakaotalk-notify', 'index.ts');

let src = readFileSync(REL, 'utf8');
src = src.replace(/^﻿/, '').replace(/^import "@supabase\/functions-js\/edge-runtime.d.ts";\s*$/m, '// [test] type-only import removed');
// 모듈 최상위 const 는 vm 전역에 안 잡히므로 검사 대상만 명시적으로 꺼낸다.
src += '\nglobalThis.__under_test = { TEMPLATE_IDS, buildMsgContent, buildSmsContent, hasNoButton, buildMessageObject, getBtnUrl };\n';
const js = stripTypeScriptTypes(src, { mode: 'strip' });

const calls = []; let handler = null;
const sandbox = {
  console: { log: () => {}, warn: (...a) => calls.push({ warn: a.map(String) }), error: (...a) => calls.push({ error: a.map(String) }) },
  Deno: { env: { get: (k) => ({ LUNASOFT_USERID: 'test-user', LUNASOFT_API_KEY: 'test-key', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' })[k] }, serve: (fn) => { handler = fn; } },
  fetch: async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method: opts && opts.method, body });
    if (String(url).includes('jupiter.lunasoft.co.kr')) {
      return { json: async () => ({ code: 0, msg: 'OK', messages: (body.messages || []).map(() => ({ result_code: '0', result_msg: '성공' })) }) };
    }
    return { ok: true, status: 201, text: async () => '' };
  },
  Request, Response, Headers, JSON, Date, String, Number, Array, Object, Math, Error, Promise,
};
vm.createContext(sandbox);
vm.runInContext(js, sandbox, { filename: 'kakaotalk-notify.index.js' });
const { TEMPLATE_IDS, buildMsgContent, buildSmsContent, hasNoButton, buildMessageObject } = sandbox.__under_test;
if (!handler) throw new Error('Deno.serve handler not captured');

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; process.stdout.write('PASS ' + name + '\n'); },
    (e) => { process.stderr.write('FAIL ' + name + '\n' + e.stack + '\n'); process.exitCode = 1; });
}

// ===== 승인 원문 (작업지시 §2-3 그대로, 변수만 채움) =====
const corrData = { name: '홍길동', phone: '010-0000-0000', session: '3', tasks: 'Email + Interview', draft: '1', hours: '24', deadline: '9/12(토) 04:00' };
const CORR_EXPECTED = [
  '이온토플 - 스라첨삭 마감 연장 안내',
  '',
  '홍길동님, 안녕하세요 :)',
  '',
  '신청하신 스라첨삭 3회차의 Email + Interview 과제, 1차 제출 마감을 24시간 연장해드렸어요!',
  '',
  '⏰ 변경된 마감: 9/12(토) 04:00',
  '',
  '위 시간까지 테스트룸에서 해당 과제를 제출해주시면 됩니다 :)',
].join('\n');

const chalData = { name: '홍길동', phone: '010-0000-0000', task_date: '9/10(목)', days: '3', deadline: '9/14(월) 04:00' };
const CHAL_EXPECTED = [
  '이온토플 - 내벨업챌린지 마감 연장 안내',
  '',
  '홍길동님, 안녕하세요 :)',
  '',
  '신청하신 내벨업챌린지에서 9/10(목)에 배정된 과제의 마감을 3일 연장해드렸어요!',
  '',
  '⏰ 변경된 마감: 9/14(월) 04:00',
  '',
  '위 시간까지 테스트룸에서 해당 날짜의 과제를 완료해주시면 됩니다 :)',
].join('\n');

await test('템플릿 ID: correction_deadline_extended=50246, challenge_deadline_extended=50247', () => {
  assert.equal(TEMPLATE_IDS.correction_deadline_extended, 50246);
  assert.equal(TEMPLATE_IDS.challenge_deadline_extended, 50247);
});

await test('50246 본문이 승인 원문과 문자 단위로 같다', () => {
  assert.equal(buildMsgContent('correction_deadline_extended', corrData), CORR_EXPECTED);
});

await test('50246 본문 — 해외 학생(현지 시간 표기)·2차·과제 하나', () => {
  const d = { ...corrData, tasks: 'INT SPK 2 + INT WRT', draft: '2', hours: '12', deadline: '9/9(수) 04:00 (현지 시간)' };
  assert.equal(buildMsgContent('correction_deadline_extended', d),
    CORR_EXPECTED.replace('Email + Interview', 'INT SPK 2 + INT WRT').replace('1차 제출', '2차 제출').replace('24시간', '12시간').replace('9/12(토) 04:00', '9/9(수) 04:00 (현지 시간)'));
});

await test('50247 본문이 승인 원문과 문자 단위로 같다', () => {
  assert.equal(buildMsgContent('challenge_deadline_extended', chalData), CHAL_EXPECTED);
});

await test('SMS 대체문 2개', () => {
  assert.equal(buildSmsContent('correction_deadline_extended', corrData), '[이온토플] 스라첨삭 마감이 연장되었습니다. 테스트룸에서 변경된 마감을 확인해주세요.');
  assert.equal(buildSmsContent('challenge_deadline_extended', chalData), '[이온토플] 내벨업챌린지 과제 마감이 연장되었습니다. 테스트룸에서 변경된 마감을 확인해주세요.');
});

await test('버튼 없음: hasNoButton 참, 메시지 객체에 btn_url 없음', () => {
  assert.equal(hasNoButton(50246), true);
  assert.equal(hasNoButton(50247), true);
  const m = buildMessageObject('010-0000-0000', 'x', 'y', 'https://z', 50246, corrData);
  assert.equal('btn_url' in m, false);
  assert.equal(m.tel_num, '01000000000');
});

// ===== 핸들러 끝까지(요청 파싱 → 공급사 요청 조립) — 가짜 fetch =====
for (const [type, data, expected, tid] of [
  ['correction_deadline_extended', corrData, CORR_EXPECTED, 50246],
  ['challenge_deadline_extended', chalData, CHAL_EXPECTED, 50247],
]) {
  await test(`핸들러 통과: ${type} → template_id ${tid}, msg_content 원문 일치, btn_url 없음, success`, async () => {
    calls.length = 0;
    const res = await handler(new Request('https://edge.invalid/kakaotalk-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data }) }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const luna = calls.find(c => c.url.includes('jupiter.lunasoft.co.kr'));
    assert.ok(luna, '공급사 요청이 있어야 함');
    assert.equal(luna.body.template_id, tid);
    assert.equal(luna.body.messages.length, 1);
    assert.equal(luna.body.messages[0].msg_content, expected);
    assert.equal('btn_url' in luna.body.messages[0], false);
  });
}

// ===== 무회귀: 기존 케이스(50244·50215·50245) 본문이 운영본과 같은지 — 대표 문구 한 줄씩 =====
await test('무회귀: 기존 케이스 문구 유지 (50244 세션 안내 / 50215 동의 마감 / 50245 프로모션 분석)', () => {
  const d = { name: 'A', session: '2', tasks: 'Discussion + Interview', deadline: '9/9(수) 04:00', time: '6' };
  assert.ok(buildMsgContent('correction_session_reminder', d).includes('오늘은 신청하신 스라첨삭의 2회차 진행일입니다!'));
  assert.ok(buildMsgContent('incentive_deadline_warning', d).includes('요청하신 개별분석의 동의 가능 기간이 6시간 후 에 만료됩니다.'));
  assert.ok(buildMsgContent('incentive_analysis_complete', d).startsWith('[이온토플] 개별분석 결과 안내'));
  assert.equal(TEMPLATE_IDS.correction_session_reminder, 50244);
});

process.stdout.write('\n' + passed + ' passed\n');
