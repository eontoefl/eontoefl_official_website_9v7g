#!/usr/bin/env node
// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-3 (나) 합성 PDF 올리기·지우기 (시험 프로젝트 hmncdheiwqwekdbtijar 의 books 버킷만)
//
// 이 파일은 작업방이 실제 Storage 에 돌려 본 적이 없다(가짜 응답으로만 돌려 봤다 — 가짜 응답은 실제 동작을 대신하지 않는다).
// 이어 올리기(TUS)의 요청 모양은 Supabase 문서의 것이다: POST /storage/v1/upload/resumable (Upload-Metadata 에
// bucketName·objectName·contentType·cacheControl), 받은 Location 에 6MiB 씩 PATCH. 틀리면 응답을 그대로 적고 멈춘다.
//
// 쓰는 법
//   올리기:  node upload.mjs --manifest <make_pdf 의 manifest.json> --out <결과 json> [--docs 160,68,34] [--adopt]
//   지우기:  node upload.mjs --remove <올리기 결과 json> --out <지우기 결과 json>
//   계획만:  node upload.mjs --manifest <…> --plan            (요청 0)
// 환경 변수: B2N3_URL (정확히 https://hmncdheiwqwekdbtijar.supabase.co), B2N3_SERVICE_KEY (시험 프로젝트의 service_role 키)
//
// 올리기가 하는 일(순서대로. 앞 단계가 어긋나면 뒤 단계의 요청을 보내지 않는다)
//   0. 요청 전: 주소·열쇠 확인, 로컬 원본의 크기·sha256 이 manifest 와 같은지
//   1. 버킷 조회: books 가 있고 비공개인지(아니면 "기준선 불일치"로 멈춤), 버킷 크기 제한
//   2. 이름마다 정보 조회: 같은 이름이 이미 있으면 덮어쓰지 않고 멈춤(올리기 요청에도 x-upsert 를 보내지 않는다)
//   3. 이어 올리기(TUS). 끊기면 받은 위치(HEAD 의 Upload-Offset)부터 이어 보낸다(이 실행 안에서만)
//   4. 정보 조회로 크기·형식·캐시 설정 확인, 객체 ID 기록
//   5. 내용 대조: eTag 를 md5 로 가정하지 않는다. 앞·중간·끝 구간을 범위 요청으로 받아 로컬 원본의 같은 구간과 바이트로 견준다
// 지우기: 결과 파일의 객체마다 "이름과 객체 ID 가 둘 다 지금의 객체와 같을 때만" 지운다.
//   하나라도 ID 가 다르거나 읽지 못하면 아무것도 지우지 않고 멈춘다(종료 값 4). 지운 뒤 이름마다 "없음"을 확인한다.
//
// 종료 값: 0 = 끝까지 맞음 / 1 = 어긋남·실패 / 2 = 요청 전에 멈춤(주소·열쇠·인자·로컬 파일) /
//          3 = 기준선 불일치(버킷) / 4 = 같은 이름이 이미 있음(올리기) 또는 ID 불일치(지우기) — 아무것도 덮어쓰거나 지우지 않음
// =====================================================================
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, readFileSync, writeFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const TEST_URL = 'https://hmncdheiwqwekdbtijar.supabase.co';
const REF = 'hmncdheiwqwekdbtijar';
const BUCKET = 'books';
const NAME_RE = /^zzb2n3_[a-z0-9]{4,16}_(160|68|34)\.pdf$/;
const CHUNK = 6 * 1024 * 1024; // Supabase 문서: 6MB 로 고정
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
let requestCount = 0;
const log = (m) => console.error(`[b2n3 upload] ${m}`);
function stop(code, msg) { log(`멈춤: ${msg}${requestCount === 0 ? ' — 아무 요청도 보내지 않았다' : ''}`); process.exit(code); }

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}

let KEY = null;
let keyNote = null;
function checkTarget() {
  if (process.env.B2N3_URL !== TEST_URL) stop(2, `B2N3_URL 이 정확히 ${TEST_URL} 가 아니다`);
  KEY = process.env.B2N3_SERVICE_KEY;
  if (!KEY) stop(2, 'B2N3_SERVICE_KEY 가 필요하다');
  const p = decodeJwtPayload(KEY);
  if (p) {
    if (p.ref !== REF) stop(2, 'B2N3_SERVICE_KEY 의 ref 가 시험 프로젝트가 아니다');
    if (p.role !== 'service_role') stop(2, 'B2N3_SERVICE_KEY 의 role 이 service_role 이 아니다');
    keyNote = 'jwt: ref·role 확인함';
  } else keyNote = 'jwt 모양이 아님: 열쇠에서 ref 를 확인하지 못함(주소로만 확인)';
}

