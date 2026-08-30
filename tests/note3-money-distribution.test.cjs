"use strict";

const assert=require("assert").strict;
const money=require("../js/note3-money-distribution.js");
const v4=require("../js/note3-v4-storage.js");

let passed=0;
function test(name,fn){ try{ fn(); passed++; process.stdout.write("PASS "+name+"\n"); }catch(error){ process.stderr.write("FAIL "+name+"\n"+error.stack+"\n"); process.exitCode=1; } }
function ids(prefix){ let n=0; return ()=>prefix+"-"+(++n); }
function baseStore(){ return {v:4,money:{accounts:[
  {id:"source",alias:"사업계좌",kind:"account",startBalance:0,tx:[
    {id:"income-a",created:1,date:"2026-08-30",dir:"in",cur:"KRW",krw:1000000,desc:"수강료 A",note:""},
    {id:"income-b",created:2,date:"2026-08-30",dir:"in",cur:"KRW",krw:1000000,desc:"수강료 B",note:""}
  ]},
  {id:"asset",alias:"일반자산",kind:"account",startBalance:0,tx:[]},
  {id:"husband",alias:"남편계좌",kind:"account",conduit:true,startBalance:0,tx:[]},
  {id:"od",alias:"마이너스통장",kind:"account",overdraft:true,startBalance:-500000,tx:[]},
  {id:"loan",alias:"일반대출",kind:"loan",balance:500000,startBalance:0,tx:[]}
],distLog:[],emergency:{goal:500000,tx:[]},assets:[]}}; }
function build(store,id,sourceIncomeTxId,items){ return money.buildDistribution(store,{id,sourceAccountId:"source",sourceIncomeTxId,date:"2026-08-30",created:10,items},{makeId:ids(id)}); }
function txCount(store){ return store.money.accounts.reduce((s,a)=>s+a.tx.length,0); }

test("01 기존 입금 배분 뒤 실제 수입 수가 늘지 않음",()=>{
  const store=baseStore(), before=money.externalFlowTotals(store,"2026-08").income;
  const result=build(store,"d01","income-a",[{targetType:"account",targetId:"asset",amount:400000}]);
  assert.equal(money.externalFlowTotals(result.store,"2026-08").income,before);
  assert.equal(result.store.money.accounts[0].tx.filter(t=>t.dir==="in"&&!money.isInternalTransfer(t)).length,2);
});

test("02 새 거래 수입 한 건 뒤 배분해도 수입은 한 건",()=>{
  const store=baseStore(); store.money.accounts[0].tx=[];
  store.money.accounts[0].tx.push({id:"new-income",date:"2026-08-30",dir:"in",krw:700000,desc:"새 수입"});
  const result=build(store,"d02","new-income",[{targetType:"account",targetId:"asset",amount:700000}]);
  assert.equal(result.store.money.accounts[0].tx.filter(t=>t.dir==="in"&&!money.isInternalTransfer(t)).length,1);
});

test("03 같은 날짜·금액도 거래 번호로 구분",()=>{
  const candidates=money.incomeCandidates(baseStore());
  assert.deepEqual(new Set(candidates.map(x=>x.txId)),new Set(["income-a","income-b"]));
});

test("03 실제 수입 후보에서 지출 통로와 마이너스통장 입금 제외",()=>{
  const store=baseStore();
  store.money.accounts.find(a=>a.id==="source").tx.push({id:"derived-in",date:"2026-08-30",dir:"in",krw:100000,note:"배분"},{id:"marked-income",date:"2026-08-30",dir:"in",krw:100000,note:"배분",incomeSource:true},{id:"marked-derived",date:"2026-08-30",dir:"in",krw:100000,note:"배분",incomeSource:true,internalTransfer:true});
  store.money.accounts.find(a=>a.id==="husband").tx.push({id:"conduit-in",date:"2026-08-30",dir:"in",krw:100000});
  store.money.accounts.find(a=>a.id==="od").tx.push({id:"od-in",date:"2026-08-30",dir:"in",krw:100000});
  const candidates=new Set(money.incomeCandidates(store).map(x=>x.txId));
  assert.equal(candidates.has("derived-in"),false); assert.equal(candidates.has("marked-income"),true); assert.equal(candidates.has("marked-derived"),false);
  assert.equal(candidates.has("conduit-in"),false); assert.equal(candidates.has("od-in"),false);
  assert.throws(()=>money.buildDistribution(store,{id:"bad-source",sourceAccountId:"husband",sourceIncomeTxId:"conduit-in",items:[{targetType:"account",targetId:"asset",amount:10000}]},{makeId:ids("bad")}),e=>e.code==="INVALID_SOURCE");
});

