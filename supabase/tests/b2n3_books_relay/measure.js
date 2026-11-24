// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-3 (나) 측정 화면 (serve.mjs 가 127.0.0.1 에서 내준다)
//
// 이 화면은 작업방이 실제 Storage·Edge 에 돌려 본 적이 없다(로컬의 가짜 응답으로만 돌려 봤다).
// 보내는 요청: 시험 프로젝트(아래 TEST_URL)의 Storage 읽기와 임시 함수 zz-b2n3-relay 의 GET·HEAD 뿐이다.
//   쓰기·로그인·로그아웃 요청은 보내지 않는다(로그아웃은 측정자가 한다). 서비스 열쇠는 쓰지 않는다.
//   자격은 화면의 메모리에만 두고 결과·저장소에 적지 않는다(결과에는 자격 안의 식별값 sub·session_id·exp 만).
// 고정된 것(계약): PDF.js 3.11.174 · getDocument({ url, httpHeaders }) 만 · D = 공개 키 / R = 회원 자격 · 5회 ·
//   첫 쪽 +1초, 중간·끝 쪽 +0.5초 · 필수 판정 대상 160·68(34 는 참고) · 종료 뒤 요청은 전부 401/403 이고 본문 0.
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
const OPEN_TIMEOUT_MS = 300000;
const MIN_SECONDS_LEFT = 120;
const K64 = 65536;
const M1 = 1048576;

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad4 = (n) => String(n).padStart(4, '0');
const round = (x) => (x == null ? null : Math.round(x));
const SESSION = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + Math.random().toString(36).slice(2, 6);

const S = { manifest: null, docs: {}, creds: { anon: null, keep: null, end: null }, credInfo: null, busy: false, stop: false, resumeWaiter: null, runSeq: 0 };
const RESULT = {
  tool: 'b2n3 measure.js', session: SESSION, started_at: new Date().toISOString(), target: TEST_URL,
  fixed: { pdfjs: PDFJS_VERSION, worker: WORKER_SRC, runs: RUNS, limit_ms: LIMIT_MS, required_docs: REQUIRED_DOCS, paths: { D: 'storage/v1/object/authenticated/books/<이름> — apikey·Authorization 둘 다 공개 키', R: 'functions/v1/zz-b2n3-relay?doc=…&run=… — apikey 공개 키 + Authorization 회원 자격' } },
  environment: null, marker: null, credentials: null, local_check: null, range_check: null, timing: null, post_logout: null, cache_probe: null, verdict: null,
  notes: [
    '표시 시간은 PDF.js 가 실제로 그린 시간이다(요청 순서만 재생한 전송 시험이 아니다).',
    'run 값을 바꿨다는 것만으로 캐시를 피했다고 보지 않는다 — resource(Resource Timing)와 cache_probe 를 함께 볼 것.',
    '브라우저에서 볼 수 없는 값은 null 과 "브라우저에서 관측 불가"로 적었다. 요청 수·전송량은 함수 로그(중계)와 Storage 로그(직접)에서 run 값으로 센다. 직접 경로의 로그에서 run 을 식별할 수 없으면 0 이 아니라 미확인이다.',
  ],
};
window.B2N3 = { S, RESULT };

