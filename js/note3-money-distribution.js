(function(root, factory){
  const api=factory();
  if(typeof module==="object" && module.exports) module.exports=api;
  if(root) root.Note3MoneyDistribution=api;
})(typeof globalThis!=="undefined"?globalThis:this, function(){
  "use strict";

  const LEGACY_MANIFEST={
    businessAccountId:"msq208uq58n5t",
    husbandAccountId:"msq2lpbkl1dhl",
    tossAccountId:"msq0q3c51ciwv",
    aug22:{
      amount:1090000,
      sourceIncomeTxId:"mt1hn0t4rhzrk",
      duplicateIncomeTxId:"mt3ze92cg5oni",
      sourceOutTxId:"mt3ze92c6thd4",
      targetInTxId:"mt3ze92ccok9u",
      ledgerId:"mt3ze92c8go4j"
    },
    aug16:{
      husbandAmount:842569,
      tossAmount:247431,
      sourceIncomeTxId:"msvknsdmqat6d",
      husbandOutTxId:"msvknsdm4m2so",
      husbandInTxId:"msvknsdmuvz70",
      tossOutTxId:"msvknsdmw4si5",
      tossInTxId:"msvknsdmgsqw9",
      ledgerId:"legacy-dist-msvknsdmqat6d"
    },
    aug14:{
      husbandAmount:846640,
      tossAmount:243360,
      husbandOutTxId:"msstmg3p4krdm",
      husbandInTxId:"fixdistmsstrh2z",
      tossOutTxId:"msstmg3pjeu3n",
      tossInTxId:"msstmg3punl33",
      ledgerId:"legacy-dist-20260814"
    }
  };

  function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
  function amount(value){ const n=Number(value); return Number.isFinite(n)?n:0; }
  function fail(code, message, detail){ const e=new Error(message); e.code=code; if(detail!==undefined)e.detail=detail; throw e; }
  function ensureStore(store){
    if(!store || typeof store!=="object" || Array.isArray(store)) fail("INVALID_STORE","자료 형식이 올바르지 않습니다.");
    if(!store.money || typeof store.money!=="object" || Array.isArray(store.money)) store.money={};
    if(!Array.isArray(store.money.accounts)) store.money.accounts=[];
    if(!Array.isArray(store.money.distLog)) store.money.distLog=[];
    if(!store.money.emergency || typeof store.money.emergency!=="object" || Array.isArray(store.money.emergency)) store.money.emergency={goal:0,tx:[]};
    if(!Array.isArray(store.money.emergency.tx)) store.money.emergency.tx=[];
    store.money.accounts.forEach(a=>{ if(!Array.isArray(a.tx))a.tx=[]; });
    return store;
  }
  function accountById(store,id){ return (store.money.accounts||[]).find(a=>a.id===id)||null; }
  function txInAccount(store,accountId,txId){ const a=accountById(store,accountId); if(!a)return null; const tx=(a.tx||[]).find(t=>t.id===txId)||null; return tx?{account:a,tx}:null; }
  function findTx(store,txId){
    for(const account of store.money.accounts||[]){ const tx=(account.tx||[]).find(t=>t.id===txId); if(tx)return {account,tx}; }
    return null;
  }
  function isActive(log){ return log && log.status==="active"; }
  function activeLogs(store){ return (store.money.distLog||[]).filter(isActive); }
  function hasExactLegacyLinks(log){ return !!(log&&log.readOnly&&(log.items||[]).some(item=>item.sourceOutTxId&&Array.isArray(item.effects)&&item.effects.some(effect=>effect&&effect.recordId))); }
  function protectedLogs(store){ return (store.money.distLog||[]).filter(log=>isActive(log)||hasExactLegacyLinks(log)); }
  function allocatedForIncome(store,txId){
    return activeLogs(store).filter(l=>l.sourceIncomeTxId===txId).reduce((sum,l)=>sum+(l.items||[]).reduce((s,i)=>s+amount(i.amount),0),0);
  }
  function sourceIncome(store,accountId,txId){
    const found=txInAccount(store,accountId,txId);
    if(!found) fail("SOURCE_NOT_FOUND","선택한 원래 입금 기록을 찾을 수 없습니다.");
    if(found.account.kind!=="account" || found.account.conduit || found.account.overdraft || found.tx.dir!=="in" || !Number.isInteger(amount(found.tx.krw)) || amount(found.tx.krw)<=0 || isInternalTransfer(found.tx)) fail("INVALID_SOURCE","선택한 기록은 배분할 수 있는 실제 입금이 아닙니다.");
    return found;
  }
  function remainingForIncome(store,accountId,txId){
    const found=sourceIncome(store,accountId,txId);
    return Math.max(0,amount(found.tx.krw)-allocatedForIncome(store,txId));
  }
  function isInternalTransfer(tx){ return !!(tx && (tx.distributionId || tx.internalTransfer || (!tx.incomeSource && tx.note==="배분"))); }
  function incomeCandidates(input){
    const store=ensureStore(clone(input)); const out=[];
    (store.money.accounts||[]).forEach(account=>{
      if(account.kind!=="account" || account.conduit || account.overdraft)return;
      (account.tx||[]).forEach(tx=>{
        if(tx.dir!=="in" || !Number.isInteger(amount(tx.krw)) || amount(tx.krw)<=0 || isInternalTransfer(tx))return;
        const allocated=allocatedForIncome(store,tx.id), remaining=Math.max(0,amount(tx.krw)-allocated);
        if(remaining<=0)return;
        out.push({accountId:account.id,accountName:account.alias||"계좌",txId:tx.id,date:tx.date||"",desc:tx.desc||"입금",amount:amount(tx.krw),allocated,remaining});
      });
    });
    return out.sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.txId).localeCompare(String(a.txId)));
  }
  function recordIdSet(store){
    const ids=new Set();
    (store.money.accounts||[]).forEach(a=>(a.tx||[]).forEach(t=>ids.add(t.id)));
    (store.money.emergency&&store.money.emergency.tx||[]).forEach(t=>ids.add(t.id));
    (store.money.distLog||[]).forEach(l=>ids.add(l.id));
    return ids;
  }
  function nextId(makeId,ids,label){
    const id=String(makeId(label)||"");
    if(!id || ids.has(id)) fail("DUPLICATE_RECORD_ID","새 기록 번호가 비어 있거나 이미 존재합니다.",{id,label});
    ids.add(id); return id;
  }
  function normalizeTargetType(item){
    if(item.targetType)return item.targetType;
    if(item.type==="acct")return "account";
    if(item.type==="emg")return "emergency";
    if(item.type==="debt")return item.dk==="loan"?"loan":"overdraft";
    return "";
  }
  function buildDistribution(input,spec,options){
    const original=ensureStore(clone(input));
    if(!spec || !spec.id) fail("MISSING_DISTRIBUTION_ID","배분 번호가 없습니다.");
    const existing=(original.money.distLog||[]).find(l=>l.id===spec.id);
    if(existing) return {store:original,ledger:existing,duplicate:true};
    const source=sourceIncome(original,spec.sourceAccountId,spec.sourceIncomeTxId);
    const items=(spec.items||[]).map(item=>Object.assign({},item,{targetType:normalizeTargetType(item),amount:amount(item.amount)})).filter(item=>item.amount!==0);
    if(!items.length) fail("EMPTY_DISTRIBUTION","배분 금액이 없습니다.");
    items.forEach(item=>{ if(!Number.isInteger(item.amount) || item.amount<=0) fail("INVALID_AMOUNT","배분 금액은 1원 이상의 정수여야 합니다.",item); });
    const total=items.reduce((sum,item)=>sum+item.amount,0), remaining=remainingForIncome(original,spec.sourceAccountId,spec.sourceIncomeTxId);
    if(total>remaining) fail("OVER_ALLOCATED","남은 배분 가능 금액을 초과했습니다.",{total,remaining});
    const next=ensureStore(clone(original)), ids=recordIdSet(next), makeId=options&&options.makeId;
    if(typeof makeId!=="function") fail("MISSING_ID_FACTORY","기록 번호 생성기가 없습니다.");
    const created=Number.isFinite(Number(spec.created))?Number(spec.created):Date.now(), date=spec.date||new Date().toISOString().slice(0,10);
    const sourceAccount=accountById(next,spec.sourceAccountId), ledgerItems=[];
    for(const raw of items){
      const type=raw.targetType, targetId=type==="emergency"?(raw.targetId||"emergency"):raw.targetId;
      const sourceOutTxId=nextId(makeId,ids,"source-out"), effects=[];
      let targetName=raw.targetNameSnapshot||"";
      if(type==="account" || type==="overdraft"){
        const target=accountById(next,targetId);
        if(!target || target.kind!=="account") fail("TARGET_NOT_FOUND","대상 계좌를 찾을 수 없습니다.",raw);
        if(type==="account" && target.overdraft) fail("TARGET_TYPE_MISMATCH","일반 계좌 대상이 마이너스통장으로 바뀌었습니다.",raw);
        if(type==="overdraft" && !target.overdraft) fail("TARGET_TYPE_MISMATCH","마이너스통장 대상을 확인할 수 없습니다.",raw);
        if(target.id===sourceAccount.id) fail("SAME_ACCOUNT","원래 입금 계좌와 대상 계좌가 같습니다.",raw);
        if(type==="overdraft" && raw.amount>Math.max(0,-accountBalance(target))) fail("OVER_DEBT_BALANCE","마이너스통장 사용액보다 많이 배분할 수 없습니다.",raw);
        targetName=targetName||target.alias||"계좌";
        const targetTxId=nextId(makeId,ids,"target-in");
        target.tx.push({id:targetTxId,created,date,dir:"in",cur:"KRW",krw:raw.amount,desc:type==="overdraft"?"마통 상환 (배분)":"배분 입금",note:"배분",internalTransfer:true,distributionId:spec.id,distributionRole:"targetIn"});
        effects.push({kind:"accountTx",accountId:target.id,recordId:targetTxId,direction:"in",amount:raw.amount});
      } else if(type==="emergency"){
        targetName=targetName||"비상금";
        const emgTxId=nextId(makeId,ids,"emergency-in");
        next.money.emergency.tx.push({id:emgTxId,created,date,amount:raw.amount,note:"배분 적립",distributionId:spec.id,distributionRole:"targetIn"});
        effects.push({kind:"emergencyTx",emergencyId:"emergency",recordId:emgTxId,direction:"in",amount:raw.amount});
      } else if(type==="loan"){
        const loan=accountById(next,targetId);
        if(!loan || loan.kind!=="loan") fail("TARGET_NOT_FOUND","대출 기록을 찾을 수 없습니다.",raw);
        if(raw.amount>amount(loan.balance)) fail("OVER_LOAN_BALANCE","남은 대출 원금보다 많이 배분할 수 없습니다.",raw);
        targetName=targetName||loan.alias||"대출";
        const loanTxId=nextId(makeId,ids,"loan-payment");
        loan.balance=amount(loan.balance)-raw.amount;
        loan.tx.push({id:loanTxId,created,date,dir:"out",cur:"KRW",krw:raw.amount,desc:"조기상환 (배분)",note:"배분",distributionId:spec.id,distributionRole:"loanPayment"});
        effects.push({kind:"loanPayment",loanId:loan.id,recordId:loanTxId,direction:"decrease",amount:raw.amount});
      } else fail("INVALID_TARGET_TYPE","알 수 없는 배분 대상입니다.",raw);
      sourceAccount.tx.push({id:sourceOutTxId,created,date,dir:"out",cur:"KRW",krw:raw.amount,desc:targetName+" 보냄",note:"배분",internalTransfer:true,distributionId:spec.id,distributionRole:"sourceOut"});
      ledgerItems.push({targetType:type,targetId,targetNameSnapshot:targetName,amount:raw.amount,sourceOutTxId,effects});
    }
    const sourceTotal=ledgerItems.reduce((s,i)=>s+i.amount,0), effectTotal=ledgerItems.reduce((s,i)=>s+(i.effects||[]).reduce((x,e)=>x+amount(e.amount),0),0);
    if(sourceTotal!==total || effectTotal!==total) fail("UNBALANCED_DISTRIBUTION","배분 양쪽 금액이 일치하지 않습니다.",{total,sourceTotal,effectTotal});
    const ledger={id:spec.id,status:"active",sourceAccountId:source.account.id,sourceIncomeTxId:source.tx.id,date,created,items:ledgerItems};
    next.money.distLog.unshift(ledger);
    return {store:next,ledger,duplicate:false,total,remainingBefore:remaining,remainingAfter:remaining-total};
  }
  function accountBalance(account){ return amount(account.startBalance)+(account.tx||[]).reduce((s,t)=>s+(t.dir==="in"?1:-1)*amount(t.krw),0); }
  function exactTx(store,accountId,effectId,direction,krw,distributionId){
    const found=txInAccount(store,accountId,effectId);
    if(!found || found.tx.dir!==direction || amount(found.tx.krw)!==amount(krw) || found.tx.distributionId!==distributionId) fail("BROKEN_DISTRIBUTION","연결된 계좌 기록이 없거나 달라졌습니다.",{accountId,effectId});
    return found;
  }
  function cancelDistribution(input,id,options){
    const original=ensureStore(clone(input)), ledger=(original.money.distLog||[]).find(l=>l.id===id);
    if(!ledger) fail("LEDGER_NOT_FOUND","배분 원장을 찾을 수 없습니다.");
    if(ledger.status==="cancelled") return {store:original,ledger,alreadyCancelled:true};
    if(ledger.status!=="active" || ledger.readOnly) fail("LEGACY_READ_ONLY","연결되지 않은 오래된 배분은 자동 취소할 수 없습니다.");
    sourceIncome(original,ledger.sourceAccountId,ledger.sourceIncomeTxId);
    for(const item of ledger.items||[]){
      exactTx(original,ledger.sourceAccountId,item.sourceOutTxId,"out",item.amount,id);
      for(const effect of item.effects||[]){
        if(effect.kind==="accountTx") exactTx(original,effect.accountId,effect.recordId,effect.direction,effect.amount,id);
        else if(effect.kind==="emergencyTx"){
          const tx=(original.money.emergency.tx||[]).find(t=>t.id===effect.recordId);
          if(!tx || amount(tx.amount)!==amount(effect.amount) || tx.distributionId!==id) fail("BROKEN_DISTRIBUTION","연결된 비상금 기록이 없거나 달라졌습니다.",effect);
        } else if(effect.kind==="loanPayment") exactTx(original,effect.loanId,effect.recordId,"out",effect.amount,id);
        else fail("BROKEN_DISTRIBUTION","알 수 없는 연결 효과가 있습니다.",effect);
      }
    }
    const next=ensureStore(clone(original)), nextLedger=next.money.distLog.find(l=>l.id===id);
    for(const item of nextLedger.items||[]){
      const src=accountById(next,nextLedger.sourceAccountId); src.tx=src.tx.filter(t=>t.id!==item.sourceOutTxId);
      for(const effect of item.effects||[]){
        if(effect.kind==="accountTx"){ const a=accountById(next,effect.accountId); a.tx=a.tx.filter(t=>t.id!==effect.recordId); }
        else if(effect.kind==="emergencyTx") next.money.emergency.tx=next.money.emergency.tx.filter(t=>t.id!==effect.recordId);
        else if(effect.kind==="loanPayment"){ const loan=accountById(next,effect.loanId); loan.tx=loan.tx.filter(t=>t.id!==effect.recordId); loan.balance=amount(loan.balance)+amount(effect.amount); }
      }
    }
    nextLedger.status="cancelled";
    nextLedger.cancelledAt=options&&options.cancelledAt || new Date().toISOString();
    nextLedger.cancelReason=options&&options.reason || "사용자 요청";
    return {store:next,ledger:nextLedger,alreadyCancelled:false};
  }
  function activeLinkForTx(store,accountId,txId){
    for(const ledger of protectedLogs(store)){
      if(ledger.sourceAccountId===accountId && ledger.sourceIncomeTxId===txId) return {kind:"sourceIncome",ledger};
      for(const item of ledger.items||[]){
        if(ledger.sourceAccountId===accountId && item.sourceOutTxId===txId) return {kind:"effect",ledger,item};
        const effect=(item.effects||[]).find(e=>(e.accountId===accountId || e.loanId===accountId) && e.recordId===txId);
        if(effect)return {kind:"effect",ledger,item,effect};
      }
    }
    return null;
  }
  function canEditTransaction(store,accountId,txId,proposed){
    const link=activeLinkForTx(store,accountId,txId);
    if(!link)return {ok:true};
    if(link.kind==="effect")return {ok:false,reason:"배분으로 생긴 기록은 배분 취소에서만 바꿀 수 있습니다.",distributionId:link.ledger.id};
    if(!proposed)return {ok:true,distributionId:link.ledger.id};
    const current=txInAccount(store,accountId,txId), merged=Object.assign({},current&&current.tx||{},proposed);
    const min=allocatedForIncome(store,txId);
    if(merged.dir!=="in" || !Number.isInteger(amount(merged.krw)) || amount(merged.krw)<min || isInternalTransfer(merged)) return {ok:false,reason:"연결된 배분의 원수입 성격이나 배분 합계를 훼손하도록 바꿀 수 없습니다.",distributionId:link.ledger.id,min};
    return {ok:true,distributionId:link.ledger.id};
  }
  function canDeleteTransaction(store,accountId,txId){ const link=activeLinkForTx(store,accountId,txId); return link?{ok:false,reason:"연결된 배분을 먼저 취소해야 합니다.",distributionId:link.ledger.id}:{ok:true}; }
  function canDeleteAccount(store,accountId){
    const ledger=protectedLogs(store).find(l=>l.sourceAccountId===accountId || (l.items||[]).some(i=>i.targetId===accountId || (i.effects||[]).some(e=>e.accountId===accountId || e.loanId===accountId)));
    return ledger?{ok:false,reason:"이 계좌와 연결된 배분을 먼저 취소해야 합니다.",distributionId:ledger.id}:{ok:true};
  }
  function canDeleteEmergencyTx(store,txId){
    const ledger=protectedLogs(store).find(l=>(l.items||[]).some(i=>(i.effects||[]).some(e=>e.kind==="emergencyTx" && e.recordId===txId)));
    return ledger?{ok:false,reason:"배분으로 생긴 비상금 기록은 배분 취소에서만 바꿀 수 있습니다.",distributionId:ledger.id}:{ok:true};
  }
  function externalFlowTotals(store,month){
    let income=0,expense=0;
    (store.money.accounts||[]).forEach(a=>(a.tx||[]).forEach(t=>{ if(month && String(t.date||"").slice(0,7)!==month)return; if(isInternalTransfer(t))return; if(t.dir==="in")income+=amount(t.krw); else expense+=amount(t.krw); }));
    return {income,expense};
  }
  function netWorth(store){
    const accounts=store.money.accounts||[];
    const cash=accounts.filter(a=>a.kind==="account" && !a.conduit && !a.overdraft).reduce((s,a)=>s+accountBalance(a),0);
    const assets=(store.money.assets||[]).reduce((s,a)=>s+amount(a.value),0);
    const od=accounts.filter(a=>a.kind==="account" && a.overdraft).reduce((s,a)=>s+Math.max(0,-accountBalance(a)),0);
    const loans=accounts.filter(a=>a.kind==="loan" && !a.returnAtMaturity).reduce((s,a)=>s+amount(a.balance),0);
    return cash+assets-od-loans;
  }
  function markTx(tx,distributionId,role){ tx.distributionId=distributionId; tx.distributionRole=role; tx.internalTransfer=true; }
  function hasDerivedMarker(tx){ return !!(tx&&(tx.distributionId||tx.internalTransfer||tx.distributionRole)); }
  function validatePair(outTx,inTx){
    if(!outTx || !inTx || outTx.dir!=="out" || inTx.dir!=="in" || !Number.isInteger(amount(outTx.krw)) || amount(outTx.krw)<=0 || amount(outTx.krw)!==amount(inTx.krw)) fail("LEGACY_MISMATCH","과거 배분의 양쪽 기록이 정확히 맞지 않습니다.");
  }
  function migrateLegacyDistributions(input,customManifest){
    const manifest=customManifest||LEGACY_MANIFEST, original=ensureStore(clone(input));
    if(original.money.distributionMigrationVersion===1) return {store:original,changed:false,report:{alreadyApplied:true}};
    const business=accountById(original,manifest.businessAccountId), husband=accountById(original,manifest.husbandAccountId), toss=accountById(original,manifest.tossAccountId);
    if(!business || !husband || !toss) fail("LEGACY_MISMATCH","지정된 과거 계좌 번호를 모두 확인할 수 없습니다.");
    if(business.kind!=="account" || business.conduit || business.overdraft || husband.kind!=="account" || !husband.conduit || husband.overdraft || toss.kind!=="account" || toss.conduit || toss.overdraft) fail("LEGACY_MISMATCH","과거 계좌의 자산·지출 통로 역할이 예상과 다릅니다.");
    const tx=(account,id)=>{ const local=(account.tx||[]).filter(t=>t.id===id), all=(original.money.accounts||[]).flatMap(a=>(a.tx||[]).filter(t=>t.id===id)); if(local.length!==1 || all.length!==1) fail("LEGACY_MISMATCH","지정된 과거 거래 번호를 하나로 확인할 수 없습니다.",{accountId:account.id,txId:id,count:all.length}); return local[0]; };
    const a22src=tx(business,manifest.aug22.sourceIncomeTxId), a22dup=tx(business,manifest.aug22.duplicateIncomeTxId), a22out=tx(business,manifest.aug22.sourceOutTxId), a22in=tx(husband,manifest.aug22.targetInTxId), a22logs=(original.money.distLog||[]).filter(l=>l.id===manifest.aug22.ledgerId);
    if(a22logs.length!==1 || (original.money.distLog||[]).some(l=>l.id===manifest.aug16.ledgerId || l.id===manifest.aug14.ledgerId) || a22src.dir!=="in" || hasDerivedMarker(a22src) || a22dup.dir!=="in" || amount(a22src.krw)!==manifest.aug22.amount || amount(a22dup.krw)!==manifest.aug22.amount) fail("LEGACY_MISMATCH","과거 배분 원장이 이행 전 상태와 정확히 맞지 않습니다.");
    const a22log=a22logs[0];
    validatePair(a22out,a22in); if(amount(a22out.krw)!==manifest.aug22.amount) fail("LEGACY_MISMATCH","8월 22일 배분 금액이 예상값과 다릅니다.");
    const a16src=tx(business,manifest.aug16.sourceIncomeTxId), a16ho=tx(business,manifest.aug16.husbandOutTxId), a16hi=tx(husband,manifest.aug16.husbandInTxId), a16to=tx(business,manifest.aug16.tossOutTxId), a16ti=tx(toss,manifest.aug16.tossInTxId);
    validatePair(a16ho,a16hi); validatePair(a16to,a16ti);
    if(a16src.dir!=="in" || hasDerivedMarker(a16src) || amount(a16ho.krw)!==manifest.aug16.husbandAmount || amount(a16to.krw)!==manifest.aug16.tossAmount || amount(a16src.krw)!==manifest.aug16.husbandAmount+manifest.aug16.tossAmount) fail("LEGACY_MISMATCH","8월 16일 원수입과 목적별 배분 금액이 예상값과 다릅니다.");
    const a14ho=tx(business,manifest.aug14.husbandOutTxId), a14hi=tx(husband,manifest.aug14.husbandInTxId), a14to=tx(business,manifest.aug14.tossOutTxId), a14ti=tx(toss,manifest.aug14.tossInTxId);
    validatePair(a14ho,a14hi); validatePair(a14to,a14ti);
    if(amount(a14ho.krw)!==manifest.aug14.husbandAmount || amount(a14to.krw)!==manifest.aug14.tossAmount) fail("LEGACY_MISMATCH","8월 14일 목적별 배분 금액이 예상값과 다릅니다.");
    const next=ensureStore(clone(original));
    next.money.distLog.forEach(l=>{ if(!l.status){ l.status="legacy"; l.readOnly=true; l.legacy=true; } });
    const nb=accountById(next,manifest.businessAccountId), nh=accountById(next,manifest.husbandAccountId), nt=accountById(next,manifest.tossAccountId);
    const ntx=(account,id)=>(account.tx||[]).find(t=>t.id===id);
    ntx(nb,manifest.aug22.sourceIncomeTxId).incomeSource=true;
    ntx(nb,manifest.aug16.sourceIncomeTxId).incomeSource=true;
    nb.tx=nb.tx.filter(t=>t.id!==manifest.aug22.duplicateIncomeTxId);
    const decoratePair=(outAccount,outId,inAccount,inId,ledgerId)=>{ const o=ntx(outAccount,outId), i=ntx(inAccount,inId); markTx(o,ledgerId,"sourceOut"); markTx(i,ledgerId,"targetIn"); return {out:o,inn:i}; };
    const p22=decoratePair(nb,manifest.aug22.sourceOutTxId,nh,manifest.aug22.targetInTxId,manifest.aug22.ledgerId), l22=next.money.distLog.find(l=>l.id===manifest.aug22.ledgerId);
    Object.assign(l22,{status:"active",readOnly:false,legacy:false,sourceAccountId:nb.id,sourceIncomeTxId:manifest.aug22.sourceIncomeTxId,items:[{targetType:"account",targetId:nh.id,targetNameSnapshot:nh.alias||"남편계좌",amount:amount(p22.out.krw),sourceOutTxId:p22.out.id,effects:[{kind:"accountTx",accountId:nh.id,recordId:p22.inn.id,direction:"in",amount:amount(p22.inn.krw)}]}]});
    const p16h=decoratePair(nb,manifest.aug16.husbandOutTxId,nh,manifest.aug16.husbandInTxId,manifest.aug16.ledgerId), p16t=decoratePair(nb,manifest.aug16.tossOutTxId,nt,manifest.aug16.tossInTxId,manifest.aug16.ledgerId);
    next.money.distLog.unshift({id:manifest.aug16.ledgerId,status:"active",sourceAccountId:nb.id,sourceIncomeTxId:manifest.aug16.sourceIncomeTxId,date:a16src.date||"2026-08-16",created:0,legacyMigrated:true,items:[
      {targetType:"account",targetId:nh.id,targetNameSnapshot:nh.alias||"남편계좌",amount:amount(p16h.out.krw),sourceOutTxId:p16h.out.id,effects:[{kind:"accountTx",accountId:nh.id,recordId:p16h.inn.id,direction:"in",amount:amount(p16h.inn.krw)}]},
      {targetType:"account",targetId:nt.id,targetNameSnapshot:nt.alias||"토스생활비",amount:amount(p16t.out.krw),sourceOutTxId:p16t.out.id,effects:[{kind:"accountTx",accountId:nt.id,recordId:p16t.inn.id,direction:"in",amount:amount(p16t.inn.krw)}]}
    ]});
    const p14h=decoratePair(nb,manifest.aug14.husbandOutTxId,nh,manifest.aug14.husbandInTxId,manifest.aug14.ledgerId), p14t=decoratePair(nb,manifest.aug14.tossOutTxId,nt,manifest.aug14.tossInTxId,manifest.aug14.ledgerId);
    next.money.distLog.unshift({id:manifest.aug14.ledgerId,status:"legacy",readOnly:true,legacy:true,sourceAccountId:nb.id,sourceIncomeTxId:null,date:a14ho.date||"2026-08-14",created:0,items:[
      {targetType:"account",targetId:nh.id,targetNameSnapshot:nh.alias||"남편계좌",amount:amount(p14h.out.krw),sourceOutTxId:p14h.out.id,effects:[{kind:"accountTx",accountId:nh.id,recordId:p14h.inn.id,direction:"in",amount:amount(p14h.inn.krw)}]},
      {targetType:"account",targetId:nt.id,targetNameSnapshot:nt.alias||"토스생활비",amount:amount(p14t.out.krw),sourceOutTxId:p14t.out.id,effects:[{kind:"accountTx",accountId:nt.id,recordId:p14t.inn.id,direction:"in",amount:amount(p14t.inn.krw)}]}
    ]});
    next.money.distributionMigrationVersion=1;
    return {store:next,changed:true,report:{removedDuplicateTxId:manifest.aug22.duplicateIncomeTxId,linkedLedgerIds:[manifest.aug22.ledgerId,manifest.aug16.ledgerId],legacyReadOnlyLedgerId:manifest.aug14.ledgerId}};
  }

  return {LEGACY_MANIFEST,clone,ensureStore,accountBalance,allocatedForIncome,remainingForIncome,incomeCandidates,buildDistribution,cancelDistribution,activeLinkForTx,canEditTransaction,canDeleteTransaction,canDeleteAccount,canDeleteEmergencyTx,externalFlowTotals,netWorth,migrateLegacyDistributions,isInternalTransfer};
});