test("04·05 부분 배분과 한 건 취소의 남은 금액",()=>{
  let store=build(baseStore(),"d04a","income-a",[{targetType:"account",targetId:"asset",amount:400000}]).store;
  store=build(store,"d04b","income-a",[{targetType:"account",targetId:"husband",amount:600000}]).store;
  assert.equal(money.remainingForIncome(store,"source","income-a"),0);
  store=money.cancelDistribution(store,"d04a",{cancelledAt:"2026-08-30T00:00:00Z",reason:"검사"}).store;
  assert.equal(money.remainingForIncome(store,"source","income-a"),400000);
});

test("06 같은 배분 번호 재시도·재불러오기에도 중복 없음",()=>{
  const first=build(baseStore(),"d06","income-a",[{targetType:"account",targetId:"asset",amount:100000}]);
  const reloaded=JSON.parse(JSON.stringify(first.store)), before=txCount(reloaded);
  const second=build(reloaded,"d06","income-a",[{targetType:"account",targetId:"asset",amount:100000}]);
  assert.equal(second.duplicate,true); assert.equal(txCount(second.store),before); assert.equal(second.store.money.distLog.length,1);
});

for(const target of [
  {name:"일반 계좌",id:"account",item:{targetType:"account",targetId:"asset",amount:100000}},
  {name:"비상금",id:"emergency",item:{targetType:"emergency",targetId:"emergency",amount:100000}},
  {name:"일반 대출",id:"loan",item:{targetType:"loan",targetId:"loan",amount:100000}},
  {name:"마이너스통장",id:"overdraft",item:{targetType:"overdraft",targetId:"od",amount:100000}}
]) test("07 "+target.name+" 생성·취소 왕복",()=>{
  const original=baseStore(), before={source:money.accountBalance(original.money.accounts[0]),asset:money.accountBalance(original.money.accounts[1]),husband:money.accountBalance(original.money.accounts[2]),od:money.accountBalance(original.money.accounts[3]),loan:original.money.accounts[4].balance,emg:original.money.emergency.tx.length};
  const built=build(original,"d07-"+target.id,"income-a",[target.item]);
  const cancelled=money.cancelDistribution(built.store,"d07-"+target.id,{cancelledAt:"x",reason:"검사"});
  const after={source:money.accountBalance(cancelled.store.money.accounts[0]),asset:money.accountBalance(cancelled.store.money.accounts[1]),husband:money.accountBalance(cancelled.store.money.accounts[2]),od:money.accountBalance(cancelled.store.money.accounts[3]),loan:cancelled.store.money.accounts[4].balance,emg:cancelled.store.money.emergency.tx.length};
  assert.deepEqual(after,before); assert.equal(cancelled.store.money.distLog[0].status,"cancelled");
  const twice=money.cancelDistribution(cancelled.store,"d07-"+target.id,{cancelledAt:"y"}); assert.equal(twice.alreadyCancelled,true); assert.deepEqual(twice.store,cancelled.store);
});

test("08 기록 일부가 없으면 아무것도 자동 삭제하지 않음",()=>{
  const built=build(baseStore(),"d08","income-a",[{targetType:"account",targetId:"asset",amount:100000}]).store;
  const target=built.money.accounts.find(a=>a.id==="asset"); target.tx=[]; const before=JSON.stringify(built);
  assert.throws(()=>money.cancelDistribution(built,"d08"),/없거나 달라졌습니다/); assert.equal(JSON.stringify(built),before);
});