// 모든 요청은 TEST_URL 아래로만 간다. 열쇠는 머리글로만 실리고 어디에도 적지 않는다.
async function http(method, pathOrUrl, { headers = {}, body, raw = false } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : TEST_URL + pathOrUrl;
  if (new URL(url).origin !== TEST_URL) stop(1, `시험 프로젝트가 아닌 주소로 가는 요청을 막았다: ${new URL(url).origin}`);
  requestCount++;
  const res = await fetch(url, { method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...headers }, body, redirect: 'manual' });
  const buf = raw ? Buffer.from(await res.arrayBuffer()) : null;
  const text = raw ? null : await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아님 */ } }
  return { status: res.status, h: (n) => res.headers.get(n), text, json, buf };
}
const show = (r) => `HTTP ${r.status} ${String(r.text ?? '').slice(0, 600)}`;
const encName = (n) => n.split('/').map(encodeURIComponent).join('/');

// 정보 조회: 있음(200) / 없음(관측된 모양 하나 — HTTP 400 · statusCode 404 · NoSuchKey, 또는 HTTP 404) / 그 밖은 모름
async function info(name) {
  const r = await http('GET', `/storage/v1/object/info/authenticated/${BUCKET}/${encName(name)}`);
  if (r.status === 200 && r.json && r.json.id) return { state: 'present', meta: r.json, r };
  const sc = r.json?.statusCode != null ? String(r.json.statusCode) : null;
  const code = String(r.json?.code ?? r.json?.error ?? '');
  if ((r.status === 400 && sc === '404' && code === 'NoSuchKey') || (r.status === 404 && (sc === '404' || sc === null))) return { state: 'absent', r };
  return { state: 'unknown', r };
}

function localRange(path, start, end) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(end - start + 1);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  return buf;
}
function sha256File(path) {
  return new Promise((ok, bad) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad);
  });
}
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function writeOut(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2), 'utf8'); }

// ---------------------------------------------------------------------
async function tusUpload(name, path, size, onProgress) {
  const create = await http('POST', '/storage/v1/upload/resumable', {
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(size),
      'Upload-Metadata': `bucketName ${b64(BUCKET)},objectName ${b64(name)},contentType ${b64('application/pdf')},cacheControl ${b64('3600')}`,
      // x-upsert 를 보내지 않는다 — 같은 이름이 있으면 덮어쓰지 않는다
    },
  });
  if (create.status !== 201 || !create.h('location')) return { ok: false, step: 'create', detail: show(create) };
  const loc = new URL(create.h('location'), TEST_URL);
  if (loc.origin !== TEST_URL) return { ok: false, step: 'create', detail: `올리기 주소가 시험 프로젝트 주소가 아니다(${loc.origin}). 그 주소로는 보내지 않는다` };
  const fd = openSync(path, 'r');
  let offset = 0;
  let netFails = 0;
  const chunks = [];
  try {
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, offset);
      let r;
      try {
        r = await http('PATCH', loc.href, { headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }, body: buf });
      } catch (e) {
        // 네트워크가 끊김: 서버가 받은 위치를 물어 거기서 잇는다
        if (netFails >= RETRY_DELAYS.length) return { ok: false, step: 'patch', detail: `네트워크 오류가 ${netFails + 1}번 — ${String(e?.message ?? e).slice(0, 200)}`, offset };
        await sleep(RETRY_DELAYS[netFails++]);
        let head;
        try { head = await http('HEAD', loc.href, { headers: { 'Tus-Resumable': '1.0.0' } }); } catch { continue; }
        const srv = Number(head.h('upload-offset'));
        if (head.status !== 200 && head.status !== 204) return { ok: false, step: 'resume', detail: `받은 위치를 묻는 요청이 HTTP ${head.status}`, offset };
        if (!Number.isInteger(srv) || srv < 0 || srv > size) return { ok: false, step: 'resume', detail: `받은 위치(Upload-Offset)를 읽지 못했다`, offset };
        log(`  끊김 → 서버가 받은 위치 ${srv.toLocaleString('en-US')} 부터 잇는다`);
        offset = srv;
        continue;
      }
      if (r.status !== 204) return { ok: false, step: 'patch', detail: show(r), offset };
      const next = Number(r.h('upload-offset'));
      if (next !== offset + len) return { ok: false, step: 'patch', detail: `Upload-Offset 이 ${offset + len} 이 아니라 ${r.h('upload-offset')}`, offset };
      chunks.push(len);
      offset = next;
      onProgress(offset);
    }
  } finally { closeSync(fd); }
  return { ok: true, patches: chunks.length, network_retries: netFails };
}

