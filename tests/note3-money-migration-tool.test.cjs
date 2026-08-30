"use strict";

const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const money=require("../js/note3-money-distribution.js");

const m=money.LEGACY_MANIFEST;
const tx=(id,date,dir,krw,desc,note="")=>({id,date,dir,krw,desc,note});
const fixture={money:{accounts:[
  {id:m.businessAccountId,alias:"사업계좌",kind:"account",startBalance:0,tx:[
    tx(m.aug22.sourceIncomeTxId,"2026-08-19","in",1090000,"지윤지 수강료","실입금 8/19 23:45 (8/20 보정)"),
    tx(m.aug22.duplicateIncomeTxId,"2026-08-22","in",1090000,"수강료 입금","배분"),
    tx(m.aug22.sourceOutTxId,"2026-08-22","out",1090000,"남편계좌 보냄","배분"),
    tx(m.aug16.sourceIncomeTxId,"2026-08-16","in",1090000,"수강료 입금","배분"),
    tx(m.aug16.husbandOutTxId,"2026-08-16","out",842569,"남편계좌 보냄","배분"),
    tx(m.aug16.tossOutTxId,"2026-08-16","out",247431,"토스생활비 보냄","배분"),
    tx(m.aug14.husbandOutTxId,"2026-08-14","out",846640,"남편계좌 보냄","배분"),
    tx(m.aug14.tossOutTxId,"2026-08-14","out",243360,"토스생활비 보냄","배분")
  ]},
  {id:m.husbandAccountId,alias:"남편계좌",kind:"account",conduit:true,startBalance:0,tx:[
    tx(m.aug22.targetInTxId,"2026-08-22","in",1090000,"배분 입금","배분"),
    tx(m.aug16.husbandInTxId,"2026-08-16","in",842569,"배분 입금","배분"),
    tx(m.aug14.husbandInTxId,"2026-08-14","in",846640,"배분 입금","배분(누락분 보정)")
  ]},
  {id:m.tossAccountId,alias:"토스생활비",kind:"account",startBalance:0,tx:[
    tx(m.aug16.tossInTxId,"2026-08-16","in",247431,"배분 입금","배분"),
    tx(m.aug14.tossInTxId,"2026-08-14","in",243360,"배분 입금","배분")
  ]}
],distLog:[{id:m.aug22.ledgerId,date:"2026-08-22",items:[]}],emergency:{goal:0,tx:[]}}};

const root=fs.mkdtempSync(path.join(os.tmpdir(),"note3-money-migration-"));
try{
  const input=path.join(root,"input.json"), output=path.join(root,"output.json"), output2=path.join(root,"output2.json");
  const original=JSON.stringify(fixture,null,2)+"\n";
  fs.writeFileSync(input,original,"utf8");
  const originalHash=crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex");
  const tool=path.resolve(__dirname,"../tools/migrate-note3-money-v4.cjs");

  const dry=spawnSync(process.execPath,[tool,"--input",input],{encoding:"utf8"});
  assert.equal(dry.status,0,dry.stderr);
  const drySummary=JSON.parse(dry.stdout);
  assert.equal(drySummary.changed,true);
  assert.equal(drySummary.secondRunChanged,false);
  assert.equal(fs.existsSync(output),false);

  const write=spawnSync(process.execPath,[tool,"--input",input,"--output",output],{encoding:"utf8"});
  assert.equal(write.status,0,write.stderr);
  const writeSummary=JSON.parse(write.stdout);
  assert.equal(writeSummary.outputSha256,crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex").toUpperCase());
  const migrated=JSON.parse(fs.readFileSync(output,"utf8"));
  assert.equal(migrated.money.distributionMigrationVersion,1);
  assert.equal(migrated.money.accounts.find(a=>a.id===m.businessAccountId).tx.find(t=>t.id===m.aug16.sourceIncomeTxId).incomeSource,true);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex"),originalHash);

  const second=spawnSync(process.execPath,[tool,"--input",output,"--output",output2],{encoding:"utf8"});
  assert.equal(second.status,0,second.stderr);
  const secondSummary=JSON.parse(second.stdout);
  assert.equal(secondSummary.changed,false);
  assert.equal(secondSummary.secondRunChanged,false);

  const overwrite=spawnSync(process.execPath,[tool,"--input",input,"--output",output],{encoding:"utf8"});
  assert.notEqual(overwrite.status,0);
  console.log("PASS local migration tool: dry-run, new output only, original unchanged, second run no-op");
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
