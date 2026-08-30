#!/usr/bin/env node
"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const money=require("../js/note3-money-distribution.js");

function arg(name){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:null; }
function die(message){ process.stderr.write(message+"\n"); process.exit(1); }
function hash(text){ return crypto.createHash("sha256").update(text).digest("hex").toUpperCase(); }

const inputArg=arg("--input"), outputArg=arg("--output");
if(!inputArg) die("사용법: node tools/migrate-note3-money-v4.cjs --input <복호화한 JSON> [--output <새 JSON>]\n실제 Supabase와 암호화 원본에는 연결하지 않습니다.");
const inputPath=path.resolve(inputArg), outputPath=outputArg?path.resolve(outputArg):null;
if(outputPath&&outputPath===inputPath) die("입력 원본과 출력 파일은 달라야 합니다.");
const raw=fs.readFileSync(inputPath,"utf8");
let store;
try{ store=JSON.parse(raw); }catch(_){ die("입력 파일이 JSON이 아닙니다."); }
if(!store || !store.money || !Array.isArray(store.money.accounts)) die("복호화한 note3 자료 형식이 아닙니다. 암호화 원본은 이 도구에 넣지 마세요.");

let first,second;
try{
  first=money.migrateLegacyDistributions(store,money.LEGACY_MANIFEST);
  second=money.migrateLegacyDistributions(first.store,money.LEGACY_MANIFEST);
}catch(error){ die("이행 중단: "+(error.message||error)+" ["+(error.code||"UNKNOWN")+"]"); }
const firstText=JSON.stringify(first.store), secondText=JSON.stringify(second.store), outputText=JSON.stringify(first.store,null,2)+"\n";
if(firstText!==secondText) die("이행 중단: 두 번째 실행 결과가 달라 멱등 검사를 통과하지 못했습니다.");

const summary={
  input:path.basename(inputPath),
  inputSha256:hash(raw),
  changed:first.changed,
  secondRunChanged:second.changed,
  outputSha256:hash(outputText),
  report:first.report
};
if(outputPath){
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,outputText,{encoding:"utf8",flag:"wx"});
  summary.output=outputPath;
}else summary.mode="dry-run";
process.stdout.write(JSON.stringify(summary,null,2)+"\n");
