// ===== 배포 묶음 사전 점검 (보내지 않는다) =====
// Management API `POST /v1/projects/{ref}/functions/deploy`에 보낼 multipart 본문을
// 이 PC 안에서 만들기만 하고, 다시 풀어서 내용이 맞는지 확인한다. 어디로도 보내지 않는다.
//
// 실행(함수 폴더에서, 네트워크 권한 없음):
//   deno run --no-remote --no-lock --no-prompt --allow-read=. --allow-run=git tests/package_check.ts
//
// [추정] multipart의 칸 이름(`metadata`, `file`)과 metadata의 필드 이름
//   (`name`, `entrypoint_path`, `import_map_path`, `verify_jwt`)은 2차 작업 계약서에 적힌 모양을 따른 것이다.
//   이 작업은 네트워크 호출이 금지라 공식 문서(supabase.com/docs/reference/api/v1-deploy-a-function)의
//   Object schema와 대조하지 못했다. 실제로 보내기 전에 문서와 대조해야 한다.
//
// 확인하는 것:
//   1. 묶음에 든 파일이 index.ts, callback-guard.ts, deno.json 세 개뿐이고 상대 경로가 그 이름 그대로다.
//   2. 다시 풀어 낸 세 파일의 SHA-256이 작업 폴더 파일과 같다.
//   3. 작업 폴더의 세 파일이 브랜치에 커밋된 내용과 바이트까지 같다(git blob 비교).
//   4. tests/ 아래 파일이 하나도 들어 있지 않다.
//   5. 세 파일이 서로만 import한다(묶음 밖의 상대 경로 파일을 부르지 않는다).
//   6. metadata가 정해 둔 모양과 같다.

const FILES = ["index.ts", "callback-guard.ts", "deno.json"] as const;
const METADATA = {
  name: "telegram-notify",
  entrypoint_path: "index.ts",
  import_map_path: "deno.json",
  verify_jwt: false,
};
const REPO_DIR = "supabase/functions/telegram-notify";