function rangesFor(size) {
  const mid = Math.floor(size / 2);
  const K64 = 65536, M1 = 1048576;
  return [
    { where: '앞', start: 0, end: K64 - 1 }, { where: '앞', start: 0, end: M1 - 1 },
    { where: '중간', start: mid, end: mid + K64 - 1 }, { where: '중간', start: mid, end: mid + M1 - 1 },
    { where: '끝', start: size - K64, end: size - 1 }, { where: '끝', start: size - M1, end: size - 1 },
  ];
}
async function compareRanges(name, path, size) {
  const out = [];
  for (const g of rangesFor(size)) {
    const r = await http('GET', `/storage/v1/object/authenticated/${BUCKET}/${encName(name)}`, { headers: { Range: `bytes=${g.start}-${g.end}` }, raw: true });
    const want = localRange(path, g.start, g.end);
    const rec = {
      where: g.where, range: `bytes=${g.start}-${g.end}`, http_status: r.status, content_range: r.h('content-range'), content_length: r.h('content-length'),
      cache_control: r.h('cache-control'), content_type: r.h('content-type'), received_bytes: r.buf.length,
      status_ok: r.status === 206, content_range_ok: r.h('content-range') === `bytes ${g.start}-${g.end}/${size}`, bytes_equal: r.buf.equals(want),
    };
    rec.ok = rec.status_ok && rec.content_range_ok && rec.bytes_equal;
    out.push(rec);
  }
  return out;
}