test("09 원수입·파생 거래·계좌·비상금 개별 훼손 차단",()=>{
  let store=build(baseStore(),"d09a","income-a",[{targetType:"account",targetId:"asset",amount:400000}]).store;
  const ledger=store.money.distLog[0];
  assert.equal(money.canEditTransaction(store,"source","income-a",{dir:"in",krw:399999}).ok,false);
  assert.equal(money.canEditTransaction(store,"source","income-a",{dir:"in",krw:1000000,note:"배분"}).ok,false);
  assert.equal(money.canDeleteTransaction(store,"source",ledger.items[0].sourceOutTxId).ok,false);
  assert.equal(money.canDeleteTransaction(store,"source","income-b").ok,true);
  assert.equal(money.canDeleteAccount(store,"asset").ok,false);
  store=build(store,"d09b","income-b",[{targetType:"emergency",targetId:"emergency",amount:100000}]).store;
  const emgId=store.money.distLog.find(l=>l.id==="d09b").items[0].effects[0].recordId;
  assert.equal(money.canDeleteEmergencyTx(store,emgId).ok,false);
});

test("10 81건 이후에도 첫 수입 남은 금액 유지",()=>{
  const store=baseStore(); store.money.accounts[0].tx[0].krw=1000000; store.money.distLog=[];
  for(let i=0;i<81;i++)store.money.distLog.push({id:"old-"+i,status:"active",sourceAccountId:"source",sourceIncomeTxId:"income-a",items:[{amount:1000}]});
  assert.equal(store.money.distLog.length,81); assert.equal(money.remainingForIncome(store,"source","income-a"),919000);
});

function legacyFixture(){
  const m=money.LEGACY_MANIFEST;
  const tx=(id,date,dir,krw,desc,note="")=>({id,date,dir,krw,cur:"KRW",desc,note});
  return {v:3,money:{accounts:[
    {id:m.businessAccountId,alias:"사업 계좌",kind:"account",startBalance:0,tx:[
      tx(m.aug22.sourceIncomeTxId,"2026-08-19","in",1090000,"지윤지 수강료","실입금 8/19 23:45 (8/20 보정)"),tx(m.aug22.duplicateIncomeTxId,"2026-08-22","in",1090000,"수강료 입금","배분"),tx(m.aug22.sourceOutTxId,"2026-08-22","out",1090000,"남편계좌 보냄","배분"),
      tx(m.aug16.sourceIncomeTxId,"2026-08-16","in",1090000,"수강료 입금","배분"),tx(m.aug16.husbandOutTxId,"2026-08-16","out",842569,"남편계좌 보냄","배분"),tx(m.aug16.tossOutTxId,"2026-08-16","out",247431,"토스생활비 보냄","배분"),
      tx(m.aug14.husbandOutTxId,"2026-08-14","out",846640,"남편계좌 보냄","배분"),tx(m.aug14.tossOutTxId,"2026-08-14","out",243360,"토스생활비 보냄","배분")
    ]},
    {id:m.husbandAccountId,alias:"남편계좌",kind:"account",conduit:true,startBalance:0,tx:[tx(m.aug22.targetInTxId,"2026-08-22","in",1090000,"배분 입금","배분"),tx(m.aug16.husbandInTxId,"2026-08-16","in",842569,"배분 입금","배분"),tx(m.aug14.husbandInTxId,"2026-08-14","in",846640,"배분 입금","배분(누락분 보정)")]},
    {id:m.tossAccountId,alias:"토스생활비",kind:"account",startBalance:0,tx:[tx(m.aug16.tossInTxId,"2026-08-16","in",247431,"배분 입금","배분"),tx(m.aug14.tossInTxId,"2026-08-14","in",243360,"배분 입금","배분")]}
  ],distLog:[{id:m.aug22.ledgerId,date:"2026-08-22",items:[{type:"acct",name:"남편계좌",amount:1090000}]},{id:"unknown-old",date:"2026-08-01",items:[]}],emergency:{goal:0,tx:[]}}};
}