const fnDir = new URL("../", import.meta.url);
const problems: string[] = [];

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function git(args: string[]): Promise<string> {
  const cwd = decodeURIComponent(fnDir.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  if (out.code !== 0) throw new Error(`git ${args.join(" ")} 실패: ${new TextDecoder().decode(out.stderr)}`);
  return new TextDecoder().decode(out.stdout).trim();
}

// ----- 1) 묶음 만들기 (작업 폴더의 파일 바이트 그대로) -----
const source: Record<string, Uint8Array> = {};
const form = new FormData();
form.append("metadata", JSON.stringify(METADATA));
for (const name of FILES) {
  const bytes = await Deno.readFile(new URL(name, fnDir));
  source[name] = bytes;
  form.append("file", new File([bytes as BlobPart], name, { type: "application/octet-stream" }));
}
// Request 객체는 본문을 multipart로 짜 줄 뿐, 만들기만 해서는 아무 데도 보내지 않는다(fetch를 부르지 않는다).
const draft = new Request("https://not-sent.invalid/v1/projects/REF/functions/deploy?slug=telegram-notify", { method: "POST", body: form });
const contentType = draft.headers.get("content-type") ?? "";
const bodyBytes = new Uint8Array(await draft.arrayBuffer());

// ----- 2) 다시 풀기 -----
const unpacked = await new Response(bodyBytes, { headers: { "content-type": contentType } }).formData();
const parts: Array<{ field: string; name: string; bytes: Uint8Array }> = [];
let metadataText: string | null = null;
for (const [field, value] of unpacked.entries()) {
  if (typeof value === "string") {
    if (field === "metadata" && metadataText === null) metadataText = value;
    else problems.push(`예상 밖의 글자 칸: ${field}`);
  } else {
    parts.push({ field, name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
}

// ----- 3) 확인 -----
if (!contentType.startsWith("multipart/form-data; boundary=")) problems.push(`본문 형식이 multipart가 아니다: ${contentType}`);

const names = parts.map((p) => p.name);
if (JSON.stringify(names) !== JSON.stringify(FILES)) problems.push(`파일 목록이 다르다: ${JSON.stringify(names)}`);
for (const p of parts) {
  if (p.field !== "file") problems.push(`파일 칸 이름이 file이 아니다: ${p.field}`);
  if (p.name.includes("/") || p.name.includes("\\") || p.name.startsWith(".")) problems.push(`상대 경로가 이름 그대로가 아니다: ${p.name}`);
  if (/(^|[\\/])tests([\\/]|$)/.test(p.name) || /_test\.ts$/.test(p.name)) problems.push(`tests 파일이 들어 있다: ${p.name}`);
}

if (metadataText === null) problems.push("metadata 칸이 없다");
else if (JSON.stringify(JSON.parse(metadataText)) !== JSON.stringify(METADATA)) problems.push(`metadata가 다르다: ${metadataText}`);

const rows: Array<{ path: string; bytes: number; sha256: string; blob: string }> = [];
for (const name of FILES) {
  const part = parts.find((p) => p.name === name);
  const srcHash = await sha256(source[name]);
  if (!part) {
    problems.push(`${name}이 묶음에 없다`);
    continue;
  }
  const gotHash = await sha256(part.bytes);
  if (gotHash !== srcHash) problems.push(`${name}: 풀어 낸 내용의 SHA-256이 작업 폴더 파일과 다르다`);
  // 브랜치에 커밋된 내용과 바이트까지 같은지: 작업 폴더 파일의 blob 번호(줄바꿈 변환 없이) = HEAD의 blob 번호
  const workBlob = await git(["hash-object", "--no-filters", "--", name]);
  let headBlob = "";
  try {
    headBlob = await git(["rev-parse", `HEAD:${REPO_DIR}/${name}`]);
  } catch (e) {
    problems.push(`${name}: HEAD에 없다 (${e instanceof Error ? e.message : String(e)})`);
  }
  if (headBlob && workBlob !== headBlob) problems.push(`${name}: 작업 폴더 파일이 브랜치에 커밋된 내용과 다르다(커밋 안 된 변경 또는 줄바꿈 변환)`);
  if (source[name].includes(13)) problems.push(`${name}: 줄바꿈에 CR이 섞여 있다`);
  rows.push({ path: name, bytes: part.bytes.length, sha256: gotHash, blob: headBlob });
}

// 세 파일이 서로만 import하는지(상대 경로 import가 묶음 안의 파일을 가리키는지)
for (const name of ["index.ts", "callback-guard.ts"]) {
  const text = new TextDecoder().decode(source[name]);
  const specs = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
  for (const spec of specs) {
    if (spec.startsWith("./")) {
      if (!(FILES as readonly string[]).includes(spec.slice(2))) problems.push(`${name}이 묶음 밖의 파일을 부른다: ${spec}`);
    } else {
      problems.push(`${name}에 상대 경로가 아닌 import가 있다: ${spec}`);
    }
  }
  if (/\bimport\s*\(/.test(text.replace(/^\s*\/\/.*$/gm, ""))) problems.push(`${name}에 동적 import가 있다`);
}

const head = await git(["rev-parse", "HEAD"]);
const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);

console.log("== 배포 묶음 사전 점검 (보내지 않음) ==");
console.log(`브랜치 ${branch}, 커밋 ${head}`);
console.log(`본문 형식: multipart/form-data, 전체 ${bodyBytes.length}바이트 (구분선은 매번 달라서 본문 전체의 해시는 적지 않는다)`);
console.log(`metadata [칸·필드 이름은 추정]: ${metadataText}`);
console.log("| 상대 경로 | 바이트 | SHA-256 | git blob |");
console.log("|---|---|---|---|");
for (const r of rows) console.log(`| ${r.path} | ${r.bytes} | ${r.sha256} | ${r.blob} |`);
console.log(`tests/ 파일: ${names.filter((n) => /tests|_test\.ts$/.test(n)).length}개`);
if (problems.length > 0) {
  console.log("결과: 실패");
  for (const msg of problems) console.log(" - " + msg);
  Deno.exit(1);
}
console.log("결과: 세 파일의 경로·SHA-256이 브랜치 파일과 같고, tests 파일은 들어 있지 않다");
