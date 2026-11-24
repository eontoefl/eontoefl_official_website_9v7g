// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-3 (나) 측정 화면 (serve.mjs 가 127.0.0.1 에서 내준다) — 2차 판
//
// 이 화면은 작업방이 실제 Storage·Edge 에 돌려 본 적이 없다(로컬의 가짜 응답으로만 돌려 봤다).
// 보내는 요청: 시험 프로젝트(아래 TEST_URL)의 Storage 읽기와 임시 함수 zz-b2n3-relay 의 GET·HEAD 뿐이다.
//   쓰기·로그인·로그아웃 요청은 보내지 않는다(로그아웃은 측정자가 한다). 서비스 열쇠는 쓰지 않는다.
//   자격은 화면의 메모리에만 두고 결과·저장소에 적지 않는다(결과에는 자격 안의 식별값 sub·session_id·exp 와,
//   종료 뒤 시험에 고정한 자격의 sha256 앞 12자만).
// 고정된 것(계약): PDF.js 3.11.174 · getDocument({ url, httpHeaders }) 만 · D = 공개 키 / R = 회원 자격 · 5회 ·
//   첫 쪽 +1초, 중간·끝 쪽 +0.5초 · 필수 판정 대상 160·68(34 는 참고 — 필수 판정을 바꾸지 않는다) ·
//   종료 뒤 요청은 전부 401/403 이고 본문 0.
// 2차에서 정한 것
//   * "같은 주소로 다시 요청" = 각 회차의 첫 요청 주소를 그 회차에 바로 한 번 다시 연다.
//     회차마다 [D 첫 요청 → D 다시] / [R 첫 요청 → R 다시], D·R 번갈아.
//   * 측정 도중 탭이 숨겨졌거나(visibilitychange) 화면 갱신이 계속 느렸던 회차는 무효 — 판정에서 빼지 않고 다시 재서 5회를 채운다.
//     렌더 중의 일시적인 긴 프레임은 유효(실제 지연)다. 무효 회차가 남은 채 끝나면 표시 시간 판정은 not_decided.
//     화면 갱신과 무관하게 잰 처리 시간을 대신 쓰지 않는다.
//   * 범위 응답: 바이트 대조와 머리글 관측을 나눈다. 필수 크기에서 Content-Range·Content-Length 를 브라우저가 보여 주지 않으면
//     "통과"가 아니라 "머리글 미관측". 범위 없는 GET 을 끝까지 받지 않았으면 그 항목은 미판정 → 전체 not_decided.
//   * 종료 뒤: 401/403 이면서 X-B2n3-Judge 가 not_member 일 때만 "거절 확인". 그 밖은 미확인(무엇이 왔는지 적는다).
//     종료 전 대조군에 쓴 바로 그 자격 글자를 메모리에 고정해 다시 쓴다(입력 칸이 바뀌어도).
// =====================================================================
'use strict';

const REF = 'hmncdheiwqwekdbtijar';
const TEST_URL = 'https://' + REF + '.supabase.co';
const ISSUER = TEST_URL + '/auth/v1';
const FUNCTION_NAME = 'zz-b2n3-relay';
const BUCKET = 'books';
const PDFJS_VERSION = '3.11.174';
const WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; // 뷰어와 같은 worker
const RUNS = 5;
const LIMIT_MS = { first: 1000, mid: 500, last: 500 };
const REQUIRED_DOCS = ['160', '68'];
const REFERENCE_DOCS = ['34'];
const OPEN_TIMEOUT_MS = 300000;
const MIN_SECONDS_LEFT = 120;
const FRAME_SLOW_MEDIAN_MS = 100; // 화면 갱신 간격의 중앙값이 이보다 길면 "계속 느림"(초당 10번 아래)
const LONG_FRAME_MS = 200; // 이보다 긴 한 프레임은 "긴 프레임"으로 센다(일시적이면 유효)
const MAX_INVALID_RETRIES = 3; // 한 회차가 거듭 무효면 멈추고 측정자에게 넘긴다(전송량을 무한히 쓰지 않게)
const ALLOW_SLOW_FRAMES = new URLSearchParams(location.search).get('allow_slow_frames') === '1'; // 도구 점검용: 무효여도 다시 재지 않고 남긴다(판정에 못 쓴다)
const K64 = 65536;
const M1 = 1048576;

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad4 = (n) => String(n).padStart(4, '0');
const round = (x) => (x == null ? null : Math.round(x));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const SESSION = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + Math.random().toString(36).slice(2, 6);

const S = { manifest: null, docs: {}, creds: { anon: null, keep: null, end: null }, credInfo: null, pinnedEnd: null, busy: false, stop: false, resumeWaiter: null, runSeq: 0 };
const RESULT = {
  tool: 'b2n3 measure.js (2차)', session: SESSION, started_at: new Date().toISOString(), target: TEST_URL,
  fixed: { pdfjs: PDFJS_VERSION, worker: WORKER_SRC, runs: RUNS, limit_ms: LIMIT_MS, required_docs: REQUIRED_DOCS, reference_docs: REFERENCE_DOCS, paths: { D: 'storage/v1/object/authenticated/books/<이름> — apikey·Authorization 둘 다 공개 키', R: 'functions/v1/zz-b2n3-relay?doc=…&run=… — apikey 공개 키 + Authorization 회원 자격' } },
  environment: null, marker: null, credentials: null, local_check: null, range_check: null, timing: null, post_logout: null, cache_probe: null,
  // 브라우저에서 볼 수 없는 것 — 측정 뒤 로그에서 세어 사람이 채우는 칸(절차.md 8단계). null 은 "아직 세지 않음"이지 0 이 아니다.
  log_counts: {
    relay_from_function_log: { requests: null, bytes: null, preflight_options: null, how: '함수 zz-b2n3-relay 의 로그에서 run=<세션>- 으로 걸러 센다. 사전 요청은 m=OPTIONS 줄' },
    direct_from_storage_log: { requests: null, bytes: null, preflight_options: null, how: '브라우저에서 관측 불가. Storage 로그에서 run 값으로 센다 — run 을 식별할 수 없으면 0 이 아니라 미확인' },
  },
  verdict: null,
  notes: [
    '표시 시간은 PDF.js 가 실제로 그린 시간이다(요청 순서만 재생한 전송 시험이 아니다).',
    'run 값을 바꿨다는 것만으로 캐시를 피했다고 보지 않는다 — resource(Resource Timing)와 cache_probe 를 함께 볼 것.',
    '브라우저에서 볼 수 없는 값은 null 과 "브라우저에서 관측 불가"로 적었다. 요청 수·전송량·사전 요청 수는 로그에서 센다(log_counts).',
  ],
};
window.B2N3 = { S, RESULT };

function log(msg) { const el = $('log'); el.textContent += `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`; el.scrollTop = el.scrollHeight; }
function status(msg) { $('status').textContent = msg; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function table(head, rows) {
  return '<table><tr>' + head.map((h) => `<th class="l">${esc(h)}</th>`).join('') + '</tr>' + rows.map((r) => '<tr>' + r.map((c) => (c && c.html ? `<td class="${c.cls || ''}">${c.html}</td>` : `<td class="${typeof c === 'number' ? '' : 'l'}">${esc(c ?? '')}</td>`)).join('') + '</tr>').join('') + '</table>';
}
const cell = (text, cls) => ({ html: esc(text), cls: cls + ' l' });
const mark = (ok) => (ok === true ? cell('맞음', 'ok') : ok === false ? cell('어긋남', 'bad') : cell('관측 불가·안 함', 'unk'));
const KO = { pass: '통과', fail: '통과 아님', not_decided: '판정 못 함', not_run: '안 함', unverified: '미확인', headers_not_observed: '머리글 미관측' };
const resultCell = (r) => cell(KO[r] ?? r, r === 'pass' ? 'ok' : r === 'fail' ? 'bad' : 'unk');

// ---------------------------------------------------------------------
// 자격: 모양만 읽는다(서명은 확인하지 못한다). 시험 프로젝트의 것이 아니면 어떤 요청도 보내지 않는다.
function jwtPayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))));
  } catch (e) { return null; }
}
const secondsLeft = (token) => { const p = jwtPayload(token); return p && p.exp ? Math.floor(p.exp - Date.now() / 1000) : -1; };