function log(msg) { const el = $('log'); el.textContent += `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`; el.scrollTop = el.scrollHeight; }
function status(msg) { $('status').textContent = msg; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function table(head, rows) {
  return '<table><tr>' + head.map((h) => `<th class="l">${esc(h)}</th>`).join('') + '</tr>' + rows.map((r) => '<tr>' + r.map((c) => (c && c.html ? `<td class="${c.cls || ''}">${c.html}</td>` : `<td class="${typeof c === 'number' ? '' : 'l'}">${esc(c ?? '')}</td>`)).join('') + '</tr>').join('') + '</table>';
}
const mark = (ok) => (ok === true ? { html: '맞음', cls: 'ok l' } : ok === false ? { html: '어긋남', cls: 'bad l' } : { html: '관측 불가·안 함', cls: 'unk l' });

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
    transfer_bytes: sizesVisible ? entries.reduce((a, e) => a + (e.transferSize || 0), 0) : null,
    body_bytes: sizesVisible ? entries.reduce((a, e) => a + (e.encodedBodySize || 0), 0) : null,
    sizes: sizesVisible ? '브라우저가 보여 줌' : '브라우저에서 관측 불가(교차 출처 응답에 Timing-Allow-Origin 이 없으면 0 으로 보인다)',
    zero_transfer_entries: sizesVisible ? entries.filter((e) => e.transferSize === 0).length : null,
    response_statuses: statuses.length ? statuses : null,
    delivery_types: delivery.length ? delivery : null, // 'cache' 가 있으면 브라우저 캐시에서 온 것(지원하는 브라우저만)
    from_browser_cache: delivery.includes('cache') ? true : sizesVisible ? entries.every((e) => e.transferSize > 0) ? false : null : null,
  };
}
// 한 번의 측정: 첫 쪽 = 문서 열기 시작 → 1쪽 렌더 완료 / 중간·끝 쪽 = 이미 열린 그 문서에서 이동 시작 → 렌더 완료
async function measureOpen(doc, url, httpHeaders) {
  const d = S.docs[doc];
  const mid = Math.ceil(d.pages / 2);
  const rec = { url_run: new URL(url, location.href).searchParams.get('run'), started_at: new Date().toISOString(), ok: false, ms: { open: null, first: null, mid: null, last: null }, pages_measured: { first: 1, mid, last: d.pages } };
  performance.clearResourceTimings();
  let task = null;
  let progress = { loaded: null, total: null };
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
    log(`로컬 원본 doc ${doc}: ${r.ok ? '열림' : '실패 — ' + r.error} (첫 쪽 ${r.ms.first}ms, 중간 ${r.ms.mid}ms, 끝 ${r.ms.last}ms)`);
  }
  RESULT.local_check = { note: '로컬 서버의 원본을 같은 PDF.js 설정으로 연 것이다(Supabase 요청 0). 합성 PDF 가 올바른지와 쪽 글자만 본다.', docs: out, all_ok: out.length > 0 && out.every((x) => x.ok) };
  $('out-local').innerHTML = table(['doc', '열림', '쪽수', '첫 쪽 ms', '중간 ms', '끝 ms', '오류'], out.map((x) => [x.doc, mark(x.ok), x.num_pages ?? '', x.ms.first, x.ms.mid, x.ms.last, x.error ?? '']));
}

// ---------------------------------------------------------------------
// 2. 범위 응답 대조
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
  rec.content_range_ok = rec.headers && rec.headers.content_range != null ? rec.headers.content_range === `bytes ${g.start}-${g.end}/${size}` : null;
  rec.content_length_ok = rec.headers && rec.headers.content_length != null ? Number(rec.headers.content_length) === want.length : null;
  rec.ok = rec.status_ok && rec.bytes_equal && rec.content_range_ok !== false && rec.content_length_ok !== false;
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
  } else out.full_get = { skipped: true, note: '하지 않음 — 범위 없는 GET 의 길이·내용은 확인하지 않았다' };
  out.accept_ranges_visible = out.ranges.some((r) => r.headers && r.headers.accept_ranges != null) || (head.headers && head.headers.accept_ranges != null);
  out.errors = out.ranges.filter((r) => !r.ok).length + (head.status_ok && head.content_length_ok !== false ? 0 : 1) + (out.full_get.skipped ? 0 : out.full_get.ok ? 0 : 1);
  return out;
}
async function runRange() {
  if (!needCreds()) return;
  const full = $('opt-full').checked;
  const res = { note: '받은 바이트를 로컬 합성 원본의 같은 구간과 바이트로 견줬다. 범위 응답의 정확성은 표시 시간과 따로 본다.', full_get_done: full, docs: {} };
  for (const doc of selectedDocs()) {
    res.docs[doc] = {};
    for (const path of ['D', 'R']) {
      status(`범위 응답 대조: doc ${doc} ${path}`);
      res.docs[doc][path] = await rangeCheckPath(doc, path, full);
      log(`범위 응답 doc ${doc} ${path}: 어긋남 ${res.docs[doc][path].errors}`);
    }
    // 별도 진단: 직접 경로 + 회원 자격(성능 비교에 넣지 않는다)
    const dm = await request(urlD(doc, newRun(`rg${doc}DM`)), { headers: { ...hR(S.creds.keep), Range: `bytes=0-${K64 - 1}` } });
    res.docs[doc].diagnostic_d_with_member = { note: '직접 경로 + 회원 자격(별도 진단). 시험 프로젝트의 books 에는 로그인 역할 읽기 규칙이 없어 거절일 수 있다', ...dm.rec };
  }
  RESULT.range_check = res;
  const rows = [];
  for (const [doc, v] of Object.entries(res.docs)) for (const path of ['D', 'R']) {
    const x = v[path];
    rows.push([doc, path, `${x.ranges.filter((r) => r.ok).length}/${x.ranges.length}`, mark(x.ranges.every((r) => r.content_range_ok === true) ? true : x.ranges.some((r) => r.content_range_ok === false) ? false : null), `${x.head.status}`, x.full_get.skipped ? '안 함' : `${x.full_get.status} · ${x.full_get.received_bytes}바이트`, x.full_get.skipped ? mark(null) : mark(x.full_get.ok), mark(x.accept_ranges_visible ? true : null), x.errors]);
  }
  $('out-range').innerHTML = table(['doc', '경로', '구간 일치', 'Content-Range', 'HEAD', '범위 없는 GET', '전체 일치', 'Accept-Ranges 보임', '어긋남'], rows) + '<div class="note">직접+회원 진단: ' + Object.entries(res.docs).map(([doc, v]) => `doc ${doc} → ${v.diagnostic_d_with_member.status || v.diagnostic_d_with_member.error}`).join(' · ') + '</div>';
  renderVerdict();
}