test("11 8/14·8/16·8/22 이행 분류와 화면용 상태",()=>{
  const result=money.migrateLegacyDistributions(legacyFixture());
  const logs=result.store.money.distLog;
  assert.equal(logs.find(l=>l.id===money.LEGACY_MANIFEST.aug14.ledgerId).status,"legacy");
  assert.equal(logs.find(l=>l.id===money.LEGACY_MANIFEST.aug16.ledgerId).status,"active");
  assert.equal(logs.find(l=>l.id===money.LEGACY_MANIFEST.aug22.ledgerId).status,"active");
  assert.equal(logs.find(l=>l.id==="unknown-old").readOnly,true);
  assert.equal(result.store.money.accounts[0].tx.some(t=>t.id===money.LEGACY_MANIFEST.aug22.duplicateIncomeTxId),false);
  const legacy=logs.find(l=>l.id===money.LEGACY_MANIFEST.aug14.ledgerId), legacyItem=legacy.items[0], legacyEffect=legacyItem.effects[0];
  assert.equal(money.canDeleteTransaction(result.store,legacy.sourceAccountId,legacyItem.sourceOutTxId).ok,false);
  assert.equal(money.canEditTransaction(result.store,legacyEffect.accountId,legacyEffect.recordId,{dir:"in",krw:legacyEffect.amount}).ok,false);
  assert.equal(money.canDeleteAccount(result.store,legacyEffect.accountId).ok,false);
});

test("12 이행 두 번 실행 결과 동일",()=>{
  const first=money.migrateLegacyDistributions(legacyFixture()), second=money.migrateLegacyDistributions(first.store);
  assert.equal(second.changed,false); assert.deepEqual(second.store,first.store);
});

test("12 실제 8/16 메모 이행 뒤 취소·남은액 재등장·재배분",()=>{
  const m=money.LEGACY_MANIFEST, migrated=money.migrateLegacyDistributions(legacyFixture()).store;
  const source=migrated.money.accounts.find(a=>a.id===m.businessAccountId).tx.find(t=>t.id===m.aug16.sourceIncomeTxId);
  assert.equal(source.desc,"수강료 입금"); assert.equal(source.note,"배분"); assert.equal(source.incomeSource,true);
  assert.equal(money.canEditTransaction(migrated,m.businessAccountId,m.aug16.sourceIncomeTxId,{dir:"in",krw:1090000,note:"배분",desc:"수강료 입금 확인"}).ok,true);
  const cancelled=money.cancelDistribution(migrated,m.aug16.ledgerId,{cancelledAt:"2026-08-30T00:00:00Z",reason:"재배분 검사"}).store;
  assert.equal(money.remainingForIncome(cancelled,m.businessAccountId,m.aug16.sourceIncomeTxId),1090000);
  assert.equal(money.incomeCandidates(cancelled).some(x=>x.txId===m.aug16.sourceIncomeTxId),true);
  const rebuilt=money.buildDistribution(cancelled,{id:"reallocated-8-16",sourceAccountId:m.businessAccountId,sourceIncomeTxId:m.aug16.sourceIncomeTxId,date:"2026-08-30",items:[
    {targetType:"account",targetId:m.husbandAccountId,amount:842569},{targetType:"account",targetId:m.tossAccountId,amount:247431}
  ]},{makeId:ids("reallocated-16")}).store;
  assert.equal(money.remainingForIncome(rebuilt,m.businessAccountId,m.aug16.sourceIncomeTxId),0);
  assert.equal(rebuilt.money.distLog.find(l=>l.id===m.aug16.ledgerId).status,"cancelled");
  assert.equal(rebuilt.money.distLog.find(l=>l.id==="reallocated-8-16").status,"active");
});