function readCreds() {
  const anon = $('in-anon').value.trim();
  const keep = $('in-keep').value.trim();
  const end = $('in-end').value.trim();
  const problems = [];
  const a = jwtPayload(anon);
  if (!anon) problems.push('공개 키가 없다');
  else if (a) { if (a.ref !== REF) problems.push('공개 키의 ref 가 시험 프로젝트가 아니다'); if (a.role !== 'anon') problems.push('공개 키의 role 이 anon 이 아니다'); }
  const one = (label, tok, need) => {
    if (!tok) { if (need) problems.push(`${label} 자격이 없다`); return null; }
    const p = jwtPayload(tok);
    if (!p) { problems.push(`${label}: 자격의 모양이 아니다`); return null; }
    if (p.iss !== ISSUER) problems.push(`${label}: 발급자가 시험 프로젝트가 아니다`);
    if (p.role !== 'authenticated') problems.push(`${label}: 로그인 자격이 아니다`);
    if (!p.sub || !p.session_id) problems.push(`${label}: sub·session_id 가 없다`);
    return { sub: p.sub, session_id: p.session_id, aal: p.aal ?? null, exp: p.exp, seconds_left: secondsLeft(tok) };
  };
  const k = one('끝내지 않는 로그인', keep, true);
  const e = one('끝낼 로그인', end, false);
  if (k && e) {
    if (k.sub !== e.sub) problems.push('두 자격이 같은 회원의 것이 아니다');
    if (k.session_id === e.session_id) problems.push('두 자격이 같은 로그인 기록이다(서로 다른 로그인에서 받을 것)');
  }
  if (k && k.seconds_left < MIN_SECONDS_LEFT) problems.push('끝내지 않는 로그인의 자격이 곧 만료된다');
  const info = { anon: a ? { role: a.role, ref: a.ref } : { note: 'jwt 모양이 아님: 열쇠에서 ref 를 확인하지 못함(주소로만 확인)' }, keep: k, end: e, problems };
  if (!problems.length) { S.creds = { anon, keep, end: end || null }; S.credInfo = info; RESULT.credentials = { anon: info.anon, keep: k, end: e, note: 'sub·session_id 는 식별값이다(자격이 아니다)' }; }
  $('creds').innerHTML = problems.length ? `<span class="bad">${esc(problems.join(' / '))}</span>` : `<span class="ok">확인함</span> — 회원 계정 ${esc(k.sub)} · 끝내지 않는 로그인 ${esc(k.session_id)}(남은 ${k.seconds_left}초)` + (e ? ` · 끝낼 로그인 ${esc(e.session_id)}(남은 ${e.seconds_left}초)` : ' · 끝낼 로그인 없음(종료 뒤 시험은 못 한다)');
  return !problems.length;
}
function needCreds() { if (!readCreds()) { status('멈춤: 자격 확인에서 어긋남 — 아무 요청도 보내지 않았다'); return false; } return true; }
const hD = () => ({ apikey: S.creds.anon, Authorization: 'Bearer ' + S.creds.anon });
const hR = (tok) => ({ apikey: S.creds.anon, Authorization: 'Bearer ' + tok });
const urlD = (doc, run) => `${TEST_URL}/storage/v1/object/authenticated/${BUCKET}/${S.docs[doc].object_name}?run=${run}`;
const urlR = (doc, run) => `${TEST_URL}/functions/v1/${FUNCTION_NAME}?doc=${doc}&run=${run}`;
const newRun = (tag) => `${SESSION}-${tag}-${(++S.runSeq).toString(36)}`;
const selectedDocs = () => [...document.querySelectorAll('input.doc:checked')].map((x) => x.value).filter((d) => S.docs[d]);