// ---------------------------------------------------------------------
// 3. 표시 시간 측정
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
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
  const T = RESULT.timing = RESULT.timing || { note: '조건(크기 × 열기 유형 × 경로)마다 5회. 순서는 D, R 번갈아. "first" = 주소에 매번 새 run 값 / "again" = 같은 주소로 다시 요청(그 조건의 first 1회차 주소). 두 열기 유형은 합치지 않는다.', runs: [] };
  const order = [];
  for (const doc of selectedDocs()) for (const type of ['first', 'again']) for (let i = 1; i <= RUNS; i++) for (const path of ['D', 'R']) order.push({ doc, type, i, path });
  const firstUrl = {};
  for (const r of T.runs) if (r.open_type === 'first' && r.iteration === 1) firstUrl[r.doc + r.path] = r.url;
  let n = 0;
  for (const o of order) {
    n++;
    if (T.runs.some((r) => r.doc === o.doc && r.open_type === o.type && r.iteration === o.i && r.path === o.path)) continue; // 이미 잰 것(이어 하기)
    if (S.stop) { status('멈춤: 측정자가 멈췄다 — 다시 누르면 남은 것부터 잰다'); return; }
    await waitForFreshCredential();
    const key = o.doc + o.path;
    let url;
    if (o.type === 'first') { url = o.path === 'D' ? urlD(o.doc, newRun(`t${o.doc}D`)) : urlR(o.doc, newRun(`t${o.doc}R`)); if (o.i === 1) firstUrl[key] = url; } else url = firstUrl[key];
    status(`표시 시간 측정 ${n}/${order.length}: doc ${o.doc} · ${o.type === 'first' ? '첫 요청' : '같은 주소 다시'} · ${o.i}/${RUNS}회 · ${o.path}`);
    const rec = await measureOpen(o.doc, url, o.path === 'D' ? hD() : hR(S.creds.keep));
    T.runs.push({ doc: o.doc, open_type: o.type, iteration: o.i, path: o.path, url, ...rec });
    log(`doc ${o.doc} ${o.type} #${o.i} ${o.path}: ${rec.ok ? `첫 쪽 ${rec.ms.first}ms · 중간 ${rec.ms.mid}ms · 끝 ${rec.ms.last}ms · 요청 ${rec.resource.requests_seen}건` : '실패 — ' + rec.error}`);
    renderTiming();
    await sleep(400);
  }
  status('표시 시간 측정 끝');
  renderVerdict();
  autoSave();
}
function timingSummary() {
  const T = RESULT.timing;
  const rows = [];
  if (!T) return rows;
  const docs = [...new Set(T.runs.map((r) => r.doc))];
  for (const doc of docs) for (const type of ['first', 'again']) for (const page of ['first', 'mid', 'last']) {
    const pick = (path) => T.runs.filter((r) => r.doc === doc && r.open_type === type && r.path === path);
    const vals = (path) => pick(path).filter((r) => r.ok).map((r) => r.ms[page]);
    const d = vals('D');
    const r = vals('R');
    const dm = median(d);
    const rm = median(r);
    const complete = d.length === RUNS && r.length === RUNS;
    rows.push({
      doc, open_type: type, page, required_for_verdict: REQUIRED_DOCS.includes(doc),
      d: { n_ok: d.length, n_fail: pick('D').length - d.length, values: d, median: dm, max: d.length ? Math.max(...d) : null },
      r: { n_ok: r.length, n_fail: pick('R').length - r.length, values: r, median: rm, max: r.length ? Math.max(...r) : null },
      diff_median_ms: dm != null && rm != null ? rm - dm : null, limit_ms: LIMIT_MS[page], complete,
      ok: complete ? rm - dm <= LIMIT_MS[page] : null,
      from_browser_cache: { D: [...new Set(pick('D').map((x) => String(x.resource.from_browser_cache)))], R: [...new Set(pick('R').map((x) => String(x.resource.from_browser_cache)))] },
    });
  }
  return rows;
}
function renderTiming() {
  const rows = timingSummary();
  const label = { first: '첫 쪽', mid: '중간 쪽', last: '끝 쪽' };
  $('out-timing').innerHTML = table(['doc', '열기 유형', '쪽', 'D 중앙값', 'D 최댓값', 'D 성공/실패', 'R 중앙값', 'R 최댓값', 'R 성공/실패', 'R−D', '기준', '판정'],
    rows.map((x) => [x.doc + (x.required_for_verdict ? '' : '(참고)'), x.open_type === 'first' ? '첫 요청' : '같은 주소 다시', label[x.page], x.d.median, x.d.max, `${x.d.n_ok}/${x.d.n_fail}`, x.r.median, x.r.max, `${x.r.n_ok}/${x.r.n_fail}`, x.diff_median_ms, `+${x.limit_ms}`, x.ok === null ? mark(null) : mark(x.ok)]));
}

