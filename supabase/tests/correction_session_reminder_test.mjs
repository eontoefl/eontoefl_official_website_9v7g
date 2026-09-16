// 50244(스라첨삭 세션 당일 안내) 엣지 함수 연결 검증 — 실발송 없음, 네트워크 없음.
//
// 무엇을 확인하나:
//   1) TEMPLATE_IDS.correction_session_reminder === 50244
//   2) buildMsgContent('correction_session_reminder', …) 출력이 카카오 승인 원문과 "문자 단위"로 같은지
//   3) SMS 대체문 / 버튼 URL(http://testroom.eonfl.com) / 버튼 있음(hasNoButton=false)
//   4) 회귀 — main 브랜치에 이미 있던 모든 type 의 본문·SMS·버튼 출력이 한 글자도 안 바뀌었는지
//
// 실행: node supabase/tests/correction_session_reminder_test.mjs
//   (레포 루트에서 실행. Deno 런타임이 아니라 Node vm 안에서 index.ts 를 그대로 돌린다.
//    fetch 는 가짜라서 공급사 API·DB 로그에 아무것도 나가지 않는다.)
//
// 방식 출처: C:\기능구현\프로모션 살리기\verification\edge_handler_test.mjs

import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REL = 'supabase/functions/kakaotalk-notify/index.ts';