// ---------------------------------------------------------------------
// 요청 하나. cap 이 있으면 그만큼 받고 끊는다(전송량을 아끼려는 것 — 결과에 그렇게 적힌다).
async function request(url, { method = 'GET', headers = {}, cap = null, timeoutMs = 60000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = now();
  const rec = { method, range: headers.Range ?? null, status: 0 };
  let bytes = new Uint8Array(0);
  try {
    const res = await fetch(url, { method, headers, signal: ctl.signal });
    const h = (n) => res.headers.get(n);
    rec.status = res.status;
    rec.headers = { content_range: h('content-range'), content_length: h('content-length'), accept_ranges: h('accept-ranges'), content_type: h('content-type'), cache_control: h('cache-control'), cf_cache_status: h('cf-cache-status'), age: h('age'), etag: h('etag'), judge: h('x-b2n3-judge') };
    rec.headers_note = '교차 출처 응답이라 서버가 노출한 머리글만 보인다. null 은 "없음"이 아니라 "브라우저에서 관측 불가"일 수 있다';
    let total = 0;
    let cut = false;
    if (method !== 'HEAD' && res.body) {
      const reader = res.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (cap != null && total >= cap) { cut = true; await reader.cancel(); break; }
      }
      bytes = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { bytes.set(c, o); o += c.length; }
    }
    rec.received_bytes = total;
    rec.cut_by_tool_at = cut ? cap : null;
  } catch (e) {
    rec.error = ctl.signal.aborted ? `시간 초과(${timeoutMs}ms)` : String(e && e.message ? e.message : e);
    rec.error_note = '네트워크·CORS 오류는 브라우저가 구분해 주지 않는다';
  } finally { clearTimeout(timer); }
  rec.ms = round(now() - t0);
  return { rec, bytes };
}
async function localBytes(doc, start, end) {
  const res = await fetch(`/local/origin/${doc}.pdf`, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`로컬 원본 구간을 읽지 못했다(${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
function sameBytes(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
async function sha256Hex(u8) { const d = await crypto.subtle.digest('SHA-256', u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

// ---------------------------------------------------------------------
// 화면 갱신 간격. PDF.js 는 그릴 때 requestAnimationFrame 을 쓴다 — 탭이 뒤에 있으면 그 간격이 초 단위로 늘어
// 표시 시간이 뭉개진다(작업방의 점검에서, 자동화 도구가 뒤에서 연 탭은 "보임"으로 보고하면서도 간격이 1초였다).
// 그래서 visibilityState 만 믿지 않고 간격을 직접 잰다.
async function frameGaps(n = 3) {
  const gaps = [];
  let last = now();
  for (let i = 0; i < n; i++) { await new Promise((r) => requestAnimationFrame(r)); const t = now(); gaps.push(round(t - last)); last = t; }
  return gaps;
}
async function frameProbe() {
  const gaps = await Promise.race([frameGaps(), sleep(4000).then(() => null)]);
  return { gaps, ok: !!gaps && median(gaps) <= FRAME_SLOW_MEDIAN_MS && !document.hidden };
}
async function waitForFrames() {
  for (;;) {
    const p = await frameProbe();
    if (p.ok || ALLOW_SLOW_FRAMES || S.stop) return p;
    status('멈춤: 화면 갱신이 느리거나 탭이 숨겨져 있다 — 이 창을 실제로 맨 앞에 보이게 두면 이어서 잰다');
    await sleep(1000);
  }
}

// PDF.js: 지금 두 뷰어와 같은 설정 — getDocument 에 주소와 머리글만.
function viewerBox() { const v = $('viewer'); return { w: v.clientWidth, h: v.clientHeight }; }
async function renderPage(pdf, n) {
  const page = await pdf.getPage(n);
  const canvas = $('pdf-canvas');
  const ctx = canvas.getContext('2d');
  const viewport0 = page.getViewport({ scale: 1 });
  const box = viewerBox();
  const fitScale = Math.min((box.w - 60) / viewport0.width, (box.h - 60) / viewport0.height); // 뷰어와 같은 식(padding 30px × 2)
  const viewport = page.getViewport({ scale: fitScale * 1.0 });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return page;
}
async function pageTextOk(page, doc, n, total) {
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join(' ');
  return text.includes(`B2N3 ${S.manifest.marker} DOC ${doc}`) && text.includes(`PAGE ${pad4(n)} OF ${pad4(total)}`);
}
function resourceSummary(url) {
  const abs = new URL(url, location.href).href;
  const entries = performance.getEntriesByType('resource').filter((e) => e.name === abs);
  const sizesVisible = entries.some((e) => e.transferSize > 0 || e.encodedBodySize > 0);
  const statuses = [...new Set(entries.map((e) => e.responseStatus).filter((x) => x))];
  const delivery = [...new Set(entries.map((e) => e.deliveryType).filter((x) => x !== undefined))];
  return {
    requests_seen: entries.length, // 사전 요청(OPTIONS)은 여기 보이지 않는다
    preflight_options: '브라우저에서 관측 불가',
    transfer_bytes: sizesVisible ? entries.reduce((a, e) => a + (e.transferSize || 0), 0) : null,
    body_bytes: sizesVisible ? entries.reduce((a, e) => a + (e.encodedBodySize || 0), 0) : null,
    sizes: sizesVisible ? '브라우저가 보여 줌' : '브라우저에서 관측 불가(교차 출처 응답에 Timing-Allow-Origin 이 없으면 0 으로 보인다)',
    zero_transfer_entries: sizesVisible ? entries.filter((e) => e.transferSize === 0).length : null,
    response_statuses: statuses.length ? statuses : null,
    delivery_types: delivery.length ? delivery : null, // 'cache' 가 있으면 브라우저 캐시에서 온 것(지원하는 브라우저만)
    from_browser_cache: delivery.includes('cache') ? true : sizesVisible ? (entries.every((e) => e.transferSize > 0) ? false : null) : null,
  };
}
// 한 번의 측정: 첫 쪽 = 문서 열기 시작 → 1쪽 렌더 완료 / 중간·끝 쪽 = 이미 열린 그 문서에서 이동 시작 → 렌더 완료.
// 측정 구간(열기 시작 ~ 끝 쪽 렌더 완료) 안의 화면 상태를 함께 적고, 그것으로 이 측정이 유효한지 정한다.
async function measureOpen(doc, url, httpHeaders, { waitFrames = true } = {}) {
  const d = S.docs[doc];
  const mid = Math.ceil(d.pages / 2);
  const rec = { url_run: new URL(url, location.href).searchParams.get('run'), started_at: new Date().toISOString(), ok: false, ms: { open: null, first: null, mid: null, last: null }, pages_measured: { first: 1, mid, last: d.pages } };
  const probeBefore = waitFrames ? await waitForFrames() : await frameProbe(); // "바로 다시"는 기다리지 않는다(기다리면 "바로"가 아니다)
  let hidden = document.hidden;
  const onVisibility = () => { if (document.hidden) hidden = true; };
  document.addEventListener('visibilitychange', onVisibility);
  const gaps = [];
  let frameOn = true;
  let frameLast = now();
  const frameLoop = () => { const t = now(); gaps.push(round(t - frameLast)); frameLast = t; if (frameOn) requestAnimationFrame(frameLoop); };
  requestAnimationFrame(frameLoop);
  performance.clearResourceTimings();
  let task = null;
  let progress = { loaded: null, total: null };
  const tStart = now();
  const work = (async () => {
    const t0 = now();
    task = pdfjsLib.getDocument({ url, httpHeaders });
    task.onProgress = (p) => { progress = { loaded: p.loaded, total: p.total }; };
    const pdf = await task.promise;
    rec.ms.open = round(now() - t0);
    const p1 = await renderPage(pdf, 1);
    rec.ms.first = round(now() - t0);
    rec.num_pages = pdf.numPages;
    const t1 = now();
    const pm = await renderPage(pdf, mid);
    rec.ms.mid = round(now() - t1);
    const t2 = now();
    const pl = await renderPage(pdf, d.pages <= pdf.numPages ? d.pages : pdf.numPages);
    rec.ms.last = round(now() - t2);
    rec.measured_ms = round(now() - t0);
    frameOn = false; // 측정 구간 끝 — 아래의 글자 확인은 구간 밖이다
    if (document.hidden) hidden = true;
    document.removeEventListener('visibilitychange', onVisibility);
    rec.text_ok = { first: await pageTextOk(p1, doc, 1, d.pages), mid: await pageTextOk(pm, doc, mid, d.pages), last: await pageTextOk(pl, doc, d.pages, d.pages) };
    if (pdf.numPages !== d.pages) throw new Error(`쪽수가 ${pdf.numPages} — ${d.pages} 가 아니다`);
    if (!rec.text_ok.first || !rec.text_ok.mid || !rec.text_ok.last) throw new Error('그려진 쪽의 글자(쪽 번호·표식)가 맞지 않다');
    rec.ok = true;
  })();
  let timer;
  try {
    await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`시간 초과(${OPEN_TIMEOUT_MS}ms)`)), OPEN_TIMEOUT_MS); })]);
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e).slice(0, 300);
    if (e && e.status !== undefined) rec.error_status = e.status;
  } finally {
    clearTimeout(timer);
    const duration = rec.measured_ms ?? now() - tStart; // 측정 구간의 길이(실패했으면 실패할 때까지)
    frameOn = false;
    if (document.hidden) hidden = true;
    document.removeEventListener('visibilitychange', onVisibility);
    const probeAfter = await frameProbe();
    const med = median(gaps);
    const longFrames = gaps.filter((g) => g > LONG_FRAME_MS).length;
    // "계속 느림": 간격의 중앙값이 길거나, 1초 넘게 재는 동안 프레임이 초당 4번도 안 왔다
    const sustained = (gaps.length >= 5 && med > FRAME_SLOW_MEDIAN_MS) || (duration >= 1000 && gaps.length < duration / 250);
    const reasons = [];
    if (hidden) reasons.push('hidden_during_measurement');
    if (!probeBefore.ok) reasons.push('slow_frames_before');
    if (sustained) reasons.push('sustained_slow_frames_during');
    if (!probeAfter.ok) reasons.push('slow_frames_after');
    rec.frames = { before: probeBefore.gaps, after: probeAfter.gaps, count_during: gaps.length, median_gap_during_ms: med, max_gap_during_ms: gaps.length ? Math.max(...gaps) : null, long_frames_over_200ms: longFrames, visibility_at_end: document.visibilityState };
    rec.validity = {
      valid: reasons.length === 0, reasons,
      transient_long_frames: reasons.length === 0 ? longFrames : null, // 유효한 측정 안의 긴 프레임 — 실제 지연으로 센다
      rule: '무효 = 측정 구간 안에서 숨김이 잡혔거나, 화면 갱신이 계속 느렸다(앞·뒤 점검의 중앙값 > 100ms, 구간 안 중앙값 > 100ms 또는 초당 4번 미만). 일시적인 긴 프레임은 유효',
    };
    rec.pdfjs_progress = progress; // PDF.js 가 센 받은 바이트(전송량의 어림 — 로그가 정본이다)
    rec.resource = resourceSummary(url);
    try { if (task) await task.destroy(); } catch (e) { /* 닫기 실패는 측정값에 넣지 않는다 */ }
  }
  return rec;
}

// ---------------------------------------------------------------------
// 1. 로컬 원본 열기 확인 (Supabase 요청 0)
async function runLocal() {
  const out = [];
  for (const doc of selectedDocs()) {
    status(`로컬 원본 확인: doc ${doc}`);
    const r = await measureOpen(doc, `/local/origin/${doc}.pdf?run=${newRun('local')}`, {});
    out.push({ doc, ...r });
    log(`로컬 원본 doc ${doc}: ${r.ok ? '열림' : '실패 — ' + r.error} (첫 쪽 ${r.ms.first}ms, 중간 ${r.ms.mid}ms, 끝 ${r.ms.last}ms${r.validity.valid ? '' : ' · 화면 상태 무효: ' + r.validity.reasons.join(',')})`);
  }
  RESULT.local_check = { note: '로컬 서버의 원본을 같은 PDF.js 설정으로 연 것이다(Supabase 요청 0). 합성 PDF 가 올바른지와 쪽 글자만 본다(시간은 판정에 쓰지 않는다).', docs: out, all_ok: out.length > 0 && out.every((x) => x.ok) };
  $('out-local').innerHTML = table(['doc', '열림', '쪽수', '첫 쪽 ms', '중간 ms', '끝 ms', '화면 상태', '오류'], out.map((x) => [x.doc, mark(x.ok), x.num_pages ?? '', x.ms.first, x.ms.mid, x.ms.last, x.validity.valid ? '앞에 보임' : '무효: ' + x.validity.reasons.join(','), x.error ?? '']));
}

// ---------------------------------------------------------------------
// 2. 범위 응답 대조 — 바이트 대조와 머리글 관측을 나눠 적는다
function rangeList(size) {
  const mid = Math.floor(size / 2);
  return [
    { where: '앞', start: 0, end: K64 - 1 }, { where: '앞', start: 0, end: M1 - 1 },
    { where: '중간', start: mid, end: mid + K64 - 1 }, { where: '중간', start: mid, end: mid + M1 - 1 },
    { where: '끝', start: size - K64, end: size - 1 }, { where: '끝', start: size - M1, end: size - 1 },
    { where: '끝(마지막 1바이트)', start: size - 1, end: size - 1 },
    { where: '끝(열린 범위)', start: size - 1024, end: size - 1, open: true },
  ];
}
async function rangeOne(doc, url, headers, g) {
  const size = S.docs[doc].bytes;
  const rangeHeader = g.open ? `bytes=${g.start}-` : `bytes=${g.start}-${g.end}`;
  const { rec, bytes } = await request(url, { headers: { ...headers, Range: rangeHeader } });
  const want = await localBytes(doc, g.start, g.end);
  rec.where = g.where;
  rec.status_ok = rec.status === 206;
  rec.bytes_equal = !rec.error && sameBytes(bytes, want);
  rec.bytes_ok = rec.status_ok && rec.bytes_equal; // 바이트 대조(머리글과 따로)
  // 머리글: true = 보였고 맞음 / false = 보였는데 틀림 / null = 브라우저에서 관측 불가
  rec.content_range_ok = rec.headers && rec.headers.content_range != null ? rec.headers.content_range === `bytes ${g.start}-${g.end}/${size}` : null;
  rec.content_length_ok = rec.headers && rec.headers.content_length != null ? Number(rec.headers.content_length) === want.length : null;
  rec.headers_state = rec.content_range_ok === false || rec.content_length_ok === false ? 'wrong' : rec.content_range_ok === null || rec.content_length_ok === null ? 'not_observed' : 'observed_ok';
  return rec;
}
async function rangeCheckPath(doc, path, full) {
  const d = S.docs[doc];
  const mk = (tag) => (path === 'D' ? urlD(doc, newRun(`rg${doc}D${tag}`)) : urlR(doc, newRun(`rg${doc}R${tag}`)));
  const headers = path === 'D' ? hD() : hR(S.creds.keep);
  const out = { ranges: [], head: null, full_get: null };
  for (const g of rangeList(d.bytes)) out.ranges.push(await rangeOne(doc, mk('r'), headers, g));
  const head = (await request(mk('h'), { method: 'HEAD', headers })).rec;
  head.status_ok = head.status === 200;
  head.content_length_ok = head.headers && head.headers.content_length != null ? Number(head.headers.content_length) === d.bytes : null;
  out.head = head;
  if (full) {
    status(`범위 응답 대조: doc ${doc} ${path} — 범위 없는 GET 전체 받는 중(${Math.round(d.bytes / M1)}MiB)`);
    const { rec, bytes } = await request(mk('f'), { headers, timeoutMs: 900000 });
    rec.status_ok = rec.status === 200;
    rec.length_ok = rec.received_bytes === d.bytes;
    rec.sha256_ok = rec.length_ok ? (await sha256Hex(bytes)) === d.sha256 : false;
    rec.ok = rec.status_ok && rec.length_ok && rec.sha256_ok;
    out.full_get = rec;
  } else out.full_get = { skipped: true, note: '하지 않음 — 범위 없는 GET 의 길이·내용은 미판정이다' };
  out.accept_ranges_visible = out.ranges.some((r) => r.headers && r.headers.accept_ranges != null) || !!(head.headers && head.headers.accept_ranges != null);
  // 집계: 바이트 / 머리글 / 범위 없는 GET 을 나눈다
  out.bytes = { errors: out.ranges.filter((r) => !r.bytes_ok).length + (head.status_ok ? 0 : 1), result: null };
  out.bytes.result = out.bytes.errors === 0 ? 'pass' : 'fail';
  const wrong = out.ranges.filter((r) => r.headers_state === 'wrong').length + (head.content_length_ok === false ? 1 : 0);
  const unseen = out.ranges.filter((r) => r.headers_state === 'not_observed').length + (head.content_length_ok === null && head.status_ok ? 1 : 0);
  out.headers = { wrong, not_observed: unseen, result: wrong > 0 ? 'wrong' : unseen > 0 ? 'not_observed' : 'observed_ok' };
  out.full = { result: out.full_get.skipped ? 'not_done' : out.full_get.ok ? 'done_ok' : 'mismatch' };
  return out;
}
async function runRange() {
  if (!needCreds()) return;
  const full = $('opt-full').checked;
  const res = { note: '받은 바이트를 로컬 합성 원본의 같은 구간과 바이트로 견줬다. 바이트 대조(bytes)·머리글 관측(headers)·범위 없는 GET(full)을 나눠 적는다. 범위 응답의 정확성은 표시 시간과 따로 본다.', full_get_done: full, docs: {} };
  for (const doc of selectedDocs()) {
    res.docs[doc] = {};
    for (const path of ['D', 'R']) {
      status(`범위 응답 대조: doc ${doc} ${path}`);
      const x = res.docs[doc][path] = await rangeCheckPath(doc, path, full);
      log(`범위 응답 doc ${doc} ${path}: 바이트 ${x.bytes.result} · 머리글 ${x.headers.result} · 범위 없는 GET ${x.full.result}`);
    }
    // 별도 진단: 직접 경로 + 회원 자격(성능 비교에 넣지 않는다)
    const dm = await request(urlD(doc, newRun(`rg${doc}DM`)), { headers: { ...hR(S.creds.keep), Range: `bytes=0-${K64 - 1}` } });
    res.docs[doc].diagnostic_d_with_member = { note: '직접 경로 + 회원 자격(별도 진단). 시험 프로젝트의 books 에는 로그인 역할 읽기 규칙이 없어 거절일 수 있다', ...dm.rec };
  }
  RESULT.range_check = res;
  const rows = [];
  for (const doc of selectedDocs()) for (const path of ['D', 'R']) {
    const x = res.docs[doc][path];
    const hs = x.headers.result;
    rows.push([doc + (REQUIRED_DOCS.includes(doc) ? '' : '(참고)'), path, `${x.ranges.filter((r) => r.bytes_ok).length}/${x.ranges.length}`, hs === 'observed_ok' ? cell('보였고 맞음', 'ok') : hs === 'wrong' ? cell(`어긋남 ${x.headers.wrong}`, 'bad') : cell(`미관측 ${x.headers.not_observed}`, 'unk'), `${x.head.status}`, x.full_get.skipped ? cell('안 함(미판정)', 'unk') : cell(`${x.full_get.status} · ${x.full_get.received_bytes}바이트 · ${x.full_get.ok ? '일치' : '어긋남'}`, x.full_get.ok ? 'ok' : 'bad'), x.accept_ranges_visible ? '보임' : '관측 불가']);
  }
  $('out-range').innerHTML = table(['doc', '경로', '구간 바이트 일치', 'Content-Range·Length', 'HEAD', '범위 없는 GET', 'Accept-Ranges'], rows) + '<div class="note">직접+회원 진단: ' + selectedDocs().map((doc) => `doc ${doc} → ${res.docs[doc].diagnostic_d_with_member.status || res.docs[doc].diagnostic_d_with_member.error}`).join(' · ') + '</div>';
  renderVerdict();
}
function rangeVerdict(docs) {
  const rc = RESULT.range_check;
  if (!rc || !docs.every((d) => rc.docs[d])) return { result: 'not_run', reasons: ['범위 응답 대조를 하지 않았다'] };
  const parts = [];
  for (const d of docs) for (const p of ['D', 'R']) parts.push({ doc: d, path: p, bytes: rc.docs[d][p].bytes.result, headers: rc.docs[d][p].headers.result, full: rc.docs[d][p].full.result });
  const errors = parts.filter((x) => x.bytes === 'fail' || x.headers === 'wrong' || x.full === 'mismatch');
  const notDone = parts.filter((x) => x.full === 'not_done');
  const unseen = parts.filter((x) => x.headers === 'not_observed');
  const reasons = [];
  for (const x of errors) reasons.push(`doc ${x.doc} ${x.path}: 잘못된 범위·바이트(바이트 ${x.bytes} · 머리글 ${x.headers} · 범위 없는 GET ${x.full})`);
  if (notDone.length) reasons.push(`범위 없는 GET 을 끝까지 받지 않았다(미판정): ${notDone.map((x) => `doc ${x.doc} ${x.path}`).join(', ')}`);
  if (unseen.length) reasons.push(`범위 머리글 미관측(브라우저가 Content-Range·Content-Length 를 보여 주지 않았다 — 바이트 대조와 따로): ${unseen.map((x) => `doc ${x.doc} ${x.path}`).join(', ')}`);
  return {
    result: errors.length ? 'fail' : notDone.length ? 'not_decided' : unseen.length ? 'headers_not_observed' : 'pass',
    bytes: parts.every((x) => x.bytes === 'pass') ? 'pass' : 'fail',
    headers: parts.some((x) => x.headers === 'wrong') ? 'wrong' : unseen.length ? 'not_observed' : 'observed_ok',
    full_get: parts.some((x) => x.full === 'mismatch') ? 'mismatch' : notDone.length ? 'not_done' : 'done_ok',
    parts, reasons,
  };
}

// ---------------------------------------------------------------------
// 3. 표시 시간 측정
async function waitForFreshCredential() {
  while (secondsLeft(S.creds.keep) < MIN_SECONDS_LEFT) {
    status('멈춤: 끝내지 않는 로그인의 자격이 곧 만료된다 — 같은 로그인으로 새 자격을 받아 넣고 "이어 하기"를 누를 것');
    $('btn-resume').disabled = false;
    await new Promise((r) => { S.resumeWaiter = r; });
    $('btn-resume').disabled = true;
    const before = S.credInfo.keep.session_id;
    if (!readCreds()) continue;
    if (S.credInfo.keep.session_id !== before) log('주의: 새 자격의 로그인 기록이 앞의 것과 다르다(결과의 credentials 에 새 값이 적힌다)');
  }
}
async function runTiming() {
  if (!needCreds()) return;
  if (pdfjsLib.version !== PDFJS_VERSION) { status(`멈춤: PDF.js 가 ${pdfjsLib.version} — ${PDFJS_VERSION} 이 아니다`); return; }
  S.stop = false;
  const T = RESULT.timing = RESULT.timing || {
    note: '회차 = [첫 요청(주소에 새 run 값) → 같은 주소를 바로 한 번 다시]. 크기마다 5회차, 회차마다 D 묶음 다음 R 묶음. 두 열기 유형(first·again)은 합치지 않는다.',
    invalid_note: '화면이 숨겨졌거나 화면 갱신이 계속 느렸던 묶음은 invalid_runs 로 옮기고 그 회차를 새 주소로 다시 잰다(판정에서 빼는 것이 아니라 5회를 채운다).',
    runs: [], invalid_runs: [],
  };
  const order = [];
  for (const doc of selectedDocs()) for (let i = 1; i <= RUNS; i++) for (const path of ['D', 'R']) order.push({ doc, i, path });
  let n = 0;
  for (const o of order) {
    n++;
    const same = (r) => r.doc === o.doc && r.path === o.path && r.iteration === o.i;
    if (!ALLOW_SLOW_FRAMES) { // 점검용으로 남겨 둔 무효 묶음이 있으면 버리고 다시 잰다
      const stale = T.runs.filter((r) => same(r) && r.pair_invalid);
      if (stale.length) { T.invalid_runs.push(...stale); T.runs = T.runs.filter((r) => !(same(r) && r.pair_invalid)); }
    }
    if (T.runs.filter(same).length === 2) continue; // 이미 잰 회차(이어 하기)
    let retries = 0;
    for (;;) {
      if (S.stop) { status('멈춤: 측정자가 멈췄다 — 다시 누르면 남은 회차부터 잰다'); renderVerdict(); return; }
      await waitForFreshCredential();
      const url = o.path === 'D' ? urlD(o.doc, newRun(`t${o.doc}D`)) : urlR(o.doc, newRun(`t${o.doc}R`));
      const headers = () => (o.path === 'D' ? hD() : hR(S.creds.keep));
      const where = `${n}/${order.length}: doc ${o.doc} · ${o.i}/${RUNS}회차 · ${o.path}`;
      status(`표시 시간 측정 ${where} · 첫 요청`);
      const first = await measureOpen(o.doc, url, headers(), { waitFrames: true });
      status(`표시 시간 측정 ${where} · 같은 주소 바로 다시`);
      const again = await measureOpen(o.doc, url, headers(), { waitFrames: false });
      const valid = first.validity.valid && again.validity.valid;
      const base = { doc: o.doc, path: o.path, iteration: o.i, url, attempt: T.invalid_runs.filter((r) => same(r) && r.open_type === 'first').length + 1 };
      const recs = [{ ...base, open_type: 'first', ...first }, { ...base, open_type: 'again', ...again }];
      const text = (r) => (r.ok ? `첫 쪽 ${r.ms.first}ms · 중간 ${r.ms.mid}ms · 끝 ${r.ms.last}ms · 요청 ${r.resource.requests_seen}건` : '실패 — ' + r.error);
      if (valid || ALLOW_SLOW_FRAMES) {
        for (const r of recs) { if (!valid) r.pair_invalid = true; T.runs.push(r); }
        log(`doc ${o.doc} #${o.i} ${o.path}${valid ? '' : ' [무효 — 점검용으로 남김]'} 첫 요청: ${text(first)} / 다시: ${text(again)}`);
        break;
      }
      const why = [...new Set([...first.validity.reasons, ...again.validity.reasons])].join(',');
      T.invalid_runs.push(...recs.map((r) => ({ ...r, pair_invalid: true })));
      retries++;
      log(`doc ${o.doc} #${o.i} ${o.path}: 무효(${why}) — 이 회차를 다시 잰다(${retries}/${MAX_INVALID_RETRIES})`);
      if (retries >= MAX_INVALID_RETRIES) {
        status('멈춤: 같은 회차가 거듭 무효다 — 이 창을 실제로 맨 앞에 보이는 전용 창으로 둔 뒤 "표시 시간 측정 시작"을 다시 누를 것. 그 전에는 표시 시간을 판정할 수 없다');
        renderVerdict();
        autoSave();
        return;
      }
    }
    renderTiming();
    await sleep(300);
  }
  status('표시 시간 측정 끝');
  renderVerdict();
  autoSave();
}
function timingSummary(docs) {
  const T = RESULT.timing;
  const rows = [];
  if (!T) return rows;
  for (const doc of docs) {
    if (!T.runs.some((r) => r.doc === doc)) continue;
    for (const type of ['first', 'again']) for (const page of ['first', 'mid', 'last']) {
      const pick = (path) => T.runs.filter((r) => r.doc === doc && r.open_type === type && r.path === path && !r.pair_invalid);
      const side = (path) => {
        const all = pick(path);
        const v = all.filter((r) => r.ok).map((r) => r.ms[page]);
        return { n_valid: all.length, n_ok: v.length, n_fail: all.length - v.length, values: v, median: median(v), max: v.length ? Math.max(...v) : null, transient_long_frames: all.reduce((a, r) => a + (r.validity.transient_long_frames || 0), 0) };
      };
      const d = side('D');
      const r = side('R');
      const complete = d.n_valid === RUNS && r.n_valid === RUNS;
      rows.push({
        doc, open_type: type, page, required_for_verdict: REQUIRED_DOCS.includes(doc), d, r,
        diff_median_ms: d.median != null && r.median != null ? r.median - d.median : null, limit_ms: LIMIT_MS[page], complete,
        ok: complete && d.median != null && r.median != null ? r.median - d.median <= LIMIT_MS[page] : null,
        pdfjs_loaded_bytes: { D: pick('D').reduce((a, x) => a + ((x.pdfjs_progress && x.pdfjs_progress.loaded) || 0), 0), R: pick('R').reduce((a, x) => a + ((x.pdfjs_progress && x.pdfjs_progress.loaded) || 0), 0), note: 'PDF.js 가 센 받은 바이트의 합(어림). 전송량의 정본은 로그다' },
        from_browser_cache: { D: [...new Set(pick('D').map((x) => String(x.resource.from_browser_cache)))], R: [...new Set(pick('R').map((x) => String(x.resource.from_browser_cache)))] },
      });
    }
  }
  return rows;
}
function timingVerdict(docs) {
  const T = RESULT.timing;
  const rows = timingSummary(docs);
  const runs = T ? T.runs.filter((r) => docs.includes(r.doc)) : [];
  const displayFailures = runs.filter((r) => !r.pair_invalid && !r.ok).length;
  const invalidRemaining = runs.filter((r) => r.pair_invalid).length;
  const remeasured = T ? T.invalid_runs.filter((r) => docs.includes(r.doc)).length : 0;
  const complete = rows.length === docs.length * 6 && rows.every((x) => x.complete);
  const slow = rows.filter((x) => x.ok === false);
  const reasons = [];
  if (displayFailures > 0) reasons.push(`표시 실패 ${displayFailures}건`);
  for (const x of slow) reasons.push(`doc ${x.doc} · ${x.open_type === 'first' ? '첫 요청' : '같은 주소 바로 다시'} · ${x.page}: R 중앙값이 D 보다 ${x.diff_median_ms}ms 느리다(기준 +${x.limit_ms}ms)`);
  if (!complete) reasons.push(`표시 시간 측정이 조건마다 유효한 ${RUNS}회로 다 차지 않았다(doc ${docs.join('·')})${invalidRemaining || remeasured ? ' — 전경을 확보하지 못한 회차가 있다' : ''}`);
  if (invalidRemaining > 0) reasons.push(`무효인 측정 ${invalidRemaining}건이 남아 있다(화면이 숨겨졌거나 화면 갱신이 계속 느렸다) — 표시 시간은 판정할 수 없다`);
  return {
    result: displayFailures > 0 || slow.length > 0 ? 'fail' : !complete || invalidRemaining > 0 ? 'not_decided' : 'pass',
    display_failures: displayFailures, complete, invalid_runs_remaining: invalidRemaining, invalid_runs_remeasured: remeasured,
    transient_long_frames_in_valid_runs: runs.filter((r) => !r.pair_invalid).reduce((a, r) => a + (r.validity.transient_long_frames || 0), 0),
    rows, reasons,
  };
}
function renderTiming() {
  const rows = timingSummary([...REQUIRED_DOCS, ...REFERENCE_DOCS]);
  const label = { first: '첫 쪽', mid: '중간 쪽', last: '끝 쪽' };
  const T = RESULT.timing;
  $('out-timing').innerHTML = table(['doc', '열기 유형', '쪽', 'D 중앙값', 'D 최댓값', 'D 유효/실패', 'R 중앙값', 'R 최댓값', 'R 유효/실패', 'R−D', '기준', '판정'],
    rows.map((x) => [x.doc + (x.required_for_verdict ? '' : '(참고)'), x.open_type === 'first' ? '첫 요청' : '같은 주소 바로 다시', label[x.page], x.d.median, x.d.max, `${x.d.n_valid}/${x.d.n_fail}`, x.r.median, x.r.max, `${x.r.n_valid}/${x.r.n_fail}`, x.diff_median_ms, `+${x.limit_ms}`, x.ok === null ? mark(null) : mark(x.ok)]))
    + (T ? `<div class="note">무효라 다시 잰 측정 ${T.invalid_runs.length}건 · 무효인 채 남은 측정 ${T.runs.filter((r) => r.pair_invalid).length}건</div>` : '');
}