// ---------------------------------------------------------------------
// 4. 종료 뒤 시험
function classifyDenied(rec) {
  if (rec.error || rec.status === 0) return 'unverified'; // 네트워크·CORS 오류·시간 초과
  if (rec.status === 200 || rec.status === 206 || (rec.received_bytes || 0) > 0 && rec.status !== 503) return 'delivered';
  if (rec.status === 401 || rec.status === 403) return rec.headers && rec.headers.judge ? 'denied' : 'denied_source_unconfirmed';
  return 'unverified'; // 503(판정 장애)과 그 밖
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
    } else { rec.class = classifyDenied(rec); rec.protected_bytes = rec.status === 503 ? 0 : rec.received_bytes || 0; }
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
  const P = RESULT.post_logout = { note: '끝낼 로그인의 자격으로 임시 함수(R)에 보낸 요청. 범위 없는 GET 은 앞 1MiB 만 받고 끊었다(전송량을 아끼려는 것).', end_session_id: S.credInfo.end.session_id, keep_session_id: S.credInfo.keep.session_id, same_urls: {}, pre: {}, post: null, verdict: 'not_run' };
  for (const doc of selectedDocs()) {
    status(`종료 전 대조군: doc ${doc}`);
    P.same_urls[doc] = urlR(doc, newRun(`out${doc}same`));
    P.pre[doc] = await requestSet(doc, P.same_urls[doc], hR(S.creds.end), true);
  }
  P.pre_ok = Object.values(P.pre).every((set) => set.every((r) => r.ok));
  P.pre_at = new Date().toISOString();
  $('logout-box').innerHTML = P.pre_ok
    ? `종료 전 대조군 <span class="ok">성공</span>. 이제 측정자가 <b>이 로그인 기록만</b> 끝낸다: session_id <code>${esc(P.end_session_id)}</code> (끝내지 않는 로그인 <code>${esc(P.keep_session_id)}</code> 은 그대로). 방법은 절차.md. 끝낸 뒤 DB 에서 확인하고 아래에 표시한다. <b>자격 입력 칸은 바꾸지 않는다</b>(이미 받아 둔 같은 자격으로 다시 요청하는 것이 시험이다).`
    : '<span class="bad">종료 전 대조군이 성공하지 못했다 — 종료 뒤 시험으로 넘어가지 않는다(거절이 "그 로그인이 끝나서"임을 보일 수 없다)</span>';
  renderLogout();
  status(P.pre_ok ? '종료 전 대조군 성공 — 측정자가 그 로그인만 끝낼 차례' : '멈춤: 종료 전 대조군 실패');
  autoSave();
}
async function runPost() {
  const P = RESULT.post_logout;
  if (!P || !P.pre_ok) { status('멈춤: 종료 전 대조군을 먼저 성공시킬 것'); return; }
  if (!$('chk-ended').checked) { status('멈춤: 그 로그인 기록을 끝내고 DB 에서 확인했다는 표시가 없다'); return; }
  const endNow = jwtPayload($('in-end').value.trim());
  if (!endNow || endNow.session_id !== P.end_session_id) { status('멈춤: 끝낼 로그인의 자격 칸이 종료 전과 다르다 — 이미 받아 둔 같은 자격이어야 한다'); return; }
  if (secondsLeft(S.creds.end) < 60) { status('멈춤: 끝낼 로그인의 자격이 만료됐거나 곧 만료된다 — 만료로 거절된 것과 종료로 거절된 것을 가를 수 없다. 처음부터 다시'); return; }
  P.post = { at: new Date().toISOString(), measurer_confirmed_session_ended_in_db: true, end_credential_seconds_left: secondsLeft(S.creds.end), same_url: {}, new_url: {}, control_keep: {}, diagnostic_d_with_member: {} };
  for (const doc of selectedDocs()) {
    status(`종료 뒤 요청: doc ${doc}`);
    P.post.same_url[doc] = await requestSet(doc, P.same_urls[doc], hR(S.creds.end), false);
    P.post.new_url[doc] = await requestSet(doc, urlR(doc, newRun(`out${doc}new`)), hR(S.creds.end), false);
    P.post.control_keep[doc] = await requestSet(doc, urlR(doc, newRun(`out${doc}keep`)), hR(S.creds.keep), true); // 같은 때의 대조군: 끝내지 않은 로그인
    const dEnd = await request(urlD(doc, newRun(`out${doc}DMend`)), { headers: { ...hR(S.creds.end), Range: `bytes=0-${K64 - 1}` } });
    const dKeep = await request(urlD(doc, newRun(`out${doc}DMkeep`)), { headers: { ...hR(S.creds.keep), Range: `bytes=0-${K64 - 1}` } });
    P.post.diagnostic_d_with_member[doc] = { note: '직접 경로 + 회원 자격(견주기용 기록 — 판정에 넣지 않는다)', ended_login: dEnd.rec, kept_login: dKeep.rec };
  }
  const all = [...Object.values(P.post.same_url), ...Object.values(P.post.new_url)].flat();
  P.post.counts = { total: all.length, denied: all.filter((r) => r.class === 'denied').length, delivered: all.filter((r) => r.class === 'delivered').length, unverified: all.filter((r) => r.class === 'unverified' || r.class === 'denied_source_unconfirmed').length, protected_bytes: all.reduce((a, r) => a + r.protected_bytes, 0) };
  P.post.control_ok = Object.values(P.post.control_keep).every((set) => set.every((r) => r.ok));
  P.verdict = P.post.counts.delivered > 0 || P.post.counts.protected_bytes > 0 ? 'fail' : P.post.counts.unverified > 0 || !P.post.control_ok ? 'unverified' : 'pass';
  P.verdict_rule = '통과 = 종료 뒤의 모든 요청(같은 주소·새 주소의 GET·범위 셋·HEAD)이 401 또는 403 이고 본문 0바이트 + 같은 때 끝내지 않은 로그인으로는 열림. 네트워크·CORS 오류·시간 초과·503·함수가 낸 응답임을 확인하지 못한 401/403 은 미확인. HEAD 는 상태로 판정.';
  renderLogout();
  renderVerdict();
  status(`종료 뒤 시험: ${P.verdict === 'pass' ? '통과' : P.verdict === 'fail' ? '실패(보호 본문이 전달됨)' : '미확인'}`);
  autoSave();
}
function renderLogout() {
  const P = RESULT.post_logout;
  if (!P) return;
  const rows = [];
  const push = (when, doc, set, allow) => { for (const r of set) rows.push([when, doc, r.kind, r.status || r.error, r.headers ? r.headers.judge ?? '' : '', r.received_bytes ?? '', allow ? mark(r.ok) : r.class === 'denied' ? { html: '거절', cls: 'ok l' } : r.class === 'delivered' ? { html: '전달됨', cls: 'bad l' } : { html: '미확인', cls: 'unk l' }]); };
  for (const [doc, set] of Object.entries(P.pre)) push('종료 전(대조군)', doc, set, true);
  if (P.post) {
    for (const [doc, set] of Object.entries(P.post.same_url)) push('종료 뒤·같은 주소', doc, set, false);
    for (const [doc, set] of Object.entries(P.post.new_url)) push('종료 뒤·새 주소', doc, set, false);
    for (const [doc, set] of Object.entries(P.post.control_keep)) push('같은 때 대조군(끝내지 않은 로그인)', doc, set, true);
  }
  $('out-logout').innerHTML = table(['언제', 'doc', '요청', '상태', '판정 머리글', '받은 바이트', '결과'], rows) + (P.post ? '<div class="note">직접+회원 진단: ' + Object.entries(P.post.diagnostic_d_with_member).map(([doc, v]) => `doc ${doc} 끝낸 로그인 ${v.ended_login.status || v.ended_login.error} / 끝내지 않은 로그인 ${v.kept_login.status || v.kept_login.error}`).join(' · ') + '</div>' : '');
}