test("12 일부만 이행된 흔적이나 중복 번호가 있으면 전체 중단",()=>{
  const partial=legacyFixture(); partial.money.distLog.push({id:money.LEGACY_MANIFEST.aug16.ledgerId,status:"active",items:[]});
  const before=JSON.stringify(partial);
  assert.throws(()=>money.migrateLegacyDistributions(partial),e=>e.code==="LEGACY_MISMATCH"); assert.equal(JSON.stringify(partial),before);
  const duplicate=legacyFixture(); duplicate.money.accounts[1].tx.push({id:money.LEGACY_MANIFEST.aug22.sourceIncomeTxId,date:"2026-08-19",dir:"in",krw:1090000});
  assert.throws(()=>money.migrateLegacyDistributions(duplicate),e=>e.code==="LEGACY_MISMATCH");
  for(const [date,outId,inId] of [["8/16",money.LEGACY_MANIFEST.aug16.husbandOutTxId,money.LEGACY_MANIFEST.aug16.husbandInTxId],["8/14",money.LEGACY_MANIFEST.aug14.husbandOutTxId,money.LEGACY_MANIFEST.aug14.husbandInTxId]]){
    const wrong=legacyFixture(); wrong.money.accounts[0].tx.find(t=>t.id===outId).krw+=1; wrong.money.accounts[1].tx.find(t=>t.id===inId).krw+=1; const untouched=JSON.stringify(wrong);
    assert.throws(()=>money.migrateLegacyDistributions(wrong),e=>e.code==="LEGACY_MISMATCH",date+" 예상금액 차이"); assert.equal(JSON.stringify(wrong),untouched);
  }
  for(const sourceId of [money.LEGACY_MANIFEST.aug16.sourceIncomeTxId,money.LEGACY_MANIFEST.aug22.sourceIncomeTxId])for(const marker of ["distributionId","internalTransfer","distributionRole"]){
    const wrong=legacyFixture(), source=wrong.money.accounts[0].tx.find(t=>t.id===sourceId); source[marker]=marker==="internalTransfer"?true:"unexpected"; const untouched=JSON.stringify(wrong);
    assert.throws(()=>money.migrateLegacyDistributions(wrong),e=>e.code==="LEGACY_MISMATCH"); assert.equal(JSON.stringify(wrong),untouched);
  }
  for(const mutate of [s=>{s.money.accounts[0].conduit=true;},s=>{s.money.accounts[0].overdraft=true;},s=>{s.money.accounts[1].conduit=false;},s=>{s.money.accounts[2].overdraft=true;}]){
    const wrong=legacyFixture(); mutate(wrong); const untouched=JSON.stringify(wrong);
    assert.throws(()=>money.migrateLegacyDistributions(wrong),e=>e.code==="LEGACY_MISMATCH"); assert.equal(JSON.stringify(wrong),untouched);
  }
});

test("13 일반 자산 계좌 배분 순자산 불변·통로와 비상금 왕복",()=>{
  const original=baseStore(), before=money.netWorth(original);
  const general=build(original,"d13","income-a",[{targetType:"account",targetId:"asset",amount:300000}]); assert.equal(money.netWorth(general.store),before);
  for(const item of [{targetType:"account",targetId:"husband",amount:100000},{targetType:"emergency",targetId:"emergency",amount:100000}]){
    const b=build(baseStore(),"d13-"+item.targetId,"income-a",[item]), c=money.cancelDistribution(b.store,"d13-"+item.targetId,{cancelledAt:"x"});
    assert.equal(money.accountBalance(c.store.money.accounts[0]),money.accountBalance(baseStore().money.accounts[0]));
  }
});

test("14 내부 배분은 월 총수입·총지출에서 제외",()=>{
  const store=baseStore(), before=money.externalFlowTotals(store,"2026-08");
  const result=build(store,"d14","income-a",[{targetType:"account",targetId:"asset",amount:100000}]);
  assert.deepEqual(money.externalFlowTotals(result.store,"2026-08"),before);
});

test("15 새로 불러온 뒤 계좌 잔액과 거래 합계 일치",()=>{
  const result=build(baseStore(),"d15","income-a",[{targetType:"account",targetId:"asset",amount:125000}]);
  const reloaded=JSON.parse(JSON.stringify(result.store));
  for(const account of reloaded.money.accounts) assert.equal(money.accountBalance(account),Number(account.startBalance||0)+(account.tx||[]).reduce((s,t)=>s+(t.dir==="in"?1:-1)*Number(t.krw||0),0));
});