// ---------------------------------------------------------------------
// 4. 종료 뒤 시험
// "거절 확인"은 401/403 이면서 함수가 X-B2n3-Judge: not_member 를 낸 것뿐이다. 그 밖은 무엇이 왔는지 적고 미확인.
function classifyAfterEnd(rec) {
  if (rec.error || rec.status === 0) return { class: 'unverified', what: `요청 오류(네트워크·CORS·시간 초과): ${rec.error}` };
  const j = rec.headers ? rec.headers.judge : null;
  if (rec.status === 200 || rec.status === 206) return { class: 'delivered', what: `HTTP ${rec.status}` };
  if ((rec.received_bytes || 0) > 0 && rec.status !== 503) return { class: 'delivered', what: `HTTP ${rec.status} 인데 본문 ${rec.received_bytes}바이트가 왔다` };
  if ((rec.status === 401 || rec.status === 403) && j === 'not_member') return { class: 'denied', what: `HTTP ${rec.status} · X-B2n3-Judge not_member` };
  return { class: 'unverified', what: `HTTP ${rec.status} · X-B2n3-Judge ${j == null ? '없음(또는 관측 불가)' : j}` };
}
async function requestSet(doc, url, headers, expectAllow) {
  const d = S.docs[doc];
  const mid = Math.floor(d.bytes / 2);
  const out = [];
  const add = async (kind, opt, compare) => {
    const { rec, bytes } = await request(url, { headers, ...opt, cap: opt.cap ?? M1 });
    rec.kind = kind;
    if (expectAllow) {
      const want = compare ? await localBytes(doc, compare[0], compare[0] + Math.max(bytes.length, 1) - 1).catch(() => new Uint8Array(0)) : null;
      rec.bytes_equal = compare ? bytes.length > 0 && sameBytes(bytes, want.slice(0, bytes.length)) : null;
      rec.ok = kind === 'HEAD' ? rec.status === 200 : (rec.status === 200 || rec.status === 206) && rec.bytes_equal === true && (kind === 'GET' ? rec.status === 200 : rec.status === 206 && bytes.length === compare[1] - compare[0] + 1);
    } else { Object.assign(rec, classifyAfterEnd(rec)); rec.protected_bytes = rec.status === 503 ? 0 : rec.received_bytes || 0; }
    out.push(rec);
  };
  await add('GET', {}, [0, M1 - 1]); // 범위 없는 GET: 앞 1MiB 만 받고 끊는다(전송량을 아끼려는 것)
  await add('Range 앞', { headers: { ...headers, Range: `bytes=0-${K64 - 1}` } }, [0, K64 - 1]);
  await add('Range 중간', { headers: { ...headers, Range: `bytes=${mid}-${mid + K64 - 1}` } }, [mid, mid + K64 - 1]);
  await add('Range 끝', { headers: { ...headers, Range: `bytes=${d.bytes - K64}-${d.bytes - 1}` } }, [d.bytes - K64, d.bytes - 1]);
  await add('HEAD', { method: 'HEAD' }, null);
  return out;
}
async function runPre() {
  if (!needCreds()) return;
  if (!S.creds.end) { status('멈춤: 끝낼 로그인의 자격이 없다'); return; }
  if (RESULT.post_logout) (RESULT.post_logout_earlier = RESULT.post_logout_earlier || []).push(RESULT.post_logout);
  // 이 자격 글자를 메모리에 고정한다. 종료 뒤 요청은 입력 칸이 아니라 이 값으로 보낸다.
  S.pinnedEnd = S.creds.end;
  const P = RESULT.post_logout = {
    note: '끝낼 로그인의 자격으로 임시 함수(R)에 보낸 요청. 범위 없는 GET 은 앞 1MiB 만 받고 끊었다(전송량을 아끼려는 것). 종료 뒤 요청은 종료 전 대조군에 쓴 바로 그 자격 글자로 보낸다.',
    end_session_id: S.credInfo.end.session_id, keep_session_id: S.credInfo.keep.session_id,
    end_credential_sha256_12: (await sha256Hex(new TextEncoder().encode(S.pinnedEnd))).slice(0, 12),
    same_urls: {}, pre: {}, pre_ok_by_doc: {}, post: null,
  };
  for (const doc of selectedDocs()) {
    status(`종료 전 대조군: doc ${doc}`);
    P.same_urls[doc] = urlR(doc, newRun(`out${doc}same`));
    P.pre[doc] = await requestSet(doc, P.same_urls[doc], hR(S.pinnedEnd), true);
    P.pre_ok_by_doc[doc] = P.pre[doc].every((r) => r.ok);
  }
  const req = selectedDocs().filter((d) => REQUIRED_DOCS.includes(d));
  P.pre_ok = (req.length ? req : selectedDocs()).every((d) => P.pre_ok_by_doc[d]); // 필수 크기의 대조군(참고 크기의 실패는 따로 적힌다)
  P.pre_at = new Date().toISOString();
  $('logout-box').innerHTML = P.pre_ok
    ? `종료 전 대조군 <span class="ok">성공</span>(고정한 자격의 sha256 앞 12자 <code>${esc(P.end_credential_sha256_12)}</code>). 이제 측정자가 <b>이 로그인 기록만</b> 끝낸다: session_id <code>${esc(P.end_session_id)}</code> (끝내지 않는 로그인 <code>${esc(P.keep_session_id)}</code> 은 그대로). 방법은 절차.md. <b>이 화면을 새로 고치지 않는다</b>(고정한 자격이 사라진다).`
    : '<span class="bad">종료 전 대조군이 성공하지 못했다 — 종료 뒤 시험으로 넘어가지 않는다(거절이 "그 로그인이 끝나서"임을 보일 수 없다)</span>';
  renderLogout();
  status(P.pre_ok ? '종료 전 대조군 성공 — 측정자가 그 로그인만 끝낼 차례' : '멈춤: 종료 전 대조군 실패');
  renderVerdict();
  autoSave();
}
async function runPost() {
  const P = RESULT.post_logout;
  if (!P || !P.pre_ok) { status('멈춤: 종료 전 대조군을 먼저 성공시킬 것'); return; }
  if (!S.pinnedEnd) { status('멈춤: 종료 전 대조군에 쓴 자격이 메모리에 없다(화면을 새로 고쳤다) — 이 시험은 처음부터 다시 해야 한다'); return; }
  if (!$('chk-ended').checked) { status('멈춤: 그 로그인 기록을 끝내고 DB 에서 확인했다는 표시가 없다'); return; }
  if (secondsLeft(S.pinnedEnd) < 60) { status('멈춤: 고정한 자격이 만료됐거나 곧 만료된다 — 만료로 거절된 것과 종료로 거절된 것을 가를 수 없다. 처음부터 다시'); return; }
  const keepTok = $('in-keep').value.trim();
  const kp = jwtPayload(keepTok);
  if (!kp || kp.session_id !== P.keep_session_id || kp.iss !== ISSUER || secondsLeft(keepTok) < 60) { status('멈춤: 끝내지 않는 로그인의 자격이 종료 전과 다른 로그인이거나 곧 만료된다 — 같은 로그인의 살아 있는 자격을 넣을 것'); return; }
  if (P.post) (P.post_earlier_attempts = P.post_earlier_attempts || []).push(P.post);
  const post = {
    at: new Date().toISOString(), measurer_confirmed_session_ended_in_db: true,
    end_credential_sha256_12: P.end_credential_sha256_12, end_credential_seconds_left: secondsLeft(S.pinnedEnd),
    input_field_differs_from_pinned: $('in-end').value.trim() !== S.pinnedEnd, // 달라도 고정한 값을 쓴다
    same_url: {}, new_url: {}, control_keep: {}, diagnostic_d_with_member: {}, by_doc: {},
  };
  for (const doc of Object.keys(P.pre)) {
    if (!P.pre_ok_by_doc[doc]) { post.by_doc[doc] = { skipped: '종료 전 대조군이 성공하지 못한 크기라 보내지 않았다' }; continue; }
    status(`종료 뒤 요청: doc ${doc}`);
    post.same_url[doc] = await requestSet(doc, P.same_urls[doc], hR(S.pinnedEnd), false);
    post.new_url[doc] = await requestSet(doc, urlR(doc, newRun(`out${doc}new`)), hR(S.pinnedEnd), false);
    post.control_keep[doc] = await requestSet(doc, urlR(doc, newRun(`out${doc}keep`)), hR(keepTok), true); // 같은 때의 대조군: 끝내지 않은 로그인
    const dEnd = await request(urlD(doc, newRun(`out${doc}DMend`)), { headers: { ...hR(S.pinnedEnd), Range: `bytes=0-${K64 - 1}` } });
    const dKeep = await request(urlD(doc, newRun(`out${doc}DMkeep`)), { headers: { ...hR(keepTok), Range: `bytes=0-${K64 - 1}` } });
    post.diagnostic_d_with_member[doc] = { note: '직접 경로 + 회원 자격(견주기용 기록 — 판정에 넣지 않는다)', ended_login: dEnd.rec, kept_login: dKeep.rec };
    const all = [...post.same_url[doc], ...post.new_url[doc]];
    post.by_doc[doc] = { total: all.length, denied: all.filter((r) => r.class === 'denied').length, delivered: all.filter((r) => r.class === 'delivered').length, unverified: all.filter((r) => r.class === 'unverified').length, unverified_what: [...new Set(all.filter((r) => r.class === 'unverified').map((r) => r.what))], protected_bytes: all.reduce((a, r) => a + r.protected_bytes, 0), control_ok: post.control_keep[doc].every((r) => r.ok) };
  }
  P.post = post;
  P.verdict_rule = '통과 = 종료 뒤의 모든 요청(같은 주소·새 주소의 GET·범위 셋·HEAD)이 401 또는 403 이고 X-B2n3-Judge 가 not_member 이며 본문 0바이트 + 같은 때 끝내지 않은 로그인으로는 열림. 네트워크·CORS 오류·시간 초과·503·다른 판정 값·머리글 없음은 미확인. HEAD 는 상태로 판정. 필수 크기(160·68)와 참고 크기(34)를 따로 판정한다.';
  renderLogout();
  renderVerdict();
  const v = postLogoutVerdict(REQUIRED_DOCS).result;
  status(`종료 뒤 시험(필수 크기): ${v === 'pass' ? '통과' : v === 'fail' ? '실패(보호 본문이 전달됨)' : v === 'not_run' ? '필수 크기가 빠졌다' : '미확인'}`);
  autoSave();
}
function postLogoutVerdict(docs) {
  const P = RESULT.post_logout;
  if (!P) return { result: 'not_run', reasons: ['종료 뒤 시험을 하지 않았다'] };
  if (!docs.every((d) => P.pre[d])) return { result: 'not_run', reasons: [`종료 뒤 시험에 doc ${docs.filter((d) => !P.pre[d]).join('·')} 이 빠졌다`] };
  if (!docs.every((d) => P.pre_ok_by_doc[d])) return { result: 'unverified', reasons: ['종료 전 대조군이 성공하지 못했다'] };
  if (!P.post) return { result: 'not_run', reasons: ['종료 뒤 요청을 아직 보내지 않았다'] };
  const by = docs.map((d) => ({ doc: d, ...P.post.by_doc[d] }));
  const sum = (k) => by.reduce((a, x) => a + (x[k] || 0), 0);
  const counts = { total: sum('total'), denied: sum('denied'), delivered: sum('delivered'), unverified: sum('unverified'), protected_bytes: sum('protected_bytes') };
  const controlOk = by.every((x) => x.control_ok === true);
  const reasons = [];
  if (counts.delivered > 0 || counts.protected_bytes > 0) reasons.push(`종료 뒤 요청 ${counts.delivered}건에 응답 본문이 전달됐다(보호 본문 ${counts.protected_bytes}바이트)`);
  if (counts.unverified > 0) reasons.push(`종료 뒤 요청 ${counts.unverified}건이 미확인: ${[...new Set(by.flatMap((x) => x.unverified_what || []))].join(' / ')}`);
  if (!controlOk) reasons.push('같은 때의 대조군(끝내지 않은 로그인)이 열리지 않았다 — 거절이 "그 로그인이 끝나서"임을 보일 수 없다');
  return { result: counts.delivered > 0 || counts.protected_bytes > 0 ? 'fail' : counts.unverified > 0 || !controlOk || counts.denied !== counts.total ? 'unverified' : 'pass', counts, control_ok: controlOk, reasons };
}
function renderLogout() {
  const P = RESULT.post_logout;
  if (!P) return;
  const rows = [];
  const tag = (doc) => doc + (REQUIRED_DOCS.includes(doc) ? '' : '(참고)');
  const push = (when, doc, set, allow) => { for (const r of set) rows.push([when, tag(doc), r.kind, r.status || r.error, r.headers ? r.headers.judge ?? '' : '', r.received_bytes ?? '', allow ? mark(r.ok) : r.class === 'denied' ? cell('거절 확인', 'ok') : r.class === 'delivered' ? cell('전달됨', 'bad') : cell('미확인 — ' + r.what, 'unk')]); };
  for (const [doc, set] of Object.entries(P.pre)) push('종료 전(대조군)', doc, set, true);
  if (P.post) {
    for (const [doc, set] of Object.entries(P.post.same_url)) push('종료 뒤·같은 주소', doc, set, false);
    for (const [doc, set] of Object.entries(P.post.new_url)) push('종료 뒤·새 주소', doc, set, false);
    for (const [doc, set] of Object.entries(P.post.control_keep)) push('같은 때 대조군(끝내지 않은 로그인)', doc, set, true);
  }
  $('out-logout').innerHTML = table(['언제', 'doc', '요청', '상태', '판정 머리글', '받은 바이트', '결과'], rows) + (P.post ? '<div class="note">직접+회원 진단: ' + Object.entries(P.post.diagnostic_d_with_member).map(([doc, v]) => `doc ${doc} 끝낸 로그인 ${v.ended_login.status || v.ended_login.error} / 끝내지 않은 로그인 ${v.kept_login.status || v.kept_login.error}`).join(' · ') + (P.post.input_field_differs_from_pinned ? ' · 입력 칸이 종료 전과 달랐다(고정한 자격을 썼다)' : '') + '</div>' : '');
}

