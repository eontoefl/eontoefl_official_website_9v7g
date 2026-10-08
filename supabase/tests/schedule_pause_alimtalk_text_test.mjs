// kakaotalk-notify 엣지 함수 — 일시정지 알림톡 3종(50248 / 50249 / 50250) 본문이 카카오 승인 원문과 문자 단위로 같은지,
// 버튼이 안 붙는지, 서버가 보내는 'schedule_resumed'(+target)가 내챌/첨삭 템플릿으로 갈리는지 확인. (2026-10-08)
//  - extension_alimtalk_text_test.mjs 와 같은 방식: 타입 제거 후 vm 실행, Deno/fetch 가짜. 실제 발송 아님.
//  - 실행: node supabase/tests/schedule_pause_alimtalk_text_test.mjs
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
src += '\nglobalThis.__under_test = { TEMPLATE_IDS, buildMsgContent, buildSmsContent, hasNoButton, buildMessageObject, getBtnUrl, resolveType };\n';
const js = stripTypeScriptTypes(src, { mode: 'strip' });

const calls = []; let handler = null;
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Deno: { env: { get: (k) => ({ LUNASOFT_USERID: 'test-user', LUNASOFT_API_KEY: 'test-key', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' })[k] }, serve: (fn) => { handler = fn; } },
  fetch: async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method: opts && opts.method, body });
    if (String(url).includes('lunasoft')) {
      return { json: async () => ({ code: 0, msg: 'OK', messages: (body.messages || []).map(() => ({ result_code: '0', result_msg: '성공' })) }) };
    }
    return { ok: true, status: 201, text: async () => '' };
  },
  Request, Response, Headers, JSON, Date, String, Number, Array, Object, Math, Error, Promise,
};
vm.createContext(sandbox);
vm.runInContext(js, sandbox, { filename: 'kakaotalk-notify.index.js' });
const { TEMPLATE_IDS, buildMsgContent, buildSmsContent, hasNoButton, buildMessageObject, getBtnUrl, resolveType } = sandbox.__under_test;
if (!handler) throw new Error('Deno.serve handler not captured');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };

// 파트너스 센터 승인 원문(2026-10-08) — 변수만 샘플 값으로 치환
const fill = (tpl, v) => tpl.replace(/#\{(\w+)\}/g, (_, k) => v[k]);
const APPROVED = {
  schedule_paused: `이온토플 - 일시정지 안내

#{name}님, 안녕하세요.
#{target} 일시정지가 등록되었습니다.

- 정지 시작일: #{paused_from}
- 재개 예정일: #{resume_on}

정지 기간에는 과제 마감과 알림이 중단됩니다.
재개하면 남은 일정은 정지 기간만큼 뒤로 조정되어 이어집니다.

※ 일시정지는 원칙적으로 불가하며, 입원·수술 등 학습이 불가능한 건강상 사유에 한해 증빙(진단서 등) 확인 후 예외 적용됩니다.`,
  schedule_resumed_challenge: `이온토플 - 내벨업챌린지 재개 안내

#{name}님, 안녕하세요.
일시정지된 내벨업챌린지가 아래 일정으로 다시 시작됩니다.

- 재개일: #{resume_on}
- 변경된 종료일: #{end_date}

남은 일정은 정지 기간만큼 뒤로 조정되었습니다.
재개일부터 테스트룸에서 남은 과제를 이어서 진행해주세요.`,
  schedule_resumed_correction: `이온토플 - 스라첨삭 재개 안내

#{name}님, 안녕하세요.
일시정지된 스라첨삭이 아래 일정으로 다시 시작됩니다.

- 재개일: #{resume_on}
- 변경된 종료일: #{end_date}
- 재개 후 첫 회차: #{next_session}

남은 일정은 정지 기간만큼 뒤로 조정되었습니다.
테스트룸에서 회차별 일정을 확인하고, 재개일부터 첨삭 과정을 이어서 진행해주세요.`,
};
const SMS = {
  schedule_paused: '[이온토플] 일시정지가 등록되었습니다. 정지 중에는 과제 마감과 알림이 멈춥니다.',
  schedule_resumed_challenge: '[이온토플] 내벨업챌린지가 내일 재개됩니다. 테스트룸에서 변경된 일정을 확인해주세요.',
  schedule_resumed_correction: '[이온토플] 스라첨삭이 내일 재개됩니다. 테스트룸에서 첫 회차와 종료일을 확인해주세요.',
};
const V = { name: '홍길동', target: '스라첨삭', paused_from: '10월 4일(일)', resume_on: '10월 11일(일)', end_date: '10월 27일(화)', next_session: '10회차 10월 13일(화)' };

await test('템플릿 번호 50248/50249/50250, 옛 schedule_resumed 키 없음', () => {
  assert.equal(TEMPLATE_IDS.schedule_paused, 50248);
  assert.equal(TEMPLATE_IDS.schedule_resumed_challenge, 50249);
  assert.equal(TEMPLATE_IDS.schedule_resumed_correction, 50250);
  assert.equal(TEMPLATE_IDS.schedule_resumed, undefined);
});
for (const t of Object.keys(APPROVED)) {
  await test(t + ' 본문 == 승인 원문(변수 치환)', () => { assert.equal(buildMsgContent(t, V), fill(APPROVED[t], V)); });
  await test(t + ' 대체문자 == 등록 문구', () => { assert.equal(buildSmsContent(t, V), SMS[t]); });
  await test(t + ' 버튼 없음(hasNoButton, btn_url 미포함)', () => {
    assert.equal(hasNoButton(TEMPLATE_IDS[t]), true);
    const m = buildMessageObject('010-1234-5678', 'x', 'y', getBtnUrl(t, V), TEMPLATE_IDS[t], V);
    assert.equal('btn_url' in m, false);
    assert.equal(m.tel_num, '01012345678');
  });
}
await test('무기한 정지: resume_on "추후 안내" 그대로 들어감', () => {
  assert.ok(buildMsgContent('schedule_paused', { ...V, resume_on: '추후 안내' }).includes('- 재개 예정일: 추후 안내'));
});
await test("resolveType: 'schedule_resumed' + target 스라첨삭 → correction, 내벨업챌린지 → challenge, 그 외 type 그대로", () => {
  assert.equal(resolveType('schedule_resumed', { target: '스라첨삭' }), 'schedule_resumed_correction');
  assert.equal(resolveType('schedule_resumed', { target: '내벨업챌린지' }), 'schedule_resumed_challenge');
  assert.equal(resolveType('schedule_paused', { target: '스라첨삭' }), 'schedule_paused');
  assert.equal(resolveType('correction_session_reminder', {}), 'correction_session_reminder');
});
const post = (body) => handler(new Request('https://fn.invalid/kakaotalk-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
await test("단건: 서버식 호출 {type:'schedule_resumed', target:'스라첨삭'} → template_id 50250, 본문 승인 원문, 버튼 없음", async () => {
  calls.length = 0;
  const res = await post({ type: 'schedule_resumed', data: { ...V, phone: '010-1234-5678', app_id: 'app-1' } });
  const j = await res.json();
  assert.equal(j.success, true);
  const luna = calls.find(c => c.url.includes('lunasoft'));
  assert.equal(luna.body.template_id, 50250);
  assert.equal(luna.body.messages[0].msg_content, fill(APPROVED.schedule_resumed_correction, V));
  assert.equal('btn_url' in luna.body.messages[0], false);
});
await test("단건: {type:'schedule_resumed', target:'내벨업챌린지'} → 50249", async () => {
  calls.length = 0;
  await post({ type: 'schedule_resumed', data: { ...V, target: '내벨업챌린지', next_session: '', phone: '010-1234-5678' } });
  const luna = calls.find(c => c.url.includes('lunasoft'));
  assert.equal(luna.body.template_id, 50249);
  assert.equal(luna.body.messages[0].msg_content, fill(APPROVED.schedule_resumed_challenge, V));
});
await test("단건: {type:'schedule_paused'} → 50248", async () => {
  calls.length = 0;
  await post({ type: 'schedule_paused', data: { ...V, phone: '010-1234-5678' } });
  const luna = calls.find(c => c.url.includes('lunasoft'));
  assert.equal(luna.body.template_id, 50248);
  assert.equal(luna.body.messages[0].sms_content, SMS.schedule_paused);
});
await test('기존 타입(50246 마감 연장) 영향 없음', () => {
  assert.equal(TEMPLATE_IDS.correction_deadline_extended, 50246);
  assert.equal(hasNoButton(50246), true);
  assert.equal(hasNoButton(TEMPLATE_IDS.practice_open), false);
});
// 비동기 테스트는 test()가 동기 카운트라 마지막에 한 번 더 기다린다
await new Promise(r => setTimeout(r, 50));
console.log(`\n${passed} passed`);