// ---------------------------------------------------------------------
// 5. 캐시 머리글 확인 (측정이 다 끝난 뒤에)
async function runProbe() {
  if (!needCreds()) return;
  if (!RESULT.timing) { status('멈춤: 표시 시간 측정을 먼저 할 것'); return; }
  const out = [];
  const seen = new Set();
  for (const r of RESULT.timing.runs) {
    if (r.open_type !== 'again' || seen.has(r.url)) continue;
    seen.add(r.url);
    const { rec } = await request(r.url, { headers: { ...(r.path === 'D' ? hD() : hR(S.creds.keep)), Range: 'bytes=0-0' } });
    out.push({ doc: r.doc, path: r.path, url_run: r.url_run, status: rec.status, cache_control: rec.headers ? rec.headers.cache_control : null, cf_cache_status: rec.headers ? rec.headers.cf_cache_status : null, age: rec.headers ? rec.headers.age : null, error: rec.error ?? null });
  }
  RESULT.cache_probe = { note: '"같은 주소로 다시 요청"에 쓴 주소에 1바이트 범위 요청을 보낸 응답의 캐시 관련 머리글. null 은 브라우저에서 관측 불가일 수 있다.', probes: out };
  $('out-probe').innerHTML = table(['doc', '경로', '상태', 'Cache-Control', 'cf-cache-status', 'Age'], out.map((x) => [x.doc, x.path, x.status || x.error, x.cache_control ?? '관측 불가', x.cf_cache_status ?? '관측 불가', x.age ?? '관측 불가']));
  autoSave();
}