// ---------------------------------------------------------------------
// 5. 캐시 머리글 확인 (측정이 다 끝난 뒤에)
async function runProbe() {
  if (!needCreds()) return;
  if (!RESULT.timing) { status('멈춤: 표시 시간 측정을 먼저 할 것'); return; }
  const out = [];
  const lastAgain = {};
  for (const r of RESULT.timing.runs) if (r.open_type === 'again') lastAgain[r.doc + r.path] = r; // 크기·경로마다 마지막 회차의 주소 하나
  for (const r of Object.values(lastAgain)) {
    const { rec } = await request(r.url, { headers: { ...(r.path === 'D' ? hD() : hR(S.creds.keep)), Range: 'bytes=0-0' } });
    out.push({ doc: r.doc, path: r.path, iteration: r.iteration, url_run: r.url_run, status: rec.status, cache_control: rec.headers ? rec.headers.cache_control : null, cf_cache_status: rec.headers ? rec.headers.cf_cache_status : null, age: rec.headers ? rec.headers.age : null, error: rec.error ?? null });
  }
  RESULT.cache_probe = { note: '크기·경로마다 마지막 회차의 주소(첫 요청·바로 다시에 쓴 주소)에 1바이트 범위 요청을 보낸 응답의 캐시 관련 머리글. null 은 브라우저에서 관측 불가일 수 있다.', probes: out };
  $('out-probe').innerHTML = table(['doc', '경로', '상태', 'Cache-Control', 'cf-cache-status', 'Age'], out.map((x) => [x.doc, x.path, x.status || x.error, x.cache_control ?? '관측 불가', x.cf_cache_status ?? '관측 불가', x.age ?? '관측 불가']));
  autoSave();
}