// ── index.ts 를 sandbox 에 올리고 내부 함수들을 꺼낸다 ──
function loadEdge(source) {
  let src = source === 'main'
    ? execFileSync('git', ['show', `main:${REL}`], { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8')
    : readFileSync(path.join(ROOT, REL), 'utf8');

  src = src
    .replace(/^\uFEFF/, '')
    .replace(/^import "@supabase\/functions-js\/edge-runtime.d.ts";\s*$/m, '// [test] type-only import removed');

  const js = stripTypeScriptTypes(src, { mode: 'strip' });

  const NOW = 1789430400000; // 2026-09-15 09:00 KST 고정 (getDeadlineKST 를 쓰는 type 의 재현성 확보)
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Deno: {
      env: {
        get: (k) => ({
          LUNASOFT_USERID: 'test-user',
          LUNASOFT_API_KEY: 'test-key',
          SUPABASE_URL: 'https://db.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        })[k],
      },
      serve: () => {},
    },
    fetch: async () => { throw new Error('이 테스트는 네트워크를 쓰지 않는다'); },
    Request, Response, Headers, JSON, String, Number, Array, Object, Math, Error, Promise,
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: `kakaotalk-notify.${source}.js` });
  // top-level const 는 sandbox 객체의 속성이 아니라 전역 렉시컬 스코프에 들어가므로 식으로 꺼낸다.
  return vm.runInContext(
    '({ TEMPLATE_IDS, buildMsgContent, buildSmsContent, getBtnUrl, hasNoButton, buildMessageObject })',
    sandbox,
  );
}

// ── 카카오 승인 원문 (50244). 한 글자라도 다르면 재검수 대상이므로 여기에 박아둔다. ──
const APPROVED_50244 = [
  '이온토플 - 스라첨삭 세션 안내',
  '',
  '#{name}님, 안녕하세요 :)',
  '',
  '오늘은 신청하신 스라첨삭의 #{session}회차 진행일입니다!',
  '- 과제: #{tasks}',
  '',
  '⏰ 1차 제출 마감: #{deadline}',
  '* 마감 후에는 해당 회차가 소멸되오니, 마감 전까지 테스트룸에서 제출해주세요!',
].join('\n');

// 변수 자리에 변수 표기 자체를 넣으면, 렌더 결과가 곧 승인 원문이어야 한다.
const VAR_ECHO = {
  name: '#{name}',
  session: '#{session}',
  tasks: '#{tasks}',
  deadline: '#{deadline}',
};

// 실제로 SQL 이 넣게 될 값 (변수가 제대로 꽂히는지 확인용)
const VARS = {
  name: '홍길동',
  session: '4',
  tasks: 'Discussion + Interview',
  deadline: '9/17(수) 04:00',
};

const now = loadEdge('worktree');
const before = loadEdge('main');

const fails = [];
const oks = [];
function check(label, actual, expected) {
  if (actual === expected) oks.push(label);
  else fails.push({ label, expected, actual });
}

// ── 1) 템플릿 번호 ──
check('TEMPLATE_IDS.correction_session_reminder = 50244',
  now.TEMPLATE_IDS.correction_session_reminder, 50244);

// ── 2) 본문이 승인 원문과 문자 단위로 같은지 ──
check('buildMsgContent 본문 == 승인 원문 (문자 단위)',
  now.buildMsgContent('correction_session_reminder', { ...VAR_ECHO }), APPROVED_50244);

// 실제 값이 제대로 꽂히는지도 따로 확인 (undefined 가 찍히면 즉시 드러난다)
const rendered = now.buildMsgContent('correction_session_reminder', { ...VARS });
check('본문에 undefined 없음', /undefined/.test(rendered), false);
check('본문 줄 수 9줄', rendered.split('\n').length, 9);
check('본문에 실제 값 4개가 모두 들어감',
  Object.values(VARS).every((v) => rendered.includes(v)), true);

// ── 3) SMS · 버튼 ──
check('SMS 대체문',
  now.buildSmsContent('correction_session_reminder', { ...VARS }),
  '[이온토플] 오늘은 스라첨삭 4회차 진행일입니다. 1차 제출 마감 9/17(수) 04:00. https://testroom.eonfl.com');
check('버튼 URL', now.getBtnUrl('correction_session_reminder', {}), 'http://testroom.eonfl.com');
check('50244 는 버튼 있음', now.hasNoButton(50244), false);

const msgObj = now.buildMessageObject('010-1234-5678', rendered, 'sms', now.getBtnUrl('correction_session_reminder', {}), 50244, {});
check('메시지 객체에 btn_url 포함', JSON.stringify(msgObj.btn_url),
  JSON.stringify([{ url_pc: 'http://testroom.eonfl.com', url_mobile: 'http://testroom.eonfl.com' }]));

// ── 4) 회귀: main 에 이미 있던 type 들의 출력 무변경 ──
const SAMPLE = {
  app_id: 'test-app-id', name: '홍길동', phone: '010-1234-5678', program: '내벨업챌린지 - Fast',
  price: '840,000', start_date: '2026-09-20', end_date: '2026-10-17', deadline: '09월 20일 09:00',
  time: '2', round: '1', week: '1', tracking_number: '000000000000', courier: 'CJ대한통운',
  exam_datetime: '[시험일]', session: '4', tasks: 'Discussion + Interview',
};
const oldTypes = Object.keys(before.TEMPLATE_IDS);
for (const t of oldTypes) {
  check(`[회귀] ${t} template_id`, now.TEMPLATE_IDS[t], before.TEMPLATE_IDS[t]);
  check(`[회귀] ${t} 본문`, now.buildMsgContent(t, { ...SAMPLE }), before.buildMsgContent(t, { ...SAMPLE }));
  check(`[회귀] ${t} SMS`, now.buildSmsContent(t, { ...SAMPLE }), before.buildSmsContent(t, { ...SAMPLE }));
  check(`[회귀] ${t} 버튼URL`, now.getBtnUrl(t, { ...SAMPLE }), before.getBtnUrl(t, { ...SAMPLE }));
  check(`[회귀] ${t} 버튼유무`, now.hasNoButton(now.TEMPLATE_IDS[t]), before.hasNoButton(before.TEMPLATE_IDS[t]));
}
check('[회귀] main 에 없던 type 은 correction_session_reminder 하나뿐',
  Object.keys(now.TEMPLATE_IDS).filter((t) => !oldTypes.includes(t)).join(','),
  'correction_session_reminder');
// 알 수 없는 type 은 여전히 빈 문자열 (기존 default 동작 보존)
check('[회귀] 미등록 type 본문은 빈 문자열', now.buildMsgContent('no_such_type', {}), '');

// ── 결과 ──
console.log(`PASS ${oks.length} / FAIL ${fails.length}`);
for (const f of fails) {
  console.log(`\n✗ ${f.label}\n  기대: ${JSON.stringify(f.expected)}\n  실제: ${JSON.stringify(f.actual)}`);
}
process.exit(fails.length ? 1 : 0);