test("16 오프라인·재연결·두 화면 조건부 저장",()=>{
  const offline=v4.chooseLoadSource({cloudV4:null,localV4:{blob:"local",revision:3,pending:true},legacyBlob:null,cloudReachable:false}); assert.equal(offline.blob,"local");
  const offlineFirstReload=v4.chooseLoadSource({cloudV4:null,localV4:{blob:"offline-first",revision:0,pending:true},legacyBlob:null,cloudReachable:false}); assert.equal(offlineFirstReload.needsInsert,true);
  const firstReconnect=v4.chooseLoadSource({cloudV4:null,localV4:{blob:"offline-first",revision:0,pending:true},legacyBlob:"legacy",cloudReachable:true}); assert.equal(firstReconnect.blob,"offline-first"); assert.equal(firstReconnect.needsInsert,true); assert.equal(firstReconnect.conflict,false);
  const missingCloud=v4.chooseLoadSource({cloudV4:null,localV4:{blob:"last-v4",revision:3,pending:false},legacyBlob:"legacy",cloudReachable:true}); assert.equal(missingCloud.blob,"last-v4"); assert.equal(missingCloud.conflict,true);
  const blankOnline=v4.chooseLoadSource({cloudV4:null,localV4:null,legacyBlob:null,cloudReachable:true}); assert.equal(blankOnline.needsInsert,true);
  const saved=v4.conditionalSaveRow({id:v4.ROW_ID,data:"old",revision:3},3,"new"); assert.equal(saved.saved,true); assert.equal(saved.currentRevision,4);
  const stale=v4.conditionalSaveRow(saved.row,3,"stale"); assert.equal(stale.conflict,true); assert.equal(stale.row.data,"new");
  const reconnect=v4.chooseLoadSource({cloudV4:{data:"server",revision:4},localV4:{blob:"offline",revision:3,pending:true},cloudReachable:true}); assert.equal(reconnect.conflict,true); assert.equal(reconnect.blob,"server");
  const settled=v4.conflictReloadPayload(reconnect); assert.equal(v4.parseLocal(settled.backup).blob,"offline"); assert.equal(v4.parseLocal(settled.current).pending,false);
  const afterReload=v4.chooseLoadSource({cloudV4:{data:"server",revision:4},localV4:v4.parseLocal(settled.current),legacyBlob:null,cloudReachable:true}); assert.equal(afterReload.conflict,false); assert.equal(afterReload.blob,"server");
});

test("17 구버전 main과 신버전 main-v4 저장 위치 분리",()=>{ assert.equal(v4.LEGACY_ROW_ID,"main"); assert.equal(v4.ROW_ID,"main-v4"); assert.notEqual(v4.LOCAL_KEY,v4.LEGACY_LOCAL_KEY); });

test("17 구버전 최초 로드는 exact 이행 성공 때만 main-v4 저장 준비",()=>{
  const choice=v4.chooseLoadSource({cloudV4:null,localV4:null,legacyBlob:"encrypted-main",cloudReachable:true});
  const prepared=v4.prepareLoadedStore(choice,legacyFixture(),money.migrateLegacyDistributions);
  assert.equal(prepared.ok,true); assert.equal(prepared.shouldSave,true); assert.equal(prepared.store.money.distributionMigrationVersion,1);
  let saveCalls=prepared.shouldSave?1:0; assert.equal(saveCalls,1);
  const mismatch=legacyFixture(); mismatch.money.accounts[0].tx=mismatch.money.accounts[0].tx.filter(t=>t.id!==money.LEGACY_MANIFEST.aug16.sourceIncomeTxId);
  const blocked=v4.prepareLoadedStore(choice,mismatch,money.migrateLegacyDistributions); saveCalls=blocked.shouldSave?1:0;
  assert.equal(blocked.ok,false); assert.equal(blocked.store,null); assert.equal(saveCalls,0);
});

test("18 원수입에는 역연결 목록을 저장하지 않음",()=>{
  const result=build(baseStore(),"d18","income-a",[{targetType:"account",targetId:"asset",amount:100000}]);
  const source=result.store.money.accounts[0].tx.find(t=>t.id==="income-a");
  assert.equal(source.distributionId,undefined); assert.equal(source.distributions,undefined); assert.equal(result.store.money.distLog[0].sourceIncomeTxId,"income-a");
});

process.on("exit",()=>{ if(!process.exitCode)process.stdout.write("TOTAL "+passed+" tests passed\n"); });