// ---------------------------------------------------------------------
// 6. 판정 — 필수 크기(160·68)만으로 정한다. 참고 크기(34)는 따로 적고 필수 판정을 바꾸지 않는다.
function groupVerdict(docs) {
  const timing = timingVerdict(docs);
  const range = rangeVerdict(docs);
  const post = postLogoutVerdict(docs);
  const failed = timing.result === 'fail' || range.result === 'fail' || post.result === 'fail';
  const pass = timing.result === 'pass' && range.result === 'pass' && post.result === 'pass';
  const reasons = [];
  if (timing.result !== 'pass') reasons.push(...timing.reasons.map((r) => '[표시 시간] ' + r));
  if (range.result !== 'pass') reasons.push(...range.reasons.map((r) => '[범위 응답] ' + r));
  if (post.result !== 'pass') reasons.push(...post.reasons.map((r) => '[종료 뒤] ' + r));
  return { docs, result: pass ? 'pass' : failed ? 'fail' : 'not_decided', timing, range, post_logout: post, reasons };
}
function computeVerdict() {
  const required = groupVerdict(REQUIRED_DOCS);
  const reference = groupVerdict(REFERENCE_DOCS);
  return {
    rule: '필수 판정 대상 160·68. 크기별·열기 유형별로 D·R 각각 유효한 5회의 중앙값을 견준다(두 열기 유형 모두). 표시 실패 0, 잘못된 범위·바이트 0(머리글 미관측·범위 없는 GET 미실시는 통과가 아니다), 종료 뒤 같은 주소·새 주소·범위·HEAD 전부 401/403·not_member·본문 0(미확인이 있으면 통과 아님). R 중앙값 − D 중앙값: 첫 쪽 +1000ms 이내, 중간·끝 쪽 +500ms 이내. 전경을 확보하지 못한 측정이 남으면 표시 시간은 not_decided.',
    result: required.result, pass: required.result === 'pass',
    required,
    reference_34: { note: '참고 측정이다. 여기의 실패·미확인은 필수 판정(result)을 바꾸지 않는다.', ...reference },
    caveat: '후보 선정 기준이지 운영 보장이 아니다. 한 기기·한 회선·합성 PDF·회원 판정 1회의 값이다(절차.md 의 한계).',
  };
}
function renderVerdict() {
  const v = RESULT.verdict = computeVerdict();
  if (RESULT.timing) renderTiming();
  const line = (label, g) => [label, resultCell(g.result), resultCell(g.timing.result), resultCell(g.range.result), resultCell(g.post_logout.result)];
  $('out-verdict').innerHTML = `<p><b>판정(필수 크기 160·68): <span class="${v.pass ? 'ok' : v.result === 'fail' ? 'bad' : 'unk'}">${v.pass ? '통과' : v.result === 'fail' ? '통과 아님(기준 미달)' : '아직 판정할 수 없음'}</span></b></p>`
    + table(['', '종합', '표시 시간', '범위 응답', '종료 뒤'], [line('필수(160·68)', v.required), line('참고(34) — 판정에 넣지 않음', v.reference_34)])
    + (v.required.reasons.length ? '<ul>' + v.required.reasons.map((r) => `<li>${esc(r)}</li>`).join('') + '</ul>' : '')
    + (v.reference_34.reasons.length ? '<div class="note">참고(34): ' + v.reference_34.reasons.map(esc).join(' / ') + '</div>' : '')
    + `<p class="note">${esc(v.caveat)}</p>`;
}

