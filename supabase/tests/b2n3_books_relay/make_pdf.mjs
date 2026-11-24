#!/usr/bin/env node
// =====================================================================
// 보안작업 묶음 2 — 계약 2-나-3 (나) 합성 PDF 만들기 (네트워크 요청 0, 외부 패키지 0)
//
// 무엇을 만드는가
//   운영 books 버킷의 큰 파일과 "크기·쪽수만" 같은 합성 PDF 셋. 운영 파일의 내용·구조는 열어 보지 않았다 —
//   이 파일의 구조(아래)가 운영 파일과 같다는 보장은 없다(절차.md 의 한계).
//     doc 160 : 160,747,531 바이트 · 344쪽   (필수 판정 대상)
//     doc 68  :  68,670,943 바이트 · 246쪽   (필수 판정 대상)
//     doc 34  :  34,408,972 바이트 · 292쪽   (참고 측정)
//   크기는 목표와 바이트까지 같게 만든다(허용오차는 ±0.1% — 벗어나면 종료 값 1).
//
// 파일의 구조 (흔한 구조, 선형화 없음)
//   머리 → 목록 객체 4개(Catalog · Pages(쪽 전체의 Kids) · Font(Helvetica, 내장 없음) · Info)
//   → 쪽마다 객체 3개(Page · 내용 스트림 · 그림 XObject) → 채움 주석 → 상호 참조표(xref) → trailer → %%EOF
//   - 쪽마다 글자로 두 줄을 그린다:  "B2N3 <표식> DOC <doc>"  /  "PAGE <쪽 4자리> OF <전체 4자리>"
//     (측정 화면이 그 쪽에서 글자를 뽑아 맞는 쪽이 그려졌는지 본다)
//   - 크기는 쪽마다 넣는 압축하지 않은 회색 그림(폭 512, 8비트)의 무작위 바이트로 고르게 채운다.
//     그림은 그 쪽에 실제로 그려진다 — 그 쪽을 그리려면 그 쪽의 바이트를 받아야 한다.
//   - 무작위 바이트는 표식과 doc 으로 정해지는 열쇠의 AES-256-CTR 열쇠줄이다. 같은 표식이면 같은 파일이 다시 나온다.
//
// 쓰는 법
//   node make_pdf.mjs [--marker <소문자·숫자 4~16자>] [--out-dir <폴더>] [--docs 160,68,34]
//     --marker   주지 않으면 무작위 8자를 만든다. 객체 이름이 zzb2n3_<표식>_160.pdf 가 된다
//     --out-dir  기본값은 이 폴더의 _local/<표식>/  (_local 은 .gitignore 에 있다 — 커밋하지 않는다)
//   결과: <out-dir>/zzb2n3_<표식>_<doc>.pdf 셋 + <out-dir>/manifest.json (md5·sha256·크기·쪽수)
//   표준 출력에도 같은 JSON 을 적는다.
// 종료 값: 0 = 셋 다 만들었고 크기·쪽수·구조 확인이 맞음 / 1 = 어긋남 / 2 = 인자가 잘못됨
// =====================================================================
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { openSync, writeSync, closeSync, readSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SPECS = [
  { doc: '160', bytes: 160747531, pages: 344, required: true, like: 'aus_intro' },
  { doc: '68', bytes: 68670943, pages: 246, required: true, like: 'aus_reading' },
  { doc: '34', bytes: 34408972, pages: 292, required: false, like: 'intro-v3' },
];
const TOLERANCE = 0.001; // ±0.1% (계약에서 고정)
const IMG_W = 512;
const MEDIA = [595, 842];

function stop(code, msg) { console.error(`[make_pdf] 멈춤: ${msg}`); process.exit(code); }
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

const L1 = (s) => Buffer.from(s, 'latin1');
const pad = (n, w) => String(n).padStart(w, '0');
export const pageTokens = (marker, doc, page, pages) => [`B2N3 ${marker} DOC ${doc}`, `PAGE ${pad(page, 4)} OF ${pad(pages, 4)}`];
export const objectName = (marker, doc) => `zzb2n3_${marker}_${doc}.pdf`;

// 그림 말고의 조각을 전부 글자로 만든다. heights 는 쪽마다의 그림 높이(줄 수).
function layout(spec, marker, heights) {
  const N = spec.pages;
  const objNo = (i) => ({ page: 5 + 3 * i, contents: 6 + 3 * i, image: 7 + 3 * i });
  const head = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const kids = [];
  for (let i = 0; i < N; i++) kids.push(`${objNo(i).page} 0 R`);
  const kidsText = kids.reduce((acc, k, i) => acc + k + ((i + 1) % 12 === 0 ? '\n' : ' '), '');
  const fixed = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Count ${N} /Kids [\n${kidsText}\n] >>\nendobj\n`,
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
    `4 0 obj\n<< /Title (B2N3 synthetic ${marker} doc ${spec.doc}) /Producer (b2n3 make_pdf) >>\nendobj\n`,
  ];
  const pagesOut = [];
  for (let i = 0; i < N; i++) {
    const o = objNo(i);
    const [t1, t2] = pageTokens(marker, spec.doc, i + 1, N);
    const content = `BT /F1 26 Tf 60 790 Td (${t1}) Tj ET\nBT /F1 40 Tf 60 735 Td (${t2}) Tj ET\nq 475 0 0 600 60 90 cm /Im1 Do Q\n`;
    const len = IMG_W * heights[i];
    pagesOut.push({
      pageObj: `${o.page} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${MEDIA[0]} ${MEDIA[1]}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 ${o.image} 0 R >> >> /Contents ${o.contents} 0 R >>\nendobj\n`,
      contentsObj: `${o.contents} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      imageHead: `${o.image} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${IMG_W} /Height ${heights[i]} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${len} >>\nstream\n`,
      imageLen: len,
      imageTail: `\nendstream\nendobj\n`,
    });
  }
  let bodyLen = head.length + fixed.reduce((a, s) => a + s.length, 0);
  for (const p of pagesOut) bodyLen += p.pageObj.length + p.contentsObj.length + p.imageHead.length + p.imageLen + p.imageTail.length;
  const objCount = 4 + 3 * N;
  const idHex = createHash('md5').update(`b2n3|${marker}|${spec.doc}`).digest('hex');
  const tail = (xrefOffset, offsets) => {
    let x = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
    for (let k = 1; k <= objCount; k++) x += `${pad(offsets ? offsets[k] : 0, 10)} 00000 n \n`;
    x += `trailer\n<< /Size ${objCount + 1} /Root 1 0 R /Info 4 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return x;
  };
  return { head, fixed, pagesOut, bodyLen, objCount, tail, objNo };
}

// 목표 바이트에 정확히 맞는 쪽별 그림 높이와 채움 주석 길이를 찾는다.
function fit(spec, marker) {
  const N = spec.pages;
  let heights = new Array(N).fill(Math.max(1, Math.floor((spec.bytes - 500 * N - 40000) / N / IMG_W)));
  for (let round = 0; round < 40; round++) {
    const lay = layout(spec, marker, heights);
    let filler = null;
    for (let digits = 6; digits <= 11; digits++) {
      const f = spec.bytes - lay.bodyLen - lay.tail('9'.repeat(digits)).length;
      if (String(lay.bodyLen + f).length === digits) { filler = f; break; }
    }
    if (filler === null) stop(1, `doc ${spec.doc}: 상호 참조표 위치의 자릿수를 정하지 못했다`);
    if (filler >= 2 && filler < IMG_W + 64) return { heights, filler, lay };
    if (filler < 2) { // 한 줄씩 덜어 낸다
      const need = Math.ceil((2 - filler) / IMG_W);
      for (let k = 0; k < need; k++) heights[k % N] -= 1;
    } else { // 남는 만큼 줄을 고르게 더한다(자릿수가 늘 여유 48바이트를 남긴다)
      const rows = Math.floor((filler - 48) / IMG_W);
      const each = Math.floor(rows / N);
      const rest = rows % N;
      heights = heights.map((h, i) => h + each + (i < rest ? 1 : 0));
    }
    if (heights.some((h) => h < 1)) stop(1, `doc ${spec.doc}: 목표 크기가 너무 작아 쪽마다 그림을 넣을 수 없다`);
  }
  stop(1, `doc ${spec.doc}: 목표 크기에 맞추지 못했다`);
}

function build(spec, marker, outDir) {
  const { heights, filler, lay } = fit(spec, marker);
  const name = objectName(marker, spec.doc);
  const path = join(outDir, name);
  if (existsSync(path)) stop(1, `${path} 가 이미 있다. 덮어쓰지 않는다(다른 --marker 나 --out-dir 을 쓰거나 그 파일을 직접 치울 것)`);
  const fd = openSync(path, 'wx');
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  let offset = 0;
  const offsets = new Array(lay.objCount + 1).fill(0);
  const put = (buf) => { writeSync(fd, buf); md5.update(buf); sha.update(buf); offset += buf.length; };
  // 무작위 바이트: 표식·doc 으로 정해지는 열쇠줄(같은 표식이면 같은 파일)
  const cipher = createCipheriv('aes-256-ctr', createHash('sha256').update(`b2n3|${marker}|${spec.doc}`).digest(), Buffer.alloc(16));
  put(L1(lay.head));
  lay.fixed.forEach((s, i) => { offsets[i + 1] = offset; put(L1(s)); });
  lay.pagesOut.forEach((p, i) => {
    const o = lay.objNo(i);
    offsets[o.page] = offset; put(L1(p.pageObj));
    offsets[o.contents] = offset; put(L1(p.contentsObj));
    offsets[o.image] = offset; put(L1(p.imageHead));
    put(cipher.update(Buffer.alloc(p.imageLen)));
    put(L1(p.imageTail));
  });
  const fill = Buffer.alloc(filler, 0x20);
  fill[0] = 0x25; // '%' — 주석
  fill[filler - 1] = 0x0a;
  put(fill);
  const xrefOffset = offset;
  put(L1(lay.tail(xrefOffset, offsets)));
  closeSync(fd);

  // 스스로 확인: 크기, 상호 참조표의 위치마다 "<번호> 0 obj" 가 있는가, 쪽 수
  const size = statSync(path).size;
  const problems = [];
  if (size !== offset) problems.push(`쓴 바이트(${offset})와 파일 크기(${size})가 다르다`);
  const rfd = openSync(path, 'r');
  const probe = Buffer.alloc(24);
  for (let k = 1; k <= lay.objCount; k++) {
    readSync(rfd, probe, 0, 24, offsets[k]);
    if (!probe.toString('latin1').startsWith(`${k} 0 obj\n`)) { problems.push(`상호 참조표의 ${k}번 위치에 그 객체가 없다`); break; }
  }
  const tailBuf = Buffer.alloc(64);
  readSync(rfd, tailBuf, 0, 64, size - 64);
  closeSync(rfd);
  const m = /startxref\n(\d+)\n%%EOF\n$/.exec(tailBuf.toString('latin1'));
  if (!m || Number(m[1]) !== xrefOffset) problems.push('파일 끝의 startxref 가 상호 참조표 위치와 다르다');
  const deviation = (size - spec.bytes) / spec.bytes;
  if (Math.abs(deviation) > TOLERANCE) problems.push(`크기가 목표의 ±0.1% 밖이다(${(deviation * 100).toFixed(4)}%)`);
  return {
    doc: spec.doc, required_for_verdict: spec.required, same_size_and_pages_as: spec.like,
    file: name, object_name: name, bucket: 'books',
    bytes: size, target_bytes: spec.bytes, deviation_ratio: deviation, within_tolerance: Math.abs(deviation) <= TOLERANCE,
    pages: spec.pages, md5: md5.digest('hex'), sha256: sha.digest('hex'),
    page_text: { line1: `B2N3 ${marker} DOC ${spec.doc}`, line2_format: 'PAGE <쪽 4자리> OF <전체 4자리>' },
    structure: { linearized: false, xref: '파일 끝(상호 참조표)', xref_offset: xrefOffset, objects: lay.objCount, page_tree: '한 단(Pages 객체 하나에 쪽 전체) — 파일 앞', image: { width: IMG_W, rows_min: Math.min(...heights), rows_max: Math.max(...heights), colorspace: 'DeviceGray 8비트, 압축 없음' }, filler_comment_bytes: filler },
    problems,
  };
}

function main() {
  const marker = arg('--marker') ?? randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (!/^[a-z0-9]{4,16}$/.test(marker)) stop(2, '--marker 는 소문자·숫자 4~16자');
  const want = (arg('--docs') ?? '160,68,34').split(',').map((s) => s.trim());
  const specs = SPECS.filter((s) => want.includes(s.doc));
  if (specs.length !== want.length) stop(2, '--docs 는 160,68,34 중에서');
  const outDir = resolve(arg('--out-dir') ?? join(HERE, '_local', marker));
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  if (existsSync(manifestPath)) stop(1, `${manifestPath} 가 이미 있다. 덮어쓰지 않는다`);
  const docs = [];
  for (const spec of specs) {
    const t0 = Date.now();
    const d = build(spec, marker, outDir);
    console.error(`[make_pdf] doc ${d.doc}: ${d.bytes.toLocaleString('en-US')} 바이트(목표와 차이 ${d.bytes - d.target_bytes}) · ${d.pages}쪽 · md5 ${d.md5} · ${Date.now() - t0}ms${d.problems.length ? ' · 어긋남: ' + d.problems.join(' / ') : ''}`);
    docs.push(d);
  }
  const manifest = {
    tool: 'b2n3 make_pdf.mjs', marker, created_at: new Date().toISOString(), out_dir: outDir,
    note: '합성 파일이다. 운영 파일의 크기·쪽수만 같게 했고 구조는 같다고 볼 수 없다. 원본은 범위 응답 대조에 쓰므로 실측이 끝날 때까지 지우지 않는다.',
    docs,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  console.error(`[make_pdf] 결과: ${manifestPath}`);
  process.exit(docs.some((d) => d.problems.length) ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