// ---------------------------------------------------------------------
// 6. 판정 (계약의 통과 기준 그대로)
function computeVerdict() {
  const reasons = [];
  const summary = timingSummary();
  const req = summary.filter((x) => x.required_for_verdict);
  const runs = RESULT.timing ? RESULT.timing.runs.filter((r) => REQUIRED_DOCS.includes(r.doc)) : [];
  const displayFailures = runs.filter((r) => !r.ok).length;
  const expectedCells = REQUIRED_DOCS.length * 2 * 3;
  const timingComplete = req.length === expectedCells && req.every((x) => x.complete);
  if (!timingComplete) reasons.push('필수 크기(160·68)의 표시 시간 측정이 조건마다 5회씩 다 차지 않았다');
  if (displayFailures > 0) reasons.push(`표시 실패 ${displayFailures}건`);
  const slow = req.filter((x) => x.ok === false);
  for (const x of slow) reasons.push(`doc ${x.doc} · ${x.open_type} · ${x.page}: R 중앙값이 D 보다 ${x.diff_median_ms}ms 느리다(기준 +${x.limit_ms}ms)`);
  let rangeErrors = null;
  if (RESULT.range_check && REQUIRED_DOCS.every((d) => RESULT.range_check.docs[d])) rangeErrors = REQUIRED_DOCS.reduce((a, d) => a + RESULT.range_check.docs[d].D.errors + RESULT.range_check.docs[d].R.errors, 0);
  if (rangeErrors === null) reasons.push('필수 크기의 범위 응답 대조를 하지 않았다');
  else if (rangeErrors > 0) reasons.push(`잘못된 범위·바이트 ${rangeErrors}건`);
  const lo = RESULT.post_logout ? RESULT.post_logout.verdict : 'not_run';
  const loDocs = RESULT.post_logout && RESULT.post_logout.post ? REQUIRED_DOCS.every((d) => RESULT.post_logout.post.same_url[d]) : false;
  if (lo !== 'pass' || !loDocs) reasons.push(lo === 'fail' ? '종료 뒤 요청에 보호 본문이 전달됐다' : lo === 'pass' ? '종료 뒤 시험에 필수 크기가 빠졌다' : `종료 뒤 시험: ${lo === 'not_run' ? '하지 않음' : '미확인이 남음'}`);
  const pass = reasons.length === 0;
  const failed = displayFailures > 0 || slow.length > 0 || (rangeErrors || 0) > 0 || lo === 'fail';
  return {
    rule: '필수 판정 대상 160·68. 크기별·열기 유형별로 D·R 각각 5회의 중앙값을 견준다(두 열기 유형 모두). 표시 실패 0, 잘못된 범위·바이트 0, 종료 뒤 같은 주소·새 주소·범위·HEAD 전부 401/403 이고 본문 0(미확인이 있으면 통과 아님). R 중앙값 − D 중앙값: 첫 쪽 +1000ms 이내, 중간·끝 쪽 +500ms 이내. 34 는 표에만 적고 판정에 넣지 않는다.',
    result: pass ? 'pass' : failed ? 'fail' : 'not_decided', pass, display_failures: displayFailures, range_byte_errors: rangeErrors, post_logout: lo, timing: summary, reasons,
    caveat: '후보 선정 기준이지 운영 보장이 아니다. 한 기기·한 회선·합성 PDF·회원 판정 1회의 값이다(절차.md 의 한계).',
  };
}
function renderVerdict() {
  const v = RESULT.verdict = computeVerdict();
  if (RESULT.timing) renderTiming();
  $('out-verdict').innerHTML = `<p><b>판정: <span class="${v.pass ? 'ok' : v.result === 'fail' ? 'bad' : 'unk'}">${v.pass ? '통과' : v.result === 'fail' ? '통과 아님(기준 미달)' : '아직 판정할 수 없음'}</span></b> — 표시 실패 ${v.display_failures} · 잘못된 범위·바이트 ${v.range_byte_errors ?? '안 함'} · 종료 뒤 시험 ${v.post_logout}</p>` + (v.reasons.length ? '<ul>' + v.reasons.map((r) => `<li>${esc(r)}</li>`).join('') + '</ul>' : '') + `<p class="note">${esc(v.caveat)}</p>`;
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
  RESULT.environment = { user_agent: navigator.userAgent, origin: location.origin, device_pixel_ratio: window.devicePixelRatio || 1, viewer_box_css_px: box, zoom: '맞춤 배율 × 1.0(뷰어의 기본)', pdfjs_version: pdfjsLib.version, connection: { effective_type: conn.effectiveType ?? null, downlink_mbps: conn.downlink ?? null, rtt_ms: conn.rtt ?? null, note: '브라우저가 어림한 값이다' } };
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