// ---------------------------------------------------------------------
function snapshotResult() { RESULT.saved_at = new Date().toISOString(); RESULT.verdict = computeVerdict(); return JSON.stringify(RESULT, null, 2); }
async function autoSave() {
  try {
    const res = await fetch(`/local/save?name=b2n3_${S.manifest.marker}_${SESSION}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: snapshotResult() });
    const j = await res.json();
    $('saved').textContent = `저장됨: ${j.saved} (${new Date().toLocaleTimeString()})`;
  } catch (e) { $('saved').textContent = '저장 실패: ' + e.message + ' — "JSON 내려받기"를 쓸 것'; }
}
function download() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([snapshotResult()], { type: 'application/json' }));
  a.download = `b2n3_${S.manifest.marker}_${SESSION}.json`;
  a.click();
}
function guard(fn, name) {
  return async () => {
    if (S.busy) { log(`"${name}"을 누르셨지만 다른 단계가 도는 중이다`); return; }
    S.busy = true;
    try { await fn(); } catch (e) { status(`멈춤: ${name} 중 예외 — ${e && e.message ? e.message : e}`); log(String(e && e.stack ? e.stack : e)); } finally { S.busy = false; }
  };
}
async function init() {
  if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') { status('멈춤: 이 화면은 로컬 서버(127.0.0.1)에서만 연다'); return; }
  if (typeof pdfjsLib === 'undefined') { status('멈춤: PDF.js 를 받지 못했다(CDN)'); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  performance.setResourceTimingBufferSize(5000);
  S.manifest = await (await fetch('/local/manifest.json')).json();
  for (const d of S.manifest.docs) S.docs[d.doc] = d;
  RESULT.marker = S.manifest.marker;
  const box = viewerBox();
  const conn = navigator.connection || {};
  if (ALLOW_SLOW_FRAMES) { RESULT.notes.push('도구 점검용 선택(allow_slow_frames=1)으로 열었다 — 무효인 측정을 다시 재지 않고 남겼다. 표시 시간은 판정할 수 없다.'); log('주의: allow_slow_frames=1 — 무효인 측정도 남긴다(표시 시간은 판정할 수 없다)'); }
  RESULT.environment = { user_agent: navigator.userAgent, frame_probe_at_start: (await frameProbe()), visibility_at_start: document.visibilityState, origin: location.origin, device_pixel_ratio: window.devicePixelRatio || 1, viewer_box_css_px: box, zoom: '맞춤 배율 × 1.0(뷰어의 기본)', pdfjs_version: pdfjsLib.version, connection: { effective_type: conn.effectiveType ?? null, downlink_mbps: conn.downlink ?? null, rtt_ms: conn.rtt ?? null, note: '브라우저가 어림한 값이다' } };
  $('manifest').innerHTML = `표식 <b>${esc(S.manifest.marker)}</b> · ` + S.manifest.docs.map((d) => `doc ${d.doc}: ${d.bytes.toLocaleString('en-US')}바이트·${d.pages}쪽(${esc(d.object_name)})`).join(' / ') + ` · PDF.js ${esc(pdfjsLib.version)} · 화면 ${box.w}×${box.h}px, dpr ${RESULT.environment.device_pixel_ratio}`;
  try {
    const c = await (await fetch('/local/credentials', { headers: { 'X-B2n3-Local': '1' } })).json();
    if (c.anon_key) $('in-anon').value = c.anon_key;
    if (c.jwt_keep) $('in-keep').value = c.jwt_keep;
    if (c.jwt_end) $('in-end').value = c.jwt_end;
    if (c.anon_key || c.jwt_keep || c.jwt_end) log('로컬 서버의 환경 변수에서 자격을 받았다(화면의 메모리에만 둔다)');
  } catch (e) { /* 없으면 직접 넣는다 */ }
  $('btn-creds').onclick = () => { readCreds(); };
  $('btn-local').onclick = guard(async () => { await runLocal(); status(RESULT.local_check.all_ok ? '로컬 원본 확인 끝 — 전부 열림' : '멈춤: 로컬 원본 확인 실패'); }, '로컬 원본 확인');
  $('btn-range').onclick = guard(async () => { await runRange(); if (RESULT.range_check) { status('범위 응답 대조 끝'); autoSave(); } }, '범위 응답 대조');
  $('btn-timing').onclick = guard(runTiming, '표시 시간 측정');
  $('btn-stop').onclick = () => { S.stop = true; log('멈추기를 눌렀다 — 지금 재는 것이 끝나면 멈춘다'); };
  $('btn-resume').onclick = () => { if (S.resumeWaiter) { const r = S.resumeWaiter; S.resumeWaiter = null; r(); } };
  $('btn-pre').onclick = guard(runPre, '종료 전 대조군');
  $('btn-post').onclick = guard(runPost, '종료 뒤 요청');
  $('btn-probe').onclick = guard(async () => { await runProbe(); if (RESULT.cache_probe) status('캐시 머리글 확인 끝'); }, '캐시 머리글 확인');
  $('btn-save').onclick = autoSave;
  $('btn-download').onclick = download;
  renderVerdict();
  status('준비됨 — 자격을 넣고 "자격 확인"부터');
}
init().catch((e) => status('멈춤: 준비 중 예외 — ' + (e && e.message ? e.message : e)));