async function doUpload() {
  const manifestPath = arg('--manifest');
  if (!manifestPath || !existsSync(manifestPath)) stop(2, '--manifest <make_pdf 의 manifest.json> 이 필요하다');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const want = (arg('--docs') ?? manifest.docs.map((d) => d.doc).join(',')).split(',').map((s) => s.trim());
  const docs = manifest.docs.filter((d) => want.includes(d.doc));
  if (!docs.length || docs.length !== want.length) stop(2, '--docs 가 manifest 에 없는 것을 가리킨다');
  const dir = dirname(resolve(manifestPath));
  for (const d of docs) {
    if (!NAME_RE.test(d.object_name) || d.object_name !== `zzb2n3_${manifest.marker}_${d.doc}.pdf`) stop(2, `객체 이름이 zzb2n3_<표식>_<doc>.pdf 모양이 아니다: ${d.object_name}`);
    d.path = join(dir, d.file);
    if (!existsSync(d.path)) stop(2, `로컬 원본이 없다: ${d.path}`);
    if (statSync(d.path).size !== d.bytes) stop(2, `로컬 원본의 크기가 manifest 와 다르다: ${d.file}`);
  }
  if (has('--plan')) {
    console.log(JSON.stringify({ plan: true, target: TEST_URL, bucket: BUCKET, objects: docs.map((d) => ({ doc: d.doc, name: d.object_name, bytes: d.bytes, patches: Math.ceil(d.bytes / CHUNK), content_type: 'application/pdf', cache_control: 'max-age=3600' })), upload_bytes_total: docs.reduce((a, d) => a + d.bytes, 0), verify_download_bytes_total: docs.length * (2 * 65536 + 2 * 1048576 + 65536 + 1048576) }, null, 2));
    return 0;
  }
  const outPath = arg('--out');
  if (!outPath) stop(2, '--out <결과 json> 이 필요하다');
  const prior = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null;
  if (prior && !has('--adopt')) stop(2, `${outPath} 가 이미 있다. 덮어쓰지 않는다(끊긴 올리기를 이어 확인하려면 --adopt)`);
  checkTarget();
  for (const d of docs) { if ((await sha256File(d.path)) !== d.sha256) stop(2, `로컬 원본의 sha256 이 manifest 와 다르다: ${d.file}`); }

  const result = { tool: 'b2n3 upload.mjs', mode: 'upload', target: TEST_URL, bucket: BUCKET, marker: manifest.marker, started_at: new Date().toISOString(), key_check: keyNote, bucket_check: null, objects: [], problems: [] };
  const save = () => { result.request_count = requestCount; writeOut(outPath, result); };
  const fail = (code, msg) => { result.problems.push(msg); result.finished_at = new Date().toISOString(); save(); log(`멈춤: ${msg}`); log(`결과: ${outPath}`); process.exit(code); };

  // 1. 버킷
  const b = await http('GET', `/storage/v1/bucket/${BUCKET}`);
  result.bucket_check = { http_status: b.status, public: b.json?.public ?? null, file_size_limit: b.json?.file_size_limit ?? null, allowed_mime_types: b.json?.allowed_mime_types ?? null };
  if (b.status !== 200 || b.json?.id !== BUCKET) fail(3, `기준선 불일치: books 버킷 설정을 읽지 못했다(${show(b)})`);
  if (b.json.public !== false) fail(3, '기준선 불일치: books 버킷이 비공개가 아니다');
  const limit = b.json.file_size_limit;
  if (limit != null && docs.some((d) => d.bytes > Number(limit))) fail(3, `기준선 불일치: books 버킷의 크기 제한(${limit})이 올릴 파일보다 작다`);

  // 2. 같은 이름이 이미 있는가 — 전부 본 뒤에 올리기를 시작한다
  const adopt = {};
  for (const d of docs) {
    const i = await info(d.object_name);
    const was = prior?.objects?.find((o) => o.name === d.object_name);
    if (i.state === 'absent') continue;
    if (i.state === 'present' && has('--adopt') && was && (was.state === 'started' || was.state === 'verified' || was.state === 'uploaded')) { adopt[d.doc] = i.meta; continue; }
    if (i.state === 'present') fail(4, `같은 이름이 이미 있다: ${d.object_name} (id ${i.meta.id}, 크기 ${i.meta.size}). 덮어쓰지 않는다`);
    fail(1, `${d.object_name} 이 있는지 읽지 못했다(${show(i.r)})`);
  }

  // 3~5
  for (const d of docs) {
    const rec = { doc: d.doc, bucket: BUCKET, name: d.object_name, bytes_local: d.bytes, sha256_local: d.sha256, state: 'started', adopted: !!adopt[d.doc] };
    result.objects.push(rec);
    save();
    if (!adopt[d.doc]) {
      log(`doc ${d.doc}: ${d.object_name} 올리기 시작(${d.bytes.toLocaleString('en-US')} 바이트, ${Math.ceil(d.bytes / CHUNK)}조각)`);
      const t0 = Date.now();
      let lastShown = 0;
      const up = await tusUpload(d.object_name, d.path, d.bytes, (off) => { if (off - lastShown >= 30 * 1024 * 1024 || off === d.bytes) { lastShown = off; log(`  ${Math.floor((off / d.bytes) * 100)}%`); } });
      rec.upload = { ...up, ms: Date.now() - t0 };
      if (!up.ok) fail(1, `doc ${d.doc} 올리기 실패(${up.step}): ${up.detail}`);
      rec.state = 'uploaded';
      save();
    } else log(`doc ${d.doc}: 끊긴 올리기가 남긴 객체를 확인해 받아들인다(--adopt)`);
    const i = await info(d.object_name);
    if (i.state !== 'present') fail(1, `doc ${d.doc}: 올린 뒤 정보 조회가 객체를 돌려주지 않는다(${show(i.r)})`);
    const m = i.meta;
    Object.assign(rec, { id: m.id, size: m.size ?? null, etag: m.etag ?? null, content_type: m.content_type ?? m.contentType ?? null, cache_control: m.cache_control ?? m.cacheControl ?? null, created_at: m.created_at ?? null, last_modified: m.last_modified ?? null });
    rec.size_ok = Number(rec.size) === d.bytes;
    rec.content_type_ok = rec.content_type == null ? null : rec.content_type === 'application/pdf';
    rec.ranges = await compareRanges(d.object_name, d.path, d.bytes);
    if (rec.cache_control == null) rec.cache_control = rec.ranges[0]?.cache_control ?? null; // 정보 조회에 없으면 범위 응답의 머리글
    if (rec.content_type == null) { rec.content_type = rec.ranges[0]?.content_type ?? null; rec.content_type_ok = rec.content_type == null ? null : rec.content_type === 'application/pdf'; }
    rec.cache_control_ok = rec.cache_control == null ? null : /(^|[,\s])max-age=3600(\s|,|$)/.test(rec.cache_control);
    rec.ranges_ok = rec.ranges.every((x) => x.ok);
    rec.note = 'eTag 는 전체 md5 로 가정하지 않았다. 내용 일치는 범위 여섯 개의 바이트 대조로만 본 것이다(전체 대조가 아니다).';
    const bad = [];
    if (!rec.size_ok) bad.push(`크기 ${rec.size} ≠ ${d.bytes}`);
    if (rec.content_type_ok !== true) bad.push(`형식 ${rec.content_type ?? '읽지 못함'}`);
    if (rec.cache_control_ok !== true) bad.push(`캐시 설정 ${rec.cache_control ?? '읽지 못함'}`);
    if (!rec.ranges_ok) bad.push('구간 대조 어긋남');
    if (bad.length) { save(); fail(1, `doc ${d.doc}: ${bad.join(' / ')}. 객체는 남아 있다(id ${rec.id}) — --remove 로 지울 수 있다`); }
    rec.state = 'verified';
    save();
    log(`doc ${d.doc}: 확인 끝 — id ${rec.id}, 크기 ${rec.size}, 구간 6개 일치`);
  }
  result.finished_at = new Date().toISOString();
  result.all_verified = result.objects.every((o) => o.state === 'verified');
  save();
  log(`요청 ${requestCount}건 — 객체 ${result.objects.length}개 올림·확인`);
  log(`결과: ${outPath}`);
  return 0;
}

