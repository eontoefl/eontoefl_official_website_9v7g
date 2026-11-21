// ===== 형 검사 기록 =====
// 확인하는 것(2차 계약 2-4): "기존 오류 4건(v26 원본 335·908·1006·1353 = 수정본의 대응 줄) 유지, 신규 0".
// 오류의 수만 맞고 종류·위치가 다르면 실패한다.
//
// 실행(함수 폴더에서, 네트워크 권한 없음):
//   deno run --no-remote --no-lock --no-prompt --allow-read=. --allow-run tests/typecheck_record.ts
// `deno check`를 --no-remote로 세 번 부른다(v26 원본, 수정본 index.ts, callback-guard.ts).

type Found = { code: string; line: number; col: number };

const here = new URL(".", import.meta.url);
const ORIGINAL = new URL("./v26_original/index.ts", here);
const PATCHED = new URL("../index.ts", here);
const GUARD = new URL("../callback-guard.ts", here);

// v26 원본에 원래 있는 오류(전부 catch 안의 error.message)
const EXPECTED_ORIGINAL: Found[] = [
  { code: "TS18046", line: 335, col: 31 },
  { code: "TS18046", line: 908, col: 23 },
  { code: "TS18046", line: 1006, col: 24 },
  { code: "TS18046", line: 1353, col: 26 },
];

function fileName(url: URL): string {
  return decodeURIComponent(url.pathname).split("/").slice(-2).join("/");
}

async function check(target: URL): Promise<{ code: number; found: Found[]; raw: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["check", "--no-remote", "--no-lock", decodeURIComponent(target.pathname).replace(/^\/([A-Za-z]:)/, "$1")],
    env: { NO_COLOR: "1", DENO_NO_UPDATE_CHECK: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  const raw = new TextDecoder().decode(out.stderr) + new TextDecoder().decode(out.stdout);
  const found: Found[] = [];
  const lines = raw.split(/\r?\n/);
  let pending: string | null = null;
  for (const line of lines) {
    const m = line.match(/^(TS\d+) \[ERROR\]/);
    if (m) {
      pending = m[1];
      continue;
    }
    const at = line.match(/^\s+at .*:(\d+):(\d+)\s*$/);
    if (at && pending) {
      found.push({ code: pending, line: Number(at[1]), col: Number(at[2]) });
      pending = null;
    }
  }
  if (pending) found.push({ code: pending, line: -1, col: -1 }); // 위치를 읽지 못한 오류도 빠뜨리지 않는다
  const total = raw.match(/Found (\d+) errors?\./);
  if (total && Number(total[1]) !== found.length) {
    found.push({ code: `읽지 못한 오류 ${Number(total[1]) - found.length}건`, line: -1, col: -1 });
  }
  return { code: out.code, found, raw };
}

async function lines(url: URL): Promise<string[]> {
  return (await Deno.readTextFile(url)).replaceAll("\r\n", "\n").split("\n");
}

const problems: string[] = [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 1) v26 원본 줄 → 수정본 줄 대응표. 수정본은 v26에 줄을 추가만 했어야 한다.
const orig = await lines(ORIGINAL);
const patched = await lines(PATCHED);
const map = new Map<number, number>(); // v26 줄 번호 → 수정본 줄 번호(1부터)
let i = 0;
for (let j = 0; j < patched.length; j++) {
  if (i < orig.length && patched[j] === orig[i]) {
    map.set(i + 1, j + 1);
    i++;
  }
}
if (i !== orig.length) problems.push(`수정본이 v26에 줄 추가만 한 것이 아니다(v26 ${orig.length}줄 중 ${i}줄만 순서대로 찾음)`);

// 2) 형 검사 세 번
const o = await check(ORIGINAL);
const p = await check(PATCHED);
const g = await check(GUARD);

const expectedPatched: Found[] = EXPECTED_ORIGINAL.map((e) => ({ code: e.code, line: map.get(e.line) ?? -1, col: e.col }));

if (!same(o.found, EXPECTED_ORIGINAL)) problems.push(`v26 원본의 오류가 기록과 다르다: ${JSON.stringify(o.found)}`);
if (!same(p.found, expectedPatched)) problems.push(`수정본의 오류가 "v26의 4건이 대응 줄에 그대로"가 아니다: ${JSON.stringify(p.found)} (기대 ${JSON.stringify(expectedPatched)})`);
for (let k = 0; k < EXPECTED_ORIGINAL.length; k++) {
  const a = orig[EXPECTED_ORIGINAL[k].line - 1];
  const b = patched[expectedPatched[k].line - 1];
  if (a !== b) problems.push(`오류 ${k + 1}번의 줄 내용이 두 파일에서 다르다`);
  if (!a?.includes("error.message")) problems.push(`오류 ${k + 1}번 줄이 error.message 줄이 아니다`);
}
if (g.code !== 0 || g.found.length !== 0) problems.push(`callback-guard.ts에 형 오류가 있다: ${JSON.stringify(g.found)}`);

console.log("== 형 검사 기록 ==");
console.log(`${fileName(ORIGINAL)}: 종료 코드 ${o.code}, 오류 ${o.found.length}건 ${JSON.stringify(o.found.map((f) => `${f.code}@${f.line}:${f.col}`))}`);
console.log(`${fileName(PATCHED)}: 종료 코드 ${p.code}, 오류 ${p.found.length}건 ${JSON.stringify(p.found.map((f) => `${f.code}@${f.line}:${f.col}`))}`);
console.log(`${fileName(GUARD)}: 종료 코드 ${g.code}, 오류 ${g.found.length}건`);
console.log(`줄 대응(v26 → 수정본): ${EXPECTED_ORIGINAL.map((e, k) => `${e.line}→${expectedPatched[k].line}`).join(", ")}`);
if (problems.length > 0) {
  console.log("결과: 실패");
  for (const msg of problems) console.log(" - " + msg);
  Deno.exit(1);
}
console.log("결과: 기존 오류 4건 유지(종류·위치 같음), 신규 0");