async function doRemove() {
  const src = arg('--remove');
  if (!src || !existsSync(src)) stop(2, '--remove <올리기 결과 json> 이 필요하다');
  const outPath = arg('--out');
  if (!outPath) stop(2, '--out <지우기 결과 json> 이 필요하다');
  if (existsSync(outPath)) stop(2, `${outPath} 가 이미 있다. 덮어쓰지 않는다`);
  const prior = JSON.parse(readFileSync(src, 'utf8'));
  if (prior.target !== TEST_URL || prior.bucket !== BUCKET) stop(2, '결과 파일의 대상이 시험 프로젝트의 books 가 아니다');
  const targets = (prior.objects ?? []).filter((o) => o.id);
  const noId = (prior.objects ?? []).filter((o) => !o.id);
  for (const o of prior.objects ?? []) if (o.bucket !== BUCKET || !NAME_RE.test(o.name)) stop(2, `결과 파일에 이 도구의 이름 모양이 아닌 객체가 있다: ${o.name}`);
  if (!targets.length && !noId.length) stop(2, '결과 파일에 객체가 없다');
  checkTarget();
  const result = { tool: 'b2n3 upload.mjs', mode: 'remove', target: TEST_URL, bucket: BUCKET, from: resolve(src), started_at: new Date().toISOString(), objects: [], problems: [] };
  // 먼저 전부 본다
  for (const o of [...targets, ...noId]) {
    const i = await info(o.name);
    const rec = { doc: o.doc, name: o.name, id_recorded: o.id ?? null, now: i.state, id_now: i.state === 'present' ? i.meta.id : null };
    rec.decision = i.state === 'absent' ? 'already_absent' : i.state !== 'present' ? 'unknown' : !o.id ? 'no_id_recorded' : i.meta.id === o.id ? 'delete' : 'id_differs';
    if (rec.decision === 'unknown') rec.response = show(i.r);
    result.objects.push(rec);
  }
  const blocked = result.objects.filter((r) => ['unknown', 'no_id_recorded', 'id_differs'].includes(r.decision));
  if (blocked.length) {
    result.problems.push(`이름과 객체 ID 가 둘 다 같다고 확인하지 못한 객체가 ${blocked.length}개다. 아무것도 지우지 않았다`);
    result.request_count = requestCount;
    writeOut(outPath, result);
    for (const r of blocked) log(`  ${r.name}: ${r.decision} (기록 ${r.id_recorded} / 지금 ${r.id_now})`);
    log(`멈춤: ${result.problems[0]}`);
    log(`결과: ${outPath}`);
    return 4;
  }
  for (const rec of result.objects.filter((r) => r.decision === 'delete')) {
    const d = await http('DELETE', `/storage/v1/object/${BUCKET}/${encName(rec.name)}`);
    rec.delete_status = d.status;
    if (d.status !== 200) rec.delete_response = show(d);
    const i = await info(rec.name);
    rec.after = i.state;
    if (i.state === 'present') rec.id_after = i.meta.id;
  }
  result.deleted = result.objects.filter((r) => r.decision === 'delete' && r.after === 'absent').length;
  result.already_absent = result.objects.filter((r) => r.decision === 'already_absent').length;
  result.not_gone = result.objects.filter((r) => r.decision === 'delete' && r.after !== 'absent').map((r) => r.name);
  result.finished_at = new Date().toISOString();
  result.request_count = requestCount;
  writeOut(outPath, result);
  log(`요청 ${requestCount}건 — 지움 ${result.deleted} · 이미 없음 ${result.already_absent} · 남은 것 ${result.not_gone.length}`);
  log(`결과: ${outPath}`);
  return result.not_gone.length ? 1 : 0;
}

const code = await (has('--remove') ? doRemove() : doUpload()).catch((e) => { log(`예외: ${String(e?.stack ?? e).slice(0, 800)}`); return 1; });
process.exit(code);
